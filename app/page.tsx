'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight, ChevronLeft } from 'lucide-react';
import { getProjects, getMaterialsCatalog, getSuppliers, getWorkers, getOffers, getOrders, getWorkOrders, getTasks, getWorkLogs, getTaskProfiles } from '@/lib/services';

import { signOut } from '@/lib/auth';
import { useAuth } from '@/context/AuthContext';
import type { AppState, Project, Product, Material, Offer, Order, Supplier, Worker } from '@/lib/types';
import { PROJECT_STATUSES, PRODUCT_STATUSES, MATERIAL_CATEGORIES } from '@/lib/types';

// Components
import ProjectsTab from '@/components/tabs/ProjectsTab';

import OffersTab from '@/components/tabs/OffersTab';
import OrdersTab from '@/components/tabs/OrdersTab';
import ProductionTab from '@/components/tabs/ProductionTab';
import MaterialsTab from '@/components/tabs/MaterialsTab';
import WorkersTab from '@/components/tabs/WorkersTab';
import SuppliersTab from '@/components/tabs/SuppliersTab';
import AttendanceTab from '@/components/tabs/AttendanceTab';
import TasksTab from '@/components/tabs/TasksTab';
import MobileTasksTab from '@/components/tabs/MobileTasksTab';
import PlannerTab from '@/components/tabs/PlannerTab';
import Toast from '@/components/ui/Toast';
import LoadingOverlay from '@/components/ui/LoadingOverlay';
import ModuleGuard from '@/components/auth/ModuleGuard';
import Sidebar from '@/components/Sidebar';
import CommandPalette, { type CommandPaletteItem } from '@/components/ui/CommandPalette';
import CSVImportWizard from '@/components/CSVImportWizard';

export const dynamic = 'force-dynamic';

