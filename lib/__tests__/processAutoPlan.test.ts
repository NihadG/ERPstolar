import {
    materialTypeFromName,
    presentMaterialTypes,
    suggestProcessesFromMaterials,
} from '../productProcesses';
import {
    SUGGESTED_RULES,
    pickTemplateForTypes,
    buildAutoPlan,
} from '../processAutoPlan';
import type { ProcessMaterialRule } from '../types';

// Stvarni katalog korisnika (18 kanonskih procesa, redoslijed 1-19 s rupom na 3).
const catalog = [
    { Name: 'Priprema masive', Order: 1 },
    { Name: 'Krojenje furnira', Order: 2 },
    { Name: 'Krojenje MDF-a', Order: 4 },
    { Name: 'Lijepljenje i obrada masive', Order: 5 },
    { Name: 'Krojenje Iverala', Order: 6 },
    { Name: 'Kantiranje', Order: 7 },
    { Name: 'Frezanje kanalica (za lajsne)', Order: 8 },
    { Name: 'Krojenje leđa', Order: 9 },
    { Name: 'Sklapanje kutija', Order: 10 },
    { Name: 'Srezivanje elemenata iz prese na tačne mjere', Order: 11 },
    { Name: 'Izrada fronti', Order: 12 },
    { Name: 'Postavljanje leđa', Order: 13 },
    { Name: 'Okivanje ladica', Order: 14 },
    { Name: 'Brušenje furniranih elemenata', Order: 15 },
    { Name: 'Farbanje i lakiranje', Order: 16 },
    { Name: 'Okivanje vrata i fronti', Order: 17 },
    { Name: 'Sklapanje furniranih elemenata', Order: 18 },
    { Name: 'Pakovanje', Order: 19 },
];
const catalogNames = new Set(catalog.map(c => c.Name.toLowerCase()));

describe('materialTypeFromName — tip iz naziva (kategorije su preširoke)', () => {
    test('"Iveral U702 bijeli" → iveral', () => expect(materialTypeFromName('Iveral U702 bijeli')).toBe('iveral'));
    test('"MDF 18mm" → mdf', () => expect(materialTypeFromName('MDF 18mm')).toBe('mdf'));
    test('"Vodilice Blum 500mm" → vodilice', () => expect(materialTypeFromName('Vodilice Blum 500mm')).toBe('vodilice'));
    test('"Furnir hrast" → furnir', () => expect(materialTypeFromName('Furnir hrast')).toBe('furnir'));
    test('"Lak mat 20%" → lak', () => expect(materialTypeFromName('Lak mat 20%')).toBe('lak'));
    test('nepoznato → null', () => expect(materialTypeFromName('Nepoznati artikal XY')).toBeNull());
    test('prazno → null', () => expect(materialTypeFromName('')).toBeNull());
});

describe('presentMaterialTypes — distinct tipovi sastavnice', () => {
    test('miješana sastavnica', () => {
        const types = presentMaterialTypes([
            { Material_Name: 'Furnir hrast' }, { Material_Name: 'MDF 18mm' },
            { Material_Name: 'Lak mat' }, { Material_Name: 'Nepoznato' },
        ]);
        expect(types).toEqual(expect.arrayContaining(['furnir', 'mdf', 'lak']));
        expect(types).not.toContain('iveral');
    });
});

describe('SUGGESTED_RULES — integritet vs katalog', () => {
    test('svi navedeni procesi postoje u katalogu (prazni skupovi dozvoljeni)', () => {
        for (const r of SUGGESTED_RULES) {
            for (const p of r.Processes) {
                expect(catalogNames.has(p.toLowerCase())).toBe(true);
            }
        }
    });
});

describe('suggestProcessesFromMaterials — material_type + combo grane', () => {
    const rules: Pick<ProcessMaterialRule, 'Match_Kind' | 'Match_Value' | 'Match_Types' | 'Processes'>[] = [
        { Match_Kind: 'material_type', Match_Value: 'furnir', Processes: ['Krojenje furnira', 'Brušenje furniranih elemenata'] },
        { Match_Kind: 'material_type', Match_Value: 'mdf', Processes: ['Krojenje MDF-a'] },
        { Match_Kind: 'material_type', Match_Value: 'lak', Processes: ['Farbanje i lakiranje'] },
        { Match_Kind: 'material_type_combo', Match_Value: '', Match_Types: ['furnir', 'mdf'], Processes: ['Srezivanje elemenata iz prese na tačne mjere'] },
    ];

    test('KORISNIKOV SCENARIO: furnir+mdf+lak → krojenje furnira, MDF, srezivanje iz prese, brušenje, lakiranje (katalog redoslijed)', () => {
        const out = suggestProcessesFromMaterials(
            [{ Material_Name: 'Furnir hrast' }, { Material_Name: 'MDF 18mm' }, { Material_Name: 'Lak mat' }],
            rules, catalog,
        );
        expect(out).toEqual([
            'Krojenje furnira',                              // 2
            'Krojenje MDF-a',                                // 4
            'Srezivanje elemenata iz prese na tačne mjere',  // 11 (combo!)
            'Brušenje furniranih elemenata',                 // 15
            'Farbanje i lakiranje',                          // 16
        ]);
    });

    test('combo NE pali kad je prisutan samo jedan tip (samo furnir, bez MDF)', () => {
        const out = suggestProcessesFromMaterials([{ Material_Name: 'Furnir hrast' }], rules, catalog);
        expect(out).toContain('Krojenje furnira');
        expect(out).not.toContain('Srezivanje elemenata iz prese na tačne mjere');  // combo neaktivan
    });

    test('bez pravila / bez materijala → []', () => {
        expect(suggestProcessesFromMaterials([], rules, catalog)).toEqual([]);
        expect(suggestProcessesFromMaterials([{ Material_Name: 'Furnir' }], [], catalog)).toEqual([]);
    });
});

