// ════════════════════════════════════════════════════════════════════
// ČISTA LOGIKA AUTO-KNJIŽENJA IZ ŠIHTARICE (bez Firebase, pokrivena testovima).
//
// Pravilo: kada se radnik označi PRISUTAN/TEREN za neki dan, dnevnica se automatski
// knjiži na AKTIVNE naloge na kojima je radnik DODIJELJEN — ali:
//   • samo aktivan nalog (U toku; ili Završeno koji je pokrivao taj dan),
//   • nalog mora biti započet do tog dana (Started_At ≤ datum),
//   • Prisutan → proizvodni nalozi; Teren → montažni (Montaža),
//   • proizvod NIJE pauziran (Is_Paused),
//   • proizvod nije završen PRIJE tog dana,
//   • radnik je dodijeljen proizvodu (Assigned_Workers / Processes / SubTasks),
//   • NE postoji već zapis za (radnik, proizvod, dan) → manualni unos ima prednost (bez dupliranja).
// Odsutan radnik ili pauziran/nepripadajući nalog → NIŠTA (osim ručno).
// ════════════════════════════════════════════════════════════════════

const PRESENT_STATUSES = new Set(['Prisutan', 'Teren']);
const dOnly = (iso?: string | null): string => (iso ? iso.split('T')[0] : '');

export interface AutoBookWorkerRef { Worker_ID: string }
export interface AutoBookProcessRef { Worker_ID?: string; Helpers?: AutoBookWorkerRef[] }

export interface AutoBookItem {
    ID: string;
    Status?: string;                         // 'Na čekanju' | 'U toku' | 'Završeno'
    Is_Paused?: boolean;
    Completed_At?: string;
    Assigned_Workers?: AutoBookWorkerRef[];
    Processes?: AutoBookProcessRef[];
    SubTasks?: AutoBookProcessRef[];
}

export interface AutoBookOrder {
    Work_Order_ID: string;
    Status?: string;                         // 'U toku' | 'Završeno' | 'Na čekanju' | 'Otkazano'
    Work_Order_Type?: string;                // 'Montaža' za montažu
    Started_At?: string;
    Completed_At?: string;
    items: AutoBookItem[];
}

export interface SelectAutoBookParams {
    workerId: string;
    date: string;                            // YYYY-MM-DD
    status: string;                          // status iz šihtarice
    orders: AutoBookOrder[];
    /** Da li radnik VEĆ ima zapis za (taj proizvod, taj dan). */
    hasExistingLog: (itemId: string) => boolean;
}

export function isWorkerAssignedToAutoItem(item: AutoBookItem, workerId: string): boolean {
    if (item.Assigned_Workers?.some(w => w.Worker_ID === workerId)) return true;
    if (item.Processes?.some(p => p.Worker_ID === workerId || p.Helpers?.some(h => h.Worker_ID === workerId))) return true;
    if (item.SubTasks?.some(st => st.Worker_ID === workerId || st.Helpers?.some(h => h.Worker_ID === workerId))) return true;
    return false;
}

/** Da li je nalog aktivan (kandidat za auto-knjiženje) na dati dan. */
export function isOrderActiveOn(wo: AutoBookOrder, date: string): boolean {
    const coversAsFinished = wo.Status === 'Završeno' && dOnly(wo.Completed_At) >= date && dOnly(wo.Completed_At) !== '';
    if (wo.Status !== 'U toku' && !coversAsFinished) return false;   // Na čekanju / Otkazano / završen prije
    if (!wo.Started_At || dOnly(wo.Started_At) > date) return false; // još nije započet na taj dan
    return true;
}

/**
 * Vrati ID-eve proizvoda na koje treba AUTOMATSKI proknjižiti dnevnicu radnika za dati dan.
 * Prazno ako radnik nije prisutan ili nema kvalifikovanih proizvoda.
 */
export function selectAutoBookItemIds(params: SelectAutoBookParams): string[] {
    const { workerId, date, status, orders, hasExistingLog } = params;
    if (!PRESENT_STATUSES.has(status)) return [];

    const out: string[] = [];
    for (const wo of orders) {
        if (!isOrderActiveOn(wo, date)) continue;

        const isMontaza = wo.Work_Order_Type === 'Montaža';
        if (status === 'Teren' && !isMontaza) continue;     // teren → samo montaža
        if (status === 'Prisutan' && isMontaza) continue;   // prisutan (pogon) → samo proizvodnja

        for (const item of wo.items) {
            if (item.Is_Paused) continue;                                                   // pauziran → preskoči
            if (item.Status === 'Završeno' && dOnly(item.Completed_At) && dOnly(item.Completed_At) < date) continue; // završen prije
            if (!isWorkerAssignedToAutoItem(item, workerId)) continue;                       // nije dodijeljen
            if (hasExistingLog(item.ID)) continue;                                           // već ima zapis (manualni ima prednost)
            out.push(item.ID);
        }
    }
    return Array.from(new Set(out));
}
