// ════════════════════════════════════════════════════════════════════
// DNEVNI UPIS RADA — upis u bazu (admin SDK)
//
// Ulaz su stavke koje je asistent izvukao iz poruke; odluke donosi čista
// logika u lib/workDiary.ts, a ovdje je samo I/O, istim redoslijedom kao
// šihtarica (lib/server/fieldAttendance.ts):
//   prisustvo → dnevnice (ručne, s udjelom dana) → renormalizacija dana →
//   graf naloga + čekiranje procesa → trošak rada naloga.
//
// Diktirani dan ZAMJENJUJE automatsku podjelu iz prisustva i prethodni
// diktirani upis istog dana; ručni unosi iz Knjige rada ostaju i dijele dan.
// Svaki dirnut dokument se preda `track` prije izmjene (null = nov), da
// ↩️ Poništi vrati tačno stanje.
// ════════════════════════════════════════════════════════════════════

import { v4 as uuidv4 } from 'uuid';
import { adminDb } from './firebaseAdmin';
import { attachItems, getBookableWorkOrders, getItemsForWorkOrders, getWorkers, getWorkLogRefsForWorkerDate, getWorkLogsInRange } from './fieldRepo';
import { recalcOrderLabor, renormalizeWorkerDay } from './fieldAttendance';
import { effectiveDailyRate } from '@/lib/laborSplit';
import { resolveLaborCostTarget } from '@/lib/laborTarget';
import {
    applyPlanToItem, completeUpstream, diaryTargets, ensureGraphNode, graphFromStages, itemHasPlan,
    markItemProcess, matchProcess, matchTarget, planWorkerDay, type DiaryTarget,
} from '@/lib/workDiary';
import { buildGraphFromRules, planToStages } from '@/lib/productProcesses';
import type {
    ProcessCatalogItem, ProcessGraph, ProcessMaterialRule, Product, ProductMaterial, Project, WorkLog, WorkOrder, WorkOrderItem,
} from '@/lib/types';

export type TrackHook = (path: string, data: Record<string, unknown> | null) => void;

export interface DiaryLineInput {
    workerIds: string[];
    /** Posao kako je rečen: „kuhinja Čorluka", „montaža kod Melihe". */
    target: string;
    /** Nalog izabran nakon pitanja (kandidati iz prethodnog pokušaja). */
    workOrderId?: string;
    process?: string;
    alsoProcesses?: string[];
    /** Udio dana (0–1) ako je rečen: „pola dana" = 0.5. */
    fraction?: number;
    done?: boolean;
    /** Korisnik je potvrdio da je proces nov (dodaje se u katalog). */
    newProcess?: boolean;
}

export interface DiaryAbsenceInput { workerId: string; status: 'Bolovanje' | 'Odmor' | 'Odsutan' }

export type DiaryIssue =
    | { kind: 'target'; line: number; text: string; candidates: { workOrderId: string; workOrderName: string; projectName: string }[] }
    | { kind: 'process'; line: number; name: string }
    | { kind: 'worker'; line: number; workerId: string };

export interface DiaryRow {
    worker: string;
    dayFraction: number;
    workOrderName: string;
    products: string[];
    process?: string;
    done: boolean;
    graphAdded: boolean;
}

/** Procesi dodani ili pretpostavljeni na dijelu naloga (proizvodi prazni = cijeli nalog). */
export interface DiaryProcessNote {
    workOrderName: string;
    products: string[];
    processes: string[];
    /** Samo za plan: odakle je plan došao. */
    source?: 'product' | 'rules';
}

export type DiaryResult =
    | {
        ok: true; rows: DiaryRow[]; absences: { worker: string; status: string }[]; affectedWorkOrders: string[]; newCatalog: string[];
        planned: DiaryProcessNote[]; assumedDone: DiaryProcessNote[];
    }
    | { ok: false; issues: DiaryIssue[] };

interface ResolvedLine {
    input: DiaryLineInput;
    workOrderId: string;
    workOrderName: string;
    items: DiaryTarget[];
    process?: string;
    also: string[];
}

const capitalize = (s: string) => s.trim().charAt(0).toUpperCase() + s.trim().slice(1);

