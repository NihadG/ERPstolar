// ════════════════════════════════════════════════════════════════════
// DOKUMENT NARUDŽBE — layout koji ide dobavljaču
//
// Izdvojeno iz OrdersTab-a jer ga sad koriste tri puta: štampa, „Preuzmi
// PDF" i „Spremi na Drive". Ranije su štampa i PDF dijelili HTML, a
// razvrstavanje stavki (staklo / alu vrata / obično) je bilo prepisano na
// dva mjesta — dva mjesta za istu grešku.
// ════════════════════════════════════════════════════════════════════

import type { Order, OrderItem, Project, Supplier } from '../types';
import { formatDate } from '../utils';
import type { PrintDocument } from './types';

/** Podskup CompanyInfo-a koji dokument stvarno koristi. */
export interface PrintCompany {
    name: string;
    address: string;
    phone: string;
    email: string;
    logoBase64?: string;
    hideNameWhenLogo?: boolean;
}

export interface OrderPrintInput {
    order: Order;
    supplier?: Supplier;
    /** Projekti — u njima se traže staklarske / alu-vrata specifikacije stavki. */
    projects: Project[];
    company: PrintCompany;
}

interface GlassEntry { item: OrderItem; pieces: any[] }
interface AluDoorEntry { item: OrderItem; doors: any[] }

/**
 * Razvrstaj stavke: obična / staklo / alu vrata. Staklo i alu vrata imaju
 * specifikaciju po komadu (dimenzije, obrada, okov) koja ne stane u red
 * tabele, pa idu u zasebne sekcije.
 */
export function classifyOrderItems(order: Order, projects: Project[]): {
    regular: OrderItem[];
    glass: GlassEntry[];
    aluDoors: AluDoorEntry[];
} {
    const regular: OrderItem[] = [];
    const glass: GlassEntry[] = [];
    const aluDoors: AluDoorEntry[] = [];

    const sorted = [...(order.items || [])].sort((a, b) =>
        (a.Material_Name || '').localeCompare(b.Material_Name || '', 'hr'));

    for (const item of sorted) {
        let placed = false;

        for (const project of projects) {
            for (const product of (project.products || [])) {
                const pm = product.materials?.find(m => m.ID === item.Product_Material_ID);
                if (pm?.glassItems && pm.glassItems.length > 0) {
                    glass.push({ item, pieces: pm.glassItems });
                    placed = true;
                    break;
                }
                if (pm?.aluDoorItems && pm.aluDoorItems.length > 0) {
                    aluDoors.push({ item, doors: pm.aluDoorItems });
                    placed = true;
                    break;
                }
            }
            if (placed) break;
        }

        if (!placed) regular.push(item);
    }

    return { regular, glass, aluDoors };
}

/** Ukupna površina komada u m² (dimenzije su u mm). */
function totalArea(pieces: any[]): number {
    return pieces.reduce((sum: number, p: any) => {
        const qty = parseInt(p.Qty) || 1;
        const w = parseFloat(p.Width) || 0;
        const h = parseFloat(p.Height) || 0;
        return sum + (w * h / 1000000 * qty);
    }, 0);
}

const STYLE_CSS = `
    .print-layout * { box-sizing: border-box; margin: 0; padding: 0; }
    .print-layout {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        padding: 24px;
        color: #1d1d1f;
        background: white;
        width: 794px;
        overflow: hidden;
        -webkit-font-smoothing: antialiased;
        text-rendering: optimizeLegibility;
    }
    .print-layout .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; padding-bottom: 24px; border-bottom: 1px solid #e5e5e5; }
    .print-layout .company-info { display: flex; flex-direction: column; gap: 6px; }
    .print-layout .company-logo { max-width: 180px; max-height: 60px; width: auto; height: auto; object-fit: contain; }
    .print-layout .company-name { font-size: 20px; font-weight: 700; letter-spacing: -0.3px; color: #1d1d1f; margin: 0; }
    .print-layout .company-details p { font-size: 11px; color: #86868b; margin: 0 0 2px 0; }
    .print-layout .order-info { text-align: right; font-size: 14px; }
    .print-layout .order-number { font-size: 18px; font-weight: 600; }
    .print-layout .supplier-section { background: #f5f5f7; padding: 16px; border-radius: 12px; margin-bottom: 24px; }
    .print-layout .supplier-name { font-size: 16px; font-weight: 600; margin-bottom: 4px; }
    .print-layout .supplier-contact { font-size: 13px; color: #86868b; }
    .print-layout .notes { margin-top: 24px; padding: 12px 16px; background: #fffaf0; border-radius: 8px; border-left: 3px solid #f5a623; font-size: 13px; }
    .print-layout .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e5e5; font-size: 12px; color: #86868b; display: flex; justify-content: space-between; }
`;

