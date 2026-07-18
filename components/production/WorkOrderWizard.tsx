'use client';

// ════════════════════════════════════════════════════════════════════
// WIZARD NOVOG RADNOG NALOGA (proizvodnja + montaža) — izdvojen iz
// ProductionTab.tsx (razbijanje monolita, bez promjene ponašanja).
// Sav wizard state, odabir proizvoda, dodjela radnika, auto-rok i
// kreiranje naloga žive OVDJE; ProductionTab samo otvara/zatvara.
// ════════════════════════════════════════════════════════════════════

import { useState, useMemo, useEffect } from 'react';
import type { WorkOrder, Project, Worker, Task } from '@/lib/types';
import { MONTAZA_STEPS } from '@/lib/types';
import { createWorkOrder, getAllAttendanceByMonth } from '@/lib/services';
import { workOrderDueDate, todayISO, buildSaturdayChecker } from '@/lib/planning';
import { planToStages, flattenStages } from '@/lib/productProcesses';
import { emptyTaskSelection, taskSelectionCount, taskProductIds, isTaskOpen, type TaskAttachSelection } from '@/lib/workOrderTasks';
import Modal from '@/components/ui/Modal';
import TaskAttachEditor from '@/components/ui/TaskAttachEditor';
import MaterialOrderSelectModal from '@/components/ui/MaterialOrderSelectModal';

export type WizardMode = 'production' | 'montaza';

/** Predselekcija proizvoda (dolazi iz ProjectsTab → "Kreiraj nalog"). */
export interface WizardInitialProducts {
    projectId: string;
    projectName: string;
    products: { productId: string; productName: string; quantity: number }[];
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

// Ključ dodjele ekipe u PROIZVODNJI: jedan radnik (+pomoćnici) važi za SVE procese
// plana proizvoda. NIJE naziv procesa i nikad ne smije završiti u item.Processes —
// procesi proizvodnog naloga dolaze ISKLJUČIVO iz plana procesa proizvoda. (Ranije je
// ovdje stajao generički 'Rad', pa se proizvod bez plana kreirao s procesom „Rad".)
const CREW_KEY = '__crew__';
const procLabel = (proc: string) => (proc === CREW_KEY ? 'Radnik / ekipa' : proc);

// Iskorištena količina proizvoda kroz sve NE-OTKAZANE naloge (završeni troše količinu).
// Jedini kriterij dostupnosti — koriste ga i lista wizarda (eligibleProducts) i guard
// pri kreiranju, da ponuđeno i dozvoljeno nikad ne odstupe.
function usedQuantityForProduct(workOrders: WorkOrder[], productId: string): number {
    let used = 0;
    workOrders.forEach(wo => {
        if (wo.Status === 'Otkazano') return;
        wo.items?.forEach(item => {
            if (item.Product_ID === productId) used += item.Quantity || 0;
        });
    });
    return used;
}

interface WorkOrderWizardProps {
    isOpen: boolean;
    mode: WizardMode;
    workOrders: WorkOrder[];
    projects: Project[];
    workers: Worker[];
    /** Svi zadaci organizacije — za „Poveži postojeći" pri kreiranju. */
    tasks?: Task[];
    organizationId: string | null;
    initialProducts?: WizardInitialProducts | null;
    onClose: () => void;
    onRefresh: (...collections: string[]) => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

export default function WorkOrderWizard({
    isOpen,
    mode,
    workOrders,
    projects,
    workers,
    tasks = [],
    organizationId,
    initialProducts,
    onClose,
    onRefresh,
    showToast,
}: WorkOrderWizardProps) {
    const [activeStep, setActiveStep] = useState(0); // production: 0=Proizvodi, 1=Radnik & rok; montaža: 0=Proizvodi, 1=Procesi, 2=Dodjela
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
    }, [projects]);

    // Data State
    const [selectedProducts, setSelectedProducts] = useState<ProductSelection[]>([]);
    const [selectedProcesses, setSelectedProcesses] = useState<string[]>(['Priprema', 'Sklapanje', 'Farbanje', 'Montaža']);
    const [customProcessInput, setCustomProcessInput] = useState('');
    const [dueDate, setDueDate] = useState('');
    const [startDate, setStartDate] = useState(todayISO());
    const [workOrderName, setWorkOrderName] = useState('');
    const [notes, setNotes] = useState('');
    const [productSearch, setProductSearch] = useState('');

    // Worker search dropdown state for step 4
    const [openDropdown, setOpenDropdown] = useState<string | null>(null);
    const [workerSearch, setWorkerSearch] = useState('');
    // Poslije kreiranja naloga, predloži narudžbe za nedostajuće materijale — korisnik
    // BIRA dobavljače/materijale u MaterialOrderSelectModal, ništa se ne kreira tiho.
    const [createMaterialOrders, setCreateMaterialOrders] = useState(true);
    const [orderSelectPrompt, setOrderSelectPrompt] = useState<{ workOrderId: string; label: string; startDate: string } | null>(null);

    // ── ZADACI: skupljaju se ovdje, vezuju se TEK kad nalog nastane ──
    const [taskSelection, setTaskSelection] = useState<TaskAttachSelection>(emptyTaskSelection);
    // Otvoreni zadaci koji se već tiču nekog od odabranih proizvoda — istaknu se
    // u izborniku, da se ono što stoji u tabu Zadaci ne izgubi pri kreiranju naloga.
    const suggestedTaskIds = useMemo(() => {
        const chosen = new Set(selectedProducts.map(p => p.Product_ID));
        if (chosen.size === 0) return [];
        return tasks
            .filter(t => isTaskOpen(t) && taskProductIds(t).some(id => chosen.has(id)))
            .map(t => t.Task_ID);
    }, [tasks, selectedProducts]);

