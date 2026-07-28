// ════════════════════════════════════════════════════════════════════
// PROJEKCIJA PROJEKATA I PROIZVODA — bez cijena i bez podataka o klijentu
//
// Izbacuje se dvoje:
//   • novac — `Product.Material_Cost`, `ProductMaterial.Unit_Price/Total_Price`
//   • kontakt klijenta — telefon, email, ID/PDV broj. Kontroloru ne trebaju,
//     a to su lični podaci.
//
// Zadržava se ono što se u pogonu stvarno koristi: naziv, adresa (gdje se
// montira), dimenzije, spremnost materijala i OZNAKA ESENCIJALNOG materijala —
// upravo ona blokira pokretanje naloga, a nijedan mobilni ekran je do sada
// nije prikazivao.
// ════════════════════════════════════════════════════════════════════

import type { Product, ProductMaterial, Project } from '@/lib/types';

export interface FieldMaterialRow {
    materialId: string;
    name: string;
    quantity: number;
    unit: string;
    status: string;
    supplier: string;
    /** Bez njega nalog ne može krenuti (lib/workOrderStart.ts). */
    isEssential: boolean;
    /** Primljeno ili na stanju = spremno za rad. */
    isReady: boolean;
}

export interface FieldProductRow {
    productId: string;
    name: string;
    quantity: number;
    status: string;
    dimensions: string;
    materialsTotal: number;
    materialsReady: number;
    /** Esencijalni materijali koji još nisu spremni — razlog zašto nalog stoji. */
    essentialMissing: number;
    openQuestions: number;
}

export interface FieldProjectRow {
    projectId: string;
    name: string;
    address: string;
    status: string;
    deadline: string | null;
    productCount: number;
    productsReady: number;
}

export interface FieldProductDetail extends FieldProductRow {
    projectName: string;
    notes: string;
    materials: FieldMaterialRow[];
    processes: string[];
}

/**
 * Proizvodi se nose PUNI (s materijalima), ne kao sažetak.
 *
 * U pogonu je to nekoliko desetina zapisa, a poniranje projekat → proizvod →
 * materijali onda ne ide na mrežu. Na slaboj wifi vezi u radionici to je
 * razlika između trenutnog i mučnog listanja.
 */
export interface FieldProjectDetail extends FieldProjectRow {
    notes: string;
    products: FieldProductDetail[];
}

const dOnly = (iso?: string | null): string | null => (iso ? iso.split('T')[0] : null);

/** Spremno = primljeno ili već na stanju. Ista definicija kao lib/workOrderStart.ts. */
export const isMaterialReady = (status: string): boolean =>
    status === 'Primljeno' || status === 'Na stanju';

function dimensionsOf(p: Pick<Product, 'Width' | 'Height' | 'Depth'>): string {
    const parts = [p.Width, p.Height, p.Depth].filter(x => x && x > 0);
    return parts.length === 3 ? `${p.Width}×${p.Height}×${p.Depth} mm` : '';
}

function toProductRow(product: Product): FieldProductRow {
    const materials = product.materials || [];
    const ready = materials.filter(m => isMaterialReady(m.Status)).length;
    const essentialMissing = materials.filter(m => m.Is_Essential && !isMaterialReady(m.Status)).length;
    const questions = product.Questions || [];

    return {
        productId: product.Product_ID,
        name: product.Name || 'Proizvod',
        quantity: product.Quantity || 0,
        status: product.Status || 'Na čekanju',
        dimensions: dimensionsOf(product),
        materialsTotal: materials.length,
        materialsReady: ready,
        essentialMissing,
        // Neriješeno pitanje je razlog zašto proizvod stoji — vrijedi ga vidjeti.
        openQuestions: questions.filter(q => !q.Resolved).length,
    };
}

function toProjectRow(project: Project): FieldProjectRow {
    const products = project.products || [];
    return {
        projectId: project.Project_ID,
        name: project.Name?.trim() || project.Client_Name || 'Projekat',
        address: project.Address || '',
        status: project.Status || '',
        deadline: dOnly(project.Deadline),
        productCount: products.length,
        productsReady: products.filter(p => {
            const mats = p.materials || [];
            return mats.length > 0 && mats.every(m => isMaterialReady(m.Status));
        }).length,
    };
}

/** Projekti koji su još u igri — završeni i otkazani se ne prikazuju u pogonu. */
const ACTIVE_PROJECT_STATUSES = new Set(['Odobreno', 'U proizvodnji']);

export function buildFieldProjectsList(projects: Project[]): FieldProjectRow[] {
    return projects
        .filter(p => !p.Hidden && ACTIVE_PROJECT_STATUSES.has(p.Status))
        .map(toProjectRow)
        .sort((a, b) =>
            (a.deadline || '9999').localeCompare(b.deadline || '9999')
            || a.name.localeCompare(b.name, 'bs')
        );
}

export function buildFieldProjectDetail(project: Project): FieldProjectDetail {
    const projectName = project.Name?.trim() || project.Client_Name || 'Projekat';
    return {
        ...toProjectRow(project),
        notes: project.Notes || '',
        products: (project.products || [])
            .map(p => buildFieldProductDetail(p, projectName))
            .sort((a, b) => a.name.localeCompare(b.name, 'bs')),
    };
}

export function buildFieldProductDetail(product: Product, projectName: string): FieldProductDetail {
    const materials: ProductMaterial[] = product.materials || [];

    // Faze plana su izvor; ravni Process_Plan je legacy fallback.
    const stages = product.Process_Stages || [];
    const processes = stages.length > 0
        ? stages.flatMap(s => s.processes || [])
        : (product.Process_Plan || []);

    return {
        ...toProductRow(product),
        projectName,
        notes: product.Notes || '',
        processes,
        materials: materials
            .map(m => ({
                materialId: m.ID,
                name: m.Material_Name || 'Materijal',
                quantity: m.Quantity || 0,
                unit: m.Unit || '',
                status: m.Status || 'Nije naručeno',
                supplier: m.Supplier || '',
                isEssential: m.Is_Essential === true,
                isReady: isMaterialReady(m.Status),
            }))
            // Ono što fali prvo, a unutar toga esencijalno na vrh.
            .sort((a, b) =>
                Number(a.isReady) - Number(b.isReady)
                || Number(b.isEssential) - Number(a.isEssential)
                || a.name.localeCompare(b.name, 'bs')
            ),
    };
}
