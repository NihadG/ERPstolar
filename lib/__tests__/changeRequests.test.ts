// ════════════════════════════════════════════════════════════════════
// PRIJEDLOZI IZMJENA — sigurnost odobravanja
//
// Najvažnije: (1) kontrolor NE smije odobriti ništa što dira novac, (2) svaka
// vrsta je eksplicitno klasifikovana kao novčana ili ne — test pukne ako neko
// doda vrstu a ne klasifikuje je, (3) besmislen payload ne prolazi validaciju.
// ════════════════════════════════════════════════════════════════════

import { canApprove, isMoneyKind, needsDesktopApply, validateRequestPayload, summarizeRequest } from '@/lib/changeRequests';
import { CHANGE_REQUEST_KINDS, MONEY_KINDS, DESKTOP_APPLY_KINDS, type ChangeRequestKind, type UserRole } from '@/lib/types';

// Eksplicitna očekivana klasifikacija — DODAVANJE nove vrste bez upisa ovdje ruši test.
const EXPECTED_MONEY: Record<ChangeRequestKind, boolean> = {
    process_check: false,
    process_add: false,
    process_remove: false,
    order_start: false,
    order_pause: false,
    order_complete: true,
    item_complete: true,
    task_create: false,
    task_status: false,
    task_delete: false,
    material_usage: true,
    material_order: true,
};

describe('klasifikacija novca', () => {
    it('svaka vrsta iz CHANGE_REQUEST_KINDS je klasifikovana', () => {
        for (const kind of CHANGE_REQUEST_KINDS) {
            expect(EXPECTED_MONEY).toHaveProperty(kind);
            expect(isMoneyKind(kind)).toBe(EXPECTED_MONEY[kind]);
        }
    });

    it('MONEY_KINDS = tačno one vrste koje diraju novac', () => {
        const expected = (Object.keys(EXPECTED_MONEY) as ChangeRequestKind[]).filter(k => EXPECTED_MONEY[k]).sort();
        expect([...MONEY_KINDS].sort()).toEqual(expected);
    });

    it('EXPECTED_MONEY ne sadrži nepostojeće vrste', () => {
        for (const k of Object.keys(EXPECTED_MONEY)) {
            expect(CHANGE_REQUEST_KINDS).toContain(k);
        }
    });

    it('samo materijalne vrste traže desktop primjenu (i sve su novčane)', () => {
        expect([...DESKTOP_APPLY_KINDS].sort()).toEqual(['material_order', 'material_usage']);
        for (const kind of CHANGE_REQUEST_KINDS) {
            if (needsDesktopApply(kind)) expect(isMoneyKind(kind)).toBe(true);   // desktop ⊆ money
        }
        // Zatvaranje se finalizuje na serveru (kao kontrolorov completeItem).
        expect(needsDesktopApply('item_complete')).toBe(false);
        expect(needsDesktopApply('order_complete')).toBe(false);
    });
});

describe('canApprove — podjela po ulozi', () => {
    const roles: UserRole[] = ['owner', 'admin', 'manager', 'controller', 'worker'];

    it('radnik ne smije odobriti ništa', () => {
        for (const kind of CHANGE_REQUEST_KINDS) {
            expect(canApprove('worker', kind)).toBe(false);
        }
    });

    it('kontrolor odobrava samo nenovčano', () => {
        for (const kind of CHANGE_REQUEST_KINDS) {
            expect(canApprove('controller', kind)).toBe(!isMoneyKind(kind));
        }
    });

    it('owner/admin/manager odobravaju sve', () => {
        for (const role of ['owner', 'admin', 'manager'] as UserRole[]) {
            for (const kind of CHANGE_REQUEST_KINDS) {
                expect(canApprove(role, kind)).toBe(true);
            }
        }
    });

    it('kontrolor NE može zatvoriti proizvod/nalog ni ugraditi materijal', () => {
        expect(canApprove('controller', 'item_complete')).toBe(false);
        expect(canApprove('controller', 'order_complete')).toBe(false);
        expect(canApprove('controller', 'material_usage')).toBe(false);
        expect(canApprove('controller', 'material_order')).toBe(false);
    });

    it('sve uloge su pokrivene (nema tihog true)', () => {
        for (const role of roles) {
            expect(typeof canApprove(role, 'order_start')).toBe('boolean');
        }
    });
});

describe('validateRequestPayload', () => {
    it('process_check complete traži datum i radnika', () => {
        const noWorker = validateRequestPayload('process_check', { targets: [{ itemId: 'i', procName: 'Rezanje' }], action: 'complete', date: '2026-07-15', workerIds: [] });
        expect(noWorker.ok).toBe(false);
        const ok = validateRequestPayload('process_check', { targets: [{ itemId: 'i', procName: 'Rezanje' }], action: 'complete', date: '2026-07-15', workerIds: ['w1'] });
        expect(ok.ok).toBe(true);
    });

    it('process_check start ne traži radnika', () => {
        const r = validateRequestPayload('process_check', { targets: [{ itemId: 'i', procName: 'Rezanje' }], action: 'start' });
        expect(r.ok).toBe(true);
    });

    it('prazni targets padaju', () => {
        expect(validateRequestPayload('process_check', { targets: [], action: 'start' }).ok).toBe(false);
        expect(validateRequestPayload('process_remove', { targets: [] }).ok).toBe(false);
    });

    it('material_usage traži pozitivnu količinu', () => {
        expect(validateRequestPayload('material_usage', { productId: 'p', lines: [{ name: 'Iverica', quantity: 0, unit: 'ploča' }] }).ok).toBe(false);
        expect(validateRequestPayload('material_usage', { productId: 'p', lines: [{ name: 'Iverica', quantity: -2, unit: 'ploča' }] }).ok).toBe(false);
        const ok = validateRequestPayload('material_usage', { productId: 'p', lines: [{ name: 'Iverica', quantity: 3, unit: 'ploča' }] });
        expect(ok.ok).toBe(true);
    });

    it('material_order traži materialId (zna se šta se naručuje)', () => {
        expect(validateRequestPayload('material_order', { productId: 'p', lines: [{ name: 'X', quantity: 2, unit: 'kom' }] }).ok).toBe(false);
        expect(validateRequestPayload('material_order', { productId: 'p', lines: [{ materialId: 'm1', name: 'X', quantity: 2, unit: 'kom' }] }).ok).toBe(true);
    });

    it('item_complete traži itemId i datum', () => {
        expect(validateRequestPayload('item_complete', { itemId: 'i' }).ok).toBe(false);
        expect(validateRequestPayload('item_complete', { itemId: 'i', date: '2026-07-15' }).ok).toBe(true);
    });

    it('task_create traži naslov', () => {
        expect(validateRequestPayload('task_create', { title: '   ' }).ok).toBe(false);
        expect(validateRequestPayload('task_create', { title: 'Nabavi šarke' }).ok).toBe(true);
    });
});

describe('summarizeRequest', () => {
    it('daje čitljivu rečenicu za sve vrste', () => {
        for (const kind of CHANGE_REQUEST_KINDS) {
            const s = summarizeRequest(kind, { productName: 'Kuhinja', workOrderName: 'R1', procName: 'Rezanje', itemCount: 2, lineCount: 3 });
            expect(typeof s).toBe('string');
            expect(s.length).toBeGreaterThan(0);
        }
    });
});
