'use client';

// ════════════════════════════════════════════════════════════════════
// KNJIGA RADA — telefon
//
// Odgovara na jedno pitanje: KO JE RADIO NA OVOM NALOGU, KOJI DAN. Desktop
// `WorkOrderWorkLog` uz to nudi i uređivanje cijelog dana odjednom, raspone i
// iznose po komadu; ovdje ostaje ono što se u pogonu stvarno radi — dopisati
// zaboravljenog radnika i skinuti pogrešnog.
//
// Iznosi se prikazuju samo kad ih server pošalje (`canSeeMoney`): vlasnik ih
// vidi, kontrolor ne. Ekran ne odlučuje o tome — samo poštuje šta je dobio.
// ════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarPlus, Plus, X } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/apiClient';
import type { FieldWorkLogDay, FieldWorkLogPayload } from '@/lib/field/fieldWorkLog';
import type { FieldWorkerRow } from '@/lib/field/fieldAttendance';
import { MEmpty, MButton, MSheet } from '@/components/tabs/mobile/MobileUI';

const DOW = ['Ned', 'Pon', 'Uto', 'Sri', 'Čet', 'Pet', 'Sub'];
const MON = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'avg', 'sep', 'okt', 'nov', 'dec'];

const human = (iso: string) => {
    const d = new Date(iso + 'T12:00:00');
    return `${DOW[d.getDay()]} ${d.getDate()}. ${MON[d.getMonth()]}`;
};

const km = (n: number) => `${Math.round(n).toLocaleString('bs-BA')} KM`;

const initials = (name: string) =>
    name.split(' ').filter(Boolean).map(p => p[0]).join('').toUpperCase().slice(0, 2) || '?';

const DAY_LABEL: Record<string, string> = {
    working: 'Rad', paused: 'Pauza', weekend: 'Vikend',
    holiday: 'Praznik', no_work: 'Bez rada', future: 'Budući',
};

interface Props {
    orderId: string;
    readOnly?: boolean;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
    /**
     * Upis je prošao. Panel se osvježava sam, ali kad je ugniježđen u glavnu
     * aplikaciju (vlasnikov detalj naloga) njeno stanje se puni klijentskim
     * SDK-om i o ovom upisu ne zna ništa — trošak rada na kartici bi ostao star.
     */
    onChanged?: () => void;
}

