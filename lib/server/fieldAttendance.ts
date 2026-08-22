// ════════════════════════════════════════════════════════════════════
// ŠIHTARICA I KNJIŽENJE — serverski blizanac (admin SDK)
//
// Kontrolor s telefona radi ISTI tok kao vlasnik na desktopu:
//   označi prisustvo → prijedlog naloga → potvrdi → dnevnice se knjiže.
//
// Zašto blizanac a ne ponovna upotreba lib/attendance.ts: taj modul je vezan
// za klijentski Firebase SDK (`import { db } from './firebase'`) i ne može se
// izvršiti na serveru. Pogonske uloge pak nemaju pristup Firestoreu (vidi
// firestore.rules), pa klijentski put za njih ne postoji.
//
// ŠTA SE NE DUPLIRA: sva aritmetika. `splitDnevnicaByOrder`, `effectiveDailyRate`,
// `buildBookingProposal`, `resolveLaborCostTarget`, `resolveAutoProcessNode` i
// `aggregateLaborFromLogs` su čiste i dijele se s desktopom. Ovdje je samo I/O
// i redoslijed poziva. Da se aritmetika prepisala, isti dan bi se obračunao
// različito ovisno o tome ko ga je unio.
//
// Redoslijed poziva je preslikan iz `commitDecisions` (components/tabs/
// AttendanceTab.tsx) — grupisanje PO RADNIKU je bitno: radnik na tri naloga
// mora dobiti JEDNO knjiženje i JEDNU renormalizaciju, inače se dnevnica
// podijeli tri puta zaredom i svaki put drugačije.
// ════════════════════════════════════════════════════════════════════

import { v4 as uuidv4 } from 'uuid';
import { adminDb } from './firebaseAdmin';
import {
    attachItems, getBookableWorkOrders, getItemDocsForWorkOrder, getItemsByIds,
    getItemsForWorkOrders, getProcessGraphs, getWorkLogRefsForWorkerDate,
    getWorkLogsForWorkOrder, getWorkers, getWorkOrderRef,
} from './fieldRepo';
import { aggregateLaborFromLogs, laborCostOf, laborDaysOf } from '@/lib/laborAggregate';
import { effectiveDailyRate, splitDnevnicaByOrder } from '@/lib/laborSplit';
import { resolveLaborCostTarget } from '@/lib/laborTarget';
import { resolveAutoProcessNode } from '@/lib/productProcesses';
import { isWorkerAssignedToAutoItem } from '@/lib/autoBook';
import { buildBookingProposal, type ProposalRow, type SavedAttendanceWorker } from '@/lib/attendanceBooking';
import type { WorkOrder, WorkOrderItem } from '@/lib/types';

const ABSENT_STATUSES = new Set(['Odsutan', 'Bolovanje', 'Odmor', 'Vikend', 'Praznik']);
const PRESENT_STATUSES = new Set(['Prisutan', 'Teren']);

export interface BookTarget { workOrderId: string; itemId: string; productId?: string }

// ════════════════════════════════════════════════════════════════════
// 1. PRISUSTVO — jedini upis koji uopšte ne dira novac
// ════════════════════════════════════════════════════════════════════

export interface SetAttendanceInput {
    workerId: string;
    workerName: string;
    date: string;            // YYYY-MM-DD
    status: string;
    notes?: string;
}

/**
 * Upiši prisustvo. Dokument `worker_attendance` NEMA nijedno novčano polje —
 * ni po tipu ni u praksi (provjereno protiv svih pisaca).
 *
 * Duplikat se ne pravi: ako zapis za (radnik, dan) postoji, ponovo se koristi
 * njegov `Attendance_ID` — isto pravilo kao `saveWorkerAttendance` na desktopu.
 */