export async function bookWorkDiary(
    orgId: string,
    date: string,
    lines: DiaryLineInput[],
    absences: DiaryAbsenceInput[],
    track: TrackHook = () => undefined,
): Promise<DiaryResult> {
    const db = adminDb();
    const [orders, workers, projectsSnap, catalogSnap, rulesSnap] = await Promise.all([
        getBookableWorkOrders(orgId),
        getWorkers(orgId),
        db.collection('projects').where('Organization_ID', '==', orgId).get(),
        db.collection('process_catalog').where('Organization_ID', '==', orgId).get(),
        db.collection('process_material_rules').where('Organization_ID', '==', orgId).get(),
    ]);
    const rules = rulesSnap.docs.map(d => d.data() as ProcessMaterialRule);
    attachItems(orders, await getItemsForWorkOrders(orgId, orders.map(o => o.Work_Order_ID)));
    const projectName = new Map(projectsSnap.docs.map(d => { const p = d.data() as Project; return [p.Project_ID, p.Name || p.Client_Name || '']; }));
    const targets = diaryTargets(orders, id => projectName.get(id) || '');
    const catalog = catalogSnap.docs.map(d => d.data() as ProcessCatalogItem);
    const vocabulary = Array.from(new Set([
        ...catalog.map(c => c.Name),
        ...orders.flatMap(o => (o.Process_Graph?.nodes || []).map(n => n.name)),
        ...rules.flatMap(r => r.Processes || []),
    ].filter(n => n && n.trim().toLowerCase() !== 'rad')));
    const workerById = new Map(workers.map(w => [w.Worker_ID, w]));

    // ── 1. Razriješi sve stavke prije ijednog upisa ──
    const issues: DiaryIssue[] = [];
    const resolved: ResolvedLine[] = [];
    lines.forEach((line, i) => {
        line.workerIds.filter(id => !workerById.has(id)).forEach(workerId => issues.push({ kind: 'worker', line: i, workerId }));
        const pool = line.workOrderId ? targets.filter(t => t.workOrderId === line.workOrderId) : targets;
        const match = pool.length ? matchTarget(line.target || pool[0]?.workOrderName || '', pool) : { kind: 'none' as const };
        const fallback = line.workOrderId && pool.length && match.kind !== 'ok'
            ? { kind: 'ok' as const, workOrderId: line.workOrderId, workOrderName: pool[0].workOrderName, items: pool }
            : match;
        if (fallback.kind !== 'ok') {
            issues.push({ kind: 'target', line: i, text: line.target, candidates: fallback.kind === 'ambiguous' ? fallback.candidates : [] });
            return;
        }
        let process: string | undefined;
        if (line.process?.trim()) {
            process = matchProcess(line.process, vocabulary) || (line.newProcess ? capitalize(line.process) : undefined);
            if (!process) issues.push({ kind: 'process', line: i, name: line.process.trim() });
        }
        const also = (line.alsoProcesses || []).map(p => matchProcess(p, vocabulary) || capitalize(p)).filter(Boolean);
        resolved.push({ input: line, workOrderId: fallback.workOrderId, workOrderName: fallback.workOrderName, items: fallback.items, process, also });
    });
    if (issues.length) return { ok: false, issues };

    // ── 2. Novi procesi u katalog (rječnik za sljedeći put) ──
    const known = new Set(catalog.map(c => c.Name.trim().toLowerCase()));
    const newCatalog: string[] = [];
    let order = catalog.reduce((m, c) => Math.max(m, c.Order || 0), 0);
    for (const r of resolved) {
        for (const name of [r.process, ...r.also].filter(Boolean) as string[]) {
            if (known.has(name.toLowerCase())) continue;
            known.add(name.toLowerCase());
            const ref = db.collection('process_catalog').doc();
            const item: ProcessCatalogItem = { ID: uuidv4(), Organization_ID: orgId, Name: name.normalize('NFC'), Order: ++order, Created_At: new Date().toISOString() };
            track(ref.path, null);
            await ref.set(item);
            newCatalog.push(name);
        }
    }

    // ── 3. Graf naloga i čekiranje (u memoriji, upis kasnije) ──
    const orderById = new Map(orders.map(o => [o.Work_Order_ID, o]));
    const itemById = new Map(orders.flatMap(o => o.items || []).map(i => [i.ID, i]));
    const graphs = new Map<string, ProcessGraph | undefined>();
    const itemProcesses = new Map<string, WorkOrderItem['Processes']>();
    const nodeFor = new Map<string, string>();                 // `${itemId}|${process}` → nodeId
    const atIso = `${date}T15:00:00.000Z`;
    const rows: DiaryRow[] = [];
    const graphAdded = new Set<string>();
    const graphOf = (woId: string) => (graphs.has(woId) ? graphs.get(woId) : orderById.get(woId)?.Process_Graph);
    const processesOf = (itemId: string) => (itemProcesses.has(itemId) ? itemProcesses.get(itemId) : itemById.get(itemId)?.Processes);

    // Proizvod bez ikakvog plana dobije plan (kartica proizvoda ili pravila materijala)
    // prije čekiranja — tek tada „brušenje" zna šta je bilo prije njega.
    const worked = Array.from(new Map(resolved.filter(r => r.process || r.also.length).flatMap(r => r.items).map(t => [t.itemId, t])).values());
    const bare = worked.map(t => itemById.get(t.itemId)).filter((i): i is WorkOrderItem => !!i && !itemHasPlan(orderById.get(i.Work_Order_ID)?.Process_Graph, i));
    const plans = await loadItemPlans(orgId, bare, rules);
    const plannedByItem = new Map<string, { processes: string[]; source: 'product' | 'rules' }>();
    for (const item of bare) {
        const plan = plans.get(item.ID);
        if (!plan) continue;
        const res = applyPlanToItem(graphOf(item.Work_Order_ID), processesOf(item.ID), item.ID, plan.graph, uuidv4);
        graphs.set(item.Work_Order_ID, res.graph);
        itemProcesses.set(item.ID, res.processes);
        if (res.added.length) plannedByItem.set(item.ID, { processes: res.added, source: plan.source });
    }

    const assumedByItem = new Map<string, string[]>();
    for (const r of resolved) {
        const done = r.input.done === true;
        for (const name of [r.process, ...r.also].filter(Boolean) as string[]) {
            for (const t of r.items) {
                const res = ensureGraphNode(graphOf(t.workOrderId), t.itemId, name, uuidv4);
                graphs.set(t.workOrderId, res.graph);
                nodeFor.set(`${t.itemId}|${name}`, res.nodeId);
                if (res.added) graphAdded.add(`${r.workOrderId}|${name}`);
                const worker = workerById.get(r.input.workerIds[0])!;
                const marked = markItemProcess(processesOf(t.itemId), name, done && name === r.process, { id: worker.Worker_ID, name: worker.Name }, atIso);
                let processes = marked.processes;
                // Raniji koraci se pretpostavljaju samo za proces koji je već bio u planu;
                // nov proces (dodan na kraj) ne smije „završiti" cijeli plan.
                if (res.covered) {
                    const up = completeUpstream(res.graph, t.itemId, res.nodeId, processes, atIso);
                    processes = up.processes;
                    if (up.completed.length) assumedByItem.set(t.itemId, [...(assumedByItem.get(t.itemId) || []), ...up.completed]);
                }
                itemProcesses.set(t.itemId, processes);
            }
        }
    }

    // ── 4. Po radniku: prisustvo, dnevnice, renormalizacija ──
    const affected = new Set<string>();
    const workerIds = Array.from(new Set(resolved.flatMap(r => r.input.workerIds)));
    for (const workerId of workerIds) {
        const worker = workerById.get(workerId)!;
        const mine = resolved.filter(r => r.input.workerIds.includes(workerId));
        const plan = planWorkerDay(mine.map(r => r.input.fraction));

        await upsertAttendance(orgId, worker.Worker_ID, worker.Name, date, 'Prisutan', track);
        const existing = await getWorkLogRefsForWorkerDate(orgId, workerId, date);
        const replace = existing.filter(l => l.data.Booking_Source !== 'manual' || l.data.Entry_Source === 'telegram');
        const keep = existing.filter(l => !replace.includes(l));
        const batch = db.batch();
        replace.forEach(l => {
            track(l.ref.path, l.data as unknown as Record<string, unknown>);
            batch.delete(l.ref);
            if (l.data.Work_Order_ID) affected.add(l.data.Work_Order_ID);
        });
        keep.forEach(l => track(l.ref.path, l.data as unknown as Record<string, unknown>));

        // Jedan zapis po (radnik, stavka); isti proizvod s dva procesa = jedan zapis s oznakama.
        const perItem = new Map<string, { t: DiaryTarget; weight?: number; processes: string[] }>();
        mine.forEach((r, li) => {
            const w = plan.weights[li];
            r.items.forEach(t => {
                const entry = perItem.get(t.itemId) || { t, weight: undefined, processes: [] };
                if (w !== undefined) entry.weight = (entry.weight || 0) + w / r.items.length;
                entry.processes.push(...[r.process, ...r.also].filter(Boolean) as string[]);
                perItem.set(t.itemId, entry);
            });
        });

        const dailyRate = effectiveDailyRate(worker, date);
        for (const { t, weight, processes } of Array.from(perItem.values())) {
            const booked = itemById.get(t.itemId);
            const { target, redirected, source } = booked
                ? resolveLaborCostTarget(booked, itemById)
                : { target: undefined as WorkOrderItem | undefined, redirected: false, source: undefined };
            const itemId = target?.ID || t.itemId;
            const woId = target?.Work_Order_ID || t.workOrderId;
            const unique = Array.from(new Set(processes));
            const log: Partial<WorkLog> & Record<string, unknown> = {
                WorkLog_ID: uuidv4(), Organization_ID: orgId, Date: date,
                Worker_ID: workerId, Worker_Name: worker.Name,
                Daily_Rate: 0, Original_Daily_Rate: dailyRate,
                Day_Fraction: 0, Presence: plan.presence, Split_Factor: 1, Hours_Worked: 8 * plan.presence * (weight ?? 1),
                Booking_Source: 'manual', Is_From_Attendance: false, Entry_Source: 'telegram',
                Work_Order_ID: woId, Work_Order_Item_ID: itemId, Product_ID: target?.Product_ID || t.productId,
                ...(weight !== undefined ? { Day_Weight: Math.round(weight * 1e6) / 1e6 } : {}),
                ...(redirected && source ? {
                    Source_Work_Order_ID: source.Work_Order_ID, Source_Work_Order_Item_ID: source.ID, Process_Name: source.Product_Name,
                } : unique.length ? {
                    Process_Name: unique[0], Process_Node_ID: nodeFor.get(`${t.itemId}|${unique[0]}`),
                    ...(unique.length > 1 ? { Process_Tags: unique.slice(1) } : {}),
                } : {}),
                Created_At: new Date().toISOString(),
            };
            Object.keys(log).forEach(k => log[k] === undefined && delete log[k]);
            const ref = db.collection('work_logs').doc();
            track(ref.path, null);
            batch.set(ref, log);
            affected.add(woId);
        }
        await batch.commit();
        (await renormalizeWorkerDay(orgId, workerId, date, plan.presence)).forEach(id => affected.add(id));

        mine.forEach(r => rows.push({
            worker: worker.Name,
            dayFraction: Math.round(plan.presence * (plan.weights[mine.indexOf(r)] ?? 1 / mine.length) * 100) / 100,
            workOrderName: r.workOrderName,
            // Proizvod se navodi samo kad je rad bio na dijelu naloga s više proizvoda.
            products: r.items.length < (orderById.get(r.workOrderId)?.items || []).length ? r.items.map(t => t.productName) : [],
            process: r.process,
            done: r.input.done === true,
            graphAdded: !!r.process && graphAdded.has(`${r.workOrderId}|${r.process}`),
        }));
    }

    // ── 5. Graf naloga, procesi stavki, nalog „u toku" ──
    for (const [woId, graph] of Array.from(graphs.entries())) {
        const snap = await db.collection('work_orders').where('Organization_ID', '==', orgId).where('Work_Order_ID', '==', woId).limit(1).get();
        if (snap.empty || !graph) continue;
        track(snap.docs[0].ref.path, snap.docs[0].data());
        const wo = snap.docs[0].data() as WorkOrder;
        await snap.docs[0].ref.update({
            Process_Graph: JSON.parse(JSON.stringify(graph)),
            ...(wo.Status === 'Na čekanju' ? { Status: 'U toku', Started_At: wo.Started_At || atIso } : {}),
        });
    }
    for (const [itemId, processes] of Array.from(itemProcesses.entries())) {
        const snap = await db.collection('work_order_items').where('Organization_ID', '==', orgId).where('ID', '==', itemId).limit(1).get();
        if (snap.empty) continue;
        track(snap.docs[0].ref.path, snap.docs[0].data());
        const item = snap.docs[0].data() as WorkOrderItem;
        await snap.docs[0].ref.update({
            Processes: JSON.parse(JSON.stringify(processes)),
            ...(item.Status === 'Na čekanju' ? { Status: 'U toku' } : {}),
        });
    }

    // ── 6. Odsutni ──
    const absenceRows: { worker: string; status: string }[] = [];
    for (const a of absences) {
        const worker = workerById.get(a.workerId);
        if (!worker) continue;
        await upsertAttendance(orgId, worker.Worker_ID, worker.Name, date, a.status, track);
        const logs = await getWorkLogRefsForWorkerDate(orgId, a.workerId, date);
        const batch = db.batch();
        logs.forEach(l => {
            track(l.ref.path, l.data as unknown as Record<string, unknown>);
            if (l.data.Booking_Source !== 'manual' || l.data.Entry_Source === 'telegram') {
                batch.delete(l.ref);
                if (l.data.Work_Order_ID) affected.add(l.data.Work_Order_ID);
            }
        });
        await batch.commit();
        (await renormalizeWorkerDay(orgId, a.workerId, date)).forEach(id => affected.add(id));
        absenceRows.push({ worker: worker.Name, status: a.status });
    }

    // ── 7. Trošak rada naloga ──
    for (const woId of Array.from(affected)) {
        const [woSnap, itemsSnap] = await Promise.all([
            db.collection('work_orders').where('Organization_ID', '==', orgId).where('Work_Order_ID', '==', woId).limit(1).get(),
            db.collection('work_order_items').where('Organization_ID', '==', orgId).where('Work_Order_ID', '==', woId).get(),
        ]);
        woSnap.docs.forEach(d => track(d.ref.path, d.data()));
        itemsSnap.docs.forEach(d => track(d.ref.path, d.data()));
        await recalcOrderLabor(orgId, woId);
    }

    // Isti procesi na više proizvoda istog naloga = jedna napomena.
    const notes = (byItem: Map<string, { processes: string[]; source?: 'product' | 'rules' }>): DiaryProcessNote[] => {
        const groups = new Map<string, DiaryProcessNote & { woId: string }>();
        byItem.forEach((v, itemId) => {
            const item = itemById.get(itemId)!;
            const processes = Array.from(new Set(v.processes));
            const key = `${item.Work_Order_ID}|${v.source || ''}|${processes.join('|')}`;
            const g = groups.get(key) || { woId: item.Work_Order_ID, workOrderName: targets.find(t => t.itemId === itemId)?.workOrderName || '', products: [], processes, ...(v.source ? { source: v.source } : {}) };
            g.products.push(item.Product_Name);
            groups.set(key, g);
        });
        return Array.from(groups.values()).map(({ woId, ...g }) => ({
            ...g, products: g.products.length < (orderById.get(woId)?.items || []).length ? g.products : [],
        }));
    };
    const assumedNotes = new Map(Array.from(assumedByItem.entries()).map(([id, processes]) => [id, { processes }]));

    return {
        ok: true, rows, absences: absenceRows, affectedWorkOrders: Array.from(affected), newCatalog,
        planned: notes(plannedByItem), assumedDone: notes(assumedNotes),
    };
}

