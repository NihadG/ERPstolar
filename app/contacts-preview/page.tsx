'use client';

// ════════════════════════════════════════════════════════════════════
// /contacts-preview — PRAVI prikaz Kontakata (Postavke) nad izmišljenim podacima
//
// Postavke su iza prijave, pa se ovdje vidi tabela kakva će biti: dobavljač s pet
// adresa (komercijalista, referent, adresa samo za račune), gradilište s ulogama,
// uvoz iz dobavljača i projekata. Svi podaci su izmišljeni (domene .example).
// Upis je u memoriji. ?w=380 suzi okvir kao na telefonu; ?empty=1 prazno stanje;
// ?gmail=off|on|expired|none stanje Gmail kartice (zadano: on).
// U produkciji ruta ne postoji.
// ════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import { notFound } from 'next/navigation';
import ContactsView from '@/components/settings/ContactsView';
import GmailCard, { type GmailBusy, type GmailState } from '@/components/settings/GmailCard';
import { importCandidates, normalizeEmail, singleDefaults, staleDefaults, type ImportCandidate } from '@/lib/contacts';
import { gmailContactCandidates } from '@/lib/email/gmailContacts';
import type { Contact } from '@/lib/types';

const GMAIL: Record<string, GmailState> = {
    none: { configured: false, connected: false, email: null, sendAs: null, status: null },
    off: { configured: true, connected: false, email: null, sendAs: null, status: null },
    expired: { configured: true, connected: true, email: 'ja@luxco-demo.example', sendAs: 'ja@luxco-demo.example', status: 'reconnect' },
    on: { configured: true, connected: true, email: 'ja@luxco-demo.example', sendAs: 'ja@luxco-demo.example', status: 'ok' },
};

/** Izmišljena poslana pošta — šta bi /api/email/google/contacts pročitao. */
const SENT = [
    { to: '"Emir Hadžić" <emir.hadzic@ploce-demo.example>', date: '2026-10-22T08:00:00Z', snippet: 'Pozdrav Emire, potvrđujem' },
    { to: 'Amra Delić <amra.delic@staklo-demo.example>', date: '2026-10-14T08:00:00Z', snippet: 'Pozdrav Amra, u prilogu je narudžba' },
    { to: 'Amra Delić <amra.delic@staklo-demo.example>', date: '2026-09-30T08:00:00Z', snippet: 'Hvala Amra' },
    { to: 'Mirza Avdić <mirza.avdic@staklo-demo.example>', date: '2026-10-02T08:00:00Z', snippet: 'Pozdrav Mirza' },
    { to: 'Dario Pilav <dario.pilav@boja-demo.example>', date: '2026-10-19T07:00:00Z', snippet: 'Poštovani,', cc: 'ured@luxco-demo.example' },
    { to: 'Lejla Kapetanović <lejla.k@hotel-demo.example>', date: '2026-10-11T07:00:00Z', snippet: 'Poštovana,' },
    { to: 'Lejla Kapetanović <lejla.k@hotel-demo.example>', date: '2026-10-16T07:00:00Z', snippet: 'Poštovana,' },
    { to: 'jednom@nepoznato.example', date: '2026-08-01T07:00:00Z', snippet: 'Šaljem' },
    { to: 'no-reply@banka.example', date: '2026-10-01T07:00:00Z' },
];

export const dynamic = 'force-dynamic';

const c = (id: string, first: string, last: string, email: string, extra: Partial<Contact> = {}): Contact => ({
    Contact_ID: id, Organization_ID: 'demo', First_Name: first, Last_Name: last, Email: email,
    Kind: 'supplier', Created_At: '2026-10-29T08:00:00Z', ...extra,
});

const SUPPLIERS = [
    { Supplier_ID: 's-ploce', Name: 'Ploče Demo', Contact_Person: '', Phone: '', Email: '' },
    { Supplier_ID: 's-staklo', Name: 'Staklo Demo', Contact_Person: 'Amra Delić', Phone: '033 111 222', Email: 'amra.delic@staklo-demo.example' },
    { Supplier_ID: 's-okovi', Name: 'Okovi Demo', Contact_Person: '', Phone: '', Email: 'info@okovi-demo.example' },
    { Supplier_ID: 's-boje', Name: 'Boje Demo', Contact_Person: 'Nedim Šabić', Phone: '', Email: 'nedim.sabic@boje-demo.example' },
    { Supplier_ID: 's-bez', Name: 'Dobavljač bez maila', Contact_Person: '', Phone: '', Email: '' },
];

