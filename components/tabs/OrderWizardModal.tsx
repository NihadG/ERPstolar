'use client';

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
    // New props for custom quantities
    orderQuantities: Record<string, number>;
    onStockQuantities: Record<string, number>;
    setOrderQuantity: (materialId: string, quantity: number) => void;
    setOnStockQuantity: (materialId: string, quantity: number) => void;
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
    orderQuantities,
    onStockQuantities,
    setOrderQuantity,
    setOnStockQuantity
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
                                disabled={selectedMaterialIds.size === 0}
                            >
                                <span className="wizard-btn-text">Kreiraj</span>
                                <span className="material-icons-round">check</span>
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

                    {/* STEP 4: MATERIALS */}
                    {wizardStep === 4 && (
                        <div className="wizard-step-container">
                            <div className="step-header-row">
                                <div>
                                    <h3>Odaberite materijale</h3>
                                    <div className="step-subtitle-row">
                                        <span>{selectedMaterialIds.size} od {filteredMaterials.length} odabrano</span>
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
                                {filteredMaterials.map((material, idx) => {
                                    const onStock = onStockQuantities[material.ID] ?? (material.On_Stock || 0);
                                    const orderQty = orderQuantities[material.ID] ?? Math.max(0, material.Quantity - onStock);
                                    const unitPrice = material.Unit_Price || (material.Total_Price / material.Quantity) || 0;
                                    const orderTotal = orderQty * unitPrice;

                                    return (
                                        <div
                                            key={material.ID}
                                            className={`wizard-list-item material-item ${selectedMaterialIds.has(material.ID) ? 'selected' : ''}`}
                                            style={{ flexDirection: 'column', alignItems: 'stretch', gap: '12px' }}
                                        >
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                <span
                                                    className="material-icons-round check-icon"
                                                    onClick={(e) => { e.stopPropagation(); toggleMaterial(material.ID); }}
                                                    style={{ cursor: 'pointer' }}
                                                >
                                                    {selectedMaterialIds.has(material.ID) ? 'check_box' : 'check_box_outline_blank'}
                                                </span>
                                                <div style={{ flex: 1 }}>
                                                    <div className="item-title">{material.Material_Name}</div>
                                                    <div className="item-subtitle">{material.Product_Name} • {material.Project_Name}</div>
                                                </div>
                                            </div>

                                            {selectedMaterialIds.has(material.ID) && (
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
                                                            {material.Quantity} {material.Unit}
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <label style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px', display: 'block' }}>
                                                            Na stanju
                                                        </label>
                                                        <input
                                                            type="number"
                                                            min="0"
                                                            max={material.Quantity}
                                                            value={onStock}
                                                            onChange={(e) => {
                                                                e.stopPropagation();
                                                                const newStock = Math.max(0, parseFloat(e.target.value) || 0);
                                                                setOnStockQuantity(material.ID, newStock);
                                                                // Auto-adjust order quantity
                                                                const newOrderQty = Math.max(0, material.Quantity - newStock);
                                                                setOrderQuantity(material.ID, newOrderQty);
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
                                                            value={orderQty}
                                                            onChange={(e) => {
                                                                e.stopPropagation();
                                                                setOrderQuantity(material.ID, Math.max(0, parseFloat(e.target.value) || 0));
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
                                                            {unitPrice.toFixed(2)} KM/{material.Unit} × {orderQty} {material.Unit}
                                                        </span>
                                                        <span style={{ fontWeight: 600, fontSize: '14px' }}>
                                                            = {formatCurrency(orderTotal)}
                                                        </span>
                                                    </div>
                                                </div>
                                            )}

                                            {!selectedMaterialIds.has(material.ID) && (
                                                <div style={{ marginLeft: '36px', display: 'flex', gap: '16px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                                                    <span>{material.Quantity} {material.Unit}</span>
                                                    <span>{formatCurrency(material.Total_Price)}</span>
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
                    )}
                </div>
            </div>
        </Modal>
    );
}
