// ============================================
// TYPE DEFINITIONS
// ============================================

export interface Project {
    Project_ID: string;
    Organization_ID: string;  // Multi-tenancy: isolate data by organization
    Name?: string;  // Opisni naziv projekta (npr. "Kuhinja Begović")
    Client_Name: string;
    Client_Phone: string;
    Client_Email: string;
    Address: string;
    Notes: string;
    Status: string;
    Created_Date: string;
    Deadline: string;
    products?: Product[];
    offers?: Offer[];
}

export interface Product {
    Product_ID: string;
    Organization_ID: string;  // Multi-tenancy: isolate data by organization
    Project_ID: string;
    Name: string;
    Height: number;
    Width: number;
    Depth: number;
    Quantity: number;
    Status: string;
    Work_Order_Quantity?: number;  // Quantity already in work orders
    Material_Cost: number;
    Notes: string;
    materials?: ProductMaterial[];
}

export interface Material {
    Material_ID: string;
    Organization_ID: string;  // Multi-tenancy: isolate data by organization
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
    Organization_ID: string;  // Multi-tenancy: isolate data by organization
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
    Is_Essential?: boolean;        // Must be ready before work order can start
    On_Stock?: number;
    Ordered_Quantity?: number;
    Received_Quantity?: number;
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
    Organization_ID: string;  // Multi-tenancy: isolate data by organization
    Name?: string;  // Opisni naziv ponude (npr. "Renovacija apartmana")
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
    Include_PDV: boolean;
    PDV_Rate: number;
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
    Labor_Workers: number;
    Labor_Days: number;
    Labor_Daily_Rate: number;
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
    Organization_ID: string;  // Multi-tenancy: isolate data by organization
    Name?: string;  // Opisni naziv narudžbe (npr. "Ploče za projekat Sarajevo")
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
    Product_Material_IDs?: string[];  // All grouped material IDs (for batch operations)
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
    Received_Date?: string;
}

export interface Supplier {
    Supplier_ID: string;
    Organization_ID: string;  // Multi-tenancy: isolate data by organization
    Name: string;
    Contact_Person: string;
    Phone: string;
    Email: string;
    Address: string;
    Categories: string;
    JIB?: string;
}

export interface Worker {
    Worker_ID: string;
    Organization_ID: string;  // Multi-tenancy: isolate data by organization
    Name: string;
    Role: string;
    Worker_Type: 'Glavni' | 'Pomoćnik';
    Phone: string;
    Status: string;
    Daily_Rate?: number;      // Dnevnica u KM
    Specializations?: string[];
}

export interface Notification {
    id: string;
    organizationId: string;
    title: string;
    message: string;
    type: 'info' | 'success' | 'warning' | 'error';
    createdAt: string;
    read: boolean;
    relatedId?: string;
    link?: string;
}

// ============================================
// TASK TYPES (Enhanced)
// ============================================

export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';
export type TaskCategory = 'general' | 'manufacturing' | 'ordering' | 'installation' | 'design' | 'meeting' | 'reminder';

export interface TaskLink {
    Entity_Type: 'project' | 'product' | 'material' | 'work_order' | 'worker' | 'order';
    Entity_ID: string;
    Entity_Name: string;
}

export interface ChecklistItem {
    id: string;
    text: string;
    completed: boolean;
}

export interface Task {
    Task_ID: string;
    Organization_ID: string;  // Multi-tenancy: isolate data by organization
    Title: string;
    Description: string;
    Status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
    Priority: TaskPriority;
    Category: TaskCategory;

    // Dates
    Created_Date: string;
    Due_Date?: string;
    Reminder_Date?: string;
    Completed_Date?: string;

    // Entity Links (flexible linking system)
    Links: TaskLink[];

    // Assignment
    Assigned_Worker_ID?: string;
    Assigned_Worker_Name?: string;

    // Notes
    Notes?: string;

    // Checklist items for sub-tasks
    Checklist?: ChecklistItem[];
}

