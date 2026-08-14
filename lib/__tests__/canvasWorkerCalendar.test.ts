import {
    buildWorkerCalendar, workerLoadStats, isoWeekNumber, mondayOf, shiftMonth,
    type WorkerCalendarCtx,
} from '../canvas/workerCalendar';
import { newBlock } from '../canvas/model';
import type { PlanBlock, WorkerAttendance, WorkOrder } from '../types';

const TODAY = '2026-08-14';

const att = (workerId: string, date: string, status: WorkerAttendance['Status']): WorkerAttendance =>
    ({ Worker_ID: workerId, Date: date, Status: status } as WorkerAttendance);

const ctx = (over: Partial<WorkerCalendarCtx> = {}): WorkerCalendarCtx => ({
    blocks: [],
    attendance: [],
    workOrders: [],
    ...over,
});

const orderFor = (workerIds: string[], s: string, e: string, title = 'Nalog'): PlanBlock =>
    newBlock('order', s, e, { title, workerRefs: workerIds.map(id => ({ id, name: id })) });

/** Svi dani mreže, spljošteni. */
const flat = (m: ReturnType<typeof buildWorkerCalendar>) => m.weeks.flatMap(w => w.days);
const dayOf = (m: ReturnType<typeof buildWorkerCalendar>, iso: string) =>
    flat(m).find(d => d.dateISO === iso)!;

describe('mreža mjeseca', () => {
    test('sedmice počinju ponedjeljkom i imaju po 7 dana', () => {
        const m = buildWorkerCalendar('w1', '2026-08', ctx(), TODAY);
        expect(m.weeks.every(w => w.days.length === 7)).toBe(true);
        // 2026-08-01 je subota → mreža počinje u ponedjeljak 27.07.
        expect(m.weeks[0].days[0].dateISO).toBe('2026-07-27');
        expect(m.weeks[0].days[6].dateISO).toBe('2026-08-02');
    });

    test('dani susjednih mjeseci su u mreži ali označeni kao vanjski', () => {
        const m = buildWorkerCalendar('w1', '2026-08', ctx(), TODAY);
        expect(dayOf(m, '2026-07-31').inMonth).toBe(false);
        expect(dayOf(m, '2026-08-01').inMonth).toBe(true);
        // Svi dani mjeseca su prisutni
        const inMonth = flat(m).filter(d => d.inMonth);
        expect(inMonth).toHaveLength(31);
    });

    test('mjesec koji počinje u ponedjeljak ne dobija praznu vodeću sedmicu', () => {
        // 2026-06-01 je ponedjeljak
        const m = buildWorkerCalendar('w1', '2026-06', ctx(), TODAY);
        expect(m.weeks[0].days[0].dateISO).toBe('2026-06-01');
    });

    test('današnji dan je označen', () => {
        const m = buildWorkerCalendar('w1', '2026-08', ctx(), TODAY);
        expect(dayOf(m, TODAY).isToday).toBe(true);
        expect(flat(m).filter(d => d.isToday)).toHaveLength(1);
    });
});

describe('radni dani', () => {
    test('nedjelja nikad nije radni dan', () => {
        const m = buildWorkerCalendar('w1', '2026-08', ctx(), TODAY);
        expect(dayOf(m, '2026-08-16').isWorkingDay).toBe(false);   // nedjelja
        expect(dayOf(m, '2026-08-17').isWorkingDay).toBe(true);    // ponedjeljak
    });

    test('subota radi po rotaciji', () => {
        const noSaturdays = ctx({ isSaturdayWorking: () => false });
        const m = buildWorkerCalendar('w1', '2026-08', noSaturdays, TODAY);
        expect(dayOf(m, '2026-08-15').isWorkingDay).toBe(false);   // subota, rotacija ne radi
        // Bez pravila subota radi
        const m2 = buildWorkerCalendar('w1', '2026-08', ctx(), TODAY);
        expect(dayOf(m2, '2026-08-15').isWorkingDay).toBe(true);
    });
});

