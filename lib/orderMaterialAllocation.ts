import type { OrderItem } from './types';

/** Divide a displayed group total without changing the total through per-row rounding. */
export function splitMaterialQuantity(
    total: number,
    members: { id: string; weight: number }[],
    precision = 1000
): Record<string, number> {
    if (members.length === 0) return {};
    const units = Math.max(0, Math.round(total * precision));
    const weights = members.map(m => Math.max(0, m.weight));
    const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
    const exact = weights.map(weight => units * (weightSum ? weight / weightSum : 1 / members.length));
    const portions = exact.map(Math.floor);
    let remaining = units - portions.reduce((sum, portion) => sum + portion, 0);
    const byRemainder = exact.map((value, index) => ({ index, remainder: value - portions[index] }))
        .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
    for (let i = 0; i < remaining; i++) portions[byRemainder[i].index]++;
    return Object.fromEntries(members.map((member, index) => [member.id, portions[index] / precision]));
}

/** Plan the two possible meanings of a quantity above the selected products' need. */
export function planMaterialGroupOrder(
    total: number,
    members: { id: string; needed: number }[],
    assignedMaterialId?: string,
    wholePieces = false
): { allocations: Record<string, number>; orderOnlyExtra: number; needIncrease: Record<string, number> } {
    const needed = members.reduce((sum, member) => sum + member.needed, 0);
    const extra = Math.max(0, Math.round((total - needed) * 1000) / 1000);
    const allocations = splitMaterialQuantity(Math.min(total, needed),
        members.map(member => ({ id: member.id, weight: member.needed })), wholePieces ? 1 : 1000);
    const assigned = assignedMaterialId && members.some(member => member.id === assignedMaterialId) ? assignedMaterialId : undefined;
    if (assigned && extra > 0) {
        allocations[assigned] = Math.round(((allocations[assigned] || 0) + extra) * 1000) / 1000;
    }
    return {
        allocations,
        orderOnlyExtra: assigned ? 0 : extra,
        needIncrease: assigned && extra > 0 ? { [assigned]: extra } : {},
    };
}

/** Explicit allocations can sum below the order quantity: the rest was ordered for stock. */
export function orderItemAllocations(item: Pick<OrderItem, 'Product_Material_ID' | 'Product_Material_IDs' | 'Product_Material_Quantities' | 'Quantity'>): Record<string, number> {
    const ids = item.Product_Material_IDs?.length ? item.Product_Material_IDs
        : item.Product_Material_ID ? [item.Product_Material_ID] : [];
    if (item.Product_Material_Quantities) {
        return Object.fromEntries(ids
            .map(id => [id, Math.max(0, item.Product_Material_Quantities?.[id] || 0)] as const)
            .filter(([, quantity]) => quantity > 0));
    }
    return Object.fromEntries(Object.entries(splitMaterialQuantity(item.Quantity || 0, ids.map(id => ({ id, weight: 1 }))))
        .filter(([, quantity]) => quantity > 0));
}

/** Legacy rows are evenly split; new rows retain their product allocation on inline edits. */
export function allocationsAfterOrderQuantityChange(
    item: Pick<OrderItem, 'Product_Material_ID' | 'Product_Material_IDs' | 'Product_Material_Quantities' | 'Quantity'>,
    newQuantity: number
): Record<string, number> {
    const previous = orderItemAllocations(item);
    const allocated = Object.values(previous).reduce((sum, quantity) => sum + quantity, 0);
    if (newQuantity >= allocated) return previous;
    return splitMaterialQuantity(newQuantity, Object.entries(previous).map(([id, weight]) => ({ id, weight })));
}
