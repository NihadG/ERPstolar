'use client';

import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

// ════════════════════════════════════════════════════════════════════
// PDF EXPORT — isti dokument koji ide na štampu, samo u PDF
//
// Zašto ne dijeli put s lib/pdfGenerator.ts: tamo se HTML ubacuje u
// GLAVNI dokument, pa globalni CSS aplikacije upada u njega i mijenja mu
// izgled (npr. `.product-name` iz OrdersTab.css reže naziv s ellipsis, a
// `.page-header` iz istog fajla gazi zaglavlje). Ovdje se dokument
// montira u izolovan <iframe> — vidi samo svoj CSS, tačno kao prozor za
// štampu.
//
// REZOLUCIJA: skala se računa iz CILJANE širine NA PAPIRU, ne iz CSS
// piksela izvora. Tako 300 DPI ostaje 300 DPI bez obzira je li dokument
// pisan na 703px (ponuda) ili 794px (narudžba).
// ════════════════════════════════════════════════════════════════════

const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const PX_PER_MM = 96 / 25.4;

/** Iste margine kao `@page` u CSS-u za štampu ponude — PDF i papir se poklapaju. */
export const PRINT_MARGIN_MM = { top: 10, right: 12, bottom: 14, left: 12 };

/**
 * 400 DPI baseline — iznad štamparskog standarda (300), pa tekst ostaje
 * oštar i kad se PDF gleda na ekranu i zumira (ranije se na 300 vidjela
 * rasterizacija). Ponuda traži još više (vidi poziv u OffersTab) jer je
 * kratka pa veći raster ne opterećuje ni memoriju ni Drive upload.
 */
const DEFAULT_DPI = 400;

// Zaštita od pucanja canvasa: Chrome odbija stranicu preko ~16k px i
// canvas preko ~256MB. Držimo se dobro ispod — dugačka narudžba inače
// obori tab umjesto da izveze PDF.
const MAX_CANVAS_SIDE = 16384;
const MAX_CANVAS_AREA = 40e6;

/** Koliko se unazad traži prazan red da prelom ne presiječe tekst (dio visine strane). */
const BREAK_LOOKBACK_RATIO = 0.18;

export interface PDFExportOptions {
    /** Margine u mm. Default = PRINT_MARGIN_MM. */
    margin?: { top: number; right: number; bottom: number; left: number };
    /** Ciljana rezolucija rastera (default 300). */
    dpi?: number;
    /** CSS koji ide u <head> kad `html` nije kompletan dokument. */
    css?: string;
    /**
     * CSS koji se ubacuje POSLIJE svega — tu idu pravila iz `@media print`
     * koja na ekranu ne bi bila aktivna (npr. `.page { padding: 0 }`).
     */
    printOverrides?: string;
}

// ════════════════════════════════════════════════════════════════════
// JAVNI API
// ════════════════════════════════════════════════════════════════════

/**
 * Broj dokumenta → bezbjedan naziv fajla. Brojevi sadrže „/" (N2026-07/K7,
 * P-2026/01), a to je separator putanje — bez ovoga se PDF snimi pod krnjim
 * imenom, a na Drive-u naziv izgleda kao putanja.
 */
