// ════════════════════════════════════════════════════════════════════
// ŠTA PORUKA TRAŽI — vrsta poruke, rečeni radnici i vrijeme (čisto)
//
// ERP prije modela odredi da li poruka traži UPIS i kakav:
//   podsjetnik („napomeni me", „u 00:01"), zadatak za radnika („neka Imer…",
//   „reci Kerimu"), bilježnica (lokacija + mjera/stanje), rad, prisustvo,
//   narudžba — ili je PITANJE („šta imam za ponedjeljak?").
// Model dobije to kao napomenu, a poslije obrade ERP provjeri: poruka je
// tražila upis, a ništa nije upisano → još jedan krug; rečen radnik ili
// vrijeme nije u upisu → model to dobije nazad (kao mjere u bilježnici).
// jest: lib/__tests__/intent.test.ts
// ════════════════════════════════════════════════════════════════════

import { foldText } from '@/lib/voice/text';
import { workerMentioned, workerNicknames, mentionsEveryone, type GroundRef } from './grounding';

export type MessageKind = 'reminder' | 'task' | 'notebook' | 'work' | 'progress' | 'presence' | 'order' | 'arrival' | 'email' | 'chat' | 'table' | 'question';

export interface MessageIntent {
    kinds: MessageKind[];
    /** Poruka traži upis (nije samo pitanje). */
    expectsWrite: boolean;
    /** Rečeni radnici (ID) — ime, prezime ili naučeni nadimak. „Svi" se ovdje ne širi. */
    workerIds: string[];
    /** Riječi koje su vjerovatno nadimak radnika („Kemo" → Kemal); više ID-jeva = nejasno. */
    nicknames: { token: string; ids: string[] }[];
    /** Rečena vremena: „00:01", „7:00", „ujutro". */
    times: string[];
}

/** Bilježnica je izričito rečena („zabilježi", „u bilježnicu", „bilješka"). */
export const NOTEBOOK_SAID = /\b(biljesk\w*|biljezi|zabiljezi\w*|biljeznic\w*|zapamti)\b/;

const FUTURE_DAY =/^(sutra|prekosutra|ponedjeljak|utorak|srijedu|srijeda|cetvrtak|petak|subotu|subota|nedjelju|nedjelja)$/;

const QUESTION_START =/^(sta|šta|koliko|gdje|kad|kada|ko|koji|koja|koje|da li|jel|je li|ima li|imam li|imamo li|kako|zasto|zašto|pokazi|pokaži|posalji mi|pošalji mi|treba mi pdf|daj mi)\b/;

