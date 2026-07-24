// ════════════════════════════════════════════════════════════════════
// PARSER KROJNE LISTE — CSV / TSV / zalijepljeni tekst (Excel paste)
//
// Prepoznaje kolone po zaglavlju (naziv, dužina/širina/visina, količina,
// materijal, debljina, kant) sa sinonimima na našem i engleskom; bez
// zaglavlja pada na pozicioni raspored kao stari cutlist.html. Evropski
// brojevi (1.200,5) se parsiraju ispravno. Više RAZLIČITIH materijala u
// istom dokumentu je podržano — svaki red nosi svoj materijal, a grupe
// se izvode preko normalizovanog ključa.
// ════════════════════════════════════════════════════════════════════

import type { CutPart } from './types';

export interface ParseCutlistResult {
    parts: CutPart[];
    skipped: number;
    warnings: string[];
}

/** Broj u evropskom ili američkom formatu ("1.200,50", "1,200.50", "3,5"). */
export function parseEuroNumber(raw: string | undefined | null): number {
    if (!raw) return NaN;
    let str = String(raw).trim().replace(/\r/g, '').replace(/\s/g, '');
    if (!str) return NaN;
    const hasDot = str.includes('.');
    const hasComma = str.includes(',');
    if (hasDot && hasComma) {
        if (str.lastIndexOf(',') > str.lastIndexOf('.')) {
            str = str.replace(/\./g, '').replace(',', '.');   // 1.200,50
        } else {
            str = str.replace(/,/g, '');                       // 1,200.50
        }
    } else if (hasComma) {
        const parts = str.split(',');
        if (parts.length === 2 && parts[1].length === 3 && parts[0].length > 0) {
            str = str.replace(',', '');                        // 1,200 → hiljade
        } else {
            str = str.replace(',', '.');                       // 3,5 → decimala
        }
    }
    return parseFloat(str);
}

/**
 * Normalizacija naziva materijala u ključ grupe: NFKD + skidanje
 * dijakritika, nevidljivih znakova i interpunkcije, lowercase. Isti
 * princip kao dedupeProcessKey u lib/orderProcessRows.ts — dva naizgled
 * ista naziva sa zero-width znakom ne smiju praviti dvije grupe.
 */
export function normalizeMaterialKey(raw: string): string {
    return (raw || '')
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')                 // dijakritici (c s z...)
        .replace(/[​-‏⁠﻿­]/g, '')  // zero-width/kontrolni
        .replace(/đ/g, 'd').replace(/Đ/g, 'd')                // đ nema NFKD dekompoziciju
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .replace(/\s+/g, ' ');
}

// ── Prepoznavanje kolona po zaglavlju ────────────────────────────────

type ColumnRole = 'name' | 'x' | 'y' | 'qty' | 'material' | 'thickness' | 'edgeL' | 'edgeW';

const HEADER_SYNONYMS: Record<ColumnRole, string[]> = {
    name: ['naziv', 'ime', 'dio', 'element', 'opis', 'pozicija', 'oznaka', 'name', 'part', 'komad'],
    x: ['duzina', 'duljina', 'length', 'len', 'x', 'dug'],
    y: ['visina', 'height', 'y', 'vis'],
    qty: ['kolicina', 'kol', 'qty', 'quantity', 'kom', 'komada', 'broj', 'br'],
    material: ['materijal', 'material', 'dekor', 'ploca', 'boja', 'decor'],
    thickness: ['debljina', 'deb', 'thickness'],
    edgeL: ['kant d', 'kant duzina', 'kant duz', 'kd', 'k d', 'abs d', 'traka d', 'kant l'],
    edgeW: ['kant s', 'kant sirina', 'kant sir', 'ks', 'k s', 'abs s', 'traka s', 'kant v', 'kant w'],
};

/** 'sirina' je dvosmislena: X ako nema kolone dužine, inače Y. Rješava se naknadno. */
const WIDTH_TOKEN = 'sirina';

