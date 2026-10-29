// ════════════════════════════════════════════════════════════════════
// TEKST ODGOVORA — šta od modelovog teksta smije do korisnika (čisto)
//
// Šta je upisano piše SAMO ERP (potvrde iz rezultata alata). Model smije
// odgovoriti na pitanje, reći šta NIJE urađeno i zašto, ili pitati — ali:
//   • rečenica koja tvrdi upis („zapisano", „Bego je upisan…") ne prolazi
//     kad je ERP već poslao potvrdu (lažna ili dupla), a bez ijednog upisa
//     je znak da je model „potvrdio" tekstom umjesto alatom;
//   • ponude na kraju („Ako želiš…", „Čeka li…?") se brišu — pitanje ide
//     samo dugmadima.
// jest: lib/__tests__/replyText.test.ts
// ════════════════════════════════════════════════════════════════════

import { foldText } from '@/lib/voice/text';

const CLAIM_START = /^(📒|✅|🧾|📝|🗓|⚙️|📦|✔|☑|➕)/u;
const CLAIM_WORDS = new RegExp([
    'zapisa[ol]', 'zapisan[aoie]?', 'zapisujem', 'zapisala', 'upisa[ol]', 'upisan[aoie]?', 'upisujem',
    'sacuva[ol]', 'sacuvan[aoie]?', 'zabiljezi[oh]', 'zabiljezen[aoie]?', 'evidentira[ol]', 'evidentiran[aoie]?',
    'dodao sam', 'dodala sam', 'napravio sam (?:zadatak|podsjetnik|narud)', 'postavio sam', 'postavila sam',
    'oznacio sam', 'oznacila sam', 'oznacen[aoie]? (?:je|su|kao)', 'podsjetnik[^.]{0,80}postavljen\\w*', 'postavljen (?:je )?podsjetnik',
    'zadatak[^.]{0,60}(?:napravljen|kreiran|dodan)\\w*',
].map(w => `\\b${w}\\b`).join('|'));
/** Rečenica koja kaže šta NIJE urađeno nije potvrda. */
const NEGATION = /\b(nije|nisu|nisam|nismo|nece|ne mogu|nisam mogao|nije uspio|nije uspjelo|nije proslo|nije prosao|bez upisa)\b/;
/** Ponude i pitanja-ponude na kraju odgovora — korisnik ih ne želi. */
const OFFER = /^(ako zelis|ako hoces|ako trebas|ako ti treba|ako je potrebno|ako je potreban|zelis li|hoces li da|da li zelis|da li hoces|mogu ti|mogu i |mogu jos|mogu pogledati|mogu provjeriti|javi ako|javi mi ako|reci ako|reci mi ako|slobodno|ceka li|treba li ti|trebas li jos|ima li jos nesto)/;

function sentences(line: string): string[] {
    return line.split(/(?<=[.!?])\s+(?=\S)/).map(s => s.trim()).filter(Boolean);
}

/** Rečenica tvrdi upis (ne i kad kaže da nešto nije upisano). */
export function sentenceClaims(s: string): boolean {
    const t = s.trim();
    if (!t) return false;
    if (CLAIM_START.test(t)) return true;
    const f = foldText(t);
    return CLAIM_WORDS.test(f) && !NEGATION.test(f);
}

/** Odgovor koji tvrdi da je nešto upisano (potvrda bez alata). */
export function claimsWrite(text: string): boolean {
    return (text || '').split('\n').some(line => sentences(line).some(sentenceClaims));
}

export function isOffer(s: string): boolean {
    return OFFER.test(foldText(s));
}

/**
 * Modelov tekst za korisnika: bez ponuda, a uz upis (`dropClaims`) i bez rečenica koje
 * tvrde upis — tu istinu nosi ERP-ova potvrda. Ako ne ostane ništa → prazno.
 */
export function sanitizeModelText(text: string, opts: { dropClaims: boolean }): string {
    const lines = (text || '').split('\n').map(line => {
        if (!line.trim()) return '';
        const kept = sentences(line).filter(s => !isOffer(s) && !(opts.dropClaims && sentenceClaims(s)));
        return kept.join(' ');
    });
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\s*\n|\n\s*$/g, '').trim();
}

/** Odgovor: prvo ERP-ove potvrde (šta je stvarno upisano), pa ono što model ima da kaže. */
export function composeReply(summaries: string[], modelText: string): string {
    return [summaries.join('\n\n'), modelText].filter(s => s && s.trim()).join('\n\n');
}
