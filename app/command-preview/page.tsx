'use client';

// ════════════════════════════════════════════════════════════════════
// /command-preview — MAKETA Komandnog centra
//
// Aplikacija je iza prijave, pa se izgled ne može provjeriti bez naloga.
// Ova ruta renderuje ISTI ekran s izmišljenim podacima, bez baze i bez
// prijave, da se dizajn može vidjeti i doraditi prije spajanja.
//
// VAŽNO: renderuje se kao PRAVI overlay (ne „embedded"), uz lažni sidebar
// iste širine i z-indexa kao u aplikaciji. Ranija maketa je renderovala u
// toku strane, pa nije mogla otkriti dvije stvarne greške: da se ploče
// sažmu u flex-koloni ograničene visine i da sidebar odsijeca lijevu ivicu.
//
// U produkciji ruta ne postoji.
// ════════════════════════════════════════════════════════════════════

import { useState } from 'react';
import { notFound } from 'next/navigation';
import CommandCenterScreen from '@/components/ui/command/CommandCenterScreen';
import { EMPTY_BOARD, type CommandBoardState } from '@/lib/command/board';
import {
    demoBoardIds, demoOrders, demoPlanScenarios, demoProjects, demoTasks, demoWorkers, demoWorkOrders,
} from '@/lib/command/demoData';

export const dynamic = 'force-dynamic';

export default function CommandPreviewPage() {
    const [board, setBoard] = useState<CommandBoardState>({ ...EMPTY_BOARD, Project_IDs: demoBoardIds });
    const [toast, setToast] = useState('');

    if (process.env.NODE_ENV === 'production') notFound();

    return (
        <>
            {/* Stoji na mjestu pravog sidebara (fixed, 88px, z-index 1000) —
                jedini način da se u maketi vidi da li ga overlay pokriva. */}
            <div
                aria-hidden
                style={{
                    position: 'fixed', inset: '0 auto 0 0', width: 88, zIndex: 1000,
                    background: 'linear-gradient(180deg,#f5f5f7,#ececef)', borderRight: '1px solid #d2d2d7',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, paddingTop: 18,
                }}
            >
                {['▦', '⌕', '✂', '🗀', '☑', '🛒', '▤'].map((glyph, i) => (
                    <span key={i} style={{ fontSize: 18, opacity: 0.45 }}>{glyph}</span>
                ))}
            </div>

            {toast && (
                <div style={{
                    position: 'fixed', bottom: 18, left: '50%', transform: 'translateX(-50%)', zIndex: 3000,
                    background: '#1d1d1f', color: '#fff', padding: '9px 16px', borderRadius: 10, fontSize: 13,
                }}>
                    {toast}
                </div>
            )}

            <CommandCenterScreen
                dryRun
                projects={demoProjects}
                workOrders={demoWorkOrders}
                orders={demoOrders}
                tasks={demoTasks}
                workers={demoWorkers}
                planScenarios={demoPlanScenarios}
                organizationId="demo"
                board={board}
                onBoardChange={setBoard}
                canCreate
                onClose={() => setToast('Zatvaranje — u aplikaciji vraća na Projekte')}
                onRefresh={() => { /* maketa nema šta osvježiti */ }}
                showToast={message => { setToast(message); setTimeout(() => setToast(''), 2600); }}
            />
        </>
    );
}