export function toSafeFileName(value: string): string {
    return (value || '').replace(/[\\/:*?"<>|]+/g, '-').trim();
}

/** Dokument → PDF Blob (za upload na Drive). */
export async function exportHTMLToPDFBlob(html: string, options: PDFExportOptions = {}): Promise<Blob> {
    const pdf = await renderToPDF(html, options);
    return pdf.output('blob');
}

/** Dokument → preuzimanje PDF-a. `filename` bez ekstenzije. */
export async function exportHTMLToPDFFile(html: string, filename: string, options: PDFExportOptions = {}): Promise<void> {
    const pdf = await renderToPDF(html, options);
    pdf.save(`${filename}.pdf`);
}

// ════════════════════════════════════════════════════════════════════
// RENDER
// ════════════════════════════════════════════════════════════════════

async function renderToPDF(html: string, options: PDFExportOptions): Promise<jsPDF> {
    const margin = options.margin || PRINT_MARGIN_MM;
    const dpi = options.dpi || DEFAULT_DPI;
    const contentWidthMm = A4_WIDTH_MM - margin.left - margin.right;
    const contentHeightMm = A4_HEIGHT_MM - margin.top - margin.bottom;

    const frame = await mountIsolated(html, Math.round(contentWidthMm * PX_PER_MM), options);
    try {
        const doc = frame.contentDocument;
        if (!doc) throw new Error('PDF export: izolovani dokument nije dostupan');

        const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });

        // Dokument koji se sam lomi na strane (.page, kao ponuda) → svaka
        // .page je jedna PDF strana i prelomi padaju tamo gdje ih je layout
        // namjerno stavio. Ostalo ide kroz rezanje po praznom prostoru.
        const pageEls = Array.from(doc.querySelectorAll<HTMLElement>('.page'));
        const targets: HTMLElement[] = pageEls.length > 0 ? pageEls : [doc.body];

        let isFirst = true;
        for (const el of targets) {
            const canvas = await rasterize(el, contentWidthMm, dpi);
            for (const slice of sliceToPages(canvas, contentWidthMm, contentHeightMm)) {
                if (!isFirst) pdf.addPage();
                isFirst = false;
                pdf.addImage(slice.dataUrl, 'PNG', margin.left, margin.top, contentWidthMm, slice.heightMm, undefined, 'FAST');
            }
        }
        return pdf;
    } finally {
        frame.remove();
    }
}

/**
 * Montira dokument u skriveni <iframe>. `visibility:hidden` umjesto
 * `display:none` je namjerno — skriven okvir nema layout, pa bi sve visine
 * bile 0 (isti razlog kao kod mjerenja prije štampe ponude).
 */
async function mountIsolated(html: string, widthPx: number, options: PDFExportOptions): Promise<HTMLIFrameElement> {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = [
        'position:fixed',
        'left:-10000px',
        'top:0',
        `width:${widthPx}px`,
        `height:${Math.round(A4_HEIGHT_MM * PX_PER_MM)}px`,
        'border:0',
        'visibility:hidden',
    ].join(';');
    document.body.appendChild(frame);

    const doc = frame.contentDocument;
    if (!doc) return frame;

    const isFullDocument = /<html[\s>]/i.test(html);
    doc.open();
    doc.write(isFullDocument
        ? html
        : `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${options.css || ''}</style></head><body>${html}</body></html>`);
    doc.close();

    // Pravila iz @media print (na ekranu neaktivna) idu zadnja da nadjačaju.
    if (options.printOverrides) {
        const style = doc.createElement('style');
        style.textContent = options.printOverrides;
        (doc.head || doc.documentElement).appendChild(style);
    }

    await waitForContent(doc);
    return frame;
}

/** Fontovi + slike (logo) moraju biti gotovi, inače se rasteriše prazan okvir. */
async function waitForContent(doc: Document): Promise<void> {
    const pending: Promise<unknown>[] = [];
    if (doc.fonts?.ready) pending.push(doc.fonts.ready);
    for (const img of Array.from(doc.images)) {
        if (img.complete) continue;
        pending.push(new Promise(resolve => {
            img.onload = img.onerror = () => resolve(undefined);
        }));
    }
    // Pokvaren logo ne smije zaglaviti izvoz — čeka se najviše 3s.
    await Promise.race([
        Promise.all(pending),
        new Promise(resolve => setTimeout(resolve, 3000)),
    ]);
    // Jedan frame da se layout slegne nakon učitavanja fontova.
    await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));
}

/** Element → canvas na ~`dpi` mjereno po širini koju će zauzeti na papiru. */
async function rasterize(el: HTMLElement, contentWidthMm: number, dpi: number): Promise<HTMLCanvasElement> {
    const widthPx = Math.max(el.scrollWidth, el.offsetWidth, 1);
    const heightPx = Math.max(el.scrollHeight, el.offsetHeight, 1);

    const targetPx = (contentWidthMm / 25.4) * dpi;
    const scale = clampScale(targetPx / widthPx, widthPx, heightPx);

    // Cast: u projektu je zakačen @types/html2canvas@0.5 (stubovi za v0.5),
    // koji zasjenjuje tipove iz same html2canvas@1.4 i još zna za `background`
    // umjesto `backgroundColor`. Ime niže je ono koje v1.4 STVARNO čita.
    return html2canvas(el, {
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        scale,
        width: widthPx,
        height: heightPx,
        windowWidth: widthPx,
        windowHeight: heightPx,
    } as any);
}

