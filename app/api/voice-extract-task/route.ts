import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI, SchemaType, type ResponseSchema } from '@google/generative-ai';
import { isIsoDate, localToday } from '@/lib/voice/dates';
import {
    buildExtractionPrompt, finalizeExtraction, parseModelJson,
    VOICE_CATEGORIES, VOICE_PRIORITIES, type VoiceContext,
} from '@/lib/voice/extract';

export type { ExtractedTaskData } from '@/lib/voice/extract';

export const runtime = 'nodejs';

// Isti model kao app/api/classify-names. Ključ za Anthropic nije podešen u
// okruženju, pa parsiranje ostaje na Geminiju; tačnost drže kalendar, liste
// s ID-jevima i provjere u lib/voice/extract (ne slijepo povjerenje modelu).
const MODEL = 'gemini-3.1-flash-lite';
const TIMEOUT_MS = 20_000;
const MAX_TEXT = 4000;
const MAX_LIST = 400;

const nullableString = { type: SchemaType.STRING, nullable: true } as const;
const RESPONSE_SCHEMA: ResponseSchema = {
    type: SchemaType.OBJECT,
    properties: {
        title: { type: SchemaType.STRING },
        description: { type: SchemaType.STRING },
        priority: { type: SchemaType.STRING, format: 'enum', enum: [...VOICE_PRIORITIES] },
        category: { type: SchemaType.STRING, format: 'enum', enum: [...VOICE_CATEGORIES] },
        checklist: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
        suggestedDueDate: nullableString,
        suggestedWorker: nullableString,
        suggestedWorkerId: nullableString,
        suggestedProject: nullableString,
        suggestedProjectId: nullableString,
    },
    required: ['title', 'description', 'priority', 'category', 'checklist'],
};

/** Prihvata i stari oblik konteksta (nizovi stringova) da stari klijent ne pukne. */
function sanitizeContext(raw: unknown): VoiceContext {
    const c = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const arr = (v: unknown) => (Array.isArray(v) ? v.slice(0, MAX_LIST) : []);
    const s = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 120) : '');
    return {
        projects: arr(c.projects).map((p, i) => typeof p === 'string'
            ? { id: `p${i}`, client: s(p) }
            : { id: s((p as any)?.id), client: s((p as any)?.client), name: s((p as any)?.name) || undefined, address: s((p as any)?.address) || undefined })
            .filter(p => p.id && p.client),
        workers: arr(c.workers).map((w, i) => typeof w === 'string'
            ? { id: `w${i}`, name: s(w) }
            : { id: s((w as any)?.id), name: s((w as any)?.name) })
            .filter(w => w.id && w.name),
        suppliers: arr(c.suppliers).map(s).filter(Boolean),
    };
}

export async function POST(request: NextRequest) {
    let text = '';
    let today = localToday();
    let context: VoiceContext = {};
    try {
        const body = await request.json();
        text = typeof body?.text === 'string' ? body.text.trim().slice(0, MAX_TEXT) : '';
        // Klijent šalje SVOJ lokalni datum — server (UTC) bi oko ponoći pogriješio dan.
        if (isIsoDate(body?.today)) today = body.today;
        context = sanitizeContext(body?.context);
    } catch {
        return NextResponse.json({ error: 'Neispravan zahtjev' }, { status: 400 });
    }

    if (!text) {
        return NextResponse.json({ error: 'Nema teksta za obradu' }, { status: 400 });
    }

    const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
    if (!apiKey) {
        // Bez modela i dalje vrati upotrebljiv zadatak (naslov/opis + rok iz teksta).
        return NextResponse.json({ ...finalizeExtraction(null, text, today, context), degraded: true });
    }

    try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel(
            {
                model: MODEL,
                generationConfig: {
                    temperature: 0.1,
                    responseMimeType: 'application/json',
                    responseSchema: RESPONSE_SCHEMA,
                },
            },
            { timeout: TIMEOUT_MS },
        );

        const result = await model.generateContent(buildExtractionPrompt(text, today, context));
        const raw = parseModelJson(result.response.text());
        if (!raw) console.error('Voice extract: model nije vratio JSON');

        return NextResponse.json({ ...finalizeExtraction(raw, text, today, context), degraded: !raw });
    } catch (error: any) {
        // Model nedostupan/timeout: korisnik ne gubi diktat — dobije osnovna polja.
        console.error('Voice extract error:', error?.message || error);
        return NextResponse.json({ ...finalizeExtraction(null, text, today, context), degraded: true });
    }
}
