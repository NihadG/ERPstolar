// ════════════════════════════════════════════════════════════════════
// SASTAV PLOČA — zajedničko za ERP i SketchUp plugin
//
// Pravila iz starog SketchUp uvoza (bivši lib/sketchupCalculator.ts), prenesena
// u ponudu Component Managera: SketchUp grupa „Furnir / Hrast 20 mm" nije
// ploča koja se kupuje, nego MDF jezgro + furnir + lakiranje. Isti kod se
// skriptom scripts/sync-sketchup-plugin.mjs ubacuje u plugin, pa ponuda i
// ERP računaju identično. Bez importa osim ./match, bez DOM-a.
//
//   tip      jezgro (ploče)                  obloga (m²)                     obrada (m²)                      kant
//   iveral   sam materijal (cjenovnik)        —                               —                                da
//   mdf      MDF {d}                          —                               Farbanje MDF: P×2 (jedna P×1,3)  ne — ivice se farbaju
//   furnir   MDF {d−2}; od 38 mm 2× MDF 18    lice P×1,4 + KK naličje P×1,4   Lakiranje: lice+KK P×1,4×1,2     ne — ivice se lakiraju
//                                             (obostrano: lice 2×P×1,4)       obostrano P×1,4×2×1,1
//   hpl      MDF {d−2}; jezgro ≥36 → 2×      HPL lice P×1,2 + HPL KK P×1,2   —                                da
//
// P = neto površina komada (m², jedna strana, samo vanjski slojevi).
// Ploče jezgra = kupljene ploče iz optimizacije (Component Manager).
// ════════════════════════════════════════════════════════════════════

import { normName, type MatchKind } from './match';

export type PlocaTip = 'iveral' | 'mdf' | 'furnir' | 'hpl';

export const KOEF = {
    FURNIR_OTPAD: 1.4,      // m² furnira po m² komada (po strani)
    LAK_OBOSTRANO: 1.1,     // obostrani furnir: lakira se 2 × furnir × 1,1
    LAK_LICE_KK: 1.2,       // lice + KK: lakira se furnir lica × 1,2
    HPL_OTPAD: 1.2,         // m² HPL-a po m² komada (po strani)
    FARBA_OBJE: 2,          // MDF vidljiv s obje strane
    FARBA_JEDNA: 1.3,       // naličje dobije malo farbe
};

/** HPL se kupuje u pločama 2800 × 1310 — za preračun m² ↔ komad. */
export const HPL_PLOCA_M2 = 2.8 * 1.31;

export type Farbanje = 'obje' | 'jedna' | 'bez';

export interface Profil {
    tip: PlocaTip;
    /** Dekor bez oznake vrste: „Furnir / Hrast" → „Hrast", „HPL / F800" → „F800". */
    dekor: string;
}

