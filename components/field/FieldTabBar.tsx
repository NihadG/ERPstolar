'use client';

// ════════════════════════════════════════════════════════════════════
// DONJA NAVIGACIJA POGONSKOG EKRANA
//
// Isti obrazac i iste klase (`.mtb`) kao MobileTabBar — pogonska aplikacija
// mora izgledati kao ostatak aplikacije, samo s drugim sadržajem.
//
// Kontrolor ima četiri taba koja pokrivaju njegov dan; radnik samo ono što
// se njega tiče. Profil i odjava NE troše tab — sjede u dugmetu s inicijalima
// gore desno (vidi ControllerApp).
// ════════════════════════════════════════════════════════════════════

import { ClipboardList, FolderOpen, Home, CalendarCheck, ShoppingCart, User, CheckSquare } from 'lucide-react';
import { haptic } from '@/components/tabs/mobile/useSwipe';
import type { UserRole } from '@/lib/types';
import '@/components/tabs/mobile/MobileTabBar.css';

export type FieldTabId =
    | 'orders' | 'attendance' | 'purchases' | 'projects'   // kontrolor
    | 'home' | 'work' | 'tasks' | 'me';                    // radnik

export interface FieldTab {
    id: FieldTabId;
    label: string;
    Icon: typeof Home;
}

/** Redoslijed prati kontrolorov dan: šta se radi → ko radi → šta je stiglo → za koga. */
const CONTROLLER_TABS: FieldTab[] = [
    { id: 'orders', label: 'Nalozi', Icon: ClipboardList },
    { id: 'attendance', label: 'Šihtarica', Icon: CalendarCheck },
    { id: 'purchases', label: 'Narudžbe', Icon: ShoppingCart },
    { id: 'projects', label: 'Projekti', Icon: FolderOpen },
];

const WORKER_TABS: FieldTab[] = [
    { id: 'home', label: 'Danas', Icon: Home },
    { id: 'work', label: 'Moj posao', Icon: ClipboardList },
    { id: 'tasks', label: 'Zadaci', Icon: CheckSquare },
    { id: 'me', label: 'Ja', Icon: User },
];

export function tabsForRole(role: UserRole): FieldTab[] {
    return role === 'controller' ? CONTROLLER_TABS : WORKER_TABS;
}

interface Props {
    role: UserRole;
    activeTab: FieldTabId;
    onTabChange: (tab: FieldTabId) => void;
}

export default function FieldTabBar({ role, activeTab, onTabChange }: Props) {
    const tabs = tabsForRole(role);

    const handle = (id: FieldTabId) => {
        if (id === activeTab) {
            // Dodir aktivnog taba vraća na vrh — iOS navika kod dugih lista.
            document.querySelector('.fld-body')?.scrollTo({ top: 0, behavior: 'smooth' });
            haptic(5);
            return;
        }
        haptic(5);
        onTabChange(id);
    };

    return (
        <nav className="mtb" role="tablist" aria-label="Glavna navigacija">
            {tabs.map(t => {
                const on = activeTab === t.id;
                return (
                    <button
                        key={t.id}
                        type="button"
                        role="tab"
                        aria-selected={on}
                        className={`mtb-item${on ? ' on' : ''}`}
                        onClick={() => handle(t.id)}
                    >
                        <t.Icon size={25} strokeWidth={on ? 2.1 : 1.8} />
                        <span>{t.label}</span>
                    </button>
                );
            })}
        </nav>
    );
}
