'use client';

// ════════════════════════════════════════════════════════════════════
// PITANJA I NAPOMENE — jedan modal, dva OPSEGA:
//   • scope='project' (sa kartice PROJEKTA)  → sva pitanja, grupisana po proizvodu
//   • scope='product' (sa kartice PROIZVODA) → SAMO taj proizvod, bez ičeg drugog
//     (initialProductId prisutan → project-level chrome — checkbox za print,
//     naslovi grupa, „prikaži prazne" — se uopšte ne renderuje; nema smisla
//     kad korisnik traži jedan konkretan proizvod, ne cijeli projekat)
//
// Radi nad LOKALNOM kopijom (localNotes) za trenutan odziv; svaki potez se u
// pozadini perzistira (updateProductNotes) i osvježava ProjectsTab (badge-evi).
// Čista logika (add/update/sort/group/filter) je u lib/productNotes.ts.
// ════════════════════════════════════════════════════════════════════

import { useState, useMemo, useEffect, useRef, type ReactNode } from 'react';
import {
    Plus, Check, Trash2, CornerDownRight, Printer,
    Loader2, Pencil, ChevronDown,
} from 'lucide-react';
import Modal from './Modal';
import {
    addNote, updateNote, removeNote, toggleResolved,
    noteStatus, summarizeNotes, groupNotesByProduct, filterNotes,
    type ProductNoteStatus, type ProductNotesGroup,
} from '@/lib/productNotes';
import {
    PRODUCT_NOTE_AUDIENCES, PRODUCT_NOTE_AUDIENCE_LABELS,
    type Product, type ProductNote, type ProductNoteAudience,
} from '@/lib/types';
import { buildProjectNotesPrintHTML } from './projectNotesPrint';
import './ProjectNotesModal.css';

interface ProjectNotesModalProps {
    isOpen: boolean;
    onClose: () => void;
    projectName: string;
    products: Product[];
    organizationId: string;
    onRefresh: (...collections: string[]) => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
    /** Zadan = modal se skuplja na SAMO taj proizvod (ulaz s kartice proizvoda). */
    initialProductId?: string | null;
}

const STATUS_FILTERS: { key: ProductNoteStatus | 'all'; label: string }[] = [
    { key: 'all', label: 'Sve' },
    { key: 'open', label: 'Otvorena' },
    { key: 'answered', label: 'Odgovorena' },
    { key: 'resolved', label: 'Riješena' },
];

/** Sitna obojena tačka ispred naziva primaoca — jedini nosilac boje po primaocu. */
function AudienceDot({ audience }: { audience: ProductNoteAudience }) {
    return <span className={`pnm-dot aud-${audience}`} aria-hidden="true" />;
}

/**
 * Izbor primaoca — nativan <select> (potpuna tastatura/pristupačnost, i native
 * padajući meni koji nikad ne bude odsječen kontejnerom), ali oblika malog
 * bordiranog dugmeta s ručno iscrtanim strelicom umjesto nestiliziranog <select>-a
 * koji je ranije izgledao "slomljeno" kao lažna pilula.
 */
function AudiencePicker({ value, onChange, disabled }: {
    value: ProductNoteAudience; onChange: (a: ProductNoteAudience) => void; disabled?: boolean;
}) {
    return (
        <span className="pnm-audpick">
            <AudienceDot audience={value} />
            <select className="pnm-audpick-select" value={value} disabled={disabled}
                onChange={e => onChange(e.target.value as ProductNoteAudience)} title="Kome je upućeno">
                {PRODUCT_NOTE_AUDIENCES.map(a => (
                    <option key={a} value={a}>{PRODUCT_NOTE_AUDIENCE_LABELS[a]}</option>
                ))}
            </select>
            <ChevronDown size={11} className="pnm-audpick-chevron" />
        </span>
    );
}

