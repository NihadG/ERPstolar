// ════════════════════════════════════════════════════════════════════
// NASTAVAK RAZGOVORA — naslanja li se poruka na prethodnu (čisto)
//
// Poruke s terena su često niz nepovezanih bilješki („napomeni me za
// Brdo…", pa 20 min kasnije „pitati Edina za kant traku"). Projekat,
// rečeno i nedovršen zahtjev iz prethodne poruke smiju preći u novu SAMO
// kad se nova na nju naslanja: odgovor (reply) na poruku, „a vrata…",
// „to je također…", „ma, treba mi za…", kratka dopuna („brdo").
// Inače bi Brdo prešlo na Edina, a Amrin projekat na Lejlin predračun
// (revizija 02.11.2026).
// jest: lib/__tests__/continuation.test.ts
// ════════════════════════════════════════════════════════════════════

import { foldText, tokens } from '@/lib/voice/text';
import type { MessageKind } from './intent';

/** Poslije ovoliko minuta nova poruka je nova tema, kako god počinjala. */
export const CONTINUATION_MINUTES = 15;

/** Početak koji se naslanja na rečeno: „a vrata…", „ma treba mi…", „ne, u utorak", „isto i za…". */
const STARTS = /^(a|i|pa|ma|ali|nego|jer|znaci|mislim|dakle|to|ta|taj|tu|tom|toj|tog|ovo|ova|ovaj|ono|ista|isto|isti|takodjer|takoder|jos|ne|nije|da|ok|okej|moze|dobro|samo|dodaj|hocu|htio sam|treba mi|trebalo je)\b/;
/** Upućuje na rečeno bilo gdje u poruci: „to je također za Brdo", „za to staklo", „od toga". */
const POINTS_BACK = /\b(isto tako|takodjer|takoder|to je|ta je|taj je|za to|za taj|za tu|od toga|o tome|kao gore|kao prije|prethodn\w*)\b/;

/**
 * Poruka nastavlja prethodnu: unutar CONTINUATION_MINUTES, i počinje ili upućuje
 * na rečeno, ili je kratka dopuna (do 3 riječi: „brdo", „u 9", „Senadu isto").
 */
export function continuesPrevious(text: string, minutesSincePrevious: number | null): boolean {
    if (minutesSincePrevious === null || minutesSincePrevious > CONTINUATION_MINUTES) return false;
    const t = foldText(text);
    if (!t) return false;
    if (tokens(t).length <= 3) return true;
    return STARTS.test(t) || POINTS_BACK.test(t);
}

/** Zahtjev za upis koji prethodna poruka nije završila (bot je pitao ili samo odgovorio). */
export interface UnfinishedAsk {
    kinds: MessageKind[];
    text: string;
    at: string;
}

/**
 * Nedovršen zahtjev prelazi na ovu poruku kad ona sama ne traži upis, a nastavlja
 * prethodnu ili odgovara na pitanje. „Provjeriti sa Senadom sutra u 8…" → bot
 * odgovorio o staklu → „Ma, treba mi za vrata Hamze…" i dalje traži podsjetnik.
 */
export function inheritedAsk(input: {
    unfinished: UnfinishedAsk | null | undefined;
    ownWriteKinds: MessageKind[];
    continues: boolean;
    answering: boolean;
    now: Date;
}): UnfinishedAsk | null {
    const u = input.unfinished;
    if (!u || input.ownWriteKinds.length) return null;
    if ((input.now.getTime() - Date.parse(u.at)) / 60_000 > CONTINUATION_MINUTES) return null;
    return input.continues || input.answering ? u : null;
}
