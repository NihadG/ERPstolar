// ════════════════════════════════════════════════════════════════════
// ADRESE IZ ZAGLAVLJA (To / Cc / From) — Gmail API ih vraća već dekodirane
//
//   „Sakib Kaljević" <s@x.ba>, Merima <m@y.com>, info@z.ba
// ════════════════════════════════════════════════════════════════════

import { isValidEmail, normalizeEmail } from '../contacts';
import type { MailAddress } from './mime';

/** Dijeli na zarezima koji nisu unutar navodnika ni <…>. */
function splitList(header: string): string[] {
    const out: string[] = [];
    let cur = '';
    let quoted = false;
    let angle = false;
    for (const ch of header || '') {
        if (ch === '"' ) quoted = !quoted;
        else if (ch === '<' && !quoted) angle = true;
        else if (ch === '>' && !quoted) angle = false;
        if ((ch === ',' || ch === ';') && !quoted && !angle) {
            out.push(cur);
            cur = '';
        } else {
            cur += ch;
        }
    }
    out.push(cur);
    return out.map(s => s.trim()).filter(Boolean);
}

export function parseMailbox(raw: string): MailAddress | null {
    const text = (raw || '').trim();
    const angle = text.match(/^(.*)<([^<>]+)>\s*$/);
    const email = normalizeEmail(angle ? angle[2] : text);
    if (!isValidEmail(email)) return null;
    let name = angle ? angle[1].trim() : '';
    name = name.replace(/^"(.*)"$/, '$1').replace(/\\"/g, '"').trim();
    if (normalizeEmail(name) === email) name = '';
    return name ? { name, email } : { email };
}

export function parseAddressList(header: string): MailAddress[] {
    return splitList(header).map(parseMailbox).filter((a): a is MailAddress => !!a);
}
