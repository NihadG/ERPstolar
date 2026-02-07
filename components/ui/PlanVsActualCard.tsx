'use client';

import { useMemo } from 'react';
import { TrendingUp, TrendingDown, Minus, AlertTriangle, CheckCircle } from 'lucide-react';

interface PlanVsActualCardProps {
    plannedWorkers?: number;
    actualWorkers?: number;
    plannedDays?: number;
    actualDays?: number;
    plannedRate?: number;
    actualRate?: number;
    plannedCost?: number;
    actualCost?: number;
    compact?: boolean;
}

export default function PlanVsActualCard({
    plannedWorkers = 0,
    actualWorkers = 0,
    plannedDays = 0,
    actualDays = 0,
    plannedRate = 0,
    actualRate = 0,
    plannedCost = 0,
    actualCost = 0,
    compact = false,
}: PlanVsActualCardProps) {
    // Calculate variance
    const variance = plannedCost - actualCost;
    const variancePercent = plannedCost > 0 ? (variance / plannedCost) * 100 : 0;
    const isOverBudget = actualCost > plannedCost;
    const isUnderBudget = actualCost < plannedCost && actualCost > 0;

    // Helper to get delta display
    const getDelta = (planned: number, actual: number) => {
        const diff = actual - planned;
        if (diff === 0) return { value: '0', color: '#64748b', icon: Minus };
        if (diff > 0) return { value: `+${diff}`, color: '#ef4444', icon: TrendingUp };
        return { value: `${diff}`, color: '#22c55e', icon: TrendingDown };
    };

    const workerDelta = getDelta(plannedWorkers, actualWorkers);
    const daysDelta = getDelta(plannedDays, actualDays);
    const costDelta = getDelta(plannedCost, actualCost);

    // Format currency
    const formatKM = (amount: number) => `${amount.toFixed(0)} KM`;

    // Compact display
    if (compact) {
        return (
            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 12px',
                borderRadius: '8px',
                background: isOverBudget ? '#fef2f2' : isUnderBudget ? '#f0fdf4' : '#f8fafc',
                border: `1px solid ${isOverBudget ? '#fecaca' : isUnderBudget ? '#bbf7d0' : '#e2e8f0'}`,
                fontSize: '12px',
            }}>
                {isOverBudget ? (
                    <AlertTriangle size={14} style={{ color: '#ef4444' }} />
                ) : (
                    <CheckCircle size={14} style={{ color: '#22c55e' }} />
                )}
                <span style={{ color: '#64748b' }}>
                    Plan: {formatKM(plannedCost)}
                </span>
                <span style={{
                    fontWeight: 600,
                    color: isOverBudget ? '#ef4444' : '#22c55e'
                }}>
                    Stvarno: {formatKM(actualCost)}
                </span>
                <span style={{
                    color: isOverBudget ? '#ef4444' : '#22c55e',
                    fontWeight: 500,
                }}>
                    ({isOverBudget ? '' : '+'}{Math.round(variancePercent)}%)
                </span>
            </div>
        );
    }

    // Full display
    return (
        <div style={{
            padding: '16px',
            borderRadius: '12px',
            background: 'white',
            border: '1px solid #e2e8f0',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        }}>
            {/* Header */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginBottom: '16px',
                paddingBottom: '12px',
                borderBottom: '1px solid #f1f5f9',
            }}>
                <div style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '8px',
                    background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                }}>
                    <TrendingUp size={16} style={{ color: 'white' }} />
                </div>
                <div>
                    <div style={{ fontWeight: 600, color: '#0f172a', fontSize: '14px' }}>
                        Planirano vs Stvarno
                    </div>
                    <div style={{ fontSize: '11px', color: '#64748b' }}>
                        Usporedba troškova rada
                    </div>
                </div>
            </div>

            {/* Table */}
            <table style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: '13px',
            }}>
                <thead>
                    <tr style={{ color: '#64748b', fontSize: '11px', textTransform: 'uppercase' }}>
                        <th style={{ textAlign: 'left', padding: '8px 0', fontWeight: 600 }}></th>
                        <th style={{ textAlign: 'right', padding: '8px 0', fontWeight: 600 }}>Planirano</th>
                        <th style={{ textAlign: 'right', padding: '8px 0', fontWeight: 600 }}>Stvarno</th>
                        <th style={{ textAlign: 'right', padding: '8px 0', fontWeight: 600 }}>Δ</th>
                    </tr>
                </thead>
                <tbody>
                    {/* Workers Row */}
                    <tr style={{ borderTop: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '10px 0', color: '#374151' }}>Radnici</td>
                        <td style={{ textAlign: 'right', padding: '10px 0', color: '#64748b' }}>
                            {plannedWorkers}
                        </td>
                        <td style={{ textAlign: 'right', padding: '10px 0', fontWeight: 500 }}>
                            {actualWorkers}
                        </td>
                        <td style={{ textAlign: 'right', padding: '10px 0', color: workerDelta.color, fontWeight: 500 }}>
                            {workerDelta.value}
                        </td>
                    </tr>

                    {/* Days Row */}
                    <tr style={{ borderTop: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '10px 0', color: '#374151' }}>Radni dani</td>
                        <td style={{ textAlign: 'right', padding: '10px 0', color: '#64748b' }}>
                            {plannedDays}
                        </td>
                        <td style={{ textAlign: 'right', padding: '10px 0', fontWeight: 500 }}>
                            {actualDays}
                        </td>
                        <td style={{ textAlign: 'right', padding: '10px 0', color: daysDelta.color, fontWeight: 500 }}>
                            {daysDelta.value}
                        </td>
                    </tr>

                    {/* Rate Row */}
                    <tr style={{ borderTop: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '10px 0', color: '#374151' }}>Dnevnica (prosj.)</td>
                        <td style={{ textAlign: 'right', padding: '10px 0', color: '#64748b' }}>
                            {formatKM(plannedRate)}
                        </td>
                        <td style={{ textAlign: 'right', padding: '10px 0', fontWeight: 500 }}>
                            {formatKM(actualRate)}
                        </td>
                        <td style={{ textAlign: 'right', padding: '10px 0', color: '#64748b' }}>
                            -
                        </td>
                    </tr>

                    {/* Total Cost Row */}
                    <tr style={{
                        borderTop: '2px solid #e2e8f0',
                        background: isOverBudget ? '#fef2f2' : isUnderBudget ? '#f0fdf4' : '#f8fafc',
                    }}>
                        <td style={{ padding: '12px 0', fontWeight: 600, color: '#0f172a' }}>UKUPNO</td>
                        <td style={{ textAlign: 'right', padding: '12px 0', color: '#64748b', fontWeight: 500 }}>
                            {formatKM(plannedCost)}
                        </td>
                        <td style={{
                            textAlign: 'right',
                            padding: '12px 0',
                            fontWeight: 700,
                            fontSize: '15px',
                            color: isOverBudget ? '#ef4444' : '#22c55e',
                        }}>
                            {formatKM(actualCost)}
                        </td>
                        <td style={{
                            textAlign: 'right',
                            padding: '12px 0',
                            fontWeight: 600,
                            color: costDelta.color,
                        }}>
                            {costDelta.value} KM
                        </td>
                    </tr>
                </tbody>
            </table>

            {/* Budget Alert */}
            {(isOverBudget || isUnderBudget) && (
                <div style={{
                    marginTop: '12px',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    background: isOverBudget ? '#fef2f2' : '#f0fdf4',
                    border: `1px solid ${isOverBudget ? '#fecaca' : '#bbf7d0'}`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '12px',
                    color: isOverBudget ? '#991b1b' : '#166534',
                }}>
                    {isOverBudget ? (
                        <>
                            <AlertTriangle size={16} />
                            <span>
                                <strong>Prekoračenje budžeta:</strong> {Math.abs(Math.round(variancePercent))}% više od planiranog
                            </span>
                        </>
                    ) : (
                        <>
                            <CheckCircle size={16} />
                            <span>
                                <strong>Ušteda:</strong> {Math.abs(Math.round(variancePercent))}% manje od planiranog
                            </span>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
