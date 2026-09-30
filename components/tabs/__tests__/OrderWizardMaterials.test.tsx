import { fireEvent, render, screen } from '@testing-library/react';
import { OrderWizardModal } from '../OrderWizardModal';

const noop = () => {};
const materials = [
    { ID: 'v', Material_Name: 'Vijak', Product_Name: 'Stol', Project_Name: 'Projekat A', Quantity: 4, Unit: 'kom', Unit_Price: 1, Total_Price: 4 },
    { ID: 's1', Material_Name: 'Šarka', Product_Name: 'Stol', Project_Name: 'Projekat A', Quantity: 5, Unit: 'kom', Unit_Price: 2, Total_Price: 10 },
    { ID: 's2', Material_Name: 'Šarka', Product_Name: 'Ormar', Project_Name: 'Projekat A', Quantity: 5, Unit: 'kom', Unit_Price: 2, Total_Price: 10 },
];

function setup() {
    const setGroupOrderQuantity = jest.fn();
    render(<OrderWizardModal
        isOpen onClose={noop} wizardStep={4} setWizardStep={noop}
        projectsWithMaterials={[]} selectedProjectIds={new Set()} toggleProject={noop}
        availableProducts={[]} selectedProductIds={new Set()} toggleProduct={noop} setSelectedProductIds={noop}
        availableSuppliers={[]} selectedSupplierIds={new Set()} toggleSupplier={noop}
        browseMode="supplier" onChangeBrowseMode={noop} availableCategories={[]}
        selectedCategories={new Set()} toggleCategory={noop}
        setSelectedMaterialIds={noop} filteredMaterials={materials}
        selectedMaterialIds={new Set(['v', 's1', 's2'])} toggleMaterial={noop}
        selectAllMaterials={noop} selectedTotal={24} formatCurrency={n => `${n} KM`}
        handleCreateOrder={noop} orderQuantities={{}} onStockQuantities={{}} orderOnlyExtras={{}}
        setGroupOrderQuantity={setGroupOrderQuantity} setGroupOnStock={noop}
        orderName="" setOrderName={noop}
    />);
    return setGroupOrderQuantity;
}

test('hardware is alphabetical and an order quantity can be replaced before committing', async () => {
    const setQuantity = setup();
    expect(Array.from(document.querySelectorAll('.material-item .item-title')).map(el => el.textContent))
        .toEqual(['Šarka', 'Vijak']);

    const input = screen.getByRole('spinbutton', { name: 'Naruči Šarka' }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });
    expect(input.value).toBe('');
    fireEvent.change(input, { target: { value: '15' } });
    expect(input.value).toBe('15');
    fireEvent.blur(input);
    expect(await screen.findByText(/Da li se dodatnih 5 kom odnosi/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Kreiraj/ })).toBeDisabled();
    expect(setQuantity).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Ne, samo povećaj narudžbu' }));
    expect(screen.getByRole('button', { name: /Kreiraj/ })).toBeEnabled();
    expect(setQuantity).toHaveBeenCalledWith(expect.any(String), ['s1', 's2'], 15, undefined);
});

test('extra quantity can be assigned to a chosen product', async () => {
    const setQuantity = setup();
    const input = screen.getByRole('spinbutton', { name: 'Naruči Šarka' });
    fireEvent.change(input, { target: { value: '13' } });
    fireEvent.blur(input);
    fireEvent.click(await screen.findByRole('button', { name: 'Da, odaberi proizvod' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ormar • Projekat A' }));
    expect(setQuantity).toHaveBeenCalledWith(expect.any(String), ['s1', 's2'], 13, 's2');
});
