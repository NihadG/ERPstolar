'use client';

import { useState, useMemo, useEffect } from 'react';
import { Plus, X, Loader2, ClipboardList, AlertTriangle, Info, Wrench } from 'lucide-react';
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
    // Opisni naziv naloga (naslov na kartici/listi). Prazno → naslijedi naziv prvog
    // posla, da nalog nikad ne ostane bezimeni „Razni poslovi".
    const [orderName, setOrderName] = useState('');
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
            setOrderName('');
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
    const reset = () => { setRows([{ id: uid(), text: '', workerIds: [] }]); setOrderName(''); setNotes(''); setDueDate(''); setTaskSelection(emptyTaskSelection()); setProjectId(''); setOfferValue(''); setMaterialCost(''); setOtherCosts(''); };

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
            // Naslov naloga: eksplicitni „Naziv naloga", inače naziv prvog posla.
            // Nikad ne pada na goli „Razni poslovi" (to je fallback iz Project_Name-a).
            const orderTitle = orderName.trim() || validRows[0].text.trim();

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
                Name: orderTitle,
                Due_Date: dueDate || undefined,
                Notes: notes || undefined,
                items,
            }, organizationId);

            if (res.success) {
                showToast(`Nalog "${orderTitle}" kreiran (${items.length} ${items.length === 1 ? 'posao' : 'poslova'})`, 'success');

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
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Razni poslovi"
            size="large"
            zIndex={zIndex}
            footer={
                <div className="ctm-foot">
                    {validRows.length > 0 && !hasAnyWorker ? (
                        <span className="ctm-foot-warn"><AlertTriangle size={15} /> Bez radnika nalog se neće moći pokrenuti</span>
                    ) : <span className="ctm-foot-spacer" />}
                    <div className="ctm-foot-btns">
                        <button className="ctm-btn" onClick={onClose} disabled={saving}>Odustani</button>
                        <button className="ctm-btn ctm-btn-primary" onClick={handleCreate} disabled={saving || validRows.length === 0}>
                            {saving ? <Loader2 size={15} className="ctm-spin" /> : <ClipboardList size={15} />}
                            Kreiraj nalog
                        </button>
                    </div>
                </div>
            }
        >
            <div className="ctm">
                <div className="ctm-note">
                    <Info size={16} />
                    <span>
                        Poslovi koji nisu proizvodi iz baze (izrada paleta, čišćenje pogona…). Dodijeli radnika da nalog
                        možeš pokrenuti; posao možeš povezati s bilo kojim proizvodom — tada se rad uračuna u trošak tog proizvoda.
                    </span>
                </div>

                <section className="ctm-primary">
                    <div className="ctm-sec-head">
                        <Wrench size={16} className="ctm-sec-ico" />
                        <h3>Poslovi</h3>
                        <span className="ctm-count">{validRows.length}</span>
                        <span className="ctm-sec-hint">stavke naloga — nose trošak rada</span>
                    </div>

                    <div className="ctm-jobs">
                        {rows.map((row, idx) => (
                            <div className="ctm-job" key={row.id}>
                                <div className="ctm-job-top">
                                    <span className="ctm-job-num">{idx + 1}</span>
                                    <input
                                        className="ctm-job-name"
                                        placeholder="Naziv posla (npr. Izrada paleta)"
                                        value={row.text}
                                        onChange={e => updateRow(row.id, { text: e.target.value })}
                                    />
                                    {rows.length > 1 && (
                                        <button className="ctm-job-del" onClick={() => removeRow(row.id)} aria-label="Ukloni posao"><X size={16} /></button>
                                    )}
                                </div>
                                <div className="ctm-job-body">
                                    <div className="ctm-job-field">
                                        <span className="ctm-mini-lab">Radnici <em>· prvi = glavni</em></span>
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
                                    <label className="ctm-job-field">
                                        <span className="ctm-mini-lab">Poveži s proizvodom <em>· opciono</em></span>
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

                <section className="ctm-opts">
                    <div className="ctm-opts-title">
                        <span className="ctm-eyebrow">Opcije naloga</span>
                        <span className="ctm-opts-muted">— sve nije obavezno</span>
                    </div>

                    <div className="ctm-opt-grid">
                        <label className="ctm-field ctm-c2">
                            <span>Projekat <em>· za profit</em></span>
                            <SearchableSelect
                                options={projectOptions}
                                value={projectId}
                                onChange={v => setProjectId(v || '')}
                                placeholder="Bez projekta"
                            />
                        </label>
                        <label className="ctm-field ctm-c2">
                            <span>Naziv naloga <em>· prazno = 1. posao</em></span>
                            <input type="text" value={orderName} onChange={e => setOrderName(e.target.value)}
                                placeholder={validRows[0]?.text.trim() || 'Izrada paleta za skladište'} />
                        </label>
                        <label className="ctm-field">
                            <span>Vrijednost</span>
                            <input type="number" min={0} step="0.01" inputMode="decimal"
                                value={offerValue} onChange={e => setOfferValue(e.target.value)} placeholder="KM" />
                        </label>
                        <label className="ctm-field">
                            <span>Materijal</span>
                            <input type="number" min={0} step="0.01" inputMode="decimal"
                                value={materialCost} onChange={e => setMaterialCost(e.target.value)} placeholder="KM" />
                        </label>
                        <label className="ctm-field">
                            <span>Ostalo</span>
                            <input type="number" min={0} step="0.01" inputMode="decimal"
                                value={otherCosts} onChange={e => setOtherCosts(e.target.value)} placeholder="KM" />
                        </label>
                        <label className="ctm-field">
                            <span>Rok <em>· opciono</em></span>
                            <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
                        </label>
                        <label className="ctm-field ctm-c4">
                            <span>Napomena <em>· opciono</em></span>
                            <input type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder="npr. interni poslovi za juni" />
                        </label>
                        <p className="ctm-fin-note ctm-c4">
                            Profit = vrijednost − materijal − ostalo − <strong>rad</strong> (dnevnice iz šihtarice). Ostavi prazno ako je čisto radni posao.
                        </p>
                    </div>

                    {/* Zadaci iz taba Zadaci — evidencija/podsjetnici, NE stavke naloga:
                        ne nose trošak rada i ne utiču na profit. */}
                    <div className="ctm-tasks">
                        <TaskAttachEditor
                            value={taskSelection}
                            onChange={setTaskSelection}
                            tasks={tasks}
                            workers={workers}
                            products={[]}
                            pickerZIndex={(zIndex || 1000) + 100}
                        />
                    </div>
                </section>
            </div>

            <style jsx>{`
                /* Sve kontrole dijele jednu visinu/radius preko --ctm-*; tipografija i
                   razmaci idu iz zajedničke --cm-* skale (globals.css). */
                .ctm {
                    --ctm-h: 40px;
                    --ctm-r: var(--cm-r-control);
                    display: flex; flex-direction: column; gap: var(--cm-sp-5); padding: 2px 2px 0;
                }

                /* Tanka napomena umjesto velikog sivog bloka */
                .ctm-note {
                    display: flex; align-items: flex-start; gap: var(--cm-sp-2);
                    padding: 10px 12px; border-radius: var(--cm-r-control);
                    background: var(--accent-light); color: var(--text-secondary);
                    font-size: var(--cm-fs-sm); line-height: 1.5;
                }
                .ctm-note :global(svg) { color: var(--accent); flex-shrink: 0; margin-top: 2px; }

                /* Zaglavlje sekcije */
                .ctm-sec-head { display: flex; align-items: center; gap: var(--cm-sp-2); margin-bottom: var(--cm-sp-3); }
                .ctm-sec-head :global(.ctm-sec-ico) { color: var(--text-secondary); flex-shrink: 0; }
                .ctm-sec-head h3 { margin: 0; font-size: var(--cm-fs-lg); font-weight: 700; letter-spacing: -0.01em; color: var(--text-primary); }
                .ctm-count {
                    min-width: 20px; height: 20px; padding: 0 6px; display: inline-grid; place-items: center;
                    font-size: var(--cm-fs-micro); font-weight: 700; color: var(--accent); background: var(--accent-light);
                    border-radius: var(--cm-r-pill); font-variant-numeric: tabular-nums;
                }
                .ctm-sec-hint { font-size: var(--cm-fs-xs); color: var(--text-tertiary); margin-left: auto; }

                /* PRIMARNO: kartice poslova */
                .ctm-jobs { display: flex; flex-direction: column; gap: var(--cm-sp-2); }
                .ctm-job {
                    border: 1px solid var(--border); border-radius: var(--cm-r-card); background: var(--background);
                    box-shadow: var(--cm-shadow-card); overflow: hidden;
                }
                .ctm-job-top { display: flex; align-items: center; gap: var(--cm-sp-3); padding: 10px 12px; }
                .ctm-job-num {
                    width: 26px; height: 26px; flex-shrink: 0; border-radius: var(--cm-r-pill); background: var(--surface);
                    display: grid; place-items: center; font-size: var(--cm-fs-xs); font-weight: 700; color: var(--text-secondary);
                    font-variant-numeric: tabular-nums;
                }
                .ctm-job-name {
                    flex: 1; min-width: 0; height: 38px; border: none; background: transparent;
                    font-size: var(--cm-fs-md); font-weight: 600; color: var(--text-primary); outline: none;
                }
                .ctm-job-name::placeholder { font-weight: 400; color: var(--text-tertiary); }
                .ctm-job-del {
                    width: 32px; height: 32px; flex-shrink: 0; border: none; background: transparent;
                    color: var(--text-tertiary); border-radius: var(--cm-r-control); cursor: pointer; display: grid; place-items: center;
                }
                .ctm-job-del:hover { background: var(--error-bg); color: var(--error); }
                .ctm-job-body {
                    display: grid; grid-template-columns: 1fr 1fr; gap: var(--cm-sp-3);
                    padding: 12px 12px 12px 50px; border-top: 1px dashed var(--border-light); align-items: start;
                }
                .ctm-job-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; text-transform: none; }
                .ctm-mini-lab { display: block; height: 16px; line-height: 16px; font-size: var(--cm-fs-xs); font-weight: 600; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                .ctm-mini-lab em { font-style: normal; font-weight: 400; color: var(--text-tertiary); }

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
                    font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em;
                    color: #fff; background: var(--accent); padding: 2px 6px; border-radius: var(--cm-r-pill);
                }
                .ctm-chip-x {
                    display: inline-flex; align-items: center; justify-content: center;
                    width: 18px; height: 18px; border: none; background: transparent;
                    color: var(--text-tertiary); border-radius: var(--cm-r-pill); cursor: pointer;
                }
                .ctm-chip-x:hover { color: var(--error); background: var(--error-bg); }

                /* Dodaj posao */
                .ctm-add {
                    align-self: flex-start; display: inline-flex; align-items: center; gap: var(--cm-sp-1);
                    height: 36px; margin-top: var(--cm-sp-2); border: 1px dashed var(--border); background: transparent;
                    color: var(--accent); font-size: var(--cm-fs-sm); font-weight: 600; padding: 0 var(--cm-sp-4);
                    border-radius: var(--cm-r-control); cursor: pointer; transition: var(--transition);
                }
                .ctm-add:hover { background: var(--accent-light); border-color: var(--accent); }

                /* SEKUNDARNO: opcije naloga (demotovano na tintani panel) */
                .ctm-opts {
                    background: var(--surface); border: 1px solid var(--border-light); border-radius: var(--cm-r-card);
                    padding: var(--cm-sp-4); display: flex; flex-direction: column; gap: var(--cm-sp-5);
                }
                .ctm-opts-title { display: flex; align-items: baseline; gap: var(--cm-sp-2); }
                .ctm-eyebrow { font-size: var(--cm-fs-micro); font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--text-tertiary); }
                .ctm-opts-muted { font-size: var(--cm-fs-xs); color: var(--text-tertiary); }
                /* Jedna 4-kolonska mreža — svi boxovi/tekstovi u liniji (bez para blokova koji se razilaze) */
                .ctm-opt-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; align-items: start; }
                .ctm-c2 { grid-column: span 2; }
                .ctm-c4 { grid-column: span 4; }
                .ctm-fin-note { margin: 2px 0 0; font-size: var(--cm-fs-xs); color: var(--text-tertiary); line-height: 1.5; }
                .ctm-fin-note strong { color: var(--text-secondary); }

                /* Zajednička labela + kontrola. .ctm-field je <label>, pa reset text-transform-a
                   ovdje gasi i globalno .modal label:uppercase. */
                .ctm-field { display: flex; flex-direction: column; gap: var(--cm-sp-2); min-width: 0; text-transform: none; }
                .ctm-field > span {
                    height: 16px; line-height: 16px;
                    font-size: var(--cm-fs-xs); color: var(--text-secondary); font-weight: 600;
                    text-transform: none; letter-spacing: normal;
                    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                }
                .ctm-field > span em { font-style: normal; color: var(--text-tertiary); font-weight: 400; }
                .ctm-field > input {
                    height: var(--ctm-h); box-sizing: border-box; border: 1px solid var(--border); border-radius: var(--ctm-r);
                    padding: 0 var(--cm-sp-3); font-size: var(--cm-fs-md); color: var(--text-primary); background: var(--background);
                    transition: var(--transition);
                }
                .ctm-field > input::placeholder { color: var(--text-tertiary); }
                .ctm-field > input:focus { outline: none; border-color: var(--accent); box-shadow: var(--cm-focus-ring); }

                /* SearchableSelect trigger — ista visina/radius/font kao inputi. */
                .ctm :global(.searchable-select-trigger) {
                    height: var(--ctm-h) !important; box-sizing: border-box !important;
                    padding: 0 var(--cm-sp-3) !important; border: 1px solid var(--border) !important;
                    border-radius: var(--ctm-r) !important; background: var(--background) !important; box-shadow: none !important;
                }
                .ctm :global(.searchable-select-trigger.active) { border-color: var(--accent) !important; box-shadow: var(--cm-focus-ring) !important; }
                .ctm :global(.trigger-text) { font-size: var(--cm-fs-md) !important; font-weight: 500 !important; color: var(--text-primary) !important; }
                .ctm :global(.trigger-text.placeholder) { color: var(--text-tertiary) !important; font-weight: 400 !important; }
                .ctm :global(.trigger-icon) { color: var(--text-tertiary) !important; font-size: 18px !important; }

                /* Podnožje (ide u Modal footer prop → pinovano ispod tijela) */
                .ctm-foot { flex: 1; display: flex; align-items: center; gap: var(--cm-sp-3); }
                .ctm-foot-spacer { flex: 1; }
                .ctm-foot-warn { display: inline-flex; align-items: center; gap: 6px; font-size: var(--cm-fs-xs); font-weight: 600; color: var(--cm-warn-text); }
                .ctm-foot-warn :global(svg) { color: var(--warning); flex-shrink: 0; }
                .ctm-foot-btns { margin-left: auto; display: flex; gap: var(--cm-sp-2); }
                .ctm-btn {
                    display: inline-flex; align-items: center; justify-content: center; gap: var(--cm-sp-1);
                    height: 40px; border: 1px solid var(--border); background: var(--background); color: var(--text-primary);
                    font-size: var(--cm-fs-sm); font-weight: 600; padding: 0 18px; border-radius: var(--cm-r-control);
                    cursor: pointer; transition: var(--transition);
                }
                .ctm-btn:hover:not(:disabled) { background: var(--surface-hover); }
                .ctm-btn:disabled { opacity: 0.5; cursor: not-allowed; }
                .ctm-btn-primary { background: var(--accent); border-color: var(--accent); color: #fff; }
                .ctm-btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
                .ctm-spin { animation: ctm-spin 0.8s linear infinite; }
                @keyframes ctm-spin { to { transform: rotate(360deg); } }

                @media (max-width: 640px) {
                    .ctm-job-body { grid-template-columns: 1fr; padding-left: 12px; }
                    .ctm-opt-grid { grid-template-columns: 1fr 1fr; }
                    .ctm-c2, .ctm-c4 { grid-column: span 2; }
                    .ctm-foot-btns { width: 100%; }
                    .ctm-btn { flex: 1 1 auto; }
                }
            `}</style>
        </Modal>
    );
}
