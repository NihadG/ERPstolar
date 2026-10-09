'use client';

// ════════════════════════════════════════════════════════════════════
// UVOZ PONUDE IZ SKETCHUPA U PROJEKAT
//
// Tri koraka: fajl → pregled povezivanja → jedan klik. Pregled pokazuje šta
// se veže za postojeći katalog, šta se pravi novo (dobavljači → materijali
// → proizvodi → sastavnice) i šta se dešava s proizvodima istog naziva.
// Sva logika je u lib/sketchupImport.ts; ovdje su samo izbori i prikaz.
// ════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Modal from './ui/Modal';
import { SearchableSelect } from './ui/SearchableSelect';
import type { Material, Project, Supplier } from '@/lib/types';
import {
    getMaterialsCatalog, getSuppliers, saveMaterial, saveSupplier, saveProduct,
    addMaterialsToProductBatch, deleteImportedProductMaterials,
} from '@/lib/services';
import {
    parseSketchUpExport, buildImportPlan, defaultChoices, summarizePlan, resolveProductLines, runImport,
    buildErpCatalog, type ImportPlan, type ImportChoices, type ImportResult, type MatchHow,
    type PlannedMaterial, type PlannedProduct, type ProductAction, type SuExport,
} from '@/lib/sketchupImport';
import { formatCurrency } from '@/lib/utils';
import './SketchUpOfferImportModal.css';

