// ════════════════════════════════════════════════════════════════════
// PORUKE KAPIJA MATERIJALA — tekst i dugmad (čisto, bez Firebase)
//
// Jedna poruka = jedna provjera (material_checks): redovi koje korisnik
// označi kao „tu je", pa odgovor s onim što fali i dugmadima „Naruči što
// fali" / „Pitaj sutra". Dugmad nose kratke kodove `mc:<id>:<radnja>`.
// ════════════════════════════════════════════════════════════════════

import type { ButtonRows } from '@/lib/telegram/api';
import { rowLabel, stateNote, type AlertKind, type GateRow } from '@/lib/materialGates';

/** Najviše redova s dugmetom u jednoj poruci (ostalo je u ERP-u). */
export const MAX_ROWS = 14;

export interface CheckView {
    id: string;
    kind: AlertKind;
    label: string;
    processes: string[];
    rows: GateRow[];
    longLead: GateRow[];
    selected: number[];
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

function listProcesses(names: string[]): string {
    const l = names.map(lower);
    return l.length <= 1 ? (l[0] || '') : `${l.slice(0, -1).join(', ')} i ${l[l.length - 1]}`;
}

export function checkHeader(c: Pick<CheckView, 'kind' | 'label' | 'processes'>): string {
    if (c.kind === 'start') return `🟢 Krenuo nalog: ${c.label}`;
    if (c.kind === 'gate') return `⚠️ ${c.label}: počelo ${listProcesses(c.processes)}`;
    return `🔔 ${c.label}: uskoro ${listProcesses(c.processes)}`;
}

function cut(s: string, max = 58): string {
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Otvorena provjera: redovi za označavanje + dug rok. */
export function checkMessage(c: CheckView): { text: string; buttons: ButtonRows } {
    const lines = [checkHeader(c)];
    const shown = c.rows.slice(0, MAX_ROWS);
    if (shown.length) {
        lines.push(c.kind === 'gate' ? 'Ovo još nije tu — označi šta jeste:'
            : c.kind === 'start' && c.processes.length ? `${c.processes.join(', ')} — označi šta je tu:` : 'Označi šta je tu:');
        if (c.rows.length > shown.length) lines.push(`(+${c.rows.length - shown.length} u ERP-u → nalog → Materijal)`);
    }
    if (c.longLead.length) {
        lines.push('', '⏳ Dug rok isporuke, a nije naručeno:');
        c.longLead.forEach(r => lines.push(`• ${rowLabel(r, { state: false })}${r.process ? ` (${lower(r.process)})` : ''}`));
    }

    const buttons: ButtonRows = shown.map((r, i) => [{
        text: cut(`${c.selected.includes(i) ? '☑' : '☐'} ${rowLabel(r)}`),
        data: `mc:${c.id}:t:${i}`,
    }]);
    if (shown.length) {
        buttons.push([
            { text: '✔ Sve je tu', data: `mc:${c.id}:all` },
            { text: c.selected.length ? `Potvrdi (${c.selected.length})` : 'Ništa nije tu', data: `mc:${c.id}:ok` },
        ]);
    }
    if (c.longLead.length) buttons.push([{ text: '📄 Naruči dug rok', data: `mc:${c.id}:long` }]);
    return { text: lines.join('\n'), buttons };
}

/** Šta se radi s onim što nije tu. */
export function needsOrder(r: GateRow): boolean {
    return (r.state === 'missing' && r.order?.status !== 'Nacrt') || r.state === 'stock';
}

/** Odgovor poslije „Potvrdi": šta je tu, šta se čeka, šta fali. */
export function answeredMessage(c: CheckView, marked: GateRow[], rest: GateRow[]): { text: string; buttons: ButtonRows } {
    const lines = [checkHeader(c)];
    if (marked.length) lines.push(`✔ Tu: ${marked.map(r => r.name).join(', ')}`);
    const waiting = rest.filter(r => r.state === 'ordered' || r.state === 'partial');
    const draft = rest.filter(r => r.state === 'missing' && r.order?.status === 'Nacrt');
    const missing = rest.filter(r => r.state === 'missing' && r.order?.status !== 'Nacrt');
    const noStock = rest.filter(r => r.state === 'stock');
    waiting.forEach(r => lines.push(`🚚 Čeka se: ${r.name} — ${stateNote(r)}`));
    draft.forEach(r => lines.push(`📝 U nacrtu: ${r.name} — ${stateNote(r)}, nije poslano`));
    missing.forEach(r => lines.push(`✖ Fali: ${r.name} — nije naručeno`));
    noStock.forEach(r => lines.push(`📦 Nema na zalihi: ${r.name}`));
    if (!rest.length) lines.push('Sve je tu 👍');

    const buttons: ButtonRows = [];
    if (missing.length || noStock.length) buttons.push([{ text: '📄 Naruči što fali', data: `mc:${c.id}:ord` }]);
    if (rest.length) buttons.push([{ text: '⏰ Pitaj sutra', data: `mc:${c.id}:snz` }]);
    if (marked.length) buttons.push([{ text: '↩️ Poništi', data: `undo:mc-${c.id}` }]);
    return { text: lines.join('\n'), buttons };
}
