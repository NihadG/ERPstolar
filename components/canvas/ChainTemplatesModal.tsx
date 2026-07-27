'use client';

// ════════════════════════════════════════════════════════════════════
// ChainTemplatesModal — sačuvani oblici lanaca.
//
// Ovdje se taloži znanje radionice: „nova kuhinja" je uvijek isti OBLIK
// (narudžba → proizvodnja → transport → montaža), samo se datumi mijenjaju.
//
// Primjena traži SAMO JEDAN datum (početak prvog koraka) — ostalo se izvodi
// iz zapamćenih razmaka. Bez toga bi šablon bio jednako spor kao ručni unos.
// ════════════════════════════════════════════════════════════════════

import { useState, useMemo } from 'react';
import { Bookmark, Trash2, Calendar, ArrowRight } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import type { PlanChainTemplate } from '@/lib/types';
import { applyChainTemplate } from '@/lib/canvas/templates';
import { BLOCK_LABEL } from '@/lib/canvas/model';
import { todayISO } from '@/lib/planning';

interface ChainTemplatesModalProps {
    isOpen: boolean;
    templates: PlanChainTemplate[];
    isSaturdayWorking?: (d: Date) => boolean;
    onClose: () => void;
    onApply: (template: PlanChainTemplate, firstStepStartISO: string) => void;
    onDelete: (templateId: string) => void;
}

const dm = (iso: string) => {
    const [, m, d] = iso.split('-');
    return `${Number(d)}.${Number(m)}.`;
};

export default function ChainTemplatesModal({
    isOpen, templates, isSaturdayWorking, onClose, onApply, onDelete,
}: ChainTemplatesModalProps) {
    const [selectedId, setSelectedId] = useState<string>('');
    const [startISO, setStartISO] = useState<string>(todayISO());

    const selected = useMemo(
        () => templates.find(t => t.id === selectedId) || templates[0] || null,
        [templates, selectedId]
    );

    // Pregled prije primjene — isti princip kao ChainModal: vidiš šta nastaje.
    const preview = useMemo(
        () => (selected ? applyChainTemplate(selected, startISO, { isSaturdayWorking }) : null),
        [selected, startISO, isSaturdayWorking]
    );

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={<><Bookmark size={17} /> Šabloni lanaca</>}
            size="large"
            footer={
                <>
                    <button className="btn btn-secondary" onClick={onClose}>Odustani</button>
                    <button className="btn btn-primary" disabled={!selected}
                        onClick={() => {
                            if (!selected) return;
                            onApply(selected, startISO);
                            onClose();
                        }}>
                        Baci na platno {preview ? `(${preview.blocks.length})` : ''}
                    </button>
                </>
            }
        >
            {templates.length === 0 ? (
                <p className="cv-chain-empty">
                    Još nema sačuvanih šablona. Napravi lanac (narudžba → proizvodnja → transport →
                    montaža), otvori <strong>Lanac</strong> i klikni <strong>„Sačuvaj kao šablon"</strong>.
                </p>
            ) : (
                <>
                    <div className="cv-tpl-grid">
                        <label className="cv-field">
                            <span>Šablon</span>
                            <select value={selected?.id || ''} onChange={e => setSelectedId(e.target.value)}>
                                {templates.map(t => (
                                    <option key={t.id} value={t.id}>
                                        {t.name} ({t.steps.length} koraka)
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label className="cv-field">
                            <span>Prvi korak počinje</span>
                            <input type="date" value={startISO}
                                onChange={e => e.target.value && setStartISO(e.target.value)} />
                        </label>
                    </div>

                    {selected && preview && (
                        <>
                            <h4 className="cv-chain-h">Nastaje na platnu</h4>
                            <ul className="cv-chain-list">
                                {preview.blocks.map((b, i) => {
                                    const step = selected.steps[i];
                                    return (
                                        <li className="cv-chain-row" key={b.id}>
                                            <span className={`cv-kind-chip k-${b.kind}`}>{BLOCK_LABEL[b.kind]}</span>
                                            <span className="cv-chain-title">{b.title}</span>
                                            <span className="cv-chain-dates">
                                                <Calendar size={12} />
                                                <strong>{dm(b.startISO)}{b.kind !== 'milestone' && <>–{dm(b.endISO)}</>}</strong>
                                            </span>
                                            {step.workerDays ? (
                                                <span className="cv-chain-delta earlier">
                                                    {step.workerDays} rd ÷ {step.crew || 1}
                                                </span>
                                            ) : step.leadDays !== undefined ? (
                                                <span className="cv-chain-delta">rok {step.leadDays} d</span>
                                            ) : null}
                                            {step.linkKind && (
                                                <span className="cv-chain-orderby">
                                                    <ArrowRight size={11} /> vezan na sljedeći
                                                </span>
                                            )}
                                        </li>
                                    );
                                })}
                            </ul>

                            <p className="cv-chain-warn">
                                Šablon nosi samo OBLIK — projekt, proizvode, radnike i dobavljača
                                dodaješ nakon što blokovi padnu na platno.
                            </p>

                            <button className="cv-btn danger"
                                onClick={() => {
                                    if (typeof window !== 'undefined'
                                        && !window.confirm(`Obrisati šablon „${selected.name}"?`)) return;
                                    onDelete(selected.id);
                                    setSelectedId('');
                                }}>
                                <Trash2 size={14} /> Obriši ovaj šablon
                            </button>
                        </>
                    )}
                </>
            )}
        </Modal>
    );
}
