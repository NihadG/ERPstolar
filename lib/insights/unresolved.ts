// ════════════════════════════════════════════════════════════════════
// NERIJEŠENI NAZIVI — ulaz u petlju učenja.
//
// Neprepoznato se NIKAD ne odbacuje tiho. Skuplja se, broji i vraća korisniku
// („24× se javlja *lamperija* — koji je ovo tip?"). On potvrdi jednom, pravilo
// uđe u org_settings, i od tada radi deterministički sloj.
//
// AI-u se šalju SAMO ovi DISTINCT nazivi — ne 2000 naloga nego ~40 stringova.
// Zato je poziv jeftin i zato sistem s vremenom prestaje zvati AI.
// ════════════════════════════════════════════════════════════════════

import type { ProductionSnapshot } from '../types';

export interface UnresolvedEntry {
    name: string;
    count: number;
    examples: string[];   // do 3 naloga u kojima se javlja (za kontekst pri odluci)
}

export interface UnresolvedReport {
    names: UnresolvedEntry[];       // neprepoznate riječi iz naziva naloga/proizvoda
    materials: UnresolvedEntry[];   // neprepoznati nazivi materijala
    snapshotsScanned: number;
    skippedLegacy: number;
}

function collect(
    snapshots: ProductionSnapshot[],
    pick: (s: ProductionSnapshot) => string[] | undefined
): UnresolvedEntry[] {
    const acc = new Map<string, { count: number; examples: Set<string> }>();
    for (const s of snapshots) {
        for (const raw of pick(s) || []) {
            const name = (raw || '').trim();
            if (!name) continue;
            const e = acc.get(name) || { count: 0, examples: new Set<string>() };
            e.count++;
            const label = s.Work_Order_Name || s.Work_Order_Number;
            if (label && e.examples.size < 3) e.examples.add(label);
            acc.set(name, e);
        }
    }
    return Array.from(acc.entries())
        .map(([name, e]) => ({ name, count: e.count, examples: Array.from(e.examples) }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'hr'));
}

export function collectUnresolved(snapshots: ProductionSnapshot[]): UnresolvedReport {
    const v3 = snapshots.filter(s => (s.Snapshot_Version || 1) >= 3);
    return {
        names: collect(v3, s => s.Unmatched_Name_Tokens),
        materials: collect(v3, s => s.Unmatched_Materials),
        snapshotsScanned: v3.length,
        skippedLegacy: snapshots.length - v3.length,
    };
}
