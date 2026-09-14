import { fireEvent, render, screen, within } from '@testing-library/react';
import CommandCenterScreen from '../command/CommandCenterScreen';
import type { Order, Project, Task, WorkOrder } from '@/lib/types';

jest.mock('@/lib/planning', () => ({ todayISO: () => '2026-09-12', workOrderDueDate: jest.fn(), buildSaturdayChecker: jest.fn(), daysUntil: jest.fn(), itemsWithoutPlannedDays: jest.fn() }));
jest.mock('@/lib/services/planning/scenarioService', () => ({ getScenarios: jest.fn().mockResolvedValue([]) }));
// Prošireni nalog je već pokriven vlastitim testovima i vuče cijeli servisni sloj.
jest.mock('../WorkOrderExpandedDetail', () => ({ __esModule: true, default: () => <div data-testid="wo-detail" /> }));
jest.mock('@/components/production/WorkOrderWizard', () => ({ __esModule: true, default: () => <div data-testid="wizard" /> }));
const ok = { success: true, message: 'ok' };
jest.mock('@/lib/services', () => ({
    updateTaskStatus: jest.fn().mockResolvedValue({ success: true, message: 'ok' }),
    toggleTaskChecklistItem: jest.fn().mockResolvedValue({ success: true, message: 'ok' }),
    updateProductNotes: jest.fn().mockResolvedValue({ success: true, message: 'ok' }),
    saveTask: jest.fn().mockResolvedValue({ success: true, message: 'ok' }),
    deleteTask: jest.fn().mockResolvedValue({ success: true, message: 'ok' }),
}));

const projects = [
    {
        Project_ID: 'p1', Name: 'Aamanns', Client_Name: 'Igor', Deadline: '2026-09-30',
        products: [
            {
                Product_ID: 'prod1', Name: 'Klupa', Quantity: 2,
                Questions: [{ id: 'q1', Text: 'Koja boja?', Audience: 'client', Resolved: false, Created_At: '' }],
                materials: [
                    { ID: 'm1', Material_Name: 'Iveral', Quantity: 3, Unit: 'm2', Unit_Price: 10, Status: 'Nije naručeno', Supplier: 'Alfa', Order_ID: '', Is_Essential: true },
                ],
            },
        ],
    },
    { Project_ID: 'p2', Name: 'Melihin stan', Client_Name: 'Meliha', products: [{ Product_ID: 'prod2', Name: 'Vrata', Quantity: 1, materials: [] }] },
] as unknown as Project[];

const workOrders = [
    { Work_Order_ID: 'wo1', Work_Order_Number: '124', Name: 'Kasni nalog', Status: 'U toku', Due_Date: '2026-09-01', items: [{ Product_ID: 'prod1', Project_ID: 'p1', Product_Name: 'Klupa', Status: 'U toku' }] },
    { Work_Order_ID: 'wo2', Work_Order_Number: '125', Name: 'Uredan nalog', Status: 'U toku', Due_Date: '2026-12-01', items: [{ Product_ID: 'prod2', Project_ID: 'p2', Product_Name: 'Vrata', Status: 'U toku' }] },
] as unknown as WorkOrder[];

const orders = [] as unknown as Order[];
const tasks = [
    { Task_ID: 't1', Title: 'Hitan zadatak', Status: 'pending', Priority: 'urgent', Due_Date: '2026-09-05', Links: [{ Entity_Type: 'product', Entity_ID: 'prod1', Entity_Name: 'Klupa' }] },
    { Task_ID: 't2', Title: 'Miran zadatak', Status: 'pending', Priority: 'low', Due_Date: '2026-11-01', Links: [{ Entity_Type: 'project', Entity_ID: 'p2', Entity_Name: 'Melihin stan' }] },
] as unknown as Task[];

const renderScreen = (over: Partial<React.ComponentProps<typeof CommandCenterScreen>> = {}) => {
    const onBoardChange = jest.fn();
    const utils = render(
        <CommandCenterScreen
            embedded
            projects={projects}
            workOrders={workOrders}
            orders={orders}
            tasks={tasks}
            workers={[]}
            organizationId="org"
            board={{ Project_IDs: ['p1', 'p2'], Show_Done: false }}
            onBoardChange={onBoardChange}
            canCreate
            onClose={jest.fn()}
            onRefresh={jest.fn()}
            showToast={jest.fn()}
            {...over}
        />,
    );
    return { ...utils, onBoardChange };
};

