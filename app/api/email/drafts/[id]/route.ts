// ════════════════════════════════════════════════════════════════════
// /api/email/drafts/[id] — nacrt prijavljenog korisnika
//
//   PATCH  { To?, Cc?, Subject?, Body? }   izmjena prije slanja
//   DELETE                                   otkaži nacrt
// ════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/server/requireUser';
import { cancelDraft, updateDraft } from '@/lib/server/emailDrafts';
import { emailErrorResponse } from '@/lib/server/emailHttp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
    try {
        const caller = await requireStaff(req);
        const body = await req.json().catch(() => ({})) as Record<string, unknown>;
        const draft = await updateDraft(caller.orgId, caller.uid, params.id, body);
        return NextResponse.json({ draft });
    } catch (e) {
        return emailErrorResponse(e);
    }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
    try {
        const caller = await requireStaff(req);
        await cancelDraft(caller.orgId, caller.uid, params.id);
        return NextResponse.json({ ok: true });
    } catch (e) {
        return emailErrorResponse(e);
    }
}
