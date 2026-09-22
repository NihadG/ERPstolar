'use client';

// ════════════════════════════════════════════════════════════════════
// NARUDŽBE MATERIJALA — šta je naručeno i gdje se zaglavilo
//
// Komandni centar je do sada pokazivao šta TREBA naručiti (mjerač na
// poziciji), ali ne i šta je VEĆ naručeno. Odgovor na „gdje mi je ono od
// Frischeisa" tražio je izlazak s table u Narudžbe tab.
//
// Poredak je stanje-pa-rok, ne datum narudžbe:
//   KASNI → NACRT (niko je nije poslao) → POSLANO → PRIMLJENO (na dno)
// Nacrt je namjerno visoko: to je narudžba koju je neko napravio i
// zaboravio poslati — tiši propust od zakašnjele isporuke, ali isti trošak.
//
// Leća (puls) filtrira po ID-u narudžbe, isto kao kalendar — pod lećom
// koja ne govori o isporukama ova ploča se svjesno isprazni.
//
// Otvorena narudžba je tabela materijala; u uskoj desnoj koloni bila je
// zgužvana. Zato ploča JAVLJA kad je nešto otvoreno (`onOpenChange`), a
// raspored (lib/command/layout) tada daje ovoj koloni veći dio širine.
// ════════════════════════════════════════════════════════════════════

import { useMemo, useState, type ReactNode } from 'react';
import { ChevronRight, ShoppingCart, Truck } from 'lucide-react';
import type { Order } from '@/lib/types';
import { formatCurrency } from '@/lib/utils';
import type { BoardScope } from '@/lib/command/scope';
import { isPurchaseLate, type LensSelection } from '@/lib/command/signals';
import { groupOrderItems, productNamesLabel, productNamesResolver, type OrderItemGroup } from '@/lib/orderItemGroups';
import { hue, KcPanel, plural, qty, shortDate, SummaryBits } from './parts';

type Bucket = 'late' | 'draft' | 'sent' | 'received';

const BUCKETS: { id: Bucket; label: string }[] = [
    { id: 'late', label: 'Kasni' },
    { id: 'draft', label: 'Nacrt — nije poslano' },
    { id: 'sent', label: 'Poslano — čeka se' },
    { id: 'received', label: 'Primljeno' },
];

const STATUS_LABEL: Record<Bucket, string> = {
    late: 'Kasni',
    draft: 'Nacrt',
    sent: 'Poslano',
    received: 'Primljeno',
};

function bucketOf(order: Order, today: string): Bucket {
    if (order.Status === 'Primljeno') return 'received';
    if (isPurchaseLate(order, today)) return 'late';
    return order.Status === 'Nacrt' ? 'draft' : 'sent';
}

function statusClass(bucket: Bucket): string {
    if (bucket === 'late') return 's-late';
    if (bucket === 'received') return 's-done';
    return bucket === 'draft' ? 's-wait' : 's-running';
}

/** Projekti kojih se narudžba tiče, u redoslijedu table. */
function orderProjects(order: Order, scope: BoardScope): string[] {
    const seen = new Set<string>();
    for (const item of order.items || []) {
        if (item.Project_ID && scope.projectIds.has(item.Project_ID)) seen.add(item.Project_ID);
    }
    return Array.from(seen).sort((a, b) => (scope.order.get(a) ?? 0) - (scope.order.get(b) ?? 0));
}

