'use client';

// ════════════════════════════════════════════════════════════════════
// DONJA NAVIGACIJA (telefon)
//
// Zamjena za sidebar na telefonu: četiri glavna toka nadohvat palca.
// Ostali tabovi (radnici, materijali, šihtarica, planer…) ostaju na desktopu.
// ════════════════════════════════════════════════════════════════════

import { FolderOpen, FileText, ShoppingCart, ClipboardList, CalendarCheck, User } from 'lucide-react';
import { haptic } from './useSwipe';
import './MobileTabBar.css';

export interface MobileTab {
    id: string;
    label: string;
    Icon: typeof FolderOpen;
}

/**
 * Redoslijed prati tok posla: projekat → ponuda → narudžba → nalog; „Ja"
 * (nalog/odjava) na kraju.
 *
 * ŠIHTARICA je uz naloge jer je to jedina radnja koja se na telefonu obavlja
 * SVAKI dan. Na telefonu nema sidebara, pa bez svog mjesta u traci vlasnik do
 * nje uopšte ne može doći — ekran je postojao, ali je bio nedostupan.
 */
export const MOBILE_TABS: MobileTab[] = [
    { id: 'projects', label: 'Projekti', Icon: FolderOpen },
    { id: 'offers', label: 'Ponude', Icon: FileText },
    { id: 'orders', label: 'Narudžbe', Icon: ShoppingCart },
    { id: 'production', label: 'Nalozi', Icon: ClipboardList },
    { id: 'attendance', label: 'Šihtarica', Icon: CalendarCheck },
    { id: 'account', label: 'Ja', Icon: User },
];

interface Props {
    activeTab: string;
    onTabChange: (tab: string) => void;
}

export default function MobileTabBar({ activeTab, onTabChange }: Props) {
    /** Dodir aktivnog taba vraća na vrh liste — iOS navika kod dugih lista. */
    const handle = (id: string) => {
        if (id === activeTab) {
            window.scrollTo({ top: 0, behavior: 'smooth' });
            document.querySelector('.content-area')?.scrollTo({ top: 0, behavior: 'smooth' });
            haptic(5);
            return;
        }
        haptic(5);
        onTabChange(id);
    };

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
