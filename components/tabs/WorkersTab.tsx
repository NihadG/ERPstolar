'use client';

import { useState } from 'react';
import type { Worker } from '@/lib/types';
import { saveWorker, deleteWorker } from '@/lib/database';
import Modal from '@/components/ui/Modal';
import { WORKER_ROLES } from '@/lib/types';

interface WorkersTabProps {
    workers: Worker[];
    onRefresh: () => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

export default function WorkersTab({ workers, onRefresh, showToast }: WorkersTabProps) {
    const [workerModal, setWorkerModal] = useState(false);
    const [editingWorker, setEditingWorker] = useState<Partial<Worker> | null>(null);

    function openWorkerModal(worker?: Worker) {
        setEditingWorker(worker || { Role: 'Opći', Status: 'Dostupan' });
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
                                    {worker.Role} • {worker.Phone || 'Bez telefona'}
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
                    <div className="form-group">
                        <label>Telefon</label>
                        <input
                            type="tel"
                            value={editingWorker?.Phone || ''}
                            onChange={(e) => setEditingWorker({ ...editingWorker, Phone: e.target.value })}
                        />
                    </div>
                </div>
            </Modal>
        </div>
    );
}
