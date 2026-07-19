'use client';

import { useState, useMemo, useEffect } from 'react';
import type { Order, Supplier, Project, ProductMaterial, Material } from '@/lib/types';
import { createOrder, saveOrder, deleteOrder, updateOrderStatus, markOrderSent, markMaterialsReceived, getOrder, deleteOrderItemsByIds, updateOrderItem, recalculateOrderTotal } from '@/lib/services';
import { useData } from '@/context/DataContext';
import { buildOrderPrintDocument } from '@/lib/print/orderDocument';
import { exportHTMLToPDFBlob, exportHTMLToPDFFile, toSafeFileName } from '@/lib/pdfExport';
import { useGoogleIntegration } from '@/lib/google/useGoogleIntegration';
import { fileToSubfolder } from '@/lib/google/projectDrive';
import { DropdownMenu } from '@/components/ui/DropdownMenu';
import { SlidersHorizontal, Plus } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { OrderWizardModal } from './OrderWizardModal';
import { ORDER_STATUSES, MATERIAL_STATUSES, ALLOWED_ORDER_TRANSITIONS } from '@/lib/types';
import { formatCurrency, formatDate, getStatusClass, plural } from '@/lib/utils';
import { daysUntil } from '@/lib/planning';
import { useIsMobile } from '@/hooks/useIsMobile';
import MobileOrdersView from './mobile/MobileOrdersView';
import './OrdersTab.css';

interface OrdersTabProps {
    orders: Order[];
    suppliers: Supplier[];
    projects: Project[];
    productMaterials: ProductMaterial[];
    /** Katalog materijala — služi za kategoriju (ProductMaterial je nema, nosi samo Material_ID). */
    materials: Material[];
    onRefresh: (...collections: string[]) => void;
    /** Optimistični lokalni patch narudžbe (badge reaguje odmah; usklađivanje ide kroz onRefresh). */
    onPatchOrder?: (orderId: string, partial: Partial<Order>) => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
    pendingOrderMaterials?: { materialIds: string[], supplierName: string } | null;
    onClearPendingOrder?: () => void;
}

type GroupBy = 'none' | 'supplier' | 'status' | 'date' | 'project';
type SortBy = 'date-desc' | 'date-asc' | 'amount-desc' | 'amount-asc' | 'supplier';
/** Korak 3 wizarda: grupisanje materijala po dobavljaču ili po kategoriji. */
export type BrowseMode = 'supplier' | 'category';

/** Bucket za materijale bez kategorije (ili bez zapisa u katalogu). */
const NO_CATEGORY = 'Bez kategorije';

