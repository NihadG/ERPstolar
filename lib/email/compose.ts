// ════════════════════════════════════════════════════════════════════
// SASTAV MAILA PO TVOM OBRASCU — čisto, bez modela
//
// Iz tvoje poslane pošte:
//   naslov   „<Vrsta> <predmet> <projekat> LUXCO"   („Dodatna ogledala za Crni Vrh LUXCO")
//   prilog   isto ime kao naslov + .pdf
//   pozdrav  „Pozdrav Lejla," s poznatima (ti), „Poštovani," s ostalima (vi)
//   tijelo   jedna-dvije rečenice („U prilogu možeš pronaći narudžbu …")
//   potpis   uvijek isti blok
//
// ERP slaže naslov, prilog i potpis; model (PR 4) smije pisati samo tijelo.
// ════════════════════════════════════════════════════════════════════

import { fold } from '../command/search';
import type { Contact, Order } from '../types';

const LEGAL = /\b(d\.?\s?o\.?\s?o|d\.?\s?d|gmbh|ltd|s\.?\s?p|obrt)\.?\b/gi;

/** „Lux-co d.o.o." → „LUXCO"; prazno kad firma nema imena. */
export function companyTag(companyName: string): string {
    return (companyName || '').replace(LEGAL, '').normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^A-Za-z0-9]+/g, '').toUpperCase().slice(0, 16);
}

/** Dodaje dijelove čije riječi se već ne vide u tekstu (bez kvačica i velikih slova). */
function joinNew(base: string, parts: string[]): string {
    let out = base.trim();
    for (const p of parts.map(s => (s || '').trim()).filter(Boolean)) {
        const have = new Set(fold(out).split(' '));
        if (!fold(p).split(' ').every(w => have.has(w))) out = `${out} ${p}`;
    }
    return out.replace(/\s+/g, ' ').trim();
}

/**
 * „Narudžba ogledala Crni Vrh LUXCO". Naziv narudžbe ima prednost pred brojem;
 * projekti i oznaka firme se dodaju samo ako ih naziv već ne sadrži.
 */
export function orderSubject(order: Pick<Order, 'Name' | 'Order_Number'>, projectNames: string[], tag: string): string {
    const name = (order.Name || '').trim();
    const what = name
        ? (/^narud[zž]b/i.test(name) ? name : `Narudžba ${name.charAt(0).toLowerCase()}${name.slice(1)}`)
        : `Narudžba ${order.Order_Number}`;
    return joinNew(what, [...projectNames.slice(0, 2), tag]);
}

/** Ime priloga = naslov (bez znakova koje sistemi fajlova ne vole). */
export function attachmentName(subject: string, ext = 'pdf'): string {
    const base = subject.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Prilog';
    return `${base}.${ext}`;
}

export type AddressForm = 'ti' | 'vi';

/** Obraćanje: upisano na kontaktu, inače „ti" kad znamo ime, „vi" kad ne znamo. */
export function addressFormFor(contact?: Pick<Contact, 'Address_Form' | 'First_Name'>): AddressForm {
    if (contact?.Address_Form) return contact.Address_Form;
    return contact?.First_Name?.trim() ? 'ti' : 'vi';
}

export function greeting(contact?: Pick<Contact, 'Address_Form' | 'First_Name'>): string {
    const name = contact?.First_Name?.trim();
    return addressFormFor(contact) === 'ti' && name ? `Pozdrav ${name},` : 'Poštovani,';
}

/** Tijelo narudžbe po obraćanju; rok isporuke se traži samo kad ga nema. */
export function orderBody(order: Pick<Order, 'Order_Number' | 'Expected_Delivery'>, form: AddressForm): string {
    const hasDue = !!(order.Expected_Delivery || '').trim();
    if (form === 'ti') {
        return `U prilogu možeš pronaći narudžbu ${order.Order_Number}.${hasDue ? '' : ' Javi mi rok isporuke kad budeš znao.'}`;
    }
    return `U prilogu Vam dostavljamo narudžbu ${order.Order_Number}.${hasDue ? '' : ' Molimo potvrdu i rok isporuke.'}`;
}

/** Zadani potpis kad korisnik nije upisao svoj. */
export function defaultSignature(name: string, phone?: string): string {
    return ['Srdačno,', '', [name, phone].map(s => (s || '').trim()).filter(Boolean).join('\n')].join('\n').trim();
}

/** Pozdrav + tijelo + potpis, razmaknuti praznim redom. */
export function composeText(parts: { greeting: string; body: string; signature: string }): string {
    return [parts.greeting, parts.body.trim(), parts.signature.trim()].filter(Boolean).join('\n\n');
}
