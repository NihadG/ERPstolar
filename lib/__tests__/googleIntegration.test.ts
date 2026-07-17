/**
 * Testovi za Google integraciju (Faza 1): Drive folder-stablo + Kalendar zadataka.
 * Koriste in-memory mock klijente — bez mreže. Pokriva:
 *  - findOrCreateFolder idempotentnost (bez duplikata)
 *  - ensureProjectFolderTree (glavni folder + 5 podfoldera, idempotentno)
 *  - projectFolderName + shouldAutoCreateFolder (guard „samo novi projekti")
 *  - taskToEvent (all-day vs timed, checklist, prioritet, ✓ za završen)
 *  - upsertTaskEvent (create vs update)
 */

import { findOrCreateFolder, type DriveClient, type DriveEntry } from '../google/driveClient';
import { ensureProjectFolderTree, projectFolderName, shouldAutoCreateFolder } from '../google/projectDrive';
import { taskToEvent, upsertTaskEvent, type CalendarClient } from '../google/calendarClient';
import { PROJECT_DRIVE_SUBFOLDERS } from '../types';
import type { Task } from '../types';

// ── In-memory Drive mock ──────────────────────────────────────────────
function makeFakeDrive() {
    const folders = new Map<string, DriveEntry>(); // ključ: `${parent}|${name}`
    const createCalls: string[] = [];
    let idSeq = 0;
    const client: DriveClient = {
        async listFolders(name, parentId) {
            const f = folders.get(`${parentId}|${name}`);
            return f ? [f] : [];
        },
        async createFolder(name, parentId) {
            createCalls.push(`${parentId}|${name}`);
            const entry: DriveEntry = { id: `f${++idSeq}`, name, webViewLink: `https://drive/${idSeq}` };
            folders.set(`${parentId}|${name}`, entry);
            return entry;
        },
        async uploadFile(_blob, name) {
            return { id: `file${++idSeq}`, name };
        },
    };
    return { client, createCalls };
}

describe('findOrCreateFolder — idempotentnost', () => {
    test('drugi poziv NE pravi duplikat', async () => {
        const { client, createCalls } = makeFakeDrive();
        const a = await findOrCreateFolder(client, 'Ponude', 'root');
        const b = await findOrCreateFolder(client, 'Ponude', 'root');
        expect(a.id).toBe(b.id);
        expect(createCalls).toEqual(['root|Ponude']);
    });

    test('isti naziv pod različitim parentom → dva foldera', async () => {
        const { client, createCalls } = makeFakeDrive();
        await findOrCreateFolder(client, 'Ponude', 'p1');
        await findOrCreateFolder(client, 'Ponude', 'p2');
        expect(createCalls).toEqual(['p1|Ponude', 'p2|Ponude']);
    });
});

describe('ensureProjectFolderTree', () => {
    test('kreira glavni folder + svih 5 podfoldera', async () => {
        const { client } = makeFakeDrive();
        const tree = await ensureProjectFolderTree({ Client_Name: 'Begović', Name: 'Kuhinja' }, 'root', client);
        expect(tree.folderId).toBeTruthy();
        expect(Object.keys(tree.subfolders).sort()).toEqual([...PROJECT_DRIVE_SUBFOLDERS].sort());
        for (const sub of PROJECT_DRIVE_SUBFOLDERS) {
            expect(tree.subfolders[sub]).toBeTruthy();
        }
    });

    test('idempotentno: drugi poziv ne pravi nove foldere', async () => {
        const { client, createCalls } = makeFakeDrive();
        await ensureProjectFolderTree({ Client_Name: 'Begović', Name: 'Kuhinja' }, 'root', client);
        const afterFirst = createCalls.length; // 1 glavni + 5 podfoldera
        await ensureProjectFolderTree({ Client_Name: 'Begović', Name: 'Kuhinja' }, 'root', client);
        expect(afterFirst).toBe(1 + PROJECT_DRIVE_SUBFOLDERS.length);
        expect(createCalls.length).toBe(afterFirst);
    });

    test('baca grešku bez root foldera', async () => {
        const { client } = makeFakeDrive();
        await expect(ensureProjectFolderTree({ Client_Name: 'X' }, '', client)).rejects.toThrow();
    });
});

describe('projectFolderName', () => {
    test('„Klijent — Naziv"', () => {
        expect(projectFolderName({ Client_Name: 'Begović', Name: 'Kuhinja' })).toBe('Begović — Kuhinja');
    });
    test('samo klijent kad nema naziv', () => {
        expect(projectFolderName({ Client_Name: 'Begović', Name: '' })).toBe('Begović');
    });
    test('fallback „Projekat" kad je sve prazno', () => {
        expect(projectFolderName({ Client_Name: '', Name: '' })).toBe('Projekat');
    });
});

