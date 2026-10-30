'use client';

// ════════════════════════════════════════════════════════════════════
// PORUKE BOTU — dnevnik onoga što si poslao botu i šta je stvarno upisano
//
// Svaka poruka ima ishod (upisano / pitanje / odgovor / nije upisano) i signale
// (šta je ERP morao ispravljati, Poništi, tvoja ispravka i napomena). „Za
// pregled" su one koje traže pažnju; „Dnevnik unapređenja" je
// docs/bot/dnevnik-unapredjenja.md koji dopunjava /bot-revizija.
// Poruka bez upisa može se obraditi ponovo — odgovor stiže na Telegram s ↩️ Poništi.
// Čist prikaz (BotMessagesView) da ga /bot-log-preview renderuje bez prijave.
// ════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiGet, apiPost } from '@/lib/apiClient';
import { billedTokens, summarizeUsage } from '@/lib/assistant/usage';
import { SIGNAL_LABEL, type Signal } from '@/lib/assistant/signals';
import { JournalView } from './JournalView';
import type { AssistantUsage } from '@/lib/types';
import './BotMessagesLog.css';

export interface BotEntry {
    id: string;
    at: string;
    kind: string;
    text: string;
    from: string | null;
    outcome: 'written' | 'question' | 'answer' | 'failed' | 'degraded' | 'unknown';
    reply: string | null;
    changes: string[];
    /** Šta je model poslao alatima (skraćeno) i šta je ERP vratio. */
    toolCalls?: { name: string; args: string; ok: boolean; error?: string }[];
    attempts: number;
    /** Potrošnja modela (krugovi, tokeni) — od 30.10.2026. */
    usage?: AssistantUsage | null;
    /** Signali (lib/assistant/signals.ts) i tvoje napomene odgovorom na poruku bota. */
    signals?: string[];
    feedback?: { at: string; kind: string; text: string }[];
}

const OUTCOME: Record<BotEntry['outcome'], { label: string; tone: string }> = {
    written: { label: 'Upisano', tone: 'ok' },
    question: { label: 'Bot pitao', tone: 'info' },
    answer: { label: 'Odgovor', tone: 'muted' },
    failed: { label: 'Nije upisano', tone: 'bad' },
    degraded: { label: 'AI nije radio', tone: 'bad' },
    unknown: { label: 'Bez upisa', tone: 'warn' },
};

/** Signali koje treba pogledati; čuvari koji su sami popravili krug (read_guard, mail_guard) nisu među njima. */
const REVIEW = new Set(['corrected', 'undone', 'nemam', 'write_guard', 'tool_error', 'coverage', 'feedback']);

/** Poruke koje traže pažnju: ništa nije upisano, ispravio si je, poništio ili si ostavio napomenu. */
const needsLook = (e: BotEntry) => e.outcome === 'failed' || e.outcome === 'degraded' || e.outcome === 'unknown'
    || !!e.feedback?.length || (e.signals || []).some(s => REVIEW.has(s));

const signalLabel = (s: string) => SIGNAL_LABEL[s as Signal] || s;

const num = (n: number) => n.toLocaleString('bs-BA');

/** Npr. 2 kruga · ulaz 15.300 (keš 13.900) · izlaz 210 · ≈ 2.850 obračunskih · 3,1 s */
function usageLine(u: AssistantUsage): string {
    const input = u.input + u.cacheRead + u.cacheWrite5m + u.cacheWrite1h;
    const krug = u.calls === 1 ? 'krug' : u.calls < 5 ? 'kruga' : 'krugova';
    return `${u.calls} ${krug} · ulaz ${num(input)} (keš ${num(u.cacheRead)}) · izlaz ${num(u.output)} · ≈ ${num(billedTokens(u))} obračunskih · ${(u.ms / 1000).toFixed(1)} s${u.toolSet ? ` · alati: ${u.toolSet}` : ''}`;
}

