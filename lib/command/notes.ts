// ════════════════════════════════════════════════════════════════════
// KOMANDNI CENTAR — NAPOMENE KAO OPERATIVNA LISTA
//
// Pitanje nije podatak nego DUG: neko čeka odgovor. Zato lista odgovara na
// tri stvari koje stari prikaz nije razlikovao:
//   • KOD KOGA JE LOPTA — grupisanje po primaocu, jer se djeluje po njemu
//     (kad zoveš klijenta, trebaš sva njegova pitanja odjednom, ne razbacana
//      po proizvodima)
//   • KOLIKO DUGO ČEKA — pitanje staro dvije sedmice nije isto što i jučerašnje
//   • ŠTA JE OTVORENO — otvoreno gore, riješeno sklopljeno na dno
//
// Sve je čisto i testabilno; komponenta samo crta.
// ════════════════════════════════════════════════════════════════════

import type { Product, ProductNote, ProductNoteAudience, Project } from '../types';
import { noteStatus } from '../productNotes';

/** Poslije koliko dana čekanje postaje problem koji se ističe. */
export const STALE_DAYS = 7;

export interface CommandNote {
    note: ProductNote;
    projectId: string;
    projectName: string;
    productId: string;
    productName: string;
    status: 'open' | 'answered' | 'resolved';
    /** Dana od postavljanja (za otvorena) ili od odgovora (za odgovorena). */
    ageDays: number;
    stale: boolean;
}

export interface NoteGroup {
    key: string;
    label: string;
    /** Za grupisanje po projektu — boja i redoslijed s table. */
    projectId?: string;
    /** Npr. naziv projekta kad su grupe pozicije. */
    sublabel?: string;
    audience?: ProductNoteAudience;
    notes: CommandNote[];
    openCount: number;
}

export function daysBetween(fromISO: string | undefined, today: string): number {
    if (!fromISO) return 0;
    const from = Date.parse(`${fromISO.slice(0, 10)}T12:00:00Z`);
    const to = Date.parse(`${today.slice(0, 10)}T12:00:00Z`);
    if (Number.isNaN(from) || Number.isNaN(to)) return 0;
    return Math.max(0, Math.round((to - from) / 86_400_000));
}

export function collectNotes(projects: Project[], today: string): CommandNote[] {
    const out: CommandNote[] = [];
    for (const project of projects) {
        for (const product of (project.products || []) as Product[]) {
            for (const note of product.Questions || []) {
                const status = noteStatus(note);
                const since = status === 'open' ? note.Created_At : (note.Answered_At || note.Updated_At || note.Created_At);
                const ageDays = daysBetween(since, today);
                out.push({
                    note,
                    projectId: project.Project_ID,
                    projectName: project.Name || project.Client_Name || 'Projekat',
                    productId: product.Product_ID,
                    productName: product.Name || 'Proizvod',
                    status,
                    ageDays,
                    stale: status === 'open' && ageDays >= STALE_DAYS,
                });
            }
        }
    }
    return out;
}

const STATUS_RANK = { open: 0, answered: 1, resolved: 2 } as const;

export type NoteGroupBy = 'audience' | 'project' | 'product';
export type NoteSort = 'oldest' | 'newest' | 'alpha';

/**
 * Otvoreno uvijek ide prije odgovorenog i riješenog — to je stalno, bez obzira
 * na izabrano sortiranje. Sortiranje bira samo poredak UNUTAR istog stanja,
 * inače bi „najnovije prvo" gurnulo riješene napomene na vrh.
 */
export function compareNotes(a: CommandNote, b: CommandNote, sort: NoteSort = 'oldest'): number {
    const byStatus = STATUS_RANK[a.status] - STATUS_RANK[b.status];
    if (byStatus !== 0) return byStatus;
    if (sort === 'alpha') return a.note.Text.localeCompare(b.note.Text, 'bs');
    const byAge = sort === 'newest' ? a.ageDays - b.ageDays : b.ageDays - a.ageDays;
    return byAge || a.productName.localeCompare(b.productName, 'bs');
}

/** Sve po čemu se napomena može naći: pitanje, odgovor, projekat, pozicija. */
export function noteSearchText(entry: CommandNote): string {
    return `${entry.note.Text} ${entry.note.Answer || ''} ${entry.projectName} ${entry.productName}`;
}

const AUDIENCE_ORDER: ProductNoteAudience[] = ['client', 'supplier', 'colleague', 'other'];

export function groupNotes(
    notes: CommandNote[],
    by: NoteGroupBy,
    audienceLabels: Record<ProductNoteAudience, string>,
    projectOrder: Map<string, number>,
    sort: NoteSort = 'oldest',
): NoteGroup[] {
    const keyOf = (entry: CommandNote) =>
        by === 'audience' ? entry.note.Audience : by === 'project' ? entry.projectId : entry.productId;
    const labelOf = (entry: CommandNote) =>
        by === 'audience' ? audienceLabels[entry.note.Audience] : by === 'project' ? entry.projectName : entry.productName;

    const map = new Map<string, NoteGroup>();
    for (const entry of notes) {
        const key = keyOf(entry);
        const group = map.get(key) || {
            key,
            label: labelOf(entry),
            // Pozicija nosi boju svog projekta, pa se i u tom grupisanju vidi čija je.
            projectId: by === 'audience' ? undefined : entry.projectId,
            sublabel: by === 'product' ? entry.projectName : undefined,
            audience: by === 'audience' ? entry.note.Audience : undefined,
            notes: [],
            openCount: 0,
        };
        group.notes.push(entry);
        if (entry.status === 'open') group.openCount++;
        map.set(key, group);
    }

    const groups = Array.from(map.values());
    groups.forEach(group => group.notes.sort((a, b) => compareNotes(a, b, sort)));
    return groups.sort((a, b) => {
        // Grupa s otvorenim pitanjima ide prije one u kojoj je sve riješeno.
        if ((a.openCount > 0) !== (b.openCount > 0)) return a.openCount > 0 ? -1 : 1;
        if (by === 'audience') return AUDIENCE_ORDER.indexOf(a.audience!) - AUDIENCE_ORDER.indexOf(b.audience!);
        const byProject = (projectOrder.get(a.projectId!) ?? 0) - (projectOrder.get(b.projectId!) ?? 0);
        return by === 'project' ? byProject : (byProject || a.label.localeCompare(b.label, 'bs'));
    });
}

/** Kratko trajanje — stoji u uglu kartice, pa mora stati u par znakova. */
export function ageLabel(days: number): string {
    if (days <= 0) return 'danas';
    if (days === 1) return '1 dan';
    if (days < 7) return `${days} dana`;
    if (days < 30) return `${Math.floor(days / 7)} sedm.`;
    return `${Math.floor(days / 30)} mj.`;
}