function detectDelimiter(text: string): string {
    if (text.includes('\t')) return '\t';
    // Evropski CSV često koristi tačku-zarez (decimala je zarez).
    const semis = (text.match(/;/g) || []).length;
    const commas = (text.match(/,/g) || []).length;
    return semis >= commas / 2 && semis > 0 ? ';' : ',';
}

function mapHeader(cells: string[]): Map<number, ColumnRole> | null {
    const roles = new Map<number, ColumnRole>();
    const taken = new Set<ColumnRole>();
    let widthIdx = -1;

    cells.forEach((cell, i) => {
        const key = normalizeMaterialKey(cell);
        if (!key) return;
        if (key === WIDTH_TOKEN || key.startsWith('sirina')) { if (widthIdx < 0) widthIdx = i; return; }
        for (const [role, syns] of Object.entries(HEADER_SYNONYMS) as [ColumnRole, string[]][]) {
            if (taken.has(role)) continue;
            if (syns.some(s => key === s || (s.length > 2 && key.startsWith(s)))) {
                roles.set(i, role);
                taken.add(role);
                return;
            }
        }
    });

    // 'širina' popunjava slobodnu osu: X ako dužine nema, inače Y.
    if (widthIdx >= 0) {
        if (!taken.has('x')) { roles.set(widthIdx, 'x'); taken.add('x'); }
        else if (!taken.has('y')) { roles.set(widthIdx, 'y'); taken.add('y'); }
    }

    // Zaglavlje je upotrebljivo samo ako pokriva obje dimenzije.
    if (!taken.has('x') || !taken.has('y')) return null;
    return roles;
}

function looksLikeHeader(cells: string[]): boolean {
    // Red bez ijednog broja u drugoj/trećoj koloni tretiramo kao zaglavlje.
    const second = parseEuroNumber(cells[1]);
    const third = parseEuroNumber(cells[2]);
    return Number.isNaN(second) && Number.isNaN(third);
}

const clampEdge = (v: number): number => (Number.isNaN(v) ? 0 : Math.min(2, Math.max(0, Math.round(v))));

/**
 * Parsiraj tekst krojne liste (fajl ili paste). `defaultMaterial` se
 * koristi kad dokument nema kolonu materijala.
 */
