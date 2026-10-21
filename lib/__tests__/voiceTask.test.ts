import { applyVoiceResult, EMPTY_VOICE_APPLIED } from '@/lib/voice/apply';
import { findDateMentions, resolveDueDate, localToday, calendarHint, weekday } from '@/lib/voice/dates';
import { bestMatch, matchScore } from '@/lib/voice/match';
import { foldText } from '@/lib/voice/text';
import { finalizeExtraction, parseModelJson, fallbackExtraction, buildExtractionPrompt, contextNames, type VoiceContext, type ExtractedTaskData } from '@/lib/voice/extract';
import { pickRecorderMimeType, audioExtension, isLikelyHallucination, buildTranscriptionPrompt } from '@/lib/voice/transcript';

// 2026-10-21 je srijeda.
const WED = '2026-10-21';
const due = (text: string, today = WED) => resolveDueDate(text, today);

describe('voice: rok iz diktata', () => {
    it('srijeda je srijeda', () => {
        expect(weekday(WED)).toBe(3);
    });

    it('danas / sutra / prekosutra', () => {
        expect(due('Danas završiti kuhinju')).toBe('2026-10-21');
        expect(due('hitno za sutra pripremiti materijal')).toBe('2026-10-22');
        expect(due('prekosutra montaža')).toBe('2026-10-23');
    });

    it('dani u sedmici, u svim padežima, bez dijakritika', () => {
        expect(due('u petak montaža kod Ibrahimovića')).toBe('2026-10-23');
        expect(due('do petka da se nazove')).toBe('2026-10-23');
        expect(due('u ponedjeljak rezanje')).toBe('2026-10-26');
        expect(due('u cetvrtak mjerenje')).toBe('2026-10-22');
        expect(due('u srijedu')).toBe('2026-10-28'); // izgovoreno u srijedu = iduća
        expect(due('u subotu isporuka')).toBe('2026-10-24');
        expect(due('u nedjelju')).toBe('2026-10-25');
    });

    it('„sljedeći petak" je petak naredne sedmice', () => {
        expect(due('sljedeći petak montaža')).toBe('2026-10-30');
        expect(due('iduće sedmice nazvati klijenta')).toBe('2026-10-26');
    });

    it('nedjelja kao sedmica nije nedjelja kao dan', () => {
        expect(due('za dvije nedjelje isporuka')).toBe('2026-11-04');
        expect(findDateMentions('ova nedjeljna isporuka', WED)).toHaveLength(0);
    });

    it('za N dana / sedmica / mjesec', () => {
        expect(due('za 3 dana')).toBe('2026-10-24');
        expect(due('za tri dana završiti ormar')).toBe('2026-10-24');
        expect(due('za pet dana')).toBe('2026-10-26');
        expect(due('za sedmicu dana')).toBe('2026-10-28');
        expect(due('za dvije sedmice')).toBe('2026-11-04');
        expect(due('za mjesec dana')).toBe('2026-11-21');
    });

    it('kalendarski datumi i kraj mjeseca', () => {
        expect(due('do 15.11. isporučiti')).toBe('2026-11-15');
        expect(due('rok 15. 11.')).toBe('2026-11-15');
        expect(due('do 5. novembra')).toBe('2026-11-05');
        expect(due('3. januara montaža')).toBe('2027-01-03'); // prošao → sljedeća godina
        expect(due('do kraja mjeseca')).toBe('2026-10-31');
        expect(due('do 28.')).toBe('2026-10-28');
        expect(due('do 10.')).toBe('2026-11-10');
    });

    it('do kraja sedmice = petak', () => {
        expect(due('do kraja sedmice')).toBe('2026-10-23');
        expect(due('ove sedmice')).toBe('2026-10-23');
    });

    it('bez roka ostaje null — „hitno" i brojevi u mjerama nisu datum', () => {
        expect(due('hitno naručiti iveral H3395 hrast')).toBeNull();
        expect(due('izrezati ploču 60 x 120 i 18 mm')).toBeNull();
        expect(due('petnaest komada šarki')).toBeNull();
    });

    it('prijedlog modela: prihvaćen ako ga tekst potvrđuje, inače prvi izraz', () => {
        const t = 'sutra pozvati, a montaža u petak';
        expect(resolveDueDate(t, WED, '2026-10-23')).toBe('2026-10-23');
        expect(resolveDueDate(t, WED, '2026-12-01')).toBe('2026-10-22');
        expect(resolveDueDate('nešto bez datuma', WED, '2026-11-02')).toBe('2026-11-02');
        expect(resolveDueDate('nešto bez datuma', WED, '2026-10-01')).toBeNull(); // prošlost
        expect(resolveDueDate('nešto bez datuma', WED, 'sutra')).toBeNull();
    });

    it('localToday koristi lokalni dan, ne UTC', () => {
        expect(localToday(new Date(2026, 9, 22, 0, 30))).toBe('2026-10-22');
    });

    it('kalendar za prompt ima nazive dana', () => {
        const cal = calendarHint(WED, 2);
        expect(cal).toContain('2026-10-21 — srijeda (danas)');
        expect(cal).toContain('2026-10-22 — četvrtak (sutra)');
    });
});

