'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getProjects, getMaterialsCatalog, getSuppliers, getWorkers, getOffers, getOrders, getWorkOrders, getTasks, getWorkLogsSince, getWorkLogsForWorkOrder, getTaskProfiles } from '@/lib/services';

import { signOut } from '@/lib/auth';
import { useAuth } from '@/context/AuthContext';
import type { AppState, Project, Product, Material, Offer, Order, Supplier, Worker } from '@/lib/types';
import { PROJECT_STATUSES, PRODUCT_STATUSES, MATERIAL_CATEGORIES } from '@/lib/types';

// Components
import nextDynamic from 'next/dynamic';
import Toast from '@/components/ui/Toast';
import LoadingOverlay from '@/components/ui/LoadingOverlay';
import ModuleGuard from '@/components/auth/ModuleGuard';
import Sidebar from '@/components/Sidebar';
import MobileTabBar, { MOBILE_TABS } from '@/components/tabs/mobile/MobileTabBar';
import { useSwipeTabs } from '@/components/tabs/mobile/useSwipe';
import CommandPalette, { type CommandPaletteItem } from '@/components/ui/CommandPalette';
import CSVImportWizard from '@/components/CSVImportWizard';

export const dynamic = 'force-dynamic';

// ── Lijeno učitavanje tabova (next/dynamic) ───────────────────────────
// Svaki tab ide u svoj chunk i učitava se TEK kad postane aktivan. Ranije su
// svi tabovi bili eager → dev bundle app/page.js je bio ~26MB (i minutima se
// kompajlirao). Ovim se početni bundle drastično smanji. Alias `nextDynamic`
// jer je `dynamic` već zauzet route-config exportom iznad.
const TabLoading = () => (
    <div style={{ padding: '60px', textAlign: 'center', color: 'var(--text-secondary)' }}>Učitavanje…</div>
);
const ProjectsTab = nextDynamic(() => import('@/components/tabs/ProjectsTab'), { loading: TabLoading });
const OffersTab = nextDynamic(() => import('@/components/tabs/OffersTab'), { loading: TabLoading });
const OrdersTab = nextDynamic(() => import('@/components/tabs/OrdersTab'), { loading: TabLoading });
const ProductionTab = nextDynamic(() => import('@/components/tabs/ProductionTab'), { loading: TabLoading });
const MaterialsTab = nextDynamic(() => import('@/components/tabs/MaterialsTab'), { loading: TabLoading });
const WorkersTab = nextDynamic(() => import('@/components/tabs/WorkersTab'), { loading: TabLoading });
const SuppliersTab = nextDynamic(() => import('@/components/tabs/SuppliersTab'), { loading: TabLoading });
const AttendanceTab = nextDynamic(() => import('@/components/tabs/AttendanceTab'), { loading: TabLoading });
const TasksTab = nextDynamic(() => import('@/components/tabs/TasksTab'), { loading: TabLoading });
const MobileTasksTab = nextDynamic(() => import('@/components/tabs/MobileTasksTab'), { loading: TabLoading });
// Platno — pješčanik za planiranje. Čita naloge/radnike/projekte, piše SAMO u
// planning_scenarios; ne mijenja nijedan status ni datum stvarnog naloga.
const CanvasTab = nextDynamic(() => import('@/components/canvas/CanvasTab'), { loading: TabLoading });
const ProcessesTab = nextDynamic(() => import('@/components/tabs/ProcessesTab'), { loading: TabLoading });
// „Ja" — mobilni ekran naloga (identitet + postavke + odjava). Na desktopu je sve to u sidebaru.
const MobileAccountView = nextDynamic(() => import('@/components/tabs/mobile/MobileAccountView'), { loading: TabLoading });

