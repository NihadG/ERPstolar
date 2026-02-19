'use client';

import { useState, useMemo, useEffect } from 'react';
import type { WorkOrder, Project, Worker } from '@/lib/types';
import { createWorkOrder, deleteWorkOrder, startWorkOrder, getWorkOrder, updateWorkOrder } from '@/lib/database';
import { repairAllProductStatuses, validateWorkOrderProfitData, checkMissingAttendanceForActiveOrders, recalculateWorkOrder, startWorkOrderItem, completeWorkOrderItem, assignWorkersToItem, syncProjectStatus } from '@/lib/attendance';
import { useData } from '@/context/DataContext';
import Modal from '@/components/ui/Modal';
import WorkOrderExpandedDetail from '@/components/ui/WorkOrderExpandedDetail';
import WorkOrderPrintTemplate from '@/components/ui/WorkOrderPrintTemplate';
import ProfitOverviewWidget from '@/components/ui/ProfitOverviewWidget';
import PlanVsActualCard from '@/components/ui/PlanVsActualCard';
import PriceEditModal from '@/components/ui/PriceEditModal';
import AttendanceFixModal from '@/components/ui/AttendanceFixModal';
import { WORK_ORDER_STATUSES, PRODUCTION_STEPS, MONTAZA_STEPS } from '@/lib/types';
import type { WorkOrderType } from '@/lib/types';
import MobileWorkOrdersView from './mobile/MobileWorkOrdersView';

