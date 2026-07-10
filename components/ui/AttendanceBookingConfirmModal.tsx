'use client';

import { useMemo, useState } from 'react';
import type { WorkOrder, Worker } from '@/lib/types';
import type { ProposalRow, PresentOrderOption } from '@/lib/attendanceBooking';
import { workOrderDisplayName, formatDate } from '@/lib/utils';
import Modal from './Modal';
import CustomTasksModal from './CustomTasksModal';
import { SearchableSelect } from './SearchableSelect';
import { CheckCircle2, Car, Plus, Ban, ClipboardList, RotateCcw, Play } from 'lucide-react';
import './AttendanceBookingConfirmModal.css';

// ── Odluke koje modal vraća roditelju (AttendanceTab ih izvršava) ──────────────
export interface PresentDecision {
    kind: 'present';
    workerId: string;
    workerName: string;
    orderIds: string[];                 // izabrani nalozi (knjiži se na njihove stavke)
    presence?: 0.5 | 1;                 // ½ ili cijeli dan (default 1)
}

export type TerenChoice =
    | { mode: 'order'; workOrderId: string }   // postojeći nalog (aktivan ili neaktivan) — uključujući tek kreiran
    | { mode: 'none' };                        // ništa

export interface TerenDecision {
    kind: 'teren';
    workerId: string;
    workerName: string;
    choice: TerenChoice;
    presence?: 0.5 | 1;                 // ½ ili cijeli dan (default 1)
}

export type BookingDecision = PresentDecision | TerenDecision;

// 'creating' = korisnik je otvorio "Razni poslovi" da napravi novi nalog za ovog
// radnika; nije stvaran izbor, samo prelazno UI stanje dok se čeka kreiranje.
type TerenMode = 'order' | 'creating' | 'none';
interface TerenState { mode: TerenMode; orderId: string }

interface Props {
    isOpen: boolean;
    onClose: () => void;
    date: string;
    rows: ProposalRow[];
    workOrders: WorkOrder[];
    workers: Worker[];
    organizationId: string;
    onConfirm: (decisions: BookingDecision[]) => Promise<void>;
    onCreated: (...collections: string[]) => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

function initials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    const a = parts[0]?.[0] ?? '';
    const b = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return (a + b).toUpperCase() || '?';
}

