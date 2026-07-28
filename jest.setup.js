// Jest setup file
import '@testing-library/jest-dom';

// Mock window.matchMedia
// Guard: testovi serverskih ruta rade pod `@jest-environment node`, gdje `window`
// ne postoji — bez ovoga cijeli setup pukne prije ijednog testa.
if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: jest.fn().mockImplementation(query => ({
            matches: false,
            media: query,
            onchange: null,
            addListener: jest.fn(), // deprecated
            removeListener: jest.fn(), // deprecated
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
            dispatchEvent: jest.fn(),
        })),
    });
}

// Mock IntersectionObserver
global.IntersectionObserver = class IntersectionObserver {
    constructor() { }
    observe() { return null; }
    disconnect() { return null; }
    unobserve() { return null; }
};

// Mock ResizeObserver
global.ResizeObserver = class ResizeObserver {
    constructor() { }
    observe() { return null; }
    disconnect() { return null; }
    unobserve() { return null; }
};

// Suppress console errors during tests (optional)
const originalError = console.error;
console.error = (...args) => {
    if (
        typeof args[0] === 'string' &&
        (args[0].includes('Warning: ReactDOM.render is no longer supported') ||
            args[0].includes('act(...)'))
    ) {
        return;
    }
    originalError.call(console, ...args);
};
