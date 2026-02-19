'use client';

import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { sortProductsByName } from './sortProducts';

// ============================================
// PDF GENERATION UTILITIES
// ============================================

/**
 * Generate PDF from an HTML element
 * @param element - The HTML element to convert to PDF
 * @param filename - The filename for the PDF (without .pdf extension)
 * @param options - Optional configuration
 */
export async function generatePDFFromElement(
    element: HTMLElement,
    filename: string,
    options?: {
        orientation?: 'portrait' | 'landscape';
        format?: 'a4' | 'letter';
        margin?: number;
    }
): Promise<void> {
    const { orientation = 'portrait', format = 'a4', margin = 10 } = options || {};

    // Create canvas from HTML element
    const canvas = await html2canvas(element, {
        useCORS: true,
        logging: false,
        background: '#ffffff',
        scale: 2,
        windowWidth: 794,
    } as any);

    const imgData = canvas.toDataURL('image/png');

    // Calculate dimensions
    const pdf = new jsPDF({
        orientation,
        unit: 'mm',
        format,
    });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pageWidth - (margin * 2);
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    // Handle multi-page PDFs
    let heightLeft = imgHeight;
    let position = margin;
    let page = 1;

    // Add first page
    pdf.addImage(imgData, 'PNG', margin, position, imgWidth, imgHeight);
    heightLeft -= (pageHeight - margin * 2);

    // Add subsequent pages if content overflows
    while (heightLeft > 0) {
        position = -(pageHeight - margin * 2) * page + margin;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', margin, position, imgWidth, imgHeight);
        heightLeft -= (pageHeight - margin * 2);
        page++;
    }

    // Download the PDF
    pdf.save(`${filename}.pdf`);
}

/**
 * Generate PDF from HTML string
 * Creates a temporary element, renders it, then removes it
 */
export async function generatePDFFromHTML(
    htmlContent: string,
    filename: string,
    options?: {
        orientation?: 'portrait' | 'landscape';
        format?: 'a4' | 'letter';
        margin?: number;
        width?: number;
    }
): Promise<void> {
    const { width = 800 } = options || {};

    // Create temporary container
    const container = document.createElement('div');
    container.style.position = 'absolute';
    container.style.left = '-9999px';
    container.style.top = '0';
    container.style.width = `${width}px`;
    container.style.background = '#ffffff';
    container.innerHTML = htmlContent;
    document.body.appendChild(container);

    try {
        await generatePDFFromElement(container, filename, options);
    } finally {
        // Clean up
        document.body.removeChild(container);
    }
}

// ============================================
// OFFER PDF GENERATION
// ============================================

export interface OfferPDFData {
    offerNumber: string;
    clientName: string;
    clientPhone?: string;
    clientEmail?: string;
    createdDate: string;
    validUntil: string;
    products: Array<{
        name: string;
        quantity: number;
        dimensions?: string;
        materialCost: number;
        laborCost?: number;
        extras?: Array<{ name: string; total: number }>;
        sellingPrice: number;
        totalPrice: number;
    }>;
    subtotal: number;
    transportCost: number;
    discount?: number;
    total: number;
    notes?: string;
    companyName?: string;
    companyAddress?: string;
    companyPhone?: string;
    companyEmail?: string;
    bankAccounts?: Array<{ bankName: string; accountNumber: string }>;
}

export async function generateOfferPDF(data: OfferPDFData): Promise<void> {
    const html = createOfferHTML(data);
    await generatePDFFromHTML(html, `Ponuda_${data.offerNumber}`, {
        orientation: 'portrait',
        format: 'a4',
        margin: 10,
        width: 794, // A4 width at 96 DPI
    });
}

