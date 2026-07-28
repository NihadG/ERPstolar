'use client';

// ════════════════════════════════════════════════════════════════════
// IZBOR STATUSA — bottom sheet
//
// Desktop ovdje nudi mrežu od sedam jednakih dugmadi. U pogonu to ne valja:
// tri statusa nose 95% svih unosa (Prisutan, Teren, Odsutan), a ostala četiri
// su rijetka. Zato su prva tri VELIKE mete (56px, palac ih pogađa bez gledanja),
// a ostatak je red čipova ispod.
//
// Nema „Sačuvaj" — dodir statusa je odluka i sheet se odmah zatvara. Potvrda
// se traži samo za nepovratno, a ovo se ispravi drugim dodirom.
// ════════════════════════════════════════════════════════════════════

import { useState } from 'react';
import { Car, CheckCircle2, XCircle } from 'lucide-react';
import { MSheet } from '@/components/tabs/mobile/MobileUI';

/** Tri koja se koriste svaki dan. */
const PRIMARY = [
    { id: 'Prisutan', label: 'Prisutan', hint: 'radi u pogonu', tone: 'green', Icon: CheckCircle2 },
    { id: 'Teren', label: 'Teren', hint: 'montaža na terenu', tone: 'blue', Icon: Car },
    { id: 'Odsutan', label: 'Odsutan', hint: 'nije došao', tone: 'gray', Icon: XCircle },
] as const;

/** Rijetki — ne troše prostor za palac. */
const SECONDARY = ['Bolovanje', 'Odmor', 'Vikend', 'Praznik'] as const;

interface Props {
    open: boolean;
    workerName: string;
    dateLabel: string;
    current?: string;
    /** Status od jučer — „Kao jučer" štedi razmišljanje kad je smjena ista. */
    yesterday?: string;
    busy?: boolean;
    onClose: () => void;
    onPick: (status: string, notes?: string) => void;
}

export default function StatusSheet({
    open, workerName, dateLabel, current, yesterday, busy, onClose, onPick,
}: Props) {
    const [notes, setNotes] = useState('');
    const [notesOpen, setNotesOpen] = useState(false);

    const pick = (status: string) => {
        if (busy) return;
        onPick(status, notes.trim() || undefined);
        setNotes('');
        setNotesOpen(false);
    };

    return (
        <MSheet open={open} title={workerName} onClose={onClose}>
            <p className="fat-sheet-sub">{dateLabel}</p>

            <div className="fat-primary">
                {PRIMARY.map(s => (
                    <button
                        key={s.id}
                        type="button"
                        className={`fat-big ${s.tone}${current === s.id ? ' on' : ''}`}
                        disabled={busy}
                        onClick={() => pick(s.id)}
                    >
                        <s.Icon size={22} strokeWidth={2.2} />
                        <span className="fat-big-label">{s.label}</span>
                        <span className="fat-big-hint">{s.hint}</span>
                    </button>
                ))}
            </div>

            {yesterday && yesterday !== current && (
                <button
                    type="button"
                    className="fat-yesterday"
                    disabled={busy}
                    onClick={() => pick(yesterday)}
                >
                    Kao jučer — <b>{yesterday}</b>
                </button>
            )}

            <div className="mui-shd"><span>Ostalo</span></div>
            <div className="fat-secondary">
                {SECONDARY.map(s => (
                    <button
                        key={s}
                        type="button"
                        className={`mui-chip${current === s ? ' on' : ''}`}
                        disabled={busy}
                        onClick={() => pick(s)}
                    >
                        {s}
                    </button>
                ))}
            </div>

            {notesOpen ? (
                <div className="fat-note">
                    <input
                        value={notes}
                        onChange={e => setNotes(e.target.value)}
                        placeholder="npr. kasnio, ranije otišao…"
                        autoFocus
                    />
                </div>
            ) : (
                <button type="button" className="fat-note-toggle" onClick={() => setNotesOpen(true)}>
                    + Dodaj napomenu
                </button>
            )}
        </MSheet>
    );
}
