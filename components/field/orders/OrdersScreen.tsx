'use client';

// ════════════════════════════════════════════════════════════════════
// NALOZI — lista
//
// Kartice su iste kao u vlasnikovom mobilnom prikazu (MobileWorkOrdersView):
// ikona po tipu, naziv, status-pločica, traka napretka i rok. Razlika je što
// ovdje podaci dolaze iz projekcije bez novca i što je poredak pogonski —
// prvo ono na čemu se danas radi, ne najnovije.
// ════════════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import { ClipboardList, ListChecks, Pause, Wrench } from 'lucide-react';
import type { FieldOrderRow } from '@/lib/field/fieldOrders';
import { useFieldOrders } from '@/lib/field/useFieldOrders';
import {
    MLarge, MSearch, MChips, MCard, MCardHead, MCardBody, MIcon,
    MPill, MProgress, MEmpty, MButton,
} from '@/components/tabs/mobile/MobileUI';
import OrderDetail from './OrderDetail';

type Filter = '' | 'today' | 'late' | 'paused';

function dueLabel(days: number | null): { text: string; cls: string } | null {
    if (days === null) return null;
    if (days < 0) return { text: `kasni ${-days} ${-days === 1 ? 'dan' : 'dana'}`, cls: 'late' };
    if (days === 0) return { text: 'rok danas', cls: 'soon' };
    if (days <= 2) return { text: `rok za ${days} ${days === 1 ? 'dan' : 'dana'}`, cls: 'soon' };
    return { text: `rok za ${days} dana`, cls: '' };
}

interface Props {
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
    readOnly?: boolean;
}

export default function OrdersScreen({ showToast, readOnly }: Props) {
    const { orders, loading, error, reload } = useFieldOrders();
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

    if (openId) {
        return (
            <OrderDetail
                orderId={openId}
                onClose={() => { setOpenId(null); reload(); }}
                showToast={showToast}
                readOnly={readOnly}
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
                    sub={search || filter ? 'Promijeni pretragu ili filter.' : 'Nema aktivnih naloga u proizvodnji.'}
                />
            )}

            <div className="mui-elist">
                {filtered.map(o => {
                    const due = dueLabel(o.daysUntilDue);
                    const isMontaza = o.type === 'Montaža';
                    const tone = o.isPaused ? 'orange' : o.status === 'Na čekanju' ? 'gray' : isMontaza ? 'purple' : 'blue';

                    return (
                        <MCard key={o.orderId} onClick={() => setOpenId(o.orderId)}>
                            <MCardHead>
                                <MIcon tone={tone}>
                                    {o.isPaused ? <Pause size={21} />
                                        : isMontaza ? <Wrench size={21} /> : <ClipboardList size={21} />}
                                </MIcon>
                                <MCardBody
                                    name={o.name}
                                    meta={<>
                                        <MPill tone={tone}>{o.isPaused ? 'Pauziran' : o.status}</MPill>
                                        <span>
                                            {o.projectName || `#${o.number}`}
                                            {o.itemCount > 0 && ` · ${o.itemCount} ${o.itemCount === 1 ? 'proizvod' : 'proizvoda'}`}
                                        </span>
                                    </>}
                                />
                                {o.openTasks > 0 && (
                                    <span className="fld-taskbadge" title={`${o.openTasks} otvorenih zadataka`}>
                                        <ListChecks size={13} /> {o.openTasks}
                                    </span>
                                )}
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
        </>
    );
}
