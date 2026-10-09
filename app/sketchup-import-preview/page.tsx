'use client';

// ════════════════════════════════════════════════════════════════════
// /sketchup-import-preview — MAKETA uvoza iz SketchUpa
//
// Projekti su iza prijave. Ova ruta renderuje PRAVI SketchUpOfferImportModal
// nad demo katalogom (nazivi iz stvarnog kataloga) i izvozom kakav pravi
// Component Manager → Ponuda → Izvoz za ERP, bez čitanja i pisanja baze.
//
// U produkciji ruta ne postoji.
// ════════════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import { notFound } from 'next/navigation';
import SketchUpOfferImportModal from '@/components/SketchUpOfferImportModal';
import { SU_EXPORT_FORMAT, type SuExport } from '@/lib/sketchupImport';
import type { Material, Project, Supplier } from '@/lib/types';

export const dynamic = 'force-dynamic';

const m = (id: string, Name: string, Category: string, Unit: string, price: number, supplier: string): Material => ({
    Material_ID: id, Organization_ID: 'demo', Name, Category, Unit, Default_Supplier: supplier, Default_Unit_Price: price, Description: '',
});

const catalog: Material[] = [
    m('iv-u156', 'Iveral / U156 ST9', 'Ploče i trake', 'Kom', 180, 'Frischeis'),
    m('iv-w960', 'Iveral / W960 Klasik bijela', 'Ploče i trake', 'Kom', 100, 'Frischeis'),
    m('iv-u999', 'Iveral / Crni U999 ST9', 'Ploče i trake', 'Kom', 120, 'Frischeis'),
    m('iv-korpus', 'Iveral / Bijeli za korpus', 'Ploče i trake', 'Kom', 100, 'Frischeis'),
    m('hpl-u999', 'HPL / U999', 'Ploče i trake', 'Kom', 210, 'Frischeis'),
    m('lesomal', 'Lesomal', 'Ploče i trake', 'Kom', 20, 'Frischeis'),
    m('kt-u156', 'KT / U156 23/0.8', 'Ploče i trake', 'm', 1.5, 'Frischeis'),
    m('kt-w960', 'KT / W960 23 / 0.8', 'Ploče i trake', 'm', 1, 'Frischeis'),
    m('kt-u999', 'KT / Crna U999 ST9 23/0.8', 'Ploče i trake', 'm', 1.5, 'Frischeis'),
    m('bag-r', 'Baglama ravna (sa ublazivacem)', 'Okovi', 'Kom', 6, 'Schachermayer'),
    m('bag-r-bez', 'Baglama ravna (bez ublazivaca)', 'Okovi', 'Kom', 6, 'Schachermayer'),
    m('bag-p', 'Baglama paralelna (sa ublazivacem)', 'Okovi', 'Kom', 7, 'Schachermayer'),
    m('vod-blum-450', 'Vodilice Blum 450', 'Okovi', 'Kom', 70, 'Schachermayer'),
    m('vod-k-450', 'Vodilice Kuglične 450', 'Okovi', 'Kom', 20, 'Schachermayer'),
    m('vod-k-500', 'Vodilice Kuglične 500', 'Okovi', 'Kom', 30, 'Schachermayer'),
    m('nog-10', 'Nogice za kuhinje 10cm', 'Okovi', 'Kom', 1, 'Schachermayer'),
    m('nos-gor', 'Nosaci gornjih elemenata', 'Okovi', 'Kom', 3, 'Schachermayer'),
    m('gola-hl', 'Horizontalna Gola L', 'Okovi', 'Kom', 70, 'Schachermayer'),
    m('rucka', 'Profilna ručka Rujz Design, 658.35, SatBronzE', 'Okovi', 'kom', 42, 'RujzDesign'),
];

const suppliers: Supplier[] = ['Frischeis', 'Elgrad', 'Schachermayer', 'RujzDesign'].map((Name, i) => ({
    Supplier_ID: `s${i}`, Organization_ID: 'demo', Name, Contact_Person: '', Phone: '', Email: '', Address: '', Categories: '',
}));

