'use client';

// ════════════════════════════════════════════════════════════════════
// /mobile-nav-preview — MAKETA mobilne navigacije vlasnika
//
// Glavna aplikacija je iza prijave, pa se donja traka, podtabovi
// (Prodaja: Narudžbe | Ponude, Proizvodnja: Nalozi | Šihtarica) i ekran
// Zadaci ne mogu vidjeti bez naloga. Ova ruta renderuje PRAVE
// MobileTabBar / MobileSubTabs / Mobile*View komponente nad demo podacima.
// Zadaci rade nad lokalnim stanjem (kreiranje, uređivanje, status,
// kontrolna lista), bez upisa u bazu. Šihtarica traži pogonski API, pa je
// ovdje samo ekran-zamjena.
//
// ?tab=<id> otvara određeni ekran (npr. ?tab=tasks). U produkciji ruta ne postoji.
// ════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import { notFound } from 'next/navigation';
import MobileTabBar, { MobileSubTabs, MOBILE_SCREEN_ORDER } from '@/components/tabs/mobile/MobileTabBar';
import MobileTasksView from '@/components/tabs/mobile/MobileTasksView';
import MobileOffersView from '@/components/tabs/mobile/MobileOffersView';
import MobileOrdersView from '@/components/tabs/mobile/MobileOrdersView';
import MobileWorkOrdersView from '@/components/tabs/mobile/MobileWorkOrdersView';
import { MLarge, MEmpty } from '@/components/tabs/mobile/MobileUI';
import { useSwipeTabs } from '@/components/tabs/mobile/useSwipe';
import { demoProjects, demoWorkOrders, demoWorkers, demoTasks, demoOrders } from '@/lib/command/demoData';
import type { Offer, Task, TaskProfile } from '@/lib/types';

export const dynamic = 'force-dynamic';

const noop = () => { /* maketa */ };

const demoOffers = [
    { Offer_ID: 'of-1', Offer_Number: '2026-041', Name: 'Kuhinja i ostava', Client_Name: 'Melihin stan', Project_ID: 'pr-melihin', Status: 'Poslano', Total: 8420, Created_Date: '2026-10-10', Valid_Until: '2026-10-22', products: [{}, {}, {}] },
    { Offer_ID: 'of-2', Offer_Number: '2026-040', Name: 'Obloge zidova', Client_Name: 'Jerko Čorluka', Project_ID: 'pr-jerko', Status: 'Nacrt', Total: 3150, Created_Date: '2026-10-08', products: [{}, {}] },
    { Offer_ID: 'of-3', Offer_Number: '2026-036', Name: 'Klupe za restoran', Client_Name: 'Aamanns 1921', Project_ID: 'pr-aamanns', Status: 'Prihvaćeno', Total: 12900, Created_Date: '2026-09-21', products: [{}, {}, {}, {}] },
] as unknown as Offer[];

const demoProfiles = [
    { Profile_ID: 'pf-1', Organization_ID: 'demo', Name: 'Nihad', Created_Date: '2026-01-01' },
    { Profile_ID: 'pf-2', Organization_ID: 'demo', Name: 'Radionica', Created_Date: '2026-01-01' },
] as TaskProfile[];

