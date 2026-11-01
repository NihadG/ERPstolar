// ════════════════════════════════════════════════════════════════════
// PDF TABELE NA SERVERU — za Telegram („napravi tabelu…")
//
// Crta TableDoc (lib/tables/table) jsPDF-om, istim fontom i zaglavljem
// firme kao PDF narudžbe: naslov, šta je ERP razumio (podnaslov), kolone
// s rednim brojem, grupe, zbir i napomene. Širine kolona iz sadržaja,
// dug tekst se prelama; zaglavlje kolona se ponavlja na svakoj strani.
// Više od 5 kolona ili širok sadržaj → A4 položeno.
// ════════════════════════════════════════════════════════════════════

import { jsPDF } from 'jspdf';
import { registerPdfFonts, type PdfCompany } from './orderPdf';
import type { TableDoc } from '@/lib/tables/table';

const M = 12;                       // margina
const GRAY = 134;                   // #86868b
const INK = 29;                     // #1d1d1f
const PAD = 2;                      // unutrašnja margina ćelije
const LINE = 4.1;                   // visina reda teksta (9 pt)
const MAX_COL = 95;
const MIN_COL = 12;

interface Col {
    label: string;
    align: 'left' | 'right';
    width: number;
}

/** Širine: prirodna širina sadržaja; preširoko → suze se samo široke kolone, uže → šire se tekstualne. */
export function fitWidths(natural: number[], total: number, grow: boolean[]): number[] {
    const sum = natural.reduce((s, w) => s + w, 0);
    if (sum <= total) {
        const growable = natural.map((w, i) => (grow[i] ? w : 0));
        const g = growable.reduce((s, w) => s + w, 0);
        if (!g) return natural;
        return natural.map((w, i) => w + (total - sum) * growable[i] / g);
    }
    const widths = [...natural];
    let fixed = new Set<number>();
    for (let pass = 0; pass < natural.length; pass++) {
        const fixedSum = Array.from(fixed).reduce((s, i) => s + widths[i], 0);
        const free = natural.map((_, i) => i).filter(i => !fixed.has(i));
        const share = (total - fixedSum) / Math.max(1, free.length);
        const narrow = free.filter(i => natural[i] <= share);
        if (!narrow.length) {
            const wide = free.reduce((s, i) => s + natural[i], 0);
            free.forEach(i => { widths[i] = Math.max(MIN_COL, (total - fixedSum) * natural[i] / wide); });
            break;
        }
        fixed = new Set([...Array.from(fixed), ...narrow]);
    }
    return widths;
}

