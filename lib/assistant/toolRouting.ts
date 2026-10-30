// ════════════════════════════════════════════════════════════════════
// ALATI PO VRSTI PORUKE — manji skup alata kad ERP zna šta poruka traži (čisto)
//
// Svi alati su ~8,6k tokena u svakom pozivu. Čisto pitanje treba samo
// alate za čitanje (~2,7k), mail samo mail i narudžbe (~3k). Manje alata =
// manje ulaza i manje pogrešnih izbora (Haiku na pitanje ne zove upis).
//
// Skupova je malo (pitanje / mail / svi), jer svaki skup ima svoj keš:
// alati su početak keširanog prefiksa. Krug „prvo čitaj" (readGuard) koristi
// isti skup kao pitanje, pa ne kvari keš.
//
// Pogrešna procjena se ne plaća neuspjehom: u manjem skupu je alat
// all_tools — model ga pozove kad mu treba nešto čega nema, i sljedeći krug
// dobije sve alate.
// jest: lib/__tests__/toolRouting.test.ts
// ════════════════════════════════════════════════════════════════════

import type Anthropic from '@anthropic-ai/sdk';
import type { MessageKind } from './intent';

export type ToolSet = 'question' | 'email' | 'full';

export const ALL_TOOLS = 'all_tools';

export const ALL_TOOLS_DEF: Anthropic.Tool = {
    name: ALL_TOOLS,
    description: 'Treba ti alat kojeg nema u ovoj listi (upis rada, zadatak, bilježnica, narudžba, mail…)? Pozovi ovo i u sljedećem krugu imaš sve alate. Korisniku ništa ne govori o tome.',
    input_schema: { type: 'object', properties: {} },
};

/** Pitanje: sve za čitanje, PDF narudžbe („pošalji mi PDF") i pitanje nazad. */
const QUESTION_EXTRA = new Set(['order_pdf', 'ask_user']);

/** Mail: nacrt, ko je ko, pošta, i narudžba koju mail nosi (možda je prvo treba napraviti). */
const EMAIL_TOOLS = new Set([
    'email_order', 'email_contact', 'find_contact', 'save_contact', 'search_mail',
    'list_orders', 'order_status', 'project_brief', 'create_order', 'manage_order', 'order_pdf', 'ask_user',
]);

/**
 * Skup alata za poruku. Odgovor na pitanje (dugme ili tekst) i sve što
 * nije čisto pitanje ili čisto mail dobija sve alate.
 */
export function toolSetFor(kinds: MessageKind[], opts: { answeringQuestion?: boolean } = {}): ToolSet {
    if (opts.answeringQuestion || !kinds.length) return 'full';
    if (kinds.length === 1 && kinds[0] === 'question') return 'question';
    if (kinds.includes('email') && kinds.every(k => k === 'email' || k === 'question')) return 'email';
    return 'full';
}

/** Alati skupa, istim redom kao u punoj listi (stabilan keš po skupu). */
export function toolsFor<T extends { name: string }>(set: ToolSet, all: T[], readTools: Set<string>): (T | Anthropic.Tool)[] {
    if (set === 'full') return all;
    const keep = set === 'question'
        ? (n: string) => readTools.has(n) || QUESTION_EXTRA.has(n)
        : (n: string) => EMAIL_TOOLS.has(n);
    return [...all.filter(t => keep(t.name)), ALL_TOOLS_DEF];
}

export const TOOL_SET_LABEL: Record<ToolSet, string> = { question: 'pitanje', email: 'mail', full: 'svi' };
