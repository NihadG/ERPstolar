// ════════════════════════════════════════════════════════════════════
// POTVRDE PO SLOJEVIMA — šta je upisano u koji dio ERP-a i šta nije dirano
//
//   🗓 Prisustvo   ko je bio na poslu (šihtarica)
//   📒 Knjiga rada gdje je otišao dan (dnevnice)
//   ⚙️ Procesi     dokle je proizvod
//
// Isti rezime za diktat (log_work) i potvrđen večernji prijedlog, da
// korisnik u oba slučaja vidi isto.
// ════════════════════════════════════════════════════════════════════

import { formatQty } from '@/lib/orderItemGroups';
import type { DiaryProcessNote, DiaryResult, ProgressResult } from '@/lib/server/workDiary';
import type { PresenceRow } from '@/lib/server/presence';

const q = (n: number) => formatQty(n);
const day = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.`;

export function dayLabel(f: number): string {
    if (Math.abs(f - 1) < 0.01) return '1 dan';
    if (Math.abs(f - 0.5) < 0.01) return '½ dana';
    return `${q(f)} dana`;
}

const noteWhere = (n: DiaryProcessNote) => `${n.workOrderName}${n.products.length ? ` (${n.products.join(', ')})` : ''}`;

/** „Amer, Kerim" ili „15 radnika" kad je lista duga. */
function people(names: string[]): string {
    return names.length > 6 ? `${names.length} radnika` : names.join(', ');
}

export function diarySummary(result: Extract<DiaryResult, { ok: true }>, dayName: string): string {
    const processLines = Array.from(new Set([
        ...result.rows.filter(r => r.process).map(r => `• ${r.process} ${r.done ? 'završeno' : 'u toku'} · ${r.workOrderName}${r.products.length ? ` (${r.products.join(', ')})` : ''}${r.graphAdded ? ' · novo u toku naloga' : ''}`),
        ...result.planned.map(n => `📋 Plan ${n.source === 'rules' ? 'iz pravila materijala' : n.source === 'template' ? 'po vrsti proizvoda' : 's kartice proizvoda'} · ${noteWhere(n)}: ${n.processes.join(' → ')}`),
        ...result.assumedDone.map(n => `☑️ Pretpostavljeno završeno${n.date ? ` ${day(n.date)} (zadnji rad)` : ''} · ${noteWhere(n)}: ${n.processes.join(', ')}`),
        ...(result.finished || []).map(n => `✔ Proizvod završen · ${noteWhere(n)}`),
        ...(result.newCatalog.length ? [`➕ U katalog procesa: ${result.newCatalog.join(', ')}`] : []),
    ]));   // dva radnika na istom procesu = jedan red
    // Proces se ne ponavlja u redu dnevnice kad ima svoj blok.
    const rows = result.rows.map(r => `• ${r.worker} — ${dayLabel(r.dayFraction)} · ${r.workOrderName}${r.products.length ? ` (${r.products.join(', ')})` : ''}`);
    const present = (result.presenceSet || []).filter(n => result.rows.some(r => r.worker === n));
    return [
        ...(rows.length ? [`📒 Knjiga rada, ${dayName}:`, ...rows] : []),
        ...(result.absences.length ? [`🗓 Prisustvo, ${dayName}:`, ...result.absences.map(x => `• ${x.worker} — ${x.status}`)] : []),
        ...(present.length ? [`🗓 Prisutan ${dayName}: ${people(present)}`] : []),
        ...(processLines.length ? ['⚙️ Procesi:', ...processLines] : []),
    ].join('\n');
}

export function presenceSummary(rows: PresenceRow[], status: string, dayName: string): string {
    const lines = [`🗓 Prisustvo, ${dayName}: ${status} — ${people(rows.map(r => r.worker))}`];
    if (status === 'Prisutan' || status === 'Teren') {
        const byOrders = new Map<string, string[]>();
        rows.filter(r => r.orders.length).forEach(r => {
            const k = r.orders.join(', ');
            byOrders.set(k, [...(byOrders.get(k) || []), r.worker]);
        });
        const without = rows.filter(r => r.noOrders).map(r => r.worker);
        if (byOrders.size || without.length) lines.push('📒 Knjiga rada — po šihtarici, kao u aplikaciji (nalozi od danas ili zadnjeg dana rada):');
        byOrders.forEach((workers, orders) => lines.push(`• ${people(workers)} → ${orders}`));
        if (without.length) lines.push(`• Bez naloga (nema ranijeg rada): ${without.join(', ')} — reci na čemu su radili`);
    } else {
        lines.push('📒 Knjiga rada — dnevnice tog dana uklonjene (ručni unos iz ERP-a ostaje).');
    }
    lines.push('⚙️ Procesi — nisu mijenjani.');
    return lines.join('\n');
}

export function progressSummary(res: Extract<ProgressResult, { ok: true }>, fmt: (date: string) => string): string {
    const head = res.process
        ? `⚙️ Procesi — ${res.process} ${res.state === 'done' ? 'završeno' : 'u toku'}${res.state === 'done' ? ' (dan zadnjeg rada iz Knjige rada)' : ''}:`
        : '⚙️ Procesi — proizvodi završeni (dan zadnjeg rada iz Knjige rada):';
    const lines = [head];
    for (const o of res.orders) {
        if (!o.products.length) continue;
        const dates = Array.from(new Set(o.products.map(p => p.date)));
        lines.push(dates.length === 1
            ? `• ${o.name} — ${o.products.length === 1 ? o.products[0].product : `${o.products.length} proizvoda`} · ${fmt(dates[0])}`
            : `• ${o.name} — ${o.products.map(p => `${p.product} ${fmt(p.date)}`).join(', ')}`);
        if (o.assumed.length) lines.push(`  ☑️ pretpostavljeno završeno ranije: ${o.assumed.join(', ')}`);
    }
    const skipped = res.orders.flatMap(o => o.skipped.map(p => `${p} (${o.name})`));
    const already = res.orders.flatMap(o => o.already);
    if (res.process && res.finished) lines.push(`✔ Proizvoda završeno: ${res.finished}`);
    if (skipped.length) lines.push(`Nije dirano: ${skipped.join(', ')}`);
    if (already.length) lines.push(`Već završeno od ranije: ${already.join(', ')}`);
    lines.push('📒 Knjiga rada i 🗓 prisustvo — nisu mijenjani.');
    return lines.join('\n');
}
