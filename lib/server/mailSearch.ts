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

export async function searchMail(uid: string, s: MailSearch, tz: string): Promise<{ query: string; lines: string[] }> {
    const query = gmailQuery(s);
    if (!query) return { query, lines: [] };
    const ids = await listMessageIds(uid, query, MAX_RESULTS);
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
    return { query, lines: foundMailLines(mails, iso => toZoned(iso, tz).date) };
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
