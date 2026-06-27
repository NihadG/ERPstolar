'use client';

import { useState, useMemo, useCallback } from 'react';
import {
    Plus, X, Save, Loader2, Users, Pause, Coffee, Sun, Minus, Clock,
    CalendarRange, CalendarPlus, UserPlus, Check,
} from 'lucide-react';
import type { WorkOrder, WorkOrderItem, Worker, WorkLog } from '@/lib/types';
import { buildWorkTimeline, summarizeWorkTimeline, type TimelineLog, type WorkDayType } from '@/lib/workOrderTimeline';
import { splitDnevnica } from '@/lib/laborSplit';
import { saveWorkOrderDayBooking, bulkBookWorkOrderLabor } from '@/lib/services';
import { SearchableSelect } from './SearchableSelect';
import './WorkOrderWorkLog.css';

interface WorkOrderWorkLogProps {
    workOrder: WorkOrder;
    items: WorkOrderItem[];        // proizvodi naloga (uklj. završene/pauzirane — sve se može knjižiti)
    workLogs: WorkLog[];           // logovi OVOG naloga
    workers: Worker[];
    organizationId: string;
    holidays?: Set<string>;
    onReload: () => void;          // re-fetch logova naloga + refresh
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

const toISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const km = (n: number) => Math.round(n).toLocaleString('bs-BA') + ' KM';
const km2 = (n: number) => (Math.round(n * 100) / 100).toLocaleString('bs-BA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' KM';
const DOW = ['Ned', 'Pon', 'Uto', 'Sri', 'Čet', 'Pet', 'Sub'];
const MON = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'avg', 'sep', 'okt', 'nov', 'dec'];
const human = (iso: string) => { const d = new Date(iso + 'T12:00:00'); return `${DOW[d.getDay()]} ${d.getDate()}. ${MON[d.getMonth()]}`; };
const initials = (name?: string) => (name || '?').split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase();

const DAY_META: Record<WorkDayType, { label: string; cls: string; Icon: typeof Users }> = {
    working: { label: 'Rad', cls: 'wwl-d-working', Icon: Users },
    paused: { label: 'Pauza', cls: 'wwl-d-paused', Icon: Pause },
    weekend: { label: 'Vikend', cls: 'wwl-d-weekend', Icon: Coffee },
    holiday: { label: 'Praznik', cls: 'wwl-d-holiday', Icon: Sun },
    no_work: { label: 'Bez rada', cls: 'wwl-d-nowork', Icon: Minus },
    future: { label: 'Budući', cls: 'wwl-d-future', Icon: Clock },
};

interface DraftWorker { presence: number; itemIds: Set<string>; }

export default function WorkOrderWorkLog({
    workOrder, items, workLogs, workers, organizationId, holidays, onReload, showToast,
}: WorkOrderWorkLogProps) {
    const workerById = useMemo(() => new Map(workers.map(w => [w.Worker_ID, w])), [workers]);
    const allItemIds = useMemo(() => items.map(i => i.ID), [items]);
    const todayISO = toISO(new Date());

    // Zadana ekipa = dodijeljeni radnici naloga; fallback = zadnja proknjižena ekipa.
    const assignedWorkerIds = useMemo(() => {
        const s = new Set<string>();
        items.forEach(it => {
            (it.Assigned_Workers || []).forEach(w => w.Worker_ID && s.add(w.Worker_ID));
            (it.Processes || []).forEach(p => { const wid = (p as { Worker_ID?: string }).Worker_ID; if (wid) s.add(wid); });
        });
        if (s.size === 0 && workLogs.length > 0) {
            const lastDate = [...workLogs].map(l => l.Date).sort().slice(-1)[0];
            workLogs.filter(l => l.Date === lastDate).forEach(l => s.add(l.Worker_ID));
        }
        return s;
    }, [items, workLogs]);

    const pausePeriods = useMemo(() => {
        const ps: { Started_At: string; Ended_At?: string }[] = [];
        items.forEach(it => {
            (it.Pause_Periods || []).forEach(p => ps.push(p));
            (it.SubTasks || []).forEach(st => (st.Pause_Periods || []).forEach(p => ps.push(p)));
        });
        return ps;
    }, [items]);

    const [extraDates, setExtraDates] = useState<Set<string>>(new Set());

    const timelineLogs = useMemo<TimelineLog[]>(() => workLogs.map(l => ({
        Date: l.Date, Worker_ID: l.Worker_ID, Worker_Name: l.Worker_Name, Daily_Rate: l.Daily_Rate || 0,
        Product_ID: l.Product_ID, Work_Order_Item_ID: l.Work_Order_Item_ID,
    })), [workLogs]);

    const timeline = useMemo(() => buildWorkTimeline({
        logs: timelineLogs,
        startedAt: workOrder.Started_At, completedAt: workOrder.Completed_At,
        createdDate: workOrder.Created_Date, holidays, pausePeriods, extraDates,
    }), [timelineLogs, workOrder.Started_At, workOrder.Completed_At, workOrder.Created_Date, holidays, pausePeriods, extraDates]);

    const summary = useMemo(() => summarizeWorkTimeline(timeline), [timeline]);
    const daysDesc = useMemo(() => [...timeline].reverse(), [timeline]);   // najnoviji prvi

    // ── Editor po danu ──────────────────────────────────────────────────
    const [editDate, setEditDate] = useState<string | null>(null);
    const [draft, setDraft] = useState<Map<string, DraftWorker>>(new Map());
    const [saving, setSaving] = useState(false);

    const openEditor = useCallback((date: string) => {
        const m = new Map<string, DraftWorker>();
        workLogs.filter(l => l.Date === date).forEach(l => {
            const cur = m.get(l.Worker_ID) || { presence: l.Presence === 0.5 ? 0.5 : 1, itemIds: new Set<string>() };
            cur.presence = l.Presence === 0.5 ? 0.5 : 1;
            if (l.Work_Order_Item_ID) cur.itemIds.add(l.Work_Order_Item_ID);
            m.set(l.Worker_ID, cur);
        });
        setDraft(m);
        setEditDate(date);
    }, [workLogs]);

    const closeEditor = () => { setEditDate(null); setDraft(new Map()); };

    const mutateDraft = (fn: (m: Map<string, DraftWorker>) => void) =>
        setDraft(prev => {
            const m = new Map(Array.from(prev, ([k, v]) => [k, { presence: v.presence, itemIds: new Set(v.itemIds) }] as [string, DraftWorker]));
            fn(m);
            return m;
        });

    const addCrew = () => mutateDraft(m => { assignedWorkerIds.forEach(wid => { if (!m.has(wid)) m.set(wid, { presence: 1, itemIds: new Set(allItemIds) }); }); });
    const addWorker = (wid: string) => mutateDraft(m => { if (wid && !m.has(wid)) m.set(wid, { presence: 1, itemIds: new Set(allItemIds) }); });
    const removeWorker = (wid: string) => mutateDraft(m => { m.delete(wid); });
    const setPresence = (wid: string, p: number) => mutateDraft(m => { const w = m.get(wid); if (w) w.presence = p; });
    const toggleItem = (wid: string, itemId: string) => mutateDraft(m => { const w = m.get(wid); if (!w) return; w.itemIds.has(itemId) ? w.itemIds.delete(itemId) : w.itemIds.add(itemId); });
    const setAllItems = (wid: string, all: boolean) => mutateDraft(m => { const w = m.get(wid); if (!w) return; w.itemIds = all ? new Set(allItemIds) : new Set(); });

    const availableWorkerOptions = useMemo(
        () => workers.filter(w => !draft.has(w.Worker_ID)).map(w => ({ value: w.Worker_ID, label: w.Name, subLabel: `${w.Daily_Rate || 0} KM` })),
        [workers, draft]
    );

    const saveDay = async () => {
        if (!editDate || saving) return;
        setSaving(true);
        try {
            const entries = Array.from(draft.entries())
                .map(([workerId, v]) => ({ workerId, presence: v.presence, itemIds: Array.from(v.itemIds) }))
                .filter(e => e.itemIds.length > 0);
            const res = await saveWorkOrderDayBooking(workOrder.Work_Order_ID, editDate, organizationId, entries);
            if (res.success) { showToast(res.message, 'success'); onReload(); closeEditor(); }
            else showToast(res.message, 'error');
        } catch (e) { console.error(e); showToast('Greška pri spremanju', 'error'); }
        finally { setSaving(false); }
    };

    // ── Dodaj dan (zaboravljeni raniji / budući) ────────────────────────
    const [newDay, setNewDay] = useState('');
    const addDay = () => {
        if (!newDay) return;
        setExtraDates(prev => new Set(prev).add(newDay));
        openEditor(newDay);
        setNewDay('');
    };

    // ── Popuni raspon (ufoldovan bulk) ──────────────────────────────────
    const [rangeOpen, setRangeOpen] = useState(false);
    const [rFrom, setRFrom] = useState(workOrder.Started_At ? workOrder.Started_At.split('T')[0] : todayISO);
    const [rTo, setRTo] = useState(todayISO);
    const [rSkipWeekends, setRSkipWeekends] = useState(true);
    const [rSaving, setRSaving] = useState(false);
    const runRangeFill = async () => {
        if (rSaving) return;
        const crew = Array.from(assignedWorkerIds);
        if (crew.length === 0) { showToast('Nalog nema zadane radnike — dodaj ih po danu', 'info'); return; }
        setRSaving(true);
        try {
            const res = await bulkBookWorkOrderLabor(workOrder.Work_Order_ID, crew, allItemIds, rFrom, rTo, rSkipWeekends, organizationId);
            if (res.success) { showToast(res.message, 'success'); onReload(); setRangeOpen(false); }
            else showToast(res.message, 'error');
        } catch (e) { console.error(e); showToast('Greška pri popunjavanju', 'error'); }
        finally { setRSaving(false); }
    };

    const dayWorkers = (logs: TimelineLog[]) => {
        const m = new Map<string, { name: string; cost: number }>();
        logs.forEach(l => { const c = m.get(l.Worker_ID) || { name: l.Worker_Name, cost: 0 }; c.cost += l.Daily_Rate || 0; m.set(l.Worker_ID, c); });
        return Array.from(m.values());
    };

    const woCompleted = workOrder.Status === 'Završeno';

    return (
        <div className="wwl">
            <div className="wwl-head">
                <div className="wwl-head-stats">
                    <span><b>{summary.workingDays}</b> radnih dana</span>
                    {summary.pausedDays > 0 && <span><b>{summary.pausedDays}</b> pauza</span>}
                    <span>Rad: <b>{km(summary.totalLaborCost)}</b></span>
                </div>
                <div className="wwl-head-actions">
                    <div className="wwl-addday">
                        <input type="date" value={newDay} onChange={e => setNewDay(e.target.value)} aria-label="Dodaj dan" />
                        <button className="wwl-btn" disabled={!newDay} onClick={addDay}><CalendarPlus size={14} /> Dodaj dan</button>
                    </div>
                    <button className="wwl-btn" onClick={() => setRangeOpen(v => !v)}><CalendarRange size={14} /> Popuni raspon</button>
                </div>
            </div>

            {rangeOpen && (
                <div className="wwl-range">
                    <label>Od <input type="date" value={rFrom} onChange={e => setRFrom(e.target.value)} /></label>
                    <label>Do <input type="date" value={rTo} onChange={e => setRTo(e.target.value)} /></label>
                    <label className="wwl-check"><input type="checkbox" checked={rSkipWeekends} onChange={e => setRSkipWeekends(e.target.checked)} /> Preskoči vikende</label>
                    <span className="wwl-range-hint">Zadana ekipa na sve proizvode; preskače dane s postojećim unosom.</span>
                    <button className="wwl-btn wwl-btn-primary" disabled={rSaving} onClick={runRangeFill}>
                        {rSaving ? <Loader2 size={14} className="wwl-spin" /> : <Check size={14} />} Popuni
                    </button>
                </div>
            )}

            <div className="wwl-days">
                {daysDesc.map(day => {
                    const meta = DAY_META[day.dayType];
                    const { Icon } = meta;
                    const isEditing = editDate === day.date;
                    const isToday = day.date === todayISO;

                    if (isEditing) {
                        const showBookHint = day.dayType === 'paused' || day.dayType === 'weekend' || day.dayType === 'holiday' || day.dayType === 'future' || woCompleted;
                        return (
                            <div key={day.date} className="wwl-day wwl-editing">
                                <div className="wwl-day-row">
                                    <span className={`wwl-badge ${meta.cls}`}><Icon size={12} /> {meta.label}</span>
                                    <span className="wwl-date">{human(day.date)}{isToday && <em> · danas</em>}</span>
                                    <button className="wwl-x" onClick={closeEditor} aria-label="Zatvori"><X size={16} /></button>
                                </div>

                                {showBookHint && (
                                    <div className="wwl-hint">Knjiženje rada na ovaj dan je dozvoljeno{woCompleted ? ' (nalog je završen)' : ''}.</div>
                                )}

                                <div className="wwl-editor">
                                    {draft.size === 0 && <div className="wwl-empty">Dodaj radnike koji su radili na ovom nalogu taj dan.</div>}

                                    {Array.from(draft.entries()).map(([wid, w]) => {
                                        const worker = workerById.get(wid);
                                        const rate = worker?.Daily_Rate || 0;
                                        const k = w.itemIds.size;
                                        const perItem = k > 0 ? splitDnevnica(rate, w.presence, k) : 0;
                                        const allSel = k === items.length;
                                        return (
                                            <div className="wwl-wrow" key={wid}>
                                                <div className="wwl-wrow-top">
                                                    <span className="wwl-ava">{initials(worker?.Name)}</span>
                                                    <span className="wwl-wname">{worker?.Name || 'Radnik'}</span>
                                                    <div className="wwl-frac" title="Cijeli ili pola dana">
                                                        <button className={w.presence === 1 ? 'on' : ''} onClick={() => setPresence(wid, 1)}>1</button>
                                                        <button className={w.presence === 0.5 ? 'on' : ''} onClick={() => setPresence(wid, 0.5)}>½</button>
                                                    </div>
                                                    <span className="wwl-wsum">{k > 0 ? `${km2(rate * w.presence)} ÷ ${k} = ${km2(perItem)}/kom` : 'odaberi proizvod'}</span>
                                                    <button className="wwl-x sm" onClick={() => removeWorker(wid)} aria-label="Ukloni radnika"><X size={14} /></button>
                                                </div>
                                                <div className="wwl-items">
                                                    <button className="wwl-all" onClick={() => setAllItems(wid, !allSel)}>{allSel ? 'Poništi' : 'Svi'}</button>
                                                    {items.map(it => (
                                                        <button key={it.ID} className={`wwl-item ${w.itemIds.has(it.ID) ? 'on' : ''}`} onClick={() => toggleItem(wid, it.ID)}>
                                                            {w.itemIds.has(it.ID) && <Check size={11} />} {it.Product_Name}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    })}

                                    <div className="wwl-editor-actions">
                                        <button className="wwl-btn sm" onClick={addCrew}><Users size={13} /> Zadati radnici</button>
                                        <div className="wwl-addworker"><UserPlus size={14} /><SearchableSelect options={availableWorkerOptions} value="" onChange={addWorker} placeholder="Dodaj radnika…" /></div>
                                        <div className="wwl-save">
                                            <button className="wwl-btn" onClick={closeEditor} disabled={saving}>Odustani</button>
                                            <button className="wwl-btn wwl-btn-primary" onClick={saveDay} disabled={saving}>
                                                {saving ? <Loader2 size={14} className="wwl-spin" /> : <Save size={14} />} Spremi dan
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    }

                    const ws = dayWorkers(day.logs);
                    return (
                        <button key={day.date} className={`wwl-day wwl-day-btn ${day.dayType === 'future' ? 'is-future' : ''}`} onClick={() => openEditor(day.date)}>
                            <span className={`wwl-badge ${meta.cls}`}><Icon size={12} /> {meta.label}</span>
                            <span className="wwl-date">{human(day.date)}{isToday && <em> · danas</em>}</span>
                            <span className="wwl-day-info">
                                {ws.length > 0
                                    ? <><span className="wwl-day-workers">{ws.map(w => w.name).join(', ')}</span><span className="wwl-day-cost">{km(day.dailyLaborCost)}</span></>
                                    : <span className="wwl-day-add"><Plus size={13} /> dodaj rad</span>}
                            </span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