const ploca = (naziv: string, erp: string, kol: number, cij: number, dob: string, extra: Record<string, unknown> = {}) =>
    ({ vrsta: 'ploca' as const, naziv, erp, jm: 'ploča', kolicina: kol, cijena: cij, dobavljac: dob, debljina: 18, povrsinaPloce: 5.796, ...extra });
const kant = (naziv: string, erp: string, kol: number, cij: number, dob: string, extra: Record<string, unknown> = {}) =>
    ({ vrsta: 'kant' as const, naziv, erp, jm: 'm', kolicina: kol, cijena: cij, dobavljac: dob, debljina: 18, ...extra });
const okov = (naziv: string, erp: string | undefined, kol: number, cij: number, jm = 'kom', dob = '', extra: Record<string, unknown> = {}) =>
    ({ vrsta: 'okov' as const, naziv, erp, jm, kolicina: kol, cijena: cij, dobavljac: dob, ...extra });
const usluga = (naziv: string, kol: number, cij: number) => ({ vrsta: 'usluga' as const, naziv, jm: 'm', kolicina: kol, cijena: cij, dobavljac: 'Elgrad' });

const data: SuExport = {
    format: SU_EXPORT_FORMAT, verzija: 1, datum: '2026-10-08T19:28:48.472Z', model: 'Kuhinja Begović.skp',
    cjenovnik: 'Cjenovnik_Penny_Elgrad_srednji_okov_ERP.xlsx',
    proizvodi: [
        { kljuc: 'Donji element 80', naziv: 'Donji element 80', kolicina: 2, sirina: 800, visina: 870, dubina: 560, stavke: [
            ploca('Egger U156 ST9 pješčano bež · 18 mm', 'Iveral / U156 ST9', 0.79, 211.554, 'Elgrad', { erpId: 'iv-u156' }),
            kant('U156 ST9 ABS 0,8/23 mm', 'KT / U156 23/0.8', 24.3, 1.25, 'Elgrad', { erpId: 'kt-u156' }),
            usluga('Rezanje iverala 10-18 mm – Egger U156', 13.8, 0.78),
            ploca('Bijeli iveral 18 mm – Kronospan 8685 BS · 18 mm', 'Iveral / Kronospan 8685 BS bijela', 1, 92.736, 'Penny'),
            kant('Bijela ABS traka 0,8/23 mm', 'KT / Bijela 8685 23/0.8', 16.9, 1.5, 'Penny'),
            ploca('Iveral / Crni U999 ST9 · 18 mm', 'Iveral / Crni U999 ST9', 0.5, 120, 'Frischeis', { erpId: 'iv-u999' }),
            kant('KT / Crna U999 ST9 23/0.8', 'KT / Crna U999 ST9 23/0.8', 10.8, 1.5, 'Frischeis', { erpId: 'kt-u999' }),
            { vrsta: 'ploca' as const, naziv: 'Bijeli lesomal / HDF 4 mm · 4 mm', erp: 'Lesomal', erpId: 'lesomal', jm: 'ploča', kolicina: 0.35, cijena: 43.47, dobavljac: 'Penny', debljina: 4, povrsinaPloce: 5.796 },
            okov('Šarka Tiomos 110° s usporivačem', 'Baglama ravna (sa ublazivacem)', 8, 4, 'kom', '', { erpId: 'bag-r' }),
            okov('Montažna pločica Tiomos', 'Montažna pločica za baglamu', 8, 0.8),
            okov('Vodilice Blum 450', 'Vodilice Blum 450', 6, 70, 'Kom', 'Schachermayer', { erpId: 'vod-blum-450' }),
            okov('Kuglične vodilice s usporivačem · 500 mm', 'Vodilice Kuglične 500', 2, 13, 'par', '', { erpId: 'vod-k-500' }),
            okov('PVC nogica 80-100 mm s prihvatom · 100 mm', 'Nogice za kuhinje 10cm', 8, 2, 'set', '', { erpId: 'nog-10' }),
            // ručno dodana stavka bez ERP naziva — ERP je traži sam
            okov('Ručka profilna 658.35 bronza', undefined, 4, 42, 'kom', 'RujzDesign'),
        ] },
        { kljuc: 'Gornji element 80', naziv: 'Gornji element 80', kolicina: 1, sirina: 800, visina: 720, dubina: 320, stavke: [
            ploca('Egger U156 ST9 pješčano bež · 18 mm', 'Iveral / U156 ST9', 0.21, 211.554, 'Elgrad', { erpId: 'iv-u156' }),
            kant('U156 ST9 ABS 0,8/23 mm', 'KT / U156 23/0.8', 9.4, 1.25, 'Elgrad', { erpId: 'kt-u156' }),
            okov('Šarka Tiomos 110° s usporivačem', 'Baglama ravna (sa ublazivacem)', 4, 4, 'kom', '', { erpId: 'bag-r' }),
            okov('Nosač visećih elemenata', 'Nosaci gornjih elemenata', 2, 3.5, 'paket', '', { erpId: 'nos-gor' }),
            okov('Gola G38 crni profil, šipka 4200 mm', 'Horizontalna Gola L', 0.5, 80, 'kom', '', { erpId: 'gola-hl' }),
        ] },
        { kljuc: 'Visoki element 60', naziv: 'Visoki element 60', kolicina: 1, sirina: 600, visina: 2100, dubina: 580, stavke: [
            ploca('Egger U156 ST9 pješčano bež · 18 mm', 'Iveral / U156 ST9', 1.5, 211.554, 'Elgrad', { erpId: 'iv-u156' }),
            okov('Šarka Tiomos 110° s usporivačem', 'Baglama ravna (sa ublazivacem)', 6, 4, 'kom', '', { erpId: 'bag-r' }),
        ] },
    ],
};

