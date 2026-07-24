'use client';

// ════════════════════════════════════════════════════════════════════
// DONJA NAVIGACIJA (telefon)
//
// Zamjena za sidebar na telefonu: četiri glavna toka nadohvat palca.
// Ostali tabovi (radnici, materijali, šihtarica, planer…) ostaju na desktopu.
// ════════════════════════════════════════════════════════════════════

import { FolderOpen, FileText, ShoppingCart, ClipboardList } from 'lucide-react';
import './MobileTabBar.css';

export interface MobileTab {
    id: string;
    label: string;
    Icon: typeof FolderOpen;
}

/** Redoslijed prati tok posla: projekat → ponuda → narudžba → nalog. */
export const MOBILE_TABS: MobileTab[] = [
    { id: 'projects', label: 'Projekti', Icon: FolderOpen },
    { id: 'offers', label: 'Ponude', Icon: FileText },
    { id: 'orders', label: 'Narudžbe', Icon: ShoppingCart },
    { id: 'production', label: 'Nalozi', Icon: ClipboardList },
];

interface Props {
    activeTab: string;
    onTabChange: (tab: string) => void;
}

export default function MobileTabBar({ activeTab, onTabChange }: Props) {
    return (
        <nav className="mtb" role="tablist" aria-label="Glavna navigacija">
            {MOBILE_TABS.map(t => {
                const on = activeTab === t.id;
                return (
                    <button
                        key={t.id}
                        type="button"
                        role="tab"
                        aria-selected={on}
                        className={`mtb-item${on ? ' on' : ''}`}
                        onClick={() => onTabChange(t.id)}
                    >
                        <t.Icon size={25} strokeWidth={on ? 2.1 : 1.8} />
                        <span>{t.label}</span>
                    </button>
                );
            })}
        </nav>
    );
}
