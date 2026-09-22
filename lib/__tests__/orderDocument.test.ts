import { buildOrderPrintDocument, classifyOrderItems } from '../print/orderDocument';
import type { Order, OrderItem, Project } from '../types';

const item = (over: Partial<OrderItem>): OrderItem => ({
    ID: Math.random().toString(36).slice(2), Order_ID: 'O1', Product_Material_ID: '', Product_ID: '',
    Product_Name: '', Project_ID: 'pr-1', Material_Name: '', Quantity: 1, Unit: 'kom',
    Expected_Price: 0, Actual_Price: 0, Received_Quantity: 0, Status: 'Naručeno', ...over,
});

const projects = [{
    Project_ID: 'pr-1',
    products: [
        {
            Product_ID: 'p-a', Name: 'Vitrina A', materials: [
                { ID: 'pm-glass-a', glassItems: [{ Qty: 2, Width: 500, Height: 1000 }] },
            ],
        },
        {
            Product_ID: 'p-b', Name: 'Vitrina B', materials: [
                { ID: 'pm-glass-b', glassItems: [{ Qty: 1, Width: 400, Height: 800 }] },
            ],
        },
    ],
}] as unknown as Project[];

const order = (items: OrderItem[]): Order => ({
    Order_ID: 'O1', Organization_ID: 'org', Order_Number: '2026-050', Supplier_ID: '', Supplier_Name: 'Frischeis',
    Order_Date: '2026-09-22', Status: 'Nacrt', Expected_Delivery: '', Total_Amount: 0, Notes: '', items,
});

describe('dokument narudžbe — materijali grupisani', () => {
    const o = order([
        item({ Material_Name: 'Vodilice Blum 500', Quantity: 6, Product_Name: 'Klupe' }),
        item({ Material_Name: 'Iveral bijeli 18mm', Quantity: 4, Unit: 'm²', Product_Name: 'Klupe' }),
        item({ Material_Name: 'Iveral bijeli 18mm', Quantity: 2.5, Unit: 'm²', Product_Name: 'Stolovi' }),
        item({ Material_Name: 'Staklo float 4mm', Product_Material_ID: 'pm-glass-a', Unit: 'm²' }),
        item({ Material_Name: 'Staklo float 4mm', Product_Material_ID: 'pm-glass-b', Unit: 'm²' }),
    ]);

    test('isti materijal = jedan red sa zbirom, abecedno', () => {
        const { regular, glass } = classifyOrderItems(o, projects);
        expect(regular.map(g => [g.name, g.quantity])).toEqual([
            ['Iveral bijeli 18mm', 6.5],
            ['Vodilice Blum 500', 6],
        ]);
        // Staklo istog naziva s dvije pozicije → jedna sekcija sa SVIM komadima.
        expect(glass).toHaveLength(1);
        expect(glass[0].pieces).toHaveLength(2);
    });

    test('HTML nosi zbir i broj grupisanih stavki', () => {
        const doc = buildOrderPrintDocument({
            order: o, projects, company: { name: 'Firma', address: '', phone: '', email: '' },
        });
        expect(doc.body).toContain('Iveral bijeli 18mm');
        expect(doc.body.match(/Iveral bijeli 18mm/g)).toHaveLength(1);
        expect(doc.body).toContain('>6.5<');
        expect(doc.body).toContain('Ukupno stavki: 3');
    });
});
