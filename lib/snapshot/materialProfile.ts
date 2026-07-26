// ════════════════════════════════════════════════════════════════════
// PROFIL SASTAVNICE — šta materijali govore o proizvodu.
//
// POLAZIŠTE: sastavnica opisuje proizvod bolje od njegovog naziva.
// Stvaran primjer iz pogona — „ST15 Sprat/Biblioteka": iz naziva se ne izvlači
// NIŠTA (st15/sprat/biblioteka nisu tipovi). Iz sastavnice se izvlači sve:
// furnir + oblikovna špera + MDF = furnirani savijeni elementi (presa);
// 20 baglama = ~10 vrata; 3 vodilice = 3 ladice; nogice = stojeći element.
//
// TRI NIVOA ČITANJA, od najslabijeg ka najjačem:
//   1. PRISUTNOST  — koji tipovi postoje            (slabo: „ima masiva")
//   2. DOMINACIJA  — koliko trošak nosi koji tip    („70% je masiv" ≠ masivna lajsna)
//   3. POKRETAČI   — mjerljive količine rada        (16 m² furnira, 150 m kanta)
//
// Nivo 3 je ono što kalkulant stvarno koristi i jedino što radi za proizvod koji
// se prvi put pravi: ne treba ti „biblioteka" u istoriji, treba ti 16 m² furnira.
// ════════════════════════════════════════════════════════════════════

import { materialTypesFromName, MATERIAL_TYPES, type MaterialType } from '../productProcesses';
import type { WorkDrivers } from '../types';

// Schema tip živi u lib/types.ts (uz ostatak snapshota); re-eksport radi udobnosti.
export type { WorkDrivers };

export interface ProfileMaterialLite {
    Material_Name?: string;
    Quantity?: number;
    Unit?: string;
    Total_Price?: number;
    Supplier?: string;
}

export interface MaterialProfile {
    Types: string[];                        // 1. prisutnost
    Cost_By_Type: Record<string, number>;   // 2. dominacija (nije particija — vidi dolje)
    Drivers: WorkDrivers;                   // 3. pokretači rada
    Unmatched: string[];                    // neprepoznati nazivi (petlja učenja)
    Coverage: number | null;                // udio TROŠKA koji je klasifikovan ∈ [0,1]
    Service_Lines: { name: string; quantity: number; unit: string; total: number }[];
}

/** Interni dobavljači = usluga u sastavnici (npr. „Lakiranje", dobavljač „Interni"). */
const INTERNAL_SUPPLIERS = new Set(['interni', 'interno', 'vlastito', 'in-house']);

const norm = (s: string | undefined) => (s || '').trim().toLowerCase();

/** Jedinice: 'm2'/'m²'/'m^2' → površina, 'm'/'m1'/'metar' → dužina, ostalo → komad. */
type UnitFamily = 'area' | 'length' | 'count';
function unitFamily(unit: string | undefined): UnitFamily {
    const u = norm(unit).replace(/\s/g, '');
    if (['m2', 'm²', 'm^2', 'kvm'].includes(u)) return 'area';
    if (['m', 'm1', 'm¹', 'metar', 'met'].includes(u)) return 'length';
    return 'count';
}

/**
 * Tip materijala → (pokretač, očekivana jedinica).
 * Ako se jedinica ne poklapa, pokretač se NE puni — radije nemamo podatak
 * nego izmišljen broj (furnir prodan „na komad" nije m² furnira).
 */
