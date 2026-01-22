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

interface ProductRow {
    Product_ID: string;
    Product_Name: string;
    Project_ID: string;
    Project_Name: string;
    Quantity: number;
    Status: string;
}

interface ProcessAssignment {
    Worker_ID?: string;
    Worker_Name?: string;
}

export default function ProductionTab({ workOrders, projects, workers, onRefresh, showToast }: ProductionTabProps) {
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('');

    // Create Work Order State
    const [createModal, setCreateModal] = useState(false);
    const [step, setStep] = useState(1); // 1: Select Processes, 2: Select Products, 3: Assign Workers
    const [selectedProcesses, setSelectedProcesses] = useState<string[]>([]);
    const [selectedProducts, setSelectedProducts] = useState<ProductRow[]>([]);
    const [assignments, setAssignments] = useState<Record<string, Record<string, ProcessAssignment>>>({});
    const [dueDate, setDueDate] = useState('');
    const [notes, setNotes] = useState('');

    // View Work Order State
    const [viewModal, setViewModal] = useState(false);
    const [currentWorkOrder, setCurrentWorkOrder] = useState<WorkOrder | null>(null);

    const filteredWorkOrders = workOrders.filter(wo => {
        const matchesSearch = wo.Work_Order_Number?.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesStatus = !statusFilter || wo.Status === statusFilter;
        return matchesSearch && matchesStatus;
    });

    // Get eligible products based on selected processes
    const eligibleProducts = useMemo(() => {
        if (selectedProcesses.length === 0) return [];

        const products: ProductRow[] = [];
        const eligibilityMap: Record<string, string[]> = {
            'Rezanje': ['Na čekanju', 'Materijali naručeni', 'Materijali spremni'],
            'Kantiranje': ['Rezanje'],
            'Bušenje': ['Kantiranje'],
            'Sklapanje': ['Bušenje'],
        };

        // Find earliest process in selection
        const processOrder = ['Rezanje', 'Kantiranje', 'Bušenje', 'Sklapanje'];
        const earliestProcess = selectedProcesses.sort((a, b) =>
            processOrder.indexOf(a) - processOrder.indexOf(b)
        )[0];

        const eligibleStatuses = eligibilityMap[earliestProcess] || [];

        projects.forEach(project => {
            (project.products || []).forEach(product => {
                if (eligibleStatuses.includes(product.Status)) {
                    products.push({
                        Product_ID: product.Product_ID,
                        Product_Name: product.Name,
                        Project_ID: project.Project_ID,
                        Project_Name: project.Client_Name,
                        Quantity: product.Quantity || 1,
                        Status: product.Status,
                    });
                }
            });
        });
        return products;
    }, [projects, selectedProcesses]);

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
        const date = new Date(dateString);
        return date.toLocaleDateString('hr-HR');
    }

    function openCreateModal() {
        setStep(1);
        setSelectedProcesses([]);
        setSelectedProducts([]);
        setAssignments({});
        setDueDate('');
        setNotes('');
        setCreateModal(true);
    }

    function toggleProcess(process: string) {
        if (selectedProcesses.includes(process)) {
            setSelectedProcesses(selectedProcesses.filter(p => p !== process));
        } else {
            setSelectedProcesses([...selectedProcesses, process]);
        }
    }

    function toggleProduct(product: ProductRow) {
        const isSelected = selectedProducts.some(p => p.Product_ID === product.Product_ID);
        if (isSelected) {
            setSelectedProducts(selectedProducts.filter(p => p.Product_ID !== product.Product_ID));
            // Remove assignments for this product
            const newAssignments = { ...assignments };
            delete newAssignments[product.Product_ID];
            setAssignments(newAssignments);
        } else {
            setSelectedProducts([...selectedProducts, product]);
            // Initialize assignments for this product
            const newAssignments = { ...assignments };
            newAssignments[product.Product_ID] = {};
            selectedProcesses.forEach(proc => {
                newAssignments[product.Product_ID][proc] = {};
            });
            setAssignments(newAssignments);
        }
    }

    function selectAllProducts() {
        setSelectedProducts([...eligibleProducts]);
        const newAssignments: Record<string, Record<string, ProcessAssignment>> = {};
        eligibleProducts.forEach(product => {
            newAssignments[product.Product_ID] = {};
            selectedProcesses.forEach(proc => {
                newAssignments[product.Product_ID][proc] = {};
            });
        });
        setAssignments(newAssignments);
    }

    function assignWorker(productId: string, process: string, workerId: string) {
        const worker = workers.find(w => w.Worker_ID === workerId);
        const newAssignments = { ...assignments };
        if (!newAssignments[productId]) newAssignments[productId] = {};
        newAssignments[productId][process] = {
            Worker_ID: workerId || undefined,
            Worker_Name: worker?.Name,
        };
        setAssignments(newAssignments);
    }

    function assignWorkerToAllProducts(process: string, workerId: string) {
        const worker = workers.find(w => w.Worker_ID === workerId);
        const newAssignments = { ...assignments };
        selectedProducts.forEach(product => {
            if (!newAssignments[product.Product_ID]) newAssignments[product.Product_ID] = {};
            newAssignments[product.Product_ID][process] = {
                Worker_ID: workerId || undefined,
                Worker_Name: worker?.Name,
            };
        });
        setAssignments(newAssignments);
        showToast(`${worker?.Name} dodijeljen za ${process} svim proizvodima`, 'success');
    }

    function assignWorkerToAllProcesses(productId: string, workerId: string) {
        const worker = workers.find(w => w.Worker_ID === workerId);
        const newAssignments = { ...assignments };
        if (!newAssignments[productId]) newAssignments[productId] = {};
        selectedProcesses.forEach(proc => {
            newAssignments[productId][proc] = {
                Worker_ID: workerId || undefined,
                Worker_Name: worker?.Name,
            };
        });
        setAssignments(newAssignments);
        const product = selectedProducts.find(p => p.Product_ID === productId);
        showToast(`${worker?.Name} dodijeljen za sve procese proizvoda ${product?.Product_Name}`, 'success');
    }

    function assignWorkerToEverything(workerId: string) {
        const worker = workers.find(w => w.Worker_ID === workerId);
        const newAssignments = { ...assignments };
        selectedProducts.forEach(product => {
            if (!newAssignments[product.Product_ID]) newAssignments[product.Product_ID] = {};
            selectedProcesses.forEach(proc => {
                newAssignments[product.Product_ID][proc] = {
                    Worker_ID: workerId || undefined,
                    Worker_Name: worker?.Name,
                };
            });
        });
        setAssignments(newAssignments);
        showToast(`${worker?.Name} dodijeljen svim procesima i proizvodima`, 'success');
    }

    async function handleCreateWorkOrder() {
        if (selectedProducts.length === 0) {
            showToast('Odaberite barem jedan proizvod', 'error');
            return;
        }

        // Build items with process assignments
        const items = selectedProducts.map(product => ({
            Product_ID: product.Product_ID,
            Product_Name: product.Product_Name,
            Project_ID: product.Project_ID,
            Project_Name: product.Project_Name,
            Quantity: product.Quantity,
            Process_Assignments: assignments[product.Product_ID] || {},
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
                <div className="production-grid">
                    {activeOrders.length > 0 && (
                        <WorkOrderSection title="U toku" icon="play_circle" color="var(--accent)" orders={activeOrders}
                            onView={openViewModal} onDelete={handleDeleteWorkOrder} onStart={handleStartWorkOrder}
                            getStatusClass={getStatusClass} formatDate={formatDate} />
                    )}
                    {pendingOrders.length > 0 && (
                        <WorkOrderSection title="Na čekanju" icon="schedule" color="var(--warning)" orders={pendingOrders}
                            onView={openViewModal} onDelete={handleDeleteWorkOrder} onStart={handleStartWorkOrder}
                            getStatusClass={getStatusClass} formatDate={formatDate} />
                    )}
                    {completedOrders.length > 0 && (
                        <WorkOrderSection title="Završeno" icon="check_circle" color="var(--success)" orders={completedOrders}
                            onView={openViewModal} onDelete={handleDeleteWorkOrder} onStart={() => { }}
                            getStatusClass={getStatusClass} formatDate={formatDate} />
                    )}
                </div>
            )}

            {/* Create Work Order Modal */}
            <Modal
                isOpen={createModal}
                onClose={() => setCreateModal(false)}
                title="Novi Radni Nalog"
                size="fullscreen"
                footer={null}
            >
                <div className="wizard-container">
                    {/* Progress Steps */}
                    <div className="wizard-progress">
                        <div className={`progress-step ${step >= 1 ? 'active' : ''} ${step > 1 ? 'completed' : ''}`}>
                            <div className="step-number">1</div>
                            <div className="step-label">Odaberi procese</div>
                        </div>
                        <div className="progress-line" />
                        <div className={`progress-step ${step >= 2 ? 'active' : ''} ${step > 2 ? 'completed' : ''}`}>
                            <div className="step-number">2</div>
                            <div className="step-label">Odaberi proizvode</div>
                        </div>
                        <div className="progress-line" />
                        <div className={`progress-step ${step >= 3 ? 'active' : ''}`}>
                            <div className="step-number">3</div>
                            <div className="step-label">Dodijeli radnike</div>
                        </div>
                    </div>

                    {/* Step Content */}
                    <div className="wizard-content">
                        {step === 1 && (
                            <div className="step-panel">
                                <h3>Koje proizvodne korake želiš uključiti u radni nalog?</h3>
                                <p className="step-description">Odaberi jedan ili više procesa. Možeš odabrati cio tok (npr. Rezanje → Kantiranje → Bušenje).</p>
                                <div className="process-grid">
                                    {PRODUCTION_STEPS.map((process, idx) => (
                                        <div
                                            key={process}
                                            className={`process-card ${selectedProcesses.includes(process) ? 'selected' : ''}`}
                                            onClick={() => toggleProcess(process)}
                                        >
                                            <span className="material-icons-round process-icon">
                                                {process === 'Rezanje' ? 'content_cut' :
                                                    process === 'Kantiranje' ? 'border_style' :
                                                        process === 'Bušenje' ? 'architecture' : 'handyman'}
                                            </span>
                                            <div className="process-name">{process}</div>
                                            <div className="process-order">Korak {idx + 1}</div>
                                            {selectedProcesses.includes(process) && (
                                                <span className="material-icons-round checkmark">check_circle</span>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {step === 2 && (
                            <div className="step-panel">
                                <div className="step-header">
                                    <div>
                                        <h3>Odaberi proizvode za obradu</h3>
                                        <p className="step-description">
                                            Prikazuju se proizvodi spremni za: <strong>{selectedProcesses.join(' → ')}</strong>
                                        </p>
                                    </div>
                                    <button className="btn btn-sm" onClick={selectAllProducts}>
                                        Odaberi sve ({eligibleProducts.length})
                                    </button>
                                </div>

                                {eligibleProducts.length === 0 ? (
                                    <div className="empty-products">
                                        <span className="material-icons-round">inbox</span>
                                        <p>Nema proizvoda spremnih za odabrane procese</p>
                                    </div>
                                ) : (
                                    <div className="products-list">
                                        {eligibleProducts.map(product => {
                                            const isSelected = selectedProducts.some(p => p.Product_ID === product.Product_ID);
                                            return (
                                                <div
                                                    key={product.Product_ID}
                                                    className={`product-item ${isSelected ? 'selected' : ''}`}
                                                    onClick={() => toggleProduct(product)}
                                                >
                                                    <span className="material-icons-round checkbox-icon">
                                                        {isSelected ? 'check_box' : 'check_box_outline_blank'}
                                                    </span>
                                                    <div className="product-details">
                                                        <div className="product-name">{product.Product_Name}</div>
                                                        <div className="product-meta">
                                                            {product.Project_Name} • {product.Quantity} kom
                                                        </div>
                                                    </div>
                                                    <span className={`status-badge small ${getStatusClass(product.Status)}`}>
                                                        {product.Status}
                                                    </span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        )}

                        {step === 3 && (
                            <div className="step-panel">
                                <div className="step-header">
                                    <div>
                                        <h3>Dodijeli radnike</h3>
                                        <p className="step-description">Dodijeli radnike procesima i proizvodima. Možeš dodjeljivati globalno ili individualno.</p>
                                    </div>
                                    <div className="global-assign">
                                        <select
                                            className="worker-select"
                                            onChange={(e) => e.target.value && assignWorkerToEverything(e.target.value)}
                                            value=""
                                        >
                                            <option value="">Dodijeli jednom radniku sve...</option>
                                            {workers.map(w => (
                                                <option key={w.Worker_ID} value={w.Worker_ID}>{w.Name}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                {/* Assignment Matrix */}
                                <div className="assignment-matrix">
                                    <div className="matrix-header">
                                        <div className="header-cell product-col">Proizvod</div>
                                        {selectedProcesses.map(proc => (
                                            <div key={proc} className="header-cell process-col">
                                                <div>{proc}</div>
                                                <select
                                                    className="worker-select mini"
                                                    onChange={(e) => e.target.value && assignWorkerToAllProducts(proc, e.target.value)}
                                                    value=""
                                                    onClick={(e) => e.stopPropagation()}
                                                >
                                                    <option value="">Dodijeli svima</option>
                                                    {workers.map(w => (
                                                        <option key={w.Worker_ID} value={w.Worker_ID}>{w.Name}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        ))}
                                        <div className="header-cell actions-col">Akcije</div>
                                    </div>

                                    <div className="matrix-body">
                                        {selectedProducts.map(product => (
                                            <div key={product.Product_ID} className="matrix-row">
                                                <div className="matrix-cell product-col">
                                                    <div className="product-name-cell">{product.Product_Name}</div>
                                                    <div className="product-meta-cell">{product.Project_Name}</div>
                                                </div>
                                                {selectedProcesses.map(proc => (
                                                    <div key={proc} className="matrix-cell process-col">
                                                        <select
                                                            className="worker-select"
                                                            value={assignments[product.Product_ID]?.[proc]?.Worker_ID || ''}
                                                            onChange={(e) => assignWorker(product.Product_ID, proc, e.target.value)}
                                                        >
                                                            <option value="">-- Bez radnika --</option>
                                                            {workers.map(w => (
                                                                <option key={w.Worker_ID} value={w.Worker_ID}>{w.Name}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                ))}
                                                <div className="matrix-cell actions-col">
                                                    <select
                                                        className="worker-select mini"
                                                        onChange={(e) => e.target.value && assignWorkerToAllProcesses(product.Product_ID, e.target.value)}
                                                        value=""
                                                    >
                                                        <option value="">Dodijeli svim procesima</option>
                                                        {workers.map(w => (
                                                            <option key={w.Worker_ID} value={w.Worker_ID}>{w.Name}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Additional Options */}
                                <div className="additional-options">
                                    <div className="form-row">
                                        <div className="form-group">
                                            <label>Rok završetka</label>
                                            <input type="date" className="form-input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                                        </div>
                                        <div className="form-group" style={{ flex: 2 }}>
                                            <label>Napomena</label>
                                            <input type="text" className="form-input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opciona napomena..." />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Navigation Footer */}
                    <div className="wizard-footer">
                        <button className="btn" onClick={() => setCreateModal(false)}>Odustani</button>
                        <div className="footer-actions">
                            {step > 1 && (
                                <button className="btn" onClick={() => setStep(step - 1)}>
                                    <span className="material-icons-round">arrow_back</span>
                                    Nazad
                                </button>
                            )}
                            {step < 3 ? (
                                <button
                                    className="btn btn-primary"
                                    onClick={() => setStep(step + 1)}
                                    disabled={step === 1 && selectedProcesses.length === 0 || step === 2 && selectedProducts.length === 0}
                                >
                                    Dalje
                                    <span className="material-icons-round">arrow_forward</span>
                                </button>
                            ) : (
                                <button className="btn btn-primary" onClick={handleCreateWorkOrder}>
                                    <span className="material-icons-round">check</span>
                                    Kreiraj radni nalog
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </Modal>

            {/* View Work Order Modal - TODO: Update to show new structure */}
            <Modal
                isOpen={viewModal}
                onClose={() => setViewModal(false)}
                title={currentWorkOrder?.Work_Order_Number || ''}
                size="large"
            >
                {currentWorkOrder && (
                    <div>
                        <p>Procesi: {currentWorkOrder.Production_Steps?.join(' → ')}</p>
                        <p>Proizvoda: {currentWorkOrder.items?.length || 0}</p>
                    </div>
                )}
            </Modal>

            <style jsx>{`
                .production-grid {
                    display: flex;
                    flex-direction: column;
                    gap: 32px;
                }

                .wizard-container {
                    display: flex;
                    flex-direction: column;
                    height: 100%;
                }

                .wizard-progress {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 32px;
                    background: var(--surface-hover);
                    border-bottom: 1px solid var(--border);
                }

                .progress-step {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 8px;
                    opacity: 0.5;
                    transition: all 0.3s ease;
                }

                .progress-step.active {
                    opacity: 1;
                }

                .progress-step.completed .step-number {
                    background: var(--success);
                    border-color: var(--success);
                }

                .step-number {
                    width: 40px;
                    height: 40px;
                    border-radius: 50%;
                    border: 2px solid var(--border);
                    background: var(--surface);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-weight: 600;
                    font-size: 16px;
                    transition: all 0.3s ease;
                }

                .progress-step.active .step-number {
                    background: var(--accent);
                    border-color: var(--accent);
                    color: white;
                }

                .step-label {
                    font-size: 14px;
                    font-weight: 500;
                    color: var(--text-secondary);
                }

                .progress-step.active .step-label {
                    color: var(--text);
                }

                .progress-line {
                    width: 120px;
                    height: 2px;
                    background: var(--border);
                    margin: 0 16px;
                }

                .wizard-content {
                    flex: 1;
                    overflow-y: auto;
                    padding: 32px;
                }

                .step-panel {
                    max-width: 1000px;
                    margin: 0 auto;
                }

                .step-panel h3 {
                    font-size: 24px;
                    margin-bottom: 8px;
                }

                .step-description {
                    color: var(--text-secondary);
                    margin-bottom: 32px;
                }

                .step-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: flex-start;
                    margin-bottom: 24px;
                }

                .process-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                    gap: 16px;
                }

                .process-card {
                    position: relative;
                    padding: 32px 24px;
                    border: 2px solid var(--border);
                    border-radius: 16px;
                    background: var(--surface);
                    cursor: pointer;
                    transition: all 0.2s ease;
                    text-align: center;
                }

                .process-card:hover {
                    border-color: var(--accent);
                    transform: translateY(-2px);
                    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
                }

                .process-card.selected {
                    border-color: var(--accent);
                    background: rgba(0, 113, 227, 0.05);
                }

                .process-icon {
                    font-size: 48px;
                    color: var(--accent);
                    margin-bottom: 12px;
                }

                .process-name {
                    font-weight: 600;
                    font-size: 18px;
                    margin-bottom: 4px;
                }

                .process-order {
                    font-size: 13px;
                    color: var(--text-secondary);
                }

                .checkmark {
                    position: absolute;
                    top: 12px;
                    right: 12px;
                    color: var(--accent);
                    font-size: 24px;
                }

                .products-list {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }

                .product-item {
                    display: flex;
                    align-items: center;
                    gap: 16px;
                    padding: 16px 20px;
                    border: 2px solid var(--border);
                    border-radius: 12px;
                    background: var(--surface);
                    cursor: pointer;
                    transition: all 0.2s ease;
                }

                .product-item:hover {
                    border-color: var(--accent);
                }

                .product-item.selected {
                    border-color: var(--accent);
                    background: rgba(0, 113, 227, 0.05);
                }

                .checkbox-icon {
                    font-size: 24px;
                    color: var(--text-secondary);
                }

                .product-item.selected .checkbox-icon {
                    color: var(--accent);
                }

                .product-details {
                    flex: 1;
                }

                .product-name {
                    font-weight: 500;
                    font-size: 15px;
                }

                .product-meta {
                    font-size: 13px;
                    color: var(--text-secondary);
                }

                .status-badge.small {
                    font-size: 11px;
                    padding: 4px 10px;
                }

                .empty-products {
                    padding: 64px;
                    text-align: center;
                    color: var(--text-secondary);
                }

                .empty-products .material-icons-round {
                    font-size: 64px;
                    opacity: 0.3;
                    margin-bottom: 16px;
                }

                .global-assign {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }

                .assignment-matrix {
                    background: var(--surface);
                    border: 1px solid var(--border);
                    border-radius: 12px;
                    overflow: hidden;
                    margin-bottom: 24px;
                }

                .matrix-header {
                    display: grid;
                    grid-template-columns: 250px repeat(var(--process-count, 1), 1fr) 200px;
                    background: var(--surface-hover);
                    border-bottom: 2px solid var(--border);
                    font-weight: 600;
                    font-size: 13px;
                }

                .matrix-body {
                    max-height: 400px;
                    overflow-y: auto;
                }

                .matrix-row {
                    display: grid;
                    grid-template-columns: 250px repeat(var(--process-count, 1), 1fr) 200px;
                    border-bottom: 1px solid var(--border);
                }

                .matrix-row:last-child {
                    border-bottom: none;
                }

                .matrix-row:hover {
                    background: var(--surface-hover);
                }

                .header-cell, .matrix-cell {
                    padding: 16px;
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                    align-items: flex-start;
                }

                .header-cell {
                    justify-content: center;
                }

                .product-col {
                    border-right: 1px solid var(--border);
                }

                .process-col {
                    border-right: 1px solid var(--border);
                }

                .product-name-cell {
                    font-weight: 500;
                }

                .product-meta-cell {
                    font-size: 12px;
                    color: var(--text-secondary);
                }

                .worker-select {
                    width: 100%;
                    padding: 8px 12px;
                    border: 1px solid var(--border);
                    border-radius: 8px;
                    background: var(--surface);
                    font-size: 13px;
                }

                .worker-select.mini {
                    font-size: 12px;
                    padding: 6px 10px;
                }

                .worker-select:focus {
                    outline: none;
                    border-color: var(--accent);
                }

                .additional-options {
                    padding: 24px;
                    background: var(--surface-hover);
                    border-radius: 12px;
                }

                .form-row {
                    display: flex;
                    gap: 16px;
                }

                .form-group {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }

                .form-group label {
                    font-weight: 500;
                    font-size: 14px;
                }

                .form-input {
                    padding: 10px 14px;
                    border: 1px solid var(--border);
                    border-radius: 8px;
                    background: var(--surface);
                    font-size: 14px;
                }

                .form-input:focus {
                    outline: none;
                    border-color: var(--accent);
                }

                .wizard-footer {
                    display: flex;
                    justify-content: space-between;
                    padding: 20px 32px;
                    border-top: 1px solid var(--border);
                    background: var(--surface);
                }

                .footer-actions {
                    display: flex;
                    gap: 12px;
                }

                @media (max-width: 1024px) {
                    .matrix-header, .matrix-row {
                        grid-template-columns: 200px repeat(var(--process-count, 1), 150px) 180px;
                    }
                }
            `}</style>
        </div>
    );
}

// Work Order Section Component
function WorkOrderSection({ title, icon, color, orders, onView, onDelete, onStart, getStatusClass, formatDate }: any) {
    return (
        <div className="production-section">
            <h3 className="section-title">
                <span className="material-icons-round" style={{ color }}>{icon}</span>
                {title} ({orders.length})
            </h3>
            <div className="work-orders-grid">
                {orders.map((wo: WorkOrder) => (
                    <WorkOrderCard
                        key={wo.Work_Order_ID}
                        workOrder={wo}
                        onView={() => onView(wo.Work_Order_ID)}
                        onDelete={() => onDelete(wo.Work_Order_ID)}
                        onStart={() => onStart(wo.Work_Order_ID)}
                        getStatusClass={getStatusClass}
                        formatDate={formatDate}
                    />
                ))}
            </div>
            <style jsx>{`
                .production-section {
                    display: flex;
                    flex-direction: column;
                    gap: 16px;
                }
                .section-title {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-size: 16px;
                    font-weight: 600;
                    margin: 0;
                }
                .work-orders-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
                    gap: 16px;
                }
            `}</style>
        </div>
    );
}

// Work Order Card Component
function WorkOrderCard({ workOrder, onView, onDelete, onStart, getStatusClass, formatDate }: any) {
    const itemCount = workOrder.items?.length || 0;

    return (
        <div className="work-order-card" onClick={onView}>
            <div className="card-header">
                <div className="card-title">{workOrder.Work_Order_Number}</div>
                <span className={`status-badge ${getStatusClass(workOrder.Status)}`}>
                    {workOrder.Status}
                </span>
            </div>

            <div className="card-processes">
                <span className="material-icons-round">engineering</span>
                {workOrder.Production_Steps?.join(' → ') || workOrder.Production_Step}
            </div>

            <div className="card-meta">
                <span>
                    <span className="material-icons-round">calendar_today</span>
                    {formatDate(workOrder.Created_Date)}
                </span>
                <span>
                    <span className="material-icons-round">inventory_2</span>
                    {itemCount} proizvoda
                </span>
            </div>

            <div className="card-actions" onClick={(e) => e.stopPropagation()}>
                {workOrder.Status === 'Nacrt' && (
                    <button className="btn btn-sm btn-primary" onClick={onStart}>
                        <span className="material-icons-round">play_arrow</span>
                        Pokreni
                    </button>
                )}
                <button className="icon-btn sm danger" onClick={onDelete}>
                    <span className="material-icons-round">delete</span>
                </button>
            </div>

            <style jsx>{`
                .work-order-card {
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                    padding: 20px;
                    background: var(--surface);
                    border: 1px solid var(--border);
                    border-radius: 16px;
                    cursor: pointer;
                    transition: all 0.2s ease;
                }
                .work-order-card:hover {
                    border-color: var(--accent);
                    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
                    transform: translateY(-2px);
                }
                .card-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .card-title {
                    font-weight: 600;
                    font-size: 16px;
                    color: var(--accent);
                }
                .card-processes {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-weight: 500;
                    color: var(--text);
                }
                .card-processes .material-icons-round {
                    font-size: 18px;
                    color: var(--text-secondary);
                }
                .card-meta {
                    display: flex;
                    gap: 16px;
                    font-size: 13px;
                    color: var(--text-secondary);
                }
                .card-meta span {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                }
                .card-meta .material-icons-round {
                    font-size: 16px;
                }
                .card-actions {
                    display: flex;
                    gap: 8px;
                    margin-top: 4px;
                }
                .icon-btn.sm {
                    padding: 6px;
                }
                .icon-btn.sm .material-icons-round {
                    font-size: 18px;
                }
            `}</style>
        </div>
    );
}
