'use client';

// ════════════════════════════════════════════════════════════════════
// Jedinična ekonomija proizvoda (cijena iz prihvaćene ponude + živa sastavnica)
// za komponente duboko u stablu (detalj naloga, rezime naloga) — bez provlačenja
// projekata i ponuda kroz props. Pravi proračun je u lib/projectFinance.ts.
//
// Bez providera (npr. dev preview) vraća praznu osnovu → stavke padaju na
// vrijednosti sačuvane na nalogu (stari prikaz), pa ništa ne puca.
// ════════════════════════════════════════════════════════════════════

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { buildFinanceBasis, EMPTY_FINANCE_BASIS, type FinanceBasis, type FinOffer, type FinProduct } from '@/lib/projectFinance';

const FinanceBasisContext = createContext<FinanceBasis>(EMPTY_FINANCE_BASIS);

export function FinanceBasisProvider({ projects, offers, children }: {
    projects: { products?: FinProduct[] }[];
    offers: FinOffer[];
    children: ReactNode;
}) {
    const basis = useMemo(() => {
        const products: FinProduct[] = [];
        for (const p of projects || []) for (const pr of p.products || []) products.push(pr);
        return buildFinanceBasis(products, offers || []);
    }, [projects, offers]);
    return <FinanceBasisContext.Provider value={basis}>{children}</FinanceBasisContext.Provider>;
}

export function useFinanceBasis(): FinanceBasis {
    return useContext(FinanceBasisContext);
}
