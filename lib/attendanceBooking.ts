// ════════════════════════════════════════════════════════════════════
// ČISTA LOGIKA PRIJEDLOGA KNJIŽENJA IZ ŠIHTARICE (bez Firebase, pokrivena testovima).
//
// Kad se u šihtarici radnik označi PRISUTAN/TEREN, UI ne knjiži odmah — gradi PRIJEDLOG i traži
// potvrdu. Ovdje je sva odluka šta ponuditi:
//   • Prisutan → lista AKTIVNIH i PAUZIRANIH naloga (bilo kog tipa, ne samo dodijeljenih).
//     Dodijeljeni aktivni nalozi su predčekirani; pauzirani se mogu „pokrenuti ponovo" na potvrdi.
//   • Teren    → UVIJEK red u upitu (teren je dvosmislen). Predabir = dodijeljeni aktivni Montaža
//     nalog; korisnik može izabrati BILO koji nalog (aktivan ili neaktivan), novi nalog ili ništa.
// Knjiženje na potvrdu radi lib/attendance.ts → bookWorkerDayItems (aditivno, idempotentno).
// ════════════════════════════════════════════════════════════════════

import type { WorkOrder, WorkOrderItem } from './types';
import { selectAutoBookItemIds, isWorkerAssignedToAutoItem, type AutoBookOrder, type AutoBookItem } from './autoBook';
import { workOrderDisplayName } from './utils';

/** Radnik upravo snimljen u šihtarici (za koga gradimo prijedlog). */
export interface SavedAttendanceWorker {
    workerId: string;
    workerName: string;
    status: string;                      // 'Prisutan' | 'Teren' | ostali (ignorisani)
}

/** Nalog koji prisutan radnik može izabrati (aktivan ili pauziran). */
export interface PresentOrderOption {
    workOrderId: string;
    name: string;
    status: string;                      // Status naloga (npr. 'U toku')
    paused: boolean;                     // sav preostali posao je pauziran → „pokreni ponovo"
    assigned: boolean;                   // radnik je dodijeljen nekoj stavci
}

/** Prisutan radnik: ponuda naloga (predčekirani = dodijeljeni aktivni). */
export interface PresentProposalRow {
    kind: 'present';
    workerId: string;
    workerName: string;
    orders: PresentOrderOption[];
    suggestedOrderIds: string[];         // default čekirano
}

/** Teren radnik: korisnik bira na šta se teren odnosi. */
export interface TerenProposalRow {
    kind: 'teren';
    workerId: string;
    workerName: string;
    suggestedWorkOrderId?: string;       // dodijeljeni aktivni Montaža nalog (predabir), ako postoji
}

export type ProposalRow = PresentProposalRow | TerenProposalRow;