/** Preuzmi erp_katalog.json — plugin ga čita iz foldera u kojem je cjenovnik. */
export function downloadErpCatalog(materials: Material[], suppliers: Supplier[]) {
    const data = buildErpCatalog(materials, suppliers);
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'erp_katalog.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

interface Props {
    isOpen: boolean;
    onClose: () => void;
    project: Project | null;
    organizationId: string;
    onImported: () => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
    /** Samo za /sketchup-import-preview: gotov katalog i izvoz, bez baze. */
    demo?: { catalog: Material[]; suppliers: Supplier[]; data?: SuExport };
}

type Step = 'pick' | 'review' | 'running' | 'done';

const HOW: Record<MatchHow | 'rucno' | 'moguce', { label: string; tone: 'ok' | 'warn' | 'new' }> = {
    id: { label: 'iz kataloga', tone: 'ok' },
    naziv: { label: 'po nazivu', tone: 'ok' },
    sifra: { label: 'po šifri dekora', tone: 'ok' },
    slicno: { label: 'prepoznato', tone: 'ok' },
    novi: { label: 'novi materijal', tone: 'new' },
    rucno: { label: 'izabrano ručno', tone: 'ok' },
    moguce: { label: 'možda postoji', tone: 'warn' },
};

const KIND_LABEL: Record<string, string> = { ploca: 'Ploča', obloga: 'Obloga', kant: 'Kant', okov: 'Okov', obrada: 'Obrada', ostalo: 'Ostalo', usluga: 'Usluga' };

const fmtQty = (n: number) => (Math.round(n * 1000) / 1000).toLocaleString('de-DE', { maximumFractionDigits: 3 });
const fmtDims = (p: PlannedProduct) => (p.width || p.height || p.depth) ? `${p.width} × ${p.height} × ${p.depth}` : '—';
const fmtDate = (iso?: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}.`;
};
/** 1 stavka, 2–4 stavke, 5+ stavki (11–14 stavki). */
const plural = (n: number, one: string, few: string, many: string) => {
    const t = n % 100, u = n % 10;
    if (t >= 11 && t <= 14) return many;
    return u === 1 ? one : u >= 2 && u <= 4 ? few : many;
};

export default function SketchUpOfferImportModal({ isOpen, onClose, project, organizationId, onImported, showToast, demo }: Props) {
    const [step, setStep] = useState<Step>('pick');
    const [fileName, setFileName] = useState('');
    const [error, setError] = useState('');
    const [dragOver, setDragOver] = useState(false);
    const [exp, setExp] = useState<SuExport | null>(null);
    const [catalog, setCatalog] = useState<Material[]>([]);
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [loadingDb, setLoadingDb] = useState(false);
    const [choices, setChoices] = useState<ImportChoices>({ materials: {}, products: {} });
    const [touched, setTouched] = useState<Set<string>>(new Set());
    const [newNames, setNewNames] = useState<Record<string, string>>({});
    const [renaming, setRenaming] = useState<string | null>(null);
    const [progress, setProgress] = useState({ label: '', done: 0, total: 1 });
    const [result, setResult] = useState<ImportResult | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);

    // Svježi katalog i dobavljači pri svakom otvaranju — dobavljači možda još
    // nisu učitani u aplikaciji, a bez njih bi se napravili duplikati.
    useEffect(() => {
        if (!isOpen) return;
        if (demo) {
            setCatalog(demo.catalog);
            setSuppliers(demo.suppliers);
            if (demo.data) { setExp(demo.data); setFileName('demo.erp.json'); setStep('review'); }
            return;
        }
        if (!organizationId) return;
        let alive = true;
        setLoadingDb(true);
        Promise.all([getMaterialsCatalog(organizationId), getSuppliers(organizationId)])
            .then(([m, s]) => { if (alive) { setCatalog(m); setSuppliers(s); } })
            .catch(() => { if (alive) setError('Katalog materijala se ne može učitati. Pokušaj ponovo.'); })
            .finally(() => { if (alive) setLoadingDb(false); });
        return () => { alive = false; };
    }, [isOpen, organizationId, demo]);

    const plan: ImportPlan | null = useMemo(
        () => (exp ? buildImportPlan(exp, catalog, suppliers, project?.products || []) : null),
        [exp, catalog, suppliers, project],
    );

    useEffect(() => {
        if (!plan) return;
        setChoices(defaultChoices(plan));
        setTouched(new Set());
        setNewNames({});
    }, [plan]);

    const summary = useMemo(
        () => (plan ? summarizePlan(plan, choices, catalog, suppliers) : null),
        [plan, choices, catalog, suppliers],
    );

    const reset = useCallback(() => {
        setStep('pick'); setFileName(''); setError(''); setExp(null); setResult(null);
        setChoices({ materials: {}, products: {} }); setTouched(new Set()); setNewNames({});
    }, []);

    const close = () => {
        if (step === 'running') return;
        reset();
        onClose();
    };

    async function readFile(file: File) {
        setError('');
        setFileName(file.name);
        const text = await file.text();
        const { data, error: err } = parseSketchUpExport(text);
        if (err || !data) { setError(err || 'Fajl se ne može pročitati.'); return; }
        setExp(data);
        setStep('review');
    }

    const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0];
        if (f) readFile(f);
        e.target.value = '';
    };
    const onDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) readFile(f);
    };

    const setMaterialChoice = (key: string, value: string) => {
        setChoices(c => ({ ...c, materials: { ...c.materials, [key]: value } }));
        setTouched(t => new Set(t).add(key));
    };
    const setProductChoice = (key: string, value: ProductAction) => {
        setChoices(c => ({ ...c, products: { ...c.products, [key]: value } }));
    };

    // Opcije za izbor: novi materijal, prijedlozi, pa ostatak kataloga iste kategorije prvo.
    const optionsFor = useCallback((m: PlannedMaterial) => {
        const name = newNames[m.key] ?? m.name;
        const sub = (x: Material) => [x.Unit, x.Default_Unit_Price ? formatCurrency(x.Default_Unit_Price) : '', x.Default_Supplier]
            .filter(Boolean).join(' · ');
        const seen = new Set<string>();
        const opts: { value: string; label: string; subLabel?: string; badge?: { text: string; tone?: 'active' | 'neutral' } }[] = [
            { value: 'new', label: `Novi materijal: ${name}`, subLabel: `${m.category} · ${m.unit}`, badge: { text: 'novi', tone: 'neutral' } },
        ];
        for (const c of m.candidates) {
            seen.add(c.Material_ID);
            opts.push({ value: c.Material_ID, label: c.Name, subLabel: sub(c), badge: { text: 'prijedlog', tone: 'active' } });
        }
        const rest = catalog
            .filter(c => !seen.has(c.Material_ID))
            .sort((a, b) => Number(b.Category === m.category) - Number(a.Category === m.category) || a.Name.localeCompare(b.Name, 'bs'));
        for (const c of rest) opts.push({ value: c.Material_ID, label: c.Name, subLabel: sub(c) });
        return opts;
    }, [catalog, newNames]);

    async function doImport() {
        if (!plan || !project) return;
        setStep('running');
        const named: ImportPlan = {
            ...plan,
            materials: plan.materials.map(m => (newNames[m.key]?.trim() ? { ...m, name: newNames[m.key].trim() } : m)),
        };
        const src = plan.source;
        const note = `Uvezeno iz SketchUpa${src.model ? ` (${src.model})` : ''} ${fmtDate(new Date().toISOString())}.`;
        // Maketa (/sketchup-import-preview) ne dira bazu.
        const fake = async <K extends string>(key: K) => {
            await new Promise(r => setTimeout(r, 120));
            return { success: true, data: { [key]: `demo-${Math.random().toString(36).slice(2, 8)}` } as Record<K, string>, message: '' };
        };
        try {
            const res = await runImport(named, choices, { projectId: project.Project_ID, catalog, suppliers, note }, demo ? {
                saveSupplier: () => fake('Supplier_ID'),
                saveMaterial: () => fake('Material_ID'),
                saveProduct: d => fake('Product_ID').then(r => (d.Product_ID ? { ...r, data: { Product_ID: d.Product_ID } } : r)),
                addProductMaterials: async () => ({ success: true, message: '' }),
                deleteImportedProductMaterials: async () => undefined,
            } : {
                saveSupplier: d => saveSupplier(d, organizationId),
                saveMaterial: d => saveMaterial(d, organizationId),
                saveProduct: d => saveProduct(d, organizationId),
                addProductMaterials: (pid, items) => addMaterialsToProductBatch(pid, items, organizationId),
                deleteImportedProductMaterials: pid => deleteImportedProductMaterials(pid, organizationId),
            }, (label, done, total) => setProgress({ label, done, total }));
            setResult(res);
            setStep('done');
            onImported();
            const made = res.productsCreated + res.productsReplaced;
            showToast(res.errors.length ? `Uvoz završen uz ${res.errors.length} grešaka` : `Uvezeno ${made} proizvoda iz SketchUpa`, res.errors.length ? 'error' : 'success');
        } catch (e) {
            console.error('SketchUp import error:', e);
            setResult({ suppliersCreated: 0, materialsCreated: 0, productsCreated: 0, productsReplaced: 0, linesWritten: 0, errors: ['Uvoz je prekinut — provjeri vezu i pokušaj ponovo.'] });
            setStep('done');
        }
    }

    const activeCount = summary ? summary.productsNew + summary.productsReplace : 0;
    const usedMaterialKeys = useMemo(() => {
        const s = new Set<string>();
        plan?.products.forEach(p => { if ((choices.products[p.key] || 'new') !== 'skip') p.lines.forEach(l => s.add(l.materialKey)); });
        return s;
    }, [plan, choices]);

    // Materijali koji traže pažnju idu prvi: sličan → novi → povezani.
    const orderedMaterials = useMemo(() => {
        if (!plan) return [];
        const rank = (m: PlannedMaterial) => {
            const ch = choices.materials[m.key] || 'new';
            if (touched.has(m.key)) return 3;
            if (ch === 'new' && m.suggestion) return 0;
            if (ch === 'new') return 1;
            return 2;
        };
        return [...plan.materials].sort((a, b) => rank(a) - rank(b) || a.vrsta.localeCompare(b.vrsta) || a.name.localeCompare(b.name, 'bs'));
    }, [plan, choices, touched]);

    // Dvije grupe: šta treba potvrditi (novo / možda postoji) i šta je već u katalogu.
    const matGroups = useMemo(() => {
        const review = orderedMaterials.filter(m => (choices.materials[m.key] || 'new') === 'new');
        const linked = orderedMaterials.filter(m => (choices.materials[m.key] || 'new') !== 'new');
        return [
            { id: 'review', label: 'Za provjeru', items: review },
            { id: 'linked', label: 'Povezano s katalogom', items: linked },
        ];
    }, [orderedMaterials, choices]);

    const title = (
        <span className="sui-title">
            <span className="material-icons-round">view_in_ar</span>
            Uvoz iz SketchUpa{project ? <span className="sui-title-sub">u projekat {project.Name || project.Client_Name}</span> : null}
        </span>
    );

    const footer = step === 'review' && summary ? (
        <div className="sui-footer">
            <span className="sui-footer-note">
                {plan!.skippedServices > 0 && <>Usluge iz ponude se ne uvoze ({plan!.skippedServices} {plural(plan!.skippedServices, 'stavka', 'stavke', 'stavki')}). </>}
                {summary.unitMismatches > 0 && <>{summary.unitMismatches} {plural(summary.unitMismatches, 'stavka ostaje', 'stavke ostaju', 'stavki ostaje')} u jedinici ponude.</>}
            </span>
            <button className="btn btn-secondary" onClick={close}>Odustani</button>
            <button className="btn btn-primary" onClick={doImport} disabled={activeCount === 0 || loadingDb}>
                <span className="material-icons-round">download_done</span>
                {activeCount === 0 ? 'Ništa za uvoz' : `Uvezi ${activeCount} ${plural(activeCount, 'proizvod', 'proizvoda', 'proizvoda')}`}
            </button>
        </div>
    ) : step === 'done' ? (
        <div className="sui-footer">
            <span className="sui-footer-note" />
            <button className="btn btn-secondary" onClick={reset}>Uvezi drugi fajl</button>
            <button className="btn btn-primary" onClick={close}>Zatvori</button>
        </div>
    ) : undefined;

    return (
        <Modal isOpen={isOpen} onClose={close} title={title} footer={footer} size="large" className="sui-modal">
            {step === 'pick' && (
                <div className="sui-pick">
                    <div
                        className={`sui-drop${dragOver ? ' over' : ''}`}
                        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                        onDragLeave={() => setDragOver(false)}
                        onDrop={onDrop}
                        onClick={() => fileRef.current?.click()}
                        role="button"
                        tabIndex={0}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click(); }}
                    >
                        <span className="material-icons-round sui-drop-icon">upload_file</span>
                        <strong>Prevuci fajl iz SketchUpa ovdje</strong>
                        <span>ili klikni i izaberi <code>.erp.json</code></span>
                        <input ref={fileRef} type="file" accept=".json,application/json" onChange={onPick} hidden />
                    </div>
                    {error && <div className="sui-error"><span className="material-icons-round">error_outline</span>{error}{fileName ? <em> ({fileName})</em> : null}</div>}

                    <ol className="sui-steps">
                        <li><b>SketchUp</b> — Component Manager → Cutlist → <b>Ponuda</b> → <b>Izvoz za ERP</b></li>
                        <li><b>Ovdje</b> — izaberi taj fajl i provjeri kako su materijali povezani s katalogom</li>
                        <li><b>Uvezi</b> — prave se dobavljači, materijali, proizvodi i njihove sastavnice</li>
                    </ol>

                    <div className="sui-catalog">
                        <span className="material-icons-round">sync_alt</span>
                        <div>
                            <b>Katalog za SketchUp</b>
                            <span>Sačuvaj <code>erp_katalog.json</code> u folder gdje je Excel cjenovnik — ponuda u pluginu tada prepoznaje materijale i okov iz baze.</span>
                        </div>
                        <button className="btn btn-secondary" disabled={loadingDb || catalog.length === 0} onClick={() => downloadErpCatalog(catalog, suppliers)}>
                            <span className="material-icons-round">download</span>
                            {loadingDb ? 'Učitavam…' : `Preuzmi (${catalog.length})`}
                        </button>
                    </div>
                </div>
            )}

            {step === 'review' && plan && summary && (
                <div className="sui-review">
                    <div className="sui-source">
                        <span className="material-icons-round">description</span>
                        <span className="sui-source-name">{fileName}</span>
                        {plan.source.model && <span className="sui-chip">model {plan.source.model}</span>}
                        {plan.source.cjenovnik && <span className="sui-chip">cjenovnik {plan.source.cjenovnik}</span>}
                        {plan.source.datum && <span className="sui-chip">{fmtDate(plan.source.datum)}</span>}
                        <button className="sui-link" onClick={reset}>Promijeni fajl</button>
                    </div>

                    <div className="sui-stats">
                        <div className="sui-stat">
                            <span className="sui-stat-label">Proizvodi</span>
                            <span className="sui-stat-value">{activeCount}<small> / {summary.products}</small></span>
                            <span className="sui-stat-sub">
                                {[summary.productsNew && `${summary.productsNew} ${plural(summary.productsNew, 'novi', 'nova', 'novih')}`, summary.productsReplace && `${summary.productsReplace} ${plural(summary.productsReplace, 'dopuna', 'dopune', 'dopuna')}`, summary.productsSkip && `${summary.productsSkip} preskočeno`].filter(Boolean).join(' · ') || '—'}
                            </span>
                        </div>
                        <div className="sui-stat">
                            <span className="sui-stat-label">Materijali</span>
                            <span className="sui-stat-value">{summary.materialsLinked + summary.materialsNew}</span>
                            <span className="sui-stat-sub">{summary.materialsLinked} iz kataloga · <b className={summary.materialsNew ? 'is-new' : ''}>{summary.materialsNew} {plural(summary.materialsNew, 'novi', 'nova', 'novih')}</b></span>
                        </div>
                        <div className="sui-stat">
                            <span className="sui-stat-label">Novi dobavljači</span>
                            <span className="sui-stat-value">{summary.suppliersNew.length}</span>
                            <span className="sui-stat-sub">{summary.suppliersNew.length ? summary.suppliersNew.join(', ') : 'svi već postoje'}</span>
                        </div>
                        <div className="sui-stat">
                            <span className="sui-stat-label">Materijal ukupno</span>
                            <span className="sui-stat-value sui-money">{formatCurrency(summary.materialTotal)}</span>
                            <span className="sui-stat-sub">po cijenama iz ponude</span>
                        </div>
                    </div>

                    <section className="sui-section">
                        <header>
                            <h3>Materijali i okov</h3>
                            <span className="sui-hint">Potvrdi stavke „Za provjeru" — povezane su već u katalogu.</span>
                        </header>
                        <div className="sui-table" role="table" aria-label="Materijali i okov">
                            <div className="sui-thead" role="row">
                                <span role="columnheader">Iz ponude</span>
                                <span role="columnheader">U ERP katalogu</span>
                                <span role="columnheader" className="sui-th-status">Status</span>
                            </div>
                            {matGroups.map(gr => gr.items.length > 0 && (
                                <div key={gr.id} role="rowgroup">
                                    <div className={`sui-group sui-group-${gr.id}`}>
                                        <span>{gr.label}</span>
                                        <b>{gr.items.length}</b>
                                    </div>
                                    {gr.items.map(m => {
                                        const choice = choices.materials[m.key] || 'new';
                                        const linked = choice !== 'new' ? catalog.find(c => c.Material_ID === choice) : null;
                                        const suggest = choice === 'new' && !touched.has(m.key) ? m.suggestion : null;
                                        const how = touched.has(m.key) ? (choice === 'new' ? HOW.novi : HOW.rucno)
                                            : suggest ? HOW.moguce : choice === 'new' ? HOW.novi : HOW[m.how];
                                        const unused = !usedMaterialKeys.has(m.key);
                                        const name = newNames[m.key] ?? m.name;
                                        return (
                                            <div key={m.key} role="row" className={`sui-row tone-${how.tone}${unused ? ' unused' : ''}`}>
                                                <div className="sui-cell-src" role="cell">
                                                    <span className="sui-kind">{KIND_LABEL[m.vrsta] || m.vrsta}</span>
                                                    <div className="sui-two">
                                                        <span className="sui-line1" title={m.sources.join('\n')}>{m.sources[0]}</span>
                                                        <span className="sui-line2">
                                                            {m.lines} {plural(m.lines, 'stavka', 'stavke', 'stavki')}
                                                            {m.sources.length > 1 && <> · još {m.sources.length - 1} {plural(m.sources.length - 1, 'naziv', 'naziva', 'naziva')}</>}
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className="sui-cell-erp" role="cell">
                                                    <SearchableSelect
                                                        options={optionsFor(m)}
                                                        value={choice}
                                                        onChange={v => { setMaterialChoice(m.key, v); setRenaming(null); }}
                                                        placeholder="Traži u katalogu…"
                                                    />
                                                    {renaming === m.key && choice === 'new' ? (
                                                        <input
                                                            className="sui-rename"
                                                            autoFocus
                                                            value={name}
                                                            onChange={e => setNewNames(n => ({ ...n, [m.key]: e.target.value }))}
                                                            onBlur={() => setRenaming(null)}
                                                            onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setRenaming(null); }}
                                                            aria-label="Naziv novog materijala"
                                                        />
                                                    ) : (
                                                        <span className="sui-line2">
                                                            {suggest ? (
                                                                <>
                                                                    <span className="sui-maybe">Možda: <b>{suggest.Name}</b></span>
                                                                    <button type="button" className="sui-inline" onClick={() => setMaterialChoice(m.key, suggest.Material_ID)}>Poveži</button>
                                                                </>
                                                            ) : choice === 'new' ? (
                                                                <>
                                                                    <span>Novi · {m.category} · {m.unit}</span>
                                                                    <button type="button" className="sui-inline" onClick={() => setRenaming(m.key)}>Uredi naziv</button>
                                                                </>
                                                            ) : linked ? (
                                                                <span>{[linked.Category, linked.Unit, linked.Default_Supplier].filter(Boolean).join(' · ')}</span>
                                                            ) : null}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="sui-cell-status" role="cell">
                                                    <span className={`sui-badge tone-${how.tone}`}>{how.label}</span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            ))}
                            {orderedMaterials.length === 0 && <div className="sui-empty">Izvoz nema materijala ni okova (samo usluge).</div>}
                        </div>
                    </section>

                    <section className="sui-section">
                        <header>
                            <h3>Proizvodi</h3>
                            <span className="sui-hint">Količine u sastavnici su po komadu proizvoda.</span>
                        </header>
                        <div className="sui-table sui-products" role="table" aria-label="Proizvodi">
                            <div className="sui-thead sui-prod-grid" role="row">
                                <span />
                                <span role="columnheader">Proizvod</span>
                                <span role="columnheader">Š × V × D</span>
                                <span role="columnheader" className="num">Stavke</span>
                                <span role="columnheader" className="num">Materijal / kom</span>
                                <span role="columnheader" className="sui-th-status">Uvoz</span>
                            </div>
                            {plan.products.map(p => {
                                const action = choices.products[p.key] || 'new';
                                const lines = resolveProductLines(p, plan, choices, catalog);
                                const perUnit = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
                                return (
                                    <details key={p.key} className={`sui-prod${action === 'skip' ? ' skipped' : ''}`}>
                                        <summary className="sui-prod-grid">
                                            <span className="material-icons-round sui-caret">chevron_right</span>
                                            <span className="sui-prod-name">{p.name}{p.quantity > 1 && <em> × {p.quantity}</em>}</span>
                                            <span className="sui-prod-dims">{fmtDims(p)}</span>
                                            <span className="sui-prod-lines num">{lines.length}</span>
                                            <span className="sui-prod-cost num">{formatCurrency(perUnit)}</span>
                                            {p.existing ? (
                                                <select
                                                    className="sui-action"
                                                    value={action}
                                                    onClick={e => e.stopPropagation()}
                                                    onChange={e => setProductChoice(p.key, e.target.value as ProductAction)}
                                                >
                                                    <option value="replace" disabled={!p.canReplace}>
                                                        {p.existingImported ? 'Zamijeni uvezenu sastavnicu' : 'Dopuni postojeći'}
                                                    </option>
                                                    <option value="new">Napravi novi proizvod</option>
                                                    <option value="skip">Preskoči</option>
                                                </select>
                                            ) : <span className="sui-cell-status"><span className="sui-badge tone-new">novi proizvod</span></span>}
                                        </summary>
                                        {p.existing && (
                                            <p className="sui-exists">
                                                U projektu već postoji „{p.existing.Name}" ({p.existingImported} uvezenih, {p.existingManual} ručnih stavki).{' '}
                                                {p.canReplace
                                                    ? 'Zamjena briše samo ranije uvezene stavke; ručno dodane ostaju.'
                                                    : 'Dio uvezene sastavnice je već naručen — zamjena nije moguća.'}
                                            </p>
                                        )}
                                        <table className="sui-lines">
                                            <thead>
                                                <tr><th>Materijal</th><th>Količina</th><th>Cijena</th><th>Dobavljač</th><th>Iznos</th></tr>
                                            </thead>
                                            <tbody>
                                                {lines.map((l, i) => (
                                                    <tr key={i} className={l.unitMismatch ? 'mismatch' : ''}>
                                                        <td>{newNames[l.materialKey]?.trim() && !l.materialId ? newNames[l.materialKey] : l.materialName}{!l.materialId && <span className="sui-tag-new">novi</span>}</td>
                                                        <td>{fmtQty(l.quantity)} {l.unit}{l.unitMismatch && <span className="material-icons-round sui-warn-ico" title="Jedinica ponude se razlikuje od kataloške">warning</span>}</td>
                                                        <td>{formatCurrency(l.unitPrice)}</td>
                                                        <td>{l.supplier || '—'}</td>
                                                        <td>{formatCurrency(l.quantity * l.unitPrice)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </details>
                                );
                            })}
                        </div>
                    </section>
                </div>
            )}

            {step === 'running' && (
                <div className="sui-running">
                    <span className="material-icons-round sui-spin">autorenew</span>
                    <strong>{progress.label || 'Uvozim'}…</strong>
                    <div className="sui-bar"><span style={{ width: `${Math.min(100, Math.round((progress.done / Math.max(1, progress.total)) * 100))}%` }} /></div>
                    <span className="sui-hint">Ne zatvaraj prozor dok uvoz ne završi.</span>
                </div>
            )}

            {step === 'done' && result && (
                <div className="sui-done">
                    <span className={`material-icons-round sui-done-icon${result.errors.length ? ' warn' : ''}`}>{result.errors.length ? 'report' : 'task_alt'}</span>
                    <h3>{result.errors.length ? 'Uvoz završen uz greške' : 'Uvoz završen'}</h3>
                    <ul className="sui-done-list">
                        <li><b>{result.productsCreated}</b> {plural(result.productsCreated, 'novi proizvod', 'nova proizvoda', 'novih proizvoda')}{result.productsReplaced ? <>, <b>{result.productsReplaced}</b> dopunjeno</> : null}</li>
                        <li><b>{result.linesWritten}</b> {plural(result.linesWritten, 'stavka', 'stavke', 'stavki')} sastavnice</li>
                        <li><b>{result.materialsCreated}</b> {plural(result.materialsCreated, 'novi materijal', 'nova materijala', 'novih materijala')} u katalogu</li>
                        <li><b>{result.suppliersCreated}</b> {plural(result.suppliersCreated, 'novi dobavljač', 'nova dobavljača', 'novih dobavljača')}</li>
                    </ul>
                    {result.errors.length > 0 && (
                        <div className="sui-error sui-error-list">
                            {result.errors.map((e, i) => <div key={i}>{e}</div>)}
                        </div>
                    )}
                </div>
            )}
        </Modal>
    );
}
