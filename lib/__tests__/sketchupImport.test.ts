import {
    parseSketchUpExport, buildImportPlan, defaultChoices, resolveProductLines, suppliersToCreate,
    summarizePlan, runImport, normName, convertToUnit, buildErpCatalog, isRealSupplier,
    SU_EXPORT_FORMAT, type SuExport, type SuLine, type ImportDeps,
} from '../sketchupImport';
import type { Material, Product, Supplier } from '../types';

const mat = (id: string, Name: string, Category: string, Unit: string, price: number, supplier = 'Frischeis'): Material => ({
    Material_ID: id, Organization_ID: 'org', Name, Category, Unit,
    Default_Supplier: supplier, Default_Unit_Price: price, Description: '',
});

// Isječak stvarnog kataloga (Lux-co) — nazivi kako stoje u bazi.
const CATALOG: Material[] = [
    mat('iv-u156', 'Iveral / U156 ST9', 'Ploče i trake', 'Kom', 180),
    mat('iv-u727', 'Iveral / Sivi - U727 ST9', 'Ploče i trake', 'Kom', 130),
    mat('iv-u963-16', 'Iveral / Diamond Gray U963 ST9 16mm', 'Ploče i trake', 'Kom', 130),
    mat('iv-u963-18', 'Iveral / Diamond Gray U963 ST9 18mm', 'Ploče i trake', 'Kom', 150),
    mat('hpl-f800', 'HPL / F800', 'Ploče i trake', 'Kom', 210),
    mat('kt-u156', 'KT / U156 23/0.8', 'Ploče i trake', 'm', 1.5),
    mat('kt-u727', 'KT / Siva U727 ST9 23/0.8', 'Ploče i trake', 'm', 2),
    mat('kt-w960', 'KT / W960 23 / 0.8', 'Ploče i trake', 'm', 1),
    mat('kt-w960w', 'KT / W960 43/0.8', 'Ploča', 'kom', 1.67),
    mat('furnir', 'Furnir / Hrast', 'Ploče i trake', 'm2', 23),
    mat('bag-r', 'Baglama ravna (sa ublazivacem)', 'Okovi', 'Kom', 6, 'Schachermayer'),
    mat('bag-r-bez', 'Baglama ravna (bez ublazivaca)', 'Okovi', 'Kom', 6, 'Schachermayer'),
    mat('vod-450', 'Vodilice Kuglične 450', 'Okovi', 'Kom', 20, 'Schachermayer'),
    mat('vod-500', 'Vodilice Kuglične 500', 'Okovi', 'Kom', 30, 'Schachermayer'),
    mat('vod-blum-450', 'Vodilice Blum 450', 'Okovi', 'Kom', 70, 'Schachermayer'),
    mat('nos-gor', 'Nosaci gornjih elemenata', 'Okovi', 'Kom', 3, 'Schachermayer'),
];
const SUPPLIERS: Supplier[] = ['Frischeis', 'Elgrad', 'Schachermayer'].map((Name, i) => ({
    Supplier_ID: `s${i}`, Organization_ID: 'org', Name, Contact_Person: '', Phone: '', Email: '', Address: '', Categories: '',
}));

const line = (o: Partial<SuLine> & Pick<SuLine, 'vrsta' | 'naziv'>): SuLine => ({ jm: 'kom', kolicina: 1, cijena: 1, ...o });

function exportOf(products: SuExport['proizvodi']): SuExport {
    return { format: SU_EXPORT_FORMAT, verzija: 1, proizvodi: products };
}

describe('parseSketchUpExport', () => {
    it('odbija fajl koji nije izvoz iz SketchUpa', () => {
        expect(parseSketchUpExport('nije json').error).toMatch(/JSON/);
        expect(parseSketchUpExport('{"format":"x","proizvodi":[]}').error).toMatch(/nije izvoz/);
    });

    it('čita brojeve s decimalnim zarezom i dopunjuje prazna polja', () => {
        const { data, error } = parseSketchUpExport(JSON.stringify({
            format: SU_EXPORT_FORMAT, verzija: 1,
            proizvodi: [{ kljuc: 'Donji 80', kolicina: '2', sirina: 800, stavke: [
                { vrsta: 'ploca', naziv: 'Egger U156', jm: 'ploča', kolicina: '1,5', cijena: '211,55' },
                { vrsta: 'nepoznato', naziv: 'Nešto', kolicina: 1, cijena: 2 },
                { vrsta: 'okov', naziv: '' },
            ] }],
        }));
        expect(error).toBeUndefined();
        const p = data!.proizvodi[0];
        expect(p.naziv).toBe('Donji 80');
        expect(p.kolicina).toBe(2);
        expect(p.stavke).toHaveLength(2);
        expect(p.stavke[0]).toMatchObject({ kolicina: 1.5, cijena: 211.55 });
        expect(p.stavke[1].vrsta).toBe('ostalo');
    });
});