describe('blokovi i sudari', () => {
    test('blok se pojavi na svakom danu svog raspona, samo za svog radnika', () => {
        const c = ctx({ blocks: [orderFor(['w1'], '2026-08-17', '2026-08-19', 'Kuhinja')] });
        const m = buildWorkerCalendar('w1', '2026-08', c, TODAY);
        expect(dayOf(m, '2026-08-17').blocks.map(b => b.title)).toEqual(['Kuhinja']);
        expect(dayOf(m, '2026-08-19').blocks).toHaveLength(1);
        expect(dayOf(m, '2026-08-20').blocks).toHaveLength(0);

        const other = buildWorkerCalendar('w2', '2026-08', c, TODAY);
        expect(dayOf(other, '2026-08-17').blocks).toHaveLength(0);
    });

    test('dva posla u istom danu su sudar', () => {
        const c = ctx({
            blocks: [
                orderFor(['w1'], '2026-08-17', '2026-08-20', 'A'),
                orderFor(['w1'], '2026-08-19', '2026-08-21', 'B'),
            ],
        });
        const m = buildWorkerCalendar('w1', '2026-08', c, TODAY);
        expect(dayOf(m, '2026-08-18').conflict).toBe(false);
        expect(dayOf(m, '2026-08-19').conflict).toBe(true);
        expect(dayOf(m, '2026-08-21').conflict).toBe(false);
    });

    test('posao preko odsustva je sudar', () => {
        const c = ctx({
            blocks: [orderFor(['w1'], '2026-08-17', '2026-08-19')],
            attendance: [att('w1', '2026-08-18', 'Bolovanje')],
        });
        const m = buildWorkerCalendar('w1', '2026-08', c, TODAY);
        expect(dayOf(m, '2026-08-18').absence).toBe('Bolovanje');
        expect(dayOf(m, '2026-08-18').conflict).toBe(true);
    });

    test('prekretnica i napomena ne troše dan radnika', () => {
        const c = ctx({
            blocks: [
                newBlock('milestone', '2026-08-18', '2026-08-18', {
                    title: 'Rok', workerRefs: [{ id: 'w1', name: 'w1' }],
                }),
                newBlock('note', '2026-08-18', '2026-08-18', {
                    title: 'Napomena', workerRefs: [{ id: 'w1', name: 'w1' }],
                }),
            ],
        });
        const m = buildWorkerCalendar('w1', '2026-08', c, TODAY);
        expect(dayOf(m, '2026-08-18').blocks).toHaveLength(0);
        expect(dayOf(m, '2026-08-18').free).toBe(true);
    });
});

describe('odsustva', () => {
    test('Odmor/Bolovanje/Odsutan se prikazuju', () => {
        const c = ctx({
            attendance: [
                att('w1', '2026-08-17', 'Odmor'),
                att('w1', '2026-08-18', 'Bolovanje'),
                att('w1', '2026-08-19', 'Odsutan'),
            ],
        });
        const m = buildWorkerCalendar('w1', '2026-08', c, TODAY);
        expect(dayOf(m, '2026-08-17').absence).toBe('Odmor');
        expect(dayOf(m, '2026-08-18').absence).toBe('Bolovanje');
        expect(dayOf(m, '2026-08-19').absence).toBe('Odsutan');
    });

    test('Praznik ne crta odsustvo ali oduzima raspoloživ dan', () => {
        const c = ctx({ attendance: [att('w1', '2026-08-17', 'Praznik' as WorkerAttendance['Status'])] });
        const m = buildWorkerCalendar('w1', '2026-08', c, TODAY);
        expect(dayOf(m, '2026-08-17').absence).toBeUndefined();
        expect(dayOf(m, '2026-08-17').free).toBe(false);
    });

    test('Prisutan/Teren ne oduzimaju dan', () => {
        const c = ctx({
            attendance: [att('w1', '2026-08-17', 'Prisutan'), att('w1', '2026-08-18', 'Teren')],
        });
        const m = buildWorkerCalendar('w1', '2026-08', c, TODAY);
        expect(dayOf(m, '2026-08-17').free).toBe(true);
        expect(dayOf(m, '2026-08-18').free).toBe(true);
    });
});

describe('opterećenje', () => {
    test('postotak gleda SAMO traženi raspon', () => {
        const c = ctx({ blocks: [orderFor(['w1'], '2026-08-17', '2026-08-22')] });
        // Sedmica 17–22 (pon–sub) = 6 radnih dana, svi zauzeti
        const week = workerLoadStats('w1', '2026-08-17', '2026-08-22', c, TODAY);
        expect(week.busy).toBe(6);
        expect(week.available).toBe(6);
        expect(week.pct).toBe(100);

        // Isti blok u kontekstu cijelog mjeseca daje mnogo manji postotak
        const month = workerLoadStats('w1', '2026-08-01', '2026-08-31', c, TODAY);
        expect(month.busy).toBe(6);
        expect(month.pct).toBeLessThan(30);
    });

    test('odsustvo smanjuje nazivnik, ne brojnik', () => {
        const c = ctx({ attendance: [att('w1', '2026-08-17', 'Odmor'), att('w1', '2026-08-18', 'Odmor')] });
        const s = workerLoadStats('w1', '2026-08-17', '2026-08-22', c, TODAY);
        expect(s.busy).toBe(0);
        expect(s.available).toBe(4);      // 6 radnih dana − 2 dana odmora
    });

    test('bez raspoloživih dana postotak je 0, ne NaN', () => {
        const c = ctx({ attendance: [att('w1', '2026-08-17', 'Odmor')] });
        const s = workerLoadStats('w1', '2026-08-17', '2026-08-17', c, TODAY);
        expect(s.available).toBe(0);
        expect(s.pct).toBe(0);
    });

    test('statistika mjeseca ne broji rubne dane susjednog mjeseca', () => {
        // Blok je cijeli u julu; mreža avgusta ga vidi u vodećoj sedmici, ali
        // statistika avgusta ga NE smije brojati.
        const c = ctx({ blocks: [orderFor(['w1'], '2026-07-27', '2026-07-31')] });
        const m = buildWorkerCalendar('w1', '2026-08', c, TODAY);
        expect(dayOf(m, '2026-07-28').blocks).toHaveLength(1);
        expect(m.stats.busy).toBe(0);
    });

    test('sudari se broje', () => {
        const c = ctx({
            blocks: [
                orderFor(['w1'], '2026-08-17', '2026-08-20', 'A'),
                orderFor(['w1'], '2026-08-19', '2026-08-20', 'B'),
            ],
        });
        const s = workerLoadStats('w1', '2026-08-01', '2026-08-31', c, TODAY);
        expect(s.conflicts).toBe(2);      // 19. i 20.
    });
});

