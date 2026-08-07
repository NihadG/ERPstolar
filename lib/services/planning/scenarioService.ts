/**
 * scenarioService.ts — CRUD za planerske scenarije (Platno).
 *
 * IZOLACIJA: ovaj servis piše isključivo u `planning_scenarios`. Nijedna funkcija ovdje
 * ne dira naloge, narudžbe, statuse ni bilo šta drugo. (Svjesnu pretvorbu plana u stvarni
 * nalog/narudžbu radi zaseban promotionService — nikad autosave.)
 *
 * Obrazac preuzet iz lib/services/resource/supplierService.ts
 * (queryByOrg / findRef / createDoc / updateDocByRef), uz dodatak optimističke
 * kontrole verzije — scenarij je jedan veliki dokument koji se često prepisuje,
 * pa dva otvorena taba inače tiho pregaze jedan drugog.
 */

import { COLLECTIONS } from '../shared/collections';
import { queryByOrg, findByIdAndOrg, findRef, createDoc, updateDocByRef, deepStripUndefined } from '../shared/firestoreClient';
import { v4 as uuidv4 } from 'uuid';
import type { PlanScenario } from '../../types';
import { MAX_BLOCKS_PER_SCENARIO, emptyScenario } from '../../canvas/model';

export interface SaveScenarioResult {
    success: boolean;
    data?: { Scenario_ID: string; Version: number };
    message: string;
    /** true kad je neko drugi u međuvremenu snimio — pozivalac nudi „učitaj ponovo" / „prepiši". */
    conflict?: boolean;
}

// ============================================
// READ
// ============================================

export async function getScenarios(organizationId: string): Promise<PlanScenario[]> {
    const all = await queryByOrg<PlanScenario>(COLLECTIONS.PLANNING_SCENARIOS, organizationId);
    return all
        .filter(s => !s.Is_Archived)
        .sort((a, b) => (b.Modified_Date || '').localeCompare(a.Modified_Date || ''));
}

export async function getScenario(
    scenarioId: string,
    organizationId: string
): Promise<PlanScenario | null> {
    const { data } = await findByIdAndOrg<PlanScenario>(
        COLLECTIONS.PLANNING_SCENARIOS, 'Scenario_ID', scenarioId, organizationId
    );
    return data;
}

// ============================================
// WRITE
// ============================================

export async function createScenario(
    name: string,
    organizationId: string,
    seed?: Partial<PlanScenario>
): Promise<SaveScenarioResult> {
    if (!organizationId) return { success: false, message: 'Organization ID is required' };

    try {
        const scenario: PlanScenario = {
            ...emptyScenario(organizationId, name),
            ...seed,
            Scenario_ID: uuidv4(),
            Organization_ID: organizationId,
            Name: name.trim() || 'Novi scenarij',
            Created_Date: new Date().toISOString(),
            Modified_Date: new Date().toISOString(),
            Version: 1,
        };
        await createDoc(COLLECTIONS.PLANNING_SCENARIOS, deepStripUndefined(scenario) as unknown as Record<string, unknown>);
        return {
            success: true,
            data: { Scenario_ID: scenario.Scenario_ID, Version: 1 },
            message: 'Scenarij kreiran',
        };
    } catch (error) {
        console.error('createScenario error:', error);
        return { success: false, message: 'Greška pri kreiranju scenarija' };
    }
}

/**
 * Spremi scenarij.
 *
 * `expectedVersion` je verzija koju pozivalac misli da ima. Ako se u bazi razlikuje,
 * NE piše ništa i vraća `conflict: true` — bolje pitati korisnika nego tiho izgubiti
 * tuđi rad. `force: true` svjesno pregazi (korisnik je izabrao „prepiši").
 */
