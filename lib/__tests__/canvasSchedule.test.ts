import { computeBackwardChain, computeForwardChain, anchorCandidates } from '../canvas/schedule';
import { emptyScenario, newBlock, newLink, startFromWork, previousWorkingDay, isWorkDay } from '../canvas/model';
import type { PlanScenario, PlanBlock, PlanLink } from '../types';

const TODAY = '2026-08-03';   // ponedjeljak

const scenarioOf = (blocks: PlanBlock[], links: PlanLink[] = []): PlanScenario => ({
    ...emptyScenario('org', 'Test'),
    Blocks: blocks,
    Links: links,
});

const opts = { todayISO: TODAY };

// ════════════════════════════════════════════════════════════════════
describe('radni dani unazad', () => {
    test('nedjelja nije radni dan, subota jeste', () => {
        expect(isWorkDay('2026-08-09')).toBe(false);   // nedjelja
        expect(isWorkDay('2026-08-08')).toBe(true);    // subota
        expect(isWorkDay('2026-08-05')).toBe(true);
    });

    test('rok u nedjelju stvarno znači „gotovo u subotu"', () => {
        expect(previousWorkingDay('2026-08-09')).toBe('2026-08-08');
        expect(previousWorkingDay('2026-08-07')).toBe('2026-08-07');
    });

    test('subotnja rotacija se poštuje', () => {
        const noSat = (d: Date) => d.getDay() !== 6;
        expect(previousWorkingDay('2026-08-09', noSat)).toBe('2026-08-07');   // petak
    });

    test('startFromWork je ogledalo endFromWork', () => {
        // 6 radnih dana koji završavaju u subotu 08.08 → počinju u ponedjeljak 03.08
        expect(startFromWork('2026-08-08', 6, 1)).toBe('2026-08-03');
        // 12 radnik-dana / 2 čovjeka = 6 radnih dana → isto
        expect(startFromWork('2026-08-08', 12, 2)).toBe('2026-08-03');
    });

    test('brojanje unazad preskače nedjelju', () => {
        // 7 radnih dana koji završavaju 10.08 (pon) → 03.08 (pon), preko nedjelje 09.08
        expect(startFromWork('2026-08-10', 7, 1)).toBe('2026-08-03');
    });
});

