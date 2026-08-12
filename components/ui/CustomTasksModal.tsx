'use client';

import { useState, useMemo, useEffect } from 'react';
import { Plus, X, Loader2, ClipboardList, AlertTriangle, Info, Wrench, Coins, Calendar } from 'lucide-react';
import Modal from './Modal';
import { SearchableSelect } from './SearchableSelect';
import TaskAttachEditor from './TaskAttachEditor';
import { createWorkOrder } from '@/lib/services';
import { emptyTaskSelection, taskSelectionCount, type TaskAttachSelection } from '@/lib/workOrderTasks';
import type { WorkOrder, Worker, Task, Project } from '@/lib/types';

interface CustomTasksModalProps {
    isOpen: boolean;
    onClose: () => void;
    workOrders: WorkOrder[];
    workers: Worker[];
    /** Projekti — za opciono vezivanje raznog naloga (profit ide u „Razni nalozi" tog projekta). */
    projects?: Project[];
    /** Svi zadaci organizacije — za „Poveži postojeći" na ovom nalogu. */
    tasks?: Task[];
    organizationId: string;
    onCreated: (...collections: string[]) => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
    zIndex?: number;               // for stacking on top of another open modal
    initialWorkerId?: string;      // pre-select a worker on the first task row when opened
    /** Pred-popuni prvi red iz plan-bloka na Platnu (naziv/radnici/projekt/rok). */
    initialSeed?: { text?: string; workerIds?: string[]; projectId?: string; dueDate?: string };
    onOrderCreated?: (workOrderId: string, workOrderNumber: string) => void; // fired on success, in addition to onCreated
}

interface TaskRow {
    id: string;
    text: string;
    workerIds: string[];     // više radnika po zadatku (prvi = glavni, ostali = pomoćnici)
    linkedItemId?: string;  // WorkOrderItem ID of a real product (optional)
}

