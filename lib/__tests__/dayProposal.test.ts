import { buildDayProposal, findGaps, isWorkingDay } from '../dayProposal';
import { gapsNote, lineText, proposalMessage } from '../assistant/dayProposalText';

const DAY = '2026-10-23'; // petak
const workers = [
    { Worker_ID: 'amer', Name: 'Amer' }, { Worker_ID: 'kerim', Name: 'Kerim' }, { Worker_ID: 'edin', Name: 'Edin' },
    { Worker_ID: 'imer', Name: 'Imer' }, { Worker_ID: 'senad', Name: 'Senad' }, { Worker_ID: 'haris', Name: 'Haris' },
];
const log = (date: string, worker: string, wo: string, item: string, process?: string, extra: Record<string, unknown> = {}) => ({
    Date: date, Worker_ID: worker, Work_Order_ID: wo, Work_Order_Item_ID: item, Process_Name: process,
    Booking_Source: 'manual' as const, Entry_Source: 'telegram' as const, Is_From_Attendance: false, ...extra,
});
const orders = [
    { Work_Order_ID: 'r9', Name: 'Begović - Vrata', Status: 'U toku' as const,
        Process_Graph: { nodes: [{ id: 'br', name: 'Brušenje', itemIds: [] }, { id: 'la', name: 'Lakiranje', itemIds: [] }], edges: [{ id: 'e', source: 'br', target: 'la' }] },
        items: [
            { ID: 'v1', Product_Name: 'Vrata ulazna', Status: 'U toku' as const, Processes: [{ Process_Name: 'Brušenje', Status: 'U toku' as const }] },
            { ID: 'v2', Product_Name: 'Vrata sobna', Status: 'U toku' as const, Processes: [{ Process_Name: 'Brušenje', Status: 'U toku' as const }] },
        ] },
    { Work_Order_ID: 'r7', Name: 'Čorluka - Kuhinja', Status: 'U toku' as const,
        Process_Graph: { nodes: [{ id: 'ka', name: 'Kantiranje', itemIds: [] }, { id: 'sk', name: 'Sklapanje', itemIds: [] }], edges: [{ id: 'e', source: 'ka', target: 'sk' }] },
        items: [
            { ID: 'k1', Product_Name: 'Donji elementi', Status: 'U toku' as const, Processes: [{ Process_Name: 'Kantiranje', Status: 'Završeno' as const }, { Process_Name: 'Sklapanje', Status: 'Na čekanju' as const }] },
            { ID: 'k2', Product_Name: 'Gornji elementi', Status: 'Završeno' as const, Processes: [] },
        ] },
    { Work_Order_ID: 'r3', Name: 'Meliha - Vrata', Status: 'Završeno' as const, items: [{ ID: 'm1', Product_Name: 'Vrata', Status: 'Završeno' as const, Processes: [] }] },
];
const logs = [
    log('2026-10-22', 'amer', 'r9', 'v1', 'Brušenje'), log('2026-10-22', 'amer', 'r9', 'v2', 'Brušenje'),
    log('2026-10-22', 'kerim', 'r9', 'v1', 'Brušenje'), log('2026-10-22', 'kerim', 'r9', 'v2', 'Brušenje'),
    log('2026-10-21', 'edin', 'r7', 'k1', 'Kantiranje'), log('2026-10-21', 'edin', 'r7', 'k2', 'Kantiranje'),
    // Imer: pola-pola, jedno od toga na završenom nalogu → ostaje pun dan na drugom.
    log('2026-10-22', 'imer', 'r9', 'v1', 'Brušenje', { Day_Weight: 0.5 }), log('2026-10-22', 'imer', 'r3', 'm1', 'Montaža', { Day_Weight: 0.5 }),
    // Senad ima samo automatsku podjelu — nema potvrđenog dana.
    log('2026-10-22', 'senad', 'r9', 'v1', 'Brušenje', { Booking_Source: 'attendance', Entry_Source: undefined, Is_From_Attendance: true }),
    // Haris je danas već izdiktiran.
    log(DAY, 'haris', 'r7', 'k1', 'Sklapanje'), log('2026-10-22', 'haris', 'r9', 'v1', 'Brušenje'),
];
const attendance = [
    { Worker_ID: 'kerim', Date: DAY, Status: 'Bolovanje' },
    { Worker_ID: 'senad', Date: DAY, Status: 'Prisutan' },
];

