'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useData } from '@/context/DataContext';
import {
    X, BarChart3, FolderKanban, Package, GitCompareArrows, RefreshCw, Search, Loader2, Users,
} from 'lucide-react';
import { workOrderDisplayName } from '@/lib/utils';
import { getAnalyticsRaw, computeAnalytics } from '@/lib/services/profit/analyticsService';
import type { AnalyticsData, AnalyticsScope, AnalyticsRaw } from '@/lib/services/profit/analyticsService';
import type { PvAMetric } from '@/lib/analytics';
import type { WorkLog } from '@/lib/types';
import ProductTimelineModal from './ProductTimelineModal';
import './AnalyticsDashboard.css';

interface AnalyticsDashboardProps {
    onClose: () => void;
    showToast?: (message: string, type: 'success' | 'error' | 'info') => void;
    onRefresh?: (...collections: string[]) => void;
}

type Tab = 'overview' | 'workers' | 'projects' | 'products' | 'planvsactual';
type Period = 'all' | 'month' | '30d';

const fmt = (n: number) => `${Math.round(n).toLocaleString('hr-HR')} KM`;
const pct = (n: number) => `${n.toFixed(0)}%`;
const toISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const human = (iso: string) => { const d = new Date(iso + 'T12:00:00'); return `${d.getDate()}.${d.getMonth() + 1}.`; };

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

/** Jednostavna horizontalna traka (width ∝ value/max). */
function HBar({ value, max, color }: { value: number; max: number; color: string }) {
    const w = max > 0 ? Math.max(2, (Math.abs(value) / max) * 100) : 0;
    return <div className="ana-bar-track"><div className="ana-bar-fill" style={{ width: `${w}%`, background: color }} /></div>;
}

