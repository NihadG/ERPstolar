'use client';

import { useState, useMemo } from 'react';
import Modal from './Modal';
import { Loader2, Users, CalendarRange, Boxes, History } from 'lucide-react';
import { bulkBookWorkOrderLabor } from '@/lib/services';
import type { WorkOrder, Worker } from '@/lib/types';

interface BulkBookingModalProps {
    isOpen: boolean;
    onClose: () => void;
    workOrder: WorkOrder;
    workers: Worker[];
    organizationId: string;
    onDone: (...collections: string[]) => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

const toISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const km = (n: number) => Math.round(n).toLocaleString('bs-BA') + ' KM';

export default function BulkBookingModal({ isOpen, onClose, workOrder, workers, organizationId, onDone, showToast }: BulkBookingModalProps) {
    const items = (workOrder.items || []).filter(i => i.Status !== 'Završeno');

    // Predizabrani radnici = oni dodijeljeni na nalog
    const assignedIds = useMemo(() => {
        const s = new Set<string>();
        (workOrder.items || []).forEach(it => {
            (it.Assigned_Workers || []).forEach(w => w.Worker_ID && s.add(w.Worker_ID));
            (it.Processes || []).forEach(p => { if (p.Worker_ID) s.add(p.Worker_ID); });
        });
        return s;
    }, [workOrder]);

    const [selWorkers, setSelWorkers] = useState<Set<string>>(new Set(assignedIds));
    const [selItems, setSelItems] = useState<Set<string>>(new Set(items.map(i => i.ID)));
    const [dateFrom, setDateFrom] = useState<string>(workOrder.Started_At ? workOrder.Started_At.split('T')[0] : toISO(new Date()));
    const [dateTo, setDateTo] = useState<string>(toISO(new Date()));
    const [skipWeekends, setSkipWeekends] = useState(true);
    const [saving, setSaving] = useState(false);

    const activeWorkers = workers.filter(w => w.Status === 'Aktivan' || w.Status === 'Dostupan' || !w.Status);

    const workdays = useMemo(() => {
        if (!dateFrom || !dateTo) return 0;
        const start = new Date(dateFrom + 'T00:00:00');
        const end = new Date(dateTo + 'T00:00:00');
        if (start > end) return 0;
        let n = 0;
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const dow = d.getDay();
            if (skipWeekends && (dow === 0 || dow === 6)) continue;
            n++;
        }
        return n;
    }, [dateFrom, dateTo, skipWeekends]);

    const estCost = useMemo(() => {
        let perDay = 0;
        selWorkers.forEach(id => { perDay += (workers.find(w => w.Worker_ID === id)?.Daily_Rate || 0); });
        return perDay * workdays;
    }, [selWorkers, workdays, workers]);

    const toggle = (set: Set<string>, setter: (s: Set<string>) => void, id: string) => {
        const next = new Set(set);
        next.has(id) ? next.delete(id) : next.add(id);
        setter(next);
    };

    const canApply = selWorkers.size > 0 && selItems.size > 0 && workdays > 0;

