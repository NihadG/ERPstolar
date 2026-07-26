'use client';

// ════════════════════════════════════════════════════════════════════
// SPREMNOST SISTEMA — panel u Postavkama.
//
// Odgovara na jedno pitanje: „kada se podacima može vjerovati dovoljno da
// planiranje bude precizno?" Svaki podrezultat kaže ŠTA fali i ŠTA uraditi.
//
// Namjerno se prikazuje i `cappedBy`: kad je zbir visok a rasipanje veliko,
// nivo se SPUŠTA — jer više podataka to ne liječi. Bez toga bi panel lagao.
// ════════════════════════════════════════════════════════════════════

import { useState, useCallback } from 'react';
import { getDataReadiness, rebuildProductionSnapshots, type Readiness } from '@/lib/services';
import { useAuth } from '@/context/AuthContext';
import './SystemReadiness.css';

const LEVEL_CLASS: Record<string, string> = {
    evidencija: 'sr-level-low',
    indikativno: 'sr-level-mid',
    raspon: 'sr-level-good',
    precizno: 'sr-level-best',
};

function scoreClass(score: number): string {
    if (score >= 80) return 'sr-bar-best';
    if (score >= 60) return 'sr-bar-good';
    if (score >= 30) return 'sr-bar-mid';
    return 'sr-bar-low';
}

export default function SystemReadiness() {
    const { organization } = useAuth();
    const orgId = organization?.Organization_ID || '';

    const [readiness, setReadiness] = useState<Readiness | null>(null);
    const [loading, setLoading] = useState(false);
    const [rebuilding, setRebuilding] = useState(false);
    const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
    const [note, setNote] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

    const load = useCallback(async () => {
        if (!orgId) return;
        setLoading(true);
        setNote(null);
        try {
            const r = await getDataReadiness(orgId);
            setReadiness(r);
            if (!r) setNote({ text: 'Greška pri učitavanju spremnosti', type: 'error' });
        } finally {
            setLoading(false);
        }
    }, [orgId]);

    const rebuild = useCallback(async () => {
        if (!orgId || rebuilding) return;
        setRebuilding(true);
        setProgress({ done: 0, total: 0 });
        setNote(null);
        try {
            const res = await rebuildProductionSnapshots(orgId, {
                onProgress: (done, total) => setProgress({ done, total }),
            });
            setNote({ text: res.message, type: res.success ? 'success' : 'error' });
            if (res.success) await load();
        } catch {
            setNote({ text: 'Greška pri regeneraciji snapshota', type: 'error' });
        } finally {
            setRebuilding(false);
            setProgress(null);
        }
    }, [orgId, rebuilding, load]);

    return (
        <section className="settings-section">
            <div className="settings-section-header">
                <h2>Podaci i spremnost</h2>
                <p>
                    Koliko je sistem zreo da bi planiranje bilo precizno. Svaki red kaže šta fali
                    i šta konkretno uraditi.
                </p>
            </div>

            <div className="sr-actions">
                <button className="btn btn-secondary" onClick={load} disabled={loading || rebuilding}>
                    <span className="material-icons-round">assessment</span>
                    {loading ? 'Računam…' : readiness ? 'Osvježi' : 'Izračunaj spremnost'}
                </button>
                <button className="btn btn-secondary" onClick={rebuild} disabled={rebuilding || loading}>
                    <span className="material-icons-round">autorenew</span>
                    {rebuilding
                        ? (progress?.total ? `Regenerišem ${progress.done}/${progress.total}…` : 'Regenerišem…')
                        : 'Regeneriši snapshote'}
                </button>
            </div>

            <p className="sr-hint">
                Regeneracija ponovo izračunava snapshote iz dnevnica i naloga te briše duplikate.
                Sigurna je i može se ponavljati — snapshot je izveden podatak. Pokreni je nakon
                izmjene pravila klasifikacije.
            </p>

            {note && (
                <div className={`sr-note ${note.type === 'error' ? 'sr-note-error' : 'sr-note-ok'}`}>
                    {note.text}
                </div>
            )}

            {readiness && (
                <>
                    <div className={`sr-hero ${LEVEL_CLASS[readiness.level] || ''}`}>
                        <div className="sr-hero-score">
                            <span className="sr-hero-number">{Math.round(readiness.score)}</span>
                            <span className="sr-hero-max">/ 100</span>
                        </div>
                        <div className="sr-hero-body">
                            <h3>{readiness.levelLabel}</h3>
                            <p>{readiness.unlocked}</p>
                            {readiness.nextUnlock && (
                                <p className="sr-hero-next">{readiness.nextUnlock}</p>
                            )}
                        </div>
                    </div>

                    {readiness.cappedBy && (
                        <div className="sr-capped">
                            <span className="material-icons-round">warning_amber</span>
                            <div>
                                <strong>Nivo je ograničen</strong>
                                <p>{readiness.cappedBy}</p>
                            </div>
                        </div>
                    )}

                    {readiness.topActions.length > 0 && (
                        <div className="sr-todo">
                            <h4>Šta najviše diže spremnost</h4>
                            <ol>
                                {readiness.topActions.map((a, i) => <li key={i}>{a}</li>)}
                            </ol>
                        </div>
                    )}

                    <div className="sr-metrics">
                        {readiness.metrics.map(m => (
                            <div className="sr-metric" key={m.key}>
                                <div className="sr-metric-head">
                                    <span className="sr-metric-label">{m.label}</span>
                                    <span className="sr-metric-score">{Math.round(m.score)}%</span>
                                </div>
                                <div className="sr-track">
                                    <div
                                        className={`sr-fill ${scoreClass(m.score)}`}
                                        style={{ width: `${Math.max(0, Math.min(100, m.score))}%` }}
                                    />
                                </div>
                                <div className="sr-metric-value">{m.value}</div>
                                <div className="sr-metric-why">{m.why}</div>
                                {m.actions.length > 0 && (
                                    <ul className="sr-metric-actions">
                                        {m.actions.map((a, i) => <li key={i}>{a}</li>)}
                                    </ul>
                                )}
                            </div>
                        ))}
                    </div>
                </>
            )}

            {!readiness && !loading && (
                <p className="sr-empty">
                    Pokreni izračun da vidiš koliko su podaci spremni za planiranje.
                </p>
            )}
        </section>
    );
}
