// ============================================
// PROJECT DRIVE — folder-stablo dosjea projekta (klijentski)
// ============================================
// Pri kreiranju NOVOG projekta: folder projekta + 5 podfoldera. Idempotentno
// (ponovni poziv ne pravi duplikate). „Ponude"/„Narudžbe" se pune na klik.

import type { Project } from '../types';
import { PROJECT_DRIVE_SUBFOLDERS } from '../types';
import { DriveClient, DriveEntry, createRealDriveClient, findOrCreateFolder } from './driveClient';

export interface ProjectFolderTree {
    folderId: string;
    folderUrl?: string;
    subfolders: Record<string, string>;  // naziv podfoldera → Drive folder ID
}

/** Naziv foldera projekta na Drive-u: „Klijent — Naziv" (podesivo kasnije). */
export function projectFolderName(project: Pick<Project, 'Client_Name' | 'Name'>): string {
    const parts = [project.Client_Name, project.Name]
        .map((s) => (s || '').trim())
        .filter(Boolean);
    return parts.join(' — ') || (project.Client_Name || '').trim() || 'Projekat';
}

/** Kreira/uskladi folder projekta + 5 podfoldera. Vraća ID-eve za perzistenciju. */
export async function ensureProjectFolderTree(
    project: Pick<Project, 'Client_Name' | 'Name'>,
    rootFolderId: string,
    client: DriveClient = createRealDriveClient(),
): Promise<ProjectFolderTree> {
    if (!rootFolderId) throw new Error('Root folder nije postavljen. Poveži Google i odaberi root folder u Postavkama.');

    const main = await findOrCreateFolder(client, projectFolderName(project), rootFolderId);

    const subfolders: Record<string, string> = {};
    for (const sub of PROJECT_DRIVE_SUBFOLDERS) {
        const f = await findOrCreateFolder(client, sub, main.id);
        subfolders[sub] = f.id;
    }

    return { folderId: main.id, folderUrl: main.webViewLink, subfolders };
}

/** Upload dokumenta (PDF) u zadati podfolder (npr. ID podfoldera „Ponude"). */
export async function fileToSubfolder(
    subfolderId: string,
    blob: Blob,
    filename: string,
    client: DriveClient = createRealDriveClient(),
    mimeType = 'application/pdf',
): Promise<DriveEntry> {
    if (!subfolderId) throw new Error('Podfolder projekta ne postoji. Kreiraj Drive folder projekta prvo.');
    return client.uploadFile(blob, filename, subfolderId, mimeType);
}

/**
 * Odluka: da li auto-kreirati folder pri spremanju projekta.
 * Samo NOVI projekti (postojeći već imaju ručno napravljene foldere).
 */
export function shouldAutoCreateFolder(opts: {
    isNew: boolean;
    moduleActive: boolean;
    connected: boolean;
    autoCreate: boolean;
    existingFolderId?: string;
}): boolean {
    return !!(
        opts.isNew &&
        opts.moduleActive &&
        opts.connected &&
        opts.autoCreate &&
        !opts.existingFolderId
    );
}