export default function MobileNavPreviewPage() {
    const [tab, setTab] = useState('tasks');
    const [tasks, setTasks] = useState<Task[]>(() => [
        ...demoTasks,
        {
            Task_ID: 't-8', Organization_ID: 'demo', Title: 'Provjeriti dimenzije kuhinjskih elemenata prije rezanja ploča za Melihin stan',
            Description: 'Uporediti crtež s mjerama na licu mjesta.\nPosebno visinu ispod prozora.', Status: 'pending', Priority: 'urgent',
            Category: 'manufacturing', Created_Date: '2026-10-15', Due_Date: localDay(0), Assigned_Worker_ID: 'w-2', Assigned_Worker_Name: 'Samir Begić',
            Links: [{ Entity_Type: 'project', Entity_ID: 'pr-melihin', Entity_Name: 'Melihin stan' }, { Entity_Type: 'work_order', Entity_ID: 'wo-125', Entity_Name: 'Nalog 125' }],
            Checklist: [
                { id: 'k1', text: 'Visina radne ploče', completed: true, groupId: 'g1' },
                { id: 'k2', text: 'Širina niše za frižider', completed: false, groupId: 'g1' },
                { id: 'k3', text: 'Fotografisati priključke', completed: false },
            ],
            ChecklistGroups: [{ id: 'g1', name: 'Mjere' }],
            Notes: 'Klijent je kući poslije 16h.',
        } as Task,
    ]);
    const [toast, setToast] = useState('');

    useEffect(() => {
        const t = new URLSearchParams(location.search).get('tab');
        if (t) setTab(t);
    }, []);

    const say = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2400); };

    const idx = MOBILE_SCREEN_ORDER.indexOf(tab);
    useSwipeTabs(
        () => { if (idx > 0) setTab(MOBILE_SCREEN_ORDER[idx - 1]); },
        () => { if (idx >= 0 && idx < MOBILE_SCREEN_ORDER.length - 1) setTab(MOBILE_SCREEN_ORDER[idx + 1]); },
        idx >= 0,
    );

    const workers = useMemo(() => demoWorkers, []);

    if (process.env.NODE_ENV === 'production') notFound();

    return (
        <div style={{ minHeight: '100vh', background: '#f8fafc' }}>
            <main className="content-area" style={{ padding: 16, maxWidth: 'none' }}>
                <MobileSubTabs activeTab={tab} onTabChange={setTab} />

                {tab === 'projects' && <div className="mui"><MLarge title="Projekti" /><MEmpty title="Maketa" sub="Projekti nisu dio ove provjere." /></div>}
                {tab === 'orders' && (
                    <MobileOrdersView
                        orders={demoOrders}
                        suppliers={[]}
                        projects={demoProjects}
                        onRefresh={noop}
                        showToast={say}
                        onOpenWizard={() => say('Nova narudžba (maketa)')}
                        onEditOrder={noop}
                        onDeleteOrder={noop}
                        onDownloadPDF={noop}
                        onPrintOrder={noop}
                    />
                )}
                {tab === 'offers' && (
                    <MobileOffersView
                        offers={demoOffers}
                        projects={demoProjects}
                        onRefresh={noop}
                        showToast={say}
                        onOpenCreate={() => say('Nova ponuda (maketa)')}
                        onViewOffer={noop}
                        onEditOffer={noop}
                        onDeleteOffer={noop}
                        onUpdateStatus={noop}
                        onDownloadPDF={noop}
                        onPrintOffer={noop}
                    />
                )}
                {tab === 'production' && (
                    <MobileWorkOrdersView
                        workOrders={demoWorkOrders}
                        workers={workers}
                        tasks={tasks}
                        projects={demoProjects}
                        onRefresh={noop}
                        showToast={say}
                        onCreate={noop}
                        onCreateMontaza={noop}
                        onOpenPage={noop}
                        onUpdate={async () => { /* maketa */ }}
                        onDelete={noop}
                        onStart={noop}
                        onPrint={noop}
                    />
                )}
                {tab === 'attendance' && <div className="mui"><MLarge title="Šihtarica" /><MEmpty title="Maketa" sub="Šihtarica radi preko pogonskog API-ja i nije dostupna bez prijave." /></div>}
                {tab === 'tasks' && (
                    <MobileTasksView
                        tasks={tasks}
                        projects={demoProjects}
                        workers={workers}
                        materials={[]}
                        workOrders={demoWorkOrders}
                        orders={demoOrders}
                        taskProfiles={demoProfiles}
                        today={localDay(0)}
                        onSave={async (data) => {
                            setTasks(prev => data.Task_ID
                                ? prev.map(t => (t.Task_ID === data.Task_ID ? { ...t, ...data } as Task : t))
                                : [...prev, { ...data, Task_ID: `t-${Date.now()}`, Organization_ID: 'demo', Created_Date: new Date().toISOString() } as Task]);
                            say(data.Task_ID ? 'Zadatak ažuriran' : 'Zadatak kreiran');
                            return true;
                        }}
                        onDelete={(id) => { setTasks(prev => prev.filter(t => t.Task_ID !== id)); say('Zadatak obrisan'); }}
                        onStatus={(id, s) => setTasks(prev => prev.map(t => (t.Task_ID === id ? { ...t, Status: s } : t)))}
                        onToggleChecklist={(id, itemId) => setTasks(prev => prev.map(t => (t.Task_ID === id
                            ? { ...t, Checklist: (t.Checklist || []).map(c => (c.id === itemId ? { ...c, completed: !c.completed } : c)) }
                            : t)))}
                    />
                )}
                {tab === 'account' && <div className="mui"><MLarge title="Ja" /><MEmpty title="Maketa" sub="Nalog i odjava." /></div>}
            </main>

            <MobileTabBar activeTab={tab} onTabChange={setTab} />

            {toast && (
                <div style={{
                    position: 'fixed', bottom: 96, left: '50%', transform: 'translateX(-50%)', zIndex: 5000,
                    background: '#1d1d1f', color: '#fff', padding: '9px 16px', borderRadius: 10, fontSize: 13, maxWidth: '90vw',
                }}>{toast}</div>
            )}
        </div>
    );
}

function localDay(offset: number): string {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
