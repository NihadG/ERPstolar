'use client';

// ════════════════════════════════════════════════════════════════════
// GRUPNO OZNAČAVANJE — pandan desktop „Bulk uređivanju", ali kao VLASTITI EKRAN
//
// Desktop otvori modal za dan i pusti te da postaviš sve radnike odjednom
// (brzo „postavi sve na…", „kao jučer", pa fina korekcija po radniku). Na
// telefonu je to isto, samo puni ekran: gore brza traka, ispod lista radnika,
// a pojedinačni izbor koristi ISTI StatusSheet kao i inače — samo u „nacrt"
// modu (bira, ne snima). Snima se sve odjednom na dnu.
//
// Dnevnice se NE knjiže ovdje. Kad se sačuva, prisutni bez dnevnice ispadnu na
// traci „N bez dnevnice → Proknjiži" na šihtarici — jedan dodir do knjiženja.
// ════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, History } from 'lucide-react';
import type { FieldWorkerRow } from '@/lib/field/fieldAttendance';
import { MAvatar } from '@/components/tabs/mobile/MobileUI';
import { useOverlayGuard } from '@/components/tabs/mobile/overlayGuard';
import { useSwipeBack, haptic } from '@/components/tabs/mobile/useSwipe';
import { ATTENDANCE_STATUSES } from '@/lib/types';
import StatusSheet from './StatusSheet';

const TONE: Record<string, string> = {
    'Prisutan': 'green', 'Teren': 'blue', 'Odsutan': 'gray',
    'Bolovanje': 'orange', 'Odmor': 'orange', 'Vikend': 'gray', 'Praznik': 'purple',
};

const initials = (name: string) =>
    name.split(' ').filter(Boolean).map(p => p[0]).join('').toUpperCase().slice(0, 2) || '?';

const longDate = (iso: string) =>
    new Date(iso + 'T12:00:00').toLocaleDateString('bs-BA', { weekday: 'long', day: 'numeric', month: 'long' });

interface Props {
    date: string;
    workers: FieldWorkerRow[];
    /** Trenutni status po radniku za taj dan (prazno = neoznačen). */
    current: Map<string, string>;
    /** Jučerašnji status po radniku — za „Kao jučer". */
    yesterday: Map<string, string>;
    onClose: () => void;
    /** Snima IZMIJENJENE radnike; baca grešku da ekran ostane otvoren za ponovni pokušaj. */
    onSave: (entries: { workerId: string; status: string }[]) => Promise<void>;
}

