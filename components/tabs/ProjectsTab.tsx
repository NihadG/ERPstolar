'use client';

import { useState } from 'react';
import type { Project, Material, Product, ProductMaterial, WorkOrder } from '@/lib/types';
import {
    saveProject,
    deleteProject,
    saveProduct,
    deleteProduct,
    addMaterialToProduct,
    deleteProductMaterial,
    updateProductMaterial,
    addGlassMaterialToProduct,
    updateGlassMaterial,
    addAluDoorMaterialToProduct,
    updateAluDoorMaterial
} from '@/lib/database';
import Modal from '@/components/ui/Modal';
import GlassModal, { type GlassModalData } from '@/components/ui/GlassModal';
import AluDoorModal, { type AluDoorModalData } from '@/components/ui/AluDoorModal';
import MaterialReportModal from '@/components/ui/MaterialReportModal';
import { PROJECT_STATUSES, PRODUCTION_MODES, PRODUCTION_STEPS } from '@/lib/types';

interface ProjectsTabProps {
    projects: Project[];
    materials: Material[];
    workOrders: WorkOrder[];
    onRefresh: () => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

export default function ProjectsTab({ projects, materials, workOrders = [], onRefresh, showToast }: ProjectsTabProps) {
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
    const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());

    // Modal states
    const [projectModal, setProjectModal] = useState(false);
    const [productModal, setProductModal] = useState(false);
    const [materialModal, setMaterialModal] = useState(false);
    const [glassModal, setGlassModal] = useState(false);
    const [aluDoorModal, setAluDoorModal] = useState(false);
    const [reportModal, setReportModal] = useState(false);
    const [reportProject, setReportProject] = useState<Project | null>(null);

    // Form states
    const [editingProject, setEditingProject] = useState<Partial<Project> | null>(null);
    const [editingProduct, setEditingProduct] = useState<Partial<Product> & { projectId?: string } | null>(null);
    const [addingMaterial, setAddingMaterial] = useState<{ productId: string } | null>(null);
    const [selectedMaterial, setSelectedMaterial] = useState<Material | null>(null);
    const [materialQty, setMaterialQty] = useState(1);
    const [materialPrice, setMaterialPrice] = useState(0);

    // Special material modal states
    const [glassProductId, setGlassProductId] = useState('');
    const [aluDoorProductId, setAluDoorProductId] = useState('');
    const [editingGlassMaterial, setEditingGlassMaterial] = useState<ProductMaterial | null>(null);
    const [editingAluDoorMaterial, setEditingAluDoorMaterial] = useState<ProductMaterial | null>(null);

    // Edit regular material modal
    const [editMaterialModal, setEditMaterialModal] = useState(false);
    const [editingMaterial, setEditingMaterial] = useState<ProductMaterial | null>(null);
    const [editMaterialQty, setEditMaterialQty] = useState(0);
    const [editMaterialPrice, setEditMaterialPrice] = useState(0);

    // Filter projects
    const filteredProjects = projects.filter(project => {
        const matchesSearch = project.Client_Name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            project.Address?.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesStatus = !statusFilter || project.Status === statusFilter;
        return matchesSearch && matchesStatus;
    });

    function toggleProject(projectId: string) {
        const newExpanded = new Set(expandedProjects);
        if (newExpanded.has(projectId)) {
            newExpanded.delete(projectId);
        } else {
            newExpanded.add(projectId);
        }
        setExpandedProjects(newExpanded);
    }

    function toggleProduct(productId: string) {
        const newExpanded = new Set(expandedProducts);
        if (newExpanded.has(productId)) {
            newExpanded.delete(productId);
        } else {
            newExpanded.add(productId);
        }
        setExpandedProducts(newExpanded);
    }

    function openProjectModal(project?: Project) {
        setEditingProject(project || {});
        setProjectModal(true);
    }

    function openProductModal(projectId: string, product?: Product) {
        setEditingProduct(product ? { ...product } : { projectId, Quantity: 1 });
        setProductModal(true);
    }

    function openMaterialModal(productId: string) {
        setAddingMaterial({ productId });
        setSelectedMaterial(null);
        setMaterialQty(1);
        setMaterialPrice(0);
        setMaterialModal(true);
    }

