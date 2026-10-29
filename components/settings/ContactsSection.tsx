'use client';

// ════════════════════════════════════════════════════════════════════
// POSTAVKE → KONTAKTI
//
// Učitava kontakte, dobavljače i (lagano) projekte, i upisuje promjene.
// Sav prikaz je u ContactsView; pravila (jedna ★ po dobavljaču, uvoz bez
// duplikata) su u lib/contacts.ts. Gmail veza (/api/email/google) daje
// prijedloge iz poslane pošte u istu listu uvoza.
// ════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import {
    deleteContact, getContacts, getProjectContactSources, getSuppliers, saveContact, saveContacts,
} from '@/lib/services';
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/apiClient';
import {
    importCandidates, normalizeEmail, singleDefaults, staleDefaults,
    type ContactDraft, type ImportCandidate, type ProjectContactSource,
} from '@/lib/contacts';
import type { Contact, Supplier } from '@/lib/types';
import ContactsView from './ContactsView';
import GmailCard, { type GmailBusy, type GmailState } from './GmailCard';

interface Props {
    showMessage: (text: string, type: 'success' | 'error') => void;
}

export default function ContactsSection({ showMessage }: Props) {
    const { organization } = useAuth();
    const orgId = organization?.Organization_ID || '';
    // Postavke daju novu showMessage pri svakom renderu — kroz ref, da poruka ne učitava sve ponovo.
    const messageRef = useRef(showMessage);
    messageRef.current = showMessage;
    const notify = useCallback((text: string, type: 'success' | 'error') => messageRef.current(text, type), []);

    const [contacts, setContacts] = useState<Contact[]>([]);
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [projects, setProjects] = useState<ProjectContactSource[]>([]);
    const [loading, setLoading] = useState(true);

    const [gmail, setGmail] = useState<GmailState | null>(null);
    const [busy, setBusy] = useState<GmailBusy>(null);
    const [fromMail, setFromMail] = useState<ImportCandidate[]>([]);
    const [scanned, setScanned] = useState<number | null>(null);
    const [reveal, setReveal] = useState(0);

    const load = useCallback(async () => {
        if (!orgId) return;
        try {
            const [c, s, p] = await Promise.all([getContacts(orgId), getSuppliers(orgId), getProjectContactSources(orgId)]);
            setContacts(c);
            setSuppliers(s);
            setProjects(p);
        } catch (e) {
            console.error('Kontakti: učitavanje nije uspjelo', e);
            notify('Učitavanje kontakata nije uspjelo.', 'error');
        } finally {
            setLoading(false);
        }
    }, [orgId, notify]);

    const loadGmail = useCallback(async () => {
        try {
            setGmail(await apiGet<GmailState>('/api/email/google'));
        } catch {
            setGmail({ configured: false, connected: false, email: null, sendAs: null, status: null });
        }
    }, []);

    useEffect(() => { load(); loadGmail(); }, [load, loadGmail]);

    // Iz polja ERP-a prvo, pa iz pošte; bez adresa koje su u međuvremenu uvezene.
    const candidates = useMemo(() => {
        const own = importCandidates(suppliers, projects, contacts);
        const known = new Set([...contacts.map(c => normalizeEmail(c.Email)), ...own.map(c => c.draft.Email)]);
        return [...own, ...fromMail.filter(c => !known.has(c.draft.Email))];
    }, [suppliers, projects, contacts, fromMail]);

    const projectOptions = useMemo(() => projects
        .filter(p => !p.Hidden)
        .map(p => ({ Project_ID: p.Project_ID, label: p.Name || p.Client_Name || 'Projekat' }))
        .sort((a, b) => a.label.localeCompare(b.label, 'bs')), [projects]);

    async function onSave(contact: Partial<Contact>): Promise<boolean> {
        const result = await saveContact(contact, orgId);
        if (!result.success) { notify(result.message, 'error'); return false; }
        // Jedan glavni kontakt po dobavljaču: stari ★ se skida.
        const stale = staleDefaults(contacts, { Contact_ID: result.data!.Contact_ID, Supplier_ID: contact.Supplier_ID, Is_Default: contact.Is_Default });
        await Promise.all(stale.map(c => saveContact({ Contact_ID: c.Contact_ID, Email: c.Email, Is_Default: false }, orgId)));
        await load();
        return true;
    }

    async function onDelete(contact: Contact) {
        const result = await deleteContact(contact.Contact_ID, orgId);
        notify(result.message, result.success ? 'success' : 'error');
        await load();
    }

    async function onImport(drafts: ContactDraft[]) {
        const result = await saveContacts(singleDefaults(drafts, contacts), orgId);
        notify(result.message, result.success ? 'success' : 'error');
        await load();
    }

    // ── Gmail ────────────────────────────────────────────────────────

    async function gmailCall<T>(kind: GmailBusy, fn: () => Promise<T>): Promise<T | undefined> {
        setBusy(kind);
        try {
            return await fn();
        } catch (e: any) {
            notify(e?.message || 'Gmail nije odgovorio.', 'error');
            if (/istekla|poveži ponovo/i.test(e?.message || '')) await loadGmail();
            return undefined;
        } finally {
            setBusy(null);
        }
    }

    const onConnect = () => gmailCall('connect', async () => {
        const { url } = await apiPost<{ url: string }>('/api/email/google/connect');
        window.location.href = url;
    });

    const onDisconnect = () => {
        if (!window.confirm('Prekinuti Gmail vezu?\n\nERP više neće moći slati ni čitati poštu dok je ponovo ne povežeš. Kontakti ostaju.')) return;
        gmailCall('disconnect', async () => {
            await apiDelete('/api/email/google');
            setFromMail([]);
            setScanned(null);
            notify('Gmail veza je prekinuta.', 'success');
            await loadGmail();
        });
    };

    const onSuggest = () => gmailCall('suggest', async () => {
        const res = await apiGet<{ candidates: ImportCandidate[]; scanned: number }>('/api/email/google/contacts');
        setFromMail(res.candidates);
        setScanned(res.scanned);
        if (res.candidates.length) setReveal(n => n + 1);
    });

    const onSendAs = async (email: string) => {
        await gmailCall('sendAs', async () => {
            await apiPatch('/api/email/google', { sendAs: email });
            notify(`Mailovi će ići s adrese ${email}.`, 'success');
            await loadGmail();
        });
    };

    return (
        <ContactsView
            contacts={contacts}
            suppliers={suppliers}
            projects={projectOptions}
            candidates={candidates}
            loading={loading}
            onSave={onSave}
            onDelete={onDelete}
            onImport={onImport}
            revealImport={reveal}
            top={
                <GmailCard
                    state={gmail} busy={busy}
                    lastScan={scanned === null ? null : { scanned, found: candidates.filter(c => c.source.startsWith('Gmail')).length }}
                    onConnect={onConnect} onDisconnect={onDisconnect} onSuggest={onSuggest} onSendAs={onSendAs}
                />
            }
        />
    );
}
