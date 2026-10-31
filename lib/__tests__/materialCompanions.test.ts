import { buildCompanionStats, decorOf, suggestCompanions, topCompanionPairs, type CompanionBundle, type CompanionCatalogLite } from '../materialCompanions';

const C = (id: string, Name: string, Category = 'Ploče i trake', extra: Partial<CompanionCatalogLite> = {}): CompanionCatalogLite =>
    ({ Material_ID: id, Name, Category, ...extra });

const catalog: CompanionCatalogLite[] = [
    C('mdf18', 'MDF 18'),
    C('mdf6', 'MDF 6'),
    C('fhr', 'Furnir / Hrast'),
    C('fkkhr', 'Furnir KK / Hrast'),
    C('for', 'Furnir / Orah'),
    C('lak', 'Lakiranje', 'Ostalo'),
    C('ktfhr', 'KT / Furnir Hrast 24 / 1'),
    C('ktfhr42', 'KT / Furnir hrast 42 / 1'),
    C('ktor', 'KT / Orah Arrezo'),
    C('iv702', 'Iveral / U702 ST9'),
    C('kt702', 'KT / Siva U702 ST9 23 / 0.8'),
    C('kt702b', 'KT / Siva U702 ST9 42 / 1'),
    C('ivkor', 'Iveral / Bijeli za korpus'),
    C('ktkor', 'KT / Bijela za korpus 22 / 1'),
    C('ktbm', 'KT / Bijela mat 22 / 1'),
    C('iv416', 'Iveral / F416 Textil Bež'),
    C('kt416', 'KT / Textil F416 22 / 1'),
    C('fjas', 'Furnir / Jasen'),
    C('cjev', 'Extrudirana iverica (Šuplja)'),
    C('vod', 'Vodilice za klizna vrata / Furnir Hrast', 'Okovi'),
    C('stak', 'Staklo / Float 4', 'Staklo', { Is_Glass: true }),
    C('bagl', 'Baglama ravna (sa ublazivacem)', 'Okovi'),
];

const B = (projectId: string, ...ids: string[]): CompanionBundle => ({ projectId, materials: ids.map(id => ({ Material_ID: id })) });

/** Istorija: furnir hrast skoro uvijek s MDF 18 i lakom, kroz više projekata. */
const history: CompanionBundle[] = [
    B('p1', 'fhr', 'mdf18', 'lak', 'ktfhr'),
    B('p1', 'fhr', 'mdf18', 'lak'),
    B('p2', 'fhr', 'mdf18', 'lak', 'ktfhr'),
    B('p2', 'fhr', 'mdf18'),
    B('p3', 'fhr', 'mdf18', 'lak', 'fkkhr'),
    B('p4', 'iv702', 'kt702', 'bagl'),
    B('p5', 'iv702', 'kt702', 'bagl'),
    B('p5', 'iv702', 'kt702'),
    // Jedan projekat: jasen „ide" s F416 trakom — slučajnost tog projekta.
    B('p6', 'fjas', 'iv416', 'kt416'),
    B('p6', 'fjas', 'iv416', 'kt416'),
    B('p6', 'fjas', 'iv416', 'kt416'),
    B('p6', 'fjas', 'iv416', 'kt416'),
];
const stats = buildCompanionStats(history, catalog);

const names = (s: { material: CompanionCatalogLite }[]) => s.map(x => x.material.Name);

describe('buildCompanionStats', () => {
    it('broji proizvode i parove unutar iste sastavnice', () => {
        expect(stats.products).toBe(12);
        expect(stats.count.get('fhr')).toBe(5);
        expect(stats.pairs.get('fhr')!.get('mdf18')!.products).toBe(5);
        expect(stats.pairs.get('fhr')!.get('mdf18')!.projects.size).toBe(3);
    });

    it('red bez Material_ID se veže na katalog po nazivu (bez dijakritike i velikih slova)', () => {
        const s = buildCompanionStats([{ materials: [{ Material_Name: 'furnir / hrast' }, { Material_ID: 'mdf18' }] }], catalog);
        expect(s.pairs.get('fhr')!.get('mdf18')!.products).toBe(1);
    });

    it('topCompanionPairs traži podršku, ≥ 2 projekta i pouzdanost', () => {
        const top = topCompanionPairs(stats);
        expect(top[0]).toMatchObject({ from: 'fhr', to: 'mdf18', support: 5, confidence: 1 });
        // jasen ↔ F416 je samo u jednom projektu
        expect(top.some(p => p.from === 'fjas')).toBe(false);
    });
});

describe('decorOf', () => {
    it('vadi šifru dekora, a ST9 i dimenzije preskače', () => {
        expect(decorOf('KT / Siva U702 ST9 23 / 0.8').codes).toEqual(['u702']);
        expect(decorOf('Iveral / U960 ST9 Onyx siva 16mm').codes).toEqual(['u960']);
        expect(decorOf('KT / Siva 0077 22 / 1').codes).toEqual(['0077']);
    });
    it('bez šifre — riječi bez tipa, s ujednačenim nastavkom', () => {
        expect(decorOf('Furnir KK / Hrast')).toEqual({ codes: [], words: ['hrast'] });
        expect(decorOf('Iveral / Bijeli za korpus').words).toEqual(['bijel', 'korpus']);
        expect(decorOf('KT / Bijela za korpus 22 / 1').words).toEqual(['bijel', 'korpus']);
    });
});