export default function ProjectNotesModal({
    isOpen, onClose, projectName, products, organizationId, onRefresh, showToast, initialProductId,
}: ProjectNotesModalProps) {
    const scope: 'product' | 'project' = initialProductId ? 'product' : 'project';

    // Lokalna kopija Questions po proizvodu — inicijalizuje se pri otvaranju.
    const [localNotes, setLocalNotes] = useState<Record<string, ProductNote[]>>({});
    const [busy, setBusy] = useState(false);

    const [audienceFilter, setAudienceFilter] = useState<ProductNoteAudience | 'all'>('all');
    const [statusFilter, setStatusFilter] = useState<ProductNoteStatus | 'all'>('all');
    // „Prikaži prazne" — samo project-scope (proizvod bez pitanja da mu se doda prvo).
    const [showEmpty, setShowEmpty] = useState(false);

    // Odabir proizvoda za print — samo project-scope (product-scope uvijek printa taj jedan).
    const [selected, setSelected] = useState<Set<string>>(new Set());

    // Nacrt novog pitanja po proizvodu: { text, audience }.
    const [drafts, setDrafts] = useState<Record<string, { text: string; audience: ProductNoteAudience }>>({});
    // Koji odgovor se trenutno uređuje (noteId) + tekst.
    const [answering, setAnswering] = useState<Record<string, string>>({});
    // Koje pitanje se uređuje (noteId) + tekst.
    const [editing, setEditing] = useState<Record<string, string>>({});

    const productById = useMemo(() => new Map(products.map(p => [p.Product_ID, p])), [products]);

    // Init lokalne kopije pri otvaranju.
    useEffect(() => {
        if (!isOpen) return;
        const map: Record<string, ProductNote[]> = {};
        for (const p of products) map[p.Product_ID] = p.Questions ? [...p.Questions] : [];
        setLocalNotes(map);
        setSelected(new Set());
        setDrafts({});
        setAnswering({});
        setEditing({});
        setAudienceFilter('all');
        setStatusFilter('all');
        // Prazan projekt (ni jedno pitanje) → odmah pokaži sve proizvode, inače je
        // modal prazan bez načina da se doda prvo pitanje. (Product-scope ovo ignoriše.)
        setShowEmpty(products.every(p => (p.Questions?.length || 0) === 0));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    // ── Perzistencija (optimistično + upis u pozadini) ──────────────
    const persist = async (productId: string, next: ProductNote[]) => {
        setLocalNotes(prev => ({ ...prev, [productId]: next }));
        try {
            setBusy(true);
            const { updateProductNotes } = await import('@/lib/services');
            const res = await updateProductNotes(productId, next, organizationId);
            if (!res.success) showToast(res.message, 'error');
            onRefresh('projects');
        } catch {
            showToast('Greška pri spremanju napomena', 'error');
        } finally {
            setBusy(false);
        }
    };

    const nowISO = () => new Date().toISOString();

    // ── Akcije ──────────────────────────────────────────────────────
    const submitDraft = (productId: string) => {
        const d = drafts[productId];
        if (!d || !d.text.trim()) return;
        const next = addNote(localNotes[productId], { Text: d.text, Audience: d.audience }, nowISO());
        persist(productId, next);
        setDrafts(prev => ({ ...prev, [productId]: { text: '', audience: d.audience } }));
    };

    const saveAnswer = (productId: string, noteId: string) => {
        const text = answering[noteId] ?? '';
        const next = updateNote(localNotes[productId], noteId, { Answer: text }, nowISO());
        persist(productId, next);
        setAnswering(prev => { const n = { ...prev }; delete n[noteId]; return n; });
    };

    const saveEdit = (productId: string, noteId: string) => {
        const text = editing[noteId] ?? '';
        if (text.trim()) persist(productId, updateNote(localNotes[productId], noteId, { Text: text }, nowISO()));
        setEditing(prev => { const n = { ...prev }; delete n[noteId]; return n; });
    };

    const setAudience = (productId: string, noteId: string, audience: ProductNoteAudience) =>
        persist(productId, updateNote(localNotes[productId], noteId, { Audience: audience }, nowISO()));

    const toggle = (productId: string, noteId: string) =>
        persist(productId, toggleResolved(localNotes[productId], noteId, nowISO()));

    const remove = (productId: string, noteId: string) =>
        persist(productId, removeNote(localNotes[productId], noteId));

    // ── Izvedeno za prikaz ──────────────────────────────────────────
    const localProducts = useMemo(
        () => products.map(p => ({ Product_ID: p.Product_ID, Name: p.Name, Questions: localNotes[p.Product_ID] || [] })),
        [products, localNotes]
    );

    const groups = useMemo(() => {
        const all = groupNotesByProduct(localProducts, { includeEmpty: true });
        const filtered = all.map(g => ({ ...g, notes: filterNotes(g.notes, { audience: audienceFilter, status: statusFilter }) }));
        // PRODUCT-SCOPE: isključivo taj proizvod — ništa drugo se ne renderuje,
        // ni prazno ni puno (to je cijela poenta ove ispravke).
        if (scope === 'product') return filtered.filter(g => g.productId === initialProductId);
        return filtered.filter(g => g.notes.length > 0 || showEmpty);
    }, [localProducts, audienceFilter, statusFilter, initialProductId, showEmpty, scope]);

    const projectSummary = useMemo(() => {
        const flat: ProductNote[] = [];
        for (const p of localProducts) flat.push(...p.Questions);
        return summarizeNotes(flat);
    }, [localProducts]);

    const scopedProduct = scope === 'product' ? productById.get(initialProductId!) : null;
    const scopedSummary = scope === 'product' ? summarizeNotes(localNotes[initialProductId!]) : projectSummary;

    const toggleSelect = (productId: string) => setSelected(prev => {
        const n = new Set(prev); n.has(productId) ? n.delete(productId) : n.add(productId); return n;
    });

    const handlePrint = () => {
        const onlyIds = scope === 'product' ? new Set([initialProductId!]) : (selected.size > 0 ? selected : undefined);
        const printGroups = groupNotesByProduct(localProducts, { onlyProductIds: onlyIds });
        if (printGroups.length === 0) { showToast('Nema pitanja za print', 'info'); return; }
        const html = buildProjectNotesPrintHTML(projectName, printGroups);
        const iframe = document.createElement('iframe');
        iframe.style.cssText = 'position:absolute;top:-9999px;left:-9999px;width:210mm;height:297mm;';
        document.body.appendChild(iframe);
        const doc = iframe.contentDocument || iframe.contentWindow?.document;
        if (!doc) { document.body.removeChild(iframe); return; }
        doc.open(); doc.write(html); doc.close();
        setTimeout(() => {
            iframe.contentWindow?.focus();
            iframe.contentWindow?.print();
            setTimeout(() => document.body.removeChild(iframe), 1000);
        }, 250);
    };

    const audienceChips: (ProductNoteAudience | 'all')[] = ['all', ...PRODUCT_NOTE_AUDIENCES];
    const printLabel = scope === 'product' ? 'Printaj' : (selected.size > 0 ? `Printaj (${selected.size})` : 'Printaj sve');

    // ── Jedan pitanje-red — dijeli ga project i product opseg ────────
    const renderNote = (g: ProductNotesGroup, n: ProductNote): ReactNode => {
        const st = noteStatus(n);
        const isEditing = editing[n.id] !== undefined;
        const isAnswering = answering[n.id] !== undefined;
        return (
            <div key={n.id} className={`pnm-note st-${st}`}>
                <button className={`pnm-check${n.Resolved ? ' on' : ''}`} disabled={busy}
                    onClick={() => toggle(g.productId, n.id)}
                    title={n.Resolved ? 'Vrati u otvorena' : 'Označi riješenim'}>
                    {n.Resolved && <Check size={12} strokeWidth={3} />}
                </button>

                <div className="pnm-note-body">
                    <div className="pnm-note-top">
                        {isEditing ? (
                            <input autoFocus className="pnm-edit-input" value={editing[n.id]}
                                onChange={e => setEditing(p => ({ ...p, [n.id]: e.target.value }))}
                                onBlur={() => saveEdit(g.productId, n.id)}
                                onKeyDown={e => {
                                    if (e.key === 'Enter') saveEdit(g.productId, n.id);
                                    if (e.key === 'Escape') setEditing(p => { const x = { ...p }; delete x[n.id]; return x; });
                                }} />
                        ) : (
                            <span className={`pnm-note-text${n.Resolved ? ' done' : ''}`}
                                onDoubleClick={() => setEditing(p => ({ ...p, [n.id]: n.Text }))}>
                                {n.Text}
                            </span>
                        )}
                        <div className="pnm-note-actions">
                            <button className="pnm-icon" title="Uredi pitanje" disabled={busy}
                                onClick={() => setEditing(p => ({ ...p, [n.id]: n.Text }))}>
                                <Pencil size={13} />
                            </button>
                            <button className="pnm-icon danger" title="Obriši" disabled={busy}
                                onClick={() => remove(g.productId, n.id)}>
                                <Trash2 size={13} />
                            </button>
                        </div>
                    </div>

                    <div className="pnm-note-meta">
                        <AudiencePicker value={n.Audience} disabled={busy}
                            onChange={a => setAudience(g.productId, n.id, a)} />
                    </div>

                    {/* Odgovor — mjehurić „poruke", uvučen ispod pitanja */}
                    {isAnswering ? (
                        <div className="pnm-answer-edit">
                            <input autoFocus className="pnm-answer-input" placeholder="Upiši odgovor…"
                                value={answering[n.id]}
                                onChange={e => setAnswering(p => ({ ...p, [n.id]: e.target.value }))}
                                onKeyDown={e => {
                                    if (e.key === 'Enter') saveAnswer(g.productId, n.id);
                                    if (e.key === 'Escape') setAnswering(p => { const x = { ...p }; delete x[n.id]; return x; });
                                }} />
                            <button className="pnm-answer-save" onClick={() => saveAnswer(g.productId, n.id)}>Spremi</button>
                        </div>
                    ) : n.Answer ? (
                        <button className="pnm-answer" onClick={() => setAnswering(p => ({ ...p, [n.id]: n.Answer || '' }))}
                            title="Klikni za izmjenu odgovora">
                            <CornerDownRight size={13} className="pnm-answer-icon" />
                            <span className="pnm-answer-text">{n.Answer}</span>
                        </button>
                    ) : (
                        <button className="pnm-answer-add" onClick={() => setAnswering(p => ({ ...p, [n.id]: '' }))}>
                            <CornerDownRight size={12} /> Dodaj odgovor
                        </button>
                    )}
                </div>
            </div>
        );
    };

    // ── Traka za dodavanje novog pitanja ──────────────────────────────
    const renderComposer = (productId: string): ReactNode => {
        const draft = drafts[productId] || { text: '', audience: 'client' as ProductNoteAudience };
        return (
            <div className="pnm-add">
                <AudiencePicker value={draft.audience}
                    onChange={a => setDrafts(p => ({ ...p, [productId]: { ...draft, audience: a } }))} />
                <input className="pnm-add-input" placeholder="Novo pitanje ili napomena…"
                    value={draft.text}
                    onChange={e => setDrafts(p => ({ ...p, [productId]: { ...draft, text: e.target.value } }))}
                    onKeyDown={e => { if (e.key === 'Enter') submitDraft(productId); }} />
                <button className="pnm-add-btn" disabled={!draft.text.trim() || busy} onClick={() => submitDraft(productId)}>
                    <Plus size={16} />
                </button>
            </div>
        );
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            size="large"
            title={
                scope === 'product'
                    ? <span className="pnm-title">{scopedProduct?.Name || 'Proizvod'}<span className="pnm-title-sub">{projectName}</span></span>
                    : <span className="pnm-title">Pitanja i napomene<span className="pnm-title-sub">{projectName}</span></span>
            }
            footer={
                <div className="pnm-foot">
                    <span className="pnm-foot-sum">
                        {scopedSummary.total === 0 ? 'Nema pitanja'
                            : <>{scopedSummary.unresolved} otvoreno · {scopedSummary.resolved} riješeno</>}
                        {busy && <Loader2 size={13} className="pnm-spin" />}
                    </span>
                    <div className="pnm-foot-btns">
                        <button className="btn btn-secondary" onClick={onClose}>Zatvori</button>
                        <button className="btn btn-primary" onClick={handlePrint} disabled={scopedSummary.total === 0}>
                            <Printer size={15} /> {printLabel}
                        </button>
                    </div>
                </div>
            }
        >
            <div className="pnm">
                {/* Filteri — primalac (segment tintiran bojom) + status */}
                <div className="pnm-filters">
                    <div className="pnm-seg">
                        {audienceChips.map(a => (
                            <button key={a}
                                className={`pnm-seg-opt${audienceFilter === a ? ' active' : ''}${a !== 'all' ? ` aud-${a}` : ''}`}
                                onClick={() => setAudienceFilter(a)}>
                                {a === 'all' ? 'Svi' : PRODUCT_NOTE_AUDIENCE_LABELS[a]}
                            </button>
                        ))}
                    </div>
                    <div className="pnm-seg">
                        {STATUS_FILTERS.map(s => (
                            <button key={s.key}
                                className={`pnm-seg-opt${statusFilter === s.key ? ' active' : ''}`}
                                onClick={() => setStatusFilter(s.key)}>
                                {s.label}
                            </button>
                        ))}
                    </div>
                </div>

                {scope === 'product' ? (
                    // ── PRODUCT SCOPE: bare, samo ovaj proizvod — nema kartica grupa,
                    // nema checkbox-a za selekciju, nema drugih proizvoda u vidokrugu. ──
                    <div className="pnm-solo">
                        {groups[0] && groups[0].notes.length > 0 && (
                            <div className="pnm-notes">{groups[0].notes.map(n => renderNote(groups[0], n))}</div>
                        )}
                        {groups[0] && groups[0].notes.length === 0 && (
                            <p className="pnm-empty-inline">
                                {(localNotes[initialProductId!]?.length || 0) === 0
                                    ? 'Još nema pitanja za ovaj proizvod.'
                                    : 'Nijedno pitanje ne odgovara filteru.'}
                            </p>
                        )}
                        {renderComposer(initialProductId!)}
                    </div>
                ) : groups.length === 0 ? (
                    <div className="pnm-empty">
                        {projectSummary.total === 0
                            ? 'Još nema pitanja ni napomena. Otvori proizvod i dodaj prvo pitanje.'
                            : 'Nijedno pitanje ne odgovara filteru.'}
                    </div>
                ) : (
                    <div className="pnm-groups">
                        {groups.map(g => {
                            const prod = productById.get(g.productId);
                            const isSelected = selected.has(g.productId);
                            return (
                                <div key={g.productId} className="pnm-group">
                                    <div className="pnm-group-head">
                                        <button className={`pnm-select${isSelected ? ' on' : ''}`} onClick={() => toggleSelect(g.productId)}
                                            title="Odaberi za print">
                                            {isSelected && <Check size={11} strokeWidth={3} />}
                                        </button>
                                        <span className="pnm-group-name">{g.productName}</span>
                                        {prod?.Quantity && prod.Quantity > 1 && <span className="pnm-group-qty">×{prod.Quantity}</span>}
                                        {g.summary.total > 0 && (
                                            <span className="pnm-group-count">{g.summary.resolved}/{g.summary.total}</span>
                                        )}
                                    </div>

                                    {g.notes.length > 0 && (
                                        <div className="pnm-notes">{g.notes.map(n => renderNote(g, n))}</div>
                                    )}
                                    {renderComposer(g.productId)}
                                </div>
                            );
                        })}
                    </div>
                )}

                {scope === 'project' && (
                    <button className="pnm-showempty" onClick={() => setShowEmpty(v => !v)}>
                        {showEmpty ? 'Sakrij proizvode bez pitanja' : 'Prikaži i proizvode bez pitanja'}
                    </button>
                )}
            </div>
        </Modal>
    );
}
