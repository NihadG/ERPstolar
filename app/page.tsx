'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { getAllData } from '@/lib/database';
import { signOut } from '@/lib/auth';
import { useAuth } from '@/context/AuthContext';
import type { AppState, Project, Product, Material, Offer, Order, Supplier, Worker } from '@/lib/types';
import { PROJECT_STATUSES, PRODUCT_STATUSES, MATERIAL_CATEGORIES } from '@/lib/types';

// Components
import ProjectsTab from '@/components/tabs/ProjectsTab';
import OffersTab from '@/components/tabs/OffersTab';
import OrdersTab from '@/components/tabs/OrdersTab';
import MaterialsTab from '@/components/tabs/MaterialsTab';
import WorkersTab from '@/components/tabs/WorkersTab';
import SuppliersTab from '@/components/tabs/SuppliersTab';
import Toast from '@/components/ui/Toast';
import LoadingOverlay from '@/components/ui/LoadingOverlay';
import ModuleGuard from '@/components/auth/ModuleGuard';

export const dynamic = 'force-dynamic';

export default function Home() {
    const router = useRouter();
    const { user, organization, loading: authLoading, hasModule, firebaseUser } = useAuth();

    const [activeTab, setActiveTab] = useState('projects');
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [userMenuOpen, setUserMenuOpen] = useState(false);
    const [loading, setLoading] = useState(true);
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

    const [appState, setAppState] = useState<AppState>({
        projects: [],
        products: [],
        materials: [],
        suppliers: [],
        workers: [],
        offers: [],
        orders: [],
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
        <div className="app">
            {/* Header */}
            <header className="header">
                <h1 className="header-title">
                    <span className="material-icons-round">factory</span>
                    Furniture Production
                </h1>

                {/* User Menu */}
                <div ref={userMenuRef} className={`user-menu ${userMenuOpen ? 'open' : ''}`}>
                    <button
                        className="user-menu-button"
                        onClick={() => {
                            setUserMenuOpen(!userMenuOpen);
                            setDropdownOpen(false); // Close settings dropdown
                        }}
                    >
                        <div className="user-avatar">{getUserInitials()}</div>
                        <span className="user-name">{user?.Name}</span>
                        <span className="material-icons-round">expand_more</span>
                    </button>
                    <div className="user-menu-dropdown">
                        <div className="user-menu-header">
                            <div className="org-name">{organization?.Name}</div>
                            <div className="user-email">{user?.Email}</div>
                        </div>
                        <button className="user-menu-item" onClick={() => router.push('/settings')}>
                            <span className="material-icons-round">settings</span>
                            Postavke
                        </button>
                        <button className="user-menu-item" onClick={() => router.push('/pricing')}>
                            <span className="material-icons-round">diamond</span>
                            Plan: {organization?.Subscription_Plan || 'Free'}
                        </button>
                        <button className="user-menu-item danger" onClick={handleLogout}>
                            <span className="material-icons-round">logout</span>
                            Odjava
                        </button>
                    </div>
                </div>
            </header>

            {/* Tab Navigation */}
            <nav className="tabs">
                <button
                    className={`tab ${activeTab === 'projects' ? 'active' : ''}`}
                    onClick={() => handleTabClick('projects')}
                >
                    <span className="material-icons-round">folder</span>
                    Projekti
                </button>
                <button
                    className={`tab ${activeTab === 'offers' ? 'active' : ''}`}
                    onClick={() => handleTabClick('offers')}
                >
                    <span className="material-icons-round">request_quote</span>
                    Ponude
                    {!hasModule('offers') && <span className="material-icons-round tab-lock">lock</span>}
                </button>
                <button
                    className={`tab ${activeTab === 'orders' ? 'active' : ''}`}
                    onClick={() => handleTabClick('orders')}
                >
                    <span className="material-icons-round">local_shipping</span>
                    Narudžbe
                    {!hasModule('orders') && <span className="material-icons-round tab-lock">lock</span>}
                </button>

                {/* Settings Dropdown */}
                <div ref={settingsDropdownRef} className={`tab-dropdown ${dropdownOpen ? 'open' : ''}`}>
                    <button
                        className={`tab tab-more ${isDropdownTab ? 'active' : ''}`}
                        onClick={() => {
                            setDropdownOpen(!dropdownOpen);
                            setUserMenuOpen(false); // Close user menu
                        }}
                    >
                        <span className="material-icons-round">settings</span>
                        Podešavanja
                        <span className="material-icons-round dropdown-arrow">expand_more</span>
                    </button>
                    <div className="tab-dropdown-menu">
                        <button
                            className={`tab-dropdown-item ${activeTab === 'materials' ? 'active' : ''}`}
                            onClick={() => handleTabClick('materials')}
                        >
                            <span className="material-icons-round">inventory_2</span>
                            Materijali
                        </button>
                        <button
                            className={`tab-dropdown-item ${activeTab === 'workers' ? 'active' : ''}`}
                            onClick={() => handleTabClick('workers')}
                        >
                            <span className="material-icons-round">people</span>
                            Radnici
                        </button>
                        <button
                            className={`tab-dropdown-item ${activeTab === 'suppliers' ? 'active' : ''}`}
                            onClick={() => handleTabClick('suppliers')}
                        >
                            <span className="material-icons-round">store</span>
                            Dobavljači
                        </button>
                    </div>
                </div>
            </nav>

            {/* Tab Content */}
            <main className="content">
                {activeTab === 'projects' && (
                    <ProjectsTab
                        projects={appState.projects}
                        materials={appState.materials}
                        onRefresh={loadData}
                        showToast={showToast}
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
                        />
                    </ModuleGuard>
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

            {/* Toast Notifications */}
            {toast && <Toast message={toast.message} type={toast.type} />}

            {/* Loading Overlay */}
            <LoadingOverlay visible={loading} />
        </div>
    );
}
