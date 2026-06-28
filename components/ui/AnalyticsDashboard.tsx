'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useData } from '@/context/DataContext';
import {
    X, BarChart3, FolderKanban, Package, GitCompareArrows, RefreshCw, Search, Loader2,
} from 'lucide-react';
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
                        <ProjectsTab data={data} />
                    ) : tab === 'products' ? (
                        <div className="ana-section">
                            <div className="ana-search"><Search size={16} /><input placeholder="Pretraži proizvode/projekte…" value={search} onChange={e => setSearch(e.target.value)} /></div>
                            <table className="ana-table">
                                <thead><tr><th>Proizvod</th><th>Projekat</th><th className="r">Cijena</th><th className="r">Materijal</th><th className="r">Rad</th><th className="r">Profit</th><th></th></tr></thead>
                                <tbody>
                                    {filteredProducts.map(p => {
                                        const isMontaza = p.woType === 'Montaža';
                                        return (
                                            <tr key={p.itemId}>
                                                <td>{p.productName}</td>
                                                <td className="muted">{p.projectName} <span className="ana-wo">#{p.woNumber}</span></td>
                                                <td className="r">{isMontaza ? '—' : fmt(p.selling)}</td>
                                                <td className="r">{isMontaza ? '—' : fmt(p.material)}</td>
                                                <td className="r amber">{fmt(p.labor)}</td>
                                                <td className={`r b ${isMontaza ? 'amber' : p.profit >= 0 ? 'green' : 'red'}`}>
                                                    {isMontaza ? `−${fmt(p.labor)}` : `${fmt(p.profit)} · ${pct(p.margin)}`}
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
    const over = m.actual > m.planned;
    return (
        <button className="ana-snap" onClick={onClick}>
            <div className="ana-snap-head"><span>{label}</span><b className={over ? 'red' : 'green'}>potrefio {pct(m.accuracyPct)}</b></div>
            <div className="ana-snap-bar"><div className="ana-snap-fill" style={{ width: `${Math.min(100, Math.max(0, m.accuracyPct))}%`, background: over ? '#ef4444' : '#22c55e' }} /></div>
            <div className="ana-snap-sub">Plan {fmt(m.planned)} → Stvarno {fmt(m.actual)}</div>
        </button>
    );
}

/** Veliki sažetak plan vs stvarno za metriku (materijal/rad): Plan → Stvarno + traka + "potrefio". */
function PvASummary({ label, m }: { label: string; m: PvAMetric }) {
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
function ProjectsTab({ data }: { data: AnalyticsData }) {
    const maxAbs = Math.max(1, ...data.projects.map(p => Math.abs(p.profit)));
    return (
        <div className="ana-section">
            <table className="ana-table">
                <thead><tr><th>Projekat</th><th className="r">Prihod</th><th className="r">Materijal</th><th className="r">Rad</th><th className="r">Profit</th><th className="r">Marža</th><th className="ana-barcol">Profit</th></tr></thead>
                <tbody>
                    {data.projects.map(p => (
                        <tr key={p.projectId || p.projectName}>
                            <td>{p.projectName} <span className="muted">· {p.productCount} prod.</span></td>
                            <td className="r">{fmt(p.revenue)}</td>
                            <td className="r">{fmt(p.material)}</td>
                            <td className="r amber">{fmt(p.labor)}</td>
                            <td className={`r b ${p.profit >= 0 ? 'green' : 'red'}`}>{fmt(p.profit)}</td>
                            <td className={`r ${p.margin >= 0 ? 'green' : 'red'}`}>{pct(p.margin)}</td>
                            <td className="ana-barcol"><HBar value={p.profit} max={maxAbs} color={p.profit >= 0 ? '#22c55e' : '#ef4444'} /></td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

// ── Plan vs Stvarno — paired trake (Plan vs Stvarno) po projektu ──────────────
function PairedMetric({ label, m, max }: { label: string; m: PvAMetric; max: number }) {
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
            <div className={`ana-pm-delta ${over ? 'red' : 'green'}`}>{over ? '+' : ''}{fmt(delta)} · {over ? 'preko plana' : 'ušteda'} {pct(Math.abs(m.variancePct))}</div>
        </div>
    );
}

function PlanVsActualTab({ data }: { data: AnalyticsData }) {
    const rows = data.planVsActual.byProject;
    const total = data.planVsActual.total;
    const maxMat = Math.max(1, ...rows.map(r => Math.max(r.material.planned, r.material.actual)));
    const maxLab = Math.max(1, ...rows.map(r => Math.max(r.labor.planned, r.labor.actual)));
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