const uid = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random()}`);

export default function CustomTasksModal({ isOpen, onClose, workOrders, workers, projects = [], tasks = [], organizationId, onCreated, showToast, zIndex, initialWorkerId, initialSeed, onOrderCreated }: CustomTasksModalProps) {
    const [rows, setRows] = useState<TaskRow[]>([{ id: uid(), text: '', workerIds: initialWorkerId ? [initialWorkerId] : [] }]);
    const [notes, setNotes] = useState('');
    const [dueDate, setDueDate] = useState('');
    const [saving, setSaving] = useState(false);
    // Finansije raznog naloga (za profit) — opciono. Vrijednost iz ponude, materijal, ostali troškovi.
    const [projectId, setProjectId] = useState('');
    const [offerValue, setOfferValue] = useState('');
    const [materialCost, setMaterialCost] = useState('');
    const [otherCosts, setOtherCosts] = useState('');
    // Zadaci iz taba Zadaci (evidencija/praćenje) — ODVOJENO od poslova gore,
    // koji su stavke naloga i nose trošak rada. Vidi .ctm-note ispod.
    const [taskSelection, setTaskSelection] = useState<TaskAttachSelection>(emptyTaskSelection);

    // Component may stay mounted across opens (parent toggles `isOpen`), so
    // re-seed a clean, pre-filled state every time it actually opens.
    useEffect(() => {
        if (isOpen) {
            // Seed s Platna ima prednost nad initialWorkerId; oba su opciona.
            const seedWorkers = initialSeed?.workerIds?.length
                ? initialSeed.workerIds
                : (initialWorkerId ? [initialWorkerId] : []);
            setRows([{ id: uid(), text: initialSeed?.text || '', workerIds: seedWorkers }]);
            setNotes('');
            setDueDate(initialSeed?.dueDate || '');
            setTaskSelection(emptyTaskSelection());
            setProjectId(initialSeed?.projectId || ''); setOfferValue(''); setMaterialCost(''); setOtherCosts('');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    const workerOptions = useMemo(
        () => workers.map(w => ({ value: w.Worker_ID, label: w.Name, subLabel: `${w.Worker_Type} · ${w.Daily_Rate || 0} KM` })),
        [workers]
    );
    const workerLookup = useMemo(() => {
        const m = new Map<string, Worker>();
        workers.forEach(w => m.set(w.Worker_ID, w));
        return m;
    }, [workers]);

    const projectOptions = useMemo(
        () => projects
            .filter(p => !p.Hidden)
            .map(p => ({ value: p.Project_ID, label: p.Name?.trim() || p.Client_Name, subLabel: p.Client_Name }))
            .sort((a, b) => a.label.localeCompare(b.label, 'hr')),
        [projects]
    );
    const selectedProject = useMemo(() => projects.find(p => p.Project_ID === projectId), [projects, projectId]);

    // Real products (across all work orders, including finished) — for optional linking
    const linkOptions = useMemo(() => {
        const opts: { value: string; label: string; subLabel: string; productId: string; productName: string }[] = [];
        workOrders.forEach(wo => {
            (wo.items || []).forEach(it => {
                if (it.Item_Type === 'custom') return;
                opts.push({
                    value: it.ID,
                    label: it.Product_Name,
                    subLabel: `${it.Project_Name || ''} · Nalog ${wo.Work_Order_Number}${wo.Status === 'Završeno' ? ' (završen)' : ''}`,
                    productId: it.Product_ID,
                    productName: it.Product_Name,
                });
            });
        });
        return opts;
    }, [workOrders]);
    const linkLookup = useMemo(() => {
        const m = new Map<string, { productId: string; productName: string }>();
        linkOptions.forEach(o => m.set(o.value, { productId: o.productId, productName: o.productName }));
        return m;
    }, [linkOptions]);

    const addRow = () => setRows(prev => [...prev, { id: uid(), text: '', workerIds: [] }]);
    const removeRow = (id: string) => setRows(prev => prev.filter(r => r.id !== id));
    const updateRow = (id: string, patch: Partial<TaskRow>) => setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
    const addWorker = (id: string, workerId: string) => setRows(prev => prev.map(r =>
        r.id === id && workerId && !r.workerIds.includes(workerId) ? { ...r, workerIds: [...r.workerIds, workerId] } : r
    ));
    const removeWorker = (id: string, workerId: string) => setRows(prev => prev.map(r =>
        r.id === id ? { ...r, workerIds: r.workerIds.filter(w => w !== workerId) } : r
    ));

    const validRows = rows.filter(r => r.text.trim().length > 0);
    const hasAnyWorker = validRows.some(r => r.workerIds.length > 0);
    const reset = () => { setRows([{ id: uid(), text: '', workerIds: [] }]); setNotes(''); setDueDate(''); setTaskSelection(emptyTaskSelection()); setProjectId(''); setOfferValue(''); setMaterialCost(''); setOtherCosts(''); };

    const handleCreate = async () => {
        if (!organizationId || saving) return;
        if (validRows.length === 0) { showToast('Dodaj barem jedan zadatak', 'error'); return; }
        setSaving(true);
        try {
            // Finansije se upisuju SAMO na prvu custom stavku (order-level jedan set);
            // ostale nose 0. Razni nalozi se u profitu konsoliduju u jedan red, pa je
            // zbir tačan. Vrijednost/materijal/ostalo su brojevi (prazno = 0).
            const num = (s: string) => { const n = parseFloat(s.replace(',', '.')); return isFinite(n) && n > 0 ? n : 0; };
            const fin = { value: num(offerValue), material: num(materialCost), other: num(otherCosts) };
            const projName = selectedProject ? (selectedProject.Name?.trim() || selectedProject.Client_Name) : 'Razni poslovi';

            const items = validRows.map((r, idx) => {
                const link = r.linkedItemId ? linkLookup.get(r.linkedItemId) : undefined;
                const chosen = r.workerIds.map(id => workerLookup.get(id)).filter((w): w is Worker => !!w);
                const [main, ...helpers] = chosen;
                const isFirst = idx === 0;
                return {
                    Product_ID: `custom-${uid()}`,
                    Product_Name: r.text.trim(),
                    Project_ID: projectId || '',
                    Project_Name: projName,
                    Quantity: 1,
                    Item_Type: 'custom' as const,
                    // Vrijednost/materijal/ostalo idu na PRVU stavku (samo ako je unesen projekat
                    // ili neka vrijednost — inače nalog ostaje čisto radni bez prihoda).
                    ...(isFirst ? {
                        Product_Value: fin.value,
                        Material_Cost: fin.material,
                        Other_Costs: fin.other,
                    } : {}),
                    // Implicitni proces "Rad": prvi radnik = glavni, ostali = pomoćnici. Svi u
                    // Assigned_Workers (izvor za auto-knjiženje iz šihtarice za SVAKOG radnika).
                    ...(chosen.length > 0 ? {
                        Processes: [{
                            Process_Name: 'Rad', Status: 'Na čekanju',
                            Worker_ID: main.Worker_ID, Worker_Name: main.Name,
                            ...(helpers.length > 0 ? { Helpers: helpers.map(h => ({ Worker_ID: h.Worker_ID, Worker_Name: h.Name })) } : {}),
                        }],
                        Assigned_Workers: chosen.map(w => ({ Worker_ID: w.Worker_ID, Worker_Name: w.Name, Daily_Rate: w.Daily_Rate || 0 })),
                    } : {}),
                    ...(r.linkedItemId && link ? {
                        Linked_Item_ID: r.linkedItemId,
                        Linked_Product_ID: link.productId,
                        Linked_Product_Name: link.productName,
                    } : {}),
                };
            });

            const res = await createWorkOrder({
                Work_Order_Type: 'Zadaci',
                Production_Steps: [],
                Due_Date: dueDate || undefined,
                Notes: notes || undefined,
                items,
            }, organizationId);

            if (res.success) {
                showToast(`Nalog "Razni poslovi" kreiran (${items.length} ${items.length === 1 ? 'posao' : 'poslova'})`, 'success');

                // Zadaci iz taba Zadaci — vežu se tek sada (nalog postoji). Greška
                // ne ruši nalog: mogu se dodati i kasnije na kartici.
                let tasksAttached = false;
                if (taskSelectionCount(taskSelection) > 0 && res.data?.Work_Order_ID) {
                    try {
                        const { attachTasksToWorkOrder } = await import('@/lib/services');
                        const r = await attachTasksToWorkOrder(
                            taskSelection,
                            { Work_Order_ID: res.data.Work_Order_ID, displayName: notes.trim() || res.data.Work_Order_Number },
                            [],   // „Razni poslovi" nemaju proizvode iz baze — veza ide na nalog
                            organizationId
                        );
                        if (r.success) tasksAttached = true;
                        else showToast(r.message, 'error');
                    } catch (e) {
                        console.error('attach tasks to custom work order failed', e);
                        showToast('Nalog kreiran, ali zadaci nisu vezani — dodaj ih na kartici naloga', 'error');
                    }
                }

                onCreated(...(tasksAttached ? ['workOrders', 'tasks'] : ['workOrders']));
                if (res.data) onOrderCreated?.(res.data.Work_Order_ID, res.data.Work_Order_Number);
                reset();
                onClose();
            } else {
                showToast(res.message || 'Greška pri kreiranju', 'error');
            }
        } catch (err) {
            console.error('CustomTasksModal create error', err);
            showToast('Greška pri kreiranju naloga', 'error');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Razni poslovi — nalog bez proizvoda" size="large" footer={null} zIndex={zIndex}>
            <div className="ctm">
                <div className="ctm-intro">
                    <Info size={16} />
                    <span>
                        Poslovi koji nisu proizvodi iz baze (izrada paleta, čišćenje pogona…). Dodijeli jednog ili
                        više radnika da nalog možeš pokrenuti, a posao možeš povezati s bilo kojim proizvodom (i
                        završenim) — tada se sav rad na tom poslu uračuna u trošak tog proizvoda.
                    </span>
                </div>

                <section className="ctm-section">
                    <div className="ctm-section-head">
                        <Wrench size={15} className="ctm-section-ico" />
                        <span className="ctm-section-title">Poslovi</span>
                        <span className="ctm-count">{validRows.length}</span>
                        <em className="ctm-section-note">stavke naloga — nose trošak rada</em>
                    </div>

                    <div className="ctm-tasks">
                        {rows.map((row, idx) => (
                            <div className="ctm-task" key={row.id}>
                                <div className="ctm-task-top">
                                    <span className="ctm-num">{idx + 1}</span>
                                    <input
                                        className="ctm-input"
                                        placeholder="Naziv zadatka (npr. Izrada paleta)"
                                        value={row.text}
                                        onChange={e => updateRow(row.id, { text: e.target.value })}
                                    />
                                    {rows.length > 1 && (
                                        <button className="ctm-remove" onClick={() => removeRow(row.id)} aria-label="Ukloni zadatak"><X size={16} /></button>
                                    )}
                                </div>
                                <div className="ctm-task-fields">
                                    <div className="ctm-field">
                                        <span>Radnici <em>prvi = glavni</em></span>
                                        <SearchableSelect
                                            options={workerOptions.filter(o => !row.workerIds.includes(o.value))}
                                            value=""
                                            onChange={v => addWorker(row.id, v)}
                                            placeholder={row.workerIds.length > 0 ? 'Dodaj još radnika…' : 'Izaberi radnika…'}
                                        />
                                        {row.workerIds.length > 0 && (
                                            <div className="ctm-chips">
                                                {row.workerIds.map((wid, i) => {
                                                    const w = workerLookup.get(wid);
                                                    return (
                                                        <span key={wid} className={`ctm-chip${i === 0 ? ' ctm-chip-main' : ''}`}>
                                                            {i === 0 && <span className="ctm-chip-tag">glavni</span>}
                                                            {w?.Name || 'Nepoznat'}
                                                            <button type="button" className="ctm-chip-x" onClick={() => removeWorker(row.id, wid)} aria-label="Ukloni radnika"><X size={12} /></button>
                                                        </span>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                    <label className="ctm-field">
                                        <span>Poveži s proizvodom <em>opciono</em></span>
                                        <SearchableSelect
                                            options={linkOptions}
                                            value={row.linkedItemId || ''}
                                            onChange={v => updateRow(row.id, { linkedItemId: v || undefined })}
                                            placeholder="Bez veze — samostalan trošak"
                                        />
                                    </label>
                                </div>
                            </div>
                        ))}
                    </div>

                    <button className="ctm-add" onClick={addRow}><Plus size={16} /> Dodaj posao</button>
                </section>

                {/* Zadaci iz taba Zadaci — evidencija/podsjetnici, NE stavke naloga:
                    ne nose trošak rada i ne utiču na profit. */}
                <section className="ctm-section">
                    <TaskAttachEditor
                        value={taskSelection}
                        onChange={setTaskSelection}
                        tasks={tasks}
                        workers={workers}
                        products={[]}
                        pickerZIndex={(zIndex || 1000) + 100}
                    />
                </section>

                <section className="ctm-section">
                    <div className="ctm-section-head">
                        <Coins size={15} className="ctm-section-ico" />
                        <span className="ctm-section-title">Vrijednost i troškovi</span>
                        <em className="ctm-section-note">za profit — opciono</em>
                    </div>
                    <label className="ctm-field">
                        <span>Projekat <em>profit ide u „Razni nalozi" tog projekta</em></span>
                        <SearchableSelect
                            options={projectOptions}
                            value={projectId}
                            onChange={v => setProjectId(v || '')}
                            placeholder="Bez projekta — globalni razni nalozi"
                        />
                    </label>
                    <div className="ctm-grid3">
                        <label className="ctm-field">
                            <span>Vrijednost <em>iz ponude</em></span>
                            <input type="number" min={0} step="0.01" inputMode="decimal"
                                value={offerValue} onChange={e => setOfferValue(e.target.value)} placeholder="KM" />
                        </label>
                        <label className="ctm-field">
                            <span>Materijal</span>
                            <input type="number" min={0} step="0.01" inputMode="decimal"
                                value={materialCost} onChange={e => setMaterialCost(e.target.value)} placeholder="KM" />
                        </label>
                        <label className="ctm-field">
                            <span>Ostali troškovi</span>
                            <input type="number" min={0} step="0.01" inputMode="decimal"
                                value={otherCosts} onChange={e => setOtherCosts(e.target.value)} placeholder="KM" />
                        </label>
                    </div>
                    <p className="ctm-fin-note">
                        Profit = vrijednost − materijal − ostalo − <strong>rad</strong> (dnevnice iz šihtarice).
                        Ostavi prazno ako je ovo čisto radni posao bez vlastite vrijednosti.
                    </p>
                </section>

                <section className="ctm-section">
                    <div className="ctm-section-head">
                        <Calendar size={15} className="ctm-section-ico" />
                        <span className="ctm-section-title">Detalji naloga</span>
                    </div>
                    <div className="ctm-grid2">
                        <label className="ctm-field">
                            <span>Rok <em>opciono</em></span>
                            <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
                        </label>
                        <label className="ctm-field">
                            <span>Napomena <em>opciono</em></span>
                            <input type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder="npr. interni poslovi za juni" />
                        </label>
                    </div>
                </section>

                <div className="ctm-footer">
                    {validRows.length > 0 && !hasAnyWorker && (
                        <span className="ctm-warn"><AlertTriangle size={14} /> Bez radnika nalog se neće moći pokrenuti</span>
                    )}
                    <div className="ctm-footer-btns">
                        <button className="ctm-btn" onClick={onClose} disabled={saving}>Odustani</button>
                        <button className="ctm-btn ctm-btn-primary" onClick={handleCreate} disabled={saving || validRows.length === 0}>
                            {saving ? <Loader2 size={15} className="ctm-spin" /> : <ClipboardList size={15} />}
                            Kreiraj nalog
                        </button>
                    </div>
                </div>
            </div>

            <style jsx>{`
                /* Sve kontrole (input, date, SearchableSelect trigger) dijele JEDNU
                   visinu/radius/font preko --ctm-* varijabli, a tipografija i razmaci
                   idu iz zajedničke --cm-* skale (globals.css) — isto kao modali platna. */
                .ctm {
                    --ctm-control-h: 40px;
                    --ctm-radius: var(--cm-r-control);
                    --ctm-font: var(--cm-fs-sm);
                    display: flex; flex-direction: column; gap: var(--cm-sp-5); padding: 2px 2px 0;
                }

                /* Uvod kao info-callout */
                .ctm-intro {
                    display: flex; align-items: flex-start; gap: var(--cm-sp-2);
                    margin: 0; padding: var(--cm-sp-3); border-radius: var(--cm-r-card);
                    background: var(--surface);
                    font-size: var(--cm-fs-sm); color: var(--text-secondary); line-height: 1.55;
                }
                .ctm-intro :global(svg) { color: var(--accent); flex-shrink: 0; margin-top: 1px; }

                /* Sekcije */
                .ctm-section { display: flex; flex-direction: column; gap: var(--cm-sp-3); }
                .ctm-section-head { display: flex; align-items: center; gap: var(--cm-sp-2); min-height: 22px; }
                .ctm-section-head :global(.ctm-section-ico) { color: var(--text-tertiary); flex-shrink: 0; }
                .ctm-section-title { font-size: var(--cm-fs-lg); font-weight: 700; color: var(--text-primary); }
                .ctm-count {
                    display: inline-flex; align-items: center; justify-content: center; min-width: 20px; height: 20px; padding: 0 6px;
                    font-size: var(--cm-fs-micro); font-weight: 700; color: var(--accent); background: var(--accent-light);
                    border-radius: var(--cm-r-pill); font-variant-numeric: tabular-nums;
                }
                /* Razlika između „Poslovi" (stavke naloga, nose trošak) i „Zadaci"
                   (podsjetnici iz taba Zadaci) — bez ovoga se dvije liste čitaju kao ista stvar. */
                .ctm-section-note { font-style: normal; font-size: var(--cm-fs-xs); font-weight: 400; color: var(--text-tertiary); }

                /* Kartice poslova */
                .ctm-tasks { display: flex; flex-direction: column; gap: var(--cm-sp-2); }
                .ctm-task {
                    display: flex; flex-direction: column; gap: var(--cm-sp-3);
                    padding: var(--cm-sp-3); border: 1px solid var(--border-light);
                    border-radius: var(--cm-r-card); background: var(--background);
                }
                .ctm-task-top { display: flex; align-items: center; gap: var(--cm-sp-3); }
                .ctm-num {
                    width: 26px; height: 26px; border-radius: var(--cm-r-pill); flex-shrink: 0;
                    display: flex; align-items: center; justify-content: center;
                    font-size: var(--cm-fs-xs); font-weight: 700; color: var(--text-secondary); background: var(--surface);
                    font-variant-numeric: tabular-nums;
                }
                .ctm-input {
                    flex: 1; min-width: 0; height: var(--ctm-control-h); box-sizing: border-box;
                    border: 1px solid var(--border); border-radius: var(--ctm-radius);
                    padding: 0 var(--cm-sp-3); font-size: var(--ctm-font); font-weight: 600; color: var(--text-primary); background: var(--background);
                    transition: var(--transition);
                }
                .ctm-input::placeholder { font-weight: 400; color: var(--text-tertiary); }
                .ctm-input:focus { outline: none; border-color: var(--accent); box-shadow: var(--cm-focus-ring); }
                .ctm-remove {
                    display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
                    width: var(--ctm-control-h); height: var(--ctm-control-h); border: none; background: transparent;
                    color: var(--text-tertiary); border-radius: var(--cm-r-control); cursor: pointer;
                }
                .ctm-remove:hover { color: var(--error); background: var(--error-bg); }

                /* Polja poslova su poravnata pod naslov (26px broj + 12px razmak),
                   a align-items:start + jednorede labele drže oba selecta u istom nivou. */
                .ctm-task-fields { display: grid; grid-template-columns: 1fr 1fr; gap: var(--cm-sp-3); padding-left: 38px; align-items: start; }
                .ctm-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: var(--cm-sp-3); }
                .ctm-grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: var(--cm-sp-3); }
                .ctm-fin-note { margin: 0; font-size: var(--cm-fs-xs); color: var(--text-tertiary); line-height: 1.55; }
                .ctm-fin-note strong { color: var(--text-secondary); }

                /* Zajednička labela + kontrola. .ctm-field je sam <label>, pa reset
                   text-transform-a ovdje gasi i globalno .modal label:uppercase koje
                   se inače provuklo sve do teksta u SearchableSelect trigeru. */
                .ctm-field { display: flex; flex-direction: column; gap: var(--cm-sp-2); min-width: 0; text-transform: none; }
                .ctm-field > span {
                    font-size: var(--cm-fs-sm); color: var(--text-secondary); font-weight: 600;
                    text-transform: none; letter-spacing: normal; line-height: 1.3;
                }
                .ctm-field > span em { font-style: normal; color: var(--text-tertiary); font-weight: 400; }
                .ctm-field > input {
                    height: var(--ctm-control-h); box-sizing: border-box;
                    border: 1px solid var(--border); border-radius: var(--ctm-radius);
                    padding: 0 var(--cm-sp-3); font-size: var(--ctm-font); color: var(--text-primary); background: var(--background);
                    transition: var(--transition);
                }
                .ctm-field > input::placeholder { color: var(--text-tertiary); }
                .ctm-field > input:focus { outline: none; border-color: var(--accent); box-shadow: var(--cm-focus-ring); }

                /* Radnici — čipovi ISPOD selecta, da rast lijeve kolone ne pomjera desni select. */
                .ctm-chips { display: flex; flex-wrap: wrap; gap: var(--cm-sp-1); margin-top: 2px; }
                .ctm-chip {
                    display: inline-flex; align-items: center; gap: var(--cm-sp-1);
                    padding: 3px 4px 3px 10px; border-radius: var(--cm-r-pill);
                    background: var(--surface); border: 1px solid var(--border);
                    font-size: var(--cm-fs-xs); font-weight: 600; color: var(--text-primary);
                }
                .ctm-chip-main { border-color: var(--accent); background: var(--accent-light); }
                .ctm-chip-tag {
                    font-size: var(--cm-fs-micro); font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em;
                    color: var(--accent); background: var(--background); padding: 1px 6px; border-radius: var(--cm-r-pill);
                }
                .ctm-chip-x {
                    display: inline-flex; align-items: center; justify-content: center;
                    width: 18px; height: 18px; border: none; background: transparent;
                    color: var(--text-tertiary); border-radius: var(--cm-r-pill); cursor: pointer;
                }
                .ctm-chip-x:hover { color: var(--error); background: var(--error-bg); }

                /* SearchableSelect trigger — zakovan na istu visinu/radius/border/font kao inputi. */
                .ctm-field :global(.searchable-select-trigger) {
                    height: var(--ctm-control-h) !important;
                    box-sizing: border-box !important;
                    padding: 0 var(--cm-sp-3) !important;
                    border: 1px solid var(--border) !important;
                    border-radius: var(--ctm-radius) !important;
                    background: var(--background) !important;
                    box-shadow: none !important;
                }
                .ctm-field :global(.searchable-select-trigger.active) {
                    border-color: var(--accent) !important;
                    box-shadow: var(--cm-focus-ring) !important;
                }
                .ctm-field :global(.trigger-text) {
                    font-size: var(--ctm-font) !important;
                    font-weight: 500 !important;
                    color: var(--text-primary) !important;
                }
                .ctm-field :global(.trigger-text.placeholder) {
                    color: var(--text-tertiary) !important;
                    font-weight: 400 !important;
                }
                .ctm-field :global(.trigger-icon) {
                    color: var(--text-tertiary) !important;
                    font-size: 18px !important;
                }

                /* Dodaj posao */
                .ctm-add {
                    align-self: flex-start; display: inline-flex; align-items: center; gap: var(--cm-sp-1);
                    height: 38px; border: 1px dashed var(--border); background: transparent; color: var(--accent);
                    font-size: var(--cm-fs-sm); font-weight: 600; padding: 0 var(--cm-sp-4);
                    border-radius: var(--cm-r-control); cursor: pointer; transition: var(--transition);
                }
                .ctm-add:hover { background: var(--accent-light); border-color: var(--accent); }

                /* Podnožje */
                .ctm-footer {
                    display: flex; align-items: center; justify-content: space-between; gap: var(--cm-sp-3); flex-wrap: wrap;
                    padding-top: var(--cm-sp-4); border-top: 1px solid var(--border-light);
                }
                .ctm-warn { display: inline-flex; align-items: center; gap: var(--cm-sp-1); font-size: var(--cm-fs-xs); color: var(--cm-warn-text); }
                .ctm-warn :global(svg) { color: var(--warning); flex-shrink: 0; }
                .ctm-footer-btns { display: flex; gap: var(--cm-sp-2); margin-left: auto; }
                .ctm-btn {
                    display: inline-flex; align-items: center; justify-content: center; gap: var(--cm-sp-1);
                    height: var(--ctm-control-h); border: 1px solid var(--border); background: var(--background); color: var(--text-primary);
                    font-size: var(--cm-fs-sm); font-weight: 600; padding: 0 var(--cm-sp-4); border-radius: var(--cm-r-control);
                    cursor: pointer; transition: var(--transition);
                }
                .ctm-btn:hover:not(:disabled) { background: var(--surface-hover); }
                .ctm-btn:disabled { opacity: 0.5; cursor: not-allowed; }
                .ctm-btn-primary { background: var(--accent); border-color: var(--accent); color: #fff; }
                .ctm-btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
                .ctm-spin { animation: ctm-spin 0.8s linear infinite; }
                @keyframes ctm-spin { to { transform: rotate(360deg); } }

                @media (max-width: 640px) {
                    .ctm-task-fields { grid-template-columns: 1fr; padding-left: 0; }
                    .ctm-grid2, .ctm-grid3 { grid-template-columns: 1fr; }
                    .ctm-footer-btns { width: 100%; }
                    .ctm-btn { flex: 1 1 auto; }
                }
            `}</style>
        </Modal>
    );
}
