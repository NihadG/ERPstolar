// ════════════════════════════════════════════════════════════════════
// TRANSKRIPCIJA NA SERVERU — jedno mjesto za OpenAI poziv.
//
// Koriste je /api/voice-transcribe (diktat u aplikaciji) i Telegram bot
// (glasovna poruka, OGG/Opus). Modeli, rječnik i filter „halucinacija" su
// isti za oba kanala — da bot i aplikacija čuju isto.
// ════════════════════════════════════════════════════════════════════

import { audioExtension, buildTranscriptionPrompt, isLikelyHallucination } from './transcript';

const MAX_AUDIO_SIZE_BYTES = 25 * 1024 * 1024; // limit OpenAI transkripcije
const MIN_AUDIO_SIZE_BYTES = 1500;             // ispod ovoga nema govora (samo zaglavlje)
const TIMEOUT_MS = 30_000;
const FALLBACK_MODEL = 'whisper-1';

// Stručni pojmovi i mjesta za prompt transkripcije. Prava imena (radnici,
// klijenti, dobavljači) šalje pozivalac i idu ISPRED ovoga — opšta lista
// prezimena je izbačena jer je vukla transkript ka imenima kojih nema u firmi.
export const BASE_VOCABULARY = [
    'iverica', 'iveral', 'MDF', 'HDF', 'furnir', 'laminat', 'lesonit', 'medijapan',
    'hrast', 'bukva', 'orah', 'trešnja', 'radna ploča', 'ABS traka', 'kant traka',
    'okovi', 'šarke', 'baglame', 'vodilice', 'ručke', 'tiple', 'vijci', 'Blum', 'Hettich',
    'kuhinja', 'ormar', 'komoda', 'vitrina', 'plakar', 'garderober', 'ogledalo',
    'radni nalog', 'narudžba', 'ponuda', 'montaža', 'ugradnja', 'isporuka', 'mjerenje',
    'rezanje', 'kantovanje', 'bušenje', 'brušenje', 'lakiranje', 'sklapanje', 'CNC',
    'Sarajevo', 'Ilidža', 'Vogošća', 'Hadžići', 'Ilijaš', 'Zenica', 'Tuzla', 'Mostar',
    'Visoko', 'Kakanj', 'Konjic', 'Travnik', 'Bihać', 'Banja Luka',
];

export type TranscribeResult =
    | { ok: true; text: string }
    | { ok: false; status: number; error: string; code?: 'empty' | 'no-speech' };

function primaryModel(): string {
    // gpt-4o-transcribe ima osjetno manje grešaka od whisper-1 na našem jeziku i
    // rjeđe „čuje" rečenice u tišini; whisper-1 ostaje rezerva ako model nije dostupan.
    return process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-transcribe';
}

async function callOpenAI(apiKey: string, model: string, file: File, prompt: string): Promise<Response> {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('model', model);
    fd.append('language', 'hr');
    fd.append('response_format', 'json');
    fd.append('temperature', '0');
    fd.append('prompt', prompt);
    return fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: fd,
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });
}

/**
 * Snimak → tekst. Ne baca: svaka greška se vraća kao `{ ok:false, status,
 * error }` s porukom na bosanskom, spremnom za korisnika.
 */
export async function transcribeAudio(input: {
    buffer: Buffer;
    mime: string;
    /** Imena iz firme (radnici, klijenti, dobavljači) — najvrjedniji dio prompta. */
    names?: string[];
}): Promise<TranscribeResult> {
    const apiKey = process.env.OPENAI_WHISPER_API_KEY;
    const { buffer } = input;

    if (buffer.length > MAX_AUDIO_SIZE_BYTES) {
        return { ok: false, status: 413, error: 'Snimak je predug. Snimite kraći diktat.' };
    }
    if (buffer.length < MIN_AUDIO_SIZE_BYTES) {
        return { ok: false, status: 422, error: 'Snimak je prazan ili prekratak. Pokušajte ponovo.', code: 'empty' };
    }
    if (!apiKey) {
        return { ok: false, status: 503, error: 'Transkripcija nije podešena (nedostaje OpenAI ključ).' };
    }

    // Format se određuje po ekstenziji — Safari snima mp4, Chrome webm, Telegram ogg.
    const mime = input.mime || 'audio/webm';
    const file = new File([new Uint8Array(buffer)], `audio.${audioExtension(mime)}`, { type: mime.split(';')[0] });
    const prompt = buildTranscriptionPrompt((input.names || []).slice(0, 300), BASE_VOCABULARY);
    const primary = primaryModel();

    try {
        let response = await callOpenAI(apiKey, primary, file, prompt);
        if (!response.ok && primary !== FALLBACK_MODEL && response.status !== 401 && response.status !== 429) {
            const err = await response.json().catch(() => ({}));
            console.warn(`Transkripcija: ${primary} vratio ${response.status}, prelazim na ${FALLBACK_MODEL}`, err?.error?.message);
            response = await callOpenAI(apiKey, FALLBACK_MODEL, file, prompt);
        }

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.error('Transcription API error:', response.status, errorData);
            if (response.status === 401) return { ok: false, status: 502, error: 'OpenAI API ključ nije validan.' };
            if (response.status === 429) return { ok: false, status: 429, error: 'Previše zahtjeva. Pokušajte ponovo za nekoliko sekundi.' };
            return { ok: false, status: 502, error: 'Servis za transkripciju nije uspio obraditi snimak.' };
        }

        const result = await response.json();
        const text = String(result.text || '').trim();
        if (isLikelyHallucination(text, prompt)) {
            return { ok: false, status: 422, error: 'Nije prepoznat govor. Govorite bliže mikrofonu i pokušajte ponovo.', code: 'no-speech' };
        }
        return { ok: true, text };
    } catch (error: any) {
        const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
        console.error('Transcription error:', error);
        return timedOut
            ? { ok: false, status: 504, error: 'Transkripcija traje predugo. Pokušajte ponovo.' }
            : { ok: false, status: 500, error: 'Greška pri transkripciji.' };
    }
}
