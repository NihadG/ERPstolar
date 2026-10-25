'use client';

// ════════════════════════════════════════════════════════════════════
// /process-plan-preview — PRAVI prozor „Plan procesa" bez prijave
//
// Proizvodi sa slajdova „Ispravke za app ERP" (25.10.2026) i plan koji im daju
// standardna pravila (isti motor kao Auto prijedlog): ?p=krevet|kuhinja|komoda|hpl.
// Ne pritiskati „Auto prijedlog" ni prevlačenje: pišu u pravu bazu.
//
// U produkciji ruta ne postoji.
// ════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import { notFound } from 'next/navigation';
import ProductProcessPlan from '@/components/ui/ProductProcessPlan';
import { buildGraphFromRules, flattenStages, stagesFromGraph } from '@/lib/productProcesses';
import { STANDARD_CATALOG, STANDARD_RULES } from '@/lib/processStandard';
import type { Product } from '@/lib/types';

const DEMO: Record<string, { name: string; materials: string[] }> = {
    krevet: { name: 'Poz 1 - Kreveti 1800', materials: ['Iveral / Bijeli za korpus', 'KT / W1000 Premium bijela', 'Šperploča breza 12', 'Masiv / Hrast', 'Furnir / Hrast', 'KT / Furnir Hrast 24 / 1', 'Okov za krevet@Okovi'] },
    kuhinja: { name: 'Poz 3 - Kuhinja', materials: ['Baglama ravna (bez ublazivaca)@Okovi', 'Boja za MDF', 'Furnir / Hrast', 'Iveral / W1000 Bijela', 'KT / Furnir Hrast 24 / 1', 'KT / W1000 Premium bijela', 'Lakiranje', 'Lesomal', 'MDF 18', 'Vodilice Blum 550@Okovi'] },
    komoda: { name: 'Poz 2 - Retropult komoda', materials: ['Baglama ravna (sa ublazivacem)@Okovi', 'Furnir / Orah', 'Lakiranje', 'MDF 18', 'Vodilice Blum 500@Okovi'] },
    hpl: { name: 'Recepcija', materials: ['HPL / Fenix 0720', 'MDF 18', 'Iveral / Bijeli', 'Vodilice Blum 500@Okovi', 'Kerrock / 101 Bijela', 'OSB 18', 'Baglama@Okovi'] },
};

function demoProduct(key: string): Product {
    const d = DEMO[key] || DEMO.krevet;
    const materials = d.materials.map(n => { const [Material_Name, Category = ''] = n.split('@'); return { Material_Name, Category }; });
    const catalog = STANDARD_CATALOG.map((Name, i) => ({ Name, Order: i + 1 }));
    const stages = stagesFromGraph(buildGraphFromRules(materials, STANDARD_RULES, undefined, catalog, d.name).graph);
    return {
        Product_ID: `preview-${key}`, Name: d.name,
        Process_Stages: stages.map(processes => ({ processes })), Process_Plan: flattenStages(stages), Process_Plan_Source: 'auto',
    } as unknown as Product;
}

export default function ProcessPlanPreviewPage() {
    if (process.env.NODE_ENV === 'production') notFound();
    const [product, setProduct] = useState<Product | null>(null);
    // Modal tek poslije montiranja (inače hidratacija ne prolazi).
    useEffect(() => { setProduct(demoProduct(new URLSearchParams(window.location.search).get('p') || 'krevet')); }, []);
    return (
        <main style={{ minHeight: '100vh', background: 'var(--background)' }}>
            {product && (
                <ProductProcessPlan product={product} organizationId="preview-org" onChanged={() => undefined}
                    onClose={() => undefined} showToast={(m) => console.log('[toast]', m)} />
            )}
        </main>
    );
}