describe('shouldAutoCreateFolder — guard „samo novi projekti"', () => {
    const base = { isNew: true, moduleActive: true, connected: true, autoCreate: true, existingFolderId: undefined as string | undefined };
    test('sve ispunjeno → true', () => {
        expect(shouldAutoCreateFolder(base)).toBe(true);
    });
    test('postojeći projekat (nije nov) → false', () => {
        expect(shouldAutoCreateFolder({ ...base, isNew: false })).toBe(false);
    });
    test('već ima folder → false', () => {
        expect(shouldAutoCreateFolder({ ...base, existingFolderId: 'f1' })).toBe(false);
    });
    test('modul neaktivan → false', () => {
        expect(shouldAutoCreateFolder({ ...base, moduleActive: false })).toBe(false);
    });
    test('toggle isključen → false', () => {
        expect(shouldAutoCreateFolder({ ...base, autoCreate: false })).toBe(false);
    });
    test('nije povezan → false', () => {
        expect(shouldAutoCreateFolder({ ...base, connected: false })).toBe(false);
    });
});

// ── Kalendar ──────────────────────────────────────────────────────────
function makeTask(over: Partial<Task> = {}): Task {
    return {
        Task_ID: 't1',
        Organization_ID: 'org',
        Title: 'Montaža kuhinje',
        Description: 'Dovršiti montažu',
        Status: 'pending',
        Priority: 'high',
        Category: 'installation',
        Created_Date: '2026-07-01T00:00:00.000Z',
        Due_Date: '2026-07-20',
        Links: [],
        ...over,
    };
}

describe('taskToEvent', () => {
    test('all-day događaj za datum bez vremena (end = sljedeći dan)', () => {
        const ev = taskToEvent(makeTask({ Due_Date: '2026-07-20' }));
        expect(ev.start.date).toBe('2026-07-20');
        expect(ev.end.date).toBe('2026-07-21');
        expect(ev.start.dateTime).toBeUndefined();
    });

    test('timed događaj kad rok ima vrijeme', () => {
        const ev = taskToEvent(makeTask({ Due_Date: '2026-07-20T14:00:00.000Z' }));
        expect(ev.start.dateTime).toBeTruthy();
        expect(ev.end.dateTime).toBeTruthy();
        expect(ev.start.date).toBeUndefined();
    });

    test('naslov + prioritet/kategorija u opisu', () => {
        const ev = taskToEvent(makeTask());
        expect(ev.summary).toBe('Montaža kuhinje');
        expect(ev.description).toContain('Prioritet: Visok');
        expect(ev.description).toContain('Kategorija: Instalacija');
    });

    test('checklist se pojavljuje u opisu (☐/☑)', () => {
        const ev = taskToEvent(makeTask({
            Checklist: [
                { id: 'a', text: 'Donijeti alat', completed: false },
                { id: 'b', text: 'Provjeriti mjere', completed: true },
            ],
        }));
        expect(ev.description).toContain('☐ Donijeti alat');
        expect(ev.description).toContain('☑ Provjeriti mjere');
    });

    test('završen zadatak dobija ✓ prefiks', () => {
        const ev = taskToEvent(makeTask({ Status: 'completed' }));
        expect(ev.summary.startsWith('✓ ')).toBe(true);
    });
});

describe('upsertTaskEvent — create vs update', () => {
    function makeFakeCalendar() {
        const calls: string[] = [];
        let idSeq = 0;
        const client: CalendarClient = {
            async createEvent() { calls.push('create'); return { id: `ev${++idSeq}` }; },
            async updateEvent(_cal, id) { calls.push('update'); return { id }; },
            async deleteEvent() { calls.push('delete'); },
        };
        return { client, calls };
    }

    test('kreira događaj kad zadatak nema Calendar_Event_ID', async () => {
        const { client, calls } = makeFakeCalendar();
        const id = await upsertTaskEvent(makeTask({ Calendar_Event_ID: undefined }), 'primary', client);
        expect(id).toBe('ev1');
        expect(calls).toEqual(['create']);
    });

    test('ažurira postojeći događaj', async () => {
        const { client, calls } = makeFakeCalendar();
        const id = await upsertTaskEvent(makeTask({ Calendar_Event_ID: 'existing' }), 'primary', client);
        expect(id).toBe('existing');
        expect(calls).toEqual(['update']);
    });
});
