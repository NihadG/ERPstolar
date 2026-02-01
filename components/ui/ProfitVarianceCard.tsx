'use client';

import { useMemo } from 'react';
import { TrendingUp, TrendingDown, Minus, AlertTriangle, DollarSign, Package, Users } from 'lucide-react';
import type { WorkOrder } from '@/lib/types';

interface ProfitVarianceCardProps {
    workOrder: WorkOrder;
    compact?: boolean;
}

interface VarianceData {
    totalValue: number;
    materialCost: number;
    laborCost: number;
    profit: number;
    profitMargin: number;
    status: 'profitable' | 'break-even' | 'loss';
    variance: number;
}

export default function ProfitVarianceCard({ workOrder, compact = false }: ProfitVarianceCardProps) {
    const data: VarianceData = useMemo(() => {
        const totalValue = workOrder.Total_Value || 0;
        const materialCost = workOrder.Material_Cost || 0;
        const laborCost = workOrder.Labor_Cost || 0;
        const profit = totalValue - materialCost - laborCost;
        const profitMargin = totalValue > 0 ? (profit / totalValue) * 100 : 0;

        // Variance from expected (assume 30% margin is target)
        const targetProfit = totalValue * 0.30;
        const variance = profit - targetProfit;

        let status: 'profitable' | 'break-even' | 'loss';
        if (profitMargin >= 15) status = 'profitable';
        else if (profitMargin >= 0) status = 'break-even';
        else status = 'loss';

        return { totalValue, materialCost, laborCost, profit, profitMargin, status, variance };
    }, [workOrder]);

    const formatCurrency = (value: number) =>
        `${value.toLocaleString('hr-HR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} KM`;

    const getStatusConfig = () => {
        switch (data.status) {
            case 'profitable':
                return {
                    icon: TrendingUp,
                    color: '#22c55e',
                    bg: 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)',
                    border: '#86efac'
                };
            case 'break-even':
                return {
                    icon: Minus,
                    color: '#f59e0b',
                    bg: 'linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)',
                    border: '#fcd34d'
                };
            case 'loss':
                return {
                    icon: TrendingDown,
                    color: '#ef4444',
                    bg: 'linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%)',
                    border: '#fca5a5'
                };
        }
    };

    const config = getStatusConfig();
    const StatusIcon = config.icon;

    // Don't show if no value set
    if (!data.totalValue) {
        return null;
    }

    // Compact view for card headers
    if (compact) {
        return (
            <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 12px',
                borderRadius: '8px',
                background: config.bg,
                border: `1px solid ${config.border}`
            }}>
                <StatusIcon size={16} style={{ color: config.color }} />
                <span style={{
                    fontWeight: 700,
                    color: config.color,
                    fontSize: '13px'
                }}>
                    {formatCurrency(data.profit)}
                </span>
                <span style={{
                    fontSize: '11px',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    background: config.color + '20',
                    color: config.color,
                    fontWeight: 600
                }}>
                    {data.profitMargin.toFixed(0)}%
                </span>
            </div>
        );
    }

    // Full variance card
    return (
        <div style={{
            background: config.bg,
            borderRadius: '16px',
            border: `1px solid ${config.border}`,
            padding: '20px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.04)'
        }}>
            {/* Header */}
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                marginBottom: '16px'
            }}>
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px'
                }}>
                    <div style={{
                        width: '40px',
                        height: '40px',
                        borderRadius: '12px',
                        background: 'white',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.06)'
                    }}>
                        <StatusIcon size={22} style={{ color: config.color }} />
                    </div>
                    <div>
                        <div style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>
                            Analiza profita
                        </div>
                        <div style={{ fontSize: '12px', color: '#64748b' }}>
                            {workOrder.Work_Order_Number}
                        </div>
                    </div>
                </div>

                {/* Profit Display */}
                <div style={{ textAlign: 'right' }}>
                    <div style={{
                        fontSize: '24px',
                        fontWeight: 800,
                        color: config.color,
                        lineHeight: 1.2
                    }}>
                        {formatCurrency(data.profit)}
                    </div>
                    <div style={{
                        fontSize: '13px',
                        fontWeight: 600,
                        color: config.color,
                        opacity: 0.8
                    }}>
                        Marža: {data.profitMargin.toFixed(1)}%
                    </div>
                </div>
            </div>

            {/* Breakdown */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '12px',
                marginBottom: '16px'
            }}>
                <div style={{
                    background: 'white',
                    padding: '12px',
                    borderRadius: '10px',
                    textAlign: 'center'
                }}>
                    <DollarSign size={16} style={{ color: '#22c55e', marginBottom: '4px' }} />
                    <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>Vrijednost</div>
                    <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '14px' }}>
                        {formatCurrency(data.totalValue)}
                    </div>
                </div>
                <div style={{
                    background: 'white',
                    padding: '12px',
                    borderRadius: '10px',
                    textAlign: 'center'
                }}>
                    <Package size={16} style={{ color: '#6366f1', marginBottom: '4px' }} />
                    <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>Materijal</div>
                    <div style={{ fontWeight: 700, color: '#6366f1', fontSize: '14px' }}>
                        {formatCurrency(data.materialCost)}
                    </div>
                </div>
                <div style={{
                    background: 'white',
                    padding: '12px',
                    borderRadius: '10px',
                    textAlign: 'center'
                }}>
                    <Users size={16} style={{ color: '#8b5cf6', marginBottom: '4px' }} />
                    <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>Rad</div>
                    <div style={{ fontWeight: 700, color: '#8b5cf6', fontSize: '14px' }}>
                        {formatCurrency(data.laborCost)}
                    </div>
                </div>
            </div>

            {/* Progress Bar */}
            <div style={{ marginBottom: '12px' }}>
                <div style={{
                    height: '12px',
                    borderRadius: '6px',
                    background: '#e2e8f0',
                    overflow: 'hidden',
                    display: 'flex'
                }}>
                    {/* Material segment */}
                    <div style={{
                        width: `${(data.materialCost / data.totalValue) * 100}%`,
                        background: '#6366f1',
                        transition: 'width 0.5s'
                    }} />
                    {/* Labor segment */}
                    <div style={{
                        width: `${(data.laborCost / data.totalValue) * 100}%`,
                        background: '#8b5cf6',
                        transition: 'width 0.5s'
                    }} />
                    {/* Profit segment */}
                    <div style={{
                        width: `${Math.max(0, (data.profit / data.totalValue) * 100)}%`,
                        background: config.color,
                        transition: 'width 0.5s'
                    }} />
                </div>
            </div>

            {/* Variance from target */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 12px',
                background: 'white',
                borderRadius: '8px',
                fontSize: '13px'
            }}>
                <span style={{ color: '#64748b' }}>
                    Razlika od ciljanih 30%:
                </span>
                <span style={{
                    fontWeight: 700,
                    color: data.variance >= 0 ? '#22c55e' : '#ef4444',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                }}>
                    {data.variance >= 0 ? (
                        <TrendingUp size={14} />
                    ) : (
                        <TrendingDown size={14} />
                    )}
                    {data.variance >= 0 ? '+' : ''}{formatCurrency(data.variance)}
                </span>
            </div>

            {/* Warning for low margin */}
            {data.profitMargin < 15 && (
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '10px',
                    marginTop: '12px',
                    background: '#fff7ed',
                    borderRadius: '8px',
                    color: '#c2410c',
                    fontSize: '12px'
                }}>
                    <AlertTriangle size={16} />
                    <span>
                        {data.profitMargin < 0
                            ? 'Ovaj nalog ostvaruje gubitak - hitno pregledajte troškove'
                            : 'Marža ispod ciljanih 15% - razmotrite optimizaciju'
                        }
                    </span>
                </div>
            )}
        </div>
    );
}
