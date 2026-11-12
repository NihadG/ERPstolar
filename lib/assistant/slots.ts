// ════════════════════════════════════════════════════════════════════
// TERMINI (10:30 i 14:30) — spisak, koraci i dugmad (čista logika)
//
// Bot se sam javlja dvaput dnevno, jednom porukom koja je spisak od najviše
// tri stvari: Narudžbe, Obilazak procesa, Upis dana. Dodir otvori jednu,
// ona se riješi dugmadima NA ISTOJ PORUCI i vrati se kao red s kvačicom.
// Bez modela i bez kucanja; jedino „Novi posao" (Bez projekta) prima rečenicu.
//
// Ovdje je samo stanje i prikaz: `slotView` (tekst + dugmad) i `slotTap`
// (dodir → novo stanje + šta ERP treba upisati). Upise radi slotRun.ts.
// Plan: docs/bot/plan-ritam-dana.md · jest: lib/__tests__/assistantSlots.test.ts
// ════════════════════════════════════════════════════════════════════

export type SlotKind = 'a' | 'b';

/** Minute od ponoći (lokalno): termin se šalje u ovom prozoru, jednom. Poslije 15:00 ništa. */
export const SLOT_WINDOWS: Record<SlotKind, { from: number; until: number; label: string }> = {
    a: { from: 10 * 60 + 30, until: 11 * 60 + 30, label: '10:30' },
    b: { from: 14 * 60 + 30, until: 15 * 60, label: '14:30' },
};
/** Obavijesti koje su ranije stizale pojedinačno (pošta, materijal) idu samo u prvih 15 min termina. */
const NOTICE_MINUTES = 15;

export function slotDue(minutes: number): SlotKind | null {
    for (const k of ['a', 'b'] as SlotKind[]) {
        if (minutes >= SLOT_WINDOWS[k].from && minutes < SLOT_WINDOWS[k].until) return k;
    }
    return null;
}

export function inNoticeWindow(minutes: number): boolean {
    return (['a', 'b'] as SlotKind[]).some(k => minutes >= SLOT_WINDOWS[k].from && minutes < SLOT_WINDOWS[k].from + NOTICE_MINUTES);
}

// ─── Podaci stavki ────────────────────────────────────────────────────

export interface Pick { id: string; name: string }

export interface OrdersData {
    /** Najčešći dobavljači (do 3) i ostali iza „Drugi". */
    suppliers: Pick[];
    moreSuppliers: Pick[];
    /** Projekti na kojima se zadnjih dana radilo (do 4). */
    projects: Pick[];
    /** Poslovi bez projekta (kratki nalozi) — iza „Bez projekta". */
    jobs: Pick[];
    /** Javljene narudžbe bez potvrde da su stigle (do 2). */
    waiting: { orderId: string; label: string }[];
}

export interface RoundOption { label: string; process: string; state: 'started' | 'done' }
export interface RoundOrder {
    id: string; name: string; last: string; options: RoundOption[];
    /** Kasniji koraci toka (iza onih na redu) — „Dalje od ovoga…". Stari termini ga nemaju. */
    later?: string[];
}
export interface RoundData { orders: RoundOrder[] }

export interface DayData {
    date: string;
    /** „danas" ili „jučer" — kako se dan zove u pitanju. */
    label: string;
    /** Radnici koje prijedlog još nosi (nisu upisani ni odsutni). */
    workers: number;
    orders: number;
    /** Već upisani za taj dan (jutarnji diktat, aplikacija) — pita se samo za ostale. */
    booked?: number;
    /** Imena onih za koje se pita (do 4), da se vidi na koga se „Ostali isto" odnosi. */
    rest?: string[];
}

interface ItemBase { done: string[]; closed?: boolean }
export type SlotItem =
    | ({ id: 'orders'; data: OrdersData } & ItemBase)
    | ({ id: 'round'; data: RoundData } & ItemBase)
    | ({ id: 'day'; data: DayData } & ItemBase);
export type ItemId = SlotItem['id'];

export interface SlotFlow {
    item: ItemId;
    step: string;
    index: number;
    vars: Record<string, string>;
    changed: number;
    same: number;
}

