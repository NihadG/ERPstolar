/**
 * notificationService.ts — Notification CRUD + real-time subscriptions
 * 
 * Extracted from database.ts (functions: createNotification, getUnreadNotifications,
 * markNotificationAsRead, subscribeToNotifications)
 */

import { COLLECTIONS } from '../shared/collections';
import {
    queryByOrg,
    createDoc,
    getDb,
    query,
    collection,
    where,
    getDocs,
    updateDoc,
    onSnapshot,
} from '../shared/firestoreClient';
import { v4 as uuidv4 } from 'uuid';
import type { Notification } from '../../types';

// ============================================
// READ
// ============================================

export async function getUnreadNotifications(organizationId: string): Promise<Notification[]> {
    if (!organizationId) return [];

    try {
        const db = getDb();
        const q = query(
            collection(db, COLLECTIONS.NOTIFICATIONS),
            where('organizationId', '==', organizationId),
            where('read', '==', false)
        );
        const snapshot = await getDocs(q);
        return snapshot.docs
            .map(doc => ({ ...doc.data() } as Notification))
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } catch (error) {
        console.error('getUnreadNotifications error:', error);
        return [];
    }
}

// ============================================
// WRITE
// ============================================

export async function createNotification(
    data: Omit<Notification, 'id' | 'createdAt' | 'read'>,
    organizationId: string
): Promise<string> {
    try {
        const notification = {
            ...data,
            id: uuidv4(),
            organizationId,
            createdAt: new Date().toISOString(),
            read: false,
        };

        await createDoc(COLLECTIONS.NOTIFICATIONS, notification as Record<string, unknown>);
        return notification.id;
    } catch (error) {
        console.error('createNotification error:', error);
        return '';
    }
}

export async function markNotificationAsRead(id: string): Promise<boolean> {
    try {
        const db = getDb();
        const q = query(
            collection(db, COLLECTIONS.NOTIFICATIONS),
            where('id', '==', id)
        );
        const snapshot = await getDocs(q);
        if (!snapshot.empty) {
            await updateDoc(snapshot.docs[0].ref, { read: true });
            return true;
        }
        return false;
    } catch (error) {
        console.error('markNotificationAsRead error:', error);
        return false;
    }
}

// ============================================
// REAL-TIME SUBSCRIPTION
// ============================================

export function subscribeToNotifications(
    organizationId: string,
    callback: (notifications: Notification[]) => void
): () => void {
    if (!organizationId) return () => { };

    try {
        const db = getDb();
        const q = query(
            collection(db, COLLECTIONS.NOTIFICATIONS),
            where('organizationId', '==', organizationId),
            where('read', '==', false)
        );

        return onSnapshot(q, (snapshot) => {
            const notifications = snapshot.docs
                .map(doc => ({ ...doc.data() } as Notification))
                .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
            callback(notifications);
        }, (error) => {
            console.error('subscribeToNotifications error:', error);
            callback([]);
        });
    } catch (error) {
        console.error('subscribeToNotifications setup error:', error);
        return () => { };
    }
}
