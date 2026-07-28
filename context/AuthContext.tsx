'use client';

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { auth } from '@/lib/firebase';
import {
    onAuthStateChanged,
    FirebaseUser,
    getUserProfile,
    getOrganization,
    updateLastLogin,
    signOut,
} from '@/lib/auth';
import type { User, Organization, ModuleAccess, UserRole } from '@/lib/types';
import { ROLE_HIERARCHY, isStaffRole, isFieldRole } from '@/lib/types';

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

    // Uloge: `staff` vidi punu aplikaciju na `/`, `field` ide na `/pogon`.
    role: UserRole | null;
    isStaff: boolean;
    isField: boolean;
    /** Mora postaviti vlastitu lozinku prije bilo čega drugog. */
    mustChangePassword: boolean;

    refreshUser: () => Promise<void>;
    refreshOrganization: () => Promise<void>;
    signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * Osigura da token nosi `orgId` i `role`.
 *
 * Zove server rutu koja claims čita iz users/{uid} (nikad iz zahtjeva), pa
 * osvježi token. Tiho odustaje ako server sloj nije podešen — postojeći
 * vlasnici i dalje rade preko fallbacka u firestore.rules, samo skuplje.
 */
async function ensureClaims(fbUser: FirebaseUser): Promise<void> {
    try {
        const token = await fbUser.getIdTokenResult();
        if (token.claims.orgId && token.claims.role) return;

        const res = await fetch('/api/auth/sync-claims', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token.token}` },
        });
        if (!res.ok) return;

        await fbUser.getIdToken(true);   // povuci novi token s claimovima
    } catch (e) {
        console.warn('Sinhronizacija uloge nije uspjela (nastavljam s fallbackom):', e);
    }
}

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
        // Only set up listener if auth is available (browser environment)
        if (!auth) {
            setLoading(false);
            return;
        }

        const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
            setFirebaseUser(fbUser);

            if (fbUser) {
                // MIGRACIJA CLAIMOVA — nalozi napravljeni prije uvođenja uloga nemaju
                // orgId/role u tokenu, a firestore.rules ih odatle čita. Ovo mora proći
                // PRIJE prvog čitanja iz Firestorea, inače pravila odbiju zahtjev.
                await ensureClaims(fbUser);

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

    // Check super admin status from user profile (stored securely in Firestore)
    // Note: Is_Super_Admin should only be set via Firestore Console, never from client
    const isSuperAdmin = user?.Is_Super_Admin === true;

    // Check if user has access to a module
    const hasModule = (module: keyof ModuleAccess): boolean => {
        // Super admins always have full access
        if (isSuperAdmin) return true;

        if (!organization) return false;

        // Enterprise has all modules
        if (organization.Subscription_Plan === 'enterprise') return true;

        // Professional has offers
        if (organization.Subscription_Plan === 'professional' && module === 'offers') return true;

        // Check specific module access
        return organization.Modules[module] || false;
    };

    // Role checks
    const role = (user?.Role as UserRole | undefined) ?? null;
    const isOwner = role === 'owner';
    const isAdmin = role === 'owner' || role === 'admin';
    const isStaff = isStaffRole(role) || isSuperAdmin;
    const isField = isFieldRole(role) && !isSuperAdmin;
    const mustChangePassword = user?.Must_Change_Password === true;

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

    // Sign out wrapper
    const handleSignOut = async () => {
        await signOut();
    };

    const value: AuthContextType = {
        firebaseUser,
        user,
        organization,
        loading,
        hasModule,
        isOwner,
        isAdmin,
        role,
        isStaff,
        isField,
        mustChangePassword,
        refreshUser,
        refreshOrganization,
        signOut: handleSignOut,
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
    requiredRole?: UserRole;
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
        const userRoleIndex = ROLE_HIERARCHY.indexOf(user.Role);
        const requiredRoleIndex = ROLE_HIERARCHY.indexOf(requiredRole);

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
