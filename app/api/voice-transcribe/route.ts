import { NextRequest, NextResponse } from 'next/server';
import { SpeechClient, protos } from '@google-cloud/speech';

// Parse private key - handles various formats from environment variables
function parsePrivateKey(key: string | undefined): string | undefined {
    if (!key) {
        console.error('parsePrivateKey: Key is undefined or empty');
        return undefined;
    }

    const keyStart = key.substring(0, 20);
    const keyEnd = key.substring(key.length - 20);
    console.log(`parsePrivateKey: Input key length: ${key.length}, Starts with: '${keyStart}', Ends with: '${keyEnd}'`);

    let parsed = key;

    // Check if it's base64 encoded
    if (!key.includes('-----BEGIN PRIVATE KEY-----') && !key.trim().startsWith('{')) {
        try {
            const decoded = Buffer.from(key, 'base64').toString('utf-8');
            if (decoded.includes('-----BEGIN PRIVATE KEY-----')) {
                console.log('parsePrivateKey: Successfully decoded base64 key');
                parsed = decoded;
            }
        } catch (e) {
            // Not valid base64
        }
    }

    // Clean up formatting
    if (parsed.includes('\\n')) {
        parsed = parsed.replace(/\\n/g, '\n');
        console.log('parsePrivateKey: Replaced escaped newlines');
    }

    if (parsed.includes('\\\\n')) {
        parsed = parsed.replace(/\\\\n/g, '\n');
    }

    // JSON parse if needed
    if (parsed.startsWith('"') && parsed.endsWith('"')) {
        try {
            parsed = JSON.parse(parsed);
            console.log('parsePrivateKey: Parsed from JSON string');
        } catch (e) { }
    }

    // Ensure headers are on their own lines
    if (parsed.includes('-----BEGIN PRIVATE KEY-----')) {
        const header = '-----BEGIN PRIVATE KEY-----';
        const footer = '-----END PRIVATE KEY-----';
        if (!parsed.includes(header + '\n')) {
            parsed = parsed.replace(header, header + '\n');
        }
        if (!parsed.includes('\n' + footer)) {
            parsed = parsed.replace(footer, '\n' + footer);
        }
    }

    const hasHeader = parsed.includes('-----BEGIN PRIVATE KEY-----');
    const hasFooter = parsed.includes('-----END PRIVATE KEY-----');
    const newlineCount = (parsed.match(/\n/g) || []).length;
    console.log(`parsePrivateKey: Result validation - Header: ${hasHeader}, Footer: ${hasFooter}, Newlines: ${newlineCount}`);

    return parsed;
}

// Singleton Speech client
let speechClient: SpeechClient | null = null;

function getSpeechClient(): SpeechClient {
    if (speechClient) return speechClient;

    console.log('getSpeechClient: Initializing Google Cloud Speech Client...');
    console.log('Environment check:', {
        projectId: !!process.env.GOOGLE_CLOUD_PROJECT_ID,
        clientEmail: !!process.env.GOOGLE_CLOUD_CLIENT_EMAIL,
        privateKeyVar: !!process.env.GOOGLE_CLOUD_PRIVATE_KEY,
        privateKeyBase64Var: !!process.env.GOOGLE_CLOUD_PRIVATE_KEY_BASE64
    });

    const rawKey = process.env.GOOGLE_CLOUD_PRIVATE_KEY_BASE64 || process.env.GOOGLE_CLOUD_PRIVATE_KEY;
    const privateKey = parsePrivateKey(rawKey);

    if (!privateKey) {
        console.error('getSpeechClient: Failed to parse private key!');
    }

    speechClient = new SpeechClient({
        projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
        credentials: {
            client_email: process.env.GOOGLE_CLOUD_CLIENT_EMAIL,
            private_key: privateKey,
        },
    });

    return speechClient;
}

const MAX_AUDIO_SIZE_BYTES = 10 * 1024 * 1024;