export function parseCutlistText(text: string, defaultMaterial = 'Ploča'): ParseCutlistResult {
    const warnings: string[] = [];
    const normalized = (text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalized.split('\n').filter(l => l.trim().length > 0);
    if (lines.length === 0) {
        return { parts: [], skipped: 0, warnings: ['Dokument je prazan'] };
    }

    const delimiter = detectDelimiter(normalized);
    const split = (line: string) => line.split(delimiter).map(c => c.trim());

    const firstCells = split(lines[0]);
    const headerRoles = looksLikeHeader(firstCells) ? mapHeader(firstCells) : null;
    const startIdx = looksLikeHeader(firstCells) ? 1 : 0;

    let skipped = 0;
    // Ključ za spajanje identičnih redova → jedan CutPart s većim qty.
    const merged = new Map<string, CutPart>();

    for (let i = startIdx; i < lines.length; i++) {
        const cells = split(lines[i]);

        let name = '';
        let x = NaN, y = NaN, qty = 1;
        let material = '';
        let thickness = NaN;
        let edgeL = 0, edgeW = 0;

        if (headerRoles) {
            headerRoles.forEach((role, ci) => {
                const val = cells[ci] ?? '';
                switch (role) {
                    case 'name': name = val; break;
                    case 'x': x = parseEuroNumber(val); break;
                    case 'y': y = parseEuroNumber(val); break;
                    case 'qty': qty = Math.round(parseEuroNumber(val)) || 1; break;
                    case 'material': material = val; break;
                    case 'thickness': thickness = parseEuroNumber(val); break;
                    case 'edgeL': edgeL = clampEdge(parseEuroNumber(val)); break;
                    case 'edgeW': edgeW = clampEdge(parseEuroNumber(val)); break;
                }
            });
        } else {
            // Pozicioni raspored (kao stari cutlist.html):
            //   3 kolone: Š, V, Kol
            //   4 kolone: Naziv, Š, V, Kol   ILI   Š, V, Kol, Materijal
            //   5+:       Naziv, Š, V, Kol, Materijal
            if (cells.length < 3) { skipped++; continue; }
            const firstIsNum = !Number.isNaN(parseEuroNumber(cells[0]));
            if (cells.length === 3) {
                x = parseEuroNumber(cells[0]); y = parseEuroNumber(cells[1]);
                qty = Math.round(parseEuroNumber(cells[2])) || 1;
            } else if (cells.length === 4 && firstIsNum && Number.isNaN(parseEuroNumber(cells[3]))) {
                x = parseEuroNumber(cells[0]); y = parseEuroNumber(cells[1]);
                qty = Math.round(parseEuroNumber(cells[2])) || 1;
                material = cells[3];
            } else {
                name = cells[0];
                x = parseEuroNumber(cells[1]); y = parseEuroNumber(cells[2]);
                qty = Math.round(parseEuroNumber(cells[3])) || 1;
                material = cells[4] || '';
            }
        }

        if (!(x > 0) || !(y > 0) || !(qty > 0)) { skipped++; continue; }

        // Debljina ide u naziv materijala ako već nije tamo — "Iveral bijeli" +
        // 18 → "Iveral bijeli 18mm" (razdvaja 18 od 25mm istog dekora).
        let materialLabel = material.trim() || defaultMaterial;
        if (!Number.isNaN(thickness) && thickness > 0 && !/\d+\s*mm/i.test(materialLabel)) {
            materialLabel = `${materialLabel} ${thickness}mm`;
        }

        const partName = name.trim() || `Dio ${merged.size + 1}`;
        const materialKey = normalizeMaterialKey(materialLabel);
        const mergeKey = `${partName}::${x}::${y}::${materialKey}::${edgeL}::${edgeW}`;

        const existing = merged.get(mergeKey);
        if (existing) {
            existing.qty += qty;
        } else {
            merged.set(mergeKey, {
                id: `cut-${merged.size + 1}`,
                name: partName,
                width: x,
                height: y,
                qty,
                materialRaw: materialLabel,
                materialKey,
                edgeL: edgeL || undefined,
                edgeW: edgeW || undefined,
            });
        }
    }

    if (skipped > 0) {
        warnings.push(`Preskočeno ${skipped} redova koji nisu prepoznati kao komadi.`);
    }

    const parts = Array.from(merged.values());

    // Bez kant kolona u dokumentu → podrazumijevano SVE ivice kantirane (2/2).
    // Kolone K-D / K-Š su opcione; kad postoje, poštuje se što u njima piše.
    const hasEdgeColumns = !!headerRoles
        && Array.from(headerRoles.values()).some(r => r === 'edgeL' || r === 'edgeW');
    if (!hasEdgeColumns) {
        for (const p of parts) { p.edgeL = 2; p.edgeW = 2; }
    }

    return { parts, skipped, warnings };
}

/** Različite grupe materijala u redoslijedu pojavljivanja. */
export function groupKeysInOrder(parts: CutPart[]): { key: string; label: string; count: number; area: number }[] {
    const seen = new Map<string, { key: string; label: string; count: number; area: number }>();
    for (const p of parts) {
        let g = seen.get(p.materialKey);
        if (!g) {
            g = { key: p.materialKey, label: p.materialRaw, count: 0, area: 0 };
            seen.set(p.materialKey, g);
        }
        g.count += p.qty;
        g.area += p.qty * p.width * p.height;
    }
    return Array.from(seen.values());
}
