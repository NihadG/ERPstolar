// ════════════════════════════════════════════════════════════════════
// PLATNO — GRADNJA REDOVA
//
// Red je DIMENZIJA POGLEDA, ne entitet. Ovo je greška starog planera: tamo je
// `Map<Worker_ID, WorkOrder[]>` dio modela, pa se ne može gledati po projektu.
// Ovdje blok zna svoje datume i svoje reference; GDJE se crta odlučuje `groupBy`.
//
// Ovdje se popravlja i drugi bug starog planera: nalog bez radnika se tamo gura na
// SVAKI red ([PlannerTab:316]), pa jedan neraspoređen posao izgleda kao N poslova.
// Kod nas ide u jedan sintetički red „Nedodijeljeno".
// ════════════════════════════════════════════════════════════════════

import type {
    PlanScenario, PlanBlock, PlanBlockKind, PlanGroupBy, PlanLayout, PlanRef, Worker, WorkOrder, WorkerAttendance,
} from '../types';

/** Sekcije platna, odozgo nadolje. Obaveze su na vrhu jer su fiksne tačke. */
export type CanvasSection = 'obaveze' | 'plan' | 'nalozi' | 'radnici' | 'nabavka';

export const SECTION_LABEL: Record<CanvasSection, string> = {
    obaveze: 'Obaveze',
    plan: 'Plan',
    nalozi: 'Nalozi',
    radnici: 'Radnici',
    nabavka: 'Nabavka',
};

/**
 * Sloj bloka u OBJEDINJENOM redu. Nalog je okosnica (gornji sloj), a logistika
 * (narudžba/transport) i rokovi se crtaju ispod, uže i prigušeno — da se u istom
 * redu vidi „ovo je nalog, a unutar njegovog intervala stiže narudžba".
 */
export type BlockLayer = 'primary' | 'supply' | 'marker';

export function blockLayer(kind: PlanBlockKind): BlockLayer {
    if (kind === 'order' || kind === 'montaza') return 'primary';
    if (kind === 'milestone') return 'marker';
    return 'supply';   // purchase, transport, note
}

/**
 * Traka stvarnog, već preuzetog posla. ČITA SE, NIKAD SE NE MIJENJA.
 * Planiranje koje ignoriše preuzet posao je samoobmana — zato su sjene tu.
 */
export interface ShadowBar {
    id: string;
    label: string;
    startISO: string;
    endISO: string;
    kind: 'workorder' | 'absence';
    /** Za tooltip: zašto je ovo tu. */
    hint?: string;
}

export interface CanvasRow {
    id: string;
    label: string;
    sublabel?: string;
    section: CanvasSection;
    /** Blokovi scenarija koji pripadaju ovom redu (isti blok može biti na više redova). */
    blocks: PlanBlock[];
    shadows: ShadowBar[];
    /** Sintetički red („Nedodijeljeno") — nema stvarnog entiteta iza sebe. */
    synthetic?: boolean;
}

export interface RowContext {
    workers: Worker[];
    /** Stvarni nalozi — samo za sjene. */
    workOrders: WorkOrder[];
    attendance: WorkerAttendance[];
    /** Prikaži i radnike koji nemaju ništa u scenariju (da se vidi ko je slobodan). */
    showIdleWorkers?: boolean;
}

const ABSENT_STATUSES = new Set(['Odsutan', 'Bolovanje', 'Odmor']);

/** Blokovi koji su fiksne tačke, ne rad. */
const COMMITMENT_KINDS = new Set<PlanBlock['kind']>(['milestone', 'montaza', 'transport']);

const byStart = (a: PlanBlock, b: PlanBlock) =>
    a.startISO.localeCompare(b.startISO) || a.title.localeCompare(b.title, 'hr');

// ── Sjene ───────────────────────────────────────────────────────────

/**
 * Stvarni zakazani nalozi po radniku — čita `Assigned_Workers` i procese stavki.
 * Eksportovano da kalendar radnika čita sjene ISTOM logikom kao osa — dva prikaza
 * istog čovjeka ne smiju se razilaziti oko toga šta je već preuzeto.
 */
