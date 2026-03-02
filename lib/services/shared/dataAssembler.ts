/**
 * dataAssembler.ts — Shared data assembly logic
 * 
 * Extracts the duplicated map-building and relation-stitching code
 * that was previously copy-pasted between getAllData() and getProjects().
 * 
 * Single source of truth for how raw Firestore documents get
 * assembled into the nested object graph the UI expects.
 */

import type {
    Project,
    Product,
    ProductMaterial,
    GlassItem,
    AluDoorItem,
    Offer,
    OfferProduct,
    OfferExtra,
    Order,
    OrderItem,
    WorkOrder,
    WorkOrderItem,
} from '../../types';

// ============================================
// GENERIC MAP BUILDER
// ============================================

/**
 * Groups an array of items into a Map keyed by a specified field.
 * O(n) single pass — replaces repeated forEach+Map patterns.
 */
export function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
    const map = new Map<string, T[]>();
    for (const item of items) {
        const key = keyFn(item);
        if (!key) continue;
        const arr = map.get(key);
        if (arr) {
            arr.push(item);
        } else {
            map.set(key, [item]);
        }
    }
    return map;
}

// ============================================
// MATERIAL ASSEMBLY
// ============================================

/**
 * Attaches glassItems and aluDoorItems to their parent ProductMaterial records.
 * Then groups the enriched materials by Product_ID.
 * 
 * @returns Map<Product_ID, ProductMaterial[]> with nested glass/alu items attached
 */
export function assembleMaterialsByProduct(
    productMaterials: ProductMaterial[],
    glassItems: GlassItem[],
    aluDoorItems: AluDoorItem[]
): Map<string, ProductMaterial[]> {
    // Group glass items by Product_Material_ID — O(n)
    const glassItemsByMaterial = groupBy(glassItems, gi => gi.Product_Material_ID);

    // Group alu door items by Product_Material_ID — O(n)
    const aluDoorItemsByMaterial = groupBy(aluDoorItems, adi => adi.Product_Material_ID);

    // Enrich materials and group by Product_ID — O(n)
    const materialsByProduct = new Map<string, ProductMaterial[]>();
    for (const pm of productMaterials) {
        pm.glassItems = glassItemsByMaterial.get(pm.ID) || [];
        pm.aluDoorItems = aluDoorItemsByMaterial.get(pm.ID) || [];

        const key = pm.Product_ID;
        const arr = materialsByProduct.get(key);
        if (arr) {
            arr.push(pm);
        } else {
            materialsByProduct.set(key, [pm]);
        }
    }

    return materialsByProduct;
}

// ============================================
// PRODUCT ASSEMBLY
// ============================================

/**
 * Attaches materials to products, then groups products by Project_ID.
 * 
 * @returns Map<Project_ID, Product[]> with nested materials attached
 */
export function assembleProductsByProject(
    products: Product[],
    materialsByProduct: Map<string, ProductMaterial[]>
): Map<string, Product[]> {
    const productsByProject = new Map<string, Product[]>();

    for (const p of products) {
        p.materials = materialsByProduct.get(p.Product_ID) || [];

        const key = p.Project_ID;
        const arr = productsByProject.get(key);
        if (arr) {
            arr.push(p);
        } else {
            productsByProject.set(key, [p]);
        }
    }

    return productsByProject;
}

// ============================================
// OFFER ASSEMBLY
// ============================================

/**
 * Attaches extras to offer products, then offer products to offers,
 * then groups offers by Project_ID.
 * Also enriches offers with Client_Name from their parent project.
 */
export function assembleOffers(
    offers: Offer[],
    offerProducts: OfferProduct[],
    offerExtras: OfferExtra[],
    projectsMap: Map<string, Project>
): Map<string, Offer[]> {
    // Group extras by Offer_Product_ID
    const extrasByOfferProduct = groupBy(offerExtras, e => e.Offer_Product_ID);

    // Group offer products by Offer_ID, attaching extras
    const offerProductsByOffer = groupBy(offerProducts, op => op.Offer_ID);
    for (const [, prods] of Array.from(offerProductsByOffer)) {
        for (const prod of prods) {
            (prod as any).extras = extrasByOfferProduct.get(prod.ID) || [];
        }
    }

    // Group offers by Project_ID, attaching products and client info
    const offersByProject = new Map<string, Offer[]>();
    for (const offer of offers) {
        // Attach client info from project
        const project = projectsMap.get(offer.Project_ID);
        if (project) {
            offer.Client_Name = project.Client_Name;
        }

        // Attach offer products (with their extras)
        const prods = offerProductsByOffer.get(offer.Offer_ID) || [];
        (offer as any).products = prods;

        // Group by project
        const key = offer.Project_ID;
        const arr = offersByProject.get(key);
        if (arr) {
            arr.push(offer);
        } else {
            offersByProject.set(key, [offer]);
        }
    }

    return offersByProject;
}

// ============================================
// ORDER ASSEMBLY
// ============================================

/**
 * Attaches items to orders.
 */
export function assembleOrders(
    orders: Order[],
    orderItems: OrderItem[]
): void {
    const itemsByOrder = groupBy(orderItems, item => item.Order_ID);
    for (const order of orders) {
        order.items = itemsByOrder.get(order.Order_ID) || [];
    }
}

// ============================================
// WORK ORDER ASSEMBLY
// ============================================

/**
 * Attaches items to work orders.
 */
export function assembleWorkOrders(
    workOrders: WorkOrder[],
    workOrderItems: WorkOrderItem[]
): void {
    const itemsByWorkOrder = groupBy(workOrderItems, item => item.Work_Order_ID);
    for (const wo of workOrders) {
        wo.items = itemsByWorkOrder.get(wo.Work_Order_ID) || [];
    }
}

// ============================================
// FULL PROJECT ASSEMBLY
// ============================================

/**
 * Attaches products and offers to projects.
 * This is the final assembly step that produces the complete object graph.
 */
export function assembleProjects(
    projects: Project[],
    productsByProject: Map<string, Product[]>,
    offersByProject: Map<string, Offer[]>
): void {
    for (const project of projects) {
        project.products = productsByProject.get(project.Project_ID) || [];
        project.offers = offersByProject.get(project.Project_ID) || [];
    }
}

// ============================================
// CONVENIENCE: Full pipeline
// ============================================

/**
 * Runs the complete assembly pipeline for projects.
 * Used by both getAllData() and getProjects() to eliminate duplication.
 */
export function assembleProjectGraph(params: {
    projects: Project[];
    products: Product[];
    productMaterials: ProductMaterial[];
    glassItems: GlassItem[];
    aluDoorItems: AluDoorItem[];
    offers: Offer[];
    offerProducts: OfferProduct[];
    offerExtras: OfferExtra[];
}): void {
    const {
        projects, products, productMaterials,
        glassItems, aluDoorItems,
        offers, offerProducts, offerExtras
    } = params;

    // Step 1: Build materials with nested glass/alu items
    const materialsByProduct = assembleMaterialsByProduct(
        productMaterials, glassItems, aluDoorItems
    );

    // Step 2: Attach materials to products, group by project
    const productsByProject = assembleProductsByProject(products, materialsByProduct);

    // Step 3: Build projects map for offer client info lookup
    const projectsMap = new Map<string, Project>();
    for (const p of projects) {
        projectsMap.set(p.Project_ID, p);
    }

    // Step 4: Assemble offers with products and extras
    const offersByProject = assembleOffers(offers, offerProducts, offerExtras, projectsMap);

    // Step 5: Final attachment to projects
    assembleProjects(projects, productsByProject, offersByProject);
}
