// ════════════════════════════════════════════════════════════════════
// Redovi „Procesi naloga" (OrderProcessBoard) — čista, testabilna projekcija.
//
// Izvučeno iz komponente da bi se DEDUP duplih čvorova istog procesa mogao
// pokriti testovima. Board obećava „isti proces = JEDAN red": ako graf (snimljen
// ili sintetizovan) sadrži više čvorova istog naziva (zaostatak stare sinhronizacije;
// često naslagani na istoj poziciji pa nevidljivi u canvas-u), ovdje se spajaju u
// jedan red — bez diranja snimljenog grafa.
// ════════════════════════════════════════════════════════════════════

import type { WorkOrderItem, ProcessNode, ProcessEdge } from '@/lib/types';
import { nodeMatchesProcess, computeProcessGating } from '@/lib/productProcesses';
import { layoutProcessGraph } from '@/lib/processLayout';
import { SPECIAL_LETTERS } from '@/lib/classify/patternNormalize';

export type ProcRowState = 'done' | 'active' | 'blocked';

export type ProcPerItem = {
    itemId: string;
    itemName: string;
    procName: string;               // TAČNO ime procesa na stavci (za updateItemProcess)
    status: string;                 // Na čekanju | U toku | Završeno | Odloženo
    workerName?: string;
    helpers: { Worker_ID: string; Worker_Name: string }[];
    completedAt?: string;
};

export type ProcRow = {
    id: string;
    key: string;
    name: string;
    perItem: ProcPerItem[];
    done: number;
    total: number;
    workers: string[];
    predIds: string[];
    state: ProcRowState;
};

// Ćirilična slova koja IZGLEDAJU kao latinična (homoglifi) → latinica. Čest uzrok
// „isto izgleda, a različiti bajtovi" kad se naziv unese s miješanim rasporedom tastature.
const HOMOGLYPHS: Record<string, string> = {
    'а': 'a', 'е': 'e', 'о': 'o', 'с': 'c', 'р': 'p', 'у': 'y', 'х': 'x', 'к': 'k', 'і': 'i', 'ј': 'j', 'ѕ': 's', 'ԁ': 'd',
    'А': 'a', 'Е': 'e', 'О': 'o', 'С': 'c', 'Р': 'p', 'У': 'y', 'Х': 'x', 'К': 'k', 'І': 'i', 'Ј': 'j', 'Ѕ': 's', 'В': 'b', 'М': 'm', 'Н': 'h', 'Т': 't',
};

/**
 * ROBUSTAN ključ za spajanje redova istog procesa. Golimi `trim().toLowerCase()`
 * NE hvata razlike koje se ne vide u UI-ju a čine nazive različitim stringovima:
 *  - dijakritici / Unicode kompatibilne forme → NFKD dekompozicija,
 *  - SVI kombinujući (\p{M}) i kontrolni/format/nevidljivi znakovi (\p{C}: zero-width,
 *    soft hyphen, word joiner, smjer-markeri, BOM…) → uklonjeni (ne samo šačica njih),
 *  - ćirilični HOMOGLIFI koji izgledaju kao latinica → presložni na latinicu,
 *  - višestruki/rubni razmaci → sažeti.
 * Zato dva „Lakiranje" čvora koja izgledaju identično uvijek daju ISTI ključ → jedan red.
 */
