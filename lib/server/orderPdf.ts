// ════════════════════════════════════════════════════════════════════
// PDF NARUDŽBE NA SERVERU — za Telegram
//
// ERP pravi PDF u pregledaču (HTML → html2canvas → jsPDF, lib/pdfExport).
// Na serveru nema pregledača, pa se isti raspored crta direktno jsPDF-om:
// zaglavlje firme, broj i datum, dobavljač, materijali, stakla, alu vrata,
// napomena i očekivana dostava. Razvrstavanje stavki je ISTO kao u ERP-u
// (classifyOrderItems iz lib/print/orderDocument).
//
// Font: DejaVu Sans (assets/fonts) — standardni PDF fontovi nemaju č, ć, đ.
// ════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { jsPDF } from 'jspdf';
import { classifyOrderItems } from '@/lib/print/orderDocument';
import { formatQty } from '@/lib/orderItemGroups';
import { formatDate } from '@/lib/utils';
import type { Order, Project, ProductMaterial, Supplier } from '@/lib/types';

export interface PdfCompany {
    name?: string;
    address?: string;
    phone?: string;
    email?: string;
    logoBase64?: string;
    hideNameWhenLogo?: boolean;
}

const FONT = 'DejaVu';
let fontCache: { regular: string; bold: string } | null = null;

function fonts(): { regular: string; bold: string } {
    if (!fontCache) {
        const dir = path.join(process.cwd(), 'assets', 'fonts');
        fontCache = {
            regular: fs.readFileSync(path.join(dir, 'DejaVuSans.ttf')).toString('base64'),
            bold: fs.readFileSync(path.join(dir, 'DejaVuSans-Bold.ttf')).toString('base64'),
        };
    }
    return fontCache;
}

const PAGE_W = 210;
const PAGE_H = 297;
const M = 14;                       // margina
const W = PAGE_W - M * 2;
const GRAY = 134;                   // #86868b
const INK = 29;                     // #1d1d1f

function area(pieces: { Qty?: unknown; Width?: unknown; Height?: unknown }[]): number {
    return pieces.reduce((s, p) => s + (parseFloat(String(p.Width)) || 0) * (parseFloat(String(p.Height)) || 0) / 1e6 * (parseInt(String(p.Qty)) || 1), 0);
}

