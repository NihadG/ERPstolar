/**
 * @jest-environment node
 */
// Revizija 03.11.2026 — principi, ne pojedinačni slučajevi (izmišljena imena):
//   1. dopuna ide u zadatak kojem je namijenjena, zadatak ne pravi bilješke usput
//   2. postojeći zadatak se mijenja (složi po stanovima), ne otkazuje pa pravi iznova
//   3. pritužba nije odgovor; pitanje o podsjetniku nije nalog
//   4. napomena o botu ide u reviziju, ne u bilježnicu
//   5. vrijeme podsjetnika se bira dugmetom
import { sortByFlat, firstFlat } from '@/lib/assistant/checklistOrder';
import { messageIntent } from '@/lib/assistant/intent';
import { isComplaint, metaFeedback } from '@/lib/assistant/signals';
import { asksTime, timeOptions, workerTaskNote } from '@/lib/assistant/brain';
import type { Task } from '@/lib/types';

const facts = (locations: string[] = []) => ({ dims: [], widths: [], locations });
const workers = [{ id: 'w-a', name: 'Amer Hodžić' }, { id: 'w-e', name: 'Edin Begić' }];

describe('dopuna ide u zadatak, ne u bilježnicu', () => {
    it.each([
        ['U napomenu za Amera i Edina ubaciti da u E007 fali ogledalo', ['E007']],
        ['Dodati za Amera i Edina da ponesu jednu U plastiku za umivaonik, fali u stanu B206', ['B206']],
        ['zadaci za sutra, za Amera i Edina: montirati umivaonik u stanu E504, ogledala su ispred stana E308', ['E504', 'E308']],
    ])('„%s" → zadatak, bez bilježnice', (text, locations) => {
        const i = messageIntent(text, workers, facts(locations));
        expect(i.kinds).toContain('task');
        expect(i.kinds).not.toContain('notebook');
    });

    it('bilježnica kad je rečena, ili kad nema radnika ni zadatka', () => {
        expect(messageIntent('Zabilježi za Amera da u E007 fali ogledalo', workers, facts(['E007'])).kinds).toContain('notebook');
        expect(messageIntent('Dodaj u zadatak za Amera i zabilježi da u E007 fali ogledalo', workers, facts(['E007'])).kinds).toEqual(expect.arrayContaining(['task', 'notebook']));
        expect(messageIntent('U stanu E007 fali ogledalo', workers, facts(['E007'])).kinds).toEqual(['notebook']);
    });

    const task = (alias: string, title: string, extra: Partial<Task> = {}) => ({ alias, value: { Task_ID: alias, Title: title, Status: 'pending', Checklist: [], ...extra } as unknown as Task });
    const workerOf = (id: string) => ({ value: { name: workers.find(w => w.id === id)!.name } });

    it('ERP nađe otvoren zadatak tih radnika i kaže modelu da dopuna ide u njega', () => {
        const tasks = [task('T1', 'Montaža za Amera i Edina (sutra)'), task('T2', 'Naručiti inox')];
        expect(workerTaskNote('Dodaj im još da provjere C502', ['w-a', 'w-e'], tasks, workerOf)).toEqual([
            'otvoren zadatak za Amer Hodžić, Edin Begić: T1 „Montaža za Amera i Edina (sutra)" — dopuna za njih ide u njega (update_task add_checklist), ne u bilježnicu ni novi zadatak',
        ]);
        // Bez riječi dopune (nova lista) i bez takvog zadatka → nema napomene.
        expect(workerTaskNote('Zadaci za sutra za Amera i Edina: E504', ['w-a', 'w-e'], tasks, workerOf)).toEqual([]);
        expect(workerTaskNote('Dodaj za Amera', ['w-a'], [task('T2', 'Naručiti inox')], workerOf)).toEqual([]);
    });
});

describe('check lista po lameli i stanu', () => {
    it('iste stavke, isti tekst, složene: lamela pa stan; bez stana na kraj, svojim redom', () => {
        const items = ['montirati umivaonik u stanu E504', 'brojevi stanova koji fale', 'ogledala u C408 (prenijeti sa E408)', 'ogledalo u E007', 'provjeriti C502', 'ogledalo u E 001']
            .map(text => ({ text }));
        expect(sortByFlat(items).map(i => i.text)).toEqual([
            'ogledala u C408 (prenijeti sa E408)', 'provjeriti C502', 'ogledalo u E 001', 'ogledalo u E007', 'montirati umivaonik u stanu E504', 'brojevi stanova koji fale',
        ]);
        expect(firstFlat('Hodnik C5')).toBeNull();
    });
});

describe('pritužba i pitanje', () => {
    it('pritužba gasi pitanje; gola ispravka je odgovor', () => {
        expect(isComplaint('Pogresno totalno')).toBe(true);
        expect(isComplaint('ma nesto je ovdje pogresno, nemoj nista raditi za sada')).toBe(true);
        expect(isComplaint('ne, u utorak')).toBe(false);
        expect(isComplaint('Sutra u 8')).toBe(false);
    });

    it('„hoćeš li me napomenuti sutra … i kad" je pitanje; bez „kad" je molba', () => {
        expect(messageIntent('Hoces li me napomenuti sutra za umivaonik da ponesu u pogon i kad', workers, facts()).expectsWrite).toBe(false);
        expect(messageIntent('Hoces li me napomenuti sutra u 8 da nazovem Edina', workers, facts()).kinds).toContain('reminder');
    });

    it('model pita „kad?" tekstom → ERP nudi dugmad', () => {
        expect(asksTime('Koji datum i sat da te podsjetim da provjeriš umivaonike u C102?')).toBe(true);
        expect(asksTime('Upisao sam.')).toBe(false);
        expect(timeOptions(new Date('2026-11-03T13:37:00Z'), 'Europe/Sarajevo')).toEqual(['Danas u 16:00', 'Sutra u 08:00', 'Sutra u 10:00', 'Sutra u 12:00']);
        expect(timeOptions(new Date('2026-11-03T19:00:00Z'), 'Europe/Sarajevo')).toEqual(['Sutra u 08:00', 'Sutra u 10:00', 'Sutra u 12:00']);
    });
});

describe('napomena o botu ide u reviziju', () => {
    it.each([
        ['Zabilježi da je ovo pogrešno, kako sam ja ovo skontao.', true],
        ['Trebalo bi napraviti da i AI pročita taj mail i PDF ponude, možda neki jeftin model', true],
        ['Pogresno si procijenio biljesku, ne ceka postavljanje, nego iz stana odnijeti u pogon jer je viska. Zabiljezi to kao pogresno shvatanje tog dijela. Napomena je uredu', false],
    ])('„%s" → napomena (samo napomena: %s)', (text, pure) => {
        expect(metaFeedback(text)).toEqual({ pure });
    });

    it('obična bilješka i zadatak nisu napomena o botu', () => {
        expect(metaFeedback('Zabilježi da u E308 fali ogledalo')).toBeNull();
        expect(metaFeedback('Dodaj u zadatak za Amera da ponese vodilice')).toBeNull();
    });
});
