// Greške pošte → HTTP odgovor (poruka na bosanskom + stabilan `code`).

import { NextResponse } from 'next/server';
import { errorResponse } from './requireUser';
import { GmailError, gmailErrorJson } from './gmail';
import { DraftError } from './emailDrafts';

export function emailErrorResponse(e: unknown): NextResponse {
    if (e instanceof GmailError) {
        const r = gmailErrorJson(e);
        return NextResponse.json(r.body, { status: r.status });
    }
    if (e instanceof DraftError) return NextResponse.json({ error: e.message }, { status: e.status });
    return errorResponse(e);
}
