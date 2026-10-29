// ════════════════════════════════════════════════════════════════════
// PRIJEDLOG KONTAKATA IZ POSLANE POŠTE
//
// Ulaz su samo zaglavlja i početak teksta poslanih mailova (Gmail metadata):
// kome si pisao, koliko puta, kad zadnji put i kako si ga pozdravio.
//
//   • adresa ide jednom, s najčešćim imenom iz zaglavlja
//   • domen poznatog dobavljača → kontakt tog dobavljača (★ najčešćem, ako
//     dobavljač još nema glavnog)
//   • „Pozdrav Lejla," / „Hvala Sakibe" → ti;  „Poštovani," → vi
//   • tvoje adrese, no-reply i postojeći kontakti se preskaču
//
// Ništa se ne upisuje samo — korisnik štiklira u tabeli uvoza.
// ════════════════════════════════════════════════════════════════════

import type { Contact } from '../types';
import {
    emailDomain, isSharedMailDomain, looksLikeCompany, normalizeEmail, splitEmails, splitName,
    type ImportCandidate, type SupplierContactSource,
} from '../contacts';
import { parseAddressList } from './addresses';

export interface SentMessageMeta {
    to: string;
    cc?: string;
    /** ISO datum slanja. */
    date: string;
    /** Početak teksta (Gmail snippet). */
    snippet?: string;
}

const AUTOMATED = /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|notifications?|bounce)/i;

/** „Pozdrav Lejla, …" → ti; „Poštovani, …" → vi; inače ne zna. */
export function addressFormOf(snippet: string): 'ti' | 'vi' | undefined {
    const start = (snippet || '').trim().toLowerCase().slice(0, 60);
    if (/^(po[sš]tovan|uva[zž]en|dear\b|gospo[dđ])/.test(start)) return 'vi';
    if (/^(pozdrav|zdravo|[cć]ao|hej|hi|hello|hvala)\s+[a-zčćžšđ]{2,}/.test(start)) return 'ti';
    return undefined;
}

const mails = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'mail' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'maila' : 'mailova');
const day = (iso: string) => {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? '' : `${d.getDate()}.${d.getMonth() + 1}.`;
};

interface Tally {
    email: string;
    names: Map<string, number>;
    count: number;
    last: string;
    ti: number;
    vi: number;
}

export function gmailContactCandidates(
    messages: SentMessageMeta[],
    opts: { own: string[]; contacts: Contact[]; suppliers: SupplierContactSource[]; limit?: number },
): ImportCandidate[] {
    const own = new Set(opts.own.map(normalizeEmail));
    const known = new Set(opts.contacts.map(c => normalizeEmail(c.Email)));

    // Domen firme → dobavljač (iz postojećih kontakata i iz Supplier.Email).
    const supplierByDomain = new Map<string, SupplierContactSource>();
    const byId = new Map(opts.suppliers.map(s => [s.Supplier_ID, s]));
    opts.contacts.forEach(c => {
        const s = c.Supplier_ID && byId.get(c.Supplier_ID);
        if (s && !isSharedMailDomain(c.Email)) supplierByDomain.set(emailDomain(c.Email), s);
    });
    opts.suppliers.forEach(s => splitEmails(s.Email || '').forEach(e => {
        if (!isSharedMailDomain(e) && !supplierByDomain.has(emailDomain(e))) supplierByDomain.set(emailDomain(e), s);
    }));

    const tallies = new Map<string, Tally>();
    for (const m of messages) {
        const to = parseAddressList(m.to);
        const all = [...to, ...parseAddressList(m.cc || '')];
        const form = to.length === 1 ? addressFormOf(m.snippet || '') : undefined;
        for (const a of all) {
            if (own.has(a.email) || known.has(a.email) || AUTOMATED.test(a.email)) continue;
            const t = tallies.get(a.email) || { email: a.email, names: new Map(), count: 0, last: '', ti: 0, vi: 0 };
            t.count++;
            if (m.date > t.last) t.last = m.date;
            if (a.name) t.names.set(a.name, (t.names.get(a.name) || 0) + 1);
            if (form && to[0].email === a.email) t[form]++;
            tallies.set(a.email, t);
        }
    }

    const hasDefault = new Set(opts.contacts.filter(c => c.Is_Default && c.Supplier_ID).map(c => c.Supplier_ID!));
    const sorted = Array.from(tallies.values()).sort((a, b) => b.count - a.count || b.last.localeCompare(a.last));

    return sorted.slice(0, opts.limit ?? 80).map(t => {
        const name = Array.from(t.names.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
        const company = name && looksLikeCompany(name);
        const person = name && !company ? splitName(name) : { first: '', last: '' };
        const supplier = supplierByDomain.get(emailDomain(t.email));
        const makeDefault = !!supplier && !hasDefault.has(supplier.Supplier_ID);
        if (makeDefault) hasDefault.add(supplier!.Supplier_ID);
        return {
            source: `Gmail: ${t.count} ${mails(t.count)}${t.last ? `, zadnji ${day(t.last)}` : ''}`,
            preselect: !!supplier || t.count >= 2,
            draft: {
                First_Name: person.first,
                Last_Name: person.last,
                Email: t.email,
                Company: company ? name : undefined,
                Kind: supplier ? 'supplier' : 'other',
                Supplier_ID: supplier?.Supplier_ID,
                Is_Default: makeDefault || undefined,
                Address_Form: t.ti > t.vi ? 'ti' : t.vi > t.ti ? 'vi' : undefined,
            },
        };
    });
}
