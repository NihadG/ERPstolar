'use client';

// „Šta kupujem na veliko" — pravila zalihe firme. Materijal sa zalihe se ne
// naručuje po projektu; bot na kapiji samo pita „imaš li?". Oznaka na samom
// materijalu u katalogu (Da/Ne) ima prednost pred ovim pravilima.

import { useEffect, useState } from 'react';
import Modal from '@/components/ui/Modal';
import { DEFAULT_STOCK_RULES, STOCK_TYPE_LABELS, type StockRules } from '@/lib/materialGates';
import './MaterialGatesPanel.css';

interface Props {
    isOpen: boolean;
    rules: StockRules;
    onClose: () => void;
    onSave: (rules: StockRules) => Promise<boolean>;
}

export default function StockRulesModal({ isOpen, rules, onClose, onSave }: Props) {
    const [types, setTypes] = useState<string[]>(rules.types);
    const [phrases, setPhrases] = useState(rules.phrases.join('\n'));
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        setTypes(rules.types);
        setPhrases(rules.phrases.join('\n'));
    }, [isOpen, rules]);

    const toggle = (t: string) => setTypes(prev => (prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]));

    async function save() {
        setSaving(true);
        const ok = await onSave({ types, phrases: phrases.split('\n').map(p => p.trim()).filter(Boolean) });
        setSaving(false);
        if (ok) onClose();
    }

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Zaliha — šta kupujem na veliko"
            footer={
                <>
                    <button className="btn btn-secondary" onClick={() => { setTypes(DEFAULT_STOCK_RULES.types); setPhrases(DEFAULT_STOCK_RULES.phrases.join('\n')); }}>Početne vrijednosti</button>
                    <button className="btn btn-secondary" onClick={onClose}>Otkaži</button>
                    <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Spremam…' : 'Sačuvaj'}</button>
                </>
            }
        >
            <p className="mg-hint">
                Ovo se ne naručuje po projektu i ne izlazi u „naruči sve što fali". Kad je proces na redu, bot samo pita imaš li ga.
            </p>
            <div className="form-group">
                <label>Vrste materijala</label>
                <div className="mg-type-grid">
                    {Object.entries(STOCK_TYPE_LABELS).map(([key, label]) => (
                        <label key={key} className="mg-type">
                            <input type="checkbox" checked={types.includes(key)} onChange={() => toggle(key)} />
                            {label}
                        </label>
                    ))}
                </div>
            </div>
            <div className="form-group">
                <label>Riječi u nazivu (jedna po redu)</label>
                <textarea rows={4} value={phrases} onChange={e => setPhrases(e.target.value)} placeholder={'furnir hrast\nvijci'} />
            </div>
        </Modal>
    );
}