interface ProductionTabProps {
    workOrders: WorkOrder[];
    projects: Project[];
    workers: Worker[];
    onRefresh: (...collections: string[]) => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

interface ProductSelection {
    Product_ID: string;
    Product_Name: string;
    Project_ID: string;
    Project_Name: string;
    Quantity: number;
    Work_Order_Quantity: number;
    Unit_Price?: number;          // Product price from offer
    Material_Cost?: number;       // Sum of material costs
    Status: string;
    assignments: Record<string, string>;
    helperAssignments: Record<string, string[]>;
    Source_Work_Order_ID?: string; // For montaža: links to original production order
}

export default function ProductionTab({ workOrders, projects, workers, onRefresh, showToast }: ProductionTabProps) {
    const { organizationId } = useData();
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [projectSearch, setProjectSearch] = useState('');
    const [profitModalWorkOrder, setProfitModalWorkOrder] = useState<WorkOrder | null>(null);

    // S16: Proactive attendance notification state
    const [attendanceWarnings, setAttendanceWarnings] = useState<{
        warnings: { Worker_ID: string; Worker_Name: string; Work_Order_ID: string; Work_Order_Name: string; Item_Name: string; Date: string }[];
        missingCount: number;
        totalAssigned: number;
    } | null>(null);
    const [attendanceBannerDismissed, setAttendanceBannerDismissed] = useState(false);
    const [priceEditWorkOrder, setPriceEditWorkOrder] = useState<WorkOrder | null>(null);
    const [attendanceFixWorkOrder, setAttendanceFixWorkOrder] = useState<WorkOrder | null>(null);

    // Check attendance on mount and when workOrders change
    useEffect(() => {
        if (!organizationId) return;

        // Only check if there are active work orders
        const hasActiveOrders = workOrders.some(wo => wo.Status === 'U toku');
        if (!hasActiveOrders) {
            setAttendanceWarnings(null);
            return;
        }

        checkMissingAttendanceForActiveOrders(organizationId)
            .then(result => {
                if (result.missingCount > 0) {
                    setAttendanceWarnings(result);
                    setAttendanceBannerDismissed(false); // Re-show on new warnings
                } else {
                    setAttendanceWarnings(null);
                }
            })
            .catch(err => console.error('Attendance check failed:', err));
    }, [organizationId, workOrders]);

    const sortedProjects = useMemo(() => {
        let filtered = projects;

        // S2.5: Hide finished/cancelled projects from wizard
        filtered = filtered.filter(p => {
            if (p.Status === 'Završeno' || p.Status === 'Otkazano') return false;
            // Also hide if all products are completed
            const prods = p.products || [];
            if (prods.length > 0 && prods.every(pr => pr.Status === 'Spremno' || pr.Status === 'Instalirano')) return false;
            return true;
        });

        // 1. Search Filter
        if (projectSearch.trim()) {
            const search = projectSearch.toLowerCase();
            filtered = filtered.filter(p => p.Client_Name.toLowerCase().includes(search));
        }

        // 2. Sorting Logic
        return [...filtered].sort((a, b) => {
            // Helper to get stats
            const getStats = (p: Project) => {
                const products = p.products || [];
                const allFinished = products.length > 0 && products.every(prod => prod.Status === 'Spremno' || prod.Status === 'Instalirano');

                let readyMaterials = 0;
                let totalMaterials = 0;

                products.forEach(prod => {
                    (prod.materials || []).forEach(mat => {
                        totalMaterials++;
                        // Consider 'Primljeno', 'Na stanju' as ready/available
                        if (['Primljeno', 'Na stanju'].includes(mat.Status)) {
                            readyMaterials++;
                        }
                    });
                });

                return { allFinished, readyMaterials };
            };

            const statsA = getStats(a);
            const statsB = getStats(b);

            // Priority 1: Projects that are NOT fully finished come first
            if (statsA.allFinished !== statsB.allFinished) {
                return statsA.allFinished ? 1 : -1; // Finished projects go to bottom
            }

            // Priority 2: More ready materials comes first
            return statsB.readyMaterials - statsA.readyMaterials;
        });
    }, [projects, projectSearch]);

    // Grouping State
    type GroupBy = 'none' | 'status' | 'project' | 'date' | 'worker';
    const [groupBy, setGroupBy] = useState<GroupBy>('none');
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

    const groupingOptions = [
        { value: 'none', label: 'Bez grupisanja' },
        { value: 'status', label: 'Po statusu' },
        { value: 'project', label: 'Po projektu' },
        { value: 'date', label: 'Po datumu' },
        { value: 'worker', label: 'Po radniku' }
    ];

    // Filter Logic
    const filteredWorkOrders = workOrders.filter(wo => {
        const matchesSearch = wo.Work_Order_Number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            wo.Name?.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesStatus = !statusFilter || wo.Status === statusFilter;
        return matchesSearch && matchesStatus;
    });

    // Grouping Logic
    const groupedWorkOrders = useMemo(() => {
        if (groupBy === 'none') return [];

        const groups: Record<string, { key: string; label: string; count: number; totalValue: number; items: WorkOrder[] }> = {};

        filteredWorkOrders.forEach(wo => {
            // For worker grouping, one order can appear in multiple groups
            if (groupBy === 'worker') {
                const workerIds = new Set<string>();
                wo.items?.forEach(item => {
                    // Check new Processes field first
                    if (item.Processes) {
                        item.Processes.forEach(p => {
                            if (p.Worker_ID) workerIds.add(p.Worker_ID);
                        });
                    }
                    // Fallback to legacy assignments
                    else {
                        Object.values(item.Process_Assignments || {}).forEach(assignment => {
                            if (assignment.Worker_ID) workerIds.add(assignment.Worker_ID);
                            assignment.Helpers?.forEach((h: { Worker_ID: string; Worker_Name: string }) => workerIds.add(h.Worker_ID));
                        });
                    }
                });

                if (workerIds.size === 0) {
                    // No workers assigned
                    const key = 'unassigned';
                    if (!groups[key]) {
                        groups[key] = { key, label: 'Nedodijeljeno', count: 0, totalValue: 0, items: [] };
                    }
                    groups[key].items.push(wo);
                    groups[key].count++;
                    groups[key].totalValue += wo.Total_Value || 0;
                } else {
                    workerIds.forEach(workerId => {
                        const worker = workers.find(w => w.Worker_ID === workerId);
                        const key = workerId;
                        const label = worker?.Name || 'Nepoznat';
                        if (!groups[key]) {
                            groups[key] = { key, label, count: 0, totalValue: 0, items: [] };
                        }
                        if (!groups[key].items.some(i => i.Work_Order_ID === wo.Work_Order_ID)) {
                            groups[key].items.push(wo);
                            groups[key].count++;
                            groups[key].totalValue += wo.Total_Value || 0;
                        }
                    });
                }
                return;
            }

            let key = '';
            let label = '';

            switch (groupBy) {
                case 'status':
                    key = wo.Status || 'Ostalo';
                    label = key;
                    break;
                case 'project':
                    key = wo.items?.[0]?.Project_ID || 'unknown';
                    label = wo.items?.[0]?.Project_Name || 'Nepoznat projekat';
                    break;
                case 'date':
                    key = wo.Created_Date ? wo.Created_Date.split('T')[0] : 'unknown';
                    label = wo.Created_Date ? formatDate(wo.Created_Date) : 'Nepoznat datum';
                    break;
            }

            if (!groups[key]) {
                groups[key] = { key, label, count: 0, totalValue: 0, items: [] };
            }
            groups[key].items.push(wo);
            groups[key].count++;
            groups[key].totalValue += wo.Total_Value || 0;
        });

        // Sort groups
        return Object.values(groups).sort((a, b) => {
            if (groupBy === 'date') return b.key.localeCompare(a.key);
            if (groupBy === 'status') {
                return WORK_ORDER_STATUSES.indexOf(a.key) - WORK_ORDER_STATUSES.indexOf(b.key);
            }
            if (groupBy === 'worker') {
                // Sort by total value descending (most productive first)
                return b.totalValue - a.totalValue;
            }
            return a.label.localeCompare(b.label);
        });
    }, [filteredWorkOrders, groupBy, workers]);

    function toggleGroup(groupKey: string) {
        const newCollapsed = new Set(collapsedGroups);
        if (newCollapsed.has(groupKey)) {
            newCollapsed.delete(groupKey);
        } else {
            newCollapsed.add(groupKey);
        }
        setCollapsedGroups(newCollapsed);
    }

    // Create Modal State
    const [createModal, setCreateModal] = useState(false);
    const [activeStep, setActiveStep] = useState(0); // 0: Projects, 1: Products, 2: Processes, 3: Details
    const [wizardMode, setWizardMode] = useState<'production' | 'montaza'>('production');

    // Data State
    const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
    const [selectedProducts, setSelectedProducts] = useState<ProductSelection[]>([]);
    const [selectedProcesses, setSelectedProcesses] = useState<string[]>(['Priprema', 'Sklapanje', 'Farbanje', 'Montaža']);
    const [customProcessInput, setCustomProcessInput] = useState('');
    const [dueDate, setDueDate] = useState('');
    const [notes, setNotes] = useState('');
    const [productSearch, setProductSearch] = useState('');

    // Worker search dropdown state for step 4
    const [openDropdown, setOpenDropdown] = useState<string | null>(null);
    const [workerSearch, setWorkerSearch] = useState('');

    // Expansion State
    const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
    const [currentWorkOrderForPrint, setCurrentWorkOrderForPrint] = useState<WorkOrder | null>(null);

    function toggleWorkOrder(id: string) {
        setExpandedOrderId(prev => prev === id ? null : id);
    }

    // Print Modal
    const [printModal, setPrintModal] = useState(false);

    // Delete Confirmation Modal
    const [deleteConfirmModal, setDeleteConfirmModal] = useState<{
        isOpen: boolean;
        workOrderId: string | null;
        workOrderNumber: string;
    }>({ isOpen: false, workOrderId: null, workOrderNumber: '' });
    const eligibleProducts = useMemo(() => {
        let products: any[] = [];
        projects.forEach(project => {
            if (selectedProjectIds.length > 0 && !selectedProjectIds.includes(project.Project_ID)) return;
            (project.products || []).forEach(product => {
                // Calculate quantity already used in work orders
                let usedQuantity = 0;
                workOrders.forEach(wo => {
                    if (wo.Status === 'Otkazano') return; // Skip cancelled orders
                    wo.items?.forEach(item => {
                        if (item.Product_ID === product.Product_ID) {
                            usedQuantity += item.Quantity || 0;
                        }
                    });
                });

                const totalQuantity = product.Quantity || 1;
                const availableQuantity = totalQuantity - usedQuantity;

                // Only include products with remaining quantity
                if (availableQuantity > 0) {
                    products.push({
                        Product_ID: product.Product_ID,
                        Product_Name: product.Name,
                        Project_ID: project.Project_ID,
                        Project_Name: project.Client_Name,
                        Quantity: availableQuantity,  // Show available, not total
                        TotalQuantity: totalQuantity,
                        UsedQuantity: usedQuantity,
                        Status: product.Status,
                    });
                }
            });
        });

        if (productSearch.trim()) {
            const search = productSearch.toLowerCase();
            products = products.filter(p =>
                p.Product_Name.toLowerCase().includes(search) ||
                p.Project_Name.toLowerCase().includes(search)
            );
        }
        return products;
    }, [projects, selectedProjectIds, productSearch, workOrders]);

    // Montaža: Eligible products are those with status 'Spremno' across ALL projects
    const eligibleMontazaProducts = useMemo(() => {
        let products: any[] = [];
        projects.forEach(project => {
            (project.products || []).forEach(product => {
                if (product.Status !== 'Spremno') return;

                // Check not already in an active montaža work order
                const alreadyInMontaza = workOrders.some(wo =>
                    wo.Work_Order_Type === 'Montaža' &&
                    wo.Status !== 'Otkazano' &&
                    wo.Status !== 'Završeno' &&
                    wo.items?.some(item => item.Product_ID === product.Product_ID)
                );
                if (alreadyInMontaza) return;

                // Find source work order for this product
                const sourceWO = workOrders.find(wo =>
                    wo.Work_Order_Type !== 'Montaža' &&
                    wo.items?.some(item => item.Product_ID === product.Product_ID)
                );

                products.push({
                    Product_ID: product.Product_ID,
                    Product_Name: product.Name,
                    Project_ID: project.Project_ID,
                    Project_Name: project.Client_Name,
                    Quantity: product.Quantity || 1,
                    TotalQuantity: product.Quantity || 1,
                    UsedQuantity: 0,
                    Status: product.Status,
                    Source_Work_Order_ID: sourceWO?.Work_Order_ID,
                    Source_Work_Order_Number: sourceWO?.Work_Order_Number,
                });
            });
        });

        if (productSearch.trim()) {
            const search = productSearch.toLowerCase();
            products = products.filter(p =>
                p.Product_Name.toLowerCase().includes(search) ||
                p.Project_Name.toLowerCase().includes(search)
            );
        }
        return products;
    }, [projects, productSearch, workOrders]);

    function getStatusClass(status: string): string {
        return 'status-' + status.toLowerCase().replace(/\s+/g, '-').replace(/č/g, 'c').replace(/ć/g, 'c').replace(/š/g, 's').replace(/ž/g, 'z').replace(/đ/g, 'd');
    }

    function formatDate(dateString: string): string {
        if (!dateString) return '-';
        return new Date(dateString).toLocaleDateString('hr-HR');
    }

    function openCreateModal() {
        setWizardMode('production');
        setSelectedProcesses(['Rezanje', 'Kantiranje', 'Bušenje', 'Sklapanje']);
        setSelectedProducts([]);
        setDueDate('');
        setNotes('');
        setProductSearch('');
        setSelectedProjectIds([]);
        setActiveStep(0);
        setCreateModal(true);
    }

    function openMontazaModal() {
        setWizardMode('montaza');
        setSelectedProcesses([...MONTAZA_STEPS]);
        setSelectedProducts([]);
        setDueDate('');
        setNotes('');
        setProductSearch('');
        setSelectedProjectIds([]);
        setActiveStep(0);  // Step 0 = Odabir Spremnih proizvoda
        setCreateModal(true);
    }

    // Step Logic — montaža has 3 steps (no project selection), production has 4
    const montazaSteps = [
        { id: 0, title: 'Proizvodi', subtitle: 'Odaberite spremne proizvode' },
        { id: 1, title: 'Procesi', subtitle: 'Definišite procese montaže' },
        { id: 2, title: 'Dodjela', subtitle: 'Raspored radnika' }
    ];

    const productionSteps = [
        { id: 0, title: 'Projekti', subtitle: 'Odaberite projekat' },
        { id: 1, title: 'Proizvodi', subtitle: 'Odaberite proizvode' },
        { id: 2, title: 'Procesi', subtitle: 'Definišite procese' },
        { id: 3, title: 'Dodjela', subtitle: 'Raspored radnika' }
    ];

    const steps = wizardMode === 'montaza' ? montazaSteps : productionSteps;
    const lastStep = steps[steps.length - 1].id;

    const canGoNext = useMemo(() => {
        if (wizardMode === 'montaza') {
            if (activeStep === 0) return selectedProducts.length > 0;
            if (activeStep === 1) return selectedProcesses.length > 0;
            return true;
        }
        // Production mode
        if (activeStep === 0) return selectedProjectIds.length > 0;
        if (activeStep === 1) return selectedProducts.length > 0;
        if (activeStep === 2) return selectedProcesses.length > 0;
        return true;
    }, [activeStep, selectedProjectIds, selectedProducts, selectedProcesses, wizardMode]);

    function handleNext() {
        if (activeStep < lastStep && canGoNext) setActiveStep(activeStep + 1);
    }

    function handleBack() {
        if (activeStep > 0) setActiveStep(activeStep - 1);
    }

    // Selection Logic
    function toggleProjectSelection(projectId: string) {
        if (selectedProjectIds.includes(projectId)) {
            setSelectedProjectIds(selectedProjectIds.filter(id => id !== projectId));
            setSelectedProducts(selectedProducts.filter(p => p.Project_ID !== projectId));
        } else {
            setSelectedProjectIds([...selectedProjectIds, projectId]);
        }
    }

    function toggleProduct(product: any) {
        const exists = selectedProducts.find(p => p.Product_ID === product.Product_ID);
        if (exists) {
            setSelectedProducts(selectedProducts.filter(p => p.Product_ID !== product.Product_ID));
        } else {
            const newProduct: ProductSelection = {
                ...product,
                Work_Order_Quantity: product.Quantity || 1,
                assignments: {},
                helperAssignments: {}
            };
            selectedProcesses.forEach(proc => {
                newProduct.assignments[proc] = '';
                newProduct.helperAssignments[proc] = [];
            });
            setSelectedProducts([...selectedProducts, newProduct]);
        }
    }

    function selectAllProducts() {
        const newProducts: ProductSelection[] = eligibleProducts.map(p => ({
            ...p,
            Work_Order_Quantity: p.Quantity || 1,
            assignments: selectedProcesses.reduce((acc: Record<string, string>, proc) => ({ ...acc, [proc]: '' }), {}),
            helperAssignments: selectedProcesses.reduce((acc: Record<string, string[]>, proc) => ({ ...acc, [proc]: [] }), {}),
        }));
        setSelectedProducts(newProducts);
    }

    function toggleProcess(process: string) {
        if (selectedProcesses.includes(process)) {
            setSelectedProcesses(selectedProcesses.filter(p => p !== process));
            setSelectedProducts(selectedProducts.map(p => {
                const newAssignments = { ...p.assignments };
                const newHelperAssignments = { ...p.helperAssignments };
                delete newAssignments[process];
                delete newHelperAssignments[process];
                return { ...p, assignments: newAssignments, helperAssignments: newHelperAssignments };
            }));
        } else {
            setSelectedProcesses([...selectedProcesses, process]);
            setSelectedProducts(selectedProducts.map(p => ({
                ...p,
                assignments: { ...p.assignments, [process]: '' },
                helperAssignments: { ...p.helperAssignments, [process]: [] }
            })));
        }
    }

    function addCustomProcess() {
        const proc = customProcessInput.trim();
        if (!proc) return;
        if (selectedProcesses.includes(proc)) {
            showToast('Proces već postoji', 'error');
            return;
        }
        setSelectedProcesses([...selectedProcesses, proc]);
        setSelectedProducts(selectedProducts.map(p => ({
            ...p,
            assignments: { ...p.assignments, [proc]: '' },
            helperAssignments: { ...p.helperAssignments, [proc]: [] }
        })));
        setCustomProcessInput('');
    }

    function assignWorker(productId: string, process: string, workerId: string) {
        setSelectedProducts(selectedProducts.map(p => {
            if (p.Product_ID === productId) return { ...p, assignments: { ...p.assignments, [process]: workerId } };
            return p;
        }));
    }

    function toggleHelper(productId: string, process: string, helperId: string) {
        setSelectedProducts(selectedProducts.map(p => {
            if (p.Product_ID === productId) {
                const currentHelpers = p.helperAssignments[process] || [];
                const newHelpers = currentHelpers.includes(helperId)
                    ? currentHelpers.filter(id => id !== helperId)
                    : [...currentHelpers, helperId];
                return { ...p, helperAssignments: { ...p.helperAssignments, [process]: newHelpers } };
            }
            return p;
        }));
    }

    function assignWorkerToAll(process: string, workerId: string) {
        setSelectedProducts(selectedProducts.map(p => ({ ...p, assignments: { ...p.assignments, [process]: workerId } })));
        const worker = workers.find(w => w.Worker_ID === workerId);
        showToast(`${worker?.Name} dodijeljen za ${process} svim proizvodima`, 'success');
    }

    function assignWorkerToAllProcesses(workerId: string) {
        setSelectedProducts(selectedProducts.map(p => {
            const newAssignments = { ...p.assignments };
            selectedProcesses.forEach(proc => { newAssignments[proc] = workerId; });
            return { ...p, assignments: newAssignments };
        }));
        const worker = workers.find(w => w.Worker_ID === workerId);
        showToast(`${worker?.Name} dodijeljen svim procesima svih proizvoda`, 'success');
    }

    function assignHelpersToAllProcesses(helperIds: string[]) {
        setSelectedProducts(selectedProducts.map(p => {
            const newHelpers = { ...p.helperAssignments };
            selectedProcesses.forEach(proc => { newHelpers[proc] = [...helperIds]; });
            return { ...p, helperAssignments: newHelpers };
        }));
        showToast(`${helperIds.length} pomoćni${helperIds.length === 1 ? 'k' : 'ka'} dodijeljeno svim procesima`, 'success');
    }

    async function handleCreateWorkOrder() {
        if (selectedProducts.length === 0) return;

        // S2.1: Guard against duplicate products already in active work orders
        const duplicates: string[] = [];
        for (const sp of selectedProducts) {
            const existing = workOrders.find(wo =>
                wo.Status !== 'Završeno' &&
                wo.items?.some(item => item.Product_ID === sp.Product_ID)
            );
            if (existing) {
                duplicates.push(`${sp.Product_Name} (nalog ${existing.Work_Order_Number})`);
            }
        }
        if (duplicates.length > 0) {
            showToast(`Proizvodi su već u aktivnim nalozima: ${duplicates.join(', ')}`, 'error');
            return;
        }

        // Calculate Total_Value and Material_Cost from products
        // MONTAŽA FIX: Skip financial accumulation for montaža — only labor costs matter
        let totalValue = 0;
        let materialCost = 0;
        let totalTransport = 0;
        let totalServices = 0;
        const isMontazaMode = wizardMode === 'montaza';

        if (!isMontazaMode) {
            selectedProducts.forEach(p => {
                // Get product data from project
                const project = projects.find(proj => proj.Project_ID === p.Project_ID);
                const product = project?.products?.find(prod => prod.Product_ID === p.Product_ID);

                // Get offer product for selling price
                const offer = project?.offers?.find(o => o.Status === 'Prihvaćeno');
                const offerProduct = offer?.products?.find(op => op.Product_ID === p.Product_ID);

                // Calculate value (Selling_Price × quantity ratio)
                const qtyRatio = p.Work_Order_Quantity / p.Quantity;
                if (offerProduct?.Selling_Price) {
                    totalValue += offerProduct.Selling_Price * p.Work_Order_Quantity;
                }

                // Transport and services from offer
                totalTransport += offerProduct?.Transport_Share || 0;
                totalServices += (offerProduct?.extras || []).reduce((s: number, e: any) => s + (e.Total || 0), 0);

                // Calculate material cost from product materials
                if (product?.materials) {
                    const productMaterialCost = product.materials.reduce((sum, m) =>
                        sum + (m.Unit_Price * m.Quantity), 0);
                    materialCost += productMaterialCost * qtyRatio;
                }
            });
        }

        const items = selectedProducts.map(p => {
            // Get offer product for Product_Value
            const project = projects.find(proj => proj.Project_ID === p.Project_ID);
            const offer = project?.offers?.find(o => o.Status === 'Prihvaćeno');
            const offerProduct = offer?.products?.find(op => op.Product_ID === p.Product_ID);
            const product = project?.products?.find(prod => prod.Product_ID === p.Product_ID);

            // Calculate per-item material cost
            const qtyRatio = p.Work_Order_Quantity / p.Quantity;
            let itemMaterialCost = 0;
            if (product?.materials) {
                const productMaterialCost = product.materials.reduce((sum, m) =>
                    sum + (m.Unit_Price * m.Quantity), 0);
                itemMaterialCost = productMaterialCost * qtyRatio;
            }

            return {
                Product_ID: p.Product_ID,
                Product_Name: p.Product_Name,
                Project_ID: p.Project_ID,
                Project_Name: p.Project_Name,
                Quantity: p.Work_Order_Quantity,
                Total_Product_Quantity: p.Quantity,
                // MONTAŽA FIX: Zero out financial fields — revenue/costs already on production WO
                Product_Value: isMontazaMode ? 0 : (offerProduct?.Selling_Price ? offerProduct.Selling_Price * p.Work_Order_Quantity : undefined),
                Material_Cost: isMontazaMode ? 0 : (itemMaterialCost > 0 ? itemMaterialCost : undefined),
                Transport_Share: isMontazaMode ? 0 : (offerProduct?.Transport_Share || 0),
                Services_Total: isMontazaMode ? 0 : (offerProduct?.extras || []).reduce((s: number, e: any) => s + (e.Total || 0), 0),
                Planned_Labor_Cost: isMontazaMode ? 0 : (offerProduct
                    ? (offerProduct.Labor_Workers || 1) * (offerProduct.Labor_Days || 0) * (offerProduct.Labor_Daily_Rate || 0)
                    : undefined),
                Processes: selectedProcesses.map(proc => {
                    const workerId = p.assignments[proc];
                    const worker = workers.find(w => w.Worker_ID === workerId);
                    return {
                        Process_Name: proc,
                        Status: 'Na čekanju',
                        Worker_ID: workerId || undefined,
                        Worker_Name: worker?.Name || undefined,
                        Helpers: (p.helperAssignments?.[proc] || []).map(hId => {
                            const h = workers.find(w => w.Worker_ID === hId);
                            return {
                                Worker_ID: hId,
                                Worker_Name: h?.Name || 'Nepoznat'
                            };
                        })
                    };
                }),
                // Legacy support but simplified
                Process_Assignments: {},
                // Montaža: link back to source production work order
                ...(p.Source_Work_Order_ID && { Source_Work_Order_ID: p.Source_Work_Order_ID }),
            };
        });

        // GAP-2: Warn if no offer pricing exists
        if (totalValue === 0) {
            showToast('⚠️ Nema prihvaćene ponude — cijena proizvoda nije poznata. Profit neće biti tačan dok ručno ne unesete cijenu.', 'error');
        }

        // Calculate initial profit — now includes Transport + Services (GAP-1 fix)
        const profit = totalValue - materialCost - totalTransport - totalServices;
        const profitMargin = totalValue > 0 ? (profit / totalValue) * 100 : 0;

        const result = await createWorkOrder({
            Work_Order_Type: wizardMode === 'montaza' ? 'Montaža' : 'Proizvodnja',
            Production_Steps: selectedProcesses,
            Due_Date: dueDate,
            Notes: notes,
            Total_Value: isMontazaMode ? 0 : (totalValue > 0 ? totalValue : undefined),
            Material_Cost: isMontazaMode ? 0 : (materialCost > 0 ? materialCost : undefined),
            Profit: isMontazaMode ? 0 : (profit > 0 ? profit : undefined),
            Profit_Margin: isMontazaMode ? 0 : (profitMargin > 0 ? profitMargin : undefined),
            items: items as any,
        }, organizationId || '');

        if (result.success) {
            showToast(`Radni nalog ${result.data?.Work_Order_Number} kreiran`, 'success');
            setCreateModal(false);
            onRefresh('workOrders', 'projects');
        } else {
            showToast(result.message, 'error');
        }
    }

    // View/Edit/Delete/Print logic
    async function handleUpdateWorkOrder(workOrderId: string, updates: any) {
        // S6.6: Validate all items before manual completion
        if (updates.Status === 'Završeno') {
            const wo = workOrders.find(w => w.Work_Order_ID === workOrderId);
            if (wo) {
                const unfinished = (wo.items || []).filter(
                    item => item.Status !== 'Završeno'
                );
                if (unfinished.length > 0) {
                    const names = unfinished.map(i => i.Product_Name).join(', ');
                    showToast(`Stavke nisu završene: ${names}. Završite sve stavke prije kompletiranja naloga.`, 'error');
                    return;
                }
            }
        }

        const res = await updateWorkOrder(workOrderId, updates, organizationId || '');
        if (res.success) {
            showToast(res.message, 'success');
            onRefresh('workOrders', 'projects');
        } else {
            showToast(res.message, 'error');
        }
    }

    function handlePrintWorkOrder(wo: WorkOrder) {
        // Enrich items with materials from project data for printing
        const enrichedWo = {
            ...wo,
            items: wo.items?.map(item => {
                // Find the product in projects to get its materials
                const project = projects.find(p => p.Project_ID === item.Project_ID);
                const product = project?.products?.find(prod => prod.Product_ID === item.Product_ID);
                return {
                    ...item,
                    materials: product?.materials || item.materials || []
                };
            })
        };
        setCurrentWorkOrderForPrint(enrichedWo);
        setPrintModal(true);
    }

    // Opens the delete confirmation modal
    async function handleDeleteWorkOrder(workOrderId: string) {
        const wo = workOrders.find(w => w.Work_Order_ID === workOrderId);
        setDeleteConfirmModal({
            isOpen: true,
            workOrderId,
            workOrderNumber: wo?.Work_Order_Number || ''
        });
    }

    // Actually performs the delete with the selected action
    async function confirmDeleteWorkOrder(productAction: 'completed' | 'waiting') {
        if (!deleteConfirmModal.workOrderId) return;

        const res = await deleteWorkOrder(
            deleteConfirmModal.workOrderId,
            organizationId || '',
            productAction
        );

        setDeleteConfirmModal({ isOpen: false, workOrderId: null, workOrderNumber: '' });

        if (res.success) {
            showToast(res.message, 'success');
            onRefresh('workOrders', 'projects');
        } else {
            showToast(res.message, 'error');
        }
    }

    async function handleStartWorkOrder(workOrderId: string) {
        // Get the work order to validate
        const wo = workOrders.find(w => w.Work_Order_ID === workOrderId);
        if (!wo) {
            showToast('Nalog nije pronađen', 'error');
            return;
        }

        // S2.2: Check at least one worker is assigned
        const hasWorker = (wo.items || []).some(item =>
            (item.Processes || []).some(p => p.Worker_ID)
        );
        if (!hasWorker) {
            showToast('Dodijelite barem jednog radnika prije pokretanja naloga', 'error');
            return;
        }

        // VALIDATION 1: Check essential materials are received
        const missingMaterials: string[] = [];
        for (const item of wo.items || []) {
            // Get product materials from projects
            const project = projects.find(p => p.Project_ID === item.Project_ID);
            const product = project?.products?.find(pr => pr.Product_ID === item.Product_ID);

            if (product?.materials) {
                const missing = product.materials.filter(
                    m => m.Is_Essential && m.Status !== 'Primljeno' && m.Status !== 'Na stanju'
                );
                missing.forEach(m => missingMaterials.push(`${item.Product_Name}: ${m.Material_Name}`));
            }
        }

        if (missingMaterials.length > 0) {
            showToast(`Esencijalni materijali nisu spremni: ${missingMaterials.join(', ')}`, 'error');
            return;
        }

        // VALIDATION 2: Check ALL workers (all processes + helpers) are present today
        const { canWorkerStartProcess } = await import('@/lib/attendance');
        const workerIssues: string[] = [];
        const checkedWorkers = new Set<string>(); // Avoid duplicate checks

        for (const item of wo.items || []) {
            // Check all process workers and their helpers
            for (const process of item.Processes || []) {
                // Check main worker
                if (process.Worker_ID && !checkedWorkers.has(process.Worker_ID)) {
                    checkedWorkers.add(process.Worker_ID);
                    const availability = await canWorkerStartProcess(process.Worker_ID);
                    if (!availability.allowed) {
                        workerIssues.push(`${process.Worker_Name} (${process.Process_Name}) - ${availability.reason}`);
                    }
                }

                // Check helpers for this process
                if (process.Helpers && process.Helpers.length > 0) {
                    for (const helper of process.Helpers) {
                        if (helper.Worker_ID && !checkedWorkers.has(helper.Worker_ID)) {
                            checkedWorkers.add(helper.Worker_ID);
                            const availability = await canWorkerStartProcess(helper.Worker_ID);
                            if (!availability.allowed) {
                                workerIssues.push(`${helper.Worker_Name} (pomoćnik za ${process.Process_Name}) - ${availability.reason}`);
                            }
                        }
                    }
                }
            }
        }

        if (workerIssues.length > 0) {
            showToast(`Radnici nisu prisutni: ${workerIssues.join(', ')}`, 'error');
            return;
        }

        // All validations passed, start the work order
        const res = await startWorkOrder(workOrderId, organizationId || '');
        if (res.success) {
            showToast('Nalog pokrenut', 'success');
            onRefresh('workOrders', 'projects');
        } else {
            showToast(res.message, 'error');
        }
    }

    const renderWorkOrderCard = (wo: WorkOrder) => {
        const isExpanded = expandedOrderId === wo.Work_Order_ID;
        const totalItems = wo.items?.length || 0;

        // Extract all workers from this work order (using new Processes structure)
        const orderWorkers = new Map<string, { name: string; isMain: boolean; helperCount: number }>();
        wo.items?.forEach(item => {
            // Check new Processes field
            if (item.Processes) {
                item.Processes.forEach(p => {
                    if (p.Worker_ID && p.Worker_Name) {
                        orderWorkers.set(p.Worker_ID, {
                            name: p.Worker_Name,
                            isMain: true,
                            helperCount: 0
                        });
                    }
                });
            }
            // Fallback for legacy data
            else if (item.Process_Assignments) {
                Object.values(item.Process_Assignments).forEach(assignment => {
                    if (assignment.Worker_ID && assignment.Worker_Name) {
                        orderWorkers.set(assignment.Worker_ID, {
                            name: assignment.Worker_Name,
                            isMain: true,
                            helperCount: assignment.Helpers?.length || 0
                        });
                    }
                });
            }
        });

        // Get main workers only for display
        const mainWorkers = Array.from(orderWorkers.entries())
            .filter(([, v]) => v.isMain)
            .slice(0, 3); // Show up to 3 workers
        const totalHelpers = 0; // Simplified for new view

        const formatValue = (value?: number) =>
            value && Number.isFinite(value) ? `${value.toLocaleString('hr-HR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} KM` : null;

        const getStatusDetails = (status: string) => {
            switch (status) {
                case 'Završeno': return { color: '#10b981', icon: 'check_circle', bg: 'linear-gradient(135deg, rgba(16, 185, 129, 0.1), rgba(16, 185, 129, 0.2))' };
                case 'U toku': return { color: '#3b82f6', icon: 'trending_up', bg: 'linear-gradient(135deg, rgba(59, 130, 246, 0.1), rgba(59, 130, 246, 0.2))' };
                case 'Na čekanju': return { color: '#f59e0b', icon: 'schedule', bg: 'linear-gradient(135deg, rgba(245, 158, 11, 0.1), rgba(245, 158, 11, 0.2))' };
                case 'Otkazano': return { color: '#ef4444', icon: 'cancel', bg: 'linear-gradient(135deg, rgba(239, 68, 68, 0.1), rgba(239, 68, 68, 0.2))' };
                case 'Dodijeljeno': return { color: '#8b5cf6', icon: 'assignment_ind', bg: 'linear-gradient(135deg, rgba(139, 92, 246, 0.1), rgba(139, 92, 246, 0.2))' };
                default: return { color: '#9ca3af', icon: 'help_outline', bg: 'linear-gradient(135deg, rgba(156, 163, 175, 0.1), rgba(156, 163, 175, 0.2))' };
            }
        };

        const statusDetails = getStatusDetails(wo.Status);

        const isMontaza = wo.Work_Order_Type === 'Montaža';

        return (
            <div key={wo.Work_Order_ID} className={`project-card ${isExpanded ? 'active' : ''}`}
                style={{
                    position: 'relative',
                    borderLeft: `3px solid ${isMontaza ? '#00C7BE' : statusDetails.color}`,
                }}>
                <div className="project-header" onClick={() => toggleWorkOrder(wo.Work_Order_ID)}>
                    <button className={`expand-btn ${isExpanded ? 'expanded' : ''}`}>
                        <span className="material-icons-round">chevron_right</span>
                    </button>

                    <div className="project-main-info">
                        <div className="project-title-section">
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                    <div className="project-name">{wo.Name || `#${wo.Work_Order_Number}`}</div>
                                    {wo.Name && <span style={{ fontSize: '12px', color: '#9ca3af', fontWeight: 500 }}>#{wo.Work_Order_Number}</span>}
                                    {wo.items?.[0]?.Project_Name && (
                                        <>
                                            <span style={{ color: '#d1d5db' }}>•</span>
                                            <span style={{ fontSize: '13px', color: '#4b5563', fontWeight: 500 }}>
                                                {wo.items[0].Project_Name}
                                            </span>
                                        </>
                                    )}
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                                    <span style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '4px',
                                        fontSize: '12px',
                                        fontWeight: 600,
                                        color: statusDetails.color,
                                    }}>
                                        <span className="material-icons-round" style={{ fontSize: '14px' }}>{statusDetails.icon}</span>
                                        {wo.Status}
                                    </span>
                                    {isMontaza && (
                                        <>
                                            <span style={{ color: '#d1d5db' }}>•</span>
                                            <span style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '4px',
                                                fontSize: '12px',
                                                fontWeight: 700,
                                                color: '#00897b',
                                            }}>
                                                <span className="material-icons-round" style={{ fontSize: '14px' }}>build</span>
                                                Montaža
                                            </span>
                                        </>
                                    )}

