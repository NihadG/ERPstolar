// ════════════════════════════════════════════════════════════════════
// SISTEMSKI PROMPT ASISTENTA
//
// Pravila su pisana za Telegram: kratko, bez markdowna, pitanje samo kad
// bez njega ne može. Vremena model ne računa sam — dobija kalendar, a
// lib/assistant/datetime ionako potvrđuje svaki prijedlog prema tekstu.
//
// Prompt je u DVA dijela, zbog keša: keš je podudaranje od početka, pa bi
// „SADA: 14:05" na vrhu poništavao keš svake minute. Stabilni dio (pravila,
// radnici, projekti) ide prvi i kešira se; vrijeme, kalendar, bilježnica i
// zadaci idu iza njega.
// ════════════════════════════════════════════════════════════════════

import { calendarHint } from '@/lib/voice/dates';
import { describeNow, formatReminder, toZoned } from './datetime';
import { projectLabel, type AssistantContext } from './context';
import type { MemoryItem, Task } from '@/lib/types';

function shortDate(iso: string, tz: string): string {
    const d = toZoned(iso, tz).date;
    return `${Number(d.slice(8, 10))}.${Number(d.slice(5, 7))}.`;
}

export function memoryLine(alias: string, m: MemoryItem, tz: string): string {
    const qty = [m.Quantity != null ? `${m.Quantity} ${m.Unit || 'kom'}` : '', m.Spec || ''].filter(Boolean).join(' · ');
    const last = m.History?.[m.History.length - 1];
    const who = last?.By ? ` (${last.By})` : '';
    return [
        alias, m.Subject, m.Title !== m.Subject ? m.Title : '', qty, m.Location || '—',
        m.State === 'resolved' ? `RIJEŠENO: ${m.State_Label}` : m.State_Label,
        `od ${shortDate(m.Created_At, tz)}${who}`,
    ].filter(Boolean).join(' | ');
}

export function taskLine(alias: string, t: Task, tz: string, now: Date): string {
    const parts = [alias, t.Title];
    if (t.Reminder_At) parts.push(`podsjetnik ${formatReminder(t.Reminder_At, tz, now)}${t.Reminder_Pending ? '' : ' (poslan)'}`);
    if (t.Due_Date) parts.push(`rok ${t.Due_Date.slice(0, 10)}`);
    if (t.Assigned_Worker_Name) parts.push(`radnik: ${t.Assigned_Worker_Name}`);
    const project = t.Links?.find(l => l.Entity_Type === 'project');
    if (project) parts.push(`projekat: ${project.Entity_Name}`);
    const steps = (t.Checklist || []).filter(c => !c.completed).map(c => c.text);
    if (steps.length) parts.push(`lista: ${steps.slice(0, 6).join('; ')}`);
    if (t.Status === 'in_progress') parts.push('u toku');
    return parts.join(' | ');
}

