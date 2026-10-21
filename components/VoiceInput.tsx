'use client';

// ════════════════════════════════════════════════════════════════════
// GLASOVNI UNOS ZADATKA
//
// Tok: mikrofon → /api/voice-transcribe (tekst) → /api/voice-extract-task
// (polja) → onResult. Ispod dugmeta je panel koji pokazuje šta se dešava
// i šta je prepoznato (rok, radnik, projekat…), a transkript se može
// ispraviti i ponovo obraditi BEZ ponovnog snimanja.
//
// Životni ciklus je strog: svako snimanje ima svoj `run` broj; sve što
// stigne iz starog runa (ili nakon zatvaranja forme) se ignoriše, a
// mikrofon se gasi u svakom izlazu (greška, unmount, prekid).
// ════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, Square, Loader2, CheckCircle2, AlertCircle, X, Pencil, RotateCcw } from 'lucide-react';
import { localToday } from '@/lib/voice/dates';
import { contextNames, projectLabel, type ExtractedTaskData, type VoiceContext } from '@/lib/voice/extract';
import { audioExtension, pickRecorderMimeType } from '@/lib/voice/transcript';
import { TASK_PRIORITY_LABELS } from '@/lib/types';
import './VoiceInput.css';

export type { ExtractedTaskData, VoiceContext } from '@/lib/voice/extract';

interface VoiceInputProps {
    onResult: (data: ExtractedTaskData, meta: { transcript: string }) => void;
    onError?: (error: string) => void;
    onTranscript?: (text: string) => void;
    disabled?: boolean;
    context?: VoiceContext;
    /** popover = panel lebdi iznad dugmeta (desktop footer); inline = ispod, punom širinom (mobilni). */
    layout?: 'popover' | 'inline';
}

type Phase = 'idle' | 'starting' | 'recording' | 'transcribing' | 'extracting' | 'done' | 'error';

const MAX_RECORDING_SECONDS = 90;
const MIN_RECORDING_MS = 700;
const REQUEST_TIMEOUT_MS = 40_000;
const SILENCE_WARN_MS = 2500;

class VoiceError extends Error { }

async function readJson(res: Response): Promise<any> {
    try { return await res.json(); } catch { return {}; }
}

function micErrorMessage(err: any): string {
    switch (err?.name) {
        case 'NotAllowedError':
        case 'SecurityError':
            return 'Pristup mikrofonu je odbijen. Dozvolite mikrofon za ovu stranicu u postavkama preglednika.';
        case 'NotFoundError':
        case 'OverconstrainedError':
            return 'Nije pronađen mikrofon na ovom uređaju.';
        case 'NotReadableError':
        case 'AbortError':
            return 'Mikrofon je zauzet (koristi ga druga aplikacija ili poziv).';
        default:
            return 'Nije moguće pokrenuti mikrofon.';
    }
}

function shortDate(iso: string): string {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    const days = ['ned', 'pon', 'uto', 'sri', 'čet', 'pet', 'sub'];
    const today = localToday();
    const diff = Math.round((dt.getTime() - new Date(today + 'T00:00:00').getTime()) / 86_400_000);
    const rel = diff === 0 ? 'danas' : diff === 1 ? 'sutra' : diff === 2 ? 'prekosutra' : days[dt.getDay()];
    return `${rel} ${d}.${m}.`;
}