/**
 * Layout sam po sebi nema margine strane — na štampi ih daje pregledač, u
 * PDF-u ih daje izvoznik. Zato mu se u oba slučaja skida vlastiti padding,
 * da se margine ne udvostruče.
 */
const PRINT_OVERRIDES = `
    body { margin: 0; padding: 0; background: #fff; }
    .print-layout { padding: 0; width: 100%; }
`;

export function buildOrderPrintDocument({ order, supplier, projects, company }: OrderPrintInput): PrintDocument {
    const { regular, glass, aluDoors } = classifyOrderItems(order, projects);

    const regularHTML = regular.length === 0 ? '' : `
        <h3 style="margin: 24px 0 12px; font-size: 14px; font-weight: 600;">Materijali</h3>
        <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
            <thead>
                <tr style="background: #f5f5f7;">
                    <th style="padding: 10px; text-align: left; border-bottom: 1px solid #e5e5e5;">#</th>
                    <th style="padding: 10px; text-align: left; border-bottom: 1px solid #e5e5e5;">Materijal</th>
                    <th style="padding: 10px; text-align: right; border-bottom: 1px solid #e5e5e5;">Količina</th>
                    <th style="padding: 10px; text-align: left; border-bottom: 1px solid #e5e5e5;">Jedinica</th>
                </tr>
            </thead>
            <tbody>
                ${regular.map((item, idx) => `
                    <tr>
                        <td style="padding: 10px; border-bottom: 1px solid #f0f0f0;">${idx + 1}</td>
                        <td style="padding: 10px; border-bottom: 1px solid #f0f0f0;">${item.Material_Name}</td>
                        <td style="padding: 10px; text-align: right; border-bottom: 1px solid #f0f0f0;">${item.Quantity}</td>
                        <td style="padding: 10px; border-bottom: 1px solid #f0f0f0;">${item.Unit}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;

    const glassHTML = glass.length === 0 ? '' : `
        <h3 style="margin: 24px 0 12px; font-size: 14px; font-weight: 600;">Stakla</h3>
        <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
            <thead>
                <tr style="background: #f5f5f7;">
                    <th style="padding: 10px; text-align: left; border-bottom: 1px solid #e5e5e5;">#</th>
                    <th style="padding: 10px; text-align: left; border-bottom: 1px solid #e5e5e5;">Vrsta stakla</th>
                    <th style="padding: 10px; text-align: right; border-bottom: 1px solid #e5e5e5;">Kom</th>
                    <th style="padding: 10px; text-align: left; border-bottom: 1px solid #e5e5e5;">Dimenzije</th>
                    <th style="padding: 10px; text-align: right; border-bottom: 1px solid #e5e5e5;">m²</th>
                </tr>
            </thead>
            <tbody>
                ${glass.map((g, idx) => `
                    <tr style="background: #fafafa;">
                        <td style="padding: 10px; font-weight: 600;">${idx + 1}</td>
                        <td colspan="3" style="padding: 10px; font-weight: 600;">${g.item.Material_Name}</td>
                        <td style="padding: 10px; text-align: right; font-weight: 600;">${totalArea(g.pieces).toFixed(2)}</td>
                    </tr>
                    ${g.pieces.map((p: any, pIdx: number) => {
                        const qty = parseInt(p.Qty) || 1;
                        const w = parseFloat(p.Width) || 0;
                        const h = parseFloat(p.Height) || 0;
                        const edge = p.Edge_Processing === true || p.Edge_Processing === 'true';
                        return `
                            <tr>
                                <td style="padding: 8px 10px 8px 24px; color: #86868b; font-size: 12px;">${idx + 1}.${pIdx + 1}</td>
                                <td style="padding: 8px 10px;"></td>
                                <td style="padding: 8px 10px; text-align: right;">${qty}</td>
                                <td style="padding: 8px 10px;">${w} × ${h} mm${edge ? ' <span style="background:#e8f5e9;padding:2px 6px;border-radius:4px;font-size:11px;">brušeno</span>' : ''}</td>
                                <td style="padding: 8px 10px;"></td>
                            </tr>
                        `;
                    }).join('')}
                `).join('')}
            </tbody>
        </table>
    `;

    const aluDoorHTML = aluDoors.length === 0 ? '' : `
        <h3 style="margin: 24px 0 12px; font-size: 14px; font-weight: 600;">Alu Vrata</h3>
        ${aluDoors.map((a, idx) => `
            <div style="margin-bottom: 16px;">
                <div style="background: #f5f5f7; padding: 10px 14px; border-radius: 8px 8px 0 0; font-weight: 600;">
                    ${idx + 1}. ${a.item.Material_Name} <span style="color: #86868b; font-weight: 400;">(${totalArea(a.doors).toFixed(2)} m²)</span>
                </div>
                ${a.doors.map((d: any, dIdx: number) => {
                    const qty = parseInt(d.Qty) || 1;
                    const w = parseFloat(d.Width) || 0;
                    const h = parseFloat(d.Height) || 0;
                    return `
                        <div style="border: 1px solid #e5e5e5; border-top: none; padding: 12px 14px;">
                            <div style="display: flex; gap: 16px; margin-bottom: 8px; font-size: 13px;">
                                <span style="color: #86868b;">${idx + 1}.${dIdx + 1}</span>
                                <strong>${w} × ${h} mm</strong>
                                <span>${qty} kom</span>
                            </div>
                            <div style="font-size: 12px; color: #1d1d1f; line-height: 1.6;">
                                <div><span style="color: #86868b;">Ram:</span> ${d.Frame_Type || '-'}${d.Frame_Color ? ', ' + d.Frame_Color : ''}</div>
                                <div><span style="color: #86868b;">Staklo:</span> ${d.Glass_Type || '-'}</div>
                                <div><span style="color: #86868b;">Baglame:</span> ${d.Hinge_Type || '-'}, ${d.Hinge_Side || 'lijevo'}${d.Hinge_Color ? ', ' + d.Hinge_Color : ''}</div>
                                ${d.Integrated_Handle ? '<div><span style="color: #86868b;">Ručka:</span> Integrisana</div>' : ''}
                                ${d.Note ? `<div style="margin-top: 6px; font-style: italic; color: #6e6e73;"><span style="color: #86868b;">Napomena:</span> ${d.Note}</div>` : ''}
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `).join('')}
    `;

    const body = `
        <div class="print-layout">
            <div class="header">
                <div class="company-info">
                    ${company.logoBase64 ? `<img class="company-logo" src="${company.logoBase64}" alt="${company.name}" />` : ''}
                    ${(!company.logoBase64 || !company.hideNameWhenLogo) ? `<h1 class="company-name">${company.name}</h1>` : ''}
                    <div class="company-details">
                        <p>${company.address}</p>
                        <p>${[company.phone, company.email].filter(Boolean).join(' · ')}</p>
                    </div>
                </div>
                <div class="order-info">
                    <div class="order-number">Narudžba: ${order.Order_Number}</div>
                    <div>Datum: ${formatDate(order.Order_Date)}</div>
                </div>
            </div>

            <div class="supplier-section">
                <div class="supplier-name">${order.Supplier_Name || 'Dobavljač'}</div>
                <div class="supplier-contact">
                    ${[supplier?.Phone, supplier?.Email, supplier?.Address].filter(Boolean).join(' | ')}
                </div>
            </div>

            ${regularHTML}
            ${glassHTML}
            ${aluDoorHTML}

            ${order.Notes ? `<div class="notes"><strong>Napomena:</strong> ${order.Notes}</div>` : ''}

            <div class="footer">
                <span>Očekivana dostava: ${order.Expected_Delivery ? formatDate(order.Expected_Delivery) : 'Po dogovoru'}</span>
                <span>Ukupno stavki: ${order.items?.length || 0}</span>
            </div>
        </div>
    `;

    const title = `Narudžba ${order.Order_Number}`;

    return {
        body,
        css: STYLE_CSS,
        printOverrides: PRINT_OVERRIDES,
        title,
        html: `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>${title}</title>
    <style>
        ${STYLE_CSS}
        @media print {
            @page { margin: 12mm; size: A4; }
            ${PRINT_OVERRIDES}
        }
    </style>
</head>
<body>${body}</body>
</html>`,
    };
}