describe('prepoznavanje', () => {
    it('normName izjednačava kvačice, razmake oko kose crte i decimalni zarez', () => {
        expect(normName('KT / W960 23 / 0,8')).toBe(normName('kt/w960 23/0.8'));
        expect(normName('Vodilice Kuglične')).toBe('vodilice kuglicne');
    });

    it('ploča bez ERP naziva se veže po šifri i debljini, ne za HPL istog dekora', () => {
        const plan = buildImportPlan(exportOf([{ kljuc: 'A', naziv: 'A', kolicina: 1, stavke: [
            line({ vrsta: 'ploca', naziv: 'Egger U156 ST9 · 18 mm', debljina: 18, jm: 'ploča', kolicina: 2, cijena: 200 }),
            line({ vrsta: 'ploca', naziv: 'Iveral Diamond U963 · 16 mm', debljina: 16, jm: 'ploča', kolicina: 1, cijena: 120 }),
            line({ vrsta: 'ploca', naziv: 'Egger U727 · 10 mm', debljina: 10, jm: 'ploča', kolicina: 1, cijena: 90 }),
            line({ vrsta: 'ploca', naziv: 'Iveral F800 · 18 mm', debljina: 18, jm: 'ploča', kolicina: 1, cijena: 250 }),
        ] }]), CATALOG, SUPPLIERS);
        const by = (n: string) => plan.materials.find(m => m.sources[0].startsWith(n))!;
        expect(by('Egger U156').match?.Material_ID).toBe('iv-u156');
        expect(by('Egger U156').how).toBe('sifra');
        expect(by('Iveral Diamond').match?.Material_ID).toBe('iv-u963-16');
        // 10 mm nije iveral od 18 (naziv bez debljine) → novi
        expect(by('Egger U727').match).toBeNull();
        // iveral F800 ≠ HPL F800
        expect(by('Iveral F800').match).toBeNull();
    });

    it('kant traka se veže po šifri i širini (23 ≠ 43)', () => {
        const plan = buildImportPlan(exportOf([{ kljuc: 'A', naziv: 'A', kolicina: 1, stavke: [
            line({ vrsta: 'kant', naziv: 'Bijela ABS traka 0,8/23 mm – Egger W960', debljina: 18, jm: 'm', kolicina: 12, cijena: 0.8 }),
            line({ vrsta: 'kant', naziv: 'Kant traka – W960', debljina: 38, jm: 'm', kolicina: 3, cijena: 1 }),
        ] }]), CATALOG, SUPPLIERS);
        expect(plan.materials[0].match?.Material_ID).toBe('kt-w960');
        expect(plan.materials[1].match?.Material_ID).toBe('kt-w960w');
    });

    it('okov se veže po riječima i mjeri, a nejasan ostaje novi s prijedlozima', () => {
        const plan = buildImportPlan(exportOf([{ kljuc: 'A', naziv: 'A', kolicina: 1, stavke: [
            line({ vrsta: 'okov', naziv: 'Vodilice kuglične · 450 mm', jm: 'par', kolicina: 3, cijena: 13 }),
            line({ vrsta: 'okov', naziv: 'Baglama ravna', kolicina: 4, cijena: 4 }),
        ] }]), CATALOG, SUPPLIERS);
        expect(plan.materials[0].match?.Material_ID).toBe('vod-450');
        expect(plan.materials[1].match).toBeNull();
        expect(plan.materials[1].candidates.map(c => c.Material_ID)).toEqual(expect.arrayContaining(['bag-r', 'bag-r-bez']));
    });

    it('ručna stavka: šifra modela veže, a nejasna dobija samo prijedlog', () => {
        const cat = [...CATALOG, mat('rucka', 'Profilna ručka Rujz Design, 658.35, SatBronzE', 'Okovi', 'kom', 42, 'RujzDesign')];
        const plan = buildImportPlan(exportOf([{ kljuc: 'A', naziv: 'A', kolicina: 1, stavke: [
            line({ vrsta: 'okov', naziv: 'Ručka profilna 658.35 bronza', kolicina: 4, cijena: 42 }),
            line({ vrsta: 'okov', naziv: 'Montažna pločica', erp: 'Montažna pločica za baglamu', kolicina: 8, cijena: 0.8 }),
        ] }]), cat, SUPPLIERS);
        // šifra modela 658.35 je dovoljna za siguran par
        expect(plan.materials[0]).toMatchObject({ how: 'sifra' });
        expect(plan.materials[0].match?.Material_ID).toBe('rucka');
        expect(plan.materials[1].suggestion).toBeNull();
        const amb = buildImportPlan(exportOf([{ kljuc: 'B', naziv: 'B', kolicina: 1, stavke: [line({ vrsta: 'okov', naziv: 'Baglama ravna', kolicina: 2, cijena: 5 })] }]), cat, SUPPLIERS);
        expect(amb.materials[0].match).toBeNull();
        expect(amb.materials[0].suggestion?.Name).toMatch(/^Baglama ravna/);
    });

    it('erpId i tačan ERP naziv imaju prednost; nepostojeći ERP naziv pravi novi materijal', () => {
        const plan = buildImportPlan(exportOf([{ kljuc: 'A', naziv: 'A', kolicina: 1, stavke: [
            line({ vrsta: 'okov', naziv: 'Šarka Tiomos 110° s usporivačem', erp: 'Baglama ravna (sa ublazivacem)', kolicina: 4, cijena: 4 }),
            line({ vrsta: 'okov', naziv: 'Vodilica Blum · 450 mm', erp: 'Vodilice Blum 450', erpId: 'vod-blum-450', kolicina: 1, cijena: 70 }),
            line({ vrsta: 'ploca', naziv: 'Egger U727 ST9 · 10 mm', erp: 'Iveral / Sivi - U727 ST9 10mm', debljina: 10, jm: 'ploča', kolicina: 1, cijena: 221.7 }),
        ] }]), CATALOG, SUPPLIERS);
        expect(plan.materials.map(m => [m.how, m.match?.Material_ID ?? null])).toEqual([
            ['naziv', 'bag-r'],
            ['id', 'vod-blum-450'],
            ['novi', null],
        ]);
        expect(plan.materials[2]).toMatchObject({ name: 'Iveral / Sivi - U727 ST9 10mm', category: 'Ploče i trake', unit: 'Kom' });
    });
});

