'use client';

import { useState, useEffect } from 'react';
import type { ProcessCatalogItem, ProcessMaterialRule } from '@/lib/types';
import { COMMON_PROCESSES, MATERIAL_CATEGORIES } from '@/lib/types';
import {
    getProcessCatalog, saveProcessCatalogItem, renameProcessCatalogItem,
    deleteProcessCatalogItem, reorderProcessCatalog,
    getProcessMaterialRules, saveProcessMaterialRule, deleteProcessMaterialRule,
} from '@/lib/services';
import Modal from '@/components/ui/Modal';
import { ArrowUp, ArrowDown, Trash2, Plus, Pencil, Check, ListOrdered, Wand2 } from 'lucide-react';

interface ProcessCatalogModalProps {
    organizationId: string;
    onClose: () => void;
    onChanged?: () => void; // katalog/pravila izmijenjeni → pozivalac invalidira cache
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
    zIndex?: number; // za slaganje preko drugog modala (npr. Plan procesa)
}

/**
 * Upravljanje procesima organizacije:
 * - Katalog: registar naziva; REDOSLIJED = kanonski redoslijed proizvodnje (planovi/pravila ga slijede)
 * - Pravila: materijal (kategorija / naziv sadrži) → procesi, za auto-plan proizvoda
 */
