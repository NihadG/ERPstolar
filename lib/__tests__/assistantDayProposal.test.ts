/**
 * @jest-environment node
 */
// Večernji prijedlog rada od baze do baze: prijedlog iz zadnjeg diktata,
// isključivanje stavke, upis jednim klikom, zaštita kasnijeg diktata,
// ↩️ Poništi i rupe za jutarnji pregled.

jest.mock('@/lib/server/firebaseAdmin', () => require('@/lib/testing/fakeFirestore').firebaseAdminMock);

import { fakeDocs as docs, fakeStore as store } from '@/lib/testing/fakeFirestore';
import { createProposalMessage, gapsForDigest, handleProposalButton } from '@/lib/assistant/dayProposals';
import { undoTurn, type AssistantLink } from '@/lib/assistant/store';

const TODAY = '2026-10-23'; // petak
const link = { telegramUserId: 1, chatId: 1, uid: 'u1', orgId: 'org1', telegramName: 'N', linkedAt: '' } as AssistantLink;
const logsOf = (worker: string, date = TODAY) => docs('work_logs').filter(l => l.Worker_ID === worker && l.Date === date);
const item = (id: string) => docs('work_order_items').find(i => i.ID === id)!;
const proposalId = (text: { buttons?: { data: string }[][] } | null) => text!.buttons!.at(-1)![0].data.split(':')[1];

beforeAll(() => {
    const w = (id: string, name: string) => store.set(`workers/${id}`, { Worker_ID: id, Organization_ID: 'org1', Name: name, Daily_Rate: 100, Status: 'Aktivan' });
    w('amer', 'Amer'); w('kerim', 'Kerim'); w('edin', 'Edin');
    store.set('work_orders/r9', { Work_Order_ID: 'r9', Organization_ID: 'org1', Name: 'Begović - Vrata', Status: 'U toku', Work_Order_Type: 'Proizvodnja',
        Process_Graph: { nodes: [{ id: 'br', name: 'Brušenje', itemIds: [] }, { id: 'la', name: 'Lakiranje', itemIds: [] }], edges: [{ id: 'e', source: 'br', target: 'la' }] } });
    store.set('work_orders/r7', { Work_Order_ID: 'r7', Organization_ID: 'org1', Name: 'Čorluka - Kuhinja', Status: 'U toku', Work_Order_Type: 'Proizvodnja',
        Process_Graph: { nodes: [{ id: 'ka', name: 'Kantiranje', itemIds: [] }, { id: 'sk', name: 'Sklapanje', itemIds: [] }], edges: [{ id: 'e', source: 'ka', target: 'sk' }] } });
    const it = (id: string, wo: string, name: string, processes: unknown[]) =>
        store.set(`work_order_items/${id}`, { ID: id, Organization_ID: 'org1', Work_Order_ID: wo, Product_ID: `p-${id}`, Product_Name: name, Status: 'U toku', Processes: processes });
    it('v1', 'r9', 'Vrata ulazna', [{ Process_Name: 'Brušenje', Status: 'U toku' }, { Process_Name: 'Lakiranje', Status: 'Na čekanju' }]);
    it('k1', 'r7', 'Donji elementi', [{ Process_Name: 'Kantiranje', Status: 'Završeno' }, { Process_Name: 'Sklapanje', Status: 'Na čekanju' }]);
    store.set('process_catalog/c1', { ID: 'c1', Organization_ID: 'org1', Name: 'Brušenje', Order: 1 });
    const log = (id: string, date: string, worker: string, wo: string, itemId: string, process: string) =>
        store.set(`work_logs/${id}`, { WorkLog_ID: id, Organization_ID: 'org1', Date: date, Worker_ID: worker, Worker_Name: worker, Daily_Rate: 100,
            Original_Daily_Rate: 100, Day_Fraction: 1, Presence: 1, Split_Factor: 1, Hours_Worked: 8, Booking_Source: 'manual', Entry_Source: 'telegram',
            Is_From_Attendance: false, Work_Order_ID: wo, Work_Order_Item_ID: itemId, Product_ID: `p-${itemId}`, Process_Name: process });
    log('l1', '2026-10-22', 'amer', 'r9', 'v1', 'Brušenje');
    log('l2', '2026-10-22', 'kerim', 'r9', 'v1', 'Brušenje');
    log('l3', '2026-10-21', 'edin', 'r7', 'k1', 'Kantiranje');
});

