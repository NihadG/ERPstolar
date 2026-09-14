'use client';

// ════════════════════════════════════════════════════════════════════
// LIČNA TABLA — učitavanje i odgođeni upis
//
// Tabla se mijenja klikom (dodaj/ukloni čip, prekidač „Završeno"), pa se
// ne piše na svaku promjenu nego se upisi sažmu. Stanje na ekranu je
// UVIJEK lokalno i trenutno; baza ga samo sustiže.
//
// Ako upis padne (najčešće: firestore.rules nisu deployane), ekran i dalje
// radi do kraja sesije, ali korisnik dobije jasnu poruku — tiho gubljenje
// table bi bilo gore od greške.
// ════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react';
import { EMPTY_BOARD, type CommandBoardState, type UserBoardsDoc } from '@/lib/command/board';
import { getUserBoard, saveUserBoard } from '@/lib/services/board/boardService';

const SAVE_DELAY = 500;

export function useCommandBoard(
    userId: string | null | undefined,
    organizationId: string | null | undefined,
    enabled: boolean,
    onError?: (message: string) => void,
) {
    const [board, setBoard] = useState<CommandBoardState>(EMPTY_BOARD);
    const [loading, setLoading] = useState(false);
    const docRef = useRef<UserBoardsDoc | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const loadedFor = useRef<string>('');

    const key = userId && organizationId ? `${userId}:${organizationId}` : '';

    useEffect(() => {
        if (!enabled || !key || loadedFor.current === key) return;
        let alive = true;
        setLoading(true);
        getUserBoard(userId!, organizationId!)
            .then(result => {
                if (!alive) return;
                docRef.current = result.doc;
                setBoard(result.board);
                loadedFor.current = key;
            })
            .catch(() => { if (alive) onError?.('Tabla se nije učitala — provjeri Firestore pravila.'); })
            .finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, key]);

    const update = useCallback((next: CommandBoardState) => {
        setBoard(next);
        if (!userId || !organizationId) return;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
            saveUserBoard(userId, organizationId, next, docRef.current)
                .then(doc => { docRef.current = doc; })
                .catch(() => onError?.('Tabla nije snimljena — provjeri Firestore pravila.'));
        }, SAVE_DELAY);
    }, [userId, organizationId, onError]);

    useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

    return { board, setBoard: update, loading };
}
