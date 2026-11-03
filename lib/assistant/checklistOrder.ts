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

import { foldText } from '@/lib/voice/text';

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