function createOfferHTML(data: OfferPDFData): string {
    const sortedProducts = sortProductsByName(data.products, p => p.name);
    const productsHTML = sortedProducts.map((p, i) => `
        <tr>
            <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; text-align: center;">${i + 1}</td>
            <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; font-size: 15px;">
                <div style="font-weight: 400;">${p.name}</div>
                ${p.dimensions ? `<div style="font-size: 11px; color: #86868b; margin-top: 2px;">${p.dimensions}</div>` : ''}
            </td>
            <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: center; font-size: 15px;">${p.quantity}</td>
            <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right; font-size: 15px;">${formatCurrency(p.sellingPrice)}</td>
            <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right; font-size: 16px; font-weight: 400;">${formatCurrency(p.totalPrice)}</td>
        </tr>
        ${p.extras?.map(e => `
            <tr style="background: #f9fafb;">
                <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb;"></td>
                <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; padding-left: 24px; color: #6b7280;">
                    + ${e.name}
                </td>
                <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb;"></td>
                <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb;"></td>
                <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; text-align: right; color: #6b7280;">${formatCurrency(e.total)}</td>
            </tr>
        `).join('') || ''}
    `).join('');

    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <style>
                * { box-sizing: border-box; margin: 0; padding: 0; }
                body { 
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    color: #1f2937;
                    line-height: 1.5;
                    padding: 40px;
                    background: white;
                }
                .header { 
                    display: flex; 
                    justify-content: space-between; 
                    align-items: flex-start;
                    margin-bottom: 40px;
                    padding-bottom: 20px;
                    border-bottom: 2px solid #e5e7eb;
                }
                .company-info h1 { 
                    font-size: 24px; 
                    font-weight: 700;
                    color: #111827;
                }
                .company-info p { 
                    color: #6b7280; 
                    font-size: 14px; 
                }
                .offer-info { text-align: right; }
                .offer-number { 
                    font-size: 28px; 
                    font-weight: 700;
                    color: #2563eb;
                }
                .offer-date { color: #6b7280; font-size: 14px; }
                .client-section {
                    background: #f9fafb;
                    padding: 20px;
                    border-radius: 8px;
                    margin-bottom: 30px;
                }
                .client-section h3 {
                    font-size: 14px;
                    font-weight: 600;
                    color: #111827;
                    margin-bottom: 8px;
                }
                .client-section .name {
                    font-size: 18px;
                    font-weight: 600;
                    color: #111827;
                }
                .client-section .contact {
                    color: #6b7280;
                    font-size: 14px;
                }
                table { 
                    width: 100%; 
                    border-collapse: collapse; 
                    margin-bottom: 30px;
                }
                thead { background: transparent; }
                th { 
                    padding: 12px; 
                    text-align: left; 
                    font-weight: 700;
                    color: #4b5563;
                    font-size: 15px;
                    border-bottom: 1px solid #e5e7eb;
                }
                th:nth-child(3), th:nth-child(4), th:nth-child(5) { text-align: right; }
                .totals {
                    margin-left: auto;
                    width: 300px;
                }
                .totals-row {
                    display: flex;
                    justify-content: space-between;
                    padding: 8px 0;
                    border-bottom: 1px solid #e5e7eb;
                }
                .totals-row.final {
                    border-bottom: none;
                    border-top: 2px solid #111827;
                    margin-top: 8px;
                    padding-top: 12px;
                    font-size: 20px;
                    font-weight: 700;
                }
                .notes {
                    margin-top: 40px;
                    padding: 20px;
                    background: #fffbeb;
                    border-radius: 8px;
                    border-left: 4px solid #f59e0b;
                }
                .notes h4 { 
                    font-size: 14px; 
                    font-weight: 600;
                    margin-bottom: 8px;
                }
                .notes p { color: #78716c; font-size: 14px; }
                .footer {
                    margin-top: 60px;
                    padding-top: 20px;
                    border-top: 1px solid #e5e7eb;
                    text-align: center;
                    color: #9ca3af;
                    font-size: 12px;
                }
            </style>
        </head>
        <body>
            <div class="header">
                <div class="company-info">
                    <h1>${data.companyName || 'Vaša Firma d.o.o.'}</h1>
                    <p>${data.companyAddress || ''}</p>
                    <p>${data.companyPhone || ''} ${data.companyEmail ? '• ' + data.companyEmail : ''}</p>
                </div>
                <div class="offer-info">
                    <div class="offer-number">PONUDA ${data.offerNumber}</div>
                    <div class="offer-date">
                        Datum: ${formatDate(data.createdDate)}<br>
                        Važi do: ${formatDate(data.validUntil)}
                    </div>
                </div>
            </div>

            <div class="client-section">
                <h3>Klijent</h3>
                <div class="name">${data.clientName}</div>
                <div class="contact">
                    ${data.clientPhone || ''} ${data.clientEmail ? '• ' + data.clientEmail : ''}
                </div>
            </div>

            <table>
                <thead>
                    <tr>
                        <th style="width: 40px;">#</th>
                        <th>Proizvod</th>
                        <th style="width: 60px; text-align: center;">Kom</th>
                        <th style="width: 100px; text-align: right;">Cijena</th>
                        <th style="width: 120px; text-align: right;">Ukupno</th>
                    </tr>
                </thead>
                <tbody>
                    ${productsHTML}
                </tbody>
            </table>

            <div class="totals">
                <div class="totals-row">
                    <span>Suma:</span>
                    <span>${formatCurrency(data.subtotal)}</span>
                </div>
                ${data.transportCost > 0 ? `
                    <div class="totals-row">
                        <span>Transport:</span>
                        <span>${formatCurrency(data.transportCost)}</span>
                    </div>
                ` : ''}
                ${data.discount && data.discount > 0 ? `
                    <div class="totals-row" style="color: #16a34a;">
                        <span>Popust:</span>
                        <span>-${formatCurrency(data.discount)}</span>
                    </div>
                ` : ''}
                <div class="totals-row final">
                    <span>UKUPNO:</span>
                    <span>${formatCurrency(data.total)}</span>
                </div>
            </div>

            ${data.notes ? `
                <div class="notes">
                    <h4>Napomena</h4>
                    <p>${data.notes}</p>
                </div>
            ` : ''}

            <div class="footer">
                ${(data.bankAccounts || []).length > 0 ? `
                    <div style="margin-bottom: 16px; text-align: left;">
                        <div style="font-size: 11px; font-weight: 500; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;">Bankovni računi</div>
                        ${(data.bankAccounts || []).map(acc => `
                            <div style="margin-bottom: 4px; font-size: 12px; color: #6b7280;">
                                <span style="font-weight: 500;">${acc.bankName}:</span> ${acc.accountNumber}
                            </div>
                        `).join('')}
                    </div>
                ` : ''}
                <p>Hvala na povjerenju! • Ponuda generirana: ${new Date().toLocaleDateString('hr-HR')}</p>
            </div>
        </body>
        </html>
    `;
}

// ============================================
// ORDER PDF GENERATION
// ============================================

export interface OrderPDFData {
    orderNumber: string;
    supplierName: string;
    supplierContact?: string;
    supplierPhone?: string;
    supplierEmail?: string;
    orderDate: string;
    expectedDelivery?: string;
    items: Array<{
        materialName: string;
        projectName: string;
        productName: string;
        quantity: number;
        unit: string;
        expectedPrice: number;
        totalPrice: number;
    }>;
    totalAmount: number;
    notes?: string;
    companyName?: string;
    companyAddress?: string;
    companyPhone?: string;
}

export async function generateOrderPDF(data: OrderPDFData): Promise<void> {
    const html = createOrderHTML(data);
    await generatePDFFromHTML(html, `Narudzba_${data.orderNumber}`, {
        orientation: 'portrait',
        format: 'a4',
        margin: 10,
        width: 794,
    });
}

function createOrderHTML(data: OrderPDFData): string {
    const itemsHTML = data.items.map((item, i) => `
        <tr>
            <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">${i + 1}</td>
            <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">
                <strong>${item.materialName}</strong>
                <br><small style="color: #6b7280;">${item.projectName} → ${item.productName}</small>
            </td>
            <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">${item.quantity} ${item.unit}</td>
            <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right;">${formatCurrency(item.expectedPrice)}</td>
            <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right; font-weight: 600;">${formatCurrency(item.totalPrice)}</td>
        </tr>
    `).join('');

    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <style>
                * { box-sizing: border-box; margin: 0; padding: 0; }
                body { 
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    color: #1f2937;
                    line-height: 1.5;
                    padding: 40px;
                    background: white;
                }
                .header { 
                    display: flex; 
                    justify-content: space-between; 
                    align-items: flex-start;
                    margin-bottom: 40px;
                    padding-bottom: 20px;
                    border-bottom: 2px solid #e5e7eb;
                }
                .company-info h1 { 
                    font-size: 24px; 
                    font-weight: 700;
                    color: #111827;
                }
                .company-info p { color: #6b7280; font-size: 14px; }
                .order-info { text-align: right; }
                .order-number { 
                    font-size: 28px; 
                    font-weight: 700;
                    color: #dc2626;
                }
                .order-date { color: #6b7280; font-size: 14px; }
                .supplier-section {
                    background: #fef2f2;
                    padding: 20px;
                    border-radius: 8px;
                    margin-bottom: 30px;
                    border-left: 4px solid #dc2626;
                }
                .supplier-section h3 {
                    font-size: 14px;
                    font-weight: 600;
                    color: #991b1b;
                    margin-bottom: 8px;
                }
                .supplier-section .name {
                    font-size: 18px;
                    font-weight: 600;
                    color: #111827;
                }
                .supplier-section .contact {
                    color: #6b7280;
                    font-size: 14px;
                }
                table { 
                    width: 100%; 
                    border-collapse: collapse; 
                    margin-bottom: 30px;
                }
                thead { background: transparent; }
                th { 
                    padding: 12px; 
                    text-align: left; 
                    font-weight: 600;
                    color: #4b5563;
                    font-size: 13px;
                    border-bottom: 1px solid #e5e7eb;
                }
                th:nth-child(3), th:nth-child(4), th:nth-child(5) { text-align: right; }
                .totals {
                    margin-left: auto;
                    width: 300px;
                }
                .totals-row {
                    display: flex;
                    justify-content: space-between;
                    padding: 12px 0;
                    border-top: 2px solid #111827;
                    font-size: 20px;
                    font-weight: 700;
                }
                .notes {
                    margin-top: 40px;
                    padding: 20px;
                    background: #f3f4f6;
                    border-radius: 8px;
                }
                .notes h4 { 
                    font-size: 14px; 
                    font-weight: 600;
                    margin-bottom: 8px;
                }
                .notes p { color: #6b7280; font-size: 14px; }
                .footer {
                    margin-top: 60px;
                    padding-top: 20px;
                    border-top: 1px solid #e5e7eb;
                    text-align: center;
                    color: #9ca3af;
                    font-size: 12px;
                }
            </style>
        </head>
        <body>
            <div class="header">
                <div class="company-info">
                    <h1>${data.companyName || 'Vaša Firma d.o.o.'}</h1>
                    <p>${data.companyAddress || ''}</p>
                    <p>${data.companyPhone || ''}</p>
                </div>
                <div class="order-info">
                    <div class="order-number">NARUDŽBA ${data.orderNumber}</div>
                    <div class="order-date">
                        Datum: ${formatDate(data.orderDate)}
                        ${data.expectedDelivery ? `<br>Očekivana isporuka: ${formatDate(data.expectedDelivery)}` : ''}
                    </div>
                </div>
            </div>

            <div class="supplier-section">
                <h3>Dobavljač</h3>
                <div class="name">${data.supplierName}</div>
                <div class="contact">
                    ${data.supplierContact || ''} ${data.supplierPhone ? '• ' + data.supplierPhone : ''} ${data.supplierEmail ? '• ' + data.supplierEmail : ''}
                </div>
            </div>

            <table>
                <thead>
                    <tr>
                        <th style="width: 40px;">#</th>
                        <th>Materijal / Projekt</th>
                        <th style="width: 100px; text-align: center;">Količina</th>
                        <th style="width: 100px; text-align: right;">Jed. cijena</th>
                        <th style="width: 120px; text-align: right;">Ukupno</th>
                    </tr>
                </thead>
                <tbody>
                    ${itemsHTML}
                </tbody>
            </table>

            <div class="totals">
                <div class="totals-row">
                    <span>UKUPNO:</span>
                    <span>${formatCurrency(data.totalAmount)}</span>
                </div>
            </div>

            ${data.notes ? `
                <div class="notes">
                    <h4>Napomena</h4>
                    <p>${data.notes}</p>
                </div>
            ` : ''}

            <div class="footer">
                <p>Narudžba generirana: ${new Date().toLocaleDateString('hr-HR')}</p>
            </div>
        </body>
        </html>
    `;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

export function formatCurrency(amount: number): string {
    return new Intl.NumberFormat('hr-HR', {
        style: 'currency',
        currency: 'EUR',
        minimumFractionDigits: 2,
    }).format(amount);
}

export function formatDate(dateString: string): string {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('hr-HR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
    });
}
