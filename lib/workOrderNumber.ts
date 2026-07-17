// ════════════════════════════════════════════════════════════════════
// BROJ NALOGA — format: GODINA-MJESEC/SLOVO+BROJ   (npr. 2026-07/R1)
//
//   2026-07 / R 1
//   ▲         ▲ ▲
//   │         │ └─ redni broj UNUTAR tog mjeseca i tog slova (1-999)
//   │         └─── slovo tipa: R = proizvodnja, M = montaža, Z = zadaci
//   └───────────── mjesec kojem nalog PRIPADA (vidi effectiveOrderDate)
//
// Broj se dodjeljuje JEDNOM (pri kreiranju) i poslije se NE mijenja —
// to je identifikator koji ide na print i u dopise. Jedini izuzetak je
// jednokratna migracija starih brojeva (planWorkOrderRenumber).
//
// LEGACY: stari format (RN-20260713-075307-241) parse NE prepoznaje →
// vraća null, pa takvi brojevi ne učestvuju u traženju sljedećeg broja.
// ════════════════════════════════════════════════════════════════════

import type { WorkOrderType } from './types';

/** Slovo tipa naloga — dio broja (R1, M1, Z1). */
export type WorkOrderLetter = 'R' | 'M' | 'Z';

export interface ParsedWorkOrderNumber {
    year: number;
    month: number;      // 1-12
    letter: WorkOrderLetter;
    seq: number;        // 1-999 (dozvoljeno i preko — vidi nextWorkOrderNumber)
}

/** Tip naloga → slovo. Nepoznat/izostavljen tip = proizvodnja (R). */
export function workOrderTypeLetter(type?: WorkOrderType): WorkOrderLetter {
    if (type === 'Montaža') return 'M';
    if (type === 'Zadaci') return 'Z';
    return 'R';
}

/** Slovo → tip (obrnuto od workOrderTypeLetter; za prikaz/filtriranje). */
export function letterWorkOrderType(letter: WorkOrderLetter): WorkOrderType {
    if (letter === 'M') return 'Montaža';
    if (letter === 'Z') return 'Zadaci';
    return 'Proizvodnja';
}

export function formatWorkOrderNumber(parts: ParsedWorkOrderNumber): string {
    const mm = String(parts.month).padStart(2, '0');
    return `${parts.year}-${mm}/${parts.letter}${parts.seq}`;
}

/**
 * Parsira NOVI format. Stari (RN-/MN-/ZN- s vremenskom oznakom) → null.
 * Strogo namjerno: labav regex bi stari broj protumačio kao novi i
 * pokvario traženje sljedećeg rednog broja.
 */
export function parseWorkOrderNumber(value: string | undefined | null): ParsedWorkOrderNumber | null {
    if (!value) return null;
    const m = /^(\d{4})-(\d{2})\/([RMZ])(\d{1,4})$/.exec(value.trim());
    if (!m) return null;
    const year = Number(m[1]);
    const month = Number(m[2]);
    const seq = Number(m[4]);
    if (month < 1 || month > 12 || seq < 1) return null;
    return { year, month, letter: m[3] as WorkOrderLetter, seq };
}

/** Je li broj u novom formatu (već „uredan", ne treba mu migracija). */
export function isNewFormatWorkOrderNumber(value: string | undefined | null): boolean {
    return parseWorkOrderNumber(value) !== null;
}