export interface WorkOrder {
    Work_Order_ID: string;
    Organization_ID: string;  // Multi-tenancy: isolate data by organization
    Name?: string;  // Opisni naziv radnog naloga (npr. "Stolovi za hotel")
    Work_Order_Number: string;
    Created_Date: string;
    Due_Date: string;
    Status: 'Na čekanju' | 'U toku' | 'Završeno' | 'Otkazano';
    Production_Steps: string[];
    Notes: string;

    // DATUMI (agregat iz items)
    Started_At?: string;           // Najraniji Started_At iz items
    Completed_Date?: string;       // Legacy field (use Completed_At)
    Completed_At?: string;         // Najkasniji Completed_At iz items

    // TROŠKOVI (agregat iz items)
    Total_Value?: number;          // Ukupna vrijednost iz ponude
    Material_Cost?: number;        // Ukupan trošak materijala
    Planned_Labor_Cost?: number;   // Suma svih planiranih troškova rada
    Actual_Labor_Cost?: number;    // Suma stvarnih troškova rada (iz Attendance)
    Labor_Cost?: number;           // Legacy field (use Actual_Labor_Cost)

    // PROFIT
    Profit?: number;               // Total_Value - Material_Cost - Actual_Labor_Cost
    Profit_Margin?: number;        // (Profit / Total_Value) × 100
    Labor_Cost_Variance?: number;  // Planned_Labor_Cost - Actual_Labor_Cost

    // PLANER / GANTT SCHEDULING
    Planned_Start_Date?: string;   // Planirani datum početka
    Planned_End_Date?: string;     // Planirani datum završetka
    Is_Scheduled?: boolean;        // True ako je nalog dodan u planer
    Scheduled_At?: string;         // Timestamp kada je zakazan
    Color_Code?: string;           // Boja za prikaz u planeru (hex)

    items?: WorkOrderItem[];
}

// Status procesa za pojedinačni proizvod u radnom nalogu
export interface ItemProcessStatus {
    Process_Name: string;
    Status: 'Na čekanju' | 'U toku' | 'Završeno' | 'Odloženo';
    Started_At?: string;
    Completed_At?: string;
    Duration_Minutes?: number;
    Worker_ID?: string;
    Worker_Name?: string;
    Helpers?: {
        Worker_ID: string;
        Worker_Name: string;
    }[];
}

// Sub-task za split proizvoda - omogućava podjelu količine na više dijelova
export interface SubTask {
    SubTask_ID: string;
    Quantity: number;                   // Koliko komada ovaj sub-task pokriva
    Current_Process: string;            // Naziv trenutnog aktivnog procesa
    Status: 'Na čekanju' | 'U toku' | 'Završeno';
    Is_Paused?: boolean;                // Individual pause za svaki sub-task
    Started_At?: string;
    Completed_At?: string;
    Worker_ID?: string;
    Worker_Name?: string;
    Helpers?: { Worker_ID: string; Worker_Name: string }[];  // Pomoćnici na ovoj grupi
    Notes?: string;

    // Cost tracking per sub-task
    Pause_Periods?: Array<{ Started_At: string; Ended_At?: string }>;
    Actual_Labor_Cost?: number;         // Izračunati trošak rada za ovu grupu
    Working_Days?: number;              // Broj radnih dana za ovu grupu
}

export interface WorkOrderItem {
    ID: string;
    Work_Order_ID: string;
    Product_ID: string;
    Product_Name: string;
    Project_ID: string;
    Project_Name: string;
    Quantity: number;
    Total_Product_Quantity?: number;  // Total quantity of the product (from project)

    // STATUS I DATUMI
    Status: 'Na čekanju' | 'U toku' | 'Završeno';
    Is_Paused?: boolean;          // If true, daily rates won't accrue
    Pause_Periods?: Array<{ Started_At: string; Ended_At?: string }>;  // Tracked by toggleItemPause
    Started_At?: string;      // ISO timestamp kada je započeto
    Completed_At?: string;    // ISO timestamp kada je završeno

    // PROCESI ZA OVAJ PROIZVOD (legacy - za backward compatibility)
    Processes?: ItemProcessStatus[];

    // SUB-TASKS - Za split proizvoda po količini
    SubTasks?: SubTask[];

