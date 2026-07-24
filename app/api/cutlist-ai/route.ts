import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

// ════════════════════════════════════════════════════════════════════
// AI ZA KROJNE LISTE — server-side Gemini (isti obrazac kao ai-import)
//
// API ključ postoji SAMO na serveru (.env.local bez NEXT_PUBLIC_), pa
// klijentski lib/cutlist/ai.ts zove ovu rutu umjesto Gemini SDK-a.
//
// Dvije akcije:
//  - multipart/form-data s `file`  → PARSE: izvuci komade iz XLSX/PDF/slike
//  - application/json {labels, catalog} → MATCH: spari nazive materijala
// ════════════════════════════════════════════════════════════════════

const MODEL = 'gemini-2.5-flash';
const TIMEOUT_MS = 120000;

function getModel() {
    const apiKey = process.env.GEMINI_API_KEY
        || process.env.GOOGLE_GEMINI_API_KEY
        || process.env.NEXT_PUBLIC_GEMINI_API_KEY;
    if (!apiKey) return null;
    return new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: MODEL });
}

function extractJson(text: string): unknown | null {
    let jsonText = text;
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) jsonText = fenced[1];
    else {
        const raw = text.match(/\{[\s\S]*\}/);
        if (raw) jsonText = raw[0];
    }
    try {
        return JSON.parse(jsonText);
    } catch {
        return null;
    }
}

const PARSE_PROMPT = `Ti si asistent stolarske radionice. U priloženom dokumentu je KROJNA LISTA
(lista komada za rezanje ploča). Izvuci SVE komade.

Za svaki komad vrati:
- "name": naziv/oznaka komada (ako nema, izostavi)
- "width": dimenzija u mm (dužina komada, broj)
- "height": dimenzija u mm (širina komada, broj)
- "qty": količina (cijeli broj, default 1)
- "material": naziv materijala/dekora TAČNO kako piše u dokumentu (npr. "Iveral bijeli", "MDF", "Egger U999"); ako dokument nema materijal, izostavi
- "thickness": debljina ploče u mm ako je navedena (broj)
- "edge_l": broj kantiranih ivica po dužini (0-2) ako je navedeno
- "edge_w": broj kantiranih ivica po širini (0-2) ako je navedeno

PRAVILA:
1. Dimenzije su u milimetrima; ako su u cm, pomnoži sa 10.
2. Evropski zapis broja (1.200,5) čitaj ispravno.
3. Vrati SAMO validan JSON: {"rows":[{...}],"warnings":["..."]}
4. Ne izmišljaj komade — samo ono što stvarno piše.`;

async function handleParse(file: File) {
    const model = getModel();
    if (!model) {
        return NextResponse.json({ success: false, error: 'AI ključ nije konfigurisan na serveru' }, { status: 500 });
    }

    const buffer = await file.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    const mimeType = file.type || 'application/octet-stream';

    const result = await Promise.race([
        model.generateContent([PARSE_PROMPT, { inlineData: { mimeType, data: base64 } }]),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('AI analiza istekla')), TIMEOUT_MS)),
    ]);

    const parsed = extractJson(result.response.text()) as { rows?: unknown[]; warnings?: unknown[] } | null;
    if (!parsed || !Array.isArray(parsed.rows)) {
        return NextResponse.json({ success: false, error: 'AI nije vratio validnu krojnu listu' }, { status: 500 });
    }
    return NextResponse.json({
        success: true,
        rows: parsed.rows,
        warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
    });
}

async function handleMatch(labels: string[], catalog: { id: string; name: string; category: string }[]) {
    const model = getModel();
    if (!model) {
        return NextResponse.json({ success: false, error: 'AI ključ nije konfigurisan na serveru' }, { status: 500 });
    }

    const prompt = `Ti si asistent stolarske radionice. Spari nazive materijala iz krojne
liste s katalogom materijala firme.

NAZIVI IZ DOKUMENTA:
${labels.map((l, i) => `${i + 1}. "${l}"`).join('\n')}

KATALOG (id | naziv | kategorija):
${catalog.map(c => `${c.id} | ${c.name} | ${c.category}`).join('\n')}

Za svaki naziv iz dokumenta nađi materijal iz kataloga koji označava ISTU
ploču (isti dekor/vrsta; debljina se mora slagati ako je navedena u oba).
Sinonimi: iveral=iverica=oplemenjena iverica; medijapan=MDF; lesonit=HDF.
Ako u katalogu NEMA odgovarajućeg materijala, vrati null — NE spajaj
različite dekore ili debljine na silu.

Vrati SAMO JSON: {"matches": {"<naziv iz dokumenta>": "<id ili null>", ...}}`;

    const result = await Promise.race([
        model.generateContent(prompt),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('AI sparivanje isteklo')), TIMEOUT_MS)),
    ]);

    const parsed = extractJson(result.response.text()) as { matches?: Record<string, unknown> } | null;
    if (!parsed || typeof parsed.matches !== 'object' || !parsed.matches) {
        return NextResponse.json({ success: false, error: 'AI nije vratio validno sparivanje' }, { status: 500 });
    }
    return NextResponse.json({ success: true, matches: parsed.matches });
}

export async function POST(request: NextRequest) {
    try {
        const contentType = request.headers.get('content-type') || '';

        if (contentType.includes('multipart/form-data')) {
            const formData = await request.formData();
            const file = formData.get('file') as File | null;
            if (!file) {
                return NextResponse.json({ success: false, error: 'Fajl je obavezan' }, { status: 400 });
            }
            return await handleParse(file);
        }

        const body = await request.json();
        if (Array.isArray(body?.labels) && Array.isArray(body?.catalog)) {
            return await handleMatch(body.labels, body.catalog);
        }
        return NextResponse.json({ success: false, error: 'Neispravan zahtjev' }, { status: 400 });
    } catch (error) {
        console.error('[Cutlist-AI] error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Interna greška servera' },
            { status: 500 },
        );
    }
}
