import type { PlanBlock, Project } from './types';

const alphabet = new Intl.Collator('bs', { numeric: true, sensitivity: 'base' });

/** Keep identical materials in different products separate, including duplicate product names. */
export function groupProjectMaterials<T>(rows: T[], identify: (row: T) => { productId: string; productName: string; name: string }) {
    const groups = new Map<string, { id: string; name: string; rows: T[] }>();
    for (const row of rows) {
        const ref = identify(row);
        const id = ref.productId || ref.productName || '__unassigned__';
        const group = groups.get(id) || { id, name: ref.productName || 'Bez proizvoda', rows: [] };
        group.rows.push(row);
        groups.set(id, group);
    }
    return Array.from(groups.values()).sort((a, b) => alphabet.compare(a.name, b.name)).map(group => ({
        ...group, rows: group.rows.sort((a, b) => alphabet.compare(identify(a).name, identify(b).name)),
    }));
}

export function belongsToProject(block: PlanBlock, projectId: string, productIds: Set<string>, workOrderIds: Set<string>) {
    return block.projectRef?.id === projectId
        || (block.productRefs || []).some(ref => !!ref.id && productIds.has(ref.id))
        || (!!block.linkedWorkOrderId && workOrderIds.has(block.linkedWorkOrderId));
}

export function shiftDate(iso: string, days: number) {
    const date = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

export function weekStart(iso: string) {
    const day = new Date(`${iso.slice(0, 10)}T12:00:00Z`).getUTCDay();
    return shiftDate(iso, -((day + 6) % 7));
}

export function projectMaterialRows(project: Project) {
    return (project.products || []).flatMap(product => (product.materials || []).map(material => {
        const needed = (material.Quantity || 0) * (product.Quantity > 0 ? product.Quantity : 1);
        return {
            ...material, productId: product.Product_ID, productName: product.Name || 'Proizvod',
            name: material.Material_Name, needed,
            remaining: Math.max(0, needed - (material.On_Stock || 0) - (material.Received_Quantity || 0)),
        };
    }));
}
