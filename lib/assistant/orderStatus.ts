// ════════════════════════════════════════════════════════════════════
// STANJE NALOGA ZA BOTA — gotovo izračunato, model ne čita sirove redove
//
// Po nalogu: proizvodi, gdje je koji (proces u toku / sljedeći / gotov),
// zadnji dan rada i ko je radio (Knjiga rada). Ranije je model iz
// work_report-a prebirao stotine redova i promašivao datume.
// ════════════════════════════════════════════════════════════════════

import { addDays } from '@/lib/voice/dates';
import { itemSteps } from '@/lib/materialGates';
import { liveLogs } from '@/lib/projectFinance';
import { lastWorkDays } from '@/lib/workDiary';
import { formatQty } from '@/lib/orderItemGroups';
import { buildProjectHistory, type ProjectHistory } from '@/lib/projectHistory';
import { adminDb } from '@/lib/server/firebaseAdmin';
import {
    attachItems, getBookableWorkOrders, getItemsForWorkOrders, getOpenWorkOrders, getWorkLogsForWorkOrder,
} from '@/lib/server/fieldRepo';
import type { WorkOrder, WorkOrderItem } from '@/lib/types';
import { flowMapText, flowMapsText, type FlowMapOrder } from './flowMap';

const day = (iso?: string | null) => (iso ? `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.` : '');

export async function getOpenWorkOrderIdsForProject(orgId: string, projectId: string): Promise<string[]> {
    const open = await getOpenWorkOrders(orgId);
    const items = await getItemsForWorkOrders(orgId, open.map(o => o.Work_Order_ID));
    return Array.from(new Set(items.filter(i => i.Project_ID === projectId).map(i => i.Work_Order_ID)));
}

function itemState(item: WorkOrderItem, graph: Parameters<typeof itemSteps>[0]): string {
    if (item.Status === 'Završeno') return `gotov ${day(item.Completed_At)}`.trim();
    const steps = itemSteps(graph, { ID: item.ID, Product_ID: item.Product_ID, Product_Name: item.Product_Name, Status: item.Status, Processes: item.Processes });
    if (!steps.length) return 'bez plana procesa';
    const active = steps.filter(s => s.status === 'active').map(s => s.name);
    if (active.length) return `${active.join(' + ')} u toku`;
    const next = steps.filter(s => s.status === 'waiting' && s.distance === 0).map(s => s.name);
    const done = steps.filter(s => s.status === 'done').length;
    return next.length ? `sljedeće: ${next.join(' + ')} (${done}/${steps.length} koraka gotovo)` : `${done}/${steps.length} koraka gotovo`;
}

export async function orderStatusLines(orgId: string, workOrderIds: string[], today: string): Promise<string[]> {
    const orders = (await getBookableWorkOrders(orgId)).filter(o => workOrderIds.includes(o.Work_Order_ID));
    attachItems(orders, await getItemsForWorkOrders(orgId, orders.map(o => o.Work_Order_ID)));
    const out: string[] = [];
    const since = addDays(today, -14);
    for (const wo of orders) {
        const items = (wo.items || []).filter(i => i.Item_Type !== 'custom');
        const logs = liveLogs(await getWorkLogsForWorkOrder(orgId, wo.Work_Order_ID));
        const last = lastWorkDays(items, logs);
        const lastOrder = logs.reduce((m, l) => (String(l.Date).slice(0, 10) > m ? String(l.Date).slice(0, 10) : m), '');
        const firstOrder = logs.reduce((m, l) => (!m || String(l.Date).slice(0, 10) < m ? String(l.Date).slice(0, 10) : m), '');
        const days = logs.reduce((s, l) => s + (l.Day_Fraction || 0), 0);
        const recent = Array.from(new Set(logs.filter(l => String(l.Date).slice(0, 10) >= since).map(l => l.Worker_Name).filter(Boolean)));
        const doneCount = items.filter(i => i.Status === 'Završeno').length;
        out.push([
            `${wo.Name || wo.Work_Order_Number} (${wo.Status}): ${items.length} proizvoda, ${doneCount} gotovo`,
            lastOrder ? `prvi rad ${day(firstOrder)}, zadnji rad ${day(lastOrder)}` : 'bez upisanog rada',
            days ? `${formatQty(Math.round(days * 100) / 100)} dana ukupno` : '',
            recent.length ? `radili zadnjih 14 dana: ${recent.join(', ')}` : '',
        ].filter(Boolean).join(' · '));
        for (const i of items) {
            const l = last.get(i.ID);
            out.push(`  • ${i.Product_Name} — ${itemState(i, wo.Process_Graph)}${l && i.Status !== 'Završeno' ? ` · zadnji rad ${day(l)}` : ''}`);
        }
        // Cijeli tok naloga (kao tabla „Tok"): koji proces je gdje, ne samo front po proizvodu.
        const flow = flowMapText({ alias: '', name: wo.Name || wo.Work_Order_Number || 'Nalog', graph: wo.Process_Graph, items });
        if (flow) out.push('TOK PROCESA:', ...flow.split('\n').slice(1));
    }
    return out;
}