export interface SlotState {
    kind: SlotKind;
    date: string;
    items: SlotItem[];
    flow: SlotFlow | null;
    taps: number;
    /** Upisi ovog termina, zadnji na kraju — „↩️ Poništi zadnje". */
    undo: { turnId: string; item: ItemId; line: string }[];
    /** Jedan red ispod naslova (npr. tri termina bez odgovora). */
    note?: string;
    /** Čeka se rečenica („Novi posao") — sljedeća poruka ide ovdje, ne modelu. */
    awaiting?: boolean;
}

export type OrderTarget =
    | { kind: 'project'; id: string; name: string }
    | { kind: 'job'; id: string; name: string }
    | { kind: 'newjob'; name: string }
    | { kind: 'multi' | 'stock' | 'none'; name: string };

export type SlotEffect =
    | { type: 'order'; supplier: Pick; target: OrderTarget }
    | { type: 'arrived'; orderId: string; label: string }
    /** Bez procesa = „Sve gotovo": svi proizvodi naloga završeni i nalog zatvoren. */
    | { type: 'progress'; orderId: string; orderName: string; process?: string; state: 'started' | 'done' }
    | { type: 'day_same'; date: string; label: string }
    | { type: 'day_list'; date: string };

export interface ViewButton { text: string; action: string }
export interface SlotViewOut { text: string; buttons: ViewButton[][] }

// ─── Prikaz ───────────────────────────────────────────────────────────

const ITEM_ICON: Record<ItemId, string> = { orders: '🧾', round: '🔧', day: '👷' };

function itemLabel(it: SlotItem): string {
    if (it.id === 'orders') return it.closed ? '➕ Još jedna narudžba' : `${ITEM_ICON.orders} Narudžbe${it.data.waiting.length ? ` · ${it.data.waiting.length} za provjeru` : ''}`;
    if (it.id === 'round') return `${ITEM_ICON.round} Obilazak · ${it.data.orders.length} ${plural(it.data.orders.length, 'nalog', 'naloga', 'naloga')}`;
    const d = it.data;
    return `${ITEM_ICON.day} Upis dana${d.label === 'danas' ? '' : ` (${d.label})`} · ${d.booked ? 'još ' : ''}${d.workers} ${plural(d.workers, 'radnik', 'radnika', 'radnika')}`;
}

/** Red na spisku kad je dan već sav upisan prije termina (stavka stiže zatvorena). */
export function dayBookedLine(d: DayData): string {
    const n = d.booked || 0;
    return `Dan već upisan${d.label === 'danas' ? '' : ` (${d.label})`}: ${n} ${plural(n, 'radnik', 'radnika', 'radnika')}`;
}

const ROUND_LATER = 'Dalje od ovoga…';
const ROUND_ALL = 'Sve gotovo';
const ROUND_ALL_YES = 'Da, sve gotovo';
/** Koraci obilaska ispod pitanja za nalog („Nazad" vraća na nalog, ne na spisak). */
const ROUND_SUB = new Set(['later', 'all']);

export function plural(n: number, one: string, few: string, many: string): string {
    const d = n % 10, h = n % 100;
    if (d === 1 && h !== 11) return one;
    if (d >= 2 && d <= 4 && (h < 12 || h > 14)) return few;
    return many;
}

function rows(buttons: ViewButton[], perRow = 2): ViewButton[][] {
    const out: ViewButton[][] = [];
    // Dug natpis ide sam u red — na telefonu se inače reže.
    let row: ViewButton[] = [];
    for (const b of buttons) {
        if (b.text.length > 18) {
            if (row.length) { out.push(row); row = []; }
            out.push([b]);
            continue;
        }
        row.push(b);
        if (row.length === perRow) { out.push(row); row = []; }
    }
    if (row.length) out.push(row);
    return out;
}

interface Step { q: string; sub?: string; options: string[] }

const TARGET_EXTRA = ['Više projekata', 'Zaliha', 'Bez projekta'];

