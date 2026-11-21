// ════════════════════════════════════════════════════════════════════
// PLATNO · MODEL RASPOREDA — IZVJEŠTAJ O KVALITETU PLANA
//
// Ocjena (evaluate.ts) + donje granice (bounds.ts) u jednom: koliko je plan
// daleko od najboljeg mogućeg i šta ga drži. Isti izvještaj koristi mjera
// `npm run platno:ocjena`, a u fazi 3 i Platno uz svaki prijedlog rasporeda.
// ════════════════════════════════════════════════════════════════════

import type { Instance } from './instance';
import { dayIndex } from './instance';
import { evaluate, type Evaluation, type Placement } from './evaluate';
import { lowerBounds, type BoundsResult } from './bounds';

export interface QualityReport {
    evaluation: Evaluation;
    bounds: BoundsResult;
    /** Kalendarski dani između kraja plana i donje granice (0 = dokazano najbrže). */
    gapDays: number | null;
    urgentGapDays: number | null;
    highGapDays: number | null;
    lines: string[];
}

/** „1 dan", „21 dan", „3 dana" (bosanski: 1 i …1 osim 11 → dan). */
const daysWord = (n: number) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'dan' : 'dana'}`;
const dm = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.${iso.slice(0, 4)}`;
const VIOLATION_LABEL: Record<string, string> = {
    unassigned: 'bez ekipe', 'crew-not-allowed': 'ekipa van kandidata', 'too-short': 'raspon kraći od posla',
    overload: 'radnik preko kapaciteta dana', precedence: 'prije kraja prethodnika', release: 'prije najranijeg početka',
};

export function qualityReport(inst: Instance, placements: Placement[], baseline?: Placement[]): QualityReport {
    const evaluation = evaluate(inst, placements, baseline);
    const bounds = lowerBounds(inst, placements);
    const o = evaluation.objective;
    // Razlika do granice; negativna je moguća samo kod neizvodljivog plana.
    const gap = (end: number, b: { day: number } | null) => (b && end >= 0 ? end - b.day : null);
    const gapDays = gap(o.makespan, bounds.makespan);
    const urgentGapDays = gap(o.urgentEnd, bounds.urgent);
    const highGapDays = gap(o.highEnd, bounds.high);
    const feasible = o.violation === 0;
    const verdict = gapDays === null ? ''
        : gapDays < 0 ? 'završava prije dokazane granice — moguće samo kršenjem provjera'
            : !feasible ? `${daysWord(gapDays)} iznad granice, ali plan nije izvodljiv`
                : gapDays === 0 ? 'plan je dokazano najbrži' : `${daysWord(gapDays)} iznad granice`;

    const lines: string[] = [];
    lines.push(`Kraj plana: ${dm(evaluation.makespanISO)}${bounds.makespan ? ` · najranije moguće ${dm(bounds.makespan.iso)} (${verdict})` : ''}`);
    if (bounds.makespan) lines.push(`Granicu drži: ${bounds.makespan.text}`);
    if (o.urgentEnd >= 0) lines.push(`Hitno gotovo: ${dm(isoOf(inst, o.urgentEnd))}${bounds.urgent ? ` · najranije ${dm(bounds.urgent.iso)}` : ''}`);
    if (o.highEnd >= 0) lines.push(`Visok prioritet gotov: ${dm(isoOf(inst, o.highEnd))}${bounds.high ? ` · najranije ${dm(bounds.high.iso)}` : ''}`);
    lines.push(`Kašnjenje preko rokova: ${o.tardiness} dana · promjena projekta u nizu ekipa: ${o.switches}`);
    for (const p of evaluation.projects.filter(x => x.lateDays > 0)) {
        lines.push(`  ${p.name.trim()}: rok ${dm(p.dueISO!)}, plan ${dm(p.endISO)} — ${daysWord(p.lateDays)} kasni`);
    }
    const byKind = new Map<string, number>();
    evaluation.violations.forEach(v => byKind.set(v.kind, (byKind.get(v.kind) || 0) + 1));
    lines.push(byKind.size
        ? `Provjere: plan NIJE izvodljiv (zbir prekoračenja ${o.violation}) — ${Array.from(byKind.entries()).map(([k, n]) => `${VIOLATION_LABEL[k] || k} ${n}`).join(', ')}`
        : 'Provjere: sve prolaze — plan je izvodljiv');
    for (const c of evaluation.crews) {
        lines.push(`  ${c.label}: ${c.work} dana posla, ${c.firstISO ? dm(c.firstISO) : '-'} – ${c.lastISO ? dm(c.lastISO) : '-'}, praznih ${c.idle} · ${c.projects.join(' → ')}`);
    }
    return { evaluation, bounds, gapDays, urgentGapDays, highGapDays, lines };
}

const isoOf = (inst: Instance, day: number) => new Date(Date.parse(`${inst.startISO}T12:00:00Z`) + day * 86_400_000).toISOString().slice(0, 10);

/** Dan (indeks) iz datuma — za pozivaoce koji porede s granicom. */
export const dayOf = (inst: Instance, iso: string) => dayIndex(inst.startISO, iso);
