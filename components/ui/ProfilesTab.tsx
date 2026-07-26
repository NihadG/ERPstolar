'use client';

// ════════════════════════════════════════════════════════════════════
// PROFILI — šta istorija govori o radnicima, tipovima proizvoda i toku.
//
// SVE JE OPIS PROŠLOSTI, NE PREDVIĐANJE. Svaki broj nosi svoj uzorak (n),
// jer medijan od 2 naloga i medijan od 50 izgledaju isto na ekranu a znače
// potpuno različite stvari.
//
// Podaci dolaze iz production_snapshots v3 i NE zavise od filtera perioda
// iznad — profil ima smisla samo nad cijelom istorijom.
// ════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo } from 'react';
import { Loader2, AlertTriangle } from 'lucide-react';
import {
    getProductionSnapshots, buildWorkerAffinity, buildTypeProfiles, buildFlowSummary,
} from '@/lib/services';
import { PRODUCT_TYPES } from '@/lib/classify/taxonomy';
import { MATERIAL_TYPES } from '@/lib/productProcesses';
import type { ProductionSnapshot } from '@/lib/types';
import type { Dist } from '@/lib/insights/stats';

type View = 'workers' | 'types' | 'flow';

const productLabel = new Map(PRODUCT_TYPES.map(t => [t.key, t.label]));
const materialLabel = new Map(MATERIAL_TYPES.map(t => [t.key, t.label]));

const d1 = (n: number) => (Math.round(n * 10) / 10).toLocaleString('hr-HR');

/** Raspon uz uzorak — nikad medijan bez `n`. */
function Range({ dist, unit }: { dist: Dist | null; unit: string }) {
    if (!dist) return <span className="pf-muted">nema podataka</span>;
    return (
        <span className="pf-range">
            <strong>{d1(dist.p50)}</strong> {unit}
            <span className="pf-muted"> ({d1(dist.p25)}–{d1(dist.p75)}, n={dist.n})</span>
        </span>
    );
}

function Bar({ pct, tone = 'accent' }: { pct: number; tone?: string }) {
    return (
        <div className="ana-bar-track">
            <div
                className="ana-bar-fill"
                style={{
                    width: `${Math.max(2, Math.min(100, pct))}%`,
                    background: tone === 'warn' ? 'var(--warning)' : 'var(--accent)',
                }}
            />
        </div>
    );
}

