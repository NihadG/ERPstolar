import {
    shiftLetterOf, shiftSaturdays, crewKeyOf, crewShift, shortNameMap, crewLabelShort,
} from '../canvas/crews';
import { projectColorMap, PROJECT_COLORS } from '../canvas/palette';

describe('subotnja smjena — slovo je stabilno', () => {
    test('sidra dvije sedmice razmaka su ista smjena, susjedne sedmice različite', () => {
        expect(shiftLetterOf('2026-11-21')).toBe('A');
        expect(shiftLetterOf('2026-11-28')).toBe('B');
        expect(shiftLetterOf('2026-12-05')).toBe('A');
        expect(shiftLetterOf(undefined)).toBeNull();
    });

    test('radne subote smjene od datuma', () => {
        expect(shiftSaturdays('A', '2026-11-21', 3)).toEqual(['2026-11-21', '2026-12-05', '2026-12-19']);
        expect(shiftSaturdays('B', '2026-11-23', 2)).toEqual(['2026-11-28', '2026-12-12']);
    });
});

describe('ekipa', () => {
    const workers = [
        { Worker_ID: 'n', Name: 'Nedim Begić', Saturday_Anchor: '2026-11-21' },
        { Worker_ID: 'a', Name: 'Aldin Hodžić', Saturday_Anchor: '2026-11-21' },
        { Worker_ID: 'i', Name: 'Imer Kovač', Saturday_Anchor: '2026-11-28' },
        { Worker_ID: 'x', Name: 'Nedim Zec' },
    ];
    const byId = new Map(workers.map(w => [w.Worker_ID, w]));

    test('ključ ekipe ne zavisi od redoslijeda radnika', () => {
        expect(crewKeyOf([{ id: 'n', name: '' }, { id: 'a', name: '' }]))
            .toBe(crewKeyOf([{ id: 'a', name: '' }, { id: 'n', name: '' }]));
        expect(crewKeyOf(undefined)).toBe('');
    });

    test('smjena ekipe: ista → slovo, različite → mix, nijedna → null', () => {
        expect(crewShift([{ id: 'n', name: '' }, { id: 'a', name: '' }], byId)).toBe('A');
        expect(crewShift([{ id: 'n', name: '' }, { id: 'i', name: '' }], byId)).toBe('mix');
        expect(crewShift([{ id: 'x', name: '' }], byId)).toBeNull();
        // član bez smjene uz člana sa smjenom → ekipa ide po smjeni
        expect(crewShift([{ id: 'n', name: '' }, { id: 'x', name: '' }], byId)).toBe('A');
    });

    test('kratka imena: prezime samo kad se ime ponavlja', () => {
        const names = shortNameMap(workers);
        expect(names.get('a')).toBe('Aldin');
        expect(names.get('n')).toBe('Nedim B.');
        expect(crewLabelShort([{ id: 'n', name: 'Nedim Begić' }, { id: 'a', name: 'Aldin Hodžić' }], names)).toBe('Nedim B. + Aldin');
        expect(crewLabelShort([], names)).toBe('Bez ekipe');
    });
});

describe('boje projekata u jednom planu', () => {
    test('dva projekta nikad ne dijele boju (dok ih je ≤ 6)', () => {
        // Stvarni slučaj: ova dva ID-a imaju isti hash-indeks.
        const keys = ['31dacea7-02bd-439a-a29d-f5b6cca93c91', '47048c40-d3f9-4b55-9684-4d013075b130',
            'b3cefd8a-c32a-45a8-9b93-07d3c9849f25', '2277f13e-62a5-49de-bd01-9f24ccfab379'];
        const map = projectColorMap(keys);
        expect(new Set(keys.map(k => map.get(k)!.ink)).size).toBe(4);
    });

    test('dodjela je deterministička i ne zavisi od redoslijeda', () => {
        const a = projectColorMap(['p1', 'p2', 'p3']);
        const b = projectColorMap(['p3', 'p1', 'p2', 'p1']);
        for (const k of ['p1', 'p2', 'p3']) expect(a.get(k)).toEqual(b.get(k));
    });

    test('više projekata od boja — ponavlja se, ali svaki dobije boju', () => {
        const keys = Array.from({ length: PROJECT_COLORS.length + 2 }, (_, i) => `p${i}`);
        const map = projectColorMap(keys);
        expect(keys.every(k => !!map.get(k))).toBe(true);
    });
});
