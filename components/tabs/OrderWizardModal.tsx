'use client';

import { useMemo } from 'react';
import Modal from '../ui/Modal';

interface Project {
    Project_ID: string;
    Client_Name: string;
    products?: { Product_ID: string; Name: string; Quantity?: number }[];
}

interface Product {
    Product_ID: string;
    Name: string;
    Project_Name: string;
    Quantity?: number;
}

interface Supplier {
    Supplier_ID: string;
    Name: string;
    Contact_Person?: string;
}

interface Material {
    ID: string;
    Material_Name: string;
    Product_Name: string;
    Project_Name: string;
    Quantity: number;
    Unit: string;
    Unit_Price: number;
    Total_Price: number;
    On_Stock?: number;
}

interface GroupedMaterial {
    key: string;
    materialName: string;
    unit: string;
    memberIds: string[];
    members: Material[];
    totalQuantity: number;
    totalPrice: number;
    unitPrice: number;
    sources: string[]; // "Product • Project" list
}

interface OrderWizardModalProps {
    isOpen: boolean;
    onClose: () => void;
    wizardStep: number;
    setWizardStep: (step: number) => void;
    projectsWithMaterials: Project[];
    selectedProjectIds: Set<string>;
    toggleProject: (id: string) => void;
    availableProducts: Product[];
    selectedProductIds: Set<string>;
    toggleProduct: (id: string) => void;
    setSelectedProductIds: (ids: Set<string>) => void;
    availableSuppliers: Supplier[];
    selectedSupplierId: string;
    setSelectedSupplierId: (id: string) => void;
    setSelectedMaterialIds: (ids: Set<string>) => void;
    filteredMaterials: Material[];
    selectedMaterialIds: Set<string>;
    toggleMaterial: (id: string) => void;
    selectAllMaterials: () => void;
    selectedTotal: number;
    formatCurrency: (value: number) => string;
    handleCreateOrder: () => void;
    isSubmitting?: boolean;
    isEditing?: boolean;
    orderQuantities: Record<string, number>;
    onStockQuantities: Record<string, number>;
    setOrderQuantity: (materialId: string, quantity: number) => void;
    setOnStockQuantity: (materialId: string, quantity: number) => void;
}

