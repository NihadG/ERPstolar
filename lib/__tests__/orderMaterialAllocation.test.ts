import { allocationsAfterOrderQuantityChange, orderItemAllocations, planMaterialGroupOrder, splitMaterialQuantity } from '../orderMaterialAllocation';
import type { OrderItem } from '../types';

test('a grouped total is preserved exactly when divided among products', () => {
    expect(splitMaterialQuantity(3, [{ id: 'a', weight: 1 }, { id: 'b', weight: 1 }], 1))
        .toEqual({ a: 2, b: 1 });
    expect(splitMaterialQuantity(1.25, [{ id: 'a', weight: 1 }, { id: 'b', weight: 2 }]))
        .toEqual({ a: 0.417, b: 0.833 });
});

test('order-only surplus does not become a product material allocation', () => {
    const item = {
        Product_Material_ID: 'a', Product_Material_IDs: ['a', 'b'], Quantity: 15,
        Product_Material_Quantities: { a: 5, b: 5 },
    };
    expect(orderItemAllocations(item)).toEqual({ a: 5, b: 5 });
    expect(allocationsAfterOrderQuantityChange(item, 18)).toEqual({ a: 5, b: 5 });
    expect(allocationsAfterOrderQuantityChange(item, 6)).toEqual({ a: 3, b: 3 });
});

test('the same increased order can either update one product need or only the purchase order', () => {
    const members = [{ id: 'stol', needed: 5 }, { id: 'ormar', needed: 5 }];
    expect(planMaterialGroupOrder(15, members, undefined, true)).toEqual({
        allocations: { stol: 5, ormar: 5 }, orderOnlyExtra: 5, needIncrease: {},
    });
    expect(planMaterialGroupOrder(15, members, 'ormar', true)).toEqual({
        allocations: { stol: 5, ormar: 10 }, orderOnlyExtra: 0, needIncrease: { ormar: 5 },
    });
});

test('older orders without allocation data retain an even fallback', () => {
    const item = { Product_Material_ID: 'a', Product_Material_IDs: ['a', 'b'], Quantity: 5 };
    expect(orderItemAllocations(item)).toEqual({ a: 2.5, b: 2.5 });
});
