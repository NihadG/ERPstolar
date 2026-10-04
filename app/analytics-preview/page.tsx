'use client';

// ════════════════════════════════════════════════════════════════════
// /analytics-preview — PRAVA Analitika s izmišljenim podacima.
//
// Aplikacija je iza prijave; ova ruta renderuje isti AnalyticsDashboard bez baze
// (initialRaw) da se izgled i brojevi novog modela profita mogu provjeriti.
// Podaci su izmišljeni, ali pokrivaju sve slučajeve: završeni / u izradi /
// nezapočeti proizvodi, dodaci iz ponude, proizvod bez ponude, montaža, razni
// poslovi, dnevnica obrisanog naloga i prisutni dani bez dnevnice.
//
// U produkciji ruta ne postoji.
// ════════════════════════════════════════════════════════════════════

import { useMemo } from 'react';
import { notFound } from 'next/navigation';
import AnalyticsDashboard from '@/components/ui/AnalyticsDashboard';
import type { AnalyticsRaw } from '@/lib/services/profit/analyticsService';
import type { Project, WorkOrder, WorkOrderItem, WorkLog, Offer, WorkerAttendance } from '@/lib/types';

export const dynamic = 'force-dynamic';

type P = { id: string; name: string; qty?: number; status: string; bom: number };
const project = (id: string, name: string, client: string, status: string, products: P[]): Project => ({
    Project_ID: id, Name: name, Client_Name: client, Status: status,
    products: products.map(p => ({
        Product_ID: p.id, Project_ID: id, Name: p.name, Quantity: p.qty || 1, Status: p.status,
        materials: p.bom > 0 ? [{ ID: `${p.id}-m`, Product_ID: p.id, Material_Name: 'Iveral', Quantity: 1, Unit: 'm²', Unit_Price: p.bom, Total_Price: p.bom, Status: 'Primljeno' }] : [],
    })),
} as unknown as Project);

const DEMO_PROJECTS: Project[] = [
    project('P1', 'Kuća Hrasno', 'Mirza Hodžić', 'U proizvodnji', [
        { id: 'A', name: 'ST1 Ormar u hodniku', status: 'Spremno', bom: 1725 },
        { id: 'B', name: 'ST2 Garderoba', status: 'Spremno', bom: 2590 },
        { id: 'C', name: 'Vrata U001', status: 'Spremno', bom: 0 },
        { id: 'D', name: 'ST10 Kuhinja', status: 'Sklapanje', bom: 3410 },
        { id: 'E', name: 'ST11 Ostrvo', status: 'Sklapanje', bom: 1923 },
        { id: 'F', name: 'ST20 Dječija soba', status: 'Na čekanju', bom: 3055 },
        { id: 'G', name: 'ST5 Biblioteka', status: 'Spremno', bom: 1291, qty: 2 },
    ]),
    project('P2', 'Stan Grbavica', 'Amra Selimović', 'Završeno', [
        { id: 'H', name: 'Poz 1 Kuhinja', status: 'Instalirano', bom: 2900 },
        { id: 'I', name: 'Poz 2 TV komoda', status: 'Instalirano', bom: 640 },
    ]),
    project('P3', 'Hotel recepcija', 'Hoteli Budnjo', 'Odobreno', [
        { id: 'J', name: 'Recepcijski pult', status: 'Na čekanju', bom: 4100 },
        { id: 'K', name: 'Zidna obloga', status: 'Na čekanju', bom: 2600 },
    ]),
    project('P4', 'Kuhinja Ilidža', 'Vladimir K.', 'U proizvodnji', [
        { id: 'L', name: 'Kuhinja L', status: 'Sklapanje', bom: 2200 },
    ]),
];