describe('voice: prepoznavanje imena', () => {
    const workers = [
        { id: 'w1', names: ['Emir Hodžić'] },
        { id: 'w2', names: ['Dženan Mujić'] },
        { id: 'w3', names: ['Senad Begić'] },
        { id: 'w4', names: ['Đuro Kovač'] },
    ];

    it('dijakritici i đ', () => {
        expect(foldText('Đuro Džananović')).toBe('djuro dzananovic');
        expect(bestMatch('Dzenan', workers)?.id).toBe('w2');
        expect(bestMatch('Djuro', workers)?.id).toBe('w4');
    });

    it('padeži', () => {
        expect(bestMatch('Emira', workers)?.id).toBe('w1');
        expect(bestMatch('Senadu', workers)?.id).toBe('w3');
        expect(bestMatch('Hodžića', workers)?.id).toBe('w1');
    });

    it('sitna greška transkripcije', () => {
        expect(bestMatch('Senat', workers)?.id).toBe('w3');
    });

    it('ne pogađa: nepoznato ime ili dvosmislenost', () => {
        expect(bestMatch('Mirza', workers)).toBeNull();
        expect(bestMatch('Emir', [...workers, { id: 'w5', names: ['Emir Spahić'] }])).toBeNull();
        expect(bestMatch('', workers)).toBeNull();
    });

    it('kratka imena ne prave lažne pogotke', () => {
        expect(matchScore('Ana', ['Anel Bašić'])).toBe(0);
        expect(matchScore('Ado', ['Adnan'])).toBe(0);
    });
});

