import {
    DAY_WIDTH, HEADER_WIDTH, LANE_HEIGHT,
    xForDate, dateAtX, daysForDelta, snapToDay, visibleDates, visibleDayCount,
    blockRect, packLanes, rowHeight, laneTop, headerTicks, monthBands, anchorCentering,
    type Viewport,
} from '../canvas/geometry';
import {
    addDays, diffDays, blockDurationDays, workingDaysNeeded, endFromWork,
    normalizeBlock, newBlock, newLink, wouldCreateCycle, scenarioBounds,
    emptyScenario, orderByFromDelivery, MAX_BLOCKS_PER_SCENARIO,
} from '../canvas/model';
import type { PlanScenario, PlanBlock } from '../types';

const vp = (over: Partial<Viewport> = {}): Viewport => ({
    anchorISO: '2026-08-03',   // ponedjeljak
    zoom: 'sedmica',
    widthPx: 1100,
    ...over,
});

// ════════════════════════════════════════════════════════════════════
describe('datum ↔ piksel', () => {
    test('anchor je na x=0', () => {
        expect(xForDate('2026-08-03', vp())).toBe(0);
    });

    test('svaki dan pomjera za DAY_WIDTH tog zuma', () => {
        expect(xForDate('2026-08-04', vp({ zoom: 'dan' }))).toBe(DAY_WIDTH.dan);
        expect(xForDate('2026-08-04', vp({ zoom: 'sedmica' }))).toBe(DAY_WIDTH.sedmica);
        expect(xForDate('2026-08-04', vp({ zoom: 'mjesec' }))).toBe(DAY_WIDTH.mjesec);
    });

    test('datum prije anchora daje negativan x', () => {
        expect(xForDate('2026-08-01', vp())).toBe(-2 * DAY_WIDTH.sedmica);
    });

    test('dateAtX je obrat xForDate na sva tri zuma', () => {
        for (const zoom of ['dan', 'sedmica', 'mjesec'] as const) {
            const v = vp({ zoom });
            for (const iso of ['2026-08-03', '2026-08-17', '2026-09-01', '2026-12-31']) {
                expect(dateAtX(xForDate(iso, v), v)).toBe(iso);
            }
        }
    });

    test('dateAtX zaokružuje NADOLJE — x unutar dana daje taj dan', () => {
        const v = vp({ zoom: 'dan' });
        expect(dateAtX(DAY_WIDTH.dan - 1, v)).toBe('2026-08-03');
        expect(dateAtX(DAY_WIDTH.dan, v)).toBe('2026-08-04');
    });

    test('snapToDay lijepi na početak dana', () => {
        const v = vp({ zoom: 'dan' });
        expect(snapToDay(DAY_WIDTH.dan + 5, v)).toBe(DAY_WIDTH.dan);
        expect(snapToDay(0, v)).toBe(0);
    });

    test('daysForDelta zaokružuje na najbliži dan (povlačenje)', () => {
        expect(daysForDelta(DAY_WIDTH.sedmica * 2 + 3, 'sedmica')).toBe(2);
        expect(daysForDelta(-DAY_WIDTH.sedmica * 2, 'sedmica')).toBe(-2);
        expect(daysForDelta(2, 'sedmica')).toBe(0);
    });
});

describe('prelazak mjeseca i godine', () => {
    test('kraj mjeseca', () => {
        expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
        expect(diffDays('2026-08-31', '2026-09-01')).toBe(1);
    });

    test('prijestupna godina', () => {
        expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
        expect(diffDays('2028-02-28', '2028-03-01')).toBe(2);
    });

    test('prelazak godine', () => {
        expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
        expect(xForDate('2027-01-01', vp({ anchorISO: '2026-12-31', zoom: 'dan' }))).toBe(DAY_WIDTH.dan);
    });

    test('prelazak zimskog/ljetnog računanja vremena ne pomjera dan', () => {
        // Zadnja nedjelja u martu i oktobru — parsiranje u podne ovo mora izdržati
        expect(diffDays('2026-03-28', '2026-03-30')).toBe(2);
        expect(diffDays('2026-10-24', '2026-10-26')).toBe(2);
    });
});