export default function SketchUpImportPreviewPage() {
    const [open, setOpen] = useState(true);
    const [log, setLog] = useState<string[]>([]);

    // Projekat u kojem „Visoki element 60" već postoji iz ranijeg uvoza.
    const project = useMemo<Project>(() => ({
        Project_ID: 'pr-demo', Organization_ID: 'demo', Name: 'Kuhinja Begović', Client_Name: 'Begović', Client_Phone: '', Client_Email: '',
        Address: '', Notes: '', Status: 'Aktivan', Created_Date: '2026-10-01', Deadline: '',
        products: [{
            Product_ID: 'p-old', Organization_ID: 'demo', Project_ID: 'pr-demo', Name: 'Visoki element 60', Height: 2100, Width: 600, Depth: 580,
            Quantity: 1, Status: 'Na čekanju', Material_Cost: 0, Notes: '',
            materials: [
                { ID: 'pm1', Organization_ID: 'demo', Product_ID: 'p-old', Material_ID: 'iv-u156', Material_Name: 'Iveral / U156 ST9', Quantity: 1, Unit: 'Kom', Unit_Price: 180, Total_Price: 180, Status: 'Nije naručeno', Supplier: 'Frischeis', Order_ID: '', Import_Source: 'sketchup' },
                { ID: 'pm2', Organization_ID: 'demo', Product_ID: 'p-old', Material_ID: 'x', Material_Name: 'Staklo / Float', Quantity: 1, Unit: 'm2', Unit_Price: 40, Total_Price: 40, Status: 'Nije naručeno', Supplier: 'Ramaglas', Order_ID: '' },
            ],
        }],
    }), []);

    const demo = useMemo(() => ({ catalog, suppliers, data }), []);

    if (process.env.NODE_ENV === 'production') notFound();

    return (
        <div style={{ padding: 24, minHeight: '100vh', background: '#f5f5f7' }}>
            <button className="btn btn-primary" onClick={() => setOpen(true)}>Otvori uvoz</button>
            {log.length > 0 && <pre style={{ marginTop: 16 }}>{log.join('\n')}</pre>}
            <SketchUpOfferImportModal
                isOpen={open}
                onClose={() => setOpen(false)}
                project={project}
                organizationId="demo"
                onImported={() => setLog(l => [...l, 'onImported'])}
                showToast={(msg, type) => setLog(l => [...l, `${type}: ${msg}`])}
                demo={demo}
            />
        </div>
    );
}
