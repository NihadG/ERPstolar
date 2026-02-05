'use client';

import { useMemo } from 'react';
import Modal from './Modal';
import type { WorkLog } from '@/lib/types';

interface ProductTimelineModalProps {
    isOpen: boolean;
    onClose: () => void;
    productId: string;
    productName: string;
    workLogs: WorkLog[];
    // Profit data
    sellingPrice?: number;
    materialCost?: number;  // Base material cost
    laborCost?: number;
    profit?: number;
    profitMargin?: number;
    // Detailed cost breakdown (optional)
    costBreakdown?: {
        baseMaterial: number;
        led: number;
        grouting: number;
        sinkFaucet: number;
        extras: number;
        transportShare: number;
        discountShare: number;
    };
}

interface TimelineDay {
    date: string;
    displayDate: string;
    entries: {
        type: 'worker' | 'process_start' | 'process_end';
        workerName?: string;
        dailyRate?: number;
        hoursWorked?: number;
        processName?: string;
    }[];
    dailyLaborCost: number;
    cumulativeLaborCost: number;
}

export default function ProductTimelineModal({
    isOpen,
    onClose,
    productName,
    workLogs,
    sellingPrice,
    materialCost,
    laborCost,
    profit,
    profitMargin,
    costBreakdown
}: ProductTimelineModalProps) {

    // Group workLogs by date and calculate timeline
    const timeline = useMemo(() => {
        if (!workLogs || workLogs.length === 0) return [];

        // Sort by date
        const sorted = [...workLogs].sort((a, b) =>
            new Date(a.Date).getTime() - new Date(b.Date).getTime()
        );

        // Group by date
        const grouped = new Map<string, WorkLog[]>();
        sorted.forEach(wl => {
            const existing = grouped.get(wl.Date) || [];
            existing.push(wl);
            grouped.set(wl.Date, existing);
        });

        // Build timeline
        let cumulativeCost = 0;
        const days: TimelineDay[] = [];

        grouped.forEach((logs, date) => {
            const dailyLaborCost = logs.reduce((sum, wl) => sum + (wl.Daily_Rate || 0), 0);
            cumulativeCost += dailyLaborCost;

            const entries: TimelineDay['entries'] = [];

            // Add worker entries
            logs.forEach(wl => {
                entries.push({
                    type: 'worker',
                    workerName: wl.Worker_Name,
                    dailyRate: wl.Daily_Rate,
                    hoursWorked: wl.Hours_Worked || 8,
                    processName: wl.Process_Name
                });
            });

            days.push({
                date,
                displayDate: new Date(date).toLocaleDateString('hr-HR', {
                    weekday: 'short',
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric'
                }),
                entries,
                dailyLaborCost,
                cumulativeLaborCost: cumulativeCost
            });
        });

        return days;
    }, [workLogs]);

    // Calculate daily profit evolution
    const profitEvolution = useMemo(() => {
        if (!sellingPrice || !materialCost) return [];

        return timeline.map(day => {
            const dailyProfit = sellingPrice - materialCost - day.cumulativeLaborCost;
            const dailyMargin = (dailyProfit / sellingPrice) * 100;
            return {
                date: day.displayDate,
                profit: dailyProfit,
                margin: dailyMargin
            };
        });
    }, [timeline, sellingPrice, materialCost]);

    const getProfitColor = (margin: number) => {
        if (margin >= 30) return '#10b981';
        if (margin >= 15) return '#f59e0b';
        return '#ef4444';
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span className="material-icons-round" style={{ color: '#3b82f6' }}>inventory_2</span>
                    <span>{productName} - Timeline Izvještaj</span>
                </div>
            }
            size="large"
        >
            <div className="timeline-container">
                {/* Profit Summary Card */}
                {sellingPrice && (
                    <div className="profit-summary-card">
                        <div className="summary-row">
                            <div className="summary-item">
                                <span className="material-icons-round">sell</span>
                                <div>
                                    <span className="label">Prodajna cijena</span>
                                    <span className="value">{sellingPrice.toLocaleString('hr-HR')} KM</span>
                                </div>
                            </div>
                            <div className="summary-item">
                                <span className="material-icons-round">category</span>
                                <div>
                                    <span className="label">Trošak materijala</span>
                                    <span className="value">{(materialCost || 0).toLocaleString('hr-HR')} KM</span>
                                </div>
                            </div>
                            <div className="summary-item">
                                <span className="material-icons-round">engineering</span>
                                <div>
                                    <span className="label">Trošak rada</span>
                                    <span className="value">{(laborCost || 0).toLocaleString('hr-HR')} KM</span>
                                </div>
                            </div>
                            <div className="summary-item profit" style={{
                                background: getProfitColor(profitMargin || 0) + '15',
                                borderColor: getProfitColor(profitMargin || 0)
                            }}>
                                <span className="material-icons-round" style={{ color: getProfitColor(profitMargin || 0) }}>
                                    {(profitMargin || 0) >= 30 ? 'trending_up' : (profitMargin || 0) >= 15 ? 'trending_flat' : 'trending_down'}
                                </span>
                                <div>
                                    <span className="label">Profit</span>
                                    <span className="value" style={{ color: getProfitColor(profitMargin || 0) }}>
                                        {(profit || 0).toLocaleString('hr-HR')} KM ({(profitMargin || 0).toFixed(0)}%)
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Detailed Cost Breakdown */}
                {costBreakdown && (
                    <div className="cost-breakdown-section">
                        <h4 className="breakdown-title">
                            <span className="material-icons-round">analytics</span>
                            Detaljan Pregled Troškova
                        </h4>
                        <div className="breakdown-grid">
                            <div className="breakdown-item">
                                <span className="breakdown-label">Materijal (osnova)</span>
                                <span className="breakdown-value">{costBreakdown.baseMaterial.toLocaleString('hr-HR')} KM</span>
                            </div>
                            {costBreakdown.led > 0 && (
                                <div className="breakdown-item">
                                    <span className="breakdown-label">LED rasvjeta</span>
                                    <span className="breakdown-value">{costBreakdown.led.toLocaleString('hr-HR')} KM</span>
                                </div>
                            )}
                            {costBreakdown.grouting > 0 && (
                                <div className="breakdown-item">
                                    <span className="breakdown-label">Fugiranje</span>
                                    <span className="breakdown-value">{costBreakdown.grouting.toLocaleString('hr-HR')} KM</span>
                                </div>
                            )}
                            {costBreakdown.sinkFaucet > 0 && (
                                <div className="breakdown-item">
                                    <span className="breakdown-label">Sudoper/Slavina</span>
                                    <span className="breakdown-value">{costBreakdown.sinkFaucet.toLocaleString('hr-HR')} KM</span>
                                </div>
                            )}
                            {costBreakdown.extras > 0 && (
                                <div className="breakdown-item">
                                    <span className="breakdown-label">Dodaci</span>
                                    <span className="breakdown-value">{costBreakdown.extras.toLocaleString('hr-HR')} KM</span>
                                </div>
                            )}
                            {costBreakdown.transportShare > 0 && (
                                <div className="breakdown-item positive">
                                    <span className="breakdown-label">Transport (prihod)</span>
                                    <span className="breakdown-value">+{costBreakdown.transportShare.toLocaleString('hr-HR')} KM</span>
                                </div>
                            )}
                            {costBreakdown.discountShare > 0 && (
                                <div className="breakdown-item negative">
                                    <span className="breakdown-label">Popust (odbitka)</span>
                                    <span className="breakdown-value">-{costBreakdown.discountShare.toLocaleString('hr-HR')} KM</span>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Timeline */}
                <div className="timeline-section">
                    <h3 className="section-title">
                        <span className="material-icons-round">history</span>
                        Dnevni Log Proizvodnje
                    </h3>

                    {timeline.length === 0 ? (
                        <div className="empty-state">
                            <span className="material-icons-round">schedule</span>
                            <p>Nema zabilježenog rada na ovom proizvodu</p>
                        </div>
                    ) : (
                        <div className="timeline">
                            {timeline.map((day, idx) => (
                                <div key={day.date} className="timeline-day">
                                    <div className="day-header">
                                        <div className="day-date">
                                            <span className="material-icons-round">event</span>
                                            {day.displayDate}
                                        </div>
                                        <div className="day-stats">
                                            <span className="day-cost">
                                                <span className="material-icons-round">payments</span>
                                                {day.dailyLaborCost.toLocaleString('hr-HR')} KM
                                            </span>
                                            {profitEvolution[idx] && (
                                                <span
                                                    className="day-profit"
                                                    style={{ color: getProfitColor(profitEvolution[idx].margin) }}
                                                >
                                                    <span className="material-icons-round">
                                                        {profitEvolution[idx].margin >= 30 ? 'trending_up' :
                                                            profitEvolution[idx].margin >= 15 ? 'trending_flat' : 'trending_down'}
                                                    </span>
                                                    {profitEvolution[idx].profit.toLocaleString('hr-HR')} KM
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="day-entries">
                                        {day.entries.map((entry, entryIdx) => (
                                            <div key={entryIdx} className="entry">
                                                {entry.type === 'worker' && (
                                                    <>
                                                        <span className="entry-icon worker">
                                                            <span className="material-icons-round">person</span>
                                                        </span>
                                                        <div className="entry-content">
                                                            <span className="worker-name">{entry.workerName}</span>
                                                            {entry.processName && (
                                                                <span className="process-tag">{entry.processName}</span>
                                                            )}
                                                        </div>
                                                        <div className="entry-meta">
                                                            <span className="hours">{entry.hoursWorked}h</span>
                                                            <span className="cost">{entry.dailyRate?.toLocaleString('hr-HR')} KM</span>
                                                        </div>
                                                    </>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            <style jsx>{`
                .timeline-container {
                    display: flex;
                    flex-direction: column;
                    gap: 24px;
                }

                /* Profit Summary Card */
                .profit-summary-card {
                    background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
                    border-radius: 16px;
                    padding: 20px;
                    border: 1px solid #e2e8f0;
                }

                .summary-row {
                    display: grid;
                    grid-template-columns: repeat(4, 1fr);
                    gap: 16px;
                }

                @media (max-width: 768px) {
                    .summary-row {
                        grid-template-columns: repeat(2, 1fr);
                    }
                }

                .summary-item {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    padding: 12px;
                    background: white;
                    border-radius: 12px;
                    border: 1px solid #e5e7eb;
                }

                .summary-item.profit {
                    border-width: 2px;
                }

                .summary-item .material-icons-round {
                    font-size: 24px;
                    color: #6b7280;
                }

                .summary-item div {
                    display: flex;
                    flex-direction: column;
                    gap: 2px;
                }

                .summary-item .label {
                    font-size: 12px;
                    color: #6b7280;
                    font-weight: 500;
                }

                .summary-item .value {
                    font-size: 16px;
                    font-weight: 700;
                    color: #111827;
                }

                /* Cost Breakdown Section */
                .cost-breakdown-section {
                    background: #fff;
                    border-radius: 12px;
                    padding: 16px;
                    border: 1px solid #e5e7eb;
                }

                .breakdown-title {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-size: 14px;
                    font-weight: 600;
                    color: #374151;
                    margin: 0 0 12px 0;
                }

                .breakdown-title .material-icons-round {
                    font-size: 18px;
                    color: #6b7280;
                }

                .breakdown-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
                    gap: 8px;
                }

                .breakdown-item {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 8px 12px;
                    background: #f9fafb;
                    border-radius: 6px;
                }

                .breakdown-item.positive {
                    background: rgba(16, 185, 129, 0.1);
                }

                .breakdown-item.negative {
                    background: rgba(239, 68, 68, 0.1);
                }

                .breakdown-label {
                    font-size: 12px;
                    color: #6b7280;
                }

                .breakdown-value {
                    font-size: 13px;
                    font-weight: 600;
                    color: #374151;
                }

                .breakdown-item.positive .breakdown-value {
                    color: #10b981;
                }

                .breakdown-item.negative .breakdown-value {
                    color: #ef4444;
                }

                /* Timeline Section */
                .timeline-section {
                    display: flex;
                    flex-direction: column;
                    gap: 16px;
                }

                .section-title {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-size: 16px;
                    font-weight: 600;
                    color: #374151;
                    margin: 0;
                }

                .section-title .material-icons-round {
                    font-size: 20px;
                    color: #6b7280;
                }

                /* Empty State */
                .empty-state {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    padding: 48px;
                    background: #f9fafb;
                    border-radius: 12px;
                    color: #9ca3af;
                }

                .empty-state .material-icons-round {
                    font-size: 48px;
                    margin-bottom: 8px;
                }

                /* Timeline */
                .timeline {
                    display: flex;
                    flex-direction: column;
                    gap: 16px;
                }

                .timeline-day {
                    background: white;
                    border-radius: 12px;
                    border: 1px solid #e5e7eb;
                    overflow: hidden;
                }

                .day-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 14px 16px;
                    background: #f9fafb;
                    border-bottom: 1px solid #e5e7eb;
                }

                .day-date {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-weight: 600;
                    color: #374151;
                }

                .day-date .material-icons-round {
                    font-size: 18px;
                    color: #3b82f6;
                }

                .day-stats {
                    display: flex;
                    align-items: center;
                    gap: 16px;
                }

                .day-cost, .day-profit {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    font-size: 13px;
                    font-weight: 600;
                }

                .day-cost {
                    color: #6b7280;
                }

                .day-cost .material-icons-round,
                .day-profit .material-icons-round {
                    font-size: 16px;
                }

                /* Entries */
                .day-entries {
                    padding: 12px 16px;
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }

                .entry {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    padding: 10px 12px;
                    background: #f9fafb;
                    border-radius: 8px;
                }

                .entry-icon {
                    width: 32px;
                    height: 32px;
                    border-radius: 8px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    flex-shrink: 0;
                }

                .entry-icon.worker {
                    background: linear-gradient(135deg, #dbeafe, #bfdbfe);
                }

                .entry-icon .material-icons-round {
                    font-size: 18px;
                    color: #3b82f6;
                }

                .entry-content {
                    flex: 1;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }

                .worker-name {
                    font-weight: 600;
                    color: #111827;
                }

                .process-tag {
                    font-size: 11px;
                    padding: 3px 8px;
                    background: #e0e7ff;
                    color: #4338ca;
                    border-radius: 4px;
                    font-weight: 500;
                }

                .entry-meta {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    font-size: 13px;
                }

                .hours {
                    color: #6b7280;
                }

                .cost {
                    font-weight: 600;
                    color: #374151;
                }
            `}</style>
        </Modal>
    );
}
