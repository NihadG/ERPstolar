/**
 * @jest-environment node
 */
// Termini 10:30 i 14:30 (docs/bot/plan-ritam-dana.md) — principi, izmišljena imena:
//   1. dvije poruke dnevno, ništa poslije 15:00; obavijesti samo u prvih 15 min termina
//   2. poruka je spisak; jedna stavka = samo pitanje; riješeno se vraća kao red s kvačicom
//   3. bez kucanja: svaki put kroz narudžbu je 2–4 dodira; „Ništa" je jedan
//   4. više projekata, zaliha i posao bez projekta su ravnopravni odgovori
//   5. zastario dodir ne mijenja ništa; Poništi vraća stavku
import {
    dayBookedLine, inNoticeWindow, newSlotState, orderLine, roundOptions, slotDone, slotDue, slotReopen, slotTap, slotText, slotUndo, slotView,
    type SlotItem, type SlotState,
} from '@/lib/assistant/slots';

const orders = (waiting: { orderId: string; label: string }[] = []): SlotItem => ({
    id: 'orders', done: [],
    data: {
        suppliers: [{ id: 's1', name: 'Okovi d.o.o.' }, { id: 's2', name: 'Ploče d.o.o.' }, { id: 's3', name: 'Staklorez' }],
        moreSuppliers: [{ id: 's4', name: 'Boje i lakovi' }],
        projects: [{ id: 'p1', name: 'Hotel na brdu' }, { id: 'p2', name: 'Kuća Amre' }],
        jobs: [{ id: 'j1', name: 'Stolovi za komšiju' }],
        waiting,
    },
});
const round = (): SlotItem => ({
    id: 'round', done: [],
    data: {
        orders: [
            { id: 'o1', name: 'Hotel — stolovi', last: 'Sklapanje kutija ✓', options: [{ label: 'Lakiranje u toku', process: 'Lakiranje', state: 'started' }, { label: 'Lakiranje gotovo', process: 'Lakiranje', state: 'done' }] },
            { id: 'o2', name: 'Kuća — vrata', last: '', options: [{ label: 'Okivanje gotovo', process: 'Okivanje', state: 'done' }] },
        ],
    },
});
const day = (): SlotItem => ({ id: 'day', done: [], data: { date: '2026-11-10', label: 'danas', workers: 13, orders: 5 } });

const texts = (s: SlotState) => slotView(s).buttons.flat().map(b => b.text);
/** Dodir po natpisu dugmeta — kao korisnik (tačan natpis ima prednost). */
function tap(s: SlotState, label: string) {
    const all = slotView(s).buttons.flat();
    const b = all.find(x => x.text === label) || all.find(x => x.text.includes(label));
    if (!b) throw new Error(`Nema dugmeta „${label}" među: ${texts(s).join(' | ')}`);
    return slotTap(s, b.action);
}

describe('kad bot šalje', () => {
    it.each([
        [10 * 60 + 29, null], [10 * 60 + 30, 'a'], [11 * 60 + 29, 'a'], [11 * 60 + 30, null],
        [14 * 60 + 29, null], [14 * 60 + 30, 'b'], [14 * 60 + 59, 'b'], [15 * 60, null], [20 * 60, null],
    ])('minuta %i → termin %s', (m, kind) => expect(slotDue(m)).toBe(kind));

    it('obavijesti (pošta, materijal) samo u prvih 15 minuta termina', () => {
        expect([10 * 60 + 30, 10 * 60 + 44, 14 * 60 + 30, 14 * 60 + 44].every(inNoticeWindow)).toBe(true);
        expect([9 * 60, 10 * 60 + 45, 12 * 60, 14 * 60 + 45, 16 * 60, 21 * 60].some(inNoticeWindow)).toBe(false);
    });
});

