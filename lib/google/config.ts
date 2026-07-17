// ============================================
// GOOGLE INTEGRACIJA — konfiguracija + učitavanje skripti (klijentski)
// ============================================
// Faza 1 je 100% klijentska (bez servera, bez token store-a). Koristi
// Google Identity Services (GIS) za token i Google Picker za odabir foldera.

export const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID || '';
export const GOOGLE_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_API_KEY || '';

// Namjerno „laki" scope-ovi → BEZ restricted scope-a = bez plaćenog Google audita:
//   drive.file      — app vidi/piše SAMO fajlove/foldere koje sam kreira (+ Picker izbor)
//   calendar.events — kreiranje/uređivanje događaja u kalendaru
//   userinfo.email  — samo za prikaz povezanog računa
export const GOOGLE_SCOPES = [
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

/** Da li je integracija konfigurisana (env varijable postavljene). */
export function isGoogleConfigured(): boolean {
    return !!GOOGLE_CLIENT_ID;
}

// ── Učitavanje eksternih Google skripti (jednom) ──────────────────────
const loaded = new Set<string>();

function injectScript(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
        if (typeof document === 'undefined') {
            reject(new Error('Google skripte su dostupne samo u browseru'));
            return;
        }
        if (loaded.has(src)) { resolve(); return; }
        const existing = document.querySelector(`script[src="${src}"]`);
        if (existing) { loaded.add(src); resolve(); return; }
        const s = document.createElement('script');
        s.src = src;
        s.async = true;
        s.defer = true;
        s.onload = () => { loaded.add(src); resolve(); };
        s.onerror = () => reject(new Error(`Ne mogu učitati Google skriptu: ${src}`));
        document.head.appendChild(s);
    });
}

/** Google Identity Services (token klijent). */
export async function loadGis(): Promise<void> {
    await injectScript('https://accounts.google.com/gsi/client');
}

/** Google Picker (odabir postojećeg foldera). */
export async function loadPicker(): Promise<void> {
    await injectScript('https://apis.google.com/js/api.js');
    await new Promise<void>((resolve) => {
        (window as any).gapi.load('picker', { callback: () => resolve() });
    });
}
