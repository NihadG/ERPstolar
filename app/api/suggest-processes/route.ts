import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { validateAiStages } from '@/lib/processAutoPlan';

// AI PRIJEDLOG FAZNIH PLANOVA PROCESA iz naziva proizvoda (za proizvode bez sastavnice).
// Ulaz: { products:[{id,name,materials?}], catalog:string[], template?:{name,stages:string[][]} }
// Izlaz: { success, suggestions:[{id, stages:string[][]}], warnings }
// Vokabular je OGRANIČEN na katalog; sve prolazi kroz validateAiStages (odbacuje halucinacije).

interface ProductIn { id: string; name: string; materials?: string[] }

export async function POST(request: NextRequest) {
    try {
        const body = await request.json().catch(() => null) as
            | { products?: ProductIn[]; catalog?: string[]; template?: { name?: string; stages?: string[][] } }
            | null;
        const products = (body?.products || []).filter(p => p && p.id && (p.name || '').trim());
        const catalog = (body?.catalog || []).filter(Boolean);
        if (!products.length) return NextResponse.json({ success: false, error: 'Nema proizvoda' }, { status: 400 });
        if (!catalog.length) return NextResponse.json({ success: false, error: 'Katalog procesa je prazan' }, { status: 400 });

        const apiKey = process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY;
        if (!apiKey) return NextResponse.json({ success: false, error: 'API ključ nije konfigurisan' }, { status: 500 });

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

        const templateBlock = body?.template?.stages?.length
            ? `\nREFERENTNI TOK (šablon "${body.template.name || ''}") — faze (svaka faza = niz paralelnih procesa):\n${JSON.stringify(body.template.stages)}\n`
            : '';
        const prompt = `Ti si inženjer proizvodnje namještaja po mjeri. Za svaki proizvod predloži FAZNI plan procesa.
Procesi u ISTOJ fazi teku PARALELNO; sljedeća faza čeka prethodnu.

DOZVOLJENI PROCESI (koristi ISKLJUČIVO ove nazive, doslovno):
${catalog.map(c => `- ${c}`).join('\n')}
${templateBlock}
PROIZVODI (zaključi tip iz naziva i materijala):
${products.map(p => `- id="${p.id}" naziv="${p.name}"${p.materials?.length ? ` materijali: ${p.materials.join(', ')}` : ''}`).join('\n')}

PRAVILA:
1. Vraćaj SAMO validan JSON, bez markdown.
2. "stages" je niz nizova naziva procesa (svaka faza = niz). Koristi SAMO nazive iz liste dozvoljenih.
3. Ako za proizvod ne možeš zaključiti procese, izostavi ga.

Format:
{"suggestions":[{"id":"...","stages":[["Proces A","Proces B"],["Proces C"]]}]}`;

        const result = await Promise.race([
            model.generateContent(prompt),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('AI timeout 60s')), 60000)),
        ]) as Awaited<ReturnType<typeof model.generateContent>>;

        const text = result.response.text();
        let jsonText = text;
        const md = text.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (md) jsonText = md[1];
        else { const raw = text.match(/\{[\s\S]*\}/); if (raw) jsonText = raw[0]; }

        const catalogPick = catalog.map(name => ({ Name: name }));
        let suggestions: { id: string; stages: string[][] }[] = [];
        const warnings: string[] = [];
        try {
            const parsed = JSON.parse(jsonText);
            const raw = Array.isArray(parsed?.suggestions) ? parsed.suggestions : [];
            for (const s of raw) {
                if (!s || typeof s.id !== 'string') continue;
                const stages = validateAiStages(s.stages, catalogPick);   // odbaci halucinacije
                if (stages.length) suggestions.push({ id: s.id, stages });
            }
        } catch (e) {
            return NextResponse.json({ success: false, error: 'AI nije vratio validan JSON', rawResponse: text.substring(0, 500) }, { status: 500 });
        }

        const covered = new Set(suggestions.map(s => s.id));
        products.forEach(p => { if (!covered.has(p.id)) warnings.push(`Bez prijedloga: ${p.name}`); });

        return NextResponse.json({ success: true, suggestions, warnings });
    } catch (error) {
        console.error('[suggest-processes] error:', error);
        return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Interna greška' }, { status: 500 });
    }
}