describe('prijedlog dana', () => {
    const p = buildDayProposal({ date: DAY, workers, logs, attendance, orders });

    it('isti posao više radnika = jedan red; odsutan i već upisan ne ulaze', () => {
        expect(p.absent).toEqual(['Kerim']);
        expect(p.booked).toEqual(['Haris']);
        const brus = p.lines.find(l => l.process === 'Brušenje' && l.itemIds.length === 2)!;
        expect(brus).toMatchObject({ workerNames: ['Amer'], workOrderId: 'r9', productNames: [] });
    });

    it('završen proces → sljedeći korak iz grafa; završen proizvod otpada', () => {
        expect(p.lines.find(l => l.workerNames.includes('Edin'))).toMatchObject({
            workOrderId: 'r7', itemIds: ['k1'], process: 'Sklapanje', next: true, productNames: [],
        });
    });

    it('posao na završenom nalogu otpada; preostali posao je pun dan (bez udjela)', () => {
        const imer = p.lines.filter(l => l.workerNames.includes('Imer'));
        expect(imer).toEqual([expect.objectContaining({ workOrderId: 'r9', itemIds: ['v1'], process: 'Brušenje', productNames: ['Vrata ulazna'] })]);
        expect(imer[0].fraction).toBeUndefined();
    });

    it('prisutan radnik bez potvrđenog rada = bez prijedloga', () => {
        expect(p.unknown).toEqual(['Senad']);
        expect(p.lines.some(l => l.workerNames.includes('Senad'))).toBe(false);
    });

    it('udio dana se zadrži kad oba posla ostanu', () => {
        const q = buildDayProposal({
            date: DAY, workers: [workers[0]], attendance: [], orders,
            logs: [log('2026-10-22', 'amer', 'r9', 'v1', 'Brušenje', { Day_Weight: 0.25 }), log('2026-10-22', 'amer', 'r7', 'k1', 'Sklapanje', { Day_Weight: 0.75 })],
        });
        expect(q.lines.map(l => [l.workOrderId, l.fraction])).toEqual([['r9', 0.25], ['r7', 0.75]]);
    });

    it('sve završeno → radnik bez prijedloga (ako je prisutan)', () => {
        const q = buildDayProposal({
            date: DAY, workers: [workers[0]], orders,
            attendance: [{ Worker_ID: 'amer', Date: `${DAY}T00:00:00`, Status: 'Prisutan' }],
            logs: [log('2026-10-22', 'amer', 'r3', 'm1', 'Montaža')],
        });
        expect(q).toMatchObject({ lines: [], unknown: ['Amer'] });
    });

    it('stariji od 14 dana se ne gleda (pozivalac daje samo prozor) — bez ranijeg dana nema reda', () => {
        expect(buildDayProposal({ date: DAY, workers: [workers[0]], logs: [], attendance: [], orders }).lines).toEqual([]);
    });
});

describe('poruka prijedloga', () => {
    const p = buildDayProposal({ date: DAY, workers, logs, attendance, orders });

    it('tekst stavke', () => {
        expect(lineText(p.lines.find(l => l.workerNames.includes('Edin'))!)).toBe('Edin — Sklapanje (sljedeći korak) · Čorluka - Kuhinja');
        expect(lineText({ workerIds: [], workerNames: ['Amer'], workOrderId: 'x', workOrderName: 'N', itemIds: [], productNames: ['A'], fraction: 0.5 })).toBe('Amer — N (A) · ½ dana');
    });

    it('dugme po stavci (uključeno/isključeno) + upiši/preskoči', () => {
        const m = proposalMessage(p, 'P1', [1], DAY)!;
        expect(m.text).toMatch(/^📝 Prijedlog rada za danas, pet 23\.10\./);
        expect(m.text).toMatch(/⬜ 2\./);
        expect(m.text).toMatch(/Bez prijedloga \(izdiktiraj ih\): Senad/);
        expect(m.text).toMatch(/Odsutni: Kerim/);
        expect(m.buttons.at(-1)).toEqual([{ text: `💾 Upiši označeno (${p.lines.length - 1})`, data: 'dp:P1:ok' }, { text: 'Preskoči', data: 'dp:P1:no' }]);
        expect(m.buttons[1][0]).toMatchObject({ data: 'dp:P1:t:1' });
        expect(m.buttons[1][0].text.startsWith('⬜')).toBe(true);
        m.buttons.flat().forEach(b => expect(Buffer.byteLength(b.data)).toBeLessThanOrEqual(64));
    });

    it('ništa za predložiti → nema poruke', () => {
        expect(proposalMessage({ date: DAY, lines: [], booked: ['A'], absent: [], unknown: [] }, 'P', [], DAY)).toBeNull();
    });
});

describe('rupe u upisu', () => {
    const TODAY = '2026-10-27'; // utorak
    const wlogs = [
        log('2026-10-21', 'amer', 'r9', 'v1', 'Brušenje'),           // prvi diktat Amera (sri)
        log('2026-10-22', 'amer', 'r9', 'v1', 'Brušenje'),
        log('2026-10-23', 'amer', 'r9', 'v1', undefined, { Entry_Source: undefined }), // ručno iz Knjige rada = potvrđeno
        log('2026-10-24', 'kerim', 'r9', 'v1', 'Brušenje'),           // Kerimov prvi diktat (subota)
        log('2026-10-20', 'edin', 'r9', 'v1', 'x', { Booking_Source: 'attendance', Entry_Source: undefined, Is_From_Attendance: true }),
    ];
    const att = [
        { Worker_ID: 'kerim', Date: '2026-10-24', Status: 'Prisutan' },
        { Worker_ID: 'amer', Date: '2026-10-26', Status: 'Odmor' },
    ];
    const gaps = findGaps({ today: TODAY, days: 7, workers, logs: wlogs, attendance: att });

    it('prati se od prvog diktata; odsutan dan i ručni upis nisu rupe; vikend bez rada se preskače', () => {
        expect(gaps).toEqual([{ date: '2026-10-26', workers: ['Kerim'] }]);
    });

    it('subota je radni dan samo uz prisustvo', () => {
        expect(isWorkingDay('2026-10-24', att)).toBe(true);
        expect(isWorkingDay('2026-10-25', att)).toBe(false);
        expect(isWorkingDay('2026-10-26', [])).toBe(true);
    });

    it('jutarnja napomena s dugmadima za najnovije dane', () => {
        const n = gapsNote([{ date: '2026-10-26', workers: ['Kerim'] }, { date: '2026-10-23', workers: ['Amer', 'Kerim'] }])!;
        expect(n.text).toBe('📝 Nije upisan rad (2 dana):\n• pon 26.10. — Kerim\n• pet 23.10. — Amer, Kerim');
        expect(n.buttons).toEqual([[{ text: '📝 Prijedlog za pon 26.10.', data: 'gap:2026-10-26' }], [{ text: '📝 Prijedlog za pet 23.10.', data: 'gap:2026-10-23' }]]);
        expect(gapsNote([])).toBeNull();
    });
});
