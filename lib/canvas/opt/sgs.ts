// ════════════════════════════════════════════════════════════════════
// PLATNO · OPTIMIZATOR — SERIJSKO GENERISANJE RASPOREDA (serial SGS)
//
// Dekoder: lista prioriteta (permutacija poslova) + eventualno zadana ekipa po
// poslu → izvodljiv raspored. Poslovi se uzimaju redom iz liste, ali tek kad su
// im svi prethodnici raspoređeni; svaki dobije najraniji termin u kojem izabrana
// ekipa može raditi bez prekida, a ekipa je ona s najranijim krajem (izjednačeno:
// ista ekipa već radi taj projekat, pa redoslijed kandidata).
//
// Jedinica je ½ dana. Dan radnika s punim kapacitetom ima dvije polovine; posao
// može početi od podne (prijepodne je završio drugi posao iste ekipe) i završiti u
// podne. Dan s djelimičnim kapacitetom (stvarni nalog uzeo dio) ne dijeli se.
//
// Pravila su ista kao u ocjeni (evaluate.ts), pa je svaki dekodiran raspored po
// konstrukciji bez prekoračenja: srednji dan posla mora biti cijeli slobodan za
// sve članove ekipe, dan kad neki član ne radi (0) samo produži raspon.
//
// Čista funkcija, deterministična. jest: lib/__tests__/platnoOptimizator.test.ts
// ════════════════════════════════════════════════════════════════════

import type { Instance, Job } from './instance';
import { dayIndex, isoAt } from './instance';
import type { Placement } from './evaluate';

const EPS = 1e-6;
const AM = 1, PM = 2, FULL = 3;

/** Zašto posao ne počinje ranije — za objašnjenje u prijedlogu. */
export type Binding =
    | { kind: 'start' }
    | { kind: 'release'; iso: string }
    | { kind: 'precedence'; jobId: string; iso: string }
    | { kind: 'crew'; jobId?: string; iso: string };

export interface Decoded {
    placements: Placement[];
    /** Posao → razlog početka i kandidat-ekipe s krajem koji bi dale. */
    info: Map<string, { binding: Binding; alternatives: { crewKey: string; endDay: number }[] }>;
    unplaced: { jobId: string; reason: string }[];
}

interface Slot { start: number; end: number; startsPM: boolean; endsAM: boolean; days: { d: number; mask: number }[] }

/** Stanje: zauzete polovine radnika po danu i ko ih drži (radnik × dan, ravni nizovi). */
class Usage {
    private mask: Uint8Array;
    private owner: Int32Array;
    constructor(private readonly days: number, workers: number, private readonly jobIds: string[]) {
        this.mask = new Uint8Array(days * workers);
        this.owner = new Int32Array(days * workers).fill(-1);
    }
    private at(w: number, d: number) { return d < 0 || d >= this.days ? -1 : w * this.days + d; }
    get(w: number, d: number): number { const i = this.at(w, d); return i < 0 ? 0 : this.mask[i]; }
    ownerOf(w: number, d: number): string | undefined { const i = this.at(w, d); return i < 0 || this.owner[i] < 0 ? undefined : this.jobIds[this.owner[i]]; }
    take(w: number, d: number, m: number, job: number) {
        const i = this.at(w, d);
        if (i < 0) return;
        this.mask[i] |= m;
        this.owner[i] = job;
    }
}

export class Decoder {
    private readonly jobById: Map<string, Job>;
    private readonly preds = new Map<string, { from: string; lag: number }[]>();
    private readonly widx = new Map<string, number>();
    private readonly jobIdx = new Map<string, number>();
    private readonly jobIds: string[];
    private cap: Float64Array;
    private readonly workerList: string[];
    private readonly days: number;
    readonly fixed: Placement[];
    readonly movable: Job[];
    private readonly horizon: number;

    /**
     * @param fixed poslovi koji se ne raspoređuju (zaključani, ručni bez kandidata) — njihov
     *              termin iz plana zauzima radnike prije svega ostalog.
     */
    constructor(readonly inst: Instance, fixed: Placement[], movableIds: Set<string>) {
        this.jobById = new Map(inst.jobs.map(j => [j.id, j]));
        this.fixed = fixed;
        this.movable = inst.jobs.filter(j => movableIds.has(j.id));
        this.horizon = inst.horizonDays;
        // Dani od početka do horizonta + rezerva za posao koji počne pred kraj; fiksni poslovi
        // prije početka ne trebaju kapacitet (ništa se ne raspoređuje unazad).
        this.days = this.horizon + 420;
        for (const c of inst.crews.values()) for (const w of c.workerIds) if (!this.widx.has(w)) this.widx.set(w, this.widx.size);
        this.jobIds = inst.jobs.map(j => j.id);
        this.jobIds.forEach((id, i) => this.jobIdx.set(id, i));
        this.cap = new Float64Array(this.widx.size * this.days).fill(-1);
        this.workerList = Array.from(this.widx.keys());
        for (const p of inst.precedence) this.preds.set(p.to, [...(this.preds.get(p.to) || []), { from: p.from, lag: p.lagDays }]);
    }