export async function saveScenario(
    scenario: PlanScenario,
    organizationId: string,
    options?: { expectedVersion?: number; force?: boolean }
): Promise<SaveScenarioResult> {
    if (!organizationId) return { success: false, message: 'Organization ID is required' };
    if (!scenario?.Scenario_ID) return { success: false, message: 'Scenario_ID nedostaje' };

    // Granica veličine: Firestore dokument ide do 1 MiB. Radije jasna poruka nego
    // odbijen upis usred rada.
    if ((scenario.Blocks?.length || 0) > MAX_BLOCKS_PER_SCENARIO) {
        return {
            success: false,
            message: `Scenarij ima više od ${MAX_BLOCKS_PER_SCENARIO} blokova — podijeli ga na dva.`,
        };
    }

    try {
        const { data: current, ref } = await findByIdAndOrg<PlanScenario>(
            COLLECTIONS.PLANNING_SCENARIOS, 'Scenario_ID', scenario.Scenario_ID, organizationId
        );
        if (!ref || !current) return { success: false, message: 'Scenarij nije pronađen' };

        const expected = options?.expectedVersion;
        if (!options?.force && expected !== undefined && (current.Version || 0) !== expected) {
            return {
                success: false,
                conflict: true,
                data: { Scenario_ID: scenario.Scenario_ID, Version: current.Version || 0 },
                message: 'Scenarij je u međuvremenu promijenjen na drugom mjestu.',
            };
        }

        const nextVersion = (current.Version || 0) + 1;
        // Organization_ID i Created_Date se NIKAD ne prepisuju iz klijenta.
        const { Organization_ID: _org, Created_Date: _created, ...rest } = scenario;
        // Duboko čišćenje: blok može nositi ugniježđeni `undefined` (npr. supplierRef.id
        // kad dobavljač nije prepoznat) — Firestore to odbija bilo gdje u stablu.
        await updateDocByRef(ref, deepStripUndefined({
            ...rest,
            Modified_Date: new Date().toISOString(),
            Version: nextVersion,
        }) as Record<string, unknown>);

        return {
            success: true,
            data: { Scenario_ID: scenario.Scenario_ID, Version: nextVersion },
            message: 'Spremljeno',
        };
    } catch (error) {
        console.error('saveScenario error:', error);
        return { success: false, message: 'Greška pri spremanju scenarija' };
    }
}

/** Kopija scenarija — osnova za „šta ako" poređenje. */
export async function duplicateScenario(
    scenarioId: string,
    organizationId: string,
    newName?: string
): Promise<SaveScenarioResult> {
    const src = await getScenario(scenarioId, organizationId);
    if (!src) return { success: false, message: 'Scenarij nije pronađen' };

    return createScenario(newName || `${src.Name} (kopija)`, organizationId, {
        Description: src.Description,
        Blocks: src.Blocks,
        Links: src.Links,
        View: src.View,
    });
}

export async function renameScenario(
    scenarioId: string, name: string, organizationId: string
): Promise<{ success: boolean; message: string }> {
    try {
        const ref = await findRef(COLLECTIONS.PLANNING_SCENARIOS, 'Scenario_ID', scenarioId, organizationId);
        if (!ref) return { success: false, message: 'Scenarij nije pronađen' };
        await updateDocByRef(ref, { Name: name.trim() || 'Bez naziva', Modified_Date: new Date().toISOString() });
        return { success: true, message: 'Preimenovano' };
    } catch (error) {
        console.error('renameScenario error:', error);
        return { success: false, message: 'Greška pri preimenovanju' };
    }
}

/** Arhiviranje umjesto brisanja — plan je istorija odluke, ne smeće. */
export async function archiveScenario(
    scenarioId: string, organizationId: string
): Promise<{ success: boolean; message: string }> {
    try {
        const ref = await findRef(COLLECTIONS.PLANNING_SCENARIOS, 'Scenario_ID', scenarioId, organizationId);
        if (!ref) return { success: false, message: 'Scenarij nije pronađen' };
        await updateDocByRef(ref, { Is_Archived: true, Modified_Date: new Date().toISOString() });
        return { success: true, message: 'Scenarij arhiviran' };
    } catch (error) {
        console.error('archiveScenario error:', error);
        return { success: false, message: 'Greška pri arhiviranju' };
    }
}

export async function deleteScenario(
    scenarioId: string, organizationId: string
): Promise<{ success: boolean; message: string }> {
    try {
        const ref = await findRef(COLLECTIONS.PLANNING_SCENARIOS, 'Scenario_ID', scenarioId, organizationId);
        if (ref) {
            const { deleteDoc } = await import('firebase/firestore');
            await deleteDoc(ref);
        }
        return { success: true, message: 'Scenarij obrisan' };
    } catch (error) {
        console.error('deleteScenario error:', error);
        return { success: false, message: 'Greška pri brisanju scenarija' };
    }
}
