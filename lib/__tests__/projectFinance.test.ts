import {
    buildFinanceBasis, itemFinance, buildLaborIndex, computeProjectsFinance, computeProjectFinance,
    isVoidedLog, liveLogs, sumStage,
    type FinProduct, type FinOffer, type FinWorkOrder, type FinLog,
} from '../projectFinance';

// ── Fiksture ───────────────────────────────────────────────────────
const product = (id: string, opts: Partial<FinProduct> & { bom?: number } = {}): FinProduct => ({
    Product_ID: id, Project_ID: opts.Project_ID || 'P1', Name: opts.Name || id,
    Quantity: opts.Quantity ?? 1, Status: opts.Status || 'Na čekanju',
    materials: opts.materials || (opts.bom != null ? [{ Total_Price: opts.bom }] : []),
});
const offer = (id: string, lines: { pid: string; sell: number; qty?: number; mat?: number; extras?: number; labor?: [number, number, number]; included?: boolean }[], opts: Partial<FinOffer> = {}): FinOffer => ({
    Offer_ID: id, Project_ID: opts.Project_ID || 'P1', Offer_Number: opts.Offer_Number || id,
    Status: opts.Status || 'Prihvaćeno', Accepted_Date: opts.Accepted_Date || '2026-07-01',
    Transport_Cost: opts.Transport_Cost || 0, Onsite_Assembly: opts.Onsite_Assembly, Onsite_Discount: opts.Onsite_Discount,
    products: lines.map(l => ({
        Product_ID: l.pid, Included: l.included ?? true, Quantity: l.qty ?? 1,
        Selling_Price: l.sell, Total_Price: l.sell * (l.qty ?? 1), Material_Cost: l.mat ?? 0,
        Labor_Workers: l.labor?.[0] ?? 0, Labor_Days: l.labor?.[1] ?? 0, Labor_Daily_Rate: l.labor?.[2] ?? 0,
        extras: l.extras ? [{ Total: l.extras }] : [],
    })),
});
const wo = (id: string, items: FinWorkOrder['items'], opts: Partial<FinWorkOrder> = {}): FinWorkOrder => ({
    Work_Order_ID: id, Work_Order_Number: id, Status: opts.Status || 'U toku', Work_Order_Type: opts.Work_Order_Type || 'Proizvodnja', items,
});
const log = (itemId: string, rate: number, extra: Partial<FinLog> = {}): FinLog => ({
    Work_Order_Item_ID: itemId, Daily_Rate: rate, Day_Fraction: 1, Date: '2026-09-01', Worker_ID: 'W1', ...extra,
});

describe('buildFinanceBasis — prihod iz PRIHVAĆENE ponude', () => {
    test('samo prihvaćene ponude i uključeni proizvodi; ugovoreno = Σ', () => {
        const basis = buildFinanceBasis([product('A'), product('B'), product('C')], [
            offer('O1', [{ pid: 'A', sell: 1000 }, { pid: 'B', sell: 500, included: false }]),
            offer('O2', [{ pid: 'C', sell: 700 }], { Status: 'Poslano' }),
        ]);
        expect(basis.offerLines.get('A')?.unitPrice).toBe(1000);
        expect(basis.offerLines.has('B')).toBe(false);
        expect(basis.offerLines.has('C')).toBe(false);
        expect(basis.contracts.get('P1')?.total).toBe(1000);
    });

    test('više prihvaćenih ponuda (faze) se sabiraju; isti proizvod → novije prihvaćena', () => {
        const basis = buildFinanceBasis([product('A'), product('B')], [
            offer('STARA', [{ pid: 'A', sell: 100 }, { pid: 'B', sell: 200 }], { Accepted_Date: '2026-04-01' }),
            offer('NOVA', [{ pid: 'A', sell: 150 }], { Accepted_Date: '2026-08-01' }),
        ]);
        expect(basis.offerLines.get('A')?.offerNumber).toBe('NOVA');
        expect(basis.offerLines.get('A')?.unitPrice).toBe(150);
        expect(basis.offerLines.get('B')?.unitPrice).toBe(200);
        expect(basis.contracts.get('P1')?.total).toBe(350);
    });

    test('transport i popust za montažu se raspodijele srazmjerno vrijednosti stavki', () => {
        const basis = buildFinanceBasis([product('A'), product('B')], [
            offer('O1', [{ pid: 'A', sell: 300 }, { pid: 'B', sell: 100 }], { Transport_Cost: 100, Onsite_Assembly: true, Onsite_Discount: 20 }),
        ]);
        expect(basis.offerLines.get('A')?.total).toBe(360);   // 300 + 80 × 0.75
        expect(basis.offerLines.get('B')?.total).toBe(120);   // 100 + 80 × 0.25
        expect(basis.contracts.get('P1')?.total).toBe(480);   // = Total ponude
    });

    test('živa sastavnica po komadu = Σ Total_Price materijala', () => {
        const basis = buildFinanceBasis([product('A', { materials: [{ Total_Price: 120 }, { Total_Price: 30.5 }] })], []);
        expect(basis.products.get('A')?.unitMaterial).toBe(150.5);
    });
});

