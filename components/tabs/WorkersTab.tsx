'use client';

import { useState, useEffect } from 'react';
import type { Worker, WorkerProductivity } from '@/lib/types';
import { saveWorker, deleteWorker } from '@/lib/database';
import { useData } from '@/context/DataContext';
import Modal from '@/components/ui/Modal';
import { WORKER_ROLES, WORKER_TYPES } from '@/lib/types';
import { calculateWorkerProductivity, getCurrentMonthRange, getLastNDaysRange } from '@/lib/productivity';

interface WorkersTabProps {
    workers: Worker[];
    onRefresh: (...collections: string[]) => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

export default function WorkersTab({ workers, onRefresh, showToast }: WorkersTabProps) {
    const { organizationId } = useData();
    const [workerModal, setWorkerModal] = useState(false);
    const [editingWorker, setEditingWorker] = useState<Partial<Worker> | null>(null);

    // Worker Earnings Report Modal
    const [earningsModal, setEarningsModal] = useState(false);
    const [selectedWorker, setSelectedWorker] = useState<Worker | null>(null);
    const [workerEarnings, setWorkerEarnings] = useState<WorkerProductivity | null>(null);
    const [earningsLoading, setEarningsLoading] = useState(false);
    const [dateRange, setDateRange] = useState<{ dateFrom: string; dateTo: string }>(() => getCurrentMonthRange());
    const [periodPreset, setPeriodPreset] = useState<'month' | '7days' | '30days' | 'custom'>('month');

    // Load worker earnings when modal opens
    useEffect(() => {
        if (selectedWorker && organizationId && earningsModal) {
            loadWorkerEarnings();
        }
    }, [selectedWorker, organizationId, dateRange, earningsModal]);

    async function loadWorkerEarnings() {
        if (!selectedWorker || !organizationId) return;
        setEarningsLoading(true);
        try {
            const earnings = await calculateWorkerProductivity(
                selectedWorker.Worker_ID,
                dateRange.dateFrom,
                dateRange.dateTo,
                organizationId
            );
            setWorkerEarnings(earnings);
        } catch (error) {
            console.error('Error loading worker earnings:', error);
            showToast('Greška pri učitavanju izvještaja', 'error');
        }
        setEarningsLoading(false);
    }

    function openEarningsModal(worker: Worker) {
        setSelectedWorker(worker);
        setWorkerEarnings(null);
        setEarningsModal(true);
    }

    function handlePeriodChange(preset: 'month' | '7days' | '30days' | 'custom') {
        setPeriodPreset(preset);
        if (preset === 'month') {
            setDateRange(getCurrentMonthRange());
        } else if (preset === '7days') {
            setDateRange(getLastNDaysRange(7));
        } else if (preset === '30days') {
            setDateRange(getLastNDaysRange(30));
        }
    }
    function openWorkerModal(worker?: Worker) {
        setEditingWorker(worker || { Role: 'Opći', Status: 'Dostupan', Worker_Type: 'Glavni' });
        setWorkerModal(true);
    }

    async function handleSaveWorker() {
        if (!editingWorker?.Name) {
            showToast('Unesite ime radnika', 'error');
            return;
        }
        if (!organizationId) {
            showToast('Organization ID is required', 'error');
            return;
        }

        const result = await saveWorker(editingWorker, organizationId);
        if (result.success) {
            showToast(result.message, 'success');
            setWorkerModal(false);
            onRefresh('workers');
        } else {
            showToast(result.message, 'error');
        }
    }

    async function handleDeleteWorker(workerId: string) {
        if (!confirm('Jeste li sigurni da želite obrisati ovog radnika?')) return;
        if (!organizationId) {
            showToast('Organization ID is required', 'error');
            return;
        }

        const result = await deleteWorker(workerId, organizationId);
        if (result.success) {
            showToast(result.message, 'success');
            onRefresh('workers');
        } else {
            showToast(result.message, 'error');
        }
    }

    return (
        <div className="tab-content active" id="workers-content">
            <div className="content-header">
                <button className="btn btn-primary" onClick={() => openWorkerModal()}>
                    <span className="material-icons-round">person_add</span>
                    Novi Radnik
                </button>
            </div>

            <div className="workers-list">
                {workers.length === 0 ? (
                    <div className="empty-state">
                        <span className="material-icons-round">people</span>
                        <h3>Nema radnika</h3>
                        <p>Dodajte prvog radnika klikom na "Novi Radnik"</p>
                    </div>
                ) : (
                    workers.map(worker => (
                        <div key={worker.Worker_ID} className="simple-card">
                            <div className="simple-card-info">
                                <div
                                    className="simple-card-title"
                                    style={{ cursor: 'pointer', color: 'var(--primary-color)' }}
                                    onClick={() => openEarningsModal(worker)}
                                    title="Klikni za izvještaj zarade"
                                >
                                    {worker.Name}
                                </div>
                                <div className="simple-card-subtitle">
                                    <span style={{
                                        background: worker.Worker_Type === 'Pomoćnik' ? '#e0e7ff' : '#dcfce7',
                                        color: worker.Worker_Type === 'Pomoćnik' ? '#3730a3' : '#166534',
                                        padding: '2px 6px',
                                        borderRadius: '4px',
                                        fontSize: '10px',
                                        fontWeight: 600,
                                        marginRight: '6px'
                                    }}>
                                        {worker.Worker_Type || 'Glavni'}
                                    </span>
                                    {worker.Role} • {worker.Phone || 'Bez telefona'}
                                    {worker.Daily_Rate && (
                                        <span style={{ marginLeft: '8px', color: '#10b981', fontWeight: 600 }}>
                                            {worker.Daily_Rate} KM/dan
                                        </span>
                                    )}
                                </div>
                            </div>
                            <div className="simple-card-meta">
                                <span className={`status-badge ${worker.Status === 'Dostupan' ? 'status-odobreno' : 'status-nacrt'}`}>
                                    {worker.Status}
                                </span>
                            </div>
                            <div className="project-actions">
                                <button className="icon-btn" onClick={() => openWorkerModal(worker)}>
                                    <span className="material-icons-round">edit</span>
                                </button>
                                <button className="icon-btn danger" onClick={() => handleDeleteWorker(worker.Worker_ID)}>
                                    <span className="material-icons-round">delete</span>
                                </button>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Worker Modal */}
            <Modal
                isOpen={workerModal}
                onClose={() => setWorkerModal(false)}
                title={editingWorker?.Worker_ID ? 'Uredi Radnika' : 'Novi Radnik'}
                footer={
                    <>
                        <button className="btn btn-secondary" onClick={() => setWorkerModal(false)}>Otkaži</button>
                        <button className="btn btn-primary" onClick={handleSaveWorker}>Sačuvaj</button>
                    </>
                }
            >
                <div className="form-group">
                    <label>Ime i Prezime *</label>
                    <input
                        type="text"
                        value={editingWorker?.Name || ''}
                        onChange={(e) => setEditingWorker({ ...editingWorker, Name: e.target.value })}
                    />
                </div>
                <div className="form-row">
                    <div className="form-group">
                        <label>Tip Radnika</label>
                        <select
                            value={editingWorker?.Worker_Type || 'Glavni'}
                            onChange={(e) => setEditingWorker({ ...editingWorker, Worker_Type: e.target.value as 'Glavni' | 'Pomoćnik' })}
                        >
                            {WORKER_TYPES.map(type => (
                                <option key={type} value={type}>{type}</option>
                            ))}
                        </select>
                    </div>
                    <div className="form-group">
                        <label>Uloga</label>
                        <select
                            value={editingWorker?.Role || 'Opći'}
                            onChange={(e) => setEditingWorker({ ...editingWorker, Role: e.target.value })}
                        >
                            {WORKER_ROLES.map(role => (
                                <option key={role} value={role}>{role}</option>
                            ))}
                        </select>
                    </div>
                </div>
                <div className="form-row">
                    <div className="form-group">
                        <label>Telefon</label>
                        <input
                            type="tel"
                            value={editingWorker?.Phone || ''}
                            onChange={(e) => setEditingWorker({ ...editingWorker, Phone: e.target.value })}
                        />
                    </div>
                    <div className="form-group">
                        <label>Dnevnica (KM)</label>
                        <input
                            type="number"
                            min="0"
                            step="10"
                            placeholder="npr. 80"
                            value={editingWorker?.Daily_Rate || ''}
                            onChange={(e) => setEditingWorker({ ...editingWorker, Daily_Rate: parseFloat(e.target.value) || 0 })}
                        />
                    </div>
                </div>
                <div className="form-row">
                    <div className="form-group">
                        <label>Status</label>
                        <select
                            value={editingWorker?.Status || 'Dostupan'}
                            onChange={(e) => setEditingWorker({ ...editingWorker, Status: e.target.value })}
                        >
                            <option value="Dostupan">Dostupan</option>
                            <option value="Zauzet">Zauzet</option>
                            <option value="Na godišnjem">Na godišnjem</option>
                        </select>
                    </div>
                </div>
            </Modal>

            {/* Worker Earnings Report Modal */}
            <Modal
                isOpen={earningsModal}
                onClose={() => setEarningsModal(false)}
                title={`Izvještaj: ${selectedWorker?.Name || ''}`}
                size="large"
            >
                {/* Period Selection */}
                <div style={{ marginBottom: '20px' }}>
                    <label style={{ display: 'block', fontSize: '12px', color: '#64748b', marginBottom: '8px' }}>
                        Period
                    </label>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        {[
                            { key: 'month' as const, label: 'Ovaj mjesec' },
                            { key: '7days' as const, label: 'Zadnjih 7 dana' },
                            { key: '30days' as const, label: 'Zadnjih 30 dana' },
                            { key: 'custom' as const, label: 'Prilagođeno' },
                        ].map(opt => (
                            <button
                                key={opt.key}
                                onClick={() => handlePeriodChange(opt.key)}
                                style={{
                                    padding: '8px 14px',
                                    borderRadius: '8px',
                                    border: '1px solid',
                                    borderColor: periodPreset === opt.key ? 'var(--primary-color)' : '#e2e8f0',
                                    background: periodPreset === opt.key ? 'var(--primary-light)' : 'white',
                                    color: periodPreset === opt.key ? 'var(--primary-color)' : '#64748b',
                                    cursor: 'pointer',
                                    fontSize: '13px',
                                    fontWeight: periodPreset === opt.key ? 600 : 400,
                                }}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                    {/* Custom date range inputs */}
                    {periodPreset === 'custom' && (
                        <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
                            <input
                                type="date"
                                value={dateRange.dateFrom}
                                onChange={(e) => setDateRange({ ...dateRange, dateFrom: e.target.value })}
                                style={{ padding: '8px', borderRadius: '6px', border: '1px solid #e2e8f0' }}
                            />
                            <span style={{ alignSelf: 'center', color: '#64748b' }}>do</span>
                            <input
                                type="date"
                                value={dateRange.dateTo}
                                onChange={(e) => setDateRange({ ...dateRange, dateTo: e.target.value })}
                                style={{ padding: '8px', borderRadius: '6px', border: '1px solid #e2e8f0' }}
                            />
                        </div>
                    )}
                </div>

                {/* Earnings Stats */}
                {earningsLoading ? (
                    <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>
                        <span className="material-icons-round" style={{ fontSize: '32px', animation: 'spin 1s linear infinite' }}>sync</span>
                        <p>Učitavanje...</p>
                    </div>
                ) : workerEarnings ? (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px' }}>
                        <div style={{ padding: '16px', borderRadius: '12px', background: '#f0fdf4', textAlign: 'center' }}>
                            <div style={{ fontSize: '24px', fontWeight: 700, color: '#22c55e' }}>
                                {workerEarnings.Total_Earnings.toLocaleString('hr-HR')} KM
                            </div>
                            <div style={{ fontSize: '12px', color: '#16a34a' }}>Ukupna zarada</div>
                        </div>
                        <div style={{ padding: '16px', borderRadius: '12px', background: '#f8fafc', textAlign: 'center' }}>
                            <div style={{ fontSize: '24px', fontWeight: 700, color: '#1e293b' }}>
                                {workerEarnings.Days_Worked}
                            </div>
                            <div style={{ fontSize: '12px', color: '#64748b' }}>Radnih dana</div>
                        </div>
                        <div style={{ padding: '16px', borderRadius: '12px', background: '#f8fafc', textAlign: 'center' }}>
                            <div style={{ fontSize: '24px', fontWeight: 700, color: '#1e293b' }}>
                                {workerEarnings.Avg_Daily_Rate.toLocaleString('hr-HR')} KM
                            </div>
                            <div style={{ fontSize: '12px', color: '#64748b' }}>Prosječna dnevnica</div>
                        </div>
                        <div style={{ padding: '16px', borderRadius: '12px', background: '#f8fafc', textAlign: 'center' }}>
                            <div style={{ fontSize: '24px', fontWeight: 700, color: '#1e293b' }}>
                                {workerEarnings.Products_Worked_On}
                            </div>
                            <div style={{ fontSize: '12px', color: '#64748b' }}>Proizvoda</div>
                        </div>
                        <div style={{ padding: '16px', borderRadius: '12px', background: '#eff6ff', textAlign: 'center' }}>
                            <div style={{ fontSize: '24px', fontWeight: 700, color: '#3b82f6' }}>
                                {workerEarnings.Value_Generated.toLocaleString('hr-HR')} KM
                            </div>
                            <div style={{ fontSize: '12px', color: '#2563eb' }}>Vrijednost proizvoda</div>
                        </div>
                        <div style={{ padding: '16px', borderRadius: '12px', background: '#f8fafc', textAlign: 'center' }}>
                            <div style={{ fontSize: '24px', fontWeight: 700, color: '#1e293b' }}>
                                {workerEarnings.Attendance_Rate}%
                            </div>
                            <div style={{ fontSize: '12px', color: '#64748b' }}>Prisutnost</div>
                        </div>
                    </div>
                ) : (
                    <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>
                        <span className="material-icons-round" style={{ fontSize: '48px' }}>analytics</span>
                        <p>Nema podataka za odabrani period</p>
                    </div>
                )}
            </Modal>
        </div>
    );
}
