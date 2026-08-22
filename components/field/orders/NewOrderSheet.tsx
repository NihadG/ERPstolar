'use client';

// ════════════════════════════════════════════════════════════════════
// NOVI NALOG — „Razni poslovi" s telefona
//
// Desktop ovo radi kroz `CustomTasksModal`: poslovi, radnici PO POSLU, veza s
// proizvodom, projekat, vrijednost, materijal, ostali troškovi. Na telefonu se
// to ne prepisuje — od tog obrasca ostaje samo ono što pogon zna u trenutku
// kad posao nastane:
//
//   naziv naloga → poslovi → ekipa → rok
//
// Dvije namjerne razlike:
//  • EKIPA JE ZAJEDNIČKA za sve poslove u nalogu. Po posao pojedinačno bira se
//    na desktopu; u pogonu isti ljudi rade cijeli nalog, a per-red izbor bi
//    značio jedan izbornik po poslu na ekranu širokom 375px.
//  • NEMA NOVCA. Vrijednost, materijal i ostali troškovi upisuje vlasnik —
//    isti razlog zbog kojeg pogonske projekcije ne nose iznose.
// ════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/apiClient';
import type { FieldWorkerRow } from '@/lib/field/fieldAttendance';
import { MSheet } from '@/components/tabs/mobile/MobileUI';

interface CreatedOrder {
    workOrderId: string;
    workOrderNumber: string;
    name: string;
}

interface Props {
    open: boolean;
    /** Radnik zbog kojeg se nalog otvara — predčekiran u ekipi. */
    seedWorker?: { workerId: string; workerName: string };
    onClose: () => void;
    onCreated: (order: CreatedOrder) => void;
    showToast?: (message: string, type: 'success' | 'error' | 'info') => void;
}

const uid = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `t-${Date.now()}-${Math.random()}`);

const initials = (name: string) =>
    name.split(' ').filter(Boolean).map(p => p[0]).join('').toUpperCase().slice(0, 2) || '?';

export default function NewOrderSheet({ open, seedWorker, onClose, onCreated, showToast }: Props) {
    const [rows, setRows] = useState<{ id: string; text: string }[]>([{ id: uid(), text: '' }]);
    const [name, setName] = useState('');
    const [due, setDue] = useState('');
    const [crew, setCrew] = useState<Set<string>>(new Set());
    const [workers, setWorkers] = useState<FieldWorkerRow[]>([]);
    const [search, setSearch] = useState('');
    const [saving, setSaving] = useState(false);

    // Sheet ostaje montiran između otvaranja (roditelj pali `open`), pa se
    // stanje sije iznova na SVAKO otvaranje — isto pravilo kao CustomTasksModal.
    useEffect(() => {
        if (!open) return;
        setRows([{ id: uid(), text: '' }]);
        setName('');
        setDue('');
        setSearch('');
        setCrew(new Set(seedWorker ? [seedWorker.workerId] : []));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    useEffect(() => {
        if (!open || workers.length > 0) return;
        apiGet<{ workers: FieldWorkerRow[] }>('/api/field/workers')
            .then(res => setWorkers(res.workers || []))
            .catch(() => showToast?.('Lista radnika nije učitana', 'error'));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const validRows = useMemo(() => rows.filter(r => r.text.trim().length > 0), [rows]);

    const shownWorkers = useMemo(() => {
        const q = search.trim().toLowerCase();
        const list = q ? workers.filter(w => w.name.toLowerCase().includes(q)) : workers;
        // Izabrani uvijek ostaju vidljivi — inače „nestanu" čim se kucne pretraga.
        return [...list].sort((a, b) => {
            const sa = crew.has(a.workerId) ? 0 : 1;
            const sb = crew.has(b.workerId) ? 0 : 1;
            return sa - sb || a.name.localeCompare(b.name, 'bs');
        });
    }, [workers, search, crew]);

    const toggleWorker = (id: string) => setCrew(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });

    const submit = async () => {
        if (saving || validRows.length === 0) return;
        setSaving(true);
        try {
            const workerIds = Array.from(crew);
            const created = await apiPost<CreatedOrder>('/api/field/work-orders', {
                name: name.trim(),
                dueDate: due || undefined,
                tasks: validRows.map(r => ({ text: r.text.trim(), workerIds })),
            });
            showToast?.(`Nalog „${created.name}" otvoren`, 'success');
            onCreated(created);
        } catch (e: any) {
            showToast?.(e?.message || 'Nalog nije otvoren', 'error');
        } finally {
            setSaving(false);
        }
    };

    return (
        <MSheet open={open} title="Novi nalog — razni poslovi" onClose={onClose}>
            <p className="fat-sheet-sub">
                Za posao koji nije proizvod iz baze: isporuka, popravka kod kupca, čišćenje pogona.
            </p>

            <div className="fno-field">
                <label htmlFor="fno-name">Naziv naloga</label>
                <input
                    id="fno-name"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder={validRows[0]?.text.trim() || 'npr. Isporuka i montaža — Dino'}
                />
            </div>

            <div className="mui-shd"><span>Poslovi</span></div>
            <div className="fno-rows">
                {rows.map((r, i) => (
                    <div key={r.id} className="fno-row">
                        <span className="fno-num">{i + 1}</span>
                        <input
                            value={r.text}
                            onChange={e => setRows(prev => prev.map(x => x.id === r.id ? { ...x, text: e.target.value } : x))}
                            placeholder="npr. Utovar i prevoz"
                        />
                        {rows.length > 1 && (
                            <button type="button" className="fno-x" aria-label="Ukloni posao"
                                onClick={() => setRows(prev => prev.filter(x => x.id !== r.id))}>
                                <X size={16} />
                            </button>
                        )}
                    </div>
                ))}
            </div>
            <button type="button" className="fbk-more" onClick={() => setRows(prev => [...prev, { id: uid(), text: '' }])}>
                <Plus size={16} /> Dodaj posao
            </button>

            <div className="mui-shd">
                <span>Ekipa</span>
                <span className="mui-dim">{crew.size} izabrano</span>
            </div>
            {workers.length > 8 && (
                <label className="fbk-find">
                    <input
                        type="text"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Traži radnika…"
                    />
                </label>
            )}
            <div className="fno-crew">
                {shownWorkers.map(w => (
                    <button
                        key={w.workerId}
                        type="button"
                        className={`fno-worker${crew.has(w.workerId) ? ' on' : ''}`}
                        onClick={() => toggleWorker(w.workerId)}
                    >
                        <span className="fno-ava">{initials(w.name)}</span>
                        {w.name}
                    </button>
                ))}
            </div>
            {crew.size === 0 && (
                <p className="fbk-none">Bez ekipe se nalog može otvoriti, ali ga knjiženje neće pokrenuti.</p>
            )}

            <div className="fno-field">
                <label htmlFor="fno-due">Rok <em>opciono</em></label>
                <input id="fno-due" type="date" value={due} onChange={e => setDue(e.target.value)} />
            </div>

            <div className="fod-confirm-wrap">
                <button type="button" className="fbk-confirm" disabled={saving || validRows.length === 0} onClick={submit}>
                    {saving ? 'Otvaram…' : 'Otvori nalog'}
                </button>
            </div>
        </MSheet>
    );
}
