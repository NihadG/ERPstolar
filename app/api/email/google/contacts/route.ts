// ════════════════════════════════════════════════════════════════════
// GET /api/email/google/contacts → { candidates, scanned }
//
// Prijedlog kontakata iz poslane pošte (zadnjih 6 mjeseci, do 250 mailova):
// samo zaglavlja Kome/Kopija i početak teksta. Ništa se ne upisuje —
// korisnik štiklira u Postavkama → Kontakti.
// ════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/server/firebaseAdmin';
import { errorResponse, requireStaff } from '@/lib/server/requireUser';
import { getEmailAccount, getMessageMeta, GmailError, gmailErrorJson, listMessageIds, mapLimit } from '@/lib/server/gmail';
import { gmailContactCandidates } from '@/lib/email/gmailContacts';
import { COLLECTIONS } from '@/lib/services/shared/collections';
import type { Contact, Supplier } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
    try {
        const caller = await requireStaff(req);
        const account = await getEmailAccount(caller.uid);
        if (!account || account.Organization_ID !== caller.orgId) throw new GmailError('not-connected', 'Gmail nije povezan.');

        const ids = await listMessageIds(caller.uid, 'in:sent newer_than:180d', 250);
        const metas = await mapLimit(ids, 8, id => getMessageMeta(caller.uid, id, ['To', 'Cc']));
        const messages = metas.map(m => ({
            to: m.headers.to || '',
            cc: m.headers.cc || '',
            snippet: m.snippet,
            date: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : '',
        }));

        const db = adminDb();
        const [contactsSnap, suppliersSnap] = await Promise.all([
            db.collection(COLLECTIONS.CONTACTS).where('Organization_ID', '==', caller.orgId).get(),
            db.collection(COLLECTIONS.SUPPLIERS).where('Organization_ID', '==', caller.orgId).get(),
        ]);
        const candidates = gmailContactCandidates(messages, {
            own: [account.Email, account.Send_As || '', caller.email || ''].filter(Boolean),
            contacts: contactsSnap.docs.map(d => d.data() as Contact),
            suppliers: suppliersSnap.docs.map(d => d.data() as Supplier),
        });
        return NextResponse.json({ candidates, scanned: messages.length }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (e) {
        if (e instanceof GmailError) { const r = gmailErrorJson(e); return NextResponse.json(r.body, { status: r.status }); }
        return errorResponse(e);
    }
}
