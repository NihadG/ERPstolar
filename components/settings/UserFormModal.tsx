'use client';

// ════════════════════════════════════════════════════════════════════
// DODAVANJE / UREĐIVANJE KORISNIKA
//
// Email i lozinka se zadaju SAMO pri kreiranju: email je identitet naloga u
// Firebase Authu, a lozinka se poslije mijenja isključivo kroz „Nova lozinka"
// (server ruta) ili je radnik mijenja sam. Ovdje se ne prikazuje nikad.
// ════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import { ASSIGNABLE_ROLES, checkPassword, generatePassword, isValidEmail, requiresWorkerLink } from '@/lib/team/plan';
import { ROLE_LABELS, type UserRole } from '@/lib/types';
import type { AvailableWorker, TeamMember } from './TeamSection';

export interface UserFormResult {
    name: string;
    email: string;
    password: string;
    role: UserRole;
    phone: string;
    workerId: string | null;
}

const ROLE_HINT: Record<UserRole, string> = {
    owner: '',
    admin: 'Puna aplikacija, uključujući upravljanje korisnicima.',
    manager: 'Puna aplikacija, bez upravljanja korisnicima.',
    controller: 'Samo pogonski ekran na telefonu. Bez cijena, ponuda i narudžbi.',
    worker: 'Samo svoj posao na telefonu. Bez cijena, ponuda i narudžbi.',
};

interface Props {
    member: TeamMember | null;
    availableWorkers: AvailableWorker[];
    currentUserUid: string;
    onClose: () => void;
    onSubmit: (form: UserFormResult) => Promise<void>;
}

export default function UserFormModal({ member, availableWorkers, onClose, onSubmit }: Props) {
    const isEdit = !!member;

    const [name, setName] = useState(member?.name || '');
    const [email, setEmail] = useState(member?.email || '');
    const [password, setPassword] = useState(() => (member ? '' : generatePassword()));
    const [showPassword, setShowPassword] = useState(true);
    const [role, setRole] = useState<UserRole>(member?.role || 'worker');
    const [phone, setPhone] = useState(member?.phone || '');
    const [workerId, setWorkerId] = useState<string>(member?.workerId || '');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose, saving]);

    // Pri uređivanju radnik ostaje u ponudi iako više nije "slobodan" —
    // inače bi se njegova vlastita veza izgubila iz padajućeg izbornika.
    const workerOptions = [...availableWorkers];
    if (member?.workerId && member.workerName && !workerOptions.some(w => w.workerId === member.workerId)) {
        workerOptions.unshift({ workerId: member.workerId, name: member.workerName, role: '' });
    }

    const needsWorker = requiresWorkerLink(role);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError(null);

        if (!name.trim()) return setError('Unesite ime i prezime.');
        if (!isEdit && !isValidEmail(email)) return setError('Unesite ispravnu email adresu.');
        if (!isEdit) {
            const pw = checkPassword(password);
            if (!pw.ok) return setError(pw.reason!);
        }
        if (needsWorker && !workerId) {
            return setError('Odaberite radnika iz evidencije. Bez te veze prijavljeni korisnik ne vidi svoj posao.');
        }

        setSaving(true);
        try {
            await onSubmit({
                name: name.trim(),
                email: email.trim().toLowerCase(),
                password,
                role,
                phone: phone.trim(),
                workerId: workerId || null,
            });
        } catch (err: any) {
            setError(err?.message || 'Snimanje nije uspjelo.');
            setSaving(false);
        }
    }

    return (
        <div className="team-modal-scrim" onClick={() => !saving && onClose()}>
            <div className="team-modal" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
                <header className="team-modal-head">
                    <h3>{isEdit ? 'Uredi korisnika' : 'Novi korisnik'}</h3>
                    <button type="button" onClick={onClose} disabled={saving} aria-label="Zatvori">
                        <span className="material-icons-round">close</span>
                    </button>
                </header>

                <form className="team-modal-body" onSubmit={handleSubmit}>
                    <div className="settings-form-group full-width">
                        <label htmlFor="tm-name">Ime i prezime</label>
                        <input id="tm-name" value={name} onChange={e => setName(e.target.value)} autoFocus placeholder="Mujo Mujić" />
                    </div>

                    <div className="settings-form-group full-width">
                        <label htmlFor="tm-email">Email</label>
                        <input
                            id="tm-email" type="email" value={email} disabled={isEdit}
                            onChange={e => setEmail(e.target.value)} placeholder="mujo@firma.ba"
                        />
                        {isEdit
                            ? <small>Email je identitet naloga i ne mijenja se.</small>
                            : <small>Ovim se radnik prijavljuje. Ne mora biti stvaran inbox, ali mora biti jedinstven.</small>}
                    </div>

                    {!isEdit && (
                        <div className="settings-form-group full-width">
                            <label htmlFor="tm-pass">Početna lozinka</label>
                            <div className="team-pass-row">
                                <input
                                    id="tm-pass" type={showPassword ? 'text' : 'password'} value={password}
                                    onChange={e => setPassword(e.target.value)} autoComplete="new-password"
                                />
                                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowPassword(s => !s)}>
                                    <span className="material-icons-round">{showPassword ? 'visibility_off' : 'visibility'}</span>
                                </button>
                                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPassword(generatePassword())}>
                                    <span className="material-icons-round">autorenew</span> Nova
                                </button>
                            </div>
                            <small>Predajete je radniku. Pri prvoj prijavi mora postaviti vlastitu — od tada je ni vi ne znate.</small>
                        </div>
                    )}

                    <div className="settings-form-group full-width">
                        <label htmlFor="tm-role">Uloga</label>
                        <select id="tm-role" value={role} onChange={e => setRole(e.target.value as UserRole)}>
                            {ASSIGNABLE_ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                        </select>
                        <small>{ROLE_HINT[role]}</small>
                    </div>

                    <div className="settings-form-group full-width">
                        <label htmlFor="tm-worker">
                            Poveži s radnikom {needsWorker ? <b>(obavezno)</b> : '(opcionalno)'}
                        </label>
                        <select id="tm-worker" value={workerId} onChange={e => setWorkerId(e.target.value)}>
                            <option value="">— bez veze —</option>
                            {workerOptions.map(w => (
                                <option key={w.workerId} value={w.workerId}>{w.name}{w.role ? ` · ${w.role}` : ''}</option>
                            ))}
                        </select>
                        <small>
                            {workerOptions.length === 0
                                ? 'Nema slobodnih radnika. Dodajte radnika u tabu Radnici, pa se vratite ovdje.'
                                : 'Veže nalog s evidencijom rada — odatle dolaze njegove stavke, dnevnice i zadaci.'}
                        </small>
                    </div>

                    <div className="settings-form-group full-width">
                        <label htmlFor="tm-phone">Telefon (opcionalno)</label>
                        <input id="tm-phone" type="tel" value={phone} onChange={e => setPhone(e.target.value)} />
                    </div>

                    {error && <div className="team-modal-error">{error}</div>}

                    <div className="team-modal-actions">
                        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>Odustani</button>
                        <button type="submit" className="btn btn-primary" disabled={saving}>
                            {saving ? 'Snimam…' : isEdit ? 'Sačuvaj' : 'Kreiraj nalog'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
