'use client';

// ════════════════════════════════════════════════════════════════════
// DETALJ PROIZVODA — mobilni (full-screen)
//
// Odgovor na „ne vidim materijale kad kliknem proizvod": svi materijali
// proizvoda su ovdje, s tačkom statusa (treba naručiti / naručeno / spremno),
// količinom × cijenom i dobavljačem. Dodir otvara uređivanje.
//
// Dodavanje i uređivanje idu kroz POSTOJEĆE mobilne modale (roditelj ih drži),
// pa se logika unosa materijala ne duplira.
// ════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Plus, Pencil, Trash2, Scissors, MessageSquareText, Package } from 'lucide-react';
import type { Project, Product, ProductMaterial } from '@/lib/types';
import { formatCurrency } from '@/lib/utils';
import { summarizeNotes } from '@/lib/productNotes';
import {
    MHero, MSegmented, MSection, MList, MItem, MCell, MText, MValue, MPill,
    MDot, MButton, MEmpty, MSheet,
} from './MobileUI';
import { useEdgeSwipeBack } from './useSwipe';
import './MobileUI.css';
import './MobileWorkOrderDetail.css';

type Tab = 'materijali' | 'procesi' | 'info';

interface Props {
    project: Project;
    product: Product;
    onClose: () => void;
    /** Uređivanje samog proizvoda (naziv, dimenzije, količina). */
    onEditProduct: (projectId: string, product: Product) => void;
    onDeleteProduct: (productId: string) => void;
    /** Dodavanje materijala — otvara postojeći mobilni modal. */
    onAddMaterial: (productId: string) => void;
    onEditMaterial: (productId: string, material: ProductMaterial) => void;
    onDeleteMaterial: (materialId: string) => void;
    onOpenNotes?: (projectId: string, productId: string) => void;
    onOpenCutlist?: (product: Product) => void;
}

/** Tačka statusa materijala — ista podjela kao u pregledu projekta. */
const matDot = (status: string): 'need' | 'ord' | 'rdy' =>
    status === 'Primljeno' || status === 'Na stanju' ? 'rdy' : status === 'Naručeno' ? 'ord' : 'need';

const matTone = (status: string) =>
    status === 'Primljeno' || status === 'Na stanju' ? 'green' : status === 'Naručeno' ? 'orange' : 'red';

const statusTone = (s?: string) =>
    s === 'Završeno' || s === 'Spremno' ? 'green'
        : s === 'U proizvodnji' || s === 'U toku' ? 'blue'
            : s === 'U montaži' ? 'purple' : 'gray';