describe('itemFinance — stavka naloga', () => {
    const basis = buildFinanceBasis(
        [product('A', { bom: 200, Quantity: 2 })],
        [offer('O1', [{ pid: 'A', sell: 1000, qty: 2, mat: 180, extras: 50, labor: [2, 1, 100] }])],
    );

    test('proizvod: prihod = cijena iz ponude × kol., materijal = (sastavnica + dodaci) × kol.', () => {
        const f = itemFinance({ ID: 'i1', Product_ID: 'A', Quantity: 2, Product_Value: 1, Material_Cost: 999 }, { Work_Order_Type: 'Proizvodnja' }, basis, 300);
        expect(f.revenue).toBe(2000);
        expect(f.materialBom).toBe(400);
        expect(f.materialExtras).toBe(100);
        expect(f.material).toBe(500);
        expect(f.labor).toBe(300);
        expect(f.profit).toBe(1200);
        expect(f.revenueSource).toBe('ponuda');
        expect(f.plannedMaterial).toBe(460);   // (180 + 50) × 2
        expect(f.plannedLabor).toBe(400);      // 2 × 1 × 100 × 2
    });

    test('montaža: samo rad, bez obzira na sačuvane vrijednosti', () => {
        const f = itemFinance({ ID: 'm1', Product_ID: 'A', Quantity: 2, Product_Value: 5000, Material_Cost: 100 }, { Work_Order_Type: 'Montaža' }, basis, 80);
        expect(f.revenue).toBe(0);
        expect(f.material).toBe(0);
        expect(f.profit).toBe(-80);
        expect(f.kind).toBe('montaza');
    });

    test('proizvod bez prihvaćene ponude → cijena s naloga (ručna cijena ima prednost)', () => {
        const f1 = itemFinance({ ID: 'x', Product_ID: 'NEMA', Quantity: 1, Product_Value: 700, Material_Cost: 100 }, undefined, basis, 0);
        expect(f1.revenue).toBe(700);
        expect(f1.revenueSource).toBe('nalog');
        expect(f1.material).toBe(100);     // proizvod nepoznat → zadnji poznati trošak sa stavke
        const f2 = itemFinance({ ID: 'y', Product_ID: 'NEMA', Product_Value: 700, Profit_Overrides: { Selling_Price: 900 } }, undefined, basis, 0);
        expect(f2.revenue).toBe(900);
    });

    test('razni posao ostaje na staroj formuli (vrijednost − materijal − ostalo − rad)', () => {
        const f = itemFinance({ ID: 'c', Item_Type: 'custom', Product_Value: 500, Material_Cost: 50, Quantity: 2, Other_Costs: 30 }, undefined, basis, 100);
        expect(f.kind).toBe('razno');
        expect(f.profit).toBe(500 - 100 - 30 - 100);
    });
});

