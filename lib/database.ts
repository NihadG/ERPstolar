import { db } from './firebase';
import {
    collection,
    doc,
    getDocs,
    getDoc,
    setDoc,
    addDoc,
    updateDoc,
    deleteDoc,
    query,
    where,
    writeBatch,
    Timestamp,
    onSnapshot,
} from 'firebase/firestore';
import { v4 as uuidv4 } from 'uuid';
import type {
    Project,
    Product,
    Material,
    ProductMaterial,
    GlassItem,
    AluDoorItem,
    Offer,
    OfferProduct,
    OfferExtra,
    Order,
    OrderItem,
    Supplier,
    Worker,
    WorkOrder,
    WorkOrderItem,
    WorkerAttendance,
    WorkLog,
    Task,
    ChecklistItem,
    Notification,
    ProductionSnapshot,
    ProductionSnapshotItem,
    SnapshotMaterial,
    SnapshotWorker,
    SnapshotProcess,
    SnapshotExtra,
    AppState,
} from './types';
import { ALLOWED_ORDER_TRANSITIONS } from './types';

// ============================================
// HELPER: GET FIRESTORE WITH NULL CHECK
// ============================================

function getDb() {
    if (!db) {
        throw new Error('Firebase is not initialized. This can only be called in the browser.');
    }
    return db;
}

// ============================================
// COLLECTION NAMES
// ============================================

const COLLECTIONS = {
    PROJECTS: 'projects',
    PRODUCTS: 'products',
    MATERIALS_DB: 'materials',
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
    NOTIFICATIONS: 'notifications',
    PRODUCTION_SNAPSHOTS: 'production_snapshots',
};

// ============================================
// HELPER FUNCTIONS
// ============================================

export function generateUUID(): string {
    return uuidv4();
}

export function generateOfferNumber(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `P-${year}${month}${day}-${random}`;
}

export function generateOrderNumber(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `N-${year}${month}${day}-${random}`;
}

// ============================================
// GET ALL DATA (Optimized single fetch with multi-tenancy)
// ============================================

export async function getAllData(organizationId: string): Promise<AppState> {
    if (!organizationId) {
        console.error('getAllData: organizationId is required for multi-tenancy');
        return {
            projects: [],
            products: [],
            materials: [],
            suppliers: [],
            workers: [],
            offers: [],
            orders: [],
            workOrders: [],
            productMaterials: [],
            glassItems: [],
            aluDoorItems: [],
            workLogs: [],
            tasks: [],
        };
    }

    try {
        // All queries filter by Organization_ID for multi-tenancy security
        const orgFilter = where('Organization_ID', '==', organizationId);

        const [
            projectsSnap,
            productsSnap,
            materialsSnap,
            suppliersSnap,
            workersSnap,
            offersSnap,
            ordersSnap,
            productMaterialsSnap,
            orderItemsSnap,
            glassItemsSnap,
            aluDoorItemsSnap,
            offerProductsSnap,
            offerExtrasSnap,
            workOrdersSnap,
            workOrderItemsSnap,
            workLogsSnap,
            tasksSnap,
        ] = await Promise.all([
            getDocs(query(collection(db, COLLECTIONS.PROJECTS), orgFilter)),
            getDocs(query(collection(db, COLLECTIONS.PRODUCTS), orgFilter)),
            getDocs(query(collection(db, COLLECTIONS.MATERIALS_DB), orgFilter)),
            getDocs(query(collection(db, COLLECTIONS.SUPPLIERS), orgFilter)),
            getDocs(query(collection(db, COLLECTIONS.WORKERS), orgFilter)),
            getDocs(query(collection(db, COLLECTIONS.OFFERS), orgFilter)),
            getDocs(query(collection(db, COLLECTIONS.ORDERS), orgFilter)),
            getDocs(query(collection(db, COLLECTIONS.PRODUCT_MATERIALS), orgFilter)),
            getDocs(query(collection(db, COLLECTIONS.ORDER_ITEMS), orgFilter)),
            getDocs(query(collection(db, COLLECTIONS.GLASS_ITEMS), orgFilter)),
            getDocs(query(collection(db, COLLECTIONS.ALU_DOOR_ITEMS), orgFilter)),
            getDocs(query(collection(db, COLLECTIONS.OFFER_PRODUCTS), orgFilter)),
            getDocs(query(collection(db, COLLECTIONS.OFFER_EXTRAS), orgFilter)),
            getDocs(query(collection(db, COLLECTIONS.WORK_ORDERS), orgFilter)),
            getDocs(query(collection(db, COLLECTIONS.WORK_ORDER_ITEMS), orgFilter)),
            getDocs(query(collection(db, COLLECTIONS.WORK_LOGS), orgFilter)),
            getDocs(query(collection(db, COLLECTIONS.TASKS), orgFilter)),
        ]);

        const projects = projectsSnap.docs.map(doc => ({ ...doc.data() } as Project));
        const products = productsSnap.docs.map(doc => ({ ...doc.data() } as Product));
        const materials = materialsSnap.docs.map(doc => ({ ...doc.data() } as Material));
        const suppliers = suppliersSnap.docs.map(doc => ({ ...doc.data() } as Supplier));
        const workers = workersSnap.docs.map(doc => ({ ...doc.data() } as Worker));
        const offers = offersSnap.docs.map(doc => ({ ...doc.data() } as Offer));
        const orders = ordersSnap.docs.map(doc => ({ ...doc.data() } as Order));
        const productMaterials = productMaterialsSnap.docs.map(doc => ({ ...doc.data() } as ProductMaterial));
        const orderItems = orderItemsSnap.docs.map(doc => ({ ...doc.data() } as OrderItem));
        const glassItems = glassItemsSnap.docs.map(doc => ({ ...doc.data() } as GlassItem));
        const aluDoorItems = aluDoorItemsSnap.docs.map(doc => ({ ...doc.data() } as AluDoorItem));
        const offerProducts = offerProductsSnap.docs.map(doc => ({ ...doc.data() } as OfferProduct));
        const offerExtras = offerExtrasSnap.docs.map(doc => ({ ...doc.data() } as OfferExtra));
        const workOrders = workOrdersSnap.docs.map(doc => ({ ...doc.data() } as WorkOrder));
        const workLogs = workLogsSnap.docs.map(doc => ({ ...doc.data() } as WorkLog));
        const workOrderItems = workOrderItemsSnap.docs.map(doc => ({ ...doc.data() } as WorkOrderItem));
        const tasks = tasksSnap.docs.map(doc => ({ ...doc.data() } as Task));

        // ============================================
        // OPTIMIZATION: Build Maps for O(1) lookups instead of O(n²) filters
        // ============================================

        // Group glass items by Product_Material_ID
        const glassItemsByMaterial = new Map<string, GlassItem[]>();
        glassItems.forEach(gi => {
            const key = gi.Product_Material_ID;
            if (!glassItemsByMaterial.has(key)) glassItemsByMaterial.set(key, []);
            glassItemsByMaterial.get(key)!.push(gi);
        });

        // Group alu door items by Product_Material_ID
        const aluDoorItemsByMaterial = new Map<string, AluDoorItem[]>();
        aluDoorItems.forEach(adi => {
            const key = adi.Product_Material_ID;
            if (!aluDoorItemsByMaterial.has(key)) aluDoorItemsByMaterial.set(key, []);
            aluDoorItemsByMaterial.get(key)!.push(adi);
        });

        // Group product materials by Product_ID
        const materialsByProduct = new Map<string, ProductMaterial[]>();
        productMaterials.forEach(pm => {
            // Attach glass/alu items using pre-built maps (O(1) lookup)
            pm.glassItems = glassItemsByMaterial.get(pm.ID) || [];
            pm.aluDoorItems = aluDoorItemsByMaterial.get(pm.ID) || [];

            const key = pm.Product_ID;
            if (!materialsByProduct.has(key)) materialsByProduct.set(key, []);
            materialsByProduct.get(key)!.push(pm);
        });

        // Group products by Project_ID
        const productsByProject = new Map<string, Product[]>();
        products.forEach(p => {
            // Attach materials using pre-built map (O(1) lookup)
            p.materials = materialsByProduct.get(p.Product_ID) || [];

            const key = p.Project_ID;
            if (!productsByProject.has(key)) productsByProject.set(key, []);
            productsByProject.get(key)!.push(p);
        });

        // Group offers by Project_ID
        const offersByProject = new Map<string, Offer[]>();
        offers.forEach(o => {
            const key = o.Project_ID;
            if (!offersByProject.has(key)) offersByProject.set(key, []);
            offersByProject.get(key)!.push(o);
        });

        // Group offer products by Offer_ID
        const offerProductsByOffer = new Map<string, OfferProduct[]>();
        offerProducts.forEach(op => {
            const key = op.Offer_ID;
            if (!offerProductsByOffer.has(key)) offerProductsByOffer.set(key, []);
            offerProductsByOffer.get(key)!.push(op);
        });

        // Group offer extras by Offer_Product_ID
        const extrasByOfferProduct = new Map<string, OfferExtra[]>();
        offerExtras.forEach(e => {
            const key = e.Offer_Product_ID;
            if (!extrasByOfferProduct.has(key)) extrasByOfferProduct.set(key, []);
            extrasByOfferProduct.get(key)!.push(e);
        });

        // Group order items by Order_ID
        const itemsByOrder = new Map<string, OrderItem[]>();
        orderItems.forEach(item => {
            const key = item.Order_ID;
            if (!itemsByOrder.has(key)) itemsByOrder.set(key, []);
            itemsByOrder.get(key)!.push(item);
        });

        // Group work order items by Work_Order_ID
        const itemsByWorkOrder = new Map<string, WorkOrderItem[]>();
        workOrderItems.forEach(item => {
            const key = item.Work_Order_ID;
            if (!itemsByWorkOrder.has(key)) itemsByWorkOrder.set(key, []);
            itemsByWorkOrder.get(key)!.push(item);
        });

        // Build projects map for quick lookup
        const projectsMap = new Map<string, Project>();
        projects.forEach(p => projectsMap.set(p.Project_ID, p));

        // ============================================
        // Attach related data using O(1) Map lookups
        // ============================================

        // Attach products and offers to projects
        projects.forEach(project => {
            project.products = productsByProject.get(project.Project_ID) || [];
            project.offers = offersByProject.get(project.Project_ID) || [];
        });

        // Add client info and products to offers
        offers.forEach(offer => {
            const project = projectsMap.get(offer.Project_ID);
            if (project) {
                offer.Client_Name = project.Client_Name;
            }
            // Attach offer products with their extras
            const prods = offerProductsByOffer.get(offer.Offer_ID) || [];
            prods.forEach(prod => {
                (prod as any).extras = extrasByOfferProduct.get(prod.ID) || [];
            });
            (offer as any).products = prods;
        });

        // Attach items to orders
        orders.forEach(order => {
            order.items = itemsByOrder.get(order.Order_ID) || [];
        });

        // Attach items to work orders
        workOrders.forEach(wo => {
            wo.items = itemsByWorkOrder.get(wo.Work_Order_ID) || [];
        });

        return {
            projects,
            products,
            materials,
            suppliers,
            workers,
            offers,
            orders,
            workOrders,
            productMaterials,
            glassItems,
            aluDoorItems,
            workLogs,
            tasks,
        };
    } catch (error) {
        console.error('getAllData error:', error);
        return {
            projects: [],
            products: [],
            materials: [],
            suppliers: [],
            workers: [],
            offers: [],
            orders: [],
            workOrders: [],
            productMaterials: [],
            glassItems: [],
            aluDoorItems: [],
            workLogs: [],
            tasks: [],
        };
    }
}

// ============================================
// PROJECTS CRUD (Multi-tenancy enabled)
// ============================================

export async function getProjects(organizationId: string): Promise<Project[]> {
    if (!organizationId) return [];
    const q = query(collection(db, COLLECTIONS.PROJECTS), where('Organization_ID', '==', organizationId));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ ...doc.data() } as Project));
}

export async function getProject(projectId: string, organizationId: string): Promise<Project | null> {
    if (!organizationId) return null;
    const q = query(
        collection(db, COLLECTIONS.PROJECTS),
        where('Project_ID', '==', projectId),
        where('Organization_ID', '==', organizationId)
    );
    const snapshot = await getDocs(q);
    if (snapshot.empty) return null;

    const project = snapshot.docs[0].data() as Project;
    project.products = await getProductsByProject(projectId, organizationId);
    return project;
}

export async function saveProject(data: Partial<Project>, organizationId: string): Promise<{ success: boolean; data?: { Project_ID: string }; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        const isNew = !data.Project_ID;

        if (isNew) {
            data.Project_ID = generateUUID();
            data.Organization_ID = organizationId;  // Set organization for new projects
            data.Created_Date = new Date().toISOString();
            data.Status = data.Status || 'Nacrt';
            await addDoc(collection(db, COLLECTIONS.PROJECTS), data);
        } else {
            // Verify project belongs to this organization before updating
            const q = query(
                collection(db, COLLECTIONS.PROJECTS),
                where('Project_ID', '==', data.Project_ID),
                where('Organization_ID', '==', organizationId)
            );
            const snapshot = await getDocs(q);
            if (!snapshot.empty) {
                // Don't allow changing Organization_ID
                const { Organization_ID, ...updateData } = data;
                await updateDoc(snapshot.docs[0].ref, updateData as Record<string, unknown>);
            } else {
                return { success: false, message: 'Projekat nije pronađen ili nemate pristup' };
            }
        }

        return { success: true, data: { Project_ID: data.Project_ID! }, message: isNew ? 'Projekat kreiran' : 'Projekat ažuriran' };
    } catch (error) {
        console.error('saveProject error:', error);
        return { success: false, message: 'Greška pri spremanju projekta' };
    }
}

export async function deleteProject(projectId: string, organizationId: string): Promise<{ success: boolean; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        // Delete all related products first
        const products = await getProductsByProject(projectId, organizationId);
        for (const product of products) {
            await deleteProduct(product.Product_ID, organizationId);
        }

        // Delete project (with organization check)
        const q = query(
            collection(db, COLLECTIONS.PROJECTS),
            where('Project_ID', '==', projectId),
            where('Organization_ID', '==', organizationId)
        );
        const snapshot = await getDocs(q);
        if (!snapshot.empty) {
            await deleteDoc(snapshot.docs[0].ref);
        }

        return { success: true, message: 'Projekat obrisan' };
    } catch (error) {
        console.error('deleteProject error:', error);
        return { success: false, message: 'Greška pri brisanju projekta' };
    }
}

export async function updateProjectStatus(projectId: string, status: string, organizationId: string): Promise<{ success: boolean; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        const q = query(
            collection(db, COLLECTIONS.PROJECTS),
            where('Project_ID', '==', projectId),
            where('Organization_ID', '==', organizationId)
        );
        const snapshot = await getDocs(q);
        if (!snapshot.empty) {
            await updateDoc(snapshot.docs[0].ref, { Status: status });
        }
        return { success: true, message: 'Status ažuriran' };
    } catch (error) {
        console.error('updateProjectStatus error:', error);
        return { success: false, message: 'Greška pri ažuriranju statusa' };
    }
}

// ============================================
// PRODUCTS CRUD (Multi-tenancy enabled)
// ============================================

export async function getProductsByProject(projectId: string, organizationId: string): Promise<Product[]> {
    if (!organizationId) return [];
    const q = query(
        collection(db, COLLECTIONS.PRODUCTS),
        where('Project_ID', '==', projectId),
        where('Organization_ID', '==', organizationId)
    );
    const snapshot = await getDocs(q);

    const products = snapshot.docs.map(doc => ({ ...doc.data() } as Product));

    if (products.length === 0) {
        return products;
    }

    // PERFORMANCE FIX: Fetch all materials for all products in one query instead of N queries
    // Firestore 'in' query is limited to 30 items, so we batch if needed
    const productIds = products.map(p => p.Product_ID);
    const materialsByProduct = new Map<string, ProductMaterial[]>();

    // Batch product IDs into chunks of 30 (Firestore limit)
    const batchSize = 30;
    for (let i = 0; i < productIds.length; i += batchSize) {
        const batchIds = productIds.slice(i, i + batchSize);
        const materialsQ = query(
            collection(db, COLLECTIONS.PRODUCT_MATERIALS),
            where('Product_ID', 'in', batchIds),
            where('Organization_ID', '==', organizationId)
        );
        const materialsSnap = await getDocs(materialsQ);

        materialsSnap.docs.forEach(doc => {
            const mat = doc.data() as ProductMaterial;
            if (!materialsByProduct.has(mat.Product_ID)) {
                materialsByProduct.set(mat.Product_ID, []);
            }
            materialsByProduct.get(mat.Product_ID)!.push(mat);
        });
    }

    // Assign materials to products using the map (O(1) lookup)
    products.forEach(product => {
        product.materials = materialsByProduct.get(product.Product_ID) || [];
    });

    return products;
}

export async function getProduct(productId: string, organizationId: string): Promise<Product | null> {
    if (!organizationId) return null;
    const q = query(
        collection(db, COLLECTIONS.PRODUCTS),
        where('Product_ID', '==', productId),
        where('Organization_ID', '==', organizationId)
    );
    const snapshot = await getDocs(q);
    if (snapshot.empty) return null;

    const product = snapshot.docs[0].data() as Product;
    product.materials = await getProductMaterials(productId, organizationId);
    return product;
}

export async function saveProduct(data: Partial<Product>, organizationId: string): Promise<{ success: boolean; data?: { Product_ID: string }; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        const isNew = !data.Product_ID;

        if (isNew) {
            data.Product_ID = generateUUID();
            data.Organization_ID = organizationId;
            data.Status = data.Status || 'Na čekanju';
            data.Material_Cost = 0;
            await addDoc(collection(db, COLLECTIONS.PRODUCTS), data);
        } else {
            const q = query(
                collection(db, COLLECTIONS.PRODUCTS),
                where('Product_ID', '==', data.Product_ID),
                where('Organization_ID', '==', organizationId)
            );
            const snapshot = await getDocs(q);
            if (!snapshot.empty) {
                const { Organization_ID, ...updateData } = data;
                await updateDoc(snapshot.docs[0].ref, updateData as Record<string, unknown>);
            }
        }

        return { success: true, data: { Product_ID: data.Product_ID! }, message: isNew ? 'Proizvod kreiran' : 'Proizvod ažuriran' };
    } catch (error) {
        console.error('saveProduct error:', error);
        return { success: false, message: 'Greška pri spremanju proizvoda' };
    }
}

export async function deleteProduct(productId: string, organizationId: string): Promise<{ success: boolean; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        // Delete all related materials first
        await deleteProductMaterials(productId, organizationId);

        // Delete product
        const q = query(
            collection(db, COLLECTIONS.PRODUCTS),
            where('Product_ID', '==', productId),
            where('Organization_ID', '==', organizationId)
        );
        const snapshot = await getDocs(q);
        if (!snapshot.empty) {
            await deleteDoc(snapshot.docs[0].ref);
        }

        return { success: true, message: 'Proizvod obrisan' };
    } catch (error) {
        console.error('deleteProduct error:', error);
        return { success: false, message: 'Greška pri brisanju proizvoda' };
    }
}

export async function updateProductStatus(productId: string, status: string, organizationId: string): Promise<{ success: boolean; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        const q = query(
            collection(db, COLLECTIONS.PRODUCTS),
            where('Product_ID', '==', productId),
            where('Organization_ID', '==', organizationId)
        );
        const snapshot = await getDocs(q);
        if (!snapshot.empty) {
            await updateDoc(snapshot.docs[0].ref, { Status: status });
        }
        return { success: true, message: 'Status ažuriran' };
    } catch (error) {
        console.error('updateProductStatus error:', error);
        return { success: false, message: 'Greška pri ažuriranju statusa' };
    }
}

export async function recalculateProductCost(productId: string, organizationId: string): Promise<number> {
    if (!organizationId) return 0;

    const materials = await getProductMaterials(productId, organizationId);
    const totalCost = materials.reduce((sum, m) => sum + (m.Total_Price || 0), 0);

    const q = query(
        collection(db, COLLECTIONS.PRODUCTS),
        where('Product_ID', '==', productId),
        where('Organization_ID', '==', organizationId)
    );
    const snapshot = await getDocs(q);
    if (!snapshot.empty) {
        await updateDoc(snapshot.docs[0].ref, { Material_Cost: totalCost });
    }

    // SYNC: Propagate material cost change to active work orders
    // recalculateWorkOrder fetches fresh material costs, so just trigger it
    try {
        const woItemsQ = query(
            collection(db, COLLECTIONS.WORK_ORDER_ITEMS),
            where('Product_ID', '==', productId),
            where('Organization_ID', '==', organizationId)
        );
        const woItemsSnap = await getDocs(woItemsQ);
        const woIds = new Set<string>();
        woItemsSnap.docs.forEach(d => {
            const woId = d.data().Work_Order_ID;
            if (woId) woIds.add(woId);
        });

        if (woIds.size > 0) {
            const { recalculateWorkOrder } = await import('./attendance');
            for (const woId of Array.from(woIds)) {
                await recalculateWorkOrder(woId);
            }
        }
    } catch (err) {
        console.warn('recalculateProductCost: WO sync failed (non-critical):', err);
    }

    return totalCost;
}

// ============================================
// PRODUCT MATERIALS CRUD (Multi-tenancy enabled)
// ============================================

export async function getProductMaterials(productId: string, organizationId: string): Promise<ProductMaterial[]> {
    if (!organizationId) return [];
    const q = query(
        collection(db, COLLECTIONS.PRODUCT_MATERIALS),
        where('Product_ID', '==', productId),
        where('Organization_ID', '==', organizationId)
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ ...doc.data() } as ProductMaterial));
}