/** Spusti skalu tek toliko da canvas ostane unutar granica browsera. */
function clampScale(desired: number, widthPx: number, heightPx: number): number {
    const byArea = Math.sqrt(MAX_CANVAS_AREA / Math.max(1, widthPx * heightPx));
    const bySide = MAX_CANVAS_SIDE / Math.max(widthPx, heightPx);
    return Math.max(1, Math.min(desired, byArea, bySide));
}

// ════════════════════════════════════════════════════════════════════
// REZANJE NA STRANE
// ════════════════════════════════════════════════════════════════════

interface PageSlice {
    dataUrl: string;
    heightMm: number;
}

/**
 * Visok canvas → niz A4 isječaka. Prelom se traži unazad od idealne granice
 * do prvog reda piksela koji je čist (bijel) po cijeloj širini, pa rez pada
 * u razmak između redova umjesto kroz slova.
 */
function sliceToPages(canvas: HTMLCanvasElement, contentWidthMm: number, contentHeightMm: number): PageSlice[] {
    const pxPerMm = canvas.width / contentWidthMm;
    const pageHeightPx = Math.floor(contentHeightMm * pxPerMm);

    // Stane na jednu stranu — bez rezanja (i bez skupog čitanja piksela).
    if (canvas.height <= pageHeightPx + 2) {
        return [{ dataUrl: canvas.toDataURL('image/png'), heightMm: canvas.height / pxPerMm }];
    }

    const slices: PageSlice[] = [];
    let top = 0;
    while (top < canvas.height) {
        const ideal = Math.min(canvas.height, top + pageHeightPx);
        const bottom = ideal >= canvas.height ? canvas.height : findCleanBreak(canvas, top, ideal, pageHeightPx);
        slices.push(cutSlice(canvas, top, bottom, pxPerMm));
        top = bottom;
    }
    return slices;
}

/**
 * Traži prazan red piksela u pojasu iznad `ideal`. Ako ga nema (npr. slika
 * preko cijele strane), vrati `ideal` — ponašanje kao bez ove optimizacije.
 */
function findCleanBreak(canvas: HTMLCanvasElement, top: number, ideal: number, pageHeightPx: number): number {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return ideal;

    const lookback = Math.floor(pageHeightPx * BREAK_LOOKBACK_RATIO);
    const from = Math.max(top + 1, ideal - lookback);
    const band = ideal - from;
    if (band <= 0) return ideal;

    let data: Uint8ClampedArray;
    try {
        data = ctx.getImageData(0, from, canvas.width, band).data;
    } catch {
        return ideal;   // tainted canvas — rez po idealnoj granici
    }

    // Odozdo prema gore: prvi čist red je najbliži idealnoj granici.
    // Uzorkuje se svaki 4. piksel — dovoljno da uhvati slovo ili liniju.
    const step = 4;
    for (let y = band - 1; y >= 0; y--) {
        const rowStart = y * canvas.width * 4;
        let clean = true;
        for (let x = 0; x < canvas.width; x += step) {
            const i = rowStart + x * 4;
            if (data[i] < 250 || data[i + 1] < 250 || data[i + 2] < 250) { clean = false; break; }
        }
        if (clean) return from + y;
    }
    return ideal;
}

function cutSlice(source: HTMLCanvasElement, top: number, bottom: number, pxPerMm: number): PageSlice {
    const height = bottom - top;
    const slice = document.createElement('canvas');
    slice.width = source.width;
    slice.height = height;

    const ctx = slice.getContext('2d');
    if (ctx) {
        // Bijela podloga — PDF bez alfa kanala je manji i predvidljiviji.
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, slice.width, slice.height);
        ctx.drawImage(source, 0, top, source.width, height, 0, 0, source.width, height);
    }
    return { dataUrl: slice.toDataURL('image/png'), heightMm: height / pxPerMm };
}
