'use client';

// ════════════════════════════════════════════════════════════════════
// /booking-preview — MAKETA upita „Knjiženje dnevnica"
//
// Šihtarica je iza prijave, pa se modal ne može vidjeti bez naloga. Ova
// ruta renderuje PRAVI AttendanceBookingConfirmModal nad izmišljenim, ali
// realnim danom: prisutni i teren, dodijeljeni / pauzirani / nepokrenuti /
// završeni nalozi, montaža i „Razni poslovi", ½ dana, „kao jučer".
// Prijedlog se gradi PRAVOM logikom (buildBookingProposal), ne ručno.
//
// U produkciji ruta ne postoji.
// ════════════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import { notFound } from 'next/navigation';
import AttendanceBookingConfirmModal, { type BookingDecision } from '@/components/ui/AttendanceBookingConfirmModal';
import { buildBookingProposal } from '@/lib/attendanceBooking';
import { todayISO } from '@/lib/planning';
import { shiftDate } from '@/lib/projectCommand';
import { demoProjects } from '@/lib/command/demoData';
import type { WorkOrder, Worker } from '@/lib/types';

export const dynamic = 'force-dynamic';

const W = (id: string, name: string): Worker => ({ Worker_ID: id, Organization_ID: 'demo', Name: name, Worker_Type: 'Glavni', Daily_Rate: 80 } as unknown as Worker);

const workers: Worker[] = [
    W('w-1', 'Adnan Halilović'),
    W('w-2', 'Samir Begić'),
    W('w-3', 'Emir Kovač'),
    W('w-4', 'Mirza Delić'),
    W('w-5', 'Haris Mujić'),
    W('w-6', 'Dino Ramić'),
    W('w-7', 'Kenan Softić'),
];

const crew = (...ids: string[]) => ids.map(id => {
    const w = workers.find(x => x.Worker_ID === id)!;
    return { Worker_ID: id, Worker_Name: w.Name, Daily_Rate: 80 };
});

let seq = 0;
const item = (productName: string, status: string, assigned: string[], paused = false) => ({
    ID: `it-${++seq}`, Product_ID: `p-${seq}`, Product_Name: productName, Project_ID: 'pr', Project_Name: 'Projekat',
    Quantity: 1, Status: status, Is_Paused: paused, Assigned_Workers: crew(...assigned),
});

const O = (id: string, num: string, name: string, status: string, type: string, items: ReturnType<typeof item>[]): WorkOrder => ({
    Work_Order_ID: id, Organization_ID: 'demo', Work_Order_Number: num, Name: name, Status: status,
    Work_Order_Type: type, Created_Date: todayISO(), Due_Date: '', Production_Steps: [], Notes: '',
    Started_At: status === 'U toku' ? todayISO() : undefined, items,
} as unknown as WorkOrder);

