'use client';

import { useState, useMemo, useEffect } from 'react';
import type { Order, Supplier, Project, ProductMaterial, OrderItem } from '@/lib/types';
import { createOrder, deleteOrder, updateOrderStatus, markOrderSent, markMaterialsReceived, getOrder, deleteOrderItemsByIds, updateOrderItem, recalculateOrderTotal } from '@/lib/database';
import { useData } from '@/context/DataContext';
import { generateOrderPDF, generatePDFFromHTML, type OrderPDFData } from '@/lib/pdfGenerator';
import { DropdownMenu } from '@/components/ui/DropdownMenu';
import Modal from '@/components/ui/Modal';
import { OrderWizardModal } from './OrderWizardModal';
import { ORDER_STATUSES, MATERIAL_STATUSES, ALLOWED_ORDER_TRANSITIONS } from '@/lib/types';
import { formatCurrency, formatDate, getStatusClass } from '@/lib/utils';
import './OrdersTab.css';

interface OrdersTabProps {
    orders: Order[];
    suppliers: Supplier[];
    projects: Project[];
    productMaterials: ProductMaterial[];
    onRefresh: (...collections: string[]) => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
    pendingOrderMaterials?: { materialIds: string[], supplierName: string } | null;
    onClearPendingOrder?: () => void;
}

type GroupBy = 'none' | 'supplier' | 'status' | 'date' | 'project';
type SortBy = 'date-desc' | 'date-asc' | 'amount-desc' | 'amount-asc' | 'supplier';

