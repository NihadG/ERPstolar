/**
 * @jest-environment node
 */
// Ponavljajući podsjetnik (P-033): ponavljanje rečeno u poruci čita ERP, ne model;
// tick poslije slanja zakaže sljedeći termin u isto lokalno vrijeme.
import { firstOccurrence, matchesDay, nextOccurrence, parseRepeat, repeatLabel } from '@/lib/assistant/repeat';
import { afterSendPatch, reminderButtons } from '@/lib/assistant/reminders';
import { STOP_REPEAT_SAID } from '@/lib/assistant/tools';
import { resolveReminderAt, toZoned } from '@/lib/assistant/datetime';
import { foldText } from '@/lib/voice/text';

jest.mock('@/lib/server/firebaseAdmin', () => ({ adminDb: jest.fn() }));

const TZ = 'Europe/Sarajevo';
// Ponedjeljak 9.11.2026. u 10:00 po lokalnom vremenu.
const MON_10 = new Date('2026-11-09T09:00:00Z');
const local = (iso: string | null) => (iso ? `${toZoned(iso, TZ).date} ${toZoned(iso, TZ).time}` : null);

describe('prepoznavanje ponavljanja', () => {
    it.each([
        ['Napomeni me svaki dan u 7 da popijem tablete', 'day'],
        ['podsjeti me svakog dana u 15h', 'day'],
        ['svako jutro u 6:45 provjeri šihtaricu', 'day'],
        ['napomeni me svakodnevno u 14:30', 'day'],
        ['napomeni me radnim danima u 7 da otključam halu', 'workday'],
        ['svaki radni dan u 16h podsjeti me za upis rada', 'workday'],
        ['od ponedjeljka do petka u 8 napomeni me', 'workday'],
        ['napomeni me svake sedmice', 'week'],
        ['sedmično podsjeti za kontrolu viljuškara', 'week'],
        ['svaki mjesec podsjeti me za platu', 'month'],
        ['mjesečno napomeni me da platim struju', 'month'],
    ])('„%s" → %s', (text, every) => {
        expect(parseRepeat(text, '07:00', '2026-11-10')?.Every).toBe(every);
    });

    it.each([
        ['svakog petka u 9 podsjeti me za sastanak', [5]],
        ['napomeni me petkom u 13h', [5]],
        ['svaki ponedeljak napomeni me za narudžbu', [1]],
        ['ponedjeljkom i četvrtkom u 7 podsjeti me za kombi', [1, 4]],
        ['svake srijede i petka podsjeti me', [3, 5]],
        ['nedjeljom navečer podsjeti me za plan sedmice', [0]],
    ])('„%s" → dani %j', (text, days) => {
        const r = parseRepeat(text, '09:00', '2026-11-13');
        expect(r).toEqual({ Every: 'week', Time: '09:00', Days: days });
    });

    it.each([
        'napomeni me sutra u 7',
        'u petak u 9 podsjeti me za sastanak',
        'svaki komad provjeriti prije utovara, podsjeti me u 14',
        'svaki stan u E lameli obići, napomeni me sutra',
        'podsjeti me u ponedjeljak da naručim iveral',
        'dnevnice za Amera upisati sutra u 8',
    ])('nije ponavljanje: „%s"', text => {
        expect(parseRepeat(text, '07:00', '2026-11-10')).toBeNull();
    });

    it('sedmično bez dana → dan prvog termina; mjesečno → dan u mjesecu', () => {
        expect(parseRepeat('svake sedmice', '08:00', '2026-11-13')).toEqual({ Every: 'week', Time: '08:00', Days: [5] });
        expect(parseRepeat('svaki mjesec', '08:00', '2026-11-15')).toEqual({ Every: 'month', Time: '08:00', Day_Of_Month: 15 });
    });
});

