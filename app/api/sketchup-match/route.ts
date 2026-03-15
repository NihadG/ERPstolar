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

    const prompt = `Ti si AI za stolarsku ERP aplikaciju. Moraš povezati kalkulirane stavke sa materijalima iz baze.

KALKULIRANE STAVKE (iz SketchUp importa):
${itemList}

MATERIJALI U BAZI:
${materialList}

PRAVILA:
1. Za svaku stavku pronađi NAJBOLJI match iz baze na osnovu naziva i koda materijala (npr. U732, U999, Hrast)
2. "MDF 18" treba matchati na MDF ploču debljine 18mm
3. "Furnir / Hrast" treba matchati na furnir hrast materijal
4. "Kant traka" treba matchati na kant traku SA ISTIM KODOM kao i ploča (npr. ako je ploča U732, kant traka je Kant U732)
5. "Lakiranje" ili "Farbanje" treba matchati na uslugu farbanja/lakiranja
6. "HPL / U999" treba matchati na HPL materijal sa kodom U999
7. Ako nema dobrog matcha, koristi prazan string ""

Vrati SAMO JSON objekat gdje je ključ INDEKS stavke (string), a vrijednost Material_ID iz baze:
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
