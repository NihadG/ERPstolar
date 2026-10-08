// ════════════════════════════════════════════════════════════════════
// ČISTA LOGIKA PRIJEDLOGA KNJIŽENJA IZ ŠIHTARICE (bez Firebase, pokrivena testovima).
//
// Kad se u šihtarici radnik označi PRISUTAN/TEREN, UI ne knjiži odmah — gradi PRIJEDLOG i traži
// potvrdu. Ovdje je sva odluka šta ponuditi:
//   • Prisutan → lista AKTIVNIH, PAUZIRANIH i NEPOKRENUTIH naloga (bilo kog tipa, ne samo dodijeljenih).
//     Već knjiženi nalozi otvorenog dana, inače posljednjeg ranijeg dana radnika, su predčekirani;
//     pauzirani se mogu „pokrenuti ponovo",
//     a nepokrenuti ('Na čekanju') se auto-STARTAJU na potvrdi (prepareWorkerOrderTargets) — tako
//     novi nalog + šihtarica idu u JEDNOM prolazu, bez ponovnog snimanja prisustva.
//   • Teren    → UVIJEK red u upitu (teren je dvosmislen). Predabir koristi stvarna
//     ranija knjiženja; korisnik može izabrati BILO koji nalog, novi nalog ili ništa.
//     Uz predabir red nosi i `orders` — punu ponudu naloga (montaža prva, ali i „Razni poslovi",
//     i završeni). Desktop je ne koristi (ima pretraživu listu svih naloga), telefon bez nje nema
//     šta ponuditi.
// Knjiženje na potvrdu radi lib/attendance.ts → bookWorkerDayItems (aditivno, idempotentno).
// ════════════════════════════════════════════════════════════════════

import type { WorkOrder, WorkOrderItem } from './types';
import { isWorkerAssignedToAutoItem, type AutoBookItem } from './autoBook';
import { workOrderDisplayName } from './utils';

/** Radnik upravo snimljen u šihtarici (za koga gradimo prijedlog). */
export interface SavedAttendanceWorker {
    workerId: string;
    workerName: string;
    status: string;                      // 'Prisutan' | 'Teren' | ostali (ignorisani)
}

/** Nalog koji prisutan radnik može izabrati (aktivan, pauziran ili nepokrenut). */
export interface PresentOrderOption {
    workOrderId: string;
    name: string;
    status: string;                      // Status naloga (npr. 'U toku')
    paused: boolean;                     // sav preostali posao je pauziran → „pokreni ponovo"
    assigned: boolean;                   // radnik je dodijeljen nekoj stavci
    notStarted: boolean;                 // 'Na čekanju' → potvrda knjiženja ga auto-starta
    type?: string;                       // Work_Order_Type — telefon po njemu grupiše ponudu
}

/** Prisutan radnik: ponuda naloga; predčekirani su stvarno knjiženi nalozi. */
export interface PresentProposalRow {
    kind: 'present';
    workerId: string;
    workerName: string;
    orders: PresentOrderOption[];
    suggestedOrderIds: string[];         // default čekirano
    bookedPresence?: 0.5 | 1;
    hasExistingBooking?: boolean;
}

/** Teren radnik: korisnik bira na šta se teren odnosi. */
export interface TerenProposalRow {
    kind: 'teren';
    workerId: string;
    workerName: string;
    suggestedWorkOrderId?: string;       // kompatibilno polje za prvi stvarno knjiženi nalog
    suggestedOrderIds: string[];          // sva prethodno knjižena zaduženja (i više naloga istog dana)
    bookedPresence?: 0.5 | 1;
    hasExistingBooking?: boolean;
    /**
     * Nalozi koje teren radnik može izabrati — montažni prvi, ali NE samo oni:
     * teren se u praksi knjiži i na „Razne poslove" (isporuka, popravka kod kupca).
     *
     * Desktop ovo polje ne koristi (ima vlastitu pretraživu listu svih naloga),
     * ali telefon bez njega nema ŠTA da ponudi — a bez izbora se dnevnica ne
     * može proknjižiti i ekran ostaje slijepa ulica („Odaberi bar jedan nalog"
     * nad listom bez ijedne opcije).
     */
    orders: PresentOrderOption[];
}

