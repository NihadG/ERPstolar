import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import {
    FolderOpen,
    FileText,
    ShoppingCart,
    HardHat,
    Package2,
    Users,
    Store,
    Search,
    ChevronLeft,
    ChevronRight,
    Settings,
    Grid,
    ChevronDown,
    Lock,
    CheckSquare,
    GanttChart,
    LayoutDashboard,
    FileUp,
    Factory,
    Briefcase,
    BadgeDollarSign,
    Database,
    ClipboardList,
    CalendarDays,
    Shield,
    Workflow,
    Scissors,
} from 'lucide-react';
import nextDynamic from 'next/dynamic';
import { createPortal } from 'react-dom';
import NotificationCenter from './NotificationCenter';
import './Sidebar.css';

// Krojna lista — brzi standalone kalkulator (unos komada → raspored rezanja →
// print), nevezan za projekat/proizvod. Lijeno se učitava (povlači optimizator)
// tek kad korisnik otvori alat, da ne opterećuje glavni bundle sidebara.
const FieldCutlist = nextDynamic(() => import('./field/cutlist/FieldCutlist'));

interface SidebarProps {
    activeTab: string;
    onTabChange: (tab: string) => void;
    isOpen: boolean;
    onClose: () => void;
    isCollapsed: boolean;
    onToggleCollapse: () => void;
    onOpenSearch: () => void;
    onOpenImport?: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ activeTab, onTabChange, isOpen, onClose, isCollapsed, onToggleCollapse, onOpenSearch, onOpenImport }) => {
    const router = useRouter();
    const { user, hasModule } = useAuth();

    // Accordion state: string ID of the open group or null
    const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

    // Krojna lista — overlay pokretača (brzi alat, bez projekta/proizvoda).
    const [cutlistOpen, setCutlistOpen] = useState(false);

    const toggleGroup = (groupId: string) => {
        setExpandedGroup(prev => (prev === groupId ? null : groupId));
    };

    const getUserInitials = () => {
        if (!user?.Name) return '?';
        return user.Name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    };

    const NavItem = ({
        id,
        icon: Icon,
        label,
        locked = false,
        isChild = false,
        isActiveOverride
    }: {
        id: string,
        icon: any,
        label: string,
        locked?: boolean,
        isChild?: boolean,
        isActiveOverride?: boolean
    }) => {
        const isActive = isActiveOverride !== undefined ? isActiveOverride : activeTab === id;

        return (
            <button
                className={`nav-item ${isActive ? 'active' : ''} ${isChild ? 'child-item' : ''}`}
                onClick={(e) => {
                    e.stopPropagation();
                    if (!locked) {
                        onTabChange(id);
                        if (window.innerWidth <= 768) {
                            onClose();
                        }
                    }
                }}
                disabled={locked}
                title={isCollapsed ? label : undefined}
            >
                <div className="nav-icon-wrapper">
                    <Icon strokeWidth={2} size={20} />
                </div>
                {!isCollapsed && <span className="nav-label">{label}</span>}
                {!isCollapsed && locked && <Lock size={14} className="tab-lock" />}
            </button>
        );
    };

    // Group definition
    const navGroups = [
        {
            id: 'organization',
            label: 'Organizacija',
            icon: Briefcase,
            items: [
                { id: 'projects', icon: FolderOpen, label: 'Projekti' },

                { id: 'tasks', icon: CheckSquare, label: 'Zadaci' },
            ]
        },
        {
            id: 'sales',
            label: 'Prodaja',
            icon: BadgeDollarSign,
            items: [
                { id: 'offers', icon: FileText, label: 'Ponude', locked: !hasModule('offers') },
                { id: 'orders', icon: ShoppingCart, label: 'Narudžbe', locked: !hasModule('orders') },
            ]
        },
        {
            id: 'production',
            label: 'Proizvodnja',
            icon: Factory,
            items: [
                { id: 'production', icon: ClipboardList, label: 'Nalozi' },
                { id: 'procesi', icon: Workflow, label: 'Procesi' },
                { id: 'attendance', icon: CalendarDays, label: 'Šihtarica' },
                { id: 'planer', icon: GanttChart, label: 'Planer' },
                { id: 'platno', icon: LayoutDashboard, label: 'Platno' },
            ]
        },
        {
            id: 'resources',
            label: 'Resursi',
            icon: Database,
            items: [
                { id: 'materials', icon: Package2, label: 'Materijali' },
                { id: 'workers', icon: Users, label: 'Radnici' },
                { id: 'suppliers', icon: Store, label: 'Dobavljači' },
            ]
        }
    ];

    return (
        <>
            <div
                className={`mobile-overlay ${isOpen ? 'open' : ''}`}
                onClick={onClose}
            />

            <aside className={`sidebar ${isOpen ? 'open' : ''} ${isCollapsed ? 'collapsed' : ''}`}>
                <div className="sidebar-header">
                    <div className="logo-section">
                        <div className="logo-icon">
                            <Grid size={17} color="white" />
                        </div>
                        {!isCollapsed && <span className="logo-text">Furniture Prod.</span>}
                    </div>

                    <div className="header-actions">
                        <button className="collapse-btn" onClick={onToggleCollapse} title={isCollapsed ? 'Proširi' : 'Smanji'}>
                            {isCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
                        </button>
                    </div>

                    <button className="close-btn" onClick={onClose}>
                        <span className="material-icons-round">close</span>
                    </button>
                </div>

                <nav className="sidebar-nav">
                    <div className="search-notifications-row">
                        <button
                            className="nav-item search-btn"
                            style={{ flex: 1, marginBottom: 0 }}
                            onClick={() => {
                                onOpenSearch();
                                if (window.innerWidth <= 768) onClose();
                            }}
                            title={isCollapsed ? "Pretraga (Ctrl+K)" : undefined}
                        >
                            <div className="nav-icon-wrapper">
                                <Search size={20} strokeWidth={2} />
                            </div>
                            {!isCollapsed && (
                                <div className="nav-label-group">
                                    <span className="nav-label">Pretraga</span>
                                    <span className="nav-shortcut">Ctrl+K</span>
                                </div>
                            )}
                        </button>

                        {!isCollapsed && <NotificationCenter />}
                    </div>

                    {isCollapsed && (
                        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '8px' }}>
                            <NotificationCenter />
                        </div>
                    )}

                    <div className="nav-divider"></div>

                    {/* Krojna lista — brzi alat (unos komada → raspored → print),
                        nevezan za projekat/proizvod. Otvara full-screen overlay. */}
                    <button
                        className="nav-item special-action"
                        onClick={() => {
                            setCutlistOpen(true);
                            if (window.innerWidth <= 768) onClose();
                        }}
                        title={isCollapsed ? 'Krojna lista' : undefined}
                    >
                        <div className="nav-icon-wrapper">
                            <Scissors size={20} strokeWidth={2} />
                        </div>
                        {!isCollapsed && <span className="nav-label">Krojna lista</span>}
                    </button>

                    <div className="nav-divider"></div>

                    {/* Render Groups */}
                    {navGroups.map((group, index) => {
                        const isExpanded = expandedGroup === group.id;
                        const GroupIcon = group.icon;
                        const isGroupActive = group.items.some(item => item.id === activeTab);

                        return (
                            <div key={group.id} className={`nav-group-wrapper ${isExpanded ? 'expanded' : ''} ${isGroupActive ? 'active-group' : ''}`}>
                                {!isCollapsed ? (
                                    <>
                                        <button
                                            className={`nav-group-header ${isExpanded ? 'active' : ''}`}
                                            onClick={() => toggleGroup(group.id)}
                                        >
                                            <div className="group-info">
                                                <div className={`nav-icon-wrapper group-icon ${isGroupActive && !isExpanded ? 'highlighted' : ''}`}>
                                                    <GroupIcon size={19} strokeWidth={2} />
                                                </div>
                                                <span className="group-label">{group.label}</span>
                                            </div>
                                            <ChevronDown
                                                size={15}
                                                className={`group-chevron ${isExpanded ? 'rotated' : ''}`}
                                            />
                                        </button>
                                        <div className={`group-content ${isExpanded ? 'expanded' : ''}`}>
                                            <div className="group-items-container">
                                                {group.items.map(item => (
                                                    <NavItem
                                                        key={item.id}
                                                        {...item}
                                                        isChild={true}
                                                    />
                                                ))}
                                            </div>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        {/* Collapsed state - Just show icons or a tooltip indicator */}
                                        <div className="collapsed-group-divider"></div>
                                        {group.items.map(item => (
                                            <NavItem key={item.id} {...item} />
                                        ))}
                                    </>
                                )}
                            </div>
                        );
                    })}

                    {/* Super Admin Panel - only visible to super admins */}
                    {user?.Is_Super_Admin && (
                        <div className="nav-group-wrapper">
                            <div className="nav-divider"></div>
                            <button
                                className="nav-item special-action admin-link"
                                onClick={() => {
                                    router.push('/admin');
                                    if (window.innerWidth <= 768) onClose();
                                }}
                                title={isCollapsed ? "Admin Panel" : undefined}
                            >
                                <div className="nav-icon-wrapper">
                                    <Shield size={20} strokeWidth={2} />
                                </div>
                                {!isCollapsed && <span className="nav-label">Admin Panel</span>}
                            </button>
                        </div>
                    )}

                    {/* Import button */}
                    {onOpenImport && (
                        <div className="nav-group-wrapper">
                            <div className="nav-divider"></div>
                            <button
                                className="nav-item special-action"
                                onClick={() => {
                                    onOpenImport();
                                    if (window.innerWidth <= 768) onClose();
                                }}
                                title={isCollapsed ? "Import podataka" : undefined}
                            >
                                <div className="nav-icon-wrapper">
                                    <FileUp size={20} strokeWidth={2} />
                                </div>
                                {!isCollapsed && <span className="nav-label">Import podataka</span>}
                            </button>
                        </div>
                    )}
                </nav>

                <div className="user-profile">
                    <div className="profile-card" onClick={() => router.push('/settings')} title={isCollapsed ? user?.Name : undefined}>
                        <div className="avatar">
                            {getUserInitials()}
                        </div>
                        {!isCollapsed && (
                            <>
                                <div className="user-info">
                                    <span className="user-name">{user?.Name}</span>
                                    <span className="user-email">{user?.Email}</span>
                                </div>
                                <Settings size={18} className="settings-icon" />
                            </>
                        )}
                    </div>
                </div>
            </aside>

            {/* Portal na <body> — overlay krojne liste je position:fixed i mora
                pokriti cijeli ekran (uklj. sidebar), van njegovog stacking konteksta. */}
            {cutlistOpen && typeof document !== 'undefined' && createPortal(
                <FieldCutlist onClose={() => setCutlistOpen(false)} />,
                document.body,
            )}
        </>
    );
};

export default Sidebar;
