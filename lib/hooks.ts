import { useState, useCallback, useMemo } from 'react';

// ============================================
// useGroupCollapse Hook
// Manages collapsed/expanded state for grouped lists
// ============================================

interface UseGroupCollapseReturn {
    collapsedGroups: Set<string>;
    toggleGroup: (groupKey: string) => void;
    isCollapsed: (groupKey: string) => boolean;
    collapseAll: () => void;
    expandAll: () => void;
    setCollapsedGroups: (groups: Set<string>) => void;
}

export function useGroupCollapse(initialCollapsed: string[] = []): UseGroupCollapseReturn {
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
        new Set(initialCollapsed)
    );

    const toggleGroup = useCallback((groupKey: string) => {
        setCollapsedGroups(prev => {
            const next = new Set(prev);
            if (next.has(groupKey)) {
                next.delete(groupKey);
            } else {
                next.add(groupKey);
            }
            return next;
        });
    }, []);

    const isCollapsed = useCallback((groupKey: string) => {
        return collapsedGroups.has(groupKey);
    }, [collapsedGroups]);

    const collapseAll = useCallback(() => {
        // This needs to be called with all group keys
        // Usually done in the component
    }, []);

    const expandAll = useCallback(() => {
        setCollapsedGroups(new Set());
    }, []);

    return {
        collapsedGroups,
        toggleGroup,
        isCollapsed,
        collapseAll,
        expandAll,
        setCollapsedGroups,
    };
}

// ============================================
// useSelection Hook
// Manages multi-select state for lists
// ============================================

interface UseSelectionReturn<T> {
    selected: Set<T>;
    toggle: (item: T) => void;
    select: (item: T) => void;
    deselect: (item: T) => void;
    selectAll: (items: T[]) => void;
    deselectAll: () => void;
    isSelected: (item: T) => boolean;
    selectedArray: T[];
    count: number;
}

export function useSelection<T = string>(): UseSelectionReturn<T> {
    const [selected, setSelected] = useState<Set<T>>(new Set());

    const toggle = useCallback((item: T) => {
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(item)) {
                next.delete(item);
            } else {
                next.add(item);
            }
            return next;
        });
    }, []);

    const select = useCallback((item: T) => {
        setSelected(prev => new Set(prev).add(item));
    }, []);

    const deselect = useCallback((item: T) => {
        setSelected(prev => {
            const next = new Set(prev);
            next.delete(item);
            return next;
        });
    }, []);

    const selectAll = useCallback((items: T[]) => {
        setSelected(new Set(items));
    }, []);

    const deselectAll = useCallback(() => {
        setSelected(new Set());
    }, []);

    const isSelected = useCallback((item: T) => {
        return selected.has(item);
    }, [selected]);

    const selectedArray = useMemo(() => Array.from(selected), [selected]);
    const count = selected.size;

    return {
        selected,
        toggle,
        select,
        deselect,
        selectAll,
        deselectAll,
        isSelected,
        selectedArray,
        count,
    };
}

// ============================================
// usePagination Hook
// Manages pagination state
// ============================================

interface UsePaginationProps {
    totalItems: number;
    itemsPerPage?: number;
    initialPage?: number;
}

interface UsePaginationReturn {
    currentPage: number;
    totalPages: number;
    itemsPerPage: number;
    startIndex: number;
    endIndex: number;
    goToPage: (page: number) => void;
    nextPage: () => void;
    prevPage: () => void;
    firstPage: () => void;
    lastPage: () => void;
    setItemsPerPage: (count: number) => void;
    pageItems: <T>(items: T[]) => T[];
}

