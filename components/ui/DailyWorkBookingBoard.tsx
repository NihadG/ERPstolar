'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import {
    ChevronLeft,
    ChevronRight,
    Calendar,
    Plus,
    X,
    Save,
    Sparkles,
    Loader2,
    Box,
    AlertTriangle,
    CheckCircle,
    NotebookPen,
    BarChart3,
    User,
    Package,
    ClipboardList,
} from 'lucide-react';
import type { WorkOrder, Worker, WorkLog } from '@/lib/types';
import {
    getDailyWorkBooking,
    suggestDailyBooking,
    saveDailyWorkBooking,
    getAllAttendanceByMonth,
} from '@/lib/services';
import { useAuth } from '@/context/AuthContext';
import { SearchableSelect } from './SearchableSelect';
import './DailyWorkBookingBoard.css';

interface DailyWorkBookingBoardProps {
    workOrders: WorkOrder[];
    workers: Worker[];
    workLogs: WorkLog[];
    onRefresh: (...collections: string[]) => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

interface BookingItem {
    workOrderItemId: string;
    dayFraction: number;       // 1 ili 0.5
    processName?: string;
}
interface BookingEntry {
    workerId: string;
    items: BookingItem[];
}

interface BookableItem {
    id: string;
    productName: string;
    projectName: string;
    workOrderId: string;
    workOrderNumber: string;
    processes: string[];
}

const toISO = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};
const DAY_NAMES = ['Ned', 'Pon', 'Uto', 'Sri', 'Čet', 'Pet', 'Sub'];
const DAY_FULL = ['Nedjelja', 'Ponedjeljak', 'Utorak', 'Srijeda', 'Četvrtak', 'Petak', 'Subota'];
const MONTHS = ['Januar', 'Februar', 'Mart', 'April', 'Maj', 'Juni', 'Juli', 'August', 'Septembar', 'Oktobar', 'Novembar', 'Decembar'];

const formatHuman = (iso: string) => {
    const d = new Date(iso + 'T00:00:00');
    return `${DAY_FULL[d.getDay()]}, ${d.toLocaleDateString('bs-BA')}`;
};
const startOfWeek = (d: Date) => {
    const x = new Date(d);
    const day = x.getDay();
    x.setDate(x.getDate() - (day === 0 ? 6 : day - 1)); // Monday start
    x.setHours(0, 0, 0, 0);
    return x;
};
const km = (n: number) => Math.round(n).toLocaleString('bs-BA') + ' KM';
const daysLabel = (n: number) => `${Math.round(n * 100) / 100} ${n === 1 ? 'dan' : 'dana'}`;

