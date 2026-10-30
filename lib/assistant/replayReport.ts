// ════════════════════════════════════════════════════════════════════
// PONAVLJANJE STVARNIH PORUKA — poređenje produkcije i novog bota (čisto)
//
// Stvarne poruke iz dnevnika prođu kroz novog bota (pravi model, lažna
// baza sa snimkom firme). Za svaku: šta je bot uradio tada, šta radi sad,
// i oznake koje traže pažnju — „nemam" bez čitanja, neuspjeh, drugačiji
// upis, poziv all_tools. Izvještaj čita čovjek; ne ide u repo jer nosi
// stvarne poruke (lib/__tests__/assistantReplay.real.test.ts).
// ════════════════════════════════════════════════════════════════════

import type { AssistantOutcome } from '@/lib/types';
import { foldText } from '@/lib/voice/text';
import { NO_DATA } from './readGuard';
import { ALL_TOOLS } from './toolRouting';

export interface ReplaySide {
    outcome?: AssistantOutcome;
    /** Uspjeli pozivi alata, redom. */
    tools: string[];
    reply?: string;
    /** Obračunski tokeni (lib/assistant/usage billedTokens). */
    billed?: number;
    calls?: number;
    toolSet?: string;
}

export interface ReplayCase {
    id: string;
    at: string;
    text: string;
    prod: ReplaySide;
    next: ReplaySide;
}

export type ReplayFlag = 'nemam bez čitanja' | 'neuspjeh' | 'popravljeno' | 'pogoršano' | 'drugi upis' | 'all_tools';

const FAILED = new Set<AssistantOutcome | undefined>(['failed', 'degraded']);

const sameSet = (a: string[], b: string[]) => {
    const x = Array.from(new Set(a)).sort().join(','), y = Array.from(new Set(b)).sort().join(',');
    return x === y;
};

export function caseFlags(c: ReplayCase, tools: { read: Set<string>; write: Set<string> }): ReplayFlag[] {
    const flags: ReplayFlag[] = [];
    const n = c.next;
    if (n.outcome === 'answer' && NO_DATA.test(foldText(n.reply || '')) && !n.tools.some(t => tools.read.has(t))) flags.push('nemam bez čitanja');
    if (FAILED.has(n.outcome)) flags.push('neuspjeh');
    // Produkcija bez ishoda (stari unosi) se ne poredi.
    if (c.prod.outcome) {
        if (FAILED.has(c.prod.outcome) && !FAILED.has(n.outcome)) flags.push('popravljeno');
        if (!FAILED.has(c.prod.outcome) && FAILED.has(n.outcome)) flags.push('pogoršano');
        const pw = c.prod.tools.filter(t => tools.write.has(t));
        const nw = n.tools.filter(t => tools.write.has(t));
        if ((pw.length || nw.length) && !sameSet(pw, nw)) flags.push('drugi upis');
    }
    if (n.tools.includes(ALL_TOOLS)) flags.push('all_tools');
    return flags;
}

const num = (x: number) => Math.round(x).toLocaleString('de-DE');
const cell = (s: string, max = 90) => s.replace(/\s+/g, ' ').replace(/\|/g, '/').trim().slice(0, max) + (s.length > max ? '…' : '');
const side = (s: ReplaySide) => `${s.outcome || '—'}${s.tools.length ? ` · ${s.tools.join(', ')}` : ''}`;

export function replayReport(cases: ReplayCase[], tools: { read: Set<string>; write: Set<string> }): string {
    const rows = cases.map(c => ({ c, flags: caseFlags(c, tools) }));
    const count = (pick: (s: ReplaySide) => string | undefined, from: 'prod' | 'next') => {
        const m = new Map<string, number>();
        cases.forEach(c => { const k = pick(c[from]) || '—'; m.set(k, (m.get(k) || 0) + 1); });
        return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ');
    };
    const flagCount = new Map<ReplayFlag, number>();
    rows.forEach(r => r.flags.forEach(f => flagCount.set(f, (flagCount.get(f) || 0) + 1)));
    const billedNext = cases.map(c => c.next.billed || 0);
    const both = cases.filter(c => c.prod.billed !== undefined);

    const out: string[] = [];
    out.push(`# Ponavljanje ${cases.length} stvarnih poruka`, '');
    out.push(`- Ishod tada: ${count(s => s.outcome, 'prod')}`);
    out.push(`- Ishod sad: ${count(s => s.outcome, 'next')}`);
    out.push(`- Skup alata sad: ${count(s => s.toolSet, 'next')}`);
    out.push(`- Oznake: ${Array.from(flagCount.entries()).map(([k, v]) => `${k} ${v}`).join(' · ') || 'nema'}`);
    out.push(`- Obračunski tokeni sad: ukupno ${num(billedNext.reduce((a, b) => a + b, 0))}, prosjek ${num(billedNext.reduce((a, b) => a + b, 0) / Math.max(1, cases.length))} po poruci`);
    if (both.length) {
        const p = both.reduce((a, c) => a + (c.prod.billed || 0), 0), n = both.reduce((a, c) => a + (c.next.billed || 0), 0);
        out.push(`- Poruke s mjerenjem i tada (${both.length}): tada ${num(p / both.length)}, sad ${num(n / both.length)} po poruci`);
    }
    out.push('', '| # | Poruka | Tada | Sad | Alati | Tokeni | Oznake |', '|---|---|---|---|---|---|---|');
    rows.forEach(({ c, flags }, i) => {
        out.push(`| ${i + 1} | ${cell(c.text)} | ${cell(side(c.prod), 60)} | ${cell(side(c.next), 60)} | ${c.next.toolSet || ''} | ${num(c.next.billed || 0)} | ${flags.join(', ')} |`);
    });
    const flagged = rows.filter(r => r.flags.length);
    if (flagged.length) {
        out.push('', '## Za pogledati', '');
        flagged.forEach(({ c, flags }) => {
            out.push(`### ${flags.join(', ')} — ${c.at.slice(0, 16).replace('T', ' ')}`, '', `> ${c.text.replace(/\n/g, '\n> ')}`, '',
                `- Tada: ${side(c.prod)}${c.prod.reply ? ` — „${cell(c.prod.reply, 300)}"` : ''}`,
                `- Sad: ${side(c.next)} — „${cell(c.next.reply || '', 300)}"`, '');
        });
    }
    return out.join('\n');
}
