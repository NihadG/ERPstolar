import {
    collectProductCandidates, groupCandidatesByProject, blockDataFromProducts,
    groupMaterialsForProducts, availableMaterialTypes, purchaseDataFromGroup,
    type ProductCandidate,
} from '../canvas/fromProducts';
import type { Project, Product, ProductMaterial, Offer, WorkOrder } from '../types';

// ── Fixture ─────────────────────────────────────────────────────────
const mat = (over: Partial<ProductMaterial> = {}): ProductMaterial => ({
    ID: `m${Math.random()}`, Organization_ID: 'org', Product_ID: 'p1', Material_ID: 'cat1',
    Material_Name: 'Iveral 18', Quantity: 2, Unit: 'Kom', Unit_Price: 100, Total_Price: 200,
    Status: 'Nije naručeno', Supplier: 'Frischeis', Order_ID: '', ...over,
} as ProductMaterial);

const product = (over: Partial<Product> = {}): Product => ({
    Product_ID: 'p1', Name: 'Kuhinja', Project_ID: 'pr1', Quantity: 2, Status: 'Na čekanju',
    Material_Cost: 0, Notes: '', materials: [],
    ...over,
} as Product);

const offer = (productId: string, days: number, workers: number, status = 'Prihvaćeno'): Offer =>
    ({
        Offer_ID: 'o1', Project_ID: 'pr1', Status: status,
        products: [{ ID: 'op1', Product_ID: productId, Labor_Days: days, Labor_Workers: workers }],
    } as unknown as Offer);

const project = (over: Partial<Project> = {}): Project => ({
    Project_ID: 'pr1', Organization_ID: 'org', Name: 'Novak', Client_Name: 'Novak d.o.o.',
    Status: 'U proizvodnji', products: [], offers: [],
    ...over,
} as Project);

// ════════════════════════════════════════════════════════════════════
describe('slobodni proizvodi', () => {
    test('proizvodi se čitaju iz projects[].products[] (appState.products je prazan)', () => {
        const c = collectProductCandidates([project({ products: [product()] })], []);
        expect(c).toHaveLength(1);
        expect(c[0].productName).toBe('Kuhinja');
        expect(c[0].projectName).toBe('Novak');
    });

    test('već raspoređena količina se oduzima', () => {
        const wo = {
            Work_Order_ID: 'wo1', Status: 'U toku',
            items: [{ ID: 'i1', Product_ID: 'p1', Quantity: 1 }],
        } as unknown as WorkOrder;
        const c = collectProductCandidates([project({ products: [product({ Quantity: 2 })] })], [wo]);
        expect(c[0].usedQty).toBe(1);
        expect(c[0].availableQty).toBe(1);
    });

    test('OTKAZAN nalog ne troši količinu', () => {
        const wo = {
            Work_Order_ID: 'wo1', Status: 'Otkazano',
            items: [{ ID: 'i1', Product_ID: 'p1', Quantity: 2 }],
        } as unknown as WorkOrder;
        const c = collectProductCandidates([project({ products: [product({ Quantity: 2 })] })], [wo]);
        expect(c[0].availableQty).toBe(2);
    });

    test('završen nalog TROŠI količinu (posao je odrađen)', () => {
        const wo = {
            Work_Order_ID: 'wo1', Status: 'Završeno',
            items: [{ ID: 'i1', Product_ID: 'p1', Quantity: 2 }],
        } as unknown as WorkOrder;
        const c = collectProductCandidates([project({ products: [product({ Quantity: 2 })] })], [wo]);
        expect(c[0].availableQty).toBe(0);
    });

    test('skriveni projekt se preskače', () => {
        const c = collectProductCandidates(
            [project({ Hidden: true, products: [product()] } as Partial<Project>)], []
        );
        expect(c).toEqual([]);
    });
});

describe('rad iz ponude', () => {
    test('2 radnika × 2 dana = 4 radnik-dana po komadu', () => {
        const c = collectProductCandidates(
            [project({ products: [product()], offers: [offer('p1', 2, 2)] })], []
        );
        expect(c[0].laborDays).toBe(2);
        expect(c[0].laborWorkers).toBe(2);
        expect(c[0].workerDaysPerUnit).toBe(4);
        expect(c[0].missingLabor).toBe(false);
    });

    test('PRIHVAĆENA ponuda ima prednost nad nacrtom', () => {
        const p = project({
            products: [product()],
            offers: [
                { Offer_ID: 'draft', Status: 'Nacrt', products: [{ ID: 'x', Product_ID: 'p1', Labor_Days: 9, Labor_Workers: 9 }] },
                offer('p1', 2, 2),
            ] as unknown as Offer[],
        });
        expect(collectProductCandidates([p], [])[0].workerDaysPerUnit).toBe(4);
    });

    test('bez prihvaćene ponude uzima se nacrt, ali se to zna', () => {
        const c = collectProductCandidates(
            [project({ products: [product()], offers: [offer('p1', 3, 1, 'Nacrt')] })], []
        );
        expect(c[0].workerDaysPerUnit).toBe(3);
    });

    test('proizvod bez rada u ponudi se OZNAČI — trajanje se mora unijeti ručno', () => {
        const c = collectProductCandidates([project({ products: [product()] })], []);
        expect(c[0].missingLabor).toBe(true);
        expect(c[0].workerDaysPerUnit).toBe(0);
    });

    test('0 radnika se tretira kao 1 (dani su ipak podatak)', () => {
        const c = collectProductCandidates(
            [project({ products: [product()], offers: [offer('p1', 3, 0)] })], []
        );
        expect(c[0].workerDaysPerUnit).toBe(3);
    });
});

