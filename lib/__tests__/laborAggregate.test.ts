// ════════════════════════════════════════════════════════════════════
// AGREGACIJA RADA — brana protiv razilaženja dva puta knjiženja
//
// Od uvođenja kontrolora dnevnice se knjiže s dva mjesta: vlasnikov desktop
// (klijentski Firebase SDK) i kontrolorov telefon (server, admin SDK). Oba
// zovu `aggregateLaborFromLogs`. Ovi testovi drže tu funkciju na mjestu —
// ako neko sutra „optimizuje" zaokruživanje ili tretman starih zapisa,
// obračun se tiho promijeni za sve naloge unazad.
// ════════════════════════════════════════════════════════════════════

import {
    aggregateLaborFromLogs, laborCostOf, laborDaysOf, round2, type LaborLogLike,
} from '@/lib/laborAggregate';
import { splitDnevnicaExact } from '@/lib/laborSplit';

const log = (itemId: string, rate: number, fraction?: number): LaborLogLike => ({
    Work_Order_Item_ID: itemId,
    Daily_Rate: rate,
    ...(fraction === undefined ? {} : { Day_Fraction: fraction }),
});

describe('round2', () => {
    it('zaokružuje na dvije decimale', () => {
        expect(round2(30.005)).toBe(30.01);
        expect(round2(30.004)).toBe(30);
        expect(round2(0)).toBe(0);
    });
});

describe('aggregateLaborFromLogs', () => {
    it('sabira Daily_Rate po proizvodu', () => {
        const agg = aggregateLaborFromLogs([
            log('item-a', 45), log('item-a', 45), log('item-b', 90),
        ]);
        expect(laborCostOf(agg, 'item-a')).toBe(90);
        expect(laborCostOf(agg, 'item-b')).toBe(90);
    });

    it('sabira Day_Fraction u radnik-dane', () => {
        const agg = aggregateLaborFromLogs([
            log('item-a', 30, 0.333), log('item-a', 30, 0.333), log('item-a', 30, 0.334),
        ]);
        expect(laborDaysOf(agg, 'item-a')).toBe(1);
    });

    it('zapis BEZ Day_Fraction se broji kao pun dan', () => {
        // Zapisi napravljeni prije uvođenja podjele dnevnice nemaju to polje.
        // Da se tretiraju kao 0, stari nalozi bi pokazivali „0 od X dana"
        // iako je rad proknjižen — to je već jednom bio bug.
        const agg = aggregateLaborFromLogs([log('item-a', 90)]);
        expect(laborDaysOf(agg, 'item-a')).toBe(1);
    });

    it('Day_Fraction === 0 se poštuje (nije isto što i nedostajuće polje)', () => {
        const agg = aggregateLaborFromLogs([log('item-a', 0, 0)]);
        expect(laborDaysOf(agg, 'item-a')).toBe(0);
    });

    it('nedostajući Daily_Rate se broji kao nula', () => {
        const agg = aggregateLaborFromLogs([{ Work_Order_Item_ID: 'item-a' }]);
        expect(laborCostOf(agg, 'item-a')).toBe(0);
    });

    it('preskače zapise bez Work_Order_Item_ID', () => {
        const agg = aggregateLaborFromLogs([
            { Daily_Rate: 90 } as LaborLogLike,
            { Work_Order_Item_ID: '', Daily_Rate: 90 },
            log('item-a', 45),
        ]);
        expect(agg.size).toBe(1);
        expect(laborCostOf(agg, 'item-a')).toBe(45);
    });

    it('proizvod bez knjiženog rada daje nulu, ne undefined', () => {
        const agg = aggregateLaborFromLogs([]);
        expect(laborCostOf(agg, 'nepostojeci')).toBe(0);
        expect(laborDaysOf(agg, 'nepostojeci')).toBe(0);
    });

    it('prazan i nedefinisan ulaz ne pucaju', () => {
        expect(aggregateLaborFromLogs([]).size).toBe(0);
        expect(aggregateLaborFromLogs(undefined as any).size).toBe(0);
    });

    it('zaokružuje PO PROIZVODU, ne na kraju — pare se ne smiju pomjeriti', () => {
        // Redoslijed je bitan: Σ sirovih pa zaokruži daje drugi rezultat od
        // Σ zaokruženih. recalculateWorkOrder sabira već zaokružene iznose.
        const agg = aggregateLaborFromLogs([
            log('item-a', 33.333), log('item-a', 33.333), log('item-a', 33.334),
        ]);
        expect(laborCostOf(agg, 'item-a')).toBe(100);
    });
});

