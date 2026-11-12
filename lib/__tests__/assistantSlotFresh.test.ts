/**
 * @jest-environment node
 */
// Termin zna šta je već rečeno i šta je pogon odmakao (dnevnik P-072, P-073) — od baze do baze,
// izmišljena imena:
//   1. obilazak: kad je pogon dalje nego što ERP zna, „Dalje od ovoga…" upiše kasniji korak
//      u toku (prethodni gotovi); „Sve gotovo" (uz potvrdu) završi proizvode i zatvori nalog
//   2. Poništi vraća cijeli obilazak, i zatvoren nalog
//   3. upis dana u 14:30 pita samo za radnike koji još nisu upisani (jutarnji diktat)
//   4. diktat poslije slanja termina: stavka se pri otvaranju zatvori, bez dvostrukog upisa
//   5. sav dan upisan prije termina: red s kvačicom, bez pitanja
//   6. tri termina bez ijednog dodira → jedan red napomene u sljedećem

jest.mock('@/lib/server/firebaseAdmin', () => require('@/lib/testing/fakeFirestore').firebaseAdminMock);
const sent: { chatId: number; text: string; buttons?: { text: string; data: string }[][] }[] = [];
jest.mock('@/lib/telegram/api', () => ({
    sendMessage: jest.fn(async (chatId: number, text: string, buttons?: { text: string; data: string }[][]) => {
        sent.push({ chatId, text, buttons });
        return { message_id: 100 + sent.length };
    }),
}));

import { fakeDocs as docs, fakeStore as store } from '@/lib/testing/fakeFirestore';
import { handleSlotButton, sendSlots } from '@/lib/assistant/slotRun';
import type { AssistantLink } from '@/lib/assistant/store';

const TZ = 'Europe/Sarajevo';
const DAY1 = '2026-11-10'; // utorak
const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+01:00`);
const link = () => docs('assistant_links')[0] as unknown as AssistantLink;
type View = { text: string; buttons?: { text: string; data: string }[][] };
const labels = (v: View) => v.buttons!.flat().map(b => b.text);
/** Dodir po natpisu, kao korisnik (tačan natpis ima prednost). */
async function tap(view: View, label: string, when = at(DAY1, '14:35')) {
    const all = view.buttons!.flat();
    const b = all.find(x => x.text === label) || all.find(x => x.text.includes(label));
    if (!b) throw new Error(`Nema dugmeta „${label}": ${labels(view).join(' | ')}`);
    const [, id, action, stamp] = b.data.split(':');
    return handleSlotButton(link(), id, action, when, TZ, stamp);
}
const item = (id: string) => docs('work_order_items').find(i => i.ID === id)!;
const order = (id: string) => docs('work_orders').find(o => o.Work_Order_ID === id)!;
const procStatus = (id: string, name: string) =>
    (item(id).Processes as { Process_Name: string; Status: string }[]).find(p => p.Process_Name === name)?.Status;
const log = (id: string, worker: string, date: string, wo: string, itemId: string) => store.set(`work_logs/${id}`, {
    WorkLog_ID: id, Organization_ID: 'org1', Date: date, Worker_ID: worker, Worker_Name: worker,
    Daily_Rate: 100, Original_Daily_Rate: 100, Day_Fraction: 1, Presence: 1, Split_Factor: 1, Hours_Worked: 8,
    Booking_Source: 'manual', Entry_Source: 'telegram', Is_From_Attendance: false,
    Work_Order_ID: wo, Work_Order_Item_ID: itemId, Product_ID: `p-${itemId}`,
});
const graph = (names: string[]) => ({
    nodes: names.map(n => ({ id: n, name: n, itemIds: [] })),
    edges: names.slice(1).map((n, i) => ({ id: `e${i}`, source: names[i], target: n })),
});

