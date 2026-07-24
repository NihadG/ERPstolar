'use client';

// ════════════════════════════════════════════════════════════════════
// PROJEKTI — mobilni prikaz
//
// Tri nivoa, svaki svoj ekran (umjesto gnijezda harmonika):
//   1) lista projekata  →  2) proizvodi projekta  →  3) detalj proizvoda
//
// Novac se NE ističe po proizvodu; vrijednost projekta stoji u listi i u
// punom pregledu („Pregled projekta"), gdje mu je i mjesto.
//
// Sve izmjene idu kroz callbackove roditelja (ProjectsTab) — modali za unos
// proizvoda i materijala su zajednički s postojećim tokom.
// ════════════════════════════════════════════════════════════════════

import React, { useMemo, useState } from 'react';
import {
    Plus, ArrowLeft, ArrowUpDown, LayoutDashboard, Pencil, Trash2,
    MessageSquareText, ListTodo, Package,
} from 'lucide-react';
import type {
    Project, Product, Material, ProductMaterial, WorkOrder, Offer, WorkLog,
} from '@/lib/types';
import { formatCurrency } from '@/lib/utils';
import { sortProductsByName } from '@/lib/sortProducts';
import { projectProfitBreakdown } from '@/lib/projectProfit';
import { summarizeProjectNotes } from '@/lib/productNotes';
import MobileProductDetail from './MobileProductDetail';
import {
    MLarge, MSearch, MChips, MSection, MList, MItem, MCell, MText, MValue,
    MPill, MAvatar, MEmpty, MButton, MSheet, MOption,
} from './MobileUI';
import { useMobileSort, sortLabel, type SortKey, type GroupKey } from './useMobileSort';
import './MobileUI.css';
import './MobileWorkOrderDetail.css';

interface MobileProjectsViewProps {
    projects: Project[];
    materials: Material[];
    workOrders: WorkOrder[];
    offers?: Offer[];
    workLogs?: WorkLog[];
    onRefresh: (...collections: string[]) => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
    onNavigateToTasks?: (projectId: string) => void;

    onOpenProjectModal: (project?: Project) => void;
    onDeleteProject: (projectId: string) => void;

    onOpenProductModal: (projectId: string, product?: Product) => void;
    onDeleteProduct: (productId: string) => void;
    /** Pitanja/napomene — bez productId = sva pitanja projekta, s productId = skrol na proizvod. */
    onOpenNotes?: (projectId: string, productId?: string) => void;
    onOpenMaterialModal: (productId: string) => void;
    onDeleteMaterial: (materialId: string) => void;
    onEditMaterial: (material: ProductMaterial) => void;
    onEditGlass: (productId: string, material: ProductMaterial) => void;
    onEditAluDoor: (productId: string, material: ProductMaterial) => void;
    onUpdateMaterial: (materialId: string, updates: { Quantity: number; Unit_Price: number; Total_Price: number }) => Promise<void>;
    onToggleHidden?: (project: Project) => void;
    /** Otvara puni pregled projekta (full-screen overlay). */
    onOpenOverview?: (project: Project) => void;
    /** Krojenje ploča za proizvod (CutlistModal). */
    onOpenCutlist?: (product: Product) => void;
}

const statusTone = (s?: string) =>
    s === 'Završeno' ? 'gray'
        : s === 'U proizvodnji' ? 'blue'
            : s === 'Odobreno' ? 'green'
                : s === 'Ponuđeno' ? 'orange' : 'gray';

const productTone = (s?: string) =>
    s === 'Završeno' || s === 'Spremno' ? 'green'
        : s === 'U proizvodnji' ? 'blue'
            : s === 'U montaži' ? 'purple' : 'gray';

/** Inicijali za avatar (najviše dva slova). */
const initials = (name: string) =>
    name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '—';