describe('dnevnice obrisanih naloga se ne broje', () => {
    test('isVoidedLog / liveLogs', () => {
        const logs = [log('i1', 100), log('i1', 50, { Work_Order_Deleted: true })];
        expect(isVoidedLog(logs[1])).toBe(true);
        expect(liveLogs(logs)).toHaveLength(1);
        expect(buildLaborIndex(logs, []).byItem.get('i1')?.cost).toBe(100);
    });
});

describe('computeProjectsFinance — profit = završeni proizvodi', () => {
    const products = [
        product('A', { bom: 300 }),                       // završen
        product('B', { bom: 100 }),                       // u izradi
        product('C', { bom: 50 }),                        // nije započet
        product('D', { bom: 40, Status: 'Spremno' }),     // status gotov, a bez naloga → NIJE u profitu
    ];
    const offers = [offer('O1', [
        { pid: 'A', sell: 1000, mat: 250, labor: [1, 2, 100] },
        { pid: 'B', sell: 800, extras: 60 },
        { pid: 'C', sell: 400 },
        { pid: 'D', sell: 200 },
    ])];
    const workOrders = [
        wo('W1', [{ ID: 'a1', Product_ID: 'A', Project_ID: 'P1', Quantity: 1, Status: 'Završeno', Completed_At: '2026-09-10T10:00:00Z', Product_Value: 1 }], { Status: 'Završeno' }),
        wo('W2', [{ ID: 'b1', Product_ID: 'B', Project_ID: 'P1', Quantity: 1, Status: 'U toku' }]),
        wo('M1', [{ ID: 'am', Product_ID: 'A', Project_ID: 'P1', Quantity: 1, Status: 'U toku' }], { Work_Order_Type: 'Montaža' }),
        wo('X1', [{ ID: 'ax', Product_ID: 'A', Project_ID: 'P1', Quantity: 1, Status: 'U toku' }], { Status: 'Otkazano' }),
    ];
    const logs = [
        log('a1', 150), log('a1', 100),           // proizvodnja A
        log('am', 60),                            // montaža A → rad proizvoda A
        log('ax', 40),                            // otkazan nalog A → isplaćen rad, broji se
        log('a1', 999, { Work_Order_Deleted: true }),  // obrisan nalog → ne broji se
        log('b1', 70),
    ];
    const basis = buildFinanceBasis(products, offers);
    const labor = buildLaborIndex(logs, workOrders);
    const fin = computeProjectFinance({ projectId: 'P1', products, basis, workOrders, labor, logs });
    const row = (id: string) => fin.products.find(p => p.productId === id)!;

    test('faze proizvoda', () => {
        expect(row('A').stage).toBe('zavrseno');
        expect(row('A').completedAt).toBe('2026-09-10');
        expect(row('B').stage).toBe('u_izradi');
        expect(row('C').stage).toBe('nije_zapoceto');
        // Profit samo iz završenih NALOGA: ručno „gotov" bez naloga nije završen, nego za provjeru.
        expect(row('D').stage).toBe('nije_zapoceto');
        expect(row('D').flags.withoutWorkOrder).toBe(true);
        expect(fin.flagged).toBeGreaterThanOrEqual(1);
    });

    test('proizvod A: ponuda − živa sastavnica − SAV rad (proizvodnja + montaža + otkazani)', () => {
        const a = row('A');
        expect(a.revenue).toBe(1000);
        expect(a.material).toBe(300);
        expect(a.labor).toBe(150 + 100 + 60 + 40);
        expect(a.cancelledLabor).toBe(40);
        expect(a.profit).toBe(1000 - 300 - 350);
        expect(a.plannedLabor).toBe(200);
        expect(a.plannedProfit).toBe(1000 - 250 - 200);
    });

    test('profit projekta = samo završeni proizvodi; u izradi se prati odvojeno', () => {
        expect(fin.realized.count).toBe(1);
        expect(fin.realized.revenue).toBe(1000);
        expect(fin.profit).toBe(row('A').profit);
        expect(fin.inProgress.count).toBe(1);
        expect(fin.inProgress.revenue).toBe(800);
        expect(fin.inProgress.material).toBe(160);   // 100 sastavnica + 60 dodaci
        expect(fin.inProgress.labor).toBe(70);
        expect(fin.notStarted).toEqual({ count: 2, contracted: 600, labor: 0 });   // C + D (ugovoreni, bez naloga)
        expect(fin.contracted).toBe(2400);
    });

    test('izmjena materijala nakon ponude ODMAH ulazi u trošak (nema zamrzavanja)', () => {
        const pricier = products.map(p => (p.Product_ID === 'A' ? product('A', { bom: 380 }) : p));
        const fin2 = computeProjectFinance({ projectId: 'P1', products: pricier, basis: buildFinanceBasis(pricier, offers), workOrders, labor, logs });
        expect(fin2.products.find(p => p.productId === 'A')!.material).toBe(380);
        expect(fin2.profit).toBe(fin.profit - 80);
    });

    test('Σ redova == projekat (invarijanta)', () => {
        const done = fin.products.filter(p => p.stage === 'zavrseno');
        expect(sumStage(done).profit).toBe(fin.realized.profit);
    });
});

