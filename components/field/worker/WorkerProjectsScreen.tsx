'use client';

// ════════════════════════════════════════════════════════════════════
// RADNIK — PROJEKTI
//
// Samo projekti u kojima radnik ima proizvod, i unutar njih samo ti proizvodi
// (dogovor: radnik vidi svoje). Tri nivoa: lista → proizvodi → detalj. Podaci
// stižu s WorkerApp-a (jedan dohvat dijeljen s tabom Nalozi), pa poniranje ne
// ide na mrežu.
// ════════════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import { ArrowLeft, Package } from 'lucide-react';
import type { FieldProjectDetail } from '@/lib/field/fieldProjects';
import {
    MLarge, MSearch, MCard, MCardHead, MCardBody, MIcon, MAvatar, MPill,
    MProgress, MEmpty, MButton, MSection,
} from '@/components/tabs/mobile/MobileUI';
import { useOverlayGuard } from '@/components/tabs/mobile/overlayGuard';
import { useSwipeBack } from '@/components/tabs/mobile/useSwipe';
import WorkerProductDetail from './WorkerProductDetail';

const initials = (name: string) =>
    name.split(' ').filter(Boolean).map(p => p[0]).join('').toUpperCase().slice(0, 2) || '?';

const shortDate = (iso: string | null) =>
    iso ? new Date(iso + 'T12:00:00').toLocaleDateString('bs-BA', { day: 'numeric', month: 'short' }) : null;

import type { ShowToast } from './WorkerApp';

interface Props {
    projects: FieldProjectDetail[];
    loading: boolean;
    error: string | null;
    reload: () => void;
    previewUid?: string | null;
    showToast: ShowToast;
}

export default function WorkerProjectsScreen({ projects, loading, error, reload, previewUid, showToast }: Props) {
    const [search, setSearch] = useState('');
    const [openProjectId, setOpenProjectId] = useState<string | null>(null);
    const [openProductId, setOpenProductId] = useState<string | null>(null);

    const openProject = openProjectId ? projects.find(p => p.projectId === openProjectId) : null;
    const openProduct = openProject && openProductId
        ? openProject.products.find(p => p.productId === openProductId)
        : null;

    const level2Ref = useSwipeBack(() => setOpenProjectId(null), {
        enabled: !!openProjectId && !openProductId,
    });
    useOverlayGuard(!!openProjectId && !openProductId);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return projects.filter(p => !q || p.name.toLowerCase().includes(q) || p.address.toLowerCase().includes(q));
    }, [projects, search]);

    // ── Nivo 3: proizvod ─────────────────────────────────────────────
    if (openProject && openProduct) {
        return (
            <WorkerProductDetail
                product={openProduct}
                backLabel={openProject.name}
                previewUid={previewUid}
                showToast={showToast}
                onClose={() => setOpenProductId(null)}
            />
        );
    }

    // ── Nivo 2: proizvodi projekta ───────────────────────────────────
    if (openProject) {
        return (
            <div ref={level2Ref}>
                <header className="fwk-nav">
                    <button type="button" className="fwk-back" onClick={() => setOpenProjectId(null)}>
                        <ArrowLeft size={21} strokeWidth={2.3} /> Projekti
                    </button>
                </header>

                <div className="mui-large">
                    <h1>{openProject.name}</h1>
                    <p>
                        <MPill tone="blue">{openProject.status}</MPill>
                        <span>
                            {openProject.address || `${openProject.productCount} proizvoda`}
                            {openProject.deadline && ` · rok ${shortDate(openProject.deadline)}`}
                        </span>
                    </p>
                </div>

                <div className="mui-elist">
                    {openProject.products.map(prod => (
                        <MCard key={prod.productId} onClick={() => setOpenProductId(prod.productId)}>
                            <MCardHead>
                                <MIcon tone={prod.essentialMissing > 0 ? 'red' : prod.materialsReady === prod.materialsTotal ? 'green' : 'orange'}>
                                    <Package size={20} />
                                </MIcon>
                                <MCardBody
                                    name={prod.name}
                                    meta={<>
                                        <MPill tone="gray">{prod.status}</MPill>
                                        <span>×{prod.quantity}{prod.dimensions ? ` · ${prod.dimensions}` : ''}</span>
                                    </>}
                                />
                                {prod.essentialMissing > 0 && (
                                    <MPill tone="red">{prod.essentialMissing} ključno fali</MPill>
                                )}
                            </MCardHead>

                            {prod.materialsTotal > 0 && (
                                <MProgress
                                    pct={Math.round((prod.materialsReady / prod.materialsTotal) * 100)}
                                    tone={prod.materialsReady === prod.materialsTotal ? 'green' : 'orange'}
                                    label={<><b>{prod.materialsReady}/{prod.materialsTotal}</b> materijala spremno</>}
                                />
                            )}
                        </MCard>
                    ))}
                </div>

                {openProject.notes && (
                    <>
                        <MSection title="Napomena" />
                        <p className="fwk-hint">{openProject.notes}</p>
                    </>
                )}
            </div>
        );
    }

    // ── Nivo 1: lista projekata ──────────────────────────────────────
    return (
        <>
            <MLarge title="Projekti">
                {projects.length} {projects.length === 1 ? 'projekat' : 'projekata'} s tvojim proizvodima
            </MLarge>

            <div className="fld-search">
                <MSearch value={search} onChange={setSearch} placeholder="Traži projekat ili adresu…" />
            </div>

            {loading && projects.length === 0 && <div className="fld-loading">Učitavanje…</div>}

            {error && (
                <MEmpty title="Podaci nisu učitani" sub={error}>
                    <div style={{ width: '100%', paddingTop: 14 }}>
                        <MButton variant="filled" onClick={reload}>Pokušaj ponovo</MButton>
                    </div>
                </MEmpty>
            )}

            {!loading && !error && filtered.length === 0 && (
                <MEmpty
                    title="Nema projekata"
                    sub={search ? 'Promijeni pretragu.' : 'Kad dobiješ proizvod na nalogu, projekat će se pojaviti ovdje.'}
                />
            )}

            <div className="mui-elist">
                {filtered.map(p => {
                    const due = shortDate(p.deadline);
                    return (
                        <MCard key={p.projectId} onClick={() => setOpenProjectId(p.projectId)}>
                            <MCardHead>
                                <MAvatar tone="blue">{initials(p.name)}</MAvatar>
                                <MCardBody
                                    name={p.name}
                                    meta={<>
                                        <MPill tone="blue">{p.status}</MPill>
                                        <span>{p.address || `${p.productCount} ${p.productCount === 1 ? 'proizvod' : 'proizvoda'}`}</span>
                                    </>}
                                />
                            </MCardHead>
                            {p.productCount > 0 && (
                                <MProgress
                                    pct={Math.round((p.productsReady / p.productCount) * 100)}
                                    tone={p.productsReady === p.productCount ? 'green' : undefined}
                                    label={<>
                                        <b>{p.productsReady}/{p.productCount}</b> spremno
                                        {due && <span> · rok {due}</span>}
                                    </>}
                                />
                            )}
                        </MCard>
                    );
                })}
            </div>
        </>
    );
}
