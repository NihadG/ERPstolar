import { layoutProcessGraph, NODE_W } from '../processLayout';

const colOf = (x: number) => Math.round((x - 24) / (NODE_W + 70));

describe('layoutProcessGraph', () => {
    test('prazno → {}', () => {
        expect(layoutProcessGraph([], [])).toEqual({});
    });

    test('jedan čvor → kolona 0', () => {
        const pos = layoutProcessGraph([{ id: 'a' }], []);
        expect(colOf(pos.a.x)).toBe(0);
    });

    test('lanac A→B→C → kolone 0,1,2, isti red (y)', () => {
        const pos = layoutProcessGraph(
            [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
            [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }]
        );
        expect(colOf(pos.a.x)).toBe(0);
        expect(colOf(pos.b.x)).toBe(1);
        expect(colOf(pos.c.x)).toBe(2);
        expect(pos.a.y).toBe(pos.b.y);
        expect(pos.b.y).toBe(pos.c.y);
    });

    test('paralela A→B, A→C → B i C ista kolona, različit red (y)', () => {
        const pos = layoutProcessGraph(
            [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
            [{ source: 'a', target: 'b' }, { source: 'a', target: 'c' }]
        );
        expect(colOf(pos.b.x)).toBe(1);
        expect(colOf(pos.c.x)).toBe(1);
        expect(pos.b.y).not.toBe(pos.c.y);
    });

    test('spajanje (merge): B→D, C→D → D u koloni 2', () => {
        const pos = layoutProcessGraph(
            [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
            [
                { source: 'a', target: 'b' }, { source: 'a', target: 'c' },
                { source: 'b', target: 'd' }, { source: 'c', target: 'd' },
            ]
        );
        expect(colOf(pos.a.x)).toBe(0);
        expect(colOf(pos.b.x)).toBe(1);
        expect(colOf(pos.c.x)).toBe(1);
        expect(colOf(pos.d.x)).toBe(2);
    });

    test('više korijena (bez veza) → svi kolona 0, različiti redovi', () => {
        const pos = layoutProcessGraph([{ id: 'a' }, { id: 'b' }], []);
        expect(colOf(pos.a.x)).toBe(0);
        expect(colOf(pos.b.x)).toBe(0);
        expect(pos.a.y).not.toBe(pos.b.y);
    });

    test('ciklus se ne zaglavi (defenzivno)', () => {
        const pos = layoutProcessGraph(
            [{ id: 'a' }, { id: 'b' }],
            [{ source: 'a', target: 'b' }, { source: 'b', target: 'a' }]
        );
        expect(Object.keys(pos).sort()).toEqual(['a', 'b']);
    });
});
