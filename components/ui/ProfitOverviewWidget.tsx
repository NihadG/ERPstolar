'use client';

import { useMemo } from 'react';
import { DollarSign, Package, Truck, Wrench, Users, TrendingUp, TrendingDown } from 'lucide-react';

interface ProfitOverviewWidgetProps {
    title?: string;
    subtitle?: string;
    // Values
    totalValue: number;           // Prihod od ponude
    materialCost: number;         // Trošak materijala
    transportCost?: number;       // Trošak transporta
    servicesCost?: number;        // Trošak usluga
    laborCost: number;            // Stvarni trošak rada
    plannedLaborCost?: number;    // Planirani trošak rada
}

interface CostBar {
    label: string;
    value: number;
    color: string;
    icon: typeof DollarSign;
}

export default function ProfitOverviewWidget({
    title = 'Pregled Profita',
    subtitle,
    totalValue,
    materialCost,
    transportCost = 0,
    servicesCost = 0,
    laborCost,
    plannedLaborCost = 0,
}: ProfitOverviewWidgetProps) {
    // Calculate profit
    const totalCosts = materialCost + transportCost + servicesCost + laborCost;
    const profit = totalValue - totalCosts;
    const profitMargin = totalValue > 0 ? (profit / totalValue) * 100 : 0;

    // Labor variance
    const laborVariance = plannedLaborCost - laborCost;
    const isLaborOverBudget = laborCost > plannedLaborCost && plannedLaborCost > 0;

    // Cost breakdown for bars
    const costs: CostBar[] = useMemo(() => [
        { label: 'Materijal', value: materialCost, color: '#3b82f6', icon: Package },
        { label: 'Transport', value: transportCost, color: '#8b5cf6', icon: Truck },
        { label: 'Usluge', value: servicesCost, color: '#06b6d4', icon: Wrench },
        { label: 'Rad', value: laborCost, color: '#f59e0b', icon: Users },
    ].filter(c => c.value > 0), [materialCost, transportCost, servicesCost, laborCost]);

    // Calculate bar widths relative to total value
    const maxWidth = 100;

    // Format currency
    const formatKM = (amount: number) => {
        if (amount >= 1000) {
            return `${(amount / 1000).toFixed(1)}k KM`;
        }
        return `${amount.toFixed(0)} KM`;
    };

    return (
        <div style={{
            padding: '20px',
            borderRadius: '16px',
            background: 'white',
            border: '1px solid #e2e8f0',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        }}>
            {/* Header */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '20px',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{
                        width: '40px',
                        height: '40px',
                        borderRadius: '10px',
                        background: profit >= 0
                            ? 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)'
                            : 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}>
                        <DollarSign size={20} style={{ color: 'white' }} />
                    </div>
                    <div>
                        <div style={{ fontWeight: 600, color: '#0f172a', fontSize: '15px' }}>
                            {title}
                        </div>
                        {subtitle && (
                            <div style={{ fontSize: '12px', color: '#64748b' }}>
                                {subtitle}
                            </div>
                        )}
                    </div>
                </div>

                {/* Profit Badge */}
                <div style={{
                    padding: '8px 16px',
                    borderRadius: '10px',
                    background: profit >= 0 ? '#f0fdf4' : '#fef2f2',
                    border: `1px solid ${profit >= 0 ? '#bbf7d0' : '#fecaca'}`,
                }}>
                    <div style={{
                        fontSize: '18px',
                        fontWeight: 700,
                        color: profit >= 0 ? '#22c55e' : '#ef4444',
                    }}>
                        {formatKM(profit)}
                    </div>
                    <div style={{
                        fontSize: '11px',
                        color: profit >= 0 ? '#166534' : '#991b1b',
                    }}>
                        Profit ({profitMargin.toFixed(1)}%)
                    </div>
                </div>
            </div>

            {/* Revenue Bar */}
            <div style={{ marginBottom: '16px' }}>
                <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '6px',
                }}>
                    <span style={{ fontSize: '13px', color: '#374151', fontWeight: 500 }}>
                        Prihod (Ponuda)
                    </span>
                    <span style={{ fontSize: '14px', color: '#0f172a', fontWeight: 600 }}>
                        {formatKM(totalValue)}
                    </span>
                </div>
                <div style={{
                    height: '24px',
                    borderRadius: '6px',
                    background: 'linear-gradient(90deg, #22c55e 0%, #16a34a 100%)',
                    width: '100%',
                    position: 'relative',
                    overflow: 'hidden',
                }}>
                    {/* Segment markers for costs */}
                    {costs.reduce((acc, cost, index) => {
                        const prevWidth = costs.slice(0, index).reduce((sum, c) => sum + (c.value / totalValue) * 100, 0);
                        const width = (cost.value / totalValue) * 100;
                        if (width > 0) {
                            acc.push(
                                <div key={cost.label} style={{
                                    position: 'absolute',
                                    left: `${prevWidth}%`,
                                    width: `${width}%`,
                                    height: '100%',
                                    background: cost.color,
                                    borderRight: index < costs.length - 1 ? '1px solid rgba(255,255,255,0.3)' : 'none',
                                }} />
                            );
                        }
                        return acc;
                    }, [] as JSX.Element[])}

                    {/* Profit segment */}
                    {profit > 0 && (
                        <div style={{
                            position: 'absolute',
                            left: `${(totalCosts / totalValue) * 100}%`,
                            width: `${(profit / totalValue) * 100}%`,
                            height: '100%',
                            background: 'linear-gradient(90deg, #22c55e 0%, #16a34a 100%)',
                        }} />
                    )}
                </div>
            </div>

            {/* Cost Breakdown */}
            <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                marginBottom: '16px',
            }}>
                {costs.map(cost => {
                    const Icon = cost.icon;
                    const widthPercent = totalValue > 0 ? (cost.value / totalValue) * maxWidth : 0;

                    return (
                        <div key={cost.label}>
                            <div style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                marginBottom: '4px',
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <Icon size={14} style={{ color: cost.color }} />
                                    <span style={{ fontSize: '12px', color: '#64748b' }}>
                                        {cost.label}
                                    </span>
                                </div>
                                <span style={{ fontSize: '13px', color: '#374151', fontWeight: 500 }}>
                                    {formatKM(cost.value)}
                                </span>
                            </div>
                            <div style={{
                                height: '8px',
                                borderRadius: '4px',
                                background: '#f1f5f9',
                                overflow: 'hidden',
                            }}>
                                <div style={{
                                    height: '100%',
                                    width: `${widthPercent}%`,
                                    background: cost.color,
                                    borderRadius: '4px',
                                    transition: 'width 0.3s ease',
                                }} />
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Summary Row */}
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '12px 0',
                borderTop: '1px solid #e2e8f0',
                marginTop: '8px',
            }}>
                <div>
                    <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '2px' }}>
                        Ukupni troškovi
                    </div>
                    <div style={{ fontSize: '15px', color: '#0f172a', fontWeight: 600 }}>
                        {formatKM(totalCosts)}
                    </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '2px' }}>
                        Neto profit
                    </div>
                    <div style={{
                        fontSize: '15px',
                        fontWeight: 700,
                        color: profit >= 0 ? '#22c55e' : '#ef4444',
                    }}>
                        {formatKM(profit)}
                    </div>
                </div>
            </div>

            {/* Labor Budget Alert */}
            {isLaborOverBudget && (
                <div style={{
                    marginTop: '12px',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    background: '#fef2f2',
                    border: '1px solid #fecaca',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '12px',
                    color: '#991b1b',
                }}>
                    <TrendingUp size={14} />
                    <span>
                        Rad prekoračen za <strong>{formatKM(Math.abs(laborVariance))}</strong>
                        {' '}(planirano: {formatKM(plannedLaborCost)})
                    </span>
                </div>
            )}
        </div>
    );
}
