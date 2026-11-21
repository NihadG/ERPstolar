// ════════════════════════════════════════════════════════════════════
// PLATNO · MODEL RASPOREDA — OCJENA PLANA
//
// Dvije stvari, obje deterministične i bez izmjena plana:
//
// 1. PROVJERE (invarijante) — šta plan krši:
//      bez ekipe · ekipa koja nije među kandidatima · raspon kraći od posla ·
//      radnik preko kapaciteta dana · prethodnik nije završio · počinje prije
//      najranijeg početka
//    Opterećenje dana: posao ekipe ravnomjerno po danima raspona, srazmjerno
//    raspoloživosti ekipe (dan s pola kapaciteta nosi pola). Isto pravilo kao
//    capacity.ts, ali po radniku i s kalendarom radnika.
//
// 2. CILJ — vektor koji se poredi leksikografski, redom koji je korisnik odobrio
//    21.11.2026 (svaki sljedeći odlučuje tek kad su prethodni jednaki):
//      (0) izvodljivost                    violation (zbir prekoračenja provjera) —
//          plan koji krši provjere je uvijek lošiji od izvodljivog, ma kad završio
//      (1) sve gotovo što prije            makespan
//      (2) prioritetni projekti što prije  urgentEnd, highEnd
//      (3) bez kašnjenja preko roka        tardiness (dani)
//      (4) ekipa ostaje na projektu        switches (promjene projekta u nizu ekipe)
//      (5) kod preračuna što manje pomjeranja  moved, shiftDays (prema baseline)
//    Dani su indeksi od početka plana (0 = startISO).
// ════════════════════════════════════════════════════════════════════

import type { Instance, Job } from './instance';
import { crewCapacity, crewDays, dayIndex, freeCapacity, isoAt } from './instance';

export interface Placement {
    jobId: string;
    crewKey: string | null;
    startISO: string;
    endISO: string;
    /** Dio posla u ovom komadu (dijeljiv nalog); bez toga cijeli posao. */
    workerDays?: number;
    /** Počinje od podne — prvi dan daje pola kapaciteta (jedinica ½ dana). */
    startsPM?: boolean;
    /** Završava u podne — zadnji dan daje pola kapaciteta. */
    endsAM?: boolean;
}

export type ViolationKind = 'unassigned' | 'crew-not-allowed' | 'too-short' | 'overload' | 'precedence' | 'release';

export interface Violation {
    kind: ViolationKind;
    jobId?: string;
    workerId?: string;
    dateISO?: string;
    /** Koliko je prekoračeno (dio dana, ekipa-dani ili dani). */
    amount?: number;
    text: string;
}

export interface Objective {
    /** Zbir prekoračenja svih provjera (dani / radnik-dani); 0 = izvodljiv plan. */
    violation: number;
    makespan: number;
    urgentEnd: number;
    highEnd: number;
    tardiness: number;
    switches: number;
    moved: number;
    shiftDays: number;
}

export const OBJECTIVE_ORDER: (keyof Objective)[] = ['violation', 'makespan', 'urgentEnd', 'highEnd', 'tardiness', 'switches', 'moved', 'shiftDays'];

/** <0 kad je `a` bolji. Leksikografski po OBJECTIVE_ORDER. */
export function compareObjectives(a: Objective, b: Objective): number {
    for (const k of OBJECTIVE_ORDER) if (a[k] !== b[k]) return a[k] - b[k];
    return 0;
}

export interface CrewStat {
    key: string;
    label: string;
    /** Posao u ekipa-danima. */
    work: number;
    firstISO: string | null;
    lastISO: string | null;
    /** Raspoloživi ekipa-dani između prvog i zadnjeg posla koji nisu iskorišteni. */
    idle: number;
    /** Projekti redom kojim ih ekipa radi (uzastopni isti spojeni). */
    projects: string[];
}

export interface ProjectStat { key: string; name: string; endISO: string; dueISO?: string; lateDays: number; priority: Job['priority'] }

export interface Evaluation {
    objective: Objective;
    makespanISO: string;
    violations: Violation[];
    crews: CrewStat[];
    projects: ProjectStat[];
}

const EPS = 1e-6;
const PRIO_RANK: Record<Job['priority'], number> = { urgent: 4, high: 3, medium: 2, low: 1 };

/** Plan sa platna: raspored kakav je sad (datumi i dodijeljeni radnici blokova). */
export function placementsFromScenario(inst: Instance, blocks: { id: string; startISO: string; endISO: string; workerRefs?: { id?: string }[]; startsPM?: boolean; endsAM?: boolean }[]): Placement[] {
    const jobIds = new Set(inst.jobs.map(j => j.id));
    return blocks.filter(b => jobIds.has(b.id)).map(b => {
        const ids = (b.workerRefs || []).map(r => r.id).filter((x): x is string => !!x);
        const key = ids.length ? Array.from(new Set(ids)).sort().join('+') : null;
        return { jobId: b.id, crewKey: key, startISO: b.startISO, endISO: b.endISO, ...(b.startsPM ? { startsPM: true } : {}), ...(b.endsAM ? { endsAM: true } : {}) };
    });
}

