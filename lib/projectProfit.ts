// ════════════════════════════════════════════════════════════════════
// PROFIT PROJEKTA — jedinstvena agregacija, isti izvor kao WorkOrderExpandedDetail.
//
// Kartica projekta MORA pokazivati isti profit kao zbir naloga u tabu Nalozi.
// Prije ove funkcije, kartica je imala vlastitu inline formulu (ŽIVI trošak
// materijala, rad po Product_ID kroz SVE naloge, "reprezentativna" stavka po
// proizvodu, preskok stavki bez cijene) — različitu od WorkOrderExpandedDetail
// (snapshot Material_Cost, rad po Work_Order_Item_ID, sve stavke se broje).
// Ova funkcija koristi ISTE ulaze kao WorkOrderExpandedDetail (itemFin), pa
// profit projekta == Σ profita svih njegovih naloga, do centa.
//
// Namjerne razlike od stare kartice:
//   • BEZ preskoka stavki bez cijene (finalSellingPrice<=0) — rad uložen u
//     nedefinisan proizvod mora biti VIDLJIV gubitak (missingPrice flag),
//     ne sakriven iz zbira projekta.
//   • BEZ "reprezentativne stavke" — SVAKA stavka svakog naloga se broji
//     (ispravlja i edge-case kad je proizvod podijeljen na 2+ naloga: prije
//     se prihod brojao samo iz jedne stavke a rad iz svih → podcijenjen profit).
//   • Montaža stavke se normalizuju na 0 prihoda/materijala/usluga/transporta
//     (samo rad je trošak) — odbrana od istorijske korupcije (vidi WS-0 guard
//     u lib/attendance.ts recalculateWorkOrder).
// ════════════════════════════════════════════════════════════════════

import type { WorkOrder, WorkOrderItem, WorkLog } from './types';
import { itemProfitBreakdown, sumBreakdowns, type ProfitBreakdown } from './profit';

export interface ProjectProfitResult extends ProfitBreakdown {
    perItem: Map<string, ProfitBreakdown>; // WorkOrderItem.ID → breakdown
    itemCount: number;
}

type ProjectProfitWorkOrder = Pick<WorkOrder, 'Work_Order_ID' | 'Status' | 'Work_Order_Type'> & {
    items?: Pick<WorkOrderItem, 'ID' | 'Project_ID' | 'Product_Value' | 'Material_Cost' | 'Quantity' | 'Services_Total' | 'Transport_Share' | 'Profit_Overrides'>[];
};
type ProjectProfitWorkLog = Pick<WorkLog, 'Work_Order_Item_ID' | 'Daily_Rate'>;

export function projectProfitBreakdown(args: {
    projectId: string;
    workOrders: ProjectProfitWorkOrder[];
    workLogs: ProjectProfitWorkLog[];
}): ProjectProfitResult {
    const { projectId, workOrders, workLogs } = args;

    const laborByItem = new Map<string, number>();
    for (const wl of workLogs) {
        if (!wl.Work_Order_Item_ID) continue;
        laborByItem.set(wl.Work_Order_Item_ID, (laborByItem.get(wl.Work_Order_Item_ID) || 0) + (wl.Daily_Rate || 0));
    }

    const perItem = new Map<string, ProfitBreakdown>();
    for (const wo of workOrders) {
        if (wo.Status === 'Otkazano') continue;
        const isMontaza = wo.Work_Order_Type === 'Montaža';
        for (const item of wo.items || []) {
            if (item.Project_ID !== projectId) continue;
            const labor = laborByItem.get(item.ID) || 0;
            const breakdown = isMontaza
                ? itemProfitBreakdown({ laborTotal: labor })
                : itemProfitBreakdown({
                    productValue: item.Product_Value,
                    sellingOverride: item.Profit_Overrides?.Selling_Price,
                    materialPerUnit: item.Material_Cost,
                    quantity: item.Quantity,
                    laborTotal: labor,
                    servicesTotal: item.Services_Total,
                    transportShare: item.Transport_Share,
                    transportOverride: item.Profit_Overrides?.Transport_Share,
                });
            perItem.set(item.ID, breakdown);
        }
    }

    const total = sumBreakdowns(Array.from(perItem.values()));
    return { ...total, perItem, itemCount: perItem.size };
}
