// ════════════════════════════════════════════════════════════════════
// SERIJALIZACIJA KROJNE LISTE — runtime rezultat → ProductCutList
//
// Jedan oblik za sve potrošače: pregled u modalu, print/PDF dokument i
// snimanje na Product.Cut_Lists. Bez `undefined` u dubini (stripUndefined
// u firestoreClient je plitak) — opcionalna polja se IZOSTAVLJAJU.
// ════════════════════════════════════════════════════════════════════

import type {
    CutlistGroupRecord,
    CutlistPartRecord,
    CutlistSheetRecord,
    ProductCutList,
} from '../types';
import type { CutPart, CutlistSettings, GroupPackResult } from './types';
import { edgeBandingMeters } from './types';

/** Dodatak na izračunatu kant traku (otpad pri kantiranju). */
export const EDGE_BAND_WASTE_FACTOR = 1.1;

export interface CutlistGroupMeta {
    /** materialKey grupe (normalizovan). */
    key: string;
    /** Prikazni naziv (naziv iz kataloga ako je spareno, inače sirovi). */
    label: string;
    /** Spareni katalonški materijal (ID) — izostavljeno ako nema. */
    materialId?: string;
    /** false = grupa se pakovala bez rotacije (usmjereni dekor). */
    allowRotation?: boolean;
}

function roundMm(v: number): number {
    return Math.round(v * 10) / 10;
}

function toSheetRecord(sheet: GroupPackResult['sheets'][number]): CutlistSheetRecord {
    const offcuts = sheet.offcuts.slice(0, 2).map(o => ({ W: Math.round(o.w), H: Math.round(o.h) }));
    const rec: CutlistSheetRecord = {
        Placements: sheet.placements.map(p => ({
            Name: p.name,
            W: roundMm(p.w),
            H: roundMm(p.h),
            X: roundMm(p.x),
            Y: roundMm(p.y),
            Rotated: p.rotated,
        })),
        Cuts: sheet.cuts.map(c => ({
            Axis: c.axis,
            X1: roundMm(c.x1),
            Y1: roundMm(c.y1),
            X2: roundMm(c.x2),
            Y2: roundMm(c.y2),
            Order: c.order,
        })),
        Efficiency: Math.round(sheet.efficiency * 10) / 10,
        Used_Area: Math.round(sheet.usedArea),
        Cut_Length: Math.round(sheet.cutLength),
    };
    if (offcuts.length > 0) rec.Offcuts = offcuts;
    return rec;
}

function toPartRecord(part: CutPart, displayLabel: string): CutlistPartRecord {
    const rec: CutlistPartRecord = {
        ID: part.id,
        Name: part.name,
        Width: part.width,
        Height: part.height,
        Quantity: part.qty,
        // Prikazni label GRUPE (ne sirovi) — print dokument grupiše komade
        // poklapanjem s Group.Material_Label, pa moraju biti identični.
        Material_Label: displayLabel,
    };
    if (part.edgeL) rec.Edge_L = part.edgeL;
    if (part.edgeW) rec.Edge_W = part.edgeW;
    if (part.canRotate === false) rec.Can_Rotate = false;
    return rec;
}

/**
 * Sastavi ProductCutList iz rezultata optimizacije. `results` mora biti u
 * redoslijedu grupa kako se prikazuju (redoslijed iz dokumenta).
 */
export function buildProductCutList(args: {
    id?: string;
    name: string;
    parts: CutPart[];
    settings: CutlistSettings;
    results: GroupPackResult[];
    groups: CutlistGroupMeta[];
    createdAt?: string;
}): ProductCutList {
    const { parts, settings, results, groups } = args;
    const now = new Date().toISOString();

    const groupRecords: CutlistGroupRecord[] = results.map(result => {
        const meta = groups.find(g => g.key === result.materialKey);
        const groupParts = parts.filter(p => p.materialKey === result.materialKey);
        const edgeM = edgeBandingMeters(groupParts);

        const rec: CutlistGroupRecord = {
            Material_Label: meta?.label || groupParts[0]?.materialRaw || result.materialKey,
            Board_Width: result.board.width,
            Board_Height: result.board.height,
            Sheets: result.sheets.map(toSheetRecord),
        };
        if (meta?.materialId) rec.Material_ID = meta.materialId;
        if (meta?.allowRotation === false) rec.Allow_Rotation = false;
        if (edgeM > 0) rec.Edge_Banding_M = Math.round(edgeM * EDGE_BAND_WASTE_FACTOR * 100) / 100;
        return rec;
    });

    return {
        ID: args.id || `cl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        Name: args.name,
        Created_At: args.createdAt || now,
        Updated_At: now,
        Settings: {
            Kerf: settings.kerf,
            Trim: settings.trim,
            Allow_Rotation: settings.allowRotation,
        },
        Parts: parts.map(p => {
            const meta = groups.find(g => g.key === p.materialKey);
            return toPartRecord(p, meta?.label || p.materialRaw);
        }),
        Groups: groupRecords,
        Total_Sheets: groupRecords.reduce((s, g) => s + g.Sheets.length, 0),
    };
}
