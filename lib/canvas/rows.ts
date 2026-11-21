// ════════════════════════════════════════════════════════════════════
// PLATNO — GRADNJA REDOVA
//
// Red je DIMENZIJA POGLEDA, ne entitet. Ovo je greška starog planera: tamo je
// `Map<Worker_ID, WorkOrder[]>` dio modela, pa se ne može gledati po projektu.
// Ovdje blok zna svoje datume i svoje reference; GDJE se crta odlučuje `groupBy`.
//
// Ovdje se popravlja i drugi bug starog planera: nalog bez radnika se tamo gura na
// SVAKI red ([PlannerTab:316]), pa jedan neraspoređen posao izgleda kao N poslova.
// Kod nas ide u jedan sintetički red „Nedodijeljeno".
// ════════════════════════════════════════════════════════════════════

import type {
    PlanScenario, PlanBlock, PlanBlockKind, PlanGroupBy, PlanLayout, PlanRef, Worker, WorkOrder, WorkerAttendance,
    TaskPriority,
} from '../types';
import { projectColorMap, NO_PROJECT_COLORS, type ProjectColors } from './palette';
import { crewKeyOf, crewShift, shiftAnchor, shiftSaturdays, type CrewShift, type ShiftLetter } from './crews';
import { addDays, toISODate } from './model';
import { buildSaturdayChecker, shiftWorksSaturday, todayISO as todayISOFn, type AttendanceLite } from '../planning';

/** Sekcije platna, odozgo nadolje. Obaveze su na vrhu jer su fiksne tačke. */
export type CanvasSection = 'obaveze' | 'plan' | 'ekipe' | 'nalozi' | 'radnici' | 'nabavka';

export const SECTION_LABEL: Record<CanvasSection, string> = {
    obaveze: 'Obaveze',
    plan: 'Plan',
    ekipe: 'Ekipe',
    nalozi: 'Nalozi',
    radnici: 'Radnici',
    nabavka: 'Nabavka',
};

/** Ključ projekta bloka — isti za boju, grupu i legendu. */
export function projectKeyOf(ref: PlanRef | undefined | null): string {
    return ref ? (ref.id || `name:${ref.name}`) : '';
}

/**
 * Boje svih projekata plana, bez sudara (vidi `projectColorMap`). Ključ boje je
 * id projekta (ili naziv) — isti kao ranije u `projectColors`.
 */
export function scenarioProjectColors(scenario: PlanScenario): Map<string, ProjectColors> {
    return projectColorMap(scenario.Blocks.map(b => b.projectRef ? (b.projectRef.id || b.projectRef.name) : null));
}

/** Boja projekta bloka iz mape plana. */
export function colorsFor(map: Map<string, ProjectColors>, ref: PlanRef | undefined | null): ProjectColors {
    return (ref && map.get(ref.id || ref.name)) || NO_PROJECT_COLORS;
}

