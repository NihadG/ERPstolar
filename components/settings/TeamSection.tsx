'use client';

// ════════════════════════════════════════════════════════════════════
// POSTAVKE → KORISNICI
//
// Vlasnik ovdje pravi naloge za radnike i kontrolore. Sve ide kroz server rute
// (/api/team/*) jer kreiranje Auth korisnika i upis uloge u token traže admin
// SDK — klijent to ne može, a i ne smije: uloga upisana s klijenta bi bila
// uloga koju korisnik može sam sebi promijeniti.
//
// Lozinku vlasnik vidi TAČNO JEDNOM, pri kreiranju. Poslije je može samo
// izdati novu. Radnik je pri prvoj prijavi mora zamijeniti.
// ════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/apiClient';
import { ROLE_LABELS, type UserRole } from '@/lib/types';
import UserFormModal, { type UserFormResult } from './UserFormModal';
import './TeamSection.css';

export interface TeamMember {
    uid: string;
    name: string;
    email: string;
    role: UserRole;
    isActive: boolean;
    isOwner: boolean;
    workerId: string | null;
    workerName: string | null;
    phone: string | null;
    mustChangePassword: boolean;
    createdDate: string | null;
    lastLogin: string | null;
}

export interface AvailableWorker {
    workerId: string;
    name: string;
    role: string;
}

interface TeamResponse {
    members: TeamMember[];
    seats: { used: number; limit: number };
    availableWorkers: AvailableWorker[];
}

const ROLE_TONE: Record<UserRole, string> = {
    owner: 'purple', admin: 'blue', manager: 'blue', controller: 'orange', worker: 'green',
};

const initials = (name: string) =>
    name.split(' ').filter(Boolean).map(p => p[0]).join('').toUpperCase().slice(0, 2) || '?';

function formatDate(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('bs-BA', { day: 'numeric', month: 'short', year: 'numeric' });
}

interface Props {
    showMessage: (text: string, type: 'success' | 'error') => void;
}

