// ════════════════════════════════════════════════════════════════════
// DNEVNIK POZIVA ALATA — šta je model stvarno poslao ERP-u i šta je ERP vratio
//
// Bez ovoga se ne vidi zašto je bot nešto pogrešno razumio (argumenti alata nisu
// nigdje ostajali). Skraćeno da dokument ostane mali. jest: assistantToolLog.test.ts
// ════════════════════════════════════════════════════════════════════

import type { ToolCallLog } from '@/lib/types';

const MAX_ARGS = 600;
const MAX_ERROR = 240;
const MAX_CALLS = 12;

/** Jedan poziv za dnevnik: ime, argumenti (skraćeni JSON), ishod i prva linija greške. */
export function toolCallLog(name: string, args: unknown, out: { ok?: boolean; error?: unknown }): ToolCallLog {
    let json = '';
    try { json = JSON.stringify(args ?? {}); } catch { json = String(args); }
    const error = out.ok === false ? String(out.error || 'nije uspjelo').split('\n')[0].slice(0, MAX_ERROR) : undefined;
    return {
        name,
        args: json.length > MAX_ARGS ? `${json.slice(0, MAX_ARGS)}…` : json,
        ok: out.ok !== false,
        ...(error ? { error } : {}),
    };
}

export function capToolCalls(calls: ToolCallLog[] | undefined): ToolCallLog[] {
    return (calls || []).slice(0, MAX_CALLS);
}
