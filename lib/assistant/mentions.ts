// ════════════════════════════════════════════════════════════════════
// ŠTA PORUKA SPOMINJE — projekti i nalozi prepoznati prije modela (čisto)
//
// ERP već zna imena projekata, klijenata i naloga (i naučene nadimke).
// Umjesto da model iz liste od 30 projekata pogađa koji je „Jerka", ERP
// ga nađe i napiše u napomeni: „projekat: P3 Jerko Čorluka · faza 2".
// Ako ga ova poruka ne spominje, a prethodne dvije da — „iz razgovora".
// Pitanje o tačno jednom projektu dobija i put: project_brief P3.
// jest: lib/__tests__/toolRouting.test.ts
// ════════════════════════════════════════════════════════════════════

import { orderMentioned, type GroundRef } from './grounding';

export type MentionRef = GroundRef & { alias: string };

/** Više od ovoga nije „spomenut projekat", nego šira priča — bez napomene. */
const MAX_HITS = 3;

function hits(text: string, refs: MentionRef[]): MentionRef[] {
    if (!text.trim()) return [];
    const found = refs.filter(r => orderMentioned(text, r, refs));
    return found.length <= MAX_HITS ? found : [];
}

export function mentionNote(input: {
    text: string;
    /** Prethodne korisnikove poruke u razgovoru (bez ove). */
    recent: string;
    projects: MentionRef[];
    orders: MentionRef[];
    question: boolean;
}): string[] {
    const out: string[] = [];
    const label = (r: MentionRef) => `${r.alias} ${r.name}`;

    let projects = hits(input.text, input.projects);
    const fromTalk = !projects.length;
    if (fromTalk) projects = hits(input.recent, input.projects);
    if (projects.length) out.push(`${fromTalk ? 'projekat iz razgovora' : projects.length > 1 ? 'projekti' : 'projekat'}: ${projects.map(label).join(', ')}`);

    const orders = hits(input.text, input.orders);
    if (orders.length) out.push(`${orders.length > 1 ? 'nalozi' : 'nalog'}: ${orders.map(label).join(', ')}`);

    if (input.question && projects.length === 1) out.push(`pitanje o projektu → project_brief ${projects[0].alias}`);
    return out;
}
