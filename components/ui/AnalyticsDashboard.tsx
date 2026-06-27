'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useData } from '@/context/DataContext';
import {
    X, BarChart3, Users, FolderKanban, Package, GitCompareArrows, RefreshCw, Search, Loader2,
} from 'lucide-react';
import type { AnalyticsData, AnalyticsScope } from '@/lib/services/profit/analyticsService';
import type { WorkLog } from '@/lib/types';
import PlanVsActualCard from './PlanVsActualCard';
import WorkerEarningsWidget from './WorkerEarningsWidget';
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
    const [data, setData] = useState<AnalyticsData | null>(null);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');

    // Drill u timeline proizvoda
    const [timeline, setTimeline] = useState<{ itemId: string; productId: string; productName: string; woId: string; status: string; selling: number; material: number; labor: number } | null>(null);
    const [timelineLogs, setTimelineLogs] = useState<WorkLog[]>([]);
    const [loadingTimeline, setLoadingTimeline] = useState(false);

    const loadData = useCallback(async () => {
        if (!organizationId) return;
        setLoading(true);
        try {
            const { getAnalytics } = await import('@/lib/services');
            const range = periodRange(period);
            setData(await getAnalytics(organizationId, { ...range, scope }));
        } catch (e) {
            console.error('analytics load failed', e);
            showToast?.('Greška pri učitavanju analitike', 'error');
        } finally {
            setLoading(false);
        }
    }, [organizationId, period, scope, showToast]);

    useEffect(() => { loadData(); }, [loadData]);

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
        { id: 'workers', label: 'Radnici', Icon: Users },
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
                        <button className="ana-icon-btn" onClick={loadData} title="Osvježi"><RefreshCw size={16} /></button>
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
                        <Overview data={data} />
                    ) : tab === 'workers' ? (
                        <div className="ana-section">
                            {data.workers.length === 0 ? <div className="ana-empty">Nema evidentiranog rada u periodu.</div> : (
                                <>
                                    <WorkerEarningsWidget
                                        title="Zarada radnika"
                                        subtitle={data.range.from ? `${data.range.from} – ${data.range.to}` : 'Cijeli period'}
                                        workers={data.workers.map(w => ({ Worker_ID: w.workerId, Worker_Name: w.name, Days: w.days, Avg_Daily_Rate: w.avgRate, Total_Earnings: w.earnings }))}
                                        maxWorkers={50}
                                    />
                                    <table className="ana-table">
                                        <thead><tr><th>Radnik</th><th className="r">Dani</th><th className="r">Zarada</th><th className="r">Prosj. dnevnica</th><th className="r">Proizvoda</th></tr></thead>
                                        <tbody>
                                            {data.workers.map(w => (
                                                <tr key={w.workerId}>
                                                    <td>{w.name}</td>
                                                    <td className="r">{w.days}</td>
                                                    <td className="r b">{fmt(w.earnings)}</td>
                                                    <td className="r">{fmt(w.avgRate)}</td>
                                                    <td className="r">{w.products}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </>
                            )}
                        </div>
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
                    onClose={() => { setTimeline(null); setTimelineLogs([]); loadData(); }}
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
                        if (res.success) { showToast?.('Ažurirano', 'success'); onRefresh?.('workOrders', 'workLogs'); setTimeline(null); loadData(); }
                        else showToast?.(res.message, 'error');
                        return res;
                    }}
                />
            )}
        </>
    );
}

// ── Pregled ──────────────────────────────────────────────────────────────────
function Overview({ data }: { data: AnalyticsData }) {
    const k = data.kpis;
    const maxWeek = Math.max(1, ...data.weeklyTrend.map(w => w.labor));
    const topProjects = [...data.projects].sort((a, b) => b.profit - a.profit).slice(0, 6);
    const maxAbsProfit = Math.max(1, ...topProjects.map(p => Math.abs(p.profit)));
    return (
        <div className="ana-section">
            <div className="ana-kpis">
                <Kpi label="Prihod" value={fmt(k.revenue)} />
                <Kpi label="Materijal" value={fmt(k.material)} />
                <Kpi label="Rad" value={fmt(k.labor)} tone="amber" />
                <Kpi label="Profit" value={fmt(k.profit)} tone={k.profit >= 0 ? 'green' : 'red'} big />
                <Kpi label="Marža" value={pct(k.margin)} tone={k.margin >= 0 ? 'green' : 'red'} />
            </div>

            <div className="ana-grid2">
                <div className="ana-card">
                    <div className="ana-card-title">Trošak rada po sedmici {data.range.from ? '(period)' : ''}</div>
                    {data.weeklyTrend.length === 0 ? <div className="ana-empty">Nema rada u periodu.</div> : (
                        <div className="ana-trend">
                            {data.weeklyTrend.map(w => (
                                <div key={w.weekStart} className="ana-trend-col" title={`${human(w.weekStart)} — ${fmt(w.labor)}`}>
                                    <div className="ana-trend-bar" style={{ height: `${Math.max(4, (w.labor / maxWeek) * 100)}%` }} />
                                    <span className="ana-trend-x">{human(w.weekStart)}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
                <div className="ana-card">
                    <div className="ana-card-title">Top projekti po profitu</div>
                    {topProjects.map(p => (
                        <div key={p.projectId || p.projectName} className="ana-rowbar">
                            <span className="ana-rowbar-label" title={p.projectName}>{p.projectName}</span>
                            <HBar value={p.profit} max={maxAbsProfit} color={p.profit >= 0 ? '#22c55e' : '#ef4444'} />
                            <span className={`ana-rowbar-val ${p.profit >= 0 ? 'green' : 'red'}`}>{fmt(p.profit)}</span>
                        </div>
                    ))}
                </div>
            </div>

            <PlanVsActualCard plannedCost={data.planVsActual.total.plannedLabor} actualCost={data.planVsActual.total.actualLabor} compact />
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

// ── Plan vs Stvarno ──────────────────────────────────────────────────────────
function PlanVsActualTab({ data }: { data: AnalyticsData }) {
    const rows = data.planVsActual.byProject;
    const maxAbs = Math.max(1, ...rows.map(r => Math.abs(r.variance)));
    return (
        <div className="ana-section">
            <PlanVsActualCard plannedCost={data.planVsActual.total.plannedLabor} actualCost={data.planVsActual.total.actualLabor} />
            <table className="ana-table">
                <thead><tr><th>Projekat</th><th className="r">Plan (ponuda)</th><th className="r">Stvarno</th><th className="r">Razlika</th><th className="ana-barcol">Δ</th></tr></thead>
                <tbody>
                    {rows.map(r => (
                        <tr key={r.projectId || r.projectName}>
                            <td>{r.projectName}</td>
                            <td className="r">{fmt(r.plannedLabor)}</td>
                            <td className="r b">{fmt(r.actualLabor)}</td>
                            <td className={`r b ${r.variance >= 0 ? 'green' : 'red'}`}>{r.variance >= 0 ? 'ušteda ' : 'prekoračenje '}{fmt(Math.abs(r.variance))} ({pct(Math.abs(r.variancePct))})</td>
                            <td className="ana-barcol"><HBar value={r.variance} max={maxAbs} color={r.variance >= 0 ? '#22c55e' : '#ef4444'} /></td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
