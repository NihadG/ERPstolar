/**
 * @jest-environment node
 */
// Podsjetnici i sažetak pošte iz sata, i dugmad podsjetnika — bez Gmaila i bez AI-ja.
jest.mock('@/lib/server/firebaseAdmin', () => require('@/lib/testing/fakeFirestore').firebaseAdminMock);
jest.mock('@/lib/telegram/api', () => ({
    sendMessage: jest.fn(async () => ({ message_id: 1 })),
    editMessageText: jest.fn(async () => undefined),
    answerCallbackQuery: jest.fn(async () => undefined),
}));

import { fakeStore as store } from '@/lib/testing/fakeFirestore';
import { handleFollowButton, openMailFor, sendMailDigests, sendMailFollowUps } from '@/lib/server/mailFollow';
import { editMessageText, sendMessage } from '@/lib/telegram/api';
import type { MailInboxItem } from '@/lib/types';

const TZ = 'Europe/Sarajevo';
const ORG = 'org1';
const UID = 'u1';
const link = { uid: UID, orgId: ORG };

const put = (id: string, extra: Partial<MailInboxItem>) => store.set(`mail_inbox/${UID}_${id}`, {
    Item_ID: `${UID}_${id}`, Organization_ID: ORG, Owner_UID: UID, Message_ID: id, Thread_ID: `t${id}`, From: 'amra@staklo-demo.example',
    From_Name: 'Amra Delić', Subject: 'Pitanje', Snippet: 'Možete li potvrditi?', Received_At: '2026-10-29T08:00:00.000Z',
    Kind: 'contact', Order_IDs: [], State: 'new', Created_At: '', ...extra,
});
const get = (id: string) => store.get(`mail_inbox/${UID}_${id}`) as MailInboxItem;
const btn = (id: string, action: string, now = new Date('2026-10-30T09:00:00Z')) =>
    handleFollowButton({ chatId: 77, messageId: 9, callbackId: 'cb', messageText: 'poruka' }, link, id, action, now);

beforeEach(() => {
    store.clear();
    jest.clearAllMocks();
    store.set('assistant_links/l1', { uid: UID, orgId: ORG, chatId: 77, telegramUserId: 1 });
    store.set('orders/o1', { Order_ID: 'o1', Organization_ID: ORG, Order_Number: 'N2026-10/07', Supplier_ID: 's1', Supplier_Name: 'Staklo Demo', Status: 'Poslano', Order_Date: '2026-10-20T08:00:00Z' });
    store.set('order_items/i1', { ID: 'i1', Organization_ID: ORG, Order_ID: 'o1', Product_Material_ID: 'm1', Product_ID: 'p1', Product_Name: 'Ogledalo', Project_ID: 'pj', Material_Name: 'Ogledalo 4mm', Quantity: 3, Unit: 'kom', Expected_Price: 0, Actual_Price: 0, Received_Quantity: 0, Status: 'Naručeno' });
    store.set('product_materials/m1', { ID: 'm1', Organization_ID: ORG, Product_ID: 'p1', Material_Name: 'Ogledalo 4mm', Quantity: 3, Unit: 'kom', Status: 'Naručeno', Order_ID: 'o1', Ordered_Quantity: 3 });
    store.set('products/p1', { Product_ID: 'p1', Organization_ID: ORG, Project_ID: 'pj', Name: 'Ogledalo', Quantity: 3, Status: 'Materijali naručeni' });
});

describe('podsjetnici iz sata', () => {
    it('dospio podsjetnik ide na Telegram i zakazuje sljedeći; nedospio i riješen ne', async () => {
        put('a', { Follow: 'reply', Follow_Count: 0, Next_Follow_At: '2026-10-30T08:00:00.000Z' });
        put('b', { Follow: 'reply', Follow_Count: 0, Next_Follow_At: '2026-11-02T08:00:00.000Z' });
        put('c', { Follow: 'reply', Follow_Count: 1, Next_Follow_At: '2026-10-30T08:00:00.000Z', Done_At: '2026-10-29T12:00:00.000Z' });
        expect(await sendMailFollowUps(new Date('2026-10-30T09:00:00Z'), TZ)).toBe(1);
        expect((sendMessage as jest.Mock).mock.calls[0][1]).toContain('↩️ Čeka tvoj odgovor — Amra Delić, jučer');
        expect(get('a')).toMatchObject({ Follow_Count: 1, Next_Follow_At: '2026-11-01T08:00:00.000Z' });
        expect(get('c').Next_Follow_At).toBeNull();
    });

    it('noću se ne šalje (7–20 h)', async () => {
        put('a', { Follow: 'reply', Follow_Count: 0, Next_Follow_At: '2026-10-30T01:00:00.000Z' });
        expect(await sendMailFollowUps(new Date('2026-10-30T03:00:00Z'), TZ)).toBe(0);
        expect(get('a').Follow_Count).toBe(0);
    });

    it('zadnji podsjetnik: poslije njega nema više', async () => {
        put('a', { Follow: 'reply', Follow_Count: 2, Next_Follow_At: '2026-11-05T08:00:00.000Z' });
        await sendMailFollowUps(new Date('2026-11-05T09:00:00Z'), TZ);
        expect((sendMessage as jest.Mock).mock.calls[0][1]).toContain('(zadnji podsjetnik)');
        expect(get('a')).toMatchObject({ Follow_Count: 3, Next_Follow_At: null });
    });

    it('spremno, a narudžba je u međuvremenu primljena → zatvori bez poruke', async () => {
        store.set('orders/o1', { ...store.get('orders/o1'), Status: 'Primljeno' });
        put('p', { Kind: 'ready', Follow: 'pickup', Follow_Count: 0, Next_Follow_At: '2026-10-30T08:00:00.000Z', Order_IDs: ['o1'] });
        expect(await sendMailFollowUps(new Date('2026-10-30T09:00:00Z'), TZ)).toBe(0);
        expect(get('p')).toMatchObject({ Done_How: 'received', Next_Follow_At: null });
    });
});