export async function addMaterialToProduct(data: Partial<ProductMaterial>, organizationId: string): Promise<{ success: boolean; data?: { ID: string }; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        const quantity = data.Quantity || 0;
        const unitPrice = data.Unit_Price || 0;
        data.Total_Price = quantity * unitPrice;

        if (!data.ID) {
            data.ID = generateUUID();
            data.Organization_ID = organizationId;
            data.Status = data.Status || 'Nije naručeno';
        }

        await addDoc(collection(db, COLLECTIONS.PRODUCT_MATERIALS), data);

        if (data.Product_ID) {
            await recalculateProductCost(data.Product_ID, organizationId);
        }

        return { success: true, data: { ID: data.ID }, message: 'Materijal dodan' };
    } catch (error) {
        console.error('addMaterialToProduct error:', error);
        return { success: false, message: 'Greška pri dodavanju materijala' };
    }
}

// Batch update material statuses — much faster than calling updateProductMaterial per material
export async function batchUpdateMaterialStatuses(
    updates: { materialId: string; status: string; orderId: string }[],
    organizationId: string
): Promise<{ success: boolean; message: string }> {
    if (!organizationId || updates.length === 0) {
        return { success: true, message: 'Ništa za ažurirati' };
    }

    try {
        // Firestore 'in' queries support max 30 items, so chunk if needed
        const chunkSize = 30;
        const affectedProductIds = new Set<string>();

        for (let i = 0; i < updates.length; i += chunkSize) {
            const chunk = updates.slice(i, i + chunkSize);
            const materialIds = chunk.map(u => u.materialId);

            const q = query(
                collection(db, COLLECTIONS.PRODUCT_MATERIALS),
                where('ID', 'in', materialIds),
                where('Organization_ID', '==', organizationId)
            );
            const snapshot = await getDocs(q);

            if (snapshot.empty) continue;

            // Build a lookup for the updates
            const updateMap = new Map(chunk.map(u => [u.materialId, u]));

            const batch = writeBatch(db);
            snapshot.docs.forEach(docSnap => {
                const data = docSnap.data() as ProductMaterial;
                const upd = updateMap.get(data.ID);
                if (upd) {
                    batch.update(docSnap.ref, { Status: upd.status, Order_ID: upd.orderId });
                    if (data.Product_ID) affectedProductIds.add(data.Product_ID);
                }
            });
            await batch.commit();
        }

        // Recalculate product costs once per affected product (not per material)
        for (const productId of Array.from(affectedProductIds)) {
            await recalculateProductCost(productId, organizationId);
        }

        return { success: true, message: 'Statusi materijala ažurirani' };
    } catch (error) {
        console.error('batchUpdateMaterialStatuses error:', error);
        return { success: false, message: 'Greška pri ažuriranju statusa materijala' };
    }
}

export async function updateProductMaterial(materialId: string, data: Partial<ProductMaterial>, organizationId: string): Promise<{ success: boolean; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        const q = query(
            collection(db, COLLECTIONS.PRODUCT_MATERIALS),
            where('ID', '==', materialId),
            where('Organization_ID', '==', organizationId)
        );
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            return { success: false, message: 'Materijal nije pronađen' };
        }

        const existing = snapshot.docs[0].data() as ProductMaterial;
        const merged = { ...existing, ...data };

        const quantity = merged.Quantity || 0;
        const unitPrice = merged.Unit_Price || 0;
        merged.Total_Price = quantity * unitPrice;

        const { Organization_ID, ...updateData } = merged;
        await updateDoc(snapshot.docs[0].ref, updateData as Record<string, unknown>);

        if (merged.Product_ID) {
            await recalculateProductCost(merged.Product_ID, organizationId);
        }

        return { success: true, message: 'Materijal ažuriran' };
    } catch (error) {
        console.error('updateProductMaterial error:', error);
        return { success: false, message: 'Greška pri ažuriranju materijala' };
    }
}

export async function deleteProductMaterial(materialId: string, organizationId: string): Promise<{ success: boolean; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        const q = query(
            collection(db, COLLECTIONS.PRODUCT_MATERIALS),
            where('ID', '==', materialId),
            where('Organization_ID', '==', organizationId)
        );
        const snapshot = await getDocs(q);

        if (!snapshot.empty) {
            const productId = snapshot.docs[0].data().Product_ID;
            await deleteDoc(snapshot.docs[0].ref);

            if (productId) {
                await recalculateProductCost(productId, organizationId);
            }
        }

        return { success: true, message: 'Materijal obrisan' };
    } catch (error) {
        console.error('deleteProductMaterial error:', error);
        return { success: false, message: 'Greška pri brisanju materijala' };
    }
}

export async function deleteProductMaterials(productId: string, organizationId: string): Promise<void> {
    if (!organizationId) return;
    const q = query(
        collection(db, COLLECTIONS.PRODUCT_MATERIALS),
        where('Product_ID', '==', productId),
        where('Organization_ID', '==', organizationId)
    );
    const snapshot = await getDocs(q);

    const batch = writeBatch(db);
    snapshot.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
}

// ============================================
// MATERIALS DATABASE CRUD (Multi-tenancy enabled)
// ============================================

export async function getMaterialsCatalog(organizationId: string): Promise<Material[]> {
    if (!organizationId) return [];
    const q = query(collection(db, COLLECTIONS.MATERIALS_DB), where('Organization_ID', '==', organizationId));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ ...doc.data() } as Material));
}

export async function saveMaterial(data: Partial<Material>, organizationId: string): Promise<{ success: boolean; data?: { Material_ID: string }; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        const isNew = !data.Material_ID;

        if (isNew) {
            data.Material_ID = generateUUID();
            data.Organization_ID = organizationId;
            await addDoc(collection(db, COLLECTIONS.MATERIALS_DB), data);
        } else {
            const q = query(
                collection(db, COLLECTIONS.MATERIALS_DB),
                where('Material_ID', '==', data.Material_ID),
                where('Organization_ID', '==', organizationId)
            );
            const snapshot = await getDocs(q);
            if (!snapshot.empty) {
                const { Organization_ID, ...updateData } = data;
                await updateDoc(snapshot.docs[0].ref, updateData as Record<string, unknown>);
            }
        }

        return { success: true, data: { Material_ID: data.Material_ID! }, message: isNew ? 'Materijal kreiran' : 'Materijal ažuriran' };
    } catch (error) {
        console.error('saveMaterial error:', error);
        return { success: false, message: 'Greška pri spremanju materijala' };
    }
}

export async function deleteMaterial(materialId: string, organizationId: string): Promise<{ success: boolean; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        const q = query(
            collection(db, COLLECTIONS.MATERIALS_DB),
            where('Material_ID', '==', materialId),
            where('Organization_ID', '==', organizationId)
        );
        const snapshot = await getDocs(q);
        if (!snapshot.empty) {
            await deleteDoc(snapshot.docs[0].ref);
        }
        return { success: true, message: 'Materijal obrisan' };
    } catch (error) {
        console.error('deleteMaterial error:', error);
        return { success: false, message: 'Greška pri brisanju materijala' };
    }
}

export async function deleteDuplicateMaterials(organizationId: string): Promise<{ success: boolean; deletedCount: number; message: string }> {
    if (!organizationId) {
        return { success: false, deletedCount: 0, message: 'Organization ID is required' };
    }

    try {
        const materials = await getMaterialsCatalog(organizationId);

        // Group materials by Name + Default_Unit_Price
        const groupedMaterials = new Map<string, Material[]>();

        materials.forEach(mat => {
            const key = `${mat.Name.toLowerCase().trim()}|${mat.Default_Unit_Price || 0}`;
            if (!groupedMaterials.has(key)) {
                groupedMaterials.set(key, []);
            }
            groupedMaterials.get(key)!.push(mat);
        });

        // Find duplicates (groups with more than 1 material)
        let deletedCount = 0;
        const batch = writeBatch(db);

        for (const [, group] of Array.from(groupedMaterials)) {
            if (group.length > 1) {
                // Keep the first one, delete the rest
                for (let i = 1; i < group.length; i++) {
                    const q = query(
                        collection(db, COLLECTIONS.MATERIALS_DB),
                        where('Material_ID', '==', group[i].Material_ID),
                        where('Organization_ID', '==', organizationId)
                    );
                    const snapshot = await getDocs(q);
                    if (!snapshot.empty) {
                        batch.delete(snapshot.docs[0].ref);
                        deletedCount++;
                    }
                }
            }
        }

        if (deletedCount > 0) {
            await batch.commit();
        }

        return {
            success: true,
            deletedCount,
            message: deletedCount > 0
                ? `Obrisano ${deletedCount} duplikata`
                : 'Nema duplikata za brisanje'
        };
    } catch (error) {
        console.error('deleteDuplicateMaterials error:', error);
        return { success: false, deletedCount: 0, message: 'Greška pri brisanju duplikata' };
    }
}

// ============================================
// SUPPLIERS CRUD (Multi-tenancy enabled)
// ============================================

export async function getSuppliers(organizationId: string): Promise<Supplier[]> {
    if (!organizationId) return [];
    const q = query(collection(db, COLLECTIONS.SUPPLIERS), where('Organization_ID', '==', organizationId));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ ...doc.data() } as Supplier));
}

export async function saveSupplier(data: Partial<Supplier>, organizationId: string): Promise<{ success: boolean; data?: { Supplier_ID: string }; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        const isNew = !data.Supplier_ID;

        if (isNew) {
            data.Supplier_ID = generateUUID();
            data.Organization_ID = organizationId;
            await addDoc(collection(db, COLLECTIONS.SUPPLIERS), data);
        } else {
            const q = query(
                collection(db, COLLECTIONS.SUPPLIERS),
                where('Supplier_ID', '==', data.Supplier_ID),
                where('Organization_ID', '==', organizationId)
            );
            const snapshot = await getDocs(q);
            if (!snapshot.empty) {
                const { Organization_ID, ...updateData } = data;
                await updateDoc(snapshot.docs[0].ref, updateData as Record<string, unknown>);
            }
        }

        return { success: true, data: { Supplier_ID: data.Supplier_ID! }, message: isNew ? 'Dobavljač kreiran' : 'Dobavljač ažuriran' };
    } catch (error) {
        console.error('saveSupplier error:', error);
        return { success: false, message: 'Greška pri spremanju dobavljača' };
    }
}

export async function deleteSupplier(supplierId: string, organizationId: string): Promise<{ success: boolean; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        const q = query(
            collection(db, COLLECTIONS.SUPPLIERS),
            where('Supplier_ID', '==', supplierId),
            where('Organization_ID', '==', organizationId)
        );
        const snapshot = await getDocs(q);
        if (!snapshot.empty) {
            await deleteDoc(snapshot.docs[0].ref);
        }
        return { success: true, message: 'Dobavljač obrisan' };
    } catch (error) {
        console.error('deleteSupplier error:', error);
        return { success: false, message: 'Greška pri brisanju dobavljača' };
    }
}

// ============================================
// WORKERS CRUD (Multi-tenancy enabled)
// ============================================

export async function getWorkers(organizationId: string): Promise<Worker[]> {
    if (!organizationId) return [];
    const q = query(collection(db, COLLECTIONS.WORKERS), where('Organization_ID', '==', organizationId));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ ...doc.data() } as Worker));
}

export async function saveWorker(data: Partial<Worker>, organizationId: string): Promise<{ success: boolean; data?: { Worker_ID: string }; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        const isNew = !data.Worker_ID;

        if (isNew) {
            data.Worker_ID = generateUUID();
            data.Organization_ID = organizationId;
            data.Status = data.Status || 'Dostupan';
            await addDoc(collection(db, COLLECTIONS.WORKERS), data);
        } else {
            const q = query(
                collection(db, COLLECTIONS.WORKERS),
                where('Worker_ID', '==', data.Worker_ID),
                where('Organization_ID', '==', organizationId)
            );
            const snapshot = await getDocs(q);
            if (!snapshot.empty) {
                const { Organization_ID, ...updateData } = data;
                await updateDoc(snapshot.docs[0].ref, updateData as Record<string, unknown>);
            }
        }

        return { success: true, data: { Worker_ID: data.Worker_ID! }, message: isNew ? 'Radnik kreiran' : 'Radnik ažuriran' };
    } catch (error) {
        console.error('saveWorker error:', error);
        return { success: false, message: 'Greška pri spremanju radnika' };
    }
}

export async function deleteWorker(workerId: string, organizationId: string): Promise<{ success: boolean; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        const q = query(
            collection(db, COLLECTIONS.WORKERS),
            where('Worker_ID', '==', workerId),
            where('Organization_ID', '==', organizationId)
        );
        const snapshot = await getDocs(q);
        if (!snapshot.empty) {
            await deleteDoc(snapshot.docs[0].ref);
        }
        return { success: true, message: 'Radnik obrisan' };
    } catch (error) {
        console.error('deleteWorker error:', error);
        return { success: false, message: 'Greška pri brisanju radnika' };
    }
}

// ============================================
// OFFERS CRUD (Multi-tenancy enabled)
// ============================================

export async function getOffers(organizationId: string): Promise<Offer[]> {
    if (!organizationId) return [];
    const q = query(collection(db, COLLECTIONS.OFFERS), where('Organization_ID', '==', organizationId));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ ...doc.data() } as Offer));
}

export async function getOffer(offerId: string, organizationId: string): Promise<Offer | null> {
    if (!organizationId) return null;

    // Fetch offer, products, extras, and project in parallel for better performance
    const [offerSnap, productsSnap, extrasSnap] = await Promise.all([
        getDocs(query(
            collection(db, COLLECTIONS.OFFERS),
            where('Offer_ID', '==', offerId),
            where('Organization_ID', '==', organizationId)
        )),
        getDocs(query(
            collection(db, COLLECTIONS.OFFER_PRODUCTS),
            where('Offer_ID', '==', offerId),
            where('Organization_ID', '==', organizationId)
        )),
        getDocs(query(
            collection(db, COLLECTIONS.OFFER_EXTRAS),
            where('Organization_ID', '==', organizationId)
        )),
    ]);

    if (offerSnap.empty) return null;

    const offer = offerSnap.docs[0].data() as Offer;

    // Get products and attach extras directly from already-fetched data
    const allExtras = extrasSnap.docs.map(doc => ({ ...doc.data() } as OfferExtra));
    const products = productsSnap.docs.map(doc => {
        const product = { ...doc.data() } as OfferProduct;
        product.extras = allExtras.filter(e => e.Offer_Product_ID === product.ID);
        return product;
    });
    offer.products = products;

    // Fetch project for client name (just the project, not its products)
    const projectSnap = await getDocs(query(
        collection(db, COLLECTIONS.PROJECTS),
        where('Project_ID', '==', offer.Project_ID),
        where('Organization_ID', '==', organizationId)
    ));
    if (!projectSnap.empty) {
        offer.Client_Name = projectSnap.docs[0].data().Client_Name;
    }

    return offer;
}

export async function getOfferProducts(offerId: string, organizationId: string): Promise<OfferProduct[]> {
    if (!organizationId) return [];

    // Fetch products and all extras in parallel
    const [productsSnap, extrasSnap] = await Promise.all([
        getDocs(query(
            collection(db, COLLECTIONS.OFFER_PRODUCTS),
            where('Offer_ID', '==', offerId),
            where('Organization_ID', '==', organizationId)
        )),
        getDocs(query(
            collection(db, COLLECTIONS.OFFER_EXTRAS),
            where('Organization_ID', '==', organizationId)
        )),
    ]);

    const allExtras = extrasSnap.docs.map(doc => ({ ...doc.data() } as OfferExtra));
    const products = productsSnap.docs.map(doc => {
        const product = { ...doc.data() } as OfferProduct;
        product.extras = allExtras.filter(e => e.Offer_Product_ID === product.ID);
        return product;
    });

    return products;
}

export async function getOfferProductExtras(offerProductId: string, organizationId: string): Promise<OfferExtra[]> {
    if (!organizationId) return [];

    const q = query(
        collection(db, COLLECTIONS.OFFER_EXTRAS),
        where('Offer_Product_ID', '==', offerProductId),
        where('Organization_ID', '==', organizationId)
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ ...doc.data() } as OfferExtra));
}

export async function createOfferWithProducts(offerData: any, organizationId: string): Promise<{ success: boolean; data?: { Offer_ID: string; Offer_Number: string }; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        const offerId = generateUUID();
        const offerNumber = generateOfferNumber();

        const products = offerData.products || [];
        const includedProducts = products.filter((p: any) => p.Included);
        if (includedProducts.length === 0) {
            return { success: false, message: 'Označite barem jedan proizvod' };
        }

        // Calculate subtotal including extras and labor
        let subtotal = 0;
        includedProducts.forEach((p: any) => {
            const materialCost = parseFloat(p.Material_Cost) || 0;
            const margin = parseFloat(p.Margin) || 0;
            const extrasTotal = (p.Extras || []).reduce((sum: number, e: any) => sum + (parseFloat(e.total) || 0), 0);
            const laborTotal = (parseFloat(p.Labor_Workers) || 0) * (parseFloat(p.Labor_Days) || 0) * (parseFloat(p.Labor_Daily_Rate) || 0);
            const quantity = parseFloat(p.Quantity) || 1;
            subtotal += (materialCost + margin + extrasTotal + laborTotal) * quantity;
        });

        const transportCost = parseFloat(offerData.Transport_Cost) || 0;
        const discount = offerData.Onsite_Assembly ? (parseFloat(offerData.Onsite_Discount) || 0) : 0;
        const total = subtotal + transportCost - discount;

        // Parse valid until date
        let validUntil = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
        if (offerData.Valid_Until) {
            validUntil = new Date(offerData.Valid_Until).toISOString();
        }

        const offer: Offer = {
            Offer_ID: offerId,
            Organization_ID: organizationId,
            Project_ID: offerData.Project_ID,
            Offer_Number: offerNumber,
            Created_Date: new Date().toISOString(),
            Valid_Until: validUntil,
            Status: 'Nacrt',
            Transport_Cost: transportCost,
            Onsite_Assembly: offerData.Onsite_Assembly || false,
            Onsite_Discount: offerData.Onsite_Discount || 0,
            Subtotal: subtotal,
            Total: total,
            Notes: offerData.Notes || '',
            Accepted_Date: '',
            Include_PDV: offerData.Include_PDV ?? true,
            PDV_Rate: offerData.PDV_Rate ?? 17,
        };

        await addDoc(collection(db, COLLECTIONS.OFFERS), offer);

        // Add products and their extras
        for (const product of products) {
            const productId = generateUUID();
            const materialCost = parseFloat(product.Material_Cost) || 0;
            const margin = parseFloat(product.Margin) || 0;
            const extrasTotal = (product.Extras || []).reduce((sum: number, e: any) => sum + (parseFloat(e.total) || 0), 0);
            const laborTotal = (parseFloat(product.Labor_Workers) || 0) * (parseFloat(product.Labor_Days) || 0) * (parseFloat(product.Labor_Daily_Rate) || 0);
            const quantity = parseFloat(product.Quantity) || 1;
            const sellingPrice = materialCost + margin + extrasTotal + laborTotal;
            const totalPrice = sellingPrice * quantity;

            const offerProduct: OfferProduct & { Organization_ID: string } = {
                ID: productId,
                Organization_ID: organizationId,
                Offer_ID: offerId,
                Product_ID: product.Product_ID,
                Product_Name: product.Product_Name,
                Quantity: quantity,
                Included: product.Included === true,
                Material_Cost: materialCost,
                Margin: margin,
                Margin_Type: 'Fixed',
                LED_Meters: 0,
                LED_Price: 0,
                LED_Total: 0,
                Grouting: false,
                Grouting_Price: 0,
                Sink_Faucet: false,
                Sink_Faucet_Price: 0,
                Transport_Share: 0,
                Discount_Share: 0,
                Selling_Price: sellingPrice,
                Total_Price: totalPrice,
                Labor_Workers: parseFloat(product.Labor_Workers) || 0,
                Labor_Days: parseFloat(product.Labor_Days) || 0,
                Labor_Daily_Rate: parseFloat(product.Labor_Daily_Rate) || 0,
            };

            await addDoc(collection(db, COLLECTIONS.OFFER_PRODUCTS), offerProduct);

            // Add extras for this product
            for (const extra of product.Extras || []) {
                const extraDoc: OfferExtra & { Organization_ID: string } = {
                    ID: generateUUID(),
                    Organization_ID: organizationId,
                    Offer_Product_ID: productId,
                    Name: extra.name,
                    Quantity: parseFloat(extra.qty) || 1,
                    Unit: extra.unit || 'kom',
                    Unit_Price: parseFloat(extra.price) || 0,
                    Total: parseFloat(extra.total) || 0,
                };

                await addDoc(collection(db, COLLECTIONS.OFFER_EXTRAS), extraDoc);
            }
        }

        return { success: true, data: { Offer_ID: offerId, Offer_Number: offerNumber }, message: 'Ponuda kreirana' };
    } catch (error) {
        console.error('createOfferWithProducts error:', error);
        return { success: false, message: 'Greška pri kreiranju ponude' };
    }
}

export async function saveOffer(data: Partial<Offer>, organizationId: string): Promise<{ success: boolean; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        const q = query(
            collection(db, COLLECTIONS.OFFERS),
            where('Offer_ID', '==', data.Offer_ID),
            where('Organization_ID', '==', organizationId)
        );
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            return { success: false, message: 'Ponuda nije pronađena' };
        }

        const { Organization_ID, ...updateData } = data;
        await updateDoc(snapshot.docs[0].ref, updateData as Record<string, unknown>);
        return { success: true, message: 'Ponuda sačuvana' };
    } catch (error) {
        console.error('saveOffer error:', error);
        return { success: false, message: 'Greška pri spremanju ponude' };
    }
}

