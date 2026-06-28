'use client';

import { useMemo, useState } from 'react';
import type { WorkOrder } from '@/lib/types';
import type { ProposalRow, PresentOrderOption } from '@/lib/attendanceBooking';
import { workOrderDisplayName, formatDate } from '@/lib/utils';
import Modal from './Modal';
import { CheckCircle2, Car, Plus, Ban, ClipboardList, RotateCcw } from 'lucide-react';
import './AttendanceBookingConfirmModal.css';

// ── Odluke koje modal vraća roditelju (AttendanceTab ih izvršava) ──────────────
export interface PresentDecision {
    kind: 'present';
    workerId: string;
    workerName: string;
    orderIds: string[];                 // izabrani nalozi (knjiži se na njihove stavke)
}

export type TerenChoice =
    | { mode: 'order'; workOrderId: string }   // postojeći nalog (aktivan ili neaktivan)
    | { mode: 'new'; name: string }            // novi montažni nalog
    | { mode: 'none' };                        // ništa

export interface TerenDecision {
    kind: 'teren';
    workerId: string;
    workerName: string;
    choice: TerenChoice;
}

export type BookingDecision = PresentDecision | TerenDecision;

type TerenMode = 'order' | 'new' | 'none';
interface TerenState { mode: TerenMode; orderId: string; newName: string }

interface Props {
    isOpen: boolean;
    onClose: () => void;
    date: string;
    rows: ProposalRow[];
    workOrders: WorkOrder[];
    onConfirm: (decisions: BookingDecision[]) => Promise<void>;
}

function initials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    const a = parts[0]?.[0] ?? '';
    const b = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return (a + b).toUpperCase() || '?';
}

