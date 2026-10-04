'use client';

// ════════════════════════════════════════════════════════════════════
// ANALITIKA (Proizvodnja → Profiti) — full-screen.
//
// Svi brojevi dolaze iz lib/projectFinance.ts (isti proračun kao kartica projekta,
// pregled projekta i nalog); ovaj ekran samo bira period/opseg i prikazuje.
//   profit = prihod iz prihvaćene ponude − materijal (sastavnica + dodaci) − rad,
//   samo za ZAVRŠENE proizvode.
// ════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useData } from '@/context/DataContext';
import {
    X, BarChart3, FolderKanban, Package, GitCompareArrows, RefreshCw, Search, Loader2, Users, Fingerprint, AlertTriangle,
} from 'lucide-react';
import ProfilesTab from './ProfilesTab';
import { workOrderDisplayName } from '@/lib/utils';
import { getAnalyticsRaw, analyticsInput } from '@/lib/services/profit/analyticsService';
import type { AnalyticsRaw } from '@/lib/services/profit/analyticsService';
import {
    computeAnalytics, computeAnalyticsFinance,
    type AnalyticsData, type AnalyticsScope, type AnalyticsProduct, type PvAMetric, type IssueKind,
} from '@/lib/analytics';
import { liveLogs, STAGE_LABEL, REVENUE_SOURCE_LABEL } from '@/lib/projectFinance';
import type { Project, WorkLog } from '@/lib/types';
import ProductTimelineModal from './ProductTimelineModal';
import './AnalyticsDashboard.css';

interface AnalyticsDashboardProps {
    onClose: () => void;
    /** Projekti iz glavnog store-a (page.tsx) — proizvodi sa živom sastavnicom. */
    projects?: Project[];
    showToast?: (message: string, type: 'success' | 'error' | 'info') => void;
    onRefresh?: (...collections: string[]) => void;
    /** Samo dev preview (/analytics-preview): gotovi sirovi podaci umjesto dohvata iz baze. */
    initialRaw?: AnalyticsRaw;
}

type Tab ='overview' | 'workers' | 'projects' | 'products' | 'planvsactual' | 'profili';
type Period = 'all' | 'month' | '30d';
type ProductFilter = 'zavrseno' | 'u_izradi' | 'nije_zapoceto' | 'provjera' | 'sve';