export async function updateOfferWithProducts(offerData: any, organizationId: string): Promise<{ success: boolean; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        const offerId = offerData.Offer_ID;
        if (!offerId) {
            return { success: false, message: 'Offer_ID nije definisan' };
        }

        // Find existing offer
        const offerQ = query(
            collection(db, COLLECTIONS.OFFERS),
            where('Offer_ID', '==', offerId),
            where('Organization_ID', '==', organizationId)
        );
        const offerSnap = await getDocs(offerQ);
        if (offerSnap.empty) {
            return { success: false, message: 'Ponuda nije pronađena' };
        }

        const products = offerData.products || [];
        const includedProducts = products.filter((p: any) => p.Included);

        // Calculate subtotal including extras and labor
        let subtotal = 0;
        includedProducts.forEach((p: any) => {
            const materialCost = parseFloat(p.Material_Cost) || 0;
            const margin = parseFloat(p.Margin) || 0;
            const extrasTotal = (p.Extras || []).reduce((sum: number, e: any) => sum + (parseFloat(e.total) || 0), 0);
            const laborTotal = (parseFloat(p.Labor_Workers) || 0) * (parseFloat(p.Labor_Days) || 0) * (parseFloat(p.Labor_Daily_Rate) || 0);
            const quantity = parseFloat(p.Quantity) || 1;
            subtotal += (materialCost + margin + extrasTotal + laborTotal) * quantity;
        });

        const transportCost = parseFloat(offerData.Transport_Cost) || 0;
        const discount = offerData.Onsite_Assembly ? (parseFloat(offerData.Onsite_Discount) || 0) : 0;
        const total = subtotal + transportCost - discount;

        // Parse valid until date
        let validUntil = offerData.Valid_Until;
        if (validUntil && !validUntil.includes('T')) {
            validUntil = new Date(validUntil).toISOString();
        }

        // Update offer document
        await updateDoc(offerSnap.docs[0].ref, {
            Transport_Cost: transportCost,
            Onsite_Assembly: offerData.Onsite_Assembly || false,
            Onsite_Discount: offerData.Onsite_Discount || 0,
            Valid_Until: validUntil,
            Notes: offerData.Notes || '',
            Subtotal: subtotal,
            Total: total,
            Include_PDV: offerData.Include_PDV ?? true,
            PDV_Rate: offerData.PDV_Rate ?? 17,
        });

        // Delete existing offer products and their extras
        const productsQ = query(
            collection(db, COLLECTIONS.OFFER_PRODUCTS),
            where('Offer_ID', '==', offerId),
            where('Organization_ID', '==', organizationId)
        );
        const productsSnap = await getDocs(productsQ);

        for (const productDoc of productsSnap.docs) {
            const productData = productDoc.data();
            // Delete extras for this product
            const extrasQ = query(
                collection(db, COLLECTIONS.OFFER_EXTRAS),
                where('Offer_Product_ID', '==', productData.ID),
                where('Organization_ID', '==', organizationId)
            );
            const extrasSnap = await getDocs(extrasQ);
            for (const extraDoc of extrasSnap.docs) {
                await deleteDoc(extraDoc.ref);
            }
            // Delete the product
            await deleteDoc(productDoc.ref);
        }

        // Re-create products with new calculations
        for (const product of products) {
            const productId = generateUUID();
            const materialCost = parseFloat(product.Material_Cost) || 0;
            const margin = parseFloat(product.Margin) || 0;
            const extrasTotal = (product.Extras || []).reduce((sum: number, e: any) => sum + (parseFloat(e.total) || 0), 0);
            const laborTotal = (parseFloat(product.Labor_Workers) || 0) * (parseFloat(product.Labor_Days) || 0) * (parseFloat(product.Labor_Daily_Rate) || 0);
            const quantity = parseFloat(product.Quantity) || 1;
            const sellingPrice = materialCost + margin + extrasTotal + laborTotal;
            const totalPrice = sellingPrice * quantity;

            const offerProduct: OfferProduct & { Organization_ID: string } = {
                ID: productId,
                Organization_ID: organizationId,
                Offer_ID: offerId,
                Product_ID: product.Product_ID,
                Product_Name: product.Product_Name,
                Quantity: quantity,
                Included: product.Included === true,
                Material_Cost: materialCost,
                Margin: margin,
                Margin_Type: 'Fixed',
                LED_Meters: 0,
                LED_Price: 0,
                LED_Total: 0,
                Grouting: false,
                Grouting_Price: 0,
                Sink_Faucet: false,
                Sink_Faucet_Price: 0,
                Transport_Share: 0,
                Discount_Share: 0,
                Selling_Price: sellingPrice,
                Total_Price: totalPrice,
                Labor_Workers: parseFloat(product.Labor_Workers) || 0,
                Labor_Days: parseFloat(product.Labor_Days) || 0,
                Labor_Daily_Rate: parseFloat(product.Labor_Daily_Rate) || 0,
            };

            await addDoc(collection(db, COLLECTIONS.OFFER_PRODUCTS), offerProduct);

            // Add extras for this product
            for (const extra of product.Extras || []) {
                const extraDoc: OfferExtra & { Organization_ID: string } = {
                    ID: generateUUID(),
                    Organization_ID: organizationId,
                    Offer_Product_ID: productId,
                    Name: extra.name,
                    Quantity: parseFloat(extra.qty) || 1,
                    Unit: extra.unit || 'kom',
                    Unit_Price: parseFloat(extra.price) || 0,
                    Total: parseFloat(extra.total) || 0,
                };

                await addDoc(collection(db, COLLECTIONS.OFFER_EXTRAS), extraDoc);
            }
        }

        return { success: true, message: 'Ponuda ažurirana' };
    } catch (error) {
        console.error('updateOfferWithProducts error:', error);
        return { success: false, message: 'Greška pri ažuriranju ponude' };
    }
}

export async function deleteOffer(offerId: string, organizationId: string): Promise<{ success: boolean; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        // Delete offer products first
        const productsQ = query(
            collection(db, COLLECTIONS.OFFER_PRODUCTS),
            where('Offer_ID', '==', offerId),
            where('Organization_ID', '==', organizationId)
        );
        const productsSnap = await getDocs(productsQ);

        const batch = writeBatch(db);
        productsSnap.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();

        // Delete offer
        const q = query(
            collection(db, COLLECTIONS.OFFERS),
            where('Offer_ID', '==', offerId),
            where('Organization_ID', '==', organizationId)
        );
        const snapshot = await getDocs(q);
        if (!snapshot.empty) {
            await deleteDoc(snapshot.docs[0].ref);
        }

        return { success: true, message: 'Ponuda obrisana' };
    } catch (error) {
        console.error('deleteOffer error:', error);
        return { success: false, message: 'Greška pri brisanju ponude' };
    }
}

export async function updateOfferStatus(offerId: string, status: string, organizationId: string): Promise<{ success: boolean; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        const q = query(
            collection(db, COLLECTIONS.OFFERS),
            where('Offer_ID', '==', offerId),
            where('Organization_ID', '==', organizationId)
        );
        const snapshot = await getDocs(q);

        if (!snapshot.empty) {
            const updateData: Record<string, unknown> = { Status: status };
            const offer = snapshot.docs[0].data() as Offer;

            // Sync project status based on offer status
            if (status === 'Poslano' && offer.Project_ID) {
                // When offer is sent, project moves from Nacrt to Ponuđeno
                const project = await getProject(offer.Project_ID, organizationId);
                if (project && project.Status === 'Nacrt') {
                    await updateProjectStatus(offer.Project_ID, 'Ponuđeno', organizationId);
                }
            }

            if (status === 'Prihvaćeno') {
                updateData.Accepted_Date = new Date().toISOString();

                if (offer.Project_ID) {
                    await updateProjectStatus(offer.Project_ID, 'Odobreno', organizationId);
                }
            }

            // When offer is rejected, check if ALL offers for project are rejected/expired
            if ((status === 'Odbijeno' || status === 'Isteklo') && offer.Project_ID) {
                const allOffersQuery = query(
                    collection(db, COLLECTIONS.OFFERS),
                    where('Project_ID', '==', offer.Project_ID),
                    where('Organization_ID', '==', organizationId)
                );
                const allOffersSnap = await getDocs(allOffersQuery);

                // Check if all offers are now rejected or expired
                const allRejectedOrExpired = allOffersSnap.docs.every(doc => {
                    const offerData = doc.data();
                    // Current offer will have old status, so check if it's this offer
                    if (offerData.Offer_ID === offerId) {
                        return true; // This one is being rejected
                    }
                    return offerData.Status === 'Odbijeno' || offerData.Status === 'Isteklo';
                });

                if (allRejectedOrExpired) {
                    const project = await getProject(offer.Project_ID, organizationId);
                    // Only set to Otkazano if project is still in Ponuđeno stage
                    if (project && project.Status === 'Ponuđeno') {
                        await updateProjectStatus(offer.Project_ID, 'Otkazano', organizationId);
                    }
                }
            }

            await updateDoc(snapshot.docs[0].ref, updateData);
        }

        return { success: true, message: 'Status ponude ažuriran' };
    } catch (error) {
        console.error('updateOfferStatus error:', error);
        return { success: false, message: 'Greška pri ažuriranju statusa' };
    }
}

// ============================================
// ORDERS CRUD (Multi-tenancy enabled)
// ============================================

export async function getOrders(organizationId: string): Promise<Order[]> {
    if (!organizationId) return [];
    const q = query(collection(db, COLLECTIONS.ORDERS), where('Organization_ID', '==', organizationId));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ ...doc.data() } as Order));
}

export async function getOrder(orderId: string, organizationId: string): Promise<Order | null> {
    if (!organizationId) return null;
    const q = query(
        collection(db, COLLECTIONS.ORDERS),
        where('Order_ID', '==', orderId),
        where('Organization_ID', '==', organizationId)
    );
    const snapshot = await getDocs(q);
    if (snapshot.empty) return null;

    const order = snapshot.docs[0].data() as Order;
    order.items = await getOrderItems(orderId, organizationId);
    return order;
}

export async function getOrderItems(orderId: string, organizationId: string): Promise<OrderItem[]> {
    if (!organizationId) return [];
    const q = query(
        collection(db, COLLECTIONS.ORDER_ITEMS),
        where('Order_ID', '==', orderId),
        where('Organization_ID', '==', organizationId)
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ ...doc.data() } as OrderItem));
}

export async function createOrder(data: Partial<Order> & { items?: (Partial<OrderItem> & { Product_Material_IDs?: string[] })[] }, organizationId: string): Promise<{ success: boolean; data?: { Order_ID: string; Order_Number: string }; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        const orderId = generateUUID();
        const orderNumber = generateOrderNumber();

        const order: Order = {
            Order_ID: orderId,
            Organization_ID: organizationId,
            Order_Number: orderNumber,
            Supplier_ID: data.Supplier_ID || '',
            Supplier_Name: data.Supplier_Name || '',
            Order_Date: new Date().toISOString(),
            Status: 'Nacrt',
            Expected_Delivery: data.Expected_Delivery || '',
            Total_Amount: data.Total_Amount || 0,
            Notes: data.Notes || '',
        };

        await addDoc(collection(db, COLLECTIONS.ORDERS), order);

        // Add items using batch for order items
        // NOTE: We do NOT update material statuses here.
        // Material statuses remain 'Nije naručeno' until the order is actually sent (markOrderSent).
        const itemsBatch = writeBatch(db);

        for (const item of data.items || []) {
            // Collect all grouped material IDs for this item
            const allMaterialIdsForItem = item.Product_Material_IDs || (item.Product_Material_ID ? [item.Product_Material_ID] : []);

            const orderItem: OrderItem & { Organization_ID: string; Product_Material_IDs?: string[] } = {
                ID: generateUUID(),
                Organization_ID: organizationId,
                Order_ID: orderId,
                Product_Material_ID: item.Product_Material_ID || '',
                Product_ID: item.Product_ID || '',
                Product_Name: item.Product_Name || '',
                Project_ID: item.Project_ID || '',
                Material_Name: item.Material_Name || '',
                Quantity: item.Quantity || 0,
                Unit: item.Unit || '',
                Expected_Price: item.Expected_Price || 0,
                Actual_Price: 0,
                Received_Quantity: 0,
                Status: 'Na čekanju',
                Product_Material_IDs: allMaterialIdsForItem.length > 1 ? allMaterialIdsForItem : undefined,
            };

            const newDocRef = doc(collection(db, COLLECTIONS.ORDER_ITEMS));
            itemsBatch.set(newDocRef, orderItem);
        }

        await itemsBatch.commit();

        return { success: true, data: { Order_ID: orderId, Order_Number: orderNumber }, message: 'Narudžba kreirana' };
    } catch (error) {
        console.error('createOrder error:', error);
        return { success: false, message: 'Greška pri kreiranju narudžbe' };
    }
}

export async function saveOrder(data: Partial<Order>, organizationId: string): Promise<{ success: boolean; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        const q = query(
            collection(db, COLLECTIONS.ORDERS),
            where('Order_ID', '==', data.Order_ID),
            where('Organization_ID', '==', organizationId)
        );
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            return { success: false, message: 'Narudžba nije pronađena' };
        }

        const { Organization_ID, ...updateData } = data;
        await updateDoc(snapshot.docs[0].ref, updateData as Record<string, unknown>);
        return { success: true, message: 'Narudžba sačuvana' };
    } catch (error) {
        console.error('saveOrder error:', error);
        return { success: false, message: 'Greška pri spremanju narudžbe' };
    }
}

export async function deleteOrder(orderId: string, organizationId: string, materialAction?: 'received' | 'reset'): Promise<{ success: boolean; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        // Get order items first to update material statuses
        const itemsQ = query(
            collection(db, COLLECTIONS.ORDER_ITEMS),
            where('Order_ID', '==', orderId),
            where('Organization_ID', '==', organizationId)
        );
        const itemsSnap = await getDocs(itemsQ);

        // Batch update material statuses based on user choice
        // IMPORTANT: Use Product_Material_IDs (grouped) when available, not just Product_Material_ID
        if (materialAction) {
            const newStatus = materialAction === 'received' ? 'Primljeno' : 'Nije naručeno';
            const materialUpdates: { materialId: string; status: string; orderId: string }[] = [];

            for (const docSnap of itemsSnap.docs) {
                const item = docSnap.data() as OrderItem;
                // Get ALL material IDs for this item (grouped or single)
                const materialIds = item.Product_Material_IDs || (item.Product_Material_ID ? [item.Product_Material_ID] : []);
                for (const matId of materialIds) {
                    materialUpdates.push({ materialId: matId, status: newStatus, orderId: '' });
                }
            }

            if (materialUpdates.length > 0) {
                await batchUpdateMaterialStatuses(materialUpdates, organizationId);
            }
        }

        // Delete order items
        const batch = writeBatch(db);
        itemsSnap.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();

        // Delete order
        const q = query(
            collection(db, COLLECTIONS.ORDERS),
            where('Order_ID', '==', orderId),
            where('Organization_ID', '==', organizationId)
        );
        const snapshot = await getDocs(q);
        if (!snapshot.empty) {
            await deleteDoc(snapshot.docs[0].ref);
        }

        return { success: true, message: 'Narudžba obrisana' };
    } catch (error) {
        console.error('deleteOrder error:', error);
        return { success: false, message: 'Greška pri brisanju narudžbe' };
    }
}

export async function updateOrderStatus(orderId: string, status: string, organizationId: string): Promise<{ success: boolean; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        // Get current order to check previous status
        const q = query(
            collection(db, COLLECTIONS.ORDERS),
            where('Order_ID', '==', orderId),
            where('Organization_ID', '==', organizationId)
        );
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            return { success: false, message: 'Narudžba nije pronađena' };
        }

        const previousStatus = (snapshot.docs[0].data() as Order).Status;

        // Validate transition
        const allowed = ALLOWED_ORDER_TRANSITIONS[previousStatus];
        if (allowed && !allowed.includes(status)) {
            return { success: false, message: `Nije moguće promijeniti status iz "${previousStatus}" u "${status}"` };
        }

        await updateDoc(snapshot.docs[0].ref, { Status: status });

        // Helper: get all order items for this order
        const getItems = async () => {
            const itemsQ = query(
                collection(db, COLLECTIONS.ORDER_ITEMS),
                where('Order_ID', '==', orderId),
                where('Organization_ID', '==', organizationId)
            );
            return await getDocs(itemsQ);
        };

        // ── Transition: ANY → Nacrt (revert to draft) ──
        // Reset non-received materials to 'Nije naručeno' and clear Order_ID
        if (status === 'Nacrt') {
            const itemsSnap = await getItems();
            const materialUpdates: { materialId: string; status: string; orderId: string }[] = [];
            for (const docSnap of itemsSnap.docs) {
                const item = docSnap.data() as OrderItem;
                if (item.Status === 'Primljeno') continue; // Don't revert received items
                const materialIds = item.Product_Material_IDs || (item.Product_Material_ID ? [item.Product_Material_ID] : []);
                for (const matId of materialIds) {
                    materialUpdates.push({ materialId: matId, status: 'Nije naručeno', orderId: '' });
                }
                // Reset order item status back
                await updateDoc(docSnap.ref, { Status: 'Na čekanju' });
            }
            if (materialUpdates.length > 0) {
                await batchUpdateMaterialStatuses(materialUpdates, organizationId);
            }
        }

        // ── Transition: Nacrt → Poslano ──
        // Set all materials to 'Naručeno' (same as markOrderSent)
        if (status === 'Poslano' && previousStatus === 'Nacrt') {
            const itemsSnap = await getItems();
            const materialUpdates: { materialId: string; status: string; orderId: string }[] = [];
            for (const docSnap of itemsSnap.docs) {
                const item = docSnap.data() as OrderItem;
                if (item.Status === 'Primljeno') continue;
                const materialIds = item.Product_Material_IDs || (item.Product_Material_ID ? [item.Product_Material_ID] : []);
                for (const matId of materialIds) {
                    materialUpdates.push({ materialId: matId, status: 'Naručeno', orderId });
                }
                await updateDoc(docSnap.ref, { Status: 'Naručeno' });
            }
            if (materialUpdates.length > 0) {
                await batchUpdateMaterialStatuses(materialUpdates, organizationId);
            }
        }

        // ── Transition: ANY → Primljeno (receive all) ──
        // Mark all non-received materials as 'Primljeno'
        if (status === 'Primljeno') {
            const itemsSnap = await getItems();
            const materialUpdates: { materialId: string; status: string; orderId: string }[] = [];
            for (const docSnap of itemsSnap.docs) {
                const item = docSnap.data() as OrderItem;
                if (item.Status === 'Primljeno') continue;
                const materialIds = item.Product_Material_IDs || (item.Product_Material_ID ? [item.Product_Material_ID] : []);
                for (const matId of materialIds) {
                    materialUpdates.push({ materialId: matId, status: 'Primljeno', orderId });
                }
                await updateDoc(docSnap.ref, {
                    Status: 'Primljeno',
                    Received_Date: new Date().toISOString()
                });
            }
            if (materialUpdates.length > 0) {
                await batchUpdateMaterialStatuses(materialUpdates, organizationId);
            }
        }

        // Note: Potvrđeno, Isporučeno, Djelomično don't change material statuses
        // Materials are updated individually via markMaterialsReceived

        return { success: true, message: 'Status narudžbe ažuriran' };
    } catch (error) {
        console.error('updateOrderStatus error:', error);
        return { success: false, message: 'Greška pri ažuriranju statusa' };
    }
}

// ============================================
// GLASS ITEMS CRUD
// ============================================

export async function getGlassItems(productMaterialId: string): Promise<GlassItem[]> {
    const q = query(collection(db, COLLECTIONS.GLASS_ITEMS), where('Product_Material_ID', '==', productMaterialId));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ ...doc.data() } as GlassItem));
}

export async function saveGlassItems(productMaterialId: string, items: Partial<GlassItem>[]): Promise<{ success: boolean; message: string }> {
    try {
        // Delete existing glass items for this product material
        const q = query(collection(db, COLLECTIONS.GLASS_ITEMS), where('Product_Material_ID', '==', productMaterialId));
        const snapshot = await getDocs(q);

        const batch = writeBatch(db);
        snapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();

        // Add new items
        for (const item of items) {
            const glassItem: GlassItem = {
                ID: item.ID || generateUUID(),
                Product_Material_ID: productMaterialId,
                Order_ID: item.Order_ID || '',
                Qty: item.Qty || 1,
                Width: item.Width || 0,
                Height: item.Height || 0,
                Area_M2: item.Area_M2 || 0,
                Edge_Processing: item.Edge_Processing || false,
                Note: item.Note || '',
                Status: item.Status || 'Nije naručeno',
            };

            await addDoc(collection(db, COLLECTIONS.GLASS_ITEMS), glassItem);
        }

        return { success: true, message: 'Stakla sačuvana' };
    } catch (error) {
        console.error('saveGlassItems error:', error);
        return { success: false, message: 'Greška pri spremanju stakala' };
    }
}

// ============================================
// ALU DOOR ITEMS CRUD
// ============================================

export async function getAluDoorItems(productMaterialId: string): Promise<AluDoorItem[]> {
    const q = query(collection(db, COLLECTIONS.ALU_DOOR_ITEMS), where('Product_Material_ID', '==', productMaterialId));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ ...doc.data() } as AluDoorItem));
}

