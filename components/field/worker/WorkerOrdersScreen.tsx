'use client';

// ════════════════════════════════════════════════════════════════════
// RADNIK — NALOZI
//
// Nalozi na kojima radnik ima nezavršenu stavku, GRUPISANI PO PROJEKTU.
// Projekti se ređaju kao u generalnom pregledu: prvo oni s najviše naloga
// U TOKU, pa oni s pauziranim, pa oni koji su tek u pripremi (na čekanju).
// Unutar projekta zadržava se pogonski poredak (šta se radi danas gore).
// Kartice su obojene po statusu (isto kao „Danas"). Otvaranje vodi u detalj.
// ════════════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import { ChevronRight, ClipboardList, ListChecks, Pause, Wrench } from 'lucide-react';
import type { FieldOrderRow } from '@/lib/field/fieldOrders';
import type { FieldProductDetail } from '@/lib/field/fieldProjects';
import { MLarge, MSearch, MChips, MSection, MEmpty, MButton } from '@/components/tabs/mobile/MobileUI';
import WorkerOrderDetail from './WorkerOrderDetail';
import type { ShowToast } from './WorkerApp';

type Filter = '' | 'today' | 'late' | 'paused';
type OrderTone = 'blue' | 'orange' | 'red' | 'green' | 'gray';

/** Boja kartice = status naloga (isto mapiranje kao „Danas"). */
function orderTone(o: FieldOrderRow): OrderTone {
    if (o.progressPct >= 100) return 'green';
    if (o.isPaused) return 'orange';
    if (o.status === 'Na čekanju') return 'gray';
    if ((o.daysUntilDue ?? 99) <= 0) return 'red';
    return 'blue';
}

function dueLabel(days: number | null): { text: string; cls: string } | null {
    if (days === null) return null;
    if (days < 0) return { text: `kasni ${-days} ${-days === 1 ? 'dan' : 'dana'}`, cls: 'late' };
    if (days === 0) return { text: 'rok danas', cls: 'soon' };
    if (days <= 2) return { text: `rok za ${days} ${days === 1 ? 'dan' : 'dana'}`, cls: 'soon' };
    return { text: `rok za ${days} dana`, cls: '' };
}

interface OrderGroup {
    projectId: string;
    projectName: string;
    orders: FieldOrderRow[];
    activeCount: number;             // rank 0/1 — u toku
    pausedCount: number;             // rank 2 — pauzirano
    noProject: boolean;
}

/**
 * Grupiši (već sortirane) naloge po projektu i poređaj grupe kao generalni
 * pregled: najviše naloga u toku → pauzirani → u pripremi na kraj. Nalozi bez
 * projekta idu u „Ostalo" na samo dno.
 */
function groupOrders(orders: FieldOrderRow[]): OrderGroup[] {
    const map = new Map<string, OrderGroup>();
    for (const o of orders) {
        const noProject = !o.projectId && !o.projectName;
        const key = noProject ? '__none__' : (o.projectId || o.projectName);
        let g = map.get(key);
        if (!g) {
            g = {
                projectId: key,
                projectName: noProject ? 'Ostalo' : (o.projectName || `#${o.number}`),
                orders: [], activeCount: 0, pausedCount: 0, noProject,
            };
            map.set(key, g);
        }
        g.orders.push(o);
        if (o.rank <= 1) g.activeCount++;
        else if (o.rank === 2) g.pausedCount++;
    }
    return [...map.values()].sort((a, b) => {
        if (a.noProject !== b.noProject) return a.noProject ? 1 : -1;
        return b.activeCount - a.activeCount
            || b.pausedCount - a.pausedCount
            || a.projectName.localeCompare(b.projectName, 'bs');
    });
}

interface Props {
    orders: FieldOrderRow[];
    loading: boolean;
    error: string | null;
    reload: () => void;
    productById: Map<string, FieldProductDetail>;
    previewUid?: string | null;
    showToast: ShowToast;
}

