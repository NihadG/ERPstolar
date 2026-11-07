// ════════════════════════════════════════════════════════════════════
// IZVJEŠTAJ RADA — ERP sabira radne dane, model samo prepisuje (čisto)
//
// Dan radnika je u Knjizi rada razbijen na stavke naloga (16 stavki po 0,06). Model je
// iz tih redova sabirao sam i 06.11. za isti period rekao 3, pa 4, pa 4,7, pa 5 dana.
// Zato se ovdje računa: dan radnika = zbir udjela tog datuma, a redovi se slažu po
// danu i nalogu, ne po stavci.
// jest: lib/__tests__/workReport.test.ts
// ════════════════════════════════════════════════════════════════════

import { formatQty } from './orderItemGroups';

export interface WorkReportRow {
    date: string;
    workerId: string;
    worker: string;
    dayFraction: number;
    process?: string;
    workOrderName: string;
    productName: string;
    projectName: string;
    confirmed: boolean;
}

const dayText = (n: number) => `${formatQty(n)} ${n === 1 ? 'dan' : 'dana'}`;
const shortDay = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.`;
/** Zaokruživanje udjela: stavke 1/16 zbrojene daju 0,9999 — to je cijeli dan. */
const tidy = (n: number) => Math.round(n * 100) / 100;

function orderLabel(r: WorkReportRow): string {
    const project = r.projectName && !r.workOrderName.toLowerCase().includes(r.projectName.toLowerCase()) ? ` (${r.projectName})` : '';
    return `${r.workOrderName}${project}`;
}

/**
 * Po radniku: koliko radnih dana i kojih datuma, pa po nalogu koliko dana i kad.
 * Prvi red radnika je broj koji se prepisuje korisniku.
 */
export function workReportSummary(rows: WorkReportRow[]): string[] {
    const out: string[] = [];
    const workers = Array.from(new Set(rows.map(r => r.workerId)));
    for (const id of workers) {
        const mine = rows.filter(r => r.workerId === id);
        const perDay = new Map<string, number>();
        mine.forEach(r => perDay.set(r.date, (perDay.get(r.date) || 0) + r.dayFraction));
        const dates = Array.from(perDay.keys()).sort();
        const total = tidy(dates.reduce((s, d) => s + tidy(perDay.get(d)!), 0));
        const partial = dates.filter(d => tidy(perDay.get(d)!) < 1).map(d => `${shortDay(d)} ${formatQty(tidy(perDay.get(d)!))}`);
        out.push(`${mine[0].worker}: ${dayText(total)} rada (${dates.map(shortDay).join(', ')})${partial.length ? ` — djelimično: ${partial.join(', ')}` : ''}`);
        const orders = new Map<string, WorkReportRow[]>();
        mine.forEach(r => orders.set(orderLabel(r), [...(orders.get(orderLabel(r)) || []), r]));
        Array.from(orders.entries())
            .map(([label, list]) => ({ label, list, days: tidy(list.reduce((s, r) => s + r.dayFraction, 0)) }))
            .sort((a, b) => b.days - a.days)
            .forEach(o => out.push(`  • ${o.label}: ${dayText(o.days)} (${Array.from(new Set(o.list.map(r => r.date))).sort().map(shortDay).join(', ')})`));
    }
    return out;
}

/** Jedan red po danu, radniku i nalogu: stavke se ne nabrajaju, procesi se skupe. */
export function workReportLines(rows: WorkReportRow[]): string[] {
    const groups = new Map<string, WorkReportRow[]>();
    rows.forEach(r => {
        const k = `${r.date}|${r.workerId}|${r.workOrderName}`;
        groups.set(k, [...(groups.get(k) || []), r]);
    });
    return Array.from(groups.values()).map(list => {
        const r = list[0];
        const processes = Array.from(new Set(list.map(x => x.process).filter(Boolean)));
        const products = Array.from(new Set(list.map(x => x.productName).filter(n => n && n !== r.workOrderName)));
        const days = tidy(list.reduce((s, x) => s + x.dayFraction, 0));
        return [
            shortDay(r.date), r.worker, dayText(days), orderLabel(r),
            processes.length ? processes.join(', ') : 'bez procesa',
            products.length === 1 ? products[0] : products.length ? `${products.length} proizvoda` : '',
            list.every(x => x.confirmed) ? 'upisano' : 'auto iz prisustva',
        ].filter(Boolean).join(' | ');
    });
}
