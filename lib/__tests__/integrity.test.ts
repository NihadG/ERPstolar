import { effectiveDailyRate } from '../laborSplit';

// ════════════════════════════════════════════════════════════════════════════
// effectiveDailyRate — efektivno-datirana dnevnica (rizik #2: retro unos / promjena cijene)
// ════════════════════════════════════════════════════════════════════════════
describe('effectiveDailyRate', () => {
    test('bez istorije → trenutna Daily_Rate', () => {
        expect(effectiveDailyRate({ Daily_Rate: 100 }, '2026-06-20')).toBe(100);
        expect(effectiveDailyRate({ Daily_Rate: 100, Daily_Rate_History: [] }, '2026-06-20')).toBe(100);
    });

    test('nepostojeći radnik / bez cijene → 0', () => {
        expect(effectiveDailyRate(undefined, '2026-06-20')).toBe(0);
        expect(effectiveDailyRate(null, '2026-06-20')).toBe(0);
        expect(effectiveDailyRate({}, '2026-06-20')).toBe(0);
    });

    test('bira posljednji unos čiji je Effective_From ≤ datum', () => {
        const w = {
            Daily_Rate: 130,
            Daily_Rate_History: [
                { Effective_From: '1970-01-01', Rate: 80 },
                { Effective_From: '2026-06-15', Rate: 100 },
                { Effective_From: '2026-06-28', Rate: 130 },
            ],
        };
        expect(effectiveDailyRate(w, '2026-06-10')).toBe(80);   // prije prve promjene
        expect(effectiveDailyRate(w, '2026-06-15')).toBe(100);  // na dan promjene
        expect(effectiveDailyRate(w, '2026-06-20')).toBe(100);  // između
        expect(effectiveDailyRate(w, '2026-06-28')).toBe(130);  // na dan posljednje
        expect(effectiveDailyRate(w, '2026-07-01')).toBe(130);  // poslije
    });

    test('datum prije svih unosa → najraniji poznati (ne današnji)', () => {
        const w = {
            Daily_Rate: 130,
            Daily_Rate_History: [
                { Effective_From: '2026-06-15', Rate: 100 },
                { Effective_From: '2026-06-28', Rate: 130 },
            ],
        };
        // KLJUČNO za rizik #2: stari datum NE smije pokupiti današnju (130) cijenu.
        expect(effectiveDailyRate(w, '2026-06-01')).toBe(100);
    });

    test('podnosi ISO timestamp u Effective_From', () => {
        const w = { Daily_Rate: 0, Daily_Rate_History: [{ Effective_From: '2026-06-15T09:30:00.000Z', Rate: 110 }] };
        expect(effectiveDailyRate(w, '2026-06-20')).toBe(110);
    });
});
