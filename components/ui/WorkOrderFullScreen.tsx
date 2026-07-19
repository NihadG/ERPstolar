'use client';

// ════════════════════════════════════════════════════════════════════
// PUNA STRANICA NALOGA — full-screen overlay (portal)
//
// Isti sadržaj kao prošireni red naloga (WorkOrderExpandedDetail, layout="page"),
// ali preko cijelog ekrana i u ŠIROKOM 2-kolonskom rasporedu. Renderuje se kao
// portal iz ProductionTab-a: podaci i akcije već postoje (nalog je u memoriji),
// pa je otvaranje/zatvaranje TRENUTNO — bez promjene rute, bez ponovnog učitavanja
// cijele aplikacije (što je ranije usporavalo ulaz/izlaz kroz zasebnu rutu).
// ════════════════════════════════════════════════════════════════════

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Printer, Trash2 } from 'lucide-react';
import type { WorkOrder, Worker, Task } from '@/lib/types';
import { workOrderDisplayName, workOrderStatusDetails, isOrderPaused } from '@/lib/utils';
import WorkOrderExpandedDetail from './WorkOrderExpandedDetail';
import './WorkOrderFullScreen.css';

interface WorkOrderFullScreenProps {
    workOrder: WorkOrder;
    workers: Worker[];
    tasks?: Task[];
    onClose: () => void;
    onUpdate: (workOrderId: string, updates: any) => Promise<void>;
    onPrint: (workOrder: WorkOrder) => void;
    onDelete: (workOrderId: string) => Promise<void>;
    onStart: (workOrderId: string) => Promise<void>;
    onRefresh?: (...collections: string[]) => void;
    showToast?: (message: string, type: 'success' | 'error' | 'info') => void;
}

export default function WorkOrderFullScreen({
    workOrder, workers, tasks = [],
    onClose, onUpdate, onPrint, onDelete, onStart, onRefresh, showToast,
}: WorkOrderFullScreenProps) {
    // Zatvaranje kroz hardver/preglednik „Nazad" + Esc; zaključaj scroll pozadine.
    // pushState daje jedan history unos koji „Nazad" potroši (→ popstate → onClose).
    useEffect(() => {
        window.history.pushState({ woFullScreen: true }, '');
        const onPop = () => onClose();
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') window.history.back(); };
        window.addEventListener('popstate', onPop);
        window.addEventListener('keydown', onKey);
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            window.removeEventListener('popstate', onPop);
            window.removeEventListener('keydown', onKey);
            document.body.style.overflow = prevOverflow;
        };
        // Namjerno bez zavisnosti — postavlja se jednom po otvaranju naloga.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // „Nazad" ide kroz history (potroši pushState unos), a popstate onda zove onClose.
    const goBack = () => window.history.back();

    const paused = isOrderPaused(workOrder);
    const statusDetails = paused ? { color: '#eab308', icon: 'pause_circle' } : workOrderStatusDetails(workOrder.Status);
    const statusLabel = paused ? 'Pauzirano' : workOrder.Status;
    const isMontaza = workOrder.Work_Order_Type === 'Montaža';
    const projectName = workOrder.items?.find(i => i.Project_Name?.trim())?.Project_Name?.trim();

    if (typeof document === 'undefined') return null;

    return createPortal(
        <div className="wofs-overlay">
            <header className="wofs-header" style={{ borderTopColor: isMontaza ? '#00C7BE' : statusDetails.color }}>
                <div className="wofs-header-inner">
                    <button className="wofs-back" onClick={goBack} title="Nazad na naloge" aria-label="Nazad na naloge">
                        <ArrowLeft size={20} />
                    </button>

                    <div className="wofs-titles">
                        <div className="wofs-title-row">
                            <h1 className="wofs-name">{workOrderDisplayName(workOrder)}</h1>
                            <span className="wofs-number">#{workOrder.Work_Order_Number}</span>
                        </div>
                        <div className="wofs-meta">
                            <span className="wofs-status" style={{ color: statusDetails.color }}>
                                <span className="material-icons-round">{statusDetails.icon}</span>
                                {statusLabel}
                            </span>
                            {isMontaza && (
                                <span className="wofs-badge montaza">
                                    <span className="material-icons-round">build</span> Montaža
                                </span>
                            )}
                            {projectName && (
                                <>
                                    <span className="wofs-dot">•</span>
                                    <span className="wofs-project">{projectName}</span>
                                </>
                            )}
                        </div>
                    </div>

                    <div className="wofs-actions">
                        <button className="wofs-act" onClick={() => onPrint(workOrder)} title="Printaj nalog">
                            <Printer size={17} /> <span className="wofs-act-label">Printaj</span>
                        </button>
                        <button className="wofs-act danger" onClick={() => onDelete(workOrder.Work_Order_ID)} title="Obriši nalog">
                            <Trash2 size={17} /> <span className="wofs-act-label">Obriši</span>
                        </button>
                    </div>
                </div>
            </header>

            <main className="wofs-body">
                <WorkOrderExpandedDetail
                    layout="page"
                    workOrder={workOrder}
                    workers={workers}
                    tasks={tasks}
                    onUpdate={onUpdate}
                    onPrint={onPrint}
                    onDelete={onDelete}
                    onStart={onStart}
                    onRefresh={onRefresh}
                    showToast={showToast}
                />
            </main>
        </div>,
        document.body
    );
}