beforeAll(() => {
    store.set('assistant_links/1', { telegramUserId: 1, chatId: 7, uid: 'u1', orgId: 'org1', telegramName: 'N', linkedAt: '' });
    const w = (id: string, name: string) => store.set(`workers/${id}`, { Worker_ID: id, Organization_ID: 'org1', Name: name, Daily_Rate: 100, Status: 'Aktivan' });
    w('amer', 'Amer'); w('edin', 'Edin'); w('senad', 'Senad');
    store.set('projects/p1', { Project_ID: 'p1', Organization_ID: 'org1', Name: 'Hotel na brdu', Status: 'U proizvodnji' });
    store.set('suppliers/s1', { Supplier_ID: 's1', Organization_ID: 'org1', Name: 'Okovi d.o.o.' });
    ['Krojenje', 'Kantiranje', 'Sklapanje', 'Montaža', 'Lakiranje'].forEach((n, i) =>
        store.set(`process_catalog/c${i}`, { ID: `c${i}`, Organization_ID: 'org1', Name: n, Order: i + 1 }));

    // Kuhinja: ERP misli da je na kantiranju, a pogon je već na montaži.
    store.set('work_orders/r1', { Work_Order_ID: 'r1', Organization_ID: 'org1', Name: 'Kuhinja — korpusi', Status: 'U toku', Work_Order_Type: 'Proizvodnja',
        Process_Graph: graph(['Krojenje', 'Kantiranje', 'Sklapanje', 'Montaža']) });
    store.set('work_order_items/k1', { ID: 'k1', Organization_ID: 'org1', Work_Order_ID: 'r1', Product_ID: 'p-k1', Product_Name: 'Donji element', Project_ID: 'p1', Status: 'U toku',
        Processes: [{ Process_Name: 'Krojenje', Status: 'Završeno' }, { Process_Name: 'Kantiranje', Status: 'Na čekanju' }, { Process_Name: 'Sklapanje', Status: 'Na čekanju' }, { Process_Name: 'Montaža', Status: 'Na čekanju' }] });
    // Uzglavlja: ERP misli da je krojenje u toku, a sve je gotovo.
    store.set('work_orders/r2', { Work_Order_ID: 'r2', Organization_ID: 'org1', Name: 'Uzglavlja', Status: 'U toku', Work_Order_Type: 'Proizvodnja',
        Process_Graph: graph(['Krojenje', 'Lakiranje']) });
    for (const id of ['u1', 'u2']) {
        store.set(`work_order_items/${id}`, { ID: id, Organization_ID: 'org1', Work_Order_ID: 'r2', Product_ID: `p-${id}`, Product_Name: `Uzglavlje ${id}`, Project_ID: 'p1', Status: 'U toku',
            Processes: [{ Process_Name: 'Krojenje', Status: 'U toku' }, { Process_Name: 'Lakiranje', Status: 'Na čekanju' }] });
    }
    // Jučer: Amer i Senad na kuhinji, Edin na uzglavljima. Jutros izdiktirano samo za Amera.
    log('l1', 'amer', '2026-11-09', 'r1', 'k1');
    log('l2', 'senad', '2026-11-09', 'r1', 'k1');
    log('l3', 'edin', '2026-11-09', 'r2', 'u1');
    log('l4', 'amer', DAY1, 'r1', 'k1');
});

