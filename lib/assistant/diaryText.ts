// ════════════════════════════════════════════════════════════════════
// TEKST DNEVNOG UPISA — isti rezime za diktat (log_work) i za potvrđen
// večernji prijedlog, da korisnik u oba slučaja vidi isto.
// ════════════════════════════════════════════════════════════════════

import { formatQty } from '@/lib/orderItemGroups';
import type { DiaryProcessNote, DiaryResult } from '@/lib/server/workDiary';

const q = (n: number) => formatQty(n);

export function dayLabel(f: number): string {
    if (Math.abs(f - 1) < 0.01) return '1 dan';
    if (Math.abs(f - 0.5) < 0.01) return '½ dana';
    return `${q(f)} dana`;
}

const noteWhere = (n: DiaryProcessNote) => `${n.workOrderName}${n.products.length ? ` (${n.products.join(', ')})` : ''}`;

export function diarySummary(result: Extract<DiaryResult, { ok: true }>, dayName: string): string {
    return [
        `🗓 Rad ${dayName}:`,
        ...result.rows.map(r => `• ${r.worker} — ${dayLabel(r.dayFraction)} · ${r.process ? `${r.process}${r.done ? ' ✔' : ''} · ` : ''}${r.workOrderName}${r.products.length ? ` (${r.products.join(', ')})` : ''}${r.graphAdded ? ' · novo u grafu' : ''}`),
        ...result.absences.map(x => `• ${x.worker} — ${x.status}`),
        ...result.planned.map(n => `📋 Plan ${n.source === 'rules' ? 'iz pravila materijala' : n.source === 'template' ? 'po vrsti proizvoda' : 's kartice proizvoda'} · ${noteWhere(n)}: ${n.processes.join(' → ')}`),
        ...result.assumedDone.map(n => `☑️ Podrazumijeva se završeno · ${noteWhere(n)}: ${n.processes.join(', ')}`),
        ...(result.newCatalog.length ? [`➕ U katalog procesa: ${result.newCatalog.join(', ')}`] : []),
    ].join('\n');
}
