// ════════════════════════════════════════════════════════════════════
// POTROŠNJA BOTA PO PORUCI — koliko je krugova i tokena otišlo (čisto)
//
// Svaki krug (poziv modela) vraća `usage`: ulaz, čitanje keša, upis keša, izlaz.
// Zbir ide u dnevnik poruke (AssistantEntry.Usage) i u Postavke → Poruke botu,
// da se odluke o štednji donose po brojkama, ne po osjećaju.
//
// „Obračunski tokeni" su sve svedeno na cijenu običnog ulaznog tokena, po
// odnosima cijena kod Anthropica: čitanje keša ×0,1, upis keša 5 min ×1,25,
// upis keša 1 h ×2, izlaz ×5. To nije iznos u KM — samo usporediva mjera.
// ════════════════════════════════════════════════════════════════════

import type { AssistantUsage } from '@/lib/types';

export function emptyUsage(): AssistantUsage {
    return { calls: 0, input: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, output: 0, models: [], ms: 0 };
}

interface ApiUsage {
    input_tokens?: number | null;
    output_tokens?: number | null;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
    cache_creation?: { ephemeral_5m_input_tokens?: number | null; ephemeral_1h_input_tokens?: number | null } | null;
}

/** Dodaje jedan krug. Upis keša se dijeli na 5 min i 1 h kad API to kaže, inače sve kao 5 min. */
export function addUsage(acc: AssistantUsage, u: ApiUsage | undefined, model: string, ms: number): AssistantUsage {
    if (!u) return acc;
    const write = u.cache_creation_input_tokens || 0;
    const write1h = u.cache_creation?.ephemeral_1h_input_tokens || 0;
    const write5m = u.cache_creation ? (u.cache_creation.ephemeral_5m_input_tokens || 0) : write;
    acc.calls += 1;
    acc.input += u.input_tokens || 0;
    acc.output += u.output_tokens || 0;
    acc.cacheRead += u.cache_read_input_tokens || 0;
    acc.cacheWrite5m += write5m;
    acc.cacheWrite1h += write1h;
    acc.ms += Math.max(0, Math.round(ms));
    if (!acc.models.includes(model)) acc.models.push(model);
    return acc;
}

/** Sve svedeno na cijenu ulaznog tokena (vidi zaglavlje). */
export function billedTokens(u: AssistantUsage): number {
    return Math.round(u.input + u.cacheRead * 0.1 + u.cacheWrite5m * 1.25 + u.cacheWrite1h * 2 + u.output * 5);
}

export interface UsageSummary {
    messages: number;
    calls: number;
    billed: number;
    avgCalls: number;
    avgBilled: number;
    /** Udio ulaza koji je došao iz keša (0–1). */
    cacheShare: number;
    /** Po danu (YYYY-MM-DD) — za tabelu u Postavkama. */
    byDay: { day: string; messages: number; billed: number }[];
}

export function summarizeUsage(rows: { at: string; usage?: AssistantUsage | null }[]): UsageSummary {
    const withUsage = rows.filter(r => r.usage && r.usage.calls > 0) as { at: string; usage: AssistantUsage }[];
    const sum = (f: (u: AssistantUsage) => number) => withUsage.reduce((s, r) => s + f(r.usage), 0);
    const calls = sum(u => u.calls);
    const billed = sum(billedTokens);
    const inputAll = sum(u => u.input + u.cacheRead + u.cacheWrite5m + u.cacheWrite1h);
    const days = new Map<string, { messages: number; billed: number }>();
    for (const r of withUsage) {
        const day = r.at.slice(0, 10);
        const d = days.get(day) || { messages: 0, billed: 0 };
        d.messages += 1;
        d.billed += billedTokens(r.usage);
        days.set(day, d);
    }
    const n = withUsage.length;
    return {
        messages: n,
        calls,
        billed,
        avgCalls: n ? Math.round((calls / n) * 10) / 10 : 0,
        avgBilled: n ? Math.round(billed / n) : 0,
        cacheShare: inputAll ? Math.round((sum(u => u.cacheRead) / inputAll) * 100) / 100 : 0,
        byDay: Array.from(days.entries()).sort((a, b) => b[0].localeCompare(a[0])).map(([day, d]) => ({ day, ...d })),
    };
}
