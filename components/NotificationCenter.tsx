'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Bell, Check, Info, AlertTriangle, CheckCircle, AlertOctagon, ClipboardList, Calendar, FileText, ShoppingCart, ChevronRight } from 'lucide-react';
import { Notification } from '@/lib/types';
import { subscribeToNotifications, markNotificationAsRead } from '@/lib/database';
import { useAuth } from '@/context/AuthContext';
import { useData } from '@/context/DataContext';
import './NotificationCenter.css';

// Local notification type for internal use
interface LocalNotification {
    id: string;
    title: string;
    message: string;
    type: 'info' | 'success' | 'warning' | 'error' | 'sihtarica' | 'tasks' | 'offers' | 'orders';
    read: boolean;
    createdAt: string;
    link?: string;
    targetTab?: string; // Tab to switch to when clicked
    metadata?: {
        taskCount?: number;
        date?: string;
        count?: number;
    };
}

const NOTIFICATIONS_KEY = 'erp_notifications_read';
const LAST_SIHTARICA_KEY = 'erp_last_sihtarica_check';
const LAST_TASKS_KEY = 'erp_last_tasks_check';
const LAST_UNSENT_OFFERS_KEY = 'erp_last_unsent_offers_check';
const LAST_UNSENT_ORDERS_KEY = 'erp_last_unsent_orders_check';

// Days between unsent reminders
const REMINDER_INTERVAL_DAYS = 3;