function GroupedMaterialsStep({
    filteredMaterials,
    selectedMaterialIds,
    setSelectedMaterialIds,
    selectAllMaterials,
    selectedTotal,
    formatCurrency,
    orderQuantities,
    onStockQuantities,
    setOrderQuantity,
    setOnStockQuantity,
}: {
    filteredMaterials: Material[];
    selectedMaterialIds: Set<string>;
    setSelectedMaterialIds: (ids: Set<string>) => void;
    selectAllMaterials: () => void;
    selectedTotal: number;
    formatCurrency: (value: number) => string;
    orderQuantities: Record<string, number>;
    onStockQuantities: Record<string, number>;
    setOrderQuantity: (materialId: string, quantity: number) => void;
    setOnStockQuantity: (materialId: string, quantity: number) => void;
}) {
    // Group materials by Material_Name + Unit
    const groupedMaterials = useMemo(() => {
        const groups = new Map<string, GroupedMaterial>();

        filteredMaterials.forEach(m => {
            const key = `${m.Material_Name}||${m.Unit}`;
            if (groups.has(key)) {
                const g = groups.get(key)!;
                g.memberIds.push(m.ID);
                g.members.push(m);
                g.totalQuantity += m.Quantity;
                g.totalPrice += m.Total_Price;
                const source = `${m.Product_Name} • ${m.Project_Name}`;
                if (!g.sources.includes(source)) {
                    g.sources.push(source);
                }
            } else {
                groups.set(key, {
                    key,
                    materialName: m.Material_Name,
                    unit: m.Unit,
                    memberIds: [m.ID],
                    members: [m],
                    totalQuantity: m.Quantity,
                    totalPrice: m.Total_Price,
                    unitPrice: m.Unit_Price || (m.Total_Price / m.Quantity) || 0,
                    sources: [`${m.Product_Name} • ${m.Project_Name}`],
                });
            }
        });

        // Recalculate unit price as weighted average for groups
        groups.forEach(g => {
            if (g.totalQuantity > 0) {
                g.unitPrice = g.totalPrice / g.totalQuantity;
            }
        });

        return Array.from(groups.values());
    }, [filteredMaterials]);

    const totalGroupCount = groupedMaterials.length;
    const selectedGroupCount = groupedMaterials.filter(g =>
        g.memberIds.every(id => selectedMaterialIds.has(id))
    ).length;

    function toggleGroup(group: GroupedMaterial) {
        const allSelected = group.memberIds.every(id => selectedMaterialIds.has(id));
        const newSelected = new Set(selectedMaterialIds);
        if (allSelected) {
            group.memberIds.forEach(id => newSelected.delete(id));
        } else {
            group.memberIds.forEach(id => newSelected.add(id));
        }
        setSelectedMaterialIds(newSelected);
    }

    function isGroupSelected(group: GroupedMaterial) {
        return group.memberIds.every(id => selectedMaterialIds.has(id));
    }

    // For a grouped material, aggregate on_stock and order quantities
    function getGroupAggregates(group: GroupedMaterial) {
        let totalOnStock = 0;
        let totalOrderQty = 0;
        group.members.forEach(m => {
            const onStock = onStockQuantities[m.ID] ?? (m.On_Stock || 0);
            const orderQty = orderQuantities[m.ID] ?? Math.max(0, m.Quantity - onStock);
            totalOnStock += onStock;
            totalOrderQty += orderQty;
        });
        return { totalOnStock, totalOrderQty };
    }

    // Distribute a new total on-stock value proportionally across group members
    function setGroupOnStock(group: GroupedMaterial, newTotalOnStock: number) {
        const totalNeeded = group.totalQuantity;
        group.members.forEach(m => {
            const proportion = totalNeeded > 0 ? m.Quantity / totalNeeded : 1 / group.members.length;
            const memberStock = Math.min(m.Quantity, Math.round(newTotalOnStock * proportion * 100) / 100);
            setOnStockQuantity(m.ID, memberStock);
            const newOrderQty = Math.max(0, m.Quantity - memberStock);
            setOrderQuantity(m.ID, newOrderQty);
        });
    }

    // Distribute a new total order quantity proportionally across group members
    function setGroupOrderQty(group: GroupedMaterial, newTotalOrderQty: number) {
        const totalNeeded = group.totalQuantity;
        group.members.forEach(m => {
            const proportion = totalNeeded > 0 ? m.Quantity / totalNeeded : 1 / group.members.length;
            const memberOrderQty = Math.round(newTotalOrderQty * proportion * 100) / 100;
            setOrderQuantity(m.ID, Math.max(0, memberOrderQty));
        });
    }

    return (
        <div className="wizard-step-container">
            <div className="step-header-row">
                <div>
                    <h3>Odaberite materijale</h3>
                    <div className="step-subtitle-row">
                        <span>{selectedGroupCount} od {totalGroupCount} odabrano</span>
                        <span className="total-price">{formatCurrency(selectedTotal)}</span>
                    </div>
                </div>
                <div className="step-actions">
                    <button className="btn btn-secondary" onClick={selectAllMaterials}>Odaberi sve</button>
                    {selectedMaterialIds.size > 0 && (
                        <button className="btn btn-secondary danger-text" onClick={() => setSelectedMaterialIds(new Set())}>Poništi</button>
                    )}
                </div>
            </div>
            <div className="wizard-list-container">
                {groupedMaterials.map((group) => {
                    const selected = isGroupSelected(group);
                    const { totalOnStock, totalOrderQty } = getGroupAggregates(group);
                    const orderTotal = totalOrderQty * group.unitPrice;

                    return (
                        <div
                            key={group.key}
                            className={`wizard-list-item material-item ${selected ? 'selected' : ''}`}
                            style={{ flexDirection: 'column', alignItems: 'stretch', gap: '12px' }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <span
                                    className="material-icons-round check-icon"
                                    onClick={(e) => { e.stopPropagation(); toggleGroup(group); }}
                                    style={{ cursor: 'pointer' }}
                                >
                                    {selected ? 'check_box' : 'check_box_outline_blank'}
                                </span>
                                <div style={{ flex: 1 }}>
                                    <div className="item-title">{group.materialName}</div>
                                    <div className="item-subtitle" style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                        {group.sources.length <= 3 ? (
                                            group.sources.map((src, i) => (
                                                <span key={i}>{src}</span>
                                            ))
                                        ) : (
                                            <>
                                                {group.sources.slice(0, 2).map((src, i) => (
                                                    <span key={i}>{src}</span>
                                                ))}
                                                <span style={{ color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
                                                    +{group.sources.length - 2} više
                                                </span>
                                            </>
                                        )}
                                    </div>
                                </div>
                                {group.members.length > 1 && (
                                    <span className="item-badge" style={{ fontSize: '11px' }}>
                                        {group.members.length} stavki
                                    </span>
                                )}
                            </div>

                            {selected && (
                                <div style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(3, 1fr)',
                                    gap: '12px',
                                    padding: '12px',
                                    background: 'var(--bg-tertiary)',
                                    borderRadius: '8px',
                                    marginLeft: '36px'
                                }}>
                                    <div>
                                        <label style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px', display: 'block' }}>
                                            Potrebno
                                        </label>
                                        <div style={{ fontWeight: 600, fontSize: '14px' }}>
                                            {group.totalQuantity} {group.unit}
                                        </div>
                                    </div>
                                    <div>
                                        <label style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px', display: 'block' }}>
                                            Na stanju
                                        </label>
                                        <input
                                            type="number"
                                            min="0"
                                            max={group.totalQuantity}
                                            value={totalOnStock}
                                            onChange={(e) => {
                                                e.stopPropagation();
                                                const newStock = Math.max(0, parseFloat(e.target.value) || 0);
                                                setGroupOnStock(group, newStock);
                                            }}
                                            onClick={(e) => e.stopPropagation()}
                                            style={{
                                                width: '100%',
                                                padding: '8px 10px',
                                                border: '1px solid var(--border-color)',
                                                borderRadius: '6px',
                                                fontSize: '14px',
                                                background: 'var(--bg-primary)'
                                            }}
                                        />
                                    </div>
                                    <div>
                                        <label style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px', display: 'block' }}>
                                            Naruči
                                        </label>
                                        <input
                                            type="number"
                                            min="0"
                                            value={totalOrderQty}
                                            onChange={(e) => {
                                                e.stopPropagation();
                                                setGroupOrderQty(group, Math.max(0, parseFloat(e.target.value) || 0));
                                            }}
                                            onClick={(e) => e.stopPropagation()}
                                            style={{
                                                width: '100%',
                                                padding: '8px 10px',
                                                border: '1px solid var(--border-color)',
                                                borderRadius: '6px',
                                                fontSize: '14px',
                                                background: 'var(--bg-primary)',
                                                fontWeight: 600
                                            }}
                                        />
                                    </div>
                                    <div style={{ gridColumn: 'span 3', display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '8px', borderTop: '1px solid var(--border-color)' }}>
                                        <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                            {group.unitPrice.toFixed(2)} KM/{group.unit} × {totalOrderQty} {group.unit}
                                        </span>
                                        <span style={{ fontWeight: 600, fontSize: '14px' }}>
                                            = {formatCurrency(orderTotal)}
                                        </span>
                                    </div>
                                </div>
                            )}

                            {!selected && (
                                <div style={{ marginLeft: '36px', display: 'flex', gap: '16px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                                    <span>{group.totalQuantity} {group.unit}</span>
                                    <span>{formatCurrency(group.totalPrice)}</span>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
            {filteredMaterials.length === 0 && (
                <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-secondary)' }}>
                    <span className="material-icons-round" style={{ fontSize: '64px', color: 'var(--text-tertiary)', marginBottom: '16px', display: 'block' }}>inventory_2</span>
                    <p style={{ fontSize: '16px' }}>Nema materijala za odabranog dobavljača</p>
                </div>
            )}
        </div>
    );
}

export function OrderWizardModal({
    isOpen,
    onClose,
    wizardStep,
    setWizardStep,
    projectsWithMaterials,
    selectedProjectIds,
    toggleProject,
    availableProducts,
    selectedProductIds,
    toggleProduct,
    setSelectedProductIds,
    availableSuppliers,
    selectedSupplierId,
    setSelectedSupplierId,
    setSelectedMaterialIds,
    filteredMaterials,
    selectedMaterialIds,
    toggleMaterial,
    selectAllMaterials,
    selectedTotal,
    formatCurrency,
    handleCreateOrder,
    isSubmitting,
    orderQuantities,
    onStockQuantities,
    setOrderQuantity,
    setOnStockQuantity,
    isEditing
}: OrderWizardModalProps) {
    const canGoNext =
        (wizardStep === 1 && selectedProjectIds.size > 0) ||
        (wizardStep === 2 && selectedProductIds.size > 0) ||
        (wizardStep === 3 && !!selectedSupplierId);

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="" size="fullscreen" footer={null}>
            <div className="wizard-container">
                {/* Step Navigation Header */}
                <div className="wizard-header">
                    <div className="wizard-nav-left">
                        <button
                            className="glass-btn wizard-nav-btn"
                            onClick={onClose}
                            title="Izađi"
                            style={{
                                marginRight: '8px',
                                width: '40px',
                                padding: '0',
                                justifyContent: 'center',
                                minWidth: '40px'
                            }}
                        >
                            <span className="material-icons-round">close</span>
                        </button>
                        {wizardStep > 1 && (
                            <button
                                className="glass-btn wizard-nav-btn"
                                onClick={() => setWizardStep(wizardStep - 1)}
                            >
                                <span className="material-icons-round">arrow_back</span>
                                <span className="wizard-btn-text">Nazad</span>
                            </button>
                        )}
                    </div>
                    <div className="wizard-stepper">
                        {[1, 2, 3, 4].map((step, idx) => (
                            <div key={step} className={`step-item ${step <= wizardStep ? 'active' : ''}`}>
                                <div className="step-circle">
                                    {step < wizardStep ? '✓' : step}
                                </div>
                                {idx < 3 && (
                                    <div className={`step-line ${step < wizardStep ? 'active' : ''}`} />
                                )}
                            </div>
                        ))}
                    </div>
                    <div className="wizard-nav-right">
                        {wizardStep === 4 ? (
                            <button
                                className="glass-btn glass-btn-primary wizard-nav-btn"
                                onClick={handleCreateOrder}
                                disabled={selectedMaterialIds.size === 0 || isSubmitting}
                            >
                                {isSubmitting ? (
                                    <span className="material-icons-round" style={{ animation: 'spin 1s linear infinite' }}>sync</span>
                                ) : (
                                    <>
                                        <span className="wizard-btn-text">{isEditing ? 'Spremi' : 'Kreiraj'}</span>
                                        <span className="material-icons-round">check</span>
                                    </>
                                )}
                            </button>
                        ) : (
                            <button
                                className="glass-btn glass-btn-primary wizard-nav-btn"
                                onClick={() => setWizardStep(wizardStep + 1)}
                                disabled={!canGoNext}
                            >
                                <span className="wizard-btn-text">Dalje</span>
                                <span className="material-icons-round">arrow_forward</span>
                            </button>
                        )}
                    </div>
                </div>

                {/* WIZARD BODY */}
                <div className="wizard-body">
                    {/* STEP 1: PROJECTS */}
                    {wizardStep === 1 && (
                        <div className="wizard-step-container">
                            <div className="step-header">
                                <h3>Odaberite projekte</h3>
                                <p>Za koje projekte kreirate narudžbu materijala?</p>
                            </div>
                            <div className="wizard-grid projects-grid">
                                {projectsWithMaterials.map(project => (
                                    <div
                                        key={project.Project_ID}
                                        onClick={() => toggleProject(project.Project_ID)}
                                        className={`wizard-card project-card ${selectedProjectIds.has(project.Project_ID) ? 'selected' : ''}`}
                                    >
                                        <span className="material-icons-round check-icon">
                                            {selectedProjectIds.has(project.Project_ID) ? 'check_circle' : 'radio_button_unchecked'}
                                        </span>
                                        <div style={{ flex: 1 }}>
                                            <div style={{ fontWeight: 600, fontSize: '16px', marginBottom: '4px' }}>{project.Client_Name}</div>
                                            <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>{project.products?.length || 0} proizvoda</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            {projectsWithMaterials.length === 0 && (
                                <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-secondary)' }}>
                                    <span className="material-icons-round" style={{ fontSize: '64px', color: 'var(--text-tertiary)', marginBottom: '16px', display: 'block' }}>folder_off</span>
                                    <p style={{ fontSize: '16px' }}>Nema projekata sa nenaručenim materijalima</p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* STEP 2: PRODUCTS */}
                    {wizardStep === 2 && (
                        <div className="wizard-step-container">
                            <div className="step-header-row">
                                <div>
                                    <h3>Odaberite proizvode</h3>
                                    <span>{selectedProductIds.size} od {availableProducts.length} odabrano</span>
                                </div>
                                <div className="step-actions">
                                    <button
                                        className="btn btn-secondary"
                                        onClick={() => {
                                            const newSet = new Set(selectedProductIds);
                                            availableProducts.forEach(p => newSet.add(p.Product_ID));
                                            setSelectedProductIds(newSet);
                                        }}
                                    >Odaberi sve</button>
                                    {selectedProductIds.size > 0 && (
                                        <button
                                            className="btn btn-secondary danger-text"
                                            onClick={() => {
                                                setSelectedProductIds(new Set());
                                                setSelectedSupplierId('');
                                                setSelectedMaterialIds(new Set());
                                            }}
                                        >Poništi</button>
                                    )}
                                </div>
                            </div>
                            <div className="wizard-list-container">
                                {availableProducts.map((product, idx) => (
                                    <div
                                        key={product.Product_ID}
                                        onClick={() => toggleProduct(product.Product_ID)}
                                        className={`wizard-list-item product-item ${selectedProductIds.has(product.Product_ID) ? 'selected' : ''}`}
                                    >
                                        <span className="material-icons-round check-icon">
                                            {selectedProductIds.has(product.Product_ID) ? 'check_box' : 'check_box_outline_blank'}
                                        </span>
                                        <div style={{ flex: 1 }}>
                                            <div className="item-title">{product.Name}</div>
                                            <div className="item-subtitle">{product.Project_Name}</div>
                                        </div>
                                        <span className="item-badge">{product.Quantity || 1} kom</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* STEP 3: SUPPLIER */}
                    {wizardStep === 3 && (
                        <div className="wizard-step-container">
                            <div className="step-header">
                                <h3>Odaberite dobavljača</h3>
                                <p>Od kojeg dobavljača naručujete materijale?</p>
                            </div>
                            <div className="wizard-grid suppliers-grid">
                                {availableSuppliers.map(supplier => (
                                    <div
                                        key={supplier.Supplier_ID}
                                        onClick={() => {
                                            setSelectedSupplierId(supplier.Supplier_ID);
                                            setSelectedMaterialIds(new Set());
                                        }}
                                        className={`wizard-card supplier-card ${selectedSupplierId === supplier.Supplier_ID ? 'selected' : ''}`}
                                    >
                                        <div className="supplier-avatar">
                                            <span className="material-icons-round">store</span>
                                        </div>
                                        <div className="supplier-name">{supplier.Name}</div>
                                        {supplier.Contact_Person && (
                                            <div className="supplier-contact">{supplier.Contact_Person}</div>
                                        )}
                                        {selectedSupplierId === supplier.Supplier_ID && (
                                            <span className="material-icons-round check-badge">check_circle</span>
                                        )}
                                    </div>
                                ))}
                            </div>
                            {availableSuppliers.length === 0 && (
                                <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-secondary)' }}>
                                    <span className="material-icons-round" style={{ fontSize: '64px', color: 'var(--text-tertiary)', marginBottom: '16px', display: 'block' }}>store_mall_directory</span>
                                    <p style={{ fontSize: '16px' }}>Nema dostupnih dobavljača za odabrane proizvode</p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* STEP 4: MATERIALS (GROUPED) */}
                    {wizardStep === 4 && (
                        <GroupedMaterialsStep
                            filteredMaterials={filteredMaterials}
                            selectedMaterialIds={selectedMaterialIds}
                            setSelectedMaterialIds={setSelectedMaterialIds}
                            selectAllMaterials={selectAllMaterials}
                            selectedTotal={selectedTotal}
                            formatCurrency={formatCurrency}
                            orderQuantities={orderQuantities}
                            onStockQuantities={onStockQuantities}
                            setOrderQuantity={setOrderQuantity}
                            setOnStockQuantity={setOnStockQuantity}
                        />
                    )}
                </div>
            </div>
        </Modal>
    );
}
