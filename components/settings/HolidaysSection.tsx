'use client';

// ════════════════════════════════════════════════════════════════════
// POSTAVKE → PRAZNICI
//
// Neradni dani radionice. Zadani bh. praznici (lib/holidays.ts) važe dok vlasnik
// ne sačuva svoju listu; od tada važi tačno njegova. Praznik je neradan dan u
// roku naloga, na Platnu i u ocjeni plana (lib/planning.ts withHolidays).
// ════════════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { addHoliday, defaultHolidays, defaultYears, type Holiday } from '@/lib/holidays';
import { todayISO } from '@/lib/planning';
import { useHolidays } from './useHolidays';

interface Props {
    showMessage: (text: string, type: 'success' | 'error') => void;
}

const WD = ['nedjelja', 'ponedjeljak', 'utorak', 'srijeda', 'četvrtak', 'petak', 'subota'];
const label = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.${iso.slice(0, 4)}`;
const weekday = (iso: string) => WD[new Date(`${iso}T12:00:00Z`).getUTCDay()];

export default function HolidaysSection({ showMessage }: Props) {
    const { organization } = useAuth();
    const { list, isDefault, loaded, save } = useHolidays(organization?.Organization_ID);
    const [date, setDate] = useState('');
    const [name, setName] = useState('');
    const [busy, setBusy] = useState(false);
    const today = todayISO();

    const byYear = useMemo(() => {
        const m = new Map<string, Holiday[]>();
        list.forEach(h => m.set(h.date.slice(0, 4), [...(m.get(h.date.slice(0, 4)) || []), h]));
        return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
    }, [list]);

    async function commit(next: Holiday[], ok: string) {
        setBusy(true);
        const done = await save(next);
        setBusy(false);
        showMessage(done ? ok : 'Praznici nisu sačuvani — pokušaj ponovo.', done ? 'success' : 'error');
        return done;
    }

    async function onAdd() {
        const next = addHoliday(list, { date, name });
        if (typeof next === 'string') { showMessage(next, 'error'); return; }
        if (await commit(next, `Dodan praznik ${label(date)}.`)) { setDate(''); setName(''); }
    }

    return (
        <div className="settings-card hol">
            <div className="hol-head">
                <div>
                    <h2>Praznici</h2>
                    <p>Neradni dani cijele radionice. Rok naloga, Platno i ocjena plana ih preskaču kao nedjelju.</p>
                </div>
                {isDefault
                    ? <span className="hol-badge">Zadani bh. praznici</span>
                    : <button type="button" className="btn btn-secondary" disabled={busy}
                        onClick={() => commit(defaultHolidays(defaultYears(today)), 'Vraćeni zadani bh. praznici.')}>Vrati zadane</button>}
            </div>

            <div className="hol-add">
                <input type="date" value={date} onChange={e => setDate(e.target.value)} aria-label="Datum praznika" />
                <input type="text" value={name} placeholder="Naziv (npr. Pravoslavni Božić)" onChange={e => setName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') void onAdd(); }} aria-label="Naziv praznika" />
                <button type="button" className="btn btn-primary" disabled={busy || !date || !name.trim()} onClick={() => void onAdd()}>Dodaj</button>
            </div>

            {!loaded ? <p className="hol-empty">Učitavanje…</p> : byYear.map(([year, items]) => (
                <section key={year} className="hol-year">
                    <h3>{year}</h3>
                    <ul>
                        {items.map(h => (
                            <li key={h.date} className={h.date < today ? 'is-past' : ''}>
                                <span className="hol-date">{label(h.date)}</span>
                                <span className="hol-wd">{weekday(h.date)}</span>
                                <span className="hol-name">{h.name}{h.verify && <span className="hol-verify" title="Pomičan datum — potvrdi po kalendaru Islamske zajednice"> · provjeri datum</span>}</span>
                                <button type="button" className="hol-del" disabled={busy} aria-label={`Ukloni ${h.name}`}
                                    onClick={() => commit(list.filter(x => x.date !== h.date), `Uklonjen praznik ${label(h.date)}.`)}>
                                    <span className="material-icons-round">close</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                </section>
            ))}

            <style jsx>{`
                .hol-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 16px; }
                .hol-head h2 { margin: 0 0 4px; font-size: 18px; }
                .hol-head p { margin: 0; color: #64748b; font-size: 13px; max-width: 520px; }
                .hol-badge { background: #eef2ff; color: #3730a3; font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 999px; white-space: nowrap; }
                .hol-add { display: grid; grid-template-columns: 170px 1fr auto; gap: 8px; margin-bottom: 20px; }
                .hol-add input { padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 14px; }
                .hol-year h3 { font-size: 13px; color: #475569; margin: 16px 0 6px; letter-spacing: .04em; }
                .hol-year ul { list-style: none; margin: 0; padding: 0; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; }
                .hol-year li { display: grid; grid-template-columns: 110px 110px 1fr 32px; align-items: center; padding: 8px 12px; border-top: 1px solid #f1f5f9; font-size: 14px; }
                .hol-year li:first-child { border-top: none; }
                .hol-year li.is-past { color: #94a3b8; }
                .hol-date { font-variant-numeric: tabular-nums; font-weight: 600; }
                .hol-wd { color: #64748b; font-size: 13px; }
                .hol-verify { color: #b45309; font-size: 12px; }
                .hol-del { border: none; background: none; color: #94a3b8; cursor: pointer; display: grid; place-items: center; }
                .hol-del:hover { color: #dc2626; }
                .hol-empty { color: #64748b; }
                @media (max-width: 640px) {
                    .hol-head { flex-direction: column; }
                    .hol-add { grid-template-columns: 1fr; }
                    .hol-year li { grid-template-columns: 90px 1fr 32px; }
                    .hol-wd { display: none; }
                }
            `}</style>
        </div>
    );
}
