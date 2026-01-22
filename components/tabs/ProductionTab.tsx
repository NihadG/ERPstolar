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
    const [selectedProcesses, setSelectedProcesses] = useState<string[]>([]);
    const [selectedProducts, setSelectedProducts] = useState<ProductSelection[]>([]);
    const [dueDate, setDueDate] = useState('');
    const [notes, setNotes] = useState('');

    // View Modal
    const [viewModal, setViewModal] = useState(false);
    const [currentWorkOrder, setCurrentWorkOrder] = useState<WorkOrder | null>(null);

    const filteredWorkOrders = workOrders.filter(wo => {
        const matchesSearch = wo.Work_Order_Number?.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesStatus = !statusFilter || wo.Status === statusFilter;
        return matchesSearch && matchesStatus;
    });

    const eligibleProducts = useMemo(() => {
        if (selectedProcesses.length === 0) return [];

        const eligibilityMap: Record<string, string[]> = {
            'Rezanje': ['Na čekanju', 'Materijali naručeni', 'Materijali spremni'],
            'Kantiranje': ['Rezanje'],
            'Bušenje': ['Kantiranje'],
            'Sklapanje': ['Bušenje'],
        };

        const processOrder = ['Rezanje', 'Kantiranje', 'Bušenje', 'Sklapanje'];
        const earliestProcess = selectedProcesses.sort((a, b) =>
            processOrder.indexOf(a) - processOrder.indexOf(b)
        )[0];

        const eligibleStatuses = eligibilityMap[earliestProcess] || [];
        const products: any[] = [];

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
        return new Date(dateString).toLocaleDateString('hr-HR');
    }

    function openCreateModal() {
        setSelectedProcesses(['Rezanje']);
        setSelectedProducts([]);
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
                    Worker_ID: workerId || undefined,
                    Worker_Name: worker?.Name,
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
                        {/* Processes */}
                        <div className="sidebar-section">
                            <h4>Proizvodni koraci</h4>
                            <div className="process-pills">
                                {PRODUCTION_STEPS.map(proc => (
                                    <button
                                        key={proc}
                                        className={`process-pill ${selectedProcesses.includes(proc) ? 'active' : ''}`}
                                        onClick={() => toggleProcess(proc)}
                                    >
                                        <span className="material-icons-round">
                                            {proc === 'Rezanje' ? 'content_cut' : proc === 'Kantiranje' ? 'border_style' : proc === 'Bušenje' ? 'architecture' : 'handyman'}
                                        </span>
                                        {proc}
                                        {selectedProcesses.includes(proc) && <span className="material-icons-round check">check</span>}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Products List */}
                        <div className="sidebar-section products-section">
                            <div className="section-header">
                                <h4>Proizvodi ({selectedProducts.length})</h4>
                                {eligibleProducts.length > 0 && (
                                    <button className="link-btn" onClick={selectAllProducts}>Odaberi sve</button>
                                )}
                            </div>
                            <div className="products-list">
                                {eligibleProducts.length === 0 ? (
                                    <div className="empty-message">
                                        {selectedProcesses.length === 0 ? 'Odaberi proizvodni korak' : 'Nema dostupnih proizvoda'}
                                    </div>
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
                                                    <div className="product-meta">{product.Project_Name}</div>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
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
                            <h3>Dodjela radnika <span className="count">{selectedProducts.length} proizvoda × {selectedProcesses.length} procesa</span></h3>
                        </div>

                        {selectedProducts.length === 0 ? (
                            <div className="empty-assignments">
                                <span className="material-icons-round">person_add</span>
                                <p>Odaberi proizvode sa lijeve strane</p>
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
                                            <select
                                                className="quick-assign"
                                                onChange={(e) => e.target.value && assignWorkerToProduct(product.Product_ID, e.target.value)}
                                                value=""
                                            >
                                                <option value="">Dodijeli svim procesima...</option>
                                                {workers.map(w => (
                                                    <option key={w.Worker_ID} value={w.Worker_ID}>{w.Name}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="process-assignments">
                                            {selectedProcesses.map(proc => (
                                                <div key={proc} className="process-row">
                                                    <div className="process-label">
                                                        <span className="material-icons-round">
                                                            {proc === 'Rezanje' ? 'content_cut' : proc === 'Kantiranje' ? 'border_style' : proc === 'Bušenje' ? 'architecture' : 'handyman'}
                                                        </span>
                                                        {proc}
                                                    </div>
                                                    <select
                                                        value={product.assignments[proc] || ''}
                                                        onChange={(e) => assignWorker(product.Product_ID, proc, e.target.value)}
                                                        className="worker-select"
                                                    >
                                                        <option value="">-- Odaberi radnika --</option>
                                                        {workers.map(w => (
                                                            <option key={w.Worker_ID} value={w.Worker_ID}>{w.Name}</option>
                                                        ))}
                                                    </select>
                                                    {product.assignments[proc] && (
                                                        <span className="assigned-indicator">
                                                            {workers.find(w => w.Worker_ID === product.assignments[proc])?.Name}
                                                        </span>
                                                    )}
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
                        <button className="btn" onClick={() => setCreateModal(false)}>Odustani</button>
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
                    margin-bottom: 24px;
                }

                .assignments-header h3 {
                    margin: 0;
                    font-size: 20px;
                    font-weight: 600;
                }

                .assignments-header .count {
                    font-weight: 400;
                    color: var(--text-secondary);
                    font-size: 16px;
                }

                .empty-assignments {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    padding: 80px 20px;
                    color: var(--text-secondary);
                }

                .empty-assignments .material-icons-round {
                    font-size: 64px;
                    opacity: 0.3;
                    margin-bottom: 16px;
                }

                .assignments-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
                    gap: 16px;
                }

                .product-assignment-card {
                    background: var(--surface);
                    border: 1px solid var(--border);
                    border-radius: 12px;
                    padding: 16px;
                }

                .card-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: flex-start;
                    gap: 12px;
                    margin-bottom: 16px;
                    padding-bottom: 12px;
                    border-bottom: 1px solid var(--border);
                }

                .product-title {
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                    flex: 1;
                }

                .product-title strong {
                    font-size: 15px;
                }

                .project-badge {
                    font-size: 12px;
                    color: var(--text-secondary);
                }

                .quick-assign {
                    padding: 6px 10px;
                    border: 1px solid var(--border);
                    border-radius: 6px;
                    background: var(--surface-hover);
                    font-size: 12px;
                    cursor: pointer;
                }

                .quick-assign:focus {
                    outline: none;
                    border-color: var(--accent);
                }

                .process-assignments {
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                }

                .process-row {
                    display: grid;
                    grid-template-columns: 140px 1fr auto;
                    align-items: center;
                    gap: 12px;
                }

                .process-label {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-weight: 500;
                    font-size: 13px;
                }

                .process-label .material-icons-round {
                    font-size: 18px;
                    color: var(--accent);
                }

                .worker-select {
                    padding: 8px 12px;
                    border: 1px solid var(--border);
                    border-radius: 8px;
                    background: var(--surface);
                    font-size: 13px;
                }

                .worker-select:focus {
                    outline: none;
                    border-color: var(--accent);
                }

                .assigned-indicator {
                    font-size: 12px;
                    color: var(--success);
                    font-weight: 500;
                }

                .create-footer {
                    grid-column: 1 / -1;
                    grid-row: 2 / 3;
                    display: flex;
                    justify-content: space-between;
                    padding: 16px 24px;
                    border-top: 1px solid var(--border);
                    background: var(--surface);
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
