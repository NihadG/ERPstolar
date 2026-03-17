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

STRIKTNA PRAVILA MATCHIRANJA:
1. MATERIJAL U BAZI MORA SADRŽAVATI KLJUČNU RIJEČ TIPA u svom nazivu:
   - Za HPL stavke → materijal MORA imati "HPL" u nazivu (ne radna ploča, ne laminat bez "HPL")
   - Za furnir stavke → materijal MORA imati "furnir" u nazivu
   - Za iveral/ploče → materijal MORA imati "iveral", "MDF", "DTD" ili "PAL" u nazivu
   - Za kant trake → materijal MORA imati "kant", "KT" ili "traka" u nazivu
   - Za lakiranje → traži materijal koji se zove "Lakiranje" ili sadrži "farbanje"/"bojenje"
   - "KT" na početku naziva UVIJEK znači kant traku (edge banding), NIKADA ploču
2. KODOVI materijala (U732, H3309, W1000) su sekundarni signal — koristi ih samo AKO je tip materijala već ispravno matchiran.
3. AKO materijal sa ispravnim tipom I kodom NE POSTOJI u bazi — vrati PRAZAN STRING "". NIKADA ne dodijeli materijal pogrešnog tipa.
4. Radna ploča NIJE HPL. Staklo/lakobel NIJE lakiranje. Vodilice/okovi NISU farbanje.
5. Bolje je ostaviti prazno nego dodijeliti pogrešan materijal.

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