export function buildTablePdf(table: TableDoc, company: PdfCompany, printedAt: string): Buffer {
    const probe = new jsPDF({ unit: 'mm', format: 'a4' });
    const FONT = registerPdfFonts(probe);
    const font = (doc: jsPDF, size: number, style: 'normal' | 'bold' = 'normal', color = INK) => {
        doc.setFont(FONT, style);
        doc.setFontSize(size);
        doc.setTextColor(color);
    };

    // ── Kolone: redni broj + kolone tabele ──
    const rows = table.groups.flatMap(g => g.rows);
    const heads = ['#', ...table.columns.map(c => c.label)];
    const aligns: ('left' | 'right')[] = ['right', ...table.columns.map(c => c.align)];
    const natural = heads.map((h, i) => {
        font(probe, 8.5, 'bold');
        let w = Math.min(probe.getTextWidth(h), 30);
        font(probe, 9);
        if (i === 0) w = Math.max(w, probe.getTextWidth(String(rows.length)));
        else for (const r of rows) w = Math.max(w, probe.getTextWidth(r[i - 1] || ''));
        if (table.total?.[i - 1]) w = Math.max(w, probe.getTextWidth(table.total[i - 1]) * 1.08);
        return Math.min(MAX_COL, w + PAD * 2 + 0.5);
    });
    const portraitW = 210 - M * 2;
    const landscape = heads.length > 6 || natural.reduce((s, w) => s + w, 0) > portraitW * 1.15;
    const PAGE_W = landscape ? 297 : 210;
    const PAGE_H = landscape ? 210 : 297;
    const W = PAGE_W - M * 2;
    const widths = fitWidths(natural, W, aligns.map((a, i) => i > 0 && a === 'left'));
    const cols: Col[] = heads.map((label, i) => ({ label, align: aligns[i], width: widths[i] }));

    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: landscape ? 'landscape' : 'portrait' });
    registerPdfFonts(doc);
    let y = M;

    // ── Zaglavlje: firma lijevo, datum desno, pa naslov i šta je ERP razumio ──
    let logoH = 0;
    if (company.logoBase64?.startsWith('data:image/')) {
        try {
            const props = doc.getImageProperties(company.logoBase64);
            const scale = Math.min(36 / props.width, 11 / props.height);
            logoH = props.height * scale;
            doc.addImage(company.logoBase64, M, y, props.width * scale, logoH);
        } catch { logoH = 0; /* neispravan logo ne ruši PDF */ }
    }
    if (!logoH || !company.hideNameWhenLogo) {
        font(doc, 9.5, 'bold', 80);
        doc.text(company.name || '', logoH ? M + 40 : M, y + 4.5);
    }
    font(doc, 9, 'normal', GRAY);
    doc.text(printedAt, PAGE_W - M, y + 4.5, { align: 'right' });
    y += Math.max(logoH, 6) + 6;
    font(doc, 15, 'bold');
    const title = doc.splitTextToSize(table.title, W) as string[];
    doc.text(title, M, y);
    y += title.length * 6.2;
    font(doc, 9.5, 'normal', GRAY);
    const sub = doc.splitTextToSize(table.subtitle, W) as string[];
    doc.text(sub, M, y);
    y += sub.length * 4.4 + 4;

    const xOf = (i: number) => M + cols.slice(0, i).reduce((s, c) => s + c.width, 0);
    const cellX = (i: number) => (cols[i].align === 'right' ? xOf(i) + cols[i].width - PAD : xOf(i) + PAD);
    const wrap = (text: string, i: number) => doc.splitTextToSize(text || '', cols[i].width - PAD * 2) as string[];

    const header = () => {
        font(doc, 8.5, 'bold', 80);
        const lines = cols.map((c, i) => wrap(c.label, i));
        const h = Math.max(...lines.map(l => l.length)) * 3.8 + 3.6;
        doc.setFillColor(245, 245, 247);
        doc.rect(M, y, W, h, 'F');
        lines.forEach((l, i) => doc.text(l, cellX(i), y + 4.6, { align: cols[i].align }));
        y += h;
    };
    const ensure = (h: number) => {
        if (y + h <= PAGE_H - M - 6) return;
        doc.addPage();
        y = M;
        header();
    };

    header();
    let n = 0;
    for (const group of table.groups) {
        if (group.label) {
            ensure(7.5 + 8);
            doc.setFillColor(250, 250, 252);
            doc.rect(M, y, W, 7.5, 'F');
            font(doc, 9.5, 'bold');
            doc.text(group.label, M + PAD, y + 5.1);
            y += 7.5;
        }
        for (const row of group.rows) {
            n += 1;
            font(doc, 9);
            const cells = [String(n), ...row].map((t, i) => wrap(t, i));
            const h = Math.max(...cells.map(c => c.length)) * LINE + 3.4;
            ensure(h);
            cells.forEach((c, i) => {
                font(doc, 9, 'normal', i === 0 ? GRAY : INK);
                doc.text(c, cellX(i), y + 4.6, { align: cols[i].align });
            });
            y += h;
            doc.setDrawColor(236);
            doc.line(M, y, M + W, y);
        }
    }

    // ── Zbir ──
    if (table.total) {
        const cells = ['', ...table.total];
        const labelAt = cells.findIndex((t, i) => i > 0 && !t && cols[i].align === 'left');
        if (labelAt > 0) cells[labelAt] = 'Ukupno';
        ensure(8);
        doc.setDrawColor(200);
        doc.line(M, y, M + W, y);
        font(doc, 9.5, 'bold');
        // Bez prelamanja: zbir je kratak, a „Ukupno" smije preći u prazne kolone desno.
        cells.forEach((t, i) => { if (t) doc.text(t, cellX(i), y + 5.4, { align: cols[i].align }); });
        y += 8;
    }

    // ── Napomene ──
    if (table.notes.length) {
        y += 3;
        font(doc, 8.5, 'normal', GRAY);
        for (const note of table.notes) {
            const lines = doc.splitTextToSize(note, W) as string[];
            if (y + lines.length * 4 > PAGE_H - M - 6) {
                doc.addPage();
                y = M;
            }
            doc.text(lines, M, y + 3);
            y += lines.length * 4 + 1;
        }
    }

    // ── Podnožje svake strane ──
    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
        doc.setPage(p);
        font(doc, 7.5, 'normal', GRAY);
        doc.text(table.title, M, PAGE_H - M + 2);
        doc.text(`Strana ${p}/${pages}`, PAGE_W - M, PAGE_H - M + 2, { align: 'right' });
    }

    return Buffer.from(doc.output('arraybuffer'));
}