export async function saveAluDoorItems(productMaterialId: string, items: Partial<AluDoorItem>[]): Promise<{ success: boolean; message: string }> {
    try {
        // Delete existing alu door items for this product material
        const q = query(collection(db, COLLECTIONS.ALU_DOOR_ITEMS), where('Product_Material_ID', '==', productMaterialId));
        const snapshot = await getDocs(q);

        const batch = writeBatch(db);
        snapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();

        // Add new items
        for (const item of items) {
            const aluDoorItem: AluDoorItem = {
                ID: item.ID || generateUUID(),
                Product_Material_ID: productMaterialId,
                Order_ID: item.Order_ID || '',
                Qty: item.Qty || 1,
                Width: item.Width || 0,
                Height: item.Height || 0,
                Frame_Type: item.Frame_Type || '',
                Glass_Type: item.Glass_Type || '',
                Frame_Color: item.Frame_Color || '',
                Hinge_Color: item.Hinge_Color || '',
                Hinge_Type: item.Hinge_Type || '',
                Hinge_Side: item.Hinge_Side || '',
                Hinge_Layout: item.Hinge_Layout || '',
                Hinge_Positions: item.Hinge_Positions || '',
                Integrated_Handle: item.Integrated_Handle || false,
                Area_M2: item.Area_M2 || 0,
                Unit_Price: item.Unit_Price || 0,
                Total_Price: item.Total_Price || 0,
                Note: item.Note || '',
                Status: item.Status || 'Nije naručeno',
            };

            await addDoc(collection(db, COLLECTIONS.ALU_DOOR_ITEMS), aluDoorItem);
        }

        return { success: true, message: 'Alu vrata sačuvana' };
    } catch (error) {
        console.error('saveAluDoorItems error:', error);
        return { success: false, message: 'Greška pri spremanju alu vrata' };
    }
}

// ============================================
// ORDER STATUS AUTOMATION (Multi-tenancy enabled)
// ============================================

export async function markOrderSent(orderId: string, organizationId: string): Promise<{ success: boolean; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        // Update order status
        const orderQ = query(
            collection(db, COLLECTIONS.ORDERS),
            where('Order_ID', '==', orderId),
            where('Organization_ID', '==', organizationId)
        );
        const orderSnap = await getDocs(orderQ);

        if (orderSnap.empty) {
            return { success: false, message: 'Narudžba nije pronađena' };
        }

        await updateDoc(orderSnap.docs[0].ref, { Status: 'Poslano' });

        // Get order items and collect ALL material IDs (including grouped)
        const itemsQ = query(
            collection(db, COLLECTIONS.ORDER_ITEMS),
            where('Order_ID', '==', orderId),
            where('Organization_ID', '==', organizationId)
        );
        const itemsSnap = await getDocs(itemsQ);

        const materialUpdates: { materialId: string; status: string; orderId: string }[] = [];
        const affectedProducts = new Set<string>();
        const affectedProjects = new Set<string>();

        for (const docSnap of itemsSnap.docs) {
            const item = docSnap.data() as OrderItem;
            // Get ALL material IDs for this item (grouped or single)
            const materialIds = item.Product_Material_IDs || (item.Product_Material_ID ? [item.Product_Material_ID] : []);

            for (const matId of materialIds) {
                materialUpdates.push({ materialId: matId, status: 'Naručeno', orderId });
            }

            // Update order item status to 'Naručeno'
            await updateDoc(docSnap.ref, { Status: 'Naručeno' });

            if (item.Product_ID) affectedProducts.add(item.Product_ID);
            if (item.Project_ID) affectedProjects.add(item.Project_ID);
        }

        // Batch update all material statuses
        if (materialUpdates.length > 0) {
            await batchUpdateMaterialStatuses(materialUpdates, organizationId);
        }

        // Update product statuses
        for (const productId of Array.from(affectedProducts)) {
            const product = await getProduct(productId, organizationId);
            if (product && product.Status === 'Na čekanju') {
                await updateProductStatus(productId, 'Materijali naručeni', organizationId);
            }
        }

        // Update project statuses
        for (const projectId of Array.from(affectedProjects)) {
            const project = await getProject(projectId, organizationId);
            if (project && project.Status === 'Odobreno') {
                await updateProjectStatus(projectId, 'U proizvodnji', organizationId);
            }
        }

        return { success: true, message: 'Narudžba poslana' };
    } catch (error) {
        console.error('markOrderSent error:', error);
        return { success: false, message: 'Greška pri slanju narudžbe' };
    }
}

export async function markMaterialsReceived(orderItemIds: string[], organizationId: string): Promise<{ success: boolean; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        const affectedProducts = new Set<string>();
        const affectedProjects = new Set<string>();
        const affectedOrderIds = new Set<string>();

        for (const itemId of orderItemIds) {
            // Find order item with organization filter
            const itemQ = query(
                collection(db, COLLECTIONS.ORDER_ITEMS),
                where('ID', '==', itemId),
                where('Organization_ID', '==', organizationId)
            );
            const itemSnap = await getDocs(itemQ);

            if (itemSnap.empty) continue;

            const item = itemSnap.docs[0].data() as OrderItem;

            // Update order item status and received date
            await updateDoc(itemSnap.docs[0].ref, {
                Status: 'Primljeno',
                Received_Date: new Date().toISOString()
            });

            // Update ALL material statuses (including grouped)
            const materialIds = item.Product_Material_IDs || (item.Product_Material_ID ? [item.Product_Material_ID] : []);
            for (const matId of materialIds) {
                await updateProductMaterial(matId, { Status: 'Primljeno' }, organizationId);
            }

            if (item.Product_ID) affectedProducts.add(item.Product_ID);
            if (item.Project_ID) affectedProjects.add(item.Project_ID);
            if (item.Order_ID) affectedOrderIds.add(item.Order_ID);
        }

        // ── Auto-update order status (Djelomično / Primljeno) ──
        for (const oId of Array.from(affectedOrderIds)) {
            const allItemsQ = query(
                collection(db, COLLECTIONS.ORDER_ITEMS),
                where('Order_ID', '==', oId),
                where('Organization_ID', '==', organizationId)
            );
            const allItemsSnap = await getDocs(allItemsQ);
            const totalItems = allItemsSnap.docs.length;
            const receivedItems = allItemsSnap.docs.filter(d => (d.data() as OrderItem).Status === 'Primljeno').length;

            if (totalItems > 0 && receivedItems === totalItems) {
                // All items received → order is Primljeno
                const orderQ = query(
                    collection(db, COLLECTIONS.ORDERS),
                    where('Order_ID', '==', oId),
                    where('Organization_ID', '==', organizationId)
                );
                const orderSnap = await getDocs(orderQ);
                if (!orderSnap.empty) {
                    await updateDoc(orderSnap.docs[0].ref, { Status: 'Primljeno' });
                }
            } else if (receivedItems > 0) {
                // Some items received → order is Djelomično
                const orderQ = query(
                    collection(db, COLLECTIONS.ORDERS),
                    where('Order_ID', '==', oId),
                    where('Organization_ID', '==', organizationId)
                );
                const orderSnap = await getDocs(orderQ);
                if (!orderSnap.empty) {
                    const currentStatus = (orderSnap.docs[0].data() as Order).Status;
                    // Only set Djelomično if not already Primljeno
                    if (currentStatus !== 'Primljeno') {
                        await updateDoc(orderSnap.docs[0].ref, { Status: 'Djelomično' });
                    }
                }
            }
        }

        // Check if all materials for products are received
        for (const productId of Array.from(affectedProducts)) {
            const materials = await getProductMaterials(productId, organizationId);
            const allReceived = materials.every(m =>
                m.Status === 'Primljeno' || m.Status === 'U upotrebi' || m.Status === 'Instalirano'
            );

            if (allReceived) {
                await updateProductStatus(productId, 'Materijali spremni', organizationId);
            }
        }

        // Note: Project status sync is now handled by syncProjectStatus() 
        // based on work order item progress, not material receipt

        return { success: true, message: 'Materijali primljeni' };
    } catch (error) {
        console.error('markMaterialsReceived error:', error);
        return { success: false, message: 'Greška pri primanju materijala' };
    }
}

// Delete specific order items by their IDs
export async function deleteOrderItemsByIds(itemIds: string[], organizationId: string): Promise<{ success: boolean; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        for (const itemId of itemIds) {
            const itemQ = query(
                collection(db, COLLECTIONS.ORDER_ITEMS),
                where('ID', '==', itemId),
                where('Organization_ID', '==', organizationId)
            );
            const itemSnap = await getDocs(itemQ);

            if (itemSnap.empty) continue;

            const item = itemSnap.docs[0].data() as OrderItem;

            // Reset ALL material statuses (including grouped) to "Nije naručeno" and clear Order_ID
            const materialIds = item.Product_Material_IDs || (item.Product_Material_ID ? [item.Product_Material_ID] : []);
            for (const matId of materialIds) {
                await updateProductMaterial(matId, { Status: 'Nije naručeno', Order_ID: '' }, organizationId);
            }

            // Delete the order item
            await deleteDoc(itemSnap.docs[0].ref);
        }

        return { success: true, message: 'Stavke obrisane' };
    } catch (error) {
        console.error('deleteOrderItemsByIds error:', error);
        return { success: false, message: 'Greška pri brisanju stavki' };
    }
}

// Update a single order item (e.g., quantity, notes)
export async function updateOrderItem(itemId: string, data: Partial<OrderItem>, organizationId: string): Promise<{ success: boolean; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        const itemQ = query(
            collection(db, COLLECTIONS.ORDER_ITEMS),
            where('ID', '==', itemId),
            where('Organization_ID', '==', organizationId)
        );
        const itemSnap = await getDocs(itemQ);

        if (itemSnap.empty) {
            return { success: false, message: 'Stavka nije pronađena' };
        }

        await updateDoc(itemSnap.docs[0].ref, data as Record<string, unknown>);

        return { success: true, message: 'Stavka ažurirana' };
    } catch (error) {
        console.error('updateOrderItem error:', error);
        return { success: false, message: 'Greška pri ažuriranju stavke' };
    }
}

// Recalculate order total after item changes
export async function recalculateOrderTotal(orderId: string, organizationId: string): Promise<{ success: boolean; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        const items = await getOrderItems(orderId, organizationId);
        const total = items.reduce((sum, item) => {
            return sum + ((item.Quantity || 0) * (item.Expected_Price || 0));
        }, 0);

        const orderQ = query(
            collection(db, COLLECTIONS.ORDERS),
            where('Order_ID', '==', orderId),
            where('Organization_ID', '==', organizationId)
        );
        const orderSnap = await getDocs(orderQ);

        if (!orderSnap.empty) {
            await updateDoc(orderSnap.docs[0].ref, { Total_Amount: total });
        }

        return { success: true, message: 'Ukupan iznos ažuriran' };
    } catch (error) {
        console.error('recalculateOrderTotal error:', error);
        return { success: false, message: 'Greška pri računanju ukupnog iznosa' };
    }
}

export async function updateOfferProduct(data: Partial<OfferProduct>): Promise<{ success: boolean; message: string }> {
    try {
        const q = query(collection(db, COLLECTIONS.OFFER_PRODUCTS), where('ID', '==', data.ID));
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            return { success: false, message: 'Proizvod ponude nije pronađen' };
        }

        // Calculate LED total
        if (data.LED_Meters !== undefined && data.LED_Price !== undefined) {
            data.LED_Total = (data.LED_Meters || 0) * (data.LED_Price || 0);
        }

        // Calculate selling price
        const existing = snapshot.docs[0].data() as OfferProduct;
        const merged = { ...existing, ...data };

        const materialCost = merged.Material_Cost || 0;
        const margin = merged.Margin || 0;
        const ledTotal = merged.LED_Total || 0;
        const groutingPrice = merged.Grouting ? (merged.Grouting_Price || 0) : 0;
        const sinkPrice = merged.Sink_Faucet ? (merged.Sink_Faucet_Price || 0) : 0;

        let marginAmount = margin;
        if (merged.Margin_Type === 'Percentage') {
            marginAmount = materialCost * (margin / 100);
        }

        merged.Selling_Price = materialCost + marginAmount + ledTotal + groutingPrice + sinkPrice;
        merged.Total_Price = merged.Selling_Price * (merged.Quantity || 1);

        await updateDoc(snapshot.docs[0].ref, merged as Record<string, unknown>);

        return { success: true, message: 'Proizvod ažuriran' };
    } catch (error) {
        console.error('updateOfferProduct error:', error);
        return { success: false, message: 'Greška pri ažuriranju proizvoda' };
    }
}

// ============================================
// GLASS ITEMS CRUD
// ============================================

export interface AddGlassMaterialData {
    productId: string;
    materialId: string;
    materialName: string;
    supplier: string;
    unitPrice: number;
    items: Array<{
        Qty: number;
        Width: number;
        Height: number;
        Edge_Processing: boolean;
        Note: string;
    }>;
}

export async function addGlassMaterialToProduct(data: AddGlassMaterialData, organizationId: string): Promise<{ success: boolean; data?: { productMaterialId: string; itemCount: number; totalArea: number; totalPrice: number }; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }
    try {
        const pricePerM2 = data.unitPrice || 0;
        const items = data.items || [];

        // Calculate totals
        let totalArea = 0;
        let totalPrice = 0;

        items.forEach(item => {
            const qty = item.Qty || 1;
            const width = item.Width || 0;
            const height = item.Height || 0;
            const area = (width * height) / 1000000; // mm² to m²
            const areaTotal = area * qty;
            const hasEdge = item.Edge_Processing === true;
            const itemPrice = areaTotal * pricePerM2 * (hasEdge ? 1.10 : 1);

            totalArea += areaTotal;
            totalPrice += itemPrice;
        });

        // Create the product material entry
        const productMaterialId = generateUUID();

        const pmData: Partial<ProductMaterial> = {
            ID: productMaterialId,
            Product_ID: data.productId,
            Material_ID: data.materialId || '',
            Material_Name: data.materialName,
            Quantity: Math.round(totalArea * 100) / 100,
            Unit: 'm²',
            Unit_Price: pricePerM2,
            Total_Price: Math.round(totalPrice * 100) / 100,
            Status: 'Nije naručeno',
            Supplier: data.supplier || '',
            Order_ID: '',
            Organization_ID: organizationId,
        };

        await addDoc(collection(db, COLLECTIONS.PRODUCT_MATERIALS), pmData);

        // Add glass items
        for (const item of items) {
            const qty = item.Qty || 1;
            const width = item.Width || 0;
            const height = item.Height || 0;
            const area = (width * height) / 1000000;
            const hasEdge = item.Edge_Processing === true;

            const glassItem: Partial<GlassItem> = {
                ID: generateUUID(),
                Product_Material_ID: productMaterialId,
                Order_ID: '',
                Qty: qty,
                Width: width,
                Height: height,
                Area_M2: Math.round(area * qty * 10000) / 10000,
                Edge_Processing: hasEdge,
                Note: item.Note || '',
                Status: 'Nije naručeno',
            };

            await addDoc(collection(db, COLLECTIONS.GLASS_ITEMS), glassItem);
        }

        // Recalculate product cost
        if (data.productId) {
            await recalculateProductCost(data.productId, organizationId);
        }

        return {
            success: true,
            data: {
                productMaterialId,
                itemCount: items.length,
                totalArea: Math.round(totalArea * 100) / 100,
                totalPrice: Math.round(totalPrice * 100) / 100,
            },
            message: 'Staklo dodano',
        };
    } catch (error) {
        console.error('addGlassMaterialToProduct error:', error);
        return { success: false, message: 'Greška pri dodavanju stakla' };
    }
}

export interface UpdateGlassMaterialData {
    productMaterialId: string;
    unitPrice: number;
    items: Array<{
        Qty: number;
        Width: number;
        Height: number;
        Edge_Processing: boolean;
        Note: string;
    }>;
}

export async function updateGlassMaterial(data: UpdateGlassMaterialData, organizationId: string): Promise<{ success: boolean; data?: { productMaterialId: string; itemCount: number; totalArea: number; totalPrice: number }; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }
    try {
        const productMaterialId = data.productMaterialId;
        const pricePerM2 = data.unitPrice || 0;
        const items = data.items || [];

        // Delete existing glass items
        await deleteGlassItemsByMaterial(productMaterialId);

        // Calculate totals and add new items
        let totalArea = 0;
        let totalPrice = 0;

        for (const item of items) {
            const qty = item.Qty || 1;
            const width = item.Width || 0;
            const height = item.Height || 0;
            const area = (width * height) / 1000000;
            const hasEdge = item.Edge_Processing === true;
            const itemPrice = area * qty * pricePerM2 * (hasEdge ? 1.10 : 1);

            totalArea += area * qty;
            totalPrice += itemPrice;

            if (width > 0 && height > 0) {
                const glassItem: Partial<GlassItem> = {
                    ID: generateUUID(),
                    Product_Material_ID: productMaterialId,
                    Order_ID: '',
                    Qty: qty,
                    Width: width,
                    Height: height,
                    Area_M2: Math.round(area * qty * 10000) / 10000,
                    Edge_Processing: hasEdge,
                    Note: item.Note || '',
                    Status: 'Nije naručeno',
                };

                await addDoc(collection(db, COLLECTIONS.GLASS_ITEMS), glassItem);
            }
        }

        // Update the product material totals
        const pmQ = query(collection(db, COLLECTIONS.PRODUCT_MATERIALS), where('ID', '==', productMaterialId));
        const pmSnap = await getDocs(pmQ);

        let productId = '';
        if (!pmSnap.empty) {
            productId = pmSnap.docs[0].data().Product_ID || '';
            await updateDoc(pmSnap.docs[0].ref, {
                Quantity: Math.round(totalArea * 100) / 100,
                Unit_Price: pricePerM2,
                Total_Price: Math.round(totalPrice * 100) / 100,
            });
        }

        // Recalculate product cost
        if (productId) {
            await recalculateProductCost(productId, organizationId);
        }

        return {
            success: true,
            data: {
                productMaterialId,
                itemCount: items.filter(i => (i.Width || 0) > 0 && (i.Height || 0) > 0).length,
                totalArea: Math.round(totalArea * 100) / 100,
                totalPrice: Math.round(totalPrice * 100) / 100,
            },
            message: 'Staklo ažurirano',
        };
    } catch (error) {
        console.error('updateGlassMaterial error:', error);
        return { success: false, message: 'Greška pri ažuriranju stakla' };
    }
}

export async function deleteGlassItemsByMaterial(productMaterialId: string): Promise<void> {
    const q = query(collection(db, COLLECTIONS.GLASS_ITEMS), where('Product_Material_ID', '==', productMaterialId));
    const snapshot = await getDocs(q);

    const batch = writeBatch(db);
    snapshot.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
}

// ============================================
// ALU DOOR ITEMS CRUD
// ============================================

export interface AddAluDoorMaterialData {
    productId: string;
    materialId: string;
    materialName: string;
    supplier: string;
    unitPrice: number;
    items: Array<{
        Qty: number;
        Width: number;
        Height: number;
        Frame_Type: string;
        Glass_Type: string;
        Frame_Color: string;
        Hinge_Color: string;
        Hinge_Type: string;
        Hinge_Side: string;
        Hinge_Layout: string;
        Hinge_Positions: number[];
        Integrated_Handle: boolean;
        Note: string;
    }>;
}

export async function addAluDoorMaterialToProduct(data: AddAluDoorMaterialData, organizationId: string): Promise<{ success: boolean; data?: { productMaterialId: string; itemCount: number; totalQty: number; totalArea: number; totalPrice: number }; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }
    try {
        const pricePerM2 = data.unitPrice || 200;
        const items = data.items || [];

        // Calculate totals
        let totalArea = 0;
        let totalPrice = 0;
        let totalQty = 0;

        items.forEach(item => {
            const qty = item.Qty || 1;
            const width = item.Width || 0;
            const height = item.Height || 0;
            const area = (width * height) / 1000000; // mm² to m²
            const areaTotal = area * qty;
            const itemPrice = areaTotal * pricePerM2;

            totalQty += qty;
            totalArea += areaTotal;
            totalPrice += itemPrice;
        });

        // Create the product material entry
        const productMaterialId = generateUUID();

        const pmData: Partial<ProductMaterial> = {
            ID: productMaterialId,
            Product_ID: data.productId,
            Material_ID: data.materialId || '',
            Material_Name: data.materialName,
            Quantity: Math.round(totalArea * 100) / 100,
            Unit: 'm²',
            Unit_Price: pricePerM2,
            Total_Price: Math.round(totalPrice * 100) / 100,
            Status: 'Nije naručeno',
            Supplier: data.supplier || '',
            Order_ID: '',
            Organization_ID: organizationId,
        };

        await addDoc(collection(db, COLLECTIONS.PRODUCT_MATERIALS), pmData);

        // Add alu door items
        for (const item of items) {
            const qty = item.Qty || 1;
            const width = item.Width || 0;
            const height = item.Height || 0;
            const area = (width * height) / 1000000;
            const areaTotal = area * qty;
            const itemPrice = areaTotal * pricePerM2;

            const aluDoorItem: Partial<AluDoorItem> = {
                ID: generateUUID(),
                Product_Material_ID: productMaterialId,
                Order_ID: '',
                Qty: qty,
                Width: width,
                Height: height,
                Frame_Type: item.Frame_Type || 'uski',
                Glass_Type: item.Glass_Type || 'float',
                Frame_Color: item.Frame_Color || '',
                Hinge_Color: item.Hinge_Color || '',
                Hinge_Type: item.Hinge_Type || 'ravne',
                Hinge_Side: item.Hinge_Side || 'lijevo',
                Hinge_Layout: item.Hinge_Layout || 'osnovna',
                Hinge_Positions: JSON.stringify(item.Hinge_Positions || []),
                Integrated_Handle: item.Integrated_Handle === true,
                Area_M2: Math.round(areaTotal * 10000) / 10000,
                Unit_Price: pricePerM2,
                Total_Price: Math.round(itemPrice * 100) / 100,
                Note: item.Note || '',
                Status: 'Nije naručeno',
            };

            await addDoc(collection(db, COLLECTIONS.ALU_DOOR_ITEMS), aluDoorItem);
        }

        // Recalculate product cost
        if (data.productId) {
            await recalculateProductCost(data.productId, organizationId);
        }

        return {
            success: true,
            data: {
                productMaterialId,
                itemCount: items.length,
                totalQty,
                totalArea: Math.round(totalArea * 100) / 100,
                totalPrice: Math.round(totalPrice * 100) / 100,
            },
            message: 'Alu vrata dodana',
        };
    } catch (error) {
        console.error('addAluDoorMaterialToProduct error:', error);
        return { success: false, message: 'Greška pri dodavanju alu vrata' };
    }
}