export default function OrdersTab({ orders, suppliers, projects, productMaterials, onRefresh, showToast, pendingOrderMaterials, onClearPendingOrder }: OrdersTabProps) {
    const { organizationId } = useData();
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

    // Create Order Wizard
    const [wizardModal, setWizardModal] = useState(false);
    const [wizardStep, setWizardStep] = useState(1);
    const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(new Set());
    const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
    const [selectedSupplierId, setSelectedSupplierId] = useState('');
    const [selectedMaterialIds, setSelectedMaterialIds] = useState<Set<string>>(new Set());

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

    // Current order derived from expanded ID
    const currentOrder = useMemo(() =>
        orders.find(o => o.Order_ID === expandedOrderId) || null
        , [orders, expandedOrderId]);

    // Company Info (centralized in DataContext)
    const { companyInfo } = useData();


    // Handle pending order materials from Overview tab
    useEffect(() => {
        if (pendingOrderMaterials && pendingOrderMaterials.materialIds.length > 0) {
            // Find the supplier by name
            const supplier = suppliers.find(s => s.Name === pendingOrderMaterials.supplierName);
            if (supplier) {
                // Set up wizard with pre-selected data
                setSelectedSupplierId(supplier.Supplier_ID);

                // Find projects and products for these materials
                const materialIdsSet = new Set(pendingOrderMaterials.materialIds);
                const relevantMaterials = productMaterials.filter(m => materialIdsSet.has(m.ID));

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

                // Open wizard at step 4 (material selection)
                setWizardStep(4);
                setWizardModal(true);
            }

            // Clear pending order
            if (onClearPendingOrder) {
                onClearPendingOrder();
            }
        }
    }, [pendingOrderMaterials, suppliers, productMaterials, projects, onClearPendingOrder]);

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
            .filter(s => s !== 'Potvrđeno' && s !== 'Isporučeno')
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

    // Enhanced filtering
    const filteredOrders = useMemo(() => {
        return orders.filter(order => {
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
    }, [orders, searchTerm, statusFilter, supplierFilter, projectFilter, dateFromFilter, dateToFilter]);

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

    // Get unordered materials (status = "Nije naručeno" or empty)
    const unorderedMaterials = useMemo(() => {
        return productMaterials.filter(m => m.Status === MATERIAL_STATUSES[0] || !m.Status);
    }, [productMaterials]);

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

    // Get suppliers from selected products' materials
    const availableSuppliers = useMemo(() => {
        if (selectedProductIds.size === 0) return [];
        const supplierNames = new Set<string>();
        unorderedMaterials.forEach(m => {
            if (selectedProductIds.has(m.Product_ID) && m.Supplier) {
                supplierNames.add(m.Supplier);
            }
        });
        return suppliers.filter(s => supplierNames.has(s.Name));
    }, [selectedProductIds, unorderedMaterials, suppliers]);

    // Get materials filtered by selected products and supplier
    const filteredMaterials = useMemo(() => {
        if (selectedProductIds.size === 0 || !selectedSupplierId) return [];
        const supplier = suppliers.find(s => s.Supplier_ID === selectedSupplierId);
        if (!supplier) return [];

        return unorderedMaterials.filter(m =>
            selectedProductIds.has(m.Product_ID) && m.Supplier === supplier.Name
        ).map(m => {
            const product = availableProducts.find(p => p.Product_ID === m.Product_ID);
            return {
                ...m,
                Product_Name: product?.Name || '',
                Project_Name: product?.Project_Name || '',
            };
        });
    }, [selectedProductIds, selectedSupplierId, suppliers, unorderedMaterials, availableProducts]);

    // Utility functions imported from lib/utils

    function openWizard() {
        setWizardStep(1);
        setSelectedProjectIds(new Set());
        setSelectedProductIds(new Set());
        setSelectedSupplierId('');
        setSelectedMaterialIds(new Set());
        setOrderQuantities({});
        setOnStockQuantities({});
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
        setSelectedSupplierId('');
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
        setSelectedSupplierId('');
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

    function nextStep() {
        if (wizardStep === 1 && selectedProjectIds.size === 0) {
            showToast('Odaberite barem jedan projekat', 'error');
            return;
        }
        if (wizardStep === 2 && selectedProductIds.size === 0) {
            showToast('Odaberite barem jedan proizvod', 'error');
            return;
        }
        if (wizardStep === 3 && !selectedSupplierId) {
            showToast('Odaberite dobavljača', 'error');
            return;
        }
        setWizardStep(wizardStep + 1);
    }

    function prevStep() {
        setWizardStep(wizardStep - 1);
    }

    async function handleCreateOrder() {
        if (selectedMaterialIds.size === 0) {
            showToast('Odaberite barem jedan materijal', 'error');
            return;
        }

        const supplier = suppliers.find(s => s.Supplier_ID === selectedSupplierId);
        // A2: Toast for missing supplier
        if (!supplier) {
            showToast('Odaberite dobavljača', 'error');
            return;
        }

        // A8: Double-click protection
        if (isSubmitting) return;
        setIsSubmitting(true);

        try {
            const rawItems = Array.from(selectedMaterialIds).map(materialId => {
                const material = filteredMaterials.find(m => m.ID === materialId);
                const product = availableProducts.find(p => p.Product_ID === material?.Product_ID);

                // Use custom order quantity if set, otherwise default to needed amount
                const onStock = onStockQuantities[materialId] ?? (material?.On_Stock || 0);
                const orderQty = orderQuantities[materialId] ?? Math.max(0, (material?.Quantity || 0) - onStock);
                const unitPrice = material?.Unit_Price || ((material?.Total_Price || 0) / (material?.Quantity || 1));
                const orderPrice = orderQty * unitPrice;

                return {
                    Product_Material_ID: materialId,
                    Product_ID: material?.Product_ID || '',
                    Product_Name: material?.Product_Name || '',
                    Project_ID: product?.Project_ID || '',
                    Material_Name: material?.Material_Name || '',
                    Quantity: orderQty,
                    Total_Needed: material?.Quantity || 0,
                    Unit: material?.Unit || '',
                    Expected_Price: orderPrice,
                };
            });

            // Group materials by Material_Name + Unit to combine quantities
            const grouped = new Map<string, typeof rawItems[0] & { Product_Material_IDs: string[] }>();
            rawItems.forEach(item => {
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

            // A3: Filter out zero-quantity items
            const items = Array.from(grouped.values()).filter(item => item.Quantity > 0);
            if (items.length === 0) {
                showToast('Sve količine su 0 — nema materijala za naručiti', 'error');
                return;
            }

            const totalAmount = items.reduce((sum, item) => sum + item.Expected_Price, 0);

            // Collect On_Stock values for selected materials
            const onStockData: Record<string, number> = {};
            for (const materialId of Array.from(selectedMaterialIds)) {
                const onStock = onStockQuantities[materialId];
                if (onStock !== undefined && onStock > 0) {
                    onStockData[materialId] = onStock;
                }
            }

            const result = await createOrder({
                Supplier_ID: selectedSupplierId,
                Supplier_Name: supplier.Name,
                Total_Amount: totalAmount,
                items: items as any,
                onStockData,
            }, organizationId!);

            if (result.success) {
                showToast(result.message, 'success');
                setWizardModal(false);
                onRefresh('orders', 'projects');
            } else {
                showToast(result.message, 'error');
            }
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

    // ── Order status change with confirmation ──
    const [statusDropdownOrderId, setStatusDropdownOrderId] = useState<string | null>(null);

    async function handleOrderStatusChange(orderId: string, newStatus: string, currentStatus: string) {
        // Confirmation for reverting to Nacrt (resets materials)
        if (newStatus === 'Nacrt' && (currentStatus === 'Poslano' || currentStatus === 'Potvrđeno')) {
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
        const result = await updateOrderStatus(orderId, newStatus, organizationId!);
        if (result.success) {
            showToast(`Status narudžbe promijenjen u "${newStatus}"`, 'success');
            onRefresh('orders', 'projects');
        } else {
            showToast(result.message, 'error');
        }
    }

    async function confirmDeleteOrder() {
        if (!deleteOrderId) return;

        const result = await deleteOrder(deleteOrderId, organizationId!, deleteMaterialAction);
        if (result.success) {
            showToast(result.message, 'success');
            setDeleteOrderModal(false);
            setDeleteOrderId(null);
            onRefresh('orders', 'projects');
        } else {
            showToast(result.message, 'error');
        }
    }

    async function handleSendOrder(orderId: string) {
        // B8: Validate order has items before sending
        const order = orders.find(o => o.Order_ID === orderId);
        if (!order?.items || order.items.length === 0) {
            showToast('Narudžba nema stavki za slanje', 'error');
            return;
        }
        const result = await markOrderSent(orderId, organizationId!);
        if (result.success) {
            showToast('Narudžba poslana', 'success');
            onRefresh('orders', 'projects');
        } else {
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
            onRefresh('orders', 'projects');
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
                const { batchUpdateMaterialStatuses } = await import('@/lib/database');
                await batchUpdateMaterialStatuses(materialUpdates, organizationId!);
            }
        }

        showToast('Količine ažurirane', 'success');
        setEditMode(false);
        setEditedQuantities({});
        onRefresh('orders', 'projects');
    }

    // Print order document
    function printOrderDocument() {
        if (!currentOrder) return;

        const supplier = suppliers.find(s => s.Supplier_ID === currentOrder.Supplier_ID);

        // Separate items by type
        const regularItems: OrderItem[] = [];
        const glassItems: { item: OrderItem; pieces: any[] }[] = [];
        const aluDoorItems: { item: OrderItem; doors: any[] }[] = [];

        (currentOrder.items || []).forEach(item => {
            let foundGlass = false;
            let foundAluDoor = false;

            for (const project of projects) {
                for (const product of (project.products || [])) {
                    const pm = product.materials?.find(m => m.ID === item.Product_Material_ID);
                    if (pm?.glassItems && pm.glassItems.length > 0) {
                        glassItems.push({ item, pieces: pm.glassItems });
                        foundGlass = true;
                        break;
                    }
                    if (pm?.aluDoorItems && pm.aluDoorItems.length > 0) {
                        aluDoorItems.push({ item, doors: pm.aluDoorItems });
                        foundAluDoor = true;
                        break;
                    }
                }
                if (foundGlass || foundAluDoor) break;
            }

            if (!foundGlass && !foundAluDoor) {
                regularItems.push(item);
            }
        });

        const html = generateOrderHtml(currentOrder, supplier, regularItems, glassItems, aluDoorItems);

        // Print
        const printWindow = window.open('', '_blank');
        if (printWindow) {
            printWindow.document.write(html);
            printWindow.document.close();
            printWindow.focus();
            setTimeout(() => printWindow.print(), 250);
        }
    }

    function generateOrderHtml(order: Order, supplier: Supplier | undefined, regularItems: any[], glassItems: any[], aluDoorItems: any[]) {
        const regularTableHtml = regularItems.length > 0 ? `
            <h3 style="margin: 24px 0 12px; font-size: 14px; font-weight: 600;">Materijali</h3>
            <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                <thead>
                    <tr style="background: #f5f5f7;">
                        <th style="padding: 10px; text-align: left; border-bottom: 1px solid #e5e5e5;">#</th>
                        <th style="padding: 10px; text-align: left; border-bottom: 1px solid #e5e5e5;">Materijal</th>
                        <th style="padding: 10px; text-align: right; border-bottom: 1px solid #e5e5e5;">Količina</th>
                        <th style="padding: 10px; text-align: left; border-bottom: 1px solid #e5e5e5;">Jedinica</th>
                    </tr>
                </thead>
                <tbody>
                    ${regularItems.map((item, idx) => `
                        <tr>
                            <td style="padding: 10px; border-bottom: 1px solid #f0f0f0;">${idx + 1}</td>
                            <td style="padding: 10px; border-bottom: 1px solid #f0f0f0;">${item.Material_Name}</td>
                            <td style="padding: 10px; text-align: right; border-bottom: 1px solid #f0f0f0;">${item.Quantity}</td>
                            <td style="padding: 10px; border-bottom: 1px solid #f0f0f0;">${item.Unit}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        ` : '';

        const glassTableHtml = glassItems.length > 0 ? `
            <h3 style="margin: 24px 0 12px; font-size: 14px; font-weight: 600;">Stakla</h3>
            <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                <thead>
                    <tr style="background: #f5f5f7;">
                        <th style="padding: 10px; text-align: left; border-bottom: 1px solid #e5e5e5;">#</th>
                        <th style="padding: 10px; text-align: left; border-bottom: 1px solid #e5e5e5;">Vrsta stakla</th>
                        <th style="padding: 10px; text-align: right; border-bottom: 1px solid #e5e5e5;">Kom</th>
                        <th style="padding: 10px; text-align: left; border-bottom: 1px solid #e5e5e5;">Dimenzije</th>
                        <th style="padding: 10px; text-align: right; border-bottom: 1px solid #e5e5e5;">m²</th>
                    </tr>
                </thead>
                <tbody>
                    ${glassItems.map((g, idx) => {
            const totalArea = g.pieces.reduce((sum: number, p: any) => {
                const qty = parseInt(p.Qty) || 1;
                const w = parseFloat(p.Width) || 0;
                const h = parseFloat(p.Height) || 0;
                return sum + (w * h / 1000000 * qty);
            }, 0);
            return `
                            <tr style="background: #fafafa;">
                                <td style="padding: 10px; font-weight: 600;">${idx + 1}</td>
                                <td colspan="3" style="padding: 10px; font-weight: 600;">${g.item.Material_Name}</td>
                                <td style="padding: 10px; text-align: right; font-weight: 600;">${totalArea.toFixed(2)}</td>
                            </tr>
                            ${g.pieces.map((p: any, pIdx: number) => {
                const qty = parseInt(p.Qty) || 1;
                const w = parseFloat(p.Width) || 0;
                const h = parseFloat(p.Height) || 0;
                const edge = p.Edge_Processing === true || p.Edge_Processing === 'true';
                return `
                                    <tr>
                                        <td style="padding: 8px 10px 8px 24px; color: #86868b; font-size: 12px;">${idx + 1}.${pIdx + 1}</td>
                                        <td style="padding: 8px 10px;"></td>
                                        <td style="padding: 8px 10px; text-align: right;">${qty}</td>
                                        <td style="padding: 8px 10px;">${w} × ${h} mm${edge ? ' <span style="background:#e8f5e9;padding:2px 6px;border-radius:4px;font-size:11px;">brušeno</span>' : ''}</td>
                                        <td style="padding: 8px 10px;"></td>
                                    </tr>
                                `;
            }).join('')}
                        `;
        }).join('')}
                </tbody>
            </table>
        ` : '';

        const aluDoorHtml = aluDoorItems.length > 0 ? `
            <h3 style="margin: 24px 0 12px; font-size: 14px; font-weight: 600;">Alu Vrata</h3>
            ${aluDoorItems.map((a, idx) => {
            const totalArea = a.doors.reduce((sum: number, d: any) => {
                const qty = parseInt(d.Qty) || 1;
                const w = parseFloat(d.Width) || 0;
                const h = parseFloat(d.Height) || 0;
                return sum + (w * h / 1000000 * qty);
            }, 0);
            return `
                    <div style="margin-bottom: 16px;">
                        <div style="background: #f5f5f7; padding: 10px 14px; border-radius: 8px 8px 0 0; font-weight: 600;">
                            ${idx + 1}. ${a.item.Material_Name} <span style="color: #86868b; font-weight: 400;">(${totalArea.toFixed(2)} m²)</span>
                        </div>
                        ${a.doors.map((d: any, dIdx: number) => {
                const qty = parseInt(d.Qty) || 1;
                const w = parseFloat(d.Width) || 0;
                const h = parseFloat(d.Height) || 0;
                return `
                                <div style="border: 1px solid #e5e5e5; border-top: none; padding: 12px 14px;">
                                    <div style="display: flex; gap: 16px; margin-bottom: 8px; font-size: 13px;">
                                        <span style="color: #86868b;">${idx + 1}.${dIdx + 1}</span>
                                        <strong>${w} × ${h} mm</strong>
                                        <span>${qty} kom</span>
                                    </div>
                                    <div style="font-size: 12px; color: #1d1d1f; line-height: 1.6;">
                                        <div><span style="color: #86868b;">Ram:</span> ${d.Frame_Type || '-'}${d.Frame_Color ? ', ' + d.Frame_Color : ''}</div>
                                        <div><span style="color: #86868b;">Staklo:</span> ${d.Glass_Type || '-'}</div>
                                        <div><span style="color: #86868b;">Baglame:</span> ${d.Hinge_Type || '-'}, ${d.Hinge_Side || 'lijevo'}${d.Hinge_Color ? ', ' + d.Hinge_Color : ''}</div>
                                        ${d.Integrated_Handle ? '<div><span style="color: #86868b;">Ručka:</span> Integrisana</div>' : ''}
                                        ${d.Note ? `<div style="margin-top: 6px; font-style: italic; color: #6e6e73;"><span style="color: #86868b;">Napomena:</span> ${d.Note}</div>` : ''}
                                    </div>
                                </div>
                            `;
            }).join('')}
                    </div>
                `;
        }).join('')}
        ` : '';

        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <title>Narudžba ${order.Order_Number}</title>
                <style>
                    .print-layout * { box-sizing: border-box; margin: 0; padding: 0; }
                    .print-layout { 
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
                        padding: 24px; 
                        color: #1d1d1f; 
                        background: white; 
                        width: 794px;
                        overflow: hidden;
                    }
                    .print-layout .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; padding-bottom: 24px; border-bottom: 1px solid #e5e5e5; }
                    .print-layout .company-info { display: flex; flex-direction: column; gap: 6px; }
                    .print-layout .company-logo { max-width: 180px; max-height: 60px; width: auto; height: auto; object-fit: contain; }
                    .print-layout .company-name { font-size: 20px; font-weight: 700; letter-spacing: -0.3px; color: #1d1d1f; margin: 0; }
                    .print-layout .company-details p { font-size: 11px; color: #86868b; margin: 0 0 2px 0; }
                    .print-layout .order-info { text-align: right; font-size: 14px; }
                    .print-layout .order-number { font-size: 18px; font-weight: 600; }
                    .print-layout .supplier-section { background: #f5f5f7; padding: 16px; border-radius: 12px; margin-bottom: 24px; }
                    .print-layout .supplier-name { font-size: 16px; font-weight: 600; margin-bottom: 4px; }
                    .print-layout .supplier-contact { font-size: 13px; color: #86868b; }
                    .print-layout .notes { margin-top: 24px; padding: 12px 16px; background: #fffaf0; border-radius: 8px; border-left: 3px solid #f5a623; font-size: 13px; }
                    .print-layout .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e5e5; font-size: 12px; color: #86868b; display: flex; justify-content: space-between; }
                    @media print { 
                        .print-layout { padding: 20px; } 
                        body { margin: 0; padding: 0; }
                    }
                </style>
            </head>
            <body>
                <div class="print-layout">
                    <div class="header">
                        <div class="company-info">
                            ${companyInfo.logoBase64 ? `<img class="company-logo" src="${companyInfo.logoBase64}" alt="${companyInfo.name}" />` : ''}
                            ${(!companyInfo.logoBase64 || !companyInfo.hideNameWhenLogo) ? `<h1 class="company-name">${companyInfo.name}</h1>` : ''}
                            <div class="company-details">
                                <p>${companyInfo.address}</p>
                                <p>${[companyInfo.phone, companyInfo.email].filter(Boolean).join(' · ')}</p>
                            </div>
                        </div>
                        <div class="order-info">
                            <div class="order-number">Narudžba: ${order.Order_Number}</div>
                            <div>Datum: ${formatDate(order.Order_Date)}</div>
                        </div>
                    </div>
                    
                    <div class="supplier-section">
                        <div class="supplier-name">${order.Supplier_Name || 'Dobavljač'}</div>
                        <div class="supplier-contact">
                            ${[supplier?.Phone, supplier?.Email, supplier?.Address].filter(Boolean).join(' | ')}
                        </div>
                    </div>

                    ${regularTableHtml}
                    ${glassTableHtml}
                    ${aluDoorHtml}

                    ${order.Notes ? `<div class="notes"><strong>Napomena:</strong> ${order.Notes}</div>` : ''}

                    <div class="footer">
                        <span>Očekivana dostava: ${order.Expected_Delivery ? formatDate(order.Expected_Delivery) : 'Po dogovoru'}</span>
                        <span>Ukupno stavki: ${order.items?.length || 0}</span>
                    </div>
                </div>
            </body>
            </html>
        `;
    }

    // Download order as PDF
    async function downloadOrderPDF(order: Order) {
        try {
            const supplier = suppliers.find(s => s.Supplier_ID === order.Supplier_ID);

            // Re-use logic for grouped items to ensure consistency
            const regularItems: OrderItem[] = [];
            const glassItems: { item: OrderItem; pieces: any[] }[] = [];
            const aluDoorItems: { item: OrderItem; doors: any[] }[] = [];

            (order.items || []).forEach(item => {
                let foundGlass = false;
                let foundAluDoor = false;

                for (const project of projects) {
                    for (const product of (project.products || [])) {
                        const pm = product.materials?.find(m => m.ID === item.Product_Material_ID);
                        if (pm?.glassItems && pm.glassItems.length > 0) {
                            glassItems.push({ item, pieces: pm.glassItems });
                            foundGlass = true;
                            break;
                        }
                        if (pm?.aluDoorItems && pm.aluDoorItems.length > 0) {
                            aluDoorItems.push({ item, doors: pm.aluDoorItems });
                            foundAluDoor = true;
                            break;
                        }
                    }
                    if (foundGlass || foundAluDoor) break;
                }

                if (!foundGlass && !foundAluDoor) {
                    regularItems.push(item);
                }
            });

            // Re-use the EXACT same HTML generator as print
            const html = generateOrderHtml(order, supplier, regularItems, glassItems, aluDoorItems);

            await generatePDFFromHTML(html, `Narudzba_${order.Order_Number}`, {
                width: 794 // A4 width at 96 DPI
            });
            showToast('PDF narudžbe preuzet', 'success');
        } catch (error) {
            console.error('Error generating PDF:', error);
            showToast('Greška pri generiranju PDF-a', 'error');
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
        <div className="orders-page">
            {/* Page Header */}
            <div className="page-header">
                <div className="header-content" style={{ padding: '0 24px' }}>
                    <div className="header-text">
                        <h1>Narudžbe</h1>
                        <p>Upravljajte narudžbama materijala prema dobavljačima.</p>
                    </div>
                    <div className="header-actions">
                        <button
                            className={`filter-toggle ${isFiltersOpen ? 'active' : ''}`}
                            onClick={() => setIsFiltersOpen(!isFiltersOpen)}
                        >
                            <span className="material-icons-round">tune</span>
                            <span>{isFiltersOpen ? 'Zatvori filtere' : 'Filteri'}</span>
                        </button>
                        <button className="glass-btn glass-btn-primary" onClick={openWizard}>
                            <span className="material-icons-round">add</span>
                            Nova Narudžba
                        </button>
                    </div>
                </div>
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
                {groupedOrders.length === 0 ? (
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
                                    <span className="group-count-badge">{group.count} narudžbi</span>
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
                                            const result = await markMaterialsReceived(unreceivedItems.map(i => i.ID), organizationId!);
                                            if (result.success) {
                                                showToast('Sve stavke primljene', 'success');
                                                onRefresh('orders', 'projects');
                                            } else {
                                                showToast(result.message, 'error');
                                            }
                                        };

                                        return (
                                            <div key={order.Order_ID} className={`order-item ${isExpanded ? 'expanded' : ''}`}>
                                                {/* Order Header Row */}
                                                <div className="order-header-custom" onClick={() => toggleOrderExpand(order.Order_ID)} style={{ cursor: 'pointer' }}>
                                                    <button className={`expand-btn ${isExpanded ? 'expanded' : ''}`}>
                                                        <span className="material-icons-round">chevron_right</span>
                                                    </button>

                                                    <div className="order-info-group">
                                                        <div className="order-top-row">
                                                            <span className="order-id-text">{order.Name || `#${order.Order_Number}`}</span>
                                                            {order.Name && <span style={{ fontSize: '11px', color: '#9ca3af', fontWeight: 500 }}>#{order.Order_Number}</span>}
                                                            {groupBy !== 'project' && projectName !== 'N/A' && (
                                                                <>
                                                                    <span className="meta-separator">•</span>
                                                                    <span className="order-project-text">{projectName}</span>
                                                                </>
                                                            )}
                                                            {groupBy !== 'supplier' && (
                                                                <>
                                                                    <span className="meta-separator">•</span>
                                                                    <span className="order-supplier-text">{order.Supplier_Name}</span>
                                                                </>
                                                            )}
                                                        </div>
                                                        <div className="order-meta-info">
                                                            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                                                <span className="material-icons-round" style={{ fontSize: 14 }}>calendar_today</span>
                                                                {formatDate(order.Order_Date)}
                                                            </span>
                                                            <span className="meta-separator">•</span>
                                                            <span style={{ fontWeight: 600 }}>{formatCurrency(order.Total_Amount || 0)}</span>
                                                        </div>
                                                    </div>

                                                    <div className="order-actions-group" onClick={e => e.stopPropagation()}>
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
                                                                                {allowed.filter(s => s !== 'Djelomično').map(targetStatus => (
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
                                                            <div className="dropdown-item" onClick={() => downloadOrderPDF(order)}>
                                                                <span className="material-icons-round" style={{ fontSize: 18 }}>picture_as_pdf</span>
                                                                Preuzmi PDF
                                                            </div>

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
            </div>

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
                selectedSupplierId={selectedSupplierId}
                setSelectedSupplierId={setSelectedSupplierId}
                setSelectedMaterialIds={setSelectedMaterialIds}
                filteredMaterials={filteredMaterials}
                selectedMaterialIds={selectedMaterialIds}
                toggleMaterial={toggleMaterial}
                selectAllMaterials={selectAllMaterials}
                selectedTotal={selectedTotal}
                formatCurrency={formatCurrency}
                handleCreateOrder={handleCreateOrder}
                isSubmitting={isSubmitting}
                orderQuantities={orderQuantities}
                onStockQuantities={onStockQuantities}
                setOrderQuantity={(id, qty) => setOrderQuantities(prev => ({ ...prev, [id]: qty }))}
                setOnStockQuantity={(id, qty) => setOnStockQuantities(prev => ({ ...prev, [id]: qty }))}
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
                {/* C1: Smart delete options based on order status */}
                {deleteOrderStatus === 'Primljeno' ? (
                    <p style={{ marginBottom: '16px', color: 'var(--text-secondary)' }}>
                        Svi materijali iz ove narudžbe su već primljeni. Brisanje narudžbe neće utjecati na status materijala.
                    </p>
                ) : deleteOrderStatus === 'Nacrt' ? (
                    <p style={{ marginBottom: '16px', color: 'var(--text-secondary)' }}>
                        Narudžba još nije poslana. Materijali će biti vraćeni na "Nije naručeno".
                    </p>
                ) : (
                    <>
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
                                    <div style={{ fontSize: '13px', color: '#64748b' }}>Neprimljeni materijali će biti vraćeni u status čekanja. Već primljeni ostaju primljeni.</div>
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
                                    <div style={{ fontWeight: 600, color: '#1e293b', marginBottom: '2px' }}>Označi kao primljene</div>
                                    <div style={{ fontSize: '13px', color: '#64748b' }}>Materijali će biti označeni kao primljeni, npr. ako ste ih nabavili direktno.</div>
                                </div>
                            </label>
                        </div>
                    </>
                )}
            </Modal>
        </div>
    );
}

