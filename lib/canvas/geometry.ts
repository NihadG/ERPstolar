// ════════════════════════════════════════════════════════════════════
// PLATNO — GEOMETRIJA (datum ↔ piksel)
//
// Sve mjere su OVDJE i EKSPORTOVANE. U starom planeru su `cellWidth = 65` i
// `LANE_SLOT = 44` zakopani u tijelu komponente, a širina reda (200px) postoji
// samo u CSS-u na dva mjesta — pa se JS i CSS mogu razići a da niko ne primijeti.
// CSS ove vrijednosti čita kroz CSS varijable koje postavlja komponenta.
//
// Čista funkcija, bez Reacta i bez DOM-a → testabilno.
// ════════════════════════════════════════════════════════════════════

import type { PlanZoom } from '../types';
import { addDays, diffDays, toISODate } from './model';

/** Širina jednog DANA u pikselima, po nivou zuma. */
export const DAY_WIDTH: Record<PlanZoom, number> = {
    dan: 56,        // vidi se svaki dan s brojem
    sedmica: 22,    // ~150px sedmica — radni horizont
    mjesec: 7,      // ~210px mjesec — kvartalni pregled
};

/** Visina jednog reda i jedne trake unutar reda (kad se blokovi preklapaju). */
export const LANE_HEIGHT = 40;
export const LANE_GAP = 6;
export const ROW_PADDING = 8;
/** Minimalna visina reda i kad je prazan. */
export const MIN_ROW_HEIGHT = LANE_HEIGHT + ROW_PADDING * 2;

/** Širina lijeve kolone s nazivima redova. */
export const HEADER_WIDTH = 220;
/** Visina zaglavlja s datumima. */
export const TIMELINE_HEADER_HEIGHT = 52;

/** Ispod ove širine blok prikazuje samo boju, bez teksta (inače je nečitljiv). */
export const MIN_LABEL_WIDTH = 44;
/** Zona hvatanja ivice za razvlačenje. */
export const RESIZE_HANDLE_PX = 8;

export interface Viewport {
    /** Datum na lijevoj ivici platna. */
    anchorISO: string;
    zoom: PlanZoom;
    /** Širina vidljivog platna u pikselima (bez lijeve kolone). */
    widthPx: number;
}

export interface BlockRect {
    left: number;
    width: number;
    /** true kad blok počinje prije lijeve ivice — crta se strelica „nastavlja se". */
    clippedStart: boolean;
    clippedEnd: boolean;
    /** false kad je blok potpuno izvan vidljivog raspona → ne renderuj ga. */
    visible: boolean;
}

// ── Osnovne pretvorbe ───────────────────────────────────────────────

export function dayWidth(zoom: PlanZoom): number {
    return DAY_WIDTH[zoom];
}

/** Koliko dana stane u vidljivu širinu (zaokruženo naviše, +1 za rubni dan). */
export function visibleDayCount(vp: Viewport): number {
    return Math.ceil(vp.widthPx / dayWidth(vp.zoom)) + 1;
}

/** Datumi vidljivog raspona, uključivo. */
export function visibleDates(vp: Viewport): string[] {
    const n = visibleDayCount(vp);
    const out: string[] = [];
    for (let i = 0; i < n; i++) out.push(addDays(vp.anchorISO, i));
    return out;
}

/** X piksel lijeve ivice datuma (može biti negativan ako je prije anchora). */
export function xForDate(iso: string, vp: Viewport): number {
    return diffDays(vp.anchorISO, iso) * dayWidth(vp.zoom);
}

/** Datum na X pikselu — obrat `xForDate`. Zaokružuje NADOLJE (dan u kojem X leži). */
export function dateAtX(x: number, vp: Viewport): string {
    return addDays(vp.anchorISO, Math.floor(x / dayWidth(vp.zoom)));
}

/** Pomak u danima za pomak u pikselima — za povlačenje. */
export function daysForDelta(deltaPx: number, zoom: PlanZoom): number {
    return Math.round(deltaPx / dayWidth(zoom));
}

/** Zalijepi X na početak dana. */
export function snapToDay(x: number, vp: Viewport): number {
    return Math.floor(x / dayWidth(vp.zoom)) * dayWidth(vp.zoom);
}

// ── Pravougaonik bloka ──────────────────────────────────────────────

/**
 * Geometrija bloka u vidljivom prozoru.
 *
 * Za razliku od starog planera (koji je širinu izvodio iz SKUPA DANA s zapisima rada,
 * pa je rupa u sredini davala jednu neprekinutu traku), ovdje je širina doslovno
 * `start → end`. Blok je plan, ne istorija.
 */
export function blockRect(
    startISO: string,
    endISO: string,
    vp: Viewport
): BlockRect {
    const w = dayWidth(vp.zoom);
    const rawLeft = xForDate(startISO, vp);
    // +1 jer je `end` uključiv: blok od 01. do 01. traje jedan dan
    const rawRight = xForDate(endISO, vp) + w;

    const viewRight = vp.widthPx;
    const visible = rawRight > 0 && rawLeft < viewRight;

    const left = Math.max(0, rawLeft);
    const right = Math.min(viewRight, rawRight);

    return {
        left,
        width: Math.max(visible ? 2 : 0, right - left),   // uvijek bar 2px da se vidi
        clippedStart: rawLeft < 0,
        clippedEnd: rawRight > viewRight,
        visible,
    };
}

