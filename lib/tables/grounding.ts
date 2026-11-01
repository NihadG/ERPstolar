// ════════════════════════════════════════════════════════════════════
// REČENO U RAZGOVORU — filter tabele smije sadržati samo ono što je rečeno (čisto)
//
// Model zna dodati filter koji niko nije tražio („umivaonik" za „šta trebam
// kod Anesa provjeriti") ili proširiti stanje („sve stavke" za „ne piše fali").
// ERP to provjeri: vrijednost filtera mora biti u poruci (ili u zadnje dvije),
// stanje drugačije od podrazumijevanog samo uz riječi tog stanja.
// jest: lib/__tests__/botTables.test.ts
// ════════════════════════════════════════════════════════════════════

import { foldText, stem } from '@/lib/voice/text';

const tokensOf = (text: string) => foldText(text).split(/[\s.,;/()-]+/).filter(Boolean);

/**
 * Vrijednost je rečena: svaka njena riječ (osnovni oblik, od 3 slova) je početak neke
 * riječi razgovora ili obrnuto. Lamela („E") i šifra stana („E308", „e 308") posebno.
 */
export function saidIn(text: string): (value: string) => boolean {
    const folded = foldText(text);
    const toks = tokensOf(text).map(stem);
    const compact = folded.replace(/\s+/g, '');
    return (value: string) => {
        const v = foldText(value).trim();
        if (!v) return true;
        if (/^[a-z]$/.test(v)) return new RegExp(`(^|[^a-z])${v}(\\s?-?\\d|\\s+lamel|\\s*$|[^a-z])`).test(folded);
        if (/^[a-z]?\s?-?\d{1,4}$/.test(v)) return compact.includes(v.replace(/[\s-]/g, ''));
        const want = tokensOf(v).filter(w => w.length >= 3).map(stem);
        if (!want.length) return true;
        return want.every(w => toks.some(t => t.startsWith(w) || (t.length >= 4 && w.startsWith(t))));
    };
}

/** Riječi po kojima je rečeno stanje bilježnice drugačije od „nije postavljeno". */
const NOTEBOOK_STATE: Record<string, RegExp> = {
    postavljeno: /postavljen|montiran|gotov|zavrsen|rijesen|zatvoren|ugradjen/,
    sve: /\b(sve stavke|sva stanja|i postavljen\w*|i montiran\w*|i gotov\w*|bez obzira|svejedno|zatvoren\w* i otvoren\w*|i zatvoren\w*)/,
    fali: /\bfal[ie]\b|\bnema\b|nedostaj/,
    nije_postavljeno: /nije postavljen|nije montiran|nisu postavljen|nisu montiran|u stanu/,
    pogresno: /pogresn/,
    ceka: /\bcek/,
    naruceno: /(?<!ne)narucen/,
    stiglo: /stigl|doslo|dostavljen/,
    info: /zabiljesk|biljesk|informacij/,
};

/** Stanje materijala drugačije od „za naručiti". */
const MATERIAL_STATUS: Record<string, RegExp> = {
    naruceno: /(?<!ne)narucen|\bcek|na putu|stize/,
    stiglo: /stigl|primljen|doslo|zaprimljen/,
    sve: /\bsve materijal|\bsvi materijal|cijel\w* sastavnic|\bsastavnic|ukupno potrebn|\bpotrebn/,
};

/**
 * Stanje kako ga je model poslao, ako je rečeno; inače podrazumijevano i napomena
 * zašto (korisnik vidi da je ERP odbio filter, umjesto da tabela tiho promijeni sadržaj).
 */
export function groundedScope(kind: 'biljeska' | 'materijali', wanted: string, fallback: string, text: string): { value: string; note?: string } {
    if (!wanted || wanted === fallback) return { value: fallback };
    const re = (kind === 'biljeska' ? NOTEBOOK_STATE : MATERIAL_STATUS)[wanted];
    if (re && re.test(foldText(text))) return { value: wanted };
    return { value: fallback, note: `Stanje „${wanted.replace('_', ' ')}" nije rečeno — prikazano podrazumijevano.` };
}
