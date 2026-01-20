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
                <div className="lock-icon">
                    <span className="material-icons-round">lock</span>
                </div>
                <h2>{moduleName}</h2>
                <p>
                    Ovaj modul nije uključen u vaš trenutni plan.
                    Nadogradite svoj plan da biste pristupili svim funkcijama.
                </p>
                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' }}>
                    <Link href="/pricing" className="upgrade-btn">
                        <span className="material-icons-round">upgrade</span>
                        Pogledaj planove
                    </Link>
                </div>
                <p style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginTop: '24px' }}>
                    Trenutni plan: <strong>{organization?.Subscription_Plan || 'Free'}</strong>
                </p>
            </div>
        );
    }

    return <>{children}</>;
}