export default function PurchaseOrdersPanel({
    scope, today, lens, showDone, create, onOpenChange, collapsed, onCollapse, pinned, onPin,
}: {
    scope: BoardScope;
    today: string;
    lens: LensSelection | null;
    showDone: boolean;
    /** „+ Narudžba" — meni projekata, dolazi iz ekrana. */
    create?: ReactNode;
    onOpenChange?: (open: boolean) => void;
    collapsed?: boolean;
    onCollapse?: () => void;
    pinned?: boolean;
    onPin?: () => void;
}) {
    const [openId, setOpenIdState] = useState<string | null>(null);
    const setOpenId = (id: string | null) => {
        setOpenIdState(id);
        onOpenChange?.(id !== null);
    };

    const grouped = useMemo(() => {
        const buckets = new Map<Bucket, Order[]>();
        for (const order of scope.orders) {
            if (lens && !lens.orderIds.has(order.Order_ID)) continue;
            const bucket = bucketOf(order, today);
            if (!showDone && bucket === 'received') continue;
            const list = buckets.get(bucket) || [];
            list.push(order);
            buckets.set(bucket, list);
        }
        // Unutar grupe: najbliži rok prvi, pa broj narudžbe — narudžba bez roka
        // ne smije preskočiti onu koja stiže sutra.
        for (const list of buckets.values()) {
            list.sort((a, b) =>
                (a.Expected_Delivery || '9999').localeCompare(b.Expected_Delivery || '9999')
                || (a.Order_Number || '').localeCompare(b.Order_Number || ''));
        }
        return buckets;
    }, [scope.orders, lens, showDone, today]);

    const total = Array.from(grouped.values()).reduce((sum, list) => sum + list.length, 0);
    const lateCount = grouped.get('late')?.length || 0;
    const count = (bucket: Bucket) => grouped.get(bucket)?.length || 0;

    return (
        <KcPanel
            id="purchases"
            eyebrow="ŠTA JE NARUČENO"
            title="Narudžbe"
            count={total}
            countTone={lateCount > 0 ? 'alert' : undefined}
            collapsed={collapsed}
            onCollapse={onCollapse}
            pinned={pinned}
            onPin={onPin}
            create={create}
            summary={(
                <SummaryBits bits={[
                    { label: lateCount > 0 ? `${lateCount} kasni` : '', tone: 'alert' },
                    { label: count('draft') > 0 ? `${count('draft')} nacrt` : '', tone: 'warn' },
                    { label: count('sent') > 0 ? `${count('sent')} u dolasku` : '' },
                ]} />
            )}
        >
            <div className="kc-panel-body">
                {total === 0 && (
                    <div className="kc-empty">
                        <ShoppingCart size={22} style={{ opacity: 0.45 }} />
                        <p>{lens ? 'Nema narudžbi u ovom prikazu.' : 'Nema otvorenih narudžbi.'}</p>
                        <span>Naruči dugmetom „Narudžba" — za cijeli projekat ili samo označene materijale.</span>
                    </div>
                )}
                {BUCKETS.map(bucket => {
                    const list = grouped.get(bucket.id);
                    if (!list || list.length === 0) return null;
                    return (
                        <div className="kc-group" key={bucket.id}>
                            <div className="kc-group-head">
                                <span
                                    className="kc-group-dot"
                                    style={{ background: bucket.id === 'late' ? 'var(--kc-late)' : 'var(--text-tertiary)' }}
                                />
                                <strong>{bucket.label}</strong>
                                <span>{list.length}</span>
                            </div>
                            {list.map(order => (
                                <PurchaseRow
                                    key={order.Order_ID}
                                    order={order}
                                    scope={scope}
                                    today={today}
                                    bucket={bucket.id}
                                    open={openId === order.Order_ID}
                                    onToggle={() => setOpenId(openId === order.Order_ID ? null : order.Order_ID)}
                                />
                            ))}
                        </div>
                    );
                })}
            </div>
        </KcPanel>
    );
}

