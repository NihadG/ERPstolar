'use client';

// ════════════════════════════════════════════════════════════════════
// /voice-preview — provjera glasovnog unosa zadatka (samo dev)
//
// Zadaci su iza prijave. Ova ruta renderuje PRAVI VoiceInput (desktop
// popover i mobilni inline) nad demo radnicima/projektima, i:
//  • „Simulacija mikrofona": getUserMedia daje ton iz AudioContexta, a
//    /api/voice-transcribe vraća odabranu rečenicu — cijeli klijentski tok
//    (snimanje, nivo, obrada, panel, ispravka) bez stvarnog govora;
//  • „Test preciznosti": iste rečenice idu na PRAVI /api/voice-extract-task
//    i porede se s očekivanim rokom/radnikom/projektom.
//
// U produkciji ruta ne postoji.
// ════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useRef, useState } from 'react';
import { notFound } from 'next/navigation';
import VoiceInput, { type ExtractedTaskData, type VoiceContext } from '@/components/VoiceInput';
import { applyVoiceResult, EMPTY_VOICE_APPLIED, type VoiceForm, type VoiceApplied } from '@/lib/voice/apply';
import { addDays, localToday, weekday } from '@/lib/voice/dates';
import { TASK_PRIORITY_LABELS, TASK_CATEGORY_LABELS } from '@/lib/types';

export const dynamic = 'force-dynamic';

const CTX: VoiceContext = {
    projects: [
        { id: 'pr-hodzic', client: 'Hodžić', name: 'Kuhinja Hodžić', address: 'Ilidža' },
        { id: 'pr-begovic', client: 'Begović d.o.o.', address: 'Zenica' },
        { id: 'pr-melihin', client: 'Meliha Hadžić', name: 'Melihin stan — A5', address: 'Sarajevo' },
        { id: 'pr-jerko', client: 'Jerko Čorluka', name: 'Jerko Čorluka — Kuća', address: 'Mostar' },
        { id: 'pr-ibro', client: 'Amra Ibrahimović', name: 'Ormari Ibrahimović', address: 'Vogošća' },
    ],
    workers: [
        { id: 'w-emir', name: 'Emir Hodžić' },
        { id: 'w-senad', name: 'Senad Begić' },
        { id: 'w-dzenan', name: 'Dženan Mujić' },
        { id: 'w-mirza', name: 'Mirza Kovač' },
        { id: 'w-adnan', name: 'Adnan Ibrahimović' },
    ],
    suppliers: ['Blum', 'Egger', 'Kronospan'],
};