// ════════════════════════════════════════════════════════════════════
describe('unazadni lanac — puni scenarij', () => {
    /**
     * Narudžba (rok 6 dana) → proizvodnja (12 radnik-dana, 2 čovjeka) → transport (1 dan) → montaža
     * Montaža fiksirana 15.09.2026 (utorak), zaključana.
     */
    const fullChain = () => {
        const montaza = newBlock('montaza', '2026-09-15', '2026-09-16', {
            id: 'm', title: 'Montaža Novak', locked: true,
        });
        const transport = newBlock('transport', '2026-09-01', '2026-09-01', { id: 't', title: 'Prevoz' });
        const proizvodnja = newBlock('order', '2026-08-01', '2026-08-10', {
            id: 'p', title: 'Kuhinja Novak', workerDays: 12, crew: 2,
        });
        const narudzba = newBlock('purchase', '2026-07-01', '2026-07-07', {
            id: 'n', title: 'Frischeis', leadDays: 6, supplierRef: { name: 'Frischeis' },
        });

        return scenarioOf(
            [montaza, transport, proizvodnja, narudzba],
            [
                newLink('t', 'm', 'finish-to-montaza'),
                newLink('p', 't', 'finish-to-start'),
                newLink('n', 'p', 'delivery-to-start'),
            ]
        );
    };

    test('cijeli lanac se izračuna unazad od montaže', () => {
        const res = computeBackwardChain(fullChain(), 'm', opts)!;
        const by = new Map(res.changes.map(c => [c.id, c]));

        // Transport mora biti gotov dan prije montaže (15.09 → 14.09)
        expect(by.get('t')!.endISO).toBe('2026-09-14');
        // Proizvodnja mora biti gotova dan prije transporta (14.09 → 13.09 = nedjelja → 12.09)
        expect(by.get('p')!.endISO).toBe('2026-09-12');
        // 12 radnik-dana / 2 = 6 radnih dana unazad od petka 12.09 → ponedjeljak 07.09
        expect(by.get('p')!.startISO).toBe('2026-09-07');
        // Materijal mora stići NA DAN starta proizvodnje
        expect(by.get('n')!.endISO).toBe('2026-09-07');
    });

    test('NAJKASNIJI DATUM NARUDŽBE je operativni odgovor', () => {
        const res = computeBackwardChain(fullChain(), 'm', opts)!;
        const narudzba = res.changes.find(c => c.id === 'n')!;
        // Dostava 07.09 − rok 6 dana = 01.09
        expect(narudzba.orderByISO).toBe('2026-09-01');
    });

    test('sidro se NE pomjera', () => {
        const res = computeBackwardChain(fullChain(), 'm', opts)!;
        expect(res.changes.find(c => c.id === 'm')).toBeUndefined();
        expect(res.anchorISO).toBe('2026-09-15');
    });

    test('rezultat je PRIJEDLOG — scenarij ostaje netaknut', () => {
        const s = fullChain();
        const snapshot = JSON.stringify(s);
        computeBackwardChain(s, 'm', opts);
        expect(JSON.stringify(s)).toBe(snapshot);
    });

    test('razlike nose i staro i novo stanje (za prikaz prije primjene)', () => {
        const res = computeBackwardChain(fullChain(), 'm', opts)!;
        const p = res.changes.find(c => c.id === 'p')!;
        expect(p.fromStartISO).toBe('2026-08-01');
        expect(p.startISO).toBe('2026-09-07');
        expect(p.deltaDays).toBe(37);
    });
});

// ════════════════════════════════════════════════════════════════════
describe('lanac koji NE STANE', () => {
    test('narudžba u prošlosti daje shortfallDays — kaže se otvoreno', () => {
        // Montaža za 5 dana, a lanac traži 6 dana roka isporuke + proizvodnju
        const s = scenarioOf(
            [
                newBlock('montaza', '2026-08-08', '2026-08-08', { id: 'm', locked: true }),
                newBlock('order', '2026-08-01', '2026-08-05', { id: 'p', workerDays: 10, crew: 1 }),
                newBlock('purchase', '2026-07-20', '2026-07-26', { id: 'n', leadDays: 6 }),
            ],
            [newLink('p', 'm', 'finish-to-montaza'), newLink('n', 'p', 'delivery-to-start')]
        );
        const res = computeBackwardChain(s, 'm', opts)!;
        expect(res.shortfallDays).toBeGreaterThan(0);
    });

    test('lanac koji stane nema manjka', () => {
        const s = scenarioOf(
            [
                newBlock('montaza', '2026-12-01', '2026-12-01', { id: 'm', locked: true }),
                newBlock('order', '2026-08-01', '2026-08-05', { id: 'p', workerDays: 4, crew: 1 }),
                newBlock('purchase', '2026-07-20', '2026-07-26', { id: 'n', leadDays: 6 }),
            ],
            [newLink('p', 'm', 'finish-to-montaza'), newLink('n', 'p', 'delivery-to-start')]
        );
        expect(computeBackwardChain(s, 'm', opts)!.shortfallDays).toBe(0);
    });

    test('hitne narudžbe se izdvajaju (rok slanja ≤ 3 dana)', () => {
        // Montaža 17.08 → proizvodnja (5 dana) kreće 11.08 → materijal 11.08
        // → narudžba mora otići 05.08, a danas je 03.08 → 2 dana, dakle hitno.
        const s = scenarioOf(
            [
                newBlock('montaza', '2026-08-17', '2026-08-17', { id: 'm', locked: true }),
                newBlock('order', '2026-08-10', '2026-08-14', { id: 'p', workerDays: 5, crew: 1 }),
                newBlock('purchase', '2026-08-01', '2026-08-07', { id: 'n', title: 'Frischeis', leadDays: 6 }),
            ],
            [newLink('p', 'm', 'finish-to-montaza'), newLink('n', 'p', 'delivery-to-start')]
        );
        const res = computeBackwardChain(s, 'm', opts)!;
        expect(res.urgentOrders.length).toBeGreaterThan(0);
        expect(res.urgentOrders[0].title).toBe('Frischeis');
        expect(res.urgentOrders[0].daysLeft).toBeLessThanOrEqual(3);
    });

    test('narudžba s komotnim rokom NIJE hitna (prag stvarno radi)', () => {
        const s = scenarioOf(
            [
                newBlock('montaza', '2026-12-01', '2026-12-01', { id: 'm', locked: true }),
                newBlock('order', '2026-08-10', '2026-08-14', { id: 'p', workerDays: 5, crew: 1 }),
                newBlock('purchase', '2026-08-01', '2026-08-07', { id: 'n', leadDays: 6 }),
            ],
            [newLink('p', 'm', 'finish-to-montaza'), newLink('n', 'p', 'delivery-to-start')]
        );
        expect(computeBackwardChain(s, 'm', opts)!.urgentOrders).toEqual([]);
    });
});

