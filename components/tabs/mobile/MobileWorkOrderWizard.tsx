'use client';

// ════════════════════════════════════════════════════════════════════
// NOVI RADNI NALOG — mobilni (proizvodni + montažni)
//
// Isti nalog kao desktop čarobnjak: logika je u useWorkOrderWizard (izbor
// proizvoda, dodjela ekipe, auto-rok, finansije, guard količine, auto-plan
// procesa, zadaci, prijedlog narudžbi materijala). Ovdje je samo raspored
// za 375px: umjesto matrice proizvod × proces sa desetinama izbornika —
// koraci na punom ekranu, ekipa „za sve" jednim dodirom, a razlika po
// proizvodu kroz list odozdo.
//
//   Proizvodnja: Proizvodi → Ekipa i rok
//   Montaža:     Spremni proizvodi → Procesi → Ekipa i rok
// ════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
    ArrowLeft, X, Plus, Minus, ChevronRight, AlertTriangle, Wrench, ClipboardList, Check,
} from 'lucide-react';
import type { WorkOrder, Project, Worker, Task } from '@/lib/types';
import { MONTAZA_STEPS } from '@/lib/types';
import { planToStages } from '@/lib/productProcesses';
import {
    useWorkOrderWizard, CREW_KEY, procLabel,
    type WizardMode, type WizardInitialProducts, type WorkOrderWizardState,
} from '@/components/production/useWorkOrderWizard';
import MaterialOrderSelectModal from '@/components/ui/MaterialOrderSelectModal';
import TaskAttachEditor from '@/components/ui/TaskAttachEditor';
import { useOverlayGuard } from './overlayGuard';
import {
    MLarge, MSection, MList, MItem, MCell, MText, MValue, MSearch, MSheet, MOption, MEmpty, MButton,
} from './MobileUI';
import './MobileUI.css';
import './MobileWorkOrderDetail.css';
import './MobileWorkOrderWizard.css';

