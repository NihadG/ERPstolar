// ════════════════════════════════════════════════════════════════════
// PRETRAGA POŠTE NA ZAHTJEV — Gmail čitanje za bota (samo čitanje)
//
// Pretraga vraća kratke redove (lib/email/search.ts); jedna poruka se
// čita cijela tek kad bot traži njen id. Ništa se ne šalje, ne označava
// pročitanim i ne mijenja u Gmailu.
// ════════════════════════════════════════════════════════════════════

import { plainTextOf } from '@/lib/email/classify';
import { attachmentNames, foundMailLines, gmailQuery, hasAttachmentHeader, unescapeSnippet, type FoundMail, type MailSearch } from '@/lib/email/search';
import { toZoned } from '@/lib/assistant/datetime';
import { getMessageFull, getMessageMeta, listMessageIds, mapLimit } from './gmail';

export const MAX_RESULTS = 8;
const HEADERS = ['From', 'To', 'Subject', 'Content-Type'];

/**
 * Osoba/firma + riječi, a nađeno manje od 2 → šire, redom:
 * 1. iste riječi bez osobe — mail je možda išao s druge adrese ili ime nije
 *    u zaglavlju (31.10.: „Narudzba stakala - Dino Kuća" nije bio u 8
 *    najnovijih Meriminih, a riječi su ga nalazile odmah);
 * 2. ista osoba bez riječi (najnovije prvo): „ogledala Crni Vrh" ne smije
 *    sakriti „Gotova su ogledala" ni predračun.
 */
export async function searchMail(uid: string, s: MailSearch, tz: string): Promise<{ query: string; lines: string[]; widened?: 'words' | 'who' }> {
    const query = gmailQuery(s);
    if (!query) return { query, lines: [] };
    let ids = await listMessageIds(uid, query, MAX_RESULTS);
    let widened: 'words' | 'who' | undefined;
    const hasWho = !!(s.addresses?.length || s.domains?.length || s.names?.length || s.phrase);
    if (ids.length < 2 && s.words && hasWho) {
        const byWords = await listMessageIds(uid, gmailQuery({ words: s.words, days: s.days, direction: s.direction, attachment: s.attachment }), MAX_RESULTS);
        if (byWords.some(id => !ids.includes(id))) {
            ids = Array.from(new Set([...ids, ...byWords])).slice(0, MAX_RESULTS);
            widened = 'words';
        }
    }
    if (ids.length < 2 && s.words && hasWho) {
        const more = await listMessageIds(uid, gmailQuery({ ...s, words: '' }), MAX_RESULTS);
        if (more.length > ids.length) {
            ids = Array.from(new Set([...ids, ...more])).slice(0, MAX_RESULTS);
            widened = 'who';
        }
    }
    const lines = await linesFor(uid, ids, tz);
    return { query, lines, ...(widened ? { widened } : {}) };
}

async function linesFor(uid: string, ids: string[], tz: string): Promise<string[]> {
    const metas = await mapLimit(ids, 4, id => getMessageMeta(uid, id, HEADERS));
    const mails: FoundMail[] = metas.map(m => ({
        id: m.id,
        threadId: m.threadId,
        at: new Date(Number(m.internalDate) || 0).toISOString(),
        from: m.headers.from || '',
        to: m.headers.to || '',
        subject: m.headers.subject || '',
        snippet: m.snippet,
        sent: m.labelIds.includes('SENT'),
        attachment: hasAttachmentHeader(m.headers['content-type']),
    }));
    return foundMailLines(mails, iso => toZoned(iso, tz).date);
}

/** Cijeli tekst jedne poruke (bez citata stare poruke), zaglavlja i imena priloga. */
export async function readMail(uid: string, id: string, tz: string): Promise<string> {
    const m = await getMessageFull(uid, id);
    const h: Record<string, string> = {};
    (m.payload?.headers || []).forEach((x: { name: string; value: string }) => { h[x.name.toLowerCase()] = x.value; });
    const at = toZoned(new Date(Number(m.internalDate) || 0), tz);
    const files = attachmentNames(m.payload);
    const body = plainTextOf(m.payload, 3000) || unescapeSnippet(m.snippet || '');
    return [
        `Od: ${h.from || '—'}`,
        `Za: ${h.to || '—'}${h.cc ? ` · kopija: ${h.cc}` : ''}`,
        `Datum: ${Number(at.date.slice(8, 10))}.${Number(at.date.slice(5, 7))}.${at.date.slice(0, 4)} ${at.time}`,
        `Naslov: ${h.subject || '(bez naslova)'}`,
        files.length ? `Prilozi: ${files.join(', ')}` : '',
        '',
        body,
    ].filter((l, i) => l || i === 5).join('\n');
}
