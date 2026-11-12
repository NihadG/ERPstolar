// ════════════════════════════════════════════════════════════════════
// STALNI SKUP ZA PONAVLJANJE — poruke koje su jednom pošle po zlu (čisto)
//
// Poruka iz revizije koja je otkrila grešku ulazi u stalni skup
// (.bot-review/stalni-skup/<grupa>/, gitignore — stvarne poruke) sa svojom
// provjerom: šta bot SAD mora uraditi (pozvati alat, ne upisivati, ne
// staviti radnika na krivi nalog…). Svaka buduća izmjena bota prolazi kroz
// skup (npm run bot:replay:skup); provjera koja padne obori test.
//
// Ovdje je samo logika: provjera jedne poruke, sječenje snimka firme na
// trenutak prije poruka i spajanje skupa. Pokretanje:
// lib/__tests__/assistantReplay.real.test.ts, lib/__tests__/botSkup.real.test.ts.
// ════════════════════════════════════════════════════════════════════

import type { AssistantOutcome } from '@/lib/types';
import type { ReplaySide } from './replayReport';

/**
 * Šta bot mora uraditi s porukom. Uzorci su regex bez dijakritike i bez
 * razlike malih i velikih slova („nocni ormari" pogađa „Noćni ormarići").
 */
export interface ReplayExpect {
    /** Zašto je poruka u skupu (P-NNN i princip) — bez stvarnih imena kad ide van .bot-review. */
    why: string;
    /** Alati koje mora bar pokušati pozvati. */
    calls?: string[];
    /** Nijedan upis nije prošao (pitanje, zalijepljen mail). */
    noWrites?: boolean;
    outcomeNot?: AssistantOutcome[];
    /** Odgovor ili dugmad moraju / ne smiju sadržati. */
    replyHas?: string[];
    replyNot?: string[];
    /** Greške alata ne smiju sadržati (npr. „Nepoznat alat"). */
    errorsNot?: string[];
    /** Knjiga rada poslije poruke: radnik (uzorak) na nalogu / ne na nalogu za dan. */
    logs?: { worker: string; date: string; order?: string; orderNot?: string }[];
    /** Najmanje toliko različitih radnika upisano za dan (npr. „ostali kao jučer"). */
    logsMin?: { date: string; workers: number };
}

export interface ReplayGroupExpect {
    /** Baza ide kroz razgovor (poruka vidi upise prethodne) — za razgovor od više poruka. */
    carry?: boolean;
    /** Po ID-u unosa; poruka bez provjere je samo kontekst razgovora. */
    checks: Record<string, ReplayExpect>;
}

/** Ono što provjera vidi iz baze poslije poruke. */
export interface ReplayDbView {
    logs: { worker: string; order: string; date: string }[];
}

export type ReplayNext = ReplaySide & { buttons?: string[] };

/** Bez dijakritike, ostalo isto (foldText bi pobrisao i znakove regexa). */
const plain = (s: string) => (s || '').replace(/đ/g, 'dj').replace(/Đ/g, 'Dj').normalize('NFD').replace(/[̀-ͯ]/g, '');
const has = (text: string, pattern: string) => new RegExp(plain(pattern), 'i').test(plain(text));

