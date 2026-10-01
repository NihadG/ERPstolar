import { fireEvent, render, screen } from '@testing-library/react';
import MaterialOrderSelectModal from '../MaterialOrderSelectModal';
import type { MaterialOrderPlanGroup } from '@/lib/services';

const plan: MaterialOrderPlanGroup[] = ['Frischeis', 'Interni', 'Ramaglas', 'Schachermayer', 'Nepoznat dobavljač'].map((supplierName, index) => ({
    supplierName,
    materials: [{
        productMaterialId: `material-${index}`,
        materialName: `Materijal ${index + 1}`,
        quantity: index + 1,
        unit: 'kom',
        unitPrice: 10,
        productId: `product-${index}`,
        productName: `Proizvod ${index + 1}`,
        projectId: 'project-1',
    }],
}));

test('all suppliers stay visible while expanding and selecting are separate actions', () => {
    render(<MaterialOrderSelectModal
        isOpen
        onClose={jest.fn()}
        workOrderLabel="Radni nalog"
        plannedStartDate="2026-10-01"
        organizationId="test"
        onRefresh={jest.fn()}
        showToast={jest.fn()}
        plan={plan}
        onCreate={jest.fn()}
    />);

    for (const group of plan) {
        expect(screen.getByRole('button', { name: new RegExp(group.supplierName) })).toHaveAttribute('aria-expanded', 'false');
    }
    expect(screen.queryByRole('button', { name: /Materijal 1/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Frischeis/ }));
    expect(screen.getByRole('button', { name: /Materijal 1/ })).toBeVisible();
    fireEvent.click(screen.getByRole('checkbox', { name: /Isključi sve materijale kod Frischeis/ }));
    expect(screen.getByRole('button', { name: /Frischeis/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /Kreiraj narudžbe \(4\)/ })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Prikaži sve' }));
    expect(screen.getByRole('button', { name: /Materijal 5/ })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Sažmi sve' }));
    expect(screen.queryByRole('button', { name: /Materijal 5/ })).not.toBeInTheDocument();
});