export async function setAttendance(orgId: string, input: SetAttendanceInput): Promise<void> {
    const db = adminDb();
    const existing = await db.collection('worker_attendance')
        .where('Organization_ID', '==', orgId)
        .where('Worker_ID', '==', input.workerId)
        .where('Date', '==', input.date)
        .limit(1)
        .get();

    const attendanceId = existing.empty
        ? uuidv4()
        : (existing.docs[0].data().Attendance_ID as string) || existing.docs[0].id;
    const createdDate = existing.empty
        ? new Date().toISOString()
        : (existing.docs[0].data().Created_Date as string) || new Date().toISOString();

    await db.collection('worker_attendance').doc(attendanceId).set({
        Attendance_ID: attendanceId,
        Organization_ID: orgId,
        Worker_ID: input.workerId,
        Worker_Name: input.workerName,
        Date: input.date,
        Status: input.status,
        Notes: input.notes || '',
        Created_Date: createdDate,
        Modified_Date: new Date().toISOString(),
    }, { merge: true });
}

/**
 * Odsutan radnik ne smije zadržati dnevnicu.
 *
 * Ručno unesene dnevnice (`Booking_Source === 'manual'`, Knjiga rada) se ČUVAJU —
 * one su izričita ljudska odluka i šihtarica ih ne smije pregaziti. Isto pravilo
 * kao `deleteWorkLogsForWorkerOnDate` na desktopu.
 *
 * @returns Work_Order_ID-evi kojima treba preračun
 */
export async function clearAutoLogsForAbsence(orgId: string, workerId: string, date: string): Promise<string[]> {
    const logs = await getWorkLogRefsForWorkerDate(orgId, workerId, date);
    const removable = logs.filter(l => l.data.Booking_Source !== 'manual');
    if (removable.length === 0) return [];

    const batch = adminDb().batch();
    const affected = new Set<string>();
    for (const l of removable) {
        batch.delete(l.ref);
        if (l.data.Work_Order_ID) affected.add(l.data.Work_Order_ID);
    }
    await batch.commit();
    return Array.from(affected);
}

// ════════════════════════════════════════════════════════════════════
// 2. PRIJEDLOG NALOGA — „dodjela naloga" iz šihtarice
// ════════════════════════════════════════════════════════════════════

/**
 * Isti prijedlog koji desktop pokaže kad se radnik označi prisutnim.
 *
 * `buildBookingProposal` je čist i njegov izlaz `ProposalRow[]` **već ne sadrži
 * nijedan iznos** — samo `workOrderId, name, status, paused, assigned, notStarted`.
 * To je tačna granica: cijeli nalog (s Total_Value i Profit) ostaje na serveru,
 * a telefon dobija samo odluke koje treba ponuditi.
 */
export async function buildProposalForDate(
    orgId: string,
    saved: SavedAttendanceWorker[],
    date: string
): Promise<ProposalRow[]> {
    if (saved.length === 0) return [];

    const orders = await getBookableWorkOrders(orgId);
    const items = await getItemsForWorkOrders(orgId, orders.map(o => o.Work_Order_ID));
    attachItems(orders, items);

    // Kao na desktopu: `hasExistingLog` se namjerno ne prosljeđuje. Idempotentnost
    // se provodi kasnije, u samom knjiženju — tako prijedlog pokaže sve naloge
    // radnika, a ne samo one na kojima još nema zapisa.
    return buildBookingProposal(saved, orders, date);
}

// ════════════════════════════════════════════════════════════════════
// 3. KNJIŽENJE
// ════════════════════════════════════════════════════════════════════

/**
 * Proknjiži radnikov dan na zadate proizvode. IDEMPOTENTNO — proizvod koji
 * za taj dan već ima zapis tog radnika se preskače, pa ponovljen zahtjev
 * (slaba mreža u pogonu) ne pravi duplu dnevnicu.
 *
 * Vjeran prijenos `bookWorkerDayItems` iz lib/attendance.ts.
 */
