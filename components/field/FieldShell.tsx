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
import { RefreshCw } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useFieldHome } from '@/lib/field/useFieldHome';
import { MEmpty, MButton } from '@/components/tabs/mobile/MobileUI';
import SetPasswordScreen from './SetPasswordScreen';
import WorkerApp from './worker/WorkerApp';
import ControllerApp from './ControllerApp';
import '@/components/tabs/mobile/MobileUI.css';
import './Field.css';

interface Props {
    /** uid korisnika kojeg vlasnik gleda kroz „Pogledaj kao". */
    previewUid?: string | null;
}

export default function FieldShell({ previewUid = null }: Props) {
    const { user, refreshUser } = useAuth();
    const { data, loading, error, reload } = useFieldHome(previewUid);
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

    // Kontrolor i radnik imaju vlastite aplikacije. Obje se crtaju u istom
    // okviru (`.fld`), s trakom pregleda kad vlasnik gleda kroz „Pogledaj kao".
    return (
        <div className={`mui fld${data.preview ? ' fld-preview' : ''}`}>
            {data.preview && (
                <div className="fld-preview-bar">
                    Pregled: <b>{data.user.name}</b> ({data.user.roleLabel}) — samo za čitanje
                </div>
            )}
            {role === 'controller'
                ? <ControllerApp data={data} readOnly={data.preview} />
                : <WorkerApp data={data} previewUid={previewUid} />}
        </div>
    );
}