const DRIVER_MAP: Record<string, { key: keyof WorkDrivers; family: UnitFamily }> = {
    kant: { key: 'edge_m', family: 'length' },
    furnir: { key: 'veneer_m2', family: 'area' },
    lak: { key: 'lacquer_m2', family: 'area' },
    staklo: { key: 'glass_m2', family: 'area' },
    ogledalo: { key: 'glass_m2', family: 'area' },
    iveral: { key: 'boards', family: 'count' },
    mdf: { key: 'boards', family: 'count' },
    sper: { key: 'boards', family: 'count' },
    hdf: { key: 'boards', family: 'count' },
    masiv: { key: 'boards', family: 'count' },
    sarke: { key: 'hinges', family: 'count' },
    vodilice: { key: 'slides', family: 'count' },
    rucke: { key: 'handles', family: 'count' },
    nogice: { key: 'legs', family: 'count' },
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * @param types  taksonomija materijala: ugrađena + KORISNIKOVA potvrđena pravila.
 *               Bez ovog parametra petlja učenja ne bi radila za materijale —
 *               a upravo materijali nose signal o složenosti posla.
 */
export function buildMaterialProfile(
    materials: ProfileMaterialLite[],
    types: MaterialType[] = MATERIAL_TYPES
): MaterialProfile {
    const costByType: Record<string, number> = {};
    const drivers: WorkDrivers = {};
    const unmatched: string[] = [];
    const seenUnmatched = new Set<string>();
    const serviceLines: MaterialProfile['Service_Lines'] = [];
    const typeSet = new Set<string>();

    let totalCost = 0;
    let typedCost = 0;

    for (const m of materials || []) {
        const name = (m.Material_Name || '').trim();
        const cost = m.Total_Price || 0;
        const qty = m.Quantity || 0;
        totalCost += cost;

        // Usluga u sastavnici (npr. lakiranje kod „Interni") — i dalje daje tip i
        // pokretač (16 m² lakiranja je stvarna količina rada), ali se bilježi zasebno
        // da se ne miješa s KUPLJENIM materijalom.
        if (INTERNAL_SUPPLIERS.has(norm(m.Supplier))) {
            serviceLines.push({ name, quantity: qty, unit: m.Unit || '', total: cost });
        }

        const matched = materialTypesFromName(name, types);
        if (matched.length === 0) {
            if (name && !seenUnmatched.has(name)) { seenUnmatched.add(name); unmatched.push(name); }
            continue;
        }

        typedCost += cost;
        const fam = unitFamily(m.Unit);

        for (const t of matched) {
            typeSet.add(t);
            // Materijal s više tipova doprinosi SVAKOM svom tipu → zbir može
            // premašiti ukupan trošak. Namjerno: ovo je jačina signala, ne particija.
            costByType[t] = r2((costByType[t] || 0) + cost);

            const d = DRIVER_MAP[t];
            if (d && qty > 0 && d.family === fam) {
                drivers[d.key] = r2((drivers[d.key] || 0) + qty);
            }
        }
    }

    return {
        Types: Array.from(typeSet),
        Cost_By_Type: costByType,
        Drivers: drivers,
        Unmatched: unmatched,
        Coverage: totalCost > 0 ? r2(typedCost / totalCost) : null,
        Service_Lines: serviceLines,
    };
}

/** Zbir profila više stavki — za nivo naloga. */
export function mergeMaterialProfiles(profiles: MaterialProfile[]): MaterialProfile {
    const out: MaterialProfile = {
        Types: [], Cost_By_Type: {}, Drivers: {}, Unmatched: [], Coverage: null, Service_Lines: [],
    };
    const types = new Set<string>();
    const unmatched = new Set<string>();
    let cov = 0, covN = 0;

    for (const p of profiles) {
        p.Types.forEach(t => types.add(t));
        p.Unmatched.forEach(u => unmatched.add(u));
        out.Service_Lines.push(...p.Service_Lines);
        for (const [k, v] of Object.entries(p.Cost_By_Type)) {
            out.Cost_By_Type[k] = r2((out.Cost_By_Type[k] || 0) + v);
        }
        for (const [k, v] of Object.entries(p.Drivers)) {
            const key = k as keyof WorkDrivers;
            if (typeof v === 'number') out.Drivers[key] = r2((out.Drivers[key] || 0) + v);
        }
        if (p.Coverage !== null) { cov += p.Coverage; covN++; }
    }

    out.Types = Array.from(types);
    out.Unmatched = Array.from(unmatched);
    out.Coverage = covN > 0 ? r2(cov / covN) : null;
    return out;
}
