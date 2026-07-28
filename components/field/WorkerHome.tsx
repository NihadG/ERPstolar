'use client';

// ════════════════════════════════════════════════════════════════════
// RADNIK — POČETNA
//
// Prati pravila mobilnog dizajna (vidi MobileUI.css): zaključana tip-skala,
// zasebne kartice kad red nosi više podataka, boja = status.
//
// NEMA NOVCA. Ni dnevnice, ni vrijednosti proizvoda, ni profita — hero nosi
// NAPREDAK i ROK. To nije samo dizajnerska odluka: payload s kojim ova
// komponenta radi (lib/field/fieldHome.ts) iznose ni ne sadrži.
// ════════════════════════════════════════════════════════════════════

import { AlertCircle, CalendarCheck, ClipboardList, Wrench } from 'lucide-react';
import type { FieldHomePayload } from '@/lib/field/fieldHome';
import {
    MLarge, MHero, MSection, MList, MItem, MCell, MText, MValue, MPill,
    MCard, MCardHead, MCardBody, MIcon, MProgress, MEmpty, MCheck,
} from '@/components/tabs/mobile/MobileUI';

const ATTENDANCE_TONE: Record<string, 'green' | 'blue' | 'orange' | 'gray'> = {
    'Prisutan': 'green', 'Teren': 'blue', 'Odmor': 'orange',
    'Bolovanje': 'orange', 'Odsutan': 'gray', 'Vikend': 'gray',
};

const PRIORITY_TONE: Record<string, 'red' | 'orange' | 'blue' | 'gray'> = {
    urgent: 'red', high: 'orange', medium: 'blue', low: 'gray',
};

function dueLabel(days: number | null): { text: string; cls: string } | null {
    if (days === null) return null;
    if (days < 0) return { text: `kasni ${-days} ${-days === 1 ? 'dan' : 'dana'}`, cls: 'late' };
    if (days === 0) return { text: 'rok danas', cls: 'soon' };
    if (days <= 2) return { text: `rok za ${days} ${days === 1 ? 'dan' : 'dana'}`, cls: 'soon' };
    return { text: `rok za ${days} dana`, cls: '' };
}

function greeting(): string {
    const h = new Date().getHours();
    if (h < 11) return 'Dobro jutro';
    if (h < 18) return 'Dobar dan';
    return 'Dobro veče';
}

export default function WorkerHome({ data }: { data: FieldHomePayload }) {
    const { user, assignments, tasks, attendance, week } = data;
    const firstName = user.name.split(' ')[0] || user.name;

    const totalPct = assignments.length
        ? Math.round(assignments.reduce((s, a) => s + a.progressPct, 0) / assignments.length)
        : 0;

    const dateText = new Date(data.today + 'T12:00:00')
        .toLocaleDateString('bs-BA', { weekday: 'long', day: 'numeric', month: 'long' });

    return (
        <>
            <MLarge title={`${greeting()}, ${firstName}`}>
                {dateText}
                {attendance.status && (
                    <MPill tone={ATTENDANCE_TONE[attendance.status] || 'gray'}>{attendance.status}</MPill>
                )}
            </MLarge>

            {!user.hasWorkerLink && (
                <div className="fld-notice">
                    <AlertCircle size={17} />
                    <span>Vaš nalog još nije povezan sa zapisom radnika, pa se ne vidi na čemu radite. Javite poslodavcu.</span>
                </div>
            )}

            <MHero
                kicker="Danas radiš na"
                value={<>{assignments.length}<small>{assignments.length === 1 ? ' proizvod' : ' proizvoda'}</small></>}
                chip={assignments.length ? `${totalPct}% gotovo` : undefined}
                pct={totalPct}
                green={assignments.length > 0 && totalPct >= 100}
            />

            {/* ── Moje stavke ─────────────────────────────────────────── */}
            <MSection title="Moj posao" right={<span className="mui-dim">{assignments.length}</span>} />

            {assignments.length === 0 ? (
                <MEmpty
                    title="Nema dodijeljenog posla"
                    sub="Kad vas poslodavac dodijeli na proizvod, pojaviće se ovdje."
                />
            ) : (
                <div className="mui-elist">
                    {assignments.map(a => {
                        const due = dueLabel(a.daysUntilDue);
                        const tone = a.isPaused ? 'orange' : a.orderType === 'Montaža' ? 'purple' : 'blue';
                        return (
                            <MCard key={a.itemId}>
                                <MCardHead>
                                    <MIcon tone={tone}>
                                        {a.orderType === 'Montaža' ? <Wrench size={21} /> : <ClipboardList size={21} />}
                                    </MIcon>
                                    <MCardBody
                                        name={a.productName || 'Proizvod'}
                                        meta={<>
                                            {a.currentProcess
                                                ? <MPill tone={a.isPaused ? 'orange' : 'blue'}>{a.currentProcess}</MPill>
                                                : <MPill tone="gray">{a.status}</MPill>}
                                            <span>
                                                {a.projectName || a.orderName}
                                                {a.quantity > 1 ? ` · ${a.quantity} kom` : ''}
                                            </span>
                                        </>}
                                    />
                                </MCardHead>
                                <MProgress
                                    pct={a.progressPct}
                                    tone={a.progressPct >= 100 ? 'green' : undefined}
                                    label={<>
                                        <b>{a.progressPct}%</b>
                                        {due && <span className={due.cls}> · {due.text}</span>}
                                        {a.isPaused && <span className="soon"> · pauzirano</span>}
                                    </>}
                                />
                            </MCard>
                        );
                    })}
                </div>
            )}

            {/* ── Zadaci ──────────────────────────────────────────────── */}
            {tasks.length > 0 && (
                <>
                    <MSection title="Moji zadaci" right={<span className="mui-dim">{tasks.length}</span>} />
                    <MList>
                        {tasks.map(t => (
                            <MItem key={t.taskId}>
                                <MCell>
                                    {/* Označavanje zadataka dolazi sa modulom kontrole — dotad je prikaz. */}
                                    <MCheck on={false} disabled label={t.title} />
                                    <MText
                                        title={t.title}
                                        sub={<>
                                            <MPill tone={PRIORITY_TONE[t.priority] || 'gray'}>{t.priority}</MPill>
                                            {t.orderName && <span>{t.orderName}</span>}
                                            {t.checklistTotal > 0 && <span>{t.checklistDone}/{t.checklistTotal}</span>}
                                        </>}
                                    />
                                </MCell>
                            </MItem>
                        ))}
                    </MList>
                </>
            )}

            {/* ── Sedmica (bez zarade) ────────────────────────────────── */}
            <MSection title="Ova sedmica" />
            <MList lead>
                <MItem>
                    <MCell>
                        <MIcon tone="blue"><CalendarCheck size={19} /></MIcon>
                        <MText title="Radnih dana" sub="dani s proknjiženim radom" />
                        <MValue strong>{week.workedDays}</MValue>
                    </MCell>
                </MItem>
                <MItem>
                    <MCell>
                        <MIcon tone="green"><CalendarCheck size={19} /></MIcon>
                        <MText title="Prisustvo" sub="prisutan ili na terenu" />
                        <MValue strong>{week.presentDays}</MValue>
                    </MCell>
                </MItem>
            </MList>
        </>
    );
}