    // DODIJELJENI RADNICI
    Assigned_Workers?: {
        Worker_ID: string;
        Worker_Name: string;
        Daily_Rate: number;   // Dnevnica radnika
    }[];

    // TROŠKOVI RADA
    Planned_Labor_Workers?: number;   // Broj radnika (iz ponude)
    Planned_Labor_Days?: number;      // Broj dana (iz ponude)
    Planned_Labor_Rate?: number;      // Prosječna dnevnica (iz ponude)
    Planned_Labor_Cost?: number;      // Workers × Days × Rate
    Actual_Labor_Cost?: number;       // Kalkulisano iz Attendance
    Actual_Labor_Days?: number;       // Stvarni broj radnih dana
    Actual_Workers_Count?: number;    // Broj radnika koji su radili

    // TRANSPORT I USLUGE
    Transport_Share?: number;         // Proporcionalni dio transporta
    Services_Total?: number;          // Suma dinamičkih usluga (LED, montaža, etc)

    // VRIJEDNOST I MATERIJAL
    Product_Value?: number;    // Cijena proizvoda iz ponude
    Material_Cost?: number;    // Trošak materijala za ovaj proizvod

    // NAPOMENE
    Notes?: string;

    // LEGACY - Za backward compatibility, brišemo kasnije
    Process_Assignments?: Record<string, any>;

    materials?: ProductMaterial[]; // Materials for this product (for print template)
}



export interface WorkerAttendance {
    Attendance_ID: string;
    Organization_ID: string;  // Multi-tenancy: isolate data by organization
    Worker_ID: string;
    Worker_Name: string;
    Date: string;                        // YYYY-MM-DD format

    // Attendance status
    Status: 'Prisutan' | 'Odsutan' | 'Bolovanje' | 'Odmor' | 'Teren' | 'Vikend';

    // Work details (only if Status = 'Prisutan' or 'Teren')
    Hours_Worked?: number;               // If different from standard 8h
    Is_Overtime?: boolean;
    Overtime_Hours?: number;

    // Notes
    Notes?: string | null;                      // Razlog odsutnosti, lokacija terena, etc.

    Created_Date: string;
    Modified_Date?: string;
}

// ============================================
// WORK LOG - Evidencija rada po proizvodu
// ============================================

export interface WorkLog {
    WorkLog_ID: string;
    Organization_ID: string;  // Multi-tenancy: isolate data by organization
    Date: string;                    // YYYY-MM-DD format

    // Radnik
    Worker_ID: string;
    Worker_Name: string;
    Daily_Rate: number;              // Snimljena dnevnica tog dana
    Hours_Worked: number;            // Default 8, može biti manje/više

    // Veza sa proizvodom
    Work_Order_ID: string;
    Work_Order_Item_ID: string;      // Koji proizvod u radnom nalogu
    Product_ID: string;              // Referenca na originalni proizvod
    SubTask_ID?: string;             // Ako je split, koja grupa

    // Proces na kojem je radnik radio
    Process_Name?: string;           // Rezanje, Kantiranje, etc.

    // Status i metadata
    Is_From_Attendance: boolean;     // Da li je automatski kreirano iz sihtarice
    Notes?: string;

    Created_At: string;
    Modified_At?: string;
}

// ============================================
// CONSTANTS
// ============================================

