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
        <>
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

            {/* Print Template */}
            <div className="print-template">
                {/* Header */}
                <div className="print-header">
                    <div className="header-left">
                        <h1>{companyName}</h1>
                        <p className="header-subtitle">Radni Nalog</p>
                    </div>
                    <div className="header-right">
                        <div className="header-info">
                            <span className="info-label">Broj naloga:</span>
                            <span className="info-value">{workOrder.Work_Order_Number}</span>
                        </div>
                        <div className="header-info">
                            <span className="info-label">Datum izdavanja:</span>
                            <span className="info-value">{formatDate(workOrder.Created_Date)}</span>
                        </div>
                        <div className="header-info">
                            <span className="info-label">Očekivani završetak:</span>
                            <span className="info-value">{formatDate(workOrder.Due_Date)}</span>
                        </div>
                    </div>
                </div>

                {/* Notes (if present) */}
                {workOrder.Notes && (
                    <div className="print-notes">
                        <strong>Napomena:</strong> {workOrder.Notes}
                    </div>
                )}

                {/* Main Products Table with Nested Materials */}
                <table className="print-table">
                    <thead>
                        <tr>
                            <th className="col-rb">RB</th>
                            <th className="col-product">Proizvod / Materijal</th>
                            <th className="col-qty">Količina</th>
                            {!showMaterials && <th className="col-project">Projekat</th>}
                        </tr>
                    </thead>
                    <tbody>
                        {workOrder.items?.map((item, index) => (
                            <>
                                {/* Product Row */}
                                <tr key={item.ID} className="product-row">
                                    <td className="col-rb">{index + 1}</td>
                                    <td className="col-product">
                                        <strong>{item.Product_Name}</strong>
                                    </td>
                                    <td className="col-qty">{item.Quantity} kom</td>
                                    {!showMaterials && <td className="col-project">{item.Project_Name}</td>}
                                </tr>

                                {/* Materials Sub-Rows (Nested) */}
                                {showMaterials && item.materials && item.materials.length > 0 && (
                                    <>
                                        <tr className="materials-header">
                                            <td colSpan={4}>
                                                <div className="materials-title">
                                                    <span className="material-icons-round">inventory_2</span>
                                                    Materijali (Projekat: {item.Project_Name})
                                                </div>
                                            </td>
                                        </tr>
                                        {item.materials.map((material: any, mIdx: number) => (
                                            <tr key={`${item.ID}-mat-${mIdx}`} className="material-row">
                                                <td className="col-rb"></td>
                                                <td className="col-product material-indent">
                                                    • {material.Material_Name}
                                                    {material.Supplier && ` (${material.Supplier})`}
                                                </td>
                                                <td className="col-qty">
                                                    {material.Quantity} {material.Unit}
                                                </td>
                                                <td className="col-project"></td>
                                            </tr>
                                        ))}
                                    </>
                                )}
                            </>
                        ))}
                    </tbody>
                </table>

                {/* Optional Processes Section */}
                {showProcesses && (
                    <div className="processes-section">
                        <h3>Procesi</h3>
                        <table className="process-table">
                            <thead>
                                <tr>
                                    <th>Proizvod</th>
                                    {workOrder.Production_Steps.map(step => (
                                        <th key={step}>{step}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {workOrder.items?.map(item => (
                                    <tr key={item.ID}>
                                        <td><strong>{item.Product_Name}</strong></td>
                                        {workOrder.Production_Steps.map(process => {
                                            const assignment = item.Process_Assignments?.[process];
                                            return (
                                                <td key={process}>
                                                    {assignment?.Worker_Name ? (
                                                        <div className="worker-assignment">
                                                            <span className="worker-icon">👤</span>
                                                            {assignment.Worker_Name}
                                                        </div>
                                                    ) : (
                                                        <span className="not-assigned">—</span>
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

                {/* Signature Section */}
                <div className="signature-section">
                    <div className="signature-box">
                        <div className="signature-label">Izdao:</div>
                        <div className="signature-line">_______________________</div>
                    </div>
                    <div className="signature-box">
                        <div className="signature-label">Primio:</div>
                        <div className="signature-line">_______________________</div>
                    </div>
                    <div className="signature-box">
                        <div className="signature-label">Datum:</div>
                        <div className="signature-line">_______________________</div>
                    </div>
                </div>
            </div>

            <style jsx>{`
                /* Print Controls (hidden when printing) */
                .print-controls {
                    background: #f8f9fa;
                    padding: 20px;
                    border-radius: 12px;
                    margin-bottom: 20px;
                }
                .print-controls h3 {
                    margin: 0 0 16px 0;
                    font-size: 16px;
                }
                .controls-row {
                    display: flex;
                    gap: 24px;
                    margin-bottom: 16px;
                }
                .checkbox-label {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-size: 14px;
                    font-weight: 600;
                    cursor: pointer;
                }
                .checkbox-label input[type="checkbox"] {
                    width: 18px;
                    height: 18px;
                    cursor: pointer;
                }
                .print-btn {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }

                /* Print Template */
                .print-template {
                    background: white;
                    padding: 40px;
                    max-width: 210mm; /* A4 width */
                    margin: 0 auto;
                    box-shadow: 0 0 20px rgba(0,0,0,0.1);
                }

                /* Header */
                .print-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: flex-start;
                    margin-bottom: 30px;
                    padding-bottom: 20px;
                    border-bottom: 3px solid #333;
                }
                .header-left h1 {
                    margin: 0;
                    font-size: 28px;
                    font-weight: 700;
                    color: #333;
                }
                .header-subtitle {
                    margin: 4px 0 0 0;
                    font-size: 14px;
                    color: #666;
                    text-transform: uppercase;
                    letter-spacing: 1px;
                }
                .header-right {
                    text-align: right;
                }
                .header-info {
                    display: flex;
                    gap: 12px;
                    margin-bottom: 6px;
                }
                .info-label {
                    font-size: 12px;
                    color: #666;
                    font-weight: 600;
                }
                .info-value {
                    font-size: 12px;
                    font-weight: 700;
                    color: #333;
                }

                /* Notes */
                .print-notes {
                    background: #fff3cd;
                    padding: 12px 16px;
                    border-left: 4px solid #ffc107;
                    margin-bottom: 20px;
                    font-size: 13px;
                }
                .print-notes strong {
                    margin-right: 8px;
                }

                /* Main Table */
                .print-table {
                    width: 100%;
                    border-collapse: collapse;
                    margin-bottom: 30px;
                    font-size: 12px;
                }
                .print-table thead {
                    background: #f0f1f3;
                }
                .print-table th {
                    padding: 12px 10px;
                    text-align: left;
                    font-weight: 700;
                    border: 1px solid #ddd;
                    text-transform: uppercase;
                    font-size: 11px;
                }
                .print-table td {
                    padding: 10px;
                    border: 1px solid #ddd;
                }
                .col-rb {
                    width: 50px;
                    text-align: center;
                }
                .col-product {
                    width: auto;
                }
                .col-qty {
                    width: 120px;
                    text-align: center;
                }
                .col-project {
                    width: 200px;
                }

                /* Product Rows */
                .product-row {
                    background: #fafbfc;
                    font-weight: 600;
                }
                .product-row td {
                    border-top: 2px solid #333;
                }

                /* Materials Section */
                .materials-header td {
                    background: #e8f4ff;
                    border: none;
                    padding: 8px 10px;
                }
                .materials-title {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    font-weight: 600;
                    font-size: 11px;
                    color: var(--accent);
                }
                .materials-title .material-icons-round {
                    font-size: 16px;
                }
                .material-row {
                    background: #f9f9f9;
                }
                .material-row td {
                    border-top: none;
                }
                .material-indent {
                    padding-left: 30px;
                    font-weight: 400;
                    color: #555;
                }

                /* Processes Section */
                .processes-section {
                    margin-top: 30px;
                }
                .processes-section h3 {
                    margin: 0 0 12px 0;
                    font-size: 16px;
                    font-weight: 700;
                }
                .process-table {
                    width: 100%;
                    border-collapse: collapse;
                    font-size: 11px;
                }
                .process-table th,
                .process-table td {
                    padding: 8px;
                    border: 1px solid #ddd;
                    text-align: center;
                }
                .process-table th {
                    background: #f0f1f3;
                    font-weight: 700;
                }
                .worker-assignment {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 4px;
                    font-weight: 600;
                }
                .worker-icon {
                    font-size: 14px;
                }
                .not-assigned {
                    color: #999;
                }

                /* Signature Section */
                .signature-section {
                    margin-top: 60px;
                    display: grid;
                    grid-template-columns: repeat(3, 1fr);
                    gap: 30px;
                }
                .signature-box {
                    text-align: center;
                }
                .signature-label {
                    font-size: 12px;
                    font-weight: 600;
                    margin-bottom: 30px;
                }
                .signature-line {
                    border-bottom: 2px solid #333;
                    padding-top: 20px;
                }

                /* Print-specific styles */
                @media print {
                    .no-print {
                        display: none !important;
                    }
                    .print-template {
                        box-shadow: none;
                        padding: 20mm;
                    }
                    @page {
                        size: A4 portrait;
                        margin: 15mm;
                    }
                    .print-table,
                    .process-table {
                        page-break-inside: avoid;
                    }
                    .product-row {
                        page-break-inside: avoid;
                        page-break-after: avoid;
                    }
                }
            `}</style>
        </>
    );
}
