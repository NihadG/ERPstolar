// ════════════════════════════════════════════════════════════════════
// BILJEŽNICA — pravila koja odlučuje ERP, ne model (čista logika)
//
// Model iz poruke izvuče predmet, količinu, mjeru i lokaciju kako su rečeni
// i jedno od fiksnih stanja. ERP od toga složi sve ostalo, isto svaki put:
//   • lokacija: „e004", „stan 308", „hodnik e4" → E004, E308, Hodnik E4
//     (slovo zgrade iz već poznatih lokacija; nejasno → pitanje s opcijama),
//   • mjere: „1000 x 1350", „100 puta 135", „800 mm širine" → 1000x1350, š 800,
//   • naslov: predmet + mjere (+ „za C502") — naslov i mjera se ne mogu razići,
//   • stanje: fiksna lista; „postavljeno" zatvara stavku,
//   • koje stavke idu u prompt: one o kojima poruka govori + zadnje dirane.
// jest: lib/__tests__/memoryRules.test.ts
// ════════════════════════════════════════════════════════════════════

import { foldText, stem, tokens } from '@/lib/voice/text';
import type { MemoryItem } from '@/lib/types';

// ─── Stanja ───────────────────────────────────────────────────────────

export const MEMORY_STATES = {
    fali: { label: 'fali', resolved: false },
    nije_postavljeno: { label: 'u stanu, nije postavljeno', resolved: false },
    pogresno: { label: 'pogrešno postavljeno', resolved: false },
    ceka: { label: 'čeka postavljanje', resolved: false },
    naruceno: { label: 'naručeno', resolved: false },
    stiglo: { label: 'stiglo', resolved: false },
    postavljeno: { label: 'postavljeno', resolved: true },
    info: { label: 'zabilješka', resolved: false },
} as const;
export type MemoryStateKey = keyof typeof MEMORY_STATES;
export const MEMORY_STATE_KEYS = Object.keys(MEMORY_STATES) as MemoryStateKey[];

export function isStateKey(v: unknown): v is MemoryStateKey {
    return typeof v === 'string' && v in MEMORY_STATES;
}

/** Prikaz stanja: fiksni naziv, uz kratku dopunu ako je rečena („treba 1100x1000"). */
export function stateLabel(key: MemoryStateKey, note?: string): string {
    const n = (note || '').trim();
    if (key === 'info') return n || MEMORY_STATES.info.label;
    return n ? `${MEMORY_STATES[key].label}, ${n}` : MEMORY_STATES[key].label;
}

// ─── Mjere ────────────────────────────────────────────────────────────

const NUM = '(\\d{2,4})';
const PAIR = new RegExp(`${NUM}\\s*(?:x|×|\\*|puta|na)\\s*${NUM}`);
const WIDTH = new RegExp(`(?:sirok\\w*|sirin\\w*)\\D{0,12}${NUM}|${NUM}\\s*(?:mm|milimet\\w*|cm|centimet\\w*)?\\s*(?:sirin\\w*|sirok\\w*)`);

/**
 * Mjere iz opisa kako je rečen. Dva broja ispod 400 su centimetri („100 puta 135"
 * → 1000x1350). Vraća i ostatak opisa bez mjera („sva", „gornje").
 */
export function parseDimensions(spec: string | undefined): { dims?: string; rest: string } {
    const raw = (spec || '').trim();
    if (!raw) return { rest: '' };
    const f = foldText(raw.replace(/[×✕]/g, 'x')).replace(/,/g, '.');
    const pair = f.match(PAIR);
    if (pair) {
        let [a, b] = [Number(pair[1]), Number(pair[2])];
        if (a < 400 && b < 400) { a *= 10; b *= 10; }
        return { dims: `${a}x${b}`, rest: cleanRest(f.replace(pair[0], '')) };
    }
    const w = f.match(WIDTH);
    if (w) {
        let n = Number(w[1] || w[2]);
        if (n < 400) n *= 10; // centimetri
        return { dims: `š ${n}`, rest: cleanRest(f.replace(w[0], '')) };
    }
    return { rest: raw };
}

