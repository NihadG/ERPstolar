'use client';

// ════════════════════════════════════════════════════════════════════
// PROJEKTI I PROIZVODI — pregled
//
// Tri nivoa, isti obrazac kao vlasnikov MobileProjectsView: lista → proizvodi
// → detalj proizvoda. Nivoi 1 i 2 su u tabu (`.mui-subnav`), detalj je vlastiti
// ekran — poniranje bez mreže, jer sve stiže u jednom zahtjevu.
//
// Bez cijena i bez kontakta klijenta. Ono što je ovdje NOVO u odnosu na
// vlasnikov mobilni prikaz: oznaka ESENCIJALNOG materijala. Upravo ona blokira
// pokretanje naloga, a nijedan mobilni ekran je do sada nije prikazivao.
// ════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, FolderOpen, Package } from 'lucide-react';
import { apiGet } from '@/lib/apiClient';
import type { FieldProductDetail, FieldProjectDetail } from '@/lib/field/fieldProjects';
import {
    MLarge, MSearch, MCard, MCardHead, MCardBody, MIcon, MAvatar, MPill,
    MProgress, MEmpty, MButton, MSection, MList, MItem, MCell, MText, MDot, MSegmented,
} from '@/components/tabs/mobile/MobileUI';
import { useOverlayGuard } from '@/components/tabs/mobile/overlayGuard';
import { useSwipeBack } from '@/components/tabs/mobile/useSwipe';

const initials = (name: string) =>
    name.split(' ').filter(Boolean).map(p => p[0]).join('').toUpperCase().slice(0, 2) || '?';

const shortDate = (iso: string | null) =>
    iso ? new Date(iso + 'T12:00:00').toLocaleDateString('bs-BA', { day: 'numeric', month: 'short' }) : null;

const matTone = (status: string): 'green' | 'orange' | 'red' =>
    status === 'Primljeno' || status === 'Na stanju' ? 'green' : status === 'Naručeno' ? 'orange' : 'red';

const matDot = (status: string): 'rdy' | 'ord' | 'need' =>
    status === 'Primljeno' || status === 'Na stanju' ? 'rdy' : status === 'Naručeno' ? 'ord' : 'need';

