'use client';

// ════════════════════════════════════════════════════════════════════
// /orders-preview — MAKETA stavki narudžbe (desktop pregled + PDF)
//
// Tab Narudžbe je iza prijave. Ova ruta renderuje PRAVU listu stavki
// (OrderItemGroupList, ista kao u proširenoj narudžbi) i PRAVI dokument
// koji ide dobavljaču (buildOrderPrintDocument) nad narudžbom u kojoj se
// isti materijal ponavlja na više pozicija — da se vidi grupisanje.
//
// U produkciji ruta ne postoji.
// ════════════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import { notFound } from 'next/navigation';
import OrderItemGroupList from '@/components/tabs/OrderItemGroupList';
import { buildOrderPrintDocument } from '@/lib/print/orderDocument';
import { demoProjects } from '@/lib/command/demoData';
import type { Order, OrderItem } from '@/lib/types';
import '@/components/tabs/OrdersTab.css';

export const dynamic = 'force-dynamic';

const it = (id: string, name: string, product: string, qty: number, unit: string, price: number, status = 'Naručeno', received?: string): OrderItem => ({
    ID: id, Order_ID: 'o-demo', Product_Material_ID: `pm-${id}`, Product_ID: `p-${product}`, Product_Name: product,
    Project_ID: 'pr-aamanns', Material_Name: name, Quantity: qty, Unit: unit, Expected_Price: qty * price,
    Actual_Price: 0, Received_Quantity: status === 'Primljeno' ? qty : 0, Status: status, Received_Date: received,
});

const items: OrderItem[] = [
    it('1', 'Vodilice Blum TANDEM 500', 'Kuhinja donji elementi', 10, 'kom', 18),
    it('2', 'Iveral bijeli 18mm', 'Kuhinja donji elementi', 6, 'm²', 42),
    it('3', 'Iveral bijeli 18mm', 'Ormar hodnik', 4.5, 'm²', 42),
    it('4', 'Iveral  bijeli 18mm', 'Kupatilski element', 2, 'm²', 42, 'Primljeno', '2026-09-20'),
    it('5', 'Kant traka ABS 2mm', 'Kuhinja donji elementi', 24, 'm', 1.5),
    it('6', 'Šarke Blum CLIP top', 'Ormar hodnik', 8, 'kom', 6.4, 'Primljeno', '2026-09-21'),
    it('7', 'Kant traka ABS 2mm', 'Ormar hodnik', 16, 'm', 1.5),
    it('8', 'Aluminijska ručka 320', 'Kuhinja donji elementi', 12, 'kom', 9),
];

export default function OrdersPreviewPage() {
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [log, setLog] = useState('');

    const order = useMemo<Order>(() => ({
        Order_ID: 'o-demo', Organization_ID: 'demo', Order_Number: '2026-050', Supplier_ID: 's', Supplier_Name: 'Frischeis',
        Order_Date: '2026-09-18', Status: 'Poslano', Expected_Delivery: '2026-09-25',
        Total_Amount: items.reduce((s, i) => s + i.Expected_Price, 0), Notes: 'Isporuka u radionicu do 10h.', items,
    }), []);

    const doc = useMemo(() => buildOrderPrintDocument({
        order, projects: demoProjects,
        company: { name: 'Stolarija Demo', address: 'Industrijska 4, Sarajevo', phone: '033 000 000', email: 'info@demo.ba' },
    }), [order]);

    if (process.env.NODE_ENV === 'production') notFound();

    return (
        <div style={{ padding: 24, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 820px', gap: 24, alignItems: 'start', background: '#f5f5f7', minHeight: '100vh' }}>
            <div style={{ background: '#fff', borderRadius: 16, overflow: 'hidden', border: '1px solid #e5e5ea' }}>
                <div className="project-products expanded" id="orders-preview-list">
                    <OrderItemGroupList
                        order={order}
                        projects={demoProjects}
                        selectedItemIds={selected}
                        onSelectItems={(ids, on) => setSelected(prev => {
                            const next = new Set(prev);
                            ids.forEach(id => { if (on) next.add(id); else next.delete(id); });
                            return next;
                        })}
                        onReceiveSelected={() => setLog(`Primi: ${Array.from(selected).join(', ')}`)}
                        onUnreceive={its => setLog(`Vrati: ${its.map(i => i.ID).join(', ')}`)}
                    />
                </div>
                {log && <pre style={{ margin: 16, fontSize: 12 }}>{log}</pre>}
            </div>
            <div id="orders-preview-pdf" style={{ background: '#fff', boxShadow: '0 4px 20px rgba(0,0,0,.08)' }}>
                <style>{doc.css}</style>
                <div dangerouslySetInnerHTML={{ __html: doc.body }} />
            </div>
        </div>
    );
}
