// ════════════════════════════════════════════════════════════════════
// KOMANDNI CENTAR — PODACI ZA MAKETU (/command-preview)
//
// Aplikacija je iza prijave, pa se izgled ne može provjeriti bez naloga.
// Ova maketa renderuje isti ekran s izmišljenim, ali REALNIM podacima:
// materijali u sva četiri statusa, nalog koji kasni, pauziran nalog,
// zadaci svih hitnosti, pitanja bez odgovora, narudžba u kašnjenju.
//
// Datumi su relativni na danas, da maketa nikad ne „ostari".
// Ovaj modul ne koristi nijedan produkcijski ekran.
// ════════════════════════════════════════════════════════════════════

import type { Order, PlanBlock, Project, Task, WorkOrder, Worker } from '../types';
import { todayISO } from '../planning';
import { shiftDate } from '../projectCommand';

const T = todayISO();
const d = (offset: number) => shiftDate(T, offset);

const material = (
    id: string, productId: string, name: string, supplier: string,
    over: Partial<{ Quantity: number; Unit: string; Unit_Price: number; Status: string; On_Stock: number; Ordered_Quantity: number; Received_Quantity: number; Is_Essential: boolean; Order_ID: string }> = {},
) => ({
    ID: id, Organization_ID: 'demo', Product_ID: productId, Material_ID: `m-${id}`,
    Material_Name: name, Quantity: 2, Unit: 'm²', Unit_Price: 42, Total_Price: 84,
    Status: 'Nije naručeno', Supplier: supplier, Order_ID: '',
    On_Stock: 0, Ordered_Quantity: 0, Received_Quantity: 0, ...over,
});

