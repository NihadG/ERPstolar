'use client';

import { useState, useMemo } from 'react';
import type { Project, WorkOrder, Order, Supplier, ProductMaterial, Offer, OfferProduct, WorkLog } from '@/lib/types';
import { updateProductMaterial, createOrder, markMaterialsReceived } from '@/lib/database';
import ProductTimelineModal from '@/components/ui/ProductTimelineModal';

interface OverviewTabProps {
    projects: Project[];
    workOrders: WorkOrder[];
    orders?: Order[];
    suppliers?: Supplier[];
    offers?: Offer[];
    workLogs?: WorkLog[];
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
    onCreateOrder?: (materialIds: string[], supplierName: string) => void;
    onRefresh?: () => void;
}

type GroupBy = 'none' | 'project' | 'productStatus' | 'materialStatus' | 'supplier';
type ViewMode = 'products' | 'materials' | 'both';

interface OverviewItem {
    type: 'product' | 'material';
    // Product fields
    Product_ID?: string;
    Product_Name?: string;
    Product_Status?: string;
    Product_Quantity?: number;
    // Material fields
    Material_ID?: string;
    Material_Name?: string;
    Material_Status?: string;
    Material_Quantity?: number;
    Material_Unit?: string;
    Material_Supplier?: string;
    // Common fields
    Project_ID: string;
    Project_Name: string;
    Client_Name: string;
    Deadline?: string;
    // Date fields
    RelevantDate?: string;
    DateType?: 'deadline' | 'production' | 'order' | 'received';
    // Profit fields (for products only)
    Selling_Price?: number;
    Material_Cost?: number;
    Labor_Cost?: number;
    Profit?: number;
    Profit_Margin?: number;
}

