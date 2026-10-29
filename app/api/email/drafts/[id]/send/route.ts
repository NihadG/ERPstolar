// ════════════════════════════════════════════════════════════════════
// POST /api/email/drafts/[id]/send — šalje nacrt preko korisnikovog Gmaila
//
// Poslije uspjeha narudžba iz Nacrta prelazi u Poslano (lib/server/emailDrafts).
// Mail se ne može poništiti; zato je ovo zaseban, izričit klik.
// ════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/server/requireUser';
import { sendDraft } from '@/lib/server/emailDrafts';
import { emailErrorResponse } from '@/lib/server/emailHttp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: { id: string } }) {
    try {
        const caller = await requireStaff(req);
        const result = await sendDraft(caller.orgId, caller.uid, params.id);
        return NextResponse.json(result);
    } catch (e) {
        return emailErrorResponse(e);
    }
}
