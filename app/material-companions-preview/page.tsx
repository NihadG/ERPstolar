'use client';

// ════════════════════════════════════════════════════════════════════
// /material-companions-preview — PRAVI modal „Dodaj Materijale" s redom
// „Obično ide uz to" (lib/materialCompanions) nad izmišljenom istorijom.
//
// Modal je iza prijave (Projekti → proizvod → + materijal), pa se ovdje vidi
// bez baze. Katalog nosi nazive kakvi su u radionici; istorija sastavnica je
// složena da liči na stvarnu raspodjelu (furnir hrast ≈ MDF 18 + lak + KT).
// ?p=postojeci otvara modal za proizvod koji već ima furnir i MDF.
// U produkciji ruta ne postoji.
// ════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import { notFound } from 'next/navigation';
import { DataContext } from '@/context/DataContext';
import MaterialSelectModal from '@/components/ui/MaterialSelectModal';
import type { CompanionBundle } from '@/lib/materialCompanions';
import type { Material } from '@/lib/types';

export const dynamic = 'force-dynamic';

const M = (id: string, Name: string, Category: string, Unit: string, Default_Unit_Price: number, extra: Partial<Material> = {}): Material => ({
    Material_ID: id, Organization_ID: 'demo', Name, Category, Unit, Default_Unit_Price, Default_Supplier: 'Dobavljač d.o.o.', Description: '', ...extra,
});

const catalog: Material[] = [
    M('mdf18', 'MDF 18', 'Ploče i trake', 'kom', 62),
    M('mdf6', 'MDF 6', 'Ploče i trake', 'kom', 28),
    M('fhr', 'Furnir / Hrast', 'Ploče i trake', 'm2', 24),
    M('fkkhr', 'Furnir KK / Hrast', 'Ploče i trake', 'm2', 14),
    M('for', 'Furnir / Orah', 'Ploče i trake', 'm2', 31),
    M('ftik', 'Furnir / Tik', 'Ploče i trake', 'm2', 38),
    M('ktfhr', 'KT / Furnir Hrast 24 / 1', 'Ploče i trake', 'm', 1.6),
    M('ktfhr42', 'KT / Furnir hrast 42 / 1', 'Ploče i trake', 'm', 2.4),
    M('ktor', 'KT / Orah 22 / 1', 'Ploče i trake', 'm', 1.5),
    M('iv702', 'Iveral / U702 ST9', 'Ploče i trake', 'kom', 96),
    M('kt702', 'KT / Siva U702 ST9 23 / 0.8', 'Ploče i trake', 'm', 0.9),
    M('ivkor', 'Iveral / Bijeli za korpus', 'Ploče i trake', 'kom', 78),
    M('ktkor', 'KT / Bijela za korpus 22 / 1', 'Ploče i trake', 'm', 0.7),
    M('iv416', 'Iveral / F416 Textil Bež', 'Ploče i trake', 'kom', 104),
    M('kt416', 'KT / Textil F416 22 / 1', 'Ploče i trake', 'm', 1.1),
    M('les', 'Lesomal', 'Ploče i trake', 'kom', 18),
    M('lak', 'Lakiranje', 'Ostalo', 'm2', 35),
    M('bagl', 'Baglama ravna (sa ublazivacem)', 'Okovi', 'kom', 4.5),
    M('vod', 'Vodilice Blum 500', 'Okovi', 'par', 42),
    M('cjev', 'Extrudirana iverica (Šuplja)', 'Ploče i trake', 'kom', 55),
    M('stak', 'Ogledalo / Clear', 'Staklo', 'm2', 60, { Is_Glass: true }),
];

/** n proizvoda iste sastavnice raspoređenih kroz `projects` projekata. */
function many(n: number, projects: number, ids: string[]): CompanionBundle[] {
    return Array.from({ length: n }, (_, i) => ({ projectId: `pj${i % projects}`, materials: ids.map(Material_ID => ({ Material_ID })) }));
}

const history: CompanionBundle[] = [
    ...many(20, 8, ['fhr', 'mdf18', 'lak', 'ktfhr']),
    ...many(14, 6, ['fhr', 'mdf18', 'lak', 'fkkhr', 'bagl']),
    ...many(8, 4, ['fhr', 'lak']),
    ...many(16, 5, ['for', 'mdf18', 'lak', 'ktor']),
    ...many(12, 5, ['iv702', 'kt702', 'bagl', 'les']),
    ...many(10, 4, ['iv416', 'kt416', 'bagl', 'vod']),
    ...many(8, 3, ['ivkor', 'ktkor', 'les']),
    ...many(18, 7, ['mdf18', 'lak', 'vod']),
];

export default function MaterialCompanionsPreviewPage() {
    const [open, setOpen] = useState(false);
    const [existingCase, setExistingCase] = useState(false);

    useEffect(() => {
        setExistingCase(new URLSearchParams(window.location.search).get('p') === 'postojeci');
        setOpen(true); // tek nakon montiranja — portal ne smije u serverski HTML
    }, []);

    if (process.env.NODE_ENV === 'production') notFound();

    const value = {
        appState: { suppliers: [] }, organizationId: '', loading: false, loadedCollections: new Set(),
        isTabLoaded: () => true, loadTabData: async () => undefined,
    } as never;

    return (
        <DataContext.Provider value={value}>
            <div style={{ padding: 40, fontFamily: 'system-ui, sans-serif' }}>
                <h1 style={{ fontSize: 18 }}>Maketa: prateći materijali u „Dodaj Materijale"</h1>
                <button onClick={() => setOpen(true)} style={{ padding: '8px 14px' }}>Otvori modal</button>
                <MaterialSelectModal
                    isOpen={open}
                    onClose={() => setOpen(false)}
                    materials={catalog}
                    onAddMaterials={async items => { console.log('dodaj', items); }}
                    productId="demo-proizvod"
                    organizationId=""
                    onRefresh={() => undefined}
                    showToast={(m) => console.log(m)}
                    companionHistory={history}
                    existingMaterials={existingCase ? [{ Material_ID: 'for', Material_Name: 'Furnir / Orah' }, { Material_ID: 'mdf18', Material_Name: 'MDF 18' }] : []}
                />
            </div>
        </DataContext.Provider>
    );
}
