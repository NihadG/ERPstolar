// ════════════════════════════════════════════════════════════════════
// KOLONE IZ RIJEČI — šta korisnik misli pod „stan ogledalo/umivaonik" (čisto)
//
// Riječ korisnika je objašnjena poljem kad je:
//   • NAZIV polja („dimenzije" → mjere, „komada" → količina), ili
//   • VRIJEDNOST polja u podacima („fali", „nije montirano" → stanje;
//     „ogledalo/umivaonik" → predmet) — rječnik vrijednosti se gradi iz
//     same baze, pa radi i za riječi koje niko nije predvidio.
// Dio poruke je kolona kad JEDNO polje objasni sve njegove riječi. Kad ne može,
// dio se cijepa na riječima („stan ogledalo/umivaonik" → stan + predmet).
// Ništa ne nestaje tiho: što nije objašnjeno vraća se kao nepoznato.
// jest: lib/__tests__/botTables.test.ts
// ════════════════════════════════════════════════════════════════════

import { foldText, stem } from '@/lib/voice/text';

/** Polje kakvo treba prepoznavanju (podskup FieldDef iz lib/tables/engine). */
export interface NamedField<R> {
    key: string;
    label: string;
    /** Nazivi polja kao početak riječi, bez kvačica („dimenz", „od koga"). */
    words: string[];
    /** Tekst vrijednosti polja — iz njega se gradi rječnik vrijednosti. */
    vocab?: (row: R) => string;
    /** Vrijednosti koje polje može imati i kad ih u podacima još nema (sva stanja, traženi predmeti). */
    fixedVocab?: string;
}

/** Riječi koje ne nose značenje kolone („ima u stanu" → stanu). */
const STOP = new Set(['u', 'na', 'i', 'a', 'ili', 'ne', 'sa', 's', 'za', 'od', 'do', 'po', 'je', 'su', 'ima', 'imam', 'nema', 'nije', 'da', 'li', 'se', 'sve', 'svih', 'svi', 'sta', 'koji', 'koja', 'koje', 'kako', 'mi', 'me', 'kolona', 'kolone', 'kolonu']);

const norm = (w: string) => stem(foldText(w).replace(/[^a-z0-9]/g, ''));

export type Vocab = Map<string, Set<string>>;

/** Rječnik vrijednosti po polju: osnovni oblici riječi iz podataka (bez brojeva i veznika). */
export function buildVocab<R>(fields: NamedField<R>[], rows: R[]): Vocab {
    const out: Vocab = new Map();
    for (const f of fields) {
        if (!f.vocab && !f.fixedVocab) continue;
        const set = new Set<string>();
        const add = (text: string) => {
            for (const t of foldText(text || '').split(/[\s.,;/()-]+/)) {
                if (t.length < 3 || /\d/.test(t) || STOP.has(t)) continue;
                set.add(stem(t));
            }
        };
        if (f.fixedVocab) add(f.fixedVocab);
        if (f.vocab) for (const r of rows) add(f.vocab(r));
        out.set(f.key, set);
    }
    return out;
}

interface Word {
    /** Riječ kako je napisana (za zaglavlje). */
    raw: string;
    /** Osnovni oblici dijelova („fali/nije" → fal, nij). */
    parts: string[];
    /** Isti dijelovi bez kvačica, prije osnovnog oblika — za veznike („nije", ne „nij"). */
    plain: string[];
}

function wordsOf(chunk: string): Word[] {
    // „fali / nije montirano" je isto što i „fali/nije montirano".
    return chunk.replace(/\s*\/\s*/g, '/').split(/\s+/).filter(Boolean).map(raw => {
        const plain = raw.split('/').map(p => foldText(p).replace(/[^a-z0-9]/g, '')).filter(Boolean);
        return { raw, plain, parts: plain.map(stem) };
    });
}

const isContent = (plain: string) => plain.length > 1 && !STOP.has(plain);

/** Koje polje NAZIVOM objašnjava dio riječi: najduži pogođen naziv (stanje ≠ stan). */
function nameFields<R>(part: string, fields: NamedField<R>[]): Set<string> {
    let best = 0;
    let keys = new Set<string>();
    for (const f of fields) {
        for (const raw of f.words) {
            if (raw.includes(' ')) continue;
            const syn = stem(raw);
            if (part.startsWith(syn) && syn.length >= best) {
                if (syn.length > best) keys = new Set();
                best = syn.length;
                keys.add(f.key);
            }
        }
    }
    return keys;
}

