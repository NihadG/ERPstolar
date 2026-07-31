'use client';

// ════════════════════════════════════════════════════════════════════
// PREGLED PROJEKTA — full-screen overlay (portal)
//
// Kompletna, radna slika projekta na jednom mjestu: šta klijent plaća, na šta ide
// svaka marka, SVI proizvodi (i oni koji još nisu u nalogu), materijali (s
// kreiranjem narudžbi), nalozi (otvaranje prave kartice) i radnici (dnevni rad).
// Sve se računa iz podataka u memoriji (buildProjectOverview) — otvaranje trenutno.
//
// Finansije = isti izvor kao kartica/nalog/analitika (lib/projectOverview → lib/profit).
// ════════════════════════════════════════════════════════════════════

import { Fragment, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    ArrowLeft, Printer, LayoutDashboard, Package, Boxes, ClipboardList, Users,
    TrendingUp, TrendingDown, Wallet, Coins, AlertTriangle, ChevronRight,
    ShoppingCart, CheckSquare, Square, Hammer, CalendarDays,
} from 'lucide-react';
import type { Project, WorkOrder, WorkLog, Offer, Worker, Material, Order, Task } from '@/lib/types';
import { buildProjectOverview, type ProjectOverview } from '@/lib/projectOverview';
import { formatDate } from '@/lib/utils';
import { orderItemPricing } from '@/lib/orderPricing';
import { useIsCompact } from '@/hooks/useIsCompact';
import { useSwipeBack } from '@/components/tabs/mobile/useSwipe';
import { useOverlayGuard } from '@/components/tabs/mobile/overlayGuard';
import { useData } from '@/context/DataContext';
import { createOrder, updateWorkOrder, startWorkOrder, deleteWorkOrder } from '@/lib/services';
import { checkWorkOrderStart, findWorkersToBookToday, bookWorkersToday } from '@/lib/workOrderStart';
import { todayISO } from '@/lib/planning';
import Modal from './Modal';
import WorkOrderExpandedDetail from './WorkOrderExpandedDetail';
import WorkOrderPrintTemplate from './WorkOrderPrintTemplate';
import './ProjectOverviewScreen.css';

// ── Paleta troškovnih segmenata (fiksne, kontrastne) ────────────────
const COLORS = {
    material: '#5b8def',
    labor: '#f5a524',
    services: '#a855f7',
    transport: '#17c0b8',
    profit: '#22c55e',
    loss: '#ef4444',
};

interface ProjectOverviewScreenProps {
    project: Project;
    workOrders: WorkOrder[];
    workLogs: WorkLog[];
    offers?: Offer[];
    workers?: Worker[];
    materials?: Material[];   // katalog — za kategoriju materijala pri kreiranju narudžbe
    orders?: Order[];         // narudžbe — pregled + osvježavanje
    tasks?: Task[];           // svi zadaci org — kartica naloga ih filtrira po Task.Links
    currency?: string;
    onClose: () => void;
    onCreateWorkOrder?: (projectId: string, projectName: string, products: { productId: string; productName: string; quantity: number }[]) => void;
    onRefresh?: (...collections: string[]) => void;
    showToast?: (message: string, type: 'success' | 'error' | 'info') => void;
}

type Tab = 'pregled' | 'proizvodi' | 'materijali' | 'nalozi' | 'radnici';

// Materijal spreman za naručivanje (iz ProductMaterial-a projekta).
interface OrderableMaterial {
    id: string;            // ProductMaterial.ID
    materialId: string;
    name: string;
    unit: string;
    category: string;
    supplier: string;
    productId: string;
    productName: string;
    qtyToOrder: number;
    unitPrice: number;
    lineTotal: number;
}

