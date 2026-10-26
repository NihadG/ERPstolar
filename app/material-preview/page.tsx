'use client';

// ════════════════════════════════════════════════════════════════════
// /material-preview — PRAVE komponente kapija materijala nad izmišljenim nalozima
//
// Nalog i Narudžbe su iza prijave, pa se ovdje vide: puls narudžbi (kasni /
// na putu / treba uskoro), tab „Materijal" u nalogu i poruke koje bi Telegram
// bot poslao (pokretanje, najava, kapija) — iz istog lib/materialGates.
// ?w=380 suzi okvir kao na telefonu. U produkciji ruta ne postoji.
// ════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import { notFound } from 'next/navigation';
import { DataContext } from '@/context/DataContext';
import MaterialGatesPanel from '@/components/materials/MaterialGatesPanel';
import OrdersPulse from '@/components/materials/OrdersPulse';
import { DEFAULT_STOCK_RULES, dueAlerts } from '@/lib/materialGates';
import { workOrderGatesFrom } from '@/lib/materialGatesData';
import { checkMessage } from '@/lib/assistant/materialText';
import type { ItemProcessStatus, Material, Order, Project, ProductMaterial, WorkOrder } from '@/lib/types';

export const dynamic = 'force-dynamic';

const NAMES = ['Krojenje iverala', 'Kantiranje iverala', 'Sklapanje kutija', 'Krojenje MDF-a', 'Priprema furnira', 'Furniranje',
    'Srezivanje na tačnu mjeru', 'Kantiranje furnira', 'Probna montaža', 'Brušenje', 'Lakiranje', 'Završno sklapanje', 'Okivanje'];
const EDGES = [[0, 1], [1, 2], [2, 8], [3, 5], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 10], [10, 11], [11, 12]];
const graph = {
    nodes: NAMES.map((name, i) => ({ id: `n${i}`, name, itemIds: [] as string[] })),
    edges: EDGES.map(([a, b]) => ({ id: `e${a}-${b}`, source: `n${a}`, target: `n${b}` })),
};
const P = (done: number[], active: number[] = []): ItemProcessStatus[] => [
    ...done.map(i => ({ Process_Name: NAMES[i], Status: 'Završeno' as const })),
    ...active.map(i => ({ Process_Name: NAMES[i], Status: 'U toku' as const })),
];

const M = (id: string, product: string, name: string, qty: number, unit: string, extra: Partial<ProductMaterial> = {}): ProductMaterial => ({
    ID: id, Organization_ID: 'demo', Product_ID: product, Material_ID: '', Material_Name: name, Quantity: qty, Unit: unit,
    Unit_Price: 0, Total_Price: 0, Status: 'Nije naručeno', Supplier: 'Frischeis', Order_ID: '', ...extra,
});

const materials: ProductMaterial[] = [
    M('a1', 'p1', 'Iveral U702 18mm', 4, 'ploča', { Status: 'Primljeno' }),
    M('a2', 'p1', 'MDF 18mm', 3, 'ploča'),
    M('a3', 'p1', 'Furnir hrast 0,6', 22, 'm2', { Status: 'Na stanju' }),
    M('a4', 'p1', 'ABS kant traka 2mm', 40, 'm'),
    M('a5', 'p1', 'Lak vodeni mat', 4, 'l'),
    M('a6', 'p1', 'Šarke Blum CLIP top', 24, 'kom', { Material_ID: 'c-okov', Supplier: 'Blum' }),
    M('a7', 'p1', 'Ručke Häfele 160', 12, 'kom', { Status: 'Naručeno', Ordered_Quantity: 12, Order_ID: 'o2', Supplier: 'Häfele' }),
    M('a8', 'p1', 'Staklo float 4mm', 2, 'kom', { Material_ID: 'c-staklo', Supplier: 'Staklorez' }),
    M('a9', 'p1', 'Ljepilo D3', 1, 'kg'),
    M('b1', 'p2', 'Šarke Blum CLIP top', 12, 'kom', { Material_ID: 'c-okov', Supplier: 'Blum' }),
    M('b2', 'p2', 'Iveral U702 18mm', 2, 'ploča', { Status: 'Primljeno' }),
    M('c1', 'p3', 'Ručke Häfele 160', 8, 'kom', { Status: 'Naručeno', Ordered_Quantity: 8, Order_ID: 'o2', Supplier: 'Häfele' }),
    M('c2', 'p3', 'Ogledalo 4mm', 1, 'kom', { Status: 'Primljeno' }),
    M('c3', 'p3', 'Iveral bijeli 18mm', 3, 'ploča', { Status: 'Primljeno' }),
];
const catalog = [
    { Material_ID: 'c-okov', Name: 'Šarke Blum CLIP top', Category: 'Okovi' },
    { Material_ID: 'c-staklo', Name: 'Staklo float 4mm', Category: 'Staklo', Is_Glass: true },
] as Material[];

const projects = [
    { Project_ID: 'pj1', Client_Name: 'Jerko Čorluka', products: [
        { Product_ID: 'p1', Name: 'Donji elementi', Quantity: 1, materials: materials.filter(m => m.Product_ID === 'p1') },
        { Product_ID: 'p2', Name: 'Gornji elementi', Quantity: 1, materials: materials.filter(m => m.Product_ID === 'p2') },
    ] },
    { Project_ID: 'pj2', Client_Name: 'Begović', products: [
        { Product_ID: 'p3', Name: 'Ormar hodnik', Quantity: 1, materials: materials.filter(m => m.Product_ID === 'p3') },
    ] },
] as unknown as Project[];

const item = (id: string, wo: string, product: string, name: string, project: string, processes: ItemProcessStatus[]) =>
    ({ ID: id, Work_Order_ID: wo, Product_ID: product, Product_Name: name, Project_ID: project, Project_Name: '', Quantity: 1, Status: 'U toku', Processes: processes });

