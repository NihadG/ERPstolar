'use client';

// ════════════════════════════════════════════════════════════════════
// DETALJ PONUDE — mobilni (full-screen)
//
// Ponuda je dokument s cijenom, pa je ovdje novac LEGITIMAN fokus
// (za razliku od naloga i proizvoda, gdje smeta na terenu).
//
// Zaključavanje: poslana/prihvaćena ponuda se ne mijenja slučajno — nudi se
// „Revidiraj" (nova verzija, original ostaje kao Revidirano), isto kao desktop.
// ════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    ArrowLeft, Send, Check, X, Printer, FileDown, Pencil, Trash2, GitBranch, Hammer,
} from 'lucide-react';
import type { Offer, Project } from '@/lib/types';
import { formatCurrency, formatDate } from '@/lib/utils';
import { isOfferStale } from '@/lib/offerPricing';
import {
    MSegmented, MSection, MList, MItem, MCell, MText, MValue, MPill,
    MActions, MAction, MButton, MSheet, MOption, MEmpty,
} from './MobileUI';
import { useSwipeBack } from './useSwipe';
import { useOverlayGuard } from './overlayGuard';
import './MobileUI.css';
import './MobileWorkOrderDetail.css';

interface Props {
    offer: Offer;
    projects?: Project[];
    onClose: () => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
    onEdit: (offer: Offer) => void;
    onDelete: (offerId: string) => void;
    onUpdateStatus: (offerId: string, status: string) => void;
    onDownloadPDF: (offer: Offer) => void;
    onPrint: (offer: Offer) => void;
    onRevise?: (offer: Offer) => void;
    onCreateWorkOrder?: (offer: Offer) => void;
}

export const offerTone = (s?: string) =>
    s === 'Prihvaćeno' ? 'green'
        : s === 'Poslano' ? 'blue'
            : s === 'Odbijeno' ? 'red'
                : s === 'Isteklo' ? 'orange' : 'gray';

/** Poslana/prihvaćena ponuda je dokument kod klijenta — ne mijenja se u mjestu. */
export const isOfferLocked = (s?: string) => s === 'Poslano' || s === 'Prihvaćeno' || s === 'Revidirano';

