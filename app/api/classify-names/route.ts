import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { normalizePattern } from '@/lib/classify/patternNormalize';

// ════════════════════════════════════════════════════════════════════
// AI KAO GENERATOR PRAVILA — ne kao klasifikator u letu.
//
// Šalju se SAMO neriješeni DISTINCT nazivi (npr. 40 stringova, ne 2000 naloga),
// a natrag dolaze PRIJEDLOZI PRAVILA koje čovjek potvrđuje. Potvrđeno pravilo
// ide u org_settings i od tada radi deterministički sloj — AI se za taj oblik
// više NIKAD ne zove.
//
// Zašto ovako: ako značenje snapshota zavisi od živog poziva modelu, podatak
// nije reproducibilan. Rebuild bez mreže mora dati identičan rezultat.
// ════════════════════════════════════════════════════════════════════

// Isti model koji koristi parsiranje zadataka (app/api/voice-extract-task)
const MODEL = 'gemini-3.1-flash-lite';
const TIMEOUT_MS = 30_000;
const MAX_NAMES = 60;

export interface ClassifyProposal {
    name: string;         // originalni neprepoznati naziv/token
    typeKey: string;      // ključ postojećeg ili novog tipa
    typeLabel: string;
    isNewType: boolean;
    patterns: string[];   // stemovi za pravilo (već normalizovani za svoju vrstu)
    confidence: number;   // 0..1
    reason: string;
}

function buildPrompt(
    kind: 'product' | 'material',
    names: string[],
    knownTypes: { key: string; label: string }[]
): string {
    const domain = kind === 'product'
        ? 'VRSTE PROIZVODA koje pravi stolarija po mjeri (kuhinje, ormari, komode…)'
        : 'VRSTE MATERIJALA i okova koje stolarija koristi (ploče, furnir, okov, staklo, lakovi…)';

    const examples = kind === 'product'
        ? `- "Biblioteka zidna" → postojeći tip "polica" ako odgovara, inače NOVI tip {key:"biblioteka", label:"Biblioteka"}, pattern "bibliotek"
- "ST15 Sprat" → nije vrsta proizvoda (šifra/lokacija) → skip:true`
        : `- "Oblikovna špera" → tip "sper" (šperploča), pattern "šper"
- "Parsol / Bronza" → tip "staklo" (Parsol je tonirano float staklo), pattern "parsol"
- "Stelujuce nogice - 103323535" → tip "nogice", pattern "nogic"
- "Šarafi 4x40" → NOVI tip {key:"vijci", label:"Vijci"}, pattern "saraf"`;

    return `Ti si pomoćnik u ERP-u za stolariju po mjeri u Bosni i Hercegovini.

ZADATAK: za svaki dolje navedeni naziv odredi kojoj kategoriji pripada — ${domain}.

POSTOJEĆI TIPOVI (koristi ih kad god odgovaraju, umjesto izmišljanja novih):
${knownTypes.map(t => `- ${t.key} = ${t.label}`).join('\n')}

NAZIVI ZA ANALIZU:
${names.map((n, i) => `${i + 1}. ${n}`).join('\n')}

PRAVILA:
1. Vrati "pattern" = KORIJEN RIJEČI (stem) koji će hvatati i druge oblike.
   Primjer: za "komode" pattern je "komod" (hvata komoda, komode, komodu).
   Pattern mora imati bar 3 slova i NE smije biti tako kratak da hvata nevezane riječi.
2. Ako naziv NIJE kategorija nego šifra, broj, ime klijenta, lokacija ili radnja
   (montaža, dostava, popravka) — postavi "skip": true.
3. Ako nijedan postojeći tip ne odgovara, predloži NOVI s kratkim ključem
   (mala slova, bez razmaka, bez dijakritike) i bosanskim nazivom.
4. "confidence" 0.0–1.0: koliko si siguran. Ispod 0.6 znači nagađanje.
5. "reason": jedna kratka rečenica na bosanskom.

PRIMJERI:
${examples}

Vrati ISKLJUČIVO JSON niz, bez ikakvog teksta okolo:
[
  {"name":"<originalni naziv>","skip":false,"typeKey":"...","typeLabel":"...","isNewType":false,"pattern":"...","confidence":0.9,"reason":"..."}
]`;
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json() as {
            kind?: 'product' | 'material';
            names?: string[];
            knownTypes?: { key: string; label: string }[];
        };

        const kind = body.kind === 'material' ? 'material' : 'product';
        const names = Array.from(new Set((body.names || []).map(n => String(n || '').trim()).filter(Boolean)));
        const knownTypes = (body.knownTypes || []).filter(t => t?.key && t?.label);

        if (names.length === 0) {
            return NextResponse.json({ proposals: [] });
        }
        if (names.length > MAX_NAMES) {
            return NextResponse.json(
                { error: `Previše naziva odjednom (${names.length}). Maksimum je ${MAX_NAMES}.` },
                { status: 400 }
            );
        }

        const apiKey = process.env.GOOGLE_GEMINI_API_KEY
            || process.env.GEMINI_API_KEY
            || process.env.NEXT_PUBLIC_GEMINI_API_KEY;
        if (!apiKey) {
            return NextResponse.json({ error: 'Gemini API ključ nije podešen' }, { status: 503 });
        }

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: MODEL });

        const result = await Promise.race([
            model.generateContent(buildPrompt(kind, names, knownTypes)),
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)),
        ]);

        const text = (await result.response).text()
            .replace(/```json\n?/g, '')
            .replace(/```\n?/g, '')
            .trim();

        let raw: unknown;
        try {
            raw = JSON.parse(text);
        } catch {
            console.error('[classify-names] Neispravan JSON od modela:', text.slice(0, 400));
            return NextResponse.json({ error: 'Model je vratio neispravan odgovor' }, { status: 502 });
        }
        if (!Array.isArray(raw)) {
            return NextResponse.json({ error: 'Model je vratio neočekivan oblik' }, { status: 502 });
        }

        // Odgovor modela je PODATAK, ne naredba: strogo se validira i normalizuje.
        const known = new Set(knownTypes.map(t => t.key));
        const proposals: ClassifyProposal[] = [];
        for (const r of raw as Record<string, unknown>[]) {
            if (!r || r.skip === true) continue;
            const name = String(r.name || '').trim();
            const typeKey = String(r.typeKey || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
            const pattern = String(r.pattern || '').trim();
            if (!name || !typeKey || !pattern) continue;
            if (!names.includes(name)) continue;              // model ne smije izmišljati nazive

            const patterns = normalizePattern(pattern, kind);
            if (patterns.length === 0) continue;              // prekratak pattern → odbaci

            const conf = Number(r.confidence);
            proposals.push({
                name,
                typeKey,
                typeLabel: String(r.typeLabel || typeKey).trim().slice(0, 60),
                isNewType: !known.has(typeKey),
                patterns,
                confidence: isFinite(conf) ? Math.max(0, Math.min(1, conf)) : 0.5,
                reason: String(r.reason || '').trim().slice(0, 200),
            });
        }

        proposals.sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name, 'hr'));
        return NextResponse.json({ proposals, model: MODEL });
    } catch (error) {
        const msg = error instanceof Error && error.message === 'timeout'
            ? 'Model nije odgovorio na vrijeme'
            : 'Greška pri analizi naziva';
        console.error('[classify-names]', error);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
