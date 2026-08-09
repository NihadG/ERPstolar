// ════════════════════════════════════════════════════════════════════
// PLATNO — ŽIVI STATUS BLOKA
//
// Blok na platnu je plan; njegov „status" je binaran dok ne pređe u stvarnost.
// Kad je pretvoren u nalog/narudžbu (linkedWorkOrderId / linkedOrderId), platno
// ČITA status tog stvarnog entiteta i preslikava ga na blok — isto kao što već
// čita sjene. Ovo je ČITANJE, ne pisanje: izolacija ostaje netaknuta.
//
// Nalog:    Na čekanju → U toku → (Pauza) → Završeno / Otkazano
//           (Pauza se ne čuva; izvodi se iz pauziranih stavki — isOrderPaused.)
// Narudžba: Nacrt (kreirana) → Poslano → Primljeno.
// ════════════════════════════════════════════════════════════════════

import type { PlanBlock, WorkOrder, Order } from '../types';
import { isOrderPaused } from '../utils';

/** Jedinstvena os statusa za bojenje/ikonu — nezavisna od vrste bloka. */
export type BlockStatus = 'draft' | 'pending' | 'active' | 'paused' | 'done' | 'cancelled';

export interface BlockStatusInfo {
    status: BlockStatus;
    /** Prikazni naziv živog statusa („U toku", „Poslano"…). Prazno za nacrt. */
    label: string;
    /** Broj stvarnog naloga/narudžbe kad je razriješen — za tooltip/drawer. */
    ref?: string;
}

export interface BlockStatusCtx {
    workOrders: WorkOrder[];
    orders: Order[];
}

const DRAFT: BlockStatusInfo = { status: 'draft', label: '' };

/** WorkOrder.Status → os statusa (Pauza se dodaje posebno). */
const WO_STATUS: Record<string, BlockStatus> = {
    'Na čekanju': 'pending',
    'U toku': 'active',
    'Završeno': 'done',
    'Otkazano': 'cancelled',
};

/** Order.Status (narudžba) → os statusa. */
const ORDER_STATUS: Record<string, BlockStatus> = {
    'Nacrt': 'pending',
    'Poslano': 'active',
    'Primljeno': 'done',
};

/**
 * Živi status bloka = status STVARNOG naloga/narudžbe iza njega.
 *  • nije pretvoren            → 'draft' (izgleda kao i danas, bez oznake statusa)
 *  • pretvoren, entitet nađen  → preslikan status
 *  • pretvoren, entitet nestao / još neučitan → 'pending' (kreirano, status nepoznat)
 */
export function blockStatus(block: PlanBlock, ctx: BlockStatusCtx): BlockStatusInfo {
    if (block.linkedWorkOrderId) {
        const wo = ctx.workOrders.find(w => w.Work_Order_ID === block.linkedWorkOrderId);
        if (!wo) return { status: 'pending', label: 'Kreiran nalog' };
        let status = WO_STATUS[wo.Status] || 'pending';
        if (status === 'active' && isOrderPaused(wo)) status = 'paused';
        return {
            status,
            label: status === 'paused' ? 'Pauza' : wo.Status,
            ref: wo.Work_Order_Number,
        };
    }
    if (block.linkedOrderId) {
        const ord = ctx.orders.find(o => o.Order_ID === block.linkedOrderId);
        if (!ord) return { status: 'pending', label: 'Kreirana narudžba' };
        return {
            status: ORDER_STATUS[ord.Status] || 'pending',
            label: ord.Status,
            ref: ord.Order_Number,
        };
    }
    return DRAFT;
}

/** Mapa statusa svih blokova scenarija — jedan prolaz, za render bez ponovnog traženja. */
export function blockStatusMap(blocks: PlanBlock[], ctx: BlockStatusCtx): Map<string, BlockStatusInfo> {
    const m = new Map<string, BlockStatusInfo>();
    for (const b of blocks) {
        const info = blockStatus(b, ctx);
        if (info.status !== 'draft') m.set(b.id, info);   // nacrt = podrazumijevano, ne trošimo mapu
    }
    return m;
}

/** Generički naziv statusa (kad nemamo tačan naziv entiteta). */
export const BLOCK_STATUS_LABEL: Record<BlockStatus, string> = {
    draft: 'Nacrt',
    pending: 'Na čekanju',
    active: 'U toku',
    paused: 'Pauza',
    done: 'Završeno',
    cancelled: 'Otkazano',
};