const fmt = (n: number) => `${Math.round(n).toLocaleString('hr-HR')} KM`;
const num = (n: number) => Math.round(n).toLocaleString('hr-HR');
const pct = (n: number) => `${Math.round(n)}%`;
const toISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const human = (iso: string) => { const d = new Date(iso + 'T12:00:00'); return `${d.getDate()}.${d.getMonth() + 1}.`; };
const humanFull = (iso: string) => { if (!iso) return ''; const d = new Date(iso + 'T12:00:00'); return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}.`; };

function periodRange(period: Period): { from?: string; to?: string } {
    const now = new Date();
    if (period === 'month') {
        return { from: toISO(new Date(now.getFullYear(), now.getMonth(), 1)), to: toISO(new Date(now.getFullYear(), now.getMonth() + 1, 0)) };
    }
    if (period === '30d') {
        const f = new Date(now); f.setDate(f.getDate() - 29);
        return { from: toISO(f), to: toISO(now) };
    }
    return {};
}

const PERIOD_LABEL: Record<Period, string> = { all: 'Sve', month: 'Ovaj mjesec', '30d': 'Zadnjih 30 dana' };

const ISSUE_LABEL: Record<IssueKind, string> = {
    noOffer: 'nije u prihvaćenoj ponudi',
    noPrice: 'cijena u ponudi je 0',
    noMaterial: 'bez materijala',
    noLabor: 'završen bez ijedne dnevnice',
    qtyMismatch: 'količina se ne slaže s ponudom',
};

/** Jednostavna horizontalna traka (width ∝ value/max). */
function HBar({ value, max, color }: { value: number; max: number; color: string }) {
    const w = max > 0 ? Math.max(2, (Math.abs(value) / max) * 100) : 0;
    return <div className="ana-bar-track"><div className="ana-bar-fill" style={{ width: `${w}%`, background: color }} /></div>;
}

const tone = (n: number) => (n > 0 ? 'green' : n < 0 ? 'red' : '');

/** Bosanska množina: 1 projekat · 2–4 projekta · 5+ projekata (11–14 → mnoštvo). */
function pl(n: number, one: string, few: string, many: string): string {
    const d = Math.abs(Math.round(n)) % 10, h = Math.abs(Math.round(n)) % 100;
    if (d === 1 && h !== 11) return one;
    if (d >= 2 && d <= 4 && (h < 12 || h > 14)) return few;
    return many;
}

export default function AnalyticsDashboard({ onClose, projects, showToast, onRefresh, initialRaw }: AnalyticsDashboardProps) {
    const { organizationId, appState } = useData();
    const allWorkers = appState.workers || [];
    const projectList = useMemo(() => ((projects && projects.length ? projects : appState.projects) || []), [projects, appState.projects]);

    const [tab, setTab] = useState<Tab>('overview');
    const [period, setPeriod] = useState<Period>('all');
    const [scope, setScope] = useState<AnalyticsScope>('active');
    const [raw, setRaw] = useState<AnalyticsRaw | null>(initialRaw || null);
    const [loading, setLoading] = useState(!initialRaw);
    const [productFilter, setProductFilter] = useState<ProductFilter>('zavrseno');

    // Drill u timeline proizvoda
    const [timeline, setTimeline] = useState<AnalyticsProduct | null>(null);
    const [timelineLogs, setTimelineLogs] = useState<WorkLog[]>([]);
    const [loadingTimeline, setLoadingTimeline] = useState(false);

    // Drill u kalendar rada po projektu / radniku (dan-po-dan)
    const [projectCal, setProjectCal] = useState<{ projectId: string; projectName: string } | null>(null);
    const [workerCal, setWorkerCal] = useState<{ workerId: string; workerName: string } | null>(null);

    // Dohvat JEDNOM (otvaranje / Osvježi). Promjena perioda/opsega = in-memory (bez novog upita).
    const loadRaw = useCallback(async () => {
        if (!organizationId || initialRaw) return;
        setLoading(true);
        try {
            setRaw(await getAnalyticsRaw(organizationId));
        } catch (e) {
            console.error('analytics load failed', e);
            showToast?.('Greška pri učitavanju analitike', 'error');
        } finally {
            setLoading(false);
        }
    }, [organizationId, showToast, initialRaw]);

    useEffect(() => { loadRaw(); }, [loadRaw]);

    const input = useMemo(() => (raw ? analyticsInput(raw, projectList, allWorkers) : null), [raw, projectList, allWorkers]);
    // Finansije svih projekata se računaju jednom; period/opseg su samo filteri.
    const finance = useMemo(() => (input ? computeAnalyticsFinance(input) : null), [input]);
    const data = useMemo<AnalyticsData | null>(
        () => (input && finance ? computeAnalytics(input, { ...periodRange(period), scope, finance }) : null),
        [input, finance, period, scope]
    );

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !timeline && !projectCal && !workerCal) onClose(); };
        window.addEventListener('keydown', onKey);
        document.body.style.overflow = 'hidden';
        return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
    }, [onClose, timeline, projectCal, workerCal]);

    const openTimeline = async (p: AnalyticsProduct) => {
        if (!organizationId || !p.workOrderId) return;
        setLoadingTimeline(true);
        try {
            const { getWorkLogsForWorkOrder } = await import('@/lib/services');
            setTimelineLogs(liveLogs(await getWorkLogsForWorkOrder(p.workOrderId, organizationId)));
            setTimeline(p);
        } catch (e) { console.error(e); showToast?.('Greška pri učitavanju timeline-a', 'error'); }
        finally { setLoadingTimeline(false); }
    };

    const TABS: { id: Tab; label: string; Icon: typeof BarChart3 }[] = [
        { id: 'overview', label: 'Pregled', Icon: BarChart3 },
        { id: 'projects', label: 'Projekti', Icon: FolderKanban },
        { id: 'products', label: 'Proizvodi', Icon: Package },
        { id: 'workers', label: 'Radnici', Icon: Users },
        { id: 'planvsactual', label: 'Plan vs stvarno', Icon: GitCompareArrows },
        { id: 'profili', label: 'Profili', Icon: Fingerprint },
    ];
    // Opseg projekata nema smisla za radnike (zarada ne zavisi od projekta) ni profile.
    const showScope = tab !== 'workers' && tab !== 'profili';
    const showPeriod = tab !== 'profili';

    return (
        <>
            <div className="ana-overlay" onClick={onClose} />
            <div className="ana-modal">
                <div className="ana-header">
                    <div className="ana-title"><BarChart3 size={20} /> <span>Analitika</span></div>
                    <div className="ana-header-controls">
                        {showPeriod && (
                            <div className="ana-seg" role="group" aria-label="Period">
                                {(['all', 'month', '30d'] as Period[]).map(p => (
                                    <button key={p} className={period === p ? 'on' : ''} onClick={() => setPeriod(p)}>{PERIOD_LABEL[p]}</button>
                                ))}
                            </div>
                        )}
                        {showScope && (
                            <div className="ana-seg" role="group" aria-label="Projekti">
                                {(['active', 'all'] as AnalyticsScope[]).map(s => (
                                    <button key={s} className={scope === s ? 'on' : ''} onClick={() => setScope(s)}
                                        title={s === 'active' ? 'Projekti koji nisu završeni ni otkazani' : 'Svi projekti osim otkazanih'}>
                                        {s === 'active' ? 'Aktivni projekti' : 'Svi projekti'}
                                    </button>
                                ))}
                            </div>
                        )}
                        <button className="ana-icon-btn" onClick={loadRaw} title="Osvježi"><RefreshCw size={16} /></button>
                        <button className="ana-icon-btn" onClick={onClose} title="Zatvori"><X size={18} /></button>
                    </div>
                </div>

                <div className="ana-tabs">
                    {TABS.map(t => (
                        <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
                            <t.Icon size={15} /> {t.label}
                            {t.id === 'products' && data && data.issues.length > 0 && <span className="ana-tab-badge" title="Proizvodi za provjeru">{data.kpis.flaggedProducts}</span>}
                        </button>
                    ))}
                </div>

                <div className="ana-body">
                    {tab === 'profili' ? (
                        <ProfilesTab organizationId={organizationId || ''} />
                    ) : loading || !data ? (
                        <div className="ana-center"><Loader2 size={20} className="ana-spin" /> Učitavanje…</div>
                    ) : tab === 'overview' ? (
                        <Overview data={data} period={period} onGoTo={setTab} onIssues={() => { setProductFilter('provjera'); setTab('products'); }} />
                    ) : tab === 'projects' ? (
                        <ProjectsTable data={data} onPick={(projectId, projectName) => setProjectCal({ projectId, projectName })} />
                    ) : tab === 'workers' ? (
                        <WorkersTable data={data} onPick={(workerId, workerName) => setWorkerCal({ workerId, workerName })} />
                    ) : tab === 'products' ? (
                        <ProductsTable data={data} filter={productFilter} onFilter={setProductFilter} loadingTimeline={loadingTimeline} onDetails={openTimeline} />
                    ) : (
                        <PlanVsActualTab data={data} />
                    )}
                </div>
            </div>

            {timeline && (
                <ProductTimelineModal
                    isOpen={true}
                    onClose={() => { setTimeline(null); setTimelineLogs([]); loadRaw(); }}
                    productId={timeline.productId}
                    productName={timeline.name}
                    workOrderItem={{ ID: timeline.itemId, Product_ID: timeline.productId, Product_Name: timeline.name, Work_Order_ID: timeline.workOrderId, Status: timeline.itemStatus, Product_Value: timeline.revenue, Actual_Labor_Cost: timeline.labor } as unknown as Parameters<typeof ProductTimelineModal>[0]['workOrderItem']}
                    workLogs={timelineLogs.filter(wl => wl.Product_ID === timeline.productId)}
                    sellingPrice={timeline.revenue}
                    materialCost={timeline.material}
                    laborCost={timeline.labor}
                    profit={timeline.profit}
                    profitMargin={timeline.margin}
                    workers={allWorkers}
                    onOverrideWorkLogs={async (entries) => {
                        if (!organizationId) return { success: false, message: 'Nedostaju podaci' };
                        const { overrideWorkLogs } = await import('@/lib/services');
                        const res = await overrideWorkLogs(timeline.workOrderId, timeline.itemId, entries, organizationId, timeline.productId);
                        if (res.success) { showToast?.('Ažurirano', 'success'); onRefresh?.('workOrders', 'workLogs'); setTimeline(null); loadRaw(); }
                        else showToast?.(res.message, 'error');
                        return res;
                    }}
                />
            )}

            {projectCal && raw && (
                <ProjectWorkCalendar raw={raw} projectId={projectCal.projectId} projectName={projectCal.projectName} onClose={() => setProjectCal(null)} />
            )}

            {workerCal && raw && (
                <WorkerWorkCalendar raw={raw} workerId={workerCal.workerId} workerName={workerCal.workerName} onClose={() => setWorkerCal(null)} />
            )}
        </>
    );
}

// ── Pregled — „Kako stojimo?" ────────────────────────────────────────────────
function Overview({ data, period, onGoTo, onIssues }: { data: AnalyticsData; period: Period; onGoTo: (t: Tab) => void; onIssues: () => void }) {
    const k = data.kpis;
    const r = k.realized;
    const ip = k.inProgress;
    const razniProjects = Math.round((k.profit - r.profit) * 100) / 100;
    const top = data.projects.filter(p => p.realized.count > 0 || p.razniProfit !== 0).slice(0, 5);
    const maxAbs = Math.max(1, ...top.map(p => Math.abs(p.profit)));
    const issueGroups = useMemo(() => {
        const m = new Map<IssueKind, number>();
        data.issues.forEach(i => m.set(i.kind, (m.get(i.kind) || 0) + 1));
        return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
    }, [data.issues]);
    // Isto poređenje kao tab Plan vs stvarno: samo proizvodi u izradi koji IMAJU plan rada.
    const ipLabor = data.pva.inProgressLabor;
    const laborUsedPct = ipLabor.planned > 0 ? (ipLabor.actual / ipLabor.planned) * 100 : 0;
    const periodText = period === 'all' ? 'do danas' : period === 'month' ? 'ovaj mjesec' : 'u zadnjih 30 dana';

    return (
        <div className="ana-section">
            {/* Račun profita — svaka stavka na svom redu, kao izvod */}
            <div className="ana-hero">
                <div className={`ana-hero-main ${k.profit >= 0 ? 'pos' : 'neg'}`}>
                    <span className="ana-hero-label">Ostvareni profit {periodText}</span>
                    <span className="ana-hero-value">{fmt(k.profit)}</span>
                    <span className="ana-hero-sub">
                        {r.count > 0 ? `${r.count} ${pl(r.count, 'završen proizvod', 'završena proizvoda', 'završenih proizvoda')} · marža ${pct(k.margin)}` : 'Nema završenih proizvoda u periodu'}
                    </span>
                </div>
                <div className="ana-statement" aria-label="Račun profita">
                    <div className="ana-st-row"><span>Prihod iz prihvaćenih ponuda</span><b>{fmt(r.revenue)}</b></div>
                    <div className="ana-st-row"><span>− Materijal iz sastavnice</span><b>{fmt(r.materialBom)}</b></div>
                    {r.materialExtras > 0 && <div className="ana-st-row"><span>− Dodaci iz ponude (materijal van sastavnice)</span><b>{fmt(r.materialExtras)}</b></div>}
                    <div className="ana-st-row"><span>− Rad (dnevnice)</span><b>{fmt(r.labor)}</b></div>
                    {razniProjects !== 0 && <div className="ana-st-row"><span>± Razni nalozi vezani za projekte</span><b>{fmt(razniProjects)}</b></div>}
                    <div className={`ana-st-row total ${tone(k.profit)}`}><span>= Profit</span><b>{fmt(k.profit)}</b></div>
                    <p className="ana-st-note">Računaju se samo proizvodi završeni {period === 'all' ? '' : 'u periodu '}— prihod i trošak istog proizvoda zajedno.</p>
                </div>
            </div>

            <div className="ana-grid3">
                <button className="ana-tile" onClick={() => onGoTo('projects')}>
                    <span className="ana-tile-label">Ugovoreno (prihvaćene ponude)</span>
                    <b className="ana-tile-value">{fmt(k.contracted)}</b>
                    <span className="ana-tile-sub">{data.projects.length} {pl(data.projects.length, 'projekat', 'projekta', 'projekata')} · {k.notStartedCount} {pl(k.notStartedCount, 'proizvod još nije počeo', 'proizvoda još nisu počela', 'proizvoda još nije počelo')}</span>
                </button>
                <button className="ana-tile" onClick={() => onGoTo('products')}>
                    <span className="ana-tile-label">U izradi</span>
                    <b className="ana-tile-value">{ip.count} {pl(ip.count, 'proizvod', 'proizvoda', 'proizvoda')}</b>
                    <span className="ana-tile-sub">
                        {ip.count > 0
                            ? `prihod ${fmt(ip.revenue)} · uloženo ${fmt(ip.material + ip.labor)}${ipLabor.planned > 0 ? ` · rad ${pct(laborUsedPct)} plana` : ''}`
                            : 'Ništa trenutno u izradi'}
                    </span>
                </button>
                <div className="ana-tile">
                    <span className="ana-tile-label">Razni poslovi bez projekta</span>
                    <b className="ana-tile-value">{fmt(k.razni.labor)}</b>
                    <span className="ana-tile-sub">rad {periodText} · {k.razni.tasks} {pl(k.razni.tasks, 'posao', 'posla', 'poslova')} · nije u profitu projekata</span>
                </div>
            </div>

            {(data.issues.length > 0 || k.unbookedDays > 0) && (
                <div className="ana-card ana-issues">
                    <div className="ana-card-title"><AlertTriangle size={15} /> Za provjeru</div>
                    <ul className="ana-issue-list">
                        {issueGroups.map(([kind, n]) => (
                            <li key={kind}><b>{n}</b> {pl(n, 'proizvod', 'proizvoda', 'proizvoda')} — {ISSUE_LABEL[kind]}</li>
                        ))}
                        {k.unbookedDays > 0 && (
                            <li><b>{k.unbookedDays}</b> {pl(k.unbookedDays, 'dan', 'dana', 'dana')} s radnikom prisutnim po šihtarici, a bez dnevnice — taj rad nije ni u trošku ni u plati</li>
                        )}
                    </ul>
                    <div className="ana-issue-actions">
                        {data.issues.length > 0 && <button className="ana-link" onClick={onIssues}>Prikaži proizvode →</button>}
                        {k.unbookedDays > 0 && <button className="ana-link" onClick={() => onGoTo('workers')}>Prikaži radnike →</button>}
                    </div>
                </div>
            )}

            <div className="ana-card">
                <div className="ana-card-title">Trošak rada po sedmici{data.range.from ? ' (period)' : ''} · ukupno {fmt(k.laborInPeriod)}</div>
                <TrendChart points={data.weeklyTrend.map(w => ({ label: human(w.weekStart), value: w.labor }))} color="#16a34a" />
            </div>

            <div className="ana-card">
                <div className="ana-card-title">Projekti po ostvarenom profitu</div>
                {top.length === 0 ? <div className="ana-empty">Nema završenih proizvoda u periodu.</div> : top.map(p => (
                    <div key={p.projectId} className="ana-rowbar">
                        <span className="ana-rowbar-label" title={p.name}>{p.name}</span>
                        <HBar value={p.profit} max={maxAbs} color={p.profit >= 0 ? '#22c55e' : '#ef4444'} />
                        <span className={`ana-rowbar-val ${tone(p.profit)}`}>{fmt(p.profit)}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

/** Čist SVG line+area trend. */
function TrendChart({ points, color }: { points: { label: string; value: number }[]; color: string }) {
    if (points.length === 0) return <div className="ana-empty">Nema rada u periodu.</div>;
    const W = 100, H = 36;
    const max = Math.max(1, ...points.map(p => p.value));
    const n = points.length;
    const x = (i: number) => (n <= 1 ? W / 2 : (i / (n - 1)) * W);
    const y = (v: number) => H - (v / max) * (H - 3) - 1.5;
    const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');
    const area = `${line} L ${x(n - 1).toFixed(1)} ${H} L ${x(0).toFixed(1)} ${H} Z`;
    // Najviše ~12 oznaka na x-osi da se ne preklapaju.
    const step = Math.max(1, Math.ceil(n / 12));
    return (
        <div className="ana-chart">
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="ana-chart-svg" role="img" aria-label="Trošak rada po sedmici">
                <path d={area} fill={color} opacity="0.12" />
                <path d={line} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
            </svg>
            <div className="ana-chart-x">{points.map((p, i) => <span key={i}>{i % step === 0 ? p.label : ''}</span>)}</div>
        </div>
    );
}

// ── Projekti ─────────────────────────────────────────────────────────────────
function ProjectsTable({ data, onPick }: { data: AnalyticsData; onPick: (projectId: string, projectName: string) => void }) {
    const rows = data.projects;
    const t = useMemo(() => {
        const s = { contracted: 0, revenue: 0, material: 0, labor: 0, profit: 0, finished: 0, scope: 0, spentMaterial: 0, spentLabor: 0 };
        rows.forEach(p => {
            s.contracted += p.contracted; s.revenue += p.realized.revenue; s.material += p.realized.material;
            s.labor += p.realized.labor; s.profit += p.profit;
            s.finished += p.realized.count; s.scope += p.scopeCount;
            s.spentMaterial += p.spentMaterial; s.spentLabor += p.spentLabor;
        });
        return s;
    }, [rows]);
    const razni = data.kpis.razni;
    const periodOn = !!(data.range.from || data.range.to);
    return (
        <div className="ana-section">
            <p className="ana-hint">
                Profit se računa samo za ZAVRŠENE proizvode{periodOn ? ' (završene u periodu)' : ''}: prihod iz prihvaćene ponude − materijal − rad tih proizvoda.
                „Uloženo do danas" je SAV materijal i rad na projektu, i na proizvodima koji još nisu gotovi. Klik na red otvara kalendar rada.
            </p>
            <div className="ana-table-wrap">
                <table className="ana-table ana-table-grouped">
                    <thead>
                        <tr className="ana-th-group">
                            <th rowSpan={2}>Projekat</th>
                            <th rowSpan={2} className="r">Ugovoreno</th>
                            <th colSpan={6} className="c ana-th-band profit-col">Završeni proizvodi — u profitu</th>
                            <th colSpan={2} className="c ana-th-band ana-th-spent">Uloženo do danas</th>
                        </tr>
                        <tr>
                            <th className="r profit-col" title="Završeni / proizvodi u obimu posla (u prihvaćenoj ponudi ili već započeti)">Gotovo</th>
                            <th className="r">Prihod</th>
                            <th className="r">Materijal</th>
                            <th className="r">Rad</th>
                            <th className="r">Profit</th>
                            <th className="r">Marža</th>
                            <th className="r ana-th-spent">Materijal</th>
                            <th className="r">Rad</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.length === 0 && <tr><td colSpan={10} className="ana-empty">Nema projekata u odabranom opsegu.</td></tr>}
                        {rows.map(p => (
                            <tr key={p.projectId} className="ana-row-click" onClick={() => onPick(p.projectId, p.name)} title="Otvori kalendar rada">
                                <td>
                                    <span className="ana-cell-title" title={p.name}>{p.name}</span>
                                    <span className="ana-cell-meta">{p.client && p.client !== p.name ? `${p.client} · ` : ''}{p.status || '—'}{p.flagged > 0 ? ` · ${p.flagged} za provjeru` : ''}</span>
                                </td>
                                <td className="r money">{p.contracted > 0 ? fmt(p.contracted) : <span className="muted">bez ponude</span>}</td>
                                <td className="r money profit-col" title={p.outOfContractCount > 0 ? `${p.outOfContractCount} proizvoda projekta nije ni u jednoj prihvaćenoj ponudi i nije započeto — ne broji se` : undefined}>
                                    {p.finishedCount}/{p.scopeCount}
                                </td>
                                <td className="r money">{p.realized.count > 0 ? fmt(p.realized.revenue) : <span className="muted">—</span>}</td>
                                <td className="r money">{p.realized.count > 0 ? fmt(p.realized.material) : <span className="muted">—</span>}</td>
                                <td className="r money">{p.realized.count > 0 ? fmt(p.realized.labor) : <span className="muted">—</span>}</td>
                                <td className={`r money b ${tone(p.profit)}`}>{p.realized.count > 0 || p.razniProfit !== 0 ? fmt(p.profit) : <span className="muted">—</span>}</td>
                                <td className={`r money ${tone(p.profit)}`}>{p.realized.count > 0 ? pct(p.margin) : ''}</td>
                                <td className="r money ana-th-spent">{p.spentMaterial > 0 ? fmt(p.spentMaterial) : <span className="muted">—</span>}</td>
                                <td className="r money">{p.spentLabor > 0 ? fmt(p.spentLabor) : <span className="muted">—</span>}</td>
                            </tr>
                        ))}
                    </tbody>
                    {rows.length > 0 && (
                        <tfoot>
                            <tr>
                                <td>Ukupno</td>
                                <td className="r money">{fmt(t.contracted)}</td>
                                <td className="r money profit-col">{t.finished}/{t.scope}</td>
                                <td className="r money">{fmt(t.revenue)}</td>
                                <td className="r money">{fmt(t.material)}</td>
                                <td className="r money">{fmt(t.labor)}</td>
                                <td className={`r money ${tone(t.profit)}`}>{fmt(t.profit)}</td>
                                <td className={`r money ${tone(t.profit)}`}>{t.revenue > 0 ? pct((t.profit / t.revenue) * 100) : ''}</td>
                                <td className="r money ana-th-spent">{fmt(t.spentMaterial)}</td>
                                <td className="r money">{fmt(t.spentLabor)}</td>
                            </tr>
                        </tfoot>
                    )}
                </table>
            </div>

            <div className="ana-card ana-razni">
                <div className="ana-card-title">Razni poslovi bez projekta</div>
                <div className="ana-razni-row">
                    <span>Rad {periodOn ? 'u periodu' : 'ukupno'}</span><b>{fmt(razni.labor)}</b>
                    <span>Ostali troškovi i materijal</span><b>{fmt(razni.material + razni.other)}</b>
                    <span>Vrijednost poslova</span><b>{fmt(razni.revenue)}</b>
                    <span>Rezultat</span><b className={tone(razni.profit)}>{fmt(razni.profit)}</b>
                </div>
                <p className="ana-st-note">Računa se kao i do sada (vrijednost − materijal − ostalo − rad) i ne ulazi u profit projekata. Posao koji pripada projektu (npr. montaža ili lakiranje za klijenta) veži za projekat pri kreiranju raznog posla — tada ulazi u trošak tog projekta.</p>
            </div>
        </div>
    );
}

// ── Proizvodi ────────────────────────────────────────────────────────────────
const FILTERS: { id: ProductFilter; label: string }[] = [
    { id: 'zavrseno', label: 'Završeni' },
    { id: 'u_izradi', label: 'U izradi' },
    { id: 'nije_zapoceto', label: 'Nisu počeli' },
    { id: 'provjera', label: 'Za provjeru' },
    { id: 'sve', label: 'Svi' },
];

function productIssueText(p: AnalyticsProduct): string {
    const f = p.flags;
    if (f.noOffer) return p.revenue > 0 ? 'nije u prihvaćenoj ponudi — cijena s naloga' : 'nije u prihvaćenoj ponudi';
    if (f.noPrice) return 'cijena u ponudi je 0';
    if (f.noMaterial) return 'bez materijala';
    if (f.noLabor) return 'završen bez dnevnica';
    if (f.qtyMismatch) return `količina: proizvod ${p.quantity}, ponuda ${p.offerQty}`;
    if (f.withoutWorkOrder) return 'gotov bez naloga';
    return '';
}

function ProductsTable({ data, filter, onFilter, loadingTimeline, onDetails }: {
    data: AnalyticsData; filter: ProductFilter; onFilter: (f: ProductFilter) => void; loadingTimeline: boolean; onDetails: (p: AnalyticsProduct) => void;
}) {
    const [search, setSearch] = useState('');
    const flaggedIds = useMemo(() => new Set(data.issues.map(i => i.productId)), [data.issues]);
    const counts = useMemo(() => ({
        zavrseno: data.products.filter(p => p.stage === 'zavrseno' && p.inPeriod).length,
        u_izradi: data.products.filter(p => p.stage === 'u_izradi').length,
        nije_zapoceto: data.products.filter(p => p.stage === 'nije_zapoceto').length,
        provjera: flaggedIds.size,
        sve: data.products.length,
    }), [data.products, flaggedIds]);

    const rows = useMemo(() => {
        const s = search.trim().toLowerCase();
        let list = data.products.filter(p => {
            if (filter === 'zavrseno') return p.stage === 'zavrseno' && p.inPeriod;
            if (filter === 'u_izradi') return p.stage === 'u_izradi';
            if (filter === 'nije_zapoceto') return p.stage === 'nije_zapoceto';
            if (filter === 'provjera') return flaggedIds.has(p.productId);
            return true;
        });
        if (s) list = list.filter(p => `${p.name} ${p.projectName} ${p.client} ${p.workOrders.map(w => w.number).join(' ')}`.toLowerCase().includes(s));
        return [...list].sort((a, b) => (filter === 'zavrseno' ? b.profit - a.profit : b.revenue - a.revenue || a.name.localeCompare(b.name, 'hr')));
    }, [data.products, filter, search, flaggedIds]);

    const sum = useMemo(() => rows.reduce((s, p) => ({ revenue: s.revenue + (p.stage === 'nije_zapoceto' ? p.contracted : p.revenue), material: s.material + p.material, labor: s.labor + p.labor, profit: s.profit + (p.stage === 'zavrseno' ? p.profit : 0) }), { revenue: 0, material: 0, labor: 0, profit: 0 }), [rows]);

    return (
        <div className="ana-section">
            <div className="ana-toolbar">
                <div className="ana-seg" role="group" aria-label="Faza proizvoda">
                    {FILTERS.map(f => (
                        <button key={f.id} className={filter === f.id ? 'on' : ''} onClick={() => onFilter(f.id)}>
                            {f.label} <span className="ana-seg-count">{counts[f.id]}</span>
                        </button>
                    ))}
                </div>
                <div className="ana-search"><Search size={16} /><input placeholder="Pretraži proizvod, projekat ili nalog…" value={search} onChange={e => setSearch(e.target.value)} /></div>
            </div>
            {filter === 'u_izradi' && <p className="ana-hint">Proizvodi u izradi nisu u profitu: prikazan je trošak do sada i koliko je potrošeno od planiranog rada.</p>}
            {filter === 'nije_zapoceto' && <p className="ana-hint">Proizvodi iz prihvaćenih ponuda koji još nisu ni u jednom nalogu — prikazana je ugovorena vrijednost.</p>}
            <div className="ana-table-wrap">
                <table className="ana-table ana-table-fixed">
                    <colgroup>
                        <col style={{ width: '30%' }} />
                        <col style={{ width: '12%' }} />
                        <col style={{ width: '12%' }} />
                        <col style={{ width: '12%' }} />
                        <col style={{ width: '11%' }} />
                        <col style={{ width: '15%' }} />
                        <col style={{ width: '8%' }} />
                    </colgroup>
                    <thead>
                        <tr>
                            <th>Proizvod</th>
                            <th>Faza</th>
                            <th className="r">{filter === 'nije_zapoceto' ? 'Ugovoreno' : 'Prihod'}</th>
                            <th className="r">Materijal</th>
                            <th className="r">Rad</th>
                            <th className="r profit-col">Profit</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.length === 0 && <tr><td colSpan={7} className="ana-empty">Nema proizvoda za ovaj prikaz.</td></tr>}
                        {rows.map(p => {
                            const issue = productIssueText(p);
                            const wo = p.workOrders.find(w => w.id === p.workOrderId) || p.workOrders[0];
                            const laborPct = p.plannedLabor > 0 ? (p.labor / p.plannedLabor) * 100 : 0;
                            return (
                                <tr key={p.productId}>
                                    <td>
                                        <span className="ana-cell-title" title={p.name}>{p.name}</span>
                                        <span className="ana-cell-meta" title={`${p.projectName}${wo ? ` · #${wo.number}` : ''}`}>
                                            {p.projectName}{wo?.number ? ` · #${wo.number}` : ''}
                                            {issue && <span className={flaggedIds.has(p.productId) ? 'ana-flag' : 'muted'}> · {issue}</span>}
                                        </span>
                                    </td>
                                    <td>
                                        <span className={`ana-stage ${p.stage}`}>{STAGE_LABEL[p.stage]}</span>
                                        {p.stage === 'zavrseno' && p.completedAt && <span className="ana-cell-meta">{humanFull(p.completedAt)}</span>}
                                    </td>
                                    <td className="r money">
                                        {p.stage === 'nije_zapoceto'
                                            ? (p.contracted > 0 ? fmt(p.contracted) : <span className="muted">—</span>)
                                            : <span className="ana-pa"><span>{fmt(p.revenue)}</span><span className="ana-pa-plan muted">{p.revenueSource === 'ponuda' && p.offerNumber ? `ponuda ${p.offerNumber}` : REVENUE_SOURCE_LABEL[p.revenueSource]}</span></span>}
                                    </td>
                                    <td className="r money">
                                        {p.stage === 'nije_zapoceto' ? <span className="muted">—</span> : (
                                            <span className="ana-pa">
                                                <span>{fmt(p.material)}</span>
                                                {p.plannedMaterial > 0 && <span className={`ana-pa-plan ${p.material > p.plannedMaterial + 0.5 ? 'red' : 'muted'}`}>plan {num(p.plannedMaterial)}</span>}
                                            </span>
                                        )}
                                    </td>
                                    <td className="r money">
                                        {p.stage === 'nije_zapoceto' && p.labor <= 0 ? <span className="muted">—</span> : (
                                            <span className="ana-pa">
                                                <span>{fmt(p.labor)}</span>
                                                {p.plannedLabor > 0 && <span className={`ana-pa-plan ${p.labor > p.plannedLabor + 0.5 ? 'red' : 'muted'}`}>plan {num(p.plannedLabor)}</span>}
                                            </span>
                                        )}
                                    </td>
                                    <td className={`r money b profit-col ${p.stage === 'zavrseno' ? tone(p.profit) : ''}`}>
                                        {p.stage === 'zavrseno' ? (
                                            <span className="ana-pa">
                                                <span>{fmt(p.profit)} · {pct(p.margin)}</span>
                                                {(p.plannedMaterial > 0 || p.plannedLabor > 0) && <span className="ana-pa-plan muted">plan {num(p.plannedProfit)}</span>}
                                            </span>
                                        ) : p.stage === 'u_izradi' ? (
                                            <span className="ana-pa"><span className="muted">nije gotov</span>{p.plannedLabor > 0 && <span className={`ana-pa-plan ${laborPct > 100 ? 'red' : 'muted'}`}>rad {pct(laborPct)} plana</span>}</span>
                                        ) : <span className="muted">—</span>}
                                    </td>
                                    <td className="r">
                                        {p.itemId && <button className="ana-link" disabled={loadingTimeline} onClick={() => onDetails(p)}>Detalji →</button>}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                    {rows.length > 1 && (
                        <tfoot>
                            <tr>
                                <td>Ukupno ({rows.length})</td>
                                <td></td>
                                <td className="r money">{fmt(sum.revenue)}</td>
                                <td className="r money">{fmt(sum.material)}</td>
                                <td className="r money">{fmt(sum.labor)}</td>
                                <td className={`r money profit-col ${tone(sum.profit)}`}>{filter === 'u_izradi' || filter === 'nije_zapoceto' ? '' : fmt(sum.profit)}</td>
                                <td></td>
                            </tr>
                        </tfoot>
                    )}
                </table>
            </div>
        </div>
    );
}

