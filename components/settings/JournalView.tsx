'use client';

// ════════════════════════════════════════════════════════════════════
// DNEVNIK UNAPREĐENJA — prikaz docs/bot/dnevnik-unapredjenja.md
//
// Mali markdown bez biblioteke: naslovi, pasusi, liste, tabele, citat,
// **podebljano** i `kod`. Fajl piše /bot-revizija; ovdje se samo čita.
// ════════════════════════════════════════════════════════════════════

import type { ReactNode } from 'react';

type Block =
    | { type: 'h'; level: number; text: string }
    | { type: 'p'; text: string }
    | { type: 'ul'; items: string[] }
    | { type: 'table'; head: string[]; rows: string[][] }
    | { type: 'quote'; text: string };

const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());

export function parseJournal(md: string): Block[] {
    const lines = md.replace(/\r/g, '').split('\n');
    const out: Block[] = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;
        const h = line.match(/^(#{1,4})\s+(.*)$/);
        if (h) { out.push({ type: 'h', level: h[1].length, text: h[2] }); continue; }
        if (/^\s*\|/.test(line)) {
            const head = cells(line);
            const rows: string[][] = [];
            i++;
            if (i < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i])) i++;
            while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(cells(lines[i++]));
            i--;
            out.push({ type: 'table', head, rows });
            continue;
        }
        if (/^\s*[-*]\s+/.test(line)) {
            const items: string[] = [];
            while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*]\s+/, ''));
            i--;
            out.push({ type: 'ul', items });
            continue;
        }
        if (/^>\s?/.test(line)) { out.push({ type: 'quote', text: line.replace(/^>\s?/, '') }); continue; }
        const para: string[] = [line.trim()];
        while (i + 1 < lines.length && lines[i + 1].trim() && !/^(#|\s*\||\s*[-*]\s|>)/.test(lines[i + 1])) para.push(lines[++i].trim());
        out.push({ type: 'p', text: para.join(' ') });
    }
    return out;
}

/** **podebljano** i `kod` unutar reda. */
function inline(text: string): ReactNode[] {
    return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((part, i) => {
        if (part.startsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>;
        if (part.startsWith('`')) return <code key={i}>{part.slice(1, -1)}</code>;
        return part;
    });
}

export function JournalView({ markdown, updatedAt }: { markdown: string; updatedAt?: string | null }) {
    if (!markdown.trim()) return <p className="bml-empty">Dnevnik unapređenja još ne postoji.</p>;
    return (
        <div className="bml-journal">
            {updatedAt && <p className="bml-muted">Zadnja izmjena {new Date(updatedAt).toLocaleDateString('hr-HR')}</p>}
            {parseJournal(markdown).map((b, i) => {
                switch (b.type) {
                    case 'h': return b.level <= 1 ? <h3 key={i}>{inline(b.text)}</h3> : <h4 key={i}>{inline(b.text)}</h4>;
                    case 'p': return <p key={i}>{inline(b.text)}</p>;
                    case 'quote': return <blockquote key={i}>{inline(b.text)}</blockquote>;
                    case 'ul': return <ul key={i}>{b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ul>;
                    case 'table': return (
                        <div key={i} className="bml-table-wrap">
                            <table>
                                <thead><tr>{b.head.map((c, j) => <th key={j}>{inline(c)}</th>)}</tr></thead>
                                <tbody>{b.rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k} data-label={b.head[k]}>{inline(c)}</td>)}</tr>)}</tbody>
                            </table>
                        </div>
                    );
                }
            })}
        </div>
    );
}
