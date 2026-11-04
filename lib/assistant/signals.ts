// ════════════════════════════════════════════════════════════════════
// SIGNALI UZ PORUKU — šta je trebalo ispravljati i šta korisnik misli (čisto)
//
// Bez modela, bez tvog truda: uz svaku poruku u dnevnik ide spisak signala.
//   pri obradi:  ERP je morao tjerati čitanje ERP-a (read_guard) ili pošte
//                (mail_guard), model je tražio sve alate (all_tools), tekst
//                je tvrdio upis (write_guard), nešto iz poruke nije upisano
//                (coverage), „nemam" u odgovoru, alat pao, nije upisano,
//                AI nije radio, sporo (> 20 s)
//   naknadno:    ↩️ Poništi (undone), ponovna obrada (reprocessed), sljedeća
//                poruka je ispravka (corrected), tvoja napomena (feedback)
// Revizija (/bot-revizija) kreće od poruka sa signalima.
// jest: lib/__tests__/assistantSignals.test.ts
// ════════════════════════════════════════════════════════════════════

import { foldText } from '@/lib/voice/text';
import { NO_DATA } from './readGuard';
import type { AssistantOutcome } from '@/lib/types';

export type Signal =
    | 'read_guard' | 'mail_guard' | 'all_tools' | 'write_guard' | 'coverage' | 'nemam' | 'tool_error'
    | 'failed' | 'degraded' | 'slow'
    | 'undone' | 'reprocessed' | 'corrected' | 'feedback';

export const SIGNAL_LABEL: Record<Signal, string> = {
    read_guard: 'tjeran da čita ERP', mail_guard: 'tjeran da pogleda poštu', all_tools: 'tražio sve alate',
    write_guard: 'tvrdio upis bez upisa', coverage: 'nešto nije upisano', nemam: '„nemam" u odgovoru',
    tool_error: 'alat pao', failed: 'nije upisano', degraded: 'AI nije radio', slow: 'sporo',
    undone: 'poništeno', reprocessed: 'obrađeno ponovo', corrected: 'ispravio si', feedback: 'tvoja napomena',
};

export const SLOW_MS = 20_000;

export function turnSignals(s: {
    readGuard: boolean; mailGuard: boolean; writeGuard: boolean; coverage: boolean;
    allTools: boolean; toolErrors: boolean; outcome?: AssistantOutcome; reply: string; ms: number;
}): Signal[] {
    const out: Signal[] = [];
    if (s.readGuard) out.push('read_guard');
    if (s.mailGuard) out.push('mail_guard');
    if (s.allTools) out.push('all_tools');
    if (s.writeGuard) out.push('write_guard');
    if (s.coverage) out.push('coverage');
    if (s.outcome === 'answer' && NO_DATA.test(foldText(s.reply))) out.push('nemam');
    if (s.toolErrors) out.push('tool_error');
    if (s.outcome === 'failed') out.push('failed');
    if (s.outcome === 'degraded') out.push('degraded');
    if (s.ms > SLOW_MS) out.push('slow');
    return out;
}

/** Naknadni signali (Poništi, ispravka, napomena) ostaju i kad se poruka obradi ponovo. */
const LATER = new Set<string>(['undone', 'reprocessed', 'corrected', 'feedback']);

export function mergeSignals(prev: string[] | undefined, turn: string[]): string[] {
    return Array.from(new Set([...(prev || []).filter(s => LATER.has(s)), ...turn]));
}

// ── Ispravka u sljedećoj poruci ──────────────────────────────────────

const CORRECTION_START = /^(ne|nije|nisi|nisam|pogresno|pogresan|krivo|zasto|kako ne|kako nisi|opet|ponovo|nije tacno|nije to|ma ne|ali ne|ali nisi|ali ima|ali je|trebao si|trebas|a sta je sa|ima u mailu|ima u posti)\b/;

const COMPLAINT = /\b(los|losa|lose|loso|losija|ne valja|nevalja|ne valjaju|pogresn\w*|kakve veze|nema veze|nije dobr\w*|ne stima|nije tacn\w*|sta je ovo|glupost\w*|uzas|beskorisn\w*|ne kontam|nekontam|ne razumijes|nisi razumio)\b/;

const words = (t: string) => new Set(foldText(t).split(/\s+/).filter(w => w.length >= 3));

/**
 * Sljedeća poruka (u roku od par minuta) počinje ispravkom („ne, nije tako",
 * „zašto nisi…", „kako ne možeš") ili ponavlja isto pitanje drugim riječima.
 */
