// ════════════════════════════════════════════════════════════════════
// RJEČNIK — spremanje (Admin SDK). Pravila su u ./vocab.ts.
// assistant_vocab/{id}: jedna riječ → jedna stvar; ista riječ istog cilja se
// ne duplira, nego joj raste Count (koliko puta je potvrđena).
// ════════════════════════════════════════════════════════════════════

import { v4 as uuidv4 } from 'uuid';
import { adminDb } from '@/lib/server/firebaseAdmin';
import { EXPIRES_DAYS, vocabKey, type VocabEntry, type VocabKind } from './vocab';

const COL = 'assistant_vocab';

export async function listVocab(orgId: string): Promise<VocabEntry[]> {
    const snap = await adminDb().collection(COL).where('Organization_ID', '==', orgId).get();
    return snap.docs.map(d => d.data() as VocabEntry).sort((a, b) => a.Created_At.localeCompare(b.Created_At) || a.Vocab_ID.localeCompare(b.Vocab_ID));
}

/**
 * Zapamti riječ (ili joj podigni Count). Vraća putanju i stanje prije, za ↩️ Poništi.
 * Lokacija bez projekta dobija rok važenja; riječ projekta važi dok je projekat aktivan.
 */
export async function learnVocab(orgId: string, input: {
    phrase: string; kind: VocabKind; targetId: string; targetLabel: string; projectId?: string; source: VocabEntry['Source'];
}, now = new Date()): Promise<{ entry: VocabEntry; path: string; before: Record<string, unknown> | null } | null> {
    const key = vocabKey(input.phrase);
    if (!key || key.length < 2) return null;
    const nowIso = now.toISOString();
    const expires = input.kind === 'location' && !input.projectId
        ? new Date(now.getTime() + EXPIRES_DAYS * 86_400_000).toISOString() : undefined;
    const snap = await adminDb().collection(COL)
        .where('Organization_ID', '==', orgId).where('Key', '==', key).where('Kind', '==', input.kind).get();
    const same = snap.docs.find(d => (d.data() as VocabEntry).Target_ID === input.targetId);
    if (same) {
        const before = same.data() as VocabEntry;
        const entry: VocabEntry = { ...before, Count: (before.Count || 1) + 1, Updated_At: nowIso, ...(expires ? { Expires_At: expires } : {}) };
        await same.ref.set(entry);
        return { entry, path: same.ref.path, before: before as unknown as Record<string, unknown> };
    }
    const ref = adminDb().collection(COL).doc();
    const entry: VocabEntry = {
        Vocab_ID: uuidv4(), Organization_ID: orgId, Phrase: input.phrase.trim().slice(0, 80), Key: key, Kind: input.kind,
        Target_ID: input.targetId, Target_Label: input.targetLabel.slice(0, 120),
        ...(input.projectId ? { Project_ID: input.projectId } : {}), ...(expires ? { Expires_At: expires } : {}),
        Source: input.source, Count: 1, Created_At: nowIso, Updated_At: nowIso,
    };
    await ref.set(entry);
    return { entry, path: ref.path, before: null };
}
