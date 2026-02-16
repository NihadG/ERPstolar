'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Bell, Check, Info, AlertTriangle, CheckCircle, AlertOctagon, ClipboardList, Calendar, FileText, ShoppingCart, ChevronRight, Package, DollarSign, Users, UserX, Wrench } from 'lucide-react';
import { Notification } from '@/lib/types';
import { subscribeToNotifications, markNotificationAsRead, checkZeroMaterialCostProducts, setManualMaterialCost, checkUnassignedMontazaItems, checkZeroRateAssignedWorkers, checkProcessesWithoutWorkers, checkMissingCostFields } from '@/lib/database';
import { checkMissingAttendanceForActiveOrders } from '@/lib/attendance';
import { useAuth } from '@/context/AuthContext';
import { useData } from '@/context/DataContext';
import './NotificationCenter.css';

// Local notification type for internal use
interface LocalNotification {
    id: string;
    title: string;
    message: string;
    type: 'info' | 'success' | 'warning' | 'error' | 'sihtarica' | 'tasks' | 'offers' | 'orders' | 'material-warning' | 'worker-missing' | 'attendance-gap' | 'zero-rate' | 'process-unassigned' | 'costs-missing';
    read: boolean;
    createdAt: string;
    link?: string;
    targetTab?: string; // Tab to switch to when clicked
    metadata?: {
        taskCount?: number;
        date?: string;
        count?: number;
        // Material warning specific
        workOrderItemId?: string;
        productId?: string;
        productName?: string;
        projectName?: string;
        workOrderNumber?: string;
        hasMaterials?: boolean;
        materialCount?: number;
        // Data gap notification metadata
        workerId?: string;
        workerName?: string;
        workerItems?: string[];
        processName?: string;
        workOrderId?: string;
        missingFields?: string[];
    };
}

