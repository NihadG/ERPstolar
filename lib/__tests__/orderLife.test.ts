/**
 * @jest-environment node
 */
// Životni tok naloga (lib/orderLife.ts): ekipa prati rad, nalog s radom je pokrenut kao u ERP-u,
// svi proizvodi završeni = nalog završen. Posao iz riječi: bez riječi procesa, liste naloga.

import { closeFields, crewAfterWork, crewWithout, orderProblems, productStatusChange, productStatusFor, startFields } from '@/lib/orderLife';
import { matchOrderList, withoutProcessWords, type DiaryTarget } from '@/lib/workDiary';
import { saidAsJob } from '@/lib/assistant/tools';

jest.mock('@/lib/server/firebaseAdmin', () => require('@/lib/testing/fakeFirestore').firebaseAdminMock);

const amer = { Worker_ID: 'amer', Worker_Name: 'Amer Hodžić', Daily_Rate: 100 };
const edin = { Worker_ID: 'edin', Worker_Name: 'Edin Kovač', Daily_Rate: 120 };

describe('ekipa naloga prati rad', () => {
    it('ko je radio a nije dodijeljen ulazi u ekipu, s oznakom da ga je dodao bot', () => {
        expect(crewAfterWork({ ID: 'i' }, [amer, edin])).toEqual([{ ...amer, Source: 'telegram' }, { ...edin, Source: 'telegram' }]);
    });

    it('već dodijeljen (u ekipi, na procesu ili kao pomoćnik) se ne dodaje ponovo', () => {
        expect(crewAfterWork({ ID: 'i', Assigned_Workers: [amer] }, [amer])).toBeNull();
        expect(crewAfterWork({ ID: 'i', Processes: [{ Worker_ID: 'amer', Helpers: [{ Worker_ID: 'edin' }] }] }, [amer, edin])).toBeNull();
        expect(crewAfterWork({ ID: 'i', Assigned_Workers: [amer] }, [amer, edin, edin])).toEqual([amer, { ...edin, Source: 'telegram' }]);
    });

    it('skida se samo dodjela koju je napravio bot; dodjela iz ERP-a ostaje', () => {
        expect(crewWithout({ ID: 'i', Assigned_Workers: [amer, { ...edin, Source: 'telegram' }] }, 'edin')).toEqual([amer]);
        expect(crewWithout({ ID: 'i', Assigned_Workers: [amer] }, 'amer')).toBeNull();
        expect(crewWithout({ ID: 'i' }, 'amer')).toBeNull();
    });
});

describe('nalog s radom je pokrenut — ista polja kao „Pokreni" u ERP-u', () => {
    const now = '2026-11-16T09:00:00.000Z';

    it('nalog na čekanju: U toku, početak tim danom, u Planeru do roka', () => {
        expect(startFields({ Status: 'Na čekanju', Due_Date: '2026-11-25' }, [], '2026-11-16', now)).toEqual({
            Status: 'U toku', Started_At: '2026-11-16T07:00:00.000Z',
            Is_Scheduled: true, Planned_Start_Date: '2026-11-16', Planned_End_Date: '2026-11-25', Scheduled_At: now,
        });
    });

    it('bez roka: kraj iz planiranih dana stavki, inače sedam dana', () => {
        // pon 16.11. + 4 radna dana = čet 19.11.
        expect(startFields({ Status: 'Na čekanju' }, [{ Planned_Labor_Days: 2, Quantity: 2 }], '2026-11-16', now)).toMatchObject({ Planned_End_Date: '2026-11-19' });
        expect(startFields({ Status: 'Na čekanju' }, [], '2026-11-16', now)).toMatchObject({ Planned_End_Date: '2026-11-23' });
    });

    it('rad prije upisanog početka pomjera početak unazad; plan zakazan za kasnije počinje danom rada', () => {
        expect(startFields({ Status: 'U toku', Started_At: '2026-11-16T06:12:00.000Z', Is_Scheduled: true, Planned_Start_Date: '2026-11-16' }, [], '2026-11-12', now))
            .toEqual({ Started_At: '2026-11-12T07:00:00.000Z', Planned_Start_Date: '2026-11-12' });
    });

    it('nalog koji već živi se ne dira; završen i otkazan se ne pokreću', () => {
        expect(startFields({ Status: 'U toku', Started_At: '2026-11-10T07:00:00.000Z', Is_Scheduled: true, Planned_Start_Date: '2026-11-10' }, [], '2026-11-16', now)).toBeNull();
        expect(startFields({ Status: 'Završeno' }, [], '2026-11-16', now)).toBeNull();
        expect(startFields({ Status: 'Otkazano' }, [], '2026-11-16', now)).toBeNull();
    });
});

