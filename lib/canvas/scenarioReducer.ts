// ════════════════════════════════════════════════════════════════════
// PLATNO — REDUCER S UNDO/REDO
//
// Prvi useReducer u ovom repou, i to namjerno: platno na kojem se slobodno
// eksperimentiše bez undo-a nije upotrebljivo. Korisnik mora moći povući desetak
// blokova, vidjeti da je gore, i vratiti se jednim potezom.
//
// ŠTA ULAZI U UNDO: samo izmjene SADRŽAJA (blokovi, veze, naziv).
// ŠTA NE ULAZI: zum, pomak prikaza, izbor blokova. To je stanje pogleda, ne rad —
// undo koji vraća zum umjesto brisanja je gori od nikakvog undo-a.
// ════════════════════════════════════════════════════════════════════

import type { PlanScenario, PlanBlock, PlanLink, PlanLinkKind, PlanZoom, PlanGroupBy, PlanLayout, PlanRef } from '../types';
import {
    MAX_BLOCKS_PER_SCENARIO, addDays, normalizeBlock, newBlock, newLink,
    wouldCreateCycle, emptyScenario,
} from './model';

/** Dubina istorije. 50 poteza pokriva svaku realnu sesiju, a ne troši memoriju. */
export const UNDO_LIMIT = 50;

export interface ScenarioState {
    scenario: PlanScenario;
    past: PlanScenario[];
    future: PlanScenario[];
    /** Ima nespremljenih izmjena → autosave ga hvata. */
    dirty: boolean;
    /** Izbor na platnu. UI stanje — ne ulazi u undo. */
    selectedIds: string[];
    /** Zadnja poruka za korisnika (npr. odbijena akcija). Čisti se sljedećom akcijom. */
    notice: string | null;
}

/** Jedna dodjela iz auto-rasporeda — spremna za APPLY_SCHEDULE. */
export interface ScheduleAssignment {
    blockId: string;
    startISO: string;
    endISO: string;
    crew: number;
    workerRefs: PlanRef[];
    assignedCrewId?: string;
}

export type ScenarioAction =
    | { type: 'LOAD'; scenario: PlanScenario }
    | { type: 'ADD_BLOCK'; block: PlanBlock }
    | { type: 'ADD_BLOCKS'; blocks: PlanBlock[] }
    | { type: 'APPLY_SCHEDULE'; assignments: ScheduleAssignment[] }
    | { type: 'UPDATE_BLOCK'; id: string; patch: Partial<PlanBlock> }
    | { type: 'MOVE_BLOCKS'; ids: string[]; days: number }
    | { type: 'SET_DATES'; id: string; startISO?: string; endISO?: string }
    | { type: 'DUPLICATE_BLOCKS'; ids: string[] }
    | { type: 'DELETE_BLOCKS'; ids: string[] }
    | { type: 'ADD_LINK'; from: string; to: string; kind: PlanLinkKind; lagDays?: number }
    | { type: 'DELETE_LINK'; id: string }
    | { type: 'APPLY_DATE_DIFF'; changes: { id: string; startISO: string; endISO: string }[] }
    | { type: 'RENAME'; name: string }
    | { type: 'SET_VIEW'; view: Partial<{ zoom: PlanZoom; anchorISO: string; groupBy: PlanGroupBy; layout: PlanLayout }> }
    | { type: 'SELECT'; ids: string[] }
    | { type: 'UNDO' }
    | { type: 'REDO' }
    | { type: 'MARK_SAVED'; version: number };

export function initialState(scenario?: PlanScenario, organizationId = ''): ScenarioState {
    return {
        scenario: scenario || emptyScenario(organizationId),
        past: [],
        future: [],
        dirty: false,
        selectedIds: [],
        notice: null,
    };
}

/** Zapiši novo stanje scenarija u istoriju (i poništi redo — grananje se ne čuva). */
function commit(state: ScenarioState, next: PlanScenario, notice: string | null = null): ScenarioState {
    return {
        ...state,
        scenario: next,
        past: [...state.past, state.scenario].slice(-UNDO_LIMIT),
        future: [],
        dirty: true,
        notice,
    };
}

/** Izmjena koja se NE pamti u istoriji (pogled, izbor, oznaka spremanja). */
function passive(state: ScenarioState, patch: Partial<ScenarioState>): ScenarioState {
    return { ...state, ...patch };
}

