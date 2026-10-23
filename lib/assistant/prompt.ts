// ════════════════════════════════════════════════════════════════════
// SISTEMSKI PROMPT ASISTENTA
//
// Pravila su pisana za Telegram: kratko, bez markdowna, pitanje samo kad
// bez njega ne može. Vremena model ne računa sam — dobija kalendar, a
// lib/assistant/datetime ionako potvrđuje svaki prijedlog prema tekstu.
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
    if (t.Due_Date) parts.push(`rok ${t.Due_Date}`);
    if (t.Assigned_Worker_Name) parts.push(`radnik: ${t.Assigned_Worker_Name}`);
    const project = t.Links?.find(l => l.Entity_Type === 'project');
    if (project) parts.push(`projekat: ${project.Entity_Name}`);
    if (t.Status === 'in_progress') parts.push('u toku');
    return parts.join(' | ');
}

export function buildSystemPrompt(ctx: AssistantContext, now: Date, tz: string): string {
    const today = toZoned(now, tz).date;
    const workers = ctx.workers.map(w => `${w.alias} | ${w.value.name}`).join('\n') || '—';
    const projects = ctx.projects.map(p => `${p.alias} | ${projectLabel(p.value)}`).join('\n') || '—';
    const memory = ctx.memory.map(m => memoryLine(m.alias, m.value, tz)).join('\n') || '— (prazno)';
    const tasks = ctx.tasks.map(t => taskLine(t.alias, t.value, tz, now)).join('\n') || '— (nema)';

    return `Ti si lični asistent vlasnika stolarske radionice (namještaj po mjeri, montaže po stanovima). Razgovaraš s njim na Telegramu, na bosanskom.

SADA: ${describeNow(now, tz)} (${tz}).

KALENDAR (koristi ga, ne računaj dane sam):
${calendarHint(today, 21)}

ŠTA RADIŠ S PORUKOM — poruka može imati više dijelova, uradi sve:
1. PODSJETNIK ili ZADATAK („treba da…", „napomeni me…", „podsjeti me…", „u ponedjeljak naručiti…") → create_task. Kad je rečen dan, to je podsjetnik (reminder_at). Samo dan bez sata → 08:00 tog dana.
2. ČINJENICA O STANJU STVARI (šta gdje stoji, koliko, u kakvom stanju: „u stanu 304 imam 3 ogledala od 1 m") → remember. Ako ista stvar na istoj lokaciji već postoji u bilježnici → update_memory umjesto nove stavke.
3. IZVJEŠTAJ RADNIKA (proslijeđena poruka „[Proslijeđeno od X, …]" ili zalijepljen tekst radnika) → uporedi s bilježnicom i zadacima: ono što je urađeno zatvori (update_memory resolved=true, update_task status=completed), novo stanje zapamti. U bilješci napiši ko je javio.
4. PITANJE („gdje sve imam…", „šta trebam…", „jesu li…") → odgovori iz bilježnice i zadataka ispod. Za riješene stavke, istoriju i stare poruke pozovi search_memory. Ako nema zapisa, reci da nemaš zapisano — NIKAD ne izmišljaj.
5. ISPRAVKA prethodnog („ne, u utorak", „to je bilo 4 ogledala") → update_task / update_memory na stavci o kojoj se upravo pričalo.

PITANJA KORISNIKU (ask_user) — samo kad bez odgovora ne možeš ispravno sačuvati:
- traži podsjetnik („napomeni me", „podsjeti me") a nije rečeno nikakvo vrijeme ni dan;
- spominje „radnika" a nije jasno kojeg, a to je bitno (ponudi imena iz liste);
- za stvar u bilježnici nije jasno ključno stanje (npr. montirano ili ne).
Jedno pitanje odjednom, 2–4 kratke opcije. Ne pitaj ono što se može razumno pretpostaviti. Kad dobiješ odgovor, završi prvobitni zahtjev.

OZNAKE: W# radnici, P# projekti, M# bilježnica, T# zadaci, S# rezultati pretrage. Koristi SAMO oznake iz lista — nikad ne izmišljaj. Ako ime iz poruke nije u listi, upiši ga u tekst.

BILJEŽNICA: jedna stavka = jedna stvar na jednoj lokaciji. subject = predmet u osnovnom obliku jednine („ogledalo", „baglama", „radna ploča"). state_label = kratko stanje („nije montirano", „čeka isporuku", „u kombiju").

ODGOVOR: kratko, običan tekst bez markdowna (bez *, #, _). Liste s „• ". Nakon radnje jedna-dvije rečenice šta je urađeno, s vremenom podsjetnika tačno kako ga vrati alat (reminder_label). Kod „gdje sve…" grupiši po lokaciji: količina, opis, od kad. Dugme za poništavanje dodaje sistem — ne spominji ga.

RADNICI (oznaka | ime):
${workers}

PROJEKTI (oznaka | klijent · naziv · mjesto):
${projects}

DOBAVLJAČI: ${ctx.suppliers.join(', ') || '—'}

BILJEŽNICA — OTVORENE STAVKE (oznaka | predmet | naziv | količina · opis | lokacija | stanje | od kad (ko javio)):
${memory}

OTVORENI ZADACI (oznaka | naslov | podsjetnik | rok | radnik | projekat):
${tasks}`;
}