// ── Tekst za lijevu kolonu (bosanska množina) ───────────────────────
const plural = (n: number, one: string, few: string, many: string) => {
    const m10 = n % 10, m100 = n % 100;
    const w = m10 === 1 && m100 !== 11 ? one : (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) ? few : many;
    return `${n} ${w}`;
};
const dmShort = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.`;
const nalogaN = (n: number) => plural(n, 'nalog', 'naloga', 'naloga');
const PRIORITY_RANK: Record<TaskPriority, number> = { urgent: 3, high: 2, medium: 1, low: 0 };

/**
 * Sloj bloka u OBJEDINJENOM redu. Nalog je okosnica (gornji sloj), a logistika
 * (narudžba/transport) i rokovi se crtaju ispod, uže i prigušeno — da se u istom
 * redu vidi „ovo je nalog, a unutar njegovog intervala stiže narudžba".
 */
export type BlockLayer = 'primary' | 'supply' | 'marker';

export function blockLayer(kind: PlanBlockKind): BlockLayer {
    if (kind === 'order' || kind === 'montaza') return 'primary';
    if (kind === 'milestone') return 'marker';
    return 'supply';   // purchase, transport, note
}

/**
 * Traka stvarnog, već preuzetog posla. ČITA SE, NIKAD SE NE MIJENJA.
 * Planiranje koje ignoriše preuzet posao je samoobmana — zato su sjene tu.
 */
export interface ShadowBar {
    id: string;
    label: string;
    startISO: string;
    endISO: string;
    kind: 'workorder' | 'absence';
    /** Za tooltip: zašto je ovo tu. */
    hint?: string;
}

export interface CanvasRow {
    id: string;
    label: string;
    sublabel?: string;
    section: CanvasSection;
    /** Blokovi scenarija koji pripadaju ovom redu (isti blok može biti na više redova). */
    blocks: PlanBlock[];
    shadows: ShadowBar[];
    /** Sintetički red („Nedodijeljeno") — nema stvarnog entiteta iza sebe. */
    synthetic?: boolean;
    /**
     * Naslovni red grupe (projekat, smjena) — nema vlastite trake, samo dijeli
     * redove ispod. Klik ga skuplja/širi.
     */
    groupHeader?: {
        /** Ključ grupe — za pamćenje skupljenog stanja. */
        key: string;
        /** Šta je grupa: projekat, subotnja smjena, slobodni radnici, ostalo. */
        kind?: 'project' | 'shift' | 'free' | 'other';
        /** Broj naloga u grupi. */
        count: number;
        /** Raspon grupe (za mini-traku u zaglavlju). */
        fromISO?: string;
        toISO?: string;
        /** Koliko naloga još nije stvarni nalog (nacrt). */
        draftCount: number;
        /** Rok projekta, ako postoji. */
        dueISO?: string;
        /** Projekat s hitnim nalogom — jedina oznaka stanja u naslovu. */
        urgent?: boolean;
        /** Smjena grupe (prikaz Ekipe). */
        shift?: CrewShift;
        /** Subote kad smjena radi — sivljenje neradnih subota u naslovnom redu. */
        isSaturdayWorking?: (d: Date) => boolean;
        /** Podnaslov, od najpotpunijeg do najkraćeg — kolona bira koji stane. */
        metaVariants?: string[];
    };
    /** Boje projekta ovog reda (kapica, tinta trake, tekst). */
    colors?: ProjectColors;
    /** Red pripada grupi s ovim ključem — za skupljanje. */
    groupKey?: string;
    /**
     * Red EKIPE (prikazi Projekti i Ekipe): radnici reda i njihova smjena. Ekipa
     * radi jedno po jedno, pa je dan predaje (kraj = početak sljedećeg) ista traka,
     * a druga traka znači stvarno dvostruko zauzeće.
     */
    crew?: {
        key: string;
        refs: PlanRef[];
        shift: CrewShift;
        /** Subota radna ako bar jedan član radi (ista pravila kao rok naloga). */
        isSaturdayWorking: (d: Date) => boolean;
    };
    /** Podnaslov reda, od najpotpunijeg do najkraćeg — kolona bira koji stane. */
    subVariants?: string[];
    /** Šta dobija novi blok nacrtan u ovom redu (projekat, ekipa). */
    context?: { projectRef?: PlanRef; workerRefs?: PlanRef[] };
}

export interface RowContext {
    workers: Worker[];
    /** Stvarni nalozi — samo za sjene. */
    workOrders: WorkOrder[];
    attendance: WorkerAttendance[];
    /** Prikaži i radnike koji nemaju ništa u scenariju (da se vidi ko je slobodan). */
    showIdleWorkers?: boolean;
    /** Danas — od kog datuma se nabrajaju radne subote smjene. */
    todayISO?: string;
}

const ABSENT_STATUSES = new Set(['Odsutan', 'Bolovanje', 'Odmor']);

/** Blokovi koji su fiksne tačke, ne rad. */
const COMMITMENT_KINDS = new Set<PlanBlock['kind']>(['milestone', 'montaza', 'transport']);

const byStart = (a: PlanBlock, b: PlanBlock) =>
    a.startISO.localeCompare(b.startISO) || a.title.localeCompare(b.title, 'hr');

// ── Sjene ───────────────────────────────────────────────────────────

/**
 * Stvarni zakazani nalozi po radniku — čita `Assigned_Workers` i procese stavki.
 * Eksportovano da kalendar radnika čita sjene ISTOM logikom kao osa — dva prikaza
 * istog čovjeka ne smiju se razilaziti oko toga šta je već preuzeto.
 */
export function realWorkOrdersByWorker(workOrders: WorkOrder[]): Map<string, ShadowBar[]> {
    const out = new Map<string, ShadowBar[]>();
    for (const wo of workOrders) {
        if (wo.Status === 'Završeno' || wo.Status === 'Otkazano') continue;
        const start = (wo.Started_At || wo.Planned_Start_Date || '').split('T')[0];
        const end = (wo.Due_Date || wo.Planned_End_Date || start).split('T')[0];
        if (!start) continue;

        const workerIds = new Set<string>();
        for (const item of wo.items || []) {
            (item.Assigned_Workers || []).forEach(w => w.Worker_ID && workerIds.add(w.Worker_ID));
            (item.Processes || []).forEach(p => {
                if (p.Worker_ID) workerIds.add(p.Worker_ID);
                (p.Helpers || []).forEach(h => h.Worker_ID && workerIds.add(h.Worker_ID));
            });
        }

        const bar: ShadowBar = {
            id: `wo-${wo.Work_Order_ID}`,
            label: wo.Name?.trim() || wo.Work_Order_Number,
            startISO: start,
            endISO: end < start ? start : end,
            kind: 'workorder',
            hint: `Stvarni nalog ${wo.Work_Order_Number} — ${wo.Status}`,
        };
        for (const wid of workerIds) {
            const arr = out.get(wid) || [];
            arr.push(bar);
            out.set(wid, arr);
        }
    }
    return out;
}

/** Odsustva iz šihtarice — susjedni dani se spajaju u jednu traku. */
function absencesByWorker(attendance: WorkerAttendance[]): Map<string, ShadowBar[]> {
    const byWorker = new Map<string, { date: string; status: string }[]>();
    for (const a of attendance) {
        if (!a.Worker_ID || !a.Date || !ABSENT_STATUSES.has(a.Status)) continue;
        const arr = byWorker.get(a.Worker_ID) || [];
        arr.push({ date: a.Date, status: a.Status });
        byWorker.set(a.Worker_ID, arr);
    }

    const out = new Map<string, ShadowBar[]>();
    for (const [workerId, days] of byWorker) {
        days.sort((x, y) => x.date.localeCompare(y.date));
        const bars: ShadowBar[] = [];
        let runStart = days[0];
        let prev = days[0];

        const flush = (endDay: { date: string; status: string }) => {
            bars.push({
                id: `abs-${workerId}-${runStart.date}`,
                label: runStart.status,
                startISO: runStart.date,
                endISO: endDay.date,
                kind: 'absence',
                hint: `${runStart.status} — iz šihtarice`,
            });
        };

        for (let i = 1; i < days.length; i++) {
            const cur = days[i];
            const gap = Math.round(
                (new Date(`${cur.date}T12:00:00`).getTime() - new Date(`${prev.date}T12:00:00`).getTime()) / 86400000
            );
            if (gap > 1 || cur.status !== prev.status) {
                flush(prev);
                runStart = cur;
            }
            prev = cur;
        }
        flush(prev);
        out.set(workerId, bars);
    }
    return out;
}

// ── Gradnja ─────────────────────────────────────────────────────────

/**
 * Redovi platna. Isti blok se NAMJERNO može pojaviti na više redova
 * (nalog s dva radnika je na oba reda) — to je pogled, ne duplikat.
 *
 * `layout` bira raspored:
 *  - `unified-project` → „Projekti": projekat → jedan red po ekipi.
 *  - `crews`           → „Ekipe": smjena → jedan red po ekipi, preko svih projekata.
 *  - `rows`            → „Nalozi": jedan red po nalogu.
 *  - `detailed`        → stari: sekcije po vrsti (Obaveze/Nalozi/Nabavka + Radnici).
 *  - `unified-global`  → stari: jedan red sa svim blokovima + Radnici.
 */
export function buildRows(
    scenario: PlanScenario,
    groupBy: PlanGroupBy,
    ctx: RowContext,
    layout: PlanLayout = 'detailed'
): CanvasRow[] {
    if (layout === 'rows') return buildRowsPerOrder(scenario);
    if (layout === 'unified-project') return buildProjectRows(scenario, ctx);
    if (layout === 'crews') return buildCrewRows(scenario, ctx);
    if (layout === 'unified-global') return buildUnifiedRows(scenario, ctx);
    return buildDetailedRows(scenario, groupBy, ctx);
}

// ── Ekipe: zajedničko za Projekti i Ekipe ───────────────────────────

/** Provjera subote za ekipu — keširana po sastavu (ista pravila kao rok naloga). */
function crewCheckerFactory(ctx: RowContext): (ids: string[]) => (d: Date) => boolean {
    const att = ctx.attendance as unknown as AttendanceLite[];
    const cache = new Map<string, (d: Date) => boolean>();
    return (ids: string[]) => {
        const key = ids.slice().sort().join('|');
        let chk = cache.get(key);
        if (!chk) { chk = buildSaturdayChecker(ids, att, ctx.workers); cache.set(key, chk); }
        return chk;
    };
}

/** Radni dan za ekipu: nedjelja nikad, subota po smjeni. */
function isCrewWorkday(iso: string, chk: (d: Date) => boolean): boolean {
    const d = new Date(`${iso}T12:00:00`);
    const dow = d.getDay();
    return dow === 0 ? false : dow === 6 ? chk(d) : true;
}

/** Prvi radni dan ekipe POSLIJE datuma. */
function nextCrewWorkday(iso: string, chk: (d: Date) => boolean): string {
    let cur = addDays(iso, 1);
    for (let i = 0; i < 14 && !isCrewWorkday(cur, chk); i++) cur = addDays(cur, 1);
    return cur;
}

const SHIFT_LABEL = (s: CrewShift) => (s === 'A' || s === 'B' ? `Smjena ${s}` : s === 'mix' ? 'Mješovita smjena' : '');

// ── PROJEKTI: projekat → jedan red po ekipi ─────────────────────────

/**
 * „Projekti". Stari objedinjeni red projekta slagao je sve naloge u 2–3 trake
 * pohlepnim pakovanjem — iz trake se nije vidjelo ko radi. Ovdje je ispod
 * naslova projekta JEDAN RED PO EKIPI koja na njemu radi: red sam kaže „ovo
 * radi Nedim + Aldin", a nalozi para stoje u nizu.
 *
 * Narudžbe, transport, rokovi i napomene projekta idu u red „Nabavka i rokovi"
 * na dnu projekta. Projekti su poredani po prioritetu (hitni prvi), pa po početku.
 */
function buildProjectRows(scenario: PlanScenario, ctx: RowContext): CanvasRow[] {
    const rows: CanvasRow[] = [];
    const blocks = scenario.Blocks;
    const colors = scenarioProjectColors(scenario);
    const checkerFor = crewCheckerFactory(ctx);
    const workersById = new Map(ctx.workers.map(w => [w.Worker_ID, w]));

    // Narudžba pripada projektu NALOGA koji hrani (veza „stiglo → kreće").
    const blockById = new Map(blocks.map(b => [b.id, b]));
    const linkedProject = new Map<string, PlanRef>();
    for (const l of scenario.Links) {
        if (l.kind !== 'delivery-to-start') continue;
        const nalog = blockById.get(l.to);
        if (nalog?.projectRef) linkedProject.set(l.from, nalog.projectRef);
    }
    const projectOf = (b: PlanBlock): PlanRef | undefined =>
        (b.kind === 'purchase' ? linkedProject.get(b.id) : undefined) || b.projectRef;

    const UNASSIGNED = '__unassigned__';
    const grouped = new Map<string, { ref?: PlanRef; label: string; work: PlanBlock[]; other: PlanBlock[] }>();
    for (const b of blocks) {
        const pr = projectOf(b);
        const key = pr ? projectKeyOf(pr) : UNASSIGNED;
        const e = grouped.get(key) || { ref: pr, label: pr ? pr.name.trim() : 'Bez projekta', work: [], other: [] };
        (WORK_KINDS.has(b.kind) ? e.work : e.other).push(b);
        grouped.set(key, e);
    }

    const rank = (e: { work: PlanBlock[] }) => Math.max(-1, ...e.work.map(b => PRIORITY_RANK[b.priority || 'medium']));
    const first = (list: PlanBlock[]) => list.reduce((a, b) => (b.startISO < a ? b.startISO : a), list[0]?.startISO || '9999');
    const entries = Array.from(grouped.entries()).sort(([ka, a], [kb, b]) => {
        if (ka === UNASSIGNED) return 1;
        if (kb === UNASSIGNED) return -1;
        return rank(b) - rank(a)
            || first([...a.work, ...a.other]).localeCompare(first([...b.work, ...b.other]))
            || a.label.localeCompare(b.label, 'hr');
    });

    for (const [key, e] of entries) {
        const all = [...e.work, ...e.other];
        const fromISO = first(all);
        const toISO = all.reduce((a, b) => (b.endISO > a ? b.endISO : a), all[0].endISO);
        const c = colorsFor(colors, e.ref);
        const n = e.work.length;
        rows.push({
            id: `grp-${key}`,
            label: e.label,
            section: 'plan',
            blocks: [],
            shadows: [],
            colors: c,
            synthetic: key === UNASSIGNED,
            context: e.ref ? { projectRef: e.ref } : undefined,
            groupHeader: {
                key, kind: 'project', count: n, fromISO, toISO,
                draftCount: e.work.filter(b => !b.linkedWorkOrderId).length,
                urgent: e.work.some(b => b.priority === 'urgent'),
                metaVariants: n
                    ? [`${nalogaN(n)} · ${dmShort(fromISO)}–${dmShort(toISO)}`, nalogaN(n)]
                    : [`${dmShort(fromISO)}–${dmShort(toISO)}`],
            },
        });

        // Jedan red po ekipi, redom kojim ekipe počinju.
        const crews = new Map<string, { refs: PlanRef[]; blocks: PlanBlock[] }>();
        for (const b of e.work) {
            const k = crewKeyOf(b.workerRefs);
            const ce = crews.get(k) || { refs: b.workerRefs || [], blocks: [] };
            ce.blocks.push(b);
            crews.set(k, ce);
        }
        const crewList = Array.from(crews.entries()).sort(([ka, a], [kb, b]) => {
            if (!ka) return 1;                       // „Bez ekipe" na dno projekta
            if (!kb) return -1;
            return first(a.blocks).localeCompare(first(b.blocks));
        });
        for (const [ck, ce] of crewList) {
            const ids = ce.refs.map(r => r.id).filter((x): x is string => !!x);
            const shift = crewShift(ce.refs, workersById);
            const cnt = nalogaN(ce.blocks.length);
            rows.push({
                id: `crew-${key}-${ck || 'none'}`,
                label: ce.refs.map(r => r.name).join(' + ') || 'Bez ekipe',
                section: 'plan',
                blocks: ce.blocks.slice().sort(byStart),
                shadows: [],
                colors: c,
                groupKey: key,
                synthetic: !ck,
                crew: { key: ck, refs: ce.refs, shift, isSaturdayWorking: checkerFor(ids) },
                subVariants: shift ? [`${SHIFT_LABEL(shift)} · ${cnt}`, SHIFT_LABEL(shift)] : [cnt],
                context: { ...(e.ref ? { projectRef: e.ref } : {}), ...(ce.refs.length ? { workerRefs: ce.refs } : {}) },
            });
        }

        if (e.other.length) {
            rows.push({
                id: `ostalo-${key}`,
                label: 'Nabavka i rokovi',
                section: 'plan',
                blocks: e.other.slice().sort(byStart),
                shadows: [],
                colors: c,
                groupKey: key,
                subVariants: [plural(e.other.length, 'stavka', 'stavke', 'stavki')],
                context: e.ref ? { projectRef: e.ref } : undefined,
            });
        }
    }
    return rows;
}

// ── EKIPE: smjena → jedan red po ekipi ──────────────────────────────

/**
 * „Ekipe" — zamjena za staru sekciju „Radnici", koja je isti blok crtala
 * jednom po čovjeku (dva puta za par) i nije pokazivala ni par ni smjenu.
 *
 * Red = ekipa (radnici na nalogu), preko SVIH projekata; boja trake kaže
 * projekat. Ekipe su grupisane po subotnjoj smjeni (A/B), pa se odmah vidi ko
 * radi koju subotu. Podnaslov reda kaže kad je ekipa slobodna. Na dnu su
 * „Slobodni radnici" — aktivni ljudi koji u planu nemaju ništa.
 */
function buildCrewRows(scenario: PlanScenario, ctx: RowContext): CanvasRow[] {
    const rows: CanvasRow[] = [];
    const blocks = scenario.Blocks;
    const today = ctx.todayISO || todayISOFn();
    const checkerFor = crewCheckerFactory(ctx);
    const workersById = new Map(ctx.workers.map(w => [w.Worker_ID, w]));
    const shadowWO = realWorkOrdersByWorker(ctx.workOrders);
    const shadowAbs = absencesByWorker(ctx.attendance);
    const firstName = (n: string) => (n || '').trim().split(/\s+/)[0] || n;

    /** Sjene članova ekipe — stvarni nalozi jednom, odsustva s imenom člana. */
    const crewShadows = (refs: PlanRef[]): ShadowBar[] => {
        const seen = new Set<string>();
        const out: ShadowBar[] = [];
        for (const r of refs) {
            if (!r.id) continue;
            for (const s of shadowWO.get(r.id) || []) if (!seen.has(s.id)) { seen.add(s.id); out.push(s); }
            for (const s of shadowAbs.get(r.id) || []) {
                out.push(refs.length > 1 ? { ...s, label: `${firstName(r.name)}: ${s.label}` } : s);
            }
        }
        return out;
    };

    // ── Rokovi, narudžbe, transport — jedan red na vrhu ──
    const other = blocks.filter(b => !WORK_KINDS.has(b.kind)).sort(byStart);
    if (other.length) {
        rows.push({
            id: 'grp-obaveze', label: 'Rokovi i nabavka', section: 'ekipe', blocks: [], shadows: [],
            groupHeader: { key: 'obaveze', kind: 'other', count: other.length, draftCount: 0,
                metaVariants: [plural(other.length, 'stavka', 'stavke', 'stavki')] },
        });
        rows.push({
            id: 'ekipe-obaveze', label: 'Svi projekti', section: 'ekipe', blocks: other, shadows: [],
            groupKey: 'obaveze',
        });
    }

    // ── Ekipe iz naloga ──
    const crews = new Map<string, { refs: PlanRef[]; blocks: PlanBlock[] }>();
    for (const b of blocks.filter(x => WORK_KINDS.has(x.kind))) {
        const k = crewKeyOf(b.workerRefs);
        const e = crews.get(k) || { refs: b.workerRefs || [], blocks: [] };
        e.blocks.push(b);
        crews.set(k, e);
    }
    const inCrew = new Set<string>();
    for (const e of crews.values()) for (const r of e.refs) if (r.id) inCrew.add(r.id);

    const groups: { key: string; shift: CrewShift; label: string; list: [string, { refs: PlanRef[]; blocks: PlanBlock[] }][] }[] = [
        { key: 'smjena-A', shift: 'A', label: 'Smjena A', list: [] },
        { key: 'smjena-B', shift: 'B', label: 'Smjena B', list: [] },
        { key: 'smjena-mix', shift: 'mix', label: 'Mješovite ekipe', list: [] },
        { key: 'smjena-none', shift: null, label: 'Bez smjene', list: [] },
    ];
    for (const entry of crews.entries()) {
        const s = entry[0] ? crewShift(entry[1].refs, workersById) : null;
        groups.find(g => g.shift === s)!.list.push(entry);
    }

    for (const g of groups) {
        if (!g.list.length) continue;
        const letter = g.shift === 'A' || g.shift === 'B' ? g.shift as ShiftLetter : null;
        const sats = letter ? shiftSaturdays(letter, today, 3).map(dmShort) : [];
        rows.push({
            id: `grp-${g.key}`, label: g.label, section: 'ekipe', blocks: [], shadows: [],
            groupHeader: {
                key: g.key, kind: 'shift', shift: g.shift, draftCount: 0,
                count: g.list.reduce((a, [, e]) => a + e.blocks.length, 0),
                isSaturdayWorking: letter
                    ? (d: Date) => shiftWorksSaturday(shiftAnchor(letter), toISODate(d)) !== false
                    : undefined,
                metaVariants: sats.length
                    ? [`subote ${sats.join(', ')}`, `subote ${sats[0]} i ${sats[1] ?? ''}`.trim(), `subota ${sats[0]}`]
                    : g.shift === 'mix' ? ['subota ako radi bar jedan'] : ['subota po šihtarici'],
            },
        });
        // Ekipe po imenu prvog člana — stabilan, abecedni red.
        g.list.sort(([ka, a], [kb, b]) => {
            if (!ka) return 1;
            if (!kb) return -1;
            return (a.refs[0]?.name || '').localeCompare(b.refs[0]?.name || '', 'hr');
        });
        for (const [ck, e] of g.list) {
            const ids = e.refs.map(r => r.id).filter((x): x is string => !!x);
            const chk = checkerFor(ids);
            const last = e.blocks.reduce((a, b) => (b.endISO > a ? b.endISO : a), e.blocks[0].endISO);
            const projects = new Set(e.blocks.map(b => projectKeyOf(b.projectRef))).size;
            const free = `${e.refs.length > 1 ? 'slobodni' : 'slobodan'} od ${dmShort(nextCrewWorkday(last, chk))}`;
            rows.push({
                id: `ekipa-${ck || 'none'}`,
                label: e.refs.map(r => r.name).join(' + ') || 'Bez ekipe',
                section: 'ekipe',
                blocks: e.blocks.slice().sort(byStart),
                shadows: crewShadows(e.refs),
                groupKey: g.key,
                synthetic: !ck,
                crew: { key: ck, refs: e.refs, shift: g.shift, isSaturdayWorking: chk },
                subVariants: ck
                    ? [`${free} · ${plural(projects, 'projekat', 'projekta', 'projekata')}`, free]
                    : [nalogaN(e.blocks.length)],
                context: e.refs.length ? { workerRefs: e.refs } : undefined,
            });
        }
    }

    // ── Slobodni radnici ──
    const free = ctx.workers
        .filter(w => (w.Status === 'Aktivan' || w.Status === 'Dostupan') && !inCrew.has(w.Worker_ID))
        .sort((a, b) => (a.Name || '').localeCompare(b.Name || '', 'hr'));
    if (free.length) {
        rows.push({
            id: 'grp-slobodni', label: 'Slobodni radnici', section: 'ekipe', blocks: [], shadows: [],
            groupHeader: { key: 'slobodni', kind: 'free', count: 0, draftCount: 0, metaVariants: ['nisu u ovom planu'] },
        });
        for (const w of free) {
            const refs = [{ id: w.Worker_ID, name: w.Name }];
            const shift = crewShift(refs, workersById);
            rows.push({
                id: `slobodan-${w.Worker_ID}`,
                label: w.Name,
                section: 'ekipe',
                blocks: [],
                shadows: crewShadows(refs),
                groupKey: 'slobodni',
                crew: { key: crewKeyOf(refs), refs, shift, isSaturdayWorking: checkerFor([w.Worker_ID]) },
                subVariants: [shift ? SHIFT_LABEL(shift) : 'bez smjene'],
                context: { workerRefs: refs },
            });
        }
    }
    return rows;
}

// ── Jedan nalog = jedan red ─────────────────────────────────────────

const WORK_KINDS = new Set<PlanBlockKind>(['order', 'montaza']);

/**
 * JEDAN NALOG = JEDAN RED. Naslagati 20 naloga u trake jednog reda je nečitljivo
 * čim ih je više od par: trake se preklapaju, nazivi ne stanu, i ne vidi se šta
 * je šta. Ovdje svaki nalog dobija svoj tanak red, a ime stoji u lijevoj FIKSNOJ
 * koloni — uvijek čitljivo, bez obzira na zum. Traka nosi samo VRIJEME.
 *
 * Nalozi su grupisani po projektu (naslovni red se može skupiti). Narudžba koja
 * hrani nalog crta se kao tanka traka ispod njega u istom redu. Rokovi ostaju u
 * redu Obaveze na vrhu.
 */
function buildRowsPerOrder(scenario: PlanScenario): CanvasRow[] {
    const rows: CanvasRow[] = [];
    const blocks = scenario.Blocks;

    // ── OBAVEZE: rokovi i transport na vrhu, u jednom redu ──────
    const commitments = blocks.filter(b => b.kind === 'milestone' || b.kind === 'transport').sort(byStart);
    if (commitments.length) {
        rows.push({
            id: 'sec-obaveze', label: 'Rokovi i transport', section: 'obaveze',
            blocks: commitments, shadows: [],
        });
    }

    // ── Narudžba pripada nalogu koji hrani (delivery-to-start veza) ──
    const suppliesByOrder = new Map<string, PlanBlock[]>();
    const linkedPurchase = new Set<string>();
    for (const l of scenario.Links) {
        if (l.kind !== 'delivery-to-start') continue;
        const purchase = blocks.find(b => b.id === l.from);
        if (purchase?.kind !== 'purchase') continue;
        const arr = suppliesByOrder.get(l.to) || [];
        arr.push(purchase);
        suppliesByOrder.set(l.to, arr);
        linkedPurchase.add(purchase.id);
    }

    // ── Grupiši naloge po projektu ──────────────────────────────
    const workBlocks = blocks.filter(b => WORK_KINDS.has(b.kind));
    const UNASSIGNED = '__unassigned__';
    const colorMap = scenarioProjectColors(scenario);
    const grouped = new Map<string, { label: string; colors: ProjectColors; blocks: PlanBlock[]; ref?: PlanRef }>();
    for (const b of workBlocks) {
        const pr = b.projectRef;
        const key = pr ? (pr.id || `name:${pr.name}`) : UNASSIGNED;
        const label = pr ? pr.name : 'Bez projekta';
        // Iste boje koje traka dobija iz mape plana — da se akcent reda i
        // ispuna trake ne raziđu.
        const entry = grouped.get(key)
            || { label, colors: colorsFor(colorMap, pr), blocks: [], ref: pr };
        entry.blocks.push(b);
        grouped.set(key, entry);
    }

    const groupEntries = Array.from(grouped.entries()).sort(([ka, a], [kb, bb]) => {
        if (ka === UNASSIGNED) return 1;
        if (kb === UNASSIGNED) return -1;
        return a.label.localeCompare(bb.label, 'hr');
    });

    for (const [key, entry] of groupEntries) {
        const ordered = entry.blocks.slice().sort(byStart);
        const fromISO = ordered.reduce((a, b) => (b.startISO < a ? b.startISO : a), ordered[0].startISO);
        const toISO = ordered.reduce((a, b) => (b.endISO > a ? b.endISO : a), ordered[0].endISO);
        const draftCount = ordered.filter(b => !b.linkedWorkOrderId && !b.linkedOrderId).length;

        // Naslovni red projekta
        rows.push({
            id: `grp-${key}`,
            label: entry.label.trim(),
            section: 'plan',
            blocks: [],
            shadows: [],
            colors: entry.colors,
            synthetic: key === UNASSIGNED,
            context: entry.ref ? { projectRef: entry.ref } : undefined,
            groupHeader: {
                key, kind: 'project', count: ordered.length, fromISO, toISO, draftCount,
                urgent: ordered.some(b => b.priority === 'urgent'),
                metaVariants: [`${nalogaN(ordered.length)} · ${dmShort(fromISO)}–${dmShort(toISO)}`, nalogaN(ordered.length)],
            },
        });

        // Jedan red po nalogu
        for (const b of ordered) {
            const supplies = suppliesByOrder.get(b.id) || [];
            const crew = (b.workerRefs || []).map(w => w.name).join(', ');
            rows.push({
                id: `ord-${b.id}`,
                label: b.title,
                sublabel: crew || undefined,
                section: 'plan',
                blocks: [b, ...supplies],
                shadows: [],
                colors: entry.colors,
                groupKey: key,
                context: entry.ref ? { projectRef: entry.ref } : undefined,
            });
        }
    }

    // Radnici NISU ovdje: ekipa svakog naloga piše se u njegovom redu, a
    // zauzetost po ljudima je prikaz „Ekipe". Stara sekcija „Radnici" je samo
    // ponavljala iste blokove.

    // ── NABAVKA: narudžbe koje ne hrane nijedan nalog ───────────
    const looseSupplies = blocks.filter(b => b.kind === 'purchase' && !linkedPurchase.has(b.id));
    if (looseSupplies.length) {
        const bySupplier = new Map<string, { label: string; blocks: PlanBlock[] }>();
        for (const b of looseSupplies) {
            const k = b.supplierRef?.id || `name:${b.supplierRef?.name || 'Nepoznat'}`;
            const e = bySupplier.get(k) || { label: b.supplierRef?.name || 'Nepoznat dobavljač', blocks: [] };
            e.blocks.push(b);
            bySupplier.set(k, e);
        }
        for (const [k, e] of Array.from(bySupplier.entries()).sort(([, a], [, b]) => a.label.localeCompare(b.label, 'hr'))) {
            rows.push({ id: `nabavka-${k}`, label: e.label, section: 'nabavka', blocks: e.blocks.sort(byStart), shadows: [] });
        }
    }

    return rows;
}

function buildDetailedRows(
    scenario: PlanScenario,
    groupBy: PlanGroupBy,
    ctx: RowContext
): CanvasRow[] {
    const rows: CanvasRow[] = [];
    const blocks = scenario.Blocks;

    // ── OBAVEZE: fiksne tačke uvijek na vrhu, u jednom redu ──────
    const commitments = blocks.filter(b => COMMITMENT_KINDS.has(b.kind)).sort(byStart);
    if (commitments.length) {
        rows.push({
            id: 'sec-obaveze',
            label: 'Rokovi i montaže',
            section: 'obaveze',
            blocks: commitments,
            shadows: [],
        });
    }

    // ── NALOZI: grupisano po izabranoj dimenziji ─────────────────
    const orderBlocks = blocks.filter(b => b.kind === 'order' || b.kind === 'note');
    const grouped = new Map<string, { label: string; sublabel?: string; blocks: PlanBlock[] }>();
    const UNASSIGNED = '__unassigned__';

    for (const b of orderBlocks) {
        let keys: { key: string; label: string; sublabel?: string }[] = [];

        if (groupBy === 'project') {
            keys = b.projectRef
                ? [{ key: b.projectRef.id || `name:${b.projectRef.name}`, label: b.projectRef.name }]
                : [{ key: UNASSIGNED, label: 'Bez projekta' }];
        } else if (groupBy === 'worker') {
            keys = (b.workerRefs || []).length
                ? b.workerRefs!.map(w => ({ key: w.id || `name:${w.name}`, label: w.name }))
                // Bug starog planera: ovdje je nalog bez radnika išao na SVAKI red.
                : [{ key: UNASSIGNED, label: 'Nedodijeljeno' }];
        } else if (groupBy === 'supplier') {
            keys = b.supplierRef
                ? [{ key: b.supplierRef.id || `name:${b.supplierRef.name}`, label: b.supplierRef.name }]
                : [{ key: UNASSIGNED, label: 'Bez dobavljača' }];
        } else {
            keys = [{ key: b.kind, label: b.kind === 'note' ? 'Napomene' : 'Nalozi' }];
        }

        for (const k of keys) {
            const entry = grouped.get(k.key) || { label: k.label, sublabel: k.sublabel, blocks: [] };
            entry.blocks.push(b);
            grouped.set(k.key, entry);
        }
    }

    const groupEntries = Array.from(grouped.entries()).sort(([ka, a], [kb, bb]) => {
        if (ka === UNASSIGNED) return 1;          // sintetički red uvijek na kraj
        if (kb === UNASSIGNED) return -1;
        return a.label.localeCompare(bb.label, 'hr');
    });

    for (const [key, entry] of groupEntries) {
        rows.push({
            id: `nalozi-${key}`,
            label: entry.label,
            sublabel: entry.sublabel,
            section: 'nalozi',
            blocks: entry.blocks.sort(byStart),
            shadows: [],
            synthetic: key === UNASSIGNED,
        });
    }

    // ── RADNICI: kapacitet i stvarna zauzetost ───────────────────
    rows.push(...buildWorkerRows(scenario, ctx));

    // ── NABAVKA: po dobavljaču ───────────────────────────────────
    const purchases = blocks.filter(b => b.kind === 'purchase');
    if (purchases.length) {
        const bySupplier = new Map<string, { label: string; blocks: PlanBlock[] }>();
        for (const b of purchases) {
            const key = b.supplierRef?.id || `name:${b.supplierRef?.name || 'Nepoznat'}`;
            const entry = bySupplier.get(key) || { label: b.supplierRef?.name || 'Nepoznat dobavljač', blocks: [] };
            entry.blocks.push(b);
            bySupplier.set(key, entry);
        }
        for (const [key, entry] of Array.from(bySupplier.entries())
            .sort(([, a], [, b]) => a.label.localeCompare(b.label, 'hr'))) {
            rows.push({
                id: `nabavka-${key}`,
                label: entry.label,
                section: 'nabavka',
                blocks: entry.blocks.sort(byStart),
                shadows: [],
            });
        }
    }

    return rows;
}

/** Radnički redovi (kapacitet + sjene stvarnog posla). Isti u svakom rasporedu. */
function buildWorkerRows(scenario: PlanScenario, ctx: RowContext): CanvasRow[] {
    const blocks = scenario.Blocks;
    const shadowWO = realWorkOrdersByWorker(ctx.workOrders);
    const shadowAbs = absencesByWorker(ctx.attendance);

    const referenced = new Set<string>();
    for (const b of blocks) for (const w of b.workerRefs || []) if (w.id) referenced.add(w.id);

    const workerPool = ctx.showIdleWorkers
        ? ctx.workers.filter(w => w.Status === 'Aktivan' || w.Status === 'Dostupan')
        : ctx.workers.filter(w => referenced.has(w.Worker_ID));

    return [...workerPool]
        .sort((a, b) => (a.Name || '').localeCompare(b.Name || '', 'hr'))
        .map(w => ({
            id: `radnik-${w.Worker_ID}`,
            label: w.Name,
            sublabel: w.Role,
            section: 'radnici' as CanvasSection,
            blocks: blocks
                .filter(b => (b.workerRefs || []).some(r => r.id === w.Worker_ID))
                .sort(byStart),
            shadows: [...(shadowWO.get(w.Worker_ID) || []), ...(shadowAbs.get(w.Worker_ID) || [])],
        }));
}

/**
 * Stari prikaz „Jedan red": svi blokovi u jednom redu (nalog okosnica, ostalo
 * ispod — vidi `blockLayer`) + Radnici. Ostaje u meniju ⋯ za pregled cijelog
 * plana u jednom potezu.
 */
function buildUnifiedRows(scenario: PlanScenario, ctx: RowContext): CanvasRow[] {
    const rows: CanvasRow[] = [];
    const blocks = scenario.Blocks;
    if (blocks.length) {
        rows.push({
            id: 'plan-all',
            label: 'Svi blokovi',
            sublabel: 'objedinjeno',
            section: 'plan',
            blocks: [...blocks].sort(byStart),
            shadows: [],
        });
    }
    rows.push(...buildWorkerRows(scenario, ctx));
    return rows;
}

/** Redovi grupisani po sekcijama, u fiksnom redoslijedu prikaza. */
export function groupRowsBySection(rows: CanvasRow[]): { section: CanvasSection; rows: CanvasRow[] }[] {
    const order: CanvasSection[] = ['obaveze', 'plan', 'ekipe', 'nalozi', 'radnici', 'nabavka'];
    return order
        .map(section => ({ section, rows: rows.filter(r => r.section === section) }))
        .filter(g => g.rows.length > 0);
}