export type ProposalRow = PresentProposalRow | TerenProposalRow;

/** Nalog koji je korisnik zaista knjižio. Preusmjereni trošak zadržava izvorni nalog rada. */
export function bookedOrderId(log: { Work_Order_ID?: string; Source_Work_Order_ID?: string }): string {
    return log.Source_Work_Order_ID || log.Work_Order_ID || '';
}

export function postedOrdersByWorker(logs: { Worker_ID: string; Work_Order_ID?: string; Source_Work_Order_ID?: string }[]): Map<string, string[]> {
    const result = new Map<string, string[]>();
    for (const log of logs) {
        const id = bookedOrderId(log);
        if (!log.Worker_ID || !id) continue;
        const ids = result.get(log.Worker_ID) || [];
        if (!ids.includes(id)) ids.push(id);
        result.set(log.Worker_ID, ids);
    }
    return result;
}

/**
 * Posljednji raniji dan jednog radnika koji ima UPOTREBLJIVE naloge za „Prepiši".
 * Ranije se uzimao doslovno zadnji datum s bilo kojim zapisom — ako su tog dana
 * svi zapisi bili s obrisanog/otkazanog naloga, prijedlog je ostajao prazan i
 * dugme sivo, iako je dan prije imao sasvim valjano knjiženje.
 *
 * @param logs zapisi radnika prije otvorenog dana (prozor posljednjih N, bilo kojim redom)
 * @param windowFull prozor je pun → najstariji dan u njemu može biti odsječen, pa se preskače
 */
export function lastUsableBookedDay(
    logs: { Worker_ID: string; Date: string; Work_Order_ID?: string; Source_Work_Order_ID?: string; Work_Order_Deleted?: boolean }[],
    workerId: string,
    isUsableOrder: (id: string) => boolean = () => true,
    windowFull = false,
): { date: string; ids: string[] } | null {
    const byDate = new Map<string, typeof logs>();
    for (const log of logs) {
        if (log.Work_Order_Deleted === true) continue;
        const list = byDate.get(log.Date) || [];
        list.push(log);
        byDate.set(log.Date, list);
    }
    const dates = Array.from(new Set(logs.map(l => l.Date))).sort().reverse();
    const usableDates = windowFull ? dates.slice(0, -1) : dates;
    for (const date of usableDates) {
        const ids = (postedOrdersByWorker(byDate.get(date) || []).get(workerId) || []).filter(isUsableOrder);
        if (ids.length > 0) return { date, ids };
    }
    return null;
}

/** Ručni zapisi se nikad ne brišu iz šihtarice. */
export function isDeselectedAttendanceLog(
    log: { Work_Order_ID?: string; Source_Work_Order_ID?: string; Booking_Source?: string; Is_From_Attendance?: boolean },
    selectedOrderIds: ReadonlySet<string>
): boolean {
    return (log.Booking_Source === 'attendance' || (log.Booking_Source !== 'manual' && log.Is_From_Attendance === true))
        && !selectedOrderIds.has(bookedOrderId(log));
}

function toAutoBookItem(it: WorkOrderItem): AutoBookItem {
    return {
        ID: it.ID,
        Status: it.Status,
        Is_Paused: it.Is_Paused,
        Completed_At: it.Completed_At,
        Assigned_Workers: it.Assigned_Workers,
        Processes: it.Processes,
        SubTasks: it.SubTasks,
    };
}