describe('količine, jedinice i dobavljači', () => {
    const exp = exportOf([
        { kljuc: 'Donji 80', naziv: 'Donji element 80', kolicina: 2, sirina: 800, visina: 870, dubina: 560, stavke: [
            line({ vrsta: 'ploca', naziv: 'Egger U156 ST9 · 18 mm', erp: 'Iveral / U156 ST9', debljina: 18, jm: 'ploča', kolicina: 1.5, cijena: 211.55, dobavljac: 'Elgrad', povrsinaPloce: 5.796 }),
            line({ vrsta: 'ploca', naziv: 'Bijeli iveral – Kronospan 8685 BS · 18 mm', erp: 'Iveral / Kronospan 8685 BS bijela', debljina: 18, jm: 'ploča', kolicina: 1, cijena: 92.74, dobavljac: 'Penny' }),
            line({ vrsta: 'okov', naziv: 'Šarka Tiomos', erp: 'Baglama ravna (sa ublazivacem)', kolicina: 8, cijena: 4, dobavljac: 'Okov (srednji)' }),
            line({ vrsta: 'usluga', naziv: 'Rezanje iverala', jm: 'm', kolicina: 20, cijena: 0.78, dobavljac: 'Elgrad' }),
            line({ vrsta: 'ploca', naziv: 'Furnir hrast', erp: 'Furnir / Hrast', jm: 'ploča', kolicina: 1, cijena: 115, povrsinaPloce: 5 }),
        ] },
    ]);

    it('dijeli količinu po komadu, preračunava ploču u m² i zadržava iznos', () => {
        const plan = buildImportPlan(exp, CATALOG, SUPPLIERS);
        expect(plan.skippedServices).toBe(1);
        const ch = defaultChoices(plan);
        const lines = resolveProductLines(plan.products[0], plan, ch, CATALOG);
        const u156 = lines.find(l => l.materialId === 'iv-u156')!;
        expect(u156).toMatchObject({ quantity: 0.75, unit: 'Kom', unitPrice: 211.55, supplier: 'Elgrad' });
        const furnir = lines.find(l => l.materialId === 'furnir')!;
        expect(furnir.unit).toBe('m2');
        expect(furnir.quantity).toBe(2.5);              // 1 ploča × 5 m² / 2 kom
        expect(furnir.unitPrice).toBe(23);              // 115 / 5
        // „Okov (srednji)" nije dobavljač → kataloški dobavljač
        expect(lines.find(l => l.materialId === 'bag-r')!.supplier).toBe('Schachermayer');
    });

    it('pravi samo dobavljače kojih nema (Penny), ne i pseudo-dobavljače', () => {
        const plan = buildImportPlan(exp, CATALOG, SUPPLIERS);
        expect(suppliersToCreate(plan, defaultChoices(plan), CATALOG, SUPPLIERS)).toEqual(['Penny']);
        expect(isRealSupplier('Okov (srednji)')).toBe(false);
        expect(isRealSupplier('ručno')).toBe(false);
    });

    it('sažetak broji povezane i nove materijale i ukupan trošak', () => {
        const plan = buildImportPlan(exp, CATALOG, SUPPLIERS);
        const s = summarizePlan(plan, defaultChoices(plan), CATALOG, SUPPLIERS);
        expect(s).toMatchObject({ productsNew: 1, lines: 4, materialsLinked: 3, materialsNew: 1, suppliersNew: ['Penny'] });
        expect(s.materialTotal).toBeCloseTo(1.5 * 211.55 + 92.74 + 32 + 115, 1);
    });

    it('nekompatibilna jedinica ostaje u jedinici ponude i označi se', () => {
        expect(convertToUnit({ jm: 'kom', kolicina: 2, cijena: 10 }, 'm')).toMatchObject({ compatible: false, unit: 'kom', quantity: 2 });
        expect(convertToUnit({ jm: 'par', kolicina: 3, cijena: 13 }, 'Kom')).toMatchObject({ compatible: true, quantity: 3, unitPrice: 13 });
    });
});

