/**
 * Custom Hooks Tests
 */

import { renderHook, act } from '@testing-library/react';
import {
    useGroupCollapse,
    useSelection,
    usePagination,
    useSearch,
    useModal,
} from '../lib/hooks';

// ============================================
// useGroupCollapse Tests
// ============================================

describe('useGroupCollapse', () => {
    test('initializes with empty collapsed groups', () => {
        const { result } = renderHook(() => useGroupCollapse());

        expect(result.current.collapsedGroups.size).toBe(0);
        expect(result.current.isCollapsed('test')).toBe(false);
    });

    test('initializes with provided collapsed groups', () => {
        const { result } = renderHook(() => useGroupCollapse(['group1', 'group2']));

        expect(result.current.isCollapsed('group1')).toBe(true);
        expect(result.current.isCollapsed('group2')).toBe(true);
        expect(result.current.isCollapsed('group3')).toBe(false);
    });

    test('toggles group collapse state', () => {
        const { result } = renderHook(() => useGroupCollapse());

        act(() => {
            result.current.toggleGroup('test');
        });

        expect(result.current.isCollapsed('test')).toBe(true);

        act(() => {
            result.current.toggleGroup('test');
        });

        expect(result.current.isCollapsed('test')).toBe(false);
    });

    test('expands all groups', () => {
        const { result } = renderHook(() => useGroupCollapse(['a', 'b', 'c']));

        expect(result.current.collapsedGroups.size).toBe(3);

        act(() => {
            result.current.expandAll();
        });

        expect(result.current.collapsedGroups.size).toBe(0);
    });
});

// ============================================
// useSelection Tests
// ============================================

describe('useSelection', () => {
    test('initializes with empty selection', () => {
        const { result } = renderHook(() => useSelection<string>());

        expect(result.current.count).toBe(0);
        expect(result.current.selectedArray).toEqual([]);
    });

    test('toggles item selection', () => {
        const { result } = renderHook(() => useSelection<string>());

        act(() => {
            result.current.toggle('item1');
        });

        expect(result.current.isSelected('item1')).toBe(true);
        expect(result.current.count).toBe(1);

        act(() => {
            result.current.toggle('item1');
        });

        expect(result.current.isSelected('item1')).toBe(false);
        expect(result.current.count).toBe(0);
    });

    test('selects and deselects items', () => {
        const { result } = renderHook(() => useSelection<string>());

        act(() => {
            result.current.select('a');
            result.current.select('b');
        });

        expect(result.current.count).toBe(2);

        act(() => {
            result.current.deselect('a');
        });

        expect(result.current.count).toBe(1);
        expect(result.current.isSelected('b')).toBe(true);
    });

    test('selects all items', () => {
        const { result } = renderHook(() => useSelection<string>());

        act(() => {
            result.current.selectAll(['x', 'y', 'z']);
        });

        expect(result.current.count).toBe(3);
        expect(result.current.selectedArray).toEqual(expect.arrayContaining(['x', 'y', 'z']));
    });

    test('deselects all items', () => {
        const { result } = renderHook(() => useSelection<string>());

        act(() => {
            result.current.selectAll(['x', 'y', 'z']);
        });

        act(() => {
            result.current.deselectAll();
        });

        expect(result.current.count).toBe(0);
    });
});

// ============================================
// usePagination Tests
// ============================================

