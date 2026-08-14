'use client';

// ════════════════════════════════════════════════════════════════════
// WorkerCalendar — mjesečni kalendar jednog radnika.
//
// Osa platna odgovara na „šta se dešava u radionici". Na „šta radi Bego" je
// odgovarala loše: njegov raspored se čitao skeniranjem jednog reda kroz vrijeme.
// Ovdje je isti podatak u obliku koji to pitanje zapravo ima — mjesec.
//
// Bočna ploča, ne modal — isti obrazac kao CanvasDrawer: raspored se gleda uz
// pogled na cjelinu, a ne umjesto nje.
//
// IZOLACIJA: samo čita. Ništa se odavde ne mijenja ni u planu ni u nalozima.
// ════════════════════════════════════════════════════════════════════

import { useMemo, useState, useEffect } from 'react';
import { X, ChevronLeft, ChevronRight, Lock, AlertTriangle, CalendarCheck } from 'lucide-react';
import type { PlanBlock, Worker } from '@/lib/types';
import {
    buildWorkerCalendar, shiftMonth, monthOf,
    type WorkerCalendarCtx, type CalendarDay,
} from '@/lib/canvas/workerCalendar';
import { projectHue } from '@/lib/canvas/palette';
import './WorkerCalendar.css';

const MONTHS = [
    'januar', 'februar', 'mart', 'april', 'maj', 'juni',
    'juli', 'avgust', 'septembar', 'oktobar', 'novembar', 'decembar',
];
const DOW = ['pon', 'uto', 'sri', 'čet', 'pet', 'sub', 'ned'];

interface WorkerCalendarProps {
    worker: Worker;
    ctx: WorkerCalendarCtx;
    todayISO: string;
    onClose: () => void;
    /** Klik na posao u kalendaru vodi na taj blok u osi. */
    onSelectBlock: (blockId: string) => void;
}

/** Inicijali za avatar — isti obrazac kao drugdje u platnu. */
function initials(name: string): string {
    return name.trim().split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase();
}

export default function WorkerCalendar({
    worker, ctx, todayISO, onClose, onSelectBlock,
}: WorkerCalendarProps) {
    const [month, setMonth] = useState(() => monthOf(todayISO));

    // Promjena radnika vraća pogled na tekući mjesec — inače novi čovjek stigne
    // u mjesec koji je ostao od prethodnog i izgleda kao da nema ništa.
    useEffect(() => { setMonth(monthOf(todayISO)); }, [worker.Worker_ID, todayISO]);

    const cal = useMemo(
        () => buildWorkerCalendar(worker.Worker_ID, month, ctx, todayISO),
        [worker.Worker_ID, month, ctx, todayISO]
    );

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const { stats } = cal;
    const free = stats.firstFreeISO;

    return (
        <aside className="wc" role="dialog" aria-label={`Kalendar — ${worker.Name}`}>
            <header className="wc-head">
                <span className="wc-av" aria-hidden="true">{initials(worker.Name)}</span>
                <div className="wc-id">
                    <h3>{worker.Name}</h3>
                    <span>{worker.Role || 'Radnik'}</span>
                </div>
                <button className="wc-x" onClick={onClose} aria-label="Zatvori kalendar">
                    <X size={16} />
                </button>
            </header>

            {/* Brojke se odnose na PRIKAZANI mjesec — inače lažu u odnosu na mrežu ispod */}
            <div className="wc-stats">
                <div className={`wc-stat${stats.pct > 90 ? ' bad' : ''}`}>
                    <b>{stats.pct}%</b><span>zauzet</span>
                </div>
                <div className="wc-stat">
                    <b>{stats.busy}/{stats.available}</b><span>dana</span>
                </div>
                <div className={`wc-stat${stats.conflicts ? ' bad' : ' good'}`}>
                    <b>{stats.conflicts || '—'}</b><span>sudara</span>
                </div>
                <div className="wc-stat">
                    <b>{free ? `${Number(free.slice(8, 10))}. ${MONTHS[Number(free.slice(5, 7)) - 1].slice(0, 3)}` : '—'}</b>
                    <span>prvi slobodan</span>
                </div>
            </div>

            <div className="wc-nav">
                <button className="wc-nav-btn" aria-label="Prethodni mjesec"
                    onClick={() => setMonth(m => shiftMonth(m, -1))}>
                    <ChevronLeft size={15} />
                </button>
                <b>{MONTHS[cal.month]} {cal.year}</b>
                <button className="wc-nav-btn" aria-label="Naredni mjesec"
                    onClick={() => setMonth(m => shiftMonth(m, 1))}>
                    <ChevronRight size={15} />
                </button>
                {month !== monthOf(todayISO) && (
                    <button className="wc-today-btn" onClick={() => setMonth(monthOf(todayISO))}>
                        Danas
                    </button>
                )}
            </div>

            <div className="wc-grid" role="grid">
                <div className="wc-dow wc-wk-col" aria-hidden="true" />
                {DOW.map(d => <div key={d} className="wc-dow">{d}</div>)}

                {cal.weeks.map(week => (
                    <WeekRow
                        key={week.weekNo + '-' + week.days[0].dateISO}
                        weekNo={week.weekNo}
                        busy={week.busyDays}
                        available={week.availableDays}
                        days={week.days}
                        onSelectBlock={onSelectBlock}
                    />
                ))}
            </div>

            <footer className="wc-foot">
                <span><i className="wc-sw plan" /> planirano</span>
                <span><i className="wc-sw absent" /> odsustvo</span>
                <span><i className="wc-sw clash" /> sudar</span>
                <span><i className="wc-sw real" /> stvarni nalog</span>
            </footer>
        </aside>
    );
}

