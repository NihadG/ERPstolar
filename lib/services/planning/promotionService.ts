// ════════════════════════════════════════════════════════════════════
// promotionService.ts — PRETVORBA PLANA U STVARNOST (Platno → nalozi/narudžbe)
//
// Ovo je JEDINO mjesto gdje platno svjesno prelazi granicu izolacije: na
// KORISNIČKU akciju („Kreiraj stvarni nalog" / „Naruči stvarno") pretvara plan-blok
// u pravi WorkOrder ili Order. Autosave scenarija ostaje čist — ovdje se ništa ne
// zove automatski.
//
// Politika (dogovoreno):
//  • order/montaza → PLANIRAN nalog: Status 'Na čekanju' + Is_Scheduled + Planned_Start_Date,
//    BEZ Started_At → ne mijenja statuse proizvoda dok se ručno ne pusti („Pokreni").
//    (createWorkOrder tako radi kad mu se da Planned_Start_Date.)
//  • purchase → narudžba: 'draft' (Nacrt, ništa se ne mijenja) ili 'send' (Poslano →
//    materijali 'Naručeno', proizvod 'Materijali naručeni') — bira se pri svakoj pretvorbi.
// ════════════════════════════════════════════════════════════════════

import type { PlanBlock, Project, Product, WorkOrder } from '../../types';
import { createWorkOrder } from '../workOrder/workOrderService';
import { createOrder, updateOrderStatus } from '../order/orderService';

export interface PromotionContext {
    /** Projekti s ugniježđenim proizvodima/sastavnicama (getProjects graf). */
    projects: Project[];
    /** Stvarni nalozi — za buduće provjere (npr. duplikati). */
    workOrders: WorkOrder[];
}

export type PurchaseChoice = 'draft' | 'send';

/** Upozorenje prije pretvorbe — korisnik može popuniti prije nego potvrdi. */
export interface PromotionIssue {
    field: string;
    message: string;
    /** `warn` = smije se nastaviti; `block` = kreiranje nema smisla dok se ne popravi. */
    severity: 'warn' | 'block';
}

export interface PromotionResult {
    success: boolean;
    message: string;
    workOrderId?: string;
    workOrderNumber?: string;
    orderId?: string;
    orderNumber?: string;
}

// ── Pomoćnici ────────────────────────────────────────────────────────

function findProduct(projects: Project[], productId: string): { product: Product; project: Project } | null {
    for (const project of projects || []) {
        for (const product of project.products || []) {
            if (product.Product_ID === productId) return { product, project };
        }
    }
    return null;
}

// ════════════════════════════════════════════════════════════════════
// NALOG (order / montaza) → WorkOrder
// ════════════════════════════════════════════════════════════════════

/** Stavke naloga iz productRefs bloka. Bez referenci → jedna custom stavka iz naslova. */
function buildWorkOrderItems(block: PlanBlock, ctx: PromotionContext) {
    const refs = block.productRefs || [];

    if (!refs.length) {
        return [{
            Product_ID: '',
            Product_Name: block.title || 'Stavka',
            Project_ID: block.projectRef?.id || '',
            Project_Name: block.projectRef?.name || '',
            Quantity: 1,
            Item_Type: 'custom' as const,
        }];
    }

    return refs.map(ref => {
        const found = ref.id ? findProduct(ctx.projects, ref.id) : null;
        const product = found?.product;
        const project = found?.project;
        const projectId = block.projectRef?.id || project?.Project_ID || product?.Project_ID || '';
        const projectName = block.projectRef?.name
            || project?.Name?.trim() || project?.Client_Name || '';

        return {
            Product_ID: ref.id || '',
            Product_Name: ref.name || product?.Name || 'Proizvod',
            Project_ID: projectId,
            Project_Name: projectName,
            Quantity: ref.qty || 1,
            Item_Type: (ref.id ? 'product' : 'custom') as 'product' | 'custom',
            // Plan procesa proizvoda — createWorkOrder iz njega sintetiše graf naloga.
            ...(product?.Process_Stages ? { Process_Stages: product.Process_Stages } : {}),
            ...(product?.Process_Plan ? { Process_Plan: product.Process_Plan } : {}),
            ...(product?.Process_Graph ? { Process_Graph: product.Process_Graph } : {}),
        };
    });
}

