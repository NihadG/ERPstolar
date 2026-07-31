// ════════════════════════════════════════════════════════════════════
// PLATNO — BATCH UNOS (draft redova → blokovi)
//
// Čista logika iza full-screen tabele za brz unos ~50 naloga. Jedan red = jedan
// nalog. Tri vrste:
//   • proizvodni — bira stvarne proizvode (radnik-dani iz ponude),
//   • montaza    — slobodan naziv + ručni radnik-dani,
//   • razni      — slobodan naziv + ručni radnik-dani, bez proizvoda.
//
// KANONSKA JEDINICA je radnik-dan (= dani × radnici). Broj radnika iz ponude
// služi SAMO da se izvedu radnik-dani; ekipu IZVRŠENJA bira raspored, pa je
// trajanje = radnik-dani ÷ veličina izabrane ekipe. Prije rasporeda blok dobija
// NOMINALNU ekipu (veličina prve kandidat-ekipe, inače norma radionice) samo da
// traka ima smislenu širinu.
// ════════════════════════════════════════════════════════════════════

import { v4 as uuidv4 } from 'uuid';
import type {
    PlanBlock, PlanBlockKind, PlanCrew, PlanProductRef, PlanRef, TaskPriority,
} from '../types';
import { crewSize } from '../types';
import { DEFAULT_OFFER_CREW, type ProductCandidate } from './fromProducts';
import { newBlock, endFromWork } from './model';

export type BatchRowKind = 'proizvodni' | 'montaza' | 'razni';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Jedan izabrani proizvod u redu, s količinom i eventualnim ručnim ispravkama. */
export interface BatchProductPick {
    candidate: ProductCandidate;
    qty: number;
    /** Ručni broj radnika za `crewAssumed` proizvod (ponuda ima dane, nema radnike). */
    workersOverride?: number;
    /** Ručni radnik-dani po komadu (kad ponuda uopšte nema dane — `missingLabor`). */
    workerDaysPerUnitOverride?: number;
}

export interface BatchRow {
    id: string;                    // lokalni id reda (React key), NIJE id bloka
    kind: BatchRowKind;
    title?: string;                // montaza/razni; opcioni override za proizvodni
    products: BatchProductPick[];  // samo proizvodni
    projectRef?: PlanRef;          // montaza/razni mogu vezati projekt ručno
    manualWorkerDays?: number;     // montaza/razni
    priority?: TaskPriority;
    crewOptions: PlanCrew[];       // kandidat-ekipe za auto-raspored
}

export interface BatchToBlocksOpts {
    startISO: string;
    isSaturdayWorking?: (d: Date) => boolean;
}

// ── Fabrike ─────────────────────────────────────────────────────────

export function emptyBatchRow(kind: BatchRowKind = 'proizvodni'): BatchRow {
    return { id: uuidv4(), kind, products: [], crewOptions: [] };
}

export function newCrew(lead: PlanRef, helper?: PlanRef): PlanCrew {
    return { id: uuidv4(), lead, ...(helper ? { helper } : {}) };
}

// ── Radnik-dani ─────────────────────────────────────────────────────

/**
 * Radnik-dani po komadu za jedan izabrani proizvod, uzimajući u obzir ručne
 * ispravke. Redoslijed prednosti:
 *   1. ručni radnik-dani po komadu (za proizvod bez ijednog podatka u ponudi),
 *   2. `crewAssumed` proizvod × ručni/normirani broj radnika (dani × radnici),
 *   3. vrijednost iz kandidata (ponuda s poznatim brojem radnika).
 */
export function effectiveWorkerDaysPerUnit(pick: BatchProductPick): number {
    if (pick.workerDaysPerUnitOverride !== undefined && pick.workerDaysPerUnitOverride > 0) {
        return pick.workerDaysPerUnitOverride;
    }
    const c = pick.candidate;
    if (c.crewAssumed) {
        const workers = pick.workersOverride && pick.workersOverride >= 1
            ? pick.workersOverride
            : DEFAULT_OFFER_CREW;
        return c.laborDays * workers;
    }
    return c.workerDaysPerUnit;
}

/** Ukupni radnik-dani reda. */
export function rowWorkerDays(row: BatchRow): number {
    if (row.kind === 'proizvodni') {
        return round2(row.products.reduce(
            (s, p) => s + effectiveWorkerDaysPerUnit(p) * Math.max(1, p.qty), 0
        ));
    }
    return Math.max(0, row.manualWorkerDays || 0);
}

// ── Naziv i projekt ─────────────────────────────────────────────────

export function rowTitle(row: BatchRow): string {
    if (row.title?.trim()) return row.title.trim();
    if (row.kind === 'montaza') return 'Montaža';
    if (row.kind === 'razni') return 'Razni nalog';
    if (row.products.length === 1) return row.products[0].candidate.productName;
    if (row.products.length > 1) {
        const pr = deriveProjectRef(row);
        return pr ? `${pr.name} — ${row.products.length} proizvoda` : `${row.products.length} proizvoda`;
    }
    return 'Nalog';
}

