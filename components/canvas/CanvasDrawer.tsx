'use client';

// ════════════════════════════════════════════════════════════════════
// CanvasDrawer — detalji izabranog bloka.
//
// Zamjenjuje tri ručna portal-modala starog planera. Bočna ploča, ne modal:
// planiranje je uređivanje uz pogled na cjelinu — modal bi sakrio platno baš
// kad korisniku treba kontekst oko bloka koji mijenja.
// ════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import {
    X, Trash2, Lock, Unlock, Users, FolderKanban, Truck, Link2, Plus, Check,
    Package, ShoppingCart, Info, Sparkles,
} from 'lucide-react';
import type {
    PlanBlock, PlanLink, PlanLinkKind, Project, Worker, Supplier, TaskPriority,
} from '@/lib/types';
import { TASK_PRIORITY_LABELS } from '@/lib/types';
import {
    BLOCK_LABEL, BLOCK_HELP, blockDurationDays, endFromWork, workingDaysNeeded,
    addDays, orderByFromDelivery,
} from '@/lib/canvas/model';
import { suggestLeadDays, type SupplierLeadTime } from '@/lib/canvas/leadTime';
import type { BlockStatusInfo } from '@/lib/canvas/status';
import CrewPicker from './CrewPicker';

const PRIORITIES: TaskPriority[] = ['low', 'medium', 'high', 'urgent'];

interface CanvasDrawerProps {
    block: PlanBlock | null;
    /** Živi status stvarnog naloga/narudžbe iza bloka; null = nacrt (nije pretvoren). */
    status: BlockStatusInfo | null;
    allBlocks: PlanBlock[];
    links: PlanLink[];
    projects: Project[];
    workers: Worker[];
    suppliers: Supplier[];
    leadTimes: Map<string, SupplierLeadTime>;
    onClose: () => void;
    onChange: (patch: Partial<PlanBlock>) => void;
    onDelete: () => void;
    onAddLink: (from: string, to: string, kind: PlanLinkKind) => void;
    onDeleteLink: (linkId: string) => void;
    onSelectBlock: (blockId: string) => void;
    /** Otvara kreiranje narudžbi iz sastavnice proizvoda ovog naloga. */
    onCreateOrders: () => void;
    /** Pretvori blok u stvarni nalog/narudžbu (otvara PromoteBlockModal). */
    onPromote: () => void;
}

const dm = (iso: string) => {
    const [, m, d] = iso.split('-');
    return `${Number(d)}.${Number(m)}.`;
};

/**
 * Vrsta veze se IZVODI iz vrsta blokova — korisnik ne treba birati nešto što
 * je iz konteksta očito, a pogrešan izbor bi tiho pokvario lančani preračun.
 */
function inferLinkKind(from: PlanBlock, to: PlanBlock): PlanLinkKind {
    if (from.kind === 'purchase') return 'delivery-to-start';
    if (to.kind === 'montaza') return 'finish-to-montaza';
    return 'finish-to-start';
}

