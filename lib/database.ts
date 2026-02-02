import { db } from './firebase';
import {
    collection,
    doc,
    getDocs,
    getDoc,
    addDoc,
    updateDoc,
    deleteDoc,
    query,
    where,
    writeBatch,
    Timestamp,
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

    AppState,
} from './types';

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

    for (const product of products) {
        product.materials = await getProductMaterials(product.Product_ID, organizationId);
    }

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

export async function createOrder(data: Partial<Order> & { items?: Partial<OrderItem>[] }, organizationId: string): Promise<{ success: boolean; data?: { Order_ID: string; Order_Number: string }; message: string }> {
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

        // Add items
        for (const item of data.items || []) {
            const orderItem: OrderItem & { Organization_ID: string } = {
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
                Status: 'Naručeno',
            };

            await addDoc(collection(db, COLLECTIONS.ORDER_ITEMS), orderItem);

            // Update material status
            if (item.Product_Material_ID) {
                await updateProductMaterial(item.Product_Material_ID, { Status: 'Naručeno', Order_ID: orderId }, organizationId);
            }
        }

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

export async function deleteOrder(orderId: string, organizationId: string): Promise<{ success: boolean; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        // Delete order items first
        const itemsQ = query(
            collection(db, COLLECTIONS.ORDER_ITEMS),
            where('Order_ID', '==', orderId),
            where('Organization_ID', '==', organizationId)
        );
        const itemsSnap = await getDocs(itemsQ);

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
        const q = query(
            collection(db, COLLECTIONS.ORDERS),
            where('Order_ID', '==', orderId),
            where('Organization_ID', '==', organizationId)
        );
        const snapshot = await getDocs(q);

        if (!snapshot.empty) {
            await updateDoc(snapshot.docs[0].ref, { Status: status });
        }

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

        // Get order items and update material statuses
        const items = await getOrderItems(orderId, organizationId);
        const affectedProducts = new Set<string>();
        const affectedProjects = new Set<string>();

        for (const item of items) {
            if (item.Product_Material_ID) {
                // Update material status to "Naručeno"
                await updateProductMaterial(item.Product_Material_ID, { Status: 'Naručeno', Order_ID: orderId }, organizationId);

                if (item.Product_ID) affectedProducts.add(item.Product_ID);
                if (item.Project_ID) affectedProjects.add(item.Project_ID);
            }
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

            // Update material status
            if (item.Product_Material_ID) {
                await updateProductMaterial(item.Product_Material_ID, { Status: 'Primljeno' }, organizationId);
            }

            if (item.Product_ID) affectedProducts.add(item.Product_ID);
            if (item.Project_ID) affectedProjects.add(item.Project_ID);
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

            // Reset material status to "Nije naručeno" and clear Order_ID
            if (item.Product_Material_ID) {
                await updateProductMaterial(item.Product_Material_ID, { Status: 'Nije naručeno', Order_ID: '' }, organizationId);
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

        const taskMsg = tasksCreated > 0 ? ` Kreirano ${tasksCreated} zadataka za naručivanje materijala.` : '';
        return { success: true, message: `Nalog zakazan u planeru.${taskMsg}` };
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
export async function deleteWorkLog(workLogId: string): Promise<{ success: boolean; message: string }> {
    try {
        const firestore = getDb();
        const q = query(
            collection(firestore, COLLECTIONS.WORK_LOGS),
            where('WorkLog_ID', '==', workLogId)
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
 * Check if a work log already exists for a worker/item/date combination
 * Prevents duplicate entries
 */
export async function workLogExists(workerId: string, workOrderItemId: string, date: string): Promise<boolean> {
    try {
        const firestore = getDb();
        const q = query(
            collection(firestore, COLLECTIONS.WORK_LOGS),
            where('Worker_ID', '==', workerId),
            where('Work_Order_Item_ID', '==', workOrderItemId),
            where('Date', '==', date)
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

