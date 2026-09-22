import {
    boardSplit, columnSizing, dropFocus, pinnedPanel, pushFocus, toggleCollapsed,
    type FocusEntry, type PanelId,
} from '../command/layout';
import { normalizeBoard, withCollapsedPanels } from '../command/board';

const none = new Set<PanelId>();
const auto = (panel: PanelId): FocusEntry => ({ panel, source: 'auto' });
const pin = (panel: PanelId): FocusEntry => ({ panel, source: 'pin' });

test('bez ičeg otvorenog tabla je u ravnoteži, lijevo šire', () => {
    expect(boardSplit(none, [])).toBe('balanced');
    const { mainGrow, railGrow } = columnSizing('balanced');
    expect(mainGrow).toBeGreaterThan(railGrow);
});

test('otvorena narudžba raširi desnu kolonu, a lijeva se suzi', () => {
    expect(boardSplit(none, [auto('purchases')])).toBe('rail-wide');
    const { mainGrow, railGrow } = columnSizing('rail-wide');
    expect(railGrow).toBeGreaterThan(mainGrow);
});

test('širina ide za onim što je ZADNJE otvoreno', () => {
    // Narudžba otvorena, pa proizvod — lijeva kolona dobija širinu nazad.
    const stack = pushFocus([auto('purchases')], auto('products'));
    expect(boardSplit(none, stack)).toBe('balanced');
    // Proizvod zatvoren — narudžba je opet na vrhu.
    expect(boardSplit(none, dropFocus(stack, 'products'))).toBe('rail-wide');
});

test('⤢ na lijevoj ploči je svjesna odluka i širi je dalje od ravnoteže', () => {
    expect(boardSplit(none, [pin('products')])).toBe('main-wide');
    // Automatski fokus lijevo samo vraća ravnotežu — bez skakanja na svaki klik.
    expect(boardSplit(none, [auto('workorders')])).toBe('balanced');
});

test('pin je samo jedan — novi skida stari', () => {
    const stack = pushFocus(pushFocus([], pin('tasks')), pin('products'));
    expect(stack.filter(f => f.source === 'pin')).toEqual([pin('products')]);
    expect(pinnedPanel(stack)).toBe('products');
});

test('sklopljena ploča ne može držati širinu', () => {
    expect(boardSplit(new Set<PanelId>(['purchases']), [auto('purchases')])).toBe('balanced');
});

test('sklopljena cijela kolona postaje uska traka, druga uzima sve', () => {
    expect(boardSplit(new Set<PanelId>(['purchases', 'tasks', 'notes']), [])).toBe('rail-slim');
    expect(boardSplit(new Set<PanelId>(['products', 'workorders']), [])).toBe('main-slim');
    // Obje kolone sklopljene — nema šta dijeliti.
    expect(boardSplit(new Set<PanelId>(['products', 'workorders', 'purchases', 'tasks', 'notes']), [])).toBe('balanced');
    expect(columnSizing('rail-slim').railGrow).toBe(0);
    expect(columnSizing('rail-slim').railBasis).toBeGreaterThan(0);
});

test('kalendar je iznad kolona i ne dira njihovu podjelu', () => {
    expect(boardSplit(none, [pin('calendar')])).toBe('balanced');
    expect(boardSplit(new Set<PanelId>(['calendar']), [])).toBe('balanced');
});

test('sklapanje se pamti s tablom, a prazna lista ne ostavlja ključ', () => {
    expect(toggleCollapsed(['notes'], 'tasks')).toEqual(['notes', 'tasks']);
    expect(toggleCollapsed(['notes', 'tasks'], 'notes')).toEqual(['tasks']);

    const board = { Project_IDs: ['a'], Show_Done: false };
    expect(withCollapsedPanels(board, ['notes'])).toEqual({ ...board, Collapsed_Panels: ['notes'] });
    expect(withCollapsedPanels({ ...board, Collapsed_Panels: ['notes'] }, [])).toEqual(board);
    expect('Collapsed_Panels' in withCollapsedPanels(board, [])).toBe(false);
});

test('nepoznate ploče iz starog dokumenta se tiho ispuštaju', () => {
    expect(normalizeBoard({ Project_IDs: ['a'], Collapsed_Panels: ['notes', 'nepostoji', 7, 'notes'] }))
        .toEqual({ Project_IDs: ['a'], Show_Done: false, Collapsed_Panels: ['notes'] });
    expect(normalizeBoard({ Project_IDs: ['a'] })).toEqual({ Project_IDs: ['a'], Show_Done: false });
});