// ── Slaganje preklopljenih blokova u trake ──────────────────────────

export interface LanePlaced<T> {
    item: T;
    lane: number;
    rect: BlockRect;
}

/**
 * Pohlepno slaganje: blok ide u prvu traku koja je slobodna u tom trenutku.
 * Ulaz se sortira po lijevoj ivici, pa je rezultat deterministički.
 *
 * NAPOMENA: preklapanje se računa po DATUMIMA, ne po pikselima — na mjesečnom zumu
 * su dva susjedna bloka udaljena 7px i piksel-provjera bi ih lažno spojila.
 */
export function packLanes<T>(
    items: T[],
    getRange: (item: T) => { startISO: string; endISO: string },
    vp: Viewport
): { placed: LanePlaced<T>[]; laneCount: number } {
    const withRect = items
        .map(item => {
            const r = getRange(item);
            return { item, range: r, rect: blockRect(r.startISO, r.endISO, vp) };
        })
        .filter(x => x.rect.visible)
        .sort((a, b) =>
            a.range.startISO.localeCompare(b.range.startISO)
            || a.range.endISO.localeCompare(b.range.endISO));

    const laneEndISO: string[] = [];
    const placed: LanePlaced<T>[] = [];

    for (const { item, range, rect } of withRect) {
        let lane = laneEndISO.findIndex(end => end < range.startISO);
        if (lane === -1) {
            lane = laneEndISO.length;
            laneEndISO.push(range.endISO);
        } else {
            laneEndISO[lane] = range.endISO;
        }
        placed.push({ item, lane, rect });
    }

    return { placed, laneCount: Math.max(1, laneEndISO.length) };
}

/** Visina reda za dati broj traka. */
export function rowHeight(laneCount: number): number {
    const lanes = Math.max(1, laneCount);
    return ROW_PADDING * 2 + lanes * LANE_HEIGHT + (lanes - 1) * LANE_GAP;
}

/** Y pozicija trake unutar reda. */
export function laneTop(lane: number): number {
    return ROW_PADDING + lane * (LANE_HEIGHT + LANE_GAP);
}

// ── Zaglavlje s datumima ────────────────────────────────────────────

export interface HeaderTick {
    iso: string;
    left: number;
    width: number;
    label: string;
    /** Naglašen (ponedjeljak na sedmičnom, 1. u mjesecu na mjesečnom). */
    major: boolean;
    isToday: boolean;
    isNonWorking: boolean;   // nedjelja
}

const MONTHS_SHORT = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'avg', 'sep', 'okt', 'nov', 'dec'];
const DOW_SHORT = ['ned', 'pon', 'uto', 'sri', 'čet', 'pet', 'sub'];

/**
 * Podjele zaglavlja. Granularnost prati zum — na mjesečnom bi svaki dan bio 7px
 * širok i nečitljiv, pa se grupiše po sedmicama.
 */
export function headerTicks(vp: Viewport, todayISOValue: string): HeaderTick[] {
    const w = dayWidth(vp.zoom);
    const dates = visibleDates(vp);
    const out: HeaderTick[] = [];

    for (let i = 0; i < dates.length; i++) {
        const iso = dates[i];
        const d = new Date(`${iso}T12:00:00`);
        const dow = d.getDay();
        const isToday = iso === todayISOValue;
        const isNonWorking = dow === 0;

        if (vp.zoom === 'mjesec') {
            // Samo ponedjeljci nose oznaku; ostali dani su tiha mreža
            if (dow !== 1) continue;
            out.push({
                iso, left: i * w, width: w * 7,
                label: `${d.getDate()}. ${MONTHS_SHORT[d.getMonth()]}`,
                major: d.getDate() <= 7, isToday, isNonWorking: false,
            });
        } else if (vp.zoom === 'sedmica') {
            out.push({
                iso, left: i * w, width: w,
                label: String(d.getDate()),
                major: dow === 1, isToday, isNonWorking,
            });
        } else {
            out.push({
                iso, left: i * w, width: w,
                label: `${DOW_SHORT[dow]} ${d.getDate()}`,
                major: dow === 1, isToday, isNonWorking,
            });
        }
    }
    return out;
}

/** Mjeseci u vidljivom rasponu — gornji red zaglavlja. */
export function monthBands(vp: Viewport): { label: string; left: number; width: number }[] {
    const w = dayWidth(vp.zoom);
    const dates = visibleDates(vp);
    const bands: { label: string; left: number; width: number }[] = [];

    let startIdx = 0;
    for (let i = 0; i <= dates.length; i++) {
        const cur = i < dates.length ? new Date(`${dates[i]}T12:00:00`) : null;
        const prev = new Date(`${dates[startIdx]}T12:00:00`);
        const changed = !cur || cur.getMonth() !== prev.getMonth() || cur.getFullYear() !== prev.getFullYear();
        if (changed) {
            bands.push({
                label: `${MONTHS_SHORT[prev.getMonth()]} ${prev.getFullYear()}`,
                left: startIdx * w,
                width: (i - startIdx) * w,
            });
            startIdx = i;
        }
    }
    return bands;
}

/** Anchor koji centrira dati datum u prozoru — za „Danas" i skok na blok. */
export function anchorCentering(iso: string, vp: Viewport): string {
    const halfDays = Math.floor(vp.widthPx / dayWidth(vp.zoom) / 2);
    return addDays(iso, -halfDays);
}

export { toISODate };