/** Prekršaji provjere; prazno = poruka prolazi. */
export function checkReplay(next: ReplayNext, exp: ReplayExpect, db: ReplayDbView, writeTools: Set<string>): string[] {
    const out: string[] = [];
    const log = next.toolLog || [];
    const said = [next.reply || '', ...(next.buttons || [])].join('\n');

    for (const t of exp.calls || []) {
        if (!log.some(c => c.name === t)) out.push(`nije pozvan ${t}`);
    }
    if (exp.noWrites) {
        const wrote = next.tools.filter(t => writeTools.has(t));
        if (wrote.length) out.push(`upisao, a nije smio: ${Array.from(new Set(wrote)).join(', ')}`);
    }
    if (exp.outcomeNot?.includes(next.outcome as AssistantOutcome)) out.push(`ishod ${next.outcome}`);
    for (const p of exp.replyHas || []) if (!has(said, p)) out.push(`odgovor nema „${p}"`);
    for (const p of exp.replyNot || []) if (has(said, p)) out.push(`odgovor sadrži „${p}"`);
    for (const p of exp.errorsNot || []) {
        const hit = log.find(c => c.error && has(c.error, p));
        if (hit) out.push(`${hit.name}: greška „${p}"`);
    }
    for (const l of exp.logs || []) {
        const mine = db.logs.filter(x => x.date.slice(0, 10) === l.date && has(x.worker, l.worker));
        if (l.order && !mine.some(x => has(x.order, l.order!))) out.push(`${l.worker} ${l.date} nije na „${l.order}"`);
        const wrong = l.orderNot ? mine.find(x => has(x.order, l.orderNot!)) : undefined;
        if (wrong) out.push(`${l.worker} ${l.date} upisan na „${wrong.order}"`);
    }
    if (exp.logsMin) {
        const n = new Set(db.logs.filter(x => x.date.slice(0, 10) === exp.logsMin!.date).map(x => x.worker)).size;
        if (n < exp.logsMin.workers) out.push(`upisano ${n} radnika za ${exp.logsMin.date}, treba bar ${exp.logsMin.workers}`);
    }
    return out;
}

// ─── Gradnja skupa ────────────────────────────────────────────────────

const CREATED = ['Created_At', 'Created_Date', 'createdAt', 'Created'];

/**
 * Snimak firme kakav je bio prije poruka: izbaci dokumente nastale u trenutku
 * `cut` ili poslije (upisi te iste poruke, termini, kasniji nalozi). Izmjene
 * postojećih dokumenata se ne vraćaju — snimak je približan, ne tačan.
 */
export function cutSnapshot(snapshot: Record<string, Record<string, unknown>>, cut: string): { snapshot: Record<string, Record<string, unknown>>; dropped: Record<string, number> } {
    const out: Record<string, Record<string, unknown>> = {};
    const dropped: Record<string, number> = {};
    for (const [key, doc] of Object.entries(snapshot)) {
        const made = CREATED.map(f => doc?.[f]).find(v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) as string | undefined;
        if (made && made >= cut) {
            const col = key.split('/')[0];
            dropped[col] = (dropped[col] || 0) + 1;
            continue;
        }
        out[key] = doc;
    }
    return { snapshot: out, dropped };
}

/** Unosi grupe: postojeći + novi po ID-u (ili početku ID-a), bez duplikata, redom vremena. */
export function mergeEntries<T extends { id: string; at: string }>(existing: T[], source: T[], ids: string[]): { entries: T[]; missing: string[] } {
    const picked = ids.map(id => ({ id, e: source.find(x => x.id === id || x.id.startsWith(id)) }));
    const byId = new Map(existing.map(e => [e.id, e]));
    picked.forEach(p => { if (p.e) byId.set(p.e.id, p.e); });
    return {
        entries: Array.from(byId.values()).sort((a, b) => a.at.localeCompare(b.at)),
        missing: picked.filter(p => !p.e).map(p => p.id),
    };
}

/** Provjere grupe: postojeće ostaju, nova poruka dobija prazan „why" da se popuni rukom. */
export function mergeExpect(existing: ReplayGroupExpect | null, ids: string[]): ReplayGroupExpect {
    const checks = { ...(existing?.checks || {}) };
    ids.forEach(id => { if (!checks[id]) checks[id] = { why: '' }; });
    return { ...(existing?.carry ? { carry: true } : {}), checks };
}

/** Kratak pregled skupa za izvještaj: koliko prolazi i šta je palo. */
export function skupReport(results: { group: string; id: string; text: string; why: string; failures: string[] }[]): string {
    const failed = results.filter(r => r.failures.length);
    const lines = [`# Stalni skup: ${results.length - failed.length} od ${results.length} prolazi`, ''];
    for (const r of failed) {
        lines.push(`- **${r.group} · ${r.id.slice(0, 8)}** (${r.why || 'bez opisa'}): „${r.text.replace(/\s+/g, ' ').slice(0, 80)}"`);
        r.failures.forEach(f => lines.push(`  - ${f}`));
    }
    return lines.join('\n');
}