export const demoProjects: Project[] = [
    {
        Project_ID: 'pr-aamanns', Organization_ID: 'demo', Name: 'Aamanns 1921', Client_Name: 'Igor Gavrilović',
        Status: 'U proizvodnji', Created_Date: d(-40), Deadline: d(18), Address: 'Kopenhagen',
        products: [
            {
                Product_ID: 'p-klupe', Organization_ID: 'demo', Project_ID: 'pr-aamanns',
                Name: 'Storage Benches (Klupe sa spremištem)', Quantity: 4, Status: 'U proizvodnji',
                Width: 1800, Height: 450, Depth: 600, Material_Cost: 380, Notes: '',
                Questions: [
                    { id: 'q-1', Text: 'Pripremiti tapaciranje — koja tkanina?', Audience: 'client', Resolved: false, Created_At: d(-6) },
                    { id: 'q-2', Text: 'Sokl na ovim klupama je sada 65mm', Audience: 'colleague', Answer: 'Potvrđeno, radimo 65mm.', Answered_At: d(-2), Resolved: true, Created_At: d(-8) },
                ],
                materials: [
                    material('m-1', 'p-klupe', 'Iveral bijeli 18mm', 'Frischeis', { Status: 'Primljeno', Received_Quantity: 8, Is_Essential: true }),
                    material('m-2', 'p-klupe', 'Kant traka ABS 2mm', 'Frischeis', { Status: 'Naručeno', Ordered_Quantity: 6, Order_ID: 'o-1', Quantity: 1.5 }),
                    material('m-3', 'p-klupe', 'Šarke Blum CLIP top', 'Blum', { Status: 'Nije naručeno', Quantity: 8, Unit: 'kom', Unit_Price: 6.4, Is_Essential: true }),
                    material('m-4', 'p-klupe', 'Tkanina za tapaciranje', 'Tekstil d.o.o.', { Status: 'Nije naručeno', Quantity: 3, Unit: 'm', Unit_Price: 28 }),
                ],
            },
            {
                Product_ID: 'p-lbench', Organization_ID: 'demo', Project_ID: 'pr-aamanns',
                Name: 'L-Shaped Bench (Klupa u obliku slova L)', Quantity: 2, Status: 'Materijali naručeni',
                Width: 2400, Height: 450, Depth: 900, Material_Cost: 520, Notes: '',
                Questions: [
                    { id: 'q-3', Text: 'Da li ide utor za kablove?', Audience: 'client', Resolved: false, Created_At: d(-3) },
                ],
                materials: [
                    material('m-5', 'p-lbench', 'Hrastova furnirana ploča', 'Drvoprodex', { Status: 'Naručeno', Ordered_Quantity: 4, Order_ID: 'o-1', Quantity: 2, Unit_Price: 96, Is_Essential: true }),
                    material('m-6', 'p-lbench', 'Lak vodeni mat', 'Helios', { Status: 'Na stanju', On_Stock: 10, Quantity: 1.2, Unit: 'l', Unit_Price: 22 }),
                ],
            },
            {
                Product_ID: 'p-stol', Organization_ID: 'demo', Project_ID: 'pr-aamanns',
                Name: 'Tables (Pravougaoni stolovi)', Quantity: 6, Status: 'Na čekanju',
                Width: 1600, Height: 750, Depth: 800, Material_Cost: 260, Notes: '',
                materials: [
                    material('m-7', 'p-stol', 'Masiv hrast lamperija', 'Drvoprodex', { Status: 'Nije naručeno', Quantity: 1.8, Unit_Price: 120, Is_Essential: true }),
                    material('m-8', 'p-stol', 'Metalne noge crne', 'Metalac', { Status: 'Nije naručeno', Quantity: 4, Unit: 'kom', Unit_Price: 34 }),
                ],
            },
        ],
    },
    {
        Project_ID: 'pr-melihin', Organization_ID: 'demo', Name: 'Melihin stan — A5', Client_Name: 'Meliha Hadžić',
        Status: 'U proizvodnji', Created_Date: d(-25), Deadline: d(-2), Address: 'Crni vrh',
        products: [
            {
                Product_ID: 'p-vrata', Organization_ID: 'demo', Project_ID: 'pr-melihin',
                Name: 'Poz 7 — Vrata soba desno', Quantity: 3, Status: 'U proizvodnji',
                Width: 900, Height: 2100, Depth: 40, Material_Cost: 180, Notes: '',
                Questions: [
                    { id: 'q-4', Text: 'Kvaka — mesing ili crna?', Audience: 'client', Resolved: false, Created_At: d(-10) },
                ],
                materials: [
                    material('m-9', 'p-vrata', 'MDF ploča 18mm', 'Frischeis', { Status: 'Primljeno', Received_Quantity: 6, Is_Essential: true }),
                    material('m-10', 'p-vrata', 'Kvaka inox', 'Metalac', { Status: 'Nije naručeno', Quantity: 3, Unit: 'kom', Unit_Price: 45, Is_Essential: true }),
                ],
            },
            {
                Product_ID: 'p-kuhinja', Organization_ID: 'demo', Project_ID: 'pr-melihin',
                Name: 'Kuhinjski donji elementi', Quantity: 5, Status: 'Materijali naručeni',
                Width: 3200, Height: 850, Depth: 600, Material_Cost: 740, Notes: '',
                materials: [
                    material('m-11', 'p-kuhinja', 'Radna ploča kompakt', 'Egger', { Status: 'Naručeno', Ordered_Quantity: 3, Order_ID: 'o-2', Quantity: 3, Unit_Price: 210, Is_Essential: true }),
                    material('m-12', 'p-kuhinja', 'Vodilice pune izvlake', 'Blum', { Status: 'Nije naručeno', Quantity: 10, Unit: 'kom', Unit_Price: 18 }),
                ],
            },
        ],
    },
    {
        Project_ID: 'pr-jerko', Organization_ID: 'demo', Name: 'Jerko Čorluka — Kuća', Client_Name: 'Jerko Čorluka',
        Status: 'Odobreno', Created_Date: d(-12), Deadline: d(45), Address: 'Mostar',
        products: [
            {
                Product_ID: 'p-obloga', Organization_ID: 'demo', Project_ID: 'pr-jerko',
                Name: 'DO1 — Drvena obloga zida', Quantity: 1, Status: 'Na čekanju',
                Width: 4200, Height: 2600, Depth: 30, Material_Cost: 1250, Notes: '',
                Questions: [
                    { id: 'q-5', Text: 'Poslati uzorak boje prije naručivanja', Audience: 'supplier', Resolved: false, Created_At: d(-1) },
                ],
                materials: [
                    material('m-13', 'p-obloga', 'Orah furnir 0.6mm', 'Drvoprodex', { Status: 'Nije naručeno', Quantity: 12, Unit_Price: 64, Is_Essential: true }),
                    material('m-14', 'p-obloga', 'Ljepilo za furnir', 'Kleiberit', { Status: 'Na stanju', On_Stock: 20, Quantity: 4, Unit: 'kg', Unit_Price: 12 }),
                ],
            },
        ],
    },
] as unknown as Project[];

