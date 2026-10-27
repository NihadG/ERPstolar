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
import { workerMentioned, mentionsEveryone, type GroundRef } from './grounding';

export type MessageKind = 'reminder' | 'task' | 'notebook' | 'work' | 'presence' | 'order' | 'question';

export interface MessageIntent {
    kinds: MessageKind[];
    /** Poruka traži upis (nije samo pitanje). */
    expectsWrite: boolean;
    /** Rečeni radnici (ID). „Svi" se ovdje ne širi. */
    workerIds: string[];
    /** Rečena vremena: „00:01", „7:00", „ujutro". */
    times: string[];
}

const QUESTION_START = /^(sta|šta|koliko|gdje|kad|kada|ko|koji|koja|koje|da li|jel|je li|ima li|imam li|imamo li|kako|zasto|zašto|pokazi|pokaži|posalji mi|pošalji mi|treba mi pdf|daj mi)\b/;

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
    const question = /\?\s*$/.test(text.trim()) || QUESTION_START.test(t);

    if (/\b(napomeni|podsjeti|podsjetnik|javi mi|napisi mi|napiši mi|posalji mi poruku|pošalji mi poruku|ne zaboravi|zapamti da)\b/.test(t)
        || (times.length && /\b(trebam|moram|treba|javiti|nazvati|zvati|naruciti|naručiti|platiti|otici|otići|pitati)\b/.test(t))) kinds.add('reminder');
    if (/\b(neka|reci|recite|kazi|kaži|javi)\b/.test(t) && workerIds.length) kinds.add('task');
    if (/\b(naruci|naruči|narucio|naručio|narudzb|narudžb)\w*/.test(t) && !question) kinds.add('order');
    if (/\b(prisut|bolovanj|odmor|na terenu|nije dosao|nije došao|nisu dosli|nisu došli|odsut)\w*/.test(t) && (workerIds.length || mentionsEveryone(text))) kinds.add('presence');
    if ((facts.locations.length && (facts.dims.length || facts.widths.length || /\b(fali|fale|nije postavljen|nisam postavio|pogresno|pogrešno|ima|imam|stoji|u stanu|na hodniku)\b/.test(t)))
        || /\b(u kombiju|na hodniku|u stanu)\b/.test(t)) kinds.add('notebook');
    if (workerIds.length && /\b(radio|radili|radila|kroj|kant|brus|lakir|farb|sklap|okiv|pakov|pakuj|zapakov|montir|furnir|presov)\w*/.test(t) && !kinds.has('task')) kinds.add('work');
    if (question) kinds.add('question');

    const writeKinds = Array.from(kinds).filter(k => k !== 'question');
    return {
        kinds: Array.from(kinds),
        // Pitanje može i upisati („…, šta još fali?"), ali tad ne tjeramo upis.
        expectsWrite: writeKinds.length > 0 && !question,
        workerIds,
        times: Array.from(new Set(times)),
    };
}

const KIND_LABEL: Record<MessageKind, string> = {
    reminder: 'podsjetnik (create_task s reminder_at)', task: 'zadatak za radnika (create_task s worker)',
    notebook: 'bilježnica (remember / update_memory)', work: 'rad (log_work)', presence: 'prisustvo (set_presence)',
    order: 'narudžba (create_order / manage_order)', question: 'pitanje (odgovor, bez upisa)',
};

/** Dio napomene za model: vrsta poruke, rečeni radnici i vrijeme. */
export function intentNote(intent: MessageIntent, workerLabel: (id: string) => string): string[] {
    const parts: string[] = [];
    // Samo pitanje ne treba napomenu — model ionako odgovara.
    const kinds = intent.kinds.filter(k => k !== 'question');
    if (kinds.length) parts.push(`vrsta: ${kinds.map(k => KIND_LABEL[k]).join(' + ')}`);
    if (intent.workerIds.length) parts.push(`radnici: ${intent.workerIds.map(workerLabel).join(', ')}`);
    if (intent.times.length) parts.push(`vrijeme: ${intent.times.join(', ')}`);
    return parts;
}
