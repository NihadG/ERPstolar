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
    const [selectedProcesses, setSelectedProcesses] = useState<string[]>(['Rezanje', 'Kantiranje', 'Bušenje', 'Sklapanje']);
    const [customProcessInput, setCustomProcessInput] = useState('');
    const [selectedProducts, setSelectedProducts] = useState<ProductSelection[]>([]);
    const [dueDate, setDueDate] = useState('');
    const [notes, setNotes] = useState('');
    const [productSearch, setProductSearch] = useState('');
    const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);

    // Strict Step Control
    const [activeStep, setActiveStep] = useState<'projects' | 'products' | 'processes' | 'details'>('projects');

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
            if (selectedProjectIds.length > 0 && !selectedProjectIds.includes(project.Project_ID)) {
                return;
            }

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

    // Progress calculation
    const progressSteps = [
        { id: 'projects', label: 'Projekti', done: selectedProjectIds.length > 0 },
        { id: 'products', label: 'Proizvodi', done: selectedProducts.length > 0 },
        { id: 'processes', label: 'Procesi', done: selectedProcesses.length > 0 },
        { id: 'details', label: 'Detalji', done: !!dueDate }
    ];
    const completedSteps = progressSteps.filter(s => s.done).length;

    function getStatusClass(status: string): string {
        return 'status-' + status.toLowerCase()
            .replace(/\s+/g, '-')
            .replace(/č/g, 'c')
            .replace(/ć/g, 'c')
            .replace(/š/g, 's')
            .replace(/ž/g, 'z')
            .replace(/đ/g, 'd');
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
        setActiveStep('projects');
        setCreateModal(true);
    }

    function toggleProcess(process: string) {
        if (selectedProcesses.includes(process)) {
            const newProcesses = selectedProcesses.filter(p => p !== process);
            setSelectedProcesses(newProcesses);
            setSelectedProducts(selectedProducts.map(p => {
                const newAssignments = { ...p.assignments };
                delete newAssignments[process];
                return { ...p, assignments: newAssignments };
            }));
        } else {
            setSelectedProcesses([...selectedProcesses, process]);
            setSelectedProducts(selectedProducts.map(p => ({
                ...p,
                assignments: { ...p.assignments, [process]: '' }
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
        setSelectedProducts(selectedProducts.map(p => ({
            ...p,
            assignments: { ...p.assignments, [proc]: '' }
        })));
        setCustomProcessInput('');
    }

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
            const newProduct: ProductSelection = {
                ...product,
                assignments: {},
            };
            selectedProcesses.forEach(proc => {
                newProduct.assignments[proc] = '';
            });
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

    function assignWorker(productId: string, process: string, workerId: string) {
        setSelectedProducts(selectedProducts.map(p => {
            if (p.Product_ID === productId) {
                return { ...p, assignments: { ...p.assignments, [process]: workerId } };
            }
            return p;
        }));
    }

    function assignWorkerToAll(process: string, workerId: string) {
        setSelectedProducts(selectedProducts.map(p => ({
            ...p,
            assignments: { ...p.assignments, [process]: workerId },
        })));
        const worker = workers.find(w => w.Worker_ID === workerId);
        showToast(`${worker?.Name} dodijeljen za ${process} svim proizvodima`, 'success');
    }

    function assignWorkerToProduct(productId: string, workerId: string) {
        setSelectedProducts(selectedProducts.map(p => {
            if (p.Product_ID === productId) {
                const newAssignments = { ...p.assignments };
                selectedProcesses.forEach(proc => {
                    newAssignments[proc] = workerId;
                });
                return { ...p, assignments: newAssignments };
            }
            return p;
        }));
        const worker = workers.find(w => w.Worker_ID === workerId);
        const product = selectedProducts.find(p => p.Product_ID === productId);
        showToast(`${worker?.Name} dodijeljen svim procesima za ${product?.Product_Name}`, 'success');
    }

    function assignOneWorkerToAll(workerId: string) {
        setSelectedProducts(selectedProducts.map(p => {
            const newAssignments: Record<string, string> = {};
            selectedProcesses.forEach(proc => {
                newAssignments[proc] = workerId;
            });
            return { ...p, assignments: newAssignments };
        }));
        const worker = workers.find(w => w.Worker_ID === workerId);
        showToast(`${worker?.Name} dodijeljen svim procesima i proizvodima`, 'success');
    }

    async function handleCreateWorkOrder() {
        if (selectedProducts.length === 0) {
            showToast('Odaberite barem jedan proizvod', 'error');
            return;
        }

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

    // Auto-advance logic (only when first selection is made)
    useEffect(() => {
        if (activeStep === 'projects' && selectedProjectIds.length > 0) {
            // Optional: Don't auto-advance instantly to allow multiple selections, 
            // but we provide a clear button to do so.
        }
    }, [selectedProjectIds]);

    function goToNextStep() {
        if (activeStep === 'projects') setActiveStep('products');
        else if (activeStep === 'products') setActiveStep('processes');
        else if (activeStep === 'processes') setActiveStep('details');
    }

    async function openViewModal(workOrderId: string) {
        const wo = await getWorkOrder(workOrderId);
        if (wo) {
            setCurrentWorkOrder(wo);
            setViewModal(true);
        }
    }

    async function handleDeleteWorkOrder(workOrderId: string) {
        if (!confirm('Jeste li sigurni da želite obrisati ovaj radni nalog?')) return;
        const result = await deleteWorkOrder(workOrderId);
        if (result.success) {
            showToast(result.message, 'success');
            onRefresh();
        } else {
            showToast(result.message, 'error');
        }
    }

    async function handleStartWorkOrder(workOrderId: string) {
        const result = await startWorkOrder(workOrderId);
        if (result.success) {
            showToast('Radni nalog pokrenut', 'success');
            onRefresh();
            setViewModal(false);
        } else {
            showToast(result.message, 'error');
        }
    }

    const activeOrders = filteredWorkOrders.filter(wo => wo.Status === 'U toku');
    const pendingOrders = filteredWorkOrders.filter(wo => wo.Status === 'Nacrt' || wo.Status === 'Dodijeljeno');
    const completedOrders = filteredWorkOrders.filter(wo => wo.Status === 'Završeno');

    const totalAssignments = selectedProducts.length * selectedProcesses.length;
    const filledAssignments = selectedProducts.reduce((acc, p) =>
        acc + Object.values(p.assignments).filter(v => v).length, 0
    );

    return (
        <div className="tab-content active">
            <div className="content-header">
                <div className="search-box">
                    <span className="material-icons-round">search</span>
                    <input
                        type="text"
                        placeholder="Pretraži radne naloge..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                <select className="filter-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                    <option value="">Svi statusi</option>
                    {WORK_ORDER_STATUSES.map(status => (
                        <option key={status} value={status}>{status}</option>
                    ))}
                </select>
                <button className="btn btn-primary" onClick={openCreateModal}>
                    <span className="material-icons-round">add</span>
                    Novi Radni Nalog
                </button>
            </div>

            {filteredWorkOrders.length === 0 ? (
                <div className="empty-state">
                    <span className="material-icons-round">engineering</span>
                    <h3>Nema radnih naloga</h3>
                    <p>Kreirajte prvi radni nalog klikom na "Novi Radni Nalog"</p>
                </div>
            ) : (
                <div className="orders-sections">
                    {activeOrders.length > 0 && <OrderSection title="U toku" icon="play_circle" color="#0071e3" orders={activeOrders} onView={openViewModal} onDelete={handleDeleteWorkOrder} onStart={handleStartWorkOrder} getStatusClass={getStatusClass} formatDate={formatDate} />}
                    {pendingOrders.length > 0 && <OrderSection title="Na čekanju" icon="schedule" color="#ff9500" orders={pendingOrders} onView={openViewModal} onDelete={handleDeleteWorkOrder} onStart={handleStartWorkOrder} getStatusClass={getStatusClass} formatDate={formatDate} />}
                    {completedOrders.length > 0 && <OrderSection title="Završeno" icon="check_circle" color="#34c759" orders={completedOrders} onView={openViewModal} onDelete={handleDeleteWorkOrder} onStart={() => { }} getStatusClass={getStatusClass} formatDate={formatDate} />}
                </div>
            )}

            {/* ========== CREATE MODAL - REFINED SEQUENTIAL LAYOUT ========== */}
            <Modal
                isOpen={createModal}
                onClose={() => setCreateModal(false)}
                title="Novi Radni Nalog"
                size="fullscreen"
                footer={null}
            >
                <div className="wo-creator">
                    {/* Header with Stats */}
                    <div className="wo-header">
                        <div className="header-breadcrumbs">
                            <h2 className="modal-title">Kreiranje Naloga</h2>
                            <span className="divider">/</span>
                            <span className="current-step-name">
                                {activeStep === 'projects' ? 'Odabir Projekata' :
                                    activeStep === 'products' ? 'Odabir Proizvoda' :
                                        activeStep === 'processes' ? 'Definisanje Procesa' : 'Detalji Naloga'}
                            </span>
                        </div>
                        <div className="compact-progress">
                            <div className={`cp-step ${completedSteps >= 1 ? 'active' : ''}`} />
                            <div className={`cp-step ${completedSteps >= 2 ? 'active' : ''}`} />
                            <div className={`cp-step ${completedSteps >= 3 ? 'active' : ''}`} />
                            <div className={`cp-step ${completedSteps >= 4 ? 'active' : ''}`} />
                            <span className="cp-text">{Math.round((completedSteps / 4) * 100)}%</span>
                        </div>
                    </div>

                    <div className="wo-body">
                        {/* LEFT: STRICT SEQUENTIAL SIDEBAR */}
                        <div className="wo-sidebar">
                            {/* Step 1: Projects */}
                            <div className={`sb-step ${activeStep === 'projects' ? 'active' : ''} ${selectedProjectIds.length > 0 ? 'completed' : ''}`}>
                                <button className="sb-header" onClick={() => setActiveStep('projects')}>
                                    <div className="sb-icon">
                                        <span className="material-icons-round">folder</span>
                                    </div>
                                    <div className="sb-info">
                                        <span className="sb-label">Korak 1</span>
                                        <span className="sb-title">Projekti</span>
                                    </div>
                                    {selectedProjectIds.length > 0 && (
                                        <span className="sb-badge">{selectedProjectIds.length}</span>
                                    )}
                                </button>
                                {activeStep === 'projects' && (
                                    <div className="sb-content">
                                        <div className="sb-scroll-area">
                                            <div className="sb-list">
                                                {projects.map(project => {
                                                    const isSelected = selectedProjectIds.includes(project.Project_ID);
                                                    return (
                                                        <div
                                                            key={project.Project_ID}
                                                            className={`sb-item ${isSelected ? 'selected' : ''}`}
                                                            onClick={() => toggleProjectSelection(project.Project_ID)}
                                                        >
                                                            <span className="material-icons-round check-icon">
                                                                {isSelected ? 'check_circle' : 'radio_button_unchecked'}
                                                            </span>
                                                            <span className="item-name">{project.Client_Name}</span>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                        {selectedProjectIds.length > 0 && (
                                            <div className="sb-actions">
                                                <button className="sb-next-btn" onClick={goToNextStep}>
                                                    Dalje <span className="material-icons-round">arrow_forward</span>
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Step 2: Products */}
                            <div className={`sb-step ${activeStep === 'products' ? 'active' : ''} ${selectedProducts.length > 0 ? 'completed' : ''} ${selectedProjectIds.length === 0 ? 'disabled' : ''}`}>
                                <button className="sb-header" onClick={() => selectedProjectIds.length > 0 && setActiveStep('products')}>
                                    <div className="sb-icon">
                                        <span className="material-icons-round">inventory_2</span>
                                    </div>
                                    <div className="sb-info">
                                        <span className="sb-label">Korak 2</span>
                                        <span className="sb-title">Proizvodi</span>
                                    </div>
                                    {selectedProducts.length > 0 && (
                                        <span className="sb-badge">{selectedProducts.length}</span>
                                    )}
                                </button>
                                {activeStep === 'products' && (
                                    <div className="sb-content">
                                        <div className="sb-toolbar">
                                            <button className="text-btn" onClick={selectAllProducts}>Odaberi sve</button>
                                            {selectedProducts.length > 0 && (
                                                <button className="text-btn danger" onClick={() => setSelectedProducts([])}>Poništi</button>
                                            )}
                                        </div>
                                        <div className="sb-search-container">
                                            <div className="sb-search">
                                                <span className="material-icons-round">search</span>
                                                <input
                                                    placeholder="Pretraži..."
                                                    value={productSearch}
                                                    onChange={(e) => setProductSearch(e.target.value)}
                                                />
                                            </div>
                                        </div>
                                        <div className="sb-scroll-area">
                                            <div className="sb-list">
                                                {eligibleProducts.map(product => {
                                                    const isSelected = selectedProducts.some(p => p.Product_ID === product.Product_ID);
                                                    return (
                                                        <div
                                                            key={product.Product_ID}
                                                            className={`sb-item ${isSelected ? 'selected' : ''}`}
                                                            onClick={() => toggleProduct(product)}
                                                        >
                                                            <span className="material-icons-round check-icon">
                                                                {isSelected ? 'check_box' : 'check_box_outline_blank'}
                                                            </span>
                                                            <div className="item-details">
                                                                <div className="item-name">{product.Product_Name}</div>
                                                                <div className="item-sub">{product.Project_Name}</div>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                        {selectedProducts.length > 0 && (
                                            <div className="sb-actions">
                                                <button className="sb-next-btn" onClick={goToNextStep}>
                                                    Dalje <span className="material-icons-round">arrow_forward</span>
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Step 3: Processes */}
                            <div className={`sb-step ${activeStep === 'processes' ? 'active' : ''} ${selectedProcesses.length > 0 ? 'completed' : ''}`}>
                                <button className="sb-header" onClick={() => setActiveStep('processes')}>
                                    <div className="sb-icon">
                                        <span className="material-icons-round">engineering</span>
                                    </div>
                                    <div className="sb-info">
                                        <span className="sb-label">Korak 3</span>
                                        <span className="sb-title">Procesi</span>
                                    </div>
                                    <span className="sb-badge">{selectedProcesses.length}</span>
                                </button>
                                {activeStep === 'processes' && (
                                    <div className="sb-content">
                                        <div className="sb-scroll-area">
                                            <div className="sb-chips">
                                                {selectedProcesses.map(proc => (
                                                    <div key={proc} className="sb-chip">
                                                        <span>{proc}</span>
                                                        <button onClick={() => toggleProcess(proc)}>✕</button>
                                                    </div>
                                                ))}
                                            </div>
                                            <div className="sb-add-row">
                                                <input
                                                    placeholder="Novi proces..."
                                                    value={customProcessInput}
                                                    onChange={(e) => setCustomProcessInput(e.target.value)}
                                                    onKeyPress={(e) => e.key === 'Enter' && addCustomProcess()}
                                                />
                                                <button onClick={addCustomProcess}>+</button>
                                            </div>
                                        </div>
                                        <div className="sb-actions">
                                            <button className="sb-next-btn" onClick={goToNextStep}>
                                                Pregled Detalja <span className="material-icons-round">arrow_forward</span>
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Step 4: Details */}
                            <div className={`sb-step ${activeStep === 'details' ? 'active' : ''} ${dueDate ? 'completed' : ''}`}>
                                <button className="sb-header" onClick={() => setActiveStep('details')}>
                                    <div className="sb-icon">
                                        <span className="material-icons-round">event_note</span>
                                    </div>
                                    <div className="sb-info">
                                        <span className="sb-label">Korak 4</span>
                                        <span className="sb-title">Ostalo</span>
                                    </div>
                                </button>
                                {activeStep === 'details' && (
                                    <div className="sb-content">
                                        <div className="sb-scroll-area">
                                            <div className="sb-form">
                                                <div className="sb-form-group">
                                                    <label>Rok završetka</label>
                                                    <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                                                </div>
                                                <div className="sb-form-group">
                                                    <label>Napomena</label>
                                                    <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* RIGHT: RESULT / MATRIX AREA */}
                        <div className="wo-result-area">
                            <div className="result-header">
                                <div className="result-title">
                                    <h3>Pregled i Dodjela</h3>
                                    <p>{selectedProducts.length} proizvoda, {selectedProcesses.length} procesa</p>
                                </div>
                                {selectedProducts.length > 0 && (
                                    <div className="result-actions">
                                        <select
                                            className="bulk-select"
                                            onChange={(e) => e.target.value && assignOneWorkerToAll(e.target.value)}
                                            value=""
                                        >
                                            <option value="">Dodijeli jednog radnika svima...</option>
                                            {workers.map(w => (
                                                <option key={w.Worker_ID} value={w.Worker_ID}>{w.Name}</option>
                                            ))}
                                        </select>
                                    </div>
                                )}
                            </div>

                            <div className="result-content">
                                {selectedProducts.length === 0 ? (
                                    <div className="wo-empty-placeholder">
                                        <div className="placeholder-icon">
                                            <span className="material-icons-round">arrow_back</span>
                                        </div>
                                        <h3>Započnite sa izborom</h3>
                                        <p>Pratite korake u lijevom meniju da biste kreirali radni nalog.</p>
                                    </div>
                                ) : (
                                    <div className="modern-matrix">
                                        <div className="mm-header">
                                            <div className="mm-cell product-col">Proizvod</div>
                                            {selectedProcesses.map(proc => (
                                                <div key={proc} className="mm-cell process-col">
                                                    <span>{proc}</span>
                                                    <select
                                                        onChange={(e) => e.target.value && assignWorkerToAll(proc, e.target.value)}
                                                        value=""
                                                        title="Svi..."
                                                    >
                                                        <option value="">▼</option>
                                                        {workers.map(w => (
                                                            <option key={w.Worker_ID} value={w.Worker_ID}>{w.Name}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                            ))}
                                        </div>
                                        <div className="mm-body">
                                            {selectedProducts.map(product => (
                                                <div key={product.Product_ID} className="mm-row">
                                                    <div className="mm-cell product-col">
                                                        <span className="p-name">{product.Product_Name}</span>
                                                        <span className="p-sub">{product.Project_Name}</span>
                                                    </div>
                                                    {selectedProcesses.map(proc => (
                                                        <div key={proc} className="mm-cell process-col">
                                                            <select
                                                                value={product.assignments[proc] || ''}
                                                                onChange={(e) => assignWorker(product.Product_ID, proc, e.target.value)}
                                                                className={product.assignments[proc] ? 'assigned' : ''}
                                                            >
                                                                <option value="">—</option>
                                                                {workers.map(w => (
                                                                    <option key={w.Worker_ID} value={w.Worker_ID}>{w.Name}</option>
                                                                ))}
                                                            </select>
                                                        </div>
                                                    ))}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="wo-footer-actions">
                                <button className="btn-ghost" onClick={() => setCreateModal(false)}>Odustani</button>
                                <button className="btn-primary-lg" onClick={handleCreateWorkOrder} disabled={selectedProducts.length === 0}>
                                    <span className="material-icons-round">check_circle</span>
                                    Kreiraj Nalog
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </Modal>

            <style jsx>{`
                /* ... existing styles for main tab ... */
                .orders-sections {
                    display: flex;
                    flex-direction: column;
                    gap: 24px;
                }

                /* ========== NEW MODAL LAYOUT ========== */
                .wo-creator {
                    display: flex;
                    flex-direction: column;
                    height: 100%;
                    background: #f8f9fa;
                }

                .wo-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 16px 24px;
                    background: white;
                    border-bottom: 1px solid var(--border);
                }

                .modal-title {
                    font-size: 18px;
                    font-weight: 700;
                    margin: 0;
                }

                .header-breadcrumbs {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                }

                .divider { color: var(--text-secondary); }
                .current-step-name { color: var(--accent); font-weight: 500; font-size: 14px; }

                .compact-progress {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                }

                .cp-step {
                    width: 30px;
                    height: 4px;
                    background: #e0e0e0;
                    border-radius: 2px;
                }

                .cp-step.active { background: var(--success); }
                .cp-text { font-size: 12px; font-weight: 600; margin-left: 8px; color: var(--text-secondary); }

                .wo-body {
                    flex: 1;
                    display: grid;
                    grid-template-columns: 320px 1fr;
                    overflow: hidden;
                }

                /* SIDEBAR STYLES */
                .wo-sidebar {
                    background: white;
                    border-right: 1px solid var(--border);
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                    padding: 0;
                    height: 100%; /* Critical: provides height context for flex children */
                }

                .sb-step {
                    background: white;
                    border-bottom: 1px solid var(--border);
                    display: flex;
                    flex-direction: column;
                    flex-shrink: 1; /* Allow shrinking when another is active */
                    flex-grow: 0;
                    transition: all 0.3s ease;
                    overflow: hidden;
                    min-height: 0; /* Critical for flex shrinking */
                }

                .sb-step.active {
                    flex-grow: 1; /* Grow to fill space */
                    flex-shrink: 0; /* Don't shrink when active */
                    background: #f8f9fa;
                    min-height: 200px; /* Minimum usable height */
                }

                .sb-step.disabled {
                    opacity: 0.6;
                    pointer-events: none;
                    background: #fafafa;
                }

                .sb-header {
                    width: 100%;
                    display: flex;
                    align-items: center;
                    gap: 16px;
                    padding: 18px 24px;
                    background: white;
                    border: none;
                    text-align: left;
                    cursor: pointer;
                    transition: background 0.2s;
                }
                
                .sb-step.active .sb-header {
                    background: #f8f9fa;
                    border-bottom: 1px solid var(--border);
                }

                .sb-icon {
                    width: 36px;
                    height: 36px;
                    background: var(--surface-hover);
                    border-radius: 8px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: var(--text-secondary);
                    transition: all 0.2s;
                    flex-shrink: 0;
                }

                .sb-step.active .sb-icon {
                    background: var(--accent);
                    color: white;
                    width: 42px;
                    height: 42px;
                    box-shadow: 0 2px 8px rgba(0, 113, 227, 0.2);
                }

                .sb-step.completed .sb-icon {
                    background: var(--success);
                    color: white;
                }

                .sb-info { flex: 1; min-width: 0; }
                .sb-label { 
                    display: block; 
                    font-size: 11px; 
                    color: var(--text-secondary); 
                    text-transform: uppercase; 
                    font-weight: 700; 
                    letter-spacing: 0.5px;
                    margin-bottom: 2px;
                }
                .sb-title { 
                    display: block; 
                    font-size: 15px; 
                    font-weight: 600; 
                    color: var(--text-primary); 
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                .sb-badge {
                    background: var(--surface-hover);
                    padding: 4px 10px;
                    border-radius: 12px;
                    font-size: 12px;
                    font-weight: 700;
                    color: var(--text-primary);
                }
                .sb-step.active .sb-badge {
                    background: white;
                    color: var(--accent);
                    box-shadow: 0 1px 2px rgba(0,0,0,0.05);
                }

                .sb-content {
                    flex: 1; /* Fill remaining space in the step */
                    overflow: hidden; /* Clip for inner scroll */
                    display: flex;
                    flex-direction: column;
                    padding: 0; /* Inner padding handled by children */
                    animation: fadeIn 0.3s ease;
                }
                
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }

                /* WRAPPER FOR SCROLLABLE CONTENT */
                .sb-scroll-area {
                    flex: 1;
                    overflow-y: auto;
                    padding: 16px 20px;
                    min-height: 0; /* Critical: allows flex child to scroll */
                }

                .sb-list {
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                }
                
                .sb-item {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    padding: 14px;
                    border-radius: 10px;
                    cursor: pointer;
                    transition: all 0.2s;
                    border: 1px solid transparent;
                    background: white;
                    box-shadow: 0 1px 2px rgba(0,0,0,0.02);
                }

                .sb-item:hover { 
                    border-color: var(--accent);
                    transform: translateY(-1px);
                    box-shadow: 0 4px 12px rgba(0,0,0,0.05);
                    z-index: 1;
                }
                
                .sb-item.selected { 
                    background: #f0f7ff;
                    border-color: var(--accent);
                }
                
                .check-icon { font-size: 24px; color: var(--border); transition: color 0.2s; }
                .sb-item.selected .check-icon { color: var(--accent); }

                .item-name { font-size: 14px; font-weight: 600; color: var(--text-primary); }
                .item-sub { font-size: 12px; color: var(--text-secondary); margin-top: 2px; }
                
                /* FIXED BOTTOM BAR IN STEP */
                .sb-actions {
                    padding: 16px 24px;
                    background: white;
                    border-top: 1px solid var(--border);
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                }

                .sb-next-btn {
                    padding: 10px 20px;
                    background: var(--text-primary);
                    color: white;
                    border: none;
                    border-radius: 8px;
                    font-size: 13px;
                    font-weight: 600;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    transition: transform 0.1s;
                }
                
                .sb-next-btn:hover { background: black; transform: translateY(-1px); }

                /* PRODUCTS STEP EXTRAS */
                .sb-toolbar { padding: 0 24px 12px 24px; display: flex; justify-content: space-between; align-items: center; background: #f8f9fa; border-bottom: 1px solid var(--border); }
                .text-btn { background: none; border: none; font-size: 12px; font-weight: 600; color: var(--accent); cursor: pointer; padding: 6px 10px; border-radius: 6px; }
                .text-btn:hover { background: rgba(0, 113, 227, 0.05); }
                .text-btn.danger { color: var(--danger); }
                .text-btn.danger:hover { background: rgba(255, 59, 48, 0.05); }
                
                .sb-search-container {
                    padding: 16px 24px 12px 24px;
                    background: #f8f9fa;
                }

                .sb-search {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    background: white;
                    padding: 10px 12px;
                    border-radius: 8px;
                    border: 1px solid var(--border);
                    transition: border-color 0.2s;
                }
                .sb-search:focus-within { border-color: var(--accent); }
                .sb-search input { border: none; background: none; font-size: 13px; width: 100%; outline: none; }

                /* PROCESSES STEP EXTRAS */
                .sb-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 20px; }
                .sb-chip { display: flex; align-items: center; gap: 6px; padding: 8px 12px; background: white; color: var(--text-primary); border: 1px solid var(--border); border-radius: 20px; font-size: 13px; font-weight: 500; }
                .sb-chip button { background: none; border: none; color: var(--text-secondary); cursor: pointer; font-size: 16px; display: flex; align-items: center; }
                .sb-chip button:hover { color: var(--danger); }
                
                .sb-add-row { display: flex; gap: 8px; }
                .sb-add-row input { flex: 1; padding: 12px; border: 1px solid var(--border); border-radius: 8px; font-size: 14px; }
                .sb-add-row button { width: 48px; background: var(--accent); color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 24px; display: flex; align-items: center; justify-content: center; }

                /* DETAILS STEP EXTRAS */
                .sb-form label { display: block; font-size: 12px; font-weight: 600; margin: 0 0 8px 0; color: var(--text-secondary); }
                .sb-form-group { margin-bottom: 20px; }
                .sb-form input, .sb-form textarea { width: 100%; padding: 12px; border: 1px solid var(--border); border-radius: 8px; font-size: 14px; font-family: inherit; background: white; transition: border-color 0.2s; }
                .sb-form input:focus, .sb-form textarea:focus { border-color: var(--accent); outline: none; }

                /* RESULT AREA */
                .wo-result-area {
                    background: #f8f9fa;
                    display: flex;
                    flex-direction: column;
                    padding: 24px;
                }

                .result-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 20px;
                }
                
                .result-title h3 { margin: 0; font-size: 20px; }
                .result-title p { margin: 4px 0 0 0; font-size: 13px; color: var(--text-secondary); }

                .bulk-select {
                    padding: 8px 12px;
                    border: 1px solid var(--border);
                    border-radius: 8px;
                    background: white;
                    font-size: 13px;
                    cursor: pointer;
                    box-shadow: 0 1px 2px rgba(0,0,0,0.05);
                }

                .result-content { flex: 1; overflow: hidden; display: flex; flex-direction: column; }

                .wo-empty-placeholder {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    text-align: center;
                    opacity: 0.6;
                }
                .placeholder-icon {
                    width: 64px;
                    height: 64px;
                    background: #e0e0e0;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    margin-bottom: 16px;
                }

                /* MODERN MATRIX */
                .modern-matrix {
                    background: white;
                    border-radius: 12px;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.05);
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                    height: 100%;
                    border: 1px solid var(--border);
                }

                .mm-header {
                    display: flex;
                    background: #f1f3f5;
                    border-bottom: 1px solid var(--border);
                }

                .mm-cell { flex: 1; padding: 12px; display: flex; align-items: center; overflow: hidden; }
                .product-col { flex: 0 0 200px; font-weight: 600; color: var(--text-secondary); font-size: 12px; text-transform: uppercase; border-right: 1px solid var(--border); }
                .process-col { display: flex; flex-direction: column; gap: 4px; justify-content: center; border-right: 1px solid var(--border); min-width: 100px; }
                
                .process-col span { font-size: 12px; font-weight: 600; }
                .process-col select { width: 100%; font-size: 10px; padding: 2px; border: 1px solid var(--border); background: white; border-radius: 4px; }

                .mm-body { overflow-y: auto; flex: 1; }
                .mm-row { display: flex; border-bottom: 1px solid var(--border); }
                .mm-row:hover { background: #f8f9fa; }

                .mm-row .product-col { display: flex; flex-direction: column; align-items: flex-start; justify-content: center; }
                .p-name { font-size: 13px; font-weight: 500; }
                .p-sub { font-size: 10px; color: var(--text-secondary); }

                .mm-row .process-col select {
                    width: 100%;
                    padding: 6px;
                    border: 1px solid var(--border);
                    border-radius: 6px;
                    font-size: 12px;
                    background: white;
                }
                .mm-row .process-col select.assigned {
                    background: #e6fcf5;
                    border-color: var(--success);
                    color: #087f5b;
                }

                .wo-footer-actions {
                    padding-top: 20px;
                    display: flex;
                    justify-content: flex-end;
                    gap: 12px;
                }

                .btn-ghost { padding: 12px 24px; background: none; border: 1px solid transparent; font-weight: 600; cursor: pointer; color: var(--text-secondary); }
                .btn-primary-lg { 
                    padding: 12px 32px; 
                    background: var(--accent); 
                    color: white; 
                    border: none; 
                    border-radius: 8px; 
                    font-weight: 600; 
                    display: flex; 
                    align-items: center; 
                    gap: 8px; 
                    cursor: pointer; 
                    box-shadow: 0 4px 12px rgba(0, 113, 227, 0.2); 
                }
                .btn-primary-lg:disabled { opacity: 0.5; cursor: not-allowed; box-shadow: none; }

                @media (max-width: 900px) {
                    .wo-body { grid-template-columns: 1fr; grid-template-rows: auto 1fr; }
                    .wo-sidebar { max-height: 40vh; border-right: none; border-bottom: 1px solid var(--border); }
                    .product-col { flex: 0 0 140px; }
                }
            `}</style>
        </div>
    );
}

// ... OrderSection component remains the same ...
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

