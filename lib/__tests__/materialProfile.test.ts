import { buildMaterialProfile, mergeMaterialProfiles, type ProfileMaterialLite } from '../snapshot/materialProfile';

// STVARNA sastavnica iz pogona: „ST15 Sprat/Biblioteka" (3710×2920×450), 2788.74 KM.
// Naziv proizvoda ne daje nijedan tip — sastavnica daje cijelu sliku.
const BIBLIOTEKA: ProfileMaterialLite[] = [
    { Material_Name: 'KT / Textil F416 22 / 1', Quantity: 150, Unit: 'm', Total_Price: 225.00, Supplier: 'Frischeis' },
    { Material_Name: 'Oblikovna špera', Quantity: 3, Unit: 'Kom', Total_Price: 450.00, Supplier: 'Frischeis' },
    { Material_Name: 'Stelujuce nogice - 103323535', Quantity: 10, Unit: 'Kom', Total_Price: 20.00, Supplier: 'Schachermayer' },
    { Material_Name: 'Parsol / Bronza', Quantity: 0.5, Unit: 'm²', Total_Price: 43.74, Supplier: 'Frischeis' },
    { Material_Name: 'MDF 18', Quantity: 5, Unit: 'Kom', Total_Price: 500.00, Supplier: 'Frischeis' },
    { Material_Name: 'Vodilice Blum 350', Quantity: 3, Unit: 'Kom', Total_Price: 150.00, Supplier: 'Schachermayer' },
    { Material_Name: 'Furnir / Jasen', Quantity: 16, Unit: 'm2', Total_Price: 480.00, Supplier: 'Frischeis' },
    { Material_Name: 'Iveral / F416 Textil Bež', Quantity: 4, Unit: 'Kom', Total_Price: 560.00, Supplier: 'Frischeis' },
    { Material_Name: 'Lakiranje', Quantity: 16, Unit: 'm2', Total_Price: 240.00, Supplier: 'Interni' },
    { Material_Name: 'Baglama ravna (sa ublazivacem)', Quantity: 20, Unit: 'Kom', Total_Price: 120.00, Supplier: 'Schachermayer' },
];

describe('pokretači rada — ono što stvarno određuje trajanje', () => {
    const p = buildMaterialProfile(BIBLIOTEKA);

    test('mjerljive količine se izvlače iz sastavnice', () => {
        expect(p.Drivers.edge_m).toBe(150);        // 150 m kanta → kantiranje
        expect(p.Drivers.veneer_m2).toBe(16);      // 16 m² furnira → furniranje
        expect(p.Drivers.lacquer_m2).toBe(16);     // 16 m² lakiranja → lakirnica
        expect(p.Drivers.hinges).toBe(20);         // 20 baglama → ~10 vrata
        expect(p.Drivers.slides).toBe(3);          // 3 vodilice → 3 ladice
        expect(p.Drivers.legs).toBe(10);           // nogice → STOJEĆI element
        expect(p.Drivers.glass_m2).toBe(0.5);      // Parsol = tonirano staklo
    });

    test('ploče se sabiraju preko tipova (iveral + MDF + špera)', () => {
        expect(p.Drivers.boards).toBe(4 + 5 + 3);
    });

    test('pokretač se NE puni kad jedinica ne odgovara — bolje bez podatka nego izmišljen', () => {
        const q = buildMaterialProfile([
            { Material_Name: 'Furnir hrast', Quantity: 7, Unit: 'Kom', Total_Price: 100 },
        ]);
        expect(q.Drivers.veneer_m2).toBeUndefined();   // furnir „na komad" nije m² furnira
    });

    test('odsutan pokretač znači NEMA PODATKA, ne nula', () => {
        const q = buildMaterialProfile([{ Material_Name: 'MDF 18', Quantity: 2, Unit: 'Kom', Total_Price: 100 }]);
        expect(q.Drivers.boards).toBe(2);
        expect('hinges' in q.Drivers).toBe(false);
    });
});

describe('tri nivoa čitanja sastavnice', () => {
    const p = buildMaterialProfile(BIBLIOTEKA);

    test('1. prisutnost — koji tipovi postoje', () => {
        for (const t of ['kant', 'sper', 'nogice', 'staklo', 'mdf', 'vodilice', 'furnir', 'iveral', 'lak', 'sarke']) {
            expect(p.Types).toContain(t);
        }
    });

    test('2. dominacija — trošak po tipu razlikuje lajsnu od nosive građe', () => {
        expect(p.Cost_By_Type.iveral).toBe(560);
        expect(p.Cost_By_Type.sper).toBe(450);
        expect(p.Cost_By_Type.nogice).toBe(20);
        // Ista prisutnost, potpuno različita težina u poslu:
        expect(p.Cost_By_Type.iveral).toBeGreaterThan(p.Cost_By_Type.nogice * 20);
    });

    test('3. pokrivenost se mjeri NOVCEM, ne brojem redova', () => {
        // Nepoznato je samo „Stelujuce nogice" prije nego je tip dodan → sada 100%
        expect(p.Coverage).toBe(1);
    });
});

describe('neprepoznato se ne gubi', () => {
    test('nepoznat naziv ide u Unmatched, ne nestaje tiho (v2 ponašanje)', () => {
        const p = buildMaterialProfile([
            { Material_Name: 'Bukova lamperija XY-9', Quantity: 5, Unit: 'm2', Total_Price: 300 },
            { Material_Name: 'MDF 18', Quantity: 1, Unit: 'Kom', Total_Price: 100 },
        ]);
        expect(p.Unmatched).toEqual(['Bukova lamperija XY-9']);
        expect(p.Coverage).toBe(0.25);   // 100 od 400 KM klasifikovano
    });

    test('isti nepoznat naziv se ne duplira', () => {
        const p = buildMaterialProfile([
            { Material_Name: 'Artikal XY', Quantity: 1, Unit: 'Kom', Total_Price: 10 },
            { Material_Name: 'Artikal XY', Quantity: 2, Unit: 'Kom', Total_Price: 20 },
        ]);
        expect(p.Unmatched).toEqual(['Artikal XY']);
    });

    test('prazna sastavnica → pokrivenost null (ne 0 — nema šta pokriti)', () => {
        expect(buildMaterialProfile([]).Coverage).toBeNull();
    });
});

describe('usluge u sastavnici', () => {
    test('„Lakiranje" kod dobavljača Interni je USLUGA, ali i dalje daje pokretač', () => {
        const p = buildMaterialProfile(BIBLIOTEKA);
        expect(p.Service_Lines).toEqual([
            { name: 'Lakiranje', quantity: 16, unit: 'm2', total: 240 },
        ]);
        expect(p.Drivers.lacquer_m2).toBe(16);   // 16 m² je stvarna količina rada
    });
});

describe('spajanje profila na nivou naloga', () => {
    test('pokretači i trošak se sabiraju, tipovi se dedupliraju', () => {
        const a = buildMaterialProfile([{ Material_Name: 'Furnir jasen', Quantity: 10, Unit: 'm2', Total_Price: 300 }]);
        const b = buildMaterialProfile([{ Material_Name: 'Furnir hrast', Quantity: 6, Unit: 'm2', Total_Price: 200 }]);
        const m = mergeMaterialProfiles([a, b]);
        expect(m.Drivers.veneer_m2).toBe(16);
        expect(m.Cost_By_Type.furnir).toBe(500);
        expect(m.Types).toEqual(['furnir']);
    });
});