/** Projekt reda: ručno postavljen, ili izveden kad su SVI proizvodi iz istog projekta. */
export function deriveProjectRef(row: BatchRow): PlanRef | undefined {
    if (row.projectRef) return row.projectRef;
    if (row.kind !== 'proizvodni' || row.products.length === 0) return undefined;
    const ids = new Set(row.products.map(p => p.candidate.projectId));
    if (ids.size !== 1) return undefined;
    const first = row.products[0].candidate;
    return { id: first.projectId, name: first.projectName };
}

// ── Validacija ──────────────────────────────────────────────────────

/** Red koji uopšte treba kreirati (prazni redovi se tiho preskaču, nisu greška). */
export function isRowFilled(row: BatchRow): boolean {
    if (row.kind === 'proizvodni') return row.products.length > 0;
    return !!row.title?.trim() || (row.manualWorkerDays || 0) > 0 || row.crewOptions.length > 0;
}

export type BatchRowWarning = 'no-worker-days' | 'crew-assumed' | 'no-crew';

/**
 * Nesmrtonosna upozorenja za popunjen red — prikaz u tabeli, ne blokiraju
 * kreiranje. `no-worker-days`: trajanje bi bilo nula. `crew-assumed`: bar jedan
 * proizvod ima dane bez broja radnika (uzeta norma). `no-crew`: nema kandidat-
 * ekipa, pa ga auto-raspored neće moći dodijeliti (ostaje ručni).
 */
export function rowWarnings(row: BatchRow): BatchRowWarning[] {
    const out: BatchRowWarning[] = [];
    if (rowWorkerDays(row) <= 0) out.push('no-worker-days');
    if (row.kind === 'proizvodni' && row.products.some(
        p => p.candidate.crewAssumed
            && p.workersOverride === undefined
            && p.workerDaysPerUnitOverride === undefined
    )) out.push('crew-assumed');
    if (row.crewOptions.length === 0) out.push('no-crew');
    return out;
}

// ── Red → blok ──────────────────────────────────────────────────────

export function rowToBlock(row: BatchRow, opts: BatchToBlocksOpts): PlanBlock {
    const kind: PlanBlockKind = row.kind === 'montaza' ? 'montaza' : 'order';
    const workerDays = rowWorkerDays(row);
    const projectRef = deriveProjectRef(row);
    const productRefs: PlanProductRef[] = row.kind === 'proizvodni'
        ? row.products.map(p => ({ id: p.candidate.productId, name: p.candidate.productName, qty: p.qty }))
        : [];

    // Nominalna ekipa PRIJE rasporeda — samo da traka ima smislenu širinu.
    // Raspored kasnije prepiše datume, crew i workerRefs iz izabrane ekipe.
    const nominalCrew = row.crewOptions.length ? crewSize(row.crewOptions[0]) : DEFAULT_OFFER_CREW;
    const startISO = opts.startISO;
    const endISO = workerDays > 0
        ? endFromWork(startISO, workerDays, nominalCrew, opts.isSaturdayWorking)
        : startISO;

    return newBlock(kind, startISO, endISO, {
        title: rowTitle(row),
        ...(projectRef ? { projectRef } : {}),
        ...(productRefs.length ? { productRefs } : {}),
        ...(workerDays > 0 ? { workerDays } : {}),
        crew: nominalCrew,
        ...(row.priority ? { priority: row.priority } : {}),
        ...(row.crewOptions.length ? { crewOptions: row.crewOptions } : {}),
    });
}

export function batchToBlocks(
    rows: BatchRow[],
    opts: BatchToBlocksOpts
): { blocks: PlanBlock[]; skipped: number } {
    const filled = rows.filter(isRowFilled);
    return {
        blocks: filled.map(r => rowToBlock(r, opts)),
        skipped: rows.length - filled.length,
    };
}

// ── Sažetak za podnožje modala ──────────────────────────────────────

export interface BatchSummary {
    rowCount: number;         // popunjeni redovi
    totalWorkerDays: number;
    crewAssumedCount: number; // proizvodi s pretpostavljenom ekipom (nerazriješeni)
    noWorkerDaysCount: number;
    noCrewCount: number;      // redovi bez kandidat-ekipa (ostaju ručni)
}

export function batchSummary(rows: BatchRow[]): BatchSummary {
    const filled = rows.filter(isRowFilled);
    let crewAssumed = 0;
    for (const r of filled) {
        if (r.kind !== 'proizvodni') continue;
        for (const p of r.products) {
            if (p.candidate.crewAssumed
                && p.workersOverride === undefined
                && p.workerDaysPerUnitOverride === undefined) crewAssumed++;
        }
    }
    return {
        rowCount: filled.length,
        totalWorkerDays: round2(filled.reduce((s, r) => s + rowWorkerDays(r), 0)),
        crewAssumedCount: crewAssumed,
        noWorkerDaysCount: filled.filter(r => rowWorkerDays(r) <= 0).length,
        noCrewCount: filled.filter(r => r.crewOptions.length === 0).length,
    };
}