describe('prvi slobodan dan', () => {
    test('gleda unaprijed od danas i smije izaći iz raspona', () => {
        // Zauzet do kraja avgusta → prvi slobodan je u septembru
        const c = ctx({ blocks: [orderFor(['w1'], '2026-08-10', '2026-08-31')] });
        const s = workerLoadStats('w1', '2026-08-01', '2026-08-31', c, TODAY);
        expect(s.firstFreeISO).toBe('2026-09-01');
    });

    test('preskače nedjelju i odsustvo', () => {
        const c = ctx({
            blocks: [orderFor(['w1'], '2026-08-10', '2026-08-14')],
            attendance: [att('w1', '2026-08-15', 'Odmor')],
        });
        // 14. zauzet, 15. odmor, 16. nedjelja → 17.
        const s = workerLoadStats('w1', '2026-08-01', '2026-08-31', c, TODAY);
        expect(s.firstFreeISO).toBe('2026-08-17');
    });

    test('null kad nema slobodnog dana u dogledno vrijeme', () => {
        const c = ctx({ blocks: [orderFor(['w1'], '2026-08-01', '2027-06-01')] });
        const s = workerLoadStats('w1', '2026-08-01', '2026-08-31', c, TODAY);
        expect(s.firstFreeISO).toBeNull();
    });
});

describe('sjene stvarnog posla', () => {
    test('stvarni nalog pada na svoje dane', () => {
        const wo = {
            Work_Order_ID: 'wo1', Work_Order_Number: 'RN-2214', Name: 'Servis vitrine',
            Status: 'U toku', Planned_Start_Date: '2026-08-17', Due_Date: '2026-08-19',
            items: [{ Assigned_Workers: [{ Worker_ID: 'w1' }] }],
        } as unknown as WorkOrder;
        const m = buildWorkerCalendar('w1', '2026-08', ctx({ workOrders: [wo] }), TODAY);
        expect(dayOf(m, '2026-08-18').shadows.map(s => s.label)).toEqual(['Servis vitrine']);
        expect(dayOf(m, '2026-08-20').shadows).toHaveLength(0);
    });

    test('završen nalog ne pravi sjenu', () => {
        const wo = {
            Work_Order_ID: 'wo1', Work_Order_Number: 'RN-1', Name: 'Gotovo',
            Status: 'Završeno', Planned_Start_Date: '2026-08-17', Due_Date: '2026-08-19',
            items: [{ Assigned_Workers: [{ Worker_ID: 'w1' }] }],
        } as unknown as WorkOrder;
        const m = buildWorkerCalendar('w1', '2026-08', ctx({ workOrders: [wo] }), TODAY);
        expect(dayOf(m, '2026-08-18').shadows).toHaveLength(0);
    });
});

describe('pomoćne funkcije', () => {
    test('ISO broj sedmice', () => {
        expect(isoWeekNumber('2026-08-17')).toBe(34);
        expect(isoWeekNumber('2026-01-01')).toBe(1);
    });

    test('ponedjeljak sedmice', () => {
        expect(mondayOf('2026-08-14')).toBe('2026-08-10');   // petak → ponedjeljak
        expect(mondayOf('2026-08-10')).toBe('2026-08-10');   // ponedjeljak ostaje
        expect(mondayOf('2026-08-16')).toBe('2026-08-10');   // nedjelja pripada svojoj sedmici
    });

    test('pomjeranje mjeseca prelazi godinu', () => {
        expect(shiftMonth('2026-08', 1)).toBe('2026-09');
        expect(shiftMonth('2026-12', 1)).toBe('2027-01');
        expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    });
});