/**
 * Stvarni projekti umiju imati 70+ pozicija. Maketa to mora pokazati, inače
 * se raspored provjerava samo na idealno kratkim listama, a „zid teksta" se
 * onda vidi tek kod korisnika.
 */
const bulkProducts = Array.from({ length: 26 }, (_, i) => ({
    Product_ID: 'p-bulk-' + i, Organization_ID: 'demo', Project_ID: 'pr-jerko',
    Name: 'T' + (Math.floor(i / 4) + 1) + '.' + 'ABCD'[i % 4] + ' Ormar i elementi u gospodarstvu',
    Quantity: 1, Status: i % 3 === 0 ? 'Spremno' : 'U pripremi',
    Width: 1000 + i * 10, Height: 2600, Depth: 600, Material_Cost: 120, Notes: '',
    materials: [
        material('bm-' + i + '-1', 'p-bulk-' + i, 'MDF 18', 'Frischeis', { Quantity: 2.5, Unit: 'Kom', Status: 'Nije naručeno', Is_Essential: true }),
        material('bm-' + i + '-2', 'p-bulk-' + i, 'Vodilice Blum 500', 'Schachermayer', { Quantity: 3, Unit: 'Kom', Status: 'Primljeno', Received_Quantity: 7 }),
    ],
}));

demoProjects[2].products = [
    ...(demoProjects[2].products || []),
    ...(bulkProducts as unknown as NonNullable<Project['products']>),
];

export const demoWorkOrders: WorkOrder[] = [
    {
        Work_Order_ID: 'wo-124', Organization_ID: 'demo', Work_Order_Number: '124', Name: 'Klupe — korpus i tapaciranje',
        Created_Date: d(-14), Due_Date: d(-3), Status: 'U toku', Production_Steps: [], Notes: '',
        Planned_Start_Date: d(-10), Planned_End_Date: d(-3),
        items: [
            { ID: 'i-1', Work_Order_ID: 'wo-124', Product_ID: 'p-klupe', Product_Name: 'Storage Benches', Project_ID: 'pr-aamanns', Project_Name: 'Aamanns 1921', Quantity: 4, Item_Type: 'product', Status: 'U toku', Is_Paused: false },
            { ID: 'i-2', Work_Order_ID: 'wo-124', Product_ID: 'p-lbench', Product_Name: 'L-Shaped Bench', Project_ID: 'pr-aamanns', Project_Name: 'Aamanns 1921', Quantity: 2, Item_Type: 'product', Status: 'Završeno', Is_Paused: false },
        ],
    },
    {
        Work_Order_ID: 'wo-125', Organization_ID: 'demo', Work_Order_Number: '125', Name: 'Vrata i kuhinja — Melihin stan',
        Created_Date: d(-8), Due_Date: d(11), Status: 'U toku', Production_Steps: [], Notes: '',
        Planned_Start_Date: d(-1), Planned_End_Date: d(6),
        items: [
            { ID: 'i-3', Work_Order_ID: 'wo-125', Product_ID: 'p-vrata', Product_Name: 'Poz 7 — Vrata', Project_ID: 'pr-melihin', Project_Name: 'Melihin stan', Quantity: 3, Item_Type: 'product', Status: 'U toku', Is_Paused: true },
            { ID: 'i-4', Work_Order_ID: 'wo-125', Product_ID: 'p-kuhinja', Product_Name: 'Kuhinjski elementi', Project_ID: 'pr-melihin', Project_Name: 'Melihin stan', Quantity: 5, Item_Type: 'product', Status: 'Na čekanju', Is_Paused: true },
        ],
    },
    {
        Work_Order_ID: 'wo-126', Organization_ID: 'demo', Work_Order_Number: '126', Name: 'Stolovi — priprema',
        Created_Date: d(-2), Due_Date: d(16), Status: 'Na čekanju', Production_Steps: [], Notes: '',
        Planned_Start_Date: d(9), Planned_End_Date: d(21),
        items: [
            { ID: 'i-5', Work_Order_ID: 'wo-126', Product_ID: 'p-stol', Product_Name: 'Tables', Project_ID: 'pr-aamanns', Project_Name: 'Aamanns 1921', Quantity: 6, Item_Type: 'product', Status: 'Na čekanju' },
        ],
    },
    {
        Work_Order_ID: 'wo-127', Organization_ID: 'demo', Work_Order_Number: '127', Name: 'Montaža obloge',
        Created_Date: d(-1), Due_Date: '', Status: 'Na čekanju', Production_Steps: [], Notes: '',
        items: [
            { ID: 'i-6', Work_Order_ID: 'wo-127', Product_ID: 'p-obloga', Product_Name: 'DO1 obloga', Project_ID: 'pr-jerko', Project_Name: 'Jerko Čorluka', Quantity: 1, Item_Type: 'product', Status: 'Na čekanju' },
        ],
    },
    {
        Work_Order_ID: 'wo-120', Organization_ID: 'demo', Work_Order_Number: '120', Name: 'Uzorci i mjerenje',
        Created_Date: d(-30), Due_Date: d(-20), Status: 'Završeno', Production_Steps: [], Notes: '',
        Planned_Start_Date: d(-28), Planned_End_Date: d(-20),
        items: [
            { ID: 'i-7', Work_Order_ID: 'wo-120', Product_ID: 'p-klupe', Product_Name: 'Storage Benches', Project_ID: 'pr-aamanns', Project_Name: 'Aamanns 1921', Quantity: 4, Item_Type: 'product', Status: 'Završeno' },
        ],
    },
] as unknown as WorkOrder[];

