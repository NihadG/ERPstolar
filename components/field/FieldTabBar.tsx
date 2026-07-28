'use client';

// ════════════════════════════════════════════════════════════════════
// DONJA NAVIGACIJA POGONSKOG EKRANA
//
// Isti obrazac kao MobileTabBar (klase `.mtb`), ali s vlastitim tabovima po
// ulozi. Odvojena komponenta jer se skup tabova razlikuje i jer pogonski
// korisnik nikad ne vidi Ponude/Narudžbe.
//
// Osim početne, tabovi su za sada prazna stanja — vidi FieldShell.
// ════════════════════════════════════════════════════════════════════

import { CheckSquare, ClipboardCheck, ClipboardList, Home, User } from 'lucide-react';
import { haptic } from '@/components/tabs/mobile/useSwipe';
import type { UserRole } from '@/lib/types';
import '@/components/tabs/mobile/MobileTabBar.css';

export type FieldTabId = 'home' | 'work' | 'tasks' | 'checks' | 'me';

export interface FieldTab {
    id: FieldTabId;
    label: string;
    Icon: typeof Home;
}

const WORKER_TABS: FieldTab[] = [
    { id: 'home', label: 'Danas', Icon: Home },
    { id: 'work', label: 'Moj posao', Icon: ClipboardList },
    { id: 'tasks', label: 'Zadaci', Icon: CheckSquare },
    { id: 'me', label: 'Ja', Icon: User },
];

const CONTROLLER_TABS: FieldTab[] = [
    { id: 'home', label: 'Kontrola', Icon: ClipboardCheck },
    { id: 'work', label: 'Nalozi', Icon: ClipboardList },
    { id: 'checks', label: 'Nedostaci', Icon: CheckSquare },
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
