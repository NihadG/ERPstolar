'use client';

// ════════════════════════════════════════════════════════════════════
// ZAVRŠI PROCES — bottom sheet
//
// Tri podatka, istim redom kao na desktopu: KO je radio, KAD je gotovo,
// i napomena ako treba.
//
// Prvi odabrani radnik je glavni, ostali su pomoćnici — zato je redoslijed
// vidljiv i zato se čipovi dodaju na kraj, a ne sortiraju.
//
// Datum je unaprijed postavljen na danas i ne može u budućnost. Ekipa naloga
// je na vrhu liste jer je to skoro uvijek tačan odgovor.
// ════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { MSheet } from '@/components/tabs/mobile/MobileUI';

const todayISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

interface Props {
    open: boolean;
    processName: string;
    itemCount: number;
    crew: { workerId: string; name: string }[];
    /** Radnici koji su već na tom procesu — predlažu se sami. */
    suggestedWorkerIds: string[];
    busy?: boolean;
    onClose: () => void;
    onConfirm: (input: { workerIds: string[]; date: string; notes?: string }) => void;
}

export default function CompleteSheet({
    open, processName, itemCount, crew, suggestedWorkerIds, busy, onClose, onConfirm,
}: Props) {
    const [workerIds, setWorkerIds] = useState<string[]>([]);
    const [date, setDate] = useState(todayISO);
    const [notes, setNotes] = useState('');

    // Prijedlog se primjenjuje pri svakom otvaranju — sheet se ne odmontira.
    useEffect(() => {
        if (!open) return;
        setWorkerIds(suggestedWorkerIds);
        setDate(todayISO());
        setNotes('');
    }, [open, suggestedWorkerIds]);

    const add = (id: string) => setWorkerIds(prev => (prev.includes(id) ? prev : [...prev, id]));
    const remove = (id: string) => setWorkerIds(prev => prev.filter(x => x !== id));

    const nameOf = (id: string) => crew.find(c => c.workerId === id)?.name || 'Radnik';
    const available = crew.filter(c => !workerIds.includes(c.workerId));

    return (
        <MSheet open={open} title={processName} onClose={onClose}>
            <p className="fat-sheet-sub">
                {itemCount} {itemCount === 1 ? 'proizvod' : 'proizvoda'} · označi kao gotovo
            </p>

            <div className="mui-shd">
                <span>Ko je radio</span>
                {workerIds.length > 0 && <span className="mui-dim">prvi je glavni</span>}
            </div>

            {workerIds.length > 0 && (
                <div className="fod-chips">
                    {workerIds.map((id, i) => (
                        <span key={id} className={`fod-chip${i === 0 ? ' main' : ''}`}>
                            {nameOf(id)}
                            <button type="button" onClick={() => remove(id)} aria-label={`Ukloni ${nameOf(id)}`}>
                                <X size={14} strokeWidth={2.8} />
                            </button>
                        </span>
                    ))}
                </div>
            )}

            {available.length > 0 && (
                <div className="fod-pick">
                    {available.slice(0, 12).map(c => (
                        <button key={c.workerId} type="button" className="mui-chip" onClick={() => add(c.workerId)}>
                            + {c.name}
                        </button>
                    ))}
                </div>
            )}

            {workerIds.length === 0 && (
                <p className="fod-warn">Odaberi bar jednog radnika — bez toga se proces ne može zatvoriti.</p>
            )}

            <div className="mui-shd"><span>Kad je gotovo</span></div>
            <div className="fod-field">
                <label htmlFor="fod-date">Datum</label>
                <input
                    id="fod-date"
                    type="date"
                    value={date}
                    max={todayISO()}
                    onChange={e => setDate(e.target.value)}
                />
            </div>

            <div className="fod-field">
                <label htmlFor="fod-note">Napomena</label>
                <input
                    id="fod-note"
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder="opcionalno"
                />
            </div>

            <div className="fod-confirm-wrap">
                <button
                    type="button"
                    className="fbk-confirm"
                    disabled={busy || workerIds.length === 0}
                    onClick={() => onConfirm({ workerIds, date, notes: notes.trim() || undefined })}
                >
                    {busy ? 'Snimam…' : `Završi ${itemCount} ${itemCount === 1 ? 'proizvod' : 'proizvoda'}`}
                </button>
            </div>
        </MSheet>
    );
}