describe('14:30 poslije jutarnjeg diktata', () => {
    let hub: View;

    it('spisak: upis dana kaže „još 2", obilazak nosi oba naloga', async () => {
        expect(await sendSlots(at(DAY1, '14:30'), TZ)).toBe(1);
        hub = sent[0];
        expect(labels(hub)).toEqual(['👷 Upis dana · još 2 radnika', '🔧 Obilazak · 2 naloga', '🧾 Narudžbe']);
    });

    it('„Dalje od ovoga…" → Montaža: montaža u toku, kantiranje i sklapanje gotovi', async () => {
        let v: View = await tap(hub, 'Obilazak');
        expect(v.text).toContain('Kuhinja — korpusi — dokle su stigli?');
        expect(labels(v)).toEqual(['Kantiranje u toku', 'Kantiranje gotovo', 'Isto', 'Dalje od ovoga…', 'Sve gotovo', '‹ Nazad']);
        v = await tap(v, 'Dalje od ovoga…');
        expect(labels(v)).toEqual(['Sklapanje', 'Montaža', 'Sve gotovo', '‹ Nazad']);
        // Nazad vraća na isti nalog, ništa nije upisano.
        v = await tap(v, 'Nazad');
        expect(v.text).toContain('Kuhinja — korpusi — dokle su stigli?');
        expect(procStatus('k1', 'Kantiranje')).toBe('Na čekanju');
        v = await tap(await tap(v, 'Dalje od ovoga…'), 'Montaža');
        expect(procStatus('k1', 'Montaža')).toBe('U toku');
        expect(procStatus('k1', 'Kantiranje')).toBe('Završeno');
        expect(procStatus('k1', 'Sklapanje')).toBe('Završeno');
        expect(v.text).toContain('Uzglavlja — dokle su stigli?');
        hub = v;
    });

    it('„Sve gotovo" uz potvrdu: proizvodi završeni (dan zadnjeg rada) i nalog zatvoren', async () => {
        let v: View = await tap(hub, 'Sve gotovo');
        expect(v.text).toContain('Uzglavlja — sve gotovo?');
        v = await tap(v, 'Ne');
        expect(item('u1').Status).toBe('U toku');
        v = await tap(await tap(v, 'Sve gotovo'), 'Da, sve gotovo');
        expect(['u1', 'u2'].map(id => item(id).Status)).toEqual(['Završeno', 'Završeno']);
        expect(procStatus('u1', 'Lakiranje')).toBe('Završeno');
        expect(order('r2').Status).toBe('Završeno');
        // Gotovo = dan zadnjeg rada iz Knjige rada (jučer), ne dan dodira.
        expect(String(item('u1').Completed_At).slice(0, 10)).toBe('2026-11-09');
        expect(String(order('r2').Completed_At).slice(0, 10)).toBe('2026-11-09');
        expect(v.text).toContain('✅ Procesi: 2 ažurirano');
        hub = v;
    });

    it('Poništi zadnje vraća cijeli obilazak, i zatvoren nalog', async () => {
        const v = await tap(hub, 'Poništi zadnje');
        expect(v.toast).toBe('Poništeno');
        expect(order('r2').Status).toBe('U toku');
        expect(['u1', 'u2'].map(id => item(id).Status)).toEqual(['U toku', 'U toku']);
        expect(procStatus('k1', 'Montaža')).toBe('Na čekanju');
        expect(labels(v)).toContain('🔧 Obilazak · 2 naloga');
        hub = v;
    });

    it('upis dana pita samo za Edina i Senada; Amer ostaje kako je izdiktiran', async () => {
        let v: View = await tap(hub, 'Upis dana');
        expect(v.text).toContain('Upisano danas: 1 radnik. Ostali kao prethodni radni dan?');
        expect(v.text).toMatch(/Ostali: (Edin, Senad|Senad, Edin)/);
        v = await tap(v, 'Ostali isto');
        const today = docs('work_logs').filter(l => l.Date === DAY1);
        expect(today.filter(l => l.Worker_ID === 'amer').map(l => l.WorkLog_ID)).toEqual(['l4']);
        expect(new Set(today.map(l => l.Worker_ID))).toEqual(new Set(['amer', 'edin', 'senad']));
        expect(v.text).toContain('✅ Dan upisan (danas): 1 radnik ranije + 2 radnika kao prethodni dan');
    });
});

describe('diktat poslije slanja i dan upisan prije termina', () => {
    const DAY2 = '2026-11-11';
    const DAY3 = '2026-11-12';

    it('termin poslan s 3 radnika, pa izdiktirano: otvaranje zatvori stavku, ništa se ne upisuje dvaput', async () => {
        await sendSlots(at(DAY2, '14:30'), TZ);
        const v0 = sent[sent.length - 1];
        expect(labels(v0)[0]).toBe('👷 Upis dana · 3 radnika');
        log('m1', 'amer', DAY2, 'r1', 'k1'); log('m2', 'senad', DAY2, 'r1', 'k1'); log('m3', 'edin', DAY2, 'r2', 'u1');
        const v = await tap(v0, 'Upis dana', at(DAY2, '14:40'));
        expect(v.toast).toBe('Dan je već upisan');
        expect(v.text).toContain('✅ Dan već upisan: 3 radnika');
        expect(labels(v)).not.toContain('👷 Upis dana · 3 radnika');
        expect(docs('work_logs').filter(l => l.Date === DAY2)).toHaveLength(3);
    });

    it('sav dan upisan prije 14:30: red s kvačicom, bez pitanja', async () => {
        log('n1', 'amer', DAY3, 'r1', 'k1'); log('n2', 'senad', DAY3, 'r1', 'k1'); log('n3', 'edin', DAY3, 'r2', 'u1');
        await sendSlots(at(DAY3, '14:30'), TZ);
        const v = sent[sent.length - 1];
        expect(v.text).toContain('✅ Dan već upisan: 3 radnika');
        expect(labels(v).some(t => t.includes('Upis dana'))).toBe(false);
    });

    it('tri termina bez ijednog dodira → napomena u sljedećem, pa brojanje ispočetka', async () => {
        // 12.11. 14:30 (gore) bez dodira, 13.11. oba termina bez dodira → 16.11. (ponedjeljak) 10:30 nosi napomenu.
        await sendSlots(at('2026-11-13', '10:30'), TZ);
        await sendSlots(at('2026-11-13', '14:30'), TZ);
        expect(sent[sent.length - 1].text).not.toContain('Tri termina bez odgovora');
        await sendSlots(at('2026-11-16', '10:30'), TZ);
        expect(sent[sent.length - 1].text).toContain('Tri termina bez odgovora');
        expect(link().slotMisses).toBe(0);
    });
});
