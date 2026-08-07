// ════════════════════════════════════════════════════════════════════
// PLATNO — PRAVILA („Problemi")
//
// Sve su ovo PROVJERLJIVE ČINJENICE, ne procjene: „materijal stiže 3 dana poslije
// starta", „radnik je tad na godišnjem". Ništa se ne predviđa.
//
// Zašto je ovo u doku uvijek vidljivo: planerske table umiru kad prestanu davati
// dnevni izlaz. Lista problema i „naruči danas" su razlog da se platno otvori.
// ════════════════════════════════════════════════════════════════════

import type {
    PlanScenario, PlanBlock, Worker, WorkOrder, WorkerAttendance, Project,
} from '../types';
import { addDays, diffDays, isWorkDay } from './model';

export type ConflictKind =
    | 'material-late'       // dostava poslije starta proizvodnje
    | 'order-overdue'       // rok slanja narudžbe je prošao
    | 'worker-overbooked'   // radnik na dva posla isti dan (uklj. stvarne naloge)
    | 'worker-absent'       // godišnji/bolovanje unutar raspona
    | 'montaza-early'       // montaža prije kraja proizvodnje
    | 'deadline-missed'     // kraj poslije roka projekta
    | 'nonworking-day'      // blok počinje neradnim danom
    | 'orphan-production';  // proizvodnja bez ijedne vezane narudžbe

export type ConflictSeverity = 'error' | 'warning';

/** Rješenje jednim klikom koje pozivalac primijeni (dispatch u reducer / otvori modal). */
export type ConflictFix =
    | { type: 'shift-block'; blockId: string; days: number }   // pomjeri blok za N dana (± )
    | { type: 'create-orders'; blockId: string };              // otvori „Napravi narudžbe" za nalog

export interface Conflict {
    id: string;
    kind: ConflictKind;
    severity: ConflictSeverity;
    message: string;
    /** Za skok na platno. */
    blockIds: string[];
    dateISO?: string;
    /** Ponuđeno rješenje jednim klikom (kad postoji smisleno). */
    fix?: ConflictFix & { label: string };
}

export interface ConflictContext {
    workers: Worker[];
    /** Stvarni nalozi — prebukiranost se mjeri PROTIV njih, inače je plan lažan. */
    workOrders: WorkOrder[];
    attendance: WorkerAttendance[];
    projects: Project[];
    todayISO: string;
    isSaturdayWorking?: (d: Date) => boolean;
}

const ABSENT = new Set(['Odsutan', 'Bolovanje', 'Odmor']);
const WORK_KINDS = new Set<PlanBlock['kind']>(['order', 'montaza', 'transport']);

/** Preklapaju li se dva raspona (uključivo). */
function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
    return aStart <= bEnd && bStart <= aEnd;
}

/** Datumi u rasponu, uključivo. Ograničeno da neispravan blok ne obori platno. */
function datesBetween(startISO: string, endISO: string, cap = 400): string[] {
    const out: string[] = [];
    let cur = startISO;
    for (let i = 0; i <= cap && cur <= endISO; i++) {
        out.push(cur);
        cur = addDays(cur, 1);
    }
    return out;
}

