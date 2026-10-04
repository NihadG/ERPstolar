// ════════════════════════════════════════════════════════════════════
// Finansije svih projekata za ekrane glavne aplikacije (kartica projekta, telefon,
// pregled projekta) — memoizovan omot oko lib/projectFinance.ts.
//
// Glavna aplikacija drži dnevnice samo za zadnjih 12 mjeseci (app/page.tsx), pa stavke
// započete prije tog prozora uzimaju sačuvani agregat rada (vidi buildLaborIndex).
// Analitika učitava sve dnevnice i ne koristi ovaj hook — formula je ista.
// ════════════════════════════════════════════════════════════════════

import { useMemo } from 'react';
import {
    buildFinanceBasis, buildLaborIndex, computeProjectsFinance, workLogsWindowStart,
    type FinanceBasis, type ProjectFinance, type FinProduct, type FinOffer, type FinWorkOrder, type FinLog, type LaborIndex,
} from './projectFinance';

export interface ProjectsFinance {
    basis: FinanceBasis;
    labor: LaborIndex;
    byProject: Map<string, ProjectFinance>;
}

export function useProjectsFinance(
    projects: { products?: FinProduct[] }[] | undefined,
    offers: FinOffer[] | undefined,
    workOrders: FinWorkOrder[] | undefined,
    workLogs: FinLog[] | undefined,
): ProjectsFinance {
    return useMemo(() => {
        const products: FinProduct[] = [];
        for (const p of projects || []) for (const pr of p.products || []) products.push(pr);
        const basis = buildFinanceBasis(products, offers || []);
        const labor = buildLaborIndex(workLogs || [], workOrders || [], workLogsWindowStart());
        const byProject = computeProjectsFinance({ products, basis, workOrders: workOrders || [], labor, logs: workLogs || [] });
        return { basis, labor, byProject };
    }, [projects, offers, workOrders, workLogs]);
}
