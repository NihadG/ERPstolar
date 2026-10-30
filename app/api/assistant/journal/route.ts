// ════════════════════════════════════════════════════════════════════
// GET /api/assistant/journal → { markdown, updatedAt }
//
// Dnevnik unapređenja bota (docs/bot/dnevnik-unapredjenja.md) — izvor je u
// repou (dopunjava ga /bot-revizija), ERP ga samo prikazuje. Fajl ulazi u
// build preko outputFileTracingIncludes u next.config.js.
// ════════════════════════════════════════════════════════════════════

import { promises as fs } from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import { errorResponse, requireStaff } from '@/lib/server/requireUser';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const JOURNAL_PATH = path.join('docs', 'bot', 'dnevnik-unapredjenja.md');

export async function GET(req: Request) {
    try {
        await requireStaff(req);
        const file = path.join(process.cwd(), JOURNAL_PATH);
        const [markdown, stat] = await Promise.all([fs.readFile(file, 'utf8'), fs.stat(file)]);
        return NextResponse.json({ markdown, updatedAt: stat.mtime.toISOString() }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (e) {
        if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') return NextResponse.json({ markdown: '', updatedAt: null });
        return errorResponse(e);
    }
}