export function detectConflicts(scenario: PlanScenario, ctx: ConflictContext): Conflict[] {
    const conflicts: Conflict[] = [];
    const blocks = scenario.Blocks;
    const byId = new Map(blocks.map(b => [b.id, b]));
    const push = (c: Conflict) => conflicts.push(c);

    // ── 1. Materijal stiže poslije starta proizvodnje ────────────
    // Materijal koji stigne NA DAN starta je stigao na vrijeme.
    for (const link of scenario.Links) {
        if (link.kind !== 'delivery-to-start') continue;
        const purchase = byId.get(link.from);
        const work = byId.get(link.to);
        if (!purchase || !work) continue;
        if (purchase.endISO > work.startISO) {
            const late = diffDays(work.startISO, purchase.endISO);
            push({
                id: `material-late:${link.id}`,
                kind: 'material-late',
                severity: 'error',
                message: `„${purchase.title}" stiže ${late} ${late === 1 ? 'dan' : 'dana'} poslije starta „${work.title}"`,
                blockIds: [purchase.id, work.id],
                dateISO: purchase.endISO,
                // Rješenje: pomjeri narudžbu ranije toliko da dostava padne na start proizvodnje.
                fix: purchase.locked ? undefined
                    : { type: 'shift-block', blockId: purchase.id, days: -late, label: 'Pomjeri narudžbu ranije' },
            });
        }
    }

    // ── 2. (Uklonjeno iz „Problemi") Rok slanja narudžbe ─────────
    // „Narudžba je trebala otići prije X dana" je operativni signal spram DANAS, ne
    // planerski konflikt — pri planiranju budućeg posla samo stvara buku. Živi u tabu
    // „Naruči danas" (ordersDueSoon), gdje mu je mjesto. Ovdje se namjerno ne prijavljuje.

    // ── 3. Prebukiran radnik ─────────────────────────────────────
    // Računa se i STVARNI preuzeti posao — plan koji ga ignoriše je samoobmana.
    const realByWorker = new Map<string, { label: string; start: string; end: string }[]>();
    for (const wo of ctx.workOrders) {
        if (wo.Status === 'Završeno' || wo.Status === 'Otkazano') continue;
        const start = (wo.Started_At || wo.Planned_Start_Date || '').split('T')[0];
        const end = (wo.Due_Date || wo.Planned_End_Date || start).split('T')[0];
        if (!start) continue;
        const ids = new Set<string>();
        for (const item of wo.items || []) {
            (item.Assigned_Workers || []).forEach(w => w.Worker_ID && ids.add(w.Worker_ID));
            (item.Processes || []).forEach(p => {
                if (p.Worker_ID) ids.add(p.Worker_ID);
                (p.Helpers || []).forEach(h => h.Worker_ID && ids.add(h.Worker_ID));
            });
        }
        for (const id of ids) {
            const arr = realByWorker.get(id) || [];
            arr.push({ label: wo.Name?.trim() || wo.Work_Order_Number, start, end: end < start ? start : end });
            realByWorker.set(id, arr);
        }
    }

    const workBlocks = blocks.filter(b => WORK_KINDS.has(b.kind) && (b.workerRefs?.length || 0) > 0);
    const seenPair = new Set<string>();

    for (let i = 0; i < workBlocks.length; i++) {
        for (let j = i + 1; j < workBlocks.length; j++) {
            const a = workBlocks[i];
            const b = workBlocks[j];
            if (!overlaps(a.startISO, a.endISO, b.startISO, b.endISO)) continue;
            const shared = (a.workerRefs || []).filter(x =>
                x.id && (b.workerRefs || []).some(y => y.id === x.id));
            for (const w of shared) {
                const key = `${[a.id, b.id].sort().join('|')}:${w.id}`;
                if (seenPair.has(key)) continue;
                seenPair.add(key);
                push({
                    id: `overbooked:${key}`,
                    kind: 'worker-overbooked',
                    severity: 'warning',
                    message: `${w.name} je istovremeno na „${a.title}" i „${b.title}"`,
                    blockIds: [a.id, b.id],
                    dateISO: a.startISO > b.startISO ? a.startISO : b.startISO,
                });
            }
        }
    }

    for (const b of workBlocks) {
        for (const w of b.workerRefs || []) {
            if (!w.id) continue;
            for (const real of realByWorker.get(w.id) || []) {
                if (!overlaps(b.startISO, b.endISO, real.start, real.end)) continue;
                push({
                    id: `overbooked-real:${b.id}:${w.id}:${real.start}`,
                    kind: 'worker-overbooked',
                    severity: 'error',
                    message: `${w.name} je već na stvarnom nalogu „${real.label}" u tom periodu`,
                    blockIds: [b.id],
                    dateISO: real.start,
                });
            }
        }
    }

    // ── 4. Radnik odsutan (šihtarica) ────────────────────────────
    const absentByWorker = new Map<string, Map<string, string>>();
    for (const a of ctx.attendance) {
        if (!a.Worker_ID || !a.Date || !ABSENT.has(a.Status)) continue;
        const m = absentByWorker.get(a.Worker_ID) || new Map<string, string>();
        m.set(a.Date, a.Status);
        absentByWorker.set(a.Worker_ID, m);
    }

    for (const b of workBlocks) {
        for (const w of b.workerRefs || []) {
            if (!w.id) continue;
            const absent = absentByWorker.get(w.id);
            if (!absent) continue;
            const hits = datesBetween(b.startISO, b.endISO).filter(d => absent.has(d));
            if (hits.length === 0) continue;
            push({
                id: `absent:${b.id}:${w.id}`,
                kind: 'worker-absent',
                severity: 'warning',
                message: `${w.name}: ${absent.get(hits[0])} ${hits.length > 1 ? `(${hits.length} dana)` : `(${hits[0]})`} tokom „${b.title}"`,
                blockIds: [b.id],
                dateISO: hits[0],
            });
        }
    }

    // ── 5. Montaža prije kraja proizvodnje ───────────────────────
    for (const link of scenario.Links) {
        if (link.kind !== 'finish-to-montaza') continue;
        const work = byId.get(link.from);
        const montaza = byId.get(link.to);
        if (!work || !montaza) continue;
        if (montaza.startISO <= work.endISO) {
            // Rješenje: pomjeri montažu da počne dan poslije kraja proizvodnje.
            const shift = diffDays(montaza.startISO, work.endISO) + 1;
            push({
                id: `montaza-early:${link.id}`,
                kind: 'montaza-early',
                severity: 'error',
                message: `„${montaza.title}" počinje prije nego „${work.title}" završi`,
                blockIds: [work.id, montaza.id],
                dateISO: montaza.startISO,
                fix: montaza.locked ? undefined
                    : { type: 'shift-block', blockId: montaza.id, days: shift, label: 'Pomjeri montažu poslije proizvodnje' },
            });
        }
    }

    // ── 6. (Uklonjeno) Rok projekta ──────────────────────────────
    // Platno JE mjesto gdje se rokovi definišu — pa plan ne može „kasniti" spram
    // vanjskog datuma (roka iz projekta/ponude) koji korisnik tek sada raspoređuje.
    // Ako korisnik želi fiksnu tačku, stavi „Rok" (milestone) na platno i poveže lanac;
    // tada „Lanac" računa unazad. Poređenje sa `project.Deadline` je uklonjeno namjerno.

    // ── 7. Blok počinje neradnim danom ───────────────────────────
    for (const b of blocks) {
        if (!WORK_KINDS.has(b.kind)) continue;
        if (isWorkDay(b.startISO, ctx.isSaturdayWorking)) continue;
        push({
            id: `nonworking:${b.id}`,
            kind: 'nonworking-day',
            severity: 'warning',
            message: `„${b.title}" počinje neradnim danom (${b.startISO})`,
            blockIds: [b.id],
            dateISO: b.startISO,
        });
    }

    // ── 8. Proizvodnja bez ijedne vezane narudžbe ────────────────
    // Najtiši i najskuplji propust: sve izgleda uredno dok materijal ne zafali.
    const hasSupply = new Set<string>();
    for (const l of scenario.Links) {
        if (l.kind === 'delivery-to-start') hasSupply.add(l.to);
    }
    for (const b of blocks) {
        if (b.kind !== 'order' || hasSupply.has(b.id)) continue;
        push({
            id: `orphan:${b.id}`,
            kind: 'orphan-production',
            severity: 'warning',
            message: `„${b.title}" nema vezanu narudžbu materijala`,
            blockIds: [b.id],
            dateISO: b.startISO,
            // Rješenje: otvori „Napravi narudžbe iz sastavnice" za ovaj nalog.
            fix: (b.productRefs?.length || 0) > 0
                ? { type: 'create-orders', blockId: b.id, label: 'Napravi narudžbe' }
                : undefined,
        });
    }

    // Greške prije upozorenja, pa hronološki — najhitnije na vrh
    const rank = (c: Conflict) => (c.severity === 'error' ? 0 : 1);
    return conflicts.sort((a, b) =>
        rank(a) - rank(b)
        || (a.dateISO || '').localeCompare(b.dateISO || '')
        || a.id.localeCompare(b.id));
}

/**
 * „Naruči danas" — narudžbe kojima rok slanja ističe uskoro ili je prošao.
 * Ovo je dnevni operativni izlaz platna.
 */
export function ordersDueSoon(
    scenario: PlanScenario,
    todayISO: string,
    horizonDays = 3
): { block: PlanBlock; orderByISO: string; daysLeft: number }[] {
    return scenario.Blocks
        .filter(b => b.kind === 'purchase' && !b.isSent)
        .map(b => {
            const orderByISO = b.orderByISO || b.startISO;
            return { block: b, orderByISO, daysLeft: diffDays(todayISO, orderByISO) };
        })
        .filter(x => x.daysLeft <= horizonDays)
        .sort((a, b) => a.daysLeft - b.daysLeft);
}

export const CONFLICT_LABEL: Record<ConflictKind, string> = {
    'material-late': 'Materijal kasni',
    'order-overdue': 'Narudžba probila rok',
    'worker-overbooked': 'Radnik prebukiran',
    'worker-absent': 'Radnik odsutan',
    'montaza-early': 'Montaža prerano',
    'deadline-missed': 'Plan prelazi rok',
    'nonworking-day': 'Neradni dan',
    'orphan-production': 'Bez narudžbe',
};
