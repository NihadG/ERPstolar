/**
 * Testovi za "nedostaje prisustvo" (P9 iz PDF-a): dan se prijavljuje SAMO kad je radnik
 * bio prisutan u šihtarici a nema dnevnicu ni na jednom nalogu. Rad na drugom nalogu i
 * odsustva NE smiju dizati lažni alarm.
 */

import { computeMissingAttendanceDays } from '../attendanceHistory';

const W = [{ id: 'esmir', name: 'Esmir' }, { id: 'kemal', name: 'Kemal' }];

describe('computeMissingAttendanceDays', () => {
    test('prisutan + knjižen (bilo gdje) → NEMA alarma (glavni bug iz PDF-a)', () => {
        const present = new Set(['esmir_2026-07-06', 'kemal_2026-07-06']);
        const booked = new Set(['esmir_2026-07-06', 'kemal_2026-07-06']);   // knjiženo (možda na drugom nalogu)
        const out = computeMissingAttendanceDays({
            startISO: '2026-07-06', endISO: '2026-07-06', workers: W,
            presentByWorkerDate: present, bookedByWorkerDate: booked,
        });
        expect(out).toHaveLength(0);
    });

    test('prisutan a NIGDJE nije knjižen → prijavljen (stvaran propust)', () => {
        const present = new Set(['esmir_2026-07-06']);
        const booked = new Set<string>();
        const out = computeMissingAttendanceDays({
            startISO: '2026-07-06', endISO: '2026-07-06', workers: W,
            presentByWorkerDate: present, bookedByWorkerDate: booked,
        });
        expect(out).toEqual([{ date: '2026-07-06', workerName: 'Esmir' }]);
    });

    test('nije u šihtarici (odsutan/odmor/nezabilježen) → NEMA alarma', () => {
        const out = computeMissingAttendanceDays({
            startISO: '2026-07-06', endISO: '2026-07-08', workers: W,
            presentByWorkerDate: new Set(),   // niko nije prisutan
            bookedByWorkerDate: new Set(),
        });
        expect(out).toHaveLength(0);
    });

    test('knjižen na DRUGOM nalogu → prisutan i booked → NEMA alarma za ovaj nalog', () => {
        // Esmir prisutan 6. i 7., knjižen oba dana (na bilo kojem nalogu) → čist
        const present = new Set(['esmir_2026-07-06', 'esmir_2026-07-07']);
        const booked = new Set(['esmir_2026-07-06', 'esmir_2026-07-07']);
        const out = computeMissingAttendanceDays({
            startISO: '2026-07-06', endISO: '2026-07-07', workers: [W[0]],
            presentByWorkerDate: present, bookedByWorkerDate: booked,
        });
        expect(out).toHaveLength(0);
    });

    test('miješano preko raspona: prijavljuje samo prisutne-a-neknjižene dane', () => {
        const present = new Set(['esmir_2026-07-06', 'esmir_2026-07-07', 'esmir_2026-07-08']);
        const booked = new Set(['esmir_2026-07-06', 'esmir_2026-07-08']);   // 7. fali
        const out = computeMissingAttendanceDays({
            startISO: '2026-07-06', endISO: '2026-07-08', workers: [W[0]],
            presentByWorkerDate: present, bookedByWorkerDate: booked,
        });
        expect(out).toEqual([{ date: '2026-07-07', workerName: 'Esmir' }]);
    });
});
