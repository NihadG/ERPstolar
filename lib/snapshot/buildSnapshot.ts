// ════════════════════════════════════════════════════════════════════
// PRODUCTION SNAPSHOT v3 — ČISTA RAČUNICA (bez Firebase).
//
// Prima već učitane podatke, vraća objekat. Zato je konačno testabilno: do v2 je
// cijela računica živjela unutar async funkcije s upitima, pa se nije mogla pokriti.
// Dohvat i upis ostaju u lib/database.ts.
//
// ── ŠTA JE POPRAVLJENO U ODNOSU NA v2 ───────────────────────────────
//  #1 Worker_Days = Σ Day_Fraction (v2: brojao REDOVE logova → pola dana = 1).
//     INVARIJANTA: Σ Worker_Days === Actual_Labor_Days stavke.
//  #2 SnapshotMaterial.Category = kategorija iz kataloga (v2: pisao DOBAVLJAČA).
//  #3 Tip proizvoda kroz lib/classify (v2: inline if/else, bez dijakritike,
//     „stol" je hvatao „stolica", a NAZIV NALOGA se uopšte nije gledao).
//  #5 Work_Order_Type se upisuje (bez njega „ko ide na montažu" nema odgovor).
//  #6 Procesi iz WorkLog.Process_Node_ID (v2: iz legacy item.Processes checkliste).
//  #7 Trajanja u radnik-danima + zaseban kalendarski Lead_Days (v2: miješalo jedinice).
//  #9 Total_Worker_Days = Σ Day_Fraction (v2: workLogs.length).
// #10 Planned_Days = Σ dani × radnici (v2: Planned_Labor_Cost / 100 — trošak kao dani).
// #11 Actual_Days više ne mjeri „do danas" za nezavršen nalog.
//
// Polja #9–#11 nije čitala NIJEDNA komponenta (provjereno), pa je ispravka semantike
// bezopasna; v3 marker govori čitaocima koja pravila važe.
// ════════════════════════════════════════════════════════════════════

import type {
    WorkOrder, WorkOrderItem, WorkLog, Worker, Project, Offer, OfferProduct,
    Product, ProductMaterial, Material, ProcessGraph,
    ProductionSnapshot, ProductionSnapshotItem,
    SnapshotMaterial, SnapshotWorker, SnapshotProcess, SnapshotExtra,
} from '../types';
import { itemProfitBreakdown } from '../profit';
import { itemMaterialTotal } from '../materialCost';
import { materialTypeFromName, MATERIAL_TYPES, type MaterialType } from '../productProcesses';
import { buildMaterialProfile, mergeMaterialProfiles, type MaterialProfile } from './materialProfile';
import { classifyWorkOrder, productTypesFromName } from '../classify/classify';
import { PRODUCT_TYPES, TAXONOMY_VERSION, type ProductType } from '../classify/taxonomy';
import { buildProcessTrace, type TraceLogLite } from './processTrace';

export const SNAPSHOT_VERSION = 3;

