import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import {
    LayoutDashboard,
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
    Calendar,
    CheckSquare,
    GanttChart,
    FileUp,
    Factory,
    Briefcase,
    BadgeDollarSign,
    Database,
    ClipboardList,
    Shield,
} from 'lucide-react';
import NotificationCenter from './NotificationCenter';
import './Sidebar.css';

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

// Helper to convert hex to rgb for css variables
const hexToRgb = (hex: string) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ?
        `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` :
        '142, 142, 147'; // System Gray
};

const Sidebar: React.FC<SidebarProps> = ({ activeTab, onTabChange, isOpen, onClose, isCollapsed, onToggleCollapse, onOpenSearch, onOpenImport }) => {
    const router = useRouter();
    const { user, hasModule } = useAuth();

    // Accordion state: string ID of the open group or null
    const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

    const toggleGroup = (groupId: string) => {
        setExpandedGroup(prev => (prev === groupId ? null : groupId));
    };

    const getUserInitials = () => {
        if (!user?.Name) return '?';
        return user.Name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    };

    // SwiftUI-like distinct colors (Apple HIG inspired)
    const navColors: Record<string, string> = {
        projects: '#007AFF', // System Blue
        overview: '#AF52DE', // System Purple
        offers: '#FF9500',   // System Orange
        orders: '#34C759',   // System Green
        production: '#FF2D55', // System Pink
        planer: '#5AC8FA',   // System Cyan
        materials: '#5856D6', // System Indigo
        workers: '#00C7BE',   // System Teal
        suppliers: '#FFCC00', // System Yellow
        attendance: '#FF3B30', // System Red
        tasks: '#8E8E93',     // System Gray (or Blue)
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
        const color = navColors[id] || '#8E8E93';
        const rgb = hexToRgb(color);

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
                style={{
                    '--item-color': color,
                    '--item-rgb': rgb,
                } as React.CSSProperties}
            >
                <div className="nav-icon-wrapper">
                    <Icon strokeWidth={isActive ? 2.5 : 2} size={19} />
                </div>
                {!isCollapsed && <span className="nav-label">{label}</span>}
                {!isCollapsed && locked && <Lock size={14} className="tab-lock" />}

                {/* Active Indicator for collapsed state or clean visual */}
                {isActive && !isCollapsed && (
                    <div className="active-indicator" />
                )}
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
                { id: 'overview', icon: LayoutDashboard, label: 'Pregled' },
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
                { id: 'planer', icon: GanttChart, label: 'Planer' },
                { id: 'attendance', icon: Calendar, label: 'Šihtarica' },
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
                            <Grid size={22} color="white" />
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
                                <Search size={19} />
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
                                                    <GroupIcon size={20} strokeWidth={isGroupActive ? 2.5 : 2} />
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
                                style={{
                                    '--item-color': '#FF3B30',
                                    '--item-rgb': '255, 59, 48',
                                } as React.CSSProperties}
                            >
                                <div className="nav-icon-wrapper">
                                    <Shield size={19} />
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
                                    <FileUp size={19} />
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
        </>
    );
};

export default Sidebar;