export async function bookWorkerDayItems(
    orgId: string,
    workerId: string,
    workerName: string,
    date: string,
    targets: BookTarget[],
    presence: number = 1,
    /**
     * 'attendance' = nastalo iz šihtarice (odsustvo ga smije počistiti).
     * 'manual'     = izričit unos u Knjigu rada; `clearAutoLogsForAbsence` ga
     *                NE dira, isto pravilo kao na desktopu.
     *
     * Ime NIJE `source` — tako se u petlji ispod već zove stavka s koje je
     * trošak preusmjeren (`resolveLaborCostTarget`), pa bi je parametar zasjenio.
     */
    bookingSource: 'attendance' | 'manual' = 'attendance'
): Promise<{ created: number; affectedWorkOrderIds: string[] }> {
    if (!workerId || !date || !orgId || targets.length === 0) {
        return { created: 0, affectedWorkOrderIds: [] };
    }

    const db = adminDb();

    // Već knjiženi proizvodi tog dana → idempotentnost.
    const existing = await getWorkLogRefsForWorkerDate(orgId, workerId, date);
    const loggedItemIds = new Set(existing.map(l => l.data.Work_Order_Item_ID).filter(Boolean));

    // Stavke ciljeva + povezani „razni poslovi" (trošak ide na povezani proizvod).
    const targetItems = await getItemsByIds(orgId, targets.map(t => t.itemId));
    const itemMap = new Map<string, WorkOrderItem>(targetItems.map(i => [i.ID, i]));

    const linkedIds = Array.from(new Set(
        targetItems
            .filter(it => it.Item_Type === 'custom' && it.Linked_Item_ID)
            .map(it => it.Linked_Item_ID as string)
    )).filter(id => !itemMap.has(id));
    if (linkedIds.length > 0) {
        (await getItemsByIds(orgId, linkedIds)).forEach(i => itemMap.set(i.ID, i));
    }

    // Graf procesa za auto-pripis — živi NA dokumentu naloga, bez dodatnog čitanja.
    // Uključuje i naloge POVEZANIH proizvoda (na njih pada preusmjeren trošak).
    const graphByWO = await getProcessGraphs(orgId, [
        ...targets.map(t => t.workOrderId),
        ...Array.from(itemMap.values()).map(i => i.Work_Order_ID),
    ]);

    // Cijena VAŽEĆA na datum knjiženja, ne trenutna — retroaktivne izmjene
    // dnevnice ne smiju prepisati istoriju.
    const workers = await getWorkers(orgId);
    const dailyRate = effectiveDailyRate(workers.find(w => w.Worker_ID === workerId), date);
    const norm = presence === 0.5 ? 0.5 : 1;

    const batch = db.batch();
    const affected = new Set<string>();
    const seen = new Set<string>();
    let created = 0;

    for (const t of targets) {
        if (!t.itemId || !t.workOrderId) continue;

        const booked = itemMap.get(t.itemId);
        const { target, redirected, source } = booked
            ? resolveLaborCostTarget(booked, itemMap)
            : { target: undefined as WorkOrderItem | undefined, redirected: false, source: undefined };

        const targetItemId = target?.ID || t.itemId;
        const targetWoId = target?.Work_Order_ID || t.workOrderId;

        if (seen.has(targetItemId)) continue;             // dedupe unutar poziva
        seen.add(targetItemId);
        if (loggedItemIds.has(targetItemId)) continue;    // već knjiženo → ručni unos ima prednost

        const productId = target?.Product_ID || t.productId || booked?.Product_ID;
        const autoNode = redirected
            ? null
            : resolveAutoProcessNode(graphByWO.get(targetWoId), targetItemId, target?.Processes);

        const log: Record<string, unknown> = {
            WorkLog_ID: uuidv4(), Organization_ID: orgId, Date: date,
            Worker_ID: workerId, Worker_Name: workerName,
            Daily_Rate: dailyRate, Original_Daily_Rate: dailyRate,
            Day_Fraction: norm, Presence: norm, Split_Factor: 1, Hours_Worked: 8 * norm,
            Booking_Source: bookingSource, Is_From_Attendance: bookingSource === 'attendance',
            Work_Order_ID: targetWoId, Work_Order_Item_ID: targetItemId, Product_ID: productId,
            ...(redirected && source ? {
                Source_Work_Order_ID: source.Work_Order_ID,
                Source_Work_Order_Item_ID: source.ID,
                Process_Name: source.Product_Name,
            } : (autoNode ? { Process_Node_ID: autoNode.id, Process_Name: autoNode.name } : {})),
            Created_At: new Date().toISOString(),
        };
        Object.keys(log).forEach(k => log[k] === undefined && delete log[k]);

        batch.set(db.collection('work_logs').doc(), log);
        affected.add(targetWoId);
        created++;
    }

    if (created === 0) return { created: 0, affectedWorkOrderIds: [] };
    await batch.commit();

    // Kanonska podjela preko CIJELOG radnikovog dana (uklj. druge naloge i ručne unose).
    const wos = await renormalizeWorkerDay(orgId, workerId, date, norm);
    wos.forEach(id => affected.add(id));

    return { created, affectedWorkOrderIds: Array.from(affected) };
}