describe('grupisanje po projektu', () => {
    const many = () => collectProductCandidates([
        project({
            Project_ID: 'pr1', Name: 'Novak',
            products: [product({ Product_ID: 'p1', Name: 'Kuhinja' })],
            offers: [offer('p1', 2, 2)],
        }),
        project({
            Project_ID: 'pr2', Name: 'Begović', Client_Name: 'B',
            products: [product({ Product_ID: 'p2', Name: 'Ormar', Project_ID: 'pr2', Quantity: 3 })],
        }),
    ], []);

    test('grupe su po projektu, abecedno', () => {
        expect(groupCandidatesByProject(many()).map(g => g.projectName)).toEqual(['Begović', 'Novak']);
    });

    test('zbir slobodnih radnik-dana po projektu', () => {
        const g = groupCandidatesByProject(many()).find(x => x.projectName === 'Novak')!;
        expect(g.availableWorkerDays).toBe(8);   // 4 po komadu × 2 komada
    });

    test('pretraga hvata i naziv proizvoda i projekta', () => {
        expect(groupCandidatesByProject(many(), { search: 'ormar' })).toHaveLength(1);
        expect(groupCandidatesByProject(many(), { search: 'novak' })[0].projectName).toBe('Novak');
        expect(groupCandidatesByProject(many(), { search: 'nema' })).toEqual([]);
    });

    test('više pojmova traži SVE (AND)', () => {
        expect(groupCandidatesByProject(many(), { search: 'novak kuhinja' })).toHaveLength(1);
        expect(groupCandidatesByProject(many(), { search: 'novak ormar' })).toEqual([]);
    });

    test('onlyAvailable skriva potpuno raspoređene', () => {
        const wo = {
            Work_Order_ID: 'wo1', Status: 'U toku',
            items: [{ ID: 'i1', Product_ID: 'p1', Quantity: 2 }],
        } as unknown as WorkOrder;
        const cands = collectProductCandidates(
            [project({ products: [product()], offers: [offer('p1', 2, 2)] })], [wo]
        );
        expect(groupCandidatesByProject(cands, { onlyAvailable: true })).toEqual([]);
        expect(groupCandidatesByProject(cands)).toHaveLength(1);
    });
});

// ════════════════════════════════════════════════════════════════════
describe('proizvodi → blok naloga', () => {
    const cand = (over: Partial<ProductCandidate> = {}): ProductCandidate => ({
        productId: 'p1', productName: 'Kuhinja', projectId: 'pr1', projectName: 'Novak',
        totalQty: 2, usedQty: 0, availableQty: 2,
        laborDays: 2, laborWorkers: 2, workerDaysPerUnit: 4,
        materialCount: 0, hasEssential: false, status: '', missingLabor: false, ...over,
    });

    test('KORISNIKOV PRIMJER: ponuda 2 radnika × 2 dana, 4 radnika → 1 dan', () => {
        const d = blockDataFromProducts([{ candidate: cand(), qty: 1 }]);
        expect(d.workerDays).toBe(4);
        // Trajanje je odluka ekipe: 4 radnik-dana ÷ 4 čovjeka = 1 radni dan
        // (workingDaysNeeded to potvrđuje u canvasGeometry.test.ts)
    });

    test('radnik-dani se množe količinom', () => {
        expect(blockDataFromProducts([{ candidate: cand(), qty: 3 }]).workerDays).toBe(12);
    });

    test('više proizvoda se zbraja', () => {
        const d = blockDataFromProducts([
            { candidate: cand(), qty: 1 },
            { candidate: cand({ productId: 'p2', productName: 'Ormar', workerDaysPerUnit: 6 }), qty: 2 },
        ]);
        expect(d.workerDays).toBe(16);
        expect(d.productRefs.map(r => r.name)).toEqual(['Kuhinja', 'Ormar']);
    });

    test('jedan projekt → blok naslijedi projekt', () => {
        const d = blockDataFromProducts([{ candidate: cand(), qty: 1 }]);
        expect(d.projectRef).toEqual({ id: 'pr1', name: 'Novak' });
        expect(d.title).toBe('Kuhinja');
    });

    test('više projekata → BEZ projekta (bilo koji izbor bi bio proizvoljan)', () => {
        const d = blockDataFromProducts([
            { candidate: cand(), qty: 1 },
            { candidate: cand({ projectId: 'pr2', projectName: 'Begović' }), qty: 1 },
        ]);
        expect(d.projectRef).toBeUndefined();
        expect(d.title).toBe('2 proizvoda');
    });

    test('naslov nosi projekt kad je jedan', () => {
        const d = blockDataFromProducts([
            { candidate: cand(), qty: 1 },
            { candidate: cand({ productId: 'p2', productName: 'Ormar' }), qty: 1 },
        ]);
        expect(d.title).toBe('Novak — 2 proizvoda');
    });

    test('proizvodi bez rada u ponudi se broje (upozorenje korisniku)', () => {
        const d = blockDataFromProducts([
            { candidate: cand({ missingLabor: true, workerDaysPerUnit: 0 }), qty: 1 },
        ]);
        expect(d.missingLaborCount).toBe(1);
        expect(d.workerDays).toBe(0);
    });

    test('prazan izbor ne ruši', () => {
        const d = blockDataFromProducts([]);
        expect(d.workerDays).toBe(0);
        expect(d.productRefs).toEqual([]);
    });
});

