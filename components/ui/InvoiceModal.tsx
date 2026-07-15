'use client';

import { useState, useEffect, useMemo } from 'react';
import type { Offer, Project, WorkOrder, Invoice } from '@/lib/types';
import { getInvoicesForProject, saveInvoiceDraft, issueInvoice, cancelInvoice } from '@/lib/services';
import { buildInvoiceLines, type InvoiceLineDraft, type InvoicePriceSource } from '@/lib/invoicePricing';
import Modal from '@/components/ui/Modal';
import { Receipt, AlertTriangle, Lock } from 'lucide-react';

interface InvoiceModalProps {
    project: Project;
    offer: Offer;   // prihvaćena ponuda (offer.products popunjeni)
    organizationId: string;
    workOrders?: WorkOrder[];  // opciono — za "nema naloga" oznaku po redu (informativno)
    onClose: () => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
    onRefresh: (...collections: string[]) => void;
}

const round2 = (n: number) => Math.round((n || 0) * 100) / 100;
const fmt = (n: number) => round2(n).toLocaleString('hr-HR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function InvoiceModal({ project, offer, organizationId, workOrders, onClose, showToast, onRefresh }: InvoiceModalProps) {
    const [loading, setLoading] = useState(true);
    const [invoiceId, setInvoiceId] = useState<string | undefined>(undefined);
    const [issuedInvoice, setIssuedInvoice] = useState<Invoice | null>(null);
    const [lines, setLines] = useState<InvoiceLineDraft[]>([]);
    const [saving, setSaving] = useState(false);
    const [issuing, setIssuing] = useState(false);
    const [cancelling, setCancelling] = useState(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true);
            try {
                const existing = await getInvoicesForProject(project.Project_ID, organizationId);
                if (cancelled) return;
                const issued = existing.find(i => i.Status === 'Izdat');
                if (issued) {
                    setIssuedInvoice(issued);
                    setInvoiceId(issued.Invoice_ID);
                    setLines((issued.items || []).map(it => ({
                        productId: it.Product_ID,
                        productName: it.Product_Name,
                        quantity: it.Quantity,
                        offerUnitPrice: it.Offer_Unit_Price,
                        recalculatedUnitPrice: it.Recalculated_Unit_Price,
                        finalUnitPrice: it.Final_Unit_Price,
                        finalTotal: it.Final_Total,
                        priceSource: it.Price_Source,
                    })));
                } else {
                    const draft = existing.find(i => i.Status === 'Nacrt');
                    if (draft) {
                        setInvoiceId(draft.Invoice_ID);
                        setLines((draft.items || []).map(it => ({
                            productId: it.Product_ID,
                            productName: it.Product_Name,
                            quantity: it.Quantity,
                            offerUnitPrice: it.Offer_Unit_Price,
                            recalculatedUnitPrice: it.Recalculated_Unit_Price,
                            finalUnitPrice: it.Final_Unit_Price,
                            finalTotal: it.Final_Total,
                            priceSource: it.Price_Source,
                        })));
                    } else {
                        setLines(buildInvoiceLines(offer.products || [], project.products || []));
                    }
                }
            } catch (e) {
                console.error('invoice load error', e);
                if (!cancelled) showToast('Greška pri učitavanju računa', 'error');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [project.Project_ID, organizationId]);

    const isIssued = !!issuedInvoice;
    const subtotal = useMemo(() => round2(lines.reduce((s, l) => s + (l.finalTotal || 0), 0)), [lines]);

    // Informativno: proizvodi bez ijedne ne-otkazane, ne-montaža stavke u nalozima projekta.
    const productIdsWithoutWorkOrder = useMemo(() => {
        if (!workOrders) return new Set<string>();
        const withOrder = new Set<string>();
        workOrders.forEach(wo => {
            if (wo.Status === 'Otkazano' || wo.Work_Order_Type === 'Montaža') return;
            (wo.items || []).forEach(it => { if (it.Project_ID === project.Project_ID) withOrder.add(it.Product_ID); });
        });
        return new Set(lines.map(l => l.productId).filter(id => !withOrder.has(id)));
    }, [workOrders, lines, project.Project_ID]);

    function setLineSource(index: number, source: InvoicePriceSource, manualValue?: number) {
        setLines(prev => prev.map((l, i) => {
            if (i !== index) return l;
            const unit = source === 'offer' ? l.offerUnitPrice
                : source === 'recalculated' ? l.recalculatedUnitPrice
                : (manualValue ?? l.finalUnitPrice);
            return { ...l, finalUnitPrice: round2(unit), finalTotal: round2(unit * (l.quantity || 1)), priceSource: source };
        }));
    }

    async function handleSaveDraft(): Promise<string | undefined> {
        setSaving(true);
        try {
            const res = await saveInvoiceDraft({ Invoice_ID: invoiceId, Project_ID: project.Project_ID, Offer_ID: offer.Offer_ID, lines }, organizationId);
            if (!res.success) {
                showToast(res.message, 'error');
                return undefined;
            }
            setInvoiceId(res.data?.Invoice_ID);
            showToast('Nacrt računa sačuvan', 'success');
            onRefresh('projects');
            return res.data?.Invoice_ID;
        } finally {
            setSaving(false);
        }
    }

    async function handleIssue() {
        if (lines.some(l => !(l.finalUnitPrice > 0))) {
            showToast('Sve stavke moraju imati cijenu veću od 0 prije izdavanja', 'error');
            return;
        }
        if (!confirm('Cijene će postati zvanični prihod u svim prikazima profita (kartica projekta, nalozi, analitika). Nastaviti?')) return;

        setIssuing(true);
        try {
            const id = invoiceId || await handleSaveDraft();
            if (!id) return;
            const res = await issueInvoice(id, organizationId);
            if (!res.success) {
                showToast(res.message, 'error');
                return;
            }
            showToast(res.message, 'success');
            onRefresh('workOrders', 'projects');
            onClose();
        } finally {
            setIssuing(false);
        }
    }

    async function handleCancel() {
        if (!issuedInvoice) return;
        if (!confirm('Storniranjem se cijene naloga vraćaju na cijenu iz ponude. Nastaviti?')) return;
        setCancelling(true);
        try {
            const res = await cancelInvoice(issuedInvoice.Invoice_ID, organizationId);
            if (!res.success) {
                showToast(res.message, 'error');
                return;
            }
            showToast(res.message, 'success');
            onRefresh('workOrders', 'projects');
            onClose();
        } finally {
            setCancelling(false);
        }
    }

    const th: React.CSSProperties = { padding: '9px 12px', textAlign: 'right', fontWeight: 600, color: '#475569', borderBottom: '2px solid #e2e8f0', whiteSpace: 'nowrap' };
    const td: React.CSSProperties = { padding: '8px 12px', textAlign: 'right', whiteSpace: 'nowrap' };

    return (
        <Modal
            isOpen
            onClose={onClose}
            size="xl"
            title={
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <Receipt size={20} />
                    <span>Završni račun — {project.Name || project.Client_Name}</span>
                    {isIssued && (
                        <span style={{ fontSize: '12px', fontWeight: 700, color: '#059669', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            <Lock size={13} /> Izdat {issuedInvoice?.Invoice_Number}
                        </span>
                    )}
                </div>
            }
            footer={
                isIssued ? (
                    <>
                        <button className="btn btn-secondary" onClick={onClose}>Zatvori</button>
                        <button className="btn btn-danger" disabled={cancelling} onClick={handleCancel}>
                            {cancelling ? 'Storniranje...' : 'Storniraj račun'}
                        </button>
                    </>
                ) : (
                    <>
                        <button className="btn btn-secondary" onClick={onClose}>Otkaži</button>
                        <button className="btn btn-secondary" disabled={saving || issuing || loading} onClick={handleSaveDraft}>
                            {saving ? 'Spremanje...' : 'Sačuvaj nacrt'}
                        </button>
                        <button className="glass-btn glass-btn-primary" disabled={saving || issuing || loading || lines.length === 0} onClick={handleIssue}>
                            {issuing ? 'Izdavanje...' : 'Izdaj račun'}
                        </button>
                    </>
                )
            }
        >
            {loading && <div style={{ padding: '32px', textAlign: 'center', color: '#64748b' }}>Učitavanje...</div>}

            {!loading && (
                <div>
                    {isIssued && (
                        <div style={{ marginBottom: '14px', padding: '10px 14px', background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: '10px', fontSize: '13px', color: '#065f46' }}>
                            Račun je izdat — cijene su upisane kao zvanični prihod na radne naloge. Ponuda je zaključana; izmjena samo kroz storniranje.
                        </div>
                    )}

                    <div style={{ border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'auto', maxHeight: '48vh', marginBottom: '16px' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                            <thead>
                                <tr style={{ background: '#f8fafc', position: 'sticky', top: 0 }}>
                                    <th style={{ ...th, textAlign: 'left' }}>Proizvod</th>
                                    <th style={th}>Ponuda</th>
                                    <th style={th}>Trenutna kalkulacija</th>
                                    <th style={{ ...th, minWidth: 150 }}>Konačna cijena</th>
                                    <th style={th}>Ukupno</th>
                                </tr>
                            </thead>
                            <tbody>
                                {lines.map((l, i) => (
                                    <tr key={l.productId} style={{ background: i % 2 ? '#fafafa' : 'white', borderBottom: '1px solid #f1f5f9' }}>
                                        <td style={{ ...td, textAlign: 'left', fontWeight: 500 }}>
                                            {l.productName}{l.quantity > 1 ? ` × ${l.quantity}` : ''}
                                            {productIdsWithoutWorkOrder.has(l.productId) && (
                                                <span style={{ marginLeft: 6, fontSize: '11px', color: '#b45309', display: 'inline-flex', alignItems: 'center', gap: 3 }} title="Nema radnog naloga — cijena će važiti kad se nalog kreira">
                                                    <AlertTriangle size={11} /> nema naloga
                                                </span>
                                            )}
                                        </td>
                                        <td style={td}>
                                            <button
                                                type="button"
                                                disabled={isIssued}
                                                onClick={() => setLineSource(i, 'offer')}
                                                style={{
                                                    padding: '4px 8px', borderRadius: 6, border: '1px solid', cursor: isIssued ? 'default' : 'pointer',
                                                    borderColor: l.priceSource === 'offer' ? '#2563eb' : '#e2e8f0',
                                                    background: l.priceSource === 'offer' ? '#dbeafe' : 'transparent',
                                                    color: l.priceSource === 'offer' ? '#1e40af' : '#334155', fontWeight: l.priceSource === 'offer' ? 700 : 400,
                                                }}
                                            >
                                                {fmt(l.offerUnitPrice)}
                                            </button>
                                        </td>
                                        <td style={td}>
                                            <button
                                                type="button"
                                                disabled={isIssued}
                                                onClick={() => setLineSource(i, 'recalculated')}
                                                style={{
                                                    padding: '4px 8px', borderRadius: 6, border: '1px solid', cursor: isIssued ? 'default' : 'pointer',
                                                    borderColor: l.priceSource === 'recalculated' ? '#2563eb' : '#e2e8f0',
                                                    background: l.priceSource === 'recalculated' ? '#dbeafe' : 'transparent',
                                                    color: l.priceSource === 'recalculated' ? '#1e40af' : '#334155', fontWeight: l.priceSource === 'recalculated' ? 700 : 400,
                                                }}
                                            >
                                                {fmt(l.recalculatedUnitPrice)}
                                                {Math.round(l.recalculatedUnitPrice * 100) !== Math.round(l.offerUnitPrice * 100) && (
                                                    <AlertTriangle size={11} style={{ marginLeft: 4, color: '#b45309', verticalAlign: 'middle' }} />
                                                )}
                                            </button>
                                        </td>
                                        <td style={td}>
                                            <input
                                                type="number"
                                                value={l.finalUnitPrice === 0 ? '' : l.finalUnitPrice}
                                                onChange={e => setLineSource(i, 'manual', e.target.value === '' ? 0 : parseFloat(e.target.value))}
                                                disabled={isIssued}
                                                min="0" step="10"
                                                style={{ width: '100px', padding: '5px 8px', borderRadius: 6, border: '1px solid #cbd5e1', textAlign: 'right', fontWeight: 700 }}
                                            />
                                            {l.priceSource === 'manual' && <span style={{ marginLeft: 4, fontSize: '10px', color: '#64748b' }}>ručno</span>}
                                        </td>
                                        <td style={{ ...td, fontWeight: 700 }}>{fmt(l.finalTotal)}</td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr style={{ background: '#f8fafc', borderTop: '2px solid #e2e8f0' }}>
                                    <td style={{ padding: '10px 12px', fontWeight: 700 }} colSpan={4}>UKUPNO</td>
                                    <td style={{ ...td, fontWeight: 800 }}>{fmt(subtotal)} KM</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>
            )}
        </Modal>
    );
}