    async function handleSaveProject() {
        if (!editingProject?.Client_Name) {
            showToast('Unesite ime klijenta', 'error');
            return;
        }

        const result = await saveProject(editingProject);
        if (result.success) {
            showToast(result.message, 'success');
            setProjectModal(false);
            onRefresh();
        } else {
            showToast(result.message, 'error');
        }
    }

    async function handleDeleteProject(projectId: string) {
        if (!confirm('Jeste li sigurni da želite obrisati ovaj projekat?')) return;

        const result = await deleteProject(projectId);
        if (result.success) {
            showToast(result.message, 'success');
            onRefresh();
        } else {
            showToast(result.message, 'error');
        }
    }

    async function handleSaveProduct() {
        if (!editingProduct?.Name) {
            showToast('Unesite naziv proizvoda', 'error');
            return;
        }

        const productData = {
            ...editingProduct,
            Project_ID: editingProduct.Project_ID || editingProduct.projectId,
        };

        const result = await saveProduct(productData);
        if (result.success) {
            showToast(result.message, 'success');
            setProductModal(false);
            onRefresh();
        } else {
            showToast(result.message, 'error');
        }
    }

    async function handleDeleteProduct(productId: string) {
        if (!confirm('Jeste li sigurni da želite obrisati ovaj proizvod?')) return;

        const result = await deleteProduct(productId);
        if (result.success) {
            showToast(result.message, 'success');
            onRefresh();
        } else {
            showToast(result.message, 'error');
        }
    }

    // Check if material is glass or alu door type
    function isGlassMaterial(mat: Material): boolean {
        return mat.Is_Glass === true || mat.Category === 'Staklo';
    }

    function isAluDoorMaterial(mat: Material): boolean {
        return mat.Is_Alu_Door === true || mat.Category === 'Alu vrata';
    }

    async function handleAddMaterial() {
        if (!selectedMaterial || !addingMaterial) {
            showToast('Odaberite materijal', 'error');
            return;
        }

        // Check if this is a glass material - redirect to glass modal
        if (isGlassMaterial(selectedMaterial)) {
            setMaterialModal(false);
            setGlassProductId(addingMaterial.productId);
            setEditingGlassMaterial(null);
            setGlassModal(true);
            return;
        }

        // Check if this is an alu door material - redirect to alu door modal
        if (isAluDoorMaterial(selectedMaterial)) {
            setMaterialModal(false);
            setAluDoorProductId(addingMaterial.productId);
            setEditingAluDoorMaterial(null);
            setAluDoorModal(true);
            return;
        }

        const result = await addMaterialToProduct({
            Product_ID: addingMaterial.productId,
            Material_ID: selectedMaterial.Material_ID,
            Material_Name: selectedMaterial.Name,
            Quantity: materialQty,
            Unit: selectedMaterial.Unit,
            Unit_Price: materialPrice || selectedMaterial.Default_Unit_Price,
            Supplier: selectedMaterial.Default_Supplier,
        });

        if (result.success) {
            showToast(result.message, 'success');
            setMaterialModal(false);
            onRefresh();
        } else {
            showToast(result.message, 'error');
        }
    }

    // Handle glass modal save
    async function handleSaveGlass(data: GlassModalData) {
        let result;
        if (data.isEditMode && data.productMaterialId) {
            result = await updateGlassMaterial({
                productMaterialId: data.productMaterialId,
                unitPrice: data.unitPrice,
                items: data.items,
            });
        } else {
            result = await addGlassMaterialToProduct({
                productId: data.productId,
                materialId: data.materialId,
                materialName: data.materialName,
                supplier: data.supplier,
                unitPrice: data.unitPrice,
                items: data.items,
            });
        }

        if (result.success) {
            showToast(result.message, 'success');
            onRefresh();
        } else {
            showToast(result.message, 'error');
        }
    }

    // Handle alu door modal save
    async function handleSaveAluDoor(data: AluDoorModalData) {
        let result;
        if (data.isEditMode && data.productMaterialId) {
            result = await updateAluDoorMaterial({
                productMaterialId: data.productMaterialId,
                unitPrice: data.unitPrice,
                items: data.items,
            });
        } else {
            result = await addAluDoorMaterialToProduct({
                productId: data.productId,
                materialId: data.materialId,
                materialName: data.materialName,
                supplier: data.supplier,
                unitPrice: data.unitPrice,
                items: data.items,
            });
        }

        if (result.success) {
            showToast(result.message, 'success');
            onRefresh();
        } else {
            showToast(result.message, 'error');
        }
    }