describe('svi proizvodi završeni → nalog završen', () => {
    it('danom zadnjeg završenog proizvoda', () => {
        expect(closeFields({ Status: 'U toku' }, [
            { Status: 'Završeno', Completed_At: '2026-11-04T15:00:00.000Z' }, { Status: 'Završeno', Completed_At: '2026-11-12T15:00:00.000Z' },
        ])).toEqual({ Status: 'Završeno', Completed_At: '2026-11-12T15:00:00.000Z' });
    });

    it('dok ijedan proizvod nije gotov, nalog ostaje otvoren; već završen se ne dira', () => {
        expect(closeFields({ Status: 'U toku' }, [{ Status: 'Završeno', Completed_At: '2026-11-04T15:00:00.000Z' }, { Status: 'U toku' }])).toBeNull();
        expect(closeFields({ Status: 'Završeno' }, [{ Status: 'Završeno', Completed_At: '2026-11-04T15:00:00.000Z' }])).toBeNull();
        expect(closeFields({ Status: 'U toku' }, [])).toBeNull();
    });
});

describe('status proizvoda na projektu prati stavku naloga', () => {
    const p = (Process_Name: string, Status: string) => ({ Process_Name, Status });

    it('proces u toku; bez njega zadnji završen; završena stavka = Spremno (montaža zadnja = Instalirano)', () => {
        expect(productStatusFor({ Status: 'U toku', Processes: [p('Krojenje iverala', 'Završeno'), p('Lijepljenje Kerrocka', 'U toku'), p('Okivanje', 'Na čekanju')] })).toBe('Lijepljenje Kerrocka');
        expect(productStatusFor({ Status: 'U toku', Processes: [p('Krojenje iverala', 'Završeno'), p('Okivanje', 'Na čekanju')] })).toBe('Krojenje iverala');
        expect(productStatusFor({ Status: 'Završeno', Processes: [p('Krojenje iverala', 'Završeno'), p('Okivanje', 'Završeno')] })).toBe('Spremno');
        expect(productStatusFor({ Status: 'Završeno', Processes: [p('Okivanje', 'Završeno'), p('Montaža', 'Završeno')] })).toBe('Instalirano');
        expect(productStatusFor({ Status: 'Na čekanju', Processes: [] })).toBe('Na čekanju');
    });

    it('mijenja se naprijed i na tekući korak; gotov proizvod se ne vraća', () => {
        const working = { Status: 'U toku', Processes: [p('Krojenje iverala', 'Završeno'), p('Lijepljenje Kerrocka', 'U toku')] };
        expect(productStatusChange('Krojenje iverala', working)).toBe('Lijepljenje Kerrocka');
        expect(productStatusChange('Materijali spremni', working)).toBe('Lijepljenje Kerrocka');
        expect(productStatusChange('Lijepljenje Kerrocka', working)).toBeNull();
        expect(productStatusChange('Instalirano', working)).toBeNull();
        expect(productStatusChange('Lakiranje', { Status: 'Završeno', Processes: [p('Lakiranje', 'Završeno')] })).toBe('Spremno');
    });
});

