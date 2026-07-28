'use client';

// ════════════════════════════════════════════════════════════════════
// POGONSKI EKRAN — korijen
//
// Sve pod `/pogon` prolazi ovuda. Tri stvari koje drži na okupu:
//   1. gejt „mora postaviti lozinku" — ide PRIJE svega ostalog,
//   2. izbor početne po ulozi (radnik / kontrolor),
//   3. donja tab-traka; osim početne, tabovi su za sada prazna stanja.
//
// Podaci dolaze isključivo iz /api/field/home (projekcija bez novca).
// ════════════════════════════════════════════════════════════════════

import { useState } from 'react';
import { LogOut, RefreshCw } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useFieldHome } from '@/lib/field/useFieldHome';
import { MEmpty, MList, MItem, MCell, MText, MValue, MButton } from '@/components/tabs/mobile/MobileUI';
import FieldTabBar, { type FieldTabId } from './FieldTabBar';
import SetPasswordScreen from './SetPasswordScreen';
import WorkerHome from './WorkerHome';
import ControllerApp from './ControllerApp';
import '@/components/tabs/mobile/MobileUI.css';
import './Field.css';

interface Props {
    /** uid korisnika kojeg vlasnik gleda kroz „Pogledaj kao". */
    previewUid?: string | null;
}

export default function FieldShell({ previewUid = null }: Props) {
    const { user, signOut, refreshUser } = useAuth();
    const { data, loading, error, reload } = useFieldHome(previewUid);
    const [tab, setTab] = useState<FieldTabId>('home');
    const [passwordDone, setPasswordDone] = useState(false);

    // Gejt lozinke se NE primjenjuje u pregledu — vlasnik gleda tuđi ekran,
    // ne mijenja tuđu lozinku.
    const mustChangePassword =
        !previewUid && !passwordDone && (data?.user.mustChangePassword ?? user?.Must_Change_Password === true);

    if (mustChangePassword) {
        return (
            <SetPasswordScreen
                onDone={async () => {
                    setPasswordDone(true);
                    await refreshUser();
                    reload();
                }}
            />
        );
    }

    if (loading) {
        return (
            <div className="mui fld fld-solo">
                <div className="fld-center"><div className="loading-spinner" /><p>Učitavanje…</p></div>
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className="mui fld fld-solo">
                <div className="fld-body">
                    <MEmpty title="Podaci nisu učitani" sub={error || 'Pokušajte ponovo.'}>
                        <div style={{ width: '100%', paddingTop: 14 }}>
                            <MButton variant="filled" onClick={reload}><RefreshCw size={18} /> Pokušaj ponovo</MButton>
                        </div>
                    </MEmpty>
                </div>
            </div>
        );
    }

    const role = data.user.role;

    // Kontrolor ima vlastitu aplikaciju s četiri taba — šihtarica, nalozi,
    // narudžbe, projekti. Radnik ostaje na jednostavnijem ekranu ispod.
    if (role === 'controller') {
        return (
            <div className={`mui fld${data.preview ? ' fld-preview' : ''}`}>
                {data.preview && (
                    <div className="fld-preview-bar">
                        Pregled: <b>{data.user.name}</b> ({data.user.roleLabel}) — samo za čitanje
                    </div>
                )}
                <ControllerApp data={data} readOnly={data.preview} />
            </div>
        );
    }

    return (
        <div className={`mui fld${data.preview ? ' fld-preview' : ''}`}>
            {data.preview && (
                <div className="fld-preview-bar">
                    Pregled: <b>{data.user.name}</b> ({data.user.roleLabel}) — samo za čitanje
                </div>
            )}

            <div className="fld-body">
                {tab === 'home' && <WorkerHome data={data} />}

                {/* Radnikovi ostali tabovi dolaze u sljedećoj fazi — do tada su
                    iskrena prazna stanja, ne poluradne liste. */}
                {tab === 'work' && (
                    <MEmpty
                        title="Moj posao"
                        sub="Puna lista s detaljima naloga dolazi u sljedećoj fazi. Ono što vam treba danas je na početnoj."
                    />
                )}
                {tab === 'tasks' && (
                    <MEmpty title="Zadaci" sub="Označavanje zadataka dolazi u sljedećoj fazi." />
                )}

                {tab === 'me' && (
                    <>
                        <div className="mui-large"><h1>Ja</h1><p>{data.organization.name}</p></div>
                        <MList>
                            <MItem><MCell><MText title="Ime" /><MValue num={false}>{data.user.name}</MValue></MCell></MItem>
                            <MItem><MCell><MText title="Uloga" /><MValue num={false}>{data.user.roleLabel}</MValue></MCell></MItem>
                            {data.user.workerName && (
                                <MItem><MCell><MText title="Radnik" /><MValue num={false}>{data.user.workerName}</MValue></MCell></MItem>
                            )}
                        </MList>
                        {!data.preview && (
                            <div className="fld-submit">
                                <MButton variant="danger" onClick={() => signOut()}><LogOut size={18} /> Odjavi se</MButton>
                            </div>
                        )}
                    </>
                )}
            </div>

            <FieldTabBar role={role} activeTab={tab} onTabChange={setTab} />
        </div>
    );
}
