'use client';

import { useMemo } from 'react';
import { Users, TrendingUp, Calendar, DollarSign } from 'lucide-react';

interface WorkerEarning {
    Worker_ID: string;
    Worker_Name: string;
    Days: number;
    Avg_Daily_Rate: number;
    Total_Earnings: number;
}

interface WorkerEarningsWidgetProps {
    title?: string;
    subtitle?: string;
    workers: WorkerEarning[];
    totalDays?: number;
    totalEarnings?: number;
    showAvgRate?: boolean;
    maxWorkers?: number;
}

export default function WorkerEarningsWidget({
    title = 'Zarada Radnika',
    subtitle,
    workers,
    totalDays,
    totalEarnings,
    showAvgRate = true,
    maxWorkers = 10,
}: WorkerEarningsWidgetProps) {
    // Sort and limit workers
    const displayWorkers = useMemo(() => {
        return workers
            .sort((a, b) => b.Total_Earnings - a.Total_Earnings)
            .slice(0, maxWorkers);
    }, [workers, maxWorkers]);

    // Calculate totals if not provided
    const calcTotalDays = totalDays ?? workers.reduce((sum, w) => sum + w.Days, 0);
    const calcTotalEarnings = totalEarnings ?? workers.reduce((sum, w) => sum + w.Total_Earnings, 0);

    // Find max earnings for visual scaling
    const maxEarnings = Math.max(...workers.map(w => w.Total_Earnings), 1);

    // Format currency
    const formatKM = (amount: number) => `${amount.toFixed(0)} KM`;

    // Get initials
    const getInitials = (name: string) => {
        return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
    };

    // Get color for worker based on position
    const getWorkerColor = (index: number) => {
        const colors = [
            '#6366f1', '#8b5cf6', '#a855f7', '#d946ef',
            '#ec4899', '#f43f5e', '#ef4444', '#f97316',
            '#f59e0b', '#84cc16',
        ];
        return colors[index % colors.length];
    };

    if (workers.length === 0) {
        return (
            <div style={{
                padding: '20px',
                borderRadius: '16px',
                background: 'white',
                border: '1px solid #e2e8f0',
                textAlign: 'center',
                color: '#64748b',
            }}>
                <Users size={32} style={{ marginBottom: '8px', opacity: 0.5 }} />
                <div>Nema podataka o zaradama</div>
            </div>
        );
    }

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
                marginBottom: '16px',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{
                        width: '40px',
                        height: '40px',
                        borderRadius: '10px',
                        background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}>
                        <Users size={20} style={{ color: 'white' }} />
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
            </div>

            {/* Table Header */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: showAvgRate ? '1fr 60px 80px 100px' : '1fr 60px 100px',
                gap: '8px',
                padding: '8px 0',
                borderBottom: '1px solid #e2e8f0',
                fontSize: '11px',
                fontWeight: 600,
                color: '#64748b',
                textTransform: 'uppercase',
            }}>
                <div>Radnik</div>
                <div style={{ textAlign: 'center' }}>Dani</div>
                {showAvgRate && <div style={{ textAlign: 'right' }}>Dnevnica</div>}
                <div style={{ textAlign: 'right' }}>Ukupno</div>
            </div>

            {/* Worker Rows */}
            <div style={{ display: 'flex', flexDirection: 'column' }}>
                {displayWorkers.map((worker, index) => {
                    const barWidth = (worker.Total_Earnings / maxEarnings) * 100;
                    const color = getWorkerColor(index);

                    return (
                        <div key={worker.Worker_ID} style={{
                            display: 'grid',
                            gridTemplateColumns: showAvgRate ? '1fr 60px 80px 100px' : '1fr 60px 100px',
                            gap: '8px',
                            padding: '12px 0',
                            borderBottom: '1px solid #f1f5f9',
                            alignItems: 'center',
                        }}>
                            {/* Worker Info */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <div style={{
                                    width: '32px',
                                    height: '32px',
                                    borderRadius: '50%',
                                    background: color,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: 'white',
                                    fontSize: '11px',
                                    fontWeight: 600,
                                    flexShrink: 0,
                                }}>
                                    {getInitials(worker.Worker_Name)}
                                </div>
                                <div style={{ overflow: 'hidden' }}>
                                    <div style={{
                                        fontSize: '13px',
                                        fontWeight: 500,
                                        color: '#0f172a',
                                        whiteSpace: 'nowrap',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                    }}>
                                        {worker.Worker_Name}
                                    </div>
                                    {/* Progress bar */}
                                    <div style={{
                                        height: '3px',
                                        width: '80px',
                                        background: '#f1f5f9',
                                        borderRadius: '2px',
                                        marginTop: '4px',
                                        overflow: 'hidden',
                                    }}>
                                        <div style={{
                                            height: '100%',
                                            width: `${barWidth}%`,
                                            background: color,
                                            borderRadius: '2px',
                                        }} />
                                    </div>
                                </div>
                            </div>

                            {/* Days */}
                            <div style={{
                                textAlign: 'center',
                                fontSize: '13px',
                                color: '#374151',
                                fontWeight: 500,
                            }}>
                                {worker.Days}
                            </div>

                            {/* Avg Rate */}
                            {showAvgRate && (
                                <div style={{
                                    textAlign: 'right',
                                    fontSize: '12px',
                                    color: '#64748b',
                                }}>
                                    {formatKM(worker.Avg_Daily_Rate)}
                                </div>
                            )}

                            {/* Total */}
                            <div style={{
                                textAlign: 'right',
                                fontSize: '14px',
                                fontWeight: 600,
                                color: '#0f172a',
                            }}>
                                {formatKM(worker.Total_Earnings)}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Show more indicator */}
            {workers.length > maxWorkers && (
                <div style={{
                    padding: '8px 0',
                    textAlign: 'center',
                    fontSize: '12px',
                    color: '#64748b',
                }}>
                    + {workers.length - maxWorkers} više radnika
                </div>
            )}

            {/* Summary Footer */}
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '14px 0 0',
                marginTop: '8px',
                borderTop: '2px solid #e2e8f0',
            }}>
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                }}>
                    <Calendar size={14} style={{ color: '#64748b' }} />
                    <span style={{ fontSize: '13px', color: '#64748b' }}>
                        {calcTotalDays} radnih dana
                    </span>
                </div>
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                }}>
                    <DollarSign size={14} style={{ color: '#22c55e' }} />
                    <span style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>
                        {formatKM(calcTotalEarnings)}
                    </span>
                </div>
            </div>
        </div>
    );
}
