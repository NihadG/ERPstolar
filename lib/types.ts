// ============================================
// TYPE DEFINITIONS
// ============================================

export interface Project {
    Project_ID: string;
    Client_Name: string;
    Client_Phone: string;
    Client_Email: string;
    Address: string;
    Notes: string;
    Status: string;
    Production_Mode: 'PreCut' | 'InHouse';
    Created_Date: string;
    Deadline: string;
    products?: Product[];
}

export interface Product {
    Product_ID: string;
    Project_ID: string;
    Name: string;
    Height: number;
    Width: number;
    Depth: number;
    Quantity: number;
    Status: string;
    Material_Cost: number;
    Notes: string;
    materials?: ProductMaterial[];
}

export interface Material {
    Material_ID: string;
    Name: string;
    Category: string;
    Unit: string;
    Default_Supplier: string;
    Default_Unit_Price: number;
    Description: string;
    Is_Glass?: boolean;
    Is_Alu_Door?: boolean;
}

export interface ProductMaterial {
    ID: string;
    Product_ID: string;
    Material_ID: string;
    Material_Name: string;
    Quantity: number;
    Unit: string;
    Unit_Price: number;
    Total_Price: number;
    Status: string;
    Supplier: string;
    Order_ID: string;
    glassItems?: GlassItem[];
    aluDoorItems?: AluDoorItem[];
}

export interface GlassItem {
    ID: string;
    Product_Material_ID: string;
    Order_ID: string;
    Qty: number;
    Width: number;
    Height: number;
    Area_M2: number;
    Edge_Processing: boolean;
    Note: string;
    Status: string;
}

export interface AluDoorItem {
    ID: string;
    Product_Material_ID: string;
    Order_ID: string;
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
    Hinge_Positions: string;
    Integrated_Handle: boolean;
    Area_M2: number;
    Unit_Price: number;
    Total_Price: number;
    Note: string;
    Status: string;
}

export interface Offer {
    Offer_ID: string;
    Project_ID: string;
    Offer_Number: string;
    Created_Date: string;
    Valid_Until: string;
    Status: string;
    Transport_Cost: number;
    Onsite_Assembly: boolean;
    Onsite_Discount: number;
    Subtotal: number;
    Total: number;
    Notes: string;
    Accepted_Date: string;
    Client_Name?: string;
    Client_Phone?: string;
    Client_Email?: string;
    products?: OfferProduct[];
}

export interface OfferProduct {
    ID: string;
    Offer_ID: string;
    Product_ID: string;
    Product_Name: string;
    Quantity: number;
    Included: boolean;
    Material_Cost: number;
    Margin: number;
    Margin_Type: 'Fixed' | 'Percentage';
    LED_Meters: number;
    LED_Price: number;
    LED_Total: number;
    Grouting: boolean;
    Grouting_Price: number;
    Sink_Faucet: boolean;
    Sink_Faucet_Price: number;
    Transport_Share: number;
    Discount_Share: number;
    Selling_Price: number;
    Total_Price: number;
    extras?: OfferExtra[];
}

export interface OfferExtra {
    ID: string;
    Offer_Product_ID: string;
    Name: string;
    Quantity: number;
    Unit: string;
    Unit_Price: number;
    Total: number;
}

export interface Order {
    Order_ID: string;
    Order_Number: string;
    Supplier_ID: string;
    Supplier_Name: string;
    Order_Date: string;
    Status: string;
    Expected_Delivery: string;
    Total_Amount: number;
    Notes: string;
    items?: OrderItem[];
}

export interface OrderItem {
    ID: string;
    Order_ID: string;
    Product_Material_ID: string;
    Product_ID: string;
    Product_Name: string;
    Project_ID: string;
    Material_Name: string;
    Quantity: number;
    Unit: string;
    Expected_Price: number;
    Actual_Price: number;
    Received_Quantity: number;
    Status: string;
}

export interface Supplier {
    Supplier_ID: string;
    Name: string;
    Contact_Person: string;
    Phone: string;
    Email: string;
    Address: string;
    Categories: string;
}

export interface Worker {
    Worker_ID: string;
    Name: string;
    Role: string;
    Phone: string;
    Status: string;
}

export interface Task {
    Task_ID: string;
    Project_ID: string;
    Product_ID: string;
    Worker_ID: string;
    Task_Type: string;
    Description: string;
    Status: string;
    Due_Date: string;
    Completed_Date: string;
}

// ============================================
// CONSTANTS
// ============================================

export const PROJECT_STATUSES = ['Nacrt', 'Ponuđeno', 'Odobreno', 'U proizvodnji', 'Sklapanje', 'Montaža', 'Završeno', 'Otkazano'];
export const PRODUCT_STATUSES = ['Na čekanju', 'Materijali naručeni', 'Materijali spremni', 'Rezanje', 'Kantiranje', 'Bušenje', 'Sklapanje', 'Spremno', 'Instalirano'];
export const MATERIAL_STATUSES = ['Nije naručeno', 'Naručeno', 'Primljeno', 'U upotrebi', 'Instalirano'];
export const OFFER_STATUSES = ['Nacrt', 'Poslano', 'Prihvaćeno', 'Odbijeno', 'Isteklo', 'Revidirano'];
export const ORDER_STATUSES = ['Nacrt', 'Poslano', 'Potvrđeno', 'Isporučeno', 'Primljeno', 'Djelomično'];
export const MATERIAL_CATEGORIES = ['Ploča', 'Kanttraka', 'Okovi', 'Vijci', 'Šarke', 'Ladičari', 'Ručke', 'LED', 'Staklo', 'Alu vrata', 'Ostalo'];
export const PRODUCTION_MODES = ['PreCut', 'InHouse'];
export const WORKER_ROLES = ['Rezač', 'Kantiranje', 'Bušenje', 'Montaža', 'Instalacija', 'Opći'];

// ============================================
// APP STATE TYPE
// ============================================

export interface AppState {
    projects: Project[];
    products: Product[];
    materials: Material[];
    suppliers: Supplier[];
    workers: Worker[];
    offers: Offer[];
    orders: Order[];
    productMaterials: ProductMaterial[];
    glassItems: GlassItem[];
    aluDoorItems: AluDoorItem[];
}

// ============================================
// AUTH & LICENSING TYPES
// ============================================

export interface Organization {
    Organization_ID: string;
    Name: string;
    Email: string;
    Phone: string;
    Address: string;
    Logo_URL?: string;
    Created_Date: string;
    Subscription_Plan: 'free' | 'basic' | 'professional' | 'enterprise';
    Modules: ModuleAccess;
    Billing_Email: string;
    Is_Active: boolean;
}

export interface ModuleAccess {
    offers: boolean;
    orders: boolean;
    reports: boolean;
    api_access: boolean;
}

export interface User {
    User_ID: string;
    Email: string;
    Name: string;
    Role: 'owner' | 'admin' | 'manager' | 'worker';
    Organization_ID: string;
    Created_Date: string;
    Last_Login: string;
    Is_Active: boolean;
}

export interface SubscriptionEvent {
    ID: string;
    Organization_ID: string;
    Event_Type: 'activated' | 'upgraded' | 'downgraded' | 'cancelled' | 'renewed';
    Module: string;
    Date: string;
    Amount: number;
    Payment_ID: string;
}