describe('provjera pravila nad svim nalozima', () => {
    const base = { today: '2026-11-16', products: [{ Product_ID: 'p1', Status: 'Krojenje iverala' }] };
    const log = (Work_Order_ID: string, Worker_ID: string, Date: string) => ({ Work_Order_ID, Worker_ID, Worker_Name: Worker_ID, Date });

    it('nalog kakav je bot ostavljao: rad upisan, a čeka, bez ekipe, bez plana', () => {
        const rules = orderProblems({
            ...base,
            orders: [{ Work_Order_ID: 'a', Name: 'Brdo - Noćni ormarići', Status: 'Na čekanju', Work_Order_Type: 'Proizvodnja' }],
            items: [{ ID: 'ai', Work_Order_ID: 'a', Product_ID: 'p9', Status: 'Na čekanju' }],
            logs: [log('a', 'amer', '2026-11-14'), log('a', 'edin', '2026-11-16')],
        }).map(x => x.rule);
        expect(rules).toEqual(['ceka', 'ekipa', 'plan']);
    });

    it('pokrenut poslije prvog rada, van Planera, svi proizvodi gotovi a otvoren, projekat na starom koraku', () => {
        const found = orderProblems({
            ...base,
            orders: [
                { Work_Order_ID: 'b', Name: 'Brdo stolovi', Status: 'U toku', Work_Order_Type: 'Proizvodnja', Started_At: '2026-11-16T06:00:00.000Z', Process_Graph: { nodes: [{}] } },
                { Work_Order_ID: 'c', Name: 'Hamza vrata', Status: 'U toku', Work_Order_Type: 'Proizvodnja', Started_At: '2026-10-01T07:00:00.000Z', Is_Scheduled: true },
            ],
            items: [
                { ID: 'bi', Work_Order_ID: 'b', Product_ID: 'p1', Product_Name: 'Sto', Status: 'U toku', Assigned_Workers: [amer],
                    Processes: [{ Process_Name: 'Krojenje iverala', Status: 'Završeno' }, { Process_Name: 'Lijepljenje Kerrocka', Status: 'U toku' }] },
                { ID: 'ci', Work_Order_ID: 'c', Product_ID: 'p2', Status: 'Završeno', Processes: [{ Process_Name: 'Okivanje', Status: 'Završeno' }] },
            ],
            logs: [log('b', 'amer', '2026-11-13')],
        });
        expect(found.map(x => `${x.order}: ${x.rule}`)).toEqual(['Brdo stolovi: planer', 'Brdo stolovi: pocetak', 'Brdo stolovi: proizvod', 'Hamza vrata: otvoren']);
        expect(found[2].detail).toBe('Sto: na projektu „Krojenje iverala", u nalogu „Lijepljenje Kerrocka"');
    });

    it('nalog koji živi kako treba, završen nalog i stari rad van ekipe nisu odstupanje', () => {
        expect(orderProblems({
            ...base,
            orders: [
                { Work_Order_ID: 'd', Name: 'Uredan', Status: 'U toku', Work_Order_Type: 'Zadaci', Started_At: '2026-10-15T07:00:00.000Z', Is_Scheduled: true },
                { Work_Order_ID: 'e', Name: 'Gotov', Status: 'Završeno' },
            ],
            items: [{ ID: 'di', Work_Order_ID: 'd', Item_Type: 'custom', Status: 'U toku', Assigned_Workers: [amer] }, { ID: 'ei', Work_Order_ID: 'e', Status: 'Završeno' }],
            logs: [log('d', 'amer', '2026-11-16'), log('d', 'edin', '2026-10-20'), log('e', 'edin', '2026-11-15')],
        })).toEqual([]);
    });
});

