'use client';

// ════════════════════════════════════════════════════════════════════
// DONJA NAVIGACIJA (telefon)
//
// Zamjena za sidebar na telefonu: pet glavnih tokova nadohvat palca.
// Ostali tabovi (radnici, materijali, procesi, platno…) ostaju na desktopu.
// ════════════════════════════════════════════════════════════════════

import { useRef } from 'react';
import { FolderOpen, BadgeDollarSign, Factory, CheckSquare, User } from 'lucide-react';
import { haptic } from './useSwipe';
import './MobileTabBar.css';

export interface MobileSubTab {
    id: string;
    label: string;
}

export interface MobileTab {
    id: string;
    label: string;
    Icon: typeof FolderOpen;
    /** Grupa: dugme u traci vodi na jedan od podtabova (prvi je podrazumijevani). */
    subTabs?: MobileSubTab[];
}

/**
 * Pet dugmadi — šest i više se na telefonu od 375px pretvori u sitne natpise
 * i Zadaci su ispadali s trake. Zato su srodni ekrani spojeni u grupe s
 * podtabovima, s istim imenima kao grupe u desktop sidebaru:
 *
 *   Prodaja      → Narudžbe | Ponude
 *   Proizvodnja  → Nalozi | Šihtarica
 *
 * Prvi podtab je onaj koji se otvara na dodir. ID-jevi podtabova su ISTI
 * `activeTab` ID-jevi kao na desktopu, pa navigacija između ekrana (npr.
 * „Kreiraj nalog" iz ponude → 'production') radi bez prevođenja.
 */
export const MOBILE_TABS: MobileTab[] = [
    { id: 'projects', label: 'Projekti', Icon: FolderOpen },
    {
        id: 'sales', label: 'Prodaja', Icon: BadgeDollarSign,
        subTabs: [{ id: 'orders', label: 'Narudžbe' }, { id: 'offers', label: 'Ponude' }],
    },
    {
        id: 'make', label: 'Proizvodnja', Icon: Factory,
        subTabs: [{ id: 'production', label: 'Nalozi' }, { id: 'attendance', label: 'Šihtarica' }],
    },
    { id: 'tasks', label: 'Zadaci', Icon: CheckSquare },
    { id: 'account', label: 'Ja', Icon: User },
];

/** Redoslijed ekrana za vodoravno prevlačenje: podtabovi se prolaze redom. */
export const MOBILE_SCREEN_ORDER: string[] = MOBILE_TABS.flatMap(t => t.subTabs ? t.subTabs.map(s => s.id) : [t.id]);

/** Dugme trake kojem ekran pripada (null = ekran nije na telefonskoj traci). */
export function mobileTabOf(screenId: string): MobileTab | null {
    return MOBILE_TABS.find(t => t.id === screenId || t.subTabs?.some(s => s.id === screenId)) || null;
}

interface Props {
    activeTab: string;
    onTabChange: (tab: string) => void;
}

export default function MobileTabBar({ activeTab, onTabChange }: Props) {
    // Grupa pamti zadnji otvoreni podtab: povratak na „Proizvodnja" vraća na
    // Šihtaricu ako je tamo korisnik bio, a ne uvijek na Naloge.
    const lastSub = useRef<Record<string, string>>({});
    const current = mobileTabOf(activeTab);
    if (current?.subTabs) lastSub.current[current.id] = activeTab;

    /** Dodir aktivnog taba vraća na vrh liste — iOS navika kod dugih lista. */
    const handle = (tab: MobileTab) => {
        haptic(5);
        if (current?.id === tab.id) {
            window.scrollTo({ top: 0, behavior: 'smooth' });
            document.querySelector('.content-area')?.scrollTo({ top: 0, behavior: 'smooth' });
            return;
        }
        onTabChange(tab.subTabs ? (lastSub.current[tab.id] || tab.subTabs[0].id) : tab.id);
    };

    return (
        <nav className="mtb" role="tablist" aria-label="Glavna navigacija">
            {MOBILE_TABS.map(t => {
                const on = current?.id === t.id;
                return (
                    <button
                        key={t.id}
                        type="button"
                        role="tab"
                        aria-selected={on}
                        className={`mtb-item${on ? ' on' : ''}`}
                        onClick={() => handle(t)}
                    >
                        <t.Icon size={25} strokeWidth={on ? 2.1 : 1.8} />
                        <span>{t.label}</span>
                    </button>
                );
            })}
        </nav>
    );
}

/**
 * Podtabovi grupe (vrh ekrana): segmentna kontrola iznad sadržaja grupe.
 * Između podtabova se prelazi i vodoravnim prevlačenjem (page.tsx).
 */
export function MobileSubTabs({ activeTab, onTabChange }: Props) {
    const group = mobileTabOf(activeTab);
    if (!group?.subTabs) return null;
    return (
        <div className="mtb-sub">
            <div className="mtb-seg" role="tablist" aria-label={group.label}>
                {group.subTabs.map(s => {
                    const on = s.id === activeTab;
                    return (
                        <button
                            key={s.id}
                            type="button"
                            role="tab"
                            aria-selected={on}
                            className={on ? 'on' : ''}
                            onClick={() => { if (!on) { haptic(5); onTabChange(s.id); } }}
                        >
                            {s.label}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
