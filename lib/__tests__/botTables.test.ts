/**
 * @jest-environment node
 */
// Tabele za bota: model kaže izvor i filter, ERP složi kolone, redove, grupe
// i zbir i pošalje PDF. Tri dijela:
//   • stvarni slučajevi iz revizije 01.11.2026 (P-019…P-022, izmišljena imena),
//   • SVOJSTVA nad nasumičnim nezgodnim podacima i različitim načinima pisanja
//     kolona — šta mora važiti uvijek, ne samo za jedan primjer,
//   • tok kroz bota (model iz skripte, memorijska baza) i PDF.

type Step = { calls?: { name: string; args: Record<string, unknown> }[]; text?: string };
const mockScript: Step[] = [];
const mockSent: any[] = [];
let mockToolSeq = 0;

jest.mock('@anthropic-ai/sdk', () => {
    class APIError extends Error { status = 500; }
    class Anthropic {
        static APIError = APIError;
        messages = {
            create: async (params: any) => {
                mockSent.push(JSON.parse(JSON.stringify(params)));
                const step = mockScript.shift();
                if (!step) throw new Error('skripta je prazna');
                const content = [
                    ...(step.text ? [{ type: 'text', text: step.text }] : []),
                    ...(step.calls || []).map(c => ({ type: 'tool_use', id: `tu${++mockToolSeq}`, name: c.name, input: c.args })),
                ];
                return {
                    content,
                    stop_reason: step.calls?.length ? 'tool_use' : 'end_turn',
                    usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
                };
            },
        };
    }
    return { __esModule: true, default: Anthropic };
});

jest.mock('@/lib/server/firebaseAdmin', () => require('@/lib/testing/fakeFirestore').firebaseAdminMock);

import { fakeStore as mockStore } from '@/lib/testing/fakeFirestore';
import { runAssistant } from '@/lib/assistant/brain';
import { messageIntent } from '@/lib/assistant/intent';
import { filterNotebook, letterOf } from '@/lib/assistant/memoryRules';
import { isCorrection } from '@/lib/assistant/signals';
import { runTool, type ToolEnv } from '@/lib/assistant/tools';
import { toolSetFor } from '@/lib/assistant/toolRouting';
import { buildTablePdf, fitWidths } from '@/lib/server/tablePdf';
import { requestedColumns } from '@/lib/tables/columns';
import type { EngineResult } from '@/lib/tables/engine';
import { groundedScope, saidIn } from '@/lib/tables/grounding';
import { dimsOf, materialsTable, notebookTable, type TableAsk, type TableMaterialRow } from '@/lib/tables/sources';
import { rowsLabel, type TableDoc } from '@/lib/tables/table';
import type { MemoryItem } from '@/lib/types';