/**
 * Izgradi prijedlog knjiženja za skup upravo snimljenih radnika.
 * @param hasExistingLog (radnik, stavka) → da li već postoji zapis tog dana (manualni ima prednost).
 * @param yesterdayByWorker svaki radnik → nalozi s njegovog posljednjeg RANIJEG knjiženog dana.
 * @param postedTodayByWorker svaki radnik → nalozi već knjiženi na otvoreni dan.
 *   Otvoreni dan uvijek ima prednost. Novi dan nudi samo stvarni zadnji rad,
 *   a dodjela naloga ostaje ponuđena za ručni izbor bez predčekiranja.
 *   Korisnik i dalje POTVRĐUJE — ništa se ne knjiži tiho (garda: ručno knjiženje ima prednost).
 */
export function buildBookingProposal(
    saved: SavedAttendanceWorker[],
    workOrders: WorkOrder[],
    date: string,
    hasExistingLog: (workerId: string, itemId: string) => boolean = () => false,
    yesterdayByWorker?: Map<string, string[]>,
    postedTodayByWorker?: Map<string, string[]>,
    postedPresenceByWorker?: Map<string, 0.5 | 1>
): ProposalRow[] {
    const rows: ProposalRow[] = [];
    for (const w of saved) {
        const postedToday = postedTodayByWorker?.get(w.workerId);
        const historical = postedToday?.length
            ? postedToday
            : (yesterdayByWorker?.get(w.workerId) || []).filter(id =>
                workOrders.some(o => o.Work_Order_ID === id && o.Status !== 'Otkazano')
            );
        if (w.status === 'Prisutan') {
            const orders = withAlreadyPostedOptions(
                buildPresentOrderOptions(workOrders, w.workerId, new Set(historical)),
                workOrders, postedToday || []
            );
            if (orders.length === 0) continue;                  // nema aktivnih/pauziranih naloga → bez reda
            const availableIds = new Set(orders.map(o => o.workOrderId));

            rows.push({
                kind: 'present',
                workerId: w.workerId,
                workerName: w.workerName,
                orders,
                suggestedOrderIds: historical.filter(id => availableIds.has(id)),
                bookedPresence: postedPresenceByWorker?.get(w.workerId),
                hasExistingBooking: !!postedToday?.length,
            });
        } else if (w.status === 'Teren') {
            const orders = withAlreadyPostedOptions(
                buildTerenOrderOptions(workOrders, w.workerId), workOrders, postedToday || []
            );
            const availableIds = new Set(orders.map(o => o.workOrderId));
            const suggestedOrderIds = historical.filter(id => availableIds.has(id));
            rows.push({
                kind: 'teren',
                workerId: w.workerId,
                workerName: w.workerName,
                suggestedWorkOrderId: suggestedOrderIds[0],
                suggestedOrderIds,
                orders,
                bookedPresence: postedPresenceByWorker?.get(w.workerId),
                hasExistingBooking: !!postedToday?.length,
            });
        }
        // ostali statusi (Odsutan/Bolovanje/Odmor/Vikend/Praznik) → ne ulaze u upit
    }
    return rows;
}

/** Ranije knjiženi nalog mora ostati vidljiv i kad je poslije završen/otkazan/obrisan. */
function withAlreadyPostedOptions(
    options: PresentOrderOption[], workOrders: WorkOrder[], postedToday: string[]
): PresentOrderOption[] {
    const known = new Set(options.map(o => o.workOrderId));
    const out = [...options];
    for (const id of postedToday) {
        if (known.has(id)) continue;
        const order = workOrders.find(o => o.Work_Order_ID === id);
        out.push(order ? toOption(order, false, false) : {
            workOrderId: id, name: `Nalog ${id}`, status: 'Arhiviran',
            paused: false, assigned: false, notStarted: false,
        });
        known.add(id);
    }
    return out;
}