const line = (pid: string, sell: number, mat: number, labor: [number, number, number], extras = 0, qty = 1) => ({
    ID: `op-${pid}`, Product_ID: pid, Included: true, Quantity: qty, Selling_Price: sell, Total_Price: sell * qty,
    Material_Cost: mat, Labor_Workers: labor[0], Labor_Days: labor[1], Labor_Daily_Rate: labor[2],
    extras: extras ? [{ ID: `ex-${pid}`, Offer_Product_ID: `op-${pid}`, Name: 'Materijal vrata', Quantity: 1, Unit: 'kom', Unit_Price: extras, Total: extras }] : [],
});
const DEMO_OFFERS: Offer[] = [
    { Offer_ID: 'O1', Project_ID: 'P1', Offer_Number: 'P-2026/05', Status: 'Prihvaćeno', Accepted_Date: '2026-07-14', products: [
        line('A', 6045, 1725, [1, 6, 130]), line('B', 6830, 2590, [1, 8, 130]), line('C', 2853.6, 0, [1, 2, 130], 850),
        line('D', 11070.4, 3410, [2, 7, 130]), line('E', 6050.7, 1923, [1, 5, 130]), line('F', 7635, 3463, [2, 7, 130]),
    ] },
    { Offer_ID: 'O2', Project_ID: 'P2', Offer_Number: 'P-2026/09', Status: 'Prihvaćeno', Accepted_Date: '2026-06-02', products: [
        line('H', 8200, 2700, [2, 6, 130]), line('I', 1900, 640, [1, 3, 130]),
    ] },
    { Offer_ID: 'O3', Project_ID: 'P3', Offer_Number: 'P-2026/22', Status: 'Prihvaćeno', Accepted_Date: '2026-08-28', products: [
        line('J', 14800, 4100, [2, 10, 130]), line('K', 9600, 2600, [2, 6, 130]),
    ] },
] as unknown as Offer[];

const item = (id: string, wo: string, pid: string, project: string, status: string, completed?: string, extra: Partial<WorkOrderItem> = {}): WorkOrderItem => ({
    ID: id, Work_Order_ID: wo, Product_ID: pid, Product_Name: DEMO_PROJECTS.flatMap(p => p.products || []).find(p => p.Product_ID === pid)?.Name || pid,
    Project_ID: project, Project_Name: DEMO_PROJECTS.find(p => p.Project_ID === project)?.Client_Name || '', Quantity: 1, Status: status,
    Completed_At: completed, ...extra,
} as WorkOrderItem);
const wo = (id: string, number: string, status: string, type: string, items: WorkOrderItem[]): WorkOrder => ({
    Work_Order_ID: id, Work_Order_Number: number, Name: '', Status: status, Work_Order_Type: type, items,
} as unknown as WorkOrder);

const DEMO_WOS: WorkOrder[] = [
    wo('W1', '2026-09/R1', 'Završeno', 'Proizvodnja', [
        item('a', 'W1', 'A', 'P1', 'Završeno', '2026-09-12T10:00:00Z'),
        item('b', 'W1', 'B', 'P1', 'Završeno', '2026-10-02T10:00:00Z'),
        item('c', 'W1', 'C', 'P1', 'Završeno', '2026-10-02T10:00:00Z'),
        item('g', 'W1', 'G', 'P1', 'Završeno', '2026-09-20T10:00:00Z', { Quantity: 2, Product_Value: 10482 }),
    ]),
    wo('W2', '2026-09/R6', 'U toku', 'Proizvodnja', [item('d', 'W2', 'D', 'P1', 'U toku'), item('e', 'W2', 'E', 'P1', 'U toku')]),
    wo('W3', '2026-07/R2', 'Završeno', 'Proizvodnja', [
        item('h', 'W3', 'H', 'P2', 'Završeno', '2026-08-05T10:00:00Z'),
        item('i', 'W3', 'I', 'P2', 'Završeno', '2026-08-05T10:00:00Z'),
    ]),
    wo('W4', '2026-08/M1', 'Završeno', 'Montaža', [item('hm', 'W4', 'H', 'P2', 'Završeno', '2026-08-20T10:00:00Z')]),
    wo('W5', '2026-09/R8', 'U toku', 'Proizvodnja', [item('l', 'W5', 'L', 'P4', 'U toku', undefined, { Product_Value: 9800 })]),
    wo('Z1', '2026-09/Z1', 'U toku', 'Zadaci', [
        { ID: 'z1', Work_Order_ID: 'Z1', Product_ID: 'custom-1', Product_Name: 'Čišćenje radionice', Project_ID: '', Project_Name: 'Razni poslovi', Quantity: 1, Status: 'U toku', Item_Type: 'custom', Product_Value: 0, Other_Costs: 40 } as WorkOrderItem,
    ]),
];

const WORKERS = [
    { id: 'W-emrah', name: 'Emrah Gluhić', rate: 130 },
    { id: 'W-amir', name: 'Amir Berisalić', rate: 130 },
    { id: 'W-bego', name: 'Bego Saka', rate: 110 },
    { id: 'W-ahmad', name: 'Ahmad Al-Masaud', rate: 130 },
    { id: 'W-dzemal', name: 'Džemal Merdan', rate: 120 },
];