export default function Home() {
    const router = useRouter();
    const { user, organization, loading: authLoading, hasModule, firebaseUser } = useAuth();

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
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [loading, setLoading] = useState(true);
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

    // Command Palette state
    const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

    // AI Import Wizard state
    const [importWizardOpen, setImportWizardOpen] = useState(false);

    // Tasks filter state for cross-tab navigation
    const [tasksProjectFilter, setTasksProjectFilter] = useState<string | null>(null);

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

    // Track if startup sync has already run this session
    const startupSyncDone = useRef(false);

    useEffect(() => {
        if (firebaseUser && organization?.Organization_ID) {
            refreshCollections();

            // Run startup sync once per session (background, non-blocking)
            if (!startupSyncDone.current) {
                startupSyncDone.current = true;
                import('@/lib/attendance').then(({ runStartupSync }) => {
                    runStartupSync(organization.Organization_ID)
                        .then(result => {
                            if (result.scheduled > 0 || result.recalculated > 0 || result.projectsSynced > 0) {
                                refreshCollections('workOrders', 'projects');
                            }
                        })
                        .catch(e => console.error('Startup sync error:', e));
                });
            }
        }
    }, [firebaseUser, organization]);

    // Collection-level loaders for targeted refresh
    const collectionLoaders: Record<string, (orgId: string) => Promise<any[]>> = {
        projects: getProjects,
        materials: getMaterialsCatalog,
        suppliers: getSuppliers,
        workers: getWorkers,
        offers: getOffers,
        orders: getOrders,
        workOrders: getWorkOrders,
        workLogs: getWorkLogs,
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
            try {
                const orgId = organization.Organization_ID;
                const [projects, materials, suppliers, workers, offers, orders, workOrders, workLogs, tasks, taskProfiles] = await Promise.all([
                    getProjects(orgId),
                    getMaterialsCatalog(orgId),
                    getSuppliers(orgId),
                    getWorkers(orgId),
                    getOffers(orgId),
                    getOrders(orgId),
                    getWorkOrders(orgId),
                    getWorkLogs(orgId),
                    getTasks(orgId),
                    getTaskProfiles(orgId),
                ]);
                setAppState({
                    projects, materials, suppliers, workers, offers, orders,
                    workOrders, workLogs, tasks, taskProfiles,
                    products: [], productMaterials: [], glassItems: [], aluDoorItems: [],
                });
            } catch (error) {
                console.error('Error loading all data:', error);
                showToast('Greška pri učitavanju podataka', 'error');
            } finally {
                setLoading(false);
            }
            return;
        }

        // Targeted reload — only specified collections
        // Expand with dependencies: if projects change, workOrders need fresh data too
        // (material costs feed into WO profit calculations)
        const deps: Record<string, string[]> = {
            projects: ['workOrders', 'workLogs'],  // material cost → WO profit, work logs → labor cost
            workOrders: ['workLogs'],               // WO changes affect labor cost display
        };
        const expanded = new Set(collections);
        collections.forEach(c => deps[c]?.forEach(d => expanded.add(d)));
        const toLoad = Array.from(expanded);

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

                    // Guard: don't replace valid collections with empty array 
                    // (Firestore eventual consistency after cascade deletes)
                    if (updates.projects && updates.projects.length === 0 && prev.projects.length > 0) {
                        console.warn('refreshCollections: projects came back empty, retrying...');
                        setTimeout(() => refreshCollections('projects'), 1000);
                        delete updates.projects;
                    }
                    if (updates.orders && updates.orders.length === 0 && prev.orders.length > 0) {
                        console.warn('refreshCollections: orders came back empty, retrying...');
                        setTimeout(() => refreshCollections('orders'), 1000);
                        delete updates.orders;
                    }

                    return Object.keys(updates).length > 0 ? { ...prev, ...updates } : prev;
                });
            }
        } catch (error) {
            console.error('Error refreshing collections:', error);
            // Fallback to full reload on error
            await refreshCollections();
        }
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

    return (
        <div
            className="app-container"
        >
            {/* Sidebar Navigation */}
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

            {/* Main Content Area */}
            <div className={`main-content-wrapper ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
                {/* Mobile Header */}
                <header className="mobile-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <span className="logo-text" style={{ fontSize: '16px' }}>Furniture Prod.</span>
                        <div className="user-avatar-small" style={{
                            width: '32px', height: '32px', borderRadius: '50%',
                            background: '#e3f2fd', color: '#0071e3', display: 'flex',
                            alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 'bold'
                        }}>
                            {getUserInitials()}
                        </div>
                    </div>
                </header>

                <button
                    className="mobile-menu-fab"
                    onClick={() => setUserMenuOpen(true)}
                >
                    <ChevronLeft size={24} color="white" />
                </button>

                {/* Content */}
                <main className="content-area">
                    {activeTab === 'projects' && (
                        <ProjectsTab
                            projects={appState.projects}
                            materials={appState.materials}
                            workOrders={appState.workOrders}
                            offers={appState.offers}
                            workLogs={appState.workLogs}
                            onRefresh={refreshCollections}
                            showToast={showToast}
                            onNavigateToTasks={handleNavigateToTasks}
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
                                onRefresh={refreshCollections}
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
                            onRefresh={refreshCollections}
                            showToast={showToast}
                        />
                    )}

                    {activeTab === 'planer' && (
                        <PlannerTab
                            workOrders={appState.workOrders}
                            workers={appState.workers}
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
                </main>
            </div>

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

                .mobile-menu-fab {
                    position: fixed;
                    bottom: 24px;
                    right: 24px;
                    width: 56px;
                    height: 56px;
                    background: #1d1d1f;
                    border-radius: 50%;
                    color: white;
                    display: none;
                    align-items: center;
                    justify-content: center;
                    box-shadow: 0 4px 20px rgba(0,0,0,0.25);
                    border: none;
                    z-index: 900;
                    cursor: pointer;
                    transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
                }

                .mobile-menu-fab:active {
                    transform: scale(0.92);
                }

                @media (max-width: 768px) {
                    .mobile-menu-fab {
                        display: flex;
                    }
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
