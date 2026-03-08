/**
 * dailyProfitService.ts — Manual daily profit entry CRUD
 * 
 * Replaces the buggy automatic profit calculation.
 * Users manually enter revenue/costs per work order (and optionally per item) daily.
 */

import { COLLECTIONS } from '../shared/collections';
import {
    getDb,
    queryByOrg,
    createDoc,
    findByIdAndOrg,
    updateDocByRef,
    deleteByIdAndOrg,
} from '../shared/firestoreClient';
import { collection, query, where, getDocs } from 'firebase/firestore';
import type { DailyProfitEntry } from '../../types';

// ============================================
// GENERATE UUID
// ============================================

function generateId(): string {
    return 'dpe_' + Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
}

// ============================================
// SAVE (UPSERT) — Per WO per Date (+ optional per Item)
// ============================================

/**
 * Save or update a daily profit entry.
 * If an entry exists for the same WO + Date (+ optional Item), it updates.
 * Otherwise, creates a new entry.
 */
export async function saveDailyProfitEntry(
    entry: Omit<DailyProfitEntry, 'ID' | 'Daily_Profit' | 'Created_At' | 'Updated_At'> & { ID?: string },
    organizationId: string
): Promise<{ success: boolean; message: string; entryId?: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID je obavezan' };
    }

    try {
        const now = new Date().toISOString();
        const dailyProfit = (entry.Revenue_Today || 0)
            - (entry.Material_Cost_Today || 0)
            - (entry.Labor_Cost_Today || 0)
            - (entry.Other_Costs_Today || 0);

        // Check for existing entry (same WO + Date + optional Item)
        const firestore = getDb();
        const constraints = [
            where('Organization_ID', '==', organizationId),
            where('Work_Order_ID', '==', entry.Work_Order_ID),
            where('Date', '==', entry.Date),
        ];

        // If per-item entry, also match on item ID
        if (entry.Work_Order_Item_ID) {
            constraints.push(where('Work_Order_Item_ID', '==', entry.Work_Order_Item_ID));
        }

        const existingQuery = query(
            collection(firestore, COLLECTIONS.DAILY_PROFIT_ENTRIES),
            ...constraints
        );
        const existingSnap = await getDocs(existingQuery);

        // Filter: if NOT per-item entry, exclude per-item entries from match
        let matchDoc = null;
        for (const doc of existingSnap.docs) {
            const data = doc.data();
            if (entry.Work_Order_Item_ID) {
                // per-item: match exactly
                if (data.Work_Order_Item_ID === entry.Work_Order_Item_ID) {
                    matchDoc = doc;
                    break;
                }
            } else {
                // WO-level: exclude per-item entries
                if (!data.Work_Order_Item_ID) {
                    matchDoc = doc;
                    break;
                }
            }
        }

        if (matchDoc) {
            // Update existing
            await updateDocByRef(matchDoc.ref, {
                Revenue_Today: entry.Revenue_Today || 0,
                Material_Cost_Today: entry.Material_Cost_Today || 0,
                Labor_Cost_Today: entry.Labor_Cost_Today || 0,
                Other_Costs_Today: entry.Other_Costs_Today || 0,
                Notes: entry.Notes || '',
                Daily_Profit: dailyProfit,
                Updated_At: now,
            });
            return { success: true, message: 'Unos ažuriran', entryId: matchDoc.data().ID };
        }

        // Create new
        const entryId = entry.ID || generateId();
        const newEntry: Record<string, unknown> = {
            ID: entryId,
            Organization_ID: organizationId,
            Work_Order_ID: entry.Work_Order_ID,
            Work_Order_Number: entry.Work_Order_Number || '',
            Date: entry.Date,
            Revenue_Today: entry.Revenue_Today || 0,
            Material_Cost_Today: entry.Material_Cost_Today || 0,
            Labor_Cost_Today: entry.Labor_Cost_Today || 0,
            Other_Costs_Today: entry.Other_Costs_Today || 0,
            Notes: entry.Notes || '',
            Daily_Profit: dailyProfit,
            Created_At: now,
            Updated_At: now,
        };

        // Optional per-item fields
        if (entry.Work_Order_Item_ID) {
            newEntry.Work_Order_Item_ID = entry.Work_Order_Item_ID;
        }
        if (entry.Product_Name) {
            newEntry.Product_Name = entry.Product_Name;
        }

        await createDoc(COLLECTIONS.DAILY_PROFIT_ENTRIES, newEntry);
        return { success: true, message: 'Dnevni unos sačuvan', entryId };
    } catch (error) {
        console.error('saveDailyProfitEntry error:', error);
        return { success: false, message: 'Greška pri čuvanju dnevnog unosa' };
    }
}

// ============================================
// READ — Entries for a Work Order
// ============================================

