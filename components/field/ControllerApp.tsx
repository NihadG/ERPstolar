'use client';

// ════════════════════════════════════════════════════════════════════
// KONTROLOR — aplikacija
//
// Četiri taba koja pokrivaju njegov dan. Faza 1 donosi ŠIHTARICU u punom
// obliku; ostala tri su iskrena prazna stanja dok se ne izgrade — bolje nego
// poluradne liste koje glume funkciju.
//
// Profil sjedi u dugmetu s inicijalima gore desno, da ne troši tab.
// ════════════════════════════════════════════════════════════════════

import { useState } from 'react';
import { LogOut, Inbox, Check, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import type { FieldHomePayload } from '@/lib/field/fieldHome';
import { useApproverRequests } from '@/lib/useApproverRequests';
import { requestKindLabel } from '@/lib/changeRequests';
import { MEmpty, MList, MItem, MCell, MText, MValue, MButton, MSheet, MPill, MActions, MAction } from '@/components/tabs/mobile/MobileUI';
import FieldTabBar, { type FieldTabId } from './FieldTabBar';
import AttendanceScreen from './attendance/AttendanceScreen';
import OrdersScreen from './orders/OrdersScreen';
import PurchasesScreen from './purchases/PurchasesScreen';
import ProjectsScreen from './projects/ProjectsScreen';
import './Controller.css';

const initials = (name: string) =>
    name.split(' ').filter(Boolean).map(p => p[0]).join('').toUpperCase().slice(0, 2) || '?';

interface Props {
    data: FieldHomePayload;
    /** Vlasnik gleda kroz „Pogledaj kao" — sve akcije su ugašene. */
    readOnly?: boolean;
}

export default function ControllerApp({ data, readOnly }: Props) {
    const { signOut } = useAuth();
    // Nalozi su prvo što kontrolor treba kad uzme telefon — šta se danas radi.
    const [tab, setTab] = useState<FieldTabId>('orders');
    const [profileOpen, setProfileOpen] = useState(false);
    const [approvalsOpen, setApprovalsOpen] = useState(false);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

    const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
        setToast({ message, type });
        window.setTimeout(() => setToast(null), 3200);
    };

    // Kontrolor odobrava samo nenovčane prijedloge (server filtrira po ulozi).
    const { requests: proposals, approve, reject } = useApproverRequests(!readOnly);

    const decide = async (id: string, fn: () => Promise<void>, okMsg: string) => {
        setBusyId(id);
        try { await fn(); showToast(okMsg, 'success'); }
        catch (e: any) { showToast(e?.message || 'Radnja nije uspjela.', 'error'); }
        finally { setBusyId(null); }
    };

    return (
        <>
            <div className="fld-body">
                <button
                    type="button"
                    className="fctl-profile"
                    onClick={() => setProfileOpen(true)}
                    aria-label="Profil"
                >
                    {initials(data.user.name)}
                </button>

                {!readOnly && proposals.length > 0 && (
                    <button type="button" className="fld-notice fld-notice--info" style={{ width: '100%', cursor: 'pointer' }}
                        onClick={() => setApprovalsOpen(true)}>
                        <Inbox size={17} />
                        <span><b>{proposals.length}</b> {proposals.length === 1 ? 'prijedlog radnika čeka' : 'prijedloga radnika čeka'} odobrenje — otvori</span>
                    </button>
                )}

                {tab === 'attendance' && (
                    <AttendanceScreen showToast={showToast} readOnly={readOnly} />
                )}

                {tab === 'orders' && (
                    <OrdersScreen showToast={showToast} readOnly={readOnly} />
                )}

                {tab === 'purchases' && (
                    <PurchasesScreen showToast={showToast} readOnly={readOnly} />
                )}

                {tab === 'projects' && <ProjectsScreen />}
            </div>

            <FieldTabBar role="controller" activeTab={tab} onTabChange={setTab} />

            <MSheet open={profileOpen} title={data.user.name} onClose={() => setProfileOpen(false)}>
                <MList>
                    <MItem><MCell><MText title="Uloga" /><MValue num={false}>{data.user.roleLabel}</MValue></MCell></MItem>
                    <MItem><MCell><MText title="Firma" /><MValue num={false}>{data.organization.name}</MValue></MCell></MItem>
                    {data.user.workerName && (
                        <MItem><MCell><MText title="Radnik" /><MValue num={false}>{data.user.workerName}</MValue></MCell></MItem>
                    )}
                </MList>
                {!readOnly && (
                    <div className="fld-submit">
                        <MButton variant="danger" onClick={() => signOut()}>
                            <LogOut size={18} /> Odjavi se
                        </MButton>
                    </div>
                )}
            </MSheet>

            <MSheet open={approvalsOpen} title="Prijedlozi za odobrenje" onClose={() => setApprovalsOpen(false)}>
                {proposals.length === 0 ? (
                    <MEmpty title="Nema prijedloga" sub="Trenutno nema ničega za odobriti." />
                ) : (
                    <MList lead>
                        {proposals.map(r => (
                            <MItem key={r.Request_ID}>
                                <MCell>
                                    <MText
                                        title={r.Summary || requestKindLabel(r.Kind)}
                                        sub={<>
                                            <MPill tone="orange">{r.Created_By_Name || 'Radnik'}</MPill>
                                            {r.Work_Order_Name && <span>{r.Work_Order_Name}</span>}
                                        </>}
                                    />
                                </MCell>
                                <MActions>
                                    <MAction tone="rtint" disabled={busyId === r.Request_ID}
                                        onClick={() => decide(r.Request_ID, () => reject(r.Request_ID), 'Prijedlog odbijen')}>
                                        <X size={16} /> Odbij
                                    </MAction>
                                    <MAction tone="gtint" disabled={busyId === r.Request_ID}
                                        onClick={() => decide(r.Request_ID, () => approve(r.Request_ID), 'Prijedlog potvrđen')}>
                                        <Check size={16} /> Potvrdi
                                    </MAction>
                                </MActions>
                            </MItem>
                        ))}
                    </MList>
                )}
            </MSheet>

            {toast && <div className={`fctl-toast ${toast.type}`}>{toast.message}</div>}
        </>
    );
}