const RULES = `ŠTA RADIŠ S PORUKOM — poruka može imati više dijelova, uradi sve:
1. PODSJETNIK ili ZADATAK („treba da…", „napomeni me…", „podsjeti me…", „u ponedjeljak naručiti…") → create_task. Kad je rečen dan, to je podsjetnik (reminder_at). Samo dan bez sata → 08:00 tog dana.
   JEDAN POSAO = JEDAN ZADATAK. Kad isti posao ima više koraka ili više ljudi („Imeru da napravi ploču, a Kerimu da odradi CNC"), napravi JEDAN zadatak s check listom: svaka stavka je korak s imenom osobe („Imer — napraviti ploču za Dinu", „Kerim — CNC"). worker = glavna/prva osoba. Više zadataka samo za stvarno nepovezane poslove.
   Odgovor na tvoje pitanje ili dopuna („a Kerimu reci…", „dodaj i…") ide u ISTI zadatak — ako je već napravljen, update_task s add_checklist, ne novi zadatak.
2. ČINJENICA O STANJU STVARI (šta gdje stoji, koliko, u kakvom stanju: „u stanu 304 imam 3 ogledala od 1 m") → remember. Ako ista stvar na istoj lokaciji već postoji u bilježnici → update_memory umjesto nove stavke.
3. IZVJEŠTAJ RADNIKA (proslijeđena poruka „[Proslijeđeno od X, …]" ili zalijepljen tekst radnika) → uporedi s bilježnicom i zadacima: ono što je urađeno zatvori (update_memory resolved=true, update_task status=completed), novo stanje zapamti. U bilješci napiši ko je javio.
4. PITANJE („gdje sve imam…", „šta trebam…", „jesu li…") → odgovori iz bilježnice i zadataka na kraju uputa. Tamo su samo otvorene stavke i bliski zadaci (±30 dana); za riješene stavke, starije ili daleke zadatke, istoriju i stare poruke pozovi search_memory. Ako nema zapisa, reci da nemaš zapisano — NIKAD ne izmišljaj.
5. ISPRAVKA prethodnog („ne, u utorak", „to je bilo 4 ogledala") → update_task / update_memory na stavci o kojoj se upravo pričalo.

PITANJA KORISNIKU (ask_user) — samo kad bez odgovora ne možeš ispravno sačuvati:
- traži podsjetnik („napomeni me", „podsjeti me") a nije rečeno nikakvo vrijeme ni dan;
- spominje „radnika" a nije jasno kojeg, a to je bitno (ponudi imena iz liste);
- za stvar u bilježnici nije jasno ključno stanje (npr. montirano ili ne).
Jedno pitanje odjednom, 2–4 kratke opcije. Ne pitaj ono što se može razumno pretpostaviti. Kad dobiješ odgovor, završi prvobitni zahtjev.

OZNAKE: W# radnici, P# projekti, M# bilježnica, T# zadaci, S# rezultati pretrage. Koristi SAMO oznake iz lista — nikad ne izmišljaj. Ako ime iz poruke nije u listi, upiši ga u tekst.
Oznake su SAMO za alate — korisniku ih NIKAD ne piši (ni u odgovoru ni u opcijama pitanja). Piši imena: „Imer", ne „Imer (W9)".

BILJEŽNICA: jedna stavka = jedna stvar na jednoj lokaciji. subject = predmet u osnovnom obliku jednine („ogledalo", „baglama", „radna ploča"). state_label = kratko stanje („nije montirano", „čeka isporuku", „u kombiju").

ODGOVOR: kratko, običan tekst bez markdowna (bez *, #, _). Liste s „• ". Kad samo upisuješ (zadatak, bilješka, izmjena), potvrdu korisniku složi sistem iz rezultata alata — ne trebaš je pisati. Na pitanja odgovaraš tekstom; kod „gdje sve…" grupiši po lokaciji: količina, opis, od kad. Dugme za poništavanje dodaje sistem — ne spominji ga.`;

export interface PromptParts {
    /** Ne mijenja se od poruke do poruke (pravila, radnici, projekti) — ide u keš. */
    stable: string;
    /** Mijenja se (vrijeme, kalendar, bilježnica, zadaci) — ide POSLIJE keširanog dijela. */
    volatile: string;
}

export function buildPromptParts(ctx: AssistantContext, now: Date, tz: string): PromptParts {
    const today = toZoned(now, tz).date;
    const workers = ctx.workers.map(w => `${w.alias} | ${w.value.name}`).join('\n') || '—';
    const projects = ctx.projects.map(p => `${p.alias} | ${projectLabel(p.value)}`).join('\n') || '—';
    const memory = ctx.memory.map(m => memoryLine(m.alias, m.value, tz)).join('\n') || '— (prazno)';
    const tasks = ctx.tasks.map(t => taskLine(t.alias, t.value, tz, now)).join('\n') || '— (nema)';

    const stable = `Ti si lični asistent vlasnika stolarske radionice (namještaj po mjeri, montaže po stanovima). Razgovaraš s njim na Telegramu, na bosanskom. Trenutno vrijeme, kalendar, bilježnica i zadaci su na kraju uputa.

${RULES}

RADNICI (oznaka | ime):
${workers}

PROJEKTI (oznaka | klijent · naziv · mjesto):
${projects}

DOBAVLJAČI: ${ctx.suppliers.join(', ') || '—'}`;

    const volatile = `SADA: ${describeNow(now, tz)} (${tz}).

KALENDAR (koristi ga, ne računaj dane sam):
${calendarHint(today, 21)}

BILJEŽNICA — OTVORENE STAVKE (oznaka | predmet | naziv | količina · opis | lokacija | stanje | od kad (ko javio)):
${memory}

OTVORENI ZADACI, BLISKI (oznaka | naslov | podsjetnik | rok | radnik | projekat | lista):
${tasks}`;

    return { stable, volatile };
}