function when(iso: string): string {
    const d = new Date(iso);
    return `${d.toLocaleDateString('hr-HR', { day: 'numeric', month: 'numeric' })} ${d.toLocaleTimeString('hr-HR', { hour: '2-digit', minute: '2-digit' })}`;
}

export function BotMessagesView({ entries, busyId, onReprocess, journal }: {
    entries: BotEntry[];
    busyId?: string | null;
    onReprocess?: (e: BotEntry) => void;
    /** Dnevnik unapređenja (markdown); nema = kartica se ne prikazuje. */
    journal?: { markdown: string; updatedAt?: string | null } | null;
}) {
    const [filter, setFilter] = useState<'look' | 'all' | 'journal'>('look');
    const [open, setOpen] = useState<string | null>(null);
    const counts = useMemo(() => ({
        all: entries.length,
        look: entries.filter(needsLook).length,
        written: entries.filter(e => e.outcome === 'written').length,
    }), [entries]);
    const shown = filter === 'look' ? entries.filter(needsLook) : entries;
    const spend = useMemo(() => summarizeUsage(entries.map(e => ({ at: e.at, usage: e.usage }))), [entries]);

    return (
        <div className="bml">
            <div className="bml-head">
                <div className="bml-tabs" role="tablist">
                    <button role="tab" aria-selected={filter === 'look'} className={filter === 'look' ? 'on' : ''} onClick={() => setFilter('look')}>
                        Za pregled <span>{counts.look}</span>
                    </button>
                    <button role="tab" aria-selected={filter === 'all'} className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>
                        Sve <span>{counts.all}</span>
                    </button>
                    {journal && (
                        <button role="tab" aria-selected={filter === 'journal'} className={filter === 'journal' ? 'on' : ''} onClick={() => setFilter('journal')}>
                            Dnevnik unapređenja
                        </button>
                    )}
                </div>
                <span className="bml-sum">{counts.written} od {counts.all} upisano</span>
            </div>
            {spend.messages > 0 && (
                <p className="bml-spend" title="Obračunski tokeni: sve svedeno na cijenu ulaznog tokena (keš ×0,1, upis keša ×1,25–2, izlaz ×5)">
                    🧮 Potrošnja ({spend.messages} poruka s mjerenjem): prosjek {String(spend.avgCalls).replace('.', ',')} kruga i ≈ {num(spend.avgBilled)} obračunskih tokena po poruci · iz keša {Math.round(spend.cacheShare * 100)}% ulaza · ukupno ≈ {num(spend.billed)}
                </p>
            )}
            {filter === 'journal' && journal ? (
                <JournalView markdown={journal.markdown} updatedAt={journal.updatedAt} />
            ) : shown.length === 0 ? (
                <p className="bml-empty">{filter === 'look' ? 'Ništa za pregled. 👍' : 'Nema poruka u ovom periodu.'}</p>
            ) : (
                <ul className="bml-list">
                    {shown.map(e => {
                        const o = OUTCOME[e.outcome];
                        const expanded = open === e.id;
                        return (
                            <li key={e.id} className={`bml-item ${o.tone}`}>
                                <button className="bml-main" onClick={() => setOpen(expanded ? null : e.id)} aria-expanded={expanded}>
                                    <span className="bml-when">{when(e.at)}{e.kind === 'voice' ? ' · 🎙' : ''}{e.from ? ` · od ${e.from}` : ''}</span>
                                    <span className="bml-text">{e.text}</span>
                                    <span className={`bml-badge ${o.tone}`}>{o.label}</span>
                                    {(!!e.signals?.length || !!e.feedback?.length) && (
                                        <span className="bml-signals">
                                            {(e.signals || []).filter(s => s !== 'feedback').map(s => (
                                                <span key={s} className={`bml-signal ${REVIEW.has(s) ? 'warn' : ''}`}>{signalLabel(s)}</span>
                                            ))}
                                            {!!e.feedback?.length && <span className="bml-signal note">📝 napomena</span>}
                                        </span>
                                    )}
                                </button>
                                {expanded && (
                                    <div className="bml-detail">
                                        {(e.feedback || []).map((f, i) => (
                                            <p key={i} className="bml-feedback"><strong>📝 Tvoja napomena ({f.kind === 'dobro' ? 'dobro' : f.kind === 'lose' ? 'loše' : 'napomena'}, {when(f.at)}):</strong> {f.text}</p>
                                        ))}
                                        {e.changes.length > 0 && <p><strong>Upisano:</strong> {e.changes.join(', ')}</p>}
                                        {e.reply && <p className="bml-reply"><strong>Bot je odgovorio:</strong> {e.reply}</p>}
                                        {!e.reply && e.outcome === 'unknown' && <p className="bml-reply">Odgovor bota nije sačuvan (poruka je starija od dnevnika ishoda), a u ERP-u nema ničeg upisanog iz nje.</p>}
                                        {!!e.toolCalls?.length && (
                                            <div className="bml-calls">
                                                <strong>Alati:</strong>
                                                <ul>
                                                    {e.toolCalls.map((c, i) => (
                                                        <li key={i} className={c.ok ? '' : 'bad'}>
                                                            <code>{c.name}</code> <span className="bml-args">{c.args}</span>
                                                            {!c.ok && c.error && <em> → {c.error}</em>}
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}
                                        {e.usage && e.usage.calls > 0 && <p className="bml-muted">🧮 {usageLine(e.usage)}</p>}
                                        {e.attempts > 1 && <p className="bml-muted">Obrađeno {e.attempts} puta.</p>}
                                    </div>
                                )}
                                {needsLook(e) && onReprocess && (
                                    <button className="btn btn-secondary btn-sm bml-retry" disabled={!!busyId} onClick={() => onReprocess(e)}>
                                        <span className="material-icons-round">refresh</span>
                                        {busyId === e.id ? 'Obrađujem…' : 'Obradi ponovo'}
                                    </button>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}

export default function BotMessagesLog({ showMessage }: { showMessage: (text: string, type: 'success' | 'error') => void }) {
    const [entries, setEntries] = useState<BotEntry[] | null>(null);
    const [journal, setJournal] = useState<{ markdown: string; updatedAt: string | null } | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    // Roditelj pravi novu funkciju pri svakom renderu — bez refa bi učitavanje išlo u petlji.
    const messageRef = useRef(showMessage);
    messageRef.current = showMessage;

    const load = useCallback(async () => {
        try {
            setEntries((await apiGet<{ entries: BotEntry[] }>('/api/assistant/entries?days=14')).entries);
        } catch (e: any) {
            messageRef.current(e?.message || 'Poruke bota nisu učitane.', 'error');
            setEntries([]);
        }
    }, []);

    useEffect(() => { load(); }, [load]);
    // Dnevnik unapređenja: ne smeta ako ga nema (kartica se tad ne prikazuje).
    useEffect(() => {
        apiGet<{ markdown: string; updatedAt: string | null }>('/api/assistant/journal')
            .then(j => setJournal(j.markdown ? j : null))
            .catch(() => setJournal(null));
    }, []);

    const reprocess = async (e: BotEntry) => {
        setBusyId(e.id);
        try {
            const res = await apiPost<{ outcome: string; reply: string }>('/api/assistant/entries', { entryId: e.id });
            showMessage(res.outcome === 'written' ? 'Upisano — potvrda je stigla i na Telegram.' : 'Obrađeno — odgovor je na Telegramu.', res.outcome === 'written' ? 'success' : 'error');
            await load();
        } catch (err: any) {
            showMessage(err?.message || 'Ponovna obrada nije uspjela.', 'error');
        } finally {
            setBusyId(null);
        }
    };

    if (!entries) return <p className="bml-empty">Učitavam poruke…</p>;
    return <BotMessagesView entries={entries} busyId={busyId} onReprocess={reprocess} journal={journal} />;
}
