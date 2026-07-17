// ============================================
// GOOGLE CALENDAR — događaji iz zadataka s rokom (klijentski)
// ============================================
// taskToEvent je čista funkcija (lako testirati): mapira SVA bitna polja
// zadatka u uredan Calendar događaj. upsertTaskEvent kreira/ažurira događaj.

import type { Task } from '../types';
import { TASK_PRIORITY_LABELS, TASK_CATEGORY_LABELS, TASK_STATUS_LABELS } from '../types';
import { ensureAccessToken } from './googleAuth';

const CAL_BASE = 'https://www.googleapis.com/calendar/v3/calendars';

export interface CalendarEventInput {
    summary: string;
    description: string;
    start: { date?: string; dateTime?: string };
    end: { date?: string; dateTime?: string };
    reminders?: { useDefault: boolean; overrides?: { method: string; minutes: number }[] };
}

function dateOnly(iso: string): string {
    return iso.slice(0, 10);
}

function addDaysISO(dateStr: string, days: number): string {
    // UTC-based da izbjegnemo pomak dana u pozitivnim vremenskim zonama (npr. Sarajevo).
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

/** Pretvori zadatak (s rokom) u Google Calendar događaj — mapira sva bitna polja. */
export function taskToEvent(task: Task): CalendarEventInput {
    const priority = TASK_PRIORITY_LABELS[task.Priority] || task.Priority;
    const category = TASK_CATEGORY_LABELS[task.Category] || task.Category;
    const status = TASK_STATUS_LABELS[task.Status] || task.Status;

    const lines: string[] = [];
    if (task.Description) { lines.push(task.Description, ''); }
    lines.push(`Prioritet: ${priority}`);
    lines.push(`Kategorija: ${category}`);
    lines.push(`Status: ${status}`);
    if (task.Assigned_Worker_Name) lines.push(`Dodijeljen: ${task.Assigned_Worker_Name}`);
    if (task.Links && task.Links.length > 0) {
        const names = task.Links.map((l) => l.Entity_Name).filter(Boolean);
        if (names.length) lines.push(`Povezano: ${names.join(', ')}`);
    }
    if (task.Checklist && task.Checklist.length > 0) {
        lines.push('', 'Checklist:');
        for (const c of task.Checklist) lines.push(`${c.completed ? '☑' : '☐'} ${c.text}`);
    }
    if (task.Reminder_Date) lines.push('', `Podsjetnik: ${task.Reminder_Date}`);
    if (task.Notes) lines.push('', task.Notes);
    lines.push('', '— ERP V4');

    const due = task.Due_Date || task.Reminder_Date || new Date().toISOString();
    const hasTime = due.includes('T');

    let start: CalendarEventInput['start'];
    let end: CalendarEventInput['end'];
    if (hasTime) {
        const startDt = new Date(due);
        const endDt = new Date(startDt.getTime() + 60 * 60 * 1000);
        start = { dateTime: startDt.toISOString() };
        end = { dateTime: endDt.toISOString() };
    } else {
        const d = dateOnly(due);
        start = { date: d };
        end = { date: addDaysISO(d, 1) };  // all-day: end je sljedeći dan
    }

    const prefix = task.Status === 'completed' ? '✓ ' : '';
    return {
        summary: `${prefix}${task.Title}`,
        description: lines.join('\n'),
        start,
        end,
        reminders: { useDefault: true },
    };
}

/** Apstrakcija Calendar operacija — omogućava mockanje u testovima. */
export interface CalendarClient {
    createEvent(calendarId: string, event: CalendarEventInput): Promise<{ id: string }>;
    updateEvent(calendarId: string, eventId: string, event: CalendarEventInput): Promise<{ id: string }>;
    deleteEvent(calendarId: string, eventId: string): Promise<void>;
}

async function calFetch(url: string, init: RequestInit): Promise<any> {
    const token = await ensureAccessToken();
    const headers = { ...(init.headers || {}), Authorization: `Bearer ${token}` };
    const r = await fetch(url, { ...init, headers });
    if (!r.ok) {
        const txt = await r.text().catch(() => '');
        throw new Error(`Google Calendar greška ${r.status}: ${txt.slice(0, 200)}`);
    }
    return r.status === 204 ? null : r.json();
}

export function createRealCalendarClient(): CalendarClient {
    return {
        async createEvent(calendarId, event) {
            const url = `${CAL_BASE}/${encodeURIComponent(calendarId)}/events`;
            return calFetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(event),
            });
        },
        async updateEvent(calendarId, eventId, event) {
            const url = `${CAL_BASE}/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
            return calFetch(url, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(event),
            });
        },
        async deleteEvent(calendarId, eventId) {
            const url = `${CAL_BASE}/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
            await calFetch(url, { method: 'DELETE' });
        },
    };
}

/** Kreira ili ažurira događaj za zadatak; vraća eventId. */
export async function upsertTaskEvent(
    task: Task,
    calendarId = 'primary',
    client: CalendarClient = createRealCalendarClient(),
): Promise<string> {
    const event = taskToEvent(task);
    if (task.Calendar_Event_ID) {
        const res = await client.updateEvent(calendarId, task.Calendar_Event_ID, event);
        return res.id || task.Calendar_Event_ID;
    }
    const res = await client.createEvent(calendarId, event);
    return res.id;
}

/** Obriši događaj zadatka (npr. kad se rok ukloni ili zadatak izbriše). */
export async function deleteTaskEvent(
    eventId: string,
    calendarId = 'primary',
    client: CalendarClient = createRealCalendarClient(),
): Promise<void> {
    await client.deleteEvent(calendarId, eventId);
}