/**
 * Plan za stavke bez plana, istim redom kao čarobnjak naloga: snimak grafa na
 * stavci → graf / faze s kartice proizvoda → pravila materijal→proces nad
 * materijalima proizvoda. Bez ičega → stavka ostaje bez plana.
 */
async function loadItemPlans(
    orgId: string,
    items: WorkOrderItem[],
    rules: ProcessMaterialRule[],
): Promise<Map<string, { graph: ProcessGraph; source: 'product' | 'rules' }>> {
    const out = new Map<string, { graph: ProcessGraph; source: 'product' | 'rules' }>();
    const productIds = Array.from(new Set(items.map(i => i.Product_ID).filter(Boolean)));
    if (!items.length) return out;
    const [products, materials] = await Promise.all([
        byProductIds<Product>(orgId, 'products', productIds),
        rules.length ? byProductIds<ProductMaterial>(orgId, 'product_materials', productIds) : Promise.resolve([]),
    ]);
    for (const item of items) {
        const product = products.find(p => p.Product_ID === item.Product_ID);
        const own = [item.Process_Graph, product?.Process_Graph].find(g => g?.nodes?.length)
            || [planToStages(item.Process_Stages), planToStages(product?.Process_Stages, product?.Process_Plan)]
                .filter(s => s.length).map(graphFromStages)[0];
        if (own) {
            out.set(item.ID, { graph: own, source: 'product' });
            continue;
        }
        const mats = materials.filter(m => m.Product_ID === item.Product_ID);
        const fromRules = mats.length ? buildGraphFromRules(mats, rules).graph : undefined;
        if (fromRules?.nodes.length) out.set(item.ID, { graph: fromRules, source: 'rules' });
    }
    return out;
}

