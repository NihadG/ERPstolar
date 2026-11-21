// ════════════════════════════════════════════════════════════════════
// PLATNO · MODEL RASPOREDA — INSTANCA PROBLEMA
//
// Plan proizvodnje zapisan kao matematički problem: raspoređivanje poslova s
// ograničenim ljudima i više mogućih ekipa (multi-mode RCPSP):
//
//   posao j      = nalog na platnu (order/montaža) s `workerDays` radnik-dana
//   ekipa (mod)  = jedan od kandidat-sastava (crewOptions); trajanje = rad ÷ veličina ekipe
//   resurs       = radnik, kapacitet po danu iz kalendara (calendar.ts), umanjen za
//                  zauzetost koja se ne raspoređuje (fiksno opterećenje)
//   prethodnost  = veze platna (prethodnik mora završiti prije početka, + razmak)
//   najraniji početak = kraj narudžbe/bloka koji nije posao, a vezan je za posao
//   rok          = rok projekta (Project.Deadline)
//
// Ekipa se prepoznaje po SASTAVU (`crewKey`), ne po id-u kandidata: isti par
// na dva naloga je isti resurs, iako svaki blok nosi svoju kopiju kandidata.
//
// Instanca je samo opis — ne mijenja scenarij i ne zna ništa o UI-ju.
// ════════════════════════════════════════════════════════════════════

import type { PlanBlock, PlanScenario, TaskPriority } from '../../types';
import { crewWorkerRefs } from '../../types';
import type { WorkerCalendar } from './calendar';

export interface Crew {
    key: string;
    workerIds: string[];
    /** Imena (prva riječ), istim redom kao `workerIds`. */
    names: string[];
    /** „Kemo i Rijad" — glavni prvi, za izvještaje. */
    label: string;
}

export interface Job {
    id: string;
    title: string;
    projectKey: string;
    projectName: string;
    workerDays: number;
    /** Dozvoljene ekipe (crewKey). Zaključan posao ima samo svoju. */
    crews: string[];
    priority: TaskPriority;
    releaseISO?: string;
    dueISO?: string;
    /** Smije ga raditi više ekipa (samo kad je nalog tako označen). */
    divisible: boolean;
    /** Zaključan: termin i ekipa su dati, ne raspoređuje se. */
    locked: boolean;
}

export interface Precedence { from: string; to: string; lagDays: number }

export interface Instance {
    startISO: string;
    horizonDays: number;
    jobs: Job[];
    crews: Map<string, Crew>;
    precedence: Precedence[];
    calendar: WorkerCalendar;
    /** Zauzetost radnika koja nije dio problema (0..1 po danu). */
    fixedLoad(workerId: string, iso: string): number;
}

export interface BuildOptions {
    startISO: string;
    calendar: WorkerCalendar;
    projects?: { Project_ID: string; Name?: string; Deadline?: string }[];
    fixedLoad?: (workerId: string, iso: string) => number;
    horizonDays?: number;
}

// ── Dani kao brojevi (UTC podne — imuno na ljetno vrijeme) ──────────

