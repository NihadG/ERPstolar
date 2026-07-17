/**
 * Broj naloga — novi format 2026-07/R1 + migracija starih brojeva.
 */

import {
    workOrderTypeLetter,
    letterWorkOrderType,
    formatWorkOrderNumber,
    parseWorkOrderNumber,
    isNewFormatWorkOrderNumber,
    nextWorkOrderNumber,
    effectiveOrderDate,
    planWorkOrderRenumber,
    type RenumberInput,
} from '../workOrderNumber';

describe('workOrderTypeLetter', () => {
    test('tip → slovo', () => {
        expect(workOrderTypeLetter('Proizvodnja')).toBe('R');
        expect(workOrderTypeLetter('Montaža')).toBe('M');
        expect(workOrderTypeLetter('Zadaci')).toBe('Z');
    });

    test('bez tipa = proizvodnja', () => {
        expect(workOrderTypeLetter(undefined)).toBe('R');
    });

    test('round-trip slovo ⇄ tip', () => {
        (['Proizvodnja', 'Montaža', 'Zadaci'] as const).forEach(t => {
            expect(letterWorkOrderType(workOrderTypeLetter(t))).toBe(t);
        });
    });
});

describe('formatWorkOrderNumber', () => {
    test('mjesec je uvijek dvocifren, broj nije dopunjen nulama', () => {
        expect(formatWorkOrderNumber({ year: 2026, month: 7, letter: 'R', seq: 1 })).toBe('2026-07/R1');
        expect(formatWorkOrderNumber({ year: 2026, month: 12, letter: 'M', seq: 12 })).toBe('2026-12/M12');
        expect(formatWorkOrderNumber({ year: 2026, month: 1, letter: 'Z', seq: 999 })).toBe('2026-01/Z999');
    });
});

describe('parseWorkOrderNumber', () => {
    test('parsira novi format', () => {
        expect(parseWorkOrderNumber('2026-07/R1')).toEqual({ year: 2026, month: 7, letter: 'R', seq: 1 });
        expect(parseWorkOrderNumber('2026-12/M12')).toEqual({ year: 2026, month: 12, letter: 'M', seq: 12 });
    });

    test('STARI format vraća null (ne smije se pobrkati s novim)', () => {
        expect(parseWorkOrderNumber('ZN-20260713-075307-241')).toBeNull();
        expect(parseWorkOrderNumber('RN-20260713-075307-241')).toBeNull();
        expect(parseWorkOrderNumber('MN-20260101-000000-000')).toBeNull();
    });

    test('odbija smeće i nevažeće vrijednosti', () => {
        expect(parseWorkOrderNumber('')).toBeNull();
        expect(parseWorkOrderNumber(undefined)).toBeNull();
        expect(parseWorkOrderNumber(null)).toBeNull();
        expect(parseWorkOrderNumber('2026-13/R1')).toBeNull();   // mjesec 13
        expect(parseWorkOrderNumber('2026-00/R1')).toBeNull();   // mjesec 0
        expect(parseWorkOrderNumber('2026-07/R0')).toBeNull();   // broj 0
        expect(parseWorkOrderNumber('2026-07/X1')).toBeNull();   // nepoznato slovo
        expect(parseWorkOrderNumber('2026-7/R1')).toBeNull();    // mjesec bez nule
        expect(parseWorkOrderNumber('2026-07/R1 kopija')).toBeNull();
    });

    test('toleriše razmake okolo', () => {
        expect(parseWorkOrderNumber('  2026-07/R1  ')).toEqual({ year: 2026, month: 7, letter: 'R', seq: 1 });
    });

    test('isNewFormatWorkOrderNumber', () => {
        expect(isNewFormatWorkOrderNumber('2026-07/R1')).toBe(true);
        expect(isNewFormatWorkOrderNumber('ZN-20260713-075307-241')).toBe(false);
    });
});

