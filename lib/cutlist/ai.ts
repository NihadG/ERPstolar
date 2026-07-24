// ════════════════════════════════════════════════════════════════════
// AI (GEMINI) POMOĆ ZA KROJNE LISTE — klijentski omotači
//
// Gemini ključ postoji samo na serveru, pa sve ide kroz /api/cutlist-ai
// (isti obrazac kao AIImportWizard → /api/ai-import). Dvije upotrebe,
// obje NA ZAHTJEV (dugme u UI, ne automatski):
//  1. aiParseCutlistFile — izvuci komade iz XLSX/PDF/slike.
//  2. aiMatchMaterials — spari sirove nazive materijala s katalogom kad
//     lokalno fuzzy sparivanje (lib/cutlist/match.ts) nema pouzdan pogodak.
// ════════════════════════════════════════════════════════════════════

import type { CutPart } from './types';
import { normalizeMaterialKey } from './parse';

interface AiCutRow {
    name?: string;
    width?: number;
    height?: number;
    qty?: number;
    material?: string;
    thickness?: number;
    edge_l?: number;
    edge_w?: number;
}

function rowsToParts(rows: AiCutRow[], defaultMaterial: string): CutPart[] {
    // Ako NIJEDAN red nema podatke o kantu, podrazumijeva se kant 2/2
    // (sve ivice) — isto pravilo kao lokalni parser.
    const anyEdgeInfo = rows.some(r => r.edge_l !== undefined || r.edge_w !== undefined);

    const parts: CutPart[] = [];
    for (const row of rows) {
        const width = Number(row.width);
        const height = Number(row.height);
        const qty = Math.max(1, Math.round(Number(row.qty) || 1));
        if (!(width > 0) || !(height > 0)) continue;

        let materialLabel = (row.material || '').trim() || defaultMaterial;
        const thickness = Number(row.thickness);
        if (thickness > 0 && !/\d+\s*mm/i.test(materialLabel)) {
            materialLabel = `${materialLabel} ${thickness}mm`;
        }

        const edgeL = anyEdgeInfo ? Math.min(2, Math.max(0, Math.round(Number(row.edge_l) || 0))) : 2;
        const edgeW = anyEdgeInfo ? Math.min(2, Math.max(0, Math.round(Number(row.edge_w) || 0))) : 2;

        parts.push({
            id: `cut-ai-${parts.length + 1}`,
            name: (row.name || '').trim() || `Dio ${parts.length + 1}`,
            width,
            height,
            qty,
            materialRaw: materialLabel,
            materialKey: normalizeMaterialKey(materialLabel),
            edgeL: edgeL || undefined,
            edgeW: edgeW || undefined,
        });
    }
    return parts;
}

export interface AiParseResult {
    parts: CutPart[];
    warnings: string[];
    error?: string;
}

/** Izvuci krojnu listu iz fajla (XLSX/PDF/slika) preko servera. */
export async function aiParseCutlistFile(file: File, defaultMaterial = 'Ploča'): Promise<AiParseResult> {
    try {
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch('/api/cutlist-ai', { method: 'POST', body: formData });
        const data = await response.json();

        if (!data.success) {
            return { parts: [], warnings: [], error: data.error || 'AI analiza nije uspjela' };
        }
        return {
            parts: rowsToParts(data.rows || [], defaultMaterial),
            warnings: Array.isArray(data.warnings) ? data.warnings : [],
        };
    } catch (error) {
        console.error('aiParseCutlistFile error:', error);
        return {
            parts: [],
            warnings: [],
            error: error instanceof Error ? error.message : 'Greška pri AI analizi dokumenta',
        };
    }
}

export interface AiMatchResult {
    /** label → Material_ID (null = nema odgovarajućeg u katalogu). */
    matches: Record<string, string | null>;
    error?: string;
}

/**
 * Spari sirove nazive materijala s katalogom preko servera. Vraća
 * mapiranje label → Material_ID ili null kad u katalogu nema ničeg
 * odgovarajućeg (tad UI nudi kreiranje novog materijala).
 */
export async function aiMatchMaterials(
    labels: string[],
    catalog: { id: string; name: string; category: string }[],
): Promise<AiMatchResult> {
    try {
        const response = await fetch('/api/cutlist-ai', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ labels, catalog }),
        });
        const data = await response.json();

        if (!data.success) {
            return { matches: {}, error: data.error || 'AI sparivanje nije uspjelo' };
        }

        const validIds = new Set(catalog.map(c => c.id));
        const matches: Record<string, string | null> = {};
        for (const label of labels) {
            const id = data.matches[label];
            matches[label] = typeof id === 'string' && validIds.has(id) ? id : null;
        }
        return { matches };
    } catch (error) {
        console.error('aiMatchMaterials error:', error);
        return {
            matches: {},
            error: error instanceof Error ? error.message : 'Greška pri AI sparivanju materijala',
        };
    }
}