export default function AnalyticsDashboard({ onClose, showToast, onRefresh }: AnalyticsDashboardProps) {
    const { organizationId, appState } = useData();
    const allWorkers = appState.workers || [];

    const [tab, setTab] = useState<Tab>('overview');
    const [period, setPeriod] = useState<Period>('all');
    const [scope, setScope] = useState<AnalyticsScope>('active');
    const [raw, setRaw] = useState<AnalyticsRaw | null>(null);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');

    // Drill u timeline proizvoda
    const [timeline, setTimeline] = useState<{ itemId: string; productId: string; productName: string; woId: string; status: string; selling: number; material: number; labor: number } | null>(null);
    const [timelineLogs, setTimelineLogs] = useState<WorkLog[]>([]);

    // Drill u kalendar rada po projektu (dan-po-dan)
    const [projectCal, setProjectCal] = useState<{ projectId: string; projectName: string } | null>(null);
    // Drill u kalendar rada po RADNIKU (šta je i na kojim nalozima radio, dan-po-dan)
    const [workerCal, setWorkerCal] = useState<{ workerId: string; workerName: string } | null>(null);
    const [loadingTimeline, setLoadingTimeline] = useState(false);

    // Dohvat JEDNOM (otvaranje / Osvježi). Promjena perioda/opsega = in-memory (bez novog upita).
    const loadRaw = useCallback(async () => {
        if (!organizationId) return;
        setLoading(true);
        try {
            setRaw(await getAnalyticsRaw(organizationId));
        } catch (e) {
            console.error('analytics load failed', e);
            showToast?.('Greška pri učitavanju analitike', 'error');
        } finally {
            setLoading(false);
        }
    }, [organizationId, showToast]);

    useEffect(() => { loadRaw(); }, [loadRaw]);

    const data = useMemo<AnalyticsData | null>(
        () => (raw ? computeAnalytics(raw, { ...periodRange(period), scope }) : null),
        [raw, period, scope]
    );

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !timeline) onClose(); };
        window.addEventListener('keydown', onKey);
        document.body.style.overflow = 'hidden';
        return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
    }, [onClose, timeline]);

    const openTimeline = async (p: { itemId: string; productId: string; productName: string; woId: string; status: string; selling: number; material: number; labor: number }) => {
        if (!organizationId) return;
        setLoadingTimeline(true);
        try {
            const { getWorkLogsForWorkOrder } = await import('@/lib/services');
            setTimelineLogs(await getWorkLogsForWorkOrder(p.woId, organizationId));
            setTimeline(p);
        } catch (e) { console.error(e); showToast?.('Greška pri učitavanju timeline-a', 'error'); }
        finally { setLoadingTimeline(false); }
    };

    const filteredProducts = useMemo(() => {
        if (!data) return [];
        const s = search.trim().toLowerCase();
        const list = s ? data.products.filter(p => `${p.productName} ${p.projectName} ${p.woNumber}`.toLowerCase().includes(s)) : data.products;
        return [...list].sort((a, b) => b.profit - a.profit);
    }, [data, search]);

    const TABS: { id: Tab; label: string; Icon: typeof BarChart3 }[] = [
        { id: 'overview', label: 'Pregled', Icon: BarChart3 },
        { id: 'projects', label: 'Projekti', Icon: FolderKanban },
        { id: 'products', label: 'Proizvodi', Icon: Package },
        { id: 'workers', label: 'Radnici', Icon: Users },
        { id: 'planvsactual', label: 'Plan vs Stvarno', Icon: GitCompareArrows },
    ];

    return (
        <>
            <div className="ana-overlay" onClick={onClose} />
            <div className="ana-modal">
                {/* Header */}
                <div className="ana-header">
                    <div className="ana-title"><BarChart3 size={20} /> <span>Analitika</span></div>
                    <div className="ana-header-controls">
                        <div className="ana-seg">
                            {(['all', 'month', '30d'] as Period[]).map(p => (
                                <button key={p} className={period === p ? 'on' : ''} onClick={() => setPeriod(p)}>
                                    {p === 'all' ? 'Sve' : p === 'month' ? 'Ovaj mjesec' : 'Zadnjih 30d'}
                                </button>
                            ))}
                        </div>
                        <div className="ana-seg">
                            {(['active', 'all'] as AnalyticsScope[]).map(s => (
                                <button key={s} className={scope === s ? 'on' : ''} onClick={() => setScope(s)}>
                                    {s === 'active' ? 'Aktivni' : 'Svi'}
                                </button>
                            ))}
                        </div>
                        <button className="ana-icon-btn" onClick={loadRaw} title="Osvježi"><RefreshCw size={16} /></button>
                        <button className="ana-icon-btn" onClick={onClose} title="Zatvori"><X size={18} /></button>
                    </div>
                </div>

                {/* Tabs */}
                <div className="ana-tabs">
                    {TABS.map(t => (
                        <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
                            <t.Icon size={15} /> {t.label}
                        </button>
                    ))}
                </div>

                {/* Body */}
                <div className="ana-body">
                    {loading ? (
                        <div className="ana-center"><Loader2 size={20} className="ana-spin" /> Učitavanje…</div>
                    ) : !data || data.kpis.productCount === 0 ? (
                        <div className="ana-center">Nema podataka za odabrani period/opseg.</div>
                    ) : tab === 'overview' ? (
                        <Overview data={data} onGoTo={setTab} />
                    ) : tab === 'projects' ? (
                        <ProjectsTab data={data} onPick={(projectId, projectName) => setProjectCal({ projectId, projectName })} />
                    ) : tab === 'workers' ? (
                        <WorkersTab data={data} onPick={(workerId, workerName) => setWorkerCal({ workerId, workerName })} />
                    ) : tab === 'products' ? (
                        <div className="ana-section">
                            <div className="ana-search"><Search size={16} /><input placeholder="Pretraži proizvode/projekte…" value={search} onChange={e => setSearch(e.target.value)} /></div>
                            <table className="ana-table ana-table-fixed">
                                <colgroup>
                                    <col style={{ width: '28%' }} />
                                    <col style={{ width: '11%' }} />
                                    <col style={{ width: '13%' }} />
                                    <col style={{ width: '11%' }} />
                                    <col style={{ width: '9%' }} />
                                    <col style={{ width: '19%' }} />
                                    <col style={{ width: '9%' }} />
                                </colgroup>
                                <thead><tr><th>Proizvod</th><th className="r">Cijena</th><th className="r">Materijal</th><th className="r">Rad</th><th className="r">Usluge</th><th className="r">Profit</th><th></th></tr></thead>
                                <tbody>
                                    {filteredProducts.map(p => {
                                        // Maskiraj kolone SAMO za stvarno ne-prihodovne redove (čista montaža/teren
                                        // bez proizvodnog naloga) — ne po tipu naloga reprezentativne stavke.
                                        const nonRev = p.nonRevenue;
                                        return (
                                            <tr key={p.itemId}>
                                                <td>
                                                    <span className="ana-cell-title" title={p.productName}>{p.productName}</span>
                                                    <span className="ana-cell-meta" title={`${p.projectName} #${p.woNumber}`}>{p.projectName} <span className="ana-wo">#{p.woNumber}</span></span>
                                                </td>
                                                <td className="r money">{nonRev ? '—' : fmt(p.selling)}</td>
                                                <td className="r money">{nonRev ? '—' : (
                                                    <span className="ana-pa">
                                                        <span>{fmt(p.material)}</span>
                                                        {p.plannedMaterial > 0 && <span className={`ana-pa-plan ${p.material > p.plannedMaterial ? 'red' : 'green'}`}>plan {fmt(p.plannedMaterial)}</span>}
                                                    </span>
                                                )}</td>
                                                <td className="r amber money">
                                                    <span className="ana-pa">
                                                        <span>{fmt(p.labor)}</span>
                                                        {!nonRev && p.plannedLabor > 0 && <span className={`ana-pa-plan ${p.labor > p.plannedLabor ? 'red' : 'green'}`}>plan {fmt(p.plannedLabor)}</span>}
                                                    </span>
                                                </td>
                                                <td className="r money">{nonRev ? '—' : fmt(p.services)}</td>
                                                <td className={`r b money profit-col ${nonRev ? 'amber' : p.profit >= 0 ? 'green' : 'red'}`}>
                                                    {nonRev ? `−${fmt(p.labor)}` : (
                                                        <span className="ana-pa">
                                                            <span>{fmt(p.profit)} · {pct(p.margin)}</span>
                                                            {(p.plannedMaterial > 0 || p.plannedLabor > 0) && <span className="ana-pa-plan muted">plan {fmt(p.plannedProfit)}</span>}
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="r">
                                                    <button className="ana-link" disabled={loadingTimeline} onClick={() => openTimeline({ itemId: p.itemId, productId: p.productId, productName: p.productName, woId: p.woId, status: p.status, selling: p.selling, material: p.material, labor: p.labor })}>Detalji →</button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
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
                    productName={timeline.productName}
                    workOrderItem={{ ID: timeline.itemId, Product_ID: timeline.productId, Product_Name: timeline.productName, Work_Order_ID: timeline.woId, Status: timeline.status, Product_Value: timeline.selling, Material_Cost: timeline.material, Actual_Labor_Cost: timeline.labor } as unknown as Parameters<typeof ProductTimelineModal>[0]['workOrderItem']}
                    workLogs={timelineLogs.filter(wl => wl.Product_ID === timeline.productId)}
                    sellingPrice={timeline.selling}
                    materialCost={timeline.material}
                    laborCost={timeline.labor}
                    workers={allWorkers}
                    onOverrideWorkLogs={async (entries) => {
                        if (!organizationId) return { success: false, message: 'Nedostaju podaci' };
                        const { overrideWorkLogs } = await import('@/lib/services');
                        const res = await overrideWorkLogs(timeline.woId, timeline.itemId, entries, organizationId, timeline.productId);
                        if (res.success) { showToast?.('Ažurirano', 'success'); onRefresh?.('workOrders', 'workLogs'); setTimeline(null); loadRaw(); }
                        else showToast?.(res.message, 'error');
                        return res;
                    }}
                />
            )}

            {projectCal && raw && (
                <ProjectWorkCalendar
                    raw={raw}
                    projectId={projectCal.projectId}
                    projectName={projectCal.projectName}
                    onClose={() => setProjectCal(null)}
                />
            )}

            {workerCal && raw && (
                <WorkerWorkCalendar
                    raw={raw}
                    workerId={workerCal.workerId}
                    workerName={workerCal.workerName}
                    onClose={() => setWorkerCal(null)}
                />
            )}
        </>
    );
}

// ── Pregled — "Kako stojimo?" ────────────────────────────────────────────────
function Overview({ data, onGoTo }: { data: AnalyticsData; onGoTo: (t: Tab) => void }) {
    const k = data.kpis;
    const trosak = Math.round((k.material + k.labor) * 100) / 100;
    const topProjects = [...data.projects].sort((a, b) => b.profit - a.profit).slice(0, 3);
    const maxAbsProfit = Math.max(1, ...topProjects.map(p => Math.abs(p.profit)));
    return (
        <div className="ana-section">
            {/* Hero — profit dominira, prihod i trošak kao kontekst */}
            <div className="ana-hero">
                <div className={`ana-hero-main ${k.profit >= 0 ? 'pos' : 'neg'}`}>
                    <span className="ana-hero-label">Profit</span>
                    <span className="ana-hero-value">{fmt(k.profit)}</span>
                    <span className="ana-hero-sub">marža {pct(k.margin)} · od {fmt(k.revenue)} prihoda</span>
                </div>
                <div className="ana-hero-side">
                    <div className="ana-hero-kpi"><span>Prihod</span><b>{fmt(k.revenue)}</b></div>
                    <div className="ana-hero-kpi"><span>Trošak (materijal + rad)</span><b>{fmt(trosak)}</b><em>{fmt(k.material)} mat · {fmt(k.labor)} rad</em></div>
                </div>
            </div>

            {/* Trend rada po sedmici — jedna čista linija */}
            <div className="ana-card">
                <div className="ana-card-title">Trošak rada po sedmici{data.range.from ? ' (period)' : ''}</div>
                <TrendChart points={data.weeklyTrend.map(w => ({ label: human(w.weekStart), value: w.labor }))} color="#16a34a" />
            </div>

            {/* Snapshot plan vs stvarno + top projekti */}
            <div className="ana-grid2">
                <div className="ana-card">
                    <div className="ana-card-title">Koliko smo potrefili ponudu?</div>
                    <PvASnapshot label="Materijal" m={data.planVsActual.total.material} onClick={() => onGoTo('planvsactual')} />
                    <PvASnapshot label="Rad" m={data.planVsActual.total.labor} onClick={() => onGoTo('planvsactual')} />
                </div>
                <div className="ana-card">
                    <div className="ana-card-title">Top projekti po profitu</div>
                    {topProjects.length === 0 ? <div className="ana-empty">Nema projekata.</div> : topProjects.map(p => (
                        <div key={p.projectId || p.projectName} className="ana-rowbar">
                            <span className="ana-rowbar-label" title={p.projectName}>{p.projectName}</span>
                            <HBar value={p.profit} max={maxAbsProfit} color={p.profit >= 0 ? '#22c55e' : '#ef4444'} />
                            <span className={`ana-rowbar-val ${p.profit >= 0 ? 'green' : 'red'}`}>{fmt(p.profit)}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

/** Čist SVG line+area trend (umjesto gomile barova). */
function TrendChart({ points, color }: { points: { label: string; value: number }[]; color: string }) {
    if (points.length === 0) return <div className="ana-empty">Nema rada u periodu.</div>;
    const W = 100, H = 36;
    const max = Math.max(1, ...points.map(p => p.value));
    const n = points.length;
    const x = (i: number) => (n <= 1 ? W / 2 : (i / (n - 1)) * W);
    const y = (v: number) => H - (v / max) * (H - 3) - 1.5;
    const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');
    const area = `${line} L ${x(n - 1).toFixed(1)} ${H} L ${x(0).toFixed(1)} ${H} Z`;
    return (
        <div className="ana-chart">
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="ana-chart-svg">
                <path d={area} fill={color} opacity="0.12" />
                <path d={line} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
            </svg>
            <div className="ana-chart-x">{points.map((p, i) => <span key={i}>{p.label}</span>)}</div>
        </div>
    );
}

/** Kompaktni plan-vs-stvarno snapshot (klik → tab). */
function PvASnapshot({ label, m, onClick }: { label: string; m: PvAMetric; onClick: () => void }) {
    // Bez zadanog plana nema "koliko sam potrefio" — prikaži samo stvarno, bez lažnih procenata.
    if (m.planned <= 0) {
        return (
            <button className="ana-snap" onClick={onClick}>
                <div className="ana-snap-head"><span>{label}</span><b className="muted">bez plana</b></div>
                <div className="ana-snap-sub">Plan nije zadan u ponudi · Stvarno {fmt(m.actual + m.unplannedActual)}</div>
            </button>
        );
    }
    const over = m.actual > m.planned;
    return (
        <button className="ana-snap" onClick={onClick}>
            <div className="ana-snap-head"><span>{label}</span><b className={over ? 'red' : 'green'}>potrefio {pct(m.accuracyPct)}</b></div>
            <div className="ana-snap-bar"><div className="ana-snap-fill" style={{ width: `${Math.min(100, Math.max(0, m.accuracyPct))}%`, background: over ? '#ef4444' : '#22c55e' }} /></div>
            <div className="ana-snap-sub">Plan {fmt(m.planned)} → Stvarno {fmt(m.actual)}{m.unplannedActual > 0 ? ` · +${fmt(m.unplannedActual)} van plana` : ''}</div>
        </button>
    );
}

/** Veliki sažetak plan vs stvarno za metriku (materijal/rad): Plan → Stvarno + traka + "potrefio".
 *  Poređenje pokriva SAMO proizvode s planom iz ponude; trošak proizvoda bez plana
 *  se prikazuje odvojeno ("van plana") — ne napuhava prekoračenje. */
function PvASummary({ label, m }: { label: string; m: PvAMetric }) {
    if (m.planned <= 0) {
        return (
            <div className="ana-card">
                <div className="ana-card-title">{label}</div>
                <div className="ana-pva-big">
                    <div className="ana-pva-cell"><span className="ana-pva-k">Plan (ponuda)</span><b className="muted">—</b></div>
                    <span className="ana-pva-arrow">→</span>
                    <div className="ana-pva-cell"><span className="ana-pva-k">Stvarno</span><b>{fmt(m.actual + m.unplannedActual)}</b></div>
                </div>
                <div className="ana-pva-foot"><span className="muted">Plan nije zadan u ponudi — nema poređenja.</span></div>
            </div>
        );
    }
    const delta = Math.round((m.actual - m.planned) * 100) / 100;   // + = potrošeno više
    const over = delta > 0;
    return (
        <div className="ana-card">
            <div className="ana-card-title">{label}</div>
            <div className="ana-pva-big">
                <div className="ana-pva-cell"><span className="ana-pva-k">Plan (ponuda)</span><b>{fmt(m.planned)}</b></div>
                <span className="ana-pva-arrow">→</span>
                <div className="ana-pva-cell"><span className="ana-pva-k">Stvarno</span><b className={over ? 'red' : 'green'}>{fmt(m.actual)}</b></div>
            </div>
            <div className="ana-snap-bar"><div className="ana-snap-fill" style={{ width: `${Math.min(100, Math.max(0, m.accuracyPct))}%`, background: over ? '#ef4444' : '#22c55e' }} /></div>
            <div className="ana-pva-foot">
                <span className={over ? 'red' : 'green'}>{over ? 'Prekoračenje ' : 'Ušteda '}{fmt(Math.abs(delta))} ({pct(Math.abs(m.variancePct))})</span>
                <span className="ana-pva-acc-big">potrefio <b>{pct(m.accuracyPct)}</b></span>
            </div>
            {m.unplannedActual > 0 && (
                <div className="ana-pva-unplanned">+ {fmt(m.unplannedActual)} na proizvodima bez plana u ponudi (nije u poređenju)</div>
            )}
        </div>
    );
}

function Kpi({ label, value, tone, big }: { label: string; value: string; tone?: 'green' | 'red' | 'amber'; big?: boolean }) {
    return (
        <div className={`ana-kpi ${big ? 'big' : ''}`}>
            <span className="ana-kpi-label">{label}</span>
            <span className={`ana-kpi-value ${tone || ''}`}>{value}</span>
        </div>
    );
}

// ── Projekti ─────────────────────────────────────────────────────────────────
function ProjectsTab({ data, onPick }: { data: AnalyticsData; onPick: (projectId: string, projectName: string) => void }) {
    const maxAbs = Math.max(1, ...data.projects.map(p => Math.abs(p.profit)));
    return (
        <div className="ana-section">
            <div className="ana-hint">Klikni projekt za kalendar rada (dan-po-dan: ko je i na čemu radio).</div>
            <table className="ana-table">
                <thead><tr><th>Projekat</th><th className="r">Prihod</th><th className="r">Materijal</th><th className="r">Rad</th><th className="r">Usluge</th><th className="r">Profit</th><th className="r">Marža</th><th className="ana-barcol">Profit</th><th></th></tr></thead>
                <tbody>
                    {data.projects.map(p => (
                        <tr key={p.projectId || p.projectName} className="ana-row-click" onClick={() => onPick(p.projectId, p.projectName)} title="Otvori kalendar rada">
                            <td>{p.projectName} <span className="muted">· {p.productCount} prod.</span></td>
                            <td className="r">{fmt(p.revenue)}</td>
                            <td className="r">{fmt(p.material)}</td>
                            <td className="r amber">{fmt(p.labor)}</td>
                            <td className="r">{fmt(p.services)}</td>
                            <td className={`r b ${p.profit >= 0 ? 'green' : 'red'}`}>{fmt(p.profit)}</td>
                            <td className={`r ${p.margin >= 0 ? 'green' : 'red'}`}>{pct(p.margin)}</td>
                            <td className="ana-barcol"><HBar value={p.profit} max={maxAbs} color={p.profit >= 0 ? '#22c55e' : '#ef4444'} /></td>
                            <td className="r"><span className="ana-link">Kalendar →</span></td>
                        </tr>
                    ))}
                </tbody>
            </table>
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

interface PwcEntry { worker: string; product: string; productId: string; woNumber: string }

function ProjectWorkCalendar({ raw, projectId, projectName, onClose }: { raw: AnalyticsRaw; projectId: string; projectName: string; onClose: () => void }) {
    // Ključ projekta IDENTIČAN agregaciji (aggregateProjects): Project_ID || Project_Name || '—'.
    const projKey = projectId || projectName || '—';

    const idx = useMemo(() => {
        const byItem = new Map<string, { product: string; productId: string; woId: string }>();
        for (const it of raw.items) {
            if ((it.Project_ID || it.Project_Name || '—') !== projKey) continue;
            byItem.set(it.ID, { product: it.Product_Name || 'Proizvod', productId: it.Product_ID || '', woId: it.Work_Order_ID || '' });
        }
        const woNum = new Map(raw.workOrders.map(w => [w.Work_Order_ID, w.Work_Order_Number]));
        return { byItem, woNum };
    }, [raw, projKey]);

    // Datum → zapisi rada — STROGO po stavkama ovog projekta (po Work_Order_Item_ID).
    const byDate = useMemo(() => {
        const m = new Map<string, PwcEntry[]>();
        for (const l of raw.logs) {
            const hit = l.Work_Order_Item_ID ? idx.byItem.get(l.Work_Order_Item_ID) : undefined;
            if (!hit) continue;
            const date = (l.Date || '').split('T')[0];
            if (!date) continue;
            const arr = m.get(date) || [];
            arr.push({ worker: l.Worker_Name || 'Radnik', product: hit.product, productId: hit.productId, woNumber: hit.woId ? (idx.woNum.get(hit.woId) || '') : '' });
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

    // Legenda + filter: radnici sa brojem radnih dana (cijeli projekt).
    const workerList = useMemo(() => {
        const m = new Map<string, Set<string>>();
        byDate.forEach((arr, date) => arr.forEach(e => { const s = m.get(e.worker) || new Set<string>(); s.add(date); m.set(e.worker, s); }));
        return Array.from(m.entries()).map(([worker, dates]) => ({ worker, days: dates.size })).sort((a, b) => b.days - a.days || a.worker.localeCompare(b.worker));
    }, [byDate]);

    // Zapisi za dan uz aktivni filter radnika.
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

    const totals = useMemo(() => {
        const w = new Set<string>();
        byDate.forEach(arr => arr.forEach(e => w.add(e.worker)));
        return { days: byDate.size, workers: w.size };
    }, [byDate]);

    const shiftMonth = (delta: number) => setYm(prev => { const d = new Date(prev.y, prev.m + delta, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
    const goToday = () => { const d = new Date(); setYm({ y: d.getFullYear(), m: d.getMonth() }); };

    // Detalj izabranog dana (poštuje filter radnika): radnik → uredan skup proizvoda.
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
                            {totals.days > 0 ? `${totals.days} radnih dana · ${totals.workers} radnika ukupno` : 'Nema evidentiranog rada'}
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
                            {/* Filter / legenda radnika (boja + broj dana) */}
                            <div className="pwc-filters">
                                <button className={`pwc-fchip${!selWorker ? ' on' : ''}`} onClick={() => setSelWorker(null)}>Svi radnici</button>
                                {workerList.map(({ worker, days: wd }) => (
                                    <button key={worker} className={`pwc-fchip${selWorker === worker ? ' on' : ''}`}
                                        onClick={() => setSelWorker(s => s === worker ? null : worker)} title={`${worker} · ${wd} radnih dana`}>
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

// ── Radnici — tabela + drill u kalendar rada radnika ─────────────────────────
function WorkersTab({ data, onPick }: { data: AnalyticsData; onPick: (workerId: string, workerName: string) => void }) {
    const maxEarn = Math.max(1, ...data.workers.map(w => w.earnings));
    return (
        <div className="ana-section">
            <div className="ana-hint">Klikni radnika za kalendar rada (dan-po-dan: na kojim nalozima i proizvodima je radio).</div>
            {data.workers.length === 0 ? (
                <div className="ana-empty">Nema evidentiranog rada u odabranom periodu.</div>
            ) : (
                <table className="ana-table">
                    <thead><tr><th>Radnik</th><th className="r">Radni dani</th><th className="r">Prosj. dnevnica</th><th className="r">Zarada</th><th className="r">Proizvoda</th><th className="ana-barcol">Zarada</th><th></th></tr></thead>
                    <tbody>
                        {data.workers.map(w => (
                            <tr key={w.workerId} className="ana-row-click" onClick={() => onPick(w.workerId, w.name)} title="Otvori kalendar rada radnika">
                                <td><span className="pwc-av" style={{ background: pwcColor(w.name), marginRight: 8 }}>{pwcInitials(w.name)}</span>{w.name}</td>
                                <td className="r">{w.days}</td>
                                <td className="r">{fmt(w.avgRate)}</td>
                                <td className="r b amber">{fmt(w.earnings)}</td>
                                <td className="r">{w.products}</td>
                                <td className="ana-barcol"><HBar value={w.earnings} max={maxEarn} color="#d97706" /></td>
                                <td className="r"><span className="ana-link">Kalendar →</span></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
}

// ── Kalendar rada po RADNIKU (mjesečna mreža: nalozi po danima + detalj dana) ──
interface WwcEntry { orderKey: string; orderLabel: string; product: string; rate: number; fraction: number }

function WorkerWorkCalendar({ raw, workerId, workerName, onClose }: { raw: AnalyticsRaw; workerId: string; workerName: string; onClose: () => void }) {
    // Indeksi: stavka → proizvod, nalog → naziv (isti prikaz imena kao u Proizvodnji).
    const idx = useMemo(() => {
        const productByItem = new Map<string, string>();
        for (const it of raw.items) productByItem.set(it.ID, it.Product_Name || 'Proizvod');
        const woById = new Map(raw.workOrders.map(w => [w.Work_Order_ID, w]));
        return { productByItem, woById };
    }, [raw]);

    // Datum → zapisi rada OVOG radnika (svi nalozi, kompletna istorija — period bira mjesec).
    const byDate = useMemo(() => {
        const m = new Map<string, WwcEntry[]>();
        for (const l of raw.logs) {
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
    const [selOrder, setSelOrder] = useState<string | null>(null);   // filter po nalogu (orderKey)
    const todayIso = toISO(new Date());

    // Legenda + filter: nalozi radnika s brojem radnih dana (kompletna istorija).
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

    // Statistika mjeseca (poštuje filter naloga): dani, radnik-dani (Σ Day_Fraction), zarada.
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

    // Detalj izabranog dana: nalog → proizvodi (Σ dnevnice po proizvodu) + suma dana.
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
                            {/* Filter / legenda naloga (boja + broj dana na nalogu) */}
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

// ── Plan vs Stvarno — paired trake (Plan vs Stvarno) po projektu ──────────────
function PairedMetric({ label, m, max }: { label: string; m: PvAMetric; max: number }) {
    // Projekat bez plana za ovu metriku (nema prihvaćene ponude / plan = 0):
    // prikaži samo stvarno, bez lažnog "preko plana 0%".
    if (m.planned <= 0) {
        const actual = m.actual + m.unplannedActual;
        const aw = max > 0 ? (actual / max) * 100 : 0;
        return (
            <div className="ana-pm">
                <div className="ana-pm-label">{label}</div>
                <div className="ana-pm-bars">
                    <div className="ana-pm-row">
                        <span className="ana-pm-tag">Stvarno</span>
                        <div className="ana-pm-track"><div className="ana-pm-fill" style={{ width: `${aw}%`, background: '#94a3b8' }} /></div>
                        <span className="ana-pm-val">{fmt(actual)}</span>
                    </div>
                </div>
                <div className="ana-pm-delta muted">plan nije zadan u ponudi</div>
            </div>
        );
    }
    const over = m.actual > m.planned;
    const delta = Math.round((m.actual - m.planned) * 100) / 100;
    const pw = max > 0 ? (m.planned / max) * 100 : 0;
    const aw = max > 0 ? (m.actual / max) * 100 : 0;
    return (
        <div className="ana-pm">
            <div className="ana-pm-label">{label}</div>
            <div className="ana-pm-bars">
                <div className="ana-pm-row">
                    <span className="ana-pm-tag">Plan</span>
                    <div className="ana-pm-track"><div className="ana-pm-fill plan" style={{ width: `${pw}%` }} /></div>
                    <span className="ana-pm-val">{fmt(m.planned)}</span>
                </div>
                <div className="ana-pm-row">
                    <span className="ana-pm-tag">Stvarno</span>
                    <div className="ana-pm-track"><div className="ana-pm-fill" style={{ width: `${aw}%`, background: over ? '#ef4444' : '#22c55e' }} /></div>
                    <span className="ana-pm-val">{fmt(m.actual)}</span>
                </div>
            </div>
            <div className={`ana-pm-delta ${over ? 'red' : 'green'}`}>
                {over ? '+' : ''}{fmt(delta)} · {over ? 'preko plana' : 'ušteda'} {pct(Math.abs(m.variancePct))}
                {m.unplannedActual > 0 ? <span className="muted"> · +{fmt(m.unplannedActual)} van plana</span> : null}
            </div>
        </div>
    );
}

function PlanVsActualTab({ data }: { data: AnalyticsData }) {
    const rows = data.planVsActual.byProject;
    const total = data.planVsActual.total;
    const maxMat = Math.max(1, ...rows.map(r => Math.max(r.material.planned, r.material.actual + r.material.unplannedActual)));
    const maxLab = Math.max(1, ...rows.map(r => Math.max(r.labor.planned, r.labor.actual + r.labor.unplannedActual)));
    return (
        <div className="ana-section">
            <div className="ana-grid2">
                <PvASummary label="Materijal (ponuda vs stvarno)" m={total.material} />
                <PvASummary label="Rad (ponuda vs stvarno)" m={total.labor} />
            </div>
            <div className="ana-card-title" style={{ marginTop: 2 }}>Po projektu — gdje smo potrefili, gdje prešli plan</div>
            {rows.length === 0 ? <div className="ana-empty">Nema projekata.</div> : rows.map((r, i) => (
                <div key={i} className="ana-pp">
                    <div className="ana-pp-name">{r.projectName}</div>
                    <div className="ana-pp-metrics">
                        <PairedMetric label="Materijal" m={r.material} max={maxMat} />
                        <PairedMetric label="Rad" m={r.labor} max={maxLab} />
                    </div>
                </div>
            ))}
        </div>
    );
}
