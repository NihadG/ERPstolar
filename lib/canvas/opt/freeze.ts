// ════════════════════════════════════════════════════════════════════
// PLATNO · PRERAČUN — ZAMRZNUT PERIOD I ZDRAVLJE PLANA
//
// Odluka vlasnika (21.11.2026): kod preračuna se prva 3 RADNA dana od danas ne
// diraju — ljudi su već raspoređeni, materijal spremljen. Zamrznut je svaki nalog
// koji je već raspoređen (ima radnike) i počinje najkasnije zadnjeg zamrznutog
// dana (uključujući one u toku i prošle). Novi, još neraspoređen nalog nije
// zamrznut ni kad mu je datum danas.
//
// Zdravlje plana: ocjena plana kakav je na platnu (isti kalendar i preostali rad
// kao prijedlog), da Platno odmah kaže kad izmjena napravi sudar ili kad se može
// završiti ranije — i ponudi „Preračunaj".
//
// jest: lib/__tests__/platnoPreracun.test.ts
// ════════════════════════════════════════════════════════════════════

import type { PlanScenario } from '../../types';
import { isoAt } from './instance';

export const FREEZE_WORK_DAYS = 3;

/** Radni dan radionice za zamrzavanje: pon–pet, bez praznika (subota je po smjenama, ne broji se). */
const isFreezeWorkDay = (iso: string, holidays: ReadonlySet<string>) => {
    const dow = new Date(`${iso}T12:00:00Z`).getUTCDay();
    return dow !== 0 && dow !== 6 && !holidays.has(iso);
};

/** Zadnji zamrznut dan: `days` radnih dana počev od danas (danas se broji ako je radni). */
export function freezeEndISO(todayISO: string, holidays: Iterable<string> = [], days = FREEZE_WORK_DAYS): string {
    const set = new Set(holidays);
    let count = 0, iso = todayISO;
    for (let i = 0; i < 60; i++) {
        iso = isoAt(todayISO, i);
        if (isFreezeWorkDay(iso, set) && ++count >= days) return iso;
    }
    return iso;
}

/** Nalozi koje preračun ne smije pomjeriti (raspoređeni, počinju do kraja zamrznutog perioda). */
export function frozenBlockIds(scenario: PlanScenario, freezeEnd: string): Set<string> {
    return new Set(scenario.Blocks
        .filter(b => (b.kind === 'order' || b.kind === 'montaza')
            && (b.workerRefs || []).some(r => r.id)
            && b.startISO <= freezeEnd)
        .map(b => b.id));
}
