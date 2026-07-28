// ════════════════════════════════════════════════════════════════════
// PROJEKCIJA NARUDŽBI — šta je naručeno i šta je stiglo, bez cijena
//
// `Order` nosi Total_Amount, `OrderItem` nosi Expected_Price i Actual_Price.
// Ništa od toga ne izlazi. Kontrolora zanima materijal, količina i da li je
// stiglo — cijena je vlasnikova stvar.
//
// `lib/orderPricing.ts` se OVDJE NE SMIJE uvoziti; on je u cijelosti o novcu.
// ════════════════════════════════════════════════════════════════════

import type { Order, OrderItem } from '@/lib/types';

/** „Djelomično" je izveden prikaz — ne postoji u bazi ni u ORDER_STATUSES. */
export type PurchaseDisplayStatus = 'Nacrt' | 'Poslano' | 'Djelomično' | 'Primljeno';

export function purchaseDisplayStatus(order: Pick<Order, 'Status' | 'items'>): PurchaseDisplayStatus {
    const items = order.items || [];
    const total = items.length;
    const received = items.filter(i => i.Status === 'Primljeno').length;

    if (order.Status === 'Primljeno' || (total > 0 && received === total)) return 'Primljeno';
    if (order.Status === 'Poslano' && received > 0) return 'Djelomično';
    return (order.Status as PurchaseDisplayStatus) || 'Nacrt';
}

export interface FieldPurchaseRow {
    orderId: string;
    name: string;
    number: string;
    supplier: string;
    projectName: string;
    status: PurchaseDisplayStatus;
    itemCount: number;
    receivedCount: number;
    orderDate: string | null;
    expectedDelivery: string | null;
}

export interface FieldPurchaseItem {
    itemId: string;
    materialName: string;
    quantity: number;
    unit: string;
    productName: string;
    status: string;
    received: boolean;
    receivedDate: string | null;
}

export interface FieldPurchaseDetail extends FieldPurchaseRow {
    notes: string;
    items: FieldPurchaseItem[];
}

const dOnly = (iso?: string | null): string | null => (iso ? iso.split('T')[0] : null);

function projectNameOf(items: OrderItem[], projectNames: Map<string, string>): string {
    for (const it of items) {
        if (it.Project_ID && projectNames.has(it.Project_ID)) return projectNames.get(it.Project_ID)!;
    }
    return '';
}

function toRow(order: Order, projectNames: Map<string, string>): FieldPurchaseRow {
    const items = order.items || [];
    return {
        orderId: order.Order_ID,
        name: order.Name || `Narudžba ${order.Order_Number || ''}`.trim(),
        number: order.Order_Number || '',
        supplier: order.Supplier_Name || '',
        projectName: projectNameOf(items, projectNames),
        status: purchaseDisplayStatus(order),
        itemCount: items.length,
        receivedCount: items.filter(i => i.Status === 'Primljeno').length,
        orderDate: dOnly(order.Order_Date),
        expectedDelivery: dOnly(order.Expected_Delivery),
    };
}

export interface FieldPurchasesInput {
    orders: Order[];                       // sa `items`
    projectNames: Map<string, string>;
}

export function buildFieldPurchasesList(input: FieldPurchasesInput): FieldPurchaseRow[] {
    return input.orders
        .map(o => toRow(o, input.projectNames))
        // Ono što se čeka ide prvo; primljeno na dno. Unutar toga najskorija isporuka.
        .sort((a, b) => {
            const rank = (s: PurchaseDisplayStatus) =>
                s === 'Djelomično' ? 0 : s === 'Poslano' ? 1 : s === 'Nacrt' ? 2 : 3;
            return rank(a.status) - rank(b.status)
                || (a.expectedDelivery || '9999').localeCompare(b.expectedDelivery || '9999')
                || a.name.localeCompare(b.name, 'bs');
        });
}

export function buildFieldPurchaseDetail(order: Order, projectNames: Map<string, string>): FieldPurchaseDetail {
    const items = order.items || [];
    return {
        ...toRow(order, projectNames),
        notes: order.Notes || '',
        items: items
            .map(it => ({
                itemId: it.ID,
                materialName: it.Material_Name || 'Materijal',
                quantity: it.Quantity || 0,
                unit: it.Unit || '',
                productName: it.Product_Name || '',
                status: it.Status || 'Naručeno',
                received: it.Status === 'Primljeno',
                receivedDate: dOnly(it.Received_Date),
            }))
            // Neprimljeno prvo — to je ono što kontrolor upravo čekira.
            .sort((a, b) =>
                Number(a.received) - Number(b.received)
                || a.materialName.localeCompare(b.materialName, 'bs')
            ),
    };
}
