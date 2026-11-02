/**
 * @jest-environment node
 */
// Revizija 02.11.2026: kontekst razgovora — šta prelazi iz prethodne poruke, a šta ne.
import { continuesPrevious, inheritedAsk } from '@/lib/assistant/continuation';
import { messageIntent } from '@/lib/assistant/intent';
import { orderMentioned } from '@/lib/assistant/grounding';
import { toMessages } from '@/lib/assistant/brain';
import { filterNotebook, notebookListText } from '@/lib/assistant/memoryRules';
import type { MemoryItem } from '@/lib/types';

const facts = { dims: [], widths: [], locations: [] };
const now = new Date('2026-11-02T13:21:00Z');

describe('nastavlja li poruka prethodnu', () => {
    it.each([
        ['A vrata su široka 629', 1],
        ['To je također za Brdo napomena', 1],
        ['Ma, treba mi za vrata Hamze na jedno staklo', 1],
        ['brdo', 1],
        ['ne, u utorak', 2],
    ])('„%s" → nastavak', (text, gap) => expect(continuesPrevious(text, gap)).toBe(true));

    it.each([
        ['Pitati Edina za kant traku bukvu u 11', 5],
        ['Potvrdi mi Leli predračun i reci da može u proizvodnju.', 12],
        ['Napomeni me u 11 da provjerim mjere za stan A501', 3],
    ])('„%s" → nova tema', (text, gap) => expect(continuesPrevious(text, gap)).toBe(false));

    it('poslije 15 minuta ni „a…" nije nastavak; bez prethodne poruke nema nastavka', () => {
        expect(continuesPrevious('A vrata su široka 629', 40)).toBe(false);
        expect(continuesPrevious('brdo', null)).toBe(false);
    });
});

describe('nedovršen zahtjev prelazi na dopunu', () => {
    const unfinished = { kinds: ['reminder' as const], text: 'Provjerit sa Senadom sutra u 8 kako dovući staklo za Hamzu', at: '2026-11-02T13:17:00Z' };

    it('„Ma, treba mi za vrata…" (bot je odgovorio o staklu) i dalje traži podsjetnik', () => {
        expect(inheritedAsk({ unfinished, ownWriteKinds: [], continues: true, answering: false, now })).toBe(unfinished);
    });

    it('nova poruka sa svojim upisom, nova tema ili prošlo vrijeme → ne preuzima', () => {
        expect(inheritedAsk({ unfinished, ownWriteKinds: ['notebook'], continues: true, answering: false, now })).toBeNull();
        expect(inheritedAsk({ unfinished, ownWriteKinds: [], continues: false, answering: false, now })).toBeNull();
        expect(inheritedAsk({ unfinished, ownWriteKinds: [], continues: true, answering: false, now: new Date('2026-11-02T14:00:00Z') })).toBeNull();
    });

    it('odgovor na pitanje bota preuzima i bez riječi nastavka', () => {
        expect(inheritedAsk({ unfinished, ownWriteKinds: [], continues: false, answering: true, now })).toBe(unfinished);
    });
});

describe('budući dan ili sat = podsjetnik, kojim god glagolom', () => {
    const workers = [{ id: 'w-k', name: 'Senad Ibrić' }];

    it('„Provjerit sa senadom sutra u 8 kako dovuci staklo" → podsjetnik u 08:00', () => {
        const i = messageIntent('Provjerit sa senadom sutra u 8 kako dovuci staklo iz stakloreza za hamzu', workers, facts);
        expect(i.kinds).toContain('reminder');
        expect(i.expectsWrite).toBe(true);
        expect(i.times).toEqual(expect.arrayContaining(['08:00', 'sutra']));
    });

    it('pitanje i izvještaj s „danas" nisu podsjetnik', () => {
        expect(messageIntent('Šta imam sutra?', workers, facts).kinds).toEqual(['question']);
        expect(messageIntent('Danas je bila gužva u radionici', workers, facts).kinds).toEqual([]);
        expect(messageIntent('Senad sutra radi montažu', workers, facts).kinds).toEqual(['work']);
    });
});

describe('„što" nije „sto"', () => {
    const orders = [{ id: 'r11', name: 'Sto za Tarika' }, { id: 'r6', name: 'Hamza Kovač - Garderoba' }];

    it('„predračun što je Lejla poslala" ne spominje Sto za Tarika', () => {
        expect(orderMentioned('Ovaj predračun što je Lejla poslala na mail, potvrdi ga', orders[0], orders)).toBe(false);
    });

    it('stvarno rečen sto i dalje jeste', () => {
        expect(orderMentioned('Bego je lakirao sto za Tarika', orders[0], orders)).toBe(true);
    });
});

describe('poruke koje je bot poslao sam su u razgovoru', () => {
    it('istorija koja počinje porukom bota ne gubi je; dvije poruke bota zaredom su jedan red', () => {
        const msgs = toMessages([
            { role: 'model', text: '[Poslao sam sam — podsjetnik]\n⏰ Naručiti inox', at: '2026-11-02T07:00:00Z' },
            { role: 'model', text: '[Poslao sam sam — jutarnji pregled]\nDobro jutro', at: '2026-11-02T07:01:00Z' },
            { role: 'user', text: 'Ova poruka je beskorisna', at: '2026-11-02T07:05:00Z' },
        ]);
        expect(msgs.map(m => m.role)).toEqual(['user', 'assistant', 'user']);
        expect(msgs[1].content).toMatch(/podsjetnik[\s\S]*jutarnji pregled/);
    });
});

describe('spisak napomena za projekat', () => {
    const item = (id: string, title: string, project?: string): MemoryItem => ({
        Item_ID: id, Organization_ID: 'o', Owner_UID: 'u', Title: title, Subject: title.toLowerCase(), State: 'open', State_Key: 'info', State_Label: 'info',
        Links: project ? [{ Entity_Type: 'project', Entity_ID: project, Entity_Name: 'Hotel na brdu' }] : [], Tags: [], History: [], Source_Entry_IDs: [],
        Created_At: '2026-11-02T06:00:00Z', Updated_At: '2026-11-02T06:00:00Z',
    } as unknown as MemoryItem);

    it('„listu napomena za Brdo" — samo stavke tog projekta, ne prolaz vrata s drugog', () => {
        const items = [item('a', 'Vrata š 629', 'p7'), item('b', 'Švedski sto', 'p7'), item('c', 'Prolaz kliznih vrata')];
        const f = { state: 'sve', project: { id: 'p7', name: 'Hotel na brdu' } };
        const out = filterNotebook(items, f);
        expect(out.map(m => m.Item_ID)).toEqual(['a', 'b']);
        expect(notebookListText(out, f, () => '2.11.')).toMatch(/^📋 Stavke za Hotel na brdu — sve: 2 kom/);
    });
});