export function validateOrderBlock(block: PlanBlock, ctx: PromotionContext): PromotionIssue[] {
    const issues: PromotionIssue[] = [];
    const refs = block.productRefs || [];

    if (!refs.length) {
        issues.push({
            field: 'products', severity: 'warn',
            message: 'Nalog nema vezane proizvode — kreirat će se prazna stavka koju dopunjuješ u nalogu.',
        });
    }
    if (!block.projectRef) {
        issues.push({ field: 'project', severity: 'warn', message: 'Nalog nije vezan za projekt.' });
    }
    for (const r of refs) {
        if (!r.id) {
            issues.push({
                field: 'product', severity: 'warn',
                message: `Proizvod „${r.name}" nije iz baze — stavka će biti bez sastavnice i procesa.`,
            });
        }
    }
    return issues;
}

/** Kreira PLANIRAN nalog (Na čekanju + zakazan datum, nije pušten). */
export async function promoteOrderBlock(
    block: PlanBlock, ctx: PromotionContext, organizationId: string
): Promise<PromotionResult> {
    if (block.linkedWorkOrderId) {
        return { success: false, message: 'Ovaj blok je već pretvoren u stvarni nalog.' };
    }
    try {
        const res = await createWorkOrder({
            Work_Order_Type: block.kind === 'montaza' ? 'Montaža' : 'Proizvodnja',
            Production_Steps: [],                 // sintetiše se iz plana procesa stavki
            Name: block.title,
            Due_Date: block.endISO,
            Planned_Start_Date: block.startISO,   // → Is_Scheduled, ali BEZ Started_At (planiran, nije pušten)
            Notes: block.notes || '',
            items: buildWorkOrderItems(block, ctx),
        }, organizationId);

        if (res.success && res.data) {
            return {
                success: true,
                message: `Nalog ${res.data.Work_Order_Number} kreiran (planiran)`,
                workOrderId: res.data.Work_Order_ID,
                workOrderNumber: res.data.Work_Order_Number,
            };
        }
        return { success: false, message: res.message || 'Greška pri kreiranju naloga' };
    } catch (e) {
        console.error('promoteOrderBlock error:', e);
        return { success: false, message: 'Greška pri kreiranju naloga' };
    }
}

// ════════════════════════════════════════════════════════════════════
// NARUDŽBA (purchase) → Order
// ════════════════════════════════════════════════════════════════════

export interface ResolvedMaterialLine {
    productMaterialId: string;
    productId: string;
    productName: string;
    projectId: string;
    materialName: string;
    quantity: number;
    unit: string;
    expectedPrice: number;
}

/** Materijali koji ne trebaju novu narudžbu (već tu ili već naručeni). */
const SETTLED = new Set(['Primljeno', 'Na stanju', 'Naručeno']);

/**
 * Iz živih sastavnica pronađi materijale koji odgovaraju ovom purchase-bloku
 * (po dobavljaču + projektu + nazivima). Blok čuva samo nazive materijala, pa se
 * stvarni ID-evi (potrebni da slanje pomjeri statuse) izvode ovdje iz baze.
 */
export function resolvePurchaseLines(block: PlanBlock, ctx: PromotionContext): ResolvedMaterialLine[] {
    const supplierName = (block.supplierRef?.name || '').trim().toLowerCase();
    const wantNames = new Set((block.materialNames || []).map(n => n.trim().toLowerCase()));
    const projectId = block.projectRef?.id;
    const lines: ResolvedMaterialLine[] = [];

    for (const project of ctx.projects || []) {
        if (projectId && project.Project_ID !== projectId) continue;
        for (const product of project.products || []) {
            for (const m of product.materials || []) {
                if (SETTLED.has(m.Status)) continue;
                if (m.Order_ID) continue;                        // već vezan za narudžbu
                const mSup = (m.Supplier || '').trim().toLowerCase();
                if (supplierName && mSup !== supplierName) continue;
                if (wantNames.size && !wantNames.has((m.Material_Name || '').trim().toLowerCase())) continue;

                lines.push({
                    productMaterialId: m.ID,
                    productId: product.Product_ID,
                    productName: product.Name,
                    projectId: project.Project_ID,
                    materialName: m.Material_Name,
                    quantity: m.Quantity,
                    unit: m.Unit,
                    expectedPrice: m.Total_Price || 0,
                });
            }
        }
    }
    return lines;
}

