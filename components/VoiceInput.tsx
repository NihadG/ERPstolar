'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Mic, MicOff, Loader2, CheckCircle2, AlertCircle, X } from 'lucide-react';
import './VoiceInput.css';

// Types
export interface ExtractedTaskData {
    title: string;
    description: string;
    priority: 'low' | 'medium' | 'high' | 'urgent';
    category: 'general' | 'manufacturing' | 'ordering' | 'installation' | 'design' | 'meeting' | 'reminder';
    checklist: string[];
    suggestedDueDate: string | null;
    suggestedWorker: string | null;
    suggestedProject: string | null;
}

interface VoiceInputProps {
    onResult: (data: ExtractedTaskData) => void;
    onError: (error: string) => void;
    onTranscript?: (text: string) => void;
    disabled?: boolean;
    context?: {
        projects?: string[];
        workers?: string[];
    };
}

type RecordingState = 'idle' | 'recording' | 'processing' | 'success' | 'error';

const MAX_RECORDING_SECONDS = 60;

export default function VoiceInput({ onResult, onError, onTranscript, disabled, context }: VoiceInputProps) {
    const [state, setState] = useState<RecordingState>('idle');
    const [recordingTime, setRecordingTime] = useState(0);
    const [transcript, setTranscript] = useState('');
    const [errorMessage, setErrorMessage] = useState('');

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const streamRef = useRef<MediaStream | null>(null);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
            }
        };
    }, []);

    const startRecording = async () => {
        try {
            // Reset state
            setTranscript('');
            setErrorMessage('');
            setRecordingTime(0);
            audioChunksRef.current = [];

            // Request microphone access
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    sampleRate: 48000,
                    echoCancellation: true,
                    noiseSuppression: true,
                }
            });
            streamRef.current = stream;

            // Create MediaRecorder
            const mediaRecorder = new MediaRecorder(stream, {
                mimeType: 'audio/webm;codecs=opus'
            });
            mediaRecorderRef.current = mediaRecorder;

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    audioChunksRef.current.push(event.data);
                }
            };

            mediaRecorder.onstop = async () => {
                // Stop all tracks
                stream.getTracks().forEach(track => track.stop());

                // Process the recording
                const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
                await processAudio(audioBlob);
            };

            // Start recording
            mediaRecorder.start(1000); // Collect data every second
            setState('recording');

            // Start timer
            timerRef.current = setInterval(() => {
                setRecordingTime(prev => {
                    if (prev >= MAX_RECORDING_SECONDS - 1) {
                        stopRecording();
                        return MAX_RECORDING_SECONDS;
                    }
                    return prev + 1;
                });
            }, 1000);

        } catch (error: any) {
            console.error('Microphone access error:', error);
            setErrorMessage('Nije moguće pristupiti mikrofonu. Provjerite dozvole.');
            setState('error');
            onError('Nije moguće pristupiti mikrofonu');
        }
    };

    const stopRecording = () => {
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }

        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
        }

        setState('processing');
    };

    const processAudio = async (audioBlob: Blob) => {
        try {
            // Step 1: Transcribe
            const formData = new FormData();
            formData.append('audio', audioBlob, 'recording.webm');

            const transcribeResponse = await fetch('/api/voice-transcribe', {
                method: 'POST',
                body: formData,
            });

            if (!transcribeResponse.ok) {
                const error = await transcribeResponse.json();
                throw new Error(error.error || 'Greška pri transkripciji');
            }

            const transcribeData = await transcribeResponse.json();
            const text = transcribeData.text;

            if (!text || text.trim().length === 0) {
                throw new Error('Nije prepoznat govor. Pokušajte ponovo jasnije.');
            }

            setTranscript(text);
            if (onTranscript) onTranscript(text);

            // Step 2: Extract task data
            const extractResponse = await fetch('/api/voice-extract-task', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text, context }),
            });

            if (!extractResponse.ok) {
                const error = await extractResponse.json();
                throw new Error(error.error || 'Greška pri ekstrakciji zadatka');
            }

            const taskData: ExtractedTaskData = await extractResponse.json();

            setState('success');
            onResult(taskData);

            // Reset to idle after a moment
            setTimeout(() => setState('idle'), 2000);

        } catch (error: any) {
            console.error('Processing error:', error);
            setErrorMessage(error.message || 'Greška pri obradi');
            setState('error');
            onError(error.message);
        }
    };

    const handleClick = () => {
        if (disabled) return;

        if (state === 'recording') {
            stopRecording();
        } else if (state === 'idle' || state === 'error' || state === 'success') {
            startRecording();
        }
    };

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const getButtonClass = () => {
        switch (state) {
            case 'recording': return 'voice-btn recording';
            case 'processing': return 'voice-btn processing';
            case 'success': return 'voice-btn success';
            case 'error': return 'voice-btn error';
            default: return 'voice-btn';
        }
    };

    const getButtonContent = () => {
        switch (state) {
            case 'recording':
                return (
                    <>
                        <MicOff size={20} />
                        <span className="recording-time">{formatTime(recordingTime)}</span>
                    </>
                );
            case 'processing':
                return <Loader2 size={20} className="spin" />;
            case 'success':
                return <CheckCircle2 size={20} />;
            case 'error':
                return <AlertCircle size={20} />;
            default:
                return <Mic size={20} />;
        }
    };

    const getTooltip = () => {
        switch (state) {
            case 'recording': return 'Klikni za zaustavljanje';
            case 'processing': return 'Obrađujem...';
            case 'success': return 'Uspješno!';
            case 'error': return errorMessage || 'Greška';
            default: return 'Glasovni unos (max 60s)';
        }
    };

    return (
        <div className="voice-input-container">
            <button
                type="button"
                className={getButtonClass()}
                onClick={handleClick}
                disabled={disabled || state === 'processing'}
                title={getTooltip()}
            >
                {getButtonContent()}
            </button>

            {/* Recording indicator ring */}
            {state === 'recording' && (
                <div className="recording-ring">
                    <svg viewBox="0 0 36 36" className="circular-progress">
                        <path
                            className="circle-bg"
                            d="M18 2.0845
                                a 15.9155 15.9155 0 0 1 0 31.831
                                a 15.9155 15.9155 0 0 1 0 -31.831"
                        />
                        <path
                            className="circle-fill"
                            strokeDasharray={`${(recordingTime / MAX_RECORDING_SECONDS) * 100}, 100`}
                            d="M18 2.0845
                                a 15.9155 15.9155 0 0 1 0 31.831
                                a 15.9155 15.9155 0 0 1 0 -31.831"
                        />
                    </svg>
                </div>
            )}

            {/* Transcript preview (shown while processing or after success) */}
            {transcript && (state === 'processing' || state === 'success') && (
                <div className="transcript-preview">
                    <span>"{transcript.substring(0, 50)}{transcript.length > 50 ? '...' : ''}"</span>
                </div>
            )}
        </div>
    );
}
