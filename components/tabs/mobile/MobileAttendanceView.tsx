'use client';

import { useState, useMemo, useEffect } from 'react';
import type { Worker, WorkerAttendance } from '@/lib/types';
import { formatLocalDateISO } from '@/lib/services';
import type { LucideIcon } from 'lucide-react';

interface StatusDisplay {
    icon: LucideIcon;
    color: string;
    bg: string;
    label: string;
}

interface MobileAttendanceViewProps {
    workers: Worker[];
    getAttendance: (workerId: string, dateStr: string) => WorkerAttendance | undefined;
    isBookedInfo: (workerId: string, dateStr: string) => boolean | undefined;
    isPresentUnbooked: (workerId: string, dateStr: string) => boolean;
    getStatusDisplay: (status: string) => StatusDisplay;
    yesterdayStatusOf: (workerId: string, dateStr: string) => string | undefined;
    onCellTap: (worker: Worker, dateStr: string) => void;
    onRepeatYesterday: (worker: Worker, dateStr: string) => void;
    onOpenBulkEdit: (dateStr: string) => void;
    onOpenBookingConfirm: (
        savedWorkers: { workerId: string; workerName: string; status: string }[],
        dateStr: string
    ) => Promise<boolean>;
    onLoadMonth: (year: number, month: number) => void;
    onOpenPayroll: () => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

const DAY_NAMES = ['Ned', 'Pon', 'Uto', 'Sri', 'Čet', 'Pet', 'Sub'];

function mondayOf(d: Date): Date {
    const date = new Date(d);
    date.setHours(0, 0, 0, 0);
    const day = date.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    date.setDate(date.getDate() + diff);
    return date;
}

function addDays(d: Date, n: number): Date {
    const date = new Date(d);
    date.setDate(date.getDate() + n);
    return date;
}

export default function MobileAttendanceView({
    workers,
    getAttendance,
    isBookedInfo,
    isPresentUnbooked,
    getStatusDisplay,
    yesterdayStatusOf,
    onCellTap,
    onRepeatYesterday,
    onOpenBulkEdit,
    onOpenBookingConfirm,
    onLoadMonth,
    onOpenPayroll,
    showToast,
}: MobileAttendanceViewProps) {
    const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());
    const [searchTerm, setSearchTerm] = useState('');

    const selectedDateStr = formatLocalDateISO(selectedDate);
    const todayStr = formatLocalDateISO(new Date());

    const weekDates = useMemo(() => {
        const monday = mondayOf(selectedDate);
        return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedDateStr]);

