'use client';

import { useState, useEffect } from 'react';
import type { Project, Material, Product, ProductMaterial, WorkOrder, WorkOrderItem, Offer, OfferProduct, WorkLog } from '@/lib/types';
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
    updateAluDoorMaterial,
    saveProfitOverrides
} from '@/lib/services';
import Modal from '@/components/ui/Modal';
import GlassModal, { type GlassModalData } from '@/components/ui/GlassModal';
import AluDoorModal, { type AluDoorModalData } from '@/components/ui/AluDoorModal';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import MaterialSelectModal, { type SelectedMaterial } from '@/components/ui/MaterialSelectModal';

import ProductTimelineModal from '@/components/ui/ProductTimelineModal';
import ProductProcessPlan from '@/components/ui/ProductProcessPlan';
import { planToStages } from '@/lib/productProcesses';
import { naturalCompare } from '@/lib/naturalCompare';
import { projectProfitBreakdown } from '@/lib/projectProfit';

import ProjectMaterialsModal from '@/components/ui/ProjectMaterialsModal';
import InvoiceModal from '@/components/ui/InvoiceModal';
import { useData } from '@/context/DataContext';
import { syncAllProjectData, overrideWorkLogs } from '@/lib/services';
import { PROJECT_STATUSES, PRODUCTION_STEPS, MATERIAL_CATEGORIES } from '@/lib/types';
import { useIsMobile } from '@/hooks/useIsMobile';
import MobileProjectsView from './mobile/MobileProjectsView';
import MobileMaterialEditModal from './mobile/MobileMaterialEditModal';
import MobileProjectModal from './mobile/MobileProjectModal';
import MobileProductModal from './mobile/MobileProductModal';
import MobileMaterialAddModal from './mobile/MobileMaterialAddModal';
import SketchUpImportModal from '@/components/SketchUpImportModal';
import './ProjectsTab.css';

interface ProjectsTabProps {
    projects: Project[];
    materials: Material[];
    workOrders: WorkOrder[];
    offers?: Offer[];
    workLogs?: WorkLog[];
    onRefresh: (...collections: string[]) => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
    onNavigateToTasks?: (projectId: string) => void;
    onCreateWorkOrder?: (projectId: string, projectName: string, products: { productId: string; productName: string; quantity: number }[]) => void;
    autoExpandProjectId?: string | null;
    autoExpandProductId?: string | null;
    returnToOfferId?: string | null;
    onReturnToOffer?: (offerId: string) => void;
    onClearAutoExpand?: () => void;
}

