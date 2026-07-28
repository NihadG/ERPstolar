'use client';

// ════════════════════════════════════════════════════════════════════
// NARUDŽBE — lista i prijem
//
// Kontrolor je taj ko fizički stoji pored materijala kad stigne. Zato je
// prijem ovdje, a ne kod vlasnika koji ga upisuje po pričanju.
//
// Bez ijedne cijene — kontrolora zanima ŠTA je stiglo i koliko, ne pošto.
// ════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, PackageCheck, ShoppingCart, Truck } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/apiClient';
import type { FieldPurchaseDetail, FieldPurchaseRow } from '@/lib/field/fieldPurchases';
import {
    MLarge, MSearch, MChips, MCard, MCardHead, MCardBody, MIcon, MPill,
    MProgress, MEmpty, MButton, MSection, MSheet,
} from '@/components/tabs/mobile/MobileUI';
import { useOverlayGuard } from '@/components/tabs/mobile/overlayGuard';
import { useSwipeBack } from '@/components/tabs/mobile/useSwipe';

type Filter = '' | 'waiting' | 'received';

const TONE: Record<string, 'gray' | 'blue' | 'orange' | 'green'> = {
    'Nacrt': 'gray', 'Poslano': 'blue', 'Djelomično': 'orange', 'Primljeno': 'green',
};

const shortDate = (iso: string | null) =>
    iso ? new Date(iso + 'T12:00:00').toLocaleDateString('bs-BA', { day: 'numeric', month: 'short' }) : null;

interface Props {
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
    readOnly?: boolean;
}

export default function PurchasesScreen({ showToast, readOnly }: Props) {
    const [rows, setRows] = useState<FieldPurchaseRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState<Filter>('');
    const [openId, setOpenId] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await apiGet<{ purchases: FieldPurchaseRow[] }>('/api/field/purchases');
            setRows(res.purchases);
        } catch (e: any) {
            setError(e?.message || 'Učitavanje nije uspjelo.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const counts = useMemo(() => ({
        waiting: rows.filter(r => r.status === 'Poslano' || r.status === 'Djelomično').length,
        received: rows.filter(r => r.status === 'Primljeno').length,
    }), [rows]);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return rows.filter(r => {
            if (q && !r.name.toLowerCase().includes(q) && !r.supplier.toLowerCase().includes(q)
                && !r.projectName.toLowerCase().includes(q)) return false;
            if (filter === 'waiting') return r.status === 'Poslano' || r.status === 'Djelomično';
            if (filter === 'received') return r.status === 'Primljeno';
            return true;
        });
    }, [rows, search, filter]);

    if (openId) {
        return (
            <PurchaseDetail
                orderId={openId}
                onClose={() => { setOpenId(null); load(); }}
                showToast={showToast}
                readOnly={readOnly}
            />
        );
    }

    return (
        <>
            <MLarge title="Narudžbe">
                {rows.length} {rows.length === 1 ? 'narudžba' : 'narudžbi'}
                {counts.waiting > 0 && <span className="mui-dim">· {counts.waiting} se čeka</span>}
            </MLarge>

            <div className="fld-search">
                <MSearch value={search} onChange={setSearch} placeholder="Traži dobavljača ili projekat…" />
            </div>

            <MChips<Filter>
                value={filter}
                onChange={setFilter}
                options={[
                    { id: '', label: 'Sve', count: rows.length },
                    { id: 'waiting', label: 'Čeka se', count: counts.waiting },
                    { id: 'received', label: 'Stiglo', count: counts.received },
                ]}
            />

            {loading && rows.length === 0 && <div className="fld-loading">Učitavanje…</div>}

            {error && (
                <MEmpty title="Podaci nisu učitani" sub={error}>
                    <div style={{ width: '100%', paddingTop: 14 }}>
                        <MButton variant="filled" onClick={load}>Pokušaj ponovo</MButton>
                    </div>
                </MEmpty>
            )}

            {!loading && !error && filtered.length === 0 && (
                <MEmpty
                    title="Nema narudžbi"
                    sub={search || filter ? 'Promijeni pretragu ili filter.' : 'Još nije naručen nijedan materijal.'}
                />
            )}

            <div className="mui-elist">
                {filtered.map(r => {
                    const eta = shortDate(r.expectedDelivery);
                    const pct = r.itemCount > 0 ? Math.round((r.receivedCount / r.itemCount) * 100) : 0;

                    return (
                        <MCard key={r.orderId} onClick={() => setOpenId(r.orderId)}>
                            <MCardHead>
                                <MIcon tone={TONE[r.status]}>
                                    {r.status === 'Primljeno' ? <PackageCheck size={21} />
                                        : r.status === 'Nacrt' ? <ShoppingCart size={21} /> : <Truck size={21} />}
                                </MIcon>
                                <MCardBody
                                    name={r.name}
                                    meta={<>
                                        <MPill tone={TONE[r.status]}>{r.status}</MPill>
                                        <span>{r.supplier}{r.projectName ? ` · ${r.projectName}` : ''}</span>
                                    </>}
                                />
                            </MCardHead>

                            {r.itemCount > 0 ? (
                                <MProgress
                                    pct={pct}
                                    tone={pct >= 100 ? 'green' : pct > 0 ? 'orange' : undefined}
                                    label={<>
                                        <b>{r.receivedCount}/{r.itemCount}</b> stiglo
                                        {eta && r.status !== 'Primljeno' && <span> · očekivano {eta}</span>}
                                    </>}
                                />
                            ) : (
                                <div className="mui-ec-foot"><span className="mui-barl mui-dim">Bez stavki</span></div>
                            )}
                        </MCard>
                    );
                })}
            </div>
        </>
    );
}

