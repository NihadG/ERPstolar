// ════════════════════════════════════════════════════════════════════
// PLATNO — MODEL
//
// Čista logika, bez Firebase i bez Reacta. Ovdje živi sve što definiše ŠTA je
// blok i kako se iz posla (radnik-dani × ekipa) dobija raspon na kalendaru.
//
// Radni dani se računaju kroz POSTOJEĆI lib/planning.ts (nedjelja ne radi, subota
// po rotaciji radnika iz šihtarice) — ista pravila kao auto-rok naloga, da platno
// i stvarnost ne mjere vrijeme različito.
// ════════════════════════════════════════════════════════════════════

import { v4 as uuidv4 } from 'uuid';
import type {
    PlanScenario, PlanBlock, PlanBlockKind, PlanLink, PlanLinkKind, PlanZoom, PlanGroupBy,
} from '../types';
import { workOrderDueDate, todayISO } from '../planning';

/**
 * Firestore dokument ide do 1 MiB; blok je ~300 B. Granica je namjerno niža od
 * tehničke — bolje jasna poruka na 500 nego odbijen upis usred rada.
 */
export const MAX_BLOCKS_PER_SCENARIO = 500;

/** Trajanje kad korisnik samo klikne umjesto da povuče raspon. */
export const DEFAULT_DURATION_DAYS: Record<PlanBlockKind, number> = {
    order: 5,
    purchase: 7,      // naruči → stiže; stvarni default dolazi iz empirijskog roka
    transport: 1,
    montaza: 2,
    milestone: 1,     // uvijek jednodnevni
    note: 3,
};

export const BLOCK_LABEL: Record<PlanBlockKind, string> = {
    order: 'Nalog',
    purchase: 'Narudžba',
    transport: 'Transport',
    montaza: 'Montaža',
    // Ranije „Prekretnica" — apstraktno i nije govorilo čemu služi.
    milestone: 'Rok',
    note: 'Napomena',
};

/** Jedna rečenica objašnjenja po vrsti — prikazuje se pri izboru i u detaljima. */
export const BLOCK_HELP: Record<PlanBlockKind, string> = {
    order: 'Proizvodnja. Trajanje se računa iz radnik-dana podijeljenih ekipom.',
    purchase: 'Narudžba materijala: lijeva ivica = kad šalješ, desna = kad stiže.',
    transport: 'Prevoz do gradilišta.',
    montaza: 'Ugradnja kod klijenta.',
    milestone: 'Fiksan datum bez trajanja (rok klijentu, spremnost gradilišta). Od njega se računa lanac unazad.',
    note: 'Slobodna napomena na platnu — ne troši ljude i ne ulazi u lanac.',
};

/** Blok koji zauzima kapacitet radnika (ostali su logistika ili oznake). */
export const CONSUMES_CAPACITY: Record<PlanBlockKind, boolean> = {
    order: true, montaza: true, transport: true,
    purchase: false, milestone: false, note: false,
};

// ── Datumi ──────────────────────────────────────────────────────────

function parseDay(iso: string): Date {
    return new Date(`${iso.split('T')[0]}T12:00:00`);   // podne → imun na DST i ponoć
}

