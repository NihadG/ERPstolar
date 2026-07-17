// ════════════════════════════════════════════════════════════════════
// AUTO-RASPORED GRAFA PROCESA (layered / topološki, lijevo→desno)
// Kolona = topološka dubina (longest-path), red = grananje (barycenter).
// Čista funkcija (bez React Flow zavisnosti) → lako testabilna.
// ════════════════════════════════════════════════════════════════════

export interface XY { x: number; y: number }

export const NODE_W = 190;
export const NODE_H = 78;
const GAP_X = 70;
const GAP_Y = 30;
const X0 = 24;
const Y0 = 24;

/**
 * Topološka dubina svakog čvora (longest path od korijena; Kahn obilazak).
 * Kolona/faza = dubina. Ciklusi defenzivno idu u kolonu nakon maksimalne dubine.
 * Koriste je layoutProcessGraph (pozicije) i „Faze" pogled grafa naloga.
 */
export function computeGraphDepths(
    nodes: { id: string }[],
    edges: { source: string; target: string }[]
): Map<string, number> {
    const depth = new Map<string, number>();
    if (nodes.length === 0) return depth;

    const ids = new Set(nodes.map(n => n.id));
    const validEdges = edges.filter(e => ids.has(e.source) && ids.has(e.target) && e.source !== e.target);

    const incoming = new Map<string, string[]>();
    const outgoing = new Map<string, string[]>();
    nodes.forEach(n => { incoming.set(n.id, []); outgoing.set(n.id, []); });
    validEdges.forEach(e => { outgoing.get(e.source)!.push(e.target); incoming.get(e.target)!.push(e.source); });

    const indeg = new Map<string, number>();
    nodes.forEach(n => { indeg.set(n.id, incoming.get(n.id)!.length); depth.set(n.id, 0); });
    const queue: string[] = nodes.filter(n => indeg.get(n.id) === 0).map(n => n.id);
    let processed = 0;
    while (queue.length) {
        const u = queue.shift()!;
        processed++;
        for (const v of outgoing.get(u)!) {
            if (depth.get(v)! < depth.get(u)! + 1) depth.set(v, depth.get(u)! + 1);
            indeg.set(v, indeg.get(v)! - 1);
            if (indeg.get(v) === 0) queue.push(v);
        }
    }
    // ciklus fallback: nedostignuti čvorovi → poslije max dubine
    if (processed < nodes.length) {
        let maxD = 0; depth.forEach(d => { if (d > maxD) maxD = d; });
        nodes.forEach(n => { if (indeg.get(n.id)! > 0) depth.set(n.id, maxD + 1); });
    }
    return depth;
}

/**
 * Vrati poziciju ({x,y}) za svaki čvor po ID-u.
 * - depth (kolona) = najduži put od korijena (čvor bez ulaznih veza)
 * - red unutar kolone = barycenter (prosjek redova prethodnika) → manje preklapanja
 * - ciklusi: defenzivno, „višak" čvorova ide u kolonu nakon maksimalne dubine
 */
export function layoutProcessGraph(
    nodes: { id: string }[],
    edges: { source: string; target: string }[]
): Record<string, XY> {
    const pos: Record<string, XY> = {};
    if (nodes.length === 0) return pos;

    const ids = new Set(nodes.map(n => n.id));
    const validEdges = edges.filter(e => ids.has(e.source) && ids.has(e.target) && e.source !== e.target);

    const incoming = new Map<string, string[]>();
    nodes.forEach(n => { incoming.set(n.id, []); });
    validEdges.forEach(e => { incoming.get(e.target)!.push(e.source); });

    const depth = computeGraphDepths(nodes, validEdges);

    // grupiši po koloni
    const columns = new Map<number, string[]>();
    nodes.forEach(n => {
        const d = depth.get(n.id)!;
        if (!columns.has(d)) columns.set(d, []);
        columns.get(d)!.push(n.id);
    });

    const rowOf = new Map<string, number>();
    const bary = (id: string, fallback: number): number => {
        const ps = incoming.get(id)!
            .map(p => rowOf.get(p))
            .filter((r): r is number => r !== undefined);
        return ps.length ? ps.reduce((s, r) => s + r, 0) / ps.length : fallback;
    };

    Array.from(columns.keys()).sort((a, b) => a - b).forEach(d => {
        const colNodes = columns.get(d)!;
        const origIndex = new Map(colNodes.map((id, i) => [id, i]));
        const ordered = d === 0
            ? colNodes
            : [...colNodes].sort((a, b) => bary(a, origIndex.get(a)!) - bary(b, origIndex.get(b)!));
        ordered.forEach((id, i) => rowOf.set(id, i));
    });

    nodes.forEach(n => {
        pos[n.id] = {
            x: X0 + depth.get(n.id)! * (NODE_W + GAP_X),
            y: Y0 + rowOf.get(n.id)! * (NODE_H + GAP_Y),
        };
    });
    return pos;
}

/**
 * Raspored po FAZAMA (kolonama) bez veza: kolona = faza, red = pozicija u fazi.
 * Za graf naloga koji se učitava BEZ auto-veza (korisnik ih ručno povezuje),
 * a zadržava pregledan fazni raspored kao u planu procesa proizvoda.
 */
export function layoutColumns(columns: string[][]): Record<string, XY> {
    const pos: Record<string, XY> = {};
    columns.forEach((col, ci) => {
        col.forEach((id, ri) => {
            pos[id] = { x: X0 + ci * (NODE_W + GAP_X), y: Y0 + ri * (NODE_H + GAP_Y) };
        });
    });
    return pos;
}
