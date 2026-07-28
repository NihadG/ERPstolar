// ════════════════════════════════════════════════════════════════════
// AGREGACIJA RADA IZ WORK LOGOVA — čista, bez Firebasea
//
// Postoji zbog JEDNOG razloga: od uvođenja pogonskih uloga knjiženje dnevnica
// ima DVA puta — klijentski (lib/attendance.ts, vlasnik na desktopu) i
// serverski (lib/server/fieldAttendance.ts, kontrolor s telefona). Da svaki
// nosi vlastitu aritmetiku, tiho bi odlutali jedan od drugog i isti dan bi se
// obračunao različito ovisno o tome KO ga je unio.
//
// Zato ovdje živi jedina definicija, a oba puta je zovu.
//
// INVARIJANTA (vidi lib/laborSplit.ts): trošak rada proizvoda = Σ Daily_Rate
// iz njegovih work logova. Nema izuzetaka ni „ručnog override-a" — svaka
// izmjena (šihtarica, knjiga rada, timeline) ide kroz work logove.
// ════════════════════════════════════════════════════════════════════

/** Minimum koji agregacija treba od work loga. */
export interface LaborLogLike {
    Work_Order_Item_ID?: string;
    Daily_Rate?: number;
    /** Težina dana za taj proizvod. Stariji zapisi je nemaju → broje se kao pun dan. */
    Day_Fraction?: number;
}

export interface ItemLabor {
    /** Σ Daily_Rate, zaokruženo na 2 decimale. */
    cost: number;
    /** Σ Day_Fraction (radnik-dani), zaokruženo na 2 decimale. */
    days: number;
}

/** Zaokruživanje na 2 decimale — isto pravilo na oba puta knjiženja. */
export function round2(n: number): number {
    return Math.round(n * 100) / 100;
}

/**
 * Grupiši work logove po proizvodu (`Work_Order_Item_ID`).
 *
 * `Day_Fraction ?? 1` je namjerno: zapisi napravljeni prije uvođenja podjele
 * dnevnice nemaju to polje, a predstavljaju pun radni dan. Da se tretiraju kao
 * 0, stari nalozi bi prikazivali „0 od X dana" iako je rad proknjižen.
 *
 * Zaokružuje se OVDJE, po proizvodu — agregat naloga potom sabira već
 * zaokružene iznose. Taj redoslijed se ne smije mijenjati: sabiranje sirovih
 * pa zaokruživanje na kraju daje drugi rezultat za pare.
 */
export function aggregateLaborFromLogs(logs: LaborLogLike[]): Map<string, ItemLabor> {
    const cost = new Map<string, number>();
    const days = new Map<string, number>();

    for (const log of logs || []) {
        const itemId = log?.Work_Order_Item_ID;
        if (!itemId) continue;
        cost.set(itemId, (cost.get(itemId) || 0) + (log.Daily_Rate || 0));
        days.set(itemId, (days.get(itemId) || 0) + (log.Day_Fraction ?? 1));
    }

    const out = new Map<string, ItemLabor>();
    for (const itemId of Array.from(cost.keys())) {
        out.set(itemId, {
            cost: round2(cost.get(itemId) || 0),
            days: round2(days.get(itemId) || 0),
        });
    }
    return out;
}

/** Trošak rada jednog proizvoda; 0 kad nema knjiženog rada. */
export function laborCostOf(agg: Map<string, ItemLabor>, itemId: string): number {
    return agg.get(itemId)?.cost ?? 0;
}

/** Radnik-dani jednog proizvoda; 0 kad nema knjiženog rada. */
export function laborDaysOf(agg: Map<string, ItemLabor>, itemId: string): number {
    return agg.get(itemId)?.days ?? 0;
}