export interface UpdateAluDoorMaterialData {
    productMaterialId: string;
    unitPrice: number;
    items: Array<{
        Qty: number;
        Width: number;
        Height: number;
        Frame_Type: string;
        Glass_Type: string;
        Frame_Color: string;
        Hinge_Color: string;
        Hinge_Type: string;
        Hinge_Side: string;
        Hinge_Layout: string;
        Hinge_Positions: number[];
        Integrated_Handle: boolean;
        Note: string;
    }>;
}

export async function updateAluDoorMaterial(data: UpdateAluDoorMaterialData, organizationId: string): Promise<{ success: boolean; data?: { productMaterialId: string; itemCount: number; totalQty: number; totalArea: number; totalPrice: number }; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }
    try {
        const productMaterialId = data.productMaterialId;
        const pricePerM2 = data.unitPrice || 200;
        const items = data.items || [];

        // Delete existing alu door items
        await deleteAluDoorItemsByMaterial(productMaterialId);

        // Calculate totals and add new items
        let totalArea = 0;
        let totalPrice = 0;
        let totalQty = 0;

        for (const item of items) {
            const qty = item.Qty || 1;
            const width = item.Width || 0;
            const height = item.Height || 0;
            const area = (width * height) / 1000000;
            const areaTotal = area * qty;
            const itemPrice = areaTotal * pricePerM2;

            totalQty += qty;
            totalArea += areaTotal;
            totalPrice += itemPrice;

            if (width > 0 && height > 0) {
                const aluDoorItem: Partial<AluDoorItem> = {
                    ID: generateUUID(),
                    Product_Material_ID: productMaterialId,
                    Order_ID: '',
                    Qty: qty,
                    Width: width,
                    Height: height,
                    Frame_Type: item.Frame_Type || 'uski',
                    Glass_Type: item.Glass_Type || 'float',
                    Frame_Color: item.Frame_Color || '',
                    Hinge_Color: item.Hinge_Color || '',
                    Hinge_Type: item.Hinge_Type || 'ravne',
                    Hinge_Side: item.Hinge_Side || 'lijevo',
                    Hinge_Layout: item.Hinge_Layout || 'osnovna',
                    Hinge_Positions: JSON.stringify(item.Hinge_Positions || []),
                    Integrated_Handle: item.Integrated_Handle === true,
                    Area_M2: Math.round(areaTotal * 10000) / 10000,
                    Unit_Price: pricePerM2,
                    Total_Price: Math.round(itemPrice * 100) / 100,
                    Note: item.Note || '',
                    Status: 'Nije naručeno',
                };

                await addDoc(collection(db, COLLECTIONS.ALU_DOOR_ITEMS), aluDoorItem);
            }
        }

        // Update the product material totals
        const pmQ = query(collection(db, COLLECTIONS.PRODUCT_MATERIALS), where('ID', '==', productMaterialId));
        const pmSnap = await getDocs(pmQ);

        let productId = '';
        if (!pmSnap.empty) {
            productId = pmSnap.docs[0].data().Product_ID || '';
            await updateDoc(pmSnap.docs[0].ref, {
                Quantity: Math.round(totalArea * 100) / 100,
                Unit_Price: pricePerM2,
                Total_Price: Math.round(totalPrice * 100) / 100,
            });
        }

        // Recalculate product cost
        if (productId) {
            await recalculateProductCost(productId, organizationId);
        }

        return {
            success: true,
            data: {
                productMaterialId,
                itemCount: items.filter(i => (i.Width || 0) > 0 && (i.Height || 0) > 0).length,
                totalQty,
                totalArea: Math.round(totalArea * 100) / 100,
                totalPrice: Math.round(totalPrice * 100) / 100,
            },
            message: 'Alu vrata ažurirana',
        };
    } catch (error) {
        console.error('updateAluDoorMaterial error:', error);
        return { success: false, message: 'Greška pri ažuriranju alu vrata' };
    }
}

export async function deleteAluDoorItemsByMaterial(productMaterialId: string): Promise<void> {
    const q = query(collection(db, COLLECTIONS.ALU_DOOR_ITEMS), where('Product_Material_ID', '==', productMaterialId));
    const snapshot = await getDocs(q);

    const batch = writeBatch(db);
    snapshot.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
}

// ============================================
// WORK ORDERS CRUD (Multi-tenancy enabled)
// ============================================

export function generateWorkOrderNumber(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `RN-${year}${month}${day}-${random}`;
}

export async function getWorkOrders(organizationId: string): Promise<WorkOrder[]> {
    if (!organizationId) return [];

    const [workOrdersSnap, itemsSnap] = await Promise.all([
        getDocs(query(collection(db, COLLECTIONS.WORK_ORDERS), where('Organization_ID', '==', organizationId))),
        getDocs(query(collection(db, COLLECTIONS.WORK_ORDER_ITEMS), where('Organization_ID', '==', organizationId))),
    ]);

    const items = itemsSnap.docs.map(doc => ({ ...doc.data() } as WorkOrderItem));
    const workOrders = workOrdersSnap.docs.map(doc => {
        const wo = { ...doc.data() } as WorkOrder;
        wo.items = items.filter(i => i.Work_Order_ID === wo.Work_Order_ID);
        return wo;
    });

    return workOrders;
}

export async function getWorkOrder(workOrderId: string, organizationId: string): Promise<WorkOrder | null> {
    if (!organizationId) return null;

    const [woSnap, itemsSnap] = await Promise.all([
        getDocs(query(
            collection(db, COLLECTIONS.WORK_ORDERS),
            where('Work_Order_ID', '==', workOrderId),
            where('Organization_ID', '==', organizationId)
        )),
        getDocs(query(
            collection(db, COLLECTIONS.WORK_ORDER_ITEMS),
            where('Work_Order_ID', '==', workOrderId),
            where('Organization_ID', '==', organizationId)
        )),
    ]);

    if (woSnap.empty) return null;

    const workOrder = woSnap.docs[0].data() as WorkOrder;
    const items = itemsSnap.docs.map(doc => ({ ...doc.data() } as WorkOrderItem));

    // Fetch materials for each item
    for (const item of items) {
        if (item.Product_ID) {
            const materials = await getProductMaterials(item.Product_ID, organizationId);
            item.materials = materials;
        }
    }

    workOrder.items = items;

    return workOrder;
}

export async function createWorkOrder(data: {
    Production_Steps: string[];
    Due_Date?: string;
    Notes?: string;
    Total_Value?: number;
    Material_Cost?: number;
    Labor_Cost?: number;
    Profit?: number;
    Profit_Margin?: number;
    items: {
        Product_ID: string;
        Product_Name: string;
        Project_ID: string;
        Project_Name: string;
        Quantity: number;
        Product_Value?: number;
        Material_Cost?: number;
        Planned_Labor_Cost?: number;
        Process_Assignments?: Record<string, {
            Worker_ID?: string;
            Worker_Name?: string;
            Helpers?: { Worker_ID: string; Worker_Name: string; }[];
            Days_Worked?: number;
        }>;
    }[];
}, organizationId: string): Promise<{ success: boolean; data?: { Work_Order_ID: string; Work_Order_Number: string }; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        const workOrderId = generateUUID();
        const workOrderNumber = generateWorkOrderNumber();

        const workOrder: WorkOrder = {
            Work_Order_ID: workOrderId,
            Organization_ID: organizationId,
            Work_Order_Number: workOrderNumber,
            Created_Date: new Date().toISOString(),
            Due_Date: data.Due_Date || '',
            Status: 'Na čekanju',
            Production_Steps: data.Production_Steps,
            Notes: data.Notes || '',
            ...(data.Total_Value && { Total_Value: data.Total_Value }),
            ...(data.Material_Cost && { Material_Cost: data.Material_Cost }),
            ...(data.Labor_Cost && { Labor_Cost: data.Labor_Cost }),
            ...(data.Profit && { Profit: data.Profit }),
            ...(data.Profit_Margin && { Profit_Margin: data.Profit_Margin }),
        };

        await addDoc(collection(db, COLLECTIONS.WORK_ORDERS), workOrder);

        // Add items with process assignments
        for (const item of data.items) {
            const processAssignments: Record<string, any> = {};

            // Initialize all processes with status
            data.Production_Steps.forEach(proc => {
                processAssignments[proc] = {
                    Status: 'Na čekanju',
                    Worker_ID: item.Process_Assignments?.[proc]?.Worker_ID || null,
                    Worker_Name: item.Process_Assignments?.[proc]?.Worker_Name || null,
                };
            });

            // Build Processes array from input (new format)
            const processes = (item as any).Processes || data.Production_Steps.map(proc => ({
                Process_Name: proc,
                Status: 'Na čekanju',
                Worker_ID: item.Process_Assignments?.[proc]?.Worker_ID || undefined,
                Worker_Name: item.Process_Assignments?.[proc]?.Worker_Name || undefined,
                Helpers: item.Process_Assignments?.[proc]?.Helpers || undefined,
            }));

            const workOrderItem: WorkOrderItem & { Organization_ID: string } = {
                ID: generateUUID(),
                Organization_ID: organizationId,
                Work_Order_ID: workOrderId,
                Product_ID: item.Product_ID,
                Product_Name: item.Product_Name,
                Project_ID: item.Project_ID,
                Project_Name: item.Project_Name,
                Quantity: item.Quantity,
                Status: 'Na čekanju',
                Process_Assignments: processAssignments,
                Processes: processes,
                // Cost and value fields for profit calculation (default to 0 if undefined)
                Product_Value: item.Product_Value ?? 0,
                Material_Cost: item.Material_Cost ?? 0,
                Planned_Labor_Cost: item.Planned_Labor_Cost ?? 0,
            };
            await addDoc(collection(db, COLLECTIONS.WORK_ORDER_ITEMS), workOrderItem);
        }

        return { success: true, data: { Work_Order_ID: workOrderId, Work_Order_Number: workOrderNumber }, message: 'Radni nalog kreiran' };
    } catch (error) {
        console.error('createWorkOrder error:', error);
        return { success: false, message: 'Greška pri kreiranju radnog naloga' };
    }
}

export async function updateWorkOrderStatus(workOrderId: string, status: string, organizationId: string): Promise<{ success: boolean; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        const q = query(
            collection(db, COLLECTIONS.WORK_ORDERS),
            where('Work_Order_ID', '==', workOrderId),
            where('Organization_ID', '==', organizationId)
        );
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            return { success: false, message: 'Radni nalog nije pronađen' };
        }

        const updateData: any = { Status: status };
        if (status === 'Završeno') {
            updateData.Completed_Date = new Date().toISOString();
        }

        await updateDoc(snapshot.docs[0].ref, updateData);
        return { success: true, message: 'Status ažuriran' };
    } catch (error) {
        console.error('updateWorkOrderStatus error:', error);
        return { success: false, message: 'Greška pri ažuriranju statusa' };
    }
}

export async function updateWorkOrderItemStatus(itemId: string, status: string, organizationId: string): Promise<{ success: boolean; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        const q = query(
            collection(db, COLLECTIONS.WORK_ORDER_ITEMS),
            where('ID', '==', itemId),
            where('Organization_ID', '==', organizationId)
        );
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            return { success: false, message: 'Stavka nije pronađena' };
        }

        await updateDoc(snapshot.docs[0].ref, { Status: status });
        return { success: true, message: 'Status stavke ažuriran' };
    } catch (error) {
        console.error('updateWorkOrderItemStatus error:', error);
        return { success: false, message: 'Greška pri ažuriranju statusa stavke' };
    }
}

export async function assignWorkerToItem(itemId: string, workerId: string, workerName: string, organizationId: string): Promise<{ success: boolean; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        const q = query(
            collection(db, COLLECTIONS.WORK_ORDER_ITEMS),
            where('ID', '==', itemId),
            where('Organization_ID', '==', organizationId)
        );
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            return { success: false, message: 'Stavka nije pronađena' };
        }

        await updateDoc(snapshot.docs[0].ref, { Worker_ID: workerId, Worker_Name: workerName });
        return { success: true, message: 'Radnik dodijeljen' };
    } catch (error) {
        console.error('assignWorkerToItem error:', error);
        return { success: false, message: 'Greška pri dodjeljivanju radnika' };
    }
}

export async function completeWorkOrderItem(itemId: string, productionStep: string, organizationId: string): Promise<{ success: boolean; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        // Update item status
        const itemQ = query(
            collection(db, COLLECTIONS.WORK_ORDER_ITEMS),
            where('ID', '==', itemId),
            where('Organization_ID', '==', organizationId)
        );
        const itemSnap = await getDocs(itemQ);

        if (itemSnap.empty) {
            return { success: false, message: 'Stavka nije pronađena' };
        }

        const item = itemSnap.docs[0].data() as WorkOrderItem;
        await updateDoc(itemSnap.docs[0].ref, { Status: 'Završeno' });

        // Update product status based on production step
        const productQ = query(
            collection(db, COLLECTIONS.PRODUCTS),
            where('Product_ID', '==', item.Product_ID),
            where('Organization_ID', '==', organizationId)
        );
        const productSnap = await getDocs(productQ);

        if (!productSnap.empty) {
            // Determine next status based on production step
            const statusMap: Record<string, string> = {
                'Rezanje': 'Kantiranje',
                'Kantiranje': 'Bušenje',
                'Bušenje': 'Sklapanje',
                'Sklapanje': 'Spremno',
            };
            const nextStatus = statusMap[productionStep] || 'Spremno';
            await updateDoc(productSnap.docs[0].ref, { Status: nextStatus });

            // Sync project status using centralized function
            if (item.Project_ID) {
                const { syncProjectStatus } = await import('./attendance');
                await syncProjectStatus(item.Project_ID, organizationId);
            }
        }

        return { success: true, message: 'Stavka završena, status proizvoda ažuriran' };
    } catch (error) {
        console.error('completeWorkOrderItem error:', error);
        return { success: false, message: 'Greška pri završavanju stavke' };
    }
}

export async function deleteWorkOrder(
    workOrderId: string,
    organizationId: string,
    productAction: 'completed' | 'waiting' = 'waiting'
): Promise<{ success: boolean; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        // Get items first to update product statuses
        const itemsQ = query(
            collection(db, COLLECTIONS.WORK_ORDER_ITEMS),
            where('Work_Order_ID', '==', workOrderId),
            where('Organization_ID', '==', organizationId)
        );
        const itemsSnap = await getDocs(itemsQ);

        // Determine new product status based on action
        const newProductStatus = productAction === 'completed' ? 'Spremno' : 'Čeka proizvodnju';

        // Update product statuses in projects before deleting
        const projectUpdates = new Map<string, Map<string, string>>();

        for (const itemDoc of itemsSnap.docs) {
            const item = itemDoc.data();
            if (item.Project_ID && item.Product_ID) {
                if (!projectUpdates.has(item.Project_ID)) {
                    projectUpdates.set(item.Project_ID, new Map());
                }
                projectUpdates.get(item.Project_ID)!.set(item.Product_ID, newProductStatus);
            }
        }

        // Update each project's products
        const entries = Array.from(projectUpdates.entries());
        for (const [projectId, productStatuses] of entries) {
            const projectQ = query(
                collection(db, COLLECTIONS.PROJECTS),
                where('Project_ID', '==', projectId),
                where('Organization_ID', '==', organizationId)
            );
            const projectSnap = await getDocs(projectQ);

            if (!projectSnap.empty) {
                const projectData = projectSnap.docs[0].data();
                const products = projectData.products || [];

                const updatedProducts = products.map((p: any) => {
                    const newStatus = productStatuses.get(p.Product_ID);
                    if (newStatus) {
                        // If completing, clear work order reference but keep cost data
                        // If waiting, reset completely
                        if (productAction === 'completed') {
                            return { ...p, Status: newStatus, Work_Order_Quantity: 0 };
                        } else {
                            return { ...p, Status: newStatus, Work_Order_Quantity: 0 };
                        }
                    }
                    return p;
                });

                await updateDoc(projectSnap.docs[0].ref, { products: updatedProducts });
            }
        }

        // Delete items
        const batch = writeBatch(db);
        itemsSnap.docs.forEach(docRef => batch.delete(docRef.ref));

        // Delete work order
        const woQ = query(
            collection(db, COLLECTIONS.WORK_ORDERS),
            where('Work_Order_ID', '==', workOrderId),
            where('Organization_ID', '==', organizationId)
        );
        const woSnap = await getDocs(woQ);
        if (!woSnap.empty) {
            batch.delete(woSnap.docs[0].ref);
        }

        await batch.commit();

        const actionMsg = productAction === 'completed'
            ? 'Radni nalog obrisan, proizvodi označeni kao spremni'
            : 'Radni nalog obrisan, proizvodi vraćeni na čekanje';
        return { success: true, message: actionMsg };
    } catch (error) {
        console.error('deleteWorkOrder error:', error);
        return { success: false, message: 'Greška pri brisanju radnog naloga' };
    }
}

export async function startWorkOrder(workOrderId: string, organizationId: string): Promise<{ success: boolean; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        const q = query(
            collection(db, COLLECTIONS.WORK_ORDERS),
            where('Work_Order_ID', '==', workOrderId),
            where('Organization_ID', '==', organizationId)
        );
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            return { success: false, message: 'Radni nalog nije pronađen' };
        }

        const workOrderData = snapshot.docs[0].data() as WorkOrder;

        // Check if scheduled for future date - cannot start orders scheduled for the future
        if (workOrderData.Is_Scheduled && workOrderData.Planned_Start_Date) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const plannedStart = new Date(workOrderData.Planned_Start_Date);
            plannedStart.setHours(0, 0, 0, 0);

            if (plannedStart > today) {
                return {
                    success: false,
                    message: `Nalog je zakazan za ${workOrderData.Planned_Start_Date}. Može se pokrenuti tek na taj datum.`
                };
            }
        }

        // First fetch items to validate workers and materials
        const itemsQ = query(
            collection(db, COLLECTIONS.WORK_ORDER_ITEMS),
            where('Work_Order_ID', '==', workOrderId),
            where('Organization_ID', '==', organizationId)
        );
        const itemsSnap = await getDocs(itemsQ);

        // VALIDATION 1: Check worker attendance for all assigned workers
        const { canWorkerStartProcess } = await import('./attendance');
        for (const itemDoc of itemsSnap.docs) {
            const item = itemDoc.data() as WorkOrderItem;

            // Check workers in Processes
            if (item.Processes && Array.isArray(item.Processes)) {
                for (const proc of item.Processes) {
                    if (proc.Worker_ID) {
                        const availability = await canWorkerStartProcess(proc.Worker_ID);
                        if (!availability.allowed) {
                            return {
                                success: false,
                                message: `Radnik "${proc.Worker_Name || proc.Worker_ID}" nije prisutan danas. ${availability.reason}`
                            };
                        }
                    }
                    // Check helpers too
                    if (proc.Helpers && Array.isArray(proc.Helpers)) {
                        for (const helper of proc.Helpers) {
                            if (helper.Worker_ID) {
                                const helperAvail = await canWorkerStartProcess(helper.Worker_ID);
                                if (!helperAvail.allowed) {
                                    return {
                                        success: false,
                                        message: `Pomoćnik "${helper.Worker_Name || helper.Worker_ID}" nije prisutan danas. ${helperAvail.reason}`
                                    };
                                }
                            }
                        }
                    }
                }
            }

            // VALIDATION 2: Check essential materials
            if (item.materials && Array.isArray(item.materials)) {
                const missingMaterials = item.materials.filter(
                    (m: any) => m.Is_Essential && m.Status !== 'Primljeno' && m.Status !== 'Na stanju'
                );
                if (missingMaterials.length > 0) {
                    const materialNames = missingMaterials.map((m: any) => m.Material_Name).join(', ');
                    return {
                        success: false,
                        message: `Esencijalni materijali nisu spremni za "${item.Product_Name}": ${materialNames}`
                    };
                }
            }
        }

        // All validations passed - start the work order
        await updateDoc(snapshot.docs[0].ref, {
            Status: 'U toku',
            Started_At: new Date().toISOString()
        });

        // Update all items to "U toku"
        for (const itemDoc of itemsSnap.docs) {
            if (itemDoc.data().Status === 'Na čekanju') {
                await updateDoc(itemDoc.ref, { Status: 'U toku' });
            }
        }

        // Update products to production step status
        const wo = snapshot.docs[0].data() as WorkOrder;
        for (const itemDoc of itemsSnap.docs) {
            const item = itemDoc.data() as WorkOrderItem;
            const productQ = query(
                collection(db, COLLECTIONS.PRODUCTS),
                where('Product_ID', '==', item.Product_ID),
                where('Organization_ID', '==', organizationId)
            );
            const productSnap = await getDocs(productQ);
            if (!productSnap.empty) {
                await updateDoc(productSnap.docs[0].ref, { Status: wo.Production_Steps[0] });
            }

            // Update project to "U proizvodnji" if not already
            const projectQ = query(
                collection(db, COLLECTIONS.PROJECTS),
                where('Project_ID', '==', item.Project_ID),
                where('Organization_ID', '==', organizationId)
            );
            const projectSnap = await getDocs(projectQ);
            if (!projectSnap.empty) {
                const currentStatus = projectSnap.docs[0].data().Status;
                if (currentStatus === 'Odobreno' || currentStatus === 'Nacrt') {
                    await updateDoc(projectSnap.docs[0].ref, { Status: 'U proizvodnji' });
                }
            }
        }

        return { success: true, message: 'Radni nalog pokrenut' };
    } catch (error) {
        console.error('startWorkOrder error:', error);
        return { success: false, message: 'Greška pri pokretanju radnog naloga' };
    }
}