export default function AttendanceBookingConfirmModal({ isOpen, onClose, date, rows, workOrders, workers, organizationId, onConfirm, onCreated, showToast }: Props) {
    const presentRows = rows.filter((r): r is Extract<ProposalRow, { kind: 'present' }> => r.kind === 'present');
    const terenRows = rows.filter((r): r is Extract<ProposalRow, { kind: 'teren' }> => r.kind === 'teren');

    // Za teren padajuću listu: aktivni (U toku) i ostali (sve osim otkazanih).
    const activeOrders = useMemo(() => workOrders.filter(w => w.Status === 'U toku').sort(byName), [workOrders]);
    const inactiveOrders = useMemo(
        () => workOrders.filter(w => w.Status !== 'U toku' && w.Status !== 'Otkazano').sort(byName),
        [workOrders]
    );
    const firstOrderId = activeOrders[0]?.Work_Order_ID || inactiveOrders[0]?.Work_Order_ID || '';

    // Puno pretraživa lista naloga (aktivni prvo) s pregledom 2-3 proizvoda po
    // nalogu — mnogi nalozi imaju slična imena, pa naziv sam po sebi nije dovoljan
    // da se razlikuju; pregled stavki i status (bedž) to rješavaju.
    const orderOptions = useMemo(
        () => [...activeOrders, ...inactiveOrders].map(w => ({
            value: w.Work_Order_ID,
            label: workOrderDisplayName(w),
            subLabel: orderItemsPreview(w),
            badge: { text: w.Status, tone: (w.Status === 'U toku' ? 'active' : 'neutral') as 'active' | 'neutral' },
        })),
        [activeOrders, inactiveOrders]
    );

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
            };
        });
        return init;
    });

    const [saving, setSaving] = useState(false);

    // ½ ili cijeli dan po radniku (default 1) — pola dana bez odlaska u Knjigu rada.
    const [presenceByWorker, setPresenceByWorker] = useState<Record<string, 0.5 | 1>>({});
    const presenceOf = (workerId: string): 0.5 | 1 => presenceByWorker[workerId] ?? 1;
    const PresenceToggle = ({ workerId }: { workerId: string }) => (
        <span style={{ display: 'inline-flex', border: '1px solid var(--border-light)', borderRadius: 8, overflow: 'hidden' }} title="Pola ili cijeli dan">
            {([0.5, 1] as const).map(v => (
                <button key={v} type="button"
                    onClick={() => setPresenceByWorker(prev => ({ ...prev, [workerId]: v }))}
                    style={{
                        padding: '2px 9px', fontSize: 11, fontWeight: 700, border: 'none', cursor: 'pointer',
                        background: presenceOf(workerId) === v ? 'var(--accent)' : 'var(--background)',
                        color: presenceOf(workerId) === v ? '#fff' : 'var(--text-secondary)',
                    }}>
                    {v === 0.5 ? '½' : '1'}
                </button>
            ))}
        </span>
    );

    // Radnik za kojeg je trenutno otvoren "Razni poslovi" modal (kreiranje novog naloga).
    const [creatingFor, setCreatingFor] = useState<{ workerId: string; workerName: string } | null>(null);

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

    // "Novi nalog" otvara ISTI modal kao dugme "Razni poslovi" — jedini ispravni
    // način da se nalog kreira. Nije zaseban ad-hoc put kreiranja.
    function openCreateOrder(workerId: string, workerName: string) {
        setTerenField(workerId, { mode: 'creating' });
        setCreatingFor({ workerId, workerName });
    }

    // Nalog uspješno kreiran u "Razni poslovi" modalu → tretiraj kao normalan
    // izbor postojećeg naloga (isti, provjereni put knjiženja pri potvrdi).
    function handleOrderCreated(workerId: string, workOrderId: string) {
        setTerenField(workerId, { mode: 'order', orderId: workOrderId });
        setCreatingFor(null);
    }

    // Otkazano bez kreiranja → vrati na "ništa" umjesto da ostane zaglavljeno u 'creating'.
    function closeCreateOrder() {
        if (creatingFor) {
            setTeren(prev => {
                const cur = prev[creatingFor.workerId];
                if (cur?.mode !== 'creating') return prev;
                return { ...prev, [creatingFor.workerId]: { ...cur, mode: 'none' } };
            });
        }
        setCreatingFor(null);
    }

    // Koliko radnika će dobiti dnevnicu (za sažetak u footeru).
    const willBook = useMemo(() => {
        let n = 0;
        for (const r of presentRows) if ((checks[r.workerId]?.size || 0) > 0) n++;
        for (const r of terenRows) {
            const s = teren[r.workerId];
            if (!s || s.mode !== 'order' || !s.orderId) continue;
            n++;
        }
        return n;
    }, [presentRows, terenRows, checks, teren]);

    function buildDecisions(): BookingDecision[] {
        const out: BookingDecision[] = [];
        for (const r of presentRows) {
            const set = checks[r.workerId] || new Set<string>();
            out.push({ kind: 'present', workerId: r.workerId, workerName: r.workerName, orderIds: Array.from(set), presence: presenceOf(r.workerId) });
        }
        for (const r of terenRows) {
            const s = teren[r.workerId];
            const choice: TerenChoice = (s.mode === 'order' && s.orderId)
                ? { mode: 'order', workOrderId: s.orderId }
                : { mode: 'none' };
            out.push({ kind: 'teren', workerId: r.workerId, workerName: r.workerName, choice, presence: presenceOf(r.workerId) });
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
                                    <PresenceToggle workerId={r.workerId} />
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
                                                : o.notStarted && on
                                                    ? <span className="abcm-chip abcm-chip--resume"><Play size={11} /> pokrenuće se</span>
                                                    : o.notStarted
                                                        ? <span className="abcm-chip abcm-chip--new">novi — nije pokrenut</span>
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
                                    <PresenceToggle workerId={r.workerId} />
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
                                            <SearchableSelect
                                                options={orderOptions}
                                                value={s.orderId}
                                                onChange={v => setTerenField(r.workerId, { mode: 'order', orderId: v })}
                                                placeholder={orderOptions.length === 0 ? '— nema naloga —' : 'Pretraži naloge…'}
                                            />
                                        </div>
                                    )}
                                </label>

                                {/* (b) novi nalog — otvara isti "Razni poslovi" modal kao svugdje drugo */}
                                <label className={`abcm-opt${s.mode === 'creating' ? ' is-on' : ''}`}>
                                    <div className="abcm-opt-row">
                                        <input type="radio" name={`teren-${r.workerId}`} checked={s.mode === 'creating'}
                                            onChange={() => openCreateOrder(r.workerId, r.workerName)} />
                                        <span className="abcm-opt-label"><Plus size={15} /> Novi nalog</span>
                                        <span className="abcm-opt-hint">otvara "Razni poslovi"</span>
                                    </div>
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

            {creatingFor && (
                <CustomTasksModal
                    isOpen={!!creatingFor}
                    onClose={closeCreateOrder}
                    workOrders={workOrders}
                    workers={workers}
                    organizationId={organizationId}
                    onCreated={onCreated}
                    showToast={showToast}
                    zIndex={2000}
                    initialWorkerId={creatingFor.workerId}
                    onOrderCreated={(workOrderId) => handleOrderCreated(creatingFor.workerId, workOrderId)}
                />
            )}
        </Modal>
    );
}

function byName(a: WorkOrder, b: WorkOrder) {
    return workOrderDisplayName(a).localeCompare(workOrderDisplayName(b));
}

// Do 3 naziva proizvoda/zadataka s naloga, za razlikovanje naloga sličnih imena.
function orderItemsPreview(w: WorkOrder): string {
    const names = Array.from(new Set((w.items || []).map(i => i.Product_Name).filter(Boolean)));
    if (names.length === 0) return 'Bez stavki';
    const shown = names.slice(0, 3).join(', ');
    return names.length > 3 ? `${shown} +${names.length - 3}` : shown;
}

function plural(n: number): string {
    const mod10 = n % 10, mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return 'radnik';
    return 'radnika';
}
