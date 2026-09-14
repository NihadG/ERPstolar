// ════════════════════════════════════════════════════════════════════
// KOMANDNI CENTAR — AGENDA
//
// Gantt odgovara na „koliko traje i šta se preklapa". Ne odgovara na
// „šta me čeka danas" — a to je pitanje koje se postavlja svaki dan.
// Agenda čita ISTI model (TimelineItem) i pretvara ga u niz DOGAĐAJA
// poredanih po danu.
//
// Ključna razlika: stavka nije događaj. Nalog koji traje dvije sedmice
// je tri različita događaja — kreće, u toku je, ima rok. Zato se svaka
// traka razlaže na markere, pa se u „Danas" nađe i nalog koji je počeo
// prošle sedmice i završava sljedeće.
// ════════════════════════════════════════════════════════════════════

import { shiftDate, weekStart } from '../projectCommand';
import type { TimelineData, TimelineItem } from './timeline';

/** start = kreće · end = planirani kraj · due = rok · point = tačka · ongoing = traje danas */
export type AgendaMarker = 'start' | 'end' | 'due' | 'point' | 'ongoing';

export type AgendaBucketId = 'late' | 'today' | 'tomorrow' | 'week' | 'next' | 'later' | 'undated';

export interface AgendaEntry {
    key: string;
    item: TimelineItem;
    marker: AgendaMarker;
    /** Prazno samo za stavke bez ijednog datuma. */
    dateISO: string;
}

export interface AgendaDay {
    dateISO: string;
    entries: AgendaEntry[];
}

export interface AgendaBucket {
    id: AgendaBucketId;
    label: string;
    days: AgendaDay[];
    count: number;
}

export const AGENDA_LABELS: Record<AgendaBucketId, string> = {
    late: 'Kasni', today: 'Danas', tomorrow: 'Sutra', week: 'Ova sedmica',
    next: 'Sljedeća sedmica', later: 'Kasnije', undated: 'Bez roka',
};

const BUCKET_ORDER: AgendaBucketId[] = ['late', 'today', 'tomorrow', 'week', 'next', 'later', 'undated'];

const isClosed = (item: TimelineItem) => item.state === 'done' || item.state === 'cancelled';

/**
 * Događaji jedne stavke.
 *
 * Prošli početak se NE prikazuje — to je istorija, a stavka je ionako
 * vidljiva kao „u toku". Planirani kraj koji je prošao se izostavlja ako
 * stavka ima poseban rok u budućnosti: nalog koji kasni za planom, ali je
 * unutar roka, ne smije završiti u crvenoj sekciji. Crveno ostaje rezervisano
 * za stvarno kašnjenje.
 */
export function itemEvents(item: TimelineItem, today: string): { marker: AgendaMarker; dateISO: string }[] {
    if (!item.startISO) return [];
    if (item.isPoint) return [{ marker: 'point', dateISO: item.startISO }];

    const out: { marker: AgendaMarker; dateISO: string }[] = [];
    const due = item.dueISO;
    const separateDue = !!due && due !== item.endISO;

    if (item.startISO >= today) out.push({ marker: 'start', dateISO: item.startISO });
    if (!separateDue || item.endISO >= today) {
        out.push({ marker: due === item.endISO ? 'due' : 'end', dateISO: item.endISO });
    }
    if (separateDue) out.push({ marker: 'due', dateISO: due! });

    // Stavka traje sve do kasnijeg od plana i roka — nalog koji je probio plan,
    // a još je unutar roka, mora ostati vidljiv pod „Danas", ne tek na rok.
    const horizon = separateDue && due! > item.endISO ? due! : item.endISO;
    const busyToday = out.some(event => event.dateISO === today);
    if (!isClosed(item) && item.startISO < today && today <= horizon && !busyToday) {
        out.push({ marker: 'ongoing', dateISO: today });
    }
    return out;
}

const MARKER_RANK: Record<AgendaMarker, number> = { due: 0, point: 1, end: 2, start: 3, ongoing: 4 };
const KIND_RANK: Record<TimelineItem['kind'], number> = {
    deadline: 0, task: 1, order: 2, purchase: 3, plan: 4,
};

