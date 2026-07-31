// ════════════════════════════════════════════════════════════════════
// NEDOSTACI PODATAKA — jedan jezik za sve „šta fali nalozima"
//
// Prije: šest zasebnih provjera ispaljivalo je šest vrsta obavijesti u zvono,
// svaka svojim tekstom i ikonom — nepregledno. Ovdje se sirovi rezultati tih
// provjera svode na JEDAN oblik (`DataGap`), pa ih zvono prikazuje kao jednu
// stavku, a modal grupisano nabraja.
//
// Čista funkcija (bez Firebasea) — provjere i dalje žive gdje su bile
// (lib/database.ts, lib/attendance.ts); ovdje se samo NORMALIZUJU, da se
// prikaz mijenja na jednom mjestu.
// ════════════════════════════════════════════════════════════════════

export type DataGapKind =
    | 'material-cost-zero'
    | 'montaza-unassigned'
    | 'zero-rate'
    | 'attendance-missing'
    | 'process-unassigned'
    | 'costs-missing';

export type DataGapSeverity = 'high' | 'medium';

export interface DataGap {
    id: string;
    kind: DataGapKind;
    severity: DataGapSeverity;
    /** Kratki naziv reda, npr. „Kuhinja — Montaža". */
    label: string;
    /** Objašnjenje zašto je to problem. */
    detail: string;
    workOrderId?: string;
    workOrderNumber?: string;
    targetTab: string;
    /** Prisutno samo za nedostatak troška materijala — omogućava inline unos. */
    fix?: { kind: 'material-cost'; workOrderItemId: string };
}

export interface DataGapGroup {
    kind: DataGapKind;
    title: string;
    severity: DataGapSeverity;
    gaps: DataGap[];
}

// ─── Sirovi oblici (kako ih vraćaju postojeće provjere) ───────────────

export interface RawZeroMaterialCost {
    Work_Order_Item_ID: string;
    Product_ID?: string;
    Product_Name: string;
    Project_Name?: string;
    Work_Order_Number?: string;
    Planned_Start_Date?: string;
    Has_Materials?: boolean;
    Material_Count?: number;
}
export interface RawUnassignedMontaza {
    itemId: string; itemName: string; workOrderId: string; workOrderNumber?: string; processName: string;
}
export interface RawAttendanceResult {
    warnings: { Worker_Name?: string }[]; missingCount: number; totalAssigned?: number;
}
export interface RawZeroRate {
    workerId: string; workerName: string; itemNames: string[];
}
export interface RawProcessWithoutWorker {
    itemId: string; itemName: string; processName: string; workOrderId: string; workOrderNumber?: string;
}
export interface RawMissingCostFields {
    itemId: string; itemName: string; workOrderId: string; workOrderNumber?: string; missingFields: string[];
}

export interface DataGapInput {
    zeroMaterialCost?: RawZeroMaterialCost[];
    montaza?: RawUnassignedMontaza[];
    attendance?: RawAttendanceResult | null;
    zeroRate?: RawZeroRate[];
    processesWithoutWorkers?: RawProcessWithoutWorker[];
    missingCostFields?: RawMissingCostFields[];
    /** Za oznaku „danas/sutra" kod početka proizvodnje. */
    today?: string;
}

const GROUP_META: Record<DataGapKind, { title: string; severity: DataGapSeverity }> = {
    'material-cost-zero': { title: 'Trošak materijala 0', severity: 'high' },
    'montaza-unassigned': { title: 'Montaža bez radnika', severity: 'high' },
    'zero-rate': { title: 'Radnik s dnevnicom 0', severity: 'high' },
    'attendance-missing': { title: 'Nedostaje šihtarica', severity: 'high' },
    'process-unassigned': { title: 'Procesi bez radnika', severity: 'medium' },
    'costs-missing': { title: 'Nedostaju troškovi', severity: 'medium' },
};

function startLabel(plannedStart?: string, today?: string): string {
    if (!plannedStart) return 'uskoro';
    // Oba datuma na LOKALNU ponoć — inače „2026-07-15" (UTC) vs lokalna ponoć
    // daju pomak od jednog dana u zonama iza UTC-a.
    const start = new Date(plannedStart.split('T')[0] + 'T00:00:00');
    const base = new Date((today || new Date().toISOString().split('T')[0]) + 'T00:00:00');
    const diff = Math.ceil((start.getTime() - base.getTime()) / 86400000);
    if (diff <= 0) return 'danas';
    if (diff === 1) return 'sutra';
    return `za ${diff} dana`;
}