export const PROJECT_STATUSES = ['Nacrt', 'Ponuđeno', 'Odobreno', 'U proizvodnji', 'Završeno', 'Otkazano'];
export const PRODUCT_STATUSES = ['Na čekanju', 'Materijali naručeni', 'Materijali spremni', 'Rezanje', 'Kantiranje', 'Bušenje', 'Sklapanje', 'Spremno', 'Instalirano'];
export const MATERIAL_STATUSES = ['Nije naručeno', 'Na stanju', 'Naručeno', 'Primljeno'];
export const OFFER_STATUSES = ['Nacrt', 'Poslano', 'Prihvaćeno', 'Odbijeno', 'Isteklo', 'Revidirano'];
export const ORDER_STATUSES = ['Nacrt', 'Poslano', 'Potvrđeno', 'Isporučeno', 'Primljeno', 'Djelomično'];
export const MATERIAL_CATEGORIES = ['Ploče i trake', 'Okovi', 'Staklo', 'Alu vrata', 'Ostalo'];
export const WORKER_ROLES = ['Rezač', 'Kantiranje', 'Bušenje', 'Montaža', 'Instalacija', 'Opći'];
export const WORKER_TYPES = ['Glavni', 'Pomoćnik'] as const;
export const WORK_ORDER_STATUSES = ['Na čekanju', 'U toku', 'Završeno', 'Otkazano'];
export const PRODUCTION_STEPS = ['Rezanje', 'Kantiranje', 'Bušenje', 'Sklapanje'];
export const ATTENDANCE_STATUSES = ['Prisutan', 'Odsutan', 'Bolovanje', 'Odmor', 'Teren', 'Vikend', 'Praznik'] as const;
export const PROCESS_STATUSES = ['Na čekanju', 'U toku', 'Odloženo', 'Završeno'] as const;

// Dopuštene tranzicije statusa materijala (source → allowed targets)
export const ALLOWED_MATERIAL_TRANSITIONS: Record<string, string[]> = {
    'Nije naručeno': ['Na stanju', 'Naručeno'],
    'Na stanju': ['Nije naručeno'],
    'Naručeno': ['Nije naručeno', 'Primljeno'],
    'Primljeno': ['Naručeno'],
};

// Dopuštene tranzicije statusa narudžbe (source → allowed targets)
export const ALLOWED_ORDER_TRANSITIONS: Record<string, string[]> = {
    'Nacrt': ['Poslano'],
    'Poslano': ['Nacrt', 'Potvrđeno'],
    'Potvrđeno': ['Nacrt', 'Isporučeno', 'Djelomično'],
    'Isporučeno': ['Primljeno', 'Djelomično'],
    'Djelomično': ['Primljeno', 'Isporučeno'],
    'Primljeno': [],
};

// Task constants
export const TASK_STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'] as const;
export const TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export const TASK_CATEGORIES = ['general', 'manufacturing', 'ordering', 'installation', 'design', 'meeting', 'reminder'] as const;
export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
    low: 'Nizak',
    medium: 'Srednji',
    high: 'Visok',
    urgent: 'Hitan'
};
export const TASK_STATUS_LABELS: Record<string, string> = {
    pending: 'Na čekanju',
    in_progress: 'U toku',
    completed: 'Završeno',
    cancelled: 'Otkazano'
};
export const TASK_CATEGORY_LABELS: Record<TaskCategory, string> = {
    general: 'Općenito',
    manufacturing: 'Proizvodnja',
    ordering: 'Narudžba',
    installation: 'Instalacija',
    design: 'Dizajn',
    meeting: 'Sastanak',
    reminder: 'Podsjetnik'
};

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
    workOrders: WorkOrder[];
    productMaterials: ProductMaterial[];
    glassItems: GlassItem[];
    aluDoorItems: AluDoorItem[];
    workLogs: WorkLog[];
    tasks: Task[];
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
    Is_Super_Admin?: boolean;  // Set only via Firestore console, never from client
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

// ============================================
// WORKER CONFLICT TYPE (for scheduling)
// ============================================

export interface WorkerConflict {
    Worker_ID: string;
    Worker_Name: string;
    Conflicting_Work_Order_ID: string;
    Conflicting_Work_Order_Number: string;
    Conflicting_Project_Name: string;
    Overlap_Start: string;
    Overlap_End: string;
}

// ============================================
// DYNAMIC SERVICES - Korisničke usluge
// ============================================

export interface ServiceDefinition {
    Service_ID: string;
    Organization_ID: string;
    Name: string;                    // "LED rasvjeta", "Fugiranje", "Montaža"
    Default_Price: number;           // Podrazumijevana cijena
    Unit: string;                    // "m", "kom", "m²", "sat"
    Category: string;                // "Rasvjeta", "Montaža", "Obrada"
    Is_Active: boolean;              // Da li je aktivna
    Created_Date: string;
}

