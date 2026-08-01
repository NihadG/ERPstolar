'use client';

// ════════════════════════════════════════════════════════════════════
// RADNIK — POČETNA („Danas")
//
// Prati pravila mobilnog dizajna (vidi MobileUI.css): zaključana tip-skala,
// zasebne kartice kad red nosi više podataka, BOJA = STATUS.
//
// „Moj posao" je grupisan PO PROJEKTU (kao svuda gdje su proizvodi), a svaki
// proizvod se otvara u materijale (isti detalj koji je koristio tab Projekti).
// Kartice su obojene po statusu s mekim gradijentom — da radnik na prvi pogled
// vidi šta gori (kasni/rok danas = crveno), šta stoji (pauza = narandžasto),
// šta je gotovo (zeleno) i šta je u toku (plavo).
//
// NEMA NOVCA. Ni dnevnice, ni vrijednosti proizvoda, ni profita — hero nosi
// NAPREDAK i ROK. Payload (lib/field/fieldHome.ts) iznose ni ne sadrži.
// ════════════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import { AlertCircle, CalendarCheck, ChevronRight, Package, Wrench, Hourglass } from 'lucide-react';
import type { FieldHomePayload, FieldAssignment } from '@/lib/field/fieldHome';
import type { FieldProductDetail } from '@/lib/field/fieldProjects';
import { useWorkerRequests } from '@/lib/field/useWorkerRequests';
import { requestKindLabel } from '@/lib/changeRequests';
import CutlistLauncher from './cutlist/CutlistLauncher';
import WorkerProductDetail from './worker/WorkerProductDetail';
import type { ShowToast } from './worker/WorkerApp';
import {
    MLarge, MHero, MSection, MList, MItem, MCell, MText, MValue, MPill,
    MIcon, MEmpty,
} from '@/components/tabs/mobile/MobileUI';

const REQ_STATUS: Record<string, { tone: 'orange' | 'green' | 'red' | 'gray'; label: string }> = {
    pending: { tone: 'orange', label: 'čeka' },
    approved: { tone: 'green', label: 'prihvaćeno' },
    rejected: { tone: 'red', label: 'odbijeno' },
    failed: { tone: 'red', label: 'greška' },
};

const ATTENDANCE_TONE: Record<string, 'green' | 'blue' | 'orange' | 'gray'> = {
    'Prisutan': 'green', 'Teren': 'blue', 'Odmor': 'orange',
    'Bolovanje': 'orange', 'Odsutan': 'gray', 'Vikend': 'gray',
};

type JobTone = 'blue' | 'orange' | 'red' | 'green' | 'gray';

/** Boja kartice = status posla. Crveno gori, narandžasto stoji, zeleno gotovo. */
function jobTone(a: FieldAssignment): JobTone {
    if (a.progressPct >= 100) return 'green';
    if (a.isPaused) return 'orange';
    if (a.daysUntilDue !== null && a.daysUntilDue <= 0) return 'red';
    if (a.status === 'Na čekanju' && a.progressPct === 0) return 'gray';
    return 'blue';
}

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

interface ProjectGroup {
    projectId: string;
    projectName: string;
    items: FieldAssignment[];
    soonest: number;                 // min daysUntilDue (za sort grupa)
}

/** Grupiši „moj posao" po projektu; grupe po hitnosti (najbliži rok prvi). */
function groupByProject(assignments: FieldAssignment[]): ProjectGroup[] {
    const map = new Map<string, ProjectGroup>();
    for (const a of assignments) {
        const key = a.projectId || a.projectName || '—';
        let g = map.get(key);
        if (!g) {
            g = { projectId: key, projectName: a.projectName || a.orderName || 'Bez projekta', items: [], soonest: Infinity };
            map.set(key, g);
        }
        g.items.push(a);
        if (a.daysUntilDue !== null) g.soonest = Math.min(g.soonest, a.daysUntilDue);
    }
    for (const g of map.values()) {
        g.items.sort((x, y) =>
            (x.daysUntilDue ?? 9999) - (y.daysUntilDue ?? 9999)
            || x.productName.localeCompare(y.productName, 'bs'));
    }
    return [...map.values()].sort((a, b) =>
        a.soonest - b.soonest || a.projectName.localeCompare(b.projectName, 'bs'));
}

interface Props {
    data: FieldHomePayload;
    productById: Map<string, FieldProductDetail>;
    previewUid?: string | null;
    showToast: ShowToast;
}

