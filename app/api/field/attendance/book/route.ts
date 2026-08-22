// ════════════════════════════════════════════════════════════════════
// POTVRDA KNJIŽENJA — „Potvrdi i proknjiži"
//
// Odgovor NIKAD ne nosi iznose. Kontrolor vidi koliko je dnevnica proknjiženo
// i ko nije prošao — ne koliko to košta.
//
// Idempotentno: ponovljen zahtjev (slaba mreža, dupli dodir) ne pravi drugu
// dnevnicu jer `bookWorkerDayItems` preskače (radnik, proizvod) parove koji
// za taj dan već imaju zapis.
// ════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { errorResponse, HttpError, requireController } from '@/lib/server/requireUser';
import { getActiveWorkers } from '@/lib/server/fieldRepo';
import { commitBooking, type BookingDecisionInput } from '@/lib/server/fieldAttendance';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const isISODate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

export async function POST(req: Request) {
    try {
        const caller = await requireController(req);
        const body = await req.json().catch(() => ({}));

        const date = String(body.date || '');
        if (!isISODate(date)) throw new HttpError(400, 'Neispravan datum.');
        if (date > new Date().toISOString().split('T')[0]) {
            throw new HttpError(400, 'Ne može se knjižiti unaprijed.');
        }

        const raw = Array.isArray(body.decisions) ? body.decisions : [];
        if (raw.length === 0) throw new HttpError(400, 'Nema šta da se knjiži.');

        // Imena radnika dolaze iz baze — zahtjev nosi samo ID-eve i odluke.
        const workers = await getActiveWorkers(caller.orgId);
        const byId = new Map(workers.map(w => [w.Worker_ID, w]));

        const decisions: BookingDecisionInput[] = [];
        for (const d of raw) {
            const workerId = String(d?.workerId || '');
            const worker = byId.get(workerId);
            if (!worker) continue;

            const orderIds: string[] = Array.isArray(d?.orderIds)
                ? d.orderIds.map((x: unknown) => String(x)).filter(Boolean)
                : [];
            if (orderIds.length === 0) continue;   // „ne knjiži" je legitiman izbor

            decisions.push({
                workerId,
                workerName: worker.Name,
                orderIds,
                presence: d?.presence === 0.5 ? 0.5 : 1,
            });
        }

        if (decisions.length === 0) {
            return NextResponse.json({
                booked: 0, failedWorkers: [], startWarnings: [],
                message: 'Nijedan nalog nije izabran — dnevnice nisu knjižene.',
            });
        }

        const result = await commitBooking(caller.orgId, date, decisions);

        // „Nula dnevnica" ima dva sasvim različita uzroka i korisnik mora znati
        // koji je njegov: dan je već proknjižen (ništa ne treba raditi) naspram
        // izabranog naloga koji nema nijednu stavku (treba mu se dodati posao).
        const nothingBooked = result.prepared > 0
            ? 'Taj dan je već proknjižen — nema novih dnevnica.'
            : 'Izabrani nalozi nemaju nijednu stavku na koju bi se dan knjižio.';

        const message = result.failedWorkers.length > 0
            ? `Greška pri knjiženju za: ${result.failedWorkers.join(', ')}${result.booked > 0 ? ` — ostalo (${result.booked}) proknjiženo` : ''}`
            : result.booked > 0
                ? `Proknjiženo ${result.booked} ${result.booked === 1 ? 'dnevnica' : 'dnevnica'}`
                : nothingBooked;

        return NextResponse.json({
            booked: result.booked,
            failedWorkers: result.failedWorkers,
            startWarnings: result.startWarnings,
            message,
        });
    } catch (e) {
        return errorResponse(e);
    }
}
