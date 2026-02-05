import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

export async function GET(request: NextRequest) {
    const startTime = Date.now();
    console.log('[AI-Test] Starting test at', new Date().toISOString());

    try {
        // Check API key
        const apiKey = process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY;
        if (!apiKey) {
            console.error('[AI-Test] No API key found');
            return NextResponse.json({
                success: false,
                error: 'No API key',
                step: 'api_key_check'
            }, { status: 500 });
        }
        console.log('[AI-Test] API key found, length:', apiKey.length);

        // Initialize Gemini
        const genAI = new GoogleGenerativeAI(apiKey);
        console.log('[AI-Test] GoogleGenerativeAI initialized');

        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        console.log('[AI-Test] Model loaded');

        // Simple test prompt
        const prompt = 'Odgovori samo sa "OK" - ovo je test.';
        console.log('[AI-Test] Calling generateContent...');

        const result = await model.generateContent(prompt);
        console.log('[AI-Test] Result received in', Date.now() - startTime, 'ms');

        const response = result.response;
        const text = response.text();
        console.log('[AI-Test] Response text:', text);

        return NextResponse.json({
            success: true,
            response: text,
            timeMs: Date.now() - startTime
        });
    } catch (error) {
        console.error('[AI-Test] Error:', error);
        return NextResponse.json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            errorType: error instanceof Error ? error.constructor.name : typeof error,
            step: 'execution',
            timeMs: Date.now() - startTime
        }, { status: 500 });
    }
}
