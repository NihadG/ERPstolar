/**
 * @jest-environment node
 */
// Revizija 14.11.2026, paket B (P-075, P-082) — principi, izmišljena imena:
//   1. radnik čiji je zadnji posao završen ne ispada iz upisa dana: termin pita „na čemu su sad?"
//      dugmadima otvorenih naloga, po ekipama (isti zadnji posao = jedno pitanje)
//   2. „Sve isto" upiše prijedlog, pa odmah ekipe bez posla, na istoj poruci; zadnja ekipa zatvara stavku
//   3. „ostali rade" (i subotom) znači ostali po zadnjem danu; „Vikend" iz kalendara tad ne zaustavlja
//   4. „ne rade jer je vikend" je status Vikend, ne brisanje dana

jest.mock('@/lib/server/firebaseAdmin', () => require('@/lib/testing/fakeFirestore').firebaseAdminMock);
const sent: { chatId: number; text: string; buttons?: { text: string; data: string }[][] }[] = [];
jest.mock('@/lib/telegram/api', () => ({
    sendMessage: jest.fn(async (chatId: number, text: string, buttons?: { text: string; data: string }[][]) => {
        sent.push({ chatId, text, buttons });
        return { message_id: 100 + sent.length };
    }),
}));

import { fakeDocs as docs, fakeStore as store } from '@/lib/testing/fakeFirestore';
import { buildDayProposal } from '@/lib/dayProposal';
import { idleCrews } from '@/lib/assistant/dayProposals';
import { newSlotState, slotTap, slotView, type SlotItem, type SlotState } from '@/lib/assistant/slots';
import { handleSlotButton, sendSlots } from '@/lib/assistant/slotRun';
import { othersLikeLast } from '@/lib/assistant/grounding';
import { runTool, type ToolEnv } from '@/lib/assistant/tools';
import { undoTurn, type AssistantLink } from '@/lib/assistant/store';

const texts = (s: SlotState) => slotView(s).buttons.flat().map(b => b.text);
function tap(s: SlotState, label: string) {
    const all = slotView(s).buttons.flat();
    const b = all.find(x => x.text === label) || all.find(x => x.text.includes(label));
    if (!b) throw new Error(`Nema dugmeta „${label}": ${texts(s).join(' | ')}`);
    return slotTap(s, b.action);
}

describe('prijedlog dana: ekipe čiji je posao završen', () => {
    const W = [{ Worker_ID: 'amer', Name: 'Amer Hodžić' }, { Worker_ID: 'edin', Name: 'Edin Begić' }, { Worker_ID: 'haso', Name: 'Haso Mujić' }, { Worker_ID: 'tarik', Name: 'Tarik Zukić' }];
    const log = (worker: string, wo: string, item: string) => ({ Date: '2026-11-12', Worker_ID: worker, Work_Order_ID: wo, Work_Order_Item_ID: item, Booking_Source: 'manual' as const, Entry_Source: 'telegram' as const, Is_From_Attendance: false });
    const orders = [
        { Work_Order_ID: 'rk', Name: 'Kovač - Kuhinja', Status: 'U toku' as const, items: [{ ID: 'k1', Product_Name: 'Kuhinja', Status: 'U toku' as const, Processes: [] }] },
        { Work_Order_ID: 'rg', Name: 'Lejla - Garderober', Status: 'U toku' as const, items: [{ ID: 'g1', Product_Name: 'Garderober', Status: 'Završeno' as const, Processes: [] }] },
        { Work_Order_ID: 'rv', Name: 'Meliha - Vrata', Status: 'Završeno' as const, items: [{ ID: 'v1', Product_Name: 'Vrata', Status: 'Završeno' as const, Processes: [] }] },
    ];
    const logs = [log('amer', 'rk', 'k1'), log('edin', 'rg', 'g1'), log('haso', 'rg', 'g1'), log('tarik', 'rv', 'v1')];

    it('ne ispadaju tiho, bez obzira na šihtaricu; isti zadnji posao = jedna ekipa, veća prva', () => {
        const p = buildDayProposal({ date: '2026-11-13', workers: W, logs, attendance: [], orders });
        expect(p.lines.map(l => l.workerIds)).toEqual([['amer']]);
        expect(p.idle!.map(x => x.workerId).sort()).toEqual(['edin', 'haso', 'tarik']);
        expect(idleCrews(p.idle!)).toEqual([
            { workerIds: ['edin', 'haso'], names: ['Edin Begić', 'Haso Mujić'], last: 'Lejla - Garderober' },
            { workerIds: ['tarik'], names: ['Tarik Zukić'], last: 'Meliha - Vrata' },
        ]);
    });

    it('odsutni i već upisani nisu ekipa bez posla', () => {
        const p = buildDayProposal({
            date: '2026-11-13', workers: W, orders,
            logs: [...logs, { ...log('haso', 'rk', 'k1'), Date: '2026-11-13' }],
            attendance: [{ Worker_ID: 'edin', Date: '2026-11-13', Status: 'Bolovanje' }],
        });
        expect(p.idle!.map(x => x.workerId)).toEqual(['tarik']);
    });

    it('„Vikend" iz kalendara zaustavlja prijedlog, osim kad je rečeno da rade', () => {
        const att = W.map(w => ({ Worker_ID: w.Worker_ID, Date: '2026-11-14', Status: 'Vikend' }));
        const input = { date: '2026-11-14', workers: W, logs, attendance: att, orders };
        expect(buildDayProposal(input).lines).toEqual([]);
        expect(buildDayProposal({ ...input, weekendWork: true }).lines.map(l => l.workerIds)).toEqual([['amer']]);
        // Bolovanje ostaje odsustvo i kad je rečeno da ostali rade.
        const sick = buildDayProposal({ ...input, attendance: [{ Worker_ID: 'amer', Date: '2026-11-14', Status: 'Bolovanje' }], weekendWork: true });
        expect(sick.absent).toEqual(['Amer Hodžić']);
    });
});

