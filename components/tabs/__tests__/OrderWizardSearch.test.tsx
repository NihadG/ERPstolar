// Korak 1 wizarda narudžbe: pretraga projekata. Lista zna imati stotine kartica,
// pa je kucanje jedini upotrebljiv način da se nađe klijent.

import { fireEvent, render, screen } from '@testing-library/react';
import { OrderWizardModal } from '../OrderWizardModal';

const projects = [
    { Project_ID: 'p1', Name: 'Bisic - Fasada Poljine', Client_Name: 'Bisic', products: [{ Product_ID: 'a', Name: 'A' }] },
    { Project_ID: 'p2', Name: 'Šišić Vrata', Client_Name: 'Šišić', products: [{ Product_ID: 'b', Name: 'B' }] },
    { Project_ID: 'p3', Name: 'Hotel Grude', Client_Name: 'Hotel Grude', products: [] },
];

const noop = () => { /* wizard traži pune propse; korak 1 ih ne koristi */ };

function setup(over: Record<string, unknown> = {}) {
    const toggleProject = jest.fn();
    render(
        <OrderWizardModal
            isOpen
            onClose={noop}
            wizardStep={1}
            setWizardStep={noop}
            projectsWithMaterials={projects}
            selectedProjectIds={new Set()}
            toggleProject={toggleProject}
            availableProducts={[]}
            selectedProductIds={new Set()}
            toggleProduct={noop}
            setSelectedProductIds={noop}
            availableSuppliers={[]}
            selectedSupplierIds={new Set()}
            toggleSupplier={noop}
            browseMode="supplier"
            onChangeBrowseMode={noop}
            availableCategories={[]}
            selectedCategories={new Set()}
            toggleCategory={noop}
            setSelectedMaterialIds={noop}
            filteredMaterials={[]}
            selectedMaterialIds={new Set()}
            toggleMaterial={noop}
            selectAllMaterials={noop}
            selectedTotal={0}
            formatCurrency={() => '0'}
            handleCreateOrder={noop}
            orderQuantities={{}}
            onStockQuantities={{}}
            setOrderQuantity={noop}
            setOnStockQuantity={noop}
            orderName=""
            setOrderName={noop}
            {...over}
        />
    );
    return { toggleProject, input: screen.getByPlaceholderText('Pretraži projekte ili klijente...') };
}

// Naslov je prvi red u tekstualnom bloku kartice (blok stoji iza ikonice kvačice).
const cardTitles = () => Array.from(document.querySelectorAll('.project-card'))
    .map(c => c.lastElementChild?.firstElementChild?.textContent);

test('bez upita se vide svi ponuđeni projekti', () => {
    setup();
    expect(cardTitles()).toHaveLength(3);
});

test('pretraga hvata i naziv i klijenta, bez obzira na kvačice', () => {
    const { input } = setup();
    fireEvent.change(input, { target: { value: 'sisic' } });
    expect(cardTitles()).toEqual(['Šišić Vrata']);
});

test('Enter odabire kad je ostao samo jedan pogodak', () => {
    const { toggleProject, input } = setup();
    fireEvent.change(input, { target: { value: 'grude' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(toggleProject).toHaveBeenCalledWith('p3');
    expect((input as HTMLInputElement).value).toBe('');
});

test('Enter ne pogađa nasumično kad ima više rezultata', () => {
    const { toggleProject, input } = setup();
    fireEvent.change(input, { target: { value: 'a' } });
    expect(cardTitles().length).toBeGreaterThan(1);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(toggleProject).not.toHaveBeenCalled();
});

test('promašaj nudi izlaz, umjesto prazne strane', () => {
    const { input } = setup();
    fireEvent.change(input, { target: { value: 'nepostojeci' } });
    expect(cardTitles()).toHaveLength(0);
    expect(screen.getByText(/Nema projekta za/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('Očisti pretragu'));
    expect(cardTitles()).toHaveLength(3);
});
