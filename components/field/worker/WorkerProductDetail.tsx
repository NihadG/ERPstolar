'use client';

// ════════════════════════════════════════════════════════════════════
// RADNIK — DETALJ PROIZVODA (materijali + procesi + prijedlozi)
//
// Dijeli ga tab Projekti i tab Nalozi. Uz pregled materijala, radnik može:
//   • „Ugradi materijal" — označi šta je ugradio i koliko (može dodati i nov),
//   • „Predloži narudžbu" — označi šta fali za narudžbu.
// Oboje su PRIJEDLOZI: vlasnik ih u notifikacijama prilagodi i potvrdi, pa se
// tek onda upišu u materijale/kalkulaciju. Bez cijena na radnikovoj strani.
// ════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, PackagePlus, ShoppingCart, Plus, Trash2 } from 'lucide-react';
import type { FieldMaterialRow, FieldProductDetail } from '@/lib/field/fieldProjects';
import type { MaterialLine } from '@/lib/changeRequests';
import { useWorkerRequests, type ProposeInput } from '@/lib/field/useWorkerRequests';
import {
    MPill, MEmpty, MSection, MList, MItem, MCell, MText, MDot, MSegmented, MSheet, MButton, MCheck,
} from '@/components/tabs/mobile/MobileUI';
import { useOverlayGuard } from '@/components/tabs/mobile/overlayGuard';
import { useSwipeBack } from '@/components/tabs/mobile/useSwipe';
import type { ShowToast } from './WorkerApp';

const matTone = (status: string): 'green' | 'orange' | 'red' =>
    status === 'Primljeno' || status === 'Na stanju' ? 'green' : status === 'Naručeno' ? 'orange' : 'red';

const matDot = (status: string): 'rdy' | 'ord' | 'need' =>
    status === 'Primljeno' || status === 'Na stanju' ? 'rdy' : status === 'Naručeno' ? 'ord' : 'need';

interface Props {
    product: FieldProductDetail;
    backLabel: string;
    previewUid?: string | null;
    showToast: ShowToast;
    onClose: () => void;
}

