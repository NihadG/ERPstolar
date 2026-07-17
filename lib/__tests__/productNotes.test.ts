/**
 * Otvorena pitanja / napomene po proizvodu — čista logika.
 */

import {
    addNote, updateNote, removeNote, toggleResolved,
    noteStatus, summarizeNotes, sortNotes,
    groupNotesByProduct, summarizeProjectNotes, filterNotes,
} from '../productNotes';
import type { ProductNote } from '../types';

const NOW = '2026-07-17T10:00:00.000Z';
const LATER = '2026-07-18T10:00:00.000Z';

const note = (over: Partial<ProductNote> & { id: string }): ProductNote => ({
    Text: 'Pitanje',
    Audience: 'client',
    Resolved: false,
    Created_At: NOW,
    ...over,
});

describe('addNote', () => {
    test('dodaje pitanje s generisanim id-em', () => {
        const out = addNote([], { Text: 'Koja boja fronte?', Audience: 'client' }, NOW);
        expect(out).toHaveLength(1);
        expect(out[0].Text).toBe('Koja boja fronte?');
        expect(out[0].Audience).toBe('client');
        expect(out[0].Resolved).toBe(false);
        expect(out[0].Created_At).toBe(NOW);
        expect(out[0].id).toBeTruthy();
        expect(out[0].Answer).toBeUndefined();
    });

    test('trimuje tekst i odbacuje prazan', () => {
        expect(addNote([], { Text: '  ', Audience: 'client' }, NOW)).toEqual([]);
        expect(addNote(undefined, { Text: '', Audience: 'supplier' }, NOW)).toEqual([]);
        expect(addNote([], { Text: '  Pitanje  ', Audience: 'client' }, NOW)[0].Text).toBe('Pitanje');
    });

    test('odmah upisan odgovor postavlja Answered_At', () => {
        const out = addNote([], { Text: 'Q', Audience: 'supplier', Answer: 'Da' }, NOW);
        expect(out[0].Answer).toBe('Da');
        expect(out[0].Answered_At).toBe(NOW);
    });

    test('ne mijenja ulazni niz', () => {
        const notes = [note({ id: 'a' })];
        addNote(notes, { Text: 'novo', Audience: 'client' }, NOW);
        expect(notes).toHaveLength(1);
    });
});

describe('updateNote', () => {
    test('mijenja tekst i primaoca', () => {
        const notes = [note({ id: 'a', Text: 'staro', Audience: 'client' })];
        const out = updateNote(notes, 'a', { Text: 'novo', Audience: 'supplier' }, LATER);
        expect(out[0].Text).toBe('novo');
        expect(out[0].Audience).toBe('supplier');
        expect(out[0].Updated_At).toBe(LATER);
    });

    test('prazan tekst se ignoriše (ne briše postojeći)', () => {
        const notes = [note({ id: 'a', Text: 'staro' })];
        expect(updateNote(notes, 'a', { Text: '   ' }, LATER)[0].Text).toBe('staro');
    });

    test('prvi odgovor postavlja Answered_At', () => {
        const notes = [note({ id: 'a' })];
        const out = updateNote(notes, 'a', { Answer: 'Odgovor' }, LATER);
        expect(out[0].Answer).toBe('Odgovor');
        expect(out[0].Answered_At).toBe(LATER);
    });

    test('izmjena postojećeg odgovora NE pomjera Answered_At', () => {
        const notes = [note({ id: 'a', Answer: 'prvi', Answered_At: NOW })];
        const out = updateNote(notes, 'a', { Answer: 'ispravljen' }, LATER);
        expect(out[0].Answer).toBe('ispravljen');
        expect(out[0].Answered_At).toBe(NOW);
    });

    test('brisanje odgovora skida i Answer i Answered_At', () => {
        const notes = [note({ id: 'a', Answer: 'x', Answered_At: NOW })];
        const out = updateNote(notes, 'a', { Answer: '' }, LATER);
        expect(out[0].Answer).toBeUndefined();
        expect(out[0].Answered_At).toBeUndefined();
    });

    test('ne dira druga pitanja', () => {
        const notes = [note({ id: 'a' }), note({ id: 'b', Text: 'drugo' })];
        const out = updateNote(notes, 'a', { Resolved: true }, LATER);
        expect(out[1]).toBe(notes[1]);
    });
});

describe('removeNote / toggleResolved', () => {
    test('briše po id-u', () => {
        const notes = [note({ id: 'a' }), note({ id: 'b' })];
        expect(removeNote(notes, 'a').map(n => n.id)).toEqual(['b']);
    });

    test('toggle riješeno tam-i-vamo', () => {
        const notes = [note({ id: 'a', Resolved: false })];
        const once = toggleResolved(notes, 'a', LATER);
        expect(once[0].Resolved).toBe(true);
        expect(toggleResolved(once, 'a', LATER)[0].Resolved).toBe(false);
    });
});

describe('noteStatus', () => {
    test('riješeno ima prednost nad odgovorom', () => {
        expect(noteStatus({ Resolved: true, Answer: 'x' })).toBe('resolved');
    });
    test('odgovoreno kad ima Answer a nije riješeno', () => {
        expect(noteStatus({ Resolved: false, Answer: 'x' })).toBe('answered');
    });
    test('prazan odgovor je i dalje otvoreno', () => {
        expect(noteStatus({ Resolved: false, Answer: '  ' })).toBe('open');
        expect(noteStatus({ Resolved: false })).toBe('open');
    });
});

