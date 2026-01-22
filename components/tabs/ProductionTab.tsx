'use client';

import { useState, useMemo } from 'react';
import type { WorkOrder, WorkOrderItem, Project, Worker } from '@/lib/types';
import { createWorkOrder, deleteWorkOrder, startWorkOrder, updateWorkOrderStatus, completeWorkOrderItem, getWorkOrder } from '@/lib/database';
import Modal from '@/components/ui/Modal';
import { WORK_ORDER_STATUSES, PRODUCTION_STEPS } from '@/lib/types';

interface ProductionTabProps {
    workOrders: WorkOrder[];
    projects: Project[];
    workers: Worker[];
    onRefresh: () => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

export default function ProductionTab({ workOrders, projects, workers, onRefresh, showToast }: ProductionTabProps) {
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('');

    // Create Work Order Wizard
    const [wizardModal, setWizardModal] = useState(false);
    const [wizardStep, setWizardStep] = useState(1);
    const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(new Set());
    const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
    const [selectedWorkerId, setSelectedWorkerId] = useState('');
    const [selectedProductionStep, setSelectedProductionStep] = useState('Rezanje');
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

    // Get products that need the selected production step
    const availableProducts = useMemo(() => {
        if (selectedProjectIds.size === 0) return [];
        const products: any[] = [];

        // Status that can receive each production step
        const eligibleStatuses: Record<string, string[]> = {
            'Rezanje': ['Na čekanju', 'Materijali naručeni', 'Materijali spremni'],
            'Kantiranje': ['Rezanje'],
            'Bušenje': ['Kantiranje'],
            'Sklapanje': ['Bušenje'],
        };

        const eligible = eligibleStatuses[selectedProductionStep] || [];

        projects.forEach(project => {
            if (selectedProjectIds.has(project.Project_ID)) {
                (project.products || []).forEach(product => {
                    // Check if product status is eligible for this step
                    if (eligible.includes(product.Status)) {
                        products.push({
                            ...product,
                            Project_Name: project.Client_Name,
                            Project_ID: project.Project_ID,
                        });
                    }
                });
            }
        });
        return products;
    }, [selectedProjectIds, projects, selectedProductionStep]);

    // Projects with eligible products
    const projectsWithProducts = useMemo(() => {
        const eligibleStatuses: Record<string, string[]> = {
            'Rezanje': ['Na čekanju', 'Materijali naručeni', 'Materijali spremni'],
            'Kantiranje': ['Rezanje'],
            'Bušenje': ['Kantiranje'],
            'Sklapanje': ['Bušenje'],
        };
        const eligible = eligibleStatuses[selectedProductionStep] || [];

        return projects.filter(p =>
            (p.products || []).some(prod => eligible.includes(prod.Status))
        );
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

    function openWizard() {
        setWizardStep(1);
        setSelectedProjectIds(new Set());
        setSelectedProductIds(new Set());
        setSelectedWorkerId('');
        setSelectedProductionStep('Rezanje');
        setDueDate('');
        setNotes('');
        setWizardModal(true);
    }

    function toggleProject(projectId: string) {
        const newSelected = new Set(selectedProjectIds);
        if (newSelected.has(projectId)) {
            newSelected.delete(projectId);
        } else {
            newSelected.add(projectId);
        }
        setSelectedProjectIds(newSelected);
        setSelectedProductIds(new Set());
    }

    function toggleProduct(productId: string) {
        const newSelected = new Set(selectedProductIds);
        if (newSelected.has(productId)) {
            newSelected.delete(productId);
        } else {
            newSelected.add(productId);
        }
        setSelectedProductIds(newSelected);
    }

    function selectAllProducts() {
        setSelectedProductIds(new Set(availableProducts.map(p => p.Product_ID)));
    }

    function nextStep() {
        if (wizardStep === 1 && selectedProjectIds.size === 0) {
            showToast('Odaberite barem jedan projekat', 'error');
            return;
        }
        if (wizardStep === 2 && selectedProductIds.size === 0) {
            showToast('Odaberite barem jedan proizvod', 'error');
            return;
        }
        setWizardStep(wizardStep + 1);
    }

    function prevStep() {
        setWizardStep(wizardStep - 1);
    }

    async function handleCreateWorkOrder() {
        if (selectedProductIds.size === 0) {
            showToast('Odaberite barem jedan proizvod', 'error');
            return;
        }

        const worker = workers.find(w => w.Worker_ID === selectedWorkerId);

        const items = Array.from(selectedProductIds).map(productId => {
            const product = availableProducts.find(p => p.Product_ID === productId);
            return {
                Product_ID: productId,
                Product_Name: product?.Name || '',
                Project_ID: product?.Project_ID || '',
                Project_Name: product?.Project_Name || '',
                Quantity: product?.Quantity || 1,
                Worker_ID: selectedWorkerId || undefined,
                Worker_Name: worker?.Name || undefined,
            };
        });

        const result = await createWorkOrder({
            Production_Step: selectedProductionStep,
            Due_Date: dueDate,
            Notes: notes,
            items,
        });

        if (result.success) {
            showToast(`Radni nalog ${result.data?.Work_Order_Number} kreiran`, 'success');
            setWizardModal(false);
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
            // Refresh current work order
            const updated = await getWorkOrder(currentWorkOrder.Work_Order_ID);
            setCurrentWorkOrder(updated);

            // Check if all items are done
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

    return (
        <div className="tab-content active" id="production-content">
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
                <button className="btn btn-primary" onClick={openWizard}>
                    <span className="material-icons-round">add</span>
                    Novi Radni Nalog
                </button>
            </div>

            <div className="orders-list">
                {filteredWorkOrders.length === 0 ? (
                    <div className="empty-state">
                        <span className="material-icons-round">engineering</span>
                        <h3>Nema radnih naloga</h3>
                        <p>Kreirajte prvi radni nalog klikom na "Novi Radni Nalog"</p>
                    </div>
                ) : (
                    filteredWorkOrders.map(wo => {
                        const itemCount = wo.items?.length || 0;
                        const completedCount = wo.items?.filter(i => i.Status === 'Završeno').length || 0;
                        const progress = itemCount > 0 ? Math.round((completedCount / itemCount) * 100) : 0;
                        const showProgress = wo.Status === 'U toku' || wo.Status === 'Dodijeljeno';

                        return (
                            <div key={wo.Work_Order_ID} className="order-card" onClick={() => openViewModal(wo.Work_Order_ID)} style={{ cursor: 'pointer' }}>
                                <div className="order-card-main" style={{ flex: 1 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                                        <div>
                                            <div style={{ fontWeight: 600, fontSize: '16px', color: 'var(--accent)' }}>{wo.Work_Order_Number}</div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px', color: 'var(--text-secondary)', fontSize: '13px' }}>
                                                <span className="material-icons-round" style={{ fontSize: '16px' }}>construction</span>
                                                {wo.Production_Step}
                                            </div>
                                        </div>
                                        <span className={`status-badge ${getStatusClass(wo.Status)}`}>
                                            {wo.Status || 'Nacrt'}
                                        </span>
                                    </div>
                                    <div style={{ display: 'flex', gap: '16px', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: showProgress ? '12px' : '0' }}>
                                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                            <span className="material-icons-round" style={{ fontSize: '16px' }}>calendar_today</span>
                                            {formatDate(wo.Created_Date)}
                                        </span>
                                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                            <span className="material-icons-round" style={{ fontSize: '16px' }}>inventory_2</span>
                                            {itemCount} proizvoda
                                        </span>
                                    </div>
                                    {showProgress && (
                                        <div style={{ position: 'relative' }}>
                                            <div style={{
                                                height: '6px',
                                                background: 'var(--border)',
                                                borderRadius: '3px',
                                                overflow: 'hidden'
                                            }}>
                                                <div style={{
                                                    width: `${progress}%`,
                                                    height: '100%',
                                                    background: progress === 100 ? 'var(--success)' : 'var(--accent)',
                                                    borderRadius: '3px',
                                                    transition: 'width 0.3s ease'
                                                }} />
                                            </div>
                                            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                                                {completedCount}/{itemCount} završeno
                                            </div>
                                        </div>
                                    )}
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px', minWidth: '120px' }}>
                                    <div style={{ display: 'flex', gap: '6px' }} onClick={(e) => e.stopPropagation()}>
                                        {wo.Status === 'Nacrt' && (
                                            <button
                                                className="btn btn-sm btn-primary"
                                                onClick={() => handleStartWorkOrder(wo.Work_Order_ID)}
                                            >
                                                <span className="material-icons-round">play_arrow</span>
                                            </button>
                                        )}
                                        <button className="icon-btn danger" onClick={() => handleDeleteWorkOrder(wo.Work_Order_ID)}>
                                            <span className="material-icons-round">delete</span>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            {/* Work Order Creation Modal */}
            <Modal
                isOpen={wizardModal}
                onClose={() => setWizardModal(false)}
                title=""
                size="fullscreen"
                footer={null}
            >
                <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                    {/* Header */}
                    <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '16px 24px',
                        borderBottom: '1px solid var(--border)',
                        background: 'var(--surface)'
                    }}>
                        <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 600 }}>Novi Radni Nalog</h2>
                        <button
                            className="icon-btn"
                            onClick={() => setWizardModal(false)}
                        >
                            <span className="material-icons-round">close</span>
                        </button>
                    </div>

                    {/* Content - Sidebar + Main */}
                    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                        {/* Sidebar */}
                        <div style={{
                            width: '400px',
                            minWidth: '400px',
                            borderRight: '1px solid var(--border)',
                            display: 'flex',
                            flexDirection: 'column',
                            background: 'var(--surface)',
                            overflow: 'hidden'
                        }}>
                            {/* Production Step Selection */}
                            <div style={{ padding: '16px', borderBottom: '1px solid var(--border)' }}>
                                <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500, fontSize: '14px' }}>
                                    Proizvodni korak
                                </label>
                                <select
                                    className="filter-select"
                                    value={selectedProductionStep}
                                    onChange={(e) => {
                                        setSelectedProductionStep(e.target.value);
                                        setSelectedProjectIds(new Set());
                                        setSelectedProductIds(new Set());
                                    }}
                                    style={{ width: '100%' }}
                                >
                                    {PRODUCTION_STEPS.map(step => (
                                        <option key={step} value={step}>{step}</option>
                                    ))}
                                </select>
                            </div>

                            {/* Projects Panel */}
                            <div style={{
                                flex: '0 0 auto',
                                maxHeight: '40%',
                                display: 'flex',
                                flexDirection: 'column',
                                borderBottom: '1px solid var(--border)',
                            }}>
                                <div style={{ padding: '12px 16px', fontWeight: 600, fontSize: '14px', background: 'var(--surface-hover)' }}>
                                    1. Odaberi projekte ({selectedProjectIds.size})
                                </div>
                                <div style={{ flex: 1, overflow: 'auto', padding: '8px' }}>
                                    {projectsWithProducts.length === 0 ? (
                                        <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                                            Nema projekata sa proizvodima za ovaj korak
                                        </div>
                                    ) : (
                                        projectsWithProducts.map(project => (
                                            <label
                                                key={project.Project_ID}
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '10px',
                                                    padding: '10px 12px',
                                                    borderRadius: '8px',
                                                    cursor: 'pointer',
                                                    background: selectedProjectIds.has(project.Project_ID) ? 'var(--accent-light)' : 'transparent',
                                                }}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={selectedProjectIds.has(project.Project_ID)}
                                                    onChange={() => toggleProject(project.Project_ID)}
                                                />
                                                <div>
                                                    <div style={{ fontWeight: 500 }}>{project.Client_Name}</div>
                                                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                                        {(project.products || []).length} proizvoda
                                                    </div>
                                                </div>
                                            </label>
                                        ))
                                    )}
                                </div>
                            </div>

                            {/* Products Panel */}
                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                                <div style={{
                                    padding: '12px 16px',
                                    fontWeight: 600,
                                    fontSize: '14px',
                                    background: 'var(--surface-hover)',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center'
                                }}>
                                    <span>2. Odaberi proizvode ({selectedProductIds.size})</span>
                                    {availableProducts.length > 0 && (
                                        <button
                                            className="btn btn-sm"
                                            onClick={selectAllProducts}
                                            style={{ fontSize: '12px' }}
                                        >
                                            Odaberi sve
                                        </button>
                                    )}
                                </div>
                                <div style={{ flex: 1, overflow: 'auto', padding: '8px' }}>
                                    {availableProducts.length === 0 ? (
                                        <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                                            {selectedProjectIds.size === 0 ? 'Prvo odaberite projekte' : 'Nema proizvoda za odabrani korak'}
                                        </div>
                                    ) : (
                                        availableProducts.map(product => (
                                            <label
                                                key={product.Product_ID}
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '10px',
                                                    padding: '10px 12px',
                                                    borderRadius: '8px',
                                                    cursor: 'pointer',
                                                    background: selectedProductIds.has(product.Product_ID) ? 'var(--accent-light)' : 'transparent',
                                                }}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={selectedProductIds.has(product.Product_ID)}
                                                    onChange={() => toggleProduct(product.Product_ID)}
                                                />
                                                <div style={{ flex: 1 }}>
                                                    <div style={{ fontWeight: 500 }}>{product.Name}</div>
                                                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                                        {product.Project_Name} • {product.Quantity} kom • Status: {product.Status}
                                                    </div>
                                                </div>
                                            </label>
                                        ))
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Main Content */}
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                            <div style={{ flex: 1, overflow: 'auto', padding: '24px' }}>
                                <h3 style={{ marginBottom: '16px' }}>3. Dodatne postavke</h3>

                                <div style={{ display: 'grid', gap: '16px', maxWidth: '500px' }}>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '6px', fontWeight: 500 }}>
                                            Dodijeli radnika (opciono)
                                        </label>
                                        <select
                                            className="filter-select"
                                            value={selectedWorkerId}
                                            onChange={(e) => setSelectedWorkerId(e.target.value)}
                                            style={{ width: '100%' }}
                                        >
                                            <option value="">-- Bez radnika --</option>
                                            {workers.map(worker => (
                                                <option key={worker.Worker_ID} value={worker.Worker_ID}>
                                                    {worker.Name} ({worker.Role})
                                                </option>
                                            ))}
                                        </select>
                                    </div>

                                    <div>
                                        <label style={{ display: 'block', marginBottom: '6px', fontWeight: 500 }}>
                                            Rok završetka (opciono)
                                        </label>
                                        <input
                                            type="date"
                                            value={dueDate}
                                            onChange={(e) => setDueDate(e.target.value)}
                                            style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--border)' }}
                                        />
                                    </div>

                                    <div>
                                        <label style={{ display: 'block', marginBottom: '6px', fontWeight: 500 }}>
                                            Napomena
                                        </label>
                                        <textarea
                                            value={notes}
                                            onChange={(e) => setNotes(e.target.value)}
                                            placeholder="Unesite napomenu..."
                                            rows={3}
                                            style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--border)', resize: 'vertical' }}
                                        />
                                    </div>
                                </div>

