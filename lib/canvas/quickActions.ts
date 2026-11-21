// ════════════════════════════════════════════════════════════════════
// PLATNO · BRZE AKCIJE NAD NALOGOM (faza 5)
//
// Uređivanje u panelu bez prekucavanja: ±½ dana, zamijeni par, podijeli na dva,
// spoji s drugim nalogom istog projekta. Sve su čiste funkcije nad blokom —
// reducer ih primjenjuje kao JEDNU izmjenu (jedan Ctrl+Z), a ocjena plana
// (faza 4) odmah kaže ako izmjena napravi sudar, s „Preračunaj".
//
// Trajanje se računa u polovinama dana, istim pravilom kao optimizator
// (lib/canvas/opt/sgs.ts): radnik-dani ÷ ekipa, prvi dan od podne ako blok tako
// počinje, zadnji dan do podne kad ostane pola dana posla.
//
// jest: lib/__tests__/platnoUredivanje.test.ts
// ════════════════════════════════════════════════════════════════════

import type { PlanBlock, PlanCrew } from '../types';
import { crewWorkerRefs } from '../types';
import { addDays } from './model';

/** Radi li ekipa bloka tog dana (nedjelja, praznik, subota po smjeni). */
export type IsWork = (iso: string) => boolean;

const EPS = 1e-6;

export const crewSizeOf = (b: PlanBlock) => Math.max(1, b.crew || (b.workerRefs || []).filter(r => r.id || r.name).length || 1);

/** Kraj bloka od početka za `need` dana ekipe, u polovinama dana. */
export function halfSpan(startISO: string, startsPM: boolean, need: number, isWork: IsWork): { endISO: string; endsAM: boolean } {
    let left = Math.max(0.5, Math.ceil(need * 2 - EPS) / 2);
    let iso = startISO;
    let first = true;
    for (let i = 0; i < 800; i++) {
        if (isWork(iso)) {
            const can = first && startsPM ? 0.5 : 1;
            first = false;
            if (left <= 0.5 + EPS && can === 1) return { endISO: iso, endsAM: left <= 0.5 + EPS && left > EPS };
            left -= can;
            if (left <= EPS) return { endISO: iso, endsAM: false };
        }
        iso = addDays(iso, 1);
    }
    return { endISO: iso, endsAM: false };
}

/** Patch kraja i polovina za blok s datim radnik-danima i ekipom. */
function spanPatch(b: PlanBlock, workerDays: number, crew: number, isWork: IsWork): Partial<PlanBlock> {
    const { endISO, endsAM } = halfSpan(b.startISO, !!b.startsPM, workerDays / crew, isWork);
    return { workerDays, crew, endISO, endsAM };
}

/** ±½ dana trajanja (radnik-dani se mijenjaju za ½ × ekipa). null kad bi pao ispod pola dana. */
export function adjustHalfDay(b: PlanBlock, delta: 0.5 | -0.5, isWork: IsWork): Partial<PlanBlock> | null {
    const crew = crewSizeOf(b);
    const days = Math.round(((b.workerDays || crew) / crew) * 2) / 2 + delta;
    if (days < 0.5 - EPS) return null;
    return spanPatch(b, days * crew, crew, isWork);
}

/** Drugi par iz kandidata: radnici, veličina ekipe i kraj (isti posao, druga ekipa). */
export function swapCrewPatch(b: PlanBlock, crew: PlanCrew, isWork: IsWork): Partial<PlanBlock> {
    const refs = crewWorkerRefs(crew);
    const size = Math.max(1, refs.length);
    return { ...spanPatch(b, b.workerDays || size, size, isWork), workerRefs: refs, assignedCrewId: crew.id };
}

/** Podijeli nalog na dva dijela (pola radnik-dana svaki); drugi dio počinje dan poslije prvog. */
export function splitBlock(b: PlanBlock, isWork: IsWork, newId: string): [PlanBlock, PlanBlock] | null {
    const crew = crewSizeOf(b);
    const wd = b.workerDays || 0;
    if (wd < crew - EPS) return null;                  // manje od dana ekipe — nema šta dijeliti
    const firstWD = Math.round((wd / 2 / crew) * 2) / 2 * crew;
    const restWD = wd - firstWD;
    const base = b.title.replace(/\s*\(\d\/\d\)$/, '');
    const products = b.productRefs || [];
    const cut = Math.ceil(products.length / 2);
    const a: PlanBlock = { ...b, title: `${base} (1/2)`, ...spanPatch(b, firstWD, crew, isWork), productRefs: products.length > 1 ? products.slice(0, cut) : b.productRefs };
    let start = addDays(a.endISO!, 1);
    for (let i = 0; i < 30 && !isWork(start); i++) start = addDays(start, 1);
    const second0: PlanBlock = { ...b, id: newId, title: `${base} (2/2)`, startISO: start, startsPM: false, productRefs: products.length > 1 ? products.slice(cut) : b.productRefs };
    delete second0.linkedWorkOrderId;
    delete second0.promotedAt;
    const second: PlanBlock = { ...second0, ...spanPatch(second0, restWD, crew, isWork) };
    delete second.startsPM;
    if (!a.endsAM) delete a.endsAM;
    if (!second.endsAM) delete second.endsAM;
    return [a, second];
}

/** Spoji `other` u `b`: isti projekat i vrsta; posao se sabira, proizvodi spajaju, kraj se preračuna. */
export function mergeBlocks(b: PlanBlock, other: PlanBlock, isWork: IsWork): PlanBlock | string {
    if (b.id === other.id) return 'Isti nalog.';
    if (b.kind !== other.kind) return 'Spajaju se samo nalozi iste vrste.';
    if ((b.projectRef?.id || '') !== (other.projectRef?.id || '')) return 'Spajaju se samo nalozi istog projekta.';
    if (b.linkedWorkOrderId && other.linkedWorkOrderId) return 'Oba naloga su već stvarni nalozi — spoji ih u proizvodnji.';
    const first = b.startISO <= other.startISO ? b : other;
    const crew = crewSizeOf(b);
    const wd = (b.workerDays || 0) + (other.workerDays || 0);
    const base: PlanBlock = {
        ...b,
        startISO: first.startISO,
        startsPM: first.startsPM,
        title: b.title.replace(/\s*\(\d\/\d\)$/, ''),
        productRefs: [...(b.productRefs || []), ...(other.productRefs || [])],
        linkedWorkOrderId: b.linkedWorkOrderId || other.linkedWorkOrderId,
        crewOptions: b.crewOptions?.length ? b.crewOptions : other.crewOptions,
        priority: rankMax(b.priority, other.priority),
    };
    const merged: PlanBlock = { ...base, ...(wd > 0 ? spanPatch(base, wd, crew, isWork) : { endISO: b.endISO > other.endISO ? b.endISO : other.endISO }) };
    (['startsPM', 'endsAM', 'linkedWorkOrderId', 'crewOptions', 'priority'] as const).forEach(k => { if (!merged[k]) delete merged[k]; });
    return merged;
}

const RANK = { low: 1, medium: 2, high: 3, urgent: 4 } as const;
function rankMax(a?: PlanBlock['priority'], b?: PlanBlock['priority']): PlanBlock['priority'] {
    if (!a) return b;
    if (!b) return a;
    return RANK[a] >= RANK[b] ? a : b;
}
