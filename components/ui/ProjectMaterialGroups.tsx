'use client';

import { useMemo } from 'react';
import type { Project } from '@/lib/types';
import { groupProjectMaterials, projectMaterialRows } from '@/lib/projectCommand';

export default function ProjectMaterialGroups({ project, filter }: { project: Project; filter: string }) {
    const groups = useMemo(() => groupProjectMaterials(projectMaterialRows(project).filter(m => !filter ||
        (filter === 'ready' ? m.Status === 'Primljeno' || m.Status === 'Na stanju' : m.Status === filter)), m => m), [project, filter]);
    const qty = (value: number, unit: string) => `${value.toLocaleString('bs-BA', { maximumFractionDigits: 2 })} ${unit}`;
    if (!groups.length) return <div className="pov-empty-inline">Nema materijala u ovom prikazu.</div>;
    return <div>{groups.map(group => <details className="pov-product-material-group" key={group.id} open>
        <summary>{group.name}<span>{group.rows.length} stavki</span></summary>
        <div className="pov-table-wrap"><table className="pov-table"><thead><tr><th>Materijal</th><th className="r">Potrebno</th><th className="r">Na stanju</th><th className="r">Naručeno</th><th className="r">Primljeno</th><th className="r">Nedostaje za rad</th><th>Status</th></tr></thead>
            <tbody>{group.rows.map((m, index) => <tr key={m.ID || `${m.Material_ID}-${index}`}><td><div className="pov-mat-name">{m.name}</div>{m.Supplier && <div className="pov-mat-sub">{m.Supplier}</div>}</td><td data-label="Potrebno" className="r fw">{qty(m.needed, m.Unit)}</td><td data-label="Na stanju" className="r">{qty(m.On_Stock || 0, m.Unit)}</td><td data-label="Naručeno" className="r">{qty(m.Ordered_Quantity || 0, m.Unit)}</td><td data-label="Primljeno" className="r">{qty(m.Received_Quantity || 0, m.Unit)}</td><td data-label="Nedostaje za rad" className="r fw">{qty(m.remaining, m.Unit)}</td><td><span className={`pov-chip ${m.Status === 'Primljeno' || m.Status === 'Na stanju' ? 's-done' : m.Status === 'Naručeno' ? 's-progress' : 's-wait'}`}>{m.Status}</span></td></tr>)}</tbody>
        </table></div>
    </details>)}</div>;
}
