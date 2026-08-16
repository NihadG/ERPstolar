// ════════════════════════════════════════════════════════════════════
// PLATNO — AUTOMATSKI RASPORED (RCPSP heuristik, deterministički i objašnjiv)
//
// Problem: rasporedi order/montaza blokove kroz vrijeme i radnike. Resurs =
// radnik (JEDAN nalog po radniku po danu). Svaki blok bira JEDNU ekipu iz
// `crewOptions`; trajanje = radnik-dani ÷ veličina ekipe (radni dani). Zauzeti su
// i stvarni preuzeti nalozi, odsustva iz šihtarice, te ručni/zaključani blokovi
// scenarija — auto planira OKO njih, ne preko njih.
//
// NIJE predviđanje (to je odbijeno): svi ulazi (radnik-dani, kandidat-ekipe,
// prioritet) daje korisnik. Ovo je determinističko PAKOVANJE poznatog posla.
// Isti ulaz → isti izlaz. Svaki blok nosi objašnjenje zašto je tu — da se može
// pregledati i ručno korigovati, a ne prihvatati na vjeru.
//
// Ciljevi (redom važnosti, kako je korisnik tražio):
//   1. prioritet (urgent/high ranije),
//   2. projekat zbijen u jednom periodu i završen prije prelaska na sljedeći,
//   3. isti glavni radnik na istom projektu (kontinuitet),
//   4. vrijednost/profit kao težina redoslijeda,
//   5. izvodljivost (nikad dupli radnik istog dana; odsustva; stvarni posao),
//   6. rokovi projekta.
//
// Izlaz je DIFF — ne primjenjuje se odmah. Korisnik ga pregleda pa „Primijeni".
// ════════════════════════════════════════════════════════════════════

import type {
    PlanScenario, PlanBlock, PlanCrew, PlanRef, Worker, WorkOrder, WorkerAttendance,
    Project, TaskPriority,
} from '../types';
import { crewSize, crewWorkerRefs } from '../types';
import { addDays, diffDays, isWorkDay, workingDaysNeeded } from './model';

// ── Tipovi ──────────────────────────────────────────────────────────

export interface AutoScheduleContext {
    workers: Worker[];
    workOrders: WorkOrder[];
    attendance: WorkerAttendance[];
    projects: Project[];
    isSaturdayWorking?: (d: Date) => boolean;
    /** Vrijednost projekta (npr. iz ponude) → gura vrednije ranije. Opcion. */
    projectValue?: Map<string, number>;
}

export interface ScheduleWeights {
    /** Koliko dana kasnije smijemo prihvatiti ekipu radi kontinuiteta (default 3). */
    continuityDays: number;
    /** Koliko daleko unaprijed tražimo slobodan termin (kalendarski dani). */
    horizonDays: number;
    /**
     * Koliko puta se prolazi kroz sabijanje (popunjavanje rupa). 0 gasi.
     * Više prolaza jer oslobađanje jednog bloka može otvoriti mjesto drugom.
     */
    compactPasses: number;
}

export const DEFAULT_WEIGHTS: ScheduleWeights = { continuityDays: 3, horizonDays: 180, compactPasses: 2 };

export interface AutoScheduleOptions {
    startISO: string;                    // najraniji dan za raspored
    weights?: Partial<ScheduleWeights>;
}

export interface ScheduleReason { code: string; text: string; }

export interface ScheduledBlock {
    blockId: string;
    crewId: string;
    workerRefs: PlanRef[];
    crew: number;
    startISO: string;
    endISO: string;
    reasons: ScheduleReason[];
}

export interface UnscheduledBlock { blockId: string; reason: string; }

export interface AutoScheduleResult {
    scheduled: ScheduledBlock[];
    unscheduled: UnscheduledBlock[];
}

const PRIORITY_RANK: Record<TaskPriority, number> = { urgent: 4, high: 3, medium: 2, low: 1 };
const ABSENT = new Set(['Odsutan', 'Bolovanje', 'Odmor', 'Vikend', 'Praznik']);
/** Vrste koje zauzimaju radnika (ostale su logistika/oznake). */
const CONSUMES = new Set<PlanBlock['kind']>(['order', 'montaza', 'transport']);

// ── Kalendar radnih dana ────────────────────────────────────────────

function firstWorkingOnOrAfter(iso: string, isSat?: (d: Date) => boolean): string {
    let cur = iso;
    for (let i = 0; i < 30 && !isWorkDay(cur, isSat); i++) cur = addDays(cur, 1);
    return cur;
}

