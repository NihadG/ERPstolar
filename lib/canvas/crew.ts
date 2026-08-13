// ════════════════════════════════════════════════════════════════════
// PLATNO — EKIPA (kandidat za auto-raspored)
//
// Sitna fabrika izdvojena iz nekadašnjeg batchDraft-a: CrewPicker je jedini
// preostali korisnik. Ekipa = glavni radnik (+ opcioni pomoćnik).
// ════════════════════════════════════════════════════════════════════

import { v4 as uuidv4 } from 'uuid';
import type { PlanCrew, PlanRef } from '../types';

export function newCrew(lead: PlanRef, helper?: PlanRef): PlanCrew {
    return { id: uuidv4(), lead, ...(helper ? { helper } : {}) };
}