export const demoOrders: Order[] = [
    {
        Order_ID: 'o-1', Organization_ID: 'demo', Order_Number: '2026-041', Supplier_ID: 's-1', Supplier_Name: 'Frischeis',
        Order_Date: d(-9), Status: 'Poslano', Expected_Delivery: d(-1), Total_Amount: 1240, Notes: '',
        items: [
            { ID: 'oi-1', Order_ID: 'o-1', Product_Material_ID: 'm-2', Product_ID: 'p-klupe', Product_Name: 'Storage Benches', Project_ID: 'pr-aamanns', Material_Name: 'Kant traka ABS', Quantity: 6, Unit: 'm', Expected_Price: 90, Received_Quantity: 0, Status: 'Naručeno' },
            { ID: 'oi-2', Order_ID: 'o-1', Product_Material_ID: 'm-5', Product_ID: 'p-lbench', Product_Name: 'L-Shaped Bench', Project_ID: 'pr-aamanns', Material_Name: 'Hrastova ploča', Quantity: 4, Unit: 'm²', Expected_Price: 384, Received_Quantity: 0, Status: 'Naručeno' },
        ],
    },
    {
        Order_ID: 'o-2', Organization_ID: 'demo', Order_Number: '2026-042', Supplier_ID: 's-2', Supplier_Name: 'Egger',
        Order_Date: d(-2), Status: 'Poslano', Expected_Delivery: d(5), Total_Amount: 630, Notes: '',
        items: [
            { ID: 'oi-3', Order_ID: 'o-2', Product_Material_ID: 'm-11', Product_ID: 'p-kuhinja', Product_Name: 'Kuhinjski elementi', Project_ID: 'pr-melihin', Material_Name: 'Radna ploča', Quantity: 3, Unit: 'm', Expected_Price: 630, Received_Quantity: 0, Status: 'Naručeno' },
        ],
    },
] as unknown as Order[];

