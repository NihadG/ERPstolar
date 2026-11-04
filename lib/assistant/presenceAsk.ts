// ════════════════════════════════════════════════════════════════════
// KO NIJE SPOMENUT — prisustvo za radnike koje upis dana nije pokrio (čisto)
//
// „Ako nekog nisam spomenuo, a nema prisustvo, nek me pita za tog radnika" (korisnik,
// 04.11.). Poslije upisa rada ili prisustva za dan ERP nađe aktivne radnike bez prisustva
// koje poruka nije spomenula i pita dugmadima: jedan dodir upiše prisustvo bez modela.
// „Radio" upiše prisutan BEZ naloga — na čemu je radio korisnik kaže porukom (nalog se ne
// pogađa iz zadnjeg dana).
//   pres:<workerId>:<YYYY-MM-DD>:<p|o|b|g>   obrađuje telegramHandler
// jest: lib/__tests__/presenceAsk.test.ts
// ════════════════════════════════════════════════════════════════════

import type { ButtonRows } from '@/lib/telegram/api';

/** Šifra dugmeta → status prisustva u ERP-u. */
export const PRESENCE_CODES: Record<string, string> = { p: 'Prisutan', o: 'Odsutan', b: 'Bolovanje', g: 'Odmor' };

/** Najviše ovoliko radnika s dugmadima; ostali samo imenom u tekstu. */
export const MAX_ASKED = 8;

export function presenceQuestion(people: { id: string; name: string }[], date: string, dayLabel: string): { text: string; buttons: ButtonRows } {
    const shown = people.slice(0, MAX_ASKED);
    const rest = people.slice(MAX_ASKED);
    const first = (n: string) => n.split(' ')[0];
    return {
        text: `👥 Bez prisustva za ${dayLabel}, a nisu spomenuti: ${people.map(p => p.name).join(', ')} — šta je s njima?${rest.length ? ` (dugmad za prvih ${MAX_ASKED})` : ''} Na čemu je ko radio reci porukom.`,
        buttons: shown.map(p => [
            { text: `${first(p.name)}: radio`, data: `pres:${p.id}:${date}:p` },
            { text: 'odsutan', data: `pres:${p.id}:${date}:o` },
            { text: 'bolovanje', data: `pres:${p.id}:${date}:b` },
            { text: 'godišnji', data: `pres:${p.id}:${date}:g` },
        ]),
    };
}

/** `pres:…` → radnik, dan i status; null za pokvareno dugme. */
export function parsePresenceButton(data: string): { workerId: string; date: string; status: string } | null {
    const m = /^pres:(.+):(\d{4}-\d{2}-\d{2}):([pobg])$/.exec(data);
    return m ? { workerId: m[1], date: m[2], status: PRESENCE_CODES[m[3]] } : null;
}
