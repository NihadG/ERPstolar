// ════════════════════════════════════════════════════════════════════
// TRIJAŽA ZA REVIZIJU BOTA — iz izvoza dnevnika poruka (čisto)
//
// Ulaz je .bot-review/<datum>/entries.json (scripts/bot-review/export.cjs).
// Izlaz: red metrika za docs/bot/dnevnik-unapredjenja.md, tvoje napomene
// prve, pa poruke grupisane po signalu — od onoga što najviše boli.
// Ovo je deterministički dio revizije; uzrok po slučaju traži skill
// /bot-revizija (argumenti alata, da li je podatak postojao).
// jest: lib/__tests__/reviewReport.test.ts
// ════════════════════════════════════════════════════════════════════

import type { AssistantOutcome, AssistantUsage } from '@/lib/types';
import { SIGNAL_LABEL, type Signal } from './signals';
import { billedTokens } from './usage';

export interface ReviewEntry {
    id: string;
    at: string;
    text: string;
    outcome?: AssistantOutcome;
    reply?: string;
    signals?: string[];
    feedback?: { At: string; Kind: string; Text: string }[];
    tools?: { name: string; ok: boolean; args?: string; error?: string }[];
    usage?: AssistantUsage;
}

export interface ReviewMetrics {
    total: number;
    outcome: Record<'written' | 'answer' | 'question' | 'failed' | 'degraded', number>;
    withSignal: number;
    withFeedback: number;
    /** Prosjek obračunskih tokena po poruci s mjerenjem; null = nema mjerenja. */
    avgBilled: number | null;
    signals: Record<string, number>;
}

/** Redom od najgoreg: šta se prvo gleda. Čuvari koji su sami popravili krug su na kraju. */
export const SIGNAL_ORDER: Signal[] = [
    'feedback', 'corrected', 'undone', 'failed', 'degraded', 'write_guard', 'nemam', 'coverage', 'tool_error',
    'reprocessed', 'mail_guard', 'read_guard', 'all_tools', 'slow',
];

export function reviewMetrics(entries: ReviewEntry[]): ReviewMetrics {
    const outcome = { written: 0, answer: 0, question: 0, failed: 0, degraded: 0 };
    const signals: Record<string, number> = {};
    let billed = 0, measured = 0;
    for (const e of entries) {
        if (e.outcome && e.outcome in outcome) outcome[e.outcome as keyof typeof outcome]++;
        (e.signals || []).forEach(s => { signals[s] = (signals[s] || 0) + 1; });
        if (e.usage?.calls) { billed += billedTokens(e.usage); measured++; }
    }
    return {
        total: entries.length, outcome,
        withSignal: entries.filter(e => (e.signals || []).length).length,
        withFeedback: entries.filter(e => (e.feedback || []).length).length,
        avgBilled: measured ? Math.round(billed / measured) : null,
        signals,
    };
}

const num = (n: number) => n.toLocaleString('de-DE');

/** Red za tabelu „Metrike po reviziji" u dnevniku (iste kolone). */
export function metricsRow(label: string, m: ReviewMetrics): string {
    return `| ${label} | ${m.total} | ${m.outcome.written} | ${m.outcome.answer} | ${m.outcome.question} | ${m.outcome.failed} | ${m.outcome.degraded} | ${m.withSignal} | ${m.withFeedback} | ${m.avgBilled === null ? 'nema mjerenja' : num(m.avgBilled)} |`;
}

const one = (s: string, max = 220) => {
    const t = (s || '').replace(/\s+/g, ' ').trim();
    return t.length > max ? `${t.slice(0, max)}…` : t;
};
const day = (iso: string) => iso.slice(0, 16).replace('T', ' ');

function entryBlock(e: ReviewEntry): string[] {
    const tools = (e.tools || []).map(t => `${t.name}${t.ok ? '' : ` ✗${t.error ? ` (${one(t.error, 80)})` : ''}`}${t.args ? ` ${one(t.args, 120)}` : ''}`);
    return [
        `- **${day(e.at)}** · ${e.outcome || '—'}${(e.signals || []).length ? ` · ${(e.signals || []).map(s => SIGNAL_LABEL[s as Signal] || s).join(', ')}` : ''} · \`${e.id}\``,
        `  - Poruka: ${one(e.text)}`,
        ...(e.reply ? [`  - Bot: ${one(e.reply)}`] : []),
        ...(tools.length ? [`  - Alati: ${tools.join(' → ')}`] : []),
        ...(e.feedback || []).map(f => `  - 📝 Ti (${f.Kind}): ${one(f.Text)}`),
    ];
}

export function reviewReport(entries: ReviewEntry[], label: string): string {
    const m = reviewMetrics(entries);
    const out: string[] = [`# Trijaža — ${label}`, ''];
    out.push('Red za dnevnik (Metrike po reviziji):', '', metricsRow(label, m), '');
    out.push(`Signali: ${SIGNAL_ORDER.filter(s => m.signals[s]).map(s => `${SIGNAL_LABEL[s]} ${m.signals[s]}`).join(' · ') || 'nema'}`, '');

    const feedback = entries.filter(e => (e.feedback || []).length);
    if (feedback.length) {
        out.push(`## Tvoje napomene (${feedback.length})`, '');
        feedback.forEach(e => out.push(...entryBlock(e)));
        out.push('');
    }
    const shown = new Set(feedback.map(e => e.id));
    for (const s of SIGNAL_ORDER) {
        if (s === 'feedback') continue;
        const group = entries.filter(e => (e.signals || []).includes(s) && !shown.has(e.id));
        if (!group.length) continue;
        out.push(`## ${SIGNAL_LABEL[s]} (${group.length})`, '');
        group.forEach(e => { out.push(...entryBlock(e)); shown.add(e.id); });
        out.push('');
    }
    const failedQuiet = entries.filter(e => !shown.has(e.id) && (e.outcome === 'failed' || e.outcome === 'degraded'));
    if (failedQuiet.length) {
        out.push(`## Nije upisano / AI nije radio, bez signala (${failedQuiet.length})`, '');
        failedQuiet.forEach(e => out.push(...entryBlock(e)));
    }
    return out.join('\n');
}