/** Svedi sve sirove rezultate na jedinstven spisak nedostataka. */
export function buildDataGaps(input: DataGapInput): DataGap[] {
    const gaps: DataGap[] = [];

    for (const p of input.zeroMaterialCost || []) {
        gaps.push({
            id: `material-cost-zero:${p.Work_Order_Item_ID}`,
            kind: 'material-cost-zero',
            severity: 'high',
            label: p.Product_Name || 'Proizvod',
            detail: p.Has_Materials
                ? `${p.Material_Count ?? 0} materijala bez cijene · počinje ${startLabel(p.Planned_Start_Date, input.today)}${p.Work_Order_Number ? ` (${p.Work_Order_Number})` : ''}`
                : `Bez materijala · počinje ${startLabel(p.Planned_Start_Date, input.today)}${p.Work_Order_Number ? ` (${p.Work_Order_Number})` : ''}`,
            workOrderNumber: p.Work_Order_Number,
            targetTab: 'production',
            fix: { kind: 'material-cost', workOrderItemId: p.Work_Order_Item_ID },
        });
    }

    for (const m of input.montaza || []) {
        gaps.push({
            id: `montaza-unassigned:${m.itemId}:${m.processName}`,
            kind: 'montaza-unassigned',
            severity: 'high',
            label: m.itemName || 'Proizvod',
            detail: `Proces „${m.processName}" je aktivan bez radnika — trošak rada se ne bilježi.${m.workOrderNumber ? ` (${m.workOrderNumber})` : ''}`,
            workOrderId: m.workOrderId,
            workOrderNumber: m.workOrderNumber,
            targetTab: 'production',
        });
    }

    for (const w of input.zeroRate || []) {
        const items = w.itemNames.slice(0, 2).join(', ');
        const more = w.itemNames.length > 2 ? ` (+${w.itemNames.length - 2})` : '';
        gaps.push({
            id: `zero-rate:${w.workerId}`,
            kind: 'zero-rate',
            severity: 'high',
            label: w.workerName,
            detail: `Dnevnica 0 KM, dodijeljen na: ${items}${more}. Rad se knjiži besplatno.`,
            targetTab: 'production',
        });
    }

    if (input.attendance && input.attendance.missingCount > 0) {
        const names = Array.from(new Set((input.attendance.warnings || []).map(w => w.Worker_Name).filter(Boolean))) as string[];
        const shown = names.slice(0, 3).join(', ');
        const more = names.length > 3 ? ` i još ${names.length - 3}` : '';
        gaps.push({
            id: 'attendance-missing',
            kind: 'attendance-missing',
            severity: 'high',
            label: `${input.attendance.missingCount} ${input.attendance.missingCount === 1 ? 'radnik' : 'radnika'} bez šihtarice`,
            detail: `${shown}${more} — trošak rada će biti netačan.`,
            targetTab: 'attendance',
        });
    }

    // Procesi bez radnika — grupisano po nalogu (da ne bude šuma).
    const procByWO = new Map<string, RawProcessWithoutWorker[]>();
    for (const p of input.processesWithoutWorkers || []) {
        const arr = procByWO.get(p.workOrderId) || [];
        arr.push(p);
        procByWO.set(p.workOrderId, arr);
    }
    for (const [woId, procs] of procByWO) {
        const labels = Array.from(new Set(procs.map(p => `${p.itemName}/${p.processName}`)));
        gaps.push({
            id: `process-unassigned:${woId}`,
            kind: 'process-unassigned',
            severity: 'medium',
            label: procs[0].workOrderNumber || 'Nalog',
            detail: `${procs.length} ${procs.length === 1 ? 'proces' : 'procesa'} bez radnika: ${labels.slice(0, 2).join(', ')}${labels.length > 2 ? ` (+${labels.length - 2})` : ''}`,
            workOrderId: woId,
            workOrderNumber: procs[0].workOrderNumber,
            targetTab: 'production',
        });
    }

    // Nedostajući troškovi — grupisano po nalogu.
    const costByWO = new Map<string, RawMissingCostFields[]>();
    for (const c of input.missingCostFields || []) {
        const arr = costByWO.get(c.workOrderId) || [];
        arr.push(c);
        costByWO.set(c.workOrderId, arr);
    }
    for (const [woId, items] of costByWO) {
        const fields = Array.from(new Set(items.flatMap(i => i.missingFields)));
        gaps.push({
            id: `costs-missing:${woId}`,
            kind: 'costs-missing',
            severity: 'medium',
            label: items[0].workOrderNumber || 'Nalog',
            detail: `${items.length} ${items.length === 1 ? 'stavka' : 'stavki'} bez: ${fields.join(', ')}. Profit nije potpun.`,
            workOrderId: woId,
            workOrderNumber: items[0].workOrderNumber,
            targetTab: 'production',
        });
    }

    return gaps;
}

/** Grupisano po vrsti, teži nedostaci (high) prvi. */
export function groupDataGaps(gaps: DataGap[]): DataGapGroup[] {
    const order: DataGapKind[] = [
        'material-cost-zero', 'montaza-unassigned', 'zero-rate',
        'attendance-missing', 'process-unassigned', 'costs-missing',
    ];
    const byKind = new Map<DataGapKind, DataGap[]>();
    for (const g of gaps) {
        const arr = byKind.get(g.kind) || [];
        arr.push(g);
        byKind.set(g.kind, arr);
    }
    return order
        .filter(k => byKind.has(k))
        .map(k => ({ kind: k, title: GROUP_META[k].title, severity: GROUP_META[k].severity, gaps: byKind.get(k)! }));
}
