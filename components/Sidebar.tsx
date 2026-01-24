import React from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import './Sidebar.css';

interface SidebarProps {
    activeTab: string;
    onTabChange: (tab: string) => void;
    isOpen: boolean;
    onClose: () => void;
    isCollapsed: boolean;
    onToggleCollapse: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ activeTab, onTabChange, isOpen, onClose, isCollapsed, onToggleCollapse }) => {
    const router = useRouter();
    const { user, organization, hasModule, signOut } = useAuth();

    const handleLogout = async () => {
        await signOut();
        router.push('/login');
    };

    const getUserInitials = () => {
        if (!user?.Name) return '?';
        return user.Name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    };

    const NavItem = ({ id, icon, label, locked = false }: { id: string, icon: string, label: string, locked?: boolean }) => (
        <button
            className={`nav-item ${activeTab === id ? 'active' : ''}`}
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
        >
            <span className="material-icons-round">{icon}</span>
            {!isCollapsed && <span className="nav-label">{label}</span>}
            {!isCollapsed && locked && <span className="material-icons-round tab-lock">lock</span>}
        </button>
    );

    return (
        <>
            {/* Mobile Overlay */}
            <div
                className={`mobile-overlay ${isOpen ? 'open' : ''}`}
                onClick={onClose}
            />

            {/* Sidebar */}
            <aside className={`sidebar ${isOpen ? 'open' : ''} ${isCollapsed ? 'collapsed' : ''}`}>
                {/* Header */}
                <div className="sidebar-header">
                    <div className="logo-section">
                        <div className="logo-icon">
                            <span className="material-icons-round">grid_view</span>
                        </div>
                        {!isCollapsed && <span className="logo-text">Furniture Prod.</span>}
                    </div>
                    <button className="collapse-btn" onClick={onToggleCollapse} title={isCollapsed ? 'Proširi' : 'Smanji'}>
                        <span className="material-icons-round">{isCollapsed ? 'chevron_right' : 'chevron_left'}</span>
                    </button>
                    <button className="close-btn" onClick={onClose}>
                        <span className="material-icons-round">close</span>
                    </button>
                </div>

                {/* Navigation */}
                <nav className="sidebar-nav">
                    <NavItem id="projects" icon="folder" label="Projekti" />
                    <NavItem id="overview" icon="dashboard" label="Pregled" />
                    <NavItem
                        id="offers"
                        icon="description"
                        label="Ponude"
                        locked={!hasModule('offers')}
                    />
                    <NavItem
                        id="orders"
                        icon="local_shipping"
                        label="Narudžbe"
                        locked={!hasModule('orders')}
                    />
                    <NavItem id="production" icon="engineering" label="Proizvodnja" />

                    <div className="nav-divider"></div>

                    {!isCollapsed && <div className="nav-section-label">Upravljanje</div>}

                    <NavItem id="materials" icon="inventory_2" label="Materijali" />
                    <NavItem id="workers" icon="people" label="Radnici" />
                    <NavItem id="suppliers" icon="store" label="Dobavljači" />
                </nav>

                {/* User Profile */}
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
                                <span className="material-icons-round" style={{ color: '#94a3b8' }}>settings</span>
                            </>
                        )}
                    </div>
                </div>
            </aside>
        </>
    );
};

export default Sidebar;