const NOW = new Date('2026-11-01T10:00:00Z');
const DAY = '2026-11-01';
const since = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.`;

const ask = (text: string, extra: Partial<TableAsk> = {}): TableAsk => ({
    textColumns: requestedColumns(text), modelColumns: [], filters: [], said: saidIn(text), ...extra,
});
const ok = (r: EngineResult): TableDoc => {
    if (!r.ok) throw new Error(r.error);
    return r.table;
};

const mem = (id: string, o: Partial<MemoryItem>): MemoryItem => ({
    Item_ID: id, Organization_ID: 'org1', Owner_UID: 'u1', Title: '', Subject: '', Links: [],
    State: 'open', State_Label: 'u stanu, nije postavljeno', State_Key: 'nije_postavljeno',
    Tags: [], History: [], Source_Entry_IDs: [], Created_At: '2026-10-20T08:00:00Z', Updated_At: '2026-10-20T08:00:00Z', ...o,
});

// Prepričano stanje iz revizije 01.11. (oblik podataka kao u bazi, bez stvarnih imena).
const NOTEBOOK: MemoryItem[] = [
    mem('m1', { Title: 'Ogledalo 1000x1350 za C403', Subject: 'ogledalo', Quantity: 1, Unit: 'kom', Location: 'C403', Spec: '1000x1350', State_Key: undefined, State_Label: 'fali' }),
    mem('m2', { Title: 'Ogledala za C408 (sva)', Subject: 'ogledalo', Location: 'C408', State_Key: undefined, State_Label: 'fale sva ogledala' }),
    mem('m3', { Title: 'Ogledalo za C502', Subject: 'ogledalo', Quantity: 1, Unit: 'kom', Location: 'Hodnik C5', State_Key: undefined, State_Label: 'na hodniku, za C502' }),
    mem('m4', { Title: 'Umivaonik za E501', Subject: 'umivaonik', Location: 'Hodnik C5', State_Key: 'ceka', State_Label: 'čeka postavljanje' }),
    mem('m5', { Title: 'Ogledalo 1000x1350', Subject: 'ogledalo', Quantity: 1, Location: 'E004' }),
    mem('m6', { Title: 'Ogledalo 1350x1000', Subject: 'ogledalo', Quantity: 1, Location: 'E101', State_Key: 'fali', State_Label: 'fali' }),
    mem('m7', { Title: 'Ogledalo š 800', Subject: 'ogledalo', Quantity: 1, Location: 'E308' }),
    mem('m8', { Title: 'Ogledalo 1000x1350', Subject: 'ogledalo', Quantity: 2, Unit: 'kom', Location: 'Hodnik E4', State_Key: 'ceka', State_Label: 'čeka postavljanje' }),
    mem('m9', { Title: 'Ogledalo 1100x1000', Subject: 'ogledalo', Quantity: 1, Location: 'E108', State_Key: 'pogresno', State_Label: 'pogrešno postavljeno' }),
    mem('m10', { Title: 'Ogledalo 1000x1350', Subject: 'ogledalo', Quantity: 1, Location: 'E108', State: 'resolved', State_Key: 'postavljeno', State_Label: 'postavljeno' }),
    mem('m11', { Title: 'Ogledalo 1000x800', Subject: 'ogledalo', Quantity: 1, Location: 'E007', State_Key: 'info', State_Label: 'ogledalo 1000x800' }),
    mem('m12', { Title: 'Lajsna', Subject: 'lajsna', Location: 'E003', State_Key: 'fali', State_Label: 'fali' }),
];

const PRVA = 'Napravi mi tabelu svih ogledala i umivaonika, razvrstaj u kolone, stan ogledalo/umivaonik, fali/nije montirano/ima u stanu, dimenzije, komada';
const NENARUCENO = 'Tabelu nenaručenih materijala u tabeli materijal, kolicina, dobavljac ili sta god drugo';

describe('revizija 01.11.: stanovi i ogledala (P-019, P-020)', () => {
    const t = ok(notebookTable(NOTEBOOK, { subjects: ['ogledalo', 'umivaonik'], locations: [], state: 'otvoreno' }, ask(PRVA), { since, day: DAY }));

    it('svih 5 kolona: „stan ogledalo/umivaonik" bez zareza su dvije, duga kolona stanja nije izgubljena', () => {
        expect(t.columns.map(c => [c.key, c.label])).toEqual([
            ['stan', 'Stan'], ['predmet', 'Ogledalo/umivaonik'], ['stanje', 'Fali/nije montirano/ima u stanu'], ['mjere', 'Dimenzije'], ['kolicina', 'Komada'],
        ]);
        expect(t.notes.join(' ')).not.toMatch(/ne znam/);
    });

    it('umivaonik za E501 s Hodnika C5 je u E lameli, uz napomenu gdje stoji; „za C403" se ne ponavlja', () => {
        const c = t.groups.find(g => g.label === 'C lamela')!.rows;
        const e = t.groups.find(g => g.label === 'E lamela')!.rows;
        expect(c.map(r => r[0])).toEqual(['C403', 'C408', 'C502 (Hodnik C5)']);
        expect(e.map(r => r[0])).toEqual(['E004', 'E101', 'E108', 'E308', 'E501 (Hodnik C5)', 'Hodnik E4']);
        expect(c[0]).toEqual(['C403', 'Ogledalo', 'fali', '1000x1350', '1 kom']);
        expect(e.find(r => r[0] === 'E501 (Hodnik C5)')).toEqual(['E501 (Hodnik C5)', 'Umivaonik', 'čeka postavljanje', '', '']);
    });

    it('nepoznata količina ostaje prazna i ne ulazi u zbir; „š 800" je mjera; praznine se jave', () => {
        expect(t.groups.flatMap(g => g.rows).find(r => r[1] === 'Ogledala (sva)')).toEqual(['C408', 'Ogledala (sva)', 'fale sva ogledala', '', '']);
        expect(t.groups.flatMap(g => g.rows).find(r => r[0] === 'E308')).toEqual(['E308', 'Ogledalo', 'u stanu, nije postavljeno', 'š 800', '1 kom']);
        expect(t.total).toEqual(['', '', '', '', '8 kom']);
        expect(t.notes).toContain('U podacima nema — bez dimenzija: 3, bez količine: 2.');
    });

    it('„tabela loša … ne piše fali": modelovo „sve stavke" nije rečeno → ostaje nije postavljeno, uz napomenu', () => {
        const text = 'Tabela losa, u c lameli ima i od e lamele. Onda za e lamelu ne pisu stanovi, onda upste ne lise fali li ili nesto drugo';
        expect(groundedScope('biljeska', 'sve', 'otvoreno', text)).toEqual({ value: 'otvoreno', note: 'Stanje „sve" nije rečeno — prikazano podrazumijevano.' });
        expect(groundedScope('biljeska', 'postavljeno', 'otvoreno', 'tabela svih montiranih ogledala').value).toBe('postavljeno');
        expect(isCorrection(text, PRVA)).toBe(true);
        // Modelove kolone iz te poruke (razmaci oko „/") — stanje ostaje jedna kolona.
        const again = ok(notebookTable(NOTEBOOK, { subjects: ['ogledalo', 'umivaonik'], locations: [], state: 'otvoreno' },
            ask(text, { modelColumns: ['stan', 'ogledalo/umivaonik', 'stanje (fali / nije montirano / ima u stanu)', 'dimenzije', 'komada'], said: saidIn(`${PRVA}\n${text}`) }), { since, day: DAY }));
        expect(again.columns.map(c => c.key)).toEqual(['stan', 'predmet', 'stanje', 'mjere', 'kolicina']);
        expect(isCorrection('Kakve veze ima hodnik sa Selimom', 'Napravi mi tabelu')).toBe(true);
        expect(isCorrection('Napravi mi tabelu materijala', 'ok')).toBe(false);
    });
});

describe('revizija 01.11.: filter koji niko nije rekao (P-021)', () => {
    it('„šta trebam kod Selima provjeriti" s predmetom umivaonik → odbijeno, model dobije razlog', () => {
        const res = notebookTable(NOTEBOOK, { subjects: ['umivaonik'], locations: [], state: 'otvoreno' }, ask('Napravi mi tabelu sta sve trebam kod Selima provjeriti'), { since, day: DAY });
        expect(res).toEqual({ ok: false, error: '„umivaonik" korisnik nije rekao — ne dodaji to u tabelu. Ako za traženo nema izvora, reci to.' });
    });

    it('rečeno u drugom obliku i u ranijoj poruci prolazi; lamela i šifra stana', () => {
        const said = saidIn('daj mi umivaonike\nsamo na e lameli i stan c 502');
        expect(['umivaonik', 'E', 'C502', 'c502'].every(said)).toBe(true);
        expect(['ogledalo', 'B', 'E308'].some(said)).toBe(false);
    });

    it('generički filter: nepoznato polje i nerečena vrijednost → greška; rečena → filtrira', () => {
        const text = 'tabela ogledala bez onih na hodniku';
        const base = { subjects: ['ogledalo'], locations: [], state: 'otvoreno' };
        expect(notebookTable(NOTEBOOK, base, ask(text, { filters: [{ field: 'boja', values: ['crna'] }] }), { since, day: DAY }))
            .toMatchObject({ ok: false, error: expect.stringMatching(/^Polje „boja" ne postoji/) });
        expect(notebookTable(NOTEBOOK, base, ask(text, { filters: [{ field: 'gdje stoji', values: ['kombi'] }] }), { since, day: DAY }))
            .toMatchObject({ ok: false, error: expect.stringMatching(/„kombi" korisnik nije rekao/) });
        const t = ok(notebookTable(NOTEBOOK, base, ask(text, { filters: [{ field: 'gdje stoji', values: ['hodnik'], not: true }] }), { since, day: DAY }));
        expect(t.groups.flatMap(g => g.rows).map(r => r[0])).not.toContain('Hodnik E4');
        expect(t.rowCount).toBe(6);
    });
});

describe('grupisanje i redoslijed po izboru', () => {
    it('„po stanju", „bez grupa", „po količini"', () => {
        const base = { subjects: ['ogledalo'], locations: [], state: 'otvoreno' };
        const byState = ok(notebookTable(NOTEBOOK, base, ask('tabela ogledala po stanju', { groupBy: 'stanje' }), { since, day: DAY }));
        expect(byState.groups.map(g => g.label)).toEqual(['čeka postavljanje', 'fale sva ogledala', 'fali', 'na hodniku, za C502', 'pogrešno postavljeno', 'u stanu, nije postavljeno']);
        const flat = ok(notebookTable(NOTEBOOK, base, ask('tabela ogledala', { groupBy: 'ništa', sort: 'količina' }), { since, day: DAY }));
        expect(flat.groups).toHaveLength(1);
        expect(flat.groups[0].rows[0][0]).toBe('Hodnik E4');   // 2 kom prvo
    });
});

// ─── SVOJSTVA nad nasumičnim podacima ─────────────────────────────────

/** Ponovljiv generator (isti podaci u svakom pokretanju). */
function rng(seed: number) {
    let s = seed;
    return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
}

function randomNotebook(r: () => number, n: number): MemoryItem[] {
    const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
    const subjects = ['ogledalo', 'umivaonik', 'lajsna', 'ormar', 'polica'];
    const states: [string | undefined, string][] = [['fali', 'fali'], ['nije_postavljeno', 'u stanu, nije postavljeno'], ['ceka', 'čeka postavljanje'], ['pogresno', 'pogrešno postavljeno, treba 650x460'], [undefined, 'na hodniku']];
    return Array.from({ length: n }, (_, i) => {
        const subject = pick(subjects);
        const letter = pick(['A', 'C', 'E']);
        const flat = `${letter}${pick(['0', '1', '2', '3', '5'])}0${1 + Math.floor(r() * 9)}`;
        const where = pick(['flat', 'flat', 'hall', 'kombi', 'none']);
        const dims = pick(['x', 'x', 'w', 'spec', 'none']);
        const d = `${500 + Math.floor(r() * 10) * 50}x${600 + Math.floor(r() * 10) * 50}`;
        const forFlat = where === 'hall' || where === 'kombi' ? ` za ${flat}` : '';
        const [key, label] = pick(states);
        return mem(`r${i}`, {
            Subject: subject,
            Title: `${subject[0].toUpperCase()}${subject.slice(1)}${dims === 'x' ? ` ${d}` : dims === 'w' ? ` š ${d.slice(0, 3)}` : ''}${forFlat}`,
            Spec: dims === 'spec' ? `${d}, bijelo` : undefined,
            Location: where === 'flat' ? flat : where === 'hall' ? `Hodnik ${pick(['A', 'C', 'E'])}${1 + Math.floor(r() * 5)}` : where === 'kombi' ? 'Kombi' : undefined,
            Quantity: r() < 0.25 ? undefined : 1 + Math.floor(r() * 4),
            Unit: 'kom',
            State: r() < 0.15 ? 'resolved' : 'open',
            State_Key: key, State_Label: label,
        });
    });
}

/** Isti zahtjev napisan na razne načine: [kako je rečeno, očekivani ključ]. */
const PHRASINGS: [string, string][][] = [
    [['stan', 'stan'], ['stanovi', 'stan'], ['lokacija', 'stan'], ['broj stana', 'stan']],
    [['ogledalo/umivaonik', 'predmet'], ['predmet', 'predmet'], ['stvar', 'predmet'], ['umivaonik ili ogledalo', 'predmet']],
    [['dimenzije', 'mjere'], ['mjere', 'mjere'], ['veličina', 'mjere'], ['Dimenzija', 'mjere']],
    [['komada', 'kolicina'], ['količina', 'kolicina'], ['kolicina', 'kolicina'], ['broj komada', 'kolicina'], ['koliko', 'kolicina']],
    [['fali/nije montirano/ima u stanu', 'stanje'], ['stanje', 'stanje'], ['status', 'stanje'], ['postavljeno ili ne', 'stanje'], ['fali ili ceka', 'stanje']],
    [['napomena', 'napomena'], ['opis', 'napomena'], ['komentar', 'napomena']],
];

describe('svojstva: bilježnica, bilo koji podaci i bilo koji način pisanja', () => {
    const r = rng(7);
    const cases = Array.from({ length: 60 }, (_, i) => {
        const items = randomNotebook(r, 15 + Math.floor(r() * 30));
        const order = [...PHRASINGS].sort(() => r() - 0.5).slice(0, 3 + Math.floor(r() * 4));
        const said = order.map(variants => variants[Math.floor(r() * variants.length)]);
        const sep = [', ', ' ', ', '][i % 3];
        return { items, said, text: `napravi tabelu ogledala i umivaonika u kolonama ${said.map(s => s[0]).join(sep)}` };
    });

    it.each(cases.map((c, i) => [i, c]))('slučaj %i: nijedna riječ ne nestaje, redovi i zbir kao u bazi', (_i, c) => {
        const { items, said, text } = c as typeof cases[number];
        const filter = { subjects: ['ogledalo', 'umivaonik'], locations: [], state: 'otvoreno' };
        const t = ok(notebookTable(items, filter, ask(text), { since, day: DAY }));

        // 1) Svaka rečena kolona je prepoznata, istim redom, ništa nepoznato.
        expect(t.columns.map(x => x.key)).toEqual(said.map(s => s[1]));
        expect(t.notes.join(' ')).not.toMatch(/ne znam/);

        // 2) Redova tačno koliko ih baza ima po istom filteru (nezavisno prebrojano).
        const oracle = items.filter(m => m.State === 'open' && m.State_Key !== 'info' && ['ogledalo', 'umivaonik'].includes(m.Subject));
        expect(t.rowCount).toBe(oracle.length);
        expect(t.groups.reduce((s, g) => s + g.rows.length, 0)).toBe(oracle.length);

        // 3) Zbir količine = zbir poznatih količina; nepoznata nije 1.
        const qi = t.columns.findIndex(x => x.key === 'kolicina');
        if (qi >= 0 && oracle.some(m => m.Quantity != null)) {
            expect(t.total?.[qi]).toBe(`${oracle.reduce((s, m) => s + (m.Quantity ?? 0), 0)} kom`);
        }

        // 4) Lamela grupe = lamela stana za koji je stvar (i kad stoji na hodniku drugog ulaza).
        if (!t.columns.some(x => x.key === 'lamela') && new Set(oracle.map(letterOf)).size > 1) {
            const expected = Array.from(new Set(oracle.map(m => (letterOf(m) ? `${letterOf(m)} lamela` : 'Bez lamele')))).sort();
            expect(t.groups.map(g => g.label).sort()).toEqual(expected);
        }
        for (const m of oracle.filter(x => / za [ACE]\d+/.test(x.Title))) {
            expect(letterOf(m)).toBe(/ za ([ACE])/.exec(m.Title)![1]);
        }

        // 5) Prijavljene praznine odgovaraju praznim ćelijama.
        for (const [key, gap] of [['mjere', 'bez dimenzija'], ['kolicina', 'bez količine']]) {
            const ci = t.columns.findIndex(x => x.key === key);
            if (ci < 0) continue;
            const empty = t.groups.flatMap(g => g.rows).filter(row => !row[ci]).length;
            const note = t.notes.find(n => n.includes(gap));
            expect(note ? Number(new RegExp(`${gap}: (\\d+)`).exec(note)![1]) : 0).toBe(empty);
        }
    });

    it('mjere se nađu gdje god su upisane (naslov, „š", opis)', () => {
        expect(dimsOf(mem('a', { Title: 'Ogledalo 700x900' }))).toBe('700x900');
        expect(dimsOf(mem('b', { Title: 'Lajsna š 80' }))).toBe('š 80');
        expect(dimsOf(mem('c', { Title: 'Ogledalo', Spec: '70 puta 90, bijelo' }))).toBe('700x900');
        expect(dimsOf(mem('d', { Title: 'Ogledalo za C502' }))).toBe('');
    });
});

const mat = (o: Partial<TableMaterialRow>): TableMaterialRow => ({
    name: 'Iveral U960 ST9', unit: 'm²', supplier: 'Iverpan', unitPrice: 20, productName: 'Kuhinja', projectId: 'p1', projectName: 'Grbavica',
    needed: 10, onStock: 0, ordered: 0, received: 0, inDrafts: 0, toOrder: 10, status: 'Nije naručeno', ...o,
});

describe('materijali', () => {
    const rows = [
        mat({}),
        mat({ productName: 'Ormar', needed: 6, toOrder: 6 }),
        mat({ name: 'Šarke Blum CLIP top', unit: 'kom', supplier: 'Blum', unitPrice: 6.4, needed: 24, toOrder: 0, ordered: 24, status: 'Naručeno' }),
        mat({ name: 'Ručke 128 mm', unit: 'kom', supplier: 'Häfele', unitPrice: 3, projectId: 'p2', projectName: 'Budnja', needed: 12, toOrder: 12, inDrafts: 12 }),
        mat({ name: 'Kant traka', unit: 'm', supplier: '', unitPrice: 1, needed: 30, toOrder: 30 }),
    ];
    const scope = 'projekti na kojima se radi (2)';

    it('nenaručeno: sabrano po materijalu, grupe po projektu, sortirano po dobavljaču, praznine i nacrti', () => {
        const t = ok(materialsTable(rows, { status: 'za_naruciti', scope }, ask(NENARUCENO), { day: DAY }));
        expect(t.columns.map(c => c.label)).toEqual(['Materijal', 'Količina', 'Dobavljač']);
        expect(t.groups).toEqual([
            { label: 'Budnja', rows: [['Ručke 128 mm', '12 kom', 'Häfele']] },
            { label: 'Grbavica', rows: [['Iveral U960 ST9', '16 m²', 'Iverpan'], ['Kant traka', '30 m', '']] },
        ]);
        expect(t.total).toBeNull();
        expect(t.subtitle).toBe('projekti na kojima se radi (2) · 3 reda · količina = još za naručiti');
        expect(t.notes).toEqual(['U podacima nema — bez dobavljača: 1.', 'Dio je već u nacrtu narudžbe (nije poslano): 1 stavka.']);
    });

    it('najduža riječ: „za naručiti" je količina, „naručeno" svoja kolona; bez zareza isto', () => {
        for (const text of ['u kolonama materijal, za naručiti, naručeno', 'u kolonama materijal za naručiti naručeno']) {
            expect(ok(materialsTable(rows, { status: 'za_naruciti', scope }, ask(text), { day: DAY })).columns.map(c => c.key)).toEqual(['materijal', 'kolicina', 'naruceno']);
        }
    });

    it('nerečen dobavljač → greška; rečen → filtrira; iznos sa zbirom u KM; kolona projekta ukida grupe', () => {
        expect(materialsTable(rows, { status: 'naruceno', supplier: 'Blum', scope }, ask('tabela naručenog'), { day: DAY })).toMatchObject({ ok: false });
        const t = ok(materialsTable(rows, { status: 'naruceno', supplier: 'blum', scope: 'Grbavica' },
            ask('tabela naručenog kod bluma u kolonama materijal, koliko, projekat, iznos'), { day: DAY }));
        expect(t.groups).toEqual([{ label: '', rows: [['Šarke Blum CLIP top', '24 kom', 'Grbavica', '153.60 KM']] }]);
        expect(t.total).toEqual(['', '24 kom', '', '153.60 KM']);
    });

    it('svojstvo: zbir „za naručiti" jednog materijala = zbir po proizvodima, s kolonom proizvoda ili bez nje', () => {
        const r = rng(11);
        for (let k = 0; k < 30; k++) {
            const many = Array.from({ length: 5 + Math.floor(r() * 10) }, (_, i) => mat({ productName: `P${i % 4}`, toOrder: Math.floor(r() * 5), needed: 5 }));
            const expected = many.reduce((s, m) => s + m.toOrder, 0);
            for (const cols of ['u kolonama materijal, količina', 'u kolonama materijal, proizvod, količina']) {
                const res = materialsTable(many, { status: 'za_naruciti', scope: 'x' }, ask(cols), { day: DAY });
                if (!expected) { expect(ok(res).rowCount).toBe(0); continue; }
                const t = ok(res);
                expect(t.total?.[t.columns.findIndex(c => c.key === 'kolicina')]).toBe(`${expected} m²`);
            }
        }
    });
});

describe('ostalo', () => {
    it('broj redova po padežu', () => {
        expect([1, 3, 5, 11, 21, 22, 112].map(rowsLabel)).toEqual(['1 red', '3 reda', '5 redova', '11 redova', '21 red', '22 reda', '112 redova']);
    });

    it('nabrajanje kolona: zarez nije obavezan, „ili šta god" otpada, nema „kolona" → ništa', () => {
        expect(requestedColumns(PRVA)).toEqual(['stan ogledalo/umivaonik', 'fali/nije montirano/ima u stanu', 'dimenzije', 'komada']);
        expect(requestedColumns(NENARUCENO)).toEqual(['materijal', 'kolicina', 'dobavljac']);
        expect(requestedColumns('napravi tabelu nenaručenih materijala')).toEqual([]);
    });
});

describe('PDF tabele', () => {
    const doc = (columns: number, rows: number): TableDoc => ({
        title: 'Bilježnica — ogledalo', subtitle: 'nije postavljeno · č ć đ š ž',
        columns: Array.from({ length: columns }, (_, i) => ({ key: `k${i}`, label: `Kolona ${i}`, align: i === 1 ? 'right' : 'left' })),
        groups: [{ label: 'E lamela', rows: Array.from({ length: rows }, (_, r) => Array.from({ length: columns }, (_, c) => `Ćelija ${r}/${c} ${c === 0 ? 'dugačak tekst koji se mora prelomiti u više redova jer je preširok za kolonu' : ''}`)) }],
        total: null, notes: ['Napomena ispod tabele.'], rowCount: rows, fileName: 'x.pdf',
    });

    it('pravi PDF s našim slovima, više strana kad je dugo, položeno kad je široko', () => {
        const pdf = buildTablePdf(doc(5, 120), { name: 'Firma d.o.o.' }, '01.11.2026.');
        expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
        const text = pdf.toString('latin1');
        expect((text.match(/\/Type \/Page\b/g) || []).length).toBeGreaterThan(2);
        expect(text).toMatch(/\/MediaBox \[0 0 595\.2\d* 841\.8\d*\]/);
        expect(buildTablePdf(doc(7, 3), {}, '01.11.2026.').toString('latin1')).toMatch(/\/MediaBox \[0 0 841\.8\d* 595\.2\d*\]/);
    });

    it('širine: uske kolone ostaju, široke dijele ostatak; višak ide tekstualnim', () => {
        expect(fitWidths([10, 100, 100], 110, [false, true, true])).toEqual([10, 50, 50]);
        expect(fitWidths([10, 20, 30], 100, [false, true, false])).toEqual([10, 60, 30]);
    });
});

describe('tabela kroz bota', () => {
    const intent = (text: string) => messageIntent(text, [], { dims: [], widths: [], locations: [] });

    it('„tabela" je čitanje: nije narudžba ni bilježnica, alati za pitanje', () => {
        expect(intent(NENARUCENO)).toMatchObject({ kinds: ['table'], expectsWrite: false });
        expect(intent('napravi tabelu u stanu E104 ogledala')).toMatchObject({ kinds: ['table'], expectsWrite: false });
        expect(toolSetFor(['table'])).toBe('question');
        expect(intent('pošalji Amri tabelu mailom').kinds).toEqual(['email']);
    });

    beforeAll(() => {
        process.env.ANTHROPIC_API_KEY = 'test';
        process.env.ASSISTANT_TIMEZONE = 'Europe/Sarajevo';
        NOTEBOOK.forEach(m => mockStore.set(`memory_items/${m.Item_ID}`, m));
        mockStore.set('projects/p1', { Project_ID: 'p1', Name: 'Grbavica', Status: 'U proizvodnji', Organization_ID: 'org1' });
        mockStore.set('projects/p2', { Project_ID: 'p2', Name: 'Budnja', Status: 'Nacrt', Organization_ID: 'org1' });       // nalog prije ponude
        mockStore.set('projects/p3', { Project_ID: 'p3', Name: 'Ponuda Ilidža', Status: 'Ponuđeno', Organization_ID: 'org1' });
        mockStore.set('projects/p4', { Project_ID: 'p4', Name: 'Stari', Status: 'Završeno', Organization_ID: 'org1' });
        mockStore.set('work_orders/w2', { Work_Order_ID: 'w2', Status: 'U toku', Organization_ID: 'org1' });
        mockStore.set('work_order_items/wi2', { Work_Order_ID: 'w2', Project_ID: 'p2', Product_ID: 'pr2', Organization_ID: 'org1' });
        mockStore.set('products/pr1', { Product_ID: 'pr1', Project_ID: 'p1', Name: 'Kuhinja', Quantity: 2, Organization_ID: 'org1' });
        mockStore.set('products/pr2', { Product_ID: 'pr2', Project_ID: 'p2', Name: 'Vrata', Quantity: 1, Organization_ID: 'org1' });
        mockStore.set('products/pr3', { Product_ID: 'pr3', Project_ID: 'p3', Name: 'Ormar', Quantity: 1, Organization_ID: 'org1' });
        // Sastavnica je PO KOMADU: 5 m² × 2 kuhinje = 10 m²
        mockStore.set('product_materials/a', { ID: 'a', Product_ID: 'pr1', Material_Name: 'Iveral U960 ST9', Quantity: 5, Unit: 'm²', Supplier: 'Iverpan', Unit_Price: 20, Status: 'Nije naručeno', Organization_ID: 'org1' });
        mockStore.set('product_materials/b', { ID: 'b', Product_ID: 'pr1', Material_Name: 'Šarke Blum', Quantity: 12, Unit: 'kom', Supplier: 'Blum', Status: 'Naručeno', Ordered_Quantity: 24, Organization_ID: 'org1' });
        mockStore.set('product_materials/c', { ID: 'c', Product_ID: 'pr2', Material_Name: 'Brava', Quantity: 1, Unit: 'kom', Supplier: 'Häfele', Status: 'Nije naručeno', Organization_ID: 'org1' });
        mockStore.set('product_materials/d', { ID: 'd', Product_ID: 'pr3', Material_Name: 'Klizači', Quantity: 4, Unit: 'kom', Status: 'Nije naručeno', Organization_ID: 'org1' });
    });

    it('prva poruka iz revizije: jedan poziv modela, 5 kolona, PDF ide, odgovor složi ERP', async () => {
        mockSent.length = 0;
        mockScript.push({ calls: [{ name: 'make_table', args: { source: 'biljeska', subjects: ['ogledalo', 'umivaonik'], columns: ['stan', 'ogledalo/umivaonik', 'stanje', 'dimenzije', 'komada'] } }] });
        const out = await runAssistant({ orgId: 'org1', uid: 'u1', text: PRVA, session: { history: [], pending: null }, now: NOW });
        expect(mockScript).toHaveLength(0);
        expect(mockSent).toHaveLength(1);
        expect(mockSent[0].tools.map((t: any) => t.name)).toContain('make_table');
        expect(mockSent[0].tools.map((t: any) => t.name)).not.toContain('create_order');
        expect(out.tables?.[0].columns.map(c => c.key)).toEqual(['stan', 'predmet', 'stanje', 'mjere', 'kolicina']);
        expect(out.reply).toMatch(/^📄 Bilježnica — ogledalo, umivaonik — nije postavljeno · 9 redova\. PDF stiže ispod\.\nU podacima nema/);
        expect(out.changed).toBe(false);
    });

    it('„tabelu šta trebam kod Selima provjeriti": izmišljen predmet se vrati modelu, PDF ne ide', async () => {
        mockSent.length = 0;
        mockScript.push(
            { calls: [{ name: 'make_table', args: { source: 'biljeska', subjects: ['umivaonik'] } }] },
            { text: 'Za zadatke još nemam tabelu — postoje bilježnica i materijali.' },
        );
        const out = await runAssistant({ orgId: 'org1', uid: 'u1', text: 'Napravi mi tabelu sta sve trebam kod Selima provjeriti', session: { history: [], pending: null }, now: NOW });
        expect(mockSent).toHaveLength(2);
        expect(JSON.parse(mockSent[1].messages.at(-1).content[0].content).error).toMatch(/„umivaonik" korisnik nije rekao/);
        expect(out.tables).toBeUndefined();
    });

    const env = (messageText: string) => ({
        orgId: 'org1', uid: 'u1', tz: 'Europe/Sarajevo', now: NOW, turnId: 't', dateText: '', reporter: 'ja', searchHits: [],
        created: { taskIds: [], memoryIds: [] }, changes: [], summaries: [], messageText, groundText: messageText,
        ctx: { workers: [], projects: [{ alias: 'P1', value: { id: 'p1', client: '', name: 'Grbavica' } }], suppliers: [], memory: [], tasks: [], names: [] },
    }) as unknown as ToolEnv;

    it('nenaručeni materijali: projekti u radu i s otvorenim nalogom, količina × komada proizvoda', async () => {
        const e = env(NENARUCENO);
        expect(await runTool(e, 'make_table', { source: 'materijali' })).toEqual({ ok: true, count: 2 });
        expect(e.tables![0].groups).toEqual([
            { label: 'Budnja', rows: [['Brava', '1 kom', 'Häfele']] },
            { label: 'Grbavica', rows: [['Iveral U960 ST9', '10 m²', 'Iverpan']] },
        ]);
    });

    it('prazno → poruka bez PDF-a; nepoznat projekat → greška modelu', async () => {
        const e = env('napravi tabelu za Grbavicu kod Nepostojećeg');
        expect(await runTool(e, 'make_table', { source: 'materijali', project: 'P1', supplier: 'Nepostojeći' })).toEqual({ ok: true, count: 0 });
        expect(e.tables).toBeUndefined();
        expect(e.summaries[0]).toBe('📋 Nenaručeni materijali — Grbavica · Nepostojeći · količina = još za naručiti: nema ničega.');
        expect(await runTool(env(''), 'make_table', { source: 'materijali', project: 'P9' })).toMatchObject({ ok: false });
    });

    it('filter po bilo kojem polju kroz alat', async () => {
        const e = env('tabela nenaručenog samo od hafelea');
        expect(await runTool(e, 'make_table', { source: 'materijali', filters: [{ field: 'dobavljač', values: ['Hafele'] }] })).toEqual({ ok: true, count: 1 });
        expect(e.tables![0].groups[0].rows).toEqual([['Brava', '1 kom', 'Häfele']]);
    });
});