    // Open glass modal for editing existing material
    function openGlassModalForEdit(productId: string, material: ProductMaterial) {
        setGlassProductId(productId);
        setEditingGlassMaterial(material);
        setSelectedMaterial(null);
        setGlassModal(true);
    }

    // Open alu door modal for editing existing material
    function openAluDoorModalForEdit(productId: string, material: ProductMaterial) {
        setAluDoorProductId(productId);
        setEditingAluDoorMaterial(material);
        setSelectedMaterial(null);
        setAluDoorModal(true);
    }

    async function handleDeleteMaterial(materialId: string) {
        if (!confirm('Jeste li sigurni da želite obrisati ovaj materijal?')) return;

        const result = await deleteProductMaterial(materialId);
        if (result.success) {
            showToast(result.message, 'success');
            onRefresh();
        } else {
            showToast(result.message, 'error');
        }
    }

    // Open edit material modal for regular materials
    function openEditMaterialModal(material: ProductMaterial) {
        setEditingMaterial(material);
        setEditMaterialQty(material.Quantity);
        setEditMaterialPrice(material.Unit_Price);
        setEditMaterialModal(true);
    }

    // Save edited material
    async function handleSaveEditMaterial() {
        if (!editingMaterial) return;

        const result = await updateProductMaterial(editingMaterial.ID, {
            Quantity: editMaterialQty,
            Unit_Price: editMaterialPrice,
            Total_Price: editMaterialQty * editMaterialPrice
        });

        if (result.success) {
            showToast('Materijal uspješno ažuriran', 'success');
            setEditMaterialModal(false);
            onRefresh();
        } else {
            showToast(result.message, 'error');
        }
    }

    function getStatusClass(status: string): string {
        return 'status-' + status.toLowerCase()
            .replace(/\s+/g, '-')
            .replace(/č/g, 'c')
            .replace(/ć/g, 'c')
            .replace(/š/g, 's')
            .replace(/ž/g, 'z')
            .replace(/đ/g, 'd');
    }

    function formatCurrency(amount: number): string {
        return amount.toFixed(2) + ' KM';
    }

    function getProductStatus(product: Product): string {
        // Find if product is in any active work order
        // Sort by created date desc to get latest
        const allWorkOrders = [...workOrders].sort((a, b) =>
            new Date(b.Created_Date).getTime() - new Date(a.Created_Date).getTime()
        );

        for (const wo of allWorkOrders) {
            const item = wo.items?.find(i => i.Product_ID === product.Product_ID);
            if (item) {
                // If item has specific process status
                if (item.Process_Assignments) {
                    // Check order of steps: Rezanje -> Kantiranje -> Bušenje -> Sklapanje
                    // Find the "deepest" active step

                    // First check if any is "U toku"
                    for (const step of PRODUCTION_STEPS) {
                        if (item.Process_Assignments[step]?.Status === 'U toku') {
                            return step; // E.g., "Rezanje"
                        }
                    }

                    // If none in progress, find the last "Završeno" one and show next, 
                    // or if all finished, show "Spremno"
                    let lastFinishedIndex = -1;
                    for (let i = 0; i < PRODUCTION_STEPS.length; i++) {
                        const step = PRODUCTION_STEPS[i];
                        if (item.Process_Assignments[step]?.Status === 'Završeno') {
                            lastFinishedIndex = i;
                        }
                    }

                    if (lastFinishedIndex === PRODUCTION_STEPS.length - 1) {
                        return 'Spremno';
                    }

                    if (lastFinishedIndex >= 0) {
                        // Return the next step
                        return PRODUCTION_STEPS[lastFinishedIndex + 1];
                    }

                    // If assigned but partially started/waiting
                    return 'U proizvodnji';
                }

                // Fallback to item status if no process details
                if (item.Status && item.Status !== 'Nacrt') {
                    return item.Status;
                }
            }
        }

        return product.Status || 'Na čekanju';
    }