describe('computeProjectsFinance — rubni slučajevi', () => {
    test('djelimično u nalogu (2 od 4 komada) je u izradi i kad su stavke završene', () => {
        const products = [product('A', { Quantity: 4, bom: 10 })];
        const offers = [offer('O', [{ pid: 'A', sell: 100, qty: 4 }])];
        const workOrders = [wo('W', [{ ID: 'a', Product_ID: 'A', Project_ID: 'P1', Quantity: 2, Status: 'Završeno' }], { Status: 'Završeno' })];
        const fin = computeProjectFinance({ projectId: 'P1', products, basis: buildFinanceBasis(products, offers), workOrders, labor: buildLaborIndex([], workOrders) });
        const a = fin.products[0];
        expect(a.stage).toBe('u_izradi');
        expect(a.revenue).toBe(200);
        expect(a.material).toBe(20);
        expect(fin.profit).toBe(0);
    });

    test('proizvod bez ponude: prihod s naloga + oznaka', () => {
        const products = [product('A', { bom: 10 })];
        const workOrders = [wo('W', [{ ID: 'a', Product_ID: 'A', Project_ID: 'P1', Quantity: 1, Status: 'Završeno', Product_Value: 500 }], { Status: 'Završeno' })];
        const fin = computeProjectFinance({ projectId: 'P1', products, basis: buildFinanceBasis(products, []), workOrders, labor: buildLaborIndex([], workOrders) });
        expect(fin.products[0].revenueSource).toBe('nalog');
        expect(fin.products[0].flags.noOffer).toBe(true);
        expect(fin.products[0].flags.noLabor).toBe(true);
        expect(fin.profit).toBe(490);
        expect(fin.flagged).toBe(1);
    });

    test('količina u ponudi ≠ količina proizvoda → oznaka', () => {
        const products = [product('A', { Quantity: 4 })];
        const offers = [offer('O', [{ pid: 'A', sell: 100, qty: 2 }])];
        const workOrders = [wo('W', [{ ID: 'a', Product_ID: 'A', Project_ID: 'P1', Quantity: 4, Status: 'U toku' }])];
        const fin = computeProjectFinance({ projectId: 'P1', products, basis: buildFinanceBasis(products, offers), workOrders, labor: buildLaborIndex([], workOrders) });
        expect(fin.products[0].flags.qtyMismatch).toBe(true);
        expect(fin.products[0].revenue).toBe(400);   // cijena po komadu × proizvedeno
    });

    test('razni nalog vezan za projekat ulazi u naslovni profit (kao i do sada)', () => {
        const workOrders = [wo('Z', [{ ID: 'z', Item_Type: 'custom', Project_ID: 'P1', Product_Value: 300, Quantity: 1 }], { Work_Order_Type: 'Zadaci' })];
        const logs = [log('z', 100)];
        const fin = computeProjectFinance({ projectId: 'P1', products: [], basis: buildFinanceBasis([], []), workOrders, labor: buildLaborIndex(logs, workOrders), logs });
        expect(fin.razni.count).toBe(1);
        expect(fin.profit).toBe(200);
    });

    test('rad starih naloga (prije učitanog prozora dnevnica) iz sačuvanog agregata', () => {
        const workOrders = [wo('W', [{ ID: 'a', Product_ID: 'A', Started_At: '2025-01-05T08:00:00Z', Actual_Labor_Cost: 640 }])];
        const idx = buildLaborIndex([], workOrders, '2025-10-01');
        expect(idx.byItem.get('a')?.cost).toBe(640);
        expect(idx.storedItems.has('a')).toBe(true);
        expect(buildLaborIndex([], workOrders).byItem.has('a')).toBe(false);
    });

    test('svi projekti u jednom prolazu == pojedinačni proračun', () => {
        const products = [product('A', { bom: 5 }), product('B', { Project_ID: 'P2', bom: 7 })];
        const offers = [offer('O1', [{ pid: 'A', sell: 50 }]), offer('O2', [{ pid: 'B', sell: 70 }], { Project_ID: 'P2' })];
        const workOrders = [wo('W', [
            { ID: 'a', Product_ID: 'A', Project_ID: 'P1', Status: 'Završeno' },
            { ID: 'b', Product_ID: 'B', Project_ID: 'P2', Status: 'Završeno' },
        ], { Status: 'Završeno' })];
        const logs = [log('a', 10), log('b', 20)];
        const basis = buildFinanceBasis(products, offers);
        const labor = buildLaborIndex(logs, workOrders);
        const all = computeProjectsFinance({ products, basis, workOrders, labor, logs });
        const p2 = computeProjectFinance({ projectId: 'P2', products, basis, workOrders, labor, logs });
        expect(all.get('P2')?.profit).toBe(p2.profit);
        expect(all.get('P1')?.profit).toBe(50 - 5 - 10);
        expect(p2.profit).toBe(70 - 7 - 20);
    });
});