describe('termini', () => {
    it('svaki dan u 7, rečeno u 10h → prvi sutra u 7, pa prekosutra', () => {
        const text = 'napomeni me svaki dan u 7';
        const r = resolveReminderAt({ text, now: MON_10, tz: TZ })!;
        const rep = parseRepeat(text, r.time, r.date)!;
        const first = firstOccurrence(rep, r.iso, TZ)!;
        expect(local(first)).toBe('2026-11-10 07:00');
        expect(local(nextOccurrence(rep, new Date(first), TZ))).toBe('2026-11-11 07:00');
    });

    it('radnim danima: petak → ponedjeljak; rečeno u subotu → ponedjeljak', () => {
        const rep = { Every: 'workday' as const, Time: '07:00' };
        const friday7 = new Date('2026-11-13T06:00:00Z');
        expect(local(nextOccurrence(rep, friday7, TZ))).toBe('2026-11-16 07:00');
        // Subota 14.11. u 7 (razriješeno „sutra u 7" u petak) nije radni dan → ponedjeljak.
        expect(local(firstOccurrence(rep, '2026-11-14T06:00:00.000Z', TZ))).toBe('2026-11-16 07:00');
    });

    it('ponedjeljkom i četvrtkom: pon → čet → pon', () => {
        const rep = { Every: 'week' as const, Time: '07:00', Days: [1, 4] };
        const mon = nextOccurrence(rep, MON_10, TZ)!;
        expect(local(mon)).toBe('2026-11-12 07:00');
        expect(local(nextOccurrence(rep, new Date(mon), TZ))).toBe('2026-11-16 07:00');
    });

    it('mjesečno 31. → zadnji dan kraćeg mjeseca', () => {
        const rep = { Every: 'month' as const, Time: '08:00', Day_Of_Month: 31 };
        expect(matchesDay(rep, '2026-11-30')).toBe(true);
        expect(local(nextOccurrence(rep, new Date('2026-12-01T00:00:00Z'), TZ))).toBe('2026-12-31 08:00');
    });

    it('isto lokalno vrijeme i preko promjene sata (DST)', () => {
        const rep = { Every: 'day' as const, Time: '07:00' };
        // 28.3.2027 → 29.3.2027 (ljetno računanje od 28.3.)
        expect(local(nextOccurrence(rep, new Date('2027-03-28T06:00:00Z'), TZ))).toBe('2027-03-29 07:00');
    });
});

describe('slanje', () => {
    it('jednokratni se gasi; ponavljajući ostaje na čekanju sa sljedećim terminom', () => {
        expect(afterSendPatch({}, MON_10, TZ)).toEqual({ Reminder_Pending: false, Reminder_Sent_At: MON_10.toISOString() });
        const p = afterSendPatch({ Reminder_Repeat: { Every: 'day', Time: '07:00' } }, MON_10, TZ);
        expect(p.Reminder_Pending).toBe(true);
        expect(local(p.Reminder_At as string)).toBe('2026-11-10 07:00');
    });

    it('odgođen (za sat) ne pomjera raspored: sljedeći je opet u 07:00', () => {
        const snoozed = new Date('2026-11-09T07:00:00Z'); // 08:00 lokalno, poslije odgode
        const p = afterSendPatch({ Reminder_Repeat: { Every: 'day', Time: '07:00' } }, snoozed, TZ);
        expect(local(p.Reminder_At as string)).toBe('2026-11-10 07:00');
    });

    it('ponavljajući ima dugme za gašenje, jednokratni nema', () => {
        expect(JSON.stringify(reminderButtons('t1', true))).toContain('rpoff:t1');
        expect(JSON.stringify(reminderButtons('t1'))).not.toContain('rpoff');
    });

    it('oznake', () => {
        expect(repeatLabel({ Every: 'week', Time: '07:00', Days: [4, 1] })).toBe('ponedjeljkom i četvrtkom');
        expect(repeatLabel({ Every: 'week', Time: '07:00', Days: [0, 5, 1] })).toBe('ponedjeljkom, petkom i nedjeljom');
        expect(repeatLabel({ Every: 'workday', Time: '07:00' })).toBe('radnim danima');
    });
});

describe('gašenje mora biti rečeno', () => {
    it.each(['prestani me podsjećati za tablete', 'ne ponavljaj više', 'više ne treba taj podsjetnik', 'ugasi podsjetnik za struju', 'nemoj više'])('„%s"', t => {
        expect(STOP_REPEAT_SAID.test(foldText(t))).toBe(true);
    });
    it.each(['pomjeri podsjetnik za tablete na 8', 'promijeni vrijeme na 9'])('nije gašenje: „%s"', t => {
        expect(STOP_REPEAT_SAID.test(foldText(t))).toBe(false);
    });
});
