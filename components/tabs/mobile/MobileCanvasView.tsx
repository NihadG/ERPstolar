'use client';

// ════════════════════════════════════════════════════════════════════
// PLATNO — mobilni prikaz (agenda, SAMO ČITANJE)
//
// NAMJERNO BEZ PLATNA I POVLAČENJA. Gantt na telefonu je nečitljiv: dan je
// 20px, blok se ne pogodi prstom, a promašen potez pomjeri plan.
//
// Na terenu treba ono što se DANAS mora znati: šta ide, šta se mora naručiti,
// šta gori. Uređivanje ostaje na desktopu.
// ════════════════════════════════════════════════════════════════════

import React, { useMemo, useState } from 'react';
import { AlertCircle, AlertTriangle, ShoppingCart, Lock } from 'lucide-react';
import type { PlanScenario, PlanBlock } from '@/lib/types';
import { BLOCK_LABEL, blockDurationDays } from '@/lib/canvas/model';
import { detectConflicts, ordersDueSoon, CONFLICT_LABEL, type ConflictContext } from '@/lib/canvas/conflicts';
import {
    MLarge, MSection, MList, MItem, MCell, MText, MValue, MPill, MEmpty, MSegmented,
} from './MobileUI';
import './MobileUI.css';

type View = 'agenda' | 'naruci' | 'problemi';

interface MobileCanvasViewProps {
    scenario: PlanScenario;
    scenarios: PlanScenario[];
    conflictCtx: ConflictContext;
    onSwitchScenario: (scenarioId: string) => void;
}

const kindTone = (k: PlanBlock['kind']) =>
    k === 'order' ? 'blue'
        : k === 'purchase' ? 'orange'
            : k === 'montaza' ? 'purple'
                : k === 'milestone' ? 'red'
                    : 'gray';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'avg', 'sep', 'okt', 'nov', 'dec'];
const DOW = ['nedjelja', 'ponedjeljak', 'utorak', 'srijeda', 'četvrtak', 'petak', 'subota'];

const dm = (iso: string) => {
    const [, m, d] = iso.split('-');
    return `${Number(d)}. ${MONTHS[Number(m) - 1]}`;
};

/** Naslov dana: „danas", „sutra", pa puni naziv — na terenu se misli u tim pojmovima. */
function dayLabel(iso: string, todayISO: string): string {
    const diff = Math.round(
        (new Date(`${iso}T12:00:00`).getTime() - new Date(`${todayISO}T12:00:00`).getTime()) / 86400000
    );
    if (diff === 0) return 'Danas';
    if (diff === 1) return 'Sutra';
    if (diff === -1) return 'Jučer';
    const d = new Date(`${iso}T12:00:00`);
    return `${DOW[d.getDay()]}, ${dm(iso)}`;
}

