import { NextRequest, NextResponse } from 'next/server';
import { SpeechClient } from '@google-cloud/speech';

// Parse private key - handles various formats from environment variables
function parsePrivateKey(key: string | undefined): string | undefined {
    if (!key) {
        console.warn('[Voice API] Private key is missing');
        return undefined;
    }

    // Log key metadata for debugging (length and start/end)
    const keyPreview = key.length > 20 ? `${key.substring(0, 10)}...${key.substring(key.length - 10)}` : key;
    console.log(`[Voice API] Parsing key (len=${key.length}): ${keyPreview}`);

    // Check if it's base64 encoded (doesn't start with header)
    if (!key.includes('-----BEGIN PRIVATE KEY-----')) {
        try {
            const decoded = Buffer.from(key, 'base64').toString('utf-8');
            if (decoded.includes('-----BEGIN PRIVATE KEY-----')) {
                console.log('[Voice API] Successfully decoded base64 key');
                return decoded;
            }
        } catch (e) {
            // Not a valid base64 or failed to decode, continue to other checks
        }
    }

    let parsed = key;

    // If it was JSON-stringified (starts with quotes), try to parse first
    // This handles cases where the env var is literally '"-----BEGIN..."'
    if (parsed.startsWith('"') && parsed.endsWith('"')) {
        try {
            parsed = JSON.parse(parsed);
            console.log('[Voice API] Successfully parsed JSON-stringified key');
        } catch (e) {
            // If JSON parse fails, it might be because newlines are already real newlines
            // Just strip the quotes manually
            console.log('[Voice API] JSON parse failed, manually stripping quotes');
            parsed = parsed.slice(1, -1);
        }
    }

    // Replace escaped newlines (\\n) with actual newlines
    if (parsed.includes('\\n')) {
        parsed = parsed.replace(/\\n/g, '\n');
        console.log('[Voice API] Replaced escaped newlines');
    }

    // Handle double-escaped newlines (\\\\n) just in case
    if (parsed.includes('\\\\n')) {
        parsed = parsed.replace(/\\\\n/g, '\n');
        console.log('[Voice API] Replaced double-escaped newlines');
    }

    // Final check for valid format
    if (!parsed.includes('-----BEGIN PRIVATE KEY-----')) {
        console.warn('[Voice API] Warning: Key does not look like a valid PEM key after parsing');
    } else {
        console.log('[Voice API] Key appears to be correctly formatted PEM');
    }

    return parsed;
}

// Initialize Speech client with credentials from environment
function getSpeechClient(): SpeechClient {
    console.log('[Voice API] Initializing Speech Client...');
    console.log('[Voice API] Project ID:', process.env.GOOGLE_CLOUD_PROJECT_ID);
    console.log('[Voice API] Client Email:', process.env.GOOGLE_CLOUD_CLIENT_EMAIL);

    // Try Base64 specific var first, then the standard one
    const rawKey = process.env.GOOGLE_CLOUD_PRIVATE_KEY_BASE64 || process.env.GOOGLE_CLOUD_PRIVATE_KEY;
    console.log(`[Voice API] Raw key source: ${process.env.GOOGLE_CLOUD_PRIVATE_KEY_BASE64 ? 'BASE64_VAR' : 'STANDARD_VAR'}`);

    const privateKey = parsePrivateKey(rawKey);

    const credentials = {
        projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
        credentials: {
            client_email: process.env.GOOGLE_CLOUD_CLIENT_EMAIL,
            private_key: privateKey,
        },
    };

    return new SpeechClient(credentials);
}

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

        // Convert Blob to base64
        const arrayBuffer = await audioFile.arrayBuffer();
        const audioBytes = Buffer.from(arrayBuffer).toString('base64');

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
        const [response] = await client.recognize({
            audio: {
                content: audioBytes,
            },
            config: {
                encoding: 'WEBM_OPUS', // Browser typically records in webm
                sampleRateHertz: 48000,
                languageCode: 'hr-HR', // Croatian (covers Bosnian/Serbian too)
                alternativeLanguageCodes: ['sr-RS'], // Serbian as fallback
                enableAutomaticPunctuation: true,
                model: 'default',
            },
        });

        // Extract transcription
        const transcription = response.results
            ?.map(result => result.alternatives?.[0]?.transcript)
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
