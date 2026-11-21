// ════════════════════════════════════════════════════════════════════
// PLATNO · PLAN vs STVARNOST (faza 6)
//
// Za svaki nalog s Platna koji je pretvoren u stvarni nalog (linkedWorkOrderId):
// šta je plan rekao (početak, kraj, radnik-dani) i šta kaže Knjiga rada (prvi i
// zadnji upis, upisani radnik-dani, status naloga). Iz toga:
//   • završen → koliko ranije/kasnije od plana i koliko rada u odnosu na plan,
//   • u toku → prognoza kraja: preostali rad po planu od danas, ekipom bloka,
//   • nije počeo → koliko kasni početak.
// Nalog s Platna koji je trebao početi, a nije pretvoren, prijavljuje se posebno.
//
// Mjera tačnosti procjene: upisano ÷ planirano na završenim nalozima — kad je
// stalno iznad 100 %, plan potcjenjuje posao i Platno to treba znati.
//
// Čista funkcija. jest: lib/__tests__/platnoStvarnost.test.ts
// ════════════════════════════════════════════════════════════════════

import type { PlanBlock, PlanScenario } from '../../types';
import { crewSizeOf, halfSpan, type IsWork } from '../quickActions';
import { dayIndex } from './instance';

export type RealityStatus = 'nije-pokrenut' | 'ceka' | 'u-toku' | 'gotov' | 'otkazan';

export interface RealityRow {
    blockId: string;
    title: string;
    projectName: string;
    plannedStartISO: string;
    plannedEndISO: string;
    plannedWD: number;
    status: RealityStatus;
    bookedWD: number;
    firstISO?: string;
    lastISO?: string;
    doneISO?: string;
    forecastEndISO?: string;
    /** Kalendarski dani: + kasnije od plana, − ranije. */
    startDelay?: number;
    endDelta?: number;
    /** Upisano ÷ planirano (samo kad postoji plan rada). */
    effortRatio?: number;
    verdict: string;
    late: boolean;
}

export interface RealityInput {
    scenario: PlanScenario;
    workOrders: { Work_Order_ID: string; Status: string; Completed_At?: string; Work_Order_Number?: string }[];
    workLogs: { Work_Order_ID?: string; Date: string; Day_Fraction?: number; Work_Order_Deleted?: boolean }[];
    todayISO: string;
    /** Radni dan ekipe bloka — za prognozu kraja. */
    isWorkFor: (b: PlanBlock) => IsWork;
}

export interface RealitySummary {
    rows: RealityRow[];
    late: number;
    onTime: number;
    notConverted: number;
    /** Σ upisano ÷ Σ planirano na završenim nalozima s planom rada. */
    effortAccuracy: number | null;
    lines: string[];
}

