// Izbor radnika kucanjem — tok koji panel mora podržati bez dodirivanja miša:
// kucaj par slova → Enter čekira → polje se isprazni → kucaj sljedeće ime.

import { fireEvent, render, screen } from '@testing-library/react';
import WorkerPicker from '../WorkerPicker';
import type { Worker } from '@/lib/types';

const workers = [
    { Worker_ID: 'w1', Name: 'Nedim Bajraktarević', Role: 'Opći' },
    { Worker_ID: 'w2', Name: 'Nermin Alispahić', Role: 'Rezač' },
    { Worker_ID: 'w3', Name: 'Samir Kanjić', Role: 'Montaža' },
    { Worker_ID: 'w4', Name: 'Samir Plećan', Role: 'Opći' },
] as unknown as Worker[];

function setup(selected: string[] = []) {
    const onToggle = jest.fn();
    const onClose = jest.fn();
    const picked = new Set(selected);
    render(
        <WorkerPicker
            isOpen
            workers={workers}
            isSelected={id => picked.has(id)}
            onToggle={onToggle}
            onClose={onClose}
            title="Dodijeli radnike"
        />
    );
    return { onToggle, onClose, input: screen.getByPlaceholderText('Kucaj ime radnika…') };
}

const rowNames = () => screen.getAllByRole('button')
    .filter(b => b.className.includes('btt-pick-item'))
    .map(b => b.textContent?.trim());

test('bez upita se vide svi radnici', () => {
    setup();
    expect(rowNames()).toHaveLength(4);
});

test('kucanje sužava listu, bez obzira na dijakritiku', () => {
    const { input } = setup();
    fireEvent.change(input, { target: { value: 'kanjic' } });
    expect(rowNames()).toEqual(['Samir KanjićMontaža']);
});

test('Enter čekira jedini pogodak i isprazni polje za sljedeće ime', () => {
    const { onToggle, input } = setup();
    fireEvent.change(input, { target: { value: 'bajrak' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onToggle).toHaveBeenCalledWith('w1');
    expect((input as HTMLInputElement).value).toBe('');
    expect(rowNames()).toHaveLength(4);   // lista se vratila — odmah se kuca dalje
});

test('kad ima više pogodaka, Enter uzima označeni, a strelica ga pomjera', () => {
    const { onToggle, input } = setup();
    fireEvent.change(input, { target: { value: 'samir' } });
    expect(rowNames()).toHaveLength(2);

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onToggle).toHaveBeenCalledWith('w4');
});

test('Esc prvo čisti upit, pa tek prazan zatvara izbor', () => {
    const { onClose, input } = setup();
    fireEvent.change(input, { target: { value: 'samir' } });

    fireEvent.keyDown(input, { key: 'Escape' });
    expect((input as HTMLInputElement).value).toBe('');
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
});

test('promašaj kaže šta je traženo, umjesto prazne liste', () => {
    const { input } = setup();
    fireEvent.change(input, { target: { value: 'xyz' } });
    expect(rowNames()).toHaveLength(0);
    expect(screen.getByText(/Nema radnika za/)).toBeInTheDocument();
});

test('već dodijeljeni radnik se vidi kao čekiran', () => {
    setup(['w3']);
    const checked = screen.getAllByRole('button').filter(b => b.className.includes('btt-pick-item on'));
    expect(checked).toHaveLength(1);
    expect(checked[0].textContent).toContain('Samir Kanjić');
});
