import { messageIntent } from '@/lib/assistant/intent';
import { toolSetFor, toolsFor, ALL_TOOLS } from '@/lib/assistant/toolRouting';
import { mentionNote, type MentionRef } from '@/lib/assistant/mentions';

const facts = { dims: [], widths: [], locations: [] };
const workers = [{ id: 'w1', name: 'Kemal Demić' }, { id: 'w2', name: 'Bego Demo' }];
const setOf = (text: string, answering = false) => toolSetFor(messageIntent(text, workers, facts).kinds, { answeringQuestion: answering });

describe('skup alata po vrsti poruke', () => {
    it('čista pitanja → pitanje', () => {
        expect(setOf('Koji iveral smo koristili za Jerkine ormare?')).toBe('question');
        expect(setOf('kad smo počeli Čorluku')).toBe('question');
        expect(setOf('pošalji mi pdf narudžbe za Budnju')).toBe('question');
        expect(setOf('je li stigao predračun od Ploča?')).toBe('question');
    });

    it('mail → mail', () => {
        expect(setOf('pošalji Amri narudžbu mailom')).toBe('email');
        expect(setOf('javi Selmi mailom da su lajsne gotove')).toBe('email');
    });

    it('upisi, mješavine i odgovori na pitanje → svi', () => {
        expect(setOf('Kemal je radio montažu u Budnji')).toBe('full');
        expect(setOf('u ponedjeljak trebam naručiti 10 baglama')).toBe('full');
        expect(setOf('Bego je završio kantiranje, šta je sljedeće?')).toBe('full');
        expect(setOf('Ameru')).toBe('full');
        expect(setOf('koji?', true)).toBe('full');
    });

    it('manji skup zadržava redoslijed i dodaje all_tools na kraj', () => {
        const all = ['create_task', 'search_memory', 'order_pdf', 'email_order', 'list_orders', 'ask_user'].map(name => ({ name }));
        const read = new Set(['search_memory', 'list_orders']);
        expect(toolsFor('question', all, read).map(t => t.name)).toEqual(['search_memory', 'order_pdf', 'list_orders', 'ask_user', ALL_TOOLS]);
        expect(toolsFor('email', all, read).map(t => t.name)).toEqual(['order_pdf', 'email_order', 'list_orders', 'ask_user', ALL_TOOLS]);
        expect(toolsFor('full', all, read)).toBe(all);
    });
});

describe('projekti i nalozi iz poruke', () => {
    const projects: MentionRef[] = [
        { id: 'p1', alias: 'P1', name: 'Jerko Čorluka · Kuća faza 2' },
        { id: 'p2', alias: 'P2', name: 'Budnjo · Stan Ilidža', aliases: ['budnja'] },
        { id: 'p3', alias: 'P3', name: 'Demo Investitor · Crni Vrh' },
    ];
    const orders: MentionRef[] = [{ id: 'o1', alias: 'R1', name: 'Kuhinja Čorluka' }];

    it('pitanje o jednom projektu → projekat i put na karticu', () => {
        expect(mentionNote({ text: 'šta fali za Budnju', recent: '', projects, orders: [], question: true }))
            .toEqual(['projekat: P2 Budnjo · Stan Ilidža', 'pitanje o projektu → project_brief P2']);
    });

    it('projekat i nalog iz poruke; bez puta kad nije pitanje', () => {
        expect(mentionNote({ text: 'radili smo kuhinju za Čorluku', recent: '', projects, orders, question: false }))
            .toEqual(['projekat: P1 Jerko Čorluka · Kuća faza 2', 'nalog: R1 Kuhinja Čorluka']);
    });

    it('poruka bez projekta → projekat iz prethodnih poruka', () => {
        expect(mentionNote({ text: 'a kad smo počeli?', recent: 'koji iveral za Crni Vrh', projects, orders, question: true }))
            .toEqual(['projekat iz razgovora: P3 Demo Investitor · Crni Vrh', 'pitanje o projektu → project_brief P3']);
    });

    it('ništa prepoznato → bez napomene', () => {
        expect(mentionNote({ text: 'šta imam sutra', recent: '', projects, orders, question: true })).toEqual([]);
    });
});
