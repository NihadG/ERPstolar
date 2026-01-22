'use client';

import { useState, useMemo } from 'react';
import type { WorkOrder, WorkOrderItem, Project, Worker } from '@/lib/types';
import { createWorkOrder, deleteWorkOrder, startWorkOrder, updateWorkOrderStatus, completeWorkOrderItem, getWorkOrder, assignWorkerToItem } from '@/lib/database';
import Modal from '@/components/ui/Modal';
import { WORK_ORDER_STATUSES, PRODUCTION_STEPS } from '@/lib/types';

interface ProductionTabProps {
    workOrders: WorkOrder[];
    projects: Project[];
    workers: Worker[];
    onRefresh: () => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

interface SelectedProduct {
    Product_ID: string;
    Product_Name: string;
    Project_ID: string;
    Project_Name: string;
    Quantity: number;
    Status: string;
    Worker_ID?: string;
    Worker_Name?: string;
}

export default function ProductionTab({ workOrders, projects, workers, onRefresh, showToast }: ProductionTabProps) {
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('');

    // Create Work Order Modal
    const [createModal, setCreateModal] = useState(false);
    const [selectedProductionStep, setSelectedProductionStep] = useState('Rezanje');
    const [selectedProducts, setSelectedProducts] = useState<SelectedProduct[]>([]);
    const [globalWorkerId, setGlobalWorkerId] = useState('');
    const [dueDate, setDueDate] = useState('');
    const [notes, setNotes] = useState('');

    // View Work Order Modal
    const [viewModal, setViewModal] = useState(false);
    const [currentWorkOrder, setCurrentWorkOrder] = useState<WorkOrder | null>(null);

    const filteredWorkOrders = workOrders.filter(wo => {
        const matchesSearch = wo.Work_Order_Number?.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesStatus = !statusFilter || wo.Status === statusFilter;
        return matchesSearch && matchesStatus;
    });

    // Get products eligible for selected production step
    const eligibleProducts = useMemo(() => {
        const eligibleStatuses: Record<string, string[]> = {
            'Rezanje': ['Na čekanju', 'Materijali naručeni', 'Materijali spremni'],
            'Kantiranje': ['Rezanje'],
            'Bušenje': ['Kantiranje'],
            'Sklapanje': ['Bušenje'],
        };
        const eligible = eligibleStatuses[selectedProductionStep] || [];

        const products: SelectedProduct[] = [];
        projects.forEach(project => {
            (project.products || []).forEach(product => {
                if (eligible.includes(product.Status)) {
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
    }, [projects, selectedProductionStep]);

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
        setSelectedProductionStep('Rezanje');
        setSelectedProducts([]);
        setGlobalWorkerId('');
        setDueDate('');
        setNotes('');
        setCreateModal(true);
    }

    function toggleProduct(product: SelectedProduct) {
        const exists = selectedProducts.find(p => p.Product_ID === product.Product_ID);
        if (exists) {
            setSelectedProducts(selectedProducts.filter(p => p.Product_ID !== product.Product_ID));
        } else {
            setSelectedProducts([...selectedProducts, { ...product }]);
        }
    }

    function selectAllProducts() {
        setSelectedProducts(eligibleProducts.map(p => ({ ...p })));
    }

    function clearSelection() {
        setSelectedProducts([]);
    }

    function assignGlobalWorker() {
        if (!globalWorkerId) return;
        const worker = workers.find(w => w.Worker_ID === globalWorkerId);
        if (!worker) return;

        setSelectedProducts(selectedProducts.map(p => ({
            ...p,
            Worker_ID: globalWorkerId,
            Worker_Name: worker.Name,
        })));
        showToast(`Radnik ${worker.Name} dodijeljen svim proizvodima`, 'success');
    }

    function assignWorkerToProduct(productId: string, workerId: string) {
        const worker = workers.find(w => w.Worker_ID === workerId);
        setSelectedProducts(selectedProducts.map(p =>
            p.Product_ID === productId
                ? { ...p, Worker_ID: workerId, Worker_Name: worker?.Name }
                : p
        ));
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
            Worker_ID: p.Worker_ID,
            Worker_Name: p.Worker_Name,
        }));

        const result = await createWorkOrder({
            Production_Step: selectedProductionStep,
            Due_Date: dueDate,
            Notes: notes,
            items,
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

    async function handleCompleteItem(itemId: string) {
        if (!currentWorkOrder) return;

        const result = await completeWorkOrderItem(itemId, currentWorkOrder.Production_Step);
        if (result.success) {
            showToast('Stavka završena', 'success');
            onRefresh();
            const updated = await getWorkOrder(currentWorkOrder.Work_Order_ID);
            setCurrentWorkOrder(updated);

            if (updated?.items?.every(i => i.Status === 'Završeno')) {
                await updateWorkOrderStatus(currentWorkOrder.Work_Order_ID, 'Završeno');
                onRefresh();
            }
        } else {
            showToast(result.message, 'error');
        }
    }

    async function handleCompleteAllItems() {
        if (!currentWorkOrder?.items) return;

        const pendingItems = currentWorkOrder.items.filter(i => i.Status !== 'Završeno');
        for (const item of pendingItems) {
            await completeWorkOrderItem(item.ID, currentWorkOrder.Production_Step);
        }

        await updateWorkOrderStatus(currentWorkOrder.Work_Order_ID, 'Završeno');
        showToast('Svi proizvodi završeni', 'success');
        onRefresh();
        setViewModal(false);
    }

    // Group work orders by status for better overview
    const activeOrders = filteredWorkOrders.filter(wo => wo.Status === 'U toku');
    const pendingOrders = filteredWorkOrders.filter(wo => wo.Status === 'Nacrt' || wo.Status === 'Dodijeljeno');
    const completedOrders = filteredWorkOrders.filter(wo => wo.Status === 'Završeno');

    return (
        <div className="tab-content active">
            {/* Header */}
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
                <select
                    className="filter-select"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                >
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

            {/* Work Orders Grid */}
            {filteredWorkOrders.length === 0 ? (
                <div className="empty-state">
                    <span className="material-icons-round">engineering</span>
                    <h3>Nema radnih naloga</h3>
                    <p>Kreirajte prvi radni nalog klikom na "Novi Radni Nalog"</p>
                </div>
            ) : (
                <div className="production-grid">
                    {/* Active Orders Section */}
                    {activeOrders.length > 0 && (
                        <div className="production-section">
                            <h3 className="section-title">
                                <span className="material-icons-round" style={{ color: 'var(--accent)' }}>play_circle</span>
                                U toku ({activeOrders.length})
                            </h3>
                            <div className="work-orders-list">
                                {activeOrders.map(wo => (
                                    <WorkOrderCard
                                        key={wo.Work_Order_ID}
                                        workOrder={wo}
                                        onView={() => openViewModal(wo.Work_Order_ID)}
                                        onDelete={() => handleDeleteWorkOrder(wo.Work_Order_ID)}
                                        onStart={() => handleStartWorkOrder(wo.Work_Order_ID)}
                                        getStatusClass={getStatusClass}
                                        formatDate={formatDate}
                                    />
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Pending Orders Section */}
                    {pendingOrders.length > 0 && (
                        <div className="production-section">
                            <h3 className="section-title">
                                <span className="material-icons-round" style={{ color: 'var(--warning)' }}>schedule</span>
                                Na čekanju ({pendingOrders.length})
                            </h3>
                            <div className="work-orders-list">
                                {pendingOrders.map(wo => (
                                    <WorkOrderCard
                                        key={wo.Work_Order_ID}
                                        workOrder={wo}
                                        onView={() => openViewModal(wo.Work_Order_ID)}
                                        onDelete={() => handleDeleteWorkOrder(wo.Work_Order_ID)}
                                        onStart={() => handleStartWorkOrder(wo.Work_Order_ID)}
                                        getStatusClass={getStatusClass}
                                        formatDate={formatDate}
                                    />
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Completed Orders Section */}
                    {completedOrders.length > 0 && (
                        <div className="production-section">
                            <h3 className="section-title">
                                <span className="material-icons-round" style={{ color: 'var(--success)' }}>check_circle</span>
                                Završeno ({completedOrders.length})
                            </h3>
                            <div className="work-orders-list">
                                {completedOrders.map(wo => (
                                    <WorkOrderCard
                                        key={wo.Work_Order_ID}
                                        workOrder={wo}
                                        onView={() => openViewModal(wo.Work_Order_ID)}
                                        onDelete={() => handleDeleteWorkOrder(wo.Work_Order_ID)}
                                        onStart={() => { }}
                                        getStatusClass={getStatusClass}
                                        formatDate={formatDate}
                                    />
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Create Work Order Modal */}
            <Modal
                isOpen={createModal}
                onClose={() => setCreateModal(false)}
                title="Novi Radni Nalog"
                size="large"
                footer={
                    <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                        <button className="btn" onClick={() => setCreateModal(false)}>Odustani</button>
                        <button
                            className="btn btn-primary"
                            onClick={handleCreateWorkOrder}
                            disabled={selectedProducts.length === 0}
                        >
                            <span className="material-icons-round">add</span>
                            Kreiraj ({selectedProducts.length})
                        </button>
                    </div>
                }
            >
                <div className="create-work-order-form">
                    {/* Step Selection */}
                    <div className="form-section">
                        <label className="form-label">Proizvodni korak</label>
                        <div className="step-buttons">
                            {PRODUCTION_STEPS.map(step => (
                                <button
                                    key={step}
                                    className={`step-btn ${selectedProductionStep === step ? 'active' : ''}`}
                                    onClick={() => {
                                        setSelectedProductionStep(step);
                                        setSelectedProducts([]);
                                    }}
                                >
                                    <span className="material-icons-round">
                                        {step === 'Rezanje' ? 'content_cut' :
                                            step === 'Kantiranje' ? 'border_style' :
                                                step === 'Bušenje' ? 'architecture' : 'handyman'}
                                    </span>
                                    {step}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Product Selection */}
                    <div className="form-section">
                        <div className="form-header">
                            <label className="form-label">Odaberi proizvode za {selectedProductionStep.toLowerCase()}</label>
                            <div className="form-actions">
                                <button className="btn btn-sm" onClick={selectAllProducts}>Odaberi sve</button>
                                <button className="btn btn-sm" onClick={clearSelection}>Poništi</button>
                            </div>
                        </div>

                        {eligibleProducts.length === 0 ? (
                            <div className="empty-products">
                                <span className="material-icons-round">inbox</span>
                                <p>Nema proizvoda spremnih za {selectedProductionStep.toLowerCase()}</p>
                            </div>
                        ) : (
                            <div className="products-grid">
                                {eligibleProducts.map(product => {
                                    const isSelected = selectedProducts.some(p => p.Product_ID === product.Product_ID);
                                    return (
                                        <div
                                            key={product.Product_ID}
                                            className={`product-card ${isSelected ? 'selected' : ''}`}
                                            onClick={() => toggleProduct(product)}
                                        >
                                            <div className="product-checkbox">
                                                <span className="material-icons-round">
                                                    {isSelected ? 'check_box' : 'check_box_outline_blank'}
                                                </span>
                                            </div>
                                            <div className="product-info">
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

                    {/* Worker Assignment */}
                    {selectedProducts.length > 0 && (
                        <div className="form-section">
                            <label className="form-label">Dodjela radnika</label>

                            {/* Global Worker Assignment */}
                            <div className="global-worker-row">
                                <select
                                    className="filter-select"
                                    value={globalWorkerId}
                                    onChange={(e) => setGlobalWorkerId(e.target.value)}
                                >
                                    <option value="">-- Odaberi radnika --</option>
                                    {workers.map(worker => (
                                        <option key={worker.Worker_ID} value={worker.Worker_ID}>
                                            {worker.Name} ({worker.Role})
                                        </option>
                                    ))}
                                </select>
                                <button
                                    className="btn btn-primary"
                                    onClick={assignGlobalWorker}
                                    disabled={!globalWorkerId}
                                >
                                    <span className="material-icons-round">group_add</span>
                                    Dodijeli svima
                                </button>
                            </div>

                            {/* Individual Worker Assignment */}
                            <div className="worker-assignments">
                                {selectedProducts.map(product => (
                                    <div key={product.Product_ID} className="worker-row">
                                        <div className="worker-product-info">
                                            <span className="product-name">{product.Product_Name}</span>
                                            <span className="project-name">{product.Project_Name}</span>
                                        </div>
                                        <select
                                            className="worker-select"
                                            value={product.Worker_ID || ''}
                                            onChange={(e) => assignWorkerToProduct(product.Product_ID, e.target.value)}
                                        >
                                            <option value="">Bez radnika</option>
                                            {workers.map(worker => (
                                                <option key={worker.Worker_ID} value={worker.Worker_ID}>
                                                    {worker.Name}
                                                </option>
                                            ))}
                                        </select>
                                        {product.Worker_Name && (
                                            <span className="assigned-badge">
                                                <span className="material-icons-round">person</span>
                                                {product.Worker_Name}
                                            </span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Additional Options */}
                    <div className="form-section form-row">
                        <div className="form-group">
                            <label className="form-label">Rok završetka</label>
                            <input
                                type="date"
                                className="form-input"
                                value={dueDate}
                                onChange={(e) => setDueDate(e.target.value)}
                            />
                        </div>
                        <div className="form-group" style={{ flex: 2 }}>
                            <label className="form-label">Napomena</label>
                            <input
                                type="text"
                                className="form-input"
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                placeholder="Opciona napomena..."
                            />
                        </div>
                    </div>
                </div>
            </Modal>

            {/* View Work Order Modal */}
            <Modal
                isOpen={viewModal}
                onClose={() => setViewModal(false)}
                title={currentWorkOrder?.Work_Order_Number || ''}
                size="large"
                footer={
                    <div style={{ display: 'flex', gap: '12px', justifyContent: 'space-between', width: '100%' }}>
                        <div>
                            {currentWorkOrder?.Status === 'Završeno' && (
                                <span className="status-badge status-zavrseno" style={{ fontSize: '14px' }}>
                                    <span className="material-icons-round" style={{ fontSize: '16px' }}>check_circle</span>
                                    Završeno
                                </span>
                            )}
                        </div>
                        <div style={{ display: 'flex', gap: '12px' }}>
                            {currentWorkOrder?.Status === 'Nacrt' && (
                                <button className="btn btn-primary" onClick={() => handleStartWorkOrder(currentWorkOrder.Work_Order_ID)}>
                                    <span className="material-icons-round">play_arrow</span>
                                    Pokreni proizvodnju
                                </button>
                            )}
                            {currentWorkOrder?.Status === 'U toku' && (
                                <button className="btn btn-success" onClick={handleCompleteAllItems}>
                                    <span className="material-icons-round">done_all</span>
                                    Završi sve
                                </button>
                            )}
                            <button className="btn" onClick={() => setViewModal(false)}>Zatvori</button>
                        </div>
                    </div>
                }
            >
                {currentWorkOrder && (
                    <div className="work-order-details">
                        {/* Info Cards */}
                        <div className="info-cards">
                            <div className="info-card">
                                <span className="material-icons-round">construction</span>
                                <div>
                                    <div className="info-label">Korak</div>
                                    <div className="info-value">{currentWorkOrder.Production_Step}</div>
                                </div>
                            </div>
                            <div className="info-card">
                                <span className="material-icons-round">calendar_today</span>
                                <div>
                                    <div className="info-label">Kreirano</div>
                                    <div className="info-value">{formatDate(currentWorkOrder.Created_Date)}</div>
                                </div>
                            </div>
                            <div className="info-card">
                                <span className="material-icons-round">inventory_2</span>
                                <div>
                                    <div className="info-label">Proizvoda</div>
                                    <div className="info-value">{currentWorkOrder.items?.length || 0}</div>
                                </div>
                            </div>
                            {currentWorkOrder.Due_Date && (
                                <div className="info-card">
                                    <span className="material-icons-round">event</span>
                                    <div>
                                        <div className="info-label">Rok</div>
                                        <div className="info-value">{formatDate(currentWorkOrder.Due_Date)}</div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Progress */}
                        {currentWorkOrder.Status === 'U toku' && (
                            <div className="progress-section">
                                <div className="progress-header">
                                    <span>Napredak</span>
                                    <span>
                                        {currentWorkOrder.items?.filter(i => i.Status === 'Završeno').length || 0} / {currentWorkOrder.items?.length || 0}
                                    </span>
                                </div>
                                <div className="progress-bar">
                                    <div
                                        className="progress-fill"
                                        style={{
                                            width: `${((currentWorkOrder.items?.filter(i => i.Status === 'Završeno').length || 0) / (currentWorkOrder.items?.length || 1)) * 100}%`
                                        }}
                                    />
                                </div>
                            </div>
                        )}

                        {/* Items List */}
                        <div className="items-section">
                            <h4>Proizvodi</h4>
                            <div className="items-list">
                                {(currentWorkOrder.items || []).map(item => (
                                    <div
                                        key={item.ID}
                                        className={`item-row ${item.Status === 'Završeno' ? 'completed' : ''}`}
                                    >
                                        <div className="item-status-icon">
                                            <span className="material-icons-round">
                                                {item.Status === 'Završeno' ? 'check_circle' : 'radio_button_unchecked'}
                                            </span>
                                        </div>
                                        <div className="item-info">
                                            <div className="item-name">{item.Product_Name}</div>
                                            <div className="item-meta">
                                                {item.Project_Name} • {item.Quantity} kom
                                                {item.Worker_Name && (
                                                    <span className="worker-badge">
                                                        <span className="material-icons-round">person</span>
                                                        {item.Worker_Name}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        {item.Status !== 'Završeno' && currentWorkOrder.Status === 'U toku' && (
                                            <button
                                                className="btn btn-sm btn-success"
                                                onClick={() => handleCompleteItem(item.ID)}
                                            >
                                                <span className="material-icons-round">check</span>
                                                Završi
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>

                        {currentWorkOrder.Notes && (
                            <div className="notes-section">
                                <span className="material-icons-round">notes</span>
                                <span>{currentWorkOrder.Notes}</span>
                            </div>
                        )}
                    </div>
                )}
            </Modal>

            <style jsx>{`
                .production-grid {
                    display: flex;
                    flex-direction: column;
                    gap: 32px;
                }
                
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
                    color: var(--text);
                    margin: 0;
                }
                
                .work-orders-list {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
                    gap: 16px;
                }
                
                .create-work-order-form {
                    display: flex;
                    flex-direction: column;
                    gap: 24px;
                }
                
                .form-section {
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                }
                
                .form-label {
                    font-weight: 600;
                    font-size: 14px;
                    color: var(--text);
                }
                
                .form-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                
                .form-actions {
                    display: flex;
                    gap: 8px;
                }
                
                .step-buttons {
                    display: flex;
                    gap: 8px;
                    flex-wrap: wrap;
                }
                
                .step-btn {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 12px 20px;
                    border: 2px solid var(--border);
                    border-radius: 12px;
                    background: var(--surface);
                    color: var(--text-secondary);
                    font-weight: 500;
                    cursor: pointer;
                    transition: all 0.2s ease;
                }
                
                .step-btn:hover {
                    border-color: var(--accent);
                    color: var(--accent);
                }
                
                .step-btn.active {
                    border-color: var(--accent);
                    background: var(--accent);
                    color: white;
                }
                
                .empty-products {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    padding: 48px;
                    background: var(--surface-hover);
                    border-radius: 16px;
                    color: var(--text-secondary);
                    gap: 8px;
                }
                
                .empty-products .material-icons-round {
                    font-size: 48px;
                    opacity: 0.5;
                }
                
                .products-grid {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                    max-height: 300px;
                    overflow-y: auto;
                    padding: 4px;
                }
                
                .product-card {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    padding: 12px 16px;
                    background: var(--surface);
                    border: 2px solid var(--border);
                    border-radius: 12px;
                    cursor: pointer;
                    transition: all 0.2s ease;
                }
                
                .product-card:hover {
                    border-color: var(--accent);
                }
                
                .product-card.selected {
                    border-color: var(--accent);
                    background: rgba(0, 113, 227, 0.05);
                }
                
                .product-checkbox .material-icons-round {
                    color: var(--text-secondary);
                    font-size: 24px;
                }
                
                .product-card.selected .product-checkbox .material-icons-round {
                    color: var(--accent);
                }
                
                .product-info {
                    flex: 1;
                }
                
                .product-name {
                    font-weight: 500;
                    color: var(--text);
                }
                
                .product-meta {
                    font-size: 13px;
                    color: var(--text-secondary);
                }
                
                .status-badge.small {
                    font-size: 11px;
                    padding: 4px 8px;
                }
                
                .global-worker-row {
                    display: flex;
                    gap: 12px;
                    align-items: center;
                    padding: 16px;
                    background: var(--surface-hover);
                    border-radius: 12px;
                }
                
                .global-worker-row .filter-select {
                    flex: 1;
                }
                
                .worker-assignments {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                    max-height: 200px;
                    overflow-y: auto;
                }
                
                .worker-row {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    padding: 10px 12px;
                    background: var(--surface);
                    border: 1px solid var(--border);
                    border-radius: 8px;
                }
                
                .worker-product-info {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    gap: 2px;
                }
                
                .worker-product-info .product-name {
                    font-weight: 500;
                    font-size: 14px;
                }
                
                .worker-product-info .project-name {
                    font-size: 12px;
                    color: var(--text-secondary);
                }
                
                .worker-select {
                    padding: 6px 10px;
                    border: 1px solid var(--border);
                    border-radius: 6px;
                    background: var(--surface);
                    font-size: 13px;
                    min-width: 150px;
                }
                
                .assigned-badge {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    padding: 4px 10px;
                    background: var(--accent);
                    color: white;
                    border-radius: 20px;
                    font-size: 12px;
                    font-weight: 500;
                }
                
                .assigned-badge .material-icons-round {
                    font-size: 14px;
                }
                
                .form-row {
                    flex-direction: row;
                    gap: 16px;
                }
                
                .form-group {
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                    flex: 1;
                }
                
                .form-input {
                    padding: 10px 14px;
                    border: 1px solid var(--border);
                    border-radius: 8px;
                    background: var(--surface);
                    font-size: 14px;
                    color: var(--text);
                }
                
                .form-input:focus {
                    outline: none;
                    border-color: var(--accent);
                }
                
                /* View Modal Styles */
                .work-order-details {
                    display: flex;
                    flex-direction: column;
                    gap: 24px;
                }
                
                .info-cards {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
                    gap: 12px;
                }
                
                .info-card {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    padding: 16px;
                    background: var(--surface-hover);
                    border-radius: 12px;
                }
                
                .info-card .material-icons-round {
                    font-size: 24px;
                    color: var(--accent);
                }
                
                .info-label {
                    font-size: 12px;
                    color: var(--text-secondary);
                }
                
                .info-value {
                    font-weight: 600;
                    font-size: 16px;
                    color: var(--text);
                }
                
                .progress-section {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }
                
                .progress-header {
                    display: flex;
                    justify-content: space-between;
                    font-size: 14px;
                    font-weight: 500;
                }
                
                .progress-bar {
                    height: 8px;
                    background: var(--border);
                    border-radius: 4px;
                    overflow: hidden;
                }
                
                .progress-fill {
                    height: 100%;
                    background: var(--accent);
                    border-radius: 4px;
                    transition: width 0.3s ease;
                }
                
                .items-section h4 {
                    margin: 0 0 12px 0;
                    font-size: 14px;
                    font-weight: 600;
                }
                
                .items-list {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }
                
                .item-row {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    padding: 12px 16px;
                    background: var(--surface);
                    border: 1px solid var(--border);
                    border-radius: 10px;
                }
                
                .item-row.completed {
                    background: rgba(52, 199, 89, 0.08);
                    border-color: var(--success);
                }
                
                .item-status-icon .material-icons-round {
                    font-size: 24px;
                    color: var(--text-secondary);
                }
                
                .item-row.completed .item-status-icon .material-icons-round {
                    color: var(--success);
                }
                
                .item-info {
                    flex: 1;
                }
                
                .item-name {
                    font-weight: 500;
                }
                
                .item-meta {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-size: 13px;
                    color: var(--text-secondary);
                }
                
                .worker-badge {
                    display: inline-flex;
                    align-items: center;
                    gap: 4px;
                    padding: 2px 8px;
                    background: var(--accent-light);
                    color: var(--accent);
                    border-radius: 12px;
                    font-size: 12px;
                }
                
                .worker-badge .material-icons-round {
                    font-size: 14px;
                }
                
                .notes-section {
                    display: flex;
                    align-items: flex-start;
                    gap: 12px;
                    padding: 16px;
                    background: rgba(255, 149, 0, 0.1);
                    border-left: 3px solid var(--warning);
                    border-radius: 8px;
                    font-size: 14px;
                }
                
                .notes-section .material-icons-round {
                    color: var(--warning);
                }
                
                @media (max-width: 768px) {
                    .form-row {
                        flex-direction: column;
                    }
                    
                    .global-worker-row {
                        flex-direction: column;
                    }
                    
                    .step-buttons {
                        display: grid;
                        grid-template-columns: 1fr 1fr;
                    }
                    
                    .info-cards {
                        grid-template-columns: 1fr 1fr;
                    }
                }
            `}</style>
        </div>
    );
}

// Work Order Card Component
function WorkOrderCard({
    workOrder,
    onView,
    onDelete,
    onStart,
    getStatusClass,
    formatDate
}: {
    workOrder: WorkOrder;
    onView: () => void;
    onDelete: () => void;
    onStart: () => void;
    getStatusClass: (status: string) => string;
    formatDate: (date: string) => string;
}) {
    const itemCount = workOrder.items?.length || 0;
    const completedCount = workOrder.items?.filter(i => i.Status === 'Završeno').length || 0;
    const progress = itemCount > 0 ? Math.round((completedCount / itemCount) * 100) : 0;

    return (
        <div className="work-order-card" onClick={onView}>
            <div className="card-header">
                <div className="card-title">{workOrder.Work_Order_Number}</div>
                <span className={`status-badge ${getStatusClass(workOrder.Status)}`}>
                    {workOrder.Status}
                </span>
            </div>

            <div className="card-step">
                <span className="material-icons-round">construction</span>
                {workOrder.Production_Step}
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

            {workOrder.Status === 'U toku' && (
                <div className="card-progress">
                    <div className="progress-track">
                        <div className="progress-bar" style={{ width: `${progress}%` }} />
                    </div>
                    <span className="progress-text">{completedCount}/{itemCount}</span>
                </div>
            )}

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
                
                .card-step {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-weight: 500;
                    color: var(--text);
                }
                
                .card-step .material-icons-round {
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
                
                .card-progress {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }
                
                .progress-track {
                    flex: 1;
                    height: 6px;
                    background: var(--border);
                    border-radius: 3px;
                    overflow: hidden;
                }
                
                .progress-bar {
                    height: 100%;
                    background: var(--accent);
                    border-radius: 3px;
                    transition: width 0.3s ease;
                }
                
                .progress-text {
                    font-size: 12px;
                    font-weight: 500;
                    color: var(--text-secondary);
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