    /** Slobodan kapacitet radnika (0..1) poslije stvarnih naloga — keširano. */
    private c(w: number, d: number): number {
        if (d < 0 || d >= this.days) return 0;
        const i = w * this.days + d;
        let v = this.cap[i];
        if (v < 0) {
            const iso = isoAt(this.inst.startISO, d);
            const id = this.workerList[w];
            v = Math.max(0, this.inst.calendar.available(id, iso) - this.inst.fixedLoad(id, iso));
            this.cap[i] = v;
        }
        return v;
    }


    private memberCache = new Map<string, number[]>();
    private members(crewKey: string): number[] {
        let m = this.memberCache.get(crewKey);
        if (!m) {
            m = (this.inst.crews.get(crewKey)?.workerIds || crewKey.split('+')).map(w => {
                if (!this.widx.has(w)) throw new Error(`radnik ${w} nije u ekipama modela`);
                return this.widx.get(w)!;
            });
            this.memberCache.set(crewKey, m);
        }
        return m;
    }

    /**
     * Pokušaj posla od dana `start` (od podne ako `pm`). Vraća termin ili dan na kojem je
     * zapelo (i čiji posao je tamo) — za sljedeći kandidat i objašnjenje.
     */
    private tryAt(u: Usage, ws: number[], need: number, start: number, pm: boolean): Slot | { blockedAt: number; by?: string; skipTo?: number } {
        let consumed = 0;
        const days: { d: number; mask: number }[] = [];
        let endsAM = false;
        for (let d = start; d < start + 400; d++) {
            let minCap = Infinity;
            for (const w of ws) minCap = Math.min(minCap, this.c(w, d));
            if (minCap <= EPS) {
                if (d === start) return { blockedAt: d };
                continue;                                   // neradni dan nekog člana: raspon se produži
            }
            const first = d === start;
            const full = minCap >= 1 - EPS;
            if (first && pm) {
                if (!full) return { blockedAt: d };
                for (const w of ws) if (u.get(w, d) & PM) return { blockedAt: d, by: u.ownerOf(w, d) };
                days.push({ d, mask: PM });
                consumed += 0.5;
            } else {
                for (const w of ws) {
                    const m = u.get(w, d);
                    // Prijepodne zauzeto: svaki kasniji početak prije ovog dana opet udari u njega
                    // (kraj do podne ne pomaže) — sljedeći kandidat je tek taj dan (od podne).
                    if (m) return { blockedAt: d, by: u.ownerOf(w, d), skipTo: m & AM ? d - 1 : undefined };
                }
                if (full && need - consumed <= 0.5 + EPS) {
                    days.push({ d, mask: AM });
                    consumed += 0.5;
                    endsAM = true;
                } else {
                    days.push({ d, mask: FULL });
                    consumed += Math.min(1, minCap);
                }
            }
            if (consumed >= need - EPS) return { start, end: d, startsPM: pm, endsAM, days };
        }
        return { blockedAt: start + 400 };
    }

    /** Najraniji termin ekipe od dana `from`. */
    private earliest(u: Usage, crewKey: string, need: number, from: number): { slot: Slot; by?: string; blockedTo?: number } | null {
        const ws = this.members(crewKey);
        let by: string | undefined, blockedTo: number | undefined;
        for (let d = Math.max(0, from); d < this.horizon; d++) {
            // Brza provjera prvog dana (bez pokušaja): može li ovdje početi cijeli dan ili od podne?
            let canFull = true, canPM = true;
            for (const w of ws) {
                const c = this.c(w, d);
                if (c <= EPS) { canFull = canPM = false; break; }
                const m = u.get(w, d);
                if (m) {
                    canFull = false;
                    if (!by || blockedTo === undefined || d >= blockedTo) { by = u.ownerOf(w, d); blockedTo = d; }
                }
                if (m & PM || c < 1 - EPS) canPM = false;
            }
            if (!canFull && !canPM) continue;
            if (canFull) {
                const full = this.tryAt(u, ws, need, d, false);
                if ('start' in full) return { slot: full, by, blockedTo };
                if (full.by) { by = full.by; blockedTo = full.blockedAt; }
                if (canPM) {
                    const half = this.tryAt(u, ws, need, d, true);
                    if ('start' in half) return { slot: half, by, blockedTo };
                }
                if (full.skipTo !== undefined && full.skipTo > d) d = full.skipTo;   // petlja doda +1
            } else {
                const half = this.tryAt(u, ws, need, d, true);
                if ('start' in half) return { slot: half, by, blockedTo };
                if (half.by) { by = half.by; blockedTo = half.blockedAt; }
            }
        }
        return null;
    }

