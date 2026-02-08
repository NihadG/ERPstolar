/**
 * Unit tests for lib/utils.ts utility functions
 */

import {
    formatCurrency,
    formatDate,
    formatDateTime,
    formatRelativeTime,
    getStatusClass,
    getStatusColor,
    calcPercentage,
    capitalize,
    truncate,
    isEmpty,
    deepClone,
    isValidEmail,
    isValidPhone,
    groupBy,
    sortBy,
} from '../utils';

// ============================================
// formatCurrency Tests
// ============================================

describe('formatCurrency', () => {
    test('formats positive numbers correctly', () => {
        expect(formatCurrency(1234.56)).toBe('1.234,56 KM');
        expect(formatCurrency(1000)).toBe('1.000,00 KM');
        expect(formatCurrency(0.5)).toBe('0,50 KM');
    });

    test('formats zero correctly', () => {
        expect(formatCurrency(0)).toBe('0,00 KM');
    });

    test('handles null/undefined', () => {
        expect(formatCurrency(null)).toBe('0,00 KM');
        expect(formatCurrency(undefined)).toBe('0,00 KM');
    });

    test('handles NaN', () => {
        expect(formatCurrency(NaN)).toBe('0,00 KM');
    });

    test('respects showCurrency flag', () => {
        expect(formatCurrency(100, false)).toBe('100,00');
        expect(formatCurrency(1234.56, false)).toBe('1.234,56');
    });

    test('formats negative numbers', () => {
        expect(formatCurrency(-100)).toBe('-100,00 KM');
    });
});

// ============================================
// formatDate Tests
// ============================================

describe('formatDate', () => {
    test('formats ISO date string', () => {
        const result = formatDate('2024-03-15T10:30:00Z');
        // Result depends on locale, but should contain day, month, year
        expect(result).toMatch(/15/);
        expect(result).toMatch(/03/);
        expect(result).toMatch(/2024/);
    });

    test('returns dash for null/undefined', () => {
        expect(formatDate(null)).toBe('-');
        expect(formatDate(undefined)).toBe('-');
        expect(formatDate('')).toBe('-');
    });

    test('handles invalid date gracefully', () => {
        const result = formatDate('invalid-date');
        // Should return original string or handle gracefully
        expect(result).toBeTruthy();
    });
});

// ============================================
// calcPercentage Tests
// ============================================

describe('calcPercentage', () => {
    test('calculates percentage correctly', () => {
        expect(calcPercentage(50, 100)).toBe('50.0%');
        expect(calcPercentage(1, 3)).toBe('33.3%');
        expect(calcPercentage(100, 100)).toBe('100.0%');
    });

    test('handles zero total', () => {
        expect(calcPercentage(50, 0)).toBe('0%');
    });

    test('handles zero value', () => {
        expect(calcPercentage(0, 100)).toBe('0.0%');
    });
});

// ============================================
// capitalize Tests
// ============================================

describe('capitalize', () => {
    test('capitalizes first letter', () => {
        expect(capitalize('hello')).toBe('Hello');
        expect(capitalize('HELLO')).toBe('Hello');
        expect(capitalize('hELLO')).toBe('Hello');
    });

    test('handles empty string', () => {
        expect(capitalize('')).toBe('');
    });

    test('handles single character', () => {
        expect(capitalize('a')).toBe('A');
    });
});

// ============================================
// truncate Tests
// ============================================

describe('truncate', () => {
    test('truncates long strings', () => {
        expect(truncate('Hello World', 8)).toBe('Hello...');
        expect(truncate('This is a very long string', 10)).toBe('This is...');
    });

    test('does not truncate short strings', () => {
        expect(truncate('Hello', 10)).toBe('Hello');
        expect(truncate('Hi', 5)).toBe('Hi');
    });

    test('handles empty string', () => {
        expect(truncate('', 10)).toBe('');
    });

    test('handles null/undefined', () => {
        expect(truncate(null as any, 10)).toBe('');
        expect(truncate(undefined as any, 10)).toBe('');
    });
});

// ============================================
// isEmpty Tests
// ============================================