export default function BulkAttendanceScreen({ date, workers, current, yesterday, onClose, onSave }: Props) {
    // Nacrt kreće od zatečenog stanja — kao desktop (pretpopunjeno iz baze).
    const [draft, setDraft] = useState<Map<string, string>>(() => new Map(current));
    const [picker, setPicker] = useState<{ workerId: string; name: string } | null>(null);
    const [saving, setSaving] = useState(false);

    // Hardverska nazad-tipka i edge-swipe zatvaraju ekran — ista pogodba kao
    // BookingScreen. Swipe se gasi dok je otvoren izbornik ili dok se snima.
    useEffect(() => {
        window.history.pushState({ fieldBulk: true }, '');
        const onPop = () => onClose();
        window.addEventListener('popstate', onPop);
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            window.removeEventListener('popstate', onPop);
            document.body.style.overflow = prev;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const goBack = () => window.history.back();
    useOverlayGuard(true);
    const swipeRef = useSwipeBack(goBack, { enabled: !saving && !picker });

    const setAll = (status: string) => {
        haptic(6);
        setDraft(() => {
            const next = new Map<string, string>();
            for (const w of workers) next.set(w.workerId, status);
            return next;
        });
    };

    const setAllYesterday = () => {
        haptic(6);
        setDraft(prev => {
            const next = new Map(prev);
            for (const w of workers) {
                const ys = yesterday.get(w.workerId);
                if (ys) next.set(w.workerId, ys);
            }
            return next;
        });
    };

    const pick = (workerId: string, status: string) => {
        setDraft(prev => new Map(prev).set(workerId, status));
        setPicker(null);
    };

    // Snima se samo ono što je stvarno promijenjeno (nacrt ≠ zatečeno).
    const changed = useMemo(
        () => workers
            .map(w => ({ workerId: w.workerId, status: draft.get(w.workerId) || '' }))
            .filter(e => e.status && e.status !== (current.get(e.workerId) || '')),
        [workers, draft, current]
    );

    const confirm = async () => {
        if (saving || changed.length === 0) return;
        setSaving(true);
        try {
            await onSave(changed);
            onClose();
        } catch {
            // Greška je već prijavljena toastom u roditelju — ostavi ekran otvoren.
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="mui fbk" ref={swipeRef}>
            <header className="mwd-nav mui-subnav">
                <button type="button" className="mwd-back" onClick={goBack} disabled={saving}>
                    <ArrowLeft size={21} strokeWidth={2.3} /> Šihtarica
                </button>
            </header>

            <div className="fbk-head">
                <h1>Grupno označavanje</h1>
                <p>{longDate(date)} · postavi više radnika odjednom</p>
            </div>

            {/* Brzo: postavi sve na … */}
            <div className="fgr-quick">
                <span className="fgr-quick-l">Postavi sve na</span>
                <div className="fgr-quick-rail">
                    <button type="button" className="fgr-qchip" onClick={setAllYesterday}>
                        <History size={15} /> Kao jučer
                    </button>
                    {ATTENDANCE_STATUSES.map(s => (
                        <button key={s} type="button" className={`fgr-qchip ${TONE[s] || 'gray'}`} onClick={() => setAll(s)}>
                            {s}
                        </button>
                    ))}
                </div>
            </div>

            {/* Lista radnika — iste kartice kao na šihtarici */}
            <div className="fgr-list">
                {workers.map(w => {
                    const st = draft.get(w.workerId) || '';
                    const tone = st ? (TONE[st] || 'gray') : 'none';
                    const isChanged = !!st && st !== (current.get(w.workerId) || '');
                    return (
                        <button
                            key={w.workerId}
                            type="button"
                            className={`fat-card ${tone}`}
                            disabled={saving}
                            onClick={() => setPicker({ workerId: w.workerId, name: w.name })}
                        >
                            <MAvatar tone={st ? (tone as any) : 'gray'}>{initials(w.name)}</MAvatar>
                            <span className="fat-card-main">
                                <span className="fat-card-name">{w.name}</span>
                                <span className="fat-card-role">{w.role || w.workerType}</span>
                            </span>
                            <span className="fat-card-right">
                                {isChanged && <span className="fgr-dot" title="Promijenjeno" />}
                                <span className={`fat-status ${tone}`}>{st || 'Označi'}</span>
                            </span>
                        </button>
                    );
                })}
            </div>

            <div className="fbk-foot">
                <button type="button" className="fbk-confirm" disabled={saving || changed.length === 0} onClick={confirm}>
                    {saving
                        ? 'Snimam…'
                        : changed.length === 0
                            ? 'Nema promjena'
                            : `Sačuvaj · ${changed.length} ${changed.length === 1 ? 'radnik' : 'radnika'}`}
                </button>
                <p className="fbk-foot-note">
                    Dnevnice se knjiže poslije — prisutni bez dnevnice čekaju na traci „Proknjiži".
                </p>
            </div>

            {/* Pojedinačni izbor — isti StatusSheet, samo bira nacrt (ne snima). */}
            <StatusSheet
                open={!!picker}
                workerName={picker?.name || ''}
                dateLabel={longDate(date)}
                current={picker ? draft.get(picker.workerId) : undefined}
                yesterday={picker ? yesterday.get(picker.workerId) : undefined}
                onClose={() => setPicker(null)}
                onPick={(status) => { if (picker) pick(picker.workerId, status); }}
            />
        </div>
    );
}
