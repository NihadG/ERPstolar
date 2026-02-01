'use client';

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import type { AppState, Project, Material, Offer, Order, Supplier, Worker, WorkOrder, ProductMaterial, GlassItem, AluDoorItem } from '@/lib/types';
import {
    getProjects,
    getMaterialsCatalog,
    getSuppliers,
    getWorkers,
    getOffers,
    getOrders,
    getWorkOrders,
    getAllData,
} from '@/lib/database';

// ============================================
// TYPES
// ============================================

interface DataContextType {
    // State
    appState: AppState;
    loading: boolean;
    loadedTabs: Set<string>;

    // Actions
    loadTabData: (tabName: string) => Promise<void>;
    loadAllData: () => Promise<void>;
    refreshData: () => Promise<void>;
    invalidateTab: (tabName: string) => void;

    // Status
    isTabLoaded: (tabName: string) => boolean;
}

const initialAppState: AppState = {
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
};

// ============================================
// CONTEXT
// ============================================

const DataContext = createContext<DataContextType | undefined>(undefined);

// ============================================
// PROVIDER
// ============================================

interface DataProviderProps {
    children: ReactNode;
}

export function DataProvider({ children }: DataProviderProps) {
    const [appState, setAppState] = useState<AppState>(initialAppState);
    const [loading, setLoading] = useState(false);
    const [loadedTabs, setLoadedTabs] = useState<Set<string>>(new Set());

    // Map tabs to their required data
    const tabDataMap: Record<string, string[]> = {
        projects: ['projects', 'materials', 'workOrders'],
        overview: ['projects', 'workOrders', 'orders'],
        offers: ['offers', 'projects'],
        orders: ['orders', 'suppliers', 'projects', 'productMaterials'],
        production: ['workOrders', 'projects', 'workers'],
        materials: ['materials'],
        workers: ['workers'],
        suppliers: ['suppliers'],
        tasks: ['tasks', 'projects', 'workers'],
    };

    // Load data for a specific tab (lazy loading)
    const loadTabData = useCallback(async (tabName: string) => {
        // Skip if already loaded
        if (loadedTabs.has(tabName)) {
            return;
        }

        setLoading(true);

        try {
            // For now, load all data on first tab load to ensure consistency
            // In future, we can optimize to load only required collections
            if (loadedTabs.size === 0) {
                const allData = await getAllData();
                setAppState(allData);
                // Mark all tabs as loaded since we loaded all data
                setLoadedTabs(new Set(['projects', 'overview', 'offers', 'orders', 'production', 'materials', 'workers', 'suppliers', 'tasks']));
            } else {
                // Mark this tab as loaded
                setLoadedTabs(prev => new Set(prev).add(tabName));
            }
        } catch (error) {
            console.error(`Error loading data for tab ${tabName}:`, error);
        } finally {
            setLoading(false);
        }
    }, [loadedTabs]);

    // Load all data (for initial load or full refresh)
    const loadAllData = useCallback(async () => {
        setLoading(true);
        try {
            const allData = await getAllData();
            setAppState(allData);
            setLoadedTabs(new Set(['projects', 'overview', 'offers', 'orders', 'production', 'materials', 'workers', 'suppliers', 'tasks']));
        } catch (error) {
            console.error('Error loading all data:', error);
        } finally {
            setLoading(false);
        }
    }, []);

    // Refresh all data (invalidate cache and reload)
    const refreshData = useCallback(async () => {
        setLoadedTabs(new Set()); // Clear loaded tabs
        await loadAllData();
    }, [loadAllData]);

    // Invalidate a specific tab's data (force reload on next access)
    const invalidateTab = useCallback((tabName: string) => {
        setLoadedTabs(prev => {
            const next = new Set(prev);
            next.delete(tabName);
            // Also invalidate related tabs
            const relatedTabs = Object.entries(tabDataMap)
                .filter(([_, deps]) => deps.some(dep => tabDataMap[tabName]?.includes(dep)))
                .map(([tab]) => tab);
            relatedTabs.forEach(t => next.delete(t));
            return next;
        });
    }, []);

    // Check if a tab's data is already loaded
    const isTabLoaded = useCallback((tabName: string) => {
        return loadedTabs.has(tabName);
    }, [loadedTabs]);

    const value: DataContextType = {
        appState,
        loading,
        loadedTabs,
        loadTabData,
        loadAllData,
        refreshData,
        invalidateTab,
        isTabLoaded,
    };

    return (
        <DataContext.Provider value={value}>
            {children}
        </DataContext.Provider>
    );
}

// ============================================
// HOOK
// ============================================

export function useData(): DataContextType {
    const context = useContext(DataContext);
    if (context === undefined) {
        throw new Error('useData must be used within a DataProvider');
    }
    return context;
}

// ============================================
// HELPER HOOK: Load data on tab mount
// ============================================

export function useTabData(tabName: string) {
    const { loadTabData, isTabLoaded, loading } = useData();

    React.useEffect(() => {
        if (!isTabLoaded(tabName)) {
            loadTabData(tabName);
        }
    }, [tabName, isTabLoaded, loadTabData]);

    return { loading, isLoaded: isTabLoaded(tabName) };
}
