'use client';

// ════════════════════════════════════════════════════════════════════
// KONTROLOR — POČETNA
//
// NAMJERNO NEDOVRŠENO. Sama funkcija kontrole (potvrdi / vrati na doradu,
// evidencija nedostataka, fotografije) razvija se u sljedećoj fazi. Ovaj ekran
// postoji da se OBLIK može ocijeniti prije nego se izgradi mehanika.
//
// Zato su dugmad „Potvrdi" i „Vrati" vidljiva ali onemogućena, uz jasnu
// napomenu. Alternativa — sakriti ih ili pustiti da klik ništa ne uradi —
// bila bi gora: prva ne pokazuje namjeru, druga glumi funkciju koje nema.
//
// Lista „Čeka kontrolu" je za sada aproksimacija: procesi označeni gotovim u
// zadnjih 7 dana (vidi lib/field/fieldHome.ts). Kad proces dobije stvarno
// stanje kontrole, mijenja se samo taj upit — ne i ovaj ekran.
// ════════════════════════════════════════════════════════════════════

import { useState } from 'react';
import { CheckCircle2, ClipboardCheck, ClipboardList, RotateCcw, Wrench } from 'lucide-react';
import type { FieldHomePayload } from '@/lib/field/fieldHome';
import {
    MLarge, MHero, MSection, MCard, MCardHead, MCardBody, MIcon, MPill,
    MProgress, MEmpty, MSegmented, MActions, MAction,
} from '@/components/tabs/mobile/MobileUI';

type Tab = 'ceka' | 'utoku' | 'gotovo';

function dueLabel(days: number | null): { text: string; cls: string } | null {
    if (days === null) return null;
    if (days < 0) return { text: `kasni ${-days} ${-days === 1 ? 'dan' : 'dana'}`, cls: 'late' };
    if (days === 0) return { text: 'rok danas', cls: 'soon' };
    if (days <= 2) return { text: `rok za ${days} ${days === 1 ? 'dan' : 'dana'}`, cls: 'soon' };
    return { text: `rok za ${days} dana`, cls: '' };
}

function relativeDay(iso: string | null, today: string): string {
    if (!iso) return '';
    const d = iso.split('T')[0];
    if (d === today) return 'danas';
    const diff = Math.round((new Date(today + 'T00:00:00').getTime() - new Date(d + 'T00:00:00').getTime()) / 86400000);
    if (diff === 1) return 'jučer';
    if (diff > 1 && diff < 7) return `prije ${diff} dana`;
    return new Date(d + 'T12:00:00').toLocaleDateString('bs-BA', { day: 'numeric', month: 'short' });
}