export interface BuildSnapshotInput {
    workOrder: WorkOrder;                              // sa .items
    project?: Project | null;
    offer?: Offer | null;
    offerProducts?: OfferProduct[];                    // sa .extras
    workLogs: WorkLog[];                               // logovi OVOG naloga
    workers?: Worker[];
    productsById?: Map<string, Product>;
    materialsByProduct?: Map<string, ProductMaterial[]>;
    materialCatalogById?: Map<string, Material>;       // za KATEGORIJU (#2)
    graph?: ProcessGraph | null;                       // graf procesa naloga
    productTypes?: ProductType[];                      // taksonomija + korisnikova pravila
    materialTypes?: MaterialType[];                    // isto, za materijale
    classificationMethod?: ProductionSnapshot['Classification_Method'];
    snapshotId: string;
    now?: Date;                                        // injektabilno za testove
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Radnik-dani iz logova: Σ Day_Fraction. Log bez fraction = cijeli dan (legacy). */
function workerDaysOf(logs: { Day_Fraction?: number }[]): number {
    return r2(logs.reduce((s, l) => s + (l.Day_Fraction ?? 1), 0));
}

export function buildProductionSnapshot(input: BuildSnapshotInput): ProductionSnapshot {
    const {
        workOrder, project, offer, snapshotId,
        offerProducts = [],
        workLogs = [],
        workers = [],
        graph = null,
        productTypes = PRODUCT_TYPES,
        materialTypes = MATERIAL_TYPES,
        classificationMethod,
    } = input;

    // Mape se vade zasebno: `= new Map()` u destrukturiranju izgubi tipske parametre
    // i sve što iz njih izađe postane `any` (tiho gubljenje provjere tipova).
    const productsById: Map<string, Product> = input.productsById ?? new Map();
    const materialsByProduct: Map<string, ProductMaterial[]> = input.materialsByProduct ?? new Map();
    const materialCatalogById: Map<string, Material> = input.materialCatalogById ?? new Map();

    const now = input.now ?? new Date();
    const nowISO = now.toISOString();
    const items: WorkOrderItem[] = workOrder.items || [];
    const workersById = new Map(workers.map(w => [w.Worker_ID, w]));

    // ── Klasifikacija: stavke + NAZIV NALOGA (#3) ───────────────────
    const classification = classifyWorkOrder(
        { Name: workOrder.Name, Work_Order_Number: workOrder.Work_Order_Number },
        items.map(i => ({ Product_Name: i.Product_Name })),
        productTypes
    );

    // ── Tok procesa iz dnevnica (work_logs = event log) (#6, #7) ────
    const trace = buildProcessTrace({
        logs: workLogs as TraceLogLite[],
        graph: graph ? { nodes: graph.nodes || [], edges: graph.edges || [] } : null,
    });

    // Radnik-dani po procesu, po radniku — za afinitet „ko nosi koji proces"
    const processDaysByWorker = new Map<string, Record<string, number>>();
    for (const run of trace.Process_Runs) {
        for (const w of run.Workers) {
            const rec = processDaysByWorker.get(w.Worker_ID) || {};
            rec[run.Process_Name] = r2((rec[run.Process_Name] || 0) + w.Worker_Days);
            processDaysByWorker.set(w.Worker_ID, rec);
        }
    }

    // ── Stavke ──────────────────────────────────────────────────────
    const snapshotItems: ProductionSnapshotItem[] = [];
    const materialProfiles: MaterialProfile[] = [];
    let totalMaterialCost = 0;
    let totalSellingPrice = 0;
    let totalQuantity = 0;
    let totalSurfaceM2 = 0;
    let totalVolumeM3 = 0;

    for (const item of items) {
        const product = productsById.get(item.Product_ID);
        const height = product?.Height || 0;
        const width = product?.Width || 0;
        const depth = product?.Depth || 0;
        const volume = (height * width * depth) / 1_000_000_000;   // mm³ → m³
        const surface = (height * width) / 1_000_000;              // mm² → m²

        // #3 — svi tipovi iz naziva proizvoda (proizvod zna biti „kuhinja + ormar")
        const itemTypes = productTypesFromName(item.Product_Name, productTypes).types;

        const materials = materialsByProduct.get(item.Product_ID) || [];
        // Sastavnica opisuje proizvod bolje od naziva: prisutnost → dominacija → pokretači.
        const matProfile = buildMaterialProfile(materials, materialTypes);
        materialProfiles.push(matProfile);

        const snapshotMaterials: SnapshotMaterial[] = materials.map(m => ({
            Material_ID: m.ID,
            Material_Name: m.Material_Name,
            // #2 — KATEGORIJA iz kataloga; dobavljač ide u svoje polje
            Category: materialCatalogById.get(m.Material_ID)?.Category || 'Ostalo',
            Supplier: m.Supplier || '',
            Material_Type: materialTypeFromName(m.Material_Name) || undefined,
            Quantity: m.Quantity,
            Unit: m.Unit,
            Unit_Price: m.Unit_Price,
            Total_Price: m.Total_Price,
            Is_Glass: (m.glassItems?.length || 0) > 0,
            Is_Alu_Door: (m.aluDoorItems?.length || 0) > 0,
            Price_Captured_At: nowISO,
            Is_Final_Price: true,
        }));

        const hasGlass = snapshotMaterials.some(m => m.Is_Glass);
        const hasAluDoor = snapshotMaterials.some(m => m.Is_Alu_Door);

        // Σ product_materials = trošak PO KOMADU; ukupno = × količina (kao prihod)
        const materialPerUnit = materials.reduce((s, m) => s + (m.Total_Price || 0), 0);
        const itemMaterialTotalCost = itemMaterialTotal(materialPerUnit, item.Quantity);

        // Omjeri su PER-KOMAD (dimenzije H×W×D su za jedan komad)
        const materialPerM2 = surface > 0 ? materialPerUnit / surface : 0;
        const materialPerM3 = volume > 0 ? materialPerUnit / volume : 0;

        // ── Radnici stavke (#1) ─────────────────────────────────────
        const itemLogs = workLogs.filter(wl => wl.Work_Order_Item_ID === item.ID);
        const actualLaborDays = workerDaysOf(itemLogs);

        const byWorker = new Map<string, { name: string; days: number; dates: Set<string>; cost: number }>();
        for (const wl of itemLogs) {
            const e = byWorker.get(wl.Worker_ID) || { name: wl.Worker_Name, days: 0, dates: new Set<string>(), cost: 0 };
            e.days += wl.Day_Fraction ?? 1;          // #1 — radnik-dani, ne redovi
            e.dates.add(wl.Date);
            e.cost += wl.Daily_Rate || 0;
            if (wl.Worker_Name) e.name = wl.Worker_Name;
            byWorker.set(wl.Worker_ID, e);
        }

        const snapshotWorkers: SnapshotWorker[] = Array.from(byWorker.entries()).map(([workerId, d]) => {
            const w = workersById.get(workerId);
            const workerDays = r2(d.days);
            return {
                Worker_ID: workerId,
                Worker_Name: d.name || w?.Name || 'Nepoznat',
                Role: w?.Role || 'Opći',
                Worker_Type: w?.Worker_Type || 'Glavni',
                Days_Worked: d.dates.size,            // broj RAZLIČITIH datuma (jasno definisano)
                Worker_Days: workerDays,              // Σ Day_Fraction — nosivo za statistiku
                Process_Days: processDaysByWorker.get(workerId),
                Share_Of_Item: actualLaborDays > 0 ? r2(workerDays / actualLaborDays) : 0,
                // Dnevnica po STVARNOM radnom danu (v2 je dijelio brojem redova)
                Daily_Rate: d.dates.size > 0 ? r2(d.cost / d.dates.size) : 0,
                Total_Cost: r2(d.cost),
            };
        }).sort((a, b) => b.Worker_Days - a.Worker_Days || a.Worker_ID.localeCompare(b.Worker_ID));

        // ── Procesi stavke (#6): iz dnevnica, ne iz legacy checkliste ─
        const itemNodeIds = new Set(
            itemLogs.map(l => l.Process_Node_ID).filter(Boolean) as string[]
        );
        const snapshotProcesses: SnapshotProcess[] = trace.Process_Runs
            .filter(run => itemNodeIds.has(run.Node_ID) || itemNodeIds.size === 0)
            .map(run => ({
                Process_Name: run.Process_Name,
                Status: 'Završeno',
                Started_At: run.First_Day,
                Completed_At: run.Last_Day,
                Duration_Days: run.Worker_Days,     // #7 — RADNIK-DANI (Span_Days je kalendar)
                Worker_ID: run.Workers[0]?.Worker_ID,
                Worker_Name: run.Workers[0]?.Worker_Name,
                Helpers_Count: Math.max(0, run.Workers.length - 1),
            }));

        // ── Ponuda / profit ─────────────────────────────────────────
        const op = offerProducts.find(x => x.Product_ID === item.Product_ID);
        const overrides = item.Profit_Overrides;
        const snapshotExtras: SnapshotExtra[] = (op?.extras || []).map(e => ({
            Name: e.Name, Quantity: e.Quantity, Unit: e.Unit, Unit_Price: e.Unit_Price, Total: e.Total,
        }));
        const servicesTotal = snapshotExtras.reduce((s, e) => s + (e.Total || 0), 0);
        const laborTotal = itemLogs.reduce((s, wl) => s + (wl.Daily_Rate || 0), 0);

        // JEDINSTVENA PROFIT FORMULA (lib/profit.ts) — ista kao kartica naloga i analitika.
        // v2 je istu formulu prepisivao inline, pa je mogla tiho odlutati.
        const breakdown = itemProfitBreakdown({
            productValue: item.Product_Value,
            sellingOverride: overrides?.Selling_Price,
            materialPerUnit,
            quantity: item.Quantity,
            laborTotal,
            servicesTotal,
            transportShare: op?.Transport_Share,
            transportOverride: overrides?.Transport_Share,
        });

        snapshotItems.push({
            Product_ID: item.Product_ID,
            Product_Name: item.Product_Name,
            Product_Type: itemTypes[0],               // legacy v2 polje (prvi tip)
            Product_Types: itemTypes,                 // v3 — svi tipovi
            Material_Types: matProfile.Types,
            Material_Cost_By_Type: matProfile.Cost_By_Type,
            Unmatched_Materials: matProfile.Unmatched,
            Material_Type_Coverage: matProfile.Coverage ?? undefined,
            Work_Drivers: matProfile.Drivers,
            Height: height, Width: width, Depth: depth,
            Volume_M3: volume, Surface_M2: surface,
            Quantity: item.Quantity,
            Materials: snapshotMaterials,
            Material_Count: materials.length,
            Has_Glass: hasGlass,
            Has_Alu_Door: hasAluDoor,
            Total_Material_Cost: itemMaterialTotalCost,
            Material_Per_M2: r2(materialPerM2),
            Material_Per_M3: r2(materialPerM3),
            Material_Per_Unit: r2(materialPerUnit),
            Planned_Labor_Days: item.Planned_Labor_Days || 0,
            // Ista jedinica kao Actual_Labor_Days → plan i stvarno su uporedivi
            Planned_Worker_Days: r2((item.Planned_Labor_Days || 0) * (item.Planned_Labor_Workers || 1)),
            Actual_Labor_Days: actualLaborDays,
            Workers_Assigned: snapshotWorkers,
            Processes: snapshotProcesses,
            Selling_Price: breakdown.revenue,
            Margin_Percent: op?.Margin || 0,
            Margin_Type: op?.Margin_Type || 'Percentage',
            LED_Meters: op?.LED_Meters || 0,
            LED_Price_Per_Meter: op?.LED_Price || 0,
            LED_Total: op?.LED_Total || 0,
            Transport_Share: breakdown.transport,
            Extras: snapshotExtras,
            Profit: breakdown.profit,
            Margin_Applied: op?.Margin || 0,
        });

        totalMaterialCost += itemMaterialTotalCost;
        totalSellingPrice += breakdown.revenue;
        totalQuantity += item.Quantity;
        totalSurfaceM2 += surface * item.Quantity;
        totalVolumeM3 += volume * item.Quantity;
    }

    // ── Agregati ────────────────────────────────────────────────────
    // #10 — planirani radnik-dani = Σ (dani × radnici), ista jedinica kao stvarni.
    const plannedWorkerDays = r2(items.reduce((s, it) => {
        const d = it.Planned_Labor_Days || 0;
        return d > 0 ? s + d * (it.Planned_Labor_Workers || 1) : s;
    }, 0));
    // #9, #11 — stvarni radnik-dani iz logova; nikad „do danas"
    const actualWorkerDays = workerDaysOf(workLogs);

    const orderMaterialProfile = mergeMaterialProfiles(materialProfiles);
    const uniqueWorkers = new Set(workLogs.map(wl => wl.Worker_ID).filter(Boolean));
    const laborCost = workLogs.reduce((s, wl) => s + (wl.Daily_Rate || 0), 0);
    const workDates = new Set(workLogs.map(wl => wl.Date).filter(Boolean));

    const totalTransport = snapshotItems.reduce((s, i) => s + (i.Transport_Share || 0), 0);
    const grossProfit = r2(totalSellingPrice - totalMaterialCost - totalTransport);
    const netProfit = r2(grossProfit - laborCost);
    const profitMargin = totalSellingPrice > 0 ? r2((netProfit / totalSellingPrice) * 100) : 0;

    // Sezonalnost: prvi STVARNI radni dan; bez logova pada na Started_At, pa na sada.
    const firstWorkDay = Array.from(workDates).sort()[0];
    const seasonBase = firstWorkDay
        ? new Date(firstWorkDay + 'T12:00:00')
        : (workOrder.Started_At ? new Date(workOrder.Started_At) : now);

    const snapshot: ProductionSnapshot = {
        Snapshot_ID: snapshotId,
        Organization_ID: workOrder.Organization_ID,
        Work_Order_ID: workOrder.Work_Order_ID,
        Work_Order_Number: workOrder.Work_Order_Number,
        Created_At: nowISO,
        Snapshot_Version: SNAPSHOT_VERSION,

        // v3 — kontekst naloga (#5)
        Work_Order_Type: workOrder.Work_Order_Type,
        Work_Order_Name: workOrder.Name,

        // v3 — klasifikacija (#3)
        Name_Derived_Types: classification.fromOrderName,
        Classification_Source: classification.source,
        Classification_Method: classificationMethod ?? (classification.types.length ? 'rule' : 'none'),
        Taxonomy_Version: TAXONOMY_VERSION,
        Unmatched_Name_Tokens: classification.unmatched,
        // Druga polovina petlje učenja: materijali koje taksonomija ne zna.
        // Do v2 su tiho nestajali, pa se nije znalo da procjena stoji na rupi.
        Unmatched_Materials: orderMaterialProfile.Unmatched,
        Material_Type_Coverage: orderMaterialProfile.Coverage ?? undefined,
        Work_Drivers: orderMaterialProfile.Drivers,

        // v3 — tok procesa
        Process_Runs: trace.Process_Runs,
        Transitions: trace.Transitions,
        Lead_Days: trace.Lead_Days,
        Touch_Days: trace.Touch_Days,
        Active_Days: trace.Active_Days,
        Flow_Efficiency: trace.Flow_Efficiency,

        Project_ID: project?.Project_ID || '',
        Client_Name: project?.Client_Name || 'Unknown',
        Project_Deadline: project?.Deadline || '',

        Offer_ID: offer?.Offer_ID,
        Offer_Number: offer?.Offer_Number,
        Offer_Total: offer?.Total,
        Offer_Transport_Cost: offer?.Transport_Cost,
        Offer_Has_Onsite_Assembly: offer?.Onsite_Assembly,

        Items: snapshotItems,

        Total_Products: snapshotItems.length,
        Total_Quantity: totalQuantity,
        Total_Material_Cost: r2(totalMaterialCost),
        Total_Selling_Price: r2(totalSellingPrice),

        Avg_Material_Per_M2: totalSurfaceM2 > 0 ? r2(totalMaterialCost / totalSurfaceM2) : 0,
        Avg_Material_Per_M3: totalVolumeM3 > 0 ? r2(totalMaterialCost / totalVolumeM3) : 0,

        Planned_Start: workOrder.Planned_Start_Date,
        Planned_End: workOrder.Planned_End_Date,
        Actual_Start: workOrder.Started_At,
        Actual_End: workOrder.Completed_At,
        // #10/#11 — oba u RADNIK-DANIMA (kalendar je Lead_Days)
        Planned_Days: plannedWorkerDays,
        Actual_Days: actualWorkerDays,
        Duration_Variance: r2(actualWorkerDays - plannedWorkerDays),

        Planned_Labor_Cost: workOrder.Planned_Labor_Cost || 0,
        Actual_Labor_Cost: r2(laborCost),
        Labor_Cost_Variance: r2((workOrder.Planned_Labor_Cost || 0) - laborCost),
        Labor_Variance_Percent: workOrder.Planned_Labor_Cost
            ? r2(((workOrder.Planned_Labor_Cost - laborCost) / workOrder.Planned_Labor_Cost) * 100)
            : 0,

        Gross_Profit: grossProfit,
        Net_Profit: netProfit,
        Profit_Margin_Percent: profitMargin,

        Workers_Count: uniqueWorkers.size,
        Total_Worker_Days: actualWorkerDays,          // #9
        Avg_Daily_Rate: workDates.size > 0 ? r2(laborCost / actualWorkerDays || 0) : 0,

        Production_Steps: workOrder.Production_Steps || [],

        Month: seasonBase.getMonth() + 1,
        Quarter: Math.ceil((seasonBase.getMonth() + 1) / 3),
        Day_Of_Week_Start: seasonBase.getDay(),

        Quality_Score: 100,
        Data_Issues: [],
        Is_Valid_For_AI: true,
        Normalized_Product_Types: classification.types,

        Materials_Snapshot_Time: nowISO,
        Materials_Are_Final: true,
    };

    return applyQuality(snapshot);
}

/**
 * Ocjena kvaliteta podatka. Nije estetika — govori smije li se snapshot koristiti
 * za bilo kakav zaključak. Indikator spremnosti (lib/insights/readiness.ts) ga zbraja.
 */
export function applyQuality(snapshot: ProductionSnapshot): ProductionSnapshot {
    const issues: string[] = [];
    let score = 100;

    if (!snapshot.Total_Material_Cost || snapshot.Total_Material_Cost <= 0) {
        issues.push('Nedostaje trošak materijala'); score -= 50;
    }
    if (!snapshot.Items?.length) { issues.push('Nema proizvoda'); score -= 20; }
    if (!snapshot.Actual_Start || !snapshot.Actual_End) { issues.push('Nedostaju datumi početka/kraja'); score -= 20; }
    if (!snapshot.Actual_Days || snapshot.Actual_Days <= 0) { issues.push('Nema zabilježenog rada'); score -= 10; }
    if (!snapshot.Workers_Count) { issues.push('Nema radnika'); score -= 10; }
    if (snapshot.Profit_Margin_Percent < -50 || snapshot.Profit_Margin_Percent > 200) {
        issues.push('Nerealna marža'); score -= 15;
    }
    // v3: bez planiranih dana se procjena ne može kalibrisati (plan vs stvarno)
    if (!snapshot.Planned_Days || snapshot.Planned_Days <= 0) {
        issues.push('Nema planiranih dana — nemoguće porediti plan i stvarno'); score -= 15;
    }
    // v3: rad koji nije pripisan procesu ne ulazi u analizu toka
    if (!snapshot.Process_Runs?.length) {
        issues.push('Rad nije pripisan procesima'); score -= 15;
    }
    if (snapshot.Classification_Source === 'none') {
        issues.push('Nalog nije klasifikovan (nepoznat tip proizvoda)'); score -= 10;
    }

    snapshot.Quality_Score = Math.max(0, score);
    snapshot.Data_Issues = issues;
    snapshot.Is_Valid_For_AI = snapshot.Quality_Score >= 50;
    return snapshot;
}
