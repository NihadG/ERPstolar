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

const EXTRACTION_PROMPT = `Ti si univerzalni AI asistent za ekstrakciju strukturiranih zadataka iz govornog unosa. Radiš sa BILO KAKVIM tipovima zadataka - ličnim, poslovnim, kreativnim, tehničkim, porodičnim, zdravstvenim, itd.

PRAVILA ZA NASLOV, OPIS I CHECKLIST:

1. NASLOV (title):
   - Kratak, jasan naslov zadatka (max 60 karaktera)
   - Za JEDAN zadatak: koristi samu akciju kao naslov
   - Za VIŠE zadataka: koristi zbirni naslov (npr. "Dnevne obaveze", "Zadaci za danas")

2. OPIS (description):
   - Dodatni kontekst, razlozi, napomene
   - Ako nema dodatnog konteksta → prazan string ""

3. CHECKLIST:
   - AKO korisnik nabraja VIŠE stvari (koristeći "i", "pa", "zatim", "prvo...pa", zareze, ili jednostavno nabraja):
     → SVAKA stvar postaje posebna stavka u checklisti!
   - AKO je samo JEDAN zadatak bez nabrajanja → prazan niz []
   - Maksimalno 10 stavki

═══════════════════════════════════════════════════════════════
PRIMJERI:
═══════════════════════════════════════════════════════════════

Korisnik: "Kupi mlijeko"
→ {"title": "Kupi mlijeko", "description": "", "priority": "medium", "category": "general", "checklist": [], "suggestedDueDate": null, "suggestedWorker": null, "suggestedProject": null}

Korisnik: "Otići u apoteku, dom zdravlja i pokositi travu"
→ {"title": "Današnje obaveze", "description": "", "priority": "medium", "category": "general", "checklist": ["Otići u apoteku", "Otići u dom zdravlja", "Pokositi travu"], "suggestedDueDate": null, "suggestedWorker": null, "suggestedProject": null}

Korisnik: "Hitno nazvati majstora za peć"
→ {"title": "Nazvati majstora za peć", "description": "Hitno", "priority": "urgent", "category": "general", "checklist": [], "suggestedDueDate": null, "suggestedWorker": null, "suggestedProject": null}

Korisnik: "Sutra moram platiti račune, odnijeti auto na servis i kupiti poklon za rođendan"
→ {"title": "Obaveze za sutra", "description": "", "priority": "medium", "category": "general", "checklist": ["Platiti račune", "Odnijeti auto na servis", "Kupiti poklon za rođendan"], "suggestedDueDate": "{TOMORROW}", "suggestedWorker": null, "suggestedProject": null}

Korisnik: "Ne zaboravi da zoveš doktora u ponedjeljak"
→ {"title": "Zvati doktora", "description": "", "priority": "medium", "category": "reminder", "checklist": [], "suggestedDueDate": null, "suggestedWorker": null, "suggestedProject": null}

═══════════════════════════════════════════════════════════════
TEKST ZA OBRADU:
═══════════════════════════════════════════════════════════════
"""
{USER_TEXT}
"""

KONTEKST (opciono - projekti/radnici ako su dostupni):
{CONTEXT}

PRIORITET:
- "hitno", "odmah", "urgent", "mora danas" → "urgent"
- "važno", "bitno" → "high"  
- Normalno → "medium"
- "nije hitno", "kad stigneš" → "low"

KATEGORIJA (izaberi najbližu):
- ordering: naručivanje, kupovina, nabavka
- manufacturing: proizvodnja, izrada, pravljenje
- installation: instalacija, ugradnja, montaža
- design: dizajn, crtanje, projektovanje
- meeting: sastanak, poziv, razgovor
- reminder: podsjetnik, ne zaboravi
- general: sve ostalo (DEFAULT - koristi ovu ako nisi siguran)

DATUM:
- "danas" → {TODAY}
- "sutra" → {TOMORROW}
- "ovaj tjedan"/"do petka" → {FRIDAY}
- Inače → null

KRITIČNO:
- SVAKA nabrojena stavka MORA biti u checklisti!
- Ako korisnik kaže "A, B i C" = TRI stavke u checklisti
- Odgovori SAMO validnim JSON-om, bez dodatnog teksta`;


export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { text, context } = body as {
            text: string;
            context?: {
                projects?: string[];
                workers?: string[];
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

        // Build context string
        const contextStr = context
            ? `Projekti/Klijenti: ${context.projects?.join(', ') || 'Nema podataka'}
Radnici: ${context.workers?.join(', ') || 'Nema podataka'}`
            : 'Nema dostupnog konteksta';

        // Get date references
        const todayDate = new Date();
        const today = todayDate.toISOString().split('T')[0];

        // Calculate tomorrow
        const tomorrowDate = new Date(todayDate);
        tomorrowDate.setDate(tomorrowDate.getDate() + 1);
        const tomorrow = tomorrowDate.toISOString().split('T')[0];

        // Calculate this Friday
        const fridayDate = new Date(todayDate);
        const dayOfWeek = fridayDate.getDay();
        const daysUntilFriday = dayOfWeek <= 5 ? 5 - dayOfWeek : 5 + (7 - dayOfWeek);
        fridayDate.setDate(fridayDate.getDate() + daysUntilFriday);
        const friday = fridayDate.toISOString().split('T')[0];

        // Build the prompt with all date placeholders
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

        // Generate response
        const result = await model.generateContent(prompt);
        const response = await result.response;
        let responseText = response.text();

        console.log(`Voice extract: Gemini raw response: "${responseText.substring(0, 500)}..."`);

        // Clean up response (remove markdown code blocks if present)
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
            // Return a basic fallback
            extractedData = {
                title: text.substring(0, 60),
                description: text,
                priority: 'medium',
                category: 'general',
                checklist: [],
                suggestedDueDate: null,
                suggestedWorker: null,
                suggestedProject: null
            };
        }

        // Validate and sanitize the response
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
        // Limit checklist to 5 items
        extractedData.checklist = extractedData.checklist.slice(0, 5);

        return NextResponse.json(extractedData);

    } catch (error: any) {
        console.error('Task Extraction Error:', error);
        return NextResponse.json(
            { error: 'Greška pri ekstrakciji zadatka: ' + (error.message || 'Unknown error') },
            { status: 500 }
        );
    }
}
