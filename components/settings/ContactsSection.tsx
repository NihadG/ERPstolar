'use client';

// ════════════════════════════════════════════════════════════════════
// POSTAVKE → KONTAKTI
//
// Učitava kontakte, dobavljače i (lagano) projekte, i upisuje promjene.
// Sav prikaz je u ContactsView; pravila (jedna ★ po dobavljaču, uvoz bez
// duplikata) su u lib/contacts.ts.
// ════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import {
    deleteContact, getContacts, getProjectContactSources, getSuppliers, saveContact, saveContacts,
} from '@/lib/services';
import { importCandidates, staleDefaults, type ContactDraft, type ProjectContactSource } from '@/lib/contacts';
import type { Contact, Supplier } from '@/lib/types';
import ContactsView from './ContactsView';

interface Props {
    showMessage: (text: string, type: 'success' | 'error') => void;
}

export default function ContactsSection({ showMessage }: Props) {
    const { organization } = useAuth();
    const orgId = organization?.Organization_ID || '';

    const [contacts, setContacts] = useState<Contact[]>([]);
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [projects, setProjects] = useState<ProjectContactSource[]>([]);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        if (!orgId) return;
        try {
            const [c, s, p] = await Promise.all([getContacts(orgId), getSuppliers(orgId), getProjectContactSources(orgId)]);
            setContacts(c);
            setSuppliers(s);
            setProjects(p);
        } catch (e) {
            console.error('Kontakti: učitavanje nije uspjelo', e);
            showMessage('Učitavanje kontakata nije uspjelo.', 'error');
        } finally {
            setLoading(false);
        }
    }, [orgId, showMessage]);

    useEffect(() => { load(); }, [load]);

    const candidates = useMemo(() => importCandidates(suppliers, projects, contacts), [suppliers, projects, contacts]);
    const projectOptions = useMemo(() => projects
        .filter(p => !p.Hidden)
        .map(p => ({ Project_ID: p.Project_ID, label: p.Name || p.Client_Name || 'Projekat' }))
        .sort((a, b) => a.label.localeCompare(b.label, 'bs')), [projects]);

    async function onSave(contact: Partial<Contact>): Promise<boolean> {
        const result = await saveContact(contact, orgId);
        if (!result.success) { showMessage(result.message, 'error'); return false; }
        // Jedan glavni kontakt po dobavljaču: stari ★ se skida.
        const stale = staleDefaults(contacts, { Contact_ID: result.data!.Contact_ID, Supplier_ID: contact.Supplier_ID, Is_Default: contact.Is_Default });
        await Promise.all(stale.map(c => saveContact({ Contact_ID: c.Contact_ID, Email: c.Email, Is_Default: false }, orgId)));
        await load();
        return true;
    }

    async function onDelete(contact: Contact) {
        const result = await deleteContact(contact.Contact_ID, orgId);
        showMessage(result.message, result.success ? 'success' : 'error');
        await load();
    }

    async function onImport(drafts: ContactDraft[]) {
        const result = await saveContacts(drafts, orgId);
        showMessage(result.message, result.success ? 'success' : 'error');
        await load();
    }

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
        />
    );
}
