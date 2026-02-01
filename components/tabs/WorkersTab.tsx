'use client';

import { useState } from 'react';
import type { Worker } from '@/lib/types';
import { saveWorker, deleteWorker } from '@/lib/database';
import Modal from '@/components/ui/Modal';
import { WORKER_ROLES, WORKER_TYPES } from '@/lib/types';

interface WorkersTabProps {
    workers: Worker[];
    onRefresh: () => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

export default function WorkersTab({ workers, onRefresh, showToast }: WorkersTabProps) {
    const [workerModal, setWorkerModal] = useState(false);
    const [editingWorker, setEditingWorker] = useState<Partial<Worker> | null>(null);

    function openWorkerModal(worker?: Worker) {
        setEditingWorker(worker || { Role: 'Opći', Status: 'Dostupan', Worker_Type: 'Glavni' });
        setWorkerModal(true);
    }

    async function handleSaveWorker() {
        if (!editingWorker?.Name) {
            showToast('Unesite ime radnika', 'error');
            return;
        }

        const result = await saveWorker(editingWorker);
        if (result.success) {
            showToast(result.message, 'success');
            setWorkerModal(false);
            onRefresh();
        } else {
            showToast(result.message, 'error');
        }
    }

    async function handleDeleteWorker(workerId: string) {
        if (!confirm('Jeste li sigurni da želite obrisati ovog radnika?')) return;

        const result = await deleteWorker(workerId);
        if (result.success) {
            showToast(result.message, 'success');
            onRefresh();
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
                                <div className="simple-card-title">{worker.Name}</div>
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
        </div>
    );
}
