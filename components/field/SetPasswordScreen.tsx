'use client';

// ════════════════════════════════════════════════════════════════════
// PRVA PRIJAVA — POSTAVI VLASTITU LOZINKU
//
// Poslodavac zada početnu lozinku i preda je radniku. Dok je radnik ne
// zamijeni, poslodavac se može prijaviti kao on — pa nijedan zapis nije
// pouzdano njegov. Ovaj ekran zatvara taj prozor i ne može se preskočiti.
//
// Promjenu radi KLIJENT (`updatePassword`), namjerno: Firebase tu traži
// svježu prijavu. Ako je sesija stara, tražimo trenutnu lozinku i
// reautentikujemo se — što je ispravno, jer bi inače ukradena sesija mogla
// preuzeti nalog bez poznavanja stare lozinke.
// ════════════════════════════════════════════════════════════════════

import { useState } from 'react';
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth';
import { KeyRound } from 'lucide-react';
import { auth } from '@/lib/firebase';
import { apiPost } from '@/lib/apiClient';
import { checkPassword } from '@/lib/team/plan';
import { MLarge, MList, MButton } from '@/components/tabs/mobile/MobileUI';

export default function SetPasswordScreen({ onDone }: { onDone: () => void }) {
    const [current, setCurrent] = useState('');
    const [needsCurrent, setNeedsCurrent] = useState(false);
    const [pw1, setPw1] = useState('');
    const [pw2, setPw2] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function submit(e?: React.FormEvent) {
        e?.preventDefault();
        if (busy) return;
        setError(null);

        const check = checkPassword(pw1);
        if (!check.ok) return setError(check.reason!);
        if (pw1 !== pw2) return setError('Lozinke se ne poklapaju.');

        const user = auth?.currentUser;
        if (!user?.email) return setError('Sesija je istekla. Prijavite se ponovo.');

        setBusy(true);
        try {
            if (needsCurrent) {
                await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, current));
            }
            await updatePassword(user, pw1);
            await apiPost('/api/auth/password-changed');
            onDone();
        } catch (err: any) {
            if (err?.code === 'auth/requires-recent-login' && !needsCurrent) {
                setNeedsCurrent(true);
                setError('Radi sigurnosti unesite lozinku koju vam je dao poslodavac.');
            } else if (err?.code === 'auth/wrong-password' || err?.code === 'auth/invalid-credential') {
                setError('Trenutna lozinka nije tačna.');
            } else if (err?.code === 'auth/weak-password') {
                setError('Lozinka je preslaba.');
            } else {
                setError('Promjena lozinke nije uspjela. Pokušajte ponovo.');
            }
            setBusy(false);
        }
    }

    return (
        <div className="mui fld fld-solo">
            <div className="fld-body">
                <div className="fld-keyicon"><KeyRound size={26} /></div>

                <MLarge title="Postavite svoju lozinku">
                    Ovo je vaša prva prijava. Lozinku koju znate i vi i poslodavac
                    treba zamijeniti vlastitom.
                </MLarge>

                <form onSubmit={submit}>
                    <MList>
                        {needsCurrent && (
                            <div className="mui-field">
                                <label htmlFor="fp-cur">Trenutna lozinka</label>
                                <input
                                    id="fp-cur" type="password" value={current} autoComplete="current-password"
                                    onChange={e => setCurrent(e.target.value)}
                                />
                            </div>
                        )}
                        <div className="mui-field">
                            <label htmlFor="fp-1">Nova lozinka</label>
                            <input
                                id="fp-1" type="password" value={pw1} autoComplete="new-password" autoFocus={!needsCurrent}
                                onChange={e => setPw1(e.target.value)}
                            />
                        </div>
                        <div className="mui-field">
                            <label htmlFor="fp-2">Ponovi lozinku</label>
                            <input
                                id="fp-2" type="password" value={pw2} autoComplete="new-password"
                                onChange={e => setPw2(e.target.value)}
                            />
                        </div>
                    </MList>

                    <p className="fld-hint">Najmanje 8 znakova, bar jedno slovo i jedna cifra.</p>

                    {error && <div className="fld-error">{error}</div>}

                    {/* MButton je namjerno type="button" (vidi MobileUI) — zato ide
                        preko onClick; `onSubmit` na formi pokriva tipku Enter. */}
                    <div className="fld-submit">
                        <MButton variant="filled" disabled={busy} onClick={() => submit()}>
                            {busy ? 'Snimam…' : 'Sačuvaj i nastavi'}
                        </MButton>
                    </div>
                </form>
            </div>
        </div>
    );
}