// ════════════════════════════════════════════════════════════════════
describe('proizvodi → narudžbe po dobavljaču', () => {
    const withMaterials = () => [project({
        products: [product({
            materials: [
                mat({ ID: 'm1', Material_Name: 'Iveral 18', Supplier: 'Frischeis', Total_Price: 500, Is_Essential: true }),
                mat({ ID: 'm2', Material_Name: 'Furnir jasen', Supplier: 'Frischeis', Total_Price: 300 }),
                mat({ ID: 'm3', Material_Name: 'Vodilice Blum', Supplier: 'Schachermayer', Total_Price: 150 }),
            ],
        })],
    })];

    test('grupisano po dobavljaču, skuplji prvi', () => {
        const g = groupMaterialsForProducts(withMaterials(), ['p1']);
        expect(g.map(x => x.supplierName)).toEqual(['Frischeis', 'Schachermayer']);
        expect(g[0].totalPrice).toBe(800);
        expect(g[0].lines).toHaveLength(2);
    });

    test('esencijalni materijal označava grupu — ona gate-uje početak', () => {
        const g = groupMaterialsForProducts(withMaterials(), ['p1']);
        expect(g.find(x => x.supplierName === 'Frischeis')!.hasEssential).toBe(true);
        expect(g.find(x => x.supplierName === 'Schachermayer')!.hasEssential).toBe(false);
    });

    test('već primljeno/na stanju se NE planira ponovo', () => {
        const projects = [project({
            products: [product({
                materials: [
                    mat({ ID: 'm1', Status: 'Primljeno' }),
                    mat({ ID: 'm2', Status: 'Na stanju' }),
                    mat({ ID: 'm3', Status: 'Nije naručeno' }),
                ],
            })],
        })];
        expect(groupMaterialsForProducts(projects, ['p1'])[0].lines).toHaveLength(1);
        expect(groupMaterialsForProducts(projects, ['p1'], { includeSettled: true })[0].lines).toHaveLength(3);
    });

    test('filter po dobavljaču', () => {
        const g = groupMaterialsForProducts(withMaterials(), ['p1'], { supplierFilter: 'Schachermayer' });
        expect(g).toHaveLength(1);
        expect(g[0].lines[0].name).toBe('Vodilice Blum');
    });

    test('filter po tipu materijala (iz naziva)', () => {
        const g = groupMaterialsForProducts(withMaterials(), ['p1'], { typeFilter: 'furnir' });
        expect(g).toHaveLength(1);
        expect(g[0].lines).toHaveLength(1);
        expect(g[0].lines[0].name).toBe('Furnir jasen');
    });

    test('dostupni tipovi za filter', () => {
        const types = availableMaterialTypes(groupMaterialsForProducts(withMaterials(), ['p1']));
        expect(types).toContain('iveral');
        expect(types).toContain('furnir');
        expect(types).toContain('vodilice');
    });

    test('proizvod koji nije izabran se ne uzima', () => {
        expect(groupMaterialsForProducts(withMaterials(), ['drugi'])).toEqual([]);
    });

    test('materijal bez dobavljača dobija čitljiv naziv', () => {
        const projects = [project({ products: [product({ materials: [mat({ Supplier: '' })] })] })];
        expect(groupMaterialsForProducts(projects, ['p1'])[0].supplierName).toBe('Nepoznat dobavljač');
    });

    test('podaci purchase bloka iz grupe', () => {
        const g = groupMaterialsForProducts(withMaterials(), ['p1'])[0];
        const data = purchaseDataFromGroup(g, 's1');
        expect(data.title).toBe('Frischeis');
        expect(data.supplierRef).toEqual({ id: 's1', name: 'Frischeis' });
        expect(data.materialNames).toEqual(['Iveral 18', 'Furnir jasen']);
    });
});