export default function CanvasDrawer({
    block, status, allBlocks, links, projects, workers, suppliers, leadTimes,
    onClose, onChange, onDelete, onAddLink, onDeleteLink, onSelectBlock, onCreateOrders, onPromote,
}: CanvasDrawerProps) {
    const [crewPickerOpen, setCrewPickerOpen] = useState(false);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            const el = document.activeElement;
            // Esc iz polja prvo napušta polje, tek onda zatvara ploču
            if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
                (el as HTMLElement).blur();
                return;
            }
            onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const activeWorkers = useMemo(
        () => workers.filter(w => w.Status === 'Aktivan' || w.Status === 'Dostupan')
            .sort((a, b) => (a.Name || '').localeCompare(b.Name || '', 'hr')),
        [workers]
    );
    const sortedProjects = useMemo(
        () => [...projects].filter(p => !p.Hidden)
            .sort((a, b) => (a.Name || a.Client_Name || '').localeCompare(b.Name || b.Client_Name || '', 'hr')),
        [projects]
    );
    const sortedSuppliers = useMemo(
        () => [...suppliers].sort((a, b) => (a.Name || '').localeCompare(b.Name || '', 'hr')),
        [suppliers]
    );

    const blockId = block?.id;
    const related = useMemo(() => {
        if (!blockId) return { incoming: [], outgoing: [] };
        const byId = new Map(allBlocks.map(b => [b.id, b]));
        return {
            incoming: links.filter(l => l.to === blockId).map(l => ({ link: l, other: byId.get(l.from) })),
            outgoing: links.filter(l => l.from === blockId).map(l => ({ link: l, other: byId.get(l.to) })),
        };
    }, [blockId, links, allBlocks]);

    const linkable = useMemo(() => {
        if (!block) return [];
        const connected = new Set(
            links.filter(l => l.from === block.id || l.to === block.id)
                .map(l => (l.from === block.id ? l.to : l.from))
        );
        return allBlocks
            .filter(b => b.id !== block.id && !connected.has(b.id) && b.kind !== 'note')
            .sort((a, b) => a.startISO.localeCompare(b.startISO));
    }, [block, allBlocks, links]);

    const leadSuggestion = useMemo(
        () => (block?.kind === 'purchase' ? suggestLeadDays(block.supplierRef?.name, leadTimes) : null),
        [block?.kind, block?.supplierRef?.name, leadTimes]
    );

    if (!block) return null;

    const isWork = block.kind === 'order' || block.kind === 'montaza';
    const isPurchase = block.kind === 'purchase';
    const promoted = !!(block.linkedWorkOrderId || block.linkedOrderId);
    const liveStatus = status && status.status !== 'draft' ? status : null;
    const crew = block.crew || (block.workerRefs?.length || 1);
    const workerIds = new Set((block.workerRefs || []).map(w => w.id).filter(Boolean) as string[]);

    /** Prepiši kraj iz posla — korisnik je unio radnik-dane i ekipu, a ne datum. */
    const recalcEnd = (workerDays: number, crewSize: number) => {
        onChange({
            workerDays,
            crew: crewSize,
            endISO: endFromWork(block.startISO, workerDays, crewSize),
        });
    };

    /** Narudžba: dolazak = slanje + rok. Oba se drže usklađena. */
    const applyLead = (leadDays: number) => {
        const end = addDays(block.startISO, Math.max(0, leadDays));
        onChange({ leadDays, endISO: end, orderByISO: block.startISO });
    };

    const toggleWorker = (w: Worker) => {
        const has = workerIds.has(w.Worker_ID);
        const next = has
            ? (block.workerRefs || []).filter(r => r.id !== w.Worker_ID)
            : [...(block.workerRefs || []), { id: w.Worker_ID, name: w.Name }];
        // Ekipa prati broj ljudi — inače korisnik doda trećeg čovjeka a trajanje
        // ostane isto, što je gotovo uvijek pogrešno.
        const patch: Partial<PlanBlock> = { workerRefs: next };
        if (isWork && block.workerDays) {
            const c = Math.max(1, next.length);
            patch.crew = c;
            patch.endISO = endFromWork(block.startISO, block.workerDays, c);
        }
        onChange(patch);
    };

    return (
        <aside className="cv-drawer" role="complementary" aria-label="Detalji bloka">
            <header className="cv-drawer-head">
                <span className={`cv-kind-chip k-${block.kind}`}>{BLOCK_LABEL[block.kind]}</span>
                <button className="cv-icon-btn" onClick={onClose} aria-label="Zatvori"><X size={17} /></button>
            </header>

            <div className="cv-drawer-body">
                {/* Vrsta bloka nije očita iz boje — jedna rečenica uklanja nagađanje */}
                <p className="cv-kind-help"><Info size={12} /> {BLOCK_HELP[block.kind]}</p>

                {/* ── Pretvori plan u stvarnost / živi status ──── */}
                {(isWork || isPurchase) && (
                    promoted ? (
                        <div className={`cv-status-note s-${liveStatus?.status || 'pending'}`}>
                            <span className="cv-status-note-dot" />
                            <span className="cv-status-note-txt">
                                {block.linkedWorkOrderId ? 'Stvarni nalog' : 'Stvarna narudžba'}
                                {liveStatus?.ref ? ` ${liveStatus.ref}` : ''}
                                <b> · {liveStatus?.label || 'kreirano'}</b>
                            </span>
                        </div>
                    ) : (
                        <button className="cv-btn full promote" onClick={onPromote}>
                            {isPurchase ? <ShoppingCart size={14} /> : <Package size={14} />}
                            {isPurchase ? 'Naruči stvarno (kreiraj narudžbu)' : 'Kreiraj stvarni nalog'}
                        </button>
                    )
                )}
                <label className="cv-field">
                    <span>Naziv</span>
                    <input value={block.title} autoFocus
                        onChange={e => onChange({ title: e.target.value })} />
                </label>

                <div className="cv-field-row">
                    <label className="cv-field">
                        <span>{isPurchase ? 'Naruči' : 'Početak'}</span>
                        <input type="date" value={block.startISO}
                            onChange={e => {
                                if (!e.target.value) return;
                                onChange(isPurchase
                                    ? { startISO: e.target.value, orderByISO: e.target.value }
                                    : { startISO: e.target.value });
                            }} />
                    </label>
                    {block.kind !== 'milestone' && (
                        <label className="cv-field">
                            <span>{isPurchase ? 'Stiže' : 'Kraj'}</span>
                            <input type="date" value={block.endISO} min={block.startISO}
                                onChange={e => e.target.value && onChange({ endISO: e.target.value })} />
                        </label>
                    )}
                </div>

                {block.kind !== 'milestone' && !isPurchase && (
                    <p className="cv-hint">Trajanje: {blockDurationDays(block)} kalendarskih dana</p>
                )}

                {/* ── Narudžba ─────────────────────────────────── */}
                {isPurchase && (
                    <>
                        <label className="cv-field">
                            <span><Truck size={12} /> Dobavljač</span>
                            <select
                                value={block.supplierRef?.id || ''}
                                onChange={e => {
                                    const s = sortedSuppliers.find(x => x.Supplier_ID === e.target.value);
                                    onChange({ supplierRef: s ? { id: s.Supplier_ID, name: s.Name } : undefined });
                                }}
                            >
                                <option value="">— bez dobavljača —</option>
                                {sortedSuppliers.map(s => (
                                    <option key={s.Supplier_ID} value={s.Supplier_ID}>{s.Name}</option>
                                ))}
                            </select>
                        </label>

                        <label className="cv-field">
                            <span>Rok isporuke (dana)</span>
                            <input type="number" min={0} step={1}
                                value={block.leadDays ?? Math.max(0, blockDurationDays(block) - 1)}
                                onChange={e => applyLead(Math.max(0, Number(e.target.value) || 0))} />
                        </label>

                        {/* Iz istorije narudžbi — nikad broj bez uzorka */}
                        {leadSuggestion ? (
                            <button className="cv-suggest" onClick={() => applyLead(leadSuggestion.days)}>
                                <Check size={12} />
                                Iz istorije: <strong>{leadSuggestion.label}</strong>
                            </button>
                        ) : block.supplierRef?.name ? (
                            <p className="cv-hint">
                                Nema dovoljno primljenih narudžbi ovog dobavljača za pouzdan rok — upiši ručno.
                            </p>
                        ) : null}

                        <p className="cv-hint">
                            Narudžba mora otići <strong>{dm(block.orderByISO || block.startISO)}</strong>,
                            materijal stiže <strong>{dm(block.endISO)}</strong>.
                        </p>

                        <button className={`cv-btn full${block.isSent ? ' on' : ''}`}
                            onClick={() => onChange({ isSent: !block.isSent })}>
                            <Check size={14} />
                            {block.isSent ? 'Označeno kao poslano' : 'Označi kao poslano (samo u planu)'}
                        </button>
                    </>
                )}

                {/* ── Proizvodi naloga ─────────────────────────── */}
                {isWork && (block.productRefs?.length || 0) > 0 && (
                    <div className="cv-field">
                        <span><Package size={12} /> Proizvodi ({block.productRefs!.length})</span>
                        <ul className="cv-products">
                            {block.productRefs!.map((p, i) => (
                                <li key={p.id || `${p.name}-${i}`}>
                                    <span className="cv-prod-name">{p.name}</span>
                                    <span className="cv-prod-qty">{p.qty} kom</span>
                                </li>
                            ))}
                        </ul>
                        {/* Sastavnice su već u bazi — narudžbe se ne prekucavaju ručno */}
                        <button className="cv-btn full" onClick={onCreateOrders}>
                            <ShoppingCart size={14} /> Napravi narudžbe iz sastavnice
                        </button>
                    </div>
                )}

                {/* ── Rad ──────────────────────────────────────── */}
                {isWork && (
                    <>
                        <div className="cv-field-row">
                            <label className="cv-field">
                                <span>Radnik-dana</span>
                                <input type="number" min={0} step={0.5} value={block.workerDays ?? ''}
                                    placeholder="npr. 12"
                                    onChange={e => {
                                        if (!e.target.value) { onChange({ workerDays: undefined }); return; }
                                        const v = Number(e.target.value);
                                        if (isFinite(v)) recalcEnd(v, crew);
                                    }} />
                            </label>
                            <label className="cv-field">
                                <span>Ekipa</span>
                                <input type="number" min={1} step={1} value={crew}
                                    onChange={e => {
                                        const c = Math.max(1, Number(e.target.value) || 1);
                                        if (block.workerDays) recalcEnd(block.workerDays, c);
                                        else onChange({ crew: c });
                                    }} />
                            </label>
                        </div>
                        {!!block.workerDays && (
                            <p className="cv-hint">
                                {block.workerDays} radnik-dana ÷ {crew} = <strong>
                                    {workingDaysNeeded(block.workerDays, crew)} radnih dana
                                </strong> (nedjelja se preskače)
                            </p>
                        )}
                    </>
                )}

                <label className="cv-field">
                    <span><FolderKanban size={12} /> Projekt</span>
                    <select
                        value={block.projectRef?.id || ''}
                        onChange={e => {
                            const p = sortedProjects.find(x => x.Project_ID === e.target.value);
                            onChange({ projectRef: p ? { id: p.Project_ID, name: p.Name?.trim() || p.Client_Name } : undefined });
                        }}
                    >
                        <option value="">— bez projekta —</option>
                        {sortedProjects.map(p => (
                            <option key={p.Project_ID} value={p.Project_ID}>
                                {p.Name?.trim() || p.Client_Name}
                            </option>
                        ))}
                    </select>
                </label>

                {isWork && (
                    <div className="cv-field">
                        <span><Users size={12} /> Radnici (ručna dodjela)</span>
                        <div className="cv-chips">
                            {activeWorkers.map(w => (
                                <button key={w.Worker_ID}
                                    className={`cv-chip${workerIds.has(w.Worker_ID) ? ' on' : ''}`}
                                    onClick={() => toggleWorker(w)}>
                                    {w.Name}
                                </button>
                            ))}
                            {activeWorkers.length === 0 && <span className="cv-hint">Nema aktivnih radnika.</span>}
                        </div>
                    </div>
                )}

                {/* ── Auto-raspored ────────────────────────────── */}
                {isWork && (
                    <div className="cv-field cv-auto">
                        <span><Sparkles size={12} /> Auto-raspored</span>
                        <label className="cv-field">
                            <span>Prioritet</span>
                            <select value={block.priority || 'medium'}
                                onChange={e => onChange({ priority: e.target.value as TaskPriority })}>
                                {PRIORITIES.map(p => <option key={p} value={p}>{TASK_PRIORITY_LABELS[p]}</option>)}
                            </select>
                        </label>

                        <span className="cv-sub">Kandidat-ekipe (algoritam bira jednu)</span>
                        <div className="cv-chips">
                            {(block.crewOptions || []).map(c => (
                                <span key={c.id} className="cv-crew-chip">
                                    <Users size={11} />
                                    {c.lead.name}{c.helper ? ` + ${c.helper.name}` : ''}
                                    <X size={11} className="cv-crew-x"
                                        onClick={() => onChange({ crewOptions: (block.crewOptions || []).filter(x => x.id !== c.id) })} />
                                </span>
                            ))}
                            <button className="cv-chip add" onClick={() => setCrewPickerOpen(true)}>
                                <Plus size={12} /> ekipa
                            </button>
                        </div>

                        {(block.crewOptions?.length || 0) === 0 ? (
                            <p className="cv-hint">
                                Bez kandidat-ekipa ovaj nalog je RUČNI — „Rasporedi" ga preskače. Dodaj ekipe da uđe u auto-raspored.
                            </p>
                        ) : block.assignedCrewId ? (
                            <p className="cv-hint">
                                Zadnji raspored dodijelio: <strong>{(block.workerRefs || []).map(w => w.name).join(' + ') || '—'}</strong>
                            </p>
                        ) : null}
                    </div>
                )}

                {/* ── Veze ─────────────────────────────────────── */}
                <div className="cv-field">
                    <span><Link2 size={12} /> Šta ide prije/poslije (lanac)</span>

                    {related.incoming.length === 0 && related.outgoing.length === 0 && (
                        <p className="cv-hint">
                            Veza kaže šta mora <strong>prije</strong> da bi ovo moglo početi
                            (npr. narudžba materijala → proizvodnja). „Lanac" ih onda poreda po roku unazad.
                        </p>
                    )}

                    <ul className="cv-links">
                        {related.incoming.map(({ link, other }) => other && (
                            <li key={link.id}>
                                <span className="cv-link-dir">prije</span>
                                <button className="cv-link-name" onClick={() => onSelectBlock(other.id)}>
                                    {other.title}
                                </button>
                                <button className="cv-icon-btn sm" onClick={() => onDeleteLink(link.id)}
                                    aria-label="Ukloni vezu"><X size={13} /></button>
                            </li>
                        ))}
                        {related.outgoing.map(({ link, other }) => other && (
                            <li key={link.id}>
                                <span className="cv-link-dir after">poslije</span>
                                <button className="cv-link-name" onClick={() => onSelectBlock(other.id)}>
                                    {other.title}
                                </button>
                                <button className="cv-icon-btn sm" onClick={() => onDeleteLink(link.id)}
                                    aria-label="Ukloni vezu"><X size={13} /></button>
                            </li>
                        ))}
                    </ul>

                    {linkable.length > 0 && (
                        <select className="cv-link-add" value=""
                            onChange={e => {
                                const target = linkable.find(b => b.id === e.target.value);
                                if (!target) return;
                                // Smjer: raniji blok je prethodnik. Vrsta veze se izvodi iz vrsta.
                                const [from, to] = target.startISO < block.startISO
                                    ? [target, block] : [block, target];
                                onAddLink(from.id, to.id, inferLinkKind(from, to));
                            }}>
                            <option value="">+ Dodaj vezu (šta ide prije/poslije)…</option>
                            {linkable.map(b => (
                                <option key={b.id} value={b.id}>
                                    {BLOCK_LABEL[b.kind]}: {b.title} ({dm(b.startISO)})
                                </option>
                            ))}
                        </select>
                    )}
                </div>

                <label className="cv-field">
                    <span>Napomena</span>
                    <textarea rows={3} value={block.notes || ''}
                        onChange={e => onChange({ notes: e.target.value })} />
                </label>

                <button className={`cv-btn full${block.locked ? ' on' : ''}`}
                    onClick={() => onChange({ locked: !block.locked })}>
                    {block.locked ? <Lock size={14} /> : <Unlock size={14} />}
                    {block.locked ? 'Zaključan — lanac ga ne pomjera' : 'Zaključaj (fiksan datum)'}
                </button>
            </div>

            <footer className="cv-drawer-foot">
                <button className="cv-btn danger full" onClick={onDelete}>
                    <Trash2 size={14} /> Obriši blok
                </button>
            </footer>

            <CrewPicker
                isOpen={crewPickerOpen}
                workers={workers}
                onClose={() => setCrewPickerOpen(false)}
                onAdd={crew => onChange({ crewOptions: [...(block.crewOptions || []), crew] })}
                title="Dodaj kandidat-ekipu"
            />
        </aside>
    );
}

export { orderByFromDelivery, Plus };