export default function WorkerProductDetail({ product, backLabel, previewUid, showToast, onClose }: Props) {
    const readOnly = !!previewUid;
    const { propose } = useWorkerRequests(readOnly);
    const [tab, setTab] = useState<'materijali' | 'procesi'>('materijali');
    const [usageOpen, setUsageOpen] = useState(false);
    const [orderOpen, setOrderOpen] = useState(false);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        window.history.pushState({ fwkProduct: true }, '');
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
    const swipeRef = useSwipeBack(goBack, { enabled: !usageOpen && !orderOpen });

    const missing = useMemo(() => product.materials.filter(m => !m.isReady), [product.materials]);

    const submit = async (input: ProposeInput, okMsg: string) => {
        if (readOnly || busy) return;
        setBusy(true);
        try {
            await propose(input);
            showToast(okMsg, 'success');
            setUsageOpen(false); setOrderOpen(false);
        } catch (e: any) {
            showToast(e?.message || 'Slanje nije uspjelo.', 'error');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="mui fwk-fod" ref={swipeRef}>
            <header className="fwk-nav">
                <button type="button" className="fwk-back" onClick={goBack}>
                    <ArrowLeft size={21} strokeWidth={2.3} /> {backLabel}
                </button>
            </header>

            <div className="mui-large">
                <h1>{product.name}</h1>
                <p>
                    <MPill tone="gray">{product.status}</MPill>
                    <span>×{product.quantity}{product.dimensions ? ` · ${product.dimensions}` : ''}</span>
                </p>
            </div>

            {product.essentialMissing > 0 && (
                <div className="fld-notice">
                    <AlertTriangle size={17} />
                    <span>
                        <b>{product.essentialMissing}</b> ključn{product.essentialMissing === 1 ? 'i materijal' : 'a materijala'} još
                        nije spremn{product.essentialMissing === 1 ? '' : 'a'} — nalog se ne može pokrenuti dok ne stigne.
                    </span>
                </div>
            )}

            {!readOnly && (
                <div className="fwk-prod-actions">
                    <MButton variant="tinted" onClick={() => setUsageOpen(true)}>
                        <PackagePlus size={18} /> Ugradi materijal
                    </MButton>
                    {missing.length > 0 && (
                        <MButton variant="tinted" onClick={() => setOrderOpen(true)}>
                            <ShoppingCart size={18} /> Predloži narudžbu
                        </MButton>
                    )}
                </div>
            )}

            <div className="fld-seg">
                <MSegmented<'materijali' | 'procesi'>
                    value={tab}
                    onChange={setTab}
                    options={[
                        { id: 'materijali', label: `Materijali ${product.materialsTotal}` },
                        { id: 'procesi', label: `Procesi ${product.processes.length}` },
                    ]}
                />
            </div>

            {tab === 'materijali' && (
                product.materials.length === 0 ? (
                    <MEmpty title="Nema materijala" sub="Proizvod još nema unesenu sastavnicu." />
                ) : (
                    <MList lead>
                        {product.materials.map(m => (
                            <MItem key={m.materialId}>
                                <MCell>
                                    <MDot kind={matDot(m.status)} />
                                    <MText
                                        title={m.name}
                                        sub={<>
                                            <MPill tone={matTone(m.status)}>{m.status}</MPill>
                                            {m.isEssential && <MPill tone="red">ključno</MPill>}
                                            <span>{m.quantity} {m.unit}{m.supplier ? ` · ${m.supplier}` : ''}</span>
                                        </>}
                                    />
                                </MCell>
                            </MItem>
                        ))}
                    </MList>
                )
            )}

            {tab === 'procesi' && (
                product.processes.length === 0 ? (
                    <MEmpty title="Nema plana procesa" sub="Proizvod još nema definisan tok." />
                ) : (
                    <>
                        <MList>
                            {product.processes.map((p, i) => (
                                <MItem key={`${p}-${i}`}>
                                    <MCell><MText title={p} sub={`korak ${i + 1}`} /></MCell>
                                </MItem>
                            ))}
                        </MList>
                        <p className="fwk-hint">Procesi se čekiraju na nalogu, u tabu Tok.</p>
                    </>
                )
            )}

            {product.notes && (
                <>
                    <MSection title="Napomena" />
                    <p className="fwk-hint">{product.notes}</p>
                </>
            )}

            {/* ── Ugradi materijal ────────────────────────────────────── */}
            <MSheet open={usageOpen} title="Ugradi materijal" onClose={() => setUsageOpen(false)}>
                <MaterialPicker
                    materials={product.materials}
                    allowNew
                    submitLabel="Pošalji prijedlog"
                    busy={busy}
                    onSubmit={(lines) => submit(
                        { kind: 'material_usage', payload: { productId: product.productId, lines }, productId: product.productId },
                        'Prijedlog ugradnje poslan — čeka potvrdu',
                    )}
                />
            </MSheet>

            {/* ── Predloži narudžbu ───────────────────────────────────── */}
            <MSheet open={orderOpen} title="Predloži narudžbu" onClose={() => setOrderOpen(false)}>
                <MaterialPicker
                    materials={missing}
                    requireExisting
                    submitLabel="Pošalji prijedlog"
                    busy={busy}
                    onSubmit={(lines) => submit(
                        { kind: 'material_order', payload: { productId: product.productId, lines }, productId: product.productId },
                        'Prijedlog narudžbe poslan — čeka potvrdu',
                    )}
                />
            </MSheet>
        </div>
    );
}

// ─── Birač materijala (dijeljen za ugradnju i narudžbu) ───────────────

function MaterialPicker({ materials, allowNew, requireExisting, submitLabel, busy, onSubmit }: {
    materials: FieldMaterialRow[];
    allowNew?: boolean;
    requireExisting?: boolean;
    submitLabel: string;
    busy: boolean;
    onSubmit: (lines: MaterialLine[]) => void;
}) {
    const [sel, setSel] = useState<Record<string, { on: boolean; qty: number }>>({});
    const [extra, setExtra] = useState<{ name: string; qty: string; unit: string }[]>([]);

    const toggle = (m: FieldMaterialRow) => setSel(prev => ({
        ...prev,
        [m.materialId]: { on: !prev[m.materialId]?.on, qty: prev[m.materialId]?.qty ?? m.quantity },
    }));
    const setQty = (id: string, qty: number, fallback: number) =>
        setSel(prev => ({ ...prev, [id]: { on: prev[id]?.on ?? true, qty: isFinite(qty) && qty > 0 ? qty : fallback } }));

    const lines: MaterialLine[] = [
        ...materials
            .filter(m => sel[m.materialId]?.on)
            .map(m => ({ materialId: m.materialId, name: m.name, quantity: sel[m.materialId]?.qty ?? m.quantity, unit: m.unit || 'kom', supplier: m.supplier || undefined })),
        ...(allowNew ? extra.filter(e => e.name.trim() && Number(e.qty) > 0)
            .map(e => ({ name: e.name.trim(), quantity: Number(e.qty), unit: e.unit.trim() || 'kom' })) : []),
    ];

    return (
        <>
            <div className="fwk-picker">
                {materials.length === 0 && !allowNew && (
                    <p className="fwk-hint" style={{ padding: '4px 2px' }}>Nema materijala za narudžbu.</p>
                )}
                {materials.map(m => {
                    const s = sel[m.materialId];
                    return (
                        <div key={m.materialId} className="fwk-pick-row">
                            <MCheck on={!!s?.on} onClick={() => toggle(m)} />
                            <div className="fwk-pick-main">
                                <span className="fwk-pick-name">{m.name}</span>
                                <span className="fwk-pick-sub">{m.unit}{m.supplier ? ` · ${m.supplier}` : ''}</span>
                            </div>
                            <input
                                className="fwk-qty" type="number" min="0" step="0.1"
                                value={s?.on ? String(s.qty) : String(m.quantity)}
                                disabled={!s?.on}
                                onChange={(e) => setQty(m.materialId, Number(e.target.value), m.quantity)}
                            />
                        </div>
                    );
                })}

                {allowNew && (
                    <>
                        <div className="fwk-pick-divider">Dodaj materijal koji nije u sastavnici</div>
                        {extra.map((e, i) => (
                            <div key={i} className="fwk-pick-row">
                                <input className="fwk-input fwk-flex" placeholder="Naziv" value={e.name}
                                    onChange={ev => setExtra(prev => prev.map((x, j) => j === i ? { ...x, name: ev.target.value } : x))} />
                                <input className="fwk-qty" type="number" min="0" step="0.1" placeholder="Kol." value={e.qty}
                                    onChange={ev => setExtra(prev => prev.map((x, j) => j === i ? { ...x, qty: ev.target.value } : x))} />
                                <input className="fwk-unit" placeholder="jed." value={e.unit}
                                    onChange={ev => setExtra(prev => prev.map((x, j) => j === i ? { ...x, unit: ev.target.value } : x))} />
                                <button type="button" className="fwk-iconbtn danger" aria-label="Ukloni"
                                    onClick={() => setExtra(prev => prev.filter((_, j) => j !== i))}>
                                    <Trash2 size={15} />
                                </button>
                            </div>
                        ))}
                        <button type="button" className="fwk-addrow" onClick={() => setExtra(prev => [...prev, { name: '', qty: '', unit: '' }])}>
                            <Plus size={16} /> Novi materijal
                        </button>
                    </>
                )}
            </div>

            <div className="fld-submit">
                <MButton variant="filled" disabled={busy || lines.length === 0 || (requireExisting && lines.every(l => !l.materialId))}
                    onClick={() => onSubmit(lines)}>
                    {submitLabel}
                </MButton>
            </div>
        </>
    );
}
