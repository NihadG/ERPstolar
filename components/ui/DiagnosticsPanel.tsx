'use client';

import React, { useState, useEffect } from 'react';
import type { AppState, Project, Product, WorkOrder, WorkOrderItem } from '@/lib/types';
import { repairAllProductStatuses } from '@/lib/attendance';

interface DiagnosticIssue {
    category: string;
    severity: 'HIGH' | 'MEDIUM' | 'LOW';
    description: string;
    data?: Record<string, unknown>;
}

interface DiagnosticsPanelProps {
    appState: AppState;
    onClose: () => void;
}

const VALID_PRODUCT_STATUSES = [
    'Na čekanju', 'Materijali naručeni', 'Materijali spremni',
    'Rezanje', 'Kantiranje', 'Bušenje', 'Sklapanje',
    'Spremno', 'Instalirano'
];
const LEGACY_STATUSES = ['Čeka proizvodnju', 'U proizvodnji', 'Završeno'];

export default function DiagnosticsPanel({ appState, onClose }: DiagnosticsPanelProps) {
    const [issues, setIssues] = useState<DiagnosticIssue[]>([]);
    const [isRunning, setIsRunning] = useState(false);
    const [isRepairing, setIsRepairing] = useState(false);
    const [repairResult, setRepairResult] = useState<string | null>(null);

    const runDiagnostics = () => {
        setIsRunning(true);
        const foundIssues: DiagnosticIssue[] = [];

        // CHECK 1: Product Status Mismatches
        (appState.projects || []).forEach((project: Project) => {
            (project.products || []).forEach((product: Product) => {
                if (LEGACY_STATUSES.includes(product.Status || '')) {
                    foundIssues.push({
                        category: 'Product Status',
                        severity: 'MEDIUM',
                        description: `Product "${product.Name}" has legacy status "${product.Status}"`,
                        data: { projectId: project.Project_ID, productId: product.Product_ID }
                    });
                } else if (product.Status && !VALID_PRODUCT_STATUSES.includes(product.Status)) {
                    foundIssues.push({
                        category: 'Product Status',
                        severity: 'LOW',
                        description: `Product "${product.Name}" has unknown status "${product.Status}"`,
                        data: { projectId: project.Project_ID, productId: product.Product_ID }
                    });
                }
            });
        });

        // CHECK 2: Work Order Item vs Product Status Mismatch
        (appState.workOrders || []).forEach((wo: WorkOrder) => {
            (wo.items || []).forEach((item: WorkOrderItem) => {
                const project = (appState.projects || []).find((p: Project) => p.Project_ID === item.Project_ID);
                const product = project?.products?.find((p: Product) => p.Product_ID === item.Product_ID);

                if (product) {
                    if (item.Status === 'Završeno' && !['Spremno', 'Instalirano'].includes(product.Status || '')) {
                        foundIssues.push({
                            category: 'Sync Mismatch',
                            severity: 'HIGH',
                            description: `WO Item "${item.Product_Name}" is Završeno but Product status is "${product.Status}"`,
                            data: { workOrderId: wo.Work_Order_ID, productStatus: product.Status, itemStatus: item.Status }
                        });
                    }

                    if (item.Status === 'U toku' && ['Na čekanju', 'Materijali naručeni', 'Materijali spremni'].includes(product.Status || '')) {
                        foundIssues.push({
                            category: 'Sync Mismatch',
                            severity: 'MEDIUM',
                            description: `WO Item "${item.Product_Name}" is U toku but Product status is still "${product.Status}"`,
                            data: { workOrderId: wo.Work_Order_ID }
                        });
                    }
                }
            });
        });

        // CHECK 3: Profit Calculation Integrity
        (appState.workOrders || []).forEach((wo: WorkOrder) => {
            if (wo.Status === 'Završeno') {
                const calculatedTotalValue = (wo.items || []).reduce((sum: number, i: WorkOrderItem) => sum + (i.Product_Value || 0), 0);
                const calculatedMaterialCost = (wo.items || []).reduce((sum: number, i: WorkOrderItem) => sum + (i.Material_Cost || 0), 0);
                const calculatedLaborCost = (wo.items || []).reduce((sum: number, i: WorkOrderItem) => sum + (i.Actual_Labor_Cost || 0), 0);
                const calculatedProfit = calculatedTotalValue - calculatedMaterialCost - calculatedLaborCost;

                if (wo.Profit !== undefined && Math.abs(wo.Profit - calculatedProfit) > 1) {
                    foundIssues.push({
                        category: 'Calculation',
                        severity: 'HIGH',
                        description: `WO ${wo.Work_Order_Number} profit mismatch: stored=${(wo.Profit || 0).toFixed(2)}, calculated=${calculatedProfit.toFixed(2)}`,
                        data: { workOrderId: wo.Work_Order_ID, stored: wo.Profit, calculated: calculatedProfit }
                    });
                }

                if (!wo.Total_Value || wo.Total_Value === 0) {
                    foundIssues.push({
                        category: 'Missing Data',
                        severity: 'MEDIUM',
                        description: `WO ${wo.Work_Order_Number} has no Total_Value`,
                        data: { workOrderId: wo.Work_Order_ID }
                    });
                }
            }
        });

        // CHECK 4: Work Order Item Missing Dates
        (appState.workOrders || []).forEach((wo: WorkOrder) => {
            (wo.items || []).forEach((item: WorkOrderItem) => {
                if (item.Status === 'Završeno') {
                    if (!item.Started_At) {
                        foundIssues.push({
                            category: 'Missing Data',
                            severity: 'MEDIUM',
                            description: `WO Item "${item.Product_Name}" is Završeno but has no Started_At`,
                            data: { workOrderId: wo.Work_Order_ID, itemId: item.ID }
                        });
                    }
                    if (!item.Completed_At) {
                        foundIssues.push({
                            category: 'Missing Data',
                            severity: 'MEDIUM',
                            description: `WO Item "${item.Product_Name}" is Završeno but has no Completed_At`,
                            data: { workOrderId: wo.Work_Order_ID, itemId: item.ID }
                        });
                    }
                }
            });
        });

        setIssues(foundIssues);
        setIsRunning(false);
    };

    const handleRepair = async () => {
        setIsRepairing(true);
        setRepairResult(null);
        try {
            const result = await repairAllProductStatuses();
            setRepairResult(result.message);
            // Re-run diagnostics after repair
            setTimeout(runDiagnostics, 1000);
        } catch (error) {
            setRepairResult('Greška pri popravci: ' + (error as Error).message);
        }
        setIsRepairing(false);
    };

    useEffect(() => {
        runDiagnostics();
    }, []);

    const highIssues = issues.filter(i => i.severity === 'HIGH');
    const mediumIssues = issues.filter(i => i.severity === 'MEDIUM');
    const lowIssues = issues.filter(i => i.severity === 'LOW');

    const categories = Array.from(new Set(issues.map(i => i.category)));

    return (
        <div className="diagnostics-panel">
            <div className="diagnostics-header">
                <h2>🔍 Dijagnostika Aplikacije</h2>
                <button onClick={onClose} className="close-btn">✕</button>
            </div>

            <div className="diagnostics-summary">
                <div className="summary-item high">
                    <span className="count">{highIssues.length}</span>
                    <span className="label">🔴 Kritično</span>
                </div>
                <div className="summary-item medium">
                    <span className="count">{mediumIssues.length}</span>
                    <span className="label">🟡 Srednje</span>
                </div>
                <div className="summary-item low">
                    <span className="count">{lowIssues.length}</span>
                    <span className="label">🟢 Nisko</span>
                </div>
            </div>

            <div className="diagnostics-actions">
                <button
                    onClick={runDiagnostics}
                    disabled={isRunning}
                    className="action-btn"
                >
                    {isRunning ? 'Provjeravam...' : '🔄 Ponovi provjeru'}
                </button>
                {highIssues.length > 0 && (
                    <button
                        onClick={handleRepair}
                        disabled={isRepairing}
                        className="action-btn repair"
                    >
                        {isRepairing ? 'Popravljam...' : '🔧 Popravi probleme'}
                    </button>
                )}
            </div>

            {repairResult && (
                <div className="repair-result">
                    {repairResult}
                </div>
            )}

            <div className="diagnostics-issues">
                {issues.length === 0 ? (
                    <div className="no-issues">
                        ✅ Nema pronađenih problema! Podaci su uredni.
                    </div>
                ) : (
                    categories.map(cat => {
                        const catIssues = issues.filter(i => i.category === cat);
                        return (
                            <div key={cat} className="issue-category">
                                <h3>{cat} ({catIssues.length})</h3>
                                <ul>
                                    {catIssues.slice(0, 10).map((issue, idx) => (
                                        <li key={idx} className={`issue-item ${issue.severity.toLowerCase()}`}>
                                            <span className="severity-badge">{issue.severity}</span>
                                            {issue.description}
                                        </li>
                                    ))}
                                    {catIssues.length > 10 && (
                                        <li className="more-issues">... i još {catIssues.length - 10}</li>
                                    )}
                                </ul>
                            </div>
                        );
                    })
                )}
            </div>

            <style>{`
                .diagnostics-panel {
                    background: var(--surface-elevated, #1e1e2e);
                    border-radius: 12px;
                    padding: 20px;
                    max-height: 80vh;
                    overflow-y: auto;
                }
                .diagnostics-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 20px;
                }
                .diagnostics-header h2 {
                    margin: 0;
                    font-size: 1.25rem;
                }
                .close-btn {
                    background: none;
                    border: none;
                    color: var(--text-muted);
                    cursor: pointer;
                    font-size: 1.5rem;
                }
                .diagnostics-summary {
                    display: flex;
                    gap: 16px;
                    margin-bottom: 20px;
                }
                .summary-item {
                    flex: 1;
                    padding: 12px;
                    border-radius: 8px;
                    text-align: center;
                    background: var(--surface, #252535);
                }
                .summary-item .count {
                    display: block;
                    font-size: 2rem;
                    font-weight: bold;
                }
                .summary-item .label {
                    font-size: 0.85rem;
                    color: var(--text-muted);
                }
                .diagnostics-actions {
                    display: flex;
                    gap: 12px;
                    margin-bottom: 16px;
                }
                .action-btn {
                    padding: 8px 16px;
                    border-radius: 6px;
                    border: none;
                    cursor: pointer;
                    background: var(--primary, #7c3aed);
                    color: white;
                }
                .action-btn:disabled {
                    opacity: 0.6;
                    cursor: not-allowed;
                }
                .action-btn.repair {
                    background: var(--warning, #f59e0b);
                }
                .repair-result {
                    padding: 12px;
                    background: var(--success-bg, rgba(34, 197, 94, 0.1));
                    border-radius: 6px;
                    margin-bottom: 16px;
                    color: var(--success, #22c55e);
                }
                .issue-category {
                    margin-bottom: 16px;
                }
                .issue-category h3 {
                    font-size: 1rem;
                    margin-bottom: 8px;
                    color: var(--text-muted);
                }
                .issue-category ul {
                    list-style: none;
                    padding: 0;
                    margin: 0;
                }
                .issue-item {
                    padding: 8px 12px;
                    margin-bottom: 4px;
                    border-radius: 4px;
                    background: var(--surface, #252535);
                    font-size: 0.9rem;
                }
                .issue-item.high {
                    border-left: 3px solid #ef4444;
                }
                .issue-item.medium {
                    border-left: 3px solid #f59e0b;
                }
                .issue-item.low {
                    border-left: 3px solid #22c55e;
                }
                .severity-badge {
                    display: inline-block;
                    padding: 2px 6px;
                    border-radius: 4px;
                    font-size: 0.7rem;
                    margin-right: 8px;
                    font-weight: bold;
                }
                .issue-item.high .severity-badge { background: rgba(239, 68, 68, 0.2); color: #ef4444; }
                .issue-item.medium .severity-badge { background: rgba(245, 158, 11, 0.2); color: #f59e0b; }
                .issue-item.low .severity-badge { background: rgba(34, 197, 94, 0.2); color: #22c55e; }
                .no-issues {
                    text-align: center;
                    padding: 40px;
                    color: var(--success, #22c55e);
                    font-size: 1.1rem;
                }
                .more-issues {
                    color: var(--text-muted);
                    font-style: italic;
                }
            `}</style>
        </div>
    );
}
