'use client';

// ════════════════════════════════════════════════════════════════════
// CrewPicker — sastavi kandidat-ekipu: glavni radnik + opcioni pomoćnik.
//
// Osnovni gradivni element auto-rasporeda. Koristi se u batch tabeli (dodaj
// ekipe nalogu) i u draweru. Ekipa veličine 1 („samo glavni") je legitimna.
// Nested modal — otvara se preko batch modala, pa mu treba viši zIndex.
// ════════════════════════════════════════════════════════════════════

import { useState, useMemo, useEffect } from 'react';
import { Search, User, UserPlus, X, Check } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import type { Worker, PlanCrew, PlanRef } from '@/lib/types';
import { newCrew } from '@/lib/canvas/batchDraft';
import './CrewPicker.css';

interface CrewPickerProps {
    isOpen: boolean;
    workers: Worker[];
    onClose: () => void;
    onAdd: (crew: PlanCrew) => void;
    title?: string;
}

export default function CrewPicker({ isOpen, workers, onClose, onAdd, title }: CrewPickerProps) {
    const [search, setSearch] = useState('');
    const [lead, setLead] = useState<PlanRef | null>(null);
    const [helper, setHelper] = useState<PlanRef | null>(null);
    const [target, setTarget] = useState<'lead' | 'helper'>('lead');

    useEffect(() => {
        if (!isOpen) { setSearch(''); setLead(null); setHelper(null); setTarget('lead'); }
    }, [isOpen]);

    const active = useMemo(() => {
        const q = search.trim().toLowerCase();
        return workers
            .filter(w => w.Status === 'Aktivan' || w.Status === 'Dostupan')
            .filter(w => !q || (w.Name || '').toLowerCase().includes(q))
            .sort((a, b) => (a.Name || '').localeCompare(b.Name || '', 'hr'));
    }, [workers, search]);

    const pick = (w: Worker) => {
        const ref: PlanRef = { id: w.Worker_ID, name: w.Name };
        if (target === 'lead') {
            setLead(ref);
            // Ako glavni i pomoćnik ne smiju biti isti, očisti pomoćnika kad se poklope.
            if (helper?.id === ref.id) setHelper(null);
            setTarget('helper');
        } else {
            if (lead?.id === ref.id) return;   // pomoćnik ne može biti isti kao glavni
            setHelper(ref);
        }
    };

    const add = () => {
        if (!lead) return;
        onAdd(newCrew(lead, helper || undefined));
        onClose();
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={<><UserPlus size={16} /> {title || 'Dodaj ekipu'}</>}
            size="default"
            zIndex={1200}
            footer={
                <div className="crp-foot">
                    <span className="crp-foot-hint">
                        {lead ? `${lead.name}${helper ? ` + ${helper.name}` : ' (samo glavni)'}` : 'Izaberi glavnog radnika'}
                    </span>
                    <div className="crp-foot-actions">
                        <button className="btn btn-secondary" onClick={onClose}>Odustani</button>
                        <button className="btn btn-primary" disabled={!lead} onClick={add}>Dodaj ekipu</button>
                    </div>
                </div>
            }
        >
            <div className="crp-shell">
                <div className="crp-slots">
                    <button className={`crp-slot${target === 'lead' ? ' active' : ''}${lead ? ' filled' : ''}`}
                        onClick={() => setTarget('lead')}>
                        <User size={14} />
                        <span className="crp-slot-role">Glavni</span>
                        <span className="crp-slot-name">{lead?.name || '—'}</span>
                        {lead && <X size={13} className="crp-slot-clear"
                            onClick={e => { e.stopPropagation(); setLead(null); setTarget('lead'); }} />}
                    </button>
                    <button className={`crp-slot${target === 'helper' ? ' active' : ''}${helper ? ' filled' : ''}`}
                        onClick={() => setTarget('helper')} disabled={!lead}>
                        <UserPlus size={14} />
                        <span className="crp-slot-role">Pomoćnik <em>(opciono)</em></span>
                        <span className="crp-slot-name">{helper?.name || '—'}</span>
                        {helper && <X size={13} className="crp-slot-clear"
                            onClick={e => { e.stopPropagation(); setHelper(null); }} />}
                    </button>
                </div>

                <div className="crp-search">
                    <Search size={15} />
                    <input placeholder="Traži radnika…" value={search}
                        onChange={e => setSearch(e.target.value)} autoFocus />
                </div>

                <div className="crp-list">
                    {active.length === 0 && <p className="crp-empty">Nema radnika.</p>}
                    {active.map(w => {
                        const isLead = lead?.id === w.Worker_ID;
                        const isHelper = helper?.id === w.Worker_ID;
                        return (
                            <button key={w.Worker_ID}
                                className={`crp-row${isLead ? ' lead' : ''}${isHelper ? ' helper' : ''}`}
                                onClick={() => pick(w)}>
                                <span className="crp-name">{w.Name}</span>
                                {w.Role && <span className="crp-tag">{w.Role}</span>}
                                {isLead && <span className="crp-badge">glavni <Check size={11} /></span>}
                                {isHelper && <span className="crp-badge sec">pomoćnik <Check size={11} /></span>}
                            </button>
                        );
                    })}
                </div>
            </div>
        </Modal>
    );
}