function cap(s: string): string {
    const t = s.trim().replace(/\s+/g, ' ');
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

/** Vrsta ploče iz naziva SketchUp materijala. Sve što nije MDF/furnir/HPL računa se kao iveral. */
export function profilMaterijala(naziv: string): Profil {
    const n = normName(naziv);
    const clean = (re: RegExp) => cap(naziv.replace(re, ' ').replace(/[/\\·–—-]+/g, ' ').replace(/\b\d{1,2}\s*mm\b/gi, ''));
    if (/\bhpl\b/.test(n)) return { tip: 'hpl', dekor: clean(/\bhpl\b(\s*kk\b)?/gi) || 'HPL' };
    if (/\bfurnir\w*/.test(n)) return { tip: 'furnir', dekor: clean(/\bfurnir\w*(\s*kk\b)?/gi) || 'Furnir' };
    if (/\bmdf\b/.test(n)) return { tip: 'mdf', dekor: clean(/\bmdf\b/gi) };
    return { tip: 'iveral', dekor: naziv.trim() };
}

export interface SastavUlaz {
    tip: PlocaTip;
    dekor: string;
    /** Debljina komada u mm (SketchUp grupa). */
    debljina: number;
    /** Neto površina komada, jedna strana, m². */
    povrsina: number;
    /** Kupljene ploče (optimizacija), za jezgro. */
    ploce: number;
    furnirObostrano?: boolean;
    farbanje?: Farbanje;
}

export interface SastavStavka {
    uloga: 'jezgro' | 'lice' | 'nalicje' | 'obrada';
    /** Vrsta stavke u izvozu za ERP. */
    vrsta: 'ploca' | 'obloga' | 'obrada';
    /** Vrsta za prepoznavanje u katalogu. */
    kind: MatchKind;
    /** Naziv u obliku ERP kataloga („MDF 18", „Furnir KK / Hrast", „Lakiranje"). */
    naziv: string;
    jm: 'ploča' | 'm²';
    kolicina: number;
    debljina?: number;
    /** Za preračun m² ↔ ploča u ERP-u (HPL se vodi po ploči). */
    povrsinaPloce?: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function jezgro(d: number, ploce: number): SastavStavka[] {
    const t = Math.max(3, Math.round(d));
    return [{ uloga: 'jezgro', vrsta: 'ploca', kind: 'ploca', naziv: `MDF ${t}`, jm: 'ploča', kolicina: ploce, debljina: t }];
}

/** Stavke sastava za jednu SketchUp grupu (MDF / furnir / HPL); iveral nema sastav. */
export function sastav(u: SastavUlaz): SastavStavka[] {
    const P = Math.max(0, u.povrsina);
    const out: SastavStavka[] = [];
    if (u.tip === 'mdf') {
        out.push(...jezgro(u.debljina, u.ploce));
        const f = u.farbanje || 'obje';
        if (f !== 'bez') {
            out.push({
                uloga: 'obrada', vrsta: 'obrada', kind: 'obrada', naziv: 'Farbanje MDF', jm: 'm²',
                kolicina: r2(P * (f === 'obje' ? KOEF.FARBA_OBJE : KOEF.FARBA_JEDNA)),
            });
        }
    } else if (u.tip === 'furnir') {
        const v = u.dekor || 'Furnir';
        if (u.debljina >= 38) out.push({ ...jezgro(18, u.ploce * 2)[0] });
        else out.push(...jezgro(u.debljina - 2, u.ploce));
        const strana = P * KOEF.FURNIR_OTPAD;
        if (u.furnirObostrano) {
            out.push({ uloga: 'lice', vrsta: 'obloga', kind: 'ploca', naziv: `Furnir / ${v}`, jm: 'm²', kolicina: r2(strana * 2) });
            out.push({ uloga: 'obrada', vrsta: 'obrada', kind: 'obrada', naziv: 'Lakiranje', jm: 'm²', kolicina: r2(strana * 2 * KOEF.LAK_OBOSTRANO) });
        } else {
            out.push({ uloga: 'lice', vrsta: 'obloga', kind: 'ploca', naziv: `Furnir / ${v}`, jm: 'm²', kolicina: r2(strana) });
            out.push({ uloga: 'nalicje', vrsta: 'obloga', kind: 'ploca', naziv: `Furnir KK / ${v}`, jm: 'm²', kolicina: r2(strana) });
            out.push({ uloga: 'obrada', vrsta: 'obrada', kind: 'obrada', naziv: 'Lakiranje', jm: 'm²', kolicina: r2(strana * KOEF.LAK_LICE_KK) });
        }
    } else if (u.tip === 'hpl') {
        const v = u.dekor || 'HPL';
        const core = u.debljina - 2;
        if (core >= 36) out.push({ ...jezgro(Math.round(core / 2), u.ploce * 2)[0] });
        else out.push(...jezgro(core, u.ploce));
        const strana = r2(P * KOEF.HPL_OTPAD);
        out.push({ uloga: 'lice', vrsta: 'obloga', kind: 'ploca', naziv: `HPL / ${v}`, jm: 'm²', kolicina: strana, povrsinaPloce: HPL_PLOCA_M2 });
        out.push({ uloga: 'nalicje', vrsta: 'obloga', kind: 'ploca', naziv: `HPL KK / ${v}`, jm: 'm²', kolicina: strana, povrsinaPloce: HPL_PLOCA_M2 });
    }
    return out;
}

/** Kant traka: MDF se farba, furnir lakira — trake nema. */
export function imaKant(tip: PlocaTip): boolean {
    return tip === 'iveral' || tip === 'hpl';
}
