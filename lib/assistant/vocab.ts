// ════════════════════════════════════════════════════════════════════
// RJEČNIK — kako korisnik zove stvari u ERP-u (čista logika)
//
// Dva nivoa:
//   • OPŠTI (firma, trajno): procesi, materijali, radnici — „kantao fronte" =
//     Kantiranje furnira, „Braco" = Ibrahim.
//   • PROJEKTA (dok traje posao): klijent i ljudi („Jerko" = projekat
//     Čorluka), nalozi („ormar kod Jerka"), lokacije („305" = E305). Riječ
//     vezana za projekat ili nalog prestaje važiti kad se on zatvori; riječ
//     lokacije bez projekta ističe (EXPIRES_DAYS).
// Riječ nastaje kad je korisnik nauči („Jerko je Čorluka" → learn_name) ili
// potvrdi izbor koji je ERP ponudio (nalog za „ormar kod Jerka", stan za „305").
// Učenje = zapis potvrde, ne odluka modela.
// jest: lib/__tests__/vocab.test.ts
// ════════════════════════════════════════════════════════════════════

import { foldText, tokens } from '@/lib/voice/text';

export type VocabKind = 'project' | 'order' | 'location' | 'worker' | 'process' | 'material';

export interface VocabEntry {
    Vocab_ID: string;
    Organization_ID: string;
    /** Kako je rečeno („ormar kod Jerka"). */
    Phrase: string;
    /** Normalizovan ključ za poređenje (vocabKey). */
    Key: string;
    Kind: VocabKind;
    /** ID stvari u ERP-u (projekat, nalog, radnik) ili sam naziv (lokacija, proces, materijal). */
    Target_ID: string;
    Target_Label: string;
    /** Riječ projekta: vrijedi dok je projekat među aktivnima. */
    Project_ID?: string;
    /** Riječ lokacije bez projekta ističe. */
    Expires_At?: string;
    Source: 'taught' | 'confirmed';
    Count: number;
    Created_At: string;
    Updated_At: string;
}

/** Lokacija naučena bez projekta važi ovoliko dana od zadnje upotrebe. */
export const EXPIRES_DAYS = 60;

const STOP = new Set(['kod', 'za', 'u', 'na', 'i', 'od', 'je', 'to', 'onaj', 'ona', 'ono', 'mi', 'moj', 'moja']);

/** „Ormar kod Jerka" → „ormar jerka": bez dijakritike, malih riječi i interpunkcije. */
export function vocabKey(phrase: string): string {
    return tokens(foldText(phrase).replace(/[^a-z0-9\s]/g, ' ')).filter(w => !STOP.has(w)).join(' ');
}

/** Riječ koja važi sada: projekat/nalog još aktivan, lokacija nije istekla. */
export function activeVocab(entries: VocabEntry[], active: { projectIds: Set<string>; orderIds: Set<string> }, nowIso: string): VocabEntry[] {
    return entries.filter(e => {
        if (e.Project_ID && !active.projectIds.has(e.Project_ID)) return false;
        if (e.Kind === 'order' && !active.orderIds.has(e.Target_ID)) return false;
        if (e.Kind === 'project' && !active.projectIds.has(e.Target_ID)) return false;
        return !e.Expires_At || e.Expires_At >= nowIso;
    });
}

/** Ključ se javlja u tekstu kao niz riječi (riječ teksta počinje riječju ključa — padeži). */
function contains(textWords: string[], key: string): boolean {
    const kw = key.split(' ').filter(Boolean);
    if (!kw.length) return false;
    return textWords.some((_, i) => kw.every((w, j) => {
        const t = textWords[i + j] || '';
        return t === w || (w.length >= 4 && t.startsWith(w.slice(0, Math.max(4, w.length - 1))));
    }));
}

/**
 * Naučene riječi koje se javljaju u tekstu, najduža (najodređenija) prva.
 * `exact` = cijeli tekst je ta riječ (za lokaciju „305", proces „kantao fronte").
 */
export function findVocab(text: string, entries: VocabEntry[], kind: VocabKind, opts: { exact?: boolean } = {}): VocabEntry[] {
    const key = vocabKey(text);
    if (!key) return [];
    const words = key.split(' ');
    return entries
        .filter(e => e.Kind === kind && (opts.exact ? e.Key === key : contains(words, e.Key)))
        .sort((a, b) => b.Key.length - a.Key.length || b.Count - a.Count);
}

/** Jedan jasan pogodak: najduža riječ, ako ne postoji druga iste dužine s drugim ciljem. */
export function bestVocab(text: string, entries: VocabEntry[], kind: VocabKind, opts: { exact?: boolean } = {}): VocabEntry | null {
    const hits = findVocab(text, entries, kind, opts);
    if (!hits.length) return null;
    const top = hits.filter(h => h.Key.length === hits[0].Key.length);
    return new Set(top.map(h => h.Target_ID)).size === 1 ? hits[0] : null;
}

/** „zovem i: Jerko, kod Ane" za liniju projekta/naloga/radnika u promptu. */
export function aliasesOf(entries: VocabEntry[], kind: VocabKind, targetId: string): string[] {
    return Array.from(new Set(entries.filter(e => e.Kind === kind && e.Target_ID === targetId).map(e => e.Phrase))).slice(0, 6);
}