export default function DailyWorkBookingBoard({ workOrders, workers, workLogs, onRefresh, showToast }: DailyWorkBookingBoardProps) {
    const { organization } = useAuth();
    const orgId = organization?.Organization_ID || '';

    const [view, setView] = useState<'daily' | 'overview'>('daily');

    // ── Daily state ─────────────────────────────────────────────────────────
    const [date, setDate] = useState<string>(toISO(new Date()));
    const [entries, setEntries] = useState<BookingEntry[]>([]);
    const [presentWorkerIds, setPresentWorkerIds] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    // ── Overview state ──────────────────────────────────────────────────────
    const [periodMode, setPeriodMode] = useState<'week' | 'month'>('week');
    const [anchor, setAnchor] = useState<Date>(new Date());

    // ── Lookups ───────────────────────────────────────────────────────────────
    const bookableItems = useMemo<BookableItem[]>(() => {
        const list: BookableItem[] = [];
        workOrders.forEach(wo => {
            if (wo.Status === 'Završeno' || wo.Status === 'Otkazano') return;
            (wo.items || []).forEach(item => {
                if (item.Status === 'Završeno') return;
                const processes = (item.Processes && item.Processes.length > 0)
                    ? item.Processes.map(p => p.Process_Name)
                    : (wo.Production_Steps || []);
                list.push({
                    id: item.ID,
                    productName: item.Product_Name,
                    projectName: item.Project_Name,
                    workOrderId: wo.Work_Order_ID,
                    workOrderNumber: wo.Work_Order_Number,
                    processes,
                });
            });
        });
        return list;
    }, [workOrders]);

    const itemLookup = useMemo(() => {
        const m = new Map<string, BookableItem>();
        bookableItems.forEach(i => m.set(i.id, i));
        return m;
    }, [bookableItems]);

    const workerLookup = useMemo(() => {
        const m = new Map<string, Worker>();
        workers.forEach(w => m.set(w.Worker_ID, w));
        return m;
    }, [workers]);

    // Worker → product name / WO number resolution across ALL work orders (for stats/history)
    const itemMetaAll = useMemo(() => {
        const m = new Map<string, { product: string; project: string; woId: string; woNumber: string }>();
        workOrders.forEach(wo => (wo.items || []).forEach(it => {
            m.set(it.ID, { product: it.Product_Name, project: it.Project_Name, woId: wo.Work_Order_ID, woNumber: wo.Work_Order_Number });
        }));
        return m;
    }, [workOrders]);

    const productOptions = useMemo(
        () => bookableItems.map(i => ({
            value: i.id,
            label: i.productName,
            subLabel: `${i.projectName} · Nalog ${i.workOrderNumber}`,
        })),
        [bookableItems]
    );

    // Workers assigned to active work orders ("koji imaju naloge")
    const relevantWorkerIds = useMemo(() => {
        const s = new Set<string>();
        workOrders.forEach(wo => {
            if (wo.Status === 'Završeno' || wo.Status === 'Otkazano') return;
            (wo.items || []).forEach(item => {
                (item.Assigned_Workers || []).forEach(w => s.add(w.Worker_ID));
                (item.Processes || []).forEach(p => { if (p.Worker_ID) s.add(p.Worker_ID); });
            });
        });
        return s;
    }, [workOrders]);

    // ── Load existing booking + present workers for the date ────────────────
    const loadDay = useCallback(async () => {
        if (!orgId) return;
        setLoading(true);
        try {
            const [existing, monthAtt] = await Promise.all([
                getDailyWorkBooking(date, orgId),
                getAllAttendanceByMonth(date.slice(0, 4), date.slice(5, 7), orgId),
            ]);
            setPresentWorkerIds(new Set(
                monthAtt.filter(a => a.Date === date && (a.Status === 'Prisutan' || a.Status === 'Teren')).map(a => a.Worker_ID)
            ));
            // Seed ONLY workers that already have a booking that day (no auto-populate of all workers)
            setEntries(existing.map(e => ({
                workerId: e.workerId,
                items: e.items.map(it => ({
                    workOrderItemId: it.workOrderItemId,
                    dayFraction: it.dayFraction,
                    processName: it.processName,
                })),
            })));
        } catch (err) {
            console.error('loadDay error', err);
            showToast('Greška pri učitavanju knjige rada', 'error');
        } finally {
            setLoading(false);
        }
    }, [orgId, date, showToast]);

    useEffect(() => { if (view === 'daily') loadDay(); }, [loadDay, view]);

    // ── Mutations ─────────────────────────────────────────────────────────────
    const shiftDay = (delta: number) => {
        const d = new Date(date + 'T00:00:00');
        d.setDate(d.getDate() + delta);
        setDate(toISO(d));
    };
    const addWorkerEntry = (workerId: string) => {
        if (!workerId) return;
        setEntries(prev => prev.some(e => e.workerId === workerId) ? prev : [...prev, { workerId, items: [] }]);
    };
    const removeWorkerEntry = (workerId: string) => setEntries(prev => prev.filter(e => e.workerId !== workerId));
    const addItem = (workerId: string, itemId: string) => {
        if (!itemId) return;
        setEntries(prev => prev.map(e => {
            if (e.workerId !== workerId) return e;
            if (e.items.some(i => i.workOrderItemId === itemId)) return e;
            return { ...e, items: [...e.items, { workOrderItemId: itemId, dayFraction: 1 }] };
        }));
    };
    const updateItem = (workerId: string, itemId: string, patch: Partial<BookingItem>) =>
        setEntries(prev => prev.map(e => e.workerId !== workerId ? e : { ...e, items: e.items.map(i => i.workOrderItemId === itemId ? { ...i, ...patch } : i) }));
    const removeItem = (workerId: string, itemId: string) =>
        setEntries(prev => prev.map(e => e.workerId !== workerId ? e : { ...e, items: e.items.filter(i => i.workOrderItemId !== itemId) }));

    const handleSuggest = async () => {
        if (!orgId) return;
        setLoading(true);
        try {
            const suggestions = await suggestDailyBooking(date, orgId);
            if (suggestions.length === 0) { showToast('Nema ranijih dana za prijedlog', 'info'); return; }
            setEntries(prev => {
                const map = new Map(prev.map(e => [e.workerId, e]));
                suggestions.forEach(s => map.set(s.workerId, {
                    workerId: s.workerId,
                    items: s.items.map(it => ({ workOrderItemId: it.workOrderItemId, dayFraction: it.dayFraction, processName: it.processName })),
                }));
                return Array.from(map.values());
            });
            showToast('Predložena raspodjela kao zadnji radni dan', 'success');
        } catch (err) {
            console.error(err); showToast('Greška pri prijedlogu', 'error');
        } finally { setLoading(false); }
    };

    const handleSave = async () => {
        if (!orgId || saving) return;
        setSaving(true);
        try {
            const payload = entries.map(e => ({
                workerId: e.workerId,
                items: e.items.filter(i => itemLookup.has(i.workOrderItemId)).map(i => ({
                    workOrderItemId: i.workOrderItemId, dayFraction: i.dayFraction, processName: i.processName,
                })),
            }));
            const res = await saveDailyWorkBooking(date, orgId, payload);
            if (res.success) { showToast(res.message, 'success'); onRefresh('workOrders', 'workLogs'); }
            else showToast(res.message, 'error');
        } catch (err) {
            console.error(err); showToast('Greška pri spremanju', 'error');
        } finally { setSaving(false); }
    };

    // ── Daily derived ───────────────────────────────────────────────────────
    const productTotals = useMemo(() => {
        const m = new Map<string, { name: string; project: string; days: number; amount: number }>();
        entries.forEach(e => {
            const rate = workerLookup.get(e.workerId)?.Daily_Rate || 0;
            e.items.forEach(i => {
                const meta = itemLookup.get(i.workOrderItemId);
                if (!meta) return;
                const cur = m.get(i.workOrderItemId) || { name: meta.productName, project: meta.projectName, days: 0, amount: 0 };
                cur.days += i.dayFraction; cur.amount += rate * i.dayFraction;
                m.set(i.workOrderItemId, cur);
            });
        });
        return Array.from(m.values());
    }, [entries, itemLookup, workerLookup]);

    const dayTotalAmount = useMemo(() => productTotals.reduce((s, p) => s + p.amount, 0), [productTotals]);
    const isToday = date === toISO(new Date());

    // Quick-add chips: present today OR assigned to active orders, not already added
    const quickAddWorkers = useMemo(() => {
        return workers.filter(w =>
            (presentWorkerIds.has(w.Worker_ID) || relevantWorkerIds.has(w.Worker_ID)) &&
            !entries.some(e => e.workerId === w.Worker_ID)
        );
    }, [presentWorkerIds, relevantWorkerIds, workers, entries]);

    const availableWorkerOptions = useMemo(
        () => workers.filter(w => !entries.some(e => e.workerId === w.Worker_ID))
            .map(w => ({ value: w.Worker_ID, label: w.Name, subLabel: `${w.Worker_Type} · ${w.Daily_Rate || 0} KM` })),
        [workers, entries]
    );

    // ── Overview derived ──────────────────────────────────────────────────────
    const period = useMemo(() => {
        if (periodMode === 'week') {
            const start = startOfWeek(anchor);
            const days: string[] = [];
            for (let i = 0; i < 7; i++) { const d = new Date(start); d.setDate(start.getDate() + i); days.push(toISO(d)); }
            return { days, label: `${days[0].slice(8)}.${days[0].slice(5, 7)} – ${days[6].slice(8)}.${days[6].slice(5, 7)}.${days[6].slice(0, 4)}` };
        }
        const y = anchor.getFullYear(), mo = anchor.getMonth();
        const count = new Date(y, mo + 1, 0).getDate();
        const days: string[] = [];
        for (let i = 1; i <= count; i++) days.push(toISO(new Date(y, mo, i)));
        return { days, label: `${MONTHS[mo]} ${y}` };
    }, [periodMode, anchor]);

    const periodLogs = useMemo(() => {
        const set = new Set(period.days);
        return workLogs.filter(l => set.has(l.Date));
    }, [workLogs, period]);

    const stats = useMemo(() => {
        const totalCost = periodLogs.reduce((s, l) => s + (l.Daily_Rate || 0), 0);
        const totalDays = periodLogs.reduce((s, l) => s + (l.Day_Fraction ?? 1), 0);
        const recordedDates = new Set(periodLogs.map(l => l.Date));
        return {
            totalCost,
            totalDays,
            recordedDays: recordedDates.size,
            avgRate: totalDays > 0 ? totalCost / totalDays : 0,
        };
    }, [periodLogs]);

    const byWorker = useMemo(() => {
        const m = new Map<string, { name: string; days: number; cost: number }>();
        periodLogs.forEach(l => {
            const cur = m.get(l.Worker_ID) || { name: l.Worker_Name, days: 0, cost: 0 };
            cur.days += l.Day_Fraction ?? 1; cur.cost += l.Daily_Rate || 0;
            m.set(l.Worker_ID, cur);
        });
        return Array.from(m.values()).sort((a, b) => b.cost - a.cost);
    }, [periodLogs]);

    const byProduct = useMemo(() => {
        const m = new Map<string, { name: string; sub: string; days: number; cost: number }>();
        periodLogs.forEach(l => {
            const meta = itemMetaAll.get(l.Work_Order_Item_ID);
            const cur = m.get(l.Work_Order_Item_ID) || { name: meta?.product || 'Nepoznat proizvod', sub: meta ? `${meta.project} · Nalog ${meta.woNumber}` : '', days: 0, cost: 0 };
            cur.days += l.Day_Fraction ?? 1; cur.cost += l.Daily_Rate || 0;
            m.set(l.Work_Order_Item_ID, cur);
        });
        return Array.from(m.values()).sort((a, b) => b.cost - a.cost);
    }, [periodLogs, itemMetaAll]);

    const dayCostMap = useMemo(() => {
        const m = new Map<string, number>();
        periodLogs.forEach(l => m.set(l.Date, (m.get(l.Date) || 0) + (l.Daily_Rate || 0)));
        return m;
    }, [periodLogs]);

    const maxDayCost = useMemo(() => Math.max(1, ...Array.from(dayCostMap.values())), [dayCostMap]);

    const shiftPeriod = (delta: number) => {
        const d = new Date(anchor);
        if (periodMode === 'week') d.setDate(d.getDate() + delta * 7);
        else d.setMonth(d.getMonth() + delta);
        setAnchor(d);
    };

    // ════════════════════════════════════════════════════════════════════════
    return (
        <div className="dwb">
            {/* View switcher */}
            <div className="dwb-tabs">
                <button className={view === 'daily' ? 'active' : ''} onClick={() => setView('daily')}>
                    <NotebookPen size={15} /> Dnevni unos
                </button>
                <button className={view === 'overview' ? 'active' : ''} onClick={() => setView('overview')}>
                    <BarChart3 size={15} /> Pregled & statistika
                </button>
            </div>

            {view === 'daily' ? (
                <>
                    {/* Daily header */}
                    <div className="dwb-header">
                        <div className="dwb-date-nav">
                            <button className="dwb-icon-btn" onClick={() => shiftDay(-1)} aria-label="Prethodni dan"><ChevronLeft size={18} /></button>
                            <label className="dwb-date-label">
                                <Calendar size={15} />
                                <input type="date" className="dwb-date-input" value={date} onChange={e => e.target.value && setDate(e.target.value)} />
                            </label>
                            <button className="dwb-icon-btn" onClick={() => shiftDay(1)} aria-label="Sljedeći dan"><ChevronRight size={18} /></button>
                            <div className="dwb-date-meta">
                                <span className="dwb-date-main">{formatHuman(date)}{isToday && <span className="dwb-today-pill">danas</span>}</span>
                                <span className="dwb-date-sub">{entries.length} radnik(a) · {km(dayTotalAmount)} raspoređeno</span>
                            </div>
                        </div>
                        <div className="dwb-header-actions">
                            <button className="dwb-btn dwb-btn-ghost" onClick={handleSuggest} disabled={loading || saving}><Sparkles size={15} /> Kao jučer</button>
                            <button className="dwb-btn dwb-btn-primary" onClick={handleSave} disabled={loading || saving}>
                                {saving ? <Loader2 size={15} className="dwb-spin" /> : <Save size={15} />} Spremi
                            </button>
                        </div>
                    </div>

                    {/* Quick-add chips */}
                    {quickAddWorkers.length > 0 && (
                        <div className="dwb-quickadd">
                            <span className="dwb-quickadd-label">Dodaj:</span>
                            {quickAddWorkers.map(w => (
                                <button key={w.Worker_ID} className="dwb-chip" onClick={() => addWorkerEntry(w.Worker_ID)}>
                                    <Plus size={13} /> {w.Name}
                                    {presentWorkerIds.has(w.Worker_ID) && <span className="dwb-chip-dot" title="Prisutan u šihtarici" />}
                                </button>
                            ))}
                        </div>
                    )}

                    {loading && <div className="dwb-loading"><Loader2 size={18} className="dwb-spin" /> Učitavam…</div>}

                    {/* Worker entries */}
                    <div className="dwb-entries">
                        {entries.length === 0 && !loading && (
                            <div className="dwb-empty">
                                <NotebookPen size={26} />
                                <p>Knjiga rada za ovaj dan je prazna.</p>
                                <p className="dwb-empty-hint">Dodaj radnike koji su radili — gornjim prečicama ili pretragom ispod.</p>
                            </div>
                        )}

                        {entries.map(entry => {
                            const worker = workerLookup.get(entry.workerId);
                            const rate = worker?.Daily_Rate || 0;
                            const totalFraction = entry.items.reduce((s, i) => s + i.dayFraction, 0);
                            const initials = (worker?.Name || '?').split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase();
                            return (
                                <div className="dwb-worker-card" key={entry.workerId}>
                                    <div className="dwb-worker-head">
                                        <div className={`dwb-avatar ${worker?.Worker_Type === 'Pomoćnik' ? 'is-helper' : ''}`}>{initials}</div>
                                        <div className="dwb-worker-meta">
                                            <div className="dwb-worker-name">{worker?.Name || 'Nepoznat radnik'}</div>
                                            <div className="dwb-worker-sub">dnevnica {rate} KM</div>
                                        </div>
                                        <div className={`dwb-day-badge ${totalFraction > 1 ? 'over' : totalFraction === 1 ? 'full' : ''}`}>
                                            {totalFraction > 1 && <AlertTriangle size={12} />}
                                            {totalFraction === 1 && <CheckCircle size={12} />}
                                            {daysLabel(totalFraction)}
                                        </div>
                                        <button className="dwb-icon-btn dwb-remove" onClick={() => removeWorkerEntry(entry.workerId)} aria-label="Ukloni radnika"><X size={16} /></button>
                                    </div>

                                    <div className="dwb-items">
                                        {entry.items.map(item => {
                                            const meta = itemLookup.get(item.workOrderItemId);
                                            const amount = Math.round(rate * item.dayFraction);
                                            return (
                                                <div className="dwb-item" key={item.workOrderItemId}>
                                                    <Box size={15} className="dwb-item-icon" />
                                                    <div className="dwb-item-main">
                                                        <div className="dwb-item-name">{meta?.productName || 'Proizvod nije aktivan'}</div>
                                                        <div className="dwb-item-sub">{meta?.projectName} · Nalog {meta?.workOrderNumber}</div>
                                                    </div>
                                                    {meta && meta.processes.length > 0 && (
                                                        <select className="dwb-process-select" value={item.processName || ''}
                                                            onChange={e => updateItem(entry.workerId, item.workOrderItemId, { processName: e.target.value || undefined })}>
                                                            <option value="">— proces —</option>
                                                            {meta.processes.map(p => <option key={p} value={p}>{p}</option>)}
                                                        </select>
                                                    )}
                                                    <div className="dwb-frac-toggle">
                                                        <button className={item.dayFraction === 1 ? 'active' : ''} onClick={() => updateItem(entry.workerId, item.workOrderItemId, { dayFraction: 1 })}>cijeli</button>
                                                        <button className={item.dayFraction === 0.5 ? 'active' : ''} onClick={() => updateItem(entry.workerId, item.workOrderItemId, { dayFraction: 0.5 })}>½</button>
                                                    </div>
                                                    <div className="dwb-item-amount">{amount} KM</div>
                                                    <button className="dwb-icon-btn dwb-remove" onClick={() => removeItem(entry.workerId, item.workOrderItemId)} aria-label="Ukloni proizvod"><X size={14} /></button>
                                                </div>
                                            );
                                        })}
                                        <div className="dwb-add-item">
                                            <SearchableSelect
                                                options={productOptions.filter(o => !entry.items.some(i => i.workOrderItemId === o.value))}
                                                value="" onChange={v => addItem(entry.workerId, v)} placeholder="+ dodaj proizvod…"
                                            />
                                        </div>
                                    </div>
                                </div>
                            );
                        })}

                        {availableWorkerOptions.length > 0 && (
                            <div className="dwb-add-worker">
                                <Plus size={15} />
                                <SearchableSelect options={availableWorkerOptions} value="" onChange={addWorkerEntry} placeholder="Dodaj radnika u knjigu rada…" />
                            </div>
                        )}
                    </div>

                    {productTotals.length > 0 && (
                        <div className="dwb-rollup">
                            <div className="dwb-rollup-title">Danas po proizvodu</div>
                            {productTotals.map((p, idx) => (
                                <div className="dwb-rollup-row" key={idx}>
                                    <span className="dwb-rollup-name">{p.name}</span>
                                    <span className="dwb-rollup-meta">{p.project}</span>
                                    <span className="dwb-rollup-days">{daysLabel(p.days)}</span>
                                    <span className="dwb-rollup-amount">{km(p.amount)}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </>
            ) : (
                /* ── OVERVIEW ─────────────────────────────────────────────── */
                <>
                    <div className="dwb-header">
                        <div className="dwb-date-nav">
                            <button className="dwb-icon-btn" onClick={() => shiftPeriod(-1)} aria-label="Prethodni period"><ChevronLeft size={18} /></button>
                            <div className="dwb-date-meta">
                                <span className="dwb-date-main">{period.label}</span>
                                <span className="dwb-date-sub">{stats.recordedDays} evidentiran(ih) dana</span>
                            </div>
                            <button className="dwb-icon-btn" onClick={() => shiftPeriod(1)} aria-label="Sljedeći period"><ChevronRight size={18} /></button>
                        </div>
                        <div className="dwb-segmented">
                            <button className={periodMode === 'week' ? 'active' : ''} onClick={() => setPeriodMode('week')}>Sedmica</button>
                            <button className={periodMode === 'month' ? 'active' : ''} onClick={() => setPeriodMode('month')}>Mjesec</button>
                        </div>
                    </div>

                    {/* Metric cards */}
                    <div className="dwb-metrics">
                        <div className="dwb-metric"><span className="dwb-metric-label">Trošak rada</span><span className="dwb-metric-value">{km(stats.totalCost)}</span></div>
                        <div className="dwb-metric"><span className="dwb-metric-label">Radnih dana</span><span className="dwb-metric-value">{Math.round(stats.totalDays * 100) / 100}</span></div>
                        <div className="dwb-metric"><span className="dwb-metric-label">Evidentiranih dana</span><span className="dwb-metric-value">{stats.recordedDays}</span></div>
                        <div className="dwb-metric"><span className="dwb-metric-label">Prosj. dnevnica</span><span className="dwb-metric-value">{km(stats.avgRate)}</span></div>
                    </div>

                    {/* Calendar strip — gaps visible */}
                    <div className="dwb-cal">
                        {period.days.map(d => {
                            const cost = dayCostMap.get(d) || 0;
                            const dd = new Date(d + 'T00:00:00');
                            const h = cost > 0 ? Math.max(14, (cost / maxDayCost) * 48) : 3;
                            const isWeekend = dd.getDay() === 0 || dd.getDay() === 6;
                            return (
                                <button key={d} className={`dwb-cal-day ${cost > 0 ? 'has' : 'empty'} ${isWeekend ? 'weekend' : ''}`}
                                    onClick={() => { setDate(d); setView('daily'); }} title={`${formatHuman(d)} — ${km(cost)}`}>
                                    <span className="dwb-cal-bar" style={{ height: `${h}px` }} />
                                    <span className="dwb-cal-dow">{DAY_NAMES[dd.getDay()]}</span>
                                    <span className="dwb-cal-num">{dd.getDate()}</span>
                                </button>
                            );
                        })}
                    </div>

                    {periodLogs.length === 0 ? (
                        <div className="dwb-empty"><BarChart3 size={26} /><p>Nema evidentiranog rada u ovom periodu.</p></div>
                    ) : (
                        <div className="dwb-books">
                            <div className="dwb-book">
                                <div className="dwb-book-title"><User size={15} /> Po radniku</div>
                                {byWorker.map((w, i) => (
                                    <div className="dwb-book-row" key={i}>
                                        <span className="dwb-book-name">{w.name}</span>
                                        <span className="dwb-book-days">{daysLabel(w.days)}</span>
                                        <span className="dwb-book-amount">{km(w.cost)}</span>
                                    </div>
                                ))}
                            </div>

                            <div className="dwb-book">
                                <div className="dwb-book-title"><Package size={15} /> Po proizvodu</div>
                                {byProduct.map((p, i) => (
                                    <div className="dwb-book-row" key={i}>
                                        <span className="dwb-book-name">{p.name}<span className="dwb-book-sub">{p.sub}</span></span>
                                        <span className="dwb-book-days">{daysLabel(p.days)}</span>
                                        <span className="dwb-book-amount">{km(p.cost)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
