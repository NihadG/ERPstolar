// ════════════════════════════════════════════════════════════════════
// PROFIL TIPA PROIZVODA — koliko koji tip stvarno traje.
//
// JEDINICA POSMATRANJA je STAVKA (proizvod), normalizovana PO KOMADU
// (Actual_Labor_Days / Quantity). Komoda ×3 traje ~3× komoda ×1, pa bi bez
// normalizacije količina zagušila tip.
//
// Izlaz je RASPON (p25/p50/p75), ne prosjek — jedan katastrofalan nalog pomjeri
// prosjek, medijan ne. Uz svaki raspon ide `n` i `predictability` (CV): ako je
// rasipanje veliko, raspon je širok i to se mora vidjeti, a ne sakriti iza medijane.
// ════════════════════════════════════════════════════════════════════

import type { ProductionSnapshot, ProductionSnapshotItem, WorkDrivers } from '../types';
import { distribution, coefficientOfVariation, sharePct, round2, type Dist } from './stats';

export interface ProcessStat { name: string; workerDays: Dist | null }

export interface TypeProfile {
    type: string;
    /** Broj STAVKI u uzorku (ne naloga — jedan nalog zna imati više komoda). */
    n: number;
    orders: number;
    /** Radnik-dani PO KOMADU — glavna mjera trajanja. */
    workerDaysPerUnit: Dist | null;
    /** Stvarno/planirano. >1 = duže od plana. */
    plannedVsActual: Dist | null;
    materialCostPerUnit: Dist | null;
    /** Medijane pokretača rada po komadu (m² furnira, m kanta, broj baglama...). */
    driversPerUnit: Partial<Record<keyof WorkDrivers, Dist>>;
    topProcesses: ProcessStat[];
    topMaterialTypes: { type: string; sharePct: number }[];
    /**
     * Koeficijent varijacije trajanja. NIŽE = predvidivije.
     * Ovo je jedini broj koji kaže da li procjena UOPŠTE može biti precizna —
     * s velikim rasipanjem ni hiljadu naloga ne daje uzak raspon.
     */
    predictability: number | null;
}

const DRIVER_KEYS: (keyof WorkDrivers)[] = [
    'edge_m', 'veneer_m2', 'lacquer_m2', 'glass_m2', 'boards', 'hinges', 'slides', 'handles', 'legs',
];

interface Acc {
    items: ProductionSnapshotItem[];
    orders: Set<string>;
    daysPerUnit: number[];
    pva: number[];
    matPerUnit: number[];
    drivers: Map<keyof WorkDrivers, number[]>;
    processDays: Map<string, number[]>;
    materialCost: Map<string, number>;
    materialCostTotal: number;
}

function newAcc(): Acc {
    return {
        items: [], orders: new Set(), daysPerUnit: [], pva: [], matPerUnit: [],
        drivers: new Map(), processDays: new Map(),
        materialCost: new Map(), materialCostTotal: 0,
    };
}

/**
 * Profili po tipu proizvoda. Samo v3 snapshoti (v2 nema ispravne radnik-dane
 * ni tipove) — broj preskočenih se vraća da se ne pravi tiha rupa u uzorku.
 */
