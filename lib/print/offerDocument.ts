// ════════════════════════════════════════════════════════════════════
// DOKUMENT PONUDE — layout koji ide klijentu
//
// Izdvojeno iz OffersTab-a da ga dijele štampa, „Preuzmi PDF" i „Spremi
// na Drive". Ranije je samo štampa dobijala ovaj layout, a PDF je išao
// kroz osiromašenu verziju u pdfGenerator-u (bez loga, bez preloma po
// stranama, drugi font) — pa se na Drive-u završavao dokument koji nije
// ličio na onaj koji se printa.
//
// Prelom po stranama se MJERI (ne pogađa): visina zaglavlja zavisi od
// loga, broja žiro-računa i dužine adrese, pa fiksna procjena redova po
// strani pravi poluprazne ili prepunjene strane.
// ════════════════════════════════════════════════════════════════════

import type { Offer } from '../types';
import { sortProductsByName } from '../sortProducts';
import type { PrintDocument } from './types';
import type { PrintCompany } from './orderDocument';

export interface OfferPrintCompany extends PrintCompany {
    idNumber?: string;
    pdvNumber?: string;
    bankAccounts?: { bankName: string; accountNumber: string }[];
}

export interface OfferPrintInput {
    offer: Offer;
    /** Dimenzije po proizvodu iz projekta (Product_ID → V×Š×D u mm). */
    dimensions?: Record<string, { Width: number; Height: number; Depth: number }>;
    company: OfferPrintCompany;
}

const EUR_RATE = 1.95583;

function formatDate(dateString: string): string {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('hr-HR');
}

// ── Geometrija strane ────────────────────────────────────────────────
// Mora se poklapati s `@page` margin dolje — na tome stoji cijeli račun
// preloma. Ako se jedno promijeni bez drugog, strane se prepune.
const MM_TO_PX = 96 / 25.4;
const CONTENT_WIDTH_PX = (210 - 12 - 12) * MM_TO_PX;    // A4 širina minus lijeva/desna margina
const PAGE_BUDGET_PX = (297 - 10 - 14) * MM_TO_PX;      // A4 visina minus gornja/donja margina
const SAFETY_MARGIN_PX = 24;                             // rezerva za zaokruživanja pri mjerenju/štampi
const EFFECTIVE_BUDGET_PX = PAGE_BUDGET_PX - SAFETY_MARGIN_PX;
const ROW_HEIGHT_PX = 56;                                // isto kao fiksna visina reda u .products-table
const TABLE_MARGIN_PX = 24;                              // isto kao .products-table { margin-bottom }
const MIN_LAST_PAGE_ROWS = 4;                            // da zadnja strana ne ostane skoro prazna

