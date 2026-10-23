/**
 * @jest-environment node
 */
// Telegram tok bez mreže: Telegram API, transkripcija i mozak su zamijenjeni,
// Firestore je memorijski. Provjerava se ono što radi sam webhook:
// povezivanje kodom, zaštita od ponavljanja, dnevnik, glas, proslijeđeno,
// dugmad (odgovor na pitanje, urađeno, odgodi).

jest.mock('@/lib/server/firebaseAdmin', () => require('@/lib/testing/fakeFirestore').firebaseAdminMock);

const mockSent: { method: string; args: any[] }[] = [];
jest.mock('@/lib/telegram/api', () => {
    const rec = (method: string) => async (...args: any[]) => { mockSent.push({ method, args }); return { message_id: 1 }; };
    return {
        sendMessage: rec('sendMessage'),
        editMessageText: rec('editMessageText'),
        answerCallbackQuery: rec('answerCallbackQuery'),
        sendTyping: rec('sendTyping'),
        downloadFile: async () => ({ buffer: Buffer.alloc(5000), path: 'voice/file.oga' }),
    };
});

jest.mock('@/lib/voice/transcribeServer', () => ({
    transcribeAudio: jest.fn(async () => ({ ok: true, text: 'Sutra u 7 kaži Ameru za ogledala' })),
}));

const mockRun = jest.fn();
jest.mock('@/lib/assistant/brain', () => ({ runAssistant: (...a: any[]) => mockRun(...a) }));

import { fakeDocs, fakeStore } from '@/lib/testing/fakeFirestore';
import { handleTelegramUpdate } from '@/lib/assistant/telegramHandler';
import { toZoned } from '@/lib/assistant/datetime';
import { transcribeAudio } from '@/lib/voice/transcribeServer';

const USER = { id: 4242, first_name: 'Nihad' };
const CHAT = { id: 4242, type: 'private' };
let updateId = 100;
const msg = (extra: Record<string, unknown>) => ({
    update_id: ++updateId,
    message: { message_id: updateId, date: 1_793_000_000, chat: CHAT, from: USER, ...extra },
});
const lastText = () => {
    const m = [...mockSent].reverse().find(s => s.method === 'sendMessage' || s.method === 'editMessageText');
    return String(m?.method === 'sendMessage' ? m.args[1] : m?.args[2]);
};

beforeAll(() => {
    process.env.ASSISTANT_TIMEZONE = 'Europe/Sarajevo';
    fakeStore.set('workers/a', { Worker_ID: 'w-amer', Name: 'Amer Hodžić', Organization_ID: 'org1', Status: 'Aktivan' });
});

beforeEach(() => {
    mockSent.length = 0;
    mockRun.mockReset();
    mockRun.mockImplementation(async (input: any) => ({
        reply: `OK: ${input.text}`,
        buttons: [],
        created: { taskIds: ['t-x'], memoryIds: [] },
        session: { history: [...input.session.history, { role: 'user', text: input.text, at: 'x' }], pending: null },
    }));
});

