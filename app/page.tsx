'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight, ChevronLeft } from 'lucide-react';
import { getAllData } from '@/lib/database';
import { signOut } from '@/lib/auth';
import { useAuth } from '@/context/AuthContext';
import type { AppState, Project, Product, Material, Offer, Order, Supplier, Worker } from '@/lib/types';
import { PROJECT_STATUSES, PRODUCT_STATUSES, MATERIAL_CATEGORIES } from '@/lib/types';

// Components
import ProjectsTab from '@/components/tabs/ProjectsTab';
import OverviewTab from '@/components/tabs/OverviewTab';
import OffersTab from '@/components/tabs/OffersTab';
import OrdersTab from '@/components/tabs/OrdersTab';
import ProductionTab from '@/components/tabs/ProductionTab';
import MaterialsTab from '@/components/tabs/MaterialsTab';
import WorkersTab from '@/components/tabs/WorkersTab';
import SuppliersTab from '@/components/tabs/SuppliersTab';
import Toast from '@/components/ui/Toast';
import LoadingOverlay from '@/components/ui/LoadingOverlay';
import ModuleGuard from '@/components/auth/ModuleGuard';
import Sidebar from '@/components/Sidebar';
import CommandPalette, { type CommandPaletteItem } from '@/components/ui/CommandPalette';

export const dynamic = 'force-dynamic';

export default function Home() {
    const router = useRouter();
    const { user, organization, loading: authLoading, hasModule, firebaseUser } = useAuth();

    const [activeTab, setActiveTab] = useState('projects');
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [userMenuOpen, setUserMenuOpen] = useState(false);
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [loading, setLoading] = useState(true);
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

    // Command Palette state
    const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);



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

    // Redirect to login if not authenticated
    useEffect(() => {
        if (!authLoading && !firebaseUser) {
            router.push('/login');
        }
    }, [authLoading, firebaseUser, router]);

    useEffect(() => {
        if (firebaseUser) {
            loadData();
        }
    }, [firebaseUser]);

    async function loadData() {
        setLoading(true);
        try {
            const data = await getAllData();
            setAppState(data);
        } catch (error) {
            console.error('Error loading data:', error);
            showToast('Greška pri učitavanju podataka', 'error');
        } finally {
            setLoading(false);
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
                            onRefresh={loadData}
                            showToast={showToast}
                        />
                    )}

                    {activeTab === 'overview' && (
                        <OverviewTab
                            projects={appState.projects}
                            workOrders={appState.workOrders}
                            orders={appState.orders}
                            suppliers={appState.suppliers}
                            showToast={showToast}
                            onCreateOrder={handleCreateOrderFromOverview}
                            onRefresh={loadData}
                        />
                    )}

                    {activeTab === 'offers' && (
                        <ModuleGuard module="offers" moduleName="Modul Ponude">
                            <OffersTab
                                offers={appState.offers}
                                projects={appState.projects}
                                onRefresh={loadData}
                                showToast={showToast}
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
                                onRefresh={loadData}
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
                            onRefresh={loadData}
                            showToast={showToast}
                        />
                    )}

                    {activeTab === 'materials' && (
                        <MaterialsTab
                            materials={appState.materials}
                            onRefresh={loadData}
                            showToast={showToast}
                        />
                    )}

                    {activeTab === 'workers' && (
                        <WorkersTab
                            workers={appState.workers}
                            onRefresh={loadData}
                            showToast={showToast}
                        />
                    )}

                    {activeTab === 'suppliers' && (
                        <SuppliersTab
                            suppliers={appState.suppliers}
                            onRefresh={loadData}
                            showToast={showToast}
                        />
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
                    overflow-x: hidden;
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
                    { id: 'action-overview', type: 'action', title: 'Idi na Pregled', action: () => setActiveTab('overview') },
                    { id: 'action-offers', type: 'action', title: 'Idi na Ponude', action: () => setActiveTab('offers') },
                    { id: 'action-production', type: 'action', title: 'Idi na Proizvodnju', action: () => setActiveTab('production') },
                    // Projects
                    ...appState.projects.map(p => ({
                        id: `project-${p.Project_ID}`,
                        type: 'project' as const,
                        title: p.Client_Name,
                        subtitle: `${p.Address || 'Bez adrese'} • ${p.Status}`,
                        action: () => { setActiveTab('projects'); showToast(`Projekat: ${p.Client_Name}`, 'info'); }
                    })),
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
        </div>
    );
}
