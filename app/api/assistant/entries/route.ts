// ════════════════════════════════════════════════════════════════════
// POSTAVKE → TELEGRAM ASISTENT → PORUKE BOTU
//
//   GET  ?days=14        poruke korisnika s ishodom (šta je bot stvarno upisao)
//   POST { entryId }     ponovna obrada poruke koja nije upisana
//
// Vidi se samo vlastiti dnevnik (Owner_UID iz tokena). Odgovor ponovne
// obrade stiže i na Telegram, s ↩️ Poništi kao svaki upis.
// ════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/server/firebaseAdmin';
import { errorResponse, HttpError, requireStaff } from '@/lib/server/requireUser';
import { getLinkByUid } from '@/lib/assistant/store';
import { reprocessEntry } from '@/lib/assistant/telegramHandler';
import { COLLECTIONS } from '@/lib/services/shared/collections';
import type { AssistantEntry } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Stari unosi (prije 27.10.) nemaju ishod: imaju li vezu sa zadatkom/stavkom, upisani su. */
function outcomeOf(e: AssistantEntry): string {
    if (e.Outcome) return e.Outcome;
    return (e.Task_IDs?.length || e.Memory_IDs?.length) ? 'written' : 'unknown';
}

export async function GET(req: Request) {
    try {
        const caller = await requireStaff(req);
        const days = Math.min(60, Math.max(1, Number(new URL(req.url).searchParams.get('days')) || 14));
        const since = new Date(Date.now() - days * 86_400_000).toISOString();
        const snap = await adminDb().collection(COLLECTIONS.ASSISTANT_ENTRIES).where('Owner_UID', '==', caller.uid).get();
        const entries = snap.docs.map(d => d.data() as AssistantEntry)
            .filter(e => e.Organization_ID === caller.orgId && e.Created_At >= since)
            .sort((a, b) => b.Created_At.localeCompare(a.Created_At))
            .map(e => ({
                id: e.Entry_ID, at: e.Created_At, kind: e.Kind, text: e.Raw_Text, from: e.Forward_From || null,
                outcome: outcomeOf(e), reply: e.Reply_Text || null, changes: e.Changes || [], toolCalls: e.Tool_Calls || [], attempts: e.Attempts || 0, usage: e.Usage || null,
                signals: e.Signals || [], feedback: (e.Feedback || []).map(f => ({ at: f.At, kind: f.Kind, text: f.Text })),
            }));
        return NextResponse.json({ entries }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (e) {
        return errorResponse(e);
    }
}

export async function POST(req: Request) {
    try {
        const caller = await requireStaff(req);
        const body = await req.json().catch(() => ({})) as { entryId?: unknown };
        const entryId = typeof body.entryId === 'string' ? body.entryId : '';
        if (!entryId) throw new HttpError(400, 'Nedostaje poruka.');
        const link = await getLinkByUid(caller.uid);
        if (!link || link.orgId !== caller.orgId) throw new HttpError(409, 'Telegram nije povezan — odgovor ponovne obrade nema gdje stići.');
        const res = await reprocessEntry(link, entryId);
        if (!res.ok) throw new HttpError(409, res.error);
        return NextResponse.json(res);
    } catch (e) {
        return errorResponse(e);
    }
}