describe('večernji prijedlog → upis jednim klikom', () => {
    let id = '';

    beforeAll(async () => {
        const msg = await createProposalMessage(link, TODAY, TODAY);
        expect(msg!.text).toMatch(/✅ 1\. Amer, Kerim — Brušenje · Begović - Vrata/);
        expect(msg!.text).toMatch(/✅ 2\. Edin — Sklapanje \(sljedeći korak\) · Čorluka - Kuhinja/);
        id = proposalId(msg);
    });

    it('isključena stavka se ne upisuje; Kerim izdiktiran u međuvremenu se ne gazi', async () => {
        const toggled = await handleProposalButton(link, id, 't', '1', TODAY);
        expect(toggled!.text).toMatch(/⬜ 2\. Edin/);
        expect(toggled!.buttons!.at(-1)![0].text).toBe('💾 Upiši označeno (1)');

        // Kerim je u međuvremenu izdiktiran na kuhinju.
        store.set('work_logs/kd', { WorkLog_ID: 'kd', Organization_ID: 'org1', Date: TODAY, Worker_ID: 'kerim', Worker_Name: 'Kerim', Daily_Rate: 100,
            Day_Fraction: 1, Hours_Worked: 8, Booking_Source: 'manual', Entry_Source: 'telegram', Is_From_Attendance: false,
            Work_Order_ID: 'r7', Work_Order_Item_ID: 'k1', Product_ID: 'p-k1', Process_Name: 'Sklapanje' });

        const booked = await handleProposalButton(link, id, 'ok', '', TODAY);
        expect(booked).toMatchObject({ toast: 'Upisano', buttons: [[{ text: '↩️ Poništi', data: `undo:dp-${id}` }]] });
        expect(booked!.text).toMatch(/^🗓 Rad danas:\n• Amer — 1 dan · Brušenje · Begović - Vrata/);
        expect(booked!.text).toMatch(/Preskočeni jer su već upisani: Kerim/);

        expect(logsOf('amer')).toEqual([expect.objectContaining({ Work_Order_Item_ID: 'v1', Process_Name: 'Brušenje', Entry_Source: 'telegram', Daily_Rate: 100 })]);
        expect(logsOf('kerim').map(l => l.WorkLog_ID)).toEqual(['kd']);
        expect(logsOf('edin')).toEqual([]);
        expect(docs('worker_attendance').find(a => a.Worker_ID === 'amer' && a.Date === TODAY)).toMatchObject({ Status: 'Prisutan' });
    });

    it('drugi klik ne upisuje ponovo', async () => {
        expect(await handleProposalButton(link, id, 'ok', '', TODAY)).toMatchObject({ toast: 'Već upisano.' });
        expect(logsOf('amer')).toHaveLength(1);
    });

    it('tuđi prijedlog se ne može dirati', async () => {
        expect(await handleProposalButton({ ...link, uid: 'drugi' }, id, 'ok', '', TODAY)).toMatchObject({ toast: 'Prijedlog više ne postoji.' });
    });

    it('↩️ Poništi vraća dan', async () => {
        await undoTurn(`dp-${id}`, 'u1');
        expect(logsOf('amer')).toEqual([]);
    });
});

describe('prijedlog za raniji dan i preskakanje', () => {
    it('Preskoči ne upisuje ništa', async () => {
        const msg = await createProposalMessage(link, TODAY, TODAY);
        const id = proposalId(msg);
        expect(await handleProposalButton(link, id, 'no', '', TODAY)).toMatchObject({ toast: 'Preskočeno' });
        expect(logsOf('edin')).toEqual([]);
    });

    it('rupa iz jutarnjeg pregleda: prijedlog za taj dan, upis s tim datumom', async () => {
        const gaps = await gapsForDigest('org1', '2026-10-27');
        expect(gaps!.text).toMatch(/• pon 26\.10\. — Amer, Edin, Kerim/);
        expect(gaps!.text).toMatch(/• pet 23\.10\. — Amer, Edin/);
        const msg = await createProposalMessage(link, '2026-10-26', '2026-10-27');
        expect(msg!.text).toMatch(/^📝 Prijedlog rada za pon 26\.10\./);
        // Kerimov zadnji potvrđeni dan je sada petak (kuhinja) → prijedlog ga prati.
        expect(msg!.text).toMatch(/Kerim — Sklapanje · Čorluka - Kuhinja/);
        const booked = await handleProposalButton(link, proposalId(msg), 'ok', '', '2026-10-27');
        expect(booked!.text).toMatch(/^🗓 Rad pon 26\.10\.:/);
        expect(logsOf('amer', '2026-10-26')).toHaveLength(1);
        expect(item('k1').Processes.find((p: any) => p.Process_Name === 'Sklapanje').Status).toBe('U toku');
    });
});