// ════════════════════════════════════════════════════════════════════
describe('blockRect', () => {
    test('jednodnevni blok je širok tačno jedan dan', () => {
        const r = blockRect('2026-08-03', '2026-08-03', vp({ zoom: 'dan' }));
        expect(r.left).toBe(0);
        expect(r.width).toBe(DAY_WIDTH.dan);
        expect(r.visible).toBe(true);
    });

    test('kraj je UKLJUČIV — 3 dana su 3 širine', () => {
        const r = blockRect('2026-08-03', '2026-08-05', vp({ zoom: 'dan' }));
        expect(r.width).toBe(3 * DAY_WIDTH.dan);
    });

    test('blok koji počinje prije prozora se odsijeca i označi', () => {
        const r = blockRect('2026-07-20', '2026-08-05', vp());
        expect(r.left).toBe(0);
        expect(r.clippedStart).toBe(true);
        expect(r.clippedEnd).toBe(false);
        expect(r.visible).toBe(true);
    });

    test('blok koji prelazi desnu ivicu se odsijeca i označi', () => {
        const r = blockRect('2026-08-03', '2027-08-03', vp());
        expect(r.clippedEnd).toBe(true);
        expect(r.left + r.width).toBeLessThanOrEqual(vp().widthPx);
    });

    test('blok potpuno izvan prozora nije vidljiv', () => {
        expect(blockRect('2025-01-01', '2025-01-05', vp()).visible).toBe(false);
        expect(blockRect('2030-01-01', '2030-01-05', vp()).visible).toBe(false);
    });

    test('blok koji završava tačno na anchoru je JOŠ vidljiv', () => {
        const r = blockRect('2026-08-01', '2026-08-03', vp());
        expect(r.visible).toBe(true);
    });
});

// ════════════════════════════════════════════════════════════════════
describe('slaganje u trake', () => {
    const range = (b: { s: string; e: string }) => ({ startISO: b.s, endISO: b.e });

    test('blokovi koji se ne preklapaju dijele jednu traku', () => {
        const { placed, laneCount } = packLanes(
            [{ s: '2026-08-03', e: '2026-08-05' }, { s: '2026-08-06', e: '2026-08-08' }],
            range, vp()
        );
        expect(laneCount).toBe(1);
        expect(placed.every(p => p.lane === 0)).toBe(true);
    });

    test('preklopljeni blokovi idu u odvojene trake', () => {
        const { placed, laneCount } = packLanes(
            [{ s: '2026-08-03', e: '2026-08-10' }, { s: '2026-08-05', e: '2026-08-12' }],
            range, vp()
        );
        expect(laneCount).toBe(2);
        expect(placed.map(p => p.lane).sort()).toEqual([0, 1]);
    });

    test('preklapanje se mjeri DATUMIMA, ne pikselima (mjesečni zum)', () => {
        // Na mjesečnom zumu su ova dva bloka udaljena 7px — piksel-provjera bi ih spojila
        const { laneCount } = packLanes(
            [{ s: '2026-08-03', e: '2026-08-04' }, { s: '2026-08-05', e: '2026-08-06' }],
            range, vp({ zoom: 'mjesec' })
        );
        expect(laneCount).toBe(1);
    });

    test('deterministično — isti ulaz, isti raspored', () => {
        const items = [{ s: '2026-08-05', e: '2026-08-09' }, { s: '2026-08-03', e: '2026-08-07' }];
        const a = packLanes(items, range, vp());
        const b = packLanes(items, range, vp());
        expect(a.placed.map(p => p.lane)).toEqual(b.placed.map(p => p.lane));
    });

    test('nevidljivi blokovi se ne slažu', () => {
        const { placed } = packLanes(
            [{ s: '2020-01-01', e: '2020-01-05' }, { s: '2026-08-03', e: '2026-08-05' }],
            range, vp()
        );
        expect(placed).toHaveLength(1);
    });

    test('visina reda raste s brojem traka', () => {
        expect(rowHeight(1)).toBeLessThan(rowHeight(3));
        expect(laneTop(0)).toBeLessThan(laneTop(1));
        expect(laneTop(1) - laneTop(0)).toBeGreaterThanOrEqual(LANE_HEIGHT);
    });
});

