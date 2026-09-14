/**
 * boardService.ts — lična tabla Komandnog centra
 *
 * Jedan dokument po korisniku (`user_boards/{uid}`), a unutar njega tabla po
 * organizaciji. Dokument je sitan (lista ID-eva projekata), pa se čita pri
 * otvaranju ekrana i piše odgođeno pri svakoj izmjeni — bez keša i bez
 * pretplate, jer ga mijenja samo taj korisnik.
 *
 * Upis NAMJERNO ne pada natrag na localStorage: tabla koja se „snimi" samo
 * na jednom računaru je gora od jasne poruke da nije snimljena.
 */

import { COLLECTIONS } from '../shared/collections';
import { getDoc, getDocRef, setDoc } from '../shared/firestoreClient';
import { boardFromDoc, docWithBoard, EMPTY_BOARD, type CommandBoardState, type UserBoardsDoc } from '../../command/board';

export interface UserBoardResult {
    board: CommandBoardState;
    /** Cijeli dokument — čuva table ostalih organizacija pri upisu. */
    doc: UserBoardsDoc | null;
}

export async function getUserBoard(userId: string, organizationId: string): Promise<UserBoardResult> {
    if (!userId || !organizationId) return { board: EMPTY_BOARD, doc: null };
    const snapshot = await getDoc(getDocRef(COLLECTIONS.USER_BOARDS, userId));
    if (!snapshot.exists()) return { board: EMPTY_BOARD, doc: null };
    const doc = snapshot.data() as UserBoardsDoc;
    return { board: boardFromDoc(doc, organizationId), doc };
}

export async function saveUserBoard(
    userId: string,
    organizationId: string,
    board: CommandBoardState,
    previous: UserBoardsDoc | null,
): Promise<UserBoardsDoc> {
    const next = docWithBoard(previous, userId, organizationId, board);
    await setDoc(getDocRef(COLLECTIONS.USER_BOARDS, userId), next);
    return next;
}
