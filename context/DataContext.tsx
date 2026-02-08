'use client';

import React, { createContext, useContext, useState, useCallback, ReactNode, useRef } from 'react';
import type { AppState, Project, Material, Offer, Order, Supplier, Worker, WorkOrder, Task } from '@/lib/types';
import {
    getProjects,
    getMaterialsCatalog,
    getSuppliers,
    getWorkers,
    getOffers,
    getOrders,
    getWorkOrders,
    getTasks,
    getAllData,
} from '@/lib/database';
import { useAuth } from './AuthContext';

// ============================================
// TYPES
// ============================================

type CollectionName = 'projects' | 'materials' | 'suppliers' | 'workers' | 'offers' | 'orders' | 'workOrders' | 'tasks';

interface DataContextType {
    // State
    appState: AppState;
    loading: boolean;
    loadedCollections: Set<CollectionName>;
    organizationId: string | null;

    // Actions
    loadTabData: (tabName: string) => Promise<void>;
    loadAllData: () => Promise<void>;
    refreshData: () => Promise<void>;
    invalidateTab: (tabName: string) => void;
    invalidateCollection: (collection: CollectionName) => void;

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
// COLLECTION LOADERS
// ============================================

const collectionLoaders: Record<CollectionName, (orgId: string) => Promise<any[]>> = {
    projects: getProjects,
    materials: getMaterialsCatalog,
    suppliers: getSuppliers,
    workers: getWorkers,
    offers: getOffers,
    orders: getOrders,
    workOrders: getWorkOrders,
    tasks: getTasks,
};

// Map tabs to their required collections
const tabCollectionMap: Record<string, CollectionName[]> = {
    projects: ['projects', 'materials', 'workOrders'],
    overview: ['projects', 'workOrders', 'orders'],
    offers: ['offers', 'projects'],
    orders: ['orders', 'suppliers', 'projects'],
    production: ['workOrders', 'projects', 'workers'],
    planner: ['workOrders', 'projects', 'workers'],
    materials: ['materials'],
    workers: ['workers'],
    suppliers: ['suppliers'],
    tasks: ['tasks', 'projects', 'workers'],
    attendance: ['workers'],
};

// ============================================
// PROVIDER
// ============================================

interface DataProviderProps {
    children: ReactNode;
}

export function DataProvider({ children }: DataProviderProps) {
    const { organization } = useAuth();
    const organizationId = organization?.Organization_ID || null;

    const [appState, setAppState] = useState<AppState>(initialAppState);
    const [loading, setLoading] = useState(false);
    const [loadedCollections, setLoadedCollections] = useState<Set<CollectionName>>(new Set());

    // Track which tabs have been "visited" for UI purposes
    const loadedTabs = useRef<Set<string>>(new Set());

    // Load a single collection if not already loaded
    const loadCollection = useCallback(async (collection: CollectionName, orgId: string): Promise<any[]> => {
        const loader = collectionLoaders[collection];
        if (!loader) {
            console.warn(`No loader for collection: ${collection}`);
            return [];
        }
        return await loader(orgId);
    }, []);

    // Load data for a specific tab (true lazy loading)
    const loadTabData = useCallback(async (tabName: string) => {
        if (!organizationId) return;

        const requiredCollections = tabCollectionMap[tabName] || [];
        const collectionsToLoad = requiredCollections.filter(c => !loadedCollections.has(c));

        // If all collections already loaded, just mark tab as visited
        if (collectionsToLoad.length === 0) {
            loadedTabs.current.add(tabName);
            return;
        }

        setLoading(true);

        try {
            // Load only the collections that haven't been loaded yet
            const loadPromises = collectionsToLoad.map(async (collection) => {
                const data = await loadCollection(collection, organizationId);
                return { collection, data };
            });

            const results = await Promise.all(loadPromises);

            // Update state with new data
            setAppState(prev => {
                const updates: Partial<AppState> = {};
                for (const { collection, data } of results) {
                    updates[collection] = data;
                }
                return { ...prev, ...updates };
            });

            // Mark these collections as loaded
            setLoadedCollections(prev => {
                const next = new Set(prev);
                collectionsToLoad.forEach(c => next.add(c));
                return next;
            });

            loadedTabs.current.add(tabName);
        } catch (error) {
            console.error(`Error loading data for tab ${tabName}:`, error);
        } finally {
            setLoading(false);
        }
    }, [loadedCollections, organizationId, loadCollection]);

    // Load all data (for compatibility or full refresh)
    const loadAllData = useCallback(async () => {
        if (!organizationId) return;

        setLoading(true);
        try {
            const allData = await getAllData(organizationId);
            setAppState(allData);
            // Mark all collections as loaded
            setLoadedCollections(new Set<CollectionName>(['projects', 'materials', 'suppliers', 'workers', 'offers', 'orders', 'workOrders', 'tasks']));
            // Mark all tabs as loaded
            Object.keys(tabCollectionMap).forEach(tab => loadedTabs.current.add(tab));
        } catch (error) {
            console.error('Error loading all data:', error);
        } finally {
            setLoading(false);
        }
    }, [organizationId]);

    // Refresh all data (invalidate cache and reload)
    const refreshData = useCallback(async () => {
        setLoadedCollections(new Set());
        loadedTabs.current = new Set();
        await loadAllData();
    }, [loadAllData]);

    // Invalidate a specific tab's data
    const invalidateTab = useCallback((tabName: string) => {
        const collections = tabCollectionMap[tabName] || [];
        setLoadedCollections(prev => {
            const next = new Set(prev);
            collections.forEach(c => next.delete(c));
            return next;
        });
        loadedTabs.current.delete(tabName);

        // Also invalidate related tabs that share collections
        Object.entries(tabCollectionMap).forEach(([tab, deps]) => {
            if (deps.some(d => collections.includes(d))) {
                loadedTabs.current.delete(tab);
            }
        });
    }, []);

    // Invalidate a specific collection
    const invalidateCollection = useCallback((collection: CollectionName) => {
        setLoadedCollections(prev => {
            const next = new Set(prev);
            next.delete(collection);
            return next;
        });

        // Invalidate all tabs that depend on this collection
        Object.entries(tabCollectionMap).forEach(([tab, deps]) => {
            if (deps.includes(collection)) {
                loadedTabs.current.delete(tab);
            }
        });
    }, []);

    // Check if a tab's data is already loaded
    const isTabLoaded = useCallback((tabName: string) => {
        const requiredCollections = tabCollectionMap[tabName] || [];
        return requiredCollections.every(c => loadedCollections.has(c));
    }, [loadedCollections]);

    const value: DataContextType = {
        appState,
        loading,
        loadedCollections,
        organizationId,
        loadTabData,
        loadAllData,
        refreshData,
        invalidateTab,
        invalidateCollection,
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
