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
import FieldTabBar, { type FieldTabId } from '../FieldTabBar';
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

    return (
        <>
            <div className="fld-body">
                {tab === 'home' && (
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
                )}

                {tab === 'orders' && (
                    <WorkerOrdersScreen
                        orders={orders}
                        loading={loading}
                        error={error}
                        reload={reload}
                        productById={productById}
                        previewUid={previewUid}
                        showToast={showToast}
                    />
                )}

                {tab === 'notes' && (
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
                )}

                {tab === 'calendar' && <WorkerCalendarScreen previewUid={previewUid} />}

                {tab === 'me' && <WorkerMe data={data} previewUid={previewUid} readOnly={data.preview} />}
            </div>

            <FieldTabBar role={data.user.role} activeTab={tab} onTabChange={setTab} />

            {toast && <div className={`fwk-toast ${toast.type}`}>{toast.message}</div>}
        </>
    );
}