describe('termin: ekipe dugmadima', () => {
    const open = [{ id: 'rk', name: 'Kovač - Kuhinja' }, { id: 'rs', name: 'Sto za Tarika' }];
    const crews = [
        { workerIds: ['edin', 'haso'], names: ['Edin Begić', 'Haso Mujić'], last: 'Lejla - Garderober' },
        { workerIds: ['tarik'], names: ['Tarik Zukić'], last: 'Meliha - Vrata' },
    ];
    const day = (workers: number): SlotItem => ({ id: 'day', done: [], data: { date: '2026-11-13', label: 'danas', workers, orders: 1, idle: crews, open } });
    const orders: SlotItem = { id: 'orders', done: [], data: { suppliers: [], moreSuppliers: [], projects: [], jobs: [], waiting: [] } };

    it('na spisku su svi radnici; pitanje kaže da za ekipe pita poslije', () => {
        const s = newSlotState('b', '2026-11-13', [day(1), orders]);
        expect(texts(s)[0]).toBe('👷 Upis dana · 4 radnika');
        expect(slotView(tap(s, 'Upis dana').state).text).toContain('1 radnik na 1 nalogu · za još 3 pitam poslije');
    });

    it('„Sve isto" upiše prijedlog i odmah pita za prvu ekipu; izbor naloga je upis ekipe; zadnja ekipa zatvara', () => {
        let s = tap(newSlotState('b', '2026-11-13', [day(1), orders]), 'Upis dana').state;
        const same = tap(s, 'Sve isto');
        expect(same.effect).toEqual({ type: 'day_same', date: '2026-11-13', label: 'danas' });
        s = same.state;
        expect(slotView(s).text).toContain('Edin i Haso — Lejla - Garderober je završen. Na čemu su danas?\nEkipa 1 od 2');
        expect(texts(s)).toEqual(['Kovač - Kuhinja', 'Sto za Tarika', 'Nisu radili', 'Preskoči', '‹ Nazad']);
        const first = tap(s, 'Kovač - Kuhinja');
        expect(first.effect).toEqual({ type: 'day_crew', date: '2026-11-13', workerIds: ['edin', 'haso'], names: ['Edin Begić', 'Haso Mujić'], orderId: 'rk', orderName: 'Kovač - Kuhinja' });
        expect(slotView(first.state).text).toContain('Tarik — Meliha - Vrata je završen.');
        const last = tap(first.state, 'Nisu radili');
        expect(last.effect).toEqual({ type: 'day_crew', date: '2026-11-13', workerIds: ['tarik'], names: ['Tarik Zukić'] });
        expect(last.state.items[0].closed).toBe(true);
        expect(last.state.flow).toBeNull();
    });

    it('„Preskoči" ne upisuje; kad su svi iz prijedloga upisani, stavka počinje ekipama', () => {
        const s = tap(newSlotState('b', '2026-11-13', [day(0), orders]), 'Upis dana').state;
        expect(slotView(s).text).toContain('Edin i Haso — Lejla - Garderober je završen.');
        expect(tap(s, 'Preskoči').effect).toBeUndefined();
    });
});

