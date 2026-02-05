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

const EXTRACTION_PROMPT = `Ti si asistent za upravljanje zadacima u ERP sistemu za stolarsku radnju.
Korisnik je izgovorio sljedeći tekst. Izvuci strukturirane podatke za kreiranje zadatka.

TEKST KORISNIKA:
"""
{USER_TEXT}
"""

KONTEKST (dostupni projekti i radnici):
{CONTEXT}

Odgovori ISKLJUČIVO u validnom JSON formatu, bez dodatnog teksta:
{
  "title": "Kratak, jasan naslov zadatka (max 60 karaktera)",
  "description": "Detaljan opis ako postoji, inače prazan string",
  "priority": "low|medium|high|urgent",
  "category": "general|manufacturing|ordering|installation|design|meeting|reminder",
  "checklist": ["stavka1", "stavka2"],
  "suggestedDueDate": "YYYY-MM-DD ili null",
  "suggestedWorker": "ime radnika ako se spominje ili null",
  "suggestedProject": "ime projekta/klijenta ako se spominje ili null"
}

PRAVILA ZA PRIORITET:
- "hitno", "odmah", "danas", "urgent" → "urgent"
- "važno", "prioritet", "high" → "high"
- Bez posebne urgencije → "medium"
- "nije hitno", "kad stigneš", "low priority" → "low"

PRAVILA ZA KATEGORIJU:
- Naručivanje materijala, dobavljači, nabavka → "ordering"
- Proizvodnja, radovi, izrada, montaža u radionici → "manufacturing"
- Instalacija, ugradnja kod klijenta, teren → "installation"
- Dizajn, crtež, projekt, skica → "design"
- Sastanak, razgovor, dogovor → "meeting"
- Podsjetnik, podsjetiti, ne zaboraviti → "reminder"
- Ostalo → "general"

PRAVILA ZA DATUM:
- "danas" → današnji datum ({TODAY})
- "sutra" → sutrašnji datum
- "ovaj tjedan", "ove sedmice" → petak ove sedmice
- Konkretan datum ako se spominje
- Inače null

PRAVILA ZA CHECKLIST:
- Ako korisnik nabrojava korake ili stvari za uraditi, stavi svaku kao posebnu stavku
- Maksimalno 5 stavki
- Ako nema nabrajanja, prazan niz []

VAŽNO:
- Ako se spominje ime osobe, provjeri da li je u listi radnika
- Ako se spominje klijent/kupac, provjeri da li je u listi projekata
- Naslov treba biti jasan i koncizan
- Odgovori SAMO JSON, bez markdown formatiranja`;

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

        // Get today's date for reference
        const today = new Date().toISOString().split('T')[0];

        // Build the prompt
        const prompt = EXTRACTION_PROMPT
            .replace('{USER_TEXT}', text)
            .replace('{CONTEXT}', contextStr)
            .replace('{TODAY}', today);

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
