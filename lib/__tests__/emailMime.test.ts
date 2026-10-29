/**
 * @jest-environment node
 */
import { buildMime, encodeWord, formatMailbox, headerSafe, toBase64Url, wrap76 } from '../email/mime';
import { parseAddressList, parseMailbox } from '../email/addresses';

/** Spoji susjedne encoded-word riječi (preklopljen red) pa ih dekodiraj. */
const decodeWords = (header: string) => header
    .replace(/\?=\r\n =\?UTF-8\?B\?/g, '?==?UTF-8?B?')
    .replace(/=\?UTF-8\?B\?([^?]+)\?=/g, (_, b) => Buffer.from(b, 'base64').toString('utf8'));

describe('zaglavlja', () => {
    it('ASCII ostaje kakav jeste, ostalo ide kao UTF-8 encoded-word', () => {
        expect(encodeWord('Narudzba ogledala')).toBe('Narudzba ogledala');
        const enc = encodeWord('Narudžba ogledala Park Plaza LUXCO');
        expect(enc).toMatch(/^=\?UTF-8\?B\?/);
        expect(decodeWords(enc)).toBe('Narudžba ogledala Park Plaza LUXCO');
    });

    it('dug naslov se dijeli na riječi ≤ 75 znakova i ne cijepa slova', () => {
        const long = 'Šćepanović ' + 'čćžšđ '.repeat(30);
        const enc = encodeWord(long);
        enc.split('\r\n ').forEach(w => expect(w.length).toBeLessThanOrEqual(75));
        expect(decodeWords(enc)).toBe(headerSafe(long));
    });

    it('novi red ne može ubaciti zaglavlje', () => {
        expect(headerSafe('Ponuda\r\nBcc: napadac@x.example')).toBe('Ponuda Bcc: napadac@x.example');
        const mime = buildMime({ to: [{ email: 'a@x.example' }], subject: 'Hej\nBcc: b@x.example', text: 'x' });
        expect(mime.split('\r\n').some(l => l.startsWith('Bcc:'))).toBe(false);
    });

    it('ime s kvačicama i navodnicima u adresi', () => {
        expect(formatMailbox({ name: 'Emir Hadzic', email: 'E@x.example' })).toBe('"Emir Hadzic" <E@x.example>');
        expect(decodeWords(formatMailbox({ name: 'Emir Hadžić', email: 'e@x.example' }))).toBe('Emir Hadžić <e@x.example>');
        expect(formatMailbox({ name: 'Zli "x"', email: 'e@x.example' })).toBe('"Zli x" <e@x.example>');
        expect(formatMailbox({ email: 'e@x.example' })).toBe('e@x.example');
    });
});

describe('poruka', () => {
    const pdf = new Uint8Array(Array.from({ length: 300 }, (_, i) => i % 256));

    it('samo tekst: jedan dio, base64 UTF-8', () => {
        const mime = buildMime({
            from: { name: 'Ured', email: 'ured@x.example' },
            to: [{ name: 'Amra Delić', email: 'amra@staklo.example' }],
            cc: [{ email: 'kopija@x.example' }],
            subject: 'Narudžba', text: 'Pozdrav Amra,\n\nU prilogu je narudžba.',
        }, { date: new Date('2026-10-29T10:00:00Z') });
        expect(mime).toContain('From: "Ured" <ured@x.example>');
        expect(mime).toContain('Cc: kopija@x.example');
        expect(mime).toContain('Date: Thu, 29 Oct 2026 10:00:00 +0000');
        expect(mime).toContain('Content-Type: text/plain; charset="UTF-8"');
        const body = mime.split('\r\n\r\n')[1];
        expect(Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8')).toBe('Pozdrav Amra,\n\nU prilogu je narudžba.');
    });

    it('s prilogom: multipart, ime fajla po RFC 2231, sadržaj netaknut', () => {
        const mime = buildMime({
            to: [{ email: 'a@x.example' }], subject: 'Narudžba', text: 'Tekst',
            attachments: [{ filename: 'Narudžba ogledala LUXCO.pdf', contentType: 'application/pdf', data: pdf }],
        }, { boundary: 'B1' });
        expect(mime).toContain('Content-Type: multipart/mixed; boundary="B1"');
        expect(mime).toContain(`filename="Narudzba ogledala LUXCO.pdf"; filename*=UTF-8''${encodeURIComponent('Narudžba ogledala LUXCO.pdf')}`);
        expect(mime.trimEnd().endsWith('--B1--')).toBe(true);
        const part = mime.split('--B1\r\n')[2];
        const b64 = part.split('\r\n\r\n')[1].replace(/--B1--[\s\S]*$/, '').replace(/\r\n/g, '');
        expect(Array.from(Buffer.from(b64, 'base64'))).toEqual(Array.from(pdf));
        part.split('\r\n\r\n')[1].split('\r\n').filter(Boolean).forEach(l => expect(l.length).toBeLessThanOrEqual(76));
    });

    it('odgovor u niti nosi In-Reply-To i References', () => {
        const mime = buildMime({ to: [{ email: 'a@x.example' }], subject: 'Re: Predračun', text: 'Potvrđujem.', inReplyTo: '<abc@mail.gmail.com>' });
        expect(mime).toContain('In-Reply-To: <abc@mail.gmail.com>');
        expect(mime).toContain('References: <abc@mail.gmail.com>');
    });

    it('bez primaoca se ne gradi', () => {
        expect(() => buildMime({ to: [], subject: 'x', text: 'y' })).toThrow();
    });

    it('raw za Gmail je base64url bez paddinga', () => {
        const raw = toBase64Url('Šta ćeš?>>>');
        expect(raw).not.toMatch(/[+/=]/);
        expect(Buffer.from(raw, 'base64url').toString('utf8')).toBe('Šta ćeš?>>>');
        expect(wrap76('a'.repeat(160)).split('\r\n').map(l => l.length)).toEqual([76, 76, 8]);
    });
});

describe('adrese iz zaglavlja', () => {
    it('lista s imenima, navodnicima i zarezom u imenu', () => {
        expect(parseAddressList('"Hadžić, Emir" <Emir@X.example>, Amra <amra@y.example>; info@z.example, nije-adresa')).toEqual([
            { name: 'Hadžić, Emir', email: 'emir@x.example' },
            { name: 'Amra', email: 'amra@y.example' },
            { email: 'info@z.example' },
        ]);
    });

    it('ime jednako adresi se izbacuje', () => {
        expect(parseMailbox('a@x.example <a@x.example>')).toEqual({ email: 'a@x.example' });
        expect(parseAddressList('')).toEqual([]);
    });
});