describe('poruka je spisak', () => {
    it('14:30: Upis dana, Obilazak, Narudžbe — po jedno dugme, bez pitanja', () => {
        const s = newSlotState('b', '2026-11-10', [day(), round(), orders()]);
        const v = slotView(s);
        expect(v.text).toBe('🕥 14:30 · još 3 od 3');
        expect(texts(s)).toEqual(['👷 Upis dana · 13 radnika', '🔧 Obilazak · 2 naloga', '🧾 Narudžbe']);
    });

    it('jedna stavka → poruka je samo pitanje, bez spiska i bez „Nazad"', () => {
        const s = newSlotState('a', '2026-11-10', [orders()]);
        expect(slotView(s).text).toBe('🕥 10:30\n\nJesi li šta naručio?');
        expect(texts(s)).toEqual(['Jesam', 'Ništa']);
    });

    it('„Ništa" je jedan dodir i ostavlja jedan red', () => {
        const out = tap(newSlotState('a', '2026-11-10', [orders()]), 'Ništa');
        expect(out.effect).toBeUndefined();
        expect(out.state.taps).toBe(1);
        expect(slotView(out.state).text).toBe('✅ 10:30 · sve gotovo\n\n✅ Ništa naručeno');
    });

    it('najviše 7 dugmadi po koraku i nijedan korak ne traži kucanje', () => {
        let s = newSlotState('a', '2026-11-10', [orders()]);
        s = tap(s, 'Jesam').state;
        expect(texts(s)).toEqual(['Okovi d.o.o.', 'Ploče d.o.o.', 'Staklorez', 'Drugi…']);
        s = tap(s, 'Okovi').state;
        expect(texts(s)).toEqual(['Hotel na brdu', 'Kuća Amre', 'Više projekata', 'Zaliha', 'Bez projekta']);
        expect(slotView(s).text).toContain('Okovi d.o.o. — za šta?');
    });
});

describe('narudžba: za šta je', () => {
    const upTo = (supplier = 'Okovi') => tap(tap(newSlotState('a', '2026-11-10', [orders()]), 'Jesam').state, supplier).state;

    it.each([
        ['Hotel na brdu', { kind: 'project', id: 'p1', name: 'Hotel na brdu' }],
        ['Više projekata', { kind: 'multi', name: 'više projekata' }],
        ['Zaliha', { kind: 'stock', name: 'zaliha' }],
    ])('„%s" → upis u 3 dodira', (label, target) => {
        const out = tap(upTo(), label);
        expect(out.effect).toEqual({ type: 'order', supplier: { id: 's1', name: 'Okovi d.o.o.' }, target });
        expect(out.state.taps).toBe(3);
    });

    it('dobavljač iza „Drugi…"', () => {
        const s = tap(tap(newSlotState('a', '2026-11-10', [orders()]), 'Jesam').state, 'Drugi').state;
        const out = tap(tap(s, 'Boje i lakovi').state, 'Zaliha');
        expect(out.effect).toMatchObject({ supplier: { id: 's4' }, target: { kind: 'stock' } });
    });

    it('Bez projekta → postojeći posao, preskoči, ili nov posao jednom rečenicom', () => {
        const job = tap(upTo(), 'Bez projekta').state;
        expect(texts(job)).toEqual(['Stolovi za komšiju', 'Novi posao', 'Preskoči']);
        expect(tap(job, 'Stolovi za komšiju').effect).toMatchObject({ target: { kind: 'job', id: 'j1' } });
        expect(tap(job, 'Preskoči').effect).toMatchObject({ target: { kind: 'none', name: 'bez projekta' } });

        const wait = tap(job, 'Novi posao');
        expect(wait.effect).toBeUndefined();
        expect(wait.state.awaiting).toBe(true);
        const named = slotText(wait.state, '  4 vrata   za komšiju ');
        expect(named?.effect).toEqual({ type: 'order', supplier: { id: 's1', name: 'Okovi d.o.o.' }, target: { kind: 'newjob', name: '4 vrata za komšiju' } });
        expect(named?.state.awaiting).toBe(false);
    });

    it('rečenica se ne hvata kad se ništa ne čeka', () => {
        expect(slotText(newSlotState('a', '2026-11-10', [orders()]), 'napomeni me sutra u 8')).toBeNull();
        expect(slotText(upTo(), 'napomeni me sutra u 8')).toBeNull();
    });

    it('poslije upisa: red s kvačicom i „Još jedna narudžba"', () => {
        const out = tap(upTo(), 'Zaliha');
        const line = orderLine('Okovi d.o.o.', { kind: 'stock', name: 'zaliha' });
        const s = slotDone(out.state, 'orders', line, 't1', true);
        expect(slotView(s).text).toBe('✅ 10:30 · sve gotovo\n\n✅ Naručeno: Okovi d.o.o. · zaliha');
        expect(texts(s)).toEqual(['➕ Još jedna narudžba', '↩️ Poništi zadnje']);
        // Druga narudžba počinje od dobavljača, bez „Jesi li…".
        expect(texts(tap(s, 'Još jedna').state)).toContain('Okovi d.o.o.');
    });

    it('upis nije prošao → stavka se vraća na spisak, bez reda', () => {
        const s = slotReopen(tap(upTo(), 'Zaliha').state, 'orders');
        expect(slotView(s).text).not.toContain('✅');
        expect(s.items[0].closed).toBe(false);
    });

    it('javljena narudžba koja čeka: prvo „je li stiglo?"', () => {
        const s = newSlotState('a', '2026-11-10', [orders([{ orderId: 'q1', label: 'Staklorez · Kuća Amre' }])]);
        expect(slotView(s).text).toContain('Staklorez · Kuća Amre — je li stiglo?');
        const got = tap(s, 'Stiglo');
        expect(got.effect).toEqual({ type: 'arrived', orderId: 'q1', label: 'Staklorez · Kuća Amre' });
        expect(texts(got.state)).toEqual(['Jesam', 'Ništa']);
        expect(tap(s, 'Još ne').effect).toBeUndefined();
    });
});

