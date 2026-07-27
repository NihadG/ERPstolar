import { captureChainTemplate, applyChainTemplate } from '../canvas/templates';
import { emptyScenario, newBlock, newLink, blockDurationDays, endFromWork } from '../canvas/model';
import type { PlanScenario, PlanBlock, PlanLink } from '../types';

const scenarioOf = (blocks: PlanBlock[], links: PlanLink[] = []): PlanScenario => ({
    ...emptyScenario('org', 'Test'),
    Blocks: blocks,
    Links: links,
});

/**
 * Narudžba (rok 6d) → Nalog (12 rd, ekipa 2) → Transport → Montaža (zaključana).
 * Nalog počinje u ponedjeljak i traje TAČNO onoliko koliko workerDays/crew daju
 * (6 radnih dana od 03.08 uklj. subotu = do 08.08) — fixture mora biti interno
 * konzistentan, jer templates.ts (kao i CanvasDrawer) izvodi kraj iz radnik-dana.
 */
const fullChain = () => {
    const narudzba = newBlock('purchase', '2026-07-01', '2026-07-07', { id: 'n', title: 'Frischeis', leadDays: 6 });
    const nalog = newBlock('order', '2026-08-03', '2026-08-08', { id: 'p', title: 'Kuhinja', workerDays: 12, crew: 2 });
    const transport = newBlock('transport', '2026-09-01', '2026-09-01', { id: 't', title: 'Prevoz' });
    const montaza = newBlock('montaza', '2026-09-15', '2026-09-16', { id: 'm', title: 'Montaža', locked: true });
    return scenarioOf(
        [narudzba, nalog, transport, montaza],
        [
            newLink('n', 'p', 'delivery-to-start'),
            newLink('p', 't', 'finish-to-start'),
            newLink('t', 'm', 'finish-to-montaza'),
        ]
    );
};

describe('captureChainTemplate', () => {
    test('blok bez ijedne veze nije lanac → null', () => {
        const s = scenarioOf([newBlock('montaza', '2026-09-15', '2026-09-16', { id: 'm' })]);
        expect(captureChainTemplate(s, 'm', 'X')).toBeNull();
    });

    test('nepostojeći anchor → null', () => {
        expect(captureChainTemplate(scenarioOf([]), 'nema', 'X')).toBeNull();
    });

    test('koraci su hronološki, offset relativan prema PRVOM koraku', () => {
        const t = captureChainTemplate(fullChain(), 'm', 'Kuhinja standard')!;
        expect(t.name).toBe('Kuhinja standard');
        expect(t.steps.map(s => s.kind)).toEqual(['purchase', 'order', 'transport', 'montaza']);
        expect(t.steps[0].offsetDays).toBe(0);   // prvi korak je nula
        expect(t.steps[1].offsetDays).toBe(33);  // 01.07 → 03.08
    });

    test('radnik-dani i ekipa se čuvaju, ne prošireni datumi', () => {
        const t = captureChainTemplate(fullChain(), 'm', 'X')!;
        const nalogStep = t.steps.find(s => s.kind === 'order')!;
        expect(nalogStep.workerDays).toBe(12);
        expect(nalogStep.crew).toBe(2);
    });

    test('rok isporuke narudžbe se čuva', () => {
        const t = captureChainTemplate(fullChain(), 'm', 'X')!;
        expect(t.steps.find(s => s.kind === 'purchase')!.leadDays).toBe(6);
    });

    test('prekretnica/montaža nema durationDays (nije relevantan)', () => {
        const t = captureChainTemplate(fullChain(), 'm', 'X')!;
        expect(t.steps.find(s => s.kind === 'purchase')!.durationDays).toBe(7);
        // montaža TRAJE (2 dana) pa durationDays ima smisla i za nju — samo milestone nema
        const withMilestone = scenarioOf(
            [newBlock('order', '2026-08-01', '2026-08-05', { id: 'p' }), newBlock('milestone', '2026-09-01', undefined, { id: 'v' })],
            [newLink('p', 'v', 'finish-to-start')]
        );
        const t2 = captureChainTemplate(withMilestone, 'v', 'X')!;
        expect(t2.steps.find(s => s.kind === 'milestone')!.durationDays).toBeUndefined();
    });

    test('veza između koraka se čuva s vrstom i razmakom', () => {
        const s = scenarioOf(
            [newBlock('order', '2026-08-01', '2026-08-05', { id: 'p' }), newBlock('transport', '2026-08-10', '2026-08-10', { id: 't' })],
            [newLink('p', 't', 'finish-to-start', 2)]
        );
        const t = captureChainTemplate(s, 't', 'X')!;
        expect(t.steps[0].linkKind).toBe('finish-to-start');
        expect(t.steps[0].lagDays).toBe(2);
    });

    test('korak bez veze ka sljedećem (grananje) nema linkKind, ne ruši hvatanje', () => {
        // p1 i p2 oba vode u m, ali p1→p2 direktne veze nema
        const s = scenarioOf(
            [
                newBlock('purchase', '2026-07-01', '2026-07-05', { id: 'p1' }),
                newBlock('order', '2026-08-01', '2026-08-05', { id: 'p2' }),
                newBlock('montaza', '2026-09-01', '2026-09-01', { id: 'm', locked: true }),
            ],
            [newLink('p1', 'm', 'delivery-to-start'), newLink('p2', 'm', 'finish-to-montaza')]
        );
        const t = captureChainTemplate(s, 'm', 'X')!;
        expect(t.steps).toHaveLength(3);
        // p1→p2 (susjedni hronološki) nemaju direktnu vezu
        expect(t.steps[0].linkKind).toBeUndefined();
    });

    test('prazan naziv dobija podrazumijevani', () => {
        const t = captureChainTemplate(fullChain(), 'm', '   ')!;
        expect(t.name).toBe('Bez naziva');
    });
});