describe('voice: finalizeExtraction', () => {
    const ctx: VoiceContext = {
        projects: [
            { id: 'p1', client: 'Hodžić', name: 'Kuhinja Hodžić', address: 'Ilidža' },
            { id: 'p2', client: 'Begović d.o.o.', address: 'Zenica' },
        ],
        workers: [{ id: 'w1', name: 'Emir Hodžić' }, { id: 'w2', name: 'Senad Begić' }],
    };

    it('ID iz modela se prihvata samo ako postoji u listi', () => {
        const r = finalizeExtraction({ title: 'x', suggestedProjectId: 'p2', suggestedWorkerId: 'nema' }, 'x', WED, ctx);
        expect(r.suggestedProjectId).toBe('p2');
        expect(r.suggestedWorkerId).toBeNull();
    });

    it('bez ID-ja: fuzzy po izgovorenom imenu (stari bug „Hodžić (Ilidža)")', () => {
        const r = finalizeExtraction({ title: 'Mjerenje', suggestedProject: 'Hodžić (Ilidža)', suggestedWorker: 'Senada' }, 'x', WED, ctx);
        expect(r.suggestedProjectId).toBe('p1');
        expect(r.suggestedWorkerId).toBe('w2');
        expect(r.suggestedWorker).toBe('Senada');
    });

    it('ime jasno pokazuje drugog radnika nego pogrešan ID', () => {
        const r = finalizeExtraction({ title: 'x', suggestedWorker: 'Senad', suggestedWorkerId: 'w1' }, 'x', WED, ctx);
        expect(r.suggestedWorkerId).toBe('w2');
    });

    it('sanira prioritet, kategoriju, naslov i checklistu', () => {
        const r = finalizeExtraction({
            title: 'naručiti materijal za kuhinju kod klijenta Hodžić u Ilidži i sve ostalo što treba za montažu sljedeće sedmice',
            description: 'naručiti materijal',
            priority: 'HITNO', category: 'nešto',
            checklist: ['šarke.', 'Šarke', '', 'vodilice', 42],
            suggestedWorker: 'null',
        }, 'x', WED, ctx);
        expect(r.title.length).toBeLessThanOrEqual(80);
        expect(r.title.startsWith('Naručiti')).toBe(true);
        expect(r.title.endsWith('…')).toBe(true);
        expect(r.priority).toBe('medium');
        expect(r.category).toBe('general');
        expect(r.checklist).toEqual(['Šarke', 'Vodilice']);
        expect(r.suggestedWorker).toBeNull();
    });

    it('rok uvijek prolazi kroz deterministički parser', () => {
        const r = finalizeExtraction({ title: 'Montaža', suggestedDueDate: '2026-10-21' }, 'montaža u petak', WED, ctx);
        expect(r.suggestedDueDate).toBe('2026-10-23');
    });

    it('model pao → naslov iz prve rečenice, rok i dalje iz teksta', () => {
        const r = finalizeExtraction(null, 'Naručiti šarke za Begovića. Treba ih 20 komada do petka.', WED, ctx);
        expect(r.title).toBe('Naručiti šarke za Begovića');
        expect(r.description).toBe('Treba ih 20 komada do petka.');
        expect(r.suggestedDueDate).toBe('2026-10-23');
    });

    it('fallback reže dugi tekst bez tačke', () => {
        const long = 'treba '.repeat(40);
        expect(fallbackExtraction(long).title.length).toBeLessThanOrEqual(80);
    });

    it('parseModelJson podnosi ``` i višak teksta', () => {
        expect(parseModelJson('```json\n{"title":"A"}\n```')).toEqual({ title: 'A' });
        expect(parseModelJson('Evo: {"title":"B"} hvala')).toEqual({ title: 'B' });
        expect(parseModelJson('nije json')).toBeNull();
        expect(parseModelJson('[1,2]')).toBeNull();
    });

    it('prompt sadrži kalendar i ID-jeve', () => {
        const p = buildExtractionPrompt('montaža u petak', WED, ctx);
        expect(p).toContain('2026-10-23 — petak');
        expect(p).toContain('p1 | Hodžić · Kuhinja Hodžić · Ilidža');
        expect(p).toContain('w2 | Senad Begić');
        expect(contextNames(ctx)).toEqual(['Emir Hodžić', 'Senad Begić', 'Hodžić', 'Kuhinja Hodžić', 'Begović d.o.o.']);
    });
});

