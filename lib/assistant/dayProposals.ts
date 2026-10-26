// ════════════════════════════════════════════════════════════════════
// PRIJEDLOG DANA — spremanje, dugmad i upis (Admin SDK)
//
// assistant_day_proposals/{id}: prijedlog kakav je poslan + koje stavke je
// korisnik isključio. „Upiši označeno" ide kroz bookWorkDiary, isto kao
// diktat, s ↩️ Poništi (turnId dp-<id>). Odluke donosi lib/dayProposal.ts.
// ════════════════════════════════════════════════════════════════════

import { adminDb } from '@/lib/server/firebaseAdmin';
import {
    attachItems, getActiveWorkers, getAttendanceInRange, getBookableWorkOrders, getItemsForWorkOrders, getWorkLogsInRange,
} from '@/lib/server/fieldRepo';
import { bookWorkDiary } from '@/lib/server/workDiary';
import { buildDayProposal, findGaps, isWorkingDay, LOOKBACK_DAYS, type DayProposal } from '@/lib/dayProposal';
import { logSource } from '@/lib/workHistory';
import { addDays } from '@/lib/voice/dates';
import type { ButtonRows } from '@/lib/telegram/api';
import { diarySummary } from './diaryText';
import { gapsNote, proposalMessage, shortDate } from './dayProposalText';
import { recordOp, type AssistantLink } from './store';

const COL = 'assistant_day_proposals';
/** Rupe se traže ovoliko radnih dana unazad (jutarnji pregled). */
const GAP_DAYS = 7;

interface StoredProposal {
    Proposal_ID: string;
    Organization_ID: string;
    Owner_UID: string;
    Date: string;
    Proposal: DayProposal;
    Excluded: number[];
    Status: 'open' | 'booked' | 'skipped';
    Created_At: string;
}

export interface ProposalReply { text: string; buttons?: ButtonRows; toast?: string }

export async function loadDayProposal(orgId: string, date: string): Promise<DayProposal> {
    const [workers, logs, attendance, orders] = await Promise.all([
        getActiveWorkers(orgId),
        getWorkLogsInRange(orgId, addDays(date, -LOOKBACK_DAYS), date),
        getAttendanceInRange(orgId, date, `${date}T99`),
        getBookableWorkOrders(orgId),
    ]);
    attachItems(orders, await getItemsForWorkOrders(orgId, orders.map(o => o.Work_Order_ID)));
    return buildDayProposal({ date, workers, logs, attendance, orders });
}

/** Nov prijedlog za dan → poruka s dugmadima; null kad nema ničega za predložiti. */
export async function createProposalMessage(link: AssistantLink, date: string, today: string): Promise<ProposalReply | null> {
    const proposal = await loadDayProposal(link.orgId, date);
    const ref = adminDb().collection(COL).doc();
    const msg = proposalMessage(proposal, ref.id, [], today);
    if (!msg) return null;
    if (proposal.lines.length) {
        const doc: StoredProposal = {
            Proposal_ID: ref.id, Organization_ID: link.orgId, Owner_UID: link.uid, Date: date,
            Proposal: JSON.parse(JSON.stringify(proposal)), Excluded: [], Status: 'open', Created_At: new Date().toISOString(),
        };
        await ref.set(doc);
    }
    return msg;
}

/** Dugme na poruci prijedloga: t (uključi/isključi stavku), ok (upiši), no (preskoči). */
export async function handleProposalButton(link: AssistantLink, id: string, action: string, arg: string, today: string): Promise<ProposalReply | null> {
    const ref = adminDb().collection(COL).doc(id);
    const snap = await ref.get();
    const p = snap.data() as StoredProposal | undefined;
    if (!p || p.Owner_UID !== link.uid || p.Organization_ID !== link.orgId) return { text: '', toast: 'Prijedlog više ne postoji.' };
    if (p.Status !== 'open') return { text: '', toast: p.Status === 'booked' ? 'Već upisano.' : 'Prijedlog je preskočen.' };

    if (action === 't') {
        const i = Number(arg);
        if (!Number.isInteger(i) || i < 0 || i >= p.Proposal.lines.length) return { text: '', toast: 'Nepoznata stavka.' };
        const excluded = p.Excluded.includes(i) ? p.Excluded.filter(x => x !== i) : [...p.Excluded, i];
        await ref.update({ Excluded: excluded });
        return proposalMessage(p.Proposal, id, excluded, today);
    }

    if (action === 'no') {
        await ref.update({ Status: 'skipped' });
        return { text: `📝 Prijedlog za ${shortDate(p.Date)}\n⏭ Preskočeno — ništa nije upisano.`, toast: 'Preskočeno' };
    }

    if (action !== 'ok') return null;
    return bookProposal(link, ref, p, today);
}

