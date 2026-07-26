'use client';

// ════════════════════════════════════════════════════════════════════
// PETLJA UČENJA — AI predlaže pravila, ČOVJEK potvrđuje.
//
// AI se zove SAMO za neriješene distinct nazive (desetak stringova, ne hiljade
// naloga). Potvrđeno pravilo ide u org_settings i od tada radi deterministički
// sloj — isti naziv se AI-u više ne šalje.
//
// Prijedlog modela je PODATAK, ne naredba: sve je uređivo prije potvrde, i
// ništa se ne primjenjuje bez izričitog klika.
// ════════════════════════════════════════════════════════════════════

import { useState, useCallback } from 'react';
import {
    getProductionSnapshots, collectUnresolved, saveOrgSettings, getOrgSettings,
    getProductTaxonomy, getMaterialTaxonomy,
    type UnresolvedEntry,
} from '@/lib/services';
import { useAuth } from '@/context/AuthContext';
import './NameClassificationReview.css';

type Kind = 'product' | 'material';

interface Proposal {
    name: string;
    typeKey: string;
    typeLabel: string;
    isNewType: boolean;
    patterns: string[];
    confidence: number;
    reason: string;
}

interface Row extends Proposal {
    accepted: boolean;
    count: number;
    examples: string[];
}

const KIND_LABEL: Record<Kind, string> = {
    product: 'nazivi naloga i proizvoda',
    material: 'nazivi materijala',
};

