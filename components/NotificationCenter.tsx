'use client';

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Bell, Check, Info, AlertTriangle, CheckCircle, AlertOctagon } from 'lucide-react';
import { Notification } from '@/lib/types';
import { subscribeToNotifications, markNotificationAsRead } from '@/lib/database';
import { useAuth } from '@/context/AuthContext';
import './NotificationCenter.css';

export default function NotificationCenter() {
    const { organization } = useAuth();
    const router = useRouter();
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const [position, setPosition] = useState({ top: 0, left: 0 });

    // Subscribe to notifications
    useEffect(() => {
        if (!organization?.Organization_ID) return;

        const unsubscribe = subscribeToNotifications(organization.Organization_ID, (newNotifications) => {
            // DEMO PURPOSE: If no notifications, show a sample one so user can see design
            if (newNotifications.length === 0) {
                setNotifications([{
                    id: 'demo-1',
                    organizationId: organization.Organization_ID,
                    title: 'Dobrodošli u novi Notification Center',
                    message: 'Ovo je primjer obavijesti kako bi vidjeli novi dizajn. Obavijesti o narudžbama će se pojavljivati ovdje.',
                    type: 'success',
                    read: false,
                    createdAt: new Date().toISOString(),
                    link: '#'
                }]);
            } else {
                setNotifications(newNotifications);
            }
        });

        return () => unsubscribe();
    }, [organization?.Organization_ID]);

    // Update position logic
    const updatePosition = () => {
        if (buttonRef.current && isOpen) {
            const rect = buttonRef.current.getBoundingClientRect();
            setPosition({
                top: rect.top,
                left: rect.right + 12 // 12px gap
            });
        }
    };

    // Listeners for position updates
    useEffect(() => {
        if (isOpen) {
            updatePosition();
            window.addEventListener('resize', updatePosition);
            window.addEventListener('scroll', updatePosition, true); // Capture scroll
        }
        return () => {
            window.removeEventListener('resize', updatePosition);
            window.removeEventListener('scroll', updatePosition, true);
        };
    }, [isOpen]);

    // Close on click outside (modified for Portal)
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            // Check if click is inside portal container or button
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

        // Optimistic update
        setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));

        // Handle demo notification locally
        if (id.startsWith('demo-')) {
            return;
        }

        await markNotificationAsRead(id);
    };

    const handleMarkAllRead = async () => {
        const unread = notifications.filter(n => !n.read);

        // Optimistic update
        setNotifications(prev => prev.map(n => ({ ...n, read: true })));

        for (const n of unread) {
            if (n.id.startsWith('demo-')) continue;
            await markNotificationAsRead(n.id);
        }
    };

    const handleNotificationClick = async (n: Notification) => {
        if (!n.read) {
            if (n.id.startsWith('demo-')) {
                setNotifications(prev => prev.map(item => item.id === n.id ? { ...item, read: true } : item));
            } else {
                await markNotificationAsRead(n.id);
            }
        }
        if (n.link && n.link !== '#') {
            router.push(n.link);
            setIsOpen(false);
        }
    };

    const unreadCount = notifications.filter(n => !n.read).length;

    const getIcon = (type: string) => {
        switch (type) {
            case 'success': return <CheckCircle size={18} className="text-green-500" />;
            case 'warning': return <AlertTriangle size={18} className="text-orange-500" />;
            case 'error': return <AlertOctagon size={18} className="text-red-500" />;
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
                        notifications.map(n => (
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
