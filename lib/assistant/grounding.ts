// ════════════════════════════════════════════════════════════════════
// UTEMELJENOST UPISA — upisuje se samo ono što je korisnik rekao (čisto)
//
// Model bira oznake (W#, R#) i tekst posla; ovdje se provjeri da se svaki
// radnik, nalog i posao zaista nalazi u porukama korisnika (ime, nadimak iz
// rječnika, naziv naloga ili klijenta) ili u odgovoru na ponuđeni izbor.
// Ne nađe se → upis se odbija i model mora pitati umjesto da pogađa.
// Tako „Ahmad 0,25 dana" ili „svi na Sto za Igora" ne mogu nastati iz poruke
// koja ih ne spominje.
// jest: lib/__tests__/grounding.test.ts
// ════════════════════════════════════════════════════════════════════

import { foldText, stem, tokens } from '@/lib/voice/text';
import { tokenSimilarity } from '@/lib/voice/match';

export interface GroundRef {
    id: string;
    name: string;
    /** Drugi nazivi: nadimci iz rječnika, klijent/projekat naloga. */
    aliases?: string[];
}

/** Iza „svi" ove riječi znače stvari, ne ljude: „svi proizvodi", „svi nalozi". */
const THINGS = ['proizvod', 'nalo', 'element', 'ormar', 'proces', 'materijal', 'komad', 'dio', 'dijel', 'stvar', 'predmet',
    'gardarob', 'garderob', 'kuhinj', 'vrat', 'posl', 'okov', 'stak', 'ogledal', 'ploc', 'front', 'stol', 'sto'];

/** „Svi su prisutni", „cijela ekipa", „svi radnici" — upis za sve aktivne radnike je rečen. „Svi proizvodi" nije. */
export function mentionsEveryone(text: string): boolean {
    const t = foldText(text);
    if (/\b(cijela ekipa|cela ekipa|citava ekipa|cijelu ekipu|niko nije falio|nitko nije falio)\b/.test(t)) return true;
    const re = /\b(svi|svima|sviju)\b\s*([a-z]+)?/g;
    for (let m = re.exec(t); m; m = re.exec(t)) {
        const next = m[2] || '';
        if (!THINGS.some(x => next.startsWith(x))) return true;
    }
    return false;
}

/** „Svi nalozi", „sve naloge", „na svemu". */
export function mentionsAllOrders(text: string): boolean {
    return /\b(svi nalozi|sve naloge|svim nalozima|svi poslovi|na svemu)\b/.test(foldText(text));
}

const words = (s: string) => tokens(foldText(s)).filter(w => w.length >= 3);

/** Riječ naziva se nalazi u tekstu (s padežima i sitnim greškama). */
function hit(nameWord: string, textWords: string[]): boolean {
    const s = stem(nameWord);
    return textWords.some(t => t === nameWord || stem(t) === s || (nameWord.length >= 5 && tokenSimilarity(nameWord, t) >= 0.85));
}

/** Fraza (nadimak, alias) cijela u tekstu. */
function phraseIn(phrase: string, textWords: string[]): boolean {
    const p = words(phrase);
    return p.length > 0 && p.every(w => hit(w, textWords));
}

export function workerMentioned(text: string, w: GroundRef): boolean {
    const t = words(text);
    return words(w.name).some(x => hit(x, t)) || (w.aliases || []).some(a => phraseIn(a, t));
}

/** Imena radnika koji NISU rečeni (prazno = sve u redu). „Svi" pokriva sve. */
export function ungroundedWorkers(text: string, all: GroundRef[], ids: string[]): string[] {
    if (mentionsEveryone(text)) return [];
    return ids.map(id => all.find(w => w.id === id)).filter((w): w is GroundRef => !!w && !workerMentioned(text, w)).map(w => w.name);
}

/** Vrste proizvoda — same po sebi ne određuju nalog („kuhinja" ima svaki drugi klijent). */
const GENERIC = new Set([
    'kuhinja', 'ormar', 'ormari', 'garderober', 'gardarober', 'garderoberi', 'gardaroberi', 'vrata', 'sto', 'stol', 'stolovi', 'komoda',
    'krevet', 'ostrvo', 'polica', 'police', 'element', 'elementi', 'plakar', 'kupatilo', 'regal', 'klupa', 'stolica', 'obloga',
    'dnevni', 'boravak', 'soba', 'sobi', 'djecija', 'djecijoj', 'spavaca', 'hodnik', 'ulaz', 'radni', 'ploca', 'nalog', 'montaza',
    'izrada', 'stan', 'kuca', 'donji', 'gornji', 'visoki', 'zidni', 'tv',
].map(w => stem(w)));

const isGeneric = (w: string) => GENERIC.has(stem(w));

function orderWords(o: GroundRef): string[] {
    return Array.from(new Set([o.name, ...(o.aliases || [])].flatMap(words)));
}

/**
 * Nalog je rečen kad se u tekstu nađe riječ koja ga razlikuje (klijent,
 * mjesto, nadimak iz rječnika) — ili samo vrsta proizvoda, ali tad tako da
 * je jedini otvoren nalog s tim riječima („radio kuhinju", a kuhinja je jedna).
 */
export function orderMentioned(text: string, o: GroundRef, all: GroundRef[]): boolean {
    const t = words(text);
    if ((o.aliases || []).some(a => phraseIn(a, t) && words(a).some(w => !isGeneric(w)))) return true;
    const mine = orderWords(o).filter(w => hit(w, t));
    if (mine.some(w => !isGeneric(w))) return true;
    if (!mine.length) return false;
    const rivals = all.filter(x => x.id !== o.id && mine.every(w => orderWords(x).some(y => stem(y) === stem(w))));
    return rivals.length === 0;
}

export function ungroundedOrders(text: string, all: GroundRef[], ids: string[]): string[] {
    if (mentionsAllOrders(text)) return [];
    return ids.map(id => all.find(o => o.id === id)).filter((o): o is GroundRef => !!o && !orderMentioned(text, o, all)).map(o => o.name);
}

/** Tekst posla („kuhinja Čorluka") mora biti iz poruka — ne smije ga model izmisliti. */
export function workSaid(text: string, work: string, share = 0.5): boolean {
    const w = words(work);
    if (!w.length) return true;
    const t = words(text);
    return w.filter(x => hit(x, t)).length / w.length >= share;
}

/**
 * Naslov zadatka je preformulisan („napravi" → „Napraviti"), pa je prag niži —
 * ali bar trećina riječi mora biti iz poruke. „Odraditi ploču za Dinu na CNC-u"
 * iz „Neka Imer napravi Dini dasku" ne prolazi (CNC je iz ranijeg razgovora).
 */
export function titleSaid(text: string, title: string): boolean {
    return workSaid(text, title, 0.34);
}
