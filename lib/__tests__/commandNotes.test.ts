import {
    ageLabel, collectNotes, compareNotes, daysBetween, groupNotes, noteSearchText,
    type CommandNote, type NoteSort,
} from '../command/notes';
import { PRODUCT_NOTE_AUDIENCE_LABELS, type Project } from '../types';

const TODAY = '2026-09-12';

const projects = [
    {
        Project_ID: 'p1', Name: 'Aamanns', Client_Name: 'Igor',
        products: [{
            Product_ID: 'prod1', Name: 'Klupa',
            Questions: [
                { id: 'old', Text: 'Staro pitanje', Audience: 'client', Resolved: false, Created_At: '2026-08-20' },
                { id: 'fresh', Text: 'Novo pitanje', Audience: 'supplier', Resolved: false, Created_At: '2026-09-11' },
                { id: 'done', Text: 'Riješeno', Audience: 'client', Resolved: true, Created_At: '2026-09-01' },
            ],
        }],
    },
    {
        Project_ID: 'p2', Name: 'Melihin', Client_Name: 'Meliha',
        products: [{
            Product_ID: 'prod2', Name: 'Vrata',
            Questions: [{ id: 'ans', Text: 'Odgovoreno pitanje', Audience: 'client', Answer: 'Da', Answered_At: '2026-09-10', Resolved: false, Created_At: '2026-09-02' }],
        }],
    },
] as unknown as Project[];

const order = new Map([['p1', 0], ['p2', 1]]);
const notes = collectNotes(projects, TODAY);
const find = (id: string) => notes.find(n => n.note.id === id)!;

test('starost se računa od postavljanja, a za odgovorena od odgovora', () => {
    expect(daysBetween('2026-09-05', TODAY)).toBe(7);
    expect(find('old').ageDays).toBe(23);
    expect(find('ans').ageDays).toBe(2);        // od odgovora, ne od pitanja
});

test('pitanje koje čeka preko sedmice se označava kao zapelo', () => {
    expect(find('old').stale).toBe(true);
    expect(find('fresh').stale).toBe(false);
    expect(find('ans').stale).toBe(false);      // odgovoreno nije zapelo
});

test('otvoreno ide prije odgovorenog, a najduže čekanje na vrh', () => {
    const sorted = [...notes].sort(compareNotes);
    expect(sorted.map(n => n.note.id)).toEqual(['old', 'fresh', 'ans', 'done']);
});

test('grupisanje po primaocu skuplja sve što jedan čovjek duguje', () => {
    const groups = groupNotes(notes, 'audience', PRODUCT_NOTE_AUDIENCE_LABELS, order);
    expect(groups.map(g => g.label)).toEqual(['Klijent', 'Dobavljač']);
    expect(groups[0].openCount).toBe(1);        // 'old'; 'ans' je odgovoreno, 'done' riješeno
    expect(groups[0].notes.map(n => n.note.id)).toEqual(['old', 'ans', 'done']);
});

test('grupa bez otvorenih pitanja pada ispod onih koje nešto čekaju', () => {
    const onlyResolved: CommandNote[] = [
        { ...find('done'), note: { ...find('done').note, Audience: 'colleague' } },
        find('fresh'),
    ];
    const groups = groupNotes(onlyResolved, 'audience', PRODUCT_NOTE_AUDIENCE_LABELS, order);
    expect(groups.map(g => g.label)).toEqual(['Dobavljač', 'Kolega']);
});

test('grupisanje po projektu poštuje redoslijed table', () => {
    const groups = groupNotes(notes, 'project', PRODUCT_NOTE_AUDIENCE_LABELS, order);
    expect(groups.map(g => g.projectId)).toEqual(['p1', 'p2']);
});

test('trajanje se skraćuje da stane u ugao kartice', () => {
    expect([ageLabel(0), ageLabel(1), ageLabel(5), ageLabel(9), ageLabel(70)])
        .toEqual(['danas', '1 dan', '5 dana', '1 sedm.', '2 mj.']);
});

test('sortiranje mijenja poredak SAMO unutar istog stanja', () => {
    const ids = (sort: NoteSort) => [...notes].sort((a, b) => compareNotes(a, b, sort)).map(n => n.note.id);
    expect(ids('oldest')).toEqual(['old', 'fresh', 'ans', 'done']);
    expect(ids('newest')).toEqual(['fresh', 'old', 'ans', 'done']);
    // Riješeno nikad ne ispliva na vrh, ma kako se sortiralo.
    expect(ids('alpha')[3]).toBe('done');
});

test('abecedno sortira po tekstu pitanja', () => {
    const sorted = [...notes].sort((a, b) => compareNotes(a, b, 'alpha')).map(n => n.note.Text);
    expect(sorted.slice(0, 2)).toEqual(['Novo pitanje', 'Staro pitanje']);
});

test('grupisanje po poziciji nosi projekat kao podnaslov i boju', () => {
    const groups = groupNotes(notes, 'product', PRODUCT_NOTE_AUDIENCE_LABELS, order);
    expect(groups.map(g => g.label)).toEqual(['Klupa', 'Vrata']);
    expect(groups[0].sublabel).toBe('Aamanns');
    expect(groups[0].projectId).toBe('p1');
});

test('napomena se nalazi po pitanju, odgovoru, projektu i poziciji', () => {
    const text = noteSearchText(find('ans'));
    expect(text).toContain('Odgovoreno pitanje');
    expect(text).toContain('Da');
    expect(text).toContain('Melihin');
    expect(text).toContain('Vrata');
});