describe('dugmad podsjetnika', () => {
    it('„Preuzeto" s jednom narudžbom prima narudžbu u ERP-u', async () => {
        put('p', { Kind: 'ready', Follow: 'pickup', Order_IDs: ['o1'], Next_Follow_At: '2026-10-31T08:00:00.000Z' });
        await btn('p', 'd');
        expect(get('p')).toMatchObject({ Done_How: 'received', Next_Follow_At: null });
        expect(store.get('orders/o1')!.Status).toBe('Primljeno');
        expect((editMessageText as jest.Mock).mock.calls[0][2]).toContain('narudžba N2026-10/07 primljena');
    });

    it('„Odgovorio sam", „Sutra" i „Ne podsjećaj"', async () => {
        put('a', { Follow: 'reply', Next_Follow_At: '2026-10-31T08:00:00.000Z' });
        put('b', { Follow: 'reply', Next_Follow_At: '2026-10-31T08:00:00.000Z' });
        put('c', { Follow: 'task', Kind: 'site', Next_Follow_At: '2026-10-31T08:00:00.000Z' });
        await btn('a', 'd');
        await btn('b', 's');
        await btn('c', 'x');
        expect(get('a')).toMatchObject({ Done_How: 'button', Next_Follow_At: null });
        expect(get('b')).toMatchObject({ Next_Follow_At: '2026-10-31T09:00:00.000Z' });
        expect(get('b').Done_At).toBeUndefined();
        expect(get('c')).toMatchObject({ Done_How: 'stopped', Next_Follow_At: null });
        await btn('a', 'd');
        expect((editMessageText as jest.Mock).mock.calls.at(-1)[2]).toContain('već riješeno');
    });
});

describe('sažetak svaka 3 dana i /posta', () => {
    const account = (extra: Record<string, unknown> = {}) => store.set('email_accounts/u1', { UID: UID, Organization_ID: ORG, Email: 'ja@luxco-demo.example', Status: 'ok', Scopes: [], Refresh_Token_Enc: 'x', ...extra });

    it('prvi put samo zapamti početak; prije 3 dana ništa; poslije 3 dana pošalje', async () => {
        account();
        put('a', { Follow: 'reply', Received_At: '2026-10-29T08:00:00.000Z' });
        expect(await sendMailDigests(new Date('2026-10-30T07:30:00Z'), TZ)).toBe(0);
        const start = (store.get('email_accounts/u1') as { Mail_Digest_At: string }).Mail_Digest_At;
        expect(start).toBe('2026-10-30T07:30:00.000Z');
        expect(await sendMailDigests(new Date('2026-11-01T07:30:00Z'), TZ)).toBe(0);
        expect(await sendMailDigests(new Date('2026-11-02T07:30:00Z'), TZ)).toBe(1);
        expect((sendMessage as jest.Mock).mock.calls[0][1]).toContain('↩️ Čeka tvoj odgovor (1)');
    });

    it('samo ujutro', async () => {
        account({ Mail_Digest_At: '2026-10-25T07:00:00.000Z' });
        put('a', { Follow: 'reply' });
        expect(await sendMailDigests(new Date('2026-10-30T15:00:00Z'), TZ)).toBe(0);
    });

    it('/posta daje otvoreno s dugmadima', async () => {
        put('a', { Follow: 'reply', Subject: 'Ponuda kuhinja' });
        put('b', { Follow: 'reply', Done_At: '2026-10-29T10:00:00.000Z' });
        const l = await openMailFor(UID, ORG, new Date('2026-10-30T09:00:00Z'));
        expect(l.text).toContain('1. ↩️ Amra Delić: „Ponuda kuhinja"');
        expect(l.buttons).toEqual([[{ text: '✅ 1. riješeno', data: 'mf:a:d' }]]);
    });
});