describe('obim posla i završni račun', () => {
    test('nezapočet proizvod van prihvaćene ponude je „van ugovora" — ne broji se u n/m ni u „nije započeto"', () => {
        const products = [product('A', { bom: 10 }), product('B'), product('IZBACEN')];
        const offers = [offer('O', [{ pid: 'A', sell: 100 }, { pid: 'B', sell: 50 }])];
        const workOrders = [wo('W', [{ ID: 'a', Product_ID: 'A', Project_ID: 'P1', Status: 'Završeno' }], { Status: 'Završeno' })];
        const fin = computeProjectFinance({ projectId: 'P1', products, basis: buildFinanceBasis(products, offers), workOrders, labor: buildLaborIndex([], workOrders) });
        expect(fin.productCount).toBe(3);
        expect(fin.scopeCount).toBe(2);
        expect(fin.outOfContractCount).toBe(1);
        expect(fin.notStarted.count).toBe(1);   // samo B (ugovoren)
        expect(fin.finishedCount).toBe(1);
    });

    test('izdat završni račun ima prednost nad cijenom iz ponude', () => {
        const products = [product('A', { bom: 10 })];
        const offers = [offer('O', [{ pid: 'A', sell: 100 }])];
        const workOrders = [wo('W', [{ ID: 'a', Product_ID: 'A', Project_ID: 'P1', Status: 'Završeno', Profit_Overrides: { Selling_Price: 130, Notes: 'Završni račun R-7' } }], { Status: 'Završeno' })];
        const fin = computeProjectFinance({ projectId: 'P1', products, basis: buildFinanceBasis(products, offers), workOrders, labor: buildLaborIndex([], workOrders) });
        expect(fin.products[0].revenue).toBe(130);
        expect(fin.products[0].revenueSource).toBe('racun');
        expect(fin.profit).toBe(120);
    });
});
