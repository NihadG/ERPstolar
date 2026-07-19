// ════════════════════════════════════════════════════════════════════
// POKRETANJE NALOGA — dijeljena logika (validacije + knjiženje današnjeg dana)
//
// Izdvojeno iz ProductionTab.tsx da bi ga mogli koristiti i lista naloga
// (desktop + mobitel) i puna stranica naloga (app/nalog/[id]) BEZ dupliranja
// osjetljivih provjera (esencijalni materijali, prisustvo radnika). Funkcije su
// "čiste" u smislu da NE diraju UI (bez toastova/modala) — pozivalac odlučuje
// kako da prikaže rezultat.
// ════════════════════════════════════════════════════════════════════

import type { WorkOrder, Project, Worker } from '@/lib/types';
import {
    canWorkerStartProcess,
    getWorkerAttendance,
    bookWorkerDayItems,
    recalculateWorkOrder,
} from '@/lib/services';
import { isWorkerAssignedToAutoItem } from '@/lib/autoBook';

export type StartCheckResult = { ok: true } | { ok: false; message: string };

/**
 * Provjeri može li se nalog pokrenuti (bez pokretanja):
 *  1) bar jedan radnik dodijeljen (proces s Worker_ID),
 *  2) esencijalni materijali primljeni / na stanju,
 *  3) svi radnici (procesi + pomoćnici) prisutni danas.
 * Vraća prvu prepreku kao poruku, ili { ok: true }.
 */
export async function checkWorkOrderStart(wo: WorkOrder, projects: Project[]): Promise<StartCheckResult> {
    // 1) Bar jedan radnik
    const hasWorker = (wo.items || []).some(item =>
        (item.Processes || []).some(p => p.Worker_ID)
    );
    if (!hasWorker) {
        return { ok: false, message: 'Dodijelite barem jednog radnika prije pokretanja naloga' };
    }

    // 2) Esencijalni materijali (iz kataloga projekta)
    const missingMaterials: string[] = [];
    for (const item of wo.items || []) {
        const project = projects.find(p => p.Project_ID === item.Project_ID);
        const product = project?.products?.find(pr => pr.Product_ID === item.Product_ID);
        if (product?.materials) {
            const missing = product.materials.filter(
                m => m.Is_Essential && m.Status !== 'Primljeno' && m.Status !== 'Na stanju'
            );
            missing.forEach(m => missingMaterials.push(`${item.Product_Name}: ${m.Material_Name}`));
        }
    }
    if (missingMaterials.length > 0) {
        return { ok: false, message: `Esencijalni materijali nisu spremni: ${missingMaterials.join(', ')}` };
    }

    // 3) Prisustvo svih radnika (procesi + pomoćnici), paralelno; bez duplih provjera
    const workerChecks: { workerId: string; label: string }[] = [];
    const checked = new Set<string>();
    for (const item of wo.items || []) {
        for (const process of item.Processes || []) {
            if (process.Worker_ID && !checked.has(process.Worker_ID)) {
                checked.add(process.Worker_ID);
                workerChecks.push({ workerId: process.Worker_ID, label: `${process.Worker_Name} (${process.Process_Name})` });
            }
            for (const helper of process.Helpers || []) {
                if (helper.Worker_ID && !checked.has(helper.Worker_ID)) {
                    checked.add(helper.Worker_ID);
                    workerChecks.push({ workerId: helper.Worker_ID, label: `${helper.Worker_Name} (pomoćnik za ${process.Process_Name})` });
                }
            }
        }
    }
    const availability = await Promise.all(
        workerChecks.map(async ({ workerId, label }) => ({ label, res: await canWorkerStartProcess(workerId) }))
    );
    const issues = availability.filter(r => !r.res.allowed).map(r => `${r.label} - ${r.res.reason}`);
    if (issues.length > 0) {
        return { ok: false, message: `Radnici nisu prisutni: ${issues.join(', ')}` };
    }

    return { ok: true };
}

/**
 * Dodijeljeni radnici naloga koji su DANAS prisutni u šihtarici i podudaraju se s
 * tipom naloga (Prisutan → proizvodnja, Teren → montaža) — kandidati za trenutno
 * knjiženje današnjeg dana nakon starta. Ne knjiži ništa, samo vraća listu.
 */
export async function findWorkersToBookToday(
    wo: WorkOrder,
    workers: Worker[],
    organizationId: string,
    today: string,
): Promise<{ workerId: string; workerName: string }[]> {
    const assigned = new Map<string, string>();
    const note = (id?: string, name?: string) => {
        if (!id) return;
        assigned.set(id, name || workers.find(w => w.Worker_ID === id)?.Name || id);
    };
    for (const item of wo.items || []) {
        (item.Assigned_Workers || []).forEach(w => note(w.Worker_ID, w.Worker_Name));
        (item.Processes || []).forEach(p => {
            note(p.Worker_ID, p.Worker_Name);
            (p.Helpers || []).forEach(h => note(h.Worker_ID, h.Worker_Name));
        });
        (item.SubTasks || []).forEach(st => {
            note(st.Worker_ID, st.Worker_Name);
            (st.Helpers || []).forEach(h => note(h.Worker_ID, h.Worker_Name));
        });
    }
    if (assigned.size === 0) return [];

    const isMontaza = wo.Work_Order_Type === 'Montaža';
    const eligible: { workerId: string; workerName: string }[] = [];
    await Promise.all(Array.from(assigned.entries()).map(async ([workerId, workerName]) => {
        try {
            const att = await getWorkerAttendance(workerId, today, organizationId || undefined);
            if (!att) return;
            if ((att.Status === 'Prisutan' && !isMontaza) || (att.Status === 'Teren' && isMontaza)) {
                eligible.push({ workerId, workerName });
            }
        } catch (e) { console.warn('attendance check failed', workerId, e); }
    }));
    return eligible;
}

/**
 * Proknjiži današnji dan za odabrane radnike na nalogu. Idempotentno
 * (bookWorkerDayItems preskače postojeće dnevnice). Vraća broj kreiranih dnevnica;
 * ako je nešto knjiženo, preračuna nalog. Pozivalac prikazuje ishod.
 */
export async function bookWorkersToday(
    workOrderId: string,
    wo: WorkOrder | undefined,
    toBook: { workerId: string; workerName: string }[],
    organizationId: string,
    today: string,
): Promise<number> {
    let booked = 0;
    for (const w of toBook) {
        const live = (wo?.items || []).filter(it => it.Status !== 'Završeno');
        const mine = live.filter(it =>
            isWorkerAssignedToAutoItem({ ID: it.ID, Assigned_Workers: it.Assigned_Workers, Processes: it.Processes, SubTasks: it.SubTasks }, w.workerId)
        );
        const targets = (mine.length > 0 ? mine : live).map(it => ({ workOrderId, itemId: it.ID, productId: it.Product_ID }));
        if (targets.length === 0) continue;
        const res = await bookWorkerDayItems(w.workerId, w.workerName, today, organizationId, targets, 1);
        booked += res.created;
    }
    if (booked > 0) {
        await recalculateWorkOrder(workOrderId, { skipMaterialRefresh: true, skipStatusSync: true });
    }
    return booked;
}