function nextWorkingDay(iso: string, isSat?: (d: Date) => boolean): string {
    let cur = addDays(iso, 1);
    for (let i = 0; i < 30 && !isWorkDay(cur, isSat); i++) cur = addDays(cur, 1);
    return cur;
}

/** Radni dani bloka u [start, end], uključivo. */
function workingDaysInSpan(startISO: string, endISO: string, isSat?: (d: Date) => boolean): string[] {
    const out: string[] = [];
    let cur = startISO;
    for (let i = 0; i <= 500 && cur <= endISO; i++) {
        if (isWorkDay(cur, isSat)) out.push(cur);
        cur = addDays(cur, 1);
    }
    return out;
}

// ── Zauzetost radnika (pozadina koju auto NE dira) ──────────────────

type BusyMap = Map<string, Set<string>>;   // workerId → set dateISO

function markBusy(busy: BusyMap, workerId: string, dates: string[]): void {
    let set = busy.get(workerId);
    if (!set) { set = new Set(); busy.set(workerId, set); }
    for (const d of dates) set.add(d);
}

/** Oslobodi dane radnika — treba sabijanju da blok ne blokira sam sebe. */
function unmarkBusy(busy: BusyMap, workerId: string, dates: string[]): void {
    const set = busy.get(workerId);
    if (!set) return;
    for (const d of dates) set.delete(d);
}

function isFree(busy: BusyMap, workerId: string, dates: string[]): boolean {
    const set = busy.get(workerId);
    if (!set) return true;
    for (const d of dates) if (set.has(d)) return false;
    return true;
}

/**
 * Pozadinska zauzetost: stvarni nalozi + odsustva + ručni/zaključani blokovi
 * scenarija (oni koji se NE raspoređuju). Auto planira oko svega ovoga.
 */
function buildBusyCalendar(
    scenario: PlanScenario,
    ctx: AutoScheduleContext,
    toScheduleIds: Set<string>
): BusyMap {
    const busy: BusyMap = new Map();
    const isSat = ctx.isSaturdayWorking;

    // 1) Stvarni preuzeti nalozi — radnici zauzeti kroz cijeli raspon naloga.
    for (const wo of ctx.workOrders) {
        if (wo.Status === 'Završeno' || wo.Status === 'Otkazano') continue;
        const start = (wo.Started_At || wo.Planned_Start_Date || '').split('T')[0];
        const end = (wo.Due_Date || wo.Planned_End_Date || start || '').split('T')[0];
        if (!start || !end || end < start) continue;
        const days = workingDaysInSpan(start, end, isSat);
        if (!days.length) continue;
        const ids = new Set<string>();
        for (const item of wo.items || []) {
            (item.Assigned_Workers || []).forEach(w => w.Worker_ID && ids.add(w.Worker_ID));
            (item.Processes || []).forEach(p => {
                if (p.Worker_ID) ids.add(p.Worker_ID);
                (p.Helpers || []).forEach(h => h.Worker_ID && ids.add(h.Worker_ID));
            });
        }
        for (const id of ids) markBusy(busy, id, days);
    }

    // 2) Odsustva iz šihtarice.
    for (const a of ctx.attendance) {
        if (a.Worker_ID && a.Date && ABSENT.has(a.Status)) markBusy(busy, a.Worker_ID, [a.Date.split('T')[0]]);
    }

    // 3) Ručni/zaključani blokovi scenarija koji se NE raspoređuju.
    for (const b of scenario.Blocks) {
        if (toScheduleIds.has(b.id)) continue;
        if (!CONSUMES.has(b.kind)) continue;
        const refs = b.workerRefs || [];
        if (!refs.length) continue;
        const days = workingDaysInSpan(b.startISO, b.endISO, isSat);
        for (const w of refs) if (w.id) markBusy(busy, w.id, days);
    }

    return busy;
}

// ── Slot: najraniji izvodljiv termin za ekipu ───────────────────────

interface Slot { startISO: string; endISO: string; days: string[]; }

/**
 * Najraniji termin od `earliestISO` u kojem ekipa ima `needed` UZASTOPNIH radnih
 * dana slobodnih za SVE članove. Posao se ne prekida — traži se neprekinut niz
 * radnih dana (vikend/praznik ga ne prekidaju, samo ga produže kalendarski).
 */