    // ── AUTO-ROK: rok = danas + Σ planiranih radnih dana po proizvodu (iz ponude) ──
    // Sekvencijalno (kao u zahtjevu: 2 proizvoda × 2 dana = 4 dana). Subota se računa,
    // nedjelje se preskaču, A subote uvažavaju ROTACIJU po radniku iz šihtarice (vidi lib/planning.ts).
    const totalPlannedDays = useMemo(() => {
        // Montaža: stavke se kreiraju s NULIRANIM planiranim danima (isMontazaMode),
        // pa proizvodni Labor_Days iz ponude NE smiju hraniti prijedlog roka montaže.
        if (mode === 'montaza') return 0;
        return selectedProducts.reduce((sum, p) => {
            const project = projects.find(pr => pr.Project_ID === p.Project_ID);
            const offer = project?.offers?.find(o => o.Status === 'Prihvaćeno');
            const op = offer?.products?.find(x => x.Product_ID === p.Product_ID);
            return sum + (op?.Labor_Days || 0);
        }, 0);
    }, [selectedProducts, projects, mode]);

    // Dodijeljeni radnici (glavni + pomoćnici) — za subotnju rotaciju u roku.
    const assignedWorkerIds = useMemo(() => {
        const s = new Set<string>();
        selectedProducts.forEach(p => {
            Object.values(p.assignments || {}).forEach(id => { if (id) s.add(id); });
            Object.values(p.helperAssignments || {}).forEach(arr => (arr || []).forEach(id => { if (id) s.add(id); }));
        });
        return Array.from(s);
    }, [selectedProducts]);