export default function MobileCanvasView({
    scenario, scenarios, conflictCtx, onSwitchScenario,
}: MobileCanvasViewProps) {
    const [view, setView] = useState<View>('agenda');
    const todayISO = conflictCtx.todayISO;

    const conflicts = useMemo(() => detectConflicts(scenario, conflictCtx), [scenario, conflictCtx]);
    const due = useMemo(() => ordersDueSoon(scenario, todayISO, 7), [scenario, todayISO]);

    /**
     * Agenda: blok se pojavljuje na dan POČETKA. Prikaz od danas unaprijed —
     * plan koji je prošao ne treba na terenu, a lista bi bila beskonačna.
     */
    const days = useMemo(() => {
        const byDay = new Map<string, PlanBlock[]>();
        for (const b of scenario.Blocks) {
            if (b.kind === 'note') continue;
            if (b.endISO < todayISO) continue;          // gotovo — ne zatrpava
            const key = b.startISO < todayISO ? todayISO : b.startISO;   // u toku → danas
            const arr = byDay.get(key) || [];
            arr.push(b);
            byDay.set(key, arr);
        }
        return Array.from(byDay.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([iso, blocks]) => ({
                iso,
                blocks: blocks.sort((a, b) =>
                    a.startISO.localeCompare(b.startISO) || a.title.localeCompare(b.title, 'hr')),
            }));
    }, [scenario.Blocks, todayISO]);

    const errors = conflicts.filter(c => c.severity === 'error').length;

    return (
        <div className="mui">
            <MLarge title="Platno">
                Plan — ne mijenja naloge ni narudžbe. Uređivanje na računaru.
            </MLarge>

            {scenarios.length > 1 && (
                <MList>
                    <MItem>
                        <MCell>
                            <MText title="Plan" />
                            <select
                                className="mui-inline-select"
                                value={scenario.Scenario_ID}
                                onChange={e => onSwitchScenario(e.target.value)}
                            >
                                {scenarios.map(s => (
                                    <option key={s.Scenario_ID} value={s.Scenario_ID}>{s.Name}</option>
                                ))}
                            </select>
                        </MCell>
                    </MItem>
                </MList>
            )}

            <div style={{ padding: '0 16px', marginBottom: 8 }}>
                <MSegmented<View>
                    value={view}
                    onChange={setView}
                    options={[
                        { id: 'agenda', label: 'Agenda' },
                        { id: 'naruci', label: due.length ? `Naruči (${due.length})` : 'Naruči' },
                        { id: 'problemi', label: conflicts.length ? `Problemi (${conflicts.length})` : 'Problemi' },
                    ]}
                />
            </div>

            {/* ── Agenda ─────────────────────────────────────── */}
            {view === 'agenda' && (
                days.length === 0 ? (
                    <MEmpty title="Nema ničega u planu"
                        sub="Sve je gotovo ili plan još nije napravljen." />
                ) : (
                    days.map(({ iso, blocks }) => (
                        <React.Fragment key={iso}>
                            <MSection title={dayLabel(iso, todayISO)} right={dm(iso)} />
                            <MList>
                                {blocks.map(b => (
                                    <MItem key={b.id}>
                                        <MCell>
                                            <MText
                                                title={
                                                    <>
                                                        {b.locked && <Lock size={11} style={{ marginRight: 4, verticalAlign: -1 }} />}
                                                        {b.title}
                                                    </>
                                                }
                                                sub={
                                                    <>
                                                        {b.projectRef?.name && `${b.projectRef.name} · `}
                                                        {b.kind === 'milestone'
                                                            ? 'fiksan datum'
                                                            : `${blockDurationDays(b)} d · do ${dm(b.endISO)}`}
                                                        {(b.workerRefs?.length || 0) > 0 &&
                                                            ` · ${b.workerRefs!.map(w => w.name).join(', ')}`}
                                                    </>
                                                }
                                            />
                                            <MPill tone={kindTone(b.kind)}>{BLOCK_LABEL[b.kind]}</MPill>
                                        </MCell>
                                    </MItem>
                                ))}
                            </MList>
                        </React.Fragment>
                    ))
                )
            )}

            {/* ── Naruči ─────────────────────────────────────── */}
            {view === 'naruci' && (
                due.length === 0 ? (
                    <MEmpty title="Ništa hitno" sub="Nijedna narudžba ne ističe u narednih 7 dana." />
                ) : (
                    <>
                        <MSection title="Rok slanja ističe" />
                        <MList lead>
                            {due.map(({ block, orderByISO, daysLeft }) => (
                                <MItem key={block.id}>
                                    <MCell>
                                        <MIconSlot late={daysLeft < 0} />
                                        <MText
                                            title={block.title}
                                            sub={
                                                <>
                                                    {block.supplierRef?.name && `${block.supplierRef.name} · `}
                                                    šalji {dm(orderByISO)} · stiže {dm(block.endISO)}
                                                </>
                                            }
                                        />
                                        <MValue strong>
                                            {daysLeft < 0 ? `kasni ${-daysLeft} d`
                                                : daysLeft === 0 ? 'danas' : `za ${daysLeft} d`}
                                        </MValue>
                                    </MCell>
                                </MItem>
                            ))}
                        </MList>
                    </>
                )
            )}

            {/* ── Problemi ───────────────────────────────────── */}
            {view === 'problemi' && (
                conflicts.length === 0 ? (
                    <MEmpty title="Nema problema" sub="Plan je bez sudara." />
                ) : (
                    <>
                        <MSection title={errors ? `${errors} greška/e, ${conflicts.length - errors} upozorenja` : 'Upozorenja'} />
                        <MList lead>
                            {conflicts.map(c => (
                                <MItem key={c.id}>
                                    <MCell>
                                        <span className={`mui-ic ${c.severity === 'error' ? 'red' : 'orange'}`}>
                                            {c.severity === 'error' ? <AlertCircle size={16} /> : <AlertTriangle size={16} />}
                                        </span>
                                        <MText title={CONFLICT_LABEL[c.kind]} sub={c.message} />
                                    </MCell>
                                </MItem>
                            ))}
                        </MList>
                    </>
                )
            )}
        </div>
    );
}

/** Ikonica hitnosti u listi narudžbi. */
function MIconSlot({ late }: { late: boolean }) {
    return (
        <span className={`mui-ic ${late ? 'red' : 'orange'}`}>
            <ShoppingCart size={16} />
        </span>
    );
}
