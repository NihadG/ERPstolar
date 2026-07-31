// ════════════════════════════════════════════════════════════════════
// NEDOSTACI PODATAKA — normalizacija i grupisanje
//
// Šest sirovih provjera → jedan spisak → grupe (teži prvi). Provjeravamo da se
// svaka vrsta mapira, da se procesi i troškovi grupišu po nalogu, i da samo
// materijal-bez-cijene nosi inline popravku.
// ════════════════════════════════════════════════════════════════════

import { buildDataGaps, groupDataGaps, type DataGapInput } from '@/lib/insights/dataGaps';

const TODAY = '2026-07-15';

describe('buildDataGaps', () => {
    it('mapira svih šest vrsta', () => {
        const input: DataGapInput = {
            today: TODAY,
            zeroMaterialCost: [{ Work_Order_Item_ID: 'i1', Product_Name: 'Kuhinja', Has_Materials: true, Material_Count: 3, Planned_Start_Date: '2026-07-16', Work_Order_Number: 'R1' }],
            montaza: [{ itemId: 'i2', itemName: 'Ormar', workOrderId: 'wo2', workOrderNumber: 'R2', processName: 'Montaža' }],
            attendance: { warnings: [{ Worker_Name: 'Mujo' }, { Worker_Name: 'Haso' }], missingCount: 2 },
            zeroRate: [{ workerId: 'w1', workerName: 'Suljo', itemNames: ['A', 'B', 'C'] }],
            processesWithoutWorkers: [{ itemId: 'i3', itemName: 'Vrata', processName: 'Bušenje', workOrderId: 'wo3', workOrderNumber: 'R3' }],
            missingCostFields: [{ itemId: 'i4', itemName: 'Polica', workOrderId: 'wo4', workOrderNumber: 'R4', missingFields: ['Planned_Labor_Cost'] }],
        };
        const gaps = buildDataGaps(input);
        const kinds = gaps.map(g => g.kind).sort();
        expect(kinds).toEqual([
            'attendance-missing', 'costs-missing', 'material-cost-zero',
            'montaza-unassigned', 'process-unassigned', 'zero-rate',
        ]);
    });

    it('samo materijal-bez-cijene nosi inline popravku', () => {
        const gaps = buildDataGaps({
            zeroMaterialCost: [{ Work_Order_Item_ID: 'i1', Product_Name: 'Kuhinja' }],
            montaza: [{ itemId: 'i2', itemName: 'Ormar', workOrderId: 'wo2', processName: 'Montaža' }],
        });
        const withFix = gaps.filter(g => g.fix);
        expect(withFix).toHaveLength(1);
        expect(withFix[0].fix).toEqual({ kind: 'material-cost', workOrderItemId: 'i1' });
    });

    it('grupiše procese bez radnika po nalogu (jedan red po nalogu)', () => {
        const gaps = buildDataGaps({
            processesWithoutWorkers: [
                { itemId: 'a', itemName: 'X', processName: 'Rezanje', workOrderId: 'wo9', workOrderNumber: 'R9' },
                { itemId: 'b', itemName: 'Y', processName: 'Bušenje', workOrderId: 'wo9', workOrderNumber: 'R9' },
            ],
        });
        expect(gaps).toHaveLength(1);
        expect(gaps[0].detail).toContain('2 procesa');
    });

    it('prazan ulaz → prazan spisak', () => {
        expect(buildDataGaps({})).toEqual([]);
        expect(buildDataGaps({ attendance: { warnings: [], missingCount: 0 } })).toEqual([]);
    });

    it('startLabel: danas / sutra', () => {
        const gapDanas = buildDataGaps({ today: TODAY, zeroMaterialCost: [{ Work_Order_Item_ID: 'i', Product_Name: 'P', Planned_Start_Date: TODAY }] });
        expect(gapDanas[0].detail).toContain('danas');
        const gapSutra = buildDataGaps({ today: TODAY, zeroMaterialCost: [{ Work_Order_Item_ID: 'i', Product_Name: 'P', Planned_Start_Date: '2026-07-16' }] });
        expect(gapSutra[0].detail).toContain('sutra');
    });
});

describe('groupDataGaps', () => {
    it('teži nedostaci (high) dolaze prije lakših (medium)', () => {
        const gaps = buildDataGaps({
            processesWithoutWorkers: [{ itemId: 'a', itemName: 'X', processName: 'R', workOrderId: 'wo1', workOrderNumber: 'R1' }], // medium
            montaza: [{ itemId: 'b', itemName: 'Y', workOrderId: 'wo2', processName: 'Montaža' }],                                    // high
        });
        const groups = groupDataGaps(gaps);
        expect(groups[0].severity).toBe('high');
        expect(groups[0].kind).toBe('montaza-unassigned');
        expect(groups[groups.length - 1].severity).toBe('medium');
    });

    it('grupiše više redova iste vrste zajedno', () => {
        const gaps = buildDataGaps({
            zeroRate: [
                { workerId: 'w1', workerName: 'A', itemNames: ['x'] },
                { workerId: 'w2', workerName: 'B', itemNames: ['y'] },
            ],
        });
        const groups = groupDataGaps(gaps);
        expect(groups).toHaveLength(1);
        expect(groups[0].gaps).toHaveLength(2);
    });
});