    // Šihtarica (tekući + prethodni mjesec) — izvor za alternaciju subota; učita se na koraku "Radnik & rok".
    const [wizardAttendance, setWizardAttendance] = useState<{ Worker_ID: string; Date: string; Status: string }[]>([]);
    useEffect(() => {
        if (!organizationId || activeStep !== 1 || mode !== 'production') return;
        let cancelled = false;
        (async () => {
            const now = new Date();
            const prevD = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            const [cur, prev] = await Promise.all([
                getAllAttendanceByMonth(String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'), organizationId),
                getAllAttendanceByMonth(String(prevD.getFullYear()), String(prevD.getMonth() + 1).padStart(2, '0'), organizationId),
            ]);
            if (!cancelled) setWizardAttendance([...prev, ...cur].map(a => ({ Worker_ID: a.Worker_ID, Date: a.Date, Status: a.Status })));
        })().catch(e => console.warn('wizard attendance load failed', e));
        return () => { cancelled = true; };
    }, [organizationId, activeStep, mode]);

    const suggestedDueDate = useMemo(() => {
        if (totalPlannedDays <= 0) return '';
        const checker = buildSaturdayChecker(assignedWorkerIds, wizardAttendance);
        return workOrderDueDate(startDate || todayISO(), totalPlannedDays, checker);
    }, [totalPlannedDays, assignedWorkerIds, wizardAttendance, startDate]);

    // Auto-popuni rok kad uđemo u posljednji korak ("Radnik & rok" / "Dodjela") ako još nije postavljen (ostaje uredljiv).
    useEffect(() => {
        const onLastStep = (mode === 'production' && activeStep === 1) || (mode === 'montaza' && activeStep === 2);
        if (onLastStep && !dueDate && suggestedDueDate) {
            setDueDate(suggestedDueDate);
        }
    }, [activeStep, suggestedDueDate, dueDate, mode]);

    // Finansijski sažetak odabira (isti izvori kao handleCreateWorkOrder) — korisnik
    // vidi šta kreira PRIJE klika na "Kreiraj"; bez ponude → upozorenje odmah, ne post-hoc toast.
    // "Ostaje" ovdje oduzima i PLANIRANI rad (procjena), za razliku od početnog WO profita.
    const wizardFin = useMemo(() => {
        if (mode === 'montaza' || selectedProducts.length === 0) return null;
        let value = 0, material = 0, transport = 0, services = 0, plannedLabor = 0;
        selectedProducts.forEach(p => {
            const project = projects.find(proj => proj.Project_ID === p.Project_ID);
            const product = project?.products?.find(prod => prod.Product_ID === p.Product_ID);
            const offer = project?.offers?.find(o => o.Status === 'Prihvaćeno');
            const offerProduct = offer?.products?.find(op => op.Product_ID === p.Product_ID);
            if (offerProduct?.Selling_Price) value += offerProduct.Selling_Price * p.Work_Order_Quantity;
            transport += offerProduct?.Transport_Share || 0;
            services += (offerProduct?.extras || []).reduce((s: number, e: any) => s + (e.Total || 0), 0);
            if (product?.materials) {
                material += product.materials.reduce((sum, m) => sum + (m.Unit_Price * m.Quantity), 0) * p.Work_Order_Quantity;
            }
            plannedLabor += offerProduct
                ? (offerProduct.Labor_Workers || 1) * (offerProduct.Labor_Days || 0) * (offerProduct.Labor_Daily_Rate || 0)
                : 0;
        });
        const profit = value - material - transport - services - plannedLabor;
        return { value, material, transport, services, plannedLabor, profit, missingPrice: value <= 0 };
    }, [mode, selectedProducts, projects]);
    const fmtKM = (n: number) => `${Math.round(n).toLocaleString('hr-HR')} KM`;

    // Per-product advisory: proizvod bez cijene i/ili planiranih dana u prihvaćenoj ponudi.
    // Inkrementalni tok (dopunjavanje ponude proizvod-po-proizvod) je namjerno dozvoljen —
    // ovo je samo neblokirajuće upozorenje da će rok/profit za TAJ proizvod biti potcijenjeni.
    const undefinedProducts = useMemo(() => {
        if (mode === 'montaza' || selectedProducts.length === 0) return [];
        return selectedProducts.filter(p => {
            const project = projects.find(pr => pr.Project_ID === p.Project_ID);
            const offer = project?.offers?.find(o => o.Status === 'Prihvaćeno');
            const op = offer?.products?.find(x => x.Product_ID === p.Product_ID);
            return !op || !((op.Selling_Price || 0) > 0) || !((op.Labor_Days || 0) > 0);
        }).map(p => p.Product_Name);
    }, [mode, selectedProducts, projects]);

    // Reset pri SVAKOM otvaranju: mode-specifični defaulti + eventualna predselekcija
    // proizvoda iz ProjectsTab (tada se preskače korak odabira → pravo na "Radnik & rok").
    useEffect(() => {
        if (!isOpen) return;
        setActiveStep(0);
        setSelectedProcesses(mode === 'montaza' ? [...MONTAZA_STEPS] : [CREW_KEY]);
        setDueDate('');
        setStartDate(todayISO());
        setWorkOrderName('');
        setNotes('');
        setProductSearch('');
        setCustomProcessInput('');
        setCreateMaterialOrders(true);
        setOpenDropdown(null);
        setWorkerSearch('');
        setTaskSelection(emptyTaskSelection());
        if (mode === 'production' && initialProducts) {
            const { projectId, projectName, products: pendingProducts } = initialProducts;
            setSelectedProducts(pendingProducts.map(p => ({
                Product_ID: p.productId,
                Product_Name: p.productName,
                Project_ID: projectId,
                Project_Name: projectName,
                Quantity: p.quantity,
                Work_Order_Quantity: p.quantity,
                Status: '',
                assignments: { [CREW_KEY]: '' },
                helperAssignments: { [CREW_KEY]: [] },
            })));
            setActiveStep(1);
        } else {
            setSelectedProducts([]);
        }
    }, [isOpen, mode, initialProducts]);

    // Proizvodi svih kvalifikovanih projekata (sortedProjects već isključuje Završeno/Otkazano
    // i projekte sa svim spremnim proizvodima) — wizard više nema poseban korak izbora projekta.
    const eligibleProducts = useMemo(() => {
        let products: any[] = [];
        sortedProjects.forEach(project => {
            (project.products || []).forEach(product => {
                // Calculate quantity already used in work orders
                const usedQuantity = usedQuantityForProduct(workOrders, product.Product_ID);
                const totalQuantity = product.Quantity || 1;
                const availableQuantity = totalQuantity - usedQuantity;

                // Only include products with remaining quantity
                if (availableQuantity > 0) {
                    products.push({
                        Product_ID: product.Product_ID,
                        Product_Name: product.Name,
                        Project_ID: project.Project_ID,
                        Project_Name: project.Name || project.Client_Name,
                        Quantity: availableQuantity,  // Show available, not total
                        TotalQuantity: totalQuantity,
                        UsedQuantity: usedQuantity,
                        Status: product.Status,
                        Process_Plan: product.Process_Plan,       // legacy fallback
                        Process_Stages: product.Process_Stages,   // fazni plan (preview + sinteza grafa)
                        Process_Graph: product.Process_Graph,     // GRAF plana (grane) — primarni izvor sinteze naloga
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
    }, [sortedProjects, productSearch, workOrders]);

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
                    Project_Name: project.Name || project.Client_Name,
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

    // Step Logic — montaža has 3 steps (no project selection), production has 4
    const montazaSteps = [
        { id: 0, title: 'Proizvodi', subtitle: 'Odaberite spremne proizvode' },
        { id: 1, title: 'Procesi', subtitle: 'Definišite procese montaže' },
        { id: 2, title: 'Dodjela', subtitle: 'Raspored radnika' }
    ];

    // 2 koraka: proizvodi (grupisani po projektu) → radnik & rok. Projekat se izvodi iz proizvoda.
    const productionSteps = [
        { id: 0, title: 'Proizvodi', subtitle: 'Odaberite proizvode' },
        { id: 1, title: 'Radnik & rok', subtitle: 'Dodijelite radnika' }
    ];

    const steps = mode === 'montaza' ? montazaSteps : productionSteps;
    const lastStep = steps[steps.length - 1].id;

    const canGoNext = useMemo(() => {
        if (mode === 'montaza') {
            if (activeStep === 0) return selectedProducts.length > 0;
            if (activeStep === 1) return selectedProcesses.length > 0;
            return true;
        }
        // Production mode (2 koraka: Proizvodi → Radnik & rok)
        if (activeStep === 0) return selectedProducts.length > 0;
        return true;
    }, [activeStep, selectedProducts, selectedProcesses, mode]);

    function handleNext() {
        if (activeStep < lastStep && canGoNext) setActiveStep(activeStep + 1);
    }

    function handleBack() {
        if (activeStep > 0) setActiveStep(activeStep - 1);
    }

    // Selection Logic
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
        const isMontazaMode = mode === 'montaza';

        // S2.1: Guard po KOLIČINI — ista aritmetika kao eligibleProducts (usedQuantityForProduct),
        // pa lista i guard ne mogu odstupiti: blokira se SAMO kad tražena količina premašuje
        // preostalu (ukupno u projektu − iskorišteno u ne-otkazanim nalozima).
        // Montaža: kandidati su 'Spremno' proizvodi (količina već potrošena u proizvodnji),
        // pa se provjerava samo da proizvod nije u drugom aktivnom MONTAŽNOM nalogu.
        const duplicates: string[] = [];
        for (const sp of selectedProducts) {
            if (isMontazaMode) {
                const existing = workOrders.find(wo =>
                    wo.Work_Order_Type === 'Montaža' &&
                    wo.Status !== 'Završeno' &&
                    wo.Status !== 'Otkazano' &&
                    wo.items?.some(item => item.Product_ID === sp.Product_ID)
                );
                if (existing) duplicates.push(`${sp.Product_Name} (nalog ${existing.Work_Order_Number})`);
            } else {
                const project = projects.find(pr => pr.Project_ID === sp.Project_ID);
                const totalQuantity = project?.products?.find(p => p.Product_ID === sp.Product_ID)?.Quantity || 1;
                const remaining = totalQuantity - usedQuantityForProduct(workOrders, sp.Product_ID);
                if ((sp.Work_Order_Quantity || 1) > remaining) {
                    duplicates.push(`${sp.Product_Name} (traženo ${sp.Work_Order_Quantity || 1}, dostupno ${Math.max(0, remaining)})`);
                }
            }
        }
        if (duplicates.length > 0) {
            showToast(
                isMontazaMode
                    ? `Proizvodi su već u aktivnim montažnim nalozima: ${duplicates.join(', ')}`
                    : `Nedovoljna preostala količina: ${duplicates.join(', ')}`,
                'error'
            );
            return;
        }

        // Calculate Total_Value and Material_Cost from products
        // MONTAŽA FIX: Skip financial accumulation for montaža — only labor costs matter
        let totalValue = 0;
        let materialCost = 0;
        let totalTransport = 0;
        let totalServices = 0;

        if (!isMontazaMode) {
            selectedProducts.forEach(p => {
                // Get product data from project
                const project = projects.find(proj => proj.Project_ID === p.Project_ID);
                const product = project?.products?.find(prod => prod.Product_ID === p.Product_ID);

                // Get offer product for selling price
                const offer = project?.offers?.find(o => o.Status === 'Prihvaćeno');
                const offerProduct = offer?.products?.find(op => op.Product_ID === p.Product_ID);

                // Prihod je UKUPAN (jedinična × količina naloga).
                if (offerProduct?.Selling_Price) {
                    totalValue += offerProduct.Selling_Price * p.Work_Order_Quantity;
                }

                // Transport and services from offer
                totalTransport += offerProduct?.Transport_Share || 0;
                totalServices += (offerProduct?.extras || []).reduce((s: number, e: any) => s + (e.Total || 0), 0);

                // Materijal: Σ product_materials je PO KOMADU → WO-agregat je × količina (kao prihod).
                if (product?.materials) {
                    const productMaterialCost = product.materials.reduce((sum, m) =>
                        sum + (m.Unit_Price * m.Quantity), 0);
                    materialCost += productMaterialCost * p.Work_Order_Quantity;
                }
            });
        }

        // AUTO-PLAN PROCESA: proizvod bez plana + ima materijale → izvedi fazni plan iz materijala
        // (pravila+tipovi+kombinacije, mapirano na šablon) da nalog ne krene bez ijednog procesa.
        // Fire-and-forget snimimo plan na proizvod (za buduće naloge). Rezultat: autoPlanByProduct.
        const autoPlanByProduct = new Map<string, string[][]>();
        if (!isMontazaMode && organizationId) {
            const needing = selectedProducts.filter(p => {
                const product = projects.find(proj => proj.Project_ID === p.Project_ID)?.products?.find(pr => pr.Product_ID === p.Product_ID);
                const has = planToStages(product?.Process_Stages, product?.Process_Plan).length > 0;
                return !has && (product?.materials?.length || 0) > 0;
            });
            if (needing.length) {
                try {
                    const { getProcessMaterialRules, getProcessCatalog, getProcessStageTemplates } = await import('@/lib/services');
                    const { buildAutoPlan } = await import('@/lib/processAutoPlan');
                    const [rules, catalog, templates] = await Promise.all([
                        getProcessMaterialRules(organizationId), getProcessCatalog(organizationId), getProcessStageTemplates(organizationId),
                    ]);
                    for (const p of needing) {
                        const product = projects.find(proj => proj.Project_ID === p.Project_ID)?.products?.find(pr => pr.Product_ID === p.Product_ID);
                        const lite = (product?.materials || []).map(m => ({ Material_Name: m.Material_Name }));
                        const r = buildAutoPlan(lite, rules, catalog, templates);
                        if (r.stages.length) autoPlanByProduct.set(p.Product_ID, r.stages);
                    }
                } catch (e) { console.warn('auto-plan procesa (wizard) preskočen:', e); }
            }
        }

        const items = selectedProducts.map(p => {
            // Get offer product for Product_Value
            const project = projects.find(proj => proj.Project_ID === p.Project_ID);
            const offer = project?.offers?.find(o => o.Status === 'Prihvaćeno');
            const offerProduct = offer?.products?.find(op => op.Product_ID === p.Product_ID);
            const product = project?.products?.find(prod => prod.Product_ID === p.Product_ID);
            // Plan proizvoda; ako ga nema → auto-plan izveden gore iz materijala.
            const productStages = (() => {
                const s = planToStages(product?.Process_Stages, product?.Process_Plan);
                return s.length ? s : (autoPlanByProduct.get(p.Product_ID) || []);
            })();

            // Trošak materijala stavke = PO KOMADU (invarijanta baze; agregacija × količina radi drugdje).
            let itemMaterialCost = 0;
            if (product?.materials) {
                itemMaterialCost = product.materials.reduce((sum, m) =>
                    sum + (m.Unit_Price * m.Quantity), 0);
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
                // Planirani dani/radnici/dnevnica iz ponude — koristi se za AUTO-ROK (rok = početak + Σ dani)
                Planned_Labor_Days: isMontazaMode ? 0 : (offerProduct?.Labor_Days || undefined),
                Planned_Labor_Workers: isMontazaMode ? 0 : (offerProduct?.Labor_Workers || undefined),
                Planned_Labor_Rate: isMontazaMode ? 0 : (offerProduct?.Labor_Daily_Rate || undefined),
                // PROCESI STAVKE:
                //  • proizvodnja → ISKLJUČIVO iz plana procesa proizvoda (ekipa naloga radi sve
                //    procese, pa se radnik + pomoćnici iz jedne dodjele (CREW_KEY) vežu na svaki).
                //    Proizvod bez plana → [] (procesi se postave kasnije kroz graf/Procesi tab);
                //    NIKAD generički placeholder proces.
                //  • montaža → fiksni koraci (selectedProcesses), dodjela po koraku.
                Processes: (() => {
                    const buildFor = (procNames: string[], assignKey: (name: string) => string) => procNames.map(name => {
                        const key = assignKey(name);
                        const workerId = p.assignments[key];
                        const worker = workers.find(w => w.Worker_ID === workerId);
                        return {
                            Process_Name: name,
                            Status: 'Na čekanju',
                            Worker_ID: workerId || undefined,
                            Worker_Name: worker?.Name || undefined,
                            Helpers: (p.helperAssignments?.[key] || []).map(hId => {
                                const h = workers.find(w => w.Worker_ID === hId);
                                return { Worker_ID: hId, Worker_Name: h?.Name || 'Nepoznat' };
                            })
                        };
                    });
                    if (isMontazaMode) return buildFor(selectedProcesses, name => name);
                    return productStages.length ? buildFor(flattenStages(productStages), () => CREW_KEY) : [];
                })(),
                // Fazni plan za sintezu grafa naloga (paralelno unutar faze; isti proces = jedan čvor)
                Process_Stages: (() => {
                    if (isMontazaMode) return undefined;
                    return productStages.length ? productStages.map(s => ({ processes: s })) : undefined;
                })(),
                // GRAF plana proizvoda (grane po materijalu) — primarni izvor objedinjavanja u nalogu
                Process_Graph: (!isMontazaMode && (p as any).Process_Graph?.nodes?.length) ? (p as any).Process_Graph : undefined,
                // Montaža: link back to source production work order
                ...(p.Source_Work_Order_ID && { Source_Work_Order_ID: p.Source_Work_Order_ID }),
            };
        });

        // GAP-2: Warn if no offer pricing exists
        if (totalValue === 0) {
            showToast('⚠️ Nema prihvaćene ponude — cijena proizvoda nije poznata. Profit neće biti tačan dok ručno ne unesete cijenu.', 'error');
        } else if (!isMontazaMode && undefinedProducts.length > 0) {
            showToast(`⚠️ Nedefinisani proizvodi (cijena/rok): ${undefinedProducts.join(', ')} — rok i profit će biti potcijenjeni dok se ponuda ne dopuni.`, 'error');
        }

        // Calculate initial profit — now includes Transport + Services (GAP-1 fix)
        const profit = totalValue - materialCost - totalTransport - totalServices;
        const profitMargin = totalValue > 0 ? (profit / totalValue) * 100 : 0;

        const result = await createWorkOrder({
            Work_Order_Type: mode === 'montaza' ? 'Montaža' : 'Proizvodnja',
            // Proizvodnja: koraci naloga = unija procesa iz planova proizvoda — createWorkOrder ih
            // izvodi iz sintetisanog grafa. CREW_KEY je ključ dodjele, ne proces, i ne smije procuriti.
            Production_Steps: isMontazaMode ? selectedProcesses : [],
            Name: workOrderName.trim() || undefined,
            Due_Date: dueDate,
            Planned_Start_Date: startDate || undefined,
            Notes: notes,
            Total_Value: isMontazaMode ? 0 : (totalValue > 0 ? totalValue : undefined),
            Material_Cost: isMontazaMode ? 0 : (materialCost > 0 ? materialCost : undefined),
            Profit: isMontazaMode ? 0 : (profit > 0 ? profit : undefined),
            Profit_Margin: isMontazaMode ? 0 : (profitMargin > 0 ? profitMargin : undefined),
            items: items as any,
        }, organizationId || '');

        if (result.success) {
            showToast(`Radni nalog ${result.data?.Work_Order_Number} kreiran`, 'success');

            // Zadaci — sada nalog postoji, pa se veza može upisati. Greška ovdje
            // NE ruši nalog (već je kreiran): javi se i nastavi, zadaci se mogu
            // dodati i kasnije kroz tab „Zadaci" na kartici.
            if (taskSelectionCount(taskSelection) > 0 && result.data?.Work_Order_ID && organizationId) {
                try {
                    const { attachTasksToWorkOrder, getWorkOrder } = await import('@/lib/services');
                    const created = await getWorkOrder(result.data.Work_Order_ID, organizationId);
                    const res = await attachTasksToWorkOrder(
                        taskSelection,
                        { Work_Order_ID: result.data.Work_Order_ID, displayName: workOrderName.trim() || result.data.Work_Order_Number },
                        (created?.items || []).map(i => ({ Product_ID: i.Product_ID, Product_Name: i.Product_Name })),
                        organizationId
                    );
                    if (res.success) { showToast(res.message, 'success'); onRefresh('tasks'); }
                    else showToast(res.message, 'error');
                } catch (e) {
                    console.error('attach tasks to new work order failed', e);
                    showToast('Nalog kreiran, ali zadaci nisu vezani — dodaj ih na kartici naloga', 'error');
                }
            }

            // Fire-and-forget: snimi izvedene auto-planove na proizvode (za buduće naloge).
            if (autoPlanByProduct.size && organizationId) {
                import('@/lib/services').then(({ saveProductProcessStages }) => {
                    autoPlanByProduct.forEach((stages, productId) => {
                        saveProductProcessStages(productId, stages.map(s => ({ processes: s })), organizationId, 'auto').catch(() => { });
                    });
                }).catch(() => { });
            }
            // Advisory: proizvodi bez plana i bez materijala → kreirani BEZ procesa (postave se naknadno).
            if (!isMontazaMode) {
                const noPlan = selectedProducts.filter(p => {
                    const product = projects.find(proj => proj.Project_ID === p.Project_ID)?.products?.find(pr => pr.Product_ID === p.Product_ID);
                    const has = planToStages(product?.Process_Stages, product?.Process_Plan).length > 0 || autoPlanByProduct.has(p.Product_ID);
                    return !has;
                }).map(p => p.Product_Name);
                if (noPlan.length) showToast(`Bez plana procesa: ${noPlan.join(', ')} — postavi procese u tabu Procesi ili dodaj pravila materijal→proces`, 'info');
            }
            onClose();

            // Predloži narudžbe nedostajućih materijala — otvara modal gdje korisnik
            // BIRA dobavljače/materijale (MaterialOrderSelectModal), umjesto tihog
            // kreiranja svega. Modal sam prijavi "sve pokriveno" ako plan ispadne prazan.
            if (createMaterialOrders && !isMontazaMode && result.data?.Work_Order_ID && organizationId) {
                setOrderSelectPrompt({
                    workOrderId: result.data.Work_Order_ID,
                    label: workOrderName.trim() || result.data.Work_Order_Number,
                    startDate: startDate || todayISO(),
                });
            }

            onRefresh('workOrders', 'projects');
        } else {
            showToast(result.message, 'error');
        }
    }


    return (
        <>
            {/* ========== FULL-SCREEN WIZARD MODAL ========== */}
            <Modal isOpen={isOpen} onClose={onClose} title={mode === 'montaza' ? 'Montažni Nalog' : 'Novi Radni Nalog'} size="fullscreen" footer={null}>
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
                                    style={mode === 'montaza' ? { background: 'linear-gradient(135deg, #00C7BE 0%, #00a89e 100%)' } : undefined}
                                >
                                    Kreiraj
                                    <span className="material-icons-round">check</span>
                                </button>
                            ) : (
                                <button className="btn-nav next" onClick={handleNext} disabled={!canGoNext}
                                    style={mode === 'montaza' ? { background: 'linear-gradient(135deg, #00C7BE 0%, #00a89e 100%)' } : undefined}
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
                        {/* MONTAŽA STEP 0: Select Spremno Products */}
                        {activeStep === 0 && mode === 'montaza' && (
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

                        {/* PRODUCTION STEP 0: Products grouped by project (spojeni Projekti+Proizvodi korak) */}
                        {activeStep === 0 && mode === 'production' && (
                            <div className="wizard-step step-products">
                                <div className="step-toolbar sticky">
                                    <div className="tb-left">
                                        <h3>Odaberite proizvode</h3>
                                        <span className="tb-stats">{selectedProducts.length} odabrano</span>
                                    </div>
                                    <div className="tb-right">
                                        <div className="search-input">
                                            <span className="material-icons-round">search</span>
                                            <input placeholder="Pretraži proizvod ili projekat..." value={productSearch} onChange={e => setProductSearch(e.target.value)} autoFocus />
                                        </div>
                                        <button className="btn-text" onClick={selectAllProducts}>Odaberi sve</button>
                                        {selectedProducts.length > 0 && <button className="btn-text danger" onClick={() => setSelectedProducts([])}>Poništi</button>}
                                    </div>
                                </div>
                                <div className="wz-list-scroll">
                                    {eligibleProducts.length === 0 && (
                                        <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--text-secondary)' }}>
                                            <span className="material-icons-round" style={{ fontSize: '44px', opacity: 0.4, display: 'block', marginBottom: '10px' }}>inventory_2</span>
                                            Nema dostupnih proizvoda (svi su već u nalozima ili su projekti završeni)
                                        </div>
                                    )}
                                    {sortedProjects.map(proj => {
                                        const projProds = eligibleProducts.filter(p => p.Project_ID === proj.Project_ID);
                                        if (projProds.length === 0) return null;
                                        const selCount = projProds.filter(p => selectedProducts.some(s => s.Product_ID === p.Product_ID)).length;
                                        const allSelected = selCount === projProds.length;
                                        return (
                                            <div key={proj.Project_ID} style={{ marginBottom: '14px' }}>
                                                {/* Zaglavlje grupe = projekat */}
                                                <div style={{
                                                    display: 'flex', alignItems: 'center', gap: '10px',
                                                    padding: '8px 12px', background: 'var(--bg-tertiary, #f8fafc)',
                                                    borderRadius: '8px', marginBottom: '6px',
                                                    position: 'sticky', top: 0, zIndex: 2,
                                                }}>
                                                    <span style={{ fontWeight: 700, fontSize: '13px', color: 'var(--text-primary, #0f172a)' }}>{proj.Name || proj.Client_Name}</span>
                                                    {proj.Name && (
                                                        <span style={{ fontSize: '12px', color: 'var(--text-secondary, #64748b)' }}>· {proj.Client_Name}</span>
                                                    )}
                                                    <span style={{ fontSize: '12px', color: 'var(--text-secondary, #64748b)' }}>
                                                        {selCount > 0 ? `${selCount}/` : ''}{projProds.length} proizvoda
                                                    </span>
                                                    <button
                                                        className="btn-text"
                                                        style={{ marginLeft: 'auto', fontSize: '12px' }}
                                                        onClick={() => {
                                                            if (allSelected) {
                                                                setSelectedProducts(selectedProducts.filter(s => !projProds.some(p => p.Product_ID === s.Product_ID)));
                                                            } else {
                                                                const toAdd = projProds
                                                                    .filter(p => !selectedProducts.some(s => s.Product_ID === p.Product_ID))
                                                                    .map(p => ({
                                                                        ...p,
                                                                        Work_Order_Quantity: p.Quantity || 1,
                                                                        assignments: selectedProcesses.reduce((acc: Record<string, string>, proc) => ({ ...acc, [proc]: '' }), {}),
                                                                        helperAssignments: selectedProcesses.reduce((acc: Record<string, string[]>, proc) => ({ ...acc, [proc]: [] }), {}),
                                                                    }));
                                                                setSelectedProducts([...selectedProducts, ...toAdd]);
                                                            }
                                                        }}
                                                    >
                                                        {allSelected ? 'Poništi projekat' : 'Označi sve'}
                                                    </button>
                                                </div>
                                                <div className="wz-list">
                                                    {projProds.map(prod => {
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
                                                            <span className="li-sub">
                                                                {prod.Project_Name}
                                                                {/* Fazni plan procesa proizvoda (∥ = paralelno; graf naloga se sintetiše iz njega) */}
                                                                <span style={{ marginLeft: '8px', color: '#94a3b8', fontSize: '11px' }}>
                                                                    {(() => {
                                                                        const stages = planToStages(prod.Process_Stages, prod.Process_Plan);
                                                                        if (!stages.length) return '· Rad';
                                                                        const parts = stages.map(s => s.join(' ∥ '));
                                                                        return parts.length > 3
                                                                            ? `${parts.slice(0, 3).join(' → ')} +${parts.length - 3}`
                                                                            : parts.join(' → ');
                                                                    })()}
                                                                </span>
                                                            </span>
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
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* STEP 3: PROCESSES (production step 2, montaža step 1) */}
                        {(mode === 'montaza' && activeStep === 1) && (
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

                        {/* DETAILS & WORKERS (production step 1, montaža step 2) */}
                        {((mode === 'production' && activeStep === 1) || (mode === 'montaza' && activeStep === 2)) && (
                            <div className="wizard-step step-details" onClick={(e) => {
                                // Close dropdowns when clicking outside
                                if (!(e.target as HTMLElement).closest('.wdd')) { setOpenDropdown(null); setWorkerSearch(''); }
                            }}>
                                <div className="details-top">
                                    <div className="input-group full">
                                        <label>Naziv naloga</label>
                                        <input type="text" placeholder="npr. Kuhinja — Dino, Kuća (opcionalno)" value={workOrderName} onChange={e => setWorkOrderName(e.target.value)} />
                                    </div>
                                    <div className="input-group">
                                        <label>Početak</label>
                                        <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
                                    </div>
                                    <div className="input-group">
                                        <label>Rok završetka{totalPlannedDays > 0 ? ` · ${totalPlannedDays} planiranih radnih dana` : ''}</label>
                                        <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
                                        {suggestedDueDate && suggestedDueDate !== dueDate && (
                                            <button type="button" onClick={() => setDueDate(suggestedDueDate)}
                                                style={{ marginTop: 4, fontSize: 12, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}>
                                                ⤵ Predloženo iz planiranih dana: {suggestedDueDate}
                                            </button>
                                        )}
                                    </div>
                                    <div className="input-group full">
                                        <label>Napomena</label>
                                        <input type="text" placeholder="Dodatne upute za radnike..." value={notes} onChange={e => setNotes(e.target.value)} />
                                    </div>
                                </div>

                                {/* Zadaci uz nalog — vežu se čim nalog nastane */}
                                <div className="wizard-tasks">
                                    <TaskAttachEditor
                                        value={taskSelection}
                                        onChange={setTaskSelection}
                                        tasks={tasks}
                                        workers={workers}
                                        products={selectedProducts.map(p => ({ Product_ID: p.Product_ID, Product_Name: p.Product_Name }))}
                                        suggestedIds={suggestedTaskIds}
                                        pickerZIndex={2000}
                                    />
                                </div>

                                {/* Odmah naruči nedostajuće materijale (samo proizvodnja) */}
                                {mode === 'production' && (
                                    <label style={{
                                        display: 'flex', alignItems: 'center', gap: '8px',
                                        padding: '10px 14px', margin: '10px 0 0',
                                        background: 'var(--bg-tertiary, #f8fafc)', borderRadius: '10px',
                                        fontSize: '13px', color: 'var(--text-primary, #0f172a)', cursor: 'pointer',
                                        width: 'fit-content',
                                    }}>
                                        <input
                                            type="checkbox"
                                            checked={createMaterialOrders}
                                            onChange={e => setCreateMaterialOrders(e.target.checked)}
                                            style={{ width: 16, height: 16, accentColor: 'var(--accent, #0071e3)' }}
                                        />
                                        Poslije kreiranja predloži narudžbe za nedostajuće materijale
                                        <span style={{ fontSize: '11px', color: 'var(--text-secondary, #64748b)' }}>
                                            (biraš dobavljače i materijale prije nego što se narudžba stvarno kreira)
                                        </span>
                                    </label>
                                )}

                                {/* Finansijski sažetak — šta ovaj nalog nosi PRIJE kreiranja */}
                                {wizardFin && (
                                    <div className="wz-fin">
                                        <div className="wz-fin-item">
                                            <span>Vrijednost</span>
                                            <strong>{fmtKM(wizardFin.value)}</strong>
                                        </div>
                                        <div className="wz-fin-item">
                                            <span>Materijal</span>
                                            <strong>{fmtKM(wizardFin.material)}</strong>
                                        </div>
                                        <div className="wz-fin-item">
                                            <span>Planirani rad{totalPlannedDays > 0 ? ` (${totalPlannedDays} d)` : ''}</span>
                                            <strong>{fmtKM(wizardFin.plannedLabor)}</strong>
                                        </div>
                                        {(wizardFin.transport > 0 || wizardFin.services > 0) && (
                                            <div className="wz-fin-item">
                                                <span>Transport + usluge</span>
                                                <strong>{fmtKM(wizardFin.transport + wizardFin.services)}</strong>
                                            </div>
                                        )}
                                        <div className={`wz-fin-item wz-fin-profit ${wizardFin.profit >= 0 ? 'pos' : 'neg'}`}>
                                            <span>Procijenjeno ostaje</span>
                                            <strong>{fmtKM(wizardFin.profit)}</strong>
                                        </div>
                                        {wizardFin.missingPrice && (
                                            <div className="wz-fin-warn">
                                                <span className="material-icons-round" style={{ fontSize: '16px' }}>warning_amber</span>
                                                Nema prihvaćene ponude — cijena nije poznata, profit neće biti tačan
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Advisory: pojedini odabrani proizvodi nemaju cijenu/rok u ponudi (inkrementalni tok) */}
                                {undefinedProducts.length > 0 && (
                                    <div style={{
                                        display: 'flex', alignItems: 'flex-start', gap: '8px',
                                        padding: '10px 14px', margin: '10px 0 0',
                                        background: 'var(--warning-bg, #fff4e5)', border: '1px solid #fde68a',
                                        borderRadius: '10px', fontSize: '13px', color: '#92400e',
                                    }}>
                                        <span className="material-icons-round" style={{ fontSize: '18px' }}>warning_amber</span>
                                        <span>
                                            Nedefinisani proizvodi (cijena/rok): {undefinedProducts.join(', ')} — rok i profit će biti potcijenjeni dok se ponuda ne dopuni.
                                        </span>
                                    </div>
                                )}

                                {/* Advisory: bez radnika nalog se kasnije ne može pokrenuti (guard na startu) */}
                                {selectedProducts.length > 0 && selectedProducts.every(p => Object.values(p.assignments || {}).every(v => !v)) && (
                                    <div style={{
                                        display: 'flex', alignItems: 'center', gap: '8px',
                                        padding: '10px 14px', margin: '10px 0 0',
                                        background: 'var(--warning-bg, #fff4e5)', border: '1px solid #fde68a',
                                        borderRadius: '10px', fontSize: '13px', color: '#92400e',
                                    }}>
                                        <span className="material-icons-round" style={{ fontSize: '18px' }}>warning_amber</span>
                                        Nijedan radnik nije dodijeljen — nalog se neće moći pokrenuti dok ne dodijeliš radnika (možeš kreirati i dodijeliti kasnije).
                                    </div>
                                )}

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
                                                <span className="process-header-title">{procLabel(proc)}</span>
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

            {/* Izbor narudžbi materijala — otvara se TEK poslije uspješnog kreiranja
                naloga (orderSelectPrompt), neovisno o wizard-ovom Modal-u iznad koji
                se već zatvorio. Vidi handleCreateWorkOrder. */}
            {orderSelectPrompt && organizationId && (
                <MaterialOrderSelectModal
                    isOpen={true}
                    onClose={() => setOrderSelectPrompt(null)}
                    workOrderId={orderSelectPrompt.workOrderId}
                    workOrderLabel={orderSelectPrompt.label}
                    plannedStartDate={orderSelectPrompt.startDate}
                    organizationId={organizationId}
                    onRefresh={onRefresh}
                    showToast={showToast}
                />
            )}

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
                
                /* Finansijski sažetak wizarda */
                .wz-fin {
                    flex-shrink: 0;
                    display: flex;
                    align-items: center;
                    flex-wrap: wrap;
                    gap: 20px;
                    margin: 10px 0 0;
                    padding: 12px 18px;
                    background: white;
                    border: 1px solid rgba(0,0,0,0.06);
                    border-radius: 12px;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.05);
                }
                .wz-fin-item { display: flex; flex-direction: column; gap: 2px; }
                .wz-fin-item span { font-size: 11px; font-weight: 600; color: #64748b; }
                .wz-fin-item strong { font-size: 15px; font-weight: 700; color: var(--text-primary); }
                .wz-fin-profit { padding-left: 20px; border-left: 1px solid rgba(0,0,0,0.08); }
                .wz-fin-profit.pos strong { color: #059669; }
                .wz-fin-profit.neg strong { color: #dc2626; }
                .wz-fin-warn {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    font-size: 12px;
                    font-weight: 600;
                    color: #92400e;
                    background: #fff4e5;
                    padding: 6px 10px;
                    border-radius: 8px;
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

                }
            `}</style>
        </>
    );
}