export async function getDailyProfitEntries(
    workOrderId: string,
    organizationId: string,
    dateFrom?: string,
    dateTo?: string
): Promise<DailyProfitEntry[]> {
    if (!organizationId || !workOrderId) return [];

    try {
        const entries = await queryByOrg<DailyProfitEntry>(
            COLLECTIONS.DAILY_PROFIT_ENTRIES,
            organizationId,
            where('Work_Order_ID', '==', workOrderId)
        );

        // Client-side date filtering (Firestore composite index avoidance)
        let filtered = entries;
        if (dateFrom) {
            filtered = filtered.filter(e => e.Date >= dateFrom);
        }
        if (dateTo) {
            filtered = filtered.filter(e => e.Date <= dateTo);
        }

        // Sort by date descending (newest first)
        return filtered.sort((a, b) => b.Date.localeCompare(a.Date));
    } catch (error) {
        console.error('getDailyProfitEntries error:', error);
        return [];
    }
}

// ============================================
// SUMMARY — Aggregate totals for a Work Order
// ============================================

export interface ProfitSummary {
    totalRevenue: number;
    totalMaterialCost: number;
    totalLaborCost: number;
    totalOtherCosts: number;
    totalProfit: number;
    entryCount: number;
    latestDate: string | null;
}

export async function getDailyProfitSummary(
    workOrderId: string,
    organizationId: string
): Promise<ProfitSummary> {
    const empty: ProfitSummary = {
        totalRevenue: 0,
        totalMaterialCost: 0,
        totalLaborCost: 0,
        totalOtherCosts: 0,
        totalProfit: 0,
        entryCount: 0,
        latestDate: null,
    };

    if (!organizationId || !workOrderId) return empty;

    try {
        // Only aggregate WO-level entries (not per-item)
        const entries = await getDailyProfitEntries(workOrderId, organizationId);
        const woLevelEntries = entries.filter(e => !e.Work_Order_Item_ID);

        if (woLevelEntries.length === 0) return empty;

        return {
            totalRevenue: woLevelEntries.reduce((s, e) => s + (e.Revenue_Today || 0), 0),
            totalMaterialCost: woLevelEntries.reduce((s, e) => s + (e.Material_Cost_Today || 0), 0),
            totalLaborCost: woLevelEntries.reduce((s, e) => s + (e.Labor_Cost_Today || 0), 0),
            totalOtherCosts: woLevelEntries.reduce((s, e) => s + (e.Other_Costs_Today || 0), 0),
            totalProfit: woLevelEntries.reduce((s, e) => s + (e.Daily_Profit || 0), 0),
            entryCount: woLevelEntries.length,
            latestDate: woLevelEntries[0]?.Date || null,
        };
    } catch (error) {
        console.error('getDailyProfitSummary error:', error);
        return empty;
    }
}

// ============================================
// DELETE
// ============================================

export async function deleteDailyProfitEntry(
    entryId: string,
    organizationId: string
): Promise<{ success: boolean; message: string }> {
    if (!organizationId || !entryId) {
        return { success: false, message: 'ID unosa je obavezan' };
    }

    try {
        const count = await deleteByIdAndOrg(
            COLLECTIONS.DAILY_PROFIT_ENTRIES,
            'ID',
            entryId,
            organizationId
        );
        if (count === 0) {
            return { success: false, message: 'Unos nije pronađen' };
        }
        return { success: true, message: 'Unos obrisan' };
    } catch (error) {
        console.error('deleteDailyProfitEntry error:', error);
        return { success: false, message: 'Greška pri brisanju unosa' };
    }
}

// ============================================
// ACTIVE WORK ORDERS MISSING TODAY'S ENTRY
// ============================================

export async function getTodaysMissingEntries(
    organizationId: string,
    activeWorkOrders: { Work_Order_ID: string; Work_Order_Number: string; Name?: string }[]
): Promise<{ Work_Order_ID: string; Work_Order_Number: string; Name?: string }[]> {
    if (!organizationId || activeWorkOrders.length === 0) return [];

    try {
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

        // Get all today's entries for this org
        const todaysEntries = await queryByOrg<DailyProfitEntry>(
            COLLECTIONS.DAILY_PROFIT_ENTRIES,
            organizationId,
            where('Date', '==', today)
        );

        // WO-level entries only
        const enteredWoIds = new Set(
            todaysEntries
                .filter(e => !e.Work_Order_Item_ID)
                .map(e => e.Work_Order_ID)
        );

        // Return WOs that don't have today's entry
        return activeWorkOrders.filter(wo => !enteredWoIds.has(wo.Work_Order_ID));
    } catch (error) {
        console.error('getTodaysMissingEntries error:', error);
        return [];
    }
}
