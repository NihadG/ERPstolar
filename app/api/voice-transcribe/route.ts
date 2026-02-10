import { NextRequest, NextResponse } from 'next/server';

const OPENAI_API_KEY = process.env.OPENAI_WHISPER_API_KEY;
const MAX_AUDIO_SIZE_BYTES = 25 * 1024 * 1024; // Whisper supports up to 25MB

// Domain vocabulary for Whisper prompt — dramatically improves recognition of
// proper nouns, industry terms, and Bosnian/Croatian names/places.
const BASE_VOCABULARY = [
    // Furniture & woodworking
    'stolarska radionica', 'namještaj', 'kuhinja', 'ormar', 'komode', 'vitrina',
    'radna ploča', 'iverica', 'MDF', 'furnir', 'laminat', 'pal', 'lesonit',
    'iveral', 'drvo', 'hrast', 'bukva', 'orah', 'trešnja',
    'ABS traka', 'okovi', 'šarke', 'vodilice', 'ručke', 'tipla', 'vijci',
    'lijepilo', 'lak', 'boja', 'silikon',
    // Production
    'proizvodnja', 'radni nalog', 'montaža', 'isporuka', 'ugradnja',
    'instalacija', 'transport', 'mjerenje', 'rezanje', 'kantovanje',
    'bušenje', 'brušenje', 'lakiranje', 'sklapanje',
    // Business
    'narudžba', 'narudžbe', 'ponuda', 'klijent', 'kupac', 'dobavljač',
    'materijal', 'faktura', 'račun', 'avans', 'uplata', 'rok',
    'projekt', 'projekat',
    // Bosnian/Croatian common names
    'Petrović', 'Hodžić', 'Begović', 'Mehmedović', 'Hadžić', 'Kovačević',
    'Bašić', 'Delić', 'Mujić', 'Ibrahimović', 'Šehić', 'Čaušević',
    'Džananović', 'Hasanović', 'Ahmetović', 'Spahić', 'Omerović',
    // Cities
    'Sarajevo', 'Mostar', 'Tuzla', 'Zenica', 'Banja Luka', 'Bijeljina',
    'Brčko', 'Cazin', 'Bihać', 'Travnik', 'Livno', 'Goražde',
    'Trebinje', 'Doboj', 'Visoko', 'Kakanj', 'Konjic', 'Jablanica',
    'Bugojno', 'Gračanica', 'Lukavac', 'Gradačac', 'Sanski Most',
    'Velika Kladuša', 'Ilidža', 'Vogošća', 'Hadžići', 'Ilijaš',
].join(', ');

export async function POST(request: NextRequest) {
    try {
        const formData = await request.formData();
        const audioFile = formData.get('audio') as Blob | null;
        const contextHint = formData.get('contextHint') as string | null;

        if (!audioFile) {
            return NextResponse.json({ error: 'No audio file provided' }, { status: 400 });
        }

        console.log(`Voice transcribe (Whisper): Received audio file, size: ${audioFile.size} bytes (${(audioFile.size / 1024).toFixed(2)} KB), type: ${audioFile.type}`);

        if (audioFile.size > MAX_AUDIO_SIZE_BYTES) {
            console.warn(`Audio file too large: ${audioFile.size} bytes`);
            return NextResponse.json(
                { error: 'Audio je predug. Molimo snimite kraći audio (maksimalno 25MB).' },
                { status: 400 }
            );
        }

        if (!OPENAI_API_KEY) {
            console.warn('OpenAI Whisper API key not configured.');
            return NextResponse.json({
                text: '[Demo Mode] OpenAI Whisper API nije konfigurisan.',
                confidence: 0,
                isDemo: true
            });
        }

        // Get the audio data as a File object for OpenAI
        const arrayBuffer = await audioFile.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const file = new File([buffer], 'audio.webm', { type: 'audio/webm' });

        // Build prompt: base vocabulary + dynamic context (client names, cities, suppliers)
        let whisperPrompt = BASE_VOCABULARY;
        if (contextHint) {
            // Append dynamic names so Whisper knows about them
            whisperPrompt = `${contextHint}, ${whisperPrompt}`;
        }
        // Whisper prompt is limited to ~224 tokens, keep it reasonable
        if (whisperPrompt.length > 800) {
            whisperPrompt = whisperPrompt.substring(0, 800);
        }

        // Create form data for OpenAI Whisper API
        const whisperFormData = new FormData();
        whisperFormData.append('file', file);
        whisperFormData.append('model', 'whisper-1');
        whisperFormData.append('language', 'hr'); // Croatian
        whisperFormData.append('response_format', 'json');
        whisperFormData.append('prompt', whisperPrompt);

        console.log('Voice transcribe (Whisper): Sending to OpenAI Whisper API...');
        console.log(`Voice transcribe: Prompt length: ${whisperPrompt.length} chars`);

        const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${OPENAI_API_KEY}`,
            },
            body: whisperFormData,
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.error('Whisper API error:', response.status, errorData);

            if (response.status === 401) {
                return NextResponse.json(
                    { error: 'OpenAI API ključ nije validan.' },
                    { status: 401 }
                );
            }
            if (response.status === 429) {
                return NextResponse.json(
                    { error: 'Previše zahtjeva. Pokušajte ponovo za nekoliko sekundi.' },
                    { status: 429 }
                );
            }

            throw new Error(errorData.error?.message || 'Whisper API error');
        }

        const whisperResult = await response.json();
        const transcription = whisperResult.text || '';

        console.log(`Voice transcribe (Whisper): Transcription complete, length: ${transcription.length}`);
        console.log(`Voice transcribe (Whisper): Transcription text: "${transcription}"`);

        return NextResponse.json({
            text: transcription,
            confidence: 1.0,
            isDemo: false
        });

    } catch (error: any) {
        console.error('Whisper Transcription Error:', error);

        return NextResponse.json(
            { error: 'Greška pri transkripciji: ' + (error.message || 'Unknown error') },
            { status: 500 }
        );
    }
}
