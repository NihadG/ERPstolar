'use client';

import { useState, useEffect } from 'react';
import { UserCheck, UserX, Briefcase, Calendar, AlertCircle, Clock, Users } from 'lucide-react';
import type { Worker, WorkerAttendance } from '@/lib/types';
import { getWorkerAttendance, getWorkerMonthlyAttendance, canWorkerStartProcess } from '@/lib/attendance';

interface WorkerAttendanceInsightProps {
    workerId: string;
    workerName: string;
    compact?: boolean;          // For inline display on process cards
    showMonthly?: boolean;      // Show monthly breakdown
    onAttendanceClick?: () => void;
}

interface AttendanceStats {
    present: number;
    absent: number;
    sick: number;
    vacation: number;
    field: number;
    weekend: number;
    total: number;
}

export default function WorkerAttendanceInsight({
    workerId,
    workerName,
    compact = false,
    showMonthly = false,
    onAttendanceClick
}: WorkerAttendanceInsightProps) {
    const [todayStatus, setTodayStatus] = useState<string | null>(null);
    const [canStart, setCanStart] = useState<{ allowed: boolean; reason?: string }>({ allowed: true });
    const [monthlyStats, setMonthlyStats] = useState<AttendanceStats | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadAttendanceData();
    }, [workerId]);

    async function loadAttendanceData() {
        setLoading(true);
        try {
            // Get today's status
            const today = new Date().toISOString().split('T')[0];
            const todayAttendance = await getWorkerAttendance(workerId, today);
            setTodayStatus(todayAttendance?.Status || null);

            // Check if can start work
            const startCheck = await canWorkerStartProcess(workerId);
            setCanStart(startCheck);

            // Get monthly stats if needed
            if (showMonthly) {
                const now = new Date();
                const monthData = await getWorkerMonthlyAttendance(
                    workerId,
                    now.getFullYear(),
                    now.getMonth() + 1
                );

                const stats: AttendanceStats = {
                    present: 0,
                    absent: 0,
                    sick: 0,
                    vacation: 0,
                    field: 0,
                    weekend: 0,
                    total: monthData.length
                };

                monthData.forEach(entry => {
                    switch (entry.Status) {
                        case 'Prisutan': stats.present++; break;
                        case 'Odsutan': stats.absent++; break;
                        case 'Bolovanje': stats.sick++; break;
                        case 'Odmor': stats.vacation++; break;
                        case 'Teren': stats.field++; break;
                        case 'Vikend': stats.weekend++; break;
                    }
                });

                setMonthlyStats(stats);
            }
        } catch (error) {
            console.error('Error loading attendance data:', error);
        }
        setLoading(false);
    }

    // Status display config
    const getStatusConfig = (status: string | null) => {
        switch (status) {
            case 'Prisutan':
                return { icon: UserCheck, color: '#22c55e', bg: '#dcfce7', label: 'Prisutan' };
            case 'Teren':
                return { icon: Briefcase, color: '#3b82f6', bg: '#dbeafe', label: 'Teren' };
            case 'Odsutan':
                return { icon: UserX, color: '#ef4444', bg: '#fee2e2', label: 'Odsutan' };
            case 'Bolovanje':
                return { icon: AlertCircle, color: '#f59e0b', bg: '#fef3c7', label: 'Bolovanje' };
            case 'Odmor':
                return { icon: Calendar, color: '#8b5cf6', bg: '#ede9fe', label: 'Odmor' };
            case 'Vikend':
                return { icon: Calendar, color: '#64748b', bg: '#f1f5f9', label: 'Vikend' };
            default:
                return { icon: Clock, color: '#94a3b8', bg: '#f8fafc', label: 'Nepoznato' };
        }
    };

    const config = getStatusConfig(todayStatus);
    const StatusIcon = config.icon;

    if (loading) {
        return (
            <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: compact ? '2px 8px' : '8px 12px',
                borderRadius: '8px',
                background: '#f8fafc',
                fontSize: '12px',
                color: '#64748b'
            }}>
                <div
                    style={{
                        width: '12px',
                        height: '12px',
                        border: '2px solid #e2e8f0',
                        borderTopColor: '#3b82f6',
                        borderRadius: '50%',
                        animation: 'spin 1s linear infinite'
                    }}
                />
                Učitavanje...
            </div>
        );
    }

    // Compact display for process cards
    if (compact) {
        return (
            <div
                onClick={onAttendanceClick}
                style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '4px 10px',
                    borderRadius: '8px',
                    background: config.bg,
                    border: !canStart.allowed ? '1px solid #fca5a5' : `1px solid ${config.color}20`,
                    cursor: onAttendanceClick ? 'pointer' : 'default',
                    transition: 'all 0.2s'
                }}
            >
                <StatusIcon size={14} style={{ color: config.color }} />
                <span style={{
                    fontSize: '12px',
                    fontWeight: 500,
                    color: config.color
                }}>
                    {config.label}
                </span>
                {!canStart.allowed && (
                    <span style={{
                        fontSize: '10px',
                        color: '#ef4444',
                        marginLeft: '4px'
                    }}>
                        ⚠️
                    </span>
                )}
            </div>
        );
    }

    // Full display with monthly breakdown
    return (
        <div style={{
            padding: '16px',
            borderRadius: '12px',
            background: 'white',
            border: '1px solid #e2e8f0',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
        }}>
            {/* Header with worker name */}
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '16px'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{
                        width: '36px',
                        height: '36px',
                        borderRadius: '50%',
                        background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'white',
                        fontWeight: 600,
                        fontSize: '14px'
                    }}>
                        {workerName.split(' ').map(w => w[0]).slice(0, 2).join('')}
                    </div>
                    <div>
                        <div style={{ fontWeight: 600, color: '#0f172a' }}>{workerName}</div>
                        <div style={{ fontSize: '12px', color: '#64748b' }}>Status danas</div>
                    </div>
                </div>

                {/* Today's status badge */}
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px 14px',
                    borderRadius: '10px',
                    background: config.bg,
                    border: `1px solid ${config.color}30`
                }}>
                    <StatusIcon size={18} style={{ color: config.color }} />
                    <span style={{
                        fontWeight: 600,
                        color: config.color
                    }}>
                        {config.label}
                    </span>
                </div>
            </div>

            {/* Warning if worker can't start */}
            {!canStart.allowed && (
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '10px 14px',
                    background: '#fee2e2',
                    borderRadius: '8px',
                    marginBottom: '16px',
                    color: '#991b1b',
                    fontSize: '13px'
                }}>
                    <AlertCircle size={16} />
                    {canStart.reason || 'Radnik ne može započeti procese danas'}
                </div>
            )}

            {/* Monthly stats breakdown */}
            {showMonthly && monthlyStats && (
                <div style={{ marginTop: '12px' }}>
                    <div style={{
                        fontSize: '12px',
                        fontWeight: 600,
                        color: '#64748b',
                        marginBottom: '12px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                    }}>
                        <Calendar size={14} />
                        Ovaj mjesec
                    </div>

                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(3, 1fr)',
                        gap: '8px'
                    }}>
                        <StatBox
                            label="Prisutan"
                            value={monthlyStats.present + monthlyStats.field}
                            color="#22c55e"
                            bg="#dcfce7"
                        />
                        <StatBox
                            label="Odsutan"
                            value={monthlyStats.absent}
                            color="#ef4444"
                            bg="#fee2e2"
                        />
                        <StatBox
                            label="Bolovanje"
                            value={monthlyStats.sick}
                            color="#f59e0b"
                            bg="#fef3c7"
                        />
                    </div>

                    {/* Work rate */}
                    <div style={{
                        marginTop: '12px',
                        padding: '10px',
                        background: '#f8fafc',
                        borderRadius: '8px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                    }}>
                        <span style={{ fontSize: '12px', color: '#64748b' }}>Stopa prisutnosti</span>
                        <span style={{
                            fontWeight: 700,
                            fontSize: '16px',
                            color: monthlyStats.total > 0
                                ? ((monthlyStats.present + monthlyStats.field) / (monthlyStats.total - monthlyStats.weekend)) >= 0.9
                                    ? '#22c55e'
                                    : ((monthlyStats.present + monthlyStats.field) / (monthlyStats.total - monthlyStats.weekend)) >= 0.7
                                        ? '#f59e0b'
                                        : '#ef4444'
                                : '#64748b'
                        }}>
                            {monthlyStats.total - monthlyStats.weekend > 0
                                ? Math.round(((monthlyStats.present + monthlyStats.field) / (monthlyStats.total - monthlyStats.weekend)) * 100)
                                : 0}%
                        </span>
                    </div>
                </div>
            )}

            <style jsx global>{`
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    );
}

function StatBox({ label, value, color, bg }: { label: string; value: number; color: string; bg: string }) {
    return (
        <div style={{
            padding: '10px',
            background: bg,
            borderRadius: '8px',
            textAlign: 'center'
        }}>
            <div style={{ fontSize: '18px', fontWeight: 700, color }}>{value}</div>
            <div style={{ fontSize: '11px', color, opacity: 0.8 }}>{label}</div>
        </div>
    );
}