export const demoTasks: Task[] = [
    {
        Task_ID: 't-1', Organization_ID: 'demo', Title: 'Zvati Igora za tkaninu', Description: 'Treba potvrda prije nego naručimo tapaciranje. Poslati 3 uzorka.',
        Status: 'pending', Priority: 'urgent', Category: 'general', Created_Date: d(-5), Due_Date: d(-1),
        Links: [{ Entity_Type: 'product', Entity_ID: 'p-klupe', Entity_Name: 'Storage Benches' }],
        Assigned_Worker_Name: 'Adnan',
        Checklist: [
            { id: 'c-1', text: 'Poslati uzorke', completed: true },
            { id: 'c-2', text: 'Zakazati poziv', completed: false },
            { id: 'c-3', text: 'Potvrditi količinu', completed: false },
        ],
    },
    {
        Task_ID: 't-2', Organization_ID: 'demo', Title: 'Naručiti šarke Blum', Description: '',
        Status: 'pending', Priority: 'high', Category: 'ordering', Created_Date: d(-3), Due_Date: d(2),
        Links: [{ Entity_Type: 'product', Entity_ID: 'p-klupe', Entity_Name: 'Storage Benches' }],
    },
    {
        Task_ID: 't-3', Organization_ID: 'demo', Title: 'Izmjeriti otvore na licu mjesta', Description: 'Ponijeti lasersku mjeru i fotografisati sve otvore.',
        Status: 'in_progress', Priority: 'medium', Category: 'installation', Created_Date: d(-4), Due_Date: d(4),
        Links: [{ Entity_Type: 'project', Entity_ID: 'pr-melihin', Entity_Name: 'Melihin stan' }],
        Assigned_Worker_Name: 'Samir',
    },
    {
        Task_ID: 't-4', Organization_ID: 'demo', Title: 'Poslati ponudu za obloge', Description: '',
        Status: 'pending', Priority: 'low', Category: 'general', Created_Date: d(-1),
        Links: [{ Entity_Type: 'project', Entity_ID: 'pr-jerko', Entity_Name: 'Jerko Čorluka' }],
    },
    {
        Task_ID: 't-5', Organization_ID: 'demo', Title: 'Provjeriti prispjeće radne ploče', Description: '',
        Status: 'pending', Priority: 'medium', Category: 'ordering', Created_Date: d(-2), Due_Date: d(5),
        Links: [{ Entity_Type: 'work_order', Entity_ID: 'wo-125', Entity_Name: 'Nalog 125' }],
    },
    {
        Task_ID: 't-6', Organization_ID: 'demo', Title: 'Dogovoriti transport za montažu', Description: '',
        Status: 'pending', Priority: 'high', Category: 'installation', Created_Date: d(-1), Due_Date: d(11),
        Links: [{ Entity_Type: 'product', Entity_ID: 'p-obloga', Entity_Name: 'DO1 obloga' }],
    },
    {
        Task_ID: 't-7', Organization_ID: 'demo', Title: 'Arhivirati nacrte 120', Description: '',
        Status: 'completed', Priority: 'low', Category: 'general', Created_Date: d(-20), Completed_Date: d(-18),
        Links: [{ Entity_Type: 'project', Entity_ID: 'pr-aamanns', Entity_Name: 'Aamanns 1921' }],
    },
] as unknown as Task[];

export const demoWorkers: Worker[] = [
    { Worker_ID: 'w-1', Organization_ID: 'demo', Name: 'Adnan Halilović' },
    { Worker_ID: 'w-2', Organization_ID: 'demo', Name: 'Samir Begić' },
    { Worker_ID: 'w-3', Organization_ID: 'demo', Name: 'Emir Kovač' },
] as unknown as Worker[];

export const demoPlanBlocks: PlanBlock[] = [
    { id: 'b-1', title: 'Lakiranje klupa', kind: 'order', startISO: d(1), endISO: d(4), productRefs: [{ id: 'p-klupe', name: 'Klupe', qty: 4 }] },
    { id: 'b-2', title: 'Isporuka furnira', kind: 'purchase', startISO: d(7), endISO: d(9), projectRef: { id: 'pr-jerko', name: 'Jerko Čorluka' } },
    { id: 'b-3', title: 'Montaža kuhinje', kind: 'montaza', startISO: d(12), endISO: d(15), productRefs: [{ id: 'p-kuhinja', name: 'Kuhinja', qty: 5 }] },
] as unknown as PlanBlock[];

/** Dva plana — stvarne firme ih imaju više, a tek tada se vidi izbor plana. */
export const demoPlanScenarios = [
    { id: 'sc-1', name: 'Septembar — radni plan', blocks: demoPlanBlocks },
    {
        id: 'sc-2',
        name: 'Plan 2 (varijanta)',
        blocks: [
            { id: 'b-4', title: 'Lakiranje klupa (kasnije)', kind: 'order', startISO: d(5), endISO: d(8), productRefs: [{ id: 'p-klupe', name: 'Klupe', qty: 4 }] },
            { id: 'b-5', title: 'Montaža kuhinje', kind: 'montaza', startISO: d(18), endISO: d(21), productRefs: [{ id: 'p-kuhinja', name: 'Kuhinja', qty: 5 }] },
        ] as unknown as PlanBlock[],
    },
];

export const demoBoardIds = ['pr-aamanns', 'pr-melihin', 'pr-jerko'];
