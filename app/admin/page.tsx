'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import {
    collection,
    getDocs,
    doc,
    updateDoc,
    query,
    orderBy
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Organization, ModuleAccess } from '@/lib/types';

// ============================================
// TYPES
// ============================================

interface OrganizationWithUsers extends Organization {
    userCount?: number;
    ownerEmail?: string;
}

// ============================================
// CONSTANTS
// ============================================

const PLANS: { value: Organization['Subscription_Plan']; label: string; color: string }[] = [
    { value: 'free', label: 'Free', color: '#86868b' },
    { value: 'basic', label: 'Basic', color: '#34c759' },
    { value: 'professional', label: 'Professional', color: '#0071e3' },
    { value: 'enterprise', label: 'Enterprise', color: '#af52de' },
];

const DEFAULT_MODULES: Record<Organization['Subscription_Plan'], ModuleAccess> = {
    free: { offers: false, orders: false, reports: false, api_access: false },
    basic: { offers: true, orders: false, reports: false, api_access: false },
    professional: { offers: true, orders: true, reports: true, api_access: false },
    enterprise: { offers: true, orders: true, reports: true, api_access: true },
};

// ============================================
// ADMIN PAGE COMPONENT
// ============================================

export default function AdminPage() {
    const router = useRouter();
    const { user, loading: authLoading } = useAuth();

    const [organizations, setOrganizations] = useState<OrganizationWithUsers[]>([]);
    const [loading, setLoading] = useState(true);
    const [updating, setUpdating] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');

    // Check authorization - only redirect after auth is fully loaded
    useEffect(() => {
        // Debug log to help troubleshoot
        console.log('Admin page auth check:', {
            authLoading,
            user: user?.Email,
            isSuperAdmin: user?.Is_Super_Admin
        });

        // Wait for auth to fully load before checking access
        if (!authLoading && user !== undefined) {
            if (!user?.Is_Super_Admin) {
                console.log('Not a super admin, redirecting to home');
                router.push('/');
            }
        }
    }, [user, authLoading, router]);

    // Load all organizations
    useEffect(() => {
        async function loadOrganizations() {
            if (!user?.Is_Super_Admin) return;

            try {
                const orgsRef = collection(db, 'organizations');
                const orgsSnap = await getDocs(query(orgsRef, orderBy('Created_Date', 'desc')));

                const orgs: OrganizationWithUsers[] = orgsSnap.docs.map(doc => ({
                    ...doc.data() as Organization,
                }));

                // Get user counts for each org
                const usersRef = collection(db, 'users');
                const usersSnap = await getDocs(usersRef);

                const usersByOrg = new Map<string, { count: number; ownerEmail?: string }>();
                usersSnap.docs.forEach(doc => {
                    const userData = doc.data();
                    const orgId = userData.Organization_ID;
                    const current = usersByOrg.get(orgId) || { count: 0 };
                    current.count++;
                    if (userData.Role === 'owner') {
                        current.ownerEmail = userData.Email;
                    }
                    usersByOrg.set(orgId, current);
                });

                orgs.forEach(org => {
                    const userData = usersByOrg.get(org.Organization_ID);
                    org.userCount = userData?.count || 0;
                    org.ownerEmail = userData?.ownerEmail;
                });

                setOrganizations(orgs);
            } catch (error) {
                console.error('Error loading organizations:', error);
            } finally {
                setLoading(false);
            }
        }

        loadOrganizations();
    }, [user]);

    // Update organization plan
    async function updatePlan(orgId: string, newPlan: Organization['Subscription_Plan']) {
        setUpdating(orgId);
        try {
            // Find the document by Organization_ID
            const orgsRef = collection(db, 'organizations');
            const snapshot = await getDocs(orgsRef);
            const orgDoc = snapshot.docs.find(d => d.data().Organization_ID === orgId);

            if (orgDoc) {
                await updateDoc(orgDoc.ref, {
                    Subscription_Plan: newPlan,
                    Modules: DEFAULT_MODULES[newPlan],
                });

                setOrganizations(prev => prev.map(org =>
                    org.Organization_ID === orgId
                        ? { ...org, Subscription_Plan: newPlan, Modules: DEFAULT_MODULES[newPlan] }
                        : org
                ));
            }
        } catch (error) {
            console.error('Error updating plan:', error);
            alert('Greška pri ažuriranju plana');
        } finally {
            setUpdating(null);
        }
    }

    // Toggle organization active status
    async function toggleActive(orgId: string, currentStatus: boolean) {
        setUpdating(orgId);
        try {
            const orgsRef = collection(db, 'organizations');
            const snapshot = await getDocs(orgsRef);
            const orgDoc = snapshot.docs.find(d => d.data().Organization_ID === orgId);

            if (orgDoc) {
                await updateDoc(orgDoc.ref, { Is_Active: !currentStatus });
                setOrganizations(prev => prev.map(org =>
                    org.Organization_ID === orgId
                        ? { ...org, Is_Active: !currentStatus }
                        : org
                ));
            }
        } catch (error) {
            console.error('Error toggling status:', error);
        } finally {
            setUpdating(null);
        }
    }

    // Filter organizations
    const filteredOrgs = organizations.filter(org =>
        org.Name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        org.Email.toLowerCase().includes(searchTerm.toLowerCase()) ||
        org.ownerEmail?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    // Loading state
    if (authLoading || loading) {
        return (
            <div className="admin-loading">
                <div className="spinner"></div>
                <p>Učitavanje...</p>
            </div>
        );
    }

    // Not authorized
    if (!user?.Is_Super_Admin) {
        return null;
    }

    return (
        <div className="admin-container">
            <header className="admin-header">
                <div className="admin-header-content">
                    <h1>🛡️ Admin Panel</h1>
                    <p>{organizations.length} organizacija</p>
                </div>
                <button className="admin-back-btn" onClick={() => router.push('/')}>
                    ← Nazad na app
                </button>
            </header>

            <div className="admin-toolbar">
                <input
                    type="text"
                    placeholder="Pretraži organizacije..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="admin-search"
                />
                <div className="admin-stats">
                    {PLANS.map(plan => (
                        <span key={plan.value} className="admin-stat" style={{ borderColor: plan.color }}>
                            {plan.label}: {organizations.filter(o => o.Subscription_Plan === plan.value).length}
                        </span>
                    ))}
                </div>
            </div>

            <div className="admin-table-container">
                <table className="admin-table">
                    <thead>
                        <tr>
                            <th>Organizacija</th>
                            <th>Owner</th>
                            <th>Korisnici</th>
                            <th>Plan</th>
                            <th>Moduli</th>
                            <th>Status</th>
                            <th>Kreirano</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredOrgs.map(org => (
                            <tr key={org.Organization_ID} className={!org.Is_Active ? 'inactive-row' : ''}>
                                <td>
                                    <div className="org-info">
                                        <strong>{org.Name}</strong>
                                        <span className="org-email">{org.Email}</span>
                                    </div>
                                </td>
                                <td className="owner-cell">{org.ownerEmail || '-'}</td>
                                <td className="users-cell">{org.userCount || 0}</td>
                                <td>
                                    <select
                                        value={org.Subscription_Plan}
                                        onChange={(e) => updatePlan(org.Organization_ID, e.target.value as Organization['Subscription_Plan'])}
                                        disabled={updating === org.Organization_ID}
                                        className="plan-select"
                                        style={{
                                            borderColor: PLANS.find(p => p.value === org.Subscription_Plan)?.color
                                        }}
                                    >
                                        {PLANS.map(plan => (
                                            <option key={plan.value} value={plan.value}>
                                                {plan.label}
                                            </option>
                                        ))}
                                    </select>
                                </td>
                                <td className="modules-cell">
                                    <div className="module-badges">
                                        {org.Modules.offers && <span className="module-badge">Ponude</span>}
                                        {org.Modules.orders && <span className="module-badge">Narudžbe</span>}
                                        {org.Modules.reports && <span className="module-badge">Izvještaji</span>}
                                        {org.Modules.api_access && <span className="module-badge api">API</span>}
                                    </div>
                                </td>
                                <td>
                                    <button
                                        onClick={() => toggleActive(org.Organization_ID, org.Is_Active)}
                                        disabled={updating === org.Organization_ID}
                                        className={`status-btn ${org.Is_Active ? 'active' : 'inactive'}`}
                                    >
                                        {org.Is_Active ? '✓ Aktivan' : '✗ Neaktivan'}
                                    </button>
                                </td>
                                <td className="date-cell">
                                    {new Date(org.Created_Date).toLocaleDateString('bs-BA')}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>

                {filteredOrgs.length === 0 && (
                    <div className="no-results">
                        Nema rezultata za "{searchTerm}"
                    </div>
                )}
            </div>

            <style jsx>{`
                .admin-container {
                    min-height: 100vh;
                    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
                    color: #fff;
                    padding: 2rem;
                }

                .admin-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 2rem;
                    padding-bottom: 1rem;
                    border-bottom: 1px solid rgba(255,255,255,0.1);
                }

                .admin-header h1 {
                    font-size: 2rem;
                    margin: 0;
                }

                .admin-header p {
                    color: #888;
                    margin: 0.5rem 0 0;
                }

                .admin-back-btn {
                    background: rgba(255,255,255,0.1);
                    border: 1px solid rgba(255,255,255,0.2);
                    color: #fff;
                    padding: 0.75rem 1.5rem;
                    border-radius: 8px;
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .admin-back-btn:hover {
                    background: rgba(255,255,255,0.2);
                }

                .admin-toolbar {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 1.5rem;
                    gap: 1rem;
                    flex-wrap: wrap;
                }

                .admin-search {
                    flex: 1;
                    min-width: 250px;
                    padding: 0.75rem 1rem;
                    border-radius: 8px;
                    border: 1px solid rgba(255,255,255,0.2);
                    background: rgba(255,255,255,0.05);
                    color: #fff;
                    font-size: 1rem;
                }

                .admin-search::placeholder {
                    color: #666;
                }

                .admin-stats {
                    display: flex;
                    gap: 0.5rem;
                }

                .admin-stat {
                    padding: 0.5rem 1rem;
                    background: rgba(255,255,255,0.05);
                    border-radius: 6px;
                    font-size: 0.85rem;
                    border-left: 3px solid;
                }

                .admin-table-container {
                    background: rgba(255,255,255,0.03);
                    border-radius: 12px;
                    overflow: hidden;
                    border: 1px solid rgba(255,255,255,0.1);
                }

                .admin-table {
                    width: 100%;
                    border-collapse: collapse;
                }

                .admin-table th {
                    background: rgba(255,255,255,0.05);
                    padding: 1rem;
                    text-align: left;
                    font-weight: 600;
                    font-size: 0.85rem;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                    color: #888;
                }

                .admin-table td {
                    padding: 1rem;
                    border-top: 1px solid rgba(255,255,255,0.05);
                    vertical-align: middle;
                }

                .inactive-row {
                    opacity: 0.5;
                }

                .org-info {
                    display: flex;
                    flex-direction: column;
                    gap: 0.25rem;
                }

                .org-email {
                    font-size: 0.8rem;
                    color: #666;
                }

                .owner-cell, .date-cell {
                    color: #888;
                    font-size: 0.9rem;
                }

                .users-cell {
                    text-align: center;
                    font-weight: 600;
                }

                .plan-select {
                    padding: 0.5rem 1rem;
                    border-radius: 6px;
                    border: 2px solid;
                    background: rgba(255,255,255,0.05);
                    color: #fff;
                    cursor: pointer;
                    font-size: 0.9rem;
                }

                .plan-select option {
                    background: #1a1a2e;
                    color: #fff;
                }

                .module-badges {
                    display: flex;
                    gap: 0.25rem;
                    flex-wrap: wrap;
                }

                .module-badge {
                    padding: 0.25rem 0.5rem;
                    background: rgba(52, 199, 89, 0.2);
                    color: #34c759;
                    border-radius: 4px;
                    font-size: 0.75rem;
                }

                .module-badge.api {
                    background: rgba(175, 82, 222, 0.2);
                    color: #af52de;
                }

                .status-btn {
                    padding: 0.5rem 1rem;
                    border-radius: 6px;
                    border: none;
                    cursor: pointer;
                    font-size: 0.85rem;
                    transition: all 0.2s;
                }

                .status-btn.active {
                    background: rgba(52, 199, 89, 0.2);
                    color: #34c759;
                }

                .status-btn.inactive {
                    background: rgba(255, 59, 48, 0.2);
                    color: #ff3b30;
                }

                .status-btn:hover {
                    transform: scale(1.05);
                }

                .status-btn:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }

                .no-results {
                    text-align: center;
                    padding: 3rem;
                    color: #666;
                }

                .admin-loading {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    height: 100vh;
                    background: #1a1a2e;
                    color: #fff;
                }

                .spinner {
                    width: 40px;
                    height: 40px;
                    border: 3px solid rgba(255,255,255,0.1);
                    border-top-color: #0071e3;
                    border-radius: 50%;
                    animation: spin 1s linear infinite;
                }

                @keyframes spin {
                    to { transform: rotate(360deg); }
                }

                @media (max-width: 768px) {
                    .admin-container {
                        padding: 1rem;
                    }

                    .admin-table-container {
                        overflow-x: auto;
                    }

                    .admin-table {
                        min-width: 800px;
                    }

                    .admin-header {
                        flex-direction: column;
                        gap: 1rem;
                        align-items: flex-start;
                    }
                }
            `}</style>
        </div>
    );
}
