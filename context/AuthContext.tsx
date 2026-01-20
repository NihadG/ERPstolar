'use client';

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { auth } from '@/lib/firebase';
import {
    onAuthStateChanged,
    FirebaseUser,
    getUserProfile,
    getOrganization,
    updateLastLogin,
} from '@/lib/auth';
import type { User, Organization, ModuleAccess } from '@/lib/types';

// ============================================
// AUTH CONTEXT TYPES
// ============================================

interface AuthContextType {
    // Auth state
    firebaseUser: FirebaseUser | null;
    user: User | null;
    organization: Organization | null;
    loading: boolean;

    // Module access helpers
    hasModule: (module: keyof ModuleAccess) => boolean;
    isOwner: boolean;
    isAdmin: boolean;

    // Refresh functions
    refreshUser: () => Promise<void>;
    refreshOrganization: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// ============================================
// AUTH PROVIDER
// ============================================

interface AuthProviderProps {
    children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
    const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
    const [user, setUser] = useState<User | null>(null);
    const [organization, setOrganization] = useState<Organization | null>(null);
    const [loading, setLoading] = useState(true);

    // Listen to Firebase auth state changes
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
            setFirebaseUser(fbUser);

            if (fbUser) {
                // Fetch user profile and organization
                const userProfile = await getUserProfile(fbUser.uid);
                setUser(userProfile);

                if (userProfile) {
                    const org = await getOrganization(userProfile.Organization_ID);
                    setOrganization(org);

                    // Update last login
                    await updateLastLogin(fbUser.uid);
                }
            } else {
                setUser(null);
                setOrganization(null);
            }

            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    // Check if user has access to a module
    const hasModule = (module: keyof ModuleAccess): boolean => {
        if (!organization) return false;

        // Enterprise has all modules
        if (organization.Subscription_Plan === 'enterprise') return true;

        // Professional has offers
        if (organization.Subscription_Plan === 'professional' && module === 'offers') return true;

        // Check specific module access
        return organization.Modules[module] || false;
    };

    // Role checks
    const isOwner = user?.Role === 'owner';
    const isAdmin = user?.Role === 'owner' || user?.Role === 'admin';

    // Refresh user data
    const refreshUser = async () => {
        if (firebaseUser) {
            const userProfile = await getUserProfile(firebaseUser.uid);
            setUser(userProfile);
        }
    };

    // Refresh organization data
    const refreshOrganization = async () => {
        if (user) {
            const org = await getOrganization(user.Organization_ID);
            setOrganization(org);
        }
    };

    const value: AuthContextType = {
        firebaseUser,
        user,
        organization,
        loading,
        hasModule,
        isOwner,
        isAdmin,
        refreshUser,
        refreshOrganization,
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
}

// ============================================
// USE AUTH HOOK
// ============================================

export function useAuth(): AuthContextType {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}

// ============================================
// PROTECTED ROUTE COMPONENT
// ============================================

interface ProtectedRouteProps {
    children: ReactNode;
    requiredRole?: 'owner' | 'admin' | 'manager' | 'worker';
}

export function ProtectedRoute({ children, requiredRole }: ProtectedRouteProps) {
    const { user, loading } = useAuth();

    if (loading) {
        return (
            <div className="auth-loading">
                <div className="loading-spinner"></div>
                <p>Učitavanje...</p>
            </div>
        );
    }

    if (!user) {
        // Redirect to login - handled by layout
        return null;
    }

    if (requiredRole) {
        const roleHierarchy = ['worker', 'manager', 'admin', 'owner'];
        const userRoleIndex = roleHierarchy.indexOf(user.Role);
        const requiredRoleIndex = roleHierarchy.indexOf(requiredRole);

        if (userRoleIndex < requiredRoleIndex) {
            return (
                <div className="access-denied">
                    <span className="material-icons-round">lock</span>
                    <h2>Pristup odbijen</h2>
                    <p>Nemate dozvolu za pristup ovoj stranici.</p>
                </div>
            );
        }
    }

    return <>{children}</>;
}
