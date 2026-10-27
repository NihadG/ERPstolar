'use client';

// ════════════════════════════════════════════════════════════════════
// POSTAVKE → TELEGRAM ASISTENT
//
// Povezivanje ide jednokratnim kodom (10 min): korisnik klikne link (otvara
// bota s kodom) ili kod pošalje sam. Server veže Telegram nalog za uid i
// organizaciju iz TOKENA — kod samo dokazuje da je to isti čovjek.
// ════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiDelete, apiGet, apiPost } from '@/lib/apiClient';
import BotMessagesLog from './BotMessagesLog';

interface LinkStatus {
    configured: boolean;
    linked: { telegramName: string; linkedAt: string } | null;
}

interface LinkCode {
    code: string;
    expiresAt: string;
    botUsername: string | null;
    deepLink: string | null;
}

export default function TelegramSection({ showMessage }: { showMessage: (text: string, type: 'success' | 'error') => void }) {
    const [status, setStatus] = useState<LinkStatus | null>(null);
    const [code, setCode] = useState<LinkCode | null>(null);
    const [busy, setBusy] = useState(false);
    // Roditelj pravi novu funkciju pri svakom renderu — bez refa bi `load`
    // bio nov svaki put i efekt ispod bi zvao server u petlji.
    const messageRef = useRef(showMessage);
    messageRef.current = showMessage;

    const load = useCallback(async () => {
        try {
            setStatus(await apiGet<LinkStatus>('/api/assistant/link'));
        } catch (e: any) {
            messageRef.current(e?.message || 'Stanje Telegram veze nije dostupno.', 'error');
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    // Dok je kod otvoren, provjeravaj vezu — kad korisnik pošalje kod botu,
    // ekran sam pređe u „povezano".
    useEffect(() => {
        if (!code || status?.linked) return;
        const t = setInterval(load, 4000);
        return () => clearInterval(t);
    }, [code, status?.linked, load]);

    useEffect(() => {
        if (status?.linked) setCode(null);
    }, [status?.linked]);

    const createCode = async () => {
        setBusy(true);
        try {
            setCode(await apiPost<LinkCode>('/api/assistant/link'));
        } catch (e: any) {
            showMessage(e?.message || 'Kod nije napravljen.', 'error');
        } finally {
            setBusy(false);
        }
    };

    const unlink = async () => {
        if (!window.confirm('Prekinuti vezu s Telegramom? Podsjetnici više neće stizati dok se ponovo ne povežeš.')) return;
        setBusy(true);
        try {
            await apiDelete('/api/assistant/link');
            showMessage('Telegram veza je prekinuta.', 'success');
            await load();
        } catch (e: any) {
            showMessage(e?.message || 'Prekid veze nije uspio.', 'error');
        } finally {
            setBusy(false);
        }
    };

    return (
        <section className="settings-section">
            <div className="settings-section-header">
                <h2>Telegram asistent</h2>
                <p>
                    Glasom ili tekstom šalješ botu podsjetnike, bilješke i proslijeđene izvještaje radnika. On ih razvrsta u
                    Zadatke i Bilježnicu, šalje podsjetnike i odgovara na pitanja („gdje sve imam nemontirana ogledala?").
                </p>
            </div>

            {status && !status.configured ? (
                <div className="settings-banner settings-banner--warning">
                    <span className="material-icons-round">warning_amber</span>
                    <div>
                        <strong>Bot nije podešen na serveru</strong>
                        <p>
                            Postavi <code>TELEGRAM_BOT_TOKEN</code>, <code>TELEGRAM_WEBHOOK_SECRET</code> i <code>CRON_SECRET</code> u
                            okruženju, pa pokreni <code>node scripts/telegram-set-webhook.mjs https://tvoj-domen</code>.
                        </p>
                    </div>
                </div>
            ) : (
                <div className="settings-card">
                    <div className="settings-row">
                        <div className="settings-row-label">
                            <strong>Veza</strong>
                            <span>Podsjetnici iz Zadataka stižu na Telegram nalog povezan ovdje.</span>
                        </div>
                        <div className="settings-row-control">
                            {!status ? (
                                <span className="status-pill">Učitavam…</span>
                            ) : status.linked ? (
                                <>
                                    <span className="status-pill status-pill--success">
                                        <span className="material-icons-round">check_circle</span>
                                        {status.linked.telegramName}
                                    </span>
                                    <button className="btn btn-ghost btn-sm" onClick={unlink} disabled={busy}>Prekini vezu</button>
                                </>
                            ) : (
                                <button className="btn btn-primary btn-sm" onClick={createCode} disabled={busy}>
                                    <span className="material-icons-round">link</span>
                                    {code ? 'Novi kod' : 'Poveži Telegram'}
                                </button>
                            )}
                        </div>
                    </div>

                    {code && !status?.linked && (
                        <div className="settings-row">
                            <div className="settings-row-label">
                                <strong>Kod: <code style={{ fontSize: 18, letterSpacing: 2 }}>{code.code}</code></strong>
                                <span>
                                    {code.deepLink
                                        ? 'Otvori link na telefonu — Telegram pokreće bota s kodom. '
                                        : 'Pošalji botu poruku '}
                                    {!code.deepLink && <code>/start {code.code}</code>}
                                    {' '}Kod vrijedi do {new Date(code.expiresAt).toLocaleTimeString('hr-HR', { hour: '2-digit', minute: '2-digit' })}.
                                </span>
                            </div>
                            <div className="settings-row-control">
                                {code.deepLink && (
                                    <a className="btn btn-secondary btn-sm" href={code.deepLink} target="_blank" rel="noopener noreferrer">
                                        <span className="material-icons-round">send</span>
                                        Otvori @{code.botUsername}
                                    </a>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {status?.linked && (
                <div className="settings-card" style={{ marginTop: 16 }}>
                    <div className="settings-row-label" style={{ marginBottom: 10 }}>
                        <strong>Poruke botu (14 dana)</strong>
                        <span>Šta si poslao i šta je stvarno upisano. Poruku bez upisa obradi ponovo — potvrda stiže na Telegram.</span>
                    </div>
                    <BotMessagesLog showMessage={showMessage} />
                </div>
            )}
        </section>
    );
}