// ── Radnici ──────────────────────────────────────────────────────────────────
function WorkersTable({ data, onPick }: { data: AnalyticsData; onPick: (workerId: string, workerName: string) => void }) {
    const rows = data.workers;
    const t = rows.reduce((s, w) => ({ present: s.present + w.presentDays, booked: s.booked + w.bookedDays, unbooked: s.unbooked + w.unbookedDays, earnings: s.earnings + w.earnings, products: s.products + w.productsKM, razni: s.razni + w.razniKM }), { present: 0, booked: 0, unbooked: 0, earnings: 0, products: 0, razni: 0 });
    return (
        <div className="ana-section">
            <p className="ana-hint">
                Zarada = zbir proknjiženih dnevnica u periodu (isto kao obračun plata), bez obzira na projekat. Prosječna dnevnica = zarada ÷ radnik-dani.
                „Bez dnevnice" su dani kad je radnik prisutan po šihtarici, a nije proknjižen ni na jedan nalog. Dnevnice obrisanih naloga se ne broje.
            </p>
            {rows.length === 0 ? (
                <div className="ana-empty">Nema evidentiranog rada u odabranom periodu.</div>
            ) : (
                <div className="ana-table-wrap">
                    <table className="ana-table">
                        <thead>
                            <tr>
                                <th>Radnik</th>
                                <th className="r">Prisutan</th>
                                <th className="r">Proknjiženo</th>
                                <th className="r">Bez dnevnice</th>
                                <th className="r profit-col">Zarada</th>
                                <th className="r">Prosj. dnevnica</th>
                                <th className="r">Na proizvodima</th>
                                <th className="r">Razni poslovi</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map(w => (
                                <tr key={w.workerId} className="ana-row-click" onClick={() => onPick(w.workerId, w.name)} title="Otvori kalendar rada radnika">
                                    <td><span className="pwc-av" style={{ background: pwcColor(w.name), marginRight: 8 }}>{pwcInitials(w.name)}</span>{w.name}</td>
                                    <td className="r money">{w.presentDays} d</td>
                                    <td className="r money">{w.bookedDays.toLocaleString('hr-HR')} d</td>
                                    <td className={`r money ${w.unbookedDays > 0 ? 'amber' : 'muted'}`}>{w.unbookedDays > 0 ? `${w.unbookedDays} d` : '—'}</td>
                                    <td className="r money b profit-col">{fmt(w.earnings)}</td>
                                    <td className="r money">{w.avgRate > 0 ? fmt(w.avgRate) : '—'}</td>
                                    <td className="r money">{w.productsKM > 0 ? fmt(w.productsKM) : <span className="muted">—</span>}</td>
                                    <td className="r money">{w.razniKM > 0 ? fmt(w.razniKM) : <span className="muted">—</span>}</td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr>
                                <td>Ukupno ({rows.length})</td>
                                <td className="r money">{t.present} d</td>
                                <td className="r money">{(Math.round(t.booked * 100) / 100).toLocaleString('hr-HR')} d</td>
                                <td className="r money">{t.unbooked > 0 ? `${t.unbooked} d` : '—'}</td>
                                <td className="r money profit-col">{fmt(t.earnings)}</td>
                                <td className="r money">{t.booked > 0 ? fmt(t.earnings / t.booked) : '—'}</td>
                                <td className="r money">{fmt(t.products)}</td>
                                <td className="r money">{fmt(t.razni)}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            )}
        </div>
    );
}

// ── Plan vs stvarno ──────────────────────────────────────────────────────────
function PvACell({ m }: { m: PvAMetric }) {
    if (m.planned <= 0) return <span className="muted">bez plana{m.unplannedActual > 0 ? ` · stvarno ${fmt(m.unplannedActual)}` : ''}</span>;
    const delta = Math.round((m.actual - m.planned) * 100) / 100;
    return (
        <span className="ana-pa">
            <span>{num(m.planned)} → {fmt(m.actual)}</span>
            <span className={`ana-pa-plan ${delta > 0.5 ? 'red' : 'green'}`}>{delta > 0.5 ? `+${num(delta)} preko plana` : delta < -0.5 ? `${num(Math.abs(delta))} ispod plana` : 'tačno po planu'}</span>
        </span>
    );
}

function PvASummary({ label, m, note }: { label: string; m: PvAMetric; note: string }) {
    const delta = Math.round((m.actual - m.planned) * 100) / 100;
    const over = delta > 0.5;
    return (
        <div className="ana-card">
            <div className="ana-card-title">{label}</div>
            {m.planned <= 0 ? (
                <div className="ana-empty">Nema završenih proizvoda s planom u ponudi.</div>
            ) : (
                <>
                    <div className="ana-pva-big">
                        <div className="ana-pva-cell"><span className="ana-pva-k">Plan (ponuda)</span><b>{fmt(m.planned)}</b></div>
                        <span className="ana-pva-arrow">→</span>
                        <div className="ana-pva-cell"><span className="ana-pva-k">Stvarno</span><b className={over ? 'red' : 'green'}>{fmt(m.actual)}</b></div>
                    </div>
                    <div className="ana-pva-foot">
                        <span className={over ? 'red' : 'green'}>{over ? 'Prekoračenje ' : 'Ušteda '}{fmt(Math.abs(delta))} ({pct(Math.abs(m.variancePct))})</span>
                        <span className="ana-pva-acc-big">pogođeno <b>{pct(m.accuracyPct)}</b></span>
                    </div>
                </>
            )}
            {m.unplannedActual > 0 && <div className="ana-pva-unplanned">+ {fmt(m.unplannedActual)} na proizvodima bez plana u ponudi (nije u poređenju)</div>}
            <p className="ana-st-note">{note}</p>
        </div>
    );
}

function PlanVsActualTab({ data }: { data: AnalyticsData }) {
    const { total, byProject, inProgressLabor } = data.pva;
    const ipPct = inProgressLabor.planned > 0 ? (inProgressLabor.actual / inProgressLabor.planned) * 100 : 0;
    return (
        <div className="ana-section">
            <p className="ana-hint">Poređenje ponude i stvarnosti za {total.count} završenih proizvoda{data.range.from ? ' u periodu' : ''}. Plan materijala = materijal iz ponude + dodaci; stvarno = sastavnica danas + dodaci.</p>
            <div className="ana-grid2">
                <PvASummary label="Materijal" m={total.material} note="Razlika nastaje kad se sastavnica promijeni nakon ponude (dodan materijal, nova cijena)." />
                <PvASummary label="Rad" m={total.labor} note="Plan rada = radnici × dani × dnevnica iz ponude; stvarno = proknjižene dnevnice." />
            </div>
            {inProgressLabor.planned > 0 && (
                <div className="ana-card">
                    <div className="ana-card-title">U izradi — potrošnja planiranog rada</div>
                    <div className="ana-snap-bar"><div className="ana-snap-fill" style={{ width: `${Math.min(100, ipPct)}%`, background: ipPct > 100 ? '#ef4444' : '#3b82f6' }} /></div>
                    <div className="ana-snap-sub">Do sada {fmt(inProgressLabor.actual)} od planiranih {fmt(inProgressLabor.planned)} ({pct(ipPct)}) za proizvode koji još nisu gotovi.</div>
                </div>
            )}
            <div className="ana-table-wrap">
                <table className="ana-table">
                    <thead><tr><th>Projekat</th><th className="r">Proizvoda</th><th className="r">Materijal: plan → stvarno</th><th className="r">Rad: plan → stvarno</th></tr></thead>
                    <tbody>
                        {byProject.length === 0 && <tr><td colSpan={4} className="ana-empty">Nema završenih proizvoda u periodu.</td></tr>}
                        {byProject.map(r => (
                            <tr key={r.projectId}>
                                <td><span className="ana-cell-title" title={r.projectName}>{r.projectName}</span></td>
                                <td className="r money">{r.count}</td>
                                <td className="r money"><PvACell m={r.material} /></td>
                                <td className="r money"><PvACell m={r.labor} /></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// ── Kalendar rada po projektu (mjesečna mreža: avatari radnika + detalj dana) ──
const PWC_MONTHS = ['Januar', 'Februar', 'Mart', 'April', 'Maj', 'Juni', 'Juli', 'August', 'Septembar', 'Oktobar', 'Novembar', 'Decembar'];
const PWC_DOW = ['Pon', 'Uto', 'Sri', 'Čet', 'Pet', 'Sub', 'Ned'];
const PWC_COLORS = ['#3b82f6', '#7c3aed', '#db2777', '#d97706', '#059669', '#0891b2', '#dc2626', '#4f46e5'];

function pwcInitials(name: string): string {
    const parts = (name || '').trim().split(/\s+/).filter(Boolean);
    return ((parts[0]?.[0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
}
function pwcColor(name: string): string {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return PWC_COLORS[h % PWC_COLORS.length];
}

function buildMonthDays(year: number, month: number): { iso: string; day: number; inMonth: boolean; weekend: boolean }[] {
    const first = new Date(year, month, 1);
    const startDow = (first.getDay() + 6) % 7;                  // ponedjeljak = 0
    const last = new Date(year, month + 1, 0);
    const endPad = 6 - ((last.getDay() + 6) % 7);
    const cur = new Date(year, month, 1 - startDow);
    const end = new Date(year, month, last.getDate() + endPad);
    const out: { iso: string; day: number; inMonth: boolean; weekend: boolean }[] = [];
    while (cur <= end) {
        const dow = cur.getDay();
        out.push({ iso: toISO(cur), day: cur.getDate(), inMonth: cur.getMonth() === month, weekend: dow === 0 || dow === 6 });
        cur.setDate(cur.getDate() + 1);
    }
    return out;
}

interface PwcEntry { worker: string; product: string; productId: string; woNumber: string; rate: number; fraction: number }

function ProjectWorkCalendar({ raw, projectId, projectName, onClose }: { raw: AnalyticsRaw; projectId: string; projectName: string; onClose: () => void }) {
    const idx = useMemo(() => {
        const byItem = new Map<string, { product: string; productId: string; woId: string }>();
        for (const it of raw.items) {
            if (it.Project_ID !== projectId) continue;
            byItem.set(it.ID, { product: it.Product_Name || 'Proizvod', productId: it.Product_ID || '', woId: it.Work_Order_ID || '' });
        }
        const woNum = new Map(raw.workOrders.map(w => [w.Work_Order_ID, w.Work_Order_Number]));
        return { byItem, woNum };
    }, [raw, projectId]);

    // Datum → zapisi rada — STROGO po stavkama ovog projekta (po Work_Order_Item_ID), bez nuliranih.
    const byDate = useMemo(() => {
        const m = new Map<string, PwcEntry[]>();
        for (const l of liveLogs(raw.logs)) {
            const hit = l.Work_Order_Item_ID ? idx.byItem.get(l.Work_Order_Item_ID) : undefined;
            if (!hit) continue;
            const date = (l.Date || '').split('T')[0];
            if (!date) continue;
            const arr = m.get(date) || [];
            arr.push({ worker: l.Worker_Name || 'Radnik', product: hit.product, productId: hit.productId, woNumber: hit.woId ? (idx.woNum.get(hit.woId) || '') : '', rate: l.Daily_Rate || 0, fraction: l.Day_Fraction ?? 1 });
            m.set(date, arr);
        }
        return m;
    }, [raw, idx]);

    const allDates = useMemo(() => Array.from(byDate.keys()).sort(), [byDate]);
    const latest = allDates[allDates.length - 1];
    const initD = latest ? new Date(latest + 'T12:00:00') : new Date();
    const [ym, setYm] = useState<{ y: number; m: number }>({ y: initD.getFullYear(), m: initD.getMonth() });
    const [selDay, setSelDay] = useState<string | null>(latest || null);
    const [selWorker, setSelWorker] = useState<string | null>(null);
    const todayIso = toISO(new Date());

    const workerList = useMemo(() => {
        const m = new Map<string, { dates: Set<string>; workerDays: number; km: number }>();
        byDate.forEach((arr, date) => arr.forEach(e => {
            const w = m.get(e.worker) || { dates: new Set<string>(), workerDays: 0, km: 0 };
            w.dates.add(date); w.workerDays += e.fraction; w.km += e.rate;
            m.set(e.worker, w);
        }));
        return Array.from(m.entries())
            .map(([worker, w]) => ({ worker, days: w.dates.size, workerDays: Math.round(w.workerDays * 100) / 100, km: w.km }))
            .sort((a, b) => b.days - a.days || a.worker.localeCompare(b.worker));
    }, [byDate]);

    const dayEntries = useCallback((iso: string) => {
        const all = byDate.get(iso) || [];
        return selWorker ? all.filter(e => e.worker === selWorker) : all;
    }, [byDate, selWorker]);

    const days = useMemo(() => buildMonthDays(ym.y, ym.m), [ym]);
    const monthStats = useMemo(() => {
        let dws = 0; const w = new Set<string>();
        days.forEach(d => {
            if (!d.inMonth) return;
            const es = (byDate.get(d.iso) || []).filter(e => !selWorker || e.worker === selWorker);
            if (es.length) { dws++; es.forEach(e => w.add(e.worker)); }
        });
        return { daysWorked: dws, workers: w.size };
    }, [days, byDate, selWorker]);

    // „Dana s radom" = različiti datumi na kojima je IKO radio na projektu; radnik-dani =
    // Σ udjela dana svih radnika (dnevnica se dijeli na proizvode/naloge tog dana); KM = Σ dnevnica.
    const totals = useMemo(() => {
        const w = new Set<string>();
        let workerDays = 0, km = 0;
        byDate.forEach(arr => arr.forEach(e => { w.add(e.worker); workerDays += e.fraction; km += e.rate; }));
        return { days: byDate.size, workers: w.size, workerDays: Math.round(workerDays * 100) / 100, km };
    }, [byDate]);

    const shiftMonth = (delta: number) => setYm(prev => { const d = new Date(prev.y, prev.m + delta, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
    const goToday = () => { const d = new Date(); setYm({ y: d.getFullYear(), m: d.getMonth() }); };

    const selByWorker = useMemo(() => {
        const entries = selDay ? (byDate.get(selDay) || []).filter(e => !selWorker || e.worker === selWorker) : [];
        const m = new Map<string, Map<string, string>>();
        for (const e of entries) {
            const wm = m.get(e.worker) || new Map<string, string>();
            wm.set(e.productId || e.product, e.woNumber ? `${e.product} · #${e.woNumber}` : e.product);
            m.set(e.worker, wm);
        }
        return Array.from(m.entries()).map(([worker, prods]) => ({ worker, products: Array.from(prods.values()) }));
    }, [selDay, byDate, selWorker]);
    const selProducts = useMemo(() => { const s = new Set<string>(); selByWorker.forEach(w => w.products.forEach(p => s.add(p))); return s.size; }, [selByWorker]);

    return (
        <>
            <div className="ana-overlay pwc-overlay" onClick={onClose} />
            <div className="pwc-modal">
                <div className="pwc-head">
                    <div className="pwc-title">
                        <span className="pwc-title-main">{projectName || '—'}</span>
                        <span className="pwc-title-sub">
                            {totals.days > 0 ? `${totals.days} ${pl(totals.days, 'dan', 'dana', 'dana')} s radom · ${totals.workerDays.toLocaleString('hr-HR')} radnik-dana · ${fmt(totals.km)} rada · ${totals.workers} ${pl(totals.workers, 'radnik', 'radnika', 'radnika')}` : 'Nema evidentiranog rada'}
                        </span>
                    </div>
                    <div className="pwc-nav">
                        <button className="ana-icon-btn" onClick={() => shiftMonth(-1)} aria-label="Prethodni mjesec">‹</button>
                        <span className="pwc-monthlabel">{PWC_MONTHS[ym.m]} {ym.y}{monthStats.daysWorked > 0 ? ` · ${monthStats.daysWorked} dana` : ''}</span>
                        <button className="ana-icon-btn" onClick={() => shiftMonth(1)} aria-label="Sljedeći mjesec">›</button>
                        <button className="pwc-today-btn" onClick={goToday}>Danas</button>
                        <button className="ana-icon-btn" onClick={onClose} aria-label="Zatvori"><X size={18} /></button>
                    </div>
                </div>

                <div className="pwc-body">
                    {totals.days === 0 ? (
                        <div className="pwc-empty">Na ovom projektu još nema evidentiranog rada (dnevnica).</div>
                    ) : (
                        <>
                            <div className="pwc-filters">
                                <button className={`pwc-fchip${!selWorker ? ' on' : ''}`} onClick={() => setSelWorker(null)}>Svi radnici</button>
                                {workerList.map(({ worker, days: wd }) => (
                                    <button key={worker} className={`pwc-fchip${selWorker === worker ? ' on' : ''}`}
                                        onClick={() => setSelWorker(s => s === worker ? null : worker)} title={`${worker}: radio ${wd} ${pl(wd, 'dan', 'dana', 'dana')} na projektu · ${workerList.find(x => x.worker === worker)?.workerDays.toLocaleString('hr-HR')} radnik-dana · ${fmt(workerList.find(x => x.worker === worker)?.km || 0)}`}>
                                        <span className="pwc-fdot" style={{ background: pwcColor(worker) }} />
                                        <span className="pwc-fname">{worker}</span>
                                        <span className="pwc-fdays">{wd}</span>
                                    </button>
                                ))}
                            </div>

                            <div className="pwc-dowrow">
                                {PWC_DOW.map(d => <div key={d} className="pwc-dowcell">{d}</div>)}
                            </div>
                            <div className="pwc-grid">
                                {days.map(d => {
                                    const entries = dayEntries(d.iso);
                                    const workers = Array.from(new Set(entries.map(e => e.worker)));
                                    const productCount = new Set(entries.map(e => e.productId || e.product)).size;
                                    const cls = ['pwc-cell'];
                                    if (!d.inMonth) cls.push('out');
                                    if (d.weekend) cls.push('wknd');
                                    if (workers.length) cls.push('has');
                                    if (d.iso === todayIso) cls.push('today');
                                    if (selDay === d.iso) cls.push('sel');
                                    const prods = selWorker ? Array.from(new Set(entries.map(e => e.product))) : [];
                                    return (
                                        <button key={d.iso} className={cls.join(' ')}
                                            onClick={() => workers.length && setSelDay(d.iso)}
                                            disabled={!workers.length}
                                            title={workers.length ? `${workers.length} radnika · ${productCount} proizvoda` : ''}>
                                            <span className="pwc-cnum">{d.day}</span>
                                            {workers.length > 0 && (selWorker ? (
                                                <div className="pwc-cone">
                                                    <span className="pwc-av" style={{ background: pwcColor(selWorker) }}>{pwcInitials(selWorker)}</span>
                                                    <span className="pwc-cprods" title={prods.join(', ')}>{prods.slice(0, 2).join(', ')}{prods.length > 2 ? ` +${prods.length - 2}` : ''}</span>
                                                </div>
                                            ) : (
                                                <>
                                                    <div className="pwc-stack">
                                                        {workers.slice(0, 4).map(w => <span key={w} className="pwc-av" style={{ background: pwcColor(w) }} title={w}>{pwcInitials(w)}</span>)}
                                                        {workers.length > 4 && <span className="pwc-av pwc-more">+{workers.length - 4}</span>}
                                                    </div>
                                                    <span className="pwc-cprod">{productCount} {productCount === 1 ? 'proizvod' : 'proizvoda'}</span>
                                                </>
                                            ))}
                                        </button>
                                    );
                                })}
                            </div>

                            <div className="pwc-detail">
                                {selDay && selByWorker.length > 0 ? (
                                    <>
                                        <div className="pwc-dhead">
                                            <span className="pwc-dtitle">{new Date(selDay + 'T12:00:00').toLocaleDateString('hr-HR', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
                                            <span className="pwc-dmeta">{selByWorker.length} {selByWorker.length === 1 ? 'radnik' : 'radnika'} · {selProducts} {selProducts === 1 ? 'proizvod' : 'proizvoda'}</span>
                                        </div>
                                        <div className="pwc-dgrid">
                                            {selByWorker.map(({ worker, products }) => (
                                                <div key={worker} className="pwc-wcard">
                                                    <span className="pwc-wav" style={{ background: pwcColor(worker) }}>{pwcInitials(worker)}</span>
                                                    <div className="pwc-wbody">
                                                        <div className="pwc-wname">{worker}</div>
                                                        <div className="pwc-wchips">
                                                            {products.map((p, i) => <span key={i} className="pwc-pchip">{p}</span>)}
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </>
                                ) : (
                                    <div className="pwc-dempty">{selWorker ? `Nema dana za ${selWorker} u ovom mjesecu — probaj drugi.` : 'Klikni dan označen avatarima da vidiš ko je i na čemu radio.'}</div>
                                )}
                            </div>
                        </>
                    )}
                </div>
            </div>
        </>
    );
}

// ── Kalendar rada po RADNIKU (mjesečna mreža: nalozi po danima + detalj dana) ──
interface WwcEntry { orderKey: string; orderLabel: string; product: string; rate: number; fraction: number }

function WorkerWorkCalendar({ raw, workerId, workerName, onClose }: { raw: AnalyticsRaw; workerId: string; workerName: string; onClose: () => void }) {
    const idx = useMemo(() => {
        const productByItem = new Map<string, string>();
        for (const it of raw.items) productByItem.set(it.ID, it.Product_Name || 'Proizvod');
        const woById = new Map(raw.workOrders.map(w => [w.Work_Order_ID, w]));
        return { productByItem, woById };
    }, [raw]);

    // Datum → zapisi rada OVOG radnika (svi nalozi, kompletna istorija; bez nuliranih).
    const byDate = useMemo(() => {
        const m = new Map<string, WwcEntry[]>();
        for (const l of liveLogs(raw.logs)) {
            if (l.Worker_ID !== workerId) continue;
            const date = (l.Date || '').split('T')[0];
            if (!date) continue;
            const wo = l.Work_Order_ID ? idx.woById.get(l.Work_Order_ID) : undefined;
            const orderLabel = wo ? workOrderDisplayName(wo) : 'Nalog';
            const arr = m.get(date) || [];
            arr.push({
                orderKey: l.Work_Order_ID || orderLabel,
                orderLabel,
                product: (l.Work_Order_Item_ID && idx.productByItem.get(l.Work_Order_Item_ID)) || 'Proizvod',
                rate: l.Daily_Rate || 0,
                fraction: l.Day_Fraction ?? 1,
            });
            m.set(date, arr);
        }
        return m;
    }, [raw, idx, workerId]);

    const allDates = useMemo(() => Array.from(byDate.keys()).sort(), [byDate]);
    const latest = allDates[allDates.length - 1];
    const initD = latest ? new Date(latest + 'T12:00:00') : new Date();
    const [ym, setYm] = useState<{ y: number; m: number }>({ y: initD.getFullYear(), m: initD.getMonth() });
    const [selDay, setSelDay] = useState<string | null>(latest || null);
    const [selOrder, setSelOrder] = useState<string | null>(null);
    const todayIso = toISO(new Date());

    const orderList = useMemo(() => {
        const m = new Map<string, { label: string; dates: Set<string>; earned: number }>();
        byDate.forEach((arr, date) => arr.forEach(e => {
            const o = m.get(e.orderKey) || { label: e.orderLabel, dates: new Set<string>(), earned: 0 };
            o.dates.add(date);
            o.earned += e.rate;
            m.set(e.orderKey, o);
        }));
        return Array.from(m.entries())
            .map(([key, o]) => ({ key, label: o.label, days: o.dates.size, earned: o.earned }))
            .sort((a, b) => b.days - a.days || a.label.localeCompare(b.label));
    }, [byDate]);

    const dayEntries = useCallback((iso: string) => {
        const all = byDate.get(iso) || [];
        return selOrder ? all.filter(e => e.orderKey === selOrder) : all;
    }, [byDate, selOrder]);

    const days = useMemo(() => buildMonthDays(ym.y, ym.m), [ym]);

    const monthStats = useMemo(() => {
        let daysWorked = 0, earned = 0, fraction = 0;
        days.forEach(d => {
            if (!d.inMonth) return;
            const es = dayEntries(d.iso);
            if (!es.length) return;
            daysWorked++;
            es.forEach(e => { earned += e.rate; fraction += e.fraction; });
        });
        return { daysWorked, earned, fraction: Math.round(fraction * 100) / 100 };
    }, [days, dayEntries]);

    const totals = useMemo(() => {
        let earned = 0;
        byDate.forEach(arr => arr.forEach(e => { earned += e.rate; }));
        return { days: byDate.size, earned, orders: orderList.length };
    }, [byDate, orderList]);

    const shiftMonth = (delta: number) => setYm(prev => { const d = new Date(prev.y, prev.m + delta, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
    const goToday = () => { const d = new Date(); setYm({ y: d.getFullYear(), m: d.getMonth() }); };

    const selDetail = useMemo(() => {
        const entries = selDay ? dayEntries(selDay) : [];
        const m = new Map<string, { label: string; products: Map<string, number>; earned: number }>();
        let dayTotal = 0, dayFraction = 0;
        for (const e of entries) {
            const o = m.get(e.orderKey) || { label: e.orderLabel, products: new Map<string, number>(), earned: 0 };
            o.products.set(e.product, (o.products.get(e.product) || 0) + e.rate);
            o.earned += e.rate;
            m.set(e.orderKey, o);
            dayTotal += e.rate;
            dayFraction += e.fraction;
        }
        const orders = Array.from(m.values()).map(o => ({
            label: o.label, earned: o.earned,
            products: Array.from(o.products.entries()).map(([name, rate]) => ({ name, rate })),
        }));
        return { orders, dayTotal, dayFraction: Math.round(dayFraction * 100) / 100 };
    }, [selDay, dayEntries]);

    return (
        <>
            <div className="ana-overlay pwc-overlay" onClick={onClose} />
            <div className="pwc-modal">
                <div className="pwc-head">
                    <div className="pwc-title">
                        <span className="pwc-title-main">
                            <span className="pwc-av" style={{ background: pwcColor(workerName), marginRight: 8 }}>{pwcInitials(workerName)}</span>
                            {workerName}
                        </span>
                        <span className="pwc-title-sub">
                            {totals.days > 0
                                ? `${totals.days} radnih dana · ${totals.orders} naloga · ${fmt(totals.earned)} ukupno`
                                : 'Nema evidentiranog rada'}
                        </span>
                    </div>
                    <div className="pwc-nav">
                        <button className="ana-icon-btn" onClick={() => shiftMonth(-1)} aria-label="Prethodni mjesec">‹</button>
                        <span className="pwc-monthlabel">
                            {PWC_MONTHS[ym.m]} {ym.y}
                            {monthStats.daysWorked > 0 ? ` · ${monthStats.daysWorked} dana · ${fmt(monthStats.earned)}` : ''}
                        </span>
                        <button className="ana-icon-btn" onClick={() => shiftMonth(1)} aria-label="Sljedeći mjesec">›</button>
                        <button className="pwc-today-btn" onClick={goToday}>Danas</button>
                        <button className="ana-icon-btn" onClick={onClose} aria-label="Zatvori"><X size={18} /></button>
                    </div>
                </div>

                <div className="pwc-body">
                    {totals.days === 0 ? (
                        <div className="pwc-empty">Za ovog radnika još nema evidentiranog rada (dnevnica).</div>
                    ) : (
                        <>
                            <div className="pwc-filters">
                                <button className={`pwc-fchip${!selOrder ? ' on' : ''}`} onClick={() => setSelOrder(null)}>Svi nalozi</button>
                                {orderList.map(o => (
                                    <button key={o.key} className={`pwc-fchip${selOrder === o.key ? ' on' : ''}`}
                                        onClick={() => setSelOrder(s => s === o.key ? null : o.key)}
                                        title={`${o.label} · ${o.days} radnih dana · ${fmt(o.earned)}`}>
                                        <span className="pwc-fdot" style={{ background: pwcColor(o.label) }} />
                                        <span className="pwc-fname">{o.label}</span>
                                        <span className="pwc-fdays">{o.days}</span>
                                    </button>
                                ))}
                            </div>

                            <div className="pwc-dowrow">
                                {PWC_DOW.map(d => <div key={d} className="pwc-dowcell">{d}</div>)}
                            </div>
                            <div className="pwc-grid">
                                {days.map(d => {
                                    const entries = dayEntries(d.iso);
                                    const orders = Array.from(new Map(entries.map(e => [e.orderKey, e.orderLabel])).values());
                                    const dayKm = entries.reduce((s, e) => s + e.rate, 0);
                                    const cls = ['pwc-cell'];
                                    if (!d.inMonth) cls.push('out');
                                    if (d.weekend) cls.push('wknd');
                                    if (entries.length) cls.push('has');
                                    if (d.iso === todayIso) cls.push('today');
                                    if (selDay === d.iso) cls.push('sel');
                                    return (
                                        <button key={d.iso} className={cls.join(' ')}
                                            onClick={() => entries.length && setSelDay(d.iso)}
                                            disabled={!entries.length}
                                            title={entries.length ? `${orders.join(', ')} · ${fmt(dayKm)}` : ''}>
                                            <span className="pwc-cnum">{d.day}</span>
                                            {entries.length > 0 && (
                                                <>
                                                    <div className="pwc-stack">
                                                        {orders.slice(0, 3).map(o => (
                                                            <span key={o} className="pwc-av" style={{ background: pwcColor(o) }} title={o}>{pwcInitials(o)}</span>
                                                        ))}
                                                        {orders.length > 3 && <span className="pwc-av pwc-more">+{orders.length - 3}</span>}
                                                    </div>
                                                    <span className="pwc-cprod">{fmt(dayKm)}</span>
                                                </>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>

                            <div className="pwc-detail">
                                {selDay && selDetail.orders.length > 0 ? (
                                    <>
                                        <div className="pwc-dhead">
                                            <span className="pwc-dtitle">{new Date(selDay + 'T12:00:00').toLocaleDateString('hr-HR', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
                                            <span className="pwc-dmeta">
                                                {selDetail.orders.length} {selDetail.orders.length === 1 ? 'nalog' : 'naloga'} · {selDetail.dayFraction} radnik-dana · <b>{fmt(selDetail.dayTotal)}</b>
                                            </span>
                                        </div>
                                        <div className="pwc-dgrid">
                                            {selDetail.orders.map(o => (
                                                <div key={o.label} className="pwc-wcard">
                                                    <span className="pwc-wav" style={{ background: pwcColor(o.label) }}>{pwcInitials(o.label)}</span>
                                                    <div className="pwc-wbody">
                                                        <div className="pwc-wname">{o.label} <span className="muted">· {fmt(o.earned)}</span></div>
                                                        <div className="pwc-wchips">
                                                            {o.products.map((p, i) => (
                                                                <span key={i} className="pwc-pchip">{p.name} · {fmt(p.rate)}</span>
                                                            ))}
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </>
                                ) : (
                                    <div className="pwc-dempty">{selOrder ? 'Nema dana za ovaj nalog u prikazanom mjesecu — probaj drugi mjesec.' : 'Klikni dan s oznakama da vidiš na kojim nalozima i proizvodima je radio.'}</div>
                                )}
                            </div>
                        </>
                    )}
                </div>
            </div>
        </>
    );
}
