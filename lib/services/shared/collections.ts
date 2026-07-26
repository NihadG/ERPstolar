/**
 * collections.ts — Single source of truth for Firestore collection names
 * 
 * Previously duplicated in database.ts and attendance.ts.
 * All services import from here.
 */

export const COLLECTIONS = {
    PROJECTS: 'projects',
    PRODUCTS: 'products',
    MATERIALS_DB: 'materials',
    MATERIAL_TEMPLATES: 'material_templates',
    PRODUCT_MATERIALS: 'product_materials',
    GLASS_ITEMS: 'glass_items',
    ALU_DOOR_ITEMS: 'alu_door_items',
    OFFERS: 'offers',
    OFFER_PRODUCTS: 'offer_products',
    OFFER_EXTRAS: 'offer_extras',
    ORDERS: 'orders',
    ORDER_ITEMS: 'order_items',
    SUPPLIERS: 'suppliers',
    WORKERS: 'workers',
    WORK_ORDERS: 'work_orders',
    WORK_ORDER_ITEMS: 'work_order_items',
    WORKER_ATTENDANCE: 'worker_attendance',
    WORK_LOGS: 'work_logs',
    TASKS: 'tasks',
    TASK_PROFILES: 'task_profiles',
    NOTIFICATIONS: 'notifications',
    PRODUCTION_SNAPSHOTS: 'production_snapshots',
    // Platno — planerski scenariji. JEDINA kolekcija u koju platno piše.
    PLANNING_SCENARIOS: 'planning_scenarios',
    HOLIDAYS: 'holidays',
    ORG_SETTINGS: 'org_settings',
    SERVICE_DEFINITIONS: 'service_definitions',
    DAILY_PROFIT_ENTRIES: 'daily_profit_entries',
    INVOICES: 'invoices',
    INVOICE_ITEMS: 'invoice_items',
} as const;

export type CollectionKey = keyof typeof COLLECTIONS;
export type CollectionName = (typeof COLLECTIONS)[CollectionKey];