/**
 * Najviše koliko dana komad smije uzeti na rubnom danu (jedinica ½ dana): prvi dan od podne
 * ili zadnji do podne = 0,5; jednodnevni komad s oznakom = 0,5. Tako dva bloka iste ekipe dijele
 * dan bez prekoračenja (1,5 dana posla + sljedeći od podne).
 */
function halfCap(p: Placement, first: boolean, last: boolean): number {
    if (first && last) return p.startsPM || p.endsAM ? 0.5 : 1;
    if (first && p.startsPM) return 0.5;
    if (last && p.endsAM) return 0.5;
    return 1;
}

export function evaluate(inst: Instance, placements: Placement[], baseline?: Placement[]): Evaluation {
    const violations: Violation[] = [];
    const jobById = new Map(inst.jobs.map(j => [j.id, j]));
    const byJob = new Map<string, Placement[]>();
    for (const p of placements) byJob.set(p.jobId, [...(byJob.get(p.jobId) || []), p]);
    const load = new Map<string, Map<string, number>>();   // radnik → dan → opterećenje
    const addLoad = (w: string, iso: string, v: number) => {
        let m = load.get(w);
        if (!m) { m = new Map(); load.set(w, m); }
        m.set(iso, (m.get(iso) || 0) + v);
    };
    const start = new Map<string, number>(), end = new Map<string, number>();

    for (const job of inst.jobs) {
        const parts = byJob.get(job.id) || [];
        const assigned = parts.filter(p => p.crewKey);
        const share = assigned.reduce((s, p) => s + (p.workerDays ?? job.workerDays), 0);
        if (!assigned.length || share < job.workerDays - EPS) {
            violations.push({ kind: 'unassigned', jobId: job.id, amount: job.workerDays - share, text: `${job.title}: nije raspoređeno ${round(job.workerDays - share)} radnik-dana` });
        }
        for (const p of parts) {
            const s = dayIndex(inst.startISO, p.startISO), e = dayIndex(inst.startISO, p.endISO);
            start.set(job.id, Math.min(start.get(job.id) ?? s, s));
            end.set(job.id, Math.max(end.get(job.id) ?? e, e));
            if (!p.crewKey) continue;
            if (!job.locked && !job.crews.includes(p.crewKey)) {
                violations.push({ kind: 'crew-not-allowed', jobId: job.id, amount: 1, text: `${job.title}: ekipa ${inst.crews.get(p.crewKey)?.label || p.crewKey} nije među kandidatima` });
            }
            const crew = inst.crews.get(p.crewKey);
            const workerIds = crew ? crew.workerIds : p.crewKey.split('+');
            const need = (p.workerDays ?? job.workerDays) / workerIds.length;
            const days: { iso: string; cap: number }[] = [];
            for (let d = s; d <= e && days.length < 400; d++) {
                const iso = isoAt(inst.startISO, d);
                const full = crew ? crewCapacity(inst, crew.key, iso) : Math.min(...workerIds.map(w => freeCapacity(inst, w, iso)));
                const cap = Math.min(full, halfCap(p, d === s, d === e));
                if (cap > 0) days.push({ iso, cap });
            }
            const total = days.reduce((x, d) => x + d.cap, 0);
            if (total + EPS < need) {
                violations.push({ kind: 'too-short', jobId: job.id, amount: need - total, text: `${job.title}: raspon ima ${round(total)} radnih dana ekipe, a posao traži ${round(need)}` });
            }
            // Prekratak raspon: dani se pune do kapaciteta, a ostatak je već prijavljen kao too-short
            // (inače bi isti nedostatak bio brojan dvaput — i kao prekoračenje dana).
            const fill = total + EPS < need ? 1 : (total > 0 ? need / total : 0);
            for (const d of days) for (const w of workerIds) addLoad(w, d.iso, d.cap * fill);
        }
        if (job.releaseISO && start.has(job.id) && start.get(job.id)! < dayIndex(inst.startISO, job.releaseISO)) {
            violations.push({ kind: 'release', jobId: job.id, dateISO: job.releaseISO, amount: dayIndex(inst.startISO, job.releaseISO) - start.get(job.id)!, text: `${job.title}: počinje prije ${job.releaseISO} (materijal / prethodni korak)` });
        }
    }

    for (const [w, days] of load) {
        for (const [iso, v] of days) {
            const cap = inst.calendar.available(w, iso) - inst.fixedLoad(w, iso);
            if (v > cap + EPS) {
                violations.push({ kind: 'overload', workerId: w, dateISO: iso, amount: v - cap, text: `${workerName(inst, w)} ${iso}: ${round(v)} dana posla, može ${round(Math.max(0, cap))}` });
            }
        }
    }

    for (const pr of inst.precedence) {
        const fe = end.get(pr.from), ts = start.get(pr.to);
        if (fe === undefined || ts === undefined) continue;
        if (ts <= fe + pr.lagDays) {
            violations.push({ kind: 'precedence', jobId: pr.to, amount: fe + pr.lagDays + 1 - ts, text: `${jobById.get(pr.to)?.title}: počinje prije kraja ${jobById.get(pr.from)?.title}` });
        }
    }

    // ── Cilj ──
    const makespan = Math.max(-1, ...Array.from(end.values()));
    const lastOf = (rank: number) => Math.max(-1, ...inst.jobs.filter(j => PRIO_RANK[j.priority] === rank && end.has(j.id)).map(j => end.get(j.id)!));

    const projects = new Map<string, ProjectStat>();
    for (const j of inst.jobs) {
        if (!end.has(j.id)) continue;
        const iso = isoAt(inst.startISO, end.get(j.id)!);
        const cur = projects.get(j.projectKey);
        const priority = cur && PRIO_RANK[cur.priority] > PRIO_RANK[j.priority] ? cur.priority : j.priority;
        if (!cur || iso > cur.endISO) projects.set(j.projectKey, { key: j.projectKey, name: j.projectName, endISO: iso, dueISO: j.dueISO, lateDays: 0, priority });
        else cur.priority = priority;
    }
    let tardiness = 0;
    for (const p of projects.values()) {
        p.lateDays = p.dueISO ? Math.max(0, dayIndex(p.dueISO, p.endISO)) : 0;
        tardiness += p.lateDays;
    }

    const crews: CrewStat[] = [];
    let switches = 0;
    const perCrew = new Map<string, Placement[]>();
    for (const p of placements) if (p.crewKey) perCrew.set(p.crewKey, [...(perCrew.get(p.crewKey) || []), p]);
    for (const [key, list] of perCrew) {
        const seq = list.slice().sort((a, b) => a.startISO.localeCompare(b.startISO) || a.endISO.localeCompare(b.endISO));
        const names: string[] = [];
        let work = 0;
        for (const p of seq) {
            const job = jobById.get(p.jobId);
            if (!job) continue;
            work += (p.workerDays ?? job.workerDays) / (inst.crews.get(key)?.workerIds.length || 1);
            if (names[names.length - 1] !== job.projectKey) names.push(job.projectKey);
        }
        switches += Math.max(0, names.length - 1);
        const first = seq[0].startISO, last = seq.reduce((m, p) => (p.endISO > m ? p.endISO : m), seq[0].endISO);
        let avail = 0;
        for (let d = dayIndex(inst.startISO, first); d <= dayIndex(inst.startISO, last); d++) avail += crewCapacity(inst, key, isoAt(inst.startISO, d));
        crews.push({
            key, label: inst.crews.get(key)?.label || key, work: round(work), firstISO: first, lastISO: last,
            idle: round(Math.max(0, avail - work)),
            projects: names.map(k => inst.jobs.find(j => j.projectKey === k)?.projectName || k),
        });
    }

    let moved = 0, shiftDays = 0;
    if (baseline) {
        const base = new Map(baseline.map(p => [p.jobId, p]));
        for (const p of placements) {
            const b = base.get(p.jobId);
            if (!b) continue;
            const dd = Math.abs(dayIndex(b.startISO, p.startISO));
            if (dd > 0 || b.crewKey !== p.crewKey) moved++;
            shiftDays += dd;
        }
    }

    return {
        objective: { violation: round(violations.reduce((s, v) => s + (v.amount || 0), 0)), makespan, urgentEnd: lastOf(4), highEnd: lastOf(3), tardiness, switches, moved, shiftDays },
        makespanISO: makespan >= 0 ? isoAt(inst.startISO, makespan) : inst.startISO,
        violations,
        crews: crews.sort((a, b) => a.label.localeCompare(b.label)),
        projects: Array.from(projects.values()).sort((a, b) => a.endISO.localeCompare(b.endISO)),
    };
}

function workerName(inst: Instance, workerId: string): string {
    for (const c of inst.crews.values()) {
        const i = c.workerIds.indexOf(workerId);
        if (i >= 0) return c.names[i] || workerId;
    }
    return workerId;
}

const round = (n: number) => Math.round(n * 100) / 100;
