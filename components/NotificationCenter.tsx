'use client';

// ════════════════════════════════════════════════════════════════════
// ZVONO OBAVIJESTI
//
// Dva izvora, oba svedena na minimum buke:
//   1. Prave obavijesti iz baze (subscribeToNotifications).
//   2. „Šta nedostaje" — šest provjera podataka (materijal bez cijene, montaža
//      bez radnika, dnevnica 0, šihtarica, procesi bez radnika, nedostajući
//      troškovi) svedene na JEDNU stavku. Klik otvara DataGapsModal s punim
//      pregledom; ranije je svaka od tih šest bila zasebna obavijest i gušila
//      zvono.
// ════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Bell, Check, Info, AlertTriangle, CheckCircle, AlertOctagon, ChevronRight, Users } from 'lucide-react';
import { Notification } from '@/lib/types';
import {
    subscribeToNotifications, markNotificationAsRead,
    checkZeroMaterialCostProducts, checkUnassignedMontazaItems, checkZeroRateAssignedWorkers,
    checkProcessesWithoutWorkers, checkMissingCostFields, checkMissingAttendanceForActiveOrders,
} from '@/lib/services';
import { buildDataGaps, type DataGap } from '@/lib/insights/dataGaps';
import { useApproverRequests } from '@/lib/useApproverRequests';
import { useAuth } from '@/context/AuthContext';
import DataGapsModal from '@/components/ui/DataGapsModal';
import ChangeRequestsModal from '@/components/ui/ChangeRequestsModal';
import './NotificationCenter.css';

interface LocalNotification {
    id: string;
    title: string;
    message: string;
    type: 'info' | 'success' | 'warning' | 'error' | 'data-gaps' | 'proposals';
    read: boolean;
    createdAt: string;
    link?: string;
    targetTab?: string;
}

const NOTIFICATIONS_KEY = 'erp_notifications_read';
const getTodayString = () => new Date().toISOString().split('T')[0];

/** Prava (baza) obavijest — jedina koja se piše u markNotificationAsRead. */
const isDbNotification = (id: string) => !id.startsWith('data-gaps-') && !id.startsWith('demo-');

