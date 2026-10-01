'use client';

import { useState, type DragEvent } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { ArrowDown, ArrowUp, CheckCircle2, ChevronDown, Circle, Edit3, GripVertical, Plus, Trash2, X } from 'lucide-react';
import type { ChecklistItem, TaskChecklistGroup } from '@/lib/types';
import './TaskChecklistEditor.css';

interface Section {
    id: string | null;
    name: string;
    items: ChecklistItem[];
}

function sectionsFor(items: ChecklistItem[], groups: TaskChecklistGroup[]): Section[] {
    const known = new Set(groups.map(group => group.id));
    return [
        { id: null, name: 'Bez grupe', items: items.filter(item => !item.groupId || !known.has(item.groupId)) },
        ...groups.map(group => ({ id: group.id, name: group.name, items: items.filter(item => item.groupId === group.id) })),
    ];
}

function flatten(sections: Section[]): ChecklistItem[] {
    return sections.flatMap(section => section.items.map(item => {
        if (section.id) return { ...item, groupId: section.id };
        const { groupId, ...ungrouped } = item;
        return ungrouped;
    }));
}

export default function TaskChecklistEditor({ items, groups, onChange }: {
    items: ChecklistItem[];
    groups: TaskChecklistGroup[];
    onChange: (items: ChecklistItem[], groups: TaskChecklistGroup[]) => void;
}) {
    const [newItem, setNewItem] = useState('');
    const [newItemGroupId, setNewItemGroupId] = useState('');
    const [newGroup, setNewGroup] = useState('');
    const [addingGroup, setAddingGroup] = useState(false);
    const [editingItemId, setEditingItemId] = useState<string | null>(null);
    const [itemDraft, setItemDraft] = useState('');
    const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
    const [groupDraft, setGroupDraft] = useState('');
    const [draggingId, setDraggingId] = useState<string | null>(null);

    const sections = sectionsFor(items, groups);

    const addItem = () => {
        const value = newItem.trim();
        if (!value) return;
        const next = sectionsFor(items, groups);
        const destination = next.find(section => section.id === (newItemGroupId || null)) || next[0];
        destination.items.push({ id: uuidv4(), text: value, completed: false });
        onChange(flatten(next), groups);
        setNewItem('');
    };

    const addGroup = () => {
        const value = newGroup.trim();
        if (!value || groups.some(group => group.name.localeCompare(value, undefined, { sensitivity: 'base' }) === 0)) return;
        const id = uuidv4();
        onChange(items, [...groups, { id, name: value }]);
        setNewItemGroupId(id);
        setNewGroup('');
        setAddingGroup(false);
    };

    const moveItem = (itemId: string, destinationId: string | null, beforeId?: string) => {
        const next = sectionsFor(items, groups);
        const source = next.find(section => section.items.some(item => item.id === itemId));
        const destination = next.find(section => section.id === destinationId);
        if (!source || !destination || itemId === beforeId) return;
        const index = source.items.findIndex(item => item.id === itemId);
        const [item] = source.items.splice(index, 1);
        const insertion = beforeId ? destination.items.findIndex(candidate => candidate.id === beforeId) : -1;
        destination.items.splice(insertion < 0 ? destination.items.length : insertion, 0, item);
        onChange(flatten(next), groups);
    };

    const nudgeItem = (section: Section, itemId: string, direction: -1 | 1) => {
        const index = section.items.findIndex(item => item.id === itemId);
        const other = section.items[index + direction];
        if (!other) return;
        const next = sectionsFor(items, groups);
        const selected = next.find(candidate => candidate.id === section.id)!;
        [selected.items[index], selected.items[index + direction]] = [selected.items[index + direction], selected.items[index]];
        onChange(flatten(next), groups);
    };

    const nudgeGroup = (groupId: string, direction: -1 | 1) => {
        const index = groups.findIndex(group => group.id === groupId);
        const target = index + direction;
        if (target < 0 || target >= groups.length) return;
        const nextGroups = [...groups];
        [nextGroups[index], nextGroups[target]] = [nextGroups[target], nextGroups[index]];
        onChange(flatten(sectionsFor(items, nextGroups)), nextGroups);
    };

    const removeGroup = (groupId: string) => {
        const nextGroups = groups.filter(group => group.id !== groupId);
        const nextItems = items.map(item => {
            if (item.groupId !== groupId) return item;
            const { groupId: removed, ...ungrouped } = item;
            return ungrouped;
        });
        onChange(flatten(sectionsFor(nextItems, nextGroups)), nextGroups);
        if (newItemGroupId === groupId) setNewItemGroupId('');
    };

    const saveItemEdit = () => {
        if (!editingItemId) return;
        const value = itemDraft.trim();
        if (value) onChange(items.map(item => item.id === editingItemId ? { ...item, text: value } : item), groups);
        setEditingItemId(null);
    };

    const saveGroupEdit = () => {
        if (!editingGroupId) return;
        const value = groupDraft.trim();
        if (value && !groups.some(group => group.id !== editingGroupId && group.name.localeCompare(value, undefined, { sensitivity: 'base' }) === 0)) {
            onChange(items, groups.map(group => group.id === editingGroupId ? { ...group, name: value } : group));
        }
        setEditingGroupId(null);
    };

    const startDrag = (event: DragEvent<HTMLDivElement>, id: string) => {
        setDraggingId(id);
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', id);
    };

    const dropItem = (event: DragEvent<HTMLElement>, sectionId: string | null, beforeId?: string) => {
        event.preventDefault();
        event.stopPropagation();
        const itemId = draggingId || event.dataTransfer.getData('text/plain');
        if (itemId) moveItem(itemId, sectionId, beforeId);
        setDraggingId(null);
    };

    return (
        <div className={`tce${groups.length > 0 ? ' has-groups' : ''}`}>
            <div className={`tce-add${groups.length > 0 ? ' has-groups' : ''}`}>
                <input
                    value={newItem}
                    onChange={event => setNewItem(event.target.value)}
                    onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addItem(); } }}
                    placeholder="Dodaj novu stavku…"
                    aria-label="Nova stavka kontrolne liste"
                />
                {groups.length > 0 && (
                    <span className="tce-select-wrap tce-add-select">
                        <select value={newItemGroupId} onChange={event => setNewItemGroupId(event.target.value)} aria-label="Grupa nove stavke">
                            <option value="">Bez grupe</option>
                            {groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
                        </select>
                        <ChevronDown size={15} aria-hidden="true" />
                    </span>
                )}
                <button type="button" className="tce-add-item-btn" onClick={addItem} disabled={!newItem.trim()} aria-label="Dodaj stavku"><Plus size={18} /></button>
            </div>

            {items.length === 0 && groups.length === 0 && <p className="tce-empty">Nema stavki u kontrolnoj listi.</p>}

            <div className="tce-sections">
                {sections.map((section, sectionIndex) => {
                    if (!section.id && section.items.length === 0 && groups.length > 0) return null;
                    return (
                        <div
                            key={section.id || 'ungrouped'}
                            className={`tce-section${draggingId ? ' is-dragging' : ''}`}
                            onDragOver={event => event.preventDefault()}
                            onDrop={event => dropItem(event, section.id)}
                        >
                            {section.id && (
                                <div className="tce-group-head">
                                    {editingGroupId === section.id ? (
                                        <input
                                            autoFocus
                                            value={groupDraft}
                                            onChange={event => setGroupDraft(event.target.value)}
                                            onKeyDown={event => { if (event.key === 'Enter') saveGroupEdit(); if (event.key === 'Escape') setEditingGroupId(null); }}
                                            onBlur={saveGroupEdit}
                                            aria-label="Naziv grupe"
                                        />
                                    ) : (
                                        <strong>{section.name}</strong>
                                    )}
                                    <span className="tce-group-count">{section.items.length}</span>
                                    <div className="tce-group-actions">
                                        <button type="button" onClick={() => nudgeGroup(section.id!, -1)} disabled={sectionIndex <= 1} aria-label={`Pomjeri grupu ${section.name} gore`} title="Pomjeri grupu gore"><ArrowUp size={14} /></button>
                                        <button type="button" onClick={() => nudgeGroup(section.id!, 1)} disabled={sectionIndex === sections.length - 1} aria-label={`Pomjeri grupu ${section.name} dolje`} title="Pomjeri grupu dolje"><ArrowDown size={14} /></button>
                                        <button type="button" onClick={() => { setEditingGroupId(section.id); setGroupDraft(section.name); }} aria-label={`Preimenuj grupu ${section.name}`} title="Preimenuj grupu"><Edit3 size={14} /></button>
                                        <button type="button" onClick={() => removeGroup(section.id!)} aria-label={`Ukloni grupu ${section.name}`} title="Ukloni grupu; stavke ostaju"><X size={15} /></button>
                                    </div>
                                </div>
                            )}
                            {!section.id && groups.length > 0 && <div className="tce-ungrouped-head">Bez grupe</div>}
                            {section.items.length === 0 && section.id && <p className="tce-group-empty">Izaberite ovu grupu pri dodavanju stavke ili prevucite stavku ovdje.</p>}
                            {section.items.map((item, index) => (
                                <div
                                    key={item.id}
                                    className={`tce-row${item.completed ? ' done' : ''}${draggingId === item.id ? ' dragging' : ''}`}
                                    draggable={editingItemId !== item.id}
                                    onDragStart={event => startDrag(event, item.id)}
                                    onDragEnd={() => setDraggingId(null)}
                                    onDragOver={event => event.preventDefault()}
                                    onDrop={event => {
                                        const bounds = event.currentTarget.getBoundingClientRect();
                                        const after = event.clientY > bounds.top + bounds.height / 2;
                                        dropItem(event, section.id, after ? section.items[index + 1]?.id : item.id);
                                    }}
                                >
                                    <GripVertical className="tce-grip" size={15} aria-hidden="true" />
                                    <button type="button" className="tce-check" onClick={() => onChange(items.map(candidate => candidate.id === item.id ? { ...candidate, completed: !candidate.completed } : candidate), groups)} aria-label={item.completed ? `Poništi ${item.text}` : `Završi ${item.text}`}>
                                        {item.completed ? <CheckCircle2 size={18} /> : <Circle size={18} />}
                                    </button>
                                    {editingItemId === item.id ? (
                                        <input
                                            className="tce-item-edit"
                                            autoFocus
                                            value={itemDraft}
                                            onChange={event => setItemDraft(event.target.value)}
                                            onKeyDown={event => { if (event.key === 'Enter') saveItemEdit(); if (event.key === 'Escape') setEditingItemId(null); }}
                                            onBlur={saveItemEdit}
                                            aria-label="Tekst stavke"
                                        />
                                    ) : (
                                        <span className="tce-item-text" onDoubleClick={() => { setEditingItemId(item.id); setItemDraft(item.text); }}>{item.text}</span>
                                    )}
                                    {groups.length > 0 && (
                                        <span className="tce-select-wrap tce-group-field">
                                            <select
                                                className="tce-group-select"
                                                value={section.id || ''}
                                                onChange={event => moveItem(item.id, event.target.value || null)}
                                                aria-label={`Grupa stavke ${item.text}`}
                                            >
                                                <option value="">Bez grupe</option>
                                                {groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
                                            </select>
                                            <ChevronDown size={14} aria-hidden="true" />
                                        </span>
                                    )}
                                    <div className="tce-row-actions">
                                        <button type="button" onClick={() => nudgeItem(section, item.id, -1)} disabled={index === 0} aria-label={`Pomjeri ${item.text} gore`} title="Pomjeri gore"><ArrowUp size={14} /></button>
                                        <button type="button" onClick={() => nudgeItem(section, item.id, 1)} disabled={index === section.items.length - 1} aria-label={`Pomjeri ${item.text} dolje`} title="Pomjeri dolje"><ArrowDown size={14} /></button>
                                        <button type="button" onClick={() => { setEditingItemId(item.id); setItemDraft(item.text); }} aria-label={`Uredi ${item.text}`} title="Uredi stavku"><Edit3 size={14} /></button>
                                        <button type="button" onClick={() => onChange(items.filter(candidate => candidate.id !== item.id), groups)} aria-label={`Obriši ${item.text}`} title="Obriši stavku"><Trash2 size={14} /></button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    );
                })}
            </div>

            {addingGroup ? (
                <div className="tce-new-group">
                    <input autoFocus value={newGroup} onChange={event => setNewGroup(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') addGroup(); if (event.key === 'Escape') setAddingGroup(false); }} placeholder="Naziv nove grupe" aria-label="Naziv nove grupe" />
                    <button type="button" className="tce-create-group" onClick={addGroup} disabled={!newGroup.trim() || groups.some(group => group.name.localeCompare(newGroup.trim(), undefined, { sensitivity: 'base' }) === 0)}>Dodaj grupu</button>
                    <button type="button" className="tce-cancel-group" onClick={() => { setAddingGroup(false); setNewGroup(''); }} aria-label="Odustani od grupe"><X size={16} /></button>
                </div>
            ) : (
                <button type="button" className="tce-add-group" onClick={() => setAddingGroup(true)}><Plus size={15} /> Dodaj grupu</button>
            )}
            {items.length > 1 && <p className="tce-hint">Stavke možete prevući ili pomjeriti strelicama. Promjene se čuvaju kada spremite zadatak.</p>}
        </div>
    );
}