function PurchaseRow({
    order, scope, today, bucket, open, onToggle,
}: {
    order: Order;
    scope: BoardScope;
    today: string;
    bucket: Bucket;
    open: boolean;
    onToggle: () => void;
}) {
    const projectIds = orderProjects(order, scope);
    const items = order.items || [];
    const received = items.filter(i => i.Status === 'Primljeno').length;
    const pct = items.length ? Math.round((received / items.length) * 100) : 0;
    const named = order.Name?.trim();
    const title = named || order.Supplier_Name || `Narudžba #${order.Order_Number}`;

    // Isti materijal na više pozicija je JEDAN red (zbir), abecedno — kao u
    // pregledu narudžbe i u PDF-u koji ide dobavljaču.
    const groups = useMemo(
        () => (open ? groupOrderItems(items, productNamesResolver(scope.projects)) : []),
        [open, items, scope.projects]
    );

    const subtitle = [
        `#${order.Order_Number}`,
        named && order.Supplier_Name ? order.Supplier_Name : null,
        items.length > 0 ? `${items.length} ${plural(items.length, 'stavka', 'stavke', 'stavki')}` : null,
        order.Total_Amount > 0 ? formatCurrency(order.Total_Amount) : null,
    ].filter(Boolean).join(' · ');

    return (
        <>
            <div className={`kc-row${open ? ' open' : ''}${bucket === 'late' ? ' late' : ''}`} style={hue(projectIds[0])}>
                <span style={{ display: 'inline-flex', gap: 3, flex: 'none' }}>
                    {projectIds.slice(0, 3).map(id => (
                        <i
                            key={id}
                            className="kc-group-dot"
                            style={{ ...hue(id), background: 'var(--kc-ink)' }}
                            title={scope.projects.find(p => p.Project_ID === id)?.Name || ''}
                        />
                    ))}
                </span>
                <button
                    type="button"
                    className="kc-row-main"
                    style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}
                    aria-expanded={open}
                    onClick={onToggle}
                >
                    <strong>{title}</strong>
                    <span>{subtitle}</span>
                </button>
                <div className="kc-row-side">
                    <div className="kc-progress" title={`${received} od ${items.length} ${plural(items.length, 'stavke', 'stavke', 'stavki')} primljeno`}>
                        <div className="kc-progress-track"><i style={{ width: `${pct}%` }} /></div>
                        <span>{received}/{items.length} primljeno</span>
                    </div>
                    <span className={`kc-status ${statusClass(bucket)}`}>{STATUS_LABEL[bucket]}</span>
                    <div className={`kc-row-date${order.Expected_Delivery ? '' : ' muted'}`}>
                        <span>{order.Expected_Delivery ? shortDate(order.Expected_Delivery, today) : 'Bez roka'}</span>
                        {bucket === 'late' && <small>Kasni</small>}
                    </div>
                    <button
                        type="button"
                        className="kc-icon-btn"
                        style={{ border: 'none', width: 26, height: 26 }}
                        aria-label={open ? 'Sklopi narudžbu' : 'Otvori narudžbu'}
                        onClick={onToggle}
                    >
                        <ChevronRight size={15} style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s ease' }} />
                    </button>
                </div>
            </div>

            {open && (
                <div className="kc-expand">
                    {items.length === 0 ? (
                        <div className="kc-empty" style={{ padding: 16 }}><p>Narudžba nema stavki.</p></div>
                    ) : (
                        <>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                                <span className="kc-eyebrow" style={{ margin: 0 }}>
                                    <Truck size={11} style={{ verticalAlign: -1, marginRight: 4 }} />
                                    {order.Supplier_Name || 'Dobavljač nije upisan'}
                                    {order.Order_Date ? ` · naručeno ${shortDate(order.Order_Date, today)}` : ''}
                                </span>
                            </div>
                            <div className="kc-table-wrap">
                                <table className="kc-table few">
                                    <thead>
                                        <tr>
                                            <th>Materijal</th>
                                            <th className="r">Naručeno</th>
                                            <th className="r opt">Primljeno</th>
                                            <th className="opt">Pozicija</th>
                                            <th>Status</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {groups.map(group => (
                                            <tr
                                                key={group.key}
                                                className={bucket === 'late' && group.status !== 'received' ? 'blocked' : undefined}
                                            >
                                                <td>
                                                    <div className="kc-mat-name">{group.name}</div>
                                                    {group.items.length > 1 && (
                                                        <div className="kc-mat-sub" title={group.productNames.join(', ')}>
                                                            {group.items.length} {plural(group.items.length, 'stavka', 'stavke', 'stavki')} spojeno
                                                        </div>
                                                    )}
                                                </td>
                                                <td className="r fw">{qty(group.quantity, group.unit)}</td>
                                                <td className="r opt">{qty(group.receivedQuantity, group.unit)}</td>
                                                <td className="opt" title={group.productNames.join(', ')}>
                                                    {group.productNames.length ? productNamesLabel(group.productNames) : '—'}
                                                </td>
                                                <td><GroupStatus group={group} /></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}
                </div>
            )}
        </>
    );
}

/** Status reda materijala: djelomičan prijem se vidi kao x/y, ne kao „Naručeno". */
function GroupStatus({ group }: { group: OrderItemGroup }) {
    if (group.status === 'received') return <span className="kc-status s-done">Primljeno</span>;
    if (group.status === 'partial') {
        return <span className="kc-status s-wait">Djelomično {group.receivedCount}/{group.items.length}</span>;
    }
    return <span className="kc-status s-running">{group.items[0]?.Status || 'Naručeno'}</span>;
}