export function toISODate(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDays(iso: string, n: number): string {
    const d = parseDay(iso);
    d.setDate(d.getDate() + n);
    return toISODate(d);
}

/** Kalendarski dani između dva datuma (pozitivno = `to` je kasnije). */
export function diffDays(fromISO: string, toISO: string): number {
    return Math.round((parseDay(toISO).getTime() - parseDay(fromISO).getTime()) / 86400000);
}

export function isValidISODate(s: string | undefined | null): boolean {
    return !!s && /^\d{4}-\d{2}-\d{2}/.test(s) && !isNaN(parseDay(s).getTime());
}

/** Trajanje bloka u kalendarskim danima, uključivo (start == end → 1). */
export function blockDurationDays(block: Pick<PlanBlock, 'startISO' | 'endISO'>): number {
    return Math.max(1, diffDays(block.startISO, block.endISO) + 1);
}

// ── Posao → kalendar ────────────────────────────────────────────────

/**
 * Koliko RADNIH dana treba da se odradi `workerDays` radnik-dana s ekipom od `crew`.
 * Zaokružuje se naviše: 7 radnik-dana s 2 čovjeka = 4 radna dana (ne 3.5) — pola dana
 * se u pogonu ne isporučuje.
 */
export function workingDaysNeeded(workerDays: number, crew: number): number {
    const wd = Math.max(0, workerDays || 0);
    const c = Math.max(1, Math.floor(crew || 1));
    if (wd <= 0) return 1;
    return Math.max(1, Math.ceil(wd / c));
}

/**
 * Krajnji datum bloka iz posla. Koristi `workOrderDueDate` iz lib/planning —
 * dakle nedjelja se preskače, subota radi osim kad `isSaturdayWorking` kaže drukčije.
 */
export function endFromWork(
    startISO: string,
    workerDays: number,
    crew: number,
    isSaturdayWorking?: (d: Date) => boolean
): string {
    return workOrderDueDate(startISO, workingDaysNeeded(workerDays, crew), isSaturdayWorking);
}

/** Radni dan po pravilima radionice: nedjelja ne radi, subota po rotaciji. */
export function isWorkDay(iso: string, isSaturdayWorking?: (d: Date) => boolean): boolean {
    const d = parseDay(iso);
    const dow = d.getDay();
    if (dow === 0) return false;                                    // nedjelja
    if (dow === 6) return isSaturdayWorking ? isSaturdayWorking(d) : true;
    return true;
}

/** Prvi radni dan na ili prije `iso`. Rok koji pada u nedjelju znači „gotovo u subotu". */
export function previousWorkingDay(iso: string, isSaturdayWorking?: (d: Date) => boolean): string {
    let cur = iso;
    // Ograničenje na 14 koraka — praznična sedmica je najduži realan niz neradnih dana
    for (let i = 0; i < 14 && !isWorkDay(cur, isSaturdayWorking); i++) cur = addDays(cur, -1);
    return cur;
}

/**
 * Početak iz KRAJA i posla — ogledalo `endFromWork`, potrebno za unazadni lanac.
 * `workOrderDueDate` iz lib/planning računa samo unaprijed, pa se brojanje unazad
 * radi ovdje, po istim pravilima (nedjelja van, subota po rotaciji).
 */
export function startFromWork(
    endISO: string,
    workerDays: number,
    crew: number,
    isSaturdayWorking?: (d: Date) => boolean
): string {
    const needed = workingDaysNeeded(workerDays, crew);
    let cur = previousWorkingDay(endISO, isSaturdayWorking);
    let counted = 1;                                  // `cur` je zadnji radni dan
    let guard = 0;
    while (counted < needed && guard++ < 3650) {
        cur = addDays(cur, -1);
        if (isWorkDay(cur, isSaturdayWorking)) counted++;
    }
    return cur;
}

// ── Fabrike ─────────────────────────────────────────────────────────

export function emptyScenario(organizationId: string, name = 'Novi scenarij'): PlanScenario {
    const now = new Date().toISOString();
    return {
        Scenario_ID: uuidv4(),
        Organization_ID: organizationId,
        Name: name,
        Created_Date: now,
        Modified_Date: now,
        Version: 1,
        Blocks: [],
        Links: [],
        View: { zoom: 'sedmica', anchorISO: todayISO(), groupBy: 'project' },
    };
}

export function newBlock(
    kind: PlanBlockKind,
    startISO: string,
    endISO?: string,
    partial?: Partial<PlanBlock>
): PlanBlock {
    const start = isValidISODate(startISO) ? startISO.split('T')[0] : todayISO();
    const fallbackEnd = addDays(start, DEFAULT_DURATION_DAYS[kind] - 1);
    const block: PlanBlock = {
        id: uuidv4(),
        kind,
        title: BLOCK_LABEL[kind],
        startISO: start,
        endISO: isValidISODate(endISO) ? endISO!.split('T')[0] : fallbackEnd,
        ...partial,
    };
    return normalizeBlock(block);
}

export function newLink(from: string, to: string, kind: PlanLinkKind, lagDays?: number): PlanLink {
    return { id: uuidv4(), from, to, kind, ...(lagDays ? { lagDays } : {}) };
}

// ── Normalizacija i provjera ────────────────────────────────────────

/**
 * Popravi blok u konzistentno stanje. Zove se nakon SVAKE izmjene datuma —
 * povlačenje mišem lako proizvede end < start, a takav blok bi imao negativnu širinu.
 */
export function normalizeBlock(block: PlanBlock): PlanBlock {
    const out = { ...block };
    if (!isValidISODate(out.startISO)) out.startISO = todayISO();
    out.startISO = out.startISO.split('T')[0];

    if (out.kind === 'milestone') {
        out.endISO = out.startISO;                  // prekretnica je uvijek jedan dan
    } else {
        if (!isValidISODate(out.endISO)) out.endISO = out.startISO;
        out.endISO = out.endISO.split('T')[0];
        if (out.endISO < out.startISO) out.endISO = out.startISO;
    }

    if (out.crew !== undefined) out.crew = Math.max(1, Math.floor(out.crew) || 1);
    if (out.workerDays !== undefined) out.workerDays = Math.max(0, out.workerDays);
    if (out.leadDays !== undefined) out.leadDays = Math.max(0, Math.floor(out.leadDays));
    if (!out.title?.trim()) out.title = BLOCK_LABEL[out.kind];

    return out;
}

/** Datum kad materijal iz narudžbe stvarno stiže (kraj `purchase` bloka). */
export function deliveryDate(block: PlanBlock): string | null {
    return block.kind === 'purchase' ? block.endISO : null;
}

/** Najkasniji datum slanja narudžbe = dolazak − rok isporuke. */
export function orderByFromDelivery(deliveryISO: string, leadDays: number): string {
    return addDays(deliveryISO, -Math.max(0, Math.floor(leadDays || 0)));
}

// ── Pomoćnici nad scenarijem ────────────────────────────────────────

export function findBlock(scenario: PlanScenario, blockId: string): PlanBlock | undefined {
    return scenario.Blocks.find(b => b.id === blockId);
}

/** Veze u koje blok ULAZI (prethodnici). */
export function incomingLinks(scenario: PlanScenario, blockId: string): PlanLink[] {
    return scenario.Links.filter(l => l.to === blockId);
}

/** Veze iz kojih blok IZLAZI (nasljednici). */
export function outgoingLinks(scenario: PlanScenario, blockId: string): PlanLink[] {
    return scenario.Links.filter(l => l.from === blockId);
}

/**
 * Da li bi veza `from → to` napravila ciklus. Bez ove provjere lančani preračun
 * vrti u beskonačnost, a korisnik vidi samo zamrznut ekran.
 */
export function wouldCreateCycle(scenario: PlanScenario, from: string, to: string): boolean {
    if (from === to) return true;
    const adj = new Map<string, string[]>();
    for (const l of scenario.Links) {
        const arr = adj.get(l.from) || [];
        arr.push(l.to);
        adj.set(l.from, arr);
    }
    // Ako se iz `to` već može stići do `from`, nova veza zatvara krug.
    const seen = new Set<string>();
    const stack = [to];
    while (stack.length) {
        const cur = stack.pop()!;
        if (cur === from) return true;
        if (seen.has(cur)) continue;
        seen.add(cur);
        for (const next of adj.get(cur) || []) stack.push(next);
    }
    return false;
}

/** Raspon svih blokova — za „uklopi sve u prikaz". */
export function scenarioBounds(scenario: PlanScenario): { fromISO: string; toISO: string } | null {
    if (!scenario.Blocks.length) return null;
    let from = scenario.Blocks[0].startISO;
    let to = scenario.Blocks[0].endISO;
    for (const b of scenario.Blocks) {
        if (b.startISO < from) from = b.startISO;
        if (b.endISO > to) to = b.endISO;
    }
    return { fromISO: from, toISO: to };
}

export const GROUP_BY_LABEL: Record<PlanGroupBy, string> = {
    project: 'Projekt',
    worker: 'Radnik',
    supplier: 'Dobavljač',
    kind: 'Vrsta',
};

export const ZOOM_LABEL: Record<PlanZoom, string> = {
    dan: 'Dan',
    sedmica: 'Sedmica',
    mjesec: 'Mjesec',
};