/** Nazivi od više riječi („na stanju", „od koga"): dijelovi koje pokrivaju. */
function phraseHits<R>(parts: string[], fields: NamedField<R>[]): Map<number, string> {
    const hits = new Map<number, string>();
    for (const f of fields) {
        for (const syn of f.words) {
            const toks = syn.split(' ').map(stem);
            if (toks.length < 2) continue;
            for (let i = 0; i + toks.length <= parts.length; i++) {
                if (toks.every((t, j) => parts[i + j].startsWith(t))) toks.forEach((_, j) => hits.set(i + j, f.key));
            }
        }
    }
    return hits;
}

/**
 * Jedno polje koje objašnjava sve riječi dijela, s bodovima dokaza; null kad ga nema.
 * Naziv od više riječi 3, naziv 2, vrijednost 1 — a vrijednost koja je ujedno naziv
 * DRUGOG polja samo 0,5 („stan" je kolona stana, iako „u stanu" piše u stanju).
 */
function wholeField<R>(words: Word[], fields: NamedField<R>[], vocab: Vocab): { key: string; score: number } | null {
    const parts = words.flatMap(w => w.parts);
    const plain = words.flatMap(w => w.plain);
    const phrase = phraseHits(parts, fields);
    const content = parts.map((p, i) => ({ p, i })).filter(x => isContent(plain[x.i]));
    if (!content.length) return null;
    let best: { key: string; score: number } | null = null;
    for (const f of fields) {
        let score = 0;
        let all = true;
        for (const { p, i } of content) {
            const names = phrase.has(i) ? new Set([phrase.get(i)!]) : nameFields(p, fields);
            if (phrase.get(i) === f.key) score += 3;
            else if (!phrase.has(i) && names.has(f.key)) score += 2;
            else if (vocab.get(f.key)?.has(p)) score += names.size ? 0.5 : 1;
            else { all = false; break; }
        }
        if (all && (!best || score > best.score)) best = { key: f.key, score };
    }
    return best;
}

/** Granice koje se ne smiju presjeći: unutar naziva od više riječi („za | naručiti"). */
function phraseBoundaries<R>(words: Word[], fields: NamedField<R>[]): Set<number> {
    const wordOf: number[] = words.flatMap((w, wi) => w.parts.map(() => wi));
    const hits = phraseHits(words.flatMap(w => w.parts), fields);
    const blocked = new Set<number>();
    const idx = Array.from(hits.keys()).sort((a, b) => a - b);
    for (let k = 1; k < idx.length; k++) {
        if (idx[k] === idx[k - 1] + 1 && hits.get(idx[k]) === hits.get(idx[k - 1]) && wordOf[idx[k]] !== wordOf[idx[k - 1]]) blocked.add(wordOf[idx[k]]);
    }
    return blocked;
}