export function realWorkOrdersByWorker(workOrders: WorkOrder[]): Map<string, ShadowBar[]> {
    const out = new Map<string, ShadowBar[]>();
    for (const wo of workOrders) {
        if (wo.Status === 'Završeno' || wo.Status === 'Otkazano') continue;
        const start = (wo.Started_At || wo.Planned_Start_Date || '').split('T')[0];
        const end = (wo.Due_Date || wo.Planned_End_Date || start).split('T')[0];
        if (!start) continue;

        const workerIds = new Set<string>();
        for (const item of wo.items || []) {
            (item.Assigned_Workers || []).forEach(w => w.Worker_ID && workerIds.add(w.Worker_ID));
            (item.Processes || []).forEach(p => {
                if (p.Worker_ID) workerIds.add(p.Worker_ID);
                (p.Helpers || []).forEach(h => h.Worker_ID && workerIds.add(h.Worker_ID));
            });
        }

        const bar: ShadowBar = {
            id: `wo-${wo.Work_Order_ID}`,
            label: wo.Name?.trim() || wo.Work_Order_Number,
            startISO: start,
            endISO: end < start ? start : end,
            kind: 'workorder',
            hint: `Stvarni nalog ${wo.Work_Order_Number} — ${wo.Status}`,
        };
        for (const wid of workerIds) {
            const arr = out.get(wid) || [];
            arr.push(bar);
            out.set(wid, arr);
        }
    }
    return out;
}

/** Odsustva iz šihtarice — susjedni dani se spajaju u jednu traku. */
function absencesByWorker(attendance: WorkerAttendance[]): Map<string, ShadowBar[]> {
    const byWorker = new Map<string, { date: string; status: string }[]>();
    for (const a of attendance) {
        if (!a.Worker_ID || !a.Date || !ABSENT_STATUSES.has(a.Status)) continue;
        const arr = byWorker.get(a.Worker_ID) || [];
        arr.push({ date: a.Date, status: a.Status });
        byWorker.set(a.Worker_ID, arr);
    }

    const out = new Map<string, ShadowBar[]>();
    for (const [workerId, days] of byWorker) {
        days.sort((x, y) => x.date.localeCompare(y.date));
        const bars: ShadowBar[] = [];
        let runStart = days[0];
        let prev = days[0];

        const flush = (endDay: { date: string; status: string }) => {
            bars.push({
                id: `abs-${workerId}-${runStart.date}`,
                label: runStart.status,
                startISO: runStart.date,
                endISO: endDay.date,
                kind: 'absence',
                hint: `${runStart.status} — iz šihtarice`,
            });
        };

        for (let i = 1; i < days.length; i++) {
            const cur = days[i];
            const gap = Math.round(
                (new Date(`${cur.date}T12:00:00`).getTime() - new Date(`${prev.date}T12:00:00`).getTime()) / 86400000
            );
            if (gap > 1 || cur.status !== prev.status) {
                flush(prev);
                runStart = cur;
            }
            prev = cur;
        }
        flush(prev);
        out.set(workerId, bars);
    }
    return out;
}

// ── Gradnja ─────────────────────────────────────────────────────────

/**
 * Redovi platna. Isti blok se NAMJERNO može pojaviti na više redova
 * (nalog s dva radnika je na oba reda) — to je pogled, ne duplikat.
 *
 * `layout` bira raspored:
 *  - `detailed`        → klasične sekcije po vrsti (Obaveze/Nalozi/Nabavka + Radnici).
 *  - `unified-project` → jedan red po projektu (sve vrste zajedno) + Radnici.
 *  - `unified-global`  → jedan red sa svim blokovima + Radnici.
 */
export function buildRows(
    scenario: PlanScenario,
    groupBy: PlanGroupBy,
    ctx: RowContext,
    layout: PlanLayout = 'detailed'
): CanvasRow[] {
    if (layout === 'unified-project') return buildUnifiedRows(scenario, ctx, 'project');
    if (layout === 'unified-global') return buildUnifiedRows(scenario, ctx, 'global');
    return buildDetailedRows(scenario, groupBy, ctx);
}

