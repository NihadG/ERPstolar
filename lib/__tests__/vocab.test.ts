import { activeVocab, aliasesOf, bestVocab, findVocab, vocabKey, type VocabEntry } from '../assistant/vocab';

const W = (phrase: string, kind: VocabEntry['Kind'], target: string, extra: Partial<VocabEntry> = {}): VocabEntry => ({
    Vocab_ID: `${kind}-${phrase}`, Organization_ID: 'o', Phrase: phrase, Key: vocabKey(phrase), Kind: kind,
    Target_ID: target, Target_Label: target, Source: 'taught', Count: 1, Created_At: '2026-10-01', Updated_At: '2026-10-01', ...extra,
});

describe('rječnik: kako korisnik zove stvari', () => {
    it('ključ bez dijakritike, malih riječi i interpunkcije', () => {
        expect(vocabKey('Ormar kod Jerka,')).toBe('ormar jerka');
        expect(vocabKey('„Čorluka"')).toBe('corluka');
    });

    it('riječ projekta važi dok je projekat aktivan; nalog dok je otvoren; lokacija dok ne istekne', () => {
        const all = [
            W('Jerko', 'project', 'p1', { Project_ID: 'p1' }),
            W('ormar kod Jerka', 'order', 'r1'),
            W('305', 'location', 'E305', { Expires_At: '2026-10-20' }),
            W('Braco', 'worker', 'w1'),
        ];
        const now = activeVocab(all, { projectIds: new Set(['p1']), orderIds: new Set(['r1']) }, '2026-10-26');
        expect(now.map(e => e.Phrase)).toEqual(['Jerko', 'ormar kod Jerka', 'Braco']);
        const later = activeVocab(all, { projectIds: new Set(), orderIds: new Set() }, '2026-10-26');
        expect(later.map(e => e.Phrase)).toEqual(['Braco']); // opšti rječnik ostaje
    });

    it('riječ u rečenici, s padežima; najduža riječ pobjeđuje', () => {
        const v = [W('Jerko', 'project', 'p1'), W('ormar kod Jerka', 'order', 'r1'), W('kuhinja kod Jerka', 'order', 'r2')];
        expect(bestVocab('radili ormar kod Jerku', v, 'order')?.Target_ID).toBe('r1');
        expect(bestVocab('bili kod Jerke', v, 'project')?.Target_ID).toBe('p1');
        expect(findVocab('kod Jerka', v, 'order')).toEqual([]);
    });

    it('dvije riječi iste dužine s različitim ciljem → nema pogađanja', () => {
        const v = [W('Ana', 'project', 'p1'), W('Ana', 'project', 'p2')];
        expect(bestVocab('kod Ane', v, 'project')).toBeNull();
    });

    it('tačan izraz za proces i lokaciju', () => {
        const v = [W('kantao fronte', 'process', 'Kantiranje furnira'), W('305', 'location', 'E305')];
        expect(bestVocab('Kantao fronte', v, 'process', { exact: true })?.Target_Label).toBe('Kantiranje furnira');
        expect(bestVocab('kantao', v, 'process', { exact: true })).toBeNull();
        expect(bestVocab('305', v, 'location', { exact: true })?.Target_ID).toBe('E305');
        expect(aliasesOf([W('Jerko', 'project', 'p1'), W('kod Ane', 'project', 'p1')], 'project', 'p1')).toEqual(['Jerko', 'kod Ane']);
    });
});
