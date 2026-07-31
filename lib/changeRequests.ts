// ════════════════════════════════════════════════════════════════════
// PRIJEDLOZI IZMJENA — čista logika (bez Firebasea, pokrivena testovima)
//
// Ovdje živi ono što odlučuje SIGURNOST odobravanja:
//   • isMoneyKind / canApprove — ko šta smije odobriti (podjela po novcu),
//   • validateRequestPayload — da u red za odobrenje ne uđe besmislen zahtjev
//     (prazna količina, negativan broj, nepotpun cilj),
//   • summarizeRequest — ljudska rečenica koju odobravač čita.
//
// Klasifikacija „dira li novac" NIKAD ne dolazi iz klijenta — izvodi se iz
// Kind ovdje i na serveru. Test provjerava da je MONEY_KINDS potpun.
// ════════════════════════════════════════════════════════════════════

import { MONEY_KINDS, DESKTOP_APPLY_KINDS, isStaffRole } from '@/lib/types';
import type { ChangeRequestKind, UserRole } from '@/lib/types';

// ─── Oblici payloada po vrsti ─────────────────────────────────────────

export interface ProcessTargetPayload { itemId: string; procName: string }

export interface ProcessCheckPayload {
    targets: ProcessTargetPayload[];
    action: 'complete' | 'start' | 'reset';
    date?: string;                 // za 'complete'
    workerIds?: string[];          // za 'complete'
    notes?: string;
}
export interface ProcessAddPayload { itemIds: string[]; procName: string; stageIndex?: number }
export interface ProcessRemovePayload { targets: ProcessTargetPayload[] }
export interface OrderPausePayload { paused: boolean }
export interface ItemCompletePayload { itemId: string; date: string }
export interface TaskCreatePayload { title: string; priority?: string; productId?: string }
export interface TaskStatusPayload { taskId: string; done: boolean; taskTitle?: string }
export interface TaskDeletePayload { taskId: string; taskTitle?: string }
export interface MaterialLine { materialId?: string; name: string; quantity: number; unit: string; supplier?: string }
export interface MaterialUsagePayload { productId: string; lines: MaterialLine[] }
export interface MaterialOrderPayload { productId: string; lines: MaterialLine[] }

// ─── Novac / uloge ────────────────────────────────────────────────────

const MONEY_SET = new Set<ChangeRequestKind>(MONEY_KINDS);
const DESKTOP_SET = new Set<ChangeRequestKind>(DESKTOP_APPLY_KINDS);

export function isMoneyKind(kind: ChangeRequestKind): boolean {
    return MONEY_SET.has(kind);
}

/** Mora se primijeniti na desktopu (kroz gejt osnovice) — server je ne dira. */
export function needsDesktopApply(kind: ChangeRequestKind): boolean {
    return DESKTOP_SET.has(kind);
}

/**
 * Ko smije ODOBRITI dati prijedlog.
 *   • radnik: ništa (on samo predlaže),
 *   • kontrolor: samo ono što NE dira novac,
 *   • owner/admin/manager: sve.
 * SuperAdmin se rješava u ruti (tretira se kao staff).
 */
export function canApprove(role: UserRole, kind: ChangeRequestKind): boolean {
    if (role === 'worker') return false;
    if (isStaffRole(role)) return true;
    if (role === 'controller') return !isMoneyKind(kind);
    return false;
}

// ─── Validacija ───────────────────────────────────────────────────────

export type ValidationResult =
    | { ok: true; payload: unknown }
    | { ok: false; error: string };

const nonEmpty = (s: unknown): s is string => typeof s === 'string' && s.trim().length > 0;
const isPosNum = (n: unknown): n is number => typeof n === 'number' && isFinite(n) && n > 0;
const isISODate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

function validTargets(v: unknown): ProcessTargetPayload[] | null {
    if (!Array.isArray(v)) return null;
    const out: ProcessTargetPayload[] = [];
    for (const t of v) {
        const itemId = (t as any)?.itemId;
        const procName = (t as any)?.procName;
        if (!nonEmpty(itemId) || !nonEmpty(procName)) return null;
        out.push({ itemId: String(itemId), procName: String(procName) });
    }
    return out.length ? out : null;
}