                                {/* Summary */}
                                <div style={{ marginTop: '32px', padding: '16px', background: 'var(--surface-hover)', borderRadius: '12px' }}>
                                    <h4 style={{ marginBottom: '12px' }}>Pregled radnog naloga</h4>
                                    <div style={{ display: 'grid', gap: '8px', fontSize: '14px' }}>
                                        <div><strong>Korak:</strong> {selectedProductionStep}</div>
                                        <div><strong>Projekata:</strong> {selectedProjectIds.size}</div>
                                        <div><strong>Proizvoda:</strong> {selectedProductIds.size}</div>
                                        {selectedWorkerId && (
                                            <div><strong>Radnik:</strong> {workers.find(w => w.Worker_ID === selectedWorkerId)?.Name}</div>
                                        )}
                                        {dueDate && <div><strong>Rok:</strong> {formatDate(dueDate)}</div>}
                                    </div>
                                </div>
                            </div>

                            {/* Footer */}
                            <div style={{
                                padding: '16px 24px',
                                borderTop: '1px solid var(--border)',
                                display: 'flex',
                                justifyContent: 'flex-end',
                                gap: '12px'
                            }}>
                                <button className="btn" onClick={() => setWizardModal(false)}>
                                    Odustani
                                </button>
                                <button
                                    className="btn btn-primary"
                                    onClick={handleCreateWorkOrder}
                                    disabled={selectedProductIds.size === 0}
                                >
                                    <span className="material-icons-round">add</span>
                                    Kreiraj Radni Nalog
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </Modal>

