import { NextRequest, NextResponse } from 'next/server';
import { SpeechClient, protos } from '@google-cloud/speech';

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
        parsed = parsed.replace(/\\n/g, '\n');
        console.log('parsePrivateKey: Replaced escaped newlines');
    }

    // Handle double-escaped newlines
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
    if (speechClient) {
        return speechClient;
    }

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

    const credentials = {
        projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
        credentials: {
            client_email: process.env.GOOGLE_CLOUD_CLIENT_EMAIL,
            private_key: privateKey,
        },
    };

    speechClient = new SpeechClient(credentials);
    return speechClient;
}

const MAX_AUDIO_SIZE_BYTES = 10 * 1024 * 1024;

export async function POST(request: NextRequest) {
    try {
        const formData = await request.formData();
        const audioFile = formData.get('audio') as Blob | null;

        if (!audioFile) {
            return NextResponse.json(
                { error: 'No audio file provided' },
                { status: 400 }
            );
        }

        console.log(`Voice transcribe: Received audio file, size: ${audioFile.size} bytes (${(audioFile.size / 1024).toFixed(2)} KB), type: ${audioFile.type}`);

        if (audioFile.size > MAX_AUDIO_SIZE_BYTES) {
            console.warn(`Audio file too large: ${audioFile.size} bytes (max: ${MAX_AUDIO_SIZE_BYTES})`);
            return NextResponse.json(
                { error: 'Audio je predug. Molimo snimite kraći audio (maksimalno 60 sekundi).' },
                { status: 400 }
            );
        }

        if (!process.env.GOOGLE_CLOUD_PROJECT_ID ||
            !process.env.GOOGLE_CLOUD_CLIENT_EMAIL ||
            !process.env.GOOGLE_CLOUD_PRIVATE_KEY) {

            console.warn('Google Cloud credentials not configured. Using mock response.');
            return NextResponse.json({
                text: '[Demo Mode] Google Cloud nije konfigurisan. Molimo postavite GOOGLE_CLOUD_* varijable.',
                confidence: 0,
                isDemo: true
            });
        }

        const arrayBuffer = await audioFile.arrayBuffer();
        const audioBuffer = Buffer.from(arrayBuffer);

        console.log(`Voice transcribe: Audio buffer size: ${audioBuffer.length} bytes`);

        const client = getSpeechClient();

        // Use streaming recognition with proper message ordering
        const transcription = await streamingRecognize(client, audioBuffer);

        return NextResponse.json({
            text: transcription.text,
            confidence: transcription.confidence,
            isDemo: false
        });

    } catch (error: any) {
        console.error('Speech-to-Text Error:', error);

        if (error.code === 3 && error.details?.includes('too long')) {
            return NextResponse.json(
                { error: 'Audio je predug. Molimo snimite kraći audio (maksimalno 60 sekundi).' },
                { status: 400 }
            );
        }

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

// Streaming recognition with proper config/audio ordering
async function streamingRecognize(
    client: SpeechClient,
    audioBuffer: Buffer
): Promise<{ text: string; confidence: number }> {
    return new Promise((resolve, reject) => {
        let fullTranscript = '';
        let bestConfidence = 0;

        // Create the streaming recognize stream
        const recognizeStream = client
            .streamingRecognize()
            .on('error', (error: any) => {
                console.error('Streaming recognition error:', error);
                reject(error);
            })
            .on('data', (data: protos.google.cloud.speech.v1.IStreamingRecognizeResponse) => {
                if (data.results) {
                    for (const result of data.results) {
                        if (result.isFinal && result.alternatives && result.alternatives.length > 0) {
                            const alternative = result.alternatives[0];
                            if (alternative.transcript) {
                                fullTranscript += (fullTranscript ? ' ' : '') + alternative.transcript;
                            }
                            if (alternative.confidence && alternative.confidence > bestConfidence) {
                                bestConfidence = alternative.confidence;
                            }
                        }
                    }
                }
            })
            .on('end', () => {
                console.log(`Streaming recognition complete. Transcript length: ${fullTranscript.length}`);
                resolve({
                    text: fullTranscript,
                    confidence: bestConfidence
                });
            });

        // IMPORTANT: First message MUST contain only the streamingConfig
        const configRequest: protos.google.cloud.speech.v1.IStreamingRecognizeRequest = {
            streamingConfig: {
                config: {
                    encoding: 'WEBM_OPUS' as any,
                    sampleRateHertz: 48000,
                    languageCode: 'hr-HR',
                    alternativeLanguageCodes: ['sr-RS', 'bs-BA'],
                    enableAutomaticPunctuation: true,
                    model: 'latest_long',
                },
                interimResults: false,
            }
        };

        // Send config first
        recognizeStream.write(configRequest);

        // Then send audio in chunks - each message has ONLY audioContent
        const CHUNK_SIZE = 32 * 1024; // 32KB chunks
        let offset = 0;

        const sendChunks = () => {
            while (offset < audioBuffer.length) {
                const end = Math.min(offset + CHUNK_SIZE, audioBuffer.length);
                const chunk = audioBuffer.slice(offset, end);

                const audioRequest: protos.google.cloud.speech.v1.IStreamingRecognizeRequest = {
                    audioContent: chunk
                };

                recognizeStream.write(audioRequest);
                offset = end;
            }

            // End the stream after all audio is sent
            recognizeStream.end();
        };

        // Send audio chunks
        sendChunks();
    });
}