/**
 * Ravnomjerno raspodijeli dnevnicu preko SVIH radnikovih zapisa tog dana.
 *
 * Invarijanta: Σ Daily_Rate = Original_Daily_Rate × Presence. Ovo je funkcija
 * koja tu invarijantu održava — sve prije nje upisuje privremene vrijednosti.
 *
 * Vjeran prijenos `renormalizeWorkerDay` iz lib/attendance.ts, uključujući garde:
 * ne upisuje nule kad dnevnica nije poznata (obrisan radnik) i preskače zapise
 * obrisanih naloga da ne naduvaju preostale.
 */
export async function renormalizeWorkerDay(
    orgId: string,
    workerId: string,
    date: string,
    presenceHint?: number
): Promise<Set<string>> {
    const affected = new Set<string>();
    if (!workerId || !date || !orgId) return affected;

    const all = await getWorkLogRefsForWorkerDate(orgId, workerId, date);
    const docs = all.filter(l => (l.data as any).Work_Order_Deleted !== true);
    if (docs.length === 0) return affected;

    // Prisutnost je po (radnik, dan): posljednja korisnička namjera ima prednost.
    let presence = 1;
    if (presenceHint === 0.5 || presenceHint === 1) {
        presence = presenceHint;
    } else {
        for (const d of docs) {
            const p = d.data.Presence;
            if (p === 0.5 || p === 1) { presence = p; break; }
        }
    }

    const distinctPresence = new Set<number>(
        docs.map(d => d.data.Presence).filter((p): p is number => p === 0.5 || p === 1)
    );
    if (distinctPresence.size > 1 || (distinctPresence.size === 1 && !distinctPresence.has(presence))) {
        console.warn(`[fieldAttendance] konflikt prisutnosti ${workerId} @ ${date}: postoji ${Array.from(distinctPresence).join('/')}, primjenjujem ${presence}.`);
    }

    let dnevnica = 0;
    for (const d of docs) {
        const o = d.data.Original_Daily_Rate;
        if (typeof o === 'number' && o > 0) { dnevnica = o; break; }
    }
    if (dnevnica <= 0) {
        const workers = await getWorkers(orgId);
        dnevnica = effectiveDailyRate(workers.find(w => w.Worker_ID === workerId), date);
    }
    // GARDA: bez poznate dnevnice NE nuliramo postojeće zapise — istorijski
    // trošak se ne smije izgubiti zato što je radnik u međuvremenu arhiviran.
    if (dnevnica <= 0) {
        console.warn(`[fieldAttendance] preskočeno: nepoznata dnevnica za ${workerId} @ ${date} — ne nuliram ${docs.length} zapis(a).`);
        return affected;
    }

    // Dvonivovska podjela: dan → nalozi → proizvodi.
    const orderIds: string[] = [];
    const byOrder = new Map<string, typeof docs>();
    for (const d of docs) {
        const woId = (d.data.Work_Order_ID as string) || '__none__';
        if (!byOrder.has(woId)) { byOrder.set(woId, []); orderIds.push(woId); }
        byOrder.get(woId)!.push(d);
    }
    const { amounts, dayFractions } = splitDnevnicaByOrder(
        dnevnica, presence, orderIds.map(id => byOrder.get(id)!.length)
    );

    const batch = adminDb().batch();
    let changed = 0;
    orderIds.forEach((woId, oi) => {
        const group = byOrder.get(woId)!;
        const splitFactor = orderIds.length * group.length;
        group.forEach((d, j) => {
            const data = d.data;
            if (data.Work_Order_ID) affected.add(data.Work_Order_ID);
            const amount = amounts[oi][j];
            const dayFraction = dayFractions[oi][j];
            const needsUpdate =
                Math.abs((data.Daily_Rate || 0) - amount) > 0.001 ||
                Math.abs((data.Day_Fraction ?? 1) - dayFraction) > 0.0001 ||
                (data.Split_Factor || 0) !== splitFactor ||
                (data.Original_Daily_Rate || 0) !== dnevnica ||
                (data.Presence ?? 1) !== presence;
            if (needsUpdate) {
                batch.update(d.ref, {
                    Daily_Rate: amount,
                    Day_Fraction: dayFraction,
                    Split_Factor: splitFactor,
                    Original_Daily_Rate: dnevnica,
                    Presence: presence,
                });
                changed++;
            }
        });
    });
    if (changed > 0) await batch.commit();
    return affected;
}

