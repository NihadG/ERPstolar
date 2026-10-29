// ════════════════════════════════════════════════════════════════════
// RJEČNIK PROCESA — kako korisnik zove procese (čisto)
//
// Jedno mjesto koje spaja riječi iz četiri izvora u parove „fraza → proces":
//   • standard (STANDARD_ALIASES — „montaža iverala" = Sklapanje kutija),
//   • katalog (ProcessCatalogItem.Aliases — korisnik upiše u Procesi → ⚙),
//   • čvorovi grafa (ProcessNode.aliases — nazivi spojeni u jedan čvor),
//   • naučene riječi bota (assistant_vocab, vrsta 'process').
// Koriste ga matcher procesa (lib/workDiary.ts) i bot. jest: processVocabulary.test.ts
// ════════════════════════════════════════════════════════════════════

import { foldText } from './voice/text';
import { STANDARD_ALIASES } from './processStandard';
import type { ProcessGraph } from './types';

export interface ProcessAlias { phrase: string; process: string }

const key = (s: string) => foldText(s).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

export function standardAliases(): ProcessAlias[] {
    return Object.entries(STANDARD_ALIASES).flatMap(([process, phrases]) => phrases.map(phrase => ({ phrase, process })));
}

export function catalogAliases(catalog: { Name: string; Aliases?: string[] }[]): ProcessAlias[] {
    return catalog.flatMap(c => (c.Aliases || []).filter(a => a && a.trim()).map(phrase => ({ phrase, process: c.Name })));
}

/** Nazivi spojeni u čvor (osim njegovog imena) vode na taj čvor. */
export function graphAliases(graphs: (ProcessGraph | undefined)[]): ProcessAlias[] {
    return graphs.flatMap(g => (g?.nodes || []).flatMap(n =>
        (n.aliases || []).filter(a => a && key(a) !== key(n.name)).map(phrase => ({ phrase, process: n.name }))));
}

export function learnedAliases(entries: { Kind: string; Phrase: string; Target_Label: string }[]): ProcessAlias[] {
    return entries.filter(e => e.Kind === 'process' && e.Phrase && e.Target_Label).map(e => ({ phrase: e.Phrase, process: e.Target_Label }));
}

/** Spaja liste; isti par (fraza, proces) samo jednom. */
export function mergeAliases(...lists: ProcessAlias[][]): ProcessAlias[] {
    const seen = new Set<string>();
    const out: ProcessAlias[] = [];
    for (const a of lists.flat()) {
        const k = `${key(a.phrase)}|${key(a.process)}`;
        if (!key(a.phrase) || seen.has(k)) continue;
        seen.add(k);
        out.push(a);
    }
    return out;
}
