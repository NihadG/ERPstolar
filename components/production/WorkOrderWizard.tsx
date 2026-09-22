'use client';

// ════════════════════════════════════════════════════════════════════
// WIZARD NOVOG RADNOG NALOGA (proizvodnja + montaža) — izdvojen iz
// ProductionTab.tsx (razbijanje monolita, bez promjene ponašanja).
// Sav wizard state, odabir proizvoda, dodjela radnika, auto-rok i
// kreiranje naloga žive u useWorkOrderWizard (dijeli ih s mobilnim tokom);
// ovdje je samo desktop prikaz. ProductionTab samo otvara/zatvara.
// ════════════════════════════════════════════════════════════════════

import { useState, useEffect } from 'react';
import type { WorkOrder, Project, Worker, Task } from '@/lib/types';
import { planToStages } from '@/lib/productProcesses';
import Modal from '@/components/ui/Modal';
import TaskAttachEditor from '@/components/ui/TaskAttachEditor';
import MaterialOrderSelectModal from '@/components/ui/MaterialOrderSelectModal';
import { useWorkOrderWizard, procLabel, type WizardMode, type WizardInitialProducts } from './useWorkOrderWizard';

export type { WizardMode, WizardInitialProducts } from './useWorkOrderWizard';

interface WorkOrderWizardProps {
    isOpen: boolean;
    mode: WizardMode;
    workOrders: WorkOrder[];
    projects: Project[];
    workers: Worker[];
    /** Svi zadaci organizacije — za „Poveži postojeći" pri kreiranju. */
    tasks?: Task[];
    organizationId: string | null;
    initialProducts?: WizardInitialProducts | null;
    onClose: () => void;
    onRefresh: (...collections: string[]) => void;
    /** Poslije uspješnog kreiranja — pozivalac (npr. Platno) veže blok na stvarni nalog. */
    onCreated?: (workOrderId: string, workOrderNumber: string) => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

export default function WorkOrderWizard(props: WorkOrderWizardProps) {
    const { isOpen, mode, workers, tasks = [], organizationId, initialProducts, onClose, onRefresh, showToast } = props;
    const {
        activeStep,
        setActiveStep,
        sortedProjects,
        selectedProducts,
        setSelectedProducts,
        selectedProcesses,
        setSelectedProcesses,
        customProcessInput,
        setCustomProcessInput,
        dueDate,
        setDueDate,
        startDate,
        setStartDate,
        workOrderName,
        setWorkOrderName,
        notes,
        setNotes,
        productSearch,
        setProductSearch,
        createMaterialOrders,
        setCreateMaterialOrders,
        orderSelectPrompt,
        setOrderSelectPrompt,
        taskSelection,
        setTaskSelection,
        suggestedTaskIds,
        totalPlannedDays,
        suggestedDueDate,
        wizardFin,
        fmtKM,
        undefinedProducts,
        eligibleProducts,
        eligibleMontazaProducts,
        steps,
        lastStep,
        canGoNext,
        handleNext,
        handleBack,
        toggleProduct,
        selectAllProducts,
        toggleProcess,
        addCustomProcess,
        assignWorker,
        toggleHelper,
        assignWorkerToAll,
        assignWorkerToAllProcesses,
        assignHelpersToAllProcesses,
        handleCreateWorkOrder,
    } = useWorkOrderWizard(props);

    // Desktop-only: koji padajući izbornik radnika je otvoren + pretraga u njemu.
    const [openDropdown, setOpenDropdown] = useState<string | null>(null);
    const [workerSearch, setWorkerSearch] = useState('');
    useEffect(() => {
        if (!isOpen) return;
        setOpenDropdown(null);
        setWorkerSearch('');
    }, [isOpen, mode, initialProducts]);


    return (
        <>
            {/* ========== FULL-SCREEN WIZARD MODAL ========== */}
            <Modal isOpen={isOpen} onClose={onClose} title={mode === 'montaza' ? 'Montažni Nalog' : 'Novi Radni Nalog'} size="fullscreen" footer={null}>
                <div className="wizard-container">
                    {/* COMPACT HEADER WITH NAVIGATION */}
                    <div className="wizard-header">
                        <div className="header-left">
                            {activeStep > 0 && (
                                <button className="btn-nav back" onClick={handleBack}>
                                    <span className="material-icons-round">arrow_back</span>
                                    Nazad
                                </button>
                            )}
                        </div>

                        <div className="steps-indicator compact">
                            {steps.map((step, index) => (
                                <div key={step.id} className={`step-item ${index <= activeStep ? 'active' : ''} ${index === activeStep ? 'current' : ''}`}>
                                    <div className="step-circle">{index + 1}</div>
                                    <span className="step-title">{step.title}</span>
                                    {index < steps.length - 1 && <div className="step-line" />}
                                </div>
                            ))}
                        </div>

                        <div className="header-right">
                            {activeStep === lastStep ? (
                                <button className="btn-nav finish" onClick={handleCreateWorkOrder}
                                    style={mode === 'montaza' ? { background: 'linear-gradient(135deg, #00C7BE 0%, #00a89e 100%)' } : undefined}
                                >
                                    Kreiraj
                                    <span className="material-icons-round">check</span>
                                </button>
                            ) : (
                                <button className="btn-nav next" onClick={handleNext} disabled={!canGoNext}
                                    style={mode === 'montaza' ? { background: 'linear-gradient(135deg, #00C7BE 0%, #00a89e 100%)' } : undefined}
                                >
                                    Dalje
                                    <span className="material-icons-round">arrow_forward</span>
                                </button>
                            )}
                        </div>
                    </div>

                    {/* CONTENT BODY - MAXIMIZED */}
                    <div className="wizard-body">
                        {/* STEP 1: PROJECTS (Production only) */}
                        {/* MONTAŽA STEP 0: Select Spremno Products */}
                        {activeStep === 0 && mode === 'montaza' && (
                            <div className="wizard-step step-products">
                                <div className="step-toolbar sticky">
                                    <div className="tb-left">
                                        <h3 style={{ color: '#00C7BE' }}>🔧 Odaberite spremne proizvode</h3>
                                        <span className="tb-stats">{selectedProducts.length} odabrano od {eligibleMontazaProducts.length} spremnih</span>
                                    </div>
                                    <div className="tb-right">
                                        <div className="search-input">
                                            <span className="material-icons-round">search</span>
                                            <input placeholder="Pretraži..." value={productSearch} onChange={e => setProductSearch(e.target.value)} />
                                        </div>
                                        <button className="btn-text" onClick={() => {
                                            setSelectedProducts(eligibleMontazaProducts.map((p: any) => ({
                                                Product_ID: p.Product_ID,
                                                Product_Name: p.Product_Name,
                                                Project_ID: p.Project_ID,
                                                Project_Name: p.Project_Name,
                                                Quantity: p.Quantity,
                                                Work_Order_Quantity: p.Quantity,
                                                Status: p.Status,
                                                assignments: {},
                                                helperAssignments: {},
                                                Unit_Price: undefined,
                                                Material_Cost: undefined,
                                                Source_Work_Order_ID: p.Source_Work_Order_ID,
                                            })));
                                        }}>Odaberi sve</button>
                                        {selectedProducts.length > 0 && <button className="btn-text danger" onClick={() => setSelectedProducts([])}>Poništi</button>}
                                    </div>
                                </div>

                                {eligibleMontazaProducts.length === 0 ? (
                                    <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-secondary)' }}>
                                        <span className="material-icons-round" style={{ fontSize: '48px', opacity: 0.4, marginBottom: '12px', display: 'block' }}>inventory_2</span>
                                        <h4>Nema spremnih proizvoda</h4>
                                        <p style={{ fontSize: '13px', maxWidth: '400px', margin: '8px auto' }}>Proizvodi moraju imati status "Spremno" da bi bili dostupni za montažu. Završite proizvodnju najprije.</p>
                                    </div>
                                ) : (
                                    <div className="wz-scroll-container">
                                        <div className="wz-list">
                                            {eligibleMontazaProducts.map((prod: any) => {
                                                const isSelected = selectedProducts.some(p => p.Product_ID === prod.Product_ID);
                                                return (
                                                    <div key={prod.Product_ID}
                                                        className={`wz-list-item ${isSelected ? 'selected' : ''}`}
                                                        style={{ flexDirection: 'column', alignItems: 'stretch', gap: '8px' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}
                                                            onClick={() => {
                                                                if (isSelected) {
                                                                    setSelectedProducts(selectedProducts.filter(p => p.Product_ID !== prod.Product_ID));
                                                                } else {
                                                                    // Ista veza na izvorni proizvodni nalog kao „Odaberi sve".
                                                                    setSelectedProducts([...selectedProducts, {
                                                                        Product_ID: prod.Product_ID,
                                                                        Product_Name: prod.Product_Name,
                                                                        Project_ID: prod.Project_ID,
                                                                        Project_Name: prod.Project_Name,
                                                                        Quantity: prod.Quantity,
                                                                        Work_Order_Quantity: prod.Quantity,
                                                                        Status: prod.Status,
                                                                        assignments: {},
                                                                        helperAssignments: {},
                                                                        Unit_Price: undefined,
                                                                        Material_Cost: undefined,
                                                                        Source_Work_Order_ID: prod.Source_Work_Order_ID,
                                                                    }]);
                                                                }
                                                            }}>
                                                            <span className="material-icons-round icon-check">
                                                                {isSelected ? 'check_box' : 'check_box_outline_blank'}
                                                            </span>
                                                            <div className="li-content">
                                                                <span className="li-title">{prod.Product_Name}</span>
                                                                <span className="li-sub">
                                                                    {prod.Project_Name}
                                                                    {prod.Source_Work_Order_Number && (
                                                                        <span style={{ marginLeft: '8px', color: '#00C7BE', fontSize: '11px' }}>
                                                                            ← {prod.Source_Work_Order_Number}
                                                                        </span>
                                                                    )}
                                                                </span>
                                                            </div>
                                                            <span className="li-qty" style={{ background: '#e0f7f6', color: '#00897b' }}>{prod.Quantity} kom</span>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* PRODUCTION STEP 0: Products grouped by project (spojeni Projekti+Proizvodi korak) */}
                        {activeStep === 0 && mode === 'production' && (
                            <div className="wizard-step step-products">
                                <div className="step-toolbar sticky">
                                    <div className="tb-left">
                                        <h3>Odaberite proizvode</h3>
                                        <span className="tb-stats">{selectedProducts.length} odabrano</span>
                                    </div>
                                    <div className="tb-right">
                                        <div className="search-input">
                                            <span className="material-icons-round">search</span>
                                            <input placeholder="Pretraži proizvod ili projekat..." value={productSearch} onChange={e => setProductSearch(e.target.value)} autoFocus />
                                        </div>
                                        <button className="btn-text" onClick={selectAllProducts}>Odaberi sve</button>
                                        {selectedProducts.length > 0 && <button className="btn-text danger" onClick={() => setSelectedProducts([])}>Poništi</button>}
                                    </div>
                                </div>
                                <div className="wz-list-scroll">
                                    {eligibleProducts.length === 0 && (
                                        <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--text-secondary)' }}>
                                            <span className="material-icons-round" style={{ fontSize: '44px', opacity: 0.4, display: 'block', marginBottom: '10px' }}>inventory_2</span>
                                            Nema dostupnih proizvoda (svi su već u nalozima ili su projekti završeni)
                                        </div>
                                    )}
                                    {sortedProjects.map(proj => {
                                        const projProds = eligibleProducts.filter(p => p.Project_ID === proj.Project_ID);
                                        if (projProds.length === 0) return null;
                                        const selCount = projProds.filter(p => selectedProducts.some(s => s.Product_ID === p.Product_ID)).length;
                                        const allSelected = selCount === projProds.length;
                                        return (
                                            <div key={proj.Project_ID} style={{ marginBottom: '14px' }}>
                                                {/* Zaglavlje grupe = projekat */}
                                                <div style={{
                                                    display: 'flex', alignItems: 'center', gap: '10px',
                                                    padding: '8px 12px', background: 'var(--bg-tertiary, #f8fafc)',
                                                    borderRadius: '8px', marginBottom: '6px',
                                                    position: 'sticky', top: 0, zIndex: 2,
                                                }}>
                                                    <span style={{ fontWeight: 700, fontSize: '13px', color: 'var(--text-primary, #0f172a)' }}>{proj.Name || proj.Client_Name}</span>
                                                    {proj.Name && (
                                                        <span style={{ fontSize: '12px', color: 'var(--text-secondary, #64748b)' }}>· {proj.Client_Name}</span>
                                                    )}
                                                    <span style={{ fontSize: '12px', color: 'var(--text-secondary, #64748b)' }}>
                                                        {selCount > 0 ? `${selCount}/` : ''}{projProds.length} proizvoda
                                                    </span>
                                                    <button
                                                        className="btn-text"
                                                        style={{ marginLeft: 'auto', fontSize: '12px' }}
                                                        onClick={() => {
                                                            if (allSelected) {
                                                                setSelectedProducts(selectedProducts.filter(s => !projProds.some(p => p.Product_ID === s.Product_ID)));
                                                            } else {
                                                                const toAdd = projProds
                                                                    .filter(p => !selectedProducts.some(s => s.Product_ID === p.Product_ID))
                                                                    .map(p => ({
                                                                        ...p,
                                                                        Work_Order_Quantity: p.Quantity || 1,
                                                                        assignments: selectedProcesses.reduce((acc: Record<string, string>, proc) => ({ ...acc, [proc]: '' }), {}),
                                                                        helperAssignments: selectedProcesses.reduce((acc: Record<string, string[]>, proc) => ({ ...acc, [proc]: [] }), {}),
                                                                    }));
                                                                setSelectedProducts([...selectedProducts, ...toAdd]);
                                                            }
                                                        }}
                                                    >
                                                        {allSelected ? 'Poništi projekat' : 'Označi sve'}
                                                    </button>
                                                </div>
                                                <div className="wz-list">
                                                    {projProds.map(prod => {
                                            const isSelected = selectedProducts.some(p => p.Product_ID === prod.Product_ID);
                                            const selectedProd = selectedProducts.find(p => p.Product_ID === prod.Product_ID);

                                            return (
                                                <div key={prod.Product_ID}
                                                    className={`wz-list-item ${isSelected ? 'selected' : ''}`}
                                                    style={{ flexDirection: 'column', alignItems: 'stretch', gap: '8px' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}
                                                        onClick={() => toggleProduct(prod)}>
                                                        <span className="material-icons-round icon-check">
                                                            {isSelected ? 'check_box' : 'check_box_outline_blank'}
                                                        </span>
                                                        <div className="li-content">
                                                            <span className="li-title">{prod.Product_Name}</span>
                                                            <span className="li-sub">
                                                                {prod.Project_Name}
                                                                {/* Fazni plan procesa proizvoda (∥ = paralelno; graf naloga se sintetiše iz njega) */}
                                                                <span style={{ marginLeft: '8px', color: '#94a3b8', fontSize: '11px' }}>
                                                                    {(() => {
                                                                        const stages = planToStages(prod.Process_Stages, prod.Process_Plan);
                                                                        if (!stages.length) return '· Rad';
                                                                        const parts = stages.map(s => s.join(' ∥ '));
                                                                        return parts.length > 3
                                                                            ? `${parts.slice(0, 3).join(' → ')} +${parts.length - 3}`
                                                                            : parts.join(' → ');
                                                                    })()}
                                                                </span>
                                                            </span>
                                                        </div>
                                                        <span className="li-qty">{prod.Quantity} kom</span>
                                                    </div>

                                                    {isSelected && selectedProd && (
                                                        <div style={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '12px',
                                                            marginLeft: '36px',
                                                            padding: '8px 12px',
                                                            background: 'var(--bg-tertiary)',
                                                            borderRadius: '6px'
                                                        }}>
                                                            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                                                Ukupno: {prod.Quantity} kom
                                                            </span>
                                                            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>•</span>
                                                            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>U nalog:</span>
                                                            <input
                                                                type="number"
                                                                min="1"
                                                                max={prod.Quantity}
                                                                value={selectedProd.Work_Order_Quantity}
                                                                onClick={(e) => e.stopPropagation()}
                                                                onChange={(e) => {
                                                                    e.stopPropagation();
                                                                    const newQty = Math.max(1, Math.min(prod.Quantity, parseInt(e.target.value) || 1));
                                                                    setSelectedProducts(selectedProducts.map(p =>
                                                                        p.Product_ID === prod.Product_ID
                                                                            ? { ...p, Work_Order_Quantity: newQty }
                                                                            : p
                                                                    ));
                                                                }}
                                                                style={{
                                                                    width: '70px',
                                                                    padding: '4px 8px',
                                                                    border: '1px solid var(--border-color)',
                                                                    borderRadius: '4px',
                                                                    fontSize: '14px',
                                                                    fontWeight: 600,
                                                                    textAlign: 'center',
                                                                    background: 'var(--bg-primary)'
                                                                }}
                                                            />
                                                            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>kom</span>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                                    })}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* STEP 3: PROCESSES (production step 2, montaža step 1) */}
                        {(mode === 'montaza' && activeStep === 1) && (
                            <div className="wizard-step step-processes">
                                <div className="step-page-header text-center">
                                    <h3>Definišite procese</h3>
                                    <p>Ovi procesi će biti primijenjeni na sve odabrane proizvode.</p>
                                </div>
                                <div className="process-tags">
                                    {selectedProcesses.map(proc => (
                                        <div key={proc} className="process-tag">
                                            <span>{proc}</span>
                                            <button onClick={() => toggleProcess(proc)}>✕</button>
                                        </div>
                                    ))}
                                </div>
                                <div className="add-process-row">
                                    <input placeholder="Dodaj novi proces..." value={customProcessInput} onChange={e => setCustomProcessInput(e.target.value)}
                                        onKeyPress={e => e.key === 'Enter' && addCustomProcess()} />
                                    <button onClick={addCustomProcess}>Dodaj</button>
                                </div>
                            </div>
                        )}

                        {/* DETAILS & WORKERS (production step 1, montaža step 2) */}
                        {((mode === 'production' && activeStep === 1) || (mode === 'montaza' && activeStep === 2)) && (
                            <div className="wizard-step step-details" onClick={(e) => {
                                // Close dropdowns when clicking outside
                                if (!(e.target as HTMLElement).closest('.wdd')) { setOpenDropdown(null); setWorkerSearch(''); }
                            }}>
                                <div className="wz-col">
                                    {/* Postavke naloga — jedan poravnat red (naziv / početak / rok) */}
                                    <div className="wz-panel wz-panel-pad">
                                        <div className="wz-band">
                                            <div className="wz-field wz-c2">
                                                <label>Naziv naloga <em>· opciono</em></label>
                                                <input type="text" placeholder="npr. Kuhinja — Dino" value={workOrderName} onChange={e => setWorkOrderName(e.target.value)} />
                                            </div>
                                            <div className="wz-field">
                                                <label>Početak</label>
                                                <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
                                            </div>
                                            <div className="wz-field">
                                                <label>Rok završetka{totalPlannedDays > 0 ? ` · ${totalPlannedDays} d` : ''}</label>
                                                <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
                                            </div>
                                        </div>
                                        {suggestedDueDate && suggestedDueDate !== dueDate && (
                                            <button type="button" className="wz-suggest" onClick={() => setDueDate(suggestedDueDate)}>
                                                ⤵ Predloženo iz {totalPlannedDays} planirana radna dana: {suggestedDueDate}
                                            </button>
                                        )}
                                        <div className="wz-field" style={{ marginTop: 14 }}>
                                            <label>Napomena <em>· opciono</em></label>
                                            <input type="text" placeholder="Dodatne upute za radnike…" value={notes} onChange={e => setNotes(e.target.value)} />
                                        </div>
                                    </div>

                                    {/* Finansije — horizontalni strip (šta nalog nosi) */}
                                    {wizardFin && (
                                        <div className="wz-fin">
                                            <div className="wz-fin-cell"><span className="k">Vrijednost</span><span className="v">{fmtKM(wizardFin.value)}</span></div>
                                            <div className="wz-fin-cell"><span className="k">Materijal</span><span className="v">{fmtKM(wizardFin.material)}</span></div>
                                            <div className="wz-fin-cell"><span className="k">Planirani rad{totalPlannedDays > 0 ? ` · ${totalPlannedDays} d` : ''}</span><span className="v">{fmtKM(wizardFin.plannedLabor)}</span></div>
                                            {(wizardFin.transport > 0 || wizardFin.services > 0) && (
                                                <div className="wz-fin-cell"><span className="k">Transport + usluge</span><span className="v">{fmtKM(wizardFin.transport + wizardFin.services)}</span></div>
                                            )}
                                            <div className={`wz-fin-cell total ${wizardFin.profit >= 0 ? 'pos' : 'neg'}`}><span className="k">Procijenjeno ostaje</span><span className="v">{fmtKM(wizardFin.profit)}</span></div>
                                        </div>
                                    )}

                                    {/* Toggle narudžbi + objedinjeno upozorenje */}
                                    {(() => {
                                        const noWorker = selectedProducts.length > 0 && selectedProducts.every(p => Object.values(p.assignments || {}).every(v => !v));
                                        const showAdvisory = noWorker || undefinedProducts.length > 0;
                                        const showToggle = mode === 'production';
                                        if (!showAdvisory && !showToggle) return null;
                                        return (
                                            <div className={`wz-subrow${showToggle && showAdvisory ? '' : ' one'}`}>
                                                {showToggle && (
                                                    <label className="wz-toggle wz-panel">
                                                        <input type="checkbox" checked={createMaterialOrders} onChange={e => setCreateMaterialOrders(e.target.checked)} />
                                                        <span className="wz-toggle-txt">
                                                            <b>Predloži narudžbe materijala</b>
                                                            <span>Poslije kreiranja biraš dobavljače i materijale prije nego što se narudžba stvarno kreira.</span>
                                                        </span>
                                                    </label>
                                                )}
                                                {showAdvisory && (
                                                    <div className="wz-advisory wz-panel">
                                                        <div className="wz-adv-head"><span className="material-icons-round">warning_amber</span>Prije pokretanja</div>
                                                        <ul>
                                                            {noWorker && (
                                                                <li><span className="b" /><span><b>Nijedan radnik nije dodijeljen.</b> Nalog se neće moći pokrenuti dok ne dodijeliš radnika — možeš i kasnije.</span></li>
                                                            )}
                                                            {undefinedProducts.length > 0 && (
                                                                <li><span className="b" /><span><b>Nedefinisani proizvodi</b> (cijena/rok): {undefinedProducts.join(', ')} — rok i profit su potcijenjeni dok se ponuda ne dopuni.</span></li>
                                                            )}
                                                        </ul>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })()}

                                    {/* Dodjela radnika */}
                                    <div className="wz-assign wz-panel">
                                        <div className="wz-assign-head">
                                            <b>Dodjela radnika</b>
                                            <span>{selectedProducts.length} {selectedProducts.length === 1 ? 'proizvod' : 'proizvoda'}{mode === 'production' ? ' · jedna ekipa radi sve procese' : ''}</span>
                                        </div>

                                {/* Bulk assignment row */}
                                <div className="bulk-assign-bar">
                                    <div className="bulk-label">
                                        <span className="material-icons-round" style={{ fontSize: 16 }}>bolt</span>
                                        Dodjeli svima
                                    </div>
                                    <div className="bulk-controls">
                                        {/* Bulk main worker */}
                                        <div className="wdd" style={{ position: 'relative', flex: 1, minWidth: 180 }}>
                                            <button type="button" className="wdd-trigger" onClick={() => { setOpenDropdown(openDropdown === 'bulk-main' ? null : 'bulk-main'); setWorkerSearch(''); }}>
                                                <span className="material-icons-round wdd-icon">person</span>
                                                <span className="wdd-label">Glavni radnik</span>
                                                <span className="material-icons-round wdd-arrow">expand_more</span>
                                            </button>
                                            {openDropdown === 'bulk-main' && (
                                                <div className="wdd-menu">
                                                    <div className="wdd-search">
                                                        <span className="material-icons-round" style={{ fontSize: 16, color: '#94a3b8' }}>search</span>
                                                        <input autoFocus placeholder="Traži radnika..." value={workerSearch} onChange={e => setWorkerSearch(e.target.value)} />
                                                    </div>
                                                    <div className="wdd-options">
                                                        {workers.filter(w => (w.Worker_Type === 'Glavni' || !w.Worker_Type) && w.Name.toLowerCase().includes(workerSearch.toLowerCase())).map(w => (
                                                            <button key={w.Worker_ID} type="button" className="wdd-option" onClick={() => { assignWorkerToAllProcesses(w.Worker_ID); setOpenDropdown(null); setWorkerSearch(''); }}>
                                                                <span className="wdd-name">{w.Name}</span>
                                                                {w.Role && <span className="wdd-role">{w.Role}</span>}
                                                            </button>
                                                        ))}
                                                        {workers.filter(w => (w.Worker_Type === 'Glavni' || !w.Worker_Type) && w.Name.toLowerCase().includes(workerSearch.toLowerCase())).length === 0 && (
                                                            <div className="wdd-empty">Nema rezultata</div>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                        {/* Bulk helpers */}
                                        <div className="wdd" style={{ position: 'relative', flex: 1, minWidth: 180 }}>
                                            <button type="button" className="wdd-trigger" onClick={() => { setOpenDropdown(openDropdown === 'bulk-helpers' ? null : 'bulk-helpers'); setWorkerSearch(''); }}>
                                                <span className="material-icons-round wdd-icon">group</span>
                                                <span className="wdd-label">Pomoćnici</span>
                                                <span className="material-icons-round wdd-arrow">expand_more</span>
                                            </button>
                                            {openDropdown === 'bulk-helpers' && (
                                                <div className="wdd-menu">
                                                    <div className="wdd-search">
                                                        <span className="material-icons-round" style={{ fontSize: 16, color: '#94a3b8' }}>search</span>
                                                        <input autoFocus placeholder="Traži pomoćnika..." value={workerSearch} onChange={e => setWorkerSearch(e.target.value)} />
                                                    </div>
                                                    <div className="wdd-options">
                                                        {workers.filter(w => w.Name.toLowerCase().includes(workerSearch.toLowerCase())).map(w => {
                                                            // Check if this helper is in the first product+process combo (as representative)
                                                            const isSelected = selectedProducts.length > 0 && selectedProcesses.length > 0 &&
                                                                (selectedProducts[0].helperAssignments?.[selectedProcesses[0]] || []).includes(w.Worker_ID);
                                                            return (
                                                                <button key={w.Worker_ID} type="button" className={`wdd-option ${isSelected ? 'selected' : ''}`}
                                                                    onClick={() => {
                                                                        // Toggle: if already assigned everywhere, remove; otherwise add
                                                                        const currentGlobalHelpers = selectedProducts.length > 0 && selectedProcesses.length > 0
                                                                            ? (selectedProducts[0].helperAssignments?.[selectedProcesses[0]] || [])
                                                                            : [];
                                                                        const newHelpers = currentGlobalHelpers.includes(w.Worker_ID)
                                                                            ? currentGlobalHelpers.filter((id: string) => id !== w.Worker_ID)
                                                                            : [...currentGlobalHelpers, w.Worker_ID];
                                                                        assignHelpersToAllProcesses(newHelpers);
                                                                    }}>
                                                                    <span className="wdd-check">{isSelected ? '✓' : ''}</span>
                                                                    <span className="wdd-name">{w.Name}</span>
                                                                    {w.Role && <span className="wdd-role">{w.Role}</span>}
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <div className="matrix-wrapper full-height">
                                    <div className="mw-header">
                                        <div className="m-col product">Proizvod</div>
                                        {selectedProcesses.map(proc => (
                                            <div key={proc} className="m-col process">
                                                <span className="process-header-title">{procLabel(proc)}</span>
                                                {/* Per-process bulk assign */}
                                                <div className="wdd" style={{ position: 'relative', width: '100%' }}>
                                                    <button type="button" className="wdd-trigger compact" onClick={() => { setOpenDropdown(openDropdown === `hdr-${proc}` ? null : `hdr-${proc}`); setWorkerSearch(''); }}>
                                                        <span className="wdd-label">Svima</span>
                                                        <span className="material-icons-round wdd-arrow">expand_more</span>
                                                    </button>
                                                    {openDropdown === `hdr-${proc}` && (
                                                        <div className="wdd-menu">
                                                            <div className="wdd-search">
                                                                <span className="material-icons-round" style={{ fontSize: 16, color: '#94a3b8' }}>search</span>
                                                                <input autoFocus placeholder="Traži..." value={workerSearch} onChange={e => setWorkerSearch(e.target.value)} />
                                                            </div>
                                                            <div className="wdd-options">
                                                                {workers.filter(w => w.Name.toLowerCase().includes(workerSearch.toLowerCase())).map(w => (
                                                                    <button key={w.Worker_ID} type="button" className="wdd-option" onClick={() => { assignWorkerToAll(proc, w.Worker_ID); setOpenDropdown(null); setWorkerSearch(''); }}>
                                                                        <span className="wdd-name">{w.Name}</span>
                                                                        {w.Role && <span className="wdd-role">{w.Role}</span>}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="mw-body">
                                        {selectedProducts.map(prod => (
                                            <div key={prod.Product_ID} className="m-row">
                                                <div className="m-col product">
                                                    <strong>{prod.Product_Name}</strong>
                                                    <small>{prod.Project_Name}</small>
                                                </div>
                                                {selectedProcesses.map(proc => {
                                                    const mainWorkerId = prod.assignments[proc];
                                                    const helpers = prod.helperAssignments?.[proc] || [];
                                                    const mainWorker = workers.find(w => w.Worker_ID === mainWorkerId);
                                                    const dropdownId = `${prod.Product_ID}-${proc}`;
                                                    const helperDropdownId = `${prod.Product_ID}-${proc}-helpers`;

                                                    return (
                                                        <div key={proc} className="m-col process" style={{ gap: '4px' }}>
                                                            {/* Main worker searchable dropdown */}
                                                            <div className="wdd" style={{ position: 'relative', width: '100%' }}>
                                                                <button type="button" className={`wdd-trigger compact ${mainWorkerId ? 'filled' : ''}`}
                                                                    onClick={() => { setOpenDropdown(openDropdown === dropdownId ? null : dropdownId); setWorkerSearch(''); }}>
                                                                    <span className="wdd-label">{mainWorker ? mainWorker.Name : 'Odaberi'}</span>
                                                                    <span className="material-icons-round wdd-arrow">expand_more</span>
                                                                </button>
                                                                {openDropdown === dropdownId && (
                                                                    <div className="wdd-menu">
                                                                        <div className="wdd-search">
                                                                            <span className="material-icons-round" style={{ fontSize: 16, color: '#94a3b8' }}>search</span>
                                                                            <input autoFocus placeholder="Traži radnika..." value={workerSearch} onChange={e => setWorkerSearch(e.target.value)} />
                                                                        </div>
                                                                        <div className="wdd-options">
                                                                            <button type="button" className="wdd-option wdd-option-clear" onClick={() => { assignWorker(prod.Product_ID, proc, ''); setOpenDropdown(null); setWorkerSearch(''); }}>
                                                                                <span className="material-icons-round" style={{ fontSize: 14, color: '#94a3b8' }}>close</span>
                                                                                <span className="wdd-name" style={{ color: '#94a3b8' }}>Ukloni odabir</span>
                                                                            </button>
                                                                            {workers.filter(w => (w.Worker_Type === 'Glavni' || !w.Worker_Type) && w.Name.toLowerCase().includes(workerSearch.toLowerCase())).map(w => (
                                                                                <button key={w.Worker_ID} type="button" className={`wdd-option ${w.Worker_ID === mainWorkerId ? 'selected' : ''}`}
                                                                                    onClick={() => { assignWorker(prod.Product_ID, proc, w.Worker_ID); setOpenDropdown(null); setWorkerSearch(''); }}>
                                                                                    <span className="wdd-name">{w.Name}</span>
                                                                                    {w.Role && <span className="wdd-role">{w.Role}</span>}
                                                                                </button>
                                                                            ))}
                                                                        </div>
                                                                    </div>
                                                                )}
                                                            </div>

                                                            {/* Helper pills + add button */}
                                                            {mainWorkerId && (
                                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', alignItems: 'center' }}>
                                                                    {helpers.map(hId => {
                                                                        const h = workers.find(w => w.Worker_ID === hId);
                                                                        return h ? (
                                                                            <span key={hId} className="helper-pill">
                                                                                {h.Name.split(' ')[0]}
                                                                                <button type="button" onClick={() => toggleHelper(prod.Product_ID, proc, hId)}>×</button>
                                                                            </span>
                                                                        ) : null;
                                                                    })}
                                                                    <div className="wdd" style={{ position: 'relative' }}>
                                                                        <button type="button" className="helper-add-btn"
                                                                            onClick={() => { setOpenDropdown(openDropdown === helperDropdownId ? null : helperDropdownId); setWorkerSearch(''); }}>
                                                                            +
                                                                        </button>
                                                                        {openDropdown === helperDropdownId && (
                                                                            <div className="wdd-menu" style={{ minWidth: 200 }}>
                                                                                <div className="wdd-search">
                                                                                    <span className="material-icons-round" style={{ fontSize: 16, color: '#94a3b8' }}>search</span>
                                                                                    <input autoFocus placeholder="Traži pomoćnika..." value={workerSearch} onChange={e => setWorkerSearch(e.target.value)} />
                                                                                </div>
                                                                                <div className="wdd-options">
                                                                                    {workers.filter(w => w.Worker_ID !== mainWorkerId && w.Name.toLowerCase().includes(workerSearch.toLowerCase())).map(w => {
                                                                                        const isH = helpers.includes(w.Worker_ID);
                                                                                        return (
                                                                                            <button key={w.Worker_ID} type="button" className={`wdd-option ${isH ? 'selected' : ''}`}
                                                                                                onClick={() => toggleHelper(prod.Product_ID, proc, w.Worker_ID)}>
                                                                                                <span className="wdd-check">{isH ? '✓' : ''}</span>
                                                                                                <span className="wdd-name">{w.Name}</span>
                                                                                            </button>
                                                                                        );
                                                                                    })}
                                                                                </div>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                    </div>

                                    {/* Zadaci uz nalog — dno kolone (vežu se čim nalog nastane) */}
                                    <div className="wz-panel wz-tasks-panel">
                                        <TaskAttachEditor
                                            value={taskSelection}
                                            onChange={setTaskSelection}
                                            tasks={tasks}
                                            workers={workers}
                                            products={selectedProducts.map(p => ({ Product_ID: p.Product_ID, Product_Name: p.Product_Name }))}
                                            suggestedIds={suggestedTaskIds}
                                            pickerZIndex={2000}
                                        />
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </Modal>

            {/* Izbor narudžbi materijala — otvara se TEK poslije uspješnog kreiranja
                naloga (orderSelectPrompt), neovisno o wizard-ovom Modal-u iznad koji
                se već zatvorio. Vidi handleCreateWorkOrder. */}
            {orderSelectPrompt && organizationId && (
                <MaterialOrderSelectModal
                    isOpen={true}
                    onClose={() => setOrderSelectPrompt(null)}
                    workOrderId={orderSelectPrompt.workOrderId}
                    workOrderLabel={orderSelectPrompt.label}
                    plannedStartDate={orderSelectPrompt.startDate}
                    organizationId={organizationId}
                    onRefresh={onRefresh}
                    showToast={showToast}
                />
            )}

            <style jsx>{`
                /* Wizard Layout */
                .wizard-container { display: flex; flex-direction: column; height: 100vh; background: #f5f5f7; overflow: hidden; }
                
                /* HEADER */
                .wizard-header {
                    flex-shrink: 0;
                    background: var(--background);
                    padding: 12px 18px;
                    border-bottom: 1px solid var(--border-light);
                    display: grid;
                    grid-template-columns: 1fr auto 1fr;
                    align-items: center;
                    gap: 12px;
                    height: 60px;
                }

                .header-left { display: flex; justify-content: flex-start; }
                .header-right { display: flex; justify-content: flex-end; }

                .steps-indicator { display: flex; align-items: center; justify-content: center; gap: 8px; }
                .step-item { display: flex; align-items: center; gap: 8px; transition: all 0.2s; }
                .step-circle { width: 24px; height: 24px; border-radius: 50%; background: var(--surface-hover); color: var(--text-secondary); display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 12px; }
                .step-item.active .step-circle { background: var(--accent); color: #fff; }
                .step-item.current .step-circle { box-shadow: 0 0 0 4px var(--accent-light); }
                .step-title { font-weight: 600; font-size: 13px; color: var(--text-tertiary); white-space: nowrap; }
                .step-item.active .step-title { color: var(--text-secondary); }
                .step-item.current .step-title { color: var(--text-primary); }
                .step-line { width: 34px; height: 2px; background: var(--border); border-radius: 2px; }
                .step-item.active .step-line { background: var(--accent); }

                /* NAV BUTTONS */
                .btn-nav {
                    padding: 0 18px;
                    border-radius: var(--cm-r-pill);
                    font-size: 13px;
                    font-weight: 600;
                    display: inline-flex;
                    align-items: center;
                    gap: 7px;
                    border: 1px solid transparent;
                    cursor: pointer;
                    transition: all 0.15s ease;
                    height: 36px;
                }
                .btn-nav.back { background: var(--background); border-color: var(--border); color: var(--text-primary); }
                .btn-nav.back:hover { background: var(--surface); }
                .btn-nav.next { background: var(--accent); color: #fff; font-weight: 700; }
                .btn-nav.next:hover { background: var(--accent-hover); }
                .btn-nav.finish { background: var(--accent); color: #fff; font-weight: 700; }
                .btn-nav.finish:hover { background: var(--accent-hover); }
                .btn-nav:disabled { opacity: 0.45; cursor: not-allowed; }
                .btn-nav .material-icons-round { font-size: 16px; }

                /* Body - NO SCROLL (individual steps manage their own) */
                .wizard-body { 
                    flex: 1; 
                    overflow: hidden; 
                    padding: 20px; 
                    display: flex; 
                    justify-content: center; 
                    align-items: flex-start; 
                }
                .wizard-step { 
                    width: 100%; 
                    max-width: 1200px; 
                    display: flex; 
                    flex-direction: column; 
                    height: 100%; 
                    overflow: hidden;
                }
                .step-page-header { margin-bottom: 20px; text-align: left; flex-shrink: 0; }
                .step-page-header h3 { font-size: 20px; margin: 0; font-weight: 700; color: var(--text-primary); }
                .step-page-header p { font-size: 14px; color: var(--text-secondary); margin: 6px 0 0 0; }
                .text-center { text-align: center; }

                /* Step 1: Projects Grid */
                .step-projects { overflow-y: auto; padding-bottom: 20px; }
                .project-search-container { margin-bottom: 24px; display: flex; justify-content: center; }
                .wz-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
                .wz-card { 
                    padding: 20px; 
                    border-radius: 12px; 
                    border: 2px solid transparent; 
                    background: white; 
                    cursor: pointer; 
                    display: flex; 
                    gap: 16px; 
                    align-items: flex-start; 
                    transition: all 0.2s; 
                    box-shadow: 0 1px 3px rgba(0,0,0,0.08);
                }
                .wz-card:hover { border-color: var(--accent); transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.12); }
                .wz-card.selected { border-color: var(--accent); background: #f0f7ff; box-shadow: 0 4px 12px rgba(0, 113, 227, 0.15); }
                .wz-card .material-icons-round { font-size: 24px; color: #ccc; transition: color 0.2s; }
                .wz-card.selected .material-icons-round { color: var(--accent); }
                .card-info { display: flex; flex-direction: column; gap: 8px; flex: 1; }
                .card-title { font-size: 16px; font-weight: 600; color: var(--text-primary); display: block; line-height: 1.3; }
                
                .card-badges { display: flex; flex-wrap: wrap; gap: 6px; }
                .card-badge { 
                    display: inline-flex; 
                    align-items: center; 
                    gap: 4px;
                    font-size: 11px; 
                    color: var(--text-secondary); 
                    background: #f0f0f0; 
                    padding: 2px 8px; 
                    border-radius: 6px; 
                    font-weight: 600;
                }
                .card-badge.success { background: #d3f9d8; color: #155724; }

                /* Step 2: Products List */
                .step-products { display: flex; flex-direction: column; overflow: hidden; }
                .step-toolbar { 
                    flex-shrink: 0;
                    display: flex; 
                    justify-content: space-between; 
                    align-items: center; 
                    margin-bottom: 16px; 
                    background: white; 
                    padding: 12px 16px; 
                    border-radius: 10px; 
                    box-shadow: 0 1px 3px rgba(0,0,0,0.08);
                }
                .tb-left { display: flex; align-items: center; gap: 12px; }
                .tb-left h3 { font-size: 16px; margin: 0; font-weight: 600; }
                .tb-stats { 
                    font-size: 12px; 
                    color: var(--accent); 
                    font-weight: 600; 
                    background: rgba(0,113,227,0.1); 
                    padding: 4px 12px; 
                    border-radius: 12px; 
                }
                .tb-right { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
                .search-input { 
                    background: #f5f5f7; 
                    padding: 8px 12px; 
                    border-radius: 8px; 
                    display: flex; 
                    align-items: center; 
                    gap: 8px; 
                    border: 1px solid transparent; 
                    width: 260px; 
                    transition: all 0.2s;
                }
                .search-input:focus-within { background: white; border-color: var(--accent); }
                .search-input .material-icons-round { font-size: 18px; color: var(--text-secondary); }
                .search-input input { 
                    border: none; 
                    outline: none; 
                    background: transparent; 
                    width: 100%; 
                    font-size: 13px; 
                    color: var(--text-primary);
                }
                .btn-text { 
                    background: none; 
                    border: none; 
                    font-weight: 600; 
                    color: var(--accent); 
                    cursor: pointer; 
                    font-size: 13px; 
                    padding: 6px 12px; 
                    border-radius: 6px; 
                    transition: background 0.2s;
                }
                .btn-text:hover { background: rgba(0,113,227,0.08); }
                .btn-text.danger { color: var(--danger); }
                .btn-text.danger:hover { background: rgba(220,53,69,0.08); }
                
                .wz-list-scroll { 
                    flex: 1; 
                    overflow-y: auto; 
                    background: white; 
                    border-radius: 12px; 
                    border: 1px solid #e0e0e0; 
                    box-shadow: 0 1px 3px rgba(0,0,0,0.08); 
                }
                .wz-list { display: flex; flex-direction: column; }
                .wz-list-item { 
                    padding: 14px 20px; 
                    border-bottom: 1px solid #f0f0f0; 
                    display: flex; 
                    align-items: center; 
                    gap: 16px; 
                    cursor: pointer; 
                    transition: background 0.15s;
                }
                .wz-list-item:last-child { border-bottom: none; }
                .wz-list-item:hover { background: #f9fafb; }
                .wz-list-item.selected { background: #f0f7ff; border-left: 3px solid var(--accent); }
                .wz-list-item .icon-check { font-size: 22px; color: #d0d0d0; transition: color 0.2s; }
                .wz-list-item.selected .icon-check { color: var(--accent); }
                .li-content { flex: 1; display: flex; flex-direction: column; gap: 2px; }
                .li-title { display: block; font-weight: 600; font-size: 14px; color: var(--text-primary); }
                .li-sub { font-size: 12px; color: var(--text-secondary); }
                .li-qty { 
                    font-weight: 600; 
                    background: #e8f4ff; 
                    color: var(--accent); 
                    padding: 4px 10px; 
                    border-radius: 8px; 
                    font-size: 12px; 
                }

                /* Step 3: Processes */
                .step-processes { display: flex; flex-direction: column; align-items: center; padding: 40px 20px; overflow-y: auto; }
                .process-tags { 
                    display: flex; 
                    flex-wrap: wrap; 
                    gap: 12px; 
                    justify-content: center; 
                    margin: 32px 0; 
                }
                .process-tag { 
                    background: white; 
                    padding: 12px 20px; 
                    border-radius: 24px; 
                    border: 2px solid #e0e0e0; 
                    font-weight: 600; 
                    display: flex; 
                    align-items: center; 
                    gap: 10px; 
                    font-size: 14px; 
                    box-shadow: 0 2px 6px rgba(0,0,0,0.06); 
                    transition: all 0.2s;
                }
                .process-tag:hover { transform: translateY(-1px); box-shadow: 0 4px 10px rgba(0,0,0,0.1); }
                .process-tag button { 
                    background: #f0f0f0; 
                    width: 22px; 
                    height: 22px; 
                    border-radius: 50%; 
                    border: none; 
                    display: flex; 
                    align-items: center; 
                    justify-content: center; 
                    cursor: pointer; 
                    font-size: 12px; 
                    color: #666; 
                    transition: all 0.2s;
                }
                .process-tag button:hover { background: var(--danger); color: white; transform: scale(1.1); }
                .add-process-row { display: flex; gap: 12px; max-width: 500px; width: 100%; }
                .add-process-row input { 
                    flex: 1; 
                    padding: 14px 20px; 
                    border-radius: 24px; 
                    border: 2px solid #e0e0e0; 
                    outline: none; 
                    transition: all 0.2s; 
                    font-size: 14px;
                }
                .add-process-row input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(0,113,227,0.1); }
                .add-process-row button { 
                    padding: 0 28px; 
                    border-radius: 24px; 
                    border: none; 
                    background: var(--accent); 
                    color: white; 
                    font-weight: 600; 
                    cursor: pointer; 
                    font-size: 14px; 
                    transition: all 0.2s;
                }
                .add-process-row button:hover { background: #0056b3; transform: scale(1.02); }

                /* Step "Radnik & rok" — centrirana kolona poravnatih traka */
                .step-details { height: 100%; overflow-y: auto; overflow-x: hidden; }
                .wz-col { max-width: 1040px; margin: 0 auto; display: flex; flex-direction: column; gap: 16px; }

                .wz-panel { background: var(--background); border: 1px solid var(--border-light); border-radius: var(--cm-r-card); box-shadow: var(--cm-shadow-card); }
                .wz-panel-pad { padding: 16px; }

                /* Polje: FIKSNA visina labele → svi inputi ostaju u istoj liniji (labela se ne lomi) */
                .wz-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
                .wz-field label { height: 16px; line-height: 16px; font-size: var(--cm-fs-xs); font-weight: 600; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-transform: none; letter-spacing: normal; }
                .wz-field label em { font-style: normal; font-weight: 400; color: var(--text-tertiary); }
                .wz-field input {
                    width: 100%; height: 40px; box-sizing: border-box; padding: 0 12px;
                    border: 1px solid var(--border); border-radius: var(--cm-r-control);
                    font-size: var(--cm-fs-md); color: var(--text-primary); background: var(--background);
                    outline: none; transition: var(--transition);
                }
                .wz-field input:focus { border-color: var(--accent); box-shadow: var(--cm-focus-ring); }
                .wz-band { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
                .wz-c2 { grid-column: span 2; }
                .wz-suggest { align-self: flex-start; margin-top: 10px; display: inline-flex; align-items: center; gap: 5px; font-size: var(--cm-fs-xs); font-weight: 600; color: var(--accent); background: none; border: none; padding: 0; cursor: pointer; }
                .wz-suggest:hover { text-decoration: underline; }

                /* Finansije — horizontalni strip, poravnate ćelije */
                .wz-fin { display: grid; grid-template-columns: repeat(4, 1fr); border: 1px solid var(--border-light); border-radius: var(--cm-r-card); overflow: hidden; box-shadow: var(--cm-shadow-card); }
                .wz-fin-cell { padding: 11px 14px; border-right: 1px solid var(--border-light); display: flex; flex-direction: column; gap: 3px; background: var(--background); }
                .wz-fin-cell:last-child { border-right: none; }
                .wz-fin-cell .k { font-size: var(--cm-fs-xs); color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                .wz-fin-cell .v { font-size: var(--cm-fs-lg); font-weight: 700; color: var(--text-primary); font-variant-numeric: tabular-nums; }
                .wz-fin-cell.total { background: var(--success-bg); }
                .wz-fin-cell.total .k { color: #1a7f37; font-weight: 600; }
                .wz-fin-cell.total .v { color: #1a7f37; font-weight: 800; }
                .wz-fin-cell.total.neg { background: var(--error-bg); }
                .wz-fin-cell.total.neg .k, .wz-fin-cell.total.neg .v { color: #b3261e; }

                /* Toggle + upozorenje u jednom redu */
                .wz-subrow { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: stretch; }
                .wz-subrow.one { grid-template-columns: 1fr; }
                .wz-toggle { display: flex; align-items: flex-start; gap: 10px; padding: 12px 14px; cursor: pointer; }
                .wz-toggle input { width: 18px; height: 18px; margin: 1px 0 0; accent-color: var(--accent); flex-shrink: 0; }
                .wz-toggle-txt { display: flex; flex-direction: column; gap: 2px; }
                .wz-toggle-txt b { font-size: var(--cm-fs-sm); font-weight: 600; color: var(--text-primary); }
                .wz-toggle-txt span { font-size: var(--cm-fs-xs); color: var(--text-secondary); line-height: 1.4; }

                .wz-advisory { padding: 12px 14px; background: var(--warning-bg); border-color: #f0d79a; }
                .wz-adv-head { display: flex; align-items: center; gap: 7px; font-size: var(--cm-fs-sm); font-weight: 700; color: var(--cm-warn-text); margin-bottom: 8px; }
                .wz-adv-head .material-icons-round { font-size: 17px; color: var(--warning); }
                .wz-advisory ul { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 6px; }
                .wz-advisory li { display: flex; gap: 8px; font-size: var(--cm-fs-xs); color: var(--cm-warn-text); line-height: 1.45; }
                .wz-advisory li .b { width: 5px; height: 5px; border-radius: 50%; background: var(--warning); flex-shrink: 0; margin-top: 6px; }

                /* Dodjela radnika — panel s horizontalnim trakama (bez okvira-u-okviru) */
                .wz-assign { display: flex; flex-direction: column; overflow: hidden; }
                .wz-assign-head { padding: 14px 18px; border-bottom: 1px solid var(--border-light); }
                .wz-assign-head b { display: block; font-size: var(--cm-fs-md); font-weight: 700; color: var(--text-primary); }
                .wz-assign-head span { font-size: var(--cm-fs-xs); color: var(--text-secondary); }
                .wz-tasks-panel { padding: 12px 16px; }

                /* Bulk Assignment Bar — mirna alatna traka, puna širina panela */
                .bulk-assign-bar {
                    display: flex; align-items: center; gap: 12px;
                    margin: 0; padding: 10px 18px;
                    background: var(--surface); border: none;
                    border-bottom: 1px solid var(--border-light); border-radius: 0;
                }
                .bulk-label { display: flex; align-items: center; gap: 6px; font-size: var(--cm-fs-xs); font-weight: 700; color: var(--text-secondary); white-space: nowrap; }
                .bulk-label .material-icons-round { color: var(--accent); }
                .bulk-controls { display: flex; gap: 10px; flex: 1; }

                /* Matrix Container */
                .matrix-wrapper.full-height {
                    display: flex;
                    flex-direction: column;
                    margin: 0;
                    background: transparent;
                    border: none;
                    border-radius: 0;
                    overflow: visible;
                    box-shadow: none;
                }
                .mw-header {
                    display: flex;
                    background: var(--background);
                    border-bottom: 1px solid var(--border-light);
                    position: sticky;
                    top: 0;
                    z-index: 5;
                }
                .mw-body { flex: 1; overflow-y: auto; }
                .m-row { display: flex; border-bottom: 1px solid rgba(0,0,0,0.04); transition: background 0.15s; }
                .m-row:hover { background: #f8f9fb; }
                .m-row:last-child { border-bottom: none; }
                .m-col { 
                    padding: 14px 16px; 
                    border-right: 1px solid rgba(0,0,0,0.04); 
                    display: flex; 
                    align-items: center; 
                }
                .m-col:last-child { border-right: none; }
                .m-col.product {
                    width: 280px;
                    flex-shrink: 0;
                    flex-direction: column;
                    align-items: flex-start;
                    justify-content: center;
                    gap: 3px;
                    background: transparent;
                }
                .m-col.product strong { font-size: 13px; font-weight: 600; color: var(--text-primary); letter-spacing: -0.1px; }
                .m-col.product small { font-size: 11px; color: var(--text-secondary); font-weight: 400; }
                .m-col.process { 
                    flex: 1; 
                    min-width: 160px; 
                    justify-content: center; 
                    flex-direction: column; 
                    gap: 6px; 
                }
                /* Process header titles in matrix */
                .process-header-title {
                    font-size: var(--cm-fs-xs);
                    font-weight: 700;
                    color: var(--text-secondary);
                    letter-spacing: -0.01em;
                }
                .mw-header .m-col.process {
                    padding: 12px 12px;
                    gap: 8px;
                }
                .mw-header .m-col.product {
                    font-size: var(--cm-fs-xs);
                    font-weight: 700;
                    color: var(--text-secondary);
                    letter-spacing: -0.01em;
                    padding: 12px 16px;
                }

                /* Worker Dropdown (wdd) — Modern Design */
                .wdd-trigger {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    width: 100%;
                    padding: 8px 12px;
                    border: 1px solid rgba(0,0,0,0.1);
                    border-radius: 10px;
                    background: #f8f9fb;
                    font-size: 13px;
                    font-weight: 500;
                    color: var(--text-primary);
                    cursor: pointer;
                    transition: all 0.2s ease;
                    text-align: left;
                    height: 38px;
                }
                .wdd-trigger:hover { 
                    border-color: rgba(0,0,0,0.18); 
                    background: #f0f2f5;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.04);
                }
                .wdd-trigger.compact { 
                    padding: 6px 10px; 
                    font-size: 12px; 
                    height: 34px; 
                    border-radius: 8px;
                    font-weight: 500;
                }
                .wdd-trigger.filled {
                    border-color: rgba(16,185,129,0.3);
                    background: linear-gradient(135deg, #ecfdf5 0%, #f0fdf4 100%);
                    color: #065f46;
                    font-weight: 600;
                    box-shadow: 0 1px 3px rgba(16,185,129,0.08);
                }
                .wdd-trigger.filled:hover {
                    border-color: rgba(16,185,129,0.5);
                    background: linear-gradient(135deg, #d1fae5 0%, #ecfdf5 100%);
                }
                .wdd-icon { 
                    font-size: 16px !important; 
                    flex-shrink: 0; 
                    color: #94a3b8;
                }
                .wdd-trigger.filled .wdd-icon { color: #059669; }
                .wdd-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
                .wdd-arrow { 
                    font-size: 18px !important; 
                    color: #94a3b8; 
                    flex-shrink: 0; 
                    line-height: 1;
                    transition: transform 0.2s ease; 
                }

                /* Dropdown Menu */
                .wdd-menu {
                    position: absolute;
                    top: calc(100% + 4px);
                    left: 0;
                    right: 0;
                    min-width: 220px;
                    background: white;
                    border: 1px solid rgba(0,0,0,0.08);
                    border-radius: 12px;
                    box-shadow: 0 8px 24px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.06);
                    z-index: 100;
                    overflow: hidden;
                    animation: wddFadeIn 0.15s ease-out;
                }
                @keyframes wddFadeIn {
                    from { opacity: 0; transform: translateY(-6px) scale(0.98); }
                    to { opacity: 1; transform: translateY(0) scale(1); }
                }
                .wdd-search {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 6px;
                    margin: 8px 8px 4px 8px;
                    background: #f5f7fa;
                    border-radius: 8px;
                    border: 1px solid transparent;
                    transition: all 0.15s ease;
                }
                .wdd-search:focus-within {
                    background: white;
                    border-color: rgba(0,113,227,0.3);
                    box-shadow: 0 0 0 2px rgba(0,113,227,0.06);
                }
                .wdd-search input {
                    border: none;
                    outline: none;
                    background: transparent;
                    font-size: 13px;
                    font-weight: 400;
                    width: 100%;
                    color: var(--text-primary);
                }
                .wdd-search input::placeholder { color: #b0b8c4; }
                .wdd-options {
                    max-height: 200px;
                    overflow-y: auto;
                    padding: 4px 6px 6px 6px;
                }
                .wdd-options::-webkit-scrollbar { width: 4px; }
                .wdd-options::-webkit-scrollbar-thumb { background: #d4d8de; border-radius: 4px; }
                .wdd-option {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    width: 100%;
                    padding: 8px 10px;
                    border: none;
                    background: transparent;
                    font-size: 13px;
                    font-weight: 450;
                    color: var(--text-primary);
                    cursor: pointer;
                    text-align: left;
                    border-radius: 8px;
                    transition: all 0.12s ease;
                }
                .wdd-option:hover { background: #f1f5f9; }
                .wdd-option.selected { 
                    background: #eff6ff; 
                    color: #1e40af; 
                    font-weight: 600;
                }
                .wdd-option-clear { border-bottom: 1px solid #f0f2f5; border-radius: 8px 8px 0 0; margin-bottom: 2px; }
                .wdd-name { flex: 1; }
                .wdd-role { 
                    font-size: 11px; 
                    color: #94a3b8; 
                    font-weight: 500;
                    background: #f1f5f9;
                    padding: 1px 6px;
                    border-radius: 4px;
                }
                .wdd-check { width: 16px; text-align: center; color: #3b82f6; font-weight: 700; font-size: 12px; }
                .wdd-empty { padding: 16px; text-align: center; color: #94a3b8; font-size: 13px; }

                /* Helper Pills — Refined */
                .helper-pill {
                    display: inline-flex;
                    align-items: center;
                    gap: 3px;
                    padding: 2px 8px;
                    background: linear-gradient(135deg, #eff6ff, #f0f7ff);
                    border: 1px solid rgba(59,130,246,0.15);
                    border-radius: 8px;
                    font-size: 11px;
                    font-weight: 500;
                    color: #2563eb;
                    line-height: 18px;
                    letter-spacing: -0.1px;
                }
                .helper-pill button {
                    background: none;
                    border: none;
                    color: #93c5fd;
                    cursor: pointer;
                    padding: 0 0 0 2px;
                    font-size: 12px;
                    line-height: 1;
                    transition: color 0.15s;
                }
                .helper-pill button:hover { color: #ef4444; }

                .helper-add-btn {
                    width: 22px;
                    height: 22px;
                    border-radius: 6px;
                    border: 1px solid rgba(59,130,246,0.2);
                    background: #f0f5ff;
                    color: #3b82f6;
                    font-size: 13px;
                    font-weight: 600;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: all 0.15s ease;
                    line-height: 1;
                }
                .helper-add-btn:hover { 
                    background: #dbeafe; 
                    border-color: #3b82f6; 
                    transform: scale(1.05);
                    box-shadow: 0 1px 4px rgba(59,130,246,0.15);
                }


                /* Uske širine: trake se lome na manje kolona */
                @media (max-width: 820px) {
                    .wz-band { grid-template-columns: 1fr 1fr; }
                    .wz-fin { grid-template-columns: 1fr 1fr; }
                    .wz-subrow { grid-template-columns: 1fr; }
                }

                /* TABLET RESPONSIVE (768px - 1024px) */
                @media (max-width: 1024px) and (min-width: 768px) {
                    /* Header adjustments */
                    .wizard-header { 
                        grid-template-columns: 80px 1fr 80px; 
                        padding: 8px 12px; 
                    }
                    .step-title { font-size: 10px; }
                    .btn-nav { padding: 5px 12px; font-size: 11px; height: 28px; }
                    
                    /* Body padding */
                    .wizard-body { padding: 16px; }
                    
                    /* Step 1: Projects Grid */
                    .wz-grid { grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
                    .wz-card { padding: 16px; gap: 12px; }
                    .wz-card .material-icons-round { font-size: 24px; }
                    .card-title { font-size: 14px; }
                    
                    /* Step 2: Products */
                    .step-toolbar { flex-wrap: wrap; gap: 12px; padding: 10px 12px; }
                    .tb-left { flex-wrap: wrap; }
                    .tb-right { width: 100%; justify-content: space-between; }
                    .search-input { width: 100%; max-width: 100%; }
                    
                    /* Step 3: Processes */
                    .step-processes { padding: 30px 16px; }
                    .process-tag { padding: 10px 16px; font-size: 13px; }
                    .add-process-row { max-width: 100%; }
                    
                    /* Step "Radnik & rok": matrica */
                    .m-col.product { width: 200px; }
                    .m-col.process { min-width: 140px; }
                }

                /* MOBILE RESPONSIVE (< 768px) */
                @media (max-width: 767px) {
                    .wizard-header { 
                        grid-template-columns: 60px 1fr 60px; 
                        padding: 6px 10px; 
                        height: 50px;
                    }
                    .step-title { display: none; }
                    .step-line { width: 10px; }
                    .btn-nav { padding: 4px 10px; font-size: 10px; height: 26px; }
                    .btn-nav .material-icons-round { font-size: 12px; }
                    
                    .wizard-body { padding: 12px; }
                    .step-page-header h3 { font-size: 18px; }
                    .step-page-header p { font-size: 13px; }
                    
                    /* Projects */
                    .wz-grid { grid-template-columns: 1fr; gap: 10px; }
                    
                    /* Products */
                    .step-toolbar { flex-direction: column; gap: 10px; align-items: stretch; }
                    .tb-left, .tb-right { width: 100%; }
                    .search-input { width: 100%; }
                    
                    /* Processes */
                    .step-processes { padding: 20px 12px; }
                    .add-process-row { flex-direction: column; }
                    
                    /* Matrica */
                    .m-col.product { width: 150px; font-size: 12px; }
                    .m-col.process { min-width: 120px; }
                }
            `}</style>
        </>
    );
}