describe('summarizeNotes', () => {
    test('broji po statusu', () => {
        const notes = [
            note({ id: 'a' }),                              // open
            note({ id: 'b', Answer: 'x' }),                 // answered
            note({ id: 'c', Answer: 'x', Resolved: true }), // resolved
            note({ id: 'd', Resolved: true }),              // resolved
        ];
        expect(summarizeNotes(notes)).toEqual({ total: 4, open: 1, answered: 1, resolved: 2, unresolved: 2 });
    });

    test('prazno', () => {
        expect(summarizeNotes([])).toEqual({ total: 0, open: 0, answered: 0, resolved: 0, unresolved: 0 });
        expect(summarizeNotes(undefined)).toEqual({ total: 0, open: 0, answered: 0, resolved: 0, unresolved: 0 });
    });
});

describe('sortNotes', () => {
    test('otvoreno → odgovoreno → riješeno, pa najstarije', () => {
        const notes = [
            note({ id: 'resolved', Resolved: true, Created_At: '2026-07-01' }),
            note({ id: 'answered', Answer: 'x', Created_At: '2026-07-02' }),
            note({ id: 'open2', Created_At: '2026-07-05' }),
            note({ id: 'open1', Created_At: '2026-07-03' }),
        ];
        expect(sortNotes(notes).map(n => n.id)).toEqual(['open1', 'open2', 'answered', 'resolved']);
    });

    test('ne mijenja ulazni niz', () => {
        const notes = [note({ id: 'a', Resolved: true }), note({ id: 'b' })];
        sortNotes(notes);
        expect(notes.map(n => n.id)).toEqual(['a', 'b']);
    });
});

describe('groupNotesByProduct', () => {
    const products = [
        { Product_ID: 'p1', Name: 'Ormar', Questions: [note({ id: 'a' }), note({ id: 'b', Resolved: true })] },
        { Product_ID: 'p2', Name: 'Pult', Questions: [note({ id: 'c' })] },
        { Product_ID: 'p3', Name: 'Bez pitanja', Questions: [] },
    ];

    test('grupiše samo proizvode s pitanjima', () => {
        const groups = groupNotesByProduct(products);
        expect(groups.map(g => g.productId)).toEqual(['p1', 'p2']);
        expect(groups[0].summary.total).toBe(2);
    });

    test('includeEmpty zadržava prazne', () => {
        expect(groupNotesByProduct(products, { includeEmpty: true }).map(g => g.productId)).toEqual(['p1', 'p2', 'p3']);
    });

    test('onlyProductIds filtrira na izabrane (print selekcije)', () => {
        const groups = groupNotesByProduct(products, { onlyProductIds: new Set(['p2']) });
        expect(groups.map(g => g.productId)).toEqual(['p2']);
    });

    test('proizvod bez naziva dobija fallback', () => {
        const groups = groupNotesByProduct([{ Product_ID: 'x', Name: '', Questions: [note({ id: 'a' })] }]);
        expect(groups[0].productName).toBe('Bez naziva');
    });

    test('pitanja u grupi su sortirana', () => {
        const groups = groupNotesByProduct([{
            Product_ID: 'p', Name: 'X',
            Questions: [note({ id: 'r', Resolved: true, Created_At: '2026-07-01' }), note({ id: 'o', Created_At: '2026-07-02' })],
        }]);
        expect(groups[0].notes.map(n => n.id)).toEqual(['o', 'r']);
    });
});

describe('summarizeProjectNotes', () => {
    test('zbraja preko svih proizvoda', () => {
        const products = [
            { Questions: [note({ id: 'a' }), note({ id: 'b', Resolved: true })] },
            { Questions: [note({ id: 'c', Answer: 'x' })] },
            { Questions: undefined },
        ];
        expect(summarizeProjectNotes(products)).toEqual({ total: 3, open: 1, answered: 1, resolved: 1, unresolved: 2 });
    });
});

describe('filterNotes', () => {
    const notes = [
        note({ id: 'a', Audience: 'client' }),
        note({ id: 'b', Audience: 'supplier', Answer: 'x' }),
        note({ id: 'c', Audience: 'colleague', Resolved: true }),
    ];

    test('po primaocu', () => {
        expect(filterNotes(notes, { audience: 'supplier' }).map(n => n.id)).toEqual(['b']);
    });

    test('po statusu', () => {
        expect(filterNotes(notes, { status: 'resolved' }).map(n => n.id)).toEqual(['c']);
        expect(filterNotes(notes, { status: 'answered' }).map(n => n.id)).toEqual(['b']);
        expect(filterNotes(notes, { status: 'open' }).map(n => n.id)).toEqual(['a']);
    });

    test('„all" ne filtrira', () => {
        expect(filterNotes(notes, { audience: 'all', status: 'all' })).toHaveLength(3);
    });

    test('kombinacija primalac + status', () => {
        expect(filterNotes(notes, { audience: 'supplier', status: 'answered' }).map(n => n.id)).toEqual(['b']);
        expect(filterNotes(notes, { audience: 'client', status: 'resolved' })).toEqual([]);
    });
});