describe('nextWorkOrderNumber', () => {
    const july = '2026-07-15T10:00:00.000Z';

    test('prvi nalog u mjesecu = 1', () => {
        expect(nextWorkOrderNumber([], 'Proizvodnja', july)).toBe('2026-07/R1');
    });

    test('nastavlja niz', () => {
        expect(nextWorkOrderNumber(['2026-07/R1', '2026-07/R2'], 'Proizvodnja', july)).toBe('2026-07/R3');
    });

    test('svako slovo ima svoj niz', () => {
        const existing = ['2026-07/R1', '2026-07/R2', '2026-07/M1'];
        expect(nextWorkOrderNumber(existing, 'Montaža', july)).toBe('2026-07/M2');
        expect(nextWorkOrderNumber(existing, 'Zadaci', july)).toBe('2026-07/Z1');
    });

    test('brojač se resetuje svaki mjesec', () => {
        const existing = ['2026-06/R1', '2026-06/R2', '2026-06/R3'];
        expect(nextWorkOrderNumber(existing, 'Proizvodnja', july)).toBe('2026-07/R1');
    });

    test('ista godina/mjesec u drugoj godini se ne miješaju', () => {
        expect(nextWorkOrderNumber(['2025-07/R5'], 'Proizvodnja', july)).toBe('2026-07/R1');
    });

    test('STARI brojevi se ignorišu pri traženju sljedećeg', () => {
        const existing = ['ZN-20260713-075307-241', 'RN-20260713-075307-999', '2026-07/R1'];
        expect(nextWorkOrderNumber(existing, 'Proizvodnja', july)).toBe('2026-07/R2');
    });

    test('rupa u nizu ne vraća broj unazad (max+1, ne prva slobodna)', () => {
        // Nalog obrisan → broj se ne recikliše; identifikator ostaje jedinstven kroz vrijeme.
        expect(nextWorkOrderNumber(['2026-07/R1', '2026-07/R3'], 'Proizvodnja', july)).toBe('2026-07/R4');
    });

    test('preko 999 ide na 1000 umjesto duplikata', () => {
        expect(nextWorkOrderNumber(['2026-07/R999'], 'Proizvodnja', july)).toBe('2026-07/R1000');
    });

    test('preskače undefined/null u listi', () => {
        expect(nextWorkOrderNumber([undefined, null, '2026-07/R1'], 'Proizvodnja', july)).toBe('2026-07/R2');
    });
});

describe('effectiveOrderDate', () => {
    test('prvo knjiženje ima prednost nad Started_At', () => {
        expect(effectiveOrderDate({
            Work_Order_ID: 'a',
            Created_Date: '2026-06-01T00:00:00.000Z',
            Started_At: '2026-06-05T00:00:00.000Z',
            First_Booking_Date: '2026-07-02',
        })).toBe('2026-07-02');
    });

    test('bez knjiženja pada na Started_At', () => {
        expect(effectiveOrderDate({
            Work_Order_ID: 'a',
            Created_Date: '2026-06-01T00:00:00.000Z',
            Started_At: '2026-06-05T00:00:00.000Z',
        })).toBe('2026-06-05T00:00:00.000Z');
    });

    test('bez ičega pada na Created_Date', () => {
        expect(effectiveOrderDate({
            Work_Order_ID: 'a',
            Created_Date: '2026-06-01T00:00:00.000Z',
        })).toBe('2026-06-01T00:00:00.000Z');
    });
});

