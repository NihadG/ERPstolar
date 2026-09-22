'use client';

// ════════════════════════════════════════════════════════════════════
// DETALJ NARUDŽBE — mobilni (full-screen)
//
// Glavni posao na telefonu je PRIJEM ROBE: stavke se čekiraju jedna po jedna
// dok se istovaruje, pa je lista stavki s velikim krugom za dodir centralna.
// Prijem se može i poništiti (reklamacija, greška, pogrešna isporuka).
//
// Sve radnje idu kroz iste servise kao desktop (markMaterialsReceived,
// markMaterialsUnreceived, markOrderSent, updateOrderStatus).
// ════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    ArrowLeft, Send, Check, Printer, FileDown, Pencil, Trash2, Truck,
} from 'lucide-react';
import type { Order, OrderItem, Project } from '@/lib/types';
import { ALLOWED_ORDER_TRANSITIONS } from '@/lib/types';
import { formatCurrency, formatDate, plural } from '@/lib/utils';
import { orderItemPricing } from '@/lib/orderPricing';
import {
    formatQty, groupOrderItems, groupPricing, productNamesLabel, productNamesResolver, type OrderItemGroup,
} from '@/lib/orderItemGroups';
import {
    markMaterialsReceived, markMaterialsUnreceived, markOrderSent, updateOrderStatus,
} from '@/lib/services';
import { useData } from '@/context/DataContext';
import {
    MHero, MSection, MList, MItem, MCell, MText, MValue, MPill, MCheck,
    MActions, MAction, MButton, MSheet, MOption, MEmpty,
} from './MobileUI';
import { useSwipeBack } from './useSwipe';
import { useOverlayGuard } from './overlayGuard';
import './MobileUI.css';
import './MobileWorkOrderDetail.css';

interface Props {
    order: Order;
    projects?: Project[];
    onClose: () => void;
    onRefresh: (...collections: string[]) => void;
    onPatchOrder?: (orderId: string, partial: Partial<Order>) => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
    onEdit: (order: Order) => void;
    onDelete: (orderId: string) => void;
    onDownloadPDF: (order: Order) => void;
    onPrint: (order: Order) => void;
}

type DisplayStatus = 'Nacrt' | 'Poslano' | 'Djelomično' | 'Primljeno';

function displayStatusOf(order: Order): DisplayStatus {
    const total = order.items?.length || 0;
    const received = order.items?.filter(i => i.Status === 'Primljeno').length || 0;
    if (order.Status === 'Primljeno' || (total > 0 && received === total)) return 'Primljeno';
    if (order.Status === 'Poslano' && received > 0) return 'Djelomično';
    return (order.Status as DisplayStatus) || 'Nacrt';
}

const statusTone = (s: DisplayStatus) =>
    s === 'Primljeno' ? 'green' : s === 'Poslano' ? 'blue' : s === 'Djelomično' ? 'orange' : 'gray';

