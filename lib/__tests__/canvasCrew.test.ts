import { crewMembers, crewWorkerRefs, crewSize, crewLabel, type PlanCrew, type PlanRef } from '../types';
import { newCrew, crewSignature, hasSameCrew, crewCountForWorker } from '../canvas/crew';

const ref = (id: string, name = id.toUpperCase()): PlanRef => ({ id, name });

describe('povratna kompatibilnost sa spremljenim scenarijima', () => {
    // Firestore je pun ekipa zapisanih PRIJE prelaska na `members`.
    const legacy: PlanCrew = { id: 'c1', lead: ref('w1', 'Emir'), helper: ref('w2', 'Haris') };

    test('stari `helper` se i dalje čita kao pomoćnik', () => {
        expect(crewMembers(legacy).map(r => r.id)).toEqual(['w2']);
        expect(crewSize(legacy)).toBe(2);
        expect(crewWorkerRefs(legacy).map(r => r.id)).toEqual(['w1', 'w2']);
    });

    test('stara ekipa bez pomoćnika je veličine 1', () => {
        const solo: PlanCrew = { id: 'c2', lead: ref('w1') };
        expect(crewSize(solo)).toBe(1);
        expect(crewMembers(solo)).toEqual([]);
    });

    test('`members` ima prednost kad su oba oblika prisutna', () => {
        const both: PlanCrew = {
            id: 'c3', lead: ref('w1'), helper: ref('w2'),
            members: [ref('w3'), ref('w4')],
        };
        expect(crewMembers(both).map(r => r.id)).toEqual(['w3', 'w4']);
        expect(crewSize(both)).toBe(3);
    });
});

describe('ekipa od više ljudi', () => {
    test('majstor + 3 pomoćnika', () => {
        const c = newCrew(ref('w1', 'Emir'), [ref('w2', 'Haris'), ref('w3', 'Bego'), ref('w4', 'Braco')]);
        expect(crewSize(c)).toBe(4);
        expect(crewWorkerRefs(c).map(r => r.name)).toEqual(['Emir', 'Haris', 'Bego', 'Braco']);
    });

    test('glavni se izbacuje iz pomoćnika', () => {
        const c = newCrew(ref('w1'), [ref('w1'), ref('w2')]);
        expect(crewSize(c)).toBe(2);
        expect(crewMembers(c).map(r => r.id)).toEqual(['w2']);
    });

    test('duplikat pomoćnika bi lažno povećao ekipu — izbacuje se', () => {
        const c = newCrew(ref('w1'), [ref('w2'), ref('w2'), ref('w3')]);
        expect(crewSize(c)).toBe(3);
    });

    test('duplikat u ručno sklopljenoj ekipi se takođe ne broji dvaput', () => {
        const dirty: PlanCrew = { id: 'x', lead: ref('w1'), members: [ref('w1'), ref('w2')] };
        expect(crewSize(dirty)).toBe(2);
    });

    test('ekipa samo od glavnog je legitimna', () => {
        expect(crewSize(newCrew(ref('w1')))).toBe(1);
    });
});

describe('naziv ekipe', () => {
    test('jedan, dva, pa skraćeno', () => {
        expect(crewLabel(newCrew(ref('w1', 'Emir')))).toBe('Emir');
        expect(crewLabel(newCrew(ref('w1', 'Emir'), [ref('w2', 'Haris')]))).toBe('Emir + Haris');
        expect(crewLabel(newCrew(ref('w1', 'Emir'), [ref('w2', 'Haris'), ref('w3', 'Bego')])))
            .toBe('Emir + Haris + 1');
    });
});

describe('isti radnik u više grupa', () => {
    const list = [
        newCrew(ref('w1', 'Emir'), [ref('w2', 'Haris')]),
        newCrew(ref('w1', 'Emir'), [ref('w3', 'Bego')]),
        newCrew(ref('w4', 'Damir'), [ref('w2', 'Haris')]),
    ];

    test('dozvoljeno je i broji se ispravno', () => {
        expect(crewCountForWorker(list, 'w1')).toBe(2);   // Emir vodi dvije
        expect(crewCountForWorker(list, 'w2')).toBe(2);   // Haris pomaže u dvije
        expect(crewCountForWorker(list, 'w3')).toBe(1);
        expect(crewCountForWorker(list, 'w9')).toBe(0);
    });

    test('različit sastav oko istog majstora nije duplikat', () => {
        expect(hasSameCrew(list, newCrew(ref('w1'), [ref('w5')]))).toBe(false);
    });
});

describe('potpis sastava', () => {
    test('redoslijed pomoćnika ne mijenja ekipu', () => {
        const a = newCrew(ref('w1'), [ref('w2'), ref('w3')]);
        const b = newCrew(ref('w1'), [ref('w3'), ref('w2')]);
        expect(crewSignature(a)).toBe(crewSignature(b));
        expect(hasSameCrew([a], b)).toBe(true);
    });

    test('zamjena glavnog i pomoćnika JESTE druga ekipa', () => {
        // Glavni nosi kontinuitet na projektu, pa nije svejedno ko vodi.
        const a = newCrew(ref('w1'), [ref('w2')]);
        const b = newCrew(ref('w2'), [ref('w1')]);
        expect(crewSignature(a)).not.toBe(crewSignature(b));
    });

    test('stari i novi oblik iste ekipe imaju isti potpis', () => {
        const legacy: PlanCrew = { id: 'a', lead: ref('w1'), helper: ref('w2') };
        const modern: PlanCrew = { id: 'b', lead: ref('w1'), members: [ref('w2')] };
        expect(crewSignature(legacy)).toBe(crewSignature(modern));
    });
});
