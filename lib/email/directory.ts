// ════════════════════════════════════════════════════════════════════
// IMENIK POŠTE — ljudi kojima si pisao, bez ručnih Kontakata (čisto)
//
// Kontakti su ručno uređen spisak; imenik je rezerva koju ERP vodi sam:
// svi kojima si pisao (Kome/Kopija poslanih mailova), s imenom iz
// zaglavlja, brojem mailova i zadnjim datumom. Kad i oni pišu tebi, ime
// i datum se osvježe. Bot tako „Merimi" nađe adresu i kad Kontakti
// nisu uvezeni, a ulazna pošta zna da je pošiljalac poznat.
//
// Učitavanje i čuvanje: lib/server/mailDirectory.ts (mail_people/{uid}).
// ════════════════════════════════════════════════════════════════════

import type { Contact } from '../types';
import { normalizeEmail, searchContacts, splitName } from '../contacts';
import { parseAddressList, parseMailbox } from './addresses';

export interface MailPerson {
    Email: string;
    Name?: string;
    /** Koliko mailova (poslanih njemu i primljenih od njega). */
    Count: number;
    /** ISO, zadnji mail. */
    Last_At: string;
}

export interface MailHeaders {
    to?: string;
    cc?: string;
    from?: string;
    /** ISO datum. */
    date: string;
    /** Poslao si ti (Kome/Kopija su ljudi); inače je čovjek pošiljalac. */
    sent: boolean;
}

export const MAX_PEOPLE = 400;
const AUTOMATED = /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|notifications?|bounce|info-?noreply)/i;

/**
 * Spoji zaglavlja u imenik. Primljeni mail dodaje samo ljude koji su već u
 * imeniku ili su dozvoljeni (`allowSender`) — da promocije ne uđu.
 */
export function tallyPeople(
    messages: MailHeaders[],
    opts: { own: string[]; prev?: MailPerson[]; allowSender?: (email: string) => boolean },
): MailPerson[] {
    const own = new Set(opts.own.map(normalizeEmail));
    const people = new Map<string, MailPerson & { names: Map<string, number> }>();
    for (const p of opts.prev || []) people.set(p.Email, { ...p, names: new Map(p.Name ? [[p.Name, 1]] : []) });

    const add = (email: string, name: string | undefined, date: string, mayCreate: boolean) => {
        if (!email || own.has(email) || AUTOMATED.test(email)) return;
        let p = people.get(email);
        if (!p) {
            if (!mayCreate) return;
            p = { Email: email, Count: 0, Last_At: '', names: new Map() };
            people.set(email, p);
        }
        p.Count++;
        if (date > p.Last_At) p.Last_At = date;
        if (name && normalizeEmail(name) !== email) p.names.set(name, (p.names.get(name) || 0) + 1);
    };

    for (const m of messages) {
        if (m.sent) {
            [...parseAddressList(m.to || ''), ...parseAddressList(m.cc || '')].forEach(a => add(a.email, a.name, m.date, true));
        } else {
            const from = parseMailbox(m.from || '');
            if (from) add(from.email, from.name, m.date, !!opts.allowSender?.(from.email));
        }
    }

    return Array.from(people.values())
        .map(({ names, ...p }) => {
            const best = Array.from(names.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
            return { ...p, ...(best ? { Name: best } : p.Name ? { Name: p.Name } : {}) };
        })
        .sort((a, b) => b.Count - a.Count || b.Last_At.localeCompare(a.Last_At))
        .slice(0, MAX_PEOPLE);
}

/** Ljudi iz imenika po imenu, prezimenu (u padežu) ili adresi — isto pravilo kao Kontakti. */
export function searchPeople(people: MailPerson[], query: string): MailPerson[] {
    const asContacts: Contact[] = people.map(p => {
        const n = splitName(p.Name || '');
        return { Contact_ID: p.Email, Organization_ID: '', First_Name: n.first, Last_Name: n.last, Email: p.Email, Kind: 'other', Created_At: '' };
    });
    const byEmail = new Map(people.map(p => [p.Email, p]));
    return searchContacts(asContacts, query).map(c => byEmail.get(c.Email)!).filter(Boolean);
}