export default function ProjectOverviewScreen({
    project, workOrders, workLogs, offers = [], workers = [], materials = [], orders = [], tasks = [],
    currency = 'KM', onClose, onCreateWorkOrder, onRefresh, showToast,
}: ProjectOverviewScreenProps) {
    const { organizationId } = useData();
    const [tab, setTab] = useState<Tab>('pregled');
    const [expandedWoId, setExpandedWoId] = useState<string | null>(null);
    // Modali radnog naloga (kao u ProductionTab) — puna kartica se koristi INLINE.
    const [printWO, setPrintWO] = useState<WorkOrder | null>(null);
    const [deleteWO, setDeleteWO] = useState<{ id: string; number: string } | null>(null);
    const [bookToday, setBookToday] = useState<{ workOrderId: string; workers: { workerId: string; workerName: string }[] } | null>(null);
    const [bookSaving, setBookSaving] = useState(false);

    const ov = useMemo<ProjectOverview>(
        () => buildProjectOverview({ project, workOrders, workLogs, offers, workers }),
        [project, workOrders, workLogs, offers, workers]
    );

    // Kategorija po Material_ID (iz kataloga) — za grupisanje narudžbi po kategoriji.
    const categoryById = useMemo(() => {
        const m = new Map<string, string>();
        for (const mat of materials) m.set(mat.Material_ID, mat.Category || 'Ostalo');
        return m;
    }, [materials]);

    // Materijali projekta koji NISU naručeni (za kreiranje narudžbe).
    const orderableMaterials = useMemo<OrderableMaterial[]>(() => {
        const out: OrderableMaterial[] = [];
        for (const product of project.products || []) {
            const productQty = product.Quantity && product.Quantity > 0 ? product.Quantity : 1;
            for (const mat of product.materials || []) {
                if (mat.Status !== 'Nije naručeno' || mat.Order_ID) continue;
                const needed = (mat.Quantity || 0) * productQty;
                const coverage = (mat.On_Stock || 0) + (mat.Ordered_Quantity || 0) + (mat.Received_Quantity || 0);
                const qtyToOrder = Math.round((needed - coverage) * 100) / 100;
                if (qtyToOrder <= 0) continue;
                const unitPrice = mat.Unit_Price || 0;
                out.push({
                    id: mat.ID,
                    materialId: mat.Material_ID || '',
                    name: mat.Material_Name,
                    unit: mat.Unit || 'kom',
                    category: (mat.Material_ID && categoryById.get(mat.Material_ID)) || 'Ostalo',
                    supplier: mat.Supplier || '',
                    productId: mat.Product_ID || product.Product_ID,
                    productName: product.Name || 'Proizvod',
                    qtyToOrder,
                    unitPrice,
                    lineTotal: Math.round(qtyToOrder * unitPrice * 100) / 100,
                });
            }
        }
        return out;
    }, [project.products, categoryById]);

    // Narudžbe ovog projekta (bilo koja stavka pripada projektu).
    const projectOrders = useMemo(
        () => orders.filter(o => (o.items || []).some(it => it.Project_ID === project.Project_ID)),
        [orders, project.Project_ID]
    );

    useEffect(() => {
        window.history.pushState({ projOverview: true }, '');
        const onPop = () => onClose();
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') window.history.back(); };
        window.addEventListener('popstate', onPop);
        window.addEventListener('keydown', onKey);
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            window.removeEventListener('popstate', onPop);
            window.removeEventListener('keydown', onKey);
            document.body.style.overflow = prev;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const goBack = () => window.history.back();
    // Prijavljuje da je full-screen overlay otvoren (samo relevantno na mobitelu).
    useOverlayGuard(true);

    // Povlačenje s lijeve ivice = nazad (telefon); modali ga isključuju.
    const swipeRef = useSwipeBack(goBack, { enabled: !printWO && !deleteWO && !bookToday });

    const fmt = (n: number) => `${Math.round(n).toLocaleString('hr-HR')} ${currency}`;
    const fmt0 = (n: number) => Math.round(n).toLocaleString('hr-HR');

    const fin = ov.financial;
    const cost = fin.material + fin.labor + fin.services + fin.transport + fin.other;
    const marginClass = fin.profit < 0 ? 'bad' : fin.margin >= 30 ? 'good' : fin.margin >= 15 ? 'mid' : 'bad';

    // ── Radnje nad nalogom (ISTE kao ProductionTab: pišu kroz iste servise +
    //    onRefresh reloaduje globalno → puna sinhronizacija s tabom Nalozi) ──
    const refreshWO = (...c: string[]) => onRefresh?.(...Array.from(new Set(['workOrders', 'projects', 'workLogs', ...c])));

    const handleWoUpdate = async (workOrderId: string, updates: any) => {
        if (updates.Status === 'Završeno') {
            const wo = workOrders.find(w => w.Work_Order_ID === workOrderId);
            const unfinished = (wo?.items || []).filter(i => i.Status !== 'Završeno');
            if (unfinished.length > 0) {
                showToast?.(`Stavke nisu završene: ${unfinished.map(i => i.Product_Name).join(', ')}. Završite sve prije kompletiranja.`, 'error');
                return;
            }
        }
        const res = await updateWorkOrder(workOrderId, updates, organizationId || '');
        showToast?.(res.message, res.success ? 'success' : 'error');
        if (res.success) refreshWO();
    };

    const handleWoStart = async (workOrderId: string) => {
        const wo = workOrders.find(w => w.Work_Order_ID === workOrderId);
        if (!wo) { showToast?.('Nalog nije pronađen', 'error'); return; }
        const check = await checkWorkOrderStart(wo, [project]);
        if (!check.ok) { showToast?.(check.message, 'error'); return; }
        showToast?.('Pokretanje naloga...', 'info');
        const res = await startWorkOrder(workOrderId, organizationId || '');
        if (!res.success) { showToast?.(res.message, 'error'); return; }
        showToast?.('Nalog pokrenut', 'success');
        refreshWO();
        // Šihtarica popunjena prije starta? Ponudi knjiženje današnjeg dana (kao ProductionTab).
        try {
            const eligible = await findWorkersToBookToday(wo, workers, organizationId || '', todayISO());
            if (eligible.length > 0) setBookToday({ workOrderId, workers: eligible });
        } catch (e) { console.warn('findWorkersToBookToday failed', e); }
    };

    const handleWoPrint = (wo: WorkOrder) => {
        const enriched = {
            ...wo,
            items: wo.items?.map(item => {
                const product = project.products?.find(p => p.Product_ID === item.Product_ID);
                return { ...item, materials: product?.materials || item.materials || [] };
            }),
        };
        setPrintWO(enriched);
    };

    const handleWoDelete = async (workOrderId: string) => {
        const wo = workOrders.find(w => w.Work_Order_ID === workOrderId);
        setDeleteWO({ id: workOrderId, number: wo?.Work_Order_Number || '' });
    };

    const confirmWoDelete = async (productAction: 'completed' | 'waiting') => {
        if (!deleteWO) return;
        const id = deleteWO.id;
        setDeleteWO(null);
        setExpandedWoId(prev => (prev === id ? null : prev));
        showToast?.('Brisanje naloga...', 'info');
        try {
            const res = await deleteWorkOrder(id, organizationId || '', productAction);
            showToast?.(res.message, res.success ? 'success' : 'error');
        } catch { showToast?.('Greška pri brisanju naloga', 'error'); }
        refreshWO();
    };

    const confirmBookToday = async () => {
        if (!bookToday) return;
        setBookSaving(true);
        try {
            const wo = workOrders.find(w => w.Work_Order_ID === bookToday.workOrderId);
            const booked = await bookWorkersToday(bookToday.workOrderId, wo, bookToday.workers, organizationId || '', todayISO());
            showToast?.(booked > 0 ? `Proknjiženo ${booked} dnevnica za danas` : 'Dnevnice za danas već postoje', booked > 0 ? 'success' : 'info');
            if (booked > 0) refreshWO('workers');
        } catch (e) { console.error(e); showToast?.('Greška pri knjiženju', 'error'); }
        finally { setBookSaving(false); setBookToday(null); }
    };

    const createWorkOrderFromProducts = (productIds: string[]) => {
        if (!onCreateWorkOrder) return;
        const chosen = (project.products || []).filter(p => productIds.includes(p.Product_ID));
        if (chosen.length === 0) return;
        onCreateWorkOrder(project.Project_ID, project.Client_Name, chosen.map(p => ({
            productId: p.Product_ID, productName: p.Name, quantity: p.Quantity || 1,
        })));
        onClose();
    };

    const TABS: { id: Tab; label: string; Icon: typeof Package; count?: number }[] = [
        { id: 'pregled', label: 'Pregled', Icon: LayoutDashboard },
        { id: 'proizvodi', label: 'Proizvodi', Icon: Package, count: ov.products.length },
        { id: 'materijali', label: 'Materijali', Icon: Boxes, count: ov.materials.length },
        { id: 'nalozi', label: 'Nalozi', Icon: ClipboardList, count: ov.workOrders.length },
        { id: 'radnici', label: 'Radnici', Icon: Users, count: ov.workers.length },
    ];

    if (typeof document === 'undefined') return null;

    return createPortal(
        <div
            className="pov-overlay"
            ref={swipeRef}
        >
            <header className="pov-header">
                <div className="pov-topbar">
                    <button className="pov-back" onClick={goBack} title="Nazad" aria-label="Nazad">
                        <ArrowLeft size={19} />
                    </button>

                    <div className="pov-titleblock" title={project.Name || project.Client_Name}>
                        <div className="pov-title-line">
                            <h1 className="pov-name">{project.Name || project.Client_Name}</h1>
                            <span className={`pov-status-badge s-${statusSlug(project.Status)}`}>{project.Status || 'Nacrt'}</span>
                        </div>
                        <div className="pov-sub-line">
                            {project.Name && <span className="pov-client">{project.Client_Name}</span>}
                            {project.Name && project.Deadline && <span className="pov-dot">•</span>}
                            {project.Deadline && <span className="pov-metatext">Rok {formatDate(project.Deadline)}</span>}
                        </div>
                    </div>

                    <div className="pov-actions">
                        <button className="pov-act" onClick={() => window.print()} title="Printaj pregled">
                            <Printer size={16} /> <span className="pov-act-label">Printaj</span>
                        </button>
                    </div>
                </div>

                <nav className="pov-tabbar" role="tablist">
                    {TABS.map(t => (
                        <button key={t.id} role="tab" aria-selected={tab === t.id} className={`pov-tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
                            <t.Icon size={16} />
                            <span className="pov-tab-label">{t.label}</span>
                            {t.count != null && t.count > 0 && <span className="pov-tab-count">{t.count}</span>}
                        </button>
                    ))}
                </nav>
            </header>

            <main className="pov-body">
                {tab === 'pregled' && <PregledTab ov={ov} cost={cost} fmt={fmt} fmt0={fmt0} marginClass={marginClass} />}
                {tab === 'proizvodi' && <ProizvodiTab ov={ov} fmt={fmt} onCreateWorkOrder={onCreateWorkOrder ? createWorkOrderFromProducts : undefined} />}
                {tab === 'materijali' && (
                    <MaterijaliTab
                        ov={ov} project={project} fmt={fmt} orders={projectOrders} orderable={orderableMaterials}
                        canOrder={!!organizationId && orderableMaterials.length > 0}
                        onCreateOrders={async (ids, mode) => {
                            if (!organizationId) return;
                            const chosen = orderableMaterials.filter(m => ids.has(m.id));
                            if (chosen.length === 0) return;
                            const groups = new Map<string, OrderableMaterial[]>();
                            for (const m of chosen) {
                                const key = mode === 'single' ? 'ALL' : mode === 'supplier' ? (m.supplier || 'Nepoznat dobavljač') : (m.category || 'Ostalo');
                                const arr = groups.get(key) || []; arr.push(m); groups.set(key, arr);
                            }
                            const numbers: string[] = [];
                            for (const [, mats] of Array.from(groups.entries())) {
                                const total = mats.reduce((s, m) => s + m.lineTotal, 0);
                                const sup = Array.from(new Set(mats.map(m => m.supplier).filter(Boolean)));
                                const supplierName = mode === 'supplier'
                                    ? (mats[0].supplier || 'Nepoznat dobavljač')
                                    : (sup.length === 1 ? sup[0] : sup.length ? 'Više dobavljača' : '');
                                const res = await createOrder({
                                    Name: project.Name || project.Client_Name,
                                    Supplier_Name: supplierName,
                                    Total_Amount: total,
                                    Notes: 'Kreirano iz pregleda projekta.',
                                    items: mats.map(m => ({
                                        Product_Material_ID: m.id, Product_ID: m.productId, Product_Name: m.productName,
                                        Project_ID: project.Project_ID, Material_Name: m.name,
                                        Quantity: m.qtyToOrder, Unit: m.unit, Expected_Price: m.lineTotal, Status: 'Naručeno',
                                    })) as any,
                                }, organizationId);
                                if (res.success && res.data) numbers.push(res.data.Order_Number);
                            }
                            if (numbers.length > 0) {
                                showToast?.(`Kreirano ${numbers.length} ${numbers.length === 1 ? 'narudžba (nacrt)' : 'narudžbi (nacrt)'}: ${numbers.join(', ')}. Pošalji ih u tabu Narudžbe.`, 'success');
                                onRefresh?.('orders', 'projects');
                            } else {
                                showToast?.('Nijedna narudžba nije kreirana', 'error');
                            }
                        }}
                    />
                )}
                {tab === 'nalozi' && (
                    <NaloziTab
                        ov={ov} fmt={fmt} rawWorkOrders={workOrders} workers={workers} tasks={tasks}
                        expandedId={expandedWoId} onToggle={(id) => setExpandedWoId(prev => (prev === id ? null : id))}
                        onUpdate={handleWoUpdate} onStart={handleWoStart} onPrint={handleWoPrint} onDelete={handleWoDelete}
                        onRefresh={refreshWO} showToast={showToast}
                    />
                )}
                {tab === 'radnici' && <RadniciTab ov={ov} fmt={fmt} />}
            </main>

            {/* Print naloga */}
            <Modal isOpen={!!printWO} onClose={() => setPrintWO(null)} title="Printaj Radni Nalog" size="xl"
                footer={<button className="btn btn-secondary" onClick={() => setPrintWO(null)}>Zatvori</button>}>
                {printWO && <WorkOrderPrintTemplate workOrder={printWO} tasks={tasks} />}
            </Modal>

            {/* Brisanje naloga — izbor sudbine proizvoda (kao ProductionTab) */}
            <Modal isOpen={!!deleteWO} onClose={() => setDeleteWO(null)}
                title={`Obriši nalog${deleteWO?.number ? `: #${deleteWO.number}` : ''}`}
                footer={<button className="btn btn-secondary" onClick={() => setDeleteWO(null)}>Odustani</button>}>
                <p style={{ margin: '0 0 16px 0', color: 'var(--text-secondary)', fontSize: 14 }}>Šta želite uraditi sa proizvodima iz ovog naloga?</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <button className="pov-choice" onClick={() => confirmWoDelete('completed')}>
                        <span style={{ fontSize: 22 }}>✅</span>
                        <span><b>Završi proizvode</b><small>Postavi status na „Spremno" (bez kalkulacije profita)</small></span>
                    </button>
                    <button className="pov-choice" onClick={() => confirmWoDelete('waiting')}>
                        <span style={{ fontSize: 22 }}>↩️</span>
                        <span><b>Vrati na čekanje</b><small>Proizvodi se vraćaju u „Na čekanju"</small></span>
                    </button>
                </div>
            </Modal>

            {/* Upit knjiženja današnjeg dana nakon pokretanja */}
            <Modal isOpen={!!bookToday} onClose={() => setBookToday(null)} title="Proknjiži današnji dan"
                footer={<>
                    <button className="btn btn-secondary" onClick={() => setBookToday(null)} disabled={bookSaving}>Ne sada</button>
                    <button className="btn btn-primary" onClick={confirmBookToday} disabled={bookSaving}>{bookSaving ? 'Knjižim…' : `Proknjiži (${bookToday?.workers.length || 0})`}</button>
                </>}>
                <p style={{ margin: '0 0 12px 0', color: 'var(--text-secondary)', fontSize: 14 }}>Sljedeći dodijeljeni radnici su danas prisutni u šihtarici. Proknjižiti im današnji dan na ovaj nalog?</p>
                <ul style={{ margin: 0, paddingLeft: 20, color: 'var(--text-primary)', fontSize: 14, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {bookToday?.workers.map(w => <li key={w.workerId}>{w.workerName}</li>)}
                </ul>
            </Modal>
        </div>,
        document.body
    );
}

// ════════════════════════════════════════════════════════════════════
// TAB: PREGLED
// ════════════════════════════════════════════════════════════════════
function PregledTab({ ov, cost, fmt, fmt0, marginClass }: {
    ov: ProjectOverview; cost: number; fmt: (n: number) => string; fmt0: (n: number) => string; marginClass: string;
}) {
    const fin = ov.financial;
    const allocSegments = [
        { key: 'material', label: 'Materijal', value: fin.material, color: COLORS.material },
        { key: 'labor', label: 'Rad', value: fin.labor, color: COLORS.labor },
        { key: 'services', label: 'Usluge', value: fin.services, color: COLORS.services },
        { key: 'transport', label: 'Transport', value: fin.transport, color: COLORS.transport },
        { key: 'other', label: 'Ostalo', value: fin.other, color: COLORS.transport },
    ].filter(s => s.value > 0.005);
    if (fin.profit >= 0) allocSegments.push({ key: 'profit', label: 'Profit', value: fin.profit, color: COLORS.profit });
    const costSegments = allocSegments.filter(s => s.key !== 'profit');
    const denom = Math.max(fin.revenue, cost, 1);

    return (
        <div className="pov-pregled">
            <div className="pov-kpis">
                <div className="pov-kpi accent">
                    <div className="pov-kpi-icon"><Wallet size={19} /></div>
                    <div className="pov-kpi-body">
                        <span className="pov-kpi-label">Klijent plaća</span>
                        <span className="pov-kpi-value">{fmt(fin.revenue)}</span>
                        {ov.acceptedOffer
                            ? <span className="pov-kpi-sub">Ponuda {ov.acceptedOffer.offerNumber ? `#${ov.acceptedOffer.offerNumber}` : ''}{ov.acceptedOffer.includePDV ? ` · s PDV` : ''}</span>
                            : fin.missingPrice
                                ? <span className="pov-kpi-sub warn"><AlertTriangle size={12} /> neki bez cijene</span>
                                : <span className="pov-kpi-sub">prihod projekta</span>}
                    </div>
                </div>
                <div className="pov-kpi">
                    <div className="pov-kpi-icon"><Coins size={19} /></div>
                    <div className="pov-kpi-body">
                        <span className="pov-kpi-label">Ukupni trošak</span>
                        <span className="pov-kpi-value">{fmt(cost)}</span>
                        <span className="pov-kpi-sub">Mat {fmt0(fin.material)} · Rad {fmt0(fin.labor)}</span>
                    </div>
                </div>
                <div className={`pov-kpi ${marginClass}`}>
                    <div className="pov-kpi-icon">{fin.profit < 0 ? <TrendingDown size={19} /> : <TrendingUp size={19} />}</div>
                    <div className="pov-kpi-body">
                        <span className="pov-kpi-label">{fin.profit < 0 ? 'Gubitak' : 'Profit'}</span>
                        <span className="pov-kpi-value">{fmt(fin.profit)}</span>
                        {ov.hasPlan
                            ? <span className="pov-kpi-sub">plan {fmt(ov.plannedProfit)}</span>
                            : <span className="pov-kpi-sub">nakon svih troškova</span>}
                    </div>
                </div>
                <div className={`pov-kpi ${marginClass}`}>
                    <Ring pct={fin.margin} label={`${Math.round(fin.margin)}%`} colorClass={marginClass} />
                    <div className="pov-kpi-body">
                        <span className="pov-kpi-label">Marža</span>
                        <span className="pov-kpi-sub">{ov.counts.products} proizv. · {ov.counts.workOrders} nal.</span>
                        <span className="pov-kpi-sub">{ov.counts.workers} radnika · {fmt0(ov.counts.totalWorkerDays)} dana</span>
                    </div>
                </div>
            </div>

            <section className="pov-card pov-hero-card">
                <div className="pov-card-head">
                    <h3>Gdje ide svaki KM koji klijent plaća</h3>
                    <span className="pov-card-sub">{fmt(fin.revenue)} → trošak {fmt(cost)} · {fin.profit < 0 ? 'gubitak' : 'profit'} {fmt(Math.abs(fin.profit))}</span>
                </div>
                <div className="pov-alloc">
                    <div className="pov-alloc-track">
                        {allocSegments.map(seg => {
                            const pct = (seg.value / denom) * 100;
                            return pct > 0 ? (
                                <div key={seg.key} className="pov-alloc-seg" style={{ width: `${pct}%`, background: seg.color }}
                                    title={`${seg.label}: ${fmt(seg.value)} (${Math.round((seg.value / denom) * 100)}%)`} />
                            ) : null;
                        })}
                    </div>
                    <div className="pov-alloc-legend">
                        {allocSegments.map(seg => (
                            <div key={seg.key} className="pov-legend-item">
                                <span className="pov-legend-dot" style={{ background: seg.color }} />
                                <span className="pov-legend-label">{seg.label}</span>
                                <span className="pov-legend-value">{fmt(seg.value)}</span>
                                <span className="pov-legend-pct">{Math.round((seg.value / denom) * 100)}%</span>
                            </div>
                        ))}
                        {fin.profit < 0 && (
                            <div className="pov-legend-item">
                                <span className="pov-legend-dot" style={{ background: COLORS.loss }} />
                                <span className="pov-legend-label">Gubitak</span>
                                <span className="pov-legend-value">{fmt(Math.abs(fin.profit))}</span>
                            </div>
                        )}
                    </div>
                </div>
            </section>

            <div className="pov-grid-2">
                <section className="pov-card">
                    <div className="pov-card-head"><h3>{ov.hasPlan ? 'Plan (ponuda) vs stvarno' : 'Struktura troška'}</h3></div>
                    {ov.hasPlan ? (
                        <div className="pov-pva">
                            <PvARow label="Materijal" planned={ov.plannedMaterial} actual={fin.material} fmt={fmt} invert />
                            <PvARow label="Rad" planned={ov.plannedLabor} actual={fin.labor} fmt={fmt} invert />
                            <PvARow label="Profit" planned={ov.plannedProfit} actual={fin.profit} fmt={fmt} />
                        </div>
                    ) : costSegments.length === 0 ? (
                        <span className="pov-empty-inline">Nema evidentiranih troškova.</span>
                    ) : (
                        <div className="pov-costbars">
                            {costSegments.map(seg => (
                                <div key={seg.key} className="pov-costbar">
                                    <div className="pov-costbar-top">
                                        <span className="pov-costbar-label"><span className="pov-legend-dot" style={{ background: seg.color }} />{seg.label}</span>
                                        <span className="pov-costbar-value">{fmt(seg.value)} <span className="pov-costbar-pct">{cost > 0 ? Math.round((seg.value / cost) * 100) : 0}%</span></span>
                                    </div>
                                    <div className="pov-costbar-track"><div className="pov-costbar-fill" style={{ width: `${cost > 0 ? (seg.value / cost) * 100 : 0}%`, background: seg.color }} /></div>
                                </div>
                            ))}
                        </div>
                    )}
                </section>

                <section className="pov-card">
                    <div className="pov-card-head"><h3>Sažetak</h3></div>
                    <ul className="pov-summary-list">
                        <li><span>Proizvoda</span><b>{ov.counts.products}</b></li>
                        <li><span>U proizvodnji</span><b>{ov.counts.productsInProduction}</b></li>
                        <li><span>Radnih naloga</span><b>{ov.counts.workOrders}</b></li>
                        <li><span>Radnika</span><b>{ov.counts.workers}</b></li>
                        <li><span>Radnih dana</span><b>{fmt0(ov.counts.totalWorkerDays)}</b></li>
                    </ul>
                    {fin.missingPrice && (
                        <div className="pov-note warn"><AlertTriangle size={14} /> Neki proizvodi nemaju prodajnu cijenu — profit je nepotpun (uloženi rad se prikazuje kao gubitak).</div>
                    )}
                </section>
            </div>
        </div>
    );
}

// ════════════════════════════════════════════════════════════════════
// TAB: PROIZVODI (svi + selekcija → nalog)
// ════════════════════════════════════════════════════════════════════
function ProizvodiTab({ ov, fmt, onCreateWorkOrder }: {
    ov: ProjectOverview; fmt: (n: number) => string; onCreateWorkOrder?: (productIds: string[]) => void;
}) {
    const compact = useIsCompact();
    const [open, setOpen] = useState<Set<string>>(new Set());
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const maxRevenue = Math.max(1, ...ov.products.map(p => Math.abs(p.revenue) || p.material));

    if (ov.products.length === 0) return <EmptyState icon="inventory_2" text="Ovaj projekat još nema proizvoda." />;

    const selectable = ov.products.filter(p => !p.isCustom);
    const toggleSel = (id: string) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
    const toggleOpen = (id: string) => setOpen(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

    // ── Kartični prikaz (tablet + mobitel) ──────────────────────────────
    const selBar = onCreateWorkOrder && selected.size > 0 && (
        <div className="pov-selbar">
            <span className="pov-selbar-info">{selected.size} od {selectable.length} odabrano</span>
            <div className="pov-selbar-actions">
                <button className="pov-btn-ghost" onClick={() => setSelected(new Set())}>Poništi</button>
                <button className="pov-btn-ghost" onClick={() => setSelected(new Set(selectable.map(p => p.productId)))}>Svi</button>
                <button className="pov-btn-primary" onClick={() => onCreateWorkOrder(Array.from(selected))}>
                    <Hammer size={16} /> Kreiraj nalog
                </button>
            </div>
        </div>
    );

    if (compact) {
        return (
            <div className="pov-mlist">
                {ov.products.map(p => {
                    const isOpen = open.has(p.productId);
                    const mc = p.notInProduction ? '' : p.profit < 0 ? 'bad' : p.margin >= 30 ? 'good' : p.margin >= 15 ? 'mid' : 'bad';
                    const isSel = selected.has(p.productId);
                    const noRev = p.notInProduction || (p.missingPrice && p.revenue === 0);
                    return (
                        <div key={p.productId} className={`pov-mcard ${p.notInProduction ? 'muted' : ''} ${isSel ? 'sel' : ''}`}>
                            <div className="pov-mcard-head" onClick={() => toggleOpen(p.productId)}>
                                {onCreateWorkOrder && !p.isCustom && (
                                    <button className="pov-mcard-check" onClick={(e) => { e.stopPropagation(); toggleSel(p.productId); }} aria-label="Odaberi za nalog">
                                        {isSel ? <CheckSquare size={20} className="pov-check on" /> : <Square size={20} className="pov-check" />}
                                    </button>
                                )}
                                <div className="pov-mcard-title">
                                    <div className="pov-mcard-name">{p.productName}</div>
                                    <div className="pov-mcard-badges">
                                        {p.isCustom && <span className="pov-tag custom">razni</span>}
                                        {p.notInProduction && <span className="pov-tag wait">nije u nalogu</span>}
                                        <span className={`pov-chip s-${statusSlug(p.status)}`}>{p.status}</span>
                                        {p.quantity ? <span className="pov-mcard-qty">×{p.quantity}</span> : null}
                                    </div>
                                </div>
                                <ChevronRight size={18} className={`pov-chev ${isOpen ? 'open' : ''}`} />
                            </div>
                            <div className="pov-mcard-figs">
                                <div className="pov-fig"><span>Cijena</span><b>{noRev ? '—' : fmt(p.revenue)}</b></div>
                                <div className="pov-fig"><span>{p.profit < 0 ? 'Gubitak' : 'Profit'}</span><b className={mc}>{p.notInProduction ? '—' : fmt(p.profit)}</b></div>
                                <div className="pov-fig"><span>Marža</span><b className={mc}>{p.notInProduction ? '—' : `${Math.round(p.margin)}%`}</b></div>
                            </div>
                            {isOpen && (
                                <div className="pov-mcard-detail">
                                    <Detail label="Materijal" value={fmt(p.material)} />
                                    {!p.notInProduction && <Detail label="Rad" value={fmt(p.labor)} />}
                                    {p.other > 0 && <Detail label="Ostali troškovi" value={fmt(p.other)} />}
                                    <Detail label="Usluge" value={fmt(p.services)} />
                                    <Detail label="Transport" value={fmt(p.transport)} />
                                    <Detail label="Radnih dana" value={`${p.workerDays}`} />
                                    <Detail label="Radnika" value={`${p.workerCount}`} />
                                    <Detail label="Nalozi" value={p.workOrderNumbers.join(', ') || '—'} />
                                    {ov.hasPlan && !p.notInProduction && <Detail label="Plan rad" value={fmt(p.plannedLabor)} />}
                                </div>
                            )}
                        </div>
                    );
                })}
                <div className="pov-mcard total">
                    <div className="pov-mcard-name">Ukupno (u proizvodnji)</div>
                    <div className="pov-mcard-figs">
                        <div className="pov-fig"><span>Prihod</span><b>{fmt(ov.financial.revenue)}</b></div>
                        <div className="pov-fig"><span>Profit</span><b>{fmt(ov.financial.profit)}</b></div>
                        <div className="pov-fig"><span>Marža</span><b>{Math.round(ov.financial.margin)}%</b></div>
                    </div>
                </div>
                {selBar}
            </div>
        );
    }

    // ── Tabela (desktop ≥1024) ──────────────────────────────────────────
    return (
        <div className="pov-card pov-table-card">
            <div className="pov-table-wrap">
                <table className="pov-table">
                    <thead>
                        <tr>
                            {onCreateWorkOrder && <th className="c pov-sel-col" />}
                            <th>Proizvod</th>
                            <th className="c hide-sm">Kol.</th>
                            <th className="c">Status</th>
                            <th className="r">Cijena</th>
                            <th className="r hide-md">Materijal</th>
                            <th className="r hide-md">Rad</th>
                            <th className="r hl">Profit</th>
                            <th className="r hide-sm">Marža</th>
                            <th className="c" />
                        </tr>
                    </thead>
                    <tbody>
                        {ov.products.map(p => {
                            const isOpen = open.has(p.productId);
                            const mc = p.notInProduction ? '' : p.profit < 0 ? 'bad' : p.margin >= 30 ? 'good' : p.margin >= 15 ? 'mid' : 'bad';
                            const isSel = selected.has(p.productId);
                            return (
                                <Fragment key={p.productId}>
                                    <tr className={`pov-row ${isOpen ? 'open' : ''} ${p.notInProduction ? 'muted' : ''}`}
                                        onClick={() => setOpen(prev => { const n = new Set(prev); n.has(p.productId) ? n.delete(p.productId) : n.add(p.productId); return n; })}>
                                        {onCreateWorkOrder && (
                                            <td className="c pov-sel-col" onClick={(e) => { e.stopPropagation(); if (!p.isCustom) toggleSel(p.productId); }}>
                                                {!p.isCustom && (isSel ? <CheckSquare size={18} className="pov-check on" /> : <Square size={18} className="pov-check" />)}
                                            </td>
                                        )}
                                        <td>
                                            <div className="pov-prod-name">
                                                {p.isCustom && <span className="pov-tag custom">razni</span>}
                                                {p.notInProduction && <span className="pov-tag wait">nije u nalogu</span>}
                                                {p.productName}
                                            </div>
                                            <div className="pov-barline">
                                                <div className="pov-barline-fill" style={{ width: `${((Math.abs(p.revenue) || p.material) / maxRevenue) * 100}%`, background: p.notInProduction ? 'var(--border)' : p.profit < 0 ? COLORS.loss : COLORS.material }} />
                                            </div>
                                        </td>
                                        <td className="c hide-sm">{p.quantity || '—'}</td>
                                        <td className="c"><span className={`pov-chip s-${statusSlug(p.status)}`}>{p.status}</span></td>
                                        <td className="r fw">{p.notInProduction || (p.missingPrice && p.revenue === 0) ? '—' : fmt(p.revenue)}</td>
                                        <td className="r dim hide-md">{fmt(p.material)}</td>
                                        <td className="r dim hide-md">{p.notInProduction ? '—' : fmt(p.labor)}</td>
                                        <td className={`r hl fw ${mc}`}>{p.notInProduction ? '—' : fmt(p.profit)}</td>
                                        <td className={`r hide-sm ${mc}`}>{p.notInProduction ? '—' : `${Math.round(p.margin)}%`}</td>
                                        <td className="c"><ChevronRight size={16} className={`pov-chev ${isOpen ? 'open' : ''}`} /></td>
                                    </tr>
                                    {isOpen && (
                                        <tr className="pov-detail-row">
                                            <td colSpan={onCreateWorkOrder ? 10 : 9}>
                                                <div className="pov-detail-grid">
                                                    <Detail label="Materijal" value={fmt(p.material)} />
                                                    {!p.notInProduction && <Detail label="Rad" value={fmt(p.labor)} />}
                                                    {!p.notInProduction && <Detail label="Marža" value={`${Math.round(p.margin)}%`} />}
                                                    <Detail label="Usluge" value={fmt(p.services)} />
                                                    <Detail label="Transport" value={fmt(p.transport)} />
                                                    <Detail label="Radnih dana" value={`${p.workerDays}`} />
                                                    <Detail label="Radnika" value={`${p.workerCount}`} />
                                                    <Detail label="Nalozi" value={p.workOrderNumbers.join(', ') || '—'} />
                                                    {ov.hasPlan && !p.notInProduction && <Detail label="Plan rad" value={fmt(p.plannedLabor)} />}
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </Fragment>
                            );
                        })}
                    </tbody>
                    <tfoot>
                        <tr>
                            {onCreateWorkOrder && <td className="pov-sel-col" />}
                            <td className="fw">Ukupno (u proizvodnji)</td>
                            <td className="hide-sm" /><td />
                            <td className="r fw">{fmt(ov.financial.revenue)}</td>
                            <td className="r fw hide-md">{fmt(ov.financial.material)}</td>
                            <td className="r fw hide-md">{fmt(ov.financial.labor)}</td>
                            <td className="r hl fw">{fmt(ov.financial.profit)}</td>
                            <td className="r fw hide-sm">{Math.round(ov.financial.margin)}%</td>
                            <td />
                        </tr>
                    </tfoot>
                </table>
            </div>

            {onCreateWorkOrder && selected.size > 0 && (
                <div className="pov-selbar">
                    <span className="pov-selbar-info">{selected.size} od {selectable.length} odabrano</span>
                    <div className="pov-selbar-actions">
                        <button className="pov-btn-ghost" onClick={() => setSelected(new Set())}>Poništi</button>
                        <button className="pov-btn-ghost" onClick={() => setSelected(new Set(selectable.map(p => p.productId)))}>Odaberi sve</button>
                        <button className="pov-btn-primary" onClick={() => onCreateWorkOrder(Array.from(selected))}>
                            <Hammer size={16} /> Kreiraj radni nalog
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

// ════════════════════════════════════════════════════════════════════
// TAB: MATERIJALI (+ narudžbe)
// ════════════════════════════════════════════════════════════════════
function MaterijaliTab({ ov, project, fmt, orders, orderable, canOrder, onCreateOrders }: {
    ov: ProjectOverview; project: Project; fmt: (n: number) => string; orders: Order[];
    orderable: OrderableMaterial[]; canOrder: boolean;
    onCreateOrders: (ids: Set<string>, mode: 'single' | 'supplier' | 'category') => Promise<void>;
}) {
    const compact = useIsCompact();
    const [filter, setFilter] = useState<string>('');
    const [orderModal, setOrderModal] = useState(false);
    const [openOrders, setOpenOrders] = useState<Set<string>>(new Set());
    const [openMat, setOpenMat] = useState<Set<string>>(new Set());
    const counts = useMemo(() => ({
        total: ov.materials.length,
        notOrdered: ov.materials.filter(m => m.status === 'Nije naručeno').length,
        ordered: ov.materials.filter(m => m.status === 'Naručeno').length,
        ready: ov.materials.filter(m => m.status === 'Primljeno' || m.status === 'Na stanju').length,
    }), [ov.materials]);
    const rows = filter ? ov.materials.filter(m => m.status === filter) : ov.materials;
    const fmtQty = (v: number, u: string) => `${v % 1 === 0 ? v : v.toFixed(2)} ${u}`;

    if (ov.materials.length === 0 && orders.length === 0) return <EmptyState icon="inventory_2" text="Nijedan proizvod ovog projekta nema unesene materijale." />;

    return (
        <div className="pov-materijali">
            <div className="pov-card pov-table-card">
                <div className="pov-mat-toolbar">
                    <div className="pov-filter-chips">
                        <button className={`pov-fchip ${filter === '' ? 'on' : ''}`} onClick={() => setFilter('')}>Svi ({counts.total})</button>
                        {counts.notOrdered > 0 && <button className={`pov-fchip danger ${filter === 'Nije naručeno' ? 'on' : ''}`} onClick={() => setFilter('Nije naručeno')}>Čeka ({counts.notOrdered})</button>}
                        {counts.ordered > 0 && <button className={`pov-fchip warning ${filter === 'Naručeno' ? 'on' : ''}`} onClick={() => setFilter('Naručeno')}>Naručeno ({counts.ordered})</button>}
                        {counts.ready > 0 && <button className={`pov-fchip success ${filter === 'Primljeno' ? 'on' : ''}`} onClick={() => setFilter('Primljeno')}>Spremno ({counts.ready})</button>}
                    </div>
                    <div className="pov-mat-toolbar-right">
                        <span className="pov-mat-total">Vrijednost: <b>{fmt(ov.materialCatalogCost)}</b></span>
                        {canOrder && (
                            <button className="pov-btn-primary sm" onClick={() => setOrderModal(true)}>
                                <ShoppingCart size={15} /> Naruči materijale ({orderable.length})
                            </button>
                        )}
                    </div>
                </div>
                {rows.length === 0 ? (
                    <div className="pov-empty"><span className="material-icons-round">filter_alt_off</span><p>Nema materijala u ovom filteru.</p></div>
                ) : compact ? (
                    <div className="pov-mlist pov-mlist-inset">
                        {rows.map((m, i) => {
                            const isOpen = openMat.has(m.materialId || String(i));
                            const key = m.materialId || String(i);
                            return (
                                <div key={key} className="pov-mcard">
                                    <div className="pov-mcard-head" onClick={() => setOpenMat(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; })}>
                                        <div className="pov-mcard-title">
                                            <div className="pov-mcard-name">{m.name}</div>
                                            {m.products.length > 0 && <div className="pov-mcard-sub">{m.products.length === 1 ? m.products[0] : `${m.products.length} proizvoda`}</div>}
                                        </div>
                                        <span className={`pov-chip ${matStatusClass(m.status)}`}>{m.status}</span>
                                        <ChevronRight size={18} className={`pov-chev ${isOpen ? 'open' : ''}`} />
                                    </div>
                                    <div className="pov-mcard-figs">
                                        <div className="pov-fig"><span>Potrebno</span><b>{fmtQty(m.needed, m.unit)}</b></div>
                                        <div className="pov-fig"><span>Preostalo</span><b style={{ color: m.remaining > 0 ? 'var(--error)' : 'var(--success)' }}>{fmtQty(m.remaining, m.unit)}</b></div>
                                        <div className="pov-fig"><span>Vrijednost</span><b>{fmt(m.lineCost)}</b></div>
                                    </div>
                                    {isOpen && (
                                        <div className="pov-mcard-detail">
                                            <Detail label="Na stanju" value={fmtQty(m.onStock, m.unit)} />
                                            <Detail label="Naručeno" value={fmtQty(m.ordered, m.unit)} />
                                            <Detail label="Primljeno" value={fmtQty(m.received, m.unit)} />
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="pov-table-wrap">
                        <table className="pov-table">
                            <thead>
                                <tr>
                                    <th>Materijal</th>
                                    <th className="r hide-sm">Potrebno</th>
                                    <th className="r hide-md">Na stanju</th>
                                    <th className="r hide-md">Naručeno</th>
                                    <th className="r hide-md">Primljeno</th>
                                    <th className="r hl">Preostalo</th>
                                    <th className="r hide-sm">Vrijednost</th>
                                    <th className="c">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((m, i) => (
                                    <tr key={m.materialId || i}>
                                        <td>
                                            <div className="pov-mat-name">{m.name}</div>
                                            {m.products.length > 0 && <div className="pov-mat-sub" title={m.products.join(', ')}>{m.products.length === 1 ? m.products[0] : `${m.products.length} proizvoda`}</div>}
                                        </td>
                                        <td className="r fw hide-sm">{fmtQty(m.needed, m.unit)}</td>
                                        <td className="r dim hide-md">{fmtQty(m.onStock, m.unit)}</td>
                                        <td className="r dim hide-md">{fmtQty(m.ordered, m.unit)}</td>
                                        <td className="r dim hide-md">{fmtQty(m.received, m.unit)}</td>
                                        <td className="r hl"><span style={{ color: m.remaining > 0 ? 'var(--error)' : 'var(--success)', fontWeight: 700 }}>{fmtQty(m.remaining, m.unit)}</span></td>
                                        <td className="r dim hide-sm">{fmt(m.lineCost)}</td>
                                        <td className="c"><span className={`pov-chip ${matStatusClass(m.status)}`}>{m.status}</span></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Narudžbe projekta */}
            <section className="pov-card">
                <div className="pov-card-head">
                    <h3>Narudžbe projekta</h3>
                    <span className="pov-card-sub">{orders.length} {orders.length === 1 ? 'narudžba' : 'narudžbi'}</span>
                </div>
                {orders.length === 0 ? (
                    <div className="pov-empty-inline">Nema narudžbi za ovaj projekat.</div>
                ) : (
                    <div className="pov-order-list">
                        {orders.map(o => {
                            const items = o.items || [];
                            const isOpen = openOrders.has(o.Order_ID);
                            return (
                                <div key={o.Order_ID} className={`pov-order-wrap ${isOpen ? 'open' : ''}`}>
                                    <div className="pov-order-row" onClick={() => setOpenOrders(prev => { const n = new Set(prev); n.has(o.Order_ID) ? n.delete(o.Order_ID) : n.add(o.Order_ID); return n; })}>
                                        <div className="pov-order-main">
                                            <ChevronRight size={16} className={`pov-chev ${isOpen ? 'open' : ''}`} />
                                            {/* Projekat vodi, dobavljač je drugi. Interni ID narudžbe se
                                                NE prikazuje — čita se samo na samoj narudžbi/PDF-u. */}
                                            <span className="pov-order-name">{project.Name || project.Client_Name}</span>
                                            {o.Supplier_Name && <span className="pov-order-supplier">{o.Supplier_Name}</span>}
                                            <span className={`pov-chip s-${orderStatusSlug(o.Status)}`}>{o.Status}</span>
                                        </div>
                                        <div className="pov-order-meta">
                                            <span>{items.length} {items.length === 1 ? 'stavka' : 'stavki'}</span>
                                            {o.Expected_Delivery && <><span className="pov-dot">•</span><span>Isporuka: {formatDate(o.Expected_Delivery)}</span></>}
                                            <span className="pov-dot">•</span><b>{fmt(o.Total_Amount || 0)}</b>
                                        </div>
                                    </div>
                                    {isOpen && (
                                        <div className="pov-order-items">
                                            {items.length === 0 ? (
                                                <div className="pov-order-item empty">Nema stavki.</div>
                                            ) : (() => {
                                                // Legacy auto-narudžbe su Expected_Price spremile kao JEDINIČNU
                                                // cijenu — bez ovoga red pokazuje 3.000 KM za 0.08 m³.
                                                const pricing = orderItemPricing(o);
                                                return items.map(it => (
                                                    <div key={it.ID} className="pov-order-item">
                                                        <div className="pov-order-item-main">
                                                            <span className="pov-order-item-name">{it.Material_Name}</span>
                                                            <span className="pov-order-item-sub">
                                                                {it.Quantity % 1 === 0 ? it.Quantity : it.Quantity.toFixed(2)} {it.Unit} × {fmt(pricing.unitPrice(it))}
                                                                {it.Product_Name ? ` · ${it.Product_Name}` : ''}
                                                            </span>
                                                        </div>
                                                        <span className={`pov-chip ${matStatusClass(it.Status)}`}>{it.Status}</span>
                                                        <b className="pov-order-item-price">{fmt(pricing.lineTotal(it))}</b>
                                                    </div>
                                                ));
                                            })()}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </section>

            {orderModal && <OrderCreateDialog orderable={orderable} fmt={fmt} onClose={() => setOrderModal(false)} onConfirm={async (ids, mode) => { setOrderModal(false); await onCreateOrders(ids, mode); }} />}
        </div>
    );
}

// Modal za kreiranje narudžbi iz odabranih materijala.
function OrderCreateDialog({ orderable, fmt, onClose, onConfirm }: {
    orderable: OrderableMaterial[]; fmt: (n: number) => string;
    onClose: () => void; onConfirm: (ids: Set<string>, mode: 'single' | 'supplier' | 'category') => Promise<void>;
}) {
    const [selected, setSelected] = useState<Set<string>>(() => new Set(orderable.map(m => m.id)));
    const [mode, setMode] = useState<'single' | 'supplier' | 'category'>('supplier');
    const [saving, setSaving] = useState(false);

    const chosen = orderable.filter(m => selected.has(m.id));
    const orderCount = useMemo(() => {
        if (chosen.length === 0) return 0;
        if (mode === 'single') return 1;
        const keys = new Set(chosen.map(m => mode === 'supplier' ? (m.supplier || 'Nepoznat dobavljač') : (m.category || 'Ostalo')));
        return keys.size;
    }, [chosen, mode]);
    const total = chosen.reduce((s, m) => s + m.lineTotal, 0);
    const toggle = (id: string) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

    return (
        <Modal isOpen onClose={onClose} title="Naruči materijale" size="large"
            footer={<>
                <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Odustani</button>
                <button className="btn btn-primary" disabled={saving || chosen.length === 0} onClick={() => { setSaving(true); onConfirm(selected, mode); }}>
                    {saving ? 'Kreiram…' : `Kreiraj ${orderCount} ${orderCount === 1 ? 'narudžbu' : 'narudžbi'}`}
                </button>
            </>}>
            <div className="pov-ocd">
                <div className="pov-ocd-modes">
                    <span className="pov-ocd-label">Grupisanje</span>
                    <div className="pov-ocd-seg">
                        <button className={mode === 'single' ? 'on' : ''} onClick={() => setMode('single')}>Jedna narudžba</button>
                        <button className={mode === 'supplier' ? 'on' : ''} onClick={() => setMode('supplier')}>Po dobavljaču</button>
                        <button className={mode === 'category' ? 'on' : ''} onClick={() => setMode('category')}>Po kategoriji</button>
                    </div>
                </div>
                <div className="pov-ocd-list">
                    {orderable.map(m => {
                        const on = selected.has(m.id);
                        return (
                            <div key={m.id} className={`pov-ocd-item ${on ? 'on' : ''}`} onClick={() => toggle(m.id)}>
                                {on ? <CheckSquare size={18} className="pov-check on" /> : <Square size={18} className="pov-check" />}
                                <div className="pov-ocd-item-main">
                                    <span className="pov-ocd-item-name">{m.name}</span>
                                    <span className="pov-ocd-item-sub">{m.productName} · {m.supplier || 'bez dobavljača'} · {m.category}</span>
                                </div>
                                <div className="pov-ocd-item-qty">
                                    <span>{m.qtyToOrder % 1 === 0 ? m.qtyToOrder : m.qtyToOrder.toFixed(2)} {m.unit}</span>
                                    <b>{fmt(m.lineTotal)}</b>
                                </div>
                            </div>
                        );
                    })}
                </div>
                <div className="pov-ocd-summary">
                    <span>{chosen.length} materijal(a) → <b>{orderCount}</b> {orderCount === 1 ? 'narudžba' : 'narudžbi'}</span>
                    <b>{fmt(total)}</b>
                </div>
            </div>
        </Modal>
    );
}

// ════════════════════════════════════════════════════════════════════
// TAB: NALOZI
// ════════════════════════════════════════════════════════════════════
function NaloziTab({ ov, fmt, rawWorkOrders, workers, tasks, expandedId, onToggle, onUpdate, onStart, onPrint, onDelete, onRefresh, showToast }: {
    ov: ProjectOverview; fmt: (n: number) => string; rawWorkOrders: WorkOrder[]; workers: Worker[]; tasks: Task[];
    expandedId: string | null; onToggle: (id: string) => void;
    onUpdate: (id: string, updates: any) => Promise<void>; onStart: (id: string) => Promise<void>;
    onPrint: (wo: WorkOrder) => void; onDelete: (id: string) => Promise<void>;
    onRefresh: (...c: string[]) => void; showToast?: (m: string, t: 'success' | 'error' | 'info') => void;
}) {
    if (ov.workOrders.length === 0) return <EmptyState icon="assignment" text="Ovaj projekat još nema radnih naloga." />;
    return (
        <div className="pov-wo-list">
            {ov.workOrders.map(wo => {
                const isMontaza = wo.type === 'Montaža';
                const isExpanded = expandedId === wo.workOrderId;
                const rawWo = rawWorkOrders.find(w => w.Work_Order_ID === wo.workOrderId);
                const mc = wo.profit < 0 ? 'bad' : wo.margin >= 30 ? 'good' : wo.margin >= 15 ? 'mid' : 'bad';
                return (
                    <div key={wo.workOrderId} className={`pov-wo-card ${isExpanded ? 'expanded' : ''}`}>
                        <div className="pov-wo-head" onClick={() => onToggle(wo.workOrderId)}>
                            <div className="pov-wo-main">
                                <div className="pov-wo-titlerow">
                                    <ChevronRight size={17} className={`pov-chev ${isExpanded ? 'open' : ''}`} />
                                    <span className="pov-wo-name">{wo.name || `Nalog ${wo.number}`}</span>
                                    {wo.number && <span className="pov-wo-num">#{wo.number}</span>}
                                    {isMontaza && <span className="pov-tag montaza">Montaža</span>}
                                    {wo.type === 'Zadaci' && <span className="pov-tag custom">Zadaci</span>}
                                    <span className={`pov-chip s-${statusSlug(wo.status)}`}>{wo.status}</span>
                                </div>
                                <div className="pov-wo-dates">
                                    <span><b>{wo.itemCount}</b> {wo.itemCount === 1 ? 'stavka' : 'stavki'}</span>
                                    {wo.startedAt && <><span className="pov-dot">•</span><span>Početak: {formatDate(wo.startedAt)}</span></>}
                                    {wo.dueDate && <><span className="pov-dot">•</span><span>Rok: {formatDate(wo.dueDate)}</span></>}
                                    {wo.completedAt && <><span className="pov-dot">•</span><span>Završen: {formatDate(wo.completedAt)}</span></>}
                                </div>
                            </div>
                            <div className="pov-wo-fin">
                                {!isMontaza && <div className="pov-wo-fin-item"><span>Prihod</span><b>{fmt(wo.revenue)}</b></div>}
                                <div className="pov-wo-fin-item"><span>Trošak</span><b>{fmt(wo.material + wo.labor + wo.services + wo.transport)}</b></div>
                                <div className="pov-wo-fin-item"><span>{wo.profit < 0 ? 'Gubitak' : 'Profit'}</span><b className={mc}>{fmt(wo.profit)}</b></div>
                            </div>
                        </div>
                        {isExpanded && rawWo && (
                            <div className="pov-wo-detail">
                                <WorkOrderExpandedDetail
                                    layout="card"
                                    workOrder={rawWo}
                                    workers={workers}
                                    tasks={tasks}
                                    onUpdate={onUpdate}
                                    onStart={onStart}
                                    onPrint={onPrint}
                                    onDelete={onDelete}
                                    onRefresh={onRefresh}
                                    showToast={showToast}
                                />
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

// ════════════════════════════════════════════════════════════════════
// TAB: RADNICI (dnevni/sedmični rad)
// ════════════════════════════════════════════════════════════════════
function RadniciTab({ ov, fmt }: { ov: ProjectOverview; fmt: (n: number) => string }) {
    const [grain, setGrain] = useState<'day' | 'week'>('day');
    if (ov.workers.length === 0) return <EmptyState icon="engineering" text="Još nije evidentiran rad na ovom projektu." />;
    const maxCost = Math.max(1, ...ov.workers.map(w => w.cost));

    const dayBars = ov.laborByDay.map(d => ({ key: d.date, label: humanDay(d.date), value: d.labor, sub: `${d.workers}` }));
    const weekBars = ov.laborByWeek.map(w => ({ key: w.weekStart, label: humanDay(w.weekStart), value: w.labor, sub: '' }));
    const bars = grain === 'day' ? dayBars : weekBars;
    const maxBar = Math.max(1, ...bars.map(b => b.value));

    return (
        <div className="pov-radnici">
            <section className="pov-card">
                <div className="pov-card-head">
                    <h3>Trošak rada po radniku</h3>
                    <span className="pov-card-sub">Ukupno {fmt(ov.financial.labor)} · {ov.counts.workers} radnika · {ov.counts.totalWorkerDays} radnih dana</span>
                </div>
                <div className="pov-worker-list">
                    {ov.workers.map(w => (
                        <div key={w.workerId} className="pov-worker">
                            <div className="pov-worker-head">
                                <span className="pov-worker-name">{w.name}</span>
                                {w.role && <span className="pov-worker-role">{w.role}{w.type ? ` · ${w.type}` : ''}</span>}
                            </div>
                            <div className="pov-worker-bar"><div className="pov-worker-bar-fill" style={{ width: `${(w.cost / maxCost) * 100}%` }} /></div>
                            <div className="pov-worker-stats">
                                <span className="pov-worker-cost">{fmt(w.cost)}</span>
                                <span className="pov-worker-sub">{w.days} {w.days === 1 ? 'dan' : 'dana'} · ø {fmt(w.avgRate)}/dan · {w.productCount} {w.productCount === 1 ? 'proizvod' : 'proizvoda'}</span>
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            {bars.length > 0 && (
                <section className="pov-card">
                    <div className="pov-card-head">
                        <h3><CalendarDays size={16} style={{ verticalAlign: '-3px', marginRight: 6 }} />Rad kroz vrijeme</h3>
                        <div className="pov-ocd-seg small">
                            <button className={grain === 'day' ? 'on' : ''} onClick={() => setGrain('day')}>Dnevno</button>
                            <button className={grain === 'week' ? 'on' : ''} onClick={() => setGrain('week')}>Sedmično</button>
                        </div>
                    </div>
                    <div className="pov-trend">
                        {bars.map(b => (
                            <div key={b.key} className="pov-trend-col" title={`${b.label}: ${fmt(b.value)}${b.sub ? ` · ${b.sub} radnik(a)` : ''}`}>
                                <div className="pov-trend-bar-wrap">
                                    <div className="pov-trend-bar" style={{ height: `${(b.value / maxBar) * 100}%` }} />
                                </div>
                                <span className="pov-trend-label">{b.label}</span>
                            </div>
                        ))}
                    </div>
                </section>
            )}
        </div>
    );
}

// ════════════════════════════════════════════════════════════════════
// GRAFOVI / PRIMITIVI
// ════════════════════════════════════════════════════════════════════
function Ring({ pct, label, colorClass }: { pct: number; label: string; colorClass: string }) {
    const size = 52, thickness = 6;
    const r = (size - thickness) / 2;
    const cx = size / 2;
    const circ = 2 * Math.PI * r;
    const dash = (Math.max(0, Math.min(100, pct)) / 100) * circ;
    const color = colorClass === 'good' ? COLORS.profit : colorClass === 'mid' ? COLORS.labor : COLORS.loss;
    return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="pov-ring" role="img" aria-label="Marža">
            <circle cx={cx} cy={cx} r={r} fill="none" stroke="var(--surface-hover)" strokeWidth={thickness} />
            <circle cx={cx} cy={cx} r={r} fill="none" stroke={color} strokeWidth={thickness}
                strokeDasharray={`${dash} ${circ - dash}`} transform={`rotate(-90 ${cx} ${cx})`} strokeLinecap="round" />
            <text x={cx} y={cx + 5} textAnchor="middle" className="pov-ring-label" fill={color}>{label}</text>
        </svg>
    );
}

function PvARow({ label, planned, actual, fmt, invert }: {
    label: string; planned: number; actual: number; fmt: (n: number) => string; invert?: boolean;
}) {
    const max = Math.max(1, Math.abs(planned), Math.abs(actual));
    const good = invert ? actual <= planned : actual >= planned;
    return (
        <div className="pov-pva-row">
            <div className="pov-pva-label">{label}</div>
            <div className="pov-pva-bars">
                <div className="pov-pva-bar plan"><div style={{ width: `${(Math.abs(planned) / max) * 100}%` }} /><span>{fmt(planned)}</span></div>
                <div className="pov-pva-bar actual"><div style={{ width: `${(Math.abs(actual) / max) * 100}%`, background: good ? COLORS.profit : COLORS.loss }} /><span>{fmt(actual)}</span></div>
            </div>
        </div>
    );
}

function Detail({ label, value }: { label: string; value: string }) {
    return <div className="pov-detail"><span>{label}</span><b>{value}</b></div>;
}

function EmptyState({ icon, text }: { icon: string; text: string }) {
    return <div className="pov-empty"><span className="material-icons-round">{icon}</span><p>{text}</p></div>;
}

// ── Pomoćne ──────────────────────────────────────────────────────────
function statusSlug(status?: string): string {
    switch (status) {
        case 'U toku': case 'U proizvodnji': return 'progress';
        case 'Završeno': return 'done';
        case 'Otkazano': return 'cancel';
        case 'Na čekanju': return 'wait';
        case 'Odobreno': return 'approved';
        case 'Ponuđeno': return 'offered';
        default: return 'default';
    }
}
function orderStatusSlug(status?: string): string {
    switch (status) {
        case 'Primljeno': return 'done';
        case 'Poslano': return 'progress';
        default: return 'wait';
    }
}
function matStatusClass(status: string): string {
    switch (status) {
        case 'Primljeno': case 'Na stanju': return 's-done';
        case 'Naručeno': return 's-progress';
        default: return 's-wait';
    }
}
function humanDay(iso: string): string {
    const d = new Date(iso + 'T12:00:00');
    return `${d.getDate()}.${d.getMonth() + 1}.`;
}
