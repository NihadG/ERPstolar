// ════════════════════════════════════════════════════════════════════
// PLATNO — LANČANI PRERAČUN
//
// Ovo je jezgro platna. U ETO stolariji vezujuće ograničenje nije kapacitet nego
// ROK ISPORUKE MATERIJALA: prekovremeno se uvijek može, dobavljača ne možeš ubrzati.
// Zato se planira UNAZAD od fiksne obaveze:
//
//   Montaža (klijent fiksirao)
//     ← transport
//     ← proizvodnja gotova
//     ← proizvodnja (radnik-dani ÷ ekipa, po radnim danima)
//     ← materijal mora biti tu
//     ← rok isporuke dobavljača
//     ← NAJKASNIJI DATUM NARUDŽBE   ← operativni odgovor
//
// VAŽNO: ova funkcija NIŠTA NE MIJENJA. Vraća PRIJEDLOG RAZLIKA koji korisnik
// vidi prije primjene. To je razlika između alata i automatike koju je korisnik
// izričito odbio — čovjek pokreće, čovjek potvrđuje.
// ════════════════════════════════════════════════════════════════════

import type { PlanScenario, PlanBlock, PlanLink } from '../types';
import {
    addDays, diffDays, blockDurationDays, startFromWork, endFromWork,
    previousWorkingDay, orderByFromDelivery,
} from './model';

export interface ScheduleChange {
    id: string;
    title: string;
    kind: PlanBlock['kind'];
    /** Trenutno stanje. */
    fromStartISO: string;
    fromEndISO: string;
    /** Predloženo stanje. */
    startISO: string;
    endISO: string;
    /** Pomak u danima; negativno = ranije. */
    deltaDays: number;
    /** Za narudžbe: najkasniji datum slanja koji iz ovoga slijedi. */
    orderByISO?: string;
}

export interface ChainResult {
    anchorId: string;
    anchorTitle: string;
    anchorISO: string;
    /** Blokovi koje treba pomjeriti (bez zaključanih). */
    changes: ScheduleChange[];
    /** Zaključani blokovi koje bi lanac pomjerio — prikazuju se, ali se NE mijenjaju. */
    blockedByLock: ScheduleChange[];
    /**
     * Koliko dana fali. > 0 znači da bi neka narudžba morala otići u prošlost —
     * lanac ne stane i to se mora reći otvoreno, a ne sakriti.
     */
    shortfallDays: number;
    /** Narudžbe kojima rok slanja ističe uskoro ili je prošao. */
    urgentOrders: { id: string; title: string; orderByISO: string; daysLeft: number }[];
    warnings: string[];
}

export interface ChainOptions {
    /** Subotnja rotacija (buildSaturdayChecker iz lib/planning). */
    isSaturdayWorking?: (d: Date) => boolean;
    /** Današnji datum — injektabilno za testove. */
    todayISO: string;
}

/**
 * Datum kad PRETHODNIK mora završiti, da bi NASLJEDNIK mogao početi `toStartISO`.
 *
 * Semantika po vrsti veze:
 *  - finish-to-start / finish-to-montaza: nasljednik kreće DAN POSLIJE
 *    (`from.end + 1 + lag = to.start`)
 *  - delivery-to-start: materijal koji stigne NA DAN starta je stigao na vrijeme
 *    (`from.end + lag = to.start`) — pola dana kašnjenja nije kašnjenje
 */
function requiredEndFor(link: PlanLink, toStartISO: string): string {
    const lag = Math.max(0, link.lagDays || 0);
    return link.kind === 'delivery-to-start'
        ? addDays(toStartISO, -lag)
        : addDays(toStartISO, -lag - 1);
}

