import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Entity type configurations (should match gemini.ts)
const ENTITY_CONFIGS = {
    materials: {
        namePlural: 'Materijali',
        requiredFields: ['Name', 'Category', 'Unit'],
        optionalFields: ['Default_Supplier', 'Default_Unit_Price', 'Description'],
        enumFields: {
            'Category': ['Ploče i trake', 'Okovi', 'Staklo', 'Alu vrata', 'Ostalo'],
            'Unit': ['kom', 'm', 'm²', 'm³', 'kg', 'l', 'par', 'set'],
        },
    },
    products: {
        namePlural: 'Proizvodi',
        requiredFields: ['Name', 'Quantity'],
        optionalFields: ['Height', 'Width', 'Depth', 'Notes', 'Status'],
        enumFields: {},
    },
    workers: {
        namePlural: 'Radnici',
        requiredFields: ['Name', 'Worker_Type'],
        optionalFields: ['Role', 'Phone', 'Daily_Rate', 'Specializations'],
        enumFields: {
            'Role': ['Rezač', 'Kantiranje', 'Bušenje', 'Montaža', 'Instalacija', 'Opći'],
            'Worker_Type': ['Glavni', 'Pomoćnik'],
        },
    },
    suppliers: {
        namePlural: 'Dobavljači',
        requiredFields: ['Name'],
        optionalFields: ['Contact_Person', 'Phone', 'Email', 'Address', 'Categories'],
        enumFields: {},
    },
    projects: {
        namePlural: 'Projekti',
        requiredFields: ['Client_Name'],
        optionalFields: ['Client_Phone', 'Client_Email', 'Address', 'Notes', 'Deadline'],
        enumFields: {},
    },
};

type EntityType = keyof typeof ENTITY_CONFIGS;

function generatePrompt(entityType: EntityType, content: string): string {
    const config = ENTITY_CONFIGS[entityType];

    const fieldDescriptions = [...config.requiredFields, ...config.optionalFields]
        .map(field => {
            const isRequired = config.requiredFields.includes(field);
            const enumConfig = config.enumFields as Record<string, readonly string[]>;
            const enumValues = enumConfig[field];
            let desc = `- ${field}`;
            if (isRequired) desc += ' (OBAVEZNO)';
            if (enumValues) desc += ` - dozvoljene vrijednosti: ${enumValues.join(', ')}`;
            return desc;
        })
        .join('\n');

    // Special instructions for material category detection - IMPROVED
    const materialCategoryRules = entityType === 'materials' ? `
PRAVILA ZA PREPOZNAVANJE KATEGORIJE MATERIJALA (KORAK PO KORAK):

1. PRVO provjeri da li dokument već sadrži kategoriju za materijal. Ako da, mapiraj je na dozvoljene vrijednosti.

2. Ako kategorija nije definisana, analiziraj NAZIV materijala prema ovim pravilima:

KATEGORIJA "Ploče i trake" - koristi za:
- Ploče: OSB, MDF, PAL, iverica, ploča, panel, lesonit, univers, medijapan, furnir, regips, šperoploča
- Kant trake: KT, kant, kanttraka, ABS, PVC traka, rubna traka, lajsna za rub
- Jezgro: DTD, iveral

KATEGORIJA "Okovi" - koristi za SVE metalne komponente:
- Šarke/baglame: baglama, šarka, pant, soft close, ticni meh
- Ladičari: ladičar, tandem, vodilica, metabox, fioka, izvlakač
- Spojni elementi: okov, ekscentar, fikser, refix, minifix, rafix, euroscrew
- Vijci i tipli: vijak, vijci, šaraf, matica, tipla, zavrtanj, navrtka
- Ručke i gumbi: ručka, ručica, gumb, dugme, kvaka
- Potpore: nogica, podizač, kotač, amortizer, klizač

KATEGORIJA "Staklo" - koristi za:
- staklo, ogledalo, mirror, zrcalo, vitrina

KATEGORIJA "Alu vrata" - koristi za:
- alu, aluminij, profil, alu okvir, alu vrata, klizna vrata

KATEGORIJA "Ostalo" - koristi za:
- LED, rasvjeta, lampa, traka LED
- Ljepila, boje, lakovi, silikon
- Sve što ne spada u gore navedene kategorije

PRAVILA ZA JEDINICE MJERE:
- Ploče → "m²"
- Kant trake, lajsne → "m"
- Okovi (svi tipovi) → "kom"
- Staklo → "m²" ili "kom" ovisno o kontekstu
- Vijci, tipli → "kom"
- Ljepila → "kom" ili "l"
` : '';

    return `Ti si AI asistent za ERP aplikaciju. Izvuci: ${config.namePlural.toUpperCase()}.

VAŽNO ZA MATERIJALE:
- Polje "Default_Supplier" treba popuniti IMENOM DOBAVLJAČA ako postoji u bilo kojoj koloni (npr. Napomena, Dobavljač, itd.)
- Prepoznaj dobavljače po imenima firmi: Schachermayer, Kalea, Blum, Hafele, Egger, itd.

Polja za popuniti:
${fieldDescriptions}
${materialCategoryRules}
PRAVILA:
1. Vraćaj SAMO validan JSON
2. Brojeve vraćaj kao brojeve (ne string)
3. Za enum polja koristi SAMO dozvoljene vrijednosti
4. Dodaj "_confidence" (0.0-1.0) za svaki zapis

SADRŽAJ:
---
${content}
---

Odgovori SAMO JSON (bez \`\`\`json):
{
  "success": true,
  "data": [
    {
      ${config.requiredFields.map(f => `"${f}": "vrijednost"`).join(',\n      ')},
      "_confidence": 0.95
    }
  ],
  "warnings": []
}`;
}

