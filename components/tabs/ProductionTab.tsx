'use client';

import { useState, useMemo } from 'react';
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

    // Collapsible sections state
    const [expandedSections, setExpandedSections] = useState({
        projects: true,
        products: true,
        processes: false,
        details: false
    });

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
        { id: 'workers', label: 'Radnici', done: selectedProducts.some(p => Object.values(p.assignments).some(v => v)) }
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
        setExpandedSections({ projects: true, products: true, processes: false, details: false });
        setCreateModal(true);
    }

    function toggleSection(section: keyof typeof expandedSections) {
        setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
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

    // Calculate assignment stats
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

            {/* ========== CREATE MODAL - COMPLETE REDESIGN ========== */}
            <Modal
                isOpen={createModal}
                onClose={() => setCreateModal(false)}
                title="Novi Radni Nalog"
                size="fullscreen"
                footer={null}
            >
                <div className="wo-creator">
                    {/* Progress Header */}
                    <div className="wo-progress-header">
                        <div className="progress-steps">
                            {progressSteps.map((step, idx) => (
                                <div key={step.id} className={`progress-step ${step.done ? 'done' : ''}`}>
                                    <div className="step-indicator">
                                        {step.done ? (
                                            <span className="material-icons-round">check</span>
                                        ) : (
                                            <span>{idx + 1}</span>
                                        )}
                                    </div>
                                    <span className="step-label">{step.label}</span>
                                </div>
                            ))}
                        </div>
                        <div className="progress-bar">
                            <div className="progress-fill" style={{ width: `${(completedSteps / 4) * 100}%` }} />
                        </div>
                    </div>

                    {/* Main Content Area */}
                    <div className="wo-main-content">
                        {/* Left Column - Selection */}
                        <div className="wo-selection-panel">
                            {/* Section: Projects */}
                            <div className={`wo-section ${expandedSections.projects ? 'expanded' : ''}`}>
                                <button className="section-toggle" onClick={() => toggleSection('projects')}>
                                    <div className="section-title">
                                        <span className="material-icons-round">folder</span>
                                        <span>Projekti</span>
                                        {selectedProjectIds.length > 0 && (
                                            <span className="count-badge">{selectedProjectIds.length}</span>
                                        )}
                                    </div>
                                    <span className="material-icons-round chevron">
                                        {expandedSections.projects ? 'expand_less' : 'expand_more'}
                                    </span>
                                </button>
                                {expandedSections.projects && (
                                    <div className="section-content">
                                        <div className="projects-grid">
                                            {projects.map(project => {
                                                const isSelected = selectedProjectIds.includes(project.Project_ID);
                                                const productCount = (project.products || []).length;
                                                return (
                                                    <div
                                                        key={project.Project_ID}
                                                        className={`project-card ${isSelected ? 'selected' : ''}`}
                                                        onClick={() => toggleProjectSelection(project.Project_ID)}
                                                    >
                                                        <div className="project-check">
                                                            <span className="material-icons-round">
                                                                {isSelected ? 'check_circle' : 'radio_button_unchecked'}
                                                            </span>
                                                        </div>
                                                        <div className="project-info">
                                                            <div className="project-name">{project.Client_Name}</div>
                                                            <div className="project-meta">{productCount} proizvoda</div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                        {selectedProjectIds.length > 0 && (
                                            <button className="clear-all-btn" onClick={() => {
                                                setSelectedProjectIds([]);
                                                setSelectedProducts([]);
                                            }}>
                                                <span className="material-icons-round">close</span>
                                                Poništi odabir
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Section: Products */}
                            <div className={`wo-section ${expandedSections.products ? 'expanded' : ''}`}>
                                <button className="section-toggle" onClick={() => toggleSection('products')}>
                                    <div className="section-title">
                                        <span className="material-icons-round">inventory_2</span>
                                        <span>Proizvodi</span>
                                        {selectedProducts.length > 0 && (
                                            <span className="count-badge">{selectedProducts.length}</span>
                                        )}
                                    </div>
                                    <span className="material-icons-round chevron">
                                        {expandedSections.products ? 'expand_less' : 'expand_more'}
                                    </span>
                                </button>
                                {expandedSections.products && (
                                    <div className="section-content">
                                        {selectedProjectIds.length === 0 ? (
                                            <div className="empty-section">
                                                <span className="material-icons-round">arrow_upward</span>
                                                <p>Prvo odaberite projekat</p>
                                            </div>
                                        ) : (
                                            <>
                                                <div className="products-toolbar">
                                                    <div className="search-input">
                                                        <span className="material-icons-round">search</span>
                                                        <input
                                                            type="text"
                                                            placeholder="Pretraži proizvode..."
                                                            value={productSearch}
                                                            onChange={(e) => setProductSearch(e.target.value)}
                                                        />
                                                        {productSearch && (
                                                            <button onClick={() => setProductSearch('')}>
                                                                <span className="material-icons-round">close</span>
                                                            </button>
                                                        )}
                                                    </div>
                                                    <button className="select-all-btn" onClick={selectAllProducts}>
                                                        Odaberi sve ({eligibleProducts.length})
                                                    </button>
                                                </div>
                                                <div className="products-list">
                                                    {eligibleProducts.map(product => {
                                                        const isSelected = selectedProducts.some(p => p.Product_ID === product.Product_ID);
                                                        return (
                                                            <div
                                                                key={product.Product_ID}
                                                                className={`product-row ${isSelected ? 'selected' : ''}`}
                                                                onClick={() => toggleProduct(product)}
                                                            >
                                                                <span className="material-icons-round checkbox">
                                                                    {isSelected ? 'check_box' : 'check_box_outline_blank'}
                                                                </span>
                                                                <div className="product-details">
                                                                    <div className="product-name">{product.Product_Name}</div>
                                                                    <div className="product-project">{product.Project_Name}</div>
                                                                </div>
                                                                <div className="product-qty">×{product.Quantity}</div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Section: Processes */}
                            <div className={`wo-section ${expandedSections.processes ? 'expanded' : ''}`}>
                                <button className="section-toggle" onClick={() => toggleSection('processes')}>
                                    <div className="section-title">
                                        <span className="material-icons-round">engineering</span>
                                        <span>Procesi</span>
                                        <span className="count-badge">{selectedProcesses.length}</span>
                                    </div>
                                    <span className="material-icons-round chevron">
                                        {expandedSections.processes ? 'expand_less' : 'expand_more'}
                                    </span>
                                </button>
                                {expandedSections.processes && (
                                    <div className="section-content">
                                        <div className="processes-chips">
                                            {selectedProcesses.map(proc => (
                                                <div key={proc} className="process-chip">
                                                    <span>{proc}</span>
                                                    <button onClick={() => toggleProcess(proc)}>
                                                        <span className="material-icons-round">close</span>
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                        <div className="add-process-row">
                                            <input
                                                type="text"
                                                placeholder="Novi proces..."
                                                value={customProcessInput}
                                                onChange={(e) => setCustomProcessInput(e.target.value)}
                                                onKeyPress={(e) => e.key === 'Enter' && addCustomProcess()}
                                            />
                                            <button onClick={addCustomProcess}>
                                                <span className="material-icons-round">add</span>
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Section: Details */}
                            <div className={`wo-section ${expandedSections.details ? 'expanded' : ''}`}>
                                <button className="section-toggle" onClick={() => toggleSection('details')}>
                                    <div className="section-title">
                                        <span className="material-icons-round">info</span>
                                        <span>Detalji</span>
                                    </div>
                                    <span className="material-icons-round chevron">
                                        {expandedSections.details ? 'expand_less' : 'expand_more'}
                                    </span>
                                </button>
                                {expandedSections.details && (
                                    <div className="section-content">
                                        <div className="form-row">
                                            <label>Rok završetka</label>
                                            <input
                                                type="date"
                                                value={dueDate}
                                                onChange={(e) => setDueDate(e.target.value)}
                                            />
                                        </div>
                                        <div className="form-row">
                                            <label>Napomena</label>
                                            <textarea
                                                rows={3}
                                                value={notes}
                                                onChange={(e) => setNotes(e.target.value)}
                                                placeholder="Opciona napomena..."
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Right Column - Worker Assignments */}
                        <div className="wo-assignments-panel">
                            <div className="assignments-header">
                                <div>
                                    <h3>Dodjela radnika</h3>
                                    <p className="assignments-stats">
                                        {filledAssignments} / {totalAssignments} dodijeljeno
                                    </p>
                                </div>
                                {selectedProducts.length > 0 && (
                                    <select
                                        className="bulk-assign-select"
                                        onChange={(e) => e.target.value && assignOneWorkerToAll(e.target.value)}
                                        value=""
                                    >
                                        <option value="">Dodijeli jednog radnika svima...</option>
                                        {workers.map(w => (
                                            <option key={w.Worker_ID} value={w.Worker_ID}>{w.Name}</option>
                                        ))}
                                    </select>
                                )}
                            </div>

                            {selectedProducts.length === 0 ? (
                                <div className="assignments-empty">
                                    <span className="material-icons-round">group_add</span>
                                    <h4>Nema odabranih proizvoda</h4>
                                    <p>Odaberite projekte i proizvode sa lijeve strane da biste mogli dodijeliti radnike.</p>
                                </div>
                            ) : (
                                <div className="assignments-matrix">
                                    {/* Matrix Header */}
                                    <div className="matrix-header">
                                        <div className="matrix-corner">Proizvod</div>
                                        {selectedProcesses.map(proc => (
                                            <div key={proc} className="matrix-process-header">
                                                <span>{proc}</span>
                                                <select
                                                    className="header-assign"
                                                    onChange={(e) => e.target.value && assignWorkerToAll(proc, e.target.value)}
                                                    value=""
                                                    title={`Dodijeli svima za ${proc}`}
                                                >
                                                    <option value="">—</option>
                                                    {workers.map(w => (
                                                        <option key={w.Worker_ID} value={w.Worker_ID}>{w.Name}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        ))}
                                    </div>

                                    {/* Matrix Rows */}
                                    <div className="matrix-body">
                                        {selectedProducts.map(product => (
                                            <div key={product.Product_ID} className="matrix-row">
                                                <div className="matrix-product-cell">
                                                    <div className="product-info">
                                                        <span className="product-name">{product.Product_Name}</span>
                                                        <span className="product-project">{product.Project_Name}</span>
                                                    </div>
                                                    <div className="product-actions">
                                                        <select
                                                            className="row-assign"
                                                            onChange={(e) => e.target.value && assignWorkerToProduct(product.Product_ID, e.target.value)}
                                                            value=""
                                                            title="Dodijeli jednog radnika svim procesima"
                                                        >
                                                            <option value="">Svi</option>
                                                            {workers.map(w => (
                                                                <option key={w.Worker_ID} value={w.Worker_ID}>{w.Name}</option>
                                                            ))}
                                                        </select>
                                                        <button
                                                            className="remove-btn"
                                                            onClick={() => toggleProduct(product)}
                                                            title="Ukloni proizvod"
                                                        >
                                                            <span className="material-icons-round">close</span>
                                                        </button>
                                                    </div>
                                                </div>
                                                {selectedProcesses.map(proc => (
                                                    <div key={proc} className="matrix-cell">
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
                    </div>

                    {/* Footer */}
                    <div className="wo-footer">
                        <div className="footer-summary">
                            <span className="summary-item">
                                <span className="material-icons-round">folder</span>
                                {selectedProjectIds.length} projekata
                            </span>
                            <span className="summary-item">
                                <span className="material-icons-round">inventory_2</span>
                                {selectedProducts.length} proizvoda
                            </span>
                            <span className="summary-item">
                                <span className="material-icons-round">engineering</span>
                                {selectedProcesses.length} procesa
                            </span>
                        </div>
                        <div className="footer-actions">
                            <button className="btn-cancel" onClick={() => setCreateModal(false)}>
                                Odustani
                            </button>
                            <button
                                className="btn-create"
                                onClick={handleCreateWorkOrder}
                                disabled={selectedProducts.length === 0 || selectedProcesses.length === 0}
                            >
                                <span className="material-icons-round">add_task</span>
                                Kreiraj radni nalog
                            </button>
                        </div>
                    </div>
                </div>
            </Modal>

            {/* View Modal */}
            <Modal isOpen={viewModal} onClose={() => setViewModal(false)} title={currentWorkOrder?.Work_Order_Number || ''} size="large">
                {currentWorkOrder && (
                    <div>
                        <p>Procesi: {currentWorkOrder.Production_Steps?.join(' → ')}</p>
                        <p>Proizvoda: {currentWorkOrder.items?.length || 0}</p>
                    </div>
                )}
            </Modal>

            <style jsx>{`
                .orders-sections {
                    display: flex;
                    flex-direction: column;
                    gap: 24px;
                }

                /* ========== WORK ORDER CREATOR STYLES ========== */
                .wo-creator {
                    display: flex;
                    flex-direction: column;
                    height: 100%;
                    background: var(--surface);
                }

                /* Progress Header */
                .wo-progress-header {
                    padding: 16px 24px;
                    background: var(--surface-hover);
                    border-bottom: 1px solid var(--border);
                }

                .progress-steps {
                    display: flex;
                    justify-content: center;
                    gap: 48px;
                    margin-bottom: 12px;
                }

                .progress-step {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 6px;
                }

                .step-indicator {
                    width: 32px;
                    height: 32px;
                    border-radius: 50%;
                    background: var(--border);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 14px;
                    font-weight: 600;
                    color: var(--text-secondary);
                    transition: all 0.3s;
                }

                .progress-step.done .step-indicator {
                    background: var(--accent);
                    color: white;
                }

                .step-label {
                    font-size: 12px;
                    color: var(--text-secondary);
                    font-weight: 500;
                }

                .progress-step.done .step-label {
                    color: var(--accent);
                }

                .progress-bar {
                    height: 4px;
                    background: var(--border);
                    border-radius: 2px;
                    overflow: hidden;
                }

                .progress-fill {
                    height: 100%;
                    background: linear-gradient(90deg, var(--accent), #34c759);
                    border-radius: 2px;
                    transition: width 0.4s ease;
                }

                /* Main Content */
                .wo-main-content {
                    flex: 1;
                    display: grid;
                    grid-template-columns: 380px 1fr;
                    overflow: hidden;
                }

                /* Selection Panel */
                .wo-selection-panel {
                    background: var(--surface-hover);
                    border-right: 1px solid var(--border);
                    overflow-y: auto;
                }

                .wo-section {
                    border-bottom: 1px solid var(--border);
                }

                .section-toggle {
                    width: 100%;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 14px 20px;
                    background: none;
                    border: none;
                    cursor: pointer;
                    transition: background 0.2s;
                }

                .section-toggle:hover {
                    background: rgba(0, 0, 0, 0.03);
                }

                .section-title {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    font-size: 14px;
                    font-weight: 600;
                }

                .section-title .material-icons-round {
                    font-size: 20px;
                    color: var(--accent);
                }

                .count-badge {
                    background: var(--accent);
                    color: white;
                    font-size: 11px;
                    padding: 2px 8px;
                    border-radius: 10px;
                    font-weight: 600;
                }

                .chevron {
                    color: var(--text-secondary);
                    transition: transform 0.2s;
                }

                .wo-section.expanded .chevron {
                    transform: rotate(180deg);
                }

                .section-content {
                    padding: 0 20px 20px 20px;
                }

                /* Projects Grid */
                .projects-grid {
                    display: grid;
                    grid-template-columns: repeat(2, 1fr);
                    gap: 10px;
                }

                .project-card {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 12px;
                    background: var(--surface);
                    border: 1px solid var(--border);
                    border-radius: 10px;
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .project-card:hover {
                    border-color: var(--accent);
                }

                .project-card.selected {
                    border-color: var(--accent);
                    background: rgba(0, 113, 227, 0.08);
                }

                .project-card.selected .project-check .material-icons-round {
                    color: var(--accent);
                }

                .project-name {
                    font-size: 13px;
                    font-weight: 600;
                }

                .project-meta {
                    font-size: 11px;
                    color: var(--text-secondary);
                }

                .clear-all-btn {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    margin-top: 12px;
                    padding: 8px 12px;
                    background: none;
                    border: 1px solid var(--border);
                    border-radius: 6px;
                    color: var(--text-secondary);
                    font-size: 12px;
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .clear-all-btn:hover {
                    border-color: var(--danger);
                    color: var(--danger);
                }

                /* Products */
                .empty-section {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    padding: 32px;
                    color: var(--text-secondary);
                    text-align: center;
                }

                .empty-section .material-icons-round {
                    font-size: 32px;
                    opacity: 0.4;
                    margin-bottom: 8px;
                }

                .products-toolbar {
                    display: flex;
                    gap: 10px;
                    margin-bottom: 12px;
                }

                .search-input {
                    flex: 1;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 8px 12px;
                    background: var(--surface);
                    border: 1px solid var(--border);
                    border-radius: 8px;
                }

                .search-input input {
                    flex: 1;
                    border: none;
                    background: none;
                    outline: none;
                    font-size: 13px;
                }

                .search-input button {
                    background: none;
                    border: none;
                    padding: 0;
                    cursor: pointer;
                    color: var(--text-secondary);
                }

                .select-all-btn {
                    padding: 8px 12px;
                    background: var(--accent);
                    color: white;
                    border: none;
                    border-radius: 8px;
                    font-size: 12px;
                    font-weight: 500;
                    cursor: pointer;
                    white-space: nowrap;
                }

                .products-list {
                    max-height: 280px;
                    overflow-y: auto;
                    border: 1px solid var(--border);
                    border-radius: 8px;
                    background: var(--surface);
                }

                .product-row {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 10px 12px;
                    border-bottom: 1px solid var(--border);
                    cursor: pointer;
                    transition: background 0.15s;
                }

                .product-row:last-child {
                    border-bottom: none;
                }

                .product-row:hover {
                    background: var(--surface-hover);
                }

                .product-row.selected {
                    background: rgba(0, 113, 227, 0.05);
                }

                .product-row .checkbox {
                    font-size: 20px;
                    color: var(--text-secondary);
                }

                .product-row.selected .checkbox {
                    color: var(--accent);
                }

                .product-details {
                    flex: 1;
                    min-width: 0;
                }

                .product-details .product-name {
                    font-size: 13px;
                    font-weight: 500;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                .product-details .product-project {
                    font-size: 11px;
                    color: var(--text-secondary);
                }

                .product-qty {
                    font-size: 12px;
                    color: var(--text-secondary);
                    font-weight: 500;
                }

                /* Processes */
                .processes-chips {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 8px;
                    margin-bottom: 12px;
                }

                .process-chip {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    padding: 6px 10px;
                    background: var(--accent);
                    color: white;
                    border-radius: 20px;
                    font-size: 12px;
                    font-weight: 500;
                }

                .process-chip button {
                    background: none;
                    border: none;
                    color: white;
                    opacity: 0.7;
                    cursor: pointer;
                    padding: 0;
                    display: flex;
                }

                .process-chip button:hover {
                    opacity: 1;
                }

                .add-process-row {
                    display: flex;
                    gap: 8px;
                }

                .add-process-row input {
                    flex: 1;
                    padding: 10px 12px;
                    border: 1px solid var(--border);
                    border-radius: 8px;
                    background: var(--surface);
                    font-size: 13px;
                }

                .add-process-row button {
                    width: 40px;
                    background: var(--accent);
                    color: white;
                    border: none;
                    border-radius: 8px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }

                /* Form Fields */
                .form-row {
                    margin-bottom: 16px;
                }

                .form-row:last-child {
                    margin-bottom: 0;
                }

                .form-row label {
                    display: block;
                    margin-bottom: 6px;
                    font-size: 13px;
                    font-weight: 500;
                }

                .form-row input,
                .form-row textarea {
                    width: 100%;
                    padding: 10px 12px;
                    border: 1px solid var(--border);
                    border-radius: 8px;
                    background: var(--surface);
                    font-size: 14px;
                    font-family: inherit;
                }

                /* Assignments Panel */
                .wo-assignments-panel {
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                    padding: 20px;
                }

                .assignments-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 16px;
                    padding-bottom: 16px;
                    border-bottom: 1px solid var(--border);
                }

                .assignments-header h3 {
                    margin: 0 0 4px 0;
                    font-size: 18px;
                }

                .assignments-stats {
                    font-size: 13px;
                    color: var(--text-secondary);
                }

                .bulk-assign-select {
                    padding: 8px 12px;
                    border: 1px solid var(--accent);
                    border-radius: 8px;
                    background: var(--surface);
                    color: var(--accent);
                    font-size: 13px;
                    cursor: pointer;
                }

                .assignments-empty {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    text-align: center;
                    color: var(--text-secondary);
                }

                .assignments-empty .material-icons-round {
                    font-size: 64px;
                    opacity: 0.3;
                    margin-bottom: 16px;
                }

                .assignments-empty h4 {
                    margin: 0 0 8px 0;
                    font-size: 16px;
                    color: var(--text-primary);
                }

                /* Matrix View */
                .assignments-matrix {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    border: 1px solid var(--border);
                    border-radius: 12px;
                    overflow: hidden;
                }

                .matrix-header {
                    display: flex;
                    background: var(--surface-hover);
                    border-bottom: 1px solid var(--border);
                    position: sticky;
                    top: 0;
                    z-index: 10;
                }

                .matrix-corner {
                    min-width: 200px;
                    padding: 12px 16px;
                    font-size: 12px;
                    font-weight: 600;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                    color: var(--text-secondary);
                    border-right: 1px solid var(--border);
                }

                .matrix-process-header {
                    flex: 1;
                    min-width: 120px;
                    padding: 8px 12px;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 6px;
                    border-right: 1px solid var(--border);
                }

                .matrix-process-header:last-child {
                    border-right: none;
                }

                .matrix-process-header span {
                    font-size: 12px;
                    font-weight: 600;
                }

                .header-assign {
                    width: 100%;
                    padding: 4px;
                    border: 1px solid var(--border);
                    border-radius: 4px;
                    font-size: 10px;
                    background: var(--surface);
                    cursor: pointer;
                }

                .matrix-body {
                    flex: 1;
                    overflow-y: auto;
                }

                .matrix-row {
                    display: flex;
                    border-bottom: 1px solid var(--border);
                }

                .matrix-row:last-child {
                    border-bottom: none;
                }

                .matrix-row:hover {
                    background: rgba(0, 113, 227, 0.02);
                }

                .matrix-product-cell {
                    min-width: 200px;
                    padding: 10px 12px;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 8px;
                    border-right: 1px solid var(--border);
                    background: var(--surface);
                }

                .matrix-product-cell .product-info {
                    flex: 1;
                    min-width: 0;
                }

                .matrix-product-cell .product-name {
                    font-size: 13px;
                    font-weight: 500;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    display: block;
                }

                .matrix-product-cell .product-project {
                    font-size: 10px;
                    color: var(--text-secondary);
                }

                .product-actions {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                }

                .row-assign {
                    padding: 4px;
                    border: 1px solid var(--border);
                    border-radius: 4px;
                    font-size: 10px;
                    background: var(--surface-hover);
                    cursor: pointer;
                }

                .remove-btn {
                    background: none;
                    border: none;
                    color: var(--text-secondary);
                    cursor: pointer;
                    padding: 2px;
                    display: flex;
                }

                .remove-btn:hover {
                    color: var(--danger);
                }

                .matrix-cell {
                    flex: 1;
                    min-width: 120px;
                    padding: 8px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    border-right: 1px solid var(--border);
                }

                .matrix-cell:last-child {
                    border-right: none;
                }

                .matrix-cell select {
                    width: 100%;
                    padding: 6px 8px;
                    border: 1px solid var(--border);
                    border-radius: 6px;
                    font-size: 12px;
                    background: var(--surface);
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .matrix-cell select.assigned {
                    background: rgba(52, 199, 89, 0.1);
                    border-color: var(--success);
                }

                /* Footer */
                .wo-footer {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 16px 24px;
                    background: var(--surface);
                    border-top: 1px solid var(--border);
                }

                .footer-summary {
                    display: flex;
                    gap: 24px;
                }

                .summary-item {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    font-size: 13px;
                    color: var(--text-secondary);
                }

                .summary-item .material-icons-round {
                    font-size: 18px;
                }

                .footer-actions {
                    display: flex;
                    gap: 12px;
                }

                .btn-cancel {
                    padding: 10px 20px;
                    background: none;
                    border: 1px solid var(--border);
                    border-radius: 8px;
                    font-size: 14px;
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .btn-cancel:hover {
                    border-color: var(--text-secondary);
                }

                .btn-create {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 10px 24px;
                    background: var(--accent);
                    color: white;
                    border: none;
                    border-radius: 8px;
                    font-size: 14px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .btn-create:hover:not(:disabled) {
                    background: #005bb5;
                }

                .btn-create:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }

                /* ========== RESPONSIVE BREAKPOINTS ========== */
                
                /* Tablet */
                @media (max-width: 1200px) {
                    .wo-main-content {
                        grid-template-columns: 320px 1fr;
                    }

                    .projects-grid {
                        grid-template-columns: 1fr;
                    }

                    .matrix-corner {
                        min-width: 160px;
                    }

                    .matrix-process-header,
                    .matrix-cell {
                        min-width: 100px;
                    }
                }

                /* Tablet Portrait & Large Mobile */
                @media (max-width: 900px) {
                    .wo-main-content {
                        grid-template-columns: 1fr;
                        grid-template-rows: auto 1fr;
                    }

                    .wo-selection-panel {
                        border-right: none;
                        border-bottom: 1px solid var(--border);
                        max-height: 40vh;
                    }

                    .progress-steps {
                        gap: 24px;
                    }

                    .step-label {
                        display: none;
                    }

                    .footer-summary {
                        display: none;
                    }
                }

                /* Mobile */
                @media (max-width: 600px) {
                    .wo-progress-header {
                        padding: 12px 16px;
                    }

                    .progress-steps {
                        gap: 16px;
                    }

                    .step-indicator {
                        width: 28px;
                        height: 28px;
                        font-size: 12px;
                    }

                    .section-toggle {
                        padding: 12px 16px;
                    }

                    .section-content {
                        padding: 0 16px 16px 16px;
                    }

                    .wo-assignments-panel {
                        padding: 16px;
                    }

                    .assignments-header {
                        flex-direction: column;
                        align-items: flex-start;
                        gap: 12px;
                    }

                    .bulk-assign-select {
                        width: 100%;
                    }

                    .matrix-corner {
                        min-width: 120px;
                        font-size: 10px;
                    }

                    .matrix-process-header,
                    .matrix-cell {
                        min-width: 80px;
                    }

                    .wo-footer {
                        padding: 12px 16px;
                    }

                    .footer-actions {
                        flex: 1;
                    }

                    .btn-cancel {
                        flex: 1;
                        padding: 10px 12px;
                    }

                    .btn-create {
                        flex: 2;
                        padding: 10px 16px;
                        justify-content: center;
                    }
                }
            `}</style>
        </div>
    );
}

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
