// ════════════════════════════════════════════════════════════════════
// PLATNO · PRIJEDLOG RASPOREDA (optimizator v2 → modal pregleda)
//
// Spaja sve dijelove modela u jedan poziv za Platno: kalendar radnika (smjene,
// šihtarica, praznici) → preostali rad stvarnih naloga → instanca → optimizator
// → izlaz u obliku koji modal „Prijedlog rasporeda" već zna (AutoScheduleResult),
// uz ocjenu PRIJE i POSLIJE i dokazanu donju granicu.
//
// Ništa ne mijenja: vraća prijedlog. Primjena ide kroz APPLY_SCHEDULE tek kad
// korisnik klikne „Primijeni" (čovjek pokreće, čovjek potvrđuje).
// ════════════════════════════════════════════════════════════════════

import type { PlanCrew, PlanScenario, Project, Worker, WorkerAttendance, WorkOrder } from '../../types';
import { crewWorkerRefs } from '../../types';
import type { AutoScheduleResult, ScheduledBlock, ScheduleReason } from '../autoSchedule';
import { buildWorkerCalendar } from './calendar';
import { buildInstance, crewKeyOf, isoAt, type Instance } from './instance';
import { placementsFromScenario } from './evaluate';
import { qualityReport, type QualityReport } from './quality';
import { remainingWork, type RemainingLog } from './remaining';
import { optimize, optimizeAsync, type JobSlack, type OptimizeResult } from './optimize';
import type { Binding } from './sgs';

export interface ProposeContext {
    workers: Worker[];
    workOrders: WorkOrder[];
    attendance: WorkerAttendance[];
    projects: Project[];
    holidays: string[];
    workLogs?: RemainingLog[];
}

export interface ProposalQuality {
    /** Dan 0 ocjene (indeksi dana u objective računaju se od njega). */
    startISO: string;
    before: QualityReport;
    after: QualityReport;
    evals: number;
}

export type Proposal = AutoScheduleResult & { quality: ProposalQuality };