    // Osiguraj da su mjeseci dotaknuti sedmičnom trakom učitani (onLoadMonth je idempotentan — cache-checked)
    useEffect(() => {
        const months = new Set<string>();
        [selectedDate, ...weekDates].forEach(d => months.add(`${d.getFullYear()}-${d.getMonth() + 1}`));
        months.forEach(key => {
            const [y, m] = key.split('-').map(Number);
            onLoadMonth(y, m);
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedDateStr]);

    const filteredWorkers = useMemo(() => {
        if (!searchTerm.trim()) return workers;
        const s = searchTerm.toLowerCase();
        return workers.filter(w => w.Name.toLowerCase().includes(s));
    }, [workers, searchTerm]);

    const unbookedWorkers = useMemo(
        () => workers.filter(w => isPresentUnbooked(w.Worker_ID, selectedDateStr)),
        [workers, selectedDateStr, isPresentUnbooked]
    );

    const weekHasUnbooked = useMemo(() => {
        const set = new Set<string>();
        weekDates.forEach(d => {
            const ds = formatLocalDateISO(d);
            if (workers.some(w => isPresentUnbooked(w.Worker_ID, ds))) set.add(ds);
        });
        return set;
    }, [weekDates, workers, isPresentUnbooked]);

    function shiftDay(n: number) {
        setSelectedDate(prev => addDays(prev, n));
    }

    function goToday() {
        setSelectedDate(new Date());
    }

    async function handleUnbookedTap() {
        const opened = await onOpenBookingConfirm(
            unbookedWorkers.map(w => ({
                workerId: w.Worker_ID,
                workerName: w.Name,
                status: getAttendance(w.Worker_ID, selectedDateStr)!.Status,
            })),
            selectedDateStr
        );
        if (!opened) showToast('Nema kandidata za knjiženje (provjeri naloge/dodjele)', 'info');
    }

    const dayLabel = selectedDate.toLocaleDateString('hr-HR', { weekday: 'long', day: 'numeric', month: 'long' });

    return (
        <div className="mob-att">
            <div className="mob-att-toolbar">
                <div className="mob-att-search">
                    <span className="material-icons-round">search</span>
                    <input
                        type="text"
                        placeholder="Pretraži radnika..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                <button className="mob-att-icon-btn" onClick={goToday} title="Danas" aria-label="Danas">
                    <span className="material-icons-round">today</span>
                </button>
                <button className="mob-att-icon-btn" onClick={onOpenPayroll} title="Obračun" aria-label="Obračun">
                    <span className="material-icons-round">payments</span>
                </button>
            </div>

            <div className="mob-att-daynav">
                <button className="mob-att-nav-btn" onClick={() => shiftDay(-1)} aria-label="Prethodni dan">
                    <span className="material-icons-round">chevron_left</span>
                </button>
                <div className="mob-att-daylabel">
                    <span className="mob-att-daylabel-text">{dayLabel}</span>
                    {selectedDateStr === todayStr && <span className="mob-att-today-chip">Danas</span>}
                </div>
                <button className="mob-att-nav-btn" onClick={() => shiftDay(1)} aria-label="Sljedeći dan">
                    <span className="material-icons-round">chevron_right</span>
                </button>
            </div>

            <div className="mob-att-weekstrip">
                {weekDates.map(d => {
                    const ds = formatLocalDateISO(d);
                    const isSelected = ds === selectedDateStr;
                    const isToday = ds === todayStr;
                    return (
                        <button
                            key={ds}
                            className={`mob-att-pill${isSelected ? ' active' : ''}${isToday && !isSelected ? ' today' : ''}`}
                            onClick={() => setSelectedDate(d)}
                        >
                            <span className="mob-att-pill-dow">{DAY_NAMES[d.getDay()]}</span>
                            <span className="mob-att-pill-num">{d.getDate()}</span>
                            {weekHasUnbooked.has(ds) && <span className="mob-att-pill-dot" />}
                        </button>
                    );
                })}
            </div>

            {unbookedWorkers.length > 0 && (
                <button className="mob-att-unbooked-bar" onClick={handleUnbookedTap}>
                    <span className="material-icons-round">receipt_long</span>
                    <span className="mob-att-unbooked-text">
                        {unbookedWorkers.length} {unbookedWorkers.length === 1 ? 'radnik' : 'radnika'} bez dnevnice — Proknjiži
                    </span>
                    <span className="material-icons-round">chevron_right</span>
                </button>
            )}

            <button className="mob-att-bulk-btn" onClick={() => onOpenBulkEdit(selectedDateStr)}>
                <span className="material-icons-round">groups</span>
                Postavi sve radnike
            </button>

            <div className="mob-att-list">
                {filteredWorkers.length === 0 ? (
                    <div className="mob-att-empty">
                        <span className="material-icons-round">person_search</span>
                        <div>{searchTerm ? 'Nema radnika koji odgovaraju pretrazi' : 'Nema aktivnih radnika'}</div>
                    </div>
                ) : (
                    filteredWorkers.map(worker => {
                        const attendance = getAttendance(worker.Worker_ID, selectedDateStr);
                        const display = attendance ? getStatusDisplay(attendance.Status) : null;
                        const unbooked = isPresentUnbooked(worker.Worker_ID, selectedDateStr);
                        const yStatus = yesterdayStatusOf(worker.Worker_ID, selectedDateStr);
                        return (
                            <div
                                key={worker.Worker_ID}
                                className="mob-att-card"
                                style={{ borderLeftColor: display ? display.color : 'var(--border)' }}
                                onClick={() => onCellTap(worker, selectedDateStr)}
                            >
                                <div className="mob-att-card-main">
                                    <div className="mob-att-card-name">{worker.Name}</div>
                                    <div className="mob-att-card-role">{worker.Role}</div>
                                </div>
                                <div className="mob-att-card-right">
                                    {unbooked && <span className="mob-att-unbooked-dot" title="Bez knjižene dnevnice" />}
                                    {display ? (
                                        <span className="mob-att-status-chip" style={{ color: display.color, background: display.bg }}>
                                            <display.icon size={14} />
                                            {display.label}
                                        </span>
                                    ) : (
                                        <span className="mob-att-status-chip mob-att-status-chip--empty">Nije označeno</span>
                                    )}
                                    <button
                                        className="mob-att-repeat-btn"
                                        onClick={(e) => { e.stopPropagation(); onRepeatYesterday(worker, selectedDateStr); }}
                                        title={yStatus ? `Kao jučer (${yStatus})` : 'Kao jučer'}
                                        aria-label="Kao jučer"
                                    >
                                        <span className="material-icons-round">history</span>
                                    </button>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            <style jsx>{`
                .mob-att {
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                    padding: 12px;
                }

                .mob-att-toolbar {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                .mob-att-search {
                    flex: 1;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    background: var(--surface);
                    border: 1px solid var(--border-light);
                    border-radius: var(--radius-md);
                    padding: 0 12px;
                    height: 40px;
                }
                .mob-att-search .material-icons-round {
                    font-size: 18px;
                    color: var(--text-tertiary);
                }
                .mob-att-search input {
                    flex: 1;
                    border: none;
                    background: transparent;
                    outline: none;
                    font-size: 14px;
                    color: var(--text-primary);
                    height: 100%;
                }
                .mob-att-icon-btn {
                    flex-shrink: 0;
                    width: 40px;
                    height: 40px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: var(--surface);
                    border: 1px solid var(--border-light);
                    border-radius: var(--radius-md);
                    cursor: pointer;
                    color: var(--text-secondary);
                }
                .mob-att-icon-btn:active { background: var(--surface-active); }
                .mob-att-icon-btn .material-icons-round { font-size: 20px; }

                .mob-att-daynav {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 8px;
                    padding: 2px 0;
                }
                .mob-att-nav-btn {
                    flex-shrink: 0;
                    width: 36px;
                    height: 36px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: var(--surface);
                    border: 1px solid var(--border-light);
                    border-radius: var(--radius-sm);
                    cursor: pointer;
                    color: var(--text-secondary);
                }
                .mob-att-nav-btn:active { background: var(--surface-active); }
                .mob-att-daylabel {
                    flex: 1;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 8px;
                    font-size: 15px;
                    font-weight: 600;
                    color: var(--text-primary);
                    text-align: center;
                }
                .mob-att-daylabel-text::first-letter { text-transform: uppercase; }
                .mob-att-today-chip {
                    font-size: 11px;
                    font-weight: 700;
                    color: var(--accent);
                    background: var(--accent-light);
                    padding: 2px 8px;
                    border-radius: 999px;
                }

                .mob-att-weekstrip {
                    display: flex;
                    gap: 4px;
                }
                .mob-att-pill {
                    flex: 1;
                    min-width: 0;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 2px;
                    padding: 6px 2px 8px;
                    border-radius: var(--radius-md);
                    border: 1px solid transparent;
                    background: var(--surface);
                    cursor: pointer;
                    position: relative;
                }
                .mob-att-pill.today { border-color: var(--accent); }
                .mob-att-pill.active { background: var(--accent); }
                .mob-att-pill-dow {
                    font-size: 10px;
                    text-transform: uppercase;
                    letter-spacing: 0.02em;
                    color: var(--text-tertiary);
                }
                .mob-att-pill.active .mob-att-pill-dow { color: rgba(255,255,255,0.8); }
                .mob-att-pill-num {
                    font-size: 15px;
                    font-weight: 600;
                    color: var(--text-primary);
                }
                .mob-att-pill.active .mob-att-pill-num { color: #fff; }
                .mob-att-pill-dot {
                    position: absolute;
                    bottom: 3px;
                    width: 4px;
                    height: 4px;
                    border-radius: 50%;
                    background: var(--warning);
                }
                .mob-att-pill.active .mob-att-pill-dot { background: #fff; }

                .mob-att-unbooked-bar {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    width: 100%;
                    background: var(--warning-bg);
                    border: 1px solid #f3e1c0;
                    border-radius: var(--radius-md);
                    padding: 10px 12px;
                    color: #8a5a00;
                    font-size: 13px;
                    font-weight: 600;
                    cursor: pointer;
                    text-align: left;
                }
                .mob-att-unbooked-bar .material-icons-round { font-size: 18px; flex-shrink: 0; }
                .mob-att-unbooked-text { flex: 1; }

                .mob-att-bulk-btn {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 8px;
                    width: 100%;
                    background: var(--surface);
                    border: 1px solid var(--border-light);
                    border-radius: var(--radius-md);
                    padding: 10px 12px;
                    color: var(--text-primary);
                    font-size: 13px;
                    font-weight: 600;
                    cursor: pointer;
                }
                .mob-att-bulk-btn:active { background: var(--surface-active); }
                .mob-att-bulk-btn .material-icons-round { font-size: 18px; }

                .mob-att-list {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                    margin-top: 4px;
                }

                .mob-att-card {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 10px;
                    background: var(--background);
                    border: 1px solid var(--border-light);
                    border-left: 3px solid var(--border);
                    border-radius: var(--radius-md);
                    padding: 12px 14px;
                    min-height: 44px;
                    cursor: pointer;
                }
                .mob-att-card:active { background: var(--surface); }
                .mob-att-card-main { min-width: 0; }
                .mob-att-card-name {
                    font-size: 14px;
                    font-weight: 600;
                    color: var(--text-primary);
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                .mob-att-card-role {
                    font-size: 12px;
                    color: var(--text-secondary);
                }
                .mob-att-card-right {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    flex-shrink: 0;
                }
                .mob-att-unbooked-dot {
                    width: 8px;
                    height: 8px;
                    border-radius: 50%;
                    background: var(--warning);
                    flex-shrink: 0;
                }
                .mob-att-status-chip {
                    display: inline-flex;
                    align-items: center;
                    gap: 4px;
                    padding: 4px 9px;
                    border-radius: 999px;
                    font-size: 12px;
                    font-weight: 600;
                    white-space: nowrap;
                }
                .mob-att-status-chip--empty {
                    background: transparent;
                    color: var(--text-tertiary);
                    border: 1px dashed var(--border);
                }
                .mob-att-repeat-btn {
                    width: 36px;
                    height: 36px;
                    flex-shrink: 0;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: var(--surface);
                    border: 1px solid var(--border-light);
                    border-radius: var(--radius-sm);
                    cursor: pointer;
                    color: var(--text-secondary);
                }
                .mob-att-repeat-btn:active { background: var(--surface-active); }
                .mob-att-repeat-btn .material-icons-round { font-size: 17px; }

                .mob-att-empty {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 8px;
                    padding: 48px 16px;
                    text-align: center;
                    color: var(--text-secondary);
                }
                .mob-att-empty .material-icons-round {
                    font-size: 40px;
                    color: var(--text-tertiary);
                }
            `}</style>
        </div>
    );
}