/** Početak bloka iz zadanog kraja — posao ako je poznat, inače očuvano trajanje. */
function startForEnd(block: PlanBlock, endISO: string, opts: ChainOptions): string {
    if (block.kind === 'purchase') {
        // Narudžba: trajanje = rok isporuke, u KALENDARSKIM danima (dobavljač ne
        // poznaje naše radne dane)
        const lead = Math.max(0, block.leadDays ?? Math.max(0, blockDurationDays(block) - 1));
        return addDays(endISO, -lead);
    }
    if ((block.kind === 'order' || block.kind === 'montaza') && (block.workerDays || 0) > 0) {
        return startFromWork(endISO, block.workerDays!, block.crew || 1, opts.isSaturdayWorking);
    }
    // Bez podataka o poslu čuvamo trajanje kakvo jeste
    return addDays(endISO, -(blockDurationDays(block) - 1));
}

/**
 * Svi PRECI bloka (tranzitivno, kroz veze) — ne uključuje sam blok.
 * Dijeli je computeBackwardChain i captureChainTemplate (lib/canvas/templates.ts),
 * da hodanje kroz graf postoji na jednom mjestu.
 */
export function chainAncestors(scenario: PlanScenario, anchorId: string): Set<string> {
    const incoming = new Map<string, string[]>();
    for (const l of scenario.Links) {
        const arr = incoming.get(l.to) || [];
        arr.push(l.from);
        incoming.set(l.to, arr);
    }
    const ancestors = new Set<string>();
    const stack = [anchorId];
    while (stack.length) {
        const cur = stack.pop()!;
        for (const from of incoming.get(cur) || []) {
            if (ancestors.has(from) || from === anchorId) continue;
            ancestors.add(from);
            stack.push(from);
        }
    }
    return ancestors;
}

/**
 * Unazadni preračun od `anchorId`.
 *
 * Sidro se NE pomjera (to je datum koji je klijent dao). Svi njegovi preci se
 * guraju unazad tek koliko treba. Zaključani preci ostaju gdje jesu i sami
 * postaju sidro za svoj dio lanca.
 */
