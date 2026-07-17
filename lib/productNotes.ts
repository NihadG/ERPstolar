// ════════════════════════════════════════════════════════════════════
// OTVORENA PITANJA / NAPOMENE PO PROIZVODU — čista logika (bez Firebase).
//
// Pitanja žive na proizvodu (Product.Questions[]) — nema zasebne kolekcije:
// agregacija na nivo projekta je samo prolaz kroz proizvode koji su ionako
// u memoriji, a print/pregled ne trebaju upit. Sve funkcije ovdje su čiste
// (uzmi niz → vrati novi niz / izvedeni podatak), pa su lako testabilne i
// UI ih samo poziva.
//
// STATUS pitanja je IZVEDEN, ne pohranjen: Riješeno (checkbox) > Odgovoreno
// (ima Answer) > Otvoreno. Tako se ta tri stanja ne mogu razići.
// jest: lib/__tests__/productNotes.test.ts
// ════════════════════════════════════════════════════════════════════

import type { Product, ProductNote, ProductNoteAudience } from './types';

export type ProductNoteStatus = 'open' | 'answered' | 'resolved';

const uid = () => (typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `n-${Date.now()}-${Math.random().toString(36).slice(2)}`);

// ── Kreiranje / izmjena (immutable nad nizom) ───────────────────────

export interface NewNoteInput {
    Text: string;
    Audience: ProductNoteAudience;
    Answer?: string;
}

/** Novo pitanje — prazan tekst se odbacuje (vraća se isti niz). */
export function addNote(notes: ProductNote[] | undefined, input: NewNoteInput, nowISO: string): ProductNote[] {
    const text = input.Text.trim();
    if (!text) return notes || [];
    const answer = input.Answer?.trim();
    const note: ProductNote = {
        id: uid(),
        Text: text,
        Audience: input.Audience,
        Resolved: false,
        Created_At: nowISO,
        ...(answer ? { Answer: answer, Answered_At: nowISO } : {}),
    };
    return [...(notes || []), note];
}

/**
 * Izmjena polja pitanja. Postavljanje Answer-a prvi put stavlja Answered_At;
 * brisanje odgovora ga skida. Prazan Text se IGNORIŠE (pitanje bez teksta nema
 * smisla — UI briše kroz removeNote).
 */
export function updateNote(
    notes: ProductNote[] | undefined,
    id: string,
    patch: Partial<Pick<ProductNote, 'Text' | 'Audience' | 'Answer' | 'Resolved'>>,
    nowISO: string,
): ProductNote[] {
    return (notes || []).map(n => {
        if (n.id !== id) return n;
        const next: ProductNote = { ...n, Updated_At: nowISO };

        if (patch.Text !== undefined) {
            const t = patch.Text.trim();
            if (t) next.Text = t;
        }
        if (patch.Audience !== undefined) next.Audience = patch.Audience;
        if (patch.Resolved !== undefined) next.Resolved = patch.Resolved;

        if (patch.Answer !== undefined) {
            const a = patch.Answer.trim();
            if (a) {
                // Answered_At se postavlja samo kad odgovora RANIJE nije bilo.
                if (!n.Answer) next.Answered_At = nowISO;
                next.Answer = a;
            } else {
                delete next.Answer;
                delete next.Answered_At;
            }
        }
        return next;
    });
}

export function removeNote(notes: ProductNote[] | undefined, id: string): ProductNote[] {
    return (notes || []).filter(n => n.id !== id);
}

export function toggleResolved(notes: ProductNote[] | undefined, id: string, nowISO: string): ProductNote[] {
    const cur = (notes || []).find(n => n.id === id);
    return updateNote(notes, id, { Resolved: !cur?.Resolved }, nowISO);
}

// ── Izvedeni podaci ─────────────────────────────────────────────────

export function noteStatus(note: Pick<ProductNote, 'Resolved' | 'Answer'>): ProductNoteStatus {
    if (note.Resolved) return 'resolved';
    if (note.Answer && note.Answer.trim()) return 'answered';
    return 'open';
}

export interface NotesSummary {
    total: number;
    open: number;        // nije riješeno i nema odgovora
    answered: number;    // ima odgovor, nije riješeno
    resolved: number;    // riješeno
    /** „Traži pažnju" = otvoreno + odgovoreno-ali-neriješeno; brojka na badge-u. */
    unresolved: number;
}

export function summarizeNotes(notes: ProductNote[] | undefined): NotesSummary {
    let open = 0, answered = 0, resolved = 0;
    for (const n of notes || []) {
        const s = noteStatus(n);
        if (s === 'resolved') resolved++;
        else if (s === 'answered') answered++;
        else open++;
    }
    return { total: (notes || []).length, open, answered, resolved, unresolved: open + answered };
}

/**
 * Redoslijed čitanja: neriješeno prije riješenog; unutar toga otvoreno prije
 * odgovorenog (otvoreno je ono što još visi); pa najstarije prvo (redoslijed
 * nastanka = redoslijed po kojem su se pitanja javljala).
 */
export function sortNotes(notes: ProductNote[] | undefined): ProductNote[] {
    const rank = (n: ProductNote) => {
        const s = noteStatus(n);
        return s === 'open' ? 0 : s === 'answered' ? 1 : 2;
    };
    return [...(notes || [])].sort((a, b) => {
        const r = rank(a) - rank(b);
        if (r !== 0) return r;
        return (a.Created_At || '').localeCompare(b.Created_At || '');
    });
}

// ── Agregacija na nivo projekta (za modal + print) ──────────────────

export interface ProductNotesGroup {
    productId: string;
    productName: string;
    notes: ProductNote[];      // sortirano (sortNotes)
    summary: NotesSummary;
}

/**
 * Pitanja grupisana po proizvodu. `onlyProductIds` (ako je zadan) filtrira na
 * izabrane proizvode — koristi print „selektovanih proizvoda". Proizvodi bez
 * ijednog pitanja se izostavljaju (osim `includeEmpty`, za prikaz „dodaj prvo").
 */
export function groupNotesByProduct(
    products: Pick<Product, 'Product_ID' | 'Name' | 'Questions'>[],
    opts: { onlyProductIds?: Set<string>; includeEmpty?: boolean } = {},
): ProductNotesGroup[] {
    const groups: ProductNotesGroup[] = [];
    for (const p of products) {
        if (opts.onlyProductIds && !opts.onlyProductIds.has(p.Product_ID)) continue;
        const notes = p.Questions || [];
        if (notes.length === 0 && !opts.includeEmpty) continue;
        groups.push({
            productId: p.Product_ID,
            productName: p.Name || 'Bez naziva',
            notes: sortNotes(notes),
            summary: summarizeNotes(notes),
        });
    }
    return groups;
}

/** Zbir svih pitanja preko liste proizvoda — badge na kartici projekta. */
export function summarizeProjectNotes(
    products: Pick<Product, 'Questions'>[],
): NotesSummary {
    const all: ProductNote[] = [];
    for (const p of products) if (p.Questions) all.push(...p.Questions);
    return summarizeNotes(all);
}

/** Filter po primaocu (audience) i/ili statusu — za trake filtera u modalu. */
export function filterNotes(
    notes: ProductNote[],
    filters: { audience?: ProductNoteAudience | 'all'; status?: ProductNoteStatus | 'all' },
): ProductNote[] {
    return notes.filter(n => {
        if (filters.audience && filters.audience !== 'all' && n.Audience !== filters.audience) return false;
        if (filters.status && filters.status !== 'all' && noteStatus(n) !== filters.status) return false;
        return true;
    });
}