/** Aktivni + pauzirani + nepokrenuti nalozi (bilo kog tipa) koje prisutan radnik može izabrati. */
function buildPresentOrderOptions(workOrders: WorkOrder[], workerId: string, historicalIds: ReadonlySet<string>): PresentOrderOption[] {
    const out: PresentOrderOption[] = [];
    for (const wo of workOrders) {
        // 'Na čekanju' se nudi da bi se NOVI nalog pokrenuo i proknjižio u jednom prolazu
        // (potvrda ga starta u prepareWorkerOrderTargets) — inače nastaje začarani krug:
        // start traži prisustvo, a upit knjiženja ne nudi nepokrenut nalog.
        // EFIKASNOST: 'Završeno'/'Otkazano' se i dalje preskaču prije skupog skeniranja
        // stavki — 'Završeno' po definiciji ima SVE stavke završene (vidi recalculateWorkOrder
        // status derivaciju), pa bi `live` uvijek bio prazan i anyPaused uvijek false; bez ovoga
        // se svaki istorijski nalog skenira pri SVAKOM označavanju prisustva (stotine naloga).
        if (wo.Status !== 'U toku' && wo.Status !== 'Na čekanju' && !historicalIds.has(wo.Work_Order_ID)) continue;
        const live = (wo.items || []).filter(it => it.Status !== 'Završeno');
        const fullyPaused = live.length > 0 && live.every(it => it.Is_Paused);
        const assigned = live.some(it => isWorkerAssignedToAutoItem(toAutoBookItem(it), workerId));
        out.push(toOption(wo, fullyPaused, assigned));
    }
    // dodijeljeni prvi, pa aktivni (nepokrenuti iza njih), pa po nazivu
    out.sort((a, b) => {
        if (a.assigned !== b.assigned) return a.assigned ? -1 : 1;
        const aAct = a.status === 'U toku', bAct = b.status === 'U toku';
        if (aAct !== bAct) return aAct ? -1 : 1;
        return a.name.localeCompare(b.name);
    });
    return out;
}

/**
 * Nalozi koje TEREN radnik može izabrati.
 *
 * Šire od prisutnog radnika u dvije stvari, i obje su namjerne:
 *  • uzima i ZAVRŠENE naloge — montaža se često knjiži na dan kad je nalog
 *    zatvoren (isto pravilo koje `getBookableWorkOrders` primjenjuje na servu);
 *  • ne filtrira po tipu — teren nije samo montaža. Isporuka, popravka kod
 *    kupca i slično žive kao „Razni poslovi" (tip 'Zadaci').
 *
 * Poredak stavlja montažu na vrh jer je to i dalje najčešći slučaj.
 */
function buildTerenOrderOptions(workOrders: WorkOrder[], workerId: string): PresentOrderOption[] {
    const out: PresentOrderOption[] = [];
    for (const wo of workOrders) {
        if (wo.Status === 'Otkazano') continue;
        const live = (wo.items || []).filter(it => it.Status !== 'Završeno');
        const fullyPaused = live.length > 0 && live.every(it => it.Is_Paused);
        const assigned = (wo.items || []).some(it => isWorkerAssignedToAutoItem(toAutoBookItem(it), workerId));
        out.push(toOption(wo, fullyPaused, assigned));
    }
    const rank = (o: PresentOrderOption) =>
        (o.assigned ? 0 : 4) + (o.type === 'Montaža' ? 0 : 2) + (o.status === 'U toku' ? 0 : 1);
    out.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    return out;
}

function toOption(wo: WorkOrder, paused: boolean, assigned: boolean): PresentOrderOption {
    return {
        workOrderId: wo.Work_Order_ID,
        name: workOrderDisplayName(wo),
        status: wo.Status,
        paused,
        assigned,
        notStarted: wo.Status === 'Na čekanju',
        type: wo.Work_Order_Type,
    };
}

/** Da li uneseni statusi uopšte zahtijevaju upit. */
export function proposalNeedsConfirm(rows: ProposalRow[]): boolean {
    return rows.length > 0;
}