export async function POST(request: NextRequest) {
    const startTime = Date.now();
    console.log('[AI-Import] Request received at', new Date().toISOString());

    try {
        const formData = await request.formData();
        console.log('[AI-Import] FormData parsed in', Date.now() - startTime, 'ms');

        const file = formData.get('file') as File | null;
        const entityType = formData.get('entityType') as EntityType | null;
        const textContent = formData.get('textContent') as string | null;

        console.log('[AI-Import] Entity type:', entityType, 'File:', file?.name || 'none', 'Text length:', textContent?.length || 0);

        if (!entityType || !ENTITY_CONFIGS[entityType]) {
            return NextResponse.json(
                { success: false, error: 'Neispravan tip entiteta' },
                { status: 400 }
            );
        }

        if (!file && !textContent) {
            return NextResponse.json(
                { success: false, error: 'Datoteka ili sadržaj je obavezan' },
                { status: 400 }
            );
        }

        // Get API key from environment (server-side)
        const apiKey = process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY;
        if (!apiKey) {
            console.error('[AI-Import] No API key found');
            return NextResponse.json(
                { success: false, error: 'API ključ nije konfigurisan' },
                { status: 500 }
            );
        }
        console.log('[AI-Import] API key found, length:', apiKey.length);

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        console.log('[AI-Import] Model initialized in', Date.now() - startTime, 'ms');

        let result;

        // Timeout wrapper for Gemini API call
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('AI analiza istekla (timeout 180s)')), 180000);
        });

        try {
            if (file) {
                const fileType = file.type;
                const fileName = file.name.toLowerCase();
                console.log('[AI-Import] Processing file:', fileName, 'type:', fileType, 'size:', file.size);

                // Handle different file types
                if (fileType === 'text/csv' || fileName.endsWith('.csv') ||
                    fileType === 'text/plain' || fileName.endsWith('.txt')) {
                    // Text-based files
                    const content = await file.text();
                    console.log('[AI-Import] Text content extracted, length:', content.length);

                    // CHUNKING: Split large files into batches
                    const lines = content.split('\n');
                    const BATCH_SIZE = 50; // Larger batches = fewer API calls

                    if (lines.length > BATCH_SIZE + 1) {
                        // Large file - process in chunks
                        const header = lines[0];
                        const dataLines = lines.slice(1).filter(l => l.trim());
                        const numBatches = Math.ceil(dataLines.length / BATCH_SIZE);
                        console.log(`[AI-Import] Large file (${dataLines.length} rows) → ${numBatches} batches PARALLEL`);

                        // Create batch chunks
                        const batches: string[][] = [];
                        for (let i = 0; i < dataLines.length; i += BATCH_SIZE) {
                            batches.push(dataLines.slice(i, i + BATCH_SIZE));
                        }

                        // Process batches SEQUENTIALLY to avoid rate limits
                        const allParsedItems: unknown[] = [];

                        for (let i = 0; i < batches.length; i++) {
                            const batchLines = batches[i];
                            const batchNum = i + 1;
                            const batchContent = [header, ...batchLines].join('\n');
                            console.log(`[AI-Import] Processing batch ${batchNum}/${numBatches}...`);

                            try {
                                const batchPrompt = generatePrompt(entityType, batchContent);
                                const batchResult = await Promise.race([
                                    model.generateContent(batchPrompt),
                                    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Timeout`)), 60000))
                                ]);

                                const batchText = batchResult.response.text();
                                console.log(`[AI-Import] Batch ${batchNum} ✓ (${batchText.length} chars)`);

                                let batchJsonText = batchText;
                                const jsonMatch = batchText.match(/```(?:json)?\s*([\s\S]*?)```/);
                                if (jsonMatch) batchJsonText = jsonMatch[1];

                                const batchParsed = JSON.parse(batchJsonText);
                                const items = batchParsed.data || batchParsed || [];
                                if (Array.isArray(items)) allParsedItems.push(...items);
                            } catch (err) {
                                console.error(`[AI-Import] Batch ${batchNum} ✗:`, err);
                            }
                        }

                        console.log(`[AI-Import] Complete! Total: ${allParsedItems.length} items`);

                        // Create mock result with combined data
                        const combinedJson = JSON.stringify({ data: allParsedItems });
                        result = {
                            response: {
                                text: () => combinedJson
                            }
                        } as Awaited<ReturnType<typeof model.generateContent>>;

                    } else {
                        // Small file - process normally
                        const prompt = generatePrompt(entityType, content);
                        console.log('[AI-Import] Prompt preview:', prompt.substring(0, 50) + '...');
                        console.log('[AI-Import] Calling Gemini 2.5 Flash at:', new Date().toISOString());

                        result = await Promise.race([
                            model.generateContent(prompt),
                            timeoutPromise
                        ]) as Awaited<ReturnType<typeof model.generateContent>>;
                    }
                } else {
                    // Binary files (PDF, DOCX, XLSX) - use multimodal
                    const buffer = await file.arrayBuffer();
                    const base64 = Buffer.from(buffer).toString('base64');
                    console.log('[AI-Import] Base64 encoded, length:', base64.length);

                    const prompt = generatePrompt(entityType, '[Pogledaj priloženu datoteku]');
                    console.log('[AI-Import] Prompt generated for multimodal, calling Gemini API...');

                    result = await Promise.race([
                        model.generateContent([
                            prompt,
                            {
                                inlineData: {
                                    mimeType: fileType,
                                    data: base64,
                                },
                            },
                        ]),
                        timeoutPromise
                    ]) as Awaited<ReturnType<typeof model.generateContent>>;
                }
            } else if (textContent) {
                const prompt = generatePrompt(entityType, textContent);
                console.log('[AI-Import] Text prompt generated, length:', prompt.length);
                console.log('[AI-Import] Prompt preview:', prompt.substring(0, 50) + '...');
                console.log('[AI-Import] Calling Gemini 2.5 Flash at:', new Date().toISOString());

                result = await Promise.race([
                    model.generateContent(prompt),
                    timeoutPromise
                ]) as Awaited<ReturnType<typeof model.generateContent>>;
            } else {
                return NextResponse.json(
                    { success: false, error: 'Nema sadržaja za analizu' },
                    { status: 400 }
                );
            }
        } catch (aiError) {
            console.error('[AI-Import] Gemini API error after', Date.now() - startTime, 'ms:', aiError);
            throw aiError;
        }

        console.log('[AI-Import] Gemini response received in', Date.now() - startTime, 'ms');

        const response = result.response;
        const text = response.text();
        console.log('[AI-Import] Response text length:', text.length);

        // Extract JSON from response (remove any markdown code blocks)
        let jsonText = text;
        const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) {
            jsonText = jsonMatch[1];
        } else {
            // Try to find raw JSON
            const rawJsonMatch = text.match(/\{[\s\S]*\}/);
            if (rawJsonMatch) {
                jsonText = rawJsonMatch[0];
            }
        }

        try {
            const parsed = JSON.parse(jsonText);
            console.log('[AI-Import] JSON parsed successfully, items:', parsed.data?.length || 0);

            // Validate and clean data
            const config = ENTITY_CONFIGS[entityType];
            const cleanedData = (parsed.data || []).map((item: Record<string, unknown>) => {
                const cleaned: Record<string, unknown> = {};

                // Copy all recognized fields
                for (const field of [...config.requiredFields, ...config.optionalFields]) {
                    if (item[field] !== undefined) {
                        cleaned[field] = item[field];
                    }
                }

                // Keep metadata fields
                if (item._confidence !== undefined) {
                    cleaned._confidence = item._confidence;
                }
                if (item._warnings !== undefined) {
                    cleaned._warnings = item._warnings;
                }

                return cleaned;
            });

            console.log('[AI-Import] Request completed in', Date.now() - startTime, 'ms');

            return NextResponse.json({
                success: true,
                data: cleanedData,
                warnings: parsed.warnings || [],
            });
        } catch (parseError) {
            console.error('[AI-Import] JSON parse error:', parseError, 'Raw text:', text.substring(0, 500));
            return NextResponse.json({
                success: false,
                error: 'AI nije vratio validan JSON odgovor',
                rawResponse: text.substring(0, 1000),
            }, { status: 500 });
        }
    } catch (error) {
        console.error('[AI-Import] Fatal error after', Date.now() - startTime, 'ms:', error);
        return NextResponse.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Interna greška servera'
            },
            { status: 500 }
        );
    }
}