/** Početak prozora eager-učitavanja dnevnica: prije 12 mjeseci (YYYY-MM-DD). */
function workLogsWindowStart(): string {
    const d = new Date();
    d.setMonth(d.getMonth() - 12);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function Home() {
    const router = useRouter();
    const { user, organization, loading: authLoading, hasModule, firebaseUser, isStaff, isField, authError, retryAuth } = useAuth();

    // Mobile detection for responsive component switching
    const [isMobile, setIsMobile] = useState(false);

    useEffect(() => {
        const checkMobile = () => {
            setIsMobile(window.innerWidth < 768);
        };
        checkMobile();
        window.addEventListener('resize', checkMobile);
        return () => window.removeEventListener('resize', checkMobile);
    }, []);

    const [activeTab, setActiveTab] = useState('projects');
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [userMenuOpen, setUserMenuOpen] = useState(false);
    const [sidebarCollapsed, setSidebarCollapsed] = useState(true); // defaultno skupljen; korisnik ga širi po želji
    const [loading, setLoading] = useState(true);
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

    // Command Palette state
    const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

    // AI Import Wizard state
    const [importWizardOpen, setImportWizardOpen] = useState(false);

    // Tasks filter state for cross-tab navigation
    const [tasksProjectFilter, setTasksProjectFilter] = useState<string | null>(null);

    // Work order creation from ProjectsTab
    const [pendingWorkOrderProducts, setPendingWorkOrderProducts] = useState<{ projectId: string; projectName: string; products: { productId: string; productName: string; quantity: number }[] } | null>(null);

    // Procesi → Nalozi navigacija (proširi traženi nalog)
    const [autoExpandWorkOrderId, setAutoExpandWorkOrderId] = useState<string | null>(null);
    // Quote-to-Project navigation state
    const [autoExpandProjectId, setAutoExpandProjectId] = useState<string | null>(null);
    const [autoExpandProductId, setAutoExpandProductId] = useState<string | null>(null);
    const [returnToOfferId, setReturnToOfferId] = useState<string | null>(null);

    // Return-to-offer state: auto-open offer edit modal when returning from projects
    const [autoEditOfferId, setAutoEditOfferId] = useState<string | null>(null);
    const [autoScrollProductId, setAutoScrollProductId] = useState<string | null>(null);

    // Handler to navigate to tasks filtered by project
    const handleNavigateToTasks = (projectId: string) => {
        setTasksProjectFilter(projectId);
        setActiveTab('tasks');
    };

    // Handler to create work order from ProjectsTab
    const handleCreateWorkOrderFromProjects = (projectId: string, projectName: string, products: { productId: string; productName: string; quantity: number }[]) => {
        setPendingWorkOrderProducts({ projectId, projectName, products });
        setActiveTab('production');
        showToast(`${products.length} proizvod(a) spremno za radni nalog`, 'info');
    };

    const clearPendingWorkOrder = () => {
        setPendingWorkOrderProducts(null);
    };

    // Handler to navigate from offer to project
    const handleNavigateToProject = (projectId: string, productId: string, offerId?: string) => {
        setAutoExpandProjectId(projectId);
        setAutoExpandProductId(productId);
        setReturnToOfferId(offerId || null);
        // Store the product ID the user navigated from, for scrolling back
        if (offerId) {
            setAutoScrollProductId(productId);
        }
        setActiveTab('projects');
    };

    // Handler to return from project to offer
    const handleReturnToOffer = (offerId: string) => {
        setAutoExpandProjectId(null);
        setAutoExpandProductId(null);
        setReturnToOfferId(null);
        // Set autoEditOfferId so OffersTab re-opens the edit modal
        setAutoEditOfferId(offerId);
        setActiveTab('offers');
    };

    // Clear filter when manually switching to tasks tab
    const handleTabChange = (tab: string) => {
        if (tab !== 'tasks') {
            setTasksProjectFilter(null);
        }
        setActiveTab(tab);
    };



    const [appState, setAppState] = useState<AppState>({
        projects: [],
        products: [],
        materials: [],
        suppliers: [],
        workers: [],
        offers: [],
        orders: [],
        workOrders: [],
        productMaterials: [],
        glassItems: [],
        aluDoorItems: [],
        workLogs: [],
        tasks: [],
        taskProfiles: [],
    });

    // Nalozi čiji su PUNI logovi već dovučeni na zahtjev (van 12-mjesečnog prozora).
    // Resetuje se kad se prozor ponovo učita, da se stariji nalog može re-spojiti.
    const ensuredWorkOrderLogs = useRef<Set<string>>(new Set());

    // Refs for click-outside detection
    const userMenuRef = useRef<HTMLDivElement>(null);
    const settingsDropdownRef = useRef<HTMLDivElement>(null);

    // Close dropdowns when clicking outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            // Close user menu if clicking outside
            if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
                setUserMenuOpen(false);
            }
            // Close settings dropdown if clicking outside
            if (settingsDropdownRef.current && !settingsDropdownRef.current.contains(event.target as Node)) {
                setDropdownOpen(false);
            }
        }

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Global keyboard shortcuts
    useEffect(() => {
        function handleKeyDown(e: KeyboardEvent) {
            // Ctrl+K or Cmd+K - Open Command Palette
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                setCommandPaletteOpen(prev => !prev);
            }
            // Ctrl+N or Cmd+N - New Project (when not in input)
            if ((e.ctrlKey || e.metaKey) && e.key === 'n' && !isInputFocused()) {
                e.preventDefault();
                setActiveTab('projects');
                showToast('Otvori novi projekt iz Projekti taba', 'info');
            }
            // Ctrl+O or Cmd+O - Go to Orders
            if ((e.ctrlKey || e.metaKey) && e.key === 'o' && !isInputFocused()) {
                e.preventDefault();
                setActiveTab('orders');
            }
        }

        function isInputFocused() {
            const active = document.activeElement;
            return active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement;
        }

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, []);

    // Listen for switchTab custom events (from NotificationCenter, etc.)
    useEffect(() => {
        function handleSwitchTab(e: Event) {
            const detail = (e as CustomEvent).detail;
            if (detail?.tab) {
                setActiveTab(detail.tab);
            }
        }
        window.addEventListener('switchTab', handleSwitchTab);
        return () => window.removeEventListener('switchTab', handleSwitchTab);
    }, []);

    // Redirect to login if not authenticated
    useEffect(() => {
        if (!authLoading && !firebaseUser) {
            router.push('/login');
        }
    }, [authLoading, firebaseUser, router]);

    // Pogonske uloge (radnik, kontrolor) nemaju šta tražiti u punoj aplikaciji —
    // ni pravo pristupa (firestore.rules ih odsijeca), ni ekran za to. Idu na /pogon.
    useEffect(() => {
        if (!authLoading && isField) {
            router.replace('/pogon');
        }
    }, [authLoading, isField, router]);

    // Track if startup sync has already run this session
    const startupSyncDone = useRef(false);

    useEffect(() => {
        // `isStaff` je uslov, ne ukras: bez njega bi pogonski korisnik u trenutku
        // prije preusmjeravanja ispalio 10 upita koje pravila odbiju.
        if (firebaseUser && isStaff && organization?.Organization_ID) {
            refreshCollections();

            // Run startup sync once per session (background, non-blocking)
            if (!startupSyncDone.current) {
                startupSyncDone.current = true;
                import('@/lib/attendance').then(({ runStartupSync, recalculateAllActiveWorkOrders }) => {
                    runStartupSync(organization.Organization_ID)
                        .then(result => {
                            if (result.scheduled > 0 || result.recalculated > 0 || result.projectsSynced > 0) {
                                refreshCollections('workOrders', 'projects');
                            }
                        })
                        .catch(e => console.error('Startup sync error:', e));

                    // JEDNOKRATNI backfill Actual_Labor_Days i za ZAVRŠENE naloge (zadnjih 30 dana) —
                    // polje se inače sync-uje samo kroz recalculateWorkOrder, pa stari nalozi
                    // pokazuju "0/X dana" na kartici dok se ne preračunaju.
                    try {
                        const BACKFILL_KEY = 'erp_ald_backfill_v1';
                        if (typeof window !== 'undefined' && !localStorage.getItem(BACKFILL_KEY)) {
                            localStorage.setItem(BACKFILL_KEY, new Date().toISOString());
                            recalculateAllActiveWorkOrders(organization.Organization_ID, { includeCompleted: true })
                                .then(() => refreshCollections('workOrders'))
                                .catch(e => console.warn('ALD backfill error (non-critical):', e));
                        }
                    } catch { /* localStorage nedostupan — preskoči */ }
                });
            }
        } else if (!authLoading) {
            // SIGURNOSNA MREŽA: `loading` počinje kao true, a skida ga isključivo
            // refreshCollections(). Ako organizacije nema, ono se nikad ne pozove i
            // overlay ostane zauvijek. Ovdje se spušta čim je jasno da se ništa
            // neće učitati — pa se vidi poruka umjesto beskonačnog spinnera.
            setLoading(false);
        }
    }, [firebaseUser, isStaff, organization, authLoading]);

    // Collection-level loaders for targeted refresh
    const collectionLoaders: Record<string, (orgId: string) => Promise<any[]>> = {
        projects: getProjects,
        materials: getMaterialsCatalog,
        suppliers: getSuppliers,
        workers: getWorkers,
        offers: getOffers,
        orders: getOrders,
        workOrders: getWorkOrders,
        // Isti prozor kao eager load — ciljano osvježavanje ne vraća neograničenu istoriju.
        workLogs: (orgId: string) => getWorkLogsSince(orgId, workLogsWindowStart()),
        tasks: getTasks,
        taskProfiles: getTaskProfiles,
    };

    /**
     * Targeted refresh: reload only specified collections instead of everything.
     * Called with no args = full reload (backward compatible).
     * Called with collection names = reload only those collections.
     * 
     * Examples:
     *   refreshCollections()                    // full reload
     *   refreshCollections('projects')          // only projects
     *   refreshCollections('workOrders','projects')  // workOrders + projects
     */
    async function refreshCollections(...collections: string[]) {
        if (!organization?.Organization_ID) return;

        // No args = full reload (backward compatible)
        if (collections.length === 0) {
            setLoading(true);
            const orgId = organization.Organization_ID;
            try {
                // KRITIČNO ZA PRVI PRIKAZ: sve OSIM work_logs. `work_logs` raste
                // neograničeno (jedna po radniku × proizvodu × danu) i na firmi s
                // istorijom dominira vremenom učitavanja — pa se ne čeka na njega.
                // Aplikacija postane upotrebljiva čim stigne ostatak; detalji koji
                // traže logove (Knjiga rada, timeline) ih dobiju čim pozadinski
                // load završi (obično prije nego ih korisnik otvori).
                const [projects, materials, suppliers, workers, offers, orders, workOrders, tasks, taskProfiles] = await Promise.all([
                    getProjects(orgId),
                    getMaterialsCatalog(orgId),
                    getSuppliers(orgId),
                    getWorkers(orgId),
                    getOffers(orgId),
                    getOrders(orgId),
                    getWorkOrders(orgId),
                    getTasks(orgId),
                    getTaskProfiles(orgId),
                ]);
                setAppState(prev => ({
                    ...prev,
                    projects, materials, suppliers, workers, offers, orders,
                    workOrders, tasks, taskProfiles,
                    products: [], productMaterials: [], glassItems: [], aluDoorItems: [],
                    workLogs: prev.workLogs,   // zadrži postojeće dok pozadinski load ne stigne
                }));
            } catch (error) {
                console.error('Error loading all data:', error);
                showToast('Greška pri učitavanju podataka', 'error');
            } finally {
                setLoading(false);   // aplikacija je upotrebljiva i bez work_logs
            }

            // POZADINSKI: dnevnice se dovlače bez blokiranja prvog prikaza, i to
            // samo PROZOR (zadnjih 12 mjeseci) — `work_logs` raste neograničeno, a
            // ovo pokriva sve aktivne naloge i nedavnu istoriju. Logove starijeg
            // naloga dovuče `ensureWorkOrderLogs` tek kad se otvori njegov detalj.
            ensuredWorkOrderLogs.current.clear();   // prozor se ponovo puni
            getWorkLogsSince(orgId, workLogsWindowStart())
                .then(workLogs => setAppState(prev => ({ ...prev, workLogs })))
                .catch(e => console.warn('Pozadinsko učitavanje dnevnica nije uspjelo:', e));

            return;
        }

        // Targeted reload — only specified collections
        // Expand with dependencies: if projects change, workOrders need fresh data too
        // (material costs feed into WO profit calculations)
        // NB: work_logs se NE povlači automatski (velika, rastuća kolekcija) — mijenja se samo kroz
        // dnevnik/timeline koji ga osvježavaju EKSPLICITNO (onRefresh(...,'workLogs')). Time status
        // narudžbe i izmjene projekta ne reloadaju cijeli work_logs (znatno brže).
        const deps: Record<string, string[]> = {
            projects: ['workOrders'],   // material cost → WO profit
        };
        const expanded = new Set(collections);
        collections.forEach(c => deps[c]?.forEach(d => expanded.add(d)));
        const toLoad = Array.from(expanded);

        // Ciljano osvježavanje dnevnica prepisuje prozor — resetuj skup dovučenih
        // starijih naloga da se mogu ponovo spojiti kad im se otvori detalj.
        if (toLoad.includes('workLogs')) ensuredWorkOrderLogs.current.clear();

        try {
            const results = await Promise.all(
                toLoad
                    .filter(c => collectionLoaders[c])
                    .map(async (c) => ({ name: c, data: await collectionLoaders[c](organization.Organization_ID) }))
            );

            if (results.length > 0) {
                setAppState(prev => {
                    const updates: any = {};
                    results.forEach(({ name, data }) => { updates[name] = data; });

                    // Guard: don't replace a non-empty collection with an empty array.
                    // Firestore eventual consistency (nakon upisa/recalca, npr. završetak naloga)
                    // zna nakratko vratiti prazan rezultat — bez ovoga bi cijela lista „nestala"
                    // dok korisnik ne reloada. Zadržimo staru vrijednost i pokušamo ponovo.
                    (['projects', 'orders', 'offers', 'workOrders', 'workers'] as const).forEach(col => {
                        if (updates[col] && updates[col].length === 0 && (prev[col] as any[]).length > 0) {
                            console.warn(`refreshCollections: ${col} came back empty, retrying...`);
                            setTimeout(() => refreshCollections(col), 1000);
                            delete updates[col];
                        }
                    });

                    return Object.keys(updates).length > 0 ? { ...prev, ...updates } : prev;
                });
            }
        } catch (error) {
            console.error('Error refreshing collections:', error);
            // Fallback to full reload on error
            await refreshCollections();
        }
    }

    /**
     * Osiguraj da su u `appState.workLogs` PUNI logovi datog naloga — za slučaj da
     * je nalog stariji od eager prozora (Knjiga rada / timeline bi inače bili
     * nepotpuni). Dohvat je jednokratan po nalogu i spaja se bez dupliranja.
     */
    const ensureWorkOrderLogs = useCallback(async (workOrderId: string) => {
        const orgId = organization?.Organization_ID;
        if (!workOrderId || !orgId || ensuredWorkOrderLogs.current.has(workOrderId)) return;
        ensuredWorkOrderLogs.current.add(workOrderId);
        try {
            const logs = await getWorkLogsForWorkOrder(workOrderId, orgId);
            if (logs.length === 0) return;
            setAppState(prev => {
                const have = new Set(prev.workLogs.map(l => l.WorkLog_ID));
                const missing = logs.filter((l: any) => !have.has(l.WorkLog_ID));
                return missing.length > 0 ? { ...prev, workLogs: [...prev.workLogs, ...missing] } : prev;
            });
        } catch (e) {
            ensuredWorkOrderLogs.current.delete(workOrderId);   // dozvoli ponovni pokušaj
            console.warn('Dohvat dnevnica naloga nije uspio:', e);
        }
    }, [organization?.Organization_ID]);

    /**
     * Optimistični lokalni patch jedne stavke u appState kolekciji — BEZ refetcha.
     * UI (npr. badge statusa narudžbe) reaguje ODMAH, dok DB write i derivirani preračuni
     * teku u pozadini; usklađivanje ide kroz refreshCollections. Vrati se prethodna vrijednost
     * polja (za rollback pri grešci).
     */
    function patchCollection(name: keyof AppState, idField: string, id: string, partial: Record<string, any>) {
        setAppState(prev => {
            const arr = prev[name] as any[];
            if (!Array.isArray(arr)) return prev;
            return { ...prev, [name]: arr.map(x => (x?.[idField] === id ? { ...x, ...partial } : x)) };
        });
    }

    function showToast(message: string, type: 'success' | 'error' | 'info' = 'info') {
        setToast({ message, type });
        setTimeout(() => setToast(null), 3000);
    }

    function handleTabClick(tabName: string) {
        setActiveTab(tabName);
        setDropdownOpen(false);
    }

    // State and handler for creating orders from Overview tab
    const [pendingOrderMaterials, setPendingOrderMaterials] = useState<{ materialIds: string[], supplierName: string } | null>(null);

    function handleCreateOrderFromOverview(materialIds: string[], supplierName: string) {
        setPendingOrderMaterials({ materialIds, supplierName });
        setActiveTab('orders');
        showToast(`${materialIds.length} materijal(a) spremno za narudžbu`, 'info');
    }

    function clearPendingOrder() {
        setPendingOrderMaterials(null);
    }

    async function handleLogout() {
        await signOut();
        router.push('/login');
    }

    function getUserInitials(): string {
        if (!user?.Name) return '?';
        return user.Name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    }

    const isDropdownTab = ['materials', 'workers', 'suppliers'].includes(activeTab);

    // Vodoravno prevlačenje mijenja tab (samo telefon, i samo dok je otvoren
    // jedan od tabova iz donje trake — inače bi swipe „ispao" na nepoznat tab).
    const mobileTabIndex = MOBILE_TABS.findIndex(t => t.id === activeTab);
    useSwipeTabs(
        () => { if (mobileTabIndex > 0) setActiveTab(MOBILE_TABS[mobileTabIndex - 1].id); },
        () => { if (mobileTabIndex >= 0 && mobileTabIndex < MOBILE_TABS.length - 1) setActiveTab(MOBILE_TABS[mobileTabIndex + 1].id); },
        isMobile && mobileTabIndex >= 0
    );

    // Show loading while checking auth
    if (authLoading) {
        return (
            <div className="auth-loading">
                <div className="loading-spinner"></div>
                <p>Učitavanje...</p>
            </div>
        );
    }

    // Don't render if not authenticated
    if (!firebaseUser) {
        return null;
    }

    // Pogonska uloga — ne crtaj punu aplikaciju ni na jedan frejm dok
    // preusmjeravanje na /pogon ne odradi svoje.
    if (isField) {
        return null;
    }

    // PRIJAVA PROŠLA, PODACI NISU. Dok ovog nije bilo, aplikacija je u ovom stanju
    // vrtjela LoadingOverlay unedogled: `refreshCollections()` se zove tek kad
    // organizacija postoji, a jedino ona skida `loading`. Kvar se vidio samo kao
    // jedan red u konzoli. Sada se kaže šta je palo i nudi izlaz.
    if (authError) {
        return (
            <div className="auth-loading">
                <span className="material-icons-round" style={{ fontSize: 48, color: 'var(--error)' }}>lock</span>
                <h2 style={{ margin: '16px 0 4px', fontSize: 20 }}>
                    {authError === 'profile' ? 'Korisnički profil nije dostupan' : 'Podaci firme nisu dostupni'}
                </h2>
                <p style={{ maxWidth: 460, lineHeight: 1.6 }}>
                    {authError === 'profile'
                        ? 'Prijava je prošla, ali profil ovog naloga se ne može pročitati. Ako je nalog tek napravljen, pokušaj ponovo za koji trenutak.'
                        : 'Prijava je prošla, ali baza je odbila čitanje podataka firme. Najčešće je uzrok da token nema upisanu ulogu — „Pokušaj ponovo" ga osvježava.'}
                </p>
                <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                    <button className="btn btn-primary" onClick={() => { void retryAuth(); }}>Pokušaj ponovo</button>
                    <button className="btn btn-secondary" onClick={() => { void handleLogout(); }}>Odjavi se</button>
                </div>
            </div>
        );
    }

    return (
        <div
            className="app-container"
        >
            {/* Navigacija: sidebar na desktopu, donja traka na telefonu.
                Na telefonu se sidebar NE renderuje (ne samo sakriva) — drawer i
                njegov FAB su tamo suvišni kad postoji tab-traka. */}
            {!isMobile && (
                <Sidebar
                    activeTab={activeTab}
                    onTabChange={handleTabClick}
                    isOpen={userMenuOpen}
                    onClose={() => setUserMenuOpen(false)}
                    isCollapsed={sidebarCollapsed}
                    onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
                    onOpenSearch={() => setCommandPaletteOpen(true)}
                    onOpenImport={() => setImportWizardOpen(true)}
                />
            )}

            {/* Main Content Area */}
            <div className={`main-content-wrapper ${sidebarCollapsed ? 'sidebar-collapsed' : ''}${isMobile ? ' mobile-nav' : ''}`}>

                {/* Content */}
                <main className="content-area">
                    {activeTab === 'projects' && (
                        <ProjectsTab
                            projects={appState.projects}
                            materials={appState.materials}
                            workOrders={appState.workOrders}
                            offers={appState.offers}
                            workLogs={appState.workLogs}
                            orders={appState.orders}
                            tasks={appState.tasks}
                            onRefresh={refreshCollections}
                            onEnsureWorkOrderLogs={ensureWorkOrderLogs}
                            showToast={showToast}
                            onNavigateToTasks={handleNavigateToTasks}
                            onCreateWorkOrder={handleCreateWorkOrderFromProjects}
                            autoExpandProjectId={autoExpandProjectId}
                            autoExpandProductId={autoExpandProductId}
                            returnToOfferId={returnToOfferId}
                            onReturnToOffer={handleReturnToOffer}
                            onClearAutoExpand={() => { setAutoExpandProjectId(null); setAutoExpandProductId(null); }}
                        />
                    )}


                    {activeTab === 'offers' && (
                        <ModuleGuard module="offers" moduleName="Modul Ponude">
                            <OffersTab
                                offers={appState.offers}
                                projects={appState.projects}
                                onRefresh={refreshCollections}
                                showToast={showToast}
                                onNavigateToProject={handleNavigateToProject}
                                autoEditOfferId={autoEditOfferId}
                                autoScrollProductId={autoScrollProductId}
                                onClearAutoEdit={() => { setAutoEditOfferId(null); setAutoScrollProductId(null); }}
                                onCreateWorkOrder={handleCreateWorkOrderFromProjects}
                            />
                        </ModuleGuard>
                    )}

                    {activeTab === 'orders' && (
                        <ModuleGuard module="orders" moduleName="Modul Narudžbe">
                            <OrdersTab
                                orders={appState.orders}
                                suppliers={appState.suppliers}
                                projects={appState.projects}
                                productMaterials={appState.productMaterials}
                                materials={appState.materials}
                                onRefresh={refreshCollections}
                                onPatchOrder={(orderId, partial) => patchCollection('orders', 'Order_ID', orderId, partial)}
                                showToast={showToast}
                                pendingOrderMaterials={pendingOrderMaterials}
                                onClearPendingOrder={clearPendingOrder}
                            />
                        </ModuleGuard>
                    )}

                    {activeTab === 'production' && (
                        <ProductionTab
                            workOrders={appState.workOrders}
                            projects={appState.projects}
                            workers={appState.workers}
                            tasks={appState.tasks}
                            workLogs={appState.workLogs}
                            onRefresh={refreshCollections}
                            showToast={showToast}
                            pendingWorkOrderProducts={pendingWorkOrderProducts}
                            onClearPendingWorkOrder={clearPendingWorkOrder}
                            autoExpandWorkOrderId={autoExpandWorkOrderId}
                            onClearAutoExpand={() => setAutoExpandWorkOrderId(null)}
                        />
                    )}

                    {activeTab === 'procesi' && (
                        <ProcessesTab
                            workOrders={appState.workOrders}
                            workers={appState.workers}
                            workLogs={appState.workLogs}
                            onRefresh={refreshCollections}
                            showToast={showToast}
                            onNavigateToOrder={(woId) => { setAutoExpandWorkOrderId(woId); setActiveTab('production'); }}
                        />
                    )}

                    {/* Autosave platna i dalje piše SAMO u planning_scenarios. onRefresh je
                        za KORISNIČKU pretvorbu bloka u stvarni nalog/narudžbu — tek tada app
                        mora osvježiti workOrders/orders/projects da se nalog vidi u tabu Nalozi. */}
                    {activeTab === 'platno' && (
                        <CanvasTab
                            projects={appState.projects}
                            workers={appState.workers}
                            workOrders={appState.workOrders}
                            orders={appState.orders}
                            suppliers={appState.suppliers}
                            tasks={appState.tasks}
                            onRefresh={refreshCollections}
                            showToast={showToast}
                        />
                    )}

                    {activeTab === 'materials' && (
                        <MaterialsTab
                            materials={appState.materials}
                            onRefresh={refreshCollections}
                            showToast={showToast}
                        />
                    )}

                    {activeTab === 'workers' && (
                        <WorkersTab
                            workers={appState.workers}
                            onRefresh={refreshCollections}
                            showToast={showToast}
                        />
                    )}

                    {activeTab === 'suppliers' && (
                        <SuppliersTab
                            suppliers={appState.suppliers}
                            onRefresh={refreshCollections}
                            showToast={showToast}
                        />
                    )}

                    {activeTab === 'attendance' && (
                        <AttendanceTab
                            workers={appState.workers}
                            workOrders={appState.workOrders}
                            onRefresh={refreshCollections}
                            showToast={showToast}
                        />
                    )}

                    {activeTab === 'tasks' && (
                        isMobile ? (
                            <MobileTasksTab
                                tasks={appState.tasks}
                                projects={appState.projects}
                                workers={appState.workers}
                                materials={appState.materials}
                                workOrders={appState.workOrders}
                                orders={appState.orders}
                                taskProfiles={appState.taskProfiles}
                                onRefresh={refreshCollections}
                                showToast={showToast}
                                projectFilter={tasksProjectFilter}
                                onClearFilter={() => setTasksProjectFilter(null)}
                            />
                        ) : (
                            <TasksTab
                                tasks={appState.tasks}
                                projects={appState.projects}
                                workers={appState.workers}
                                materials={appState.materials}
                                workOrders={appState.workOrders}
                                orders={appState.orders}
                                taskProfiles={appState.taskProfiles}
                                onRefresh={refreshCollections}
                                showToast={showToast}
                                projectFilter={tasksProjectFilter}
                                onClearFilter={() => setTasksProjectFilter(null)}
                            />
                        )
                    )}

                    {/* „Ja" — samo telefon (glavna navigacija nema sidebar na mobitelu) */}
                    {activeTab === 'account' && <MobileAccountView />}
                </main>
            </div>

            {/* Donja navigacija (telefon) */}
            {isMobile && <MobileTabBar activeTab={activeTab} onTabChange={handleTabClick} />}

            {/* Toast Notifications */}
            {toast && <Toast message={toast.message} type={toast.type} />}

            {/* Loading Overlay */}
            <LoadingOverlay visible={loading} />

            <style jsx global>{`
                .app-container {
                    display: flex;
                    min-height: 100vh;
                    background: #f8fafc;
                }

                .main-content-wrapper {
                    flex: 1;
                    /* margin-left: 280px; */ /* Moved to media query */
                    display: flex;
                    flex-direction: column;
                    min-width: 0;
                    background: #f8fafc;
                }

                @media (min-width: 769px) {
                    .main-content-wrapper {
                        margin-left: 280px;
                        transition: margin-left 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                    }
                    .main-content-wrapper.sidebar-collapsed {
                        margin-left: 72px;
                    }
                }

                .content-area {
                    flex: 1;
                    padding: 24px 32px;
                    max-width: 1400px;
                    margin: 0 auto;
                    width: 100%;
                    box-sizing: border-box;
                }

                @media (max-width: 768px) {
                    .content-area {
                        padding: 16px;
                    }
                }
            `}</style>

            {/* Command Palette */}
            <CommandPalette
                isOpen={commandPaletteOpen}
                onClose={() => setCommandPaletteOpen(false)}
                items={[
                    // Quick Actions
                    { id: 'action-projects', type: 'action', title: 'Idi na Projekte', shortcut: 'Ctrl+N', action: () => setActiveTab('projects') },
                    { id: 'action-orders', type: 'action', title: 'Idi na Narudžbe', shortcut: 'Ctrl+O', action: () => setActiveTab('orders') },

                    { id: 'action-offers', type: 'action', title: 'Idi na Ponude', action: () => setActiveTab('offers') },
                    { id: 'action-production', type: 'action', title: 'Idi na Proizvodnju', action: () => setActiveTab('production') },
                    { id: 'action-import', type: 'action', title: '📥 Import podataka', action: () => setImportWizardOpen(true) },
                    // Projects
                    ...appState.projects.map(p => ({
                        id: `project-${p.Project_ID}`,
                        type: 'project' as const,
                        title: p.Client_Name,
                        subtitle: `${p.Address || 'Bez adrese'} • ${p.Status}`,
                        action: () => { setActiveTab('projects'); showToast(`Projekat: ${p.Client_Name}`, 'info'); }
                    })),
                    // Products (flattened from all projects)
                    ...appState.projects.flatMap(p =>
                        (p.products || []).map(prod => ({
                            id: `product-${prod.Product_ID}`,
                            type: 'product' as const,
                            title: prod.Name || 'Bez naziva',
                            subtitle: `${p.Client_Name} • ${[prod.Height && `V:${prod.Height}`, prod.Width && `Š:${prod.Width}`, prod.Depth && `D:${prod.Depth}`].filter(Boolean).join(' ') || ''} ${prod.Quantity ? `× ${prod.Quantity}` : ''}`.trim(),
                            action: () => {
                                setAutoExpandProjectId(p.Project_ID);
                                setAutoExpandProductId(prod.Product_ID);
                                setActiveTab('projects');
                            }
                        }))
                    ),
                    // Orders
                    ...appState.orders.map(o => ({
                        id: `order-${o.Order_ID}`,
                        type: 'order' as const,
                        title: `Narudžba ${o.Order_Number}`,
                        subtitle: `${o.Supplier_Name} • ${o.Status}`,
                        action: () => { setActiveTab('orders'); }
                    })),
                ]}
                onSelect={(item) => {
                    if (item.action) item.action();
                }}
            />

            {/* CSV Import Wizard */}
            {organization?.Organization_ID && (
                <CSVImportWizard
                    isOpen={importWizardOpen}
                    onClose={() => setImportWizardOpen(false)}
                    organizationId={organization.Organization_ID}
                    onImportComplete={() => {
                        refreshCollections();
                        showToast('Import završen uspješno!', 'success');
                    }}
                />
            )}
        </div>
    );
}
