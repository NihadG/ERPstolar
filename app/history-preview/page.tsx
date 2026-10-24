'use client';

// ════════════════════════════════════════════════════════════════════
// /history-preview — PRAVA komponenta „Istorija rada" nad izmišljenim nalogom
//
// Detalj naloga je iza prijave, pa se tab ne može vidjeti bez naloga. Ovdje je
// nalog „Čorluka - Kuhinja" s dvije grane (iveral ∥ furnir na MDF-u): diktiran
// rad, pretpostavljeni koraci, automatska podjela iz prisustva, rad bez procesa
// i proizvod koji tek čeka. ?w=380 suzi okvir kao na telefonu.
//
// U produkciji ruta ne postoji.
// ════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import { notFound } from 'next/navigation';
import WorkHistory from '@/components/ui/WorkHistory';
import type { ItemProcessStatus, ProcessGraph, WorkLog, WorkOrderItem } from '@/lib/types';

export const dynamic = 'force-dynamic';

const P = (name: string, status: ItemProcessStatus['Status'], at?: string, assumed?: boolean): ItemProcessStatus => ({
    Process_Name: name, Status: status,
    ...(at ? { Started_At: `${at}T15:00:00.000Z` } : {}),
    ...(at && status === 'Završeno' ? { Completed_At: `${at}T15:00:00.000Z` } : {}),
    ...(assumed ? { Assumed_Done: true } : {}),
});

const items = [
    { ID: 'i1', Product_ID: 'p1', Product_Name: 'Donji elementi', Processes: [
        P('Krojenje Iverala', 'Završeno', '2026-10-14'), P('Kantiranje', 'Završeno', '2026-10-16'),
        P('Krojenje MDF-a', 'Završeno', '2026-10-20', true), P('Priprema furnira', 'Završeno', '2026-10-20', true),
        P('Furniranje', 'Završeno', '2026-10-20', true), P('Srezivanje', 'Završeno', '2026-10-21'),
        P('Brušenje', 'U toku', '2026-10-22'), P('Lakiranje', 'Na čekanju'), P('Sklapanje', 'Na čekanju'),
    ] },
    { ID: 'i2', Product_ID: 'p2', Product_Name: 'Gornji elementi', Processes: [
        P('Krojenje Iverala', 'Završeno', '2026-10-14'), P('Kantiranje', 'Završeno', '2026-10-16'),
        P('Krojenje MDF-a', 'Završeno', '2026-10-17'), P('Priprema furnira', 'Završeno', '2026-10-20', true),
        P('Furniranje', 'Završeno', '2026-10-20'), P('Srezivanje', 'U toku', '2026-10-21'),
        P('Brušenje', 'Na čekanju'), P('Lakiranje', 'Na čekanju'), P('Sklapanje', 'Na čekanju'),
    ] },
    { ID: 'i3', Product_ID: 'p3', Product_Name: 'Ostava visoka', Processes: [
        P('Krojenje Iverala', 'Završeno', '2026-10-15'), P('Kantiranje', 'U toku', '2026-10-16'), P('Sklapanje', 'Na čekanju'),
    ] },
] as unknown as WorkOrderItem[];

const node = (id: string, name: string, itemIds: string[]) => ({ id, name, itemIds });
const graph: ProcessGraph = {
    nodes: [
        node('ki', 'Krojenje Iverala', []), node('ka', 'Kantiranje', []),
        node('km', 'Krojenje MDF-a', ['i1', 'i2']), node('pf', 'Priprema furnira', ['i1', 'i2']), node('fu', 'Furniranje', ['i1', 'i2']),
        node('sr', 'Srezivanje', ['i1', 'i2']), node('br', 'Brušenje', ['i1', 'i2']), node('la', 'Lakiranje', ['i1', 'i2']),
        node('sk', 'Sklapanje', []),
    ],
    edges: [['ki', 'ka'], ['ka', 'sk'], ['km', 'pf'], ['pf', 'fu'], ['fu', 'sr'], ['sr', 'br'], ['br', 'la'], ['la', 'sk']]
        .map(([source, target]) => ({ id: `${source}-${target}`, source, target })),
};

let n = 0;
const L = (date: string, worker: string, itemIds: string[], process: string | undefined, part: number, source: 'telegram' | 'manual' | 'auto' = 'telegram'): WorkLog[] =>
    itemIds.map(itemId => ({
        WorkLog_ID: `l${++n}`, Organization_ID: 'demo', Date: date, Worker_ID: worker, Worker_Name: worker,
        Daily_Rate: 0, Hours_Worked: 8 * part / itemIds.length, Day_Fraction: part / itemIds.length,
        Work_Order_ID: 'wo', Work_Order_Item_ID: itemId, Product_ID: itemId.replace('i', 'p'),
        Process_Name: process, Booking_Source: source === 'auto' ? 'attendance' : 'manual',
        Is_From_Attendance: source === 'auto', ...(source === 'telegram' ? { Entry_Source: 'telegram' } : {}),
    } as unknown as WorkLog));

const workLogs: WorkLog[] = [
    ...L('2026-10-14', 'Amer', ['i1', 'i2'], 'Krojenje Iverala', 1),
    ...L('2026-10-14', 'Kerim', ['i1', 'i2'], 'Krojenje Iverala', 1),
    ...L('2026-10-15', 'Amer', ['i3'], 'Krojenje Iverala', 0.5),
    ...L('2026-10-15', 'Edin', ['i1', 'i2', 'i3'], 'Krojenje furnira', 1, 'auto'),
    ...L('2026-10-16', 'Edin', ['i1', 'i2', 'i3'], 'Kantiranje', 1),
    ...L('2026-10-17', 'Kerim', ['i2'], 'Krojenje MDF-a', 1, 'manual'),
    ...L('2026-10-20', 'Imer', ['i2'], 'Furniranje', 1),
    ...L('2026-10-20', 'Senad', ['i1', 'i2'], undefined, 0.5, 'manual'),
    ...L('2026-10-21', 'Imer', ['i1', 'i2'], 'Srezivanje', 1),
    ...L('2026-10-22', 'Kerim', ['i1'], 'Brušenje', 1),
    ...L('2026-10-22', 'Amer', ['i1'], 'Brušenje', 0.5),
];

export default function HistoryPreviewPage() {
    if (process.env.NODE_ENV === 'production') notFound();
    const [width, setWidth] = useState<number | null>(null);
    useEffect(() => {
        const w = Number(new URLSearchParams(window.location.search).get('w'));
        if (w > 0) setWidth(w);
    }, []);

    return (
        <main style={{ minHeight: '100vh', background: 'var(--background)', padding: 24 }}>
            <div style={{ maxWidth: width || 920, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
                <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: 'var(--text-primary)' }}>Čorluka - Kuhinja · Istorija</h1>
                <WorkHistory items={items} graph={graph} workLogs={workLogs} />
            </div>
        </main>
    );
}
