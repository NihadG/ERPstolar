/**
 * @jest-environment node
 */
// Stalni skup za ponavljanje (lib/assistant/replaySet.ts) — principi, izmišljena imena:
//   1. provjera gleda šta je bot uradio SAD: alate (i pokušane), upise, odgovor s dugmadima, Knjigu rada
//   2. uzorci su bez dijakritike i bez razlike slova („nocni ormari" = „Noćni ormarići")
//   3. pitanje i zalijepljen mail: pokušan pa odbijen upis nije upis
//   4. snimak se siječe na trenutak prije poruka; skup se dopunjava, ne prepisuje
import { checkReplay, cutSnapshot, mergeEntries, mergeExpect, skupReport, type ReplayNext } from '@/lib/assistant/replaySet';

const WRITE = new Set(['log_work', 'create_task', 'set_presence']);
const next = (over: Partial<ReplayNext> = {}): ReplayNext => ({ outcome: 'answer', tools: [], toolLog: [], reply: '', ...over });
const db = (logs: { worker: string; order: string; date: string }[] = []) => ({ logs });

describe('provjera jedne poruke', () => {
    it.each([
        ['pozvan i uspio', [{ name: 'search_mail', ok: true }], []],
        ['pozvan, pao (pošta nedostupna u ponavljanju)', [{ name: 'search_mail', ok: false, error: 'mreža blokirana' }], []],
        ['nije pozvan', [{ name: 'work_report', ok: true }], ['nije pozvan search_mail']],
    ])('„calls": %s', (_, toolLog, failures) => {
        expect(checkReplay(next({ toolLog }), { why: 'P-067', calls: ['search_mail'] }, db(), WRITE)).toEqual(failures);
    });

    it.each([
        ['samo čitanje', ['work_report'], []],
        ['upis prošao', ['work_report', 'log_work', 'log_work'], ['upisao, a nije smio: log_work']],
    ])('„noWrites": %s', (_, tools, failures) => {
        expect(checkReplay(next({ tools }), { why: 'P-071', noWrites: true }, db(), WRITE)).toEqual(failures);
    });

    it('pokušan pa odbijen upis (čuvar pitanja) nije upis', () => {
        const n = next({ tools: ['work_report'], toolLog: [{ name: 'work_report', ok: true }, { name: 'log_work', ok: false, error: 'Pitanje ne upisuje.' }] });
        expect(checkReplay(n, { why: 'P-071', noWrites: true }, db(), WRITE)).toEqual([]);
    });

    it.each([
        ['dugme bez dijakritike', { buttons: ['➕ Nalog: Noćni ormarići (2 proizvoda)', 'Preskoči'] }, ['nalog: nocni ormari'], [], []],
        ['tekst odgovora, velika slova', { reply: 'NOĆNI ORMARIĆI su upisani' }, ['nocni ormari'], [], []],
        ['nema traženog', { reply: 'Upisano na uzglavlja.' }, ['nocni ormari'], [], ['odgovor nema „nocni ormari"']],
        ['ima zabranjeno', { reply: 'Ne mogu sam napraviti novi nalog.' }, [], ['ne mogu sam napraviti'], ['odgovor sadrži „ne mogu sam napraviti"']],
    ])('odgovor i dugmad: %s', (_, over, replyHas, replyNot, failures) => {
        expect(checkReplay(next(over as Partial<ReplayNext>), { why: 'P-070', replyHas, replyNot }, db(), WRITE)).toEqual(failures);
    });

    it('greška alata i ishod', () => {
        const n = next({ outcome: 'failed', toolLog: [{ name: 'read_mail_pdf', ok: false, error: 'Nepoznat alat read_mail_pdf.' }] });
        expect(checkReplay(n, { why: 'P-066', errorsNot: ['nepoznat alat'], outcomeNot: ['failed', 'degraded'] }, db(), WRITE))
            .toEqual(['ishod failed', 'read_mail_pdf: greška „nepoznat alat"']);
    });

    describe('Knjiga rada poslije poruke', () => {
        const logs = db([
            { worker: 'Amer Testić', order: 'Hotel na brdu - Noćni ormarići', date: '2026-11-11' },
            { worker: 'Edin Primjer', order: 'Hotel na brdu - Uzglavlja', date: '2026-11-11' },
            { worker: 'Edin Primjer', order: 'Hotel na brdu - Uzglavlja', date: '2026-11-10' },
            { worker: 'Senad Probni', order: 'Razne popravke', date: '2026-11-11' },
        ]);
        it.each([
            ['na pravom nalogu', { worker: 'amer', date: '2026-11-11', order: 'nocni ormari' }, []],
            ['nije na traženom nalogu', { worker: 'edin', date: '2026-11-11', order: 'nocni ormari' }, ['edin 2026-11-11 nije na „nocni ormari"']],
            ['na zabranjenom nalogu', { worker: 'edin', date: '2026-11-11', orderNot: 'uzglavlja' }, ['edin 2026-11-11 upisan na „Hotel na brdu - Uzglavlja"']],
            ['zabranjeni nalog drugi dan ne smeta', { worker: 'amer', date: '2026-11-10', orderNot: 'uzglavlja' }, []],
        ])('%s', (_, rule, failures) => {
            expect(checkReplay(next(), { why: 'P-068', logs: [rule] }, logs, WRITE)).toEqual(failures);
        });

        it('„ostali kao jučer": najmanje N različitih radnika za dan', () => {
            expect(checkReplay(next(), { why: 'P-069', logsMin: { date: '2026-11-11', workers: 3 } }, logs, WRITE)).toEqual([]);
            expect(checkReplay(next(), { why: 'P-069', logsMin: { date: '2026-11-11', workers: 4 } }, logs, WRITE))
                .toEqual(['upisano 3 radnika za 2026-11-11, treba bar 4']);
        });
    });
});

