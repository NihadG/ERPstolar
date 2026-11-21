'use client';

// ════════════════════════════════════════════════════════════════════
// /canvas-preview — PRAVO Platno (CanvasTab) s demo planom, bez prijave.
//
// Aplikacija je iza prijave, pa se Platno ne može vidjeti bez naloga. Ova ruta
// renderuje ISTU komponentu s izmišljenim podacima (lib/canvas/demoPlan.ts):
// ništa se ne učitava iz baze, a autosave ne piše (nema organizacije).
//
// Renderuje se u ISTIM uslovima kao aplikacija: lažni sidebar iste širine i
// z-indexa, sadržaj s istim razmakom kao `.content-area--wide`.
//   ?sidebar=280         raširen meni (laptop s otvorenim menijem)
//   ?prikaz=ekipe|nalozi  početni prikaz (zadano: projekti)
//   ?zum=dan|mjesec       početni zum (zadano: sedmica)
//   ?od=2026-11-19        lijeva ivica ose
//
// U produkciji ruta ne postoji.
// ════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import { notFound } from 'next/navigation';
import CanvasTab from '@/components/canvas/CanvasTab';
import type { PlanLayout, PlanZoom } from '@/lib/types';
import {
    demoCanvasScenario, demoCanvasWorkers, demoCanvasProjects, demoCanvasWorkOrders, demoCanvasAttendance,
} from '@/lib/canvas/demoPlan';

export const dynamic = 'force-dynamic';

const LAYOUT: Record<string, PlanLayout> = { projekti: 'unified-project', ekipe: 'crews', nalozi: 'rows' };

export default function CanvasPreviewPage() {
    const [cfg, setCfg] = useState<{ sidebar: number; layout: PlanLayout; zoom: PlanZoom; anchor?: string } | null>(null);
    const [toast, setToast] = useState('');

    // Parametri se čitaju tek na klijentu — inače bi se server i klijent razišli.
    useEffect(() => {
        const q = new URLSearchParams(location.search);
        const zoom = q.get('zum');
        setCfg({
            sidebar: Number(q.get('sidebar')) || 72,
            layout: LAYOUT[q.get('prikaz') || ''] || 'unified-project',
            zoom: zoom === 'dan' || zoom === 'mjesec' ? zoom : 'sedmica',
            anchor: q.get('od') || undefined,
        });
    }, []);

    if (process.env.NODE_ENV === 'production') notFound();
    if (!cfg) return null;

    return (
        <>
            {/* Na mjestu pravog sidebara (fixed, z-index 1000; 72 px skupljen, 280 px raširen). */}
            <div
                aria-hidden
                style={{
                    position: 'fixed', inset: '0 auto 0 0', width: cfg.sidebar, zIndex: 1000,
                    background: 'linear-gradient(180deg,#f5f5f7,#ececef)', borderRight: '1px solid #d2d2d7',
                }}
            />
            {toast && (
                <div style={{
                    position: 'fixed', bottom: 18, left: '50%', transform: 'translateX(-50%)', zIndex: 3000,
                    background: '#1d1d1f', color: '#fff', padding: '9px 16px', borderRadius: 10, fontSize: 13,
                }}>
                    {toast}
                </div>
            )}
            {/* Isto kao .main-content-wrapper + .content-area--wide u app/page.tsx */}
            <div style={{ marginLeft: cfg.sidebar, minWidth: 0, background: 'var(--surface)', minHeight: '100dvh' }}>
                <main style={{ padding: '24px 20px', boxSizing: 'border-box', width: '100%' }}>
                    <CanvasTab
                        projects={demoCanvasProjects}
                        workers={demoCanvasWorkers}
                        workOrders={demoCanvasWorkOrders}
                        orders={[]}
                        suppliers={[]}
                        showToast={msg => { setToast(msg); setTimeout(() => setToast(''), 2500); }}
                        preview={{
                            scenario: demoCanvasScenario({
                                layout: cfg.layout, zoom: cfg.zoom, ...(cfg.anchor ? { anchorISO: cfg.anchor } : {}),
                            }),
                            attendance: demoCanvasAttendance,
                        }}
                    />
                </main>
            </div>
        </>
    );
}