/** Tokovi naloga za prompt: samo otvoreni nalozi koje je poruka spomenula (R# oznaka uz svaki). */
export async function loadFlowMaps(orgId: string, refs: { alias: string; id: string; name: string }[]): Promise<string> {
    if (!refs.length) return '';
    const orders = (await getBookableWorkOrders(orgId)).filter(o => refs.some(r => r.id === o.Work_Order_ID));
    attachItems(orders, await getItemsForWorkOrders(orgId, orders.map(o => o.Work_Order_ID)));
    const maps: FlowMapOrder[] = orders.map(o => {
        const ref = refs.find(r => r.id === o.Work_Order_ID)!;
        return { alias: ref.alias, name: ref.name, graph: o.Process_Graph, items: o.items || [] };
    });
    return flowMapsText(maps);
}

/**
 * Istorija rada projekta (ili naloga) kroz SVE naloge, i završene — „kad smo počeli Čorluku".
 * Rad se broji samo na stavkama tog projekta (nalog može imati i tuđe proizvode).
 */
export async function loadProjectHistory(orgId: string, scope: { projectId?: string; workOrderIds?: string[] }): Promise<ProjectHistory> {
    const db = adminDb();
    let items: WorkOrderItem[];
    if (scope.projectId) {
        const snap = await db.collection('work_order_items').where('Organization_ID', '==', orgId).where('Project_ID', '==', scope.projectId).get();
        items = snap.docs.map(d => d.data() as WorkOrderItem);
    } else {
        items = await getItemsForWorkOrders(orgId, scope.workOrderIds || []);
    }
    const ids = Array.from(new Set(items.map(i => i.Work_Order_ID).filter(Boolean)));
    const orders: WorkOrder[] = [];
    for (let i = 0; i < ids.length; i += 30) {
        const snap = await db.collection('work_orders').where('Organization_ID', '==', orgId).where('Work_Order_ID', 'in', ids.slice(i, i + 30)).get();
        snap.docs.forEach(d => orders.push(d.data() as WorkOrder));
    }
    const live = orders.filter(o => o.Status !== 'Otkazano');
    const mine = new Set(items.map(i => i.ID));
    const logs = (await Promise.all(live.map(o => getWorkLogsForWorkOrder(orgId, o.Work_Order_ID)))).flat();
    return buildProjectHistory(
        live.map(o => ({ id: o.Work_Order_ID, name: o.Name || o.Work_Order_Number || 'Nalog', status: o.Status })),
        items.filter(i => i.Item_Type !== 'custom').map(i => ({ id: i.ID, workOrderId: i.Work_Order_ID, product: i.Product_Name })),
        liveLogs(logs)
            .filter(l => !scope.projectId || !l.Work_Order_Item_ID || mine.has(l.Work_Order_Item_ID))
            .map(l => ({ date: String(l.Date || ''), workerName: l.Worker_Name, workOrderId: l.Work_Order_ID, itemId: l.Work_Order_Item_ID, dayFraction: l.Day_Fraction ?? undefined })),
    );
}
