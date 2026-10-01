import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import TaskChecklistEditor from '../TaskChecklistEditor';
import type { ChecklistItem, TaskChecklistGroup } from '@/lib/types';

function Harness() {
    const [items, setItems] = useState<ChecklistItem[]>([
        { id: 'first', text: 'Prvi korak', completed: false },
        { id: 'second', text: 'Drugi korak', completed: false },
    ]);
    const [groups, setGroups] = useState<TaskChecklistGroup[]>([]);
    return <TaskChecklistEditor items={items} groups={groups} onChange={(nextItems, nextGroups) => {
        setItems(nextItems);
        setGroups(nextGroups);
    }} />;
}

describe('TaskChecklistEditor', () => {
    it('keeps the chosen item order and lets a named group contain checklist items', () => {
        render(<Harness />);

        fireEvent.click(screen.getByRole('button', { name: 'Pomjeri Drugi korak gore' }));
        const rows = screen.getAllByText(/^(Prvi|Drugi) korak$/);
        expect(rows.map(row => row.textContent)).toEqual(['Drugi korak', 'Prvi korak']);

        fireEvent.click(screen.getByRole('button', { name: 'Dodaj grupu' }));
        fireEvent.change(screen.getByRole('textbox', { name: 'Naziv nove grupe' }), { target: { value: 'Priprema' } });
        fireEvent.click(screen.getByRole('button', { name: 'Dodaj grupu' }));

        const groupSelect = screen.getByRole('combobox', { name: 'Grupa stavke Drugi korak' });
        const groupId = within(groupSelect).getByRole('option', { name: 'Priprema' }).getAttribute('value');
        fireEvent.change(groupSelect, { target: { value: groupId } });
        const newItem = screen.getByRole('textbox', { name: 'Nova stavka kontrolne liste' });
        fireEvent.change(newItem, { target: { value: 'Treći korak' } });
        fireEvent.click(screen.getByRole('button', { name: 'Dodaj stavku' }));

        fireEvent.click(screen.getByRole('button', { name: 'Pomjeri Treći korak gore' }));
        const group = screen.getByText('Priprema', { selector: 'strong' }).closest('.tce-section') as HTMLElement;
        expect(within(group).getAllByText(/^(Drugi|Treći) korak$/).map(row => row.textContent))
            .toEqual(['Treći korak', 'Drugi korak']);
    });
});
