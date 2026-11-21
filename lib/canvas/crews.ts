// ════════════════════════════════════════════════════════════════════
// PLATNO — EKIPE I SUBOTNJE SMJENE (za prikaz)
//
// Radionica radi u PAROVIMA (glavni + pomoćnik), a par dijeli subotnju smjenu.
// Stari prikaz je imao sekciju „Radnici" s jednim redom po čovjeku — isti
// blokovi dvaput (po jednom za svakog iz para), bez para i bez smjene.
//
// Ovdje je jedinica reda EKIPA = skup radnika na nalogu (`workerRefs`), jer to
// je ono što zaista radi jedno po jedno. Smjena ekipe dolazi iz
// `Worker.Saturday_Anchor` (radnik radi tu subotu i svaku drugu).
//
// Slovo smjene (A/B) je STABILNO: parnost sedmice sidra od fiksnog datuma, ne
// „koja smjena radi prva od danas" (to bi se mijenjalo svake sedmice).
// ════════════════════════════════════════════════════════════════════

import type { PlanRef } from '../types';
import { shiftWorksSaturday, type WorkerShiftLite } from '../planning';
import { addDays, diffDays } from './model';

export type ShiftLetter = 'A' | 'B';
/** Smjena ekipe: A/B, „mix" kad su članovi u različitim smjenama, null bez smjene. */
export type CrewShift = ShiftLetter | 'mix' | null;

/** Subota od koje se broji parnost (smjena koja radi ovu subotu je A). */
export const SHIFT_EPOCH = '2026-01-03';

/** Slovo smjene za sidro (`Worker.Saturday_Anchor`). */
export function shiftLetterOf(anchorISO: string | undefined | null): ShiftLetter | null {
    if (!anchorISO) return null;
    const weeks = Math.round(diffDays(SHIFT_EPOCH, anchorISO) / 7);
    return ((weeks % 2) + 2) % 2 === 0 ? 'A' : 'B';
}

/** Sidro koje predstavlja smjenu — za računanje njenih radnih subota. */
export function shiftAnchor(letter: ShiftLetter): string {
    return letter === 'A' ? SHIFT_EPOCH : addDays(SHIFT_EPOCH, 7);
}

/** Sljedećih `count` radnih subota smjene, počev od `fromISO` (uključivo). */
export function shiftSaturdays(letter: ShiftLetter, fromISO: string, count = 3): string[] {
    const anchor = shiftAnchor(letter);
    const out: string[] = [];
    let cur = fromISO;
    for (let i = 0; i < 7 && new Date(`${cur}T12:00:00`).getDay() !== 6; i++) cur = addDays(cur, 1);
    for (let i = 0; i < 60 && out.length < count; i++, cur = addDays(cur, 7)) {
        if (shiftWorksSaturday(anchor, cur)) out.push(cur);
    }
    return out;
}

/** Ključ ekipe po SASTAVU (redoslijed ne mijenja ekipu). Prazno = bez radnika. */
export function crewKeyOf(refs: PlanRef[] | undefined): string {
    return (refs || []).map(r => r.id || `name:${r.name}`).sort().join('|');
}

/** Smjena ekipe iz smjena njenih članova. */
export function crewShift(refs: PlanRef[] | undefined, workersById: Map<string, WorkerShiftLite>): CrewShift {
    // Član bez smjene uz člana sa smjenom: ekipa se svrstava po onome ko je ima.
    const letters = new Set<ShiftLetter>();
    for (const r of refs || []) {
        const l = r.id ? shiftLetterOf(workersById.get(r.id)?.Saturday_Anchor) : null;
        if (l) letters.add(l);
    }
    if (letters.size === 0) return null;
    if (letters.size > 1) return 'mix';
    return Array.from(letters)[0];
}

/**
 * Kratka imena za ekipu: ime, a prezime (inicijal) samo kad dvoje dijele ime.
 * Ključ je Worker_ID; za ref bez id-a koristi se puno ime.
 */
export function shortNameMap(workers: { Worker_ID: string; Name: string }[]): Map<string, string> {
    const first = (n: string) => (n || '').trim().split(/\s+/)[0] || n;
    const count = new Map<string, number>();
    for (const w of workers) count.set(first(w.Name), (count.get(first(w.Name)) || 0) + 1);
    const out = new Map<string, string>();
    for (const w of workers) {
        const f = first(w.Name);
        const last = (w.Name || '').trim().split(/\s+/)[1];
        out.set(w.Worker_ID, (count.get(f) || 0) > 1 && last ? `${f} ${last[0]}.` : f);
    }
    return out;
}

/** Kratko ime jednog člana ekipe. */
export function shortNameOf(ref: PlanRef, names: Map<string, string>): string {
    return (ref.id && names.get(ref.id)) || (ref.name || '').trim().split(/\s+/)[0] || ref.name;
}

/** „Nedim + Aldin" — za tekst (tooltip, test); UI crta svako ime kao dugme. */
export function crewLabelShort(refs: PlanRef[] | undefined, names: Map<string, string>): string {
    const list = refs || [];
    return list.length ? list.map(r => shortNameOf(r, names)).join(' + ') : 'Bez ekipe';
}