describe('„ostali rade" i vikend', () => {
    it.each([
        'Kemo, Bego i Braco danas ne rade jer je vikend, ostali rade',
        'ta grupa ne radi vikendom. Ostali rade normalno',
        'a ostali su radili',
        'svi ostali rade',
        'Ovi ostali danas rade kao i jučer',
    ])('„%s" → ostali po zadnjem danu', t => expect(othersLikeLast(t)).toBe(true));

    it.each(['ostali rade na kuhinji za Hamzu', 'ostali su otišli kući', 'da li ostali rade?', 'ostalo radimo sutra'])('„%s" → nije', t => {
        expect(othersLikeLast(t)).toBe(false);
    });
});

// ── Od baze do baze ──
const TZ = 'Europe/Sarajevo';
const FRI = '2026-11-13';
const SAT = '2026-11-14';
const link = () => docs('assistant_links')[0] as unknown as AssistantLink;
const WORKERS = [
    { alias: 'W1', value: { id: 'amer', name: 'Amer Hodžić' } }, { alias: 'W2', value: { id: 'edin', name: 'Edin Begić' } },
    { alias: 'W3', value: { id: 'haso', name: 'Haso Mujić' } }, { alias: 'W4', value: { id: 'tarik', name: 'Tarik Zukić' } },
];
const logOf = (id: string, worker: string, date: string, wo: string, item: string) => store.set(`work_logs/${id}`, {
    WorkLog_ID: id, Organization_ID: 'org1', Date: date, Worker_ID: worker, Worker_Name: worker, Daily_Rate: 100, Original_Daily_Rate: 100,
    Day_Fraction: 1, Presence: 1, Split_Factor: 1, Hours_Worked: 8, Booking_Source: 'manual', Entry_Source: 'telegram', Is_From_Attendance: false,
    Work_Order_ID: wo, Work_Order_Item_ID: item, Product_ID: `p-${item}`,
});
const ordersOf = (w: string, d: string) => Array.from(new Set(docs('work_logs').filter(l => l.Worker_ID === w && l.Date === d).map(l => l.Work_Order_ID)));

beforeAll(() => {
    store.set('assistant_links/1', { telegramUserId: 1, chatId: 7, uid: 'u1', orgId: 'org1', telegramName: 'N', linkedAt: '' });
    for (const w of WORKERS) store.set(`workers/${w.value.id}`, { Worker_ID: w.value.id, Organization_ID: 'org1', Name: w.value.name, Daily_Rate: 100, Status: 'Aktivan' });
    const wo = (id: string, name: string, item: string, done = false) => {
        store.set(`work_orders/${id}`, { Work_Order_ID: id, Organization_ID: 'org1', Name: name, Status: 'U toku', Work_Order_Type: 'Zadaci', Created_Date: '2026-11-01' });
        store.set(`work_order_items/${item}`, { ID: item, Organization_ID: 'org1', Work_Order_ID: id, Product_ID: `p-${item}`, Product_Name: name, Status: done ? 'Završeno' : 'U toku' });
    };
    wo('rk', 'Kovač - Kuhinja', 'ik'); wo('rs', 'Sto za Tarika', 'is'); wo('rg', 'Lejla - Garderober', 'ig', true);
    // Četvrtak: Amer na kuhinji, Edin i Haso na garderoberu (završen u obilasku), Tarik na stolu.
    logOf('a1', 'amer', '2026-11-12', 'rk', 'ik'); logOf('a2', 'edin', '2026-11-12', 'rg', 'ig');
    logOf('a3', 'haso', '2026-11-12', 'rg', 'ig'); logOf('a4', 'tarik', '2026-11-12', 'rs', 'is');
});