const dm = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.`;
const r1 = (n: number) => Math.round(n * 10) / 10;
const pct = (x: number) => `${Math.round(x * 100)} %`;
const days = (n: number) => `${Math.abs(n)} ${Math.abs(n) % 10 === 1 && Math.abs(n) % 100 !== 11 ? 'dan' : 'dana'}`;

export function planVsReality(input: RealityInput): RealitySummary {
    const { scenario, todayISO } = input;
    const woById = new Map(input.workOrders.map(w => [w.Work_Order_ID, w]));
    const logsByWo = new Map<string, { date: string; f: number }[]>();
    for (const l of input.workLogs) {
        if (!l.Work_Order_ID || l.Work_Order_Deleted) continue;
        const f = l.Day_Fraction ?? 1;
        if (f <= 0) continue;
        logsByWo.set(l.Work_Order_ID, [...(logsByWo.get(l.Work_Order_ID) || []), { date: String(l.Date).slice(0, 10), f }]);
    }

    const rows: RealityRow[] = [];
    for (const b of scenario.Blocks) {
        if (b.kind !== 'order' && b.kind !== 'montaza') continue;
        const base = {
            blockId: b.id, title: b.title, projectName: b.projectRef?.name || '',
            plannedStartISO: b.startISO, plannedEndISO: b.endISO, plannedWD: b.workerDays || 0,
        };
        const wo = b.linkedWorkOrderId ? woById.get(b.linkedWorkOrderId) : undefined;
        if (!wo) {
            if (b.startISO >= todayISO) continue;            // budući nacrt — nema šta porediti
            const late = dayIndex(b.startISO, todayISO);
            rows.push({ ...base, status: 'nije-pokrenut', bookedWD: 0, startDelay: late, late: true,
                verdict: `trebao početi ${dm(b.startISO)} — nalog nije pokrenut (${days(late)})` });
            continue;
        }
        const logs = (logsByWo.get(wo.Work_Order_ID) || []).sort((x, y) => x.date.localeCompare(y.date));
        const booked = r1(logs.reduce((s, l) => s + l.f, 0));
        const firstISO = logs[0]?.date, lastISO = logs[logs.length - 1]?.date;
        const effortRatio = base.plannedWD > 0 ? booked / base.plannedWD : undefined;
        const startDelay = firstISO ? dayIndex(b.startISO, firstISO) : undefined;

        if (wo.Status === 'Otkazano') {
            rows.push({ ...base, status: 'otkazan', bookedWD: booked, firstISO, lastISO, late: false, verdict: 'otkazan' });
            continue;
        }
        if (wo.Status === 'Završeno') {
            const doneISO = (wo.Completed_At || '').slice(0, 10) || lastISO || b.endISO;
            const endDelta = dayIndex(b.endISO, doneISO);
            const when = endDelta > 0 ? `završen ${days(endDelta)} kasnije` : endDelta < 0 ? `završen ${days(endDelta)} ranije` : 'završen na vrijeme';
            rows.push({ ...base, status: 'gotov', bookedWD: booked, firstISO, lastISO, doneISO, startDelay, endDelta, effortRatio, late: endDelta > 0,
                verdict: effortRatio !== undefined ? `${when} · rad ${pct(effortRatio)} plana` : when });
            continue;
        }
        if (!logs.length) {
            const lateStart = b.startISO < todayISO ? dayIndex(b.startISO, todayISO) : 0;
            rows.push({ ...base, status: 'ceka', bookedWD: 0, startDelay: lateStart || undefined, late: lateStart > 0,
                verdict: lateStart > 0 ? `nije počeo — početak kasni ${days(lateStart)}` : `počinje ${dm(b.startISO)}` });
            continue;
        }
        // U toku: preostali rad po planu, od danas, ekipom bloka.
        const crew = crewSizeOf(b);
        const rest = Math.max(0, base.plannedWD - booked);
        const forecastEndISO = rest > 0 ? halfSpan(todayISO, false, rest / crew, input.isWorkFor(b)).endISO : todayISO;
        const endDelta = dayIndex(b.endISO, forecastEndISO);
        const over = base.plannedWD > 0 && rest === 0;
        const verdict = over
            ? `upisano ${booked} od ${base.plannedWD} rd — plan rada prekoračen, a nalog nije zatvoren`
            : `${endDelta > 0 ? `prognoza kraja ${dm(forecastEndISO)} (${days(endDelta)} kasni)` : `prognoza kraja ${dm(forecastEndISO)} — u planu`} · ostalo ${r1(rest)} rd`;
        rows.push({ ...base, status: 'u-toku', bookedWD: booked, firstISO, lastISO, forecastEndISO, startDelay, endDelta, effortRatio, late: over || endDelta > 0, verdict });
    }

    rows.sort((a, b) => Number(b.late) - Number(a.late) || a.plannedStartISO.localeCompare(b.plannedStartISO));
    const done = rows.filter(r => r.status === 'gotov' && r.plannedWD > 0);
    const plannedDone = done.reduce((s, r) => s + r.plannedWD, 0);
    const effortAccuracy = plannedDone > 0 ? done.reduce((s, r) => s + r.bookedWD, 0) / plannedDone : null;
    const late = rows.filter(r => r.late).length;
    const notConverted = rows.filter(r => r.status === 'nije-pokrenut').length;
    const onTime = rows.filter(r => !r.late && r.status !== 'otkazan' && r.status !== 'nije-pokrenut').length;

    const lines: string[] = [];
    if (!rows.length) lines.push('Nijedan nalog s Platna još nije pokrenut kao stvarni nalog, a nijedan nije trebao početi.');
    else {
        lines.push(`${rows.length} naloga poređeno: ${onTime} u planu, ${late} kasni${notConverted ? ` (od toga ${notConverted} nije pokrenuto)` : ''}.`);
        if (effortAccuracy !== null) {
            lines.push(`Procjena rada na završenim nalozima: upisano ${pct(effortAccuracy)} planiranog${effortAccuracy > 1.1 ? ' — plan potcjenjuje posao' : effortAccuracy < 0.9 ? ' — plan precjenjuje posao' : ''}.`);
        }
    }
    return { rows, late, onTime, notConverted, effortAccuracy, lines };
}