describe('postojeći proizvodi', () => {
    const pm = (status: string, orderId = '', imported = true) => ({
        ID: `pm-${status}-${imported}`, Organization_ID: 'org', Product_ID: 'p-old', Material_ID: 'x', Material_Name: 'x',
        Quantity: 1, Unit: 'kom', Unit_Price: 1, Total_Price: 1, Status: status, Supplier: '', Order_ID: orderId,
        ...(imported ? { Import_Source: 'sketchup' as const } : {}),
    });
    const existing = (materials: ReturnType<typeof pm>[]): Product => ({
        Product_ID: 'p-old', Organization_ID: 'org', Project_ID: 'pr', Name: 'Donji element 80', Height: 0, Width: 0, Depth: 0,
        Quantity: 1, Status: 'Na čekanju', Material_Cost: 0, Notes: '', materials,
    });
    const exp = exportOf([{ kljuc: 'D', naziv: 'Donji element 80', kolicina: 1, stavke: [line({ vrsta: 'okov', naziv: 'Baglama', erp: 'Baglama ravna (sa ublazivacem)' })] }]);

    it('ranije uvezen, nenaručen → zamjena sastavnice (ručne stavke ostaju)', () => {
        const plan = buildImportPlan(exp, CATALOG, SUPPLIERS, [existing([pm('Nije naručeno'), pm('Nije naručeno', '', false)])]);
        expect(plan.products[0]).toMatchObject({ canReplace: true, existingImported: 1, existingManual: 1 });
        expect(defaultChoices(plan).products.D).toBe('replace');
    });

    it('prazan proizvod istog naziva se dopunjava', () => {
        const plan = buildImportPlan(exp, CATALOG, SUPPLIERS, [existing([])]);
        expect(defaultChoices(plan).products.D).toBe('replace');
    });

    it('ručno razrađen proizvod se ne dira bez izbora', () => {
        const plan = buildImportPlan(exp, CATALOG, SUPPLIERS, [existing([pm('Naručeno', 'o1', false)])]);
        expect(plan.products[0].canReplace).toBe(true);   // nema uvezenih stavki koje bi se brisale
        expect(defaultChoices(plan).products.D).toBe('skip');
    });

    it('naručena uvezena stavka → zamjena nije dozvoljena', () => {
        const plan = buildImportPlan(exp, CATALOG, SUPPLIERS, [existing([pm('Naručeno', 'o1')])]);
        expect(plan.products[0].canReplace).toBe(false);
        expect(defaultChoices(plan).products.D).toBe('skip');
    });
});

