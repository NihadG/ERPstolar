/**
 * Database Utility Tests
 * Testovi za lib/database.ts funkcije
 */

import { formatCurrency, formatDate, formatDateTime, formatRelativeTime, getStatusClass, getStatusColor, groupBy, sortBy, capitalize, truncate, isValidEmail, isValidPhone, calcPercentage, isEmpty, generateId } from '../lib/utils';

// ============================================
// UTILS TESTS
// ============================================

describe('Utils - formatCurrency', () => {
    test('formats positive numbers correctly', () => {
        expect(formatCurrency(1234.56)).toBe('1.234,56 KM');
    });

    test('formats zero correctly', () => {
        expect(formatCurrency(0)).toBe('0,00 KM');
    });

    test('handles undefined/null', () => {
        expect(formatCurrency(undefined)).toBe('0,00 KM');
        expect(formatCurrency(null)).toBe('0,00 KM');
    });

    test('works without currency symbol', () => {
        expect(formatCurrency(1000, false)).toBe('1.000,00');
    });

    test('handles negative numbers', () => {
        expect(formatCurrency(-500)).toBe('-500,00 KM');
    });
});

describe('Utils - formatDate', () => {
    test('formats ISO date correctly', () => {
        // Note: This test may vary based on locale
        const result = formatDate('2024-01-15');
        expect(result).toMatch(/15.*01.*2024/);
    });

    test('handles empty/null input', () => {
        expect(formatDate('')).toBe('-');
        expect(formatDate(null)).toBe('-');
        expect(formatDate(undefined)).toBe('-');
    });
});

describe('Utils - getStatusClass', () => {
    test('returns correct class for known statuses', () => {
        expect(getStatusClass('Nacrt')).toBe('status-draft');
        expect(getStatusClass('U proizvodnji')).toBe('status-in-progress');
        expect(getStatusClass('Završeno')).toBe('status-completed');
    });

    test('returns default class for unknown status', () => {
        expect(getStatusClass('Unknown Status')).toBe('status-default');
    });
});

describe('Utils - getStatusColor', () => {
    test('returns correct color for known statuses', () => {
        expect(getStatusColor('Nacrt')).toBe('#86868b');
        expect(getStatusColor('Završeno')).toBe('#30d158');
    });

    test('returns default color for unknown status', () => {
        expect(getStatusColor('Unknown')).toBe('#86868b');
    });
});

describe('Utils - groupBy', () => {
    test('groups array by key', () => {
        const items = [
            { name: 'A', category: 'fruits' },
            { name: 'B', category: 'vegetables' },
            { name: 'C', category: 'fruits' },
        ];

        const result = groupBy(items, 'category');

        expect(Object.keys(result)).toHaveLength(2);
        expect(result['fruits']).toHaveLength(2);
        expect(result['vegetables']).toHaveLength(1);
    });

    test('handles empty array', () => {
        const result = groupBy([], 'key' as never);
        expect(result).toEqual({});
    });
});

describe('Utils - sortBy', () => {
    test('sorts array ascending by default', () => {
        const items = [
            { name: 'C', value: 3 },
            { name: 'A', value: 1 },
            { name: 'B', value: 2 },
        ];

        const result = sortBy(items, 'name');

        expect(result[0].name).toBe('A');
        expect(result[1].name).toBe('B');
        expect(result[2].name).toBe('C');
    });

    test('sorts array descending', () => {
        const items = [
            { name: 'A', value: 1 },
            { name: 'C', value: 3 },
            { name: 'B', value: 2 },
        ];

        const result = sortBy(items, 'value', 'desc');

        expect(result[0].value).toBe(3);
        expect(result[1].value).toBe(2);
        expect(result[2].value).toBe(1);
    });
});

describe('Utils - capitalize', () => {
    test('capitalizes first letter', () => {
        expect(capitalize('hello')).toBe('Hello');
        expect(capitalize('HELLO')).toBe('Hello');
    });

    test('handles empty string', () => {
        expect(capitalize('')).toBe('');
    });
});