export interface OfferProductService {
    Service_ID: string;
    Service_Name: string;
    Quantity: number;
    Unit: string;
    Unit_Price: number;
    Total: number;
}

// ============================================
// PRODUCTIVITY METRICS - Produktivnost
// ============================================

export interface WorkerProductivity {
    Worker_ID: string;
    Worker_Name: string;

    // Radni dani
    Days_Worked: number;             // Ukupno radnih dana (iz WorkLog)
    Days_Present: number;            // Prisutan + Teren (iz Attendance)
    Attendance_Rate: number;         // (Days_Present / Radni dani u periodu) × 100

    // Finansije
    Total_Earnings: number;          // Σ(Daily_Rate za sve Work Logs)
    Avg_Daily_Rate: number;          // Prosječna dnevnica

    // Produktivnost
    Products_Worked_On: number;      // Broj različitih proizvoda
    Avg_Days_Per_Product: number;    // Prosječno dana po proizvodu

    // Efikasnost
    Value_Generated: number;         // Σ(Product_Value) za proizvode na kojima je radio
    Value_Per_Day: number;           // Value_Generated / Days_Worked
}

export interface ProductProfitability {
    Product_ID: string;
    Product_Name: string;
    Work_Order_Item_ID: string;

    // Vrijednosti
    Selling_Price: number;           // Cijena iz ponude
    Quantity: number;                // Količina

    // Troškovi
    Material_Cost: number;           // Trošak materijala
    Transport_Share: number;         // Proporcionalni transport
    Services_Total: number;          // Usluge (LED, etc)

    // Rad
    Planned_Labor_Cost: number;
    Actual_Labor_Cost: number;
    Labor_Variance: number;          // Planirano - Stvarno
    Labor_Variance_Percent: number;  // (Variance / Planned) × 100

    // Profit
    Gross_Profit: number;            // Selling - Material - Transport - Services
    Net_Profit: number;              // Gross - Actual_Labor
    Profit_Margin: number;           // (Net_Profit / Selling) × 100

    // Radnici koji su radili
    Workers: {
        Worker_ID: string;
        Name: string;
        Days: number;
        Cost: number;
    }[];

    // Datumi
    Started_At?: string;
    Completed_At?: string;
    Duration_Days?: number;
}

// ============================================
// PRODUCTION SNAPSHOT - AI/ML Training Data
// ============================================

export interface SnapshotMaterial {
    Material_ID: string;
    Material_Name: string;
    Category: string;              // "Ploče", "Okovi", "Staklo"...
    Quantity: number;
    Unit: string;
    Unit_Price: number;
    Total_Price: number;
    Is_Glass: boolean;
    Is_Alu_Door: boolean;

    // Price Accuracy Metadata
    Price_Captured_At: string;     // Timestamp kada je cijena zabilježena
    Is_Final_Price: boolean;       // true = finalna cijena pri završetku
}

export interface SnapshotWorker {
    Worker_ID: string;
    Worker_Name: string;
    Role: string;
    Worker_Type: 'Glavni' | 'Pomoćnik';
    Days_Worked: number;
    Daily_Rate: number;
    Total_Cost: number;
}

// NOVO: Za praćenje vremena po procesu
export interface SnapshotProcess {
    Process_Name: string;           // "Rezanje", "Kantiranje"...
    Status: string;
    Started_At?: string;
    Completed_At?: string;
    Duration_Days: number;
    Worker_ID?: string;
    Worker_Name?: string;
    Helpers_Count: number;
}

// NOVO: Za praćenje extras/services
export interface SnapshotExtra {
    Name: string;
    Quantity: number;
    Unit: string;
    Unit_Price: number;
    Total: number;
}

export interface ProductionSnapshotItem {
    Product_ID: string;
    Product_Name: string;

    // Klasifikacija proizvoda (za grupisanje sličnih)
    Product_Type?: string;          // "Kuhinja", "Ormar", "Komoda", "Stol"...

    // Dimenzije
    Height: number;
    Width: number;
    Depth: number;
    Volume_M3: number;              // H × W × D / 1,000,000,000
    Surface_M2: number;             // H × W / 1,000,000 (prednja površina)

