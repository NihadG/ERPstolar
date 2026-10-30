'use client';

// ════════════════════════════════════════════════════════════════════
// „POŠALJI EMAILOM" — nacrt maila za narudžbu, pregled i slanje
//
// Na otvaranje server napravi nacrt (primalac iz Kontakata, naslov po tvom
// obrascu, PDF narudžbe kao prilog, potpis). Sve se može promijeniti; šalje
// se tek na „Pošalji", s tvog Gmaila. Narudžba iz Nacrta prelazi u Poslano.
//
// `api` se može zamijeniti (maketa /email-draft-preview radi bez prijave).
// ════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import Modal from '@/components/ui/Modal';
import { apiDelete, apiPatch, apiPost, ApiError } from '@/lib/apiClient';
import { isValidEmail, normalizeEmail } from '@/lib/contacts';
import type { EmailDraft, EmailDraftAddress } from '@/lib/types';
import './EmailDraftModal.css';

export interface DraftViewResponse {
    draft: EmailDraft;
    contacts: { name: string; email: string; company?: string }[];
    recipient: 'contact' | 'choose' | 'supplier-email' | 'requested' | 'none';
    orderStatus?: string;
}

export interface SendResponse {
    threadId: string;
    to: string[];
    orderSent: boolean;
    orderNumber?: string;
}

export interface EmailDraftApi {
    create: (orderId: string) => Promise<DraftViewResponse>;
    update: (id: string, patch: Partial<Pick<EmailDraft, 'To' | 'Cc' | 'Subject' | 'Body'>>) => Promise<unknown>;
    send: (id: string) => Promise<SendResponse>;
    cancel: (id: string) => Promise<unknown>;
}

export const realDraftApi: EmailDraftApi = {
    create: orderId => apiPost<DraftViewResponse>('/api/email/drafts', { purpose: 'order', orderId }),
    update: (id, patch) => apiPatch(`/api/email/drafts/${encodeURIComponent(id)}`, patch),
    send: id => apiPost<SendResponse>(`/api/email/drafts/${encodeURIComponent(id)}/send`),
    cancel: id => apiDelete(`/api/email/drafts/${encodeURIComponent(id)}`),
};

interface Props {
    isOpen: boolean;
    orderId: string | null;
    onClose: () => void;
    onSent: (result: SendResponse) => void;
    api?: EmailDraftApi;
}

type Problem = { kind: 'gmail'; text: string } | { kind: 'error'; text: string };

const label = (a: EmailDraftAddress) => a.name ? `${a.name} <${a.email}>` : a.email;

