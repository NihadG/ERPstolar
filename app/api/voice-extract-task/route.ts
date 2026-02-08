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

const EXTRACTION_PROMPT = `Ti si napredni AI asistent za ekstrakciju strukturiranih zadataka iz glasovnog unosa u ERP sistemu za stolarsku radnju.

KRITIČNA PRAVILA ZA NASLOV vs OPIS vs CHECKLIST:

1. NASLOV (title):
   - Kratak imperativ ili naziv glavne akcije (max 60 karaktera)
   - Ako postoji JEDNA radnja → naslov je ta radnja
   - Ako postoji VIŠE koraka → naslov je generički naziv (npr. "Priprema za projekat X", "Narudžba materijala")
   - NE stavljaj detalje u naslov - samo ključnu akciju

2. OPIS (description):
   - Svi dodatni kontekstualni detalji, razlozi, specifikacije
   - Vremenski kontekst ("jer dolaze u ponedjeljak", "potrebno do petka")
   - Tehničke specifikacije ili napomene
   - Ako nema dodatnog konteksta, ostavi prazan string ""

3. CHECKLIST:
   - OBAVEZNO detektuj nabrajanja kada korisnik koristi:
     * Sekvencijalne riječi: "prvo", "zatim", "onda", "nakon toga", "pa", "potom"
     * Nabrajanje: "treba X, Y i Z", "moram A, B, C"
     * Imperativne liste: "napraviti..., naručiti..., poslati..."
   - Svaki korak = posebna stavka u checklisti
   - Maksimalno 5 stavki, formulirane kao jasne akcije
   - Ako je samo JEDNA radnja bez nabrajanja → prazan niz []

═══════════════════════════════════════════════════════════════
PRIMJERI (FEW-SHOT LEARNING):
═══════════════════════════════════════════════════════════════

PRIMJER 1 - Jednostavan zadatak:
Korisnik: "Nazovi Marinka za ponudu"
Rezultat:
{
  "title": "Nazovi Marinka za ponudu",
  "description": "",
  "priority": "medium",
  "category": "meeting",
  "checklist": [],
  "suggestedDueDate": null,
  "suggestedWorker": null,
  "suggestedProject": null
}

PRIMJER 2 - Zadatak sa checklistom:
Korisnik: "Treba napraviti ormar za Kovačević, prvo izmjeriti prostor, pa napraviti nacrt, zatim naručiti iverice"
Rezultat:
{
  "title": "Ormar za Kovačević",
  "description": "",
  "priority": "medium",
  "category": "manufacturing",
  "checklist": ["Izmjeriti prostor", "Napraviti nacrt", "Naručiti iverice"],
  "suggestedDueDate": null,
  "suggestedWorker": null,
  "suggestedProject": "Kovačević"
}

PRIMJER 3 - Hitan zadatak sa datumom:
Korisnik: "Hitno poslati ponudu za Hodžić do sutra"
Rezultat:
{
  "title": "Poslati ponudu za Hodžić",
  "description": "Hitno potrebno",
  "priority": "urgent",
  "category": "general",
  "checklist": [],
  "suggestedDueDate": "{TOMORROW}",
  "suggestedWorker": null,
  "suggestedProject": "Hodžić"
}

PRIMJER 4 - Kompleksan tekst sa kontekstom:
Korisnik: "Za projekat Mehić trebam prvo zvati dobavljača, pa provjeriti zalihe, zatim naručiti iverice i okove. Potrebno sve završiti do petka jer dolaze na ugradnju u ponedjeljak."
Rezultat:
{
  "title": "Priprema materijala za Mehić",
  "description": "Potrebno završiti do petka jer dolaze na ugradnju u ponedjeljak",
  "priority": "high",
  "category": "ordering",
  "checklist": ["Zvati dobavljača", "Provjeriti zalihe", "Naručiti iverice", "Naručiti okove"],
  "suggestedDueDate": "{FRIDAY}",
  "suggestedWorker": null,
  "suggestedProject": "Mehić"
}

PRIMJER 5 - Dizajn sa koracima:
Korisnik: "Treba isprogramirati novi dizajn za klijenta Sarajlić, napraviti crtež u CAD-u i poslati na odobrenje, hitno je"
Rezultat:
{
  "title": "Novi dizajn za Sarajlić",
  "description": "Hitno potrebno",
  "priority": "urgent",
  "category": "design",
  "checklist": ["Napraviti crtež u CAD-u", "Poslati na odobrenje"],
  "suggestedDueDate": null,
  "suggestedWorker": null,
  "suggestedProject": "Sarajlić"
}

═══════════════════════════════════════════════════════════════
TEKST KORISNIKA ZA OBRADU:
═══════════════════════════════════════════════════════════════
"""
{USER_TEXT}
"""

KONTEKST (dostupni projekti i radnici):
{CONTEXT}

PRAVILA ZA PRIORITET:
- "hitno", "odmah", "danas", "urgent", "mora danas" → "urgent"
- "važno", "prioritet", "high", "bitno" → "high"
- Bez posebne urgencije → "medium"
- "nije hitno", "kad stigneš", "low priority", "nije žurba" → "low"

PRAVILA ZA KATEGORIJU:
- Naručivanje, nabavka, dobavljač, kupovina materijala → "ordering"
- Proizvodnja, izrada, montaža u radionici, rad u radnji → "manufacturing"
- Instalacija, ugradnja, teren, kod klijenta → "installation"
- Dizajn, crtež, CAD, projekt, skica, programiranje → "design"
- Sastanak, poziv, razgovor, dogovor, zvati → "meeting"
- Podsjetnik, podsjetiti, ne zaboraviti, zapamti → "reminder"
- Ostalo → "general"

PRAVILA ZA DATUM:
- "danas" → {TODAY}
- "sutra" → {TOMORROW}
- "prekosutra" → dan nakon sutra
- "ovaj tjedan", "ove sedmice", "do petka" → {FRIDAY}
- "sljedeći tjedan" → ponedjeljak sljedeće sedmice
- Konkretan datum ako se eksplicitno spomene
- Inače null

VAŽNO:
- Ako se spominje ime osobe, provjeri da li je u listi radnika
- Ako se spominje klijent/projekat, provjeri da li je u listi projekata
- Checklist stavke formuliši kao jasne, kratke akcije (imperativ)
- Odgovori ISKLJUČIVO validnim JSON-om, bez markdown formatiranja ili dodatnog teksta`;

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
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

        // Generate response
        const result = await model.generateContent(prompt);
        const response = await result.response;
        let responseText = response.text();

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
