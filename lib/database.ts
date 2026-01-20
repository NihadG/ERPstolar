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
// GET ALL DATA (Optimized single fetch)
// ============================================

export async function getAllData(): Promise<AppState> {
    try {
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
        ] = await Promise.all([
            getDocs(collection(db, COLLECTIONS.PROJECTS)),
            getDocs(collection(db, COLLECTIONS.PRODUCTS)),
            getDocs(collection(db, COLLECTIONS.MATERIALS_DB)),
            getDocs(collection(db, COLLECTIONS.SUPPLIERS)),
            getDocs(collection(db, COLLECTIONS.WORKERS)),
            getDocs(collection(db, COLLECTIONS.OFFERS)),
            getDocs(collection(db, COLLECTIONS.ORDERS)),
            getDocs(collection(db, COLLECTIONS.PRODUCT_MATERIALS)),
            getDocs(collection(db, COLLECTIONS.ORDER_ITEMS)),
            getDocs(collection(db, COLLECTIONS.GLASS_ITEMS)),
            getDocs(collection(db, COLLECTIONS.ALU_DOOR_ITEMS)),
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

        // Attach glass items and alu door items to product materials
        productMaterials.forEach(pm => {
            pm.glassItems = glassItems.filter(gi => gi.Product_Material_ID === pm.ID);
            pm.aluDoorItems = aluDoorItems.filter(adi => adi.Product_Material_ID === pm.ID);
        });

        // Attach products to projects
        projects.forEach(project => {
            project.products = products.filter(p => p.Project_ID === project.Project_ID);
            project.products.forEach(product => {
                product.materials = productMaterials.filter(m => m.Product_ID === product.Product_ID);
            });
        });

        // Add client info to offers
        offers.forEach(offer => {
            const project = projects.find(p => p.Project_ID === offer.Project_ID);
            if (project) {
                offer.Client_Name = project.Client_Name;
            }
        });

        // Attach items to orders
        orders.forEach(order => {
            order.items = orderItems.filter(item => item.Order_ID === order.Order_ID);
        });

        return {
            projects,
            products,
            materials,
            suppliers,
            workers,
            offers,
            orders,
            productMaterials,
            glassItems,
            aluDoorItems,
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
            productMaterials: [],
            glassItems: [],
            aluDoorItems: [],
        };
    }
}

// ============================================
// PROJECTS CRUD
// ============================================

export async function getProjects(): Promise<Project[]> {
    const snapshot = await getDocs(collection(db, COLLECTIONS.PROJECTS));
    return snapshot.docs.map(doc => ({ ...doc.data() } as Project));
}

export async function getProject(projectId: string): Promise<Project | null> {
    const q = query(collection(db, COLLECTIONS.PROJECTS), where('Project_ID', '==', projectId));
    const snapshot = await getDocs(q);
    if (snapshot.empty) return null;

    const project = snapshot.docs[0].data() as Project;
    project.products = await getProductsByProject(projectId);
    return project;
}

export async function saveProject(data: Partial<Project>): Promise<{ success: boolean; data?: { Project_ID: string }; message: string }> {
    try {
        const isNew = !data.Project_ID;

        if (isNew) {
            data.Project_ID = generateUUID();
            data.Created_Date = new Date().toISOString();
            data.Status = data.Status || 'Nacrt';
            await addDoc(collection(db, COLLECTIONS.PROJECTS), data);
        } else {
            const q = query(collection(db, COLLECTIONS.PROJECTS), where('Project_ID', '==', data.Project_ID));
            const snapshot = await getDocs(q);
            if (!snapshot.empty) {
                await updateDoc(snapshot.docs[0].ref, data as Record<string, unknown>);
            }
        }

        return { success: true, data: { Project_ID: data.Project_ID! }, message: isNew ? 'Projekat kreiran' : 'Projekat ažuriran' };
    } catch (error) {
        console.error('saveProject error:', error);
        return { success: false, message: 'Greška pri spremanju projekta' };
    }
}

export async function deleteProject(projectId: string): Promise<{ success: boolean; message: string }> {
    try {
        // Delete all related products first
        const products = await getProductsByProject(projectId);
        for (const product of products) {
            await deleteProduct(product.Product_ID);
        }

        // Delete project
        const q = query(collection(db, COLLECTIONS.PROJECTS), where('Project_ID', '==', projectId));
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

export async function updateProjectStatus(projectId: string, status: string): Promise<{ success: boolean; message: string }> {
    try {
        const q = query(collection(db, COLLECTIONS.PROJECTS), where('Project_ID', '==', projectId));
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
// PRODUCTS CRUD
// ============================================

export async function getProductsByProject(projectId: string): Promise<Product[]> {
    const q = query(collection(db, COLLECTIONS.PRODUCTS), where('Project_ID', '==', projectId));
    const snapshot = await getDocs(q);

    const products = snapshot.docs.map(doc => ({ ...doc.data() } as Product));

    for (const product of products) {
        product.materials = await getProductMaterials(product.Product_ID);
    }

    return products;
}

export async function getProduct(productId: string): Promise<Product | null> {
    const q = query(collection(db, COLLECTIONS.PRODUCTS), where('Product_ID', '==', productId));
    const snapshot = await getDocs(q);
    if (snapshot.empty) return null;

    const product = snapshot.docs[0].data() as Product;
    product.materials = await getProductMaterials(productId);
    return product;
}

export async function saveProduct(data: Partial<Product>): Promise<{ success: boolean; data?: { Product_ID: string }; message: string }> {
    try {
        const isNew = !data.Product_ID;

        if (isNew) {
            data.Product_ID = generateUUID();
            data.Status = data.Status || 'Na čekanju';
            data.Material_Cost = 0;
            await addDoc(collection(db, COLLECTIONS.PRODUCTS), data);
        } else {
            const q = query(collection(db, COLLECTIONS.PRODUCTS), where('Product_ID', '==', data.Product_ID));
            const snapshot = await getDocs(q);
            if (!snapshot.empty) {
                await updateDoc(snapshot.docs[0].ref, data as Record<string, unknown>);
            }
        }

        return { success: true, data: { Product_ID: data.Product_ID! }, message: isNew ? 'Proizvod kreiran' : 'Proizvod ažuriran' };
    } catch (error) {
        console.error('saveProduct error:', error);
        return { success: false, message: 'Greška pri spremanju proizvoda' };
    }
}

export async function deleteProduct(productId: string): Promise<{ success: boolean; message: string }> {
    try {
        // Delete all related materials first
        await deleteProductMaterials(productId);

        // Delete product
        const q = query(collection(db, COLLECTIONS.PRODUCTS), where('Product_ID', '==', productId));
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

export async function updateProductStatus(productId: string, status: string): Promise<{ success: boolean; message: string }> {
    try {
        const q = query(collection(db, COLLECTIONS.PRODUCTS), where('Product_ID', '==', productId));
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

export async function recalculateProductCost(productId: string): Promise<number> {
    const materials = await getProductMaterials(productId);
    const totalCost = materials.reduce((sum, m) => sum + (m.Total_Price || 0), 0);

    const q = query(collection(db, COLLECTIONS.PRODUCTS), where('Product_ID', '==', productId));
    const snapshot = await getDocs(q);
    if (!snapshot.empty) {
        await updateDoc(snapshot.docs[0].ref, { Material_Cost: totalCost });
    }

    return totalCost;
}

// ============================================
// PRODUCT MATERIALS CRUD
// ============================================

export async function getProductMaterials(productId: string): Promise<ProductMaterial[]> {
    const q = query(collection(db, COLLECTIONS.PRODUCT_MATERIALS), where('Product_ID', '==', productId));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ ...doc.data() } as ProductMaterial));
}

export async function addMaterialToProduct(data: Partial<ProductMaterial>): Promise<{ success: boolean; data?: { ID: string }; message: string }> {
    try {
        const quantity = data.Quantity || 0;
        const unitPrice = data.Unit_Price || 0;
        data.Total_Price = quantity * unitPrice;

        if (!data.ID) {
            data.ID = generateUUID();
            data.Status = data.Status || 'Nije naručeno';
        }

        await addDoc(collection(db, COLLECTIONS.PRODUCT_MATERIALS), data);

        if (data.Product_ID) {
            await recalculateProductCost(data.Product_ID);
        }

        return { success: true, data: { ID: data.ID }, message: 'Materijal dodan' };
    } catch (error) {
        console.error('addMaterialToProduct error:', error);
        return { success: false, message: 'Greška pri dodavanju materijala' };
    }
}

export async function updateProductMaterial(materialId: string, data: Partial<ProductMaterial>): Promise<{ success: boolean; message: string }> {
    try {
        const q = query(collection(db, COLLECTIONS.PRODUCT_MATERIALS), where('ID', '==', materialId));
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            return { success: false, message: 'Materijal nije pronađen' };
        }

        const existing = snapshot.docs[0].data() as ProductMaterial;
        const merged = { ...existing, ...data };

        const quantity = merged.Quantity || 0;
        const unitPrice = merged.Unit_Price || 0;
        merged.Total_Price = quantity * unitPrice;

        await updateDoc(snapshot.docs[0].ref, merged as Record<string, unknown>);

        if (merged.Product_ID) {
            await recalculateProductCost(merged.Product_ID);
        }

        return { success: true, message: 'Materijal ažuriran' };
    } catch (error) {
        console.error('updateProductMaterial error:', error);
        return { success: false, message: 'Greška pri ažuriranju materijala' };
    }
}

export async function deleteProductMaterial(materialId: string): Promise<{ success: boolean; message: string }> {
    try {
        const q = query(collection(db, COLLECTIONS.PRODUCT_MATERIALS), where('ID', '==', materialId));
        const snapshot = await getDocs(q);

        if (!snapshot.empty) {
            const productId = snapshot.docs[0].data().Product_ID;
            await deleteDoc(snapshot.docs[0].ref);

            if (productId) {
                await recalculateProductCost(productId);
            }
        }

        return { success: true, message: 'Materijal obrisan' };
    } catch (error) {
        console.error('deleteProductMaterial error:', error);
        return { success: false, message: 'Greška pri brisanju materijala' };
    }
}

export async function deleteProductMaterials(productId: string): Promise<void> {
    const q = query(collection(db, COLLECTIONS.PRODUCT_MATERIALS), where('Product_ID', '==', productId));
    const snapshot = await getDocs(q);

    const batch = writeBatch(db);
    snapshot.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
}

// ============================================
// MATERIALS DATABASE CRUD
// ============================================

export async function getMaterialsCatalog(): Promise<Material[]> {
    const snapshot = await getDocs(collection(db, COLLECTIONS.MATERIALS_DB));
    return snapshot.docs.map(doc => ({ ...doc.data() } as Material));
}

export async function saveMaterial(data: Partial<Material>): Promise<{ success: boolean; data?: { Material_ID: string }; message: string }> {
    try {
        const isNew = !data.Material_ID;

        if (isNew) {
            data.Material_ID = generateUUID();
            await addDoc(collection(db, COLLECTIONS.MATERIALS_DB), data);
        } else {
            const q = query(collection(db, COLLECTIONS.MATERIALS_DB), where('Material_ID', '==', data.Material_ID));
            const snapshot = await getDocs(q);
            if (!snapshot.empty) {
                await updateDoc(snapshot.docs[0].ref, data as Record<string, unknown>);
            }
        }

        return { success: true, data: { Material_ID: data.Material_ID! }, message: isNew ? 'Materijal kreiran' : 'Materijal ažuriran' };
    } catch (error) {
        console.error('saveMaterial error:', error);
        return { success: false, message: 'Greška pri spremanju materijala' };
    }
}

export async function deleteMaterial(materialId: string): Promise<{ success: boolean; message: string }> {
    try {
        const q = query(collection(db, COLLECTIONS.MATERIALS_DB), where('Material_ID', '==', materialId));
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
// SUPPLIERS CRUD
// ============================================

export async function getSuppliers(): Promise<Supplier[]> {
    const snapshot = await getDocs(collection(db, COLLECTIONS.SUPPLIERS));
    return snapshot.docs.map(doc => ({ ...doc.data() } as Supplier));
}

export async function saveSupplier(data: Partial<Supplier>): Promise<{ success: boolean; data?: { Supplier_ID: string }; message: string }> {
    try {
        const isNew = !data.Supplier_ID;

        if (isNew) {
            data.Supplier_ID = generateUUID();
            await addDoc(collection(db, COLLECTIONS.SUPPLIERS), data);
        } else {
            const q = query(collection(db, COLLECTIONS.SUPPLIERS), where('Supplier_ID', '==', data.Supplier_ID));
            const snapshot = await getDocs(q);
            if (!snapshot.empty) {
                await updateDoc(snapshot.docs[0].ref, data as Record<string, unknown>);
            }
        }

        return { success: true, data: { Supplier_ID: data.Supplier_ID! }, message: isNew ? 'Dobavljač kreiran' : 'Dobavljač ažuriran' };
    } catch (error) {
        console.error('saveSupplier error:', error);
        return { success: false, message: 'Greška pri spremanju dobavljača' };
    }
}

export async function deleteSupplier(supplierId: string): Promise<{ success: boolean; message: string }> {
    try {
        const q = query(collection(db, COLLECTIONS.SUPPLIERS), where('Supplier_ID', '==', supplierId));
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
// WORKERS CRUD
// ============================================

export async function getWorkers(): Promise<Worker[]> {
    const snapshot = await getDocs(collection(db, COLLECTIONS.WORKERS));
    return snapshot.docs.map(doc => ({ ...doc.data() } as Worker));
}

export async function saveWorker(data: Partial<Worker>): Promise<{ success: boolean; data?: { Worker_ID: string }; message: string }> {
    try {
        const isNew = !data.Worker_ID;

        if (isNew) {
            data.Worker_ID = generateUUID();
            data.Status = data.Status || 'Dostupan';
            await addDoc(collection(db, COLLECTIONS.WORKERS), data);
        } else {
            const q = query(collection(db, COLLECTIONS.WORKERS), where('Worker_ID', '==', data.Worker_ID));
            const snapshot = await getDocs(q);
            if (!snapshot.empty) {
                await updateDoc(snapshot.docs[0].ref, data as Record<string, unknown>);
            }
        }

        return { success: true, data: { Worker_ID: data.Worker_ID! }, message: isNew ? 'Radnik kreiran' : 'Radnik ažuriran' };
    } catch (error) {
        console.error('saveWorker error:', error);
        return { success: false, message: 'Greška pri spremanju radnika' };
    }
}

export async function deleteWorker(workerId: string): Promise<{ success: boolean; message: string }> {
    try {
        const q = query(collection(db, COLLECTIONS.WORKERS), where('Worker_ID', '==', workerId));
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
// OFFERS CRUD
// ============================================

export async function getOffers(): Promise<Offer[]> {
    const snapshot = await getDocs(collection(db, COLLECTIONS.OFFERS));
    return snapshot.docs.map(doc => ({ ...doc.data() } as Offer));
}

export async function getOffer(offerId: string): Promise<Offer | null> {
    const q = query(collection(db, COLLECTIONS.OFFERS), where('Offer_ID', '==', offerId));
    const snapshot = await getDocs(q);
    if (snapshot.empty) return null;

    const offer = snapshot.docs[0].data() as Offer;
    offer.products = await getOfferProducts(offerId);

    const project = await getProject(offer.Project_ID);
    if (project) {
        offer.Client_Name = project.Client_Name;
    }

    return offer;
}

export async function getOfferProducts(offerId: string): Promise<OfferProduct[]> {
    const q = query(collection(db, COLLECTIONS.OFFER_PRODUCTS), where('Offer_ID', '==', offerId));
    const snapshot = await getDocs(q);

    const products = snapshot.docs.map(doc => ({ ...doc.data() } as OfferProduct));

    for (const product of products) {
        product.extras = await getOfferProductExtras(product.ID);
    }

    return products;
}

export async function getOfferProductExtras(offerProductId: string): Promise<OfferExtra[]> {
    const q = query(collection(db, COLLECTIONS.OFFER_EXTRAS), where('Offer_Product_ID', '==', offerProductId));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ ...doc.data() } as OfferExtra));
}

export async function createOfferWithProducts(offerData: any): Promise<{ success: boolean; data?: { Offer_ID: string; Offer_Number: string }; message: string }> {
    try {
        const offerId = generateUUID();
        const offerNumber = generateOfferNumber();

        const products = offerData.products || [];
        const includedProducts = products.filter((p: any) => p.Included);
        if (includedProducts.length === 0) {
            return { success: false, message: 'Označite barem jedan proizvod' };
        }

        // Calculate subtotal including extras
        let subtotal = 0;
        includedProducts.forEach((p: any) => {
            const materialCost = parseFloat(p.Material_Cost) || 0;
            const margin = parseFloat(p.Margin) || 0;
            const extrasTotal = (p.Extras || []).reduce((sum: number, e: any) => sum + (parseFloat(e.total) || 0), 0);
            const quantity = parseFloat(p.Quantity) || 1;
            subtotal += (materialCost + margin + extrasTotal) * quantity;
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
            const quantity = parseFloat(product.Quantity) || 1;
            const sellingPrice = materialCost + margin + extrasTotal;
            const totalPrice = sellingPrice * quantity;

            const offerProduct: OfferProduct = {
                ID: productId,
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
                const extraDoc: OfferExtra = {
                    ID: generateUUID(),
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

export async function saveOffer(data: Partial<Offer>): Promise<{ success: boolean; message: string }> {
    try {
        const q = query(collection(db, COLLECTIONS.OFFERS), where('Offer_ID', '==', data.Offer_ID));
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            return { success: false, message: 'Ponuda nije pronađena' };
        }

        await updateDoc(snapshot.docs[0].ref, data as Record<string, unknown>);
        return { success: true, message: 'Ponuda sačuvana' };
    } catch (error) {
        console.error('saveOffer error:', error);
        return { success: false, message: 'Greška pri spremanju ponude' };
    }
}

export async function deleteOffer(offerId: string): Promise<{ success: boolean; message: string }> {
    try {
        // Delete offer products first
        const productsQ = query(collection(db, COLLECTIONS.OFFER_PRODUCTS), where('Offer_ID', '==', offerId));
        const productsSnap = await getDocs(productsQ);

        const batch = writeBatch(db);
        productsSnap.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();

        // Delete offer
        const q = query(collection(db, COLLECTIONS.OFFERS), where('Offer_ID', '==', offerId));
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

export async function updateOfferStatus(offerId: string, status: string): Promise<{ success: boolean; message: string }> {
    try {
        const q = query(collection(db, COLLECTIONS.OFFERS), where('Offer_ID', '==', offerId));
        const snapshot = await getDocs(q);

        if (!snapshot.empty) {
            const updateData: Record<string, unknown> = { Status: status };

            if (status === 'Prihvaćeno') {
                updateData.Accepted_Date = new Date().toISOString();

                const offer = snapshot.docs[0].data() as Offer;
                if (offer.Project_ID) {
                    await updateProjectStatus(offer.Project_ID, 'Odobreno');
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
// ORDERS CRUD
// ============================================

export async function getOrders(): Promise<Order[]> {
    const snapshot = await getDocs(collection(db, COLLECTIONS.ORDERS));
    return snapshot.docs.map(doc => ({ ...doc.data() } as Order));
}

export async function getOrder(orderId: string): Promise<Order | null> {
    const q = query(collection(db, COLLECTIONS.ORDERS), where('Order_ID', '==', orderId));
    const snapshot = await getDocs(q);
    if (snapshot.empty) return null;

    const order = snapshot.docs[0].data() as Order;
    order.items = await getOrderItems(orderId);
    return order;
}

export async function getOrderItems(orderId: string): Promise<OrderItem[]> {
    const q = query(collection(db, COLLECTIONS.ORDER_ITEMS), where('Order_ID', '==', orderId));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ ...doc.data() } as OrderItem));
}

export async function createOrder(data: Partial<Order> & { items?: Partial<OrderItem>[] }): Promise<{ success: boolean; data?: { Order_ID: string; Order_Number: string }; message: string }> {
    try {
        const orderId = generateUUID();
        const orderNumber = generateOrderNumber();

        const order: Order = {
            Order_ID: orderId,
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
            const orderItem: OrderItem = {
                ID: generateUUID(),
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
                await updateProductMaterial(item.Product_Material_ID, { Status: 'Naručeno', Order_ID: orderId });
            }
        }

        return { success: true, data: { Order_ID: orderId, Order_Number: orderNumber }, message: 'Narudžba kreirana' };
    } catch (error) {
        console.error('createOrder error:', error);
        return { success: false, message: 'Greška pri kreiranju narudžbe' };
    }
}

export async function saveOrder(data: Partial<Order>): Promise<{ success: boolean; message: string }> {
    try {
        const q = query(collection(db, COLLECTIONS.ORDERS), where('Order_ID', '==', data.Order_ID));
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            return { success: false, message: 'Narudžba nije pronađena' };
        }

        await updateDoc(snapshot.docs[0].ref, data as Record<string, unknown>);
        return { success: true, message: 'Narudžba sačuvana' };
    } catch (error) {
        console.error('saveOrder error:', error);
        return { success: false, message: 'Greška pri spremanju narudžbe' };
    }
}

export async function deleteOrder(orderId: string): Promise<{ success: boolean; message: string }> {
    try {
        // Delete order items first
        const itemsQ = query(collection(db, COLLECTIONS.ORDER_ITEMS), where('Order_ID', '==', orderId));
        const itemsSnap = await getDocs(itemsQ);

        const batch = writeBatch(db);
        itemsSnap.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();

        // Delete order
        const q = query(collection(db, COLLECTIONS.ORDERS), where('Order_ID', '==', orderId));
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

export async function updateOrderStatus(orderId: string, status: string): Promise<{ success: boolean; message: string }> {
    try {
        const q = query(collection(db, COLLECTIONS.ORDERS), where('Order_ID', '==', orderId));
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
// ORDER STATUS AUTOMATION
// ============================================

export async function markOrderSent(orderId: string): Promise<{ success: boolean; message: string }> {
    try {
        // Update order status
        const orderQ = query(collection(db, COLLECTIONS.ORDERS), where('Order_ID', '==', orderId));
        const orderSnap = await getDocs(orderQ);

        if (orderSnap.empty) {
            return { success: false, message: 'Narudžba nije pronađena' };
        }

        await updateDoc(orderSnap.docs[0].ref, { Status: 'Poslano' });

        // Get order items and update material statuses
        const items = await getOrderItems(orderId);
        const affectedProducts = new Set<string>();
        const affectedProjects = new Set<string>();

        for (const item of items) {
            if (item.Product_Material_ID) {
                // Update material status to "Naručeno"
                await updateProductMaterial(item.Product_Material_ID, { Status: 'Naručeno', Order_ID: orderId });

                if (item.Product_ID) affectedProducts.add(item.Product_ID);
                if (item.Project_ID) affectedProjects.add(item.Project_ID);
            }
        }

        // Update product statuses
        for (const productId of Array.from(affectedProducts)) {
            const product = await getProduct(productId);
            if (product && product.Status === 'Na čekanju') {
                await updateProductStatus(productId, 'Materijali naručeni');
            }
        }

        // Update project statuses
        for (const projectId of Array.from(affectedProjects)) {
            const project = await getProject(projectId);
            if (project && project.Status === 'Odobreno') {
                await updateProjectStatus(projectId, 'U proizvodnji');
            }
        }

        return { success: true, message: 'Narudžba poslana' };
    } catch (error) {
        console.error('markOrderSent error:', error);
        return { success: false, message: 'Greška pri slanju narudžbe' };
    }
}

export async function markMaterialsReceived(orderItemIds: string[]): Promise<{ success: boolean; message: string }> {
    try {
        const affectedProducts = new Set<string>();
        const affectedProjects = new Set<string>();

        for (const itemId of orderItemIds) {
            // Find order item
            const itemQ = query(collection(db, COLLECTIONS.ORDER_ITEMS), where('ID', '==', itemId));
            const itemSnap = await getDocs(itemQ);

            if (itemSnap.empty) continue;

            const item = itemSnap.docs[0].data() as OrderItem;

            // Update order item status
            await updateDoc(itemSnap.docs[0].ref, { Status: 'Primljeno' });

            // Update material status
            if (item.Product_Material_ID) {
                await updateProductMaterial(item.Product_Material_ID, { Status: 'Primljeno' });
            }

            if (item.Product_ID) affectedProducts.add(item.Product_ID);
            if (item.Project_ID) affectedProjects.add(item.Project_ID);
        }

        // Check if all materials for products are received
        for (const productId of Array.from(affectedProducts)) {
            const materials = await getProductMaterials(productId);
            const allReceived = materials.every(m =>
                m.Status === 'Primljeno' || m.Status === 'U upotrebi' || m.Status === 'Instalirano'
            );

            if (allReceived) {
                await updateProductStatus(productId, 'Materijali spremni');
            }
        }

        // Check if all materials for project are received
        for (const projectId of Array.from(affectedProjects)) {
            const project = await getProject(projectId);
            if (!project) continue;

            const allReceived = (project.products || []).every(product => {
                return (product.materials || []).every(m =>
                    m.Status === 'Primljeno' || m.Status === 'U upotrebi' || m.Status === 'Instalirano'
                );
            });

            if (allReceived) {
                await updateProjectStatus(projectId, 'Sklapanje');
            }
        }

        return { success: true, message: 'Materijali primljeni' };
    } catch (error) {
        console.error('markMaterialsReceived error:', error);
        return { success: false, message: 'Greška pri primanju materijala' };
    }
}

// Delete specific order items by their IDs
export async function deleteOrderItemsByIds(itemIds: string[]): Promise<{ success: boolean; message: string }> {
    try {
        for (const itemId of itemIds) {
            const itemQ = query(collection(db, COLLECTIONS.ORDER_ITEMS), where('ID', '==', itemId));
            const itemSnap = await getDocs(itemQ);

            if (itemSnap.empty) continue;

            const item = itemSnap.docs[0].data() as OrderItem;

            // Reset material status to "Nije naručeno" and clear Order_ID
            if (item.Product_Material_ID) {
                await updateProductMaterial(item.Product_Material_ID, { Status: 'Nije naručeno', Order_ID: '' });
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
export async function updateOrderItem(itemId: string, data: Partial<OrderItem>): Promise<{ success: boolean; message: string }> {
    try {
        const itemQ = query(collection(db, COLLECTIONS.ORDER_ITEMS), where('ID', '==', itemId));
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
export async function recalculateOrderTotal(orderId: string): Promise<{ success: boolean; message: string }> {
    try {
        const items = await getOrderItems(orderId);
        const total = items.reduce((sum, item) => {
            return sum + ((item.Quantity || 0) * (item.Expected_Price || 0));
        }, 0);

        const orderQ = query(collection(db, COLLECTIONS.ORDERS), where('Order_ID', '==', orderId));
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

export async function addGlassMaterialToProduct(data: AddGlassMaterialData): Promise<{ success: boolean; data?: { productMaterialId: string; itemCount: number; totalArea: number; totalPrice: number }; message: string }> {
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
            await recalculateProductCost(data.productId);
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

export async function updateGlassMaterial(data: UpdateGlassMaterialData): Promise<{ success: boolean; data?: { productMaterialId: string; itemCount: number; totalArea: number; totalPrice: number }; message: string }> {
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
            await recalculateProductCost(productId);
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

export async function addAluDoorMaterialToProduct(data: AddAluDoorMaterialData): Promise<{ success: boolean; data?: { productMaterialId: string; itemCount: number; totalQty: number; totalArea: number; totalPrice: number }; message: string }> {
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
            await recalculateProductCost(data.productId);
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

export async function updateAluDoorMaterial(data: UpdateAluDoorMaterialData): Promise<{ success: boolean; data?: { productMaterialId: string; itemCount: number; totalQty: number; totalArea: number; totalPrice: number }; message: string }> {
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
            await recalculateProductCost(productId);
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