const dm = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.`;

/** Blokovi koje optimizator smije pomjerati: nalog/montaža s kandidat-ekipama, nije zaključan. */
export function movableBlockIds(scenario: PlanScenario): Set<string> {
    return new Set(scenario.Blocks.filter(b => (b.kind === 'order' || b.kind === 'montaza') && !b.locked && (b.crewOptions?.length || 0) > 0).map(b => b.id));
}

function reasonsFor(inst: Instance, jobId: string, crewKey: string, binding: Binding | undefined, alts: { crewKey: string; endDay: number }[], slack: JobSlack | undefined, half: { startsPM?: boolean; endsAM?: boolean }): ScheduleReason[] {
    const out: ScheduleReason[] = [];
    const title = (id?: string) => inst.jobs.find(j => j.id === id)?.title || 'drugi nalog';
    const label = (k: string) => inst.crews.get(k)?.label || k;
    if (binding?.kind === 'precedence') out.push({ code: 'wait-prec', text: `čeka ${title(binding.jobId)} (kraj ${dm(binding.iso)})` });
    else if (binding?.kind === 'release') out.push({ code: 'wait-release', text: `najranije ${dm(binding.iso)} (materijal / prethodni korak)` });
    else if (binding?.kind === 'crew') out.push({ code: 'wait-crew', text: binding.jobId ? `ekipa zauzeta do ${dm(binding.iso)} (${title(binding.jobId)})` : `ekipa zauzeta do ${dm(binding.iso)}` });
    else out.push({ code: 'wait-start', text: 'kreće prvog slobodnog dana' });

    const others = alts.filter(a => a.crewKey !== crewKey);
    if (!others.length) out.push({ code: 'crew-only', text: `jedina ekipa: ${label(crewKey)}` });
    else {
        const mine = alts.find(a => a.crewKey === crewKey);
        const next = others.slice().sort((a, b) => a.endDay - b.endDay)[0];
        out.push({
            code: 'crew-choice',
            text: mine && next.endDay > mine.endDay
                ? `${label(crewKey)}: ${label(next.crewKey)} bi završili ${dm(isoAt(inst.startISO, next.endDay))}`
                : `${label(crewKey)}: bolje za cijeli plan`,
        });
    }
    if (half.startsPM) out.push({ code: 'half', text: 'počinje od podne' });
    if (half.endsAM) out.push({ code: 'half', text: 'završava u podne' });
    if (slack) out.push(slack.critical
        ? { code: 'critical', text: 'kritičan — kašnjenje pomjera kraj plana' }
        : { code: 'slack', text: `rezerva ${slack.slackDays} ${slack.slackDays === 1 ? 'radni dan' : 'radnih dana'}` });
    return out;
}

/**
 * @param opts.startISO prvi dan rasporeda; `todayISO` (zadano = startISO) je dan od kojeg se slaže
 *        preostali rad stvarnih naloga — kad plan kreće kasnije, posao do tada je već odrađen.
 */
type ProposeOptions = { startISO: string; todayISO?: string; budget?: number };

function prepare(scenario: PlanScenario, ctx: ProposeContext, opts: ProposeOptions) {
    const calendar = buildWorkerCalendar({ workers: ctx.workers, attendance: ctx.attendance, holidays: ctx.holidays });
    const linked = scenario.Blocks.map(b => b.linkedWorkOrderId).filter((x): x is string => !!x);
    const rest = remainingWork({ workOrders: ctx.workOrders, workLogs: ctx.workLogs, calendar, startISO: opts.todayISO || opts.startISO, skipWorkOrderIds: linked });
    const inst = buildInstance(scenario, { startISO: opts.startISO, calendar, projects: ctx.projects, fixedLoad: rest.fixedLoad });
    const current = placementsFromScenario(inst, scenario.Blocks);
    const movable = movableBlockIds(scenario);
    const before = qualityReport(inst, current);
    return { inst, current, movable, before };
}

function finish(scenario: PlanScenario, opts: ProposeOptions, prep: ReturnType<typeof prepare>, res: OptimizeResult): Proposal {
    const { inst, current, movable, before } = prep;
    const after = qualityReport(inst, res.placements, current);

    const blockById = new Map(scenario.Blocks.map(b => [b.id, b]));
    const scheduled: ScheduledBlock[] = [];
    for (const p of res.placements) {
        if (!movable.has(p.jobId) || !p.crewKey) continue;
        const b = blockById.get(p.jobId)!;
        const option: PlanCrew | undefined = (b.crewOptions || []).find(c => crewKeyOf(crewWorkerRefs(c).map(r => r.id || '')) === p.crewKey);
        if (!option) continue;
        const refs = crewWorkerRefs(option);
        const info = res.decoded.info.get(p.jobId);
        scheduled.push({
            blockId: p.jobId,
            crewId: option.id,
            workerRefs: refs,
            crew: refs.length,
            startISO: p.startISO,
            endISO: p.endISO,
            ...(p.startsPM ? { startsPM: true } : {}),
            ...(p.endsAM ? { endsAM: true } : {}),
            reasons: reasonsFor(inst, p.jobId, p.crewKey, info?.binding, info?.alternatives || [], res.slack.get(p.jobId), p),
        });
    }
    scheduled.sort((a, b) => a.startISO.localeCompare(b.startISO) || a.endISO.localeCompare(b.endISO) || a.blockId.localeCompare(b.blockId));
    const unscheduled = res.decoded.unplaced.filter(u => movable.has(u.jobId)).map(u => ({ blockId: u.jobId, reason: u.reason }));
    return { scheduled, unscheduled, quality: { startISO: opts.startISO, before, after, evals: res.evals } };
}

export function proposeSchedule(scenario: PlanScenario, ctx: ProposeContext, opts: ProposeOptions): Proposal {
    const prep = prepare(scenario, ctx, opts);
    return finish(scenario, opts, prep, optimize(prep.inst, prep.current, prep.movable, { budget: opts.budget }));
}

/** Za Platno: računa u komadima da ekran ne zastane; isti rezultat kao proposeSchedule. */
export async function proposeScheduleAsync(scenario: PlanScenario, ctx: ProposeContext, opts: ProposeOptions & { onProgress?: (evals: number, budget: number) => void }): Promise<Proposal> {
    const prep = prepare(scenario, ctx, opts);
    const res = await optimizeAsync(prep.inst, prep.current, prep.movable, { budget: opts.budget, onProgress: opts.onProgress });
    return finish(scenario, opts, prep, res);
}