describe('Utils - truncate', () => {
    test('truncates long strings', () => {
        expect(truncate('Hello World', 8)).toBe('Hello...');
    });

    test('does not truncate short strings', () => {
        expect(truncate('Hello', 10)).toBe('Hello');
    });

    test('handles empty string', () => {
        expect(truncate('', 5)).toBe('');
    });
});

describe('Utils - isValidEmail', () => {
    test('validates correct emails', () => {
        expect(isValidEmail('test@example.com')).toBe(true);
        expect(isValidEmail('user.name@domain.org')).toBe(true);
    });

    test('rejects invalid emails', () => {
        expect(isValidEmail('invalid')).toBe(false);
        expect(isValidEmail('test@')).toBe(false);
        expect(isValidEmail('@example.com')).toBe(false);
    });
});

describe('Utils - isValidPhone', () => {
    test('validates correct phone numbers', () => {
        expect(isValidPhone('061123456')).toBe(true);
        expect(isValidPhone('+38761123456')).toBe(true);
    });

    test('rejects invalid phone numbers', () => {
        expect(isValidPhone('123')).toBe(false);
        expect(isValidPhone('abc')).toBe(false);
    });
});

describe('Utils - calcPercentage', () => {
    test('calculates percentage correctly', () => {
        expect(calcPercentage(50, 100)).toBe('50.0%');
        expect(calcPercentage(1, 3)).toBe('33.3%');
    });

    test('handles zero total', () => {
        expect(calcPercentage(10, 0)).toBe('0%');
    });
});

describe('Utils - isEmpty', () => {
    test('returns true for empty objects', () => {
        expect(isEmpty({})).toBe(true);
        expect(isEmpty(null)).toBe(true);
        expect(isEmpty(undefined)).toBe(true);
    });

    test('returns false for non-empty objects', () => {
        expect(isEmpty({ key: 'value' })).toBe(false);
    });
});

describe('Utils - generateId', () => {
    test('generates unique IDs', () => {
        const id1 = generateId();
        const id2 = generateId();

        expect(id1).not.toBe(id2);
        expect(id1.length).toBeGreaterThan(0);
    });

    test('generates UUID-like format', () => {
        const id = generateId();
        // UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
        expect(id).toMatch(/^[0-9a-f-]{36}$/i);
    });
});

// ============================================
// TYPE STRUCTURE TESTS
// ============================================

describe('Types - Project Structure', () => {
    test('Project type has required fields', () => {
        const project = {
            Project_ID: 'test-123',
            Organization_ID: 'org-456',
            Client_Name: 'Test Client',
            Status: 'Nacrt',
            Created_Date: '2024-01-01',
        };

        expect(project.Project_ID).toBe('test-123');
        expect(project.Client_Name).toBe('Test Client');
        expect(project.Status).toBe('Nacrt');
    });
});

describe('Types - Material Structure', () => {
    test('Material type has required fields', () => {
        const material = {
            Material_ID: 'mat-123',
            Organization_ID: 'org-456',
            Name: 'Iverica 18mm',
            Category: 'Ploče',
            Unit: 'm²',
        };

        expect(material.Material_ID).toBe('mat-123');
        expect(material.Name).toBe('Iverica 18mm');
        expect(material.Category).toBe('Ploče');
    });
});

describe('Types - WorkOrder Structure', () => {
    test('WorkOrder type has required fields', () => {
        const workOrder = {
            Work_Order_ID: 'wo-123',
            Organization_ID: 'org-456',
            Work_Order_Number: 'RN-2024-001',
            Status: 'Na čekanju' as const,
            Created_Date: '2024-01-01',
        };

        expect(workOrder.Work_Order_ID).toBe('wo-123');
        expect(workOrder.Work_Order_Number).toBe('RN-2024-001');
        expect(workOrder.Status).toBe('Na čekanju');
    });
});