describe('usePagination', () => {
    test('initializes with correct values', () => {
        const { result } = renderHook(() => usePagination({
            totalItems: 100,
            itemsPerPage: 10,
        }));

        expect(result.current.currentPage).toBe(1);
        expect(result.current.totalPages).toBe(10);
        expect(result.current.startIndex).toBe(0);
        expect(result.current.endIndex).toBe(10);
    });

    test('navigates to next and previous pages', () => {
        const { result } = renderHook(() => usePagination({
            totalItems: 100,
            itemsPerPage: 10,
        }));

        act(() => {
            result.current.nextPage();
        });

        expect(result.current.currentPage).toBe(2);

        act(() => {
            result.current.prevPage();
        });

        expect(result.current.currentPage).toBe(1);
    });

    test('goes to specific page', () => {
        const { result } = renderHook(() => usePagination({
            totalItems: 100,
            itemsPerPage: 10,
        }));

        act(() => {
            result.current.goToPage(5);
        });

        expect(result.current.currentPage).toBe(5);
        expect(result.current.startIndex).toBe(40);
        expect(result.current.endIndex).toBe(50);
    });

    test('clamps page within valid range', () => {
        const { result } = renderHook(() => usePagination({
            totalItems: 50,
            itemsPerPage: 10,
        }));

        act(() => {
            result.current.goToPage(100);
        });

        expect(result.current.currentPage).toBe(5);

        act(() => {
            result.current.goToPage(-5);
        });

        expect(result.current.currentPage).toBe(1);
    });

    test('pages items correctly', () => {
        const { result } = renderHook(() => usePagination({
            totalItems: 5,
            itemsPerPage: 2,
        }));

        const items = ['a', 'b', 'c', 'd', 'e'];

        expect(result.current.pageItems(items)).toEqual(['a', 'b']);

        act(() => {
            result.current.goToPage(2);
        });

        expect(result.current.pageItems(items)).toEqual(['c', 'd']);
    });
});

// ============================================
// useSearch Tests
// ============================================

describe('useSearch', () => {
    const testItems = [
        { id: 1, name: 'Apple', category: 'Fruit' },
        { id: 2, name: 'Banana', category: 'Fruit' },
        { id: 3, name: 'Carrot', category: 'Vegetable' },
    ];

    test('returns all items when search is empty', () => {
        const { result } = renderHook(() => useSearch({
            items: testItems,
            searchFields: ['name'],
        }));

        expect(result.current.filteredItems).toHaveLength(3);
        expect(result.current.hasSearch).toBe(false);
    });

    test('filters items by search term', () => {
        const { result } = renderHook(() => useSearch({
            items: testItems,
            searchFields: ['name'],
        }));

        act(() => {
            result.current.setSearchTerm('app');
        });

        expect(result.current.filteredItems).toHaveLength(1);
        expect(result.current.filteredItems[0].name).toBe('Apple');
        expect(result.current.hasSearch).toBe(true);
    });

    test('searches multiple fields', () => {
        const { result } = renderHook(() => useSearch({
            items: testItems,
            searchFields: ['name', 'category'],
        }));

        act(() => {
            result.current.setSearchTerm('fruit');
        });

        expect(result.current.filteredItems).toHaveLength(2);
    });

    test('clears search', () => {
        const { result } = renderHook(() => useSearch({
            items: testItems,
            searchFields: ['name'],
        }));

        act(() => {
            result.current.setSearchTerm('apple');
        });

        expect(result.current.filteredItems).toHaveLength(1);

        act(() => {
            result.current.clearSearch();
        });

        expect(result.current.filteredItems).toHaveLength(3);
    });
});

// ============================================
// useModal Tests
// ============================================

describe('useModal', () => {
    test('initializes as closed', () => {
        const { result } = renderHook(() => useModal());

        expect(result.current.isOpen).toBe(false);
        expect(result.current.data).toBe(null);
    });

    test('opens modal', () => {
        const { result } = renderHook(() => useModal<{ id: number }>());

        act(() => {
            result.current.open({ id: 123 });
        });

        expect(result.current.isOpen).toBe(true);
        expect(result.current.data).toEqual({ id: 123 });
    });

    test('closes modal', () => {
        const { result } = renderHook(() => useModal());

        act(() => {
            result.current.open();
        });

        expect(result.current.isOpen).toBe(true);

        act(() => {
            result.current.close();
        });

        expect(result.current.isOpen).toBe(false);
    });

    test('toggles modal', () => {
        const { result } = renderHook(() => useModal());

        act(() => {
            result.current.toggle();
        });

        expect(result.current.isOpen).toBe(true);

        act(() => {
            result.current.toggle();
        });

        expect(result.current.isOpen).toBe(false);
    });
});