export function validatePurchaseBlock(block: PlanBlock, ctx: PromotionContext): PromotionIssue[] {
    const issues: PromotionIssue[] = [];

    if (!block.supplierRef?.name) {
        issues.push({ field: 'supplier', severity: 'warn', message: 'Narudžba nema dobavljača.' });
    } else if (!block.supplierRef.id) {
        issues.push({
            field: 'supplier', severity: 'warn',
            message: `Dobavljač „${block.supplierRef.name}" nije prepoznat u šifrarniku — narudžba će nositi samo naziv.`,
        });
    }

    const lines = resolvePurchaseLines(block, ctx);
    if (!lines.length) {
        issues.push({
            field: 'materials', severity: 'warn',
            message: 'Nije pronađen nijedan slobodan materijal (po dobavljaču/projektu). Kreirat će se prazna narudžba koju dopunjuješ u tabu Narudžbe.',
        });
    }
    if (!block.endISO) {
        issues.push({ field: 'delivery', severity: 'warn', message: 'Nema datuma isporuke.' });
    }
    return issues;
}

/** Kreira narudžbu (Nacrt); `send` je odmah šalje (materijali → Naručeno). */
export async function promotePurchaseBlock(
    block: PlanBlock, choice: PurchaseChoice, ctx: PromotionContext, organizationId: string
): Promise<PromotionResult> {
    if (block.linkedOrderId) {
        return { success: false, message: 'Ovaj blok je već pretvoren u stvarnu narudžbu.' };
    }
    try {
        const lines = resolvePurchaseLines(block, ctx);
        const items = lines.map(l => ({
            Product_Material_ID: l.productMaterialId,
            Product_ID: l.productId,
            Product_Name: l.productName,
            Project_ID: l.projectId,
            Material_Name: l.materialName,
            Quantity: l.quantity,
            Unit: l.unit,
            Expected_Price: l.expectedPrice,
        }));
        const totalAmount = Math.round(items.reduce((s, i) => s + (i.Expected_Price || 0), 0) * 100) / 100;

        const res = await createOrder({
            Name: block.title,
            Supplier_ID: block.supplierRef?.id || '',
            Supplier_Name: block.supplierRef?.name || '',
            Expected_Delivery: block.endISO || '',
            Total_Amount: totalAmount,
            Notes: block.notes || '',
            // createOrder popuni ID/Order_ID/Status po stavci; tip je Partial<Order> & {items}
            // pa TS pravi lažni intersection s Order.items — svjesni cast.
            items: items as never,
        }, organizationId);

        if (!res.success || !res.data) {
            return { success: false, message: res.message || 'Greška pri kreiranju narudžbe' };
        }

        const base: PromotionResult = {
            success: true,
            message: `Narudžba ${res.data.Order_Number} kreirana (Nacrt)`,
            orderId: res.data.Order_ID,
            orderNumber: res.data.Order_Number,
        };

        if (choice === 'send') {
            const sent = await updateOrderStatus(res.data.Order_ID, 'Poslano', organizationId);
            if (!sent.success) {
                return { ...base, message: `Narudžba ${res.data.Order_Number} kreirana, ali slanje nije uspjelo: ${sent.message}` };
            }
            return { ...base, message: `Narudžba ${res.data.Order_Number} kreirana i poslana` };
        }
        return base;
    } catch (e) {
        console.error('promotePurchaseBlock error:', e);
        return { success: false, message: 'Greška pri kreiranju narudžbe' };
    }
}
