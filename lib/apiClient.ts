'use client';

// ════════════════════════════════════════════════════════════════════
// POZIVI VLASTITIH API RUTA
//
// Svaka ruta pod /api/team, /api/field i /api/auth traži `Authorization:
// Bearer <idToken>`. Ovaj modul je jedino mjesto koje taj token kači — da se
// ne zaboravi negdje i da se greške svuda čitaju isto (server vraća
// { error: "poruka na bosanskom" }).
// ════════════════════════════════════════════════════════════════════

import { auth } from './firebase';

export class ApiError extends Error {
    constructor(public status: number, message: string) {
        super(message);
        this.name = 'ApiError';
    }
}

async function idToken(forceRefresh = false): Promise<string> {
    const user = auth?.currentUser;
    if (!user) throw new ApiError(401, 'Niste prijavljeni.');
    return user.getIdToken(forceRefresh);
}

export async function apiFetch<T = unknown>(
    path: string,
    init: RequestInit & { forceRefresh?: boolean } = {}
): Promise<T> {
    const { forceRefresh, ...rest } = init;
    const token = await idToken(forceRefresh);

    const res = await fetch(path, {
        ...rest,
        headers: {
            ...(rest.body ? { 'Content-Type': 'application/json' } : {}),
            ...(rest.headers || {}),
            Authorization: `Bearer ${token}`,
        },
    });

    if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new ApiError(res.status, body?.error || `Greška ${res.status}.`);
    }
    // 204 i prazna tijela
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
}

export const apiGet = <T>(path: string) => apiFetch<T>(path);

export const apiPost = <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

export const apiPatch = <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) });

export const apiDelete = <T>(path: string) => apiFetch<T>(path, { method: 'DELETE' });