describe('applyChainTemplate', () => {
    test('prvi korak počinje TAČNO na zadanom datumu', () => {
        const t = captureChainTemplate(fullChain(), 'm', 'X')!;
        const { blocks } = applyChainTemplate(t, '2026-01-05');
        expect(blocks[0].startISO).toBe('2026-01-05');
    });

    test('offset se prenosi vjerno — isti razmak kao original', () => {
        const t = captureChainTemplate(fullChain(), 'm', 'X')!;
        const { blocks } = applyChainTemplate(t, '2026-01-05');
        // Original: narudžba 01.07 → nalog 03.08 = 33 dana razmaka
        const gap = Math.round(
            (new Date(blocks[1].startISO).getTime() - new Date(blocks[0].startISO).getTime()) / 86400000
        );
        expect(gap).toBe(33);
    });

    test('radnik-dani + ekipa se PREFERIRAJU nad kalendarskim trajanjem (kao CanvasDrawer)', () => {
        const t = captureChainTemplate(fullChain(), 'm', 'X')!;
        const { blocks } = applyChainTemplate(t, '2026-01-05');
        const nalog = blocks.find(b => b.kind === 'order')!;
        // Kraj mora biti IZVEDEN iz 12 radnik-dana / 2 ekipe od STVARNOG (pomjerenog)
        // starta — ne iz kalendarskog trajanja koje je šablon uzgredno uhvatio.
        expect(nalog.endISO).toBe(endFromWork(nalog.startISO, 12, 2));
    });

    test('narudžba dobija trajanje iz leadDays', () => {
        const t = captureChainTemplate(fullChain(), 'm', 'X')!;
        const { blocks } = applyChainTemplate(t, '2026-01-05');
        const narudzba = blocks.find(b => b.kind === 'purchase')!;
        expect(blockDurationDays(narudzba)).toBe(7);   // 6 dana rok + 1 (uključivo)
    });

    test('svaki blok dobija NOVI id — instanca se ne miješa sa šablonom', () => {
        const t = captureChainTemplate(fullChain(), 'm', 'X')!;
        const a = applyChainTemplate(t, '2026-01-05');
        const b = applyChainTemplate(t, '2026-02-05');
        const idsA = new Set(a.blocks.map(x => x.id));
        const idsB = new Set(b.blocks.map(x => x.id));
        expect([...idsA].some(id => idsB.has(id))).toBe(false);
    });

    test('veze se rekreiraju između NOVIH blokova, redoslijedom koraka', () => {
        const t = captureChainTemplate(fullChain(), 'm', 'X')!;
        const { blocks, links } = applyChainTemplate(t, '2026-01-05');
        expect(links).toHaveLength(3);   // n→p, p→t, t→m
        const byId = new Map(blocks.map(b => [b.id, b]));
        for (const l of links) {
            expect(byId.has(l.from)).toBe(true);
            expect(byId.has(l.to)).toBe(true);
        }
    });

    test('šablon bez ijedne reference (projekt/radnik/dobavljač)', () => {
        const t = captureChainTemplate(fullChain(), 'm', 'X')!;
        const { blocks } = applyChainTemplate(t, '2026-01-05');
        for (const b of blocks) {
            expect(b.projectRef).toBeUndefined();
            expect(b.workerRefs).toBeUndefined();
            expect(b.supplierRef).toBeUndefined();
            expect(b.productRefs).toBeUndefined();
        }
    });

    test('primjena je čista — ne mijenja originalni scenarij niti šablon', () => {
        const scenario = fullChain();
        const t = captureChainTemplate(scenario, 'm', 'X')!;
        const before = JSON.stringify(scenario);
        const beforeT = JSON.stringify(t);
        applyChainTemplate(t, '2026-01-05');
        expect(JSON.stringify(scenario)).toBe(before);
        expect(JSON.stringify(t)).toBe(beforeT);
    });
});