function daysBetween(dateStr: string, today: string): number {
    const d1 = new Date(dateStr);
    const d2 = new Date(today);
    return Math.floor((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
}

export default function NotificationCenter() {
    const { organization } = useAuth();
    const { appState } = useData();
    const [notifications, setNotifications] = useState<LocalNotification[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const [position, setPosition] = useState({ top: 0, left: 0 });

    // Get today's date string
    const getTodayString = () => new Date().toISOString().split('T')[0];

    // Get read notifications from localStorage
    const getReadNotifications = useCallback((): Set<string> => {
        try {
            const stored = localStorage.getItem(NOTIFICATIONS_KEY);
            return stored ? new Set(JSON.parse(stored)) : new Set();
        } catch {
            return new Set();
        }
    }, []);

    // Save read notifications to localStorage
    const saveReadNotifications = useCallback((readIds: Set<string>) => {
        try {
            localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(Array.from(readIds)));
        } catch {
            console.error('Failed to save read notifications');
        }
    }, []);

    // Count unsent offers and orders from appState
    const unsentOffers = useMemo(() =>
        (appState.offers || []).filter(o => o.Status === 'Nacrt'),
        [appState.offers]
    );

    const unsentOrders = useMemo(() =>
        (appState.orders || []).filter(o => o.Status === 'Nacrt'),
        [appState.orders]
    );

    // Generate daily notifications
    const generateDailyNotifications = useCallback(() => {
        const today = getTodayString();
        const dailyNotifications: LocalNotification[] = [];
        const readIds = getReadNotifications();

        // ── Sihtarica reminder (daily) ──
        const lastSihtaricaCheck = localStorage.getItem(LAST_SIHTARICA_KEY);
        if (lastSihtaricaCheck !== today) {
            const sihtaricaId = `sihtarica-${today}`;
            dailyNotifications.push({
                id: sihtaricaId,
                title: 'Sihtarica',
                message: 'Ne zaboravi popuniti dnevnu sihtaricu za danas!',
                type: 'sihtarica',
                read: readIds.has(sihtaricaId),
                createdAt: new Date().toISOString(),
                targetTab: 'attendance'
            });
            localStorage.setItem(LAST_SIHTARICA_KEY, today);
        }

        // ── Tasks reminder (daily) ──
        const lastTasksCheck = localStorage.getItem(LAST_TASKS_KEY);
        if (lastTasksCheck !== today) {
            const tasksId = `tasks-${today}`;
            dailyNotifications.push({
                id: tasksId,
                title: 'Današnji zadaci',
                message: 'Provjeri svoje zadatke za danas',
                type: 'tasks',
                read: readIds.has(tasksId),
                createdAt: new Date().toISOString(),
                targetTab: 'tasks',
                metadata: { date: today }
            });
            localStorage.setItem(LAST_TASKS_KEY, today);
        }

        // ── Unsent offers reminder (every 3 days) ──
        if (unsentOffers.length > 0) {
            const lastOffersCheck = localStorage.getItem(LAST_UNSENT_OFFERS_KEY);
            const shouldRemind = !lastOffersCheck || daysBetween(lastOffersCheck, today) >= REMINDER_INTERVAL_DAYS;

            if (shouldRemind) {
                const offersId = `unsent-offers-${today}`;
                dailyNotifications.push({
                    id: offersId,
                    title: 'Neposlane ponude',
                    message: `Imate ${unsentOffers.length} ponud${unsentOffers.length === 1 ? 'u' : 'a'} u statusu "Nacrt" koje nisu poslane.`,
                    type: 'offers',
                    read: readIds.has(offersId),
                    createdAt: new Date().toISOString(),
                    targetTab: 'offers',
                    metadata: { count: unsentOffers.length }
                });
                localStorage.setItem(LAST_UNSENT_OFFERS_KEY, today);
            }
        }

        // ── Unsent orders reminder (every 3 days) ──
        if (unsentOrders.length > 0) {
            const lastOrdersCheck = localStorage.getItem(LAST_UNSENT_ORDERS_KEY);
            const shouldRemind = !lastOrdersCheck || daysBetween(lastOrdersCheck, today) >= REMINDER_INTERVAL_DAYS;

            if (shouldRemind) {
                const ordersId = `unsent-orders-${today}`;
                dailyNotifications.push({
                    id: ordersId,
                    title: 'Neposlane narudžbe',
                    message: `Imate ${unsentOrders.length} narudžb${unsentOrders.length === 1 ? 'u' : 'e'} u statusu "Nacrt" koje nisu poslane.`,
                    type: 'orders',
                    read: readIds.has(ordersId),
                    createdAt: new Date().toISOString(),
                    targetTab: 'orders',
                    metadata: { count: unsentOrders.length }
                });
                localStorage.setItem(LAST_UNSENT_ORDERS_KEY, today);
            }
        }

        return dailyNotifications;
    }, [getReadNotifications, unsentOffers, unsentOrders]);

    // Subscribe to notifications and generate daily ones
    useEffect(() => {
        if (!organization?.Organization_ID) return;

        const dailyNotifications = generateDailyNotifications();

        const unsubscribe = subscribeToNotifications(organization.Organization_ID, (dbNotifications) => {
            const readIds = getReadNotifications();

            // Convert DB notifications to local format
            const convertedDbNotifications = dbNotifications.map((n: Notification) => ({
                ...n,
                type: n.type as LocalNotification['type'],
                read: readIds.has(n.id)
            }));

            // Combine daily + DB notifications, sort: unread first, then by date
            const all = [...dailyNotifications, ...convertedDbNotifications];
            all.sort((a, b) => {
                if (a.read !== b.read) return a.read ? 1 : -1;
                return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
            });
            setNotifications(all);
        });

        // If subscription returns empty, just use daily
        if (dailyNotifications.length > 0) {
            const sorted = [...dailyNotifications].sort((a, b) => {
                if (a.read !== b.read) return a.read ? 1 : -1;
                return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
            });
            setNotifications(sorted);
        }

        return () => unsubscribe();
    }, [organization?.Organization_ID, generateDailyNotifications, getReadNotifications]);

    // Update position logic
    const updatePosition = () => {
        if (buttonRef.current && isOpen) {
            const rect = buttonRef.current.getBoundingClientRect();
            setPosition({
                top: rect.top,
                left: rect.right + 12
            });
        }
    };

    // Listeners for position updates
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

    // Close on click outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            const target = event.target as Node;
            const portalElement = document.getElementById('notification-portal-container');

            if (portalElement && portalElement.contains(target)) return;
            if (buttonRef.current && buttonRef.current.contains(target)) return;

            setIsOpen(false);
        }

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    const handleMarkAsRead = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();

        // Update local state
        setNotifications((prev: LocalNotification[]) => prev.map((n: LocalNotification) => n.id === id ? { ...n, read: true } : n));

        // Persist to localStorage
        const readIds = getReadNotifications();
        readIds.add(id);
        saveReadNotifications(readIds);

        // If it's a DB notification, also update in database
        if (!id.startsWith('sihtarica-') && !id.startsWith('tasks-') && !id.startsWith('unsent-offers-') && !id.startsWith('unsent-orders-') && !id.startsWith('demo-')) {
            await markNotificationAsRead(id);
        }
    };

    const handleMarkAllRead = async () => {
        const unread = notifications.filter((n: LocalNotification) => !n.read);

        // Update local state
        setNotifications((prev: LocalNotification[]) => prev.map((n: LocalNotification) => ({ ...n, read: true })));

        // Persist all to localStorage
        const readIds = getReadNotifications();
        unread.forEach((n: LocalNotification) => readIds.add(n.id));
        saveReadNotifications(readIds);

        // Update DB notifications
        for (const n of unread) {
            if (!n.id.startsWith('sihtarica-') && !n.id.startsWith('tasks-') && !n.id.startsWith('unsent-offers-') && !n.id.startsWith('unsent-orders-') && !n.id.startsWith('demo-')) {
                await markNotificationAsRead(n.id);
            }
        }
    };

    const handleNotificationClick = async (n: LocalNotification) => {
        // Mark as read
        if (!n.read) {
            setNotifications((prev: LocalNotification[]) => prev.map((item: LocalNotification) => item.id === n.id ? { ...item, read: true } : item));
            const readIds = getReadNotifications();
            readIds.add(n.id);
            saveReadNotifications(readIds);

            if (!n.id.startsWith('sihtarica-') && !n.id.startsWith('tasks-') && !n.id.startsWith('unsent-offers-') && !n.id.startsWith('unsent-orders-') && !n.id.startsWith('demo-')) {
                await markNotificationAsRead(n.id);
            }
        }

        // Navigate based on targetTab or link
        setIsOpen(false);

        if (n.targetTab) {
            // Use the global switchTab event to change tabs
            window.dispatchEvent(new CustomEvent('switchTab', { detail: { tab: n.targetTab } }));
        } else if (n.link && n.link !== '#') {
            // For external links, use router (import not needed, window.location works)
            window.location.href = n.link;
        }
    };

    const unreadCount = notifications.filter((n: LocalNotification) => !n.read).length;

    const getIcon = (type: string) => {
        switch (type) {
            case 'success': return <CheckCircle size={18} className="text-green-500" />;
            case 'warning': return <AlertTriangle size={18} className="text-orange-500" />;
            case 'error': return <AlertOctagon size={18} className="text-red-500" />;
            case 'sihtarica': return <ClipboardList size={18} className="text-blue-500" />;
            case 'tasks': return <Calendar size={18} className="text-purple-500" />;
            case 'offers': return <FileText size={18} className="text-amber-500" />;
            case 'orders': return <ShoppingCart size={18} className="text-teal-500" />;
            default: return <Info size={18} className="text-blue-500" />;
        }
    };

    const dropdown = isOpen ? (
        <div
            id="notification-portal-container"
            style={{
                position: 'fixed',
                top: position.top,
                left: position.left,
                zIndex: 9999
            }}
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
                                background: 'none',
                                border: 'none',
                                color: '#0071e3',
                                fontSize: '11px',
                                fontWeight: 600,
                                cursor: 'pointer',
                                padding: '4px 8px',
                                borderRadius: '6px',
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
                        notifications.map((n: LocalNotification) => (
                            <div
                                key={n.id}
                                className={`notification-item ${n.type} ${!n.read ? 'unread' : 'read'}`}
                                onClick={() => handleNotificationClick(n)}
                            >
                                <div className="n-icon">
                                    {getIcon(n.type)}
                                </div>
                                <div className="n-content">
                                    <h4 className="n-title">{n.title}</h4>
                                    <p className="n-message">{n.message}</p>
                                    <span className="n-time">
                                        {formatTimeAgo(n.createdAt)}
                                    </span>
                                </div>
                                <div className="n-actions">
                                    {!n.read && (
                                        <button
                                            className="n-action n-mark-read"
                                            onClick={(e) => handleMarkAsRead(e, n.id)}
                                            title="Označi kao pročitano"
                                        >
                                            <Check size={12} strokeWidth={3} />
                                        </button>
                                    )}
                                    {(n.targetTab || n.link) && (
                                        <span className="n-open-hint">
                                            <ChevronRight size={14} />
                                        </span>
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