const PROJECTS = [
    { Project_ID: 'p-plaza', Name: 'Park Plaza', Client_Name: 'Plaza Invest', Client_Email: '', Client_Phone: '' },
    { Project_ID: 'p-kuca', Name: 'Kuća faza 2', Client_Name: 'Adnan Kovač', Client_Email: 'adnan.kovac@kuca-demo.example', Client_Phone: '061 222 333' },
    { Project_ID: 'p-kuhinje', Name: 'Kuhinje', Client_Name: 'Boja Demo d.o.o.', Client_Email: 'dario.pilav@boja-demo.example', Client_Phone: '' },
];

const SEED: Contact[] = [
    c('1', 'Emir', 'Hadžić', 'emir.hadzic@ploce-demo.example', { Supplier_ID: 's-ploce', Role: 'komercijalista', Is_Default: true, Address_Form: 'ti', Last_Emailed_At: '2026-10-12T09:00:00Z' }),
    c('2', 'Lamija', 'Begić', 'lamija.begic@ploce-demo.example', { Supplier_ID: 's-ploce', Role: 'komercijalista' }),
    c('3', 'Alen', 'Softić', 'alen.softic@ploce-demo.example', { Supplier_ID: 's-ploce', Role: 'referent prodaje' }),
    c('4', 'Zlatan', 'Hodžić', 'zlatan.hodzic@ploce-demo.example', { Supplier_ID: 's-ploce', Role: 'knjigovodstvo' }),
    c('5', '', '', 'racuni@ploce-demo.example', { Supplier_ID: 's-ploce', Role: 'računi (automatski)', Receive_Only: true }),
    c('6', 'Selma', 'Ribić', 'selma.ribic@projekt-demo.example', { Kind: 'site', Company: 'Projekt Demo', Role: 'koordinacija', Address_Form: 'ti', Project_Roles: [{ Project_ID: 'p-plaza', Role: 'projektant' }] }),
    c('7', 'Tarik', 'Mujić', 'tarik.mujic@projekt-demo.example', { Kind: 'site', Company: 'Projekt Demo', Project_Roles: [{ Project_ID: 'p-plaza', Role: 'projektant' }], Copy_On: ['offer'] }),
    c('8', 'Ismet', 'Kurtović', 'ismet.kurtovic@plaza-invest.example', { Kind: 'site', Company: 'Plaza Invest', Role: 'investitor', Project_Roles: [{ Project_ID: 'p-plaza', Role: 'investitor' }] }),
    c('9', 'Jasmina', 'Zukić', 'jasmina.zukic@plaza-invest.example', { Kind: 'site', Company: 'Plaza Invest', Role: 'finansije', Project_Roles: [{ Project_ID: 'p-plaza', Role: 'finansije' }], Copy_On: ['offer', 'situation'] }),
    c('10', 'Haris', 'Omerović', 'haris.omerovic@nadzor-demo.example', { Kind: 'site', Company: 'Nadzor Demo', Role: 'građevinski inženjer', Project_Roles: [{ Project_ID: 'p-plaza', Role: 'nadzor' }] }),
    c('11', 'Nermin', 'Čaušević', 'nermin.causevic@situacije-demo.example', { Kind: 'site', Company: 'Situacije Demo', Role: 'situacije', Project_Roles: [{ Project_ID: 'p-plaza', Role: 'finansije' }] }),
    c('12', 'Ured', '', 'ured@luxco-demo.example', { Kind: 'internal', Company: 'LUX CO', Role: 'ured', Copy_On: ['order', 'offer', 'invoice'] }),
    c('13', 'Samir', 'Duraković', 'samir@luxco-demo.example', { Kind: 'internal', Company: 'LUX CO' }),
    c('14', 'Ivan', 'Petersen', 'ivan@dizajn-demo.example', { Kind: 'client', Company: 'Dizajn Demo', Address_Form: 'ti' }),
];

