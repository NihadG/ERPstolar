import {
    findTimeMention, formatReminder, resolveReminderAt, toZoned, zonedToUtcMs,
} from '@/lib/assistant/datetime';

const TZ = 'Europe/Sarajevo';
// Petak 23.10.2026, 14:05 po Sarajevu (CEST, UTC+2). Sat se pomjera u nedjelju 25.10.
const NOW = new Date('2026-10-23T12:05:00Z');

const at = (text: string, modelLocal?: string) => resolveReminderAt({ text, now: NOW, tz: TZ, modelLocal });

describe('zone', () => {
    it('lokalno vrijeme iz UTC-a', () => {
        expect(toZoned(NOW, TZ)).toMatchObject({ date: '2026-10-23', time: '14:05' });
    });

    it('preračun poštuje prelazak na zimsko vrijeme', () => {
        expect(new Date(zonedToUtcMs('2026-10-24', 8, 0, TZ)).toISOString()).toBe('2026-10-24T06:00:00.000Z');
        expect(new Date(zonedToUtcMs('2026-10-26', 8, 0, TZ)).toISOString()).toBe('2026-10-26T07:00:00.000Z');
    });
});

describe('findTimeMention', () => {
    it.each([
        ['u 15:30 zovi dobavljača', 15, 30],
        ['sutra u 7', 7, 0],
        ['u 3 kaži radniku', 15, 0],
        ['u 8 sati', 8, 0],
        ['u osam ujutro', 8, 0],
        ['u 7 navečer', 19, 0],
        ['poslije podne', 15, 0],
        ['u podne', 12, 0],
        ['16h', 16, 0],
    ])('%s', (text, hour, minute) => {
        expect(findTimeMention(text)).toMatchObject({ hour, minute });
    });

    it('relativno vrijeme', () => {
        expect(findTimeMention('za 2 sata')?.relativeMinutes).toBe(120);
        expect(findTimeMention('za pola sata')?.relativeMinutes).toBe(30);
        expect(findTimeMention('za 20 minuta')?.relativeMinutes).toBe(20);
    });

    it.each([
        'u stanu 304 imam 3 ogledala od 1 m dužine',
        'stavi u 2 kombija',
        'naruči do 5 komada',
        'rok do 20. novembra',
        'u ponedjeljak naručiti 10 baglama',
    ])('nije sat: %s', text => {
        expect(findTimeMention(text)).toBeNull();
    });
});

describe('resolveReminderAt', () => {
    it('samo dan → 08:00 tog dana (zimsko vrijeme)', () => {
        expect(at('u ponedjeljak naručiti 10 baglama')).toEqual({
            iso: '2026-10-26T07:00:00.000Z', date: '2026-10-26', time: '08:00',
        });
    });

    it('dan i sat iz teksta', () => {
        expect(at('sutra u 7 kaži Ameru')?.iso).toBe('2026-10-24T05:00:00.000Z');
    });

    it('sat koji je danas prošao ide na sutra', () => {
        expect(at('u 7 ujutro')?.iso).toBe('2026-10-24T05:00:00.000Z');
    });

    it('sat koji danas tek dolazi ostaje danas', () => {
        expect(at('u 3 kaži radniku')?.iso).toBe('2026-10-23T13:00:00.000Z');
    });

    it('relativno od sada', () => {
        expect(at('za 2 sata')?.iso).toBe('2026-10-23T14:05:00.000Z');
    });

    it('„danas" kad je jutro prošlo → za pola sata', () => {
        expect(at('danas naruči baglame')?.iso).toBe('2026-10-23T12:35:00.000Z');
    });

    it('tekst bez vremena → prijedlog modela', () => {
        expect(at('Drugo', '2026-10-27T10:30')?.iso).toBe('2026-10-27T09:30:00.000Z');
    });

    it('tekst pobjeđuje model kad se dan ne slaže', () => {
        expect(at('u ponedjeljak', '2026-10-27T09:00')?.date).toBe('2026-10-26');
    });

    it('nema ni dana ni sata → null', () => {
        expect(at('kaži radniku za ogledala')).toBeNull();
    });
});

describe('formatReminder', () => {
    it('kratki opis', () => {
        expect(formatReminder('2026-10-26T07:00:00.000Z', TZ, NOW)).toBe('pon 26.10. u 08:00');
        expect(formatReminder('2026-10-24T05:00:00.000Z', TZ, NOW)).toBe('sutra u 07:00');
        expect(formatReminder('2026-10-23T13:00:00.000Z', TZ, NOW)).toBe('danas u 15:00');
    });
});