export function usePagination({
    totalItems,
    itemsPerPage: initialItemsPerPage = 25,
    initialPage = 1,
}: UsePaginationProps): UsePaginationReturn {
    const [currentPage, setCurrentPage] = useState(initialPage);
    const [itemsPerPage, setItemsPerPageState] = useState(initialItemsPerPage);

    const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, totalItems);

    const goToPage = useCallback((page: number) => {
        const safePage = Math.max(1, Math.min(page, totalPages));
        setCurrentPage(safePage);
    }, [totalPages]);

    const nextPage = useCallback(() => {
        goToPage(currentPage + 1);
    }, [currentPage, goToPage]);

    const prevPage = useCallback(() => {
        goToPage(currentPage - 1);
    }, [currentPage, goToPage]);

    const firstPage = useCallback(() => {
        goToPage(1);
    }, [goToPage]);

    const lastPage = useCallback(() => {
        goToPage(totalPages);
    }, [goToPage, totalPages]);

    const setItemsPerPage = useCallback((count: number) => {
        setItemsPerPageState(count);
        setCurrentPage(1); // Reset to first page when changing items per page
    }, []);

    const pageItems = useCallback(<T,>(items: T[]): T[] => {
        return items.slice(startIndex, endIndex);
    }, [startIndex, endIndex]);

    return {
        currentPage,
        totalPages,
        itemsPerPage,
        startIndex,
        endIndex,
        goToPage,
        nextPage,
        prevPage,
        firstPage,
        lastPage,
        setItemsPerPage,
        pageItems,
    };
}

// ============================================
// useSearch Hook
// Manages search/filter state
// ============================================

interface UseSearchProps<T> {
    items: T[];
    searchFields: (keyof T)[];
    debounceMs?: number;
}

interface UseSearchReturn<T> {
    searchTerm: string;
    setSearchTerm: (term: string) => void;
    filteredItems: T[];
    clearSearch: () => void;
    hasSearch: boolean;
}

export function useSearch<T>({
    items,
    searchFields,
}: UseSearchProps<T>): UseSearchReturn<T> {
    const [searchTerm, setSearchTerm] = useState('');

    const filteredItems = useMemo(() => {
        if (!searchTerm.trim()) return items;

        const lowerSearch = searchTerm.toLowerCase();
        return items.filter(item => {
            return searchFields.some(field => {
                const value = item[field];
                if (typeof value === 'string') {
                    return value.toLowerCase().includes(lowerSearch);
                }
                if (typeof value === 'number') {
                    return value.toString().includes(lowerSearch);
                }
                return false;
            });
        });
    }, [items, searchTerm, searchFields]);

    const clearSearch = useCallback(() => {
        setSearchTerm('');
    }, []);

    return {
        searchTerm,
        setSearchTerm,
        filteredItems,
        clearSearch,
        hasSearch: searchTerm.trim().length > 0,
    };
}

// ============================================
// useModal Hook
// Manages modal state
// ============================================

interface UseModalReturn<T = unknown> {
    isOpen: boolean;
    data: T | null;
    open: (data?: T) => void;
    close: () => void;
    toggle: () => void;
}

export function useModal<T = unknown>(initialOpen = false): UseModalReturn<T> {
    const [isOpen, setIsOpen] = useState(initialOpen);
    const [data, setData] = useState<T | null>(null);

    const open = useCallback((modalData?: T) => {
        setData(modalData ?? null);
        setIsOpen(true);
    }, []);

    const close = useCallback(() => {
        setIsOpen(false);
        // Optional: delay clearing data for exit animations
        setTimeout(() => setData(null), 200);
    }, []);

    const toggle = useCallback(() => {
        setIsOpen(prev => !prev);
    }, []);

    return {
        isOpen,
        data,
        open,
        close,
        toggle,
    };
}

// ============================================
// useAsync Hook
// Manages async operation state
// ============================================

interface UseAsyncState<T> {
    loading: boolean;
    error: Error | null;
    data: T | null;
}

interface UseAsyncReturn<T> extends UseAsyncState<T> {
    execute: (...args: unknown[]) => Promise<T | undefined>;
    reset: () => void;
}

export function useAsync<T>(
    asyncFunction: (...args: unknown[]) => Promise<T>
): UseAsyncReturn<T> {
    const [state, setState] = useState<UseAsyncState<T>>({
        loading: false,
        error: null,
        data: null,
    });

    const execute = useCallback(async (...args: unknown[]) => {
        setState({ loading: true, error: null, data: null });
        try {
            const result = await asyncFunction(...args);
            setState({ loading: false, error: null, data: result });
            return result;
        } catch (error) {
            setState({ loading: false, error: error as Error, data: null });
            throw error;
        }
    }, [asyncFunction]);

    const reset = useCallback(() => {
        setState({ loading: false, error: null, data: null });
    }, []);

    return {
        ...state,
        execute,
        reset,
    };
}