describe('gradnja skupa', () => {
    it('snimak prije poruka: ispadaju dokumenti nastali od tog trenutka, ostali ostaju', () => {
        const snap = {
            'work_logs/a': { Date: '2026-11-10', Created_At: '2026-11-10T15:00:00.000Z' },
            'work_logs/b': { Date: '2026-11-11', Created_At: '2026-11-11T06:43:40.000Z' },
            'work_orders/n': { Name: 'Razne popravke', Created_Date: '2026-11-11T06:43:39.000Z' },
            'work_orders/o': { Name: 'Kuhinja', Created_Date: '2026-10-01T08:00:00.000Z' },
            'projects/p': { Name: 'Bez datuma' },
        };
        const { snapshot, dropped } = cutSnapshot(snap, '2026-11-11T06:40:00Z');
        expect(Object.keys(snapshot).sort()).toEqual(['projects/p', 'work_logs/a', 'work_orders/o']);
        expect(dropped).toEqual({ work_logs: 1, work_orders: 1 });
    });

    it('poruke se dodaju po ID-u ili početku ID-a, bez duplikata, redom vremena; nepoznat ID se javlja', () => {
        const source = [{ id: 'aaa111', at: '2026-11-10T10:00' }, { id: 'bbb222', at: '2026-11-11T07:00' }, { id: 'ccc333', at: '2026-11-11T06:00' }];
        const out = mergeEntries([{ id: 'bbb222', at: '2026-11-11T07:00' }], source, ['ccc', 'bbb222', 'zzz']);
        expect(out.entries.map(e => e.id)).toEqual(['ccc333', 'bbb222']);
        expect(out.missing).toEqual(['zzz']);
    });

    it('provjere: postojeće se ne diraju, nova poruka dobija prazan „why"; carry ostaje', () => {
        const prev = { carry: true, checks: { a: { why: 'P-071', noWrites: true } } };
        expect(mergeExpect(prev, ['a', 'b'])).toEqual({ carry: true, checks: { a: { why: 'P-071', noWrites: true }, b: { why: '' } } });
        expect(mergeExpect(null, ['x'])).toEqual({ checks: { x: { why: '' } } });
    });

    it('izvještaj: koliko prolazi, a za palu poruku zašto je u skupu i šta nije prošlo', () => {
        const md = skupReport([
            { group: '2026-11-11', id: 'aaaa1111-x', text: 'Na kojim nalozima rade Amer i Edin danas', why: 'P-071', failures: ['upisao, a nije smio: log_work'] },
            { group: '2026-11-11', id: 'bbbb2222-x', text: 'Ovi ostali rade kao jučer', why: 'P-069', failures: [] },
        ]);
        expect(md).toContain('# Stalni skup: 1 od 2 prolazi');
        expect(md).toContain('**2026-11-11 · aaaa1111** (P-071)');
        expect(md).toContain('  - upisao, a nije smio: log_work');
        expect(md).not.toContain('bbbb2222');
    });
});
