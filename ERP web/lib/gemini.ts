// ============================================
// GEMINI AI INTEGRATION FOR DATA IMPORT
// ============================================

import { GoogleGenerativeAI } from '@google/generative-ai';
import {
    Material,
    Product,
    Worker,
    Supplier,
    Project,
    MATERIAL_CATEGORIES,
    WORKER_ROLES,
    WORKER_TYPES,
} from './types';

// Entity types supported for AI import
export type ImportEntityType = 'materials' | 'products' | 'workers' | 'suppliers' | 'projects';

// Parsed data result from AI
export interface ParsedDataResult<T> {
    success: boolean;
    data: (Partial<T> & { _confidence?: number; _warnings?: string[] })[];
    warnings: string[];
    errors: string[];
}

// Entity type configuration
interface EntityConfig {
    name: string;
    namePlural: string;
    icon: string;
    description: string;
    exampleFields: string[];
    requiredFields: string[];
    optionalFields: string[];
    fieldMappings: Record<string, string[]>; // AI field name variations -> database field
    enumFields?: Record<string, readonly string[]>; // Field -> allowed values
}

// Configuration for each entity type
export const ENTITY_CONFIGS: Record<ImportEntityType, EntityConfig> = {
    materials: {
        name: 'Materijal',
        namePlural: 'Materijali',
        icon: '📦',
        description: 'Ploče, okovi, vijci, kanttrake i ostali materijali',
        exampleFields: ['Naziv', 'Kategorija', 'Jedinica mjere', 'Cijena'],
        requiredFields: ['Name', 'Category', 'Unit'],
        optionalFields: ['Default_Supplier', 'Default_Unit_Price', 'Description'],
        fieldMappings: {
            'Name': ['naziv', 'ime', 'name', 'materijal', 'artikal', 'proizvod'],
            'Category': ['kategorija', 'category', 'vrsta', 'tip', 'grupa'],
            'Unit': ['jedinica', 'unit', 'jm', 'mjera', 'jedinica mjere'],
            'Default_Supplier': ['dobavljač', 'supplier', 'dobavljac', 'isporučilac'],
            'Default_Unit_Price': ['cijena', 'price', 'cena', 'jedinična cijena', 'jed. cijena', 'kn', 'km'],
            'Description': ['opis', 'description', 'napomena', 'note'],
        },
        enumFields: {
            'Category': MATERIAL_CATEGORIES as unknown as readonly string[],
            'Unit': ['kom', 'm', 'm²', 'm³', 'kg', 'l', 'par', 'set'] as const,
        },
    },
    products: {
        name: 'Proizvod',
        namePlural: 'Proizvodi',
        icon: '🛠️',
        description: 'Kuhinje, ormari, komode i ostali namještaj',
        exampleFields: ['Naziv', 'Visina', 'Širina', 'Dubina', 'Količina'],
        requiredFields: ['Name', 'Quantity'],
        optionalFields: ['Height', 'Width', 'Depth', 'Notes', 'Status'],
        fieldMappings: {
            'Name': ['naziv', 'ime', 'name', 'proizvod', 'artikal', 'element'],
            'Height': ['visina', 'height', 'v', 'h'],
            'Width': ['širina', 'sirina', 'width', 'š', 'w'],
            'Depth': ['dubina', 'depth', 'd', 'dub'],
            'Quantity': ['količina', 'kolicina', 'qty', 'quantity', 'kom', 'komada', 'kol'],
            'Notes': ['napomena', 'notes', 'note', 'opis', 'description'],
            'Status': ['status', 'stanje'],
        },
    },
    workers: {
        name: 'Radnik',
        namePlural: 'Radnici',
        icon: '👷',
        description: 'Stolari, monteri i ostali radnici',
        exampleFields: ['Ime i prezime', 'Uloga', 'Telefon', 'Dnevnica'],
        requiredFields: ['Name', 'Worker_Type'],
        optionalFields: ['Role', 'Phone', 'Daily_Rate', 'Specializations'],
        fieldMappings: {
            'Name': ['ime', 'name', 'radnik', 'ime i prezime', 'prezime'],
            'Role': ['uloga', 'role', 'pozicija', 'radno mjesto'],
            'Worker_Type': ['tip', 'type', 'vrsta', 'tip radnika'],
            'Phone': ['telefon', 'phone', 'tel', 'mobitel', 'broj'],
            'Daily_Rate': ['dnevnica', 'daily rate', 'plata', 'satnica', 'cijena'],
            'Specializations': ['specijalizacije', 'specializations', 'vještine', 'skills'],
        },
        enumFields: {
            'Role': WORKER_ROLES as unknown as readonly string[],
            'Worker_Type': WORKER_TYPES,
        },
    },
    suppliers: {
        name: 'Dobavljač',
        namePlural: 'Dobavljači',
        icon: '🏭',
        description: 'Dobavljači materijala i opreme',
        exampleFields: ['Naziv firme', 'Kontakt osoba', 'Telefon', 'Email'],
        requiredFields: ['Name'],
        optionalFields: ['Contact_Person', 'Phone', 'Email', 'Address', 'Categories'],
        fieldMappings: {
            'Name': ['naziv', 'name', 'firma', 'dobavljač', 'kompanija', 'company'],
            'Contact_Person': ['kontakt', 'contact', 'osoba', 'kontakt osoba'],
            'Phone': ['telefon', 'phone', 'tel', 'broj'],
            'Email': ['email', 'e-mail', 'mail', 'elektronska pošta'],
            'Address': ['adresa', 'address', 'lokacija', 'sjedište'],
            'Categories': ['kategorije', 'categories', 'djelatnost', 'vrsta'],
        },
    },
    projects: {
        name: 'Projekt',
        namePlural: 'Projekti',
        icon: '📋',
        description: 'Projekti za klijente',
        exampleFields: ['Klijent', 'Telefon', 'Email', 'Adresa', 'Rok'],
        requiredFields: ['Client_Name'],
        optionalFields: ['Client_Phone', 'Client_Email', 'Address', 'Notes', 'Deadline'],
        fieldMappings: {
            'Client_Name': ['klijent', 'client', 'naručilac', 'kupac', 'ime', 'naziv'],
            'Client_Phone': ['telefon', 'phone', 'tel', 'mobitel'],
            'Client_Email': ['email', 'e-mail', 'mail'],
            'Address': ['adresa', 'address', 'lokacija'],
            'Notes': ['napomena', 'notes', 'opis', 'description'],
            'Deadline': ['rok', 'deadline', 'datum', 'završetak', 'do kada'],
        },
    },
};

