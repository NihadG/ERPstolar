'use client';

// ════════════════════════════════════════════════════════════════════
// NAPOMENE — lista dugova, ne spisak zapisa
//
// Pitanje bez odgovora je nešto što NEKO ČEKA. Zato kartica u jednom pogledu
// kaže kod koga je lopta (ikona + traka primaoca), koliko dugo čeka (starost,
// crveno preko sedmicu) i gdje pripada (projekat · pozicija).
//
// Grupisanje je podrazumijevano po PRIMAOCU, jer se tako i djeluje: kad zoveš
// klijenta trebaš sva njegova pitanja odjednom, a ne razbacana po pozicijama.
// Prekidač vraća grupisanje po projektu kad se gleda jedan posao.
//
// Tri stanja imaju tri težine: otvoreno je puna kartica, odgovoreno je
// prigušeno s mjehurićem odgovora, riješeno se skuplja u jedan red. Ranije su
// sva tri izgledala isto, pa se ništa nije isticalo.
//
// Upis ide kroz updateProductNotes, koji prepisuje cijeli Questions niz. Zato
// se proizvod pri svakoj izmjeni uzima SVJEŽ iz scope-a, da dvije brze izmjene
// ne pregaze jedna drugu.
// ════════════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import { Check, MessageSquare, Plus, Printer, Search, Truck, User, Users, X } from 'lucide-react';
import type { ProductNote, ProductNoteAudience, Project } from '@/lib/types';
import { PRODUCT_NOTE_AUDIENCE_LABELS, PRODUCT_NOTE_AUDIENCES } from '@/lib/types';
import { addNote, toggleResolved, updateNote } from '@/lib/productNotes';
import type { BoardScope } from '@/lib/command/scope';
import { lensAllowsNote, type LensSelection } from '@/lib/command/signals';
import {
    ageLabel, collectNotes, groupNotes, noteSearchText,
    type CommandNote, type NoteGroupBy, type NoteSort,
} from '@/lib/command/notes';
import { matches, queryTokens } from '@/lib/command/search';
import { hue, KcPanel } from './parts';

const AUDIENCE_ICON: Record<ProductNoteAudience, typeof User> = {
    client: User, supplier: Truck, colleague: Users, other: MessageSquare,
};

