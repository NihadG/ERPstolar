// ════════════════════════════════════════════════════════════════════
// NACRT MAILA U TELEGRAMU — tekst i dugmad (čisto)
//
//   ✉️ Nacrt maila — nije poslan
//   Kome / Kopija / Naslov / 📎 prilog, pa tekst
//   [📤 Pošalji] [✏️ Izmijeni tekst]      kad je primalac poznat
//   [👤 Amra Delić] [👤 Mirza Avdić]      kad treba izabrati
//   [✖ Otkaži]
//
// Dugmad: em:<id>:s (pošalji) · em:<id>:e (izmijeni) · em:<id>:x (otkaži)
//         em:<id>:t<n> (primalac n). Šalje se SAMO na klik — mail se ne poništava.
// ════════════════════════════════════════════════════════════════════

import type { EmailDraft, EmailDraftAddress } from '@/lib/types';
import type { ButtonRows } from '@/lib/telegram/api';

const MAX_BODY = 2500;   // Telegram poruka ima najviše 4096 znakova

const who = (a: EmailDraftAddress) => a.name ? `${a.name} <${a.email}>` : a.email;
const short = (a: EmailDraftAddress) => (a.name || a.email).slice(0, 30);

export function draftMessage(d: EmailDraft): { text: string; buttons: ButtonRows } {
    const lines = ['✉️ Nacrt maila — nije poslan'];
    lines.push(d.To.length ? `Kome: ${d.To.map(who).join(', ')}` : 'Kome: — izaberi ispod');
    if (d.Cc.length) lines.push(`Kopija: ${d.Cc.map(who).join(', ')}`);
    lines.push(`Naslov: ${d.Subject}`);
    d.Attachments.forEach(a => lines.push(`📎 ${a.filename}`));
    (d.Warnings || []).forEach(w => lines.push(`⚠️ ${w.email} — da li si mislio ${w.suggestion}?`));
    const body = d.Body.length > MAX_BODY ? `${d.Body.slice(0, MAX_BODY)}…` : d.Body;

    const id = d.Draft_ID;
    const buttons: ButtonRows = [];
    if (d.Warnings?.length) buttons.push([{ text: `✏️ Ispravi na ${d.Warnings[0].suggestion}`.slice(0, 60), data: `em:${id}:f` }]);
    if (d.To.length) {
        buttons.push([{ text: '📤 Pošalji', data: `em:${id}:s` }, { text: '✏️ Izmijeni tekst', data: `em:${id}:e` }]);
    } else if (d.Candidates?.length) {
        for (let i = 0; i < d.Candidates.length; i += 2) {
            buttons.push(d.Candidates.slice(i, i + 2).map((c, j) => ({ text: `👤 ${short(c)}`, data: `em:${id}:t${i + j}` })));
        }
    }
    buttons.push([{ text: '✖ Otkaži', data: `em:${id}:x` }]);
    return { text: `${lines.join('\n')}\n\n${body}`, buttons };
}

/** Poslije slanja narudžbe: „poslano greškom" se ispravlja jednim klikom. */
export function sentButtons(d: EmailDraft, res: { orderSent: boolean }): ButtonRows {
    return d.Purpose === 'order' && d.Entity_ID && res.orderSent
        ? [[{ text: '↩️ Vrati narudžbu u nacrt', data: `ordback:${d.Entity_ID}` }]]
        : [];
}

export function sentMessage(d: EmailDraft, res: { to: string[]; orderSent: boolean; orderNumber?: string }): string {
    const lines = [`📤 Poslano: „${d.Subject}" → ${res.to.join(', ')}`];
    if (d.Cc.length) lines.push(`Kopija: ${d.Cc.map(a => a.email).join(', ')}`);
    if (res.orderSent && res.orderNumber) lines.push(`✔ Narudžba ${res.orderNumber} je prešla u „Poslano" — materijali su naručeni.`);
    else if (res.orderNumber) lines.push(`Narudžba ${res.orderNumber} — status nije mijenjan.`);
    return lines.join('\n');
}

export const EDIT_PROMPT = '✏️ Napiši novi tekst maila (bez pozdrava i potpisa — njih dodajem ja). Važi 15 minuta.';