const workOrders: WorkOrder[] = [
    O('wo-1', '124', 'Kuhinja — Dino, Kuća', 'U toku', 'Proizvodnja', [
        item('Donji elementi', 'U toku', ['w-1', 'w-2']), item('Gornji elementi', 'U toku', ['w-1']), item('Radna ploča', 'Na čekanju', []),
    ]),
    O('wo-2', '125', 'Vrata soba — Melihin stan', 'U toku', 'Proizvodnja', [
        item('Poz 7 — Vrata soba desno', 'U toku', ['w-3'], true), item('Poz 8 — Vrata kupatila', 'U toku', ['w-3'], true),
    ]),
    O('wo-3', '126', 'Stolovi — Aamanns 1921', 'Na čekanju', 'Proizvodnja', [
        item('Tables (Pravougaoni stolovi)', 'Na čekanju', ['w-4']),
    ]),
    O('wo-4', '127', 'Klupe sa spremištem', 'U toku', 'Proizvodnja', [
        item('Storage Benches', 'U toku', ['w-5']), item('L-Shaped Bench', 'U toku', []),
    ]),
    O('wo-5', '128', 'Ormari hodnik — Jerko Čorluka', 'U toku', 'Proizvodnja', [
        item('T1.A Ormar', 'U toku', []), item('T1.B Ormar', 'U toku', []), item('T2.A Ormar', 'U toku', []), item('T2.B Ormar', 'U toku', []),
    ]),
    O('wo-6', 'M-12', 'Montaža kuhinje — Dino', 'U toku', 'Montaža', [
        item('Donji elementi', 'U toku', ['w-6', 'w-7']), item('Gornji elementi', 'U toku', ['w-6']),
    ]),
    O('wo-7', 'R-31', 'Čišćenje i održavanje pogona', 'U toku', 'Zadaci', [
        item('Čišćenje mašina', 'U toku', []),
    ]),
    O('wo-8', '120', 'Uzorci i mjerenje', 'Završeno', 'Proizvodnja', [
        item('Uzorak fronte', 'Završeno', ['w-6']),
    ]),
    O('wo-9', 'M-11', 'Montaža obloge — Mostar', 'Završeno', 'Montaža', [
        item('DO1 — Drvena obloga zida', 'Završeno', ['w-7']),
    ]),
    O('wo-10', '129', 'Kupatilski element — Hadžić', 'Na čekanju', 'Proizvodnja', [
        item('Element ispod umivaonika', 'Na čekanju', []),
    ]),
];

export default function BookingPreviewPage() {
    const [open, setOpen] = useState(true);
    const [log, setLog] = useState('');
    const [toast, setToast] = useState('');
    const date = todayISO();

    const rows = useMemo(() => buildBookingProposal(
        [
            { workerId: 'w-1', workerName: 'Adnan Halilović', status: 'Prisutan' },
            { workerId: 'w-2', workerName: 'Samir Begić', status: 'Prisutan' },
            { workerId: 'w-3', workerName: 'Emir Kovač', status: 'Prisutan' },
            { workerId: 'w-4', workerName: 'Mirza Delić', status: 'Prisutan' },
            { workerId: 'w-5', workerName: 'Haris Mujić', status: 'Prisutan' },
            { workerId: 'w-6', workerName: 'Dino Ramić', status: 'Teren' },
            { workerId: 'w-7', workerName: 'Kenan Softić', status: 'Teren' },
        ],
        workOrders,
        date,
    ), [date]);

    const yesterday = useMemo(() => new Map<string, string[]>([
        ['w-1', ['wo-1']],
        ['w-3', ['wo-2', 'wo-5']],
        ['w-6', ['wo-6']],
    ]), []);

    if (process.env.NODE_ENV === 'production') notFound();

    return (
        <div style={{ padding: 24, fontFamily: 'system-ui' }}>
            <button onClick={() => setOpen(true)} style={{ padding: '8px 14px' }}>Otvori knjiženje</button>
            {log && <pre style={{ marginTop: 16, fontSize: 12, whiteSpace: 'pre-wrap' }}>{log}</pre>}
            {toast && (
                <div style={{
                    position: 'fixed', bottom: 18, left: '50%', transform: 'translateX(-50%)', zIndex: 5000,
                    background: '#1d1d1f', color: '#fff', padding: '9px 16px', borderRadius: 10, fontSize: 13,
                }}>{toast}</div>
            )}
            {open && (
                <AttendanceBookingConfirmModal
                    isOpen={open}
                    onClose={() => setOpen(false)}
                    date={date}
                    rows={rows}
                    workOrders={workOrders}
                    workers={workers}
                    projects={demoProjects}
                    organizationId="demo"
                    yesterdayByWorker={yesterday}
                    yesterdaySourceDate={shiftDate(date, -1)}
                    onConfirm={async (d: BookingDecision[]) => {
                        setLog(d.map(x => `${x.workerName} (${x.presence}) → ${x.orderIds.join(', ') || '—'}`).join('\n'));
                    }}
                    onCreated={() => { /* maketa nema šta osvježiti */ }}
                    showToast={message => { setToast(message); setTimeout(() => setToast(''), 2400); }}
                />
            )}
        </div>
    );
}