export default function AttendanceBookingConfirmModal({ isOpen, onClose, date, rows, workOrders, onConfirm }: Props) {
    const presentRows = rows.filter((r): r is Extract<ProposalRow, { kind: 'present' }> => r.kind === 'present');
    const terenRows = rows.filter((r): r is Extract<ProposalRow, { kind: 'teren' }> => r.kind === 'teren');

    // Za teren padajuću listu: aktivni (U toku) i ostali (sve osim otkazanih).
    const activeOrders = useMemo(() => workOrders.filter(w => w.Status === 'U toku').sort(byName), [workOrders]);
    const inactiveOrders = useMemo(
        () => workOrders.filter(w => w.Status !== 'U toku' && w.Status !== 'Otkazano').sort(byName),
        [workOrders]
    );
    const firstOrderId = activeOrders[0]?.Work_Order_ID || inactiveOrders[0]?.Work_Order_ID || '';

    // State: izabrani nalozi po prisutnom radniku (default = predčekirani).
    const [checks, setChecks] = useState<Record<string, Set<string>>>(() => {
        const init: Record<string, Set<string>> = {};
        presentRows.forEach(r => { init[r.workerId] = new Set(r.suggestedOrderIds); });
        return init;
    });

    // State: izbor za svakog teren radnika.
    const [teren, setTeren] = useState<Record<string, TerenState>>(() => {
        const init: Record<string, TerenState> = {};
        terenRows.forEach(r => {
            init[r.workerId] = {
                mode: r.suggestedWorkOrderId ? 'order' : 'none',
                orderId: r.suggestedWorkOrderId || firstOrderId,
                newName: '',
            };
        });
        return init;
    });

    const [saving, setSaving] = useState(false);

    function toggleOrder(workerId: string, orderId: string) {
        setChecks(prev => {
            const next = new Set(prev[workerId] || []);
            if (next.has(orderId)) next.delete(orderId); else next.add(orderId);
            return { ...prev, [workerId]: next };
        });
    }

    function toggleAll(row: Extract<ProposalRow, { kind: 'present' }>) {
        setChecks(prev => {
            const cur = prev[row.workerId] || new Set<string>();
            const allOn = cur.size === row.orders.length;
            return { ...prev, [row.workerId]: allOn ? new Set() : new Set(row.orders.map(o => o.workOrderId)) };
        });
    }

    function setTerenField(workerId: string, patch: Partial<TerenState>) {
        setTeren(prev => ({ ...prev, [workerId]: { ...prev[workerId], ...patch } }));
    }

    // Koliko radnika će dobiti dnevnicu (za sažetak u footeru).
    const willBook = useMemo(() => {
        let n = 0;
        for (const r of presentRows) if ((checks[r.workerId]?.size || 0) > 0) n++;
        for (const r of terenRows) {
            const s = teren[r.workerId];
            if (!s || s.mode === 'none') continue;
            if (s.mode === 'order' && s.orderId) n++;
            else if (s.mode === 'new') n++;
        }
        return n;
    }, [presentRows, terenRows, checks, teren]);

    function buildDecisions(): BookingDecision[] {
        const out: BookingDecision[] = [];
        for (const r of presentRows) {
            const set = checks[r.workerId] || new Set<string>();
            out.push({ kind: 'present', workerId: r.workerId, workerName: r.workerName, orderIds: Array.from(set) });
        }
        for (const r of terenRows) {
            const s = teren[r.workerId];
            let choice: TerenChoice = { mode: 'none' };
            if (s.mode === 'order' && s.orderId) choice = { mode: 'order', workOrderId: s.orderId };
            else if (s.mode === 'new') choice = { mode: 'new', name: s.newName.trim() || `Teren ${date}` };
            out.push({ kind: 'teren', workerId: r.workerId, workerName: r.workerName, choice });
        }
        return out;
    }

    async function handleConfirm() {
        setSaving(true);
        try {
            await onConfirm(buildDecisions());
            onClose();
        } finally {
            setSaving(false);
        }
    }

    if (!isOpen) return null;

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            size="large"
            title={
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}>
                    <CheckCircle2 size={20} style={{ color: 'var(--success)' }} />
                    Knjiženje dnevnica
                    <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>· {formatDate(date)}</span>
                </span>
            }
            footer={
                <div className="abcm-foot">
                    <span className="abcm-foot-count">
                        {willBook > 0
                            ? <><strong>{willBook}</strong> {plural(willBook)} dobiće dnevnicu</>
                            : 'Nijedna dnevnica neće biti knjižena'}
                    </span>
                    <div className="abcm-foot-btns">
                        <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Otkaži</button>
                        <button className="btn btn-primary" onClick={handleConfirm} disabled={saving}>
                            {saving ? 'Knjižim…' : 'Potvrdi i proknjiži'}
                        </button>
                    </div>
                </div>
            }
        >
            <div className="abcm">
                <p className="abcm-intro">
                    Potvrdi na koje naloge ide radni dan. Otkazivanje ostavlja prisustvo zabilježeno — bez dnevnica.
                </p>

                {/* PRISUTNI — izbor naloga (aktivni + pauzirani) */}
                {presentRows.map(r => {
                    const set = checks[r.workerId] || new Set<string>();
                    const allOn = set.size === r.orders.length;
                    return (
                        <div key={r.workerId} className="abcm-card">
                            <div className="abcm-head">
                                <div className="abcm-avatar abcm-avatar--present">{initials(r.workerName)}</div>
                                <div className="abcm-who">
                                    <span className="abcm-name">{r.workerName}</span>
                                    <span className="abcm-sub">{set.size} / {r.orders.length} naloga</span>
                                </div>
                                <div className="abcm-head-right">
                                    <button type="button" className="abcm-link" onClick={() => toggleAll(r)}>
                                        {allOn ? 'Poništi sve' : 'Označi sve'}
                                    </button>
                                    <span className="abcm-badge abcm-badge--present"><CheckCircle2 size={12} /> Prisutan</span>
                                </div>
                            </div>
                            <div className="abcm-items">
                                {r.orders.map((o: PresentOrderOption) => {
                                    const on = set.has(o.workOrderId);
                                    return (
                                        <label key={o.workOrderId} className={`abcm-item${on ? ' is-on' : ''}`}>
                                            <input type="checkbox" checked={on} onChange={() => toggleOrder(r.workerId, o.workOrderId)} />
                                            <span className="abcm-item-name">
                                                {o.name}
                                                {o.assigned && <span className="abcm-tag">dodijeljen</span>}
                                            </span>
                                            {o.paused && on
                                                ? <span className="abcm-chip abcm-chip--resume"><RotateCcw size={11} /> pokreni ponovo</span>
                                                : <span className={`abcm-chip${o.paused ? ' abcm-chip--paused' : ''}`}>{o.paused ? 'Pauziran' : o.status}</span>}
                                        </label>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}

                {/* TEREN — bilo koji nalog (aktivan/neaktivan), novi ili ništa */}
                {terenRows.map(r => {
                    const s = teren[r.workerId];
                    return (
                        <div key={r.workerId} className="abcm-card">
                            <div className="abcm-head">
                                <div className="abcm-avatar abcm-avatar--teren">{initials(r.workerName)}</div>
                                <div className="abcm-who">
                                    <span className="abcm-name">{r.workerName}</span>
                                    <span className="abcm-sub">Na šta se odnosi teren?</span>
                                </div>
                                <div className="abcm-head-right">
                                    <span className="abcm-badge abcm-badge--teren"><Car size={12} /> Teren</span>
                                </div>
                            </div>
                            <div className="abcm-options">
                                {/* (a) postojeći nalog — aktivan ili neaktivan */}
                                <label className={`abcm-opt${s.mode === 'order' ? ' is-on' : ''}`}>
                                    <div className="abcm-opt-row">
                                        <input type="radio" name={`teren-${r.workerId}`} checked={s.mode === 'order'}
                                            onChange={() => setTerenField(r.workerId, { mode: 'order' })} />
                                        <span className="abcm-opt-label"><ClipboardList size={15} /> Postojeći nalog</span>
                                        <span className="abcm-opt-hint">aktivan ili ne</span>
                                    </div>
                                    {s.mode === 'order' && (
                                        <div className="abcm-opt-control">
                                            <select value={s.orderId}
                                                onChange={e => setTerenField(r.workerId, { mode: 'order', orderId: e.target.value })}>
                                                {activeOrders.length === 0 && inactiveOrders.length === 0 && <option value="">— nema naloga —</option>}
                                                {activeOrders.length > 0 && (
                                                    <optgroup label="Aktivni">
                                                        {activeOrders.map(w => (
                                                            <option key={w.Work_Order_ID} value={w.Work_Order_ID}>{workOrderDisplayName(w)}</option>
                                                        ))}
                                                    </optgroup>
                                                )}
                                                {inactiveOrders.length > 0 && (
                                                    <optgroup label="Ostali">
                                                        {inactiveOrders.map(w => (
                                                            <option key={w.Work_Order_ID} value={w.Work_Order_ID}>
                                                                {workOrderDisplayName(w)} · {w.Status}
                                                            </option>
                                                        ))}
                                                    </optgroup>
                                                )}
                                            </select>
                                        </div>
                                    )}
                                </label>

                                {/* (b) novi montažni nalog */}
                                <label className={`abcm-opt${s.mode === 'new' ? ' is-on' : ''}`}>
                                    <div className="abcm-opt-row">
                                        <input type="radio" name={`teren-${r.workerId}`} checked={s.mode === 'new'}
                                            onChange={() => setTerenField(r.workerId, { mode: 'new' })} />
                                        <span className="abcm-opt-label"><Plus size={15} /> Novi montažni nalog</span>
                                        <span className="abcm-opt-hint">kreiraj odmah</span>
                                    </div>
                                    {s.mode === 'new' && (
                                        <div className="abcm-opt-control">
                                            <input type="text" value={s.newName} placeholder="Naziv ili lokacija terena…"
                                                onChange={e => setTerenField(r.workerId, { mode: 'new', newName: e.target.value })} />
                                        </div>
                                    )}
                                </label>

                                {/* (c) ništa */}
                                <label className={`abcm-opt${s.mode === 'none' ? ' is-on' : ''}`}>
                                    <div className="abcm-opt-row">
                                        <input type="radio" name={`teren-${r.workerId}`} checked={s.mode === 'none'}
                                            onChange={() => setTerenField(r.workerId, { mode: 'none' })} />
                                        <span className="abcm-opt-label"><Ban size={15} /> Nešto drugo — ne knjiži</span>
                                    </div>
                                </label>
                            </div>
                        </div>
                    );
                })}
            </div>
        </Modal>
    );
}

function byName(a: WorkOrder, b: WorkOrder) {
    return workOrderDisplayName(a).localeCompare(workOrderDisplayName(b));
}

function plural(n: number): string {
    const mod10 = n % 10, mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return 'radnik';
    return 'radnika';
}