/**
 * Skini radnika s jednog dana JEDNOG naloga (Knjiga rada na telefonu).
 *
 * Namjerno usko: briše samo zapise koji direktno pripadaju tom nalogu — tačno
 * ono što je ekran i pokazao. Preusmjereni trošak „raznih poslova" (zapis živi
 * na tuđem nalogu, a nosi `Source_Work_Order_ID`) se NE dira: on se ne vidi u
 * ovoj knjizi, pa se odavde ne smije ni brisati. Za takve slučajeve ostaje
 * desktop, gdje se vidi cijela slika.
 *
 * Poslije brisanja radnikov dan se renormalizuje — ako mu je ostao rad na
 * drugim nalozima, dnevnica se preraspodijeli na njih (invarijanta
 * Σ Daily_Rate = Original_Daily_Rate × Presence ostaje).
 */
export async function removeWorkerDayFromOrder(
    orgId: string,
    workOrderId: string,
    workerId: string,
    date: string
): Promise<{ removed: number; affectedWorkOrderIds: string[] }> {
    const logs = await getWorkLogRefsForWorkerDate(orgId, workerId, date);
    const mine = logs.filter(l => l.data.Work_Order_ID === workOrderId && !l.data.Source_Work_Order_ID);
    if (mine.length === 0) return { removed: 0, affectedWorkOrderIds: [] };

    const batch = adminDb().batch();
    mine.forEach(l => batch.delete(l.ref));
    await batch.commit();

    const affected = new Set<string>([workOrderId]);
    (await renormalizeWorkerDay(orgId, workerId, date)).forEach(id => affected.add(id));
    return { removed: mine.length, affectedWorkOrderIds: Array.from(affected) };
}

/**
 * Osvježi trošak rada na nalogu i njegovim stavkama.
 *
 * NAMJERNO UŽE od desktop `recalculateWorkOrder`: dira samo rad. Prihod,
 * materijal i status ostaju netaknuti jer knjiženje dnevnice na njih ne utiče
 * (isto što desktop postiže sa `skipMaterialRefresh`/`skipStatusSync`).
 * Snapshot završenog naloga se ne pravi — nastaje kad vlasnik otvori nalog.
 *
 * Profit se NE upisuje jer se nigdje i ne čuva — računa se pri čitanju
 * (lib/profit.ts) iz Total_Value − Material_Cost − Actual_Labor_Cost.
 */
