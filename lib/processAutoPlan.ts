// ════════════════════════════════════════════════════════════════════
// AUTO-PLAN PROCESA — čista logika (bez Firebase), pokrivena testovima.
//
// Cilj: definisanje plana procesa gotovo besplatno. Iz materijala proizvoda
// (preko korisnikovih pravila + izvedenih TIPOVA materijala) predloži skup
// procesa, pa ih rasporedi na FAZE odabranog šablona (kombinacija tipova bira
// šablon). Fallback: sekvencijalno po katalogu. AI odgovor se validira ovdje.
//
// jest: lib/__tests__/processAutoPlan.test.ts
// ════════════════════════════════════════════════════════════════════

import type { ProcessCatalogItem, ProcessMaterialRule, ProcessStageTemplate } from './types';
import {
    suggestProcessesFromMaterials, presentMaterialTypes, orderByCatalog,
    type RuleMaterialLite,
} from './productProcesses';

const norm = (s: string) => (s || '').trim().toLowerCase();

// Re-export tipova materijala radi jednog import mjesta za potrošače auto-plana.
export { MATERIAL_TYPES, materialTypeFromName, presentMaterialTypes, type MaterialType } from './productProcesses';

// ════════════════════════════════════════════════════════════════════
// PREDLOŽENA PRAVILA (seeding) — iz stvarnog vokabulara materijala korisnika.
// material_type = jedan tip prisutan; combo = SVI tipovi prisutni (procesi koji
// nastaju TEK iz kombinacije, npr. furnir+mdf → srezivanje elemenata iz prese).
// Procesi moraju odgovarati kanonskim nazivima iz kataloga (seeding UI upozorava
// ako naziv ne postoji u katalogu). Prazan skup procesa = korisnik popunjava.
// ════════════════════════════════════════════════════════════════════
export interface SuggestedRule {
    Match_Kind: 'material_type' | 'material_type_combo';
    Match_Value: string;      // za material_type
    Match_Types?: string[];   // za material_type_combo
    Processes: string[];
    note?: string;            // pojašnjenje za UI
}
export const SUGGESTED_RULES: SuggestedRule[] = [
    { Match_Kind: 'material_type', Match_Value: 'iveral', Processes: ['Krojenje Iverala', 'Kantiranje', 'Krojenje leđa', 'Sklapanje kutija'] },
    { Match_Kind: 'material_type', Match_Value: 'mdf', Processes: ['Krojenje MDF-a'] },
    { Match_Kind: 'material_type', Match_Value: 'furnir', Processes: ['Krojenje furnira', 'Brušenje furniranih elemenata', 'Sklapanje furniranih elemenata'] },
    { Match_Kind: 'material_type', Match_Value: 'masiv', Processes: ['Priprema masive', 'Lijepljenje i obrada masive'] },
    { Match_Kind: 'material_type', Match_Value: 'lak', Processes: ['Farbanje i lakiranje'] },
    { Match_Kind: 'material_type', Match_Value: 'vodilice', Processes: ['Okivanje ladica'] },
    { Match_Kind: 'material_type', Match_Value: 'sarke', Processes: ['Okivanje vrata i fronti'] },
    { Match_Kind: 'material_type', Match_Value: 'rucke', Processes: ['Okivanje vrata i fronti'] },
    // KOMBINACIJA: furnir na MDF → nakon presovanja ide srezivanje na tačnu mjeru
    { Match_Kind: 'material_type_combo', Match_Value: '', Match_Types: ['furnir', 'mdf'], Processes: ['Srezivanje elemenata iz prese na tačne mjere'], note: 'Furnir + MDF (presovanje → srezivanje)' },
    // Tipovi bez očiglednog procesa — korisnik popunjava u seeding pregledu:
    { Match_Kind: 'material_type', Match_Value: 'staklo', Processes: [], note: 'Dodaj proces za staklo (npr. ugradnja stakla)' },
    { Match_Kind: 'material_type', Match_Value: 'ogledalo', Processes: [], note: 'Dodaj proces za ogledalo' },
    { Match_Kind: 'material_type', Match_Value: 'led', Processes: [], note: 'Dodaj proces za LED (npr. montaža rasvjete)' },
];