    // Količina
    Quantity: number;

    // Materijali
    Materials: SnapshotMaterial[];
    Material_Count: number;
    Has_Glass: boolean;
    Has_Alu_Door: boolean;
    Total_Material_Cost: number;

    // Material Ratios (za AI estimaciju)
    Material_Per_M2: number;        // Total_Material_Cost / Surface_M2
    Material_Per_M3: number;        // Total_Material_Cost / Volume_M3
    Material_Per_Unit: number;      // Total_Material_Cost / Quantity

    // Rad
    Planned_Labor_Days: number;
    Actual_Labor_Days: number;
    Workers_Assigned: SnapshotWorker[];

    // Procesi sa vremenima (za detaljno planiranje)
    Processes: SnapshotProcess[];

    // Offer detalji (za AI kreiranje ponuda)
    Selling_Price: number;
    Margin_Percent: number;
    Margin_Type: 'Fixed' | 'Percentage';
    LED_Meters: number;
    LED_Price_Per_Meter: number;
    LED_Total: number;
    Transport_Share: number;
    Extras: SnapshotExtra[];
    Profit: number;

    // Legacy
    Margin_Applied: number;         // Backward compatibility
}

export interface ProductionSnapshot {
    // Identifikatori
    Snapshot_ID: string;
    Organization_ID: string;
    Work_Order_ID: string;
    Work_Order_Number: string;
    Created_At: string;             // Timestamp kreiranja snapshota

    // Projekt Info
    Project_ID: string;
    Client_Name: string;
    Project_Deadline: string;

    // Offer Info (ako postoji)
    Offer_ID?: string;
    Offer_Number?: string;
    Offer_Total?: number;
    Offer_Transport_Cost?: number;
    Offer_Has_Onsite_Assembly?: boolean;

    // Proizvod Info (denormalizirano za svaki item)
    Items: ProductionSnapshotItem[];

    // Agregati za Work Order
    Total_Products: number;         // Ukupan broj proizvoda
    Total_Quantity: number;         // Ukupna količina svih proizvoda
    Total_Material_Cost: number;    // Σ materijala
    Total_Selling_Price: number;    // Σ cijena iz ponude

    // Agregat ratios (za brzu AI analizu)
    Avg_Material_Per_M2: number;
    Avg_Material_Per_M3: number;

    // Vrijeme
    Planned_Start?: string;
    Planned_End?: string;
    Actual_Start?: string;
    Actual_End?: string;
    Planned_Days: number;
    Actual_Days: number;
    Duration_Variance: number;      // Actual - Planned (pozitivno = kašnjenje)

    // Troškovi Rada
    Planned_Labor_Cost: number;
    Actual_Labor_Cost: number;
    Labor_Cost_Variance: number;    // Planned - Actual
    Labor_Variance_Percent: number;

    // Profit
    Gross_Profit: number;
    Net_Profit: number;
    Profit_Margin_Percent: number;

    // Radnici (Agregirano)
    Workers_Count: number;
    Total_Worker_Days: number;      // Σ svih radnih dana svih radnika
    Avg_Daily_Rate: number;

    // Procesi
    Production_Steps: string[];     // ["Rezanje", "Kantiranje", ...]

    // Sezonalnost (za ML)
    Month: number;                  // 1-12
    Quarter: number;                // 1-4
    Day_Of_Week_Start: number;      // 0-6 (0 = Sunday)

    // Data Quality (za AI validaciju)
    Quality_Score: number;          // 0-100, samo score >= 50 koristi AI
    Data_Issues: string[];          // Lista problema ['Missing material cost', ...]
    Is_Valid_For_AI: boolean;       // true ako Quality_Score >= 50
    Normalized_Product_Types: string[]; // Normalizirani tipovi ['Kuhinja', 'Ormar']

    // Material Price Accuracy
    Materials_Snapshot_Time: string; // Timestamp kada su cijene materijala zabilježene
    Materials_Are_Final: boolean;    // true = finalne cijene pri završetku naloga
}