export default function WorkLogPanel({ orderId, readOnly, showToast, onChanged }: Props) {
    const [data, setData] = useState<FieldWorkLogPayload | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [workers, setWorkers] = useState<FieldWorkerRow[]>([]);

    const [editDate, setEditDate] = useState<string | null>(null);
    const [pick, setPick] = useState<Set<string>>(new Set());
    const [pickItems, setPickItems] = useState<Set<string>>(new Set());
    const [presence, setPresence] = useState<0.5 | 1>(1);
    const [busy, setBusy] = useState(false);
    const [newDay, setNewDay] = useState('');
    const [extraDays, setExtraDays] = useState<string[]>([]);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            setData(await apiGet<FieldWorkLogPayload>(`/api/field/work-orders/${orderId}/worklog`));
        } catch (e: any) {
            setError(e?.message || 'Knjiga rada nije učitana.');
        } finally {
            setLoading(false);
        }
    }, [orderId]);

    useEffect(() => { void load(); }, [load]);

    useEffect(() => {
        if (readOnly) return;
        apiGet<{ workers: FieldWorkerRow[] }>('/api/field/workers')
            .then(res => setWorkers(res.workers || []))
            .catch(() => { /* lista radnika je potrebna tek pri dopisivanju */ });
    }, [readOnly]);

    /** Dani sa servera + oni koje je korisnik ručno dodao (a nemaju još zapisa). */
    const days = useMemo<FieldWorkLogDay[]>(() => {
        const known = new Set((data?.days || []).map(d => d.date));
        const extras: FieldWorkLogDay[] = extraDays
            .filter(d => !known.has(d))
            .map(date => ({ date, dayType: 'no_work', workers: [] }));
        return [...extras, ...(data?.days || [])].sort((a, b) => b.date.localeCompare(a.date));
    }, [data, extraDays]);

    const openDay = (day: FieldWorkLogDay) => {
        if (readOnly) return;
        setEditDate(day.date);
        // Prijedlog: ko je već na tom danu, inače zadana ekipa naloga.
        const existing = day.workers.map(w => w.workerId);
        setPick(new Set(existing.length > 0 ? [] : (data?.crew || []).map(c => c.workerId)));
        setPresence(day.workers[0]?.presence === 0.5 ? 0.5 : 1);
        setPickItems(new Set());
    };

    const closeDay = () => { setEditDate(null); setPick(new Set()); setPickItems(new Set()); };

    const editing = editDate ? days.find(d => d.date === editDate) : undefined;

    const addCrew = async () => {
        if (!editDate || busy || pick.size === 0) return;
        setBusy(true);
        try {
            const res = await apiPost<{ created: number; message: string }>(
                `/api/field/work-orders/${orderId}/worklog`,
                { action: 'add', date: editDate, workerIds: Array.from(pick), itemIds: Array.from(pickItems), presence }
            );
            showToast(res.message, res.created > 0 ? 'success' : 'info');
            await load();
            if (res.created > 0) onChanged?.();
            closeDay();
        } catch (e: any) {
            showToast(e?.message || 'Upis nije uspio', 'error');
        } finally {
            setBusy(false);
        }
    };

    const removeWorker = async (workerId: string) => {
        if (!editDate || busy) return;
        setBusy(true);
        try {
            const res = await apiPost<{ removed: number; message: string }>(
                `/api/field/work-orders/${orderId}/worklog`,
                { action: 'remove', date: editDate, workerId }
            );
            showToast(res.message, res.removed > 0 ? 'success' : 'info');
            await load();
            if (res.removed > 0) onChanged?.();
        } catch (e: any) {
            showToast(e?.message || 'Brisanje nije uspjelo', 'error');
        } finally {
            setBusy(false);
        }
    };

    const alreadyOn = new Set((editing?.workers || []).map(w => w.workerId));
    const addable = workers.filter(w => !alreadyOn.has(w.workerId));

    if (loading && !data) return <div className="fld-loading">Učitavanje…</div>;

    if (error) {
        return (
            <MEmpty title="Knjiga rada nije učitana" sub={error}>
                <div style={{ width: '100%', paddingTop: 14 }}>
                    <MButton variant="filled" onClick={() => void load()}>Pokušaj ponovo</MButton>
                </div>
            </MEmpty>
        );
    }

    return (
        <>
            <div className="fwl-head">
                <span><b>{data?.workingDays || 0}</b> radnih dana</span>
                {data?.canSeeMoney && data.totalCost != null && <span>Rad: <b>{km(data.totalCost)}</b></span>}
            </div>

            {!readOnly && (
                <div className="fwl-addday">
                    <input
                        type="date"
                        value={newDay}
                        max={data?.today}
                        onChange={e => setNewDay(e.target.value)}
                        aria-label="Dodaj zaboravljeni dan"
                    />
                    <button
                        type="button"
                        className="fwl-addbtn"
                        disabled={!newDay}
                        onClick={() => {
                            setExtraDays(prev => prev.includes(newDay) ? prev : [...prev, newDay]);
                            setEditDate(newDay);
                            setPick(new Set((data?.crew || []).map(c => c.workerId)));
                            setPickItems(new Set());
                            setPresence(1);
                            setNewDay('');
                        }}
                    >
                        <CalendarPlus size={16} /> Dodaj dan
                    </button>
                </div>
            )}

            {days.length === 0 ? (
                <MEmpty
                    title="Još nema zapisa"
                    sub={readOnly ? 'Na ovom nalogu nije knjižen nijedan radni dan.' : 'Dodaj dan i upiši ko je radio.'}
                />
            ) : (
                <div className="fwl-days">
                    {days.map(day => (
                        <button
                            key={day.date}
                            type="button"
                            className={`fwl-day ${day.dayType}`}
                            disabled={readOnly}
                            onClick={() => openDay(day)}
                        >
                            <span className="fwl-day-top">
                                <span className="fwl-date">{human(day.date)}</span>
                                <span className={`fwl-badge ${day.dayType}`}>{DAY_LABEL[day.dayType] || day.dayType}</span>
                                {day.cost != null && day.cost > 0 && <span className="fwl-cost">{km(day.cost)}</span>}
                            </span>
                            {day.workers.length > 0 ? (
                                <span className="fwl-crew">
                                    {day.workers.map(w => (
                                        <span key={w.workerId} className="fwl-chip">
                                            <span className="fwl-ava">{initials(w.name)}</span>
                                            {w.name}{w.presence === 0.5 && <em>½</em>}
                                        </span>
                                    ))}
                                </span>
                            ) : (
                                !readOnly && <span className="fwl-empty"><Plus size={14} /> dodaj rad</span>
                            )}
                        </button>
                    ))}
                </div>
            )}

            <MSheet
                open={!!editDate}
                title={editDate ? human(editDate) : ''}
                onClose={closeDay}
            >
                {editing && editing.workers.length > 0 && (
                    <>
                        <div className="mui-shd"><span>Već upisani</span></div>
                        <div className="fno-crew">
                            {editing.workers.map(w => (
                                <span key={w.workerId} className="fno-worker on">
                                    <span className="fno-ava">{initials(w.name)}</span>
                                    {w.name}{w.presence === 0.5 ? ' · ½' : ''}
                                    <button
                                        type="button"
                                        className="fno-x"
                                        aria-label={`Skini ${w.name}`}
                                        disabled={busy}
                                        onClick={() => void removeWorker(w.workerId)}
                                    >
                                        <X size={15} />
                                    </button>
                                </span>
                            ))}
                        </div>
                    </>
                )}

                <div className="mui-shd">
                    <span>Dopiši radnike</span>
                    <span className="mui-dim">{pick.size} izabrano</span>
                </div>
                {addable.length === 0 ? (
                    <p className="fbk-none">Svi radnici su već upisani na ovaj dan.</p>
                ) : (
                    <div className="fno-crew">
                        {addable.map(w => (
                            <button
                                key={w.workerId}
                                type="button"
                                className={`fno-worker${pick.has(w.workerId) ? ' on' : ''}`}
                                onClick={() => setPick(prev => {
                                    const next = new Set(prev);
                                    if (next.has(w.workerId)) next.delete(w.workerId); else next.add(w.workerId);
                                    return next;
                                })}
                            >
                                <span className="fno-ava">{initials(w.name)}</span>
                                {w.name}
                            </button>
                        ))}
                    </div>
                )}

                <div className="mui-shd"><span>Koliko su radili</span></div>
                <div className="fbk-presence" role="group" aria-label="Koliko su radili">
                    <button type="button" className={presence === 0.5 ? 'on' : ''} onClick={() => setPresence(0.5)}>½ dana</button>
                    <button type="button" className={presence === 1 ? 'on' : ''} onClick={() => setPresence(1)}>Cijeli dan</button>
                </div>

                {(data?.items.length || 0) > 1 && (
                    <>
                        <div className="mui-shd">
                            <span>Na šta</span>
                            <span className="mui-dim">{pickItems.size === 0 ? 'cijeli nalog' : `${pickItems.size} stavki`}</span>
                        </div>
                        <div className="fno-crew">
                            {(data?.items || []).map(it => (
                                <button
                                    key={it.itemId}
                                    type="button"
                                    className={`mui-chip${pickItems.has(it.itemId) ? ' on' : ''}`}
                                    onClick={() => setPickItems(prev => {
                                        const next = new Set(prev);
                                        if (next.has(it.itemId)) next.delete(it.itemId); else next.add(it.itemId);
                                        return next;
                                    })}
                                >
                                    {it.productName}
                                </button>
                            ))}
                        </div>
                    </>
                )}

                <div className="fod-confirm-wrap">
                    <button type="button" className="fbk-confirm" disabled={busy || pick.size === 0} onClick={() => void addCrew()}>
                        {busy ? 'Upisujem…' : pick.size === 0 ? 'Odaberi radnika' : `Upiši · ${pick.size}`}
                    </button>
                </div>
            </MSheet>
        </>
    );
}
