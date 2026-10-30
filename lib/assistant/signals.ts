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

const words = (t: string) => new Set(foldText(t).split(/\s+/).filter(w => w.length >= 3));

/**
 * Sljedeća poruka (u roku od par minuta) počinje ispravkom („ne, nije tako",
 * „zašto nisi…", „kako ne možeš") ili ponavlja isto pitanje drugim riječima.
 */
export function isCorrection(text: string, previous: string): boolean {
    const t = foldText(text).trim();
    if (CORRECTION_START.test(t)) return true;
    const a = words(text), b = words(previous);
    if (a.size < 3 || b.size < 3) return false;
    const same = Array.from(a).filter(w => b.has(w)).length;
    return same / Math.min(a.size, b.size) >= 0.7;
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
