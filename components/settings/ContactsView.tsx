'use client';

// ════════════════════════════════════════════════════════════════════
// POSTAVKE → KONTAKTI (prikaz)
//
// Jedan red = jedna email adresa = jedan čovjek. Dobavljač može imati koliko
// god ljudi (komercijalista, referent, knjigovodstvo, adresa za račune).
//
//   • Grupisano po firmi (glavni ★ prvi) ili ravna lista s kolonom Firma
//   • Uređivanje u samom redu — bez modala
//   • Uvoz adresa koje već stoje u dobavljačima i projektima, uz pregled
//
// Prikaz ne zna za Firestore: učitavanje i upis radi ContactsSection, pa se
// isti prikaz može provjeriti bez prijave (/contacts-preview).
// ════════════════════════════════════════════════════════════════════

import { useMemo, useState, type KeyboardEvent } from 'react';
import type { Contact, ContactCopyOn, ContactKind, ContactProjectLink, ContactProjectRole } from '@/lib/types';
import {
    contactCompany, contactFullName, duplicateOf, filterContacts, groupContacts, isValidEmail,
    KIND_LABELS, PROJECT_ROLE_LABELS, type ContactDraft, type ContactGroup, type ImportCandidate,
} from '@/lib/contacts';
import './ContactsView.css';

export interface ContactsViewProps {
    contacts: Contact[];
    suppliers: { Supplier_ID: string; Name: string }[];
    projects: { Project_ID: string; label: string }[];
    candidates: ImportCandidate[];
    loading?: boolean;
    /** Upis jednog kontakta; true = uspjelo. */
    onSave: (contact: Partial<Contact>) => Promise<boolean>;
    onDelete: (contact: Contact) => Promise<void>;
    onImport: (drafts: ContactDraft[]) => Promise<void>;
}

const KINDS: ContactKind[] = ['supplier', 'client', 'site', 'internal', 'other'];
const KIND_ONE: Record<ContactKind, string> = {
    supplier: 'Dobavljač', client: 'Klijent', site: 'Gradilište', internal: 'Interno', other: 'Ostalo',
};
const COPY_LABELS: Record<ContactCopyOn, string> = {
    order: 'Narudžba', offer: 'Ponuda', invoice: 'Račun', situation: 'Situacija',
};
const ROLES = Object.keys(PROJECT_ROLE_LABELS) as ContactProjectRole[];

type View = 'groups' | 'list';
type Draft = Partial<Contact> & { _group?: string };

/** 1 adresa, 3 adrese, 5 adresa. */
const adresa = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'adresa' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'adrese' : 'adresa');

const day = (iso?: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? '' : `${d.getDate()}.${d.getMonth() + 1}.`;
};

