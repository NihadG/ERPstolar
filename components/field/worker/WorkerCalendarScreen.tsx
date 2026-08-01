'use client';

// ════════════════════════════════════════════════════════════════════
// RADNIK — KALENDAR (mjesečni)
//
// Mjesec kao mreža sedmica. Nalog nije sitna crtica u ćeliji nego NEPREKIDNA
// TRAKA preko svih dana koje traje (kao događaj u kalendaru) — pa se na prvi
// pogled vidi koliko traje i kad počinje/završava. Boja = status. Prisustvo je
// tanka podvlaka pod brojem dana. Dodir na dan (ili traku) otvara detalje.
//
// Bez novca — dan pokazuje proizvode, procese i imena kolega, ne dnevnicu.
// ════════════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, ClipboardList, Users } from 'lucide-react';
import { useWorkerCalendar } from '@/lib/field/useFieldWorker';
import type { CalendarDay, CalendarOrderSpan, WorkerCalendarMonth } from '@/lib/field/fieldCalendar';
import {
    MLarge, MEmpty, MSection, MList, MItem, MCell, MText, MPill, MSheet, MButton,
} from '@/components/tabs/mobile/MobileUI';

const DOW = ['P', 'U', 'S', 'Č', 'P', 'S', 'N'];
const MAX_LANES = 4;

/** Traka naloga = status: pauza narandžasto, čekanje sivo, u toku plavo. */
function orderBarClass(o: CalendarOrderSpan): 'orange' | 'gray' | 'green' | 'blue' {
    if (o.isPaused) return 'orange';
    if (o.status === 'Na čekanju') return 'gray';
    if (o.status === 'Završeno') return 'green';
    return 'blue';
}

/** Prisustvo → tanka podvlaka: prisutan/teren zeleno, odmor/bolovanje narandžasto. */
function attUnderClass(status: string | null): string {
    if (status === 'Prisutan' || status === 'Teren') return 'p';
    if (status === 'Odmor' || status === 'Bolovanje') return 'r';
    return '';
}

const shortDate = (iso: string) =>
    new Date(iso + 'T12:00:00').toLocaleDateString('bs-BA', { day: 'numeric', month: 'short' });

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

function addDaysISO(iso: string, n: number): string {
    const d = new Date(iso + 'T12:00:00');
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface Cell {
    date: string;
    inMonth: boolean;
    day: CalendarDay | null;
}

/** Mjesec → sedmice (redovi po 7), s vodećim/pratećim danima susjednih mjeseci. */
function buildWeeks(cal: WorkerCalendarMonth): Cell[][] {
    const cells: Cell[] = [];
    for (let i = cal.leadBlanks; i > 0; i--) {
        cells.push({ date: addDaysISO(cal.from, -i), inMonth: false, day: null });
    }
    for (const d of cal.days) cells.push({ date: d.date, inMonth: true, day: d });
    while (cells.length % 7 !== 0) {
        cells.push({ date: addDaysISO(cells[cells.length - 1].date, 1), inMonth: false, day: null });
    }
    const weeks: Cell[][] = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    return weeks;
}

/** Svaki nalog dobija stabilnu „traku" (lane) da preskoči preklapanja i ostane
 *  na istoj visini kroz sedmice — pohlepno pakovanje intervala. */
function assignLanes(orders: CalendarOrderSpan[]): Map<string, number> {
    const sorted = [...orders].sort((a, b) =>
        a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate));
    const laneEnd: string[] = [];
    const laneOf = new Map<string, number>();
    for (const o of sorted) {
        let lane = 0;
        while (lane < laneEnd.length && laneEnd[lane] >= o.startDate) lane++;
        laneEnd[lane] = o.endDate;
        laneOf.set(o.orderId, lane);
    }
    return laneOf;
}