export default function NameClassificationReview() {
    const { organization } = useAuth();
    const orgId = organization?.Organization_ID || '';

    const [kind, setKind] = useState<Kind>('material');
    const [unresolved, setUnresolved] = useState<{ product: UnresolvedEntry[]; material: UnresolvedEntry[] } | null>(null);
    const [rows, setRows] = useState<Row[] | null>(null);
    const [busy, setBusy] = useState<'scan' | 'ai' | 'save' | null>(null);
    const [note, setNote] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

    const scan = useCallback(async () => {
        if (!orgId) return;
        setBusy('scan');
        setNote(null);
        setRows(null);
        try {
            const snapshots = await getProductionSnapshots(orgId);
            const rep = collectUnresolved(snapshots);
            setUnresolved({ product: rep.names, material: rep.materials });
            if (rep.snapshotsScanned === 0) {
                setNote({ text: 'Nema v3 snapshota — prvo pokreni „Regeneriši snapshote".', type: 'info' });
            }
        } catch {
            setNote({ text: 'Greška pri čitanju snapshota', type: 'error' });
        } finally {
            setBusy(null);
        }
    }, [orgId]);

    const askAI = useCallback(async () => {
        const list = unresolved?.[kind] || [];
        if (list.length === 0 || !orgId) return;
        setBusy('ai');
        setNote(null);
        try {
            const known = kind === 'product'
                ? (await getProductTaxonomy(orgId)).map(t => ({ key: t.key, label: t.label }))
                : (await getMaterialTaxonomy(orgId)).map(t => ({ key: t.key, label: t.label }));

            const res = await fetch('/api/classify-names', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ kind, names: list.slice(0, 60).map(u => u.name), knownTypes: known }),
            });
            const data = await res.json();
            if (!res.ok) {
                setNote({ text: data?.error || 'Greška pri analizi', type: 'error' });
                return;
            }
            const byName = new Map(list.map(u => [u.name, u]));
            const proposals: Row[] = (data.proposals as Proposal[]).map(p => ({
                ...p,
                accepted: p.confidence >= 0.7,   // sigurne unaprijed čekirane, ostale svjesna odluka
                count: byName.get(p.name)?.count || 0,
                examples: byName.get(p.name)?.examples || [],
            }));
            setRows(proposals);
            if (proposals.length === 0) {
                setNote({ text: 'Model nije prepoznao nijedan naziv kao kategoriju.', type: 'info' });
            }
        } catch {
            setNote({ text: 'Greška pri pozivu AI-a', type: 'error' });
        } finally {
            setBusy(null);
        }
    }, [unresolved, kind, orgId]);

    const applyAccepted = useCallback(async () => {
        if (!rows || !orgId) return;
        const accepted = rows.filter(r => r.accepted);
        if (accepted.length === 0) return;
        setBusy('save');
        setNote(null);
        try {
            const settings = await getOrgSettings(orgId);
            const existing = (kind === 'product'
                ? settings?.productTaxonomy
                : settings?.materialTaxonomy) || [];

            // Spoji po ključu tipa: više naziva može pripasti istom tipu
            const merged = new Map<string, { key: string; label: string; patterns: string[] }>();
            for (const t of existing) merged.set(t.key, { key: t.key, label: t.label, patterns: [...t.patterns] });
            for (const r of accepted) {
                const e = merged.get(r.typeKey) || { key: r.typeKey, label: r.typeLabel, patterns: [] };
                for (const p of r.patterns) if (!e.patterns.includes(p)) e.patterns.push(p);
                merged.set(r.typeKey, e);
            }
            const taxonomy = Array.from(merged.values());

            const res = await saveOrgSettings(orgId, kind === 'product'
                ? { productTaxonomy: taxonomy }
                : { materialTaxonomy: taxonomy });

            if (res.success) {
                setNote({
                    text: `Spremljeno ${accepted.length} pravila. Pokreni „Regeneriši snapshote" da se primijene na istoriju.`,
                    type: 'success',
                });
                setRows(rows.filter(r => !r.accepted));
            } else {
                setNote({ text: res.message, type: 'error' });
            }
        } catch {
            setNote({ text: 'Greška pri spremanju pravila', type: 'error' });
        } finally {
            setBusy(null);
        }
    }, [rows, kind, orgId]);

    const patch = (i: number, upd: Partial<Row>) =>
        setRows(rs => rs ? rs.map((r, j) => (j === i ? { ...r, ...upd } : r)) : rs);

    const list = unresolved?.[kind] || [];
    const acceptedCount = rows?.filter(r => r.accepted).length || 0;

    return (
        <section className="settings-section">
            <div className="settings-section-header">
                <h2>Prepoznavanje naziva</h2>
                <p>
                    Nazivi koje taksonomija ne zna. AI predlaže pravilo, ti ga potvrdiš — i od tada
                    radi bez AI-a. Zato rebuild radi isto i bez interneta.
                </p>
            </div>

            <div className="ncr-kind">
                {(['material', 'product'] as Kind[]).map(k => (
                    <button
                        key={k}
                        className={`ncr-kind-btn ${kind === k ? 'active' : ''}`}
                        onClick={() => { setKind(k); setRows(null); setNote(null); }}
                    >
                        {KIND_LABEL[k]}
                        {unresolved && <span className="ncr-count">{unresolved[k].length}</span>}
                    </button>
                ))}
            </div>

            <div className="ncr-actions">
                <button className="btn btn-secondary" onClick={scan} disabled={!!busy}>
                    <span className="material-icons-round">search</span>
                    {busy === 'scan' ? 'Tražim…' : 'Nađi neprepoznato'}
                </button>
                <button className="btn btn-secondary" onClick={askAI} disabled={!!busy || list.length === 0}>
                    <span className="material-icons-round">auto_awesome</span>
                    {busy === 'ai' ? 'Analiziram…' : `Analiziraj (${list.length})`}
                </button>
                {rows && rows.length > 0 && (
                    <button className="btn btn-primary" onClick={applyAccepted} disabled={!!busy || acceptedCount === 0}>
                        <span className="material-icons-round">check</span>
                        {busy === 'save' ? 'Spremam…' : `Potvrdi ${acceptedCount}`}
                    </button>
                )}
            </div>

            {note && (
                <div className={`ncr-note ncr-note-${note.type}`}>{note.text}</div>
            )}

            {unresolved && !rows && list.length > 0 && (
                <ul className="ncr-list">
                    {list.slice(0, 40).map(u => (
                        <li key={u.name}>
                            <span className="ncr-name">{u.name}</span>
                            <span className="ncr-times">{u.count}×</span>
                            {u.examples.length > 0 && <span className="ncr-ex">{u.examples.join(', ')}</span>}
                        </li>
                    ))}
                </ul>
            )}

            {unresolved && list.length === 0 && (
                <p className="ncr-empty">Sve je prepoznato — nema šta mapirati.</p>
            )}

            {rows && rows.length > 0 && (
                <div className="ncr-rows">
                    {rows.map((r, i) => (
                        <div className={`ncr-row ${r.accepted ? 'accepted' : ''}`} key={r.name}>
                            <label className="ncr-check">
                                <input
                                    type="checkbox"
                                    checked={r.accepted}
                                    onChange={e => patch(i, { accepted: e.target.checked })}
                                />
                            </label>
                            <div className="ncr-row-body">
                                <div className="ncr-row-head">
                                    <strong>{r.name}</strong>
                                    <span className="ncr-times">{r.count}×</span>
                                    <span className={`ncr-conf ${r.confidence < 0.6 ? 'low' : ''}`}>
                                        {Math.round(r.confidence * 100)}%
                                    </span>
                                    {r.isNewType && <span className="ncr-badge">nov tip</span>}
                                </div>
                                <div className="ncr-row-fields">
                                    <label>
                                        <span>Tip</span>
                                        <input
                                            value={r.typeLabel}
                                            onChange={e => patch(i, { typeLabel: e.target.value })}
                                        />
                                    </label>
                                    <label>
                                        <span>Pravilo (korijen riječi)</span>
                                        <input
                                            value={r.patterns.join(', ')}
                                            onChange={e => patch(i, {
                                                patterns: e.target.value.split(',').map(s => s.trim()).filter(Boolean),
                                            })}
                                        />
                                    </label>
                                </div>
                                {r.reason && <p className="ncr-reason">{r.reason}</p>}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </section>
    );
}
