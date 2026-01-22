'use client';

import { useState } from 'react';
import type { WorkOrder } from '@/lib/types';

interface WorkOrderPrintTemplateProps {
    workOrder: WorkOrder;
    companyName?: string;
}

export default function WorkOrderPrintTemplate({ workOrder, companyName = 'ERP Stolarija' }: WorkOrderPrintTemplateProps) {
    const [showMaterials, setShowMaterials] = useState(true);
    const [showProcesses, setShowProcesses] = useState(false);

    function formatDate(dateString: string): string {
        if (!dateString) return '-';
        return new Date(dateString).toLocaleDateString('hr-HR');
    }

    function handlePrint() {
        window.print();
    }

    return (
        <div className="print-wrapper">
            {/* Print Controls (hidden when printing) */}
            <div className="print-controls no-print">
                <h3>Opcije Printa</h3>
                <div className="controls-row">
                    <label className="checkbox-label">
                        <input
                            type="checkbox"
                            checked={showMaterials}
                            onChange={e => setShowMaterials(e.target.checked)}
                        />
                        Prikaži materijale
                    </label>
                    <label className="checkbox-label">
                        <input
                            type="checkbox"
                            checked={showProcesses}
                            onChange={e => setShowProcesses(e.target.checked)}
                        />
                        Prikaži procese
                    </label>
                </div>
                <button className="btn btn-primary print-btn" onClick={handlePrint}>
                    <span className="material-icons-round">print</span>
                    Printaj
                </button>
            </div>

            {/* A4 Page Container */}
            <div className="page-container">
                <div className="print-content">
                    {/* Header Section */}
                    <div className="doc-header">
                        <div className="company-section">
                            <h1 className="company-name">{companyName}</h1>
                            <div className="company-details">
                                <p>Adresa bb</p>
                                <p>75000 Tuzla</p>
                                <p>Tel: +387 61 123 456</p>
                            </div>
                        </div>
                        <div className="doc-meta">
                            <div className="doc-title-box">
                                <h2>RADNI NALOG</h2>
                                <span className="doc-number">#{workOrder.Work_Order_Number}</span>
                            </div>
                            <div className="meta-grid">
                                <div className="meta-item">
                                    <span className="label">Datum izdavanja:</span>
                                    <span className="value">{formatDate(workOrder.Created_Date)}</span>
                                </div>
                                <div className="meta-item">
                                    <span className="label">Rok isporuke:</span>
                                    <span className="value">{formatDate(workOrder.Due_Date)}</span>
                                </div>
                                <div className="meta-item">
                                    <span className="label">Status:</span>
                                    <span className="value status">{workOrder.Status}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="divider-line"></div>

                    {/* Client / Project Info */}
                    <div className="client-section">
                        <div className="section-title">PODACI O NALOGU</div>
                        {/* We can use first item to get project info since all items usually belong to same project context in this view 
                             or if mixed, display general info. Assumption: Work Order is usually per project or clients are mixed. 
                             Based on current types, items have Project Info. Let's list unique projects if multiple. 
                         */}
                        <div className="client-grid">
                            <div className="client-item">
                                <span className="label">Klijent / Projekat:</span>
                                <span className="value">
                                    {Array.from(new Set(workOrder.items?.map(i => i.Project_Name))).join(', ') || 'Generalno'}
                                </span>
                            </div>
                            {workOrder.Notes && (
                                <div className="client-item full-width">
                                    <span className="label">Napomena:</span>
                                    <span className="value note-text">{workOrder.Notes}</span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Main Items Table */}
                    <div className="table-section">
                        <table className="doc-table">
                            <thead>
                                <tr>
                                    <th className="w-rb">#</th>
                                    <th className="w-product">PROIZVOD / OBRADA</th>
                                    <th className="w-qty text-right">KOLIČINA</th>
                                </tr>
                            </thead>
                            <tbody>
                                {workOrder.items?.map((item, index) => (
                                    <>
                                        <tr key={item.ID} className="row-product">
                                            <td className="w-rb">{index + 1}</td>
                                            <td className="w-product">
                                                <div className="product-name">{item.Product_Name}</div>
                                                <div className="product-sub">{item.Project_Name}</div>
                                            </td>
                                            <td className="w-qty text-right">{item.Quantity} kom</td>
                                        </tr>
                                        {showMaterials && item.materials && item.materials.length > 0 && (
                                            <>
                                                <tr className="row-materials-header">
                                                    <td></td>
                                                    <td colSpan={2} className="mat-header-cell">
                                                        <span>MATERIJALI I DIJELOVI</span>
                                                    </td>
                                                </tr>
                                                {item.materials.map((mat, mIdx) => (
                                                    <tr key={`${item.ID}-mat-${mIdx}`} className="row-material">
                                                        <td></td>
                                                        <td className="mat-name">
                                                            • {mat.Material_Name}
                                                            {mat.Supplier && <span className="supplier-hint">({mat.Supplier})</span>}
                                                        </td>
                                                        <td className="text-right mat-qty">
                                                            {mat.Quantity} {mat.Unit}
                                                        </td>
                                                    </tr>
                                                ))}
                                                <tr className="spacer-row"><td colSpan={3}></td></tr>
                                            </>
                                        )}
                                    </>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* Worker Processes Section (Optional) */}
                    {showProcesses && (
                        <div className="processes-section">
                            <div className="section-title">PROCESI I ZADUŽENJA</div>
                            <table className="doc-table processes-table">
                                <thead>
                                    <tr>
                                        <th>PROIZVOD</th>
                                        {workOrder.Production_Steps.map(step => (
                                            <th key={step} className="text-center">{step.toUpperCase()}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {workOrder.items?.map(item => (
                                        <tr key={`proc-${item.ID}`}>
                                            <td className="proc-prod-name">{item.Product_Name}</td>
                                            {workOrder.Production_Steps.map(step => {
                                                const assignment = item.Process_Assignments?.[step];
                                                return (
                                                    <td key={step} className="text-center">
                                                        {assignment?.Worker_Name ? (
                                                            <span className="assigned-worker">{assignment.Worker_Name}</span>
                                                        ) : (
                                                            <span className="no-assign">—</span>
                                                        )}
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* Footer / Signatures */}
                    <div className="doc-footer">
                        <div className="signatures-grid">
                            <div className="sig-box">
                                <span className="sig-label">Izdao:</span>
                                <div className="sig-line"></div>
                            </div>
                            <div className="sig-box">
                                <span className="sig-label">Primio:</span>
                                <div className="sig-line"></div>
                            </div>
                            <div className="sig-box">
                                <span className="sig-label">Datum:</span>
                                <div className="sig-line"></div>
                            </div>
                        </div>
                        <div className="footer-info">
                            <p>Dokument generisan sistemski.</p>
                            <p>{new Date().toLocaleString('hr-HR')}</p>
                        </div>
                    </div>
                </div>
            </div>

            <style jsx>{`
                /* WEB UI STYLES */
                .print-wrapper {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    background: #f0f2f5;
                    padding: 20px;
                    min-height: 100%;
                }
                
                .print-controls {
                    background: white;
                    padding: 16px 24px;
                    border-radius: 8px;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                    margin-bottom: 24px;
                    width: 100%;
                    max-width: 210mm;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .print-controls h3 { margin: 0; font-size: 16px; color: #333; }
                .controls-row { display: flex; gap: 20px; }
                .checkbox-label { display: flex; align-items: center; gap: 8px; font-size: 14px; cursor: pointer; }
                .print-btn { display: flex; align-items: center; gap: 8px; padding: 8px 20px; }

                /* A4 PAGE CONTAINER for Screen Preview */
                .page-container {
                    background: white;
                    width: 210mm;
                    min-height: 297mm;
                    padding: 15mm 15mm;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                    position: relative;
                }

                /* PRINT DOCUMENT STYLES */
                .print-content {
                    font-family: 'Segoe UI', 'Roboto', Helvetica, Arial, sans-serif;
                    color: black;
                }

                /* Header */
                .doc-header {
                    display: flex;
                    justify-content: space-between;
                    margin-bottom: 20px;
                }
                .company-name {
                    font-size: 24px;
                    font-weight: 800;
                    margin: 0 0 8px 0;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }
                .company-details p {
                    margin: 2px 0;
                    font-size: 12px;
                    color: #444;
                }
                
                .doc-meta { text-align: right; }
                .doc-title-box {
                    border: 2px solid black;
                    padding: 8px 16px;
                    display: inline-block;
                    margin-bottom: 12px;
                    text-align: center;
                }
                .doc-title-box h2 {
                    margin: 0;
                    font-size: 16px;
                    font-weight: 700;
                    letter-spacing: 2px;
                }
                .doc-number {
                    display: block;
                    font-size: 14px;
                    font-weight: 600;
                    margin-top: 4px;
                }
                .meta-grid { display: flex; flex-direction: column; gap: 4px; align-items: flex-end; }
                .meta-item { font-size: 12px; }
                .meta-item .label { font-weight: 600; margin-right: 8px; }

                .divider-line {
                    height: 2px;
                    background: black;
                    margin-bottom: 20px;
                }

                /* Sections */
                .section-title {
                    font-size: 12px;
                    font-weight: 700;
                    text-transform: uppercase;
                    border-bottom: 1px solid #999;
                    padding-bottom: 4px;
                    margin-bottom: 12px;
                    letter-spacing: 1px;
                }

                /* Client Section */
                .client-section { margin-bottom: 30px; }
                .client-grid { display: flex; flex-wrap: wrap; gap: 20px; }
                .client-item { display: flex; flex-direction: column; min-width: 200px; }
                .client-item.full-width { width: 100%; margin-top: 8px; }
                .client-item .label { font-size: 11px; color: #555; text-transform: uppercase; font-weight: 600; margin-bottom: 4px; }
                .client-item .value { font-size: 14px; font-weight: 600; }
                .note-text { font-style: italic; font-weight: 400; background: #f0f0f0; padding: 6px 10px; border-radius: 4px; display: block; border: 1px solid #ddd; }

                /* Tables */
                .table-section { margin-bottom: 30px; }
                .doc-table { width: 100%; border-collapse: collapse; font-size: 12px; }
                .doc-table th {
                    text-align: left;
                    font-weight: 700;
                    border-bottom: 2px solid black;
                    padding: 8px 4px;
                    text-transform: uppercase;
                    font-size: 11px;
                }
                .doc-table td {
                    padding: 8px 4px;
                    vertical-align: top;
                }
                .text-right { text-align: right; }
                .text-center { text-align: center; }

                /* Column Widths */
                .w-rb { width: 40px; }
                .w-qty { width: 100px; }
                
                /* Product Row */
                .row-product td {
                    border-bottom: 1px solid #ddd;
                    padding-top: 12px;
                    padding-bottom: 12px;
                }
                .product-name { font-weight: 700; font-size: 13px; }
                .product-sub { font-size: 11px; color: #666; margin-top: 2px; }
                .w-qty { font-weight: 700; }

                /* Materials Rows */
                .row-materials-header td { padding-top: 8px; padding-bottom: 2px; }
                .mat-header-cell {
                    font-size: 10px;
                    font-weight: 700;
                    color: #666;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }
                .row-material td {
                    padding: 4px 4px;
                    color: #444;
                    font-size: 11px;
                }
                .mat-name { padding-left: 20px; }
                .supplier-hint { color: #888; font-size: 10px; font-style: italic; }
                .mat-qty { font-family: monospace; }
                .spacer-row td { height: 16px; border-bottom: 1px solid #eee; }

                /* Process Table */
                .processes-table th { border: 1px solid #ccc; background: #f9f9f9; }
                .processes-table td { border: 1px solid #ccc; padding: 6px; }
                .proc-prod-name { font-weight: 600; }
                .assigned-worker { font-weight: 600; }
                .no-assign { color: #ccc; }

                /* Footer */
                .doc-footer {
                    margin-top: 60px;
                    page-break-inside: avoid;
                }
                .signatures-grid {
                    display: grid;
                    grid-template-columns: 1fr 1fr 1fr;
                    gap: 40px;
                    margin-bottom: 30px;
                }
                .sig-box { display: flex; flex-direction: column; }
                .sig-label { font-size: 11px; font-weight: 600; margin-bottom: 40px; text-transform: uppercase; }
                .sig-line { border-bottom: 1px solid black; }
                
                .footer-info {
                    border-top: 1px solid #ddd;
                    padding-top: 8px;
                    display: flex;
                    justify-content: space-between;
                    font-size: 10px;
                    color: #888;
                }

                /* PRINT MEDIA QUERIES */
                @media print {
                    @page {
                        size: A4 portrait;
                        margin: 0; /* Control margins manually in container if needed, or let standard print margins work */
                    }
                    
                    body {
                        background: white;
                        margin: 0;
                        padding: 0;
                        -webkit-print-color-adjust: exact;
                        print-color-adjust: exact;
                    }

                    .print-wrapper {
                        background: white;
                        padding: 0;
                        display: block;
                    }

                    .print-controls { display: none !important; }

                    .page-container {
                        width: 100%;
                        height: auto;
                        box-shadow: none;
                        padding: 15mm 20mm; /* Standard A4 margins */
                        margin: 0;
                    }

                    .note-text {
                        background: none !important;
                        border: 1px solid #ccc !important;
                    }
                    
                    /* Break avoidance */
                    .row-product, .section-title, .doc-header { page-break-inside: avoid; }
                    .table-section { page-break-inside: auto; }
                    tr { page-break-inside: avoid; }
                    
                    /* Ensure black text */
                    * { color: black !important; }
                    .supplier-hint { color: #555 !important; }
                    .section-title { border-bottom-color: black !important; }
                    .product-sub, .company-details p { color: #333 !important; }
                }
            `}</style>
        </div>
    );
}
