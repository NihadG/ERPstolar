// ════════════════════════════════════════════════════════════════════
// MJESTA (SEATS) I DOZVOLJENE ULOGE — čista logika, bez Firebasea
//
// Živi odvojeno od ruta da bi se dala testirati i da bi UI mogao pokazati
// isti broj koji server provodi. UI smije samo PRIKAZATI limit; jedina
// provjera koja išta znači je ona na serveru (app/api/team/users).
// ════════════════════════════════════════════════════════════════════

import type { ModuleAccess, Organization, SubscriptionPlan, UserRole } from '@/lib/types';

/** Vlasnik se broji u mjesta — to je nalog kao i svaki drugi. */
export const DEFAULT_SEAT_LIMITS: Record<SubscriptionPlan, number> = {
    free: 1,
    basic: 1,
    professional: 3,
    enterprise: 25,
};

export function seatLimitFor(org: Pick<Organization, 'Subscription_Plan' | 'Seat_Limit'> | null | undefined): number {
    if (!org) return DEFAULT_SEAT_LIMITS.free;
    // Eksplicitan Seat_Limit (npr. dogovoreno proširenje) ima prednost nad planom.
    if (typeof org.Seat_Limit === 'number' && org.Seat_Limit > 0) return org.Seat_Limit;
    return DEFAULT_SEAT_LIMITS[org.Subscription_Plan] ?? DEFAULT_SEAT_LIMITS.free;
}

export interface SeatCheck {
    ok: boolean;
    used: number;
    limit: number;
    reason?: string;
}

/**
 * @param activeUserCount broj AKTIVNIH naloga (deaktivirani ne troše mjesto —
 *        inače bi firma s velikom fluktuacijom radnika ostala zaključana)
 */
export function checkSeatAvailable(activeUserCount: number, limit: number): SeatCheck {
    if (activeUserCount >= limit) {
        return {
            ok: false,
            used: activeUserCount,
            limit,
            reason: `Iskorišteno je svih ${limit} mjesta u paketu. Deaktivirajte nekog korisnika ili nadogradite paket.`,
        };
    }
    return { ok: true, used: activeUserCount, limit };
}

/** Modul „team" je taj koji uopšte otključava dodavanje radnika i kontrolora. */
export function planHasTeamModule(
    plan: SubscriptionPlan | undefined,
    modules: ModuleAccess | undefined
): boolean {
    if (plan === 'enterprise') return true;
    return modules?.team === true;
}

/** Uloge koje vlasnik/admin smije dodijeliti. `owner` se ne dodjeljuje kroz UI. */
export const ASSIGNABLE_ROLES: UserRole[] = ['admin', 'manager', 'controller', 'worker'];

export function isAssignableRole(role: string): role is UserRole {
    return (ASSIGNABLE_ROLES as string[]).includes(role);
}

/** Radnik i kontrolor MORAJU biti vezani za Worker — bez toga nemaju pogonski identitet. */
export function requiresWorkerLink(role: UserRole): boolean {
    return role === 'worker' || role === 'controller';
}

export interface PasswordCheck { ok: boolean; reason?: string }

/**
 * Firebase traži ≥6 znakova. Tražimo 8 jer lozinku ovdje zada VLASNIK i preda je
 * usmeno — kratka lozinka bi u tom lancu bila najslabija karika.
 */
export function checkPassword(password: string): PasswordCheck {
    if (!password || password.length < 8) return { ok: false, reason: 'Lozinka mora imati najmanje 8 znakova.' };
    if (password.length > 128) return { ok: false, reason: 'Lozinka je predugačka.' };
    if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
        return { ok: false, reason: 'Lozinka mora sadržavati bar jedno slovo i jednu cifru.' };
    }
    return { ok: true };
}

const PWD_ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Generator početne lozinke. Bez znakova koje se lako pomiješaju pri
 * prepisivanju s papira (0/O, 1/l/I) — ovu lozinku čovjek diktira drugom čovjeku.
 */
export function generatePassword(length = 10): string {
    const out: string[] = [];
    const cryptoObj = typeof globalThis !== 'undefined' ? (globalThis.crypto as Crypto | undefined) : undefined;
    if (cryptoObj?.getRandomValues) {
        const buf = new Uint32Array(length);
        cryptoObj.getRandomValues(buf);
        for (let i = 0; i < length; i++) out.push(PWD_ALPHABET[buf[i] % PWD_ALPHABET.length]);
    } else {
        for (let i = 0; i < length; i++) out.push(PWD_ALPHABET[Math.floor(Math.random() * PWD_ALPHABET.length)]);
    }
    // Garantuj bar jedno slovo i jednu cifru (checkPassword to traži).
    out[0] = 'abcdefghijkmnopqrstuvwxyz'[Math.floor(Math.random() * 25)];
    out[length - 1] = '23456789'[Math.floor(Math.random() * 8)];
    return out.join('');
}

export function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}