export function buildTypeProfiles(snapshots: ProductionSnapshot[]): {
    profiles: TypeProfile[];
    skippedLegacy: number;
} {
    const byType = new Map<string, Acc>();
    let skippedLegacy = 0;

    for (const snap of snapshots) {
        if ((snap.Snapshot_Version || 1) < 3) { skippedLegacy++; continue; }

        for (const item of snap.Items || []) {
            const qty = item.Quantity > 0 ? item.Quantity : 1;
            // „Zadaci" nalozi: proizvod nema tip, ali ga naziv naloga ima
            const types = item.Product_Types?.length ? item.Product_Types : (snap.Name_Derived_Types || []);
            if (types.length === 0) continue;

            for (const t of types) {
                const acc = byType.get(t) || newAcc();
                byType.set(t, acc);

                acc.items.push(item);
                acc.orders.add(snap.Work_Order_ID);

                const actual = item.Actual_Labor_Days || 0;
                if (actual > 0) acc.daysPerUnit.push(actual / qty);

                const planned = item.Planned_Worker_Days || 0;
                if (planned > 0 && actual > 0) acc.pva.push(actual / planned);

                if (item.Material_Per_Unit > 0) acc.matPerUnit.push(item.Material_Per_Unit);

                for (const k of DRIVER_KEYS) {
                    const v = item.Work_Drivers?.[k];
                    if (typeof v === 'number' && v > 0) {
                        const arr = acc.drivers.get(k) || [];
                        arr.push(v / qty);
                        acc.drivers.set(k, arr);
                    }
                }

                for (const p of item.Processes || []) {
                    if (!p.Process_Name || !(p.Duration_Days > 0)) continue;
                    const arr = acc.processDays.get(p.Process_Name) || [];
                    arr.push(p.Duration_Days / qty);
                    acc.processDays.set(p.Process_Name, arr);
                }

                for (const [mt, cost] of Object.entries(item.Material_Cost_By_Type || {})) {
                    acc.materialCost.set(mt, (acc.materialCost.get(mt) || 0) + cost);
                    acc.materialCostTotal += cost;
                }
            }
        }
    }

    const profiles: TypeProfile[] = Array.from(byType.entries()).map(([type, a]) => {
        const driversPerUnit: Partial<Record<keyof WorkDrivers, Dist>> = {};
        for (const [k, arr] of a.drivers.entries()) {
            const d = distribution(arr);
            if (d) driversPerUnit[k] = d;
        }

        return {
            type,
            n: a.items.length,
            orders: a.orders.size,
            workerDaysPerUnit: distribution(a.daysPerUnit),
            plannedVsActual: distribution(a.pva),
            materialCostPerUnit: distribution(a.matPerUnit),
            driversPerUnit,
            topProcesses: Array.from(a.processDays.entries())
                .map(([name, arr]) => ({ name, workerDays: distribution(arr) }))
                .sort((x, y) => (y.workerDays?.p50 ?? 0) - (x.workerDays?.p50 ?? 0)
                    || x.name.localeCompare(y.name, 'hr')),
            topMaterialTypes: Array.from(a.materialCost.entries())
                .map(([t, cost]) => ({ type: t, sharePct: sharePct(cost, a.materialCostTotal) }))
                .sort((x, y) => y.sharePct - x.sharePct || x.type.localeCompare(y.type, 'hr')),
            predictability: coefficientOfVariation(a.daysPerUnit),
        };
    });

    profiles.sort((a, b) => b.n - a.n || a.type.localeCompare(b.type, 'hr'));
    return { profiles, skippedLegacy };
}

/**
 * Trajanje po jedinici pokretača rada, preko SVIH tipova
 * („koliko radnik-dana ide na m² furnira", „na 100 m kanta").
 *
 * Ovo je ono što radi za proizvod koji se PRVI PUT pravi: ne treba istorija
 * „biblioteka", treba cijena rada po m² furnira — a to je rađeno hiljadu puta.
 * Gruba mjera (dijeli UKUPNE dane stavke jednim pokretačem), pa je uvijek uz `n`.
 */
export function driverRates(snapshots: ProductionSnapshot[]): {
    driver: keyof WorkDrivers;
    workerDaysPerUnit: Dist;
}[] {
    const byDriver = new Map<keyof WorkDrivers, number[]>();

    for (const snap of snapshots) {
        if ((snap.Snapshot_Version || 1) < 3) continue;
        for (const item of snap.Items || []) {
            const actual = item.Actual_Labor_Days || 0;
            if (actual <= 0 || !item.Work_Drivers) continue;
            for (const k of DRIVER_KEYS) {
                const v = item.Work_Drivers[k];
                if (typeof v === 'number' && v > 0) {
                    const arr = byDriver.get(k) || [];
                    arr.push(actual / v);
                    byDriver.set(k, arr);
                }
            }
        }
    }

    return Array.from(byDriver.entries())
        .map(([driver, arr]) => ({ driver, workerDaysPerUnit: distribution(arr)! }))
        .filter(x => x.workerDaysPerUnit)
        .sort((a, b) => b.workerDaysPerUnit.n - a.workerDaysPerUnit.n);
}

export { round2 };
