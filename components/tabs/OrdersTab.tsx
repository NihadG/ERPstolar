'use client';

import { useState, useMemo, useEffect } from 'react';
import type { Order, Supplier, Project, ProductMaterial, OrderItem } from '@/lib/types';
import { createOrder, deleteOrder, updateOrderStatus, markOrderSent, markMaterialsReceived, getOrder, deleteOrderItemsByIds, updateOrderItem, recalculateOrderTotal } from '@/lib/database';
import Modal from '@/components/ui/Modal';
import { OrderWizardModal } from './OrderWizardModal';
import { ORDER_STATUSES, MATERIAL_STATUSES } from '@/lib/types';
import './OrdersTab.css';

interface OrdersTabProps {
    orders: Order[];
    suppliers: Supplier[];
    projects: Project[];
    productMaterials: ProductMaterial[];
    onRefresh: () => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
    pendingOrderMaterials?: { materialIds: string[], supplierName: string } | null;
    onClearPendingOrder?: () => void;
}

export default function OrdersTab({ orders, suppliers, projects, productMaterials, onRefresh, showToast, pendingOrderMaterials, onClearPendingOrder }: OrdersTabProps) {
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('');

    // Create Order Wizard
    const [wizardModal, setWizardModal] = useState(false);
    const [wizardStep, setWizardStep] = useState(1);
    const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(new Set());
    const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
    const [selectedSupplierId, setSelectedSupplierId] = useState('');
    const [selectedMaterialIds, setSelectedMaterialIds] = useState<Set<string>>(new Set());

    // Expanded Order State
    const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
    const [editMode, setEditMode] = useState(false);
    const [editedQuantities, setEditedQuantities] = useState<Record<string, number>>({});
    const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());

    // Current order derived from expanded ID
    const currentOrder = useMemo(() =>
        orders.find(o => o.Order_ID === expandedOrderId) || null
        , [orders, expandedOrderId]);

    // Company Info (read from Settings page)
    const [companyInfo, setCompanyInfo] = useState({
        name: 'Vaša Firma',
        address: 'Ulica i broj, Grad',
        phone: '+387 XX XXX XXX',
        email: 'info@firma.ba',
        idNumber: '',
        pdvNumber: '',
        website: '',
        logoBase64: '',
        hideNameWhenLogo: false
    });

    // Load company info from localStorage on mount
    useMemo(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('companyInfo');
            if (saved) {
                try {
                    const parsed = JSON.parse(saved);
                    setCompanyInfo(prev => ({ ...prev, ...parsed }));
                } catch (e) { /* ignore */ }
            }
        }
    }, []);

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

    const filteredOrders = orders.filter(order => {
        const matchesSearch = order.Order_Number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            order.Supplier_Name?.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesStatus = !statusFilter || order.Status === statusFilter;
        return matchesSearch && matchesStatus;
    });

    // Get unordered materials (status = "Nije naručeno" or empty)
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
        return (amount || 0).toFixed(2) + ' KM';
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
        setSelectedSupplierId('');
        setSelectedMaterialIds(new Set());
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
        if (!supplier) return;

        const items = Array.from(selectedMaterialIds).map(materialId => {
            const material = filteredMaterials.find(m => m.ID === materialId);
            const product = availableProducts.find(p => p.Product_ID === material?.Product_ID);
            return {
                Product_Material_ID: materialId,
                Product_ID: material?.Product_ID || '',
                Product_Name: material?.Product_Name || '',
                Project_ID: product?.Project_ID || '',
                Material_Name: material?.Material_Name || '',
                Quantity: material?.Quantity || 0,
                Unit: material?.Unit || '',
                Expected_Price: material?.Total_Price || 0,
            };
        });

        const totalAmount = items.reduce((sum, item) => sum + item.Expected_Price, 0);

        const result = await createOrder({
            Supplier_ID: selectedSupplierId,
            Supplier_Name: supplier.Name,
            Total_Amount: totalAmount,
            items: items as any,
        });

        if (result.success) {
            showToast(result.message, 'success');
            setWizardModal(false);
            onRefresh();
        } else {
            showToast(result.message, 'error');
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
        const result = await updateOrderStatus(orderId, newStatus);
        if (result.success) {
            showToast('Status promijenjen', 'success');
            onRefresh();
        } else {
            showToast(result.message, 'error');
        }
    }

    async function handleDeleteOrder(orderId: string) {
        if (!confirm('Jeste li sigurni da želite obrisati ovu narudžbu?')) return;

        const result = await deleteOrder(orderId);
        if (result.success) {
            showToast(result.message, 'success');
            onRefresh();
        } else {
            showToast(result.message, 'error');
        }
    }

    async function handleSendOrder(orderId: string) {
        const result = await markOrderSent(orderId);
        if (result.success) {
            showToast('Narudžba poslana', 'success');
            onRefresh();
            // setViewModal(false); // No longer needed
        } else {
            showToast(result.message, 'error');
        }
    }

    async function handleReceiveSelectedItems() {
        if (selectedItemIds.size === 0) {
            showToast('Odaberite stavke za primanje', 'error');
            return;
        }
        const result = await markMaterialsReceived(Array.from(selectedItemIds));
        if (result.success) {
            showToast('Materijali primljeni', 'success');
            setSelectedItemIds(new Set());
            onRefresh();
            // Current order updates automatically via useMemo
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
        if (!confirm(`Obrisati ${selectedItemIds.size} stavki iz narudžbe?`)) return;

        const result = await deleteOrderItemsByIds(Array.from(selectedItemIds));
        if (result.success) {
            await recalculateOrderTotal(currentOrder!.Order_ID);
            showToast('Stavke obrisane', 'success');
            setSelectedItemIds(new Set());
            onRefresh();
            // Current order updates automatically via useMemo
        } else {
            showToast(result.message, 'error');
        }
    }

    // Start edit mode
    function startEditMode() {
        const quantities: Record<string, number> = {};
        currentOrder?.items?.forEach(item => {
            quantities[item.ID] = item.Quantity;
        });
        setEditedQuantities(quantities);
        setEditMode(true);
    }

    // Cancel edit mode
    function cancelEditMode() {
        setEditMode(false);
        setEditedQuantities({});
    }

    // Save edited quantities
    async function saveEditedQuantities() {
        const itemsToUpdate: { id: string; quantity: number }[] = [];
        currentOrder?.items?.forEach(item => {
            const newQty = editedQuantities[item.ID];
            if (newQty !== undefined && newQty !== item.Quantity) {
                itemsToUpdate.push({ id: item.ID, quantity: newQty });
            }
        });

        if (itemsToUpdate.length === 0) {
            showToast('Nema promjena za spremanje', 'info');
            setEditMode(false);
            return;
        }

        for (const { id, quantity } of itemsToUpdate) {
            await updateOrderItem(id, { Quantity: quantity });
        }
        await recalculateOrderTotal(currentOrder!.Order_ID);

        showToast('Količine ažurirane', 'success');
        setEditMode(false);
        setEditedQuantities({});
        setEditedQuantities({});
        onRefresh();
        // Current order updates automatically via useMemo
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
            // Find associated material to check for glass/alu door items
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

        // Generate print HTML
        const regularTableHtml = regularItems.length > 0 ? `
            <h3 style="margin: 24px 0 12px; font-size: 14px; font-weight: 600;">Materijali</h3>
            <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                <thead>
                    <tr style="background: #f5f5f7;">
                        <th style="padding: 10px; text-align: left; border-bottom: 1px solid #e5e5e5;">#</th>
                        <th style="padding: 10px; text-align: left; border-bottom: 1px solid #e5e5e5;">Materijal</th>
                        <th style="padding: 10px; text-align: right; border-bottom: 1px solid #e5e5e5;">Količina</th>
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
                                        ${d.Integrated_Handle ? '<div><span style="color: #86868b;">Ručka:</span> Integrisana</div>' : ''}
                                        ${d.Note ? `<div style="margin-top: 6px; font-style: italic; color: #6e6e73;"><span style="color: #86868b;">Napomena:</span> ${d.Note}</div>` : ''}
                                    </div>
                                </div>
                            `;
            }).join('')}
                    </div>
                `;
        }).join('')}
        ` : '';

        const printHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <title>Narudžba ${currentOrder.Order_Number}</title>
                <style>
                    * { box-sizing: border-box; margin: 0; padding: 0; }
                    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 40px; color: #1d1d1f; }
                    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; padding-bottom: 24px; border-bottom: 2px solid #1d1d1f; }
                    .company-info { display: flex; flex-direction: column; gap: 6px; }
                    .company-logo { max-width: 180px; max-height: 60px; width: auto; height: auto; object-fit: contain; }
                    .company-name { font-size: 20px; font-weight: 700; letter-spacing: -0.3px; color: #1d1d1f; margin: 0; }
                    .company-details p { font-size: 11px; color: #86868b; margin: 0 0 2px 0; }
                    .order-info { text-align: right; font-size: 14px; }
                    .order-number { font-size: 18px; font-weight: 600; }
                    .supplier-section { background: #f5f5f7; padding: 16px; border-radius: 12px; margin-bottom: 24px; }
                    .supplier-name { font-size: 16px; font-weight: 600; margin-bottom: 4px; }
                    .supplier-contact { font-size: 13px; color: #86868b; }
                    .notes { margin-top: 24px; padding: 12px 16px; background: #fffaf0; border-radius: 8px; border-left: 3px solid #f5a623; font-size: 13px; }
                    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e5e5; font-size: 12px; color: #86868b; display: flex; justify-content: space-between; }
                    @media print { body { padding: 20px; } }
                </style>
            </head>
            <body>
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
                        <div class="order-number">Narudžba: ${currentOrder.Order_Number}</div>
                        <div>Datum: ${formatDate(currentOrder.Order_Date)}</div>
                    </div>
                </div>
                
                <div class="supplier-section">
                    <div class="supplier-name">${currentOrder.Supplier_Name || 'Dobavljač'}</div>
                    <div class="supplier-contact">
                        ${[supplier?.Phone, supplier?.Email, supplier?.Address].filter(Boolean).join(' | ')}
                    </div>
                </div>

                ${regularTableHtml}
                ${glassTableHtml}
                ${aluDoorHtml}

                ${currentOrder.Notes ? `<div class="notes"><strong>Napomena:</strong> ${currentOrder.Notes}</div>` : ''}

                <div class="footer">
                    <span>Očekivana dostava: ${currentOrder.Expected_Delivery ? formatDate(currentOrder.Expected_Delivery) : 'Po dogovoru'}</span>
                    <span>Ukupno stavki: ${currentOrder.items?.length || 0}</span>
                </div>
            </body>
            </html>
        `;

        const printWindow = window.open('', '_blank');
        if (printWindow) {
            printWindow.document.write(printHtml);
            printWindow.document.close();
            printWindow.focus();
            setTimeout(() => printWindow.print(), 250);
        }
    }

    async function handleReceiveItems(itemIds: string[]) {
        const result = await markMaterialsReceived(itemIds);
        if (result.success) {
            showToast('Materijali primljeni', 'success');
            onRefresh();
            onRefresh();
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
        <div className="tab-content active" id="orders-content">
            <div className="content-header">
                <div className="search-box">
                    <span className="material-icons-round">search</span>
                    <input
                        type="text"
                        placeholder="Pretraži narudžbe..."
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
                    {ORDER_STATUSES.map(status => (
                        <option key={status} value={status}>{status}</option>
                    ))}
                </select>
                <button className="btn btn-primary" onClick={openWizard}>
                    <span className="material-icons-round">add</span>
                    Nova Narudžba
                </button>
            </div>

            <div className="orders-list">
                {filteredOrders.length === 0 ? (
                    <div className="empty-state">
                        <span className="material-icons-round">local_shipping</span>
                        <h3>Nema narudžbi</h3>
                        <p>Kreirajte prvu narudžbu klikom na "Nova Narudžba"</p>
                    </div>
                ) : (
                    // When an order is expanded, only show that order for cleaner view
                    (expandedOrderId
                        ? filteredOrders.filter(o => o.Order_ID === expandedOrderId)
                        : filteredOrders
                    ).map(order => {
                        const isExpanded = expandedOrderId === order.Order_ID;
                        const itemCount = order.items?.length || 0;
                        const receivedCount = order.items?.filter(i => i.Status === 'Primljeno').length || 0;
                        const allReceived = itemCount > 0 && receivedCount === itemCount;
                        const unreceivedItems = order.items?.filter(i => i.Status !== 'Primljeno') || [];

                        // Get project name from first item
                        const firstItem = order.items?.[0];
                        const projectName = firstItem?.Project_ID
                            ? projects.find(p => p.Project_ID === firstItem.Project_ID)?.Client_Name || 'N/A'
                            : 'N/A';

                        // Quick receive all handler
                        const handleQuickReceiveAll = async (e: React.MouseEvent) => {
                            e.stopPropagation();
                            if (unreceivedItems.length === 0) {
                                showToast('Sve stavke su već primljene', 'info');
                                return;
                            }
                            const result = await markMaterialsReceived(unreceivedItems.map(i => i.ID));
                            if (result.success) {
                                await updateOrderStatus(order.Order_ID, 'Primljeno');
                                showToast('Sve stavke primljene', 'success');
                                onRefresh();
                            } else {
                                showToast(result.message, 'error');
                            }
                        };

                        return (
                            <div
                                key={order.Order_ID}
                                className="project-card" /* Keep project card wrapper for consistency */
                            >
                                {/* CUSTOM HEADER - Fine tuned layout */}
                                <div className="order-header-custom" onClick={() => toggleOrderExpand(order.Order_ID)} style={{ cursor: 'pointer' }}>

                                    {/* EXPAND BUTTON */}
                                    <button className={`expand-btn ${isExpanded ? 'expanded' : ''}`}>
                                        <span className="material-icons-round">chevron_right</span>
                                    </button>

                                    {/* MAIN INFO GROUP */}
                                    <div className="order-info-group">
                                        <div className="order-top-row">
                                            <span className="order-id-text">{order.Order_Number}</span>
                                            {projectName !== 'N/A' && (
                                                <span className="order-project-text">{projectName}</span>
                                            )}
                                        </div>
                                        <div className="order-meta-info">
                                            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                                <span className="material-icons-round" style={{ fontSize: 14 }}>calendar_today</span>
                                                {formatDate(order.Order_Date)}
                                            </span>
                                            <span>•</span>
                                            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                                <span className="material-icons-round" style={{ fontSize: 14 }}>inventory_2</span>
                                                {itemCount} stavki
                                            </span>
                                        </div>
                                    </div>

                                    {/* ACTIONS GROUP - Single line: Status | Receive | Print | Delete */}
                                    <div className="order-actions-group" onClick={e => e.stopPropagation()}>

                                        {/* Status Badge */}
                                        <span className={`status-badge-custom status-${order.Status.toLowerCase().replace(/\s+/g, '-')}`}>
                                            {order.Status}
                                        </span>

                                        {/* Receive All Button */}
                                        {!allReceived && order.Status !== 'Nacrt' && (
                                            <button
                                                className="btn-receive-all action-item"
                                                onClick={handleQuickReceiveAll}
                                                title="Primi sve"
                                            >
                                                <span className="material-icons-round">check_circle</span>
                                                <span className="btn-text-responsive">Primi sve</span>
                                            </button>
                                        )}

                                        {/* Print Button */}
                                        <button className="icon-btn-custom action-item" onClick={printOrderDocument} title="Printaj">
                                            <span className="material-icons-round">print</span>
                                        </button>

                                        {/* Send Button (if Draft) */}
                                        {order.Status === 'Nacrt' && (
                                            <button className="icon-btn-custom action-item" onClick={() => handleSendOrder(order.Order_ID)} title="Pošalji">
                                                <span className="material-icons-round">send</span>
                                            </button>
                                        )}

                                        {/* Delete Button */}
                                        <button className="icon-btn-custom danger action-item" onClick={() => handleDeleteOrder(order.Order_ID)} title="Obriši">
                                            <span className="material-icons-round">delete</span>
                                        </button>
                                    </div>
                                </div>

                                {/* EXPANDED CONTENT - Reuse project-products structure */}
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

                                    {/* ITEMS AS PRODUCT CARDS */}
                                    {order.items?.map(item => {
                                        const isReceived = item.Status === 'Primljeno';
                                        const isSelected = selectedItemIds.has(item.ID);

                                        return (
                                            <div
                                                key={item.ID}
                                                className="product-card" /* Using Product Card Style */
                                                onClick={() => {
                                                    if (!isReceived) toggleItemSelection(item.ID, !isSelected);
                                                }}
                                                style={{ cursor: 'pointer', borderColor: isSelected ? 'var(--accent)' : undefined }}
                                            >
                                                <div className="product-header">
                                                    {/* CHECKBOX for selection */}
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
                    })
                )}
            </div>

            {/* Order Creation Wizard - Step-based Layout */}
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
            />

        </div>
    );
}