export async function updateWorkOrder(workOrderId: string, updates: Partial<WorkOrder>, organizationId: string): Promise<{ success: boolean; message: string; data?: WorkOrder }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        const db = getDb();
        const q = query(
            collection(db, COLLECTIONS.WORK_ORDERS),
            where('Work_Order_ID', '==', workOrderId),
            where('Organization_ID', '==', organizationId)
        );
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            return { success: false, message: 'Radni nalog nije pronađen' };
        }

        // Update work order main document
        const woRef = snapshot.docs[0].ref;
        const updateData: any = {};

        if (updates.Status) updateData.Status = updates.Status;
        if (updates.Due_Date) updateData.Due_Date = updates.Due_Date;
        if (updates.Notes !== undefined) updateData.Notes = updates.Notes;
        if (updates.Production_Steps) updateData.Production_Steps = updates.Production_Steps;

        if (updates.Status === 'Završeno' && !updates.Completed_Date) {
            updateData.Completed_Date = new Date().toISOString();
        }

        if (Object.keys(updateData).length > 0) {
            await updateDoc(woRef, updateData);
        }

        // Update items if provided
        if (updates.items && Array.isArray(updates.items)) {
            const itemsQ = query(
                collection(db, COLLECTIONS.WORK_ORDER_ITEMS),
                where('Work_Order_ID', '==', workOrderId),
                where('Organization_ID', '==', organizationId)
            );
            const itemsSnap = await getDocs(itemsQ);

            // Create a map of existing items
            const existingItems = new Map();
            itemsSnap.docs.forEach(doc => {
                const data = doc.data();
                existingItems.set(data.ID, { ref: doc.ref, data });
            });

            // Update each item
            for (const item of updates.items) {
                const existingItem = existingItems.get(item.ID);
                if (existingItem) {
                    const itemUpdateData: any = {};

                    if (item.Status) itemUpdateData.Status = item.Status;
                    if (item.Process_Assignments) itemUpdateData.Process_Assignments = item.Process_Assignments;

                    if (Object.keys(itemUpdateData).length > 0) {
                        await updateDoc(existingItem.ref, itemUpdateData);
                    }
                }
            }
        }

        // Fetch updated work order
        const updatedWO = await getWorkOrder(workOrderId, organizationId);

        return { success: true, message: 'Radni nalog ažuriran', data: updatedWO || undefined };
    } catch (error) {
        console.error('updateWorkOrder error:', error);
        return { success: false, message: 'Greška pri ažuriranju radnog naloga' };
    }
}

// ============================================
// PLANNER / GANTT SCHEDULING FUNCTIONS
// ============================================

/**
 * Helper: Get worker IDs from a work order (from Processes and Assigned_Workers)
 */
function getWorkerIdsFromWorkOrder(wo: WorkOrder): string[] {
    const ids = new Set<string>();
    wo.items?.forEach(item => {
        // From Processes
        item.Processes?.forEach(p => {
            if (p.Worker_ID) ids.add(p.Worker_ID);
            p.Helpers?.forEach(h => { if (h.Worker_ID) ids.add(h.Worker_ID); });
        });
        // From Assigned_Workers
        item.Assigned_Workers?.forEach(aw => {
            if (aw.Worker_ID) ids.add(aw.Worker_ID);
        });
    });
    return Array.from(ids);
}

/**
 * Check for worker scheduling conflicts
 * Returns conflicts when workers are already assigned to other work orders in the given date range
 */
export async function checkWorkerConflicts(
    workerIds: string[],
    startDate: string,
    endDate: string,
    excludeWorkOrderId: string | null,
    organizationId: string
): Promise<{ hasConflicts: boolean; conflicts: import('./types').WorkerConflict[] }> {
    if (!organizationId || workerIds.length === 0) {
        return { hasConflicts: false, conflicts: [] };
    }

    try {
        // Get all scheduled work orders
        const scheduledOrders = await getScheduledWorkOrders(organizationId);

        const conflicts: import('./types').WorkerConflict[] = [];
        const newStart = new Date(startDate);
        const newEnd = new Date(endDate);
        newStart.setHours(0, 0, 0, 0);
        newEnd.setHours(23, 59, 59, 999);

        for (const wo of scheduledOrders) {
            // Skip the work order we're scheduling/rescheduling
            if (excludeWorkOrderId && wo.Work_Order_ID === excludeWorkOrderId) continue;

            // Skip completed/cancelled orders
            if (wo.Status === 'Završeno' || wo.Status === 'Otkazano') continue;

            if (!wo.Planned_Start_Date) continue;

            const woStart = new Date(wo.Planned_Start_Date);
            const woEnd = wo.Planned_End_Date ? new Date(wo.Planned_End_Date) : woStart;
            woStart.setHours(0, 0, 0, 0);
            woEnd.setHours(23, 59, 59, 999);

            // Check for date overlap
            const datesOverlap = newStart <= woEnd && newEnd >= woStart;
            if (!datesOverlap) continue;

            // Get workers assigned to this existing order
            const existingWorkerIds = getWorkerIdsFromWorkOrder(wo);

            // Find overlapping workers
            for (const workerId of workerIds) {
                if (existingWorkerIds.includes(workerId)) {
                    // Get worker name from items
                    let workerName = 'Nepoznat radnik';
                    wo.items?.forEach(item => {
                        item.Processes?.forEach(p => {
                            if (p.Worker_ID === workerId && p.Worker_Name) {
                                workerName = p.Worker_Name;
                            }
                            p.Helpers?.forEach(h => {
                                if (h.Worker_ID === workerId && h.Worker_Name) {
                                    workerName = h.Worker_Name;
                                }
                            });
                        });
                        item.Assigned_Workers?.forEach(aw => {
                            if (aw.Worker_ID === workerId && aw.Worker_Name) {
                                workerName = aw.Worker_Name;
                            }
                        });
                    });

                    // Calculate actual overlap period
                    const overlapStart = newStart > woStart ? newStart : woStart;
                    const overlapEnd = newEnd < woEnd ? newEnd : woEnd;

                    // Get project name from first item
                    const projectName = wo.items?.[0]?.Project_Name || 'Nepoznat projekt';

                    conflicts.push({
                        Worker_ID: workerId,
                        Worker_Name: workerName,
                        Conflicting_Work_Order_ID: wo.Work_Order_ID,
                        Conflicting_Work_Order_Number: wo.Work_Order_Number,
                        Conflicting_Project_Name: projectName,
                        Overlap_Start: overlapStart.toISOString().split('T')[0],
                        Overlap_End: overlapEnd.toISOString().split('T')[0],
                    });
                }
            }
        }

        return { hasConflicts: conflicts.length > 0, conflicts };
    } catch (error) {
        console.error('checkWorkerConflicts error:', error);
        return { hasConflicts: false, conflicts: [] };
    }
}

/**
 * Automatically create orders for materials needed by a work order
 * Groups materials by supplier and creates one order per supplier
 * Only orders materials not already received or in stock
 */
export async function autoCreateOrdersForWorkOrder(
    workOrderId: string,
    plannedStartDate: string,
    organizationId: string
): Promise<{ ordersCreated: number; orderNumbers: string[] }> {
    if (!organizationId) {
        return { ordersCreated: 0, orderNumbers: [] };
    }

    try {
        const firestore = getDb();

        // Get the work order to access items
        const workOrder = await getWorkOrder(workOrderId, organizationId);
        if (!workOrder || !workOrder.items) {
            return { ordersCreated: 0, orderNumbers: [] };
        }

        // Collect all materials that need ordering, grouped by supplier
        const materialsBySupplier = new Map<string, {
            supplierName: string;
            materials: Array<{
                productMaterialId: string;
                materialName: string;
                quantity: number;
                unit: string;
                unitPrice: number;
                productId: string;
                productName: string;
                projectId: string;
            }>;
        }>();

        for (const item of workOrder.items) {
            // Get product materials from the database for this item's product
            const productMaterials = await getProductMaterials(item.Product_ID, organizationId);

            for (const material of productMaterials) {
                // Skip materials that are already received or in stock
                if (material.Status === 'Primljeno' || material.Status === 'Na stanju') {
                    continue;
                }

                // Skip if already ordered
                if (material.Status === 'Naručeno' && material.Order_ID) {
                    continue;
                }

                // Calculate quantity needed vs on stock
                const quantityNeeded = (material.Quantity || 0) * (item.Quantity || 1);
                const onStock = material.On_Stock || 0;
                const quantityToOrder = quantityNeeded - onStock;

                if (quantityToOrder <= 0) {
                    continue; // Already have enough in stock
                }

                // Group by supplier
                const supplierKey = material.Supplier || 'Nepoznat dobavljač';
                if (!materialsBySupplier.has(supplierKey)) {
                    materialsBySupplier.set(supplierKey, {
                        supplierName: supplierKey,
                        materials: []
                    });
                }

                materialsBySupplier.get(supplierKey)!.materials.push({
                    productMaterialId: material.ID,
                    materialName: material.Material_Name,
                    quantity: quantityToOrder,
                    unit: material.Unit,
                    unitPrice: material.Unit_Price || 0,
                    productId: item.Product_ID,
                    productName: item.Product_Name,
                    projectId: item.Project_ID || ''
                });
            }
        }

        // Create orders for each supplier
        const orderNumbers: string[] = [];

        // Calculate expected delivery (1 day before start)
        const startDate = new Date(plannedStartDate);
        startDate.setDate(startDate.getDate() - 1);
        const expectedDelivery = startDate.toISOString().split('T')[0];

        for (const group of Array.from(materialsBySupplier.values())) {
            if (group.materials.length === 0) continue;

            // Try to find supplier ID by name
            const suppliers = await getSuppliers(organizationId);
            const supplier = suppliers.find(s => s.Name === group.supplierName);

            // Calculate total amount
            const totalAmount = group.materials.reduce(
                (sum: number, m: { quantity: number; unitPrice: number }) => sum + (m.quantity * m.unitPrice),
                0
            );

            // Create the order
            const orderItems: Partial<OrderItem>[] = group.materials.map((m) => ({
                Product_Material_ID: m.productMaterialId,
                Product_ID: m.productId,
                Product_Name: m.productName,
                Project_ID: m.projectId,
                Material_Name: m.materialName,
                Quantity: m.quantity,
                Unit: m.unit,
                Expected_Price: m.unitPrice,
                Status: 'Naručeno'
            }));

            const result = await createOrder({
                Supplier_ID: supplier?.Supplier_ID || '',
                Supplier_Name: group.supplierName,
                Expected_Delivery: expectedDelivery,
                Total_Amount: totalAmount,
                Notes: `Automatski kreirano za radni nalog. Planirani početak: ${plannedStartDate}`,
                items: orderItems as any
            }, organizationId);

            if (result.success && result.data) {
                orderNumbers.push(result.data.Order_Number);
            }
        }

        if (orderNumbers.length > 0) {
            await createNotification({
                organizationId,
                title: 'Automatski kreirane narudžbe',
                message: `Automatski kreirano ${orderNumbers.length} narudžbi za radni nalog. Brojevi: ${orderNumbers.join(', ')}`,
                type: 'info',
                relatedId: workOrderId,
                link: '/orders'
            }, organizationId);
        }

        return { ordersCreated: orderNumbers.length, orderNumbers };
    } catch (error) {
        console.error('autoCreateOrdersForWorkOrder error:', error);
        return { ordersCreated: 0, orderNumbers: [] };
    }
}

// ============================================
// NOTIFICATIONS
// ============================================

export async function createNotification(
    data: Omit<Notification, 'id' | 'createdAt' | 'read'>,
    organizationId: string
): Promise<string> {
    if (!organizationId) return '';

    try {
        const firestore = getDb();
        const notification: Notification = {
            ...data,
            id: generateUUID(),
            organizationId, // Ensure consistency with type property name
            createdAt: new Date().toISOString(),
            read: false
        };

        await addDoc(collection(firestore, COLLECTIONS.NOTIFICATIONS), notification);
        return notification.id;
    } catch (error) {
        console.error('createNotification error:', error);
        return '';
    }
}

export async function getUnreadNotifications(organizationId: string): Promise<Notification[]> {
    if (!organizationId) return [];

    try {
        const firestore = getDb();
        const q = query(
            collection(firestore, COLLECTIONS.NOTIFICATIONS),
            where('organizationId', '==', organizationId),
            where('read', '==', false)
        );

        const snapshot = await getDocs(q);
        //Sort in memory as composite index might not exist yet
        const notifications = snapshot.docs.map(doc => doc.data() as Notification);
        return notifications.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } catch (error) {
        console.error('getUnreadNotifications error:', error);
        return [];
    }
}

export async function markNotificationAsRead(id: string): Promise<boolean> {
    try {
        const firestore = getDb();
        const docRef = doc(firestore, COLLECTIONS.NOTIFICATIONS, id);
        await updateDoc(docRef, { read: true });
        return true;
    } catch (error) {
        console.error('markNotificationAsRead error:', error);
        return false;
    }
}

export function subscribeToNotifications(
    organizationId: string,
    callback: (notifications: Notification[]) => void
): () => void {
    if (!organizationId) return () => { };

    try {
        const firestore = getDb();
        const q = query(
            collection(firestore, COLLECTIONS.NOTIFICATIONS),
            where('organizationId', '==', organizationId)
        );

        return onSnapshot(q, (snapshot) => {
            const notifications = snapshot.docs.map(doc => ({
                ...(doc.data() as Notification),
                id: doc.id
            }));
            // Sort by date desc
            notifications.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
            callback(notifications);
        });
    } catch (error) {
        console.error('subscribe subscription error:', error);
        return () => { };
    }
}

/**
 * Schedule a work order (add to Gantt/Planner timeline)
 */