export default function MobileOrderDetail({
    order, projects = [], onClose, onRefresh, onPatchOrder, showToast,
    onEdit, onDelete, onDownloadPDF, onPrint,
}: Props) {
    const { organizationId } = useData();
    const [busy, setBusy] = useState(false);
    const [statusSheet, setStatusSheet] = useState(false);
    const [confirm, setConfirm] = useState<{ title: string; message: string; label: string; run: () => void } | null>(null);

    const items = useMemo(() => order.items || [], [order.items]);
    const pricing = useMemo(() => orderItemPricing(order), [order]);
    // Jedan red po materijalu (zbir, abecedno) — isto kao desktop pregled i PDF.
    const groups = useMemo(() => groupOrderItems(items, productNamesResolver(projects)), [items, projects]);

    // Napredak prijema broji REDOVE koje korisnik vidi (materijale), ne skrivene stavke.
    const total = groups.length;
    const received = groups.filter(g => g.status === 'received').length;
    const pct = total > 0 ? Math.round((received / total) * 100) : 0;
    const ds = displayStatusOf(order);
    const allReceived = total > 0 && received === total;
    const isDraft = order.Status === 'Nacrt';
    const allowed = ALLOWED_ORDER_TRANSITIONS[order.Status] || [];

    const projectName = useMemo(() => {
        const pid = items[0]?.Project_ID;
        return pid ? projects.find(p => p.Project_ID === pid)?.Client_Name : undefined;
    }, [items, projects]);

    useEffect(() => {
        window.history.pushState({ moOrderDetail: true }, '');
        const onPop = () => onClose();
        window.addEventListener('popstate', onPop);
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            window.removeEventListener('popstate', onPop);
            document.body.style.overflow = prev;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const goBack = () => window.history.back();
    // Prijavljuje da je full-screen detalj otvoren — sprječava globalni
    // tab-swipe (page.tsx) da otme isti dodir dok je ovaj ekran na vrhu.
    useOverlayGuard(true);

    // Povlačenje s lijeve ivice = nazad; isključeno dok je otvoren sheet.
    const swipeRef = useSwipeBack(goBack, { enabled: !statusSheet && !confirm });

    // ── Radnje ──────────────────────────────────────────────────────

    /** Prijem reda materijala — sve njegove još neprimljene stavke (pozicije) odjednom. */
    const receiveGroup = async (group: OrderItemGroup) => {
        if (busy) return;
        if (isDraft) { showToast('Pošalji narudžbu prije primanja stavki', 'error'); return; }
        const ids = group.items.filter(i => i.Status !== 'Primljeno').map(i => i.ID);
        if (ids.length === 0) return;
        try {
            setBusy(true);
            const res = await markMaterialsReceived(ids, organizationId!);
            if (res.success) {
                onRefresh('orders');
                (res.postCascade ?? Promise.resolve()).finally(() => onRefresh('projects'));
            } else showToast(res.message, 'error');
        } catch { showToast('Greška pri prijemu stavke', 'error'); }
        finally { setBusy(false); }
    };

    /** Poništenje prijema — reklamacija, greška, pogrešna isporuka. */
    const unreceiveGroup = async (group: OrderItemGroup) => {
        if (busy) return;
        const receivedItems: OrderItem[] = group.items.filter(i => i.Status === 'Primljeno');
        if (receivedItems.length === 0) return;
        setConfirm({
            title: 'Poništiti prijem?',
            message: `„${group.name}" se vraća u „Naručeno".`,
            label: 'Poništi prijem',
            run: async () => {
                try {
                    setBusy(true);
                    const res = await markMaterialsUnreceived(receivedItems.map(i => i.ID), organizationId!);
                    if (res.success) {
                        showToast('Prijem poništen', 'success');
                        onRefresh('orders');
                        (res.postCascade ?? Promise.resolve()).finally(() => onRefresh('projects'));
                    } else showToast(res.message, 'error');
                } catch { showToast('Greška pri poništenju prijema', 'error'); }
                finally { setBusy(false); }
            },
        });
    };

    const receiveAll = () => {
        const unreceived = items.filter(i => i.Status !== 'Primljeno');
        if (unreceived.length === 0) { showToast('Sve stavke su već primljene', 'info'); return; }
        if (isDraft) { showToast('Pošalji narudžbu prije primanja stavki', 'error'); return; }
        const n = groups.filter(g => g.status !== 'received').length;
        setConfirm({
            title: 'Primiti sve stavke?',
            message: `${n} ${plural(n, 'materijal', 'materijala', 'materijala')} bit će označeno primljenim.`,
            label: 'Primi sve',
            run: async () => {
                try {
                    setBusy(true);
                    const res = await markMaterialsReceived(unreceived.map(i => i.ID), organizationId!);
                    if (res.success) {
                        showToast('Sve stavke primljene', 'success');
                        onRefresh('orders');
                        (res.postCascade ?? Promise.resolve()).finally(() => onRefresh('projects'));
                    } else showToast(res.message, 'error');
                } catch { showToast('Greška pri prijemu', 'error'); }
                finally { setBusy(false); }
            },
        });
    };

    const sendOrder = async () => {
        if (busy) return;
        if (items.length === 0) { showToast('Narudžba nema stavki za slanje', 'error'); return; }
        const prev = order.Status;
        onPatchOrder?.(order.Order_ID, { Status: 'Poslano' });
        try {
            setBusy(true);
            const res = await markOrderSent(order.Order_ID, organizationId!);
            if (res.success) {
                showToast('Narudžba poslana', 'success');
                onRefresh('orders');
                (res.postCascade ?? Promise.resolve()).finally(() => onRefresh('projects'));
            } else {
                onPatchOrder?.(order.Order_ID, { Status: prev });
                showToast(res.message, 'error');
            }
        } catch {
            onPatchOrder?.(order.Order_ID, { Status: prev });
            showToast('Greška pri slanju narudžbe', 'error');
        } finally { setBusy(false); }
    };

    const changeStatus = async (next: string) => {
        setStatusSheet(false);
        const prev = order.Status;
        onPatchOrder?.(order.Order_ID, { Status: next });
        try {
            setBusy(true);
            const res = await updateOrderStatus(order.Order_ID, next, organizationId!);
            if (res.success) {
                showToast(`Status promijenjen u „${next}"`, 'success');
                onRefresh('orders');
                (res.postCascade ?? Promise.resolve()).finally(() => onRefresh('projects'));
            } else {
                onPatchOrder?.(order.Order_ID, { Status: prev });
                showToast(res.message, 'error');
            }
        } catch {
            onPatchOrder?.(order.Order_ID, { Status: prev });
            showToast('Greška pri promjeni statusa', 'error');
        } finally { setBusy(false); }
    };

    if (typeof document === 'undefined') return null;

    return createPortal(
        <div
            className="mui mwd"
            ref={swipeRef}
        >
            <header className="mwd-nav">
                <button type="button" className="mwd-back" onClick={goBack}>
                    <ArrowLeft size={21} strokeWidth={2.3} /> Narudžbe
                </button>
                <div className="mwd-nav-actions">
                    <button type="button" className="mwd-navbtn" onClick={() => onEdit(order)} aria-label="Uredi">
                        <Pencil size={18} />
                    </button>
                    <button type="button" className="mwd-navbtn" onClick={() => onPrint(order)} aria-label="Printaj">
                        <Printer size={19} />
                    </button>
                    <button type="button" className="mwd-navbtn danger" onClick={() => { onDelete(order.Order_ID); onClose(); }} aria-label="Obriši">
                        <Trash2 size={19} />
                    </button>
                </div>
            </header>

            <div className="mwd-body">
                <div className="mui-large">
                    <h1>{order.Name || `Narudžba ${order.Order_Number}`}</h1>
                    <p>
                        <MPill tone={statusTone(ds)}>{ds}</MPill>
                        <span>#{order.Order_Number} · {order.Supplier_Name || 'bez dobavljača'}</span>
                    </p>
                </div>

                <MHero
                    kicker="Prijem robe"
                    value={<>{received}<small> od {total}</small></>}
                    chip={isDraft ? 'nije poslano' : allReceived ? 'kompletno' : `${pct}%`}
                    pct={pct}
                    green={allReceived}
                />

                <MActions>
                    {isDraft ? (
                        <MAction tone="blue" disabled={busy} onClick={sendOrder}>
                            <Send size={18} /> Pošalji dobavljaču
                        </MAction>
                    ) : !allReceived ? (
                        <MAction tone="gtint" disabled={busy} onClick={receiveAll}>
                            <Check size={18} /> Primi sve
                        </MAction>
                    ) : null}
                    {allowed.length > 0 && (
                        <MAction tone="tint" disabled={busy} onClick={() => setStatusSheet(true)}>
                            Promijeni status
                        </MAction>
                    )}
                </MActions>

                <MSection title={`Materijali · ${total}`} right={<span className="mui-dim">{formatCurrency(order.Total_Amount || 0)}</span>} />
                {total === 0 ? (
                    <MEmpty title="Narudžba nema stavki" sub="Dodaj materijale kroz uređivanje narudžbe.">
                        <div style={{ width: '100%', paddingTop: 14 }}>
                            <MButton variant="tinted" onClick={() => onEdit(order)}>Uredi narudžbu</MButton>
                        </div>
                    </MEmpty>
                ) : (
                    <>
                        <MList lead>
                            {groups.map(group => {
                                const isRec = group.status === 'received';
                                const { total: lineTotal, unitPrice } = groupPricing(group, pricing);
                                const where = group.items.length > 1
                                    ? `${group.items.length} ${plural(group.items.length, 'pozicija', 'pozicije', 'pozicija')}: ${productNamesLabel(group.productNames)}`
                                    : productNamesLabel(group.productNames);
                                const partial = group.status === 'partial' ? ` · primljeno ${group.receivedCount}/${group.items.length}` : '';
                                return (
                                    <MItem key={group.key}>
                                        <MCell done={isRec}>
                                            <MCheck
                                                on={isRec}
                                                disabled={busy || isDraft}
                                                label={isRec ? 'Poništi prijem' : 'Označi primljenim'}
                                                onClick={() => (isRec ? unreceiveGroup(group) : receiveGroup(group))}
                                            />
                                            <MText
                                                title={group.name}
                                                sub={`${formatQty(group.quantity)} ${group.unit} × ${formatCurrency(unitPrice)}${where ? ` · ${where}` : ''}${partial}`}
                                            />
                                            <MValue strong>{formatCurrency(lineTotal)}</MValue>
                                        </MCell>
                                    </MItem>
                                );
                            })}
                        </MList>
                        <p className="mwd-hint">
                            {isDraft
                                ? 'Pošalji narudžbu da bi mogao čekirati prijem stavki.'
                                : 'Dodirni krug da označiš stavku primljenom. Ponovni dodir poništava prijem.'}
                        </p>
                    </>
                )}

                <MSection title="Podaci" />
                <MList>
                    <MItem>
                        <MCell>
                            <MText title="Iznos" />
                            <MValue strong>{formatCurrency(order.Total_Amount || 0)}</MValue>
                        </MCell>
                    </MItem>
                    <MItem>
                        <MCell>
                            <MText title="Dobavljač" />
                            <MValue num={false}>{order.Supplier_Name || '—'}</MValue>
                        </MCell>
                    </MItem>
                    <MItem>
                        <MCell>
                            <MText title="Datum narudžbe" />
                            <MValue num={false}>{formatDate(order.Order_Date)}</MValue>
                        </MCell>
                    </MItem>
                    {order.Expected_Delivery && (
                        <MItem>
                            <MCell>
                                <MText title="Očekivana isporuka" />
                                <MValue num={false}>{formatDate(order.Expected_Delivery)}</MValue>
                            </MCell>
                        </MItem>
                    )}
                    {projectName && (
                        <MItem>
                            <MCell>
                                <MText title="Projekat" />
                                <MValue num={false}>{projectName}</MValue>
                            </MCell>
                        </MItem>
                    )}
                </MList>

                {order.Notes && (
                    <>
                        <MSection title="Napomena" />
                        <MList><MItem><MCell><MText title={order.Notes} /></MCell></MItem></MList>
                    </>
                )}

                <div className="mui-stack mui-gap10 mui-pt14">
                    <MButton variant="tinted" onClick={() => onDownloadPDF(order)}>
                        <FileDown size={19} /> Preuzmi PDF
                    </MButton>
                    <MButton variant="tinted" onClick={() => onPrint(order)}>
                        <Printer size={19} /> Printaj
                    </MButton>
                </div>
            </div>

            {/* Promjena statusa */}
            <MSheet open={statusSheet} title="Promijeni status" onClose={() => setStatusSheet(false)}>
                <MList>
                    {allowed.map(s => (
                        <MOption
                            key={s}
                            label={s}
                            sub={s === 'Nacrt' ? 'Statusi materijala se vraćaju na „Nije naručeno"' : undefined}
                            selected={false}
                            onClick={() => changeStatus(s)}
                        />
                    ))}
                </MList>
            </MSheet>

            {/* Potvrde (prijem / poništenje) */}
            <MSheet
                open={!!confirm}
                title={confirm?.title}
                onClose={() => setConfirm(null)}
                footer={
                    <div className="mui-stack mui-gap10 mui-pt14">
                        <MButton variant="gfilled" onClick={() => { const fn = confirm?.run; setConfirm(null); fn?.(); }}>
                            <Truck size={19} /> {confirm?.label}
                        </MButton>
                        <MButton variant="tinted" onClick={() => setConfirm(null)}>Odustani</MButton>
                    </div>
                }
            >
                <p className="mwd-sheet-note">{confirm?.message}</p>
            </MSheet>
        </div>,
        document.body
    );
}
