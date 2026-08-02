// ════════════════════════════════════════════════════════════════════
// RADNIKOVE NAPOMENE
//
// Provjerava da tab pokazuje napomene koje se TIČU radnika (dodijeljene ILI
// vezane za njegov nalog/proizvod), da razrješava naziv naloga/proizvoda i da
// autorizacija izmjene prati istu relaciju. Bez novca (Task ga i nema).
// ════════════════════════════════════════════════════════════════════

import { buildWorkerNotes, canWorkerTouchTask, type WorkerNotesInput } from '@/lib/field/fieldNotes';
import type { Task } from '@/lib/types';

const task = (over: Partial<Task> = {}): Task => ({
    Task_ID: 't-1', Organization_ID: 'org-1', Title: 'Provjeri mjere',
    Description: '', Status: 'pending', Priority: 'high', Category: 'general',
    Created_Date: '2026-07-10T08:00:00.000Z',
    Links: [],
    ...over,
} as Task);

const input = (over: Partial<WorkerNotesInput> = {}): WorkerNotesInput => ({
    tasks: [],
    workerId: 'w-1',
    myOrderIds: new Set(['wo-1']),
    myProductIds: new Set(['p-1']),
    orderNameById: new Map([['wo-1', 'Kuhinja Mujo']]),
    productNameById: new Map([['p-1', 'Gornji element']]),
    ...over,
});

describe('buildWorkerNotes', () => {
    it('uključuje napomenu dodijeljenu radniku (bez naloga → lična)', () => {
        const notes = buildWorkerNotes(input({
            tasks: [task({ Assigned_Worker_ID: 'w-1', Links: [] })],
        }));
        expect(notes).toHaveLength(1);
        expect(notes[0]).toMatchObject({ source: 'assigned', orderId: null, productId: null });
    });

    it('uključuje napomenu vezanu za radnikov nalog i razrješava naziv naloga', () => {
        const notes = buildWorkerNotes(input({
            tasks: [task({ Links: [{ Entity_Type: 'work_order', Entity_ID: 'wo-1', Entity_Name: 'stari naziv' }] })],
        }));
        expect(notes[0]).toMatchObject({ source: 'order', orderId: 'wo-1', orderName: 'Kuhinja Mujo' });
    });

    it('uključuje napomenu vezanu za radnikov proizvod', () => {
        const notes = buildWorkerNotes(input({
            tasks: [task({ Links: [{ Entity_Type: 'product', Entity_ID: 'p-1', Entity_Name: 'x' }] })],
        }));
        expect(notes[0]).toMatchObject({ source: 'product', productId: 'p-1', productName: 'Gornji element' });
    });

    it('ISKLJUČUJE tuđu napomenu (drugi radnik, tuđi nalog/proizvod)', () => {
        const notes = buildWorkerNotes(input({
            tasks: [task({
                Assigned_Worker_ID: 'w-9',
                Links: [{ Entity_Type: 'work_order', Entity_ID: 'wo-9', Entity_Name: 'Tuđi' }],
            })],
        }));
        expect(notes).toEqual([]);
    });

    it('otkazane se ne prikazuju; otvorene prije završenih', () => {
        const notes = buildWorkerNotes(input({
            tasks: [
                task({ Task_ID: 'done', Status: 'completed', Assigned_Worker_ID: 'w-1' }),
                task({ Task_ID: 'cancel', Status: 'cancelled', Assigned_Worker_ID: 'w-1' }),
                task({ Task_ID: 'open', Status: 'pending', Assigned_Worker_ID: 'w-1' }),
            ],
        }));
        expect(notes.map(n => n.taskId)).toEqual(['open', 'done']);
    });

    it('projektuje opis, rok i checklistu (za expandable prikaz)', () => {
        const notes = buildWorkerNotes(input({
            tasks: [task({
                Assigned_Worker_ID: 'w-1',
                Description: 'Provjeri dimenzije prije rezanja',
                Due_Date: '2026-08-10',
                Checklist: [
                    { id: 'c1', text: 'Izmjeri širinu', completed: true },
                    { id: 'c2', text: 'Izmjeri visinu', completed: false },
                ],
            })],
        }));
        expect(notes[0]).toMatchObject({
            description: 'Provjeri dimenzije prije rezanja',
            dueDate: '2026-08-10',
        });
        expect(notes[0].checklist).toEqual([
            { id: 'c1', text: 'Izmjeri širinu', completed: true },
            { id: 'c2', text: 'Izmjeri visinu', completed: false },
        ]);
    });

    it('bez detalja daje prazan opis i praznu checklistu', () => {
        const notes = buildWorkerNotes(input({ tasks: [task({ Assigned_Worker_ID: 'w-1' })] }));
        expect(notes[0]).toMatchObject({ description: '', notes: '', dueDate: null });
        expect(notes[0].checklist).toEqual([]);
    });

    it('ne propušta novac (nijedan broj/ključ tipa iznos)', () => {
        const notes = buildWorkerNotes(input({ tasks: [task({ Assigned_Worker_ID: 'w-1' })] }));
        const json = JSON.stringify(notes);
        expect(json).not.toContain('Daily_Rate');
        expect(json).not.toContain('Total_Value');
    });
});

describe('canWorkerTouchTask', () => {
    const my = { orders: new Set(['wo-1']), products: new Set(['p-1']) };

    it('dozvoljava kad je dodijeljena radniku', () => {
        expect(canWorkerTouchTask({ Assigned_Worker_ID: 'w-1', Links: [] }, 'w-1', my.orders, my.products)).toBe(true);
    });

    it('dozvoljava kad je vezana za radnikov nalog', () => {
        expect(canWorkerTouchTask(
            { Links: [{ Entity_Type: 'work_order', Entity_ID: 'wo-1', Entity_Name: '' }] },
            'w-1', my.orders, my.products,
        )).toBe(true);
    });

    it('odbija tuđu napomenu', () => {
        expect(canWorkerTouchTask(
            { Assigned_Worker_ID: 'w-9', Links: [{ Entity_Type: 'work_order', Entity_ID: 'wo-9', Entity_Name: '' }] },
            'w-1', my.orders, my.products,
        )).toBe(false);
    });
});
