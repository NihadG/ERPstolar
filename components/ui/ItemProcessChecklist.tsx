'use client';

import { useState } from 'react';
import { Check, ChevronDown, ChevronRight, Play, Clock, User } from 'lucide-react';
import type { ItemProcessStatus, Worker } from '@/lib/types';
import { updateItemProcess } from '@/lib/services';

interface Props {
    workOrderId: string;
    itemId: string;
    processes: ItemProcessStatus[];
    workers: Worker[];
    onChanged?: () => void;
    showToast?: (message: string, type: 'success' | 'error' | 'info') => void;
}

/**
 * Checklist procesa jedne stavke naloga: označi proces završenim (uz radnika, datum, pomoćnike).
 * Čisto napredak + audit (ko/kad) — NE dira dnevnice (one idu kroz šihtaricu). Vidi updateItemProcess.
 */
export default function ItemProcessChecklist({ workOrderId, itemId, processes, workers, onChanged, showToast }: Props) {
    const today = new Date().toISOString().split('T')[0];
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [completing, setCompleting] = useState<string | null>(null);
    const [cform, setCform] = useState<{ workerId: string; date: string; helperIds: string[] }>({ workerId: '', date: today, helperIds: [] });

    if (!processes || processes.length === 0) return null;

    const doneCount = processes.filter(p => p.Status === 'Završeno').length;

    const apply = async (processName: string, updates: Partial<ItemProcessStatus>) => {
        setBusy(true);
        try {
            await updateItemProcess(workOrderId, itemId, processName, updates);
            onChanged?.();
        } catch (e) {
            console.error('updateItemProcess failed', e);
            showToast?.('Greška pri ažuriranju procesa', 'error');
        } finally {
            setBusy(false);
        }
    };

    const startComplete = (p: ItemProcessStatus) => {
        setCform({
            workerId: p.Worker_ID || '',
            date: p.Completed_At ? p.Completed_At.split('T')[0] : today,
            helperIds: (p.Helpers || []).map(h => h.Worker_ID),
        });
        setCompleting(p.Process_Name);
    };

    const confirmComplete = async (p: ItemProcessStatus) => {
        const worker = workers.find(w => w.Worker_ID === cform.workerId);
        const helpers = cform.helperIds
            .filter(id => id && id !== cform.workerId)
            .map(id => ({ Worker_ID: id, Worker_Name: workers.find(x => x.Worker_ID === id)?.Name || '' }));
        setCompleting(null);
        await apply(p.Process_Name, {
            Status: 'Završeno',
            Completed_At: new Date(cform.date + 'T12:00:00').toISOString(),
            Worker_ID: worker?.Worker_ID,
            Worker_Name: worker?.Name,
            Helpers: helpers,
        });
    };

    const toggleDone = (p: ItemProcessStatus) => {
        if (p.Status === 'Završeno') apply(p.Process_Name, { Status: 'U toku', Completed_At: '' });
        else startComplete(p);
    };

    const toggleStart = (p: ItemProcessStatus) => {
        if (p.Status === 'U toku') apply(p.Process_Name, { Status: 'Na čekanju' });
        else apply(p.Process_Name, { Status: 'U toku', Started_At: new Date().toISOString() });
    };

    return (
        <div className="ipc">
            <button className="ipc-toggle" onClick={() => setOpen(o => !o)}>
                {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                Procesi <span className="ipc-count">{doneCount}/{processes.length}</span>
            </button>

            {open && (
                <div className="ipc-list">
                    {processes.map((p, idx) => {
                        const isDone = p.Status === 'Završeno';
                        const isActive = p.Status === 'U toku';
                        const isCompleting = completing === p.Process_Name;
                        const cDate = p.Completed_At ? new Date(p.Completed_At).toLocaleDateString('hr-HR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '';
                        return (
                            <div key={p.Process_Name} className="ipc-wrap">
                                <div className={`ipc-row ${isDone ? 'done' : ''}`}>
                                    <label className="ipc-check" title={isDone ? 'Završeno — odznači za vraćanje' : 'Označi kao završeno'}>
                                        <input type="checkbox" checked={isDone} disabled={busy} onChange={() => toggleDone(p)} />
                                    </label>
                                    <span className="ipc-ord">{idx + 1}</span>
                                    <span className="ipc-name">{p.Process_Name}</span>

                                    {isDone ? (
                                        <span className="ipc-done" title={`Završio: ${p.Worker_Name || '—'}${cDate ? ' · ' + cDate : ''}`}>
                                            <Check size={12} />
                                            <span>{p.Worker_Name ? p.Worker_Name.split(' ')[0] : '—'}</span>
                                            {cDate && <em>{cDate}</em>}
                                            {p.Helpers && p.Helpers.length > 0 && <b>+{p.Helpers.length}</b>}
                                        </span>
                                    ) : (
                                        <button className={`ipc-status ${isActive ? 'active' : ''}`} disabled={busy} onClick={() => toggleStart(p)} title="Pokreni / zaustavi">
                                            {isActive ? <Play size={12} /> : <Clock size={12} />}
                                            {isActive ? 'U toku' : 'Čeka'}
                                        </button>
                                    )}
                                </div>

                                {isCompleting && (
                                    <div className="ipc-form">
                                        <div className="ipc-fgrid">
                                            <label className="ipc-field">
                                                <span>Radnik</span>
                                                <select value={cform.workerId} onChange={e => setCform(f => ({ ...f, workerId: e.target.value }))}>
                                                    <option value="">— izaberi —</option>
                                                    {workers.map(w => <option key={w.Worker_ID} value={w.Worker_ID}>{w.Name}</option>)}
                                                </select>
                                            </label>
                                            <label className="ipc-field">
                                                <span>Datum</span>
                                                <input type="date" value={cform.date} max={today} onChange={e => setCform(f => ({ ...f, date: e.target.value }))} />
                                            </label>
                                        </div>
                                        <div className="ipc-field">
                                            <span>Pomoćnici (opcionalno)</span>
                                            <div className="ipc-helpers">
                                                {cform.helperIds.map(id => (
                                                    <span key={id} className="ipc-chip">
                                                        <User size={11} />{workers.find(x => x.Worker_ID === id)?.Name?.split(' ')[0] || 'Radnik'}
                                                        <button onClick={() => setCform(f => ({ ...f, helperIds: f.helperIds.filter(h => h !== id) }))}>×</button>
                                                    </span>
                                                ))}
                                                <select value="" onChange={e => {
                                                    const id = e.target.value;
                                                    if (id && !cform.helperIds.includes(id)) setCform(f => ({ ...f, helperIds: [...f.helperIds, id] }));
                                                }}>
                                                    <option value="">+ pomoćnik</option>
                                                    {workers.filter(w => w.Worker_ID !== cform.workerId && !cform.helperIds.includes(w.Worker_ID)).map(w => <option key={w.Worker_ID} value={w.Worker_ID}>{w.Name}</option>)}
                                                </select>
                                            </div>
                                        </div>
                                        <div className="ipc-actions">
                                            <button className="ipc-cancel" onClick={() => setCompleting(null)}>Otkaži</button>
                                            <button className="ipc-confirm" disabled={!cform.workerId || busy} onClick={() => confirmComplete(p)}>Završi proces</button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            <style jsx>{`
                .ipc { border-top: 1px solid #f1f5f9; padding-top: 8px; }
                .ipc-toggle { display: inline-flex; align-items: center; gap: 5px; background: none; border: none; cursor: pointer; font-size: 12px; font-weight: 600; color: #475569; padding: 2px 0; }
                .ipc-count { background: #f1f5f9; color: #64748b; border-radius: 8px; padding: 1px 7px; font-size: 11px; }
                .ipc-list { display: flex; flex-direction: column; gap: 5px; margin-top: 8px; }
                .ipc-wrap { display: flex; flex-direction: column; }
                .ipc-row { display: flex; align-items: center; gap: 9px; padding: 7px 9px; background: #f8fafc; border-radius: 8px; }
                .ipc-row.done { background: #f0fdf4; }
                .ipc-check { display: inline-flex; cursor: pointer; }
                .ipc-check input { width: 17px; height: 17px; accent-color: #16a34a; cursor: pointer; margin: 0; }
                .ipc-ord { width: 18px; height: 18px; background: #e2e8f0; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; color: #64748b; flex-shrink: 0; }
                .ipc-name { flex: 1; font-size: 13px; font-weight: 500; color: #334155; }
                .ipc-status { display: inline-flex; align-items: center; gap: 4px; padding: 3px 9px; border-radius: 10px; font-size: 11px; font-weight: 600; border: 1px solid #e2e8f0; background: #f1f5f9; color: #64748b; cursor: pointer; }
                .ipc-status.active { background: #dbeafe; color: #1d4ed8; border-color: #93c5fd; }
                .ipc-done { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 600; color: #15803d; background: #dcfce7; border: 1px solid #86efac; border-radius: 10px; padding: 3px 9px; }
                .ipc-done em { font-style: normal; color: #166534; font-weight: 500; }
                .ipc-done b { background: #bbf7d0; color: #166534; border-radius: 6px; padding: 0 5px; }
                .ipc-form { margin: 2px 0 6px 26px; padding: 11px; background: #fff; border: 1px solid #e2e8f0; border-radius: 9px; display: flex; flex-direction: column; gap: 9px; }
                .ipc-fgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; }
                .ipc-field { display: flex; flex-direction: column; gap: 4px; }
                .ipc-field > span { font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.03em; }
                .ipc-field select, .ipc-field input { padding: 7px 9px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 13px; color: #0f172a; background: #fff; }
                .ipc-field select:focus, .ipc-field input:focus { outline: none; border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,0.12); }
                .ipc-helpers { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
                .ipc-chip { display: inline-flex; align-items: center; gap: 4px; background: #e0f2fe; color: #0369a1; border-radius: 8px; padding: 3px 8px; font-size: 12px; font-weight: 600; }
                .ipc-chip button { border: none; background: none; color: #0369a1; cursor: pointer; font-size: 14px; line-height: 1; padding: 0; }
                .ipc-helpers select { padding: 5px 8px; border: 1px dashed #cbd5e1; border-radius: 8px; font-size: 12px; color: #64748b; background: #fff; cursor: pointer; }
                .ipc-actions { display: flex; justify-content: flex-end; gap: 8px; }
                .ipc-cancel { padding: 6px 13px; border: 1px solid #e2e8f0; background: #fff; color: #475569; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; }
                .ipc-confirm { padding: 6px 13px; border: none; background: #16a34a; color: #fff; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; }
                .ipc-confirm:disabled { opacity: 0.5; cursor: not-allowed; }
            `}</style>
        </div>
    );
}