function cleanRest(s: string): string {
    return s.replace(/\b(mm|cm|milimet\w*|centimet\w*|dimenzij\w*|mjer\w*)\b/g, ' ')
        .replace(/[()]/g, ' ').replace(/\s+/g, ' ').replace(/^[\s,.-]+|[\s,.-]+$/g, '').trim();
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Naslov stavke: predmet + mjere (+ za koji stan je namijenjeno). */
export function memoryTitle(subject: string, dims?: string, forLocation?: string): string {
    return [cap(subject.trim()), dims, forLocation ? `za ${forLocation}` : ''].filter(Boolean).join(' ');
}

// ─── Lokacije ─────────────────────────────────────────────────────────

interface LocParts { kind: '' | 'Hodnik' | 'Ulaz'; letter: string; digits: string; other: boolean }

function parseLoc(raw: string): LocParts | null {
    const f = foldText(raw);
    const kind: LocParts['kind'] = /hodnik/.test(f) ? 'Hodnik' : /ulaz/.test(f) ? 'Ulaz' : '';
    const stripped = f.replace(/\b(stan\w*|hodnik\w*|ulaz\w*|na|u|kod|zgrad\w*|lamel\w*)\b/g, ' ');
    const m = stripped.match(/(?:^|[^a-z0-9])([a-z])?\s*-?\s*(\d{1,4})(?![0-9])/);
    if (!m) return null;
    // Ostale riječi uz broj („radionica 2") — to nije šifra stana.
    const other = /[a-z]{2,}/.test(stripped.replace(m[0], ' '));
    return { kind, letter: (m[1] || '').toUpperCase(), digits: m[2], other };
}

const format = (p: LocParts) => `${p.kind ? `${p.kind} ` : ''}${p.letter}${p.digits}`;

export type LocationResult = { location: string } | { ambiguous: string[] };

/**
 * Lokacija kako je rečena → oblik koji već postoji u bilježnici. Bez slova zgrade:
 * isti broj na tačno jednoj poznatoj lokaciji, ili jedino slovo među poznatim
 * lokacijama iste vrste s istim prvim brojem (E302, E303 → „308" je E308).
 * Više mogućnosti → pitanje. Lokacija bez broja („kombi") ostaje, s velikim slovom.
 */
export function normalizeLocation(raw: string | undefined, known: string[]): LocationResult {
    const s = (raw || '').trim();
    if (!s) return { location: '' };
    const p = parseLoc(s);
    if (!p || p.other) return { location: cap(s) };
    if (p.letter) return { location: format(p) };

    const parsed = Array.from(new Set(known)).map(parseLoc).filter((x): x is LocParts => !!x && !!x.letter && x.kind === p.kind);
    const same = Array.from(new Set(parsed.filter(x => x.digits === p.digits).map(format)));
    if (same.length === 1) return { location: same[0] };
    if (same.length > 1) return { ambiguous: same };
    const letters = Array.from(new Set(parsed
        .filter(x => x.digits.length === p.digits.length && x.digits[0] === p.digits[0])
        .map(x => x.letter)));
    if (letters.length === 1) return { location: format({ ...p, letter: letters[0] }) };
    if (letters.length > 1) return { ambiguous: letters.map(l => format({ ...p, letter: l })) };
    return { location: p.kind ? format(p) : `Stan ${p.digits}` };
}

/** Ključ lokacije za poređenje („Stan E004" i „E004" su ista lokacija). */
export function locationKey(loc: string | undefined): string {
    const p = parseLoc(loc || '');
    return p ? `${p.kind}|${p.letter}${p.digits}` : foldText(loc || '');
}

// ─── Koje stavke idu u prompt ─────────────────────────────────────────

/**
 * Bilježnica raste, a svaka poruka bi inače nosila sve otvorene stavke. U prompt ide
 * ono o čemu poruka govori (ista lokacija ili predmet) i nekoliko zadnje diranih
 * (za „još jedno na istom hodniku"); ostalo se nađe pretragom (search_memory).
 */
export function relevantMemory<T extends { value: MemoryItem }>(items: T[], text: string, opts: { recent?: number; max?: number; all?: number } = {}): T[] {
    const { recent = 12, max = 60, all = 40 } = opts;
    if (items.length <= all) return items;
    const f = foldText(text);
    const locs = new Set<string>();
    for (const m of Array.from(f.matchAll(/(?:^|[^a-z0-9])([a-z]?\s?-?\d{1,4})(?![0-9])/g))) {
        const p = parseLoc(m[1]);
        if (p) locs.add(p.letter ? `${p.letter}${p.digits}` : p.digits);
    }
    const words = tokens(f).filter(w => w.length >= 4).map(stem);
    const hit = (m: MemoryItem) => {
        const p = parseLoc(m.Location || '');
        if (p && (locs.has(`${p.letter}${p.digits}`) || locs.has(p.digits))) return true;
        const hay = tokens(foldText(`${m.Subject} ${m.Title}`)).map(stem);
        return words.some(w => hay.includes(w));
    };
    const chosen = new Set<T>(items.filter(x => hit(x.value)).slice(0, max));
    [...items].sort((a, b) => b.value.Updated_At.localeCompare(a.value.Updated_At)).slice(0, recent).forEach(x => chosen.add(x));
    return items.filter(x => chosen.has(x));
}