function nextWd(today: string, wd: number) {
    let d = (wd - weekday(today) + 7) % 7;
    if (d === 0) d = 7;
    return addDays(today, d);
}
function endOfMonth(today: string) {
    const [y, m] = today.split('-').map(Number);
    return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

interface Sample { text: string; due: (t: string) => string | null; worker: string | null; project: string | null; priority?: string }
const SAMPLES: Sample[] = [
    { text: 'Emir sutra da izmjeri kuhinju kod Begovića u Zenici.', due: t => addDays(t, 1), worker: 'w-emir', project: 'pr-begovic' },
    { text: 'Hitno naručiti iveral H3395 hrast, osamnaest milimetara, šest ploča za Hodžića na Ilidži.', due: () => null, worker: null, project: 'pr-hodzic', priority: 'urgent' },
    { text: 'U petak montaža kod Ibrahimovića, ponijeti alat, silikonirati radnu ploču i spojiti vodu. Neka ide Senad.', due: t => nextWd(t, 5), worker: 'w-senad', project: 'pr-ibro' },
    { text: 'Kad stigneš nazovi Blum i pitaj za cijenu vodilica.', due: () => null, worker: null, project: null, priority: 'low' },
    { text: 'Za tri dana Dzenan treba da iskantuje ploče za Melihin stan.', due: t => addDays(t, 3), worker: 'w-dzenan', project: 'pr-melihin' },
    { text: 'Do kraja mjeseca završiti ormar za Jerku u Mostaru.', due: t => endOfMonth(t), worker: null, project: 'pr-jerko' },
    { text: 'Reci Mirzi da u ponedjeljak izreže stranice za ormare u Vogošći.', due: t => nextWd(t, 1), worker: 'w-mirza', project: 'pr-ibro' },
];

const EMPTY_FORM: VoiceForm = { title: '', description: '', priority: 'medium', category: 'general', dueDate: '', workerId: '', checklist: [], links: [] };

/** Mikrofon bez mikrofona: ton iz oscilatora + lažna transkripcija. */
function useMicSimulation(enabled: boolean, sentence: string) {
    const sentenceRef = useRef(sentence);
    sentenceRef.current = sentence;
    useEffect(() => {
        if (!enabled) return;
        const md = navigator.mediaDevices as MediaDevices | undefined;
        const origGum = md?.getUserMedia?.bind(md);
        const origFetch = window.fetch;
        const fakeGum = async () => {
            const ctx = new AudioContext();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            gain.gain.value = 0.3;
            osc.frequency.value = 220;
            const dest = ctx.createMediaStreamDestination();
            osc.connect(gain).connect(dest);
            osc.start();
            dest.stream.getTracks().forEach(t => t.addEventListener('ended', () => ctx.close()));
            const stop = dest.stream.getTracks()[0].stop.bind(dest.stream.getTracks()[0]);
            dest.stream.getTracks()[0].stop = () => { stop(); ctx.close().catch(() => { }); };
            return dest.stream;
        };
        if (md) (md as any).getUserMedia = fakeGum;
        else (navigator as any).mediaDevices = { getUserMedia: fakeGum };
        window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
            if (url.includes('/api/voice-transcribe')) {
                await new Promise(r => setTimeout(r, 700));
                return new Response(JSON.stringify({ text: sentenceRef.current }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }
            return origFetch(input, init);
        };
        return () => {
            window.fetch = origFetch;
            if (md && origGum) (md as any).getUserMedia = origGum;
        };
    }, [enabled]);
}

function FilledForm({ form }: { form: VoiceForm }) {
    const worker = CTX.workers!.find(w => w.id === form.workerId)?.name;
    return (
        <dl className="vp-form">
            <dt>Naslov</dt><dd>{form.title || '—'}</dd>
            <dt>Opis</dt><dd>{form.description || '—'}</dd>
            <dt>Hitnost</dt><dd>{TASK_PRIORITY_LABELS[form.priority]}</dd>
            <dt>Kategorija</dt><dd>{TASK_CATEGORY_LABELS[form.category]}</dd>
            <dt>Rok</dt><dd>{form.dueDate || '—'}</dd>
            <dt>Radnik</dt><dd>{worker || '—'}</dd>
            <dt>Veze</dt><dd>{form.links.map(l => l.Entity_Name).join(', ') || '—'}</dd>
            <dt>Lista</dt><dd>{form.checklist.length ? <ul>{form.checklist.map(i => <li key={i.id}>{i.text}</li>)}</ul> : '—'}</dd>
        </dl>
    );
}

function useVoiceForm() {
    const [form, setForm] = useState<VoiceForm>(EMPTY_FORM);
    const applied = useRef<VoiceApplied>(EMPTY_VOICE_APPLIED);
    const onResult = (data: ExtractedTaskData) => {
        const p = CTX.projects!.find(x => x.id === data.suggestedProjectId);
        setForm(prev => {
            const r = applyVoiceResult(prev, applied.current, data, p ? { id: p.id, name: p.client } : null, () => Math.random().toString(36).slice(2));
            applied.current = r.applied;
            return r.form;
        });
    };
    return { form, onResult };
}

interface Row { sample: Sample; result?: ExtractedTaskData & { degraded?: boolean }; ms?: number; error?: string }

export default function VoicePreviewPage() {
    if (process.env.NODE_ENV === 'production') notFound();

    const [simulate, setSimulate] = useState(true);
    const [sentenceIdx, setSentenceIdx] = useState(0);
    useMicSimulation(simulate, SAMPLES[sentenceIdx].text);

    const desktop = useVoiceForm();
    const mobile = useVoiceForm();

    const today = useMemo(() => localToday(), []);
    const [rows, setRows] = useState<Row[]>([]);
    const [running, setRunning] = useState(false);

    const runBatch = async () => {
        setRunning(true);
        const out: Row[] = SAMPLES.map(sample => ({ sample }));
        setRows([...out]);
        await Promise.all(SAMPLES.map(async (sample, i) => {
            const t0 = performance.now();
            try {
                const res = await fetch('/api/voice-extract-task', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: sample.text, today, context: CTX }),
                });
                const data = await res.json();
                out[i] = res.ok ? { sample, result: data, ms: Math.round(performance.now() - t0) } : { sample, error: data.error };
            } catch (e: any) {
                out[i] = { sample, error: String(e?.message || e) };
            }
            setRows([...out]);
        }));
        setRunning(false);
    };

    const ok = (got: unknown, want: unknown) => (got ?? null) === (want ?? null);
    const score = rows.filter(r => r.result).reduce((acc, r) => {
        const res = r.result!;
        return acc
            + (ok(res.suggestedDueDate, r.sample.due(today)) ? 1 : 0)
            + (ok(res.suggestedWorkerId, r.sample.worker) ? 1 : 0)
            + (ok(res.suggestedProjectId, r.sample.project) ? 1 : 0);
    }, 0);

    return (
        <div className="vp-root">
            <style>{CSS}</style>
            <h1>Glasovni unos zadatka — provjera</h1>

            <section className="vp-controls">
                <label><input type="checkbox" checked={simulate} onChange={e => setSimulate(e.target.checked)} /> Simulacija mikrofona</label>
                <select value={sentenceIdx} onChange={e => setSentenceIdx(+e.target.value)} disabled={!simulate} aria-label="Rečenica za simulaciju">
                    {SAMPLES.map((s, i) => <option key={i} value={i}>{s.text}</option>)}
                </select>
            </section>

            <div className="vp-grid">
                <section className="vp-card">
                    <h2>Desktop (modal, popover)</h2>
                    <FilledForm form={desktop.form} />
                    <div className="vp-footer">
                        <span className="vp-fake-btn">✕</span>
                        <div className="vp-footer-mid"><VoiceInput onResult={desktop.onResult} context={CTX} /></div>
                        <span className="vp-fake-btn dark">✓</span>
                    </div>
                </section>

                <section className="vp-card vp-phone">
                    <h2>Mobilni (inline)</h2>
                    <div className="mt-voice vp-mt-voice">
                        <VoiceInput onResult={mobile.onResult} context={CTX} layout="inline" />
                        <small>ili izdiktiraj zadatak — šta, za koga, ko i do kada</small>
                    </div>
                    <FilledForm form={mobile.form} />
                </section>
            </div>

            <section className="vp-card">
                <h2>Test preciznosti (pravi model) <button onClick={runBatch} disabled={running}>{running ? 'Radim…' : 'Pokreni'}</button></h2>
                {rows.length > 0 && <p className="vp-score" data-testid="vp-score">Pogođeno {score} / {rows.length * 3} (rok, radnik, projekat) · danas {today}</p>}
                <table className="vp-table">
                    <thead><tr><th>Diktat</th><th>Naslov / lista</th><th>Rok</th><th>Radnik</th><th>Projekat</th><th>Hitnost</th><th>ms</th></tr></thead>
                    <tbody>
                        {rows.map((r, i) => {
                            const res = r.result;
                            const cell = (got: string | null | undefined, want: string | null, label?: string) => (
                                <td className={res ? (ok(got, want) ? 'good' : 'bad') : ''}>{res ? (label ?? got ?? '—') : '…'}{res && !ok(got, want) ? ` (očekivano ${want ?? '—'})` : ''}</td>
                            );
                            return (
                                <tr key={i}>
                                    <td>{r.sample.text}</td>
                                    <td>{r.error ? <span className="bad">{r.error}</span> : res ? <><b>{res.title}</b>{res.degraded ? ' ⚠ bez modela' : ''}{res.checklist.length ? <ul>{res.checklist.map((c, j) => <li key={j}>{c}</li>)}</ul> : null}</> : '…'}</td>
                                    {cell(res?.suggestedDueDate, r.sample.due(today))}
                                    {cell(res?.suggestedWorkerId, r.sample.worker, CTX.workers!.find(w => w.id === res?.suggestedWorkerId)?.name)}
                                    {cell(res?.suggestedProjectId, r.sample.project, CTX.projects!.find(p => p.id === res?.suggestedProjectId)?.client)}
                                    <td className={res && r.sample.priority && res.priority !== r.sample.priority ? 'bad' : ''}>{res?.priority ?? ''}</td>
                                    <td>{r.ms ?? ''}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </section>
        </div>
    );
}

const CSS = `
.vp-root { font-family: system-ui, -apple-system, Segoe UI, sans-serif; padding: 24px 16px 80px; max-width: 1200px; margin: 0 auto; color: #0f172a; background: #f8fafc; min-height: 100vh; box-sizing: border-box; }
.vp-root h1 { font-size: 22px; margin: 0 0 16px; }
.vp-root h2 { font-size: 15px; margin: 0 0 12px; display: flex; align-items: center; gap: 12px; }
.vp-controls { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-bottom: 16px; font-size: 14px; }
.vp-controls select { max-width: 100%; padding: 6px; }
.vp-grid { display: grid; grid-template-columns: 1fr 390px; gap: 16px; margin-bottom: 16px; }
@media (max-width: 900px) { .vp-grid { grid-template-columns: 1fr; } }
.vp-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 16px; }
.vp-phone { max-width: 390px; }
.vp-mt-voice { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 8px 0 14px; }
.vp-mt-voice small { font-size: 12.5px; color: #64748b; }
.vp-form { display: grid; grid-template-columns: 90px 1fr; gap: 6px 10px; font-size: 14px; margin: 0 0 16px; min-height: 260px; }
.vp-form dt { color: #64748b; }
.vp-form dd { margin: 0; }
.vp-form ul { margin: 0; padding-left: 18px; }
.vp-footer { position: relative; display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #e2e8f0; padding-top: 12px; }
.vp-footer-mid { flex: 1; display: flex; justify-content: center; }
.vp-fake-btn { width: 48px; height: 48px; border-radius: 50%; background: #f1f5f9; display: flex; align-items: center; justify-content: center; color: #64748b; }
.vp-fake-btn.dark { background: #000; color: #fff; }
.vp-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.vp-table th, .vp-table td { text-align: left; vertical-align: top; padding: 8px 6px; border-top: 1px solid #e2e8f0; }
.vp-table ul { margin: 4px 0 0; padding-left: 16px; }
.vp-table .good { color: #15803d; }
.vp-table .bad, .vp-root .bad { color: #b91c1c; }
.vp-score { font-size: 14px; font-weight: 600; }
`;
