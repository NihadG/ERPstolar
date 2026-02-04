import { NextRequest, NextResponse } from 'next/server';
import { SpeechClient } from '@google-cloud/speech';

// Initialize Speech client with credentials from environment
function getSpeechClient(): SpeechClient {
    const credentials = {
        projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
        credentials: {
            client_email: process.env.GOOGLE_CLOUD_CLIENT_EMAIL,
            private_key: process.env.GOOGLE_CLOUD_PRIVATE_KEY?.replace(/\\n/g, '\n'),
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
