// ════════════════════════════════════════════════════════════════════
// DOKUMENT PLANA (Platno) — ispis za zid radionice.
//
// Namjerno TABELA, ne Gantt: na papiru se traka od 3mm ne može pročitati, a
// radionici treba „šta, ko, kad" — ne slika. Grupisano po sekciji (obaveze,
// nalozi, narudžbe), hronološki unutar sekcije.
//
// Narudžbe nose i DATUM SLANJA, jer je to jedina stvar koju papir na zidu
// stvarno mijenja: da neko vidi da nešto mora otići danas.
//
// Isti oblik (PrintDocument) kao ponuda/narudžba/krojna lista — jedan izvor
// i za prozor štampe i za PDF izvoz.
// ════════════════════════════════════════════════════════════════════

import type { PlanScenario, PlanBlock } from '../types';
import type { PrintDocument } from './types';
import { BLOCK_LABEL, blockDurationDays } from '../canvas/model';
import type { Conflict } from '../canvas/conflicts';

export interface PlanPrintInput {
    scenario: PlanScenario;
    /** Problemi se štampaju uz plan — inače papir izgleda urednije nego stvarnost. */
    conflicts?: Conflict[];
    companyName?: string;
}

function esc(s: string): string {
    return (s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** dd.mm.yyyy — isti oblik kao ostatak aplikacije (hr-HR). */
function fmt(iso: string): string {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-');
    return `${Number(d)}.${Number(m)}.${y}.`;
}

const DOW = ['ned', 'pon', 'uto', 'sri', 'čet', 'pet', 'sub'];
function dow(iso: string): string {
    if (!iso) return '';
    return DOW[new Date(`${iso}T12:00:00`).getDay()] || '';
}

const PRINT_OVERRIDES = `
    body {
        background: white !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
    }
    .page {
        box-shadow: none;
        padding: 0;
        margin: 0;
        max-width: none;
    }
`;

const STYLE_CSS = `
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
        font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif;
        font-size: 12px;
        line-height: 1.45;
        color: #1a1a1a;
        background: #f8f8f8;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
    }

    .page {
        max-width: 1080px;
        margin: 20px auto;
        background: white;
        padding: 32px 36px;
        box-shadow: 0 1px 8px rgba(0,0,0,0.08);
    }

    .head {
        display: flex;
        justify-content: space-between;
        align-items: flex-end;
        border-bottom: 2px solid #1a1a1a;
        padding-bottom: 10px;
        margin-bottom: 6px;
    }
    .head h1 { font-size: 20px; letter-spacing: -0.02em; }
    .head .meta { text-align: right; font-size: 11px; color: #666; line-height: 1.6; }

    /* Papir mora reći da ovo NIJE nalog — inače neko krene raditi po njemu */
    .disclaimer {
        font-size: 10.5px;
        color: #888;
        margin-bottom: 18px;
        font-style: italic;
    }

    h2 {
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: #666;
        margin: 20px 0 7px;
        padding-bottom: 4px;
        border-bottom: 1px solid #ddd;
    }

    table { width: 100%; border-collapse: collapse; }
    th {
        text-align: left;
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: #888;
        padding: 5px 6px;
        border-bottom: 1px solid #ddd;
        font-weight: 600;
    }
    td {
        padding: 6px;
        border-bottom: 1px solid #f0f0f0;
        vertical-align: top;
    }
    tr { page-break-inside: avoid; }
    .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .dim { color: #888; font-size: 11px; }
    .strong { font-weight: 600; }

    .kind {
        display: inline-block;
        padding: 1px 7px;
        border-radius: 9px;
        font-size: 9.5px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.03em;
        color: #fff;
        white-space: nowrap;
    }
    .k-order { background: #0071e3; }
    .k-purchase { background: #c77700; }
    .k-transport { background: #6b6b70; }
    .k-montaza { background: #5856d6; }
    .k-milestone { background: #d0342c; }
    .k-note { background: #8a7050; }

    .locked::after { content: ' 🔒'; }

    .problems li { margin-left: 16px; font-size: 11px; padding: 1px 0; }
    .problems .err { color: #b3261e; font-weight: 600; }

    .empty { color: #999; font-style: italic; padding: 10px 6px; }
    .foot { margin-top: 22px; font-size: 10px; color: #999; text-align: center; }
`;

/** Sekcije ispisa — isti redoslijed kao na platnu (obaveze prvo, one su fiksne). */
const SECTIONS: { title: string; kinds: PlanBlock['kind'][] }[] = [
    { title: 'Obaveze — rokovi, montaže i transport', kinds: ['milestone', 'montaza', 'transport'] },
    { title: 'Nalozi', kinds: ['order'] },
    { title: 'Narudžbe materijala', kinds: ['purchase'] },
    { title: 'Napomene', kinds: ['note'] },
];

function rowsFor(blocks: PlanBlock[], isPurchase: boolean): string {
    return blocks.map(b => {
        const who = (b.workerRefs || []).map(w => w.name).join(', ');
        const products = (b.productRefs || []).map(p => `${p.name}${p.qty > 1 ? ` ×${p.qty}` : ''}`).join(', ');

        // Narudžba: kad ŠALJEŠ i kad STIŽE. Nalog: raspon + koliko posla.
        const when = isPurchase
            ? `<td class="num strong">${fmt(b.orderByISO || b.startISO)}</td>
               <td class="num">${fmt(b.endISO)}</td>`
            : `<td class="num strong">${fmt(b.startISO)} <span class="dim">${dow(b.startISO)}</span></td>
               <td class="num">${b.kind === 'milestone' ? '—' : `${fmt(b.endISO)} <span class="dim">${dow(b.endISO)}</span>`}</td>`;

        const detail = isPurchase
            ? esc(b.supplierRef?.name || '') + (b.materialNames?.length ? ` <span class="dim">(${b.materialNames.length} stavki)</span>` : '')
            : esc(who || products || '');

        const effort = isPurchase
            ? (b.leadDays !== undefined ? `${b.leadDays} d` : '—')
            : b.workerDays
                ? `${b.workerDays} rd ÷ ${b.crew || 1}`
                : b.kind === 'milestone' ? '—' : `${blockDurationDays(b)} d`;

        return `<tr>
            <td><span class="kind k-${b.kind}">${esc(BLOCK_LABEL[b.kind])}</span></td>
            <td class="strong${b.locked ? ' locked' : ''}">${esc(b.title)}</td>
            <td>${esc(b.projectRef?.name || '')}</td>
            ${when}
            <td class="num">${effort}</td>
            <td>${detail}</td>
        </tr>`;
    }).join('');
}

export function buildPlanDocument(input: PlanPrintInput): PrintDocument {
    const { scenario, conflicts = [], companyName } = input;

    const sections = SECTIONS.map(sec => {
        const blocks = scenario.Blocks
            .filter(b => sec.kinds.includes(b.kind))
            .sort((a, b) => a.startISO.localeCompare(b.startISO) || a.title.localeCompare(b.title, 'hr'));
        if (blocks.length === 0) return '';

        const isPurchase = sec.kinds[0] === 'purchase';
        return `<h2>${esc(sec.title)}</h2>
        <table>
            <thead><tr>
                <th style="width:78px">Vrsta</th>
                <th>Naziv</th>
                <th style="width:150px">Projekt</th>
                <th style="width:110px" class="num">${isPurchase ? 'Naruči' : 'Početak'}</th>
                <th style="width:110px" class="num">${isPurchase ? 'Stiže' : 'Kraj'}</th>
                <th style="width:80px" class="num">${isPurchase ? 'Rok' : 'Posao'}</th>
                <th style="width:200px">${isPurchase ? 'Dobavljač' : 'Radnici / proizvodi'}</th>
            </tr></thead>
            <tbody>${rowsFor(blocks, isPurchase)}</tbody>
        </table>`;
    }).filter(Boolean).join('');

    const problems = conflicts.length > 0
        ? `<h2>Problemi (${conflicts.length})</h2>
           <ul class="problems">${conflicts.slice(0, 30).map(c =>
            `<li class="${c.severity === 'error' ? 'err' : ''}">${esc(c.message)}</li>`).join('')}</ul>`
        : '';

    const printedAt = new Date().toLocaleString('hr-HR', {
        day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });

    const body = `<div class="page">
        <div class="head">
            <div>
                <h1>${esc(scenario.Name)}</h1>
            </div>
            <div class="meta">
                ${companyName ? `${esc(companyName)}<br>` : ''}
                Plan proizvodnje<br>
                Štampano ${esc(printedAt)}
            </div>
        </div>
        <p class="disclaimer">
            Ovo je PLAN, ne radni nalog — datumi nisu zaključani i ne mijenjaju
            stanje u sistemu.
        </p>
        ${sections || '<p class="empty">Plan je prazan.</p>'}
        ${problems}
        <div class="foot">${scenario.Blocks.length} blokova · ${scenario.Links.length} veza</div>
    </div>`;

    const title = `Plan — ${scenario.Name}`;

    const html = `<!DOCTYPE html>
<html lang="hr">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>${STYLE_CSS}</style>
<style>@media print {
    @page { size: A4 landscape; margin: 10mm 12mm 12mm; }
    ${PRINT_OVERRIDES}
}</style>
</head>
<body>${body}</body>
</html>`;

    return { html, body, css: STYLE_CSS, printOverrides: PRINT_OVERRIDES, title };
}