test('prazna tabla nudi dodavanje umjesto praznih kontejnera', () => {
    renderScreen({ board: { Project_IDs: [], Show_Done: false } });
    expect(screen.getByRole('heading', { name: 'Tabla je prazna' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Proizvodi')).not.toBeInTheDocument();
});

test('svi kontejneri stoje na jednoj strani, bez tabova', () => {
    renderScreen();
    for (const name of ['Kalendar projekata', 'Proizvodi', 'Radni nalozi', 'Zadaci', 'Napomene']) {
        expect(screen.getByRole('region', { name })).toBeInTheDocument();
    }
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
});

test('leća iz pulsa sužava SVE kontejnere na isto pitanje', () => {
    renderScreen();
    expect(within(screen.getByRole('region', { name: 'Radni nalozi' })).getByText('Uredan nalog')).toBeInTheDocument();
    const wall = () => screen.getByRole('region', { name: 'Zadaci' });
    expect(within(wall()).getByText('Miran zadatak')).toBeInTheDocument();

    fireEvent.click(within(screen.getByRole('group', { name: /Puls projekata/ })).getByRole('button', { name: /^Kasni/ }));

    expect(within(screen.getByRole('region', { name: 'Radni nalozi' })).queryByText('Uredan nalog')).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Radni nalozi' })).getByText('Kasni nalog')).toBeInTheDocument();
    expect(within(wall()).queryByText('Miran zadatak')).not.toBeInTheDocument();
    expect(within(wall()).getByText('Hitan zadatak')).toBeInTheDocument();
    // Napomene nemaju veze s kašnjenjem — pod ovom lećom ih nema.
    expect(within(screen.getByRole('region', { name: 'Napomene' })).queryByText('Koja boja?')).not.toBeInTheDocument();
});

test('odabir proizvoda nudi nalog i narudžbu, po projektu odabira', () => {
    renderScreen();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Označi proizvod Klupa' }));
    expect(screen.getByText(/Označeno:/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Napravi nalog/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Očisti' }));
    expect(screen.queryByText(/Označeno:/)).not.toBeInTheDocument();
});

test('materijal se bira tek kad se proizvod proširi, i samo ako ima šta naručiti', () => {
    renderScreen();
    fireEvent.click(screen.getAllByRole('button', { name: 'Prikaži materijale' })[0]);
    const check = screen.getByRole('checkbox', { name: 'Naruči Iveral' });
    expect(check).toBeEnabled();
    fireEvent.click(check);
    expect(screen.getByRole('button', { name: /Naruči materijale \(1\)/ })).toBeInTheDocument();
});

test('uklanjanje projekta skida ga s table, ne briše projekat', () => {
    const { onBoardChange } = renderScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Ukloni s table: Aamanns' }));
    expect(onBoardChange).toHaveBeenCalledWith({ Project_IDs: ['p2'], Show_Done: false });
});

test('komandni centar je operativan, ne finansijski — nigdje novca', () => {
    renderScreen();
    expect(screen.queryByText(/profit|marža|klijent plaća|KM/i)).not.toBeInTheDocument();
});

test('duga lista se ne izlije u zid teksta — grupa pokaže dio pa „Prikaži još"', () => {
    const many = [{
        ...projects[0],
        products: Array.from({ length: 20 }, (_, i) => ({
            Product_ID: 'bulk' + i, Name: 'Pozicija ' + i, Quantity: 1, materials: [],
        })),
    }] as unknown as Project[];
    renderScreen({ projects: many, board: { Project_IDs: ['p1'], Show_Done: false } });

    const panel = screen.getByRole('region', { name: 'Proizvodi' });
    expect(within(panel).getAllByRole('checkbox').length).toBe(12);
    fireEvent.click(within(panel).getByRole('button', { name: /Prikaži još 8/ }));
    expect(within(panel).getAllByRole('checkbox').length).toBe(20);
});

test('grupa projekta se može sklopiti da duga lista ne guši ostatak strane', () => {
    renderScreen();
    const panel = screen.getByRole('region', { name: 'Proizvodi' });
    const toggle = within(panel).getByRole('button', { name: /Aamanns/ });
    expect(within(panel).getAllByRole('checkbox').length).toBeGreaterThan(0);
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

// Upis u bazu je spor (reload cijelog grafa projekata traje sekunde). Ekran zato
// mora pokazati ishod ODMAH; ovi testovi čuvaju to ponašanje od regresije.

test('kvačica na zadatku se vidi odmah, bez ponovnog učitavanja baze', () => {
    const onRefresh = jest.fn();
    renderScreen({ onRefresh });
    const wall = () => screen.getByRole('region', { name: 'Zadaci' });

    expect(within(wall()).getByText('Hitan zadatak')).toBeInTheDocument();

    fireEvent.click(within(wall()).getByRole('button', { name: 'Završi zadatak: Hitan zadatak' }));

    // Bez ijednog await — završen zadatak je već ispao iz liste otvorenih.
    expect(within(wall()).queryByText('Hitan zadatak')).not.toBeInTheDocument();
    expect(onRefresh).not.toHaveBeenCalled();
});

test('riješena napomena odmah nestaje iz liste otvorenih', () => {
    const onRefresh = jest.fn();
    renderScreen({ onRefresh });
    const notes = () => screen.getByRole('region', { name: 'Napomene' });
    expect(within(notes()).getByText('Koja boja?')).toBeInTheDocument();

    fireEvent.click(within(notes()).getByRole('button', { name: 'Označi kao riješeno: Koja boja?' }));

    expect(within(notes()).queryByText('Koja boja?')).not.toBeInTheDocument();
    expect(onRefresh).not.toHaveBeenCalled();
});

test('napomene se mogu pretražiti, grupisati i sortirati', () => {
    renderScreen();
    const notes = () => screen.getByRole('region', { name: 'Napomene' });

    // Dugme za novu napomenu stoji u zaglavlju, ne na dnu liste.
    expect(within(notes()).getByRole('button', { name: /Nova/ })).toBeInTheDocument();

    fireEvent.click(within(notes()).getByRole('button', { name: 'Pozicija' }));
    expect(within(notes()).getAllByText('Klupa').length).toBeGreaterThan(0);

    fireEvent.change(within(notes()).getByLabelText('Pretraži napomene'), { target: { value: 'nepostojece' } });
    expect(within(notes()).getByText('Ništa ne odgovara pretrazi.')).toBeInTheDocument();

    expect(within(notes()).getByLabelText('Sortiranje napomena')).toBeInTheDocument();
});

// ── Kalendar ────────────────────────────────────────────────────────
// Agenda je zadani prikaz jer odgovara na pitanje koje se postavlja svaki
// dan („šta me čeka, šta kasni"); Gantt odgovara na drugo pitanje.

const calendar = () => screen.getByRole('region', { name: 'Kalendar projekata' });

test('kalendar se otvara na agendi, s kašnjenjem na vrhu', () => {
    renderScreen();
    const cal = calendar();
    expect(within(cal).getByRole('button', { name: /Agenda/ })).toHaveAttribute('aria-pressed', 'true');

    const buckets = within(cal).getAllByRole('region');
    expect(buckets[0]).toHaveAccessibleName('Kasni');
    // Nalog s rokom 1.9. i zadatak s rokom 5.9. — oba prije 12.9.
    expect(within(buckets[0]).getByText('Kasni nalog')).toBeInTheDocument();
    expect(within(buckets[0]).getByText('Hitan zadatak')).toBeInTheDocument();
});

test('agenda razvrstava po hitnosti, a ne po abecedi', () => {
    renderScreen();
    const cal = calendar();
    const labels = within(cal).getAllByRole('region').map(r => r.getAttribute('aria-label'));
    // Rok projekta je 30.9. (sljedeći mjesec), uredan nalog 1.12.
    expect(labels).toEqual(['Kasni', 'Kasnije']);

    const later = within(cal).getByRole('region', { name: 'Kasnije' });
    expect(within(later).getByText('Uredan nalog')).toBeInTheDocument();
    expect(within(later).getByText('Rok projekta')).toBeInTheDocument();
});

test('prelazak na traku nudi razlaganje redova, agenda ga ne nudi', () => {
    renderScreen();
    const cal = calendar();
    expect(within(cal).queryByLabelText('Razlaganje redova')).not.toBeInTheDocument();

    fireEvent.click(within(cal).getByRole('button', { name: 'Traka' }));
    expect(within(cal).getByLabelText('Razlaganje redova')).toHaveValue('compact');
    expect(within(cal).getByRole('group', { name: 'Raspon' })).toBeInTheDocument();
});

test('klik na stavku u agendi otvara detalje s radnjom nad njom', () => {
    renderScreen();
    const cal = calendar();
    fireEvent.click(within(cal).getByText('Kasni nalog'));
    expect(within(cal).getByRole('button', { name: 'Otvori nalog' })).toBeInTheDocument();
});