describe('Telegram webhook', () => {
    it('nepovezan korisnik dobija samo uputstvo', async () => {
        await handleTelegramUpdate(msg({ text: 'u ponedjeljak baglame' }));
        expect(lastText()).toMatch(/Postavke → Telegram asistent/);
        expect(mockRun).not.toHaveBeenCalled();
        expect(fakeDocs('assistant_entries')).toHaveLength(0);
    });

    it('istekao kod ne povezuje', async () => {
        fakeStore.set('assistant_link_codes/OLD234', { uid: 'u1', orgId: 'org1', expiresAt: '2020-01-01T00:00:00Z' });
        await handleTelegramUpdate(msg({ text: '/start OLD234' }));
        expect(lastText()).toMatch(/nije važeći ili je istekao/);
        expect(fakeDocs('assistant_links')).toHaveLength(0);
    });

    it('/start KOD povezuje Telegram s ERP korisnikom i troši kod', async () => {
        fakeStore.set('assistant_link_codes/ABC234', { uid: 'u1', orgId: 'org1', expiresAt: new Date(Date.now() + 60_000).toISOString() });
        await handleTelegramUpdate(msg({ text: '/start abc234' }));
        expect(lastText()).toMatch(/Povezano/);
        expect(fakeStore.get('assistant_links/4242')).toMatchObject({ uid: 'u1', orgId: 'org1', chatId: 4242, telegramName: 'Nihad' });
        expect(fakeStore.has('assistant_link_codes/ABC234')).toBe(false);
    });

    it('isti update dvaput se obrađuje jednom', async () => {
        const u = msg({ text: 'nešto' });
        await handleTelegramUpdate(u);
        await handleTelegramUpdate(u);
        expect(mockRun).toHaveBeenCalledTimes(1);
    });

    it('tekst ide u dnevnik pa u mozak', async () => {
        await handleTelegramUpdate(msg({ text: 'U stanu 304 imam 3 ogledala' }));
        const entry = fakeDocs('assistant_entries').find(e => e.Raw_Text === 'U stanu 304 imam 3 ogledala');
        expect(entry).toMatchObject({ Kind: 'text', Owner_UID: 'u1', Organization_ID: 'org1', Channel: 'telegram', Task_IDs: ['t-x'] });
        expect(mockRun).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org1', uid: 'u1', text: 'U stanu 304 imam 3 ogledala', entryId: entry!.Entry_ID }));
    });

    it('glasovna poruka: transkript se prikaže i ide dalje kao tekst', async () => {
        await handleTelegramUpdate(msg({ voice: { file_id: 'VOICE1', duration: 3 } }));
        expect(transcribeAudio).toHaveBeenCalledWith(expect.objectContaining({ mime: 'audio/ogg', names: expect.arrayContaining(['Amer Hodžić']) }));
        expect(lastText()).toMatch(/^🎙 „Sutra u 7 kaži Ameru za ogledala"/);
        expect(fakeDocs('assistant_entries').some(e => e.Kind === 'voice' && e.Telegram_File_ID === 'VOICE1')).toBe(true);
    });

    it('proslijeđena poruka nosi radnika i vrijeme', async () => {
        await handleTelegramUpdate(msg({
            text: 'Montirali ogledala u 304',
            forward_origin: { type: 'hidden_user', date: 1_793_000_000, sender_user_name: 'Amer' },
        }));
        expect(mockRun).toHaveBeenCalledWith(expect.objectContaining({ forward: { from: 'Amer', date: new Date(1_793_000_000_000).toISOString() } }));
        expect(fakeDocs('assistant_entries').some(e => e.Kind === 'forward' && e.Forward_From === 'Amer')).toBe(true);
    });

    it('dugme s opcijom nastavlja razgovor i veže se za prvobitni unos', async () => {
        fakeStore.set('assistant_sessions/4242', {
            history: [{ role: 'user', text: 'kaži radniku', at: 'x' }, { role: 'model', text: 'Kojem?', at: 'x' }],
            pending: { question: 'Kojem?', options: ['Amer Hodžić', 'Edin'], askedAt: 'x', entryId: 'E-1' },
        });
        await handleTelegramUpdate({
            update_id: ++updateId,
            callback_query: { id: 'cb', from: USER, data: 'opt:0', message: { message_id: 9, date: 1, chat: CHAT, text: 'Kojem?' } },
        });
        expect(mockSent.find(s => s.method === 'editMessageText')?.args[2]).toBe('Kojem?\n→ Amer Hodžić');
        expect(mockRun).toHaveBeenCalledWith(expect.objectContaining({ text: 'Amer Hodžić', entryId: 'E-1' }));
    });

    it('✅ Urađeno zatvara zadatak i gasi podsjetnik', async () => {
        fakeStore.set('tasks/d1', { Task_ID: 't-1', Organization_ID: 'org1', Title: 'Naručiti baglame', Status: 'pending', Reminder_Pending: false });
        await handleTelegramUpdate({
            update_id: ++updateId,
            callback_query: { id: 'cb', from: USER, data: 'done:t-1', message: { message_id: 9, date: 1, chat: CHAT, text: '⏰ Naručiti baglame' } },
        });
        expect(fakeStore.get('tasks/d1')).toMatchObject({ Status: 'completed', Reminder_Pending: false });
        expect(lastText()).toBe('✅ Urađeno: Naručiti baglame');
    });

    it('🌅 Sutra u 8 pomjera podsjetnik na sutra 08:00 lokalno', async () => {
        fakeStore.set('tasks/d2', { Task_ID: 't-2', Organization_ID: 'org1', Title: 'Ogledala', Status: 'pending', Reminder_Pending: false });
        await handleTelegramUpdate({
            update_id: ++updateId,
            callback_query: { id: 'cb', from: USER, data: 'snz:t-2:tm', message: { message_id: 9, date: 1, chat: CHAT, text: '⏰ Ogledala' } },
        });
        const t = fakeStore.get('tasks/d2')!;
        expect(t.Reminder_Pending).toBe(true);
        expect(toZoned(t.Reminder_At, 'Europe/Sarajevo').time).toBe('08:00');
        expect(Date.parse(t.Reminder_At)).toBeGreaterThan(Date.now());
    });

    it('zadatak druge firme se ne može dirati', async () => {
        fakeStore.set('tasks/d3', { Task_ID: 't-3', Organization_ID: 'org2', Title: 'Tuđe', Status: 'pending' });
        await handleTelegramUpdate({
            update_id: ++updateId,
            callback_query: { id: 'cb', from: USER, data: 'done:t-3', message: { message_id: 9, date: 1, chat: CHAT, text: 'x' } },
        });
        expect(fakeStore.get('tasks/d3')!.Status).toBe('pending');
    });
});