export default function NotificationCenter() {
    const { organization, isStaff } = useAuth();
    const [dbNotifications, setDbNotifications] = useState<LocalNotification[]>([]);
    const [dataGaps, setDataGaps] = useState<DataGap[]>([]);
    const [gapsSummaryRead, setGapsSummaryRead] = useState(false);
    const [gapsModalOpen, setGapsModalOpen] = useState(false);
    const [proposalsModalOpen, setProposalsModalOpen] = useState(false);
    const [isOpen, setIsOpen] = useState(false);

    // Prijedlozi radnika — samo vlasnik/staff ih odobrava s desktopa.
    const { requests: proposals, reload: reloadProposals } = useApproverRequests(!!organization?.Organization_ID && !!isStaff);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const [position, setPosition] = useState({ top: 0, left: 0 });

    const getReadNotifications = useCallback((): Set<string> => {
        try {
            const stored = localStorage.getItem(NOTIFICATIONS_KEY);
            return stored ? new Set(JSON.parse(stored)) : new Set();
        } catch {
            return new Set();
        }
    }, []);

    const saveReadNotifications = useCallback((readIds: Set<string>) => {
        try {
            localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(Array.from(readIds)));
        } catch {
            console.error('Spremanje pročitanih obavijesti nije uspjelo.');
        }
    }, []);

    // ── Prave obavijesti iz baze ─────────────────────────────────────
    useEffect(() => {
        if (!organization?.Organization_ID) return;
        const unsubscribe = subscribeToNotifications(organization.Organization_ID, (dbList) => {
            const readIds = getReadNotifications();
            setDbNotifications(dbList.map((n: Notification) => ({
                id: n.id,
                title: n.title,
                message: n.message,
                type: (['success', 'warning', 'error'].includes(n.type) ? n.type : 'info') as LocalNotification['type'],
                read: readIds.has(n.id),
                createdAt: n.createdAt,
                link: n.link,
                targetTab: n.targetTab,
            })));
        });
        return () => unsubscribe();
    }, [organization?.Organization_ID, getReadNotifications]);

    // ── „Šta nedostaje" — šest provjera, jedan rezultat ──────────────
    // Odgođeno da ne blokira prvo crtanje; provjere idu paralelno.
    useEffect(() => {
        const orgId = organization?.Organization_ID;
        if (!orgId) return;

        let cancelled = false;
        const timer = setTimeout(async () => {
            try {
                const [zeroMaterialCost, montaza, attendance, zeroRate, processesWithoutWorkers, missingCostFields] =
                    await Promise.all([
                        checkZeroMaterialCostProducts(orgId, 2),
                        checkUnassignedMontazaItems(orgId),
                        checkMissingAttendanceForActiveOrders(orgId),
                        checkZeroRateAssignedWorkers(orgId),
                        checkProcessesWithoutWorkers(orgId),
                        checkMissingCostFields(orgId),
                    ]);
                if (cancelled) return;
                const gaps = buildDataGaps({
                    today: getTodayString(),
                    zeroMaterialCost, montaza, attendance, zeroRate, processesWithoutWorkers, missingCostFields,
                });
                setDataGaps(gaps);
                setGapsSummaryRead(false);
            } catch (e) {
                console.error('Provjere nedostataka nisu uspjele:', e);
            }
        }, 1200);

        return () => { cancelled = true; clearTimeout(timer); };
    }, [organization?.Organization_ID]);

    // ── Spisak za prikaz: sažetak nedostataka (ako ih ima) + baza ────
    const notifications = useMemo<LocalNotification[]>(() => {
        const list: LocalNotification[] = [...dbNotifications];
        if (dataGaps.length > 0) {
            list.unshift({
                id: `data-gaps-${getTodayString()}`,
                title: 'Nedostaje podataka',
                message: `${dataGaps.length} ${dataGaps.length === 1 ? 'stavka' : 'stavki'} treba dopuniti — otvori za pregled.`,
                type: 'data-gaps',
                read: gapsSummaryRead,
                createdAt: new Date().toISOString(),
            });
        }
        if (proposals.length > 0) {
            // Prijedlozi su akcijski — uvijek na vrhu, uvijek „nepročitani" dok ih ima.
            list.unshift({
                id: `proposals-${getTodayString()}`,
                title: 'Prijedlozi radnika',
                message: `${proposals.length} ${proposals.length === 1 ? 'prijedlog čeka' : 'prijedloga čeka'} tvoju potvrdu.`,
                type: 'proposals',
                read: false,
                createdAt: new Date().toISOString(),
            });
        }
        return list.sort((a, b) => {
            if (a.read !== b.read) return a.read ? 1 : -1;
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });
    }, [dbNotifications, dataGaps, gapsSummaryRead, proposals]);

    const unreadCount = notifications.filter(n => !n.read).length;

    // ── Pozicioniranje dropdowna ─────────────────────────────────────
    const updatePosition = () => {
        if (buttonRef.current && isOpen) {
            const rect = buttonRef.current.getBoundingClientRect();
            setPosition({ top: rect.top, left: rect.right + 12 });
        }
    };

    useEffect(() => {
        if (isOpen) {
            updatePosition();
            window.addEventListener('resize', updatePosition);
            window.addEventListener('scroll', updatePosition, true);
        }
        return () => {
            window.removeEventListener('resize', updatePosition);
            window.removeEventListener('scroll', updatePosition, true);
        };
    }, [isOpen]);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            const target = event.target as Node;
            const portalElement = document.getElementById('notification-portal-container');
            if (portalElement && portalElement.contains(target)) return;
            if (buttonRef.current && buttonRef.current.contains(target)) return;
            setIsOpen(false);
        }
        if (isOpen) document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    // ── Označavanje pročitanim ───────────────────────────────────────
    const markRead = useCallback((n: LocalNotification) => {
        if (n.type === 'data-gaps') { setGapsSummaryRead(true); return; }
        if (n.type === 'proposals') return;   // ostaje dok ima prijedloga na čekanju
        setDbNotifications(prev => prev.map(x => x.id === n.id ? { ...x, read: true } : x));
        const readIds = getReadNotifications();
        readIds.add(n.id);
        saveReadNotifications(readIds);
        if (isDbNotification(n.id)) markNotificationAsRead(n.id);
    }, [getReadNotifications, saveReadNotifications]);

    const handleMarkAsRead = (e: React.MouseEvent, n: LocalNotification) => {
        e.stopPropagation();
        markRead(n);
    };

    const handleMarkAllRead = async () => {
        const unread = notifications.filter(n => !n.read);
        setGapsSummaryRead(true);
        setDbNotifications(prev => prev.map(x => ({ ...x, read: true })));
        const readIds = getReadNotifications();
        for (const n of unread) {
            if (n.type === 'data-gaps' || n.type === 'proposals') continue;
            readIds.add(n.id);
            if (isDbNotification(n.id)) await markNotificationAsRead(n.id);
        }
        saveReadNotifications(readIds);
    };

    const handleNotificationClick = (n: LocalNotification) => {
        if (n.type === 'data-gaps') {
            setIsOpen(false);
            setGapsModalOpen(true);
            return;
        }
        if (n.type === 'proposals') {
            setIsOpen(false);
            setProposalsModalOpen(true);
            return;
        }
        if (!n.read) markRead(n);
        setIsOpen(false);
        if (n.targetTab) {
            window.dispatchEvent(new CustomEvent('switchTab', { detail: { tab: n.targetTab } }));
        } else if (n.link && n.link !== '#') {
            window.location.href = n.link;
        }
    };

    const getIcon = (type: LocalNotification['type']) => {
        switch (type) {
            case 'success': return <CheckCircle size={18} className="text-green-500" />;
            case 'warning': return <AlertTriangle size={18} className="text-orange-500" />;
            case 'error': return <AlertOctagon size={18} className="text-red-500" />;
            case 'data-gaps': return <AlertTriangle size={18} className="text-orange-500" />;
            case 'proposals': return <Users size={18} className="text-blue-500" />;
            default: return <Info size={18} className="text-blue-500" />;
        }
    };

    const dropdown = isOpen ? (
        <div
            id="notification-portal-container"
            style={{ position: 'fixed', top: position.top, left: position.left, zIndex: 9999 }}
        >
            <div className="notification-dropdown">
                <div className="notification-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <h3>Obavijesti</h3>
                        {unreadCount > 0 && <span className="count">{unreadCount}</span>}
                    </div>
                    {unreadCount > 0 && (
                        <button
                            onClick={handleMarkAllRead}
                            style={{
                                background: 'none', border: 'none', color: '#0071e3', fontSize: '11px',
                                fontWeight: 600, cursor: 'pointer', padding: '4px 8px', borderRadius: '6px',
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.background = '#f1f5f9'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                        >
                            Označi sve pročitanim
                        </button>
                    )}
                </div>

                <div className="notification-list">
                    {notifications.length === 0 ? (
                        <div className="empty-state">
                            <Bell size={48} strokeWidth={1} style={{ opacity: 0.2 }} />
                            <p>Nemate novih obavijesti</p>
                        </div>
                    ) : (
                        notifications.map((n) => (
                            <div
                                key={n.id}
                                className={`notification-item ${n.type} ${!n.read ? 'unread' : 'read'}`}
                                onClick={() => handleNotificationClick(n)}
                            >
                                <div className="n-icon">{getIcon(n.type)}</div>
                                <div className="n-content">
                                    <h4 className="n-title">{n.title}</h4>
                                    <p className="n-message">{n.message}</p>
                                    <span className="n-time">{formatTimeAgo(n.createdAt)}</span>
                                </div>
                                <div className="n-actions">
                                    {!n.read && (
                                        <button
                                            className="n-action n-mark-read"
                                            onClick={(e) => handleMarkAsRead(e, n)}
                                            title="Označi kao pročitano"
                                        >
                                            <Check size={12} strokeWidth={3} />
                                        </button>
                                    )}
                                    {(n.targetTab || n.link || n.type === 'data-gaps' || n.type === 'proposals') && (
                                        <span className="n-open-hint"><ChevronRight size={14} /></span>
                                    )}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    ) : null;

    return (
        <div className="notification-center">
            <button
                ref={buttonRef}
                className={`notification-btn ${isOpen ? 'active' : ''}`}
                onClick={() => setIsOpen(!isOpen)}
                title="Obavijesti"
            >
                <div className="icon-wrapper">
                    <Bell size={20} strokeWidth={2} />
                    {unreadCount > 0 && (
                        <span className="badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
                    )}
                </div>
            </button>

            {typeof document !== 'undefined' && createPortal(dropdown, document.body)}

            {gapsModalOpen && organization?.Organization_ID && (
                <DataGapsModal
                    gaps={dataGaps}
                    organizationId={organization.Organization_ID}
                    onClose={() => setGapsModalOpen(false)}
                    onNavigate={() => setGapsModalOpen(false)}
                    onResolved={(gapId) => setDataGaps(prev => prev.filter(g => g.id !== gapId))}
                />
            )}

            {proposalsModalOpen && organization?.Organization_ID && (
                <ChangeRequestsModal
                    organizationId={organization.Organization_ID}
                    onClose={() => setProposalsModalOpen(false)}
                    onChanged={reloadProposals}
                />
            )}
        </div>
    );
}

function formatTimeAgo(dateString: string) {
    const date = new Date(dateString);
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
    if (diffInSeconds < 60) return 'upravo';
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)} min`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)} h`;
    return date.toLocaleDateString('hr-HR');
}
