'use client';

// ════════════════════════════════════════════════════════════════════
// KALENDAR KOMANDNOG CENTRA
//
// Tri prikaza istog modela (lib/command/timeline), jer se o vremenu
// postavljaju tri različita pitanja:
//   • AGENDA  — „šta me čeka, šta kasni". Hronološki spisak događaja:
//     kasni → danas → sutra → ova sedmica → … Traka koja traje dvije
//     sedmice se ovdje razlaže na događaje (kreće / u toku / rok), jer
//     jedna stavka nije jedan dan.
//   • TRAKA   — „koliko traje i šta se preklapa". Gantt: red po projektu,
//     dani kao kolone.
//   • MJESEC  — „kako izgleda ovaj mjesec".
//
// Sva tri crtaju po istom pravilu: boja = projekat, oblik i ikona = vrsta,
// ispuna = stanje. Crveno je i ovdje rezervisano samo za kašnjenje.
//
// Stavke bez datuma se NE kriju — nalog bez roka je problem koji treba
// vidjeti, a ne stavka koju treba sakriti.
// ════════════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import {
    CalendarDays, CalendarRange, ChevronLeft, ChevronRight, ChevronDown,
    CircleAlert, Flag, Hammer, Info, ListTodo, Truck, X,
} from 'lucide-react';
import type { Project } from '@/lib/types';
import type { BoardScope } from '@/lib/command/scope';
import {
    barColumns, buildTimelineRows, dueMarker, monthDays, packLanes, timelineDays,
    type RowGrouping, type TimelineData, type TimelineItem,
} from '@/lib/command/timeline';
import { buildAgenda, withoutProductDuplicates, type AgendaBucket, type AgendaEntry, type AgendaMarker } from '@/lib/command/agenda';
import { shiftDate, weekStart } from '@/lib/projectCommand';
import { hue, KcPanel, shortDate } from './parts';

const DOW = ['Pon', 'Uto', 'Sri', 'Čet', 'Pet', 'Sub', 'Ned'];
const MONTHS = ['januar', 'februar', 'mart', 'april', 'maj', 'juni', 'juli', 'august', 'septembar', 'oktobar', 'novembar', 'decembar'];

const KIND_LABEL: Record<TimelineItem['kind'], string> = {
    order: 'Radni nalog', purchase: 'Narudžba', task: 'Zadatak', deadline: 'Rok projekta', plan: 'Planirano (Platno)',
};
const STATE_LABEL: Record<TimelineItem['state'], string> = {
    waiting: 'Na čekanju', running: 'U toku', paused: 'Pauzirano', done: 'Završeno', cancelled: 'Otkazano',
};
/** Ikona nosi vrstu i kad je traka preuska za tekst. */
const KIND_ICON: Record<TimelineItem['kind'], typeof Hammer> = {
    order: Hammer, purchase: Truck, plan: CalendarRange, task: ListTodo, deadline: Flag,
};
/**
 * Oznaka događaja zavisi od vrste: „planirani kraj" na narudžbi ne znači ništa,
 * tamo se čeka isporuka. Isti datum, drugo ime za drugu stvar.
 */
function markerLabel(marker: AgendaMarker, kind: TimelineItem['kind']): string {
    switch (marker) {
        case 'start': return kind === 'purchase' ? 'naručeno' : 'kreće';
        case 'end': return kind === 'purchase' ? 'isporuka' : kind === 'plan' ? 'kraj plana' : 'planirani kraj';
        case 'due': return kind === 'purchase' ? 'isporuka' : 'rok';
        case 'ongoing': return kind === 'purchase' ? 'u dolasku' : kind === 'order' ? 'u radu' : 'traje';
        default: return '';
    }
}

const GROUPING_LABEL: Record<RowGrouping, string> = {
    compact: 'Sažeto', kind: 'Po vrsti', product: 'Po pozicijama',
};

const LANE = 23;