export default function OverviewTab({ projects, workOrders, orders = [], suppliers = [], offers = [], workLogs = [], showToast, onCreateOrder, onRefresh }: OverviewTabProps) {
    const [groupBy, setGroupBy] = useState<GroupBy>('project');
    const [viewMode, setViewMode] = useState<ViewMode>('both');
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
    const [isFiltersOpen, setIsFiltersOpen] = useState(false);

    // Material selection for orders
    const [selectedMaterials, setSelectedMaterials] = useState<Set<string>>(new Set());
    const [selectedSupplier, setSelectedSupplier] = useState<string>('');

    // Product Timeline Modal
    const [timelineProduct, setTimelineProduct] = useState<OverviewItem | null>(null);

    // Contextual grouping options based on viewMode
    const groupingOptions = useMemo(() => {
        if (viewMode === 'products') {
            return [
                { value: 'project', label: 'Projektu' },
                { value: 'productStatus', label: 'Statusu proizvoda' },
                { value: 'none', label: 'Bez grupiranja' },
            ];
        } else if (viewMode === 'materials') {
            return [
                { value: 'project', label: 'Projektu' },
                { value: 'materialStatus', label: 'Statusu materijala' },
                { value: 'supplier', label: 'Dobavljaču' },
                { value: 'none', label: 'Bez grupiranja' },
            ];
        } else {
            return [
                { value: 'project', label: 'Projektu' },
                { value: 'none', label: 'Bez grupiranja' },
            ];
        }
    }, [viewMode]);

    // Status options for pills
    const statusOptions = useMemo(() => {
        if (viewMode === 'products') {
            return [{ value: '', label: 'Svi' }, { value: 'Na čekanju', label: 'Na čekanju' }, { value: 'U proizvodnji', label: 'U proizvodnji' }, { value: 'Završeno', label: 'Završeno' }];
        } else if (viewMode === 'materials') {
            return [{ value: '', label: 'Svi' }, { value: 'Nije naručeno', label: 'Nije naručeno' }, { value: 'Naručeno', label: 'Naručeno' }, { value: 'Primljeno', label: 'Primljeno' }];
        }
        return [];
    }, [viewMode]);

    // Handler for viewMode change
    const handleViewModeChange = (newMode: ViewMode) => {
        setViewMode(newMode);
        setStatusFilter('');
        if (newMode === 'products' && (groupBy === 'materialStatus' || groupBy === 'supplier')) {
            setGroupBy('project');
        } else if (newMode === 'materials' && groupBy === 'productStatus') {
            setGroupBy('project');
        } else if (newMode === 'both' && groupBy !== 'project' && groupBy !== 'none') {
            setGroupBy('project');
        }
        if (newMode !== 'materials') {
            setSelectedMaterials(new Set());
            setSelectedSupplier('');
        }
    };

    // Helper function to derive product status and date from work orders
    function getProductDetails(productId: string, workOrders: WorkOrder[]): { status: string, date?: string } {
        // Find work orders containing this product
        // We look for the latest work order that involves this product
        const relevantWOs = workOrders.filter(wo =>
            (wo.items || []).some(item => item.Product_ID === productId)
        );

        if (relevantWOs.length === 0) {
            return { status: 'Na čekanju' };
        }

        // Get the most recent work order
        // Assuming the last one in the list is the most recent or we should sort by created date
        const latestWO = relevantWOs.sort((a, b) => new Date(b.Created_Date).getTime() - new Date(a.Created_Date).getTime())[0];
        const latestItem = latestWO.items?.find(item => item.Product_ID === productId);

        if (!latestItem) return { status: 'Na čekanju' };

        // Check process assignments to determine current status
        const assignments = latestItem.Process_Assignments || {};
        const processes = Object.keys(assignments);
        let status = 'Na čekanju';

        if (processes.length > 0) {
            const allCompleted = processes.every(proc => assignments[proc]?.Status === 'Završeno');
            if (allCompleted) {
                status = 'Spremno';
            } else {
                const inProgressProcess = processes.find(proc => assignments[proc]?.Status === 'U toku');
                if (inProgressProcess) {
                    status = inProgressProcess;
                } else {
                    const someCompleted = processes.some(proc => assignments[proc]?.Status === 'Završeno');
                    if (someCompleted) {
                        status = 'U proizvodnji';
                    }
                }
            }
        }

        return {
            status,
            date: latestWO.Created_Date // Date put into production
        };
    }

    // Aggregate all data
    const allItems = useMemo(() => {
        const items: OverviewItem[] = [];

        // Pre-process orders for fast material lookup
        const materialOrdersMap = new Map<string, { orderDate: string, receivedDate?: string, status: string }>();
        if (orders) {
            orders.forEach(order => {
                (order.items || []).forEach(item => {
                    if (item.Product_Material_ID) {
                        // Store the latest info for this material ID
                        // If we have multiple orders for same material ID (e.g. creating same project twice?), might be tricky.
                        // But typically Material ID is unique per project/product instance.
                        materialOrdersMap.set(item.Product_Material_ID, {
                            orderDate: order.Order_Date,
                            receivedDate: item.Received_Date,
                            status: item.Status
                        });
                    }
                });
            });
        }

        projects.forEach(project => {
            // Add products
            if (viewMode === 'products' || viewMode === 'both') {
                (project.products || []).forEach(product => {
                    // Normalize status - only valid values are: Na čekanju, U proizvodnji, Završeno
                    let dbStatus = product.Status || 'Na čekanju';

                    // Map any non-standard status to valid product status
                    if (dbStatus === 'Čeka proizvodnju') {
                        dbStatus = 'Na čekanju';
                    } else if (!['Na čekanju', 'U proizvodnji', 'Završeno'].includes(dbStatus)) {
                        // If status is a process name (like 'Rezanje') or anything else, it means work is in progress
                        dbStatus = 'U proizvodnji';
                    }

                    // But still get date from work orders logic
                    const { date } = getProductDetails(product.Product_ID, workOrders);

                    // Calculate profit from offers and workLogs
                    let sellingPrice: number | undefined;
                    let materialCost: number | undefined;
                    let laborCost: number | undefined;
                    let profit: number | undefined;
                    let profitMargin: number | undefined;

                    // Find OfferProduct from accepted offers and get all cost components
                    const acceptedOffers = offers.filter(o => o.Status === 'Prihvaćeno');
                    let offerRef: Offer | undefined;
                    let offerProductRef: OfferProduct | undefined;

                    for (const offer of acceptedOffers) {
                        const offerProduct = (offer.products || []).find(op => op.Product_ID === product.Product_ID);
                        if (offerProduct) {
                            offerRef = offer;
                            offerProductRef = offerProduct;
                            sellingPrice = offerProduct.Selling_Price || offerProduct.Total_Price;

                            // All cost components
                            materialCost = (offerProduct.Material_Cost || 0);

                            // Add LED cost
                            const ledCost = offerProduct.LED_Total || 0;

                            // Add Grouting cost
                            const groutingCost = offerProduct.Grouting ? (offerProduct.Grouting_Price || 0) : 0;

                            // Add Sink/Faucet cost
                            const sinkCost = offerProduct.Sink_Faucet ? (offerProduct.Sink_Faucet_Price || 0) : 0;

                            // Add extras cost
                            const extrasCost = ((offerProduct as any).extras || []).reduce((sum: number, e: any) =>
                                sum + (e.Total || e.total || 0), 0);

                            // Total material + services cost
                            materialCost = materialCost + ledCost + groutingCost + sinkCost + extrasCost;

                            break;
                        }
                    }

                    // Calculate labor cost from workLogs
                    const productWorkLogs = workLogs.filter(wl => wl.Product_ID === product.Product_ID);
                    if (productWorkLogs.length > 0) {
                        laborCost = productWorkLogs.reduce((sum, wl) => sum + (wl.Daily_Rate || 0), 0);
                    }

                    // Calculate profit if we have selling price
                    if (sellingPrice && sellingPrice > 0) {
                        const matCost = materialCost || 0;
                        const labCost = laborCost || 0;

                        // Calculate proportional transport/discount share
                        let transportShare = 0;
                        let discountShare = 0;

                        if (offerRef && offerProductRef) {
                            const offerSubtotal = offerRef.Subtotal || 0;
                            if (offerSubtotal > 0) {
                                const productRatio = sellingPrice / offerSubtotal;
                                transportShare = (offerRef.Transport_Cost || 0) * productRatio;
                                discountShare = offerRef.Onsite_Assembly ?
                                    (offerRef.Onsite_Discount || 0) * productRatio : 0;
                            }
                        }

                        // Profit = Selling Price - Costs (material + labor)
                        // Transport is a pass-through cost, not included in production profit
                        profit = sellingPrice - matCost - labCost;
                        profitMargin = sellingPrice > 0 ? (profit / sellingPrice) * 100 : 0;
                    }

                    items.push({
                        type: 'product',
                        Product_ID: product.Product_ID,
                        Product_Name: product.Name,
                        Product_Status: dbStatus,
                        Product_Quantity: product.Quantity,
                        Project_ID: project.Project_ID,
                        Project_Name: project.Client_Name,
                        Client_Name: project.Client_Name,
                        Deadline: project.Deadline,
                        RelevantDate: date,
                        DateType: 'production',
                        // Profit fields
                        Selling_Price: sellingPrice,
                        Material_Cost: materialCost,
                        Labor_Cost: laborCost,
                        Profit: profit,
                        Profit_Margin: profitMargin,
                    });
                });
            }

            // Add materials
            if (viewMode === 'materials' || viewMode === 'both') {
                (project.products || []).forEach(product => {
                    (product.materials || []).forEach(material => {
                        // Determine relevant date based on status
                        let relevantDate: string | undefined = undefined;
                        let dateType: 'deadline' | 'order' | 'received' | undefined = undefined;

                        const orderInfo = materialOrdersMap.get(material.ID);

                        if (material.Status === 'Naručeno' && orderInfo) {
                            relevantDate = orderInfo.orderDate;
                            dateType = 'order';
                        } else if ((material.Status === 'Primljeno' || material.Status === 'Na stanju') && orderInfo) {
                            relevantDate = orderInfo.receivedDate || orderInfo.orderDate; // Fallback to order date if received date missing
                            dateType = 'received';
                        }

                        items.push({
                            type: 'material',
                            Material_ID: material.ID,
                            Material_Name: material.Material_Name,
                            Material_Status: material.Status,
                            Material_Quantity: material.Quantity,
                            Material_Unit: material.Unit,
                            Material_Supplier: material.Supplier,
                            Product_ID: product.Product_ID,
                            Product_Name: product.Name,
                            Project_ID: project.Project_ID,
                            Project_Name: project.Client_Name,
                            Client_Name: project.Client_Name,
                            Deadline: project.Deadline,
                            RelevantDate: relevantDate,
                            DateType: dateType
                        });
                    });
                });
            }
        });

        return items;
    }, [projects, viewMode, workOrders, orders]);

    // Filter items
    const filteredItems = useMemo(() => {
        return allItems.filter(item => {
            // Search filter
            if (searchTerm.trim()) {
                const search = searchTerm.toLowerCase();
                const matchesSearch =
                    item.Client_Name.toLowerCase().includes(search) ||
                    item.Product_Name?.toLowerCase().includes(search) ||
                    item.Material_Name?.toLowerCase().includes(search);
                if (!matchesSearch) return false;
            }

            // Status filter
            if (statusFilter) {
                const status = item.type === 'product' ? item.Product_Status : item.Material_Status;
                if (status !== statusFilter) return false;
            }

            return true;
        });
    }, [allItems, searchTerm, statusFilter]);

    // Group items
    const groupedData = useMemo(() => {
        const groups = new Map<string, OverviewItem[]>();

        filteredItems.forEach(item => {
            let groupKey = '';

            switch (groupBy) {
                case 'project':
                    groupKey = item.Project_ID;
                    break;
                case 'productStatus':
                    groupKey = item.type === 'product' ? (item.Product_Status || 'Unknown') : 'N/A';
                    break;
                case 'materialStatus':
                    groupKey = item.type === 'material' ? (item.Material_Status || 'Unknown') : 'N/A';
                    break;
                case 'supplier':
                    groupKey = item.Material_Supplier || 'No Supplier';
                    break;
                default:
                    groupKey = 'all';
            }

            if (!groups.has(groupKey)) {
                groups.set(groupKey, []);
            }
            groups.get(groupKey)!.push(item);
        });

        return Array.from(groups.entries()).map(([key, items]) => ({
            groupKey: key,
            groupLabel: getGroupLabel(key, items[0]),
            items,
            count: items.length,
        }));
    }, [filteredItems, groupBy]);

    function getGroupLabel(key: string, firstItem?: OverviewItem): string {
        if (groupBy === 'project') {
            return firstItem?.Client_Name || key;
        }
        return key;
    }

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

    function getStatusClass(status: string): string {
        const normalized = status.toLowerCase().replace(/\s+/g, '-');
        return 'status-' + normalized
            .replace(/č/g, 'c')
            .replace(/ć/g, 'c')
            .replace(/š/g, 's')
            .replace(/ž/g, 'z')
            .replace(/đ/g, 'd');
    }

    // Material selection functions
    function toggleMaterialSelection(materialId: string, supplierName: string) {
        // When grouped by supplier, only allow selecting from one supplier at a time
        if (selectedSupplier && selectedSupplier !== supplierName) {
            // Switch to new supplier, clear previous selections
            setSelectedMaterials(new Set([materialId]));
            setSelectedSupplier(supplierName);
            return;
        }

        const newSelected = new Set(selectedMaterials);
        if (newSelected.has(materialId)) {
            newSelected.delete(materialId);
            if (newSelected.size === 0) {
                setSelectedSupplier('');
            }
        } else {
            newSelected.add(materialId);
            setSelectedSupplier(supplierName);
        }
        setSelectedMaterials(newSelected);
    }

    function selectAllMaterialsInGroup(items: OverviewItem[], supplierName: string) {
        const materialItems = items.filter(i => i.type === 'material' && i.Material_ID);
        if (materialItems.length === 0) return;

        // If different supplier, switch
        if (selectedSupplier && selectedSupplier !== supplierName) {
            setSelectedMaterials(new Set(materialItems.map(i => i.Material_ID!)));
            setSelectedSupplier(supplierName);
            return;
        }

        // Toggle all in this group
        const allSelected = materialItems.every(i => selectedMaterials.has(i.Material_ID!));
        if (allSelected) {
            const newSelected = new Set(selectedMaterials);
            materialItems.forEach(i => newSelected.delete(i.Material_ID!));
            setSelectedMaterials(newSelected);
            if (newSelected.size === 0) setSelectedSupplier('');
        } else {
            const newSelected = new Set(selectedMaterials);
            materialItems.forEach(i => newSelected.add(i.Material_ID!));
            setSelectedMaterials(newSelected);
            setSelectedSupplier(supplierName);
        }
    }

    // Direct order creation - bypasses wizard
    async function handleDirectOrderCreation() {
        if (selectedMaterials.size === 0 || !selectedSupplier) return;

        // Find supplier info
        const supplier = suppliers.find(s => s.Name === selectedSupplier);

        // Gather material details from projects
        const items: any[] = [];
        let totalAmount = 0;

        for (const project of projects) {
            for (const product of project.products || []) {
                for (const material of product.materials || []) {
                    if (selectedMaterials.has(material.ID)) {
                        items.push({
                            Product_Material_ID: material.ID,
                            Product_ID: product.Product_ID,
                            Product_Name: product.Name,
                            Project_ID: project.Project_ID,
                            Material_Name: material.Material_Name,
                            Quantity: material.Quantity,
                            Unit: material.Unit,
                            Expected_Price: material.Total_Price || 0,
                        });
                        totalAmount += material.Total_Price || 0;
                    }
                }
            }
        }

        if (items.length === 0) {
            showToast('Nema materijala za narudžbu', 'error');
            return;
        }

        try {
            const result = await createOrder({
                Supplier_ID: supplier?.Supplier_ID || '',
                Supplier_Name: selectedSupplier,
                Total_Amount: totalAmount,
                items,
            });

            if (result.success) {
                showToast(`Narudžba ${result.data?.Order_Number} kreirana!`, 'success');
                setSelectedMaterials(new Set());
                setSelectedSupplier('');
                onRefresh?.();
            } else {
                showToast(result.message, 'error');
            }
        } catch (error) {
            console.error('Direct order creation error:', error);
            showToast('Greška pri kreiranju narudžbe', 'error');
        }
    }

    // Legacy function for compatibility
    function handleCreateOrderClick() {
        handleDirectOrderCreation();
    }

    // Check if all selected materials have status 'Naručeno' (for contextual action)
    const selectedMaterialsInfo = useMemo(() => {
        if (selectedMaterials.size === 0) return { allOrdered: false, allUnordered: false };

        let orderedCount = 0;
        let unorderedCount = 0;

        for (const project of projects) {
            for (const product of project.products || []) {
                for (const material of product.materials || []) {
                    if (selectedMaterials.has(material.ID)) {
                        if (material.Status === 'Naručeno') {
                            orderedCount++;
                        } else if (material.Status === 'Nije naručeno') {
                            unorderedCount++;
                        }
                    }
                }
            }
        }

        return {
            allOrdered: orderedCount === selectedMaterials.size && orderedCount > 0,
            allUnordered: unorderedCount === selectedMaterials.size && unorderedCount > 0,
            orderedCount,
            unorderedCount,
        };
    }, [selectedMaterials, projects]);

    // Handle marking materials as received
    async function handleMarkAsReceived() {
        if (selectedMaterials.size === 0) return;

        try {
            const result = await markMaterialsReceived(Array.from(selectedMaterials));
            if (result.success) {
                showToast(`${selectedMaterials.size} materijal(a) označeno kao primljeno!`, 'success');
                setSelectedMaterials(new Set());
                setSelectedSupplier('');
                onRefresh?.();
            } else {
                showToast(result.message, 'error');
            }
        } catch (error) {
            console.error('Mark as received error:', error);
            showToast('Greška pri označavanju materijala', 'error');
        }
    }

    // Check if selection mode is active (only when grouped by supplier)
    const isSelectionMode = groupBy === 'supplier' && (viewMode === 'materials' || viewMode === 'both');

    // Statistics
    const stats = useMemo(() => {
        const productItems = filteredItems.filter(i => i.type === 'product');
        const materialItems = filteredItems.filter(i => i.type === 'material');

        return {
            totalProducts: productItems.length,
            totalMaterials: materialItems.length,
            productsInProduction: productItems.filter(i => i.Product_Status === 'U proizvodnji').length,
            productsWaiting: productItems.filter(i => i.Product_Status === 'Na čekanju').length,
            materialsNotOrdered: materialItems.filter(i => i.Material_Status === 'Nije naručeno').length,
            materialsOrdered: materialItems.filter(i => i.Material_Status === 'Naručeno').length,
            materialsReceived: materialItems.filter(i => i.Material_Status === 'Primljeno').length,
        };
    }, [filteredItems]);



    return (
        <div className="overview-page">
            {/* Page Header */}
            <div className="page-header">
                <div className="header-content">
                    <div className="header-text">
                        <h1>Pregled Proizvodnje</h1>
                        <p>Upravljajte statusima proizvodnje i materijala po projektima.</p>
                    </div>
                    <button
                        className={`filter-toggle ${isFiltersOpen ? 'active' : ''}`}
                        onClick={() => setIsFiltersOpen(!isFiltersOpen)}
                    >
                        <span className="material-icons-round">filter_list</span>
                        <span>{isFiltersOpen ? 'Sakrij pretragu' : 'Pretraga i filteri'}</span>
                        <span className="material-icons-round">{isFiltersOpen ? 'expand_less' : 'expand_more'}</span>
                    </button>
                </div>
            </div>

            {/* Collapsible Control Bar */}
            <div className={`control-bar ${isFiltersOpen ? 'open' : ''}`}>
                <div className="control-bar-inner">
                    <div className="controls-row">
                        {/* Search */}
                        <div className="search-box">
                            <span className="material-icons-round">search</span>
                            <input
                                type="text"
                                placeholder="Pretraži po nazivu..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>

                        <div className="divider"></div>

                        {/* View Mode Tabs */}
                        <div className="view-tabs">
                            <button
                                className={viewMode === 'both' ? 'active' : ''}
                                onClick={() => handleViewModeChange('both')}
                            >
                                Sve
                            </button>
                            <button
                                className={viewMode === 'products' ? 'active' : ''}
                                onClick={() => handleViewModeChange('products')}
                            >
                                <span className="material-icons-round">inventory_2</span>
                                Proizvodi
                            </button>
                            <button
                                className={viewMode === 'materials' ? 'active' : ''}
                                onClick={() => handleViewModeChange('materials')}
                            >
                                <span className="material-icons-round">category</span>
                                Materijali
                            </button>
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

                        {/* Status Pills */}
                        {statusOptions.length > 0 && (
                            <>
                                <div className="divider"></div>
                                <div className="status-pills">
                                    {statusOptions.map(opt => (
                                        <button
                                            key={opt.value}
                                            className={`status-pill ${statusFilter === opt.value ? 'active' : ''}`}
                                            onClick={() => setStatusFilter(opt.value)}
                                        >
                                            {opt.label}
                                        </button>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* Grouped content */}
            < div className="overview-content" >
                {
                    groupedData.length === 0 ? (
                        <div className="empty-state">
                            <span className="material-icons-round">inbox</span>
                            <h3>Nema rezultata</h3>
                            <p>Pokušajte promijeniti filtere</p>
                        </div>
                    ) : (
                        groupedData.map(group => (
                            <div key={group.groupKey} className="group-card">
                                {/* Group Header - Clean single row */}
                                <div
                                    className="group-card-header"
                                    onClick={() => toggleGroup(group.groupKey)}
                                >
                                    <div className="group-left">
                                        <span className="material-icons-round toggle-chevron">
                                            {collapsedGroups.has(group.groupKey) ? 'chevron_right' : 'expand_more'}
                                        </span>
                                        <span className="group-title">{group.groupLabel}</span>
                                        <span className="group-count-badge">{group.count} stavke</span>
                                    </div>
                                    <div className="group-right">
                                        {/* Progress bar removed */}
                                    </div>
                                </div>

                                {/* Items List */}
                                {!collapsedGroups.has(group.groupKey) && (
                                    <div className="group-card-content">
                                        {/* Table Header */}
                                        <div className={`list-header ${isSelectionMode ? 'with-checkbox' : ''}`}>
                                            {isSelectionMode && (
                                                <div className="col-checkbox">
                                                    <input
                                                        type="checkbox"
                                                        checked={group.items.filter(i => i.type === 'material' && i.Material_ID).every(i => selectedMaterials.has(i.Material_ID!))}
                                                        onChange={() => selectAllMaterialsInGroup(group.items, group.groupKey)}
                                                    />
                                                </div>
                                            )}
                                            <div className="col-naziv">NAZIV</div>
                                            <div className="col-kol">KOL.</div>
                                            <div className="col-projekt">PROJEKT</div>
                                            <div className="col-profit">PROFIT</div>
                                            <div className="col-datum">DATUM</div>
                                        </div>

                                        {/* Items */}
                                        {group.items.map((item, idx) => (
                                            <div
                                                key={idx}
                                                className={`list-item ${isSelectionMode ? 'with-checkbox' : ''} ${item.type === 'material' && item.Material_ID && selectedMaterials.has(item.Material_ID) ? 'selected' : ''}`}
                                                onClick={item.type === 'material' && isSelectionMode && item.Material_ID ? () => toggleMaterialSelection(item.Material_ID!, group.groupKey) : undefined}
                                                style={isSelectionMode && item.type === 'material' ? { cursor: 'pointer' } : undefined}
                                            >
                                                {isSelectionMode && (
                                                    <div className="col-checkbox">
                                                        {item.type === 'material' && item.Material_ID && (
                                                            <input
                                                                type="checkbox"
                                                                checked={selectedMaterials.has(item.Material_ID)}
                                                                onChange={() => toggleMaterialSelection(item.Material_ID!, group.groupKey)}
                                                                onClick={(e) => e.stopPropagation()}
                                                            />
                                                        )}
                                                    </div>
                                                )}
                                                <div className="col-naziv">
                                                    <div className={`item-icon ${item.type}`}>
                                                        <span className="material-icons-round">
                                                            {item.type === 'product' ? 'inventory_2' : 'category'}
                                                        </span>
                                                    </div>
                                                    <div className="item-info">
                                                        <span className="item-name">
                                                            {item.type === 'product' ? item.Product_Name : item.Material_Name}
                                                        </span>
                                                        <span className={`item-status ${getStatusClass(item.type === 'product' ? item.Product_Status! : item.Material_Status!)}`}>
                                                            {item.type === 'product' ? item.Product_Status : item.Material_Status}
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className="col-kol">
                                                    <span className="kol-value">{item.type === 'material' ? item.Material_Quantity : (item.Product_Quantity || 1)}</span>
                                                    <span className="kol-unit">{item.type === 'material' ? (item.Material_Unit || 'kom') : 'KOM'}</span>
                                                </div>
                                                <div className="col-projekt">{item.Client_Name}</div>
                                                {/* Profit column - only for products with profit data */}
                                                {item.type === 'product' && item.Profit !== undefined ? (
                                                    <div
                                                        className="col-profit"
                                                        style={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '6px',
                                                            padding: '4px 8px',
                                                            borderRadius: '6px',
                                                            background: item.Profit_Margin! >= 30 ? 'rgba(16, 185, 129, 0.1)' :
                                                                item.Profit_Margin! >= 15 ? 'rgba(245, 158, 11, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                                                            color: item.Profit_Margin! >= 30 ? '#10b981' :
                                                                item.Profit_Margin! >= 15 ? '#f59e0b' : '#ef4444',
                                                            fontWeight: 600,
                                                            fontSize: '12px',
                                                            minWidth: '100px',
                                                            cursor: 'pointer'
                                                        }}
                                                        title="Klikni za detaljan izvještaj"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setTimelineProduct(item);
                                                        }}
                                                    >
                                                        <span className="material-icons-round" style={{ fontSize: '14px' }}>
                                                            {item.Profit_Margin! >= 30 ? 'trending_up' :
                                                                item.Profit_Margin! >= 15 ? 'trending_flat' : 'trending_down'}
                                                        </span>
                                                        {item.Profit.toLocaleString('hr-HR')} KM
                                                        <span style={{ opacity: 0.7, fontSize: '11px' }}>({item.Profit_Margin?.toFixed(0)}%)</span>
                                                    </div>
                                                ) : item.type === 'product' ? (
                                                    <div className="col-profit" style={{
                                                        color: '#9ca3af',
                                                        fontSize: '12px',
                                                        minWidth: '100px'
                                                    }}>
                                                        <span className="material-icons-round" style={{ fontSize: '14px' }}>remove</span>
                                                    </div>
                                                ) : (
                                                    <div className="col-profit" style={{ minWidth: '100px' }}></div>
                                                )}
                                                <div className="col-datum">
                                                    <span className="material-icons-round" style={{
                                                        color: item.DateType === 'received' ? '#10b981' :
                                                            item.DateType === 'order' ? '#3b82f6' :
                                                                item.type === 'product' && item.RelevantDate ? '#f59e0b' : '#9ca3af'
                                                    }}>
                                                        {item.DateType === 'received' ? 'event_available' :
                                                            item.DateType === 'order' ? 'shopping_cart' :
                                                                item.type === 'product' && item.RelevantDate ? 'factory' : 'event'}
                                                    </span>
                                                    <span style={{
                                                        color: item.DateType === 'received' ? '#059669' :
                                                            item.DateType === 'order' ? '#2563eb' :
                                                                item.type === 'product' && item.RelevantDate ? '#d97706' : 'inherit',
                                                        fontWeight: item.RelevantDate ? 500 : 400
                                                    }}>
                                                        {item.RelevantDate ? new Date(item.RelevantDate).toLocaleDateString('hr') : '-'}
                                                    </span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))
                    )
                }
            </div >

            {/* Floating Action Bar for Material Selection */}
            {
                selectedMaterials.size > 0 && (
                    <div className="selection-action-bar">
                        <div className="selection-info">
                            <span className="material-icons-round">check_circle</span>
                            <span>{selectedMaterials.size} materijal(a) odabrano</span>
                            <span className="supplier-badge">{selectedSupplier}</span>
                        </div>
                        <div className="selection-actions">
                            <button
                                className="btn btn-secondary"
                                onClick={() => { setSelectedMaterials(new Set()); setSelectedSupplier(''); }}
                            >
                                Poništi
                            </button>
                            <button
                                className="btn btn-in-stock"
                                onClick={async () => {
                                    for (const matId of Array.from(selectedMaterials)) {
                                        await updateProductMaterial(matId, { Status: 'Na stanju' });
                                    }
                                    showToast(`${selectedMaterials.size} materijal(a) označeno kao "Na stanju"`, 'success');
                                    setSelectedMaterials(new Set());
                                    setSelectedSupplier('');
                                    onRefresh?.();
                                }}
                            >
                                <span className="material-icons-round">inventory</span>
                                Na stanju
                            </button>
                            {/* Contextual Action Button */}
                            {selectedMaterialsInfo.allOrdered ? (
                                <button
                                    className="btn btn-success"
                                    onClick={handleMarkAsReceived}
                                >
                                    <span className="material-icons-round">check_circle</span>
                                    Označi kao primljeno
                                </button>
                            ) : (
                                <button
                                    className="btn btn-primary"
                                    onClick={handleCreateOrderClick}
                                >
                                    <span className="material-icons-round">add_shopping_cart</span>
                                    Kreiraj narudžbu
                                </button>
                            )}
                        </div>
                    </div>
                )
            }

            {/* Product Timeline Modal */}
            <ProductTimelineModal
                isOpen={timelineProduct !== null}
                onClose={() => setTimelineProduct(null)}
                productId={timelineProduct?.Product_ID || ''}
                productName={timelineProduct?.Product_Name || ''}
                workLogs={workLogs.filter(wl => wl.Product_ID === timelineProduct?.Product_ID)}
                sellingPrice={timelineProduct?.Selling_Price}
                materialCost={timelineProduct?.Material_Cost}
                laborCost={timelineProduct?.Labor_Cost}
                profit={timelineProduct?.Profit}
                profitMargin={timelineProduct?.Profit_Margin}
            />

            <style jsx>{`
                /* Overview Page Layout */
                .overview-page {
                    max-width: 100%;
                }

                /* Page Header */
                .page-header {
                    margin-bottom: 24px;
                }

                .header-content {
                    display: flex;
                    flex-direction: column;
                    gap: 16px;
                }

                @media (min-width: 768px) {
                    .header-content {
                        flex-direction: row;
                        align-items: flex-end;
                        justify-content: space-between;
                    }
                }

                .header-text h1 {
                    font-size: 28px;
                    font-weight: 700;
                    color: #111827;
                    margin: 0;
                    letter-spacing: -0.5px;
                }

                .header-text p {
                    color: #6b7280;
                    margin: 4px 0 0 0;
                    font-size: 15px;
                }

                .filter-toggle {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 10px 16px;
                    background: white;
                    border: 1px solid #e5e7eb;
                    border-radius: 10px;
                    font-size: 14px;
                    font-weight: 500;
                    color: #374151;
                    cursor: pointer;
                    transition: all 0.2s;
                    box-shadow: 0 1px 2px rgba(0,0,0,0.05);
                }

                .filter-toggle:hover {
                    background: #f9fafb;
                    border-color: #d1d5db;
                }

                .filter-toggle.active {
                    background: #eff6ff;
                    border-color: #3b82f6;
                    color: #2563eb;
                }

                .filter-toggle .material-icons-round {
                    font-size: 18px;
                }

                /* Control Bar (Unified Toolbar) */
                .control-bar {
                    background: white;
                    border-radius: 12px;
                    /* Hidden state defaults */
                    max-height: 0;
                    opacity: 0;
                    margin-bottom: 0;
                    padding: 0 16px;
                    border: none;
                    overflow: hidden;
                    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                    transform: translateY(-10px);
                }

                .control-bar.open {
                    max-height: 200px; /* Enough for content including wrapping */
                    opacity: 1;
                    margin-bottom: 24px;
                    padding: 8px 16px;
                    border: 1px solid #e5e7eb;
                    box-shadow: 0 1px 2px rgba(0,0,0,0.05);
                    transform: translateY(0);
                }

                .control-bar-inner {
                    width: 100%;
                }

                .controls-row {
                    display: flex;
                    align-items: center;
                    gap: 16px;
                    flex-wrap: nowrap;
                    width: 100%;
                }

                /* Divider */
                .divider {
                    width: 1px;
                    height: 24px;
                    background: #e5e7eb;
                    flex-shrink: 0;
                }

                /* Search Box */
                .search-box {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    flex: 1;
                    min-width: 200px;
                    background: #f9fafb;
                    border-radius: 8px;
                    padding: 8px 12px;
                    transition: all 0.2s;
                }

                .search-box:focus-within {
                    background: #f3f4f6;
                    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
                }

                .search-box .material-icons-round {
                    color: #9ca3af;
                    font-size: 20px;
                }

                .search-box input {
                    border: none;
                    background: transparent;
                    outline: none;
                    flex: 1;
                    font-size: 14px;
                    color: #111827;
                }

                .search-box input::placeholder {
                    color: #9ca3af;
                }

                /* View Tabs (Segmented Control) */
                .view-tabs {
                    display: flex;
                    background: #f3f4f6;
                    padding: 4px;
                    border-radius: 8px;
                    gap: 4px;
                    flex-shrink: 0;
                }

                .view-tabs button {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    padding: 6px 12px;
                    border: none;
                    background: transparent;
                    border-radius: 6px;
                    font-size: 13px;
                    font-weight: 500;
                    color: #6b7280;
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .view-tabs button:hover {
                    color: #111827;
                }

                .view-tabs button.active {
                    background: white;
                    color: #111827;
                    box-shadow: 0 1px 2px rgba(0,0,0,0.05);
                    font-weight: 600;
                }
                
                .view-tabs button .material-icons-round {
                    font-size: 16px;
                }

                /* Group Control */
                .group-control {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    flex-shrink: 0;
                }

                .group-label {
                    font-size: 13px;
                    color: #6b7280;
                    font-weight: 500;
                    white-space: nowrap;
                }

                .group-dropdown {
                    position: relative;
                    display: flex;
                    align-items: center;
                }

                .group-dropdown select {
                    appearance: none;
                    background: #f3f4f6;
                    border: none;
                    border-radius: 8px;
                    padding: 8px 32px 8px 12px;
                    font-size: 13px;
                    font-weight: 600;
                    color: #4b5563;
                    cursor: pointer;
                    outline: none;
                    transition: all 0.2s;
                }

                .group-dropdown select:hover {
                    background: #e5e7eb;
                    color: #111827;
                }

                .group-dropdown .material-icons-round {
                    position: absolute;
                    right: 8px;
                    font-size: 18px;
                    color: #6b7280;
                    pointer-events: none;
                }

                /* Status Pills */
                .status-pills {
                    display: flex;
                    gap: 4px;
                    align-items: center;
                    flex-wrap: nowrap;
                    overflow-x: auto;
                    min-width: 0; /* Enables scrolling in flex container */
                    scrollbar-width: none;
                    -ms-overflow-style: none;
                }
                
                .status-pills::-webkit-scrollbar {
                    display: none;
                }

                .status-pill {
                    padding: 6px 14px;
                    border: none;
                    background: transparent;
                    border-radius: 100px;
                    font-size: 13px;
                    font-weight: 500;
                    color: #6b7280;
                    cursor: pointer;
                    transition: all 0.2s;
                    white-space: nowrap;
                }

                .status-pill:hover {
                    background: #f3f4f6;
                    color: #111827;
                }

                .status-pill.active {
                    background: #2563eb;
                    color: white;
                    font-weight: 600;
                    box-shadow: 0 1px 2px rgba(37, 99, 235, 0.2);
                }

                /* Content Area */
                .overview-content {
                    display: flex;
                    flex-direction: column;
                    gap: 16px;
                }

                /* Group Card Styles */
                .group-card {
                    background: white;
                    border-radius: 16px;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.06), 0 2px 8px rgba(0,0,0,0.04);
                    overflow: hidden;
                    border: 1px solid #e5e7eb;
                }

                .group-card-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 16px 20px;
                    background: #fafafa;
                    border-bottom: 1px solid #e5e7eb;
                    cursor: pointer;
                    transition: background 0.2s;
                }

                .group-card-header:hover {
                    background: #f5f5f5;
                }

                .group-left {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }

                .toggle-chevron {
                    font-size: 20px;
                    color: #6b7280;
                    transition: transform 0.2s;
                }

                .group-title {
                    font-size: 16px;
                    font-weight: 600;
                    color: #111827;
                }

                .group-count-badge {
                    font-size: 12px;
                    font-weight: 500;
                    color: #6b7280;
                    background: #e5e7eb;
                    padding: 4px 10px;
                    border-radius: 20px;
                }

                .group-right {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }



                .group-card-content {
                    padding: 0;
                }

                /* List Header */
                .list-header {
                    display: grid;
                    grid-template-columns: 2.5fr 80px 1.5fr 140px 120px;
                    gap: 16px;
                    padding: 12px 20px;
                    background: #f9fafb;
                    border-bottom: 1px solid #e5e7eb;
                    font-size: 11px;
                    font-weight: 600;
                    color: #6b7280;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }

                .list-header.with-checkbox {
                    grid-template-columns: 40px 2.5fr 80px 1.5fr 140px 120px;
                }

                /* List Item */
                .list-item {
                    display: grid;
                    grid-template-columns: 2.5fr 80px 1.5fr 140px 120px;
                    gap: 16px;
                    padding: 14px 20px;
                    border-bottom: 1px solid #f3f4f6;
                    align-items: center;
                    transition: background 0.15s;
                }

                .list-item.with-checkbox {
                    grid-template-columns: 40px 2.5fr 80px 1.5fr 140px 120px;
                }

                .list-item.selected {
                    background: #eff6ff;
                }

                .list-item:last-child {
                    border-bottom: none;
                }

                .list-item:hover {
                    background: #fafafa;
                }

                .list-item.selected:hover {
                    background: #dbeafe;
                }

                /* Checkbox Column */
                .col-checkbox {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }

                .col-checkbox input[type="checkbox"] {
                    width: 18px;
                    height: 18px;
                    cursor: pointer;
                    accent-color: #3b82f6;
                }

                /* Selection Action Bar */
                /* Selection Action Bar - Apple Style (Compact & Responsive) */
                .selection-action-bar {
                    position: fixed;
                    bottom: 24px;
                    left: 50%;
                    transform: translateX(-50%);
                    background: rgba(255, 255, 255, 0.9);
                    backdrop-filter: blur(20px) saturate(180%);
                    -webkit-backdrop-filter: blur(20px) saturate(180%);
                    padding: 6px 6px 6px 16px;
                    border-radius: 100px;
                    box-shadow: 
                        0 12px 32px rgba(0, 0, 0, 0.12),
                        0 2px 8px rgba(0, 0, 0, 0.04),
                        0 0 0 1px rgba(255, 255, 255, 0.5) inset;
                    display: flex;
                    align-items: center;
                    gap: 16px;
                    z-index: 1000;
                    border: 1px solid rgba(0, 0, 0, 0.08);
                    animation: slideUpFade 0.4s cubic-bezier(0.16, 1, 0.3, 1);
                    max-width: 90vw;
                    white-space: nowrap;
                }

                @media (max-width: 640px) {
                    .selection-action-bar {
                        padding: 6px 6px 6px 12px;
                        gap: 8px;
                        bottom: 20px;
                        width: auto;
                    }
                    
                    .selection-info span:not(.material-icons-round):not(.supplier-badge) {
                        display: none; /* Hide 'x materijala odabrano' text on very small screens */
                    }
                    
                    .selection-info .supplier-badge {
                        display: none; /* Hide supplier name on mobile to save space */
                    }
                    
                    .selection-actions .btn {
                        padding: 0 12px;
                        font-size: 13px;
                    }
                    
                    .selection-actions .btn span:not(.material-icons-round) {
                         /* Keep text but maybe shorten it in logic if needed, or rely on flex shrinking */
                    }
                }

                @keyframes slideUpFade {
                    from { opacity: 0; transform: translate(-50%, 20px); }
                    to { opacity: 1; transform: translate(-50%, 0); }
                }

                .selection-info {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    color: #1d1d1f;
                    font-weight: 500;
                    font-size: 13px;
                    letter-spacing: -0.01em;
                }

                .selection-info .material-icons-round {
                    color: #34c759;
                    font-size: 18px;
                }

                .supplier-badge {
                    background: rgba(0, 0, 0, 0.05);
                    color: #1d1d1f;
                    padding: 2px 8px;
                    border-radius: 99px;
                    font-size: 11px;
                    font-weight: 600;
                    letter-spacing: 0.02em;
                }

                .selection-actions {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                }

                .selection-actions .btn {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    height: 36px;
                    padding: 0 16px;
                    border-radius: 99px;
                    font-size: 13px;
                    font-weight: 500;
                    cursor: pointer;
                    border: none;
                    transition: all 0.2s cubic-bezier(0.25, 1, 0.5, 1);
                    white-space: nowrap;
                }

                /* Cancel Button - Ghost style */
                .selection-actions .btn-secondary {
                    background: transparent;
                    color: #86868b;
                    padding: 0 10px;
                }

                .selection-actions .btn-secondary:hover {
                    color: #1d1d1f;
                    background: rgba(0,0,0,0.05);
                }

                /* In Stock Button */
                .selection-actions .btn-in-stock {
                    background: #30b0c7;
                    color: white;
                    box-shadow: 0 2px 6px rgba(48, 176, 199, 0.2);
                }

                .selection-actions .btn-in-stock:hover {
                    background: #25a3b9;
                    transform: translateY(-1px);
                }

                /* Create Order Button */
                .selection-actions .btn-primary {
                    background: #0071e3;
                    color: white;
                    box-shadow: 0 2px 6px rgba(0, 113, 227, 0.2);
                }

                .selection-actions .btn-primary:hover {
                    background: #0077ed;
                    transform: translateY(-1px);
                }

                .selection-actions .material-icons-round {
                    font-size: 16px;
                }

                .col-naziv {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }

                .item-icon {
                    width: 36px;
                    height: 36px;
                    border-radius: 10px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    flex-shrink: 0;
                }

                .item-icon.product {
                    background: linear-gradient(135deg, #eff6ff, #dbeafe);
                    color: #3b82f6;
                }

                .item-icon.material {
                    background: linear-gradient(135deg, #fef3c7, #fde68a);
                    color: #d97706;
                }

                .item-icon .material-icons-round {
                    font-size: 18px;
                }

                .item-info {
                    display: flex;
                    flex-direction: column;
                    gap: 2px;
                    min-width: 0;
                }

                .item-name {
                    font-size: 14px;
                    font-weight: 500;
                    color: #111827;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                .item-status {
                    font-size: 11px;
                    font-weight: 500;
                    padding: 2px 8px;
                    border-radius: 4px;
                    width: fit-content;
                }

                .item-status.status-na-cekanju {
                    background: #fef3c7;
                    color: #b45309;
                }

                .item-status.status-u-proizvodnji {
                    background: #dbeafe;
                    color: #1d4ed8;
                }

                .item-status.status-zavrseno {
                    background: #dcfce7;
                    color: #15803d;
                }

                .item-status.status-nije-naruceno {
                    background: #fef3c7;
                    color: #b45309;
                }

                .item-status.status-naruceno {
                    background: #e0e7ff;
                    color: #4338ca;
                }

                .item-status.status-primljeno {
                    background: #d1fae5;
                    color: #047857;
                }

                .col-kol {
                    display: flex;
                    align-items: baseline;
                    gap: 4px;
                }

                .kol-value {
                    font-size: 15px;
                    font-weight: 600;
                    color: #111827;
                }

                .kol-unit {
                    font-size: 12px;
                    color: #6b7280;
                    text-transform: uppercase;
                }

                .col-projekt {
                    font-size: 13px;
                    color: #6b7280;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                .col-datum {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    font-size: 13px;
                    color: #6b7280;
                }

                .col-datum .material-icons-round {
                    font-size: 16px;
                    color: #9ca3af;
                }

                /* Empty State */
                .empty-state {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    padding: 60px 20px;
                    text-align: center;
                }

                .empty-state .material-icons-round {
                    font-size: 48px;
                    color: #d1d5db;
                    margin-bottom: 16px;
                }

                .empty-state h3 {
                    font-size: 18px;
                    font-weight: 600;
                    color: #374151;
                    margin: 0 0 8px 0;
                }

                .empty-state p {
                    font-size: 14px;
                    color: #6b7280;
                    margin: 0;
                }

                /* ==================== MOBILE RESPONSIVENESS ==================== */
                
                /* Tablet Breakpoint */
                @media (max-width: 1024px) {
                    .controls-row {
                        flex-wrap: wrap;
                        gap: 12px;
                    }
                    
                    .search-box {
                        min-width: 100%;
                        order: 1;
                    }
                    
                    .divider:first-of-type {
                        display: none;
                    }
                    
                    .view-tabs {
                        order: 2;
                    }
                    
                    .group-control {
                        order: 3;
                    }
                    
                    .status-pills {
                        order: 4;
                        width: 100%;
                        margin-top: 4px;
                    }
                    
                    .control-bar.open {
                        max-height: 300px;
                    }
                }

                /* Mobile Breakpoint */
                @media (max-width: 768px) {
                    /* Page Header */
                    .header-content {
                        gap: 12px;
                    }
                    
                    .header-top {
                        flex-direction: column;
                        align-items: flex-start;
                        gap: 12px;
                    }
                    
                    .page-title {
                        font-size: 22px;
                    }
                    
                    .page-subtitle {
                        font-size: 13px;
                    }
                    
                    .filter-toggle {
                        width: 100%;
                        justify-content: center;
                    }
                    
                    /* Control Bar */
                    .control-bar.open {
                        max-height: 400px;
                        padding: 12px;
                    }
                    
                    .controls-row {
                        flex-direction: column;
                        align-items: stretch;
                        gap: 10px;
                    }
                    
                    .divider {
                        display: none;
                    }
                    
                    .search-box {
                        width: 100%;
                        padding: 10px 12px;
                    }
                    
                    .view-tabs {
                        width: 100%;
                        justify-content: stretch;
                    }
                    
                    .view-tabs button {
                        flex: 1;
                        justify-content: center;
                        padding: 8px 6px;
                        font-size: 12px;
                    }
                    
                    .view-tabs button .material-icons-round {
                        font-size: 16px;
                    }
                    
                    .group-control {
                        width: 100%;
                        justify-content: space-between;
                        background: #f9fafb;
                        padding: 8px 12px;
                        border-radius: 8px;
                    }
                    
                    .group-dropdown {
                        flex: 1;
                    }
                    
                    .group-dropdown select {
                        width: 100%;
                    }
                    
                    .status-pills {
                        width: 100%;
                        justify-content: flex-start;
                        padding: 0;
                        overflow-x: auto;
                        gap: 6px;
                    }
                    
                    .status-pill {
                        padding: 8px 14px;
                        font-size: 12px;
                    }
                    
                    /* Group Cards */
                    .group-card {
                        border-radius: 12px;
                    }
                    
                    .group-card-header {
                        flex-direction: column;
                        align-items: flex-start;
                        gap: 10px;
                        padding: 14px 16px;
                    }
                    
                    .group-right {
                        width: 100%;
                        justify-content: space-between;
                    }
                    
                    .group-title {
                        font-size: 15px;
                    }
                    
                    /* List Header - Hide on Mobile */
                    .list-header {
                        display: none;
                    }
                    
                    /* List Items - Card Layout */
                    .list-item {
                        display: flex;
                        flex-direction: column;
                        gap: 10px;
                        padding: 14px 16px;
                    }
                    
                    .list-item.with-checkbox {
                        display: grid;
                        grid-template-columns: 32px 1fr;
                        grid-template-rows: auto auto;
                        gap: 8px 10px;
                    }
                    
                    .list-item.with-checkbox .col-checkbox {
                        grid-row: 1 / 3;
                        align-self: center;
                    }
                    
                    .list-item.with-checkbox .col-naziv {
                        grid-column: 2;
                        grid-row: 1;
                    }
                    
                    .list-item.with-checkbox .col-kol,
                    .list-item.with-checkbox .col-projekt,
                    .list-item.with-checkbox .col-datum {
                        grid-column: 2;
                    }
                    
                    .col-naziv {
                        width: 100%;
                    }
                    
                    .item-info {
                        flex: 1;
                        min-width: 0;
                    }
                    
                    .item-name {
                        font-size: 15px;
                        white-space: normal;
                        word-break: break-word;
                    }
                    
                    /* Secondary info row */
                    .col-kol, .col-projekt, .col-datum {
                        font-size: 12px;
                        color: #6b7280;
                    }
                    
                    .col-kol {
                        display: inline-flex;
                    }
                    
                    .kol-value {
                        font-size: 13px;
                    }
                    
                    /* Selection Action Bar - Full Width */
                    .selection-action-bar {
                        left: 16px;
                        right: 16px;
                        bottom: 16px;
                        width: auto;
                        max-width: none;
                        transform: none;
                        flex-direction: column;
                        gap: 12px;
                        padding: 14px 16px;
                        border-radius: 12px;
                    }
                    
                    .selection-info {
                        width: 100%;
                        justify-content: center;
                        text-align: center;
                        font-size: 13px;
                    }
                    
                    .selection-actions {
                        width: 100%;
                        justify-content: stretch;
                    }
                    
                    .selection-actions .btn {
                        flex: 1;
                        justify-content: center;
                        padding: 10px 12px;
                        font-size: 13px;
                    }
                    
                    /* Empty State */
                    .empty-state {
                        padding: 40px 20px;
                    }
                    
                    .empty-state .material-icons-round {
                        font-size: 40px;
                    }
                }
                
                /* Small Mobile Breakpoint */
                @media (max-width: 480px) {
                    .page-title {
                        font-size: 20px;
                    }
                    
                    .view-tabs button {
                        padding: 6px 4px;
                        font-size: 11px;
                        gap: 4px;
                    }
                    
                    .view-tabs button .material-icons-round {
                        font-size: 14px;
                    }
                    
                    .group-card-header {
                        padding: 12px 14px;
                    }
                    
                    .list-item {
                        padding: 12px 14px;
                    }
                    
                    .item-icon {
                        width: 32px;
                        height: 32px;
                    }
                    
                    .item-icon .material-icons-round {
                        font-size: 16px;
                    }
                    
                    .selection-action-bar {
                        left: 8px;
                        right: 8px;
                        bottom: 8px;
                    }
                    
                    .supplier-badge {
                        display: none;
                    }
                }

            /* View Mode Tabs */
            .view-mode-tabs {
                display: flex;
                background: var(--surface);
                border-radius: 8px;
                padding: 3px;
                border: 1px solid var(--border-light);
            }

            .tab-btn {
                display: flex;
                align-items: center;
                gap: 4px;
                padding: 5px 10px;
                border: none;
                background: transparent;
                border-radius: 6px;
                font-size: 13px;
                font-weight: 600;
                color: var(--text-secondary);
                cursor: pointer;
                transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                white-space: nowrap;
            }

            .tab-btn .material-icons-round {
                font-size: 16px;
            }

            .tab-btn:hover {
                color: var(--text-primary);
            background: var(--surface-hover);
                }

            .tab-btn.active {
                background: var(--accent);
            color: white;
            box-shadow: 0 2px 8px rgba(0, 113, 227, 0.25);
                }

            .tab-btn.active .material-icons-round {
                color: white;
                }

            /* Group Selector */
            .group-selector {
                display: flex;
                align-items: center;
                gap: 6px;
                background: var(--surface);
                padding: 6px 10px;
                border-radius: 8px;
                border: 1px solid var(--border-light);
            }

            .selector-icon {
                font-size: 16px;
                color: var(--text-secondary);
            }

            .group-selector select {
                border: none;
                background: transparent;
                font-size: 13px;
                font-weight: 600;
                color: var(--text-primary);
                cursor: pointer;
                padding: 2px 20px 2px 4px;
                outline: none;
                appearance: none;
                background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%236e6e73' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
                background-repeat: no-repeat;
                background-position: right 2px center;
                background-size: 14px;
            }

            /* Search Container */
            .search-container {
                display: flex;
                align-items: center;
                gap: 8px;
                background: var(--surface);
                padding: 6px 10px;
                border-radius: 8px;
                border: 1px solid var(--border-light);
                flex: 1;
                max-width: 300px;
                transition: all 0.2s;
            }

            .search-container:focus-within {
                border - color: var(--accent);
            box-shadow: 0 0 0 3px rgba(0, 113, 227, 0.1);
            background: white;
                }

            .search-container .material-icons-round {
                font-size: 16px;
                color: var(--text-tertiary);
            }

            .search-container:focus-within .material-icons-round {
                color: var(--accent);
                }

            .search-container input {
                border: none;
                background: transparent;
                outline: none;
                flex: 1;
                font-size: 13px;
                color: var(--text-primary);
                min-width: 0;
            }

            .search-container input::placeholder {
                color: var(--text-tertiary);
                }

            /* Status Indicators */
            .status-indicators {
                display: flex;
                gap: 8px;
                padding: 8px 16px 12px;
                flex-wrap: wrap;
            }

            .status-chip {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                padding: 5px 10px;
                border-radius: 8px;
                font-size: 12px;
                font-weight: 600;
                border: 1px solid;
                transition: all 0.2s;
            }

            .status-chip .material-icons-round {
                font-size: 16px;
            }

            .chip-count {
                font-size: 14px;
                font-weight: 700;
            }

            .chip-label {
                font-size: 12px;
                font-weight: 600;
            }

            .status-chip.waiting {
                background: #fff8e1;
            border-color: #ffc107;
            color: #f57c00;
                }

            .status-chip.production {
                background: #e3f2fd;
            border-color: #2196f3;
            color: #1976d2;
                }

            .status-chip.alert {
                background: #ffebee;
            border-color: #f44336;
            color: #d32f2f;
                }

            .status-chip.ordered {
                background: #f3e5f5;
            border-color: #9c27b0;
            color: #7b1fa2;
                }

            /* Responsive adjustments */
            @media (max-width: 768px) {
                    .title - section {
                flex - direction: column;
            align-items: flex-start;
                    }

            .filters-container {
                flex - direction: column;
            align-items: stretch;
                    }

            .filters-left {
                flex - direction: column;
            align-items: stretch;
                    }

            .view-mode-tabs {
                width: 100%;
                    }

            .group-selector {
                width: 100%;
                    }

            .group-selector select {
                flex: 1;
                    }

            .search-container {
                max - width: none;
            width: 100%;
                    }

            .status-indicators {
                justify - content: flex-start;
                    }
                }

            .overview-content {
                padding: 16px 24px;
                }

            .group-section {
                background: var(--background);
            border-radius: 12px;
            margin-bottom: 16px;
            overflow: hidden;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
                }

            .group-header {
                padding: 16px 20px;
            background: var(--surface);
            cursor: pointer;
            border-bottom: 1px solid var(--border);
            transition: background 0.2s;
                }

            .group-header:hover {
                background: var(--surface-hover);
                }

            .group-info {
                display: flex;
            align-items: center;
            gap: 12px;
                }

            .group-info h3 {
                font - size: 16px;
            font-weight: 600;
            margin: 0;
            flex: 1;
                }

            .group-count {
                display: inline-flex;
            align-items: center;
            justify-content: center;
            min-width: 24px;
            height: 24px;
            padding: 0 8px;
            background: var(--accent);
            color: white;
            border-radius: 12px;
            font-size: 12px;
            font-weight: 600;
                }

            .group-items {
                padding: 0;
                }

            /* Responsive Table Layout */
            .items-table {
                width: 100%;
                }

            .table-header {
                display: grid;
            grid-template-columns: 100px minmax(200px, 2fr) 70px 60px minmax(150px, 2.5fr) 130px minmax(150px, 1.5fr);
            gap: 12px;
            padding: 16px 24px;
            align-items: center;
            background: var(--surface);
            border-bottom: 1px solid var(--border);
            font-size: 11px;
            font-weight: 700;
            color: var(--text-secondary);
            text-transform: uppercase;
            letter-spacing: 0.5px;
                }

            .table-row {
                display: grid;
            grid-template-columns: 100px minmax(200px, 2fr) 70px 60px minmax(150px, 2.5fr) 130px minmax(150px, 1.5fr);
            gap: 12px;
            padding: 16px 24px;
            align-items: center;
            border-bottom: 1px solid var(--border-light);
            transition: background 0.15s;
            font-size: 14px; /* Uniform base size */
                }

            .col-type {
                display: flex;
            align-items: center;
                }

            .col-qty {
                font - size: 14px;
            font-weight: 500;
            font-variant-numeric: tabular-nums;
            color: var(--text-primary);
            text-align: right;
                }

            .col-unit {
                font - size: 14px;
            color: var(--text-secondary);
            text-align: left;
            padding-left: 4px;
                }

            /* Header alignments must match row alignments */
            .table-header .col-qty {
                text - align: right;
            font-size: 11px;
            font-weight: 700;
                }

            .table-header .col-unit {
                text - align: left;
            padding-left: 4px;
            font-size: 11px;
            font-weight: 700;
                }

            /* Ensure other text columns align left */
            .col-name, .col-project, .col-details {text - align: left; }

            /* Mobile Components Hidden by Default */
            .mobile-only {display: none; }

            /* Mobile Responsive Styles */
            @media (max-width: 1100px) {
                    .desktop - only {display: none !important; }
            .mobile-only {display: block; }

            .items-table {
                display: flex;
            flex-direction: column;
            gap: 12px;
                    }

            .table-header {display: none; }

            .table-row {
                display: flex;
            flex-direction: column;
            align-items: flex-start;
            padding: 16px;
            gap: 12px;
            background: var(--surface);
            border: 1px solid var(--border-light);
            border-radius: 12px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.02);
            font-size: 15px; 
                    }

            /* Group Section Redesign */
            .group-section {
                background: white;
                border-radius: 16px;
                margin-bottom: 16px;
                overflow: hidden;
                box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
                border: 1px solid var(--border-light);
                transition: box-shadow 0.2s;
            }

            .group-section:hover {
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.06);
            }

            .group-header {
                padding: 16px 20px;
                background: var(--surface);
                cursor: pointer;
                border-bottom: 1px solid var(--border-light);
                display: flex;
                align-items: center;
                justify-content: space-between;
                transition: background 0.2s;
            }

            .group-header:hover {
                background: #f1f5f9;
            }

            .group-info {
                display: flex;
                align-items: center;
                gap: 12px;
            }

            .toggle-icon {
                display: flex;
                align-items: center;
                justify-content: center;
                width: 28px;
                height: 28px;
                background: white;
                border-radius: 8px;
                border: 1px solid var(--border-light);
                color: var(--text-secondary);
                transition: all 0.2s;
            }

            .group-header:hover .toggle-icon {
                border-color: var(--accent);
                color: var(--accent);
            }

            .toggle-icon .material-icons-round {
                font-size: 20px;
            }

            .group-info h3 {
                margin: 0;
                font-size: 15px;
                font-weight: 700;
                color: var(--text-primary);
            }

            .desktop-count-badge {
                padding: 2px 8px;
                background: white;
                border: 1px solid var(--border-light);
                border-radius: 12px;
                font-size: 11px;
                font-weight: 600;
                color: var(--text-secondary);
            }

            .mobile-meta {
                display: none;
                flex-direction: row;
                align-items: center;
                gap: 6px;
                font-size: 12px;
                color: var(--text-secondary);
                margin-top: 2px;
            }

            .dot {
                font-weight: 900;
                font-size: 10px;
                opacity: 0.5;
            }

            .group-progress {
                display: flex;
                align-items: center;
                gap: 12px;
            }

            .progress-bar {
                width: 120px;
                height: 6px;
                background: var(--border-light);
                border-radius: 10px;
                overflow: hidden;
            }

            .progress-fill {
                height: 100%;
                background: #f59e0b; /* Orange for progress */
                border-radius: 10px;
                transition: width 0.5s ease-in-out;
            }

            .progress-text {
                font-size: 12px;
                font-weight: 600;
                color: var(--text-secondary);
                min-width: 65px;
                text-align: right;
            }

            /* Table Styles */
            .items-table {
                width: 100%;
            }

            .table-header {
                display: grid;
                grid-template-columns: 80px 3fr 60px 60px 2fr 120px 1.5fr;
                gap: 16px;
                padding: 12px 24px;
                background: white;
                border-bottom: 1px solid var(--border-light);
                font-size: 11px;
                font-weight: 700;
                color: var(--text-tertiary);
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }

            .table-row {
                display: grid;
                grid-template-columns: 80px 3fr 60px 60px 2fr 120px 1.5fr;
                gap: 16px;
                padding: 14px 24px;
                align-items: center;
                border-bottom: 1px solid var(--border-light);
                transition: background 0.2s;
            }

            .table-row:last-child {
                border-bottom: none;
            }

            .table-row:hover {
                background: #f8fafc; /* Very light blue/gray hover */
            }

            .col-type .type-badge {
                display: flex;
                align-items: center;
                justify-content: center;
                width: 36px;
                height: 36px;
                border-radius: 10px;
                color: white;
            }

            .type-badge.product {
                background: #e3f2fd;
                color: var(--accent);
            }

            .type-badge.material {
                background: #f3e5f5;
                color: #9c27b0;
            }

            .col-type .material-icons-round {
                font-size: 20px;
            }

            .col-name {
                display: flex;
                flex-direction: column;
                justify-content: center;
                min-width: 0; 
            }

            .col-name strong {
                font-size: 14px;
                font-weight: 600;
                color: var(--text-primary);
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            .col-name small {
                font-size: 12px;
                color: var(--text-tertiary);
                margin-top: 2px;
            }

            .col-qty, .col-unit {
                display: flex;
                flex-direction: column;
                justify-content: center;
            }

            .qty-val {
                font-size: 14px;
                font-weight: 700;
                color: var(--text-primary);
            }

            .unit-val {
                font-size: 11px;
                text-transform: uppercase;
                font-weight: 600;
                color: var(--text-tertiary);
            }

            .col-project {
                display: flex;
                flex-direction: column;
                font-size: 13px;
                font-weight: 500;
                color: var(--text-secondary);
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            .col-project .deadline {
                display: flex;
                align-items: center;
                gap: 4px;
                font-size: 11px;
                color: var(--text-tertiary);
                margin-top: 2px;
            }

            .col-project .material-icons-round {
                font-size: 12px;
            }

            .status-badge {
                display: inline-flex;
                align-items: center;
                padding: 4px 8px;
                border-radius: 6px;
                font-size: 11px;
                font-weight: 600;
                white-space: nowrap;
            }

            .status-badge.waiting { background: #fff8e1; color: #f57c00; border: 1px solid #ffe0b2; }
            .status-badge.production { background: #e3f2fd; color: #1976d2; border: 1px solid #bbdefb; }
            .status-badge.alert { background: #ffebee; color: #d32f2f; border: 1px solid #ffcdd2; }
            .status-badge.ordered { background: #f3e5f5; color: #7b1fa2; border: 1px solid #e1bee7; }
            .status-badge.received { background: #e8f5e9; color: #2e7d32; border: 1px solid #c8e6c9; }
            .status-badge.done { background: #f0fdf4; color: #16a34a; border: 1px solid #bbf7d0; }

            .col-details span.supplier {
                display: flex;
                align-items: center;
                gap: 6px;
                font-size: 12px;
                color: var(--text-secondary);
                background: var(--surface);
                padding: 4px 8px;
                border-radius: 6px;
                max-width: fit-content;
            }

            .col-details .material-icons-round {
                font-size: 14px;
                color: var(--text-tertiary);
            }

            /* Responsive Design */
            @media (max-width: 768px) {
                .desktop-only {
                    display: none !important;
                }

                .mobile-only {
                    display: flex !important;
                }

                .mobile-meta {
                    display: flex;
                }

                .group-header {
                    padding: 12px 16px;
                }

                .group-title-wrapper {
                    flex: 1;
                    min-width: 0;
                }

                .table-row {
                    grid-template-columns: 1fr auto auto; /* Name, Qty, Chevron/Actions */
                    gap: 12px;
                    padding: 12px 16px;
                }

                .col-name strong {
                    font-size: 13px;
                }

                .status-text {
                    font-weight: 500;
                }
                
                .status-text.status-ceka { color: #f57c00; }
                .status-text.status-u-proizvodnji { color: #1976d2; }
                .status-text.status-nije-naruceno { color: #d32f2f; }
                
                .col-qty {
                    align-items: flex-end;
                }
                
                .items-table {
                    border-top: 1px solid var(--border-light);
                }
            }  @media (max-width: 900px) {
                    .overview - header {
                padding: 16px;
                    }

            .overview-title-bar {
                display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
                    }

            .mobile-filter-toggle {
                display: flex;
            align-items: center;
            gap: 6px;
            padding: 6px 12px;
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 8px;
            font-size: 13px;
            font-weight: 600;
            color: var(--text-primary);
            cursor: pointer;
                    }

            .mobile-filters-summary {
                display: flex;
            gap: 8px;
            overflow-x: auto;
            padding-bottom: 4px;
            margin-bottom: 12px;
                    }

            .summary-pill {
                font - size: 12px;
            padding: 4px 10px;
            background: var(--surface);
            border-radius: 12px;
            color: var(--text-secondary);
            white-space: nowrap;
            border: 1px solid var(--border-light);
                    }

            .summary-pill.active {
                background: var(--accent-light);
            color: var(--accent);
            border-color: var(--accent-light);
                    }

            .overview-controls {
                display: none; /* Hidden by default on mobile */
                    }

            .overview-controls.open {
                display: flex; /* Show when open */
            flex-direction: column;
            gap: 12px;
            margin-bottom: 16px;
            padding-top: 12px;
            border-top: 1px solid var(--border-light);
            animation: slideDown 0.2s ease-out;
                    }

            @keyframes slideDown {
                from {opacity: 0; transform: translateY(-10px); }
            to {opacity: 1; transform: translateY(0); }
                    }

            .header-top {
                flex - direction: column;
            align-items: flex-start;
            gap: 12px;
            margin-bottom: 16px;
                    }

            .header-stats {
                flex - direction: column;
            width: 100%;
            gap: 8px;
                    }

            .stat-pill {
                font - size: 13px;
            padding: 6px 12px;
                    }

            .controls-row {
                flex - direction: column;
            align-items: stretch;
            gap: 12px;
            margin-bottom: 12px;
                    }

            .control-group {
                flex - direction: column;
            align-items: stretch;
            gap: 6px;
                    }

            .control-group label {
                font - size: 12px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.5px;
                    }

            .search-box {
                max - width: 100%;
                    }

            .button-group {
                width: 100%;
                    }

            .button-group button {
                flex: 1;
                    }

            .quick-stats {
                flex - direction: column;
            gap: 8px;
                    }

            .stat-badge {
                justify - content: flex-start;
            padding: 8px 12px;
                    }

            .table-header {
                display: none;
                    }

            .table-row {
                grid - template - columns: 1fr;
            gap: 8px;
            padding: 16px 20px;
                    }

            .col-type,
            .col-name,
            .col-project,
            .col-status,
            .col-details {
                display: flex;
            flex-direction: column;
                    }
                }

            @media (max-width: 600px) {
                    .overview - header {
                padding: 12px;
                    }

            .header-top h2 {
                font - size: 20px;
                    }

            .controls-row {
                gap: 10px;
                    }

            .overview-content {
                padding: 12px;
                    }

            .group-section {
                margin - bottom: 12px;
                    }
                }
            `}</style>
        </div >
    );
}
