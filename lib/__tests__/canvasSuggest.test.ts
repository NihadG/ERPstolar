import { suggestDurationForCandidate } from '../canvas/suggest';
import { collectProductCandidates } from '../canvas/fromProducts';
import type { Project, Product, ProductionSnapshot, ProductionSnapshotItem } from '../types';

let seq = 0;
const item = (over: Partial<ProductionSnapshotItem> = {}): ProductionSnapshotItem => ({
    Product_ID: `p${++seq}`, Product_Name: 'Komoda', Product_Types: ['komoda'],
    Material_Types: [], Height: 0, Width: 0, Depth: 0, Volume_M3: 0, Surface_M2: 0, Quantity: 1,
    Materials: [], Material_Count: 0, Has_Glass: false, Has_Alu_Door: false,
    Total_Material_Cost: 0, Material_Per_M2: 0, Material_Per_M3: 0, Material_Per_Unit: 0,
    Planned_Labor_Days: 0, Actual_Labor_Days: 4, Workers_Assigned: [], Processes: [],
    Selling_Price: 0, Margin_Percent: 0, Margin_Type: 'Percentage',
    LED_Meters: 0, LED_Price_Per_Meter: 0, LED_Total: 0, Transport_Share: 0,
    Extras: [], Profit: 0, Margin_Applied: 0, ...over,
} as ProductionSnapshotItem);

const snap = (over: Partial<ProductionSnapshot> = {}): ProductionSnapshot => ({
    Snapshot_ID: `s${++seq}`, Organization_ID: 'org', Work_Order_ID: `wo${seq}`,
    Work_Order_Number: 'X', Created_At: '', Snapshot_Version: 3,
    Project_ID: '', Client_Name: '', Project_Deadline: '',
    Items: [item()], Normalized_Product_Types: ['komoda'],
    Total_Products: 1, Total_Quantity: 1, Total_Material_Cost: 0, Total_Selling_Price: 0,
    Avg_Material_Per_M2: 0, Avg_Material_Per_M3: 0,
    Planned_Days: 0, Actual_Days: 4, Duration_Variance: 0,
    Planned_Labor_Cost: 0, Actual_Labor_Cost: 0, Labor_Cost_Variance: 0, Labor_Variance_Percent: 0,
    Gross_Profit: 0, Net_Profit: 0, Profit_Margin_Percent: 0,
    Workers_Count: 0, Total_Worker_Days: 0, Avg_Daily_Rate: 0,
    Production_Steps: [], Month: 7, Quarter: 3, Day_Of_Week_Start: 1,
    Quality_Score: 100, Data_Issues: [], Is_Valid_For_AI: true,
    Materials_Snapshot_Time: '', Materials_Are_Final: true, ...over,
} as ProductionSnapshot);

describe('suggestDurationForCandidate', () => {
    test('bez tipova (prazan proizvod) → null, ne pogađa se', () => {
        expect(suggestDurationForCandidate({ productTypes: [], materialTypes: [] }, [snap()])).toBeNull();
    });

    test('prazna istorija → null (nema šta popustiti)', () => {
        expect(suggestDurationForCandidate({ productTypes: ['kuhinja'], materialTypes: [] }, [])).toBeNull();
    });

    test('nepoklapajući tip proizvoda → null (findComparable bi inače popustio na "sve")', () => {
        // findComparable popušta do praznog upita interno — ali suggest.ts to NE
        // prihvata kao prijedlog jer bi to bio prosjek preko slučajno bilo čega,
        // primijenjen jednim klikom bez konteksta koji "relaxed" inače daje korisniku.
        const r = suggestDurationForCandidate(
            { productTypes: ['kuhinja'], materialTypes: [] },
            [snap({ Items: [item({ Product_Types: ['ormar'] })], Normalized_Product_Types: ['ormar'] })]
        );
        expect(r).toBeNull();
    });

    test('materijal drugog tipa (bez tipa proizvoda) → null iz istog razloga', () => {
        const r = suggestDurationForCandidate(
            { productTypes: [], materialTypes: ['furnir'] },
            [snap({ Items: [item({ Product_Types: [], Material_Types: ['iveral'] })], Normalized_Product_Types: [] })]
        );
        expect(r).toBeNull();
    });

    test('dovoljno istorije → prijedlog s medijanom i opisom', () => {
        const snaps = [4, 4, 4, 5, 3].map(d => snap({ Items: [item({ Actual_Labor_Days: d })] }));
        const r = suggestDurationForCandidate({ productTypes: ['komoda'], materialTypes: [] }, snaps);
        expect(r).not.toBeNull();
        expect(r!.workerDaysPerUnit).toBe(4);
        expect(r!.description.length).toBeGreaterThan(0);
    });

    test('n=1-2 vraća prijedlog niske pouzdanosti (examples), ne null', () => {
        const r = suggestDurationForCandidate(
            { productTypes: ['komoda'], materialTypes: [] },
            [snap({ Items: [item({ Actual_Labor_Days: 6 })] })]
        );
        expect(r).not.toBeNull();
        expect(r!.result.confidence).toBe('examples');
    });

    test('materialTypes se koristi kad productTypes ne postoji (npr. Zadaci nalog)', () => {
        const snaps = [snap({
            Items: [item({ Product_Types: [], Material_Types: ['furnir'] })],
            Normalized_Product_Types: [],
        })];
        const r = suggestDurationForCandidate({ productTypes: [], materialTypes: ['furnir'] }, snaps);
        expect(r).not.toBeNull();
    });

    test('integracija s collectProductCandidates: tipovi se popune iz naziva i sastavnice', () => {
        const project: Project = {
            Project_ID: 'pr1', Organization_ID: 'org', Name: 'Novak', Client_Name: 'Novak',
            Status: 'U proizvodnji', Client_Phone: '', Client_Email: '', Address: '',
            products: [{
                Product_ID: 'p1', Name: 'Kuhinja donji', Project_ID: 'pr1', Quantity: 1,
                Status: '', Material_Cost: 0, Notes: '',
                materials: [{
                    ID: 'm1', Organization_ID: 'org', Product_ID: 'p1', Material_ID: 'c1',
                    Material_Name: 'Furnir jasen', Quantity: 1, Unit: 'm2', Unit_Price: 1,
                    Total_Price: 1, Status: 'Nije naručeno', Supplier: '', Order_ID: '',
                }],
            }] as Product[],
            offers: [],
        } as unknown as Project;

        const [candidate] = collectProductCandidates([project], []);
        expect(candidate.productTypes).toContain('kuhinja');
        expect(candidate.materialTypes).toContain('furnir');

        const r = suggestDurationForCandidate(candidate, [
            snap({ Items: [item({ Product_Types: ['kuhinja'], Material_Types: ['furnir'], Actual_Labor_Days: 7 })] }),
        ]);
        expect(r!.workerDaysPerUnit).toBe(7);
    });
});