export default function WorkerOrdersScreen({ orders, loading, error, reload, productById, previewUid, showToast }: Props) {
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState<Filter>('');
    const [openId, setOpenId] = useState<string | null>(null);

    const counts = useMemo(() => ({
        today: orders.filter(o => o.rank === 0).length,
        late: orders.filter(o => (o.daysUntilDue ?? 99) < 0).length,
        paused: orders.filter(o => o.isPaused).length,
    }), [orders]);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return orders.filter(o => {
            if (q && !o.name.toLowerCase().includes(q) && !o.number.toLowerCase().includes(q)
                && !o.projectName.toLowerCase().includes(q)) return false;
            if (filter === 'today') return o.rank === 0;
            if (filter === 'late') return (o.daysUntilDue ?? 99) < 0;
            if (filter === 'paused') return o.isPaused;
            return true;
        });
    }, [orders, search, filter]);

    const groups = useMemo(() => groupOrders(filtered), [filtered]);

    if (openId) {
        return (
            <WorkerOrderDetail
                orderId={openId}
                productById={productById}
                previewUid={previewUid}
                showToast={showToast}
                onClose={() => setOpenId(null)}
            />
        );
    }

    return (
        <>
            <MLarge title="Nalozi">
                {orders.length} {orders.length === 1 ? 'nalog' : 'naloga'}
                {counts.today > 0 && <span className="mui-dim">· {counts.today} u radu danas</span>}
            </MLarge>

            <div className="fld-search">
                <MSearch value={search} onChange={setSearch} placeholder="Traži nalog ili projekat…" />
            </div>

            <MChips<Filter>
                value={filter}
                onChange={setFilter}
                options={[
                    { id: '', label: 'Svi', count: orders.length },
                    { id: 'today', label: 'Danas', count: counts.today },
                    { id: 'late', label: 'Kasni', count: counts.late },
                    { id: 'paused', label: 'Pauzirano', count: counts.paused },
                ]}
            />

            {loading && orders.length === 0 && <div className="fld-loading">Učitavanje…</div>}

            {error && (
                <MEmpty title="Podaci nisu učitani" sub={error}>
                    <div style={{ width: '100%', paddingTop: 14 }}>
                        <MButton variant="filled" onClick={reload}>Pokušaj ponovo</MButton>
                    </div>
                </MEmpty>
            )}

            {!loading && !error && filtered.length === 0 && (
                <MEmpty
                    title="Nema naloga"
                    sub={search || filter ? 'Promijeni pretragu ili filter.' : 'Trenutno nemaš dodijeljen posao ni na jednom nalogu.'}
                />
            )}

            {groups.map(g => (
                <div key={g.projectId}>
                    <MSection title={g.projectName} right={<span className="mui-dim">{g.orders.length}</span>} />
                    <div className="fwk-jobs">
                        {g.orders.map(o => {
                            const tone = orderTone(o);
                            const due = dueLabel(o.daysUntilDue);
                            const isMontaza = o.type === 'Montaža';
                            return (
                                <button
                                    key={o.orderId}
                                    type="button"
                                    className={`fwk-job fwk-job--${tone}`}
                                    onClick={() => setOpenId(o.orderId)}
                                >
                                    <div className="fwk-job-top">
                                        <span className="fwk-job-ic">
                                            {o.isPaused ? <Pause size={19} />
                                                : isMontaza ? <Wrench size={19} /> : <ClipboardList size={19} />}
                                        </span>
                                        <div className="fwk-job-main">
                                            <span className="fwk-job-name">{o.name}</span>
                                            <span className="fwk-job-sub">
                                                {o.isPaused ? 'Pauziran' : o.status}
                                                {o.itemCount > 0 && ` · ${o.itemCount} ${o.itemCount === 1 ? 'proizvod' : 'proizvoda'}`}
                                            </span>
                                        </div>
                                        {o.openTasks > 0 && (
                                            <span className="fwk-job-badge" title={`${o.openTasks} otvorenih napomena`}>
                                                <ListChecks size={12} /> {o.openTasks}
                                            </span>
                                        )}
                                        <ChevronRight size={18} className="fwk-job-chev" />
                                    </div>

                                    <div className="fwk-job-foot">
                                        <b>{o.progressPct}%</b>
                                        {due && <span className={`fwk-job-due ${due.cls}`}>{due.text}</span>}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>
            ))}
        </>
    );
}
