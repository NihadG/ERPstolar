import {
    formatOrderNumber,
    parseOrderNumber,
    isNewFormatOrderNumber,
    nextOrderNumber,
} from '../orderNumber';

describe('formatOrderNumber', () => {
    it('pada na N + godina-mjesec / slovo broj', () => {
        expect(formatOrderNumber({ year: 2026, month: 7, letter: 'K', seq: 7 })).toBe('N2026-07/K7');
    });

    it('dopunjava mjesec nulom', () => {
        expect(formatOrderNumber({ year: 2026, month: 1, letter: 'A', seq: 12 })).toBe('N2026-01/A12');
    });
});

describe('parseOrderNumber', () => {
    it('prepoznaje novi format', () => {
        expect(parseOrderNumber('N2026-07/K7')).toEqual({ year: 2026, month: 7, letter: 'K', seq: 7 });
    });

    it('trpi razmake oko broja', () => {
        expect(parseOrderNumber('  N2026-07/K7  ')).toEqual({ year: 2026, month: 7, letter: 'K', seq: 7 });
    });

    it('odbija stari format', () => {
        expect(parseOrderNumber('N-20260718-143022-847')).toBeNull();
    });

    it('odbija broj naloga (nema N prefiks)', () => {
        expect(parseOrderNumber('2026-07/R1')).toBeNull();
    });

    it('odbija nemoguć mjesec i nulti broj', () => {
        expect(parseOrderNumber('N2026-13/A1')).toBeNull();
        expect(parseOrderNumber('N2026-07/A0')).toBeNull();
    });

    it('odbija prazno', () => {
        expect(parseOrderNumber('')).toBeNull();
        expect(parseOrderNumber(undefined)).toBeNull();
        expect(parseOrderNumber(null)).toBeNull();
    });
});

describe('isNewFormatOrderNumber', () => {
    it('razlikuje novi od starog', () => {
        expect(isNewFormatOrderNumber('N2026-07/K7')).toBe(true);
        expect(isNewFormatOrderNumber('N-20260718-143022-847')).toBe(false);
    });
});

describe('nextOrderNumber', () => {
    const JULY = '2026-07-18T10:00:00.000Z';

    it('koristi mjesec zadatog datuma', () => {
        expect(nextOrderNumber([], JULY, () => 0)).toBe('N2026-07/A1');
    });

    it('preskače zauzetu kombinaciju', () => {
        // rng koji uvijek vraća 0 → A1; A1 je zauzet pa se ide na prvi slobodan.
        expect(nextOrderNumber(['N2026-07/A1'], JULY, () => 0)).toBe('N2026-07/A2');
    });

    it('ne smatra zauzetim broj iz drugog mjeseca', () => {
        expect(nextOrderNumber(['N2026-06/A1'], JULY, () => 0)).toBe('N2026-07/A1');
    });

    it('ignoriše stare brojeve i brojeve naloga', () => {
        const existing = ['N-20260718-143022-847', '2026-07/R1', undefined, null, ''];
        expect(nextOrderNumber(existing, JULY, () => 0)).toBe('N2026-07/A1');
    });

    it('nikad ne vrati broj koji već postoji', () => {
        const existing: string[] = [];
        let seed = 0;
        // Determinističan pseudo-rng — pokriva i sudare, ne samo sretne pogotke.
        const rng = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
        for (let i = 0; i < 300; i++) {
            const num = nextOrderNumber(existing, JULY, rng);
            expect(existing).not.toContain(num);
            expect(parseOrderNumber(num)).not.toBeNull();
            existing.push(num);
        }
    });

    it('proširi opseg kad je mjesec pun umjesto da ponovi broj', () => {
        const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'.split('');
        const full: string[] = [];
        for (const letter of LETTERS) {
            for (let seq = 1; seq <= 99; seq++) full.push(`N2026-07/${letter}${seq}`);
        }
        const next = nextOrderNumber(full, JULY, () => 0);
        expect(next).toBe('N2026-07/A100');
        expect(full).not.toContain(next);
    });

    it('rng na gornjoj granici ne izlazi iz opsega', () => {
        // rng() = 0.999… → posljednje slovo, seq 99 (a ne 100 / izvan niza)
        expect(nextOrderNumber([], JULY, () => 0.9999999)).toBe('N2026-07/Z99');
    });
});
