'use client';

// ════════════════════════════════════════════════════════════════════
// /process-rules-preview — PRAVI prozor „Proizvodni procesi" bez prijave
//
// Bez sesije Firebase čitanja vrate prazno, pa se vidi prazan katalog — dovoljno
// za izgled buildera („osim ako ima", tok pravila) i panela „Standardna pravila".
// Ne pritiskati „Primijeni": piše u pravu bazu.
//
// U produkciji ruta ne postoji.
// ════════════════════════════════════════════════════════════════════

import { notFound } from 'next/navigation';
import ProcessCatalogModal from '@/components/ui/ProcessCatalogModal';

export const dynamic = 'force-dynamic';

export default function ProcessRulesPreviewPage() {
    if (process.env.NODE_ENV === 'production') notFound();
    return (
        <main style={{ minHeight: '100vh', background: 'var(--background)' }}>
            <ProcessCatalogModal organizationId="preview-org" onClose={() => undefined} showToast={(m) => console.log('[toast]', m)} />
        </main>
    );
}
