'use client';

// ════════════════════════════════════════════════════════════════════
// RADNIK — KALENDAR
//
// Mjesečna mreža: šta je koji dan radio i s kim, plus prisustvo. Dodir na dan
// otvara sheet s detaljima. Bez novca — dan pokazuje proizvode, procese i
// imena kolega, ne dnevnicu.
// ════════════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Users } from 'lucide-react';
import { useWorkerCalendar } from '@/lib/field/useFieldWorker';
import type { CalendarDay } from '@/lib/field/fieldCalendar';
import {
    MLarge, MEmpty, MSection, MList, MItem, MCell, MText, MPill, MSheet,
} from '@/components/tabs/mobile/MobileUI';

const DOW = ['P', 'U', 'S', 'Č', 'P', 'S', 'N'];

const ATT_META: Record<string, { cls: string; label: string }> = {
    'Prisutan': { cls: 'present', label: 'Prisutan' },
    'Teren': { cls: 'field', label: 'Teren' },
    'Odmor': { cls: 'rest', label: 'Odmor' },
    'Bolovanje': { cls: 'rest', label: 'Bolovanje' },
    'Odsutan': { cls: 'off', label: 'Odsutan' },
    'Vikend': { cls: 'off', label: 'Vikend' },
};

const ATT_TONE: Record<string, 'green' | 'blue' | 'orange' | 'gray'> = {
    'Prisutan': 'green', 'Teren': 'blue', 'Odmor': 'orange', 'Bolovanje': 'orange',
    'Odsutan': 'gray', 'Vikend': 'gray',
};

function monthTitle(month: string): string {
    const [y, m] = month.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('bs-BA', { month: 'long', year: 'numeric' });
}

function addMonth(month: string, delta: number): string {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function currentMonth(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const dayNum = (iso: string) => Number(iso.split('-')[2]);

export default function WorkerCalendarScreen({ previewUid }: { previewUid?: string | null }) {
    const thisMonth = currentMonth();
    const [month, setMonth] = useState(thisMonth);
    const { calendar, loading, error, reload } = useWorkerCalendar(month, previewUid);
    const [openDay, setOpenDay] = useState<CalendarDay | null>(null);

    const todayISO = useMemo(() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }, []);

    const atFuture = month >= thisMonth;

    return (
        <>
            <MLarge title="Kalendar">
                {calendar
                    ? `${calendar.summary.workedDays} radnih · ${calendar.summary.presentDays} prisutnih dana`
                    : 'Tvoji radovi i prisustvo'}
            </MLarge>

            <div className="fwk-cal-bar">
                <button type="button" className="fwk-cal-arrow" onClick={() => setMonth(addMonth(month, -1))} aria-label="Prethodni mjesec">
                    <ChevronLeft size={22} />
                </button>
                <span className="fwk-cal-title">{monthTitle(month)}</span>
                <button
                    type="button"
                    className="fwk-cal-arrow"
                    onClick={() => setMonth(addMonth(month, 1))}
                    disabled={atFuture}
                    aria-label="Sljedeći mjesec"
                >
                    <ChevronRight size={22} />
                </button>
            </div>

            {loading && !calendar && <div className="fld-loading">Učitavanje…</div>}

            {error && (
                <MEmpty title="Kalendar nije učitan" sub={error}>
                    <div style={{ width: '100%', paddingTop: 14 }}>
                        <button type="button" className="fwk-cal-arrow" onClick={reload} aria-label="Osvježi">
                            <ChevronRight size={22} />
                        </button>
                    </div>
                </MEmpty>
            )}

            {calendar && (
                <>
                    <div className="fwk-cal-grid" role="grid">
                        {DOW.map((d, i) => <div key={i} className="fwk-cal-dow">{d}</div>)}

                        {Array.from({ length: calendar.leadBlanks }).map((_, i) => (
                            <div key={`b${i}`} className="fwk-cal-cell blank" />
                        ))}

                        {calendar.days.map(day => {
                            const att = day.attendanceStatus ? ATT_META[day.attendanceStatus] : null;
                            const isToday = day.date === todayISO;
                            const isFuture = day.date > todayISO;
                            const hasWork = day.work.length > 0;
                            return (
                                <button
                                    key={day.date}
                                    type="button"
                                    className={`fwk-cal-cell${isToday ? ' today' : ''}${isFuture ? ' off' : ''}`}
                                    onClick={() => setOpenDay(day)}
                                >
                                    <span className="fwk-cal-num">{dayNum(day.date)}</span>
                                    {hasWork && <span className="fwk-cal-work" />}
                                    {att && <span className={`fwk-cal-att ${att.cls}`} />}
                                </button>
                            );
                        })}
                    </div>

                    <div className="fwk-cal-legend">
                        <span><i style={{ background: 'var(--mui-green)' }} /> Prisutan</span>
                        <span><i style={{ background: 'var(--mui-blue)' }} /> Teren</span>
                        <span><i style={{ background: 'var(--mui-orange)' }} /> Odmor/bolovanje</span>
                        <span><span className="fwk-cal-work" style={{ width: 6, height: 6 }} /> Radio</span>
                    </div>
                </>
            )}

            <MSheet
                open={!!openDay}
                title={openDay ? new Date(openDay.date + 'T12:00:00').toLocaleDateString('bs-BA', { weekday: 'long', day: 'numeric', month: 'long' }) : ''}
                onClose={() => setOpenDay(null)}
            >
                {openDay && <DaySheet day={openDay} />}
            </MSheet>
        </>
    );
}

function DaySheet({ day }: { day: CalendarDay }) {
    const att = day.attendanceStatus;
    return (
        <>
            <MList>
                <MItem>
                    <MCell>
                        <MText title="Prisustvo" />
                        {att
                            ? <MPill tone={ATT_TONE[att] || 'gray'}>{att}</MPill>
                            : <span className="mui-dim">nije evidentirano</span>}
                    </MCell>
                </MItem>
                {day.bookedDays > 0 && (
                    <MItem>
                        <MCell>
                            <MText title="Proknjiženo" sub="radni dan" />
                            <span className="mui-cval mui-num">{day.bookedDays}</span>
                        </MCell>
                    </MItem>
                )}
            </MList>

            {day.work.length > 0 && (
                <>
                    <MSection title="Radio na" />
                    <MList lead>
                        {day.work.map((w, i) => (
                            <MItem key={i}>
                                <MCell>
                                    <MText
                                        title={w.productName}
                                        sub={w.processName || undefined}
                                    />
                                </MCell>
                            </MItem>
                        ))}
                    </MList>
                </>
            )}

            {day.coworkers.length > 0 && (
                <>
                    <MSection title={<><Users size={14} style={{ verticalAlign: '-2px', marginRight: 5 }} />S kim</>} />
                    <div className="fwk-day-cowork">
                        {day.coworkers.map(name => (
                            <span key={name} className="fwk-chip-name">{name}</span>
                        ))}
                    </div>
                </>
            )}

            {day.work.length === 0 && day.coworkers.length === 0 && (
                <MEmpty title="Nema proknjiženog rada" sub="Tog dana nije evidentiran rad na proizvodu." />
            )}
        </>
    );
}
