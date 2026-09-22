import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    createOrdersFromMaterialSelection: jest.fn().mockResolvedValue({ ordersCreated: 1, orderNumbers: ['2026-050'] }),
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

// Traka odabira lebdi na dnu EKRANA, ne na dnu ploče Proizvodi — do stare
// se moralo skrolati kroz cijelu listu.
const dock = () => screen.getByRole('region', { name: 'Označeno' });

test('odabir proizvoda otvara plutajuću traku s nalogom i narudžbom', () => {
    renderScreen();
    expect(screen.queryByRole('region', { name: 'Označeno' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Označi proizvod Klupa' }));
    expect(within(dock()).getByText(/Označeno:/)).toBeInTheDocument();
    expect(within(dock()).getByRole('button', { name: /Napravi nalog/ })).toBeInTheDocument();
    // Samo proizvod označen → nudi se sve što na njemu fali.
    expect(within(dock()).getByRole('button', { name: /Naruči što fali \(1\)/ })).toBeEnabled();
    // Traka nije dio ploče Proizvodi.
    expect(within(screen.getByRole('region', { name: 'Proizvodi' })).queryByText(/Označeno:/)).not.toBeInTheDocument();
    fireEvent.click(within(dock()).getByRole('button', { name: 'Očisti' }));
    expect(screen.queryByRole('region', { name: 'Označeno' })).not.toBeInTheDocument();
});

test('materijal se bira tek kad se proizvod proširi, i samo ako ima šta naručiti', () => {
    renderScreen();
    fireEvent.click(screen.getAllByRole('button', { name: 'Prikaži materijale' })[0]);
    const check = screen.getByRole('checkbox', { name: 'Naruči Iveral' });
    expect(check).toBeEnabled();
    fireEvent.click(check);
    expect(within(dock()).getByRole('button', { name: /Naruči označene \(1\)/ })).toBeInTheDocument();
});

test('narudžba dobija naziv iz projekta i pozicije — nikad „Komandni centar"', async () => {
    const { createOrdersFromMaterialSelection } = jest.requireMock('@/lib/services');
    renderScreen();
    fireEvent.click(screen.getAllByRole('button', { name: 'Prikaži materijale' })[0]);
    // „Naruči što fali" stoji uz tabelu materijala, ne na dnu ploče.
    fireEvent.click(within(screen.getByRole('region', { name: 'Proizvodi' })).getByRole('button', { name: /Naruči što fali \(1\)/ }));

    const name = await screen.findByLabelText('Naziv narudžbe');
    expect(name).toHaveValue('Aamanns — Klupa');
    fireEvent.change(name, { target: { value: 'Iveral za klupe' } });
    fireEvent.click(screen.getByRole('button', { name: /Kreiraj narudžbe/ }));

    await waitFor(() => expect(createOrdersFromMaterialSelection).toHaveBeenCalled());
    const [, , , orderName] = createOrdersFromMaterialSelection.mock.calls[0];
    expect(orderName).toBe('Iveral za klupe');
});

test('pozicija bez naloga ima dugme koje pravi nalog samo za nju', () => {
    renderScreen({ workOrders: [] });
    expect(screen.queryByTestId('wizard')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Napravi nalog: Klupa' }));
    expect(screen.getByTestId('wizard')).toBeInTheDocument();
});

test('nalog, narudžba i zadatak se prave iz zaglavlja, uz izbor projekta', () => {
    renderScreen();
    const create = screen.getByRole('group', { name: 'Novo' });
    fireEvent.click(within(create).getByRole('button', { name: 'Nova narudžba materijala' }));
    const menu = screen.getByRole('menu');
    // Projekat bez ičega za naručiti se ne nudi kao da ima.
    expect(within(menu).getByRole('menuitem', { name: /Melihin stan/ })).toBeDisabled();
    expect(within(menu).getByRole('menuitem', { name: /Aamanns/ })).toBeEnabled();
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Aamanns/ }));
    expect(screen.getByLabelText('Naziv narudžbe')).toHaveValue('Aamanns — Klupa');
});

// ── Raspored ────────────────────────────────────────────────────────

test('sklopljena ploča ostaje zaglavlje sa sažetkom i pamti se na tabli', () => {
    const { onBoardChange } = renderScreen();
    const tasksPanel = screen.getByRole('region', { name: 'Zadaci' });
    fireEvent.click(within(tasksPanel).getByRole('button', { name: 'Zadaci' }));
    expect(onBoardChange).toHaveBeenCalledWith({ Project_IDs: ['p1', 'p2'], Show_Done: false, Collapsed_Panels: ['tasks'] });
});

test('sklopljena ploča pokazuje sažetak umjesto sadržaja, a kreiranje ostaje', () => {
    renderScreen({ board: { Project_IDs: ['p1', 'p2'], Show_Done: false, Collapsed_Panels: ['tasks'] } });
    const tasksPanel = screen.getByRole('region', { name: 'Zadaci' });
    expect(within(tasksPanel).queryByText('Miran zadatak')).not.toBeInTheDocument();
    expect(within(tasksPanel).getByText('1 kasni')).toBeInTheDocument();
    expect(within(tasksPanel).getByRole('button', { name: 'Novi zadatak' })).toBeInTheDocument();
});

test('otvorena narudžba raširi desnu kolonu, zatvorena je vraća', () => {
    const withOrder = [{
        Order_ID: 'o1', Order_Number: '2026-041', Supplier_Name: 'Frischeis', Status: 'Poslano',
        Expected_Delivery: '2026-09-20', Total_Amount: 0,
        items: [{ ID: 'oi1', Material_Name: 'Iveral', Quantity: 3, Unit: 'm2', Status: 'Naručeno', Project_ID: 'p1', Product_ID: 'prod1' }],
    }] as unknown as Order[];
    const { container } = renderScreen({ orders: withOrder });
    const board = () => container.querySelector('.kc-board')!;
    expect(board()).toHaveAttribute('data-split', 'balanced');

    const purchases = screen.getByRole('region', { name: 'Narudžbe' });
    fireEvent.click(within(purchases).getByRole('button', { name: 'Otvori narudžbu' }));
    expect(board()).toHaveAttribute('data-split', 'rail-wide');

    fireEvent.click(within(purchases).getByRole('button', { name: 'Sklopi narudžbu' }));
    expect(board()).toHaveAttribute('data-split', 'balanced');
});

test('napomene za kolegu uvijek stoje prve', () => {
    const withColleague = [{
        ...projects[0],
        products: [{
            ...(projects[0].products || [])[0],
            Questions: [
                { id: 'q1', Text: 'Koja boja?', Audience: 'client', Resolved: false, Created_At: '2026-08-01' },
                { id: 'q2', Text: 'Sokl je sada 65mm', Audience: 'colleague', Resolved: false, Created_At: '2026-09-11' },
            ],
        }],
    }, projects[1]] as unknown as Project[];
    renderScreen({ projects: withColleague });
    const notes = screen.getByRole('region', { name: 'Napomene' });
    const texts = within(notes).getAllByText(/Koja boja\?|Sokl je sada 65mm/).map(e => e.textContent);
    expect(texts).toEqual(['Sokl je sada 65mm', 'Koja boja?']);
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
// Traka (Gantt) je zadani prikaz — tako ga korisnik otvara, a i znatno je
// niža od agende, pa tabla ispod ostaje na ekranu. Agenda je jedan klik dalje.

const calendar = () => screen.getByRole('region', { name: 'Kalendar projekata' });
const openAgenda = () => fireEvent.click(within(calendar()).getByRole('button', { name: /Agenda/ }));

test('kalendar se otvara na traci', () => {
    renderScreen();
    const cal = calendar();
    expect(within(cal).getByRole('button', { name: 'Traka' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(cal).getByRole('button', { name: /Agenda/ })).toHaveAttribute('aria-pressed', 'false');
});

test('agenda stavlja kašnjenje na vrh', () => {
    renderScreen();
    openAgenda();
    const cal = calendar();
    const buckets = within(cal).getAllByRole('region');
    expect(buckets[0]).toHaveAccessibleName('Kasni');
    // Nalog s rokom 1.9. i zadatak s rokom 5.9. — oba prije 12.9.
    expect(within(buckets[0]).getByText('Kasni nalog')).toBeInTheDocument();
    expect(within(buckets[0]).getByText('Hitan zadatak')).toBeInTheDocument();
});

test('agenda razvrstava po hitnosti, a ne po abecedi', () => {
    renderScreen();
    openAgenda();
    const cal = calendar();
    const labels = within(cal).getAllByRole('region').map(r => r.getAttribute('aria-label'));
    // Rok projekta je 30.9. (sljedeći mjesec), uredan nalog 1.12.
    expect(labels).toEqual(['Kasni', 'Kasnije']);

    const later = within(cal).getByRole('region', { name: 'Kasnije' });
    expect(within(later).getByText('Uredan nalog')).toBeInTheDocument();
    expect(within(later).getByText('Rok projekta')).toBeInTheDocument();
});

test('traka nudi razlaganje redova i raspon, agenda ih ne nudi', () => {
    renderScreen();
    const cal = calendar();
    expect(within(cal).getByLabelText('Razlaganje redova')).toHaveValue('compact');
    expect(within(cal).getByRole('group', { name: 'Raspon' })).toBeInTheDocument();

    openAgenda();
    expect(within(cal).queryByLabelText('Razlaganje redova')).not.toBeInTheDocument();
    expect(within(cal).queryByRole('group', { name: 'Raspon' })).not.toBeInTheDocument();
});

test('klik na stavku u agendi otvara detalje s radnjom nad njom', () => {
    renderScreen();
    openAgenda();
    const cal = calendar();
    fireEvent.click(within(cal).getByText('Kasni nalog'));
    expect(within(cal).getByRole('button', { name: 'Otvori nalog' })).toBeInTheDocument();
});