// ════════════════════════════════════════════════════════════════════
describe('zaglavlje', () => {
    test('dnevni i sedmični zum daju oznaku za svaki dan', () => {
        expect(headerTicks(vp({ zoom: 'dan', widthPx: 560 }), '2026-08-03').length)
            .toBe(visibleDayCount(vp({ zoom: 'dan', widthPx: 560 })));
    });

    test('mjesečni zum grupiše po sedmicama (samo ponedjeljci)', () => {
        const ticks = headerTicks(vp({ zoom: 'mjesec', widthPx: 700 }), '2026-08-03');
        expect(ticks.length).toBeLessThan(visibleDayCount(vp({ zoom: 'mjesec', widthPx: 700 })));
        for (const t of ticks) {
            expect(new Date(`${t.iso}T12:00:00`).getDay()).toBe(1);
        }
    });

    test('nedjelja je označena kao neradna, danas kao danas', () => {
        const ticks = headerTicks(vp({ zoom: 'dan' }), '2026-08-04');
        expect(ticks.find(t => t.iso === '2026-08-09')?.isNonWorking).toBe(true);   // nedjelja
        expect(ticks.find(t => t.iso === '2026-08-04')?.isToday).toBe(true);
        expect(ticks.find(t => t.iso === '2026-08-05')?.isToday).toBe(false);
    });

    test('trake mjeseci pokrivaju cijeli raspon bez rupa', () => {
        const v = vp({ zoom: 'mjesec', widthPx: 900 });
        const bands = monthBands(v);
        expect(bands.length).toBeGreaterThan(1);
        for (let i = 1; i < bands.length; i++) {
            expect(bands[i].left).toBe(bands[i - 1].left + bands[i - 1].width);
        }
    });

    test('anchorCentering stavlja datum u sredinu prozora', () => {
        const v = vp();
        const centered = { ...v, anchorISO: anchorCentering('2026-09-01', v) };
        const x = xForDate('2026-09-01', centered);
        expect(Math.abs(x - v.widthPx / 2)).toBeLessThan(DAY_WIDTH.sedmica * 2);
    });

    test('konstante su eksportovane (JS i CSS ne smiju se razići)', () => {
        expect(HEADER_WIDTH).toBeGreaterThan(0);
        expect(LANE_HEIGHT).toBeGreaterThan(0);
        expect(Object.keys(DAY_WIDTH)).toEqual(['dan', 'sedmica', 'mjesec']);
    });
});

// ════════════════════════════════════════════════════════════════════
describe('model — posao → kalendar', () => {
    test('radni dani se zaokružuju NAVIŠE (pola dana se ne isporučuje)', () => {
        expect(workingDaysNeeded(7, 2)).toBe(4);
        expect(workingDaysNeeded(6, 2)).toBe(3);
        expect(workingDaysNeeded(1, 5)).toBe(1);
        expect(workingDaysNeeded(0, 2)).toBe(1);
    });

    test('ekipa ispod 1 se tretira kao 1', () => {
        expect(workingDaysNeeded(4, 0)).toBe(4);
        expect(workingDaysNeeded(4, -3)).toBe(4);
    });

    test('kraj iz posla preskače nedjelju', () => {
        // pon 03.08, 6 radnik-dana / 1 čovjek = 6 radnih dana: pon–sub
        expect(endFromWork('2026-08-03', 6, 1)).toBe('2026-08-08');
        // 7 radnih dana prelazi nedjelju → ponedjeljak
        expect(endFromWork('2026-08-03', 7, 1)).toBe('2026-08-10');
    });

    test('subotnja rotacija se poštuje kad je data', () => {
        const noSaturdays = (d: Date) => d.getDay() !== 6;
        expect(endFromWork('2026-08-03', 6, 1, noSaturdays)).toBe('2026-08-10');
    });

    test('trajanje bloka je uključivo', () => {
        expect(blockDurationDays({ startISO: '2026-08-03', endISO: '2026-08-03' })).toBe(1);
        expect(blockDurationDays({ startISO: '2026-08-03', endISO: '2026-08-05' })).toBe(3);
    });

    test('najkasniji datum narudžbe = dolazak − rok', () => {
        expect(orderByFromDelivery('2026-09-01', 6)).toBe('2026-08-26');
        expect(orderByFromDelivery('2026-09-01', 0)).toBe('2026-09-01');
    });
});

