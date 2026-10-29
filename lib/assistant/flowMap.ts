// ════════════════════════════════════════════════════════════════════
// KARTA TOKA NALOGA ZA BOTA (čisto)
//
// Bot ranije nije vidio graf naloga — samo naziv — pa je tuđe riječi („montaža
// iverala na podkonstrukcije") slao ERP-u doslovno. Karta daje modelu iste
// redove koje korisnik vidi na tabli „Tok" (buildOrderFlowRows): proces, koliko
// proizvoda je gotovo, šta je na redu, na šta čeka i koje proizvode pokriva.
// Model bira TAČAN naziv procesa iz karte; ERP zaključuje šta je prije toga gotovo.
// jest: lib/__tests__/assistantFlowMap.test.ts
// ════════════════════════════════════════════════════════════════════

import { buildOrderFlowRows, type ProcRow } from '@/lib/orderProcessRows';
import type { ProcessGraph, WorkOrderItem } from '@/lib/types';

export interface FlowMapOrder {
    alias: string;
    name: string;
    graph?: ProcessGraph | null;
    items: WorkOrderItem[];
}

const MAX_ITEMS_LISTED = 12;
const short = (s: string, n = 32) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function rowText(r: ProcRow, all: number, names: Map<string, string>): string {
    const inProgress = r.perItem.filter(p => p.status === 'U toku').length;
    const counts = `${r.done}/${r.total}${inProgress ? `, u toku ${inProgress}` : ''}`;
    const state = r.state === 'done' ? 'gotovo'
        : r.state === 'active' ? 'na redu'
            : `čeka ${r.predIds.map(id => names.get(id)).filter(Boolean).join(' + ') || 'prethodni'}`;
    const subset = r.total < all
        ? ` — samo ${r.total <= 3 ? r.perItem.map(p => short(p.itemName, 20)).join(', ') : `${r.total} od ${all} proizvoda`}`
        : '';
    const who = r.workers.length ? ` · ${r.workers.join(', ')}` : '';
    return `${r.name} — ${state} (${counts})${subset}${who}`;
}

/** Tok jednog naloga kao tekst za model. Prazan kad nalog nema plan procesa. */
export function flowMapText(o: FlowMapOrder): string {
    const items = o.items.filter(i => i.Item_Type !== 'custom');
    const rows = buildOrderFlowRows(items, o.graph).filter(r => r.name.trim().toLowerCase() !== 'rad');
    if (!rows.length) return '';
    const names = new Map(rows.map(r => [r.id, r.name]));
    const listed = items.slice(0, MAX_ITEMS_LISTED).map(i => short(i.Product_Name || '—')).join('; ');
    return [
        `${o.alias} ${o.name} — ${items.length} proizvoda: ${listed}${items.length > MAX_ITEMS_LISTED ? '; …' : ''}`,
        ...rows.map(r => `  • ${rowText(r, items.length, names)}`),
    ].join('\n');
}

/** Tokovi naloga za prompt (samo oni koji imaju plan). */
export function flowMapsText(orders: FlowMapOrder[]): string {
    return orders.map(flowMapText).filter(Boolean).join('\n\n');
}
