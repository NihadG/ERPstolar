import { getTaskChecklistSections } from '../taskChecklist';
import type { ChecklistItem } from '../types';

const item = (id: string, groupId?: string): ChecklistItem => ({
    id,
    text: id,
    completed: false,
    ...(groupId ? { groupId } : {}),
});

describe('getTaskChecklistSections', () => {
    test('returns no sections for an empty checklist', () => {
        expect(getTaskChecklistSections({ Checklist: [], ChecklistGroups: [{ id: 'a', name: 'A' }] })).toEqual([]);
    });

    test('keeps legacy items together and in their original order', () => {
        const items = [item('first'), item('second')];
        expect(getTaskChecklistSections({ Checklist: items })).toEqual([
            { id: null, name: null, items },
        ]);
    });

    test('puts ungrouped and unknown groups first, then named groups in metadata order', () => {
        const items = [
            item('b-1', 'b'), item('plain'), item('a-1', 'a'),
            item('unknown', 'removed'), item('b-2', 'b'), item('a-2', 'a'),
        ];
        expect(getTaskChecklistSections({
            Checklist: items,
            ChecklistGroups: [
                { id: 'a', name: 'Priprema' },
                { id: 'empty', name: 'Prazna' },
                { id: 'b', name: 'Montaža' },
            ],
        })).toEqual([
            { id: null, name: null, items: [items[1], items[3]] },
            { id: 'a', name: 'Priprema', items: [items[2], items[5]] },
            { id: 'b', name: 'Montaža', items: [items[0], items[4]] },
        ]);
        expect(items.map(i => i.id)).toEqual(['b-1', 'plain', 'a-1', 'unknown', 'b-2', 'a-2']);
    });
});