export default function ProcessCatalogModal({ organizationId, onClose, onChanged, showToast, zIndex }: ProcessCatalogModalProps) {
    const [tab, setTab] = useState<'catalog' | 'rules'>('catalog');
    const [loading, setLoading] = useState(true);
    const [catalog, setCatalog] = useState<ProcessCatalogItem[]>([]);
    const [rules, setRules] = useState<ProcessMaterialRule[]>([]);

    // Katalog state
    const [newName, setNewName] = useState('');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');

    // Pravila state (novi red)
    const [ruleKind, setRuleKind] = useState<'category' | 'name_contains'>('category');
    const [ruleValue, setRuleValue] = useState(MATERIAL_CATEGORIES[0]);
    const [ruleProcesses, setRuleProcesses] = useState<string[]>([]);

    const load = async () => {
        setLoading(true);
        try {
            const [cat, r] = await Promise.all([
                getProcessCatalog(organizationId),
                getProcessMaterialRules(organizationId),
            ]);
            setCatalog(cat);
            setRules(r);
        } catch (e) {
            console.error('catalog load error', e);
            showToast('Greška pri učitavanju kataloga', 'error');
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => { load(); }, [organizationId]);

    const notifyChanged = () => onChanged?.();

    async function addProcess(name: string) {
        const res = await saveProcessCatalogItem(name, organizationId);
        if (res.success) { setNewName(''); await load(); notifyChanged(); }
        else showToast(res.message, 'error');
    }

    async function move(idx: number, dir: -1 | 1) {
        const next = [...catalog];
        const j = idx + dir;
        if (j < 0 || j >= next.length) return;
        [next[idx], next[j]] = [next[j], next[idx]];
        setCatalog(next); // optimistički
        const res = await reorderProcessCatalog(next.map(c => c.ID), organizationId);
        if (!res.success) { showToast(res.message, 'error'); await load(); }
        else notifyChanged();
    }

    async function saveRename(id: string) {
        const res = await renameProcessCatalogItem(id, editName, organizationId);
        setEditingId(null);
        if (res.success) { await load(); notifyChanged(); }
        else showToast(res.message, 'error');
    }

    async function removeProcess(item: ProcessCatalogItem) {
        if (!confirm(`Obrisati proces "${item.Name}" iz kataloga?\nPostojeći planovi proizvoda zadržavaju naziv — samo nestaje iz ponude i redoslijeda.`)) return;
        const res = await deleteProcessCatalogItem(item.ID, organizationId);
        if (res.success) { await load(); notifyChanged(); }
        else showToast(res.message, 'error');
    }

    async function addRule() {
        if (!ruleValue.trim() || ruleProcesses.length === 0) {
            showToast('Pravilo mora imati vrijednost i bar jedan proces', 'error');
            return;
        }
        const res = await saveProcessMaterialRule({ Match_Kind: ruleKind, Match_Value: ruleValue, Processes: ruleProcesses, Organization_ID: organizationId }, organizationId);
        if (res.success) {
            setRuleProcesses([]);
            setRuleValue(ruleKind === 'category' ? MATERIAL_CATEGORIES[0] : '');
            await load(); notifyChanged();
        } else showToast(res.message, 'error');
    }

    async function removeRule(id: string) {
        const res = await deleteProcessMaterialRule(id, organizationId);
        if (res.success) { await load(); notifyChanged(); }
        else showToast(res.message, 'error');
    }

    const tabBtn = (active: boolean): React.CSSProperties => ({
        padding: '8px 16px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
        border: 'none', borderBottom: `2px solid ${active ? 'var(--accent, #0071e3)' : 'transparent'}`,
        background: 'none', color: active ? 'var(--accent, #0071e3)' : '#64748b',
        display: 'inline-flex', alignItems: 'center', gap: '6px',
    });

    const missingCommon = COMMON_PROCESSES.filter(p => !catalog.some(c => c.Name.trim().toLowerCase() === p.toLowerCase()));

    return (
        <Modal
            isOpen
            onClose={onClose}
            title="Upravljaj procesima"
            footer={<button className="btn btn-secondary" onClick={onClose}>Zatvori</button>}
            zIndex={zIndex}
        >
            <div style={{ borderBottom: '1px solid #e2e8f0', marginBottom: '14px' }}>
                <button style={tabBtn(tab === 'catalog')} onClick={() => setTab('catalog')}><ListOrdered size={15} /> Katalog ({catalog.length})</button>
                <button style={tabBtn(tab === 'rules')} onClick={() => setTab('rules')}><Wand2 size={15} /> Pravila materijal → proces ({rules.length})</button>
            </div>

            {loading && <div style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>Učitavanje…</div>}

            {!loading && tab === 'catalog' && (
                <div>
                    <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '10px' }}>
                        Redoslijed u katalogu = redoslijed proizvodnje — planovi proizvoda i automatski prijedlozi ga slijede.
                    </div>

                    {/* Dodavanje */}
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                        <input
                            value={newName}
                            onChange={e => setNewName(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter' && newName.trim()) addProcess(newName); }}
                            placeholder="Novi proces (npr. Kantiranje)…"
                            style={{ flex: 1, padding: '8px 12px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px' }}
                        />
                        <button className="glass-btn" disabled={!newName.trim()} onClick={() => addProcess(newName)} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                            <Plus size={15} /> Dodaj
                        </button>
                    </div>

                    {/* Quick-add standardnih (samo prijedlog, ništa se ne upisuje tiho) */}
                    {missingCommon.length > 0 && (
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px' }}>
                            <span style={{ fontSize: '11px', color: '#94a3b8', alignSelf: 'center' }}>Brzo dodaj:</span>
                            {missingCommon.map(p => (
                                <button key={p} onClick={() => addProcess(p)} style={{
                                    fontSize: '11px', padding: '3px 10px', borderRadius: '999px',
                                    border: '1px dashed #cbd5e1', background: 'none', color: '#64748b', cursor: 'pointer',
                                }}>+ {p}</button>
                            ))}
                        </div>
                    )}

                    {/* Lista s redoslijedom */}
                    <div style={{ border: '1px solid #e2e8f0', borderRadius: '10px', overflow: 'hidden' }}>
                        {catalog.length === 0 && <div style={{ padding: '20px', textAlign: 'center', color: '#94a3b8', fontSize: '13px' }}>Katalog je prazan — dodaj procese svoje proizvodnje.</div>}
                        {catalog.map((item, idx) => (
                            <div key={item.ID} style={{
                                display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px',
                                borderBottom: idx < catalog.length - 1 ? '1px solid #f1f5f9' : 'none',
                                background: idx % 2 ? '#fafafa' : 'white',
                            }}>
                                <span style={{ width: '22px', fontSize: '12px', color: '#94a3b8', fontWeight: 700 }}>{idx + 1}.</span>
                                {editingId === item.ID ? (
                                    <>
                                        <input value={editName} onChange={e => setEditName(e.target.value)} autoFocus
                                            onKeyDown={e => { if (e.key === 'Enter') saveRename(item.ID); }}
                                            style={{ flex: 1, padding: '4px 8px', borderRadius: '6px', border: '1px solid var(--accent, #0071e3)', fontSize: '13px' }} />
                                        <button className="icon-btn" onClick={() => saveRename(item.ID)} title="Sačuvaj"><Check size={15} /></button>
                                    </>
                                ) : (
                                    <span style={{ flex: 1, fontSize: '13px', fontWeight: 500 }}>{item.Name}</span>
                                )}
                                <button className="icon-btn" disabled={idx === 0} onClick={() => move(idx, -1)} title="Gore"><ArrowUp size={14} /></button>
                                <button className="icon-btn" disabled={idx === catalog.length - 1} onClick={() => move(idx, 1)} title="Dolje"><ArrowDown size={14} /></button>
                                <button className="icon-btn" onClick={() => { setEditingId(item.ID); setEditName(item.Name); }} title="Preimenuj"><Pencil size={14} /></button>
                                <button className="icon-btn danger" onClick={() => removeProcess(item)} title="Obriši"><Trash2 size={14} /></button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {!loading && tab === 'rules' && (
                <div>
                    <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '10px' }}>
                        Kad proizvod ima materijal koji odgovara pravilu, plan procesa se automatski popuni (dok ga ručno ne izmijeniš).
                    </div>

                    {/* Postojeća pravila */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '14px' }}>
                        {rules.length === 0 && <div style={{ padding: '14px', textAlign: 'center', color: '#94a3b8', fontSize: '13px', border: '1px dashed #e2e8f0', borderRadius: '10px' }}>Nema pravila — dodaj prvo ispod.</div>}
                        {rules.map(r => (
                            <div key={r.ID} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: '10px', fontSize: '13px' }}>
                                <span style={{ fontSize: '11px', fontWeight: 700, color: '#475569', background: '#f1f5f9', padding: '2px 8px', borderRadius: '999px', whiteSpace: 'nowrap' }}>
                                    {r.Match_Kind === 'category' ? 'Kategorija' : 'Naziv sadrži'}
                                </span>
                                <strong>{r.Match_Value}</strong>
                                <span style={{ color: '#94a3b8' }}>→</span>
                                <span style={{ flex: 1, color: '#0f172a' }}>{r.Processes.join(' → ')}</span>
                                <button className="icon-btn danger" onClick={() => removeRule(r.ID)} title="Obriši pravilo"><Trash2 size={14} /></button>
                            </div>
                        ))}
                    </div>

                    {/* Novo pravilo */}
                    <div style={{ border: '1px solid #e2e8f0', borderRadius: '10px', padding: '12px', background: '#f8fafc' }}>
                        <div style={{ fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '10px' }}>+ Novo pravilo</div>
                        <div style={{ display: 'flex', gap: '8px', marginBottom: '10px', flexWrap: 'wrap' }}>
                            <select value={ruleKind} onChange={e => {
                                const k = e.target.value as 'category' | 'name_contains';
                                setRuleKind(k);
                                setRuleValue(k === 'category' ? MATERIAL_CATEGORIES[0] : '');
                            }} style={{ padding: '7px 10px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px' }}>
                                <option value="category">Kategorija materijala</option>
                                <option value="name_contains">Naziv materijala sadrži</option>
                            </select>
                            {ruleKind === 'category' ? (
                                <select value={ruleValue} onChange={e => setRuleValue(e.target.value)} style={{ padding: '7px 10px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px', flex: 1, minWidth: '160px' }}>
                                    {MATERIAL_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                            ) : (
                                <input value={ruleValue} onChange={e => setRuleValue(e.target.value)} placeholder='npr. "lak", "staklo", "led"…'
                                    style={{ padding: '7px 10px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px', flex: 1, minWidth: '160px' }} />
                            )}
                        </div>
                        <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '6px' }}>Procesi koje pravilo dodaje (redoslijed određuje katalog):</div>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px' }}>
                            {catalog.length === 0 && <span style={{ fontSize: '12px', color: '#94a3b8' }}>Katalog je prazan — prvo dodaj procese u tabu Katalog.</span>}
                            {catalog.map(c => {
                                const on = ruleProcesses.includes(c.Name);
                                return (
                                    <button key={c.ID} onClick={() => setRuleProcesses(prev => on ? prev.filter(p => p !== c.Name) : [...prev, c.Name])}
                                        style={{
                                            fontSize: '12px', padding: '4px 12px', borderRadius: '999px', cursor: 'pointer',
                                            border: `1px solid ${on ? 'var(--accent, #0071e3)' : '#cbd5e1'}`,
                                            background: on ? 'var(--accent-light, #e8f1fd)' : 'white',
                                            color: on ? 'var(--accent, #0071e3)' : '#475569', fontWeight: on ? 700 : 500,
                                        }}>
                                        {on ? '✓ ' : ''}{c.Name}
                                    </button>
                                );
                            })}
                        </div>
                        <button className="glass-btn" onClick={addRule} disabled={!ruleValue.trim() || ruleProcesses.length === 0}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}>
                            <Plus size={15} /> Dodaj pravilo
                        </button>
                    </div>
                </div>
            )}
        </Modal>
    );
}
