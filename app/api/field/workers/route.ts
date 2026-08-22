// ════════════════════════════════════════════════════════════════════
// RADNICI — samo imena, za izbor na telefonu
//
// Postoji zato što ekrani koji NISU šihtarica (otvaranje naloga, knjiga rada)
// također moraju ponuditi listu radnika, a šihtaričin GET uz radnike vuče i
// prisustvo i dnevnice cijele sedmice.
//
// Projekcija je ista kao u šihtarici (`FieldWorkerRow`) i iz istog razloga NE
// nosi `Daily_Rate` ni istoriju cijena.
// ════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { errorResponse, requireController } from '@/lib/server/requireUser';
import { getActiveWorkers } from '@/lib/server/fieldRepo';
import type { FieldWorkerRow } from '@/lib/field/fieldAttendance';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    try {
        const caller = await requireController(req);
        const workers: FieldWorkerRow[] = (await getActiveWorkers(caller.orgId)).map(w => ({
            workerId: w.Worker_ID,
            name: w.Name || '',
            role: w.Role || '',
            workerType: w.Worker_Type || 'Glavni',
        }));
        return NextResponse.json({ workers }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (e) {
        return errorResponse(e);
    }
}
