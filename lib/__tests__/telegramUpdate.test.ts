import { normalizeUpdate, parseCommand, type TgUpdate } from '@/lib/telegram/update';

const base = { message_id: 7, date: 1_793_000_000, chat: { id: 55, type: 'private' }, from: { id: 99, first_name: 'Nihad', last_name: 'T' } };

describe('normalizeUpdate', () => {
    it('tekstualna poruka', () => {
        const inc = normalizeUpdate({ update_id: 1, message: { ...base, text: 'U ponedjeljak naručiti 10 baglama' } });
        expect(inc).toMatchObject({ type: 'message', chatId: 55, from: { id: 99, name: 'Nihad T' }, text: 'U ponedjeljak naručiti 10 baglama' });
        expect((inc as any).command).toBeUndefined();
    });

    it('glasovna poruka', () => {
        const inc = normalizeUpdate({ update_id: 2, message: { ...base, voice: { file_id: 'F1', duration: 4 } } });
        expect(inc).toMatchObject({ type: 'message', text: '', voice: { fileId: 'F1', mime: 'audio/ogg', duration: 4 } });
    });

    it('proslijeđeno od radnika (forward_origin user)', () => {
        const inc = normalizeUpdate({
            update_id: 3,
            message: {
                ...base, text: 'Montirali ogledala u 304',
                forward_origin: { type: 'user', date: 1_793_000_000, sender_user: { id: 5, first_name: 'Amer', last_name: 'Hodžić' } },
            },
        });
        expect(inc).toMatchObject({ type: 'message', forward: { from: 'Amer Hodžić', date: new Date(1_793_000_000_000).toISOString() } });
    });

    it('proslijeđeno od skrivenog korisnika', () => {
        const inc = normalizeUpdate({
            update_id: 4,
            message: { ...base, text: 'gotovo', forward_origin: { type: 'hidden_user', date: 1_793_000_000, sender_user_name: 'Edin' } },
        });
        expect((inc as any).forward.from).toBe('Edin');
    });

    it('proslijeđeni tekst s kosom crtom nije komanda', () => {
        const inc = normalizeUpdate({
            update_id: 5,
            message: { ...base, text: '/start ABC', forward_origin: { type: 'hidden_user', date: 1, sender_user_name: 'X' } },
        });
        expect((inc as any).command).toBeUndefined();
    });

    it('komanda', () => {
        const inc = normalizeUpdate({ update_id: 6, message: { ...base, text: '/start K7P2QX' } });
        expect((inc as any).command).toEqual({ name: 'start', arg: 'K7P2QX' });
    });

    it('dugme', () => {
        const inc = normalizeUpdate({
            update_id: 7,
            callback_query: { id: 'cb1', from: { id: 99, first_name: 'Nihad' }, data: 'done:t-1', message: { ...base, text: '⏰ Naručiti' } },
        });
        expect(inc).toMatchObject({ type: 'callback', callbackId: 'cb1', data: 'done:t-1', messageId: 7, messageText: '⏰ Naručiti', chatId: 55 });
    });

    it('grupe i nepodržano se ignorišu', () => {
        const group: TgUpdate = { update_id: 8, message: { ...base, chat: { id: -1, type: 'group' }, text: 'x' } };
        expect(normalizeUpdate(group)).toMatchObject({ type: 'ignored', reason: 'not-private' });
        expect(normalizeUpdate({ update_id: 9, message: { ...base } })).toMatchObject({ type: 'ignored', reason: 'unsupported' });
    });
});

describe('parseCommand', () => {
    it('ime bota iza komande', () => {
        expect(parseCommand('/danas@erp_bot')).toEqual({ name: 'danas', arg: '' });
    });
    it('nije komanda', () => {
        expect(parseCommand('danas')).toBeUndefined();
    });
});
