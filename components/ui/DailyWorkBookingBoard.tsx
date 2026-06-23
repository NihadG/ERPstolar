'use client';

import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
    ChevronLeft,
    ChevronRight,
    Plus,
    X,
    Save,
    History,
    Loader2,
    NotebookPen,
    BarChart3,
    User,
    Package,
    UserPlus,
    Edit2,
    CheckCircle,
    CalendarDays,
} from 'lucide-react';
import type { WorkOrder, Worker, WorkLog } from '@/lib/types';
import { COMMON_PROCESSES } from '@/lib/types';
import {
    getDailyWorkBooking,
    suggestDailyBooking,
    saveDailyWorkBooking,
    getAllAttendanceByMonth,
    recalcAllWorkLogSplits,
} from '@/lib/services';
import { useAuth } from '@/context/AuthContext';
import { SearchableSelect } from './SearchableSelect';
import AttendanceTab from '../tabs/AttendanceTab';
import ProcessTimelineModal from './ProcessTimelineModal';
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
    processes: string[];       // opcioni procesi (ne utiče na trošak)
}
interface BookingEntry {
    workerId: string;
    presence: number;          // prisutnost radnika za taj dan: 1 (cijeli) ili 0.5 (pola)
    items: BookingItem[];      // proizvodi na kojima je radio (dnevnica se ravnomjerno dijeli na njih)
}

interface BookableItem {
    id: string;
    productId: string;
    productName: string;
    projectName: string;
    workOrderId: string;
    workOrderNumber: string;
    processes: string[];
    isCustom?: boolean;
    linkedName?: string;     // naziv povezanog proizvoda (za custom zadatke)
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
const MONTHS_GEN = ['januar', 'februar', 'mart', 'april', 'maj', 'juni', 'juli', 'august', 'septembar', 'oktobar', 'novembar', 'decembar'];

const formatHuman = (iso: string) => {
    const d = new Date(iso + 'T00:00:00');
    return `${DAY_FULL[d.getDay()]}, ${d.getDate()}. ${MONTHS_GEN[d.getMonth()]}`;
};
const startOfWeek = (d: Date) => {
    const x = new Date(d);
    const day = x.getDay();
    x.setDate(x.getDate() - (day === 0 ? 6 : day - 1)); // Monday start
    x.setHours(0, 0, 0, 0);
    return x;
};
const km = (n: number) => Math.round(n).toLocaleString('bs-BA') + ' KM';
const km2 = (n: number) => (Math.round(n * 100) / 100).toLocaleString('bs-BA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' KM';
const daysLabel = (n: number) => n === 0.5 ? '½ dana' : `${Math.round(n * 100) / 100} ${n === 1 ? 'dan' : 'dana'}`;
const initialsOf = (name?: string) => (name || '?').split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase();

export default function DailyWorkBookingBoard({ workOrders, workers, workLogs, onRefresh, showToast }: DailyWorkBookingBoardProps) {
    const { organization } = useAuth();
    const orgId = organization?.Organization_ID || '';

    const [view, setView] = useState<'daily' | 'overview' | 'attendance'>('daily');

    // ── Daily state ─────────────────────────────────────────────────────────
    const [date, setDate] = useState<string>(toISO(new Date()));
    const [entries, setEntries] = useState<BookingEntry[]>([]);
    const [presentWorkerIds, setPresentWorkerIds] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [editing, setEditing] = useState(false);   // false = spremljeni dan zaključan (read-only)
    const [savedDays, setSavedDays] = useState(false); // da li dan već ima spremljene zapise
    const [recalcing, setRecalcing] = useState(false); // jednokratni preračun historije dnevnica
    const originalWorkerIdsRef = useRef<string[]>([]); // radnici učitani za dan (za brisanje uklonjenih)

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
                // Custom zadaci nemaju procese; generički 'Rad' se ne nudi kao tag (samo stvarne faze).
                const rawProcesses = item.Item_Type === 'custom'
                    ? []
                    : (item.Processes && item.Processes.length > 0)
                        ? item.Processes.map(p => p.Process_Name)
                        : (wo.Production_Steps || []);
                const processes = rawProcesses.filter(p => p && p !== 'Rad');
                list.push({
                    id: item.ID,
                    productId: item.Product_ID,
                    productName: item.Product_Name,
                    projectName: item.Project_Name,
                    workOrderId: wo.Work_Order_ID,
                    workOrderNumber: wo.Work_Order_Number,
                    processes,
                    isCustom: item.Item_Type === 'custom',
                    linkedName: item.Linked_Product_Name,
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
            label: i.isCustom ? `⚙ ${i.productName}` : i.productName,
            subLabel: i.isCustom
                ? (i.linkedName ? `Zadatak → ${i.linkedName}` : `Razni poslovi · Nalog ${i.workOrderNumber}`)
                : `${i.projectName} · Nalog ${i.workOrderNumber}`,
        })),
        [bookableItems]
    );

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