describe('suggestCompanions', () => {
    const run = (selected: string[], existing: string[] = [], options = {}) => suggestCompanions({
        selected: selected.map(id => ({ Material_ID: id })),
        existing: existing.map(id => ({ Material_ID: id })),
        catalog, stats, options,
    });

    it('furnir hrast → MDF 18 i KT / Furnir Hrast', () => {
        const s = run(['fhr']);
        expect(names(s).slice(0, 2)).toEqual(['MDF 18', 'KT / Furnir Hrast 24 / 1']);
        expect(s[0].reasons[0]).toEqual({ kind: 'statistika', text: 'u 100 % proizvoda s „Furnir / Hrast"' });
        expect(s[0].reasons.map(r => r.kind)).toContain('tip');
        expect(s[1].reasons[0]).toEqual({ kind: 'dekor', text: 'kant istog dekora kao „Furnir / Hrast"' });
        expect(names(s)).toContain('Lakiranje');
        // samo jedna traka istog dekora, ne i 42/1 varijanta
        expect(names(s)).not.toContain('KT / Furnir hrast 42 / 1');
        // traka orah/iverala nije dekor furnira hrast
        expect(names(s)).not.toContain('KT / Orah Arrezo');
    });

    it('iveral → kant istog dekora (po šifri)', () => {
        const s = run(['iv702']);
        expect(names(s)[0]).toBe('KT / Siva U702 ST9 23 / 0.8');
        expect(s[0].reasons.map(r => r.kind)).toEqual(expect.arrayContaining(['dekor', 'statistika']));
    });

    it('iveral bez šifre → kant istih riječi, ne svaka bijela', () => {
        const s = run(['ivkor']);
        expect(names(s)).toContain('KT / Bijela za korpus 22 / 1');
        expect(names(s)).not.toContain('KT / Bijela mat 22 / 1');
    });

    it('MDF → najkorišteniji furnir', () => {
        const s = run(['mdf6']);
        expect(names(s)).toContain('Furnir / Hrast');
        expect(s.find(x => x.material.Material_ID === 'fhr')!.reasons[0].kind).toBe('tip');
    });

    it('traka → ploča istog dekora', () => {
        expect(names(run(['kt702']))[0]).toBe('Iveral / U702 ST9');
    });

    it('ne predlaže ono što proizvod već ima ni što je već odabrano', () => {
        const s = run(['fhr'], ['mdf18', 'ktfhr42']);
        expect(names(s)).not.toContain('MDF 18');
        expect(names(s)).not.toContain('Furnir / Hrast');
        // proizvod već ima traku tog dekora (42/1) → nema prijedloga 24/1 iz pravila dekora
        expect(s.find(x => x.material.Material_ID === 'ktfhr')?.reasons.some(r => r.kind === 'dekor')).toBeFalsy();
        // MDF već postoji → nema pravila tipa za MDF 6
        expect(names(s)).not.toContain('MDF 6');
    });

    it('proizvod s furnirom orah ne dobija furnir hrast; uz hrast ide i „Furnir KK / Hrast"', () => {
        expect(names(run([], ['for', 'mdf18']))).not.toContain('Furnir / Hrast');
        const kk = buildCompanionStats([B('a', 'fhr', 'fkkhr'), B('b', 'fhr', 'fkkhr'), B('c', 'fhr', 'fkkhr'), B('c', 'for', 'fhr')], catalog);
        const s = suggestCompanions({ selected: [{ Material_ID: 'fhr' }], existing: [], catalog, stats: kk });
        expect(names(s)).toContain('Furnir KK / Hrast');
        // orah je sa hrastom samo jednom — i da nije, drugi dekor istog tipa se ne nudi
        expect(names(suggestCompanions({ selected: [{ Material_ID: 'fhr' }], existing: [], catalog, stats: kk, options: { minSupport: 1, minProjects: 1, minConfidence: 0 } }))).not.toContain('Furnir / Orah');
    });

    it('statistika iz jednog projekta ne predlaže tuđu traku ni ploču', () => {
        const s = run(['fjas']);
        expect(names(s)).not.toContain('KT / Textil F416 22 / 1');
        expect(names(s)).not.toContain('Iveral / F416 Textil Bež');
    });

    it('statistička traka ide samo uz ploču njenog dekora', () => {
        const s = run(['fjas'], [], { minProjects: 1 });
        expect(names(s)).toContain('Iveral / F416 Textil Bež');
        expect(names(s)).not.toContain('KT / Textil F416 22 / 1');
    });

    it('okovi s „furnir" u nazivu i cjevasta iverica nisu sidro pravila', () => {
        expect(run(['vod'])).toEqual([]);
        expect(run(['cjev'])).toEqual([]);
    });

    it('bez sidra nema prijedloga; postojeći materijali su sidro i bez odabira', () => {
        expect(run([])).toEqual([]);
        expect(names(run([], ['fhr']))).toContain('MDF 18');
    });

    it('odabrano u modalu je jači signal od postojećeg', () => {
        const fromSelected = run(['iv702'])[0].score;
        const fromExisting = run([], ['iv702'])[0].score;
        expect(fromSelected).toBeGreaterThan(fromExisting);
    });

    it('poštuje limit i deterministički je', () => {
        expect(run(['fhr'], [], { limit: 2 })).toHaveLength(2);
        expect(run(['fhr', 'iv702'])).toEqual(run(['fhr', 'iv702']));
    });

    it('ne predlaže staklo (ima svoj tok)', () => {
        const s2 = buildCompanionStats([B('a', 'fhr', 'stak'), B('b', 'fhr', 'stak'), B('c', 'fhr', 'stak')], catalog);
        const s = suggestCompanions({ selected: [{ Material_ID: 'fhr' }], existing: [], catalog, stats: s2 });
        expect(names(s)).not.toContain('Staklo / Float 4');
    });
});