describe('pickTemplateForTypes — izbor po kombinaciji', () => {
    const templates = [
        { Name: 'Iveral bazni', Material_Types: ['iveral'] },
        { Name: 'Iveral+furnir+lak', Material_Types: ['iveral', 'furnir', 'lak'] },
        { Name: 'Masiv', Material_Types: ['masiv'] },
    ];
    test('najveći presjek pobjeđuje', () => {
        expect(pickTemplateForTypes(templates, ['iveral', 'furnir', 'lak'])?.Name).toBe('Iveral+furnir+lak');
    });
    test('tie po presjeku → manje viška', () => {
        // present=[iveral]: "Iveral bazni" overlap1 excess0; "Iveral+furnir+lak" overlap1 excess2 → bazni
        expect(pickTemplateForTypes(templates, ['iveral'])?.Name).toBe('Iveral bazni');
    });
    test('bez presjeka → null', () => {
        expect(pickTemplateForTypes(templates, ['staklo'])).toBeNull();
    });
    test('šablon bez Material_Types se ignoriše', () => {
        expect(pickTemplateForTypes([{ Name: 'X', Material_Types: [] }], ['iveral'])).toBeNull();
    });
});

describe('buildAutoPlan — mapiranje na faze šablona + fallback', () => {
    const rules: Pick<ProcessMaterialRule, 'Match_Kind' | 'Match_Value' | 'Match_Types' | 'Processes'>[] = [
        { Match_Kind: 'material_type', Match_Value: 'iveral', Processes: ['Krojenje Iverala', 'Kantiranje', 'Krojenje leđa', 'Sklapanje kutija'] },
        { Match_Kind: 'material_type', Match_Value: 'lak', Processes: ['Farbanje i lakiranje'] },
    ];
    // Korisnikov stvarni šablon (skraćen): paralelne faze.
    const template = {
        Name: 'Iveral, lakirani furnir', Material_Types: ['iveral', 'furnir', 'lak'],
        Stages: [
            { processes: ['Krojenje Iverala', 'Krojenje MDF-a', 'Krojenje furnira', 'Priprema masive'] },
            { processes: ['Kantiranje', 'Lijepljenje i obrada masive', 'Frezanje kanalica (za lajsne)', 'Krojenje leđa'] },
            { processes: ['Sklapanje kutija', 'Srezivanje elemenata iz prese na tačne mjere'] },
            { processes: ['Farbanje i lakiranje'] },
        ],
    };

    test('mapira predložene na faze šablona: prazne/nepredložene ispuštene, paralelizam očuvan', () => {
        const r = buildAutoPlan([{ Material_Name: 'Iveral U702' }, { Material_Name: 'Lak mat' }], rules, catalog, [template]);
        expect(r.source).toBe('rules');
        expect(r.templateName).toBe('Iveral, lakirani furnir');
        // predloženi: Krojenje Iverala, Kantiranje, Krojenje leđa, Sklapanje kutija, Farbanje i lakiranje
        expect(r.stages).toEqual([
            ['Krojenje Iverala'],                  // faza 1: samo iveral predložen
            ['Kantiranje', 'Krojenje leđa'],       // faza 2: paralelno
            ['Sklapanje kutija'],                  // faza 3
            ['Farbanje i lakiranje'],              // faza 4
        ]);
        expect(r.appendedOutsideTemplate).toEqual([]);
    });

    test('predloženi proces kojeg NEMA u šablonu → append na kraj', () => {
        const rulesWithExtra = [...rules, { Match_Kind: 'material_type' as const, Match_Value: 'iveral', Processes: ['Pakovanje'] }];
        const r = buildAutoPlan([{ Material_Name: 'Iveral U702' }], rulesWithExtra, catalog, [template]);
        expect(r.appendedOutsideTemplate).toContain('Pakovanje');
        expect(r.stages[r.stages.length - 1]).toEqual(['Pakovanje']);
    });

    test('bez šablona → sekvencijalno po katalogu', () => {
        const r = buildAutoPlan([{ Material_Name: 'Iveral U702' }], rules, catalog, []);
        expect(r.stages).toEqual([['Krojenje Iverala'], ['Kantiranje'], ['Krojenje leđa'], ['Sklapanje kutija']]);
    });

    test('bez pogodaka pravila → source none', () => {
        const r = buildAutoPlan([{ Material_Name: 'Nepoznato' }], rules, catalog, [template]);
        expect(r.source).toBe('none');
        expect(r.stages).toEqual([]);
    });
});