// ════════════════════════════════════════════════════════════════════
describe('zaključani blokovi', () => {
    test('zaključan blok se NE pomjera, ali se prijavi', () => {
        const s = scenarioOf(
            [
                newBlock('montaza', '2026-09-15', '2026-09-15', { id: 'm', locked: true }),
                newBlock('order', '2026-08-01', '2026-08-05', { id: 'p', locked: true }),
            ],
            [newLink('p', 'm', 'finish-to-montaza')]
        );
        const res = computeBackwardChain(s, 'm', opts)!;
        expect(res.changes.find(c => c.id === 'p')).toBeUndefined();
        expect(res.blockedByLock.map(c => c.id)).toEqual(['p']);
        expect(res.warnings.join(' ')).toContain('zaključanih');
    });

    test('zaključan blok postaje sidro za SVOJE pretke', () => {
        const s = scenarioOf(
            [
                newBlock('montaza', '2026-12-01', '2026-12-01', { id: 'm', locked: true }),
                newBlock('order', '2026-09-01', '2026-09-05', { id: 'p', locked: true }),
                newBlock('purchase', '2026-08-01', '2026-08-07', { id: 'n', leadDays: 6 }),
            ],
            [newLink('p', 'm', 'finish-to-montaza'), newLink('n', 'p', 'delivery-to-start')]
        );
        const res = computeBackwardChain(s, 'm', opts)!;
        const n = res.changes.find(c => c.id === 'n')!;
        // Narudžba se veže na ZAKLJUČANI start proizvodnje (01.09), ne na montažu
        expect(n.endISO).toBe('2026-09-01');
    });
});

// ════════════════════════════════════════════════════════════════════
describe('otpornost', () => {
    test('ciklus ne vrti beskonačno — prijavi se i preskoči', () => {
        const s = scenarioOf(
            [
                newBlock('montaza', '2026-09-15', '2026-09-15', { id: 'm' }),
                newBlock('order', '2026-08-01', '2026-08-05', { id: 'a' }),
                newBlock('order', '2026-08-06', '2026-08-10', { id: 'b' }),
            ],
            // Ručno napravljen ciklus (reducer ga sprječava, ali stari dokument može imati)
            [newLink('a', 'b', 'finish-to-start'), newLink('b', 'a', 'finish-to-start'), newLink('b', 'm', 'finish-to-start')]
        );
        const res = computeBackwardChain(s, 'm', opts)!;
        expect(res).not.toBeNull();
        expect(res.warnings.join(' ')).toContain('Kružna');
    });

    test('blok bez veza javlja da nema šta računati', () => {
        const s = scenarioOf([newBlock('montaza', '2026-09-15', '2026-09-15', { id: 'm' })]);
        const res = computeBackwardChain(s, 'm', opts)!;
        expect(res.changes).toEqual([]);
        expect(res.warnings.join(' ')).toContain('nema ništa vezano');
    });

    test('nepostojeće sidro vraća null', () => {
        expect(computeBackwardChain(scenarioOf([]), 'nema', opts)).toBeNull();
    });

    test('lag pomjera zahtjev (zaštitni razmak)', () => {
        const s = scenarioOf(
            [
                newBlock('montaza', '2026-09-15', '2026-09-15', { id: 'm', locked: true }),
                newBlock('order', '2026-08-01', '2026-08-05', { id: 'p' }),
            ],
            [newLink('p', 'm', 'finish-to-montaza', 3)]
        );
        const res = computeBackwardChain(s, 'm', opts)!;
        // 15.09 − 3 dana razmaka − 1 = 11.09 (petak, radni)
        expect(res.changes.find(c => c.id === 'p')!.endISO).toBe('2026-09-11');
    });
});

