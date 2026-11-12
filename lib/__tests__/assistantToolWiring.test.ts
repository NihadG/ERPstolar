/**
 * @jest-environment node
 */
// Svaki alat koji model vidi mora imati izvršenje, i svaki skup alata smije imenovati samo
// postojeće alate. 10.11.2026: `read_mail_pdf` je bio u spisku, u uputi i u skupovima, a bez
// izvršenja — bot je na svaki PDF u prilogu javljao „Nepoznat alat" (P-066).

jest.mock('@/lib/server/firebaseAdmin', () => require('@/lib/testing/fakeFirestore').firebaseAdminMock);

import { DISPLAY_TOOLS, READ_TOOLS, TOOL_HANDLERS, TOOLS, WRITE_TOOLS, runTool, type ToolEnv } from '@/lib/assistant/tools';
import { ALL_TOOLS, EMAIL_TOOLS, QUESTION_EXTRA, toolsFor } from '@/lib/assistant/toolRouting';

const names = TOOLS.map(t => t.name);

describe('svaki alat ima izvršenje', () => {
    it.each(names)('%s', name => {
        expect(typeof TOOL_HANDLERS[name]).toBe('function');
    });

    it('nema izvršenja bez alata u spisku ni duplih naziva', () => {
        expect(Object.keys(TOOL_HANDLERS).filter(n => !names.includes(n))).toEqual([]);
        expect(new Set(names).size).toBe(names.length);
    });

    it('nepoznat naziv (i naziv iz prototipa) se odbija, ne ruši', async () => {
        const env = { summaries: [] } as unknown as ToolEnv;
        expect(await runTool(env, 'nema_takvog', {})).toEqual({ ok: false, error: 'Nepoznat alat nema_takvog.' });
        expect(await runTool(env, 'constructor', {})).toEqual({ ok: false, error: 'Nepoznat alat constructor.' });
    });
});

describe('skupovi imenuju samo postojeće alate', () => {
    it.each([
        ['READ_TOOLS', READ_TOOLS], ['WRITE_TOOLS', WRITE_TOOLS], ['DISPLAY_TOOLS', DISPLAY_TOOLS],
        ['EMAIL_TOOLS', EMAIL_TOOLS], ['QUESTION_EXTRA', QUESTION_EXTRA],
    ] as [string, Set<string>][])('%s', (_label, set) => {
        expect(Array.from(set).filter(n => !names.includes(n))).toEqual([]);
    });

    it('alat je ili čitanje ili upis (ask_user je pitanje nazad); čitanje PDF priloga je čitanje', () => {
        const neither = names.filter(n => !READ_TOOLS.has(n) && !WRITE_TOOLS.has(n));
        expect(neither).toEqual(['ask_user']);
        expect(names.filter(n => READ_TOOLS.has(n) && WRITE_TOOLS.has(n))).toEqual([]);
        expect(READ_TOOLS.has('read_mail_pdf')).toBe(true);
    });

    it('skup za pitanje i za mail vide čitanje PDF priloga i izlaz na sve alate', () => {
        for (const set of ['question', 'email'] as const) {
            const visible = toolsFor(set, TOOLS, READ_TOOLS).map(t => t.name);
            expect(visible).toContain('read_mail_pdf');
            expect(visible).toContain(ALL_TOOLS);
        }
    });
});
