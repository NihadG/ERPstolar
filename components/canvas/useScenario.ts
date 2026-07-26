'use client';

// ════════════════════════════════════════════════════════════════════
// useScenario — stanje platna: reducer + undo/redo + autosave.
//
// Autosave je debounce-an jer se pri povlačenju blok mijenja desetak puta u sekundi;
// upisivati svaki potez bi bilo i sporo i skupo.
//
// Verzija štiti od dva otvorena taba: ako je neko drugi snimio u međuvremenu,
// upis se ZAUSTAVLJA i korisnik bira — bolje pitati nego tiho izgubiti tuđi rad.
// ════════════════════════════════════════════════════════════════════

import { useReducer, useEffect, useRef, useCallback, useState } from 'react';
import {
    scenarioReducer, initialState, canUndo, canRedo,
    type ScenarioState, type ScenarioAction,
} from '@/lib/canvas/scenarioReducer';
import { saveScenario, getScenario } from '@/lib/services';
import type { PlanScenario } from '@/lib/types';

const AUTOSAVE_DELAY_MS = 800;

export type SaveState =
    | { kind: 'idle' }
    | { kind: 'saving' }
    | { kind: 'saved'; at: Date }
    | { kind: 'error'; message: string }
    | { kind: 'conflict' };

export interface UseScenarioResult {
    state: ScenarioState;
    dispatch: React.Dispatch<ScenarioAction>;
    saveState: SaveState;
    canUndo: boolean;
    canRedo: boolean;
    /** Snimi odmah (Ctrl+S ili prije zatvaranja). */
    saveNow: () => Promise<void>;
    /** Konflikt verzija: preuzmi tuđu verziju (gubi lokalne izmjene). */
    reloadRemote: () => Promise<void>;
    /** Konflikt verzija: svjesno prepiši tuđu verziju. */
    forceOverwrite: () => Promise<void>;
}

export function useScenario(
    organizationId: string,
    loaded: PlanScenario | null
): UseScenarioResult {
    const [state, dispatch] = useReducer(scenarioReducer, undefined, () =>
        initialState(loaded || undefined, organizationId)
    );
    const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' });

    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Ref na najsvježije stanje — debounce inače snimi zastarjeli scenarij.
    const latest = useRef(state);
    latest.current = state;
    const inFlight = useRef(false);

    useEffect(() => {
        if (loaded) dispatch({ type: 'LOAD', scenario: loaded });
    }, [loaded?.Scenario_ID]);   // eslint-disable-line react-hooks/exhaustive-deps

    const persist = useCallback(async (force = false) => {
        const cur = latest.current;
        if (!organizationId || !cur.scenario.Scenario_ID) return;
        if (!cur.dirty && !force) return;
        if (inFlight.current) return;   // ne preklapaj upise — zadnji debounce ionako slijedi

        inFlight.current = true;
        setSaveState({ kind: 'saving' });
        try {
            const res = await saveScenario(cur.scenario, organizationId, {
                expectedVersion: cur.scenario.Version,
                force,
            });
            if (res.success && res.data) {
                dispatch({ type: 'MARK_SAVED', version: res.data.Version });
                setSaveState({ kind: 'saved', at: new Date() });
            } else if (res.conflict) {
                setSaveState({ kind: 'conflict' });
            } else {
                setSaveState({ kind: 'error', message: res.message });
            }
        } catch {
            setSaveState({ kind: 'error', message: 'Greška pri spremanju' });
        } finally {
            inFlight.current = false;
        }
    }, [organizationId]);

    // Debounce: svaka izmjena resetuje odbrojavanje
    useEffect(() => {
        if (!state.dirty) return;
        if (saveState.kind === 'conflict') return;   // ne gazi dok korisnik ne odluči
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => { void persist(); }, AUTOSAVE_DELAY_MS);
        return () => { if (timer.current) clearTimeout(timer.current); };
    }, [state.scenario, state.dirty, saveState.kind, persist]);

    // Upozorenje pri zatvaranju s nespremljenim izmjenama
    useEffect(() => {
        const onBeforeUnload = (e: BeforeUnloadEvent) => {
            if (latest.current.dirty) { e.preventDefault(); e.returnValue = ''; }
        };
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }, []);

    const reloadRemote = useCallback(async () => {
        const id = latest.current.scenario.Scenario_ID;
        if (!id || !organizationId) return;
        const fresh = await getScenario(id, organizationId);
        if (fresh) {
            dispatch({ type: 'LOAD', scenario: fresh });
            setSaveState({ kind: 'idle' });
        }
    }, [organizationId]);

    const forceOverwrite = useCallback(async () => {
        // Uzmi tuđu verziju kao osnovu broja, pa svjesno prepiši sadržajem.
        const id = latest.current.scenario.Scenario_ID;
        const remote = id ? await getScenario(id, organizationId) : null;
        if (remote) dispatch({ type: 'MARK_SAVED', version: remote.Version });
        await persist(true);
    }, [organizationId, persist]);

    return {
        state,
        dispatch,
        saveState,
        canUndo: canUndo(state),
        canRedo: canRedo(state),
        saveNow: () => persist(true),
        reloadRemote,
        forceOverwrite,
    };
}