describe('14:30 od baze do baze', () => {
    it('„Sve isto", pa ekipa bez posla na nalog dugmetom; Poništi skida samo ekipu', async () => {
        expect(await sendSlots(new Date(`${FRI}T14:30:00+01:00`), TZ)).toBe(1);
        let v: { text: string; buttons?: { text: string; data: string }[][] } = sent[sent.length - 1];
        const press = async (label: string) => {
            const b = v.buttons!.flat().find(x => x.text === label) || v.buttons!.flat().find(x => x.text.includes(label));
            if (!b) throw new Error(`Nema „${label}": ${v.buttons!.flat().map(x => x.text).join(' | ')}`);
            const [, id, action, stamp] = b.data.split(':');
            v = await handleSlotButton(link(), id, action, new Date(`${FRI}T14:35:00+01:00`), TZ, stamp);
            return v;
        };
        expect(v.buttons!.flat()[0].text).toBe('👷 Upis dana · 4 radnika');
        await press('Upis dana');
        expect(v.text).toContain('2 radnika na 2 naloga · za još 2 pitam poslije');
        await press('Sve isto');
        expect(ordersOf('amer', FRI)).toEqual(['rk']);
        expect(ordersOf('tarik', FRI)).toEqual(['rs']);
        expect(v.text).toContain('Edin i Haso — Lejla - Garderober je završen. Na čemu su danas?');
        // Završeni garderober nije među ponuđenim nalozima.
        expect(v.buttons!.flat().map(b => b.text)).toEqual(['Kovač - Kuhinja', 'Sto za Tarika', 'Nisu radili', 'Preskoči', '‹ Nazad']);
        await press('Kovač - Kuhinja');
        expect(ordersOf('edin', FRI)).toEqual(['rk']);
        expect(ordersOf('haso', FRI)).toEqual(['rk']);
        expect(v.text).toContain('✅ Dan upisan (danas): 2 radnika');
        expect(v.text).toContain('✅ Edin, Haso: Kovač - Kuhinja');
        await press('Poništi zadnje');
        expect(ordersOf('edin', FRI)).toEqual([]);
        expect(ordersOf('amer', FRI)).toEqual(['rk']);
    });

    it('subota: „…ne rade jer je vikend, ostali rade" — imenovani Vikend, ostali po zadnjem danu i kad im kalendar kaže Vikend; bez posla se kaže', async () => {
        for (const w of WORKERS) store.set(`worker_attendance/v-${w.value.id}`, { Attendance_ID: `v-${w.value.id}`, Organization_ID: 'org1', Worker_ID: w.value.id, Worker_Name: w.value.name, Date: SAT, Status: 'Vikend', Created_Date: '2026-11-10T00:00:00Z' });
        const message = 'Amer i Edin danas ne rade jer je vikend, ostali rade';
        const env = {
            orgId: 'org1', uid: 'u1', tz: TZ, now: new Date(`${SAT}T09:00:00Z`), turnId: 'sat1', dateText: '', reporter: 'ja', searchHits: [],
            created: { taskIds: [], memoryIds: [] }, changes: [], summaries: [], groundText: message, messageText: message, workerGround: message,
            ctx: { projects: [], suppliers: [], memory: [], tasks: [], names: [], workers: WORKERS, orders: [{ alias: 'R1', value: { id: 'rk', name: 'Kovač - Kuhinja' } }, { alias: 'R2', value: { id: 'rs', name: 'Sto za Tarika' } }] },
        } as unknown as ToolEnv;
        const res = await runTool(env, 'log_work', { absent: [{ worker: 'W1', status: 'Vikend' }, { worker: 'W2', status: 'Vikend' }], others_like_last: true });
        expect(res).toMatchObject({ ok: true });
        expect(ordersOf('tarik', SAT)).toEqual(['rs']);
        // Hasin petak je poništen: zadnji posao mu je završen garderober — ERP to kaže, ne pogađa.
        expect(ordersOf('haso', SAT)).toEqual([]);
        expect(env.summaries.join(' ')).toContain('Zadnji posao im je završen (reci na čemu su sad): Haso (Lejla - Garderober)');
        expect(ordersOf('amer', SAT)).toEqual([]);
        expect(ordersOf('edin', SAT)).toEqual([]);
        const att = (w: string) => docs('worker_attendance').find(a => a.Worker_ID === w && String(a.Date).startsWith(SAT))?.Status;
        expect(att('amer')).toBe('Vikend');
        await undoTurn('sat1', 'u1');
    });
});
