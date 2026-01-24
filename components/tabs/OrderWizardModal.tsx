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
    Total_Price: number;
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
    handleCreateOrder
}: OrderWizardModalProps) {
    const canGoNext =
        (wizardStep === 1 && selectedProjectIds.size > 0) ||
        (wizardStep === 2 && selectedProductIds.size > 0) ||
        (wizardStep === 3 && !!selectedSupplierId);

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="" size="fullscreen" footer={null}>
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                {/* Step Navigation Header */}
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: '120px 1fr 120px',
                    alignItems: 'center',
                    padding: '12px 20px',
                    borderBottom: '1px solid var(--border)',
                    background: 'var(--surface)',
                    height: '60px'
                }}>
                    <div>
                        {wizardStep > 1 && (
                            <button
                                className="btn btn-secondary"
                                onClick={() => setWizardStep(wizardStep - 1)}
                                style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                            >
                                <span className="material-icons-round" style={{ fontSize: '18px' }}>arrow_back</span>
                                Nazad
                            </button>
                        )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                        {[1, 2, 3, 4].map((step, idx) => (
                            <div key={step} style={{ display: 'flex', alignItems: 'center' }}>
                                <div style={{
                                    width: '28px',
                                    height: '28px',
                                    borderRadius: '50%',
                                    background: step <= wizardStep ? 'var(--accent)' : 'var(--border)',
                                    color: step <= wizardStep ? 'white' : 'var(--text-secondary)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: '13px',
                                    fontWeight: 600
                                }}>
                                    {step < wizardStep ? '✓' : step}
                                </div>
                                {idx < 3 && (
                                    <div style={{
                                        width: '20px',
                                        height: '2px',
                                        background: step < wizardStep ? 'var(--accent)' : 'var(--border)',
                                        marginLeft: '6px'
                                    }} />
                                )}
                            </div>
                        ))}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        {wizardStep === 4 ? (
                            <button
                                className="btn btn-primary"
                                onClick={handleCreateOrder}
                                disabled={selectedMaterialIds.size === 0}
                                style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                            >
                                Kreiraj
                                <span className="material-icons-round" style={{ fontSize: '18px' }}>check</span>
                            </button>
                        ) : (
                            <button
                                className="btn btn-primary"
                                onClick={() => setWizardStep(wizardStep + 1)}
                                disabled={!canGoNext}
                                style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                            >
                                Dalje
                                <span className="material-icons-round" style={{ fontSize: '18px' }}>arrow_forward</span>
                            </button>
                        )}
                    </div>
                </div>

                {/* WIZARD BODY */}
                <div style={{ flex: 1, overflow: 'auto', padding: '24px', background: 'var(--bg)' }}>
                    {/* STEP 1: PROJECTS */}
                    {wizardStep === 1 && (
                        <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
                            <div style={{ textAlign: 'center', marginBottom: '32px' }}>
                                <h3 style={{ margin: '0 0 8px 0', fontSize: '24px', fontWeight: 600 }}>Odaberite projekte</h3>
                                <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '15px' }}>Za koje projekte kreirate narudžbu materijala?</p>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
                                {projectsWithMaterials.map(project => (
                                    <div
                                        key={project.Project_ID}
                                        onClick={() => toggleProject(project.Project_ID)}
                                        style={{
                                            padding: '20px',
                                            background: selectedProjectIds.has(project.Project_ID) ? 'var(--accent-light)' : 'white',
                                            border: selectedProjectIds.has(project.Project_ID) ? '2px solid var(--accent)' : '1px solid var(--border)',
                                            borderRadius: '16px',
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '16px',
                                            transition: 'all 0.2s ease',
                                            boxShadow: selectedProjectIds.has(project.Project_ID) ? '0 4px 12px rgba(0,113,227,0.15)' : '0 2px 8px rgba(0,0,0,0.04)'
                                        }}
                                    >
                                        <span className="material-icons-round" style={{
                                            fontSize: '28px',
                                            color: selectedProjectIds.has(project.Project_ID) ? 'var(--accent)' : 'var(--text-tertiary)'
                                        }}>
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
                        <div style={{ maxWidth: '900px', margin: '0 auto' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                                <div>
                                    <h3 style={{ margin: '0 0 4px 0', fontSize: '24px', fontWeight: 600 }}>Odaberite proizvode</h3>
                                    <span style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>{selectedProductIds.size} od {availableProducts.length} odabrano</span>
                                </div>
                                <div style={{ display: 'flex', gap: '12px' }}>
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
                                            className="btn btn-secondary"
                                            style={{ color: 'var(--error)' }}
                                            onClick={() => {
                                                setSelectedProductIds(new Set());
                                                setSelectedSupplierId('');
                                                setSelectedMaterialIds(new Set());
                                            }}
                                        >Poništi</button>
                                    )}
                                </div>
                            </div>
                            <div style={{
                                background: 'white',
                                borderRadius: '16px',
                                border: '1px solid var(--border)',
                                overflow: 'hidden',
                                boxShadow: '0 2px 8px rgba(0,0,0,0.04)'
                            }}>
                                {availableProducts.map((product, idx) => (
                                    <div
                                        key={product.Product_ID}
                                        onClick={() => toggleProduct(product.Product_ID)}
                                        style={{
                                            padding: '16px 20px',
                                            background: selectedProductIds.has(product.Product_ID) ? 'var(--accent-light)' : 'transparent',
                                            borderBottom: idx < availableProducts.length - 1 ? '1px solid var(--border-light)' : 'none',
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '16px',
                                            transition: 'background 0.15s ease'
                                        }}
                                    >
                                        <span className="material-icons-round" style={{
                                            fontSize: '24px',
                                            color: selectedProductIds.has(product.Product_ID) ? 'var(--accent)' : 'var(--text-tertiary)'
                                        }}>
                                            {selectedProductIds.has(product.Product_ID) ? 'check_box' : 'check_box_outline_blank'}
                                        </span>
                                        <div style={{ flex: 1 }}>
                                            <div style={{ fontWeight: 500, fontSize: '15px' }}>{product.Name}</div>
                                            <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '2px' }}>{product.Project_Name}</div>
                                        </div>
                                        <span style={{
                                            background: 'var(--bg)',
                                            padding: '6px 12px',
                                            borderRadius: '8px',
                                            fontSize: '13px',
                                            fontWeight: 500,
                                            color: 'var(--text-secondary)'
                                        }}>{product.Quantity || 1} kom</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* STEP 3: SUPPLIER */}
                    {wizardStep === 3 && (
                        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
                            <div style={{ textAlign: 'center', marginBottom: '32px' }}>
                                <h3 style={{ margin: '0 0 8px 0', fontSize: '24px', fontWeight: 600 }}>Odaberite dobavljača</h3>
                                <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '15px' }}>Od kojeg dobavljača naručujete materijale?</p>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '20px' }}>
                                {availableSuppliers.map(supplier => (
                                    <div
                                        key={supplier.Supplier_ID}
                                        onClick={() => {
                                            setSelectedSupplierId(supplier.Supplier_ID);
                                            setSelectedMaterialIds(new Set());
                                        }}
                                        style={{
                                            padding: '24px',
                                            background: selectedSupplierId === supplier.Supplier_ID ? 'var(--accent-light)' : 'white',
                                            border: selectedSupplierId === supplier.Supplier_ID ? '2px solid var(--accent)' : '1px solid var(--border)',
                                            borderRadius: '16px',
                                            cursor: 'pointer',
                                            textAlign: 'center',
                                            position: 'relative',
                                            transition: 'all 0.2s ease',
                                            boxShadow: selectedSupplierId === supplier.Supplier_ID ? '0 4px 12px rgba(0,113,227,0.15)' : '0 2px 8px rgba(0,0,0,0.04)'
                                        }}
                                    >
                                        <div style={{
                                            width: '56px',
                                            height: '56px',
                                            borderRadius: '50%',
                                            background: selectedSupplierId === supplier.Supplier_ID ? 'var(--accent)' : 'var(--bg)',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            margin: '0 auto 16px'
                                        }}>
                                            <span className="material-icons-round" style={{
                                                color: selectedSupplierId === supplier.Supplier_ID ? 'white' : 'var(--accent)',
                                                fontSize: '28px'
                                            }}>store</span>
                                        </div>
                                        <div style={{ fontWeight: 600, fontSize: '16px' }}>{supplier.Name}</div>
                                        {supplier.Contact_Person && (
                                            <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '6px' }}>{supplier.Contact_Person}</div>
                                        )}
                                        {selectedSupplierId === supplier.Supplier_ID && (
                                            <span className="material-icons-round" style={{
                                                position: 'absolute',
                                                top: '12px',
                                                right: '12px',
                                                color: 'var(--accent)',
                                                fontSize: '22px'
                                            }}>check_circle</span>
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
                        <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                                <div>
                                    <h3 style={{ margin: '0 0 4px 0', fontSize: '24px', fontWeight: 600 }}>Odaberite materijale</h3>
                                    <div style={{ display: 'flex', gap: '20px', fontSize: '14px' }}>
                                        <span style={{ color: 'var(--text-secondary)' }}>{selectedMaterialIds.size} od {filteredMaterials.length} odabrano</span>
                                        <span style={{ color: 'var(--accent)', fontWeight: 700, fontSize: '16px' }}>{formatCurrency(selectedTotal)}</span>
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: '12px' }}>
                                    <button className="btn btn-secondary" onClick={selectAllMaterials}>Odaberi sve</button>
                                    {selectedMaterialIds.size > 0 && (
                                        <button className="btn btn-secondary" style={{ color: 'var(--error)' }} onClick={() => setSelectedMaterialIds(new Set())}>Poništi</button>
                                    )}
                                </div>
                            </div>
                            <div style={{
                                background: 'white',
                                borderRadius: '16px',
                                border: '1px solid var(--border)',
                                overflow: 'hidden',
                                boxShadow: '0 2px 8px rgba(0,0,0,0.04)'
                            }}>
                                {filteredMaterials.map((material, idx) => (
                                    <div
                                        key={material.ID}
                                        onClick={() => toggleMaterial(material.ID)}
                                        style={{
                                            padding: '16px 20px',
                                            background: selectedMaterialIds.has(material.ID) ? 'var(--accent-light)' : 'transparent',
                                            borderBottom: idx < filteredMaterials.length - 1 ? '1px solid var(--border-light)' : 'none',
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '16px',
                                            transition: 'background 0.15s ease'
                                        }}
                                    >
                                        <span className="material-icons-round" style={{
                                            fontSize: '24px',
                                            color: selectedMaterialIds.has(material.ID) ? 'var(--accent)' : 'var(--text-tertiary)'
                                        }}>
                                            {selectedMaterialIds.has(material.ID) ? 'check_box' : 'check_box_outline_blank'}
                                        </span>
                                        <div style={{ flex: 1 }}>
                                            <div style={{ fontWeight: 500, fontSize: '15px' }}>{material.Material_Name}</div>
                                            <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '2px' }}>{material.Product_Name} • {material.Project_Name}</div>
                                        </div>
                                        <div style={{ textAlign: 'right' }}>
                                            <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>{material.Quantity} {material.Unit}</div>
                                            <div style={{ fontWeight: 700, color: 'var(--accent)', fontSize: '15px', marginTop: '2px' }}>{formatCurrency(material.Total_Price)}</div>
                                        </div>
                                    </div>
                                ))}
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
