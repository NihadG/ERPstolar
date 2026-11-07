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

// „Što" bez kvačica postane „sto" (stol): „predračun što je Lejla poslala" je vezao Sto za Tarika
// (02.11.). Veznik se izbaci prije presavijanja; „sto" bez kvačica ostaje (može biti stol).
const words = (s: string) => tokens(foldText((s || '').replace(/(^|[^\p{L}])što(?![\p{L}])/giu, '$1 '))).filter(w => w.length >= 3);

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

/**
 * Kratke riječi koje liče na nadimak (početak imena + samoglasnik), a nisu ime:
 * „ime" (Imer), „ima", „ali", „sta"… Iz rečenica s posla, ne iz rječnika jezika.
 */
const NOT_NICKNAMES = new Set([
    'ime', 'ima', 'imo', 'ali', 'ako', 'ova', 'ovo', 'ove', 'ona', 'ono', 'one', 'oni', 'sve', 'svi', 'sva', 'kad', 'kako', 'koja', 'koje',
    'koji', 'sta', 'sto', 'tako', 'tamo', 'jos', 'samo', 'sami', 'sama', 'neka', 'neko', 'nesto', 'moze', 'mora', 'more', 'bila', 'bilo',
    'bile', 'bili', 'dana', 'mene', 'tebe', 'sebe', 'nema', 'nije', 'meni', 'dosta', 'bolje', 'gore', 'dole', 'vani', 'malo', 'puno',
    'jasno', 'jasna', 'nasa', 'nase', 'nasi', 'vasa', 'vase', 'vasi', 'nova', 'novo', 'nove', 'novi', 'prvo', 'prva', 'prvi', 'radi',
    'rade', 'radio', 'radila', 'radili', 'gotovo', 'gotova', 'kuca', 'kuci', 'stanu', 'sada', 'onda', 'evo', 'eto', 'treba', 'trebao',
]);

/**
 * Nadimak iz imena: isti početak (3 slova), ne duži od imena, završava samoglasnikom —
 * „Kemo" za Kemala, „Meho" za Mehmeda, „Suljo" za Sulejmana, „Edo" za Edina.
 */
function nicknameOf(token: string, nameWord: string): boolean {
    if (token.length < 3 || nameWord.length < 4 || token === nameWord || token.length > nameWord.length) return false;
    if (NOT_NICKNAMES.has(token) || isGeneric(token) || !/[aeiou]$/.test(token)) return false;
    return token.slice(0, 3) === nameWord.slice(0, 3);
}

/**
 * Riječi iz teksta koje nisu ničije ime, a mogu biti nadimak → radnici kojima
 * pristaju. „Kemo" → [Kemal]; dva Kemala → oba (pitanje dugmadima).
 */
export function workerNicknames(text: string, all: GroundRef[]): { token: string; ids: string[] }[] {
    const t = words(text);
    const named = new Set(all.flatMap(w => words(w.name).filter(x => hit(x, t))));
    const out: { token: string; ids: string[] }[] = [];
    for (const token of Array.from(new Set(t))) {
        if (named.has(token) || all.some(w => words(w.name).some(x => hit(x, [token])))) continue;
        const ids = all.filter(w => words(w.name).some(x => nicknameOf(token, x))).map(w => w.id);
        if (ids.length) out.push({ token, ids });
    }
    return out;
}

/**
 * Radnik je rečen: ime ili prezime (s padežima), nadimak iz rječnika, ili — kad je
 * poznata cijela lista radnika — nadimak koji pristaje SAMO njemu („Kemo" → Kemal).
 */
export function workerMentioned(text: string, w: GroundRef, all?: GroundRef[]): boolean {
    const t = words(text);
    if (words(w.name).some(x => hit(x, t)) || (w.aliases || []).some(a => phraseIn(a, t))) return true;
    return !!all && workerNicknames(text, all).some(n => n.ids.length === 1 && n.ids[0] === w.id);
}

/**
 * Radnik je u tekstu samo u posvojnom obliku („Tarikov projekat", „Tarikova kuća"): govori se
 * o nečemu njegovom, a ne njemu. Takav spomen ne dodjeljuje zadatak.
 */
export function onlyPossessive(text: string, w: GroundRef): boolean {
    const names = words(w.name);
    const t = words(text);
    const possessive = (x: string) => names.some(n => new RegExp(`^${n}(ov|ev|in)(a|o|e|u|i|og|om|oj|ih|im)?$`).test(x));
    const has = t.filter(x => hit(x, names) || names.some(n => x.startsWith(n)));
    return has.length > 0 && has.every(possessive);
}

