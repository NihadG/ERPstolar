'use client';

import { useState, useEffect, useCallback } from 'react';
import { checkMissingAttendanceForActiveOrders, markAttendanceAndRecalculate, recalculateWorkOrder } from '@/lib/attendance';
import type { WorkOrder } from '@/lib/types';

interface AttendanceWarning {
    Worker_ID: string;
    Worker_Name: string;
    Work_Order_ID: string;
    Work_Order_Name: string;
    Item_Name: string;
    Date: string;
}

interface AttendanceFixModalProps {
    workOrder: WorkOrder;
    organizationId: string;
    /** Pre-loaded warnings from badge data (same source as card badge) */
    warnings?: AttendanceWarning[];
    onClose: () => void;
    onSaved: () => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

type AttendanceStatus = 'Prisutan' | 'Teren' | 'Odsutan' | 'Bolovanje' | 'Odmor' | '';

interface MissingEntry {
    date: string;
    workerName: string;
    workerId: string;
    status: AttendanceStatus;
}

const STATUS_OPTIONS: { value: AttendanceStatus; label: string; icon: string; color: string }[] = [
    { value: '', label: '—', icon: 'remove', color: 'rgba(255,255,255,0.3)' },
    { value: 'Prisutan', label: 'Prisutan', icon: 'check_circle', color: '#34C759' },
    { value: 'Teren', label: 'Teren', icon: 'directions_car', color: '#007AFF' },
    { value: 'Odsutan', label: 'Odsutan', icon: 'cancel', color: '#FF3B30' },
    { value: 'Bolovanje', label: 'Bolovanje', icon: 'local_hospital', color: '#FF9500' },
    { value: 'Odmor', label: 'Odmor', icon: 'beach_access', color: '#AF52DE' },
];

export default function AttendanceFixModal({ workOrder, organizationId, warnings: preloadedWarnings, onClose, onSaved, showToast }: AttendanceFixModalProps) {
    const [loading, setLoading] = useState(true);
    const [entries, setEntries] = useState<MissingEntry[]>([]);
    const [saving, setSaving] = useState(false);
    const [progress, setProgress] = useState(0);

    // Load missing attendance data — uses SAME source as the badge
    useEffect(() => {
        (async () => {
            try {
                let missingEntries: MissingEntry[] = [];

                if (preloadedWarnings && preloadedWarnings.length > 0) {
                    // Use pre-loaded badge data (already filtered to this WO)
                    const woWarnings = preloadedWarnings.filter(w => w.Work_Order_ID === workOrder.Work_Order_ID);
                    missingEntries = woWarnings.map(w => ({
                        date: w.Date,
                        workerName: w.Worker_Name,
                        workerId: w.Worker_ID,
                        status: '' as AttendanceStatus,
                    }));
                } else {
                    // Fallback: fetch fresh from same function as badge
                    const result = await checkMissingAttendanceForActiveOrders(organizationId);
                    const woWarnings = result.warnings.filter(w => w.Work_Order_ID === workOrder.Work_Order_ID);
                    missingEntries = woWarnings.map(w => ({
                        date: w.Date,
                        workerName: w.Worker_Name,
                        workerId: w.Worker_ID,
                        status: '' as AttendanceStatus,
                    }));
                }

                // Deduplicate (same worker might appear via multiple items)
                const seen = new Set<string>();
                missingEntries = missingEntries.filter(e => {
                    const key = `${e.workerId}_${e.date}`;
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                });

                setEntries(missingEntries);
            } catch (err: any) {
                console.error('AttendanceFixModal load error:', err);
                showToast(`Greška pri učitavanju: ${err.message}`, 'error');
            } finally {
                setLoading(false);
            }
        })();
    }, [workOrder.Work_Order_ID, organizationId, preloadedWarnings, showToast]);

    const updateStatus = useCallback((index: number, status: AttendanceStatus) => {
        setEntries(prev => {
            const next = [...prev];
            next[index] = { ...next[index], status };
            return next;
        });
    }, []);

    const setAllStatus = useCallback((status: AttendanceStatus) => {
        setEntries(prev => prev.map(e => ({ ...e, status })));
    }, []);

    const entriesToSave = entries.filter(e => e.status !== '');

    const handleSave = async () => {
        if (entriesToSave.length === 0) {
            showToast('Niste odabrali status za nijedan dan', 'info');
            return;
        }

        setSaving(true);
        setProgress(0);

        try {
            let completed = 0;
            for (const entry of entriesToSave) {
                await markAttendanceAndRecalculate({
                    Worker_ID: entry.workerId,
                    Worker_Name: entry.workerName,
                    Date: entry.date,
                    Status: entry.status as 'Prisutan' | 'Teren' | 'Odsutan' | 'Bolovanje' | 'Odmor',
                    Organization_ID: organizationId,
                }, { skipRecalculation: true }); // Skip per-entry recalc, do bulk at end

                completed++;
                setProgress(Math.round((completed / entriesToSave.length) * 100));
            }

            // Final recalculation
            await recalculateWorkOrder(workOrder.Work_Order_ID);

            showToast(`Prisustvo ažurirano za ${entriesToSave.length} zapisa`, 'success');
            onSaved();
            onClose();
        } catch (err: any) {
            console.error('AttendanceFixModal save error:', err);
            showToast(`Greška: ${err.message}`, 'error');
        } finally {
            setSaving(false);
        }
    };

    // Group entries by date for better readability
    const groupedByDate = entries.reduce((acc, entry, idx) => {
        if (!acc[entry.date]) acc[entry.date] = [];
        acc[entry.date].push({ ...entry, index: idx });
        return acc;
    }, {} as Record<string, (MissingEntry & { index: number })[]>);

    const sortedDates = Object.keys(groupedByDate).sort();

    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 10000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
        }}
            onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}
        >
            <div style={{
                background: '#1c1c1e', borderRadius: '16px', width: '90%', maxWidth: '680px',
                maxHeight: '85vh', display: 'flex', flexDirection: 'column',
                border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 24px 48px rgba(0,0,0,0.4)',
            }}>
                {/* Header */}
                <div style={{
                    padding: '20px 24px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0,
                }}>
                    <div>
                        <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 600, color: '#fff' }}>
                            <span className="material-icons-round" style={{ fontSize: '20px', verticalAlign: 'middle', marginRight: '8px', color: '#f59e0b' }}>event_busy</span>
                            Popunite prisustvo
                        </h3>
                        <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', marginTop: '4px' }}>
                            {workOrder.Work_Order_Number || workOrder.Work_Order_ID} — {entries.length} nedostajućih zapisa
                        </div>
                    </div>
                    <button onClick={onClose} disabled={saving} style={{
                        background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '8px',
                        width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: saving ? 'not-allowed' : 'pointer', color: '#fff',
                    }}>
                        <span className="material-icons-round" style={{ fontSize: '18px' }}>close</span>
                    </button>
                </div>

                {/* Quick Action Bar */}
                {!loading && entries.length > 0 && (
                    <div style={{
                        padding: '10px 24px', borderBottom: '1px solid rgba(255,255,255,0.06)',
                        display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0, flexWrap: 'wrap',
                    }}>
                        <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', marginRight: '4px' }}>Sve postavi na:</span>
                        {STATUS_OPTIONS.filter(s => s.value !== '').map(s => (
                            <button key={s.value} onClick={() => setAllStatus(s.value)} style={{
                                padding: '4px 10px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)',
                                background: 'rgba(255,255,255,0.05)', color: s.color, fontSize: '11px', fontWeight: 500,
                                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px',
                            }}>
                                <span className="material-icons-round" style={{ fontSize: '13px' }}>{s.icon}</span>
                                {s.label}
                            </button>
                        ))}
                    </div>
                )}

                {/* Content */}
                <div style={{ overflow: 'auto', flex: 1, padding: '16px 24px' }}>
                    {loading ? (
                        <div style={{ textAlign: 'center', padding: '40px 0', color: 'rgba(255,255,255,0.5)' }}>
                            <span className="material-icons-round" style={{ fontSize: '32px', animation: 'spin 1s linear infinite' }}>sync</span>
                            <div style={{ marginTop: '12px', fontSize: '13px' }}>Učitavanje nedostajućih dana...</div>
                        </div>
                    ) : entries.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '40px 0', color: 'rgba(255,255,255,0.5)' }}>
                            <span className="material-icons-round" style={{ fontSize: '32px', color: '#34C759' }}>check_circle</span>
                            <div style={{ marginTop: '12px', fontSize: '13px' }}>Svi dani su popunjeni!</div>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            {sortedDates.map(date => (
                                <div key={date}>
                                    <div style={{
                                        fontSize: '12px', fontWeight: 600, color: 'rgba(255,255,255,0.4)',
                                        marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px',
                                    }}>
                                        {formatDate(date)}
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                        {groupedByDate[date].map(entry => (
                                            <div key={`${entry.date}-${entry.workerId}-${entry.index}`} style={{
                                                display: 'flex', alignItems: 'center', gap: '12px',
                                                padding: '8px 12px', borderRadius: '10px',
                                                background: entry.status ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.02)',
                                                border: `1px solid ${entry.status ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.05)'}`,
                                            }}>
                                                <span className="material-icons-round" style={{ fontSize: '18px', color: 'rgba(255,255,255,0.3)' }}>person</span>
                                                <span style={{ flex: 1, fontSize: '13px', color: '#fff', fontWeight: 500 }}>
                                                    {entry.workerName}
                                                </span>
                                                <select
                                                    value={entry.status}
                                                    onChange={(e) => updateStatus(entry.index, e.target.value as AttendanceStatus)}
                                                    style={{
                                                        padding: '6px 10px', borderRadius: '8px',
                                                        border: '1px solid rgba(255,255,255,0.15)',
                                                        background: 'rgba(255,255,255,0.06)', color: '#fff',
                                                        fontSize: '12px', cursor: 'pointer', outline: 'none',
                                                        minWidth: '120px',
                                                    }}
                                                >
                                                    {STATUS_OPTIONS.map(opt => (
                                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Progress Bar */}
                {saving && (
                    <div style={{ padding: '0 24px', flexShrink: 0 }}>
                        <div style={{
                            height: '4px', borderRadius: '2px', background: 'rgba(255,255,255,0.1)', overflow: 'hidden',
                        }}>
                            <div style={{
                                height: '100%', width: `${progress}%`, borderRadius: '2px',
                                background: 'linear-gradient(90deg, #007AFF, #34C759)', transition: 'width 0.3s ease',
                            }} />
                        </div>
                        <div style={{ textAlign: 'center', fontSize: '11px', color: 'rgba(255,255,255,0.5)', padding: '6px 0' }}>
                            Procesiranje... {progress}%
                        </div>
                    </div>
                )}

                {/* Footer */}
                <div style={{
                    padding: '16px 24px', borderTop: '1px solid rgba(255,255,255,0.08)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0,
                }}>
                    <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)' }}>
                        {entriesToSave.length > 0 ? `${entriesToSave.length} zapisa za čuvanje` : 'Odaberite status za dane'}
                    </span>
                    <div style={{ display: 'flex', gap: '10px' }}>
                        <button onClick={onClose} disabled={saving} style={{
                            padding: '10px 20px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.15)',
                            background: 'transparent', color: '#fff', fontWeight: 500,
                            cursor: saving ? 'not-allowed' : 'pointer', fontSize: '13px',
                        }}>
                            Otkaži
                        </button>
                        <button onClick={handleSave} disabled={saving || entriesToSave.length === 0} style={{
                            padding: '10px 24px', borderRadius: '10px', border: 'none',
                            background: (saving || entriesToSave.length === 0)
                                ? 'rgba(0, 122, 255, 0.3)'
                                : 'linear-gradient(135deg, #007AFF 0%, #0056b3 100%)',
                            color: '#fff', fontWeight: 600,
                            cursor: (saving || entriesToSave.length === 0) ? 'not-allowed' : 'pointer',
                            fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px',
                        }}>
                            {saving ? (
                                <>
                                    <span className="material-icons-round" style={{ fontSize: '16px', animation: 'spin 1s linear infinite' }}>sync</span>
                                    Čuvanje...
                                </>
                            ) : (
                                <>
                                    <span className="material-icons-round" style={{ fontSize: '16px' }}>save</span>
                                    Sačuvaj prisustvo
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

function formatDate(dateStr: string): string {
    const d = new Date(dateStr + 'T12:00:00');
    const days = ['Nedjelja', 'Ponedjeljak', 'Utorak', 'Srijeda', 'Četvrtak', 'Petak', 'Subota'];
    const months = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
    return `${days[d.getDay()]}, ${d.getDate()}. ${months[d.getMonth()]} ${d.getFullYear()}`;
}