    private commit(u: Usage, crewKey: string, slot: Slot, jobId: string) {
        const ws = this.members(crewKey);
        const j = this.jobIdx.get(jobId)!;
        for (const { d, mask } of slot.days) for (const w of ws) u.take(w, d, mask, j);
    }

    /** Fiksni posao zauzima radnike po svom terminu (bez provjere — on je dat). */
    private commitFixed(u: Usage, p: Placement) {
        if (!p.crewKey) return;
        const ws = this.members(p.crewKey);
        const s = dayIndex(this.inst.startISO, p.startISO), e = dayIndex(this.inst.startISO, p.endISO);
        for (let d = s; d <= e; d++) {
            const mask = d === s && p.startsPM ? PM : d === e && p.endsAM ? AM : FULL;
            for (const w of ws) if (this.c(w, d) > EPS) u.take(w, d, mask, this.jobIdx.get(p.jobId)!);
        }
    }

    decode(order: string[], forced: ReadonlyMap<string, string> = new Map()): Decoded {
        const u = new Usage(this.days, this.widx.size, this.jobIds);
        this.fixed.forEach(p => this.commitFixed(u, p));
        const endDay = new Map<string, number>();
        for (const p of this.fixed) endDay.set(p.jobId, dayIndex(this.inst.startISO, p.endISO));

        const placements: Placement[] = [];
        const info: Decoded['info'] = new Map();
        const unplaced: Decoded['unplaced'] = [];
        const lastProjectOfCrew = new Map<string, string>();
        const pending = order.filter(id => this.jobById.has(id));
        const done = new Set<string>(this.fixed.map(p => p.jobId));
        const movableIds = new Set(this.movable.map(j => j.id));
        // Prethodnik koji nije u problemu (ni fiksan ni pomičan) ne blokira.
        const blocks = (id: string) => (this.preds.get(id) || []).filter(p => (movableIds.has(p.from) || done.has(p.from)) && !done.has(p.from));

        while (pending.length) {
            let idx = pending.findIndex(id => blocks(id).length === 0);
            if (idx < 0) idx = 0;                           // ciklus veza: uzmi prvi, ocjena prijavi
            const id = pending.splice(idx, 1)[0];
            const job = this.jobById.get(id)!;
            done.add(id);
            if (!job.crews.length) { unplaced.push({ jobId: id, reason: 'nema kandidat-ekipe' }); continue; }

            let from = 0;
            let binding: Binding = { kind: 'start' };
            if (job.releaseISO) {
                const r = dayIndex(this.inst.startISO, job.releaseISO);
                if (r > from) { from = r; binding = { kind: 'release', iso: job.releaseISO }; }
            }
            for (const p of this.preds.get(id) || []) {
                const e = endDay.get(p.from);
                if (e === undefined) continue;
                const r = e + p.lag + 1;
                if (r > from) { from = r; binding = { kind: 'precedence', jobId: p.from, iso: isoAt(this.inst.startISO, e) }; }
            }

            const crews = forced.has(id) && job.crews.includes(forced.get(id)!) ? [forced.get(id)!] : job.crews;
            const tried: { crewKey: string; slot: Slot; by?: string; blockedTo?: number }[] = [];
            for (const k of crews) {
                const need = job.workerDays / this.members(k).length;
                const r = this.earliest(u, k, need, from);
                if (r) tried.push({ crewKey: k, ...r });
            }
            if (!tried.length) { unplaced.push({ jobId: id, reason: `nema slobodnog termina u ${this.horizon} dana` }); continue; }
            const score = (t: typeof tried[number]) => t.slot.end * 2 + (t.slot.endsAM ? 0 : 1);
            tried.sort((a, b) => score(a) - score(b)
                || Number(lastProjectOfCrew.get(b.crewKey) === job.projectKey) - Number(lastProjectOfCrew.get(a.crewKey) === job.projectKey)
                || crews.indexOf(a.crewKey) - crews.indexOf(b.crewKey));
            const best = tried[0];
            this.commit(u, best.crewKey, best.slot, id);
            lastProjectOfCrew.set(best.crewKey, job.projectKey);
            endDay.set(id, best.slot.end);
            if (best.slot.start > from && best.blockedTo !== undefined) binding = { kind: 'crew', jobId: best.by, iso: isoAt(this.inst.startISO, best.blockedTo) };
            else if (best.slot.start > from) binding = { kind: 'crew', iso: isoAt(this.inst.startISO, best.slot.start - 1) };
            info.set(id, { binding, alternatives: tried.map(t => ({ crewKey: t.crewKey, endDay: t.slot.end })) });
            placements.push({
                jobId: id, crewKey: best.crewKey,
                startISO: isoAt(this.inst.startISO, best.slot.start), endISO: isoAt(this.inst.startISO, best.slot.end),
                ...(best.slot.startsPM ? { startsPM: true } : {}), ...(best.slot.endsAM ? { endsAM: true } : {}),
            });
        }
        return { placements: [...this.fixed, ...placements], info, unplaced };
    }
}