function ymOf(dateISO: string): { year: number; month: number } {
    const d = new Date(dateISO);
    if (Number.isNaN(d.getTime())) {
        const now = new Date();
        return { year: now.getFullYear(), month: now.getMonth() + 1 };
    }
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

const bucketKey = (year: number, month: number, letter: WorkOrderLetter) => `${year}-${month}-${letter}`;

/**
 * Sljedeći slobodan broj za (mjesec, slovo). Gleda SAMO brojeve u novom
 * formatu iz iste kante; stari se ignorišu.
 *
 * Preko 999 namjerno NE puca i ne vraća se na 1 — radije 4-cifreni broj
 * nego duplikat identifikatora (999 naloga jednog tipa u mjesec dana je
 * ionako izvan realnog opsega).
 */
export function nextWorkOrderNumber(
    existingNumbers: (string | undefined | null)[],
    type?: WorkOrderType,
    dateISO?: string
): string {
    const { year, month } = ymOf(dateISO || new Date().toISOString());
    const letter = workOrderTypeLetter(type);
    let max = 0;
    for (const raw of existingNumbers) {
        const p = parseWorkOrderNumber(raw);
        if (!p) continue;
        if (p.year === year && p.month === month && p.letter === letter && p.seq > max) max = p.seq;
    }
    return formatWorkOrderNumber({ year, month, letter, seq: max + 1 });
}

// ════════════════════════════════════════════════════════════════════
// MIGRACIJA STARIH BROJEVA
// ════════════════════════════════════════════════════════════════════

export interface RenumberInput {
    Work_Order_ID: string;
    Work_Order_Number?: string;
    Work_Order_Type?: WorkOrderType;
    Created_Date?: string;
    Started_At?: string;
    /** Najraniji datum knjiženja rada (YYYY-MM-DD) — iz work logova. */
    First_Booking_Date?: string;
}

export interface RenumberAssignment {
    Work_Order_ID: string;
    from: string;
    to: string;
}

/**
 * Datum kojem nalog PRIPADA: kad se stvarno počelo raditi, a ne kad je
 * papir napravljen. Prvo knjiženje radnika je najtvrđi dokaz (neko je
 * bio na poslu), Started_At je namjera, Created_Date je zadnja linija.
 *
 * Prvo knjiženje ima prednost nad Started_At jer se Started_At zna
 * postaviti automatski (startup-sync) na datum kreiranja.
 */
export function effectiveOrderDate(wo: RenumberInput): string {
    return wo.First_Booking_Date || wo.Started_At || wo.Created_Date || new Date().toISOString();
}

/**
 * Plan prenumeracije: stari brojevi dobijaju nove, po redu STVARNOG
 * početka rada (effectiveOrderDate).
 *
 * IDEMPOTENTNO: nalozi koji već imaju ispravan novi broj se NE diraju —
 * njihov (mjesec, slovo, broj) se rezerviše, a stari nalozi popunjavaju
 * slobodne brojeve oko njih. Ponovno pokretanje zato ne pomjera ništa
 * što je već dodijeljeno (broj naloga je identifikator, ne redoslijed).
 */
export function planWorkOrderRenumber(orders: RenumberInput[]): RenumberAssignment[] {
    // 1) Rezerviši brojeve koji su već u novom formatu.
    const taken = new Map<string, Set<number>>();
    const reserve = (year: number, month: number, letter: WorkOrderLetter, seq: number) => {
        const key = bucketKey(year, month, letter);
        if (!taken.has(key)) taken.set(key, new Set());
        taken.get(key)!.add(seq);
    };
    const pending: RenumberInput[] = [];
    for (const wo of orders) {
        const parsed = parseWorkOrderNumber(wo.Work_Order_Number);
        if (parsed) reserve(parsed.year, parsed.month, parsed.letter, parsed.seq);
        else pending.push(wo);
    }

    // 2) Stari — po datumu stvarnog početka. Tie-break (isti dan) ide na
    //    Created_Date pa Work_Order_ID: bez toga bi dva naloga istog dana
    //    mogla zamijeniti brojeve između dva pokretanja.
    const sorted = [...pending].sort((a, b) => {
        const da = effectiveOrderDate(a);
        const db = effectiveOrderDate(b);
        if (da !== db) return da < db ? -1 : 1;
        const ca = a.Created_Date || '';
        const cb = b.Created_Date || '';
        if (ca !== cb) return ca < cb ? -1 : 1;
        return a.Work_Order_ID < b.Work_Order_ID ? -1 : a.Work_Order_ID > b.Work_Order_ID ? 1 : 0;
    });

    // 3) Dodijeli prvi slobodan broj u kanti.
    const cursor = new Map<string, number>();
    const out: RenumberAssignment[] = [];
    for (const wo of sorted) {
        const { year, month } = ymOf(effectiveOrderDate(wo));
        const letter = workOrderTypeLetter(wo.Work_Order_Type);
        const key = bucketKey(year, month, letter);
        const used = taken.get(key) || new Set<number>();
        let seq = cursor.get(key) || 1;
        while (used.has(seq)) seq++;
        used.add(seq);
        taken.set(key, used);
        cursor.set(key, seq + 1);

        const to = formatWorkOrderNumber({ year, month, letter, seq });
        out.push({ Work_Order_ID: wo.Work_Order_ID, from: wo.Work_Order_Number || '', to });
    }
    return out;
}
