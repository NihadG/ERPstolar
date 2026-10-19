'use client';

// ════════════════════════════════════════════════════════════════════
// /offer-accepted-preview — upit „Ponuda prihvaćena" bez prijave
//
// Renderuje PRAVI OfferAcceptedModal; veza s proizvodnjom se gradi PRAVOM
// logikom (linkOfferToProduction) nad izmišljenim projektom u kojem su neki
// proizvodi pušteni u nalog prije ponude.
//   ?v=mix  (podrazumijevano) — dio završen, dio u izradi, dio još nije u nalogu
//   ?v=all  — sve već u proizvodnji (samo „U redu", bez novog naloga)
//   ?v=none — ništa nije u nalogu (stari upit „Kreiraj radni nalog?")
//
// U produkciji ruta ne postoji.
// ════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import { notFound } from 'next/navigation';
import OfferAcceptedModal from '@/components/ui/OfferAcceptedModal';
import { linkOfferToProduction, type LinkItem, type LinkWorkOrder } from '@/lib/offerProductionLink';
import type { Offer, OfferProduct } from '@/lib/types';

export const dynamic = 'force-dynamic';

const op = (id: string, name: string, qty: number): OfferProduct =>
    ({ ID: `op-${id}`, Offer_ID: 'o-demo', Product_ID: id, Product_Name: name, Quantity: qty, Included: true, Selling_Price: 1000 } as unknown as OfferProduct);

const offer = {
    Offer_ID: 'o-demo', Offer_Number: 'P-2026/31', Name: 'Kuća Čorluka — faza 2', Project_ID: 'pr-demo', Status: 'Prihvaćeno',
    products: [
        op('st5a', 'ST5.A Biblioteka dnevni boravak', 1),
        op('st6b', 'ST6.B Garderoba ormar', 2),
        op('poz3', 'Poz 3 - Vrata sa oblogom tehnička prostorija', 1),
        op('poz8', 'Poz 8 - Ostrvo', 1),
        op('poz9', 'Poz 9 - Ormar u WC', 1),
    ],
} as unknown as Offer;

const workOrders: LinkWorkOrder[] = [
    { Work_Order_ID: 'w1', Work_Order_Number: '2026-06/R1', Status: 'Završeno', Work_Order_Type: 'Proizvodnja' },
    { Work_Order_ID: 'w2', Work_Order_Number: '2026-07/R2', Status: 'U toku', Work_Order_Type: 'Proizvodnja' },
    { Work_Order_ID: 'w3', Work_Order_Number: '2026-06/R3', Status: 'Završeno', Work_Order_Type: 'Proizvodnja' },
];

const ITEMS: Record<string, LinkItem[]> = {
    mix: [
        { Product_ID: 'st5a', Quantity: 1, Status: 'Završeno', Work_Order_ID: 'w1' },
        { Product_ID: 'st6b', Quantity: 1, Status: 'U toku', Work_Order_ID: 'w2' },
        { Product_ID: 'poz3', Quantity: 1, Status: 'Završeno', Work_Order_ID: 'w3' },
    ],
    all: [
        { Product_ID: 'st5a', Quantity: 1, Status: 'Završeno', Work_Order_ID: 'w1' },
        { Product_ID: 'st6b', Quantity: 2, Status: 'U toku', Work_Order_ID: 'w2' },
        { Product_ID: 'poz3', Quantity: 1, Status: 'Završeno', Work_Order_ID: 'w3' },
        { Product_ID: 'poz8', Quantity: 1, Status: 'Završeno', Work_Order_ID: 'w3' },
        { Product_ID: 'poz9', Quantity: 1, Status: 'U toku', Work_Order_ID: 'w2' },
    ],
    none: [],
};

export default function OfferAcceptedPreviewPage() {
    if (process.env.NODE_ENV === 'production') notFound();
    const [variant, setVariant] = useState('mix');
    useEffect(() => { setVariant(new URLSearchParams(location.search).get('v') || 'mix'); }, []);
    const production = useMemo(
        () => linkOfferToProduction(offer.products || [], ITEMS[variant] || ITEMS.mix, workOrders),
        [variant],
    );
    const [open, setOpen] = useState(true);
    const [created, setCreated] = useState<string>('');

    return (
        <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif', background: 'var(--surface)', minHeight: '100vh' }}>
            <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text-secondary)' }}>
                Varijanta: <b>{variant}</b> · <a href="?v=mix">mix</a> · <a href="?v=all">all</a> · <a href="?v=none">none</a>
            </p>
            {!open && <button className="btn btn-primary" onClick={() => setOpen(true)}>Otvori ponovo</button>}
            {created && <p id="oacc-created" style={{ fontSize: 13 }}>Čarobnjak bi dobio: {created}</p>}
            {open && (
                <OfferAcceptedModal
                    offer={offer}
                    production={production}
                    onClose={() => setOpen(false)}
                    onCreateWorkOrder={(products) => setCreated(products.map(p => `${p.productName} × ${p.quantity}`).join(', '))}
                />
            )}
        </div>
    );
}