function stepOf(state: SlotState): Step | null {
    const f = state.flow;
    if (!f) return null;
    const it = state.items.find(i => i.id === f.item);
    if (!it) return null;
    if (it.id === 'orders') {
        const d = it.data;
        switch (f.step) {
            case 'arrived': return { q: `${d.waiting[f.index].label} — je li stiglo?`, options: ['Stiglo', 'Još ne'] };
            case 'ask': return { q: 'Jesi li šta naručio?', options: ['Jesam', 'Ništa'] };
            case 'supplier': return { q: 'Kod koga?', options: [...d.suppliers.map(s => s.name), ...(d.moreSuppliers.length ? ['Drugi…'] : [])] };
            case 'supplier2': return { q: 'Kod koga?', options: d.moreSuppliers.map(s => s.name) };
            case 'target': return { q: `${f.vars.supplierName} — za šta?`, sub: 'Detalji se slože kad stigne račun.', options: [...d.projects.map(p => p.name), ...TARGET_EXTRA] };
            case 'job': return { q: 'Bez projekta — za koji posao?', options: [...d.jobs.map(j => j.name), 'Novi posao', 'Preskoči'] };
            case 'jobname': return { q: 'Za šta je?', sub: 'Napiši ili reci jednom rečenicom, npr. „4 vrata za komšiju".', options: ['Preskoči'] };
        }
    }
    if (it.id === 'round') {
        const o = it.data.orders[f.index];
        const n = it.data.orders.length;
        const later = o.later || [];
        if (f.step === 'later') {
            return { q: `${o.name} — šta je sad u toku?`, sub: 'Koraci prije toga se upišu kao gotovi.', options: [...later, ROUND_ALL] };
        }
        if (f.step === 'all') {
            return { q: `${o.name} — sve gotovo?`, sub: 'Svi proizvodi idu u završeno (dan zadnjeg rada) i nalog se zatvara.', options: [ROUND_ALL_YES, 'Ne'] };
        }
        return {
            q: `${o.name} — dokle su stigli?`,
            sub: `Nalog ${f.index + 1} od ${n}${o.last ? ` · zadnje: ${o.last}` : ''}`,
            options: [...o.options.map(x => x.label), 'Isto', ...(later.length ? [ROUND_LATER] : []), ROUND_ALL],
        };
    }
    if (it.id === 'day') {
        const d = it.data;
        const workers = `${d.workers} ${plural(d.workers, 'radnik', 'radnika', 'radnika')}`;
        if (f.step === 'ask' && d.booked) {
            // Dio dana je već rečen (jutarnji diktat): pita se samo za ostale, po imenu.
            const rest = d.rest || [];
            const names = rest.length ? `${rest.join(', ')}${d.workers > rest.length ? ` i još ${d.workers - rest.length}` : ''}` : workers;
            return {
                q: `Upisano ${d.label}: ${d.booked} ${plural(d.booked, 'radnik', 'radnika', 'radnika')}. Ostali kao prethodni radni dan?`,
                sub: `Ostali: ${names}`,
                options: ['Ostali isto', 'Ima izmjena'],
            };
        }
        if (f.step === 'ask') {
            return {
                q: `Je li ${d.label} sve kao prethodni radni dan?`,
                sub: `${workers} na ${d.orders} ${plural(d.orders, 'nalogu', 'naloga', 'naloga')}`,
                options: ['Sve isto', 'Ima izmjena'],
            };
        }
        return { q: 'Reci ili napiši šta je drugačije.', sub: 'Kad završiš, dodirni „Ostalo isto" — ostali ostaju kao prethodni dan.', options: ['Ostalo isto', 'Spisak'] };
    }
    return null;
}