export default function MobileProjectsView({
    projects, workOrders, workLogs = [],
    onNavigateToTasks, onOpenProjectModal, onDeleteProject,
    onOpenProductModal, onDeleteProduct, onOpenNotes,
    onOpenMaterialModal, onDeleteMaterial, onEditMaterial,
    onToggleHidden, onOpenOverview, onOpenCutlist,
}: MobileProjectsViewProps) {
    const [search, setSearch] = useState('');
    const [status, setStatus] = useState('');
    const [openProjectId, setOpenProjectId] = useState<string | null>(null);
    const [openProductId, setOpenProductId] = useState<string | null>(null);
    const sort = useMobileSort('projekti', 'datum');

    const counts = useMemo(() => {
        const c: Record<string, number> = {};
        for (const p of projects) c[p.Status] = (c[p.Status] || 0) + 1;
        return c;
    }, [projects]);

    // Vrijednost projekta — ISTA formula kao desktop (lib/projectProfit).
    // Keširano po projektu: lista može imati desetine redova.
    const revenueOf = useMemo(() => {
        const cache = new Map<string, number>();
        return (projectId: string) => {
            const hit = cache.get(projectId);
            if (hit !== undefined) return hit;
            const fin = projectProfitBreakdown({ projectId, workOrders, workLogs });
            cache.set(projectId, fin.revenue);
            return fin.revenue;
        };
    }, [workOrders, workLogs]);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        const list = projects.filter(p => {
            const matchQ = !q
                || p.Name?.toLowerCase().includes(q)
                || p.Client_Name?.toLowerCase().includes(q);
            return matchQ && (!status || p.Status === status);
        });
        return sort.apply(list, {
            naziv: p => (p.Name || p.Client_Name || '').toLowerCase(),
            datum: p => -(p.Created_Date ? new Date(p.Created_Date).getTime() : 0),
            vrijednost: p => -revenueOf(p.Project_ID),
            rok: p => (p.Deadline ? new Date(p.Deadline).getTime() : Number.MAX_SAFE_INTEGER),
            status: p => p.Status,
        });
    }, [projects, search, status, sort, revenueOf]);

    const groups = useMemo(() => sort.group(filtered, {
        status: p => p.Status,
        klijent: p => p.Client_Name || 'Bez klijenta',
    }), [filtered, sort]);

    // Svjež projekt/proizvod iz propsa — prikaz prati upis nakon onRefresh.
    const openProject = openProjectId ? projects.find(p => p.Project_ID === openProjectId) : null;
    const openProduct = openProject && openProductId
        ? (openProject.products || []).find(p => p.Product_ID === openProductId)
        : null;

    // ── Ekran 3: detalj proizvoda ───────────────────────────────────
    if (openProject && openProduct) {
        return (
            <MobileProductDetail
                project={openProject}
                product={openProduct}
                onClose={() => setOpenProductId(null)}
                onEditProduct={(projectId, product) => onOpenProductModal(projectId, product)}
                onDeleteProduct={onDeleteProduct}
                onAddMaterial={onOpenMaterialModal}
                onEditMaterial={(_productId, material) => onEditMaterial(material)}
                onDeleteMaterial={onDeleteMaterial}
                onOpenNotes={onOpenNotes}
                onOpenCutlist={onOpenCutlist}
            />
        );
    }

    // ── Ekran 2: proizvodi projekta ─────────────────────────────────
    if (openProject) {
        const products = sortProductsByName(openProject.products || [], p => p.Name);
        const notes = summarizeProjectNotes(openProject.products || []);
        return (
            <div className="mui">
                <header className="mwd-nav mui-subnav">
                    <button type="button" className="mwd-back" onClick={() => setOpenProjectId(null)}>
                        <ArrowLeft size={21} strokeWidth={2.3} /> Projekti
                    </button>
                    <div className="mwd-nav-actions">
                        <button type="button" className="mwd-navbtn" onClick={() => onOpenProjectModal(openProject)} aria-label="Uredi projekat">
                            <Pencil size={18} />
                        </button>
                        <button type="button" className="mwd-navbtn danger"
                            onClick={() => { onDeleteProject(openProject.Project_ID); setOpenProjectId(null); }} aria-label="Obriši projekat">
                            <Trash2 size={19} />
                        </button>
                    </div>
                </header>

                <MLarge title={openProject.Name || openProject.Client_Name}>
                    <MPill tone={statusTone(openProject.Status)}>{openProject.Status}</MPill>
                    <span>
                        {openProject.Name ? `${openProject.Client_Name} · ` : ''}
                        {products.length} {products.length === 1 ? 'proizvod' : 'proizvoda'}
                    </span>
                </MLarge>

                {onOpenOverview && (
                    <MButton variant="filled" onClick={() => onOpenOverview(openProject)}>
                        <LayoutDashboard size={19} /> Pregled projekta
                    </MButton>
                )}

                <MSection
                    title="Proizvodi"
                    action="+ Dodaj"
                    onAction={() => onOpenProductModal(openProject.Project_ID)}
                />
                {products.length === 0 ? (
                    <MEmpty title="Nema proizvoda" sub="Dodaj prvi proizvod u ovaj projekat.">
                        <div style={{ width: '100%', paddingTop: 14 }}>
                            <MButton variant="filled" onClick={() => onOpenProductModal(openProject.Project_ID)}>
                                <Plus size={19} /> Dodaj proizvod
                            </MButton>
                        </div>
                    </MEmpty>
                ) : (
                    <MList lead>
                        {products.map(product => {
                            const mats = product.materials || [];
                            // „Fali" = nije ni naručeno ni na stanju/primljeno.
                            const need = mats.filter(m =>
                                m.Status !== 'Primljeno' && m.Status !== 'Na stanju' && m.Status !== 'Naručeno'
                            ).length;
                            return (
                                <MItem key={product.Product_ID}>
                                    <MCell onClick={() => setOpenProductId(product.Product_ID)} chevron>
                                        <MAvatar tone={productTone(product.Status)}><Package size={17} /></MAvatar>
                                        <MText
                                            title={product.Name}
                                            sub={<>
                                                <MPill tone={productTone(product.Status)}>{product.Status || 'Na čekanju'}</MPill>
                                                <span>×{product.Quantity || 1} · {mats.length} {mats.length === 1 ? 'materijal' : 'materijala'}</span>
                                            </>}
                                        />
                                        {need > 0 && <MPill tone="red">{need} fali</MPill>}
                                    </MCell>
                                </MItem>
                            );
                        })}
                    </MList>
                )}

                <div className="mui-stack mui-gap10 mui-pt14">
                    {onOpenNotes && (
                        <MButton variant="tinted" onClick={() => onOpenNotes(openProject.Project_ID)}>
                            <MessageSquareText size={19} />
                            Pitanja i napomene{notes.total > 0 ? ` · ${notes.total}` : ''}
                        </MButton>
                    )}
                    {onNavigateToTasks && (
                        <MButton variant="tinted" onClick={() => onNavigateToTasks(openProject.Project_ID)}>
                            <ListTodo size={19} /> Zadaci projekta
                        </MButton>
                    )}
                    {onToggleHidden && (
                        <MButton variant="tinted" onClick={() => onToggleHidden(openProject)}>
                            {openProject.Hidden ? 'Vrati iz arhive' : 'Arhiviraj projekat'}
                        </MButton>
                    )}
                </div>
            </div>
        );
    }

    // ── Ekran 1: lista projekata ────────────────────────────────────
    const renderProject = (project: Project) => {
        const products = project.products || [];
        const revenue = revenueOf(project.Project_ID);
        return (
            <MItem key={project.Project_ID}>
                <MCell onClick={() => setOpenProjectId(project.Project_ID)} chevron>
                    <MAvatar tone={statusTone(project.Status)}>{initials(project.Name || project.Client_Name)}</MAvatar>
                    <MText
                        title={project.Name || project.Client_Name}
                        sub={<>
                            <MPill tone={statusTone(project.Status)}>{project.Status}</MPill>
                            <span>
                                {project.Name ? `${project.Client_Name} · ` : ''}
                                {products.length} {products.length === 1 ? 'proizvod' : 'proizvoda'}
                            </span>
                        </>}
                    />
                    {revenue > 0 && <MValue strong>{formatCurrency(revenue)}</MValue>}
                </MCell>
            </MItem>
        );
    };

    return (
        <div className="mui">
            <MLarge title="Projekti">
                {projects.length} {projects.length === 1 ? 'projekat' : 'projekata'}
                {counts['U proizvodnji'] ? ` · ${counts['U proizvodnji']} u proizvodnji` : ''}
            </MLarge>

            <div className="mui-stack mui-gap10" style={{ paddingBottom: 4 }}>
                <MSearch value={search} onChange={setSearch} placeholder="Traži projekat ili klijenta…" />
                <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" className="mui-chip" onClick={sort.open}>
                        <ArrowUpDown size={13} style={{ verticalAlign: -2, marginRight: 5 }} />
                        {sortLabel(sort.sortKey, sort.groupKey)}
                    </button>
                    <div className="mui-spacer" />
                    <button type="button" className="mui-chip on" onClick={() => onOpenProjectModal()}>
                        <Plus size={14} style={{ verticalAlign: -2, marginRight: 4 }} />Novi
                    </button>
                </div>
            </div>

            <MChips
                value={status}
                onChange={setStatus}
                options={[
                    { id: '', label: 'Svi', count: projects.length },
                    ...Object.keys(counts).map(s => ({ id: s, label: s, count: counts[s] })),
                ]}
            />

            {filtered.length === 0 ? (
                <MEmpty
                    title="Nema projekata"
                    sub={search || status ? 'Promijeni pretragu ili filter.' : 'Kreiraj prvi projekat.'}
                >
                    {!search && !status && (
                        <div style={{ width: '100%', paddingTop: 14 }}>
                            <MButton variant="filled" onClick={() => onOpenProjectModal()}>
                                <Plus size={19} /> Novi projekat
                            </MButton>
                        </div>
                    )}
                </MEmpty>
            ) : groups ? (
                groups.map(g => (
                    <div key={g.key}>
                        <MSection title={g.key} right={<span className="mui-dim">{g.rows.length}</span>} />
                        <MList lead>{g.rows.map(renderProject)}</MList>
                    </div>
                ))
            ) : (
                <MList lead>{filtered.map(renderProject)}</MList>
            )}

            <MSheet open={sort.isOpen} title="Sortiraj i grupiši" onClose={sort.close}>
                <div className="mui-shd"><span>Sortiraj po</span></div>
                <MList>
                    {(['naziv', 'datum', 'vrijednost', 'rok', 'status'] as SortKey[]).map(k => (
                        <MOption key={k} label={sortLabel(k)} selected={sort.sortKey === k} onClick={() => sort.setSortKey(k)} />
                    ))}
                </MList>
                <div className="mui-shd"><span>Grupiši po</span></div>
                <MList>
                    {([null, 'status', 'klijent'] as (GroupKey | null)[]).map(k => (
                        <MOption key={k || 'none'} label={k ? sortLabel(undefined, k) : 'Bez grupisanja'}
                            selected={sort.groupKey === k} onClick={() => sort.setGroupKey(k)} />
                    ))}
                </MList>
            </MSheet>
        </div>
    );
}