async function byProductIds<T>(orgId: string, col: string, ids: string[]): Promise<T[]> {
    const out: T[] = [];
    for (let i = 0; i < ids.length; i += 30) {
        const snap = await adminDb().collection(col).where('Organization_ID', '==', orgId).where('Product_ID', 'in', ids.slice(i, i + 30)).get();
        snap.docs.forEach(d => out.push(d.data() as T));
    }
    return out;
}

/** Jedan zapis prisustva po (radnik, dan) — isto pravilo kao setAttendance, uz snimak za poništavanje. */
async function upsertAttendance(orgId: string, workerId: string, workerName: string, date: string, status: string, track: TrackHook): Promise<void> {
    const db = adminDb();
    const snap = await db.collection('worker_attendance')
        .where('Worker_ID', '==', workerId)
        .where('Organization_ID', '==', orgId)
        .where('Date', '>=', date)
        .where('Date', '<', date + 'T99')
        .get();
    const mine = snap.docs.filter(d => String(d.data().Date || '').split('T')[0] === date);
    const canonical = mine.find(d => d.data().Attendance_ID === d.id) || mine[0];
    const id = canonical ? (canonical.data().Attendance_ID || canonical.id) : uuidv4();
    const batch = db.batch();
    mine.forEach(d => {
        track(d.ref.path, d.data());
        if (d.id !== id) batch.delete(d.ref);
    });
    const ref = db.collection('worker_attendance').doc(id);
    if (!mine.some(d => d.id === id)) track(ref.path, null);
    batch.set(ref, {
        Attendance_ID: id, Organization_ID: orgId, Worker_ID: workerId, Worker_Name: workerName,
        Date: date, Status: status, Notes: canonical?.data().Notes || '',
        Created_Date: canonical?.data().Created_Date || new Date().toISOString(),
        Modified_Date: new Date().toISOString(),
    });
    await batch.commit();
}