const wo1 = {
    Work_Order_ID: 'w1', Work_Order_Number: 'RN-12', Name: 'Kuhinja Jerko', Status: 'U toku', Process_Graph: graph,
    items: [
        item('i1', 'w1', 'p1', 'Donji elementi', 'pj1', P([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [10])),
        item('i2', 'w1', 'p2', 'Gornji elementi', 'pj1', P([0, 1], [2])),
    ],
} as unknown as WorkOrder;
const wo2 = {
    Work_Order_ID: 'w2', Work_Order_Number: 'RN-13', Name: 'Ormar Begović', Status: 'U toku',
    items: [item('i3', 'w2', 'p3', 'Ormar hodnik', 'pj2', [
        { Process_Name: 'Krojenje iverala', Status: 'Završeno' }, { Process_Name: 'Kantiranje iverala', Status: 'Završeno' },
        { Process_Name: 'Sklapanje kutija', Status: 'Završeno' }, { Process_Name: 'Okivanje', Status: 'U toku' },
    ])],
} as unknown as WorkOrder;
const fresh = { ...wo1, items: (wo1.items || []).map(i => ({ ...i, Processes: [] })) } as WorkOrder;

const orders = [
    { Order_ID: 'o1', Order_Number: 'N-41', Supplier_Name: 'Frischeis', Status: 'Poslano', Order_Date: '2026-10-15', Expected_Delivery: '2026-10-22' },
    { Order_ID: 'o2', Order_Number: 'N-44', Supplier_Name: 'Häfele', Status: 'Poslano', Order_Date: '2026-10-21', Expected_Delivery: '2026-10-29' },
    { Order_ID: 'o3', Order_Number: 'N-45', Supplier_Name: 'Staklorez', Status: 'Nacrt', Order_Date: '2026-10-25', Expected_Delivery: '' },
] as unknown as Order[];

function TelegramBubble({ text, buttons }: { text: string; buttons: { text: string }[][] }) {
    return (
        <div style={{ background: '#fff', borderRadius: 14, boxShadow: '0 1px 2px rgba(0,0,0,.12)', maxWidth: 420, overflow: 'hidden' }}>
            <div style={{ padding: '10px 12px', whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.45, color: '#1d1d1f' }}>{text}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 6, background: '#eef2f6' }}>
                {buttons.map((row, i) => (
                    <div key={i} style={{ display: 'flex', gap: 4 }}>
                        {row.map(b => (
                            <span key={b.text} style={{ flex: 1, textAlign: 'center', fontSize: 13, padding: '8px 6px', borderRadius: 8, background: 'rgba(0,0,0,.08)', color: '#1d1d1f', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.text}</span>
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
}

export default function MaterialPreview() {
    if (process.env.NODE_ENV === 'production') notFound();
    const [width, setWidth] = useState<number | null>(null);
    // Samo u pregledniku: redoslijed po bs abecedi zna se razlikovati između Node-a i preglednika.
    const [mounted, setMounted] = useState(false);
    useEffect(() => {
        const w = Number(new URLSearchParams(window.location.search).get('w'));
        if (w > 0) setWidth(w);
        setMounted(true);
    }, []);

    const appState = { projects, materials: catalog, orders, workOrders: [wo1, wo2] };
    const value = {
        appState, organizationId: '', loading: false, loadedCollections: new Set(),
        isTabLoaded: () => true, loadTabData: async () => undefined,
    } as never;

    const messages = useMemo(() => {
        const src = { projects, materials: catalog, orders, stock: DEFAULT_STOCK_RULES };
        const out: { title: string; text: string; buttons: { text: string }[][] }[] = [];
        const TITLE = { start: 'Pri pokretanju (jedan red označen)', pre: 'Najava (≤ 2 koraka prije)', gate: 'Kapija (proces počeo)' } as const;
        const add = (wo: WorkOrder, seen: string[]) => {
            const { alerts } = dueAlerts(true, workOrderGatesFrom(wo, src), new Set(seen));
            alerts.forEach(a => {
                const m = checkMessage({ id: 'x', kind: a.kind, label: wo.Name || '', processes: a.processes, rows: a.rows, longLead: a.longLead, selected: a.kind === 'start' ? [0] : [] });
                out.push({ title: TITLE[a.kind], ...m });
            });
        };
        add(fresh, []);
        add(wo1, ['start']);
        add(wo2, ['start']);
        return out;
    }, []);

    if (!mounted) return null;
    return (
        <DataContext.Provider value={value}>
            <div style={{ minHeight: '100vh', background: 'var(--surface)', padding: 24 }}>
                <div style={{ maxWidth: width || 920, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>
                    <section>
                        <h2 style={{ fontSize: 18, margin: '0 0 12px 24px' }}>Narudžbe — puls</h2>
                        <OrdersPulse orders={orders} />
                    </section>
                    <section style={{ background: 'var(--surface)' }}>
                        <h2 style={{ fontSize: 18, margin: '0 0 12px' }}>Nalog „Kuhinja Jerko" → Materijal</h2>
                        <MaterialGatesPanel workOrder={wo1} showToast={(m) => console.log(m)} />
                    </section>
                    <section>
                        <h2 style={{ fontSize: 18, margin: '0 0 12px' }}>Telegram poruke</h2>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, background: '#dfe7ec', padding: 16, borderRadius: 12 }}>
                            {messages.map((m, i) => (
                                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    <span style={{ fontSize: 12, color: '#555' }}>{m.title}</span>
                                    <TelegramBubble text={m.text} buttons={m.buttons} />
                                </div>
                            ))}
                        </div>
                    </section>
                </div>
            </div>
        </DataContext.Provider>
    );
}
