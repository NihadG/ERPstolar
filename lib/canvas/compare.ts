// ════════════════════════════════════════════════════════════════════
// PLATNO — POREĐENJE SCENARIJA
//
// Odgovara na „isplati li se uzeti posao": duplicirаš plan, ubaciš novi nalog,
// i vidiš ŠTA TO KOŠTA — koliko konflikata nastane, koliko naraste vršno
// opterećenje, koliko se pomjeri zadnji datum.
//
// Namjerno MALO mjerila, i sva su posljedice koje se osjete u radionici.
// Broj blokova nije mjerilo kvalitete plana — zato ga nema u glavnom redu.
// ════════════════════════════════════════════════════════════════════

import type { PlanScenario } from '../types';
import { detectConflicts, type ConflictContext } from './conflicts';
import { dailyCapacity, capacitySummary, type CapacityContext } from './capacity';
import { diffDays } from './model';

export interface ScenarioKpi {
    scenarioId: string;
    name: string;
    blockCount: number;
    /** Ukupno problema; `errors` su oni koji stvarno blokiraju. */
    conflictCount: number;
    errorCount: number;
    /** Najviše opterećenje ijednog dana (1.0 = tačno popunjen kapacitet). */
    peakCapacityRatio: number | null;
    overloadedDays: number;
    /** Zadnji datum ijednog bloka — kad se plan „isprazni". */
    lastEndISO: string | null;
    /** Zbir radnik-dana svih blokova koji troše ljude. */
    totalWorkerDays: number;
    /** Narudžbe kojima je rok slanja već prošao. */
    overdueOrders: number;
}

export interface KpiDelta {
    key: keyof ScenarioKpi;
    label: string;
    a: string;
    b: string;
    /** Razlika kao tekst (npr. „+3", „−2 dana"); prazno kad nema promjene. */
    delta: string;
    /** Da li je B GORI od A po ovom mjerilu — boji se crveno. */
    worse: boolean;
    /** Nema smisla porediti (npr. oba prazna). */
    neutral: boolean;
}

const CONSUMES = new Set(['order', 'montaza', 'transport']);

export function computeScenarioKpi(
    scenario: PlanScenario,
    conflictCtx: ConflictContext,
    capacityCtx: CapacityContext,
    opts: { fromISO: string; days: number }
): ScenarioKpi {
    const conflicts = detectConflicts(scenario, conflictCtx);
    const cap = dailyCapacity(scenario, capacityCtx, opts.fromISO, opts.days);
    const summary = capacitySummary(cap);

    const lastEndISO = scenario.Blocks.length
        ? scenario.Blocks.reduce((max, b) => (b.endISO > max ? b.endISO : max), scenario.Blocks[0].endISO)
        : null;

    const totalWorkerDays = scenario.Blocks
        .filter(b => CONSUMES.has(b.kind))
        .reduce((s, b) => s + (b.workerDays || 0), 0);

    return {
        scenarioId: scenario.Scenario_ID,
        name: scenario.Name,
        blockCount: scenario.Blocks.length,
        conflictCount: conflicts.length,
        errorCount: conflicts.filter(c => c.severity === 'error').length,
        peakCapacityRatio: summary.peakRatio,
        overloadedDays: summary.overloadedCount,
        lastEndISO,
        totalWorkerDays: Math.round(totalWorkerDays * 100) / 100,
        overdueOrders: conflicts.filter(c => c.kind === 'order-overdue').length,
    };
}

const num = (n: number) => n.toLocaleString('hr-HR');
const signed = (n: number) => (n > 0 ? `+${num(n)}` : num(n));

/**
 * Razlike A → B. `worse` označava smjer koji boli u radionici:
 * više konflikata, veće opterećenje, kasniji završetak.
 */
export function compareScenarios(a: ScenarioKpi, b: ScenarioKpi): KpiDelta[] {
    const rows: KpiDelta[] = [];

    const numeric = (
        key: keyof ScenarioKpi,
        label: string,
        av: number,
        bv: number,
        opts?: { suffix?: string; higherIsWorse?: boolean },
    ) => {
        const d = bv - av;
        const higherIsWorse = opts?.higherIsWorse ?? true;
        rows.push({
            key,
            label,
            a: `${num(av)}${opts?.suffix || ''}`,
            b: `${num(bv)}${opts?.suffix || ''}`,
            delta: d === 0 ? '' : `${signed(d)}${opts?.suffix || ''}`,
            worse: d !== 0 && (higherIsWorse ? d > 0 : d < 0),
            neutral: d === 0,
        });
    };

    numeric('errorCount', 'Greške', a.errorCount, b.errorCount);
    numeric('conflictCount', 'Svi problemi', a.conflictCount, b.conflictCount);
    numeric('overdueOrders', 'Zakašnjele narudžbe', a.overdueOrders, b.overdueOrders);
    numeric('overloadedDays', 'Preopterećenih dana', a.overloadedDays, b.overloadedDays);

    // Vršno opterećenje: null kad nema kapaciteta (nema radnika/šihtarice)
    const ap = a.peakCapacityRatio;
    const bp = b.peakCapacityRatio;
    rows.push({
        key: 'peakCapacityRatio',
        label: 'Vršno opterećenje',
        a: ap === null ? '—' : `${Math.round(ap * 100)}%`,
        b: bp === null ? '—' : `${Math.round(bp * 100)}%`,
        delta: ap === null || bp === null || ap === bp
            ? ''
            : `${signed(Math.round((bp - ap) * 100))}%`,
        worse: ap !== null && bp !== null && bp > ap,
        neutral: ap === null || bp === null || ap === bp,
    });

    // Kasniji završetak = duže vezan kapacitet
    const dDays = a.lastEndISO && b.lastEndISO ? diffDays(a.lastEndISO, b.lastEndISO) : 0;
    rows.push({
        key: 'lastEndISO',
        label: 'Zadnji završetak',
        a: a.lastEndISO || '—',
        b: b.lastEndISO || '—',
        delta: !a.lastEndISO || !b.lastEndISO || dDays === 0 ? '' : `${signed(dDays)} d`,
        worse: dDays > 0,
        neutral: !a.lastEndISO || !b.lastEndISO || dDays === 0,
    });

    // Više posla NIJE samo po sebi loše (to je prihod) — zato neutralno
    const dw = b.totalWorkerDays - a.totalWorkerDays;
    rows.push({
        key: 'totalWorkerDays',
        label: 'Ukupno radnik-dana',
        a: num(a.totalWorkerDays),
        b: num(b.totalWorkerDays),
        delta: dw === 0 ? '' : signed(Math.round(dw * 100) / 100),
        worse: false,
        neutral: true,
    });

    return rows;
}
