'use client';

// ════════════════════════════════════════════════════════════════════
// BatchTableModal — BRZI TABELARNI unos mnogo planiranih naloga.
//
// Jedan RED = jedan nalog: naziv, proizvodi, radnici, trajanje, početak.
// Tastatura-prvo (Enter na kraju pravi novi red), lijepljenje iz Excela,
// „primijeni na sve", i tri načina raspoređivanja (redom po radniku /
// svi od datuma / ručno). Na kraju vraća PlanBlock[] roditelju — NE dira
// stvarnost (isto kao stari Batch: samo ADD_BLOCKS na platno).
// ════════════════════════════════════════════════════════════════════

import { useState, useMemo, useEffect, type KeyboardEvent } from 'react';
import {
    ClipboardList, Plus, Copy, Trash2, X, Search, Users, Package, ClipboardPaste, CalendarDays, Pin,
} from 'lucide-react';
import Modal from '@/components/ui/Modal';
import type { Project, Worker, WorkOrder, PlanBlock } from '@/lib/types';
import { collectProductCandidates, groupCandidatesByProject, type ProductCandidate } from '@/lib/canvas/fromProducts';
import { scheduleBatch, type BatchScheduleMode } from '@/lib/canvas/batchSchedule';
import { newBlock } from '@/lib/canvas/model';
import './BatchTableModal.css';

const uid = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `r-${Date.now()}-${Math.random()}`);

type RowKind = 'proizvodni' | 'montaza' | 'razni';
const KIND_LABEL: Record<RowKind, string> = { proizvodni: 'Nalog', montaza: 'Montaža', razni: 'Razni' };
const KIND_CYCLE: Record<RowKind, RowKind> = { proizvodni: 'montaza', montaza: 'razni', razni: 'proizvodni' };

interface Row {
    id: string;
    kind: RowKind;
    title: string;
    products: { candidate: ProductCandidate; qty: number }[];
    workerIds: string[];
    durationDays: number;
    startISO: string;
    /**
     * Ručno postavljen početak BAŠ ovog naloga. Prazno = pusti raspored da ga složi.
     * Postoji da se datum jednog reda može pomjeriti bez prebacivanja cijele
     * tabele u „Ručno" — ostali redovi ostaju automatski.
     */
    pinnedISO?: string;
}

const MODES: { key: BatchScheduleMode; label: string; hint: string }[] = [
    { key: 'sequential', label: 'Redom po radniku', hint: 'Nalozi istog radnika idu jedan za drugim, poslije već preuzetog posla.' },
    { key: 'parallel', label: 'Svi od datuma', hint: 'Svi počinju od zadanog datuma.' },
    { key: 'manual', label: 'Ručno', hint: 'Svaki nalog na datum koji upišeš u koloni Početak.' },
];

const dm = (iso: string) => { const [, m, d] = iso.split('-'); return `${Number(d)}.${Number(m)}.`; };

interface BatchTableModalProps {
    isOpen: boolean;
    projects: Project[];
    workOrders: WorkOrder[];
    workers: Worker[];
    /** Postojeći blokovi scenarija — da „redom po radniku" ne slaže na tekući plan. */
    existingBlocks: PlanBlock[];
    startISO: string;
    isSaturdayWorking?: (d: Date) => boolean;
    onClose: () => void;
    onCreate: (blocks: PlanBlock[]) => void;
}

const emptyRow = (kind: RowKind, startISO: string): Row =>
    ({ id: uid(), kind, title: '', products: [], workerIds: [], durationDays: kind === 'montaza' ? 2 : 3, startISO });