            {/* View Work Order Modal */}
            <Modal
                isOpen={viewModal}
                onClose={() => setViewModal(false)}
                title={`Radni nalog: ${currentWorkOrder?.Work_Order_Number || ''}`}
                size="large"
                footer={
                    <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                        {currentWorkOrder?.Status === 'Nacrt' && (
                            <button className="btn btn-primary" onClick={() => handleStartWorkOrder(currentWorkOrder.Work_Order_ID)}>
                                <span className="material-icons-round">play_arrow</span>
                                Pokreni
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
                }
            >
                {currentWorkOrder && (
                    <div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '24px' }}>
                            <div style={{ padding: '16px', background: 'var(--surface-hover)', borderRadius: '12px' }}>
                                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>Status</div>
                                <span className={`status-badge ${getStatusClass(currentWorkOrder.Status)}`}>
                                    {currentWorkOrder.Status}
                                </span>
                            </div>
                            <div style={{ padding: '16px', background: 'var(--surface-hover)', borderRadius: '12px' }}>
                                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>Korak</div>
                                <div style={{ fontWeight: 600 }}>{currentWorkOrder.Production_Step}</div>
                            </div>
                            <div style={{ padding: '16px', background: 'var(--surface-hover)', borderRadius: '12px' }}>
                                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>Kreirano</div>
                                <div style={{ fontWeight: 600 }}>{formatDate(currentWorkOrder.Created_Date)}</div>
                            </div>
                        </div>

                        <h4 style={{ marginBottom: '12px' }}>Proizvodi ({currentWorkOrder.items?.length || 0})</h4>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {(currentWorkOrder.items || []).map(item => (
                                <div
                                    key={item.ID}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        padding: '12px 16px',
                                        background: item.Status === 'Završeno' ? 'rgba(52, 199, 89, 0.1)' : 'var(--surface-hover)',
                                        borderRadius: '8px',
                                        border: item.Status === 'Završeno' ? '1px solid var(--success)' : '1px solid var(--border)',
                                    }}
                                >
                                    <div>
                                        <div style={{ fontWeight: 500 }}>{item.Product_Name}</div>
                                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                            {item.Project_Name} • {item.Quantity} kom
                                            {item.Worker_Name && ` • Radnik: ${item.Worker_Name}`}
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                        <span className={`status-badge ${getStatusClass(item.Status)}`}>
                                            {item.Status}
                                        </span>
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
                                </div>
                            ))}
                        </div>

                        {currentWorkOrder.Notes && (
                            <div style={{ marginTop: '24px', padding: '16px', background: 'rgba(255, 149, 0, 0.1)', borderRadius: '12px', borderLeft: '3px solid var(--warning)' }}>
                                <strong>Napomena:</strong> {currentWorkOrder.Notes}
                            </div>
                        )}
                    </div>
                )}
            </Modal>
        </div>
    );
}