export default function OrdersTab({ orders, suppliers, projects, productMaterials, materials, onRefresh, onPatchOrder, showToast, pendingOrderMaterials, onClearPendingOrder }: OrdersTabProps) {
    const { organizationId } = useData();
    const gi = useGoogleIntegration();
    const isMobile = useIsMobile();
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [groupBy, setGroupBy] = useState<GroupBy>('supplier');
    const [sortBy, setSortBy] = useState<SortBy>('date-desc');
    const [isFiltersOpen, setIsFiltersOpen] = useState(false);
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
    const [supplierFilter, setSupplierFilter] = useState('');
    const [projectFilter, setProjectFilter] = useState('');
    const [dateFromFilter, setDateFromFilter] = useState('');
    const [dateToFilter, setDateToFilter] = useState('');
    const [showReceived, setShowReceived] = useState(false);

    // Create Order Wizard
    const [wizardModal, setWizardModal] = useState(false);
    const [wizardStep, setWizardStep] = useState(1);
    const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(new Set());
    const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
    const [selectedSupplierIds, setSelectedSupplierIds] = useState<Set<string>>(new Set());
    const [selectedMaterialIds, setSelectedMaterialIds] = useState<Set<string>>(new Set());
    const [orderName, setOrderName] = useState('');
    // Korak 3 ima dva načina izbora: po dobavljaču ili po kategoriji materijala
    // (dobavljač nije uvijek definisan na materijalu, pa je kategorija drugi ulaz).
    const [browseMode, setBrowseMode] = useState<BrowseMode>('supplier');
    const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());

    // Custom quantity state for materials
    const [orderQuantities, setOrderQuantities] = useState<Record<string, number>>({});
    const [onStockQuantities, setOnStockQuantities] = useState<Record<string, number>>({});

    // Expanded Order State
    const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
    const [editMode, setEditMode] = useState(false);
    const [editedQuantities, setEditedQuantities] = useState<Record<string, number>>({});
    const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());

    // Submitting state (A8: double-click protection)
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Delete Order Dialog State
    const [deleteOrderModal, setDeleteOrderModal] = useState(false);
    const [deleteOrderId, setDeleteOrderId] = useState<string | null>(null);
    const [deleteOrderStatus, setDeleteOrderStatus] = useState('');
    const [deleteMaterialAction, setDeleteMaterialAction] = useState<'received' | 'reset'>('reset');

    // Editing order state
    const [editingOrderId, setEditingOrderId] = useState<string | null>(null);

    // Quick inline rename (independent from the full edit wizard)
    const [renamingOrderId, setRenamingOrderId] = useState<string | null>(null);
    const [orderNameDraft, setOrderNameDraft] = useState('');

    async function saveOrderName(order: Order) {
        const name = orderNameDraft.trim();
        setRenamingOrderId(null);
        if (name === (order.Name || '')) return;
        const result = await saveOrder({ Order_ID: order.Order_ID, Name: name }, organizationId!);
        if (result.success) {
            onRefresh('orders');
        } else {
            showToast(result.message, 'error');
        }
    }

    // Order type modal (combined vs separate when multiple suppliers)
    const [orderTypeModal, setOrderTypeModal] = useState(false);

    // Current order derived from expanded ID
    const currentOrder = useMemo(() =>
        orders.find(o => o.Order_ID === expandedOrderId) || null
        , [orders, expandedOrderId]);

    // Company Info (centralized in DataContext)
    const { companyInfo } = useData();


    // Derive flat productMaterials from projects' nested structure
    // (appState.productMaterials is always [] because getProjects() nests them inside projects)
    const allProductMaterials = useMemo(() => {
        const materials: ProductMaterial[] = [];
        for (const project of projects) {
            for (const product of (project.products || [])) {
                for (const material of (product.materials || [])) {
                    materials.push(material);
                }
            }
        }
        return materials;
    }, [projects]);

    // Handle pending order materials from Overview tab
    useEffect(() => {
        if (pendingOrderMaterials && pendingOrderMaterials.materialIds.length > 0) {
            // Find the supplier by name
            const supplier = suppliers.find(s => s.Name === pendingOrderMaterials.supplierName);
            if (supplier) {
                // Set up wizard with pre-selected data
                setSelectedSupplierIds(new Set([supplier.Supplier_ID]));

                // Find projects and products for these materials
                const materialIdsSet = new Set(pendingOrderMaterials.materialIds);
                const relevantMaterials = allProductMaterials.filter(m => materialIdsSet.has(m.ID));

                // Get unique project IDs from materials
                const projectIds = new Set<string>();
                const productIds = new Set<string>();

                relevantMaterials.forEach(m => {
                    productIds.add(m.Product_ID);
                    // Find project for this product
                    projects.forEach(p => {
                        if (p.products?.some(prod => prod.Product_ID === m.Product_ID)) {
                            projectIds.add(p.Project_ID);
                        }
                    });
                });

                setSelectedProjectIds(projectIds);
                setSelectedProductIds(productIds);
                setSelectedMaterialIds(materialIdsSet);
                setOrderName('');

                // Open wizard at step 4 (material selection)
                setWizardStep(4);
                setWizardModal(true);
            }

            // Clear pending order
            if (onClearPendingOrder) {
                onClearPendingOrder();
            }
        }
    }, [pendingOrderMaterials, suppliers, allProductMaterials, projects, onClearPendingOrder]);

    // Grouping options
    const groupingOptions = [
        { value: 'supplier', label: 'Dobavljaču' },
        { value: 'status', label: 'Statusu' },
        { value: 'project', label: 'Projektu' },
        { value: 'date', label: 'Datumu' },
        { value: 'none', label: 'Bez grupiranja' },
    ];

    // Status options for pills
    const statusOptions = [
        { value: '', label: 'Sve' },
        ...ORDER_STATUSES
            .map(s => ({ value: s, label: s }))
    ];

    // Get unique suppliers from orders
    const orderSuppliers = useMemo(() => {
        const supplierNames = new Set<string>();
        orders.forEach(o => {
            if (o.Supplier_Name) supplierNames.add(o.Supplier_Name);
        });
        return Array.from(supplierNames).sort();
    }, [orders]);

    // Get projects that have orders
    const orderProjects = useMemo(() => {
        const projectIds = new Set<string>();
        orders.forEach(order => {
            order.items?.forEach(item => {
                if (item.Project_ID) projectIds.add(item.Project_ID);
            });
        });
        return projects.filter(p => projectIds.has(p.Project_ID));
    }, [orders, projects]);

    // Count received orders for badge
    const receivedOrderCount = useMemo(() => {
        return orders.filter(o => o.Status === 'Primljeno').length;
    }, [orders]);

    // Enhanced filtering
    const filteredOrders = useMemo(() => {
        return orders.filter(order => {
            // Hide received orders unless toggled on (or status filter explicitly selects them)
            if (!showReceived && !statusFilter && order.Status === 'Primljeno') return false;

            // Search filter
            const matchesSearch = !searchTerm.trim() ||
                order.Order_Number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                order.Supplier_Name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                order.Name?.toLowerCase().includes(searchTerm.toLowerCase());

            // Status filter
            const matchesStatus = !statusFilter || order.Status === statusFilter;

            // Supplier filter
            const matchesSupplier = !supplierFilter || order.Supplier_Name === supplierFilter;

            // Project filter
            const matchesProject = !projectFilter || order.items?.some(item => item.Project_ID === projectFilter);

            // Date range filter
            let matchesDateFrom = true;
            let matchesDateTo = true;
            if (dateFromFilter) {
                const orderDate = new Date(order.Order_Date);
                const fromDate = new Date(dateFromFilter);
                matchesDateFrom = orderDate >= fromDate;
            }
            if (dateToFilter) {
                const orderDate = new Date(order.Order_Date);
                const toDate = new Date(dateToFilter);
                toDate.setHours(23, 59, 59); // End of day
                matchesDateTo = orderDate <= toDate;
            }

            return matchesSearch && matchesStatus && matchesSupplier && matchesProject && matchesDateFrom && matchesDateTo;
        });
    }, [orders, searchTerm, statusFilter, supplierFilter, projectFilter, dateFromFilter, dateToFilter, showReceived]);

    // Sorting
    const sortedOrders = useMemo(() => {
        const sorted = [...filteredOrders];
        switch (sortBy) {
            case 'date-desc':
                sorted.sort((a, b) => new Date(b.Order_Date).getTime() - new Date(a.Order_Date).getTime());
                break;
            case 'date-asc':
                sorted.sort((a, b) => new Date(a.Order_Date).getTime() - new Date(b.Order_Date).getTime());
                break;
            case 'amount-desc':
                sorted.sort((a, b) => (b.Total_Amount || 0) - (a.Total_Amount || 0));
                break;
            case 'amount-asc':
                sorted.sort((a, b) => (a.Total_Amount || 0) - (b.Total_Amount || 0));
                break;
            case 'supplier':
                sorted.sort((a, b) => (a.Supplier_Name || '').localeCompare(b.Supplier_Name || ''));
                break;
        }
        return sorted;
    }, [filteredOrders, sortBy]);

    // Grouping
    const groupedOrders = useMemo(() => {
        const groups = new Map<string, Order[]>();

        sortedOrders.forEach(order => {
            let groupKey = '';

            switch (groupBy) {
                case 'supplier':
                    groupKey = order.Supplier_Name || 'Nepoznat dobavljač';
                    break;
                case 'status':
                    groupKey = order.Status || 'Nepoznat status';
                    break;
                case 'project':
                    const projectId = order.items?.[0]?.Project_ID;
                    const project = projects.find(p => p.Project_ID === projectId);
                    groupKey = project?.Client_Name || 'Bez projekta';
                    break;
                case 'date':
                    if (order.Order_Date) {
                        const date = new Date(order.Order_Date);
                        const month = date.toLocaleDateString('hr-HR', { month: 'long', year: 'numeric' });
                        groupKey = month.charAt(0).toUpperCase() + month.slice(1);
                    } else {
                        groupKey = 'Bez datuma';
                    }
                    break;
                default:
                    groupKey = 'Sve narudžbe';
            }

            if (!groups.has(groupKey)) {
                groups.set(groupKey, []);
            }
            groups.get(groupKey)!.push(order);
        });

        return Array.from(groups.entries()).map(([key, items]) => ({
            groupKey: key,
            groupLabel: key,
            items,
            count: items.length,
            totalAmount: items.reduce((sum, o) => sum + (o.Total_Amount || 0), 0),
        }));
    }, [sortedOrders, groupBy, projects]);

    // Toggle group collapse
    function toggleGroup(groupKey: string) {
        setCollapsedGroups(prev => {
            const next = new Set(prev);
            if (next.has(groupKey)) {
                next.delete(groupKey);
            } else {
                next.add(groupKey);
            }
            return next;
        });
    }

    // Clear all filters
    function clearFilters() {
        setSearchTerm('');
        setStatusFilter('');
        setSupplierFilter('');
        setProjectFilter('');
        setDateFromFilter('');
        setDateToFilter('');
    }

    // Check if any filters are active
    const hasActiveFilters = searchTerm || statusFilter || supplierFilter || projectFilter || dateFromFilter || dateToFilter;
    // Broj aktivnih filtera za bedž na dugmetu "Filteri" (pretraga se ne broji — ima svoje polje)
    const activeFilterCount = [statusFilter, supplierFilter, projectFilter, dateFromFilter, dateToFilter].filter(Boolean).length;

    // Get unordered materials (status = "Nije naručeno" or empty)
    const unorderedMaterials = useMemo(() => {
        return allProductMaterials.filter(m => m.Status === MATERIAL_STATUSES[0] || !m.Status);
    }, [allProductMaterials]);

    // Get products from selected projects
    const availableProducts = useMemo(() => {
        if (selectedProjectIds.size === 0) return [];
        const products: any[] = [];
        projects.forEach(project => {
            if (selectedProjectIds.has(project.Project_ID)) {
                (project.products || []).forEach(product => {
                    // Check if product has unordered materials
                    const hasMaterials = unorderedMaterials.some(m => m.Product_ID === product.Product_ID);
                    if (hasMaterials) {
                        products.push({
                            ...product,
                            Project_Name: project.Client_Name,
                        });
                    }
                });
            }
        });
        return products;
    }, [selectedProjectIds, projects, unorderedMaterials]);

    // Kategorija materijala: ProductMaterial je NEMA, pa se dohvaća iz kataloga po Material_ID.
    const categoryByMaterialId = useMemo(() => {
        const map = new Map<string, string>();
        materials.forEach(m => map.set(m.Material_ID, m.Category || NO_CATEGORY));
        return map;
    }, [materials]);

    const categoryOf = (m: ProductMaterial): string =>
        categoryByMaterialId.get(m.Material_ID) || NO_CATEGORY;

    // Get suppliers from selected products' materials
    const availableSuppliers = useMemo(() => {
        if (selectedProductIds.size === 0) return [];
        const supplierNames = new Set<string>();
        let hasNoSupplier = false;
        unorderedMaterials.forEach(m => {
            if (selectedProductIds.has(m.Product_ID)) {
                if (m.Supplier) {
                    supplierNames.add(m.Supplier);
                } else {
                    hasNoSupplier = true;
                }
            }
        });
        const result: Supplier[] = suppliers.filter(s => supplierNames.has(s.Name));
        // Dobavljač upisan na materijalu koji NEMA svoj zapis u Dobavljačima (preimenovan,
        // obrisan ili samo utipkan) — ranije je takav materijal tiho ispadao i iz koraka 3
        // i iz koraka 4, pa se nije mogao naručiti. Sada dobije privremenu karticu.
        const definedNames = new Set(suppliers.map(s => s.Name));
        Array.from(supplierNames)
            .filter(name => !definedNames.has(name))
            .sort((a, b) => a.localeCompare(b, 'hr'))
            .forEach(name => {
                result.push({
                    Supplier_ID: `__unregistered__${name}`,
                    Organization_ID: '',
                    Name: name,
                    Contact_Person: 'Nije u šifarniku dobavljača',
                    Phone: '',
                    Email: '',
                    Address: '',
                    Categories: '',
                } as Supplier);
            });
        if (hasNoSupplier) {
            result.push({
                Supplier_ID: '__no_supplier__',
                Organization_ID: '',
                Name: 'Bez dobavljača',
                Contact_Person: '',
                Phone: '',
                Email: '',
                Address: '',
                Categories: '',
            } as Supplier);
        }
        return result;
    }, [selectedProductIds, unorderedMaterials, suppliers]);

    // Kategorije prisutne u materijalima odabranih proizvoda (s brojačem za karticu)
    const availableCategories = useMemo(() => {
        if (selectedProductIds.size === 0) return [];
        const counts = new Map<string, number>();
        unorderedMaterials.forEach(m => {
            if (!selectedProductIds.has(m.Product_ID)) return;
            const cat = categoryOf(m);
            counts.set(cat, (counts.get(cat) || 0) + 1);
        });
        return Array.from(counts.entries())
            .map(([name, count]) => ({ name, count }))
            // Bez kategorije uvijek na kraj, ostalo abecedno
            .sort((a, b) => {
                if (a.name === NO_CATEGORY) return 1;
                if (b.name === NO_CATEGORY) return -1;
                return a.name.localeCompare(b.name, 'hr');
            });
    }, [selectedProductIds, unorderedMaterials, categoryByMaterialId]);

    // Get materials filtered by selected products and suppliers/categories (multi-select)
    const filteredMaterials = useMemo(() => {
        if (selectedProductIds.size === 0) return [];
        if (browseMode === 'supplier' && selectedSupplierIds.size === 0) return [];
        if (browseMode === 'category' && selectedCategories.size === 0) return [];

        // Build set of selected supplier names
        const selectedSupplierNames = new Set<string>();
        let includeNoSupplier = false;
        selectedSupplierIds.forEach(id => {
            if (id === '__no_supplier__') {
                includeNoSupplier = true;
            } else if (id.startsWith('__unregistered__')) {
                selectedSupplierNames.add(id.slice('__unregistered__'.length));
            } else {
                const s = suppliers.find(s => s.Supplier_ID === id);
                if (s) selectedSupplierNames.add(s.Name);
            }
        });

        return unorderedMaterials.filter(m => {
            if (!selectedProductIds.has(m.Product_ID)) return false;
            if (browseMode === 'category') return selectedCategories.has(categoryOf(m));
            if (m.Supplier && selectedSupplierNames.has(m.Supplier)) return true;
            if (!m.Supplier && includeNoSupplier) return true;
            return false;
        }).map(m => {
            const product = availableProducts.find(p => p.Product_ID === m.Product_ID);
            const productQty = product?.Quantity || 1;
            return {
                ...m,
                Quantity: m.Quantity * productQty,
                Total_Price: m.Total_Price * productQty,
                Product_Name: product?.Name || '',
                Project_Name: product?.Project_Name || '',
            };
        });
    }, [selectedProductIds, selectedSupplierIds, selectedCategories, browseMode, categoryByMaterialId, suppliers, unorderedMaterials, availableProducts]);

    // Utility functions imported from lib/utils

    function openWizard() {
        setWizardStep(1);
        setSelectedProjectIds(new Set());
        setSelectedProductIds(new Set());
        setSelectedSupplierIds(new Set());
        setSelectedCategories(new Set());
        setBrowseMode('supplier');
        setSelectedMaterialIds(new Set());
        setOrderQuantities({});
        setOnStockQuantities({});
        setOrderName('');
        setEditingOrderId(null);
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
        // Reset downstream selections
        setSelectedProductIds(new Set());
        setSelectedSupplierIds(new Set());
        setSelectedCategories(new Set());
        setSelectedMaterialIds(new Set());
    }

    function toggleProduct(productId: string) {
        const newSelected = new Set(selectedProductIds);
        if (newSelected.has(productId)) {
            newSelected.delete(productId);
        } else {
            newSelected.add(productId);
        }
        setSelectedProductIds(newSelected);
        // Reset downstream selections
        setSelectedSupplierIds(new Set());
        setSelectedCategories(new Set());
        setSelectedMaterialIds(new Set());
    }

    /** Prebacivanje koraka 3 dobavljač ↔ kategorija — izbor drugog načina se poništava. */
    function changeBrowseMode(mode: BrowseMode) {
        if (mode === browseMode) return;
        setBrowseMode(mode);
        setSelectedSupplierIds(new Set());
        setSelectedCategories(new Set());
        setSelectedMaterialIds(new Set());
    }

    function toggleCategory(category: string) {
        const newSelected = new Set(selectedCategories);
        if (newSelected.has(category)) {
            newSelected.delete(category);
        } else {
            newSelected.add(category);
        }
        setSelectedCategories(newSelected);
        setSelectedMaterialIds(new Set());
    }

    function toggleMaterial(materialId: string) {
        const newSelected = new Set(selectedMaterialIds);
        if (newSelected.has(materialId)) {
            newSelected.delete(materialId);
        } else {
            newSelected.add(materialId);
        }
        setSelectedMaterialIds(newSelected);
    }

    function selectAllMaterials() {
        setSelectedMaterialIds(new Set(filteredMaterials.map(m => m.ID)));
    }

    function toggleSupplier(supplierId: string) {
        const newSelected = new Set(selectedSupplierIds);
        if (newSelected.has(supplierId)) {
            newSelected.delete(supplierId);
        } else {
            newSelected.add(supplierId);
        }
        setSelectedSupplierIds(newSelected);

        // When editing, preserve material selections that still match the new supplier set.
        // Only clear materials whose supplier is no longer selected.
        if (editingOrderId) {
            // Build set of supplier names that are now selected
            const selectedSupplierNames = new Set<string>();
            let includeNoSupplier = false;
            newSelected.forEach(id => {
                if (id === '__no_supplier__') {
                    includeNoSupplier = true;
                } else if (id.startsWith('__unregistered__')) {
                    selectedSupplierNames.add(id.slice('__unregistered__'.length));
                } else {
                    const s = suppliers.find(s => s.Supplier_ID === id);
                    if (s) selectedSupplierNames.add(s.Name);
                }
            });

            // Keep only materials that belong to a still-selected supplier
            const filteredSelection = new Set<string>();
            selectedMaterialIds.forEach(matId => {
                const mat = allProductMaterials.find(m => m.ID === matId);
                if (mat) {
                    if (mat.Supplier && selectedSupplierNames.has(mat.Supplier)) {
                        filteredSelection.add(matId);
                    } else if (!mat.Supplier && includeNoSupplier) {
                        filteredSelection.add(matId);
                    }
                }
            });
            setSelectedMaterialIds(filteredSelection);
        } else {
            setSelectedMaterialIds(new Set());
        }
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
        if (wizardStep === 3 && browseMode === 'supplier' && selectedSupplierIds.size === 0) {
            showToast('Odaberite dobavljača', 'error');
            return;
        }
        if (wizardStep === 3 && browseMode === 'category' && selectedCategories.size === 0) {
            showToast('Odaberite kategoriju', 'error');
            return;
        }
        setWizardStep(wizardStep + 1);
    }

    function prevStep() {
        setWizardStep(wizardStep - 1);
    }

    // Entry point from wizard "Kreiraj" button
    async function handleCreateOrder() {
        if (selectedMaterialIds.size === 0) {
            showToast('Odaberite barem jedan materijal', 'error');
            return;
        }

        if (browseMode === 'supplier' && selectedSupplierIds.size === 0) {
            showToast('Odaberite dobavljača', 'error');
            return;
        }
        if (browseMode === 'category' && selectedCategories.size === 0) {
            showToast('Odaberite kategoriju', 'error');
            return;
        }

        // Multiple suppliers → ask user for combined/separate.
        // Kad se bira po kategoriji, dobavljači nisu izabrani ručno — broj se izvodi iz
        // stvarno odabranih materijala (narudžba i dalje ide dobavljaču, ne kategoriji).
        if (distinctSupplierCount() > 1) {
            setOrderTypeModal(true);
            return;
        }

        // Single supplier → create directly
        await doCreateOrders('separate');
    }

    /** Broj različitih dobavljača koje odabrani materijali stvarno nose. */
    function distinctSupplierCount(): number {
        if (browseMode === 'supplier') return selectedSupplierIds.size;
        const names = new Set<string>();
        selectedMaterialIds.forEach(id => {
            const m = filteredMaterials.find(x => x.ID === id);
            if (m) names.add(m.Supplier || '__no_supplier__');
        });
        return names.size;
    }

    // Actual order creation logic
    async function doCreateOrders(mode: 'combined' | 'separate') {
        setOrderTypeModal(false);

        // A8: Double-click protection
        if (isSubmitting) return;
        setIsSubmitting(true);

        try {
            const rawItems = Array.from(selectedMaterialIds).map(materialId => {
                const material = filteredMaterials.find(m => m.ID === materialId);
                const product = availableProducts.find(p => p.Product_ID === material?.Product_ID);

                // Use custom order quantity if set, otherwise default to needed amount
                // Always round UP to whole numbers — no decimals in orders
                const onStock = onStockQuantities[materialId] ?? (material?.On_Stock || 0);
                const orderQty = Math.ceil(orderQuantities[materialId] ?? Math.max(0, (material?.Quantity || 0) - onStock));
                const unitPrice = material?.Unit_Price || ((material?.Total_Price || 0) / (material?.Quantity || 1));
                const orderPrice = orderQty * unitPrice;

                return {
                    Product_Material_ID: materialId,
                    Product_ID: material?.Product_ID || '',
                    Product_Name: material?.Product_Name || '',
                    Project_ID: product?.Project_ID || '',
                    Material_Name: material?.Material_Name || '',
                    Supplier: material?.Supplier || '',
                    Quantity: orderQty,
                    Total_Needed: material?.Quantity || 0,
                    Unit: material?.Unit || '',
                    Expected_Price: orderPrice,
                };
            });

            // Collect On_Stock values for selected materials
            const onStockData: Record<string, number> = {};
            for (const materialId of Array.from(selectedMaterialIds)) {
                const onStock = onStockQuantities[materialId];
                if (onStock !== undefined && onStock > 0) {
                    onStockData[materialId] = onStock;
                }
            }

            // Optimistic: close wizard and show success immediately
            setWizardModal(false);
            const isEditing = editingOrderId;
            // Snimi PRIJE zatvaranja wizarda — grananje combined/separate ne smije ovisiti
            // o stanju koje se u međuvremenu resetuje.
            const distinctSuppliers = distinctSupplierCount();

            // Helper: group raw items by Material_Name + Unit and create order
            const groupAndCreateOrder = async (
                orderItems: typeof rawItems,
                supplierId: string,
                supplierName: string,
                stockData: Record<string, number>
            ) => {
                const grouped = new Map<string, typeof rawItems[0] & { Product_Material_IDs: string[] }>();
                orderItems.forEach(item => {
                    const key = `${item.Material_Name}||${item.Unit}`;
                    if (grouped.has(key)) {
                        const existing = grouped.get(key)!;
                        existing.Quantity += item.Quantity;
                        existing.Expected_Price += item.Expected_Price;
                        existing.Total_Needed += item.Total_Needed;
                        existing.Product_Material_IDs.push(item.Product_Material_ID);
                    } else {
                        grouped.set(key, { ...item, Product_Material_IDs: [item.Product_Material_ID] });
                    }
                });

                const items = Array.from(grouped.values())
                    .map(item => ({ ...item, Quantity: Math.ceil(item.Quantity) }))
                    .filter(item => item.Quantity > 0);

                if (items.length === 0) return;

                const totalAmount = items.reduce((sum, item) => sum + item.Expected_Price, 0);

                return createOrder({
                    Name: orderName.trim() || undefined,
                    Supplier_ID: supplierId,
                    Supplier_Name: supplierName,
                    Total_Amount: totalAmount,
                    items: items as any,
                    onStockData: stockData,
                }, organizationId!);
            };

            // Background: create orders
            const createAndRefresh = async () => {
                try {
                    if (isEditing) {
                        await deleteOrder(isEditing, organizationId!, 'reset');
                    }

                    if (mode === 'combined' || distinctSuppliers === 1) {
                        // Single order — either 1 supplier or combined multi-supplier
                        const supplierNames: string[] = [];
                        let supplierId = '';
                        if (browseMode === 'category') {
                            // Po kategoriji: dobavljači se izvode iz samih materijala.
                            const names = new Set<string>();
                            rawItems.forEach(i => names.add(i.Supplier || ''));
                            Array.from(names).forEach(name => {
                                supplierNames.push(name || 'Neodređen');
                                if (names.size === 1 && name) {
                                    supplierId = suppliers.find(s => s.Name === name)?.Supplier_ID || '';
                                }
                            });
                        } else {
                            selectedSupplierIds.forEach(id => {
                                if (id === '__no_supplier__') {
                                    supplierNames.push('Neodređen');
                                } else if (id.startsWith('__unregistered__')) {
                                    // Dobavljač postoji samo kao tekst na materijalu (nije u šifarniku)
                                    supplierNames.push(id.slice('__unregistered__'.length));
                                } else {
                                    const s = suppliers.find(s => s.Supplier_ID === id);
                                    if (s) supplierNames.push(s.Name);
                                    if (selectedSupplierIds.size === 1) supplierId = id;
                                }
                            });
                        }

                        const result = await groupAndCreateOrder(
                            rawItems,
                            supplierId,
                            supplierNames.join(', '),
                            onStockData
                        );
                        if (result && !result.success) showToast(result.message, 'error');

                        if (isEditing) {
                            showToast('Narudžba ažurirana', 'success');
                        } else {
                            showToast('Narudžba kreirana', 'success');
                        }
                    } else {
                        // Separate orders per supplier
                        const itemsBySupplier = new Map<string, typeof rawItems>();
                        rawItems.forEach(item => {
                            const supplierKey = item.Supplier || '__no_supplier__';
                            if (!itemsBySupplier.has(supplierKey)) {
                                itemsBySupplier.set(supplierKey, []);
                            }
                            itemsBySupplier.get(supplierKey)!.push(item);
                        });

                        let createdCount = 0;
                        for (const [supplierName, supplierItems] of Array.from(itemsBySupplier)) {
                            const supplier = suppliers.find(s => s.Name === supplierName);
                            const supplierId = supplier?.Supplier_ID || '';
                            const displayName = supplierName === '__no_supplier__' ? 'Neodređen' : supplierName;

                            // Filter onStockData for this supplier's materials
                            const supplierMaterialIds = new Set(supplierItems.map((i: typeof rawItems[0]) => i.Product_Material_ID));
                            const supplierStockData: Record<string, number> = {};
                            Object.entries(onStockData).forEach(([id, qty]) => {
                                if (supplierMaterialIds.has(id)) supplierStockData[id] = qty;
                            });

                            const result = await groupAndCreateOrder(
                                supplierItems,
                                supplierId,
                                displayName,
                                supplierStockData
                            );
                            if (result && result.success) createdCount++;
                            else if (result && !result.success) showToast(result.message, 'error');
                        }

                        showToast(`${createdCount} narudžbi kreirano`, 'success');
                    }
                } catch {
                    showToast('Greška pri spremanju narudžbe', 'error');
                }
                onRefresh('orders', 'projects');
            };
            createAndRefresh();
            setEditingOrderId(null);
        } finally {
            setIsSubmitting(false);
        }
    }

    function toggleOrderExpand(orderId: string) {
        if (expandedOrderId === orderId) {
            setExpandedOrderId(null);
            setEditMode(false);
            setSelectedItemIds(new Set());
        } else {
            setExpandedOrderId(orderId);
            setEditMode(false);
            setSelectedItemIds(new Set());
        }
    }

    async function handleQuickStatusChange(orderId: string, newStatus: string, e: React.SyntheticEvent) {
        e.stopPropagation();
        const result = await updateOrderStatus(orderId, newStatus, organizationId!);
        if (result.success) {
            showToast('Status promijenjen', 'success');
            onRefresh('orders', 'projects');
        } else {
            showToast(result.message, 'error');
        }
    }

    function handleDeleteOrder(orderId: string) {
        const order = orders.find(o => o.Order_ID === orderId);
        const status = order?.Status || '';
        setDeleteOrderId(orderId);
        setDeleteOrderStatus(status);
        // C1: Smart default based on status
        if (status === 'Primljeno') {
            setDeleteMaterialAction('received');
        } else {
            setDeleteMaterialAction('reset');
        }
        setDeleteOrderModal(true);
    }

    // Edit existing order: pre-fill wizard from order data and open at step 2
    function handleEditOrder(order: Order) {
        // Find supplier
        const supplier = suppliers.find(s => s.Supplier_ID === order.Supplier_ID || s.Name === order.Supplier_Name);

        // Collect project/product/material IDs from order items
        const projectIds = new Set<string>();
        const productIds = new Set<string>();
        const materialIds = new Set<string>();
        const quantities: Record<string, number> = {};

        (order.items || []).forEach(item => {
            if (item.Project_ID) projectIds.add(item.Project_ID);
            if (item.Product_ID) productIds.add(item.Product_ID);
            // Expand grouped material references
            const matIds = item.Product_Material_IDs || (item.Product_Material_ID ? [item.Product_Material_ID] : []);
            matIds.forEach(id => {
                materialIds.add(id);
                // Distribute order quantity across member materials
                if (matIds.length > 0) {
                    quantities[id] = item.Quantity / matIds.length;
                }
            });
        });

        // If no project IDs from items, try to find them from products
        if (projectIds.size === 0 && productIds.size > 0) {
            projects.forEach(p => {
                if (p.products?.some(prod => productIds.has(prod.Product_ID))) {
                    projectIds.add(p.Project_ID);
                }
            });
        }

        // Set wizard state
        setSelectedProjectIds(projectIds);
        setSelectedProductIds(productIds);
        setSelectedSupplierIds(supplier ? new Set([supplier.Supplier_ID]) : new Set());
        setSelectedMaterialIds(materialIds);
        setOrderQuantities(quantities);
        setOnStockQuantities({});
        setOrderName(order.Name || '');

        // Store the order being edited so we can delete it on re-creation
        setEditingOrderId(order.Order_ID);

        // Open wizard at step 2 (products) so user can change selections
        setWizardStep(2);
        setWizardModal(true);
    }

    // ── Order status change with confirmation ──
    const [statusDropdownOrderId, setStatusDropdownOrderId] = useState<string | null>(null);

    async function handleOrderStatusChange(orderId: string, newStatus: string, currentStatus: string) {
        // Confirmation for reverting to Nacrt (resets materials)
        if (newStatus === 'Nacrt' && currentStatus === 'Poslano') {
            if (!confirm('Vraćanje na "Nacrt" će resetirati statuse materijala na "Nije naručeno". Nastaviti?')) {
                return;
            }
        }
        // B5: Confirm for manual "Primljeno"
        if (newStatus === 'Primljeno') {
            const order = orders.find(o => o.Order_ID === orderId);
            const unreceivedCount = order?.items?.filter(i => i.Status !== 'Primljeno').length || 0;
            if (!confirm(`Ovo će označiti svih ${unreceivedCount} neprimljenih stavki kao primljene. Nastaviti?`)) {
                return;
            }
        }
        // B8: Validate order has items before sending
        if (newStatus === 'Poslano') {
            const order = orders.find(o => o.Order_ID === orderId);
            if (!order?.items || order.items.length === 0) {
                showToast('Narudžba nema stavki za slanje', 'error');
                return;
            }
        }
        setStatusDropdownOrderId(null);
        // Optimistično: badge se mijenja ODMAH; skupa kaskada + refetch projekata idu u pozadinu.
        onPatchOrder?.(orderId, { Status: newStatus });
        const result = await updateOrderStatus(orderId, newStatus, organizationId!);
        if (result.success) {
            showToast(`Status narudžbe promijenjen u "${newStatus}"`, 'success');
            onRefresh('orders');   // brzo usklađivanje stavki narudžbe
            // Projekti/nalozi (profit) ovise o preračunu cijena — osvježi ih TEK kad kaskada završi.
            const after = result.postCascade ?? Promise.resolve();
            after.finally(() => onRefresh('projects'));
        } else {
            onPatchOrder?.(orderId, { Status: currentStatus });   // rollback badge-a
            showToast(result.message, 'error');
        }
    }

    async function confirmDeleteOrder() {
        if (!deleteOrderId) return;

        const orderId = deleteOrderId;
        const materialAction = deleteMaterialAction;

        // Optimistic: close modal, clear state, show success immediately
        setDeleteOrderModal(false);
        setDeleteOrderId(null);
        if (expandedOrderId === orderId) {
            setExpandedOrderId(null);
            setEditMode(false);
            setSelectedItemIds(new Set());
        }
        showToast('Narudžba obrisana', 'success');

        // Background: delete and refresh
        deleteOrder(orderId, organizationId!, materialAction).then(result => {
            if (!result.success) showToast(result.message, 'error');
            onRefresh('orders', 'projects');
        }).catch(() => {
            showToast('Greška pri brisanju narudžbe', 'error');
            onRefresh('orders', 'projects');
        });
    }

    async function handleSendOrder(orderId: string) {
        // B8: Validate order has items before sending
        const order = orders.find(o => o.Order_ID === orderId);
        if (!order?.items || order.items.length === 0) {
            showToast('Narudžba nema stavki za slanje', 'error');
            return;
        }
        const prevStatus = order.Status;
        onPatchOrder?.(orderId, { Status: 'Poslano' });   // optimistično
        const result = await markOrderSent(orderId, organizationId!);
        if (result.success) {
            showToast('Narudžba poslana', 'success');
            onRefresh('orders');
            (result.postCascade ?? Promise.resolve()).finally(() => onRefresh('projects'));
        } else {
            onPatchOrder?.(orderId, { Status: prevStatus });   // rollback
            showToast(result.message, 'error');
        }
    }

    async function handleReceiveSelectedItems() {
        if (selectedItemIds.size === 0) {
            showToast('Odaberite stavke za primanje', 'error');
            return;
        }
        // E1: Block receiving from Nacrt status
        if (currentOrder?.Status === 'Nacrt') {
            showToast('Narudžba mora biti poslana prije primanja stavki', 'error');
            return;
        }
        const result = await markMaterialsReceived(Array.from(selectedItemIds), organizationId!);
        if (result.success) {
            showToast('Materijali primljeni', 'success');
            setSelectedItemIds(new Set());
            onRefresh('orders');   // status stavki/narudžbe se usklađuje odmah
            (result.postCascade ?? Promise.resolve()).finally(() => onRefresh('projects'));
        } else {
            showToast(result.message, 'error');
        }
    }

    // Toggle individual item selection
    function toggleItemSelection(itemId: string, isChecked: boolean) {
        const newSelected = new Set(selectedItemIds);
        if (isChecked) newSelected.add(itemId);
        else newSelected.delete(itemId);
        setSelectedItemIds(newSelected);
    }

    // Toggle all unreceived items
    function toggleAllItems(isChecked: boolean) {
        if (isChecked) {
            const unreceived = currentOrder?.items?.filter(i => i.Status !== 'Primljeno') || [];
            setSelectedItemIds(new Set(unreceived.map(i => i.ID)));
        } else {
            setSelectedItemIds(new Set());
        }
    }

    // Delete selected items
    async function handleDeleteSelectedItems() {
        if (selectedItemIds.size === 0) {
            showToast('Odaberite stavke za brisanje', 'error');
            return;
        }
        // F4: Block deletion of received items
        const selectedItems = currentOrder?.items?.filter(i => selectedItemIds.has(i.ID)) || [];
        const receivedItems = selectedItems.filter(i => i.Status === 'Primljeno');
        const deletableItems = selectedItems.filter(i => i.Status !== 'Primljeno');
        if (deletableItems.length === 0) {
            showToast('Primljene stavke ne mogu biti obrisane', 'error');
            return;
        }
        const skippedMsg = receivedItems.length > 0 ? ` (${receivedItems.length} primljenih stavki će biti preskočeno)` : '';
        if (!confirm(`Obrisati ${deletableItems.length} stavki iz narudžbe?${skippedMsg}`)) return;

        const result = await deleteOrderItemsByIds(deletableItems.map(i => i.ID), organizationId!);
        if (result.success) {
            await recalculateOrderTotal(currentOrder!.Order_ID, organizationId!);
            showToast('Stavke obrisane', 'success');
            setSelectedItemIds(new Set());
            onRefresh('orders', 'projects');

            // F3: Offer to delete empty order
            const remainingItems = (currentOrder?.items?.length || 0) - deletableItems.length;
            if (remainingItems <= 0) {
                if (confirm('Narudžba više nema stavki. Želite li obrisati i narudžbu?')) {
                    handleDeleteOrder(currentOrder!.Order_ID);
                }
            }
        } else {
            showToast(result.message, 'error');
        }
    }

    // Start edit mode
    // D3: Only allow editing non-received items
    function startEditMode() {
        const quantities: Record<string, number> = {};
        currentOrder?.items?.forEach(item => {
            if (item.Status !== 'Primljeno') {
                quantities[item.ID] = item.Quantity;
            }
        });
        setEditedQuantities(quantities);
        setEditMode(true);
    }

    // Cancel edit mode
    // D4: Confirm if unsaved changes exist
    function cancelEditMode() {
        const hasChanges = currentOrder?.items?.some(item => {
            const edited = editedQuantities[item.ID];
            return edited !== undefined && edited !== item.Quantity;
        });
        if (hasChanges && !confirm('Imate nesačuvane promjene. Napustiti bez čuvanja?')) {
            return;
        }
        setEditMode(false);
        setEditedQuantities({});
    }

    // Save edited quantities
    async function saveEditedQuantities() {
        const itemsToUpdate: { id: string; quantity: number; oldQuantity: number; productMaterialId?: string }[] = [];
        currentOrder?.items?.forEach(item => {
            const newQty = editedQuantities[item.ID];
            if (newQty !== undefined && newQty !== item.Quantity) {
                // D2: Min/Max validation
                if (newQty <= 0 || newQty > 99999) {
                    return; // skip invalid
                }
                itemsToUpdate.push({
                    id: item.ID,
                    quantity: newQty,
                    oldQuantity: item.Quantity,
                    productMaterialId: item.Product_Material_ID
                });
            }
        });

        // D2: Check for any invalid values
        const hasInvalid = Object.entries(editedQuantities).some(([id, qty]) => {
            const item = currentOrder?.items?.find(i => i.ID === id);
            return item && qty !== item.Quantity && (qty <= 0 || qty > 99999);
        });
        if (hasInvalid) {
            showToast('Količine moraju biti između 0.001 i 99999', 'error');
            return;
        }

        if (itemsToUpdate.length === 0) {
            showToast('Nema promjena za spremanje', 'info');
            setEditMode(false);
            return;
        }

        for (const { id, quantity } of itemsToUpdate) {
            await updateOrderItem(id, { Quantity: quantity }, organizationId!);
        }
        await recalculateOrderTotal(currentOrder!.Order_ID, organizationId!);

        // D1: Sync Ordered_Quantity when order is already sent
        if (currentOrder?.Status && currentOrder.Status !== 'Nacrt') {
            const materialUpdates: { materialId: string; status: string; orderId: string; orderedQty: number }[] = [];
            for (const { id, quantity, oldQuantity } of itemsToUpdate) {
                const item = currentOrder.items?.find(i => i.ID === id);
                if (!item) continue;
                // Support grouped materials: use Product_Material_IDs array if available, fallback to single ID
                const matIds = item.Product_Material_IDs || (item.Product_Material_ID ? [item.Product_Material_ID] : []);
                const deltaPerMat = matIds.length > 0 ? (quantity - oldQuantity) / matIds.length : 0;
                for (const matId of matIds) {
                    materialUpdates.push({
                        materialId: matId,
                        status: 'Naručeno',
                        orderId: currentOrder.Order_ID,
                        orderedQty: deltaPerMat,
                    });
                }
            }
            if (materialUpdates.length > 0) {
                const { batchUpdateMaterialStatuses } = await import('@/lib/services');
                await batchUpdateMaterialStatuses(materialUpdates, organizationId!);
            }
        }

        showToast('Količine ažurirane', 'success');
        setEditMode(false);
        setEditedQuantities({});
        onRefresh('orders', 'projects');
    }

    // ============================================
    // ŠTAMPA / PDF
    //
    // Layout živi u lib/print/orderDocument.ts — dijele ga štampa,
    // "Preuzmi PDF" i "Spremi na Drive", pa se ne mogu razići.
    // ============================================

    function buildOrderDocument(order: Order) {
        return buildOrderPrintDocument({
            order,
            supplier: suppliers.find(s => s.Supplier_ID === order.Supplier_ID),
            projects,
            company: companyInfo,
        });
    }

    function printOrderDocument() {
        if (!currentOrder) return;
        const doc = buildOrderDocument(currentOrder);
        const printWindow = window.open('', '_blank');
        if (!printWindow) return;
        printWindow.document.write(doc.html);
        printWindow.document.close();
        printWindow.focus();
        setTimeout(() => printWindow.print(), 250);
    }

    async function downloadOrderPDF(order: Order) {
        try {
            const doc = buildOrderDocument(order);
            await exportHTMLToPDFFile(doc.body, `Narudzba_${toSafeFileName(order.Order_Number)}`, {
                css: doc.css,
                printOverrides: doc.printOverrides,
            });
            showToast('PDF narudžbe preuzet', 'success');
        } catch (error) {
            console.error('Error generating PDF:', error);
            showToast('Greška pri generiranju PDF-a', 'error');
        }
    }

    // GOOGLE DRIVE — spremi PDF narudžbe u podfolder „Narudžbe" svakog vezanog projekta.
    async function handleFileOrderToDrive(order: Order) {
        if (!organizationId) return;
        const projectIds = Array.from(new Set((order.items || []).map(i => i.Project_ID).filter(Boolean)));
        const targets = projectIds
            .map(pid => projects.find(p => p.Project_ID === pid))
            .filter((p): p is Project => !!p && !!p.Drive_Subfolders?.['Narudžbe']);
        if (targets.length === 0) {
            showToast('Nijedan projekat iz narudžbe nema Drive folder. Kreiraj folder projekta prvo.', 'error');
            return;
        }
        try {
            showToast('Šaljem narudžbu na Drive...', 'info');
            const doc = buildOrderDocument(order);
            const blob = await exportHTMLToPDFBlob(doc.body, {
                css: doc.css,
                printOverrides: doc.printOverrides,
            });
            const filename = `Narudzba_${toSafeFileName(order.Order_Number)}.pdf`;
            let firstFiled: { id: string; webViewLink?: string } | null = null;
            for (const project of targets) {
                const subId = project.Drive_Subfolders!['Narudžbe'];
                const filed = await fileToSubfolder(subId, blob, filename);
                if (!firstFiled) firstFiled = filed;
            }
            if (firstFiled) {
                await saveOrder({ Order_ID: order.Order_ID, Drive_File_ID: firstFiled.id, Drive_File_URL: firstFiled.webViewLink }, organizationId);
            }
            showToast(targets.length > 1 ? `Narudžba spremljena u ${targets.length} projekta` : 'Narudžba spremljena na Drive', 'success');
            onRefresh('orders');
        } catch (e: any) {
            showToast('Greška pri slanju na Drive: ' + (e?.message || ''), 'error');
        }
    }


    async function handleReceiveItems(itemIds: string[]) {
        const result = await markMaterialsReceived(itemIds, organizationId!);
        if (result.success) {
            showToast('Materijali primljeni', 'success');
            onRefresh('orders', 'projects');
            // Current order updates automatically via useMemo
        } else {
            showToast(result.message, 'error');
        }
    }

    const selectedTotal = Array.from(selectedMaterialIds).reduce((sum, id) => {
        const mat = filteredMaterials.find(m => m.ID === id);
        return sum + (mat?.Total_Price || 0);
    }, 0);

    // Projects with unordered materials
    const projectsWithMaterials = projects.filter(p =>
        unorderedMaterials.some(m => {
            const product = p.products?.find(prod => prod.Product_ID === m.Product_ID);
            return !!product;
        })
    );

    return (
        <>
            {isMobile ? (
                <MobileOrdersView
                    orders={orders}
                    suppliers={suppliers}
                    projects={projects}
                    onRefresh={onRefresh}
                    onPatchOrder={onPatchOrder}
                    showToast={showToast}
                    onOpenWizard={openWizard}
                    onEditOrder={handleEditOrder}
                    onDeleteOrder={handleDeleteOrder}
                    onDownloadPDF={downloadOrderPDF}
                    onPrintOrder={(order) => {
                        setExpandedOrderId(order.Order_ID);
                        setTimeout(() => printOrderDocument(), 100);
                    }}
                />
            ) : (
                <div className="orders-page">
            {/* Page Header */}
            <div className="app-toolbar" style={{ margin: '0 24px 24px' }}>
                <div className="app-toolbar-title">
                    <h1>Narudžbe</h1>
                    <p>Narudžbe materijala prema dobavljačima</p>
                </div>

                <div className="app-toolbar-spacer" />

                <button
                    className={`app-toolbar-btn ${isFiltersOpen ? 'on' : ''}`}
                    onClick={() => setIsFiltersOpen(!isFiltersOpen)}
                >
                    <SlidersHorizontal size={16} />
                    <span>{isFiltersOpen ? 'Zatvori filtere' : 'Filteri'}</span>
                    {activeFilterCount > 0 && (
                        <span className="app-toolbar-badge">{activeFilterCount}</span>
                    )}
                </button>
                <button className="app-toolbar-btn app-toolbar-btn-primary" onClick={openWizard}>
                    <Plus size={16} strokeWidth={2.4} />
                    Nova Narudžba
                </button>
            </div>

            {/* Collapsible Control Bar */}
            <div className={`control-bar ${isFiltersOpen ? 'open' : ''}`}>
                <div className="control-bar-inner" style={{ padding: '16px 24px' }}>
                    <div className="controls-row">
                        {/* Search */}
                        <div className="glass-search">
                            <span className="material-icons-round">search</span>
                            <input
                                type="text"
                                placeholder="Pretraži po broju ili dobavljaču..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>

                        <div className="divider"></div>

                        {/* Status Pills */}
                        <div className="status-pills">
                            {statusOptions.map(opt => (
                                <button
                                    key={opt.value}
                                    className={`status-pill ${statusFilter === opt.value ? 'active' : ''} ${opt.value ? `status-${opt.value.toLowerCase().replace(/\s+/g, '-')}` : ''}`}
                                    onClick={() => setStatusFilter(opt.value)}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>

                        <div className="divider"></div>

                        {/* Grouping */}
                        <div className="group-control">
                            <span className="group-label">Grupiši:</span>
                            <div className="group-dropdown">
                                <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
                                    {groupingOptions.map(opt => (
                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                    ))}
                                </select>
                                <span className="material-icons-round">expand_more</span>
                            </div>
                        </div>
                    </div>

                    {/* Secondary filter row */}
                    <div className="controls-row secondary">
                        {/* Supplier Filter */}
                        <div className="filter-group">
                            <label>Dobavljač:</label>
                            <select value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)}>
                                <option value="">Svi dobavljači</option>
                                {orderSuppliers.map(s => (
                                    <option key={s} value={s}>{s}</option>
                                ))}
                            </select>
                        </div>

                        {/* Project Filter */}
                        <div className="filter-group">
                            <label>Projekt:</label>
                            <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
                                <option value="">Svi projekti</option>
                                {orderProjects.map(p => (
                                    <option key={p.Project_ID} value={p.Project_ID}>{p.Client_Name}</option>
                                ))}
                            </select>
                        </div>

                        {/* Date Range */}
                        <div className="filter-group">
                            <label>Od:</label>
                            <input
                                type="date"
                                value={dateFromFilter}
                                onChange={(e) => setDateFromFilter(e.target.value)}
                            />
                        </div>
                        <div className="filter-group">
                            <label>Do:</label>
                            <input
                                type="date"
                                value={dateToFilter}
                                onChange={(e) => setDateToFilter(e.target.value)}
                            />
                        </div>

                        {/* Clear filters */}
                        {hasActiveFilters && (
                            <button className="btn btn-text" onClick={clearFilters}>
                                <span className="material-icons-round">close</span>
                                Očisti filtere
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Grouped Content */}
            <div className="orders-content">
                {groupedOrders.length === 0 && receivedOrderCount === 0 ? (
                    <div className="empty-state">
                        <span className="material-icons-round">local_shipping</span>
                        <h3>Nema narudžbi</h3>
                        <p>{hasActiveFilters ? 'Pokušajte promijeniti filtere' : 'Kreirajte prvu narudžbu klikom na "Nova Narudžba"'}</p>
                    </div>
                ) : (
                    (expandedOrderId
                        ? groupedOrders.filter(g => g.items.some(o => o.Order_ID === expandedOrderId))
                        : groupedOrders
                    ).map(group => (
                        <div key={group.groupKey} className="group-card">
                            {/* Group Header */}
                            <div
                                className="group-card-header"
                                onClick={() => toggleGroup(group.groupKey)}
                            >
                                <div className="group-left">
                                    <span className="material-icons-round toggle-chevron">
                                        {collapsedGroups.has(group.groupKey) ? 'chevron_right' : 'expand_more'}
                                    </span>
                                    <span className="group-title">{group.groupLabel}</span>
                                    <span className="group-count-badge">{group.count} {plural(group.count, 'narudžba', 'narudžbe', 'narudžbi')}</span>
                                </div>
                                <div className="group-right">
                                    <span className="group-total">{formatCurrency(group.totalAmount)}</span>
                                </div>
                            </div>

                            {/* Group Items */}
                            {!collapsedGroups.has(group.groupKey) && (
                                <div className="group-card-content">
                                    {(expandedOrderId
                                        ? group.items.filter(o => o.Order_ID === expandedOrderId)
                                        : group.items
                                    ).map(order => {
                                        const isExpanded = expandedOrderId === order.Order_ID;
                                        const itemCount = order.items?.length || 0;
                                        const receivedCount = order.items?.filter(i => i.Status === 'Primljeno').length || 0;
                                        const allReceived = itemCount > 0 && receivedCount === itemCount;
                                        const unreceivedItems = order.items?.filter(i => i.Status !== 'Primljeno') || [];

                                        const firstItem = order.items?.[0];
                                        const projectName = firstItem?.Project_ID
                                            ? projects.find(p => p.Project_ID === firstItem.Project_ID)?.Client_Name || 'N/A'
                                            : 'N/A';

                                        // Rok isporuke je probijen a materijal još nije stigao — jedini
                                        // crveni signal u redu, da se ne izgubi među ostalim podacima.
                                        const daysToDelivery = daysUntil(order.Expected_Delivery);
                                        const deliveryLate = !allReceived && daysToDelivery !== null && daysToDelivery < 0;

                                        const handleQuickReceiveAll = async (e: React.MouseEvent) => {
                                            e.stopPropagation();
                                            if (unreceivedItems.length === 0) {
                                                showToast('Sve stavke su već primljene', 'info');
                                                return;
                                            }
                                            // E1: Block receiving from Nacrt status
                                            if (order.Status === 'Nacrt') {
                                                showToast('Narudžba mora biti poslana prije primanja stavki', 'error');
                                                return;
                                            }
                                            // E3: Confirm for Quick Receive All
                                            if (!confirm(`Primiti svih ${unreceivedItems.length} neprimljenih stavki?`)) return;
                                            // Optimistično: sve stavke primljene → narudžba 'Primljeno' (badge odmah).
                                            const prevStatus = order.Status;
                                            const prevItems = order.items;
                                            const nowIso = new Date().toISOString();
                                            onPatchOrder?.(order.Order_ID, {
                                                Status: 'Primljeno',
                                                items: (order.items || []).map(i => i.Status === 'Primljeno' ? i : { ...i, Status: 'Primljeno', Received_Date: nowIso }),
                                            });
                                            const result = await markMaterialsReceived(unreceivedItems.map(i => i.ID), organizationId!);
                                            if (result.success) {
                                                showToast('Sve stavke primljene', 'success');
                                                onRefresh('orders');
                                                (result.postCascade ?? Promise.resolve()).finally(() => onRefresh('projects'));
                                            } else {
                                                onPatchOrder?.(order.Order_ID, { Status: prevStatus, items: prevItems });
                                                showToast(result.message, 'error');
                                            }
                                        };

                                        return (
                                            <div key={order.Order_ID} className={`order-item ${isExpanded ? 'expanded' : ''}`}>
                                                {/* Order Header Row */}
                                                <div className="order-header-custom" onClick={() => toggleOrderExpand(order.Order_ID)}>
                                                    {/* Kolona 1: naziv + broj, ispod dobavljač · projekat · stavke · datum */}
                                                    <div className="order-info-group">
                                                        <div className="order-top-row">
                                                            <button className={`expand-btn ${isExpanded ? 'expanded' : ''}`}>
                                                                <span className="material-icons-round">chevron_right</span>
                                                            </button>
                                                            <span className="order-title-text">{order.Name || 'Narudžba'}</span>
                                                            <span className="order-number-chip">{order.Order_Number}</span>
                                                        </div>
                                                        <div className="order-meta-info">
                                                            {groupBy !== 'supplier' && order.Supplier_Name && (
                                                                <span className="order-supplier-text">{order.Supplier_Name}</span>
                                                            )}
                                                            {groupBy !== 'project' && projectName !== 'N/A' && (
                                                                <span className="order-project-text">{projectName}</span>
                                                            )}
                                                            <span className="order-meta-cell">
                                                                <span className="material-icons-round">inventory_2</span>
                                                                {itemCount} {plural(itemCount, 'stavka', 'stavke', 'stavki')}
                                                            </span>
                                                            <span className="order-meta-cell">
                                                                <span className="material-icons-round">calendar_today</span>
                                                                {formatDate(order.Order_Date)}
                                                            </span>
                                                        </div>
                                                    </div>

                                                    {/* Kolona 2: prijem stavki — prije se vidio tek kad se red otvori */}
                                                    <div className="order-progress-col">
                                                        {itemCount > 0 ? (
                                                            <>
                                                                <div className="order-progress-label">
                                                                    <strong>{receivedCount}/{itemCount}</strong>
                                                                    <span>primljeno</span>
                                                                </div>
                                                                <div className="order-progress-track">
                                                                    <div
                                                                        className={`order-progress-fill ${allReceived ? 'complete' : ''}`}
                                                                        style={{ width: `${Math.round((receivedCount / itemCount) * 100)}%` }}
                                                                    />
                                                                </div>
                                                            </>
                                                        ) : (
                                                            <span className="order-progress-empty">bez stavki</span>
                                                        )}
                                                    </div>

                                                    {/* Kolona 3: iznos + očekivana isporuka */}
                                                    <div className="order-price-col">
                                                        <span className="order-amount-text">{formatCurrency(order.Total_Amount || 0)}</span>
                                                        {order.Expected_Delivery && (
                                                            <span className={`order-delivery-text ${deliveryLate ? 'late' : ''}`}>
                                                                {deliveryLate ? 'kasni od ' : 'isporuka '}{formatDate(order.Expected_Delivery)}
                                                            </span>
                                                        )}
                                                    </div>

                                                    {/* Kolona 3: status */}
                                                    <div className="order-status-col" onClick={e => e.stopPropagation()}>
                                                        {(() => {
                                                            const allowed = ALLOWED_ORDER_TRANSITIONS[order.Status] || [];
                                                            if (allowed.length > 0) {
                                                                return (
                                                                    <div className="status-dropdown-wrapper" style={{ position: 'relative' }}>
                                                                        <span
                                                                            className={`status-badge-custom status-${order.Status.toLowerCase().replace(/\s+/g, '-')} clickable`}
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                setStatusDropdownOrderId(statusDropdownOrderId === order.Order_ID ? null : order.Order_ID);
                                                                            }}
                                                                            title="Klikni za promjenu statusa"
                                                                            style={{ cursor: 'pointer' }}
                                                                        >
                                                                            {order.Status}
                                                                            <span className="material-icons-round" style={{ fontSize: '14px', marginLeft: '4px' }}>expand_more</span>
                                                                        </span>
                                                                        {statusDropdownOrderId === order.Order_ID && (
                                                                            <div className="status-dropdown-menu" onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', top: '100%', right: 0, zIndex: 50, background: 'var(--bg-card)', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.15)', padding: '4px', minWidth: 160, marginTop: 4 }}>
                                                                                {allowed.map(targetStatus => (
                                                                                    <button
                                                                                        key={targetStatus}
                                                                                        className="status-dropdown-item"
                                                                                        onClick={() => handleOrderStatusChange(order.Order_ID, targetStatus, order.Status)}
                                                                                        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', width: '100%', border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 6, fontSize: 13, color: targetStatus === 'Nacrt' ? 'var(--warning)' : 'var(--text-primary)' }}
                                                                                    >
                                                                                        {targetStatus}
                                                                                    </button>
                                                                                ))}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                );
                                                            }
                                                            return (
                                                                <span className={`status-badge-custom status-${order.Status.toLowerCase().replace(/\s+/g, '-')}`}>
                                                                    {order.Status}
                                                                </span>
                                                            );
                                                        })()}
                                                    </div>

                                                    {/* Kolona 4: akcije */}
                                                    <div className="order-actions-col" onClick={e => e.stopPropagation()}>
                                                        {!allReceived && order.Status !== 'Nacrt' && (
                                                            <button
                                                                className="btn-receive-all action-item"
                                                                onClick={handleQuickReceiveAll}
                                                                title="Primi sve"
                                                            >
                                                                <span className="material-icons-round" style={{ fontSize: 18 }}>check_circle</span>
                                                                <span className="btn-text-responsive" style={{ marginLeft: 6 }}>Primi sve</span>
                                                            </button>
                                                        )}

                                                        <DropdownMenu trigger={
                                                            <button className="icon-btn-custom action-item" title="Opcije">
                                                                <span className="material-icons-round">more_vert</span>
                                                            </button>
                                                        }>
                                                            <div className="dropdown-item" onClick={() => handleEditOrder(order)}>
                                                                <span className="material-icons-round" style={{ fontSize: 18 }}>edit</span>
                                                                Uredi
                                                            </div>

                                                            <div className="dropdown-item" onClick={() => downloadOrderPDF(order)}>
                                                                <span className="material-icons-round" style={{ fontSize: 18 }}>picture_as_pdf</span>
                                                                Preuzmi PDF
                                                            </div>

                                                            {gi.moduleActive && (
                                                                <div className="dropdown-item" onClick={() => handleFileOrderToDrive(order)}>
                                                                    <span className="material-icons-round" style={{ fontSize: 18 }}>{order.Drive_File_ID ? 'cloud_done' : 'cloud_upload'}</span>
                                                                    {order.Drive_File_ID ? 'Ponovo na Drive' : 'Spremi na Drive'}
                                                                </div>
                                                            )}

                                                            <div className="dropdown-item" onClick={() => {
                                                                setExpandedOrderId(order.Order_ID);
                                                                setTimeout(() => printOrderDocument(), 100);
                                                            }}>
                                                                <span className="material-icons-round" style={{ fontSize: 18 }}>print</span>
                                                                Printaj
                                                            </div>

                                                            {order.Status.toLowerCase() === 'nacrt' && (
                                                                <div className="dropdown-item" onClick={() => handleSendOrder(order.Order_ID)}>
                                                                    <span className="material-icons-round" style={{ fontSize: 18 }}>send</span>
                                                                    Pošalji
                                                                </div>
                                                            )}

                                                            <div className="dropdown-item danger" onClick={() => handleDeleteOrder(order.Order_ID)}>
                                                                <span className="material-icons-round" style={{ fontSize: 18 }}>delete</span>
                                                                Obriši
                                                            </div>
                                                        </DropdownMenu>
                                                    </div>
                                                </div>

                                                {/* Expanded Content */}
                                                <div className={`project-products ${isExpanded ? 'expanded' : ''}`}>
                                                    <div className="order-name-edit-row" onClick={e => e.stopPropagation()}>
                                                        {renamingOrderId === order.Order_ID ? (
                                                            <div className="order-name-edit-inline">
                                                                <input
                                                                    type="text"
                                                                    value={orderNameDraft}
                                                                    onChange={e => setOrderNameDraft(e.target.value)}
                                                                    onKeyDown={e => {
                                                                        if (e.key === 'Enter') saveOrderName(order);
                                                                        if (e.key === 'Escape') setRenamingOrderId(null);
                                                                    }}
                                                                    placeholder="Naziv narudžbe…"
                                                                    autoFocus
                                                                />
                                                                <button onClick={() => saveOrderName(order)} title="Sačuvaj">
                                                                    <span className="material-icons-round">check</span>
                                                                </button>
                                                                <button onClick={() => setRenamingOrderId(null)} title="Otkaži">
                                                                    <span className="material-icons-round">close</span>
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <button
                                                                className="order-name-edit-trigger"
                                                                onClick={() => { setOrderNameDraft(order.Name || ''); setRenamingOrderId(order.Order_ID); }}
                                                            >
                                                                <span className="material-icons-round">edit</span>
                                                                {order.Name ? 'Promijeni naziv narudžbe' : 'Dodaj naziv narudžbe'}
                                                            </button>
                                                        )}
                                                    </div>
                                                    <div className="products-header">
                                                        <h4>Stavke narudžbe ({itemCount})</h4>
                                                        {selectedItemIds.size > 0 && (
                                                            <button className="btn btn-sm btn-success" onClick={handleReceiveSelectedItems}>
                                                                <span className="material-icons-round">check</span>
                                                                Primi odabrano ({selectedItemIds.size})
                                                            </button>
                                                        )}
                                                    </div>

                                                    {[...(order.items || [])].sort((a, b) => (a.Material_Name || '').localeCompare(b.Material_Name || '', 'hr')).map(item => {
                                                        const isReceived = item.Status === 'Primljeno';
                                                        const isSelected = selectedItemIds.has(item.ID);

                                                        return (
                                                            <div
                                                                key={item.ID}
                                                                className="product-card"
                                                                onClick={() => {
                                                                    if (!isReceived) toggleItemSelection(item.ID, !isSelected);
                                                                }}
                                                                style={{ background: isSelected ? '#eff6ff' : undefined }}
                                                            >
                                                                <div className="product-header">
                                                                    {!isReceived ? (
                                                                        <div onClick={e => e.stopPropagation()}>
                                                                            <input
                                                                                type="checkbox"
                                                                                checked={isSelected}
                                                                                onChange={(e) => toggleItemSelection(item.ID, e.target.checked)}
                                                                                style={{ width: 18, height: 18, cursor: 'pointer' }}
                                                                            />
                                                                        </div>
                                                                    ) : (
                                                                        <span className="material-icons-round" style={{ color: 'var(--success)' }}>check_circle</span>
                                                                    )}

                                                                    <div className="product-info">
                                                                        <div className="product-name">{item.Material_Name}</div>
                                                                        <div className="product-dims">
                                                                            {item.Quantity} {item.Unit}
                                                                            {item.Product_Name && ` • ${item.Product_Name}`}
                                                                        </div>
                                                                    </div>

                                                                    {isReceived && item.Received_Date && (
                                                                        <span className="status-badge status-primljeno">
                                                                            {formatDate(item.Received_Date)}
                                                                        </span>
                                                                    )}

                                                                    <div className="project-actions">
                                                                        <span style={{ fontWeight: 600, color: 'var(--accent)' }}>
                                                                            {formatCurrency(item.Expected_Price)}
                                                                        </span>
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
                            )}
                        </div>
                    ))
                )}

                {/* Toggle for received orders */}
                {receivedOrderCount > 0 && !statusFilter && (
                    <div style={{
                        display: 'flex',
                        justifyContent: 'center',
                        padding: '16px 0',
                    }}>
                        <button
                            className="btn btn-secondary"
                            onClick={() => setShowReceived(!showReceived)}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                padding: '10px 20px',
                                borderRadius: '10px',
                                fontSize: '13px',
                            }}
                        >
                            <span className="material-icons-round" style={{ fontSize: 18 }}>
                                {showReceived ? 'visibility_off' : 'visibility'}
                            </span>
                            {showReceived ? 'Sakrij primljene' : 'Prikaži primljene'}
                            {!showReceived && (
                                <span style={{
                                    background: 'var(--success)',
                                    color: 'white',
                                    borderRadius: '10px',
                                    padding: '1px 8px',
                                    fontSize: '12px',
                                    fontWeight: 600,
                                }}>
                                    {receivedOrderCount}
                                </span>
                            )}
                        </button>
                    </div>
                )}
            </div>
            </div>
            )}

            {/* Order Creation Wizard */}
            <OrderWizardModal
                isOpen={wizardModal}
                onClose={() => setWizardModal(false)}
                wizardStep={wizardStep}
                setWizardStep={setWizardStep}
                projectsWithMaterials={projectsWithMaterials}
                selectedProjectIds={selectedProjectIds}
                toggleProject={toggleProject}
                availableProducts={availableProducts}
                selectedProductIds={selectedProductIds}
                toggleProduct={toggleProduct}
                setSelectedProductIds={setSelectedProductIds}
                availableSuppliers={availableSuppliers}
                selectedSupplierIds={selectedSupplierIds}
                toggleSupplier={toggleSupplier}
                browseMode={browseMode}
                onChangeBrowseMode={changeBrowseMode}
                availableCategories={availableCategories}
                selectedCategories={selectedCategories}
                toggleCategory={toggleCategory}
                setSelectedMaterialIds={setSelectedMaterialIds}
                filteredMaterials={filteredMaterials}
                selectedMaterialIds={selectedMaterialIds}
                toggleMaterial={toggleMaterial}
                selectAllMaterials={selectAllMaterials}
                selectedTotal={selectedTotal}
                formatCurrency={formatCurrency}
                handleCreateOrder={handleCreateOrder}
                isSubmitting={isSubmitting}
                isEditing={!!editingOrderId}
                orderQuantities={orderQuantities}
                onStockQuantities={onStockQuantities}
                setOrderQuantity={(id, qty) => setOrderQuantities(prev => ({ ...prev, [id]: qty }))}
                setOnStockQuantity={(id, qty) => setOnStockQuantities(prev => ({ ...prev, [id]: qty }))}
                orderName={orderName}
                setOrderName={setOrderName}
            />

            {/* Delete Order Confirmation Modal */}
            <Modal
                isOpen={deleteOrderModal}
                onClose={() => { setDeleteOrderModal(false); setDeleteOrderId(null); }}
                title="Brisanje narudžbe"
                footer={
                    <>
                        <button className="btn btn-secondary" onClick={() => { setDeleteOrderModal(false); setDeleteOrderId(null); }}>Otkaži</button>
                        <button className="glass-btn glass-btn-primary" style={{ background: '#ef4444', borderColor: '#ef4444' }} onClick={confirmDeleteOrder}>Obriši narudžbu</button>
                    </>
                }
            >
                {/* Delete options: always show reset/keep choice */}
                <p style={{ marginBottom: '16px', color: 'var(--text-secondary)' }}>
                    Šta želite učiniti s materijalima iz ove narudžbe?
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <label style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '12px',
                        padding: '14px 16px',
                        borderRadius: '10px',
                        border: deleteMaterialAction === 'reset' ? '2px solid #2563eb' : '2px solid #e2e8f0',
                        background: deleteMaterialAction === 'reset' ? '#eff6ff' : 'white',
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                    }}>
                        <input
                            type="radio"
                            name="deleteAction"
                            checked={deleteMaterialAction === 'reset'}
                            onChange={() => setDeleteMaterialAction('reset')}
                            style={{ marginTop: '2px' }}
                        />
                        <div>
                            <div style={{ fontWeight: 600, color: '#1e293b', marginBottom: '2px' }}>Vrati na "Nije naručeno"</div>
                            <div style={{ fontSize: '13px', color: '#64748b' }}>Svi materijali će biti vraćeni na početni status čekanja.</div>
                        </div>
                    </label>
                    <label style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '12px',
                        padding: '14px 16px',
                        borderRadius: '10px',
                        border: deleteMaterialAction === 'received' ? '2px solid #10b981' : '2px solid #e2e8f0',
                        background: deleteMaterialAction === 'received' ? '#ecfdf5' : 'white',
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                    }}>
                        <input
                            type="radio"
                            name="deleteAction"
                            checked={deleteMaterialAction === 'received'}
                            onChange={() => setDeleteMaterialAction('received')}
                            style={{ marginTop: '2px' }}
                        />
                        <div>
                            <div style={{ fontWeight: 600, color: '#1e293b', marginBottom: '2px' }}>Zadrži trenutan status</div>
                            <div style={{ fontSize: '13px', color: '#64748b' }}>Materijali zadržavaju svoj trenutan status (naručeno, primljeno, itd.).</div>
                        </div>
                    </label>
                </div>
            </Modal>

            {/* Order Type Modal (Combined vs Separate) */}
            <Modal
                isOpen={orderTypeModal}
                onClose={() => setOrderTypeModal(false)}
                title="Tip narudžbe"
                footer={null}
            >
                <p style={{ marginBottom: '20px', color: 'var(--text-secondary)', fontSize: '14px' }}>
                    {browseMode === 'category'
                        ? `Odabrani materijali dolaze od ${distinctSupplierCount()} različitih dobavljača. Kako želite kreirati narudžbu?`
                        : `Odabrali ste ${selectedSupplierIds.size} dobavljača. Kako želite kreirati narudžbu?`}
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <button
                        className="glass-btn"
                        style={{
                            display: 'flex', alignItems: 'center', gap: '12px',
                            padding: '16px 20px', textAlign: 'left', width: '100%',
                            border: '2px solid var(--border-color)', borderRadius: '12px',
                            background: 'var(--bg-secondary)', cursor: 'pointer',
                            transition: 'all 0.2s'
                        }}
                        onClick={() => doCreateOrders('combined')}
                    >
                        <span className="material-icons-round" style={{ fontSize: '28px', color: 'var(--primary)' }}>description</span>
                        <div>
                            <div style={{ fontWeight: 600, fontSize: '15px', marginBottom: '2px' }}>Zajednička narudžba</div>
                            <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Svi materijali u jednom dokumentu</div>
                        </div>
                    </button>
                    <button
                        className="glass-btn"
                        style={{
                            display: 'flex', alignItems: 'center', gap: '12px',
                            padding: '16px 20px', textAlign: 'left', width: '100%',
                            border: '2px solid var(--border-color)', borderRadius: '12px',
                            background: 'var(--bg-secondary)', cursor: 'pointer',
                            transition: 'all 0.2s'
                        }}
                        onClick={() => doCreateOrders('separate')}
                    >
                        <span className="material-icons-round" style={{ fontSize: '28px', color: 'var(--accent)' }}>content_copy</span>
                        <div>
                            <div style={{ fontWeight: 600, fontSize: '15px', marginBottom: '2px' }}>Odvojene narudžbe</div>
                            <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Zasebna narudžba za svakog dobavljača ({distinctSupplierCount()} narudžbi)</div>
                        </div>
                    </button>
                </div>
            </Modal>
        </>
    );
}