// ════════════════════════════════════════════════════════════════════
// DETALJ — čekiranje prijema
// ════════════════════════════════════════════════════════════════════

function PurchaseDetail({ orderId, onClose, showToast, readOnly }: {
    orderId: string;
    onClose: () => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
    readOnly?: boolean;
}) {
    const [detail, setDetail] = useState<FieldPurchaseDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [missingOpen, setMissingOpen] = useState(false);
    const [missingText, setMissingText] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            setDetail(await apiGet<FieldPurchaseDetail>(`/api/field/purchases/${orderId}`));
        } catch (e: any) {
            setError(e?.message || 'Učitavanje nije uspjelo.');
        } finally {
            setLoading(false);
        }
    }, [orderId]);

    useEffect(() => { load(); }, [load]);

    useEffect(() => {
        window.history.pushState({ fieldPurchase: true }, '');
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
    useOverlayGuard(true);
    const swipeRef = useSwipeBack(goBack, { enabled: !missingOpen });

    const receive = async (itemIds: string[], received: boolean) => {
        if (busy || itemIds.length === 0) return;
        setBusy(true);
        try {
            const res = await apiPost<{ message: string }>(
                `/api/field/purchases/${orderId}/receive`, { itemIds, received }
            );
            showToast(res.message, 'success');
            await load();
        } catch (e: any) {
            showToast(e?.message || 'Radnja nije uspjela', 'error');
        } finally {
            setBusy(false);
        }
    };

    const pending = detail?.items.filter(i => !i.received) || [];

    return (
        <div className="mui fod" ref={swipeRef}>
            <header className="mwd-nav mui-subnav">
                <button type="button" className="mwd-back" onClick={goBack}>
                    <ArrowLeft size={21} strokeWidth={2.3} /> Narudžbe
                </button>
            </header>

            {loading && !detail && <div className="fld-loading">Učitavanje…</div>}

            {error && (
                <MEmpty title="Narudžba nije učitana" sub={error}>
                    <div style={{ width: '100%', paddingTop: 14 }}>
                        <MButton variant="filled" onClick={load}>Pokušaj ponovo</MButton>
                    </div>
                </MEmpty>
            )}

            {detail && (
                <>
                    <div className="mui-large">
                        <h1>{detail.name}</h1>
                        <p>
                            <MPill tone={TONE[detail.status]}>{detail.status}</MPill>
                            <span>{detail.supplier}{detail.projectName ? ` · ${detail.projectName}` : ''}</span>
                        </p>
                    </div>

                    {!readOnly && pending.length > 0 && (
                        <button
                            type="button"
                            className="fat-unbooked"
                            disabled={busy}
                            onClick={() => receive(pending.map(i => i.itemId), true)}
                        >
                            <PackageCheck size={19} />
                            <span><b>{pending.length}</b> {pending.length === 1 ? 'stavka' : 'stavki'} nije primljeno</span>
                            <span className="fat-unbooked-cta">Primi sve</span>
                        </button>
                    )}

                    <MSection
                        title="Stavke"
                        right={<span className="mui-dim">{detail.items.filter(i => i.received).length}/{detail.items.length}</span>}
                    />

                    <div className="fod-flow">
                        {detail.items.map(item => (
                            <button
                                key={item.itemId}
                                type="button"
                                className={`fod-item${item.received ? ' done' : ''}`}
                                disabled={readOnly || busy}
                                onClick={() => receive([item.itemId], !item.received)}
                            >
                                <span className={`fbk-check${item.received ? ' on' : ''}`}>
                                    {item.received && <Check size={14} strokeWidth={3.4} />}
                                </span>
                                <span className="fod-item-main">
                                    <span className="fod-item-name">{item.materialName}</span>
                                    <span className="fod-item-meta">
                                        {item.quantity} {item.unit}
                                        {item.productName && ` · ${item.productName}`}
                                        {item.received && item.receivedDate && ` · stiglo ${shortDate(item.receivedDate)}`}
                                    </span>
                                </span>
                            </button>
                        ))}
                    </div>

                    <p className="fod-hint">
                        Dodirni stavku da označiš da je stigla. Ponovni dodir poništava prijem.
                    </p>

                    {!readOnly && (
                        <div className="fod-addtask">
                            <button type="button" className="fat-bulk" onClick={() => setMissingOpen(true)}>
                                Fali nam još materijala
                            </button>
                        </div>
                    )}

                    {detail.notes && (
                        <>
                            <MSection title="Napomena" />
                            <p className="fod-hint">{detail.notes}</p>
                        </>
                    )}
                </>
            )}

            <MSheet open={missingOpen} title="Fali materijal" onClose={() => setMissingOpen(false)}>
                <p className="fat-sheet-sub">
                    Ovo ide vlasniku kao zadatak — napiši šta treba dokupiti.
                </p>
                <div className="fod-field">
                    <label htmlFor="fpu-missing">Šta fali</label>
                    <input
                        id="fpu-missing"
                        value={missingText}
                        onChange={e => setMissingText(e.target.value)}
                        placeholder="npr. još 4 ploče iverala 18mm"
                        autoFocus
                    />
                </div>
                <div className="fod-confirm-wrap">
                    <button
                        type="button"
                        className="fbk-confirm"
                        disabled={busy || !missingText.trim()}
                        onClick={async () => {
                            setBusy(true);
                            try {
                                await apiPost('/api/field/tasks', {
                                    title: `Dokupiti: ${missingText.trim()}`,
                                    priority: 'high',
                                    category: 'ordering',
                                });
                                showToast('Prijavljeno vlasniku', 'success');
                                setMissingText('');
                                setMissingOpen(false);
                            } catch (e: any) {
                                showToast(e?.message || 'Slanje nije uspjelo', 'error');
                            } finally {
                                setBusy(false);
                            }
                        }}
                    >
                        {busy ? 'Šaljem…' : 'Pošalji'}
                    </button>
                </div>
            </MSheet>
        </div>
    );
}
