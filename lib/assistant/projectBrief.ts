// ════════════════════════════════════════════════════════════════════
// KARTICA PROJEKTA — sve o jednom projektu u jednom izvodu (čisto)
//
// „Strukturirani RAG": ERP sam spoji projekat → proizvodi → materijali i
// dekori → narudžbe → nalozi i rad → bilježnica, zadaci i ljudi, i modelu
// preda kratak tekst. Jedan poziv alata umjesto 2–4 kruga, a odgovor je iz
// podataka („koji iveral za Jerkine ormare", „kad smo počeli", „šta fali").
//
// Sastav je čist i deterministički; učitavanje je u lib/server/projectBrief.ts.
// ════════════════════════════════════════════════════════════════════

import { fold, queryTokens } from '@/lib/command/search';
import { formatQty } from '@/lib/orderItemGroups';
import { projectHistoryLines, type ProjectHistory } from '@/lib/projectHistory';

export interface BriefMaterialRow {
    name: string;
    unit: string;
    supplier: string;
    productName: string;
    needed: number;
    ordered: number;
    received: number;
    onStock: number;
}

export interface BriefOrder {
    number: string;
    supplier: string;
    status: string;
    date: string;
    items: number;
    /** Samo stavke ovog projekta. */
    materials: string[];
    emailedAt?: string;
    supplierDoc?: string;
    readyAt?: string;
    invoice?: string;
}

export interface BriefInput {
    label: string;
    status?: string;
    deadline?: string;
    products: { name: string; quantity: number; status: string }[];
    materials: BriefMaterialRow[];
    orders: BriefOrder[];
    history: ProjectHistory | null;
    notebook: { title: string; location?: string; state: string; quantity?: number }[];
    tasks: { title: string; due?: string; worker?: string }[];
    people: { name: string; role: string; email: string }[];
    /** Pošta o projektu (mail_inbox: spominje projekat ili njegovu narudžbu); nema = Gmail nije povezan. */
    mail?: BriefMail[];
}

export interface BriefMail {
    /** ISO. */
    at: string;
    from: string;
    kind: string;
    subject: string;
    snippet: string;
    docNo?: string;
}

const MAIL_KIND: Record<string, string> = {
    ready: 'gotovo / spremno', supplier_doc: 'predračun / ponuda', invoice: 'račun', accepted: 'odobreno',
    site: 'gradilište', reply: 'odgovor', contact: 'mail',
};

const MAX_MATERIALS = 40;
const MAX_LINES = 140;
const q = (n: number) => formatQty(Math.round(n * 100) / 100);
const day = (iso?: string) => (iso ? `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.` : '');

/** Proizvod pripada filteru: sve riječi upita (osnova od 4 slova, zbog padeža) su u nazivu. */
export function productMatches(name: string, query: string): boolean {
    const tokens = queryTokens(query);
    if (!tokens.length) return true;
    const hay = fold(name);
    return tokens.every(t => hay.includes(t.length > 4 ? t.slice(0, Math.max(4, t.length - 2)) : t));
}

/** Isti materijal na više proizvoda = jedan red: ukupno potrebno, naručeno, primljeno, na kojim proizvodima. */
export type MaterialGroup = BriefMaterialRow & {
    products: string[];
    /** Naručeno, a još nije stiglo — po redu prije spajanja (jedan proizvod primljen, drugi samo naručen). */
    pending: number;
};

export function groupMaterials(rows: BriefMaterialRow[]): MaterialGroup[] {
    const groups = new Map<string, MaterialGroup>();
    for (const r of rows) {
        const key = `${fold(r.name)}|${r.unit}`;
        const g = groups.get(key) || { ...r, needed: 0, ordered: 0, received: 0, onStock: 0, pending: 0, products: [] };
        g.needed += r.needed;
        g.ordered += r.ordered;
        g.received += r.received;
        g.onStock += r.onStock;
        g.pending += Math.max(0, r.ordered - r.received);
        if (r.productName && !g.products.includes(r.productName)) g.products.push(r.productName);
        if (!g.supplier && r.supplier) g.supplier = r.supplier;
        groups.set(key, g);
    }
    return Array.from(groups.values()).sort((a, b) => b.products.length - a.products.length || a.name.localeCompare(b.name, 'bs'));
}

function materialLine(m: MaterialGroup): string {
    const missing = m.needed - m.received - m.onStock - m.pending;
    const state = m.received + m.onStock >= m.needed - 1e-9
        ? 'sve tu'
        : [m.received ? `primljeno ${q(m.received)}` : '', m.onStock ? `na stanju ${q(m.onStock)}` : '', m.pending > 0 ? `naručeno ${q(m.pending)}` : '',
            missing > 1e-9 ? `nije naručeno ${q(missing)}` : '']
            .filter(Boolean).join(', ');
    const where = m.products.length > 4 ? `${m.products.slice(0, 4).join(', ')} i još ${m.products.length - 4}` : m.products.join(', ');
    return `• ${m.name}${m.supplier ? ` (${m.supplier})` : ''} — ${q(m.needed)} ${m.unit} · ${state} · ${where}`;
}