export default function MobileOfferDetail({
    offer, projects = [], onClose, showToast, onEdit, onDelete,
    onUpdateStatus, onDownloadPDF, onPrint, onRevise, onCreateWorkOrder,
}: Props) {
    const [tab, setTab] = useState<'stavke' | 'info'>('stavke');
    const [statusSheet, setStatusSheet] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);

    const products = useMemo(() => (offer.products || []).filter(p => p.Included !== false), [offer.products]);
    const locked = isOfferLocked(offer.Status);
    const project = projects.find(p => p.Project_ID === offer.Project_ID);

    // Zastarjelost: snapshot cijena materijala ≠ trenutne cijene u katalogu.
    const stale = useMemo(() => {
        const all = projects.flatMap(p => p.products || []);
        try { return isOfferStale(offer, all); } catch { return false; }
    }, [offer, projects]);

    useEffect(() => {
        window.history.pushState({ moOfferDetail: true }, '');
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
    const swipeRef = useSwipeBack(goBack, { enabled: !statusSheet && !confirmDelete });

    const pdvAmount = offer.Include_PDV
        ? (offer.Total || 0) - (offer.Subtotal || 0) - (offer.Transport_Cost || 0)
        : 0;

    if (typeof document === 'undefined') return null;

    return createPortal(
        <div
            className="mui mwd"
            ref={swipeRef}
        >
            <header className="mwd-nav">
                <button type="button" className="mwd-back" onClick={goBack}>
                    <ArrowLeft size={21} strokeWidth={2.3} /> Ponude
                </button>
                <div className="mwd-nav-actions">
                    <button type="button" className="mwd-navbtn" onClick={() => onEdit(offer)} aria-label="Uredi">
                        <Pencil size={18} />
                    </button>
                    <button type="button" className="mwd-navbtn" onClick={() => onPrint(offer)} aria-label="Printaj">
                        <Printer size={19} />
                    </button>
                    <button type="button" className="mwd-navbtn danger" onClick={() => setConfirmDelete(true)} aria-label="Obriši">
                        <Trash2 size={19} />
                    </button>
                </div>
            </header>

            <div className="mwd-body">
                <div className="mui-large">
                    <h1>{offer.Name || `Ponuda ${offer.Offer_Number}`}</h1>
                    <p>
                        <MPill tone={offerTone(offer.Status)}>{offer.Status}</MPill>
                        <span>#{offer.Offer_Number}{offer.Client_Name ? ` · ${offer.Client_Name}` : project ? ` · ${project.Client_Name}` : ''}</span>
                    </p>
                </div>

                {/* Iznos je svrha ponude — zato hero, za razliku od naloga. */}
                <div className="mui-hero">
                    <span className="mui-hero-k">Ukupno{offer.Include_PDV ? ' s PDV-om' : ''}</span>
                    <div className="mui-hero-row">
                        <div className="mui-hero-v mui-num">{formatCurrency(offer.Total || 0)}</div>
                        {offer.Valid_Until && <span className="mui-hero-chip">važi do {formatDate(offer.Valid_Until)}</span>}
                    </div>
                </div>

                {stale && (
                    <div className="mwd-warn">
                        Cijene materijala su se promijenile od kreiranja ponude — provjeri prije slanja.
                    </div>
                )}

                <MActions>
                    {offer.Status === 'Nacrt' && (
                        <MAction tone="blue" onClick={() => onUpdateStatus(offer.Offer_ID, 'Poslano')}>
                            <Send size={18} /> Pošalji
                        </MAction>
                    )}
                    {offer.Status === 'Poslano' && (
                        <>
                            <MAction tone="green" onClick={() => onUpdateStatus(offer.Offer_ID, 'Prihvaćeno')}>
                                <Check size={18} /> Prihvaćeno
                            </MAction>
                            <MAction tone="rtint" onClick={() => onUpdateStatus(offer.Offer_ID, 'Odbijeno')}>
                                <X size={18} /> Odbijeno
                            </MAction>
                        </>
                    )}
                    {offer.Status === 'Prihvaćeno' && onCreateWorkOrder && (
                        <MAction tone="green" onClick={() => onCreateWorkOrder(offer)}>
                            <Hammer size={18} /> Kreiraj nalog
                        </MAction>
                    )}
                    {offer.Status !== 'Nacrt' && (
                        <MAction tone="tint" onClick={() => setStatusSheet(true)}>Status</MAction>
                    )}
                </MActions>

                <MSegmented<'stavke' | 'info'>
                    value={tab}
                    onChange={setTab}
                    options={[
                        { id: 'stavke', label: `Stavke ${products.length}` },
                        { id: 'info', label: 'Info' },
                    ]}
                />

                {tab === 'stavke' && (
                    products.length === 0 ? (
                        <MEmpty title="Ponuda nema stavki" sub="Dodaj proizvode kroz uređivanje ponude.">
                            <div style={{ width: '100%', paddingTop: 14 }}>
                                <MButton variant="tinted" onClick={() => onEdit(offer)}>Uredi ponudu</MButton>
                            </div>
                        </MEmpty>
                    ) : (
                        <>
                            <MSection title="Proizvodi" />
                            <MList>
                                {products.map(p => (
                                    <MItem key={p.ID}>
                                        <MCell>
                                            <MText
                                                title={p.Product_Name}
                                                sub={`×${p.Quantity || 1}${p.Selling_Price ? ` · ${formatCurrency(p.Selling_Price)}/kom` : ''}${(p.extras?.length || 0) > 0 ? ` · ${p.extras!.length} dodatak` : ''}`}
                                            />
                                            <MValue strong>{formatCurrency(p.Total_Price || 0)}</MValue>
                                        </MCell>
                                    </MItem>
                                ))}
                            </MList>

                            <MSection title="Obračun" />
                            <MList>
                                <MItem><MCell><MText title="Osnovica" /><MValue strong>{formatCurrency(offer.Subtotal || 0)}</MValue></MCell></MItem>
                                {(offer.Transport_Cost || 0) > 0 && (
                                    <MItem><MCell><MText title="Transport" /><MValue strong>{formatCurrency(offer.Transport_Cost)}</MValue></MCell></MItem>
                                )}
                                {(offer.Onsite_Discount || 0) > 0 && (
                                    <MItem><MCell><MText title="Popust (montaža)" /><MValue strong>−{formatCurrency(offer.Onsite_Discount)}</MValue></MCell></MItem>
                                )}
                                {offer.Include_PDV && (
                                    <MItem><MCell><MText title={`PDV ${offer.PDV_Rate || 17}%`} /><MValue strong>{formatCurrency(pdvAmount)}</MValue></MCell></MItem>
                                )}
                                <MItem><MCell><MText title="Ukupno" /><MValue strong>{formatCurrency(offer.Total || 0)}</MValue></MCell></MItem>
                            </MList>

                            <div className="mui-stack mui-gap10 mui-pt14">
                                {locked ? (
                                    <>
                                        <p className="mwd-hint" style={{ margin: '0 4px 4px' }}>
                                            Ponuda je {offer.Status.toLowerCase()} — uređivanje mijenja dokument koji klijent već ima.
                                            Napravi reviziju da original ostane sačuvan.
                                        </p>
                                        {onRevise && (
                                            <MButton variant="filled" onClick={() => onRevise(offer)}>
                                                <GitBranch size={19} /> Revidiraj ponudu
                                            </MButton>
                                        )}
                                        <MButton variant="tinted" onClick={() => onEdit(offer)}>
                                            <Pencil size={19} /> Ipak uredi
                                        </MButton>
                                    </>
                                ) : (
                                    <MButton variant="filled" onClick={() => onEdit(offer)}>
                                        <Pencil size={19} /> Uredi stavke i cijene
                                    </MButton>
                                )}
                            </div>
                        </>
                    )
                )}

                {tab === 'info' && (
                    <>
                        <MSection title="Klijent" />
                        <MList>
                            <MItem><MCell><MText title="Naziv" /><MValue num={false}>{offer.Client_Name || project?.Client_Name || '—'}</MValue></MCell></MItem>
                            {offer.Client_Phone && <MItem><MCell><MText title="Telefon" /><MValue num={false}>{offer.Client_Phone}</MValue></MCell></MItem>}
                            {offer.Client_Email && <MItem><MCell><MText title="E-mail" /><MValue num={false}>{offer.Client_Email}</MValue></MCell></MItem>}
                            {offer.Client_Address && <MItem><MCell><MText title="Adresa" /><MValue num={false}>{offer.Client_Address}</MValue></MCell></MItem>}
                        </MList>

                        <MSection title="Ponuda" />
                        <MList>
                            <MItem><MCell><MText title="Broj" /><MValue num={false}>#{offer.Offer_Number}</MValue></MCell></MItem>
                            <MItem><MCell><MText title="Kreirana" /><MValue num={false}>{formatDate(offer.Created_Date)}</MValue></MCell></MItem>
                            {offer.Valid_Until && <MItem><MCell><MText title="Važi do" /><MValue num={false}>{formatDate(offer.Valid_Until)}</MValue></MCell></MItem>}
                            {offer.Accepted_Date && <MItem><MCell><MText title="Prihvaćena" /><MValue num={false}>{formatDate(offer.Accepted_Date)}</MValue></MCell></MItem>}
                            <MItem><MCell><MText title="PDV" /><MValue num={false}>{offer.Include_PDV ? `${offer.PDV_Rate || 17}%` : 'bez PDV-a'}</MValue></MCell></MItem>
                        </MList>

                        {offer.Notes && (
                            <>
                                <MSection title="Napomena" />
                                <MList><MItem><MCell><MText title={offer.Notes} /></MCell></MItem></MList>
                            </>
                        )}

                        <div className="mui-stack mui-gap10 mui-pt14">
                            <MButton variant="tinted" onClick={() => onDownloadPDF(offer)}>
                                <FileDown size={19} /> Preuzmi PDF
                            </MButton>
                            <MButton variant="tinted" onClick={() => onPrint(offer)}>
                                <Printer size={19} /> Printaj
                            </MButton>
                        </div>
                    </>
                )}
            </div>

            {/* Promjena statusa */}
            <MSheet open={statusSheet} title="Status ponude" onClose={() => setStatusSheet(false)}>
                <MList>
                    {['Nacrt', 'Poslano', 'Prihvaćeno', 'Odbijeno', 'Isteklo'].map(s => (
                        <MOption
                            key={s}
                            label={s}
                            selected={offer.Status === s}
                            onClick={() => { setStatusSheet(false); if (s !== offer.Status) onUpdateStatus(offer.Offer_ID, s); }}
                        />
                    ))}
                </MList>
            </MSheet>

            {/* Brisanje */}
            <MSheet
                open={confirmDelete}
                title="Obrisati ponudu?"
                onClose={() => setConfirmDelete(false)}
                footer={
                    <div className="mui-stack mui-gap10 mui-pt14">
                        <MButton variant="danger" onClick={() => { setConfirmDelete(false); onDelete(offer.Offer_ID); onClose(); }}>
                            <Trash2 size={19} /> Obriši ponudu
                        </MButton>
                        <MButton variant="tinted" onClick={() => setConfirmDelete(false)}>Odustani</MButton>
                    </div>
                }
            >
                <p className="mwd-sheet-note">Ponuda #{offer.Offer_Number} se trajno briše.</p>
            </MSheet>
        </div>,
        document.body
    );
}