/**
 * Pravila kojima `.page` prelazi iz „list na ekranu" u „strana papira".
 * Dijele ih `@media print` (štampa) i PDF izvoz (koji `@media print` ne
 * vidi jer rasterizuje na ekranu) — zato stoje kao zaseban string.
 */
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
        line-height: 1.5;
        color: #1a1a1a;
        background: #f8f8f8;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
        zoom: 1;
        -webkit-text-size-adjust: 100%;
        text-rendering: optimizeLegibility;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
    }

    .page {
        max-width: 780px;
        margin: 20px auto;
        background: white;
        padding: 48px 44px;
        box-shadow: 0 1px 8px rgba(0,0,0,0.08);
    }

    .page-break { page-break-after: always; }

    /* Header */
    .header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        padding-bottom: 24px;
        border-bottom: 2px solid #e8e8e8;
        margin-bottom: 28px;
    }

    .company-info { display: flex; flex-direction: column; gap: 6px; }

    .company-logo {
        max-width: 160px;
        max-height: 50px;
        width: auto;
        height: auto;
        object-fit: contain;
    }

    .company-name { font-size: 20px; font-weight: 700; color: #111; margin: 0; }
    .company-details p { font-size: 10px; color: #777; margin: 1px 0; }

    .doc-info { text-align: right; }

    .doc-type {
        display: inline-block;
        background: #0066cc;
        color: white;
        font-size: 9px;
        font-weight: 600;
        letter-spacing: 1px;
        text-transform: uppercase;
        padding: 4px 12px;
        border-radius: 3px;
        margin-bottom: 8px;
    }

    .doc-number {
        font-size: 22px;
        font-weight: 700;
        color: #111;
        letter-spacing: -0.5px;
        margin-bottom: 4px;
    }

    .doc-date { font-size: 12px; color: #888; }

    /* Client Section */
    .client-section {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 28px;
        padding: 20px;
        background: #fafafa;
        border-radius: 6px;
        border: 1px solid #eee;
    }

    .client-details { flex: 1; }

    .client-label {
        font-size: 9px;
        font-weight: 600;
        color: #aaa;
        text-transform: uppercase;
        letter-spacing: 0.8px;
        margin-bottom: 6px;
    }

    .client-name { font-size: 16px; font-weight: 600; color: #111; margin-bottom: 4px; }
    .client-contact { font-size: 11px; color: #666; margin-bottom: 2px; }

    /* Products Table */
    .products-title {
        font-size: 11px;
        font-weight: 600;
        color: #999;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 10px;
    }

    .products-table {
        width: 100%;
        border-collapse: collapse;
        margin-bottom: 24px;
    }

    .products-table thead th {
        background: #f5f6f7;
        padding: 8px 12px;
        font-size: 10px;
        font-weight: 600;
        color: #888;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        border-bottom: 2px solid #e8e8e8;
        text-align: left;
    }

    .products-table tbody td {
        padding: 10px 12px;
        font-size: 12px;
        border-bottom: 1px solid #f0f0f0;
        vertical-align: middle;
        min-height: 56px;
        height: 56px;
    }

    .products-table tbody tr:last-child td { border-bottom: 2px solid #e8e8e8; }

    .col-num { width: 40px; text-align: center; color: #aaa; }
    .col-name { }
    .col-qty { width: 64px; text-align: center; }
    .col-price { width: 98px; text-align: right; }
    .col-rabat { width: 60px; text-align: right; color: #16a34a; font-weight: 600; }
    .col-rabat.rabat-up { color: #c0392b; }
    .col-total { width: 108px; text-align: right; font-weight: 500; }

    thead th.col-price,
    thead th.col-rabat,
    thead th.col-total { text-align: right; }
    thead th.col-rabat { color: #888; font-weight: 600; }
    thead th.col-qty { text-align: center; }

    .product-name { font-weight: 500; color: #333; }
    .product-dims { color: #999; font-size: 11px; }

    /* Bottom Section */
    .bottom-section { display: flex; gap: 32px; margin-bottom: 40px; }

    .notes-box {
        flex: 1;
        padding: 16px 18px;
        background: #f8f9fa;
        border-radius: 6px;
        border-left: 3px solid #0066cc;
    }

    .notes-title {
        font-size: 10px;
        font-weight: 600;
        color: #999;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 8px;
    }

    .notes-box p { font-size: 11px; color: #555; margin-bottom: 3px; line-height: 1.5; }

    .totals-box { width: 280px; flex-shrink: 0; }

    .totals-line {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 6px 0;
        border-bottom: 1px solid #f0f0f0;
    }

    .totals-line:last-child { border-bottom: none; }

    .t-label { font-size: 12px; color: #666; }
    .t-value { font-size: 12px; font-weight: 500; color: #333; }

    .totals-line.discount .t-value { color: #34c759; }

    .totals-line.grand-total {
        padding-top: 12px;
        margin-top: 4px;
        border-top: 2px solid #111;
        border-bottom: none;
    }

    .totals-line.grand-total .t-label { font-size: 14px; font-weight: 600; color: #111; }
    .totals-line.grand-total .t-value { font-size: 18px; font-weight: 700; color: #0066cc; }

    /* Signatures */
    .signatures { display: flex; justify-content: space-between; gap: 60px; margin-top: 48px; }

    .sig-block { flex: 1; text-align: center; }
    .sig-line { border-top: 1px solid #ccc; margin-bottom: 6px; }

    .sig-label {
        font-size: 9px;
        color: #aaa;
        text-transform: uppercase;
        letter-spacing: 0.8px;
    }

    .bank-accounts { text-align: right; }

    .bank-accounts .bank-title {
        font-size: 9px;
        font-weight: 600;
        color: #999;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 6px;
    }

    .bank-accounts .bank-item { font-size: 10px; color: #555; margin-bottom: 3px; }

    img {
        image-rendering: -webkit-optimize-contrast;
        image-rendering: crisp-edges;
    }
`;

export async function buildOfferPrintDocument({ offer, dimensions, company }: OfferPrintInput): Promise<PrintDocument> {
    const dimLookup = dimensions || {};

    const lang = (offer as any).Language || 'bs';
    const curr = (offer as any).Currency || 'KM';
    const isEN = lang === 'en';
    const isEUR = curr === 'EUR';

    const t = {
        offer: isEN ? 'Quotation' : 'Ponuda',
        client: isEN ? 'Client' : 'Kupac',
        products: isEN ? 'Products' : 'Proizvodi',
        name: isEN ? 'Description' : 'Naziv',
        dims: isEN ? '(HxWxD)' : '(VxŠxD)',
        qty: isEN ? 'Qty' : 'Količina',
        price: isEN ? 'Unit Price' : 'Cijena',
        rabat: isEN ? 'Disc.' : 'Rabat',
        newPrice: isEN ? 'Net Price' : 'Nova cijena',
        itemDiscount: isEN ? 'Item discount' : 'Rabat na stavke',
        afterDiscount: isEN ? 'Subtotal after discount' : 'Suma nakon rabata',
        total: isEN ? 'Total' : 'Ukupno',
        subtotal: isEN ? 'Subtotal' : 'Suma',
        transport: isEN ? 'Transport' : 'Transport',
        discount: isEN ? 'Discount' : 'Popust',
        grandTotal: isEN ? 'Total' : 'Ukupno',
        grandTotalVat: isEN ? 'Total (incl. VAT)' : 'Ukupno (sa PDV)',
        vat: isEN ? 'VAT' : 'PDV',
        notes: isEN ? 'Notes' : 'Napomena',
        validUntil: isEN ? 'Valid until' : 'Ponuda vrijedi do',
        supplier: isEN ? 'Supplier' : 'Ponuđač',
        buyer: isEN ? 'Client' : 'Naručilac',
        bankAccounts: isEN ? 'Bank accounts' : 'Bankovni računi',
    };

    // Iznosi se čuvaju u KM — konverzija je samo za prikaz.
    const fmtCurr = (val: number) => isEUR
        ? (val / EUR_RATE).toFixed(2) + ' €'
        : val.toLocaleString('bs-BA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' KM';

    const products = sortProductsByName(
        (offer.products || []).filter(p => p.Included !== false).map(p => {
            const net = p.Selling_Price || 0;
            const dp = (p as any).Discount_Percent || 0;
            // Base_Selling_Price je cijena prije rabata; fallback za stare ponude bez tog polja.
            const base = (p as any).Base_Selling_Price || (dp ? net / (1 - dp / 100) : net);
            return {
                ...p,
                Selling_Price: net,
                Total_Price: p.Total_Price || 0,
                _discountPercent: dp,
                _basePrice: base,
            };
        }),
        p => p.Product_Name
    );

    // Rabat po stavci se prikazuje na štampi samo ako je flag uključen I ima stvarnog rabata.
    const showItemDiscounts = !!(offer as any).Show_Item_Discounts
        && products.some(p => Math.abs(p._discountPercent) >= 0.01);

    const subtotal = offer.Subtotal || products.reduce((sum, p) => sum + p.Total_Price, 0);
    const grossSubtotal = products.reduce((sum, p) => sum + p._basePrice * (p.Quantity || 1), 0);
    const itemDiscount = grossSubtotal - subtotal;   // ukupan rabat na stavke (za razradu suma)
    const transport = offer.Transport_Cost || 0;
    const discount = offer.Onsite_Assembly ? (offer.Onsite_Discount || 0) : 0;
    const total = subtotal + transport - discount;

    const includePDV = (offer as any).Include_PDV ?? false;
    const pdvRate = (offer as any).PDV_Rate ?? 17;

    const headerHTML = `
        <div class="header">
            <div class="company-info">
                ${company.logoBase64 ? `<img class="company-logo" src="${company.logoBase64}" alt="${company.name}" />` : ''}
                ${(!company.logoBase64 || !company.hideNameWhenLogo) ? `<h1 class="company-name">${company.name}</h1>` : ''}
                <div class="company-details">
                    <p>${company.address}</p>
                    <p>${[company.phone, company.email].filter(Boolean).join(' · ')}</p>
                    ${company.idNumber || company.pdvNumber ? `<p style="margin-top: 2px; font-size: 9px; color: #aaa;">${[company.idNumber ? 'ID: ' + company.idNumber : '', company.pdvNumber ? (isEN ? 'VAT: ' : 'PDV: ') + company.pdvNumber : ''].filter(Boolean).join(' | ')}</p>` : ''}
                </div>
            </div>
            <div class="bank-accounts">
                ${(company.bankAccounts || []).length > 0 ? `
                    <div class="bank-title">${t.bankAccounts}</div>
                    ${(company.bankAccounts || []).map(acc => `
                        <div class="bank-item"><strong>${acc.bankName}:</strong> ${acc.accountNumber}</div>
                    `).join('')}
                ` : ''}
            </div>
        </div>
        <div class="client-section">
            <div class="client-details">
                <div class="client-label">${t.client}</div>
                <div class="client-name">${offer.Client_Name || '-'}</div>
                ${(offer as any).Client_Address ? `<div class="client-contact">${(offer as any).Client_Address}</div>` : ''}
                ${(offer as any).Client_Phone ? `<div class="client-contact">${isEN ? 'Phone' : 'Tel'}: ${(offer as any).Client_Phone}</div>` : ''}
                ${(offer as any).Client_Email ? `<div class="client-contact">Email: ${(offer as any).Client_Email}</div>` : ''}
                ${(offer as any).Client_ID_Number ? `<div class="client-contact" style="margin-top: 4px; font-size: 9px; color: #888;">ID: ${(offer as any).Client_ID_Number}</div>` : ''}
                ${(offer as any).Client_PDV_Number ? `<div class="client-contact" style="font-size: 9px; color: #888;">${isEN ? 'VAT' : 'PDV'}: ${(offer as any).Client_PDV_Number}</div>` : ''}
            </div>
            <div class="doc-info">
                <div class="doc-type">${t.offer}</div>
                <div class="doc-number">${offer.Offer_Number}</div>
                <div class="doc-date">${formatDate(offer.Created_Date)}</div>
            </div>
        </div>
    `;

    // Rabat u koloni: pozitivan % = popust (−X%), negativan = doplata (+X%).
    const fmtRabat = (dp: number) => dp === 0 ? '—' : (dp > 0 ? `−${dp}%` : `+${Math.abs(dp)}%`);

    const productRowHTML = (p: typeof products[0], globalIndex: number) => `
        <tr>
            <td class="col-num">${globalIndex + 1}</td>
            <td>
                <div class="product-name">${p.Product_Name}${(() => {
                    const d = dimLookup[p.Product_ID];
                    return d && d.Width && d.Height && d.Depth
                        ? `, <span class="product-dims">${d.Height} × ${d.Width} × ${d.Depth} mm</span>`
                        : '';
                })()}</div>
            </td>
            <td class="col-qty">${p.Quantity}</td>
            ${showItemDiscounts ? `
                <td class="col-price">${fmtCurr(p._basePrice)}</td>
                <td class="col-rabat${p._discountPercent < 0 ? ' rabat-up' : ''}">${fmtRabat(p._discountPercent)}</td>
                <td class="col-price">${fmtCurr(p.Selling_Price)}</td>
            ` : `
                <td class="col-price">${fmtCurr(p.Selling_Price)}</td>
            `}
            <td class="col-total">${fmtCurr(p.Total_Price)}</td>
        </tr>
    `;

    const bottomHTML = `
        <div class="bottom-section">
            <div class="notes-box">
                <div class="notes-title">${t.notes}</div>
                <p>${t.validUntil}: <strong>${formatDate(offer.Valid_Until)}</strong></p>
                ${offer.Notes ? offer.Notes.split('\n').map((line: string) => `<p>${line}</p>`).join('') : ''}
            </div>
            <div class="totals-box">
                ${showItemDiscounts && Math.abs(itemDiscount) >= 0.01 ? `
                    <div class="totals-line">
                        <span class="t-label">${t.subtotal}</span>
                        <span class="t-value">${fmtCurr(grossSubtotal)}</span>
                    </div>
                    <div class="totals-line discount">
                        <span class="t-label">${t.itemDiscount}</span>
                        <span class="t-value">${itemDiscount >= 0 ? '-' : '+'}${fmtCurr(Math.abs(itemDiscount))}</span>
                    </div>
                    <div class="totals-line">
                        <span class="t-label">${t.afterDiscount}</span>
                        <span class="t-value">${fmtCurr(subtotal)}</span>
                    </div>
                ` : `
                    <div class="totals-line">
                        <span class="t-label">${t.subtotal}</span>
                        <span class="t-value">${fmtCurr(subtotal)}</span>
                    </div>
                `}
                ${transport > 0 ? `
                    <div class="totals-line">
                        <span class="t-label">${t.transport}</span>
                        <span class="t-value">${fmtCurr(transport)}</span>
                    </div>
                ` : ''}
                ${discount > 0 ? `
                    <div class="totals-line discount">
                        <span class="t-label">${t.discount}</span>
                        <span class="t-value">-${fmtCurr(discount)}</span>
                    </div>
                ` : ''}
                ${includePDV ? `
                    <div class="totals-line">
                        <span class="t-label">${t.vat} (${pdvRate}%)</span>
                        <span class="t-value">${fmtCurr(total * pdvRate / 100)}</span>
                    </div>
                ` : ''}
                <div class="totals-line grand-total">
                    <span class="t-label">${includePDV ? t.grandTotalVat : t.grandTotal}</span>
                    <span class="t-value">${fmtCurr(includePDV ? total * (1 + pdvRate / 100) : total)}</span>
                </div>
            </div>
        </div>

        <div class="signatures">
            <div class="sig-block">
                <div class="sig-line"></div>
                <div class="sig-label">${t.supplier}</div>
            </div>
            <div class="sig-block">
                <div class="sig-line"></div>
                <div class="sig-label">${t.buyer}</div>
            </div>
        </div>
    `;

    const colheadHTML = `
        <tr>
            <th class="col-num">#</th>
            <th class="col-name">${t.name} <span style="font-weight:400;color:#bbb;font-size:9px;">${t.dims}</span></th>
            <th class="col-qty">${t.qty}</th>
            ${showItemDiscounts ? `
                <th class="col-price">${t.price}</th>
                <th class="col-rabat">${t.rabat}</th>
                <th class="col-price">${t.newPrice}</th>
            ` : `
                <th class="col-price">${t.price}</th>
            `}
            <th class="col-total">${t.total}</th>
        </tr>
    `;

    const { header: HEADER_H, title: TITLE_H, colhead: COLHEAD_H, bottom: BOTTOM_H } =
        await measureBlockHeights(headerHTML, colheadHTML, bottomHTML, t.products);

    const pageCounts = planPageCounts(products.length, HEADER_H, TITLE_H, COLHEAD_H, BOTTOM_H);

    const pages: (typeof products[number])[][] = [];
    const remaining = [...products];
    for (const count of pageCounts) pages.push(remaining.splice(0, count));

    let globalIdx = 0;
    const body = pages.map((pageProducts, pageIndex) => {
        const isFirstPage = pageIndex === 0;
        const isLastPage = pageIndex === pages.length - 1;
        const rowsHTML = pageProducts.map(p => productRowHTML(p, globalIdx++)).join('');

        return `
            <div class="page${!isLastPage ? ' page-break' : ''}">
                ${headerHTML}
                ${isFirstPage ? `<div class="products-title">${t.products}</div>` : ''}
                <table class="products-table">
                    <thead>${colheadHTML}</thead>
                    <tbody>
                        ${rowsHTML}
                    </tbody>
                </table>
                ${isLastPage ? bottomHTML : ''}
            </div>
        `;
    }).join('');

    const title = `${t.offer} ${offer.Offer_Number}`;

    return {
        body,
        css: STYLE_CSS,
        printOverrides: PRINT_OVERRIDES,
        title,
        html: `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>${title}</title>
    <style>
        ${STYLE_CSS}
        @media print {
            ${PRINT_OVERRIDES}
            .page-break { page-break-after: always !important; }
            @page { margin: 10mm 12mm 14mm 12mm; size: A4; }
            .products-table tr { page-break-inside: avoid; }
            .bottom-section { page-break-inside: avoid; }
            .signatures { page-break-inside: avoid; }
            * { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
        }
    </style>
</head>
<body>${body}</body>
</html>`,
    };
}

/**
 * Izmjeri stvarnu visinu zaglavlja / naslova / reda kolona / podnožja za
 * OVU ponudu. Fiksna procjena je ranije pravila strane bez zaglavlja i
 * skoro prazne strane, jer visina zaglavlja zavisi od loga, broja
 * žiro-računa i dužine adrese.
 */
async function measureBlockHeights(
    headerHTML: string,
    colheadHTML: string,
    bottomHTML: string,
    productsLabel: string,
): Promise<{ header: number; title: number; colhead: number; bottom: number }> {
    const fallback = { header: 360, title: 26, colhead: 34, bottom: 300 };
    if (typeof document === 'undefined') return fallback;

    const iframe = document.createElement('iframe');
    iframe.style.cssText = `position:absolute;left:-9999px;top:0;width:${CONTENT_WIDTH_PX}px;height:1600px;border:0;visibility:hidden;`;
    try {
        document.body.appendChild(iframe);
        const idoc = iframe.contentDocument;
        if (!idoc) return fallback;
        idoc.open();
        idoc.write(`
            <!DOCTYPE html>
            <html>
            <head><style>${STYLE_CSS}</style></head>
            <body>
                <div id="m-header" style="overflow:hidden;">${headerHTML}</div>
                <div id="m-title" style="overflow:hidden;"><div class="products-title">${productsLabel}</div></div>
                <table class="products-table"><thead>${colheadHTML.replace('<tr>', '<tr id="m-colhead">')}</thead></table>
                <div id="m-bottom" style="overflow:hidden;">${bottomHTML}</div>
            </body>
            </html>
        `);
        idoc.close();

        // Sačekaj da se logo dekodira, inače mu se visina izmjeri kao 0.
        const images = Array.from(idoc.images);
        if (images.length > 0) {
            await Promise.race([
                Promise.all(images.map(img => img.decode ? img.decode().catch(() => undefined) : Promise.resolve())),
                new Promise(resolve => setTimeout(resolve, 500)),
            ]);
        }

        return {
            header: idoc.getElementById('m-header')?.offsetHeight || fallback.header,
            title: idoc.getElementById('m-title')?.offsetHeight || fallback.title,
            colhead: idoc.getElementById('m-colhead')?.offsetHeight || fallback.colhead,
            bottom: idoc.getElementById('m-bottom')?.offsetHeight || fallback.bottom,
        };
    } catch {
        return fallback;
    } finally {
        iframe.remove();
    }
}

/**
 * Koliko proizvoda ide na koju stranu.
 *
 * Strana 1 je ograničena zaglavljem + naslovom; ostatak („rep") se puni
 * UNAZAD, počevši od zadnje strane (čiji je limit najmanji jer mora primiti
 * i napomene/sume/potpise). Punjenje unazad garantuje da zadnja strana
 * dobije pošten dio umjesto tanke ostatka koji preteknu ranije strane.
 */
export function planPageCounts(
    productCount: number,
    headerH: number,
    titleH: number,
    colheadH: number,
    bottomH: number,
): number[] {
    const capFirstOnly = Math.max(1, Math.floor((EFFECTIVE_BUDGET_PX - (headerH + titleH + colheadH)) / ROW_HEIGHT_PX));
    const capFirstAndLast = Math.max(1, Math.floor((EFFECTIVE_BUDGET_PX - (headerH + titleH + colheadH + TABLE_MARGIN_PX + bottomH)) / ROW_HEIGHT_PX));
    const capContOnly = Math.max(1, Math.floor((EFFECTIVE_BUDGET_PX - (headerH + colheadH)) / ROW_HEIGHT_PX));
    const capContAndLast = Math.max(1, Math.floor((EFFECTIVE_BUDGET_PX - (headerH + colheadH + TABLE_MARGIN_PX + bottomH)) / ROW_HEIGHT_PX));

    if (productCount === 0) return [0];
    if (productCount <= capFirstAndLast) return [productCount];

    const firstPageRows = Math.min(capFirstOnly, productCount);
    const tailRows = productCount - firstPageRows;

    // Najmanji broj strana repa k takav da (k-1)*capContOnly + capContAndLast >= tailRows
    let k = 1;
    while ((k - 1) * capContOnly + capContAndLast < tailRows) k++;

    const tailCounts = new Array(k).fill(0);
    let remaining = tailRows;
    for (let i = k - 1; i >= 0; i--) {
        const pagesLeftIncludingThis = i + 1;
        const cap = i === k - 1 ? capContAndLast : capContOnly;
        const take = Math.min(Math.ceil(remaining / pagesLeftIncludingThis), cap, remaining);
        tailCounts[i] = take;
        remaining -= take;
    }

    const pageCounts = [firstPageRows, ...tailCounts];

    // Sigurnosna mreža: ako je zadnja strana i dalje kratka, posudi od
    // prethodne, ali je ne isprazni do kraja.
    const target = Math.min(MIN_LAST_PAGE_ROWS, capContAndLast);
    for (let i = pageCounts.length - 1; i >= 1 && pageCounts[i] < target; i--) {
        const need = target - pageCounts[i];
        const move = Math.min(need, Math.max(0, pageCounts[i - 1] - 1));
        pageCounts[i] += move;
        pageCounts[i - 1] -= move;
    }

    return pageCounts;
}
