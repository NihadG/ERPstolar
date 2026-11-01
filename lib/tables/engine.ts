// ════════════════════════════════════════════════════════════════════
// MOTOR TABELA — isti za svaki izvor (čisto)
//
// Izvor opisuje SVA svoja polja (naziv, riječi, vrijednost, zbir, filter,
// redoslijed); motor radi ostalo isto za sve: kolone (iz poruke ili od modela
// — ono što pokrije više riječi), filteri po bilo kojem polju (samo s
// vrijednostima koje je korisnik rekao), redoslijed, grupe, zbir i napomena
// šta u podacima fali („bez dimenzija: 3").
// jest: lib/__tests__/botTables.test.ts
// ════════════════════════════════════════════════════════════════════

import { foldText, stem } from '@/lib/voice/text';
import { buildVocab, resolveColumns, resolveField, type ColumnResolution, type NamedField } from './columns';
import { buildTable, rowsLabel, type ColumnDef, type PickedColumn, type TableDoc } from './table';

export interface FieldDef<R> extends ColumnDef<R>, NamedField<R> {
    /** Filter po polju; podrazumijevano: sve riječi filtera su u vrijednosti. */
    match?: (row: R, value: string) => boolean;
    /** Prazna ćelija u izabranoj koloni se javi ispod tabele (npr. „bez dimenzija"). */
    gap?: string;
    /** Redoslijed po polju (brojevi, prirodno za stanove); podrazumijevano tekst ćelije. */
    sortKey?: (row: R) => string | number;
    /** Zaglavlje grupe kad se grupiše po ovom polju (podrazumijevano tekst ćelije). */
    groupLabel?: (row: R) => string;
}

export interface SourceSpec<R> {
    fields: FieldDef<R>[];
    defaults: string[];
    defaultSort: (a: R, b: R) => number;
    /** Grupe kad korisnik nije rekao: po ovom polju, osim kad je ono kolona ili je samo jedna grupa. */
    autoGroup?: string;
    /** Poslije izbora kolona (npr. sabiranje istog materijala kad proizvod nije kolona). */
    prepare?: (rows: R[], picked: Set<string>) => R[];
    /** Redovi za rječnik vrijednosti (svi, ne samo filtrirani) — podrazumijevano isti kao redovi tabele. */
    vocabRows?: R[];
}

export interface TableFilter {
    /** Polje riječima korisnika ili ključem („stan", „dobavljac"). */
    field: string;
    values: string[];
    not?: boolean;
}

export interface TableQuery {
    /** Kolone koje je ERP pročitao iz poruke. */
    textColumns: string[];
    /** Kolone koje je poslao model. */
    modelColumns: string[];
    filters: TableFilter[];
    groupBy?: string;
    sort?: string;
    /** Da li je vrijednost rečena u razgovoru (lib/tables/grounding). */
    said: (value: string) => boolean;
}

export type EngineResult = { ok: true; table: TableDoc } | { ok: false; error: string };

const byText = (a: string, b: string) => a.localeCompare(b, 'bs', { numeric: true, sensitivity: 'base' });
const NONE = /^(nista|bez|ne|nema|bez grupa|bez grupisanja)$/;

/** Podrazumijevani filter: sve riječi filtera (osnovni oblik) su na početku nekih riječi vrijednosti. */
export function textMatches(haystack: string, value: string): boolean {
    const hay = foldText(haystack).split(/[\s.,;/()-]+/).filter(Boolean).map(stem);
    const want = foldText(value).split(/[\s.,;/()-]+/).filter(w => w.length >= 2).map(stem);
    return want.length > 0 && want.every(w => hay.some(h => h.startsWith(w) || (w.length >= 4 && w.startsWith(h) && h.length >= 4)));
}

/** Bolje od dva čitanja kolona: više prepoznatih, manje nepoznatih; izjednačeno → iz poruke. */
export function betterColumns(text: ColumnResolution, model: ColumnResolution): ColumnResolution {
    const score = (r: ColumnResolution) => r.columns.length * 2 - r.unknown.length;
    if (!text.columns.length && !text.unknown.length) return model;
    // Model bez kolona ne „pobjeđuje" — inače bi nepoznate riječi tiho postale podrazumijevane kolone.
    if (!model.columns.length) return text;
    return score(model) > score(text) ? model : text;
}

