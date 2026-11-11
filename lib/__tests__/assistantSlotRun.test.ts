/**
 * @jest-environment node
 */
// Termini od baze do baze (izmišljena imena): slanje u 14:30 jednom, narudžba dugmadima,
// posao bez projekta rečenicom, obilazak upisuje proces, „Sve isto" upisuje dan,
// Poništi vraća, poslije 15:00 ništa.

jest.mock('@/lib/server/firebaseAdmin', () => require('@/lib/testing/fakeFirestore').firebaseAdminMock);
const sent: { chatId: number; text: string; buttons?: { text: string; data: string }[][] }[] = [];
jest.mock('@/lib/telegram/api', () => ({
    sendMessage: jest.fn(async (chatId: number, text: string, buttons?: { text: string; data: string }[][]) => {
        sent.push({ chatId, text, buttons });
        return { message_id: 100 + sent.length };
    }),
}));

import { fakeDocs as docs, fakeStore as store } from '@/lib/testing/fakeFirestore';
import { consumeSlotText, handleSlotButton, sendSlots } from '@/lib/assistant/slotRun';
import type { AssistantLink } from '@/lib/assistant/store';

const TZ = 'Europe/Sarajevo';
const TODAY = '2026-11-10'; // utorak
const at = (hhmm: string) => new Date(`${TODAY}T${hhmm}:00+01:00`);
const link = () => docs('assistant_links')[0] as unknown as AssistantLink;
const slotId = () => link().lastSlotId!;
type View = { text: string; buttons?: { text: string; data: string }[][] };
/** Dodir po natpisu, kao korisnik. */
async function tap(view: View, label: string, when = at('14:35')) {
    const b = view.buttons!.flat().find(x => x.text.includes(label));
    if (!b) throw new Error(`Nema dugmeta „${label}": ${view.buttons!.flat().map(x => x.text).join(' | ')}`);
    const [, id, action, stamp] = b.data.split(':');
    return handleSlotButton(link(), id, action, when, TZ, stamp);
}

beforeAll(() => {
    store.set('assistant_links/1', { telegramUserId: 1, chatId: 7, uid: 'u1', orgId: 'org1', telegramName: 'N', linkedAt: '' });
    const w = (id: string, name: string) => store.set(`workers/${id}`, { Worker_ID: id, Organization_ID: 'org1', Name: name, Daily_Rate: 100, Status: 'Aktivan' });
    w('amer', 'Amer'); w('edin', 'Edin');
    store.set('projects/p1', { Project_ID: 'p1', Organization_ID: 'org1', Name: 'Hotel na brdu', Client_Name: 'Hotel', Status: 'U proizvodnji' });
    store.set('projects/p2', { Project_ID: 'p2', Organization_ID: 'org1', Name: 'Kuća Amre', Client_Name: 'Amra', Status: 'U proizvodnji' });
    store.set('suppliers/s1', { Supplier_ID: 's1', Organization_ID: 'org1', Name: 'Okovi d.o.o.' });
    store.set('suppliers/s2', { Supplier_ID: 's2', Organization_ID: 'org1', Name: 'Ploče d.o.o.' });
    store.set('suppliers/s0', { Supplier_ID: 's0', Organization_ID: 'org1', Name: 'Interni' });
    // Okovi d.o.o. je najčešći dobavljač; jedna javljena narudžba čeka duže od 7 dana.
    store.set('orders/a', { Order_ID: 'a', Organization_ID: 'org1', Order_Number: 'N1', Supplier_ID: 's1', Supplier_Name: 'Okovi d.o.o.', Order_Date: '2026-10-20T08:00:00.000Z', Status: 'Primljeno' });
    store.set('orders/q', { Order_ID: 'q', Organization_ID: 'org1', Order_Number: 'N2', Supplier_ID: 's2', Supplier_Name: 'Ploče d.o.o.', Order_Date: '2026-10-30T08:00:00.000Z',
        Sent_At: '2026-10-30T08:00:00.000Z', Status: 'Poslano', Quick: true, Quick_Target: { Kind: 'project', ID: 'p2', Name: 'Kuća Amre' } });
    store.set('work_orders/r9', { Work_Order_ID: 'r9', Organization_ID: 'org1', Name: 'Hotel — vrata', Status: 'U toku', Work_Order_Type: 'Proizvodnja',
        Process_Graph: { nodes: [{ id: 'br', name: 'Brušenje', itemIds: [] }, { id: 'la', name: 'Lakiranje', itemIds: [] }], edges: [{ id: 'e', source: 'br', target: 'la' }] } });
    store.set('work_order_items/v1', { ID: 'v1', Organization_ID: 'org1', Work_Order_ID: 'r9', Product_ID: 'p-v1', Product_Name: 'Vrata ulazna', Project_ID: 'p1', Status: 'U toku',
        Processes: [{ Process_Name: 'Brušenje', Status: 'U toku' }, { Process_Name: 'Lakiranje', Status: 'Na čekanju' }] });
    store.set('process_catalog/c1', { ID: 'c1', Organization_ID: 'org1', Name: 'Brušenje', Order: 1 });
    store.set('process_catalog/c2', { ID: 'c2', Organization_ID: 'org1', Name: 'Lakiranje', Order: 2 });
    const log = (id: string, worker: string) => store.set(`work_logs/${id}`, { WorkLog_ID: id, Organization_ID: 'org1', Date: '2026-11-09', Worker_ID: worker, Worker_Name: worker,
        Daily_Rate: 100, Original_Daily_Rate: 100, Day_Fraction: 1, Presence: 1, Split_Factor: 1, Hours_Worked: 8, Booking_Source: 'manual', Entry_Source: 'telegram',
        Is_From_Attendance: false, Work_Order_ID: 'r9', Work_Order_Item_ID: 'v1', Product_ID: 'p-v1', Process_Name: 'Brušenje' });
    log('l1', 'amer'); log('l2', 'edin');
});