describe('invarijanta dnevnice: Σ Daily_Rate = dnevnica × prisustvo', () => {
    // Ovo je pravilo koje čuva cijeli obračun plata. Ako agregacija ikad
    // prestane da ga poštuje, radnik dobije pogrešnu platu.
    const cases: { dnevnica: number; presence: number; n: number }[] = [
        { dnevnica: 90, presence: 1, n: 1 },
        { dnevnica: 90, presence: 1, n: 3 },
        { dnevnica: 90, presence: 0.5, n: 2 },
        { dnevnica: 100, presence: 1, n: 6 },
        { dnevnica: 85.5, presence: 0.5, n: 7 },
        { dnevnica: 73, presence: 1, n: 3 },
    ];

    it.each(cases)('dnevnica $dnevnica × $presence podijeljena na $n proizvoda', ({ dnevnica, presence, n }) => {
        const { amounts, dayFraction } = splitDnevnicaExact(dnevnica, presence, n);

        const logs = amounts.map((amount, i) => log(`item-${i}`, amount, dayFraction));
        const agg = aggregateLaborFromLogs(logs);

        const totalCost = amounts.map((_, i) => laborCostOf(agg, `item-${i}`)).reduce((s, x) => s + x, 0);
        const totalDays = amounts.map((_, i) => laborDaysOf(agg, `item-${i}`)).reduce((s, x) => s + x, 0);

        // NOVAC je egzaktan — splitDnevnicaExact raspoređuje ostatak u pare,
        // pa Σ mora pogoditi dnevnicu u cent. Ovo je pravilo za plate.
        expect(round2(totalCost)).toBe(round2(dnevnica * presence));

        // DANI su približni: Day_Fraction se zaokružuje PO PROIZVODU (1/3 → 0.33),
        // pa Σ od tri komada daje 0.99, ne 1. To je postojeće ponašanje i namjerno
        // se ne „popravlja" — dani su prikazna veličina („3 od 5 dana"), a ne novac.
        // Granica je najveća moguća greška zaokruživanja: n × 0.005.
        expect(Math.abs(totalDays - presence)).toBeLessThanOrEqual(n * 0.005);
    });

    it('radnik na dva naloga istog dana i dalje nosi tačno jednu dnevnicu', () => {
        // Dva naloga × dva proizvoda = 4 zapisa; Σ mora ostati jedna dnevnica.
        const { amounts, dayFraction } = splitDnevnicaExact(90, 1, 4);
        const agg = aggregateLaborFromLogs(amounts.map((a, i) => log(`item-${i}`, a, dayFraction)));

        const total = amounts.map((_, i) => laborCostOf(agg, `item-${i}`)).reduce((s, x) => s + x, 0);
        expect(round2(total)).toBe(90);
    });
});

describe('klijentski i serverski put daju isti rezultat', () => {
    it('isti zapisi kroz istu funkciju — bez obzira na redoslijed i oblik dokumenta', () => {
        // Serverski put (admin SDK) vraća obične objekte, klijentski prolazi
        // kroz Firestore snapshot .data(). Oblik je isti, ali redoslijed
        // dokumenata nije zagarantovan — agregacija ne smije o njemu zavisiti.
        const desktopOrder: LaborLogLike[] = [
            log('item-a', 30, 0.333), log('item-b', 30, 0.333), log('item-a', 30, 0.334),
        ];
        const serverOrder: LaborLogLike[] = [
            log('item-a', 30, 0.334), log('item-a', 30, 0.333), log('item-b', 30, 0.333),
        ];

        const fromDesktop = aggregateLaborFromLogs(desktopOrder);
        const fromServer = aggregateLaborFromLogs(serverOrder);

        expect(laborCostOf(fromServer, 'item-a')).toBe(laborCostOf(fromDesktop, 'item-a'));
        expect(laborDaysOf(fromServer, 'item-a')).toBe(laborDaysOf(fromDesktop, 'item-a'));
        expect(laborCostOf(fromServer, 'item-b')).toBe(laborCostOf(fromDesktop, 'item-b'));
    });
});
