'use client';

// ════════════════════════════════════════════════════════════════════
// /wizard-preview — MAKETA mobilnog čarobnjaka novog naloga
//
// Nalozi su iza prijave, pa se mobilni tok ne može vidjeti bez naloga.
// Ova ruta renderuje PRAVI MobileWorkOrderWizard (i proizvodni i montažni)
// nad podacima Komandnog centra, dopunjenim prihvaćenom ponudom da se vide
// finansije i predloženi rok. Kreiranje ne prolazi (nema baze) — to je
// namjerno: provjerava se raspored, ne upis.
//
// U produkciji ruta ne postoji.
// ════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import { notFound } from 'next/navigation';
import MobileWorkOrderWizard from '@/components/tabs/mobile/MobileWorkOrderWizard';
import MobileWorkOrdersView from '@/components/tabs/mobile/MobileWorkOrdersView';
import type { WizardMode } from '@/components/production/useWorkOrderWizard';
import { demoProjects, demoWorkOrders, demoWorkers, demoTasks } from '@/lib/command/demoData';
import type { Project, Worker } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default function WizardPreviewPage() {
    // Otvara se tek poslije montiranja — overlay je portal i ne smije učestvovati u hidrataciji.
    const [mode, setMode] = useState<WizardMode | null>(null);
    useEffect(() => { if (!new URLSearchParams(location.search).has('list')) setMode('production'); }, []);
    const [toast, setToast] = useState('');

    // Prihvaćena ponuda na projektu s dostupnim pozicijama → vide se vrijednost, planirani rad i auto-rok.
    const projects = useMemo<Project[]>(() => demoProjects.map((p, i) => i !== 2 ? p : ({
        ...p,
        offers: [{
            Offer_ID: 'of-1', Status: 'Prihvaćeno',
            products: (p.products || []).map(pr => ({
                Product_ID: pr.Product_ID, Selling_Price: 1450, Labor_Days: 3, Labor_Workers: 2, Labor_Daily_Rate: 90,
                Transport_Share: 40, extras: [],
            })),
        }],
    } as unknown as Project)), []);

    const workers = useMemo<Worker[]>(() => [
        ...demoWorkers.map(w => ({ ...w, Worker_Type: 'Glavni', Role: 'Stolar' } as Worker)),
        { Worker_ID: 'w-4', Organization_ID: 'demo', Name: 'Mirza Delić', Worker_Type: 'Pomoćnik', Role: 'Pomoćnik' } as unknown as Worker,
        { Worker_ID: 'w-5', Organization_ID: 'demo', Name: 'Haris Mujić', Worker_Type: 'Glavni', Role: 'Montažer' } as unknown as Worker,
    ], []);

    if (process.env.NODE_ENV === 'production') notFound();

    return (
        <div style={{ padding: 16 }}>
            {/* Ista lista kao ProductionTab na telefonu — ulaz u čarobnjak ide kroz „Novi nalog". */}
            <MobileWorkOrdersView
                workOrders={demoWorkOrders}
                workers={workers}
                tasks={demoTasks}
                projects={projects}
                onRefresh={() => { /* maketa */ }}
                showToast={message => { setToast(message); setTimeout(() => setToast(''), 2600); }}
                onCreate={() => setMode('production')}
                onCreateMontaza={() => setMode('montaza')}
                onOpenPage={() => { /* maketa */ }}
                onUpdate={async () => { /* maketa */ }}
                onDelete={() => { /* maketa */ }}
                onStart={() => { /* maketa */ }}
                onPrint={() => { /* maketa */ }}
            />
            {toast && (
                <div style={{
                    position: 'fixed', bottom: 90, left: '50%', transform: 'translateX(-50%)', zIndex: 5000,
                    background: '#1d1d1f', color: '#fff', padding: '9px 16px', borderRadius: 10, fontSize: 13, maxWidth: '90vw',
                }}>{toast}</div>
            )}
            <MobileWorkOrderWizard
                isOpen={!!mode}
                mode={mode || 'production'}
                workOrders={demoWorkOrders}
                projects={projects}
                workers={workers}
                tasks={demoTasks}
                organizationId="demo"
                onClose={() => setMode(null)}
                onRefresh={() => { /* maketa nema šta osvježiti */ }}
                showToast={message => { setToast(message); setTimeout(() => setToast(''), 2600); }}
            />
        </div>
    );
}
