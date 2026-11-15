/**
 * @jest-environment node
 */
// Revizija 14.11.2026 (P-076, P-077, P-081, P-083) — principi, izmišljena imena:
//   1. dan rada čita ERP iz poruke; dan po imenu je zadnji takav dan (rad se upisuje unazad)
//   2. rok ili plan („do petka", „za utorak") nije dan rada; dva dana = ERP ne bira
//   3. „i jučer su isto" je ponavljanje zadnjeg upisa, ne dan ostatka poruke
//   4. „sto" bez kvačice je stol samo kad nije upitna ili vezna riječ
//   5. interni nazivi (W3, „alat je odbio") ne idu korisniku
import { repeatDay, saidWorkDay, saidWorkDays } from '@/lib/assistant/workDay';
import { orderMentioned } from '@/lib/assistant/grounding';
import { leaksInternals, sanitizeModelText } from '@/lib/assistant/replyText';
import { messageIntent } from '@/lib/assistant/intent';

const SAT = '2026-11-14';   // subota
const workers = [{ id: 'amer', name: 'Amer Hodžić' }, { id: 'edin', name: 'Edin Begić' }];

describe('dan rada iz poruke', () => {
    it.each([
        ['Amer i Edin su u petak radili stolove za Hamzu', '2026-11-13'],
        ['Amer i Edin su jucer radili stolove', '2026-11-13'],
        ['prekjučer je Amer krojio iveral', '2026-11-12'],
        ['Amer danas radi kuhinju', SAT],
        ['u srijedu su radili na terenu', '2026-11-11'],
        ['U SUBOTU je Edin lakirao', SAT],
        ['Amer je 12.11. radio na vratima', '2026-11-12'],
        ['Amer je 3.11.2026 radio na vratima', '2026-11-03'],
        ['u nedjelju su montirali', '2026-11-08'],
    ])('„%s" → %s', (text, day) => expect(saidWorkDay(text, SAT, workers)).toBe(day));

    it.each([
        ['Amer radi kuhinju za Hamzu', 'dan nije rečen'],
        ['Amer je jučer i danas radio na ormarićima', 'dva dana'],
        ['Amer radi kuhinju koja ide do petka', 'rok'],
        ['Edin sprema vrata za utorak', 'plan'],
        ['Amer kroji iveral za iduću srijedu', 'idući dan'],
        ['radili su cijelu nedjelju', 'sedmica, ne dan'],
        ['Amer sutra ide na teren', 'budući dan'],
    ])('„%s" → ERP ne bira (%s)', text => expect(saidWorkDay(text, SAT, workers)).toBeNull());

    it('datum bez godine koji još nije došao je prošlogodišnji; budući dani ne ulaze', () => {
        expect(saidWorkDays('Amer je 20.12. radio na vratima', SAT)).toEqual(['2025-12-20']);
        expect(saidWorkDays('jučer i danas', SAT)).toEqual(['2026-11-13', SAT]);
    });
});

describe('ponavljanje zadnjeg upisa za drugi dan', () => {
    it.each([
        ['i jučer su isto', '2026-11-13'],
        ['I u petak isto stavi', '2026-11-13'],
        ['isto i za jučer', '2026-11-13'],
        ['isto tako i prekjučer', '2026-11-12'],
        ['i u srijedu su radili isto', '2026-11-11'],
        ['takodje i jucer', '2026-11-13'],
    ])('„%s" → %s', (text, day) => expect(repeatDay(text, SAT, workers)?.date).toBe(day));

    it.each([
        'Ovi ostali danas rade kao i jučer',
        'svi ostali isto',
        'Amer isto kao jučer',
        'danas je isto kao jučer',
        'Amer i Edin su u petak radili stolove',
        'isto',
    ])('„%s" → nije ponavljanje', text => expect(repeatDay(text, SAT, workers)).toBeNull());

    it('rečenica ponavljanja ne određuje dan ostatka poruke; poruka je upis rada i bez imena', () => {
        const text = 'i jučer su isto.\n\ndalje, Amer i Edin danas ne rade jer je vikend, ostali rade';
        expect(repeatDay(text, SAT, workers)).toMatchObject({ date: '2026-11-13', sentence: 'i jučer su isto' });
        expect(saidWorkDay(text, SAT, workers)).toBe(SAT);
        expect(messageIntent('i jučer su isto', workers, { dims: [], widths: [], locations: [] }).kinds).toContain('work');
        expect(messageIntent('jesu li i jučer radili isto?', workers, { dims: [], widths: [], locations: [] }).kinds).not.toContain('work');
    });
});

describe('„sto" bez kvačice', () => {
    const orders = [{ id: 'sto', name: 'Sto za Hamzu', aliases: [] }, { id: 'kuh', name: 'Lejla - Kuhinja', aliases: [] }];
    it.each([
        'Pa sto mi nisu bili ponuđeni gore u upisu',
        'Pa sto mo nisu bili pondudjeni gore u upisu',
        'zato sto je Amer bio na terenu',
        'ono sto su radili jučer',
        'sto se tiče Edina, on je na kuhinji',
        'sto prije završiti kuhinju',
    ])('„%s" → nije nalog', text => expect(orderMentioned(text, orders[0], orders)).toBe(false));

    it.each([
        'Amer i Edin su radili sto za Hamzu',
        'Amer je lakirao sto',
        'pa sto za Hamzu je gotov',
        'Edin na stolu za Hamzu',
    ])('„%s" → nalog', text => expect(orderMentioned(text, orders[0], orders)).toBe(true));
});

describe('interni nazivi ne idu korisniku', () => {
    it.each([
        'Ponovo ću pokušati kad mi potvrdiš tačna imena radnika (W# oznake) za ovaj upis.',
        'Nisam uspio upisati rad: alat je odbio oba poziva jer sam koristio pogrešna polja.',
        'Radnik W12 nije na listi.',
        'Upisao sam na R14.',
    ])('„%s"', s => expect(leaksInternals(s)).toBe(true));

    it.each([
        'Nalog 2026-11/R2 je napravljen.',
        'Amer je radio na vratima za Hamzu.',
        'Koji Senad je radio na kuhinji?',
        'Rezač W-200 je u kvaru.',
    ])('„%s" ostaje', s => expect(leaksInternals(s)).toBe(false));

    it('iz odgovora ispada samo rečenica s internim nazivom', () => {
        expect(sanitizeModelText('Amer je na kuhinji. Potvrdi mi W# oznake radnika.', { dropClaims: false })).toBe('Amer je na kuhinji.');
    });
});

describe('poređenje nije dan upisa', () => {
    it.each(['Haso isto kao jučer', 'Amer radi kao i jučer', 'Ovi ostali danas rade kao i u petak'])('„%s"', text => {
        expect(saidWorkDays(text, SAT, workers)).not.toContain('2026-11-13');
    });
    it('„danas rade kao i jučer" → danas', () => expect(saidWorkDay('Ovi ostali danas rade kao i jučer', SAT, workers)).toBe(SAT));
});
