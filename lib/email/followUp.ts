// ════════════════════════════════════════════════════════════════════
// PRAĆENJE POŠTE — šta čeka tebe, podsjetnici i sažetak (čisto, bez AI-ja)
//
//   reply    mail upućen tebi s pitanjem/molbom, ili predračun za potvrdu
//            → podsjetnik za 1, 3 i 7 dana, dok ne odgovoriš (ERP vidi tvoj
//              odgovor u istoj niti) ili ne klikneš „Odgovorio sam"
//   pickup   „spremno / gotovo / za preuzimanje" → 1, 3 i 6 dana, dok se ne
//            preuzme (narudžba primljena ili dugme)
//   task     primjedbe / kompletiranje s gradilišta → 1, 3 i 7 dana
//
// Svaka 3 dana ujutro: sažetak — šta je završeno, šta čeka odgovor, šta je
// spremno a nije preuzeto. Sve odlučuju pravila; model se ne poziva.
// ════════════════════════════════════════════════════════════════════

import { fold } from '../command/search';
import { normalizeEmail } from '../contacts';
import { parseAddressList } from './addresses';
import type { ButtonRows } from '../telegram/api';
import type { MailFollow, MailInboxItem, MailKind } from '../types';

const DAY = 86_400_000;

/** Kad se podsjeća (dani od prijema). Poslije zadnjeg nema više podsjetnika. */
export const FOLLOW_DAYS: Record<MailFollow, number[]> = {
    reply: [1, 3, 7],
    pickup: [1, 3, 6],
    task: [1, 3, 7],
};

const ASKS = /(\b(molim\w*|mozete li|mozes li|da li|jel|je li|javite|javi|potvrdite|potvrdi|posaljite|posalji|dostavite|trebamo|treba nam|potrebno\w*|hitno|cekamo|ocekujemo|kada mozete|kad mozete|ponud\w* za|cijen\w*|rok\w*|odgovor\w*)\b)/;
const THANKS_ONLY = /^\s*(hvala|zahvaljujem|ok|uredu|u redu|primljeno|super)\b[\s\S]{0,40}$/;

export interface MailAddressing { subject: string; snippet: string; to: string; cc: string; own: string[]; companyWords?: string[] }

/**
 * Upućen tebi: tvoja adresa u Kome ili najviše dvoje primalaca — ili masovni
 * mail (do 6+) koji spominje ime firme („Luxco treba ugraditi…"). Masovni mail
 * gradilišta bez imena firme nije upućen tebi.
 */
export function addressedToMe(input: MailAddressing): boolean {
    const own = input.own.map(normalizeEmail).filter(Boolean);
    const to = parseAddressList(input.to).map(a => a.email);
    const all = [...to, ...parseAddressList(input.cc).map(a => a.email)];
    const text = fold(`${input.subject} ${input.snippet}`);
    const named = (input.companyWords || []).some(w => w && text.includes(fold(w)));
    if (named) return true;
    if (all.length > 6) return false;
    return to.some(e => own.includes(e)) || all.length <= 2;
}

/** Treba li odgovor: upućen tebi, a tekst pita ili traži (ne samo „hvala, primljeno"). */
export function needsReply(input: MailAddressing): boolean {
    if (THANKS_ONLY.test(fold(input.snippet))) return false;
    if (!addressedToMe(input)) return false;
    // Upitnik se gleda u izvornom tekstu — `fold` briše interpunkciju.
    return ASKS.test(fold(`${input.subject} ${input.snippet}`)) || /\?/.test(`${input.subject} ${input.snippet}`);
}

/** Šta se prati za ovu vrstu maila. Gradilište samo kad je upućeno tebi (inače bi svaki masovni mail podsjećao). */
export function followOf(kind: MailKind, asks: boolean, addressed = true): MailFollow | null {
    if (kind === 'ready') return 'pickup';
    if (kind === 'site') return addressed ? 'task' : null;
    if (kind === 'supplier_doc') return 'reply';   // predračun/ponuda čeka tvoju potvrdu
    if ((kind === 'contact' || kind === 'reply' || kind === 'accepted') && asks) return 'reply';
    return null;
}

/** Sljedeći podsjetnik poslije `sent` već poslanih; null = nema više. */
export function nextFollowAt(receivedAt: string, follow: MailFollow, sent: number): string | null {
    const days = FOLLOW_DAYS[follow][sent];
    return days === undefined ? null : new Date(Date.parse(receivedAt) + days * DAY).toISOString();
}

const ago = (iso: string, now: Date) => {
    const d = Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / DAY));
    return d === 0 ? 'danas' : d === 1 ? 'jučer' : `prije ${d} dana`;
};

const quote = (s: string, n = 160) => {
    const t = (s || '').replace(/\s+/g, ' ').trim();
    return t.length > n ? `${t.slice(0, n)}…` : t;
};

const who = (i: MailInboxItem) => `${i.From_Name}${i.Supplier_Name && !i.From_Name.includes(i.Supplier_Name) ? ` · ${i.Supplier_Name}` : ''}`;

