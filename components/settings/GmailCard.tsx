'use client';

// ════════════════════════════════════════════════════════════════════
// KARTICA GMAIL VEZE (Postavke → Kontakti)
//
// Samo prikaz: stanja su nije podešeno na serveru / nije povezano / veza
// istekla / povezano (adresa, „šalje kao", prijedlog kontakata iz poslane
// pošte, prekid veze). Pozive radi ContactsSection.
// ════════════════════════════════════════════════════════════════════

import { useState } from 'react';
import { isValidEmail } from '@/lib/contacts';

export interface GmailState {
    configured: boolean;
    connected: boolean;
    email: string | null;
    sendAs: string | null;
    status: 'ok' | 'reconnect' | null;
    /** Potpis koji ERP dodaje na kraj maila; prazno = „Srdačno," + ime. */
    signature?: string;
}

export type GmailBusy = 'connect' | 'disconnect' | 'suggest' | 'sendAs' | 'signature' | null;

/** 1 nova adresa, 3 nove adrese, 5 novih adresa. */
const newAddresses = (n: number) => n % 10 === 1 && n % 100 !== 11 ? `${n} nova adresa je` : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? `${n} nove adrese su` : `${n} novih adresa je`;

interface Props {
    state: GmailState | null;
    busy: GmailBusy;
    /** Rezultat zadnjeg prijedloga: koliko mailova pregledano, koliko novih adresa. */
    lastScan?: { scanned: number; found: number } | null;
    onConnect: () => void;
    onDisconnect: () => void;
    onSuggest: () => void;
    onSendAs: (email: string) => Promise<void>;
    onSignature: (text: string) => Promise<void>;
}

export default function GmailCard({ state, busy, lastScan, onConnect, onDisconnect, onSuggest, onSendAs, onSignature }: Props) {
    const [editing, setEditing] = useState(false);
    const [alias, setAlias] = useState('');
    const [signing, setSigning] = useState(false);
    const [signature, setSignature] = useState('');

    if (!state) {
        return <div className="gm-card muted"><span className="material-icons-round">mail</span><p>Provjeravam Gmail vezu…</p></div>;
    }

    if (!state.configured) {
        return (
            <div className="gm-card muted">
                <span className="material-icons-round">mail_lock</span>
                <div className="gm-main">
                    <strong>Gmail još nije podešen na serveru</strong>
                    <p>Potrebni su <code>GOOGLE_OAUTH_CLIENT_SECRET</code> i <code>EMAIL_TOKEN_KEY</code> na Vercelu i redirect URI u Google Cloudu. Kontakti rade i bez toga.</p>
                </div>
            </div>
        );
    }

    if (!state.connected || state.status === 'reconnect') {
        const expired = state.status === 'reconnect';
        return (
            <div className={`gm-card${expired ? ' warn' : ''}`}>
                <span className="material-icons-round">{expired ? 'sync_problem' : 'mail'}</span>
                <div className="gm-main">
                    <strong>{expired ? `Gmail veza je istekla${state.email ? ` (${state.email})` : ''}` : 'Poveži svoj Gmail'}</strong>
                    <p>
                        {expired
                            ? 'Google je odbio stari pristup (promijenjena lozinka ili opozvana veza). Poveži ponovo — kontakti i podešavanja ostaju.'
                            : 'ERP će slati narudžbe i ponude s tvoje adrese i predložiti kontakte iz poslane pošte. Ništa se ne šalje bez tvog klika, a u Gmailu se ništa ne briše ni mijenja.'}
                    </p>
                </div>
                <button type="button" className="btn btn-primary btn-sm" disabled={busy === 'connect'} onClick={onConnect}>
                    {busy === 'connect' ? 'Otvaram Google…' : expired ? 'Poveži ponovo' : 'Poveži Gmail'}
                </button>
            </div>
        );
    }

    async function saveAlias() {
        if (!isValidEmail(alias)) return;
        await onSendAs(alias);
        setEditing(false);
    }

    return (
        <div className="gm-card ok">
            <span className="material-icons-round">mark_email_read</span>
            <div className="gm-main">
                <strong>Gmail povezan · {state.email}</strong>
                {editing ? (
                    <div className="gm-alias">
                        <input
                            type="email" value={alias} autoFocus placeholder="adresa@firma.ba" aria-label="Šalje kao"
                            onChange={e => setAlias(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') saveAlias(); if (e.key === 'Escape') setEditing(false); }}
                        />
                        <button type="button" className="btn btn-primary btn-sm" disabled={!isValidEmail(alias) || busy === 'sendAs'} onClick={saveAlias}>Sačuvaj</button>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(false)}>Otkaži</button>
                    </div>
                ) : (
                    <p>
                        Šalje kao <b>{state.sendAs || state.email}</b>{' '}
                        <button type="button" className="ct-link" onClick={() => { setAlias(state.sendAs || state.email || ''); setEditing(true); }}>Promijeni</button>
                        <span className="gm-hint"> (druga adresa mora biti dodana u Gmailu kao „Pošalji poštu kao")</span>
                    </p>
                )}
                {signing ? (
                    <div className="gm-signature">
                        <textarea
                            rows={4} value={signature} autoFocus aria-label="Potpis"
                            placeholder={'Srdačno,\n\nIme Prezime\n061 …'}
                            onChange={e => setSignature(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Escape') setSigning(false); }}
                        />
                        <div className="gm-alias">
                            <button type="button" className="btn btn-primary btn-sm" disabled={busy === 'signature'}
                                onClick={async () => { await onSignature(signature); setSigning(false); }}>Sačuvaj potpis</button>
                            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSigning(false)}>Otkaži</button>
                        </div>
                    </div>
                ) : (
                    <p>
                        Potpis: <span className="gm-sig-preview">{state.signature ? state.signature.split('\n').filter(Boolean).join(' · ') : '„Srdačno," + tvoje ime i telefon'}</span>{' '}
                        <button type="button" className="ct-link" onClick={() => { setSignature(state.signature || ''); setSigning(true); }}>Uredi</button>
                    </p>
                )}
                {lastScan && (
                    <p className="gm-scan">
                        Pregledano {lastScan.scanned} poslanih mailova · {lastScan.found ? `${newAddresses(lastScan.found)} u listi za uvoz ispod` : 'nema novih adresa'}
                    </p>
                )}
            </div>
            <div className="gm-actions">
                <button type="button" className="btn btn-secondary btn-sm" disabled={busy === 'suggest'} onClick={onSuggest}>
                    <span className="material-icons-round">person_search</span>
                    {busy === 'suggest' ? 'Čitam poslanu poštu…' : 'Predloži iz poslane pošte'}
                </button>
                <button type="button" className="ct-link danger" disabled={busy === 'disconnect'} onClick={onDisconnect}>Prekini vezu</button>
            </div>
        </div>
    );
}
