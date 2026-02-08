import { NextRequest, NextResponse } from 'next/server';
import { SpeechClient } from '@google-cloud/speech';

// Parse private key - handles various formats from environment variables
function parsePrivateKey(key: string | undefined): string | undefined {
    if (!key) {
        console.error('parsePrivateKey: Key is undefined or empty');
        return undefined;
    }

    // Diagnostic logging (masked)
    const keyStart = key.substring(0, 20);
    const keyEnd = key.substring(key.length - 20);
    console.log(`parsePrivateKey: Input key length: ${key.length}, Starts with: '${keyStart}', Ends with: '${keyEnd}'`);

    let parsed = key;

    // Check if it's base64 encoded (doesn't start with header and doesn't look like JSON)
    if (!key.includes('-----BEGIN PRIVATE KEY-----') && !key.trim().startsWith('{')) {
        try {
            const decoded = Buffer.from(key, 'base64').toString('utf-8');
            if (decoded.includes('-----BEGIN PRIVATE KEY-----')) {
                console.log('parsePrivateKey: Successfully decoded base64 key');
                parsed = decoded;
            }
        } catch (e) {
            // Not a valid base64 or failed to decode
        }
    }

    // Clean up formatting
    if (parsed.includes('\\n')) {
        // Replace escaped newlines (\\n) with actual newlines
        parsed = parsed.replace(/\\n/g, '\n');
        console.log('parsePrivateKey: Replaced escaped newlines');
    }

    // Handle double-escaped newlines (\\\\n)
    if (parsed.includes('\\\\n')) {
        parsed = parsed.replace(/\\\\n/g, '\n');
    }

    // Attempt JSON parse if it looks like a JSON string
    if (parsed.startsWith('"') && parsed.endsWith('"')) {
        try {
            parsed = JSON.parse(parsed);
            console.log('parsePrivateKey: Parsed from JSON string');
        } catch (e) {
            // Ignore parse errors
        }
    }

    // FINAL FIX: Ensure headers are on their own lines if they aren't already
    // This fixes cases where the key is "flattened"
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

    // Verify final result structure
    const hasHeader = parsed.includes('-----BEGIN PRIVATE KEY-----');
    const hasFooter = parsed.includes('-----END PRIVATE KEY-----');
    const newlineCount = (parsed.match(/\n/g) || []).length;

    console.log(`parsePrivateKey: Result validation - Header: ${hasHeader}, Footer: ${hasFooter}, Newlines: ${newlineCount}`);

    return parsed;
}

// Initialize Speech client with credentials from environment
function getSpeechClient(): SpeechClient {
    console.log('getSpeechClient: Initializing Google Cloud Speech Client...');
    console.log('Environment check:', {
        projectId: !!process.env.GOOGLE_CLOUD_PROJECT_ID,
        clientEmail: !!process.env.GOOGLE_CLOUD_CLIENT_EMAIL,
        privateKeyVar: !!process.env.GOOGLE_CLOUD_PRIVATE_KEY,
        privateKeyBase64Var: !!process.env.GOOGLE_CLOUD_PRIVATE_KEY_BASE64
    });

    // Try Base64 specific var first, then the standard one
    const rawKey = process.env.GOOGLE_CLOUD_PRIVATE_KEY_BASE64 || process.env.GOOGLE_CLOUD_PRIVATE_KEY;
    const privateKey = parsePrivateKey(rawKey);

    if (!privateKey) {
        console.error('getSpeechClient: Failed to parse private key!');
    }

    const credentials = {
        projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
        credentials: {
            client_email: process.env.GOOGLE_CLOUD_CLIENT_EMAIL,
            private_key: privateKey,
        },
    };

    return new SpeechClient(credentials);
}

// Max audio size: ~10MB (approximately 60 seconds of WEBM_OPUS at high quality)
const MAX_AUDIO_SIZE_BYTES = 10 * 1024 * 1024;