describe('obilazak', () => {
    it('jedan dodir po nalogu; „Isto" ne upisuje; na kraju jedan red', () => {
        let s = newSlotState('b', '2026-11-10', [round(), orders()]);
        s = tap(s, 'Obilazak').state;
        expect(slotView(s).text).toContain('Hotel — stolovi — dokle su stigli?\nNalog 1 od 2 · zadnje: Sklapanje kutija ✓');
        const first = tap(s, 'Lakiranje gotovo');
        expect(first.effect).toEqual({ type: 'progress', orderId: 'o1', orderName: 'Hotel — stolovi', process: 'Lakiranje', state: 'done' });
        const second = tap(first.state, 'Isto');
        expect(second.effect).toBeUndefined();
        expect(slotView(second.state).text).toBe('🕥 14:30 · još 1 od 2\n\n✅ Procesi: 1 ažurirano, 1 isto');
    });

    it('dugmad iz toka: proces na redu nudi „u toku" i „gotovo"; koji je u toku samo „gotovo"', () => {
        const rows = [
            { name: 'Krojenje iverala', state: 'done' as const, inProgress: 0, done: 3, total: 3 },
            { name: 'Kantiranje iverala', state: 'active' as const, inProgress: 2, done: 0, total: 3 },
            { name: 'Lakiranje', state: 'active' as const, inProgress: 0, done: 0, total: 1 },
            { name: 'Okivanje', state: 'blocked' as const, inProgress: 0, done: 0, total: 3 },
            { name: 'Rad', state: 'active' as const, inProgress: 0, done: 0, total: 3 },
        ];
        expect(roundOptions(rows)).toEqual({
            last: 'Kantiranje iverala u toku',
            options: [
                { label: 'Kantiranje iverala gotovo', process: 'Kantiranje iverala', state: 'done' },
                { label: 'Lakiranje u toku', process: 'Lakiranje', state: 'started' },
                { label: 'Lakiranje gotovo', process: 'Lakiranje', state: 'done' },
            ],
            later: ['Okivanje'],
        });
        // Nalog bez koraka na redu (ili samo „Rad") ne ulazi u obilazak.
        expect(roundOptions([{ name: 'Rad', state: 'active', inProgress: 0, done: 0, total: 1 }])).toMatchObject({ options: [], later: [] });
    });

    it('„Dalje od ovoga…": nezavršeni koraci iza onih na redu, redom toka; dug tok zadrži zadnja dva', () => {
        const step = (name: string, state: 'done' | 'active' | 'blocked') => ({ name, state, inProgress: 0, done: state === 'done' ? 2 : 0, total: 2 });
        const names = ['Krojenje', 'Kantiranje', 'Priprema furnira', 'Furniranje', 'Brušenje', 'Lakiranje', 'Okivanje', 'Sklapanje', 'Pakovanje', 'Završno sklapanje', 'Montaža'];
        const rows = names.map((n, i) => step(n, i === 0 ? 'done' : i === 1 ? 'active' : 'blocked'));
        const { later } = roundOptions(rows);
        expect(later).toHaveLength(8);
        expect(later.slice(0, 2)).toEqual(['Priprema furnira', 'Furniranje']);
        expect(later.slice(-2)).toEqual(['Završno sklapanje', 'Montaža']);
        expect(later).not.toContain('Kantiranje');
        // Kratak tok: svi kasniji koraci, bez završenih.
        expect(roundOptions(rows.slice(0, 4)).later).toEqual(['Priprema furnira', 'Furniranje']);
    });
});

