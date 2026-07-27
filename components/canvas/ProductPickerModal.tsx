'use client';

// ════════════════════════════════════════════════════════════════════
// ProductPickerModal — nalog se sastavlja od STVARNIH proizvoda.
//
// LAYOUT: dvije ploče (lijevo biraš, desno vidiš šta gradiš) — isti obrazac
// koji repo već koristi u MaterialSelectModal. Razlog: projekti ovdje imaju
// i po 74 proizvoda, pa se bez stalno vidljivog izbora izgubiš šta si čekirao.
//
// Grupe su SKUPLJENE po defaultu; pretraga ih otvara. Rendering 500 redova
// odjednom je i nečitljiv i spor.
//
// Radnik-dani dolaze iz PONUDE (dani × radnici × količina). Ekipa je odvojena
// odluka: 4 radnik-dana s 4 čovjeka = 1 dan, s 2 čovjeka = 2 dana — zato se
// trajanje računa UŽIVO dok se biraju radnici.
// ════════════════════════════════════════════════════════════════════

import { useState, useMemo, useEffect } from 'react';
import {
    Search, Package, Users, AlertTriangle, ChevronRight, X, Minus, Plus, Calendar, Check,
} from 'lucide-react';
import Modal from '@/components/ui/Modal';
import type { Project, Worker, WorkOrder, PlanBlock, ProductionSnapshot } from '@/lib/types';
import {
    collectProductCandidates, groupCandidatesByProject, blockDataFromProducts,
    type SelectedProduct, type ProductCandidate,
} from '@/lib/canvas/fromProducts';
import { suggestDurationForCandidate, type DurationSuggestion } from '@/lib/canvas/suggest';
import { workingDaysNeeded, endFromWork } from '@/lib/canvas/model';
import { getProductionSnapshots } from '@/lib/services';
import { useAuth } from '@/context/AuthContext';
import './ProductPickerModal.css';

interface ProductPickerModalProps {
    isOpen: boolean;
    projects: Project[];
    workers: Worker[];
    workOrders: WorkOrder[];
    startISO: string;
    isSaturdayWorking?: (d: Date) => boolean;
    onClose: () => void;
    onCreate: (data: Partial<PlanBlock>) => void;
}

const dm = (iso: string) => {
    const [, m, d] = iso.split('-');
    return `${Number(d)}.${Number(m)}.`;
};