    return (
        <div className="tab-content active" id="projects-content">
            <div className="content-header">
                <div className="search-box">
                    <span className="material-icons-round">search</span>
                    <input
                        type="text"
                        placeholder="Pretraži projekte..."
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
                    {PROJECT_STATUSES.map(status => (
                        <option key={status} value={status}>{status}</option>
                    ))}
                </select>
                <button className="btn btn-primary" onClick={() => openProjectModal()}>
                    <span className="material-icons-round">add</span>
                    Novi Projekat
                </button>
            </div>

            <div className="projects-list">
                {filteredProjects.length === 0 ? (
                    <div className="empty-state">
                        <span className="material-icons-round">folder_off</span>
                        <h3>Nema projekata</h3>
                        <p>Kreirajte prvi projekat klikom na "Novi Projekat"</p>
                    </div>
                ) : (
                    filteredProjects.map(project => {
                        const totalProducts = project.products?.length || 0;
                        const totalCost = project.products?.reduce((sum, p) => sum + (p.Material_Cost || 0), 0) || 0;

                        return (
                            <div key={project.Project_ID} className="project-card">
                                <div className="project-header" onClick={() => toggleProject(project.Project_ID)}>
                                    <button className={`expand-btn ${expandedProjects.has(project.Project_ID) ? 'expanded' : ''}`}>
                                        <span className="material-icons-round">chevron_right</span>
                                    </button>

                                    <div className="project-main-info">
                                        <div className="project-title-section">
                                            <div className="project-name">{project.Client_Name}</div>
                                            <div className="project-badges">
                                                <span className={`status-badge ${getStatusClass(project.Status)}`}>
                                                    {project.Status}
                                                </span>
                                                <span className="mode-badge">
                                                    {project.Production_Mode === 'PreCut' ? 'Gotovi elementi' : 'Vlastita obrada'}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="project-details">
                                            {project.Address && <div className="project-client">{project.Address}</div>}
                                            <div className="project-summary">
                                                <span className="summary-item">
                                                    <span className="material-icons-round">inventory_2</span>
                                                    {totalProducts} {totalProducts === 1 ? 'proizvod' : 'proizvoda'}
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="project-actions" onClick={(e) => e.stopPropagation()}>
                                        <button className="icon-btn" onClick={() => {
                                            setReportProject(project);
                                            setReportModal(true);
                                        }} title="Izvještaj o materijalima">
                                            <span className="material-icons-round">summarize</span>
                                        </button>
                                        <button className="icon-btn" onClick={() => openProjectModal(project)}>
                                            <span className="material-icons-round">edit</span>
                                        </button>
                                        <button className="icon-btn danger" onClick={() => handleDeleteProject(project.Project_ID)}>
                                            <span className="material-icons-round">delete</span>
                                        </button>
                                    </div>
                                </div>

                                {/* Products Section */}
                                <div className={`project-products ${expandedProjects.has(project.Project_ID) ? 'expanded' : ''}`}>
                                    <div className="products-header">
                                        <h4>Proizvodi ({project.products?.length || 0})</h4>
                                        <button className="btn-add-item" onClick={() => openProductModal(project.Project_ID)}>
                                            <span className="material-icons-round">add</span>
                                            Dodaj proizvod
                                        </button>
                                    </div>

                                    {project.products?.map(product => (
                                        <div key={product.Product_ID} className="product-card">
                                            <div className="product-header" onClick={() => toggleProduct(product.Product_ID)}>
                                                <button className={`expand-btn ${expandedProducts.has(product.Product_ID) ? 'expanded' : ''}`}>
                                                    <span className="material-icons-round">chevron_right</span>
                                                </button>
                                                <div className="product-info">
                                                    <div className="product-name">{product.Name}</div>
                                                    <div className="product-dims">
                                                        {product.Width && product.Height && product.Depth
                                                            ? `${product.Width} × ${product.Height} × ${product.Depth} mm`
                                                            : 'Dimenzije nisu unesene'}
                                                        {product.Quantity > 1 && ` • ${product.Quantity} kom`}
                                                    </div>
                                                </div>
                                                <span className={`status-badge ${getStatusClass(getProductStatus(product))}`}>
                                                    {getProductStatus(product)}
                                                </span>
                                                <div className="project-actions" onClick={(e) => e.stopPropagation()}>
                                                    <button className="icon-btn" onClick={() => openProductModal(project.Project_ID, product)}>
                                                        <span className="material-icons-round">edit</span>
                                                    </button>
                                                    <button className="icon-btn danger" onClick={() => handleDeleteProduct(product.Product_ID)}>
                                                        <span className="material-icons-round">delete</span>
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Materials Section */}
                                            <div className={`product-materials ${expandedProducts.has(product.Product_ID) ? 'expanded' : ''}`}>
                                                <div className="materials-header">
                                                    <h5>Materijali ({product.materials?.length || 0})</h5>
                                                    <button className="btn-add-item" onClick={() => openMaterialModal(product.Product_ID)}>
                                                        <span className="material-icons-round">add</span>
                                                        Dodaj materijal
                                                    </button>
                                                </div>

                                                {product.materials && product.materials.length > 0 && (
                                                    <div className="materials-table-header">
                                                        <div className="mat-col-name">Naziv</div>
                                                        <div className="mat-col-qty">Količina</div>
                                                        <div className="mat-col-price">Cijena</div>
                                                        <div className="mat-col-total">Ukupno</div>
                                                        <div className="mat-col-status">Status</div>
                                                        <div className="mat-col-actions">Akcije</div>
                                                    </div>
                                                )}

                                                {product.materials?.map(material => {
                                                    const isGlass = material.glassItems && material.glassItems.length > 0;
                                                    const isAluDoor = material.aluDoorItems && material.aluDoorItems.length > 0;
                                                    const glassCount = isGlass ? material.glassItems!.reduce((sum, gi) => sum + (gi.Qty || 1), 0) : 0;
                                                    const aluDoorCount = isAluDoor ? material.aluDoorItems!.reduce((sum, ai) => sum + (ai.Qty || 1), 0) : 0;

                                                    return (
                                                        <div key={material.ID} className="material-row">
                                                            <div className="mat-col-name">
                                                                <span className="material-name-text">{material.Material_Name}</span>
                                                                {isGlass && <span className="material-indicator glass">🪟 {glassCount} kom</span>}
                                                                {isAluDoor && <span className="material-indicator alu-door">🚪 {aluDoorCount} kom</span>}
                                                            </div>
                                                            <div className="mat-col-qty">
                                                                <span className="mobile-label">Količina:</span>
                                                                {material.Quantity} {material.Unit}
                                                            </div>
                                                            <div className="mat-col-price">
                                                                <span className="mobile-label">Cijena:</span>
                                                                {formatCurrency(material.Unit_Price)}
                                                            </div>
                                                            <div className="mat-col-total">
                                                                <span className="mobile-label">Ukupno:</span>
                                                                <strong>{formatCurrency(material.Total_Price)}</strong>
                                                            </div>
                                                            <div className="mat-col-status">
                                                                <span className={`status-badge ${getStatusClass(material.Status)}`}>
                                                                    {material.Status}
                                                                </span>
                                                            </div>
                                                            <div className="mat-col-actions">
                                                                <div className="action-buttons">
                                                                    {isGlass && (
                                                                        <button
                                                                            className="icon-btn"
                                                                            onClick={() => openGlassModalForEdit(product.Product_ID, material)}
                                                                            title="Uredi staklo"
                                                                        >
                                                                            <span className="material-icons-round">edit</span>
                                                                        </button>
                                                                    )}
                                                                    {isAluDoor && (
                                                                        <button
                                                                            className="icon-btn"
                                                                            onClick={() => openAluDoorModalForEdit(product.Product_ID, material)}
                                                                            title="Uredi alu vrata"
                                                                        >
                                                                            <span className="material-icons-round">edit</span>
                                                                        </button>
                                                                    )}
                                                                    {!isGlass && !isAluDoor && (
                                                                        <button
                                                                            className="icon-btn"
                                                                            onClick={() => openEditMaterialModal(material)}
                                                                            title="Uredi materijal"
                                                                        >
                                                                            <span className="material-icons-round">edit</span>
                                                                        </button>
                                                                    )}
                                                                    <button className="icon-btn danger" onClick={() => handleDeleteMaterial(material.ID)}>
                                                                        <span className="material-icons-round">delete</span>
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            {/* Project Modal */}
            <Modal
                isOpen={projectModal}
                onClose={() => setProjectModal(false)}
                title={editingProject?.Project_ID ? 'Uredi Projekat' : 'Novi Projekat'}
                footer={
                    <>
                        <button className="btn btn-secondary" onClick={() => setProjectModal(false)}>Otkaži</button>
                        <button className="btn btn-primary" onClick={handleSaveProject}>Sačuvaj</button>
                    </>
                }
            >
                <div className="form-group">
                    <label>Klijent *</label>
                    <input
                        type="text"
                        value={editingProject?.Client_Name || ''}
                        onChange={(e) => setEditingProject({ ...editingProject, Client_Name: e.target.value })}
                    />
                </div>
                <div className="form-row">
                    <div className="form-group">
                        <label>Telefon</label>
                        <input
                            type="tel"
                            value={editingProject?.Client_Phone || ''}
                            onChange={(e) => setEditingProject({ ...editingProject, Client_Phone: e.target.value })}
                        />
                    </div>
                    <div className="form-group">
                        <label>Email</label>
                        <input
                            type="email"
                            value={editingProject?.Client_Email || ''}
                            onChange={(e) => setEditingProject({ ...editingProject, Client_Email: e.target.value })}
                        />
                    </div>
                </div>
                <div className="form-group">
                    <label>Adresa</label>
                    <input
                        type="text"
                        value={editingProject?.Address || ''}
                        onChange={(e) => setEditingProject({ ...editingProject, Address: e.target.value })}
                    />
                </div>
                <div className="form-row">
                    <div className="form-group">
                        <label>Način proizvodnje</label>
                        <select
                            value={editingProject?.Production_Mode || 'PreCut'}
                            onChange={(e) => setEditingProject({ ...editingProject, Production_Mode: e.target.value as 'PreCut' | 'InHouse' })}
                        >
                            <option value="PreCut">Gotovi elementi</option>
                            <option value="InHouse">Vlastita obrada</option>
                        </select>
                    </div>
                    <div className="form-group">
                        <label>Rok</label>
                        <input
                            type="date"
                            value={editingProject?.Deadline?.split('T')[0] || ''}
                            onChange={(e) => setEditingProject({ ...editingProject, Deadline: e.target.value })}
                        />
                    </div>
                </div>
                <div className="form-group">
                    <label>Napomene</label>
                    <textarea
                        rows={3}
                        value={editingProject?.Notes || ''}
                        onChange={(e) => setEditingProject({ ...editingProject, Notes: e.target.value })}
                    />
                </div>
            </Modal>

            {/* Product Modal */}
            <Modal
                isOpen={productModal}
                onClose={() => setProductModal(false)}
                title={editingProduct?.Product_ID ? 'Uredi Proizvod' : 'Novi Proizvod'}
                footer={
                    <>
                        <button className="btn btn-secondary" onClick={() => setProductModal(false)}>Otkaži</button>
                        <button className="btn btn-primary" onClick={handleSaveProduct}>Sačuvaj</button>
                    </>
                }
            >
                <div className="form-group">
                    <label>Naziv *</label>
                    <input
                        type="text"
                        placeholder="npr. Gornji kuhinjski ormar"
                        value={editingProduct?.Name || ''}
                        onChange={(e) => setEditingProduct({ ...editingProduct, Name: e.target.value })}
                    />
                </div>
                <div className="form-row form-row-3">
                    <div className="form-group">
                        <label>Visina (mm)</label>
                        <input
                            type="number"
                            min="0"
                            value={editingProduct?.Height || ''}
                            onChange={(e) => setEditingProduct({ ...editingProduct, Height: parseInt(e.target.value) || 0 })}
                        />
                    </div>
                    <div className="form-group">
                        <label>Širina (mm)</label>
                        <input
                            type="number"
                            min="0"
                            value={editingProduct?.Width || ''}
                            onChange={(e) => setEditingProduct({ ...editingProduct, Width: parseInt(e.target.value) || 0 })}
                        />
                    </div>
                    <div className="form-group">
                        <label>Dubina (mm)</label>
                        <input
                            type="number"
                            min="0"
                            value={editingProduct?.Depth || ''}
                            onChange={(e) => setEditingProduct({ ...editingProduct, Depth: parseInt(e.target.value) || 0 })}
                        />
                    </div>
                </div>
                <div className="form-group">
                    <label>Količina</label>
                    <input
                        type="number"
                        min="1"
                        value={editingProduct?.Quantity || 1}
                        onChange={(e) => setEditingProduct({ ...editingProduct, Quantity: parseInt(e.target.value) || 1 })}
                    />
                </div>
                <div className="form-group">
                    <label>Napomene</label>
                    <textarea
                        rows={2}
                        value={editingProduct?.Notes || ''}
                        onChange={(e) => setEditingProduct({ ...editingProduct, Notes: e.target.value })}
                    />
                </div>
            </Modal>

            {/* Add Material Modal */}
            <Modal
                isOpen={materialModal}
                onClose={() => setMaterialModal(false)}
                title="Dodaj Materijal"
                footer={
                    <>
                        <button className="btn btn-secondary" onClick={() => setMaterialModal(false)}>Otkaži</button>
                        <button className="btn btn-primary" onClick={handleAddMaterial}>Dodaj</button>
                    </>
                }
            >
                <div className="form-group">
                    <label>Materijal *</label>
                    <select
                        value={selectedMaterial?.Material_ID || ''}
                        onChange={(e) => {
                            const mat = materials.find(m => m.Material_ID === e.target.value);
                            setSelectedMaterial(mat || null);
                            if (mat) {
                                setMaterialPrice(mat.Default_Unit_Price);
                            }
                        }}
                    >
                        <option value="">-- Odaberi materijal --</option>
                        {materials.map(mat => (
                            <option key={mat.Material_ID} value={mat.Material_ID}>
                                {mat.Name} ({mat.Category})
                            </option>
                        ))}
                    </select>
                </div>
                <div className="form-row">
                    <div className="form-group">
                        <label>Količina *</label>
                        <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={materialQty}
                            onChange={(e) => setMaterialQty(parseFloat(e.target.value) || 0)}
                        />
                    </div>
                    <div className="form-group">
                        <label>Jedinica</label>
                        <input
                            type="text"
                            readOnly
                            value={selectedMaterial?.Unit || ''}
                        />
                    </div>
                </div>
                <div className="form-group">
                    <label>Cijena po jedinici (KM)</label>
                    <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={materialPrice}
                        onChange={(e) => setMaterialPrice(parseFloat(e.target.value) || 0)}
                    />
                </div>
                <div className="form-group">
                    <label>Ukupno: <strong>{formatCurrency(materialQty * materialPrice)}</strong></label>
                </div>
            </Modal>

            {/* Glass Modal */}
            <GlassModal
                isOpen={glassModal}
                onClose={() => setGlassModal(false)}
                productId={glassProductId}
                material={selectedMaterial}
                existingMaterial={editingGlassMaterial}
                onSave={handleSaveGlass}
            />

            {/* Alu Door Modal */}
            <AluDoorModal
                isOpen={aluDoorModal}
                onClose={() => setAluDoorModal(false)}
                productId={aluDoorProductId}
                material={selectedMaterial}
                existingMaterial={editingAluDoorMaterial}
                onSave={handleSaveAluDoor}
            />

            {/* Material Report Modal */}
            <MaterialReportModal
                isOpen={reportModal}
                onClose={() => setReportModal(false)}
                project={reportProject}
                allMaterials={materials}
            />

            {/* Edit Material Modal */}
            <Modal
                isOpen={editMaterialModal}
                onClose={() => setEditMaterialModal(false)}
                title="Uredi Materijal"
                footer={
                    <>
                        <button className="btn btn-secondary" onClick={() => setEditMaterialModal(false)}>Otkaži</button>
                        <button className="btn btn-primary" onClick={handleSaveEditMaterial}>Sačuvaj</button>
                    </>
                }
            >
                {editingMaterial && (
                    <>
                        <div className="form-group">
                            <label>Materijal</label>
                            <input
                                type="text"
                                value={editingMaterial.Material_Name}
                                readOnly
                                disabled
                            />
                        </div>
                        <div className="form-row">
                            <div className="form-group">
                                <label>Količina *</label>
                                <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    value={editMaterialQty}
                                    onChange={(e) => setEditMaterialQty(parseFloat(e.target.value) || 0)}
                                />
                            </div>
                            <div className="form-group">
                                <label>Jedinica</label>
                                <input
                                    type="text"
                                    readOnly
                                    disabled
                                    value={editingMaterial.Unit || ''}
                                />
                            </div>
                        </div>
                        <div className="form-group">
                            <label>Cijena po jedinici (KM)</label>
                            <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={editMaterialPrice}
                                onChange={(e) => setEditMaterialPrice(parseFloat(e.target.value) || 0)}
                            />
                        </div>
                        <div className="form-group">
                            <label>Ukupno: <strong>{(editMaterialQty * editMaterialPrice).toFixed(2)} KM</strong></label>
                        </div>
                    </>
                )}
            </Modal>
        </div>
    );
}
