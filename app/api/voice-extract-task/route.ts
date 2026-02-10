import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Types for extracted task data
export interface ExtractedTaskData {
    title: string;
    description: string;
    priority: 'low' | 'medium' | 'high' | 'urgent';
    category: 'general' | 'manufacturing' | 'ordering' | 'installation' | 'design' | 'meeting' | 'reminder';
    checklist: string[];
    suggestedDueDate: string | null;
    suggestedWorker: string | null;
    suggestedProject: string | null;
}

const EXTRACTION_PROMPT = `Ti si AI asistent za ERP sistem stolarske radionice (fabrika namještaja). Tvoj posao je da iz govornog unosa na bosanskom/hrvatskom/srpskom jeziku izvučeš strukturirane podatke za kreiranje zadatka.

KONTEKST FIRME: Stolarska radionica koja proizvodi namještaj po mjeri — kuhinje, ormare, komode, vitrine, radne ploče. Koristi materijale kao iverica (iveral), MDF, drvo (hrast, bukva, orah), ABS trake, okove, šarke, vodilice, itd.

═══════════════════════════════════════════════════════════════
PRAVILA:
═══════════════════════════════════════════════════════════════

1. NASLOV (title):
   - Kratak, jasan, profesionalan naslov (max 60 karaktera)
   - Koristi infinitiv ili imenicu: "Naručiti materijal za...", "Pripremiti..." 
   - Za JEDAN zadatak: sam zadatak kao naslov
   - Za VIŠE zadataka: zbirni naslov ("Obaveze za klijenta X", "Pripreme za montažu")
   - NIKADA ne stavljaj sirovi transkript kao naslov!
   - Uvijek velikim slovom počni

2. OPIS (description):
   - Dodatni kontekst, detalji, napomene iz govora
   - Bilo koji dio koji nije naslov ni checklist stavka
   - Ako nema dodatnog konteksta → prazan string ""
   - NE ponavljaj naslov u opisu!

3. CHECKLIST:
   - AKO korisnik nabraja VIŠE stvari ("prvo X, pa Y, i Z") → SVAKA stavka posebno u checklisti
   - AKO je samo JEDAN zadatak bez nabrajanja → prazan niz []
   - Svaka stavka čista, profesionalna rečenica sa velikim slovom
   - Maksimalno 10 stavki

4. PROJEKAT (suggestedProject):
   - Ako korisnik pomene ime klijenta, mjesto, ili projekat → vrati ime
   - OBAVEZNO provjeri listu dostupnih projekata/klijenata u KONTEKSTU
   - Koristi fuzzy matching - "Hodžić" treba da matchuje "Hodžić Sarajevo"
   - Ako ne prepoznajes → null

5. RADNIK (suggestedWorker):
   - Ako korisnik pomene ime radnika → vrati ime
   - Provjeri listu dostupnih radnika u KONTEKSTU
   - null ako nema

═══════════════════════════════════════════════════════════════
PRIMJERI (STOLARSKA RADIONICA):
═══════════════════════════════════════════════════════════════

Korisnik: "Treba naručiti iveral H3395 hrast za Hodžića"
→ {"title": "Naručiti iveral H3395 hrast", "description": "Za projekat Hodžić", "priority": "medium", "category": "ordering", "checklist": [], "suggestedDueDate": null, "suggestedWorker": null, "suggestedProject": "Hodžić"}

Korisnik: "Hitno za sutra, pripremiti materijal za montažu kod Begović, treba ABS trake, šarke i vodilice"
→ {"title": "Pripremiti materijal za montažu Begović", "description": "Hitno za sutra", "priority": "urgent", "category": "manufacturing", "checklist": ["Pripremiti ABS trake", "Pripremiti šarke", "Pripremiti vodilice"], "suggestedDueDate": "{TOMORROW}", "suggestedWorker": null, "suggestedProject": "Begović"}

Korisnik: "Emir neka izmjeri kod Petrović u Zenici za kuhinju"
→ {"title": "Mjerenje za kuhinju - Petrović Zenica", "description": "", "priority": "medium", "category": "design", "checklist": [], "suggestedDueDate": null, "suggestedWorker": "Emir", "suggestedProject": "Petrović"}

Korisnik: "Moramo nazvati dobavljača za okove, provjeriti cijenu vodilica i naručiti ABS trake"
→ {"title": "Nabavka okova i materijala", "description": "", "priority": "medium", "category": "ordering", "checklist": ["Nazvati dobavljača za okove", "Provjeriti cijenu vodilica", "Naručiti ABS trake"], "suggestedDueDate": null, "suggestedWorker": null, "suggestedProject": null}

Korisnik: "Danas se mora završiti kuhinja za Delića, treba kantovati ploče i sklopiti gornje elemente"
→ {"title": "Završiti kuhinju za Delića", "description": "Danas obavezno", "priority": "urgent", "category": "manufacturing", "checklist": ["Kantovati ploče", "Sklopiti gornje elemente"], "suggestedDueDate": "{TODAY}", "suggestedWorker": null, "suggestedProject": "Delić"}

Korisnik: "U petak montaža kod Ibrahimović u Ilidži, treba ponijeti alat, silikoniti radnu ploču i spojiti vodu"
→ {"title": "Montaža kod Ibrahimović - Ilidža", "description": "Petak", "priority": "high", "category": "installation", "checklist": ["Ponijeti alat", "Silikoniti radnu ploču", "Spojiti vodu"], "suggestedDueDate": "{FRIDAY}", "suggestedWorker": null, "suggestedProject": "Ibrahimović"}

Korisnik: "Zakazati sastanak sa klijentom za novi projekat"
→ {"title": "Zakazati sastanak sa klijentom", "description": "Za novi projekat", "priority": "medium", "category": "meeting", "checklist": [], "suggestedDueDate": null, "suggestedWorker": null, "suggestedProject": null}

Korisnik: "Kupi mlijeko i kruh"
→ {"title": "Kupovina potrepština", "description": "", "priority": "low", "category": "general", "checklist": ["Kupiti mlijeko", "Kupiti kruh"], "suggestedDueDate": null, "suggestedWorker": null, "suggestedProject": null}

═══════════════════════════════════════════════════════════════
TEKST ZA OBRADU:
═══════════════════════════════════════════════════════════════
"""
{USER_TEXT}
"""

KONTEKST — dostupni projekti/klijenti, radnici i dobavljači:
{CONTEXT}

PRIORITET:
- "hitno", "odmah", "urgent", "mora danas", "mora odmah" → "urgent"
- "važno", "bitno", "mora se", "obavezno" → "high"  
- Normalno → "medium"
- "nije hitno", "kad stigneš", "kada bude vremena" → "low"

KATEGORIJA (izaberi najbližu):
- ordering: naručivanje, kupovina, nabavka, narudžba, dobavljač, cijena
- manufacturing: proizvodnja, izrada, rezanje, kantovanje, brušenje, sklapanje, lakiranje
- installation: montaža, ugradnja, instalacija, postavljanje, spajanje
- design: dizajn, crtanje, projektovanje, mjerenje, nacrt
- meeting: sastanak, poziv, razgovor
- reminder: podsjetnik, ne zaboravi, zapamti
- general: sve ostalo (DEFAULT)

DATUM:
- "danas" → {TODAY}
- "sutra" → {TOMORROW}
- "ovaj tjedan"/"do petka"/"u petak" → {FRIDAY}
- Inače → null

KRITIČNO:
- SVAKA nabrojena stavka MORA biti u checklisti!
- Ako korisnik kaže "A, B i C" = TRI stavke u checklisti
- NIKADA ne vrati sirovi transkript kao naslov — uvijek obradi i skrati
- Svaki naslov i stavku počni VELIKIM SLOVOM
- Odgovori SAMO validnim JSON-om, bez dodatnog teksta`;


