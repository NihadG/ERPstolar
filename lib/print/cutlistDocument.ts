// ════════════════════════════════════════════════════════════════════
// DOKUMENT KROJNE LISTE — štampa i PDF (isti layout, kao ponuda/narudžba)
//
// Strana 1: sažetak (grupe materijala, broj ploča, iskorištenost, kant
// traka) + kompletna lista komada grupisana po materijalu.
// Zatim JEDNA STRANA PO PLOČI: zaglavlje s NAZIVOM MATERIJALA (stari
// cutlist.html ga nije prikazivao), SVG crtež rasporeda s brojevima
// komada i crvenim linijama rezova, pa tabela komada te ploče.
//
// Crtež je SVG (ne apsolutno pozicionirani divovi) — rasterizacija u
// pdfExport ostaje oštra na 300 DPI i ne pravi ogromne canvase koji su
// u starom cutlist.html rušili jsPDF (RangeError: Invalid string length).
// ════════════════════════════════════════════════════════════════════

import type { ProductCutList, CutlistSheetRecord } from '../types';
import type { PrintDocument } from './types';

export interface CutlistPrintInput {
    cutList: ProductCutList;
    productName?: string;
    projectName?: string;
}

function esc(s: string): string {
    return (s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function fmtDate(iso: string): string {
    if (!iso) return '-';
    return new Date(iso).toLocaleDateString('hr-HR');
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
        max-width: 780px;
        margin: 20px auto;
        background: white;
        padding: 40px 40px;
        box-shadow: 0 1px 8px rgba(0,0,0,0.08);
    }
    .page-break { page-break-after: always; }

    .doc-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        padding-bottom: 14px;
        border-bottom: 2px solid #e8e8e8;
        margin-bottom: 18px;
    }
    .doc-title { font-size: 20px; font-weight: 700; color: #111; }
    .doc-sub { font-size: 11px; color: #777; margin-top: 3px; }
    .doc-meta { text-align: right; font-size: 11px; color: #555; }
    .doc-meta strong { font-size: 13px; color: #111; }

    .summary-table, .parts-table {
        width: 100%;
        border-collapse: collapse;
        margin-bottom: 18px;
        font-size: 11px;
    }
    .summary-table th, .parts-table th {
        text-align: left;
        background: #f4f4f5;
        color: #555;
        font-weight: 600;
        padding: 6px 8px;
        border-bottom: 1px solid #ddd;
        text-transform: uppercase;
        font-size: 9.5px;
        letter-spacing: 0.03em;
    }
    .summary-table td, .parts-table td {
        padding: 5px 8px;
        border-bottom: 1px solid #eee;
        vertical-align: top;
    }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .center { text-align: center; }

    /* Dvije tabele komada jedna do druge ispod crteža ploče. */
    .sheet-tables { display: flex; gap: 14px; align-items: flex-start; }
    .sheet-tables .parts-table { flex: 1; margin-bottom: 0; }
    .parts-table.compact { font-size: 10px; }
    .parts-table.compact td { padding: 3px 6px; }
    .parts-table.compact th { padding: 4px 6px; font-size: 9px; }

    .group-heading {
        font-size: 13px;
        font-weight: 700;
        color: #111;
        margin: 14px 0 6px;
        padding: 5px 8px;
        background: #f4f4f5;
        border-left: 3px solid #b45309;
    }

    .sheet-header {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        margin-bottom: 10px;
    }
    .sheet-title { font-size: 15px; font-weight: 700; color: #111; }
    .sheet-material { color: #b45309; }
    .sheet-stats { font-size: 11px; color: #555; }
    .sheet-stats strong { color: #111; }

    .board-svg {
        width: 100%;
        height: auto;
        border: 1px solid #cbd5e1;
        margin-bottom: 12px;
        background: white;
    }

    .totals-line {
        margin: 6px 0 16px;
        font-size: 12px;
        color: #333;
    }
    .totals-line strong { font-size: 14px; }
`;

/** Procijenjena širina teksta u mm (SVG jedinicama) za dati font. */
function textWidth(text: string, size: number, mono: boolean): number {
    return text.length * size * (mono ? 0.62 : 0.55);
}

/** Skrati tekst da stane u `avail`; '' ako ni skraćeno nema smisla. */
function fitText(text: string, avail: number, size: number, mono = false): string {
    if (textWidth(text, size, mono) <= avail) return text;
    const per = size * (mono ? 0.62 : 0.55);
    const max = Math.floor(avail / per);
    if (max < 3) return '';
    return `${text.slice(0, max - 1)}…`;
}

/**
 * SVG crtež jedne ploče. Koordinate = mm (viewBox u dimenzijama ploče).
 * Izvezeno da i CutlistModal (pregled na ekranu) crta ISTIM kodom.
 *
 * OZNAKE SU FIKSNE VELIČINE za cijelu ploču — mali komad dobija jednako
 * krupan broj kao i veliki. (Ranije se font skalirao po komadu, pa je
 * ista lista imala i nečitljivo sitne i nepotrebno krupne natpise.) Kad
 * natpis ne stane, SKRAĆUJE SE ili se izostavlja — nikad ne smanjuje.
 */
export function renderSheetSvg(sheet: CutlistSheetRecord, boardW: number, boardH: number, trim: number): string {
    const fontBase = Math.max(boardW, boardH) / 80;
    /** Dimenzije uz rubove komada. */
    const DIM_SIZE = fontBase * 1.1;
    /** Redni broj + naziv. */
    const NAME_SIZE = fontBase * 0.98;
    const parts: string[] = [];

    parts.push(`<svg class="board-svg" viewBox="-1 -1 ${boardW + 2} ${boardH + 2}" xmlns="http://www.w3.org/2000/svg">`);
    // Cijela ploča + zona obreza (ako postoji).
    parts.push(`<rect x="0" y="0" width="${boardW}" height="${boardH}" fill="#f8fafc" stroke="#64748b" stroke-width="${fontBase / 8}"/>`);
    if (trim > 0) {
        parts.push(`<rect x="${trim}" y="${trim}" width="${boardW - 2 * trim}" height="${boardH - 2 * trim}" fill="white" stroke="#e2e8f0" stroke-width="${fontBase / 14}" stroke-dasharray="${fontBase} ${fontBase}"/>`);
    }

    // Iskoristivi ostaci — ispod komada, zeleno: ono što se vraća na policu.
    // (Starije snimljene liste nemaju X/Y, pa se te zone ne crtaju.)
    for (const o of sheet.Offcuts || []) {
        if (o.X === undefined || o.Y === undefined) continue;
        const ox = o.X + trim;
        const oy = o.Y + trim;
        parts.push(`<rect x="${ox}" y="${oy}" width="${o.W}" height="${o.H}" fill="#ecfdf5" stroke="#10b981" stroke-width="${fontBase / 12}" stroke-dasharray="${fontBase * 0.6} ${fontBase * 0.4}"/>`);
        const portrait = o.H > o.W;
        const label = fitText(`ostatak ${o.W}×${o.H}`, (portrait ? o.H : o.W) * 0.9, NAME_SIZE);
        if (label && Math.min(o.W, o.H) >= NAME_SIZE * 1.25) {
            const ocx = ox + o.W / 2;
            const ocy = oy + o.H / 2;
            const rot = portrait ? ` transform="rotate(-90 ${ocx} ${ocy})"` : '';
            parts.push(`<text x="${ocx}" y="${ocy}" text-anchor="middle" dominant-baseline="central" font-size="${NAME_SIZE}" font-weight="600" fill="#047857"${rot}>${label}</text>`);
        }
    }

    // Komadi — koordinate rasporeda su u KORISNOJ površini → pomak za trim.
    sheet.Placements.forEach((p, i) => {
        const x = p.X + trim;
        const y = p.Y + trim;
        parts.push(`<rect x="${x}" y="${y}" width="${p.W}" height="${p.H}" fill="#fffbeb" stroke="#b45309" stroke-width="${fontBase / 10}"/>`);

        const cx = x + p.W / 2;
        const cy = y + p.H / 2;
        const portrait = p.H > p.W;
        const longSide = portrait ? p.H : p.W;
        const shortSide = portrait ? p.W : p.H;
        const suffix = p.Rotated ? ' ⟳' : '';

        const wTxt = String(Math.round(p.W));
        const hTxt = String(Math.round(p.H));
        const inset = DIM_SIZE * 0.78;
        // Rubne dimenzije traže pojas visine ~1.6×font po obje ose (broj +
        // zrak), a natpis mora stati duž ruba koji označava.
        const edgeFits =
            p.H >= DIM_SIZE * 2.9 && p.W >= DIM_SIZE * 2.9
            && textWidth(wTxt, DIM_SIZE, true) <= p.W - inset
            && textWidth(hTxt, DIM_SIZE, true) <= p.H - inset;

        if (edgeFits) {
            // Širina uz gornji rub, visina uz lijevi rub (okrenuta 90°).
            parts.push(`<text x="${cx}" y="${y + inset}" text-anchor="middle" dominant-baseline="central" font-size="${DIM_SIZE}" font-weight="700" font-family="monospace" fill="#78350f">${wTxt}</text>`);
            parts.push(`<text x="${x + inset}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-size="${DIM_SIZE}" font-weight="700" font-family="monospace" fill="#78350f" transform="rotate(-90 ${x + inset} ${cy})">${hTxt}</text>`);

            // Redni broj + naziv — duž DUŽE strane (uspravno na portretnim),
            // u površini iza rubnih oznaka; predug naziv se skraćuje.
            const band = inset * 1.7;
            const label = fitText(`${i + 1}. ${p.Name}${suffix}`, longSide - band, NAME_SIZE);
            if (label && shortSide - band >= NAME_SIZE * 1.15) {
                const ncx = x + (p.W + band) / 2;
                const ncy = y + (p.H + band) / 2;
                const rot = portrait ? ` transform="rotate(-90 ${ncx} ${ncy})"` : '';
                parts.push(`<text x="${ncx}" y="${ncy}" text-anchor="middle" dominant-baseline="central" font-size="${NAME_SIZE}" font-weight="600" fill="#b45309"${rot}>${esc(label)}</text>`);
            }
        } else if (shortSide >= NAME_SIZE * 1.25) {
            // Uski komad (traka, letvica): JEDAN red duž duže strane —
            // "3. Polica 1488×80" → skraćuje se dok stane, font ostaje isti.
            const rot = portrait ? ` transform="rotate(-90 ${cx} ${cy})"` : '';
            const full = `${i + 1}. ${p.Name}${suffix}  ${wTxt}×${hTxt}`;
            const label = fitText(full, longSide * 0.92, NAME_SIZE)
                || fitText(`${i + 1}. ${wTxt}×${hTxt}`, longSide * 0.92, NAME_SIZE)
                || fitText(`${i + 1}`, longSide * 0.92, NAME_SIZE);
            if (label) {
                parts.push(`<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-size="${NAME_SIZE}" font-weight="600" fill="#78350f"${rot}>${esc(label)}</text>`);
            }
        }
    });

    // Linije rezova — crvene isprekidane, preko trenutne zone.
    for (const c of sheet.Cuts) {
        parts.push(`<line x1="${c.X1 + trim}" y1="${c.Y1 + trim}" x2="${c.X2 + trim}" y2="${c.Y2 + trim}" stroke="#dc2626" stroke-width="${fontBase / 12}" stroke-dasharray="${fontBase / 2} ${fontBase / 2}" opacity="0.65"/>`);
    }

    parts.push('</svg>');
    return parts.join('');
}

/** Sastavi dokument krojne liste za štampu/PDF. */
export function buildCutlistPrintDocument({ cutList, productName, projectName }: CutlistPrintInput): PrintDocument {
    const usableArea = (g: { Board_Width: number; Board_Height: number }) => {
        const t = cutList.Settings.Trim;
        return (g.Board_Width - 2 * t) * (g.Board_Height - 2 * t);
    };

    // ── Strana 1: sažetak ────────────────────────────────────────────
    const summaryRows = cutList.Groups.map(g => {
        const avgEff = g.Sheets.length
            ? g.Sheets.reduce((s, sh) => s + sh.Efficiency, 0) / g.Sheets.length
            : 0;
        const reuse = g.Sheets.reduce(
            (s, sh) => s + (sh.Offcuts || []).reduce((a, o) => a + o.W * o.H, 0), 0) / 1e6;
        return `<tr>
            <td>${esc(g.Material_Label)}</td>
            <td class="num">${g.Board_Width} × ${g.Board_Height}</td>
            <td class="num"><strong>${g.Sheets.length}</strong></td>
            <td class="num">${avgEff.toFixed(1)}%</td>
            <td class="num">${reuse > 0.01 ? reuse.toFixed(2) + ' m²' : '—'}</td>
            <td class="num">${g.Edge_Banding_M ? g.Edge_Banding_M.toFixed(1) + ' m' : '—'}</td>
        </tr>`;
    }).join('');

    const headerHtml = (subtitle: string) => `
        <div class="doc-header">
            <div>
                <div class="doc-title">Krojna lista — ${esc(cutList.Name)}</div>
                <div class="doc-sub">${subtitle}</div>
            </div>
            <div class="doc-meta">
                ${productName ? `<div><strong>${esc(productName)}</strong></div>` : ''}
                ${projectName ? `<div>${esc(projectName)}</div>` : ''}
                <div>${fmtDate(cutList.Created_At)}</div>
            </div>
        </div>`;

    const settingsLine = `Rez ${cutList.Settings.Kerf} mm • obrez ruba ${cutList.Settings.Trim} mm`;

    // Strana 1 = SAMO sažetak (zaglavlje + tabela grupa + ukupno) — bez
    // liste komada; komadi se vide na strani svake ploče.
    const summaryPage = `<div class="page page-break">
        ${headerHtml(settingsLine)}
        <table class="summary-table">
            <thead><tr>
                <th>Materijal</th><th class="num" style="width:110px">Ploča (mm)</th>
                <th class="num" style="width:60px">Ploča kom</th><th class="num" style="width:90px">Iskorišteno</th>
                <th class="num" style="width:90px">Ostatak za dalje</th>
                <th class="num" style="width:80px">Kant traka</th>
            </tr></thead>
            <tbody>${summaryRows}</tbody>
        </table>
        <div class="totals-line">Ukupno ploča: <strong>${cutList.Total_Sheets}</strong></div>
    </div>`;

    // ── Strane po pločama ────────────────────────────────────────────
    const sheetPages: string[] = [];
    let globalSheetNo = 0;
    for (const group of cutList.Groups) {
        group.Sheets.forEach((sheet, idx) => {
            globalSheetNo += 1;
            const waste = Math.max(0, usableArea(group) - sheet.Used_Area);

            // Tabela komada u DVIJE kolone jedna do druge (kompaktno, bez
            // kolone pozicije) — duga lista ne razvlači stranu u nedogled.
            const partRow = (p: (typeof sheet.Placements)[number], i: number) => `<tr>
                <td class="num">${i + 1}.</td>
                <td>${esc(p.Name)}</td>
                <td class="num">${Math.round(p.W)} × ${Math.round(p.H)}${p.Rotated ? ' ⟳' : ''}</td>
            </tr>`;
            const half = Math.ceil(sheet.Placements.length / 2);
            const colA = sheet.Placements.slice(0, half).map((p, i) => partRow(p, i)).join('');
            const colB = sheet.Placements.slice(half).map((p, i) => partRow(p, half + i)).join('');
            const tableHead = '<thead><tr><th style="width:26px">#</th><th>Naziv</th><th class="num" style="width:104px">Dim. (mm)</th></tr></thead>';
            const partsTables = `<div class="sheet-tables">
                <table class="parts-table compact">${tableHead}<tbody>${colA}</tbody></table>
                ${colB ? `<table class="parts-table compact">${tableHead}<tbody>${colB}</tbody></table>` : '<div style="flex:1"></div>'}
            </div>`;

            const isLast = globalSheetNo === cutList.Total_Sheets;
            const noRotation = group.Allow_Rotation === false;
            sheetPages.push(`<div class="page${isLast ? '' : ' page-break'}">
                <div class="sheet-header">
                    <div class="sheet-title">Ploča ${globalSheetNo}/${cutList.Total_Sheets} — <span class="sheet-material">${esc(group.Material_Label)}</span> <span style="font-weight:400;color:#888;">(${idx + 1}. od ${group.Sheets.length})</span></div>
                    <div class="sheet-stats">
                        ${group.Board_Width} × ${group.Board_Height} mm •
                        iskorišteno <strong>${sheet.Efficiency.toFixed(1)}%</strong> •
                        otpad ${(waste / 1e6).toFixed(2)} m² •
                        rez ${(sheet.Cut_Length / 1000).toFixed(1)} m${noRotation ? ' • bez rotacije' : ''}${(sheet.Offcuts || []).length
                            ? ` • za dalje: ${sheet.Offcuts!.map(o => `${o.W}×${o.H}`).join(', ')}`
                            : ''}
                    </div>
                </div>
                ${renderSheetSvg(sheet, group.Board_Width, group.Board_Height, cutList.Settings.Trim)}
                ${partsTables}
            </div>`);
        });
    }

    const body = summaryPage + sheetPages.join('');
    const title = `Krojna lista ${cutList.Name}`;

    const html = `<!DOCTYPE html>
<html lang="hr">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>${STYLE_CSS}</style>
<style>@media print {
    @page { size: A4 portrait; margin: 10mm 12mm 14mm; }
    ${PRINT_OVERRIDES}
}</style>
</head>
<body>${body}</body>
</html>`;

    return { html, body, css: STYLE_CSS, printOverrides: PRINT_OVERRIDES, title };
}