export default function ProjectsScreen() {
    const [projects, setProjects] = useState<FieldProjectDetail[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [openProjectId, setOpenProjectId] = useState<string | null>(null);
    const [openProductId, setOpenProductId] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await apiGet<{ projects: FieldProjectDetail[] }>('/api/field/projects');
            setProjects(res.projects);
        } catch (e: any) {
            setError(e?.message || 'Učitavanje nije uspjelo.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const openProject = openProjectId ? projects.find(p => p.projectId === openProjectId) : null;
    const openProduct = openProject && openProductId
        ? openProject.products.find(p => p.productId === openProductId)
        : null;

    // Nivo 2 nije portal, pa mu treba vlastiti swipe; nivo 3 ima svoj.
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
            <ProductDetail
                product={openProduct}
                onClose={() => setOpenProductId(null)}
            />
        );
    }

    // ── Nivo 2: proizvodi projekta ───────────────────────────────────
    if (openProject) {
        return (
            <div ref={level2Ref}>
                <header className="mwd-nav mui-subnav">
                    <button type="button" className="mwd-back" onClick={() => setOpenProjectId(null)}>
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

                {openProject.products.length === 0 ? (
                    <MEmpty title="Nema proizvoda" sub="Projekat još nema unesene proizvode." />
                ) : (
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
                )}

                {openProject.notes && (
                    <>
                        <MSection title="Napomena" />
                        <p className="fod-hint">{openProject.notes}</p>
                    </>
                )}
            </div>
        );
    }

    // ── Nivo 1: lista projekata ──────────────────────────────────────
    return (
        <>
            <MLarge title="Projekti">
                {projects.length} {projects.length === 1 ? 'aktivan projekat' : 'aktivnih projekata'}
            </MLarge>

            <div className="fld-search">
                <MSearch value={search} onChange={setSearch} placeholder="Traži projekat ili adresu…" />
            </div>

            {loading && projects.length === 0 && <div className="fld-loading">Učitavanje…</div>}

            {error && (
                <MEmpty title="Podaci nisu učitani" sub={error}>
                    <div style={{ width: '100%', paddingTop: 14 }}>
                        <MButton variant="filled" onClick={load}>Pokušaj ponovo</MButton>
                    </div>
                </MEmpty>
            )}

            {!loading && !error && filtered.length === 0 && (
                <MEmpty
                    title="Nema projekata"
                    sub={search ? 'Promijeni pretragu.' : 'Nema projekata u proizvodnji.'}
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
                                        <span>{p.address || `${p.productCount} proizvoda`}</span>
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

// ════════════════════════════════════════════════════════════════════
// DETALJ PROIZVODA
// ════════════════════════════════════════════════════════════════════

function ProductDetail({ product, onClose }: { product: FieldProductDetail; onClose: () => void }) {
    const [tab, setTab] = useState<'materijali' | 'procesi'>('materijali');

    useEffect(() => {
        window.history.pushState({ fieldProduct: true }, '');
        const onPop = () => onClose();
        window.addEventListener('popstate', onPop);
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            window.removeEventListener('popstate', onPop);
            document.body.style.overflow = prev;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const goBack = () => window.history.back();
    useOverlayGuard(true);
    const swipeRef = useSwipeBack(goBack);

    return (
        <div className="mui fod" ref={swipeRef}>
            <header className="mwd-nav mui-subnav">
                <button type="button" className="mwd-back" onClick={goBack}>
                    <ArrowLeft size={21} strokeWidth={2.3} /> {product.projectName}
                </button>
            </header>

            <div className="mui-large">
                <h1>{product.name}</h1>
                <p>
                    <MPill tone="gray">{product.status}</MPill>
                    <span>×{product.quantity}{product.dimensions ? ` · ${product.dimensions}` : ''}</span>
                </p>
            </div>

            {product.essentialMissing > 0 && (
                <div className="fld-notice">
                    <AlertTriangle size={17} />
                    <span>
                        <b>{product.essentialMissing}</b> ključn{product.essentialMissing === 1 ? 'i materijal' : 'a materijala'} još
                        nije spremn{product.essentialMissing === 1 ? '' : 'a'} — nalog se ne može pokrenuti dok ne stigne.
                    </span>
                </div>
            )}

            <div className="fld-seg">
                <MSegmented<'materijali' | 'procesi'>
                    value={tab}
                    onChange={setTab}
                    options={[
                        { id: 'materijali', label: `Materijali ${product.materialsTotal}` },
                        { id: 'procesi', label: `Procesi ${product.processes.length}` },
                    ]}
                />
            </div>

            {tab === 'materijali' && (
                product.materials.length === 0 ? (
                    <MEmpty title="Nema materijala" sub="Proizvod još nema unesenu sastavnicu." />
                ) : (
                    <MList lead>
                        {product.materials.map(m => (
                            <MItem key={m.materialId}>
                                <MCell>
                                    <MDot kind={matDot(m.status)} />
                                    <MText
                                        title={m.name}
                                        sub={<>
                                            <MPill tone={matTone(m.status)}>{m.status}</MPill>
                                            {m.isEssential && <MPill tone="red">ključno</MPill>}
                                            <span>{m.quantity} {m.unit}{m.supplier ? ` · ${m.supplier}` : ''}</span>
                                        </>}
                                    />
                                </MCell>
                            </MItem>
                        ))}
                    </MList>
                )
            )}

            {tab === 'procesi' && (
                product.processes.length === 0 ? (
                    <MEmpty title="Nema plana procesa" sub="Proizvod još nema definisan tok." />
                ) : (
                    <>
                        <MList>
                            {product.processes.map((p, i) => (
                                <MItem key={`${p}-${i}`}>
                                    <MCell><MText title={p} sub={`korak ${i + 1}`} /></MCell>
                                </MItem>
                            ))}
                        </MList>
                        <p className="fod-hint">Procesi se čekiraju na nalogu, u tabu Tok.</p>
                    </>
                )
            )}

            {product.notes && (
                <>
                    <MSection title="Napomena" />
                    <p className="fod-hint">{product.notes}</p>
                </>
            )}
        </div>
    );
}