const NOTIFICATIONS_KEY = 'erp_notifications_read';
const LAST_SIHTARICA_KEY = 'erp_last_sihtarica_check';
const LAST_TASKS_KEY = 'erp_last_tasks_check';
const LAST_UNSENT_OFFERS_KEY = 'erp_last_unsent_offers_check';
const LAST_UNSENT_ORDERS_KEY = 'erp_last_unsent_orders_check';
const LAST_MATERIAL_CHECK_KEY = 'erp_last_material_cost_check';
const LAST_DATA_GAP_CHECK_KEY = 'erp_last_data_gap_check';

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

    // State for inline cost entry
    const [costEntryId, setCostEntryId] = useState<string | null>(null); // notification ID being edited
    const [costValue, setCostValue] = useState('');
    const [costSaving, setCostSaving] = useState(false);
    const [costSaved, setCostSaved] = useState<Set<string>>(new Set()); // IDs that were saved

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

    // ── S1: Check for zero material cost products ──
    useEffect(() => {
        if (!organization?.Organization_ID) return;

        const today = getTodayString();
        const lastCheck = localStorage.getItem(LAST_MATERIAL_CHECK_KEY);

        // Only check once per day (or first load)
        if (lastCheck === today) return;

        const runCheck = async () => {
            try {
                const zeroCostProducts = await checkZeroMaterialCostProducts(
                    organization.Organization_ID,
                    2 // Look 2 days ahead (today + tomorrow)
                );

                if (zeroCostProducts.length === 0) {
                    localStorage.setItem(LAST_MATERIAL_CHECK_KEY, today);
                    return;
                }

                const readIds = getReadNotifications();

                // Create individual notifications per product
                const materialNotifications: LocalNotification[] = zeroCostProducts.map(product => {
                    const notifId = `material-warning-${product.Work_Order_Item_ID}-${today}`;
                    const startLabel = product.Planned_Start_Date
                        ? (() => {
                            const startDate = new Date(product.Planned_Start_Date);
                            const todayDate = new Date(today);
                            const daysDiff = Math.ceil((startDate.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24));
                            if (daysDiff <= 0) return 'danas';
                            if (daysDiff === 1) return 'sutra';
                            return `za ${daysDiff} dana`;
                        })()
                        : 'uskoro';

                    return {
                        id: notifId,
                        title: `⚠️ ${product.Product_Name} — trošak materijala: 0 KM`,
                        message: product.Has_Materials
                            ? `Proizvod ima ${product.Material_Count} materijala ali svi imaju cijenu 0. Proizvodnja počinje ${startLabel} (${product.Work_Order_Number}). Unesite procijenjeni trošak ili ažurirajte cijene materijala.`
                            : `Proizvod nema unesenih materijala. Proizvodnja počinje ${startLabel} (${product.Work_Order_Number}). Unesite procijenjeni trošak materijala.`,
                        type: 'material-warning' as const,
                        read: readIds.has(notifId),
                        createdAt: new Date().toISOString(),
                        targetTab: 'production',
                        metadata: {
                            workOrderItemId: product.Work_Order_Item_ID,
                            productId: product.Product_ID,
                            productName: product.Product_Name,
                            projectName: product.Project_Name,
                            workOrderNumber: product.Work_Order_Number,
                            hasMaterials: product.Has_Materials,
                            materialCount: product.Material_Count,
                        }
                    };
                });

                // Merge into existing notifications
                setNotifications(prev => {
                    const existingIds = new Set(prev.map(n => n.id));
                    const newOnes = materialNotifications.filter(n => !existingIds.has(n.id));
                    if (newOnes.length === 0) return prev;

                    const all = [...newOnes, ...prev];
                    all.sort((a, b) => {
                        if (a.read !== b.read) return a.read ? 1 : -1;
                        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
                    });
                    return all;
                });

                localStorage.setItem(LAST_MATERIAL_CHECK_KEY, today);
            } catch (error) {
                console.error('Material cost check failed:', error);
            }
        };

        runCheck();
    }, [organization?.Organization_ID, getReadNotifications]);

    // ── N1-N5: Data gap checks (staggered to avoid blocking UI) ──
    useEffect(() => {
        if (!organization?.Organization_ID) return;

        const today = getTodayString();
        const lastCheck = localStorage.getItem(LAST_DATA_GAP_CHECK_KEY);
        if (lastCheck === today) return;

        const runDataGapChecks = async () => {
            const readIds = getReadNotifications();
            const dataGapNotifications: LocalNotification[] = [];

            try {
                // N1: Unassigned Montaža
                const montazaItems = await checkUnassignedMontazaItems(organization.Organization_ID);
                for (const item of montazaItems) {
                    const notifId = `worker-missing-${item.itemId}-${today}`;
                    dataGapNotifications.push({
                        id: notifId,
                        title: `🔴 Montaža bez radnika: ${item.itemName}`,
                        message: `Proces "${item.processName}" je aktivan ali nema dodijeljenog radnika. Trošak rada se neće bilježiti. (${item.workOrderNumber})`,
                        type: 'worker-missing',
                        read: readIds.has(notifId),
                        createdAt: new Date().toISOString(),
                        targetTab: 'production',
                        metadata: {
                            workOrderId: item.workOrderId,
                            workOrderNumber: item.workOrderNumber,
                            processName: item.processName
                        }
                    });
                }

                // N2: Missing attendance (already exists as banner, add to notification center)
                await new Promise(r => setTimeout(r, 500));
                const attendanceResult = await checkMissingAttendanceForActiveOrders(organization.Organization_ID);
                if (attendanceResult.missingCount > 0) {
                    const notifId = `attendance-gap-${today}`;
                    if (!readIds.has(notifId)) {
                        const workerNames = Array.from(new Set(attendanceResult.warnings.map(w => w.Worker_Name))).slice(0, 3);
                        dataGapNotifications.push({
                            id: notifId,
                            title: `⚠️ Nedostaje sihtarica za ${attendanceResult.missingCount} radnik${attendanceResult.missingCount === 1 ? 'a' : 'a'}`,
                            message: `${workerNames.join(', ')}${attendanceResult.warnings.length > 3 ? ` i još ${attendanceResult.warnings.length - 3}` : ''} — trošak rada će biti netačan.`,
                            type: 'attendance-gap',
                            read: false,
                            createdAt: new Date().toISOString(),
                            targetTab: 'attendance',
                            metadata: { date: today, count: attendanceResult.missingCount }
                        });
                    }
                }

                // N3: Zero rate workers
                await new Promise(r => setTimeout(r, 500));
                const zeroRateWorkers = await checkZeroRateAssignedWorkers(organization.Organization_ID);
                for (const worker of zeroRateWorkers) {
                    const notifId = `zero-rate-${worker.workerId}-${today}`;
                    dataGapNotifications.push({
                        id: notifId,
                        title: `🔴 ${worker.workerName} ima dnevnicu 0 KM`,
                        message: `Radnik je dodijeljen na: ${worker.itemNames.slice(0, 2).join(', ')}${worker.itemNames.length > 2 ? ` (+${worker.itemNames.length - 2})` : ''}. Sav rad će biti besplatan.`,
                        type: 'zero-rate',
                        read: readIds.has(notifId),
                        createdAt: new Date().toISOString(),
                        targetTab: 'production',
                        metadata: {
                            workerId: worker.workerId,
                            workerName: worker.workerName,
                            workerItems: worker.itemNames
                        }
                    });
                }

                // N4: Processes without workers
                await new Promise(r => setTimeout(r, 500));
                const noWorkerProcesses = await checkProcessesWithoutWorkers(organization.Organization_ID);
                if (noWorkerProcesses.length > 0) {
                    // Group by work order to avoid noise
                    const byWO = new Map<string, typeof noWorkerProcesses>();
                    noWorkerProcesses.forEach(p => {
                        const arr = byWO.get(p.workOrderId) || [];
                        arr.push(p);
                        byWO.set(p.workOrderId, arr);
                    });
                    for (const [woId, procs] of Array.from(byWO.entries())) {
                        const notifId = `process-unassigned-${woId}-${today}`;
                        const processNames = Array.from(new Set(procs.map((p: { itemName: string; processName: string }) => `${p.itemName}/${p.processName}`)));
                        dataGapNotifications.push({
                            id: notifId,
                            title: `⚠️ ${procs.length} aktivan${procs.length > 1 ? 'ih' : ''} proces${procs.length > 1 ? 'a' : ''} bez radnika`,
                            message: `${processNames.slice(0, 2).join(', ')}${processNames.length > 2 ? ` (+${processNames.length - 2})` : ''} — (${procs[0].workOrderNumber})`,
                            type: 'process-unassigned',
                            read: readIds.has(notifId),
                            createdAt: new Date().toISOString(),
                            targetTab: 'production',
                            metadata: { workOrderId: woId, workOrderNumber: procs[0].workOrderNumber }
                        });
                    }
                }

                // N5: Missing cost fields
                await new Promise(r => setTimeout(r, 500));
                const missingCosts = await checkMissingCostFields(organization.Organization_ID);
                if (missingCosts.length > 0) {
                    // Group by work order
                    const byWO = new Map<string, typeof missingCosts>();
                    missingCosts.forEach(c => {
                        const arr = byWO.get(c.workOrderId) || [];
                        arr.push(c);
                        byWO.set(c.workOrderId, arr);
                    });
                    for (const [woId, items] of Array.from(byWO.entries())) {
                        const allMissing = Array.from(new Set(items.flatMap((i: { missingFields: string[] }) => i.missingFields)));
                        const notifId = `costs-missing-${woId}-${today}`;
                        dataGapNotifications.push({
                            id: notifId,
                            title: `💰 Nedostaju troškovi: ${items[0].workOrderNumber}`,
                            message: `${items.length} stavk${items.length === 1 ? 'a' : 'i'} bez: ${allMissing.join(', ')}. Profit nije potpun.`,
                            type: 'costs-missing',
                            read: readIds.has(notifId),
                            createdAt: new Date().toISOString(),
                            targetTab: 'production',
                            metadata: {
                                workOrderId: woId,
                                workOrderNumber: items[0].workOrderNumber,
                                missingFields: allMissing
                            }
                        });
                    }
                }

            } catch (error) {
                console.error('Data gap checks failed:', error);
            }

            // Merge data gap notifications
            if (dataGapNotifications.length > 0) {
                setNotifications(prev => {
                    const existingIds = new Set(prev.map(n => n.id));
                    const newOnes = dataGapNotifications.filter(n => !existingIds.has(n.id));
                    if (newOnes.length === 0) return prev;
                    const all = [...newOnes, ...prev];
                    all.sort((a, b) => {
                        if (a.read !== b.read) return a.read ? 1 : -1;
                        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
                    });
                    return all;
                });
            }

            localStorage.setItem(LAST_DATA_GAP_CHECK_KEY, today);
        };

        // Stagger: Start data gap checks 2 seconds after component mounts
        const timer = setTimeout(runDataGapChecks, 2000);
        return () => clearTimeout(timer);
    }, [organization?.Organization_ID, getReadNotifications]);

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
            setNotifications(prev => {
                // Keep material-warning notifications from previous state
                const materialWarnings = prev.filter(n => n.id.startsWith('material-warning-'));
                const all = [...materialWarnings, ...dailyNotifications, ...convertedDbNotifications];
                // Deduplicate
                const seen = new Set<string>();
                const deduped = all.filter(n => {
                    if (seen.has(n.id)) return false;
                    seen.add(n.id);
                    return true;
                });
                deduped.sort((a, b) => {
                    if (a.read !== b.read) return a.read ? 1 : -1;
                    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
                });
                return deduped;
            });
        });

        // If subscription returns empty, just use daily
        if (dailyNotifications.length > 0) {
            const sorted = [...dailyNotifications].sort((a, b) => {
                if (a.read !== b.read) return a.read ? 1 : -1;
                return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
            });
            setNotifications(prev => {
                // Keep material-warning notifications
                const materialWarnings = prev.filter(n => n.id.startsWith('material-warning-'));
                if (materialWarnings.length === 0) return sorted;
                const all = [...materialWarnings, ...sorted];
                all.sort((a, b) => {
                    if (a.read !== b.read) return a.read ? 1 : -1;
                    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
                });
                return all;
            });
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
        if (!id.startsWith('sihtarica-') && !id.startsWith('tasks-') && !id.startsWith('unsent-offers-') && !id.startsWith('unsent-orders-') && !id.startsWith('demo-') && !id.startsWith('material-warning-')) {
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
            if (!n.id.startsWith('sihtarica-') && !n.id.startsWith('tasks-') && !n.id.startsWith('unsent-offers-') && !n.id.startsWith('unsent-orders-') && !n.id.startsWith('demo-') && !n.id.startsWith('material-warning-')) {
                await markNotificationAsRead(n.id);
            }
        }
    };

    const handleNotificationClick = async (n: LocalNotification) => {
        // For material-warning, don't navigate — let inline actions handle it
        if (n.type === 'material-warning' && !costSaved.has(n.id)) {
            return; // Actions are inline, no navigation needed
        }

        // Mark as read
        if (!n.read) {
            setNotifications((prev: LocalNotification[]) => prev.map((item: LocalNotification) => item.id === n.id ? { ...item, read: true } : item));
            const readIds = getReadNotifications();
            readIds.add(n.id);
            saveReadNotifications(readIds);

            if (!n.id.startsWith('sihtarica-') && !n.id.startsWith('tasks-') && !n.id.startsWith('unsent-offers-') && !n.id.startsWith('unsent-orders-') && !n.id.startsWith('demo-') && !n.id.startsWith('material-warning-')) {
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

    // ── Handle inline cost entry ──
    const handleCostEntry = (e: React.MouseEvent, notifId: string) => {
        e.stopPropagation();
        setCostEntryId(costEntryId === notifId ? null : notifId);
        setCostValue('');
    };

    const handleCostSave = async (e: React.MouseEvent, n: LocalNotification) => {
        e.stopPropagation();
        const cost = parseFloat(costValue);
        if (!cost || cost <= 0 || !n.metadata?.workOrderItemId || !organization?.Organization_ID) return;

        setCostSaving(true);
        try {
            const result = await setManualMaterialCost(
                n.metadata.workOrderItemId,
                cost,
                organization.Organization_ID,
                true // Also update the product
            );

            if (result.success) {
                setCostSaved(prev => new Set(prev).add(n.id));
                setCostEntryId(null);
                setCostValue('');

                // Mark this notification as read
                setNotifications(prev => prev.map(item => item.id === n.id ? { ...item, read: true } : item));
                const readIds = getReadNotifications();
                readIds.add(n.id);
                saveReadNotifications(readIds);
            } else {
                alert(result.message);
            }
        } catch (error) {
            console.error('Failed to save manual cost:', error);
            alert('Greška pri spremanju troška materijala');
        } finally {
            setCostSaving(false);
        }
    };

    const handleGoToMaterials = (e: React.MouseEvent, n: LocalNotification) => {
        e.stopPropagation();
        setIsOpen(false);

        // Mark as read
        setNotifications(prev => prev.map(item => item.id === n.id ? { ...item, read: true } : item));
        const readIds = getReadNotifications();
        readIds.add(n.id);
        saveReadNotifications(readIds);

        // Navigate to projects tab where materials can be managed
        window.dispatchEvent(new CustomEvent('switchTab', { detail: { tab: 'projects' } }));
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
            case 'material-warning': return <Package size={18} className="text-amber-600" />;
            case 'worker-missing': return <UserX size={18} className="text-red-500" />;
            case 'attendance-gap': return <ClipboardList size={18} className="text-orange-500" />;
            case 'zero-rate': return <DollarSign size={18} className="text-red-600" />;
            case 'process-unassigned': return <Wrench size={18} className="text-orange-400" />;
            case 'costs-missing': return <DollarSign size={18} className="text-amber-500" />;
            default: return <Info size={18} className="text-blue-500" />;
        }
    };

    // Render inline content for material-warning notifications
    const renderMaterialWarningContent = (n: LocalNotification) => {
        if (costSaved.has(n.id)) {
            return (
                <div className="n-cost-success">
                    <CheckCircle size={14} />
                    Trošak materijala uspješno ažuriran
                </div>
            );
        }

        if (costEntryId === n.id) {
            return (
                <div className="n-cost-form" onClick={(e) => e.stopPropagation()}>
                    <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="Procijenjeni trošak"
                        value={costValue}
                        onChange={(e) => setCostValue(e.target.value)}
                        autoFocus
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') handleCostSave(e as any, n);
                            if (e.key === 'Escape') setCostEntryId(null);
                        }}
                    />
                    <span className="n-cost-unit">KM</span>
                    <button
                        className="n-cost-save"
                        onClick={(e) => handleCostSave(e, n)}
                        disabled={costSaving || !costValue || parseFloat(costValue) <= 0}
                    >
                        {costSaving ? '...' : 'Spremi'}
                    </button>
                </div>
            );
        }

        return (
            <div className="n-action-buttons">
                <button className="n-action-btn primary" onClick={(e) => handleCostEntry(e, n.id)}>
                    <DollarSign size={12} />
                    Unesi trošak
                </button>
                <button className="n-action-btn secondary" onClick={(e) => handleGoToMaterials(e, n)}>
                    <Package size={12} />
                    Detalji materijala
                </button>
            </div>
        );
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
                                    {n.type === 'material-warning' && renderMaterialWarningContent(n)}
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
                                    {(n.targetTab || n.link) && n.type !== 'material-warning' && (
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