export function buildOrderPdf(input: { order: Order; supplier?: Supplier; specs: ProductMaterial[]; company: PdfCompany }): Buffer {
    const { order, supplier, company } = input;
    const projects = [{ products: [{ materials: input.specs }] }] as unknown as Project[];
    const { regular, glass, aluDoors } = classifyOrderItems(order, projects);

    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const f = fonts();
    doc.addFileToVFS('DejaVuSans.ttf', f.regular);
    doc.addFont('DejaVuSans.ttf', FONT, 'normal');
    doc.addFileToVFS('DejaVuSans-Bold.ttf', f.bold);
    doc.addFont('DejaVuSans-Bold.ttf', FONT, 'bold');

    let y = M;
    const font = (size: number, style: 'normal' | 'bold' = 'normal', color = INK) => {
        doc.setFont(FONT, style);
        doc.setFontSize(size);
        doc.setTextColor(color);
    };
    const ensure = (h: number, onBreak?: () => void) => {
        if (y + h <= PAGE_H - M) return;
        doc.addPage();
        y = M;
        onBreak?.();
    };

    // ── Zaglavlje ──
    let logoH = 0;
    if (company.logoBase64?.startsWith('data:image/')) {
        try {
            const props = doc.getImageProperties(company.logoBase64);
            const scale = Math.min(48 / props.width, 16 / props.height);
            logoH = props.height * scale;
            doc.addImage(company.logoBase64, M, y, props.width * scale, logoH);
        } catch { logoH = 0; /* neispravan logo ne ruši PDF */ }
    }
    let left = y + (logoH ? logoH + 3 : 0);
    if (!logoH || !company.hideNameWhenLogo) {
        font(15, 'bold');
        doc.text(company.name || 'Narudžba', M, left + 5);
        left += 8;
    }
    font(8.5, 'normal', GRAY);
    for (const line of [company.address, [company.phone, company.email].filter(Boolean).join(' · ')].filter(Boolean) as string[]) {
        doc.text(line, M, left + 3);
        left += 4;
    }
    font(12, 'bold');
    doc.text(`Narudžba: ${order.Order_Number}`, PAGE_W - M, y + 5, { align: 'right' });
    font(10);
    doc.text(`Datum: ${formatDate(order.Order_Date)}`, PAGE_W - M, y + 11, { align: 'right' });
    y = Math.max(left, y + 14) + 4;
    doc.setDrawColor(229);
    doc.line(M, y, PAGE_W - M, y);
    y += 7;

    // ── Dobavljač ──
    const contact = [supplier?.Phone, supplier?.Email, supplier?.Address].filter(Boolean).join(' | ');
    doc.setFillColor(245, 245, 247);
    doc.roundedRect(M, y, W, contact ? 16 : 11, 3, 3, 'F');
    font(11.5, 'bold');
    doc.text(order.Supplier_Name || 'Dobavljač', M + 5, y + 7);
    if (contact) {
        font(9, 'normal', GRAY);
        doc.text(doc.splitTextToSize(contact, W - 10)[0], M + 5, y + 12.5);
    }
    y += (contact ? 16 : 11) + 8;

    const heading = (t: string) => {
        ensure(14);
        font(10.5, 'bold');
        doc.text(t, M, y);
        y += 5;
    };

    // ── Materijali ──
    if (regular.length) {
        heading('Materijali');
        const cols = { n: M + 2, name: M + 12, qty: M + W - 30, unit: M + W - 26 };
        const head = () => {
            doc.setFillColor(245, 245, 247);
            doc.rect(M, y, W, 8, 'F');
            font(9, 'bold', 80);
            doc.text('#', cols.n, y + 5.4);
            doc.text('Materijal', cols.name, y + 5.4);
            doc.text('Količina', cols.qty, y + 5.4, { align: 'right' });
            doc.text('Jedinica', cols.unit, y + 5.4);
            y += 8;
        };
        head();
        regular.forEach((g, i) => {
            font(9.5);
            const name = doc.splitTextToSize(g.name, cols.qty - cols.name - 22) as string[];
            const h = Math.max(8, name.length * 4.4 + 3.6);
            ensure(h, head);
            font(9.5);
            doc.text(String(i + 1), cols.n, y + 5.4);
            doc.text(name, cols.name, y + 5.4);
            doc.text(formatQty(g.quantity), cols.qty, y + 5.4, { align: 'right' });
            doc.text(g.unit || '', cols.unit, y + 5.4);
            y += h;
            doc.setDrawColor(240);
            doc.line(M, y, PAGE_W - M, y);
        });
        y += 6;
    }

    // ── Stakla ──
    if (glass.length) {
        heading('Stakla');
        glass.forEach((g, i) => {
            ensure(8);
            doc.setFillColor(250, 250, 250);
            doc.rect(M, y, W, 7.5, 'F');
            font(9.5, 'bold');
            doc.text(`${i + 1}. ${g.group.name}`, M + 2, y + 5.2);
            doc.text(`${area(g.pieces).toFixed(2)} m²`, PAGE_W - M - 2, y + 5.2, { align: 'right' });
            y += 7.5;
            g.pieces.forEach((p: any, j: number) => {
                ensure(6.5);
                font(9);
                const edge = p.Edge_Processing === true || p.Edge_Processing === 'true';
                doc.setTextColor(GRAY);
                doc.text(`${i + 1}.${j + 1}`, M + 6, y + 4.6);
                doc.setTextColor(INK);
                doc.text(`${parseInt(p.Qty) || 1} kom`, M + 22, y + 4.6);
                doc.text(`${parseFloat(p.Width) || 0} × ${parseFloat(p.Height) || 0} mm${edge ? '  · brušeno' : ''}`, M + 42, y + 4.6);
                y += 6.5;
            });
            y += 2;
        });
        y += 4;
    }

    // ── Alu vrata ──
    if (aluDoors.length) {
        heading('Alu vrata');
        aluDoors.forEach((a, i) => {
            ensure(8);
            doc.setFillColor(245, 245, 247);
            doc.rect(M, y, W, 7.5, 'F');
            font(9.5, 'bold');
            doc.text(`${i + 1}. ${a.group.name}  (${area(a.doors).toFixed(2)} m²)`, M + 2, y + 5.2);
            y += 9;
            a.doors.forEach((d: any, j: number) => {
                const lines = [
                    `${i + 1}.${j + 1}   ${parseFloat(d.Width) || 0} × ${parseFloat(d.Height) || 0} mm · ${parseInt(d.Qty) || 1} kom`,
                    `Ram: ${d.Frame_Type || '-'}${d.Frame_Color ? `, ${d.Frame_Color}` : ''}`,
                    `Staklo: ${d.Glass_Type || '-'}`,
                    `Baglame: ${d.Hinge_Type || '-'}, ${d.Hinge_Side || 'lijevo'}${d.Hinge_Color ? `, ${d.Hinge_Color}` : ''}`,
                    ...(d.Integrated_Handle ? ['Ručka: integrisana'] : []),
                    ...(d.Note ? [`Napomena: ${d.Note}`] : []),
                ];
                ensure(lines.length * 4.6 + 3);
                lines.forEach((l, k) => {
                    font(k === 0 ? 9.5 : 8.8, k === 0 ? 'bold' : 'normal');
                    doc.text(doc.splitTextToSize(l, W - 8)[0], M + 4, y + 4);
                    y += 4.6;
                });
                y += 2.5;
            });
        });
        y += 3;
    }

    // ── Napomena ──
    if (order.Notes) {
        font(9.5);
        const note = doc.splitTextToSize(`Napomena: ${order.Notes}`, W - 10) as string[];
        const h = note.length * 4.4 + 6;
        ensure(h + 4);
        doc.setFillColor(255, 250, 240);
        doc.rect(M, y, W, h, 'F');
        doc.setFillColor(245, 166, 35);
        doc.rect(M, y, 1, h, 'F');
        doc.text(note, M + 5, y + 5.5);
        y += h + 6;
    }

    // ── Podnožje ──
    ensure(12);
    doc.setDrawColor(229);
    doc.line(M, y, PAGE_W - M, y);
    font(9, 'normal', GRAY);
    doc.text(`Očekivana dostava: ${order.Expected_Delivery ? formatDate(order.Expected_Delivery) : 'Po dogovoru'}`, M, y + 6);
    doc.text(`Ukupno stavki: ${regular.length + glass.length + aluDoors.length}`, PAGE_W - M, y + 6, { align: 'right' });

    return Buffer.from(doc.output('arraybuffer'));
}

export function orderPdfFileName(order: Pick<Order, 'Order_Number'>): string {
    return `Narudzba_${order.Order_Number.replace(/[^\w.-]+/g, '_')}.pdf`;
}
