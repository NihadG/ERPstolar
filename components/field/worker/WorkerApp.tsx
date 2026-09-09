'use client';

// ════════════════════════════════════════════════════════════════════
// RADNIK — aplikacija
//
// Pet tabova koji pokrivaju radnikov dan: Danas (početna), Nalozi, Projekti,
// Kalendar, Ja. Nalozi i Projekti dijele JEDAN dohvat (useWorkerWork) — radnik
// ne plaća dvije mreže, a poniranje projekat → proizvod → materijali ne ide na
// mrežu uopšte. Identitet i odjava žive u tabu „Ja", pa ne troše zaseban element.
// ════════════════════════════════════════════════════════════════════

import { useCallback, useMemo, useState } from 'react';
import type { FieldHomePayload } from '@/lib/field/fieldHome';
import type { FieldProductDetail } from '@/lib/field/fieldProjects';
import { useWorkerNotes, useWorkerWork } from '@/lib/field/useFieldWorker';
import FieldTabBar, { tabsForRole, type FieldTabId } from '../FieldTabBar';
import FieldPager from '../FieldPager';
import WorkerHome from '../WorkerHome';
import WorkerOrdersScreen from './WorkerOrdersScreen';
import WorkerNotesScreen from './WorkerNotesScreen';
import WorkerCalendarScreen from './WorkerCalendarScreen';
import WorkerMe from './WorkerMe';
import './Worker.css';

export type ShowToast = (message: string, type?: 'success' | 'error' | 'info') => void;

interface Props {
    data: FieldHomePayload;
    previewUid?: string | null;
}

export default function WorkerApp({ data, previewUid }: Props) {
    const [tab, setTab] = useState<FieldTabId>('home');
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
    const { orders, projects, loading, error, reload } = useWorkerWork(previewUid);
    // Napomene se dohvaćaju JEDNOM ovdje — dijele ih tab Napomene i tab Danas,
    // pa optimistična izmjena na jednom mjestu odmah važi na oba.
    const notesState = useWorkerNotes(previewUid);

    const showToast = useCallback<ShowToast>((message, type = 'info') => {
        setToast({ message, type });
        window.setTimeout(() => setToast(null), 3200);
    }, []);

    // Proizvod po ID-u — da detalj naloga otvori materijale bez novog dohvata.
    const productById = useMemo(() => {
        const m = new Map<string, FieldProductDetail>();
        for (const proj of projects) for (const p of proj.products) m.set(p.productId, p);
        return m;
    }, [projects]);

    // Nalozi/proizvodi „u toku" (aktivna, nepauzirana stavka) — za isticanje
    // napomena i sortiranje. Ista definicija na Danas i u tabu Napomene.
    const { activeOrderIds, activeProductIds } = useMemo(() => {
        const orderIds = new Set<string>();
        const productIds = new Set<string>();
        for (const a of data.assignments) {
            if (a.status === 'U toku' && !a.isPaused) {
                orderIds.add(a.orderId);
                if (a.productId) productIds.add(a.productId);
            }
        }
        return { activeOrderIds: orderIds, activeProductIds: productIds };
    }, [data.assignments]);

    // Tabovi u trakoj poredak → indeks, da prelistavanje i tab-traka gledaju
    // istu listu. Pager drži tabove živim (keep-alive), pa se skrol i otvoreni
    // detalj čuvaju kad se korisnik vrati na tab.
    const tabs = useMemo(() => tabsForRole('worker'), []);
    const activeIndex = Math.max(0, tabs.findIndex(t => t.id === tab));

    const renderPane = useCallback((i: number) => {
        switch (tabs[i]?.id) {
            case 'home':
                return (
                    <WorkerHome
                        data={data}
                        productById={productById}
                        notes={notesState.notes}
                        setNotes={notesState.setNotes}
                        reloadNotes={notesState.reload}
                        activeOrderIds={activeOrderIds}
                        previewUid={previewUid}
                        showToast={showToast}
                    />
                );
            case 'orders':
                return (
                    <WorkerOrdersScreen
                        orders={orders}
                        loading={loading}
                        error={error}
                        reload={reload}
                        productById={productById}
                        previewUid={previewUid}
                        showToast={showToast}
                    />
                );
            case 'notes':
                return (
                    <WorkerNotesScreen
                        orders={orders}
                        notes={notesState.notes}
                        setNotes={notesState.setNotes}
                        loading={notesState.loading}
                        error={notesState.error}
                        reload={notesState.reload}
                        activeProductIds={activeProductIds}
                        previewUid={previewUid}
                        showToast={showToast}
                    />
                );
            case 'calendar':
                return <WorkerCalendarScreen previewUid={previewUid} />;
            case 'me':
                return <WorkerMe data={data} previewUid={previewUid} readOnly={data.preview} />;
            default:
                return null;
        }
    }, [tabs, data, productById, notesState, activeOrderIds, orders, loading, error, reload, activeProductIds, previewUid, showToast]);

    return (
        <>
            <FieldPager
                index={activeIndex}
                count={tabs.length}
                onIndexChange={(i) => setTab(tabs[i].id)}
                renderPane={renderPane}
            />

            <FieldTabBar role={data.user.role} activeTab={tab} onTabChange={setTab} />

            {toast && <div className={`fwk-toast ${toast.type}`}>{toast.message}</div>}
        </>
    );
}
