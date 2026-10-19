'use client';

// ════════════════════════════════════════════════════════════════════
// PONUDA PRIHVAĆENA — veza s proizvodnjom + „Kreiraj radni nalog?"
//
// Proizvod smije u nalog prije ponude (lib/offerProductionLink). Kad klijent
// prihvati ponudu, ovaj upit odgovara na dva pitanja:
//   • šta je VEĆ u proizvodnji — povezano automatski, profit od sada računa
//     cijenu iz ove ponude (i za već završene proizvode);
//   • šta još NIJE u nalogu — samo za to se nudi novi radni nalog.
// Ranije se nalog nudio za sve proizvode ponude, pa je čarobnjak odbijao one
// koji su već bili u proizvodnji („Nedovoljna preostala količina").
// ════════════════════════════════════════════════════════════════════

import type { Offer } from '@/lib/types';
import type { OfferProductionLink } from '@/lib/offerProductionLink';
import { CheckCircle2, Link2, PlusCircle } from 'lucide-react';
import Modal from './Modal';
import './OfferAcceptedModal.css';

export interface OfferAcceptedWorkOrderProduct {
    productId: string;
    productName: string;
    quantity: number;
}

interface Props {
    offer: Offer;
    /** Veza s nalozima projekta; bez nje (čitanje palo) se nudi nalog za sve uključene proizvode. */
    production?: OfferProductionLink;
    onClose: () => void;
    onCreateWorkOrder?: (products: OfferAcceptedWorkOrderProduct[]) => void;
}

const qtyLabel = (n: number) => `× ${Math.round(n * 100) / 100}`;

export default function OfferAcceptedModal({ offer, production, onClose, onCreateWorkOrder }: Props) {
    const linked = production?.linked || [];
    const toStart: OfferAcceptedWorkOrderProduct[] = production
        ? production.toStart
        : (offer.products || [])
            .filter(p => p.Included !== false)
            .map(p => ({ productId: p.Product_ID, productName: p.Product_Name, quantity: p.Quantity || 1 }));
    const canCreate = !!onCreateWorkOrder && toStart.length > 0;

    return (
        <Modal
            isOpen
            onClose={onClose}
            className="oacc-modal"
            title={
                <span className="oacc-title">
                    <CheckCircle2 size={20} className="oacc-title-icon" />
                    Ponuda prihvaćena: {offer.Name || offer.Offer_Number}
                </span>
            }
            footer={canCreate ? (
                <>
                    <button className="btn btn-secondary" onClick={onClose}>Ne sada</button>
                    <button className="btn btn-primary" onClick={() => { onCreateWorkOrder!(toStart); onClose(); }}>
                        Kreiraj radni nalog
                    </button>
                </>
            ) : (
                <button className="btn btn-primary" onClick={onClose}>U redu</button>
            )}
        >
            <div className="oacc">
                {linked.length > 0 && (
                    <section className="oacc-sec">
                        <header className="oacc-sec-head">
                            <Link2 size={15} />
                            <b>Već u proizvodnji — povezano s ponudom</b>
                            <span className="oacc-count">{linked.length}</span>
                        </header>
                        <p className="oacc-hint">Ovi proizvodi su pušteni prije ponude. Profit od sada računa cijenu iz ove ponude — ništa ne treba unositi ručno.</p>
                        <ul className="oacc-list">
                            {linked.map(l => (
                                <li key={l.productId} className="oacc-row">
                                    <span className="oacc-name">{l.productName}</span>
                                    <span className="oacc-qty">{qtyLabel(l.inProductionQty)}</span>
                                    <span className={`oacc-stage ${l.finished ? 'done' : 'wip'}`}>{l.finished ? 'Završeno' : 'U izradi'}</span>
                                    <span className="oacc-wo">{l.workOrderNumbers.length ? `Nalog ${l.workOrderNumbers.join(', ')}` : ''}</span>
                                </li>
                            ))}
                        </ul>
                    </section>
                )}

                {toStart.length > 0 && (
                    <section className="oacc-sec">
                        <header className="oacc-sec-head">
                            <PlusCircle size={15} />
                            <b>{linked.length > 0 ? 'Još nije u nalogu' : 'Proizvodi ponude'}</b>
                            <span className="oacc-count">{toStart.length}</span>
                        </header>
                        {onCreateWorkOrder && (
                            <p className="oacc-hint">Da li želiš odmah kreirati radni nalog za ove proizvode? Otvoriće se čarobnjak u Proizvodnji s predodabranim proizvodima.</p>
                        )}
                        <ul className="oacc-list">
                            {toStart.map(p => (
                                <li key={p.productId} className="oacc-row">
                                    <span className="oacc-name">{p.productName}</span>
                                    <span className="oacc-qty">{qtyLabel(p.quantity)}</span>
                                </li>
                            ))}
                        </ul>
                    </section>
                )}

                {linked.length > 0 && toStart.length === 0 && (
                    <p className="oacc-done">Svi proizvodi ove ponude su već u proizvodnji — novi nalog nije potreban.</p>
                )}
            </div>
        </Modal>
    );
}
