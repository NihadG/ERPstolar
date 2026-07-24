// ════════════════════════════════════════════════════════════════════
// PREPOZNAVANJE MATERIJALA IZ KROJNE LISTE
//
// Sirovi naziv iz dokumenta ("egger u999 crni 18") se sparuje s
// katalogom materijala organizacije. Prvo LOKALNO fuzzy sparivanje
// (bez API poziva): normalizovani tokeni + Dice koeficijent s bonusima
// za brojeve (dekor kod, debljina) i kategoriju "Ploče i trake".
// AI (Gemini) je fallback u lib/cutlist/ai.ts — poziva se na zahtjev.
// ════════════════════════════════════════════════════════════════════

import type { Material } from '../types';
import { normalizeMaterialKey } from './parse';

export interface MaterialSuggestion {
    material: Material;
    /** 0–1: pouzdanost sparivanja. */
    score: number;
}

export interface MaterialMatch {
    /** Sirovi naziv grupe iz dokumenta. */
    label: string;
    suggestions: MaterialSuggestion[];
    /** Najbolji prijedlog ako je dovoljno pouzdan da se sam predodabere. */
    autoMatch: Material | null;
}

/** Prag za automatski predodabir najboljeg prijedloga. */
const AUTO_MATCH_THRESHOLD = 0.62;
/** Ispod ovoga se prijedlog uopšte ne prikazuje. */
const SUGGESTION_FLOOR = 0.25;

interface TokenInfo {
    token: string;
    weight: number;
    isNumber: boolean;
}

function tokenize(s: string): TokenInfo[] {
    return normalizeMaterialKey(s)
        .split(' ')
        .filter(Boolean)
        .map(token => ({
            token,
            isNumber: /^\d+$/.test(token),
            // Brojevi (dekor kod, debljina) nose više informacije od kratkih riječi.
            weight: /^\d+$/.test(token) ? 1.2 : token.length >= 4 ? 1 : 0.5,
        }));
}

/** Sličnost dva naziva materijala: ponderisani Dice preko tokena. */
export function materialSimilarity(rawLabel: string, materialName: string): number {
    const a = tokenize(rawLabel);
    const b = tokenize(materialName);
    if (a.length === 0 || b.length === 0) return 0;

    const normA = normalizeMaterialKey(rawLabel);
    const normB = normalizeMaterialKey(materialName);
    if (normA === normB) return 1;

    let inter = 0;
    const usedB = new Set<number>();
    for (const ta of a) {
        let bestIdx = -1;
        let bestVal = 0;
        for (let i = 0; i < b.length; i++) {
            if (usedB.has(i)) continue;
            const tb = b[i];
            let val = 0;
            if (ta.token === tb.token) {
                val = Math.min(ta.weight, tb.weight);
            } else if (!ta.isNumber && !tb.isNumber && ta.token.length >= 4 && tb.token.length >= 4
                && (ta.token.startsWith(tb.token) || tb.token.startsWith(ta.token))) {
                // Djelimično poklapanje korijena riječi ("iveral"/"iverali").
                val = Math.min(ta.weight, tb.weight) * 0.7;
            }
            if (val > bestVal) { bestVal = val; bestIdx = i; }
        }
        if (bestIdx >= 0) { inter += bestVal; usedB.add(bestIdx); }
    }

    const sumA = a.reduce((s, t) => s + t.weight, 0);
    const sumB = b.reduce((s, t) => s + t.weight, 0);
    let score = (2 * inter) / (sumA + sumB);

    // Sadržavanje cijelog naziva ("u999" u "Egger U999 ST9 crna").
    if (score > 0 && (normB.includes(normA) || normA.includes(normB))) {
        score = Math.min(1, score + 0.15);
    }
    return score;
}

/**
 * Rangiraj katalog prema sličnosti sa sirovim nazivom. Materijali
 * kategorije "Ploče i trake" imaju blagu prednost (krojenje = ploče),
 * staklo i alu vrata se preskaču (imaju svoje tokove).
 */
export function suggestMaterials(rawLabel: string, catalog: Material[], limit = 6): MaterialSuggestion[] {
    const results: MaterialSuggestion[] = [];
    for (const mat of catalog) {
        if (mat.Is_Glass || mat.Category === 'Staklo') continue;
        if (mat.Is_Alu_Door || mat.Category === 'Alu vrata') continue;
        let score = materialSimilarity(rawLabel, mat.Name);
        if (score <= 0) continue;
        if (mat.Category === 'Ploče i trake') score = Math.min(1, score * 1.08);
        if (score >= SUGGESTION_FLOOR) results.push({ material: mat, score });
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
}

/** Spari listu sirovih naziva grupa s katalogom (lokalno, bez AI). */
export function matchMaterialLabels(labels: string[], catalog: Material[]): MaterialMatch[] {
    return labels.map(label => {
        const suggestions = suggestMaterials(label, catalog);
        const top = suggestions[0];
        return {
            label,
            suggestions,
            autoMatch: top && top.score >= AUTO_MATCH_THRESHOLD ? top.material : null,
        };
    });
}
