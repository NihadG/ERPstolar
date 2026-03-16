import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

export async function POST(request: NextRequest) {
  try {
    const { outputItems, dbMaterials } = await request.json();

    const apiKey = process.env.GOOGLE_GEMINI_API_KEY || process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ success: false, error: 'Gemini API key not configured' }, { status: 500 });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const materialList = dbMaterials
      .map((m: { Material_ID: string; Name: string; Category: string; Unit: string }) =>
        `- ID:"${m.Material_ID}" Naziv:"${m.Name}" Kategorija:"${m.Category}" Jedinica:"${m.Unit}"`)
      .join('\n');

    const itemList = outputItems
      .map((oi: { label: string; category: string; unit: string }, i: number) =>
        `${i}. "${oi.label}" (${oi.category}, ${oi.unit})`)
      .join('\n');

    const prompt = `Ti si AI asistent za stolarsku ERP aplikaciju. Tvoj zadatak je da povežeš kalkulirane stavke materijala sa materijalima iz baze podataka.

KALKULIRANE STAVKE (iz SketchUp importa):
${itemList}

MATERIJALI U BAZI:
${materialList}

PRAVILA MATCHIRANJA (po prioritetu):
1. KODOVI MATERIJALA su najvažniji signal za matching. Kodovi su alfanumerički (npr. U732, H3309, W1000, ST9, F501). Ako stavka i materijal iz baze dijele ISTI KOD, to je gotovo siguran match.
2. Za PLO ČE: matchaj po tipu (MDF/Iveral/DTD/PAL) + debljina (npr. 18mm) + kodu materijala. Primjer: "MDF 18 / U732" → materijal koji sadrži "MDF", "18" i "U732".
3. Za KANT TRAKE: matchaj kant traku koja ima ISTI KOD kao pripadajuća ploča u istoj grupi. Primjer: ako je ploča "Iveral U732", kant traka je "Kant U732" ili "ABS traka U732".
4. Za FURNIR/HPL: matchaj po tipu + kodu. Primjer: "Furnir / Hrast" → materijal sa "furnir" i "hrast".
5. Za FARBANJE/LAKIRANJE: matchaj na materijal sa riječima "farbanje", "lakiranje" ili "bojenje".
6. Ako nema pouzdanog matcha, koristi prazan string "". NIKADA ne dodijeli pogrešan materijal — bolje je ostaviti prazno.

Vrati SAMO JSON objekat (bez objašnjenja) gdje je ključ INDEKS stavke (string), a vrijednost Material_ID iz baze:
{"0": "material-id-123", "1": "", "2": "material-id-456"}`;

    const result = await Promise.race([
      model.generateContent(prompt),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timeout')), 30000))
    ]);

    const text = result.response.text();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ success: true, matches: {} });
    }

    const matches = JSON.parse(jsonMatch[0]);
    return NextResponse.json({ success: true, matches });
  } catch (error) {
    console.error('[sketchup-match] Error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Greška',
      matches: {},
    }, { status: 500 });
  }
}