export function isCorrection(text: string, previous: string): boolean {
    const t = foldText(text).trim();
    if (CORRECTION_START.test(t)) return true;
    // Pritužba bilo gdje na početku poruke („Tabela loša, u C lameli…", „Kakve veze ima hodnik…").
    if (COMPLAINT.test(t.split(/\s+/).slice(0, 6).join(' '))) return true;
    const a = words(text), b = words(previous);
    if (a.size < 3 || b.size < 3) return false;
    const same = Array.from(a).filter(w => b.has(w)).length;
    return same / Math.min(a.size, b.size) >= 0.7;
}

/**
 * Poruka je pritužba („pogrešno totalno", „ma nešto je ovdje pogrešno"), bez obzira na prethodnu.
 * Gola ispravka („ne, u utorak", „ne, Senadu") nije — ona je odgovor i ide dalje kao odgovor.
 */
export function isComplaint(text: string): boolean {
    const t = foldText(text).trim();
    return /^(nije to|nije tacno|nisi razumio|krivo)\b/.test(t) || COMPLAINT.test(t.split(/\s+/).slice(0, 6).join(' '));
}

// ── Napomena o botu u običnoj poruci ─────────────────────────────────
//
// „Zabilježi da je ovo pogrešno, kako sam ja ovo skontao", „zabilježi to kao pogrešno
// shvatanje", „trebalo bi napraviti da AI pročita PDF ponude…" (03.11.) — to je napomena
// za reviziju bota, ne bilješka u ERP-u. Bez ovoga je završilo u bilježnici („Ponuda —
// ranije pogrešno povezana…") ili kao „Ništa nije upisano".

const META = /^trebalo bi da ja\b|\b(zabiljezi|zapisi|zapamti)\s+(\w+\s+){0,3}(pogresn\w*|lose|kao gresk\w*)|pogresno (si |je )?(shvat|razum|procijen|skont|protumac)\w*|kako (sam |si |je )?(ja )?(ovo |to )?skont\w*|\b(ai|bot|botu|model|haiku|gemini|claude)\b[^.]{0,60}\b(treba|trebao|trebalo|procita|razumije|nauci)\w*/;
/**
 * „Trebalo bi…" je prijedlog za sistem samo kad govori o sistemu (bot, AI, ERP, aplikacija).
 * Bez toga je posao: „trebalo bi da Amer ponese umivaonik" je zadatak, ne napomena za reviziju.
 */
const SYSTEM = /\b(ai|bot|botu|model|haiku|gemini|claude|erp|rpe|aplikacij\w*|sistem\w*)\b/;

/**
 * Napomena o botu: `pure` = poruka je samo to (ide u reviziju, ništa se ne izvršava);
 * inače poruka ima i posao („pogrešno si procijenio bilješku, ne čeka nego… zabilježi to
 * kao pogrešno shvatanje") — napomena ide u reviziju, a posao modelu.
 */
export function metaFeedback(text: string): { pure: boolean } | null {
    const t = foldText(text);
    const aboutSystem = /\btrebalo bi\b/.test(t) && SYSTEM.test(t);
    if (!META.test(t) && !aboutSystem) return null;
    // „Trebalo bi da ja kad uđem u ERP mogu uređivati…" (04.11.) je prijedlog za aplikaciju, koliko god dug.
    const pure = /^(zabiljezi|zapisi|zapamti)\b/.test(t) && t.length <= 160
        || /^trebalo bi da ja\b/.test(t) || aboutSystem;
    return { pure };
}

// ── Napomena odgovorom na poruku bota ────────────────────────────────

export type FeedbackKind = 'lose' | 'dobro' | 'napomena';

/** „loše: trebao si pogledati mail", „dobro: tačno tako", „napomena: …", „📝 …". */
export function parseFeedback(text: string): { kind: FeedbackKind; text: string } | null {
    const m = text.trim().match(/^(📝|lo[sš]e|dobro|napomena|bug)\s*[:,\-–—]?\s*([\s\S]*)$/i);
    if (!m) return null;
    const head = m[1].toLowerCase();
    // „Dobro" bez dvotačke je obična potvrda u razgovoru („dobro, može"), ne napomena.
    if ((head === 'dobro' || head === 'lose' || head === 'loše') && !/^(📝|\S+\s*:)/.test(text.trim())) return null;
    const kind: FeedbackKind = head === 'dobro' ? 'dobro' : head === '📝' || head === 'napomena' ? 'napomena' : 'lose';
    return { kind, text: m[2].trim() || head };
}