export async function scheduleWorkOrder(
    workOrderId: string,
    plannedStartDate: string,
    plannedEndDate: string,
    organizationId: string,
    colorCode?: string
): Promise<{ success: boolean; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        const firestore = getDb();
        const q = query(
            collection(firestore, COLLECTIONS.WORK_ORDERS),
            where('Work_Order_ID', '==', workOrderId),
            where('Organization_ID', '==', organizationId)
        );
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            return { success: false, message: 'Radni nalog nije pronađen' };
        }

        await updateDoc(snapshot.docs[0].ref, {
            Planned_Start_Date: plannedStartDate,
            Planned_End_Date: plannedEndDate,
            Is_Scheduled: true,
            Scheduled_At: new Date().toISOString(),
            ...(colorCode && { Color_Code: colorCode }),
        });

        // AUTO-CREATE TASKS: Check for essential materials that need ordering
        const itemsQ = query(
            collection(firestore, COLLECTIONS.WORK_ORDER_ITEMS),
            where('Work_Order_ID', '==', workOrderId),
            where('Organization_ID', '==', organizationId)
        );
        const itemsSnap = await getDocs(itemsQ);

        let tasksCreated = 0;
        for (const itemDoc of itemsSnap.docs) {
            const item = itemDoc.data();
            if (!item.materials || !Array.isArray(item.materials)) continue;

            // Find essential materials that are not ready
            const essentialMissing = item.materials.filter(
                (m: any) => m.Is_Essential && m.Status !== 'Primljeno' && m.Status !== 'Na stanju'
            );

            for (const material of essentialMissing) {
                // Create a task for this material
                await addDoc(collection(firestore, 'tasks'), {
                    Task_ID: `TASK-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
                    Title: `🚨 Naruči: ${material.Material_Name}`,
                    Description: `Esencijalni materijal za proizvod "${item.Product_Name}" (Nalog: ${workOrderId}). Potrebno primiti prije početka proizvodnje.`,
                    Project_ID: item.Project_ID || null,
                    Due_Date: plannedStartDate,
                    Priority: 'Hitno',
                    Status: 'Novo',
                    Created_At: new Date().toISOString(),
                    Organization_ID: organizationId,
                    Auto_Generated: true,
                    Related_Work_Order: workOrderId,
                    Related_Product: item.Product_ID,
                    Related_Material: material.Material_ID || material.Material_Name
                });
                tasksCreated++;
            }
        }

        // AUTO-CREATE ORDERS: If start date is within 2 days, create orders for missing materials
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const planStart = new Date(plannedStartDate);
        planStart.setHours(0, 0, 0, 0);
        const daysUntilStart = Math.ceil((planStart.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

        let orderMsg = '';
        if (daysUntilStart <= 2) {
            const orderResult = await autoCreateOrdersForWorkOrder(workOrderId, plannedStartDate, organizationId);
            if (orderResult.ordersCreated > 0) {
                orderMsg = ` Automatski kreirano ${orderResult.ordersCreated} narudžbi (${orderResult.orderNumbers.join(', ')}).`;
            }
        }

        const taskMsg = tasksCreated > 0 ? ` Kreirano ${tasksCreated} zadataka za naručivanje materijala.` : '';
        return { success: true, message: `Nalog zakazan u planeru.${taskMsg}${orderMsg}` };
    } catch (error) {
        console.error('scheduleWorkOrder error:', error);
        return { success: false, message: 'Greška pri zakazivanju naloga' };
    }
}

/**
 * Reschedule a work order (update dates via drag/resize on Gantt)
 */
export async function rescheduleWorkOrder(
    workOrderId: string,
    newStartDate: string,
    newEndDate: string,
    organizationId: string
): Promise<{ success: boolean; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        const firestore = getDb();
        const q = query(
            collection(firestore, COLLECTIONS.WORK_ORDERS),
            where('Work_Order_ID', '==', workOrderId),
            where('Organization_ID', '==', organizationId)
        );
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            return { success: false, message: 'Radni nalog nije pronađen' };
        }

        await updateDoc(snapshot.docs[0].ref, {
            Planned_Start_Date: newStartDate,
            Planned_End_Date: newEndDate,
        });

        return { success: true, message: 'Nalog premješten' };
    } catch (error) {
        console.error('rescheduleWorkOrder error:', error);
        return { success: false, message: 'Greška pri premještanju naloga' };
    }
}

/**
 * Remove work order from schedule (keep the work order, just unschedule)
 */
export async function unscheduleWorkOrder(
    workOrderId: string,
    organizationId: string
): Promise<{ success: boolean; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        const firestore = getDb();
        const q = query(
            collection(firestore, COLLECTIONS.WORK_ORDERS),
            where('Work_Order_ID', '==', workOrderId),
            where('Organization_ID', '==', organizationId)
        );
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            return { success: false, message: 'Radni nalog nije pronađen' };
        }

        const workOrderData = snapshot.docs[0].data() as WorkOrder;

        // Block unscheduling of orders that are in progress
        if (workOrderData.Status === 'U toku') {
            return {
                success: false,
                message: 'Nalog U toku se ne može ukloniti iz planera. Prvo pauzirajte ili završite proizvodnju.'
            };
        }

        await updateDoc(snapshot.docs[0].ref, {
            Planned_Start_Date: null,
            Planned_End_Date: null,
            Is_Scheduled: false,
            Scheduled_At: null,
        });

        return { success: true, message: 'Nalog uklonjen iz planera' };
    } catch (error) {
        console.error('unscheduleWorkOrder error:', error);
        return { success: false, message: 'Greška pri uklanjanju iz planera' };
    }
}

/**
 * Get all scheduled work orders for Gantt view
 * Optionally filter by date range
 */
export async function getScheduledWorkOrders(
    organizationId: string,
    dateRange?: { start: string; end: string }
): Promise<WorkOrder[]> {
    if (!organizationId) return [];

    try {
        // Get all work orders (filtering by Is_Scheduled happens client-side for now)
        const workOrders = await getWorkOrders(organizationId);

        // Filter to only scheduled ones
        let scheduled = workOrders.filter(wo => wo.Is_Scheduled === true);

        // Apply date range filter if provided
        if (dateRange) {
            scheduled = scheduled.filter(wo => {
                if (!wo.Planned_Start_Date) return false;
                const start = wo.Planned_Start_Date;
                const end = wo.Planned_End_Date || wo.Planned_Start_Date;
                // Check if order overlaps with range
                return start <= dateRange.end && end >= dateRange.start;
            });
        }

        return scheduled;
    } catch (error) {
        console.error('getScheduledWorkOrders error:', error);
        return [];
    }
}

// ============================================
// WORK LOGS CRUD - Real-time Profit Tracking (Multi-tenancy enabled)
// ============================================

/**
 * Create a new work log entry
 * Records which worker worked on which product on which day
 */
export async function createWorkLog(data: {
    Worker_ID: string;
    Worker_Name: string;
    Daily_Rate: number;
    Work_Order_ID: string;
    Work_Order_Item_ID: string;
    Product_ID: string;
    SubTask_ID?: string;
    Process_Name?: string;
    Hours_Worked?: number;
    Is_From_Attendance?: boolean;
    Notes?: string;
    Date?: string;
}, organizationId: string): Promise<{ success: boolean; data?: { WorkLog_ID: string }; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        const firestore = getDb();
        const now = new Date().toISOString();
        const today = now.split('T')[0]; // YYYY-MM-DD

        const workLogData: WorkLog = {
            WorkLog_ID: generateUUID(),
            Organization_ID: organizationId,
            Date: data.Date || today,
            Worker_ID: data.Worker_ID,
            Worker_Name: data.Worker_Name,
            Daily_Rate: data.Daily_Rate,
            Hours_Worked: data.Hours_Worked ?? 8,
            Work_Order_ID: data.Work_Order_ID,
            Work_Order_Item_ID: data.Work_Order_Item_ID,
            Product_ID: data.Product_ID,
            SubTask_ID: data.SubTask_ID,
            Process_Name: data.Process_Name,
            Is_From_Attendance: data.Is_From_Attendance ?? false,
            Notes: data.Notes,
            Created_At: now,
        };

        // Remove undefined fields
        Object.keys(workLogData).forEach(key =>
            (workLogData as any)[key] === undefined && delete (workLogData as any)[key]
        );

        await addDoc(collection(firestore, COLLECTIONS.WORK_LOGS), workLogData);

        return { success: true, data: { WorkLog_ID: workLogData.WorkLog_ID }, message: 'Work log evidentiran' };
    } catch (error) {
        console.error('createWorkLog error:', error);
        return { success: false, message: 'Greška pri kreiranju work loga' };
    }
}

/**
 * Get all work logs for a specific work order item (product)
 */
export async function getWorkLogsForItem(workOrderItemId: string, organizationId: string): Promise<WorkLog[]> {
    if (!organizationId) return [];

    try {
        const firestore = getDb();
        const q = query(
            collection(firestore, COLLECTIONS.WORK_LOGS),
            where('Work_Order_Item_ID', '==', workOrderItemId),
            where('Organization_ID', '==', organizationId)
        );
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => doc.data() as WorkLog);
    } catch (error) {
        console.error('getWorkLogsForItem error:', error);
        return [];
    }
}

/**
 * Get all work logs for an entire work order
 */
export async function getWorkLogsForWorkOrder(workOrderId: string, organizationId: string): Promise<WorkLog[]> {
    if (!organizationId) return [];

    try {
        const firestore = getDb();
        const q = query(
            collection(firestore, COLLECTIONS.WORK_LOGS),
            where('Work_Order_ID', '==', workOrderId),
            where('Organization_ID', '==', organizationId)
        );
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => doc.data() as WorkLog);
    } catch (error) {
        console.error('getWorkLogsForWorkOrder error:', error);
        return [];
    }
}

/**
 * Calculate total labor cost for a work order item
 * Returns sum of all daily rates for all work logs
 */
export async function calculateItemLaborCost(workOrderItemId: string, organizationId: string): Promise<{
    totalCost: number;
    totalDays: number;
    workerBreakdown: { workerId: string; workerName: string; days: number; cost: number }[];
}> {
    if (!organizationId) {
        return { totalCost: 0, totalDays: 0, workerBreakdown: [] };
    }

    try {
        const logs = await getWorkLogsForItem(workOrderItemId, organizationId);

        // Group by worker
        const workerMap = new Map<string, { workerName: string; days: number; cost: number }>();

        for (const log of logs) {
            const existing = workerMap.get(log.Worker_ID);
            if (existing) {
                existing.days += 1;
                existing.cost += log.Daily_Rate;
            } else {
                workerMap.set(log.Worker_ID, {
                    workerName: log.Worker_Name,
                    days: 1,
                    cost: log.Daily_Rate,
                });
            }
        }

        const workerBreakdown = Array.from(workerMap.entries()).map(([workerId, data]) => ({
            workerId,
            workerName: data.workerName,
            days: data.days,
            cost: data.cost,
        }));

        const totalCost = logs.reduce((sum, log) => sum + log.Daily_Rate, 0);
        const totalDays = logs.length;

        return { totalCost, totalDays, workerBreakdown };
    } catch (error) {
        console.error('calculateItemLaborCost error:', error);
        return { totalCost: 0, totalDays: 0, workerBreakdown: [] };
    }
}

/**
 * Delete a work log entry
 */
export async function deleteWorkLog(workLogId: string, organizationId: string): Promise<{ success: boolean; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        const firestore = getDb();
        const q = query(
            collection(firestore, COLLECTIONS.WORK_LOGS),
            where('WorkLog_ID', '==', workLogId),
            where('Organization_ID', '==', organizationId)
        );
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            return { success: false, message: 'Work log nije pronađen' };
        }

        await deleteDoc(snapshot.docs[0].ref);
        return { success: true, message: 'Work log obrisan' };
    } catch (error) {
        console.error('deleteWorkLog error:', error);
        return { success: false, message: 'Greška pri brisanju work loga' };
    }
}

/**
 * Delete ALL work logs for a specific worker on a specific date.
 * Called when attendance changes from working (Prisutan/Teren) to non-working status,
 * ensuring stale work logs don't inflate labor cost calculations.
 */
export async function deleteWorkLogsForWorkerOnDate(
    workerId: string,
    date: string,
    organizationId: string
): Promise<{ deleted: number }> {
    if (!organizationId) return { deleted: 0 };

    try {
        const firestore = getDb();
        const q = query(
            collection(firestore, COLLECTIONS.WORK_LOGS),
            where('Worker_ID', '==', workerId),
            where('Date', '==', date),
            where('Organization_ID', '==', organizationId)
        );
        const snapshot = await getDocs(q);

        if (snapshot.empty) return { deleted: 0 };

        // Batch delete all matching work logs
        const batch = writeBatch(firestore);
        snapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();

        console.log(`Deleted ${snapshot.size} work logs for worker ${workerId} on ${date}`);
        return { deleted: snapshot.size };
    } catch (error) {
        console.error('deleteWorkLogsForWorkerOnDate error:', error);
        throw error; // Propagate error — caller must handle inconsistency
    }
}


/**
 * Check if a work log already exists for a worker/item/date combination
 * Prevents duplicate entries
 */
export async function workLogExists(workerId: string, workOrderItemId: string, date: string, organizationId: string): Promise<boolean> {
    if (!organizationId) return false;

    try {
        const firestore = getDb();
        const q = query(
            collection(firestore, COLLECTIONS.WORK_LOGS),
            where('Worker_ID', '==', workerId),
            where('Work_Order_Item_ID', '==', workOrderItemId),
            where('Date', '==', date),
            where('Organization_ID', '==', organizationId)
        );
        const snapshot = await getDocs(q);
        return !snapshot.empty;
    } catch (error) {
        console.error('workLogExists error:', error);
        return false;
    }
}

// ============================================
// TASKS CRUD (Multi-tenancy enabled)
// ============================================

export async function getTasks(organizationId: string): Promise<Task[]> {
    if (!organizationId) return [];
    const firestore = getDb();
    const q = query(collection(firestore, COLLECTIONS.TASKS), where('Organization_ID', '==', organizationId));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ ...doc.data() } as Task));
}

export async function getTask(taskId: string, organizationId: string): Promise<Task | null> {
    if (!organizationId) return null;
    const firestore = getDb();
    const q = query(
        collection(firestore, COLLECTIONS.TASKS),
        where('Task_ID', '==', taskId),
        where('Organization_ID', '==', organizationId)
    );
    const snapshot = await getDocs(q);
    if (snapshot.empty) return null;
    return snapshot.docs[0].data() as Task;
}

export async function saveTask(data: Partial<Task>, organizationId: string): Promise<{ success: boolean; data?: { Task_ID: string }; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }
    try {
        const firestore = getDb();
        const isNew = !data.Task_ID;

        // Remove undefined values - Firebase doesn't accept undefined
        const cleanData = Object.fromEntries(
            Object.entries(data).filter(([_, value]) => value !== undefined)
        ) as Partial<Task>;

        if (isNew) {
            cleanData.Task_ID = generateUUID();
            cleanData.Organization_ID = organizationId;
            cleanData.Created_Date = new Date().toISOString();
            cleanData.Status = cleanData.Status || 'pending';
            cleanData.Priority = cleanData.Priority || 'medium';
            cleanData.Category = cleanData.Category || 'general';
            cleanData.Links = cleanData.Links || [];
            cleanData.Checklist = cleanData.Checklist || [];
            await addDoc(collection(firestore, COLLECTIONS.TASKS), cleanData);
        } else {
            const q = query(
                collection(firestore, COLLECTIONS.TASKS),
                where('Task_ID', '==', cleanData.Task_ID),
                where('Organization_ID', '==', organizationId)
            );
            const snapshot = await getDocs(q);
            if (!snapshot.empty) {
                await updateDoc(snapshot.docs[0].ref, cleanData as Record<string, unknown>);
            }
        }

        return { success: true, data: { Task_ID: cleanData.Task_ID! }, message: isNew ? 'Zadatak kreiran' : 'Zadatak ažuriran' };
    } catch (error) {
        console.error('saveTask error:', error);
        return { success: false, message: 'Greška pri spremanju zadatka' };
    }
}

export async function deleteTask(taskId: string, organizationId: string): Promise<{ success: boolean; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }
    try {
        const firestore = getDb();
        const q = query(
            collection(firestore, COLLECTIONS.TASKS),
            where('Task_ID', '==', taskId),
            where('Organization_ID', '==', organizationId)
        );
        const snapshot = await getDocs(q);
        if (!snapshot.empty) {
            await deleteDoc(snapshot.docs[0].ref);
        }
        return { success: true, message: 'Zadatak obrisan' };
    } catch (error) {
        console.error('deleteTask error:', error);
        return { success: false, message: 'Greška pri brisanju zadatka' };
    }
}

export async function updateTaskStatus(taskId: string, status: Task['Status'], organizationId: string): Promise<{ success: boolean; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }
    try {
        const firestore = getDb();
        const q = query(
            collection(firestore, COLLECTIONS.TASKS),
            where('Task_ID', '==', taskId),
            where('Organization_ID', '==', organizationId)
        );
        const snapshot = await getDocs(q);
        if (!snapshot.empty) {
            const updates: Record<string, unknown> = { Status: status };
            if (status === 'completed') {
                updates.Completed_Date = new Date().toISOString();
            }
            await updateDoc(snapshot.docs[0].ref, updates);
        }
        return { success: true, message: 'Status ažuriran' };
    } catch (error) {
        console.error('updateTaskStatus error:', error);
        return { success: false, message: 'Greška pri ažuriranju statusa' };
    }
}

export async function toggleTaskChecklistItem(taskId: string, checklistItemId: string, organizationId: string): Promise<{ success: boolean; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }
    try {
        const firestore = getDb();
        const q = query(
            collection(firestore, COLLECTIONS.TASKS),
            where('Task_ID', '==', taskId),
            where('Organization_ID', '==', organizationId)
        );
        const snapshot = await getDocs(q);
        if (!snapshot.empty) {
            const task = snapshot.docs[0].data() as Task;
            const checklist = task.Checklist || [];
            const updatedChecklist = checklist.map(item =>
                item.id === checklistItemId ? { ...item, completed: !item.completed } : item
            );
            await updateDoc(snapshot.docs[0].ref, { Checklist: updatedChecklist });
        }
        return { success: true, message: 'Checklist ažuriran' };
    } catch (error) {
        console.error('toggleTaskChecklistItem error:', error);
        return { success: false, message: 'Greška pri ažuriranju checkliste' };
    }
}

// ============================================
// BATCH TASK OPERATIONS (Performance Optimized)
// ============================================

export interface TaskFilter {
    status?: Task['Status'] | Task['Status'][];
    priority?: Task['Priority'] | Task['Priority'][];
    category?: Task['Category'] | Task['Category'][];
    dueDateFrom?: string;
    dueDateTo?: string;
    assignedWorkerId?: string;
    hasLinks?: boolean;
}

export async function batchUpdateTasks(
    taskIds: string[],
    updates: Partial<Task>,
    organizationId: string
): Promise<{ success: boolean; updatedCount: number; message: string }> {
    if (!organizationId) {
        return { success: false, updatedCount: 0, message: 'Organization ID is required' };
    }
    if (taskIds.length === 0) {
        return { success: true, updatedCount: 0, message: 'Nema zadataka za ažuriranje' };
    }

    try {
        const firestore = getDb();
        const batch = writeBatch(firestore);
        let updatedCount = 0;

        // Process in chunks of 30 (Firestore 'in' query limit)
        const chunkSize = 30;
        for (let i = 0; i < taskIds.length; i += chunkSize) {
            const chunkIds = taskIds.slice(i, i + chunkSize);
            const q = query(
                collection(firestore, COLLECTIONS.TASKS),
                where('Task_ID', 'in', chunkIds),
                where('Organization_ID', '==', organizationId)
            );
            const snapshot = await getDocs(q);

            snapshot.docs.forEach(docSnap => {
                // Remove undefined values and Organization_ID from updates
                const cleanUpdates = Object.fromEntries(
                    Object.entries(updates).filter(([key, value]) =>
                        value !== undefined && key !== 'Organization_ID' && key !== 'Task_ID'
                    )
                );

                // Add completion date if marking as completed
                if (updates.Status === 'completed' && !cleanUpdates.Completed_Date) {
                    cleanUpdates.Completed_Date = new Date().toISOString();
                }

                batch.update(docSnap.ref, cleanUpdates);
                updatedCount++;
            });
        }

        await batch.commit();
        return { success: true, updatedCount, message: `${updatedCount} zadataka ažurirano` };
    } catch (error) {
        console.error('batchUpdateTasks error:', error);
        return { success: false, updatedCount: 0, message: 'Greška pri batch ažuriranju' };
    }
}

export async function batchDeleteTasks(
    taskIds: string[],
    organizationId: string
): Promise<{ success: boolean; deletedCount: number; message: string }> {
    if (!organizationId) {
        return { success: false, deletedCount: 0, message: 'Organization ID is required' };
    }
    if (taskIds.length === 0) {
        return { success: true, deletedCount: 0, message: 'Nema zadataka za brisanje' };
    }

    try {
        const firestore = getDb();
        const batch = writeBatch(firestore);
        let deletedCount = 0;

        const chunkSize = 30;
        for (let i = 0; i < taskIds.length; i += chunkSize) {
            const chunkIds = taskIds.slice(i, i + chunkSize);
            const q = query(
                collection(firestore, COLLECTIONS.TASKS),
                where('Task_ID', 'in', chunkIds),
                where('Organization_ID', '==', organizationId)
            );
            const snapshot = await getDocs(q);

            snapshot.docs.forEach(docSnap => {
                batch.delete(docSnap.ref);
                deletedCount++;
            });
        }

        await batch.commit();
        return { success: true, deletedCount, message: `${deletedCount} zadataka obrisano` };
    } catch (error) {
        console.error('batchDeleteTasks error:', error);
        return { success: false, deletedCount: 0, message: 'Greška pri batch brisanju' };
    }
}

// ============================================
// REAL-TIME TASK SUBSCRIPTION
// ============================================

export function subscribeToTasks(
    organizationId: string,
    callback: (tasks: Task[]) => void
): () => void {
    if (!organizationId) {
        callback([]);
        return () => { };
    }

    const firestore = getDb();
    const q = query(
        collection(firestore, COLLECTIONS.TASKS),
        where('Organization_ID', '==', organizationId)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
        const tasks = snapshot.docs.map(doc => ({ ...doc.data() } as Task));
        // Sort by due date (nulls last), then by priority
        tasks.sort((a, b) => {
            // Completed tasks last
            if (a.Status === 'completed' && b.Status !== 'completed') return 1;
            if (a.Status !== 'completed' && b.Status === 'completed') return -1;

            // Priority order: urgent > high > medium > low
            const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
            const priorityDiff = priorityOrder[a.Priority] - priorityOrder[b.Priority];
            if (priorityDiff !== 0) return priorityDiff;

            // Due date (nulls last)
            if (!a.Due_Date && b.Due_Date) return 1;
            if (a.Due_Date && !b.Due_Date) return -1;
            if (a.Due_Date && b.Due_Date) {
                return new Date(a.Due_Date).getTime() - new Date(b.Due_Date).getTime();
            }

            return 0;
        });

        callback(tasks);
    }, (error) => {
        console.error('subscribeToTasks error:', error);
        callback([]);
    });

    return unsubscribe;
}

// ============================================
// OPTIMIZED TASK QUERIES
// ============================================

export async function getTodaysTasks(organizationId: string): Promise<Task[]> {
    if (!organizationId) return [];

    const today = new Date().toISOString().split('T')[0];
    const firestore = getDb();

    const q = query(
        collection(firestore, COLLECTIONS.TASKS),
        where('Organization_ID', '==', organizationId),
        where('Due_Date', '>=', today),
        where('Due_Date', '<', today + 'T23:59:59.999Z')
    );

    try {
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({ ...doc.data() } as Task));
    } catch {
        // Firestore may not support this exact query, fallback to client filtering
        const allTasks = await getTasks(organizationId);
        return allTasks.filter(t => t.Due_Date?.startsWith(today));
    }
}

export async function getOverdueTasks(organizationId: string): Promise<Task[]> {
    if (!organizationId) return [];

    const today = new Date().toISOString().split('T')[0];
    const allTasks = await getTasks(organizationId);

    return allTasks.filter(t =>
        t.Due_Date &&
        t.Due_Date < today &&
        t.Status !== 'completed' &&
        t.Status !== 'cancelled'
    );
}

export async function getTasksByFilter(
    filter: TaskFilter,
    organizationId: string
): Promise<Task[]> {
    if (!organizationId) return [];

    const allTasks = await getTasks(organizationId);

    return allTasks.filter(task => {
        // Status filter
        if (filter.status) {
            const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
            if (!statuses.includes(task.Status)) return false;
        }

        // Priority filter
        if (filter.priority) {
            const priorities = Array.isArray(filter.priority) ? filter.priority : [filter.priority];
            if (!priorities.includes(task.Priority)) return false;
        }

        // Category filter
        if (filter.category) {
            const categories = Array.isArray(filter.category) ? filter.category : [filter.category];
            if (!categories.includes(task.Category)) return false;
        }

        // Due date range filter
        if (filter.dueDateFrom && task.Due_Date && task.Due_Date < filter.dueDateFrom) return false;
        if (filter.dueDateTo && task.Due_Date && task.Due_Date > filter.dueDateTo) return false;

        // Assigned worker filter
        if (filter.assignedWorkerId && task.Assigned_Worker_ID !== filter.assignedWorkerId) return false;

        // Has links filter
        if (filter.hasLinks !== undefined) {
            const hasLinks = task.Links && task.Links.length > 0;
            if (filter.hasLinks !== hasLinks) return false;
        }

        return true;
    });
}

// ============================================
// ENHANCED CHECKLIST OPERATIONS
// ============================================

export async function addChecklistItem(
    taskId: string,
    itemText: string,
    organizationId: string
): Promise<{ success: boolean; itemId?: string; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        const firestore = getDb();
        const q = query(
            collection(firestore, COLLECTIONS.TASKS),
            where('Task_ID', '==', taskId),
            where('Organization_ID', '==', organizationId)
        );
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            return { success: false, message: 'Zadatak nije pronađen' };
        }

        const task = snapshot.docs[0].data() as Task;
        const newItem: ChecklistItem = {
            id: generateUUID(),
            text: itemText,
            completed: false
        };

        const updatedChecklist = [...(task.Checklist || []), newItem];
        await updateDoc(snapshot.docs[0].ref, { Checklist: updatedChecklist });

        return { success: true, itemId: newItem.id, message: 'Stavka dodana' };
    } catch (error) {
        console.error('addChecklistItem error:', error);
        return { success: false, message: 'Greška pri dodavanju stavke' };
    }
}

export async function removeChecklistItem(
    taskId: string,
    itemId: string,
    organizationId: string
): Promise<{ success: boolean; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        const firestore = getDb();
        const q = query(
            collection(firestore, COLLECTIONS.TASKS),
            where('Task_ID', '==', taskId),
            where('Organization_ID', '==', organizationId)
        );
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            return { success: false, message: 'Zadatak nije pronađen' };
        }

        const task = snapshot.docs[0].data() as Task;
        const updatedChecklist = (task.Checklist || []).filter(item => item.id !== itemId);
        await updateDoc(snapshot.docs[0].ref, { Checklist: updatedChecklist });

        return { success: true, message: 'Stavka uklonjena' };
    } catch (error) {
        console.error('removeChecklistItem error:', error);
        return { success: false, message: 'Greška pri uklanjanju stavke' };
    }
}

export async function batchToggleChecklistItems(
    taskId: string,
    itemIds: string[],
    completed: boolean,
    organizationId: string
): Promise<{ success: boolean; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        const firestore = getDb();
        const q = query(
            collection(firestore, COLLECTIONS.TASKS),
            where('Task_ID', '==', taskId),
            where('Organization_ID', '==', organizationId)
        );
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            return { success: false, message: 'Zadatak nije pronađen' };
        }

        const task = snapshot.docs[0].data() as Task;
        const itemIdSet = new Set(itemIds);
        const updatedChecklist = (task.Checklist || []).map(item =>
            itemIdSet.has(item.id) ? { ...item, completed } : item
        );

        await updateDoc(snapshot.docs[0].ref, { Checklist: updatedChecklist });

        return { success: true, message: `${itemIds.length} stavki ažurirano` };
    } catch (error) {
        console.error('batchToggleChecklistItems error:', error);
        return { success: false, message: 'Greška pri batch ažuriranju checkliste' };
    }
}

// ============================================
// TASK STATISTICS
// ============================================

export interface TaskStats {
    total: number;
    pending: number;
    in_progress: number;
    completed: number;
    cancelled: number;
    overdue: number;
    dueToday: number;
    highPriority: number;
    completionRate: number;
}

export async function getTaskStats(organizationId: string): Promise<TaskStats> {
    if (!organizationId) {
        return {
            total: 0, pending: 0, in_progress: 0, completed: 0, cancelled: 0,
            overdue: 0, dueToday: 0, highPriority: 0, completionRate: 0
        };
    }

    const tasks = await getTasks(organizationId);
    const today = new Date().toISOString().split('T')[0];

    const stats: TaskStats = {
        total: tasks.length,
        pending: tasks.filter(t => t.Status === 'pending').length,
        in_progress: tasks.filter(t => t.Status === 'in_progress').length,
        completed: tasks.filter(t => t.Status === 'completed').length,
        cancelled: tasks.filter(t => t.Status === 'cancelled').length,
        overdue: tasks.filter(t => t.Due_Date && t.Due_Date < today && t.Status !== 'completed' && t.Status !== 'cancelled').length,
        dueToday: tasks.filter(t => t.Due_Date?.startsWith(today)).length,
        highPriority: tasks.filter(t => (t.Priority === 'high' || t.Priority === 'urgent') && t.Status !== 'completed').length,
        completionRate: 0
    };

    const relevantTasks = tasks.filter(t => t.Status !== 'cancelled');
    if (relevantTasks.length > 0) {
        stats.completionRate = Math.round((stats.completed / relevantTasks.length) * 100);
    }

    return stats;
}

// ============================================
// PRODUCTION SNAPSHOTS - AI/ML Training Data
// ============================================

/**
 * Create a production snapshot when a work order is completed.
 * This captures denormalized data for AI/ML training purposes.
 * ENHANCED: Now includes offer data, process timing, surface area, and material ratios.
 */
export async function createProductionSnapshot(
    workOrderId: string,
    organizationId: string
): Promise<{ success: boolean; snapshotId?: string; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        const firestore = getDb();

        // 1. Get Work Order with items
        const workOrder = await getWorkOrder(workOrderId, organizationId);
        if (!workOrder) {
            return { success: false, message: 'Work order not found' };
        }

        // 2. Get Project
        const projectQ = query(
            collection(firestore, COLLECTIONS.PROJECTS),
            where('Project_ID', '==', workOrder.items?.[0]?.Project_ID || ''),
            where('Organization_ID', '==', organizationId)
        );
        const projectSnap = await getDocs(projectQ);
        const project = projectSnap.docs[0]?.data() as Project | undefined;

        // 3. Get Offer for this project (if exists)
        let offer: Offer | undefined;
        let offerProducts: OfferProduct[] = [];
        if (project?.Project_ID) {
            const offerQ = query(
                collection(firestore, COLLECTIONS.OFFERS),
                where('Project_ID', '==', project.Project_ID),
                where('Organization_ID', '==', organizationId)
            );
            const offerSnap = await getDocs(offerQ);
            if (!offerSnap.empty) {
                offer = offerSnap.docs[0].data() as Offer;
                // Get offer products
                const offerProdsQ = query(
                    collection(firestore, COLLECTIONS.OFFER_PRODUCTS),
                    where('Offer_ID', '==', offer.Offer_ID),
                    where('Organization_ID', '==', organizationId)
                );
                const offerProdsSnap = await getDocs(offerProdsQ);
                offerProducts = offerProdsSnap.docs.map(d => d.data() as OfferProduct);

                // Get extras for each offer product
                for (const op of offerProducts) {
                    const extrasQ = query(
                        collection(firestore, COLLECTIONS.OFFER_EXTRAS),
                        where('Offer_Product_ID', '==', op.ID),
                        where('Organization_ID', '==', organizationId)
                    );
                    const extrasSnap = await getDocs(extrasQ);
                    op.extras = extrasSnap.docs.map(d => d.data() as OfferExtra);
                }
            }
        }

        // 4. Get all work logs for this work order
        const workLogsQ = query(
            collection(firestore, COLLECTIONS.WORK_LOGS),
            where('Work_Order_ID', '==', workOrderId),
            where('Organization_ID', '==', organizationId)
        );
        const workLogsSnap = await getDocs(workLogsQ);
        const workLogs = workLogsSnap.docs.map(doc => doc.data() as WorkLog);

        // 5. Get workers for enrichment
        const workersQ = query(
            collection(firestore, COLLECTIONS.WORKERS),
            where('Organization_ID', '==', organizationId)
        );
        const workersSnap = await getDocs(workersQ);
        const workersMap = new Map<string, Worker>();
        workersSnap.docs.forEach(doc => {
            const w = doc.data() as Worker;
            workersMap.set(w.Worker_ID, w);
        });

        // 6. Build snapshot items
        const snapshotItems: ProductionSnapshotItem[] = [];
        let totalMaterialCost = 0;
        let totalSellingPrice = 0;
        let totalQuantity = 0;
        let totalSurfaceM2 = 0;
        let totalVolumeM3 = 0;

        for (const item of workOrder.items || []) {
            // Get product details
            const product = await getProduct(item.Product_ID, organizationId);
            const height = product?.Height || 0;
            const width = product?.Width || 0;
            const depth = product?.Depth || 0;
            const volume = (height * width * depth) / 1000000000; // Convert mm³ to m³
            const surface = (height * width) / 1000000; // Convert mm² to m²

            // Infer Product Type from name
            const productName = item.Product_Name?.toLowerCase() || '';
            let productType = 'Ostalo';
            if (productName.includes('kuhinja') || productName.includes('kuh')) productType = 'Kuhinja';
            else if (productName.includes('ormar') || productName.includes('garderob')) productType = 'Ormar';
            else if (productName.includes('komoda')) productType = 'Komoda';
            else if (productName.includes('stol') || productName.includes('radni')) productType = 'Stol';
            else if (productName.includes('polica')) productType = 'Polica';
            else if (productName.includes('vrata')) productType = 'Vrata';

            // Get materials
            const materials = await getProductMaterials(item.Product_ID, organizationId);
            const materialSnapshotTime = new Date().toISOString();
            const snapshotMaterials: SnapshotMaterial[] = materials.map(m => ({
                Material_ID: m.ID,
                Material_Name: m.Material_Name,
                Category: m.Supplier || 'Ostalo',
                Quantity: m.Quantity,
                Unit: m.Unit,
                Unit_Price: m.Unit_Price,
                Total_Price: m.Total_Price,
                Is_Glass: (m.glassItems && m.glassItems.length > 0) || false,
                Is_Alu_Door: (m.aluDoorItems && m.aluDoorItems.length > 0) || false,
                Price_Captured_At: materialSnapshotTime,
                Is_Final_Price: true  // Captured at work order completion
            }));

            const hasGlass = materials.some(m => m.glassItems && m.glassItems.length > 0);
            const hasAluDoor = materials.some(m => m.aluDoorItems && m.aluDoorItems.length > 0);
            const itemMaterialCost = materials.reduce((sum, m) => sum + (m.Total_Price || 0), 0);

            // Calculate material ratios
            const materialPerM2 = surface > 0 ? itemMaterialCost / surface : 0;
            const materialPerM3 = volume > 0 ? itemMaterialCost / volume : 0;
            const materialPerUnit = item.Quantity > 0 ? itemMaterialCost / item.Quantity : 0;

            // Get workers for this item from work logs
            const itemWorkLogs = workLogs.filter(wl => wl.Work_Order_Item_ID === item.ID);
            const workerDaysMap = new Map<string, { days: number; cost: number; name: string }>();

            itemWorkLogs.forEach(wl => {
                const existing = workerDaysMap.get(wl.Worker_ID) || { days: 0, cost: 0, name: wl.Worker_Name };
                existing.days += 1;
                existing.cost += wl.Daily_Rate;
                existing.name = wl.Worker_Name;
                workerDaysMap.set(wl.Worker_ID, existing);
            });

            const snapshotWorkers: SnapshotWorker[] = Array.from(workerDaysMap.entries()).map(([workerId, data]) => {
                const worker = workersMap.get(workerId);
                return {
                    Worker_ID: workerId,
                    Worker_Name: data.name,
                    Role: worker?.Role || 'Opći',
                    Worker_Type: worker?.Worker_Type || 'Glavni',
                    Days_Worked: data.days,
                    Daily_Rate: data.cost / data.days,
                    Total_Cost: data.cost
                };
            });

            // Get process timing from item.Processes
            const snapshotProcesses: SnapshotProcess[] = ((item as any).Processes || []).map((p: any) => {
                let durationDays = 0;
                if (p.Started_At && p.Completed_At) {
                    const start = new Date(p.Started_At);
                    const end = new Date(p.Completed_At);
                    durationDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) || 1;
                }
                return {
                    Process_Name: p.Process_Name || 'Unknown',
                    Status: p.Status || 'Unknown',
                    Started_At: p.Started_At,
                    Completed_At: p.Completed_At,
                    Duration_Days: durationDays,
                    Worker_ID: p.Worker_ID,
                    Worker_Name: p.Worker_Name,
                    Helpers_Count: p.Helpers?.length || 0
                };
            });

            // Get offer data for this product
            const offerProduct = offerProducts.find(op => op.Product_ID === item.Product_ID);
            const ledMeters = offerProduct?.LED_Meters || 0;
            const ledPricePerMeter = offerProduct?.LED_Price || 0;
            const ledTotal = offerProduct?.LED_Total || 0;
            const marginPercent = offerProduct?.Margin || 0;
            const marginType = offerProduct?.Margin_Type || 'Percentage';
            const transportShare = offerProduct?.Transport_Share || 0;

            // Get extras
            const snapshotExtras: SnapshotExtra[] = (offerProduct?.extras || []).map(e => ({
                Name: e.Name,
                Quantity: e.Quantity,
                Unit: e.Unit,
                Unit_Price: e.Unit_Price,
                Total: e.Total
            }));

            const actualLaborDays = itemWorkLogs.length;
            const sellingPrice = item.Product_Value || offerProduct?.Selling_Price || 0;
            // STANDARDIZED: Use fresh labor from work logs and include Transport + Services
            const freshItemLaborCost = itemWorkLogs.reduce((sum, wl) => sum + (wl.Daily_Rate || 0), 0);
            const itemServicesTotal = (offerProduct?.extras || []).reduce((s, e) => s + (e.Total || 0), 0);
            const profit = sellingPrice - itemMaterialCost - transportShare - itemServicesTotal - freshItemLaborCost;

            snapshotItems.push({
                Product_ID: item.Product_ID,
                Product_Name: item.Product_Name,
                Product_Type: productType,
                Height: height,
                Width: width,
                Depth: depth,
                Volume_M3: volume,
                Surface_M2: surface,
                Quantity: item.Quantity,
                Materials: snapshotMaterials,
                Material_Count: materials.length,
                Has_Glass: hasGlass,
                Has_Alu_Door: hasAluDoor,
                Total_Material_Cost: itemMaterialCost,
                Material_Per_M2: Math.round(materialPerM2 * 100) / 100,
                Material_Per_M3: Math.round(materialPerM3 * 100) / 100,
                Material_Per_Unit: Math.round(materialPerUnit * 100) / 100,
                Planned_Labor_Days: item.Planned_Labor_Days || 0,
                Actual_Labor_Days: actualLaborDays,
                Workers_Assigned: snapshotWorkers,
                Processes: snapshotProcesses,
                Selling_Price: sellingPrice,
                Margin_Percent: marginPercent,
                Margin_Type: marginType,
                LED_Meters: ledMeters,
                LED_Price_Per_Meter: ledPricePerMeter,
                LED_Total: ledTotal,
                Transport_Share: transportShare,
                Extras: snapshotExtras,
                Profit: profit,
                Margin_Applied: marginPercent // Legacy
            });

            totalMaterialCost += itemMaterialCost;
            totalSellingPrice += sellingPrice;
            totalQuantity += item.Quantity;
            totalSurfaceM2 += surface * item.Quantity;
            totalVolumeM3 += volume * item.Quantity;
        }

        // 7. Calculate aggregates
        const plannedDays = workOrder.Planned_Labor_Cost && workOrder.Actual_Labor_Cost
            ? Math.round(workOrder.Planned_Labor_Cost / 100)
            : 0;

        const actualStartDate = workOrder.Started_At ? new Date(workOrder.Started_At) : new Date();
        const actualEndDate = workOrder.Completed_At ? new Date(workOrder.Completed_At) : new Date();
        const actualDays = Math.ceil((actualEndDate.getTime() - actualStartDate.getTime()) / (1000 * 60 * 60 * 24)) || 1;

        // Worker aggregates
        const uniqueWorkers = new Set(workLogs.map(wl => wl.Worker_ID));
        const totalWorkerDays = workLogs.length;
        const avgDailyRate = totalWorkerDays > 0
            ? workLogs.reduce((sum, wl) => sum + wl.Daily_Rate, 0) / totalWorkerDays
            : 0;

        // Calculate fresh labor cost from work_logs (not stale stored value)
        const freshLaborCost = workLogs.reduce((sum, wl) => sum + (wl.Daily_Rate || 0), 0);

        // Calculate Transport and Services totals from items
        const totalTransportCost = snapshotItems.reduce((sum, i) => sum + (i.Transport_Share || 0), 0);
        const totalServicesCost = snapshotItems.reduce((sum, i) =>
            sum + (i.Extras?.reduce((s, e) => s + (e.Total || 0), 0) || 0), 0);

        // STANDARDIZED PROFIT FORMULA (consistent with calculateProductProfitability)
        // Gross Profit = Selling - Material - Transport - Services
        // Net Profit = Gross - Labor
        const grossProfit = totalSellingPrice - totalMaterialCost - totalTransportCost - totalServicesCost;
        const netProfit = grossProfit - freshLaborCost;
        const profitMargin = totalSellingPrice > 0 ? (netProfit / totalSellingPrice) * 100 : 0;

        // Aggregate material ratios
        const avgMaterialPerM2 = totalSurfaceM2 > 0 ? totalMaterialCost / totalSurfaceM2 : 0;
        const avgMaterialPerM3 = totalVolumeM3 > 0 ? totalMaterialCost / totalVolumeM3 : 0;

        // 8. Create the snapshot
        const snapshotId = generateUUID();
        const snapshot: ProductionSnapshot = {
            Snapshot_ID: snapshotId,
            Organization_ID: organizationId,
            Work_Order_ID: workOrderId,
            Work_Order_Number: workOrder.Work_Order_Number,
            Created_At: new Date().toISOString(),

            Project_ID: project?.Project_ID || '',
            Client_Name: project?.Client_Name || 'Unknown',
            Project_Deadline: project?.Deadline || '',

            // Offer Info
            Offer_ID: offer?.Offer_ID,
            Offer_Number: offer?.Offer_Number,
            Offer_Total: offer?.Total,
            Offer_Transport_Cost: offer?.Transport_Cost,
            Offer_Has_Onsite_Assembly: offer?.Onsite_Assembly,

            Items: snapshotItems,

            Total_Products: snapshotItems.length,
            Total_Quantity: totalQuantity,
            Total_Material_Cost: totalMaterialCost,
            Total_Selling_Price: totalSellingPrice,

            Avg_Material_Per_M2: Math.round(avgMaterialPerM2 * 100) / 100,
            Avg_Material_Per_M3: Math.round(avgMaterialPerM3 * 100) / 100,

            Planned_Start: workOrder.Planned_Start_Date,
            Planned_End: workOrder.Planned_End_Date,
            Actual_Start: workOrder.Started_At,
            Actual_End: workOrder.Completed_At,
            Planned_Days: plannedDays,
            Actual_Days: actualDays,
            Duration_Variance: actualDays - plannedDays,

            Planned_Labor_Cost: workOrder.Planned_Labor_Cost || 0,
            Actual_Labor_Cost: workOrder.Actual_Labor_Cost || 0,
            Labor_Cost_Variance: (workOrder.Planned_Labor_Cost || 0) - (workOrder.Actual_Labor_Cost || 0),
            Labor_Variance_Percent: workOrder.Planned_Labor_Cost
                ? (((workOrder.Planned_Labor_Cost - (workOrder.Actual_Labor_Cost || 0)) / workOrder.Planned_Labor_Cost) * 100)
                : 0,

            Gross_Profit: grossProfit,
            Net_Profit: netProfit,
            Profit_Margin_Percent: profitMargin,

            Workers_Count: uniqueWorkers.size,
            Total_Worker_Days: totalWorkerDays,
            Avg_Daily_Rate: avgDailyRate,

            Production_Steps: workOrder.Production_Steps || [],

            Month: actualStartDate.getMonth() + 1,
            Quarter: Math.ceil((actualStartDate.getMonth() + 1) / 3),
            Day_Of_Week_Start: actualStartDate.getDay(),

            // Data Quality - Calculate quality score
            Quality_Score: 100, // Will be calculated below
            Data_Issues: [],
            Is_Valid_For_AI: true,
            Normalized_Product_Types: [],

            // Material Price Accuracy
            Materials_Snapshot_Time: new Date().toISOString(),
            Materials_Are_Final: true
        };

        // 9. Calculate Data Quality Score
        const dataIssues: string[] = [];
        let qualityScore = 100;

        // Critical issues (-50 points)
        if (!snapshot.Total_Material_Cost || snapshot.Total_Material_Cost <= 0) {
            dataIssues.push('Missing material cost');
            qualityScore -= 50;
        }

        // Important issues (-20 points each)
        if (!snapshot.Items?.length) {
            dataIssues.push('No products in snapshot');
            qualityScore -= 20;
        }
        if (!snapshot.Actual_Start || !snapshot.Actual_End) {
            dataIssues.push('Missing start/end dates');
            qualityScore -= 20;
        }

        // Minor issues (-10 points each)
        if (snapshot.Actual_Days <= 0) {
            dataIssues.push('Invalid duration');
            qualityScore -= 10;
        }
        if (snapshot.Workers_Count <= 0) {
            dataIssues.push('No workers assigned');
            qualityScore -= 10;
        }

        // Logical issues (-15 points each)
        if (snapshot.Profit_Margin_Percent < -50 || snapshot.Profit_Margin_Percent > 200) {
            dataIssues.push('Unrealistic profit margin');
            qualityScore -= 15;
        }
        if (snapshot.Duration_Variance > 30) {
            dataIssues.push('Excessive duration variance');
            qualityScore -= 10;
        }

        // Normalize product types
        const normalizedTypes = new Set<string>();
        for (const item of snapshot.Items) {
            if (item.Product_Type && item.Product_Type !== 'Ostalo') {
                normalizedTypes.add(item.Product_Type);
            }
        }

        // Update snapshot with quality data
        snapshot.Quality_Score = Math.max(0, qualityScore);
        snapshot.Data_Issues = dataIssues;
        snapshot.Is_Valid_For_AI = qualityScore >= 50;
        snapshot.Normalized_Product_Types = Array.from(normalizedTypes);

        // Material price accuracy timestamp
        snapshot.Materials_Snapshot_Time = new Date().toISOString();
        snapshot.Materials_Are_Final = true; // Captured at work order completion

        // 10. Save to Firestore
        await addDoc(collection(firestore, COLLECTIONS.PRODUCTION_SNAPSHOTS), snapshot);

        const qualityStatus = snapshot.Is_Valid_For_AI ? '✓ Valid for AI' : '⚠ Low quality';
        console.log(`[ProductionSnapshot] Created snapshot ${snapshotId} (Score: ${snapshot.Quality_Score}/100, ${qualityStatus})`);

        return { success: true, snapshotId, message: `Snapshot kreiran (Quality: ${snapshot.Quality_Score}/100)` };
    } catch (error) {
        console.error('createProductionSnapshot error:', error);
        return { success: false, message: 'Greška pri kreiranju snapshota' };
    }
}


/**
 * Get all production snapshots for an organization (for AI/ML analysis)
 */
export async function getProductionSnapshots(
    organizationId: string
) {
    if (!organizationId) return [];

    try {
        const firestore = getDb();
        const q = query(
            collection(firestore, COLLECTIONS.PRODUCTION_SNAPSHOTS),
            where('Organization_ID', '==', organizationId)
        );
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => doc.data() as ProductionSnapshot);
    } catch (error) {
        console.error('getProductionSnapshots error:', error);
        return [];
    }
}

// ============================================
// ORGANIZATION SETTINGS (Firestore persistence)
// ============================================

export async function saveOrgSettings(
    organizationId: string,
    data: { companyInfo: any; appSettings: any }
): Promise<{ success: boolean; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        const firestore = getDb();
        await setDoc(doc(firestore, 'org_settings', organizationId), {
            companyInfo: data.companyInfo,
            appSettings: data.appSettings,
            Updated_At: new Date().toISOString(),
        }, { merge: true });

        return { success: true, message: 'Settings saved' };
    } catch (error) {
        console.error('saveOrgSettings error:', error);
        return { success: false, message: 'Error saving settings' };
    }
}

export async function getOrgSettings(
    organizationId: string
): Promise<{ companyInfo: any; appSettings: any } | null> {
    if (!organizationId) return null;

    try {
        const firestore = getDb();
        const docSnap = await getDoc(doc(firestore, 'org_settings', organizationId));
        if (docSnap.exists()) {
            const data = docSnap.data();
            return {
                companyInfo: data.companyInfo || null,
                appSettings: data.appSettings || null,
            };
        }
        return null;
    } catch (error) {
        console.error('getOrgSettings error:', error);
        return null;
    }
}