                                    {/* Active Groups Badge */}
                                    {(() => {
                                        let activeGroups = 0;
                                        wo.items?.forEach(item => {
                                            if (item.SubTasks && item.SubTasks.length > 0) {
                                                activeGroups += item.SubTasks.filter(st => st.Status === 'U toku').length;
                                            } else if (item.Status === 'U toku') {
                                                activeGroups += 1;
                                            }
                                        });

                                        if (activeGroups > 0) {
                                            return (
                                                <>
                                                    <span style={{ color: '#d1d5db' }}>•</span>
                                                    <span style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '4px',
                                                        fontSize: '12px',
                                                        fontWeight: 500,
                                                        color: '#4b5563',
                                                    }} title={`${activeGroups} aktivnih grupa u proizvodnji`}>
                                                        <span className="material-icons-round" style={{ fontSize: '14px' }}>layers</span>
                                                        {activeGroups}
                                                    </span>
                                                </>
                                            );
                                        }
                                        return null;
                                    })()}

                                    {/* S16: Per-card Missing Attendance Badge — clickable */}
                                    {wo.Status === 'U toku' && attendanceWarnings && (() => {
                                        const woWarnings = attendanceWarnings.warnings.filter(w => w.Work_Order_ID === wo.Work_Order_ID);
                                        if (woWarnings.length === 0) return null;
                                        return (
                                            <>
                                                <span style={{ color: '#d1d5db' }}>•</span>
                                                <span style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '4px',
                                                    fontSize: '12px',
                                                    fontWeight: 600,
                                                    color: '#d97706',
                                                    cursor: 'pointer',
                                                    transition: 'opacity 0.2s',
                                                }}
                                                    title={`Kliknite za popunu prisustva: ${woWarnings.map(w => w.Worker_Name).join(', ')}`}
                                                    onClick={(e) => { e.stopPropagation(); setAttendanceFixWorkOrder(wo); }}
                                                    onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.7')}
                                                    onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
                                                >
                                                    <span className="material-icons-round" style={{ fontSize: '14px', animation: 'pulse 2s ease-in-out infinite' }}>person_off</span>
                                                    {woWarnings.length}
                                                </span>
                                            </>
                                        );
                                    })()}
                                </div>
                            </div>
                        </div>
                        <div className="project-details" style={{ marginTop: '12px' }}>
                            <div className="project-summary">
                                <span className="summary-item">
                                    <span className="material-icons-round">inventory_2</span>
                                    {totalItems} {totalItems === 1 ? 'proizvod' : 'proizvoda'}
                                </span>
                                <span className="summary-item">
                                    <span className="material-icons-round">calendar_today</span>
                                    {wo.Due_Date ? formatDate(wo.Due_Date) : '-'}
                                </span>
                                {mainWorkers.length > 0 && (
                                    <span className="summary-item" style={{ color: 'var(--primary-color)' }}>
                                        <span className="material-icons-round">person</span>
                                        {mainWorkers.map(([, w]) => w.name.split(' ')[0]).join(', ')}
                                    </span>
                                )}
                                {/* Real-time Profit Display */}
                                {(() => {
                                    const totalValue = wo.items?.reduce((sum, item) => sum + (item.Product_Value || 0), 0) || 0;
                                    const materialCost = wo.items?.reduce((sum, item) => sum + (item.Material_Cost || 0), 0) || 0;
                                    const laborCost = wo.items?.reduce((sum, item) => sum + (item.Actual_Labor_Cost || 0), 0) || 0;
                                    const plannedLaborCost = wo.items?.reduce((sum, item) => sum + (item.Planned_Labor_Cost || 0), 0) || 0;
                                    const transportCost = wo.items?.reduce((sum, item) => sum + (item.Transport_Share || 0), 0) || 0;
                                    const servicesCost = wo.items?.reduce((sum, item) => sum + (item.Services_Total || 0), 0) || 0;
                                    const profit = totalValue - materialCost - laborCost - transportCost - servicesCost;
                                    const profitMargin = totalValue > 0 ? (profit / totalValue) * 100 : 0;
                                    const laborVariance = plannedLaborCost - laborCost;
                                    const isLaborOver = laborCost > plannedLaborCost && plannedLaborCost > 0;

                                    if (totalValue === 0) {
                                        // GAP-2: Show missing price warning — clickable to open price editor
                                        return (
                                            <span
                                                className="summary-item"
                                                style={{
                                                    color: '#f59e0b',
                                                    fontWeight: 500,
                                                    fontSize: '13px',
                                                    cursor: 'pointer',
                                                    transition: 'opacity 0.2s',
                                                }}
                                                title="Kliknite za ručni unos cijena"
                                                onClick={(e) => { e.stopPropagation(); setPriceEditWorkOrder(wo); }}
                                                onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.7')}
                                                onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
                                            >
                                                <span className="material-icons-round" style={{ fontSize: '16px' }}>money_off</span>
                                                Nedostaje cijena
                                            </span>
                                        );
                                    }

                                    // Color coding
                                    const profitColor = profitMargin >= 30 ? '#10b981' : profitMargin >= 15 ? '#f59e0b' : '#ef4444';

                                    return (
                                        <span
                                            className="summary-item"
                                            style={{
                                                color: profitColor,
                                                fontWeight: 600,
                                                fontSize: '13px',
                                                cursor: 'pointer'
                                            }}
                                            title="Klikni za detalje profita"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                toggleWorkOrder(wo.Work_Order_ID);
                                            }}
                                        >
                                            <span className="material-icons-round" style={{ fontSize: '18px' }}>
                                                {profitMargin >= 30 ? 'trending_up' : profitMargin >= 15 ? 'trending_flat' : 'trending_down'}
                                            </span>
                                            {formatValue(profit)}
                                            <span style={{ fontSize: '11px', opacity: 0.8, fontWeight: 500, marginLeft: '2px' }}>
                                                ({profitMargin.toFixed(0)}%)
                                            </span>
                                        </span>
                                    );
                                })()}
                            </div>
                        </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <button className="icon-btn" title="Printaj Nalog" onClick={(e) => {
                            e.stopPropagation();
                            handlePrintWorkOrder(wo);
                        }}>
                            <span className="material-icons-round">print</span>
                        </button>
                        <button className="icon-btn delete" title="Obriši Nalog" onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteWorkOrder(wo.Work_Order_ID);
                        }}>
                            <span className="material-icons-round">delete</span>
                        </button>
                    </div>
                </div>

                {/* Expanded Content */}
                {isExpanded && (
                    <WorkOrderExpandedDetail
                        workOrder={wo}
                        workers={workers}
                        onUpdate={handleUpdateWorkOrder}
                        onPrint={handlePrintWorkOrder}
                        onDelete={handleDeleteWorkOrder}
                        onStart={handleStartWorkOrder}
                        onRefresh={onRefresh}
                    />
                )}
            </div>
        );
    };

    // Mobile State
    const [isMobile, setIsMobile] = useState(false);

    useEffect(() => {
        const checkMobile = () => setIsMobile(window.innerWidth < 768);
        checkMobile();
        window.addEventListener('resize', checkMobile);
        return () => window.removeEventListener('resize', checkMobile);
    }, []);

    // Mobile View Render
    if (isMobile) {
        return (
            <>
                <MobileWorkOrdersView
                    workOrders={workOrders}
                    projects={projects}
                    workers={workers}
                    onRefresh={onRefresh}
                    showToast={showToast}
                    onCreate={openCreateModal}
                    onEdit={(wo) => {
                        // We can reuse the existing edit logic, ensuring it handles mobile context if needed
                        // For now, assume expanding detail or opening a modal is required.
                        // But `MobileWorkOrdersView` has an `onEdit` prop.
                        // `ProductionTab` has `WorkOrderExpandedDetail` which is desktop-centric.
                        // I might need to make `createModal` adaptable or use a new mobile modal if editing is complex.
                        // However, for now, let's just use the `openCreateModal` for new, but for edit...
                        // ProductionTab doesn't have a dedicated "Edit Modal", it uses `WorkOrderExpandedDetail` inline.
                        // I should probably pass a handler that opens the desktop expanded view? No, that won't work well on mobile if it's not responsive.
                        // The user asked for "Nalozi tab za mobitel".
                        // I will handle `onEdit` by just logging or showing a toast "Not implemented" if I don't have a mobile edit view, 
                        // but actually I should probably reuse `openCreateModal` if it supports editing, 
                        // OR, just open the "Expanded Detail" but maybe in a modal?
                        // SImpler: Just trigger the delete/print/start handlers.
                        // For Edit, since I don't have a specific edit modal ready (ProductionTab uses inline expansion), 
                        // I will trigger the `toggleWorkOrder` which might not be enough.
                        // Actually, I can use the `createModal` for editing if I populate state? 
                        // `ProductionTab` logic for editing is `handleUpdateWorkOrder` which updates data.
                        // `WorkOrderExpandedDetail` handles the UI for editing.
                        // I'll stick to what I have: `MobileWorkOrdersView` handles the list.
                        // For `onEdit`, I'll leave it empty or show a toast for now as I haven't built a mobile edit modal yet, 
                        // OR better: I'll map it to nothing for now and rely on the list view's actions (Print, Delete, Start).
                        // Wait, `MobileWorkOrdersView` calls `onEdit`.
                        // I'll just pass a placeholder function or `() => showToast("Edit opcija uskoro", "info")`.
                        // Actually, the plan was "Bottom sheet modals for viewing/editing".
                        // I haven't created those yet.
                        // I'll implement `MobileWorkOrdersView` to handle the list. 
                        // The user instructions were "sada mi napravi nalozi tab za mobitel... list view".
                        // I'll focus on the list view first. I'll pass `() => {}` for edit.
                        // Re-reading plan: "[ ] Create MobileWorkOrdersView.tsx ... [ ] Bottom sheet modals".
                        // I haven't created `MobileWorkOrderModal`. 
                        // So I'll pass a placeholder.
                        showToast("Uređivanje nije dostupno na mobitelu", "info")
                    }}
                    onDelete={handleDeleteWorkOrder}
                    onStart={handleStartWorkOrder}
                    onPrint={handlePrintWorkOrder}
                />

                {/* Re-use the existing Create Modal since it seems to be partially responsive or I'll check it later */}
                {/* The existing create modal is `Modal` with `wizard-container`. It might look okay on mobile. */}
                {createModal && (
                    <Modal isOpen={createModal} onClose={() => setCreateModal(false)} title="Novi Radni Nalog" size="fullscreen" footer={null}>
                        <div style={{ padding: '20px', textAlign: 'center' }}>
                            <h3>Mobilni unos naloga</h3>
                            <p>Ova funkcionalnost će biti uskoro dostupna na mobilnim uređajima.</p>
                            <button onClick={() => setCreateModal(false)} style={{ padding: '10px 20px', marginTop: '20px' }}>Zatvori</button>
                        </div>
                    </Modal>
                )}
            </>
        );
    }

    return (
        <div className="tab-content active">
            <div className="content-header" style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 24px' }}>
                {/* Glass Search */}
                <div className="glass-search" style={{ flex: '1 1 180px', minWidth: '140px' }}>
                    <span className="material-icons-round">search</span>
                    <input type="text" placeholder="Pretraži naloge..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                </div>

                {/* Glass Controls Group */}
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0 }}>
                    {/* Grouping Control */}
                    <div className="glass-control-group">
                        <span className="control-label">Grupiši:</span>
                        <select
                            value={groupBy}
                            onChange={(e) => setGroupBy(e.target.value as GroupBy)}
                        >
                            {groupingOptions.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
                    </div>

                    {/* Status Filter */}
                    <select className="glass-select-standalone" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                        <option value="">Svi statusi</option>
                        {WORK_ORDER_STATUSES.map(status => <option key={status} value={status}>{status}</option>)}
                    </select>
                </div>

                {/* Action Buttons */}
                <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                    <button
                        className="glass-btn"
                        onClick={async () => {
                            showToast('Sinkronizacija u toku...', 'info');
                            const result = await repairAllProductStatuses();
                            if (result.success) {
                                showToast(result.message, 'success');
                                onRefresh('workOrders', 'projects');
                            } else {
                                showToast(result.message, 'error');
                            }
                        }}
                        title="Sinkroniziraj statuse svih proizvoda sa radnim nalozima"
                        style={{ padding: '8px 12px' }}
                    >
                        <span className="material-icons-round" style={{ fontSize: '18px' }}>sync</span>
                    </button>
                    <button className="glass-btn glass-btn-primary" onClick={openCreateModal} style={{ padding: '8px 14px', whiteSpace: 'nowrap' }}>
                        <span className="material-icons-round" style={{ fontSize: '18px' }}>add</span>
                        Novi nalog
                    </button>
                    <button
                        className="glass-btn"
                        onClick={openMontazaModal}
                        style={{
                            background: '#00C7BE',
                            color: 'white',
                            border: 'none',
                            fontWeight: 600,
                            padding: '8px 14px',
                            whiteSpace: 'nowrap',
                        }}
                    >
                        <span className="material-icons-round" style={{ fontSize: '18px' }}>build</span>
                        Montaža
                    </button>
                </div>
            </div>

            {/* S16: Proactive Attendance Notification Banner */}
            {attendanceWarnings && attendanceWarnings.missingCount > 0 && !attendanceBannerDismissed && (
                <div style={{
                    margin: '0 24px 16px',
                    padding: '14px 18px',
                    background: 'linear-gradient(135deg, #fffbeb, #fef3c7)',
                    border: '1px solid #fbbf24',
                    borderRadius: '12px',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '12px',
                    boxShadow: '0 2px 8px rgba(251, 191, 36, 0.15)',
                    animation: 'slideDown 0.3s ease-out'
                }}>
                    <span className="material-icons-round" style={{ color: '#d97706', fontSize: '22px', marginTop: '1px' }}>warning</span>
                    <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: '13px', color: '#92400e', marginBottom: '4px' }}>
                            ⚠️ {attendanceWarnings.missingCount} {attendanceWarnings.missingCount === 1 ? 'radnik nema' : 'radnika nemaju'} popunjeno prisustvo za danas
                        </div>
                        <div style={{ fontSize: '12px', color: '#a16207', lineHeight: '1.5' }}>
                            {attendanceWarnings.warnings.slice(0, 5).map((w, i) => (
                                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: i > 0 ? '2px' : '0' }}>
                                    <span className="material-icons-round" style={{ fontSize: '14px' }}>person_off</span>
                                    <strong>{w.Worker_Name}</strong>
                                    <span style={{ opacity: 0.7 }}>→</span>
                                    <span>{w.Work_Order_Name}</span>
                                </div>
                            ))}
                            {attendanceWarnings.warnings.length > 5 && (
                                <div style={{ marginTop: '4px', fontStyle: 'italic', opacity: 0.8 }}>
                                    ...i još {attendanceWarnings.warnings.length - 5} radnika
                                </div>
                            )}
                        </div>
                        <div style={{ marginTop: '8px', fontSize: '11px', color: '#b45309', opacity: 0.8 }}>
                            💡 Kliknite na badge pored radnog naloga za popunu prisustva direktno.
                        </div>
                    </div>
                    <button
                        onClick={() => setAttendanceBannerDismissed(true)}
                        style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            padding: '4px',
                            color: '#92400e',
                            opacity: 0.6,
                            borderRadius: '6px'
                        }}
                        title="Sakrij obavijest"
                    >
                        <span className="material-icons-round" style={{ fontSize: '18px' }}>close</span>
                    </button>
                </div>
            )}

            <div className="orders-list">
                {filteredWorkOrders.length === 0 ? (
                    <div className="empty-state"><span className="material-icons-round">engineering</span><h3>Nema radnih naloga</h3><p>Kreirajte prvi radni nalog</p></div>
                ) : (
                    groupBy === 'none' ? (
                        (expandedOrderId
                            ? filteredWorkOrders.filter(wo => wo.Work_Order_ID === expandedOrderId)
                            : filteredWorkOrders
                        ).map(wo => renderWorkOrderCard(wo))
                    ) : (
                        (expandedOrderId
                            ? groupedWorkOrders.filter(g => g.items.some(wo => wo.Work_Order_ID === expandedOrderId))
                            : groupedWorkOrders
                        ).map(group => (
                            <div key={group.key} className="group-section" style={{ marginBottom: '24px' }}>
                                <div
                                    className="group-header"
                                    onClick={() => toggleGroup(group.key)}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '12px',
                                        padding: '12px 16px',
                                        cursor: 'pointer',
                                        userSelect: 'none',
                                        background: groupBy === 'worker' ? 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)' : 'transparent',
                                        borderRadius: '12px',
                                        border: groupBy === 'worker' ? '1px solid #e2e8f0' : 'none'
                                    }}
                                >
                                    <span className="material-icons-round" style={{
                                        transform: collapsedGroups.has(group.key) ? 'rotate(-90deg)' : 'rotate(0deg)',
                                        transition: 'transform 0.2s',
                                        color: '#666'
                                    }}>
                                        expand_more
                                    </span>

                                    {groupBy === 'worker' && group.key !== 'unassigned' && (
                                        <div style={{
                                            width: '36px',
                                            height: '36px',
                                            borderRadius: '50%',
                                            background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            color: 'white',
                                            fontWeight: 600,
                                            fontSize: '14px'
                                        }}>
                                            {group.label.split(' ').map(w => w[0]).slice(0, 2).join('')}
                                        </div>
                                    )}

                                    <div style={{ flex: 1 }}>
                                        <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#1d1d1f' }}>
                                            {group.label}
                                        </h3>
                                        {groupBy === 'worker' && (
                                            <span style={{ fontSize: '12px', color: '#64748b' }}>
                                                {group.count} {group.count === 1 ? 'nalog' : group.count < 5 ? 'naloga' : 'naloga'}
                                            </span>
                                        )}
                                    </div>

                                    {groupBy !== 'worker' && (
                                        <span style={{
                                            background: '#f5f5f7',
                                            padding: '2px 8px',
                                            borderRadius: '12px',
                                            fontSize: '12px',
                                            fontWeight: 600,
                                            color: '#666'
                                        }}>
                                            {group.count}
                                        </span>
                                    )}

                                    {groupBy === 'worker' && group.totalValue > 0 && (
                                        <div style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '6px',
                                            background: '#dcfce7',
                                            padding: '6px 12px',
                                            borderRadius: '8px',
                                            fontWeight: 600,
                                            fontSize: '14px',
                                            color: '#15803d'
                                        }}>
                                            <span className="material-icons-round" style={{ fontSize: '16px' }}>payments</span>
                                            {group.totalValue.toLocaleString('hr-HR')} KM
                                        </div>
                                    )}
                                </div>

                                {!collapsedGroups.has(group.key) && (
                                    <div className="group-items" style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '12px' }}>
                                        {(expandedOrderId
                                            ? group.items.filter(wo => wo.Work_Order_ID === expandedOrderId)
                                            : group.items
                                        ).map(wo => renderWorkOrderCard(wo))}
                                    </div>
                                )}
                            </div>
                        ))
                    )
                )}
            </div>


            <style jsx>{`
                .orders-list { display: flex; flex-direction: column; gap: 12px; }
                
                /* Creating styles similar to ProjectsTab */
                .project-card {
                    background: white;
                    border: 1px solid #e0e0e0;
                    border-radius: 12px;
                    overflow: hidden;
                    transition: all 0.2s;
                }
                .project-card:hover { border-color: #ccc; box-shadow: 0 2px 8px rgba(0,0,0,0.05); }
                .project-card.active { border-color: var(--accent); box-shadow: 0 4px 12px rgba(0,113,227,0.1); }
                
                .project-header {
                    display: flex;
                    align-items: center;
                    padding: 16px 20px;
                    gap: 16px;
                    cursor: pointer;
                    background: white;
                }
                
                .expand-btn {
                    width: 28px;
                    height: 28px;
                    border-radius: 50%;
                    border: 1px solid #e0e0e0;
                    background: #f5f5f7;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: #666;
                    cursor: pointer;
                    transition: all 0.2s;
                }
                .expand-btn.expanded { transform: rotate(90deg); background: var(--accent); color: white; border-color: var(--accent); }
                
                .project-main-info { flex: 1; display: flex; flex-direction: column; gap: 4px; }
                .project-title-section { display: flex; align-items: baseline; gap: 10px; }
                .project-name { font-size: 16px; font-weight: 600; color: #1d1d1f; }
                .project-client { font-size: 13px; color: #86868b; }
                
                .project-details { display: flex; align-items: center; gap: 16px; margin-top: 2px; }
                .project-summary { display: flex; gap: 12px; }
                .summary-item { display: flex; align-items: center; gap: 4px; font-size: 12px; color: #666; background: #f5f5f7; padding: 2px 8px; border-radius: 6px; }
                .summary-item .material-icons-round { font-size: 14px; }
                

                
                .project-actions { display: flex; gap: 8px; margin-left: 8px; }
                .icon-btn { width: 32px; height: 32px; border-radius: 8px; border: 1px solid transparent; background: transparent; color: #666; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s; }
                .icon-btn:hover { background: #f5f5f7; color: #333; }
                .icon-btn.danger:hover { background: #fee2e2; color: #ef4444; }
                .icon-btn .material-icons-round { font-size: 18px; }

                /* Standardized heights for right-side items */
                .progress-mini { 
                    display: flex; 
                    align-items: center; 
                    gap: 8px; 
                    margin-right: 8px; 
                    background: #f5f5f7; 
                    padding: 0 12px; 
                    border-radius: 8px; 
                    height: 32px; 
                }
                .progress-text { font-size: 12px; font-weight: 600; color: #333; }
                .progress-circle { width: 10px; height: 10px; border-radius: 50%; }

                .project-badges { display: flex; gap: 8px; height: 32px; align-items: center; }
                .status-badge { 
                    padding: 0 12px; 
                    border-radius: 8px; 
                    font-size: 11px; 
                    font-weight: 600; 
                    text-transform: uppercase; 
                    height: 32px; 
                    display: flex; 
                    align-items: center; 
                }
                .status-nacrt { background: #f3f4f6; color: #6b7280; }
                .status-dodijeljeno { background: #dbeafe; color: #1d4ed8; }
                .status-u-toku { background: #fef3c7; color: #b45309; }
                .status-završeno, .status-zavrseno { background: #dcfce7; color: #15803d; }
                .status-otkazano { background: #fee2e2; color: #dc2626; }
                .status-na-čekanju, .status-na-cekanju { background: #fff7ed; color: #c2410c; }

            `}</style>

            {/* ========== FULL-SCREEN WIZARD MODAL ========== */}
            <Modal isOpen={createModal} onClose={() => setCreateModal(false)} title={wizardMode === 'montaza' ? 'Montažni Nalog' : 'Novi Radni Nalog'} size="fullscreen" footer={null}>
                <div className="wizard-container">
                    {/* COMPACT HEADER WITH NAVIGATION */}
                    <div className="wizard-header">
                        <div className="header-left">
                            {activeStep > 0 && (
                                <button className="btn-nav back" onClick={handleBack}>
                                    <span className="material-icons-round">arrow_back</span>
                                    Nazad
                                </button>
                            )}
                        </div>

                        <div className="steps-indicator compact">
                            {steps.map((step, index) => (
                                <div key={step.id} className={`step-item ${index <= activeStep ? 'active' : ''} ${index === activeStep ? 'current' : ''}`}>
                                    <div className="step-circle">{index + 1}</div>
                                    <span className="step-title">{step.title}</span>
                                    {index < steps.length - 1 && <div className="step-line" />}
                                </div>
                            ))}
                        </div>

                        <div className="header-right">
                            {activeStep === lastStep ? (
                                <button className="btn-nav finish" onClick={handleCreateWorkOrder}
                                    style={wizardMode === 'montaza' ? { background: 'linear-gradient(135deg, #00C7BE 0%, #00a89e 100%)' } : undefined}
                                >
                                    Kreiraj
                                    <span className="material-icons-round">check</span>
                                </button>
                            ) : (
                                <button className="btn-nav next" onClick={handleNext} disabled={!canGoNext}
                                    style={wizardMode === 'montaza' ? { background: 'linear-gradient(135deg, #00C7BE 0%, #00a89e 100%)' } : undefined}
                                >
                                    Dalje
                                    <span className="material-icons-round">arrow_forward</span>
                                </button>
                            )}
                        </div>
                    </div>

                    {/* CONTENT BODY - MAXIMIZED */}
                    <div className="wizard-body">
                        {/* STEP 1: PROJECTS (Production only) */}
                        {activeStep === 0 && wizardMode === 'production' && (
                            <div className="wizard-step step-projects">
                                <div className="step-page-header">
                                    <h3>Odaberite projekat</h3>
                                    <p>Za koji projekat kreirate nalog?</p>
                                </div>

                                <div className="project-search-container">
                                    <div className="search-input">
                                        <span className="material-icons-round">search</span>
                                        <input
                                            placeholder="Pretraži projekte..."
                                            value={projectSearch}
                                            onChange={e => setProjectSearch(e.target.value)}
                                            autoFocus
                                        />
                                    </div>
                                </div>

                                <div className="wz-grid">
                                    {sortedProjects.map(proj => {
                                        return (
                                            <div key={proj.Project_ID}
                                                className={`wz-card ${selectedProjectIds.includes(proj.Project_ID) ? 'selected' : ''}`}
                                                onClick={() => toggleProjectSelection(proj.Project_ID)}>
                                                <div className="card-check">
                                                    <span className="material-icons-round">
                                                        {selectedProjectIds.includes(proj.Project_ID) ? 'check_circle' : 'radio_button_unchecked'}
                                                    </span>
                                                </div>
                                                <div className="card-info">
                                                    <span className="card-title">{proj.Client_Name}</span>
                                                    <div className="card-badges">
                                                        <span className="card-badge">{proj.products?.length || 0} proizvoda</span>
                                                    </div>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>
                        )}

                        {/* MONTAŽA STEP 0: Select Spremno Products */}
                        {activeStep === 0 && wizardMode === 'montaza' && (
                            <div className="wizard-step step-products">
                                <div className="step-toolbar sticky">
                                    <div className="tb-left">
                                        <h3 style={{ color: '#00C7BE' }}>🔧 Odaberite spremne proizvode</h3>
                                        <span className="tb-stats">{selectedProducts.length} odabrano od {eligibleMontazaProducts.length} spremnih</span>
                                    </div>
                                    <div className="tb-right">
                                        <div className="search-input">
                                            <span className="material-icons-round">search</span>
                                            <input placeholder="Pretraži..." value={productSearch} onChange={e => setProductSearch(e.target.value)} />
                                        </div>
                                        <button className="btn-text" onClick={() => {
                                            setSelectedProducts(eligibleMontazaProducts.map((p: any) => ({
                                                Product_ID: p.Product_ID,
                                                Product_Name: p.Product_Name,
                                                Project_ID: p.Project_ID,
                                                Project_Name: p.Project_Name,
                                                Quantity: p.Quantity,
                                                Work_Order_Quantity: p.Quantity,
                                                Status: p.Status,
                                                assignments: {},
                                                helperAssignments: {},
                                                Unit_Price: undefined,
                                                Material_Cost: undefined,
                                                Source_Work_Order_ID: p.Source_Work_Order_ID,
                                            })));
                                        }}>Odaberi sve</button>
                                        {selectedProducts.length > 0 && <button className="btn-text danger" onClick={() => setSelectedProducts([])}>Poništi</button>}
                                    </div>
                                </div>

                                {eligibleMontazaProducts.length === 0 ? (
                                    <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-secondary)' }}>
                                        <span className="material-icons-round" style={{ fontSize: '48px', opacity: 0.4, marginBottom: '12px', display: 'block' }}>inventory_2</span>
                                        <h4>Nema spremnih proizvoda</h4>
                                        <p style={{ fontSize: '13px', maxWidth: '400px', margin: '8px auto' }}>Proizvodi moraju imati status "Spremno" da bi bili dostupni za montažu. Završite proizvodnju najprije.</p>
                                    </div>
                                ) : (
                                    <div className="wz-scroll-container">
                                        <div className="wz-list">
                                            {eligibleMontazaProducts.map((prod: any) => {
                                                const isSelected = selectedProducts.some(p => p.Product_ID === prod.Product_ID);
                                                return (
                                                    <div key={prod.Product_ID}
                                                        className={`wz-list-item ${isSelected ? 'selected' : ''}`}
                                                        style={{ flexDirection: 'column', alignItems: 'stretch', gap: '8px' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}
                                                            onClick={() => {
                                                                if (isSelected) {
                                                                    setSelectedProducts(selectedProducts.filter(p => p.Product_ID !== prod.Product_ID));
                                                                } else {
                                                                    setSelectedProducts([...selectedProducts, {
                                                                        Product_ID: prod.Product_ID,
                                                                        Product_Name: prod.Product_Name,
                                                                        Project_ID: prod.Project_ID,
                                                                        Project_Name: prod.Project_Name,
                                                                        Quantity: prod.Quantity,
                                                                        Work_Order_Quantity: prod.Quantity,
                                                                        Status: prod.Status,
                                                                        assignments: {},
                                                                        helperAssignments: {},
                                                                        Unit_Price: undefined,
                                                                        Material_Cost: undefined,
                                                                    }]);
                                                                }
                                                            }}>
                                                            <span className="material-icons-round icon-check">
                                                                {isSelected ? 'check_box' : 'check_box_outline_blank'}
                                                            </span>
                                                            <div className="li-content">
                                                                <span className="li-title">{prod.Product_Name}</span>
                                                                <span className="li-sub">
                                                                    {prod.Project_Name}
                                                                    {prod.Source_Work_Order_Number && (
                                                                        <span style={{ marginLeft: '8px', color: '#00C7BE', fontSize: '11px' }}>
                                                                            ← {prod.Source_Work_Order_Number}
                                                                        </span>
                                                                    )}
                                                                </span>
                                                            </div>
                                                            <span className="li-qty" style={{ background: '#e0f7f6', color: '#00897b' }}>{prod.Quantity} kom</span>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* STEP 2: PRODUCTS (Production only, montaža handles this in step 0) */}
                        {activeStep === 1 && wizardMode === 'production' && (
                            <div className="wizard-step step-products">
                                <div className="step-toolbar sticky">
                                    <div className="tb-left">
                                        <h3>Odaberite proizvode</h3>
                                        <span className="tb-stats">{selectedProducts.length} odabrano</span>
                                    </div>
                                    <div className="tb-right">
                                        <div className="search-input">
                                            <span className="material-icons-round">search</span>
                                            <input placeholder="Pretraži..." value={productSearch} onChange={e => setProductSearch(e.target.value)} />
                                        </div>
                                        <button className="btn-text" onClick={selectAllProducts}>Odaberi sve</button>
                                        {selectedProducts.length > 0 && <button className="btn-text danger" onClick={() => setSelectedProducts([])}>Poništi</button>}
                                    </div>
                                </div>
                                <div className="wz-list-scroll">
                                    <div className="wz-list">
                                        {eligibleProducts.map(prod => {
                                            const isSelected = selectedProducts.some(p => p.Product_ID === prod.Product_ID);
                                            const selectedProd = selectedProducts.find(p => p.Product_ID === prod.Product_ID);

                                            return (
                                                <div key={prod.Product_ID}
                                                    className={`wz-list-item ${isSelected ? 'selected' : ''}`}
                                                    style={{ flexDirection: 'column', alignItems: 'stretch', gap: '8px' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}
                                                        onClick={() => toggleProduct(prod)}>
                                                        <span className="material-icons-round icon-check">
                                                            {isSelected ? 'check_box' : 'check_box_outline_blank'}
                                                        </span>
                                                        <div className="li-content">
                                                            <span className="li-title">{prod.Product_Name}</span>
                                                            <span className="li-sub">{prod.Project_Name}</span>
                                                        </div>
                                                        <span className="li-qty">{prod.Quantity} kom</span>
                                                    </div>

                                                    {isSelected && selectedProd && (
                                                        <div style={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '12px',
                                                            marginLeft: '36px',
                                                            padding: '8px 12px',
                                                            background: 'var(--bg-tertiary)',
                                                            borderRadius: '6px'
                                                        }}>
                                                            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                                                Ukupno: {prod.Quantity} kom
                                                            </span>
                                                            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>•</span>
                                                            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>U nalog:</span>
                                                            <input
                                                                type="number"
                                                                min="1"
                                                                max={prod.Quantity}
                                                                value={selectedProd.Work_Order_Quantity}
                                                                onClick={(e) => e.stopPropagation()}
                                                                onChange={(e) => {
                                                                    e.stopPropagation();
                                                                    const newQty = Math.max(1, Math.min(prod.Quantity, parseInt(e.target.value) || 1));
                                                                    setSelectedProducts(selectedProducts.map(p =>
                                                                        p.Product_ID === prod.Product_ID
                                                                            ? { ...p, Work_Order_Quantity: newQty }
                                                                            : p
                                                                    ));
                                                                }}
                                                                style={{
                                                                    width: '70px',
                                                                    padding: '4px 8px',
                                                                    border: '1px solid var(--border-color)',
                                                                    borderRadius: '4px',
                                                                    fontSize: '14px',
                                                                    fontWeight: 600,
                                                                    textAlign: 'center',
                                                                    background: 'var(--bg-primary)'
                                                                }}
                                                            />
                                                            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>kom</span>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* STEP 3: PROCESSES (production step 2, montaža step 1) */}
                        {((wizardMode === 'production' && activeStep === 2) || (wizardMode === 'montaza' && activeStep === 1)) && (
                            <div className="wizard-step step-processes">
                                <div className="step-page-header text-center">
                                    <h3>Definišite procese</h3>
                                    <p>Ovi procesi će biti primijenjeni na sve odabrane proizvode.</p>
                                </div>
                                <div className="process-tags">
                                    {selectedProcesses.map(proc => (
                                        <div key={proc} className="process-tag">
                                            <span>{proc}</span>
                                            <button onClick={() => toggleProcess(proc)}>✕</button>
                                        </div>
                                    ))}
                                </div>
                                <div className="add-process-row">
                                    <input placeholder="Dodaj novi proces..." value={customProcessInput} onChange={e => setCustomProcessInput(e.target.value)}
                                        onKeyPress={e => e.key === 'Enter' && addCustomProcess()} />
                                    <button onClick={addCustomProcess}>Dodaj</button>
                                </div>
                            </div>
                        )}

                        {/* STEP 4: DETAILS & WORKERS (production step 3, montaža step 2) */}
                        {((wizardMode === 'production' && activeStep === 3) || (wizardMode === 'montaza' && activeStep === 2)) && (
                            <div className="wizard-step step-details" onClick={(e) => {
                                // Close dropdowns when clicking outside
                                if (!(e.target as HTMLElement).closest('.wdd')) { setOpenDropdown(null); setWorkerSearch(''); }
                            }}>
                                <div className="details-top">
                                    <div className="input-group">
                                        <label>Rok završetka</label>
                                        <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
                                    </div>
                                    <div className="input-group full">
                                        <label>Napomena</label>
                                        <input type="text" placeholder="Dodatne upute za radnike..." value={notes} onChange={e => setNotes(e.target.value)} />
                                    </div>
                                </div>

                                {/* Bulk assignment row */}
                                <div className="bulk-assign-bar">
                                    <div className="bulk-label">
                                        <span className="material-icons-round" style={{ fontSize: 16 }}>bolt</span>
                                        Dodjeli svima
                                    </div>
                                    <div className="bulk-controls">
                                        {/* Bulk main worker */}
                                        <div className="wdd" style={{ position: 'relative', flex: 1, minWidth: 180 }}>
                                            <button type="button" className="wdd-trigger" onClick={() => { setOpenDropdown(openDropdown === 'bulk-main' ? null : 'bulk-main'); setWorkerSearch(''); }}>
                                                <span className="material-icons-round wdd-icon">person</span>
                                                <span className="wdd-label">Glavni radnik</span>
                                                <span className="material-icons-round wdd-arrow">expand_more</span>
                                            </button>
                                            {openDropdown === 'bulk-main' && (
                                                <div className="wdd-menu">
                                                    <div className="wdd-search">
                                                        <span className="material-icons-round" style={{ fontSize: 16, color: '#94a3b8' }}>search</span>
                                                        <input autoFocus placeholder="Traži radnika..." value={workerSearch} onChange={e => setWorkerSearch(e.target.value)} />
                                                    </div>
                                                    <div className="wdd-options">
                                                        {workers.filter(w => (w.Worker_Type === 'Glavni' || !w.Worker_Type) && w.Name.toLowerCase().includes(workerSearch.toLowerCase())).map(w => (
                                                            <button key={w.Worker_ID} type="button" className="wdd-option" onClick={() => { assignWorkerToAllProcesses(w.Worker_ID); setOpenDropdown(null); setWorkerSearch(''); }}>
                                                                <span className="wdd-name">{w.Name}</span>
                                                                {w.Role && <span className="wdd-role">{w.Role}</span>}
                                                            </button>
                                                        ))}
                                                        {workers.filter(w => (w.Worker_Type === 'Glavni' || !w.Worker_Type) && w.Name.toLowerCase().includes(workerSearch.toLowerCase())).length === 0 && (
                                                            <div className="wdd-empty">Nema rezultata</div>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                        {/* Bulk helpers */}
                                        <div className="wdd" style={{ position: 'relative', flex: 1, minWidth: 180 }}>
                                            <button type="button" className="wdd-trigger" onClick={() => { setOpenDropdown(openDropdown === 'bulk-helpers' ? null : 'bulk-helpers'); setWorkerSearch(''); }}>
                                                <span className="material-icons-round wdd-icon">group</span>
                                                <span className="wdd-label">Pomoćnici</span>
                                                <span className="material-icons-round wdd-arrow">expand_more</span>
                                            </button>
                                            {openDropdown === 'bulk-helpers' && (
                                                <div className="wdd-menu">
                                                    <div className="wdd-search">
                                                        <span className="material-icons-round" style={{ fontSize: 16, color: '#94a3b8' }}>search</span>
                                                        <input autoFocus placeholder="Traži pomoćnika..." value={workerSearch} onChange={e => setWorkerSearch(e.target.value)} />
                                                    </div>
                                                    <div className="wdd-options">
                                                        {workers.filter(w => w.Name.toLowerCase().includes(workerSearch.toLowerCase())).map(w => {
                                                            // Check if this helper is in the first product+process combo (as representative)
                                                            const isSelected = selectedProducts.length > 0 && selectedProcesses.length > 0 &&
                                                                (selectedProducts[0].helperAssignments?.[selectedProcesses[0]] || []).includes(w.Worker_ID);
                                                            return (
                                                                <button key={w.Worker_ID} type="button" className={`wdd-option ${isSelected ? 'selected' : ''}`}
                                                                    onClick={() => {
                                                                        // Toggle: if already assigned everywhere, remove; otherwise add
                                                                        const currentGlobalHelpers = selectedProducts.length > 0 && selectedProcesses.length > 0
                                                                            ? (selectedProducts[0].helperAssignments?.[selectedProcesses[0]] || [])
                                                                            : [];
                                                                        const newHelpers = currentGlobalHelpers.includes(w.Worker_ID)
                                                                            ? currentGlobalHelpers.filter((id: string) => id !== w.Worker_ID)
                                                                            : [...currentGlobalHelpers, w.Worker_ID];
                                                                        assignHelpersToAllProcesses(newHelpers);
                                                                    }}>
                                                                    <span className="wdd-check">{isSelected ? '✓' : ''}</span>
                                                                    <span className="wdd-name">{w.Name}</span>
                                                                    {w.Role && <span className="wdd-role">{w.Role}</span>}
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <div className="matrix-wrapper full-height">
                                    <div className="mw-header">
                                        <div className="m-col product">Proizvod</div>
                                        {selectedProcesses.map(proc => (
                                            <div key={proc} className="m-col process">
                                                <span className="process-header-title">{proc}</span>
                                                {/* Per-process bulk assign */}
                                                <div className="wdd" style={{ position: 'relative', width: '100%' }}>
                                                    <button type="button" className="wdd-trigger compact" onClick={() => { setOpenDropdown(openDropdown === `hdr-${proc}` ? null : `hdr-${proc}`); setWorkerSearch(''); }}>
                                                        <span className="wdd-label">Svima</span>
                                                        <span className="material-icons-round wdd-arrow">expand_more</span>
                                                    </button>
                                                    {openDropdown === `hdr-${proc}` && (
                                                        <div className="wdd-menu">
                                                            <div className="wdd-search">
                                                                <span className="material-icons-round" style={{ fontSize: 16, color: '#94a3b8' }}>search</span>
                                                                <input autoFocus placeholder="Traži..." value={workerSearch} onChange={e => setWorkerSearch(e.target.value)} />
                                                            </div>
                                                            <div className="wdd-options">
                                                                {workers.filter(w => w.Name.toLowerCase().includes(workerSearch.toLowerCase())).map(w => (
                                                                    <button key={w.Worker_ID} type="button" className="wdd-option" onClick={() => { assignWorkerToAll(proc, w.Worker_ID); setOpenDropdown(null); setWorkerSearch(''); }}>
                                                                        <span className="wdd-name">{w.Name}</span>
                                                                        {w.Role && <span className="wdd-role">{w.Role}</span>}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="mw-body">
                                        {selectedProducts.map(prod => (
                                            <div key={prod.Product_ID} className="m-row">
                                                <div className="m-col product">
                                                    <strong>{prod.Product_Name}</strong>
                                                    <small>{prod.Project_Name}</small>
                                                </div>
                                                {selectedProcesses.map(proc => {
                                                    const mainWorkerId = prod.assignments[proc];
                                                    const helpers = prod.helperAssignments?.[proc] || [];
                                                    const mainWorker = workers.find(w => w.Worker_ID === mainWorkerId);
                                                    const dropdownId = `${prod.Product_ID}-${proc}`;
                                                    const helperDropdownId = `${prod.Product_ID}-${proc}-helpers`;

                                                    return (
                                                        <div key={proc} className="m-col process" style={{ gap: '4px' }}>
                                                            {/* Main worker searchable dropdown */}
                                                            <div className="wdd" style={{ position: 'relative', width: '100%' }}>
                                                                <button type="button" className={`wdd-trigger compact ${mainWorkerId ? 'filled' : ''}`}
                                                                    onClick={() => { setOpenDropdown(openDropdown === dropdownId ? null : dropdownId); setWorkerSearch(''); }}>
                                                                    <span className="wdd-label">{mainWorker ? mainWorker.Name : 'Odaberi'}</span>
                                                                    <span className="material-icons-round wdd-arrow">expand_more</span>
                                                                </button>
                                                                {openDropdown === dropdownId && (
                                                                    <div className="wdd-menu">
                                                                        <div className="wdd-search">
                                                                            <span className="material-icons-round" style={{ fontSize: 16, color: '#94a3b8' }}>search</span>
                                                                            <input autoFocus placeholder="Traži radnika..." value={workerSearch} onChange={e => setWorkerSearch(e.target.value)} />
                                                                        </div>
                                                                        <div className="wdd-options">
                                                                            <button type="button" className="wdd-option wdd-option-clear" onClick={() => { assignWorker(prod.Product_ID, proc, ''); setOpenDropdown(null); setWorkerSearch(''); }}>
                                                                                <span className="material-icons-round" style={{ fontSize: 14, color: '#94a3b8' }}>close</span>
                                                                                <span className="wdd-name" style={{ color: '#94a3b8' }}>Ukloni odabir</span>
                                                                            </button>
                                                                            {workers.filter(w => (w.Worker_Type === 'Glavni' || !w.Worker_Type) && w.Name.toLowerCase().includes(workerSearch.toLowerCase())).map(w => (
                                                                                <button key={w.Worker_ID} type="button" className={`wdd-option ${w.Worker_ID === mainWorkerId ? 'selected' : ''}`}
                                                                                    onClick={() => { assignWorker(prod.Product_ID, proc, w.Worker_ID); setOpenDropdown(null); setWorkerSearch(''); }}>
                                                                                    <span className="wdd-name">{w.Name}</span>
                                                                                    {w.Role && <span className="wdd-role">{w.Role}</span>}
                                                                                </button>
                                                                            ))}
                                                                        </div>
                                                                    </div>
                                                                )}
                                                            </div>

                                                            {/* Helper pills + add button */}
                                                            {mainWorkerId && (
                                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', alignItems: 'center' }}>
                                                                    {helpers.map(hId => {
                                                                        const h = workers.find(w => w.Worker_ID === hId);
                                                                        return h ? (
                                                                            <span key={hId} className="helper-pill">
                                                                                {h.Name.split(' ')[0]}
                                                                                <button type="button" onClick={() => toggleHelper(prod.Product_ID, proc, hId)}>×</button>
                                                                            </span>
                                                                        ) : null;
                                                                    })}
                                                                    <div className="wdd" style={{ position: 'relative' }}>
                                                                        <button type="button" className="helper-add-btn"
                                                                            onClick={() => { setOpenDropdown(openDropdown === helperDropdownId ? null : helperDropdownId); setWorkerSearch(''); }}>
                                                                            +
                                                                        </button>
                                                                        {openDropdown === helperDropdownId && (
                                                                            <div className="wdd-menu" style={{ minWidth: 200 }}>
                                                                                <div className="wdd-search">
                                                                                    <span className="material-icons-round" style={{ fontSize: 16, color: '#94a3b8' }}>search</span>
                                                                                    <input autoFocus placeholder="Traži pomoćnika..." value={workerSearch} onChange={e => setWorkerSearch(e.target.value)} />
                                                                                </div>
                                                                                <div className="wdd-options">
                                                                                    {workers.filter(w => w.Worker_ID !== mainWorkerId && w.Name.toLowerCase().includes(workerSearch.toLowerCase())).map(w => {
                                                                                        const isH = helpers.includes(w.Worker_ID);
                                                                                        return (
                                                                                            <button key={w.Worker_ID} type="button" className={`wdd-option ${isH ? 'selected' : ''}`}
                                                                                                onClick={() => toggleHelper(prod.Product_ID, proc, w.Worker_ID)}>
                                                                                                <span className="wdd-check">{isH ? '✓' : ''}</span>
                                                                                                <span className="wdd-name">{w.Name}</span>
                                                                                            </button>
                                                                                        );
                                                                                    })}
                                                                                </div>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </Modal>

            {/* ========== WORK ORDER VIEW/EDIT MODAL ========== */}


            {/* ========== PRINT TEMPLATE MODAL ========== */}
            <Modal
                isOpen={printModal}
                onClose={() => setPrintModal(false)}
                title="Printaj Radni Nalog"
                size="xl"
                footer={<button className="btn btn-secondary" onClick={() => setPrintModal(false)}>Zatvori</button>}
            >
                {currentWorkOrderForPrint && <WorkOrderPrintTemplate workOrder={currentWorkOrderForPrint} />}
            </Modal>

            <style jsx>{`
                /* Wizard Layout */
                .wizard-container { display: flex; flex-direction: column; height: 100vh; background: #f5f5f7; overflow: hidden; }
                
                /* COMPACT HEADER */
                .wizard-header { 
                    flex-shrink: 0;
                    background: white; 
                    padding: 8px 16px; 
                    border-bottom: 1px solid var(--border); 
                    display: grid;
                    grid-template-columns: 100px 1fr 100px;
                    align-items: center;
                    height: 56px;
                }
                
                .header-left { display: flex; justify-content: flex-start; }
                .header-right { display: flex; justify-content: flex-end; }
                
                .steps-indicator { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; }
                .step-item { display: flex; align-items: center; gap: 6px; opacity: 0.4; transition: all 0.3s; }
                .step-item.active { opacity: 1; }
                .step-circle { width: 24px; height: 24px; border-radius: 50%; background: #e0e0e0; color: white; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 11px; }
                .step-item.active .step-circle { background: var(--accent); }
                .step-item.current .step-circle { transform: scale(1.1); box-shadow: 0 0 0 2px rgba(0,113,227,0.1); }
                .step-title { font-weight: 600; font-size: 11px; color: var(--text-primary); white-space: nowrap; }
                .step-line { width: 20px; height: 2px; background: #e0e0e0; border-radius: 2px; }
                .step-item.active .step-line { background: var(--accent); }

                /* NAV BUTTONS */
                .btn-nav {
                    padding: 6px 16px;
                    border-radius: 16px;
                    font-size: 12px;
                    font-weight: 600;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    border: none;
                    cursor: pointer;
                    transition: all 0.2s;
                    height: 32px;
                }
                .btn-nav.back { background: #f0f0f0; color: #333; }
                .btn-nav.back:hover { background: #e0e0e0; }
                .btn-nav.next { background: black; color: white; }
                .btn-nav.next:hover { background: #333; transform: translateX(2px); }
                .btn-nav.finish { background: var(--success); color: white; }
                .btn-nav.finish:hover { background: #28a745; }
                .btn-nav:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
                .btn-nav .material-icons-round { font-size: 14px; }

                /* Body - NO SCROLL (individual steps manage their own) */
                .wizard-body { 
                    flex: 1; 
                    overflow: hidden; 
                    padding: 20px; 
                    display: flex; 
                    justify-content: center; 
                    align-items: flex-start; 
                }
                .wizard-step { 
                    width: 100%; 
                    max-width: 1200px; 
                    display: flex; 
                    flex-direction: column; 
                    height: 100%; 
                    overflow: hidden;
                }
                .step-page-header { margin-bottom: 20px; text-align: left; flex-shrink: 0; }
                .step-page-header h3 { font-size: 20px; margin: 0; font-weight: 700; color: var(--text-primary); }
                .step-page-header p { font-size: 14px; color: var(--text-secondary); margin: 6px 0 0 0; }
                .text-center { text-align: center; }

                /* Step 1: Projects Grid */
                .step-projects { overflow-y: auto; padding-bottom: 20px; }
                .project-search-container { margin-bottom: 24px; display: flex; justify-content: center; }
                .wz-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
                .wz-card { 
                    padding: 20px; 
                    border-radius: 12px; 
                    border: 2px solid transparent; 
                    background: white; 
                    cursor: pointer; 
                    display: flex; 
                    gap: 16px; 
                    align-items: flex-start; 
                    transition: all 0.2s; 
                    box-shadow: 0 1px 3px rgba(0,0,0,0.08);
                }
                .wz-card:hover { border-color: var(--accent); transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.12); }
                .wz-card.selected { border-color: var(--accent); background: #f0f7ff; box-shadow: 0 4px 12px rgba(0, 113, 227, 0.15); }
                .wz-card .material-icons-round { font-size: 24px; color: #ccc; transition: color 0.2s; }
                .wz-card.selected .material-icons-round { color: var(--accent); }
                .card-info { display: flex; flex-direction: column; gap: 8px; flex: 1; }
                .card-title { font-size: 16px; font-weight: 600; color: var(--text-primary); display: block; line-height: 1.3; }
                
                .card-badges { display: flex; flex-wrap: wrap; gap: 6px; }
                .card-badge { 
                    display: inline-flex; 
                    align-items: center; 
                    gap: 4px;
                    font-size: 11px; 
                    color: var(--text-secondary); 
                    background: #f0f0f0; 
                    padding: 2px 8px; 
                    border-radius: 6px; 
                    font-weight: 600;
                }
                .card-badge.success { background: #d3f9d8; color: #155724; }

                /* Step 2: Products List */
                .step-products { display: flex; flex-direction: column; overflow: hidden; }
                .step-toolbar { 
                    flex-shrink: 0;
                    display: flex; 
                    justify-content: space-between; 
                    align-items: center; 
                    margin-bottom: 16px; 
                    background: white; 
                    padding: 12px 16px; 
                    border-radius: 10px; 
                    box-shadow: 0 1px 3px rgba(0,0,0,0.08);
                }
                .tb-left { display: flex; align-items: center; gap: 12px; }
                .tb-left h3 { font-size: 16px; margin: 0; font-weight: 600; }
                .tb-stats { 
                    font-size: 12px; 
                    color: var(--accent); 
                    font-weight: 600; 
                    background: rgba(0,113,227,0.1); 
                    padding: 4px 12px; 
                    border-radius: 12px; 
                }
                .tb-right { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
                .search-input { 
                    background: #f5f5f7; 
                    padding: 8px 12px; 
                    border-radius: 8px; 
                    display: flex; 
                    align-items: center; 
                    gap: 8px; 
                    border: 1px solid transparent; 
                    width: 260px; 
                    transition: all 0.2s;
                }
                .search-input:focus-within { background: white; border-color: var(--accent); }
                .search-input .material-icons-round { font-size: 18px; color: var(--text-secondary); }
                .search-input input { 
                    border: none; 
                    outline: none; 
                    background: transparent; 
                    width: 100%; 
                    font-size: 13px; 
                    color: var(--text-primary);
                }
                .btn-text { 
                    background: none; 
                    border: none; 
                    font-weight: 600; 
                    color: var(--accent); 
                    cursor: pointer; 
                    font-size: 13px; 
                    padding: 6px 12px; 
                    border-radius: 6px; 
                    transition: background 0.2s;
                }
                .btn-text:hover { background: rgba(0,113,227,0.08); }
                .btn-text.danger { color: var(--danger); }
                .btn-text.danger:hover { background: rgba(220,53,69,0.08); }
                
                .wz-list-scroll { 
                    flex: 1; 
                    overflow-y: auto; 
                    background: white; 
                    border-radius: 12px; 
                    border: 1px solid #e0e0e0; 
                    box-shadow: 0 1px 3px rgba(0,0,0,0.08); 
                }
                .wz-list { display: flex; flex-direction: column; }
                .wz-list-item { 
                    padding: 14px 20px; 
                    border-bottom: 1px solid #f0f0f0; 
                    display: flex; 
                    align-items: center; 
                    gap: 16px; 
                    cursor: pointer; 
                    transition: background 0.15s;
                }
                .wz-list-item:last-child { border-bottom: none; }
                .wz-list-item:hover { background: #f9fafb; }
                .wz-list-item.selected { background: #f0f7ff; border-left: 3px solid var(--accent); }
                .wz-list-item .icon-check { font-size: 22px; color: #d0d0d0; transition: color 0.2s; }
                .wz-list-item.selected .icon-check { color: var(--accent); }
                .li-content { flex: 1; display: flex; flex-direction: column; gap: 2px; }
                .li-title { display: block; font-weight: 600; font-size: 14px; color: var(--text-primary); }
                .li-sub { font-size: 12px; color: var(--text-secondary); }
                .li-qty { 
                    font-weight: 600; 
                    background: #e8f4ff; 
                    color: var(--accent); 
                    padding: 4px 10px; 
                    border-radius: 8px; 
                    font-size: 12px; 
                }

                /* Step 3: Processes */
                .step-processes { display: flex; flex-direction: column; align-items: center; padding: 40px 20px; overflow-y: auto; }
                .process-tags { 
                    display: flex; 
                    flex-wrap: wrap; 
                    gap: 12px; 
                    justify-content: center; 
                    margin: 32px 0; 
                }
                .process-tag { 
                    background: white; 
                    padding: 12px 20px; 
                    border-radius: 24px; 
                    border: 2px solid #e0e0e0; 
                    font-weight: 600; 
                    display: flex; 
                    align-items: center; 
                    gap: 10px; 
                    font-size: 14px; 
                    box-shadow: 0 2px 6px rgba(0,0,0,0.06); 
                    transition: all 0.2s;
                }
                .process-tag:hover { transform: translateY(-1px); box-shadow: 0 4px 10px rgba(0,0,0,0.1); }
                .process-tag button { 
                    background: #f0f0f0; 
                    width: 22px; 
                    height: 22px; 
                    border-radius: 50%; 
                    border: none; 
                    display: flex; 
                    align-items: center; 
                    justify-content: center; 
                    cursor: pointer; 
                    font-size: 12px; 
                    color: #666; 
                    transition: all 0.2s;
                }
                .process-tag button:hover { background: var(--danger); color: white; transform: scale(1.1); }
                .add-process-row { display: flex; gap: 12px; max-width: 500px; width: 100%; }
                .add-process-row input { 
                    flex: 1; 
                    padding: 14px 20px; 
                    border-radius: 24px; 
                    border: 2px solid #e0e0e0; 
                    outline: none; 
                    transition: all 0.2s; 
                    font-size: 14px;
                }
                .add-process-row input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(0,113,227,0.1); }
                .add-process-row button { 
                    padding: 0 28px; 
                    border-radius: 24px; 
                    border: none; 
                    background: var(--accent); 
                    color: white; 
                    font-weight: 600; 
                    cursor: pointer; 
                    font-size: 14px; 
                    transition: all 0.2s;
                }
                .add-process-row button:hover { background: #0056b3; transform: scale(1.02); }

                /* Step 4: Matrix View — Premium Redesign */
                .step-details { display: flex; flex-direction: column; overflow: hidden; gap: 12px; }
                .details-top { 
                    flex-shrink: 0;
                    padding: 18px 24px; 
                    background: linear-gradient(135deg, #ffffff 0%, #fafbfd 100%);
                    border: 1px solid rgba(0,0,0,0.06); 
                    border-radius: 14px; 
                    display: flex; 
                    gap: 24px; 
                    box-shadow: 0 2px 8px rgba(0,0,0,0.04), 0 0 0 1px rgba(0,0,0,0.02);
                }
                .input-group { display: flex; flex-direction: column; gap: 6px; }
                .input-group.full { flex: 1; }
                .input-group label { 
                    display: block; 
                    font-size: 12px; 
                    font-weight: 600; 
                    color: #4a5568; 
                    text-transform: none;
                    letter-spacing: 0.1px;
                }
                .input-group input { 
                    width: 100%; 
                    padding: 10px 14px; 
                    border: 1px solid rgba(0,0,0,0.1); 
                    border-radius: 10px; 
                    font-size: 14px; 
                    font-weight: 400;
                    color: var(--text-primary);
                    background: #fafbfc;
                    transition: all 0.2s ease; 
                    outline: none;
                }
                .input-group input:hover { border-color: rgba(0,0,0,0.18); background: #fff; }
                .input-group input:focus { 
                    border-color: var(--accent); 
                    box-shadow: 0 0 0 3px rgba(0,113,227,0.08); 
                    background: #fff;
                }
                
                /* Bulk Assignment Bar */
                .bulk-assign-bar {
                    flex-shrink: 0;
                    display: flex;
                    align-items: center;
                    gap: 16px;
                    padding: 10px 16px;
                    background: linear-gradient(135deg, #f0f4ff 0%, #f8faff 100%);
                    border: 1px solid rgba(99,102,241,0.12);
                    border-left: 3px solid #6366f1;
                    border-radius: 12px;
                }
                .bulk-label {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    font-size: 13px;
                    font-weight: 600;
                    color: #4f46e5;
                    white-space: nowrap;
                    letter-spacing: -0.1px;
                }
                .bulk-label .material-icons-round { color: #6366f1; }
                .bulk-controls { display: flex; gap: 10px; flex: 1; }

                /* Matrix Container */
                .matrix-wrapper.full-height { 
                    flex: 1; 
                    display: flex; 
                    flex-direction: column; 
                    background: white; 
                    border-radius: 14px; 
                    border: 1px solid rgba(0,0,0,0.06); 
                    overflow: hidden; 
                    box-shadow: 0 2px 12px rgba(0,0,0,0.06), 0 0 0 1px rgba(0,0,0,0.02);
                }
                .mw-header { 
                    display: flex; 
                    background: #fafbfc;
                    border-bottom: 1px solid rgba(0,0,0,0.06); 
                    position: sticky;
                    top: 0;
                    z-index: 5;
                }
                .mw-body { flex: 1; overflow-y: auto; }
                .m-row { display: flex; border-bottom: 1px solid rgba(0,0,0,0.04); transition: background 0.15s; }
                .m-row:hover { background: #f8f9fb; }
                .m-row:last-child { border-bottom: none; }
                .m-col { 
                    padding: 14px 16px; 
                    border-right: 1px solid rgba(0,0,0,0.04); 
                    display: flex; 
                    align-items: center; 
                }
                .m-col:last-child { border-right: none; }
                .m-col.product { 
                    width: 280px; 
                    flex-shrink: 0; 
                    flex-direction: column; 
                    align-items: flex-start; 
                    justify-content: center; 
                    gap: 3px; 
                    background: #fafbfc;
                }
                .m-col.product strong { font-size: 13px; font-weight: 600; color: var(--text-primary); letter-spacing: -0.1px; }
                .m-col.product small { font-size: 11px; color: var(--text-secondary); font-weight: 400; }
                .m-col.process { 
                    flex: 1; 
                    min-width: 160px; 
                    justify-content: center; 
                    flex-direction: column; 
                    gap: 6px; 
                }
                /* Process header titles in matrix */
                .process-header-title {
                    font-size: 10px;
                    font-weight: 700;
                    color: #64748b;
                    text-transform: uppercase;
                    letter-spacing: 1px;
                }
                .mw-header .m-col.process {
                    padding: 12px 12px;
                    gap: 8px;
                }
                .mw-header .m-col.product {
                    font-size: 11px;
                    font-weight: 600;
                    color: #64748b;
                    text-transform: uppercase;
                    letter-spacing: 0.8px;
                    padding: 12px 16px;
                }

                /* Worker Dropdown (wdd) — Modern Design */
                .wdd-trigger {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    width: 100%;
                    padding: 8px 12px;
                    border: 1px solid rgba(0,0,0,0.1);
                    border-radius: 10px;
                    background: #f8f9fb;
                    font-size: 13px;
                    font-weight: 500;
                    color: var(--text-primary);
                    cursor: pointer;
                    transition: all 0.2s ease;
                    text-align: left;
                    height: 38px;
                }
                .wdd-trigger:hover { 
                    border-color: rgba(0,0,0,0.18); 
                    background: #f0f2f5;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.04);
                }
                .wdd-trigger.compact { 
                    padding: 6px 10px; 
                    font-size: 12px; 
                    height: 34px; 
                    border-radius: 8px;
                    font-weight: 500;
                }
                .wdd-trigger.filled {
                    border-color: rgba(16,185,129,0.3);
                    background: linear-gradient(135deg, #ecfdf5 0%, #f0fdf4 100%);
                    color: #065f46;
                    font-weight: 600;
                    box-shadow: 0 1px 3px rgba(16,185,129,0.08);
                }
                .wdd-trigger.filled:hover {
                    border-color: rgba(16,185,129,0.5);
                    background: linear-gradient(135deg, #d1fae5 0%, #ecfdf5 100%);
                }
                .wdd-icon { 
                    font-size: 16px !important; 
                    flex-shrink: 0; 
                    color: #94a3b8;
                }
                .wdd-trigger.filled .wdd-icon { color: #059669; }
                .wdd-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
                .wdd-arrow { 
                    font-size: 18px !important; 
                    color: #94a3b8; 
                    flex-shrink: 0; 
                    line-height: 1;
                    transition: transform 0.2s ease; 
                }

                /* Dropdown Menu */
                .wdd-menu {
                    position: absolute;
                    top: calc(100% + 4px);
                    left: 0;
                    right: 0;
                    min-width: 220px;
                    background: white;
                    border: 1px solid rgba(0,0,0,0.08);
                    border-radius: 12px;
                    box-shadow: 0 8px 24px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.06);
                    z-index: 100;
                    overflow: hidden;
                    animation: wddFadeIn 0.15s ease-out;
                }
                @keyframes wddFadeIn {
                    from { opacity: 0; transform: translateY(-6px) scale(0.98); }
                    to { opacity: 1; transform: translateY(0) scale(1); }
                }
                .wdd-search {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 6px;
                    margin: 8px 8px 4px 8px;
                    background: #f5f7fa;
                    border-radius: 8px;
                    border: 1px solid transparent;
                    transition: all 0.15s ease;
                }
                .wdd-search:focus-within {
                    background: white;
                    border-color: rgba(0,113,227,0.3);
                    box-shadow: 0 0 0 2px rgba(0,113,227,0.06);
                }
                .wdd-search input {
                    border: none;
                    outline: none;
                    background: transparent;
                    font-size: 13px;
                    font-weight: 400;
                    width: 100%;
                    color: var(--text-primary);
                }
                .wdd-search input::placeholder { color: #b0b8c4; }
                .wdd-options {
                    max-height: 200px;
                    overflow-y: auto;
                    padding: 4px 6px 6px 6px;
                }
                .wdd-options::-webkit-scrollbar { width: 4px; }
                .wdd-options::-webkit-scrollbar-thumb { background: #d4d8de; border-radius: 4px; }
                .wdd-option {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    width: 100%;
                    padding: 8px 10px;
                    border: none;
                    background: transparent;
                    font-size: 13px;
                    font-weight: 450;
                    color: var(--text-primary);
                    cursor: pointer;
                    text-align: left;
                    border-radius: 8px;
                    transition: all 0.12s ease;
                }
                .wdd-option:hover { background: #f1f5f9; }
                .wdd-option.selected { 
                    background: #eff6ff; 
                    color: #1e40af; 
                    font-weight: 600;
                }
                .wdd-option-clear { border-bottom: 1px solid #f0f2f5; border-radius: 8px 8px 0 0; margin-bottom: 2px; }
                .wdd-name { flex: 1; }
                .wdd-role { 
                    font-size: 11px; 
                    color: #94a3b8; 
                    font-weight: 500;
                    background: #f1f5f9;
                    padding: 1px 6px;
                    border-radius: 4px;
                }
                .wdd-check { width: 16px; text-align: center; color: #3b82f6; font-weight: 700; font-size: 12px; }
                .wdd-empty { padding: 16px; text-align: center; color: #94a3b8; font-size: 13px; }

                /* Helper Pills — Refined */
                .helper-pill {
                    display: inline-flex;
                    align-items: center;
                    gap: 3px;
                    padding: 2px 8px;
                    background: linear-gradient(135deg, #eff6ff, #f0f7ff);
                    border: 1px solid rgba(59,130,246,0.15);
                    border-radius: 8px;
                    font-size: 11px;
                    font-weight: 500;
                    color: #2563eb;
                    line-height: 18px;
                    letter-spacing: -0.1px;
                }
                .helper-pill button {
                    background: none;
                    border: none;
                    color: #93c5fd;
                    cursor: pointer;
                    padding: 0 0 0 2px;
                    font-size: 12px;
                    line-height: 1;
                    transition: color 0.15s;
                }
                .helper-pill button:hover { color: #ef4444; }

                .helper-add-btn {
                    width: 22px;
                    height: 22px;
                    border-radius: 6px;
                    border: 1px solid rgba(59,130,246,0.2);
                    background: #f0f5ff;
                    color: #3b82f6;
                    font-size: 13px;
                    font-weight: 600;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: all 0.15s ease;
                    line-height: 1;
                }
                .helper-add-btn:hover { 
                    background: #dbeafe; 
                    border-color: #3b82f6; 
                    transform: scale(1.05);
                    box-shadow: 0 1px 4px rgba(59,130,246,0.15);
                }


                /* TABLET RESPONSIVE (768px - 1024px) */
                @media (max-width: 1024px) and (min-width: 768px) {
                    /* Header adjustments */
                    .wizard-header { 
                        grid-template-columns: 80px 1fr 80px; 
                        padding: 8px 12px; 
                    }
                    .step-title { font-size: 10px; }
                    .btn-nav { padding: 5px 12px; font-size: 11px; height: 28px; }
                    
                    /* Body padding */
                    .wizard-body { padding: 16px; }
                    
                    /* Step 1: Projects Grid */
                    .wz-grid { grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
                    .wz-card { padding: 16px; gap: 12px; }
                    .wz-card .material-icons-round { font-size: 24px; }
                    .card-title { font-size: 14px; }
                    
                    /* Step 2: Products */
                    .step-toolbar { flex-wrap: wrap; gap: 12px; padding: 10px 12px; }
                    .tb-left { flex-wrap: wrap; }
                    .tb-right { width: 100%; justify-content: space-between; }
                    .search-input { width: 100%; max-width: 100%; }
                    
                    /* Step 3: Processes */
                    .step-processes { padding: 30px 16px; }
                    .process-tag { padding: 10px 16px; font-size: 13px; }
                    .add-process-row { max-width: 100%; }
                    
                    /* Step 4: Matrix */
                    .details-top { flex-direction: column; gap: 12px; padding: 12px 16px; }
                    .m-col.product { width: 200px; }
                    .m-col.process { min-width: 140px; }
                    .process-header-title { font-size: 9px; letter-spacing: 0.8px; }
                    .m-col.process select { padding: 6px 10px; font-size: 12px; }
                }

                /* MOBILE RESPONSIVE (< 768px) */
                @media (max-width: 767px) {
                    .wizard-header { 
                        grid-template-columns: 60px 1fr 60px; 
                        padding: 6px 10px; 
                        height: 50px;
                    }
                    .step-title { display: none; }
                    .step-line { width: 10px; }
                    .btn-nav { padding: 4px 10px; font-size: 10px; height: 26px; }
                    .btn-nav .material-icons-round { font-size: 12px; }
                    
                    .wizard-body { padding: 12px; }
                    .step-page-header h3 { font-size: 18px; }
                    .step-page-header p { font-size: 13px; }
                    
                    /* Projects */
                    .wz-grid { grid-template-columns: 1fr; gap: 10px; }
                    
                    /* Products */
                    .step-toolbar { flex-direction: column; gap: 10px; align-items: stretch; }
                    .tb-left, .tb-right { width: 100%; }
                    .search-input { width: 100%; }
                    
                    /* Processes */
                    .step-processes { padding: 20px 12px; }
                    .add-process-row { flex-direction: column; }
                    
                    /* Matrix */
                    .details-top { flex-direction: column; padding: 10px 12px; }
                    .m-col.product { width: 150px; font-size: 12px; }
                    .m-col.process { min-width: 120px; }


                    /* MAIN LIST RESPONSIVE STYLES */
                    .content-header {
                        flex-direction: column;
                        align-items: stretch;
                        gap: 12px;
                    }
                    
                    .search-box {
                        width: 100%;
                    }
                    
                    .content-header > div:nth-child(2) {
                        flex-wrap: wrap;
                    }

                    .group-control {
                        flex: 1;
                    }

                    .filter-select {
                        flex: 1;
                    }

                    .btn-primary {
                        width: 100%;
                        justify-content: center;
                    }

                    /* Project Card Mobile */
                    .project-header {
                        flex-direction: column;
                        align-items: flex-start;
                        gap: 12px;
                        padding: 12px;
                        position: relative;
                    }

                    .expand-btn {
                        position: absolute;
                        top: 12px;
                        right: 12px;
                    }

                    .project-main-info {
                        width: 100%;
                        padding-right: 32px; /* space for expand button */
                    }

                    .project-title-section {
                        flex-direction: column;
                        align-items: flex-start;
                        gap: 2px;
                    }

                    .project-details {
                        flex-wrap: wrap;
                        gap: 8px;
                        margin-top: 8px;
                    }

                    /* Right side container - now bottom row */
                    .project-header > div:last-child {
                        width: 100%;
                        justify-content: space-between;
                        padding-top: 12px;
                        border-top: 1px dashed #f0f0f0;
                        margin-top: 4px;
                    }

                    .progress-mini {
                        margin-right: 0;
                        height: 28px;
                        font-size: 11px;
                    }

                    .project-badges {
                        height: 28px;
                    }

                    .status-badge {
                        height: 28px;
                        font-size: 10px;
                        padding: 0 8px;
                    }

                    .project-actions {
                        margin-left: 0;
                    }
                }
            `}</style>

            {/* Delete Confirmation Modal */}
            {deleteConfirmModal.isOpen && (
                <div className="delete-modal-overlay" onClick={() => setDeleteConfirmModal({ isOpen: false, workOrderId: null, workOrderNumber: '' })}>
                    <div className="delete-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="delete-modal-header">
                            <h3>🗑️ Obriši nalog {deleteConfirmModal.workOrderNumber}</h3>
                        </div>
                        <div className="delete-modal-body">
                            <p>Šta želite uraditi sa proizvodima iz ovog naloga?</p>
                            <div className="delete-options">
                                <button
                                    className="delete-option option-completed"
                                    onClick={() => confirmDeleteWorkOrder('completed')}
                                >
                                    <span className="option-icon">✅</span>
                                    <div className="option-content">
                                        <strong>Završi proizvode</strong>
                                        <span>Postavi status na "Spremno" (bez kalkulacije profita)</span>
                                    </div>
                                </button>
                                <button
                                    className="delete-option option-waiting"
                                    onClick={() => confirmDeleteWorkOrder('waiting')}
                                >
                                    <span className="option-icon">⏳</span>
                                    <div className="option-content">
                                        <strong>Vrati na čekanje</strong>
                                        <span>Postavi status na "Na čekanju"</span>
                                    </div>
                                </button>
                            </div>
                        </div>
                        <div className="delete-modal-footer">
                            <button
                                className="cancel-btn"
                                onClick={() => setDeleteConfirmModal({ isOpen: false, workOrderId: null, workOrderNumber: '' })}
                            >
                                Odustani
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <style jsx>{`
                .delete-modal-overlay {
                    position: fixed;
                    inset: 0;
                    background: rgba(15, 23, 42, 0.6);
                    backdrop-filter: blur(4px);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 1000;
                    animation: fadeIn 0.2s ease-out;
                }

                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }

                .delete-modal {
                    background: white;
                    border-radius: 20px;
                    width: 100%;
                    max-width: 440px;
                    box-shadow: 0 25px 50px rgba(0, 0, 0, 0.2);
                    animation: slideUp 0.3s ease-out;
                    overflow: hidden;
                }

                @keyframes slideUp {
                    from {
                        opacity: 0;
                        transform: translateY(20px) scale(0.95);
                    }
                    to {
                        opacity: 1;
                        transform: translateY(0) scale(1);
                    }
                }

                .delete-modal-header {
                    padding: 20px 24px;
                    border-bottom: 1px solid #e2e8f0;
                }

                .delete-modal-header h3 {
                    margin: 0;
                    font-size: 18px;
                    font-weight: 700;
                    color: #1e293b;
                }

                .delete-modal-body {
                    padding: 24px;
                }

                .delete-modal-body p {
                    margin: 0 0 20px 0;
                    color: #64748b;
                    font-size: 14px;
                }

                .delete-options {
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                }

                .delete-option {
                    display: flex;
                    align-items: flex-start;
                    gap: 14px;
                    padding: 16px;
                    border: 2px solid #e2e8f0;
                    border-radius: 12px;
                    background: white;
                    cursor: pointer;
                    text-align: left;
                    transition: all 0.2s;
                }

                .delete-option:hover {
                    border-color: #94a3b8;
                    background: #f8fafc;
                }

                .delete-option.option-completed:hover {
                    border-color: #10b981;
                    background: rgba(16, 185, 129, 0.05);
                }

                .delete-option.option-waiting:hover {
                    border-color: #f59e0b;
                    background: rgba(245, 158, 11, 0.05);
                }

                .option-icon {
                    font-size: 24px;
                }

                .option-content {
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                }

                .option-content strong {
                    font-size: 15px;
                    color: #1e293b;
                }

                .option-content span {
                    font-size: 13px;
                    color: #64748b;
                }

                .delete-modal-footer {
                    padding: 16px 24px;
                    border-top: 1px solid #e2e8f0;
                    display: flex;
                    justify-content: flex-end;
                }

                .cancel-btn {
                    padding: 10px 20px;
                    border: 1px solid #e2e8f0;
                    background: white;
                    border-radius: 10px;
                    font-size: 14px;
                    font-weight: 500;
                    color: #64748b;
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .cancel-btn:hover {
                    background: #f8fafc;
                    color: #1e293b;
                }
            `}</style>

            {/* Profit Analysis Modal */}
            {profitModalWorkOrder && (
                <Modal
                    isOpen={true}
                    onClose={() => setProfitModalWorkOrder(null)}
                    title={`Profit: ${profitModalWorkOrder.Name || profitModalWorkOrder.Work_Order_Number}`}
                    size="large"
                >
                    {(() => {
                        const wo = profitModalWorkOrder;
                        const totalValue = wo.items?.reduce((sum, item) => sum + (item.Product_Value || 0), 0) || 0;
                        const materialCost = wo.items?.reduce((sum, item) => sum + (item.Material_Cost || 0), 0) || 0;
                        const laborCost = wo.items?.reduce((sum, item) => sum + (item.Actual_Labor_Cost || 0), 0) || 0;
                        const plannedLaborCost = wo.items?.reduce((sum, item) => sum + (item.Planned_Labor_Cost || 0), 0) || 0;
                        const transportCost = wo.items?.reduce((sum, item) => sum + (item.Transport_Share || 0), 0) || 0;
                        const servicesCost = wo.items?.reduce((sum, item) => sum + (item.Services_Total || 0), 0) || 0;
                        const plannedWorkers = wo.items?.reduce((sum, item) => sum + (item.Planned_Labor_Workers || 0), 0) || 0;
                        const plannedDays = wo.items?.reduce((sum, item) => sum + (item.Planned_Labor_Days || 0), 0) || 0;
                        const plannedRate = (wo.items?.reduce((sum, item) => sum + (item.Planned_Labor_Rate || 0), 0) || 0) / (wo.items?.length || 1);
                        const actualDays = wo.items?.reduce((sum, item) => sum + (item.Actual_Labor_Days || 0), 0) || 0;
                        const actualWorkers = wo.items?.reduce((sum, item) => sum + (item.Actual_Workers_Count || 0), 0) || 0;

                        return (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
                                <ProfitOverviewWidget
                                    title="Pregled Troškova i Profita"
                                    subtitle={wo.Name || wo.Work_Order_Number}
                                    totalValue={totalValue}
                                    materialCost={materialCost}
                                    transportCost={transportCost}
                                    servicesCost={servicesCost}
                                    laborCost={laborCost}
                                    plannedLaborCost={plannedLaborCost}
                                />
                                <PlanVsActualCard
                                    plannedWorkers={plannedWorkers}
                                    actualWorkers={actualWorkers}
                                    plannedDays={plannedDays}
                                    actualDays={actualDays}
                                    plannedRate={plannedRate}
                                    actualRate={laborCost > 0 && actualDays > 0 ? laborCost / actualDays : 0}
                                    plannedCost={plannedLaborCost}
                                    actualCost={laborCost}
                                />
                            </div>
                        );
                    })()}
                </Modal>
            )}
            {priceEditWorkOrder && (
                <PriceEditModal
                    workOrder={priceEditWorkOrder}
                    onClose={() => setPriceEditWorkOrder(null)}
                    onSaved={() => onRefresh('workOrders')}
                    showToast={showToast}
                />
            )}
            {attendanceFixWorkOrder && organizationId && (
                <AttendanceFixModal
                    workOrder={attendanceFixWorkOrder}
                    organizationId={organizationId}
                    warnings={attendanceWarnings?.warnings}
                    onClose={() => setAttendanceFixWorkOrder(null)}
                    onSaved={() => onRefresh('workOrders')}
                    showToast={showToast}
                />
            )}
        </div >
    );
}



