'use client';

// ════════════════════════════════════════════════════════════════════
// /work-order-wizard-preview — PRAVI desktop čarobnjak naloga, korak „Radnik & rok"
//
// Nalozi su iza prijave; ova ruta otvara WorkOrderWizard s predizborom proizvoda
// (kao „Kreiraj nalog" iz projekta), pa se raspored može provjeriti na veličini
// laptopa od 15". ?bez=1 → proizvodi bez prihvaćene ponude (nalog prije ponude).
// Kreiranje ne prolazi (nema prijave) — provjerava se raspored, ne upis.
//
// U produkciji ruta ne postoji.
// ════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import { notFound } from 'next/navigation';
import WorkOrderWizard, { type WizardInitialProducts } from '@/components/production/WorkOrderWizard';
import { demoProjects, demoWorkOrders, demoWorkers, demoTasks } from '@/lib/command/demoData';
import type { Project, Worker } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default function WorkOrderWizardPreviewPage() {
    const [seed, setSeed] = useState<WizardInitialProducts | null>(null);
    const [noOffer, setNoOffer] = useState(false);

    const base = demoProjects.find(p => (p.products || []).length >= 3) || demoProjects[0];
    const projects = useMemo<Project[]>(() => demoProjects.map(p => p.Project_ID !== base.Project_ID || noOffer ? p : ({
        ...p,
        offers: [{
            Offer_ID: 'of-1', Project_ID: p.Project_ID, Status: 'Prihvaćeno', Accepted_Date: '2026-10-01',
            products: (p.products || []).map((pr, i) => ({
                Product_ID: pr.Product_ID, Included: true, Quantity: pr.Quantity || 1,
                Selling_Price: 1450 + i * 200, Material_Cost: 600, Labor_Days: i === 1 ? 0 : 0.5, Labor_Workers: 1, Labor_Daily_Rate: 150, extras: [],
            })),
        }],
    } as unknown as Project)), [base.Project_ID, noOffer]);

    const workers = useMemo<Worker[]>(() => [
        ...demoWorkers.map(w => ({ ...w, Worker_Type: 'Glavni', Role: 'Stolar' } as Worker)),
        { Worker_ID: 'w-4', Organization_ID: 'demo', Name: 'Mirza Delić', Worker_Type: 'Pomoćnik', Role: 'Pomoćnik' } as unknown as Worker,
    ], []);

    // Otvara se tek poslije montiranja — modal je portal i ne smije u hidrataciju.
    useEffect(() => {
        const q = new URLSearchParams(location.search);
        setNoOffer(q.has('bez'));
        const n = Number(q.get('n') || 3);
        const prods = (base.products || []).slice(0, n);
        setSeed({
            projectId: base.Project_ID, projectName: base.Name || base.Client_Name,
            products: prods.map(p => ({ productId: p.Product_ID, productName: p.Name, quantity: p.Quantity || 1 })),
        });
    }, [base]);

    if (process.env.NODE_ENV === 'production') notFound();

    return (
        <WorkOrderWizard
            isOpen={!!seed}
            mode="production"
            workOrders={demoWorkOrders}
            projects={projects}
            workers={workers}
            tasks={demoTasks}
            organizationId="demo"
            initialProducts={seed}
            onClose={() => setSeed(null)}
            onRefresh={() => { /* maketa */ }}
            showToast={() => { /* maketa */ }}
        />
    );
}