/** Radni dani u rasponu (pon–pet) kao ISO datumi. */
function workdays(from: string, to: string): string[] {
    const out: string[] = [];
    const d = new Date(from + 'T12:00:00');
    const end = new Date(to + 'T12:00:00');
    while (d <= end) {
        const dow = d.getDay();
        if (dow !== 0 && dow !== 6) out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
        d.setDate(d.getDate() + 1);
    }
    return out;
}

function buildRaw(): AnalyticsRaw {
    const logs: WorkLog[] = [];
    const attendance: WorkerAttendance[] = [];
    // Raspored: radnik → stavke na kojima radi (dan se dijeli ravnomjerno).
    const plan: Record<string, { items: string[]; from: string; to: string }[]> = {
        'W-emrah': [{ items: ['a'], from: '2026-09-01', to: '2026-09-11' }, { items: ['d', 'e'], from: '2026-09-14', to: '2026-10-02' }],
        'W-amir': [{ items: ['b', 'c'], from: '2026-09-07', to: '2026-10-01' }],
        'W-bego': [{ items: ['h', 'i'], from: '2026-07-20', to: '2026-08-04' }, { items: ['hm'], from: '2026-08-17', to: '2026-08-20' }, { items: ['z1'], from: '2026-09-21', to: '2026-09-25' }],
        'W-ahmad': [{ items: ['g'], from: '2026-09-01', to: '2026-09-18' }, { items: ['l'], from: '2026-09-21', to: '2026-10-02' }],
        'W-dzemal': [{ items: ['z1'], from: '2026-09-01', to: '2026-09-30' }],
    };
    const itemById = new Map(DEMO_WOS.flatMap(w => (w.items || []).map(i => [i.ID, i] as const)));
    for (const w of WORKERS) {
        for (const block of plan[w.id] || []) {
            for (const date of workdays(block.from, block.to)) {
                block.items.forEach((itemId, idx) => {
                    const it = itemById.get(itemId)!;
                    logs.push({
                        WorkLog_ID: `${w.id}-${date}-${idx}`, Organization_ID: 'demo', Date: date,
                        Worker_ID: w.id, Worker_Name: w.name,
                        Daily_Rate: Math.round((w.rate / block.items.length) * 100) / 100, Original_Daily_Rate: w.rate,
                        Day_Fraction: 1 / block.items.length, Hours_Worked: 8,
                        Work_Order_ID: it.Work_Order_ID, Work_Order_Item_ID: it.ID, Product_ID: it.Product_ID,
                        Is_From_Attendance: true,
                    } as WorkLog);
                });
                attendance.push({ Attendance_ID: `${w.id}-${date}`, Organization_ID: 'demo', Worker_ID: w.id, Worker_Name: w.name, Date: date, Status: 'Prisutan', Created_Date: date } as WorkerAttendance);
            }
        }
    }
    // Prisutni dani bez dnevnice (nije proknjiženo) + dnevnica obrisanog naloga (nulirana).
    for (const date of ['2026-09-29', '2026-09-30', '2026-10-01']) {
        attendance.push({ Attendance_ID: `amir-${date}-x`, Organization_ID: 'demo', Worker_ID: 'W-dzemal', Worker_Name: 'Džemal Merdan', Date: date, Status: 'Prisutan', Created_Date: date } as WorkerAttendance);
    }
    logs.push({
        WorkLog_ID: 'void-1', Organization_ID: 'demo', Date: '2026-09-15', Worker_ID: 'W-amir', Worker_Name: 'Amir Berisalić',
        Daily_Rate: 0, Day_Fraction: 0, Hours_Worked: 8, Work_Order_ID: 'OBRISAN', Work_Order_Item_ID: 'x', Product_ID: 'B',
        Work_Order_Deleted: true, Voided_Daily_Rate: 130, Is_From_Attendance: true,
    } as WorkLog);

    return {
        workOrders: DEMO_WOS,
        items: DEMO_WOS.flatMap(w => w.items || []),
        logs,
        offers: DEMO_OFFERS,
        attendance,
    };
}

export default function AnalyticsPreviewPage() {
    const raw = useMemo(buildRaw, []);
    if (process.env.NODE_ENV === 'production') notFound();
    return (
        <AnalyticsDashboard
            onClose={() => { /* preview: nema zatvaranja */ }}
            projects={DEMO_PROJECTS}
            initialRaw={raw}
            showToast={(m) => console.log('[toast]', m)}
        />
    );
}
