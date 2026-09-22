'use client';

// ════════════════════════════════════════════════════════════════════
// ČAROBNJAK NOVOG RADNOG NALOGA — LOGIKA (proizvodnja + montaža)
//
// Izdvojeno iz WorkOrderWizard.tsx da ISTU logiku koriste desktop čarobnjak
// i mobilni tok (MobileWorkOrderWizard): izbor proizvoda, dodjela ekipe,
// auto-rok iz ponude i šihtarice, finansijski sažetak, guard količine,
// auto-plan procesa, kreiranje naloga, vezivanje zadataka i prijedlog
// narudžbi materijala. Ekran samo crta — nalog kreiran s telefona je isti
// nalog kao s laptopa.
// ════════════════════════════════════════════════════════════════════

import { useState, useMemo, useEffect } from 'react';
import type { WorkOrder, Project, Worker, Task } from '@/lib/types';
import { MONTAZA_STEPS } from '@/lib/types';
import { createWorkOrder, getAllAttendanceByMonth } from '@/lib/services';
import { workOrderDueDate, todayISO, buildSaturdayChecker } from '@/lib/planning';
import { planToStages, flattenStages } from '@/lib/productProcesses';
import { emptyTaskSelection, taskSelectionCount, taskProductIds, isTaskOpen, type TaskAttachSelection } from '@/lib/workOrderTasks';

export type WizardMode = 'production' | 'montaza';

/** Predselekcija proizvoda (dolazi iz ProjectsTab → "Kreiraj nalog", ili s Platna). */
export interface WizardInitialProducts {
    projectId: string;
    projectName: string;
    products: { productId: string; productName: string; quantity: number }[];
    /** Pred-popuni Početak/Rok (iz plan-bloka na Platnu). */
    startDate?: string;
    dueDate?: string;
    /** Ekipa iz plan-bloka: prvi = glavni, ostali = pomoćnici. Vežu se na sve procese. */
    workerIds?: string[];
}