export default function BatchTableModal({
    isOpen, projects, workOrders, workers, existingBlocks, startISO, isSaturdayWorking, onClose, onCreate,
}: BatchTableModalProps) {
    const [rows, setRows] = useState<Row[]>([]);
    const [mode, setMode] = useState<BatchScheduleMode>('sequential');
    const [start, setStart] = useState(startISO);
    const [pickProductsFor, setPickProductsFor] = useState<string | null>(null);
    const [pickWorkersFor, setPickWorkersFor] = useState<string | null>(null);   // rowId | 'ALL'
    const [pasteOpen, setPasteOpen] = useState(false);
    const [pasteText, setPasteText] = useState('');
    const [search, setSearch] = useState('');

    useEffect(() => {
        if (isOpen) {
            setRows([emptyRow('proizvodni', startISO)]);
            setMode('sequential'); setStart(startISO); setSearch('');
            setPickProductsFor(null); setPickWorkersFor(null); setPasteOpen(false); setPasteText('');
        }
    }, [isOpen, startISO]);

    const candidates = useMemo(() => collectProductCandidates(projects, workOrders), [projects, workOrders]);
    const activeWorkers = useMemo(
        () => workers.filter(w => w.Status === 'Aktivan' || w.Status === 'Dostupan'),
        [workers]
    );
    const workerName = (id: string) => workers.find(w => w.Worker_ID === id)?.Name || 'Radnik';

    // Zadnji zauzet dan po radniku (stvarni nalozi + postojeći blokovi) — za „redom po radniku".
    const busyUntil = useMemo(() => {
        const m = new Map<string, string>();
        const bump = (wid: string, iso: string) => {
            if (!wid || !iso) return;
            const cur = m.get(wid);
            if (!cur || iso > cur) m.set(wid, iso);
        };
        for (const wo of workOrders) {
            if (wo.Status === 'Završeno' || wo.Status === 'Otkazano') continue;
            const end = (wo.Due_Date || wo.Planned_End_Date || '').split('T')[0];
            if (!end) continue;
            const ids = new Set<string>();
            for (const it of wo.items || []) {
                (it.Assigned_Workers || []).forEach(w => w.Worker_ID && ids.add(w.Worker_ID));
                (it.Processes || []).forEach(p => {
                    if (p.Worker_ID) ids.add(p.Worker_ID);
                    (p.Helpers || []).forEach(h => h.Worker_ID && ids.add(h.Worker_ID));
                });
            }
            ids.forEach(id => bump(id, end));
        }
        for (const b of existingBlocks) for (const w of b.workerRefs || []) if (w.id) bump(w.id, b.endISO);
        return m;
    }, [workOrders, existingBlocks]);

    // Živi raspored (za prikaz Početka i sažetka).
    const placed = useMemo(
        () => new Map(scheduleBatch(
            rows.map(r => ({
                id: r.id, workerIds: r.workerIds, durationDays: r.durationDays,
                startISO: r.startISO, pinnedISO: r.pinnedISO,
            })),
            mode, { startISO: start, isSaturdayWorking, busyUntilByWorker: busyUntil }
        ).map(p => [p.id, p])),
        [rows, mode, start, isSaturdayWorking, busyUntil]
    );

    const rowWorkerDays = (r: Row) => Math.max(0, r.durationDays) * Math.max(1, r.workerIds.length);
    const summary = useMemo(() => {
        const valid = rows.filter(r => r.title.trim() || r.products.length);
        const totalWD = valid.reduce((s, r) => s + rowWorkerDays(r), 0);
        let end = '';
        for (const r of valid) { const p = placed.get(r.id); if (p && p.endISO > end) end = p.endISO; }
        const noWorker = valid.filter(r => r.workerIds.length === 0).length;
        return { count: valid.length, totalWD: Math.round(totalWD * 100) / 100, end, noWorker };
    }, [rows, placed]);

    // ── Uređivanje redova ────────────────────────────────────────
    const patch = (id: string, p: Partial<Row>) => setRows(rs => rs.map(r => r.id === id ? { ...r, ...p } : r));
    const addRow = (kind: RowKind = 'proizvodni') => setRows(rs => [...rs, emptyRow(kind, start)]);
    const dupRow = (id: string) => setRows(rs => {
        const i = rs.findIndex(r => r.id === id);
        if (i < 0) return rs;
        const copy = { ...rs[i], id: uid(), products: rs[i].products.map(p => ({ ...p })), workerIds: [...rs[i].workerIds] };
        return [...rs.slice(0, i + 1), copy, ...rs.slice(i + 1)];
    });
    const delRow = (id: string) => setRows(rs => rs.filter(r => r.id !== id));

    const toggleProduct = (rowId: string, c: ProductCandidate) => setRows(rs => rs.map(r => {
        if (r.id !== rowId) return r;
        const has = r.products.some(p => p.candidate.productId === c.productId);
        const products = has
            ? r.products.filter(p => p.candidate.productId !== c.productId)
            : [...r.products, { candidate: c, qty: Math.max(1, c.availableQty || 1) }];
        // Naziv i trajanje se popune iz proizvoda ako su prazni — ne prekucavaš.
        const title = r.title.trim() ? r.title : (products[0]?.candidate.productName || '');
        const dur = r.durationDays > 0 ? r.durationDays
            : Math.max(1, Math.round(products[0]?.candidate.laborDays || 1));
        return { ...r, products, title, durationDays: dur };
    }));

    const toggleWorker = (target: string, workerId: string) => setRows(rs => {
        // „Na sve": jedinstven smjer — ako ga svi već imaju, skini sa svih; inače dodaj svima.
        if (target === 'ALL') {
            const allHave = rs.length > 0 && rs.every(r => r.workerIds.includes(workerId));
            return rs.map(r => ({
                ...r,
                workerIds: allHave
                    ? r.workerIds.filter(w => w !== workerId)
                    : (r.workerIds.includes(workerId) ? r.workerIds : [...r.workerIds, workerId]),
            }));
        }
        return rs.map(r => r.id !== target ? r : {
            ...r,
            workerIds: r.workerIds.includes(workerId)
                ? r.workerIds.filter(w => w !== workerId)
                : [...r.workerIds, workerId],
        });
    });

    /** Skida sve ručne datume i vraća redove pod automatski raspored od „Kreni od". */
    const startToAll = () =>
        setRows(rs => rs.map(r => ({ ...r, startISO: start, pinnedISO: undefined })));
    const pinnedCount = rows.filter(r => r.pinnedISO).length;

    const applyPaste = () => {
        // Svaki red teksta = nalog. Kolone (tab ili ; ili više razmaka):
        // 1 = naziv, 2 = trajanje (broj dana), 3 = radnik (po imenu).
        const lines = pasteText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        const parsed: Row[] = lines.map(line => {
            const cols = line.split(/\t|;|\s{2,}/).map(c => c.trim());
            const dur = parseInt((cols[1] || '').replace(/[^\d]/g, ''), 10);
            const w = cols[2] ? activeWorkers.find(x => (x.Name || '').toLowerCase() === cols[2].toLowerCase()) : undefined;
            return {
                id: uid(), kind: 'razni', title: cols[0] || 'Nalog', products: [],
                workerIds: w ? [w.Worker_ID] : [],
                durationDays: isFinite(dur) && dur > 0 ? dur : 1,
                startISO: start,
            };
        });
        if (parsed.length) setRows(rs => [...rs.filter(r => r.title.trim() || r.products.length), ...parsed]);
        setPasteOpen(false); setPasteText('');
    };

    const create = () => {
        const blocks: PlanBlock[] = [];
        for (const r of rows) {
            if (!r.title.trim() && r.products.length === 0) continue;
            const p = placed.get(r.id);
            if (!p) continue;
            const kind = r.kind === 'montaza' ? 'montaza' : 'order';
            const crew = Math.max(1, r.workerIds.length);
            const workerRefs = r.workerIds.map(id => ({ id, name: workerName(id) }));
            const productRefs = r.products.map(x => ({ id: x.candidate.productId, name: x.candidate.productName, qty: x.qty }));
            const projIds = new Set(r.products.map(x => x.candidate.projectId));
            const projectRef = projIds.size === 1 && r.products[0]
                ? { id: r.products[0].candidate.projectId, name: r.products[0].candidate.projectName }
                : undefined;
            const title = r.title.trim() || r.products[0]?.candidate.productName || KIND_LABEL[r.kind];
            blocks.push(newBlock(kind, p.startISO, p.endISO, {
                title,
                crew,
                workerDays: Math.max(1, r.durationDays) * crew,
                ...(workerRefs.length ? { workerRefs } : {}),
                ...(productRefs.length ? { productRefs } : {}),
                ...(projectRef ? { projectRef } : {}),
            }));
        }
        if (!blocks.length) return;
        onCreate(blocks);
        onClose();
    };

    // Enter u polju naziva zadnjeg reda → novi red (tastatura-prvo).
    const onNameKey = (e: KeyboardEvent, isLast: boolean) => {
        if (e.key === 'Enter') { e.preventDefault(); if (isLast) addRow(rows[rows.length - 1]?.kind || 'proizvodni'); }
    };

    const groups = useMemo(
        () => groupCandidatesByProject(candidates, { onlyAvailable: false, search }),
        [candidates, search]
    );
    const pickRow = pickProductsFor ? rows.find(r => r.id === pickProductsFor) : null;

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={<><ClipboardList size={17} /> Brzi unos naloga</>}
            size="fullscreen"
            footer={
                <div className="btt-foot">
                    <span className="btt-seg-lbl">Rasporedi:</span>
                    <div className="btt-seg" role="group" aria-label="Način raspoređivanja">
                        {MODES.map(m => (
                            <button key={m.key} className={mode === m.key ? 'on' : ''} title={m.hint}
                                onClick={() => setMode(m.key)}>{m.label}</button>
                        ))}
                    </div>
                    <span className="btt-foot-sum">
                        <strong>{summary.count}</strong> {summary.count === 1 ? 'nalog' : 'naloga'}
                        <span className="btt-sep">·</span>
                        <strong>{summary.totalWD}</strong> radnik-dana
                        {summary.end && <><span className="btt-sep">·</span> završava <strong>~{dm(summary.end)}</strong></>}
                    </span>
                    {summary.noWorker > 0 && (
                        <span className="btt-foot-note">{summary.noWorker} bez radnika</span>
                    )}
                    <span className="btt-foot-spacer" />
                    <button className="btn btn-secondary" onClick={onClose}>Odustani</button>
                    <button className="btn btn-primary" disabled={summary.count === 0} onClick={create}>
                        Dodaj {summary.count > 0 ? `svih ${summary.count}` : ''} na platno →
                    </button>
                </div>
            }
        >
            <div className="btt-shell">
                {/* Traka alata */}
                <div className="btt-tools">
                    <button className="btt-tbtn accent" onClick={() => addRow('proizvodni')}>
                        <Plus size={14} /> Red <kbd>Enter</kbd>
                    </button>
                    <button className="btt-tbtn" onClick={() => addRow('montaza')}>+ Montaža</button>
                    <button className="btt-tbtn" onClick={() => addRow('razni')}>+ Razni</button>
                    <button className="btt-tbtn" onClick={() => setPasteOpen(true)}>
                        <ClipboardPaste size={14} /> Zalijepi iz Excela
                    </button>
                    <button className="btt-tbtn" onClick={() => setPickWorkersFor('ALL')}>
                        <Users size={14} /> Radnici na sve
                    </button>
                    <button className="btt-tbtn" onClick={startToAll} disabled={pinnedCount === 0}
                        title={'Skida ručno postavljene datume i vraća redove na automatski raspored'}>
                        <CalendarDays size={14} /> Vrati na auto
                        {pinnedCount > 0 && <span className="btt-tbtn-n">{pinnedCount}</span>}
                    </button>
                    <span className="btt-tools-spacer" />
                    <label className="btt-start">Kreni od
                        <input type="date" value={start} onChange={e => e.target.value && setStart(e.target.value)} />
                    </label>
                </div>

                {/* Tabela */}
                <div className="btt-tablewrap">
                    <table className="btt-table">
                        <thead>
                            <tr>
                                <th className="c-idx">#</th>
                                <th className="c-name">Naziv naloga</th>
                                <th className="c-prod">Proizvodi</th>
                                <th className="c-wrk">Radnici</th>
                                <th className="c-dur">Trajanje</th>
                                <th className="c-start">Početak</th>
                                <th className="c-rd">rd</th>
                                <th className="c-act" />
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r, i) => {
                                const p = placed.get(r.id);
                                const pushed = mode === 'sequential' && p && p.startISO > start;
                                return (
                                    <tr key={r.id} className={`k-${r.kind}`}>
                                        <td className="c-idx">
                                            <button className={`btt-kind kd-${r.kind}`} title={`${KIND_LABEL[r.kind]} — klik mijenja vrstu`}
                                                onClick={() => patch(r.id, { kind: KIND_CYCLE[r.kind] })}>
                                                <span className="btt-kdot" />
                                            </button>
                                            {i + 1}
                                        </td>
                                        <td className="c-name">
                                            <input className="btt-in" value={r.title} placeholder={KIND_LABEL[r.kind] + '…'}
                                                onChange={e => patch(r.id, { title: e.target.value })}
                                                onKeyDown={e => onNameKey(e, i === rows.length - 1)} />
                                        </td>
                                        <td className="c-prod">
                                            <div className="btt-chips">
                                                {r.products.map(pp => (
                                                    <span key={pp.candidate.productId} className="btt-chip prod" title={pp.candidate.productName}>
                                                        <span className="btt-chip-t">{pp.candidate.productName}</span>
                                                        <span className="q">×{pp.qty}</span>
                                                        <X size={11} onClick={() => toggleProduct(r.id, pp.candidate)} />
                                                    </span>
                                                ))}
                                                {r.kind !== 'razni' && (
                                                    <button className="btt-chip-add" title="Veži proizvode"
                                                        onClick={() => { setSearch(''); setPickProductsFor(r.id); }}><Plus size={13} /></button>
                                                )}
                                            </div>
                                        </td>
                                        <td className="c-wrk">
                                            <div className="btt-chips">
                                                {r.workerIds.map(w => (
                                                    <span key={w} className="btt-chip wrk" title={workerName(w)}>
                                                        <span className="btt-chip-t">{workerName(w)}</span>
                                                        <X size={11} onClick={() => toggleWorker(r.id, w)} />
                                                    </span>
                                                ))}
                                                <button className="btt-chip-add" title="Dodijeli radnike"
                                                    onClick={() => setPickWorkersFor(r.id)}><Plus size={13} /></button>
                                            </div>
                                        </td>
                                        <td className="c-dur">
                                            <div className="btt-dur-cell">
                                                <input className="btt-in num" type="number" min={1} value={r.durationDays}
                                                    onChange={e => patch(r.id, { durationDays: Math.max(1, Number(e.target.value) || 1) })} />
                                                <span className="btt-unit">dana</span>
                                            </div>
                                        </td>
                                        {/* Početak je UVIJEK uređiv. Izmjena prikuje baš ovaj red;
                                            ostali se i dalje slažu automatski. */}
                                        <td className="c-start">
                                            <div className="btt-start-cell">
                                                <input
                                                    className={`btt-in date${r.pinnedISO ? ' pinned' : ''}`}
                                                    type="date"
                                                    value={r.pinnedISO || p?.startISO || r.startISO}
                                                    title={r.pinnedISO ? 'Ručno postavljen datum' : 'Automatski — upiši datum da ga prikuješ'}
                                                    onChange={e => e.target.value && patch(r.id, { pinnedISO: e.target.value })}
                                                />
                                                {r.pinnedISO ? (
                                                    <button className="btt-pin on" title="Vrati na automatski raspored"
                                                        onClick={() => patch(r.id, { pinnedISO: undefined })}>
                                                        <Pin size={11} />
                                                    </button>
                                                ) : (
                                                    <span className="btt-pin-lbl">{pushed ? 'nadovezano' : 'auto'}</span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="c-rd"><strong>{rowWorkerDays(r)}</strong></td>
                                        <td className="c-act">
                                            <button className="btt-rowbtn" title="Dupliciraj" onClick={() => dupRow(r.id)}><Copy size={13} /></button>
                                            <button className="btt-rowbtn del" title="Ukloni" onClick={() => delRow(r.id)}><Trash2 size={13} /></button>
                                        </td>
                                    </tr>
                                );
                            })}
                            <tr className="btt-addrow-tr">
                                <td colSpan={8}>
                                    <button className="btt-addrow" onClick={() => addRow('proizvodni')}>
                                        <Plus size={14} /> Dodaj red <kbd>Enter</kbd>
                                    </button>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Izbor proizvoda */}
            <Modal isOpen={!!pickProductsFor} onClose={() => setPickProductsFor(null)}
                title={<><Package size={16} /> Veži proizvode</>} size="default" zIndex={1200}
                footer={<div className="btt-pick-foot">
                    <button className="btn btn-primary" onClick={() => setPickProductsFor(null)}>Gotovo</button>
                </div>}>
                <div className="btt-pick">
                    <div className="btt-pick-search">
                        <Search size={14} />
                        <input autoFocus placeholder="Traži proizvod ili projekt…" value={search}
                            onChange={e => setSearch(e.target.value)} />
                    </div>
                    <div className="btt-pick-list">
                        {groups.length === 0 && <p className="btt-pick-empty">Nema proizvoda.</p>}
                        {groups.map(g => (
                            <div key={g.projectId} className="btt-pick-group">
                                <div className="btt-pick-gh">{g.projectName}</div>
                                {g.items.map(c => {
                                    const on = !!pickRow?.products.some(p => p.candidate.productId === c.productId);
                                    return (
                                        <button key={c.productId} className={`btt-pick-item${on ? ' on' : ''}`}
                                            onClick={() => pickProductsFor && toggleProduct(pickProductsFor, c)}>
                                            <span className={`btt-box${on ? ' on' : ''}`} />
                                            <span className="btt-pick-name">{c.productName}</span>
                                            <span className="btt-pick-meta">{c.availableQty}/{c.totalQty}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        ))}
                    </div>
                </div>
            </Modal>

            {/* Izbor radnika */}
            <Modal isOpen={!!pickWorkersFor} onClose={() => setPickWorkersFor(null)}
                title={<><Users size={16} /> {pickWorkersFor === 'ALL' ? 'Radnici na sve naloge' : 'Dodijeli radnike'}</>}
                size="default" zIndex={1200}
                footer={<div className="btt-pick-foot">
                    <button className="btn btn-primary" onClick={() => setPickWorkersFor(null)}>Gotovo</button>
                </div>}>
                <div className="btt-pick-list">
                    {activeWorkers.map(w => {
                        const on = pickWorkersFor === 'ALL'
                            ? rows.length > 0 && rows.every(r => r.workerIds.includes(w.Worker_ID))
                            : !!rows.find(r => r.id === pickWorkersFor)?.workerIds.includes(w.Worker_ID);
                        return (
                            <button key={w.Worker_ID} className={`btt-pick-item${on ? ' on' : ''}`}
                                onClick={() => pickWorkersFor && toggleWorker(pickWorkersFor, w.Worker_ID)}>
                                <span className={`btt-box${on ? ' on' : ''}`} />
                                <span className="btt-pick-name">{w.Name}</span>
                                <span className="btt-pick-meta">{w.Role || ''}</span>
                            </button>
                        );
                    })}
                </div>
            </Modal>

            {/* Zalijepi iz Excela */}
            <Modal isOpen={pasteOpen} onClose={() => setPasteOpen(false)}
                title={<><ClipboardPaste size={16} /> Zalijepi iz Excela</>} size="default" zIndex={1200}
                footer={<div className="btt-pick-foot">
                    <button className="btn btn-secondary" onClick={() => setPasteOpen(false)}>Odustani</button>
                    <button className="btn btn-primary" disabled={!pasteText.trim()} onClick={applyPaste}>Dodaj redove</button>
                </div>}>
                <div className="btt-paste">
                    <p className="btt-paste-help">
                        Zalijepi iz tabele — svaki red je jedan nalog. Kolone: <strong>naziv</strong> · <strong>trajanje (dana)</strong> · <strong>radnik (ime)</strong>.
                    </p>
                    <textarea autoFocus rows={9} placeholder={'Recepcijski pult\t4\tEmir Granov\nZidne obloge\t3\tEmir Granov'}
                        value={pasteText} onChange={e => setPasteText(e.target.value)} />
                </div>
            </Modal>
        </Modal>
    );
}
