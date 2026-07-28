// ════════════════════════════════════════════════════════════════════
// SKIDANJE ZASTAVICE „mora promijeniti lozinku"
//
// Samu promjenu radi KLIJENT (firebase/auth `updatePassword`), namjerno — taj
// put traži svježu prijavu ili reautentikaciju starom lozinkom. Da smo lozinku
// mijenjali admin SDK-om na osnovu tokena, ukradena sesija bi mogla preuzeti
// nalog bez poznavanja stare lozinke.
//
// Ova ruta samo bilježi da je promjena obavljena. Ne prima lozinku.
// ════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/server/firebaseAdmin';
import { errorResponse, requireUser } from '@/lib/server/requireUser';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
    try {
        const caller = await requireUser(req);
        await adminDb().collection('users').doc(caller.uid).update({ Must_Change_Password: false });
        return NextResponse.json({ ok: true });
    } catch (e) {
        return errorResponse(e);
    }
}