function earliestFeasibleSlot(
    crew: PlanCrew,
    needed: number,
    earliestISO: string,
    busy: BusyMap,
    isSat: ((d: Date) => boolean) | undefined,
    horizonEndISO: string
): Slot | null {
    const workerIds = crewWorkerRefs(crew).map(r => r.id).filter((x): x is string => !!x);
    let candidate = firstWorkingOnOrAfter(earliestISO, isSat);

    while (candidate <= horizonEndISO) {
        // Skupi `needed` radnih dana počev od candidate.
        const days: string[] = [];
        let cur = candidate;
        let guard = 0;
        while (days.length < needed && guard++ < 1000) {
            if (isWorkDay(cur, isSat)) days.push(cur);
            if (days.length < needed) cur = addDays(cur, 1);
        }
        if (days.length < needed || days[days.length - 1] > horizonEndISO) return null;

        const allFree = workerIds.every(id => isFree(busy, id, days));
        if (allFree) return { startISO: candidate, endISO: days[days.length - 1], days };

        candidate = nextWorkingDay(candidate, isSat);
    }
    return null;
}

// ── Redoslijed: projekat prije projekta, unutar toga precedenca ─────

function blockPriorityRank(b: PlanBlock): number {
    return PRIORITY_RANK[b.priority || 'medium'];
}

function projectKey(b: PlanBlock): string {
    return b.projectRef?.id || `__solo__${b.id}`;   // razni/bez projekta = vlastita grupa
}

/** Skor projekta za redoslijed (veći = ranije): prioritet ▸ rok ▸ vrijednost. */
function projectScores(
    blocks: PlanBlock[],
    ctx: AutoScheduleContext,
    startISO: string
): Map<string, number> {
    const deadlineByProject = new Map<string, string>();
    for (const p of ctx.projects) {
        if (p.Project_ID && p.Deadline) deadlineByProject.set(p.Project_ID, p.Deadline.split('T')[0]);
    }
    const agg = new Map<string, { maxRank: number; workerDays: number; projectId?: string }>();
    for (const b of blocks) {
        const key = projectKey(b);
        const a = agg.get(key) || { maxRank: 0, workerDays: 0, projectId: b.projectRef?.id };
        a.maxRank = Math.max(a.maxRank, blockPriorityRank(b));
        a.workerDays += b.workerDays || 0;
        agg.set(key, a);
    }
    const out = new Map<string, number>();
    for (const [key, a] of agg) {
        const deadline = a.projectId ? deadlineByProject.get(a.projectId) : undefined;
        const deadlineUrgency = deadline ? Math.max(0, 1000 - Math.max(0, diffDays(startISO, deadline))) : 0;
        const value = a.projectId && ctx.projectValue?.has(a.projectId)
            ? ctx.projectValue.get(a.projectId)!
            : a.workerDays;   // proxy: obim rada korelira s prihodom
        // Slojevi magnitude: prioritet dominira, pa rok, pa vrijednost.
        out.set(key, a.maxRank * 1_000_000 + deadlineUrgency * 1_000 + value);
    }
    return out;
}

/**
 * Topološki redoslijed (Kahn) uz precedencu iz veza; među „spremnima" bira po
 * skoru projekta pa prioritetu pa obimu — tako se projekat drži na okupu i ide
 * po važnosti, a montaža nikad ne ide prije proizvodnje.
 */
