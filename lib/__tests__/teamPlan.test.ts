// ════════════════════════════════════════════════════════════════════
// MJESTA, ULOGE I LOZINKE
//
// Limit mjesta je ono što se naplaćuje, pa mora biti tačan i na granici.
// Provjera lozinke je testirana jer je jedini branik oko lozinke koju
// vlasnik zada usmeno — Firebase sam traži samo 6 znakova.
// ════════════════════════════════════════════════════════════════════

import {
    ASSIGNABLE_ROLES, DEFAULT_SEAT_LIMITS, checkPassword, checkSeatAvailable,
    generatePassword, isAssignableRole, isValidEmail, normalizeEmail,
    planHasTeamModule, requiresWorkerLink, seatLimitFor,
} from '@/lib/team/plan';
import type { ModuleAccess } from '@/lib/types';

const NO_MODULES: ModuleAccess = {
    offers: false, orders: false, reports: false, api_access: false,
};

describe('seatLimitFor', () => {
    it('koristi limit paketa', () => {
        expect(seatLimitFor({ Subscription_Plan: 'enterprise' })).toBe(DEFAULT_SEAT_LIMITS.enterprise);
        expect(seatLimitFor({ Subscription_Plan: 'free' })).toBe(1);
    });

    it('eksplicitan Seat_Limit ima prednost (dogovoreno proširenje)', () => {
        expect(seatLimitFor({ Subscription_Plan: 'enterprise', Seat_Limit: 60 })).toBe(60);
    });

    it('besmislen Seat_Limit se ignoriše, ne ruši račun', () => {
        expect(seatLimitFor({ Subscription_Plan: 'professional', Seat_Limit: 0 })).toBe(DEFAULT_SEAT_LIMITS.professional);
        expect(seatLimitFor({ Subscription_Plan: 'professional', Seat_Limit: -5 })).toBe(DEFAULT_SEAT_LIMITS.professional);
    });

    it('bez organizacije pada na najstroži limit', () => {
        expect(seatLimitFor(null)).toBe(DEFAULT_SEAT_LIMITS.free);
    });
});

describe('checkSeatAvailable', () => {
    it('propušta dok ima mjesta', () => {
        expect(checkSeatAvailable(4, 25).ok).toBe(true);
    });

    it('odbija TAČNO na granici — 25/25 je puno, ne još jedno', () => {
        const check = checkSeatAvailable(25, 25);
        expect(check.ok).toBe(false);
        expect(check.reason).toContain('25');
    });

    it('odbija i kad je nekako prekoračeno (npr. nakon smanjenja paketa)', () => {
        expect(checkSeatAvailable(30, 25).ok).toBe(false);
    });
});

describe('planHasTeamModule', () => {
    it('enterprise ima modul i bez eksplicitne zastavice', () => {
        expect(planHasTeamModule('enterprise', NO_MODULES)).toBe(true);
    });

    it('niži paketi nemaju', () => {
        expect(planHasTeamModule('professional', NO_MODULES)).toBe(false);
        expect(planHasTeamModule('free', NO_MODULES)).toBe(false);
    });

    it('eksplicitna zastavica otključa i niži paket (ručno odobrenje)', () => {
        expect(planHasTeamModule('professional', { ...NO_MODULES, team: true })).toBe(true);
    });
});

describe('uloge', () => {
    it('vlasnik se ne može dodijeliti kroz UI', () => {
        expect(isAssignableRole('owner')).toBe(false);
        expect(ASSIGNABLE_ROLES).not.toContain('owner');
    });

    it('pogonske i staff uloge su dodjeljive', () => {
        for (const r of ['admin', 'manager', 'controller', 'worker']) {
            expect(isAssignableRole(r)).toBe(true);
        }
    });

    it('izmišljena uloga se odbija', () => {
        expect(isAssignableRole('superuser')).toBe(false);
        expect(isAssignableRole('')).toBe(false);
    });

    it('radnik i kontrolor moraju biti vezani za zapis radnika', () => {
        expect(requiresWorkerLink('worker')).toBe(true);
        expect(requiresWorkerLink('controller')).toBe(true);
        expect(requiresWorkerLink('manager')).toBe(false);
        expect(requiresWorkerLink('admin')).toBe(false);
    });
});

describe('checkPassword', () => {
    it('odbija kraće od 8 znakova (Firebase bi pustio 6)', () => {
        expect(checkPassword('abc1234').ok).toBe(false);
        expect(checkPassword('').ok).toBe(false);
    });

    it('traži i slovo i cifru', () => {
        expect(checkPassword('samoslova').ok).toBe(false);
        expect(checkPassword('12345678').ok).toBe(false);
    });

    it('prihvata ispravnu lozinku', () => {
        expect(checkPassword('mujo2026').ok).toBe(true);
    });

    it('odbija apsurdno dugu', () => {
        expect(checkPassword('a1'.repeat(100)).ok).toBe(false);
    });
});

describe('generatePassword', () => {
    it('generisana lozinka uvijek prolazi vlastitu provjeru', () => {
        for (let i = 0; i < 200; i++) {
            expect(checkPassword(generatePassword()).ok).toBe(true);
        }
    });

    it('ne sadrži znakove koji se miješaju pri diktiranju (0 O 1 l I)', () => {
        for (let i = 0; i < 200; i++) {
            expect(generatePassword()).not.toMatch(/[0O1lI]/);
        }
    });

    it('poštuje traženu dužinu', () => {
        expect(generatePassword(14)).toHaveLength(14);
    });
});

describe('email', () => {
    it('normalizuje na mala slova bez razmaka', () => {
        expect(normalizeEmail('  Mujo@Firma.BA ')).toBe('mujo@firma.ba');
    });

    it('prihvata uobičajene adrese', () => {
        expect(isValidEmail('mujo@firma.ba')).toBe(true);
        expect(isValidEmail('mujo.mujic+rad@sub.firma.com')).toBe(true);
    });

    it('odbija neispravne', () => {
        expect(isValidEmail('mujo')).toBe(false);
        expect(isValidEmail('mujo@firma')).toBe(false);
        expect(isValidEmail('mujo @firma.ba')).toBe(false);
        expect(isValidEmail('')).toBe(false);
    });
});