export default function VoiceInput({ onResult, onError, onTranscript, disabled, context, layout = 'popover' }: VoiceInputProps) {
    const [phase, setPhase] = useState<Phase>('idle');
    const [elapsed, setElapsed] = useState(0);
    const [transcript, setTranscript] = useState('');
    const [draft, setDraft] = useState<string | null>(null); // != null → uređivanje transkripta
    const [result, setResult] = useState<ExtractedTaskData | null>(null);
    const [errorMessage, setErrorMessage] = useState('');
    const [silent, setSilent] = useState(false);
    const [panelOpen, setPanelOpen] = useState(false);

    const runRef = useRef(0);
    const mountedRef = useRef(true);
    const recorderRef = useRef<MediaRecorder | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const startedAtRef = useRef(0);
    const abortRef = useRef<AbortController | null>(null);
    const audioCtxRef = useRef<AudioContext | null>(null);
    const rafRef = useRef<number | null>(null);
    const levelRef = useRef<HTMLSpanElement | null>(null);
    const stopRef = useRef<() => void>(() => { });

    // Najnoviji props bez ponovnog kreiranja callbackova usred snimanja.
    const propsRef = useRef({ onResult, onError, onTranscript, context });
    propsRef.current = { onResult, onError, onTranscript, context };

    const stopMeter = useCallback(() => {
        if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
        audioCtxRef.current?.close().catch(() => { });
        audioCtxRef.current = null;
    }, []);

    const releaseMic = useCallback(() => {
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = null;
        stopMeter();
        streamRef.current?.getTracks().forEach(t => t.stop());
        streamRef.current = null;
    }, [stopMeter]);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            // Zatvorena forma usred snimanja/obrade: ništa iz tog runa ne smije
            // više pisati u formu, a mikrofon se gasi odmah.
            mountedRef.current = false;
            runRef.current++;
            abortRef.current?.abort();
            const rec = recorderRef.current;
            if (rec && rec.state !== 'inactive') {
                try { rec.stop(); } catch { /* već zaustavljen */ }
            }
            releaseMic();
        };
    }, [releaseMic]);

    const fail = useCallback((run: number, message: string) => {
        if (!mountedRef.current || run !== runRef.current) return;
        releaseMic();
        setErrorMessage(message);
        setPhase('error');
        setPanelOpen(true);
        propsRef.current.onError?.(message);
    }, [releaseMic]);

    /** fetch s timeoutom i prekidom kad korisnik krene ispočetka/zatvori formu. */
    const request = useCallback(async (url: string, init: RequestInit) => {
        abortRef.current?.abort();
        const ctrl = new AbortController();
        abortRef.current = ctrl;
        const timer = setTimeout(() => ctrl.abort('timeout'), REQUEST_TIMEOUT_MS);
        try {
            const res = await fetch(url, { ...init, signal: ctrl.signal });
            const data = await readJson(res);
            if (!res.ok) throw new VoiceError(data.error || `Greška servera (${res.status}).`);
            return data;
        } catch (err: any) {
            if (err instanceof VoiceError) throw err;
            if (ctrl.signal.aborted) {
                throw new VoiceError(ctrl.signal.reason === 'timeout'
                    ? 'Obrada traje predugo. Provjerite internet i pokušajte ponovo.'
                    : 'Prekinuto.');
            }
            throw new VoiceError('Nema veze sa serverom. Provjerite internet i pokušajte ponovo.');
        } finally {
            clearTimeout(timer);
        }
    }, []);

    const extract = useCallback(async (text: string, run: number) => {
        setPhase('extracting');
        try {
            const data: ExtractedTaskData = await request('/api/voice-extract-task', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text, today: localToday(), context: propsRef.current.context }),
            });
            if (!mountedRef.current || run !== runRef.current) return;
            setResult(data);
            setPhase('done');
            propsRef.current.onResult(data, { transcript: text });
        } catch (err: any) {
            fail(run, err?.message || 'Greška pri obradi diktata.');
        }
    }, [request, fail]);

    const processAudio = useCallback(async (blob: Blob, run: number) => {
        setPhase('transcribing');
        try {
            const fd = new FormData();
            fd.append('audio', blob, `diktat.${audioExtension(blob.type)}`);
            const names = contextNames(propsRef.current.context);
            if (names.length) fd.append('contextHint', JSON.stringify(names));
            const data = await request('/api/voice-transcribe', { method: 'POST', body: fd });
            if (!mountedRef.current || run !== runRef.current) return;
            const text = String(data.text || '').trim();
            if (!text) throw new VoiceError('Nije prepoznat govor. Pokušajte ponovo, malo bliže mikrofonu.');
            setTranscript(text);
            propsRef.current.onTranscript?.(text);
            await extract(text, run);
        } catch (err: any) {
            fail(run, err?.message || 'Greška pri transkripciji.');
        }
    }, [request, extract, fail]);

    /** Nivo zvuka (traka u dugmetu) + upozorenje kad mikrofon ništa ne hvata. */
    const startMeter = useCallback((stream: MediaStream, run: number) => {
        try {
            const Ctx: typeof AudioContext | undefined = window.AudioContext || (window as any).webkitAudioContext;
            if (!Ctx) return;
            const ctx = new Ctx();
            audioCtxRef.current = ctx;
            ctx.resume().catch(() => { });
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 512;
            ctx.createMediaStreamSource(stream).connect(analyser);
            const buf = new Uint8Array(analyser.fftSize);
            let heard = false;
            const tick = () => {
                if (run !== runRef.current || !audioCtxRef.current) return;
                analyser.getByteTimeDomainData(buf);
                let sum = 0;
                for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
                const rms = Math.sqrt(sum / buf.length);
                if (levelRef.current) levelRef.current.style.transform = `scaleY(${Math.min(1, 0.08 + rms * 6)})`;
                if (rms > 0.02 && !heard) { heard = true; setSilent(false); }
                if (!heard && Date.now() - startedAtRef.current > SILENCE_WARN_MS) setSilent(true);
                rafRef.current = requestAnimationFrame(tick);
            };
            rafRef.current = requestAnimationFrame(tick);
        } catch { /* mjerač je ukras — snimanje radi i bez njega */ }
    }, []);

    const startRecording = useCallback(async () => {
        const run = ++runRef.current;
        abortRef.current?.abort();
        setTranscript('');
        setDraft(null);
        setResult(null);
        setErrorMessage('');
        setSilent(false);
        setElapsed(0);
        setPanelOpen(true);

        if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
            fail(run, 'Snimanje nije dostupno: stranica mora biti otvorena preko sigurne (https) veze.');
            return;
        }
        if (typeof MediaRecorder === 'undefined') {
            fail(run, 'Ovaj preglednik ne podržava snimanje zvuka.');
            return;
        }

        setPhase('starting');
        let stream: MediaStream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
            });
        } catch (err) {
            fail(run, micErrorMessage(err));
            return;
        }
        // Forma zatvorena ili ponovni klik dok je dozvola bila otvorena.
        if (!mountedRef.current || run !== runRef.current) {
            stream.getTracks().forEach(t => t.stop());
            return;
        }
        streamRef.current = stream;

        const mime = pickRecorderMimeType(t => MediaRecorder.isTypeSupported(t));
        let recorder: MediaRecorder;
        try {
            recorder = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 64_000 } : undefined);
        } catch {
            fail(run, 'Snimanje nije moguće u ovom pregledniku.');
            return;
        }
        recorderRef.current = recorder;
        chunksRef.current = [];

        recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
        recorder.onerror = () => fail(run, 'Snimanje je prekinuto.');
        recorder.onstop = () => {
            releaseMic();
            if (!mountedRef.current || run !== runRef.current) return;
            const type = recorder.mimeType || mime || 'audio/webm';
            const blob = new Blob(chunksRef.current, { type });
            chunksRef.current = [];
            if (Date.now() - startedAtRef.current < MIN_RECORDING_MS || blob.size < 1500) {
                fail(run, 'Snimak je prekratak. Tapnite mikrofon, izgovorite zadatak, pa tapnite ponovo.');
                return;
            }
            processAudio(blob, run);
        };

        // Bez timeslice-a: jedan cijeli fajl na kraju (Safari s komadićima zna dati neispravan mp4).
        recorder.start();
        startedAtRef.current = Date.now();
        setPhase('recording');
        startMeter(stream, run);
        timerRef.current = setInterval(() => {
            const s = Math.floor((Date.now() - startedAtRef.current) / 1000);
            setElapsed(s);
            if (s >= MAX_RECORDING_SECONDS) stopRef.current();
        }, 250);
    }, [fail, processAudio, releaseMic, startMeter]);

    const stopRecording = useCallback(() => {
        const rec = recorderRef.current;
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = null;
        stopMeter();
        if (rec && rec.state !== 'inactive') {
            setPhase('transcribing');
            rec.stop(); // onstop gasi mikrofon i šalje snimak
        }
    }, [stopMeter]);
    stopRef.current = stopRecording;

    const cancel = () => {
        runRef.current++;
        abortRef.current?.abort();
        const rec = recorderRef.current;
        if (rec && rec.state !== 'inactive') {
            try { rec.stop(); } catch { /* */ }
        }
        releaseMic();
        setPhase(result ? 'done' : 'idle');
        if (!result) setPanelOpen(false);
    };

    const handleClick = () => {
        if (disabled) return;
        if (phase === 'recording') stopRecording();
        else if (phase === 'idle' || phase === 'done' || phase === 'error') startRecording();
    };

    const reprocess = () => {
        const text = (draft ?? transcript).trim();
        if (!text) return;
        const run = ++runRef.current;
        setTranscript(text);
        setDraft(null);
        setErrorMessage('');
        setPanelOpen(true);
        extract(text, run);
    };

    const closePanel = () => {
        if (phase === 'recording' || phase === 'starting' || phase === 'transcribing' || phase === 'extracting') cancel();
        setPanelOpen(false);
        setDraft(null);
        if (phase === 'error') setPhase('idle');
    };

    const busy = phase === 'starting' || phase === 'transcribing' || phase === 'extracting';
    const mm = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

    const workerName = result?.suggestedWorkerId ? context?.workers?.find(w => w.id === result.suggestedWorkerId)?.name : undefined;
    const project = result?.suggestedProjectId ? context?.projects?.find(p => p.id === result.suggestedProjectId) : undefined;

    const chips: { label: string; value: string; warn?: boolean }[] = [];
    if (result) {
        if (result.suggestedDueDate) chips.push({ label: 'Rok', value: shortDate(result.suggestedDueDate) });
        if (workerName) chips.push({ label: 'Radnik', value: workerName });
        else if (result.suggestedWorker) chips.push({ label: 'Radnik', value: `„${result.suggestedWorker}" nije pronađen`, warn: true });
        if (project) chips.push({ label: 'Projekat', value: projectLabel(project) });
        else if (result.suggestedProject) chips.push({ label: 'Projekat', value: `„${result.suggestedProject}" nije pronađen`, warn: true });
        if (result.priority !== 'medium') chips.push({ label: 'Hitnost', value: TASK_PRIORITY_LABELS[result.priority] || result.priority });
        if (result.checklist.length) chips.push({ label: 'Lista', value: `${result.checklist.length} ${result.checklist.length === 1 ? 'stavka' : result.checklist.length < 5 ? 'stavke' : 'stavki'}` });
    }

    const buttonTitle = phase === 'recording' ? 'Zaustavi i obradi'
        : busy ? 'Obrađujem…'
            : phase === 'error' ? 'Pokušaj ponovo'
                : phase === 'done' ? 'Izdiktiraj ponovo'
                    : `Izdiktiraj zadatak (do ${mm(MAX_RECORDING_SECONDS)} min)`;

    return (
        <div className={`voice-input-container voice-${layout}`}>
            <button
                type="button"
                className={`voice-btn ${busy ? 'processing' : phase === 'done' ? 'success' : phase}`}
                onClick={handleClick}
                disabled={disabled || busy}
                title={buttonTitle}
                aria-label={buttonTitle}
                aria-pressed={phase === 'recording'}
            >
                {phase === 'recording' ? (
                    <>
                        <span className="voice-level" aria-hidden><span ref={levelRef} /></span>
                        <Square size={14} fill="currentColor" />
                        <span className="recording-time">{mm(elapsed)}</span>
                    </>
                ) : busy ? <Loader2 size={20} className="spin" />
                    : phase === 'done' ? <CheckCircle2 size={20} />
                        : phase === 'error' ? <AlertCircle size={20} />
                            : <Mic size={20} />}
            </button>

            {phase === 'recording' && (
                <div className="recording-ring" aria-hidden>
                    <svg viewBox="0 0 36 36" className="circular-progress">
                        <path className="circle-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                        <path className="circle-fill" strokeDasharray={`${(elapsed / MAX_RECORDING_SECONDS) * 100}, 100`}
                            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                    </svg>
                </div>
            )}

            {panelOpen && phase !== 'idle' && (
                <div className={`voice-panel is-${phase}`} role="status" aria-live="polite">
                    <div className="voice-panel-head">
                        <strong>
                            {phase === 'starting' && 'Pokrećem mikrofon…'}
                            {phase === 'recording' && (silent ? 'Mikrofon ne hvata zvuk' : 'Slušam…')}
                            {phase === 'transcribing' && 'Pretvaram govor u tekst…'}
                            {phase === 'extracting' && 'Popunjavam polja…'}
                            {phase === 'done' && 'Popunjeno iz diktata'}
                            {phase === 'error' && 'Nije uspjelo'}
                        </strong>
                        <button type="button" className="voice-panel-x" onClick={closePanel} aria-label={busy || phase === 'recording' ? 'Prekini' : 'Zatvori'}>
                            <X size={14} />
                        </button>
                    </div>

                    {phase === 'recording' && (
                        <p className="voice-panel-hint">
                            {silent
                                ? 'Provjerite da li je mikrofon uključen i da li je odabran pravi uređaj.'
                                : 'Recite šta, za koga, ko radi i do kada — npr. „Emir sutra da izmjeri kuhinju kod Hodžića".'}
                            {' '}Tapnite <b>■</b> kad završite.
                        </p>
                    )}

                    {phase === 'error' && <p className="voice-panel-error">{errorMessage}</p>}

                    {transcript && (phase === 'extracting' || phase === 'done' || phase === 'error') && (
                        draft === null ? (
                            <blockquote className="voice-transcript">
                                „{transcript}"
                                {phase !== 'extracting' && (
                                    <button type="button" className="voice-link" onClick={() => setDraft(transcript)}>
                                        <Pencil size={12} /> Ispravi tekst
                                    </button>
                                )}
                            </blockquote>
                        ) : (
                            <div className="voice-edit">
                                <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={3} autoFocus
                                    onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) reprocess(); }} />
                                <div className="voice-edit-actions">
                                    <button type="button" className="voice-link" onClick={() => setDraft(null)}>Odustani</button>
                                    <button type="button" className="voice-primary" onClick={reprocess} disabled={!draft.trim()}>
                                        <RotateCcw size={13} /> Ponovo popuni
                                    </button>
                                </div>
                            </div>
                        )
                    )}

                    {phase === 'done' && (
                        chips.length ? (
                            <ul className="voice-chips">
                                {chips.map(c => (
                                    <li key={c.label} className={c.warn ? 'warn' : undefined}><span>{c.label}</span>{c.value}</li>
                                ))}
                            </ul>
                        ) : <p className="voice-panel-hint">Naslov i opis su popunjeni. Rok, radnik i projekat nisu spomenuti.</p>
                    )}

                    {phase === 'error' && transcript && draft === null && (
                        <div className="voice-edit-actions">
                            <button type="button" className="voice-primary" onClick={reprocess}><RotateCcw size={13} /> Ponovo obradi tekst</button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
