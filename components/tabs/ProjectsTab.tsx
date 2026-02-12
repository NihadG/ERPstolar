'use client';

import { useState } from 'react';
import type { Project, Material, Product, ProductMaterial, WorkOrder, Offer, OfferProduct, WorkLog } from '@/lib/types';
import { ALLOWED_MATERIAL_TRANSITIONS } from '@/lib/types';
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
import { SearchableSelect } from '@/components/ui/SearchableSelect';

import ProductTimelineModal from '@/components/ui/ProductTimelineModal';
import { useData } from '@/context/DataContext';
import { PROJECT_STATUSES, PRODUCTION_STEPS, MATERIAL_CATEGORIES } from '@/lib/types';
import { useIsMobile } from '@/hooks/useIsMobile';
import MobileProjectsView from './mobile/MobileProjectsView';
import MobileMaterialEditModal from './mobile/MobileMaterialEditModal';
import MobileProjectModal from './mobile/MobileProjectModal';
import MobileProductModal from './mobile/MobileProductModal';
import MobileMaterialAddModal from './mobile/MobileMaterialAddModal';

interface ProjectsTabProps {
    projects: Project[];
    materials: Material[];
    workOrders: WorkOrder[];
    offers?: Offer[];
    workLogs?: WorkLog[];
    onRefresh: (...collections: string[]) => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
    onNavigateToTasks?: (projectId: string) => void;  // Navigate to tasks filtered by project
}

