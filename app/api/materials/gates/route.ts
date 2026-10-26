// ════════════════════════════════════════════════════════════════════
// KAPIJE MATERIJALA IZ ERP-a (nalog → Materijal)
//
//   POST { action: 'here', materialIds }                     → „tu je"
//   POST { action: 'order', materialIds, projectIds, name }  → nacrti narudžbi
//
// Isti upisi kao dugmad u Telegramu (lib/assistant/materialAlerts): materijal
// iz poslane narudžbe se prima kroz narudžbu, ostalo postaje „Na stanju".
// Firma se uzima iz tokena; tuđi ID-jevi se ne nađu (upit je po firmi).
// ════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { draftOrdersFor, markMaterialsHere } from '@/lib/assistant/materialAlerts';
import { errorResponse, requireStaff } from '@/lib/server/requireUser';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ids = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length < 200).slice(0, 300) : [];

export async function POST(req: Request) {
    try {
        const caller = await requireStaff(req);
        const body = await req.json().catch(() => ({})) as Record<string, unknown>;
        const materialIds = ids(body.materialIds);
        if (!materialIds.length) return NextResponse.json({ error: 'Nema materijala.' }, { status: 400 });

        if (body.action === 'here') {
            const count = await markMaterialsHere(caller.orgId, materialIds);
            return NextResponse.json({ ok: true, count });
        }
        if (body.action === 'order') {
            const projectIds = ids(body.projectIds);
            if (!projectIds.length) return NextResponse.json({ error: 'Nema projekta.' }, { status: 400 });
            const name = typeof body.name === 'string' ? body.name.slice(0, 120) : '';
            const orders = await draftOrdersFor(caller.orgId, projectIds, materialIds, name, 'Kreirano iz naloga → Materijal.');
            return NextResponse.json({ ok: true, orders });
        }
        return NextResponse.json({ error: 'Nepoznata radnja.' }, { status: 400 });
    } catch (e) {
        return errorResponse(e);
    }
}