async function bookProposal(
    link: AssistantLink, ref: FirebaseFirestore.DocumentReference, p: StoredProposal, today: string,
): Promise<ProposalReply> {
    const chosen = p.Proposal.lines.filter((_, i) => !p.Excluded.includes(i));
    if (!chosen.length) return { text: '', toast: 'Ništa nije označeno.' };

    // Radnik upisan u međuvremenu (diktat poslije prijedloga) se ne gazi.
    const dayLogs = await getWorkLogsInRange(link.orgId, p.Date, p.Date);
    const already = new Set(dayLogs.filter(l => logSource(l) !== 'auto').map(l => l.Worker_ID));
    const lines = chosen
        .map(l => ({ ...l, workerIds: l.workerIds.filter(id => !already.has(id)) }))
        .filter(l => l.workerIds.length);
    const skipped = chosen.flatMap(l => l.workerNames.filter((_, i) => already.has(l.workerIds[i])));
    if (!lines.length) {
        await ref.update({ Status: 'booked' });
        return { text: `📝 Prijedlog za ${shortDate(p.Date)}\nSvi označeni su u međuvremenu već upisani — ništa nije mijenjano.` };
    }

    const befores = new Map<string, Record<string, unknown> | null>();
    const result = await bookWorkDiary(link.orgId, p.Date, lines.map(l => ({
        workerIds: l.workerIds,
        target: l.workOrderName,
        workOrderId: l.workOrderId,
        itemIds: l.itemIds,
        ...(l.process ? { process: l.process, newProcess: true } : {}),
        ...(l.fraction ? { fraction: l.fraction } : {}),
    })), [], (path, data) => { if (!befores.has(path)) befores.set(path, data); });
    if (!result.ok) {
        // Nalog ili proizvod je nestao između prijedloga i potvrde.
        return { text: '', toast: 'Prijedlog više ne odgovara nalozima — izdiktiraj dan porukom.' };
    }

    const turnId = `dp-${p.Proposal_ID}`;
    const label = `rad ${shortDate(p.Date)}`;
    await Promise.all(Array.from(befores.entries()).map(([path, before]) =>
        recordOp({ turnId, uid: link.uid, orgId: link.orgId, path, before, label })));
    await ref.update({ Status: 'booked', Booked_At: new Date().toISOString() });

    const dayName = p.Date === today ? 'danas' : shortDate(p.Date);
    const note = skipped.length ? `\n\nPreskočeni jer su već upisani: ${skipped.join(', ')}` : '';
    return { text: `${diarySummary(result, dayName)}${note}`, buttons: [[{ text: '↩️ Poništi', data: `undo:${turnId}` }]], toast: 'Upisano' };
}

/** Rupe za jutarnji pregled; null kad ih nema. */
export async function gapsForDigest(orgId: string, today: string): Promise<ProposalReply | null> {
    const [workers, logs, attendance] = await Promise.all([
        getActiveWorkers(orgId),
        getWorkLogsInRange(orgId, addDays(today, -30), addDays(today, -1)),
        getAttendanceInRange(orgId, addDays(today, -GAP_DAYS), `${addDays(today, -1)}T99`),
    ]);
    return gapsNote(findGaps({ today, days: GAP_DAYS, workers, logs, attendance }));
}

/** Da li je dan radni za večernji prijedlog (subota/nedjelja samo uz prisustvo u šihtarici). */
export async function isWorkingDayFor(orgId: string, date: string): Promise<boolean> {
    const wd = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (wd >= 1 && wd <= 5) return true;
    return isWorkingDay(date, await getAttendanceInRange(orgId, date, `${date}T99`));
}