export async function recalcOrderLabor(orgId: string, workOrderId: string): Promise<void> {
    const [logs, itemDocs, orderRef] = await Promise.all([
        getWorkLogsForWorkOrder(orgId, workOrderId),
        getItemDocsForWorkOrder(orgId, workOrderId),   // jedan upit, s referencama
        getWorkOrderRef(orgId, workOrderId),
    ]);
    if (!orderRef) return;

    const agg = aggregateLaborFromLogs(logs);

    const batch = adminDb().batch();
    let orderTotal = 0;

    for (const { ref, data: item } of itemDocs) {
        const cost = laborCostOf(agg, item.ID);
        const days = laborDaysOf(agg, item.ID);
        orderTotal += cost;   // zbir VEĆ zaokruženih iznosa — isti redoslijed kao desktop

        if ((item.Actual_Labor_Cost || 0) !== cost || (item.Actual_Labor_Days || 0) !== days) {
            batch.update(ref, { Actual_Labor_Cost: cost, Actual_Labor_Days: days });
        }
    }

    batch.update(orderRef, {
        Actual_Labor_Cost: orderTotal,
        Labor_Cost: orderTotal,   // legacy ogledalo, desktop ga isto piše
    });

    await batch.commit();
}

// ════════════════════════════════════════════════════════════════════
// 4. ORKESTRACIJA — preslikano iz commitDecisions
// ════════════════════════════════════════════════════════════════════

export interface BookingDecisionInput {
    workerId: string;
    workerName: string;
    orderIds: string[];
    presence?: 0.5 | 1;
}

export interface CommitResult {
    booked: number;
    failedWorkers: string[];
    startWarnings: string[];
    affectedOrders: string[];
    /**
     * Koliko je (radnik, stavka) ciljeva uopšte pripremljeno. Razlikuje dva
     * tiha ishoda koja korisniku izgledaju isto („nula dnevnica"): nalog nema
     * nijednu stavku za knjižiti (prepared = 0) naspram toga da je dan već
     * proknjižen pa je idempotentnost sve preskočila (prepared > 0, booked = 0).
     */
    prepared: number;
}

/**
 * Pripremi ciljeve za jedan (radnik, nalog): odmrzni pauzirane stavke i
 * pokreni nalog ako još čeka.
 *
 * Ne knjiži — cijeli radnikov dan ide kroz JEDAN `bookWorkerDayItems`, pa
 * radnik na više naloga izazove jednu renormalizaciju umjesto tri.
 */
async function prepareWorkerOrderTargets(
    orgId: string,
    workerId: string,
    order: WorkOrder,
    startWarnings: string[]
): Promise<BookTarget[]> {
    const all = order.items || [];
    const live = all.filter(it => it.Status !== 'Završeno');
    const base = live.length > 0 ? live : all;   // sve završeno (npr. teren) → ipak knjiži
    const assigned = base.filter(it => isWorkerAssignedToAutoItem(it as any, workerId));
    const chosen = assigned.length > 0 ? assigned : base;
    if (chosen.length === 0) return [];

    const db = adminDb();

    // Odmrzni pauzirane stavke koje knjižimo.
    for (const it of chosen) {
        if (!it.Is_Paused) continue;
        const s = await db.collection('work_order_items')
            .where('Organization_ID', '==', orgId).where('ID', '==', it.ID).limit(1).get();
        if (!s.empty) await s.docs[0].ref.update({ Is_Paused: false });
    }

    // Pokreni nalog ako još čeka. Za razliku od desktopa NE provjeravamo
    // materijale: kontrolor je u pogonu i vidi da se radi. Ako start ne uspije,
    // dnevnica se ipak knjiži (trošak je nastao), ali se javlja upozorenje —
    // nepokrenut nalog ne prima auto-dnevnice narednih dana.
    if (order.Status === 'Na čekanju') {
        try {
            const ref = await getWorkOrderRef(orgId, order.Work_Order_ID);
            if (ref) {
                await ref.update({ Status: 'U toku', Started_At: order.Started_At || new Date().toISOString() });
            } else {
                startWarnings.push(`Nalog nije pronađen: ${order.Work_Order_Number || order.Work_Order_ID}`);
            }
        } catch {
            startWarnings.push(`„${order.Name || order.Work_Order_Number}" nije pokrenut (greška pri startu)`);
        }
    }

    return chosen.map(it => ({ workOrderId: order.Work_Order_ID, itemId: it.ID, productId: it.Product_ID }));
}