function buildDetailedRows(
    scenario: PlanScenario,
    groupBy: PlanGroupBy,
    ctx: RowContext
): CanvasRow[] {
    const rows: CanvasRow[] = [];
    const blocks = scenario.Blocks;

    // ── OBAVEZE: fiksne tačke uvijek na vrhu, u jednom redu ──────
    const commitments = blocks.filter(b => COMMITMENT_KINDS.has(b.kind)).sort(byStart);
    if (commitments.length) {
        rows.push({
            id: 'sec-obaveze',
            label: 'Rokovi i montaže',
            section: 'obaveze',
            blocks: commitments,
            shadows: [],
        });
    }

    // ── NALOZI: grupisano po izabranoj dimenziji ─────────────────
    const orderBlocks = blocks.filter(b => b.kind === 'order' || b.kind === 'note');
    const grouped = new Map<string, { label: string; sublabel?: string; blocks: PlanBlock[] }>();
    const UNASSIGNED = '__unassigned__';

    for (const b of orderBlocks) {
        let keys: { key: string; label: string; sublabel?: string }[] = [];

        if (groupBy === 'project') {
            keys = b.projectRef
                ? [{ key: b.projectRef.id || `name:${b.projectRef.name}`, label: b.projectRef.name }]
                : [{ key: UNASSIGNED, label: 'Bez projekta' }];
        } else if (groupBy === 'worker') {
            keys = (b.workerRefs || []).length
                ? b.workerRefs!.map(w => ({ key: w.id || `name:${w.name}`, label: w.name }))
                // Bug starog planera: ovdje je nalog bez radnika išao na SVAKI red.
                : [{ key: UNASSIGNED, label: 'Nedodijeljeno' }];
        } else if (groupBy === 'supplier') {
            keys = b.supplierRef
                ? [{ key: b.supplierRef.id || `name:${b.supplierRef.name}`, label: b.supplierRef.name }]
                : [{ key: UNASSIGNED, label: 'Bez dobavljača' }];
        } else {
            keys = [{ key: b.kind, label: b.kind === 'note' ? 'Napomene' : 'Nalozi' }];
        }

        for (const k of keys) {
            const entry = grouped.get(k.key) || { label: k.label, sublabel: k.sublabel, blocks: [] };
            entry.blocks.push(b);
            grouped.set(k.key, entry);
        }
    }

    const groupEntries = Array.from(grouped.entries()).sort(([ka, a], [kb, bb]) => {
        if (ka === UNASSIGNED) return 1;          // sintetički red uvijek na kraj
        if (kb === UNASSIGNED) return -1;
        return a.label.localeCompare(bb.label, 'hr');
    });

    for (const [key, entry] of groupEntries) {
        rows.push({
            id: `nalozi-${key}`,
            label: entry.label,
            sublabel: entry.sublabel,
            section: 'nalozi',
            blocks: entry.blocks.sort(byStart),
            shadows: [],
            synthetic: key === UNASSIGNED,
        });
    }

    // ── RADNICI: kapacitet i stvarna zauzetost ───────────────────
    rows.push(...buildWorkerRows(scenario, ctx));

    // ── NABAVKA: po dobavljaču ───────────────────────────────────
    const purchases = blocks.filter(b => b.kind === 'purchase');
    if (purchases.length) {
        const bySupplier = new Map<string, { label: string; blocks: PlanBlock[] }>();
        for (const b of purchases) {
            const key = b.supplierRef?.id || `name:${b.supplierRef?.name || 'Nepoznat'}`;
            const entry = bySupplier.get(key) || { label: b.supplierRef?.name || 'Nepoznat dobavljač', blocks: [] };
            entry.blocks.push(b);
            bySupplier.set(key, entry);
        }
        for (const [key, entry] of Array.from(bySupplier.entries())
            .sort(([, a], [, b]) => a.label.localeCompare(b.label, 'hr'))) {
            rows.push({
                id: `nabavka-${key}`,
                label: entry.label,
                section: 'nabavka',
                blocks: entry.blocks.sort(byStart),
                shadows: [],
            });
        }
    }

    return rows;
}