// ─── Pregled upisanog rada ────────────────────────────────────────────

export interface WorkLogRow {
    date: string;
    workerId: string;
    worker: string;
    dayFraction: number;
    process?: string;
    workOrderName: string;
    productName: string;
    projectName: string;
    /** Ručni ili diktirani upis; inače automatska podjela iz prisustva. */
    confirmed: boolean;
}

export async function workLogReport(orgId: string, from: string, to: string): Promise<{ rows: WorkLogRow[] }> {
    const db = adminDb();
    const [logs, orders, projectsSnap] = await Promise.all([
        getWorkLogsInRange(orgId, from, to),
        getBookableWorkOrders(orgId),
        db.collection('projects').where('Organization_ID', '==', orgId).get(),
    ]);
    const items = await getItemsForWorkOrders(orgId, orders.map(o => o.Work_Order_ID));
    const woName = new Map(orders.map(o => [o.Work_Order_ID, o.Name || o.Work_Order_Number || 'Nalog']));
    const itemById = new Map(items.map(i => [i.ID, i]));
    const projectName = new Map(projectsSnap.docs.map(d => { const p = d.data() as Project; return [p.Project_ID, p.Name || p.Client_Name || '']; }));
    const rows = logs
        .filter(l => !l.Work_Order_Deleted)
        .map(l => {
            const item = itemById.get(l.Work_Order_Item_ID);
            return {
                date: String(l.Date).slice(0, 10),
                workerId: l.Worker_ID,
                worker: l.Worker_Name,
                dayFraction: l.Day_Fraction ?? 1,
                process: l.Process_Name,
                workOrderName: woName.get(l.Work_Order_ID) || 'Nalog',
                productName: item?.Product_Name || '',
                projectName: item?.Project_ID ? projectName.get(item.Project_ID) || '' : '',
                confirmed: l.Booking_Source === 'manual',
            };
        })
        .sort((a, b) => a.date.localeCompare(b.date) || a.worker.localeCompare(b.worker, 'bs'));
    return { rows };
}
