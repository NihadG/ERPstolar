import { matchCatalog, describeCatalog, type MatchKind } from '../sketchup/match';
import { LUXCO_CATALOG } from '../sketchup/__fixtures__/luxcoCatalog';

const CAT = describeCatalog(LUXCO_CATALOG.map(([naziv, kategorija, jm], i) => ({ id: String(i), naziv, kategorija, jm })));
const m = (t: string, kind: MatchKind, th?: number) => matchCatalog(t, { kind, thickness: th ?? null }, CAT);

describe('prepoznavanje na stvarnom katalogu', () => {
    // [upit, vrsta, debljina, očekivani naziv ili null = nema sigurnog para]
    const AUTO: [string, MatchKind, number | undefined, string][] = [
        ['Egger U156 ST9 Pjescano bez', 'ploca', 18, 'Iveral / U156 ST9'],
        ['Iveral W1000', 'ploca', 18, 'Iveral / W1000 Bijela'],
        ['Iveral Bijeli za korpus', 'ploca', 18, 'Iveral / Bijeli za korpus'],
        ['Iveral Bijeli za korpus', 'ploca', 14, 'Iveral / Bijeli za korpus 14mm'],
        ['U963', 'ploca', 16, 'Iveral / Diamond Gray U963 ST9 16mm'],
        ['HDF leđa', 'ploca', 3, 'Lesomal'],
        ['MDF 18', 'ploca', 18, 'MDF 18'],
        ['HPL / F800', 'ploca', undefined, 'HPL / F800'],
        ['Furnir / Hrast', 'ploca', undefined, 'Furnir / Hrast'],
        ['Furnir KK / Hrast', 'ploca', undefined, 'Furnir KK / Hrast'],
        ['Lakiranje', 'obrada', undefined, 'Lakiranje'],
        ['Farbanje MDF', 'obrada', undefined, 'Boja za MDF'],
        ['Radna ploča H3710', 'ploca', 38, 'Radna ploča / H3710 Orah'],
        ['Hrast H3730', 'ploca', 18, 'Iveral / Hrast - H3730'],
        ['Kant traka W960', 'kant', 18, 'KT / W960 23 / 0.8'],
        ['Kant traka W960', 'kant', 38, 'KT / W960 43/0.8'],
        ['Kant traka – Iveral Bijeli za korpus', 'kant', 18, 'KT / Bijela za korpus 22 / 1'],
        ['Kant traka – Egger U727 ST9 Kamen siva', 'kant', 18, 'KT / Siva U727 ST9 23/0.8'],
        ['Baglama ravna s usporivačem', 'okov', undefined, 'Baglama ravna (sa ublazivacem)'],
        ['Baglama paralelna bez usporivača', 'okov', undefined, 'Baglama paralelna (bez ublazivaca)'],
        ['Vodilica kuglična 450 mm', 'okov', undefined, 'Vodilice Kuglične 450'],
        ['Vodilica Blum 450 mm', 'okov', undefined, 'Vodilice Blum 450'],
        ['Vodilica Blum 450 mm tip on', 'okov', undefined, 'Vodilice Blum 450 (Tip-on)'],
        ['Nosač gornjeg elementa', 'okov', undefined, 'Nosaci gornjih elemenata'],
        ['Horizontalne L Gole', 'okov', undefined, 'Horizontalna Gola L'],
        ['Vertikalne L Gole', 'okov', undefined, 'Vertikalna Gola L'],
        ['LEGRABOX C bijeli 500', 'okov', undefined, 'LEGRABOX visina C 176.8 (bijeli) 500 103365777'],
        ['103365777', 'okov', undefined, 'LEGRABOX visina C 176.8 (bijeli) 500 103365777'],
        ['Ručka 658.35 200 crna', 'okov', undefined, 'Ručke - 658.35 - 200 Crna'],
    ];
    it.each(AUTO)('%s (%s %s) → %s', (t, kind, th, expected) => {
        const r = m(t, kind, th);
        expect(r.auto).toBe(true);
        expect(r.best?.item.naziv).toBe(expected);
    });

    // Nejasno ili nepostojeće — ne smije se vezati samo (najviše prijedlog).
    const NOT_AUTO: [string, MatchKind, number | undefined][] = [
        ['Bijela', 'ploca', 18],
        ['MDF 17', 'ploca', 17],
        ['Furnir KK / Tik', 'ploca', undefined],
        ['Kant traka – Bijela', 'kant', 18],
        ['Baglama ravna', 'okov', undefined],
        ['Nosač šipke za ofinger', 'okov', undefined],
    ];
    it.each(NOT_AUTO)('%s (%s %s) ostaje za potvrdu', (t, kind, th) => {
        expect(m(t, kind, th).auto).toBe(false);
    });

    it('tvrda pravila: KK ≠ lice, iveral ≠ HPL, uska ≠ široka traka', () => {
        expect(m('Furnir KK / Tik', 'ploca').ranked.some(r => r.item.naziv === 'Furnir / Tik')).toBe(false);
        expect(m('Iveral F800', 'ploca', 18).ranked.some(r => r.item.naziv === 'HPL / F800')).toBe(false);
        expect(m('Kant traka W960', 'kant', 18).ranked.some(r => r.item.naziv === 'KT / W960 43/0.8')).toBe(false);
    });
});