/** WorkOrder (s items) → oblik koji razumije čista odluka selectAutoBookItemIds. */
function toAutoBookOrder(wo: WorkOrder): AutoBookOrder {
    return {
        Work_Order_ID: wo.Work_Order_ID,
        Status: wo.Status,
        Work_Order_Type: wo.Work_Order_Type,
        Started_At: wo.Started_At,
        Completed_At: wo.Completed_At,
        items: (wo.items || []).map(toAutoBookItem),
    };
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
 * @param yesterdayByWorker (radnik → Work_Order_ID[] knjiženi JUČER) → "kao jučer" fallback prijedlog.
 *   Teren i danas bez auto-prijedloga (nije na Montaži) dobije jučerašnji nalog kao predabir;
 *   Prisutan bez ijednog predčekiranog naloga dobije jučerašnje naloge (koji su i danas dostupni).
 *   Korisnik i dalje POTVRĐUJE — ništa se ne knjiži tiho (garda: ručno knjiženje ima prednost).
 */
export function buildBookingProposal(
    saved: SavedAttendanceWorker[],
    workOrders: WorkOrder[],
    date: string,
    hasExistingLog: (workerId: string, itemId: string) => boolean = () => false,
    yesterdayByWorker?: Map<string, string[]>
): ProposalRow[] {
    const autoOrders = workOrders.map(toAutoBookOrder);

    const rows: ProposalRow[] = [];
    for (const w of saved) {
        if (w.status === 'Prisutan') {
            const orders = buildPresentOrderOptions(workOrders, w.workerId);
            if (orders.length === 0) continue;                  // nema aktivnih/pauziranih naloga → bez reda

            // Predčekirano = dodijeljeni aktivni proizvodni nalozi (kako auto-knjiženje radi).
            const autoItemIds = selectAutoBookItemIds({
                workerId: w.workerId, date, status: 'Prisutan',
                orders: autoOrders,
                hasExistingLog: (itemId) => hasExistingLog(w.workerId, itemId),
            });
            const itemToOrder = new Map<string, string>();
            workOrders.forEach(wo => (wo.items || []).forEach(it => itemToOrder.set(it.ID, wo.Work_Order_ID)));
            const suggested = new Set<string>();
            autoItemIds.forEach(id => { const o = itemToOrder.get(id); if (o) suggested.add(o); });
            // Plus svaki dodijeljen, aktivan, nepauziran nalog (uklj. Montažu) → koristan default.
            orders.forEach(o => { if (o.assigned && o.status === 'U toku' && !o.paused) suggested.add(o.workOrderId); });
            // "Kao jučer": ako ništa nije predčekirano, ponudi jučerašnje naloge koji su i danas dostupni.
            if (suggested.size === 0) {
                const yList = yesterdayByWorker?.get(w.workerId) || [];
                const availableIds = new Set(orders.map(o => o.workOrderId));
                yList.forEach(id => { if (availableIds.has(id)) suggested.add(id); });
            }

            rows.push({
                kind: 'present',
                workerId: w.workerId,
                workerName: w.workerName,
                orders,
                suggestedOrderIds: Array.from(suggested),
            });
        } else if (w.status === 'Teren') {
            const terenItemIds = selectAutoBookItemIds({
                workerId: w.workerId, date, status: 'Teren',
                orders: autoOrders,
                hasExistingLog: () => false,
            });
            const itemToOrder = new Map<string, string>();
            workOrders.forEach(wo => (wo.items || []).forEach(it => itemToOrder.set(it.ID, wo.Work_Order_ID)));
            let suggestedWorkOrderId = terenItemIds.length > 0 ? itemToOrder.get(terenItemIds[0]) : undefined;
            // "Kao jučer": teren bez auto-Montaža prijedloga → predloži nalog na koji je radnik JUČER knjižen.
            if (!suggestedWorkOrderId) {
                const yList = yesterdayByWorker?.get(w.workerId);
                if (yList && yList.length) suggestedWorkOrderId = yList[0];
            }
            rows.push({ kind: 'teren', workerId: w.workerId, workerName: w.workerName, suggestedWorkOrderId });
        }
        // ostali statusi (Odsutan/Bolovanje/Odmor/Vikend/Praznik) → ne ulaze u upit
    }
    return rows;
}

/** Aktivni + pauzirani nalozi (bilo kog tipa) koje prisutan radnik može izabrati. */
function buildPresentOrderOptions(workOrders: WorkOrder[], workerId: string): PresentOrderOption[] {
    const out: PresentOrderOption[] = [];
    for (const wo of workOrders) {
        // EFIKASNOST: samo 'U toku' nalog može uopšte imati pauziranu (nezavršenu) stavku —
        // 'Završeno' nalog po definiciji ima SVE stavke završene (vidi recalculateWorkOrder
        // status derivaciju), pa bi `live` uvijek bio prazan i anyPaused uvijek false.
        // Preskoči prije skupog skeniranja stavki — bez ovoga se svaki istorijski (davno
        // završen) nalog skenira pri SVAKOM označavanju prisustva, što s vremenom (mjeseci
        // rada = stotine naloga) usporava otvaranje upita knjiženja.
        if (wo.Status !== 'U toku') continue;
        const live = (wo.items || []).filter(it => it.Status !== 'Završeno');
        const fullyPaused = live.length > 0 && live.every(it => it.Is_Paused);
        const assigned = live.some(it => isWorkerAssignedToAutoItem(toAutoBookItem(it), workerId));
        out.push({
            workOrderId: wo.Work_Order_ID,
            name: workOrderDisplayName(wo),
            status: wo.Status,
            paused: fullyPaused,
            assigned,
        });
    }
    // dodijeljeni prvi, pa aktivni, pa po nazivu
    out.sort((a, b) => {
        if (a.assigned !== b.assigned) return a.assigned ? -1 : 1;
        const aAct = a.status === 'U toku', bAct = b.status === 'U toku';
        if (aAct !== bAct) return aAct ? -1 : 1;
        return a.name.localeCompare(b.name);
    });
    return out;
}

/** Da li uneseni statusi uopšte zahtijevaju upit. */
export function proposalNeedsConfirm(rows: ProposalRow[]): boolean {
    return rows.length > 0;
}