/** Podsjetnik: šta čeka, od kad, i dugmad da se zatvori. */
export function followMessage(item: MailInboxItem, now: Date, orderNumber?: (id: string) => string | undefined): { text: string; buttons: ButtonRows } {
    const id = item.Message_ID;
    const last = (item.Follow_Count || 0) + 1 >= FOLLOW_DAYS[item.Follow!].length;
    const tail = last ? '\n(zadnji podsjetnik)' : '';
    const orders = item.Order_IDs.map(o => orderNumber?.(o)).filter(Boolean).join(', ');
    const stop = [{ text: '⏰ Sutra', data: `mf:${id}:s` }, { text: '🔕 Ne podsjećaj', data: `mf:${id}:x` }];
    switch (item.Follow) {
        case 'pickup':
            return {
                text: `📦 Još nije preuzeto — ${who(item)} je javio ${ago(item.Received_At, now)}:\n„${quote(item.Snippet)}"${orders ? `\nNarudžba: ${orders}` : ''}${tail}`,
                buttons: [[{ text: item.Order_IDs.length === 1 ? '📦 Preuzeto (primi u ERP)' : '✅ Preuzeto', data: `mf:${id}:d` }], stop],
            };
        case 'task':
            return {
                text: `🏗 Još otvoreno s gradilišta — ${who(item)}, ${ago(item.Received_At, now)}:\n„${quote(item.Subject, 100)}"\n${quote(item.Snippet)}${tail}`,
                buttons: [[{ text: '✅ Urađeno', data: `mf:${id}:d` }, { text: '📒 U bilježnicu', data: `mx:${id}:n` }], stop],
            };
        default:
            return {
                text: `↩️ Čeka tvoj odgovor — ${who(item)}, ${ago(item.Received_At, now)}:\n„${quote(item.Subject, 100)}"\n${quote(item.Snippet)}${tail}`,
                buttons: [[{ text: '✅ Odgovorio sam', data: `mf:${id}:d` }], stop],
            };
    }
}

const DONE_LABEL: Record<NonNullable<MailInboxItem['Done_How']>, string> = {
    replied: 'odgovoreno', button: 'riješeno', received: 'preuzeto', applied: 'upisano u ERP', dismissed: 'zanemareno', stopped: 'bez podsjetnika',
};

const isOpen = (i: MailInboxItem) => !!i.Follow && !i.Done_At;

/**
 * Sažetak za zadnja 3 dana: završeno u tom periodu + sve što je još otvoreno
 * (bez obzira kad je stiglo). null kad nema ništa vrijedno slanja.
 */
export function digestText(items: MailInboxItem[], since: Date, now: Date): string | null {
    const recent = items.filter(i => Date.parse(i.Received_At) >= since.getTime());
    const done = items.filter(i => i.Done_At && Date.parse(i.Done_At) >= since.getTime());
    const replies = items.filter(i => isOpen(i) && i.Follow === 'reply');
    const pickups = items.filter(i => isOpen(i) && i.Follow === 'pickup');
    const tasks = items.filter(i => isOpen(i) && i.Follow === 'task');
    const loose = recent.filter(i => (i.Kind === 'invoice' || i.Kind === 'supplier_doc') && i.State === 'new' && !isOpen(i));
    if (!recent.length && !replies.length && !pickups.length && !tasks.length) return null;

    const day = (d: Date) => `${d.getDate()}.${d.getMonth() + 1}.`;
    const line = (i: MailInboxItem) => `• ${who(i)}: „${quote(i.Subject, 70)}" — ${ago(i.Received_At, now)}`;
    const out = [`📬 Pošta ${day(since)}–${day(now)}: stiglo ${recent.length} od poznatih`];
    if (done.length) out.push(`\n✅ Završeno (${done.length}):`, ...done.slice(0, 8).map(i => `• ${who(i)}: „${quote(i.Subject, 60)}" — ${DONE_LABEL[i.Done_How || 'button']}`));
    if (replies.length) out.push(`\n↩️ Čeka tvoj odgovor (${replies.length}):`, ...replies.slice(0, 8).map(line));
    if (pickups.length) out.push(`\n📦 Spremno, nije preuzeto (${pickups.length}):`, ...pickups.slice(0, 8).map(line));
    if (tasks.length) out.push(`\n🏗 Gradilište, otvoreno (${tasks.length}):`, ...tasks.slice(0, 8).map(line));
    if (loose.length) out.push(`\n📄 Predračuni/računi bez veze s narudžbom (${loose.length}):`, ...loose.slice(0, 5).map(line));
    if (replies.length + pickups.length + tasks.length) out.push('\nSve otvoreno s dugmadima: /posta');
    return out.join('\n');
}

/** /posta: otvorene stvari, najstarije prve. */
export function openList(items: MailInboxItem[], now: Date): { text: string; buttons: ButtonRows } {
    const open = items.filter(isOpen).sort((a, b) => a.Received_At.localeCompare(b.Received_At)).slice(0, 10);
    if (!open.length) return { text: '📭 U pošti ništa ne čeka na tebe.', buttons: [] };
    const icon: Record<MailFollow, string> = { reply: '↩️', pickup: '📦', task: '🏗' };
    return {
        text: ['📬 Otvoreno u pošti:', ...open.map((i, n) => `${n + 1}. ${icon[i.Follow!]} ${who(i)}: „${quote(i.Subject, 60)}" — ${ago(i.Received_At, now)}`)].join('\n'),
        buttons: open.map((i, n) => [{ text: `✅ ${n + 1}. riješeno`, data: `mf:${i.Message_ID}:d` }]),
    };
}
