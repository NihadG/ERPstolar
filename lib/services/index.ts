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
import * as invoiceService from './invoice/invoiceService';
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
    invoiceService,
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
export { getProductsByProject, getProduct, saveProduct, deleteProduct, updateProductStatus, recalculateProductCost, updateProductNotes, updateProductCutLists } from './product/productService';
export { addMaterialToProduct, deleteProductMaterial, updateProductMaterial, addGlassMaterialToProduct, updateGlassMaterial, addAluDoorMaterialToProduct, updateAluDoorMaterial, generateUUID } from '../database';

// Worker
export { getWorkers, saveWorker, deleteWorker } from './resource/workerService';

// Supplier
export { getSuppliers, saveSupplier, deleteSupplier } from './resource/supplierService';

// Material Catalog
export { getMaterialsCatalog, saveMaterial, deleteMaterial, deleteDuplicateMaterials } from './resource/materialCatalogService';
export { getMaterialTemplates, saveMaterialTemplate, deleteMaterialTemplate, applyMaterialTemplate } from './resource/materialCatalogService';

// Offer
export { getOffers, createOfferWithProducts, saveOffer, updateOfferWithProducts, deleteOffer, updateOfferStatus, updateOfferProduct, reviseOffer } from './offer/offerService';
export { getOffer } from '../database';

// Invoice (Završni račun)
export { getInvoicesForProject, saveInvoiceDraft, deleteInvoice, issueInvoice, cancelInvoice } from './invoice/invoiceService';
export type { InvoiceDraftInput } from './invoice/invoiceService';

// Order
export { getOrders, getOrder, getOrderItems, createOrder, saveOrder, deleteOrder, updateOrderStatus, markOrderSent, markMaterialsReceived, markMaterialsUnreceived, deleteOrderItemsByIds, updateOrderItem, recalculateOrderTotal, batchUpdateMaterialStatuses } from './order/orderService';

// Work Order
export {
    getWorkOrders, getWorkOrder, createWorkOrder, updateWorkOrder,
    updateWorkOrderStatus, updateWorkOrderItemStatus, assignWorkerToItem,
    startWorkOrder, deleteWorkOrder,
    scheduleWorkOrder, rescheduleWorkOrder, unscheduleWorkOrder, getScheduledWorkOrders,
    updateDueDate, updatePlannedStartDate, checkWorkerConflicts, autoCreateOrdersForWorkOrder,
    getWorkLogs, getWorkLogsForItem, getWorkLogsForWorkOrder, createWorkLog,
    planWorkOrderRenumbering, applyWorkOrderRenumbering,
    buildMaterialOrderPlan, createSelectedMaterialOrders,
} from './workOrder/workOrderService';
export type { MaterialOrderPlanGroup, MaterialOrderPlanItem } from '../database';

// Graf procesa (po nalogu) + templejti toka
export { getProcessGraph, saveProcessGraph, listProcessTemplates, saveProcessTemplate, deleteProcessTemplate } from '../database';
export { getProductMaterials } from '../database';
export { applyBasisReview, buildBasisReview } from '../database';

// Katalog procesa (org) + pravila materijal→proces + plan procesa proizvoda
export {
    getProcessCatalog, saveProcessCatalogItem, renameProcessCatalogItem,
    deleteProcessCatalogItem, reorderProcessCatalog,
    getProcessMaterialRules, saveProcessMaterialRule, deleteProcessMaterialRule,
    applyAutoProcessPlan, saveProductProcessStages,
    saveProductProcessGraph,
    getProcessStageTemplates, saveProcessStageTemplate, updateProcessStageTemplate,
    renameProcessStageTemplate, deleteProcessStageTemplate,
    getProcessUsageData, applyProcessConsolidation,
} from '../database';
export type { ProcessUsageData, ConsolidationStats } from '../database';

// Labor / Attendance
export {
    markAttendanceAndRecalculate, saveWorkerAttendance,
    getWorkerAttendance, getWorkerAttendanceByMonth, getAllAttendanceByMonth,
    autoPopulateWeekends,
    createWorkLogsForAttendance, backfillWorkLogsFromAttendance, bookWorkerDayItems,
    recalculateWorkOrder, recalculateAllActiveWorkOrders,
    syncProjectStatus, syncAllProjectData, runStartupSync,
    checkMissingAttendanceForActiveOrders, checkMissingAttendanceHistory,
    assignWorkersToItem, toggleItemPause,
    calculateActualLaborCost, calculateSubTaskLaborCost,
    updateItemProcess, addProcessToOrderItem,
    createSubTasks, updateSubTask, moveSubTask,
    canWorkerStartProcess, triggerWorkLogReconciliation,
    getWorkerMonthlyAttendance, overrideWorkLogs,
    repairAllProductStatuses, startWorkOrderItem, completeWorkOrderItem,
    formatLocalDateISO,
    adjustWorkOrderDates,
    saveDailyWorkBooking, saveWorkOrderDayBooking, getDailyWorkBooking, suggestDailyBooking, bulkBookWorkOrderLabor,
    getBookedWorkerDaysByMonth, getWorkLogsForMonth,
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
    createProductionSnapshot, getProductionSnapshots, getProductionSnapshotForWorkOrder,
    checkZeroMaterialCostProducts, setManualMaterialCost,
    checkUnassignedMontazaItems, checkZeroRateAssignedWorkers,
    checkProcessesWithoutWorkers, checkMissingCostFields,
} from './profit/profitService';

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
    linkTasksToWorkOrder, unlinkTaskFromWorkOrder, setTaskProductInOrder, attachTasksToWorkOrder,
    syncWorkOrderNameOnTasks,
} from './task/taskService';

// Settings
export { getOrgSettings, saveOrgSettings } from '../database';

// Podaci i spremnost (snapshot v3 → profili → indikator spremnosti)
export { getDataReadiness, rebuildProductionSnapshots, getProductTaxonomy } from '../database';
export type { RebuildSnapshotsResult } from '../database';
export { computeReadiness } from '../insights/readiness';
export type { Readiness, ReadinessMetric, ReadinessLevel } from '../insights/readiness';
export { buildWorkerAffinity, processOwnership } from '../insights/workerAffinity';
export type { WorkerProfile, AffinityRow } from '../insights/workerAffinity';
export { buildTypeProfiles, driverRates } from '../insights/typeProfile';
export type { TypeProfile } from '../insights/typeProfile';
export { buildFlowSummary } from '../insights/processFlow';
export type { FlowSummary, TransitionStat } from '../insights/processFlow';
export { findComparable, describeComparable } from '../insights/comparable';
export type { ComparableQuery, ComparableResult } from '../insights/comparable';
// Platno — planerski scenariji (jedina kolekcija u koju platno piše)
export {
    getScenarios, getScenario, createScenario, saveScenario,
    duplicateScenario, renameScenario, archiveScenario, deleteScenario,
} from './planning/scenarioService';
export type { SaveScenarioResult } from './planning/scenarioService';

export { collectUnresolved } from '../insights/unresolved';
export type { UnresolvedReport, UnresolvedEntry } from '../insights/unresolved';
export { getMaterialTaxonomy } from '../database';

// Data Loading
export { getAllData } from '../database';
