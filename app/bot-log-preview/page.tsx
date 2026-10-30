'use client';

// /bot-log-preview — PRAVI prikaz „Poruke botu" nad primjerima iz 26.10.
// (Postavke su iza prijave.) ?w=380 suzi okvir kao na telefonu. U produkciji ruta ne postoji.

import { useEffect, useState } from 'react';
import { notFound } from 'next/navigation';
import { BotMessagesView, type BotEntry } from '@/components/settings/BotMessagesLog';

export const dynamic = 'force-dynamic';

const E = (id: string, at: string, text: string, outcome: BotEntry['outcome'], extra: Partial<BotEntry> = {}): BotEntry =>
    ({ id, at, kind: 'text', text, from: null, outcome, reply: null, changes: [], attempts: outcome === 'unknown' ? 0 : 1, ...extra });

const entries: BotEntry[] = [
    E('0', '2026-10-30T10:35:00Z', 'Jesu li spremna ogledala iz Stakloreza, ova za Kuću?', 'answer', {
        reply: 'Ne mogu potvrditi da su spremna. U ERP-u nema narudžbe ogledala.', signals: ['read_guard', 'nemam', 'corrected', 'feedback'],
        feedback: [{ at: '2026-10-30T10:37:00Z', kind: 'lose', text: 'trebao si pogledati mail, javili su da je gotovo' }],
    }),
    E('1', '2026-10-27T09:12:00Z', 'Stan e101 fali ogledalo 1350x1000', 'failed', { reply: '⚠️ Ništa nije upisano — poruka nije razvrstana kako treba.', attempts: 1 }),
    E('2', '2026-10-27T09:05:00Z', 'U c604 imam ogledalo 1720x1000, a fali 1000x1350', 'written', { reply: '📒 1 kom Ogledalo 1000x1350 · C604 — fali\n\n📒 1 kom Ogledalo 1720x1000 · C604 — u stanu, nije postavljeno', changes: ['bilješka „Ogledalo 1000x1350"', 'bilješka „Ogledalo 1720x1000"'] }),
    E('3', '2026-10-27T08:40:00Z', 'Šta fali u E302?', 'answer', { reply: 'U E302: ogledalo 1000x1600 i 1000x800, oba nisu postavljena.' }),
    E('4', '2026-10-26T10:17:41Z', 'U stanu 308 imam jedno ogledalo široko 800 milimetara, a nisam postavio jedno ogledalo 1000 puta 1100, jedno ogledalo 800 puta 900 i jedno ogledalo 800 puta 900 i jedan gornji 1100 širine.', 'unknown', { kind: 'voice' }),
    E('5', '2026-10-26T09:56:26Z', 'U e108 pogresno postavljeno ogledalo, treba 1100x1000. I ima u tom stanu ogledalo 1000x800', 'unknown'),
    E('6', '2026-10-26T09:11:43Z', 'C403 fali 1000x1350 ogledalo, a 404 fali 1000x1600', 'written'),
];

const journal = {
    updatedAt: '2026-10-30T12:00:00Z',
    markdown: `# Dnevnik unapređenja bota

Živi spisak onoga što bot treba bolje raditi.

## Moje upute

- Potvrde upisa piše ERP, nikad model.
- Pošta: samo čitanje.

## Otvorene potrebe

| ID | Potreba | Uzrok | Status | PR |
|---|---|---|---|---|
| P-001 | Stanje kod dobavljača iz pošte | integracija | u PR-u | #43 |
| P-005 | Gmail povezan, Kontakti uvezeni | podatak | **čeka tebe** | — |
`,
};

export default function BotLogPreview() {
    if (process.env.NODE_ENV === 'production') notFound();
    const [width, setWidth] = useState<number | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    useEffect(() => {
        const w = Number(new URLSearchParams(window.location.search).get('w'));
        if (w > 0) setWidth(w);
    }, []);
    return (
        <div style={{ minHeight: '100vh', background: 'var(--surface)', padding: 24 }}>
            <div className="settings-card" style={{ maxWidth: width || 760, margin: '0 auto', background: 'var(--background)', padding: 20, borderRadius: 12 }}>
                <BotMessagesView entries={entries} busyId={busy} onReprocess={e => { setBusy(e.id); setTimeout(() => setBusy(null), 1200); }} journal={journal} />
            </div>
        </div>
    );
}
