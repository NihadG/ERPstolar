// ════════════════════════════════════════════════════════════════════
// KONTAKTI — čista logika (bez Firestorea, koristi je i ERP i bot)
//
//   • normalizacija adrese, ime/prezime, firma
//   • uvoz iz postojećih polja (Supplier.Email, Project.Client_Email)
//   • pretraga i grupisanje po firmi za tabelu u Postavkama
//   • IZBOR PRIMAOCA: kome ide narudžba / ponuda / situacija i ko je u kopiji
//   • prepoznavanje pošiljaoca ulazne pošte (adresa, pa domen firme)
//
// Primalac se bira OVDJE, deterministički — model nikad ne izmišlja adresu.
// ════════════════════════════════════════════════════════════════════

import type {
    Contact, ContactCopyOn, ContactKind, ContactProjectRole, Project, Supplier,
} from './types';
import { fold, queryTokens } from './command/search';

// ── Adrese ───────────────────────────────────────────────────────────

/** „Ime <a@b.ba>", „mailto:A@B.ba " → „a@b.ba". */
export function normalizeEmail(raw: string): string {
    const text = (raw || '').trim();
    const angle = text.match(/<([^<>]+)>/);
    return (angle ? angle[1] : text).trim().toLowerCase().replace(/^mailto:/, '');
}

export function isValidEmail(raw: string): boolean {
    return /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/.test(normalizeEmail(raw));
}

/** „a@x.ba; b@x.ba, c@x.ba" → ispravne i jedinstvene adrese, istim redom. */
export function splitEmails(raw: string): string[] {
    const found = (raw || '').split(/[;,\s]+/).map(normalizeEmail).filter(isValidEmail);
    return Array.from(new Set(found));
}

export function emailDomain(email: string): string {
    const e = normalizeEmail(email);
    return e.includes('@') ? e.slice(e.lastIndexOf('@') + 1) : '';
}

/** Domeni koje dijeli mnogo različitih ljudi — ne znače firmu. */
const SHARED_DOMAINS = new Set([
    'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'hotmail.com', 'outlook.com', 'live.com',
    'msn.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com',
    'bih.net.ba', 'blic.net', 'tel.net.ba', 'teol.net',
]);

export function isSharedMailDomain(email: string): boolean {
    return SHARED_DOMAINS.has(emailDomain(email));
}

// ── Imena ────────────────────────────────────────────────────────────

const COMPANY_WORD = /(^|[\s,])(d\.?o\.?o|gmbh|ltd|obrt|shk|studio|group|in[zž]enjering|company)(?=[\s.,]|$)/i;

export function looksLikeCompany(name: string): boolean {
    return COMPANY_WORD.test(name || '');
}