describe('posao rečen zajedno s procesom', () => {
    const vocabulary = ['Lijepljenje Kerrocka', 'Krojenje iverala', 'Okivanje', 'Montaža'];

    it('riječi procesa nisu naziv naloga', () => {
        expect(withoutProcessWords('lijepljenje Kerrocka za Brdo', 'Lijepljenje Kerrocka', vocabulary)).toBe('za brdo');
        expect(withoutProcessWords('lijepe kerrock za Brdo', undefined, vocabulary)).toBe('za brdo');
        expect(withoutProcessWords('okivaju umivaonike za Švicarsku', 'okivanje', vocabulary)).toBe('umivaonike za svicarsku');
    });

    it('vrsta proizvoda ostaje i kad je ima u nazivu procesa', () => {
        expect(withoutProcessWords('montiraju vrata na Brdu', undefined, [...vocabulary, 'Montaža vrata'])).toBe('vrata na brdu');
    });
});

describe('nalozi kako su rečeni za stanje', () => {
    const t = (workOrderId: string, workOrderName: string, projectName: string, finished = false): DiaryTarget =>
        ({ workOrderId, workOrderName, itemId: `${workOrderId}-i`, productId: '', productName: '', projectName, finished });
    const targets = [
        t('h1', 'Hamza - Kuhinja', 'Tarik Hamza - Kuća'),
        t('h2', 'Hamza - Vrata 2. faza', 'Tarik Hamza - Kuća'),
        t('h3', 'Hamza - Garderoberi u dječijoj sobi', 'Tarik Hamza - Kuća'),
        t('h4', 'Hamza - Amra i Edo Garderoberi', 'Tarik Hamza - Kuća'),
        t('h0', 'Hamza - Ostrvo', 'Tarik Hamza - Kuća', true),
        t('b1', 'Brdo Švedski stolovi', 'Hotel Brdo'),
        t('b2', 'Brdo - Garderoberi', 'Hotel Brdo'),
    ];
    const ids = (q: string) => { const m = matchOrderList(q, targets); return m.kind === 'ok' ? m.orders.map(o => o.workOrderId).sort() : m.kind; };

    it('„sve naloge za Hamzu" = svi njegovi otvoreni nalozi', () => {
        expect(ids('sve naloge za Hamzu')).toEqual(['h1', 'h2', 'h3', 'h4']);
    });

    it('lista: klijent rečen jednom važi za sve dijelove; sama vrsta proizvoda = svi takvi njegovi nalozi', () => {
        expect(ids('vrata za Hamzu, garderoberi, dječiji garderoberi')).toEqual(['h2', 'h3', 'h4']);
        expect(ids('kuhinja i vrata za Hamzu')).toEqual(['h1', 'h2']);
    });

    it('jedan nalog ostaje jedan; završeni se ne biraju', () => {
        expect(ids('švedski stolovi za Brdo')).toEqual(['b1']);
        expect(ids('ostrvo za Hamzu')).toBe('none');
    });

    it('lista bez klijenta, a vrsta postoji kod dva klijenta → pitanje, ne pogađanje', () => {
        expect(ids('garderoberi, švedski stolovi')).toBe('ambiguous');
    });
});

describe('„razni poslovi" uz novi nalog', () => {
    it('rečeno uz naziv ili u opisu posla → posao bez proizvoda', () => {
        expect(saidAsJob('amer i edin montiraju vrata na brdu (novi razni poslovi nalog: Brdo preostala vrata)', 'Brdo preostala vrata')).toBe(true);
        expect(saidAsJob('', 'Brdo preostala vrata', 'novi razni poslovi nalog: Brdo preostala vrata')).toBe(true);
        expect(saidAsJob('napravi nalog Selidba, razno', 'Selidba')).toBe(true);
    });

    it('nije rečeno, ili je rečeno za drugi nalog daleko u poruci → nije', () => {
        expect(saidAsJob('napravi nalog Noćni ormarići za hotel Brdo', 'Noćni ormarići')).toBe(false);
        expect(saidAsJob(`novi razni poslovi nalog Selidba. ${'Amer i Edin su jučer cijeli dan radili na stolovima u radionici. '.repeat(2)}Napravi nalog Noćni ormarići`, 'Noćni ormarići')).toBe(false);
    });
});