export interface TimelineActions {
    onOpenWorkOrder: (id: string) => void;
    onOpenTask: (id: string) => void;
    onOpenProject: (id: string) => void;
}

export default function CommandTimeline({
    data, scope, today, actions, plans, solo, onSolo,
}: {
    data: TimelineData;
    scope: BoardScope;
    today: string;
    actions: TimelineActions;
    /** Scenariji s Platna koji dodiruju tablu — crta se jedan, biraš koji. */
    plans?: { list: { id: string; name: string }[]; selectedId: string; onSelect: (id: string) => void };
    solo?: string | null;
    onSolo?: (id: string | null) => void;
}) {
    const [mode, setMode] = useState<'agenda' | 'timeline' | 'month'>('agenda');
    const [weeks, setWeeks] = useState(8);
    const [grouping, setGrouping] = useState<RowGrouping>('compact');
    const [anchor, setAnchor] = useState(() => weekStart(today));
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [legendOpen, setLegendOpen] = useState(false);
    const [detailId, setDetailId] = useState<string | null>(null);
    const [collapsed, setCollapsed] = useState(false);

    const days = useMemo(
        () => (mode === 'month' ? monthDays(anchor) : timelineDays(anchor, weeks)),
        [mode, anchor, weeks],
    );
    const range = { from: days[0], to: days[days.length - 1] };
    // Naziv pored kratke trake zauzima oko 150px — pretvoreno u dane, to je
    // prostor koji stavka mora rezervisati da se nazivi ne ispišu jedan preko
    // drugog kad su dva roka razmaknuta jedan dan.
    const perDay = 980 / days.length;
    const rows = useMemo(
        () => buildTimelineRows(data.items, scope, {
            expanded, grouping, ...range,
            labelDays: Math.ceil(150 / perDay),
            shortDays: Math.ceil(78 / perDay),
        }),
        [data.items, scope, expanded, grouping, range.from, range.to, perDay],
    );
    const agenda = useMemo(() => buildAgenda(data, today), [data, today]);
    // Ista stavka postoji i kao traka projekta i kao traka pozicije; u spisku
    // „bez roka" nema osa koja bi ih razdvojila, pa bi se pojavila dvaput.
    const undated = useMemo(() => withoutProductDuplicates(data.undated), [data.undated]);
    const detail = data.items.find(i => i.id === detailId) || data.undated.find(i => i.id === detailId);

    const step = (direction: number) => setAnchor(prev => (mode === 'month'
        ? shiftMonth(prev, direction)
        : shiftDate(prev, direction * 7 * Math.max(1, weeks - 1))));

    const toggleProject = (projectId: string) => setExpanded(prev => {
        const next = new Set(prev);
        if (next.has(projectId)) next.delete(projectId); else next.add(projectId);
        return next;
    });

    const title = mode === 'month'
        ? `${MONTHS[Number(anchor.slice(5, 7)) - 1]} ${anchor.slice(0, 4)}.`
        : `${shortDate(days[0], today)} – ${shortDate(days[days.length - 1], today)}`;
    const lateCount = agenda.find(b => b.id === 'late')?.count ?? 0;

    return (
        <KcPanel
            id="calendar"
            eyebrow="VRIJEME"
            title="Kalendar projekata"
            solo={solo}
            onSolo={onSolo}
            actions={
                <>
                    <button type="button" className="kc-icon-btn" aria-label="Legenda" title="Kako se čitaju trake" aria-pressed={legendOpen} onClick={() => setLegendOpen(v => !v)}>
                        <Info size={15} />
                    </button>
                    <button type="button" className="kc-icon-btn" aria-label={collapsed ? 'Otvori kalendar' : 'Sklopi kalendar'} onClick={() => setCollapsed(v => !v)}>
                        <ChevronDown size={16} style={{ transform: collapsed ? 'rotate(-90deg)' : 'none', transition: 'transform .15s ease' }} />
                    </button>
                </>
            }
        >
            {!collapsed && (
                <>
                    <div className="kc-cal-tools">
                        <div className="kc-seg" role="group" aria-label="Prikaz kalendara">
                            <button type="button" aria-pressed={mode === 'agenda'} onClick={() => setMode('agenda')}>
                                Agenda
                                {lateCount > 0 && <i className="kc-seg-dot" aria-label={`${lateCount} kasni`} />}
                            </button>
                            <button type="button" aria-pressed={mode === 'timeline'} onClick={() => setMode('timeline')}>Traka</button>
                            <button type="button" aria-pressed={mode === 'month'} onClick={() => setMode('month')}>Mjesec</button>
                        </div>

                        {mode !== 'agenda' && (
                            <>
                                <div className="kc-range">
                                    <button type="button" className="kc-icon-btn" aria-label="Nazad" onClick={() => step(-1)}><ChevronLeft size={16} /></button>
                                    <span>{title}</span>
                                    <button type="button" className="kc-icon-btn" aria-label="Naprijed" onClick={() => step(1)}><ChevronRight size={16} /></button>
                                </div>
                                <button type="button" className="kc-btn sm" onClick={() => setAnchor(weekStart(today))}>Danas</button>
                            </>
                        )}

                        {mode === 'timeline' && (
                            <>
                                <div className="kc-seg" role="group" aria-label="Raspon">
                                    {[4, 8, 12].map(n => (
                                        <button type="button" key={n} aria-pressed={weeks === n} onClick={() => setWeeks(n)}>{n} sedm.</button>
                                    ))}
                                </div>
                                <select
                                    className="kc-select sm"
                                    aria-label="Razlaganje redova"
                                    value={grouping}
                                    onChange={e => { setGrouping(e.target.value as RowGrouping); setExpanded(new Set()); }}
                                >
                                    {(Object.keys(GROUPING_LABEL) as RowGrouping[]).map(g => (
                                        <option key={g} value={g}>{GROUPING_LABEL[g]}</option>
                                    ))}
                                </select>
                            </>
                        )}

                        {plans && plans.list.length > 1 && (
                            <select
                                className="kc-select"
                                aria-label="Plan s Platna"
                                title="Koji plan s Platna se crta kao planirano"
                                style={{ marginLeft: 'auto' }}
                                value={plans.selectedId}
                                onChange={e => plans.onSelect(e.target.value)}
                            >
                                {plans.list.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                        )}
                    </div>

                    {legendOpen && <Legend />}

                    {mode === 'agenda' ? (
                        <AgendaView buckets={agenda} scope={scope} today={today} onPick={setDetailId} />
                    ) : rows.every(r => r.placed.length === 0) ? (
                        <div className="kc-cal-empty">
                            <CalendarDays size={22} style={{ opacity: 0.5 }} />
                            <p style={{ margin: '6px 0 0' }}>Nema aktivnosti u ovom rasponu.</p>
                        </div>
                    ) : mode === 'timeline' ? (
                        <TimelineGrid rows={rows} days={days} today={today} onPick={setDetailId} onToggleProject={toggleProject} expanded={expanded} projects={scope.projects} />
                    ) : (
                        <MonthGrid days={days} items={data.items.filter(i => !i.productId)} anchor={anchor} today={today} onPick={setDetailId} />
                    )}

                    {mode !== 'agenda' && undated.length > 0 && (
                        <div className="kc-undated">
                            <strong>Bez roka</strong>
                            {undated.slice(0, 12).map(item => (
                                <button type="button" key={item.id} className="kc-point" style={hue(item.projectId)} onClick={() => setDetailId(item.id)}>
                                    {item.title}
                                </button>
                            ))}
                            {undated.length > 12 && <span style={{ fontSize: 11 }}>+{undated.length - 12}</span>}
                        </div>
                    )}

                    {detail && <Detail item={detail} scope={scope} today={today} actions={actions} onClose={() => setDetailId(null)} />}
                </>
            )}
        </KcPanel>
    );
}

// ── Agenda ──────────────────────────────────────────────────────────

/** Koliko dana „Kasnije" prikazuje prije nego ponudi ostatak. */
const LATER_DAYS = 8;

function AgendaView({
    buckets, scope, today, onPick,
}: {
    buckets: AgendaBucket[];
    scope: BoardScope;
    today: string;
    onPick: (id: string) => void;
}) {
    const [showAllLater, setShowAllLater] = useState(false);

    if (buckets.length === 0) {
        return (
            <div className="kc-cal-empty">
                <CalendarDays size={22} style={{ opacity: 0.5 }} />
                <p style={{ margin: '6px 0 0' }}>Nema ničega s datumom na ovoj tabli.</p>
            </div>
        );
    }

    return (
        <div className="kc-agenda">
            {buckets.map(bucket => {
                const limited = bucket.id === 'later' && !showAllLater;
                const days = limited ? bucket.days.slice(0, LATER_DAYS) : bucket.days;
                const hidden = bucket.days.length - days.length;
                // Kad je sve u jednom danu (Danas, Sutra), datum iznad grupe
                // samo ponavlja naslov sekcije.
                const showDayHeads = bucket.days.length > 1 || bucket.id === 'late' || bucket.id === 'later';

                return (
                    <section key={bucket.id} className={`kc-ag-bucket b-${bucket.id}`} aria-label={bucket.label}>
                        <header className="kc-ag-head">
                            <h3>{bucket.label}</h3>
                            <span className="kc-ag-count">{bucket.count}</span>
                        </header>
                        {days.map(day => (
                            <div key={day.dateISO || 'none'} className="kc-ag-day">
                                {showDayHeads && day.dateISO && (
                                    <div className="kc-ag-date">
                                        <b>{shortDate(day.dateISO, today)}</b>
                                        <span>{DOW[dowIndex(day.dateISO)]}</span>
                                    </div>
                                )}
                                <ul className="kc-ag-list">
                                    {day.entries.map(entry => (
                                        <AgendaRow key={entry.key} entry={entry} scope={scope} today={today} onPick={onPick} />
                                    ))}
                                </ul>
                            </div>
                        ))}
                        {hidden > 0 && (
                            <button type="button" className="kc-link kc-ag-more" onClick={() => setShowAllLater(true)}>
                                Prikaži još {hidden} {hidden === 1 ? 'dan' : 'dana'}
                            </button>
                        )}
                    </section>
                );
            })}
        </div>
    );
}

function AgendaRow({
    entry, scope, today, onPick,
}: {
    entry: AgendaEntry;
    scope: BoardScope;
    today: string;
    onPick: (id: string) => void;
}) {
    const { item, marker } = entry;
    const Icon = KIND_ICON[item.kind];
    const project = scope.projects.find(p => p.Project_ID === item.projectId);
    const projectName = project?.Name || project?.Client_Name;
    const tag = markerLabel(marker, item.kind);
    const meta = [
        projectName,
        // Rok projekta nosi naziv projekta kao podnaslov — ovdje bi ga ponovio.
        item.subtitle === projectName ? null : item.subtitle,
        !item.isPoint ? `${shortDate(item.startISO, today)}–${shortDate(item.endISO, today)}` : null,
    ].filter(Boolean).join(' · ');

    return (
        <li>
            <button
                type="button"
                className={`kc-ag-row k-${item.kind} st-${item.state}${item.late ? ' is-late' : ''}`}
                style={hue(item.projectId)}
                onClick={() => onPick(item.id)}
            >
                <span className="kc-ag-icon" aria-hidden><Icon size={13} /></span>
                <span className="kc-ag-main">
                    <strong>{item.title}</strong>
                    {meta && <small>{meta}</small>}
                </span>
                {typeof item.progress === 'number' && item.state !== 'waiting' && (
                    <span className="kc-ag-prog" title={`${Math.round(item.progress * 100)}% stavki završeno`}>
                        <i style={{ width: `${Math.round(item.progress * 100)}%` }} />
                    </span>
                )}
                <span className="kc-ag-tags">
                    {tag && <span className={`kc-ag-tag m-${marker}`}>{tag}</span>}
                    {item.late && <span className="kc-ag-tag late"><CircleAlert size={11} /> kasni</span>}
                    {!item.late && item.state === 'paused' && <span className="kc-ag-tag">pauza</span>}
                </span>
            </button>
        </li>
    );
}

// ── Traka (Gantt) ───────────────────────────────────────────────────

function TimelineGrid({
    rows, days, today, expanded, projects, onPick, onToggleProject,
}: {
    rows: ReturnType<typeof buildTimelineRows>;
    days: string[];
    today: string;
    expanded: Set<string>;
    projects: Project[];
    onPick: (id: string) => void;
    onToggleProject: (id: string) => void;
}) {
    let cursor = 2;
    const placedRows = rows.map(row => {
        const height = Math.max(1, row.lanes);
        const start = cursor;
        cursor += height;
        return { row, start, height };
    });

    // Preko tri sedmice dan nema mjesta za ime i broj, pa zaglavlje prelazi na
    // SEDMICE; dan se i dalje čita iz pozadinskih traka i oznake „danas".
    const dense = days.length > 21;
    // Gruba procjena širine dana — odlučuje ide li naziv unutar trake ili pored
    // nje. Mjerenje u DOM-u bi tražilo layout prolaz na svaki crtež.
    const pxPerDay = 980 / days.length;
    const todayIndex = days.indexOf(today);

    return (
        <div className="kc-cal-scroll" data-no-swipe>
            <div
                className="kc-cal-grid"
                style={{
                    gridTemplateColumns: `var(--kc-rowlabel) repeat(${days.length}, minmax(${dense ? 15 : 26}px, 1fr))`,
                    gridTemplateRows: `auto repeat(${cursor - 2}, var(--kc-lane))`,
                }}
            >
                <div className="kc-cal-corner" style={{ gridColumn: 1, gridRow: 1 }} />
                {dense
                    ? days.filter((_, i) => i % 7 === 0).map((monday, w) => {
                        const weekDays = days.slice(w * 7, w * 7 + 7);
                        return (
                            <div
                                key={monday}
                                className={`kc-cal-day${weekDays.includes(today) ? ' today' : ''}${weekDays.some(d => d.slice(8) === '01') ? ' monthstart' : ''}`}
                                style={{ gridColumn: `${w * 7 + 2} / ${w * 7 + 9}`, gridRow: 1 }}
                            >
                                <span>{MONTHS[Number(monday.slice(5, 7)) - 1].slice(0, 3)}</span>
                                <b>{Number(monday.slice(8))}.–{Number(weekDays[weekDays.length - 1].slice(8))}.</b>
                            </div>
                        );
                    })
                    : days.map((day, i) => (
                        <div
                            key={day}
                            className={`kc-cal-day${isWeekend(i) ? ' weekend' : ''}${day === today ? ' today' : ''}${day.slice(8) === '01' ? ' monthstart' : ''}`}
                            style={{ gridColumn: i + 2, gridRow: 1 }}
                        >
                            <span>{DOW[i % 7]}</span>
                            <b>{Number(day.slice(8))}</b>
                        </div>
                    ))}

                {/* Podloga: jedna traka po danu kroz sve redove — jeftino bojenje
                    vikenda, granice mjeseca i današnjeg dana. */}
                {days.map((day, i) => (
                    <div
                        key={`bg-${day}`}
                        className={`kc-cal-cell${isWeekend(i) ? ' weekend' : ''}${day === today ? ' today' : ''}${day.slice(8) === '01' ? ' monthstart' : ''}`}
                        style={{ gridColumn: i + 2, gridRow: `2 / ${Math.max(3, cursor)}` }}
                        aria-hidden
                    />
                ))}

                {placedRows.map(({ row, start, height }) => {
                    const open = expanded.has(row.projectId);
                    return (
                        <div key={row.key} style={{ display: 'contents' }}>
                            <div
                                className={`kc-cal-rowlabel ${row.level}`}
                                style={{ ...hue(row.projectId), gridColumn: 1, gridRow: `${start} / ${start + height}` }}
                            >
                                {row.level === 'project' ? (
                                    <button type="button" onClick={() => onToggleProject(row.projectId)} aria-expanded={open}>
                                        <ChevronDown size={13} style={{ transform: open ? 'none' : 'rotate(-90deg)' }} />
                                        <span className="kc-group-dot" />
                                        <strong>{row.label}</strong>
                                    </button>
                                ) : (
                                    <>
                                        <strong>{row.label}</strong>
                                        {row.sublabel && <small>{row.sublabel}</small>}
                                    </>
                                )}
                            </div>
                            {row.level === 'project' && (
                                <div
                                    className="kc-cal-projectline"
                                    style={{ ...hue(row.projectId), gridColumn: `2 / ${days.length + 2}`, gridRow: `${start} / ${start + height}` }}
                                    aria-hidden
                                />
                            )}
                            {row.placed.map(({ item, lane }) => {
                                const cols = barColumns(item, days);
                                if (!cols) return null;
                                const widthPx = (cols.end - cols.start) * pxPerDay;
                                const due = dueMarker(item);
                                const dueCol = due ? days.indexOf(due.dateISO) : -1;
                                return (
                                    <div key={item.id} style={{ display: 'contents' }}>
                                        <Bar
                                            item={item}
                                            outsideLabel={item.isPoint || widthPx < 78}
                                            compact={widthPx < 46}
                                            style={{ gridColumn: `${cols.start + 1} / ${cols.end + 1}`, gridRow: start + lane }}
                                            onPick={onPick}
                                        />
                                        {/* Dio plana koji je iza roka — šrafirani rep preko trake.
                                            Zastavica sama je presitna da se uhvati pogledom. */}
                                        {dueCol >= 0 && due!.overrun && (
                                            <span
                                                className="kc-bar-overrun"
                                                style={{ gridColumn: `${dueCol + 2} / ${cols.end + 1}`, gridRow: start + lane }}
                                                aria-hidden
                                            />
                                        )}
                                        {dueCol >= 0 && (
                                            <span
                                                className={`kc-due-flag${due!.overrun ? ' overrun' : ''}`}
                                                style={{ ...hue(item.projectId), gridColumn: dueCol + 2, gridRow: start + lane }}
                                                title={`Rok naloga: ${shortDate(due!.dateISO, today)}${due!.overrun ? ' — plan ga prekoračuje' : ''}`}
                                                aria-hidden
                                            />
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    );
                })}

                {/* „Danas" ide preko svih redova — bez toga se u moru traka ne
                    vidi gdje je sadašnjost. */}
                {todayIndex >= 0 && (
                    <div
                        className="kc-cal-now"
                        style={{ gridColumn: todayIndex + 2, gridRow: `2 / ${Math.max(3, cursor)}` }}
                        aria-hidden
                    />
                )}
            </div>
        </div>
    );
}

// ── Mjesec ──────────────────────────────────────────────────────────

function MonthGrid({
    days, items, anchor, today, onPick,
}: {
    days: string[];
    items: TimelineItem[];
    anchor: string;
    today: string;
    onPick: (id: string) => void;
}) {
    const weeks: string[][] = [];
    for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
    const month = anchor.slice(0, 7);

    return (
        <div className="kc-month-weeks">
            <div className="kc-month" style={{ borderBottom: '1px solid var(--kc-line)' }}>
                {DOW.map(d => <div key={d} className="kc-month-dow">{d}</div>)}
            </div>
            {weeks.map(week => {
                const inWeek = items.filter(i => i.startISO <= week[6] && i.endISO >= week[0]);
                const placed = packLanes(inWeek);
                const lanes = placed.reduce((max, p) => Math.max(max, p.lane + 1), 0);
                // Broj dana je VLASTITI red (1), trake idu u redove ispod. Da ćelija
                // dana proteže sve redove, prvi red bi se srušio na nulu i trake bi
                // legle preko datuma — pa se podloga crta zasebnim trakama.
                const bodyRows = Math.max(2, lanes);
                return (
                    <div
                        key={week[0]}
                        style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
                            gridTemplateRows: `auto repeat(${bodyRows}, ${LANE}px)`,
                        }}
                    >
                        {week.map((day, i) => {
                            const cls = `${day.slice(0, 7) !== month ? ' other' : ''}${isWeekend(i) ? ' weekend' : ''}${day === today ? ' today' : ''}`;
                            return (
                                <div key={`bg-${day}`} style={{ display: 'contents' }}>
                                    <div className={`kc-month-daynum${cls}`} style={{ gridColumn: i + 1, gridRow: 1 }}>
                                        <b>{Number(day.slice(8))}</b>
                                    </div>
                                    <div className={`kc-month-strip${cls}`} style={{ gridColumn: i + 1, gridRow: `2 / ${bodyRows + 2}` }} aria-hidden />
                                </div>
                            );
                        })}
                        {placed.map(({ item, lane }) => {
                            const cols = barColumns(item, week);
                            if (!cols) return null;
                            return (
                                <Bar
                                    key={`${item.id}-${week[0]}`}
                                    item={item}
                                    style={{ gridColumn: `${cols.start} / ${cols.end}`, gridRow: lane + 2, zIndex: 1, alignSelf: 'start' }}
                                    onPick={onPick}
                                />
                            );
                        })}
                    </div>
                );
            })}
        </div>
    );
}

// ── Traka / tačka ───────────────────────────────────────────────────

/**
 * Traka ili tačka. Kad je prekratka da primi naziv, naziv ide PORED nje —
 * ranije se rezao u „Kl…" i „Isp…", što nije značilo ništa.
 *
 * Stvarni nalog nosi i napredak kao tamniju ispunu unutar trake: plan je
 * obris, urađeno je ispuna, pa se zaostajanje vidi bez otvaranja naloga.
 */
function Bar({ item, style, outsideLabel, compact, onPick }: {
    item: TimelineItem;
    style: React.CSSProperties;
    outsideLabel?: boolean;
    compact?: boolean;
    onPick: (id: string) => void;
}) {
    const Icon = KIND_ICON[item.kind];
    const classes = [
        item.isPoint ? 'kc-point' : 'kc-bar-item',
        `k-${item.kind}`,
        `st-${item.state}`,
        item.late ? 'is-late' : '',
        outsideLabel ? 'bare' : '',
    ].filter(Boolean).join(' ');
    const showProgress = !item.isPoint && typeof item.progress === 'number' && item.progress > 0;
    return (
        <button
            type="button"
            className={classes}
            style={{ ...hue(item.projectId), ...style }}
            title={`${KIND_LABEL[item.kind]} · ${item.title}${item.subtitle ? ` · ${item.subtitle}` : ''}`}
            onClick={() => onPick(item.id)}
        >
            {showProgress && <i className="kc-bar-progress" style={{ width: `${Math.round(item.progress! * 100)}%` }} aria-hidden />}
            {!item.isPoint && !compact && <Icon className="kc-bar-icon" size={11} aria-hidden />}
            <span className={outsideLabel ? 'kc-bar-out' : 'kc-bar-label'}>{item.title}</span>
        </button>
    );
}

function Legend() {
    return (
        <div className="kc-legend">
            <span><b>Boja</b> = projekat</span>
            <span className="kc-legend-item"><Hammer size={12} /> nalog</span>
            <span className="kc-legend-item"><Truck size={12} /> narudžba</span>
            <span className="kc-legend-item"><CalendarRange size={12} /> planirano (Platno)</span>
            <span className="kc-legend-item"><ListTodo size={12} /> zadatak</span>
            <span className="kc-legend-item"><Flag size={12} /> rok</span>
            <span><b>Ispuna</b> = stanje: blijedo čeka · tamnije urađeno · šrafirano pauza · sivo završeno</span>
            <span className="kc-legend-item"><i className="kc-legend-swatch flag" /> rok naloga; crveno = plan ga prekoračuje</span>
            <span className="kc-legend-item" style={{ color: 'var(--kc-late)' }}><b>Crveni obrub = kasni</b></span>
        </div>
    );
}

function Detail({
    item, scope, today, actions, onClose,
}: {
    item: TimelineItem;
    scope: BoardScope;
    today: string;
    actions: TimelineActions;
    onClose: () => void;
}) {
    const project = scope.projects.find(p => p.Project_ID === item.projectId);
    const product = item.productId ? scope.products.get(item.productId) : undefined;
    const due = dueMarker(item);
    return (
        <div className="kc-cal-detail" style={hue(item.projectId)}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <span className="kc-eyebrow">{KIND_LABEL[item.kind]}{item.shared ? ' · dijeljeno s drugim projektima' : ''}</span>
                    <h3>{item.title}</h3>
                </div>
                <button type="button" className="kc-icon-btn" aria-label="Zatvori detalje" onClick={onClose}><X size={15} /></button>
            </div>
            <p>
                {[
                    project?.Name || project?.Client_Name,
                    product?.Name,
                    item.startISO ? (item.isPoint ? shortDate(item.startISO, today) : `${shortDate(item.startISO, today)} – ${shortDate(item.endISO, today)}`) : 'Bez datuma',
                    due ? `rok ${shortDate(due.dateISO, today)}${due.overrun ? ' — plan ga prekoračuje' : ''}` : null,
                    typeof item.progress === 'number' ? `${Math.round(item.progress * 100)}% stavki završeno` : null,
                    item.kind !== 'plan' && item.kind !== 'deadline' ? STATE_LABEL[item.state] : null,
                    item.late ? 'KASNI' : null,
                ].filter(Boolean).join(' · ')}
            </p>
            <div className="kc-detail-actions">
                {item.kind === 'order' && <button type="button" className="kc-btn sm primary" onClick={() => actions.onOpenWorkOrder(item.refId)}>Otvori nalog</button>}
                {item.kind === 'task' && <button type="button" className="kc-btn sm primary" onClick={() => actions.onOpenTask(item.refId)}>Otvori zadatak</button>}
                {item.kind === 'plan' && <span style={{ fontSize: 11.5, color: 'var(--text-tertiary)', alignSelf: 'center' }}>Termin se uređuje u Platnu.</span>}
                {item.kind === 'purchase' && <span style={{ fontSize: 11.5, color: 'var(--text-tertiary)', alignSelf: 'center' }}>Narudžba se uređuje u Narudžbama.</span>}
                {project && <button type="button" className="kc-btn sm" onClick={() => actions.onOpenProject(project.Project_ID)}>Prikaži samo ovaj projekat</button>}
            </div>
        </div>
    );
}

const isWeekend = (index: number) => index % 7 >= 5;

/** Pon = 0 — isti redoslijed kao zaglavlje mreže. */
function dowIndex(iso: string): number {
    return (new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7;
}

function shiftMonth(iso: string, delta: number): string {
    const date = new Date(`${iso.slice(0, 8)}01T12:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + delta);
    return date.toISOString().slice(0, 10);
}