export function computeBackwardChain(
    scenario: PlanScenario,
    anchorId: string,
    opts: ChainOptions
): ChainResult | null {
    const blocks = new Map(scenario.Blocks.map(b => [b.id, b]));
    const anchor = blocks.get(anchorId);
    if (!anchor) return null;

    const outgoing = new Map<string, PlanLink[]>();
    for (const l of scenario.Links) {
        const arr = outgoing.get(l.from) || [];
        arr.push(l);
        outgoing.set(l.from, arr);
    }

    const resolved = new Map<string, { startISO: string; endISO: string }>();
    /** Šta bi lanac tražio za ZAKLJUČANE blokove — samo za prikaz, nikad za primjenu. */
    const wouldBe = new Map<string, { startISO: string; endISO: string }>();
    const inProgress = new Set<string>();
    const warnings: string[] = [];

    resolved.set(anchorId, { startISO: anchor.startISO, endISO: anchor.endISO });

    /** Rekurzivno razriješi datume bloka iz njegovih nasljednika. */
    const resolve = (id: string): { startISO: string; endISO: string } => {
        const cached = resolved.get(id);
        if (cached) return cached;

        const block = blocks.get(id)!;
        // Zaštita od ciklusa u zatečenim podacima (reducer ih sprječava pri unosu,
        // ali dokument iz baze može biti stariji ili ručno mijenjan)
        if (inProgress.has(id)) {
            warnings.push(`Kružna veza kod „${block.title}" — preskočena.`);
            return { startISO: block.startISO, endISO: block.endISO };
        }
        inProgress.add(id);

        const outs = outgoing.get(id) || [];
        let latestEnd: string | null = null;
        for (const link of outs) {
            if (!blocks.has(link.to)) continue;
            const target = resolve(link.to);
            const required = requiredEndFor(link, target.startISO);
            if (latestEnd === null || required < latestEnd) latestEnd = required;
        }
        inProgress.delete(id);

        if (latestEnd === null) {
            // Nije vezan ni za šta u lancu — ostaje gdje jeste
            const asIs = { startISO: block.startISO, endISO: block.endISO };
            resolved.set(id, asIs);
            return asIs;
        }

        // Zaključan blok je nepomjeriv i sam postaje sidro za svoje pretke.
        // ALI se pamti šta bi lanac tražio — inače korisnik ne vidi da mu baš taj
        // zaključani blok ruši plan, nego samo da se „ništa nije desilo".
        if (block.locked) {
            const wouldEnd = block.kind === 'purchase'
                ? latestEnd
                : previousWorkingDay(latestEnd, opts.isSaturdayWorking);
            wouldBe.set(id, { startISO: startForEnd(block, wouldEnd, opts), endISO: wouldEnd });
            const asIs = { startISO: block.startISO, endISO: block.endISO };
            resolved.set(id, asIs);
            return asIs;
        }

        // Rok koji pada u nedjelju stvarno znači „gotovo u subotu"
        const end = block.kind === 'purchase'
            ? latestEnd
            : previousWorkingDay(latestEnd, opts.isSaturdayWorking);
        const out = { startISO: startForEnd(block, end, opts), endISO: end };
        resolved.set(id, out);
        return out;
    };

    // Svi preci sidra (tranzitivno) — samo oni ulaze u preračun
    const ancestors = chainAncestors(scenario, anchorId);

    const changes: ScheduleChange[] = [];
    const blockedByLock: ScheduleChange[] = [];
    const urgentOrders: ChainResult['urgentOrders'] = [];
    let shortfallDays = 0;

    for (const id of ancestors) {
        const block = blocks.get(id)!;
        const next = resolve(id);
        const deltaDays = diffDays(block.startISO, next.startISO);

        const change: ScheduleChange = {
            id,
            title: block.title,
            kind: block.kind,
            fromStartISO: block.startISO,
            fromEndISO: block.endISO,
            startISO: next.startISO,
            endISO: next.endISO,
            deltaDays,
        };

        if (block.kind === 'purchase') {
            const lead = Math.max(0, block.leadDays ?? Math.max(0, blockDurationDays(block) - 1));
            change.orderByISO = orderByFromDelivery(next.endISO, lead);
            const daysLeft = diffDays(opts.todayISO, change.orderByISO);
            if (daysLeft < 0) {
                // Narudžba bi morala otići u prošlost — ovoliko dana fali cijelom lancu
                shortfallDays = Math.max(shortfallDays, -daysLeft);
            }
            if (daysLeft <= 3) {
                urgentOrders.push({ id, title: block.title, orderByISO: change.orderByISO, daysLeft });
            }
        }

        if (block.locked) {
            const w = wouldBe.get(id);
            if (w && (w.startISO !== block.startISO || w.endISO !== block.endISO)) {
                blockedByLock.push({
                    ...change,
                    startISO: w.startISO,
                    endISO: w.endISO,
                    deltaDays: diffDays(block.startISO, w.startISO),
                });
            }
        } else if (deltaDays !== 0 || next.endISO !== block.endISO) {
            changes.push(change);
        }
    }

    changes.sort((a, b) => a.startISO.localeCompare(b.startISO) || a.title.localeCompare(b.title, 'hr'));
    urgentOrders.sort((a, b) => a.daysLeft - b.daysLeft);

    if (ancestors.size === 0) {
        warnings.push('Ovaj blok nema ništa vezano ispred sebe — poveži narudžbu i proizvodnju.');
    }
    if (blockedByLock.length) {
        warnings.push(`${blockedByLock.length} zaključanih blokova se ne pomjera — otključaj ih ako želiš da uđu u lanac.`);
    }

    return {
        anchorId,
        anchorTitle: anchor.title,
        anchorISO: anchor.startISO,
        changes,
        blockedByLock,
        shortfallDays,
        urgentOrders,
        warnings,
    };
}

/**
 * Unaprijedni preračun — od zadanog bloka gura NASLJEDNIKE tek koliko treba.
 * Koristi se kad korisnik pomjeri jedan blok i želi da lanac krene za njim.
 */
