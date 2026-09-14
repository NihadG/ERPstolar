import {
    addToBoard, boardFromDoc, boardProjects, docWithBoard, EMPTY_BOARD,
    moveOnBoard, normalizeBoard, removeFromBoard, staleBoardIds, type CommandBoardState,
} from '../command/board';
import type { Project } from '../types';

const project = (id: string, name: string): Project => ({ Project_ID: id, Name: name } as Project);
const board = (ids: string[], showDone = false): CommandBoardState => ({ Project_IDs: ids, Show_Done: showDone });

test('smeće iz dokumenta ne ruši tablu nego daje praznu', () => {
    expect(normalizeBoard(null)).toEqual(EMPTY_BOARD);
    expect(normalizeBoard({ Project_IDs: 'ne-niz' })).toEqual(EMPTY_BOARD);
    expect(normalizeBoard({ Project_IDs: ['a', '', 'a', 7, 'b'], Show_Done: 'da' }))
        .toEqual({ Project_IDs: ['a', 'b'], Show_Done: false });
});

test('tabla se čita po organizaciji, a upis ne dira ostale firme', () => {
    const doc = { User_ID: 'u', Updated_At: '', Boards: { org1: board(['a']), org2: board(['b'], true) } };
    expect(boardFromDoc(doc, 'org2')).toEqual({ Project_IDs: ['b'], Show_Done: true });
    expect(boardFromDoc(doc, 'nepoznata')).toEqual(EMPTY_BOARD);

    const next = docWithBoard(doc, 'u', 'org1', board(['a', 'c']));
    expect(next.Boards.org1.Project_IDs).toEqual(['a', 'c']);
    expect(next.Boards.org2).toEqual(board(['b'], true));
});

test('dodavanje ide na kraj, bez duplikata; uklanjanje ne dira ostale', () => {
    expect(addToBoard(board(['a']), 'b', 'a', 'b').Project_IDs).toEqual(['a', 'b']);
    expect(addToBoard(board(['a']), 'a')).toEqual(board(['a']));
    expect(removeFromBoard(board(['a', 'b', 'c']), 'b').Project_IDs).toEqual(['a', 'c']);
});

test('premještanje čipa staje na rubovima umjesto da ispadne iz niza', () => {
    expect(moveOnBoard(board(['a', 'b', 'c']), 'c', -1).Project_IDs).toEqual(['a', 'c', 'b']);
    expect(moveOnBoard(board(['a', 'b', 'c']), 'a', -5).Project_IDs).toEqual(['a', 'b', 'c']);
    expect(moveOnBoard(board(['a', 'b', 'c']), 'a', 9).Project_IDs).toEqual(['b', 'c', 'a']);
});

test('projekat obrisan negdje drugdje se tiho ispusti, redoslijed table ostaje', () => {
    const projects = [project('b', 'Drugi'), project('a', 'Prvi')];
    expect(boardProjects(board(['a', 'nema', 'b']), projects).map(p => p.Project_ID)).toEqual(['a', 'b']);
    expect(staleBoardIds(board(['a', 'nema', 'b']), projects)).toEqual(['nema']);
});