export default function ContactsView({ contacts, suppliers, projects, candidates, loading, onSave, onDelete, onImport }: ContactsViewProps) {
    const [kind, setKind] = useState<'all' | ContactKind>('all');
    const [query, setQuery] = useState('');
    const [view, setView] = useState<View>('groups');
    const [draft, setDraft] = useState<Draft | null>(null);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const [importOpen, setImportOpen] = useState(false);
    const [skipped, setSkipped] = useState<Set<number>>(new Set());

    const supplierNames = useMemo(() => new Map(suppliers.map(s => [s.Supplier_ID, s.Name])), [suppliers]);
    const supplierName = (id: string) => supplierNames.get(id);
    const projectLabel = useMemo(() => new Map(projects.map(p => [p.Project_ID, p.label])), [projects]);

    const filtered = useMemo(() => filterContacts(contacts, { kind, query, supplierName }), [contacts, kind, query, supplierNames]);
    const groups = useMemo(() => groupContacts(filtered, supplierName), [filtered, supplierNames]);
    const flat = useMemo(() => [...filtered].sort((a, b) =>
        (a.Last_Name || a.First_Name || a.Email).localeCompare(b.Last_Name || b.First_Name || b.Email, 'bs')), [filtered]);

    const count = (k: 'all' | ContactKind) => k === 'all' ? contacts.length : contacts.filter(c => c.Kind === k).length;
    const editingId = draft?.Contact_ID;
    const isNew = !!draft && !draft.Contact_ID;

    function startNew(group?: ContactGroup) {
        setError('');
        setDraft({
            Kind: group?.kind ?? (kind === 'all' ? 'supplier' : kind),
            Supplier_ID: group?.supplierId,
            Company: group && !group.supplierId ? group.company : undefined,
            _group: group?.key ?? '',
        });
    }

    function startEdit(c: Contact) {
        setError('');
        setDraft({ ...c });
    }

    function close() { setDraft(null); setError(''); }

    async function save() {
        if (!draft) return;
        const email = (draft.Email || '').trim();
        if (!isValidEmail(email)) { setError('Unesite ispravnu email adresu.'); return; }
        const same = duplicateOf(contacts, email, draft.Contact_ID);
        if (same) { setError(`Ova adresa je već u kontaktima${contactFullName(same) !== same.Email ? ` (${contactFullName(same)})` : ''}.`); return; }
        const { _group, ...record } = draft;
        setSaving(true);
        const ok = await onSave({
            ...record,
            Project_Roles: (record.Project_Roles || []).filter(r => r.Project_ID),
        });
        setSaving(false);
        if (ok) close();
    }

    function onKey(e: KeyboardEvent<HTMLDivElement>) {
        if (e.key === 'Escape') { e.stopPropagation(); close(); }
        if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') { e.preventDefault(); save(); }
    }

    async function toggleDefault(c: Contact) {
        await onSave({ Contact_ID: c.Contact_ID, Supplier_ID: c.Supplier_ID, Email: c.Email, Is_Default: !c.Is_Default });
    }

    async function remove(c: Contact) {
        if (!window.confirm(`Obrisati ${contactFullName(c)}?\n\n${c.Email}`)) return;
        await onDelete(c);
    }

    const picked = candidates.filter((_, i) => !skipped.has(i));
    async function runImport() {
        await onImport(picked.map(c => c.draft));
        setImportOpen(false);
        setSkipped(new Set());
    }

    const editor = draft && (
        <Editor
            draft={draft} setDraft={setDraft} error={error} saving={saving}
            suppliers={suppliers} projects={projects} onSave={save} onCancel={close} onKey={onKey}
        />
    );

    const person = (c: Contact, showCompany: boolean) => (
        editingId === c.Contact_ID ? <div key={c.Contact_ID}>{editor}</div> : (
            <div key={c.Contact_ID} className={`ct-row${showCompany ? ' with-company' : ''}${c.Receive_Only ? ' receive-only' : ''}`}>
                <div className="ct-c-star">
                    {c.Kind === 'supplier' && c.Supplier_ID && (
                        <button
                            type="button" className={`ct-star${c.Is_Default ? ' on' : ''}`}
                            title={c.Is_Default ? 'Glavni kontakt — njemu ide narudžba' : 'Postavi kao glavni kontakt dobavljača'}
                            aria-pressed={!!c.Is_Default} onClick={() => toggleDefault(c)}
                        >
                            <span className="material-icons-round">{c.Is_Default ? 'star' : 'star_outline'}</span>
                        </button>
                    )}
                </div>
                <div className="ct-c-first">
                    <strong>{c.First_Name || (c.Last_Name ? '' : '—')}</strong>
                    {c.Last_Name && <span className="ct-mo"> {c.Last_Name}</span>}
                </div>
                <div className="ct-c-last">{c.Last_Name}</div>
                <div className="ct-c-email">
                    <span className="ct-email">{c.Email}</span>
                    {c.Phone && <span className="ct-sub">{c.Phone}</span>}
                    {c.Last_Emailed_At && <span className="ct-sub">zadnji mail {day(c.Last_Emailed_At)}</span>}
                </div>
                <div className="ct-c-role">
                    {c.Role && <span className="ct-role">{c.Role}</span>}
                    <span className="ct-chips">
                        {c.Receive_Only && <span className="ct-chip muted" title="Adresa samo šalje (npr. računi) — nikad primalac">samo šalje</span>}
                        {(c.Project_Roles || []).map(r => (
                            <span key={r.Project_ID + r.Role} className="ct-chip blue">
                                {projectLabel.get(r.Project_ID) || 'Projekat'} · {PROJECT_ROLE_LABELS[r.Role].toLowerCase()}
                            </span>
                        ))}
                        {(c.Copy_On || []).length > 0 && (
                            <span className="ct-chip green" title="Dobija kopiju kad se šalje">
                                kopija: {(c.Copy_On || []).map(k => COPY_LABELS[k].toLowerCase()).join(', ')}
                            </span>
                        )}
                    </span>
                </div>
                {showCompany && (
                    <div className="ct-c-company">
                        <span>{contactCompany(c, supplierName) || '—'}</span>
                        <span className={`ct-kind ${c.Kind}`}>{KIND_ONE[c.Kind]}</span>
                    </div>
                )}
                <div className="ct-c-actions">
                    <button type="button" className="ct-icon" title="Uredi" onClick={() => startEdit(c)}>
                        <span className="material-icons-round">edit</span>
                    </button>
                    <button type="button" className="ct-icon danger" title="Obriši" onClick={() => remove(c)}>
                        <span className="material-icons-round">delete_outline</span>
                    </button>
                </div>
            </div>
        )
    );

    const empty = !loading && contacts.length === 0;

    return (
        <section className="ct-section">
            <div className="ct-head">
                <div>
                    <h2>Kontakti</h2>
                    <p>Ljudi iza dobavljača, klijenata i gradilišta. Jedan red je jedna adresa — dobavljač može imati koliko god ljudi, a ★ označava kome ide narudžba.</p>
                </div>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => startNew()}>
                    <span className="material-icons-round">person_add</span> Novi kontakt
                </button>
            </div>

            {candidates.length > 0 && (
                <div className="ct-import">
                    <div className="ct-import-head">
                        <span className="material-icons-round">move_to_inbox</span>
                        <div>
                            <strong>{candidates.length} {adresa(candidates.length)} iz dobavljača i projekata još {candidates.length === 1 ? 'nije' : 'nisu'} u Kontaktima</strong>
                            <p>Preuzmi ih jednim klikom; prije toga možeš odznačiti one koje ne trebaju.</p>
                        </div>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setImportOpen(o => !o)}>
                            {importOpen ? 'Zatvori' : 'Pregledaj'}
                        </button>
                    </div>
                    {importOpen && (
                        <div className="ct-import-body">
                            {candidates.map((c, i) => (
                                <label key={c.draft.Email} className="ct-import-row">
                                    <input
                                        type="checkbox" checked={!skipped.has(i)}
                                        onChange={() => setSkipped(s => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; })}
                                    />
                                    <span className="ct-import-name">{[c.draft.First_Name, c.draft.Last_Name].filter(Boolean).join(' ') || c.draft.Company || '—'}</span>
                                    <span className="ct-email">{c.draft.Email}</span>
                                    <span className="ct-sub">{c.source}</span>
                                    {c.draft.Is_Default && <span className="ct-chip amber">★ glavni</span>}
                                </label>
                            ))}
                            <div className="ct-import-foot">
                                <button type="button" className="btn btn-primary btn-sm" disabled={!picked.length} onClick={runImport}>
                                    Uvezi {picked.length}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            <div className="ct-toolbar">
                <div className="ct-kinds" role="tablist">
                    {(['all', ...KINDS] as const).map(k => (
                        <button
                            key={k} type="button" role="tab" aria-selected={kind === k}
                            className={`ct-kind-btn${kind === k ? ' active' : ''}`} onClick={() => setKind(k)}
                        >
                            {k === 'all' ? 'Svi' : KIND_LABELS[k]} <span className="ct-n">{count(k)}</span>
                        </button>
                    ))}
                </div>
                <div className="ct-tools">
                    <div className="ct-search">
                        <span className="material-icons-round">search</span>
                        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Ime, firma, adresa…" aria-label="Pretraga kontakata" />
                    </div>
                    <div className="ct-seg" role="group" aria-label="Prikaz">
                        <button type="button" className={view === 'groups' ? 'active' : ''} onClick={() => setView('groups')}>Po firmi</button>
                        <button type="button" className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>Lista</button>
                    </div>
                </div>
            </div>

            {isNew && draft?._group === '' && editor}

            {loading && <div className="ct-empty"><span className="material-icons-round">hourglass_empty</span><p>Učitavam kontakte…</p></div>}

            {empty && !isNew && (
                <div className="ct-empty">
                    <span className="material-icons-round">contacts</span>
                    <strong>Još nema kontakata</strong>
                    <p>{candidates.length ? 'Uvezi adrese koje već imaš u dobavljačima i projektima, ili dodaj prvu osobu.' : 'Dodaj prvu osobu — komercijalistu, referenta, nekoga na gradilištu.'}</p>
                </div>
            )}

            {!loading && contacts.length > 0 && filtered.length === 0 && (
                <div className="ct-empty"><span className="material-icons-round">search_off</span><p>Nema kontakata za ovu pretragu.</p></div>
            )}

            {view === 'groups' ? groups.map(g => (
                <div key={g.key} className="ct-group">
                    <div className="ct-group-head">
                        <strong>{g.company || 'Bez firme'}</strong>
                        <span className={`ct-kind ${g.kind}`}>{KIND_ONE[g.kind]}</span>
                        <span className="ct-n">{g.contacts.length}</span>
                        <button type="button" className="ct-link" onClick={() => startNew(g)}>+ osoba</button>
                    </div>
                    <div className="ct-cols"><span /><span>Ime</span><span>Prezime</span><span>Email</span><span>Uloga</span><span /></div>
                    {g.contacts.map(c => person(c, false))}
                    {isNew && draft?._group === g.key && editor}
                </div>
            )) : flat.length > 0 && (
                <div className="ct-group">
                    <div className="ct-cols with-company"><span /><span>Ime</span><span>Prezime</span><span>Email</span><span>Uloga</span><span>Firma</span><span /></div>
                    {flat.map(c => person(c, true))}
                </div>
            )}
        </section>
    );
}

// ── Uređivač u redu ──────────────────────────────────────────────────

interface EditorProps {
    draft: Draft;
    setDraft: (d: Draft) => void;
    error: string;
    saving: boolean;
    suppliers: ContactsViewProps['suppliers'];
    projects: ContactsViewProps['projects'];
    onSave: () => void;
    onCancel: () => void;
    onKey: (e: KeyboardEvent<HTMLDivElement>) => void;
}

function Editor({ draft, setDraft, error, saving, suppliers, projects, onSave, onCancel, onKey }: EditorProps) {
    const set = (patch: Draft) => setDraft({ ...draft, ...patch });
    const sorted = useMemo(() => [...suppliers].sort((a, b) => a.Name.localeCompare(b.Name, 'bs')), [suppliers]);
    const roles = draft.Project_Roles || [];
    const copy = draft.Copy_On || [];
    const setRole = (i: number, patch: Partial<ContactProjectLink>) =>
        set({ Project_Roles: roles.map((r, j) => j === i ? { ...r, ...patch } : r) });
    const toggleCopy = (k: ContactCopyOn) =>
        set({ Copy_On: copy.includes(k) ? copy.filter(x => x !== k) : [...copy, k] });

    return (
        <div className="ct-editor" onKeyDown={onKey}>
            <div className="ct-form">
                <label className="ct-field"><span>Ime</span>
                    <input value={draft.First_Name || ''} onChange={e => set({ First_Name: e.target.value })} autoFocus placeholder="Emir" /></label>
                <label className="ct-field"><span>Prezime</span>
                    <input value={draft.Last_Name || ''} onChange={e => set({ Last_Name: e.target.value })} placeholder="Hadžić" /></label>
                <label className="ct-field wide"><span>Email *</span>
                    <input type="email" value={draft.Email || ''} onChange={e => set({ Email: e.target.value })} placeholder="ime@firma.ba" /></label>
                <label className="ct-field"><span>Telefon</span>
                    <input value={draft.Phone || ''} onChange={e => set({ Phone: e.target.value })} placeholder="061 …" /></label>

                <label className="ct-field"><span>Vrsta</span>
                    <select value={draft.Kind || 'other'} onChange={e => set({ Kind: e.target.value as ContactKind })}>
                        {KINDS.map(k => <option key={k} value={k}>{KIND_ONE[k]}</option>)}
                    </select></label>
                <label className="ct-field"><span>Dobavljač iz ERP-a</span>
                    <select
                        value={draft.Supplier_ID || ''}
                        onChange={e => set({ Supplier_ID: e.target.value || undefined, ...(e.target.value ? { Kind: 'supplier' as const, Company: undefined } : { Is_Default: undefined }) })}
                    >
                        <option value="">— nije dobavljač —</option>
                        {sorted.map(s => <option key={s.Supplier_ID} value={s.Supplier_ID}>{s.Name}</option>)}
                    </select></label>
                {!draft.Supplier_ID && (
                    <label className="ct-field"><span>Firma</span>
                        <input value={draft.Company || ''} onChange={e => set({ Company: e.target.value })} placeholder="npr. projektni biro" /></label>
                )}
                <label className="ct-field"><span>Uloga</span>
                    <input value={draft.Role || ''} onChange={e => set({ Role: e.target.value })} placeholder="komercijalista, referent…" /></label>
                <div className="ct-field wide"><span>Obraćanje</span>
                    <div className="ct-seg" role="group" aria-label="Obraćanje">
                        {([['ti', 'Ti'], ['vi', 'Vi'], [undefined, 'Nije bitno']] as const).map(([v, label]) => (
                            <button key={label} type="button" className={draft.Address_Form === v ? 'active' : ''} onClick={() => set({ Address_Form: v })}>{label}</button>
                        ))}
                    </div></div>
            </div>

            <div className="ct-options">
                {draft.Supplier_ID && (
                    <label className="ct-check">
                        <input type="checkbox" checked={!!draft.Is_Default} onChange={e => set({ Is_Default: e.target.checked || undefined })} />
                        <span><strong>★ Glavni kontakt</strong> — njemu ide narudžba</span>
                    </label>
                )}
                <label className="ct-check">
                    <input type="checkbox" checked={!!draft.Receive_Only} onChange={e => set({ Receive_Only: e.target.checked || undefined })} />
                    <span><strong>Samo šalje</strong> — računi i obavijesti, nikad primalac</span>
                </label>
                <div className="ct-copy">
                    <span>Dobija kopiju kad šalješ:</span>
                    {(Object.keys(COPY_LABELS) as ContactCopyOn[]).map(k => (
                        <button key={k} type="button" className={`ct-pick${copy.includes(k) ? ' on' : ''}`} aria-pressed={copy.includes(k)} onClick={() => toggleCopy(k)}>
                            {COPY_LABELS[k]}
                        </button>
                    ))}
                </div>
            </div>

            <div className="ct-roles">
                <span className="ct-roles-title">Uloga na projektima</span>
                {roles.map((r, i) => (
                    <div key={i} className="ct-role-row">
                        <select value={r.Project_ID} onChange={e => setRole(i, { Project_ID: e.target.value })} aria-label="Projekat">
                            <option value="">— projekat —</option>
                            {projects.map(p => <option key={p.Project_ID} value={p.Project_ID}>{p.label}</option>)}
                        </select>
                        <select value={r.Role} onChange={e => setRole(i, { Role: e.target.value as ContactProjectRole })} aria-label="Uloga">
                            {ROLES.map(x => <option key={x} value={x}>{PROJECT_ROLE_LABELS[x]}</option>)}
                        </select>
                        <button type="button" className="ct-icon" title="Ukloni" onClick={() => set({ Project_Roles: roles.filter((_, j) => j !== i) })}>
                            <span className="material-icons-round">close</span>
                        </button>
                    </div>
                ))}
                <button type="button" className="ct-link" onClick={() => set({ Project_Roles: [...roles, { Project_ID: '', Role: 'kupac' }] })}>+ projekat</button>
            </div>

            <label className="ct-field full"><span>Napomena</span>
                <textarea rows={2} value={draft.Notes || ''} onChange={e => set({ Notes: e.target.value })} placeholder="Radi samo utorkom, javlja se na fiksni…" /></label>

            {error && <div className="ct-error" role="alert"><span className="material-icons-round">error_outline</span>{error}</div>}
            <div className="ct-editor-foot">
                <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel}>Otkaži</button>
                <button type="button" className="btn btn-primary btn-sm" disabled={saving} onClick={onSave}>{saving ? 'Čuvam…' : 'Sačuvaj'}</button>
            </div>
        </div>
    );
}