export default function WorkerHome({ data, productById, previewUid, showToast }: Props) {
    const { user, assignments, attendance, week } = data;
    const firstName = user.name.split(' ')[0] || user.name;
    const { requests } = useWorkerRequests(data.preview);
    const [openProductId, setOpenProductId] = useState<string | null>(null);

    // Najnoviji prijedlozi (čeka + skoro riješeni) — da radnik vidi ishod.
    const recentRequests = requests.slice(0, 5);
    const pendingCount = requests.filter(r => r.Status === 'pending').length;

    const groups = useMemo(() => groupByProject(assignments), [assignments]);

    const totalPct = assignments.length
        ? Math.round(assignments.reduce((s, a) => s + a.progressPct, 0) / assignments.length)
        : 0;

    const dateText = new Date(data.today + 'T12:00:00')
        .toLocaleDateString('bs-BA', { weekday: 'long', day: 'numeric', month: 'long' });

    // Poniranje u proizvod (materijali) — iz već dovučenih projekata.
    const openProduct = openProductId ? productById.get(openProductId) : null;
    if (openProduct) {
        return (
            <WorkerProductDetail
                product={openProduct}
                backLabel="Danas"
                previewUid={previewUid}
                showToast={showToast}
                onClose={() => setOpenProductId(null)}
            />
        );
    }

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

            {/* ── Alat: krojna lista (lagan pristup iz Danas) ─────────── */}
            <div style={{ padding: '2px 0 10px' }}>
                <CutlistLauncher />
            </div>

            {/* ── Moj posao (grupisan po projektu, boja = status) ─────── */}
            {assignments.length === 0 ? (
                <>
                    <MSection title="Moj posao" />
                    <MEmpty
                        title="Nema dodijeljenog posla"
                        sub="Kad vas poslodavac dodijeli na proizvod, pojaviće se ovdje."
                    />
                </>
            ) : (
                groups.map(g => (
                    <div key={g.projectId}>
                        <MSection title={g.projectName} right={<span className="mui-dim">{g.items.length}</span>} />
                        <div className="fwk-jobs">
                            {g.items.map(a => {
                                const tone = jobTone(a);
                                const due = dueLabel(a.daysUntilDue);
                                const canOpen = productById.has(a.productId);
                                const isMontaza = a.orderType === 'Montaža';
                                return (
                                    <button
                                        key={a.itemId}
                                        type="button"
                                        className={`fwk-job fwk-job--${tone}`}
                                        onClick={canOpen ? () => setOpenProductId(a.productId) : undefined}
                                        disabled={!canOpen}
                                    >
                                        <div className="fwk-job-top">
                                            <span className="fwk-job-ic">
                                                {isMontaza ? <Wrench size={19} /> : <Package size={19} />}
                                            </span>
                                            <div className="fwk-job-main">
                                                <span className="fwk-job-name">{a.productName || 'Proizvod'}</span>
                                                <span className="fwk-job-sub">
                                                    {a.currentProcess || a.status}
                                                    {a.quantity > 1 ? ` · ${a.quantity} kom` : ''}
                                                </span>
                                            </div>
                                            {canOpen && <ChevronRight size={18} className="fwk-job-chev" />}
                                        </div>

                                        <div className="fwk-job-bar">
                                            <span className="fwk-job-fill" style={{ width: `${Math.min(100, a.progressPct)}%` }} />
                                        </div>
                                        <div className="fwk-job-foot">
                                            <b>{a.progressPct}%</b>
                                            {a.isPaused && <span className="fwk-job-tag">pauzirano</span>}
                                            {due && <span className={`fwk-job-due ${due.cls}`}>{due.text}</span>}
                                            {canOpen && <span className="fwk-job-mat">materijali →</span>}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                ))
            )}

            {/* ── Moji prijedlozi ─────────────────────────────────────── */}
            {recentRequests.length > 0 && (
                <>
                    <MSection
                        title="Moji prijedlozi"
                        right={pendingCount > 0 ? <span className="mui-dim">{pendingCount} čeka</span> : undefined}
                    />
                    <MList lead>
                        {recentRequests.map(r => {
                            const st = REQ_STATUS[r.Status] || REQ_STATUS.pending;
                            return (
                                <MItem key={r.Request_ID}>
                                    <MCell>
                                        <MIcon tone={st.tone}><Hourglass size={17} /></MIcon>
                                        <MText
                                            title={r.Summary || requestKindLabel(r.Kind)}
                                            sub={<>
                                                <MPill tone={st.tone}>{st.label}</MPill>
                                                {r.Status === 'rejected' && r.Reject_Reason && <span>{r.Reject_Reason}</span>}
                                                {r.Work_Order_Name && <span>{r.Work_Order_Name}</span>}
                                            </>}
                                        />
                                    </MCell>
                                </MItem>
                            );
                        })}
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