// Initialize Gemini client
let genAI: GoogleGenerativeAI | null = null;

export function initializeGemini(apiKey: string): GoogleGenerativeAI {
    genAI = new GoogleGenerativeAI(apiKey);
    return genAI;
}

export function getGeminiClient(): GoogleGenerativeAI {
    if (!genAI) {
        const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
        if (!apiKey) {
            throw new Error('Gemini API key not configured');
        }
        genAI = new GoogleGenerativeAI(apiKey);
    }
    return genAI;
}

// Generate prompt for entity type
function generatePrompt(entityType: ImportEntityType, content: string): string {
    const config = ENTITY_CONFIGS[entityType];

    const fieldDescriptions = [...config.requiredFields, ...config.optionalFields]
        .map(field => {
            const isRequired = config.requiredFields.includes(field);
            const enumValues = config.enumFields?.[field];
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

    return `Ti si AI asistent za ERP aplikaciju za stolarsku radionicu.
Analiziraj sadržaj dokumenta i izvuci listu: ${config.namePlural.toUpperCase()}.

Za svaki zapis prepoznaj sljedeća polja:
${fieldDescriptions}
${materialCategoryRules}
PRAVILA:
1. Vraćaj SAMO validan JSON format, bez dodatnog teksta
2. Ako ne možeš prepoznati obavezno polje, preskoči taj zapis i dodaj upozorenje
3. Brojeve vraćaj kao brojeve (ne kao string)
4. Za enum polja koristi SAMO dozvoljene vrijednosti, mapiraj varijacije na njih.
5. Dodaj "_confidence" polje (0.0-1.0) za svaki zapis
6. Ako nisi siguran za neku vrijednost, dodaj "_warnings" array

SADRŽAJ DOKUMENTA:
---
${content}
---

Odgovori SAMO ovim JSON formatom:
{
  "success": true,
  "data": [
    {
      ${config.requiredFields.map(f => `"${f}": "..."`).join(',\n      ')},
      "_confidence": 0.95
    }
  ],
  "warnings": []
}`;
}

// Parse file content based on file type
export async function parseFileContent(file: File): Promise<string> {
    const fileType = file.type;
    const fileName = file.name.toLowerCase();

    // CSV files - parse directly
    if (fileType === 'text/csv' || fileName.endsWith('.csv')) {
        return await file.text();
    }

    // Plain text
    if (fileType === 'text/plain' || fileName.endsWith('.txt')) {
        return await file.text();
    }

    // For PDF, DOCX, XLSX - we'll use the file content directly
    // Gemini can process these formats
    // Convert to base64 for Gemini
    const buffer = await file.arrayBuffer();
    const base64 = btoa(
        new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
    );

    return `[BASE64_FILE:${fileType}]${base64}`;
}

// Analyze content with Gemini AI
export async function analyzeWithAI<T>(
    content: string,
    entityType: ImportEntityType
): Promise<ParsedDataResult<T>> {
    try {
        const client = getGeminiClient();
        const model = client.getGenerativeModel({ model: 'gemini-2.5-flash' });

        let result;

        // Check if content is base64 encoded file
        if (content.startsWith('[BASE64_FILE:')) {
            const mimeMatch = content.match(/\[BASE64_FILE:([^\]]+)\]/);
            const mimeType = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
            const base64Data = content.replace(/\[BASE64_FILE:[^\]]+\]/, '');

            // Use multimodal input for files
            const prompt = generatePrompt(entityType, '[Sadržaj datoteke u nastavku]');

            result = await model.generateContent([
                prompt,
                {
                    inlineData: {
                        mimeType,
                        data: base64Data,
                    },
                },
            ]);
        } else {
            // Text content
            const prompt = generatePrompt(entityType, content);
            result = await model.generateContent(prompt);
        }

        const response = result.response;
        const text = response.text();

        // Extract JSON from response
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            return {
                success: false,
                data: [],
                warnings: [],
                errors: ['AI nije vratio validan JSON odgovor'],
            };
        }

        const parsed = JSON.parse(jsonMatch[0]);

        // Validate and clean data
        const config = ENTITY_CONFIGS[entityType];
        const cleanedData = parsed.data.map((item: Record<string, unknown>) => {
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

        return {
            success: true,
            data: cleanedData as (Partial<T> & { _confidence?: number; _warnings?: string[] })[],
            warnings: parsed.warnings || [],
            errors: [],
        };
    } catch (error) {
        console.error('AI analysis error:', error);
        return {
            success: false,
            data: [],
            warnings: [],
            errors: [error instanceof Error ? error.message : 'Greška pri AI analizi'],
        };
    }
}

// Validate data against entity schema
export function validateEntityData<T>(
    data: Partial<T>[],
    entityType: ImportEntityType
): { valid: Partial<T>[]; invalid: { data: Partial<T>; errors: string[] }[] } {
    const config = ENTITY_CONFIGS[entityType];
    const valid: Partial<T>[] = [];
    const invalid: { data: Partial<T>; errors: string[] }[] = [];

    for (const item of data) {
        const errors: string[] = [];
        const record = item as Record<string, unknown>;

        // Check required fields
        for (const field of config.requiredFields) {
            if (record[field] === undefined || record[field] === null || record[field] === '') {
                errors.push(`Nedostaje obavezno polje: ${field}`);
            }
        }

        // Check enum fields
        if (config.enumFields) {
            for (const [field, allowedValues] of Object.entries(config.enumFields)) {
                if (record[field] !== undefined && record[field] !== '') {
                    if (!allowedValues.includes(record[field] as string)) {
                        errors.push(`Nepoznata vrijednost za ${field}: ${record[field]}`);
                    }
                }
            }
        }

        if (errors.length > 0) {
            invalid.push({ data: item, errors });
        } else {
            valid.push(item);
        }
    }

    return { valid, invalid };
}

// Prepare data for saving (remove AI metadata, set defaults)
export function prepareForSave<T>(
    data: (Partial<T> & { _confidence?: number; _warnings?: string[] })[],
    entityType: ImportEntityType,
    additionalData?: Record<string, unknown>
): Partial<T>[] {
    return data.map(item => {
        // Remove AI metadata
        const { _confidence, _warnings, ...cleanItem } = item as Record<string, unknown>;

        // Apply defaults based on entity type
        const prepared = { ...cleanItem } as Record<string, unknown>;

        switch (entityType) {
            case 'materials':
                if (!prepared.Default_Unit_Price) prepared.Default_Unit_Price = 0;
                break;
            case 'products':
                if (!prepared.Height) prepared.Height = 0;
                if (!prepared.Width) prepared.Width = 0;
                if (!prepared.Depth) prepared.Depth = 0;
                if (!prepared.Quantity) prepared.Quantity = 1;
                if (!prepared.Status) prepared.Status = 'Na čekanju';
                if (!prepared.Material_Cost) prepared.Material_Cost = 0;
                if (!prepared.Notes) prepared.Notes = '';
                break;
            case 'workers':
                if (!prepared.Status) prepared.Status = 'Dostupan';
                if (!prepared.Worker_Type) prepared.Worker_Type = 'Glavni';
                break;
            case 'suppliers':
                if (!prepared.Categories) prepared.Categories = '';
                break;
            case 'projects':
                if (!prepared.Status) prepared.Status = 'Nacrt';
                if (!prepared.Created_Date) prepared.Created_Date = new Date().toISOString().split('T')[0];
                break;
        }

        // Merge additional data (like Project_ID for products)
        if (additionalData) {
            Object.assign(prepared, additionalData);
        }

        return prepared as Partial<T>;
    });
}