function validLines(v: unknown, requireSupplier = false): MaterialLine[] | null {
    if (!Array.isArray(v) || v.length === 0) return null;
    const out: MaterialLine[] = [];
    for (const raw of v) {
        const name = (raw as any)?.name;
        const quantity = (raw as any)?.quantity;
        const unit = (raw as any)?.unit;
        if (!nonEmpty(name) || !isPosNum(quantity)) return null;
        const line: MaterialLine = { name: String(name).trim(), quantity, unit: nonEmpty(unit) ? String(unit).trim() : 'kom' };
        if (nonEmpty((raw as any)?.materialId)) line.materialId = String((raw as any).materialId);
        if (nonEmpty((raw as any)?.supplier)) line.supplier = String((raw as any).supplier).trim();
        if (requireSupplier && !line.materialId) return null;   // narudžba mora znati koji je materijal
        out.push(line);
    }
    return out;
}

/**
 * Provjeri i normalizuj payload za datu vrstu. Vraća { ok, payload } ili
 * { ok:false, error }. Ne dira Firestore — čista provjera oblika.
 */
export function validateRequestPayload(kind: ChangeRequestKind, raw: unknown): ValidationResult {
    const p = (raw ?? {}) as Record<string, unknown>;

    switch (kind) {
        case 'process_check': {
            const targets = validTargets(p.targets);
            if (!targets) return { ok: false, error: 'Nije odabran nijedan proizvod/proces.' };
            const action = p.action;
            if (action !== 'complete' && action !== 'start' && action !== 'reset') {
                return { ok: false, error: 'Nepoznata radnja procesa.' };
            }
            const out: ProcessCheckPayload = { targets, action };
            if (action === 'complete') {
                if (!isISODate(p.date)) return { ok: false, error: 'Neispravan datum.' };
                const workerIds = Array.isArray(p.workerIds) ? p.workerIds.map(String).filter(Boolean) : [];
                if (workerIds.length === 0) return { ok: false, error: 'Odaberi bar jednog radnika.' };
                out.date = p.date as string;
                out.workerIds = workerIds;
                if (nonEmpty(p.notes)) out.notes = String(p.notes).trim();
            }
            return { ok: true, payload: out };
        }
        case 'process_add': {
            const itemIds = Array.isArray(p.itemIds) ? p.itemIds.map(String).filter(Boolean) : [];
            if (itemIds.length === 0) return { ok: false, error: 'Nije odabran nijedan proizvod.' };
            if (!nonEmpty(p.procName)) return { ok: false, error: 'Naziv procesa je obavezan.' };
            const out: ProcessAddPayload = { itemIds, procName: String(p.procName).trim() };
            if (typeof p.stageIndex === 'number') out.stageIndex = p.stageIndex;
            return { ok: true, payload: out };
        }
        case 'process_remove': {
            const targets = validTargets(p.targets);
            if (!targets) return { ok: false, error: 'Nije odabran nijedan proces za brisanje.' };
            return { ok: true, payload: { targets } as ProcessRemovePayload };
        }
        case 'order_start':
        case 'order_complete':
            return { ok: true, payload: {} };
        case 'order_pause':
            return { ok: true, payload: { paused: p.paused !== false } as OrderPausePayload };
        case 'item_complete': {
            if (!nonEmpty(p.itemId)) return { ok: false, error: 'Proizvod nije određen.' };
            if (!isISODate(p.date)) return { ok: false, error: 'Neispravan datum.' };
            return { ok: true, payload: { itemId: String(p.itemId), date: p.date as string } as ItemCompletePayload };
        }
        case 'task_create': {
            if (!nonEmpty(p.title)) return { ok: false, error: 'Zadatak mora imati naslov.' };
            const out: TaskCreatePayload = { title: String(p.title).trim() };
            if (nonEmpty(p.priority)) out.priority = String(p.priority);
            if (nonEmpty(p.productId)) out.productId = String(p.productId);
            return { ok: true, payload: out };
        }
        case 'task_status': {
            if (!nonEmpty(p.taskId)) return { ok: false, error: 'Zadatak nije određen.' };
            const out: TaskStatusPayload = { taskId: String(p.taskId), done: p.done !== false };
            if (nonEmpty(p.taskTitle)) out.taskTitle = String(p.taskTitle);
            return { ok: true, payload: out };
        }
        case 'task_delete': {
            if (!nonEmpty(p.taskId)) return { ok: false, error: 'Zadatak nije određen.' };
            const out: TaskDeletePayload = { taskId: String(p.taskId) };
            if (nonEmpty(p.taskTitle)) out.taskTitle = String(p.taskTitle);
            return { ok: true, payload: out };
        }
        case 'material_usage': {
            if (!nonEmpty(p.productId)) return { ok: false, error: 'Proizvod nije određen.' };
            const lines = validLines(p.lines, false);
            if (!lines) return { ok: false, error: 'Dodaj bar jedan materijal s količinom većom od nule.' };
            return { ok: true, payload: { productId: String(p.productId), lines } as MaterialUsagePayload };
        }
        case 'material_order': {
            if (!nonEmpty(p.productId)) return { ok: false, error: 'Proizvod nije određen.' };
            const lines = validLines(p.lines, true);
            if (!lines) return { ok: false, error: 'Odaberi materijale iz sastavnice s količinom.' };
            return { ok: true, payload: { productId: String(p.productId), lines } as MaterialOrderPayload };
        }
        default:
            return { ok: false, error: 'Nepoznata vrsta prijedloga.' };
    }
}