export interface ProductSelection {
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
export const CREW_KEY = '__crew__';
export const procLabel = (proc: string) => (proc === CREW_KEY ? 'Radnik / ekipa' : proc);

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

export interface WorkOrderWizardParams {
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
    /** Poslije uspješnog kreiranja — pozivalac (npr. Platno) veže blok na stvarni nalog. */
    onCreated?: (workOrderId: string, workOrderNumber: string) => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

export function useWorkOrderWizard({
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
    onCreated,
    showToast,
}: WorkOrderWizardParams) {
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
        // Ključevi dodjele: proizvodnja ima jednu ekipu za sve procese (CREW_KEY),
        // montaža dodjeljuje po koraku (MONTAZA_STEPS).
        const procs = mode === 'montaza' ? [...MONTAZA_STEPS] : [CREW_KEY];
        setActiveStep(0);
        setSelectedProcesses(procs);
        // Datumi iz seeda (Platno prenosi rokove bloka); inače podrazumijevano.
        setStartDate(initialProducts?.startDate || todayISO());
        setDueDate(initialProducts?.dueDate || '');
        setWorkOrderName('');
        setNotes('');
        setProductSearch('');
        setCustomProcessInput('');
        setCreateMaterialOrders(true);
        setTaskSelection(emptyTaskSelection());

        // Seed iz Platna/ProjectsTab: proizvodi + (opciono) ekipa na svaki proces.
        // Radi za OBA moda — montaža seedane proizvode ubacuje direktno (zaobilazi
        // listu „Spremno", jer su svjesno izabrani na platnu).
        if (initialProducts) {
            const { projectId, projectName, products: pendingProducts, workerIds } = initialProducts;
            const lead = workerIds?.[0] || '';
            const helpers = (workerIds || []).slice(1);
            const seedAssign = () => procs.reduce((a, k) => ({ ...a, [k]: lead }), {} as Record<string, string>);
            const seedHelpers = () => procs.reduce((a, k) => ({ ...a, [k]: [...helpers] }), {} as Record<string, string[]>);
            setSelectedProducts(pendingProducts.map(p => ({
                Product_ID: p.productId,
                Product_Name: p.productName,
                Project_ID: projectId,
                Project_Name: projectName,
                Quantity: p.quantity,
                Work_Order_Quantity: p.quantity,
                Status: '',
                assignments: seedAssign(),
                helperAssignments: seedHelpers(),
            })));
            // Skoči na zadnji korak (dodjela/rok) kad ima proizvoda — inače korak izbora.
            setActiveStep(pendingProducts.length ? (mode === 'montaza' ? 2 : 1) : 0);
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
    // Funkcionalna ažuriranja: dva brza dodira (telefon) ne smiju pregaziti jedan drugog
    // zastarjelom kopijom izbora.
    function toggleProduct(product: any) {
        setSelectedProducts(prev => {
            if (prev.some(p => p.Product_ID === product.Product_ID)) {
                return prev.filter(p => p.Product_ID !== product.Product_ID);
            }
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
            return [...prev, newProduct];
        });
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
            setSelectedProcesses(prev => prev.filter(p => p !== process));
            setSelectedProducts(prev => prev.map(p => {
                const newAssignments = { ...p.assignments };
                const newHelperAssignments = { ...p.helperAssignments };
                delete newAssignments[process];
                delete newHelperAssignments[process];
                return { ...p, assignments: newAssignments, helperAssignments: newHelperAssignments };
            }));
        } else {
            setSelectedProcesses(prev => [...prev, process]);
            setSelectedProducts(prev => prev.map(p => ({
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
        setSelectedProcesses(prev => [...prev, proc]);
        setSelectedProducts(prev => prev.map(p => ({
            ...p,
            assignments: { ...p.assignments, [proc]: '' },
            helperAssignments: { ...p.helperAssignments, [proc]: [] }
        })));
        setCustomProcessInput('');
    }

    function assignWorker(productId: string, process: string, workerId: string) {
        setSelectedProducts(prev => prev.map(p => {
            if (p.Product_ID === productId) return { ...p, assignments: { ...p.assignments, [process]: workerId } };
            return p;
        }));
    }

    function toggleHelper(productId: string, process: string, helperId: string) {
        setSelectedProducts(prev => prev.map(p => {
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
        setSelectedProducts(prev => prev.map(p => ({ ...p, assignments: { ...p.assignments, [process]: workerId } })));
        const worker = workers.find(w => w.Worker_ID === workerId);
        showToast(`${worker?.Name} dodijeljen za ${process} svim proizvodima`, 'success');
    }

    function assignWorkerToAllProcesses(workerId: string) {
        setSelectedProducts(prev => prev.map(p => {
            const newAssignments = { ...p.assignments };
            selectedProcesses.forEach(proc => { newAssignments[proc] = workerId; });
            return { ...p, assignments: newAssignments };
        }));
        const worker = workers.find(w => w.Worker_ID === workerId);
        showToast(`${worker?.Name} dodijeljen svim procesima svih proizvoda`, 'success');
    }

    function assignHelpersToAllProcesses(helperIds: string[]) {
        setSelectedProducts(prev => prev.map(p => {
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

            // DODIJELJENA EKIPA STAVKE (Assigned_Workers): unija glavnih + pomoćnika iz SVIH
            // dodjela (proizvodnja: CREW_KEY; montaža: po koraku). Ovo je "zvanična" dodjela
            // koja PERZISTIRA neovisno o planu procesa — bez nje se radnik izabran u wizardu
            // gubio kad proizvod nema plan (Processes = []), pa se nalog nije mogao pokrenuti
            // ("Dodijelite barem jednog radnika"). Assigned_Workers je skup dodjele (članstvo)
            // koji čitaju kartica naloga, Platno, grupisanje i auto-knjiženje — ne množilac
            // troška (trošak dolazi iz šihtarice/knjige rada), pa je dodavanje bez finansijskog efekta.
            const assignedWorkers = (() => {
                const ids = new Set<string>();
                Object.values(p.assignments || {}).forEach(id => { if (id) ids.add(id); });
                Object.values(p.helperAssignments || {}).forEach(arr => (arr || []).forEach(id => { if (id) ids.add(id); }));
                return Array.from(ids).map(id => {
                    const w = workers.find(x => x.Worker_ID === id);
                    return { Worker_ID: id, Worker_Name: w?.Name || 'Nepoznat', Daily_Rate: w?.Daily_Rate || 0 };
                });
            })();

            return {
                Product_ID: p.Product_ID,
                Product_Name: p.Product_Name,
                Project_ID: p.Project_ID,
                Project_Name: p.Project_Name,
                Quantity: p.Work_Order_Quantity,
                Total_Product_Quantity: p.Quantity,
                // Zvanična ekipa stavke — perzistira dodjelu iz wizarda i kad proizvod nema plan procesa.
                Assigned_Workers: assignedWorkers.length ? assignedWorkers : undefined,
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

            // Pozivalac (Platno) veže plan-blok na ovaj stvarni nalog.
            if (result.data) onCreated?.(result.data.Work_Order_ID, result.data.Work_Order_Number);

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

    // ── Akcije za ekrane bez matrice (telefon) — ista pravila kao inline kod desktopa ──

    /** Novi red izbora proizvodnje (prazna dodjela po svakom ključu dodjele). */
    function productionSelection(product: any): ProductSelection {
        return {
            ...product,
            Work_Order_Quantity: product.Quantity || 1,
            assignments: selectedProcesses.reduce((acc: Record<string, string>, proc) => ({ ...acc, [proc]: '' }), {}),
            helperAssignments: selectedProcesses.reduce((acc: Record<string, string[]>, proc) => ({ ...acc, [proc]: [] }), {}),
        };
    }

    /** Označi/poništi više proizvoda odjednom (npr. cijeli projekat). */
    function selectProducts(list: any[], on: boolean) {
        const ids = new Set(list.map(p => p.Product_ID));
        if (!on) {
            setSelectedProducts(prev => prev.filter(p => !ids.has(p.Product_ID)));
            return;
        }
        setSelectedProducts(prev => {
            const have = new Set(prev.map(p => p.Product_ID));
            return [...prev, ...list.filter(p => !have.has(p.Product_ID)).map(productionSelection)];
        });
    }

    /** Količina u nalogu — između 1 i preostale količine proizvoda. */
    function setProductQuantity(productId: string, qty: number, max: number) {
        const next = Math.max(1, Math.min(max, Math.round(qty) || 1));
        setSelectedProducts(prev => prev.map(p => p.Product_ID === productId ? { ...p, Work_Order_Quantity: next } : p));
    }

    /** Montaža: izbor spremnog proizvoda — nosi vezu na izvorni proizvodni nalog. */
    function montazaSelection(prod: any): ProductSelection {
        return {
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
            Source_Work_Order_ID: prod.Source_Work_Order_ID,
        };
    }

    function selectMontazaProducts(list: any[], on: boolean) {
        const ids = new Set(list.map(p => p.Product_ID));
        if (!on) {
            setSelectedProducts(prev => prev.filter(p => !ids.has(p.Product_ID)));
            return;
        }
        setSelectedProducts(prev => {
            const have = new Set(prev.map(p => p.Product_ID));
            return [...prev, ...list.filter(p => !have.has(p.Product_ID)).map(montazaSelection)];
        });
    }

    /** Montaža: pomoćnici jednog koraka na SVIM proizvodima (desktop to radi ćeliju po ćeliju). */
    function assignHelpersToAllForProcess(process: string, helperIds: string[]) {
        setSelectedProducts(prev => prev.map(p => ({
            ...p,
            helperAssignments: { ...p.helperAssignments, [process]: [...helperIds] },
        })));
    }

    return {
        productionSelection,
        selectProducts,
        setProductQuantity,
        selectMontazaProducts,
        assignHelpersToAllForProcess,
        activeStep,
        setActiveStep,
        sortedProjects,
        selectedProducts,
        setSelectedProducts,
        selectedProcesses,
        setSelectedProcesses,
        customProcessInput,
        setCustomProcessInput,
        dueDate,
        setDueDate,
        startDate,
        setStartDate,
        workOrderName,
        setWorkOrderName,
        notes,
        setNotes,
        productSearch,
        setProductSearch,
        createMaterialOrders,
        setCreateMaterialOrders,
        orderSelectPrompt,
        setOrderSelectPrompt,
        taskSelection,
        setTaskSelection,
        suggestedTaskIds,
        totalPlannedDays,
        assignedWorkerIds,
        suggestedDueDate,
        wizardFin,
        fmtKM,
        undefinedProducts,
        eligibleProducts,
        eligibleMontazaProducts,
        steps,
        lastStep,
        canGoNext,
        handleNext,
        handleBack,
        toggleProduct,
        selectAllProducts,
        toggleProcess,
        addCustomProcess,
        assignWorker,
        toggleHelper,
        assignWorkerToAll,
        assignWorkerToAllProcesses,
        assignHelpersToAllProcesses,
        handleCreateWorkOrder,
    };
}

export type WorkOrderWizardState = ReturnType<typeof useWorkOrderWizard>;