function scheduleOrder(
    blocks: PlanBlock[],
    scenario: PlanScenario,
    pScore: Map<string, number>
): PlanBlock[] {
    const inSet = new Set(blocks.map(b => b.id));
    const byId = new Map(blocks.map(b => [b.id, b]));
    const indeg = new Map<string, number>(blocks.map(b => [b.id, 0]));
    const succ = new Map<string, string[]>(blocks.map(b => [b.id, []]));
    for (const l of scenario.Links) {
        if (inSet.has(l.from) && inSet.has(l.to)) {
            indeg.set(l.to, (indeg.get(l.to) || 0) + 1);
            succ.get(l.from)!.push(l.to);
        }
    }
    const cmp = (a: PlanBlock, b: PlanBlock): number => {
        const sa = pScore.get(projectKey(a)) || 0, sb = pScore.get(projectKey(b)) || 0;
        if (sa !== sb) return sb - sa;                                   // veći skor ranije
        const ka = projectKey(a), kb = projectKey(b);
        if (ka !== kb) return ka < kb ? -1 : 1;                          // stabilno grupiši projekt
        const pa = blockPriorityRank(a), pb = blockPriorityRank(b);
        if (pa !== pb) return pb - pa;
        const wa = a.workerDays || 0, wb = b.workerDays || 0;
        if (wa !== wb) return wb - wa;                                   // veći posao ranije
        return a.id < b.id ? -1 : 1;
    };
    const ready = blocks.filter(b => (indeg.get(b.id) || 0) === 0).sort(cmp);
    const out: PlanBlock[] = [];
    while (ready.length) {
        const next = ready.shift()!;
        out.push(next);
        for (const s of succ.get(next.id) || []) {
            indeg.set(s, (indeg.get(s) || 0) - 1);
            if ((indeg.get(s) || 0) === 0) {
                const nb = byId.get(s)!;
                // ubaci sortirano (stabilno) — mali nizovi, jeftino
                const idx = ready.findIndex(r => cmp(nb, r) < 0);
                if (idx < 0) ready.push(nb); else ready.splice(idx, 0, nb);
            }
        }
    }
    // Ako je ostao ciklus (ne bi trebao — wouldCreateCycle štiti veze), dodaj ostatak.
    if (out.length < blocks.length) {
        for (const b of blocks) if (!out.includes(b)) out.push(b);
    }
    return out;
}

// ── Precedenca: najraniji start iz prethodnika ──────────────────────

function earliestStartFromPredecessors(
    block: PlanBlock,
    scenario: PlanScenario,
    scheduledEnd: Map<string, string>,
    globalStart: string
): string {
    let earliest = globalStart;
    for (const l of scenario.Links) {
        if (l.to !== block.id) continue;
        const pred = scenario.Blocks.find(b => b.id === l.from);
        if (!pred) continue;
        const predEnd = scheduledEnd.get(pred.id) || pred.endISO;
        const lag = l.lagDays || 0;
        const after = addDays(predEnd, lag + 1);   // dan POSLIJE kraja prethodnika + zaštita
        if (after > earliest) earliest = after;
    }
    return earliest;
}

// ── Glavni ulaz ─────────────────────────────────────────────────────

/**
 * Blokovi koje auto raspoređuje: order/montaza, NIJE zaključan, IMA kandidat-ekipe.
 * Sve ostalo je pozadina (fiksno) oko koje se planira.
 */
export function schedulableBlocks(scenario: PlanScenario): PlanBlock[] {
    return scenario.Blocks.filter(b =>
        (b.kind === 'order' || b.kind === 'montaza')
        && !b.locked
        && (b.crewOptions?.length || 0) > 0
    );
}

export function autoSchedule(
    scenario: PlanScenario,
    ctx: AutoScheduleContext,
    options: AutoScheduleOptions
): AutoScheduleResult {
    const weights = { ...DEFAULT_WEIGHTS, ...options.weights };
    const isSat = ctx.isSaturdayWorking;
    const globalStart = firstWorkingOnOrAfter(options.startISO, isSat);
    const horizonEnd = addDays(globalStart, weights.horizonDays);

    const toSchedule = schedulableBlocks(scenario);
    const toScheduleIds = new Set(toSchedule.map(b => b.id));
    if (!toSchedule.length) return { scheduled: [], unscheduled: [] };

    const busy = buildBusyCalendar(scenario, ctx, toScheduleIds);
    const pScore = projectScores(toSchedule, ctx, globalStart);
    const order = scheduleOrder(toSchedule, scenario, pScore);

    const scheduled: ScheduledBlock[] = [];
    const unscheduled: UnscheduledBlock[] = [];
    const scheduledEnd = new Map<string, string>();
    // Koji su glavni radnici već na kom projektu (kontinuitet).
    const projectLeads = new Map<string, Set<string>>();

    for (const block of order) {
        const pkey = projectKey(block);
        const earliest = earliestStartFromPredecessors(block, scenario, scheduledEnd, globalStart);
        const options0 = block.crewOptions || [];

        const best = bestCandidate(
            block, earliest, busy, isSat, horizonEnd, globalStart,
            weights.continuityDays, projectLeads.get(pkey)
        );

        if (!best) {
            unscheduled.push({
                blockId: block.id,
                reason: `Nijedna kandidat-ekipa nema ${workingDaysNeeded(block.workerDays || 0, 2)} slobodnih dana do ${horizonEnd}.`,
            });
            continue;
        }

        // Zauzmi radnike i zapiši.
        const refs = crewWorkerRefs(best.crew);
        for (const r of refs) if (r.id) markBusy(busy, r.id, best.slot.days);
        scheduledEnd.set(block.id, best.slot.endISO);
        const leadId = best.crew.lead.id;
        if (leadId) {
            const set = projectLeads.get(pkey) || new Set<string>();
            set.add(leadId);
            projectLeads.set(pkey, set);
        }

        scheduled.push({
            blockId: block.id,
            crewId: best.crew.id,
            workerRefs: refs,
            crew: crewSize(best.crew),
            startISO: best.slot.startISO,
            endISO: best.slot.endISO,
            reasons: buildReasons(block, best, options0.length, earliest, globalStart),
        });
    }

    // Pohlepni prolaz ostavlja rupe — sabijanje ih pokušava popuniti, uz garanciju
    // da se raspored nikad ne pogorša (prihvata se samo strogo bolje).
    if (weights.compactPasses > 0 && scheduled.length > 1) {
        const byId = new Map(toSchedule.map(b => [b.id, b]));
        compactSchedule(
            scheduled, byId, scenario, busy, isSat, horizonEnd, globalStart, weights, projectLeads
        );
    }

    return { scheduled, unscheduled };
}