export function runTable<R>(spec: SourceSpec<R>, rows: R[], query: TableQuery, meta: {
    title: string;
    subtitle: string[];
    notes?: string[];
    day: string;
}): EngineResult {
    const fields = spec.fields;
    const fieldOf = (key: string) => fields.find(f => f.key === key)!;
    const vocab = buildVocab(fields, spec.vocabRows || rows);

    // ── Filteri: polje mora postojati, vrijednost mora biti rečena ──
    let chosen = rows;
    for (const f of query.filters) {
        const key = resolveField(f.field, fields, vocab);
        if (!key) return { ok: false, error: `Polje „${f.field}" ne postoji. Polja: ${fields.map(x => x.label.toLowerCase()).join(', ')}.` };
        const values = f.values.map(v => v.trim()).filter(Boolean);
        const unsaid = values.filter(v => !query.said(v));
        if (unsaid.length) return { ok: false, error: `Filter ${unsaid.map(v => `„${v}"`).join(', ')} korisnik nije rekao — ne dodaji ga. Ako za traženo nema izvora, reci to.` };
        if (!values.length) continue;
        const field = fieldOf(key);
        const hit = (r: R) => values.some(v => (field.match ? field.match(r, v) : textMatches(`${field.value(r, new Set())} ${field.vocab?.(r) || ''}`, v)));
        chosen = chosen.filter(r => (f.not ? !hit(r) : hit(r)));
    }

    // ── Kolone: iz poruke ili od modela, šta pokrije više ──
    const best = betterColumns(resolveColumns(query.textColumns, fields, vocab), resolveColumns(query.modelColumns, fields, vocab));
    const columns: PickedColumn<R>[] = best.columns.length
        ? best.columns.map(c => ({ def: fieldOf(c.key), label: c.label }))
        : spec.defaults.map(k => ({ def: fieldOf(k), label: fieldOf(k).label }));
    const picked = new Set(columns.map(c => c.def.key));

    let prepared = spec.prepare ? spec.prepare(chosen, picked) : chosen;

    // ── Redoslijed ──
    const sortKey = query.sort ? resolveField(query.sort, fields, vocab) : null;
    if (sortKey) {
        const f = fieldOf(sortKey);
        const k = (r: R) => (f.sortKey ? f.sortKey(r) : f.value(r, picked));
        prepared = [...prepared].sort((a, b) => {
            const x = k(a), y = k(b);
            return typeof x === 'number' && typeof y === 'number' ? y - x : byText(String(x), String(y));
        });
    } else {
        prepared = [...prepared].sort(spec.defaultSort);
    }

    // ── Grupe ──
    let groupKey: string | null = null;
    if (query.groupBy && !NONE.test(foldText(query.groupBy).trim())) groupKey = resolveField(query.groupBy, fields, vocab);
    else if (!query.groupBy && spec.autoGroup && !picked.has(spec.autoGroup)) groupKey = spec.autoGroup;
    let groupOf: ((r: R) => string) | undefined;
    if (groupKey) {
        const g = fieldOf(groupKey);
        const label = (r: R) => (g.groupLabel ? g.groupLabel(r) : g.value(r, new Set()) || '—');
        if (query.groupBy || new Set(prepared.map(label)).size > 1) {
            groupOf = label;
            // Grupe idu redom vrijednosti, unutar grupe ostaje redoslijed.
            const order = (r: R) => (g.sortKey ? String(g.sortKey(r)) : label(r));
            prepared = prepared.map((r, i) => ({ r, i })).sort((a, b) => byText(order(a.r), order(b.r)) || a.i - b.i).map(x => x.r);
        }
    }

    // ── Šta u podacima fali ──
    const gaps = columns
        .filter(c => (c.def as FieldDef<R>).gap)
        .map(c => ({ c, n: prepared.filter(r => !c.def.value(r, picked).trim()).length }))
        .filter(x => x.n > 0)
        .map(x => `${(x.c.def as FieldDef<R>).gap}: ${x.n}`);
    const unknown = best.unknown.length
        ? [`Kolonu ${best.unknown.map(u => `„${u}"`).join(', ')} ne znam — mogu: ${fields.map(f => f.label.toLowerCase()).join(', ')}.`]
        : [];

    return {
        ok: true,
        table: buildTable({
            title: meta.title,
            subtitle: [...meta.subtitle.filter(Boolean), rowsLabel(prepared.length)].join(' · '),
            columns,
            rows: prepared,
            groupOf,
            notes: [...(gaps.length ? [`U podacima nema — ${gaps.join(', ')}.`] : []), ...unknown, ...(meta.notes || [])],
            day: meta.day,
        }),
    };
}