export default function MobileProductDetail({
    project, product, onClose, onEditProduct, onDeleteProduct,
    onAddMaterial, onEditMaterial, onDeleteMaterial, onOpenNotes, onOpenCutlist,
}: Props) {
    const [tab, setTab] = useState<Tab>('materijali');
    const [confirmDel, setConfirmDel] = useState<ProductMaterial | null>(null);

    const materials = useMemo(() => product.materials || [], [product.materials]);
    const matTotal = useMemo(
        () => materials.reduce((s, m) => s + (m.Total_Price || 0), 0),
        [materials]
    );
    const needCount = materials.filter(m => matDot(m.Status) === 'need').length;

    // Procesi proizvoda — plan (faze) je ono što se planira prije naloga.
    const stages = product.Process_Stages || [];
    const planProcesses = stages.length > 0
        ? stages.flatMap(s => s.processes)
        : (product.Process_Plan || []);

    const notes = useMemo(() => summarizeNotes(product.Questions || []), [product.Questions]);

    useEffect(() => {
        window.history.pushState({ moProductDetail: true }, '');
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

    // Povlačenje s lijeve ivice = nazad; isključeno dok je otvorena potvrda.
    const dragX = useEdgeSwipeBack(goBack, { enabled: !confirmDel });

    if (typeof document === 'undefined') return null;

    return createPortal(
        <div
            className="mui mwd"
            style={dragX > 0 ? { transform: `translateX(${dragX}px)`, transition: 'none' } : undefined}
        >
            <header className="mwd-nav">
                <button type="button" className="mwd-back" onClick={goBack}>
                    <ArrowLeft size={21} strokeWidth={2.3} /> {project.Client_Name || 'Projekat'}
                </button>
                <div className="mwd-nav-actions">
                    <button type="button" className="mwd-navbtn" onClick={() => onEditProduct(project.Project_ID, product)} aria-label="Uredi proizvod">
                        <Pencil size={18} />
                    </button>
                    <button type="button" className="mwd-navbtn danger" onClick={() => { onDeleteProduct(product.Product_ID); onClose(); }} aria-label="Obriši proizvod">
                        <Trash2 size={19} />
                    </button>
                </div>
            </header>

            <div className="mwd-body">
                <div className="mui-large">
                    <h1>{product.Name}</h1>
                    <p>
                        <MPill tone={statusTone(product.Status)}>{product.Status || 'Na čekanju'}</MPill>
                        <span>
                            ×{product.Quantity || 1}
                            {product.Width || product.Height || product.Depth
                                ? ` · ${product.Width || 0}×${product.Height || 0}×${product.Depth || 0} mm`
                                : ''}
                        </span>
                    </p>
                </div>

                <MHero
                    kicker="Materijali"
                    value={<>{materials.length - needCount}<small> od {materials.length} spremno</small></>}
                    chip={needCount > 0 ? `${needCount} treba naručiti` : 'kompletno'}
                    pct={materials.length > 0 ? Math.round(((materials.length - needCount) / materials.length) * 100) : 0}
                    green={needCount === 0 && materials.length > 0}
                />

                <MSegmented<Tab>
                    value={tab}
                    onChange={setTab}
                    options={[
                        { id: 'materijali', label: `Materijali ${materials.length}` },
                        { id: 'procesi', label: planProcesses.length > 0 ? `Procesi ${planProcesses.length}` : 'Procesi' },
                        { id: 'info', label: 'Info' },
                    ]}
                />

                {/* ── MATERIJALI ── */}
                {tab === 'materijali' && (
                    materials.length === 0 ? (
                        <MEmpty title="Nema materijala" sub="Dodaj materijale da bi se računao trošak i naručivalo.">
                            <div style={{ width: '100%', paddingTop: 14 }}>
                                <MButton variant="filled" onClick={() => onAddMaterial(product.Product_ID)}>
                                    <Plus size={19} /> Dodaj materijal
                                </MButton>
                            </div>
                        </MEmpty>
                    ) : (
                        <>
                            <MSection
                                title={`Materijali · ${formatCurrency(matTotal)}`}
                                action="+ Dodaj"
                                onAction={() => onAddMaterial(product.Product_ID)}
                            />
                            <MList lead>
                                {materials.map(m => (
                                    <MItem key={m.ID}>
                                        <MCell onClick={() => onEditMaterial(product.Product_ID, m)} chevron>
                                            <MDot kind={matDot(m.Status)} />
                                            <MText
                                                title={m.Material_Name}
                                                sub={<>
                                                    <MPill tone={matTone(m.Status)}>{m.Status}</MPill>
                                                    <span>
                                                        {m.Quantity % 1 === 0 ? m.Quantity : m.Quantity.toFixed(2)} {m.Unit}
                                                        {m.Unit_Price ? ` × ${formatCurrency(m.Unit_Price)}` : ''}
                                                        {m.Supplier ? ` · ${m.Supplier}` : ''}
                                                    </span>
                                                </>}
                                            />
                                            <MValue strong>{formatCurrency(m.Total_Price || 0)}</MValue>
                                        </MCell>
                                    </MItem>
                                ))}
                            </MList>
                            <p className="mwd-hint">Dodirni materijal da promijeniš količinu, cijenu ili ga ukloniš.</p>
                            <div className="mui-pt14">
                                <MButton variant="tinted" onClick={() => onAddMaterial(product.Product_ID)}>
                                    <Plus size={19} /> Dodaj materijal
                                </MButton>
                            </div>
                        </>
                    )
                )}

                {/* ── PROCESI (plan proizvoda) ── */}
                {tab === 'procesi' && (
                    planProcesses.length === 0 ? (
                        <MEmpty title="Nema plana procesa" sub="Plan se postavlja na proizvodu i prenosi u nalog pri kreiranju." />
                    ) : (
                        <>
                            {stages.length > 0 ? (
                                stages.map((stage, i) => (
                                    <div key={i}>
                                        <MSection title={`Faza ${i + 1}`} right={<span className="mui-dim">{stage.processes.length}</span>} />
                                        <MList>
                                            {stage.processes.map(p => (
                                                <MItem key={p}>
                                                    <MCell><MText title={p} /></MCell>
                                                </MItem>
                                            ))}
                                        </MList>
                                    </div>
                                ))
                            ) : (
                                <>
                                    <MSection title="Plan procesa" />
                                    <MList>
                                        {planProcesses.map(p => (
                                            <MItem key={p}>
                                                <MCell><MText title={p} /></MCell>
                                            </MItem>
                                        ))}
                                    </MList>
                                </>
                            )}
                            <p className="mwd-hint">Procesi se čekiraju na nalogu, u tabu Tok.</p>
                        </>
                    )
                )}

                {/* ── INFO ── */}
                {tab === 'info' && (
                    <>
                        <MSection title="Podaci" />
                        <MList>
                            <MItem><MCell><MText title="Količina" /><MValue strong>{product.Quantity || 1}</MValue></MCell></MItem>
                            <MItem><MCell><MText title="Dimenzije (Š×V×D)" /><MValue num={false}>
                                {product.Width || 0}×{product.Height || 0}×{product.Depth || 0} mm
                            </MValue></MCell></MItem>
                            <MItem><MCell><MText title="Trošak materijala" /><MValue strong>{formatCurrency(product.Material_Cost || matTotal)}</MValue></MCell></MItem>
                            <MItem><MCell><MText title="Status" /><MValue num={false}>{product.Status || 'Na čekanju'}</MValue></MCell></MItem>
                        </MList>

                        {product.Notes && (
                            <>
                                <MSection title="Napomena" />
                                <MList><MItem><MCell><MText title={product.Notes} /></MCell></MItem></MList>
                            </>
                        )}

                        <div className="mui-stack mui-gap10 mui-pt14">
                            {onOpenNotes && (
                                <MButton variant="tinted" onClick={() => onOpenNotes(project.Project_ID, product.Product_ID)}>
                                    <MessageSquareText size={19} />
                                    Pitanja i napomene{notes.total > 0 ? ` · ${notes.total}` : ''}
                                </MButton>
                            )}
                            {onOpenCutlist && (
                                <MButton variant="tinted" onClick={() => onOpenCutlist(product)}>
                                    <Scissors size={19} /> Krojenje ploča
                                </MButton>
                            )}
                            <MButton variant="tinted" onClick={() => onEditProduct(project.Project_ID, product)}>
                                <Pencil size={19} /> Uredi proizvod
                            </MButton>
                        </div>
                    </>
                )}
            </div>

            {/* Potvrda brisanja materijala (rezervisano za buduću swipe-akciju) */}
            <MSheet
                open={!!confirmDel}
                title="Ukloniti materijal?"
                onClose={() => setConfirmDel(null)}
                footer={
                    <div className="mui-stack mui-gap10 mui-pt14">
                        <MButton variant="danger" onClick={() => {
                            if (confirmDel) onDeleteMaterial(confirmDel.ID);
                            setConfirmDel(null);
                        }}>
                            <Trash2 size={19} /> Ukloni
                        </MButton>
                        <MButton variant="tinted" onClick={() => setConfirmDel(null)}>Odustani</MButton>
                    </div>
                }
            >
                <p className="mwd-sheet-note">„{confirmDel?.Material_Name}" se uklanja iz proizvoda.</p>
            </MSheet>
        </div>,
        document.body
    );
}