describe('runImport', () => {
    function fakeDeps() {
        const calls: string[] = [];
        let n = 0;
        const deps: ImportDeps = {
            saveSupplier: async d => { calls.push(`supplier:${d.Name}`); return { success: true, data: { Supplier_ID: `s-${++n}` }, message: '' }; },
            saveMaterial: async d => { calls.push(`material:${d.Name}:${d.Unit}:${d.Default_Supplier}`); return { success: true, data: { Material_ID: `m-${++n}` }, message: '' }; },
            saveProduct: async d => { calls.push(`product:${d.Product_ID ? 'update' : d.Name}`); return { success: true, data: { Product_ID: d.Product_ID || `p-${++n}` }, message: '' }; },
            addProductMaterials: async (pid, items) => { calls.push(`pm:${pid}:${items.map(i => `${i.Material_Name}=${i.Quantity}`).join(',')}`); return { success: true, message: '' }; },
            deleteImportedProductMaterials: async pid => { calls.push(`delete:${pid}`); },
        };
        return { deps, calls };
    }

    it('redom: dobavljači → materijali → proizvodi → sastavnica', async () => {
        const exp = exportOf([{ kljuc: 'K', naziv: 'Kuhinja', kolicina: 1, sirina: 3000, visina: 900, dubina: 600, stavke: [
            line({ vrsta: 'ploca', naziv: 'Bijeli iveral – Kronospan 8685', erp: 'Iveral / Kronospan 8685 BS bijela', debljina: 18, jm: 'ploča', kolicina: 2, cijena: 92.74, dobavljac: 'Penny' }),
            line({ vrsta: 'okov', naziv: 'Vodilica', erp: 'Vodilice Kuglične 450', kolicina: 3, cijena: 13, dobavljac: 'Okov (srednji)' }),
        ] }]);
        const plan = buildImportPlan(exp, CATALOG, SUPPLIERS);
        const { deps, calls } = fakeDeps();
        const res = await runImport(plan, defaultChoices(plan), { projectId: 'pr', catalog: CATALOG, suppliers: SUPPLIERS }, deps);
        expect(calls).toEqual([
            'supplier:Penny',
            'material:Iveral / Kronospan 8685 BS bijela:Kom:Penny',
            'product:Kuhinja',
            'pm:p-3:Iveral / Kronospan 8685 BS bijela=2,Vodilice Kuglične 450=3',
        ]);
        expect(res).toMatchObject({ suppliersCreated: 1, materialsCreated: 1, productsCreated: 1, linesWritten: 2, errors: [] });
    });

    it('preskočen proizvod ne pravi ni svoje materijale', async () => {
        const exp = exportOf([{ kljuc: 'K', naziv: 'Kuhinja', kolicina: 1, stavke: [
            line({ vrsta: 'okov', naziv: 'Nova ručka', erp: 'Ručka nova', kolicina: 2, cijena: 5, dobavljac: 'Novi d.o.o.' }),
        ] }]);
        const plan = buildImportPlan(exp, CATALOG, SUPPLIERS);
        const ch = defaultChoices(plan);
        ch.products.K = 'skip';
        const { deps, calls } = fakeDeps();
        await runImport(plan, ch, { projectId: 'pr', catalog: CATALOG, suppliers: SUPPLIERS }, deps);
        expect(calls).toEqual([]);
    });
});

describe('buildErpCatalog', () => {
    it('izbacuje pseudo-dobavljače i sortira po kategoriji', () => {
        const c = buildErpCatalog([
            mat('a', 'Vodilice Kuglične 450', 'Okovi', 'Kom', 20, 'Schachermayer'),
            mat('b', 'Drvena ručka', 'Okovi', 'Kom', 20, '#N/A'),
            mat('c', 'Iveral / U156 ST9', 'Ploče i trake', 'Kom', 180),
        ], SUPPLIERS, 'Lux-co', new Date('2026-10-08T10:00:00Z'));
        expect(c.materijali.map(m => m.id)).toEqual(['b', 'a', 'c']);
        expect(c.materijali[0].dobavljac).toBe('');
        expect(c.dobavljaci).toEqual(['Elgrad', 'Frischeis', 'Schachermayer']);
    });
});

