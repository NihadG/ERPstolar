// ════════════════════════════════════════════════════════════════════
// PLATNO — EKIPA (kandidat za auto-raspored)
//
// Ekipa = glavni radnik + proizvoljno mnogo pomoćnika. Jedan majstor s dva-tri
// pomoćnika je normalan slučaj u radionici, a ne izuzetak.
//
// Isti radnik SMIJE biti u više kandidat-ekipa istog naloga: algoritam bira
// jednu, pa više kombinacija oko istog majstora znači više načina da se posao
// uklopi u kalendar. Ono što se sprječava je duplikat unutar JEDNE ekipe —
// to bi lažno povećalo njenu veličinu i prepolovilo izračunato trajanje.
// ════════════════════════════════════════════════════════════════════

import { v4 as uuidv4 } from 'uuid';
import { crewWorkerRefs, type PlanCrew, type PlanRef } from '../types';

const keyOf = (r: PlanRef) => r.id || `name:${r.name}`;

/** Nova ekipa. Pomoćnici se dedupliciraju i glavni se iz njih izbacuje. */
export function newCrew(lead: PlanRef, members: PlanRef[] = []): PlanCrew {
    const seen = new Set<string>([keyOf(lead)]);
    const clean: PlanRef[] = [];
    for (const m of members) {
        const k = keyOf(m);
        if (seen.has(k)) continue;
        seen.add(k);
        clean.push(m);
    }
    return { id: uuidv4(), lead, ...(clean.length ? { members: clean } : {}) };
}

/**
 * Potpis ekipe po SASTAVU (bez id-a), da se ista kombinacija ne doda dvaput.
 * Redoslijed pomoćnika ne mijenja ekipu, pa se sortira.
 */
export function crewSignature(crew: PlanCrew): string {
    const refs = crewWorkerRefs(crew);
    const lead = keyOf(refs[0]);
    const rest = refs.slice(1).map(keyOf).sort();
    return [lead, ...rest].join('|');
}

/** Ima li lista već ekipu istog sastava. */
export function hasSameCrew(list: PlanCrew[], crew: PlanCrew): boolean {
    const sig = crewSignature(crew);
    return list.some(c => crewSignature(c) === sig);
}

/**
 * U koliko je kandidat-ekipa dati radnik. Za prikaz „ovaj čovjek je u 3 grupe" —
 * to je dozvoljeno stanje i korisniku treba biti vidljivo, ne skriveno.
 */
export function crewCountForWorker(list: PlanCrew[], workerId: string): number {
    return list.filter(c => crewWorkerRefs(c).some(r => r.id === workerId)).length;
}
