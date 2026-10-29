// ════════════════════════════════════════════════════════════════════
// ISTORIJA RADA PROJEKTA — iz Knjige rada, kroz SVE naloge (i završene)
//
// „Kad smo počeli Čorluku?" — prvi dan rada na bilo kojem nalogu projekta.
// Ranije je bot vidio samo otvorene naloge i samo ZADNJI dan rada, pa je
// „zadnji rad 22.10." pročitao kao početak (a prvi rad je bio 18.09.).
// Čista funkcija; učitavanje je u lib/assistant/orderStatus.ts.
// jest: lib/__tests__/projectHistory.test.ts
// ════════════════════════════════════════════════════════════════════

import { formatQty } from './orderItemGroups';

export interface HistoryOrderInput { id: string; name: string; status: string }
export interface HistoryItemInput { id: string; workOrderId: string; product: string }
export interface HistoryLogInput {
    date: string;
    workerName: string;
    workOrderId: string;
    itemId?: string;
    /** Udio dana (dnevnica); bez njega 1. */
    dayFraction?: number;
}

export interface HistorySpan { first: string; last: string; workDays: number; personDays: number; workers: string[] }

export interface ProjectHistory {
    /** null = na projektu još nema upisanog rada. */
    span: HistorySpan | null;
    orders: (HistoryOrderInput & { span: HistorySpan | null; products: { name: string; span: HistorySpan }[] })[];
}

function spanOf(logs: HistoryLogInput[]): HistorySpan | null {
    if (!logs.length) return null;
    const dates = logs.map(l => l.date.slice(0, 10)).sort();
    const workers = new Map<string, number>();
    logs.forEach(l => workers.set(l.workerName, (workers.get(l.workerName) || 0) + (l.dayFraction ?? 1)));
    return {
        first: dates[0],
        last: dates[dates.length - 1],
        workDays: new Set(dates).size,
        personDays: Math.round(logs.reduce((s, l) => s + (l.dayFraction ?? 1), 0) * 100) / 100,
        // Ko je najviše radio, prvi.
        workers: Array.from(workers.entries()).sort((a, b) => b[1] - a[1]).map(([n]) => n).filter(Boolean),
    };
}

export function buildProjectHistory(orders: HistoryOrderInput[], items: HistoryItemInput[], logs: HistoryLogInput[]): ProjectHistory {
    const valid = logs.filter(l => l.date);
    return {
        span: spanOf(valid),
        orders: orders
            .map(o => {
                const mine = valid.filter(l => l.workOrderId === o.id);
                const products = items.filter(i => i.workOrderId === o.id)
                    .map(i => ({ name: i.product, span: spanOf(mine.filter(l => l.itemId === i.id)) }))
                    .filter((p): p is { name: string; span: HistorySpan } => !!p.span);
                return { ...o, span: spanOf(mine), products };
            })
            // Redom kojim je rad počinjao; nalozi bez rada na kraju.
            .sort((a, b) => (a.span?.first || '9999').localeCompare(b.span?.first || '9999') || a.name.localeCompare(b.name, 'bs')),
    };
}

const day = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.${iso.slice(0, 4)}`;
const short = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.`;

function spanText(s: HistorySpan): string {
    const range = s.first === s.last ? short(s.first) : `${short(s.first)}–${short(s.last)}`;
    return `${range} · ${s.workDays} ${s.workDays === 1 ? 'dan' : 'dana'} rada (${formatQty(s.personDays)} dnevnica)`;
}

/** Redovi za model: prvo PRVI i ZADNJI dan cijelog projekta, pa po nalogu i proizvodu. */
export function projectHistoryLines(h: ProjectHistory, label: string): string[] {
    if (!h.span) return [`${label}: u Knjizi rada nema upisanog rada.`];
    const out = [
        `${label}: PRVI dan rada ${day(h.span.first)}, ZADNJI ${day(h.span.last)} · ${h.span.workDays} dana rada, ${formatQty(h.span.personDays)} dnevnica · radili: ${h.span.workers.slice(0, 8).join(', ')}`,
    ];
    for (const o of h.orders) {
        out.push(o.span ? `• ${o.name} (${o.status}): ${spanText(o.span)} · ${o.span.workers.slice(0, 5).join(', ')}` : `• ${o.name} (${o.status}): bez upisanog rada`);
        if (o.products.length > 1) o.products.slice(0, 8).forEach(p => out.push(`   – ${p.name}: ${spanText(p.span)}`));
    }
    return out;
}
