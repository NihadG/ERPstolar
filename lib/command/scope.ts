// ════════════════════════════════════════════════════════════════════
// KOMANDNI CENTAR — ŠTA PRIPADA TABLI
//
// Nijedna veza u ovoj bazi ne ide direktno „nalog → projekat":
//   • radni nalog dodiruje projekat preko items[].Project_ID
//   • narudžba preko items[].Project_ID
//   • zadatak preko Links[] (project | product | work_order)
// Zato se pripadnost izvodi na JEDNOM mjestu, pa je svi kontejneri i
// kalendar dijele — inače bi Nalozi panel i kalendar znali pokazati
// različite skupove za isti projekat.
// ════════════════════════════════════════════════════════════════════

import type { Order, Product, Project, Task, WorkOrder } from '../types';

export interface BoardScope {
    projects: Project[];
    projectIds: Set<string>;
    /** Product_ID → Project_ID (samo proizvodi s table). */
    productProject: Map<string, string>;
    /** Product_ID → proizvod. */
    products: Map<string, Product>;
    /** Work_Order_ID → projekti kojih se nalog tiče (redoslijed table). */
    workOrderProjects: Map<string, string[]>;
    workOrders: WorkOrder[];
    orders: Order[];
    tasks: Task[];
    /** Project_ID → redni broj na tabli (za stabilno sortiranje grupa). */
    order: Map<string, number>;
}

export function buildScope(
    projects: Project[],
    workOrders: WorkOrder[],
    orders: Order[],
    tasks: Task[],
): BoardScope {
    const projectIds = new Set(projects.map(p => p.Project_ID));
    const order = new Map(projects.map((p, i) => [p.Project_ID, i]));
    const productProject = new Map<string, string>();
    const products = new Map<string, Product>();
    for (const project of projects) {
        for (const product of project.products || []) {
            productProject.set(product.Product_ID, project.Project_ID);
            products.set(product.Product_ID, product);
        }
    }

    const workOrderProjects = new Map<string, string[]>();
    const boardWorkOrders: WorkOrder[] = [];
    for (const wo of workOrders) {
        const touched = uniqueInBoardOrder((wo.items || []).map(i => i.Project_ID), projectIds, order);
        if (touched.length === 0) continue;
        workOrderProjects.set(wo.Work_Order_ID, touched);
        boardWorkOrders.push(wo);
    }

    const boardOrders = orders.filter(o => (o.items || []).some(i => !!i.Project_ID && projectIds.has(i.Project_ID)));
    const workOrderIds = new Set(boardWorkOrders.map(w => w.Work_Order_ID));
    const boardTasks = tasks.filter(t => (t.Links || []).some(link =>
        (link.Entity_Type === 'project' && projectIds.has(link.Entity_ID))
        || (link.Entity_Type === 'product' && productProject.has(link.Entity_ID))
        || (link.Entity_Type === 'work_order' && workOrderIds.has(link.Entity_ID))
    ));

    return {
        projects, projectIds, productProject, products, workOrderProjects,
        workOrders: boardWorkOrders, orders: boardOrders, tasks: boardTasks, order,
    };
}

/** Projekat kojem zadatak pripada — prva veza koja pogodi tablu, po redoslijedu table. */
export function taskProject(task: Task, scope: BoardScope): string | undefined {
    let best: string | undefined;
    let bestRank = Number.POSITIVE_INFINITY;
    for (const link of task.Links || []) {
        const projectId = link.Entity_Type === 'project' && scope.projectIds.has(link.Entity_ID) ? link.Entity_ID
            : link.Entity_Type === 'product' ? scope.productProject.get(link.Entity_ID)
            : link.Entity_Type === 'work_order' ? scope.workOrderProjects.get(link.Entity_ID)?.[0]
            : undefined;
        if (!projectId) continue;
        const rank = scope.order.get(projectId) ?? Number.POSITIVE_INFINITY;
        if (rank < bestRank) { best = projectId; bestRank = rank; }
    }
    return best;
}

/** Proizvod na koji je zadatak vezan (ako jeste) — za grupisanje ceduljica. */
export function taskProduct(task: Task, scope: BoardScope): string | undefined {
    return (task.Links || []).find(l => l.Entity_Type === 'product' && scope.productProject.has(l.Entity_ID))?.Entity_ID;
}

export function isTaskOpen(task: Task): boolean {
    return task.Status !== 'completed' && task.Status !== 'cancelled';
}

export function isWorkOrderOpen(wo: Pick<WorkOrder, 'Status'>): boolean {
    return wo.Status !== 'Završeno' && wo.Status !== 'Otkazano';
}

function uniqueInBoardOrder(ids: (string | undefined)[], allowed: Set<string>, order: Map<string, number>): string[] {
    const seen = new Set<string>();
    for (const id of ids) if (id && allowed.has(id)) seen.add(id);
    return Array.from(seen).sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
}