describe('model — normalizacija', () => {
    test('end prije starta se popravlja (povlačenje lako to napravi)', () => {
        const b = normalizeBlock({
            id: 'x', kind: 'order', title: 'T', startISO: '2026-08-10', endISO: '2026-08-03',
        } as PlanBlock);
        expect(b.endISO).toBe('2026-08-10');
    });

    test('prekretnica je uvijek jedan dan', () => {
        const b = normalizeBlock({
            id: 'x', kind: 'milestone', title: 'Rok', startISO: '2026-08-10', endISO: '2026-08-20',
        } as PlanBlock);
        expect(b.endISO).toBe('2026-08-10');
    });

    test('ekipa i radnik-dani se čiste', () => {
        const b = normalizeBlock({
            id: 'x', kind: 'order', title: 'T', startISO: '2026-08-03', endISO: '2026-08-05',
            crew: 0, workerDays: -5,
        } as PlanBlock);
        expect(b.crew).toBe(1);
        expect(b.workerDays).toBe(0);
    });

    test('prazan naziv dobija podrazumijevani', () => {
        expect(newBlock('purchase', '2026-08-03', undefined, { title: '   ' }).title).toBe('Narudžba');
    });

    test('newBlock bez kraja koristi podrazumijevano trajanje vrste', () => {
        const b = newBlock('transport', '2026-08-03');
        expect(blockDurationDays(b)).toBe(1);
        expect(blockDurationDays(newBlock('order', '2026-08-03'))).toBe(5);
    });
});

describe('model — veze i ciklusi', () => {
    const scenarioWith = (links: [string, string][]): PlanScenario => ({
        ...emptyScenario('org', 'test'),
        Blocks: ['a', 'b', 'c'].map(id => newBlock('order', '2026-08-03', '2026-08-05', { id })),
        Links: links.map(([from, to]) => newLink(from, to, 'finish-to-start')),
    });

    test('veza na samog sebe je ciklus', () => {
        expect(wouldCreateCycle(scenarioWith([]), 'a', 'a')).toBe(true);
    });

    test('a→b→c pa c→a bi zatvorilo krug', () => {
        const s = scenarioWith([['a', 'b'], ['b', 'c']]);
        expect(wouldCreateCycle(s, 'c', 'a')).toBe(true);
        expect(wouldCreateCycle(s, 'a', 'c')).toBe(false);
    });

    test('bez ciklusa u praznom scenariju', () => {
        expect(wouldCreateCycle(scenarioWith([]), 'a', 'b')).toBe(false);
    });

    test('granice scenarija pokrivaju sve blokove', () => {
        const s: PlanScenario = {
            ...emptyScenario('org', 'test'),
            Blocks: [
                newBlock('order', '2026-08-10', '2026-08-15'),
                newBlock('order', '2026-08-03', '2026-08-05'),
                newBlock('milestone', '2026-09-01'),
            ],
        };
        expect(scenarioBounds(s)).toEqual({ fromISO: '2026-08-03', toISO: '2026-09-01' });
        expect(scenarioBounds(emptyScenario('org'))).toBeNull();
    });

    test('granica broja blokova je definisana', () => {
        expect(MAX_BLOCKS_PER_SCENARIO).toBe(500);
    });
});