const DAY = 86_400_000;
export const dayIndex = (startISO: string, iso: string) => Math.round((Date.parse(`${iso}T12:00:00Z`) - Date.parse(`${startISO}T12:00:00Z`)) / DAY);
export const isoAt = (startISO: string, n: number) => new Date(Date.parse(`${startISO}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);

export const crewKeyOf = (workerIds: string[]) => Array.from(new Set(workerIds)).sort().join('+');

const JOB_KINDS = new Set<PlanBlock['kind']>(['order', 'montaza']);

/** Blok je posao modela: nalog/montaža s ekipom (kandidati ili dodijeljeni radnici). */
export function isJobBlock(b: PlanBlock): boolean {
    if (!JOB_KINDS.has(b.kind)) return false;
    return (b.crewOptions?.length || 0) > 0 || (b.workerRefs || []).some(r => r.id);
}

export function buildInstance(scenario: PlanScenario, opts: BuildOptions): Instance {
    const crews = new Map<string, Crew>();
    const addCrew = (refs: { id?: string; name: string }[]): string | null => {
        const withId = refs.filter(r => r.id);
        if (!withId.length) return null;
        const key = crewKeyOf(withId.map(r => r.id!));
        if (!crews.has(key)) {
            const name = new Map(withId.map(r => [r.id!, r.name.split(' ')[0]]));
            const workerIds = key.split('+');
            crews.set(key, {
                key,
                workerIds,
                names: workerIds.map(id => name.get(id) || id),
                label: withId.map(r => r.name.split(' ')[0]).join(' i '),
            });
        }
        return key;
    };
    const deadline = new Map((opts.projects || []).filter(p => p.Deadline).map(p => [p.Project_ID, String(p.Deadline).slice(0, 10)]));
    const projectName = new Map((opts.projects || []).map(p => [p.Project_ID, p.Name || '']));

    const jobBlocks = scenario.Blocks.filter(isJobBlock);
    const jobIds = new Set(jobBlocks.map(b => b.id));
    const jobs: Job[] = jobBlocks.map(b => {
        const locked = !!b.locked;
        const options = locked || !(b.crewOptions?.length)
            ? [addCrew(b.workerRefs || [])]
            : b.crewOptions!.map(c => addCrew(crewWorkerRefs(c)));
        const projectKey = b.projectRef?.id || `__solo__${b.id}`;
        return {
            id: b.id,
            title: b.title,
            projectKey,
            projectName: b.projectRef?.name || projectName.get(projectKey) || b.title,
            workerDays: Math.max(0, b.workerDays || 0),
            crews: Array.from(new Set(options.filter((k): k is string => !!k))),
            priority: b.priority || 'medium',
            dueISO: b.projectRef?.id ? deadline.get(b.projectRef.id) : undefined,
            divisible: !!b.divisible,
            locked,
        };
    });

    // Veze: posao→posao je prethodnost; ne-posao→posao (narudžba, rok) je najraniji početak.
    const byId = new Map(scenario.Blocks.map(b => [b.id, b]));
    const precedence: Precedence[] = [];
    const jobById = new Map(jobs.map(j => [j.id, j]));
    for (const l of scenario.Links || []) {
        const lag = Math.max(0, l.lagDays || 0);
        if (jobIds.has(l.from) && jobIds.has(l.to)) {
            precedence.push({ from: l.from, to: l.to, lagDays: lag });
        } else if (jobIds.has(l.to)) {
            const from = byId.get(l.from);
            const job = jobById.get(l.to)!;
            if (!from) continue;
            const release = isoAt(from.endISO, lag + 1);
            if (!job.releaseISO || release > job.releaseISO) job.releaseISO = release;
        }
    }

    return {
        startISO: opts.startISO,
        horizonDays: opts.horizonDays ?? 365,
        jobs,
        crews,
        precedence,
        calendar: opts.calendar,
        fixedLoad: opts.fixedLoad || (() => 0),
    };
}

/** Raspoloživost radnika nakon fiksnog opterećenja (0..1). */
export function freeCapacity(inst: Instance, workerId: string, iso: string): number {
    return Math.max(0, inst.calendar.available(workerId, iso) - inst.fixedLoad(workerId, iso));
}

/** Ekipa radi koliko njen najslabiji član može (cijela ekipa radi zajedno). */
export function crewCapacity(inst: Instance, crewKey: string, iso: string): number {
    const crew = inst.crews.get(crewKey);
    if (!crew) return 0;
    let min = 1;
    for (const w of crew.workerIds) min = Math.min(min, freeCapacity(inst, w, iso));
    return min;
}

/** Trajanje posla za ekipu u ekipa-danima (rad ÷ broj ljudi). */
export function crewDays(inst: Instance, job: Job, crewKey: string): number {
    const size = inst.crews.get(crewKey)?.workerIds.length || 1;
    return job.workerDays / size;
}
