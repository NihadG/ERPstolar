'use client';

// ════════════════════════════════════════════════════════════════════
// CrewPicker — sastavi kandidat-ekipu: glavni radnik + pomoćnici.
//
// Osnovni gradivni element auto-rasporeda. Ekipa veličine 1 („samo glavni")
// je legitimna, kao i majstor s tri pomoćnika.
//
// ISTI RADNIK SMIJE BITI U VIŠE EKIPA istog naloga — algoritam bira jednu, pa
// više kombinacija oko istog majstora znači više načina da posao uđe u kalendar.
// Zato se ovdje NE zabranjuje, nego se PRIKAZUJE u koliko je grupa čovjek već,
// da korisnik zna šta gradi.
//
// Nested modal — otvara se preko batch modala, pa mu treba viši zIndex.
// ════════════════════════════════════════════════════════════════════

import { useState, useMemo, useEffect } from 'react';
import { Search, User, UserPlus, X, Check, Users, AlertTriangle } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import type { Worker, PlanCrew, PlanRef } from '@/lib/types';
import { crewLabel } from '@/lib/types';
import { newCrew, hasSameCrew, crewCountForWorker } from '@/lib/canvas/crew';
import './CrewPicker.css';

interface CrewPickerProps {
    isOpen: boolean;
    workers: Worker[];
    onClose: () => void;
    onAdd: (crew: PlanCrew) => void;
    title?: string;
    /** Već dodane ekipe — za upozorenje na duplikat i brojač „u N grupa". */
    existing?: PlanCrew[];
}

export default function CrewPicker({
    isOpen, workers, onClose, onAdd, title, existing = [],
}: CrewPickerProps) {
    const [search, setSearch] = useState('');
    const [lead, setLead] = useState<PlanRef | null>(null);
    const [members, setMembers] = useState<PlanRef[]>([]);

    useEffect(() => {
        if (!isOpen) { setSearch(''); setLead(null); setMembers([]); }
    }, [isOpen]);

    const active = useMemo(() => {
        const q = search.trim().toLowerCase();
        return workers
            .filter(w => w.Status === 'Aktivan' || w.Status === 'Dostupan')
            .filter(w => !q || (w.Name || '').toLowerCase().includes(q))
            .sort((a, b) => (a.Name || '').localeCompare(b.Name || '', 'hr'));
    }, [workers, search]);

    /**
     * Klik na radnika: prvi izbor postaje glavni, svaki sljedeći se prebacuje
     * u pomoćnike (ponovni klik ga skida). Bez slotova i bez „prvo izaberi
     * glavnog pa onda prebaci fokus" — jedan potez po čovjeku.
     */
    const toggle = (w: Worker) => {
        const ref: PlanRef = { id: w.Worker_ID, name: w.Name };
        if (!lead) { setLead(ref); return; }
        if (lead.id === ref.id) {
            // Skidanje glavnog: prvi pomoćnik preuzima vodstvo, da ekipa ostane cijela
            const [next, ...rest] = members;
            setLead(next || null);
            setMembers(rest);
            return;
        }
        setMembers(ms => ms.some(m => m.id === ref.id)
            ? ms.filter(m => m.id !== ref.id)
            : [...ms, ref]);
    };

    const draft = lead ? newCrew(lead, members) : null;
    const duplicate = !!draft && hasSameCrew(existing, draft);

    const add = () => {
        if (!draft || duplicate) return;
        onAdd(draft);
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
                    <span className={`crp-foot-hint${duplicate ? ' warn' : ''}`}>
                        {!draft ? 'Izaberi glavnog radnika'
                            : duplicate ? <><AlertTriangle size={13} /> Ova ekipa je već dodana</>
                                : <>{crewLabel(draft)} · {members.length + 1} {members.length === 0 ? 'čovjek' : 'ljudi'}</>}
                    </span>
                    <div className="crp-foot-actions">
                        <button className="btn btn-secondary" onClick={onClose}>Odustani</button>
                        <button className="btn btn-primary" disabled={!draft || duplicate} onClick={add}>
                            Dodaj ekipu
                        </button>
                    </div>
                </div>
            }
        >
            <div className="crp-shell">
                {/* Sastav ekipe koja se gradi */}
                <div className="crp-draft">
                    {!lead && <span className="crp-draft-empty">Klikni radnika ispod — prvi postaje glavni.</span>}
                    {lead && (
                        <span className="crp-tok lead">
                            <User size={12} /> {lead.name}
                            <em>glavni</em>
                            <X size={12} className="crp-tok-x" onClick={() => toggle({ Worker_ID: lead.id, Name: lead.name } as Worker)} />
                        </span>
                    )}
                    {members.map(m => (
                        <span key={m.id} className="crp-tok">
                            {m.name}
                            <X size={12} className="crp-tok-x"
                                onClick={() => setMembers(ms => ms.filter(x => x.id !== m.id))} />
                        </span>
                    ))}
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
                        const isMember = members.some(m => m.id === w.Worker_ID);
                        // Koliko VEĆ dodanih ekipa sadrži ovog čovjeka — dozvoljeno, ali vrijedi znati
                        const inGroups = crewCountForWorker(existing, w.Worker_ID);
                        return (
                            <button key={w.Worker_ID}
                                className={`crp-row${isLead ? ' lead' : ''}${isMember ? ' helper' : ''}`}
                                onClick={() => toggle(w)}>
                                <span className="crp-name">{w.Name}</span>
                                {w.Role && <span className="crp-tag">{w.Role}</span>}
                                {inGroups > 0 && (
                                    <span className="crp-ingroups" title={`Već je u ${inGroups} kandidat-ekipa ovog naloga`}>
                                        <Users size={11} /> {inGroups}
                                    </span>
                                )}
                                {isLead && <span className="crp-badge">glavni <Check size={11} /></span>}
                                {isMember && <span className="crp-badge sec">pomoćnik <Check size={11} /></span>}
                            </button>
                        );
                    })}
                </div>
            </div>
        </Modal>
    );
}
