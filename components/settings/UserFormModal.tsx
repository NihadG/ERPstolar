'use client';

// ════════════════════════════════════════════════════════════════════
// DODAVANJE / UREĐIVANJE KORISNIKA
//
// Sav raspored je u TeamSection.css, s vlastitim `team-*` klasama.
// NE koristiti `settings-form-group` i slično iz app/settings/page.tsx —
// te klase žive u `<style jsx>` bloku te stranice, a scoped stilovi se NE
// primjenjuju na djecu-komponente. Polja su zbog toga jednom već ostala
// potpuno nestilizovana (labele i inputi razbacani u red).
//
// Email i lozinka se zadaju SAMO pri kreiranju: email je identitet naloga u
// Firebase Authu, a lozinka se poslije mijenja kroz „Nova lozinka" ili je
// radnik mijenja sam.
// ════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import { ASSIGNABLE_ROLES, checkPassword, generatePassword, isValidEmail, requiresWorkerLink } from '@/lib/team/plan';
import { ROLE_LABELS, WORKER_ROLES, type UserRole } from '@/lib/types';
import type { AvailableWorker, TeamMember } from './TeamSection';

export interface UserFormResult {
    name: string;
    email: string;
    password: string;
    role: UserRole;
    phone: string;
    workerId: string | null;
    /** Popunjeno kad se radnik pravi u istom koraku. */
    newWorkerName?: string;
    newWorkerRole?: string;
}

const ROLE_HINT: Record<UserRole, string> = {
    owner: '',
    admin: 'Puna aplikacija, uključujući upravljanje korisnicima.',
    manager: 'Puna aplikacija, bez upravljanja korisnicima.',
    controller: 'Pogonski ekran: šihtarica, nalozi, narudžbe i projekti. Bez cijena.',
    worker: 'Samo svoj posao na telefonu. Bez cijena, ponuda i narudžbi.',
};

