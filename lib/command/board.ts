// ════════════════════════════════════════════════════════════════════
// KOMANDNI CENTAR — PRIVATNA TABLA PROJEKATA
//
// Tabla je LIČNA: svaki korisnik sam bira koje projekte prati. Zato ne
// stoji na projektu (to bi bilo zajedničko), nego u jednom dokumentu po
// korisniku — `user_boards/{uid}` — a unutar njega je mapirana po
// organizaciji, jer isti nalog kroz vrijeme može biti u više firmi.
//
// Ovdje su SAMO čiste funkcije (bez baze), da se redoslijed, dedupliciranje
// i odbacivanje obrisanih projekata mogu testirati bez Firestorea.
// ════════════════════════════════════════════════════════════════════

import type { Project } from '../types';
import { isPanelId, type PanelId } from './layout';

export interface CommandBoardState {
    /** Redoslijed je značajan — to je redoslijed grupa u svim kontejnerima. */
    Project_IDs: string[];
    /** Prikaži i završeno (nalozi, primljeni materijali, riješene napomene). */
    Show_Done: boolean;
    /**
     * Ploče koje je korisnik sklopio. Pamti se s tablom, jer je to odluka o
     * tome šta ga zanima (npr. „napomene ne pratim"), a ne trenutni klik.
     * Izostavlja se kad je prazno — Firestore ne prima `undefined`.
     */
    Collapsed_Panels?: PanelId[];
}

export interface UserBoardsDoc {
    User_ID: string;
    Updated_At: string;
    /** Organization_ID → tabla. */
    Boards: Record<string, CommandBoardState>;
}

export const EMPTY_BOARD: CommandBoardState = { Project_IDs: [], Show_Done: false };

/**
 * Odbrambeno čitanje: dokument je pisao raniji build, korisnik s drugog
 * uređaja ili niko (prvo otvaranje). Sve što nije prepoznato → prazna tabla.
 */
export function normalizeBoard(raw: unknown): CommandBoardState {
    if (!raw || typeof raw !== 'object') return EMPTY_BOARD;
    const value = raw as Partial<CommandBoardState>;
    const ids = Array.isArray(value.Project_IDs)
        ? value.Project_IDs.filter((id): id is string => typeof id === 'string' && id.length > 0)
        : [];
    const collapsed = Array.isArray(value.Collapsed_Panels) ? dedupe(value.Collapsed_Panels.filter(isPanelId)) : [];
    return {
        Project_IDs: dedupe(ids),
        Show_Done: value.Show_Done === true,
        ...(collapsed.length > 0 ? { Collapsed_Panels: collapsed } : {}),
    };
}

/** Tabla za jednu organizaciju iz dokumenta korisnika. */
export function boardFromDoc(doc: unknown, organizationId: string): CommandBoardState {
    if (!doc || typeof doc !== 'object' || !organizationId) return EMPTY_BOARD;
    const boards = (doc as Partial<UserBoardsDoc>).Boards;
    if (!boards || typeof boards !== 'object') return EMPTY_BOARD;
    return normalizeBoard((boards as Record<string, unknown>)[organizationId]);
}

/** Novi dokument za upis — ostale organizacije ostaju netaknute. */
export function docWithBoard(
    previous: UserBoardsDoc | null,
    userId: string,
    organizationId: string,
    board: CommandBoardState,
): UserBoardsDoc {
    return {
        User_ID: userId,
        Updated_At: new Date().toISOString(),
        Boards: { ...(previous?.Boards || {}), [organizationId]: normalizeBoard(board) },
    };
}

/** Nova lista sklopljenih ploča; prazna lista briše ključ (ne upisuje `[]` ni `undefined`). */
export function withCollapsedPanels(board: CommandBoardState, panels: PanelId[]): CommandBoardState {
    const { Collapsed_Panels: _previous, ...rest } = board;
    const clean = dedupe(panels.filter(isPanelId));
    return clean.length > 0 ? { ...rest, Collapsed_Panels: clean } : rest;
}

/** Dodaje na KRAJ (novi projekat ne preskače one koje već pratiš) i nikad dvaput. */
export function addToBoard(board: CommandBoardState, ...projectIds: string[]): CommandBoardState {
    const fresh = projectIds.filter(id => !!id && !board.Project_IDs.includes(id));
    if (fresh.length === 0) return board;
    return { ...board, Project_IDs: [...board.Project_IDs, ...dedupe(fresh)] };
}

/** Uklanja SAMO s table — projekat ostaje netaknut u Projekti tabu. */
export function removeFromBoard(board: CommandBoardState, projectId: string): CommandBoardState {
    if (!board.Project_IDs.includes(projectId)) return board;
    return { ...board, Project_IDs: board.Project_IDs.filter(id => id !== projectId) };
}

/** Premještanje čipa (drag ili strelice) — pomjera za `delta` mjesta, uz rubove. */
export function moveOnBoard(board: CommandBoardState, projectId: string, delta: number): CommandBoardState {
    const from = board.Project_IDs.indexOf(projectId);
    if (from < 0 || delta === 0) return board;
    const to = Math.min(board.Project_IDs.length - 1, Math.max(0, from + delta));
    if (to === from) return board;
    const next = [...board.Project_IDs];
    next.splice(to, 0, next.splice(from, 1)[0]);
    return { ...board, Project_IDs: next };
}

/**
 * Projekti s table, u redoslijedu table. Projekat koji je u međuvremenu
 * obrisan ili arhiviran van dohvata se TIHO ispušta — tabla ne smije pući
 * zato što je neko drugi obrisao projekat.
 */
export function boardProjects(board: CommandBoardState, projects: Project[]): Project[] {
    const index = new Map(projects.map(p => [p.Project_ID, p]));
    return board.Project_IDs.map(id => index.get(id)).filter((p): p is Project => !!p);
}

/** ID-evi s table kojih više nema među projektima (za tiho čišćenje pri upisu). */
export function staleBoardIds(board: CommandBoardState, projects: Project[]): string[] {
    const live = new Set(projects.map(p => p.Project_ID));
    return board.Project_IDs.filter(id => !live.has(id));
}

function dedupe<T extends string>(ids: T[]): T[] {
    return Array.from(new Set(ids));
}
