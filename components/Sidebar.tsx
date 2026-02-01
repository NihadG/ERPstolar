import React from 'react';
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
    CheckSquare
} from 'lucide-react';
import './Sidebar.css';

interface SidebarProps {
    activeTab: string;
    onTabChange: (tab: string) => void;
    isOpen: boolean;
    onClose: () => void;
    isCollapsed: boolean;
    onToggleCollapse: () => void;
    onOpenSearch: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ activeTab, onTabChange, isOpen, onClose, isCollapsed, onToggleCollapse, onOpenSearch }) => {
    const router = useRouter();
    const { user, organization, hasModule, signOut } = useAuth();
    const [isManagementExpanded, setIsManagementExpanded] = React.useState(false);

    const getUserInitials = () => {
        if (!user?.Name) return '?';
        return user.Name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    };

    const navColors: Record<string, string> = {
        projects: '#007AFF', // Blue
        overview: '#AF52DE', // Purple
        offers: '#FF9500',   // Orange
        orders: '#34C759',   // Green
        production: '#FF2D55', // Pink/Red
        materials: '#5856D6', // Indigo
        workers: '#00C7BE',   // Teal
        suppliers: '#FFCC00', // Yellow
        attendance: '#FF3B30', // Red
        tasks: '#1D3557', // Deep Blue
    };

    const NavItem = ({ id, icon: Icon, label, locked = false }: { id: string, icon: any, label: string, locked?: boolean }) => {
        const isActive = activeTab === id;
        const color = navColors[id] || '#8E8E93';

        return (
            <button
                className={`nav-item ${isActive ? 'active' : ''}`}
                onClick={() => {
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
                } as React.CSSProperties}
            >
                <div className="nav-icon-wrapper">
                    <Icon strokeWidth={isActive ? 2.5 : 2} size={20} />
                </div>
                {!isCollapsed && <span className="nav-label">{label}</span>}
                {!isCollapsed && locked && <Lock size={14} className="tab-lock" />}
            </button>
        );
    };

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
                            <Grid size={24} color="white" />
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
                    <button
                        className="nav-item search-btn"
                        onClick={() => {
                            onOpenSearch();
                            if (window.innerWidth <= 768) onClose();
                        }}
                        title={isCollapsed ? "Pretraga (Ctrl+K)" : undefined}
                    >
                        <div className="nav-icon-wrapper">
                            <Search size={20} />
                        </div>
                        {!isCollapsed && (
                            <div className="nav-label-group">
                                <span className="nav-label">Pretraga</span>
                                <span className="nav-shortcut">Ctrl+K</span>
                            </div>
                        )}
                    </button>

                    <div className="nav-divider"></div>

                    <NavItem id="projects" icon={FolderOpen} label="Projekti" />
                    <NavItem id="overview" icon={LayoutDashboard} label="Pregled" />
                    <NavItem
                        id="offers"
                        icon={FileText}
                        label="Ponude"
                        locked={!hasModule('offers')}
                    />
                    <NavItem
                        id="orders"
                        icon={ShoppingCart}
                        label="Narudžbe"
                        locked={!hasModule('orders')}
                    />
                    <NavItem id="production" icon={HardHat} label="Proizvodnja" />
                    <NavItem id="attendance" icon={Calendar} label="Šihtarica" />
                    <NavItem id="tasks" icon={CheckSquare} label="Zadaci" />

                    <div className="nav-divider"></div>

                    {!isCollapsed ? (
                        <button
                            className="nav-section-label clickable"
                            onClick={() => setIsManagementExpanded(!isManagementExpanded)}
                            title={isManagementExpanded ? "Sklopi" : "Proširi"}
                        >
                            <span>Upravljanje</span>
                            <ChevronDown
                                size={14}
                                style={{
                                    transform: isManagementExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                                    transition: 'transform 0.2s'
                                }}
                            />
                        </button>
                    ) : (
                        <div className="nav-divider"></div>
                    )}

                    {(isManagementExpanded || isCollapsed) && (
                        <>
                            <NavItem id="materials" icon={Package2} label="Materijali" />
                            <NavItem id="workers" icon={Users} label="Radnici" />
                            <NavItem id="suppliers" icon={Store} label="Dobavljači" />
                        </>
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