export async function POST(request: NextRequest) {
    try {
        const formData = await request.formData();
        const audioFile = formData.get('audio') as Blob | null;

        if (!audioFile) {
            return NextResponse.json({ error: 'No audio file provided' }, { status: 400 });
        }

        console.log(`Voice transcribe: Received audio file, size: ${audioFile.size} bytes (${(audioFile.size / 1024).toFixed(2)} KB), type: ${audioFile.type}`);

        if (audioFile.size > MAX_AUDIO_SIZE_BYTES) {
            console.warn(`Audio file too large: ${audioFile.size} bytes`);
            return NextResponse.json(
                { error: 'Audio je predug. Molimo snimite kraći audio (maksimalno 60 sekundi).' },
                { status: 400 }
            );
        }

        if (!process.env.GOOGLE_CLOUD_PROJECT_ID ||
            !process.env.GOOGLE_CLOUD_CLIENT_EMAIL ||
            !process.env.GOOGLE_CLOUD_PRIVATE_KEY) {
            console.warn('Google Cloud credentials not configured.');
            return NextResponse.json({
                text: '[Demo Mode] Google Cloud nije konfigurisan.',
                confidence: 0,
                isDemo: true
            });
        }

        const arrayBuffer = await audioFile.arrayBuffer();
        const audioBytes = Buffer.from(arrayBuffer).toString('base64');

        console.log(`Voice transcribe: Audio base64 length: ${audioBytes.length} chars`);

        const client = getSpeechClient();

        // Use longRunningRecognize for better handling of audio
        // This works with inline content and doesn't have duration detection issues
        const recognitionConfig: protos.google.cloud.speech.v1.IRecognitionConfig = {
            encoding: 'WEBM_OPUS' as any,
            sampleRateHertz: 48000,
            audioChannelCount: 1,
            languageCode: 'hr-HR',
            alternativeLanguageCodes: ['sr-RS', 'bs-BA'],
            enableAutomaticPunctuation: true,
            model: 'default', // latest_long not supported for hr-HR
        };

        const audio: protos.google.cloud.speech.v1.IRecognitionAudio = {
            content: audioBytes,
        };

        console.log('Voice transcribe: Starting longRunningRecognize...');

        // longRunningRecognize returns an operation that we need to wait for
        const [operation] = await client.longRunningRecognize({
            config: recognitionConfig,
            audio: audio,
        });

        console.log('Voice transcribe: Waiting for operation to complete...');

        // Wait for the operation to complete (with timeout)
        const [response] = await operation.promise();

        console.log('Voice transcribe: Operation complete, processing results...');

        // Extract transcription from results
        let transcription = '';
        let confidence = 0;

        if (response.results) {
            for (const result of response.results) {
                if (result.alternatives && result.alternatives.length > 0) {
                    const alternative = result.alternatives[0];
                    if (alternative.transcript) {
                        transcription += (transcription ? ' ' : '') + alternative.transcript;
                    }
                    if (alternative.confidence && alternative.confidence > confidence) {
                        confidence = alternative.confidence;
                    }
                }
            }
        }

        console.log(`Voice transcribe: Transcription complete, length: ${transcription.length}`);
        console.log(`Voice transcribe: Transcription text: "${transcription}"`);

        return NextResponse.json({
            text: transcription,
            confidence: confidence,
            isDemo: false
        });

    } catch (error: any) {
        console.error('Speech-to-Text Error:', error);

        // Handle specific error codes
        if (error.code === 3) {
            // INVALID_ARGUMENT - could be audio format or duration issue
            if (error.message?.includes('too long') || error.details?.includes('too long')) {
                return NextResponse.json(
                    { error: 'Audio je predug. Molimo snimite kraći audio (maksimalno 60 sekundi).' },
                    { status: 400 }
                );
            }
            return NextResponse.json(
                { error: 'Problem s audio formatom. Pokušajte ponovo.' },
                { status: 400 }
            );
        }

        if (error.code === 7) {
            return NextResponse.json(
                { error: 'Google Cloud API nije omogućen ili credentials nisu ispravni' },
                { status: 503 }
            );
        }

        if (error.code === 4) {
            // DEADLINE_EXCEEDED
            return NextResponse.json(
                { error: 'Transkripcija je trajala predugo. Pokušajte s kraćim audiom.' },
                { status: 408 }
            );
        }

        return NextResponse.json(
            { error: 'Greška pri transkripciji: ' + (error.message || 'Unknown error') },
            { status: 500 }
        );
    }
}
