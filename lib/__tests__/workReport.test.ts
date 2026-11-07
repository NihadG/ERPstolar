/**
 * @jest-environment node
 */
// Revizija 06.11. (izmišljena imena): „šta je Haso radio ovaj mjesec" → model je iz redova po stavci
// sabrao 3, pa 4, pa 4,7, pa 5 dana. Stvarno: 5 punih dana.

import { workReportLines, workReportSummary, type WorkReportRow } from '@/lib/workReport';
import { matchProcess } from '@/lib/workDiary';
import { onlyPossessive } from '@/lib/assistant/grounding';
import { messageIntent } from '@/lib/assistant/intent';
import { pdfParts } from '@/lib/email/search';

const row = (date: string, n: number, order: string, process = ''): WorkReportRow[] => Array.from({ length: n }, (_, i) => ({
    date, workerId: 'haso', worker: 'Haso Mujić', dayFraction: 1 / n, process, workOrderName: order, productName: `Poz ${i + 1}`, projectName: '', confirmed: false,
}));

const noFacts = { dims: [], widths: [], locations: [] };

describe('izvještaj rada: dane sabira ERP', () => {
    const rows = [
        ...row('2026-11-02', 16, 'Stolovi'), ...row('2026-11-03', 11, 'Kuhinja'),
        ...row('2026-11-04', 8, 'Umivaonici'), ...row('2026-11-05', 8, 'Umivaonici'), ...row('2026-11-06', 8, 'Umivaonici'),
    ];

    it('dan razbijen na stavke je jedan dan: 5 radnih dana, bez decimala', () => {
        const s = workReportSummary(rows);
        expect(s[0]).toBe('Haso Mujić: 5 dana rada (2.11., 3.11., 4.11., 5.11., 6.11.)');
        expect(s).toContain('  • Umivaonici: 3 dana (4.11., 5.11., 6.11.)');
        expect(s).toContain('  • Stolovi: 1 dan (2.11.)');
    });

    it('jedan red po danu i nalogu, ne po stavci', () => {
        const lines = workReportLines(rows);
        expect(lines).toHaveLength(5);
        expect(lines[0]).toBe('2.11. | Haso Mujić | 1 dan | Stolovi | bez procesa | 16 proizvoda | auto iz prisustva');
    });

    it('stvarno pola dana ostaje pola dana', () => {
        const half = [{ ...row('2026-11-02', 1, 'Stolovi')[0], dayFraction: 0.5 }];
        expect(workReportSummary(half)[0]).toMatch(/0[.,]5 dana rada \(2\.11\.\) — djelimično: 2\.11\. 0[.,]5/);
    });
});

describe('namjera i riječi', () => {
    it('pritužba na broj dana nije stanje proizvodnje', () => {
        expect(messageIntent('ne moze biti nikako decimalni broj, ako je danasnji radni dan gotov', [], noFacts).kinds).not.toContain('progress');
        expect(messageIntent('kuhinja za Lejlu je gotova', [], noFacts).kinds).toContain('progress');
    });

    it('„Tarikov projekat" je o njemu, ne za njega', () => {
        const w = { id: 'n', name: 'Tarik Hodžić' };
        expect(onlyPossessive('Pogledati Tarikov projekat za show room', w)).toBe(true);
        expect(onlyPossessive('Reci Tariku da pogleda Tarikov projekat', w)).toBe(false);
        expect(onlyPossessive('Tarik neka pogleda projekat', w)).toBe(false);
    });

    it('„stolovi" nije „Priprema štokova"', () => {
        expect(matchProcess('stolovi', ['Krojenje iverala', 'Priprema štokova', 'Okivanje'])).toBeNull();
    });
});

describe('PDF prilozi maila', () => {
    it('nalazi PDF-ove u ugniježđenim dijelovima, bez slika', () => {
        const parts = pdfParts({ parts: [
            { mimeType: 'text/plain' },
            { filename: 'logo.png', mimeType: 'image/png', body: { attachmentId: 'a0' } },
            { parts: [{ filename: '9960.pdf', mimeType: 'application/pdf', body: { attachmentId: 'a1', size: 2000 } }] },
        ] });
        expect(parts).toEqual([{ name: '9960.pdf', attachmentId: 'a1', size: 2000 }]);
    });
});