// ── Sabijanje: popuni rupe koje je pohlepni prolaz ostavio ──────────

interface CandidatePick { crew: PlanCrew; slot: Slot; score: number; continuity: boolean; }

/**
 * Najbolja ekipa+termin za blok, od `earliest` nadalje. Isti kriterij koji
 * koristi glavni prolaz, izdvojen da ga sabijanje ne duplira drukčije.
 */
function bestCandidate(
    block: PlanBlock,
    earliest: string,
    busy: BusyMap,
    isSat: ((d: Date) => boolean) | undefined,
    horizonEnd: string,
    globalStart: string,
    continuityDays: number,
    leadsOnProject: Set<string> | undefined
): CandidatePick | null {
    const options = block.crewOptions || [];
    let best: CandidatePick | null = null;
    options.forEach((crew, idx) => {
        const needed = workingDaysNeeded(block.workerDays || 0, crewSize(crew));
        const slot = earliestFeasibleSlot(crew, needed, earliest, busy, isSat, horizonEnd);
        if (!slot) return;
        const leadId = crew.lead.id || '';
        const continuity = !!leadId && (leadsOnProject?.has(leadId) || false);
        const score = diffDays(globalStart, slot.endISO) - (continuity ? continuityDays : 0);
        // Tie-break po redoslijedu opcija → deterministično
        if (!best || score < best.score
            || (score === best.score && idx < options.indexOf(best.crew))) {
            best = { crew, slot, score, continuity };
        }
    });
    return best;
}

/**
 * SABIJANJE. Pohlepni prolaz raspoređuje blok po blok i nikad se ne vraća, pa
 * ostaju rupe: nalog obrađen kasno možda je stao u raniji slobodan termin, ili
 * bi s DRUGOM kandidat-ekipom završio prije. Ovdje se svaki blok redom pusti
 * (oslobodi svoje dane), pa se traži najbolji termin iznova preko SVIH ekipa.
 *
 * Prihvata se samo STROGO bolje — raniji kraj, ili isti kraj uz raniji početak.
 * Inače se vraća stara rezervacija. Time je prolaz monoton (nikad ne pogorša)
 * i deterministički, pa isti ulaz i dalje daje isti izlaz.
 *
 * Pomjeranje UNAPRIJED je sigurno i za veze: nasljednik traži samo da prethodnik
 * završi prije njega, a kraj se ovdje može samo primaknuti.
 */