export function computeForwardChain(
    scenario: PlanScenario,
    startId: string,
    opts: ChainOptions
): ChainResult | null {
    const blocks = new Map(scenario.Blocks.map(b => [b.id, b]));
    const root = blocks.get(startId);
    if (!root) return null;

    const outgoing = new Map<string, PlanLink[]>();
    for (const l of scenario.Links) {
        const arr = outgoing.get(l.from) || [];
        arr.push(l);
        outgoing.set(l.from, arr);
    }

    const resolved = new Map<string, { startISO: string; endISO: string }>();
    resolved.set(startId, { startISO: root.startISO, endISO: root.endISO });

    const changes: ScheduleChange[] = [];
    const blockedByLock: ScheduleChange[] = [];
    const warnings: string[] = [];

    // Obilazak u širinu; svaki blok se pomjera na NAJKASNIJI zahtjev prethodnika
    const queue = [startId];
    const seen = new Set<string>([startId]);
    let guard = 0;

    while (queue.length && guard++ < 5000) {
        const cur = queue.shift()!;
        const curDates = resolved.get(cur)!;

        for (const link of outgoing.get(cur) || []) {
            const target = blocks.get(link.to);
            if (!target) continue;

            const lag = Math.max(0, link.lagDays || 0);
            const earliestStart = link.kind === 'delivery-to-start'
                ? addDays(curDates.endISO, lag)
                : addDays(curDates.endISO, lag + 1);

            const existing = resolved.get(link.to);
            // Ako više prethodnika gura isti blok, vrijedi NAJKASNIJI zahtjev
            const proposedStart = existing && existing.startISO > earliestStart
                ? existing.startISO
                : earliestStart;

            if (target.locked) {
                resolved.set(link.to, { startISO: target.startISO, endISO: target.endISO });
            } else if (proposedStart > target.startISO || (existing && proposedStart > existing.startISO)) {
                const end = target.kind === 'purchase' || !(target.workerDays || 0)
                    ? addDays(proposedStart, blockDurationDays(target) - 1)
                    : endFromWork(proposedStart, target.workerDays!, target.crew || 1, opts.isSaturdayWorking);
                resolved.set(link.to, { startISO: proposedStart, endISO: end });
            } else if (!existing) {
                resolved.set(link.to, { startISO: target.startISO, endISO: target.endISO });
            }

            if (!seen.has(link.to)) { seen.add(link.to); queue.push(link.to); }
            else queue.push(link.to);   // ponovo obiđi — zahtjev se mogao pojačati
        }
    }

    for (const [id, dates] of resolved) {
        if (id === startId) continue;
        const block = blocks.get(id)!;
        const deltaDays = diffDays(block.startISO, dates.startISO);
        if (deltaDays === 0 && dates.endISO === block.endISO) continue;

        const change: ScheduleChange = {
            id, title: block.title, kind: block.kind,
            fromStartISO: block.startISO, fromEndISO: block.endISO,
            startISO: dates.startISO, endISO: dates.endISO, deltaDays,
        };
        if (block.locked) blockedByLock.push(change);
        else changes.push(change);
    }

    changes.sort((a, b) => a.startISO.localeCompare(b.startISO));
    if (blockedByLock.length) {
        warnings.push(`${blockedByLock.length} zaključanih blokova blokira pomak.`);
    }

    return {
        anchorId: startId,
        anchorTitle: root.title,
        anchorISO: root.startISO,
        changes,
        blockedByLock,
        shortfallDays: 0,
        urgentOrders: [],
        warnings,
    };
}

/** Kandidati za sidro: fiksne obaveze — to je ono što klijent zadaje. */
export function anchorCandidates(scenario: PlanScenario): PlanBlock[] {
    return scenario.Blocks
        .filter(b => b.kind === 'montaza' || b.kind === 'milestone')
        .sort((a, b) => a.startISO.localeCompare(b.startISO));
}
