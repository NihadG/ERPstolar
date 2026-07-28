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
import { LogOut } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import type { FieldHomePayload } from '@/lib/field/fieldHome';
import { MEmpty, MList, MItem, MCell, MText, MValue, MButton, MSheet } from '@/components/tabs/mobile/MobileUI';
import FieldTabBar, { type FieldTabId } from './FieldTabBar';
import AttendanceScreen from './attendance/AttendanceScreen';
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
    const [tab, setTab] = useState<FieldTabId>('attendance');
    const [profileOpen, setProfileOpen] = useState(false);
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

    const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
        setToast({ message, type });
        window.setTimeout(() => setToast(null), 3200);
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

                {tab === 'attendance' && (
                    <AttendanceScreen showToast={showToast} readOnly={readOnly} />
                )}

                {tab === 'orders' && (
                    <MEmpty
                        title="Nalozi"
                        sub="Pregled naloga i čekiranje procesa dolaze u sljedećoj fazi."
                    />
                )}

                {tab === 'purchases' && (
                    <MEmpty
                        title="Narudžbe"
                        sub="Pregled narudžbi i evidencija prijema materijala dolaze u sljedećoj fazi."
                    />
                )}

                {tab === 'projects' && (
                    <MEmpty
                        title="Projekti"
                        sub="Pregled projekata i proizvoda dolazi u sljedećoj fazi."
                    />
                )}
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

            {toast && <div className={`fctl-toast ${toast.type}`}>{toast.message}</div>}
        </>
    );
}
