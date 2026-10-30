'use client';

// ════════════════════════════════════════════════════════════════════
// /email-draft-preview — PRAVI modal „Pošalji emailom" nad izmišljenom narudžbom
//
// API je zamijenjen lažnim (ništa ne ide na server ni u Gmail). Stanja:
//   ?case=contact   glavni kontakt dobavljača (zadano)
//   ?case=choose    više ljudi, nijedan ★ — izbor primaoca
//   ?case=none      dobavljač bez ijedne adrese
//   ?case=gmail     Gmail nije povezan
//   ?case=typo      tipfeler u adresi (upozorenje + Ispravi)
// U produkciji ruta ne postoji.
// ════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import { notFound } from 'next/navigation';
import EmailDraftModal, { type DraftViewResponse, type EmailDraftApi, type SendResponse } from '@/components/email/EmailDraftModal';
import { ApiError } from '@/lib/apiClient';
import type { EmailDraft } from '@/lib/types';

export const dynamic = 'force-dynamic';

const BODY_TI = 'Pozdrav Amra,\n\nU prilogu možeš pronaći narudžbu N2026-10/07. Javi mi rok isporuke kad budeš znao.\n\nSrdačno,\n\nIme Prezime\n061 000 000';
const BODY_VI = 'Poštovani,\n\nU prilogu Vam dostavljamo narudžbu N2026-10/07. Molimo potvrdu i rok isporuke.\n\nSrdačno,\n\nIme Prezime\n061 000 000';

const CONTACTS = [
    { name: 'Amra Delić', email: 'amra.delic@staklo-demo.example', company: 'Staklo Demo' },
    { name: 'Mirza Avdić', email: 'mirza.avdic@staklo-demo.example', company: 'Staklo Demo' },
    { name: 'Ured', email: 'ured@luxco-demo.example', company: 'LUX CO' },
    { name: 'Emir Hadžić', email: 'emir.hadzic@ploce-demo.example', company: 'Ploče Demo' },
];

function draftFor(kind: string): DraftViewResponse {
    const base: EmailDraft = {
        Draft_ID: 'd1', Organization_ID: 'demo', Owner_UID: 'u', Purpose: 'order', Entity_ID: 'o1',
        To: [{ name: 'Amra Delić', email: 'amra.delic@staklo-demo.example' }],
        Cc: [{ name: 'Ured', email: 'ured@luxco-demo.example' }],
        Subject: 'Narudžba ogledala Park Plaza LUXCO', Body: BODY_TI,
        Attachments: [{ kind: 'order', id: 'o1', filename: 'Narudžba ogledala Park Plaza LUXCO.pdf' }],
        Status: 'draft', Source: 'app', Created_At: '', Updated_At: '',
    };
    if (kind === 'choose') {
        return { draft: { ...base, To: [], Body: BODY_VI, Candidates: CONTACTS.slice(0, 2) }, contacts: CONTACTS, recipient: 'choose', orderStatus: 'Nacrt' };
    }
    if (kind === 'none') {
        return { draft: { ...base, To: [], Body: BODY_VI }, contacts: CONTACTS, recipient: 'none', orderStatus: 'Nacrt' };
    }
    if (kind === 'typo') {
        const typo = 'info@staklo-dmeo.example';
        return {
            draft: { ...base, To: [{ email: typo }], Body: BODY_VI, Warnings: [{ email: typo, suggestion: 'info@staklo-demo.example' }] },
            contacts: CONTACTS, recipient: 'requested', orderStatus: 'Nacrt',
        };
    }
    return { draft: base, contacts: CONTACTS, recipient: 'contact', orderStatus: 'Nacrt' };
}

export default function EmailDraftPreview() {
    if (process.env.NODE_ENV === 'production') notFound();
    const [kind, setKind] = useState('contact');
    const [open, setOpen] = useState(false);
    const [log, setLog] = useState<string[]>([]);

    useEffect(() => {
        setKind(new URLSearchParams(window.location.search).get('case') || 'contact');
        setOpen(true);
    }, []);

    const api: EmailDraftApi = {
        create: async () => {
            await new Promise(r => setTimeout(r, 300));
            if (kind === 'gmail') throw new ApiError(409, 'Gmail nije povezan — poveži ga u Postavke → Kontakti.');
            return draftFor(kind);
        },
        update: async (_id, patch) => { setLog(l => [...l, `izmjena: ${JSON.stringify(patch)}`]); return {}; },
        send: async (): Promise<SendResponse> => {
            await new Promise(r => setTimeout(r, 500));
            return { threadId: 't1', to: ['amra.delic@staklo-demo.example'], orderSent: true, orderNumber: 'N2026-10/07' };
        },
        cancel: async () => { setLog(l => [...l, 'otkazano']); return {}; },
    };

    return (
        <div style={{ background: 'var(--surface)', minHeight: '100vh', padding: 28 }}>
            <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>Pošalji emailom</button>
            <pre id="ed-log" style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>{log.join('\n')}</pre>
            <EmailDraftModal
                isOpen={open}
                orderId="o1"
                api={api}
                onClose={() => setOpen(false)}
                onSent={res => { setOpen(false); setLog(l => [...l, `poslano: ${res.to.join(', ')} · Poslano=${res.orderSent}`]); }}
            />
        </div>
    );
}