export default function ProfilesTab({ organizationId }: { organizationId: string }) {
    const [snapshots, setSnapshots] = useState<ProductionSnapshot[] | null>(null);
    const [loading, setLoading] = useState(true);
    const [view, setView] = useState<View>('workers');

    // Snapshoti se učitavaju TEK kad se tab otvori (mogu biti brojni) i namjerno
    // NE prate filter perioda iznad — profil ima smisla samo nad cijelom istorijom.
    useEffect(() => {
        let alive = true;
        (async () => {
            if (!organizationId) { setLoading(false); return; }
            setLoading(true);
            try {
                const snaps = await getProductionSnapshots(organizationId);
                if (alive) setSnapshots(snaps);
            } finally {
                if (alive) setLoading(false);
            }
        })();
        return () => { alive = false; };
    }, [organizationId]);

    const affinity = useMemo(() => buildWorkerAffinity(snapshots || []), [snapshots]);
    const types = useMemo(() => buildTypeProfiles(snapshots || []), [snapshots]);
    const flow = useMemo(() => buildFlowSummary(snapshots || []), [snapshots]);

    if (loading) {
        return <div className="ana-center"><Loader2 size={20} className="ana-spin" /> Učitavanje profila…</div>;
    }

    const v3Count = (snapshots || []).filter(s => (s.Snapshot_Version || 1) >= 3).length;
    if (v3Count === 0) {
        return (
            <div className="ana-center">
                Nema v3 snapshota. Otvori <strong>Postavke → Podaci i spremnost</strong> i pokreni
                „Regeneriši snapshote".
            </div>
        );
    }

    return (
        <div className="ana-section pf">
            {affinity.skippedLegacy > 0 && (
                <div className="pf-warn">
                    <AlertTriangle size={15} />
                    <span>
                        {affinity.skippedLegacy} starih (v2) snapshota je preskočeno — nemaju ispravne
                        radnik-dane. Regeneriši ih u Postavkama da uđu u profile.
                    </span>
                </div>
            )}

            <div className="ana-seg pf-seg">
                {([['workers', 'Radnici'], ['types', 'Tipovi proizvoda'], ['flow', 'Tok procesa']] as [View, string][])
                    .map(([id, label]) => (
                        <button key={id} className={view === id ? 'on' : ''} onClick={() => setView(id)}>{label}</button>
                    ))}
            </div>

            {/* ── RADNICI ─────────────────────────────────────────── */}
            {view === 'workers' && (
                affinity.profiles.length === 0
                    ? <div className="ana-center">Nema zabilježenog rada u snapshotima.</div>
                    : (
                        <div className="pf-cards">
                            {affinity.profiles.map(p => (
                                <div className="pf-card" key={p.Worker_ID}>
                                    <div className="pf-card-head">
                                        <strong>{p.Worker_Name}</strong>
                                        <span className="pf-muted">
                                            {d1(p.totalWorkerDays)} radnik-dana · {p.orders} naloga
                                        </span>
                                    </div>

                                    <div className="pf-kpis">
                                        {p.montazaShare !== null && p.montazaShare > 0 && (
                                            <div className="pf-kpi">
                                                <span className="pf-kpi-val">{Math.round(p.montazaShare * 100)}%</span>
                                                <span className="pf-kpi-lbl">dana na montaži</span>
                                            </div>
                                        )}
                                        {p.speedIndex && (
                                            <div className="pf-kpi">
                                                <span className="pf-kpi-val">{d1(p.speedIndex.p50)}×</span>
                                                <span className="pf-kpi-lbl">
                                                    stvarno / planirano (n={p.speedIndex.n})
                                                </span>
                                            </div>
                                        )}
                                    </div>

                                    {p.byProductType.length > 0 && (
                                        <div className="pf-block">
                                            <h5>Vrste proizvoda</h5>
                                            {p.byProductType.slice(0, 5).map(r => (
                                                <div className="ana-rowbar" key={r.key}>
                                                    <span className="ana-rowbar-label">
                                                        {productLabel.get(r.key) || r.key}
                                                    </span>
                                                    <Bar pct={r.sharePct} />
                                                    <span className="ana-rowbar-val">
                                                        {r.sharePct}% <span className="pf-muted">n={r.orders}</span>
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {p.byProcess.length > 0 && (
                                        <div className="pf-block">
                                            <h5>Procesi</h5>
                                            {p.byProcess.slice(0, 5).map(r => (
                                                <div className="ana-rowbar" key={r.key}>
                                                    <span className="ana-rowbar-label">{r.key}</span>
                                                    <Bar pct={r.sharePct} />
                                                    <span className="ana-rowbar-val">
                                                        {r.sharePct}% <span className="pf-muted">n={r.orders}</span>
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {p.byMaterialType.length > 0 && (
                                        <div className="pf-block">
                                            <h5>Materijali</h5>
                                            <div className="pf-chips">
                                                {p.byMaterialType.slice(0, 6).map(r => (
                                                    <span className="pf-chip" key={r.key}>
                                                        {materialLabel.get(r.key) || r.key}
                                                        <em>{r.sharePct}%</em>
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {p.pairedWith.length > 0 && (
                                        <p className="pf-note">
                                            Najčešće radi s: {p.pairedWith.slice(0, 3)
                                                .map(x => `${x.Worker_Name} (${d1(x.sharedDays)} d)`).join(', ')}
                                        </p>
                                    )}
                                </div>
                            ))}
                        </div>
                    )
            )}

            {/* ── TIPOVI PROIZVODA ────────────────────────────────── */}
            {view === 'types' && (
                types.profiles.length === 0
                    ? <div className="ana-center">Nijedan nalog još nije klasifikovan u tip.</div>
                    : (
                        <table className="ana-table">
                            <thead>
                                <tr>
                                    <th>Tip</th>
                                    <th>Uzorak</th>
                                    <th>Radnik-dana po komadu</th>
                                    <th>Stvarno / planirano</th>
                                    <th>Predvidivost</th>
                                    <th>Tipični procesi</th>
                                </tr>
                            </thead>
                            <tbody>
                                {types.profiles.map(t => (
                                    <tr key={t.type}>
                                        <td><strong>{productLabel.get(t.type) || t.type}</strong></td>
                                        <td>{t.n} stavki<span className="pf-muted"> / {t.orders} naloga</span></td>
                                        <td><Range dist={t.workerDaysPerUnit} unit="d" /></td>
                                        <td>
                                            {t.plannedVsActual
                                                ? <span className={t.plannedVsActual.p50 > 1.15 ? 'red' : ''}>
                                                    {d1(t.plannedVsActual.p50)}× <span className="pf-muted">n={t.plannedVsActual.n}</span>
                                                </span>
                                                : <span className="pf-muted">nema plana</span>}
                                        </td>
                                        <td>
                                            {t.predictability === null
                                                ? <span className="pf-muted">—</span>
                                                : <span className={t.predictability > 0.5 ? 'red' : 'green'}>
                                                    ±{Math.round(t.predictability * 100)}%
                                                </span>}
                                        </td>
                                        <td className="pf-muted">
                                            {t.topProcesses.slice(0, 3).map(p => p.name).join(', ') || '—'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )
            )}

            {/* ── TOK PROCESA ─────────────────────────────────────── */}
            {view === 'flow' && (
                <>
                    <div className="pf-kpis pf-kpis-wide">
                        <div className="pf-kpi">
                            <span className="pf-kpi-val">
                                {flow.flowEfficiency ? `${Math.round(flow.flowEfficiency.p50 * 100)}%` : '—'}
                            </span>
                            <span className="pf-kpi-lbl">
                                udio dana u kojima se stvarno radilo
                                {flow.flowEfficiency && <> (n={flow.flowEfficiency.n})</>}
                            </span>
                        </div>
                        <div className="pf-kpi">
                            <span className="pf-kpi-val">{flow.leadDays ? `${d1(flow.leadDays.p50)} d` : '—'}</span>
                            <span className="pf-kpi-lbl">medijan proteklog vremena naloga</span>
                        </div>
                        <div className="pf-kpi">
                            <span className="pf-kpi-val">{flow.touchDays ? `${d1(flow.touchDays.p50)} d` : '—'}</span>
                            <span className="pf-kpi-lbl">medijan stvarnog rada (radnik-dani)</span>
                        </div>
                    </div>

                    <div className="pf-block">
                        <h5>Gdje se najviše čeka</h5>
                        <p className="pf-note">
                            Usko grlo nije proces koji najduže traje, nego onaj ispred kojeg se najviše čeka.
                        </p>
                        {flow.bottlenecks.length === 0
                            ? <div className="pf-muted">Nema zabilježenog čekanja između procesa.</div>
                            : (
                                <table className="ana-table">
                                    <thead>
                                        <tr>
                                            <th>Prelaz</th>
                                            <th>Čekanje (medijan)</th>
                                            <th>Ukupno izgubljeno</th>
                                            <th>Pojava</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {flow.bottlenecks.map(t => (
                                            <tr key={`${t.from}→${t.to}`}>
                                                <td>{t.from} → {t.to}</td>
                                                <td>
                                                    {d1(t.waitDays.p50)} d
                                                    <span className="pf-muted"> ({d1(t.waitDays.p25)}–{d1(t.waitDays.p75)})</span>
                                                </td>
                                                <td><strong>{d1(t.totalWaitDays)} d</strong></td>
                                                <td>{t.n}×</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                    </div>

                    {flow.undocumented.length > 0 && (
                        <div className="pf-block">
                            <h5>Tok koji graf ne poznaje</h5>
                            <p className="pf-note">
                                Ovi redoslijedi se stvarno dešavaju, ali ih graf procesa nema.
                                Ili je graf zastario, ili se u pogonu improvizuje — oboje vrijedi znati.
                            </p>
                            <div className="pf-chips">
                                {flow.undocumented.slice(0, 12).map(t => (
                                    <span className="pf-chip" key={`${t.from}→${t.to}`}>
                                        {t.from} → {t.to}<em>{t.n}×</em>
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