export default function ProjectsTab({ projects, materials, workOrders = [], offers = [], workLogs = [], onRefresh, showToast, onNavigateToTasks }: ProjectsTabProps) {
    const { organizationId } = useData();
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);
    const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());
    const [expandedStatusGroups, setExpandedStatusGroups] = useState<Set<string>>(new Set());
    const [actionsDropdownProjectId, setActionsDropdownProjectId] = useState<string | null>(null);
    const [showMaterialsSummary, setShowMaterialsSummary] = useState<Set<string>>(new Set());

    function toggleStatusGroup(status: string) {
        const newExpanded = new Set(expandedStatusGroups);
        if (newExpanded.has(status)) {
            newExpanded.delete(status);
        } else {
            newExpanded.add(status);
        }
        setExpandedStatusGroups(newExpanded);
    }

    // Modal states
    const [projectModal, setProjectModal] = useState(false);
    const [productModal, setProductModal] = useState(false);
    const [materialModal, setMaterialModal] = useState(false);
    const [glassModal, setGlassModal] = useState(false);
    const [aluDoorModal, setAluDoorModal] = useState(false);


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
    const [editMaterialIsEssential, setEditMaterialIsEssential] = useState(false);

    // Material status dropdown
    const [statusDropdownMaterialId, setStatusDropdownMaterialId] = useState<string | null>(null);

    // Quick edit mode for materials
    const [quickEditMode, setQuickEditMode] = useState<string | null>(null); // Product_ID in quick edit mode
    const [editingMaterialValues, setEditingMaterialValues] = useState<Record<string, { qty: number; price: number }>>({});

    // Product Timeline Modal
    const [timelineProduct, setTimelineProduct] = useState<{ product: Product; sellingPrice?: number; materialCost?: number; laborCost?: number; profit?: number; profitMargin?: number } | null>(null);

    // Filter projects
    const filteredProjects = projects.filter(project => {
        const matchesSearch = project.Client_Name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            project.Name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            project.Address?.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesStatus = !statusFilter || project.Status === statusFilter;
        return matchesSearch && matchesStatus;
    });

    // Status order: Active workflow first, then terminal states
    // Nacrt → Ponuđeno → Odobreno → U proizvodnji (workflow order)
    // Završeno and Otkazano always last (terminal states)
    const STATUS_ORDER = ['Nacrt', 'Ponuđeno', 'Odobreno', 'U proizvodnji', 'Završeno', 'Otkazano'];

    // Group projects by status
    const groupedProjects = STATUS_ORDER.reduce((acc, status) => {
        const projectsInStatus = filteredProjects.filter(p => p.Status === status);
        if (projectsInStatus.length > 0) {
            acc.push({ status, projects: projectsInStatus });
        }
        return acc;
    }, [] as { status: string; projects: Project[] }[]);

    // Status badge colors for group headers
    const getStatusColor = (status: string) => {
        switch (status) {
            case 'Nacrt': return { bg: '#f3f4f6', color: '#6b7280', border: '#d1d5db' };
            case 'Ponuđeno': return { bg: '#fef3c7', color: '#d97706', border: '#fcd34d' };
            case 'Odobreno': return { bg: '#dbeafe', color: '#2563eb', border: '#93c5fd' };
            case 'U proizvodnji': return { bg: '#ede9fe', color: '#7c3aed', border: '#c4b5fd' };
            case 'Završeno': return { bg: '#dcfce7', color: '#15803d', border: '#86efac' };
            case 'Otkazano': return { bg: '#fee2e2', color: '#dc2626', border: '#fca5a5' };
            default: return { bg: '#f3f4f6', color: '#6b7280', border: '#d1d5db' };
        }
    };

    function toggleProject(projectId: string) {
        // Toggle: if already expanded, collapse; otherwise expand this one (and hide others)
        setExpandedProjectId(prev => prev === projectId ? null : projectId);
    }

    function toggleProduct(productId: string) {
        const newExpanded = new Set<string>();
        // If the clicked product is NOT currently expanded, add it (focus mode).
        // If it IS expanded, we don't add it to newExpanded, effectively clearing it (collapsing all, showing list).
        if (!expandedProducts.has(productId)) {
            newExpanded.add(productId);
        }

        // This enforces single-product focus
        setExpandedProducts(newExpanded);
    }

    function openProjectModal(project?: Project) {
        setEditingProject(project || {});
        setProjectModal(true);
    }

    function openProductModal(projectId: string, product?: Product) {
        if (product) {
            // Editing existing product
            setEditingProduct({ ...product });
        } else {
            // New product - calculate next position number
            const project = projects.find(p => p.Project_ID === projectId);
            const existingProducts = project?.products || [];

            // Find the highest Poz number
            let maxPoz = 0;
            existingProducts.forEach(prod => {
                const match = prod.Name?.match(/^Poz\s*(\d+)/i);
                if (match) {
                    const pozNum = parseInt(match[1], 10);
                    if (pozNum > maxPoz) maxPoz = pozNum;
                }
            });

            const nextPoz = maxPoz + 1;
            setEditingProduct({ projectId, Quantity: 1, Name: `Poz ${nextPoz} - ` });
        }
        setProductModal(true);
    }

    function openMaterialModal(productId: string) {
        setAddingMaterial({ productId });
        setSelectedMaterial(null);
        setMaterialQty(1);
        setMaterialPrice(0);
        setMaterialModal(true);
    }

    async function handleSaveProject(projectData?: Partial<Project>) {
        const dataToSave = projectData || editingProject;

        if (!dataToSave?.Client_Name) {
            showToast('Unesite ime klijenta', 'error');
            return;
        }
        if (!organizationId) {
            showToast('Organization ID is required', 'error');
            return;
        }

        const result = await saveProject(dataToSave, organizationId);
        if (result.success) {
            showToast(result.message, 'success');
            setProjectModal(false);
            onRefresh('projects');
        } else {
            showToast(result.message, 'error');
        }
    }

    async function handleDeleteProject(projectId: string) {
        if (!confirm('Jeste li sigurni da želite obrisati ovaj projekat?')) return;
        if (!organizationId) {
            showToast('Organization ID is required', 'error');
            return;
        }

        const result = await deleteProject(projectId, organizationId);
        if (result.success) {
            showToast(result.message, 'success');
            onRefresh('projects');
        } else {
            showToast(result.message, 'error');
        }
    }

    async function handleSaveProduct(productData?: Partial<Product>) {
        const dataToSave = productData || editingProduct;

        if (!dataToSave?.Name) {
            showToast('Unesite naziv proizvoda', 'error');
            return;
        }
        if (!organizationId) {
            showToast('Organization ID is required', 'error');
            return;
        }

        const productPayload = {
            ...dataToSave,
            Project_ID: dataToSave.Project_ID || (dataToSave as any).projectId,
        };

        const result = await saveProduct(productPayload, organizationId);
        if (result.success) {
            showToast(result.message, 'success');
            setProductModal(false);
            onRefresh('projects');
        } else {
            showToast(result.message, 'error');
        }
    }

    async function handleDeleteProduct(productId: string) {
        if (!confirm('Jeste li sigurni da želite obrisati ovaj proizvod?')) return;
        if (!organizationId) {
            showToast('Organization ID is required', 'error');
            return;
        }

        const result = await deleteProduct(productId, organizationId);
        if (result.success) {
            showToast(result.message, 'success');
            onRefresh('projects');
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

    async function handleAddMaterial(data?: { materialId: string, quantity: number, price: number }) {
        // Prepare data from args or state
        const targetMaterialId = data?.materialId || selectedMaterial?.Material_ID;
        const targetQuantity = data?.quantity ?? materialQty;
        const targetPrice = data?.price ?? materialPrice;
        const targetProductId = addingMaterial?.productId;

        // If generic checks fail, try checking selectedMaterial object (desktop flow)
        const targetMaterialObj = data
            ? materials.find(m => m.Material_ID === data.materialId)
            : selectedMaterial;

        if (!targetMaterialObj || !targetProductId) {
            showToast('Odaberite materijal', 'error');
            return;
        }

        // Check if this is a glass material - redirect to glass modal
        // Note: Glass/Alu redirect logic is tricky with the new mobile direct-add flow. 
        // For now, if mobile adds it directly, we assume standard material add unless we add specific logic there.
        // But let's keep it safe:
        if (isGlassMaterial(targetMaterialObj)) {
            setMaterialModal(false);
            setGlassProductId(targetProductId);
            setEditingGlassMaterial(null);
            setGlassModal(true);
            return;
        }

        // Check if this is an alu door material - redirect to alu door modal
        if (isAluDoorMaterial(targetMaterialObj)) {
            setMaterialModal(false);
            setAluDoorProductId(targetProductId);
            setEditingAluDoorMaterial(null);
            setAluDoorModal(true);
            return;
        }

        const result = await addMaterialToProduct({
            Product_ID: targetProductId,
            Material_ID: targetMaterialObj.Material_ID,
            Material_Name: targetMaterialObj.Name,
            Quantity: targetQuantity,
            Unit: targetMaterialObj.Unit,
            Unit_Price: targetPrice || targetMaterialObj.Default_Unit_Price,
            Supplier: targetMaterialObj.Default_Supplier || '',
        }, organizationId!);

        if (result.success) {
            showToast(result.message, 'success');
            setMaterialModal(false);
            onRefresh('projects');
        } else {
            showToast(result.message, 'error');
        }
    }

    // Handle glass modal save
    async function handleSaveGlass(data: GlassModalData) {
        if (!organizationId) {
            showToast('Organization ID is required', 'error');
            return;
        }
        let result;
        if (data.isEditMode && data.productMaterialId) {
            result = await updateGlassMaterial({
                productMaterialId: data.productMaterialId,
                unitPrice: data.unitPrice,
                items: data.items,
            }, organizationId);
        } else {
            result = await addGlassMaterialToProduct({
                productId: data.productId,
                materialId: data.materialId,
                materialName: data.materialName,
                supplier: data.supplier,
                unitPrice: data.unitPrice,
                items: data.items,
            }, organizationId);
        }

        if (result.success) {
            showToast(result.message, 'success');
            onRefresh('projects');
        } else {
            showToast(result.message, 'error');
        }
    }

    // Handle alu door modal save
    async function handleSaveAluDoor(data: AluDoorModalData) {
        if (!organizationId) {
            showToast('Organization ID is required', 'error');
            return;
        }
        let result;
        if (data.isEditMode && data.productMaterialId) {
            result = await updateAluDoorMaterial({
                productMaterialId: data.productMaterialId,
                unitPrice: data.unitPrice,
                items: data.items,
            }, organizationId);
        } else {
            result = await addAluDoorMaterialToProduct({
                productId: data.productId,
                materialId: data.materialId,
                materialName: data.materialName,
                supplier: data.supplier,
                unitPrice: data.unitPrice,
                items: data.items,
            }, organizationId);
        }

        if (result.success) {
            showToast(result.message, 'success');
            onRefresh('projects');
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
        if (!organizationId) {
            showToast('Organization ID is required', 'error');
            return;
        }

        const result = await deleteProductMaterial(materialId, organizationId);
        if (result.success) {
            showToast(result.message, 'success');
            onRefresh('projects');
        } else {
            showToast(result.message, 'error');
        }
    }

    // Open edit material modal for regular materials
    function openEditMaterialModal(material: ProductMaterial) {
        setEditingMaterial(material);
        setEditMaterialQty(material.Quantity);
        setEditMaterialPrice(material.Unit_Price);
        setEditMaterialIsEssential(material.Is_Essential || false);
        setEditMaterialModal(true);
    }

    // Save edited material
    async function handleSaveEditMaterial(id?: string, updates?: { Quantity: number; Unit_Price: number; Total_Price: number; Is_Essential: boolean }) {
        // If called from mobile modal with args
        if (id && updates) {
            if (!organizationId) {
                showToast('Organization ID is required', 'error');
                return;
            }
            const result = await updateProductMaterial(id, updates, organizationId);
            if (result.success) {
                showToast('Materijal uspješno ažuriran', 'success');
                setEditMaterialModal(false);
                onRefresh('projects');
            } else {
                showToast(result.message, 'error');
            }
            return;
        }

        // Existing desktop logic
        if (!editingMaterial) return;
        if (!organizationId) {
            showToast('Organization ID is required', 'error');
            return;
        }

        const result = await updateProductMaterial(editingMaterial.ID, {
            Quantity: editMaterialQty,
            Unit_Price: editMaterialPrice,
            Total_Price: editMaterialQty * editMaterialPrice,
            Is_Essential: editMaterialIsEssential
        }, organizationId);

        if (result.success) {
            showToast('Materijal uspješno ažuriran', 'success');
            setEditMaterialModal(false);
            onRefresh('projects');
        } else {
            showToast(result.message, 'error');
        }
    }

    // Handle material status change (optimistic update to preserve UI state)
    async function handleMaterialStatusChange(materialId: string, newStatus: string) {
        if (!organizationId) {
            showToast('Organization ID is required', 'error');
            return;
        }
        const result = await updateProductMaterial(materialId, { Status: newStatus }, organizationId);
        if (result.success) {
            showToast(`Status materijala promjenjen u "${newStatus}"`, 'success');
            setStatusDropdownMaterialId(null);
            // Background refresh to sync data without disrupting UI
            onRefresh('projects');
        } else {
            showToast(result.message, 'error');
        }
    }

    // Quick Edit Functions
    function toggleQuickEdit(productId: string) {
        if (quickEditMode === productId) {
            // Exit quick edit mode
            setQuickEditMode(null);
            setEditingMaterialValues({});
        } else {
            // Enter quick edit mode
            setQuickEditMode(productId);
            // Initialize values for all materials in this product
            const product = projects.flatMap(p => p.products || []).find(prod => prod.Product_ID === productId);
            if (product?.materials) {
                const initialValues: Record<string, { qty: number; price: number }> = {};
                product.materials.forEach(mat => {
                    initialValues[mat.ID] = {
                        qty: mat.Quantity,
                        price: mat.Unit_Price
                    };
                });
                setEditingMaterialValues(initialValues);
            }
        }
    }

    function handleQuickEditChange(materialId: string, field: 'qty' | 'price', value: string) {
        const numValue = parseFloat(value) || 0;
        setEditingMaterialValues(prev => ({
            ...prev,
            [materialId]: {
                ...prev[materialId],
                [field]: numValue
            }
        }));
    }

    async function saveQuickEdit(materialId: string) {
        const values = editingMaterialValues[materialId];
        if (!values || !organizationId) return;

        // Find the original material to check if values changed
        const material = projects
            .flatMap(p => p.products || [])
            .flatMap(prod => prod.materials || [])
            .find(m => m.ID === materialId);

        if (!material) return;

        // Only save if changed
        if (values.qty === material.Quantity && values.price === material.Unit_Price) {
            return;
        }

        const result = await updateProductMaterial(materialId, {
            Quantity: values.qty,
            Unit_Price: values.price,
            Total_Price: values.qty * values.price
        }, organizationId);

        if (result.success) {
            showToast('Materijal ažuriran', 'success');
            onRefresh('projects');
        } else {
            showToast(result.message, 'error');
        }
    }

    function handleQuickEditKeyDown(e: React.KeyboardEvent, materialId: string) {
        if (e.key === 'Enter') {
            e.preventDefault();
            saveQuickEdit(materialId);
        } else if (e.key === 'Escape') {
            // Reset to original value
            const material = projects
                .flatMap(p => p.products || [])
                .flatMap(prod => prod.materials || [])
                .find(m => m.ID === materialId);

            if (material) {
                setEditingMaterialValues(prev => ({
                    ...prev,
                    [materialId]: {
                        qty: material.Quantity,
                        price: material.Unit_Price
                    }
                }));
            }
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
        const status = product.Status || 'Na čekanju';

        // Simplify to 3 states for display in Projects tab:
        // 1. Na čekanju - waiting for production
        // 2. U proizvodnji - any production step in progress
        // 3. Završeno - production complete

        const waitingStatuses = ['Na čekanju', 'Materijali naručeni', 'Materijali spremni', 'Čeka proizvodnju'];
        const inProductionStatuses = ['Rezanje', 'Kantiranje', 'Bušenje', 'Sklapanje', 'U proizvodnji'];
        const completedStatuses = ['Spremno', 'Instalirano', 'Završeno'];

        if (waitingStatuses.includes(status)) {
            return 'Na čekanju';
        }
        if (inProductionStatuses.includes(status)) {
            return 'U proizvodnji';
        }
        if (completedStatuses.includes(status)) {
            return 'Završeno';
        }

        // Default fallback
        return 'Na čekanju';
    }

    const isMobile = useIsMobile();

    if (isMobile) {
        return (
            <>
                <MobileProjectsView
                    projects={projects}
                    materials={materials}
                    workOrders={workOrders}
                    offers={offers}
                    workLogs={workLogs}
                    onRefresh={onRefresh}
                    showToast={showToast}
                    onNavigateToTasks={onNavigateToTasks}
                    onOpenProjectModal={openProjectModal}
                    onDeleteProject={handleDeleteProject}
                    onOpenProductModal={openProductModal}
                    onDeleteProduct={handleDeleteProduct}
                    onOpenMaterialModal={openMaterialModal}
                    onDeleteMaterial={handleDeleteMaterial}
                    onEditMaterial={openEditMaterialModal}
                    onEditGlass={openGlassModalForEdit}
                    onEditAluDoor={openAluDoorModalForEdit}
                    onUpdateMaterial={async (materialId, updates) => {
                        if (!organizationId) {
                            showToast('Organization ID is required', 'error');
                            return;
                        }
                        const result = await updateProductMaterial(materialId, updates, organizationId);
                        if (result.success) {
                            showToast('Materijal ažuriran', 'success');
                            onRefresh('projects');
                        } else {
                            showToast(result.message, 'error');
                        }
                    }}
                />

                {/* Modals are shared but different for mobile */}
                {/* Project Modal */}
                {isMobile ? (
                    <MobileProjectModal
                        isOpen={projectModal}
                        onClose={() => setProjectModal(false)}
                        project={editingProject}
                        onSave={handleSaveProject}
                    />
                ) : (
                    <Modal
                        isOpen={projectModal}
                        onClose={() => setProjectModal(false)}
                        title={editingProject?.Project_ID ? "Uredi Projekat" : "Novi Projekat"}
                    >
                        <div className="form-group">
                            <label>Klijent / Ime projekta</label>
                            <input
                                type="text"
                                className="form-control"
                                value={editingProject?.Client_Name || ''}
                                onChange={(e) => setEditingProject({ ...editingProject, Client_Name: e.target.value })}
                                placeholder="Unesite ime klijenta"
                            />
                        </div>
                        <div className="form-group">
                            <label>Adresa</label>
                            <input
                                type="text"
                                className="form-control"
                                value={editingProject?.Address || ''}
                                onChange={(e) => setEditingProject({ ...editingProject, Address: e.target.value })}
                                placeholder="Adresa lokacije"
                            />
                        </div>
                        <div className="form-group">
                            <label>Status</label>
                            <select
                                className="form-control"
                                value={editingProject?.Status || 'Nacrt'}
                                onChange={(e) => setEditingProject({ ...editingProject, Status: e.target.value })}
                            >
                                {PROJECT_STATUSES.map(status => (
                                    <option key={status} value={status}>{status}</option>
                                ))}
                            </select>
                        </div>
                        <div className="modal-actions">
                            <button className="btn btn-secondary" onClick={() => setProjectModal(false)}>Otkaži</button>
                            <button className="btn btn-primary" onClick={() => handleSaveProject()}>Sačuvaj</button>
                        </div>
                    </Modal>
                )}

                {/* Shared Modals for Mobile */}
                {/* Product Modal */}
                {isMobile ? (
                    <MobileProductModal
                        isOpen={productModal}
                        onClose={() => setProductModal(false)}
                        product={editingProduct}
                        onSave={handleSaveProduct}
                    />
                ) : (
                    <Modal
                        isOpen={productModal}
                        onClose={() => setProductModal(false)}
                        title={editingProduct?.Product_ID ? 'Uredi Proizvod' : 'Novi Proizvod'}
                        footer={
                            <>
                                <button className="btn btn-secondary" onClick={() => setProductModal(false)}>Otkaži</button>
                                <button className="btn btn-primary" onClick={() => handleSaveProduct()}>Sačuvaj</button>
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
                )}

                {/* Add Material Modal */}
                {isMobile ? (
                    <MobileMaterialAddModal
                        isOpen={materialModal}
                        onClose={() => setMaterialModal(false)}
                        materials={materials}
                        onAdd={handleAddMaterial}
                    />
                ) : (
                    <Modal
                        isOpen={materialModal}
                        onClose={() => setMaterialModal(false)}
                        title="Dodaj Materijal"
                        footer={
                            <>
                                <button className="btn btn-secondary" onClick={() => setMaterialModal(false)}>Otkaži</button>
                                <button className="btn btn-primary" onClick={() => handleAddMaterial()}>Dodaj</button>
                            </>
                        }
                    >
                        <div className="form-group">
                            <label>Materijal *</label>
                            <SearchableSelect
                                value={selectedMaterial?.Material_ID || ''}
                                onChange={(value) => {
                                    const mat = materials.find(m => m.Material_ID === value);
                                    setSelectedMaterial(mat || null);
                                    if (mat) {
                                        setMaterialPrice(mat.Default_Unit_Price);
                                    }
                                }}
                                options={materials.map(mat => ({
                                    value: mat.Material_ID,
                                    label: mat.Name,
                                    subLabel: `${mat.Category} • ${mat.Unit}`
                                }))}
                                placeholder="Pretraži materijale..."
                            />
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
                )}

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

                {/* Edit Material Modal - Desktop vs Mobile */}
                {isMobile ? (
                    <MobileMaterialEditModal
                        isOpen={editMaterialModal}
                        onClose={() => setEditMaterialModal(false)}
                        material={editingMaterial}
                        onSave={handleSaveEditMaterial}
                    />
                ) : (
                    <Modal
                        isOpen={editMaterialModal}
                        onClose={() => setEditMaterialModal(false)}
                        title="Uredi Materijal"
                        footer={
                            <>
                                <button className="btn btn-secondary" onClick={() => setEditMaterialModal(false)}>Otkaži</button>
                                <button className="btn btn-primary" onClick={() => handleSaveEditMaterial()}>Sačuvaj</button>
                            </>
                        }
                    >
                        {editingMaterial && (
                            <div className="edit-modal-content">
                                <div className="modal-header-info">
                                    <div className="header-icon">📦</div>
                                    <div className="header-details">
                                        <div className="header-title">{editingMaterial.Material_Name}</div>
                                        <div className="header-subtitle">Uređivanje detalja materijala</div>
                                    </div>
                                </div>

                                <div className="modal-form-grid">
                                    <div className="form-field">
                                        <label>Količina <span className="required">*</span></label>
                                        <div className="input-wrapper">
                                            <input
                                                type="number"
                                                step="0.01"
                                                min="0"
                                                value={editMaterialQty}
                                                onChange={(e) => setEditMaterialQty(parseFloat(e.target.value) || 0)}
                                                placeholder="0"
                                            />
                                            <span className="unit-badge">{editingMaterial.Unit || 'kom'}</span>
                                        </div>
                                    </div>

                                    <div className="form-field">
                                        <label>Cijena po jedinici</label>
                                        <div className="input-wrapper">
                                            <input
                                                type="number"
                                                step="0.01"
                                                min="0"
                                                value={editMaterialPrice}
                                                onChange={(e) => setEditMaterialPrice(parseFloat(e.target.value) || 0)}
                                                placeholder="0.00"
                                            />
                                            <span className="currency-badge">KM</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="total-price-card">
                                    <span className="total-label">UKUPNA VRIJEDNOST</span>
                                    <span className="total-amount">
                                        {(editMaterialQty * editMaterialPrice).toFixed(2)}
                                        <span className="total-currency">KM</span>
                                    </span>
                                </div>

                                <label className={`essential-card ${editMaterialIsEssential ? 'active' : ''}`}>
                                    <div className="checkbox-wrapper">
                                        <input
                                            type="checkbox"
                                            checked={editMaterialIsEssential}
                                            onChange={(e) => setEditMaterialIsEssential(e.target.checked)}
                                        />
                                    </div>
                                    <div className="essential-content">
                                        <div className="essential-title">
                                            <span className="warning-icon">⚠️</span>
                                            Esencijalni materijal
                                        </div>
                                        <div className="essential-description">
                                            Označavanjem ovog materijala kao esencijalnog sprječavate početak proizvodnje dok se materijal ne zaprimi na stanje.
                                        </div>
                                    </div>
                                </label>
                            </div>
                        )}
                    </Modal>
                )}

                {/* Product Timeline Modal */}
                <ProductTimelineModal
                    isOpen={timelineProduct !== null}
                    onClose={() => setTimelineProduct(null)}
                    productId={timelineProduct?.product.Product_ID || ''}
                    productName={timelineProduct?.product.Name || ''}
                    workLogs={workLogs.filter(wl => wl.Product_ID === timelineProduct?.product.Product_ID)}
                    sellingPrice={timelineProduct?.sellingPrice}
                    materialCost={timelineProduct?.materialCost}
                    laborCost={timelineProduct?.laborCost}
                    profit={timelineProduct?.profit}
                    profitMargin={timelineProduct?.profitMargin}
                />
            </>
        );
    }

    return (
        <div className="tab-content active" id="projects-content">
            <div className="content-header projects-toolbar">
                <div className="glass-search">
                    <span className="material-icons-round">search</span>
                    <input
                        type="text"
                        placeholder="Pretraži projekte..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                <select
                    className="glass-select-standalone"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                >
                    <option value="">Svi statusi</option>
                    {PROJECT_STATUSES.map(status => (
                        <option key={status} value={status}>{status}</option>
                    ))}
                </select>
                <button className="glass-btn glass-btn-primary" onClick={() => openProjectModal()}>
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
                ) : expandedProjectId ? (
                    // When a project is expanded, only show that project for cleaner view
                    filteredProjects.filter(p => p.Project_ID === expandedProjectId).map(project => {
                        const totalProducts = project.products?.length || 0;
                        const totalCost = project.products?.reduce((sum, p) => sum + (p.Material_Cost || 0), 0) || 0;

                        return (
                            <div key={project.Project_ID} className="project-card">
                                <div className="project-header" onClick={() => toggleProject(project.Project_ID)}>
                                    <button className={`expand-btn ${expandedProjectId === project.Project_ID ? 'expanded' : ''}`}>
                                        <span className="material-icons-round">chevron_right</span>
                                    </button>

                                    <div className="project-main-info">
                                        <div className="project-title-section">
                                            <div className="project-name">{project.Name || project.Client_Name}</div>
                                            {project.Name && <div className="project-client-subtitle">{project.Client_Name}</div>}
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

                                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                        <div className="project-badges">
                                            <span className={`status-badge ${getStatusClass(project.Status)}`}>
                                                {project.Status}
                                            </span>
                                        </div>

                                        <div className="project-actions" onClick={(e) => e.stopPropagation()} style={{ position: 'relative' }}>
                                            <button
                                                className="icon-btn"
                                                onClick={() => setActionsDropdownProjectId(actionsDropdownProjectId === project.Project_ID ? null : project.Project_ID)}
                                                title="Akcije"
                                            >
                                                <span className="material-icons-round">more_vert</span>
                                            </button>
                                            {actionsDropdownProjectId === project.Project_ID && (
                                                <div className="actions-dropdown" style={{
                                                    position: 'absolute', right: 0, top: '100%', zIndex: 100,
                                                    background: '#fff', borderRadius: '10px', boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
                                                    border: '1px solid #e2e8f0', minWidth: '180px', padding: '4px 0',
                                                    animation: 'fadeIn 0.15s ease'
                                                }}>
                                                    {onNavigateToTasks && (
                                                        <button
                                                            onClick={() => { onNavigateToTasks(project.Project_ID); setActionsDropdownProjectId(null); }}
                                                            style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '10px 14px', border: 'none', background: 'none', cursor: 'pointer', fontSize: '13px', color: '#334155', transition: 'background 0.15s' }}
                                                            onMouseEnter={e => e.currentTarget.style.background = '#f1f5f9'}
                                                            onMouseLeave={e => e.currentTarget.style.background = 'none'}
                                                        >
                                                            <span className="material-icons-round" style={{ fontSize: '18px', color: '#64748b' }}>task_alt</span>
                                                            Zadaci
                                                        </button>
                                                    )}
                                                    <button
                                                        onClick={() => { openProjectModal(project); setActionsDropdownProjectId(null); }}
                                                        style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '10px 14px', border: 'none', background: 'none', cursor: 'pointer', fontSize: '13px', color: '#334155', transition: 'background 0.15s' }}
                                                        onMouseEnter={e => e.currentTarget.style.background = '#f1f5f9'}
                                                        onMouseLeave={e => e.currentTarget.style.background = 'none'}
                                                    >
                                                        <span className="material-icons-round" style={{ fontSize: '18px', color: '#64748b' }}>edit</span>
                                                        Uredi projekat
                                                    </button>
                                                    <div style={{ height: '1px', background: '#f1f5f9', margin: '4px 0' }} />
                                                    <button
                                                        onClick={() => { handleDeleteProject(project.Project_ID); setActionsDropdownProjectId(null); }}
                                                        style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '10px 14px', border: 'none', background: 'none', cursor: 'pointer', fontSize: '13px', color: '#ef4444', transition: 'background 0.15s' }}
                                                        onMouseEnter={e => e.currentTarget.style.background = '#fef2f2'}
                                                        onMouseLeave={e => e.currentTarget.style.background = 'none'}
                                                    >
                                                        <span className="material-icons-round" style={{ fontSize: '18px' }}>delete</span>
                                                        Obriši projekat
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Products Section */}
                                <div className={`project-products ${expandedProjectId === project.Project_ID ? 'expanded' : ''}`}>
                                    <div className="products-header">
                                        <h4>Proizvodi ({project.products?.length || 0})</h4>
                                        <button className="btn-add-item" onClick={() => openProductModal(project.Project_ID)}>
                                            <span className="material-icons-round">add</span>
                                            Dodaj proizvod
                                        </button>
                                    </div>

                                    {[...(project.products || [])].sort((a, b) => {
                                        // Natural sort for "Poz X" product names (supports decimals: 1, 1.1, 1.2, 2, 10)
                                        const extractPoz = (name: string): number => {
                                            const match = name?.match(/^Poz\s*(\d+(?:\.\d+)?)/i);
                                            return match ? parseFloat(match[1]) : Infinity;
                                        };
                                        const pozA = extractPoz(a.Name || '');
                                        const pozB = extractPoz(b.Name || '');
                                        if (pozA !== pozB) return pozA - pozB;
                                        return (a.Name || '').localeCompare(b.Name || '', 'hr', { numeric: true });
                                    }).map(product => (
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
                                                {/* Profit Badge */}
                                                {(() => {
                                                    // Find OfferProduct from accepted offers and calculate full costs
                                                    let sellingPrice: number | undefined;
                                                    let materialCost: number | undefined;
                                                    let offerRef: Offer | undefined;
                                                    const acceptedOffers = offers.filter(o => o.Status === 'Prihvaćeno');
                                                    for (const offer of acceptedOffers) {
                                                        const offerProduct = (offer.products || []).find(op => op.Product_ID === product.Product_ID);
                                                        if (offerProduct) {
                                                            offerRef = offer;
                                                            sellingPrice = offerProduct.Selling_Price || offerProduct.Total_Price;

                                                            // All cost components
                                                            materialCost = (offerProduct.Material_Cost || 0);

                                                            // Add LED, Grouting, Sink, Extras costs
                                                            const ledCost = offerProduct.LED_Total || 0;
                                                            const groutingCost = offerProduct.Grouting ? (offerProduct.Grouting_Price || 0) : 0;
                                                            const sinkCost = offerProduct.Sink_Faucet ? (offerProduct.Sink_Faucet_Price || 0) : 0;
                                                            const extrasCost = ((offerProduct as any).extras || []).reduce((sum: number, e: any) =>
                                                                sum + (e.Total || e.total || 0), 0);

                                                            materialCost = materialCost + ledCost + groutingCost + sinkCost + extrasCost;
                                                            break;
                                                        }
                                                    }

                                                    // Calculate labor cost from workLogs
                                                    const productWorkLogs = workLogs.filter(wl => wl.Product_ID === product.Product_ID);
                                                    const laborCost = productWorkLogs.reduce((sum, wl) => sum + (wl.Daily_Rate || 0), 0);

                                                    // Calculate profit if we have selling price
                                                    if (sellingPrice && sellingPrice > 0) {
                                                        // Calculate proportional transport/discount
                                                        let transportShare = 0;
                                                        let discountShare = 0;

                                                        if (offerRef) {
                                                            const offerSubtotal = offerRef.Subtotal || 0;
                                                            if (offerSubtotal > 0) {
                                                                const productRatio = sellingPrice / offerSubtotal;
                                                                transportShare = (offerRef.Transport_Cost || 0) * productRatio;
                                                                discountShare = offerRef.Onsite_Assembly ?
                                                                    (offerRef.Onsite_Discount || 0) * productRatio : 0;
                                                            }
                                                        }

                                                        // Profit = Selling Price - Costs (material + labor)
                                                        // Transport is pass-through, not production profit
                                                        const profit = sellingPrice - (materialCost || 0) - laborCost;
                                                        const profitMargin = sellingPrice > 0 ? (profit / sellingPrice) * 100 : 0;

                                                        return (
                                                            <span
                                                                className="profit-badge"
                                                                style={{
                                                                    display: 'inline-flex',
                                                                    alignItems: 'center',
                                                                    gap: '4px',
                                                                    padding: '4px 10px',
                                                                    borderRadius: '6px',
                                                                    background: profitMargin >= 30 ? 'rgba(16, 185, 129, 0.1)' :
                                                                        profitMargin >= 15 ? 'rgba(245, 158, 11, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                                                                    color: profitMargin >= 30 ? '#10b981' :
                                                                        profitMargin >= 15 ? '#f59e0b' : '#ef4444',
                                                                    fontWeight: 600,
                                                                    fontSize: '12px',
                                                                    marginLeft: '8px',
                                                                    cursor: 'pointer'
                                                                }}
                                                                title="Klikni za detaljan izvještaj"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setTimelineProduct({ product, sellingPrice, materialCost, laborCost, profit, profitMargin });
                                                                }}
                                                            >
                                                                <span className="material-icons-round" style={{ fontSize: '14px' }}>
                                                                    {profitMargin >= 30 ? 'trending_up' : profitMargin >= 15 ? 'trending_flat' : 'trending_down'}
                                                                </span>
                                                                {profit.toLocaleString('hr-HR')} KM ({profitMargin.toFixed(0)}%)
                                                            </span>
                                                        );
                                                    }
                                                    return null;
                                                })()}
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
                                            {(() => {
                                                // Group materials logic
                                                const groups: Record<string, { items: ProductMaterial[], total: number }> = {};
                                                const productMaterials = product.materials || [];

                                                productMaterials.forEach(pm => {
                                                    let category = 'Ostalo';

                                                    // Check specific types first
                                                    if (pm.glassItems && pm.glassItems.length > 0) category = 'Staklo';
                                                    else if (pm.aluDoorItems && pm.aluDoorItems.length > 0) category = 'Alu vrata';
                                                    else {
                                                        const matDef = materials.find(m => m.Material_ID === pm.Material_ID);
                                                        if (matDef?.Category) category = matDef.Category;
                                                    }

                                                    if (!groups[category]) {
                                                        groups[category] = { items: [], total: 0 };
                                                    }

                                                    groups[category].items.push(pm);
                                                    groups[category].total += (pm.Total_Price || 0);
                                                });

                                                // Sort categories based on MATERIAL_CATEGORIES order
                                                const sortedCategories = Object.keys(groups).sort((a, b) => {
                                                    const idxA = MATERIAL_CATEGORIES.indexOf(a);
                                                    const idxB = MATERIAL_CATEGORIES.indexOf(b);
                                                    // If not found, put at end
                                                    return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
                                                });

                                                // Fix for importing constant name if it differs from local variable name
                                                // Using MATERIAL_CATEGORIES directly as it is imported.

                                                return (
                                                    <div className={`product-materials ${expandedProducts.has(product.Product_ID) ? 'expanded' : ''}`}>
                                                        <div className="materials-header">
                                                            <h5>Materijali ({productMaterials.length})</h5>
                                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                                {productMaterials.length > 0 && (
                                                                    <button
                                                                        className={`btn-quick-edit ${quickEditMode === product.Product_ID ? 'active' : ''}`}
                                                                        onClick={() => toggleQuickEdit(product.Product_ID)}
                                                                        title={quickEditMode === product.Product_ID ? 'Zatvori Quick Edit' : 'Brzo uređivanje materijala'}
                                                                    >
                                                                        <span className="material-icons-round">
                                                                            {quickEditMode === product.Product_ID ? 'check' : 'flash_on'}
                                                                        </span>
                                                                    </button>
                                                                )}
                                                                <button className="btn-add-item" onClick={() => openMaterialModal(product.Product_ID)}>
                                                                    <span className="material-icons-round">add</span>
                                                                    Dodaj materijal
                                                                </button>
                                                            </div>
                                                        </div>

                                                        {productMaterials.length === 0 && (
                                                            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                                                                Nema dodanih materijala. Kliknite na "Dodaj materijal" za početak.
                                                            </div>
                                                        )}

                                                        {sortedCategories.map(category => {
                                                            const group = groups[category];
                                                            return (
                                                                <div key={category} className="material-category-section">
                                                                    <div className="category-header">
                                                                        <div className="cat-title">
                                                                            <span className="cat-dot"></span>
                                                                            {category}
                                                                            <span className="cat-count-badge">{group.items.length}</span>
                                                                        </div>
                                                                        <div className="cat-total">
                                                                            {formatCurrency(group.total)}
                                                                        </div>
                                                                    </div>

                                                                    <div className="category-items">
                                                                        {/* Header for this category table - optional, maybe just for desktop */}
                                                                        <div className="materials-table-header mini">
                                                                            <div className="mat-col-name">Naziv</div>
                                                                            <div className="mat-col-qty">Količina</div>
                                                                            <div className="mat-col-price">Cijena</div>
                                                                            <div className="mat-col-total">Ukupno</div>
                                                                            <div className="mat-col-status">Status</div>
                                                                            <div className="mat-col-actions"></div>
                                                                        </div>

                                                                        {group.items.map(material => {
                                                                            const isGlass = material.glassItems && material.glassItems.length > 0;
                                                                            const isAluDoor = material.aluDoorItems && material.aluDoorItems.length > 0;
                                                                            const glassCount = isGlass ? material.glassItems!.reduce((sum, gi) => sum + (gi.Qty || 1), 0) : 0;
                                                                            const aluDoorCount = isAluDoor ? material.aluDoorItems!.reduce((sum, ai) => sum + (ai.Qty || 1), 0) : 0;
                                                                            const isInQuickEdit = quickEditMode === product.Product_ID;
                                                                            const editValues = editingMaterialValues[material.ID] || { qty: material.Quantity, price: material.Unit_Price };

                                                                            return (
                                                                                <div key={material.ID} className={`material-row ${isInQuickEdit ? 'editing' : ''}`}>
                                                                                    <div className="mat-col-name">
                                                                                        <span className="material-name-text">{material.Material_Name}</span>
                                                                                        {material.Is_Essential && <span className="material-indicator essential" title="Esencijalni materijal">⚠️</span>}
                                                                                        {isGlass && <span className="material-indicator glass">🪟 {glassCount} kom</span>}
                                                                                        {isAluDoor && <span className="material-indicator alu-door">🚪 {aluDoorCount} kom</span>}
                                                                                    </div>
                                                                                    <div className="mat-col-qty">
                                                                                        <span className="mobile-label">Kol:</span>
                                                                                        {isInQuickEdit && !isGlass && !isAluDoor ? (
                                                                                            <input
                                                                                                type="number"
                                                                                                className="quick-edit-input"
                                                                                                value={editValues.qty}
                                                                                                onChange={(e) => handleQuickEditChange(material.ID, 'qty', e.target.value)}
                                                                                                onBlur={() => saveQuickEdit(material.ID)}
                                                                                                onKeyDown={(e) => handleQuickEditKeyDown(e, material.ID)}
                                                                                                step="0.01"
                                                                                                min="0"
                                                                                                onClick={(e) => e.stopPropagation()}
                                                                                            />
                                                                                        ) : (
                                                                                            <span>{material.Quantity} {material.Unit}</span>
                                                                                        )}
                                                                                    </div>
                                                                                    <div className="mat-col-price">
                                                                                        <span className="mobile-label">Cijena:</span>
                                                                                        {isInQuickEdit && !isGlass && !isAluDoor ? (
                                                                                            <input
                                                                                                type="number"
                                                                                                className="quick-edit-input"
                                                                                                value={editValues.price}
                                                                                                onChange={(e) => handleQuickEditChange(material.ID, 'price', e.target.value)}
                                                                                                onBlur={() => saveQuickEdit(material.ID)}
                                                                                                onKeyDown={(e) => handleQuickEditKeyDown(e, material.ID)}
                                                                                                step="0.01"
                                                                                                min="0"
                                                                                                onClick={(e) => e.stopPropagation()}
                                                                                            />
                                                                                        ) : (
                                                                                            formatCurrency(material.Unit_Price)
                                                                                        )}
                                                                                    </div>
                                                                                    <div className="mat-col-total">
                                                                                        <span className="mobile-label">Ukupno:</span>
                                                                                        <strong>
                                                                                            {isInQuickEdit && !isGlass && !isAluDoor
                                                                                                ? formatCurrency(editValues.qty * editValues.price)
                                                                                                : formatCurrency(material.Total_Price)
                                                                                            }
                                                                                        </strong>
                                                                                    </div>
                                                                                    <div className="mat-col-status">
                                                                                        {(() => {
                                                                                            const allowedTransitions = ALLOWED_MATERIAL_TRANSITIONS[material.Status] || [];
                                                                                            const statusIcons: Record<string, string> = {
                                                                                                'Nije naručeno': 'remove_shopping_cart',
                                                                                                'Na stanju': 'inventory',
                                                                                                'Naručeno': 'shopping_cart',
                                                                                                'Primljeno': 'check_circle',
                                                                                                'U upotrebi': 'build',
                                                                                                'Instalirano': 'done_all',
                                                                                            };
                                                                                            if (allowedTransitions.length > 0) {
                                                                                                return (
                                                                                                    <div className="status-dropdown-wrapper">
                                                                                                        <span
                                                                                                            className={`status-badge ${getStatusClass(material.Status)} clickable`}
                                                                                                            onClick={(e) => {
                                                                                                                e.stopPropagation();
                                                                                                                setStatusDropdownMaterialId(
                                                                                                                    statusDropdownMaterialId === material.ID ? null : material.ID
                                                                                                                );
                                                                                                            }}
                                                                                                            title="Klikni za promjenu statusa"
                                                                                                        >
                                                                                                            {material.Status}
                                                                                                            <span className="material-icons-round" style={{ fontSize: '14px', marginLeft: '4px' }}>expand_more</span>
                                                                                                        </span>
                                                                                                        {statusDropdownMaterialId === material.ID && (
                                                                                                            <div className="status-dropdown-menu" onClick={(e) => e.stopPropagation()}>
                                                                                                                {allowedTransitions.map(targetStatus => (
                                                                                                                    <button
                                                                                                                        key={targetStatus}
                                                                                                                        className="status-dropdown-item"
                                                                                                                        onClick={() => handleMaterialStatusChange(material.ID, targetStatus)}
                                                                                                                    >
                                                                                                                        <span className="material-icons-round">{statusIcons[targetStatus] || 'swap_horiz'}</span>
                                                                                                                        {targetStatus}
                                                                                                                    </button>
                                                                                                                ))}
                                                                                                            </div>
                                                                                                        )}
                                                                                                    </div>
                                                                                                );
                                                                                            }
                                                                                            return (
                                                                                                <span className={`status-badge ${getStatusClass(material.Status)}`}>
                                                                                                    {material.Status}
                                                                                                </span>
                                                                                            );
                                                                                        })()}
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
                                                            );
                                                        })}
                                                    </div>
                                                );
                                            })()}
                                        </div>
                                    ))}
                                </div>

                                {/* Grouped Materials Summary */}
                                {(() => {
                                    const materialMap = new Map<string, { name: string; unit: string; totalQty: number; orderedQty: number; receivedQty: number; notOrderedQty: number }>();
                                    (project.products || []).forEach(product => {
                                        (product.materials || []).forEach(mat => {
                                            const key = `${mat.Material_Name}||${mat.Unit}`;
                                            const qty = mat.Quantity || 0;
                                            const isReceived = mat.Status === 'Primljeno' || mat.Status === 'U upotrebi' || mat.Status === 'Instalirano';
                                            const isOrdered = mat.Status === 'Naručeno';
                                            const isOnStock = mat.Status === 'Na stanju';
                                            if (materialMap.has(key)) {
                                                const existing = materialMap.get(key)!;
                                                existing.totalQty += qty;
                                                if (isReceived || isOnStock) existing.receivedQty += qty;
                                                else if (isOrdered) existing.orderedQty += qty;
                                                else existing.notOrderedQty += qty;
                                            } else {
                                                materialMap.set(key, {
                                                    name: mat.Material_Name, unit: mat.Unit, totalQty: qty,
                                                    orderedQty: isOrdered ? qty : 0,
                                                    receivedQty: (isReceived || isOnStock) ? qty : 0,
                                                    notOrderedQty: (!isOrdered && !isReceived && !isOnStock) ? qty : 0,
                                                });
                                            }
                                        });
                                    });
                                    if (materialMap.size === 0) return null;
                                    const groupedMats = Array.from(materialMap.values()).sort((a, b) => a.name.localeCompare(b.name, 'hr'));
                                    const isOpen = showMaterialsSummary.has(project.Project_ID);
                                    return (
                                        <div style={{ padding: '0 20px 20px' }}>
                                            <div
                                                onClick={() => {
                                                    const next = new Set(showMaterialsSummary);
                                                    if (next.has(project.Project_ID)) next.delete(project.Project_ID); else next.add(project.Project_ID);
                                                    setShowMaterialsSummary(next);
                                                }}
                                                style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', padding: '10px 0', borderTop: '1px solid #f1f5f9', userSelect: 'none' }}
                                            >
                                                <span className="material-icons-round" style={{ fontSize: '18px', color: '#64748b', transition: 'transform 0.2s', transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>chevron_right</span>
                                                <span style={{ fontWeight: 600, fontSize: '13px', color: '#334155' }}>Pregled materijala</span>
                                                <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 500 }}>({groupedMats.length})</span>
                                            </div>
                                            {isOpen && (
                                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', marginTop: '4px' }}>
                                                    <thead>
                                                        <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                                                            <th style={{ textAlign: 'left', padding: '8px 8px 8px 0', color: '#64748b', fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Materijal</th>
                                                            <th style={{ textAlign: 'right', padding: '8px', color: '#64748b', fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Potrebno</th>
                                                            <th style={{ textAlign: 'right', padding: '8px', color: '#64748b', fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Naručeno</th>
                                                            <th style={{ textAlign: 'right', padding: '8px', color: '#64748b', fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Primljeno</th>
                                                            <th style={{ textAlign: 'right', padding: '8px 0 8px 8px', color: '#64748b', fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Status</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {groupedMats.map((mat, i) => {
                                                            let statusLabel: string, statusColor: string, statusBg: string;
                                                            if (mat.receivedQty >= mat.totalQty) { statusLabel = 'Primljeno'; statusColor = '#10b981'; statusBg = '#ecfdf5'; }
                                                            else if (mat.receivedQty > 0) { statusLabel = 'Djelomično primljeno'; statusColor = '#06b6d4'; statusBg = '#ecfeff'; }
                                                            else if (mat.orderedQty + mat.receivedQty >= mat.totalQty) { statusLabel = 'Naručeno'; statusColor = '#3b82f6'; statusBg = '#eff6ff'; }
                                                            else if (mat.orderedQty > 0) { statusLabel = 'Djelomično naručeno'; statusColor = '#8b5cf6'; statusBg = '#f5f3ff'; }
                                                            else { statusLabel = 'Nije naručeno'; statusColor = '#f59e0b'; statusBg = '#fffbeb'; }
                                                            return (
                                                                <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                                                    <td style={{ padding: '8px 8px 8px 0', fontWeight: 500, color: '#1e293b' }}>{mat.name}</td>
                                                                    <td style={{ textAlign: 'right', padding: '8px', fontWeight: 600, color: '#334155' }}>{mat.totalQty} {mat.unit}</td>
                                                                    <td style={{ textAlign: 'right', padding: '8px', fontWeight: 600, color: (mat.orderedQty + mat.receivedQty) >= mat.totalQty ? '#10b981' : mat.orderedQty > 0 ? '#3b82f6' : '#94a3b8' }}>{mat.orderedQty + mat.receivedQty} {mat.unit}</td>
                                                                    <td style={{ textAlign: 'right', padding: '8px', fontWeight: 600, color: mat.receivedQty >= mat.totalQty ? '#10b981' : mat.receivedQty > 0 ? '#06b6d4' : '#94a3b8' }}>{mat.receivedQty} {mat.unit}</td>
                                                                    <td style={{ textAlign: 'right', padding: '8px 0 8px 8px' }}>
                                                                        <span style={{ fontSize: '11px', padding: '3px 10px', borderRadius: '8px', background: statusBg, color: statusColor, fontWeight: 600, whiteSpace: 'nowrap' }}>{statusLabel}</span>
                                                                    </td>
                                                                </tr>
                                                            );
                                                        })}
                                                    </tbody>
                                                </table>
                                            )}
                                        </div>
                                    );
                                })()}
                            </div>
                        );
                    })
                ) : (
                    // Grouped view by status when no project is expanded
                    groupedProjects.map(group => (
                        <div key={group.status} className="status-group" style={{ marginBottom: '24px' }}>
                            <div
                                className="status-group-header"
                                onClick={() => toggleStatusGroup(group.status)}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '12px',
                                    padding: '8px 12px',
                                    borderRadius: '8px',
                                    marginBottom: '4px',
                                    background: expandedStatusGroups.has(group.status) ? getStatusColor(group.status).bg : 'transparent',
                                    border: `1px solid ${expandedStatusGroups.has(group.status) ? getStatusColor(group.status).border : 'transparent'}`,
                                    cursor: 'pointer',
                                    userSelect: 'none',
                                    transition: 'all 0.2s ease',
                                    width: '100%'
                                }}
                                onMouseEnter={(e) => {
                                    if (!expandedStatusGroups.has(group.status)) {
                                        e.currentTarget.style.background = 'rgba(0,0,0,0.02)';
                                    }
                                }}
                                onMouseLeave={(e) => {
                                    if (!expandedStatusGroups.has(group.status)) {
                                        e.currentTarget.style.background = 'transparent';
                                    }
                                }}
                            >
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    width: '24px',
                                    height: '24px',
                                    borderRadius: '6px',
                                    background: getStatusColor(group.status).bg,
                                    color: getStatusColor(group.status).color
                                }}>
                                    <span
                                        className="material-icons-round"
                                        style={{
                                            fontSize: '18px',
                                            transition: 'transform 0.2s ease',
                                            transform: expandedStatusGroups.has(group.status) ? 'rotate(90deg)' : 'rotate(0deg)'
                                        }}
                                    >
                                        chevron_right
                                    </span>
                                </div>
                                <span
                                    style={{
                                        fontWeight: 600,
                                        fontSize: '14px',
                                        color: '#1e293b'
                                    }}
                                >
                                    {group.status}
                                </span>
                                <div style={{ flex: 1, height: '1px', background: '#e2e8f0', margin: '0 16px' }}></div>
                                <span
                                    style={{
                                        fontSize: '12px',
                                        color: getStatusColor(group.status).color,
                                        fontWeight: 500,
                                        background: getStatusColor(group.status).bg,
                                        padding: '2px 8px',
                                        borderRadius: '10px',
                                        border: `1px solid ${getStatusColor(group.status).border}`
                                    }}
                                >
                                    {group.projects.length} {group.projects.length === 1 ? 'projekat' : 'projekata'}
                                </span>
                            </div>
                            {expandedStatusGroups.has(group.status) && group.projects.map(project => {
                                const totalProducts = project.products?.length || 0;
                                const totalCost = project.products?.reduce((sum, p) => sum + (p.Material_Cost || 0), 0) || 0;

                                return (
                                    <div key={project.Project_ID} className="project-card">
                                        <div className="project-header" onClick={() => toggleProject(project.Project_ID)}>
                                            <button className={`expand-btn ${expandedProjectId === project.Project_ID ? 'expanded' : ''}`}>
                                                <span className="material-icons-round">chevron_right</span>
                                            </button>

                                            <div className="project-main-info">
                                                <div className="project-title-section">
                                                    <div className="project-name">{project.Name || project.Client_Name}</div>
                                                    {project.Name && <div className="project-client-subtitle">{project.Client_Name}</div>}
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

                                            <div className="project-actions" onClick={(e) => e.stopPropagation()} style={{ position: 'relative' }}>
                                                <button
                                                    className="icon-btn"
                                                    onClick={() => setActionsDropdownProjectId(actionsDropdownProjectId === project.Project_ID ? null : project.Project_ID)}
                                                    title="Akcije"
                                                >
                                                    <span className="material-icons-round">more_vert</span>
                                                </button>
                                                {actionsDropdownProjectId === project.Project_ID && (
                                                    <div className="actions-dropdown" style={{
                                                        position: 'absolute', right: 0, top: '100%', zIndex: 100,
                                                        background: '#fff', borderRadius: '10px', boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
                                                        border: '1px solid #e2e8f0', minWidth: '180px', padding: '4px 0',
                                                        animation: 'fadeIn 0.15s ease'
                                                    }}>
                                                        {onNavigateToTasks && (
                                                            <button
                                                                onClick={() => { onNavigateToTasks(project.Project_ID); setActionsDropdownProjectId(null); }}
                                                                style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '10px 14px', border: 'none', background: 'none', cursor: 'pointer', fontSize: '13px', color: '#334155', transition: 'background 0.15s' }}
                                                                onMouseEnter={e => e.currentTarget.style.background = '#f1f5f9'}
                                                                onMouseLeave={e => e.currentTarget.style.background = 'none'}
                                                            >
                                                                <span className="material-icons-round" style={{ fontSize: '18px', color: '#64748b' }}>task_alt</span>
                                                                Zadaci
                                                            </button>
                                                        )}
                                                        <button
                                                            onClick={() => { openProjectModal(project); setActionsDropdownProjectId(null); }}
                                                            style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '10px 14px', border: 'none', background: 'none', cursor: 'pointer', fontSize: '13px', color: '#334155', transition: 'background 0.15s' }}
                                                            onMouseEnter={e => e.currentTarget.style.background = '#f1f5f9'}
                                                            onMouseLeave={e => e.currentTarget.style.background = 'none'}
                                                        >
                                                            <span className="material-icons-round" style={{ fontSize: '18px', color: '#64748b' }}>edit</span>
                                                            Uredi projekat
                                                        </button>
                                                        <div style={{ height: '1px', background: '#f1f5f9', margin: '4px 0' }} />
                                                        <button
                                                            onClick={() => { handleDeleteProject(project.Project_ID); setActionsDropdownProjectId(null); }}
                                                            style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '10px 14px', border: 'none', background: 'none', cursor: 'pointer', fontSize: '13px', color: '#ef4444', transition: 'background 0.15s' }}
                                                            onMouseEnter={e => e.currentTarget.style.background = '#fef2f2'}
                                                            onMouseLeave={e => e.currentTarget.style.background = 'none'}
                                                        >
                                                            <span className="material-icons-round" style={{ fontSize: '18px' }}>delete</span>
                                                            Obriši projekat
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ))
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
                        <button className="glass-btn glass-btn-primary" onClick={() => handleSaveProject()}>Sačuvaj</button>
                    </>
                }
            >
                <div className="form-group">
                    <label>Naziv projekta</label>
                    <input
                        type="text"
                        placeholder="npr. Kuhinja Begović, Renovacija stana Mostar"
                        value={editingProject?.Name || ''}
                        onChange={(e) => setEditingProject({ ...editingProject, Name: e.target.value })}
                    />
                </div>
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
                        <button className="btn btn-primary" onClick={() => handleSaveProduct()}>Sačuvaj</button>
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
                        <button className="btn btn-primary" onClick={() => handleAddMaterial()}>Dodaj</button>
                    </>
                }
            >
                <div className="form-group">
                    <label>Materijal *</label>
                    <SearchableSelect
                        value={selectedMaterial?.Material_ID || ''}
                        onChange={(value) => {
                            const mat = materials.find(m => m.Material_ID === value);
                            setSelectedMaterial(mat || null);
                            if (mat) {
                                setMaterialPrice(mat.Default_Unit_Price);
                            }
                        }}
                        options={materials.map(mat => ({
                            value: mat.Material_ID,
                            label: mat.Name,
                            subLabel: `${mat.Category} • ${mat.Unit}`
                        }))}
                        placeholder="Pretraži materijale..."
                    />
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


            {/* Edit Material Modal */}
            <Modal
                isOpen={editMaterialModal}
                onClose={() => setEditMaterialModal(false)}
                title="Uredi Materijal"
                footer={
                    <>
                        <button className="btn btn-secondary" onClick={() => setEditMaterialModal(false)}>Otkaži</button>
                        <button className="btn btn-primary" onClick={() => handleSaveEditMaterial()}>Sačuvaj</button>
                    </>
                }
            >
                {editingMaterial && (
                    <div className="edit-modal-content">
                        <div className="modal-header-info">
                            <div className="header-icon">📦</div>
                            <div className="header-details">
                                <div className="header-title">{editingMaterial.Material_Name}</div>
                                <div className="header-subtitle">Uređivanje detalja materijala</div>
                            </div>
                        </div>

                        <div className="modal-form-grid">
                            <div className="form-field">
                                <label>Količina <span className="required">*</span></label>
                                <div className="input-wrapper">
                                    <input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        value={editMaterialQty}
                                        onChange={(e) => setEditMaterialQty(parseFloat(e.target.value) || 0)}
                                        placeholder="0"
                                    />
                                    <span className="unit-badge">{editingMaterial.Unit || 'kom'}</span>
                                </div>
                            </div>

                            <div className="form-field">
                                <label>Cijena po jedinici</label>
                                <div className="input-wrapper">
                                    <input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        value={editMaterialPrice}
                                        onChange={(e) => setEditMaterialPrice(parseFloat(e.target.value) || 0)}
                                        placeholder="0.00"
                                    />
                                    <span className="currency-badge">KM</span>
                                </div>
                            </div>
                        </div>

                        <div className="total-price-card">
                            <span className="total-label">UKUPNA VRIJEDNOST</span>
                            <span className="total-amount">
                                {(editMaterialQty * editMaterialPrice).toFixed(2)}
                                <span className="total-currency">KM</span>
                            </span>
                        </div>

                        <label className={`essential-card ${editMaterialIsEssential ? 'active' : ''}`}>
                            <div className="checkbox-wrapper">
                                <input
                                    type="checkbox"
                                    checked={editMaterialIsEssential}
                                    onChange={(e) => setEditMaterialIsEssential(e.target.checked)}
                                />
                            </div>
                            <div className="essential-content">
                                <div className="essential-title">
                                    <span className="warning-icon">⚠️</span>
                                    Esencijalni materijal
                                </div>
                                <div className="essential-description">
                                    Označavanjem ovog materijala kao esencijalnog sprječavate početak proizvodnje dok se materijal ne zaprimi na stanje.
                                </div>
                            </div>
                        </label>
                    </div>
                )}
            </Modal>

            {/* Product Timeline Modal */}
            <ProductTimelineModal
                isOpen={timelineProduct !== null}
                onClose={() => setTimelineProduct(null)}
                productId={timelineProduct?.product.Product_ID || ''}
                productName={timelineProduct?.product.Name || ''}
                workLogs={workLogs.filter(wl => wl.Product_ID === timelineProduct?.product.Product_ID)}
                sellingPrice={timelineProduct?.sellingPrice}
                materialCost={timelineProduct?.materialCost}
                laborCost={timelineProduct?.laborCost}
                profit={timelineProduct?.profit}
                profitMargin={timelineProduct?.profitMargin}
            />

            <style jsx>{`
                .edit-modal-content {
                    display: flex;
                    flex-direction: column;
                    gap: 24px;
                }
                
                @media (max-width: 768px) {
                    .form-row {
                        flex-direction: column !important;
                        gap: 16px !important;
                    }
                    
                    .form-group label {
                        font-size: 13px !important;
                        margin-bottom: 6px !important;
                    }

                    .form-group input, 
                    .form-group select, 
                    .form-group textarea {
                        font-size: 16px !important; /* Prevents iOS zoom */
                        padding: 14px 16px !important;
                        height: auto !important;
                    }

                    .modal-form-grid {
                        grid-template-columns: 1fr !important;
                        gap: 16px !important;
                    }
                }

                .modal-header-info {
                    display: flex;
                    flex-direction: column;
                    gap: 24px;
                }

                .modal-header-info {
                    display: flex;
                    align-items: center;
                    gap: 16px;
                    padding: 20px;
                    background: linear-gradient(135deg, #f8fafc 0%, #eff6ff 100%);
                    border-radius: 12px;
                    border: 1px solid #e2e8f0;
                }

                .header-icon {
                    font-size: 28px;
                    background: white;
                    width: 48px;
                    height: 48px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    border-radius: 10px;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.05);
                }

                .header-title {
                    font-size: 16px;
                    font-weight: 600;
                    color: #0f172a;
                    margin-bottom: 2px;
                }

                .header-subtitle {
                    font-size: 13px;
                    color: #64748b;
                }

                .modal-form-grid {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 20px;
                }

                .form-field {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }

                .form-field label {
                    font-size: 13px;
                    font-weight: 500;
                    text-transform: none;
                    color: #4b5563;
                    letter-spacing: normal;
                }

                .required { color: #ef4444; }

                .input-wrapper {
                    position: relative;
                    display: flex;
                    align-items: center;
                }

                .input-wrapper input {
                    width: 100%;
                    padding: 12px 16px;
                    padding-right: 50px;
                    border: 1px solid #e2e8f0;
                    border-radius: 8px;
                    font-size: 15px;
                    font-weight: 500;
                    color: #0f172a;
                    transition: all 0.2s;
                    outline: none;
                }

                .input-wrapper input:focus {
                    border-color: #3b82f6;
                    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
                }

                .unit-badge, .currency-badge {
                    position: absolute;
                    right: 12px;
                    color: #94a3b8;
                    font-size: 13px;
                    font-weight: 500;
                    pointer-events: none;
                }

                .total-price-card {
                    background: #f0fdf4;
                    border: 1px solid #bbf7d0;
                    border-radius: 12px;
                    padding: 20px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }

                .total-label {
                    font-size: 12px;
                    font-weight: 700;
                    color: #15803d;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }

                .total-amount {
                    font-size: 24px;
                    font-weight: 700;
                    color: #166534;
                }

                .total-currency {
                    font-size: 14px;
                    color: #16a34a;
                    margin-left: 6px;
                    font-weight: 600;
                }

                .essential-card {
                    display: flex;
                    gap: 16px;
                    padding: 20px;
                    border: 1px solid #e2e8f0;
                    border-radius: 12px;
                    cursor: pointer;
                    transition: all 0.2s;
                    align-items: flex-start;
                }

                .essential-card:hover {
                    background: #f8fafc;
                    border-color: #cbd5e1;
                }

                .essential-card.active {
                    background: #fffbeb;
                    border-color: #fcd34d;
                }

                .checkbox-wrapper input {
                    width: 24px;
                    height: 24px;
                    accent-color: #d97706;
                    margin-top: 2px;
                    cursor: pointer;
                    border-radius: 6px;
                }

                .essential-content {
                    flex: 1;
                }

                .essential-title {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    font-size: 13px;
                    font-weight: 700;
                    text-transform: uppercase;
                    color: #0f172a;
                    margin-bottom: 4px;
                    letter-spacing: 0.5px;
                }

                .warning-icon {
                    font-size: 16px;
                    color: #f59e0b;
                }

                .essential-description {
                    font-size: 12px;
                    font-weight: 500;
                    color: #64748b;
                    line-height: 1.5;
                    text-transform: none;
                    letter-spacing: normal;
                }

                /* Quick Edit Styles */
                .btn-quick-edit {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    padding: 0;
                    background: none;
                    color: #f59e0b;
                    border: none;
                    cursor: pointer;
                    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                }

                .btn-quick-edit:hover {
                    transform: scale(1.1);
                    color: #d97706;
                }

                .btn-quick-edit:active {
                    transform: scale(0.95);
                }

                .btn-quick-edit.active {
                    color: #10b981;
                }

                .btn-quick-edit.active:hover {
                    color: #059669;
                }

                .btn-quick-edit .material-icons-round {
                    font-size: 22px;
                }

                .material-row.editing {
                    background: linear-gradient(90deg, #fffbeb 0%, #ffffff 100%);
                    border-left: 3px solid #f59e0b;
                    animation: highlightPulse 0.3s ease-out;
                }

                @keyframes highlightPulse {
                    0% {
                        background: #fef3c7;
                    }
                    100% {
                        background: linear-gradient(90deg, #fffbeb 0%, #ffffff 100%);
                    }
                }

                .quick-edit-input {
                    width: 100%;
                    max-width: 100px;
                    padding: 6px 10px;
                    border: 1.5px solid #f59e0b;
                    border-radius: 6px;
                    font-size: 14px;
                    font-weight: 500;
                    text-align: center;
                    background: white;
                    color: #1e293b;
                    transition: all 0.2s;
                }

                .quick-edit-input:focus {
                    outline: none;
                    border-color: #d97706;
                    box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.1);
                    background: #fffbeb;
                }

                .quick-edit-input:hover {
                    border-color: #fb923c;
                }

                /* Remove spinner arrows for number inputs in quick edit */
                .quick-edit-input::-webkit-outer-spin-button,
                .quick-edit-input::-webkit-inner-spin-button {
                    -webkit-appearance: none;
                    margin: 0;
                }

                .quick-edit-input[type=number] {
                    -moz-appearance: textfield;
                }
            `}</style>
        </div>
    );
}
