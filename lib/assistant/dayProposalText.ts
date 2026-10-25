// ════════════════════════════════════════════════════════════════════
// PORUKE PRIJEDLOGA DANA I RUPA — tekst i dugmad (čisto, testirano)
//
// Dugmad prijedloga: jedan red po stavci (✅/⬜ = upisuje se / preskače),
// pa „Upiši označeno" i „Preskoči". Podaci dugmeta: dp:<id>:t:<i> | ok | no.
// Rupe u jutarnjem pregledu: gap:<datum> otvara prijedlog za taj dan.
// ════════════════════════════════════════════════════════════════════

import type { DayGap, DayProposal, ProposalLine } from '@/lib/dayProposal';
import type { ButtonRows } from '@/lib/telegram/api';

const WEEKDAYS = ['ned', 'pon', 'uto', 'sri', 'čet', 'pet', 'sub'];

export function shortDate(date: string): string {
    return `${WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()]} ${Number(date.slice(8, 10))}.${Number(date.slice(5, 7))}.`;
}

const half = (f: number) => (Math.abs(f - 0.5) < 0.01 ? '½ dana' : `${Math.round(f * 100)}% dana`);

export function lineText(l: ProposalLine): string {
    const where = `${l.workOrderName}${l.productNames.length ? ` (${l.productNames.join(', ')})` : ''}`;
    const what = l.process ? `${l.process}${l.next ? ' (sljedeći korak)' : ''} · ` : '';
    return `${l.workerNames.join(', ')} — ${what}${where}${l.fraction ? ` · ${half(l.fraction)}` : ''}`;
}

export function proposalMessage(p: DayProposal, id: string, excluded: number[], today: string): { text: string; buttons: ButtonRows } | null {
    if (!p.lines.length && !p.unknown.length) return null;
    const when = p.date === today ? `danas, ${shortDate(p.date)}` : shortDate(p.date);
    const text = [
        `📝 Prijedlog rada za ${when}`,
        p.lines.length ? 'Kao zadnji upis, uz završene korake pomjerene naprijed. Isključi što ne važi, pa potvrdi:' : '',
        ...p.lines.map((l, i) => `${excluded.includes(i) ? '⬜' : '✅'} ${i + 1}. ${lineText(l)}`),
        p.unknown.length ? `\nBez prijedloga (izdiktiraj ih): ${p.unknown.join(', ')}` : '',
        p.booked.length ? `Već upisano: ${p.booked.join(', ')}` : '',
        p.absent.length ? `Odsutni: ${p.absent.join(', ')}` : '',
        p.lines.length ? '\nIzmjena? Isključi stavku i izdiktiraj je porukom.' : '',
    ].filter(Boolean).join('\n');
    const buttons: ButtonRows = p.lines.map((l, i) => [{
        text: `${excluded.includes(i) ? '⬜' : '✅'} ${i + 1}. ${l.workerNames.join(', ')}${l.process ? ` — ${l.process}` : ''}`,
        data: `dp:${id}:t:${i}`,
    }]);
    const chosen = p.lines.length - excluded.filter(i => i < p.lines.length).length;
    if (p.lines.length) {
        buttons.push([
            { text: chosen ? `💾 Upiši označeno (${chosen})` : '💾 Upiši označeno', data: `dp:${id}:ok` },
            { text: 'Preskoči', data: `dp:${id}:no` },
        ]);
    }
    return { text, buttons };
}

/** Red za jutarnji pregled + dugmad za najnovije rupe (najviše 3). */
export function gapsNote(gaps: DayGap[]): { text: string; buttons: ButtonRows } | null {
    if (!gaps.length) return null;
    const shown = gaps.slice(0, 5);
    const text = [
        `📝 Nije upisan rad (${gaps.length} ${gaps.length === 1 ? 'dan' : 'dana'}):`,
        ...shown.map(g => `• ${shortDate(g.date)} — ${g.workers.join(', ')}`),
        ...(gaps.length > shown.length ? [`… i još ${gaps.length - shown.length}`] : []),
    ].join('\n');
    const buttons: ButtonRows = gaps.slice(0, 3).map(g => [{ text: `📝 Prijedlog za ${shortDate(g.date)}`, data: `gap:${g.date}` }]);
    return { text, buttons };
}