export default function EmailDraftModal({ isOpen, orderId, onClose, onSent, api = realDraftApi }: Props) {
    const [view, setView] = useState<DraftViewResponse | null>(null);
    const [problem, setProblem] = useState<Problem | null>(null);
    const [to, setTo] = useState<EmailDraftAddress[]>([]);
    const [cc, setCc] = useState<EmailDraftAddress[]>([]);
    const [subject, setSubject] = useState('');
    const [body, setBody] = useState('');
    const [sending, setSending] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!isOpen || !orderId) return;
        let alive = true;
        setView(null); setProblem(null); setError('');
        api.create(orderId).then(v => {
            if (!alive) return;
            setView(v);
            setTo(v.draft.To); setCc(v.draft.Cc); setSubject(v.draft.Subject); setBody(v.draft.Body);
        }).catch((e: unknown) => {
            if (!alive) return;
            const text = e instanceof Error ? e.message : 'Nacrt se nije mogao napraviti.';
            setProblem({ kind: e instanceof ApiError && (e.status === 409 || e.status === 503) && /gmail/i.test(text) ? 'gmail' : 'error', text });
        });
        return () => { alive = false; };
    }, [isOpen, orderId]);   // api je stabilan po instanci

    async function close() {
        if (view && !sending) api.cancel(view.draft.Draft_ID).catch(() => undefined);
        onClose();
    }

    async function send() {
        if (!view) return;
        if (!to.length) { setError('Izaberi kome ide mail.'); return; }
        if (!subject.trim()) { setError('Mail nema naslov.'); return; }
        setSending(true); setError('');
        try {
            await api.update(view.draft.Draft_ID, { To: to, Cc: cc, Subject: subject, Body: body });
            const result = await api.send(view.draft.Draft_ID);
            onSent(result);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Slanje nije uspjelo.');
        } finally {
            setSending(false);
        }
    }

    const attachment = view?.draft.Attachments[0];
    const isDraftOrder = view?.orderStatus === 'Nacrt';

    return (
        <Modal
            isOpen={isOpen}
            onClose={close}
            title="Pošalji narudžbu emailom"
            size="large"
            className="ed-modal"
            footer={view ? (
                <>
                    <button type="button" className="btn btn-secondary" onClick={close} disabled={sending}>Otkaži</button>
                    <button type="button" className="btn btn-primary" onClick={send} disabled={sending || !to.length}>
                        <span className="material-icons-round" style={{ fontSize: 18 }}>send</span>
                        {sending ? 'Šaljem…' : 'Pošalji'}
                    </button>
                </>
            ) : <button type="button" className="btn btn-secondary" onClick={onClose}>Zatvori</button>}
        >
            {!view && !problem && <div className="ed-loading">Pripremam nacrt…</div>}

            {problem && (
                <div className={`ed-problem${problem.kind === 'gmail' ? ' gmail' : ''}`}>
                    <span className="material-icons-round">{problem.kind === 'gmail' ? 'mail_lock' : 'error_outline'}</span>
                    <div>
                        <strong>{problem.text}</strong>
                        {problem.kind === 'gmail' && <p><a href="/settings?section=kontakti">Otvori Postavke → Kontakti</a> i poveži Gmail — narudžba se tad šalje s tvoje adrese.</p>}
                    </div>
                </div>
            )}

            {view && (
                <div className="ed-form">
                    {view.recipient === 'choose' && !to.length && (
                        <div className="ed-hint">
                            <span>Dobavljač ima više ljudi, nijedan nije glavni (★). Kome šalješ?</span>
                            <div className="ed-pick">
                                {(view.draft.Candidates || []).map(c => (
                                    <button key={c.email} type="button" className="ed-pill" onClick={() => setTo([c])}>{label(c)}</button>
                                ))}
                            </div>
                        </div>
                    )}
                    {view.recipient === 'supplier-email' && (
                        <div className="ed-hint">Adresa je s kartice dobavljača. Dodaj osobu u Kontakte da ERP pamti kome šalješ.</div>
                    )}
                    {view.recipient === 'none' && !to.length && (
                        <div className="ed-hint warn">Dobavljač nema nijedne adrese ni u Kontaktima ni na kartici — upiši je ispod.</div>
                    )}
                    {(view.draft.Warnings || []).filter(w => [...to, ...cc].some(a => a.email === w.email)).map(w => (
                        <div key={w.email} className="ed-hint warn">
                            <span>⚠️ {w.email} — da li si mislio <b>{w.suggestion}</b>?</span>
                            <div className="ed-pick">
                                <button
                                    type="button" className="ed-pill"
                                    onClick={() => {
                                        const swap = (list: EmailDraftAddress[]) => list.map(a => (a.email === w.email ? { ...a, email: w.suggestion } : a));
                                        setTo(swap(to)); setCc(swap(cc));
                                    }}
                                >Ispravi na {w.suggestion}</button>
                            </div>
                        </div>
                    ))}

                    <AddressField label="Kome" value={to} onChange={setTo} contacts={view.contacts} />
                    <AddressField label="Kopija" value={cc} onChange={setCc} contacts={view.contacts} />

                    <label className="ed-field">
                        <span>Naslov</span>
                        <input value={subject} onChange={e => setSubject(e.target.value)} />
                    </label>
                    <label className="ed-field">
                        <span>Tekst</span>
                        <textarea rows={9} value={body} onChange={e => setBody(e.target.value)} />
                    </label>

                    {attachment && (
                        <div className="ed-attachment">
                            <span className="material-icons-round">picture_as_pdf</span>
                            <span>{subject.trim() ? `${subject.replace(/[\\/:*?"<>|]+/g, ' ').trim()}.pdf` : attachment.filename}</span>
                            <span className="ed-sub">PDF narudžbe, napravljen u trenutku slanja</span>
                        </div>
                    )}

                    {isDraftOrder && (
                        <p className="ed-note">Poslije slanja narudžba prelazi u „Poslano" i materijali postaju naručeni.</p>
                    )}
                    {error && <div className="ed-error" role="alert"><span className="material-icons-round">error_outline</span>{error}</div>}
                </div>
            )}
        </Modal>
    );
}

// ── Polje adresa: čipovi + upis s prijedlozima iz Kontakata ──────────

function AddressField({ label: title, value, onChange, contacts }: {
    label: string;
    value: EmailDraftAddress[];
    onChange: (v: EmailDraftAddress[]) => void;
    contacts: DraftViewResponse['contacts'];
}) {
    const [text, setText] = useState('');
    const [invalid, setInvalid] = useState(false);
    const listId = useMemo(() => `ed-list-${title}`, [title]);

    function add(raw: string) {
        const email = normalizeEmail(raw);
        // Neispravna adresa ostaje u polju da se ispravi, ne nestaje tiho.
        if (!isValidEmail(email)) { setInvalid(true); return; }
        setInvalid(false);
        if (value.some(a => a.email === email)) { setText(''); return; }
        const known = contacts.find(c => c.email === email);
        onChange([...value, known?.name && known.name !== email ? { name: known.name, email } : { email }]);
        setText('');
    }

    function onKey(e: KeyboardEvent<HTMLInputElement>) {
        if ((e.key === 'Enter' || e.key === ',' || e.key === 'Tab') && text.trim()) {
            if (e.key !== 'Tab') e.preventDefault();
            add(text);
        }
        if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1));
    }

    return (
        <div className="ed-field">
            <span>{title}</span>
            <div className={`ed-chips${invalid ? ' invalid' : ''}`} title={invalid ? 'Neispravna adresa' : undefined}>
                {value.map(a => (
                    <span key={a.email} className="ed-chip" title={a.email}>
                        {a.name || a.email}
                        <button type="button" aria-label={`Ukloni ${a.email}`} onClick={() => onChange(value.filter(x => x.email !== a.email))}>×</button>
                    </span>
                ))}
                <input
                    list={listId} value={text} placeholder={value.length ? '' : 'ime ili adresa…'}
                    onChange={e => {
                        const v = e.target.value;
                        // Izbor iz liste prijedloga upiše cijelu adresu — dodaj odmah.
                        setInvalid(false);
                        if (contacts.some(c => c.email === normalizeEmail(v))) add(v); else setText(v);
                    }}
                    onKeyDown={onKey} onBlur={() => text.trim() && add(text)}
                    aria-label={title}
                />
                <datalist id={listId}>
                    {contacts.map(c => <option key={c.email} value={c.email}>{[c.name, c.company].filter(Boolean).join(' · ')}</option>)}
                </datalist>
            </div>
        </div>
    );
}