describe('obilazak: pogon je dalje nego što ERP zna', () => {
    const withLater = (): SlotItem => {
        const r = round();
        if (r.id === 'round') r.data.orders[0].later = ['Okivanje', 'Montaža'];
        return r;
    };
    const open = () => tap(newSlotState('b', '2026-11-10', [withLater(), orders()]), 'Obilazak').state;

    it('uz korak na redu: „Isto", „Dalje od ovoga…" i „Sve gotovo"', () => {
        expect(texts(open())).toEqual(['Lakiranje u toku', 'Lakiranje gotovo', 'Isto', 'Dalje od ovoga…', 'Sve gotovo', '‹ Nazad']);
        // Nalog bez kasnijih koraka nema „Dalje"; stari termin (bez polja later) radi kao prije, uz „Sve gotovo".
        const second = tap(open(), 'Isto').state;
        expect(texts(second)).toEqual(['Okivanje gotovo', 'Isto', 'Sve gotovo', '‹ Nazad']);
    });

    it.each([
        ['Okivanje', 'Okivanje'],
        ['Montaža', 'Montaža'],
    ])('„Dalje od ovoga…" → %s = taj korak u toku (prethodni se upišu kao gotovi), pa sljedeći nalog', (label, process) => {
        const list = tap(open(), 'Dalje od ovoga…');
        expect(list.effect).toBeUndefined();
        expect(slotView(list.state).text).toContain('Hotel — stolovi — šta je sad u toku?\nKoraci prije toga se upišu kao gotovi.');
        expect(texts(list.state)).toEqual(['Okivanje', 'Montaža', 'Sve gotovo', '‹ Nazad']);
        const out = tap(list.state, label);
        expect(out.effect).toEqual({ type: 'progress', orderId: 'o1', orderName: 'Hotel — stolovi', process, state: 'started' });
        expect(slotView(out.state).text).toContain('Kuća — vrata — dokle su stigli?\nNalog 2 od 2');
    });

    it('„Sve gotovo" traži potvrdu; „Ne" vraća na nalog bez upisa; „Da" završava nalog bez procesa', () => {
        const ask = tap(open(), 'Sve gotovo');
        expect(ask.effect).toBeUndefined();
        expect(slotView(ask.state).text).toContain('Hotel — stolovi — sve gotovo?');
        expect(texts(ask.state)).toEqual(['Da, sve gotovo', 'Ne', '‹ Nazad']);
        const no = tap(ask.state, 'Ne');
        expect(no.effect).toBeUndefined();
        expect(texts(no.state)[0]).toBe('Lakiranje u toku');
        const yes = tap(ask.state, 'Da, sve gotovo');
        expect(yes.effect).toEqual({ type: 'progress', orderId: 'o1', orderName: 'Hotel — stolovi', state: 'done' });
        expect(slotView(yes.state).text).toContain('Nalog 2 od 2');
        // I iz liste kasnijih koraka.
        expect(texts(tap(tap(open(), 'Dalje od ovoga…').state, 'Sve gotovo').state)[0]).toBe('Da, sve gotovo');
    });

    it('„Nazad" iz podkoraka vraća na pitanje za isti nalog, ne na spisak', () => {
        for (const sub of ['Dalje od ovoga…', 'Sve gotovo']) {
            const back = tap(tap(open(), sub).state, 'Nazad');
            expect(back.effect).toBeUndefined();
            expect(slotView(back.state).text).toContain('Hotel — stolovi — dokle su stigli?');
        }
        // I kad je obilazak jedina stavka termina.
        const only = newSlotState('b', '2026-11-10', [withLater()]);
        expect(texts(only)).not.toContain('‹ Nazad');
        expect(texts(tap(only, 'Dalje od ovoga…').state)).toContain('‹ Nazad');
    });

    it('na kraju obilaska jedan red: „Dalje" i „Sve gotovo" se broje kao ažurirano', () => {
        let s = tap(tap(open(), 'Dalje od ovoga…').state, 'Montaža').state;
        s = tap(tap(s, 'Sve gotovo').state, 'Da, sve gotovo').state;
        expect(slotView(s).text).toBe('🕥 14:30 · još 1 od 2\n\n✅ Procesi: 2 ažurirano');
    });
});

