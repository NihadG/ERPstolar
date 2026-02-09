import { NextRequest, NextResponse } from 'next/server';

const OPENAI_API_KEY = process.env.OPENAI_WHISPER_API_KEY;
const MAX_AUDIO_SIZE_BYTES = 25 * 1024 * 1024; // Whisper supports up to 25MB

export async function POST(request: NextRequest) {
    try {
        const formData = await request.formData();
        const audioFile = formData.get('audio') as Blob | null;

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

        // Create a File-like object for the API
        const file = new File([buffer], 'audio.webm', { type: 'audio/webm' });

        // Create form data for OpenAI Whisper API
        const whisperFormData = new FormData();
        whisperFormData.append('file', file);
        whisperFormData.append('model', 'whisper-1');
        whisperFormData.append('language', 'hr'); // Croatian
        whisperFormData.append('response_format', 'json');

        console.log('Voice transcribe (Whisper): Sending to OpenAI Whisper API...');

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
            confidence: 1.0, // Whisper doesn't return confidence, assume high
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