export interface ResolvedColumn {
    key: string;
    /** Zaglavlje: riječi korisnika („Umivaonik/ogledalo"), a naziv polja kad je ista riječ. */
    label: string;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function labelFor<R>(raw: string, field: NamedField<R>): string {
    const clean = raw.replace(/[()]/g, '').replace(/\s+/g, ' ').trim();
    return foldText(clean) === foldText(field.label) ? field.label : cap(clean);
}

type Piece = { column: ResolvedColumn } | { unknown: string };

const UNKNOWN_COST = 10;
const SEGMENT_COST = 1;

/**
 * Dio poruke → kolone razlaganjem koje najbolje objasni riječi: najviše bodova dokaza
 * (wholeField), neprepoznata riječ −10, svaki dio −1 — pa „stan ogledalo umivaonik
 * dimenzije" → stan | ogledalo umivaonik | dimenzije. Granica ne pada iza veznika
 * („…/ima | u stanu", „materijal za | naručiti") ni unutar naziva od više riječi.
 * Neprepoznata riječ ne ruši ostale — vraća se kao nepoznata.
 */
function resolveChunk<R>(words: Word[], fields: NamedField<R>[], vocab: Vocab): Piece[] {
    const n = words.length;
    const blocked = phraseBoundaries(words, fields);
    // Granica prije riječi j: zadnji dio prethodne riječi nosi značenje i nije unutar naziva.
    const canCut = (j: number) => j === 0 || j === n || (isContent(words[j - 1].plain[words[j - 1].plain.length - 1] || '') && !blocked.has(j));
    const best: { score: number; pieces: Piece[] }[] = Array(n + 1);
    best[n] = { score: 0, pieces: [] };
    for (let i = n - 1; i >= 0; i--) {
        const rest = best[i + 1];
        const content = words[i].plain.some(isContent);
        let pick = { score: rest.score - (content ? UNKNOWN_COST : 0), pieces: content ? [{ unknown: words[i].raw } as Piece, ...rest.pieces] : rest.pieces };
        if (!canCut(i)) {
            best[i] = { score: -Infinity, pieces: [] };
            continue;
        }
        for (let j = n; j > i; j--) {
            if (!canCut(j)) continue;
            const hit = wholeField(words.slice(i, j), fields, vocab);
            if (!hit || best[j].score === -Infinity) continue;
            const score = best[j].score + hit.score - SEGMENT_COST;
            if (score > pick.score) {
                pick = { score, pieces: [{ column: { key: hit.key, label: labelFor(words.slice(i, j).map(w => w.raw).join(' '), fields.find(f => f.key === hit.key)!) } }, ...best[j].pieces] };
            }
        }
        best[i] = pick;
    }
    // Susjedne neprepoznate riječi su jedan nepoznat dio („boja okvira").
    const out: Piece[] = [];
    for (const p of (best[0].score === -Infinity ? [{ unknown: words.map(w => w.raw).join(" ") } as Piece] : best[0].pieces)) {
        const last = out[out.length - 1];
        if ('unknown' in p && last && 'unknown' in last) last.unknown = `${last.unknown} ${p.unknown}`;
        else out.push({ ...p });
    }
    return out;
}

export interface ColumnResolution {
    columns: ResolvedColumn[];
    unknown: string[];
}

/** Nabrojani dijelovi → kolone (svako polje jednom) i ono što nije prepoznato. */
export function resolveColumns<R>(chunks: string[], fields: NamedField<R>[], vocab: Vocab): ColumnResolution {
    const columns: ResolvedColumn[] = [];
    const unknown: string[] = [];
    for (const chunk of chunks) {
        const words = wordsOf(chunk);
        if (!words.some(w => w.plain.some(isContent))) continue;
        for (const p of resolveChunk(words, fields, vocab)) {
            if ('unknown' in p) unknown.push(p.unknown);
            else if (!columns.some(x => x.key === p.column.key)) columns.push(p.column);
        }
    }
    return { columns, unknown };
}

/** Jedno polje po riječima (filter, grupisanje, sortiranje): „stan", „dobavljač". */
export function resolveField<R>(said: string, fields: NamedField<R>[], vocab: Vocab): string | null {
    const exact = fields.find(f => f.key === said);
    if (exact) return exact.key;
    return (wholeField(wordsOf(said), fields, new Map()) || wholeField(wordsOf(said), fields, vocab))?.key ?? null;
}

// ─── Gdje je u poruci nabrajanje kolona ───────────────────────────────

const CLAUSE = /(?:kolon\w*|u tabel\w*|tabel\w*\s+(?:sa|s)\s|polj\w*)\s*(?:su\s|:|-)?\s*([^.?!\n]+)/i;
const TAIL = /\s+(?:ili\s+(?:sta|šta)\s+god|i\s+tako|itd|i\s+slicno|i\s+slično)\b.*$/i;

/**
 * Nabrojane kolone iz poruke: „u kolonama stan, umivaonik/ogledalo, dimenzije" →
 * ["stan", "umivaonik/ogledalo", "dimenzije"]. Zarez nije obavezan — dio bez
 * zareza („stan ogledalo/umivaonik") cijepa resolveColumns. Nema „kolona" → [].
 */
export function requestedColumns(text: string): string[] {
    const m = CLAUSE.exec(text || '');
    if (!m) return [];
    let list = m[1];
    if (list.includes(':')) list = list.slice(list.lastIndexOf(':') + 1);
    list = list.replace(TAIL, '');
    return list
        .split(/[,;]|\s+i\s+|\s+te\s+|\s+pa\s+/)
        .map(s => s.trim().replace(/^(i|a|pa)\s+/i, '').replace(/\s+/g, ' '))
        .filter(Boolean);
}