describe('upis dana', () => {
    const open = () => tap(newSlotState('b', '2026-11-10', [day(), orders()]), 'Upis dana').state;

    it('„Sve isto" je jedan odgovor; red piše ERP kad upiše', () => {
        expect(slotView(open()).text).toContain('Je li danas sve kao prethodni radni dan?\n13 radnika na 5 naloga');
        const out = tap(open(), 'Sve isto');
        expect(out.effect).toEqual({ type: 'day_same', date: '2026-11-10', label: 'danas' });
        const s = slotDone(out.state, 'day', 'Dan upisan (danas): 13 radnika', 'dp-1', true);
        expect(slotView(s).text).toBe('🕥 14:30 · još 1 od 2\n\n✅ Dan upisan (danas): 13 radnika');
    });

    it('„Ima izmjena" → reci razliku, pa „Ostalo isto"; „Spisak" šalje stari prijedlog', () => {
        const diff = tap(open(), 'Ima izmjena');
        expect(diff.effect).toBeUndefined();
        expect(texts(diff.state)).toEqual(['Ostalo isto', 'Spisak', '‹ Nazad']);
        expect(tap(diff.state, 'Ostalo isto').effect).toMatchObject({ type: 'day_same' });
        expect(tap(diff.state, 'Spisak').effect).toEqual({ type: 'day_list', date: '2026-11-10' });
    });
});

