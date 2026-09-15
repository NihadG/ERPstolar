'use client';

// ════════════════════════════════════════════════════════════════════
// /cutlist-calc-preview — MAKETA kalkulatora ploča
//
// Kalkulator se u aplikaciji otvara iz modala "Dodaj Materijale", koji je
// iza prijave. Ova ruta ga renderuje samostalno (bez baze i bez prijave)
// da se izgled i ponašanje mogu provjeriti. U produkciji ne postoji.
// ════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import { notFound } from 'next/navigation';
import BoardCalculatorModal from '@/components/ui/BoardCalculatorModal';

export const dynamic = 'force-dynamic';

export default function CutlistCalcPreviewPage() {
    // Modal se otvara TEK nakon montiranja — inače se portal na document.body
    // ne poklopi sa serverskim HTML-om (hydration error).
    const [open, setOpen] = useState(false);
    const [qty, setQty] = useState(1);

    useEffect(() => { setOpen(true); }, []);

    if (process.env.NODE_ENV === 'production') notFound();

    return (
        <div style={{ padding: 40, fontFamily: 'system-ui, sans-serif' }}>
            <h1 style={{ fontSize: 18 }}>Maketa: kalkulator ploča</h1>
            <p style={{ fontSize: 13, color: '#6b7280' }}>
                Trenutna količina materijala: <strong>{qty} kom</strong>
            </p>
            <button onClick={() => setOpen(true)} style={{ padding: '8px 14px' }}>Otvori kalkulator</button>

            <BoardCalculatorModal
                isOpen={open}
                onClose={() => setOpen(false)}
                materialId="demo-iveral"
                materialName="Iveral / Pistacija U608 ST9"
                unit="kom"
                currentQuantity={qty}
                onApply={quantity => { setQty(quantity); setOpen(false); }}
            />
        </div>
    );
}
