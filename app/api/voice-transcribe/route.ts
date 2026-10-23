import { NextRequest, NextResponse } from 'next/server';
import { transcribeAudio } from '@/lib/voice/transcribeServer';
import { errorResponse, requireUserOrDevPreview } from '@/lib/server/requireUser';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
    try {
        // Transkripcija troši plaćeni OpenAI ključ — samo za prijavljene.
        await requireUserOrDevPreview(request);
    } catch (e) {
        return errorResponse(e);
    }

    try {
        const formData = await request.formData();
        const audioFile = formData.get('audio');
        const contextHint = formData.get('contextHint');

        if (!audioFile || typeof audioFile === 'string') {
            return NextResponse.json({ error: 'Snimak nije poslan.' }, { status: 400 });
        }

        let names: string[] = [];
        if (typeof contextHint === 'string' && contextHint.trim()) {
            try {
                const parsed = JSON.parse(contextHint);
                if (Array.isArray(parsed)) names = parsed.filter((n): n is string => typeof n === 'string');
            } catch {
                names = contextHint.split(',');
            }
        }

        const result = await transcribeAudio({
            buffer: Buffer.from(await audioFile.arrayBuffer()),
            mime: audioFile.type || 'audio/webm',
            names,
        });
        if (!result.ok) {
            return NextResponse.json(
                { error: result.error, ...(result.code ? { code: result.code } : {}) },
                { status: result.status },
            );
        }
        return NextResponse.json({ text: result.text });
    } catch (error) {
        console.error('Transcription error:', error);
        return NextResponse.json({ error: 'Greška pri transkripciji.' }, { status: 500 });
    }
}