export function slotView(state: SlotState): SlotViewOut {
    const head = SLOT_WINDOWS[state.kind].label;
    const step = stepOf(state);
    if (step) {
        const buttons = rows(step.options.map((text, i) => ({ text, action: `p${i}` })));
        // Jedina stavka termina nema spisak na koji bi se vraćalo; korak obilaska se vraća na nalog.
        const sub = state.flow!.item === 'round' && ROUND_SUB.has(state.flow!.step);
        if (state.items.length > 1 || sub) buttons.push([{ text: '‹ Nazad', action: 'b' }]);
        return { text: [`🕥 ${head}`, '', step.q, ...(step.sub ? [step.sub] : [])].join('\n'), buttons };
    }
    const open = state.items.filter(i => !i.closed);
    const lines = state.items.flatMap(i => i.done.map(l => `✅ ${l}`));
    const title = open.length
        ? `🕥 ${head} · još ${open.length} od ${state.items.length}`
        : `✅ ${head} · sve gotovo`;
    const buttons: ViewButton[][] = [];
    state.items.forEach((it, i) => {
        // Zatvorene narudžbe ostaju dostupne („Još jedna"), ostalo se ne otvara ponovo.
        if (!it.closed || it.id === 'orders') buttons.push([{ text: itemLabel(it), action: `o${i}` }]);
    });
    if (state.undo.length) buttons.push([{ text: '↩️ Poništi zadnje', action: 'u' }]);
    return { text: [title, ...(state.note ? [state.note] : []), ...(lines.length ? ['', ...lines] : [])].join('\n'), buttons };
}

// ─── Dodir ────────────────────────────────────────────────────────────

export interface TapOut {
    state: SlotState;
    effect?: SlotEffect;
    toast?: string;
}

const clone = (s: SlotState): SlotState => JSON.parse(JSON.stringify(s));
const flowAt = (item: ItemId, step: string, index = 0): SlotFlow => ({ item, step, index, vars: {}, changed: 0, same: 0 });

function closeItem(state: SlotState, id: ItemId, line?: string): void {
    const it = state.items.find(i => i.id === id)!;
    if (line) it.done.push(line);
    it.closed = true;
    state.flow = null;
    state.awaiting = false;
}

function openItem(state: SlotState, index: number): void {
    const it = state.items[index];
    if (!it) return;
    if (it.id === 'orders') {
        state.flow = it.closed ? flowAt('orders', 'supplier') : flowAt('orders', it.data.waiting.length ? 'arrived' : 'ask');
    } else if (it.id === 'round') {
        state.flow = flowAt('round', 'order');
    } else {
        state.flow = flowAt('day', 'ask');
    }
}

/** Termin s jednom stavkom se otvara odmah: poruka je samo pitanje. */
export function newSlotState(kind: SlotKind, date: string, items: SlotItem[], note?: string): SlotState {
    const state: SlotState = { kind, date, items, flow: null, taps: 0, undo: [], ...(note ? { note } : {}) };
    if (items.length === 1) openItem(state, 0);
    return state;
}

function finishRound(state: SlotState): void {
    const f = state.flow!;
    const line = f.changed
        ? `Procesi: ${f.changed} ažurirano${f.same ? `, ${f.same} isto` : ''}`
        : 'Procesi: sve isto';
    closeItem(state, 'round', line);
}

