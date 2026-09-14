import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ProjectCommand from '../ProjectCommand';
import ProjectPlanCalendar from '../ProjectPlanCalendar';
import ProjectMaterialGroups from '../ProjectMaterialGroups';
import { buildProjectOverview } from '@/lib/projectOverview';
import { getScenarios } from '@/lib/services/planning/scenarioService';
import type { PlanScenario, Project, WorkOrder } from '@/lib/types';

jest.mock('@/lib/services/planning/scenarioService', () => ({ getScenarios: jest.fn() }));
jest.mock('@/lib/planning', () => ({ todayISO: () => '2026-09-10' }));

const project = { Project_ID: 'p', Name: 'Projekt', products: [{ Product_ID: 'pr', Name: 'Stol', Quantity: 1 }] } as Project;
const workOrders = [
    { Work_Order_ID: 'a', Name: 'Aktivni stol', Status: 'U toku', Due_Date: '2026-09-09', items: [{ ID: 'i', Project_ID: 'p', Product_ID: 'pr', Product_Name: 'Stol', Status: 'U toku', Product_Value: 12345 }] },
    { Work_Order_ID: 'b', Name: 'Gotova klupa', Status: 'Završeno', Due_Date: '2026-09-01', items: [{ ID: 'j', Project_ID: 'p', Product_ID: 'pr', Status: 'Završeno' }] },
] as WorkOrder[];
const plans = [{ Scenario_ID: 's', Name: 'Septembar', Blocks: [
    { id: 'our', title: 'Proizvodnja stola', kind: 'order', startISO: '2026-09-08', endISO: '2026-09-12', productRefs: [{ id: 'pr', name: 'Stol', qty: 1 }] },
    { id: 'other', title: 'Drugi projekat', kind: 'montaza', startISO: '2026-09-10', endISO: '2026-09-11', projectRef: { id: 'other', name: 'Drugi' } },
] }, { Scenario_ID: 's2', Name: 'Oktobar', Blocks: [{ id: 'later', title: 'Montaža stola', kind: 'montaza', startISO: '2026-10-01', endISO: '2026-10-02', projectRef: { id: 'p', name: 'Projekt' } }] }] as PlanScenario[];

beforeEach(() => { jest.clearAllMocks(); jest.mocked(getScenarios).mockResolvedValue(plans); });

test('command omits money and filters/searches orders while preserving the open action', () => {
    const open = jest.fn();
    render(<ProjectCommand project={project} ov={buildProjectOverview({ project, workOrders, workLogs: [] })} rawWorkOrders={workOrders} projectTasks={[]} orderableCount={0} canCreate onOpenWorkOrder={open} onNewWorkOrder={jest.fn()} onNaruci={jest.fn()} onAddTask={jest.fn()} onToggleTask={jest.fn()} onOpenTask={jest.fn()} onGoTab={jest.fn()} />);
    expect(screen.queryByText(/profit|klijent plaća|marža|KM|12.345/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Gotova klupa')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Aktivni stol/ }));
    expect(open).toHaveBeenCalledWith('a');
    fireEvent.click(screen.getByRole('button', { name: 'Završeni' }));
    expect(screen.getByText('Gotova klupa')).toBeInTheDocument();
    expect(screen.queryByText('Aktivni stol')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Pretraži naloge i proizvode'), { target: { value: 'nema' } });
    expect(screen.getByText('Nema naloga za ovu pretragu.')).toBeInTheDocument();
});

test('calendar highlights related work, allows context filtering and switches to project dates', async () => {
    render(<ProjectPlanCalendar organizationId="org" project={project} workOrders={workOrders} onOpenWorkOrder={jest.fn()} />);
    expect(await screen.findByRole('button', { name: /Proizvodnja stola/ })).toHaveClass('related');
    expect(screen.getByRole('button', { name: /Drugi projekat/ })).toHaveClass('context');
    fireEvent.click(screen.getByLabelText('Samo ovaj projekat'));
    expect(screen.queryByRole('button', { name: /Drugi projekat/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Odaberi plan'), { target: { value: 's2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Na termin projekta' }));
    expect(screen.getByRole('button', { name: /Montaža stola/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Prethodna sedmica' }));
    expect(screen.queryByRole('button', { name: /Montaža stola/ })).not.toBeInTheDocument();
});

test('failed plan loading has a working retry and does not claim no plans exist', async () => {
    jest.mocked(getScenarios).mockRejectedValueOnce(new Error('offline'));
    render(<ProjectPlanCalendar organizationId="org" project={project} workOrders={workOrders} onOpenWorkOrder={jest.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Planovi se nisu učitali');
    fireEvent.click(screen.getByRole('button', { name: 'Pokušaj ponovo' }));
    await waitFor(() => expect(screen.getByLabelText('Odaberi plan')).toBeInTheDocument());
});

test('ready material filter includes both received and on-stock materials in alphabetic product groups', () => {
    const materialProject = { ...project, products: [{ Product_ID: 'pr', Name: 'Stol', Quantity: 1, materials: [
        { ID: '1', Material_Name: 'Vijak', Status: 'Primljeno', Unit: 'kom' },
        { ID: '2', Material_Name: 'Drvo', Status: 'Na stanju', Unit: 'm3' },
        { ID: '3', Material_Name: 'Boja', Status: 'Naručeno', Unit: 'l' },
    ] }] } as Project;
    render(<ProjectMaterialGroups project={materialProject} filter="ready" />);
    const rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Drvo'); expect(rows[2]).toHaveTextContent('Vijak');
    expect(screen.queryByText('Boja')).not.toBeInTheDocument();
});
