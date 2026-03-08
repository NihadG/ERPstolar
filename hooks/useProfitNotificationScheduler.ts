'use client';

import { useEffect, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';

/**
 * useProfitNotificationScheduler
 * 
 * Client-side profit notification scheduler.
 * Checks every 60 seconds whether it's time to fire a profit reminder.
 * Creates a notification via the notification center if:
 *  - profit notifications are enabled in settings
 *  - current time matches the configured notification time (HH:mm)
 *  - no notification has been created today yet (tracked via localStorage)
 */
export function useProfitNotificationScheduler() {
    const { organization } = useAuth();
    const orgId = organization?.Organization_ID;
    const lastFiredRef = useRef<string>('');

    useEffect(() => {
        if (!orgId) return;

        const CHECK_INTERVAL = 60_000; // 1 minute

        const checkAndNotify = async () => {
            try {
                // Read settings — try localStorage first (fast), then Firestore
                let profitEnabled = true;
                let profitTime = '17:00';

                const cachedSettings = localStorage.getItem(`appSettings_${orgId}`);
                if (cachedSettings) {
                    try {
                        const parsed = JSON.parse(cachedSettings);
                        profitEnabled = parsed.profitNotificationsEnabled ?? true;
                        profitTime = parsed.profitNotificationTime ?? '17:00';
                    } catch { /* use defaults */ }
                } else {
                    // Fallback: read from Firestore
                    const { getOrgSettings } = await import('@/lib/services');
                    const settings = await getOrgSettings(orgId);
                    if (settings?.appSettings) {
                        profitEnabled = settings.appSettings.profitNotificationsEnabled ?? true;
                        profitTime = settings.appSettings.profitNotificationTime ?? '17:00';
                    }
                }

                if (!profitEnabled) return;

                const now = new Date();
                const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
                const todayKey = now.toISOString().split('T')[0];

                // Only fire at the configured time (same HH:mm)
                if (currentTime !== profitTime) return;

                // Already fired today?
                const storageKey = `profit_notif_${orgId}_${todayKey}`;
                if (localStorage.getItem(storageKey)) return;
                if (lastFiredRef.current === todayKey) return;

                // Check for WOs missing today's entry
                const { getTodaysMissingEntries, createNotification, getWorkOrders } = await import('@/lib/services');

                // Get active work orders
                const allWos = await getWorkOrders(orgId);
                const activeWos = allWos
                    .filter((wo: any) => wo.Status !== 'Završeno' && wo.Status !== 'Otkazano')
                    .map((wo: any) => ({
                        Work_Order_ID: wo.Work_Order_ID,
                        Work_Order_Number: wo.Work_Order_Number || '',
                        Name: wo.Name,
                    }));

                if (activeWos.length === 0) {
                    localStorage.setItem(storageKey, '1');
                    lastFiredRef.current = todayKey;
                    return;
                }

                const missing = await getTodaysMissingEntries(orgId, activeWos);

                if (missing.length === 0) {
                    // All active WOs have entries
                    localStorage.setItem(storageKey, '1');
                    lastFiredRef.current = todayKey;
                    return;
                }

                // Create notification
                const woCount = missing.length;
                await createNotification(
                    {
                        type: 'profit-reminder',
                        title: 'Dnevni profit podsjetnik',
                        message: `Imate ${woCount} ${woCount === 1 ? 'nalog' : 'naloga'} bez unesenog profita za danas.`,
                        organizationId: orgId,
                    },
                    orgId
                );

                localStorage.setItem(storageKey, '1');
                lastFiredRef.current = todayKey;
            } catch (err) {
                console.error('[ProfitNotificationScheduler] Error:', err);
            }
        };

        // Initial check (with slight delay so page loads first)
        const initialTimeout = setTimeout(checkAndNotify, 5000);

        // Periodic check
        const interval = setInterval(checkAndNotify, CHECK_INTERVAL);
        return () => {
            clearTimeout(initialTimeout);
            clearInterval(interval);
        };
    }, [orgId]);
}
