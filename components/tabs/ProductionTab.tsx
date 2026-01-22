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
                    {/* COMPACT HEADER WITH NAVIGATION */}
                    <div className="wizard-header">
                        <div className="header-left">
                            {activeStep > 0 && (
                                <button className="btn-nav back" onClick={handleBack}>
                                    <span className="material-icons-round">arrow_back</span>
                                    Nazad
                                </button>
                            )}
                        </div>

                        <div className="steps-indicator compact">
                            {steps.map((step, index) => (
                                <div key={step.id} className={`step-item ${index <= activeStep ? 'active' : ''} ${index === activeStep ? 'current' : ''}`}>
                                    <div className="step-circle">{index + 1}</div>
                                    <span className="step-title">{step.title}</span>
                                    {index < steps.length - 1 && <div className="step-line" />}
                                </div>
                            ))}
                        </div>

                        <div className="header-right">
                            {activeStep === 3 ? (
                                <button className="btn-nav finish" onClick={handleCreateWorkOrder}>
                                    Kreiraj
                                    <span className="material-icons-round">check</span>
                                </button>
                            ) : (
                                <button className="btn-nav next" onClick={handleNext} disabled={!canGoNext}>
                                    Dalje
                                    <span className="material-icons-round">arrow_forward</span>
                                </button>
                            )}
                        </div>
                    </div>

                    {/* CONTENT BODY - MAXIMIZED */}
                    <div className="wizard-body">
                        {/* STEP 1: PROJECTS */}
                        {activeStep === 0 && (
                            <div className="wizard-step step-projects">
                                <div className="step-page-header">
                                    <h3>Odaberite projekat</h3>
                                    <p>Za koji projekat kreirate nalog?</p>
                                </div>
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
                                <div className="step-toolbar sticky">
                                    <div className="tb-left">
                                        <h3>Odaberite proizvode</h3>
                                        <span className="tb-stats">{selectedProducts.length} odabrano</span>
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
                                <div className="wz-list-scroll">
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
                            </div>
                        )}

                        {/* STEP 3: PROCESSES */}
                        {activeStep === 2 && (
                            <div className="wizard-step step-processes">
                                <div className="step-page-header text-center">
                                    <h3>Definišite procese</h3>
                                    <p>Ovi procesi će biti primijenjeni na sve odabrane proizvode.</p>
                                </div>
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

                                <div className="matrix-wrapper full-height">
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
                </div>
            </Modal>

            <style jsx>{`
                /* Wizard Layout */
                .wizard-container { display: flex; flex-direction: column; height: 100vh; background: #f5f5f7; overflow: hidden; }
                
                /* COMPACT HEADER */
                .wizard-header { 
                    flex-shrink: 0;
                    background: white; 
                    padding: 8px 16px; 
                    border-bottom: 1px solid var(--border); 
                    display: grid;
                    grid-template-columns: 100px 1fr 100px;
                    align-items: center;
                    height: 56px;
                }
                
                .header-left { display: flex; justify-content: flex-start; }
                .header-right { display: flex; justify-content: flex-end; }
                
                .steps-indicator { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; }
                .step-item { display: flex; align-items: center; gap: 6px; opacity: 0.4; transition: all 0.3s; }
                .step-item.active { opacity: 1; }
                .step-circle { width: 24px; height: 24px; border-radius: 50%; background: #e0e0e0; color: white; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 11px; }
                .step-item.active .step-circle { background: var(--accent); }
                .step-item.current .step-circle { transform: scale(1.1); box-shadow: 0 0 0 2px rgba(0,113,227,0.1); }
                .step-title { font-weight: 600; font-size: 11px; color: var(--text-primary); white-space: nowrap; }
                .step-line { width: 20px; height: 2px; background: #e0e0e0; border-radius: 2px; }
                .step-item.active .step-line { background: var(--accent); }

                /* NAV BUTTONS */
                .btn-nav {
                    padding: 6px 16px;
                    border-radius: 16px;
                    font-size: 12px;
                    font-weight: 600;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    border: none;
                    cursor: pointer;
                    transition: all 0.2s;
                    height: 32px;
                }
                .btn-nav.back { background: #f0f0f0; color: #333; }
                .btn-nav.back:hover { background: #e0e0e0; }
                .btn-nav.next { background: black; color: white; }
                .btn-nav.next:hover { background: #333; transform: translateX(2px); }
                .btn-nav.finish { background: var(--success); color: white; }
                .btn-nav.finish:hover { background: #28a745; }
                .btn-nav:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
                .btn-nav .material-icons-round { font-size: 14px; }

                /* Body - Maximized */
                .wizard-body { flex: 1; overflow-y: auto; padding: 20px; display: flex; justify-content: center; align-items: flex-start; }
                .wizard-step { width: 100%; max-width: 1200px; display: flex; flex-direction: column; height: 100%; }
                .step-page-header { margin-bottom: 20px; text-align: left; }
                .step-page-header h3 { font-size: 20px; margin: 0; font-weight: 700; color: var(--text-primary); }
                .step-page-header p { font-size: 14px; color: var(--text-secondary); margin: 6px 0 0 0; }
                .text-center { text-align: center; }

                /* Step 1: Projects Grid */
                .wz-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; }
                .wz-card { 
                    padding: 20px; 
                    border-radius: 12px; 
                    border: 2px solid transparent; 
                    background: white; 
                    cursor: pointer; 
                    display: flex; 
                    gap: 16px; 
                    align-items: center; 
                    transition: all 0.2s; 
                    box-shadow: 0 1px 3px rgba(0,0,0,0.08);
                }
                .wz-card:hover { border-color: var(--accent); transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.12); }
                .wz-card.selected { border-color: var(--accent); background: #f0f7ff; box-shadow: 0 4px 12px rgba(0, 113, 227, 0.15); }
                .wz-card .material-icons-round { font-size: 28px; color: #ccc; transition: color 0.2s; }
                .wz-card.selected .material-icons-round { color: var(--accent); }
                .card-info { display: flex; flex-direction: column; gap: 4px; }
                .card-title { font-size: 15px; font-weight: 600; color: var(--text-primary); display: block; }
                .card-sub { font-size: 13px; color: var(--text-secondary); }

                /* Step 2: Products List */
                .step-products { height: 100%; display: flex; flex-direction: column; }
                .step-toolbar { 
                    display: flex; 
                    justify-content: space-between; 
                    align-items: center; 
                    margin-bottom: 16px; 
                    background: white; 
                    padding: 12px 16px; 
                    border-radius: 10px; 
                    box-shadow: 0 1px 3px rgba(0,0,0,0.08);
                }
                .step-toolbar.sticky { position: sticky; top: 0; z-index: 10; }
                .tb-left { display: flex; align-items: center; gap: 12px; }
                .tb-left h3 { font-size: 16px; margin: 0; font-weight: 600; }
                .tb-stats { 
                    font-size: 12px; 
                    color: var(--accent); 
                    font-weight: 600; 
                    background: rgba(0,113,227,0.1); 
                    padding: 4px 12px; 
                    border-radius: 12px; 
                }
                .tb-right { display: flex; align-items: center; gap: 12px; }
                .search-input { 
                    background: #f5f5f7; 
                    padding: 8px 12px; 
                    border-radius: 8px; 
                    display: flex; 
                    align-items: center; 
                    gap: 8px; 
                    border: 1px solid transparent; 
                    width: 260px; 
                    transition: all 0.2s;
                }
                .search-input:focus-within { background: white; border-color: var(--accent); }
                .search-input .material-icons-round { font-size: 18px; color: var(--text-secondary); }
                .search-input input { 
                    border: none; 
                    outline: none; 
                    background: transparent; 
                    width: 100%; 
                    font-size: 13px; 
                    color: var(--text-primary);
                }
                .btn-text { 
                    background: none; 
                    border: none; 
                    font-weight: 600; 
                    color: var(--accent); 
                    cursor: pointer; 
                    font-size: 13px; 
                    padding: 6px 12px; 
                    border-radius: 6px; 
                    transition: background 0.2s;
                }
                .btn-text:hover { background: rgba(0,113,227,0.08); }
                .btn-text.danger { color: var(--danger); }
                .btn-text.danger:hover { background: rgba(220,53,69,0.08); }
                
                .wz-list-scroll { flex: 1; overflow-y: auto; background: white; border-radius: 12px; border: 1px solid #e0e0e0; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
                .wz-list { display: flex; flex-direction: column; }
                .wz-list-item { 
                    padding: 14px 20px; 
                    border-bottom: 1px solid #f0f0f0; 
                    display: flex; 
                    align-items: center; 
                    gap: 16px; 
                    cursor: pointer; 
                    transition: background 0.15s;
                }
                .wz-list-item:last-child { border-bottom: none; }
                .wz-list-item:hover { background: #f9fafb; }
                .wz-list-item.selected { background: #f0f7ff; border-left: 3px solid var(--accent); }
                .wz-list-item .icon-check { font-size: 22px; color: #d0d0d0; transition: color 0.2s; }
                .wz-list-item.selected .icon-check { color: var(--accent); }
                .li-content { flex: 1; display: flex; flex-direction: column; gap: 2px; }
                .li-title { display: block; font-weight: 600; font-size: 14px; color: var(--text-primary); }
                .li-sub { font-size: 12px; color: var(--text-secondary); }
                .li-qty { 
                    font-weight: 600; 
                    background: #e8f4ff; 
                    color: var(--accent); 
                    padding: 4px 10px; 
                    border-radius: 8px; 
                    font-size: 12px; 
                }

                /* Step 3: Processes */
                .step-processes { display: flex; flex-direction: column; align-items: center; padding: 40px 20px; }
                .process-tags { 
                    display: flex; 
                    flex-wrap: wrap; 
                    gap: 12px; 
                    justify-content: center; 
                    margin: 32px 0; 
                }
                .process-tag { 
                    background: white; 
                    padding: 12px 20px; 
                    border-radius: 24px; 
                    border: 2px solid #e0e0e0; 
                    font-weight: 600; 
                    display: flex; 
                    align-items: center; 
                    gap: 10px; 
                    font-size: 14px; 
                    box-shadow: 0 2px 6px rgba(0,0,0,0.06); 
                    transition: all 0.2s;
                }
                .process-tag:hover { transform: translateY(-1px); box-shadow: 0 4px 10px rgba(0,0,0,0.1); }
                .process-tag button { 
                    background: #f0f0f0; 
                    width: 22px; 
                    height: 22px; 
                    border-radius: 50%; 
                    border: none; 
                    display: flex; 
                    align-items: center; 
                    justify-content: center; 
                    cursor: pointer; 
                    font-size: 12px; 
                    color: #666; 
                    transition: all 0.2s;
                }
                .process-tag button:hover { background: var(--danger); color: white; transform: scale(1.1); }
                .add-process-row { display: flex; gap: 12px; max-width: 500px; width: 100%; }
                .add-process-row input { 
                    flex: 1; 
                    padding: 14px 20px; 
                    border-radius: 24px; 
                    border: 2px solid #e0e0e0; 
                    outline: none; 
                    transition: all 0.2s; 
                    font-size: 14px;
                }
                .add-process-row input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(0,113,227,0.1); }
                .add-process-row button { 
                    padding: 0 28px; 
                    border-radius: 24px; 
                    border: none; 
                    background: var(--accent); 
                    color: white; 
                    font-weight: 600; 
                    cursor: pointer; 
                    font-size: 14px; 
                    transition: all 0.2s;
                }
                .add-process-row button:hover { background: #0056b3; transform: scale(1.02); }

                /* Step 4: Matrix View */
                .step-details { height: 100%; display: flex; flex-direction: column; }
                .details-top { 
                    padding: 16px 20px; 
                    background: white; 
                    border: 1px solid #e0e0e0; 
                    border-radius: 10px; 
                    display: flex; 
                    gap: 20px; 
                    margin-bottom: 16px; 
                    box-shadow: 0 1px 3px rgba(0,0,0,0.08);
                }
                .input-group { display: flex; flex-direction: column; }
                .input-group.full { flex: 1; }
                .input-group label { 
                    display: block; 
                    font-size: 11px; 
                    font-weight: 700; 
                    color: var(--text-secondary); 
                    text-transform: uppercase; 
                    margin-bottom: 6px; 
                    letter-spacing: 0.5px;
                }
                .input-group input { 
                    width: 100%; 
                    padding: 10px 14px; 
                    border: 1px solid #d0d0d0; 
                    border-radius: 8px; 
                    font-size: 14px; 
                    transition: all 0.2s; 
                    outline: none;
                }
                .input-group input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(0,113,227,0.1); }
                
                .matrix-wrapper.full-height { 
                    flex: 1; 
                    display: flex; 
                    flex-direction: column; 
                    background: white; 
                    border-radius: 12px; 
                    border: 1px solid #e0e0e0; 
                    overflow: hidden; 
                    box-shadow: 0 2px 8px rgba(0,0,0,0.08);
                }
                .mw-header { 
                    display: flex; 
                    background: linear-gradient(180deg, #f8f9fa 0%, #f0f1f3 100%); 
                    border-bottom: 2px solid #e0e0e0; 
                    font-weight: 700; 
                    font-size: 12px; 
                    position: sticky;
                    top: 0;
                    z-index: 5;
                }
                .mw-body { flex: 1; overflow-y: auto; }
                .m-row { display: flex; border-bottom: 1px solid #e8e8e8; transition: background 0.15s; }
                .m-row:hover { background: #f9fafb; }
                .m-row:last-child { border-bottom: none; }
                .m-col { 
                    padding: 12px 16px; 
                    border-right: 1px solid #e8e8e8; 
                    display: flex; 
                    align-items: center; 
                }
                .m-col:last-child { border-right: none; }
                .m-col.product { 
                    width: 280px; 
                    flex-shrink: 0; 
                    flex-direction: column; 
                    align-items: flex-start; 
                    justify-content: center; 
                    gap: 4px; 
                    background: #fafbfc;
                }
                .m-col.product strong { font-size: 14px; font-weight: 600; color: var(--text-primary); }
                .m-col.product small { font-size: 12px; color: var(--text-secondary); }
                .m-col.process { 
                    flex: 1; 
                    min-width: 160px; 
                    justify-content: center; 
                    flex-direction: column; 
                    gap: 6px; 
                }
                .m-col.process span { font-size: 11px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.3px; }
                .m-col.process select { 
                    width: 100%; 
                    padding: 8px 12px; 
                    border: 1px solid #d0d0d0; 
                    border-radius: 6px; 
                    font-size: 13px; 
                    background: white; 
                    cursor: pointer; 
                    transition: all 0.2s; 
                    outline: none;
                }
                .m-col.process select:hover { border-color: #999; }
                .m-col.process select:focus { border-color: var(--accent); box-shadow: 0 0 0 2px rgba(0,113,227,0.1); }
                .m-col.process select.filled { 
                    border-color: var(--success); 
                    background: #f0fff4; 
                    color: #006400; 
                    font-weight: 600;
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