interface Props {
    isOpen: boolean;
    mode: WizardMode;
    workOrders: WorkOrder[];
    projects: Project[];
    workers: Worker[];
    tasks?: Task[];
    organizationId: string | null;
    initialProducts?: WizardInitialProducts | null;
    onClose: () => void;
    onRefresh: (...collections: string[]) => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

export default function MobileWorkOrderWizard(props: Props) {
    // Stanje živi IZNAD ekrana: prijedlog narudžbi se otvara tek kad se ekran zatvori.
    const w = useWorkOrderWizard(props);
    const { isOpen, organizationId, onRefresh, showToast } = props;

    return (
        <>
            {isOpen && <WizardScreen {...props} w={w} />}
            {w.orderSelectPrompt && organizationId && (
                <MaterialOrderSelectModal
                    isOpen={true}
                    onClose={() => w.setOrderSelectPrompt(null)}
                    workOrderId={w.orderSelectPrompt.workOrderId}
                    workOrderLabel={w.orderSelectPrompt.label}
                    plannedStartDate={w.orderSelectPrompt.startDate}
                    organizationId={organizationId}
                    onRefresh={onRefresh}
                    showToast={showToast}
                />
            )}
        </>
    );
}

// ─────────────────────────────────────────────────────────────────────
// List za izbor radnika — jedan ili više (pomoćnici), s pretragom
// ─────────────────────────────────────────────────────────────────────
interface PickerState {
    title: string;
    multi: boolean;
    /** Samo „Glavni" (ili bez tipa) — isto pravilo kao desktop izbornik glavnog radnika. */
    mainOnly?: boolean;
    exclude?: string[];
    selected: string[];
    onPick: (ids: string[]) => void;
}

function WorkerSheet({ state, workers, onClose }: { state: PickerState | null; workers: Worker[]; onClose: () => void }) {
    const [q, setQ] = useState('');
    const [sel, setSel] = useState<string[]>([]);
    useEffect(() => { setQ(''); setSel(state?.selected || []); }, [state]);

    const list = useMemo(() => {
        if (!state) return [];
        const query = q.trim().toLowerCase();
        return workers
            .filter(w => !state.exclude?.includes(w.Worker_ID))
            .filter(w => !state.mainOnly || w.Worker_Type === 'Glavni' || !w.Worker_Type)
            .filter(w => !query || w.Name.toLowerCase().includes(query))
            .sort((a, b) => a.Name.localeCompare(b.Name, 'bs'));
    }, [workers, state, q]);

    if (!state) return null;
    const toggle = (id: string) => setSel(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

    return (
        <MSheet
            open={!!state}
            title={state.title}
            onClose={onClose}
            footer={state.multi ? (
                <div className="mui-stack mui-gap10 mui-pt14">
                    <MButton variant="filled" onClick={() => { state.onPick(sel); onClose(); }}>
                        Gotovo{sel.length > 0 ? ` · ${sel.length}` : ''}
                    </MButton>
                </div>
            ) : undefined}
        >
            <div className="mwz-sheet-search">
                <MSearch value={q} onChange={setQ} placeholder="Traži radnika…" />
            </div>
            <div className="mwz-sheet-list">
                <MList>
                    {!state.multi && state.selected.length > 0 && (
                        <MOption label={<span className="mui-dim">Bez radnika</span>} onClick={() => { state.onPick([]); onClose(); }} />
                    )}
                    {list.map(w => (
                        <MOption
                            key={w.Worker_ID}
                            label={w.Name}
                            sub={[w.Role, w.Worker_Type].filter(Boolean).join(' · ') || undefined}
                            selected={state.multi ? sel.includes(w.Worker_ID) : state.selected.includes(w.Worker_ID)}
                            onClick={() => {
                                if (state.multi) toggle(w.Worker_ID);
                                else { state.onPick([w.Worker_ID]); onClose(); }
                            }}
                        />
                    ))}
                    {list.length === 0 && <MItem><MCell><MText title={<span className="mui-dim">Nema radnika</span>} /></MCell></MItem>}
                </MList>
            </div>
        </MSheet>
    );
}

// ─────────────────────────────────────────────────────────────────────
// Ekran čarobnjaka
// ─────────────────────────────────────────────────────────────────────
function WizardScreen({ w, mode, workers, tasks = [], onClose }: Props & { w: WorkOrderWizardState }) {
    const isMontaza = mode === 'montaza';
    const [picker, setPicker] = useState<PickerState | null>(null);
    const [crewFor, setCrewFor] = useState<string | null>(null);   // Product_ID za ekipu po proizvodu
    const [saving, setSaving] = useState(false);
    const bodyRef = useRef<HTMLDivElement>(null);

    // Hardverska nazad-tipka: korak nazad, a sa prvog koraka zatvara — tako se
    // upisano ne izgubi jednim pogrešnim dodirom. ✕ uvijek zatvara.
    const stepRef = useRef(w.activeStep);
    stepRef.current = w.activeStep;
    const closingRef = useRef(false);
    useEffect(() => {
        window.history.pushState({ moWizard: true }, '');
        const onPop = () => {
            if (!closingRef.current && stepRef.current > 0) {
                w.setActiveStep(stepRef.current - 1);
                window.history.pushState({ moWizard: true }, '');
                return;
            }
            onClose();
        };
        window.addEventListener('popstate', onPop);
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            window.removeEventListener('popstate', onPop);
            document.body.style.overflow = prev;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    useOverlayGuard(true);

    const close = () => { closingRef.current = true; window.history.back(); };

    // Novi korak počinje od vrha.
    useEffect(() => { bodyRef.current?.scrollTo({ top: 0 }); }, [w.activeStep]);

    const step = w.steps[w.activeStep];
    const onLast = w.activeStep === w.lastStep;
    const title = isMontaza ? 'Montažni nalog' : 'Novi radni nalog';

    const create = async () => {
        if (saving) return;
        setSaving(true);
        try { await w.handleCreateWorkOrder(); }
        finally { setSaving(false); }
    };

    const footerNote = (() => {
        if (w.activeStep === 0) {
            const n = w.selectedProducts.length;
            return n === 0 ? 'Izaberi bar jedan proizvod' : `${n} ${n === 1 ? 'proizvod' : 'proizvoda'} u nalogu`;
        }
        if (isMontaza && w.activeStep === 1) {
            const n = w.selectedProcesses.length;
            return n === 0 ? 'Dodaj bar jedan proces' : `${n} ${n === 1 ? 'proces' : 'procesa'}`;
        }
        return `${w.selectedProducts.length} ${w.selectedProducts.length === 1 ? 'proizvod' : 'proizvoda'}${w.dueDate ? ` · rok ${shortDate(w.dueDate)}` : ''}`;
    })();

    if (typeof document === 'undefined') return null;

    return createPortal(
        <div className="mui mwd mwz" role="dialog" aria-label={title}>
            <header className="mwd-nav mwz-nav">
                {w.activeStep > 0 ? (
                    <button type="button" className="mwd-back" onClick={w.handleBack}>
                        <ArrowLeft size={21} strokeWidth={2.3} /> Nazad
                    </button>
                ) : (
                    <button type="button" className="mwd-back" onClick={close}>Otkaži</button>
                )}
                <div className="mwz-nav-title">
                    <span className="mwz-nav-name">
                        {isMontaza ? <Wrench size={14} /> : <ClipboardList size={14} />} {title}
                    </span>
                    <span className="mwz-steps" aria-label={`Korak ${w.activeStep + 1} od ${w.steps.length}`}>
                        {w.steps.map((s, i) => (
                            <i key={s.id} className={i < w.activeStep ? 'done' : i === w.activeStep ? 'on' : ''} />
                        ))}
                    </span>
                </div>
                <button type="button" className="mwd-navbtn" onClick={close} aria-label="Zatvori">
                    <X size={20} />
                </button>
            </header>

            <div className="mwd-body mwz-body" ref={bodyRef}>
                <MLarge title={step.title}>{step.subtitle}</MLarge>

                {w.activeStep === 0 && !isMontaza && <ProductionProductsStep w={w} />}
                {w.activeStep === 0 && isMontaza && <MontazaProductsStep w={w} />}
                {isMontaza && w.activeStep === 1 && <ProcessesStep w={w} />}
                {onLast && (
                    <CrewStep
                        w={w}
                        isMontaza={isMontaza}
                        workers={workers}
                        tasks={tasks}
                        onPicker={setPicker}
                        onCrewFor={setCrewFor}
                    />
                )}
            </div>

            <footer className="mwz-foot">
                <span className="mwz-foot-note">{footerNote}</span>
                {onLast ? (
                    <button type="button" className={`mwz-cta${isMontaza ? ' teal' : ''}`} disabled={saving} onClick={create}>
                        {saving ? 'Kreiram…' : 'Kreiraj nalog'}
                    </button>
                ) : (
                    <button type="button" className={`mwz-cta${isMontaza ? ' teal' : ''}`} disabled={!w.canGoNext} onClick={w.handleNext}>
                        Dalje <ChevronRight size={18} />
                    </button>
                )}
            </footer>

            <WorkerSheet state={picker} workers={workers} onClose={() => setPicker(null)} />
            <ProductCrewSheet
                w={w}
                productId={crewFor}
                workers={workers}
                onPicker={setPicker}
                onClose={() => setCrewFor(null)}
            />
        </div>,
        document.body
    );
}

// ─────────────────────────────────────────────────────────────────────
// Korak 1 (proizvodnja): proizvodi grupisani po projektu
// ─────────────────────────────────────────────────────────────────────
function ProductionProductsStep({ w }: { w: WorkOrderWizardState }) {
    const selected = new Map(w.selectedProducts.map(p => [p.Product_ID, p]));
    const groups = w.sortedProjects
        .map(proj => ({ proj, items: w.eligibleProducts.filter((p: any) => p.Project_ID === proj.Project_ID) }))
        .filter(g => g.items.length > 0);

    return (
        <>
            <div className="mwz-search"><MSearch value={w.productSearch} onChange={w.setProductSearch} placeholder="Traži proizvod ili projekat…" /></div>
            {w.selectedProducts.length > 0 && (
                <div className="mwz-selbar">
                    <span><b>{w.selectedProducts.length}</b> odabrano</span>
                    <button type="button" onClick={() => w.setSelectedProducts([])}>Poništi sve</button>
                </div>
            )}

            {groups.length === 0 && (
                <MEmpty title="Nema dostupnih proizvoda" sub={w.productSearch ? 'Promijeni pretragu.' : 'Svi proizvodi su već u nalozima ili su projekti završeni.'} />
            )}

            {groups.map(({ proj, items }) => {
                const all = items.every((p: any) => selected.has(p.Product_ID));
                return (
                    <div key={proj.Project_ID}>
                        <MSection
                            title={<span className="mwz-proj">{proj.Name || proj.Client_Name}{proj.Name && proj.Client_Name ? <em> · {proj.Client_Name}</em> : null}</span>}
                            action={all ? 'Poništi' : 'Sve'}
                            onAction={() => w.selectProducts(items, !all)}
                        />
                        <MList lead>
                            {items.map((prod: any) => {
                                const sel = selected.get(prod.Product_ID);
                                return (
                                    <TapRow key={prod.Product_ID} onTap={() => w.toggleProduct(prod)}>
                                        <CheckMark on={!!sel} />
                                        <MText
                                            title={prod.Product_Name}
                                            sub={<>{prod.Quantity} kom dostupno{planLabel(prod) ? <> · <span className="mwz-plan">{planLabel(prod)}</span></> : null}</>}
                                        />
                                        {sel && prod.Quantity > 1 && (
                                            <Stepper
                                                value={sel.Work_Order_Quantity}
                                                max={prod.Quantity}
                                                onChange={v => w.setProductQuantity(prod.Product_ID, v, prod.Quantity)}
                                            />
                                        )}
                                    </TapRow>
                                );
                            })}
                        </MList>
                    </div>
                );
            })}
        </>
    );
}

/** „Rezanje → Kantiranje ∥ Bušenje +2" — fazni plan procesa proizvoda. */
function planLabel(prod: any): string {
    const stages = planToStages(prod.Process_Stages, prod.Process_Plan);
    if (!stages.length) return '';
    const parts = stages.map(s => s.join(' ∥ '));
    return parts.length > 3 ? `${parts.slice(0, 3).join(' → ')} +${parts.length - 3}` : parts.join(' → ');
}

function Stepper({ value, max, onChange }: { value: number; max: number; onChange: (v: number) => void }) {
    return (
        <span className="mwz-stepper" onClick={e => e.stopPropagation()}>
            <button type="button" aria-label="Manje" disabled={value <= 1} onClick={() => onChange(value - 1)}><Minus size={15} /></button>
            <span className="mui-num">{value}</span>
            <button type="button" aria-label="Više" disabled={value >= max} onClick={() => onChange(value + 1)}><Plus size={15} /></button>
        </span>
    );
}

// ─────────────────────────────────────────────────────────────────────
// Korak 1 (montaža): spremni proizvodi
// ─────────────────────────────────────────────────────────────────────
function MontazaProductsStep({ w }: { w: WorkOrderWizardState }) {
    const selected = new Set(w.selectedProducts.map(p => p.Product_ID));
    const byProject = useMemo(() => {
        type Group = { name: string; items: any[] };
        const m = new Map<string, Group>();
        for (const p of w.eligibleMontazaProducts as any[]) {
            const g: Group = m.get(p.Project_ID) || { name: p.Project_Name, items: [] };
            g.items.push(p);
            m.set(p.Project_ID, g);
        }
        return Array.from(m.entries());
    }, [w.eligibleMontazaProducts]);

    return (
        <>
            <div className="mwz-search"><MSearch value={w.productSearch} onChange={w.setProductSearch} placeholder="Traži proizvod ili projekat…" /></div>
            {w.selectedProducts.length > 0 && (
                <div className="mwz-selbar">
                    <span><b>{w.selectedProducts.length}</b> odabrano</span>
                    <button type="button" onClick={() => w.setSelectedProducts([])}>Poništi sve</button>
                </div>
            )}

            {byProject.length === 0 && (
                <MEmpty
                    title="Nema spremnih proizvoda"
                    sub={w.productSearch ? 'Promijeni pretragu.' : 'Proizvod mora imati status „Spremno" da bi išao u montažu — završi proizvodnju najprije.'}
                />
            )}

            {byProject.map(([projectId, g]) => {
                const all = g.items.every(p => selected.has(p.Product_ID));
                return (
                    <div key={projectId}>
                        <MSection title={g.name} action={all ? 'Poništi' : 'Sve'} onAction={() => w.selectMontazaProducts(g.items, !all)} />
                        <MList lead>
                            {g.items.map(prod => {
                                const on = selected.has(prod.Product_ID);
                                const toggle = () => w.selectMontazaProducts([prod], !on);
                                return (
                                    <TapRow key={prod.Product_ID} onTap={toggle}>
                                        <CheckMark on={on} />
                                        <MText
                                            title={prod.Product_Name}
                                            sub={<>{prod.Quantity} kom{prod.Source_Work_Order_Number ? <> · iz naloga #{prod.Source_Work_Order_Number}</> : null}</>}
                                        />
                                    </TapRow>
                                );
                            })}
                        </MList>
                    </div>
                );
            })}
        </>
    );
}

// ─────────────────────────────────────────────────────────────────────
// Korak 2 (montaža): procesi
// ─────────────────────────────────────────────────────────────────────
function ProcessesStep({ w }: { w: WorkOrderWizardState }) {
    const missing = MONTAZA_STEPS.filter(s => !w.selectedProcesses.includes(s));
    return (
        <>
            <MSection title="Procesi naloga" right={<span className="mui-dim">{w.selectedProcesses.length}</span>} />
            <div className="mwz-chips">
                {w.selectedProcesses.map((proc, i) => (
                    <span key={proc} className="mwz-chip">
                        <span className="mwz-chip-n">{i + 1}</span>
                        {proc}
                        <button type="button" aria-label={`Ukloni ${proc}`} onClick={() => w.toggleProcess(proc)}><X size={14} /></button>
                    </span>
                ))}
                {w.selectedProcesses.length === 0 && <span className="mui-dim">Nijedan proces — dodaj bar jedan.</span>}
            </div>

            {missing.length > 0 && (
                <>
                    <MSection title="Vrati uobičajene" />
                    <div className="mwz-chips">
                        {missing.map(proc => (
                            <button key={proc} type="button" className="mwz-chip add" onClick={() => w.toggleProcess(proc)}>
                                <Plus size={14} /> {proc}
                            </button>
                        ))}
                    </div>
                </>
            )}

            <MSection title="Novi proces" />
            <div className="mwz-addrow">
                <input
                    value={w.customProcessInput}
                    onChange={e => w.setCustomProcessInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') w.addCustomProcess(); }}
                    placeholder="npr. Silikoniranje"
                />
                <button type="button" onClick={w.addCustomProcess} disabled={!w.customProcessInput.trim()}>Dodaj</button>
            </div>
            <p className="mwd-hint">Procesi važe za sve izabrane proizvode — isto kao na desktopu.</p>
        </>
    );
}

// ─────────────────────────────────────────────────────────────────────
// Zadnji korak: nalog, ekipa, rok, finansije, narudžbe, zadaci
// ─────────────────────────────────────────────────────────────────────
function CrewStep({ w, isMontaza, workers, tasks, onPicker, onCrewFor }: {
    w: WorkOrderWizardState;
    isMontaza: boolean;
    workers: Worker[];
    tasks: Task[];
    onPicker: (p: PickerState) => void;
    onCrewFor: (productId: string) => void;
}) {
    const name = (id?: string) => workers.find(x => x.Worker_ID === id)?.Name;
    const first = w.selectedProducts[0];

    // Ekipa „za sve" se čita s prvog proizvoda — kad se razlikuje po proizvodu, piše „različito".
    const sameFor = (proc: string) => {
        const main = first?.assignments?.[proc] || '';
        const helpers = first?.helperAssignments?.[proc] || [];
        const same = w.selectedProducts.every(p =>
            (p.assignments?.[proc] || '') === main
            && sameSet(p.helperAssignments?.[proc] || [], helpers));
        return { main, helpers, same };
    };

    const noWorker = w.selectedProducts.length > 0
        && w.selectedProducts.every(p => Object.values(p.assignments || {}).every(v => !v));

    const crewKeys = isMontaza ? w.selectedProcesses : [CREW_KEY];
    const globalHelpers = (() => {
        const p0 = w.selectedProcesses[0];
        return first && p0 ? (first.helperAssignments?.[p0] || []) : [];
    })();

    return (
        <>
            {/* ── Nalog ── */}
            <MSection title="Nalog" />
            <MList>
                <FieldRow label="Naziv" hint="opciono">
                    <input value={w.workOrderName} onChange={e => w.setWorkOrderName(e.target.value)} placeholder="npr. Kuhinja — Dino" />
                </FieldRow>
                <FieldRow label="Početak">
                    <input type="date" value={w.startDate} onChange={e => w.setStartDate(e.target.value)} />
                </FieldRow>
                <FieldRow label="Rok" hint={w.totalPlannedDays > 0 ? `${w.totalPlannedDays} radnih dana` : undefined}>
                    <input type="date" value={w.dueDate} onChange={e => w.setDueDate(e.target.value)} />
                </FieldRow>
                <FieldRow label="Napomena" hint="opciono">
                    <input value={w.notes} onChange={e => w.setNotes(e.target.value)} placeholder="Upute za radnike…" />
                </FieldRow>
            </MList>
            {w.suggestedDueDate && w.suggestedDueDate !== w.dueDate && (
                <button type="button" className="mwz-suggest" onClick={() => w.setDueDate(w.suggestedDueDate)}>
                    Predloženi rok {shortDate(w.suggestedDueDate)} — iz {w.totalPlannedDays} planiranih dana · Primijeni
                </button>
            )}

            {/* ── Ekipa ── */}
            <MSection title={isMontaza ? 'Ekipa po procesu' : 'Ekipa'} right={<span className="mui-dim">za sve proizvode</span>} />
            <MList>
                {crewKeys.map(proc => {
                    const s = sameFor(proc);
                    return (
                        <MItem key={proc}>
                            <MCell onClick={() => onPicker({
                                title: isMontaza ? `${proc} — glavni radnik` : 'Glavni radnik',
                                multi: false,
                                mainOnly: true,
                                selected: s.same && s.main ? [s.main] : [],
                                onPick: ids => {
                                    // „Bez radnika" = očisti glavnog na svim proizvodima (bez toasta „undefined dodijeljen").
                                    if (!ids[0]) w.setSelectedProducts(prev => prev.map(p => ({ ...p, assignments: { ...p.assignments, [proc]: '' } })));
                                    else if (isMontaza) w.assignWorkerToAll(proc, ids[0]);
                                    else w.assignWorkerToAllProcesses(ids[0]);
                                },
                            })} chevron>
                                <MText title={isMontaza ? proc : 'Glavni radnik'} sub={isMontaza ? 'glavni radnik' : 'radi sve procese plana'} />
                                <MValue num={false} strong={!!(s.same && s.main)}>
                                    {!s.same ? 'različito' : s.main ? name(s.main) : <span className="mwz-need">Izaberi</span>}
                                </MValue>
                            </MCell>
                        </MItem>
                    );
                })}
                <MItem>
                    <MCell onClick={() => onPicker({
                        title: 'Pomoćnici',
                        multi: true,
                        selected: globalHelpers,
                        onPick: ids => {
                            if (isMontaza) w.selectedProcesses.forEach(proc => w.assignHelpersToAllForProcess(proc, ids));
                            else w.assignHelpersToAllProcesses(ids);
                        },
                    })} chevron>
                        <MText title="Pomoćnici" sub={isMontaza ? 'na svim procesima' : undefined} />
                        <MValue num={false}>
                            {globalHelpers.length === 0 ? <span className="mui-dim">nema</span>
                                : globalHelpers.length <= 2 ? globalHelpers.map(id => firstName(name(id))).join(', ')
                                    : `${globalHelpers.length} radnika`}
                        </MValue>
                    </MCell>
                </MItem>
            </MList>

            {/* ── Različito po proizvodu (desktop: red matrice) ── */}
            {w.selectedProducts.length > 1 && (
                <>
                    <MSection title="Po proizvodu" right={<span className="mui-dim">dodir mijenja samo taj proizvod</span>} />
                    <MList>
                        {w.selectedProducts.map(p => (
                            <MItem key={p.Product_ID}>
                                <MCell onClick={() => onCrewFor(p.Product_ID)} chevron>
                                    <MText title={p.Product_Name} sub={crewSummary(p, crewKeys, name)} />
                                </MCell>
                            </MItem>
                        ))}
                    </MList>
                </>
            )}

            {/* ── Upozorenja prije pokretanja ── */}
            {(noWorker || w.undefinedProducts.length > 0) && (
                <div className="mwd-warn mwz-warn">
                    <AlertTriangle size={16} />
                    <div>
                        {noWorker && <p><b>Nijedan radnik nije dodijeljen.</b> Nalog se neće moći pokrenuti dok ne dodijeliš radnika — možeš i kasnije.</p>}
                        {w.undefinedProducts.length > 0 && (
                            <p><b>Nedefinisani proizvodi</b> (cijena/rok): {w.undefinedProducts.join(', ')} — rok i profit su potcijenjeni dok se ponuda ne dopuni.</p>
                        )}
                    </div>
                </div>
            )}

            {/* ── Finansije (proizvodnja) ── */}
            {w.wizardFin && (
                <>
                    <MSection title="Finansije naloga" />
                    <MList>
                        <FinRow label="Vrijednost" value={w.fmtKM(w.wizardFin.value)} />
                        <FinRow label="Materijal" value={w.fmtKM(w.wizardFin.material)} />
                        <FinRow label={`Planirani rad${w.totalPlannedDays > 0 ? ` · ${w.totalPlannedDays} d` : ''}`} value={w.fmtKM(w.wizardFin.plannedLabor)} />
                        {(w.wizardFin.transport > 0 || w.wizardFin.services > 0) && (
                            <FinRow label="Transport + usluge" value={w.fmtKM(w.wizardFin.transport + w.wizardFin.services)} />
                        )}
                        <MItem>
                            <MCell>
                                <MText title={<b>Procijenjeno ostaje</b>} />
                                <MValue strong><span className={w.wizardFin.profit >= 0 ? 'mwz-pos' : 'mwz-neg'}>{w.fmtKM(w.wizardFin.profit)}</span></MValue>
                            </MCell>
                        </MItem>
                    </MList>
                </>
            )}

            {/* ── Narudžbe materijala (proizvodnja) ── */}
            {!isMontaza && (
                <>
                    <MSection title="Materijal" />
                    <MList>
                        <TapRow onTap={() => w.setCreateMaterialOrders(!w.createMaterialOrders)}>
                            <CheckMark on={w.createMaterialOrders} />
                            <MText title="Predloži narudžbe materijala" sub="Poslije kreiranja biraš dobavljače i materijale — ništa se ne naručuje samo." />
                        </TapRow>
                    </MList>
                </>
            )}

            {/* ── Zadaci uz nalog (isti editor kao desktop) ── */}
            <MSection title="Zadaci" />
            <div className="mwd-panel mwz-tasks">
                <TaskAttachEditor
                    value={w.taskSelection}
                    onChange={w.setTaskSelection}
                    tasks={tasks}
                    workers={workers}
                    products={w.selectedProducts.map(p => ({ Product_ID: p.Product_ID, Product_Name: p.Product_Name }))}
                    suggestedIds={w.suggestedTaskIds}
                    pickerZIndex={2000}
                />
            </div>
        </>
    );
}

function FieldRow({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
    return (
        <MItem>
            <label className="mwz-field">
                <span className="mwz-field-l">{label}{hint && <em>{hint}</em>}</span>
                {children}
            </label>
        </MItem>
    );
}

function FinRow({ label, value }: { label: string; value: string }) {
    return (
        <MItem>
            <MCell>
                <MText title={label} />
                <MValue>{value}</MValue>
            </MCell>
        </MItem>
    );
}

// ─────────────────────────────────────────────────────────────────────
// List: ekipa JEDNOG proizvoda (desktop: jedan red matrice)
// ─────────────────────────────────────────────────────────────────────
function ProductCrewSheet({ w, productId, workers, onPicker, onClose }: {
    w: WorkOrderWizardState;
    productId: string | null;
    workers: Worker[];
    onPicker: (p: PickerState) => void;
    onClose: () => void;
}) {
    const p = w.selectedProducts.find(x => x.Product_ID === productId);
    const name = (id?: string) => workers.find(x => x.Worker_ID === id)?.Name;
    const keys = w.selectedProcesses;

    return (
        <MSheet open={!!p} title={p?.Product_Name} onClose={onClose}>
            {p && (
                <>
                    <p className="mwd-sheet-note">Mijenja samo ovaj proizvod — ostali zadržavaju ekipu „za sve".</p>
                    {keys.map(proc => {
                        const main = p.assignments?.[proc] || '';
                        const helpers = p.helperAssignments?.[proc] || [];
                        return (
                            <div key={proc} className="mwz-crewblock">
                                <div className="mui-shd"><span>{procLabel(proc)}</span></div>
                                <MList>
                                    <MItem>
                                        <MCell chevron onClick={() => onPicker({
                                            title: 'Glavni radnik', multi: false, mainOnly: true,
                                            selected: main ? [main] : [],
                                            onPick: ids => w.assignWorker(p.Product_ID, proc, ids[0] || ''),
                                        })}>
                                            <MText title="Glavni radnik" />
                                            <MValue num={false} strong={!!main}>{main ? name(main) : <span className="mwz-need">Izaberi</span>}</MValue>
                                        </MCell>
                                    </MItem>
                                    <MItem>
                                        <MCell chevron onClick={() => onPicker({
                                            title: 'Pomoćnici', multi: true, exclude: main ? [main] : [],
                                            selected: helpers,
                                            onPick: ids => {
                                                // toggleHelper radi po jednom radniku — primijeni razliku.
                                                const cur = new Set(helpers);
                                                const next = new Set(ids);
                                                ids.forEach(id => { if (!cur.has(id)) w.toggleHelper(p.Product_ID, proc, id); });
                                                helpers.forEach(id => { if (!next.has(id)) w.toggleHelper(p.Product_ID, proc, id); });
                                            },
                                        })}>
                                            <MText title="Pomoćnici" />
                                            <MValue num={false}>{helpers.length === 0 ? <span className="mui-dim">nema</span> : helpers.map(id => firstName(name(id))).join(', ')}</MValue>
                                        </MCell>
                                    </MItem>
                                </MList>
                            </div>
                        );
                    })}
                    <div className="mui-stack mui-gap10 mui-pt14">
                        <MButton variant="filled" onClick={onClose}>Gotovo</MButton>
                    </div>
                </>
            )}
        </MSheet>
    );
}

// ── Sitni pomoćnici ──────────────────────────────────────────────────

/**
 * Red na koji se tapka, ali NIJE <button> — sadrži stepper (dugmad), a dugme u
 * dugmetu je nevalidan HTML (i React to prijavljuje). Izgleda kao MCell.
 */
function TapRow({ onTap, children }: { onTap: () => void; children: ReactNode }) {
    return (
        <MItem>
            <div
                className="mui-cell mui-tap"
                role="button"
                tabIndex={0}
                onClick={onTap}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTap(); } }}
            >
                {children}
            </div>
        </MItem>
    );
}

/** Izgled MCheck-a bez dugmeta — dodir hvata cijeli red. */
function CheckMark({ on }: { on: boolean }) {
    return <span className={`mui-cbx blue${on ? ' on' : ''}`} aria-hidden><Check strokeWidth={3.2} /></span>;
}

function sameSet(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    const s = new Set(a);
    return b.every(x => s.has(x));
}

function firstName(full?: string): string {
    return (full || '').split(' ')[0] || '—';
}

function crewSummary(p: { assignments: Record<string, string>; helperAssignments: Record<string, string[]> }, keys: string[], name: (id?: string) => string | undefined): string {
    const mains = Array.from(new Set(keys.map(k => p.assignments?.[k]).filter(Boolean))) as string[];
    const helpers = Array.from(new Set(keys.flatMap(k => p.helperAssignments?.[k] || [])));
    if (mains.length === 0) return 'bez radnika';
    const main = mains.map(id => name(id)).filter(Boolean).join(', ');
    return helpers.length ? `${main} + ${helpers.length} ${helpers.length === 1 ? 'pomoćnik' : 'pomoćnika'}` : main;
}

function shortDate(iso: string): string {
    const [y, m, d] = iso.slice(0, 10).split('-');
    return d ? `${Number(d)}.${Number(m)}.${y}.` : iso;
}