/** Imena radnika koji NISU rečeni (prazno = sve u redu). „Svi" pokriva sve. */
export function ungroundedWorkers(text: string, all: GroundRef[], ids: string[]): string[] {
    if (mentionsEveryone(text)) return [];
    return ids.map(id => all.find(w => w.id === id)).filter((w): w is GroundRef => !!w && !workerMentioned(text, w, all)).map(w => w.name);
}

/** Vrste proizvoda — same po sebi ne određuju nalog („kuhinja" ima svaki drugi klijent). */
const GENERIC = new Set([
    'kuhinja', 'ormar', 'ormari', 'garderober', 'gardarober', 'garderoberi', 'gardaroberi', 'vrata', 'sto', 'stol', 'stolovi', 'komoda',
    'krevet', 'ostrvo', 'polica', 'police', 'element', 'elementi', 'plakar', 'kupatilo', 'regal', 'klupa', 'stolica', 'obloga',
    'dnevni', 'boravak', 'soba', 'sobi', 'djecija', 'djecijoj', 'spavaca', 'hodnik', 'ulaz', 'radni', 'ploca', 'nalog', 'montaza',
    'izrada', 'stan', 'kuca', 'donji', 'gornji', 'visoki', 'zidni', 'tv', 'projekat', 'projekt',
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

// ── Ko je radio na čemu: dio rečenice radnika (04.11.) ───────────────
//
// „Amer, Edin i Senad su utovarali kamion za Hamzu…, Tarik i Zlatan stolove za Brdo, Haso
// i Mujo na nalozima za Lejlu i Hamzina vrata" — model je Hasu stavio u Hamzinu grupu.
// Radnik je rečen, nalog je rečen, ali ne ZAJEDNO. Dio radnika = od njegovog imena do
// imena sljedećeg radnika koje dolazi POSLIJE prvog spomena posla; nalozi iz tog dijela su
// njegovi. „osim za vrata" isključuje, „Hamzina vrata" sužava na naloge s tom riječju.

/** Pozicije riječi u tekstu gdje je radnik rečen (ime, prezime ili nadimak iz rječnika). */
function workerPositions(t: string[], w: GroundRef): number[] {
    const names = words(w.name);
    const out: number[] = [];
    t.forEach((tok, i) => { if (names.some(n => hit(n, [tok]))) out.push(i); });
    for (const a of w.aliases || []) {
        const p = words(a);
        t.forEach((_, i) => { if (p.length && p.every((x, k) => t[i + k] && hit(x, [t[i + k]]))) out.push(i); });
    }
    return out;
}

/** Dio teksta koji pripada radniku: od njega do sljedećeg radnika poslije prvog spomena posla. */
export function workerSegment(text: string, w: GroundRef, workers: GroundRef[], orders: GroundRef[]): string | null {
    const t = words(text);
    const starts = workerPositions(t, w);
    if (!starts.length) return null;
    const workerAt = new Set(workers.filter(x => x.id !== w.id).flatMap(x => workerPositions(t, x)));
    const own = new Set(workerPositions(t, w));
    const parts: string[] = [];
    for (const s of starts) {
        let end = t.length;
        let seenWork = false;
        // Grupa imena („Amer, Edin i Senad su…") ide zajedno; sljedeći radnik POSLIJE riječi koja
        // nije ime („Senad je radio uzglavlja…, a Amer i Edin…") počinje novi dio — i kad ERP
        // u prvom dijelu nije prepoznao nijedan nalog (04.11.: završen nalog nije u listi).
        let predicate = false;
        for (let i = s + 1; i < t.length; i++) {
            if (workerAt.has(i) && (seenWork || predicate)) { end = i; break; }
            if (!workerAt.has(i) && !own.has(i)) predicate = true;
            if (!seenWork && orders.some(o => orderMentioned(t.slice(s, i + 1).join(' '), o, orders))) seenWork = true;
        }
        parts.push(t.slice(s, end).join(' '));
    }
    return parts.join(' . ');
}

/** Generičke riječi („vrata") u dijelu: rečene i isključene („osim za vrata", „bez vrata"). */
function genericsOf(segment: string): { said: string[]; except: string[] } {
    const t = segment.split(' ');
    const except = new Set<string>();
    t.forEach((w, i) => { if (/^(osim|bez|izuzev)$/.test(w)) t.slice(i + 1, i + 4).filter(isGeneric).forEach(x => except.add(stem(x))); });
    const said = Array.from(new Set(t.filter(isGeneric).map(stem))).filter(x => !except.has(x));
    return { said, except: Array.from(except) };
}

/**
 * Nalozi rečeni u dijelu rečenice ovog radnika. null = njegov dio ne spominje nijedan posao
 * (provjeru tad radi obična utemeljenost). „Hamzina vrata" → samo Hamzini nalozi s „vrata".
 */
export function ordersForWorker(text: string, w: GroundRef, workers: GroundRef[], orders: GroundRef[]): string[] | null {
    const seg = workerSegment(text, w, workers, orders);
    if (!seg) return null;
    let hits = orders.filter(o => orderMentioned(seg, o, orders));
    if (!hits.length) return null;
    const { said, except } = genericsOf(seg);
    const has = (o: GroundRef, g: string) => orderWords(o).some(x => stem(x) === g);
    if (except.length) hits = hits.filter(o => !except.some(g => has(o, g)));
    // „Hamzina vrata" sužava samo Hamzine naloge: nalog bez te riječi otpada kad isti klijent
    // (zajednička riječ naziva) ima nalog s njom; Lejlin ormar u istom dijelu ostaje.
    if (said.length) {
        const own = (o: GroundRef) => orderWords(o).filter(x => !isGeneric(x)).map(stem);
        hits = hits.filter(o => said.some(g => has(o, g))
            || !hits.some(x => x.id !== o.id && said.some(g => has(x, g)) && own(x).some(w => own(o).includes(w))));
    }
    return hits.map(o => o.id);
}

/**
 * Radnikov dio rečenice kaže vrstu proizvoda („na Lejli i vratima za Hamzu"), a nalog je druge
 * vrste (kuhinja) → nije njegov. „osim za vrata" nije rečena vrsta. Bez vrste u dijelu ili u
 * nazivu naloga nema sukoba (ne zna se).
 */
export function kindConflict(text: string, w: GroundRef, workers: GroundRef[], orders: GroundRef[], order: GroundRef): boolean {
    const seg = workerSegment(text, w, workers, orders);
    if (!seg) return false;
    const { said, except } = genericsOf(seg);
    const own = orderWords(order).filter(isGeneric).map(stem);
    // „…osim za vrata": nalog vrata nije njegov, i kad ga model doda (ponavljanje 04.11.).
    if (except.some(g => own.includes(g))) return true;
    return said.length > 0 && own.length > 0 && !said.some(g => own.includes(g));
}

/**
 * Kome je rečen naziv („Nedim je radio uzglavlja, a Amer i Edin su bili na terenu (nazovi
 * ga korekcije na Brdu)"): grupa imena koja je zadnja ispred naziva u tekstu. null = naziv
 * nije nađen ili ispred njega nema imena (tad se ne provjerava). 04.11.: novi nalog je
 * otišao radniku iz prve rečenice umjesto onima uz koje je rečen.
 */
export function nameOwners(text: string, name: string, workers: GroundRef[]): string[] | null {
    const t = words(text);
    const want = words(name);
    if (!want.length) return null;
    const start = t.findIndex((_, i) => want.every((w, k) => t[i + k] && hit(w, [t[i + k]])));
    if (start < 0) return null;
    const at = (i: number) => workers.filter(w => words(w.name).some(n => hit(n, [t[i]])) || (w.aliases || []).some(a => phraseIn(a, [t[i]]))).map(w => w.id);
    let last = -1;
    for (let i = start - 1; i >= 0; i--) if (at(i).length) { last = i; break; }
    if (last < 0) return null;
    const out = new Set<string>(at(last));
    for (let i = last - 1; i >= 0; i--) {
        if (/^(i|a|,)$/.test(t[i])) continue;
        const ids = at(i);
        if (!ids.length) break;
        ids.forEach(id => out.add(id));
    }
    return Array.from(out);
}

/** „Ne treba", „nije radio", „izbaci"… u blizini imena — radnika se skida s dana samo kad je to rečeno. */
const REMOVE_SAID = /^(ne treba|nije radio|nije bio|nije dosao|nije trebao|izbaci|izbacit|ukloni|obrisi|makni|ne racunaj|ne upisuj|nikako)/;

/**
 * Skidanje radnika s dana je rečeno za NJEGA: riječ uklanjanja do 6 riječi iza imena, ili
 * ispred njega („izbaci Senada"). Ponavljanje 04.11.: model je sam skinuo radnika s dana.
 */
export function removalSaid(text: string, w: GroundRef): boolean {
    const t = tokens(foldText(text || ''));
    const names = words(w.name);
    return t.some((tok, i) => names.some(n => hit(n, [tok])) && (
        REMOVE_SAID.test(t.slice(i + 1, i + 8).join(' ').replace(/^(\w+ ){0,3}?(?=(ne treba|nije|izbac|ukloni|obrisi|makni|nikako))/, ''))
        || /\b(izbaci|ukloni|obrisi|makni|ne upisuj)\s*$/.test(t.slice(Math.max(0, i - 2), i).join(' '))));
}

/**
 * Radnici rečeni samo imenom koje pripada drugom, punim imenom rečenom radniku („Senad Pašić …
 * Senad je radio" — Senad Kalić nije rečen). Model zna staviti oba; ERP izbaci ovog (04.11.).
 */
export function shadowedNames(text: string, ids: string[], all: GroundRef[]): string[] {
    const t = words(text);
    const allTokens = tokens(foldText(text || ''));
    return ids.filter(id => {
        const w = all.find(x => x.id === id);
        if (!w || (w.aliases || []).some(a => phraseIn(a, t)) || fullNameSaid(allTokens, words(w.name))) return false;
        const said = words(w.name).filter(n => hit(n, t));
        if (!said.length) return false;
        const sharedBy = (n: string) => all.filter(x => x.id !== id && words(x.name).some(m => stem(m) === stem(n)));
        if (said.some(n => !sharedBy(n).length)) return false;
        return sharedBy(said[0]).some(r => fullNameSaid(allTokens, words(r.name)));
    });
}

/** Ime i prezime rečeni jedno do drugog, bilo kojim redom („Senada Ibrića", „Ibrić Senad"). */
function fullNameSaid(t: string[], name: string[]): boolean {
    if (name.length < 2) return false;
    const [first, last] = [name[0], name[name.length - 1]];
    return t.some((tok, i) => i + 1 < t.length
        && ((hit(first, [tok]) && hit(last, [t[i + 1]])) || (hit(last, [tok]) && hit(first, [t[i + 1]]))));
}

/**
 * Radnici čije je rečeno samo ime koje dijele s drugim radnikom (dva Senada) — ERP tad pita,
 * ne bira: 04.11. upisan je pogrešan od dvojice istog imena.
 */
export function sharedFirstNames(text: string, ids: string[], all: GroundRef[]): { token: string; ids: string[] }[] {
    const t = words(text);
    // Susjedstvo na SVIM riječima (i kratkim): „Amer Pašić i Senad" nije „Pašić Senad".
    const allTokens = tokens(foldText(text || ''));
    const out: { token: string; ids: string[] }[] = [];
    for (const id of ids) {
        const w = all.find(x => x.id === id);
        if (!w || (w.aliases || []).some(a => phraseIn(a, t))) continue;
        const said = words(w.name).filter(n => hit(n, t));
        if (!said.length) continue;
        // Jasno: puno ime rečeno ZAJEDNO („Senad Ibrić", „Ibrić Senad") — i kad „Senad" dijeli s
        // jednim, a „Ibrić" s drugim radnikom (ponavljanje 04.11.); ili rečena riječ koju nema niko drugi.
        const sharedBy = (n: string) => all.filter(x => x.id !== id && words(x.name).some(m => stem(m) === stem(n)));
        if (fullNameSaid(allTokens, words(w.name))) continue;
        if (said.some(n => !sharedBy(n).length)) continue;
        // Drugi s istim imenom je rečen PUNIM imenom („mislio sam na Senada Pašića") → golo „Senad"
        // je on, ne ovaj: nije nejasno, ovaj samo nije rečen (shadowedNames ga izbaci iz upisa).
        if (sharedBy(said[0]).some(r => fullNameSaid(allTokens, words(r.name)))) continue;
        const rivals = sharedBy(said[0]);
        if (rivals.length && !out.some(o => o.token === said[0])) out.push({ token: said[0], ids: [id, ...rivals.map(r => r.id)] });
    }
    return out;
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
