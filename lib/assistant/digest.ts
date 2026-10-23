// ════════════════════════════════════════════════════════════════════
// PREGLEDI — jutarnji pregled (tick u 07:00), /danas i /otvoreno.
//
// Deterministički, bez modela: ovo mora stići i kad AI ne radi, i mora biti
// tačno do posljednje stavke.
// ════════════════════════════════════════════════════════════════════

import { getAllTasks } from '@/lib/server/fieldRepo';
import { formatReminder, toZoned } from './datetime';
import { listMemory } from './store';
import type { MemoryItem, Task } from '@/lib/types';

const OPEN = new Set<Task['Status']>(['pending', 'in_progress']);

function taskLabel(t: Task, tz: string, now: Date): string {
    const bits = [t.Title];
    if (t.Reminder_At) bits.push(formatReminder(t.Reminder_At, tz, now));
    if (t.Assigned_Worker_Name) bits.push(t.Assigned_Worker_Name);
    return `• ${bits.join(' — ')}`;
}

/** Zadaci za danas + zakašnjeli. null kad nema ničega (jutarnji pregled se tad ne šalje). */
export async function buildTodayDigest(orgId: string, now: Date, tz: string): Promise<string | null> {
    const today = toZoned(now, tz).date;
    const open = (await getAllTasks(orgId)).filter(t => OPEN.has(t.Status));

    const todays = open.filter(t => (t.Reminder_At && toZoned(t.Reminder_At, tz).date === today) || t.Due_Date === today);
    const late = open.filter(t => !todays.includes(t) && t.Due_Date && t.Due_Date < today);
    if (!todays.length && !late.length) return null;

    const byTime = (a: Task, b: Task) => (a.Reminder_At || a.Due_Date || '').localeCompare(b.Reminder_At || b.Due_Date || '');
    const lines: string[] = [];
    if (todays.length) {
        lines.push(`📅 Danas (${todays.length}):`);
        todays.sort(byTime).forEach(t => lines.push(taskLabel(t, tz, now)));
    }
    if (late.length) {
        if (lines.length) lines.push('');
        lines.push(`⚠️ Kasni (${late.length}):`);
        late.sort(byTime).slice(0, 15).forEach(t => lines.push(`• ${t.Title} — rok ${t.Due_Date}`));
        if (late.length > 15) lines.push(`… i još ${late.length - 15}`);
    }
    return lines.join('\n');
}

function memoryLabel(m: MemoryItem): string {
    const qty = m.Quantity != null ? `${m.Quantity} ${m.Unit || 'kom'} ` : '';
    const spec = m.Spec ? ` (${m.Spec})` : '';
    return `• ${qty}${m.Title}${spec} — ${m.State_Label}`;
}

/** Otvorene stavke bilježnice, grupisane po lokaciji. */
export async function buildOpenMemory(orgId: string, uid: string): Promise<string> {
    const items = await listMemory(orgId, uid);
    if (!items.length) return 'Bilježnica je prazna — nema otvorenih stavki.';
    const groups = new Map<string, MemoryItem[]>();
    for (const m of items) {
        const key = m.Location || 'Bez lokacije';
        groups.set(key, [...(groups.get(key) || []), m]);
    }
    const lines: string[] = [`📒 Otvoreno (${items.length}):`];
    Array.from(groups.entries())
        .sort(([a], [b]) => a.localeCompare(b, 'bs'))
        .forEach(([loc, list]) => {
            lines.push('', `📍 ${loc}`);
            list.forEach(m => lines.push(memoryLabel(m)));
        });
    return lines.join('\n');
}