/** Dodir na dugme. Nepoznat ili zastario dodir ne mijenja ništa (toast). */
export function slotTap(prev: SlotState, action: string): TapOut {
    const state = clone(prev);
    const stale: TapOut = { state: prev, toast: 'Ovo dugme više ne važi.' };

    if (action === 'b') {
        if (!state.flow) return stale;
        if (state.flow.item === 'round' && ROUND_SUB.has(state.flow.step)) {
            state.flow = { ...state.flow, step: 'order' };
            return { state };
        }
        state.flow = null;
        state.awaiting = false;
        return { state };
    }
    if (action[0] === 'o') {
        const i = Number(action.slice(1));
        const it = state.items[i];
        if (state.flow || !it || (it.closed && it.id !== 'orders')) return stale;
        state.taps++;
        openItem(state, i);
        return { state };
    }
    if (action[0] !== 'p' || !state.flow) return stale;

    const f = state.flow;
    const step = stepOf(state);
    const k = Number(action.slice(1));
    const choice = step?.options[k];
    if (!step || choice === undefined) return stale;
    state.taps++;
    const it = state.items.find(i => i.id === f.item)!;

    if (it.id === 'orders') {
        const d = it.data;
        const supplier = (): Pick => ({ id: f.vars.supplierId, name: f.vars.supplierName });
        const order = (target: OrderTarget): TapOut => {
            const effect: SlotEffect = { type: 'order', supplier: supplier(), target };
            closeItem(state, 'orders');
            return { state, effect };
        };
        switch (f.step) {
            case 'arrived': {
                const w = d.waiting[f.index];
                const next = f.index + 1 < d.waiting.length ? { ...f, index: f.index + 1 } : flowAt('orders', 'ask');
                state.flow = next;
                return choice === 'Stiglo' ? { state, effect: { type: 'arrived', orderId: w.orderId, label: w.label } } : { state };
            }
            case 'ask':
                if (choice === 'Ništa') { closeItem(state, 'orders', it.done.length ? undefined : 'Ništa naručeno'); return { state }; }
                state.flow = flowAt('orders', 'supplier');
                return { state };
            case 'supplier':
            case 'supplier2': {
                if (choice === 'Drugi…') { state.flow = flowAt('orders', 'supplier2'); return { state }; }
                const list = f.step === 'supplier' ? d.suppliers : d.moreSuppliers;
                const s = list[k];
                state.flow = { ...flowAt('orders', 'target'), vars: { supplierId: s.id, supplierName: s.name } };
                return { state };
            }
            case 'target': {
                if (k < d.projects.length) return order({ kind: 'project', id: d.projects[k].id, name: d.projects[k].name });
                if (choice === 'Više projekata') return order({ kind: 'multi', name: 'više projekata' });
                if (choice === 'Zaliha') return order({ kind: 'stock', name: 'zaliha' });
                state.flow = { ...f, step: 'job' };
                return { state };
            }
            case 'job': {
                if (k < d.jobs.length) return order({ kind: 'job', id: d.jobs[k].id, name: d.jobs[k].name });
                if (choice === 'Novi posao') { state.flow = { ...f, step: 'jobname' }; state.awaiting = true; return { state }; }
                return order({ kind: 'none', name: 'bez projekta' });
            }
            case 'jobname':
                return order({ kind: 'none', name: 'bez projekta' });
        }
        return stale;
    }

    if (it.id === 'round') {
        const o = it.data.orders[f.index];
        const base = { type: 'progress' as const, orderId: o.id, orderName: o.name };
        // Podkoraci (lista kasnijih koraka, potvrda „Sve gotovo") ne pomjeraju obilazak dok se ne izabere.
        if (choice === ROUND_LATER) { state.flow = { ...f, step: 'later' }; return { state }; }
        if (choice === ROUND_ALL) { state.flow = { ...f, step: 'all' }; return { state }; }
        if (f.step === 'all' && choice === 'Ne') { state.flow = { ...f, step: 'order' }; return { state }; }
        let effect: SlotEffect | undefined;
        if (f.step === 'all') effect = { ...base, state: 'done' };
        else if (f.step === 'later') effect = { ...base, process: choice, state: 'started' };
        else if (o.options[k]) effect = { ...base, process: o.options[k].process, state: o.options[k].state };
        if (effect) f.changed++; else f.same++;
        if (f.index + 1 < it.data.orders.length) state.flow = { ...f, step: 'order', index: f.index + 1 };
        else finishRound(state);
        return { state, ...(effect ? { effect } : {}) };
    }

    // Upis dana
    const d = it.data;
    if (f.step === 'ask' && choice === 'Ima izmjena') { state.flow = { ...f, step: 'diff' }; return { state }; }
    if (choice === 'Spisak') { closeItem(state, 'day', 'Spisak za upis dana je ispod'); return { state, effect: { type: 'day_list', date: d.date } }; }
    // „Sve isto", „Ostali isto" i „Ostalo isto": stavku zatvara slotRun kad ERP upiše (red s brojem radnika).
    state.flow = null;
    return { state, effect: { type: 'day_same', date: d.date, label: d.label } };
}

/** Rečenica poslije „Novi posao": naziv kratkog naloga bez projekta. */
export function slotText(prev: SlotState, text: string): TapOut | null {
    const f = prev.flow;
    if (!prev.awaiting || !f || f.item !== 'orders' || f.step !== 'jobname') return null;
    const name = text.replace(/\s+/g, ' ').trim().slice(0, 90);
    if (!name) return null;
    const state = clone(prev);
    const effect: SlotEffect = { type: 'order', supplier: { id: f.vars.supplierId, name: f.vars.supplierName }, target: { kind: 'newjob', name } };
    closeItem(state, 'orders');
    return { state, effect };
}