export default function ProductPickerModal({
    isOpen, projects, workers, workOrders, startISO, isSaturdayWorking, onClose, onCreate,
}: ProductPickerModalProps) {
    const { organization } = useAuth();
    const orgId = organization?.Organization_ID || '';

    const [search, setSearch] = useState('');
    const [workerSearch, setWorkerSearch] = useState('');
    const [onlyAvailable, setOnlyAvailable] = useState(true);
    const [picked, setPicked] = useState<Map<string, number>>(new Map());
    const [workerIds, setWorkerIds] = useState<Set<string>>(new Set());
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    // Ručna/predložena zamjena radnik-dana po komadu — SAMO za ovu sesiju modala,
    // ne mijenja ponudu ni proizvod u bazi.
    const [overrides, setOverrides] = useState<Map<string, number>>(new Map());
    const [snapshots, setSnapshots] = useState<ProductionSnapshot[]>([]);

    useEffect(() => {
        if (!isOpen) {
            setPicked(new Map()); setWorkerIds(new Set());
            setSearch(''); setWorkerSearch(''); setExpanded(new Set());
            setOverrides(new Map()); setSnapshots([]);
        }
    }, [isOpen]);

    // Snapshoti se učitavaju samo kad zatrebaju (proizvod bez plana u ponudi) —
    // modal se ne mora otvarati na kompletnu istoriju organizacije.
    useEffect(() => {
        if (!isOpen || !orgId) return;
        let alive = true;
        getProductionSnapshots(orgId).then(s => { if (alive) setSnapshots(s); }).catch(() => {});
        return () => { alive = false; };
    }, [isOpen, orgId]);

    const candidates = useMemo(
        () => collectProductCandidates(projects, workOrders),
        [projects, workOrders]
    );
    const groups = useMemo(
        () => groupCandidatesByProject(candidates, { onlyAvailable, search }),
        [candidates, onlyAvailable, search]
    );

    const searching = search.trim().length > 0;
    const isOpenGroup = (id: string) => searching || expanded.has(id);

    const selected: SelectedProduct[] = useMemo(() => {
        const byId = new Map(candidates.map(c => [c.productId, c]));
        return Array.from(picked.entries())
            .map(([id, qty]) => {
                const candidate = byId.get(id);
                if (!candidate) return null;
                const override = overrides.get(id);
                // Prijedlog/ručni unos mijenja SAMO ovaj odabir, ne ponudu ni proizvod.
                return {
                    candidate: override !== undefined
                        ? { ...candidate, workerDaysPerUnit: override, missingLabor: false }
                        : candidate,
                    qty,
                };
            })
            .filter((s): s is SelectedProduct => !!s && s.qty > 0);
    }, [picked, candidates, overrides]);

    const data = useMemo(() => blockDataFromProducts(selected), [selected]);

    // Prijedlog se traži SAMO za ono što je stvarno u nalogu i bez plana —
    // ne za svih 74 proizvoda projekta.
    const suggestions = useMemo(() => {
        const out = new Map<string, DurationSuggestion | null>();
        for (const [id] of picked) {
            const original = candidates.find(c => c.productId === id);
            if (original?.missingLabor && !overrides.has(id)) {
                out.set(id, suggestDurationForCandidate(original, snapshots));
            }
        }
        return out;
    }, [picked, candidates, overrides, snapshots]);

    const applySuggestion = (productId: string, workerDaysPerUnit: number) =>
        setOverrides(prev => new Map(prev).set(productId, workerDaysPerUnit));

    const activeWorkers = useMemo(() => {
        const q = workerSearch.trim().toLowerCase();
        return workers
            .filter(w => w.Status === 'Aktivan' || w.Status === 'Dostupan')
            .filter(w => !q || (w.Name || '').toLowerCase().includes(q))
            .sort((a, b) => (a.Name || '').localeCompare(b.Name || '', 'hr'));
    }, [workers, workerSearch]);

    const crew = Math.max(1, workerIds.size);
    const days = data.workerDays > 0 ? workingDaysNeeded(data.workerDays, crew) : 0;
    const endISO = data.workerDays > 0
        ? endFromWork(startISO, data.workerDays, crew, isSaturdayWorking)
        : startISO;

    const setQty = (productId: string, qty: number, maxQty: number) =>
        setPicked(prev => {
            const next = new Map(prev);
            const clamped = Math.min(Math.max(1, qty), Math.max(1, maxQty));
            next.set(productId, clamped);
            return next;
        });

    const toggle = (productId: string, maxQty: number) =>
        setPicked(prev => {
            const next = new Map(prev);
            if (next.has(productId)) next.delete(productId);
            else next.set(productId, Math.max(1, maxQty));
            return next;
        });

    const create = () => {
        onCreate({
            ...data,
            workerRefs: workers
                .filter(w => workerIds.has(w.Worker_ID))
                .map(w => ({ id: w.Worker_ID, name: w.Name })),
            crew,
            startISO,
            endISO,
        });
        onClose();
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={<><Package size={17} /> Novi nalog</>}
            size="xl"
            footer={
                <div className="pp-foot">
                    <div className="pp-foot-calc">
                        {selected.length === 0 ? (
                            <span className="pp-foot-hint">Izaberi proizvode s lijeve strane</span>
                        ) : data.workerDays > 0 ? (
                            <>
                                <strong>{data.workerDays}</strong> radnik-dana
                                <span className="pp-sep">÷</span>
                                <strong>{crew}</strong> {crew === 1 ? 'radnik' : 'radnika'}
                                <span className="pp-sep">=</span>
                                <strong>{days}</strong> {days === 1 ? 'radni dan' : 'radnih dana'}
                                <span className="pp-foot-dates">
                                    <Calendar size={13} /> {dm(startISO)} – {dm(endISO)}
                                </span>
                            </>
                        ) : (
                            <span className="pp-foot-hint warn">
                                <AlertTriangle size={13} /> Nema planiranih dana u ponudi — trajanje unesi ručno
                            </span>
                        )}
                    </div>
                    <div className="pp-foot-actions">
                        <button className="btn btn-secondary" onClick={onClose}>Odustani</button>
                        <button className="btn btn-primary" disabled={selected.length === 0} onClick={create}>
                            Kreiraj nalog
                        </button>
                    </div>
                </div>
            }
        >
            {/* Jedno dijete: .modal-xl .modal-body je `display:flex; justify-content:center`
                (napravljeno za .offer-form), pa bi više siblinga bilo razbacano u kolone. */}
            <div className="pp-shell">
                {/* ── Lijevo: izbor ───────────────────────────── */}
                <section className="pp-pane pp-pane-pick">
                    <header className="pp-pane-head">
                        <div className="pp-search">
                            <Search size={15} />
                            <input placeholder="Traži proizvod ili projekt…" value={search}
                                onChange={e => setSearch(e.target.value)} autoFocus />
                            {search && (
                                <button className="pp-clear" onClick={() => setSearch('')} aria-label="Očisti">
                                    <X size={13} />
                                </button>
                            )}
                        </div>
                        <button
                            className={`pp-toggle${onlyAvailable ? ' on' : ''}`}
                            onClick={() => setOnlyAvailable(v => !v)}
                        >
                            Samo neraspoređeni
                        </button>
                    </header>

                    <div className="pp-scroll">
                        {groups.length === 0 && (
                            <p className="pp-empty">
                                {onlyAvailable
                                    ? 'Nema neraspoređenih proizvoda. Isključi filter da vidiš sve.'
                                    : 'Ništa ne odgovara pretrazi.'}
                            </p>
                        )}

                        {groups.map(g => {
                            const open = isOpenGroup(g.projectId);
                            const pickedHere = g.items.filter(i => picked.has(i.productId)).length;
                            return (
                                <div key={g.projectId} className="pp-group">
                                    <button className="pp-group-head"
                                        onClick={() => setExpanded(prev => {
                                            const next = new Set(prev);
                                            if (next.has(g.projectId)) next.delete(g.projectId);
                                            else next.add(g.projectId);
                                            return next;
                                        })}>
                                        <ChevronRight size={14} className={open ? 'rot' : ''} />
                                        <strong>{g.projectName}</strong>
                                        <span className="pp-group-meta">
                                            {g.items.length} · {g.availableWorkerDays} rd
                                        </span>
                                        {pickedHere > 0 && <span className="pp-group-count">{pickedHere}</span>}
                                    </button>

                                    {open && g.items.map(c => {
                                        const on = picked.has(c.productId);
                                        return (
                                            <div key={c.productId}
                                                className={`pp-row${on ? ' on' : ''}`}
                                                onClick={() => toggle(c.productId, c.availableQty)}
                                                role="button" tabIndex={0}
                                                onKeyDown={e => {
                                                    if (e.key === 'Enter' || e.key === ' ') {
                                                        e.preventDefault();
                                                        toggle(c.productId, c.availableQty);
                                                    }
                                                }}>
                                                <span className={`pp-box${on ? ' on' : ''}`} />
                                                <span className="pp-name" title={c.productName}>{c.productName}</span>
                                                <span className="pp-avail">{c.availableQty}/{c.totalQty}</span>
                                                {c.missingLabor
                                                    ? <span className="pp-tag warn" title="Ponuda nema planirane dane">bez plana</span>
                                                    : <span className="pp-tag">{c.workerDaysPerUnit} rd</span>}
                                            </div>
                                        );
                                    })}
                                </div>
                            );
                        })}
                    </div>
                </section>

                {/* ── Desno: šta gradiš ───────────────────────── */}
                <section className="pp-pane pp-pane-cart">
                    <header className="pp-pane-head">
                        <h4 className="pp-cart-title">
                            U nalogu
                            {selected.length > 0 && <span className="pp-group-count">{selected.length}</span>}
                        </h4>
                    </header>

                    <div className="pp-scroll">
                        {selected.length === 0 ? (
                            <p className="pp-empty">Još ništa nije izabrano.</p>
                        ) : (
                            <ul className="pp-cart">
                                {selected.map(s => {
                                    const suggestion = suggestions.get(s.candidate.productId);
                                    return (
                                        <li key={s.candidate.productId} className="pp-cart-item">
                                            <div className="pp-cart-row">
                                                <div className="pp-cart-main">
                                                    <span className="pp-name" title={s.candidate.productName}>
                                                        {s.candidate.productName}
                                                    </span>
                                                    <span className="pp-cart-sub">
                                                        {s.candidate.projectName}
                                                        {s.candidate.workerDaysPerUnit > 0 && (
                                                            <> · {s.candidate.workerDaysPerUnit * s.qty} rd</>
                                                        )}
                                                    </span>
                                                </div>
                                                <div className="pp-stepper">
                                                    <button onClick={() => setQty(s.candidate.productId, s.qty - 1, s.candidate.availableQty)}
                                                        disabled={s.qty <= 1} aria-label="Manje"><Minus size={12} /></button>
                                                    <span>{s.qty}</span>
                                                    <button onClick={() => setQty(s.candidate.productId, s.qty + 1, s.candidate.availableQty)}
                                                        disabled={s.qty >= Math.max(1, s.candidate.availableQty)} aria-label="Više">
                                                        <Plus size={12} />
                                                    </button>
                                                </div>
                                                <button className="pp-remove"
                                                    onClick={() => toggle(s.candidate.productId, s.candidate.availableQty)}
                                                    aria-label="Ukloni"><X size={14} /></button>
                                            </div>

                                            {/* Proizvod bez plana u ponudi — prijedlog iz istorije, primjenjuje se
                                                jednim klikom i mijenja SAMO ovaj odabir, ne ponudu ni proizvod. */}
                                            {s.candidate.missingLabor && (
                                                suggestion ? (
                                                    <button className="pp-suggest"
                                                        onClick={() => applySuggestion(s.candidate.productId, suggestion.workerDaysPerUnit)}>
                                                        <Check size={11} />
                                                        Iz istorije: <strong>{suggestion.workerDaysPerUnit} rd/kom</strong>
                                                        <span className="pp-suggest-desc">({suggestion.description})</span>
                                                    </button>
                                                ) : (
                                                    <p className="pp-cart-nosuggest">
                                                        <AlertTriangle size={11} /> Nema uporedivog posla u istoriji — unesi ručno u detaljima.
                                                    </p>
                                                )
                                            )}
                                        </li>
                                    );
                                })}
                            </ul>
                        )}

                        {data.missingLaborCount > 0 && (
                            <p className="pp-note warn">
                                <AlertTriangle size={12} />
                                {data.missingLaborCount} proizvod(a) bez plana rada u ponudi — trajanje je potcijenjeno.
                            </p>
                        )}

                        <div className="pp-crew">
                            <div className="pp-crew-head">
                                <Users size={13} />
                                <span>Ekipa</span>
                                {workerIds.size > 0 && <span className="pp-group-count">{workerIds.size}</span>}
                            </div>
                            <div className="pp-search sm">
                                <Search size={13} />
                                <input placeholder="Traži radnika…" value={workerSearch}
                                    onChange={e => setWorkerSearch(e.target.value)} />
                            </div>
                            <div className="pp-crew-list">
                                {activeWorkers.length === 0 && (
                                    <p className="pp-empty sm">Nema radnika.</p>
                                )}
                                {activeWorkers.map(w => {
                                    const on = workerIds.has(w.Worker_ID);
                                    return (
                                        <div key={w.Worker_ID}
                                            className={`pp-crew-row${on ? ' on' : ''}`}
                                            role="button" tabIndex={0}
                                            onClick={() => setWorkerIds(prev => {
                                                const next = new Set(prev);
                                                if (next.has(w.Worker_ID)) next.delete(w.Worker_ID);
                                                else next.add(w.Worker_ID);
                                                return next;
                                            })}
                                            onKeyDown={e => {
                                                if (e.key !== 'Enter' && e.key !== ' ') return;
                                                e.preventDefault();
                                                setWorkerIds(prev => {
                                                    const next = new Set(prev);
                                                    if (next.has(w.Worker_ID)) next.delete(w.Worker_ID);
                                                    else next.add(w.Worker_ID);
                                                    return next;
                                                });
                                            }}>
                                            <span className={`pp-box${on ? ' on' : ''}`} />
                                            <span className="pp-name">{w.Name}</span>
                                            {w.Role && <span className="pp-tag">{w.Role}</span>}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </section>
            </div>
        </Modal>
    );
}
