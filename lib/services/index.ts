/**
 * services/index.ts — Service Registry / Facade
 * 
 * Central import point for all services. Components can import
 * from here instead of deep-diving into individual service files.
 * 
 * Usage:
 *   import { projectService, workOrderService, eventBus } from '@/lib/services';
 *   
 *   await projectService.saveProject(data, orgId);
 *   await workOrderService.startWorkOrder(woId, orgId);
 *   eventBus.on('project:statusChanged', handler);
 */

// ============================================
// SHARED INFRASTRUCTURE
// ============================================

export { COLLECTIONS } from './shared/collections';
export type { CollectionKey, CollectionName } from './shared/collections';
export { eventBus } from './eventBus';
export type { EventMap } from './eventBus';
export { AutoBatchWriter } from './shared/batchWriter';
export {
    getDb,
    queryByOrg,
    findByIdAndOrg,
    findRef,
    createDoc,
    updateDocByRef,
    updateByIdAndOrg,
    deleteByIdAndOrg,
    createBatch,
    getCollection,
    getDocRef,
} from './shared/firestoreClient';

// Sync Pipeline
export { initSyncPipeline, destroySyncPipeline, getSyncPipelineStats } from './sync/syncOrchestrator';

// ============================================
// DOMAIN SERVICES — Namespaced exports
// ============================================

import * as projectService from './project/projectService';
import * as productService from './product/productService';
import * as workerService from './resource/workerService';
import * as supplierService from './resource/supplierService';
import * as materialCatalogService from './resource/materialCatalogService';
import * as offerService from './offer/offerService';
import * as orderService from './order/orderService';
import * as workOrderService from './workOrder/workOrderService';
import * as laborCostService from './labor/laborCostService';
import * as profitService from './profit/profitService';
import * as notificationService from './notification/notificationService';
import * as taskService from './task/taskService';

export {
    projectService,
    productService,
    workerService,
    supplierService,
    materialCatalogService,
    offerService,
    orderService,
    workOrderService,
    laborCostService,
    profitService,
    notificationService,
    taskService,
};

// ============================================
// FLAT EXPORTS — Backward compatibility
// ============================================

// Project
export { getProjects, getProject, saveProject, deleteProject, updateProjectStatus } from './project/projectService';

// Product
export { getProductsByProject, getProduct, saveProduct, deleteProduct, updateProductStatus, recalculateProductCost } from './product/productService';
export { addMaterialToProduct, deleteProductMaterial, updateProductMaterial, addGlassMaterialToProduct, updateGlassMaterial, addAluDoorMaterialToProduct, updateAluDoorMaterial, generateUUID } from '../database';

// Worker
export { getWorkers, saveWorker, deleteWorker } from './resource/workerService';

// Supplier
export { getSuppliers, saveSupplier, deleteSupplier } from './resource/supplierService';

// Material Catalog
export { getMaterialsCatalog, saveMaterial, deleteMaterial, deleteDuplicateMaterials } from './resource/materialCatalogService';
export { getMaterialTemplates, saveMaterialTemplate, deleteMaterialTemplate, applyMaterialTemplate } from './resource/materialCatalogService';

// Offer
export { getOffers, createOfferWithProducts, saveOffer, updateOfferWithProducts, deleteOffer, updateOfferStatus, updateOfferProduct } from './offer/offerService';
export { getOffer } from '../database';

// Order
export { getOrders, getOrder, getOrderItems, createOrder, saveOrder, deleteOrder, updateOrderStatus, markOrderSent, markMaterialsReceived, deleteOrderItemsByIds, updateOrderItem, recalculateOrderTotal, batchUpdateMaterialStatuses } from './order/orderService';

