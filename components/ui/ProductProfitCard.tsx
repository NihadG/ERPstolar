'use client';

import { DollarSign, TrendingUp, TrendingDown, Box, Users, Wrench } from 'lucide-react';

interface ProductProfitCardProps {
    productName: string;
    quantity?: number;
    sellingPrice: number;
    materialCost: number;
    laborCost: number;
    plannedLaborCost?: number;
    transportShare?: number;
    servicesTotal?: number;
    workerCount?: number;
    daysWorked?: number;
    compact?: boolean;
}

export default function ProductProfitCard({
    productName,
    quantity = 1,
    sellingPrice,
    materialCost,
    laborCost,
    plannedLaborCost = 0,
    transportShare = 0,
    servicesTotal = 0,
    workerCount = 0,
    daysWorked = 0,
    compact = false,
}: ProductProfitCardProps) {
    // Calculate totals
    const totalCosts = materialCost + laborCost + transportShare + servicesTotal;
    const profit = sellingPrice - totalCosts;
    const profitMargin = sellingPrice > 0 ? (profit / sellingPrice) * 100 : 0;

    // Labor variance
    const laborVariance = plannedLaborCost - laborCost;
    const isLaborOver = laborCost > plannedLaborCost && plannedLaborCost > 0;
    const isLaborUnder = laborCost < plannedLaborCost;

    // Format currency
    const formatKM = (amount: number) => `${amount.toFixed(0)} KM`;

    // Profit color
    const profitColor = profit >= 0 ? '#22c55e' : '#ef4444';

    if (compact) {
        return (
            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '8px 12px',
                borderRadius: '8px',
                background: 'white',
                border: '1px solid #e2e8f0',
                fontSize: '12px',
            }}>
                <span style={{ color: '#64748b' }}>{productName}</span>
                <span style={{ color: '#374151' }}>Cijena: {formatKM(sellingPrice)}</span>
                <span style={{
                    color: profitColor,
                    fontWeight: 600
                }}>
                    Profit: {formatKM(profit)} ({profitMargin.toFixed(0)}%)
                </span>
                {isLaborOver && (
                    <span style={{ color: '#ef4444', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <TrendingUp size={12} />
                        Rad +{formatKM(Math.abs(laborVariance))}
                    </span>
                )}
            </div>
        );
    }

    return (
        <div style={{
            padding: '16px',
            borderRadius: '12px',
            background: 'white',
            border: '1px solid #e2e8f0',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        }}>
            {/* Product Header */}
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                marginBottom: '12px',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{
                        width: '36px',
                        height: '36px',
                        borderRadius: '8px',
                        background: '#f1f5f9',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}>
                        <Box size={18} style={{ color: '#64748b' }} />
                    </div>
                    <div>
                        <div style={{ fontWeight: 600, color: '#0f172a', fontSize: '14px' }}>
                            {productName}
                        </div>
                        <div style={{ fontSize: '12px', color: '#64748b' }}>
                            Količina: {quantity}
                        </div>
                    </div>
                </div>

                {/* Profit Badge */}
                <div style={{
                    padding: '6px 12px',
                    borderRadius: '8px',
                    background: profit >= 0 ? '#f0fdf4' : '#fef2f2',
                    border: `1px solid ${profit >= 0 ? '#bbf7d0' : '#fecaca'}`,
                    textAlign: 'right',
                }}>
                    <div style={{
                        fontSize: '15px',
                        fontWeight: 700,
                        color: profitColor,
                    }}>
                        {formatKM(profit)}
                    </div>
                    <div style={{ fontSize: '10px', color: profitColor }}>
                        Profit ({profitMargin.toFixed(0)}%)
                    </div>
                </div>
            </div>

            {/* Cost Breakdown */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: '8px',
                marginBottom: '12px',
            }}>
                {/* Selling Price */}
                <div style={{
                    padding: '10px',
                    borderRadius: '8px',
                    background: '#f0fdf4',
                }}>
                    <div style={{ fontSize: '11px', color: '#166534', marginBottom: '2px' }}>
                        Cijena
                    </div>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: '#22c55e' }}>
                        {formatKM(sellingPrice)}
                    </div>
                </div>

                {/* Material Cost */}
                <div style={{
                    padding: '10px',
                    borderRadius: '8px',
                    background: '#f8fafc',
                }}>
                    <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '2px' }}>
                        Materijal
                    </div>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: '#374151' }}>
                        {formatKM(materialCost)}
                    </div>
                </div>

                {/* Labor Cost */}
                <div style={{
                    padding: '10px',
                    borderRadius: '8px',
                    background: isLaborOver ? '#fef2f2' : '#f8fafc',
                }}>
                    <div style={{
                        fontSize: '11px',
                        color: isLaborOver ? '#991b1b' : '#64748b',
                        marginBottom: '2px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                    }}>
                        <Users size={10} />
                        Rad ({daysWorked} dana, {workerCount} radnika)
                    </div>
                    <div style={{
                        fontSize: '14px',
                        fontWeight: 600,
                        color: isLaborOver ? '#ef4444' : '#374151',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                    }}>
                        {formatKM(laborCost)}
                        {plannedLaborCost > 0 && (
                            <span style={{
                                fontSize: '11px',
                                fontWeight: 400,
                                color: isLaborOver ? '#ef4444' : isLaborUnder ? '#22c55e' : '#64748b',
                            }}>
                                (plan: {formatKM(plannedLaborCost)})
                            </span>
                        )}
                    </div>
                </div>

                {/* Transport + Services */}
                {(transportShare > 0 || servicesTotal > 0) && (
                    <div style={{
                        padding: '10px',
                        borderRadius: '8px',
                        background: '#f8fafc',
                    }}>
                        <div style={{
                            fontSize: '11px',
                            color: '#64748b',
                            marginBottom: '2px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                        }}>
                            <Wrench size={10} />
                            Transport + Usluge
                        </div>
                        <div style={{ fontSize: '14px', fontWeight: 600, color: '#374151' }}>
                            {formatKM(transportShare + servicesTotal)}
                        </div>
                    </div>
                )}
            </div>

            {/* Labor Variance Alert */}
            {isLaborOver && (
                <div style={{
                    padding: '8px 12px',
                    borderRadius: '6px',
                    background: '#fef2f2',
                    border: '1px solid #fecaca',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '11px',
                    color: '#991b1b',
                }}>
                    <TrendingUp size={12} />
                    Prekoračenje budžeta za rad: +{formatKM(Math.abs(laborVariance))}
                </div>
            )}

            {isLaborUnder && laborCost > 0 && (
                <div style={{
                    padding: '8px 12px',
                    borderRadius: '6px',
                    background: '#f0fdf4',
                    border: '1px solid #bbf7d0',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '11px',
                    color: '#166534',
                }}>
                    <TrendingDown size={12} />
                    Ušteda na radu: {formatKM(laborVariance)}
                </div>
            )}
        </div>
    );
}
