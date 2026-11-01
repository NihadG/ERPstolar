import {
    appBaseUrl, chatCardButtons, chatCardText, chatChannelOf, cleanChatText, isMobile, matchDiacritics, normalizePhone, sendTimeSaid, viberPageUrl, whatsappUrl,
} from '@/lib/assistant/chatMessage';
import { messageIntent } from '@/lib/assistant/intent';
import type { TaskChatMessage } from '@/lib/types';

const facts = { dims: [], widths: [], locations: [] };

describe('broj telefona', () => {
    it('domaći, sa +, sa 00 i s razmacima', () => {
        expect(normalizePhone('061 234 567')).toBe('38761234567');
        expect(normalizePhone('+387 62 123-456')).toBe('38762123456');
        expect(normalizePhone('00387 33 444 555')).toBe('38733444555');
        expect(normalizePhone('')).toBeNull();
        expect(normalizePhone('12')).toBeNull();
    });
    it('fiksni broj nije za Viber/WhatsApp', () => {
        expect(isMobile('38761234567')).toBe(true);
        expect(isMobile('38733444555')).toBe(false);
        expect(isMobile('4915112345678')).toBe(true);
    });
});

describe('tekst poruke u korisnikovom stilu', () => {
    it('kvačice samo kad ih korisnik piše', () => {
        expect(matchDiacritics('Možeš li mi poručiti baglame? Hvala.', 'posalji poruku zaimu na viber, naruci baglame'))
            .toBe('Mozes li mi poruciti baglame? Hvala.');
        expect(matchDiacritics('Možeš li mi poručiti baglame?', 'pošalji poruku Zaimu, naruči baglame'))
            .toBe('Možeš li mi poručiti baglame?');
    });
    it('bez potpisa i pozdrava s kraja maila', () => {
        expect(cleanChatText('Pozdrav Zaime, treba mi 50 baglama. Hvala.\n\nSrdačno,')).toBe('Pozdrav Zaime, treba mi 50 baglama. Hvala.');
        expect(cleanChatText('Sakibe, mozes poruciti kolone.\n\nHvala.')).toBe('Sakibe, mozes poruciti kolone. Hvala.');
    });
    it('kanal: rečen ili viber', () => {
        expect(chatChannelOf(undefined, 'javi Kerimu na whatsapp')).toBe('whatsapp');
        expect(chatChannelOf(undefined, 'posalji poruku Zaimu')).toBe('viber');
        expect(chatChannelOf('whatsapp', 'viber')).toBe('whatsapp');
    });
});

describe('kad poslati', () => {
    it('vrijeme prije sadržaja je vrijeme slanja', () => {
        expect(sendTimeSaid('posalji poruku zaimu na viber sutra u 10, naruci baglame')).toBe(true);
        expect(sendTimeSaid('Posalji poruku Emiru u ponedjeljak u 9 da ne mozemo stici napraviti vrata')).toBe(true);
        expect(sendTimeSaid('Sutra u 8 pošalji Zaimu poruku: trebaju mi vodilice')).toBe(true);
    });
    it('vrijeme u sadržaju nije vrijeme slanja', () => {
        expect(sendTimeSaid('Javi Kerimu na whatsapp da sutra dodje u 7')).toBe(false);
        expect(sendTimeSaid('posalji poruku zaimu: treba mi do petka')).toBe(false);
        expect(sendTimeSaid('posalji poruku Merimi da li su gotova ogledala')).toBe(false);
    });
});

describe('linkovi', () => {
    it('WhatsApp s brojem i tekstom; bez mobilnog bira se u aplikaciji', () => {
        expect(whatsappUrl('Pozdrav, hvala.', '38761234567')).toBe('https://wa.me/38761234567?text=Pozdrav%2C%20hvala.');
        expect(whatsappUrl('Hvala', '38733444555')).toBe('https://wa.me/?text=Hvala');
    });
    it('Viber ide preko stranice, tekst iza #', () => {
        expect(viberPageUrl('https://erp.example/', 'Hvala', '38761234567')).toBe('https://erp.example/poruka.html#n=38761234567&t=Hvala');
        expect(viberPageUrl('https://erp.example', 'Hvala')).toBe('https://erp.example/poruka.html#t=Hvala');
    });
    it('javna adresa', () => {
        expect(appBaseUrl({ APP_BASE_URL: 'https://a.example' })).toBe('https://a.example');
        expect(appBaseUrl({ VERCEL_PROJECT_PRODUCTION_URL: 'erp.example' })).toBe('https://erp.example');
        expect(appBaseUrl({})).toBe('');
    });
});

describe('kartica', () => {
    const msg: TaskChatMessage = { Channel: 'viber', To_Name: 'Zaim Begić (Okovi)', Phone: '38761234567', Text: 'Pozdrav Zaime, mozes li mi poruciti baglame? Hvala.' };
    it('tekst i uputa', () => {
        const t = chatCardText(msg);
        expect(t).toContain('💬 Viber → Zaim Begić (Okovi)');
        expect(t).toContain('mozes li mi poruciti baglame');
        expect(chatCardText({ ...msg, Phone: undefined })).toContain('Nema mobilnog broja');
    });
    it('traženi kanal prvi, kopiraj, poslano / za sat', () => {
        const rows = chatCardButtons(msg, 'T1', 'https://erp.example');
        expect(rows[0].map(b => b.text)).toEqual(['🟣 Viber', '🟢 WhatsApp']);
        expect(rows[0][0].url).toContain('/poruka.html#n=38761234567');
        expect(rows[1][0].copy).toBe(msg.Text);
        expect(rows[2].map(b => b.data)).toEqual(['done:T1', 'snz:T1:1h']);
        const wa = chatCardButtons({ ...msg, Channel: 'whatsapp' }, 'T1', 'https://erp.example');
        expect(wa[0][0].text).toBe('🟢 WhatsApp');
    });
    it('bez javne adrese nema Viber dugmeta, kopiraj ostaje', () => {
        const rows = chatCardButtons(msg, 'T1', '');
        expect(rows[0].map(b => b.text)).toEqual(['🟢 WhatsApp']);
        expect(rows[1][0].text).toBe('📋 Kopiraj tekst');
    });
});

describe('vrsta poruke', () => {
    it('Viber poruka sa vremenom i narudžbom je jedna poruka, ne narudžba', () => {
        const i = messageIntent('posalji poruku zaimu na viber sutra u 10, naruci baglame', [], facts);
        expect(i.kinds).toEqual(['chat']);
        expect(i.expectsWrite).toBe(true);
        expect(i.times).toEqual(expect.arrayContaining(['10:00', 'sutra']));
    });
    it('„pošalji poruku Kerimu" bez kanala je poruka', () => {
        expect(messageIntent('Pošalji poruku Kerimu da dođe ranije', [], facts).kinds).toEqual(['chat']);
    });
    it('„napiši mi poruku" je podsjetnik meni', () => {
        expect(messageIntent('Napisi mi u 00:01 poruku za laku noc', [], facts).kinds).not.toContain('chat');
    });
});
