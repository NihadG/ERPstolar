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
    assignments: Record<string, string>; // process -> worker_id
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
            // If projects are selected, only show products from those projects
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
        setCreateModal(true);
    }

    function toggleProcess(process: string) {
        if (selectedProcesses.includes(process)) {
            const newProcesses = selectedProcesses.filter(p => p !== process);
            setSelectedProcesses(newProcesses);
            // Remove assignment from products
            setSelectedProducts(selectedProducts.map(p => {
                const newAssignments = { ...p.assignments };
                delete newAssignments[process];
                return { ...p, assignments: newAssignments };
            }));
        } else {
            setSelectedProcesses([...selectedProcesses, process]);
            // Add empty assignment to products
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
        // Add to products
        setSelectedProducts(selectedProducts.map(p => ({
            ...p,
            assignments: { ...p.assignments, [proc]: '' }
        })));
        setCustomProcessInput('');
    }

    function toggleProjectSelection(projectId: string) {
        if (selectedProjectIds.includes(projectId)) {
            setSelectedProjectIds(selectedProjectIds.filter(id => id !== projectId));
            // Also remove products belonging to this project from selection
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
        showToast(`${worker?.Name} dodijeljen svim procesima proizvoda ${product?.Product_Name}`, 'success');
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

            {/* Create Modal - NEW LAYOUT */}
            <Modal
                isOpen={createModal}
                onClose={() => setCreateModal(false)}
                title="Novi Radni Nalog"
                size="fullscreen"
                footer={null}
            >
                <div className="create-layout">
                    {/* Sidebar */}
                    <div className="sidebar">
                        {/* Step 1: Projects */}
                        <div className="sidebar-section">
                            <div className="section-header">
                                <h4>1. Odaberi Projekte ({selectedProjectIds.length})</h4>
                                {selectedProjectIds.length > 0 && (
                                    <button className="link-btn" onClick={() => {
                                        setSelectedProjectIds([]);
                                        setSelectedProducts([]);
                                    }}>Očisti</button>
                                )}
                            </div>
                            <div className="projects-selection-list">
                                {projects.map(project => {
                                    const isSelected = selectedProjectIds.includes(project.Project_ID);
                                    return (
                                        <div
                                            key={project.Project_ID}
                                            className={`project-selection-item ${isSelected ? 'active' : ''}`}
                                            onClick={() => toggleProjectSelection(project.Project_ID)}
                                        >
                                            <span className="material-icons-round">
                                                {isSelected ? 'check_circle' : 'radio_button_unchecked'}
                                            </span>
                                            <div className="project-info">
                                                <div className="project-name">{project.Client_Name}</div>
                                                <div className="project-count">{(project.products || []).length} proizvoda</div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Step 2: Products */}
                        <div className="sidebar-section products-section">
                            <div className="section-header">
                                <h4>2. Odaberi Proizvode ({selectedProducts.length})</h4>
                                {eligibleProducts.length > 0 && (
                                    <button className="link-btn" onClick={selectAllProducts}>Odaberi sve</button>
                                )}
                            </div>

                            <div className="search-input-wrapper">
                                <span className="material-icons-round">search</span>
                                <input
                                    type="text"
                                    placeholder="Pretraži proizvode..."
                                    value={productSearch}
                                    onChange={(e) => setProductSearch(e.target.value)}
                                    className="search-input"
                                />
                                {productSearch && (
                                    <button className="clear-btn" onClick={() => setProductSearch('')}>
                                        <span className="material-icons-round">close</span>
                                    </button>
                                )}
                            </div>

                            <div className="products-list">
                                {selectedProjectIds.length === 0 ? (
                                    <div className="empty-message">Prvo odaberi projekat</div>
                                ) : eligibleProducts.length === 0 ? (
                                    <div className="empty-message">Nema dostupnih proizvoda</div>
                                ) : (
                                    eligibleProducts.map(product => {
                                        const isSelected = selectedProducts.some(p => p.Product_ID === product.Product_ID);
                                        return (
                                            <div
                                                key={product.Product_ID}
                                                className={`product-item ${isSelected ? 'selected' : ''}`}
                                                onClick={() => toggleProduct(product)}
                                            >
                                                <span className="material-icons-round checkbox">
                                                    {isSelected ? 'check_box' : 'check_box_outline_blank'}
                                                </span>
                                                <div className="product-content">
                                                    <div className="product-name">{product.Product_Name}</div>
                                                    <div className="product-meta">{product.Project_Name} • {product.Status}</div>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </div>

                        {/* Step 3: Processes */}
                        <div className="sidebar-section">
                            <h4>3. Proizvodni Procesi</h4>
                            <div className="process-pills">
                                {selectedProcesses.map(proc => (
                                    <div key={proc} className="process-pill active">
                                        <span className="material-icons-round">
                                            {proc === 'Rezanje' ? 'content_cut' : proc === 'Kantiranje' ? 'border_style' : proc === 'Bušenje' ? 'architecture' : proc === 'Sklapanje' ? 'handyman' : 'settings'}
                                        </span>
                                        {proc}
                                        <button className="remove-proc" onClick={() => toggleProcess(proc)}>
                                            <span className="material-icons-round">close</span>
                                        </button>
                                    </div>
                                ))}

                                <div className="add-custom-process">
                                    <input
                                        type="text"
                                        placeholder="Dodaj novi proces..."
                                        value={customProcessInput}
                                        onChange={(e) => setCustomProcessInput(e.target.value)}
                                        onKeyPress={(e) => e.key === 'Enter' && addCustomProcess()}
                                    />
                                    <button onClick={addCustomProcess}>
                                        <span className="material-icons-round">add</span>
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Options */}
                        <div className="sidebar-section">
                            <h4>Opcije</h4>
                            <div className="form-field">
                                <label>Rok završetka</label>
                                <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                            </div>
                            <div className="form-field">
                                <label>Napomena</label>
                                <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opciona napomena..." />
                            </div>
                        </div>
                    </div>

                    {/* Main Area - Assignments */}
                    <div className="main-area">
                        <div className="assignments-header">
                            <div className="header-info">
                                <h3>Dodjela radnika</h3>
                                <p className="subtitle">{selectedProducts.length} proizvoda × {selectedProcesses.length} procesa</p>
                            </div>

                            {selectedProducts.length > 0 && (
                                <div className="header-actions">
                                    <select
                                        className="global-assign"
                                        onChange={(e) => {
                                            if (e.target.value) {
                                                selectedProcesses.forEach(proc => assignWorkerToAll(proc, e.target.value));
                                            }
                                        }}
                                        value=""
                                    >
                                        <option value="">Dodijeli sve svima...</option>
                                        {workers.map(w => (
                                            <option key={w.Worker_ID} value={w.Worker_ID}>{w.Name}</option>
                                        ))}
                                    </select>
                                </div>
                            )}
                        </div>

                        {selectedProducts.length === 0 ? (
                            <div className="empty-assignments">
                                <span className="material-icons-round">person_add</span>
                                <p>Odaberi projekte i proizvode sa lijeve strane</p>
                                <div className="hint">Prvo izaberi projekat, pa onda proizvode.</div>
                            </div>
                        ) : (
                            <div className="assignments-grid">
                                {selectedProducts.map(product => (
                                    <div key={product.Product_ID} className="product-assignment-card">
                                        <div className="card-header">
                                            <div className="product-title">
                                                <strong>{product.Product_Name}</strong>
                                                <span className="project-badge">{product.Project_Name}</span>
                                            </div>
                                            <div className="card-actions">
                                                <select
                                                    className="quick-assign"
                                                    onChange={(e) => e.target.value && assignWorkerToProduct(product.Product_ID, e.target.value)}
                                                    value=""
                                                >
                                                    <option value="">Svi procesi...</option>
                                                    {workers.map(w => (
                                                        <option key={w.Worker_ID} value={w.Worker_ID}>{w.Name}</option>
                                                    ))}
                                                </select>
                                                <button className="remove-product" onClick={() => toggleProduct(product)}>
                                                    <span className="material-icons-round">close</span>
                                                </button>
                                            </div>
                                        </div>
                                        <div className="process-assignments">
                                            {selectedProcesses.map(proc => (
                                                <div key={proc} className="process-row">
                                                    <div className="process-label">
                                                        <span className="material-icons-round">
                                                            {proc === 'Rezanje' ? 'content_cut' : proc === 'Kantiranje' ? 'border_style' : proc === 'Bušenje' ? 'architecture' : proc === 'Sklapanje' ? 'handyman' : 'settings'}
                                                        </span>
                                                        <span className="name">{proc}</span>
                                                    </div>
                                                    <div className="worker-selection-wrapper">
                                                        <select
                                                            value={product.assignments[proc] || ''}
                                                            onChange={(e) => assignWorker(product.Product_ID, proc, e.target.value)}
                                                            className={`worker-select ${product.assignments[proc] ? 'assigned' : ''}`}
                                                        >
                                                            <option value="">Odaberi radnika</option>
                                                            {workers.map(w => (
                                                                <option key={w.Worker_ID} value={w.Worker_ID}>{w.Name}</option>
                                                            ))}
                                                        </select>
                                                        {product.assignments[proc] && (
                                                            <span className="check-mark material-icons-round">check_circle</span>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Footer */}
                    <div className="create-footer">
                        <div className="footer-left">
                            {selectedProducts.length > 0 && (
                                <button className="btn btn-ghost" onClick={() => setSelectedProducts([])}>
                                    Očisti sve proizvode
                                </button>
                            )}
                        </div>
                        <div className="footer-right">
                            <button className="btn btn-secondary" onClick={() => setCreateModal(false)}>Odustani</button>
                            <button
                                className="btn btn-primary btn-lg"
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

                /* CREATE MODAL LAYOUT */
                .create-layout {
                    display: grid;
                    grid-template-columns: 360px 1fr;
                    grid-template-rows: 1fr auto;
                    height: 100%;
                    gap: 0;
                }

                .sidebar {
                    grid-row: 1 / 2;
                    background: var(--surface-hover);
                    border-right: 1px solid var(--border);
                    overflow-y: auto;
                    display: flex;
                    flex-direction: column;
                }

                .sidebar-section {
                    padding: 20px;
                    border-bottom: 1px solid var(--border);
                }

                .sidebar-section h4 {
                    margin: 0 0 16px 0;
                    font-size: 14px;
                    font-weight: 600;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                    color: var(--text-secondary);
                }

                .process-pills {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }

                .process-pill {
                    position: relative;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 12px 16px;
                    border: 2px solid var(--border);
                    border-radius: 10px;
                    background: var(--surface);
                    cursor: pointer;
                    transition: all 0.2s;
                    font-weight: 500;
                    font-size: 14px;
                }

                .process-pill:hover {
                    border-color: var(--accent);
                }

                .process-pill.active {
                    border-color: var(--accent);
                    background: var(--accent);
                    color: white;
                }

                .process-pill .material-icons-round {
                    font-size: 20px;
                }

                .process-pill .check {
                    margin-left: auto;
                    font-size: 18px;
                }

                .products-section {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    min-height: 0;
                }

                .section-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 16px;
                }

                .link-btn {
                    background: none;
                    border: none;
                    color: var(--accent);
                    cursor: pointer;
                    font-size: 13px;
                    font-weight: 500;
                }

                .link-btn:hover {
                    text-decoration: underline;
                }

                .filter-controls {
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                    margin-bottom: 12px;
                }

                .projects-selection-list {
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                    max-height: 200px;
                    overflow-y: auto;
                    padding-right: 4px;
                }

                .project-selection-item {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 8px 12px;
                    background: var(--surface);
                    border: 1px solid var(--border);
                    border-radius: 8px;
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .project-selection-item:hover {
                    border-color: var(--accent);
                }

                .project-selection-item.active {
                    background: rgba(0, 113, 227, 0.08);
                    border-color: var(--accent);
                }

                .project-selection-item.active .material-icons-round {
                    color: var(--accent);
                }

                .project-info {
                    flex: 1;
                    min-width: 0;
                }

                .project-info .project-name {
                    font-weight: 500;
                    font-size: 13px;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                .project-info .project-count {
                    font-size: 11px;
                    color: var(--text-secondary);
                }

                .add-custom-process {
                    display: flex;
                    gap: 8px;
                    margin-top: 8px;
                }

                .add-custom-process input {
                    flex: 1;
                    padding: 8px 12px;
                    border: 1px solid var(--border);
                    border-radius: 6px;
                    font-size: 13px;
                    background: var(--surface);
                }

                .add-custom-process button {
                    background: var(--accent);
                    color: white;
                    border: none;
                    border-radius: 6px;
                    width: 34px;
                    height: 34px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                }

                .process-pill .remove-proc {
                    background: none;
                    border: none;
                    color: white;
                    opacity: 0.7;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    margin-left: 4px;
                    padding: 0;
                }

                .process-pill .remove-proc:hover {
                    opacity: 1;
                }

                .process-pill .remove-proc .material-icons-round {
                    font-size: 14px;
                }

                .search-input-wrapper {
                    position: relative;
                    display: flex;
                    align-items: center;
                    background: var(--surface);
                    border: 1px solid var(--border);
                    border-radius: 8px;
                    padding: 8px 12px;
                    transition: border-color 0.2s;
                    margin-bottom: 12px;
                }

                .search-input-wrapper:focus-within {
                    border-color: var(--accent);
                }

                .search-input-wrapper .material-icons-round {
                    font-size: 18px;
                    color: var(--text-secondary);
                    margin-right: 8px;
                }

                .search-input {
                    flex: 1;
                    border: none;
                    background: transparent;
                    outline: none;
                    font-size: 13px;
                    font-family: inherit;
                }

                .clear-btn {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: none;
                    border: none;
                    cursor: pointer;
                    padding: 2px;
                    color: var(--text-secondary);
                    transition: color 0.2s;
                }

                .clear-btn:hover {
                    color: var(--text-primary);
                }

                .clear-btn .material-icons-round {
                    font-size: 16px;
                }

                .project-filter {
                    width: 100%;
                    padding: 8px 12px;
                    border: 1px solid var(--border);
                    border-radius: 8px;
                    background: var(--surface);
                    font-size: 13px;
                    font-family: inherit;
                    cursor: pointer;
                    transition: border-color 0.2s;
                }

                .project-filter:focus {
                    outline: none;
                    border-color: var(--accent);
                }

                .products-list {
                    flex: 1;
                    overflow-y: auto;
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                    min-height: 0;
                }

                .product-item {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    padding: 10px 12px;
                    background: var(--surface);
                    border: 1px solid var(--border);
                    border-radius: 8px;
                    cursor: pointer;
                    transition: all 0.15s;
                }

                .product-item:hover {
                    border-color: var(--accent);
                }

                .product-item.selected {
                    border-color: var(--accent);
                    background: rgba(0, 113, 227, 0.08);
                }

                .product-item .checkbox {
                    font-size: 20px;
                    color: var(--text-secondary);
                }

                .product-item.selected .checkbox {
                    color: var(--accent);
                }

                .product-content {
                    flex: 1;
                    min-width: 0;
                }

                .product-name {
                    font-weight: 500;
                    font-size: 14px;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                .product-meta {
                    font-size: 12px;
                    color: var(--text-secondary);
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                .empty-message {
                    padding: 32px;
                    text-align: center;
                    color: var(--text-secondary);
                    font-size: 13px;
                }

                .form-field {
                    margin-bottom: 16px;
                }

                .form-field:last-child {
                    margin-bottom: 0;
                }

                .form-field label {
                    display: block;
                    margin-bottom: 6px;
                    font-size: 13px;
                    font-weight: 500;
                }

                .form-field input,
                .form-field textarea {
                    width: 100%;
                    padding: 10px 12px;
                    border: 1px solid var(--border);
                    border-radius: 8px;
                    background: var(--surface);
                    font-size: 14px;
                    font-family: inherit;
                }

                .form-field input:focus,
                .form-field textarea:focus {
                    outline: none;
                    border-color: var(--accent);
                }

                .form-field textarea {
                    resize: vertical;
                }

                .main-area {
                    grid-row: 1 / 2;
                    padding: 24px;
                    overflow-y: auto;
                }

                .assignments-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 24px;
                    padding-bottom: 20px;
                    border-bottom: 1px solid var(--border);
                }

                .assignments-header h3 {
                    margin: 0;
                    font-size: 20px;
                    font-weight: 600;
                }

                .assignments-header .subtitle {
                    margin: 4px 0 0 0;
                    color: var(--text-secondary);
                    font-size: 14px;
                }

                .global-assign {
                    padding: 8px 12px;
                    border: 1px solid var(--accent);
                    border-radius: 8px;
                    background: var(--surface);
                    color: var(--accent);
                    font-weight: 500;
                    cursor: pointer;
                }

                .empty-assignments {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    padding: 80px 20px;
                    color: var(--text-secondary);
                    text-align: center;
                }

                .empty-assignments .material-icons-round {
                    font-size: 64px;
                    opacity: 0.3;
                    margin-bottom: 16px;
                }

                .empty-assignments .hint {
                    font-size: 13px;
                    margin-top: 8px;
                    opacity: 0.7;
                }

                .assignments-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
                    gap: 20px;
                    padding-bottom: 40px;
                }

                .product-assignment-card {
                    background: var(--surface);
                    border: 1px solid var(--border);
                    border-radius: 12px;
                    padding: 0;
                    overflow: hidden;
                    display: flex;
                    flex-direction: column;
                    transition: all 0.2s;
                }

                .product-assignment-card:hover {
                    border-color: var(--accent);
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
                }

                .card-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 12px 16px;
                    background: var(--surface-hover);
                    border-bottom: 1px solid var(--border);
                }

                .product-title {
                    display: flex;
                    flex-direction: column;
                    gap: 2px;
                    flex: 1;
                    min-width: 0;
                }

                .product-title strong {
                    font-size: 14px;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                .project-badge {
                    font-size: 11px;
                    color: var(--text-secondary);
                }

                .card-actions {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }

                .quick-assign {
                    padding: 4px 8px;
                    border: 1px solid var(--border);
                    border-radius: 6px;
                    background: var(--surface);
                    font-size: 11px;
                    cursor: pointer;
                }

                .remove-product {
                    background: none;
                    border: none;
                    color: var(--text-secondary);
                    cursor: pointer;
                    display: flex;
                    padding: 2px;
                }

                .remove-product:hover {
                    color: var(--danger);
                }

                .process-assignments {
                    padding: 12px 16px;
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }

                .process-row {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    gap: 12px;
                    padding: 4px 0;
                }

                .process-label {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-size: 13px;
                    font-weight: 500;
                    flex: 1;
                }

                .process-label .material-icons-round {
                    font-size: 18px;
                    color: var(--accent);
                    opacity: 0.8;
                }

                .worker-selection-wrapper {
                    position: relative;
                    display: flex;
                    align-items: center;
                    width: 180px;
                }

                .worker-select {
                    width: 100%;
                    padding: 6px 10px;
                    border: 1px solid var(--border);
                    border-radius: 8px;
                    background: var(--surface);
                    font-size: 12px;
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .worker-select:focus {
                    outline: none;
                    border-color: var(--accent);
                }

                .worker-select.assigned {
                    border-color: var(--success);
                    background: rgba(52, 199, 89, 0.05);
                }

                .check-mark {
                    position: absolute;
                    right: 8px;
                    font-size: 16px;
                    color: var(--success);
                    pointer-events: none;
                }

                .create-footer {
                    grid-column: 1 / -1;
                    grid-row: 2 / 3;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 16px 24px;
                    border-top: 1px solid var(--border);
                    background: var(--surface);
                }

                .footer-right {
                    display: flex;
                    gap: 12px;
                }

                .btn-ghost {
                    background: none;
                    border: 1px solid transparent;
                    color: var(--text-secondary);
                }

                .btn-ghost:hover {
                    color: var(--danger);
                }

                .btn-secondary {
                    background: var(--surface-hover);
                    border: 1px solid var(--border);
                    color: var(--text-primary);
                }

                @media (max-width: 1200px) {
                    .create-layout {
                        grid-template-columns: 320px 1fr;
                    }

                    .assignments-grid {
                        grid-template-columns: 1fr;
                    }
                }

                .btn-lg {
                    padding: 12px 24px;
                    font-size: 15px;
                }

                @media (max-width: 1200px) {
                    .create-layout {
                        grid-template-columns: 320px 1fr;
                    }

                    .assignments-grid {
                        grid-template-columns: 1fr;
                    }
                }

                @media (max-width: 768px) {
                    .create-layout {
                        grid-template-columns: 1fr;
                        grid-template-rows: auto 1fr auto;
                    }

                    .sidebar {
                        grid-row: auto;
                        border-right: none;
                        border-bottom: 1px solid var(--border);
                        max-height: 40vh;
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