describe('planWorkOrderRenumber', () => {
    const wo = (over: Partial<RenumberInput> & { Work_Order_ID: string }): RenumberInput => ({
        Work_Order_Number: `RN-legacy-${over.Work_Order_ID}`,
        Work_Order_Type: 'Proizvodnja',
        Created_Date: '2026-07-01T00:00:00.000Z',
        ...over,
    });

    test('numeriše po datumu stvarnog početka, ne po kreiranju', () => {
        const plan = planWorkOrderRenumber([
            wo({ Work_Order_ID: 'a', Created_Date: '2026-07-01T00:00:00.000Z', First_Booking_Date: '2026-07-20' }),
            wo({ Work_Order_ID: 'b', Created_Date: '2026-07-02T00:00:00.000Z', First_Booking_Date: '2026-07-05' }),
        ]);
        expect(plan.find(p => p.Work_Order_ID === 'b')!.to).toBe('2026-07/R1');
        expect(plan.find(p => p.Work_Order_ID === 'a')!.to).toBe('2026-07/R2');
    });

    test('kanta je mjesec STVARNOG početka', () => {
        const plan = planWorkOrderRenumber([
            wo({ Work_Order_ID: 'a', Created_Date: '2026-06-28T00:00:00.000Z', First_Booking_Date: '2026-07-02' }),
        ]);
        expect(plan[0].to).toBe('2026-07/R1');
    });

    test('razdvaja po mjesecu i po slovu', () => {
        const plan = planWorkOrderRenumber([
            wo({ Work_Order_ID: 'a', First_Booking_Date: '2026-06-05' }),
            wo({ Work_Order_ID: 'b', First_Booking_Date: '2026-06-06' }),
            wo({ Work_Order_ID: 'c', First_Booking_Date: '2026-07-01' }),
            wo({ Work_Order_ID: 'd', Work_Order_Type: 'Montaža', First_Booking_Date: '2026-07-01' }),
            wo({ Work_Order_ID: 'e', Work_Order_Type: 'Zadaci', First_Booking_Date: '2026-07-03' }),
        ]);
        const by = (id: string) => plan.find(p => p.Work_Order_ID === id)!.to;
        expect(by('a')).toBe('2026-06/R1');
        expect(by('b')).toBe('2026-06/R2');
        expect(by('c')).toBe('2026-07/R1');
        expect(by('d')).toBe('2026-07/M1');
        expect(by('e')).toBe('2026-07/Z1');
    });

    test('čuva „from" radi pregleda prije potvrde', () => {
        const plan = planWorkOrderRenumber([
            { Work_Order_ID: 'a', Work_Order_Number: 'ZN-20260713-075307-241', Work_Order_Type: 'Zadaci', Created_Date: '2026-07-13T07:53:07.000Z' },
        ]);
        expect(plan[0]).toEqual({ Work_Order_ID: 'a', from: 'ZN-20260713-075307-241', to: '2026-07/Z1' });
    });

    test('nalozi koji VEĆ imaju novi broj se ne diraju', () => {
        const plan = planWorkOrderRenumber([
            { Work_Order_ID: 'a', Work_Order_Number: '2026-07/R1', Work_Order_Type: 'Proizvodnja', Created_Date: '2026-07-01T00:00:00.000Z' },
            wo({ Work_Order_ID: 'b', First_Booking_Date: '2026-07-02' }),
        ]);
        expect(plan.map(p => p.Work_Order_ID)).toEqual(['b']);
    });

    test('stari popunjavaju SLOBODNE brojeve oko rezervisanih', () => {
        const plan = planWorkOrderRenumber([
            { Work_Order_ID: 'keep', Work_Order_Number: '2026-07/R1', Work_Order_Type: 'Proizvodnja', Created_Date: '2026-07-01T00:00:00.000Z' },
            wo({ Work_Order_ID: 'a', First_Booking_Date: '2026-07-02' }),
            wo({ Work_Order_ID: 'b', First_Booking_Date: '2026-07-03' }),
        ]);
        expect(plan.find(p => p.Work_Order_ID === 'a')!.to).toBe('2026-07/R2');
        expect(plan.find(p => p.Work_Order_ID === 'b')!.to).toBe('2026-07/R3');
    });

    test('IDEMPOTENTNO: drugi prolaz nema šta raditi', () => {
        const orders = [
            wo({ Work_Order_ID: 'a', First_Booking_Date: '2026-07-02' }),
            wo({ Work_Order_ID: 'b', First_Booking_Date: '2026-07-03' }),
        ];
        const first = planWorkOrderRenumber(orders);
        const applied = orders.map(o => ({
            ...o,
            Work_Order_Number: first.find(p => p.Work_Order_ID === o.Work_Order_ID)!.to,
        }));
        expect(planWorkOrderRenumber(applied)).toEqual([]);
    });

    test('isti datum → stabilan redoslijed (Created_Date pa ID)', () => {
        const build = () => [
            wo({ Work_Order_ID: 'z', Created_Date: '2026-07-02T09:00:00.000Z', First_Booking_Date: '2026-07-05' }),
            wo({ Work_Order_ID: 'a', Created_Date: '2026-07-02T08:00:00.000Z', First_Booking_Date: '2026-07-05' }),
        ];
        const p1 = planWorkOrderRenumber(build());
        const p2 = planWorkOrderRenumber(build().reverse());
        // Raniji Created_Date dobija manji broj, bez obzira na ulazni redoslijed.
        expect(p1.find(p => p.Work_Order_ID === 'a')!.to).toBe('2026-07/R1');
        expect(p2.find(p => p.Work_Order_ID === 'a')!.to).toBe('2026-07/R1');
        expect(p1.find(p => p.Work_Order_ID === 'z')!.to).toBe('2026-07/R2');
        expect(p2.find(p => p.Work_Order_ID === 'z')!.to).toBe('2026-07/R2');
    });

    test('prazan ulaz → prazan plan', () => {
        expect(planWorkOrderRenumber([])).toEqual([]);
    });
});
