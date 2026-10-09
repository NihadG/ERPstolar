import { sastav, profilMaterijala, imaKant, HPL_PLOCA_M2 } from '../sketchup/sastav';

const pick = (s: ReturnType<typeof sastav>) => s.map(x => [x.naziv, x.jm, x.kolicina]);

describe('profil materijala iz SketchUpa', () => {
    it.each([
        ['Furnir / Hrast', 'furnir', 'Hrast'],
        ['Hrast furnir 20mm', 'furnir', 'Hrast'],
        ['HPL / F800', 'hpl', 'F800'],
        ['MDF farbani', 'mdf', 'Farbani'],
        ['Egger U156 ST9', 'iveral', 'Egger U156 ST9'],
        ['Iveral Bijeli za korpus', 'iveral', 'Iveral Bijeli za korpus'],
    ])('%s → %s / %s', (naziv, tip, dekor) => {
        expect(profilMaterijala(naziv)).toEqual({ tip, dekor });
    });
});

// Brojke su iste kao u starom uvozu (bivši lib/sketchupCalculator.ts) za površinu 1 m².
describe('sastav — pravila starog uvoza', () => {
    it('furnir lice + KK: furnir ×1,4 po strani, lakiranje ×1,2, jezgro MDF d−2', () => {
        expect(pick(sastav({ tip: 'furnir', dekor: 'Hrast', debljina: 20, povrsina: 1, ploce: 0.5 }))).toEqual([
            ['MDF 18', 'ploča', 0.5],
            ['Furnir / Hrast', 'm²', 1.4],
            ['Furnir KK / Hrast', 'm²', 1.4],
            ['Lakiranje', 'm²', 1.68],
        ]);
    });

    it('furnir obostrano: lice 2×1,4, lakiranje ×2×1,1; od 38 mm dva MDF 18', () => {
        expect(pick(sastav({ tip: 'furnir', dekor: 'Orah', debljina: 38, povrsina: 1, ploce: 1, furnirObostrano: true }))).toEqual([
            ['MDF 18', 'ploča', 2],
            ['Furnir / Orah', 'm²', 2.8],
            ['Lakiranje', 'm²', 3.08],
        ]);
    });

    it('MDF: farbanje obje strane ×2, jedna ×1,3, bez farbanja samo ploča', () => {
        expect(pick(sastav({ tip: 'mdf', dekor: '', debljina: 18, povrsina: 1, ploce: 1 }))).toEqual([['MDF 18', 'ploča', 1], ['Farbanje MDF', 'm²', 2]]);
        expect(pick(sastav({ tip: 'mdf', dekor: '', debljina: 18, povrsina: 1, ploce: 1, farbanje: 'jedna' }))[1]).toEqual(['Farbanje MDF', 'm²', 1.3]);
        expect(sastav({ tip: 'mdf', dekor: '', debljina: 18, povrsina: 1, ploce: 1, farbanje: 'bez' })).toHaveLength(1);
    });

    it('HPL: lice i KK ×1,2, jezgro d−2 (≥36 → dva), površina ploče za preračun', () => {
        const s = sastav({ tip: 'hpl', dekor: 'F800', debljina: 20, povrsina: 1, ploce: 1 });
        expect(pick(s)).toEqual([['MDF 18', 'ploča', 1], ['HPL / F800', 'm²', 1.2], ['HPL KK / F800', 'm²', 1.2]]);
        expect(s[1].povrsinaPloce).toBeCloseTo(HPL_PLOCA_M2);
        expect(pick(sastav({ tip: 'hpl', dekor: 'F800', debljina: 40, povrsina: 1, ploce: 1 }))[0]).toEqual(['MDF 19', 'ploča', 2]);
    });

    it('iveral nema sastav; kant samo iveral i HPL', () => {
        expect(sastav({ tip: 'iveral', dekor: 'U156', debljina: 18, povrsina: 1, ploce: 1 })).toEqual([]);
        expect([imaKant('iveral'), imaKant('hpl'), imaKant('mdf'), imaKant('furnir')]).toEqual([true, true, false, false]);
    });
});