// Work Order
export {
    getWorkOrders, getWorkOrder, createWorkOrder, updateWorkOrder,
    updateWorkOrderStatus, updateWorkOrderItemStatus, assignWorkerToItem,
    startWorkOrder, deleteWorkOrder,
    scheduleWorkOrder, rescheduleWorkOrder, unscheduleWorkOrder, getScheduledWorkOrders,
    updateDueDate, updatePlannedStartDate, checkWorkerConflicts, autoCreateOrdersForWorkOrder,
    getWorkLogs, getWorkLogsForItem, getWorkLogsForWorkOrder, createWorkLog,
} from './workOrder/workOrderService';

// Graf procesa (po nalogu) + templejti toka
export { getProcessGraph, saveProcessGraph, listProcessTemplates, saveProcessTemplate, deleteProcessTemplate } from '../database';

// Labor / Attendance
export {
    markAttendanceAndRecalculate, saveWorkerAttendance,
    getWorkerAttendance, getWorkerAttendanceByMonth, getAllAttendanceByMonth,
    autoPopulateWeekends,
    createWorkLogsForAttendance, backfillWorkLogsFromAttendance, bookWorkerDayItems,
    recalculateWorkOrder, recalculateAllActiveWorkOrders,
    syncProjectStatus, syncAllProjectData, runStartupSync,
    checkMissingAttendanceForActiveOrders, checkMissingAttendanceHistory,
    updateAllItemProcesses,
    assignWorkersToItem, toggleItemPause,
    calculateActualLaborCost, calculateSubTaskLaborCost,
    validateWorkOrderProfitData,
    updateItemProcess, bulkUpdateProcesses,
    createSubTasks, updateSubTask, moveSubTask,
    canWorkerStartProcess, triggerWorkLogReconciliation,
    getWorkerMonthlyAttendance, overrideWorkLogs,
    repairAllProductStatuses, startWorkOrderItem, completeWorkOrderItem,
    formatLocalDateISO,
    adjustWorkOrderDates,
    saveDailyWorkBooking, saveWorkOrderDayBooking, getDailyWorkBooking, suggestDailyBooking, bulkBookWorkOrderLabor,
    recalcAllWorkLogSplits,
} from './labor/laborCostService';
export type {
    DailyBookingItemInput, DailyBookingEntryInput,
    DailyBookingItemView, DailyBookingEntryView,
    WorkOrderDayEntryInput, BookTarget,
} from './labor/laborCostService';

// Profit
export {
    calculateProductProfitability, calculateWorkOrderProfitability,
    calculateWorkerProductivity, saveProfitOverrides,
    createProductionSnapshot, getProductionSnapshots,
    checkZeroMaterialCostProducts, setManualMaterialCost,
    checkUnassignedMontazaItems, checkZeroRateAssignedWorkers,
    checkProcessesWithoutWorkers, checkMissingCostFields,
    saveDailyProfitEntry, getDailyProfitEntries, getDailyProfitSummary,
    deleteDailyProfitEntry, getTodaysMissingEntries,
} from './profit/profitService';

// Profit Dashboard
export {
    getActiveProfitDashboard,
} from './profit/profitDashboardService';

// Analitika (jedinstvena — Profiti full-screen)
export { getAnalytics, getAnalyticsRaw, computeAnalytics } from './profit/analyticsService';
export type { AnalyticsData, AnalyticsOptions, AnalyticsScope, AnalyticsRaw } from './profit/analyticsService';

// Notification
export { createNotification, getUnreadNotifications, markNotificationAsRead, subscribeToNotifications } from './notification/notificationService';

// Task
export {
    getTasks, getTask, saveTask, deleteTask, updateTaskStatus,
    toggleTaskChecklistItem, addChecklistItem, removeChecklistItem,
    batchUpdateTasks, batchDeleteTasks, subscribeToTasks,
    getTodaysTasks, getOverdueTasks,
    getTaskProfiles, saveTaskProfile, deleteTaskProfile,
} from './task/taskService';

// Settings
export { getOrgSettings, saveOrgSettings } from '../database';

// Data Loading
export { getAllData } from '../database';