describe('voice: snimak i transkript', () => {
    it('bira format koji preglednik podržava (Safari → mp4)', () => {
        expect(pickRecorderMimeType(t => t.startsWith('audio/webm'))).toBe('audio/webm;codecs=opus');
        expect(pickRecorderMimeType(t => t === 'audio/mp4')).toBe('audio/mp4');
        expect(pickRecorderMimeType(() => false)).toBeUndefined();
        expect(pickRecorderMimeType(() => { throw new Error('x'); })).toBeUndefined();
    });

    it('ekstenzija po formatu', () => {
        expect(audioExtension('audio/mp4;codecs=mp4a.40.2')).toBe('mp4');
        expect(audioExtension('audio/webm;codecs=opus')).toBe('webm');
        expect(audioExtension('audio/ogg')).toBe('ogg');
        expect(audioExtension('')).toBe('webm');
    });

    it('prepoznaje halucinacije iz tišine i ponovljen prompt', () => {
        expect(isLikelyHallucination('Hvala na gledanju!')).toBe(true);
        expect(isLikelyHallucination('Titlovi: Amara.org')).toBe(true);
        expect(isLikelyHallucination(' ')).toBe(true);
        const prompt = buildTranscriptionPrompt(['Emir Hodžić'], ['iverica', 'MDF', 'šarke']);
        expect(isLikelyHallucination('Emir Hodžić, iverica, MDF', prompt)).toBe(true);
        expect(isLikelyHallucination('Emir neka naruči iveral za Hodžića', prompt)).toBe(false);
    });

    it('prompt transkripcije: imena prvo, bez duplikata, reže na cijeloj stavci', () => {
        const p = buildTranscriptionPrompt(['Emir', 'emir', 'Dženan'], ['iverica', 'MDF'], 75);
        expect(p.startsWith('Diktat zadatka')).toBe(true);
        expect(p).toContain('Emir, Dženan');
        expect(p.match(/emir/gi)).toHaveLength(1);
        expect(p.length).toBeLessThanOrEqual(76);
        expect(p.endsWith('.')).toBe(true);
    });
});

describe('voice: primjena na formu (ponovljen diktat)', () => {
    let n = 0;
    const id = () => `c${++n}`;
    const data = (over: Partial<ExtractedTaskData> = {}): ExtractedTaskData => ({
        title: 'Montaža', description: '', priority: 'medium', category: 'installation', checklist: [],
        suggestedDueDate: null, suggestedWorker: null, suggestedWorkerId: null, suggestedProject: null, suggestedProjectId: null,
        ...over,
    });
    const empty = { title: '', description: '', priority: 'medium' as const, category: 'general' as const, dueDate: '', workerId: '', checklist: [], links: [] };

    it('drugi diktat zamjenjuje checklistu i projekat prvog, ne dopisuje', () => {
        const first = applyVoiceResult(empty, EMPTY_VOICE_APPLIED, data({ checklist: ['Alat', 'Silikon'], suggestedProjectId: 'p1', suggestedDueDate: '2026-10-23', suggestedWorkerId: 'w1' }), { id: 'p1', name: 'Hodžić' }, id);
        expect(first.form.checklist.map(i => i.text)).toEqual(['Alat', 'Silikon']);
        const second = applyVoiceResult(first.form, first.applied, data({ checklist: ['Vodilice'], suggestedProjectId: 'p2' }), { id: 'p2', name: 'Begović' }, id);
        expect(second.form.checklist.map(i => i.text)).toEqual(['Vodilice']);
        expect(second.form.links.map(l => l.Entity_ID)).toEqual(['p2']);
        // rok i radnik koje je upisao prvi diktat se brišu kad ih drugi ne spominje
        expect(second.form.dueDate).toBe('');
        expect(second.form.workerId).toBe('');
    });

    it('ručni unos korisnika ostaje', () => {
        const form = { ...empty, description: 'moja napomena', dueDate: '2026-11-01', workerId: 'w9',
            checklist: [{ id: 'mine', text: 'Ručno', completed: false }],
            links: [{ Entity_Type: 'project' as const, Entity_ID: 'p1', Entity_Name: 'Hodžić' }] };
        const r = applyVoiceResult(form, EMPTY_VOICE_APPLIED, data({ checklist: ['Novo'], suggestedProjectId: 'p1' }), { id: 'p1', name: 'Hodžić' }, id);
        expect(r.form.description).toBe('moja napomena');
        expect(r.form.dueDate).toBe('2026-11-01');
        expect(r.form.workerId).toBe('w9');
        expect(r.form.checklist.map(i => i.text)).toEqual(['Ručno', 'Novo']);
        expect(r.form.links).toHaveLength(1);
        // projekat je korisnikov, pa ga sljedeći diktat ne smije skinuti
        const r2 = applyVoiceResult(r.form, r.applied, data(), null, id);
        expect(r2.form.links).toHaveLength(1);
    });
});