function compactSchedule(
    scheduled: ScheduledBlock[],
    byId: Map<string, PlanBlock>,
    scenario: PlanScenario,
    busy: BusyMap,
    isSat: ((d: Date) => boolean) | undefined,
    horizonEnd: string,
    globalStart: string,
    weights: ScheduleWeights,
    projectLeads: Map<string, Set<string>>
): number {
    let moved = 0;

    for (let pass = 0; pass < weights.compactPasses; pass++) {
        let movedThisPass = 0;

        // Sabijaj slijeva: stabilan redoslijed, i rupe se pune redom kako nastaju.
        const order = [...scheduled].sort((a, b) =>
            a.startISO.localeCompare(b.startISO) || a.blockId.localeCompare(b.blockId));

        for (const s of order) {
            const block = byId.get(s.blockId);
            if (!block) continue;

            // Trenutni krajevi svih ostalih — za ograničenje prethodnika.
            const ends = new Map<string, string>();
            for (const o of scheduled) if (o.blockId !== s.blockId) ends.set(o.blockId, o.endISO);
            const earliest = earliestStartFromPredecessors(block, scenario, ends, globalStart);

            // Pusti blok: bez ovoga bi sam sebi zauzimao termin koji ispituje.
            const oldDays = workingDaysInSpan(s.startISO, s.endISO, isSat);
            for (const r of s.workerRefs) if (r.id) unmarkBusy(busy, r.id, oldDays);

            const pick = bestCandidate(
                block, earliest, busy, isSat, horizonEnd, globalStart,
                weights.continuityDays, projectLeads.get(projectKey(block))
            );

            const better = pick && (
                pick.slot.endISO < s.endISO
                || (pick.slot.endISO === s.endISO && pick.slot.startISO < s.startISO)
            );

            if (pick && better) {
                const refs = crewWorkerRefs(pick.crew);
                for (const r of refs) if (r.id) markBusy(busy, r.id, pick.slot.days);
                s.crewId = pick.crew.id;
                s.workerRefs = refs;
                s.crew = crewSize(pick.crew);
                s.startISO = pick.slot.startISO;
                s.endISO = pick.slot.endISO;
                if (!s.reasons.some(r => r.code === 'slot-compacted')) {
                    s.reasons.push({ code: 'slot-compacted', text: 'Povučeno ranije — popunjena rupa u rasporedu' });
                }
                moved++; movedThisPass++;
            } else {
                // Ništa bolje — vrati kako je bilo.
                for (const r of s.workerRefs) if (r.id) markBusy(busy, r.id, oldDays);
            }
        }

        if (movedThisPass === 0) break;   // stabilno stanje, dalji prolazi su uzalud
    }
    return moved;
}

function buildReasons(
    block: PlanBlock,
    best: { crew: PlanCrew; continuity: boolean; slot: Slot },
    optionCount: number,
    earliest: string,
    globalStart: string
): ScheduleReason[] {
    const out: ScheduleReason[] = [];
    const leadName = best.crew.lead.name;

    // Zašto ova ekipa
    if (optionCount === 1) {
        out.push({ code: 'crew-only', text: `${leadName} — jedina ponuđena ekipa` });
    } else if (best.continuity) {
        out.push({ code: 'crew-continuity', text: `${leadName} — već radi na ovom projektu` });
    } else {
        out.push({ code: 'crew-earliest', text: `${leadName} — najranija slobodna ekipa` });
    }

    // Zašto ovaj termin
    if (earliest > globalStart && best.slot.startISO <= addDays(earliest, 2)) {
        out.push({ code: 'slot-pred', text: 'Čeka prethodni korak (materijal/proizvodnja)' });
    } else if (best.slot.startISO > addDays(globalStart, 2)) {
        out.push({ code: 'slot-capacity', text: 'Prvi slobodan termin ekipe' });
    } else {
        out.push({ code: 'slot-early', text: 'Kreće odmah — termin slobodan' });
    }

    const prio = block.priority;
    if (prio === 'urgent' || prio === 'high') {
        out.push({ code: 'prio', text: prio === 'urgent' ? 'Hitno — gurnuto naprijed' : 'Visok prioritet' });
    }
    return out;
}

/** Pretvori rezultat u dodjele spremne za reducer APPLY_SCHEDULE. */
export function toAssignments(result: AutoScheduleResult) {
    return result.scheduled.map(s => ({
        blockId: s.blockId,
        startISO: s.startISO,
        endISO: s.endISO,
        crew: s.crew,
        workerRefs: s.workerRefs,
        assignedCrewId: s.crewId,
    }));
}

/** Sažetak za modal pregleda. */
export function scheduleSummary(scenario: PlanScenario, result: AutoScheduleResult) {
    const byId = new Map(scenario.Blocks.map(b => [b.id, b]));
    let movedDays = 0;
    for (const s of result.scheduled) {
        const b = byId.get(s.blockId);
        if (b) movedDays += Math.abs(diffDays(b.startISO, s.startISO));
    }
    const ends = result.scheduled.map(s => s.endISO).sort();
    return {
        scheduledCount: result.scheduled.length,
        unscheduledCount: result.unscheduled.length,
        lastEndISO: ends.length ? ends[ends.length - 1] : null,
        totalShiftDays: movedDays,
    };
}