/** Posebna vrijednost u izborniku radnika — otvara polja za novog. */
const NEW_WORKER = '__new__';

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
    const [newWorkerName, setNewWorkerName] = useState('');
    const [newWorkerRole, setNewWorkerRole] = useState('Opći');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose, saving]);

    // Pri uređivanju radnik ostaje u ponudi iako više nije „slobodan" —
    // inače bi njegova vlastita veza nestala iz izbornika.
    const workerOptions = [...availableWorkers];
    if (member?.workerId && member.workerName && !workerOptions.some(w => w.workerId === member.workerId)) {
        workerOptions.unshift({ workerId: member.workerId, name: member.workerName, role: '' });
    }

    const mustLink = requiresWorkerLink(role);
    const creatingWorker = workerId === NEW_WORKER;

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError(null);

        if (!name.trim()) return setError('Unesite ime i prezime.');
        if (!isEdit && !isValidEmail(email)) return setError('Unesite ispravnu email adresu.');
        if (!isEdit) {
            const pw = checkPassword(password);
            if (!pw.ok) return setError(pw.reason!);
        }
        if (creatingWorker && !newWorkerName.trim()) {
            return setError('Unesite ime novog radnika.');
        }
        if (mustLink && !workerId) {
            return setError('Radnik mora biti povezan sa zapisom radnika — bez toga mu ekran ne zna šta je njegov posao.');
        }

        setSaving(true);
        try {
            await onSubmit({
                name: name.trim(),
                email: email.trim().toLowerCase(),
                password,
                role,
                phone: phone.trim(),
                workerId: creatingWorker ? null : (workerId || null),
                ...(creatingWorker ? { newWorkerName: newWorkerName.trim(), newWorkerRole } : {}),
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
                    {/* ── Ko je ─────────────────────────────────────── */}
                    <div className="team-field">
                        <label htmlFor="tm-name">Ime i prezime</label>
                        <input id="tm-name" value={name} onChange={e => setName(e.target.value)} autoFocus placeholder="Mujo Mujić" />
                    </div>

                    <div className="team-field">
                        <label htmlFor="tm-email">Email</label>
                        <input
                            id="tm-email" type="email" value={email} disabled={isEdit}
                            onChange={e => setEmail(e.target.value)} placeholder="mujo@firma.ba"
                        />
                        <small>
                            {isEdit
                                ? 'Email je identitet naloga i ne mijenja se.'
                                : 'Ovim se prijavljuje. Ne mora biti stvaran inbox, ali mora biti jedinstven.'}
                        </small>
                    </div>

                    {!isEdit && (
                        <div className="team-field">
                            <label htmlFor="tm-pass">Početna lozinka</label>
                            <div className="team-pass-row">
                                <input
                                    id="tm-pass" type={showPassword ? 'text' : 'password'} value={password}
                                    onChange={e => setPassword(e.target.value)} autoComplete="new-password"
                                />
                                <button type="button" className="team-icon-btn" title={showPassword ? 'Sakrij' : 'Prikaži'}
                                    onClick={() => setShowPassword(s => !s)}>
                                    <span className="material-icons-round">{showPassword ? 'visibility_off' : 'visibility'}</span>
                                </button>
                                <button type="button" className="team-icon-btn" title="Generiši novu"
                                    onClick={() => setPassword(generatePassword())}>
                                    <span className="material-icons-round">autorenew</span>
                                </button>
                            </div>
                            <small>Predajete je radniku. Pri prvoj prijavi mora postaviti vlastitu — od tada je ni vi ne znate.</small>
                        </div>
                    )}

                    <div className="team-divider" />

                    {/* ── Šta smije ─────────────────────────────────── */}
                    <div className="team-field">
                        <label htmlFor="tm-role">Uloga</label>
                        <select id="tm-role" value={role} onChange={e => setRole(e.target.value as UserRole)}>
                            {ASSIGNABLE_ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                        </select>
                        <small>{ROLE_HINT[role]}</small>
                    </div>

                    <div className="team-field">
                        <label htmlFor="tm-worker">
                            Poveži s radnikom {mustLink
                                ? <span className="team-req">obavezno</span>
                                : <span className="team-opt">opcionalno</span>}
                        </label>
                        <select id="tm-worker" value={workerId} onChange={e => setWorkerId(e.target.value)}>
                            <option value="">— bez veze —</option>
                            {workerOptions.map(w => (
                                <option key={w.workerId} value={w.workerId}>{w.name}{w.role ? ` · ${w.role}` : ''}</option>
                            ))}
                            <option value={NEW_WORKER}>+ Kreiraj novog radnika…</option>
                        </select>
                        <small>
                            {mustLink
                                ? 'Odatle dolaze njegove stavke, dnevnice i zadaci.'
                                : 'Kontroloru treba samo ako i sam radi i knjiži dnevnice.'}
                            {workerOptions.length === 0 && ' Nema slobodnih radnika — možete ga napraviti odmah ispod.'}
                        </small>
                    </div>

                    {creatingWorker && (
                        <div className="team-subform">
                            <div className="team-field">
                                <label htmlFor="tm-nw-name">Ime novog radnika</label>
                                <input
                                    id="tm-nw-name" value={newWorkerName}
                                    onChange={e => setNewWorkerName(e.target.value)}
                                    placeholder={name.trim() || 'Ime i prezime'}
                                />
                            </div>
                            <div className="team-field">
                                <label htmlFor="tm-nw-role">Zanimanje</label>
                                <select id="tm-nw-role" value={newWorkerRole} onChange={e => setNewWorkerRole(e.target.value)}>
                                    {WORKER_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                                </select>
                            </div>
                            <small>Radnik se dodaje u evidenciju i odmah povezuje s ovim nalogom. Dnevnicu mu postavite u tabu Radnici.</small>
                        </div>
                    )}

                    <div className="team-field">
                        <label htmlFor="tm-phone">Telefon <span className="team-opt">opcionalno</span></label>
                        <input id="tm-phone" type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="061 000 000" />
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
