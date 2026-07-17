// ============================================
// GOOGLE DRIVE — REST v3 klijent + Picker (klijentski)
// ============================================
// DriveClient je apstrakcija (interface) → prava implementacija ide preko
// fetch+token, a testovi ubacuju in-memory mock. findOrCreateFolder je
// idempotentan (ne pravi duplikate).

import { ensureAccessToken } from './googleAuth';
import { GOOGLE_API_KEY, loadPicker } from './config';

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

export interface DriveEntry {
    id: string;
    name: string;
    webViewLink?: string;
}

/** Apstrakcija Drive operacija — omogućava mockanje u testovima. */
export interface DriveClient {
    listFolders(name: string, parentId: string): Promise<DriveEntry[]>;
    createFolder(name: string, parentId: string): Promise<DriveEntry>;
    uploadFile(blob: Blob, name: string, parentId: string, mimeType?: string): Promise<DriveEntry>;
}

async function driveFetch(url: string, init: RequestInit): Promise<any> {
    const token = await ensureAccessToken();
    const headers = { ...(init.headers || {}), Authorization: `Bearer ${token}` };
    const r = await fetch(url, { ...init, headers });
    if (!r.ok) {
        const txt = await r.text().catch(() => '');
        throw new Error(`Google Drive greška ${r.status}: ${txt.slice(0, 200)}`);
    }
    return r.json();
}

/** Escape jednostrukih navodnika i backslash-a za Drive `q` upit. */
function escapeQ(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export function createRealDriveClient(): DriveClient {
    return {
        async listFolders(name, parentId) {
            const q = `mimeType='${FOLDER_MIME}' and name='${escapeQ(name)}' and '${escapeQ(parentId)}' in parents and trashed=false`;
            const url = `${DRIVE_FILES}?q=${encodeURIComponent(q)}`
                + `&fields=${encodeURIComponent('files(id,name,webViewLink)')}&spaces=drive&pageSize=10`;
            const data = await driveFetch(url, { method: 'GET' });
            return (data.files || []) as DriveEntry[];
        },
        async createFolder(name, parentId) {
            const url = `${DRIVE_FILES}?fields=${encodeURIComponent('id,name,webViewLink')}`;
            return driveFetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
            });
        },
        async uploadFile(blob, name, parentId, mimeType = 'application/pdf') {
            const boundary = '-------erpv4' + Math.random().toString(16).slice(2);
            const metadata = { name, parents: [parentId], mimeType };
            const body = new Blob([
                `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
                JSON.stringify(metadata),
                `\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
                blob,
                `\r\n--${boundary}--`,
            ]);
            const url = `${DRIVE_UPLOAD}?uploadType=multipart&fields=${encodeURIComponent('id,name,webViewLink')}`;
            return driveFetch(url, {
                method: 'POST',
                headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
                body,
            });
        },
    };
}

/** Idempotentno: vrati postojeći folder po imenu pod parentom, inače ga kreiraj. */
export async function findOrCreateFolder(client: DriveClient, name: string, parentId: string): Promise<DriveEntry> {
    const existing = await client.listFolders(name, parentId);
    if (existing.length > 0) return existing[0];
    return client.createFolder(name, parentId);
}

/** Link ka folderu na Drive-u. */
export function folderLink(id: string): string {
    return `https://drive.google.com/drive/folders/${id}`;
}

/**
 * Google Picker — odabir POSTOJEĆEG foldera. Pod `drive.file` scope-om, izborom
 * kroz Picker app dobija pristup baš tom folderu (bez restricted scope-a).
 */
export async function pickExistingFolder(): Promise<{ id: string; name: string; url: string } | null> {
    await loadPicker();
    const token = await ensureAccessToken();
    const g = (window as any).google;
    return new Promise((resolve) => {
        const view = new g.picker.DocsView(g.picker.ViewId.FOLDERS)
            .setSelectFolderEnabled(true)
            .setIncludeFolders(true)
            .setMimeTypes(FOLDER_MIME);
        const picker = new g.picker.PickerBuilder()
            .addView(view)
            .setOAuthToken(token)
            .setDeveloperKey(GOOGLE_API_KEY)
            .setTitle('Odaberi root folder za projekte')
            .setCallback((data: any) => {
                if (data.action === g.picker.Action.PICKED) {
                    const doc = data.docs[0];
                    resolve({ id: doc.id, name: doc.name, url: doc.url || folderLink(doc.id) });
                } else if (data.action === g.picker.Action.CANCEL) {
                    resolve(null);
                }
            })
            .build();
        picker.setVisible(true);
    });
}
