import { belongsToProject, groupProjectMaterials, projectMaterialRows, shiftDate, weekStart } from '../projectCommand';
import type { PlanBlock, Project } from '../types';

test('groups by product ID and sorts products and materials alphabetically without merging names', () => {
    const rows = [
        { productId: 'b', productName: 'Stol', name: 'Vijak' },
        { productId: 'a', productName: 'Klupa', name: 'Šarka' },
        { productId: 'b', productName: 'Stol', name: 'Drvo' },
        { productId: 'c', productName: 'Stol', name: 'Drvo' },
    ];
    const groups = groupProjectMaterials(rows, row => row);
    expect(groups.map(g => g.id)).toEqual(['a', 'b', 'c']);
    expect(groups[1].rows.map(m => m.name)).toEqual(['Drvo', 'Vijak']);
    expect(rows[0].name).toBe('Vijak');
});

test('calendar matches direct project, products and linked orders, never names alone', () => {
    const block: PlanBlock = { id: 'b', title: 'Project', kind: 'order', startISO: '2026-09-10', endISO: '2026-09-12' };
    const match = (extra: Partial<PlanBlock>) => belongsToProject({ ...block, ...extra }, 'p', new Set(['product']), new Set(['wo']));
    expect(match({ projectRef: { id: 'p', name: 'Project' } })).toBe(true);
    expect(match({ productRefs: [{ id: 'product', name: 'Product', qty: 1 }] })).toBe(true);
    expect(match({ linkedWorkOrderId: 'wo' })).toBe(true);
    expect(match({ projectRef: { id: 'other', name: 'Project' } })).toBe(false);
    expect(match({ productRefs: [{ name: 'Product', qty: 1 }] })).toBe(false);
});

test('calendar weeks cross month, year and daylight saving boundaries', () => {
    expect(weekStart('2026-09-13')).toBe('2026-09-07');
    expect(shiftDate('2026-12-28', 7)).toBe('2027-01-04');
    expect(shiftDate('2026-03-28', 2)).toBe('2026-03-30');
});

test('material demand includes product quantity and delivered stock but not pending delivery', () => {
    const project = { products: [{ Product_ID: 'p', Name: 'Stol', Quantity: 3, materials: [{ ID: 'm', Material_Name: 'Drvo', Quantity: 2, On_Stock: 1, Received_Quantity: 2, Ordered_Quantity: 3 }] }] } as Project;
    expect(projectMaterialRows(project)[0]).toMatchObject({ needed: 6, remaining: 3 });
});
