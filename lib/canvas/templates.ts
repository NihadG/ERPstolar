// ════════════════════════════════════════════════════════════════════
// PLATNO — ŠABLONI LANACA
//
// Ovdje se taloži znanje radionice: „nova kuhinja" je uvijek isti OBLIK
// (narudžba → proizvodnja → transport → montaža), samo se datumi i konkretan
// posao mijenjaju. Šablon čuva OBLIK (vrsta, redoslijed, tipična trajanja),
// NIKAD reference (projekt/proizvod/radnik/dobavljač) — one gube smisao
// izvan naloga iz kojeg su uhvaćene.
//
// Primjena kreira NOVE blokove (novi id-evi) — šablon se nikad ne dijeli s
// instancom na platnu.
// ════════════════════════════════════════════════════════════════════

import { v4 as uuidv4 } from 'uuid';
import type { PlanScenario, PlanBlock, PlanChainTemplate, PlanChainTemplateStep } from '../types';
import { addDays, diffDays, blockDurationDays, endFromWork, newBlock, newLink } from './model';
import { chainAncestors } from './schedule';

/**
 * Uhvati lanac oko `anchorId` (svi njegovi preci + on sam) kao šablon.
 * `null` kad anchor nema nijedan povezan blok — jedan blok nije lanac.
 */
export function captureChainTemplate(
    scenario: PlanScenario,
    anchorId: string,
    name: string
): PlanChainTemplate | null {
    const anchor = scenario.Blocks.find(b => b.id === anchorId);
    if (!anchor) return null;

    const ancestorIds = chainAncestors(scenario, anchorId);
    if (ancestorIds.size === 0) return null;

    const byId = new Map(scenario.Blocks.map(b => [b.id, b]));
    const captured = Array.from(ancestorIds).concat(anchorId)
        .map(id => byId.get(id))
        .filter((b): b is PlanBlock => !!b)
        .sort((a, b) => a.startISO.localeCompare(b.startISO) || a.endISO.localeCompare(b.endISO));

    const earliestISO = captured[0].startISO;
    const linkByPair = new Map(scenario.Links.map(l => [`${l.from}|${l.to}`, l]));

    const steps: PlanChainTemplateStep[] = captured.map((b, i) => {
        const next = captured[i + 1];
        const link = next ? linkByPair.get(`${b.id}|${next.id}`) : undefined;
        return {
            kind: b.kind,
            title: b.title,
            offsetDays: diffDays(earliestISO, b.startISO),
            durationDays: b.kind === 'milestone' ? undefined : blockDurationDays(b),
            workerDays: b.workerDays,
            crew: b.crew,
            leadDays: b.leadDays,
            linkKind: link?.kind,
            lagDays: link?.lagDays,
        };
    });

    return { id: uuidv4(), name: name.trim() || 'Bez naziva', steps, Created_Date: new Date().toISOString() };
}

/**
 * Primijeni šablon: `firstStepStartISO` je početak PRVOG (najranijeg) koraka —
 * ostali koraci se izvode iz njihovog `offsetDays`. Vraća NOVE blokove/veze,
 * ne dira scenarij (pozivalac ih ubacuje kroz ADD_BLOCK/ADD_LINK, isto kao
 * svaki drugi unos — jedan blok = jedan undo korak).
 */
export function applyChainTemplate(
    template: PlanChainTemplate,
    firstStepStartISO: string,
    opts?: { isSaturdayWorking?: (d: Date) => boolean }
): { blocks: PlanBlock[]; links: import('../types').PlanLink[] } {
    const blocks: PlanBlock[] = template.steps.map(step => {
        const start = addDays(firstStepStartISO, step.offsetDays);
        let end: string;

        if (step.kind === 'milestone') {
            end = start;
        } else if (step.kind === 'purchase') {
            const lead = Math.max(0, step.leadDays ?? Math.max(0, (step.durationDays ?? 1) - 1));
            end = addDays(start, lead);
        } else if ((step.kind === 'order' || step.kind === 'montaza') && (step.workerDays || 0) > 0) {
            end = endFromWork(start, step.workerDays!, step.crew || 1, opts?.isSaturdayWorking);
        } else {
            end = addDays(start, Math.max(1, step.durationDays ?? 1) - 1);
        }

        return newBlock(step.kind, start, end, {
            title: step.title,
            ...(step.workerDays ? { workerDays: step.workerDays } : {}),
            ...(step.crew ? { crew: step.crew } : {}),
            ...(step.leadDays !== undefined ? { leadDays: step.leadDays } : {}),
        });
    });

    const links = template.steps
        .map((step, i) => (step.linkKind ? newLink(blocks[i].id, blocks[i + 1].id, step.linkKind, step.lagDays) : null))
        .filter((l): l is NonNullable<typeof l> => !!l);

    return { blocks, links };
}