export function scenarioReducer(state: ScenarioState, action: ScenarioAction): ScenarioState {
    switch (action.type) {
        // ── Učitavanje ────────────────────────────────────────────
        case 'LOAD':
            // Novi dokument = nova istorija. Undo preko granice učitavanja bi vratio
            // blokove iz PRETHODNOG scenarija — tiho i pogrešno.
            return initialState(action.scenario);

        // ── Blokovi ───────────────────────────────────────────────
        case 'ADD_BLOCK': {
            if (state.scenario.Blocks.length >= MAX_BLOCKS_PER_SCENARIO) {
                return passive(state, {
                    notice: `Dosegnuta granica od ${MAX_BLOCKS_PER_SCENARIO} blokova — podijeli scenarij na dva.`,
                });
            }
            const block = normalizeBlock(action.block);
            return {
                ...commit(state, { ...state.scenario, Blocks: [...state.scenario.Blocks, block] }),
                selectedIds: [block.id],
            };
        }

        case 'ADD_BLOCKS': {
            if (!action.blocks.length) return state;
            const room = MAX_BLOCKS_PER_SCENARIO - state.scenario.Blocks.length;
            if (room <= 0) {
                return passive(state, {
                    notice: `Dosegnuta granica od ${MAX_BLOCKS_PER_SCENARIO} blokova — podijeli scenarij na dva.`,
                });
            }
            const toAdd = action.blocks.slice(0, room).map(normalizeBlock);
            const overflow = action.blocks.length - toAdd.length;
            return {
                ...commit(
                    state,
                    { ...state.scenario, Blocks: [...state.scenario.Blocks, ...toAdd] },
                    overflow > 0
                        ? `Dodano ${toAdd.length}; ${overflow} preko granice od ${MAX_BLOCKS_PER_SCENARIO} nije dodano.`
                        : null
                ),
                selectedIds: toAdd.map(b => b.id),
            };
        }

        case 'UPDATE_BLOCK': {
            const exists = state.scenario.Blocks.some(b => b.id === action.id);
            if (!exists) return state;
            return commit(state, {
                ...state.scenario,
                Blocks: state.scenario.Blocks.map(b =>
                    b.id === action.id ? normalizeBlock({ ...b, ...action.patch, id: b.id }) : b
                ),
            });
        }

        case 'MOVE_BLOCKS': {
            if (!action.ids.length || !action.days) return state;
            const ids = new Set(action.ids);
            return commit(state, {
                ...state.scenario,
                Blocks: state.scenario.Blocks.map(b => {
                    if (!ids.has(b.id)) return b;
                    return normalizeBlock({
                        ...b,
                        startISO: addDays(b.startISO, action.days),
                        endISO: addDays(b.endISO, action.days),
                        // Narudžba nosi i datum slanja — mora se pomjeriti zajedno,
                        // inače rok isporuke tiho promijeni značenje.
                        ...(b.orderByISO ? { orderByISO: addDays(b.orderByISO, action.days) } : {}),
                    });
                }),
            });
        }

        case 'SET_DATES': {
            const block = state.scenario.Blocks.find(b => b.id === action.id);
            if (!block) return state;
            return commit(state, {
                ...state.scenario,
                Blocks: state.scenario.Blocks.map(b =>
                    b.id === action.id
                        ? normalizeBlock({
                            ...b,
                            startISO: action.startISO ?? b.startISO,
                            endISO: action.endISO ?? b.endISO,
                        })
                        : b
                ),
            });
        }

        case 'DUPLICATE_BLOCKS': {
            const src = state.scenario.Blocks.filter(b => action.ids.includes(b.id));
            if (!src.length) return state;
            if (state.scenario.Blocks.length + src.length > MAX_BLOCKS_PER_SCENARIO) {
                return passive(state, { notice: `Granica od ${MAX_BLOCKS_PER_SCENARIO} blokova.` });
            }
            // Kopije se NE povezuju — veza kopije na original je gotovo uvijek pogrešna.
            // `id` se mora IZBACITI iz spreada, ne postaviti na undefined: newBlock
            // radi `{ id: uuid(), ...partial }`, pa bi `id: undefined` pregazilo novi id.
            const copies = src.map(b => {
                const { id: _drop, ...rest } = b;
                return newBlock(b.kind, b.startISO, b.endISO, { ...rest, title: `${b.title} (kopija)` });
            });
            return {
                ...commit(state, { ...state.scenario, Blocks: [...state.scenario.Blocks, ...copies] }),
                selectedIds: copies.map(c => c.id),
            };
        }

        case 'DELETE_BLOCKS': {
            const ids = new Set(action.ids);
            if (!ids.size) return state;
            const blocks = state.scenario.Blocks.filter(b => !ids.has(b.id));
            if (blocks.length === state.scenario.Blocks.length) return state;
            return {
                // Veze na obrisani blok se brišu s njim — inače ostane strelica u prazno.
                ...commit(state, {
                    ...state.scenario,
                    Blocks: blocks,
                    Links: state.scenario.Links.filter(l => !ids.has(l.from) && !ids.has(l.to)),
                }),
                selectedIds: [],
            };
        }

        // ── Veze ──────────────────────────────────────────────────
        case 'ADD_LINK': {
            const { from, to, kind, lagDays } = action;
            const hasBoth = state.scenario.Blocks.some(b => b.id === from)
                && state.scenario.Blocks.some(b => b.id === to);
            if (!hasBoth) return state;

            const duplicate = state.scenario.Links.some(l => l.from === from && l.to === to);
            if (duplicate) return state;

            // Bez ove provjere lančani preračun vrti u beskonačnost, a korisnik
            // vidi samo zamrznut ekran.
            if (wouldCreateCycle(state.scenario, from, to)) {
                return passive(state, { notice: 'Veza bi napravila krug — nije dodana.' });
            }

            return commit(state, {
                ...state.scenario,
                Links: [...state.scenario.Links, newLink(from, to, kind, lagDays)],
            });
        }

        case 'DELETE_LINK': {
            const links = state.scenario.Links.filter(l => l.id !== action.id);
            if (links.length === state.scenario.Links.length) return state;
            return commit(state, { ...state.scenario, Links: links });
        }

        // ── Lančani preračun ──────────────────────────────────────
        case 'APPLY_DATE_DIFF': {
            if (!action.changes.length) return state;
            const byId = new Map(action.changes.map(c => [c.id, c]));
            return commit(state, {
                ...state.scenario,
                Blocks: state.scenario.Blocks.map(b => {
                    const c = byId.get(b.id);
                    // Zaključan blok se NE pomjera ni kad ga preračun predloži.
                    if (!c || b.locked) return b;
                    return normalizeBlock({ ...b, startISO: c.startISO, endISO: c.endISO });
                }),
            }, `Primijenjeno ${action.changes.length} izmjena — Ctrl+Z vraća.`);
        }

        // ── Auto-raspored ─────────────────────────────────────────
        case 'APPLY_SCHEDULE': {
            if (!action.assignments.length) return state;
            const byId = new Map(action.assignments.map(a => [a.blockId, a]));
            return commit(state, {
                ...state.scenario,
                Blocks: state.scenario.Blocks.map(b => {
                    const a = byId.get(b.id);
                    // Zaključan blok se NE dira — ni datum ni ekipa (dogovoren termin).
                    if (!a || b.locked) return b;
                    return normalizeBlock({
                        ...b,
                        startISO: a.startISO,
                        endISO: a.endISO,
                        crew: a.crew,
                        workerRefs: a.workerRefs,
                        assignedCrewId: a.assignedCrewId,
                    });
                }),
            }, `Raspoređeno ${action.assignments.length} naloga — Ctrl+Z vraća.`);
        }

        case 'RENAME': {
            const name = action.name.trim() || 'Bez naziva';
            if (name === state.scenario.Name) return state;
            return commit(state, { ...state.scenario, Name: name });
        }

        // ── Pogled i izbor (BEZ istorije) ─────────────────────────
        case 'SET_VIEW':
            return passive(state, {
                scenario: {
                    ...state.scenario,
                    View: {
                        zoom: 'sedmica', anchorISO: '', groupBy: 'project', layout: 'unified-project',
                        ...state.scenario.View,
                        ...action.view,
                    },
                },
                // Pogled se sprema uz sadržaj, ali ne prlja dokument sam po sebi
                notice: null,
            });

        case 'SELECT':
            return passive(state, { selectedIds: action.ids, notice: null });

        // ── Istorija ──────────────────────────────────────────────
        // View živi unutar dokumenta (sprema se uz njega), ali NIJE rad. Kod undo/redo
        // se zato zadržava TRENUTNI pogled — inače bi vraćanje brisanja usput vratilo
        // i zum i pomak, pa bi korisniku ekran „odskočio" bez razloga.
        case 'UNDO': {
            if (!state.past.length) return state;
            const previous = state.past[state.past.length - 1];
            return {
                ...state,
                scenario: { ...previous, View: state.scenario.View },
                past: state.past.slice(0, -1),
                future: [state.scenario, ...state.future].slice(0, UNDO_LIMIT),
                dirty: true,
                selectedIds: [],
                notice: null,
            };
        }

        case 'REDO': {
            if (!state.future.length) return state;
            const next = state.future[0];
            return {
                ...state,
                scenario: { ...next, View: state.scenario.View },
                past: [...state.past, state.scenario].slice(-UNDO_LIMIT),
                future: state.future.slice(1),
                dirty: true,
                selectedIds: [],
                notice: null,
            };
        }

        case 'MARK_SAVED':
            return passive(state, {
                scenario: { ...state.scenario, Version: action.version },
                dirty: false,
            });

        default:
            return state;
    }
}

export const canUndo = (s: ScenarioState) => s.past.length > 0;
export const canRedo = (s: ScenarioState) => s.future.length > 0;