export function buildProjectBrief(input: BriefInput, opts: { product?: string } = {}): string {
    const asked = (opts.product || '').trim();
    // Filter koji ne pogađa nijedan proizvod (31.10.: product „furnir" — to je materijal) ne smije
    // dati praznu karticu: model je iz nje zaključio „nema materijala ni narudžbi".
    const missed = !!asked && !input.products.some(p => productMatches(p.name, asked));
    const filter = missed ? '' : asked;
    const products = input.products.filter(p => productMatches(p.name, filter));
    const productNames = new Set(products.map(p => p.name));
    const materials = groupMaterials(filter ? input.materials.filter(m => productNames.has(m.productName)) : input.materials);

    const out: string[] = [
        `PROJEKAT: ${input.label}${input.status ? ` · ${input.status}` : ''}${input.deadline ? ` · rok ${day(input.deadline)}` : ''}`,
    ];
    if (missed) out.push(`(nijedan proizvod se ne zove „${asked}" — prikazana je cijela kartica; za materijal po vrsti koristi product_materials s material)`);
    if (filter) out.push(`(samo proizvodi koji odgovaraju „${filter}": ${products.length} od ${input.products.length})`);

    out.push(`\nPROIZVODI (${products.length}):`);
    out.push(...products.slice(0, 30).map(p => `• ${p.name}${p.quantity > 1 ? ` ×${q(p.quantity)}` : ''} — ${p.status}`));
    if (products.length > 30) out.push(`… i još ${products.length - 30}`);

    out.push(`\nMATERIJALI I DEKORI (${materials.length}; isti materijal na više proizvoda je jedan red):`);
    out.push(...materials.slice(0, MAX_MATERIALS).map(materialLine));
    if (materials.length > MAX_MATERIALS) out.push(`… i još ${materials.length - MAX_MATERIALS} materijala (suzi s product)`);
    if (!materials.length) out.push('— u sastavnici nema materijala');

    const orders = filter ? input.orders.filter(o => o.materials.some(m => materials.some(g => fold(g.name) === fold(m)))) : input.orders;
    out.push(`\nNARUDŽBE (${orders.length}):`);
    out.push(...orders.slice(0, 15).map(o => {
        const trail = [
            o.emailedAt ? `mailom ${day(o.emailedAt)}` : '',
            o.supplierDoc ? `predračun/ponuda ${o.supplierDoc}` : '',
            o.readyAt ? `spremno ${day(o.readyAt)}` : '',
            o.invoice ? `račun ${o.invoice}` : '',
        ].filter(Boolean).join(', ');
        return `• ${o.number} · ${o.supplier} · ${o.status} · ${day(o.date)} · ${o.items} stavki${trail ? ` (${trail})` : ''}`;
    }));
    if (!orders.length) out.push('— nema narudžbi');

    if (input.mail) {
        out.push(`\nPOŠTA o projektu (${input.mail.length}; i narudžbe poslane mailom mimo ERP-a):`);
        out.push(...input.mail.slice(0, 6).map(m => {
            const snip = m.snippet.replace(/\s+/g, ' ').trim();
            return `• ${day(m.at)} · ${m.from} · ${MAIL_KIND[m.kind] || 'mail'}${m.docNo ? ` ${m.docNo}` : ''} · „${m.subject.trim().slice(0, 80)}" — ${snip.slice(0, 140)}${snip.length > 140 ? '…' : ''}`;
        }));
        if (!input.mail.length) out.push('— u ulaznoj pošti nema ništa o ovom projektu (search_mail za stariju ili poslanu poštu)');
    }

    out.push('\nRAD (Knjiga rada):');
    out.push(...(input.history ? projectHistoryLines(input.history, 'Projekat') : ['Projekat: u Knjizi rada nema upisanog rada.']));

    if (input.notebook.length) {
        out.push(`\nBILJEŽNICA, otvoreno (${input.notebook.length}):`);
        out.push(...input.notebook.slice(0, 15).map(n => `• ${n.quantity ? `${q(n.quantity)} ` : ''}${n.title}${n.location ? ` · ${n.location}` : ''} — ${n.state}`));
    }
    if (input.tasks.length) {
        out.push(`\nZADACI, otvoreni (${input.tasks.length}):`);
        out.push(...input.tasks.slice(0, 10).map(t => `• ${t.title}${t.due ? ` · rok ${day(t.due)}` : ''}${t.worker ? ` · ${t.worker}` : ''}`));
    }
    if (input.people.length) {
        out.push('\nLJUDI NA PROJEKTU:');
        out.push(...input.people.slice(0, 12).map(p => `• ${p.name} — ${p.role} <${p.email}>`));
    }
    return out.slice(0, MAX_LINES).join('\n');
}