export default function WorkerCalendarScreen({ previewUid }: { previewUid?: string | null }) {
    const thisMonth = currentMonth();
    const [month, setMonth] = useState(thisMonth);
    const { calendar, loading, error, reload } = useWorkerCalendar(month, previewUid);
    const [openDay, setOpenDay] = useState<CalendarDay | null>(null);

    const todayISO = useMemo(() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }, []);

    const weeks = useMemo(() => (calendar ? buildWeeks(calendar) : []), [calendar]);
    const laneOf = useMemo(() => (calendar ? assignLanes(calendar.orders) : new Map<string, number>()), [calendar]);

    // Nalozi koji pokrivaju svaki dan (za sheet dana).
    const ordersByDay = useMemo(() => {
        const m = new Map<string, CalendarOrderSpan[]>();
        if (!calendar) return m;
        for (const day of calendar.days) {
            const list = calendar.orders.filter(o => day.date >= o.startDate && day.date <= o.endDate);
            if (list.length) m.set(day.date, list);
        }
        return m;
    }, [calendar]);

    const atFuture = month >= thisMonth;

    return (
        <>
            <MLarge title="Kalendar">
                {calendar
                    ? `${calendar.summary.workedDays} radnih · ${calendar.summary.presentDays} prisutnih dana`
                    : 'Tvoji nalozi i prisustvo'}
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
                        <MButton variant="filled" onClick={reload}>Pokušaj ponovo</MButton>
                    </div>
                </MEmpty>
            )}

            {calendar && (
                <>
                    <div className="fwk-mc">
                        <div className="fwk-mc-dow">
                            {DOW.map((d, i) => <div key={i}>{d}</div>)}
                        </div>

                        {weeks.map((week, wi) => {
                            const weekStart = week[0].date;
                            const weekEnd = week[6].date;
                            const bars = calendar.orders
                                .filter(o => !(o.endDate < weekStart || o.startDate > weekEnd))
                                .map(o => {
                                    const lane = laneOf.get(o.orderId) ?? 0;
                                    const startIdx = o.startDate <= weekStart ? 0 : Math.max(0, week.findIndex(c => c.date === o.startDate));
                                    const endIdx = o.endDate >= weekEnd ? 6 : Math.max(startIdx, week.findIndex(c => c.date === o.endDate));
                                    const target = week.find(c => c.inMonth && c.date >= o.startDate && c.date <= o.endDate)?.day || null;
                                    return { o, lane, startIdx, endIdx, cl: o.startDate < weekStart, cr: o.endDate > weekEnd, target };
                                })
                                .filter(b => b.lane < MAX_LANES);

                            return (
                                <div className="fwk-mc-wk" key={wi}>
                                    <div className="fwk-mc-days">
                                        {week.map((c, ci) => {
                                            const isToday = c.date === todayISO;
                                            const und = c.day ? attUnderClass(c.day.attendanceStatus) : '';
                                            const cls = `fwk-mc-day${c.inMonth ? '' : ' out'}${ci === 6 ? ' sun' : ''}${isToday ? ' today' : ''}`;
                                            return c.inMonth ? (
                                                <button key={c.date} type="button" className={cls} onClick={() => c.day && setOpenDay(c.day)}>
                                                    <span className="fwk-mc-num">{dayNum(c.date)}</span>
                                                    <span className={`fwk-mc-att ${und}`} />
                                                </button>
                                            ) : (
                                                <div key={c.date} className={cls}>
                                                    <span className="fwk-mc-num">{dayNum(c.date)}</span>
                                                    <span className="fwk-mc-att" />
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {bars.length > 0 && (
                                        <div className="fwk-mc-lanes">
                                            {bars.map(b => (
                                                <button
                                                    key={b.o.orderId}
                                                    type="button"
                                                    className={`fwk-mc-evt ${orderBarClass(b.o)}${b.cl ? ' cl' : ''}${b.cr ? ' cr' : ''}`}
                                                    style={{ gridColumn: `${b.startIdx + 1} / ${b.endIdx + 2}`, gridRow: b.lane + 1 }}
                                                    onClick={() => b.target && setOpenDay(b.target)}
                                                >
                                                    {b.cl && <span className="a">‹ </span>}
                                                    <span className="fwk-mc-evt-t">{b.o.name}</span>
                                                    {b.cr && <span className="a"> ›</span>}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    <div className="fwk-cal-legend">
                        <span><i className="fwk-mc-swatch blue" /> U toku</span>
                        <span><i className="fwk-mc-swatch orange" /> Pauziran</span>
                        <span><i className="fwk-mc-swatch gray" /> U pripremi</span>
                        <span><i style={{ background: 'var(--mui-green)' }} /> Prisutan</span>
                    </div>
                </>
            )}

            <MSheet
                open={!!openDay}
                title={openDay ? new Date(openDay.date + 'T12:00:00').toLocaleDateString('bs-BA', { weekday: 'long', day: 'numeric', month: 'long' }) : ''}
                onClose={() => setOpenDay(null)}
            >
                {openDay && <DaySheet day={openDay} orders={ordersByDay.get(openDay.date) || []} />}
            </MSheet>
        </>
    );
}

function DaySheet({ day, orders }: { day: CalendarDay; orders: CalendarOrderSpan[] }) {
    const att = day.attendanceStatus;
    return (
        <>
            {orders.length > 0 && (
                <>
                    <MSection title={<><ClipboardList size={14} style={{ verticalAlign: '-2px', marginRight: 5 }} />Nalozi ovog dana</>} />
                    <MList lead>
                        {orders.map(o => (
                            <MItem key={o.orderId}>
                                <MCell>
                                    <MText
                                        title={o.name}
                                        sub={<>
                                            <MPill tone={orderBarClass(o)}>{o.isPaused ? 'Pauziran' : o.status}</MPill>
                                            <span>{shortDate(o.startDate)} – {shortDate(o.endDate)}</span>
                                        </>}
                                    />
                                </MCell>
                            </MItem>
                        ))}
                    </MList>
                </>
            )}

            <MSection title="Prisustvo" />
            <MList>
                <MItem>
                    <MCell>
                        <MText title="Status" />
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
                                    <MText title={w.productName} sub={w.processName || undefined} />
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

            {orders.length === 0 && day.work.length === 0 && day.coworkers.length === 0 && !att && (
                <MEmpty title="Ničega tog dana" sub="Nema naloga, rada ni evidentiranog prisustva." />
            )}
        </>
    );
}