/**
 * Potvrda knjiženja — ono što se dogodi kad kontrolor pritisne
 * „Potvrdi i proknjiži".
 *
 * Greška kod jednog radnika ne smije zaustaviti ostale: obrađuje se po radniku
 * i vraća se tačan spisak onih koji nisu proknjiženi.
 */
export async function commitBooking(
    orgId: string,
    date: string,
    decisions: BookingDecisionInput[]
): Promise<CommitResult> {
    const startWarnings: string[] = [];
    const failedWorkers: string[] = [];
    const affectedOrders = new Set<string>();

    const orders = await getBookableWorkOrders(orgId);
    const items = await getItemsForWorkOrders(orgId, orders.map(o => o.Work_Order_ID));
    attachItems(orders, items);
    const orderById = new Map(orders.map(o => [o.Work_Order_ID, o]));

    // 1) Ciljevi PO RADNIKU — radnik na više naloga = svi ciljevi u jednom knjiženju.
    const perWorker = new Map<string, { workerName: string; presence: 0.5 | 1; targets: BookTarget[] }>();
    for (const d of decisions) {
        const presence: 0.5 | 1 = d.presence === 0.5 ? 0.5 : 1;
        if (!d.orderIds?.length) continue;

        const entry = perWorker.get(d.workerId) || { workerName: d.workerName, presence, targets: [] };
        for (const orderId of d.orderIds) {
            const order = orderById.get(orderId);
            if (!order) continue;
            try {
                entry.targets.push(...await prepareWorkerOrderTargets(orgId, d.workerId, order, startWarnings));
                affectedOrders.add(orderId);
            } catch (e) {
                console.error(`[fieldAttendance] priprema za ${d.workerName} (${orderId}) nije uspjela`, e);
                if (!failedWorkers.includes(d.workerName)) failedWorkers.push(d.workerName);
            }
        }
        if (entry.targets.length > 0) perWorker.set(d.workerId, entry);
    }

    // 2) Knjiži po radniku, paralelno.
    const results = await Promise.all(Array.from(perWorker.entries()).map(async ([workerId, w]) => {
        try {
            const res = await bookWorkerDayItems(orgId, workerId, w.workerName, date, w.targets, w.presence);
            res.affectedWorkOrderIds.forEach(id => affectedOrders.add(id));
            return res.created;
        } catch (e) {
            console.error(`[fieldAttendance] knjiženje za ${w.workerName} nije uspjelo`, e);
            if (!failedWorkers.includes(w.workerName)) failedWorkers.push(w.workerName);
            return 0;
        }
    }));
    const booked = results.reduce((s, n) => s + n, 0);
    const prepared = Array.from(perWorker.values()).reduce((s, w) => s + w.targets.length, 0);

    // 3) Preračunaj pogođene naloge — nezavisni dokumenti, pa paralelno.
    await Promise.all(Array.from(affectedOrders).map(id =>
        recalcOrderLabor(orgId, id).catch(e => console.warn('[fieldAttendance] recalc failed', id, e))
    ));

    return { booked, prepared, failedWorkers, startWarnings, affectedOrders: Array.from(affectedOrders) };
}

export { ABSENT_STATUSES, PRESENT_STATUSES };