    const handleApply = async () => {
        if (!canApply || saving) return;
        setSaving(true);
        try {
            const res = await bulkBookWorkOrderLabor(
                workOrder.Work_Order_ID,
                Array.from(selWorkers),
                Array.from(selItems),
                dateFrom, dateTo, skipWeekends, organizationId
            );
            if (res.success) {
                showToast(`${res.message} · ~${km(estCost)} rada`, 'success');
                onDone('workOrders', 'projects', 'workLogs');
                onClose();
            } else {
                showToast(res.message, 'error');
            }
        } catch (e) {
            console.error(e); showToast('Greška pri brzom unosu', 'error');
        } finally { setSaving(false); }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Brzi unos rada (retrospektivno)" size="large" footer={null}>
            <div className="bbm">
                <p className="bbm-intro">
                    Za zaboravljene naloge: dnevnica svakog izabranog radnika se po danu <b>ravnomjerno podijeli</b> na
                    izabrane proizvode. Poštuje <b>šihtaricu</b> — dani kad je radnik označen odsutnim (odmor, bolovanje,
                    vikend…) se preskaču. Dani gdje već postoji unos se također preskaču. Pojedinosti po proizvodu kasnije
                    fino podesiš u "Detalji rada".
                </p>

                <div className="bbm-grid">
                    <label className="bbm-field">
                        <span><CalendarRange size={14} /> Od</span>
                        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
                    </label>
                    <label className="bbm-field">
                        <span><CalendarRange size={14} /> Do</span>
                        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
                    </label>
                    <label className="bbm-check">
                        <input type="checkbox" checked={skipWeekends} onChange={e => setSkipWeekends(e.target.checked)} />
                        Preskoči vikende
                    </label>
                </div>

                <div className="bbm-section">
                    <div className="bbm-label"><Users size={14} /> Radnici koji su radili</div>
                    <div className="bbm-chips">
                        {activeWorkers.map(w => (
                            <button key={w.Worker_ID}
                                className={`bbm-chip ${selWorkers.has(w.Worker_ID) ? 'on' : ''}`}
                                onClick={() => toggle(selWorkers, setSelWorkers, w.Worker_ID)}>
                                {w.Name} <span className="bbm-rate">{w.Daily_Rate || 0}</span>
                            </button>
                        ))}
                    </div>
                </div>

                <div className="bbm-section">
                    <div className="bbm-label">
                        <Boxes size={14} /> Proizvodi ({selItems.size}/{items.length})
                        <button className="bbm-mini" onClick={() => setSelItems(new Set(selItems.size === items.length ? [] : items.map(i => i.ID)))}>
                            {selItems.size === items.length ? 'Poništi sve' : 'Izaberi sve'}
                        </button>
                    </div>
                    <div className="bbm-items">
                        {items.map(it => (
                            <label key={it.ID} className={`bbm-item ${selItems.has(it.ID) ? 'on' : ''}`}>
                                <input type="checkbox" checked={selItems.has(it.ID)} onChange={() => toggle(selItems, setSelItems, it.ID)} />
                                {it.Product_Name}
                            </label>
                        ))}
                    </div>
                </div>

                <div className="bbm-estimate">
                    <History size={15} />
                    <span>
                        {workdays} radn{workdays === 1 ? 'i dan' : 'a dana'} × {selWorkers.size} radnik(a) →
                        do <b>~{km(estCost)}</b> rada, ravnomjerno na {selItems.size} proizvod(a)
                        <span style={{ color: 'var(--text-tertiary)' }}> (umanjeno za odsutne dane)</span>
                    </span>
                </div>

                <div className="bbm-footer">
                    <button className="bbm-btn" onClick={onClose} disabled={saving}>Odustani</button>
                    <button className="bbm-btn bbm-btn-primary" onClick={handleApply} disabled={!canApply || saving}>
                        {saving ? <Loader2 size={15} className="bbm-spin" /> : <History size={15} />} Unesi rad
                    </button>
                </div>
            </div>

            <style jsx>{`
                .bbm { display: flex; flex-direction: column; gap: 16px; padding: 4px 2px; }
                .bbm-intro { font-size: 13px; color: var(--text-secondary); line-height: 1.6; margin: 0; }
                .bbm-grid { display: flex; gap: 16px; flex-wrap: wrap; align-items: flex-end; }
                .bbm-field { display: flex; flex-direction: column; gap: 5px; }
                .bbm-field > span { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 600; color: var(--text-secondary); }
                .bbm-field input { height: 38px; border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 0 10px; font-size: 14px; color: var(--text-primary); background: var(--background); }
                .bbm-check { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; color: var(--text-primary); height: 38px; }
                .bbm-section { display: flex; flex-direction: column; gap: 8px; }
                .bbm-label { display: flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-secondary); }
                .bbm-mini { margin-left: auto; font-size: 11px; font-weight: 600; text-transform: none; letter-spacing: 0; color: var(--accent); background: none; border: none; cursor: pointer; }
                .bbm-chips { display: flex; flex-wrap: wrap; gap: 8px; }
                .bbm-chip { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--border); background: var(--background); color: var(--text-primary); font-size: 13px; font-weight: 600; padding: 7px 12px; border-radius: 999px; cursor: pointer; }
                .bbm-chip.on { background: var(--accent); border-color: var(--accent); color: #fff; }
                .bbm-rate { font-size: 11px; opacity: 0.75; }
                .bbm-items { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 6px; }
                .bbm-item { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-primary); padding: 7px 10px; border: 1px solid var(--border-light); border-radius: var(--radius-sm); cursor: pointer; }
                .bbm-item.on { border-color: var(--accent); background: var(--accent-light); }
                .bbm-estimate { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-secondary); background: var(--surface); padding: 12px 14px; border-radius: var(--radius-md); }
                .bbm-estimate b { color: var(--text-primary); }
                .bbm-footer { display: flex; justify-content: flex-end; gap: 10px; padding-top: 12px; border-top: 1px solid var(--border-light); }
                .bbm-btn { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--border); background: var(--background); color: var(--text-primary); font-size: 13px; font-weight: 600; padding: 10px 18px; border-radius: var(--radius-sm); cursor: pointer; }
                .bbm-btn:hover:not(:disabled) { background: var(--surface-hover); }
                .bbm-btn:disabled { opacity: 0.5; cursor: not-allowed; }
                .bbm-btn-primary { background: var(--accent); border-color: var(--accent); color: #fff; }
                .bbm-btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
                .bbm-spin { animation: bbm-spin 0.8s linear infinite; }
                @keyframes bbm-spin { to { transform: rotate(360deg); } }
            `}</style>
        </Modal>
    );
}
