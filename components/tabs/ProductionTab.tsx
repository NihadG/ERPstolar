'use client';

import { useState, useMemo, useEffect } from 'react';
import type { WorkOrder, Project, Worker } from '@/lib/types';
import { createWorkOrder, deleteWorkOrder, startWorkOrder, getWorkOrder } from '@/lib/database';
import Modal from '@/components/ui/Modal';
import { WORK_ORDER_STATUSES, PRODUCTION_STEPS } from '@/lib/types';

interface ProductionTabProps {
    workOrders: WorkOrder[];
    projects: Project[];
    workers: Worker[];
    onRefresh: () => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

interface ProductSelection {
    Product_ID: string;
    Product_Name: string;
    Project_ID: string;
    Project_Name: string;
    Quantity: number;
    Status: string;
    assignments: Record<string, string>;
}

export default function ProductionTab({ workOrders, projects, workers, onRefresh, showToast }: ProductionTabProps) {
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('');

    // Create Modal State
    const [createModal, setCreateModal] = useState(false);
    const [activeStep, setActiveStep] = useState(0); // 0: Projects, 1: Products, 2: Processes, 3: Details

    // Data State
    const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
    const [selectedProducts, setSelectedProducts] = useState<ProductSelection[]>([]);
    const [selectedProcesses, setSelectedProcesses] = useState<string[]>(['Rezanje', 'Kantiranje', 'Bušenje', 'Sklapanje']);
    const [customProcessInput, setCustomProcessInput] = useState('');
    const [dueDate, setDueDate] = useState('');
    const [notes, setNotes] = useState('');
    const [productSearch, setProductSearch] = useState('');

    // View Modal
    const [viewModal, setViewModal] = useState(false);
    const [currentWorkOrder, setCurrentWorkOrder] = useState<WorkOrder | null>(null);

    const filteredWorkOrders = workOrders.filter(wo => {
        const matchesSearch = wo.Work_Order_Number?.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesStatus = !statusFilter || wo.Status === statusFilter;
        return matchesSearch && matchesStatus;
    });

    const eligibleProducts = useMemo(() => {
        let products: any[] = [];
        projects.forEach(project => {
            if (selectedProjectIds.length > 0 && !selectedProjectIds.includes(project.Project_ID)) return;
            (project.products || []).forEach(product => {
                products.push({
                    Product_ID: product.Product_ID,
                    Product_Name: product.Name,
                    Project_ID: project.Project_ID,
                    Project_Name: project.Client_Name,
                    Quantity: product.Quantity || 1,
                    Status: product.Status,
                });
            });
        });

        if (productSearch.trim()) {
            const search = productSearch.toLowerCase();
            products = products.filter(p =>
                p.Product_Name.toLowerCase().includes(search) ||
                p.Project_Name.toLowerCase().includes(search)
            );
        }
        return products;
    }, [projects, selectedProjectIds, productSearch]);

    function getStatusClass(status: string): string {
        return 'status-' + status.toLowerCase().replace(/\s+/g, '-').replace(/č/g, 'c').replace(/ć/g, 'c').replace(/š/g, 's').replace(/ž/g, 'z').replace(/đ/g, 'd');
    }

    function formatDate(dateString: string): string {
        if (!dateString) return '-';
        return new Date(dateString).toLocaleDateString('hr-HR');
    }

    function openCreateModal() {
        setSelectedProcesses(['Rezanje', 'Kantiranje', 'Bušenje', 'Sklapanje']);
        setSelectedProducts([]);
        setDueDate('');
        setNotes('');
        setProductSearch('');
        setSelectedProjectIds([]);
        setActiveStep(0);
        setCreateModal(true);
    }

    // Step Logic
    const steps = [
        { id: 0, title: 'Projekti', subtitle: 'Odaberite projekat' },
        { id: 1, title: 'Proizvodi', subtitle: 'Odaberite proizvode' },
        { id: 2, title: 'Procesi', subtitle: 'Definišite procese' },
        { id: 3, title: 'Dodjela', subtitle: 'Raspored radnika' }
    ];

    const canGoNext = useMemo(() => {
        if (activeStep === 0) return selectedProjectIds.length > 0;
        if (activeStep === 1) return selectedProducts.length > 0;
        if (activeStep === 2) return selectedProcesses.length > 0;
        return true;
    }, [activeStep, selectedProjectIds, selectedProducts, selectedProcesses]);

    function handleNext() {
        if (activeStep < 3 && canGoNext) setActiveStep(activeStep + 1);
    }

    function handleBack() {
        if (activeStep > 0) setActiveStep(activeStep - 1);
    }

    // Selection Logic
    function toggleProjectSelection(projectId: string) {
        if (selectedProjectIds.includes(projectId)) {
            setSelectedProjectIds(selectedProjectIds.filter(id => id !== projectId));
            setSelectedProducts(selectedProducts.filter(p => p.Project_ID !== projectId));
        } else {
            setSelectedProjectIds([...selectedProjectIds, projectId]);
        }
    }

    function toggleProduct(product: any) {
        const exists = selectedProducts.find(p => p.Product_ID === product.Product_ID);
        if (exists) {
            setSelectedProducts(selectedProducts.filter(p => p.Product_ID !== product.Product_ID));
        } else {
            const newProduct: ProductSelection = { ...product, assignments: {} };
            selectedProcesses.forEach(proc => newProduct.assignments[proc] = '');
            setSelectedProducts([...selectedProducts, newProduct]);
        }
    }

    function selectAllProducts() {
        const newProducts: ProductSelection[] = eligibleProducts.map(p => ({
            ...p,
            assignments: selectedProcesses.reduce((acc, proc) => ({ ...acc, [proc]: '' }), {}),
        }));
        setSelectedProducts(newProducts);
    }

    function toggleProcess(process: string) {
        if (selectedProcesses.includes(process)) {
            setSelectedProcesses(selectedProcesses.filter(p => p !== process));
            setSelectedProducts(selectedProducts.map(p => {
                const newAssignments = { ...p.assignments };
                delete newAssignments[process];
                return { ...p, assignments: newAssignments };
            }));
        } else {
            setSelectedProcesses([...selectedProcesses, process]);
            setSelectedProducts(selectedProducts.map(p => ({
                ...p, assignments: { ...p.assignments, [process]: '' }
            })));
        }
    }

    function addCustomProcess() {
        const proc = customProcessInput.trim();
        if (!proc) return;
        if (selectedProcesses.includes(proc)) {
            showToast('Proces već postoji', 'error');
            return;
        }
        setSelectedProcesses([...selectedProcesses, proc]);
        setSelectedProducts(selectedProducts.map(p => ({ ...p, assignments: { ...p.assignments, [proc]: '' } })));
        setCustomProcessInput('');
    }

    function assignWorker(productId: string, process: string, workerId: string) {
        setSelectedProducts(selectedProducts.map(p => {
            if (p.Product_ID === productId) return { ...p, assignments: { ...p.assignments, [process]: workerId } };
            return p;
        }));
    }

    function assignWorkerToAll(process: string, workerId: string) {
        setSelectedProducts(selectedProducts.map(p => ({ ...p, assignments: { ...p.assignments, [process]: workerId } })));
        const worker = workers.find(w => w.Worker_ID === workerId);
        showToast(`${worker?.Name} dodijeljen za ${process} svim proizvodima`, 'success');
    }

    async function handleCreateWorkOrder() {
        if (selectedProducts.length === 0) return;

        const items = selectedProducts.map(p => ({
            Product_ID: p.Product_ID,
            Product_Name: p.Product_Name,
            Project_ID: p.Project_ID,
            Project_Name: p.Project_Name,
            Quantity: p.Quantity,
            Process_Assignments: Object.entries(p.assignments).reduce((acc, [proc, workerId]) => {
                const worker = workers.find(w => w.Worker_ID === workerId);
                acc[proc] = {
                    Status: 'Na čekanju',
                    ...(workerId && { Worker_ID: workerId }),
                    ...(worker && { Worker_Name: worker.Name }),
                };
                return acc;
            }, {} as any),
        }));

        const result = await createWorkOrder({
            Production_Steps: selectedProcesses,
            Due_Date: dueDate,
            Notes: notes,
            items: items as any,
        });

        if (result.success) {
            showToast(`Radni nalog ${result.data?.Work_Order_Number} kreiran`, 'success');
            setCreateModal(false);
            onRefresh();
        } else {
            showToast(result.message, 'error');
        }
    }

    // View/Edit/Delete existing logic...
    async function openViewModal(workOrderId: string) {
        const wo = await getWorkOrder(workOrderId);
        if (wo) { setCurrentWorkOrder(wo); setViewModal(true); }
    }
    async function handleDeleteWorkOrder(workOrderId: string) {
        if (!confirm('Obriši radni nalog?')) return;
        const res = await deleteWorkOrder(workOrderId);
        if (res.success) { showToast(res.message, 'success'); onRefresh(); } else showToast(res.message, 'error');
    }
    async function handleStartWorkOrder(workOrderId: string) {
        const res = await startWorkOrder(workOrderId);
        if (res.success) { showToast('Nalog pokrenut', 'success'); onRefresh(); setViewModal(false); } else showToast(res.message, 'error');
    }

    const activeOrders = filteredWorkOrders.filter(wo => wo.Status === 'U toku');
    const pendingOrders = filteredWorkOrders.filter(wo => wo.Status === 'Nacrt' || wo.Status === 'Dodijeljeno');
    const completedOrders = filteredWorkOrders.filter(wo => wo.Status === 'Završeno');

    return (
        <div className="tab-content active">
            <div className="content-header">
                <div className="search-box">
                    <span className="material-icons-round">search</span>
                    <input type="text" placeholder="Pretraži radne naloge..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                </div>
                <select className="filter-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                    <option value="">Svi statusi</option>
                    {WORK_ORDER_STATUSES.map(status => <option key={status} value={status}>{status}</option>)}
                </select>
                <button className="btn btn-primary" onClick={openCreateModal}><span className="material-icons-round">add</span>Novi Radni Nalog</button>
            </div>

            {filteredWorkOrders.length === 0 ? (
                <div className="empty-state"><span className="material-icons-round">engineering</span><h3>Nema radnih naloga</h3><p>Kreirajte prvi radni nalog</p></div>
            ) : (
                <div className="orders-sections">
                    {activeOrders.length > 0 && <OrderSection title="U toku" icon="play_circle" color="#0071e3" orders={activeOrders} onView={openViewModal} onDelete={handleDeleteWorkOrder} onStart={handleStartWorkOrder} getStatusClass={getStatusClass} formatDate={formatDate} />}
                    {pendingOrders.length > 0 && <OrderSection title="Na čekanju" icon="schedule" color="#ff9500" orders={pendingOrders} onView={openViewModal} onDelete={handleDeleteWorkOrder} onStart={handleStartWorkOrder} getStatusClass={getStatusClass} formatDate={formatDate} />}
                    {completedOrders.length > 0 && <OrderSection title="Završeno" icon="check_circle" color="#34c759" orders={completedOrders} onView={openViewModal} onDelete={handleDeleteWorkOrder} onStart={() => { }} getStatusClass={getStatusClass} formatDate={formatDate} />}
                </div>
            )}

            {/* ========== FULL-SCREEN WIZARD MODAL ========== */}
            <Modal isOpen={createModal} onClose={() => setCreateModal(false)} title="Novi Radni Nalog" size="fullscreen" footer={null}>
                <div className="wizard-container">
                    {/* PROGRESS HEADER */}
                    <div className="wizard-header">
                        <div className="steps-indicator">
                            {steps.map((step, index) => (
                                <div key={step.id} className={`step-item ${index <= activeStep ? 'active' : ''} ${index === activeStep ? 'current' : ''}`}>
                                    <div className="step-circle">{index + 1}</div>
                                    <div className="step-label">
                                        <span className="step-title">{step.title}</span>
                                        <span className="step-sub">{step.subtitle}</span>
                                    </div>
                                    {index < steps.length - 1 && <div className="step-line" />}
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* CONTENT BODY */}
                    <div className="wizard-body">
                        {/* STEP 1: PROJECTS */}
                        {activeStep === 0 && (
                            <div className="wizard-step step-projects">
                                <h3>Odaberite projekat</h3>
                                <div className="wz-grid">
                                    {projects.map(proj => (
                                        <div key={proj.Project_ID}
                                            className={`wz-card ${selectedProjectIds.includes(proj.Project_ID) ? 'selected' : ''}`}
                                            onClick={() => toggleProjectSelection(proj.Project_ID)}>
                                            <div className="card-check">
                                                <span className="material-icons-round">
                                                    {selectedProjectIds.includes(proj.Project_ID) ? 'check_circle' : 'radio_button_unchecked'}
                                                </span>
                                            </div>
                                            <div className="card-info">
                                                <span className="card-title">{proj.Client_Name}</span>
                                                <span className="card-sub">{proj.products?.length || 0} proizvoda</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* STEP 2: PRODUCTS */}
                        {activeStep === 1 && (
                            <div className="wizard-step step-products">
                                <div className="step-toolbar">
                                    <div className="tb-left">
                                        <h3>Odaberite proizvode</h3>
                                        <div className="tb-stats">{selectedProducts.length} odabrano</div>
                                    </div>
                                    <div className="tb-right">
                                        <div className="search-input">
                                            <span className="material-icons-round">search</span>
                                            <input placeholder="Pretraži..." value={productSearch} onChange={e => setProductSearch(e.target.value)} />
                                        </div>
                                        <button className="btn-text" onClick={selectAllProducts}>Odaberi sve</button>
                                        {selectedProducts.length > 0 && <button className="btn-text danger" onClick={() => setSelectedProducts([])}>Poništi</button>}
                                    </div>
                                </div>
                                <div className="wz-list">
                                    {eligibleProducts.map(prod => (
                                        <div key={prod.Product_ID}
                                            className={`wz-list-item ${selectedProducts.some(p => p.Product_ID === prod.Product_ID) ? 'selected' : ''}`}
                                            onClick={() => toggleProduct(prod)}>
                                            <span className="material-icons-round icon-check">
                                                {selectedProducts.some(p => p.Product_ID === prod.Product_ID) ? 'check_box' : 'check_box_outline_blank'}
                                            </span>
                                            <div className="li-content">
                                                <span className="li-title">{prod.Product_Name}</span>
                                                <span className="li-sub">{prod.Project_Name}</span>
                                            </div>
                                            <span className="li-qty">{prod.Quantity} kom</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* STEP 3: PROCESSES */}
                        {activeStep === 2 && (
                            <div className="wizard-step step-processes">
                                <h3>Definišite redoslijed procesa</h3>
                                <p className="step-desc">Ovi procesi će biti kreirani za svaki odabrani proizvod.</p>
                                <div className="process-tags">
                                    {selectedProcesses.map(proc => (
                                        <div key={proc} className="process-tag">
                                            <span>{proc}</span>
                                            <button onClick={() => toggleProcess(proc)}>✕</button>
                                        </div>
                                    ))}
                                </div>
                                <div className="add-process-row">
                                    <input placeholder="Dodaj novi proces..." value={customProcessInput} onChange={e => setCustomProcessInput(e.target.value)}
                                        onKeyPress={e => e.key === 'Enter' && addCustomProcess()} />
                                    <button onClick={addCustomProcess}>Dodaj</button>
                                </div>
                            </div>
                        )}

                        {/* STEP 4: DETAILS */}
                        {activeStep === 3 && (
                            <div className="wizard-step step-details">
                                <div className="details-top">
                                    <div className="input-group">
                                        <label>Rok završetka</label>
                                        <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
                                    </div>
                                    <div className="input-group full">
                                        <label>Napomena</label>
                                        <input type="text" placeholder="Dodatne upute za radnike..." value={notes} onChange={e => setNotes(e.target.value)} />
                                    </div>
                                </div>

                                <div className="matrix-wrapper">
                                    <div className="mw-header">
                                        <div className="m-col product">Proizvod</div>
                                        {selectedProcesses.map(proc => (
                                            <div key={proc} className="m-col process">
                                                <span>{proc}</span>
                                                <select onChange={e => e.target.value && assignWorkerToAll(proc, e.target.value)} value="">
                                                    <option value="">▼</option>
                                                    {workers.map(w => <option key={w.Worker_ID} value={w.Worker_ID}>{w.Name}</option>)}
                                                </select>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="mw-body">
                                        {selectedProducts.map(prod => (
                                            <div key={prod.Product_ID} className="m-row">
                                                <div className="m-col product">
                                                    <strong>{prod.Product_Name}</strong>
                                                    <small>{prod.Project_Name}</small>
                                                </div>
                                                {selectedProcesses.map(proc => (
                                                    <div key={proc} className="m-col process">
                                                        <select value={prod.assignments[proc] || ''} onChange={e => assignWorker(prod.Product_ID, proc, e.target.value)}
                                                            className={prod.assignments[proc] ? 'filled' : ''}>
                                                            <option value="">—</option>
                                                            {workers.map(w => <option key={w.Worker_ID} value={w.Worker_ID}>{w.Name}</option>)}
                                                        </select>
                                                    </div>
                                                ))}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* FOOTER ACTIONS */}
                    <div className="wizard-footer">
                        {activeStep > 0 ? (
                            <button className="btn-back" onClick={handleBack}>Nazad</button>
                        ) : <div></div>}

                        <div className="right-actions">
                            <span className="step-counter">Korak {activeStep + 1} od 4</span>
                            {activeStep === 3 ? (
                                <button className="btn-next finish" onClick={handleCreateWorkOrder}>
                                    Kreiraj Nalog <span className="material-icons-round">check</span>
                                </button>
                            ) : (
                                <button className="btn-next" onClick={handleNext} disabled={!canGoNext}>
                                    Dalje <span className="material-icons-round">arrow_forward</span>
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </Modal>

            <style jsx>{`
                /* Wizard Layout */
                .wizard-container { display: flex; flex-direction: column; height: 100%; background: #f5f5f7; }
                
                /* Header */
                .wizard-header { background: white; padding: 20px 40px; border-bottom: 1px solid var(--border); }
                .steps-indicator { display: flex; align-items: center; justify-content: space-between; max-width: 800px; margin: 0 auto; width: 100%; }
                .step-item { display: flex; align-items: center; gap: 12px; opacity: 0.4; transition: all 0.3s; position: relative; flex: 1; }
                .step-item.active { opacity: 1; }
                .step-circle { width: 32px; height: 32px; border-radius: 50%; background: #e0e0e0; color: white; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px; transition: all 0.3s; }
                .step-item.active .step-circle { background: var(--accent); }
                .step-item.current .step-circle { transform: scale(1.1); box-shadow: 0 0 0 4px rgba(0,113,227,0.1); }
                .step-label { display: flex; flex-direction: column; }
                .step-title { font-weight: 600; font-size: 14px; color: var(--text-primary); }
                .step-sub { font-size: 11px; color: var(--text-secondary); }
                .step-line { height: 2px; background: #e0e0e0; flex: 1; margin: 0 16px; border-radius: 2px; }
                .step-item.active .step-line { background: var(--accent); }

                /* Body */
                .wizard-body { flex: 1; overflow-y: auto; padding: 40px; display: flex; justify-content: center; }
                .wizard-step { width: 100%; max-width: 1000px; animation: slideIn 0.3s ease; }
                @keyframes slideIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
                
                /* Step 1: Projects Box */
                .wz-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; margin-top: 24px; }
                .wz-card { background: white; padding: 20px; border-radius: 12px; border: 2px solid transparent; box-shadow: 0 2px 8px rgba(0,0,0,0.05); cursor: pointer; display: flex; gap: 16px; align-items: center; transition: all 0.2s; }
                .wz-card:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
                .wz-card.selected { border-color: var(--accent); background: #f0f7ff; }
                .wz-card .material-icons-round { font-size: 24px; color: #ccc; }
                .wz-card.selected .material-icons-round { color: var(--accent); }
                .card-title { font-weight: 600; font-size: 16px; display: block; }
                .card-sub { font-size: 13px; color: var(--text-secondary); }

                /* Step 2: List */
                .step-toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
                .search-input { background: white; padding: 8px 12px; border-radius: 8px; display: flex; align-items: center; gap: 8px; border: 1px solid var(--border); width: 300px; }
                .search-input input { border: none; outline: none; width: 100%; font-size: 14px; }
                .btn-text { background: none; border: none; font-weight: 600; color: var(--accent); cursor: pointer; font-size: 14px; }
                .btn-text.danger { color: var(--danger); margin-left: 16px; }
                .wz-list { background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.05); }
                .wz-list-item { padding: 16px 24px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 16px; cursor: pointer; transition: background 0.1s; }
                .wz-list-item:hover { background: #f9f9f9; }
                .wz-list-item.selected { background: #f0f7ff; }
                .wz-list-item .icon-check { font-size: 20px; color: #ccc; }
                .wz-list-item.selected .icon-check { color: var(--accent); }
                .li-content { flex: 1; }
                .li-title { display: block; font-weight: 600; font-size: 14px; }
                .li-sub { font-size: 12px; color: var(--text-secondary); }
                .li-qty { font-weight: 600; background: #eee; padding: 2px 8px; border-radius: 6px; font-size: 12px; }

                /* Step 3: Processes */
                .step-processes { text-align: center; max-width: 600px; margin: 0 auto; }
                .step-desc { color: var(--text-secondary); margin-bottom: 32px; }
                .process-tags { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; margin-bottom: 32px; }
                .process-tag { background: white; padding: 10px 20px; border-radius: 30px; border: 1px solid var(--border); font-weight: 600; display: flex; align-items: center; gap: 8px; font-size: 15px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
                .process-tag button { background: var(--border); width: 20px; height: 20px; border-radius: 50%; border: none; display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 10px; color: #666; }
                .process-tag button:hover { background: var(--danger); color: white; }
                .add-process-row { display: flex; gap: 12px; }
                .add-process-row input { flex: 1; padding: 12px 20px; border-radius: 30px; border: 1px solid var(--border); outline: none; transition: border 0.2s; }
                .add-process-row input:focus { border-color: var(--accent); }
                .add-process-row button { padding: 0 24px; border-radius: 30px; border: none; background: var(--accent); color: white; font-weight: 600; cursor: pointer; }

                /* Step 4: Matrix */
                .details-top { display: flex; gap: 24px; margin-bottom: 24px; background: white; padding: 20px; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
                .input-group label { display: block; font-size: 11px; font-weight: 700; color: var(--text-secondary); text-transform: uppercase; margin-bottom: 6px; }
                .input-group input { width: 100%; padding: 10px; border: 1px solid var(--border); border-radius: 6px; font-size: 14px; }
                .input-group.full { flex: 1; }
                
                .matrix-wrapper { background: white; border-radius: 12px; border: 1px solid var(--border); overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.05); }
                .mw-header { display: flex; background: #f8f9fa; border-bottom: 1px solid var(--border); font-weight: 600; font-size: 13px; }
                .mw-body { max-height: 400px; overflow-y: auto; }
                .m-row { display: flex; border-bottom: 1px solid var(--border); transition: background 0.1s; }
                .m-row:hover { background: #fcfcfc; }
                .m-col { padding: 12px; border-right: 1px solid var(--border); display: flex; align-items: center; }
                .m-col.product { width: 250px; flex-shrink: 0; flex-direction: column; align-items: flex-start; justify-content: center; }
                .m-col.product strong { font-size: 13px; }
                .m-col.product small { font-size: 11px; color: var(--text-secondary); }
                .m-col.process { flex: 1; min-width: 140px; justify-content: center; flex-direction: column; gap: 4px; }
                .m-col.process select { width: 100%; padding: 6px; border: 1px solid var(--border); border-radius: 6px; font-size: 12px; background: white; }
                .m-col.process select.filled { border-color: var(--success); background: #f0fff4; color: #006400; }

                /* Footer */
                .wizard-footer { background: white; padding: 20px 40px; border-top: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; }
                .btn-back { background: #e0e0e0; border: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; color: #333; cursor: pointer; }
                .right-actions { display: flex; align-items: center; gap: 20px; }
                .step-counter { font-size: 13px; color: var(--text-secondary); font-weight: 500; }
                .btn-next { background: black; color: white; border: none; padding: 12px 32px; border-radius: 8px; font-weight: 600; display: flex; align-items: center; gap: 8px; cursor: pointer; transition: transform 0.1s; }
                .btn-next:hover { transform: translateY(-1px); }
                .btn-next:disabled { opacity: 0.5; cursor: not-allowed; }
                .btn-next.finish { background: var(--success); }

                /* Response Breakpoints */
                @media (max-width: 768px) {
                    .wizard-header { padding: 16px; }
                    .wizard-body { padding: 16px; }
                    .step-label { display: none; }
                    .details-top { flex-direction: column; }
                    .m-col.product { width: 140px; }
                }
            `}</style>
        </div>
    );
}

// ... OrderSection remains existing code ...
function OrderSection({ title, icon, color, orders, onView, onDelete, onStart, getStatusClass, formatDate }: any) {
    return (
        <div className="order-section">
            <div className="section-title" style={{ color }}>
                <span className="material-icons-round">{icon}</span>
                {title} <span className="badge">{orders.length}</span>
            </div>
            <div className="orders-grid">
                {orders.map((wo: any) => (
                    <div key={wo.Work_Order_ID} className="order-card" onClick={() => onView(wo.Work_Order_ID)}>
                        <div className="order-header">
                            <strong>{wo.Work_Order_Number}</strong>
                            <span className={`status-badge ${getStatusClass(wo.Status)}`}>{wo.Status}</span>
                        </div>
                        <div className="order-processes">
                            <span className="material-icons-round">engineering</span>
                            {wo.Production_Steps?.join(' → ') || 'N/A'}
                        </div>
                        <div className="order-meta">
                            <span><span className="material-icons-round">calendar_today</span>{formatDate(wo.Created_Date)}</span>
                            <span><span className="material-icons-round">inventory_2</span>{wo.items?.length || 0} proizvoda</span>
                        </div>
                        <div className="order-actions" onClick={(e) => e.stopPropagation()}>
                            {wo.Status === 'Nacrt' && (
                                <button className="btn btn-sm btn-primary" onClick={() => onStart(wo.Work_Order_ID)}>
                                    <span className="material-icons-round">play_arrow</span>
                                    Pokreni
                                </button>
                            )}
                            <button className="icon-btn sm danger" onClick={() => onDelete(wo.Work_Order_ID)}>
                                <span className="material-icons-round">delete</span>
                            </button>
                        </div>
                    </div>
                ))}
            </div>
            <style jsx>{`
                .order-section {
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                }
                .section-title {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-size: 16px;
                    font-weight: 600;
                }
                .section-title .badge {
                    background: var(--surface-hover);
                    padding: 2px 10px;
                    border-radius: 12px;
                    font-size: 13px;
                    font-weight: 500;
                }
                .orders-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
                    gap: 12px;
                }
                .order-card {
                    padding: 16px;
                    background: var(--surface);
                    border: 1px solid var(--border);
                    border-radius: 12px;
                    cursor: pointer;
                    transition: all 0.2s;
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                }
                .order-card:hover {
                    border-color: var(--accent);
                    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
                    transform: translateY(-1px);
                }
                .order-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .order-processes {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    font-size: 13px;
                    color: var(--text-secondary);
                }
                .order-processes .material-icons-round {
                    font-size: 16px;
                }
                .order-meta {
                    display: flex;
                    gap: 16px;
                    font-size: 12px;
                    color: var(--text-secondary);
                }
                .order-meta span {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                }
                .order-meta .material-icons-round {
                    font-size: 14px;
                }
                .order-actions {
                    display: flex;
                    gap: 8px;
                }
                .icon-btn.sm {
                    padding: 6px;
                }
                .icon-btn.sm .material-icons-round {
                    font-size: 16px;
                }
            `}</style>
        </div>
    );
}
