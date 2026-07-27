// ════════════════════════════════════════════════════════════════════
// PLATNO — PRIJEDLOG TRAJANJA IZ ISTORIJE
//
// Kad proizvod nema planirane dane u ponudi, umjesto da korisnik nagađa
// (ili platno tiho stavi 0), ponudi se ono što je ista vrsta posla stvarno
// trajala u prošlosti — preko `findComparable` iz sloja profila.
//
// Ovo je opis prošlosti koji ČOVJEK primjenjuje jednim klikom, ne automatika:
// vraća se `null` čim uzorak nije dovoljno jak, i nikad se ne primjenjuje samo.
// ════════════════════════════════════════════════════════════════════

import type { ProductionSnapshot } from '../types';
import { findComparable, describeComparable, type ComparableResult } from '../insights/comparable';
import type { ProductCandidate } from './fromProducts';

export interface DurationSuggestion {
    /** Zaokruženi medijan — spremno za primjenu na blok. */
    workerDaysPerUnit: number;
    /** Rečenica za prikaz (n=X, raspon...), ista logika kao svugdje u profilima. */
    description: string;
    result: ComparableResult;
}

/**
 * Prijedlog radnik-dana po komadu za proizvod bez plana u ponudi.
 *
 * `findComparable` namjerno popušta uslove sve do praznog upita prije nego
 * javi „nema pogotka" (ljestvica poštenja — dobra osobina kad korisnik SAM
 * bira i vidi šta je popušteno). Ovdje se prijedlog primjenjuje JEDNIM KLIKOM
 * bez tog konteksta, pa je pravilo strože: čim se izgubi baš onaj signal koji
 * je zatražen (tip proizvoda, ili materijal kad tipa nema), vraća se `null`
 * umjesto broja iz suštinski nepovezanog posla.
 */
export function suggestDurationForCandidate(
    candidate: Pick<ProductCandidate, 'productTypes' | 'materialTypes'>,
    snapshots: ProductionSnapshot[]
): DurationSuggestion | null {
    const hasProductTypes = candidate.productTypes.length > 0;
    const hasMaterialTypes = candidate.materialTypes.length > 0;
    if (!hasProductTypes && !hasMaterialTypes) return null;

    const result = findComparable(snapshots, {
        productTypes: hasProductTypes ? candidate.productTypes : undefined,
        materialTypes: hasMaterialTypes ? candidate.materialTypes : undefined,
    });

    if (result.confidence === 'none' || !result.workerDaysPerUnit) return null;

    // Najjači zatraženi signal se izgubio → ovo više nije "sličan posao", nego
    // prosjek preko cijele istorije. Ne primjenjuje se jednim klikom.
    const lostStrongestSignal = hasProductTypes
        ? result.relaxed.includes('tip proizvoda')
        : result.relaxed.includes('materijali');
    if (lostStrongestSignal) return null;

    return {
        workerDaysPerUnit: Math.round(result.workerDaysPerUnit.p50 * 100) / 100,
        description: describeComparable(result),
        result,
    };
}