/** „Emir Hadžić" → Emir / Hadžić; „Ana Marija Horvat" → Ana Marija / Horvat. */
export function splitName(full: string): { first: string; last: string } {
    const parts = (full || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    if (parts.length === 0) return { first: '', last: '' };
    if (parts.length === 1) return { first: parts[0], last: '' };
    return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
}

export function contactFullName(c: Pick<Contact, 'First_Name' | 'Last_Name' | 'Email'>): string {
    return [c.First_Name, c.Last_Name].map(s => (s || '').trim()).filter(Boolean).join(' ') || c.Email;
}

/** „Emir Hadžić (komercijalista)" — za dugmad i poruke. */
export function contactLabel(c: Contact): string {
    return c.Role ? `${contactFullName(c)} (${c.Role})` : contactFullName(c);
}

/** Zaglavlje „Kome": `"Emir Hadžić" <emir@x.ba>`. */
export function formatAddress(c: Pick<Contact, 'First_Name' | 'Last_Name' | 'Email'>): string {
    const name = [c.First_Name, c.Last_Name].map(s => (s || '').trim()).filter(Boolean).join(' ').replace(/["<>\\]/g, '');
    return name ? `"${name}" <${normalizeEmail(c.Email)}>` : normalizeEmail(c.Email);
}

export function contactCompany(c: Contact, supplierName?: (id: string) => string | undefined): string {
    return (c.Supplier_ID && supplierName?.(c.Supplier_ID)) || c.Company || '';
}

// ── Uvoz iz postojećih polja ─────────────────────────────────────────

export type ContactDraft = Omit<Contact, 'Contact_ID' | 'Organization_ID' | 'Created_At'>;

export interface ImportCandidate {
    draft: ContactDraft;
    /** Odakle dolazi, za prikaz: „Dobavljač: Frischeis". */
    source: string;
    /** false = u listi uvoza nije unaprijed štikliran (npr. jedan mail nepoznatoj adresi). */
    preselect?: boolean;
}

export type ProjectContactSource = Pick<Project, 'Project_ID' | 'Client_Name' | 'Client_Email' | 'Client_Phone'> & Partial<Pick<Project, 'Name' | 'Hidden'>>;
export type SupplierContactSource = Pick<Supplier, 'Supplier_ID' | 'Name' | 'Contact_Person' | 'Phone' | 'Email'>;

/**
 * Prijedlog kontakata iz Supplier.Email/Contact_Person i Project.Client_Email/Client_Name.
 * Adrese koje već postoje (ili se ponavljaju) se preskaču. Glavni (★) postaje prva
 * nova adresa dobavljača koji još nema glavnog kontakta.
 */
export function importCandidates(
    suppliers: SupplierContactSource[],
    projects: ProjectContactSource[],
    existing: Contact[],
): ImportCandidate[] {
    const seen = new Set(existing.map(c => normalizeEmail(c.Email)));
    const hasDefault = new Set(existing.filter(c => c.Is_Default && c.Supplier_ID).map(c => c.Supplier_ID!));
    const out: ImportCandidate[] = [];

    const sortedSuppliers = [...suppliers].sort((a, b) => (a.Name || '').localeCompare(b.Name || '', 'bs'));
    for (const s of sortedSuppliers) {
        const emails = splitEmails(s.Email || '').filter(e => !seen.has(e));
        const person = (s.Contact_Person || '').trim();
        emails.forEach((email, i) => {
            seen.add(email);
            const name = emails.length === 1 && person && !looksLikeCompany(person) ? splitName(person) : { first: '', last: '' };
            const makeDefault = i === 0 && !hasDefault.has(s.Supplier_ID);
            if (makeDefault) hasDefault.add(s.Supplier_ID);
            out.push({
                source: `Dobavljač: ${s.Name}`,
                draft: {
                    First_Name: name.first, Last_Name: name.last, Email: email,
                    Phone: s.Phone?.trim() || undefined,
                    Kind: 'supplier', Supplier_ID: s.Supplier_ID,
                    Is_Default: makeDefault || undefined,
                    Address_Form: undefined,
                },
            });
        });
    }

    const sortedProjects = [...projects].filter(p => !p.Hidden)
        .sort((a, b) => (a.Client_Name || '').localeCompare(b.Client_Name || '', 'bs'));
    for (const p of sortedProjects) {
        const emails = splitEmails(p.Client_Email || '').filter(e => !seen.has(e));
        const person = (p.Client_Name || '').trim();
        emails.forEach(email => {
            seen.add(email);
            const company = person && looksLikeCompany(person);
            const name = emails.length === 1 && person && !company ? splitName(person) : { first: '', last: '' };
            out.push({
                source: `Projekat: ${p.Name || p.Client_Name || '—'}`,
                draft: {
                    First_Name: name.first, Last_Name: name.last, Email: email,
                    Phone: p.Client_Phone?.trim() || undefined,
                    Company: company ? person : undefined,
                    Kind: 'client',
                    Project_Roles: [{ Project_ID: p.Project_ID, Role: 'kupac' }],
                },
            });
        });
    }
    return out;
}

// ── Pretraga i grupisanje ────────────────────────────────────────────

export const KIND_LABELS: Record<ContactKind, string> = {
    supplier: 'Dobavljači',
    client: 'Klijenti',
    site: 'Gradilište',
    internal: 'Interno',
    other: 'Ostalo',
};

export const PROJECT_ROLE_LABELS: Record<ContactProjectRole, string> = {
    kupac: 'Kupac',
    investitor: 'Investitor',
    nadzor: 'Nadzor',
    finansije: 'Finansije',
    projektant: 'Projektant',
    izvodjac: 'Izvođač',
};

export type SupplierNameFn = (id: string) => string | undefined;

/** Svi tokeni upita moraju biti u imenu, adresi, firmi, ulozi ili telefonu (bez kvačica). */
export function filterContacts(
    contacts: Contact[],
    opts: { kind?: ContactKind | 'all'; query?: string; supplierName?: SupplierNameFn },
): Contact[] {
    const kind = opts.kind && opts.kind !== 'all' ? opts.kind : null;
    const tokens = queryTokens(opts.query || '');
    return contacts.filter(c => {
        if (kind && c.Kind !== kind) return false;
        if (!tokens.length) return true;
        const hay = fold([c.First_Name, c.Last_Name, c.Email, c.Phone, c.Role, contactCompany(c, opts.supplierName)].join(' '));
        return tokens.every(t => hay.includes(t));
    });
}

export interface ContactGroup {
    key: string;
    /** Prazno = kontakti bez firme. */
    company: string;
    kind: ContactKind;
    supplierId?: string;
    contacts: Contact[];
}

const byPerson = (a: Contact, b: Contact) =>
    Number(!!b.Is_Default) - Number(!!a.Is_Default)
    || Number(!!a.Receive_Only) - Number(!!b.Receive_Only)
    || (a.Last_Name || '').localeCompare(b.Last_Name || '', 'bs')
    || (a.First_Name || '').localeCompare(b.First_Name || '', 'bs')
    || a.Email.localeCompare(b.Email);

/** Po firmi (dobavljač iz ERP-a ili upisana firma); glavni kontakt prvi, bez firme na kraju. */
export function groupContacts(contacts: Contact[], supplierName?: SupplierNameFn): ContactGroup[] {
    const groups = new Map<string, ContactGroup>();
    for (const c of contacts) {
        const company = contactCompany(c, supplierName);
        const key = c.Supplier_ID ? `s:${c.Supplier_ID}` : company ? `c:${fold(company)}` : 'none';
        const group = groups.get(key) || { key, company, kind: c.Kind, supplierId: c.Supplier_ID, contacts: [] };
        group.contacts.push(c);
        groups.set(key, group);
    }
    return Array.from(groups.values())
        .map(g => ({ ...g, contacts: g.contacts.sort(byPerson) }))
        .sort((a, b) => (a.key === 'none' ? 1 : 0) - (b.key === 'none' ? 1 : 0)
            || a.company.localeCompare(b.company, 'bs'));
}

export function contactCountBySupplier(contacts: Contact[]): Map<string, number> {
    const counts = new Map<string, number>();
    contacts.forEach(c => { if (c.Supplier_ID) counts.set(c.Supplier_ID, (counts.get(c.Supplier_ID) || 0) + 1); });
    return counts;
}

/** Ista adresa dvaput? Vraća postojeći kontakt (osim onog koji se upravo mijenja). */
export function duplicateOf(contacts: Contact[], email: string, ignoreId?: string): Contact | undefined {
    const e = normalizeEmail(email);
    return e ? contacts.find(c => normalizeEmail(c.Email) === e && c.Contact_ID !== ignoreId) : undefined;
}

// ── Izbor primaoca ───────────────────────────────────────────────────

export type RecipientPurpose = 'order' | ContactCopyOn | 'general';

export type RecipientResult =
    | { status: 'ok'; to: Contact; cc: Contact[] }
    | { status: 'choose'; candidates: Contact[]; cc: Contact[] }
    | { status: 'none'; cc: Contact[] };

/** Koja uloga na projektu prima šta — prva koja ima ikoga pobjeđuje. */
const ROLES_FOR: Partial<Record<RecipientPurpose, ContactProjectRole[]>> = {
    offer: ['kupac', 'investitor'],
    invoice: ['kupac', 'finansije', 'investitor'],
    situation: ['finansije'],
};

const usable = (c: Contact) => !c.Receive_Only && isValidEmail(c.Email);

/**
 * Kome ide mail:
 *  • narudžba → kontakti dobavljača (★ glavni; jedini; više → izbor)
 *  • ponuda / račun / situacija → kontakti projekta po ulozi (ROLES_FOR)
 *  • kopija → svako ko ima tu vrstu u Copy_On (ured); ako kontakt ima uloge na
 *    projektima, kopija vrijedi samo za te projekte
 */
export function resolveRecipient(
    contacts: Contact[],
    req: { purpose: RecipientPurpose; supplierId?: string; projectId?: string },
): RecipientResult {
    const people = contacts.filter(usable);
    let pool: Contact[] = [];

    if (req.purpose === 'order' || (req.purpose === 'general' && req.supplierId)) {
        pool = req.supplierId ? people.filter(c => c.Supplier_ID === req.supplierId) : [];
    } else if (req.projectId) {
        const onProject = (c: Contact, roles: ContactProjectRole[]) =>
            (c.Project_Roles || []).some(r => r.Project_ID === req.projectId && roles.includes(r.Role));
        const roles = ROLES_FOR[req.purpose] || [];
        for (const role of roles) {
            pool = people.filter(c => onProject(c, [role]));
            if (pool.length) break;
        }
        if (!roles.length) pool = people.filter(c => (c.Project_Roles || []).some(r => r.Project_ID === req.projectId));
    }

    const copyOn = req.purpose === 'general' ? null : req.purpose as ContactCopyOn;
    const ccFor = (to?: Contact) => !copyOn ? [] : contacts.filter(c => {
        if (!isValidEmail(c.Email) || !c.Copy_On?.includes(copyOn)) return false;
        if (to && normalizeEmail(c.Email) === normalizeEmail(to.Email)) return false;
        const roles = c.Project_Roles || [];
        return !roles.length || !req.projectId || roles.some(r => r.Project_ID === req.projectId);
    });

    if (pool.length === 0) return { status: 'none', cc: ccFor() };
    const defaults = pool.filter(c => c.Is_Default);
    if (defaults.length === 1) return { status: 'ok', to: defaults[0], cc: ccFor(defaults[0]) };
    if (pool.length === 1) return { status: 'ok', to: pool[0], cc: ccFor(pool[0]) };
    return { status: 'choose', candidates: (defaults.length > 1 ? defaults : pool).sort(byPerson), cc: ccFor() };
}

// ── Ulazna pošta ─────────────────────────────────────────────────────

export interface SenderMatch {
    /** Ista adresa. */
    contact?: Contact;
    /** Druga adresa iste firme (samo za domene firme, ne gmail.com i slične). */
    viaDomain?: Contact;
}

export function matchSender(contacts: Contact[], email: string): SenderMatch {
    const e = normalizeEmail(email);
    if (!e) return {};
    const contact = contacts.find(c => normalizeEmail(c.Email) === e);
    if (contact) return { contact };
    if (isSharedMailDomain(e)) return {};
    const domain = emailDomain(e);
    const sameDomain = contacts.filter(c => emailDomain(c.Email) === domain);
    return { viaDomain: sameDomain.find(c => c.Supplier_ID) || sameDomain[0] };
}

// ── Glavni kontakt ───────────────────────────────────────────────────

/** Jedna ★ po dobavljaču: kad `saved` postane glavni, ovi gube oznaku. */
export function staleDefaults(contacts: Contact[], saved: Pick<Contact, 'Contact_ID' | 'Supplier_ID' | 'Is_Default'>): Contact[] {
    if (!saved.Is_Default || !saved.Supplier_ID) return [];
    return contacts.filter(c => c.Supplier_ID === saved.Supplier_ID && c.Is_Default && c.Contact_ID !== saved.Contact_ID);
}

/**
 * Pri uvozu iz više izvora (polja ERP-a + pošta) isti dobavljač može dobiti ★
 * dvaput: ostaje prva, a nijedna ako dobavljač već ima glavnog kontakta.
 */
export function singleDefaults<T extends Pick<Contact, 'Supplier_ID' | 'Is_Default'>>(drafts: T[], existing: Contact[]): T[] {
    const taken = new Set(existing.filter(c => c.Is_Default && c.Supplier_ID).map(c => c.Supplier_ID!));
    return drafts.map(d => {
        if (!d.Is_Default || !d.Supplier_ID) return d;
        if (taken.has(d.Supplier_ID)) return { ...d, Is_Default: undefined };
        taken.add(d.Supplier_ID);
        return d;
    });
}

// ── Traženje osobe po imenu (bot: „pošalji Amri", „mail Lejli iz Projekta") ──

/**
 * Kontakti koji odgovaraju upitu: tačna adresa; inače svi tokeni u imenu, firmi,
 * ulozi ili adresi; ako ništa, isto preko osnove riječi („Lejli" → lejl…).
 * Adrese koje samo šalju (računi) nikad nisu primaoci.
 */
export function searchContacts(contacts: Contact[], query: string, supplierName?: SupplierNameFn): Contact[] {
    const people = contacts.filter(c => !c.Receive_Only && isValidEmail(c.Email));
    const q = normalizeEmail(query);
    if (isValidEmail(q)) return people.filter(c => normalizeEmail(c.Email) === q);
    const exact = filterContacts(people, { query, supplierName });
    if (exact.length || !queryTokens(query).length) return exact;
    const stems = queryTokens(query).map(stemOf);
    return people.filter(c => {
        const words = fold([c.First_Name, c.Last_Name, c.Role, contactCompany(c, supplierName), c.Email.split('@')[0]].join(' ')).split(' ').map(stemOf);
        return stems.every(s => words.some(w => w.startsWith(s) || s.startsWith(w) && w.length >= 3));
    });
}

/** Osnova riječi za padeže (Amri → amr, Lejli → lejl, Hadžiću → hadzic). */
function stemOf(word: string): string {
    const w = word.toLowerCase();
    for (const suf of ['ovima', 'evima', 'ima', 'ama', 'om', 'em', 'u', 'i', 'a', 'e', 'o']) {
        if (w.length - suf.length >= 3 && w.endsWith(suf)) return w.slice(0, -suf.length);
    }
    return w;
}
