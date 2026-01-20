'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import type { Organization, ModuleAccess } from '@/lib/types';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

const SUBSCRIPTION_PLANS = ['free', 'professional', 'enterprise'] as const;

export default function AdminPage() {
    const router = useRouter();
    const { user, loading: authLoading } = useAuth();
    const [organizations, setOrganizations] = useState<Organization[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState<string | null>(null);
    const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

    // Check if user is admin (you can customize this)
    const isAdmin = user?.Email?.endsWith('@admin.com') || user?.Email === 'admin@admin.com';

    useEffect(() => {
        if (!authLoading && !user) {
            router.push('/login');
        } else if (!authLoading && user && !isAdmin) {
            router.push('/');
        } else if (user && isAdmin) {
            loadOrganizations();
        }
    }, [authLoading, user, isAdmin, router]);

    async function loadOrganizations() {
        setLoading(true);
        try {
            const snapshot = await getDocs(collection(db, 'organizations'));
            const orgs: Organization[] = [];
            snapshot.forEach((doc) => {
                orgs.push(doc.data() as Organization);
            });
            setOrganizations(orgs);
        } catch (error) {
            console.error('Error loading organizations:', error);
            showMessage('Greška pri učitavanju organizacija', 'error');
        }
        setLoading(false);
    }

    async function updateOrganization(orgId: string, updates: Partial<Organization>) {
        setSaving(orgId);
        try {
            await updateDoc(doc(db, 'organizations', orgId), updates);
            setOrganizations(prev =>
                prev.map(org => org.Organization_ID === orgId ? { ...org, ...updates } : org)
            );
            showMessage('Organizacija ažurirana uspješno', 'success');
        } catch (error) {
            console.error('Error updating organization:', error);
            showMessage('Greška pri ažuriranju', 'error');
        }
        setSaving(null);
    }

    async function toggleModule(orgId: string, module: keyof ModuleAccess, currentValue: boolean) {
        const org = organizations.find(o => o.Organization_ID === orgId);
        if (!org) return;

        const newModules = {
            ...org.Modules,
            [module]: !currentValue,
        };

        await updateOrganization(orgId, { Modules: newModules });
    }

    async function changePlan(orgId: string, newPlan: typeof SUBSCRIPTION_PLANS[number]) {
        // Auto-adjust modules based on plan
        let modules: ModuleAccess = {
            offers: false,
            orders: false,
            reports: false,
            api_access: false,
        };

        if (newPlan === 'professional') {
            modules.offers = true;
        } else if (newPlan === 'enterprise') {
            modules.offers = true;
            modules.orders = true;
        }

        await updateOrganization(orgId, {
            Subscription_Plan: newPlan,
            Modules: modules,
        });
    }

    function showMessage(text: string, type: 'success' | 'error') {
        setMessage({ text, type });
        setTimeout(() => setMessage(null), 3000);
    }

    if (authLoading || loading) {
        return (
            <div className="auth-loading">
                <div className="loading-spinner"></div>
                <p>Učitavanje...</p>
            </div>
        );
    }

    if (!isAdmin) {
        return null;
    }

    return (
        <div className="admin-page">
            <nav className="admin-nav">
                <Link href="/" className="back-link">
                    <span className="material-icons-round">arrow_back</span>
                    Nazad na aplikaciju
                </Link>
                <h1>Admin Panel</h1>
            </nav>

            {message && (
                <div className={`admin-message ${message.type}`}>
                    <span className="material-icons-round">
                        {message.type === 'success' ? 'check_circle' : 'error'}
                    </span>
                    {message.text}
                </div>
            )}

            <div className="admin-content">
                <div className="admin-header">
                    <h2>Organizacije ({organizations.length})</h2>
                    <button className="btn btn-secondary" onClick={loadOrganizations}>
                        <span className="material-icons-round">refresh</span>
                        Osvježi
                    </button>
                </div>

                <div className="organizations-table">
                    <div className="table-header">
                        <div className="col-name">Organizacija</div>
                        <div className="col-plan">Plan</div>
                        <div className="col-modules">Moduli</div>
                        <div className="col-status">Status</div>
                    </div>

                    {organizations.length === 0 ? (
                        <div className="empty-state">
                            <span className="material-icons-round">apartment</span>
                            <p>Nema registriranih organizacija</p>
                        </div>
                    ) : (
                        organizations.map(org => (
                            <div key={org.Organization_ID} className={`table-row ${saving === org.Organization_ID ? 'saving' : ''}`}>
                                <div className="col-name">
                                    <strong>{org.Name}</strong>
                                    <span className="org-email">{org.Email}</span>
                                    <span className="org-date">
                                        Registrirano: {new Date(org.Created_Date).toLocaleDateString('hr')}
                                    </span>
                                </div>

                                <div className="col-plan">
                                    <select
                                        value={org.Subscription_Plan}
                                        onChange={(e) => changePlan(org.Organization_ID, e.target.value as any)}
                                        disabled={saving === org.Organization_ID}
                                    >
                                        <option value="free">Free</option>
                                        <option value="professional">Professional (€29)</option>
                                        <option value="enterprise">Enterprise (€49)</option>
                                    </select>
                                </div>

                                <div className="col-modules">
                                    <label className="module-toggle">
                                        <input
                                            type="checkbox"
                                            checked={org.Modules?.offers || false}
                                            onChange={() => toggleModule(org.Organization_ID, 'offers', org.Modules?.offers || false)}
                                            disabled={saving === org.Organization_ID}
                                        />
                                        <span>Ponude</span>
                                    </label>
                                    <label className="module-toggle">
                                        <input
                                            type="checkbox"
                                            checked={org.Modules?.orders || false}
                                            onChange={() => toggleModule(org.Organization_ID, 'orders', org.Modules?.orders || false)}
                                            disabled={saving === org.Organization_ID}
                                        />
                                        <span>Narudžbe</span>
                                    </label>
                                </div>

                                <div className="col-status">
                                    <span className={`status-indicator ${org.Is_Active ? 'active' : 'inactive'}`}>
                                        {org.Is_Active ? 'Aktivno' : 'Neaktivno'}
                                    </span>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            <style jsx>{`
                .admin-page {
                    min-height: 100vh;
                    background: var(--surface);
                }

                .admin-nav {
                    display: flex;
                    align-items: center;
                    gap: 24px;
                    padding: 16px 24px;
                    background: var(--background);
                    border-bottom: 1px solid var(--border-light);
                }

                .back-link {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    color: var(--text-secondary);
                    text-decoration: none;
                    font-size: 14px;
                }

                .back-link:hover {
                    color: var(--accent);
                }

                .admin-nav h1 {
                    font-size: 20px;
                    font-weight: 600;
                }

                .admin-message {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 14px 24px;
                    margin: 16px 24px;
                    border-radius: 12px;
                    font-size: 14px;
                }

                .admin-message.success {
                    background: var(--success-bg);
                    color: var(--success);
                }

                .admin-message.error {
                    background: var(--error-bg);
                    color: var(--error);
                }

                .admin-content {
                    max-width: 1200px;
                    margin: 0 auto;
                    padding: 24px;
                }

                .admin-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 24px;
                }

                .admin-header h2 {
                    font-size: 18px;
                }

                .organizations-table {
                    background: var(--background);
                    border-radius: 16px;
                    overflow: hidden;
                    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
                }

                .table-header {
                    display: grid;
                    grid-template-columns: 2fr 1fr 1.5fr 1fr;
                    gap: 16px;
                    padding: 16px 24px;
                    background: var(--surface);
                    font-size: 12px;
                    font-weight: 600;
                    color: var(--text-secondary);
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }

                .table-row {
                    display: grid;
                    grid-template-columns: 2fr 1fr 1.5fr 1fr;
                    gap: 16px;
                    padding: 20px 24px;
                    border-bottom: 1px solid var(--border-light);
                    transition: background 0.2s;
                }

                .table-row:last-child {
                    border-bottom: none;
                }

                .table-row:hover {
                    background: var(--surface);
                }

                .table-row.saving {
                    opacity: 0.6;
                    pointer-events: none;
                }

                .col-name strong {
                    display: block;
                    font-size: 15px;
                    margin-bottom: 4px;
                }

                .org-email {
                    display: block;
                    font-size: 13px;
                    color: var(--text-secondary);
                }

                .org-date {
                    display: block;
                    font-size: 12px;
                    color: var(--text-tertiary);
                    margin-top: 4px;
                }

                .col-plan select {
                    padding: 8px 12px;
                    border: 1px solid var(--border);
                    border-radius: 8px;
                    font-size: 14px;
                    background: var(--background);
                    cursor: pointer;
                }

                .col-modules {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }

                .module-toggle {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-size: 14px;
                    cursor: pointer;
                }

                .module-toggle input {
                    width: 18px;
                    height: 18px;
                    accent-color: var(--accent);
                }

                .status-indicator {
                    display: inline-flex;
                    align-items: center;
                    padding: 4px 12px;
                    border-radius: 20px;
                    font-size: 12px;
                    font-weight: 500;
                }

                .status-indicator.active {
                    background: var(--success-bg);
                    color: var(--success);
                }

                .status-indicator.inactive {
                    background: var(--error-bg);
                    color: var(--error);
                }

                .empty-state {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    padding: 60px 20px;
                    color: var(--text-tertiary);
                }

                .empty-state .material-icons-round {
                    font-size: 48px;
                    margin-bottom: 16px;
                }

                @media (max-width: 900px) {
                    .table-header {
                        display: none;
                    }

                    .table-row {
                        grid-template-columns: 1fr;
                        gap: 12px;
                    }

                    .col-plan, .col-modules, .col-status {
                        display: flex;
                        align-items: center;
                        gap: 8px;
                    }

                    .col-modules {
                        flex-direction: row;
                    }
                }
            `}</style>
        </div>
    );
}
