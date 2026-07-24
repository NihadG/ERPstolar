// Krojenje ploča — javni API modula.
export * from './types';
export { packGroup, packGroups, type PackGroupOptions } from './optimizer';
export {
    parseCutlistText, parseEuroNumber, normalizeMaterialKey, groupKeysInOrder,
    type ParseCutlistResult,
} from './parse';
export {
    suggestMaterials, matchMaterialLabels, materialSimilarity,
    type MaterialMatch, type MaterialSuggestion,
} from './match';
