// ════════════════════════════════════════════════════════════════════
// REDOSLIJED CHECK LISTE — po lameli i stanu (čisto)
//
// „Složi tu checklistu po stanovima i lamelama, da ne bude nabacano"
// (03.11.): model je htio zadatak napraviti iznova — otkazao stari, novi
// pao, pa je ostao bez zadatka; drugi pokušaj je ubacio stavke iz
// bilježnice. Redoslijed je posao ERP-a: iste stavke, isti tekst, samo
// složene — lamela (C, E…), pa broj stana; stavke bez stana ostaju na kraju
// svojim redom.
// jest: lib/__tests__/checklistOrder.test.ts
// ════════════════════════════════════════════════════════════════════

import { foldText, stem, tokens } from '@/lib/voice/text';

// ── Stavka po riječima ───────────────────────────────────────────────
//
// „Izbaci ovo obići kompletnu A lamelu", „zamijeni … sa …" (04.11.): model je prepisivao
// cijelu listu iz sjećanja i vratio stavku koju je korisnik maloprije izbacio. Sad model
// kaže koje riječi, a ERP nađe stavku i mijenja samo nju.

/** Riječi koje nose značenje stavke (ponavljanje „Amer i Edin —" je u svakoj stavci). */
const itemWords = (s: string) => tokens(foldText(s)).filter(w => w.length >= 3).map(stem);

/** Udio riječi iz `said` koje su u stavci (0–1). */
function overlap(said: string, item: string): number {
    const a = itemWords(said);
    if (!a.length) return 0;
    const b = new Set(itemWords(item));
    return a.filter(w => b.has(w)).length / a.length;
}

/**
 * Stavka koju rečene riječi označavaju: najbolje poklapanje, bar pola riječi, i jasno
 * bolje od druge. `ambiguous` = dvije stavke jednako dobre — ERP pita, ne pogađa.
 */
export function findItem<T extends { text: string }>(items: T[], said: string): { index: number } | { ambiguous: string[] } | null {
    const scored = items.map((it, i) => ({ i, s: overlap(said, it.text), text: it.text })).filter(x => x.s >= 0.5).sort((x, y) => y.s - x.s);
    if (!scored.length) return null;
    if (scored[1] && scored[1].s >= scored[0].s - 0.1) return { ambiguous: scored.slice(0, 3).map(x => x.text) };
    return { index: scored[0].i };
}

/** Ista stavka već postoji (ponovljeno „dodaj" u sljedećoj poruci) — ne dodaje se dvaput. */
export function sameItem(a: string, b: string): boolean {
    return foldText(a) === foldText(b) || (overlap(a, b) >= 0.8 && overlap(b, a) >= 0.8);
}

/** Prvi stan u tekstu: „C408", „E 007", „B-206" → { letter: 'C', number: 408 }. */
export function firstFlat(text: string): { letter: string; number: number } | null {
    const m = /\b([a-z])\s?-?(\d{3,4})\b/.exec(foldText(text));
    return m ? { letter: m[1].toUpperCase(), number: Number(m[2]) } : null;
}

/** Stavke složene po lameli pa stanu; stabilno (isti stan zadržava redoslijed). */
export function sortByFlat<T extends { text: string }>(items: T[]): T[] {
    return items
        .map((item, i) => ({ item, i, flat: firstFlat(item.text) }))
        .sort((a, b) => {
            if (!a.flat || !b.flat) return (a.flat ? 0 : 1) - (b.flat ? 0 : 1) || a.i - b.i;
            return a.flat.letter.localeCompare(b.flat.letter) || a.flat.number - b.flat.number || a.i - b.i;
        })
        .map(x => x.item);
}