/** Red koji ostaje na spisku poslije upisa narudžbe. */
export function orderLine(supplier: string, target: OrderTarget): string {
    return `Naručeno: ${supplier} · ${target.name}`;
}

/** Upis je prošao: red na spisak i u „Poništi zadnje". */
export function slotDone(prev: SlotState, item: ItemId, line: string, turnId?: string, close = false): SlotState {
    const state = clone(prev);
    const it = state.items.find(i => i.id === item);
    if (!it) return prev;
    it.done.push(line);
    if (close) it.closed = true;
    if (turnId) state.undo.push({ turnId, item, line });
    return state;
}

/** Upis nije prošao: stavka se vraća na spisak (ostaje otvorena). */
export function slotReopen(prev: SlotState, item: ItemId): SlotState {
    const state = clone(prev);
    const it = state.items.find(i => i.id === item);
    if (it) it.closed = false;
    state.flow = null;
    state.awaiting = false;
    return state;
}

/** „Poništi zadnje": skida red i ponovo otvara stavku; vraća turnId koji ERP poništava. */
export function slotUndo(prev: SlotState): { state: SlotState; turnId: string; line: string } | null {
    const last = prev.undo[prev.undo.length - 1];
    if (!last) return null;
    const state = clone(prev);
    state.undo.pop();
    const it = state.items.find(i => i.id === last.item);
    if (it) {
        const at = it.done.lastIndexOf(last.line);
        if (at >= 0) it.done.splice(at, 1);
        // Obilazak upisuje više naloga pod jedan red — vraća se cijeli, ostalo samo svoj upis.
        if (it.id !== 'orders') { it.closed = false; it.done = it.id === 'round' ? [] : it.done; }
        else if (!it.done.length) it.closed = false;
    }
    state.flow = null;
    state.taps++;
    return { state, turnId: last.turnId, line: last.line };
}

// ─── Obilazak: dugmad iz toka naloga ──────────────────────────────────

export interface FlowRowLite { name: string; state: 'done' | 'active' | 'blocked'; inProgress: number; done: number; total: number }

/**
 * Koliko kasnijih koraka stane u „Dalje od ovoga…" (uz „Sve gotovo" i „Nazad").
 * Duži tok zadrži prve i zadnja dva — završni koraci (montaža) moraju biti tu.
 */
const MAX_LATER = 8;
const KEEP_TAIL = 2;

/**
 * Sljedeći koraci naloga kao dugmad: procesi koji su na redu (najviše dva).
 * Proces koji je već u toku nudi samo „gotovo"; ostali „u toku" i „gotovo".
 * `later`: nezavršeni koraci iza njih, redom toka — kad je pogon dalje nego što ERP zna.
 */
export function roundOptions(rows: FlowRowLite[]): { last: string; options: RoundOption[]; later: string[] } {
    const real = rows.filter(r => r.name.trim().toLowerCase() !== 'rad');
    const lastDone = [...real].reverse().find(r => r.state === 'done');
    const active = real.filter(r => r.state === 'active' && r.done < r.total).slice(0, 2);
    const options: RoundOption[] = [];
    for (const r of active) {
        if (!r.inProgress) options.push({ label: `${r.name} u toku`, process: r.name, state: 'started' });
        options.push({ label: `${r.name} gotovo`, process: r.name, state: 'done' });
    }
    const all = real
        .filter(r => r.state !== 'done' && r.done < r.total && !active.includes(r))
        .map(r => r.name)
        .filter((n, i, list) => list.indexOf(n) === i);
    const later = all.length > MAX_LATER ? [...all.slice(0, MAX_LATER - KEEP_TAIL), ...all.slice(-KEEP_TAIL)] : all;
    const running = real.find(r => r.inProgress > 0);
    return { last: running ? `${running.name} u toku` : lastDone ? `${lastDone.name} ✓` : '', options: options.slice(0, 4), later };
}