// ─── Ljudski opis ─────────────────────────────────────────────────────

const KIND_LABEL: Record<ChangeRequestKind, string> = {
    process_check: 'Proces', process_add: 'Novi proces', process_remove: 'Brisanje procesa',
    order_start: 'Pokretanje naloga', order_pause: 'Pauza naloga', order_complete: 'Zatvaranje naloga',
    item_complete: 'Zatvaranje proizvoda',
    task_create: 'Novi zadatak', task_status: 'Zadatak', task_delete: 'Brisanje zadatka',
    material_usage: 'Ugradnja materijala', material_order: 'Prijedlog narudžbe',
};

export function requestKindLabel(kind: ChangeRequestKind): string {
    return KIND_LABEL[kind] || kind;
}

export interface SummaryContext {
    productName?: string;
    workOrderName?: string;
    procName?: string;
    itemCount?: number;
    lineCount?: number;
    action?: string;
}

/** Kratka rečenica koju odobravač vidi u redu za odobrenje. */
export function summarizeRequest(kind: ChangeRequestKind, ctx: SummaryContext = {}): string {
    const wo = ctx.workOrderName ? ` (${ctx.workOrderName})` : '';
    switch (kind) {
        case 'process_check': {
            const verb = ctx.action === 'complete' ? 'završen' : ctx.action === 'start' ? 'pokrenut' : 'poništen';
            const proc = ctx.procName ? `„${ctx.procName}"` : 'proces';
            const scope = ctx.itemCount && ctx.itemCount > 1 ? ` na ${ctx.itemCount} proizvoda` : '';
            return `Proces ${proc} ${verb}${scope}${wo}`;
        }
        case 'process_add':
            return `Dodaj proces „${ctx.procName || ''}"${ctx.itemCount && ctx.itemCount > 1 ? ` na ${ctx.itemCount} proizvoda` : ''}${wo}`;
        case 'process_remove':
            return `Obriši proces „${ctx.procName || ''}"${wo}`;
        case 'order_start':
            return `Pokreni nalog${wo}`;
        case 'order_pause':
            return `${ctx.action === 'resume' ? 'Nastavi' : 'Pauziraj'} nalog${wo}`;
        case 'order_complete':
            return `Zatvori nalog${wo}`;
        case 'item_complete':
            return `Zatvori proizvod ${ctx.productName || ''}`.trim() + wo;
        case 'task_create':
            return `Novi zadatak${wo}`;
        case 'task_status':
            return `Zadatak označen ${ctx.action === 'undone' ? 'nezavršenim' : 'završenim'}`;
        case 'task_delete':
            return `Obriši zadatak`;
        case 'material_usage':
            return `Ugradio ${ctx.lineCount || 0} materijal${ctx.lineCount === 1 ? '' : 'a'} na ${ctx.productName || 'proizvod'}`;
        case 'material_order':
            return `Predlaže narudžbu ${ctx.lineCount || 0} materijal${ctx.lineCount === 1 ? 'a' : 'a'} za ${ctx.productName || 'proizvod'}`;
        default:
            return requestKindLabel(kind);
    }
}
