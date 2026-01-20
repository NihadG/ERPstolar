'use client';

import { useState, useMemo } from 'react';
import type { Order, Supplier, Project, ProductMaterial, OrderItem } from '@/lib/types';
import { createOrder, deleteOrder, updateOrderStatus, markOrderSent, markMaterialsReceived, getOrder, deleteOrderItemsByIds, updateOrderItem, recalculateOrderTotal } from '@/lib/database';
import Modal from '@/components/ui/Modal';
import { ORDER_STATUSES } from '@/lib/types';

interface OrdersTabProps {
    orders: Order[];
    suppliers: Supplier[];
    projects: Project[];
    productMaterials: ProductMaterial[];
    onRefresh: () => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

export default function OrdersTab({ orders, suppliers, projects, productMaterials, onRefresh, showToast }: OrdersTabProps) {
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('');

    // Create Order Wizard
    const [wizardModal, setWizardModal] = useState(false);
    const [wizardStep, setWizardStep] = useState(1);
    const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(new Set());
    const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
    const [selectedSupplierId, setSelectedSupplierId] = useState('');
    const [selectedMaterialIds, setSelectedMaterialIds] = useState<Set<string>>(new Set());

    // View Order Modal
    const [viewModal, setViewModal] = useState(false);
    const [currentOrder, setCurrentOrder] = useState<Order | null>(null);
    const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
    const [editMode, setEditMode] = useState(false);
    const [editedQuantities, setEditedQuantities] = useState<Record<string, number>>({});

    const filteredOrders = orders.filter(order => {
        const matchesSearch = order.Order_Number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            order.Supplier_Name?.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesStatus = !statusFilter || order.Status === statusFilter;
        return matchesSearch && matchesStatus;
    });

    // Get unordered materials (status = "Nije naručeno" or empty)
    const unorderedMaterials = useMemo(() => {
        return productMaterials.filter(m => m.Status === 'Nije naručeno' || !m.Status);
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
            showToast('Odaberite dobavljača', 'error');
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

    async function openViewModal(orderId: string) {
        const order = await getOrder(orderId);
        if (order) {
            setCurrentOrder(order);
            setSelectedItemIds(new Set());
            setEditMode(false);
            setEditedQuantities({});
            setViewModal(true);
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
            setViewModal(false);
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
            if (currentOrder) {
                const updatedOrder = await getOrder(currentOrder.Order_ID);
                setCurrentOrder(updatedOrder);
            }
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
            const updatedOrder = await getOrder(currentOrder!.Order_ID);
            setCurrentOrder(updatedOrder);
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

        showToast('Količine ažurirane', 'success');
        setEditMode(false);
        setEditedQuantities({});
        onRefresh();
        const updatedOrder = await getOrder(currentOrder!.Order_ID);
        setCurrentOrder(updatedOrder);
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
                    .logo { font-size: 24px; font-weight: 700; }
                    .logo-placeholder { width: 120px; height: 40px; background: #f5f5f7; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: #86868b; font-size: 12px; }
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
                    <div>
                        <div class="logo-placeholder">Vaš Logo</div>
                    </div>
                    <div class="order-info">
                        <div class="order-number">Narudžba: ${currentOrder.Order_Number}</div>
                        <div>Datum: ${formatDate(currentOrder.Order_Date)}</div>
                    </div>
                </div>
                
                <div class="supplier-section">
                    <div class="supplier-name">${currentOrder.Supplier_Name || 'Dobavljač'}</div>
                    <div class="supplier-contact">
                        ${[supplier?.Phone, supplier?.Email, supplier?.Address].filter(Boolean).join(' | ')}
                    </div>
                </div>

                ${regularTableHtml}
                ${glassTableHtml}
                ${aluDoorHtml}

                ${currentOrder.Notes ? `<div class="notes"><strong>Napomena:</strong> ${currentOrder.Notes}</div>` : ''}

                <div class="footer">
                    <span>Očekivana dostava: ${currentOrder.Expected_Delivery ? formatDate(currentOrder.Expected_Delivery) : 'Po dogovoru'}</span>
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
            // Refresh current order
            if (currentOrder) {
                const updatedOrder = await getOrder(currentOrder.Order_ID);
                setCurrentOrder(updatedOrder);
            }
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
                    filteredOrders.map(order => {
                        const itemCount = order.items?.length || 0;
                        const receivedCount = order.items?.filter(i => i.Status === 'Primljeno').length || 0;
                        const progress = itemCount > 0 ? Math.round((receivedCount / itemCount) * 100) : 0;
                        const showProgress = order.Status === 'Poslano' || order.Status === 'Djelomično primljeno';

                        return (
                            <div key={order.Order_ID} className="order-card" onClick={() => openViewModal(order.Order_ID)} style={{ cursor: 'pointer' }}>
                                <div className="order-card-main" style={{ flex: 1 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                                        <div>
                                            <div style={{ fontWeight: 600, fontSize: '16px', color: 'var(--accent)' }}>{order.Order_Number}</div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px', color: 'var(--text-secondary)', fontSize: '13px' }}>
                                                <span className="material-icons-round" style={{ fontSize: '16px' }}>store</span>
                                                {order.Supplier_Name || 'Nepoznat dobavljač'}
                                            </div>
                                        </div>
                                        <span className={`status-badge ${getStatusClass(order.Status)}`}>
                                            {order.Status || 'Nacrt'}
                                        </span>
                                    </div>
                                    <div style={{ display: 'flex', gap: '16px', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: showProgress ? '12px' : '0' }}>
                                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                            <span className="material-icons-round" style={{ fontSize: '16px' }}>calendar_today</span>
                                            {formatDate(order.Order_Date)}
                                        </span>
                                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                            <span className="material-icons-round" style={{ fontSize: '16px' }}>inventory_2</span>
                                            {itemCount} stavki
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
                                                {receivedCount}/{itemCount} primljeno
                                            </div>
                                        </div>
                                    )}
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px', minWidth: '120px' }}>
                                    <div style={{ fontWeight: 700, fontSize: '18px', color: 'var(--accent)' }}>
                                        {formatCurrency(order.Total_Amount || 0)}
                                    </div>
                                    <div style={{ display: 'flex', gap: '6px' }} onClick={(e) => e.stopPropagation()}>
                                        {order.Status === 'Nacrt' && (
                                            <button
                                                className="btn btn-sm btn-primary"
                                                onClick={() => handleSendOrder(order.Order_ID)}
                                            >
                                                <span className="material-icons-round">send</span>
                                            </button>
                                        )}
                                        <button className="icon-btn danger" onClick={() => handleDeleteOrder(order.Order_ID)}>
                                            <span className="material-icons-round">delete</span>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            {/* Order Creation Modal - Sidebar + Main Content Layout */}
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
                        <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 600 }}>Nova Narudžba</h2>
                        <button
                            className="icon-btn"
                            onClick={() => setWizardModal(false)}
                        >
                            <span className="material-icons-round">close</span>
                        </button>
                    </div>

                    {/* Content - Sidebar + Main */}
                    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                        {/* Sidebar - Filters */}
                        <div style={{
                            width: '400px',
                            minWidth: '400px',
                            borderRight: '1px solid var(--border)',
                            display: 'flex',
                            flexDirection: 'column',
                            background: 'var(--surface)',
                            overflow: 'hidden'
                        }}>
                            {/* Projects Panel */}
                            <div style={{
                                flex: '0 0 auto',
                                maxHeight: '35%',
                                display: 'flex',
                                flexDirection: 'column',
                                borderBottom: '1px solid var(--border)',
                                overflow: 'hidden'
                            }}>
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    padding: '14px 16px',
                                    background: 'var(--bg)',
                                    fontWeight: 600,
                                    fontSize: '14px',
                                    borderBottom: '1px solid var(--border-light)'
                                }}>
                                    <span className="material-icons-round" style={{ fontSize: '20px', color: 'var(--accent)' }}>folder</span>
                                    <span style={{ flex: 1 }}>Projekti</span>
                                    <span style={{
                                        background: selectedProjectIds.size > 0 ? 'var(--accent)' : 'var(--border)',
                                        color: selectedProjectIds.size > 0 ? 'white' : 'var(--text-secondary)',
                                        padding: '4px 10px',
                                        borderRadius: '12px',
                                        fontSize: '13px',
                                        fontWeight: 600
                                    }}>
                                        {selectedProjectIds.size}/{projectsWithMaterials.length}
                                    </span>
                                </div>
                                <div style={{ flex: 1, overflow: 'auto' }}>
                                    {projectsWithMaterials.length === 0 ? (
                                        <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '13px' }}>
                                            Nema projekata sa materijalima
                                        </div>
                                    ) : (
                                        projectsWithMaterials.map(project => (
                                            <div
                                                key={project.Project_ID}
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '12px',
                                                    padding: '12px 16px',
                                                    cursor: 'pointer',
                                                    background: selectedProjectIds.has(project.Project_ID) ? 'var(--accent-light)' : 'transparent',
                                                    borderBottom: '1px solid var(--border-light)',
                                                    transition: 'background 0.1s ease'
                                                }}
                                                onClick={() => toggleProject(project.Project_ID)}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={selectedProjectIds.has(project.Project_ID)}
                                                    onChange={() => { }}
                                                    style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                                                />
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div style={{ fontWeight: 500, fontSize: '14px' }}>{project.Client_Name}</div>
                                                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                                                        {project.products?.length || 0} proizvoda
                                                    </div>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>

                            {/* Products Panel */}
                            <div style={{
                                flex: 1,
                                display: 'flex',
                                flexDirection: 'column',
                                borderBottom: '1px solid var(--border)',
                                overflow: 'hidden'
                            }}>
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    padding: '14px 16px',
                                    background: 'var(--bg)',
                                    fontWeight: 600,
                                    fontSize: '14px',
                                    borderBottom: '1px solid var(--border-light)'
                                }}>
                                    <span className="material-icons-round" style={{ fontSize: '20px', color: 'var(--accent)' }}>inventory</span>
                                    <span style={{ flex: 1 }}>Proizvodi</span>
                                    {availableProducts.length > 0 && (
                                        <button
                                            className="btn btn-sm"
                                            style={{ padding: '4px 8px', fontSize: '11px' }}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                // Select all available products
                                                const newSelected = new Set(selectedProductIds);
                                                availableProducts.forEach(p => newSelected.add(p.Product_ID));
                                                setSelectedProductIds(newSelected);
                                            }}
                                        >
                                            Sve
                                        </button>
                                    )}
                                    <span style={{
                                        background: selectedProductIds.size > 0 ? 'var(--accent)' : 'var(--border)',
                                        color: selectedProductIds.size > 0 ? 'white' : 'var(--text-secondary)',
                                        padding: '4px 10px',
                                        borderRadius: '12px',
                                        fontSize: '13px',
                                        fontWeight: 600
                                    }}>
                                        {selectedProductIds.size}
                                    </span>
                                </div>
                                <div style={{ flex: 1, overflow: 'auto' }}>
                                    {selectedProjectIds.size === 0 ? (
                                        <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                                            <span className="material-icons-round" style={{ fontSize: '32px', color: 'var(--text-tertiary)', marginBottom: '8px', display: 'block' }}>arrow_upward</span>
                                            <div style={{ fontSize: '13px' }}>Prvo odaberi projekte</div>
                                        </div>
                                    ) : availableProducts.length === 0 ? (
                                        <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '13px' }}>
                                            Nema proizvoda u odabranim projektima
                                        </div>
                                    ) : (
                                        availableProducts.map(product => (
                                            <div
                                                key={product.Product_ID}
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '12px',
                                                    padding: '12px 16px',
                                                    cursor: 'pointer',
                                                    background: selectedProductIds.has(product.Product_ID) ? 'var(--accent-light)' : 'transparent',
                                                    borderBottom: '1px solid var(--border-light)',
                                                    transition: 'background 0.1s ease'
                                                }}
                                                onClick={() => toggleProduct(product.Product_ID)}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={selectedProductIds.has(product.Product_ID)}
                                                    onChange={() => { }}
                                                    style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                                                />
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div style={{ fontWeight: 500, fontSize: '14px' }}>{product.Name}</div>
                                                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>{product.Project_Name}</div>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>

                            {/* Supplier & Settings Panel - Compact */}
                            <div style={{
                                flex: '0 0 auto',
                                padding: '16px',
                                background: 'var(--bg)'
                            }}>
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    marginBottom: '12px',
                                    fontWeight: 600,
                                    fontSize: '14px'
                                }}>
                                    <span className="material-icons-round" style={{ fontSize: '20px', color: 'var(--accent)' }}>store</span>
                                    Dobavljač
                                    {selectedSupplierId && (
                                        <span style={{ color: 'var(--success)', marginLeft: 'auto' }}>✓</span>
                                    )}
                                </div>
                                <select
                                    value={selectedSupplierId}
                                    onChange={(e) => {
                                        setSelectedSupplierId(e.target.value);
                                        setSelectedMaterialIds(new Set());
                                    }}
                                    style={{
                                        width: '100%',
                                        padding: '12px',
                                        borderRadius: '8px',
                                        border: selectedSupplierId ? '2px solid var(--accent)' : '1px solid var(--border)',
                                        fontSize: '14px',
                                        fontWeight: selectedSupplierId ? 500 : 400,
                                        background: 'var(--background)'
                                    }}
                                >
                                    <option value="">— Odaberi dobavljača —</option>
                                    {availableSuppliers.map(supplier => (
                                        <option key={supplier.Supplier_ID} value={supplier.Supplier_ID}>
                                            {supplier.Name}
                                        </option>
                                    ))}
                                </select>

                                <div style={{ display: 'flex', gap: '12px', marginTop: '12px' }}>
                                    <div style={{ flex: 1 }}>
                                        <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>Isporuka</label>
                                        <input
                                            type="date"
                                            id="expected-delivery"
                                            style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '13px' }}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Main Content - Materials */}
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                            {/* Materials Header */}
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: '12px 24px',
                                background: 'var(--surface)',
                                borderBottom: '1px solid var(--border)'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                    <span className="material-icons-round" style={{ color: 'var(--accent)' }}>shopping_cart</span>
                                    <span style={{ fontWeight: 600 }}>Materijali za narudžbu</span>
                                    <span style={{
                                        background: 'var(--accent-light)',
                                        color: 'var(--accent)',
                                        padding: '2px 10px',
                                        borderRadius: '12px',
                                        fontSize: '13px',
                                        fontWeight: 600
                                    }}>
                                        {filteredMaterials.length}
                                    </span>
                                </div>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <button
                                        className="btn btn-sm btn-secondary"
                                        onClick={selectAllMaterials}
                                    >
                                        Sve
                                    </button>
                                    <button
                                        className="btn btn-sm btn-secondary"
                                        onClick={() => setSelectedMaterialIds(new Set())}
                                    >
                                        Ništa
                                    </button>
                                </div>
                            </div>

                            {/* Materials List */}
                            <div style={{ flex: 1, overflow: 'auto', padding: '16px 24px' }}>
                                {filteredMaterials.length === 0 ? (
                                    <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-secondary)' }}>
                                        <span className="material-icons-round" style={{ fontSize: '48px', color: 'var(--text-tertiary)', marginBottom: '12px', display: 'block' }}>inventory_2</span>
                                        <p>Odaberite projekte, proizvode i dobavljača za prikaz materijala</p>
                                    </div>
                                ) : (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        {filteredMaterials.map(material => (
                                            <div
                                                key={material.ID}
                                                onClick={() => toggleMaterial(material.ID)}
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '16px',
                                                    padding: '14px 16px',
                                                    background: selectedMaterialIds.has(material.ID) ? 'var(--accent-light)' : 'var(--bg)',
                                                    border: selectedMaterialIds.has(material.ID) ? '1px solid var(--accent)' : '1px solid var(--border)',
                                                    borderRadius: '10px',
                                                    cursor: 'pointer',
                                                    transition: 'all 0.15s ease'
                                                }}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={selectedMaterialIds.has(material.ID)}
                                                    onChange={() => { }}
                                                    style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                                                />
                                                <div style={{ flex: 1 }}>
                                                    <div style={{ fontWeight: 500, fontSize: '14px' }}>{material.Material_Name}</div>
                                                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                                                        {material.Product_Name} • {material.Project_Name}
                                                    </div>
                                                </div>
                                                <div style={{ textAlign: 'right' }}>
                                                    <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{material.Quantity} {material.Unit}</div>
                                                    <div style={{ fontWeight: 600, color: 'var(--accent)', fontSize: '14px' }}>{formatCurrency(material.Total_Price)}</div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Summary Bar */}
                            <div style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                padding: '16px 24px',
                                background: 'var(--surface)',
                                borderTop: '1px solid var(--border)'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <strong style={{ fontSize: '18px' }}>{selectedMaterialIds.size}</strong>
                                    <span style={{ color: 'var(--text-secondary)' }}>stavki</span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
                                    <div>
                                        <span style={{ color: 'var(--text-secondary)', marginRight: '8px' }}>Ukupno:</span>
                                        <strong style={{ fontSize: '20px', color: 'var(--accent)' }}>{formatCurrency(selectedTotal)}</strong>
                                    </div>
                                    <button
                                        className="btn btn-primary"
                                        onClick={handleCreateOrder}
                                        disabled={selectedMaterialIds.size === 0 || !selectedSupplierId}
                                    >
                                        <span className="material-icons-round">add_shopping_cart</span>
                                        Kreiraj Narudžbu
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </Modal>

            {/* View Order Modal - Fullscreen Redesign */}
            <Modal
                isOpen={viewModal}
                onClose={() => { setViewModal(false); setEditMode(false); setSelectedItemIds(new Set()); }}
                title=""
                size="fullscreen"
                footer={null}
            >
                {currentOrder && (
                    <div className="order-view-container" style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '0' }}>
                        {/* Custom Header - Apple style */}
                        <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '16px 24px',
                            borderBottom: '1px solid var(--border)',
                            background: 'var(--surface)'
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 600 }}>
                                    Narudžba {currentOrder.Order_Number}
                                </h2>
                                <span className={`status-badge ${getStatusClass(currentOrder.Status)}`}>
                                    {currentOrder.Status}
                                </span>
                            </div>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                {currentOrder.Status === 'Nacrt' && !editMode && (
                                    <button className="btn btn-secondary btn-sm" onClick={() => handleSendOrder(currentOrder.Order_ID)}>
                                        <span className="material-icons-round">send</span>
                                        Pošalji
                                    </button>
                                )}
                                <button className="btn btn-secondary btn-sm" onClick={printOrderDocument}>
                                    <span className="material-icons-round">print</span>
                                    Printaj
                                </button>
                                <button
                                    className="icon-btn"
                                    onClick={() => { setViewModal(false); setEditMode(false); setSelectedItemIds(new Set()); }}
                                    style={{ marginLeft: '8px' }}
                                >
                                    <span className="material-icons-round">close</span>
                                </button>
                            </div>
                        </div>

                        {/* Main Content Area */}
                        <div style={{ flex: 1, overflow: 'auto', padding: '24px' }}>
                            {/* Info Cards Row */}
                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(3, 1fr)',
                                gap: '16px',
                                marginBottom: '24px'
                            }}>
                                <div style={{
                                    background: 'var(--surface)',
                                    padding: '16px 20px',
                                    borderRadius: '12px',
                                    border: '1px solid var(--border)'
                                }}>
                                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                        Broj narudžbe
                                    </div>
                                    <div style={{ fontSize: '18px', fontWeight: 600 }}>{currentOrder.Order_Number}</div>
                                </div>
                                <div style={{
                                    background: 'var(--surface)',
                                    padding: '16px 20px',
                                    borderRadius: '12px',
                                    border: '1px solid var(--border)'
                                }}>
                                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                        Datum
                                    </div>
                                    <div style={{ fontSize: '18px', fontWeight: 600 }}>{formatDate(currentOrder.Order_Date)}</div>
                                </div>
                                <div style={{
                                    background: 'var(--surface)',
                                    padding: '16px 20px',
                                    borderRadius: '12px',
                                    border: '1px solid var(--border)'
                                }}>
                                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                        Očekivana isporuka
                                    </div>
                                    <div style={{ fontSize: '18px', fontWeight: 600 }}>
                                        {currentOrder.Expected_Delivery ? formatDate(currentOrder.Expected_Delivery) : 'Po dogovoru'}
                                    </div>
                                </div>
                            </div>

                            {/* Supplier Section */}
                            <div style={{ marginBottom: '24px' }}>
                                <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px', color: 'var(--text-secondary)' }}>
                                    Dobavljač
                                </h3>
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '16px',
                                    background: 'var(--surface)',
                                    padding: '16px 20px',
                                    borderRadius: '12px',
                                    border: '1px solid var(--border)'
                                }}>
                                    <span className="material-icons-round" style={{ fontSize: '32px', color: 'var(--accent)' }}>store</span>
                                    <div>
                                        <div style={{ fontSize: '16px', fontWeight: 600 }}>{currentOrder.Supplier_Name}</div>
                                        {(() => {
                                            const supplier = suppliers.find(s => s.Supplier_ID === currentOrder.Supplier_ID);
                                            return supplier && (
                                                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                                                    {[supplier.Phone, supplier.Email].filter(Boolean).join(' • ')}
                                                </div>
                                            );
                                        })()}
                                    </div>
                                </div>
                            </div>

                            {/* Items Section */}
                            <div>
                                <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px', color: 'var(--text-secondary)' }}>
                                    Stavke narudžbe
                                </h3>
                                <div style={{
                                    border: '1px solid var(--border)',
                                    borderRadius: '12px',
                                    overflow: 'hidden',
                                    background: 'var(--bg)'
                                }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                                        <thead>
                                            <tr style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
                                                {!editMode && (
                                                    <th style={{ padding: '14px 16px', width: '44px' }}>
                                                        <input
                                                            type="checkbox"
                                                            onChange={(e) => toggleAllItems(e.target.checked)}
                                                            checked={selectedItemIds.size > 0 && selectedItemIds.size === (currentOrder.items?.filter(i => i.Status !== 'Primljeno').length || 0)}
                                                            style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                                                        />
                                                    </th>
                                                )}
                                                <th style={{ padding: '14px 16px', textAlign: 'left', fontWeight: 500 }}>Materijal</th>
                                                <th style={{ padding: '14px 16px', textAlign: 'left', fontWeight: 500 }}>Projekat / Proizvod</th>
                                                <th style={{ padding: '14px 16px', textAlign: 'right', fontWeight: 500 }}>Količina</th>
                                                <th style={{ padding: '14px 16px', textAlign: 'left', fontWeight: 500 }}>Jedinica</th>
                                                <th style={{ padding: '14px 16px', textAlign: 'right', fontWeight: 500 }}>Cijena</th>
                                                <th style={{ padding: '14px 16px', textAlign: 'right', fontWeight: 500 }}>Ukupno</th>
                                                <th style={{ padding: '14px 16px', textAlign: 'center', fontWeight: 500 }}>Status</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {currentOrder.items?.map(item => {
                                                const isReceived = item.Status === 'Primljeno';
                                                const isSelected = selectedItemIds.has(item.ID);
                                                const project = projects.find(p => p.products?.some(prod => prod.Product_ID === item.Product_ID));
                                                return (
                                                    <tr
                                                        key={item.ID}
                                                        style={{
                                                            borderBottom: '1px solid var(--border-light)',
                                                            background: isReceived ? 'rgba(52, 199, 89, 0.08)' : isSelected ? 'rgba(0, 122, 255, 0.08)' : 'transparent',
                                                            transition: 'background 0.15s ease'
                                                        }}
                                                    >
                                                        {!editMode && (
                                                            <td style={{ padding: '14px 16px' }}>
                                                                <input
                                                                    type="checkbox"
                                                                    checked={isSelected}
                                                                    disabled={isReceived}
                                                                    onChange={(e) => toggleItemSelection(item.ID, e.target.checked)}
                                                                    style={{ width: '18px', height: '18px', cursor: isReceived ? 'not-allowed' : 'pointer' }}
                                                                />
                                                            </td>
                                                        )}
                                                        <td style={{ padding: '14px 16px', fontWeight: 500 }}>{item.Material_Name}</td>
                                                        <td style={{ padding: '14px 16px' }}>
                                                            <div style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>{project?.Client_Name || '-'}</div>
                                                            <div>{item.Product_Name}</div>
                                                        </td>
                                                        <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                                                            {editMode ? (
                                                                <input
                                                                    type="number"
                                                                    value={editedQuantities[item.ID] ?? item.Quantity}
                                                                    onChange={(e) => setEditedQuantities({ ...editedQuantities, [item.ID]: parseFloat(e.target.value) || 0 })}
                                                                    style={{
                                                                        width: '80px',
                                                                        padding: '8px',
                                                                        textAlign: 'right',
                                                                        borderRadius: '6px',
                                                                        border: '1px solid var(--border)',
                                                                        fontSize: '14px'
                                                                    }}
                                                                    step="any"
                                                                />
                                                            ) : (
                                                                item.Quantity
                                                            )}
                                                        </td>
                                                        <td style={{ padding: '14px 16px', color: 'var(--text-secondary)' }}>{item.Unit}</td>
                                                        <td style={{ padding: '14px 16px', textAlign: 'right' }}>{formatCurrency(item.Expected_Price)}</td>
                                                        <td style={{ padding: '14px 16px', textAlign: 'right', fontWeight: 500 }}>
                                                            {formatCurrency((item.Quantity || 0) * (item.Expected_Price || 0))}
                                                        </td>
                                                        <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                                                            <span className={`status-badge ${getStatusClass(item.Status)}`}>
                                                                {item.Status || 'Na čekanju'}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>

                                {/* Notes Section */}
                                {currentOrder.Notes && (
                                    <div style={{ marginTop: '24px' }}>
                                        <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px', color: 'var(--text-secondary)' }}>
                                            Napomene
                                        </h3>
                                        <div style={{
                                            background: 'var(--surface)',
                                            padding: '16px 20px',
                                            borderRadius: '12px',
                                            border: '1px solid var(--border)',
                                            fontSize: '14px',
                                            lineHeight: 1.6
                                        }}>
                                            {currentOrder.Notes}
                                        </div>
                                    </div>
                                )}

                                {/* Order Total */}
                                <div style={{
                                    marginTop: '24px',
                                    display: 'flex',
                                    justifyContent: 'flex-end'
                                }}>
                                    <div style={{
                                        background: 'var(--accent)',
                                        color: 'white',
                                        padding: '16px 32px',
                                        borderRadius: '12px',
                                        textAlign: 'right'
                                    }}>
                                        <div style={{ fontSize: '12px', opacity: 0.9, marginBottom: '4px' }}>UKUPNO</div>
                                        <div style={{ fontSize: '24px', fontWeight: 700 }}>{formatCurrency(currentOrder.Total_Amount)}</div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Footer - Split Layout */}
                        <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '16px 24px',
                            borderTop: '1px solid var(--border)',
                            background: 'var(--surface)'
                        }}>
                            {/* Left Side - Selection Actions */}
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                {editMode ? (
                                    <>
                                        <button className="btn btn-secondary" onClick={cancelEditMode}>
                                            Odustani
                                        </button>
                                        <button className="btn btn-primary" onClick={saveEditedQuantities}>
                                            <span className="material-icons-round">save</span>
                                            Spremi Promjene
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        {selectedItemIds.size > 0 && (
                                            <span style={{ fontSize: '13px', color: 'var(--text-secondary)', marginRight: '8px' }}>
                                                Odabrano: {selectedItemIds.size}
                                            </span>
                                        )}
                                        {(currentOrder.Status === 'Poslano' || currentOrder.Status === 'Djelomično primljeno') && selectedItemIds.size > 0 && (
                                            <button className="btn btn-success btn-sm" onClick={handleReceiveSelectedItems}>
                                                <span className="material-icons-round">check_circle</span>
                                                Označi primljeno
                                            </button>
                                        )}
                                        {currentOrder.Status === 'Nacrt' && selectedItemIds.size > 0 && (
                                            <button className="btn btn-danger btn-sm" onClick={handleDeleteSelectedItems}>
                                                <span className="material-icons-round">delete</span>
                                                Obriši selektovane
                                            </button>
                                        )}
                                    </>
                                )}
                            </div>

                            {/* Right Side - Order Actions */}
                            <div style={{ display: 'flex', gap: '8px' }}>
                                {currentOrder.Status === 'Nacrt' && !editMode && (
                                    <button className="btn btn-secondary btn-sm" onClick={startEditMode}>
                                        <span className="material-icons-round">edit</span>
                                        Uredi količine
                                    </button>
                                )}
                                <button className="btn btn-danger btn-sm" onClick={() => handleDeleteOrder(currentOrder.Order_ID)}>
                                    <span className="material-icons-round">delete</span>
                                    Obriši
                                </button>
                                <button className="btn btn-secondary" onClick={() => { setViewModal(false); setEditMode(false); setSelectedItemIds(new Set()); }}>
                                    Zatvori
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </Modal>
        </div>
    );
}