export function dedupeProcessKey(s: string): string {
    let out = '';
    // SPECIAL_LETTERS prije NFKD: `đ` je jedan kodni znak koji se NE razlaže, pa bi
    // inače preživio i pravio zaseban ključ („Vođice" ≠ „Vodice").
    let pre = '';
    for (const ch of (s || '')) pre += SPECIAL_LETTERS[ch] ?? ch;
    for (const ch of pre.normalize('NFKD')) out += HOMOGLYPHS[ch] ?? ch;
    return out
        .replace(/[\p{C}\p{M}]/gu, '')   // kontrolni/format/nevidljivi + kombinujući znakovi
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

/**
 * Spoji redove s ISTIM (robustnim) ključem u jedan: unija pokrivenih proizvoda
 * (dedup po itemId), stanje = najbolje od grupe (done ako SVI done; inače active ako
 * IJEDAN active; inače blocked). Redoslijed prati prvo pojavljivanje ključa.
 */
export function mergeDuplicateNameRows(list: ProcRow[]): ProcRow[] {
    const byKey = new Map<string, ProcRow[]>();
    list.forEach(r => {
        const k = dedupeProcessKey(r.name);
        if (!byKey.has(k)) byKey.set(k, []);
        byKey.get(k)!.push(r);
    });
    const merged: ProcRow[] = [];
    byKey.forEach(group => {
        if (group.length === 1) { merged.push(group[0]); return; }
        const perItemByItemId = new Map<string, ProcPerItem>();
        // Prednost ima ne-čekajući zapis (npr. Završeno) da spojeni red pokaže stvarni napredak.
        group.forEach(r => r.perItem.forEach(p => {
            const prev = perItemByItemId.get(p.itemId);
            if (!prev || (prev.status === 'Na čekanju' && p.status !== 'Na čekanju')) perItemByItemId.set(p.itemId, p);
        }));
        const perItem = Array.from(perItemByItemId.values());
        const done = perItem.filter(p => p.status === 'Završeno').length;
        const wset = new Map<string, string>();
        perItem.filter(p => p.status === 'Završeno').forEach(p => {
            if (p.workerName) wset.set(p.workerName, p.workerName);
            (p.helpers || []).forEach(h => h.Worker_Name && wset.set(h.Worker_Name, h.Worker_Name));
        });
        const state: ProcRowState = group.every(r => r.state === 'done') ? 'done'
            : group.some(r => r.state === 'active') ? 'active' : 'blocked';
        merged.push({
            id: group[0].id, key: group[0].key, name: group[0].name,
            perItem, done, total: perItem.length, workers: Array.from(wset.values()),
            predIds: Array.from(new Set(group.flatMap(r => r.predIds))),
            state,
        });
    });
    return merged;
}

/**
 * Izgradi redove (perItem + gating + stanje) iz proizvoljnog skupa čvorova/veza,
 * pa spoji duplirane nazive. Gating se računa PO ORIGINALNOM čvoru (prije spajanja) —
 * inače bi prethodnici bili netačni.
 */
export function buildOrderProcessRows(nodes: ProcessNode[], edges: ProcessEdge[], items: WorkOrderItem[]): ProcRow[] {
    if (!nodes.length) return [];
    const itemById = new Map(items.map(it => [it.ID, it]));

    const allPositioned = nodes.every(n => n.position);
    const pos: Record<string, { x: number; y: number }> = allPositioned
        ? Object.fromEntries(nodes.map(n => [n.id, n.position!]))
        : layoutProcessGraph(nodes.map(n => ({ id: n.id })), edges.map(e => ({ source: e.source, target: e.target })));
    const preds = new Map<string, string[]>();
    nodes.forEach(n => preds.set(n.id, []));
    edges.forEach(e => { if (preds.has(e.target)) preds.get(e.target)!.push(e.source); });

    const ordered = [...nodes].sort((a, b) => {
        const pa = pos[a.id] || { x: 0, y: 0 }, pb = pos[b.id] || { x: 0, y: 0 };
        return pa.x - pb.x || pa.y - pb.y;
    });

    const doneById = new Map<string, boolean>();
    const base: Omit<ProcRow, 'state'>[] = ordered.map(n => {
        const covered = (n.itemIds && n.itemIds.length) ? n.itemIds : items.map(i => i.ID);
        const perItem: ProcPerItem[] = covered.map(itemId => {
            const it = itemById.get(itemId);
            const proc = it?.Processes?.find(p => nodeMatchesProcess({ name: n.name, aliases: n.aliases }, p.Process_Name));
            return {
                itemId, itemName: it?.Product_Name || '—',
                procName: proc?.Process_Name || n.name,
                status: (proc?.Status as string) || 'Na čekanju',
                workerName: proc?.Worker_Name, helpers: proc?.Helpers || [], completedAt: proc?.Completed_At,
            };
        });
        const done = perItem.filter(p => p.status === 'Završeno').length;
        const total = perItem.length;
        doneById.set(n.id, total > 0 && done === total);
        const wset = new Map<string, string>();
        perItem.filter(p => p.status === 'Završeno').forEach(p => {
            if (p.workerName) wset.set(p.workerName, p.workerName);
            (p.helpers || []).forEach(h => h.Worker_Name && wset.set(h.Worker_Name, h.Worker_Name));
        });
        return { id: n.id, key: dedupeProcessKey(n.name), name: n.name, perItem, done, total, workers: Array.from(wset.values()), predIds: preds.get(n.id) || [] };
    });

    const gating = computeProcessGating(base.map(b => b.id), edges, doneById);
    const withState: ProcRow[] = base.map(r => ({ ...r, state: gating.get(r.id) || 'blocked' }));
    return mergeDuplicateNameRows(withState);
}
