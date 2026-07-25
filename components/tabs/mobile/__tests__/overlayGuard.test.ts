// Ovo je jedini dio gest-sistema koji je čista logika (bez touch simulacije):
// brojač koji sprječava globalni tab-swipe da otme dodir namijenjen otvorenom
// full-screen ekranu. Regresija ovdje = vraća se bug „svajp na nalogu mijenja
// tab ispod njega".

import { pushOverlay, popOverlay, isOverlayOpen } from '../overlayGuard';

describe('overlayGuard', () => {
    // Brojač je modul-level (dijeli se između svih poziva) — vrati na 0 poslije svakog testa.
    afterEach(() => {
        while (isOverlayOpen()) popOverlay();
    });

    it('počinje zatvoren', () => {
        expect(isOverlayOpen()).toBe(false);
    });

    it('push otvara, pop zatvara', () => {
        pushOverlay();
        expect(isOverlayOpen()).toBe(true);
        popOverlay();
        expect(isOverlayOpen()).toBe(false);
    });

    it('ugniježđeni overlay (sheet iznad detalja): zatvara se tek kad se ZADNJI pop desi', () => {
        pushOverlay(); // detalj naloga
        pushOverlay(); // sheet „Završi nalog" iznad njega
        expect(isOverlayOpen()).toBe(true);
        popOverlay(); // sheet se zatvara
        expect(isOverlayOpen()).toBe(true); // detalj je i dalje otvoren
        popOverlay(); // detalj se zatvara
        expect(isOverlayOpen()).toBe(false);
    });

    it('pop bez para (npr. dupli unmount) ne ide u minus', () => {
        popOverlay();
        popOverlay();
        expect(isOverlayOpen()).toBe(false);
        pushOverlay();
        expect(isOverlayOpen()).toBe(true);
    });
});