export function messageIntent(text: string, workers: GroundRef[], facts: { dims: string[]; widths: string[]; locations: string[] }): MessageIntent {
    const t = foldText(text).trim();
    const kinds = new Set<MessageKind>();
    const times: string[] = [];

    // Vrijeme iz sirovog teksta: foldText briše dvotačku.
    const raw = text.toLowerCase();
    for (const m of Array.from(raw.matchAll(/\bu\s+(\d{1,2})[:.](\d{2})\b/g))) times.push(`${m[1].padStart(2, '0')}:${m[2]}`);
    for (const m of Array.from(raw.matchAll(/\bu\s+(\d{1,2})\s*(h|sati|sat)?\b(?![:.]\d)(?!\s*(kom|komada|m\b|mm|cm|x))/g))) {
        if (Number(m[1]) <= 23 && /(sutra|danas|ujutro|popodne|navece|uvece|ponedjeljak|utorak|srijed|cetvrt|petak|subot|nedjelj|\bu\s+\d{1,2}\s*(h|sati|sat)\b)/.test(t)) times.push(`${m[1].padStart(2, '0')}:00`);
    }
    for (const w of ['danas', 'sutra', 'prekosutra', 'ponedjeljak', 'utorak', 'srijedu', 'srijeda', 'cetvrtak', 'petak', 'subotu', 'subota', 'nedjelju', 'nedjelja', 'ujutro', 'popodne', 'navece', 'uvece', 'podne']) {
        if (new RegExp(`\\b${w}\\b`).test(t)) times.push(w);
    }

    const workerIds = workers.filter(w => workerMentioned(text, w)).map(w => w.id);
    // Nadimak („Kemo") samo kao napomena modelu — u pokrivenost ulaze rečena imena.
    const nicknames = workerNicknames(text, workers);
    const anyWorker = workerIds.length > 0 || nicknames.length > 0;
    // „Hoćeš li me napomenuti sutra … i kad" pita za podsjetnik koji postoji (03.11. — bot je pravio novi);
    // „hoćeš li me napomenuti sutra u 8 da…" bez „kad" je molba. „Jesi li upisao…" je uvijek pitanje.
    const question = /\?\s*$/.test(text.trim()) || QUESTION_START.test(t)
        || /^jesi li\b/.test(t) || (/^(hoces li|da li ces|jel ces)\b/.test(t) && /\b(i kad|kad|kada|u koliko|koliko sati)\b/.test(t));

    if (/\b(napomeni|napomenuti|podsjeti|podsjetiti|podsjetnik|javi mi|napisi mi|napiši mi|posalji mi poruku|pošalji mi poruku|ne zaboravi|zapamti da)\b/.test(t)
        || (times.length && /\b(trebam|moram|treba|javiti|nazvati|zvati|naruciti|naručiti|platiti|otici|otići|pitati)\b/.test(t))) kinds.add('reminder');
    if (/\b(neka|reci|recite|kazi|kaži|javi)\b/.test(t) && workerIds.length) kinds.add('task');
    // Posao za radnike rečen kao „zadatak/napomena/dodaj za Amera i Edina…" — to je zadatak (i dopuna
    // postojećeg), ne bilježnica: 03.11. „u napomenu za Edina i Amera ubaciti da u E007 fali ogledalo"
    // i „dodati za Amera i Edina da ponesu U plastiku" otišli su u bilježnicu.
    if (workerIds.length && /\b(zada[tc]\w*|napomen\w*|dodaj\w*|dodati|ubaci\w*|stavi|staviti|ponesu|ponijeti|neka)\b/.test(t)) kinds.add('task');
    if (/\b(naruci|naruči|narucio|naručio|narudzb|narudžb)\w*/.test(t) && !question) kinds.add('order');
    if (/\b(stig|dosa|dosl|dostav|isporuc)\w*/.test(t) && !question && !anyWorker) kinds.add('arrival');
    if (/\b(prisut|bolovanj|odmor|na terenu|nije dosao|nije došao|nisu dosli|nisu došli|odsut)\w*/.test(t) && (workerIds.length || mentionsEveryone(text))) kinds.add('presence');
    if ((facts.locations.length && (facts.dims.length || facts.widths.length || /\b(fali|fale|nije postavljen|nisam postavio|pogresno|pogrešno|ima|imam|stoji|u stanu|na hodniku)\b/.test(t)))
        || /\b(u kombiju|na hodniku|u stanu)\b/.test(t)) kinds.add('notebook');
    // Zadatak ili podsjetnik nosi stanje stvari u sebi („ogledala su ispred stana", „ključa nije bilo"):
    // bilježnica samo kad je rečena. Inače jedna poruka napravi zadatak + 8 bilješki (03.11.).
    if ((kinds.has('task') || kinds.has('reminder')) && !NOTEBOOK_SAID.test(t)) kinds.delete('notebook');
    if (anyWorker && !kinds.has('task')
        && /\b(radio|radili|radila|radi|rade|kroj|kant|brus|lakir|farb|sklap|okiv|pakov|pakuj|zapakov|montir|montaz|furnir|presov|izrad|zavrs|poce|pocel|lijep)\w*/.test(t)) kinds.add('work');
    // Stanje proizvodnje bez radnika: „sve podkonstrukcije su napravljene, u toku je montaža iverala".
    if (!anyWorker && !question && !kinds.has('reminder') && !kinds.has('task') && !kinds.has('arrival')
        && /\b(gotov|zavrs|napravljen|skrojen|srezan|kantiran|sklopljen|izbrusen|polakiran|zapakovan|montiran|ofarban|furniran|u toku|na (brusenj|lakiranj|kantiranj|krojenj|sklapanj|okivanj|montaz|furniranj|pakovanj|presovanj)|krenul|zapoce|zavrseno)\w*/.test(t)) kinds.add('progress');
    // Budući dan ili sat bez ičeg drugog = podsjetnik, kojim god glagolom: „Provjerit sa Senadom sutra
    // u 8 kako dovući staklo" (02.11.) nije bio ni u jednoj listi riječi, pa je bot odgovarao o staklu.
    // „Danas" sam nije dovoljno („danas smo…" je izvještaj), sat jeste.
    if (!question && !kinds.size && times.some(x => /\d:\d/.test(x) || FUTURE_DAY.test(x))) kinds.add('reminder');
    // Mail („pošalji Amri narudžbu mailom", „javi Selmi mailom da su lajsne gotove"): sadržaj maila
    // nije upis u ERP — nije nova narudžba, zadatak ni stanje procesa. Pitanje o adresi nije mail.
    // „Naručio sam preko emaila, poslao Merimi" (31.10.) je podatak gdje tražiti, ne nalog za
    // novi mail: prošlo vrijeme bez naredbe → pitanje (pošta se čita), ne upis.
    const mailReport = /\b(poslao|poslala|poslali|narucio|narucila|narucili|pisao|pisala|slao|slala)\b/.test(t)
        && !/\b(posalji|posaljite|napisi|sastavi|javi|naruci|narucite|proslijedi|odgovori|potvrdi|napravi|upisi|zapisi|dodaj|kreiraj|podsjeti|napomeni)\b/.test(t);
    // Potvrda dokumenta dobavljača ili odgovor na mail („potvrdi Lejli predračun i reci da može u
    // proizvodnju", „odgovori joj da…") je odgovor u niti (reply_mail), i bez riječi „mail" (02.11.).
    const replyMail = (/\bpotvrd\w*/.test(t) && /\b(predracun|ponud)\w*/.test(t))
        || /\bodgovori\w*\s+(joj|mu|im|na (taj |ovaj |njen |njegov )?(mail|mejl|email|poruku))\b/.test(t);
    if (replyMail || (/\b(e-?mail|mail|mejl|imejl)\w*/.test(t) && !/\b(koji je|kakav je|adres)\w*/.test(t))) {
        kinds.clear();
        kinds.add(mailReport && !replyMail ? 'question' : 'email');
    }
    // Viber/WhatsApp („pošalji poruku Zaimu na viber sutra u 10, naruči baglame"): sadržaj poruke
    // nije narudžba ni podsjetnik u ERP-u — sve ide u jednu karticu (chat_message).
    // „Pošalji MI poruku u 8" je podsjetnik meni, ne Viber.
    if (/\b(viber\w*|vajber\w*|whats ?app\w*|vocap\w*|vatsap\w*)\b/.test(t)
        || (/\b(posalji|napisi|posaljite)\s+(\w+\s+)?poruk\w*/.test(t) && !/\b(posalji|napisi)\s+mi\b/.test(t) && !/\bporuk\w*\s+(meni|mi)\b/.test(t))) {
        kinds.clear();
        kinds.add('chat');
    }
    // Tabela („napravi tabelu nenaručenih materijala", „u tabeli stan, dimenzije…"): čitanje
    // i PDF, ne upis — „naručen" ili „u stanu" u njoj nisu narudžba ni bilježnica.
    if (/\btabel\w*/.test(t) && !kinds.has('email') && !kinds.has('chat')) {
        kinds.clear();
        kinds.add('table');
    }
    if (question) kinds.add('question');

    const writeKinds = Array.from(kinds).filter(k => k !== 'question' && k !== 'table');
    return {
        kinds: Array.from(kinds),
        // Pitanje može i upisati („…, šta još fali?"), ali tad ne tjeramo upis.
        expectsWrite: writeKinds.length > 0 && !question,
        workerIds,
        nicknames,
        times: Array.from(new Set(times)),
    };
}