export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { text, context } = body as {
            text: string;
            context?: {
                projects?: string[];
                workers?: string[];
                suppliers?: string[];
            };
        };

        if (!text || text.trim().length === 0) {
            return NextResponse.json(
                { error: 'No text provided' },
                { status: 400 }
            );
        }

        const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
        if (!apiKey) {
            return NextResponse.json(
                { error: 'Gemini API key not configured' },
                { status: 503 }
            );
        }

        // Build context string with all available data
        const contextParts: string[] = [];
        if (context?.projects?.length) {
            contextParts.push(`Projekti/Klijenti: ${context.projects.join(', ')}`);
        }
        if (context?.workers?.length) {
            contextParts.push(`Radnici: ${context.workers.join(', ')}`);
        }
        if (context?.suppliers?.length) {
            contextParts.push(`Dobavljači: ${context.suppliers.join(', ')}`);
        }
        const contextStr = contextParts.length > 0 ? contextParts.join('\n') : 'Nema dostupnog konteksta';

        // Get date references
        const todayDate = new Date();
        const today = todayDate.toISOString().split('T')[0];

        const tomorrowDate = new Date(todayDate);
        tomorrowDate.setDate(tomorrowDate.getDate() + 1);
        const tomorrow = tomorrowDate.toISOString().split('T')[0];

        const fridayDate = new Date(todayDate);
        const dayOfWeek = fridayDate.getDay();
        const daysUntilFriday = dayOfWeek <= 5 ? 5 - dayOfWeek : 5 + (7 - dayOfWeek);
        fridayDate.setDate(fridayDate.getDate() + daysUntilFriday);
        const friday = fridayDate.toISOString().split('T')[0];

        // Build the prompt
        const prompt = EXTRACTION_PROMPT
            .replace('{USER_TEXT}', text)
            .replace('{CONTEXT}', contextStr)
            .replaceAll('{TODAY}', today)
            .replaceAll('{TOMORROW}', tomorrow)
            .replaceAll('{FRIDAY}', friday);

        // Initialize Gemini
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

        console.log(`Voice extract: Processing text: "${text}"`);

        const result = await model.generateContent(prompt);
        const response = await result.response;
        let responseText = response.text();

        console.log(`Voice extract: Gemini raw response: "${responseText.substring(0, 500)}..."`);

        // Clean up response
        responseText = responseText
            .replace(/```json\n?/g, '')
            .replace(/```\n?/g, '')
            .trim();

        // Parse JSON
        let extractedData: ExtractedTaskData;
        try {
            extractedData = JSON.parse(responseText);
        } catch (parseError) {
            console.error('Failed to parse AI response:', responseText);
            // Intelligent fallback: use first 60 chars as title, rest as description
            const cleanText = text.trim();
            const sentenceEnd = cleanText.indexOf('.') > 0 && cleanText.indexOf('.') < 60
                ? cleanText.indexOf('.') + 1
                : Math.min(cleanText.length, 60);
            extractedData = {
                title: cleanText.substring(0, sentenceEnd).trim(),
                description: cleanText.length > sentenceEnd ? cleanText.substring(sentenceEnd).trim() : '',
                priority: 'medium',
                category: 'general',
                checklist: [],
                suggestedDueDate: null,
                suggestedWorker: null,
                suggestedProject: null
            };
        }

        // Validate and sanitize
        const validPriorities = ['low', 'medium', 'high', 'urgent'];
        const validCategories = ['general', 'manufacturing', 'ordering', 'installation', 'design', 'meeting', 'reminder'];

        if (!validPriorities.includes(extractedData.priority)) {
            extractedData.priority = 'medium';
        }
        if (!validCategories.includes(extractedData.category)) {
            extractedData.category = 'general';
        }
        if (!Array.isArray(extractedData.checklist)) {
            extractedData.checklist = [];
        }
        // Limit checklist to 10 items
        extractedData.checklist = extractedData.checklist.slice(0, 10);

        // Post-processing: ensure title starts with uppercase, trim excess
        if (extractedData.title) {
            extractedData.title = extractedData.title.charAt(0).toUpperCase() + extractedData.title.slice(1);
            if (extractedData.title.length > 60) {
                extractedData.title = extractedData.title.substring(0, 57) + '...';
            }
        }

        // Capitalize checklist items
        extractedData.checklist = extractedData.checklist.map(item =>
            item ? item.charAt(0).toUpperCase() + item.slice(1) : item
        );

        return NextResponse.json(extractedData);

    } catch (error: any) {
        console.error('Task Extraction Error:', error);
        return NextResponse.json(
            { error: 'Greška pri ekstrakciji zadatka: ' + (error.message || 'Unknown error') },
            { status: 500 }
        );
    }
}
