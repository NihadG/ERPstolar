'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Bell, Check, Info, AlertTriangle, CheckCircle, AlertOctagon, ClipboardList, Calendar } from 'lucide-react';
import { Notification } from '@/lib/types';
import { subscribeToNotifications, markNotificationAsRead } from '@/lib/database';
import { useAuth } from '@/context/AuthContext';
import './NotificationCenter.css';

// Local notification type for internal use
interface LocalNotification {
    id: string;
    title: string;
    message: string;
    type: 'info' | 'success' | 'warning' | 'error' | 'sihtarica' | 'tasks';
    read: boolean;
    createdAt: string;
    link?: string;
    metadata?: {
        taskCount?: number;
        date?: string;
    };
}

const NOTIFICATIONS_KEY = 'erp_notifications_read';
const LAST_SIHTARICA_KEY = 'erp_last_sihtarica_check';
const LAST_TASKS_KEY = 'erp_last_tasks_check';

export default function NotificationCenter() {
    const { organization } = useAuth();
    const router = useRouter();
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

    // Generate daily notifications
    const generateDailyNotifications = useCallback(() => {
        const today = getTodayString();
        const dailyNotifications: LocalNotification[] = [];
        const readIds = getReadNotifications();

        // Check if sihtarica notification was shown today
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
                link: '/sihtarica'
            });
            localStorage.setItem(LAST_SIHTARICA_KEY, today);
        }

        // Check for tasks notification (simple reminder)
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
                link: '/',
                metadata: {
                    date: today
                }
            });
            localStorage.setItem(LAST_TASKS_KEY, today);
        }

        return dailyNotifications;
    }, [getReadNotifications]);

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

            // Combine daily + DB notifications
            setNotifications([...dailyNotifications, ...convertedDbNotifications]);
        });

        // If subscription returns empty, just use daily
        if (dailyNotifications.length > 0) {
            setNotifications(dailyNotifications);
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
        if (!id.startsWith('sihtarica-') && !id.startsWith('tasks-') && !id.startsWith('demo-')) {
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
            if (!n.id.startsWith('sihtarica-') && !n.id.startsWith('tasks-') && !n.id.startsWith('demo-')) {
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

            if (!n.id.startsWith('sihtarica-') && !n.id.startsWith('tasks-') && !n.id.startsWith('demo-')) {
                await markNotificationAsRead(n.id);
            }
        }

        // Navigate based on type
        setIsOpen(false);

        if (n.type === 'tasks') {
            // Navigate to home and open tasks tab
            router.push('/');
            setTimeout(() => {
                const event = new CustomEvent('openTasksTab', { detail: { view: 'today' } });
                window.dispatchEvent(event);
            }, 100);
        } else if (n.link && n.link !== '#') {
            router.push(n.link);
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
                                className={`notification-item ${n.type} ${!n.read ? 'unread' : ''}`}
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
                                {!n.read && (
                                    <button
                                        className="n-action"
                                        onClick={(e) => handleMarkAsRead(e, n.id)}
                                        title="Označi kao pročitano"
                                    >
                                        <Check size={12} strokeWidth={3} />
                                    </button>
                                )}
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