describe('isEmpty', () => {
    test('returns true for empty object', () => {
        expect(isEmpty({})).toBe(true);
    });

    test('returns false for non-empty object', () => {
        expect(isEmpty({ a: 1 })).toBe(false);
    });

    test('returns true for null/undefined', () => {
        expect(isEmpty(null)).toBe(true);
        expect(isEmpty(undefined)).toBe(true);
    });
});

// ============================================
// deepClone Tests
// ============================================

describe('deepClone', () => {
    test('creates independent copy', () => {
        const original = { a: 1, b: { c: 2 } };
        const cloned = deepClone(original);

        cloned.b.c = 99;
        expect(original.b.c).toBe(2);
    });

    test('handles arrays', () => {
        const original = [1, 2, { a: 3 }];
        const cloned = deepClone(original);

        (cloned[2] as any).a = 99;
        expect((original[2] as any).a).toBe(3);
    });
});

// ============================================
// isValidEmail Tests
// ============================================

describe('isValidEmail', () => {
    test('validates correct emails', () => {
        expect(isValidEmail('test@example.com')).toBe(true);
        expect(isValidEmail('user.name@domain.co')).toBe(true);
    });

    test('rejects invalid emails', () => {
        expect(isValidEmail('invalid')).toBe(false);
        expect(isValidEmail('no@domain')).toBe(false);
        expect(isValidEmail('@domain.com')).toBe(false);
        expect(isValidEmail('test@')).toBe(false);
    });
});

// ============================================
// isValidPhone Tests
// ============================================

describe('isValidPhone', () => {
    test('validates Bosnian phone formats', () => {
        expect(isValidPhone('061123456')).toBe(true);
        expect(isValidPhone('+38761123456')).toBe(true);
    });

    test('ignores spaces and dashes', () => {
        expect(isValidPhone('061 123 456')).toBe(true);
        expect(isValidPhone('061-123-456')).toBe(true);
    });
});

// ============================================
// groupBy Tests
// ============================================

describe('groupBy', () => {
    test('groups items by key', () => {
        const items = [
            { category: 'A', value: 1 },
            { category: 'B', value: 2 },
            { category: 'A', value: 3 },
        ];

        const result = groupBy(items, 'category');

        expect(result['A']).toHaveLength(2);
        expect(result['B']).toHaveLength(1);
    });

    test('handles missing keys', () => {
        const items = [
            { name: 'Test', value: 1 },
            { value: 2 } as any,
        ];

        const result = groupBy(items, 'name');
        expect(result['Test']).toHaveLength(1);
        expect(result['Unknown']).toHaveLength(1);
    });
});

// ============================================
// sortBy Tests
// ============================================

describe('sortBy', () => {
    test('sorts ascending', () => {
        const items = [{ val: 3 }, { val: 1 }, { val: 2 }];
        const result = sortBy(items, 'val', 'asc');

        expect(result[0].val).toBe(1);
        expect(result[2].val).toBe(3);
    });

    test('sorts descending', () => {
        const items = [{ val: 1 }, { val: 3 }, { val: 2 }];
        const result = sortBy(items, 'val', 'desc');

        expect(result[0].val).toBe(3);
        expect(result[2].val).toBe(1);
    });

    test('handles null values', () => {
        const items = [{ val: 2 }, { val: null }, { val: 1 }];
        const result = sortBy(items, 'val', 'asc');

        // null values should be at the end
        expect(result[2].val).toBeNull();
    });
});

// ============================================
// getStatusClass Tests
// ============================================

describe('getStatusClass', () => {
    test('returns correct class for known statuses', () => {
        expect(getStatusClass('Nacrt')).toBe('status-draft');
        expect(getStatusClass('Završeno')).toBe('status-completed');
        expect(getStatusClass('U proizvodnji')).toBe('status-in-progress');
    });

    test('returns default for unknown status', () => {
        expect(getStatusClass('UnknownStatus')).toBe('status-default');
    });
});

// ============================================
// getStatusColor Tests
// ============================================

describe('getStatusColor', () => {
    test('returns correct color for known statuses', () => {
        expect(getStatusColor('Završeno')).toBe('#30d158');
        expect(getStatusColor('Otkazano')).toBe('#ff3b30');
    });

    test('returns default color for unknown status', () => {
        expect(getStatusColor('Unknown')).toBe('#86868b');
    });
});