export default function NotesPanel({
    scope, lens, showDone, canCreate, today, onSave, onOpenModal, solo, onSolo, wide,
}: {
    scope: BoardScope;
    lens: LensSelection | null;
    showDone: boolean;
    canCreate: boolean;
    today: string;
    onSave: (productId: string, notes: ProductNote[]) => void;
    onOpenModal: (project: Project, productId?: string) => void;
    solo?: string | null;
    onSolo?: (id: string | null) => void;
    wide: boolean;
}) {
    const [by, setBy] = useState<NoteGroupBy>('audience');
    const [sort, setSort] = useState<NoteSort>('oldest');
    const [query, setQuery] = useState('');
    const [answering, setAnswering] = useState<string | null>(null);
    const [draft, setDraft] = useState('');
    const [adding, setAdding] = useState<{ productId: string } | null>(null);
    const [newText, setNewText] = useState('');
    const [newAudience, setNewAudience] = useState<ProductNoteAudience>('client');

    const all = useMemo(() => collectNotes(scope.projects, today), [scope.projects, today]);
    const tokens = useMemo(() => queryTokens(query), [query]);
    const visible = useMemo(
        () => all.filter(n => lensAllowsNote(lens, n.productId, n.note.id)
            && (showDone || n.status !== 'resolved')
            && matches(noteSearchText(n), tokens)),
        [all, lens, showDone, tokens],
    );
    const groups = useMemo(
        () => groupNotes(visible, by, PRODUCT_NOTE_AUDIENCE_LABELS, scope.order, sort),
        [visible, by, scope.order, sort],
    );
    const openCount = visible.filter(n => n.status === 'open').length;
    const now = () => new Date().toISOString();
    const productNotes = (productId: string) => scope.products.get(productId)?.Questions;

    const submitAnswer = (entry: CommandNote) => {
        const text = draft.trim();
        if (!text) { setAnswering(null); return; }
        onSave(entry.productId, updateNote(productNotes(entry.productId), entry.note.id, { Answer: text }, now()));
        setAnswering(null);
        setDraft('');
    };

    const submitNew = () => {
        const text = newText.trim();
        if (!adding || !text) { setAdding(null); return; }
        onSave(adding.productId, addNote(productNotes(adding.productId), { Text: text, Audience: newAudience }, now()));
        setNewText('');
        setAdding(null);
    };

    return (
        <KcPanel
            id="notes"
            eyebrow="KO ŠTA ČEKA"
            title="Napomene"
            count={openCount}
            countTone={openCount > 0 ? 'alert' : undefined}
            wide={wide}
            solo={solo}
            onSolo={onSolo}
            actions={canCreate && scope.products.size > 0 && (
                <button
                    type="button"
                    className="kc-btn sm primary"
                    onClick={() => setAdding(adding ? null : { productId: Array.from(scope.products.keys())[0] })}
                >
                    <Plus size={14} /> Nova
                </button>
            )}
        >
            <div className="kc-qa-tools">
                <label className="kc-search">
                    <Search size={14} />
                    <input
                        aria-label="Pretraži napomene"
                        placeholder="Nađi napomenu…"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                    />
                    {query && <button type="button" aria-label="Očisti pretragu" onClick={() => setQuery('')}><X size={13} /></button>}
                </label>
                <div className="kc-seg" role="group" aria-label="Grupisanje napomena">
                    <button type="button" aria-pressed={by === 'audience'} onClick={() => setBy('audience')}>Primalac</button>
                    <button type="button" aria-pressed={by === 'project'} onClick={() => setBy('project')}>Projekat</button>
                    <button type="button" aria-pressed={by === 'product'} onClick={() => setBy('product')}>Pozicija</button>
                </div>
                <select className="kc-select sm" aria-label="Sortiranje napomena" value={sort} onChange={e => setSort(e.target.value as NoteSort)}>
                    <option value="oldest">Najduže čeka</option>
                    <option value="newest">Najnovije</option>
                    <option value="alpha">Abecedno</option>
                </select>
            </div>

            {canCreate && adding && (
                <div className="kc-qa-new">
                    <div className="kc-qa-newrow">
                        <select className="kc-select" aria-label="Kome je upućeno" value={newAudience} onChange={e => setNewAudience(e.target.value as ProductNoteAudience)}>
                            {PRODUCT_NOTE_AUDIENCES.map(a => <option key={a} value={a}>{PRODUCT_NOTE_AUDIENCE_LABELS[a]}</option>)}
                        </select>
                        <select
                            className="kc-select"
                            aria-label="Za koju poziciju"
                            value={adding.productId}
                            onChange={e => setAdding({ productId: e.target.value })}
                        >
                            {Array.from(scope.products.values()).map(p => (
                                <option key={p.Product_ID} value={p.Product_ID}>{p.Name}</option>
                            ))}
                        </select>
                    </div>
                    <div className="kc-qa-newrow">
                        <input
                            className="kc-input"
                            autoFocus
                            placeholder="Novo pitanje ili napomena…"
                            value={newText}
                            onChange={e => setNewText(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') submitNew(); if (e.key === 'Escape') setAdding(null); }}
                        />
                        <button type="button" className="kc-btn sm primary" onClick={submitNew}>Dodaj</button>
                        <button type="button" className="kc-btn sm" onClick={() => setAdding(null)}>Odustani</button>
                    </div>
                </div>
            )}

            <div className="kc-qa">
                {groups.length === 0 && (
                    <div className="kc-empty" style={{ padding: 22 }}>
                        <MessageSquare size={20} style={{ opacity: 0.45 }} />
                        <p>{query ? 'Ništa ne odgovara pretrazi.' : 'Nema napomena u ovom prikazu.'}</p>
                        {query && <button type="button" className="kc-link" onClick={() => setQuery('')}>Očisti pretragu</button>}
                    </div>
                )}

                {groups.map(group => {
                    const Icon = group.audience ? AUDIENCE_ICON[group.audience] : MessageSquare;
                    const project = group.projectId ? scope.projects.find(p => p.Project_ID === group.projectId) : undefined;
                    return (
                        <section className="kc-qa-group" key={group.key} style={hue(group.projectId)}>
                            <header className={`kc-qa-grouphead a-${group.audience || 'project'}`}>
                                {group.audience ? <Icon size={14} /> : <span className="kc-group-dot" />}
                                <strong>{group.label}</strong>
                                {group.sublabel && <span className="kc-qa-sub">{group.sublabel}</span>}
                                {group.openCount > 0
                                    ? <span className="kc-qa-badge">{group.openCount} čeka</span>
                                    : <span className="kc-qa-badge done">sve riješeno</span>}
                                {project && (
                                    <button type="button" className="kc-link" style={{ marginLeft: 'auto' }} onClick={() => onOpenModal(project)}>
                                        <Printer size={13} /> Sve i print
                                    </button>
                                )}
                            </header>

                            {group.notes.map(entry => (
                                <NoteCard
                                    key={`${entry.productId}:${entry.note.id}`}
                                    entry={entry}
                                    showProject={by === 'audience'}
                                    canCreate={canCreate}
                                    answering={answering === entry.note.id}
                                    draft={draft}
                                    onDraft={setDraft}
                                    onStartAnswer={() => { setAnswering(entry.note.id); setDraft(entry.note.Answer || ''); }}
                                    onCancelAnswer={() => { setAnswering(null); setDraft(''); }}
                                    onSubmitAnswer={() => submitAnswer(entry)}
                                    onToggleResolved={() => onSave(entry.productId, toggleResolved(productNotes(entry.productId), entry.note.id, now()))}
                                />
                            ))}
                        </section>
                    );
                })}

            </div>
        </KcPanel>
    );
}

function NoteCard({
    entry, showProject, canCreate, answering, draft,
    onDraft, onStartAnswer, onCancelAnswer, onSubmitAnswer, onToggleResolved,
}: {
    entry: CommandNote;
    showProject: boolean;
    canCreate: boolean;
    answering: boolean;
    draft: string;
    onDraft: (value: string) => void;
    onStartAnswer: () => void;
    onCancelAnswer: () => void;
    onSubmitAnswer: () => void;
    onToggleResolved: () => void;
}) {
    const { note, status, ageDays, stale } = entry;
    const Icon = AUDIENCE_ICON[note.Audience];
    const context = showProject ? `${entry.projectName} · ${entry.productName}` : entry.productName;

    // Riješeno se skuplja u jedan red — vidi se da postoji, ne troši pažnju.
    if (status === 'resolved') {
        return (
            <div className="kc-qa-card resolved">
                <button type="button" className="kc-qa-tick on" aria-label={`Vrati u otvorene: ${note.Text}`} onClick={onToggleResolved}>
                    <Check size={11} strokeWidth={3} />
                </button>
                <span className="kc-qa-line">{note.Text}</span>
                <span className="kc-qa-ctx">{context}</span>
            </div>
        );
    }

    return (
        <article className={`kc-qa-card a-${note.Audience} ${status}${stale ? ' stale' : ''}`}>
            <div className="kc-qa-top">
                <span className="kc-qa-who"><Icon size={12} />{PRODUCT_NOTE_AUDIENCE_LABELS[note.Audience]}</span>
                <span className={`kc-qa-age${stale ? ' stale' : ''}`}>
                    {status === 'open' ? (ageDays <= 0 ? 'novo' : `čeka ${ageLabel(ageDays)}`) : 'odgovoreno'}
                </span>
                {canCreate && (
                    <button
                        type="button"
                        className="kc-qa-tick"
                        aria-label={`Označi kao riješeno: ${note.Text}`}
                        title="Riješeno"
                        onClick={onToggleResolved}
                    />
                )}
            </div>

            <p className="kc-qa-q">{note.Text}</p>
            <span className="kc-qa-ctx">{context}</span>

            {note.Answer && !answering && <div className="kc-qa-answer">{note.Answer}</div>}

            {answering ? (
                <div className="kc-qa-reply">
                    <input
                        className="kc-input"
                        autoFocus
                        placeholder="Odgovor…"
                        value={draft}
                        onChange={e => onDraft(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') onSubmitAnswer(); if (e.key === 'Escape') onCancelAnswer(); }}
                    />
                    <button type="button" className="kc-btn sm primary" onClick={onSubmitAnswer}>Snimi</button>
                    <button type="button" className="kc-btn sm" onClick={onCancelAnswer}>Odustani</button>
                </div>
            ) : canCreate && (
                <button type="button" className="kc-qa-action" onClick={onStartAnswer}>
                    {note.Answer ? 'Izmijeni odgovor' : 'Odgovori'}
                </button>
            )}
        </article>
    );
}