// ════════════════════════════════════════════════════════════════════
describe('unaprijedni lanac', () => {
    test('pomak prethodnika gura nasljednike', () => {
        // Proizvodnja se produžila do 20.08, a transport je zaostao na 08.08
        const s = scenarioOf(
            [
                newBlock('order', '2026-08-03', '2026-08-20', { id: 'p' }),
                newBlock('transport', '2026-08-08', '2026-08-08', { id: 't' }),
            ],
            [newLink('p', 't', 'finish-to-start')]
        );
        const res = computeForwardChain(s, 'p', opts)!;
        expect(res.changes.find(c => c.id === 't')!.startISO).toBe('2026-08-21');
    });

    test('lanac se gura kroz VIŠE nasljednika', () => {
        const s = scenarioOf(
            [
                newBlock('order', '2026-08-03', '2026-08-20', { id: 'p' }),
                newBlock('transport', '2026-08-08', '2026-08-08', { id: 't' }),
                newBlock('montaza', '2026-08-09', '2026-08-09', { id: 'm' }),
            ],
            [newLink('p', 't', 'finish-to-start'), newLink('t', 'm', 'finish-to-montaza')]
        );
        const res = computeForwardChain(s, 'p', opts)!;
        expect(res.changes.find(c => c.id === 't')!.startISO).toBe('2026-08-21');
        expect(res.changes.find(c => c.id === 'm')!.startISO).toBe('2026-08-22');
    });

    test('nasljednik koji je već dovoljno kasno se ne dira', () => {
        const s = scenarioOf(
            [
                newBlock('order', '2026-08-03', '2026-08-07', { id: 'p' }),
                newBlock('transport', '2026-09-01', '2026-09-01', { id: 't' }),
            ],
            [newLink('p', 't', 'finish-to-start')]
        );
        expect(computeForwardChain(s, 'p', opts)!.changes).toEqual([]);
    });

    test('zaključan nasljednik blokira pomak i prijavi se', () => {
        const s = scenarioOf(
            [
                newBlock('order', '2026-08-03', '2026-08-20', { id: 'p' }),
                newBlock('transport', '2026-08-08', '2026-08-08', { id: 't', locked: true }),
            ],
            [newLink('p', 't', 'finish-to-start')]
        );
        const res = computeForwardChain(s, 'p', opts)!;
        expect(res.changes).toEqual([]);
    });
});

describe('kandidati za sidro', () => {
    test('samo fiksne obaveze (montaža i prekretnica)', () => {
        const s = scenarioOf([
            newBlock('order', '2026-08-03', '2026-08-07', { id: 'p' }),
            newBlock('montaza', '2026-09-15', '2026-09-16', { id: 'm' }),
            newBlock('milestone', '2026-09-20', undefined, { id: 'v' }),
            newBlock('purchase', '2026-08-01', '2026-08-07', { id: 'n' }),
        ]);
        expect(anchorCandidates(s).map(b => b.id)).toEqual(['m', 'v']);
    });
});
