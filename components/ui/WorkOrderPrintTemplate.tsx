'use client';

import { useState, useRef } from 'react';
import type { WorkOrder } from '@/lib/types';

interface WorkOrderPrintTemplateProps {
    workOrder: WorkOrder;
    companyName?: string;
}

export default function WorkOrderPrintTemplate({ workOrder, companyName = 'ERP Stolarija' }: WorkOrderPrintTemplateProps) {
    const [showMaterials, setShowMaterials] = useState(true);
    const [showProcesses, setShowProcesses] = useState(false);
    const printRef = useRef<HTMLDivElement>(null);

    function formatDate(dateString: string): string {
        if (!dateString) return '-';
        return new Date(dateString).toLocaleDateString('hr-HR');
    }

    function handlePrint() {
        if (!printRef.current) return;

        // Get the print content HTML
        const printContent = printRef.current.innerHTML;

        // Get the styles from the current document
        const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
            .map(el => el.outerHTML)
            .join('\n');

        // Create a hidden iframe for printing
        const iframe = document.createElement('iframe');
        iframe.style.position = 'absolute';
        iframe.style.top = '-9999px';
        iframe.style.left = '-9999px';
        iframe.style.width = '210mm';
        iframe.style.height = '297mm';
        document.body.appendChild(iframe);

        const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
        if (!iframeDoc) {
            document.body.removeChild(iframe);
            return;
        }

        // Write the complete HTML document to the iframe
        iframeDoc.open();
        iframeDoc.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <title>Radni Nalog - ${workOrder.Work_Order_Number}</title>
                <style>
                    @page {
                        size: A4 portrait;
                        margin: 0;
                    }
                    * {
                        box-sizing: border-box;
                        margin: 0;
                        padding: 0;
                    }
                    body {
                        font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
                        font-size: 10pt;
                        color: #222;
                        line-height: 1.4;
                        background: white;
                        margin: 0;
                        padding: 0;
                    }
                    .print-document {
                        width: 210mm;
                        min-height: 297mm;
                        padding: 0;
                        margin: 0;
                        background: white;
                    }
                    .print-layout-table {
                        width: 100%;
                        border-collapse: collapse;
                    }
                    .running-header { display: table-header-group; }
                    .running-footer { display: table-footer-group; }
                    .page-header {
                        display: flex;
                        justify-content: space-between;
                        align-items: flex-end;
                        padding: 15mm 15mm 8mm 15mm;
                        border-bottom: 2pt solid #1a1a1a;
                        margin-bottom: 6mm;
                    }
                    .brand-name { font-size: 18pt; font-weight: 700; color: #1a1a1a; }
                    .doc-type { font-size: 9pt; font-weight: 600; color: #666; text-transform: uppercase; letter-spacing: 2px; margin-top: 2mm; }
                    .header-meta { text-align: right; }
                    .meta-row { display: flex; justify-content: flex-end; gap: 8px; margin-bottom: 2px; }
                    .meta-label { font-size: 8pt; color: #888; }
                    .meta-value { font-size: 9pt; font-weight: 600; color: #333; min-width: 80px; text-align: right; }
                    .meta-value.highlight { color: #d63031; font-weight: 700; }
                    .page-footer {
                        display: flex;
                        justify-content: space-between;
                        padding: 6mm 15mm 10mm 15mm;
                        border-top: 1pt solid #ddd;
                        margin-top: 6mm;
                        font-size: 8pt;
                        color: #888;
                    }
                    .content-cell { padding: 0 15mm; vertical-align: top; }
                    .notes-banner {
                        background: #fffde7;
                        border: 1pt solid #ffc107;
                        border-radius: 4px;
                        padding: 8px 12px;
                        margin-bottom: 6mm;
                        font-size: 9pt;
                    }
                    .notes-banner strong { color: #f57c00; margin-right: 6px; }
                    .summary-bar {
                        display: flex;
                        gap: 20px;
                        padding: 10px 16px;
                        background: #f5f6f7;
                        border-radius: 6px;
                        margin-bottom: 6mm;
                    }
                    .summary-item { display: flex; gap: 6px; align-items: center; }
                    .summary-label { font-size: 8pt; color: #666; }
                    .summary-value { font-size: 9pt; font-weight: 600; color: #333; }
                    .section { margin-bottom: 8mm; }
                    .section-title {
                        font-size: 10pt;
                        font-weight: 700;
                        color: #1a1a1a;
                        padding-bottom: 3mm;
                        margin-bottom: 3mm;
                        border-bottom: 1pt solid #333;
                    }
                    .data-table { width: 100%; border-collapse: collapse; font-size: 9pt; }
                    .data-table th {
                        background: #f0f0f0;
                        font-weight: 600;
                        text-align: left;
                        padding: 8px 10px;
                        border: 0.5pt solid #ccc;
                        font-size: 8pt;
                        text-transform: uppercase;
                        color: #555;
                    }
                    .data-table td { padding: 8px 10px; border: 0.5pt solid #ddd; vertical-align: top; }
                    .data-table .col-num { width: 30px; text-align: center; color: #888; }
                    .data-table .col-name { font-weight: 500; }
                    .data-table .col-project { color: #666; width: 140px; }
                    .data-table .col-qty { width: 80px; text-align: center; font-weight: 600; }
                    .data-table .col-process { text-align: center; width: 80px; font-size: 8pt; }
                    .product-main-row { background: #fafafa; }
                    .product-main-row td { border-bottom: none; }
                    .materials-row td { background: #fff; border-top: none; padding-top: 0; padding-bottom: 10px; }
                    .materials-list { padding-left: 20px; }
                    .materials-label { font-size: 8pt; color: #888; font-weight: 600; margin-bottom: 4px; text-transform: uppercase; }
                    .materials-list ul { margin: 0; padding-left: 16px; }
                    .materials-list li { font-size: 8pt; color: #555; margin-bottom: 2px; }
                    .materials-list .supplier { color: #999; font-style: italic; }
                    .signature-area { margin-top: 15mm; padding-top: 10mm; }
                    .signature-row { display: flex; justify-content: space-between; gap: 20mm; }
                    .signature-block { flex: 1; text-align: center; }
                    .signature-line { border-bottom: 1pt solid #333; height: 15mm; }
                    .signature-label { font-size: 8pt; color: #666; margin-top: 3mm; text-transform: uppercase; }
                    .avoid-break { page-break-inside: avoid; }
                    @media print {
                        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                    }
                </style>
            </head>
            <body>
                <div class="print-document">
                    ${printContent}
                </div>
            </body>
            </html>
        `);
        iframeDoc.close();

        // Wait for styles to load, then print
        setTimeout(() => {
            iframe.contentWindow?.focus();
            iframe.contentWindow?.print();

            // Clean up after print dialog closes
            setTimeout(() => {
                document.body.removeChild(iframe);
            }, 1000);
        }, 250);
    }

    const totalProducts = workOrder.items?.length || 0;

    return (
        <>
            {/* Print Controls (hidden when printing) */}
            <div className="print-controls no-print">
                <div className="controls-header">
                    <span className="material-icons-round">settings</span>
                    <h3>Opcije Printa</h3>
                </div>
                <div className="controls-body">
                    <label className="checkbox-label">
                        <input
                            type="checkbox"
                            checked={showMaterials}
                            onChange={e => setShowMaterials(e.target.checked)}
                        />
                        <span className="checkmark"></span>
                        Prikaži materijale po proizvodima
                    </label>
                    <label className="checkbox-label">
                        <input
                            type="checkbox"
                            checked={showProcesses}
                            onChange={e => setShowProcesses(e.target.checked)}
                        />
                        <span className="checkmark"></span>
                        Prikaži raspodjelu procesa/radnika
                    </label>
                </div>
                <button className="print-action-btn" onClick={handlePrint}>
                    <span className="material-icons-round">print</span>
                    Printaj Radni Nalog
                </button>
            </div>

            {/* ====== PRINT DOCUMENT ====== */}
            <div className="print-document" ref={printRef}>
                {/* Running Header (repeats on every page via CSS table-header-group) */}
                <table className="print-layout-table">
                    <thead className="running-header">
                        <tr>
                            <td>
                                <div className="page-header">
                                    <div className="header-brand">
                                        <div className="brand-name">{companyName}</div>
                                        <div className="doc-type">RADNI NALOG</div>
                                    </div>
                                    <div className="header-meta">
                                        <div className="meta-row">
                                            <span className="meta-label">Broj:</span>
                                            <span className="meta-value">{workOrder.Work_Order_Number}</span>
                                        </div>
                                        <div className="meta-row">
                                            <span className="meta-label">Datum:</span>
                                            <span className="meta-value">{formatDate(workOrder.Created_Date)}</span>
                                        </div>
                                        <div className="meta-row">
                                            <span className="meta-label">Rok:</span>
                                            <span className="meta-value highlight">{formatDate(workOrder.Due_Date)}</span>
                                        </div>
                                    </div>
                                </div>
                            </td>
                        </tr>
                    </thead>

                    {/* Running Footer (repeats on every page) */}
                    <tfoot className="running-footer">
                        <tr>
                            <td>
                                <div className="page-footer">
                                    <div className="footer-left">
                                        {companyName} • Radni Nalog {workOrder.Work_Order_Number}
                                    </div>
                                    <div className="footer-right">
                                        Stranica <span className="page-number"></span>
                                    </div>
                                </div>
                            </td>
                        </tr>
                    </tfoot>

                    {/* Main Content */}
                    <tbody>
                        <tr>
                            <td className="content-cell">
                                {/* Notes Banner */}
                                {workOrder.Notes && (
                                    <div className="notes-banner">
                                        <strong>NAPOMENA:</strong> {workOrder.Notes}
                                    </div>
                                )}

                                {/* Summary Info */}
                                <div className="summary-bar">
                                    <div className="summary-item">
                                        <span className="summary-label">Ukupno proizvoda:</span>
                                        <span className="summary-value">{totalProducts}</span>
                                    </div>
                                    <div className="summary-item">
                                        <span className="summary-label">Status:</span>
                                        <span className="summary-value">{workOrder.Status}</span>
                                    </div>
                                    <div className="summary-item">
                                        <span className="summary-label">Procesi:</span>
                                        <span className="summary-value">{workOrder.Production_Steps?.join(', ')}</span>
                                    </div>
                                </div>

                                {/* Products List */}
                                <div className="section">
                                    <div className="section-title">SPISAK PROIZVODA</div>
                                    <table className="data-table">
                                        <thead>
                                            <tr>
                                                <th className="col-num">#</th>
                                                <th className="col-name">Naziv proizvoda</th>
                                                <th className="col-project">Projekat</th>
                                                <th className="col-qty">Količina</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {workOrder.items?.map((item, idx) => (
                                                <>
                                                    <tr key={item.ID} className="product-main-row">
                                                        <td className="col-num">{idx + 1}</td>
                                                        <td className="col-name">{item.Product_Name}</td>
                                                        <td className="col-project">{item.Project_Name}</td>
                                                        <td className="col-qty">{item.Quantity} kom</td>
                                                    </tr>

                                                    {/* Nested Materials */}
                                                    {showMaterials && item.materials && item.materials.length > 0 && (
                                                        <tr key={`${item.ID}-mats`} className="materials-row">
                                                            <td></td>
                                                            <td colSpan={3}>
                                                                <div className="materials-list">
                                                                    <div className="materials-label">Materijali:</div>
                                                                    <ul>
                                                                        {item.materials.map((mat: any, mIdx: number) => (
                                                                            <li key={mIdx}>
                                                                                {mat.Material_Name} — {mat.Quantity} {mat.Unit}
                                                                                {mat.Supplier && <span className="supplier"> ({mat.Supplier})</span>}
                                                                            </li>
                                                                        ))}
                                                                    </ul>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    )}
                                                </>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                {/* Processes Section (Optional) */}
                                {showProcesses && (
                                    <div className="section avoid-break">
                                        <div className="section-title">RASPODJELA PO PROCESIMA</div>
                                        <table className="data-table compact">
                                            <thead>
                                                <tr>
                                                    <th className="col-name">Proizvod</th>
                                                    {workOrder.Production_Steps?.map(step => (
                                                        <th key={step} className="col-process">{step}</th>
                                                    ))}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {workOrder.items?.map((item) => (
                                                    <tr key={item.ID}>
                                                        <td className="col-name">{item.Product_Name}</td>
                                                        {workOrder.Production_Steps?.map(process => {
                                                            const assignment = item.Process_Assignments?.[process];
                                                            return (
                                                                <td key={process} className="col-process">
                                                                    {assignment?.Worker_Name || '—'}
                                                                </td>
                                                            );
                                                        })}
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}

                                {/* Signature Area */}
                                <div className="signature-area avoid-break">
                                    <div className="signature-row">
                                        <div className="signature-block">
                                            <div className="signature-line"></div>
                                            <div className="signature-label">Izdao</div>
                                        </div>
                                        <div className="signature-block">
                                            <div className="signature-line"></div>
                                            <div className="signature-label">Primio</div>
                                        </div>
                                        <div className="signature-block">
                                            <div className="signature-line"></div>
                                            <div className="signature-label">Datum prijema</div>
                                        </div>
                                    </div>
                                </div>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <style jsx>{`
                /* ====== SCREEN STYLES (Controls) ====== */
                .print-controls {
                    background: white;
                    border: 1px solid #e0e0e0;
                    border-radius: 12px;
                    padding: 24px;
                    margin-bottom: 24px;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.06);
                }
                .controls-header {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    margin-bottom: 20px;
                    padding-bottom: 16px;
                    border-bottom: 1px solid #eee;
                }
                .controls-header h3 {
                    margin: 0;
                    font-size: 16px;
                    font-weight: 600;
                }
                .controls-header .material-icons-round {
                    color: var(--accent);
                    font-size: 22px;
                }
                .controls-body {
                    display: flex;
                    flex-direction: column;
                    gap: 14px;
                    margin-bottom: 24px;
                }
                .checkbox-label {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    font-size: 14px;
                    cursor: pointer;
                    user-select: none;
                }
                .checkbox-label input[type="checkbox"] {
                    width: 20px;
                    height: 20px;
                    accent-color: var(--accent);
                    cursor: pointer;
                }
                .print-action-btn {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 10px;
                    width: 100%;
                    padding: 14px 24px;
                    background: #1a1a1a;
                    color: white;
                    border: none;
                    border-radius: 10px;
                    font-size: 15px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.2s;
                }
                .print-action-btn:hover {
                    background: #333;
                    transform: translateY(-1px);
                }
                .print-action-btn .material-icons-round {
                    font-size: 20px;
                }

                /* ====== PRINT DOCUMENT (Preview) ====== */
                .print-document {
                    background: white;
                    box-shadow: 0 0 30px rgba(0,0,0,0.1);
                    width: 210mm;
                    min-height: 297mm;
                    margin: 0 auto;
                    font-family: 'Segoe UI', system-ui, sans-serif;
                    font-size: 10pt;
                    color: #222;
                    line-height: 1.4;
                }

                /* Layout Table for Running Header/Footer */
                .print-layout-table {
                    width: 100%;
                    border-collapse: collapse;
                }

                /* Running Header */
                .running-header td {
                    padding: 0;
                }
                .page-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: flex-end;
                    padding: 15mm 15mm 8mm 15mm;
                    border-bottom: 2pt solid #1a1a1a;
                    margin-bottom: 6mm;
                }
                .brand-name {
                    font-size: 18pt;
                    font-weight: 700;
                    color: #1a1a1a;
                    letter-spacing: -0.5px;
                }
                .doc-type {
                    font-size: 9pt;
                    font-weight: 600;
                    color: #666;
                    text-transform: uppercase;
                    letter-spacing: 2px;
                    margin-top: 2mm;
                }
                .header-meta {
                    text-align: right;
                }
                .meta-row {
                    display: flex;
                    justify-content: flex-end;
                    gap: 8px;
                    margin-bottom: 2px;
                }
                .meta-label {
                    font-size: 8pt;
                    color: #888;
                    font-weight: 500;
                }
                .meta-value {
                    font-size: 9pt;
                    font-weight: 600;
                    color: #333;
                    min-width: 80px;
                    text-align: right;
                }
                .meta-value.highlight {
                    color: #d63031;
                    font-weight: 700;
                }

                /* Running Footer */
                .running-footer td {
                    padding: 0;
                }
                .page-footer {
                    display: flex;
                    justify-content: space-between;
                    padding: 6mm 15mm 10mm 15mm;
                    border-top: 1pt solid #ddd;
                    margin-top: 6mm;
                    font-size: 8pt;
                    color: #888;
                }

                /* Content Cell */
                .content-cell {
                    padding: 0 15mm;
                    vertical-align: top;
                }

                /* Notes Banner */
                .notes-banner {
                    background: #fffde7;
                    border: 1pt solid #ffc107;
                    border-radius: 4px;
                    padding: 8px 12px;
                    margin-bottom: 6mm;
                    font-size: 9pt;
                }
                .notes-banner strong {
                    color: #f57c00;
                    margin-right: 6px;
                }

                /* Summary Bar */
                .summary-bar {
                    display: flex;
                    gap: 20px;
                    padding: 10px 16px;
                    background: #f5f6f7;
                    border-radius: 6px;
                    margin-bottom: 6mm;
                }
                .summary-item {
                    display: flex;
                    gap: 6px;
                    align-items: center;
                }
                .summary-label {
                    font-size: 8pt;
                    color: #666;
                }
                .summary-value {
                    font-size: 9pt;
                    font-weight: 600;
                    color: #333;
                }

                /* Section */
                .section {
                    margin-bottom: 8mm;
                }
                .section-title {
                    font-size: 10pt;
                    font-weight: 700;
                    color: #1a1a1a;
                    padding-bottom: 3mm;
                    margin-bottom: 3mm;
                    border-bottom: 1pt solid #333;
                    letter-spacing: 0.5px;
                }

                /* Data Table */
                .data-table {
                    width: 100%;
                    border-collapse: collapse;
                    font-size: 9pt;
                }
                .data-table th {
                    background: #f0f0f0;
                    font-weight: 600;
                    text-align: left;
                    padding: 8px 10px;
                    border: 0.5pt solid #ccc;
                    font-size: 8pt;
                    text-transform: uppercase;
                    color: #555;
                }
                .data-table td {
                    padding: 8px 10px;
                    border: 0.5pt solid #ddd;
                    vertical-align: top;
                }
                .data-table .col-num {
                    width: 30px;
                    text-align: center;
                    color: #888;
                }
                .data-table .col-name {
                    font-weight: 500;
                }
                .data-table .col-project {
                    color: #666;
                    width: 140px;
                }
                .data-table .col-qty {
                    width: 80px;
                    text-align: center;
                    font-weight: 600;
                }
                .data-table .col-process {
                    text-align: center;
                    width: 80px;
                    font-size: 8pt;
                }
                .data-table.compact td,
                .data-table.compact th {
                    padding: 6px 8px;
                }

                /* Product Main Row */
                .product-main-row {
                    background: #fafafa;
                }
                .product-main-row td {
                    border-bottom: none;
                }

                /* Materials Row */
                .materials-row td {
                    background: #fff;
                    border-top: none;
                    padding-top: 0;
                    padding-bottom: 10px;
                }
                .materials-list {
                    padding-left: 20px;
                }
                .materials-label {
                    font-size: 8pt;
                    color: #888;
                    font-weight: 600;
                    margin-bottom: 4px;
                    text-transform: uppercase;
                }
                .materials-list ul {
                    margin: 0;
                    padding-left: 16px;
                }
                .materials-list li {
                    font-size: 8pt;
                    color: #555;
                    margin-bottom: 2px;
                }
                .materials-list .supplier {
                    color: #999;
                    font-style: italic;
                }

                /* Signature Area */
                .signature-area {
                    margin-top: 15mm;
                    padding-top: 10mm;
                }
                .signature-row {
                    display: flex;
                    justify-content: space-between;
                    gap: 20mm;
                }
                .signature-block {
                    flex: 1;
                    text-align: center;
                }
                .signature-line {
                    border-bottom: 1pt solid #333;
                    height: 15mm;
                }
                .signature-label {
                    font-size: 8pt;
                    color: #666;
                    margin-top: 3mm;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }

                /* Avoid Break */
                .avoid-break {
                    page-break-inside: avoid;
                }

                /* ====== PRINT MEDIA STYLES ====== */
                @media print {
                    /* Hide screen-only elements */
                    .no-print {
                        display: none !important;
                    }

                    /* Reset body for print */
                    body {
                        margin: 0 !important;
                        padding: 0 !important;
                        background: white !important;
                    }

                    /* Document sizing */
                    .print-document {
                        box-shadow: none;
                        width: 100%;
                        min-height: auto;
                        margin: 0;
                        padding: 0;
                    }

                    /* Page setup */
                    @page {
                        size: A4 portrait;
                        margin: 0;
                    }

                    /* Running header repeats on each page */
                    .running-header {
                        display: table-header-group;
                    }

                    /* Running footer repeats on each page */
                    .running-footer {
                        display: table-footer-group;
                    }

                    /* Adjust header for print */
                    .page-header {
                        padding: 10mm 15mm 6mm 15mm;
                    }

                    /* Adjust footer for print */
                    .page-footer {
                        padding: 4mm 15mm 8mm 15mm;
                    }

                    /* Page numbers via CSS counters */
                    .page-number::before {
                        content: counter(page);
                    }

                    /* Ensure tables don't break awkwardly */
                    .data-table thead {
                        display: table-header-group;
                    }
                    .data-table tr {
                        page-break-inside: avoid;
                    }
                    .product-main-row,
                    .materials-row {
                        page-break-inside: avoid;
                    }

                    /* Signature area stays together */
                    .signature-area {
                        page-break-inside: avoid;
                        page-break-before: auto;
                    }

                    /* Section titles stay with content */
                    .section-title {
                        page-break-after: avoid;
                    }
                }

                /* ====== SCREEN PREVIEW ADJUSTMENTS ====== */
                @media screen {
                    .running-header,
                    .running-footer {
                        display: table-header-group;
                    }
                    .running-footer {
                        display: table-footer-group;
                    }
                }
            `}</style>
        </>
    );
}
