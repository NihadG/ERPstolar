// ════════════════════════════════════════════════════════════════════
// ULAZNA POŠTA U TELEGRAMU — tekst i dugmad prijedloga (čisto)
//
// Dugmad: mx:<id>:c       veži predračun i napravi odgovor „Potvrđujem" (nacrt)
//         mx:<id>:l<n>    veži dokument na narudžbu n
//         mx:<id>:r<n>    spremno + preuzeto danas (prijem cijele narudžbe n)
//         mx:<id>:y<n>    samo zabilježi da je spremno
//         mx:<id>:v<n>    veži račun na narudžbu n
//         mx:<id>:n       pošalji tekst maila botu (Bilježnica / zadaci)
//         mx:<id>:i       zanemari
// Ništa se ne upisuje bez klika.
// ════════════════════════════════════════════════════════════════════

import type { ButtonRows } from '@/lib/telegram/api';
import type { MailInboxItem } from '@/lib/types';

/** Mailovi o kojima bot javlja; „contact" (običan mail poznatog) samo stoji u ERP-u. */
export const NOTIFY_KINDS = new Set(['supplier_doc', 'ready', 'invoice', 'accepted', 'site', 'reply']);

const quote = (s: string, n = 220) => {
    const t = (s || '').replace(/\s+/g, ' ').trim();
    return t.length > n ? `${t.slice(0, n)}…` : t;
};

export function mailMessage(item: MailInboxItem, orderNumber: (id: string) => string | undefined): { text: string; buttons: ButtonRows } {
    const id = item.Message_ID;
    const who = `${item.From_Name}${item.Supplier_Name && !item.From_Name.includes(item.Supplier_Name) ? ` · ${item.Supplier_Name}` : ''}`;
    const orders = item.Order_IDs.map((o, i) => ({ i, no: orderNumber(o) || 'narudžba' }));
    const one = orders.length === 1 ? orders[0] : undefined;
    const ignore = [{ text: 'Zanemari', data: `mx:${id}:i` }];
    const perOrder = (prefix: string, label: (no: string) => string): ButtonRows =>
        orders.map(o => [{ text: label(o.no), data: `mx:${id}:${prefix}${o.i}` }]);

    switch (item.Kind) {
        case 'supplier_doc': {
            const what = item.Doc_Kind === 'predracun' ? 'Predračun' : 'Ponuda';
            const head = `📄 ${what}${item.Doc_No ? ` ${item.Doc_No}` : ''} od ${who}\n„${quote(item.Subject, 120)}"`;
            if (one) {
                return {
                    text: `${head}\nNarudžba: ${one.no}`,
                    buttons: [[{ text: '✅ Veži i odgovori „Potvrđujem"', data: `mx:${id}:c` }], [{ text: '🔗 Samo veži', data: `mx:${id}:l0` }], ignore],
                };
            }
            return {
                text: orders.length ? `${head}\nNa koju narudžbu se odnosi?` : `${head}\nNema otvorene narudžbe za ovog dobavljača.`,
                buttons: [...perOrder('l', no => `🔗 ${no}`), ignore],
            };
        }
        case 'ready': {
            const head = `📦 ${who} javlja da je spremno:\n„${quote(item.Snippet)}"`;
            if (one) {
                return {
                    text: `${head}\nNarudžba: ${one.no}`,
                    buttons: [[{ text: '📦 Preuzeto danas', data: `mx:${id}:r0` }, { text: '🕒 Samo spremno', data: `mx:${id}:y0` }], ignore],
                };
            }
            return {
                text: orders.length ? `${head}\nKoja narudžba?` : `${head}\nNema poslane narudžbe za ovog dobavljača.`,
                buttons: [...perOrder('y', no => `🕒 Spremno: ${no}`), ignore],
            };
        }
        case 'invoice':
            return {
                text: `🧾 Račun${item.Doc_No ? ` ${item.Doc_No}` : ''} od ${who}${orders.length ? '\nZa koju narudžbu?' : ''}`,
                buttons: [...perOrder('v', no => `🧾 ${no}`), ignore],
            };
        case 'accepted':
            return {
                text: `✅ ${who} piše:\n„${quote(item.Snippet)}"\nAko je to prihvatanje ponude, označi je u ERP-u → Ponude.`,
                buttons: [[{ text: '📒 Zabilježi', data: `mx:${id}:n` }], ignore],
            };
        case 'site':
            return {
                text: `🏗 Gradilište · ${who}: „${quote(item.Subject, 100)}"\n${quote(item.Snippet, 300)}`,
                buttons: [[{ text: '📒 U bilježnicu i zadatke', data: `mx:${id}:n` }], ignore],
            };
        case 'reply':
            return { text: `↩️ ${who} je odgovorio na „${quote(item.Subject, 100)}":\n„${quote(item.Snippet)}"`, buttons: [] };
        default:
            return { text: `✉️ ${who}: „${quote(item.Subject, 100)}"`, buttons: [] };
    }
}
