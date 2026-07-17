'use client';

// ════════════════════════════════════════════════════════════════════
// PRENUMERACIJA NALOGA (jednokratno) — stari broj → 2026-07/R1.
//
// Prvo PREGLED pa potvrda: broj naloga je ono što ljudi izgovaraju i
// traže, pa se ne mijenja naslijepo. Plan se računa u servisu
// (planWorkOrderRenumbering), ovdje se samo prikazuje.
// ════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo } from 'react';
import { Loader2, ArrowRight, AlertTriangle, Hash } from 'lucide-react';
import Modal from './Modal';
import { workOrderDisplayName } from '@/lib/utils';
import type { WorkOrder } from '@/lib/types';
import type { RenumberAssignment } from '@/lib/workOrderNumber';
import './RenumberWorkOrdersModal.css';

interface RenumberWorkOrdersModalProps {
    isOpen: boolean;
    onClose: () => void;
    workOrders: WorkOrder[];
    organizationId: string;
    onDone: (...collections: string[]) => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

export default function RenumberWorkOrdersModal({
    isOpen, onClose, workOrders, organizationId, onDone, showToast,
}: RenumberWorkOrdersModalProps) {
    const [plan, setPlan] = useState<RenumberAssignment[] | null>(null);
    const [loading, setLoading] = useState(false);
    const [applying, setApplying] = useState(false);

    const byId = useMemo(() => new Map(workOrders.map(w => [w.Work_Order_ID, w])), [workOrders]);

    useEffect(() => {
        if (!isOpen || !organizationId) return;
        let cancelled = false;
        setLoading(true);
        setPlan(null);
        import('@/lib/services')
            .then(({ planWorkOrderRenumbering }) => planWorkOrderRenumbering(organizationId))
            .then(p => { if (!cancelled) setPlan(p); })
            .catch(e => {
                console.error('planWorkOrderRenumbering failed', e);
                if (!cancelled) { showToast('Greška pri računanju novih brojeva', 'error'); onClose(); }
            })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, organizationId]);

    const apply = async () => {
        if (!plan || plan.length === 0 || applying) return;
        try {
            setApplying(true);
            const { applyWorkOrderRenumbering } = await import('@/lib/services');
            const res = await applyWorkOrderRenumbering(plan, organizationId);
            if (res.success) { showToast(res.message, 'success'); onDone('workOrders'); onClose(); }
            else showToast(res.message, 'error');
        } catch (e) {
            console.error('applyWorkOrderRenumbering failed', e);
            showToast('Greška pri prenumeraciji naloga', 'error');
        } finally {
            setApplying(false);
        }
    };

    const count = plan?.length || 0;

    return (
        <Modal
            isOpen={isOpen}
            onClose={applying ? () => { } : onClose}
            title="Uredi brojeve naloga"
            size="large"
            footer={
                <>
                    <button className="btn btn-secondary" onClick={onClose} disabled={applying}>Odustani</button>
                    <button className="btn btn-primary" onClick={apply} disabled={loading || applying || count === 0}>
                        {applying ? <Loader2 size={15} className="rnw-spin" /> : <Hash size={15} />}
                        {count === 0 ? 'Nema šta mijenjati' : `Prenumeriši ${count} ${count === 1 ? 'nalog' : 'naloga'}`}
                    </button>
                </>
            }
        >
            <div className="rnw">
                <p className="rnw-intro">
                    Novi broj je <strong>godina-mjesec / slovo tipa / redni broj</strong> — npr. <code>2026-07/R1</code>.
                    Slovo je <strong>R</strong> za proizvodnju, <strong>M</strong> za montažu i <strong>Z</strong> za razne poslove;
                    brojanje kreće ispočetka svakog mjeseca.
                </p>

                {loading ? (
                    <div className="rnw-loading"><Loader2 size={20} className="rnw-spin" /> Računam nove brojeve…</div>
                ) : count === 0 ? (
                    <div className="rnw-empty">Svi nalozi već imaju uredan broj — nema šta mijenjati.</div>
                ) : (
                    <>
                        <div className="rnw-warn">
                            <AlertTriangle size={16} />
                            <span>
                                Broj naloga je <strong>samo oznaka</strong> — stavke, dnevnice, narudžbe i profit ostaju
                                netaknuti (oni se vežu internim ID-em, koji se ne mijenja). Jedino <strong>već
                                    odštampani nalozi</strong> više neće imati isti broj kao u aplikaciji.
                            </span>
                        </div>

                        <p className="rnw-note">
                            Redoslijed prati <strong>prvi dan rada</strong> na nalogu (prvo knjiženje radnika, pa datum
                            početka) — ne datum kreiranja, da broj odgovara tome kad se stvarno radilo.
                        </p>

                        <div className="rnw-list">
                            {plan!.map(a => {
                                const wo = byId.get(a.Work_Order_ID);
                                return (
                                    <div className="rnw-row" key={a.Work_Order_ID}>
                                        <span className="rnw-name">{wo ? workOrderDisplayName(wo) : 'Nalog'}</span>
                                        <span className="rnw-nums">
                                            <span className="rnw-old">{a.from || '—'}</span>
                                            <ArrowRight size={13} className="rnw-arrow" />
                                            <span className="rnw-new">{a.to}</span>
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </>
                )}
            </div>
        </Modal>
    );
}