function compareEntries(a: AgendaEntry, b: AgendaEntry): number {
    return Number(b.item.late) - Number(a.item.late)
        || MARKER_RANK[a.marker] - MARKER_RANK[b.marker]
        || KIND_RANK[a.item.kind] - KIND_RANK[b.item.kind]
        || a.item.title.localeCompare(b.item.title, 'bs');
}

export function bucketFor(dateISO: string, today: string): AgendaBucketId {
    if (!dateISO) return 'undated';
    if (dateISO < today) return 'late';
    if (dateISO === today) return 'today';
    if (dateISO === shiftDate(today, 1)) return 'tomorrow';
    const weekEnd = shiftDate(weekStart(today), 6);
    if (dateISO <= weekEnd) return 'week';
    if (dateISO <= shiftDate(weekEnd, 7)) return 'next';
    return 'later';
}

/**
 * Stavke koje bi se u spisku pojavile dvaput.
 *
 * Nalog i narudžba postoje i kao traka projekta i kao traka svake pozicije —
 * u kalendaru to ima smisla (red po poziciji), u spisku je isto dvaput. Zadatak
 * vezan za poziciju, međutim, postoji SAMO kao traka pozicije; gruba provjera
 * „preskoči sve što ima poziciju" ga je potpuno brisala iz agende.
 */
function productDuplicates(items: TimelineItem[]): (item: TimelineItem) => boolean {
    const atProjectLevel = new Set(items.filter(i => !i.productId).map(i => i.refId));
    return item => !!item.productId && atProjectLevel.has(item.refId);
}

/** Isti spisak bez traka pozicije koje ponavljaju traku projekta. */
export function withoutProductDuplicates(items: TimelineItem[]): TimelineItem[] {
    const isDuplicate = productDuplicates(items);
    return items.filter(item => !isDuplicate(item));
}

/** Agenda iz vremenske ose. */
export function buildAgenda(data: TimelineData, today: string): AgendaBucket[] {
    const byBucket = new Map<AgendaBucketId, Map<string, AgendaEntry[]>>();
    const add = (entry: AgendaEntry) => {
        const bucket = bucketFor(entry.dateISO, today);
        if (!byBucket.has(bucket)) byBucket.set(bucket, new Map());
        const days = byBucket.get(bucket)!;
        if (!days.has(entry.dateISO)) days.set(entry.dateISO, []);
        days.get(entry.dateISO)!.push(entry);
    };

    const isDuplicate = productDuplicates(data.items);
    for (const item of data.items) {
        if (isDuplicate(item)) continue;
        for (const event of itemEvents(item, today)) {
            // Prošli događaj završene stavke nema šta da radi u spisku obaveza.
            if (event.dateISO < today && isClosed(item)) continue;
            add({ key: `${item.id}:${event.marker}`, item, marker: event.marker, dateISO: event.dateISO });
        }
    }
    const isUndatedDuplicate = productDuplicates(data.undated);
    for (const item of data.undated) {
        if (isUndatedDuplicate(item)) continue;
        add({ key: `${item.id}:undated`, item, marker: 'point', dateISO: '' });
    }

    return BUCKET_ORDER.flatMap(id => {
        const days = byBucket.get(id);
        if (!days) return [];
        const sorted = Array.from(days.entries())
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([dateISO, entries]) => ({ dateISO, entries: entries.sort(compareEntries) }));
        return [{
            id, label: AGENDA_LABELS[id], days: sorted,
            count: sorted.reduce((sum, day) => sum + day.entries.length, 0),
        }];
    });
}

/** Filtrira agendu tekstom — traži po nazivu, podnaslovu i nazivu projekta. */
export function filterAgenda(buckets: AgendaBucket[], keep: (item: TimelineItem) => boolean): AgendaBucket[] {
    return buckets.flatMap(bucket => {
        const days = bucket.days
            .map(day => ({ dateISO: day.dateISO, entries: day.entries.filter(e => keep(e.item)) }))
            .filter(day => day.entries.length > 0);
        if (days.length === 0) return [];
        return [{ ...bucket, days, count: days.reduce((sum, day) => sum + day.entries.length, 0) }];
    });
}