    // ── Load existing booking + present workers ──────────────────────────────
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
            setEntries(existing.map(e => ({
                workerId: e.workerId,
                presence: e.presence ?? 1,
                items: e.items.map(it => ({ workOrderItemId: it.workOrderItemId, processes: it.processes || [] })),
            })));
            originalWorkerIdsRef.current = existing.map(e => e.workerId);
            // Spremljeni dan → zaključan (read-only). Prazan dan → odmah u uređivanju.
            setSavedDays(existing.length > 0);
            setEditing(existing.length === 0);
        } catch (err) {
            console.error('loadDay error', err);
            showToast('Greška pri učitavanju knjige rada', 'error');
        } finally {
            setLoading(false);
        }
        // NAPOMENA: showToast NIJE u deps namjerno — on je nova funkcija svaki render parenta (app/page.tsx),
        // pa bi inače loadDay bio nestabilan i RE-UČITAVAO dan na svaki toast (gazi "Kao jučer" prijedlog
        // i lokalne izmjene). Učitavanje treba zavisiti samo od orgId/date.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [orgId, date]);

    useEffect(() => { if (view === 'daily') loadDay(); }, [loadDay, view]);

    // ── Mutations ─────────────────────────────────────────────────────────────
    const shiftDay = (delta: number) => {
        const d = new Date(date + 'T00:00:00');
        d.setDate(d.getDate() + delta);
        setDate(toISO(d));
    };
    const addWorkerEntry = (workerId: string) => {
        if (!workerId) return;
        setEntries(prev => prev.some(e => e.workerId === workerId) ? prev : [...prev, { workerId, presence: 1, items: [] }]);
    };
    const removeWorkerEntry = (workerId: string) => setEntries(prev => prev.filter(e => e.workerId !== workerId));
    const addItem = (workerId: string, itemId: string) => {
        if (!itemId) return;
        setEntries(prev => prev.map(e => {
            if (e.workerId !== workerId) return e;
            if (e.items.some(i => i.workOrderItemId === itemId)) return e;
            return { ...e, items: [...e.items, { workOrderItemId: itemId, processes: [] }] };
        }));
    };
    const setWorkerPresence = (workerId: string, presence: number) =>
        setEntries(prev => prev.map(e => e.workerId === workerId ? { ...e, presence } : e));
    const removeItem = (workerId: string, itemId: string) =>
        setEntries(prev => prev.map(e => e.workerId !== workerId ? e : { ...e, items: e.items.filter(i => i.workOrderItemId !== itemId) }));
    const addItemProcess = (workerId: string, itemId: string, proc: string) => {
        const v = proc.trim();
        if (!v) return;
        setEntries(prev => prev.map(e => e.workerId !== workerId ? e : {
            ...e, items: e.items.map(i => i.workOrderItemId === itemId
                ? { ...i, processes: i.processes.includes(v) ? i.processes : [...i.processes, v] } : i),
        }));
    };
    const removeItemProcess = (workerId: string, itemId: string, proc: string) =>
        setEntries(prev => prev.map(e => e.workerId !== workerId ? e : {
            ...e, items: e.items.map(i => i.workOrderItemId === itemId
                ? { ...i, processes: i.processes.filter(p => p !== proc) } : i),
        }));

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
                    presence: s.presence ?? 1,
                    items: s.items.map(it => ({ workOrderItemId: it.workOrderItemId, processes: it.processes || [] })),
                }));
                return Array.from(map.values());
            });
            showToast('Predložena raspodjela kao zadnji radni dan', 'success');
        } catch (err) { console.error(err); showToast('Greška pri prijedlogu', 'error'); }
        finally { setLoading(false); }
    };

    const handleSave = async () => {
        if (!orgId || saving) return;
        setSaving(true);
        try {
            const payload = entries.map(e => ({
                workerId: e.workerId,
                presence: e.presence ?? 1,
                items: e.items.filter(i => itemLookup.has(i.workOrderItemId)).map(i => ({
                    workOrderItemId: i.workOrderItemId, processes: i.processes,
                })),
            }));
            // Uklonjeni radnici (bili učitani, sad ih nema) → prazan unos da im se logovi tog dana obrišu
            const currentIds = new Set(entries.map(e => e.workerId));
            originalWorkerIdsRef.current.forEach(wid => {
                if (!currentIds.has(wid)) payload.push({ workerId: wid, presence: 1, items: [] });
            });
            const res = await saveDailyWorkBooking(date, orgId, payload);
            if (res.success) {
                showToast(res.message, 'success');
                onRefresh('workOrders', 'workLogs');
                // Zaključaj dan nakon spremanja (spriječi slučajno dupliranje)
                const stillHas = payload.some(p => p.items.length > 0);
                setSavedDays(stillHas);
                setEditing(!stillHas);
            }
            else showToast(res.message, 'error');
        } catch (err) { console.error(err); showToast('Greška pri spremanju', 'error'); }
        finally { setSaving(false); }
    };

    const cancelEdit = () => { loadDay(); };

    // Jednokratni preračun: uskladi sve postojeće dnevnice s kanonskim (ravnomjernim) modelom.
    const handleRecalcAll = async () => {
        if (!orgId || recalcing) return;
        if (!window.confirm('Preračunati SVE postojeće dnevnice po novom modelu (ravnomjerna podjela dnevnice na proizvode)?\n\nOvo ažurira historijske zapise rada i timeline svih naloga. Može potrajati.')) return;
        setRecalcing(true);
        try {
            const res = await recalcAllWorkLogSplits(orgId);
            showToast(res.message, res.success ? 'success' : 'error');
            if (res.success) onRefresh('workOrders', 'workLogs');
        } catch (err) {
            console.error('recalcAll error', err);
            showToast('Greška pri preračunu dnevnica', 'error');
        } finally {
            setRecalcing(false);
        }
    };

    // ── Daily derived ───────────────────────────────────────────────────────
    const dayTotals = useMemo(() => {
        let amount = 0, days = 0;
        entries.forEach(e => {
            if (e.items.length === 0) return;            // radnik bez proizvoda ne troši dnevnicu
            const rate = workerLookup.get(e.workerId)?.Daily_Rate || 0;
            const presence = e.presence ?? 1;
            amount += rate * presence;                  // cijela dnevnica (× presence) — podijeljena na proizvode
            days += presence;
        });
        return { amount, days };
    }, [entries, workerLookup]);

    const isToday = date === toISO(new Date());

    const quickAddWorkers = useMemo(() =>
        workers.filter(w =>
            (presentWorkerIds.has(w.Worker_ID) || relevantWorkerIds.has(w.Worker_ID)) &&
            !entries.some(e => e.workerId === w.Worker_ID)
        ), [presentWorkerIds, relevantWorkerIds, workers, entries]);

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
        return { totalCost, totalDays, recordedDays: recordedDates.size, avgRate: totalDays > 0 ? totalCost / totalDays : 0 };
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
        const m = new Map<string, { itemId: string; name: string; sub: string; days: number; cost: number }>();
        periodLogs.forEach(l => {
            const meta = itemMetaAll.get(l.Work_Order_Item_ID);
            const cur = m.get(l.Work_Order_Item_ID) || { itemId: l.Work_Order_Item_ID, name: meta?.product || 'Nepoznat proizvod', sub: meta ? `${meta.project} · Nalog ${meta.woNumber}` : '', days: 0, cost: 0 };
            cur.days += l.Day_Fraction ?? 1; cur.cost += l.Daily_Rate || 0;
            m.set(l.Work_Order_Item_ID, cur);
        });
        return Array.from(m.values()).sort((a, b) => b.cost - a.cost);
    }, [periodLogs, itemMetaAll]);

    // Modal hronologije procesa (klik na proizvod u statistici)
    const [procProduct, setProcProduct] = useState<{ name: string; logs: WorkLog[] } | null>(null);
    const openProcessTimeline = (itemId: string, name: string) => {
        setProcProduct({ name, logs: workLogs.filter(l => l.Work_Order_Item_ID === itemId) });
    };

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
        <div className="dwb" style={view === 'attendance' ? { maxWidth: 'none' } : undefined}>
            <div className="dwb-tabs">
                <button className={view === 'daily' ? 'active' : ''} onClick={() => setView('daily')}>
                    <NotebookPen size={15} /> Knjiga rada
                </button>
                <button className={view === 'overview' ? 'active' : ''} onClick={() => setView('overview')}>
                    <BarChart3 size={15} /> Statistika
                </button>
                <button className={view === 'attendance' ? 'active' : ''} onClick={() => setView('attendance')}>
                    <CalendarDays size={15} /> Šihtarica
                </button>
            </div>

            {view === 'attendance' ? (
                <AttendanceTab workers={workers} onRefresh={onRefresh} showToast={showToast} />
            ) : view === 'daily' ? (
                <>
                    {/* Header bar */}
                    <div className="dwb-bar">
                        <div className="dwb-bar-left">
                            <button className="dwb-nav" onClick={() => shiftDay(-1)} aria-label="Prethodni dan"><ChevronLeft size={18} /></button>
                            <button className="dwb-nav" onClick={() => shiftDay(1)} aria-label="Sljedeći dan"><ChevronRight size={18} /></button>
                            <div className="dwb-bar-title">
                                <div className="dwb-bar-date">
                                    {formatHuman(date)}
                                    {isToday && <span className="dwb-today">danas</span>}
                                    <input className="dwb-date-input" type="date" value={date} onChange={e => e.target.value && setDate(e.target.value)} aria-label="Izaberi datum" />
                                </div>
                                <div className="dwb-bar-sub">
                                    {savedDays && !editing
                                        ? <span className="dwb-saved-badge"><CheckCircle size={13} /> Spremljeno</span>
                                        : <>{entries.length} radnik(a) · {km(dayTotals.amount)} raspoređeno</>}
                                </div>
                            </div>
                        </div>
                        <div className="dwb-bar-actions">
                            {editing ? (
                                <>
                                    {savedDays && (
                                        <button className="dwb-btn" onClick={cancelEdit} disabled={loading || saving}>Odustani</button>
                                    )}
                                    <button className="dwb-btn" onClick={handleSuggest} disabled={loading || saving}><History size={15} /> Kao jučer</button>
                                    <button className="dwb-btn dwb-btn-dark" onClick={handleSave} disabled={loading || saving}>
                                        {saving ? <Loader2 size={15} className="dwb-spin" /> : <Save size={15} />} Spremi
                                    </button>
                                </>
                            ) : (
                                <button className="dwb-btn dwb-btn-dark" onClick={() => setEditing(true)} disabled={loading}>
                                    <Edit2 size={15} /> Uredi
                                </button>
                            )}
                        </div>
                    </div>

                    {loading && <div className="dwb-loading"><Loader2 size={16} className="dwb-spin" /> Učitavam…</div>}

                    {entries.length === 0 && !loading ? (
                        <div className="dwb-empty">
                            <NotebookPen size={26} />
                            <p>Knjiga rada za ovaj dan je prazna.</p>
                            <p className="dwb-empty-hint">Dodaj radnike koji su radili — prečicama ili pretragom ispod.</p>
                        </div>
                    ) : entries.length > 0 && (
                        <div className="dwb-cards-container">
                            {entries.map(entry => {
                                const worker = workerLookup.get(entry.workerId);
                                const rate = worker?.Daily_Rate || 0;
                                const presence = entry.presence ?? 1;
                                const itemCount = entry.items.length;
                                const perItemAmount = itemCount > 0 ? Math.round((rate * presence / itemCount) * 100) / 100 : 0;
                                return (
                                    <div className="dwb-card" key={entry.workerId}>
                                        <div className="dwb-card-header">
                                            <div className="dwb-card-worker">
                                                <div className={`dwb-ava ${worker?.Worker_Type === 'Pomoćnik' ? 'helper' : ''}`}>{initialsOf(worker?.Name)}</div>
                                                <div className="dwb-card-wname">
                                                    <span className="dwb-wname-text">{worker?.Name || 'Nepoznat radnik'}</span>
                                                    <span className="dwb-wname-rate">{rate} KM/dan</span>
                                                </div>
                                            </div>
                                            <div className="dwb-card-actions">
                                                {editing ? (
                                                    <div className="dwb-frac-modern" title="Prisutnost radnika za ovaj dan (cijela / pola dnevnice)">
                                                        <button className={presence === 1 ? 'active' : ''} onClick={() => setWorkerPresence(entry.workerId, 1)}>1</button>
                                                        <button className={presence === 0.5 ? 'active' : ''} onClick={() => setWorkerPresence(entry.workerId, 0.5)}>½</button>
                                                    </div>
                                                ) : (
                                                    <div className="dwb-card-total full">{daysLabel(presence)}</div>
                                                )}
                                                {editing && (
                                                    <button className="dwb-x-subtle dwb-x-worker" onClick={() => removeWorkerEntry(entry.workerId)} aria-label="Ukloni radnika"><X size={16} /></button>
                                                )}
                                            </div>
                                        </div>

                                        <div className="dwb-card-body">
                                            {entry.items.map(item => {
                                                const meta = itemLookup.get(item.workOrderItemId);
                                                return (
                                                    <div className="dwb-item-row" key={item.workOrderItemId}>
                                                        <div className="dwb-item-main">
                                                            <div className="dwb-item-name">{meta?.productName || 'Proizvod nije aktivan'}</div>
                                                            <div className="dwb-item-sub">
                                                                <span className="dwb-item-wo">Nalog {meta?.workOrderNumber || ''}</span>
                                                            </div>
                                                            <div className="dwb-proc-tags">
                                                                {item.processes.map(p => (
                                                                    <span className="dwb-proc-chip" key={p}>
                                                                        {p}
                                                                        {editing && <button onClick={() => removeItemProcess(entry.workerId, item.workOrderItemId, p)} aria-label="Ukloni proces"><X size={10} /></button>}
                                                                    </span>
                                                                ))}
                                                                {editing && (
                                                                    <input className="dwb-proc-add" list="dwb-common-processes" placeholder="+ proces"
                                                                        onKeyDown={e => {
                                                                            if (e.key === 'Enter') {
                                                                                const el = e.target as HTMLInputElement;
                                                                                addItemProcess(entry.workerId, item.workOrderItemId, el.value);
                                                                                el.value = '';
                                                                            }
                                                                        }} />
                                                                )}
                                                            </div>
                                                        </div>
                                                        <div className="dwb-item-controls">
                                                            <div className="dwb-item-amount">{km2(perItemAmount)}</div>
                                                            {editing && (
                                                                <button className="dwb-x-subtle dwb-item-remove" onClick={() => removeItem(entry.workerId, item.workOrderItemId)} aria-label="Ukloni"><X size={15} /></button>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            })}

                                            {editing && (
                                                <div className="dwb-item-add">
                                                    <SearchableSelect
                                                        options={productOptions.filter(o => !entry.items.some(i => i.workOrderItemId === o.value))}
                                                        value="" onChange={v => addItem(entry.workerId, v)} placeholder="+ dodaj proizvod…"
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Add worker + quick pills */}
                    {editing && availableWorkerOptions.length > 0 && (
                        <div className="dwb-addrow">
                            <div className="dwb-addrow-select">
                                <UserPlus size={15} />
                                <SearchableSelect options={availableWorkerOptions} value="" onChange={addWorkerEntry} placeholder="Dodaj radnika…" />
                            </div>
                            {quickAddWorkers.length > 0 && (
                                <div className="dwb-pills">
                                    {quickAddWorkers.slice(0, 6).map(w => (
                                        <button key={w.Worker_ID} className="dwb-pill" onClick={() => addWorkerEntry(w.Worker_ID)}>
                                            <Plus size={12} /> {w.Name}
                                            {presentWorkerIds.has(w.Worker_ID) && <span className="dwb-pill-dot" title="Prisutan u šihtarici" />}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {dayTotals.days > 0 && (
                        <div className="dwb-summary">
                            <span className="dwb-summary-label">Ukupno danas</span>
                            <span className="dwb-summary-val"><span className="muted">{daysLabel(dayTotals.days)}</span> · <strong>{km(dayTotals.amount)}</strong></span>
                        </div>
                    )}

                    <datalist id="dwb-common-processes">
                        {COMMON_PROCESSES.map(cp => <option key={cp} value={cp} />)}
                    </datalist>
                </>
            ) : (
                /* ── OVERVIEW ─────────────────────────────────────────────── */
                <>
                    <div className="dwb-bar">
                        <div className="dwb-bar-left">
                            <button className="dwb-nav" onClick={() => shiftPeriod(-1)} aria-label="Prethodni period"><ChevronLeft size={18} /></button>
                            <button className="dwb-nav" onClick={() => shiftPeriod(1)} aria-label="Sljedeći period"><ChevronRight size={18} /></button>
                            <div className="dwb-bar-title">
                                <div className="dwb-bar-date">{period.label}</div>
                                <div className="dwb-bar-sub">{stats.recordedDays} evidentiran(ih) dana</div>
                            </div>
                        </div>
                        <div className="dwb-segmented">
                            <button className={periodMode === 'week' ? 'active' : ''} onClick={() => setPeriodMode('week')}>Sedmica</button>
                            <button className={periodMode === 'month' ? 'active' : ''} onClick={() => setPeriodMode('month')}>Mjesec</button>
                        </div>
                    </div>

                    <div className="dwb-metrics">
                        <div className="dwb-metric"><span className="dwb-metric-label">Trošak rada</span><span className="dwb-metric-value">{km(stats.totalCost)}</span></div>
                        <div className="dwb-metric"><span className="dwb-metric-label">Radnih dana</span><span className="dwb-metric-value">{Math.round(stats.totalDays * 100) / 100}</span></div>
                        <div className="dwb-metric"><span className="dwb-metric-label">Evidentiranih dana</span><span className="dwb-metric-value">{stats.recordedDays}</span></div>
                        <div className="dwb-metric"><span className="dwb-metric-label">Prosj. dnevnica</span><span className="dwb-metric-value">{km(stats.avgRate)}</span></div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '10px 14px', margin: '4px 0 8px', background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: 10 }}>
                        <span style={{ fontSize: 12, color: '#64748b' }}>
                            Stari zapisi izgledaju nedosljedno? Preračunaj sve dnevnice po novom modelu (ravnomjerna podjela na proizvode).
                        </span>
                        <button className="dwb-btn" onClick={handleRecalcAll} disabled={recalcing} style={{ whiteSpace: 'nowrap' }}>
                            {recalcing ? <Loader2 size={14} className="dwb-spin" /> : <History size={14} />} Preračunaj sve dnevnice
                        </button>
                    </div>

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
                                <div className="dwb-book-title"><Package size={15} /> Po proizvodu <span className="dwb-book-hint">klik za procese</span></div>
                                {byProduct.map((p, i) => (
                                    <button className="dwb-book-row dwb-book-row-btn" key={i} onClick={() => openProcessTimeline(p.itemId, p.name)}>
                                        <span className="dwb-book-name">{p.name}<span className="dwb-book-sub">{p.sub}</span></span>
                                        <span className="dwb-book-days">{daysLabel(p.days)}</span>
                                        <span className="dwb-book-amount">{km(p.cost)}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </>
            )}

            {procProduct && (
                <ProcessTimelineModal
                    isOpen={true}
                    onClose={() => setProcProduct(null)}
                    productName={procProduct.name}
                    logs={procProduct.logs}
                />
            )}
        </div>
    );
}