const KIND_LABEL: Record<MessageKind, string> = {
    reminder: 'podsjetnik (create_task s reminder_at)', task: 'zadatak za radnika (create_task s worker)',
    notebook: 'bilježnica (remember / update_memory)', work: 'rad i procesi (log_work)',
    progress: 'stanje procesa bez radnika (set_progress; nazive procesa uzmi iz TOK NALOGA)', presence: 'prisustvo (set_presence)',
    order: 'narudžba (create_order / manage_order)', arrival: 'stigao materijal (material_arrived)',
    email: 'mail (email_order za narudžbu, reply_mail za odgovor/potvrdu na mail koji je stigao, email_contact za novi mail — samo NACRT, šalje korisnik dugmetom)',
    chat: 'poruka na Viber/WhatsApp (chat_message; vrijeme ide u send_at, sadržaj u text — nije narudžba ni zadatak)',
    table: 'tabela (make_table — ERP složi i pošalje PDF; bez upisa)', question: 'pitanje (odgovor, bez upisa)',
};

/** Dio napomene za model: vrsta poruke, rečeni radnici (i nadimci) i vrijeme. */
export function intentNote(intent: MessageIntent, workerLabel: (id: string) => string): string[] {
    const parts: string[] = [];
    // Samo pitanje ne treba napomenu — model ionako odgovara.
    const kinds = intent.kinds.filter(k => k !== 'question');
    if (kinds.length) parts.push(`vrsta: ${kinds.map(k => KIND_LABEL[k]).join(' + ')}`);
    if (intent.workerIds.length) parts.push(`radnici: ${intent.workerIds.map(workerLabel).join(', ')}`);
    for (const n of intent.nicknames) {
        parts.push(n.ids.length === 1
            ? `„${n.token}" je nadimak: ${workerLabel(n.ids[0])}`
            : `„${n.token}" može biti: ${n.ids.map(workerLabel).join(' ili ')} — pitaj ask_user`);
    }
    if (intent.times.length) parts.push(`vrijeme: ${intent.times.join(', ')}`);
    return parts;
}
