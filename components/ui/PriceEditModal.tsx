'use client';

import { useState } from 'react';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, updateDoc } from 'firebase/firestore';
import { recalculateWorkOrder } from '@/lib/attendance';
import type { WorkOrder, WorkOrderItem } from '@/lib/types';

interface PriceEditModalProps {
    workOrder: WorkOrder;
    onClose: () => void;
    onSaved: () => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

interface ItemPrice {
    ID: string;
    Product_Name: string;
    Quantity: number;
    Product_Value: number;
    Material_Cost: number;
    Transport_Share: number;
    Services_Total: number;
    Actual_Labor_Cost: number;
}

export default function PriceEditModal({ workOrder, onClose, onSaved, showToast }: PriceEditModalProps) {
    const items = workOrder.items || [];
    const [prices, setPrices] = useState<ItemPrice[]>(
        items.map(item => ({
            ID: item.ID,
            Product_Name: item.Product_Name,
            Quantity: item.Quantity || 1,
            Product_Value: item.Product_Value || 0,
            Material_Cost: item.Material_Cost || 0,
            Transport_Share: item.Transport_Share || 0,
            Services_Total: item.Services_Total || 0,
            Actual_Labor_Cost: item.Actual_Labor_Cost || 0,
        }))
    );
    const [saving, setSaving] = useState(false);

    const updatePrice = (index: number, field: keyof ItemPrice, value: number) => {
        setPrices(prev => {
            const next = [...prev];
            next[index] = { ...next[index], [field]: value };
            return next;
        });
    };

    // Live profit calculations
    const totals = prices.reduce((acc, p) => ({
        value: acc.value + p.Product_Value,
        material: acc.material + p.Material_Cost,
        labor: acc.labor + p.Actual_Labor_Cost,
        transport: acc.transport + p.Transport_Share,
        services: acc.services + p.Services_Total,
    }), { value: 0, material: 0, labor: 0, transport: 0, services: 0 });

    const totalCosts = totals.material + totals.labor + totals.transport + totals.services;
    const profit = totals.value - totalCosts;
    const margin = totals.value > 0 ? (profit / totals.value) * 100 : 0;

    const handleSave = async () => {
        setSaving(true);
        try {
            const firestore = db;
            if (!firestore) throw new Error('DB not available');

            for (const price of prices) {
                const q = query(
                    collection(firestore, 'work_order_items'),
                    where('ID', '==', price.ID)
                );
                const snap = await getDocs(q);
                if (!snap.empty) {
                    await updateDoc(snap.docs[0].ref, {
                        Product_Value: price.Product_Value,
                        Material_Cost: price.Material_Cost,
                        Material_Cost_Source: 'manual',
                        Transport_Share: price.Transport_Share,
                        Services_Total: price.Services_Total,
                    });
                }
            }

            // Recalculate the work order with new prices
            await recalculateWorkOrder(workOrder.Work_Order_ID);

            showToast('Cijene uspješno ažurirane', 'success');
            onSaved();
            onClose();
        } catch (err: any) {
            console.error('PriceEditModal save error:', err);
            showToast(`Greška: ${err.message}`, 'error');
        } finally {
            setSaving(false);
        }
    };

    const getMarginColor = (m: number) => {
        if (m < 0) return '#ef4444';
        if (m < 15) return '#f59e0b';
        return '#22c55e';
    };

    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 10000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
        }}
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div style={{
                background: '#1c1c1e', borderRadius: '16px', width: '90%', maxWidth: '720px',
                maxHeight: '85vh', overflow: 'auto', border: '1px solid rgba(255,255,255,0.1)',
                boxShadow: '0 24px 48px rgba(0,0,0,0.4)',
            }}>
                {/* Header */}
                <div style={{
                    padding: '20px 24px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                    <div>
                        <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 600, color: '#fff' }}>
                            <span className="material-icons-round" style={{ fontSize: '20px', verticalAlign: 'middle', marginRight: '8px', color: '#f59e0b' }}>edit</span>
                            Uređivanje cijena
                        </h3>
                        <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', marginTop: '4px' }}>
                            {workOrder.Work_Order_Number || workOrder.Work_Order_ID}
                        </div>
                    </div>
                    <button onClick={onClose} style={{
                        background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '8px',
                        width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: 'pointer', color: '#fff',
                    }}>
                        <span className="material-icons-round" style={{ fontSize: '18px' }}>close</span>
                    </button>
                </div>

                {/* Items Table */}
                <div style={{ padding: '16px 24px' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                        <thead>
                            <tr style={{ color: 'rgba(255,255,255,0.5)', textAlign: 'left', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                <th style={{ padding: '8px 6px' }}>Stavka</th>
                                <th style={{ padding: '8px 6px', textAlign: 'right' }}>Cijena (KM)</th>
                                <th style={{ padding: '8px 6px', textAlign: 'right' }}>Materijal (KM)</th>
                                <th style={{ padding: '8px 6px', textAlign: 'right' }}>Transport (KM)</th>
                                <th style={{ padding: '8px 6px', textAlign: 'right' }}>Usluge (KM)</th>
                            </tr>
                        </thead>
                        <tbody>
                            {prices.map((item, idx) => (
                                <tr key={item.ID} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                                    <td style={{ padding: '10px 6px', color: '#fff', fontWeight: 500 }}>
                                        {item.Product_Name}
                                        <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: '11px', marginLeft: '6px' }}>
                                            ×{item.Quantity}
                                        </span>
                                    </td>
                                    <td style={{ padding: '10px 6px' }}>
                                        <input
                                            type="number" min="0" step="0.01"
                                            value={item.Product_Value || ''}
                                            onChange={(e) => updatePrice(idx, 'Product_Value', parseFloat(e.target.value) || 0)}
                                            style={inputStyle}
                                        />
                                    </td>
                                    <td style={{ padding: '10px 6px' }}>
                                        <input
                                            type="number" min="0" step="0.01"
                                            value={item.Material_Cost || ''}
                                            onChange={(e) => updatePrice(idx, 'Material_Cost', parseFloat(e.target.value) || 0)}
                                            style={inputStyle}
                                        />
                                    </td>
                                    <td style={{ padding: '10px 6px' }}>
                                        <input
                                            type="number" min="0" step="0.01"
                                            value={item.Transport_Share || ''}
                                            onChange={(e) => updatePrice(idx, 'Transport_Share', parseFloat(e.target.value) || 0)}
                                            style={inputStyle}
                                        />
                                    </td>
                                    <td style={{ padding: '10px 6px' }}>
                                        <input
                                            type="number" min="0" step="0.01"
                                            value={item.Services_Total || ''}
                                            onChange={(e) => updatePrice(idx, 'Services_Total', parseFloat(e.target.value) || 0)}
                                            style={inputStyle}
                                        />
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* Live Profit Summary */}
                <div style={{
                    padding: '16px 24px', borderTop: '1px solid rgba(255,255,255,0.08)',
                    display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap',
                }}>
                    <div style={{ flex: 1, display: 'flex', gap: '20px', fontSize: '12px', color: 'rgba(255,255,255,0.6)' }}>
                        <span>Ukupno: <strong style={{ color: '#fff' }}>{totals.value.toFixed(2)} KM</strong></span>
                        <span>Troškovi: <strong style={{ color: '#fff' }}>{totalCosts.toFixed(2)} KM</strong></span>
                        <span>
                            Profit: <strong style={{ color: getMarginColor(margin) }}>{profit.toFixed(2)} KM ({margin.toFixed(1)}%)</strong>
                        </span>
                    </div>
                    {margin < 15 && margin >= 0 && (
                        <span style={{ fontSize: '11px', color: '#f59e0b', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span className="material-icons-round" style={{ fontSize: '14px' }}>warning</span>
                            Niska marža
                        </span>
                    )}
                    {margin < 0 && (
                        <span style={{ fontSize: '11px', color: '#ef4444', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span className="material-icons-round" style={{ fontSize: '14px' }}>error</span>
                            Negativna marža!
                        </span>
                    )}
                </div>

                {/* Footer */}
                <div style={{
                    padding: '16px 24px', borderTop: '1px solid rgba(255,255,255,0.08)',
                    display: 'flex', justifyContent: 'flex-end', gap: '10px',
                }}>
                    <button onClick={onClose} style={{
                        padding: '10px 20px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.15)',
                        background: 'transparent', color: '#fff', fontWeight: 500, cursor: 'pointer', fontSize: '13px',
                    }}>
                        Otkaži
                    </button>
                    <button onClick={handleSave} disabled={saving} style={{
                        padding: '10px 24px', borderRadius: '10px', border: 'none',
                        background: saving ? 'rgba(0, 122, 255, 0.5)' : 'linear-gradient(135deg, #007AFF 0%, #0056b3 100%)',
                        color: '#fff', fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', fontSize: '13px',
                        display: 'flex', alignItems: 'center', gap: '6px',
                    }}>
                        {saving ? (
                            <>
                                <span className="material-icons-round" style={{ fontSize: '16px', animation: 'spin 1s linear infinite' }}>sync</span>
                                Čuvanje...
                            </>
                        ) : (
                            <>
                                <span className="material-icons-round" style={{ fontSize: '16px' }}>save</span>
                                Sačuvaj cijene
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}

const inputStyle: React.CSSProperties = {
    width: '90px', padding: '6px 8px', borderRadius: '8px',
    border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.06)',
    color: '#fff', fontSize: '13px', textAlign: 'right' as const,
    outline: 'none',
};