export default function ProjectsTab({ projects, materials, workOrders = [], offers = [], workLogs = [], onRefresh, showToast, onNavigateToTasks, onCreateWorkOrder, autoExpandProjectId, autoExpandProductId, returnToOfferId, onReturnToOffer, onClearAutoExpand }: ProjectsTabProps) {
    const { organizationId, appState } = useData();
    const allWorkers = appState.workers || [];
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);
    const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());
    const [expandedStatusGroups, setExpandedStatusGroups] = useState<Set<string>>(new Set(['Nacrt', 'Ponuđeno', 'Odobreno', 'U proizvodnji', 'Završeno', 'Otkazano']));
    const [showMaterialsSummary, setShowMaterialsSummary] = useState<Set<string>>(new Set());
    const [materialsOverviewProject, setMaterialsOverviewProject] = useState<Project | null>(null);
    // Završni račun — otvara se za projekat koji ima prihvaćenu ponudu (vidi InvoiceModal).
    const [invoiceModalProject, setInvoiceModalProject] = useState<Project | null>(null);
    // Generiši planove procesa — batch auto/AI plan za sve proizvode projekta.
    // Samo ID — proizvod se svaki put izvodi svjež iz `projects` (onChanged→onRefresh mora odmah ažurirati modal)
    const [processPlanProductId, setProcessPlanProductId] = useState<string | null>(null);
    const processPlanProduct = processPlanProductId
        ? projects.flatMap(pr => pr.products || []).find(p => p.Product_ID === processPlanProductId) || null
        : null;
    const [syncing, setSyncing] = useState(false);
    const [showHidden, setShowHidden] = useState(false);

    // Work order product selection state
    const [selectedForWorkOrder, setSelectedForWorkOrder] = useState<Set<string>>(new Set());

    // Auto-expand project/product when navigating from OffersTab
    useEffect(() => {
        if (autoExpandProjectId) {
            setExpandedProjectId(autoExpandProjectId);
            if (autoExpandProductId) {
                setExpandedProducts(prev => new Set(prev).add(autoExpandProductId));
            }
            // Clear after applying
            if (onClearAutoExpand) {
                setTimeout(() => onClearAutoExpand(), 100);
            }
        }
    }, [autoExpandProjectId, autoExpandProductId]);

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
    const [sketchUpImportProductId, setSketchUpImportProductId] = useState<string | null>(null);


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
    // Track whether to re-open MaterialSelectModal after glass/alu modal closes
    const [reopenMaterialModalAfterSpecial, setReopenMaterialModalAfterSpecial] = useState(false);
    // Edit regular material modal
    const [editMaterialModal, setEditMaterialModal] = useState(false);
    const [editingMaterial, setEditingMaterial] = useState<ProductMaterial | null>(null);
    const [editMaterialQty, setEditMaterialQty] = useState(0);
    const [editMaterialPrice, setEditMaterialPrice] = useState(0);
    const [editMaterialIsEssential, setEditMaterialIsEssential] = useState(false);
    const [editMaterialNewId, setEditMaterialNewId] = useState<string>(''); // For swapping material
    const [editMaterialNewName, setEditMaterialNewName] = useState<string>('');
    const [editMaterialNewUnit, setEditMaterialNewUnit] = useState<string>('');
    const [editMaterialNewSupplier, setEditMaterialNewSupplier] = useState<string>('');

    // Material status dropdown
    const [statusDropdownMaterialId, setStatusDropdownMaterialId] = useState<string | null>(null);

    // Pending status change with quantity prompt (for 'Na stanju' / 'Primljeno')
    const [pendingStatusChange, setPendingStatusChange] = useState<{ materialId: string; status: string; currentQty: number } | null>(null);
    const [statusQtyInput, setStatusQtyInput] = useState<number>(0);

    // Quick edit mode for materials
    const [quickEditMode, setQuickEditMode] = useState<string | null>(null); // Product_ID in quick edit mode
    const [editingMaterialValues, setEditingMaterialValues] = useState<Record<string, { qty: number; price: number; materialId?: string; materialName?: string; unit?: string; supplier?: string }>>({});

    // Product Timeline Modal
    const [timelineProduct, setTimelineProduct] = useState<{
        product: Product;
        sellingPrice?: number;
        materialCost?: number;
        laborCost?: number;
        profit?: number;
        profitMargin?: number;
        workOrderItemId?: string;
        workOrderItem?: WorkOrderItem;
        originalSellingPrice?: number;
        originalExtras?: number;
        originalTransport?: number;
        hasOverrides?: boolean;
    } | null>(null);


    // Filter projects
    const hiddenCount = projects.filter(p => p.Hidden).length;

    const filteredProjects = projects.filter(project => {
        // Hide hidden projects unless showHidden is on
        if (!showHidden && project.Hidden) return false;
        // If showHidden is on and no other filters, show only hidden
        if (showHidden && !project.Hidden) return false;

        const term = searchTerm.toLowerCase();
        const matchesSearch = project.Client_Name.toLowerCase().includes(term) ||
            project.Name?.toLowerCase().includes(term) ||
            project.Address?.toLowerCase().includes(term) ||
            // Also search product names within the project
            (project.products || []).some(prod =>
                prod.Name?.toLowerCase().includes(term)
            );
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
        setExpandedProducts(prev => {
            const next = new Set(prev);
            if (next.has(productId)) {
                next.delete(productId);
            } else {
                next.add(productId);
            }
            return next;
        });
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

    async function handleToggleHidden(project: Project) {
        if (!organizationId) return;
        const newHidden = !project.Hidden;
        const result = await saveProject({ ...project, Hidden: newHidden }, organizationId);
        if (result.success) {
            showToast(newHidden ? 'Projekat sakriven' : 'Projekat prikazan', 'success');
            onRefresh('projects');
        } else {
            showToast('Greška pri ažuriranju projekta', 'error');
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
            // Also refresh offers and orders so renamed product names appear immediately
            onRefresh('projects', 'offers', 'orders');
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

        // Show immediate feedback
        showToast('Brisanje proizvoda...', 'info');

        // Run the actual delete — don't block the UI
        deleteProduct(productId, organizationId).then(async result => {
            if (result.success) {
                showToast(result.message, 'success');
                // Small delay to let Firestore settle after cascade deletes
                await new Promise(resolve => setTimeout(resolve, 500));
                onRefresh('projects');
            } else {
                showToast(result.message, 'error');
            }
        }).catch(err => {
            console.error('Delete product error:', err);
            showToast('Greška pri brisanju proizvoda', 'error');
        });
    }

    // Check if material is glass or alu door type
    function isGlassMaterial(mat: Material): boolean {
        return mat.Is_Glass === true || mat.Category === 'Staklo';
    }

    function isAluDoorMaterial(mat: Material): boolean {
        return mat.Is_Alu_Door === true || mat.Category === 'Alu vrata';
    }

    // Batch add materials from the new multi-select modal
    async function handleAddMaterials(items: SelectedMaterial[]) {
        const targetProductId = addingMaterial?.productId;
        if (!targetProductId || !organizationId) {
            showToast('Greška: nedostaje ID proizvoda', 'error');
            return;
        }

        let successCount = 0;
        let errorCount = 0;

        for (const item of items) {
            const result = await addMaterialToProduct({
                Product_ID: targetProductId,
                Material_ID: item.materialId,
                Material_Name: item.materialName,
                Quantity: item.quantity,
                Unit: item.unit,
                Unit_Price: item.price,
                Supplier: item.supplier,
            }, organizationId);

            if (result.success) {
                successCount++;
            } else {
                errorCount++;
            }
        }

        if (successCount > 0) {
            showToast(`Dodano ${successCount} materijal${successCount === 1 ? '' : 'a'}`, 'success');
            setMaterialModal(false);
            onRefresh('projects');
        }
        if (errorCount > 0) {
            showToast(`Greška pri dodavanju ${errorCount} materijala`, 'error');
        }
    }

    // Legacy single-add for mobile flow
    async function handleAddMaterial(data?: { materialId: string, quantity: number, price: number }) {
        const targetMaterialId = data?.materialId || selectedMaterial?.Material_ID;
        const targetQuantity = data?.quantity ?? materialQty;
        const targetPrice = data?.price ?? materialPrice;
        const targetProductId = addingMaterial?.productId;

        const targetMaterialObj = data
            ? materials.find(m => m.Material_ID === data.materialId)
            : selectedMaterial;

        if (!targetMaterialObj || !targetProductId) {
            showToast('Odaberite materijal', 'error');
            return;
        }

        if (isGlassMaterial(targetMaterialObj)) {
            setMaterialModal(false);
            setGlassProductId(targetProductId);
            setEditingGlassMaterial(null);
            setGlassModal(true);
            return;
        }

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

    // Glass/Alu redirect helpers — called from MaterialSelectModal
    function handleGlassRedirect(pId: string, materialId: string) {
        const mat = materials.find(m => m.Material_ID === materialId);
        setSelectedMaterial(mat || null);
        setGlassProductId(pId);
        setEditingGlassMaterial(null);
        setReopenMaterialModalAfterSpecial(true);
        setGlassModal(true);
    }

    function handleAluDoorRedirect(pId: string, materialId: string) {
        const mat = materials.find(m => m.Material_ID === materialId);
        setSelectedMaterial(mat || null);
        setAluDoorProductId(pId);
        setEditingAluDoorMaterial(null);
        setReopenMaterialModalAfterSpecial(true);
        setAluDoorModal(true);
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
            // Re-open MaterialSelectModal if this was triggered from it
            if (reopenMaterialModalAfterSpecial) {
                setReopenMaterialModalAfterSpecial(false);
                setGlassModal(false);
                setTimeout(() => setMaterialModal(true), 100);
                return;
            }
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
            // Re-open MaterialSelectModal if this was triggered from it
            if (reopenMaterialModalAfterSpecial) {
                setReopenMaterialModalAfterSpecial(false);
                setAluDoorModal(false);
                setTimeout(() => setMaterialModal(true), 100);
                return;
            }
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
        setEditMaterialNewId(material.Material_ID);
        setEditMaterialNewName(material.Material_Name);
        setEditMaterialNewUnit(material.Unit || '');
        setEditMaterialNewSupplier(material.Supplier || '');
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

        const updatePayload: Record<string, unknown> = {
            Quantity: editMaterialQty,
            Unit_Price: editMaterialPrice,
            Total_Price: editMaterialQty * editMaterialPrice,
            Is_Essential: editMaterialIsEssential
        };

        // If the material was changed, include Material_ID, Material_Name, Unit, Supplier
        if (editMaterialNewId && editMaterialNewId !== editingMaterial.Material_ID) {
            updatePayload.Material_ID = editMaterialNewId;
            updatePayload.Material_Name = editMaterialNewName;
            updatePayload.Unit = editMaterialNewUnit;
            updatePayload.Supplier = editMaterialNewSupplier;
        }

        const result = await updateProductMaterial(editingMaterial.ID, updatePayload as any, organizationId);

        if (result.success) {
            showToast('Materijal uspješno ažuriran', 'success');
            setEditMaterialModal(false);
            onRefresh('projects');
        } else {
            showToast(result.message, 'error');
        }
    }

    // Handle material status change (optimistic update to preserve UI state)
    async function handleMaterialStatusChange(materialId: string, newStatus: string, quantity?: number) {
        if (!organizationId) {
            showToast('Organization ID is required', 'error');
            return;
        }

        // Build update payload with quantity field sync
        const updates: Record<string, unknown> = { Status: newStatus };

        if (newStatus === 'Nije naručeno') {
            // Only clear Order_ID — quantities are managed by the order system
            // Zeroing them here would corrupt data if the material is in other active orders
            updates.Order_ID = '';
        } else if (newStatus === 'Na stanju') {
            updates.On_Stock = quantity ?? 0;
        } else if (newStatus === 'Primljeno') {
            updates.Received_Quantity = quantity ?? 0;
        }

        const result = await updateProductMaterial(materialId, updates as any, organizationId);
        if (result.success) {
            showToast(`Status materijala promjenjen u "${newStatus}"`, 'success');
            setStatusDropdownMaterialId(null);
            setPendingStatusChange(null);
            // Background refresh to sync data without disrupting UI
            onRefresh('projects');
        } else {
            showToast(result.message, 'error');
        }
    }

    // Handle status click — some statuses need quantity input first
    function handleStatusClick(material: ProductMaterial, targetStatus: string) {
        if (targetStatus === 'Na stanju' || targetStatus === 'Primljeno') {
            // Show quantity prompt
            const defaultQty = targetStatus === 'Na stanju'
                ? (material.On_Stock || material.Quantity || 0)
                : (material.Quantity || 0);
            setPendingStatusChange({ materialId: material.ID, status: targetStatus, currentQty: material.Quantity || 0 });
            setStatusQtyInput(defaultQty);
        } else {
            // Direct change (no quantity needed)
            handleMaterialStatusChange(material.ID, targetStatus);
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
                const initialValues: Record<string, { qty: number; price: number; materialId?: string; materialName?: string; unit?: string; supplier?: string }> = {};
                product.materials.forEach(mat => {
                    initialValues[mat.ID] = {
                        qty: mat.Quantity,
                        price: mat.Unit_Price,
                        materialId: mat.Material_ID,
                        materialName: mat.Material_Name,
                        unit: mat.Unit,
                        supplier: mat.Supplier
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

    function handleQuickEditMaterialChange(materialId: string, newMaterialCatalogId: string) {
        const catalogMat = materials.find(m => m.Material_ID === newMaterialCatalogId);
        if (!catalogMat || !organizationId) return;
        const currentValues = editingMaterialValues[materialId];
        const newValues = {
            ...currentValues,
            price: catalogMat.Default_Unit_Price,
            materialId: catalogMat.Material_ID,
            materialName: catalogMat.Name,
            unit: catalogMat.Unit,
            supplier: catalogMat.Default_Supplier || ''
        };
        setEditingMaterialValues(prev => ({
            ...prev,
            [materialId]: newValues
        }));
        // Auto-save immediately since SearchableSelect has no blur event
        updateProductMaterial(materialId, {
            Material_ID: catalogMat.Material_ID,
            Material_Name: catalogMat.Name,
            Unit: catalogMat.Unit,
            Supplier: catalogMat.Default_Supplier || '',
            Unit_Price: catalogMat.Default_Unit_Price,
            Quantity: currentValues?.qty || 0,
            Total_Price: (currentValues?.qty || 0) * catalogMat.Default_Unit_Price
        } as any, organizationId).then(result => {
            if (result.success) {
                showToast('Materijal ažuriran', 'success');
                onRefresh('projects');
            } else {
                showToast(result.message, 'error');
            }
        });
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

        const materialChanged = values.materialId && values.materialId !== material.Material_ID;

        // Only save if changed
        if (values.qty === material.Quantity && values.price === material.Unit_Price && !materialChanged) {
            return;
        }

        const updatePayload: Record<string, unknown> = {
            Quantity: values.qty,
            Unit_Price: values.price,
            Total_Price: values.qty * values.price
        };

        // If the material was swapped, include the new material fields
        if (materialChanged) {
            updatePayload.Material_ID = values.materialId;
            updatePayload.Material_Name = values.materialName;
            updatePayload.Unit = values.unit;
            updatePayload.Supplier = values.supplier;
        }

        const result = await updateProductMaterial(materialId, updatePayload as any, organizationId);

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

    function getBorderClass(status: string): string {
        return 'border-' + status.toLowerCase()
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

        // Simplify to 4 states for display in Projects tab:
        // 1. Na čekanju - waiting for production
        // 2. U proizvodnji - any production step in progress
        // 3. U montaži - any montaža step in progress
        // 4. Završeno - fully complete (Spremno for non-montaža, Instalirano for montaža)

        // VAŽNO: status proizvoda dolazi iz naloga — kad nalog krene, startWorkOrder upiše
        // IME PRVOG PROCESA (Production_Steps[0]), a syncProductStatuses ime aktivnog/zadnjeg
        // procesa. Ta imena su često iz prilagođenog kataloga i NE mogu se nabrojati unaprijed.
        const waitingStatuses = ['Na čekanju', 'Materijali naručeni', 'Materijali spremni'];
        const inMontazaStatuses = ['Transport', 'Montaža', 'Čišćenje', 'Primopredaja', 'U montaži'];
        const completedStatuses = ['Spremno', 'Instalirano', 'Završeno'];

        if (waitingStatuses.includes(status)) {
            return 'Na čekanju';
        }
        if (completedStatuses.includes(status)) {
            return 'Završeno';
        }
        if (inMontazaStatuses.includes(status)) {
            return 'U montaži';
        }

        // Nepoznat string u Product.Status (npr. uvozni sentinel 'U pripremi', stari/ručni unos) —
        // NE pretpostavljamo proizvodnju samo zato što se ne poklapa ni sa jednom listom gore.
        // Status mora potvrditi STVARAN radni nalog: proizvod je "u proizvodnji"/"u montaži"
        // samo ako ga referencira stavka aktivnog (neotkazanog) naloga koja je 'U toku'.
        // Bez toga → 'Na čekanju', bez obzira šta piše u zastarjelom/nepoznatom Product.Status.
        const hasActiveOrderItem = workOrders.some(wo =>
            wo.Status !== 'Otkazano' &&
            (wo.items || []).some(it => it.Product_ID === product.Product_ID && it.Status === 'U toku')
        );
        if (!hasActiveOrderItem) {
            return 'Na čekanju';
        }
        const activeMontaza = workOrders.some(wo =>
            wo.Work_Order_Type === 'Montaža' && wo.Status !== 'Otkazano' &&
            (wo.items || []).some(it => it.Product_ID === product.Product_ID && it.Status === 'U toku')
        );
        if (activeMontaza) {
            return 'U montaži';
        }
        // Potvrđeno aktivnim nalogom proizvodnje.
        return 'U proizvodnji';
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
                    onToggleHidden={handleToggleHidden}
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
                            <label>Tip klijenta</label>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <button
                                    type="button"
                                    className={`glass-btn ${(editingProject?.Client_Type || 'fizicko') === 'fizicko' ? 'glass-btn-primary' : ''}`}
                                    onClick={() => setEditingProject({ ...editingProject, Client_Type: 'fizicko' })}
                                    style={{ flex: 1, fontSize: '13px', padding: '8px 12px' }}
                                >
                                    Fizičko lice
                                </button>
                                <button
                                    type="button"
                                    className={`glass-btn ${editingProject?.Client_Type === 'pravno' ? 'glass-btn-primary' : ''}`}
                                    onClick={() => setEditingProject({ ...editingProject, Client_Type: 'pravno' })}
                                    style={{ flex: 1, fontSize: '13px', padding: '8px 12px' }}
                                >
                                    Pravno lice
                                </button>
                            </div>
                        </div>
                        {editingProject?.Client_Type === 'pravno' && (
                            <>
                                <div className="form-group">
                                    <label>ID broj (JIB)</label>
                                    <input
                                        type="text"
                                        className="form-control"
                                        value={editingProject?.Client_ID_Number || ''}
                                        onChange={(e) => setEditingProject({ ...editingProject, Client_ID_Number: e.target.value })}
                                        placeholder="4200000000000"
                                    />
                                </div>
                                <div className="form-group">
                                    <label>PDV broj</label>
                                    <input
                                        type="text"
                                        className="form-control"
                                        value={editingProject?.Client_PDV_Number || ''}
                                        onChange={(e) => setEditingProject({ ...editingProject, Client_PDV_Number: e.target.value })}
                                        placeholder="200000000000"
                                    />
                                </div>
                            </>
                        )}
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

                {/* Add Material Modal — Multi-select */}
                {isMobile ? (
                    <MobileMaterialAddModal
                        isOpen={materialModal}
                        onClose={() => setMaterialModal(false)}
                        materials={materials}
                        onAdd={handleAddMaterial}
                    />
                ) : (
                    <MaterialSelectModal
                        isOpen={materialModal}
                        onClose={() => setMaterialModal(false)}
                        materials={materials}
                        productId={addingMaterial?.productId || ''}
                        organizationId={organizationId || ''}
                        onAddMaterials={handleAddMaterials}
                        onGlassRedirect={handleGlassRedirect}
                        onAluDoorRedirect={handleAluDoorRedirect}
                        onRefresh={onRefresh}
                        showToast={showToast}
                    />
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
                        materials={materials}
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
                                <div className="form-field" style={{ marginBottom: '16px' }}>
                                    <label>Materijal</label>
                                    <SearchableSelect
                                        value={editMaterialNewId}
                                        onChange={(value) => {
                                            const mat = materials.find(m => m.Material_ID === value);
                                            if (mat) {
                                                setEditMaterialNewId(mat.Material_ID);
                                                setEditMaterialNewName(mat.Name);
                                                setEditMaterialNewUnit(mat.Unit);
                                                setEditMaterialNewSupplier(mat.Default_Supplier || '');
                                                setEditMaterialPrice(mat.Default_Unit_Price);
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
                                            <span className="unit-badge">{editMaterialNewUnit || editingMaterial.Unit || 'kom'}</span>
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

                {/* Project Materials Overview Modal */}
                {materialsOverviewProject && (
                    <ProjectMaterialsModal
                        isOpen={!!materialsOverviewProject}
                        onClose={() => setMaterialsOverviewProject(null)}
                        project={materialsOverviewProject}
                    />
                )}


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
                <button
                    className={`glass-btn archive-toggle-btn ${showHidden ? 'archive-active' : ''}`}
                    onClick={() => setShowHidden(!showHidden)}
                    title={showHidden ? 'Prikaži aktivne projekte' : 'Prikaži skrivene projekte'}
                >
                    <span className="material-icons-round">{showHidden ? 'inventory_2' : 'archive'}</span>
                    {showHidden ? 'Aktivni' : 'Arhiva'}
                    {!showHidden && hiddenCount > 0 && (
                        <span className="archive-badge">{hiddenCount}</span>
                    )}
                </button>
                <button className="glass-btn glass-btn-primary" onClick={() => openProjectModal()}>
                    <span className="material-icons-round">add</span>
                    Novi Projekat
                </button>
                <button
                    className="glass-btn"
                    disabled={syncing || !organizationId}
                    onClick={async () => {
                        if (!organizationId) return;
                        setSyncing(true);
                        showToast('Sinkronizacija u toku...', 'info');
                        try {
                            const result = await syncAllProjectData(organizationId);
                            showToast(`Sinkronizacija završena: ${result.workLogsCreated} logova kreirano, ${result.workOrdersRecalculated} naloga preračunato`, 'success');
                            onRefresh('projects', 'workOrders');
                        } catch (err) {
                            console.error('Sync error:', err);
                            showToast('Greška pri sinkronizaciji', 'error');
                        } finally {
                            setSyncing(false);
                        }
                    }}
                >
                    <span className="material-icons-round">{syncing ? 'hourglass_empty' : 'sync'}</span>
                    {syncing ? 'Sinkronizacija...' : 'Sinkroniziraj'}
                </button>
            </div>

            {/* Back to Offer Banner */}
            {returnToOfferId && onReturnToOffer && (
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '10px 16px',
                    marginBottom: '12px',
                    background: 'linear-gradient(135deg, #e8f4fd 0%, #dbeafe 100%)',
                    border: '1px solid #93c5fd',
                    borderRadius: '10px',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    boxShadow: '0 1px 3px rgba(59, 130, 246, 0.1)',
                }}
                    onClick={() => onReturnToOffer(returnToOfferId)}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = '0 2px 8px rgba(59, 130, 246, 0.2)'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = '0 1px 3px rgba(59, 130, 246, 0.1)'; }}
                >
                    <span className="material-icons-round" style={{ fontSize: '20px', color: '#2563eb' }}>arrow_back</span>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: '#1e40af' }}>Vrati se na ponudu</span>
                    <span style={{ fontSize: '12px', color: '#3b82f6', marginLeft: 'auto' }}>Klikni za povratak</span>
                </div>
            )}

            <div className="projects-list">
                {filteredProjects.length === 0 ? (
                    <div className="empty-state">
                        <span className="material-icons-round">{showHidden ? 'inventory_2' : 'folder_off'}</span>
                        <h3>{showHidden ? 'Nema skrivenih projekata' : 'Nema projekata'}</h3>
                        <p>{showHidden ? 'Trenutno nema arhiviranih projekata' : 'Kreirajte prvi projekat klikom na "Novi Projekat"'}</p>
                    </div>
                ) : (
                    // Unified view: always grouped by status, expanded projects show products inline
                    groupedProjects.map(group => (
                        <div key={group.status} className="status-group" style={{ marginBottom: '16px' }}>
                            <div
                                className={`status-group-header ${expandedStatusGroups.has(group.status) ? 'expanded' : ''}`}
                                onClick={() => toggleStatusGroup(group.status)}
                            >
                                <span
                                    className="material-icons-round status-group-chevron"
                                    style={{
                                        transform: expandedStatusGroups.has(group.status) ? 'rotate(90deg)' : 'rotate(0deg)'
                                    }}
                                >
                                    chevron_right
                                </span>
                                <span className="status-group-label">
                                    {group.status}
                                </span>
                                <div className="status-group-line"></div>
                                <span
                                    className="status-group-count"
                                    style={{
                                        color: getStatusColor(group.status).color,
                                        background: getStatusColor(group.status).bg
                                    }}
                                >
                                    {group.projects.length} {group.projects.length === 1 ? 'projekat' : 'projekata'}
                                </span>
                            </div>
                            {expandedStatusGroups.has(group.status) && group.projects.map(project => {
                                const isExpanded = expandedProjectId === project.Project_ID;
                                const totalProducts = project.products?.length || 0;
                                const totalMaterialCost = (project.products || []).reduce((sum, p) => {
                                    return sum + (p.materials || []).reduce((ms, m) => ms + (m.Total_Price || 0), 0);
                                }, 0);
                                const sortedProducts = [...(project.products || [])].sort((a, b) => {
                                    const statusA = getProductStatus(a);
                                    const statusB = getProductStatus(b);

                                    const getStatusWeight = (status: string) => {
                                        if (status === 'U proizvodnji') return 1;
                                        if (status === 'Na čekanju') return 2;
                                        return 3;
                                    };

                                    const weightA = getStatusWeight(statusA);
                                    const weightB = getStatusWeight(statusB);

                                    if (weightA !== weightB) {
                                        return weightA - weightB;
                                    }

                                    // Prirodni poredak naziva (Poz 1 < Poz 2 < Poz 10, E1 < E2 < E10)
                                    return naturalCompare(a.Name, b.Name);
                                });
                                const previewProducts = sortedProducts.slice(0, 3);
                                const moreCount = totalProducts - previewProducts.length;

                                // Profit projekta = Σ profita svih njegovih naloga (isti izvor/formula kao
                                // WorkOrderExpandedDetail — vidi lib/projectProfit.ts). Bez preskoka stavki
                                // bez cijene: rad uložen u nedefinisan proizvod je vidljiv gubitak.
                                const projectFin = projectProfitBreakdown({
                                    projectId: project.Project_ID,
                                    workOrders,
                                    workLogs,
                                });
                                const projectProfit = Math.round(projectFin.profit);
                                const projectMargin = Math.round(projectFin.margin);
                                const totalServicesCost = projectFin.services;
                                const hasAnyProfit = projectFin.itemCount > 0;
                                const projectProfitIncomplete = projectFin.missingPrice;

                                return (
                                    <div key={project.Project_ID} className={`project-card ${getBorderClass(project.Status)}`}>
                                        <div className="project-header" onClick={() => toggleProject(project.Project_ID)}>
                                            <button className={`expand-btn ${isExpanded ? 'expanded' : ''}`}>
                                                <span className="material-icons-round">chevron_right</span>
                                            </button>

                                            <div className="project-main-info">
                                                <div className="project-name">{project.Name || project.Client_Name}</div>
                                                {project.Name && <div className="project-client-subtitle">{project.Client_Name}</div>}

                                                {/* Info Chips */}
                                                <div className="project-details">
                                                    {project.Address && (
                                                        <span className="info-chip">
                                                            <span className="material-icons-round">location_on</span>
                                                            {project.Address}
                                                        </span>
                                                    )}
                                                    <span className="info-chip">
                                                        <span className="material-icons-round">inventory_2</span>
                                                        {totalProducts} {totalProducts === 1 ? 'proizvod' : 'proizvoda'}
                                                    </span>
                                                    {(totalMaterialCost + totalServicesCost) > 0 && (
                                                        <span className="info-chip chip-cost">
                                                            <span className="material-icons-round">payments</span>
                                                            {(totalMaterialCost + totalServicesCost).toLocaleString('hr-HR')} KM
                                                        </span>
                                                    )}
                                                    {hasAnyProfit && (
                                                        <span className={`info-chip ${
                                                            projectMargin >= 30 ? 'chip-profit-good' :
                                                            projectMargin >= 15 ? 'chip-profit-mid' : 'chip-profit-bad'
                                                        }`}
                                                            title={`Profit: ${projectProfit.toLocaleString('hr-HR')} KM (${projectMargin}%)${projectProfitIncomplete ? ' — neki proizvodi nemaju cijenu, profit je nepotpun' : ''}`}
                                                        >
                                                            <span className="material-icons-round">
                                                                {projectMargin >= 30 ? 'trending_up' : projectMargin >= 15 ? 'trending_flat' : 'trending_down'}
                                                            </span>
                                                            {projectProfit.toLocaleString('hr-HR')} KM ({projectMargin}%)
                                                            {projectProfitIncomplete && (
                                                                <span className="material-icons-round" style={{ fontSize: '14px', marginLeft: '2px' }}>warning_amber</span>
                                                            )}
                                                        </span>
                                                    )}
                                                </div>

                                                {/* Product Preview Strip — only when collapsed */}
                                                {!isExpanded && totalProducts > 0 && (
                                                    <div className="product-preview-strip">
                                                        {previewProducts.map(p => (
                                                            <span key={p.Product_ID} className="product-preview-tag">
                                                                {p.Name || 'Bez naziva'}
                                                            </span>
                                                        ))}
                                                        {moreCount > 0 && (
                                                            <span className="product-preview-more">+{moreCount}</span>
                                                        )}
                                                    </div>
                                                )}
                                            </div>

                                            <div className="project-right-section">
                                                <span className={`status-badge ${getStatusClass(project.Status)}`}>
                                                    {project.Status}
                                                </span>
                                                <div className="project-actions" onClick={(e) => e.stopPropagation()}>
                                                    <button className="icon-btn" onClick={() => setMaterialsOverviewProject(project)} title="Pregled materijala">
                                                        <span className="material-icons-round">inventory</span>
                                                    </button>
                                                    {offers.some(o => o.Project_ID === project.Project_ID && o.Status === 'Prihvaćeno') && (
                                                        <button className="icon-btn" onClick={() => setInvoiceModalProject(project)} title="Završni račun">
                                                            <span className="material-icons-round">receipt_long</span>
                                                        </button>
                                                    )}
                                                    {onNavigateToTasks && (
                                                        <button className="icon-btn" onClick={() => onNavigateToTasks(project.Project_ID)} title="Zadaci">
                                                            <span className="material-icons-round">task_alt</span>
                                                        </button>
                                                    )}
                                                    <button className="icon-btn" onClick={() => openProjectModal(project)} title="Uredi projekat">
                                                        <span className="material-icons-round">edit</span>
                                                    </button>
                                                    <button className={`icon-btn archive-icon-btn ${project.Hidden ? 'is-hidden' : ''}`} onClick={() => handleToggleHidden(project)} title={project.Hidden ? 'Vrati iz arhive' : 'Arhiviraj projekat'}>
                                                        <span className="material-icons-round">{project.Hidden ? 'unarchive' : 'archive'}</span>
                                                    </button>
                                                    <button className="icon-btn danger" onClick={() => handleDeleteProject(project.Project_ID)} title="Obriši projekat">
                                                        <span className="material-icons-round">delete</span>
                                                    </button>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Expanded: Products Section */}
                                        {isExpanded && (
                                            <>
                                                <div className={`project-products expanded`}>
                                                    <div className="products-header">
                                                        <h4>Proizvodi ({project.products?.length || 0})</h4>
                                                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                            {onCreateWorkOrder && sortedProducts.length > 0 && (
                                                                <button className="btn-add-item" onClick={() => {
                                                                    const allIds = sortedProducts.map(p => p.Product_ID);
                                                                    const allSelected = allIds.every(id => selectedForWorkOrder.has(id));
                                                                    if (allSelected) {
                                                                        setSelectedForWorkOrder(prev => {
                                                                            const next = new Set(prev);
                                                                            allIds.forEach(id => next.delete(id));
                                                                            return next;
                                                                        });
                                                                    } else {
                                                                        setSelectedForWorkOrder(prev => {
                                                                            const next = new Set(prev);
                                                                            allIds.forEach(id => next.add(id));
                                                                            return next;
                                                                        });
                                                                    }
                                                                }}>
                                                                    <span className="material-icons-round">
                                                                        {sortedProducts.every(p => selectedForWorkOrder.has(p.Product_ID)) ? 'deselect' : 'select_all'}
                                                                    </span>
                                                                    {sortedProducts.every(p => selectedForWorkOrder.has(p.Product_ID)) ? 'Poništi odabir' : 'Odaberi sve'}
                                                                </button>
                                                            )}
                                                            <button className="btn-add-item" onClick={() => openProductModal(project.Project_ID)}>
                                                                <span className="material-icons-round">add</span>
                                                                Dodaj proizvod
                                                            </button>
                                                        </div>
                                                    </div>

                                                    {sortedProducts.map(product => (
                                                        <div key={product.Product_ID} className={`product-card ${selectedForWorkOrder.has(product.Product_ID) ? 'selected-for-order' : ''}`}>
                                                            <div className="product-header" onClick={() => toggleProduct(product.Product_ID)}>
                                                                {onCreateWorkOrder && (
                                                                    <div
                                                                        className={`product-select-checkbox ${selectedForWorkOrder.has(product.Product_ID) ? 'checked' : ''}`}
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            setSelectedForWorkOrder(prev => {
                                                                                const next = new Set(prev);
                                                                                if (next.has(product.Product_ID)) {
                                                                                    next.delete(product.Product_ID);
                                                                                } else {
                                                                                    next.add(product.Product_ID);
                                                                                }
                                                                                return next;
                                                                            });
                                                                        }}
                                                                    >
                                                                        <span className="material-icons-round">
                                                                            {selectedForWorkOrder.has(product.Product_ID) ? 'check_box' : 'check_box_outline_blank'}
                                                                        </span>
                                                                    </div>
                                                                )}
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
                                                                {/* Material Cost Badge */}
                                                                {(() => {
                                                                    const matCost = (product.materials || []).reduce((sum, m) => sum + (m.Total_Price || 0), 0);
                                                                    if (matCost > 0) {
                                                                        return (
                                                                            <span className="product-cost-badge">
                                                                                {formatCurrency(matCost)}
                                                                            </span>
                                                                        );
                                                                    }
                                                                    return null;
                                                                })()}
                                                                {/* Process Plan Badge — broj procesa/faza na prvi pogled (bez otvaranja modala) */}
                                                                {(() => {
                                                                    const stages = planToStages(product.Process_Stages, product.Process_Plan);
                                                                    if (stages.length === 0) return null;
                                                                    const count = stages.reduce((s, st) => s + st.length, 0);
                                                                    return (
                                                                        <span
                                                                            className="product-cost-badge"
                                                                            style={{ background: '#eef2ff', color: '#4338ca', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                                                                            title={`${count} ${count === 1 ? 'proces' : 'procesa'} u ${stages.length} ${stages.length === 1 ? 'fazi' : 'faze'}`}
                                                                        >
                                                                            <span className="material-icons-round" style={{ fontSize: '13px' }}>account_tree</span>
                                                                            {count} · {stages.length}f
                                                                        </span>
                                                                    );
                                                                })()}
                                                                <div className="product-actions" onClick={(e) => e.stopPropagation()}>
                                                                    <button className="icon-btn" onClick={() => setProcessPlanProductId(product.Product_ID)} title="Plan procesa">
                                                                        <span className="material-icons-round">account_tree</span>
                                                                    </button>
                                                                    <button className="icon-btn" onClick={() => openProductModal(project.Project_ID, product)} title="Uredi proizvod">
                                                                        <span className="material-icons-round">edit</span>
                                                                    </button>
                                                                    <button className="icon-btn danger" onClick={() => handleDeleteProduct(product.Product_ID)} title="Obriši proizvod">
                                                                        <span className="material-icons-round">delete</span>
                                                                    </button>
                                                                </div>
                                                            </div>

                                                            {/* Product Materials — shown when expanded */}
                                                            {expandedProducts.has(product.Product_ID) && (() => {
                                                                const productMats = product.materials || [];

                                                                return (
                                                                    <div className="product-materials">
                                                                        <div className="materials-header">
                                                                            <div className="materials-header-left">
                                                                                <h5>Materijali ({productMats.length})</h5>
                                                                            </div>
                                                                            <div className="materials-header-actions">
                                                                                <button className="btn-add-item" onClick={() => {
                                                                                    setSketchUpImportProductId(product.Product_ID);
                                                                                }}>
                                                                                    <span className="material-icons-round">upload_file</span>
                                                                                    SketchUp
                                                                                </button>
                                                                                <button className="btn-add-item" onClick={() => openMaterialModal(product.Product_ID)}>
                                                                                    <span className="material-icons-round">add</span>
                                                                                    Dodaj materijal
                                                                                </button>
                                                                                <button
                                                                                    className={`btn-add-item ${quickEditMode === product.Product_ID ? 'active' : ''}`}
                                                                                    onClick={() => toggleQuickEdit(product.Product_ID)}
                                                                                    title="Brzo uređivanje"
                                                                                >
                                                                                    <span className="material-icons-round">{quickEditMode === product.Product_ID ? 'check' : 'edit_note'}</span>
                                                                                    {quickEditMode === product.Product_ID ? 'Gotovo' : 'Brzo uređivanje'}
                                                                                </button>
                                                                            </div>
                                                                        </div>

                                                                        <div className="materials-table">
                                                                            <div className="mat-row mat-header">
                                                                                <div className="mat-col-name">Materijal</div>
                                                                                <div className="mat-col-qty">Količina</div>
                                                                                <div className="mat-col-price">Cijena</div>
                                                                                <div className="mat-col-total">Ukupno</div>
                                                                                <div className="mat-col-status">Status</div>
                                                                                <div className="mat-col-actions"></div>
                                                                            </div>

                                                                            {productMats.map(material => {
                                                                                const isInQuickEdit = quickEditMode === product.Product_ID;
                                                                                const editValues = editingMaterialValues[material.ID] || { qty: material.Quantity, price: material.Unit_Price };
                                                                                const isGlass = (material as any).Category === 'Staklo' || (material as any).Is_Glass;
                                                                                const isAluDoor = (material as any).Category === 'Alu vrata' || (material as any).Is_Alu_Door;

                                                                                return (
                                                                                    <div key={material.ID} className={`mat-row ${material.Is_Essential ? 'essential' : ''}`}>
                                                                                        <div className="mat-col-name">
                                                                                            <span className="mobile-label">Materijal:</span>
                                                                                            {isInQuickEdit && !isGlass && !isAluDoor ? (
                                                                                                <div className="mat-col-name-select">
                                                                                                    <SearchableSelect
                                                                                                        value={editValues.materialId || material.Material_ID}
                                                                                                        onChange={(value) => handleQuickEditMaterialChange(material.ID, value)}
                                                                                                        options={materials.map(m => ({
                                                                                                            value: m.Material_ID,
                                                                                                            label: m.Name,
                                                                                                            subLabel: `${m.Category} • ${m.Unit}`
                                                                                                        }))}
                                                                                                        placeholder="Promijeni materijal..."
                                                                                                    />
                                                                                                </div>
                                                                                            ) : (
                                                                                                <>
                                                                                                    <span className="mat-name">{material.Material_Name}</span>
                                                                                                    {material.Supplier && <span className="mat-supplier">{material.Supplier}</span>}
                                                                                                </>
                                                                                            )}
                                                                                        </div>
                                                                                        <div className="mat-col-qty">
                                                                                            <span className="mobile-label">Količina:</span>
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
                                                                                                                    {pendingStatusChange && pendingStatusChange.materialId === material.ID ? (
                                                                                                                        <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: '6px', minWidth: '180px' }}>
                                                                                                                            <span style={{ fontSize: '12px', fontWeight: 600, color: '#334155' }}>
                                                                                                                                {pendingStatusChange.status === 'Na stanju' ? 'Količina na stanju' : 'Primljena količina'}
                                                                                                                            </span>
                                                                                                                            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                                                                                                                <input
                                                                                                                                    type="number"
                                                                                                                                    step="0.01"
                                                                                                                                    min="0"
                                                                                                                                    value={statusQtyInput}
                                                                                                                                    onChange={(e) => setStatusQtyInput(parseFloat(e.target.value) || 0)}
                                                                                                                                    onKeyDown={(e) => {
                                                                                                                                        if (e.key === 'Enter') {
                                                                                                                                            handleMaterialStatusChange(pendingStatusChange.materialId, pendingStatusChange.status, statusQtyInput);
                                                                                                                                        } else if (e.key === 'Escape') {
                                                                                                                                            setPendingStatusChange(null);
                                                                                                                                        }
                                                                                                                                    }}
                                                                                                                                    autoFocus
                                                                                                                                    style={{
                                                                                                                                        width: '80px', padding: '4px 8px', borderRadius: '6px',
                                                                                                                                        border: '1px solid #cbd5e1', fontSize: '13px', textAlign: 'center',
                                                                                                                                        outline: 'none'
                                                                                                                                    }}
                                                                                                                                />
                                                                                                                                <button
                                                                                                                                    onClick={() => handleMaterialStatusChange(pendingStatusChange.materialId, pendingStatusChange.status, statusQtyInput)}
                                                                                                                                    style={{
                                                                                                                                        padding: '4px 10px', borderRadius: '6px', border: 'none',
                                                                                                                                        background: '#2563eb', color: '#fff', fontSize: '12px',
                                                                                                                                        fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap'
                                                                                                                                    }}
                                                                                                                                >
                                                                                                                                    OK
                                                                                                                                </button>
                                                                                                                                <button
                                                                                                                                    onClick={() => setPendingStatusChange(null)}
                                                                                                                                    style={{
                                                                                                                                        padding: '4px 8px', borderRadius: '6px', border: '1px solid #e2e8f0',
                                                                                                                                        background: '#f8fafc', color: '#64748b', fontSize: '12px',
                                                                                                                                        cursor: 'pointer'
                                                                                                                                    }}
                                                                                                                                >
                                                                                                                                    ✕
                                                                                                                                </button>
                                                                                                                            </div>
                                                                                                                        </div>
                                                                                                                    ) : (
                                                                                                                        allowedTransitions.map(targetStatus => (
                                                                                                                            <button
                                                                                                                                key={targetStatus}
                                                                                                                                className="status-dropdown-item"
                                                                                                                                onClick={() => handleStatusClick(material, targetStatus)}
                                                                                                                            >
                                                                                                                                <span className="material-icons-round">{statusIcons[targetStatus] || 'swap_horiz'}</span>
                                                                                                                                {targetStatus}
                                                                                                                            </button>
                                                                                                                        ))
                                                                                                                    )}
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
                                                            })()}
                                                        </div>
                                                    ))}

                                                    {/* Floating Work Order Selection Toolbar */}
                                                    {onCreateWorkOrder && (() => {
                                                        const selectedInThisProject = sortedProducts.filter(p => selectedForWorkOrder.has(p.Product_ID));
                                                        if (selectedInThisProject.length === 0) return null;
                                                        return (
                                                            <div className="product-selection-toolbar">
                                                                <div className="selection-info">
                                                                    <span className="material-icons-round" style={{ fontSize: '20px' }}>checklist</span>
                                                                    <span className="selection-count">{selectedInThisProject.length}</span>
                                                                    <span>proizvod{selectedInThisProject.length === 1 ? '' : 'a'} odabrano</span>
                                                                </div>
                                                                <div className="selection-actions">
                                                                    <button
                                                                        className="btn-clear-selection"
                                                                        onClick={() => {
                                                                            setSelectedForWorkOrder(prev => {
                                                                                const next = new Set(prev);
                                                                                selectedInThisProject.forEach(p => next.delete(p.Product_ID));
                                                                                return next;
                                                                            });
                                                                        }}
                                                                    >
                                                                        <span className="material-icons-round" style={{ fontSize: '16px' }}>close</span>
                                                                        Poništi
                                                                    </button>
                                                                    <button
                                                                        className="btn-create-wo"
                                                                        onClick={() => {
                                                                            onCreateWorkOrder(
                                                                                project.Project_ID,
                                                                                project.Client_Name,
                                                                                selectedInThisProject.map(p => ({
                                                                                    productId: p.Product_ID,
                                                                                    productName: p.Name,
                                                                                    quantity: p.Quantity || 1,
                                                                                }))
                                                                            );
                                                                            setSelectedForWorkOrder(new Set());
                                                                        }}
                                                                    >
                                                                        <span className="material-icons-round">assignment</span>
                                                                        Kreiraj radni nalog
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        );
                                                    })()}
                                                </div>

                                                {/* Grouped Materials Summary */}
                                                {(() => {
                                                    const materialMap = new Map<string, { name: string; unit: string; totalQty: number; onStockQty: number; orderedQty: number; receivedQty: number }>();
                                                    (project.products || []).forEach(product => {
                                                        (product.materials || []).forEach(mat => {
                                                            const key = `${mat.Material_Name}||${mat.Unit}`;
                                                            const qty = mat.Quantity || 0;
                                                            const onStock = mat.On_Stock || 0;
                                                            const ordered = mat.Ordered_Quantity || (mat.Status === 'Naručeno' ? qty : 0);
                                                            const received = mat.Received_Quantity || (mat.Status === 'Primljeno' ? qty : (mat.Status === 'Na stanju' ? onStock : 0));
                                                            if (materialMap.has(key)) {
                                                                const existing = materialMap.get(key)!;
                                                                existing.totalQty += qty;
                                                                existing.onStockQty += onStock;
                                                                existing.orderedQty += ordered;
                                                                existing.receivedQty += received;
                                                            } else {
                                                                materialMap.set(key, {
                                                                    name: mat.Material_Name, unit: mat.Unit, totalQty: qty,
                                                                    onStockQty: onStock, orderedQty: ordered, receivedQty: received,
                                                                });
                                                            }
                                                        });
                                                    });
                                                    if (materialMap.size === 0) return null;
                                                    const groupedMats = Array.from(materialMap.values()).sort((a, b) => a.name.localeCompare(b.name, 'hr'));
                                                    const isOpen = showMaterialsSummary.has(project.Project_ID);
                                                    return (
                                                        <div className="mat-summary-wrapper">
                                                            <div
                                                                className="mat-summary-toggle"
                                                                onClick={() => {
                                                                    const next = new Set(showMaterialsSummary);
                                                                    if (next.has(project.Project_ID)) next.delete(project.Project_ID); else next.add(project.Project_ID);
                                                                    setShowMaterialsSummary(next);
                                                                }}
                                                            >
                                                                <span className="material-icons-round mat-summary-chevron" style={{ transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>chevron_right</span>
                                                                <span className="mat-summary-label">Pregled materijala</span>
                                                                <span className="mat-summary-count">({groupedMats.length})</span>
                                                            </div>
                                                            {isOpen && (
                                                                <table className="mat-summary-table">
                                                                    <thead>
                                                                        <tr>
                                                                            <th className="mat-summary-th left">Materijal</th>
                                                                            <th className="mat-summary-th">Potrebno</th>
                                                                            <th className="mat-summary-th">Na stanju</th>
                                                                            <th className="mat-summary-th">Naručeno</th>
                                                                            <th className="mat-summary-th">Primljeno</th>
                                                                            <th className="mat-summary-th">Preostalo</th>
                                                                            <th className="mat-summary-th">Status</th>
                                                                        </tr>
                                                                    </thead>
                                                                    <tbody>
                                                                        {groupedMats.map((mat, i) => {
                                                                            const covered = mat.onStockQty + mat.orderedQty + mat.receivedQty;
                                                                            const remaining = Math.max(0, mat.totalQty - covered);
                                                                            let statusLabel: string, statusColor: string, statusBg: string;
                                                                            if (mat.receivedQty >= mat.totalQty) { statusLabel = 'Primljeno'; statusColor = '#10b981'; statusBg = '#ecfdf5'; }
                                                                            else if (mat.receivedQty > 0) { statusLabel = 'Djelomično primljeno'; statusColor = '#06b6d4'; statusBg = '#ecfeff'; }
                                                                            else if (covered >= mat.totalQty) { statusLabel = 'Naručeno'; statusColor = '#3b82f6'; statusBg = '#eff6ff'; }
                                                                            else if (mat.orderedQty > 0) { statusLabel = 'Djelomično naručeno'; statusColor = '#8b5cf6'; statusBg = '#f5f3ff'; }
                                                                            else if (mat.onStockQty > 0) { statusLabel = 'Na stanju'; statusColor = '#10b981'; statusBg = '#ecfdf5'; }
                                                                            else { statusLabel = 'Nije naručeno'; statusColor = '#f59e0b'; statusBg = '#fffbeb'; }
                                                                            return (
                                                                                <tr key={i} className="mat-summary-row">
                                                                                    <td className="mat-summary-td mat-summary-name">{mat.name}</td>
                                                                                    <td className="mat-summary-td mat-summary-num">{mat.totalQty} {mat.unit}</td>
                                                                                    <td className="mat-summary-td mat-summary-num" style={{ color: mat.onStockQty > 0 ? '#10b981' : '#aeaeb2' }}>{mat.onStockQty} {mat.unit}</td>
                                                                                    <td className="mat-summary-td mat-summary-num" style={{ color: mat.orderedQty > 0 ? '#3b82f6' : '#aeaeb2' }}>{mat.orderedQty} {mat.unit}</td>
                                                                                    <td className="mat-summary-td mat-summary-num" style={{ color: mat.receivedQty > 0 ? '#10b981' : '#aeaeb2' }}>{mat.receivedQty} {mat.unit}</td>
                                                                                    <td className="mat-summary-td mat-summary-num" style={{ color: remaining > 0 ? '#ef4444' : '#10b981' }}>{remaining > 0 ? remaining : '✓'} {remaining > 0 ? mat.unit : ''}</td>
                                                                                    <td className="mat-summary-td" style={{ textAlign: 'right' }}>
                                                                                        <span className="mat-summary-status" style={{ background: statusBg, color: statusColor }}>{statusLabel}</span>
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
                                            </>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    ))
                )}
            </div >

            {/* Project Materials Overview Modal */}
            {
                materialsOverviewProject && (
                    <ProjectMaterialsModal
                        isOpen={!!materialsOverviewProject}
                        onClose={() => setMaterialsOverviewProject(null)}
                        project={materialsOverviewProject}
                    />
                )
            }

            {/* Završni račun */}
            {
                invoiceModalProject && organizationId && (() => {
                    const acceptedOffer = offers.find(o => o.Project_ID === invoiceModalProject.Project_ID && o.Status === 'Prihvaćeno');
                    if (!acceptedOffer) return null;
                    return (
                        <InvoiceModal
                            project={invoiceModalProject}
                            offer={acceptedOffer}
                            organizationId={organizationId}
                            workOrders={workOrders}
                            onClose={() => setInvoiceModalProject(null)}
                            showToast={showToast}
                            onRefresh={onRefresh}
                        />
                    );
                })()
            }

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
                    <label>Tip klijenta</label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                            type="button"
                            className={`glass-btn ${(editingProject?.Client_Type || 'fizicko') === 'fizicko' ? 'glass-btn-primary' : ''}`}
                            onClick={() => setEditingProject({ ...editingProject, Client_Type: 'fizicko' })}
                            style={{ flex: 1, fontSize: '13px', padding: '8px 12px' }}
                        >
                            <span className="material-icons-round" style={{ fontSize: '16px', marginRight: '6px' }}>person</span>
                            Fizičko lice
                        </button>
                        <button
                            type="button"
                            className={`glass-btn ${editingProject?.Client_Type === 'pravno' ? 'glass-btn-primary' : ''}`}
                            onClick={() => setEditingProject({ ...editingProject, Client_Type: 'pravno' })}
                            style={{ flex: 1, fontSize: '13px', padding: '8px 12px' }}
                        >
                            <span className="material-icons-round" style={{ fontSize: '16px', marginRight: '6px' }}>business</span>
                            Pravno lice
                        </button>
                    </div>
                </div>
                {editingProject?.Client_Type === 'pravno' && (
                    <div className="form-row">
                        <div className="form-group">
                            <label>ID broj (JIB)</label>
                            <input
                                type="text"
                                value={editingProject?.Client_ID_Number || ''}
                                onChange={(e) => setEditingProject({ ...editingProject, Client_ID_Number: e.target.value })}
                                placeholder="4200000000000"
                            />
                        </div>
                        <div className="form-group">
                            <label>PDV broj</label>
                            <input
                                type="text"
                                value={editingProject?.Client_PDV_Number || ''}
                                onChange={(e) => setEditingProject({ ...editingProject, Client_PDV_Number: e.target.value })}
                                placeholder="200000000000"
                            />
                        </div>
                    </div>
                )}
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

            {/* Add Material Modal — Multi-select */}
            <MaterialSelectModal
                isOpen={materialModal}
                onClose={() => setMaterialModal(false)}
                materials={materials}
                productId={addingMaterial?.productId || ''}
                organizationId={organizationId || ''}
                onAddMaterials={handleAddMaterials}
                onGlassRedirect={handleGlassRedirect}
                onAluDoorRedirect={handleAluDoorRedirect}
                onRefresh={onRefresh}
                showToast={showToast}
            />

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
                workOrderItem={timelineProduct?.workOrderItem}
                workLogs={workLogs.filter(wl => wl.Work_Order_Item_ID === timelineProduct?.workOrderItem?.ID)}
                sellingPrice={timelineProduct?.sellingPrice}
                materialCost={timelineProduct?.materialCost}
                laborCost={timelineProduct?.laborCost}
                profit={timelineProduct?.profit}
                profitMargin={timelineProduct?.profitMargin}
                workOrderItemId={timelineProduct?.workOrderItemId}
                originalSellingPrice={timelineProduct?.originalSellingPrice}
                originalExtras={timelineProduct?.originalExtras}
                originalTransport={timelineProduct?.originalTransport}
                hasOverrides={timelineProduct?.hasOverrides}
                onSaveOverrides={async (overrides) => {
                    if (!timelineProduct?.workOrderItemId || !organizationId) return;
                    const result = await saveProfitOverrides(
                        timelineProduct.workOrderItemId,
                        overrides,
                        organizationId
                    );
                    if (result.success) {
                        showToast('Prilagodbe profita sačuvane', 'success');
                        onRefresh('workOrders');
                        setTimelineProduct(null);
                    } else {
                        showToast(result.message || 'Greška pri spremanju', 'error');
                    }
                }}
                workers={allWorkers}
                onOverrideWorkLogs={async (entries) => {
                    const woItem = timelineProduct?.workOrderItem;
                    if (!woItem?.Work_Order_ID || !woItem?.ID || !organizationId) {
                        return { success: false, message: 'Nedostaju podaci' };
                    }
                    const result = await overrideWorkLogs(woItem.Work_Order_ID, woItem.ID, entries, organizationId, timelineProduct?.product.Product_ID);
                    if (result.success) {
                        showToast('Timeline ažuriran', 'success');
                        onRefresh('workOrders', 'workLogs');
                        setTimelineProduct(null);
                    } else {
                        showToast(result.message, 'error');
                    }
                    return result;
                }}
            />

            {/* Plan procesa proizvoda (faze; paralelno unutar faze) — zasebni modal preko dugmeta na kartici */}
            {processPlanProduct && (
                <ProductProcessPlan
                    product={processPlanProduct}
                    organizationId={organizationId || ''}
                    onChanged={() => onRefresh('projects')}
                    onClose={() => setProcessPlanProductId(null)}
                    showToast={showToast}
                />
            )}

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

            {/* SketchUp Import Modal */}
            <SketchUpImportModal
                isOpen={!!sketchUpImportProductId}
                onClose={() => setSketchUpImportProductId(null)}
                productId={sketchUpImportProductId || ''}
                organizationId={organizationId || ''}
                materials={materials}
                onImportComplete={() => onRefresh('projects')}
                showToast={showToast}
            />
        </div >
    );
}