export default function ContactsPreview() {
    if (process.env.NODE_ENV === 'production') notFound();
    const [width, setWidth] = useState<number | null>(null);
    const [contacts, setContacts] = useState<Contact[]>(SEED);
    const [mounted, setMounted] = useState(false);
    const [gmail, setGmail] = useState<GmailState>(GMAIL.on);
    const [busy, setBusy] = useState<GmailBusy>(null);
    const [fromMail, setFromMail] = useState<ImportCandidate[]>([]);
    const [scanned, setScanned] = useState<number | null>(null);
    const [reveal, setReveal] = useState(0);

    useEffect(() => {
        const q = new URLSearchParams(window.location.search);
        const w = Number(q.get('w'));
        if (w > 0) setWidth(w);
        if (q.get('empty')) setContacts([]);
        if (GMAIL[q.get('gmail') || '']) setGmail(GMAIL[q.get('gmail')!]);
        setMounted(true);
    }, []);

    const candidates = useMemo(() => {
        const own = importCandidates(SUPPLIERS, PROJECTS, contacts);
        const known = new Set([...contacts.map(c => normalizeEmail(c.Email)), ...own.map(c => c.draft.Email)]);
        return [...own, ...fromMail.filter(c => !known.has(c.draft.Email))];
    }, [contacts, fromMail]);

    async function onSuggest() {
        setBusy('suggest');
        await new Promise(r => setTimeout(r, 400));
        const list = gmailContactCandidates(SENT, { own: ['ja@luxco-demo.example', 'ured@luxco-demo.example'], contacts, suppliers: SUPPLIERS });
        setFromMail(list);
        setScanned(SENT.length);
        if (list.length) setReveal(n => n + 1);
        setBusy(null);
    }

    async function onSave(patch: Partial<Contact>) {
        setContacts(prev => {
            const email = normalizeEmail(patch.Email || '');
            const id = patch.Contact_ID || `new-${prev.length + 1}`;
            const next = patch.Contact_ID
                ? prev.map(x => {
                    if (x.Contact_ID !== id) return x;
                    const merged = { ...x, ...patch, Email: email || x.Email } as Contact;
                    (Object.keys(patch) as (keyof Contact)[]).forEach(k => { if (patch[k] === undefined) delete merged[k]; });
                    return merged;
                })
                : [...prev, { Kind: 'other', First_Name: '', Last_Name: '', Created_At: new Date().toISOString(), ...patch, Contact_ID: id, Organization_ID: 'demo', Email: email } as Contact];
            const stale = new Set(staleDefaults(next, next.find(x => x.Contact_ID === id)!).map(x => x.Contact_ID));
            return next.map(x => stale.has(x.Contact_ID) ? { ...x, Is_Default: false } : x);
        });
        return true;
    }

    async function onDelete(contact: Contact) {
        setContacts(prev => prev.filter(x => x.Contact_ID !== contact.Contact_ID));
    }

    async function onImport(drafts: Omit<Contact, 'Contact_ID' | 'Organization_ID' | 'Created_At'>[]) {
        setContacts(prev => [...prev, ...singleDefaults(drafts, prev).map((d, i) => ({
            ...d, Contact_ID: `imp-${prev.length + i}`, Organization_ID: 'demo', Created_At: new Date().toISOString(),
        }))]);
    }

    // Redoslijed po bs abecedi zna se razlikovati između Node-a i preglednika — crtaj tek u pregledniku.
    if (!mounted) return null;

    return (
        <div style={{ background: 'var(--surface)', minHeight: '100vh', padding: width ? 12 : 28 }}>
            <div style={{ maxWidth: width ?? 1180, margin: '0 auto' }}>
                <ContactsView
                    contacts={contacts}
                    suppliers={SUPPLIERS}
                    projects={PROJECTS.map(p => ({ Project_ID: p.Project_ID, label: p.Name }))}
                    candidates={candidates}
                    onSave={onSave}
                    onDelete={onDelete}
                    onImport={onImport}
                    revealImport={reveal}
                    top={
                        <GmailCard
                            state={gmail} busy={busy}
                            lastScan={scanned === null ? null : { scanned, found: candidates.filter(c => c.source.startsWith('Gmail')).length }}
                            onConnect={() => setGmail(GMAIL.on)}
                            onDisconnect={() => { setGmail(GMAIL.off); setFromMail([]); setScanned(null); }}
                            onSuggest={onSuggest}
                            onSendAs={async email => setGmail(g => ({ ...g, sendAs: email }))}
                        />
                    }
                />
            </div>
        </div>
    );
}