describe('upis dana vidi ono što je već rečeno', () => {
    const partly = (rest: string[], workers = rest.length): SlotItem =>
        ({ id: 'day', done: [], data: { date: '2026-11-10', label: 'danas', workers, orders: 2, booked: 9, rest } });

    it('dio dana upisan: spisak kaže „još N", pitanje je samo za ostale, po imenu', () => {
        const s = newSlotState('b', '2026-11-10', [partly(['Amer', 'Edin']), orders()]);
        expect(texts(s)[0]).toBe('👷 Upis dana · još 2 radnika');
        const q = tap(s, 'Upis dana').state;
        expect(slotView(q).text).toContain('Upisano danas: 9 radnika. Ostali kao prethodni radni dan?\nOstali: Amer, Edin');
        expect(texts(q)).toEqual(['Ostali isto', 'Ima izmjena', '‹ Nazad']);
        expect(tap(q, 'Ostali isto').effect).toEqual({ type: 'day_same', date: '2026-11-10', label: 'danas' });
    });

    it.each([
        [['Amer', 'Edin', 'Senad', 'Lejla'], 6, 'Ostali: Amer, Edin, Senad, Lejla i još 2'],
        [['Amer'], 1, 'Ostali: Amer'],
    ])('imena ostalih: %j od %i', (rest, workers, line) => {
        const q = tap(newSlotState('b', '2026-11-10', [partly(rest, workers), orders()]), 'Upis dana').state;
        expect(slotView(q).text).toContain(line);
    });

    it('sav dan već upisan: stavka stiže zatvorena, s redom i bez dugmeta', () => {
        const d = { date: '2026-11-10', label: 'danas', workers: 0, orders: 0, booked: 11 };
        const s = newSlotState('b', '2026-11-10', [{ id: 'day', data: d, done: [dayBookedLine(d)], closed: true }, orders()]);
        expect(slotView(s).text).toBe('🕥 14:30 · još 1 od 2\n\n✅ Dan već upisan: 11 radnika');
        expect(texts(s)).toEqual(['🧾 Narudžbe']);
        expect(dayBookedLine({ ...d, label: 'jučer', booked: 1 })).toBe('Dan već upisan (jučer): 1 radnik');
    });

    it('napomena (tri termina bez odgovora) stoji ispod naslova', () => {
        const s = newSlotState('b', '2026-11-10', [day(), orders()], 'Tri termina bez odgovora.');
        expect(slotView(s).text).toBe('🕥 14:30 · još 2 od 2\nTri termina bez odgovora.');
    });
});

describe('zastarjeli dodiri i poništavanje', () => {
    it('dodir koji više ne važi ne mijenja stanje', () => {
        const s = newSlotState('b', '2026-11-10', [day(), orders()]);
        for (const a of ['p0', 'b', 'o7', 'x', 'u']) {
            const out = slotTap(s, a);
            expect(out.state).toBe(s);
            expect(out.toast).toBeTruthy();
        }
        // Zatvoren upis dana se ne otvara ponovo.
        const closed = slotDone(s, 'day', 'Dan upisan (danas): 13 radnika', 'dp-1', true);
        expect(slotTap(closed, 'o0').state).toBe(closed);
    });

    it('„Nazad" vraća na spisak bez upisa', () => {
        const s = tap(newSlotState('b', '2026-11-10', [day(), orders()]), 'Narudžbe').state;
        const back = tap(s, 'Nazad');
        expect(back.effect).toBeUndefined();
        expect(slotView(back.state).text).toBe('🕥 14:30 · još 2 od 2');
    });

    it('Poništi zadnje: skida red, vraća stavku i kaže šta ERP poništava', () => {
        let s = newSlotState('b', '2026-11-10', [day(), orders()]);
        s = slotDone(s, 'day', 'Dan upisan (danas): 13 radnika', 'dp-1', true);
        s = slotDone(s, 'orders', 'Naručeno: Okovi d.o.o. · zaliha', 't2', true);
        const u1 = slotUndo(s)!;
        expect(u1.turnId).toBe('t2');
        expect(slotView(u1.state).text).toBe('🕥 14:30 · još 1 od 2\n\n✅ Dan upisan (danas): 13 radnika');
        const u2 = slotUndo(u1.state)!;
        expect(u2.turnId).toBe('dp-1');
        expect(texts(u2.state)).toEqual(['👷 Upis dana · 13 radnika', '🧾 Narudžbe']);
        expect(slotUndo(u2.state)).toBeNull();
    });
});
