/**
 * Render-test kalendara radnika.
 *
 * Platno je iza prijave, pa se vizuelna provjera ne može odraditi u pregledniku
 * bez sesije. Ovo je zamjena koja hvata ono što bi se tamo vidjelo: da mreža ima
 * pravi broj ćelija, da sudar i odsustvo dobiju svoju oznaku, i da kretanje po
 * mjesecima mijenja sadržaj.
 */
import { render, screen, fireEvent, within } from '@testing-library/react';
import WorkerCalendar from '@/components/canvas/WorkerCalendar';
import { newBlock } from '@/lib/canvas/model';
import type { WorkerCalendarCtx } from '@/lib/canvas/workerCalendar';
import type { PlanBlock, Worker, WorkerAttendance } from '@/lib/types';

const TODAY = '2026-08-14';

const worker: Worker = {
    Worker_ID: 'w1', Name: 'Bego Saka', Role: 'Opći',
} as Worker;

const att = (date: string, status: WorkerAttendance['Status']): WorkerAttendance =>
    ({ Worker_ID: 'w1', Date: date, Status: status } as WorkerAttendance);

const order = (s: string, e: string, title: string, project?: string): PlanBlock =>
    newBlock('order', s, e, {
        title,
        workerRefs: [{ id: 'w1', name: 'Bego Saka' }],
        ...(project ? { projectRef: { id: project.toLowerCase(), name: project } } : {}),
    });

const ctx = (over: Partial<WorkerCalendarCtx> = {}): WorkerCalendarCtx => ({
    blocks: [], attendance: [], workOrders: [], ...over,
});

const setup = (c: WorkerCalendarCtx = ctx(), onSelect = jest.fn()) => {
    const onClose = jest.fn();
    const utils = render(
        <WorkerCalendar worker={worker} ctx={c} todayISO={TODAY}
            onClose={onClose} onSelectBlock={onSelect} />
    );
    return { ...utils, onClose, onSelect };
};

describe('kalendar radnika — prikaz', () => {
    test('otvara se na tekućem mjesecu i imenuje radnika', () => {
        setup();
        expect(screen.getByRole('dialog', { name: /Bego Saka/ })).toBeInTheDocument();
        expect(screen.getByText('avgust 2026')).toBeInTheDocument();
        expect(screen.getByText('Opći')).toBeInTheDocument();
    });

    test('mreža ima pune sedmice — broj ćelija je djeljiv sa 7', () => {
        const { container } = setup();
        const cells = container.querySelectorAll('.wc-cell');
        expect(cells.length % 7).toBe(0);
        expect(cells.length).toBeGreaterThanOrEqual(35);
    });

    test('današnji dan je istaknut', () => {
        const { container } = setup();
        expect(container.querySelectorAll('.wc-cell.today')).toHaveLength(1);
    });

    test('nalog se pojavi kao oznaka s nazivom projekta', () => {
        const { container } = setup(ctx({ blocks: [order('2026-08-17', '2026-08-19', 'Ploča šanka', 'Aamanns')] }));
        const chips = container.querySelectorAll('button.wc-chip.plan');
        expect(chips).toHaveLength(3);                       // 17, 18, 19
        expect(within(chips[0] as HTMLElement).getByText('Ploča šanka')).toBeInTheDocument();
        expect(within(chips[0] as HTMLElement).getByText('Aamanns')).toBeInTheDocument();
    });

    test('blok bez stvarnog naloga je nacrt', () => {
        const { container } = setup(ctx({ blocks: [order('2026-08-17', '2026-08-17', 'Nacrt')] }));
        expect(container.querySelector('button.wc-chip.plan.draft')).toBeInTheDocument();
    });

    test('pretvoren blok NIJE nacrt', () => {
        const b = order('2026-08-17', '2026-08-17', 'Stvarni');
        b.linkedWorkOrderId = 'wo-1';
        const { container } = setup(ctx({ blocks: [b] }));
        expect(container.querySelector('button.wc-chip.plan')).toBeInTheDocument();
        expect(container.querySelector('button.wc-chip.plan.draft')).not.toBeInTheDocument();
    });

    test('odsustvo se prikazuje imenom iz šihtarice', () => {
        setup(ctx({ attendance: [att('2026-08-18', 'Bolovanje')] }));
        expect(screen.getByText('Bolovanje')).toBeInTheDocument();
    });

    test('posao preko odsustva označi ćeliju kao sudar', () => {
        const { container } = setup(ctx({
            blocks: [order('2026-08-17', '2026-08-19', 'Posao')],
            attendance: [att('2026-08-18', 'Odmor')],
        }));
        expect(container.querySelectorAll('.wc-cell.clash')).toHaveLength(1);
    });

    test('dva posla u istom danu su sudar', () => {
        const { container } = setup(ctx({
            blocks: [order('2026-08-17', '2026-08-20', 'A'), order('2026-08-19', '2026-08-20', 'B')],
        }));
        expect(container.querySelectorAll('.wc-cell.clash')).toHaveLength(2);
    });

    test('prazan radni dan je označen kao slobodan', () => {
        const { container } = setup();
        // Cijeli avgust je prazan → svaki radni dan u mjesecu je slobodan
        expect(container.querySelectorAll('.wc-cell.free').length).toBeGreaterThan(20);
    });
});

describe('kalendar radnika — brojke', () => {
    test('postotak se odnosi na prikazani mjesec', () => {
        const { container } = setup(ctx({ blocks: [order('2026-08-17', '2026-08-22', 'Sedmica')] }));
        const stats = container.querySelectorAll('.wc-stat b');
        // 6 zauzetih od 26 radnih dana avgusta (nedjelje van)
        expect(stats[1].textContent).toBe('6/26');
        expect(stats[0].textContent).toBe('23%');
    });

    test('bez sudara stat pokazuje crticu, ne nulu', () => {
        const { container } = setup();
        const stats = container.querySelectorAll('.wc-stat b');
        expect(stats[2].textContent).toBe('—');
    });
});

describe('kalendar radnika — kretanje i radnje', () => {
    test('naredni/prethodni mjesec mijenjaju prikaz', () => {
        setup();
        fireEvent.click(screen.getByLabelText('Naredni mjesec'));
        expect(screen.getByText('septembar 2026')).toBeInTheDocument();
        fireEvent.click(screen.getByLabelText('Prethodni mjesec'));
        expect(screen.getByText('avgust 2026')).toBeInTheDocument();
    });

    test('„Danas" se nudi tek kad si otišao s tekućeg mjeseca', () => {
        setup();
        expect(screen.queryByRole('button', { name: 'Danas' })).not.toBeInTheDocument();
        fireEvent.click(screen.getByLabelText('Naredni mjesec'));
        fireEvent.click(screen.getByRole('button', { name: 'Danas' }));
        expect(screen.getByText('avgust 2026')).toBeInTheDocument();
    });

    test('klik na posao vraća njegov id pozivaocu', () => {
        const onSelect = jest.fn();
        const b = order('2026-08-17', '2026-08-17', 'Ploča');
        const { container } = setup(ctx({ blocks: [b] }), onSelect);
        fireEvent.click(container.querySelector('button.wc-chip.plan')!);
        expect(onSelect).toHaveBeenCalledWith(b.id);
    });

    test('Escape i dugme zatvaraju kalendar', () => {
        const { onClose } = setup();
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByLabelText('Zatvori kalendar'));
        expect(onClose).toHaveBeenCalledTimes(2);
    });
});