describe('sastav i konvencije baze', () => {
    const cat: Material[] = [
        ...CATALOG,
        mat('mdf18', 'MDF 18', 'Ploče i trake', 'Kom', 100),
        mat('lak', 'Lakiranje', 'Ostalo', 'm2', 15, 'Interni'),
        mat('boja', 'Boja za MDF', 'Ostalo', 'm2', 80, 'Top color'),
        mat('hpl-u999', 'HPL / U999', 'Ploče i trake', 'Kom', 210),
    ];
    const exp = exportOf([{ kljuc: 'F', naziv: 'Fronte', kolicina: 1, stavke: [
        line({ vrsta: 'ploca', naziv: 'MDF 18', jm: 'ploča', kolicina: 0.5, cijena: 100, debljina: 18, povrsinaPloce: 5.796, erp: 'MDF 18', erpId: 'mdf18', erpVeza: 'katalog' }),
        line({ vrsta: 'obloga', naziv: 'Furnir / Hrast', jm: 'm²', kolicina: 1.4, cijena: 23 }),
        line({ vrsta: 'obloga', naziv: 'Furnir KK / Hrast', jm: 'm²', kolicina: 1.4, cijena: 10 }),
        line({ vrsta: 'obrada', naziv: 'Lakiranje', jm: 'm²', kolicina: 1.68, cijena: 15 }),
        line({ vrsta: 'obrada', naziv: 'Farbanje MDF', jm: 'm²', kolicina: 2, cijena: 80 }),
        line({ vrsta: 'obloga', naziv: 'HPL KK / U999', jm: 'm²', kolicina: 3.668, cijena: 10, povrsinaPloce: 3.668 }),
        line({ vrsta: 'ploca', naziv: 'Egger U705 ST9 Angora · 18 mm', materijal: 'Egger U705 ST9 Angora', jm: 'ploča', kolicina: 1, cijena: 231, debljina: 18 }),
        line({ vrsta: 'ploca', naziv: 'Egger U705 ST9 · 10 mm', materijal: 'Egger U705 ST9', jm: 'ploča', kolicina: 1, cijena: 150, debljina: 10 }),
        line({ vrsta: 'kant', naziv: 'Kant traka – Egger U705 ST9', materijal: 'Egger U705 ST9', jm: 'm', kolicina: 10, cijena: 1.25, debljina: 18 }),
    ] }]);

    it('furnir, lakiranje i farbanje se vežu za postojeće stavke baze', () => {
        const plan = buildImportPlan(exp, cat, SUPPLIERS);
        const by = (n: string) => plan.materials.find(m => m.sources[0] === n)!;
        expect(by('MDF 18').match?.Material_ID).toBe('mdf18');
        expect(by('Furnir / Hrast').match?.Material_ID).toBe('furnir');
        expect(by('Furnir KK / Hrast').match).toBeNull();          // KK ≠ lice
        expect(by('Lakiranje').match?.Material_ID).toBe('lak');
        expect(by('Farbanje MDF').match?.Material_ID).toBe('boja');
    });

    it('novi materijali dobijaju kategoriju, jedinicu i oblik naziva kao baza', () => {
        const plan = buildImportPlan(exp, cat, SUPPLIERS);
        const by = (n: string) => plan.materials.find(m => m.sources[0] === n)!;
        expect(by('Furnir KK / Hrast')).toMatchObject({ name: 'Furnir KK / Hrast', category: 'Ploče i trake', unit: 'm2' });
        expect(by('HPL KK / U999')).toMatchObject({ name: 'HPL KK / U999', unit: 'Kom', unitPrice: 36.68 });   // 3,668 m² × 10 KM = 1 ploča
        expect(by('Egger U705 ST9 Angora · 18 mm')).toMatchObject({ name: 'Iveral / U705 ST9 Angora', unit: 'Kom' });
        expect(by('Egger U705 ST9 · 10 mm')).toMatchObject({ name: 'Iveral / U705 ST9 10mm' });
        expect(by('Kant traka – Egger U705 ST9')).toMatchObject({ name: 'KT / U705 ST9', unit: 'm' });
    });

    it('HPL u m² ulazi u sastavnicu po ploči', () => {
        const plan = buildImportPlan(exp, cat, SUPPLIERS);
        const lines = resolveProductLines(plan.products[0], plan, defaultChoices(plan), cat);
        expect(lines.find(l => l.materialName === 'HPL KK / U999')).toMatchObject({ quantity: 1, unit: 'Kom', unitPrice: 36.68 });
    });
});