export default function ControllerHome({ data }: { data: FieldHomePayload }) {
    const [tab, setTab] = useState<Tab>('ceka');
    const { awaitingCheck, activeOrders, user } = data;

    const dateText = new Date(data.today + 'T12:00:00')
        .toLocaleDateString('bs-BA', { weekday: 'long', day: 'numeric', month: 'long' });

    const late = activeOrders.filter(o => (o.daysUntilDue ?? 99) < 0).length;

    return (
        <>
            <MLarge title="Kontrola">
                {dateText}
                <MPill tone="orange">{user.roleLabel}</MPill>
            </MLarge>

            <MHero
                kicker="Za kontrolu"
                value={<>{awaitingCheck.length}<small>{awaitingCheck.length === 1 ? ' proces' : ' procesa'}</small></>}
                chip={`${activeOrders.length} ${activeOrders.length === 1 ? 'nalog' : 'naloga'} u toku`}
                pct={awaitingCheck.length ? 100 : 0}
            />

            <div className="fld-seg">
                <MSegmented<Tab>
                    value={tab}
                    onChange={setTab}
                    options={[
                        { id: 'ceka', label: 'Čeka' },
                        { id: 'utoku', label: 'U toku' },
                        { id: 'gotovo', label: 'Završeno' },
                    ]}
                />
            </div>

            {/* ── Čeka kontrolu ───────────────────────────────────────── */}
            {tab === 'ceka' && (
                <>
                    <div className="fld-notice fld-notice--info">
                        <ClipboardCheck size={17} />
                        <span>
                            <b>Modul kontrole je u pripremi.</b> Ovdje ćete potvrđivati procese i vraćati ih
                            na doradu. Za sada je prikaz — dugmad su namjerno neaktivna.
                        </span>
                    </div>

                    <MSection title="Nedavno završeni procesi" right={<span className="mui-dim">{awaitingCheck.length}</span>} />

                    {awaitingCheck.length === 0 ? (
                        <MEmpty
                            title="Nema procesa za kontrolu"
                            sub="Kad radnik označi proces završenim, pojaviće se ovdje."
                        />
                    ) : (
                        <div className="mui-elist">
                            {awaitingCheck.map((c, i) => (
                                <MCard key={`${c.itemId}-${c.processName}-${i}`}>
                                    <MCardHead>
                                        <MIcon tone="orange"><ClipboardCheck size={21} /></MIcon>
                                        <MCardBody
                                            name={c.processName}
                                            meta={<>
                                                <MPill tone="orange">Čeka</MPill>
                                                <span>
                                                    {c.productName}
                                                    {c.workerName ? ` · ${c.workerName}` : ''}
                                                    {` · ${relativeDay(c.completedAt, data.today)}`}
                                                </span>
                                            </>}
                                        />
                                    </MCardHead>
                                    <div className="fld-card-sub">{c.projectName || c.orderName}</div>
                                    <MActions>
                                        <MAction tone="gtint" disabled><CheckCircle2 size={17} /> Potvrdi</MAction>
                                        <MAction tone="otint" disabled><RotateCcw size={17} /> Vrati</MAction>
                                    </MActions>
                                </MCard>
                            ))}
                        </div>
                    )}
                </>
            )}

            {/* ── Nalozi u proizvodnji ────────────────────────────────── */}
            {tab === 'utoku' && (
                <>
                    <MSection
                        title="Nalozi u proizvodnji"
                        right={<span className="mui-dim">{late ? `${late} kasni` : activeOrders.length}</span>}
                    />
                    {activeOrders.length === 0 ? (
                        <MEmpty title="Nema aktivnih naloga" sub="Pokrenuti nalozi pojaviće se ovdje." />
                    ) : (
                        <div className="mui-elist">
                            {activeOrders.map(o => {
                                const due = dueLabel(o.daysUntilDue);
                                const isMontaza = o.orderType === 'Montaža';
                                return (
                                    <MCard key={o.orderId}>
                                        <MCardHead>
                                            <MIcon tone={isMontaza ? 'purple' : 'blue'}>
                                                {isMontaza ? <Wrench size={21} /> : <ClipboardList size={21} />}
                                            </MIcon>
                                            <MCardBody
                                                name={o.orderName}
                                                meta={<>
                                                    <MPill tone="blue">{o.status}</MPill>
                                                    <span>
                                                        #{o.orderNumber} · {o.itemCount}{' '}
                                                        {o.itemCount === 1 ? 'proizvod' : 'proizvoda'}
                                                    </span>
                                                </>}
                                            />
                                        </MCardHead>
                                        <MProgress
                                            pct={o.progressPct}
                                            tone={o.progressPct >= 100 ? 'green' : undefined}
                                            label={<>
                                                <b>{o.progressPct}%</b>
                                                {due && <span className={due.cls}> · {due.text}</span>}
                                            </>}
                                        />
                                    </MCard>
                                );
                            })}
                        </div>
                    )}
                </>
            )}

            {tab === 'gotovo' && (
                <MEmpty
                    title="Arhiva kontrole"
                    sub="Ovdje će stajati potvrđeni procesi i one koje ste vratili na doradu — kad se modul kontrole razvije."
                />
            )}
        </>
    );
}