describe('termin 14:30', () => {
    let hub: View;

    it('prije 14:30 i poslije 15:00 se ne šalje ništa', async () => {
        expect(await sendSlots(at('14:29'), TZ)).toBe(0);
        expect(await sendSlots(at('15:00'), TZ)).toBe(0);
        expect(await sendSlots(at('19:30'), TZ)).toBe(0);
        expect(sent).toHaveLength(0);
    });

    it('šalje jednu poruku-spisak, jednom', async () => {
        expect(await sendSlots(at('14:30'), TZ)).toBe(1);
        expect(await sendSlots(at('14:31'), TZ)).toBe(0);
        expect(sent).toHaveLength(1);
        hub = sent[0];
        expect(sent[0].chatId).toBe(7);
        expect(hub.text).toBe('🕥 14:30 · još 3 od 3');
        expect(hub.buttons!.flat().map(b => b.text)).toEqual(['👷 Upis dana · 2 radnika', '🔧 Obilazak · 1 nalog', '🧾 Narudžbe · 1 za provjeru']);
    });

    it('narudžba: stiglo → jesam → dobavljač (najčešći prvi, bez „Interni") → projekat', async () => {
        let v: View = await tap(hub, 'Narudžbe');
        expect(v.text).toContain('Ploče d.o.o. · Kuća Amre — je li stiglo?');
        v = await tap(v, 'Stiglo');
        expect(docs('orders').find(o => o.Order_ID === 'q')!.Status).toBe('Primljeno');
        v = await tap(v, 'Jesam');
        expect(v.buttons!.flat().map(b => b.text)).toEqual(['Okovi d.o.o.', 'Ploče d.o.o.', '‹ Nazad']);
        v = await tap(v, 'Okovi');
        expect(v.buttons!.flat().map(b => b.text)).toEqual(['Hotel na brdu', 'Kuća Amre', 'Više projekata', 'Zaliha', 'Bez projekta', '‹ Nazad']);
        v = await tap(v, 'Hotel na brdu');

        const made = docs('orders').find(o => o.Quick && o.Order_ID !== 'q')!;
        expect(made).toMatchObject({ Supplier_ID: 's1', Supplier_Name: 'Okovi d.o.o.', Status: 'Poslano', Quick_Target: { Kind: 'project', ID: 'p1', Name: 'Hotel na brdu' } });
        expect(made.Sent_At).toBeTruthy();
        expect(v.text).toBe('🕥 14:30 · još 2 od 3\n\n✅ Stiglo: Ploče d.o.o. · Kuća Amre\n✅ Naručeno: Okovi d.o.o. · Hotel na brdu');
        hub = v;
    });

    it('Poništi zadnje briše javljenu narudžbu; prijem ostaje', async () => {
        const v = await tap(hub, 'Poništi zadnje');
        expect(docs('orders').filter(o => o.Quick && o.Order_ID !== 'q')).toHaveLength(0);
        expect(docs('orders').find(o => o.Order_ID === 'q')!.Status).toBe('Primljeno');
        expect(v.text).toBe('🕥 14:30 · još 2 od 3\n\n✅ Stiglo: Ploče d.o.o. · Kuća Amre');
        hub = v;
    });

    it('posao bez projekta: rečenica pravi kratak nalog i veže narudžbu za njega', async () => {
        let v: View = await tap(hub, 'Još jedna');
        v = await tap(v, 'Ploče');
        v = await tap(v, 'Bez projekta');
        expect(v.buttons!.flat().map(b => b.text)).toEqual(['Novi posao', 'Preskoči', '‹ Nazad']);
        v = await tap(v, 'Novi posao');
        expect(v.text).toContain('Za šta je?');

        // Obična poruka dok se ništa ne čeka NE ide terminu; rečenica u roku ide.
        const out = await consumeSlotText(link(), '4 vrata za komšiju', at('14:37'), TZ);
        expect(out!.messageId).toBe(101);
        const job = docs('work_orders').find(o => o.Name === '4 vrata za komšiju')!;
        expect(job.Work_Order_Type).toBe('Zadaci');
        expect(docs('orders').find(o => o.Quick && o.Supplier_ID === 's2' && o.Order_ID !== 'q')!.Quick_Target)
            .toEqual({ Kind: 'job', ID: job.Work_Order_ID, Name: '4 vrata za komšiju' });
        expect(out!.text).toContain('✅ Naručeno: Ploče d.o.o. · 4 vrata za komšiju');
        expect(await consumeSlotText(link(), 'napomeni me sutra u 8', at('14:38'), TZ)).toBeNull();
        hub = out!;
    });

    it('obilazak: dodir upisuje proces na nalog', async () => {
        let v: View = await tap(hub, 'Obilazak');
        expect(v.text).toContain('Hotel — vrata — dokle su stigli?');
        expect(v.buttons!.flat().map(b => b.text)).toEqual(['Brušenje gotovo', 'Isto', '‹ Nazad']);
        v = await tap(v, 'Brušenje gotovo');
        const procs = docs('work_order_items').find(i => i.ID === 'v1')!.Processes as { Process_Name: string; Status: string }[];
        expect(procs.find(p => p.Process_Name === 'Brušenje')!.Status).toBe('Završeno');
        expect(v.text).toContain('✅ Procesi: 1 ažurirano');
        hub = v;
    });

    it('upis dana: „Sve isto" upiše oba radnika kao prethodni dan', async () => {
        let v: View = await tap(hub, 'Upis dana');
        expect(v.text).toContain('Je li danas sve kao prethodni radni dan?\n2 radnika na 1 nalogu');
        v = await tap(v, 'Sve isto');
        const today = docs('work_logs').filter(l => l.Date === TODAY);
        expect(new Set(today.map(l => l.Worker_ID))).toEqual(new Set(['amer', 'edin']));
        expect(v.text).toContain('✅ Dan upisan (danas): 2 radnika');
        expect(v.text.startsWith('✅ 14:30 · sve gotovo')).toBe(true);
    });

    it('dupli dodir na isto dugme ne upisuje dvaput', async () => {
        const before = docs('orders').length;
        const old = sent[0];   // prva poruka: dugmad s brojem dodira 0
        const out = await tap(old, 'Narudžbe');
        expect(out.toast).toBe('Već zabilježeno.');
        expect(out.text).toBe('');
        expect(docs('orders')).toHaveLength(before);
    });

    it('tuđi ili nepostojeći termin se ne dira', async () => {
        const other = { ...link(), uid: 'u2' } as AssistantLink;
        expect((await handleSlotButton(other, slotId(), 'o0', at('14:40'), TZ)).toast).toBe('Ovaj termin više ne postoji.');
        expect((await handleSlotButton(link(), 'nema', 'o0', at('14:40'), TZ)).toast).toBe('Ovaj termin više ne postoji.');
    });
});
