'use client';

import { ReactNode } from 'react';
import { useAuth } from '@/context/AuthContext';
import type { ModuleAccess } from '@/lib/types';
import Link from 'next/link';

interface ModuleGuardProps {
    children: ReactNode;
    module: keyof ModuleAccess;
    moduleName: string;
}

export default function ModuleGuard({ children, module, moduleName }: ModuleGuardProps) {
    const { hasModule, loading, organization } = useAuth();

    if (loading) {
        return (
            <div className="module-loading">
                <div className="loading-spinner"></div>
            </div>
        );
    }

    if (!hasModule(module)) {
        return (
            <div className="module-locked">
                {/* Decorative floating glass elements */}
                <div className="glass-decor glass-decor-1"></div>
                <div className="glass-decor glass-decor-2"></div>
                <div className="glass-decor glass-decor-3"></div>

                <div className="module-locked-card">
                    <div className="lock-icon-container">
                        <div className="lock-icon-glow"></div>
                        <div className="lock-icon">
                            <span className="material-icons-round">lock</span>
                        </div>
                    </div>

                    <h2>{moduleName}</h2>
                    <p>
                        Ovaj modul nije uključen u vaš trenutni plan.
                        Nadogradite svoj plan da biste pristupili svim funkcijama.
                    </p>

                    <Link href="/pricing" className="upgrade-btn">
                        <span className="btn-glow"></span>
                        <span className="material-icons-round">diamond</span>
                        <span>Pogledaj planove</span>
                    </Link>

                    <div className="plan-badge">
                        <span className="material-icons-round">verified</span>
                        Trenutni plan: <strong>{organization?.Subscription_Plan || 'Free'}</strong>
                    </div>
                </div>
            </div>
        );
    }

    return <>{children}</>;
}