export default function TeamSection({ showMessage }: Props) {
    const { hasModule, organization, isAdmin, user } = useAuth();
    const unlocked = hasModule('team');

    const [data, setData] = useState<TeamResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [modalOpen, setModalOpen] = useState(false);
    const [editing, setEditing] = useState<TeamMember | null>(null);
    const [menuFor, setMenuFor] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null);

    // Prikazuje se tek nakon kreiranja/reseta i nestaje kad vlasnik potvrdi
    // da je zapisao lozinku — nigdje se ne perzistira.
    const [credentials, setCredentials] = useState<{ name: string; email: string; password: string } | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            setData(await apiGet<TeamResponse>('/api/team/users'));
        } catch (e: any) {
            setError(e?.message || 'Učitavanje korisnika nije uspjelo.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (unlocked && isAdmin) load();
        else setLoading(false);
    }, [unlocked, isAdmin, load]);

    const seats = data?.seats;
    const seatsFull = !!seats && seats.used >= seats.limit;

    const members = useMemo(() => data?.members || [], [data]);

    async function handleSubmit(form: UserFormResult) {
        if (editing) {
            const { member } = await apiPatch<{ member: TeamMember }>(`/api/team/users/${editing.uid}`, {
                name: form.name, phone: form.phone, role: form.role, workerId: form.workerId,
            });
            setData(d => d ? { ...d, members: d.members.map(m => m.uid === member.uid ? member : m) } : d);
            showMessage(`${member.name} — izmjene sačuvane.`, 'success');
            await load();   // veza s radnikom mijenja i listu slobodnih radnika
        } else {
            const { member } = await apiPost<{ member: TeamMember }>('/api/team/users', {
                name: form.name, email: form.email, password: form.password,
                role: form.role, phone: form.phone, workerId: form.workerId,
                // Popunjeno samo kad se radnik pravi u istom koraku.
                newWorkerName: form.newWorkerName, newWorkerRole: form.newWorkerRole,
            });
            setCredentials({ name: member.name, email: member.email, password: form.password });
            showMessage(`Nalog za ${member.name} je kreiran.`, 'success');
            await load();
        }
        setModalOpen(false);
        setEditing(null);
    }

    async function handleResetPassword(member: TeamMember) {
        const { generatePassword } = await import('@/lib/team/plan');
        const password = generatePassword();
        setBusy(member.uid);
        try {
            await apiPost(`/api/team/users/${member.uid}/password`, { password });
            setCredentials({ name: member.name, email: member.email, password });
            showMessage(`Nova lozinka je izdata za ${member.name}.`, 'success');
            await load();
        } catch (e: any) {
            showMessage(e?.message || 'Izdavanje lozinke nije uspjelo.', 'error');
        } finally {
            setBusy(null);
            setMenuFor(null);
        }
    }

    async function handleToggleActive(member: TeamMember) {
        const deactivating = member.isActive;
        if (deactivating && !window.confirm(
            `Deaktivirati nalog za ${member.name}?\n\nNe može se više prijaviti. Njegove dnevnice, zadaci i istorija rada ostaju netaknuti.`
        )) return;

        setBusy(member.uid);
        try {
            if (deactivating) await apiDelete(`/api/team/users/${member.uid}`);
            else await apiPatch(`/api/team/users/${member.uid}`, { isActive: true });
            showMessage(deactivating ? `${member.name} je deaktiviran.` : `${member.name} je ponovo aktivan.`, 'success');
            await load();
        } catch (e: any) {
            showMessage(e?.message || 'Radnja nije uspjela.', 'error');
        } finally {
            setBusy(null);
            setMenuFor(null);
        }
    }

    // ── Gejtovi ──────────────────────────────────────────────────────

    if (!isAdmin) {
        return (
            <section className="team-section">
                <div className="team-section-head">
                    <h2>Korisnici</h2>
                    <p>Nalozi za radnike i kontrolore.</p>
                </div>
                <div className="team-banner warn">
                    <span className="material-icons-round">lock</span>
                    <div>
                        <strong>Nemate dozvolu</strong>
                        <p>Korisnicima upravljaju vlasnik i administrator.</p>
                    </div>
                </div>
            </section>
        );
    }

    if (!unlocked) {
        return (
            <section className="team-section">
                <div className="team-section-head">
                    <h2>Korisnici</h2>
                    <p>Dajte radnicima i kontrolorima vlastitu prijavu na telefonu.</p>
                </div>
                <div className="team-banner locked">
                    <span className="material-icons-round">workspace_premium</span>
                    <div>
                        <strong>Radnici i kontrolori su dio Enterprise paketa</strong>
                        <p>
                            Svaki radnik dobija vlastiti nalog i vidi samo svoj posao — bez cijena,
                            ponuda i narudžbi. Trenutni plan: {organization?.Subscription_Plan || 'Free'}.
                        </p>
                    </div>
                    <Link href="/pricing" className="btn btn-primary btn-sm">Nadogradi paket</Link>
                </div>
            </section>
        );
    }

    // ── Sadržaj ──────────────────────────────────────────────────────

    return (
        <section className="team-section">
            <div className="team-section-head">
                <h2>Korisnici</h2>
                <p>Nalozi za prijavu. Radnik i kontrolor vide samo svoj posao — nikad cijene, ponude ni narudžbe.</p>
            </div>

            {credentials && (
                <div className="team-creds">
                    <div className="team-creds-head">
                        <span className="material-icons-round">vpn_key</span>
                        <div>
                            <strong>Podaci za prijavu — {credentials.name}</strong>
                            <p>Zapišite ih i predajte radniku. <b>Lozinka se više neće moći vidjeti</b>, samo izdati nova.</p>
                        </div>
                    </div>
                    <div className="team-creds-grid">
                        <div><span>Email</span><code>{credentials.email}</code></div>
                        <div><span>Lozinka</span><code>{credentials.password}</code></div>
                    </div>
                    <div className="team-creds-actions">
                        <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => {
                                navigator.clipboard?.writeText(`Email: ${credentials.email}\nLozinka: ${credentials.password}`);
                                showMessage('Kopirano.', 'success');
                            }}
                        >
                            <span className="material-icons-round">content_copy</span> Kopiraj
                        </button>
                        <button type="button" className="btn btn-primary btn-sm" onClick={() => setCredentials(null)}>
                            Zapisao sam
                        </button>
                    </div>
                    <p className="team-creds-note">
                        Radnik će pri prvoj prijavi morati postaviti vlastitu lozinku — od tada ni vi je ne znate.
                    </p>
                </div>
            )}

            <div className="team-card">
                <div className="team-toolbar">
                    <div className="team-seats">
                        <strong>{seats ? `${seats.used} / ${seats.limit}` : '—'}</strong>
                        <span>iskorištenih mjesta</span>
                    </div>
                    <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={seatsFull || loading}
                        title={seatsFull ? 'Sva mjesta u paketu su iskorištena' : undefined}
                        onClick={() => { setEditing(null); setModalOpen(true); }}
                    >
                        <span className="material-icons-round">person_add</span> Dodaj korisnika
                    </button>
                </div>

                {loading && <div className="team-empty">Učitavanje…</div>}
                {error && !loading && <div className="team-empty team-empty--error">{error}</div>}

                {!loading && !error && members.map(m => (
                    <div key={m.uid} className={`team-row${m.isActive ? '' : ' is-inactive'}`}>
                        <span className={`team-avatar ${ROLE_TONE[m.role]}`}>{initials(m.name)}</span>

                        <div className="team-row-main">
                            <div className="team-row-title">
                                <strong>{m.name}</strong>
                                <span className={`team-pill ${ROLE_TONE[m.role]}`}>{ROLE_LABELS[m.role]}</span>
                                {!m.isActive && <span className="team-pill gray">Neaktivan</span>}
                                {m.mustChangePassword && m.isActive && (
                                    <span className="team-pill gray" title="Nije još postavio vlastitu lozinku">Čeka prvu prijavu</span>
                                )}
                            </div>
                            <span className="team-row-sub">
                                {m.email}
                                {m.workerName && <> · radnik: {m.workerName}</>}
                                {m.lastLogin ? <> · zadnja prijava {formatDate(m.lastLogin)}</> : <> · nije se prijavljivao</>}
                            </span>
                        </div>

                        {m.isOwner ? (
                            <span className="team-row-note">vaš nalog</span>
                        ) : (
                            <div className="team-menu-wrap">
                                <button
                                    type="button"
                                    className="team-menu-btn"
                                    disabled={busy === m.uid}
                                    aria-label={`Akcije za ${m.name}`}
                                    onClick={() => setMenuFor(menuFor === m.uid ? null : m.uid)}
                                >
                                    <span className="material-icons-round">more_horiz</span>
                                </button>
                                {menuFor === m.uid && (
                                    <>
                                        <div className="team-menu-scrim" onClick={() => setMenuFor(null)} />
                                        <div className="team-menu">
                                            <button type="button" onClick={() => { setEditing(m); setModalOpen(true); setMenuFor(null); }}>
                                                <span className="material-icons-round">edit</span> Uredi
                                            </button>
                                            <button type="button" onClick={() => handleResetPassword(m)}>
                                                <span className="material-icons-round">vpn_key</span> Nova lozinka
                                            </button>
                                            <a href={`/pogon?preview=${m.uid}`} target="_blank" rel="noreferrer" onClick={() => setMenuFor(null)}>
                                                <span className="material-icons-round">visibility</span> Pogledaj kao
                                            </a>
                                            <button type="button" className="danger" onClick={() => handleToggleActive(m)}>
                                                <span className="material-icons-round">{m.isActive ? 'block' : 'undo'}</span>
                                                {m.isActive ? ' Deaktiviraj' : ' Aktiviraj'}
                                            </button>
                                        </div>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                ))}

                {!loading && !error && members.length === 0 && (
                    <div className="team-empty">Još nema drugih naloga.</div>
                )}
            </div>

            <p className="team-foot">
                Deaktiviran nalog gubi pristup odmah, ali njegove dnevnice, zadaci i istorija procesa
                ostaju — zato se nalozi deaktiviraju, a ne brišu.
            </p>

            {modalOpen && (
                <UserFormModal
                    member={editing}
                    availableWorkers={data?.availableWorkers || []}
                    currentUserUid={user?.User_ID || ''}
                    onClose={() => { setModalOpen(false); setEditing(null); }}
                    onSubmit={handleSubmit}
                />
            )}
        </section>
    );
}