// ════════════════════════════════════════════════════════════════════
// IZBOR ŠABLONA po kombinaciji tipova materijala.
// Najveći presjek (koliko tipova šablona je prisutno); tie-break: manje viška
// tipova šablona koji NISU prisutni. Bez pozitivnog presjeka → null.
// ════════════════════════════════════════════════════════════════════
export function pickTemplateForTypes<T extends { Material_Types?: string[] }>(
    templates: T[],
    presentTypes: string[]
): T | null {
    const present = new Set(presentTypes);
    let best: T | null = null;
    let bestOverlap = 0;
    let bestExcess = Number.MAX_SAFE_INTEGER;
    for (const t of templates || []) {
        const types = (t.Material_Types || []).filter(Boolean);
        if (types.length === 0) continue;
        const overlap = types.filter(x => present.has(x)).length;
        if (overlap === 0) continue;
        const excess = types.length - overlap;
        if (overlap > bestOverlap || (overlap === bestOverlap && excess < bestExcess)) {
            best = t; bestOverlap = overlap; bestExcess = excess;
        }
    }
    return best;
}

// ════════════════════════════════════════════════════════════════════
// BUILD AUTO-PLAN
// ════════════════════════════════════════════════════════════════════
export interface AutoPlanResult {
    stages: string[][];
    source: 'rules' | 'none';
    appendedOutsideTemplate: string[];   // predloženi procesi kojih nema u šablonu (dodati na kraj)
    templateName?: string;               // šablon koji je iskorišten (ako ijedan)
}

/**
 * Predloži fazni plan procesa za proizvod iz materijala:
 * 1) skup procesa = suggestProcessesFromMaterials (pravila + tipovi + kombinacije)
 * 2) izbor šablona po kombinaciji tipova (pickTemplateForTypes) → mapiraj skup na FAZE šablona
 *    (zadrži samo predložene procese po fazi; prazne faze ispusti; predloženi van šablona →
 *     append kao trailing faza po katalog-redoslijedu)
 * 3) bez šablona → sekvencijalno (svaki proces = svoja faza, katalog redoslijed)
 * Prazan skup → {stages:[], source:'none'}.
 */
export function buildAutoPlan(
    materials: RuleMaterialLite[],
    rules: Pick<ProcessMaterialRule, 'Match_Kind' | 'Match_Value' | 'Match_Types' | 'Processes'>[],
    catalog: Pick<ProcessCatalogItem, 'Name' | 'Order'>[],
    templates: Pick<ProcessStageTemplate, 'Name' | 'Stages' | 'Material_Types'>[] = []
): AutoPlanResult {
    const suggested = suggestProcessesFromMaterials(materials, rules, catalog);
    if (suggested.length === 0) return { stages: [], source: 'none', appendedOutsideTemplate: [] };

    const suggestedKeys = new Set(suggested.map(norm));
    const template = pickTemplateForTypes(templates, presentMaterialTypes(materials));

    if (!template) {
        // Sekvencijalno po katalogu (suggested je već orderByCatalog'd u suggestProcessesFromMaterials).
        return { stages: suggested.map(p => [p]), source: 'rules', appendedOutsideTemplate: [] };
    }

    // Mapiraj skup predloženih na faze šablona (zadrži poredak faza; ispusti prazne).
    const usedKeys = new Set<string>();
    const stages: string[][] = [];
    for (const stage of template.Stages || []) {
        const kept = (stage.processes || []).filter(p => {
            const k = norm(p);
            if (suggestedKeys.has(k) && !usedKeys.has(k)) { usedKeys.add(k); return true; }
            return false;
        });
        if (kept.length > 0) stages.push(kept);
    }
    // Predloženi procesi kojih nema u šablonu → append po katalog-redoslijedu, svaki svoja faza.
    const leftovers = orderByCatalog(suggested.filter(p => !usedKeys.has(norm(p))), catalog);
    for (const p of leftovers) stages.push([p]);

    return {
        stages,
        source: 'rules',
        appendedOutsideTemplate: leftovers,
        templateName: template.Name,
    };
}

// ════════════════════════════════════════════════════════════════════
// VALIDACIJA AI ODGOVORA — mapiraj na kanonska imena kataloga, izbaci
// halucinacije/prazne faze. Dijele ga API ruta (server) i UI (preview).
// ════════════════════════════════════════════════════════════════════
export function validateAiStages(
    raw: unknown,
    catalog: Pick<ProcessCatalogItem, 'Name'>[]
): string[][] {
    if (!Array.isArray(raw)) return [];
    const canonical = new Map<string, string>(catalog.map(c => [norm(c.Name), c.Name]));
    const out: string[][] = [];
    const usedKeys = new Set<string>();
    for (const stage of raw) {
        if (!Array.isArray(stage)) continue;
        const kept: string[] = [];
        for (const p of stage) {
            if (typeof p !== 'string') continue;
            const name = canonical.get(norm(p));   // samo procesi iz kataloga (odbaci halucinacije)
            if (name && !usedKeys.has(norm(name))) { usedKeys.add(norm(name)); kept.push(name); }
        }
        if (kept.length > 0) out.push(kept);
    }
    return out;
}