export async function POST(request: NextRequest) {
    try {
        // Get audio from form data
        const formData = await request.formData();
        const audioFile = formData.get('audio') as Blob | null;

        if (!audioFile) {
            return NextResponse.json(
                { error: 'No audio file provided' },
                { status: 400 }
            );
        }

        // Log audio file details for debugging
        console.log(`Voice transcribe: Received audio file, size: ${audioFile.size} bytes (${(audioFile.size / 1024).toFixed(2)} KB), type: ${audioFile.type}`);

        // Check audio file size before processing
        // Google's sync recognize API is very strict about audio length
        // Lower limit to ~5MB to be safe (roughly 30-40 seconds of WEBM_OPUS)
        if (audioFile.size > MAX_AUDIO_SIZE_BYTES) {
            console.warn(`Audio file too large: ${audioFile.size} bytes (max: ${MAX_AUDIO_SIZE_BYTES})`);
            return NextResponse.json(
                { error: 'Audio je predug. Molimo snimite kraći audio (maksimalno 60 sekundi).' },
                { status: 400 }
            );
        }

        // Convert Blob to base64
        const arrayBuffer = await audioFile.arrayBuffer();
        const audioBytes = Buffer.from(arrayBuffer).toString('base64');
        console.log(`Voice transcribe: Base64 audio length: ${audioBytes.length} characters`);

        // Check if we have required credentials
        if (!process.env.GOOGLE_CLOUD_PROJECT_ID ||
            !process.env.GOOGLE_CLOUD_CLIENT_EMAIL ||
            !process.env.GOOGLE_CLOUD_PRIVATE_KEY) {

            // Fallback: Return a message about missing credentials
            console.warn('Google Cloud credentials not configured. Using mock response.');
            return NextResponse.json({
                text: '[Demo Mode] Google Cloud nije konfigurisan. Molimo postavite GOOGLE_CLOUD_* varijable.',
                confidence: 0,
                isDemo: true
            });
        }

        const client = getSpeechClient();

        // Configure transcription request
        // Note: Browser MediaRecorder outputs webm/opus, but Google API handles it better as OGG_OPUS
        // We also let Google auto-detect the sample rate to avoid mismatches
        const [response] = await client.recognize({
            audio: {
                content: audioBytes,
            },
            config: {
                // Let Google auto-detect the encoding - more reliable for browser-recorded audio
                encoding: 'WEBM_OPUS',
                // Let Google auto-detect sample rate by not specifying it
                // sampleRateHertz: 48000, // Commented out - let API auto-detect
                languageCode: 'hr-HR', // Croatian (covers Bosnian/Serbian too)
                alternativeLanguageCodes: ['sr-RS', 'bs-BA'], // Serbian and Bosnian as fallbacks
                enableAutomaticPunctuation: true,
                model: 'latest_short', // Use 'latest_short' for better handling of short audio
            },
        });

        // Extract transcription
        const transcription = response.results
            ?.map((result: any) => result.alternatives?.[0]?.transcript)
            .filter(Boolean)
            .join(' ') || '';

        const confidence = response.results?.[0]?.alternatives?.[0]?.confidence || 0;

        return NextResponse.json({
            text: transcription,
            confidence: confidence,
            isDemo: false
        });

    } catch (error: any) {
        console.error('Speech-to-Text Error:', error);

        // Handle specific Google Cloud errors
        // Code 3 = INVALID_ARGUMENT (usually audio too long for sync recognize)
        if (error.code === 3 && error.details?.includes('too long')) {
            return NextResponse.json(
                { error: 'Audio je predug. Molimo snimite kraći audio (maksimalno 60 sekundi).' },
                { status: 400 }
            );
        }

        // Code 7 = PERMISSION_DENIED
        if (error.code === 7) {
            return NextResponse.json(
                { error: 'Google Cloud API nije omogućen ili credentials nisu ispravni' },
                { status: 503 }
            );
        }

        return NextResponse.json(
            { error: 'Greška pri transkripciji: ' + (error.message || 'Unknown error') },
            { status: 500 }
        );
    }
}