/** Radnički redovi (kapacitet + sjene stvarnog posla). Isti u svakom rasporedu. */
function buildWorkerRows(scenario: PlanScenario, ctx: RowContext): CanvasRow[] {
    const blocks = scenario.Blocks;
    const shadowWO = realWorkOrdersByWorker(ctx.workOrders);
    const shadowAbs = absencesByWorker(ctx.attendance);

    const referenced = new Set<string>();
    for (const b of blocks) for (const w of b.workerRefs || []) if (w.id) referenced.add(w.id);

    const workerPool = ctx.showIdleWorkers
        ? ctx.workers.filter(w => w.Status === 'Aktivan' || w.Status === 'Dostupan')
        : ctx.workers.filter(w => referenced.has(w.Worker_ID));

    return [...workerPool]
        .sort((a, b) => (a.Name || '').localeCompare(b.Name || '', 'hr'))
        .map(w => ({
            id: `radnik-${w.Worker_ID}`,
            label: w.Name,
            sublabel: w.Role,
            section: 'radnici' as CanvasSection,
            blocks: blocks
                .filter(b => (b.workerRefs || []).some(r => r.id === w.Worker_ID))
                .sort(byStart),
            shadows: [...(shadowWO.get(w.Worker_ID) || []), ...(shadowAbs.get(w.Worker_ID) || [])],
        }));
}

/**
 * OBJEDINJENI raspored: nalog, narudžba, transport, rok i montaža istog projekta žive
 * u JEDNOM redu. Nalog je okosnica; ostalo se crta ispod (vidi `blockLayer`). Radnici
 * ostaju zasebna sekcija — kapacitet je druga osa i miješanje bi ga zamaglilo.
 */
function buildUnifiedRows(
    scenario: PlanScenario,
    ctx: RowContext,
    mode: 'project' | 'global'
): CanvasRow[] {
    const rows: CanvasRow[] = [];
    const blocks = scenario.Blocks;

    if (mode === 'global') {
        if (blocks.length) {
            rows.push({
                id: 'plan-all',
                label: 'Svi blokovi',
                sublabel: 'objedinjeno',
                section: 'plan',
                blocks: [...blocks].sort(byStart),
                shadows: [],
            });
        }
    } else {
        // Narudžba pripada projektu NALOGA koji hrani (veza „stiglo → kreće"), ne svom
        // (moguće pogrešnom) projectRef-u. Tako narudžba vezana za Emirov nalog stoji pod
        // Emirom, čak i ako joj je projectRef ostao na drugom projektu.
        const blockById = new Map(blocks.map(b => [b.id, b]));
        const linkedProject = new Map<string, PlanRef>();
        for (const l of scenario.Links) {
            if (l.kind !== 'delivery-to-start') continue;
            const nalog = blockById.get(l.to);          // l.from = narudžba, l.to = nalog
            if (nalog?.projectRef) linkedProject.set(l.from, nalog.projectRef);
        }
        const projectOf = (b: PlanBlock): PlanRef | undefined =>
            (b.kind === 'purchase' ? linkedProject.get(b.id) : undefined) || b.projectRef;

        const UNASSIGNED = '__unassigned__';
        const grouped = new Map<string, { label: string; blocks: PlanBlock[] }>();
        for (const b of blocks) {
            const pr = projectOf(b);
            const key = pr ? (pr.id || `name:${pr.name}`) : UNASSIGNED;
            const label = pr ? pr.name : 'Bez projekta';
            const entry = grouped.get(key) || { label, blocks: [] };
            entry.blocks.push(b);
            grouped.set(key, entry);
        }
        const entries = Array.from(grouped.entries()).sort(([ka, a], [kb, bb]) => {
            if (ka === UNASSIGNED) return 1;          // „Bez projekta" na kraj
            if (kb === UNASSIGNED) return -1;
            return a.label.localeCompare(bb.label, 'hr');
        });
        for (const [key, entry] of entries) {
            rows.push({
                id: `plan-${key}`,
                label: entry.label,
                section: 'plan',
                blocks: entry.blocks.sort(byStart),
                shadows: [],
                synthetic: key === UNASSIGNED,
            });
        }
    }

    rows.push(...buildWorkerRows(scenario, ctx));
    return rows;
}

/** Redovi grupisani po sekcijama, u fiksnom redoslijedu prikaza. */
export function groupRowsBySection(rows: CanvasRow[]): { section: CanvasSection; rows: CanvasRow[] }[] {
    const order: CanvasSection[] = ['obaveze', 'plan', 'nalozi', 'radnici', 'nabavka'];
    return order
        .map(section => ({ section, rows: rows.filter(r => r.section === section) }))
        .filter(g => g.rows.length > 0);
}