function WeekRow({ weekNo, busy, available, days, onSelectBlock }: {
    weekNo: number;
    busy: number;
    available: number;
    days: CalendarDay[];
    onSelectBlock: (id: string) => void;
}) {
    const pct = available > 0 ? Math.round((busy / available) * 100) : 0;
    return (
        <>
            <div className="wc-wk wc-wk-col" title={`Sedmica ${weekNo} — ${busy} od ${available} radnih dana`}>
                <b>{weekNo}</b>
                <span>{busy}/{available}</span>
                <i className="wc-wk-meter"><u className={pct > 90 ? 'hot' : ''} style={{ width: `${Math.min(100, pct)}%` }} /></i>
            </div>
            {days.map(day => <DayCell key={day.dateISO} day={day} onSelectBlock={onSelectBlock} />)}
        </>
    );
}

function DayCell({ day, onSelectBlock }: { day: CalendarDay; onSelectBlock: (id: string) => void }) {
    const cls = [
        'wc-cell',
        !day.inMonth && 'out',
        !day.isWorkingDay && 'nonwork',
        day.isToday && 'today',
        day.conflict && 'clash',
        day.free && 'free',
    ].filter(Boolean).join(' ');

    return (
        <div className={cls} role="gridcell">
            <div className="wc-d">
                <span>{day.dayOfMonth}</span>
                {day.conflict && <AlertTriangle size={11} className="wc-warn" aria-label="Sudar" />}
                {day.free && <CalendarCheck size={11} className="wc-free-ico" aria-label="Slobodan" />}
            </div>

            {day.absence && <div className="wc-chip absent">{day.absence}</div>}

            {day.blocks.map(b => <BlockChip key={b.id} block={b} onSelect={onSelectBlock} />)}

            {/* Stvarni preuzet posao — zaključan, ne dira se odavde */}
            {day.shadows.map(s => (
                <div key={s.id} className="wc-chip real" title={s.hint || s.label}>
                    <Lock size={9} /> {s.label}
                </div>
            ))}
        </div>
    );
}

function BlockChip({ block, onSelect }: { block: PlanBlock; onSelect: (id: string) => void }) {
    const hue = block.color || projectHue(block.projectRef?.id || block.projectRef?.name);
    const project = block.projectRef?.name;
    // Nacrt (blok koji još nije stvarni nalog) je skica, ne puna traka — ista
    // razlika koju osa nosi statusnom kapicom.
    const isDraft = !block.linkedWorkOrderId;

    return (
        <button
            className={`wc-chip plan${isDraft ? ' draft' : ''}`}
            style={{ ['--wc-hue' as string]: hue }}
            onClick={() => onSelect(block.id)}
            title={`${block.title}${project ? ` · ${project}` : ''} · ${block.startISO} → ${block.endISO}${isDraft ? ' · nacrt u planu' : ''}`}
        >
            <span className="wc-chip-t">{block.title}</span>
            {project && <span className="wc-chip-p">{project}</span>}
        </button>
    );
}
