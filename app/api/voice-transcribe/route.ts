import { NextRequest, NextResponse } from 'next/server';
import { audioExtension, buildTranscriptionPrompt, isLikelyHallucination } from '@/lib/voice/transcript';

export const runtime = 'nodejs';

const OPENAI_API_KEY = process.env.OPENAI_WHISPER_API_KEY;
const MAX_AUDIO_SIZE_BYTES = 25 * 1024 * 1024; // limit OpenAI transkripcije
const MIN_AUDIO_SIZE_BYTES = 1500;             // ispod ovoga nema govora (samo zaglavlje)
const TIMEOUT_MS = 30_000;
// gpt-4o-transcribe ima osjetno manje grešaka od whisper-1 na našem jeziku i
// rjeđe „čuje" rečenice u tišini; whisper-1 ostaje rezerva ako model nije dostupan.
const PRIMARY_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-transcribe';
const FALLBACK_MODEL = 'whisper-1';

// Stručni pojmovi i mjesta za prompt transkripcije. Prava imena (radnici,
// klijenti, dobavljači) šalje klijent i idu ISPRED ovoga — opšta lista
// prezimena je izbačena jer je vukla transkript ka imenima kojih nema u firmi.
const BASE_VOCABULARY = [
    'iverica', 'iveral', 'MDF', 'HDF', 'furnir', 'laminat', 'lesonit', 'medijapan',
    'hrast', 'bukva', 'orah', 'trešnja', 'radna ploča', 'ABS traka', 'kant traka',
    'okovi', 'šarke', 'vodilice', 'ručke', 'tiple', 'vijci', 'Blum', 'Hettich',
    'kuhinja', 'ormar', 'komoda', 'vitrina', 'plakar', 'garderober',
    'radni nalog', 'narudžba', 'ponuda', 'montaža', 'ugradnja', 'isporuka', 'mjerenje',
    'rezanje', 'kantovanje', 'bušenje', 'brušenje', 'lakiranje', 'sklapanje', 'CNC',
    'Sarajevo', 'Ilidža', 'Vogošća', 'Hadžići', 'Ilijaš', 'Zenica', 'Tuzla', 'Mostar',
    'Visoko', 'Kakanj', 'Konjic', 'Travnik', 'Bihać', 'Banja Luka',
];

async function transcribe(model: string, file: File, prompt: string): Promise<Response> {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('model', model);
    fd.append('language', 'hr');
    fd.append('response_format', 'json');
    fd.append('temperature', '0');
    fd.append('prompt', prompt);
    return fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
        body: fd,
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });
}

export async function POST(request: NextRequest) {
    try {
        const formData = await request.formData();
        const audioFile = formData.get('audio');
        const contextHint = formData.get('contextHint');

        if (!audioFile || typeof audioFile === 'string') {
            return NextResponse.json({ error: 'Snimak nije poslan.' }, { status: 400 });
        }
        if (audioFile.size > MAX_AUDIO_SIZE_BYTES) {
            return NextResponse.json({ error: 'Snimak je predug. Snimite kraći diktat.' }, { status: 413 });
        }
        if (audioFile.size < MIN_AUDIO_SIZE_BYTES) {
            return NextResponse.json({ error: 'Snimak je prazan ili prekratak. Pokušajte ponovo.', code: 'empty' }, { status: 422 });
        }
        if (!OPENAI_API_KEY) {
            return NextResponse.json({ error: 'Transkripcija nije podešena (nedostaje OpenAI ključ).' }, { status: 503 });
        }

        // Format se određuje po ekstenziji — Safari snima mp4, Chrome webm.
        // Prije je sve išlo kao audio.webm, pa je mp4 sa iPhonea znao pasti.
        const mime = audioFile.type || 'audio/webm';
        const buffer = Buffer.from(await audioFile.arrayBuffer());
        const file = new File([buffer], `audio.${audioExtension(mime)}`, { type: mime.split(';')[0] });

        let names: string[] = [];
        if (typeof contextHint === 'string' && contextHint.trim()) {
            try {
                const parsed = JSON.parse(contextHint);
                if (Array.isArray(parsed)) names = parsed.filter((n): n is string => typeof n === 'string');
            } catch {
                names = contextHint.split(',');
            }
        }
        const prompt = buildTranscriptionPrompt(names.slice(0, 300), BASE_VOCABULARY);

        let response = await transcribe(PRIMARY_MODEL, file, prompt);
        if (!response.ok && PRIMARY_MODEL !== FALLBACK_MODEL && response.status !== 401 && response.status !== 429) {
            const err = await response.json().catch(() => ({}));
            console.warn(`Transkripcija: ${PRIMARY_MODEL} vratio ${response.status}, prelazim na ${FALLBACK_MODEL}`, err?.error?.message);
            response = await transcribe(FALLBACK_MODEL, file, prompt);
        }

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.error('Transcription API error:', response.status, errorData);
            if (response.status === 401) {
                return NextResponse.json({ error: 'OpenAI API ključ nije validan.' }, { status: 502 });
            }
            if (response.status === 429) {
                return NextResponse.json({ error: 'Previše zahtjeva. Pokušajte ponovo za nekoliko sekundi.' }, { status: 429 });
            }
            return NextResponse.json({ error: 'Servis za transkripciju nije uspio obraditi snimak.' }, { status: 502 });
        }

        const result = await response.json();
        const text = String(result.text || '').trim();

        if (isLikelyHallucination(text, prompt)) {
            return NextResponse.json({ error: 'Nije prepoznat govor. Govorite bliže mikrofonu i pokušajte ponovo.', code: 'no-speech' }, { status: 422 });
        }

        return NextResponse.json({ text });
    } catch (error: any) {
        const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
        console.error('Transcription error:', error);
        return NextResponse.json(
            { error: timedOut ? 'Transkripcija traje predugo. Pokušajte ponovo.' : 'Greška pri transkripciji.' },
            { status: timedOut ? 504 : 500 },
        );
    }
}
