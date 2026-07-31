'use client';

// ════════════════════════════════════════════════════════════════════
// KROJNA LISTA — mobilni kalkulator (radnik / kontrolor / opći profil)
//
// Brz alat za telefon u proizvodnji: unesi komade (Š × V × kom), podesi ploču
// i rez, izračunaj raspored, vidi rezultat. Bez spremanja — brzo i lako; dijeli
// se kopiranjem (lista komada ili plan rezanja). Računica je ISTA kao na desktopu
// (lib/cutlist/optimizer), samo je UI građen mobilno.
// ════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useRef, useState } from 'react';
import {
    ArrowLeft, Plus, Copy, Trash2, Settings2, Play, ClipboardPaste, Ruler, X, Maximize2,
} from 'lucide-react';
import { packGroup } from '@/lib/cutlist/optimizer';
import { parseCutlistText } from '@/lib/cutlist/parse';
import type { CutPart, GroupPackResult, SheetLayout } from '@/lib/cutlist/types';
import { MSegmented, MEmpty } from '@/components/tabs/mobile/MobileUI';
import { useOverlayGuard } from '@/components/tabs/mobile/overlayGuard';
import { useSwipeBack } from '@/components/tabs/mobile/useSwipe';
import './FieldCutlist.css';

const uid = () => Math.random().toString(36).slice(2, 9);
const num = (s: string) => { const n = parseFloat(String(s).replace(',', '.')); return isFinite(n) ? n : 0; };

// Standardne ploče (Š × V mm) — brzi izbor.
const BOARD_PRESETS: { label: string; w: number; h: number }[] = [
    { label: '2800 × 2070', w: 2800, h: 2070 },
    { label: '2070 × 2800', w: 2070, h: 2800 },
    { label: '2440 × 1220', w: 2440, h: 1220 },
    { label: '3050 × 1300', w: 3050, h: 1300 },
];

interface Props {
    onClose: () => void;
}

export default function FieldCutlist({ onClose }: Props) {
    const [view, setView] = useState<'input' | 'result'>('input');
    const [parts, setParts] = useState<CutPart[]>([]);
    const [qa, setQa] = useState({ w: '', h: '', qty: '', name: '' });
    const [showName, setShowName] = useState(false);
    const [board, setBoard] = useState({ width: 2800, height: 2070 });
    const [kerf, setKerf] = useState(4);
    const [trim, setTrim] = useState(10);
    const [allowRotation, setAllowRotation] = useState(true);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [pasteOpen, setPasteOpen] = useState(false);
    const [pasteText, setPasteText] = useState('');
    const [computing, setComputing] = useState(false);
    const [result, setResult] = useState<GroupPackResult | null>(null);
    const [expanded, setExpanded] = useState<number | null>(null);
    const [toast, setToast] = useState('');
    const wRef = useRef<HTMLInputElement>(null);

    // Full-screen overlay: nazad dugme + swipe zatvara (kao ostali pogonski slojevi).
    useEffect(() => {
        window.history.pushState({ fclOpen: true }, '');
        const onPop = () => onClose();
        window.addEventListener('popstate', onPop);
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { window.removeEventListener('popstate', onPop); document.body.style.overflow = prev; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const goBack = () => window.history.back();
    useOverlayGuard(true);
    const swipeRef = useSwipeBack(goBack, { enabled: expanded === null });

    const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(''), 2200); };

    const totalPieces = useMemo(() => parts.reduce((s, p) => s + p.qty, 0), [parts]);

    function addQuick() {
        const w = num(qa.w), h = num(qa.h), qty = Math.max(1, Math.round(num(qa.qty) || 1));
        if (w <= 0 || h <= 0) { flash('Unesi širinu i visinu.'); return; }
        setParts(prev => [...prev, {
            id: uid(), name: qa.name.trim() || `Komad ${prev.length + 1}`,
            width: w, height: h, qty, materialRaw: 'Ploča', materialKey: 'ploca', canRotate: true,
        }]);
        setQa({ w: '', h: '', qty: '', name: '' });
        wRef.current?.focus();   // ostani na unosu za brzo redanje
    }

    const duplicate = (id: string) => setParts(prev => {
        const i = prev.findIndex(p => p.id === id);
        if (i < 0) return prev;
        const copy = { ...prev[i], id: uid() };
        return [...prev.slice(0, i + 1), copy, ...prev.slice(i + 1)];
    });
    const remove = (id: string) => setParts(prev => prev.filter(p => p.id !== id));
    const editQty = (id: string, qty: number) =>
        setParts(prev => prev.map(p => p.id === id ? { ...p, qty: Math.max(1, Math.round(qty) || 1) } : p));

    function doPaste() {
        const res = parseCutlistText(pasteText);
        if (!res.parts.length) { flash('Ništa nije prepoznato.'); return; }
        setParts(prev => [...prev, ...res.parts.map(p => ({ ...p, materialKey: 'ploca', canRotate: p.canRotate !== false }))]);
        setPasteText(''); setPasteOpen(false);
        flash(`Dodano ${res.parts.length} redova.`);
    }

    function compute() {
        if (parts.length === 0) { flash('Dodaj bar jedan komad.'); return; }
        setComputing(true);
        // Odgodi da se spinner iscrta prije sinhronog računanja.
        setTimeout(() => {
            try {
                const r = packGroup(parts, board, { kerf, trim, allowRotation }, { timeBudgetMs: 1400, maxRestarts: 140 });
                setResult(r);
                setView('result');
                setExpanded(null);
            } finally {
                setComputing(false);
            }
        }, 30);
    }

    function copyInput() {
        const text = parts.map(p => `${p.width}×${p.height}×${p.qty}${p.name && !/^Komad \d+$/.test(p.name) ? ` ${p.name}` : ''}`).join('\n');
        navigator.clipboard?.writeText(text).then(() => flash('Lista kopirana.'), () => flash('Kopiranje nije uspjelo.'));
    }

    function copyResult() {
        if (!result) return;
        const lines: string[] = [];
        lines.push(`Krojna lista — ${result.sheets.length} ${result.sheets.length === 1 ? 'ploča' : 'ploča'}, ploča ${board.width}×${board.height}, rez ${kerf}mm`);
        result.sheets.forEach((s, i) => {
            lines.push(`\nPloča ${i + 1} — iskoristivost ${Math.round(s.efficiency)}%`);
            const byKind = new Map<string, number>();
            s.placements.forEach(pl => {
                const key = `${Math.round(pl.rotated ? pl.h : pl.w)}×${Math.round(pl.rotated ? pl.w : pl.h)}`;
                byKind.set(key, (byKind.get(key) || 0) + 1);
            });
            byKind.forEach((n, k) => lines.push(`  ${k} × ${n}`));
        });
        if (result.unplaced.length) lines.push(`\nNe stane: ${result.unplaced.map(p => `${p.width}×${p.height}`).join(', ')}`);
        navigator.clipboard?.writeText(lines.join('\n')).then(() => flash('Plan kopiran.'), () => flash('Kopiranje nije uspjelo.'));
    }

    const avgEff = result && result.sheets.length
        ? Math.round(result.sheets.reduce((s, sh) => s + sh.efficiency, 0) / result.sheets.length) : 0;
    const colors = useMemo(() => result ? buildSizeColors(result) : null, [result]);

    return (
        <div className="mui fcl" ref={swipeRef}>
            <header className="fcl-nav">
                <button type="button" className="fcl-back" onClick={goBack}>
                    <ArrowLeft size={21} strokeWidth={2.3} /> {view === 'result' ? 'Nazad' : 'Zatvori'}
                </button>
                {view === 'input' && parts.length > 0 && (
                    <button type="button" className="fcl-navbtn" onClick={copyInput} aria-label="Kopiraj listu"><Copy size={19} /></button>
                )}
                {view === 'result' && (
                    <button type="button" className="fcl-navbtn" onClick={copyResult} aria-label="Kopiraj plan"><Copy size={19} /></button>
                )}
            </header>

            <div className="fcl-title">
                <h1>Krojna lista</h1>
                <p>{view === 'input'
                    ? <>{parts.length} {parts.length === 1 ? 'stavka' : 'stavki'} · {totalPieces} kom</>
                    : <>{result?.sheets.length} ploča · {avgEff}% iskoristivost</>}</p>
            </div>

            <div className="fcl-seg">
                <MSegmented<'input' | 'result'>
                    value={view}
                    onChange={(v) => { if (v === 'result' && !result) compute(); else setView(v); }}
                    options={[{ id: 'input', label: 'Komadi' }, { id: 'result', label: 'Rezultat' }]}
                />
            </div>

            {view === 'input' && (
                <>
                    {/* Brzi unos — širina, visina, količina, dodaj */}
                    <div className="fcl-lbl">Dodaj komad</div>
                    <div className="fcl-card fcl-quick">
                        {showName && (
                            <input className="fcl-field name" placeholder="Naziv (opcionalno)" value={qa.name}
                                onChange={e => setQa({ ...qa, name: e.target.value })} />
                        )}
                        <div className="fcl-quick-row">
                            <input ref={wRef} className="fcl-field" type="number" inputMode="numeric" placeholder="Širina" value={qa.w}
                                onChange={e => setQa({ ...qa, w: e.target.value })} />
                            <span className="fcl-x">×</span>
                            <input className="fcl-field" type="number" inputMode="numeric" placeholder="Visina" value={qa.h}
                                onChange={e => setQa({ ...qa, h: e.target.value })} />
                            <input className="fcl-field qty" type="number" inputMode="numeric" placeholder="Kom" value={qa.qty}
                                onChange={e => setQa({ ...qa, qty: e.target.value })}
                                onKeyDown={e => { if (e.key === 'Enter') addQuick(); }} />
                            <button type="button" className="fcl-add" onClick={addQuick} aria-label="Dodaj komad"><Plus size={22} strokeWidth={2.6} /></button>
                        </div>
                        <div className="fcl-quick-tools">
                            <button type="button" className="fcl-link" onClick={() => setShowName(v => !v)}>{showName ? '− naziv' : '+ naziv'}</button>
                            <button type="button" className="fcl-link" onClick={() => setPasteOpen(v => !v)}>
                                <ClipboardPaste size={14} /> Zalijepi listu
                            </button>
                        </div>
                        {pasteOpen && (
                            <div className="fcl-paste">
                                <textarea className="fcl-ta" placeholder="Zalijepi iz Excela (širina, visina, količina, naziv)…"
                                    value={pasteText} onChange={e => setPasteText(e.target.value)} rows={4} />
                                <button type="button" className="fcl-btn fcl-btn-tinted" onClick={doPaste}>Dodaj iz teksta</button>
                            </div>
                        )}
                    </div>

                    {/* Podešavanja ploče/reza */}
                    <button type="button" className="fcl-settings-toggle" onClick={() => setSettingsOpen(v => !v)}>
                        <Settings2 size={17} />
                        <span className="fcl-sum">Ploča {board.width}×{board.height} · rez {kerf} · obrez {trim} · {allowRotation ? 'rotacija' : 'bez rotacije'}</span>
                        <span className="fcl-chev">{settingsOpen ? '▲' : '▼'}</span>
                    </button>
                    {settingsOpen && (
                        <div className="fcl-card fcl-settings">
                            <div className="fcl-lbl"><Ruler size={14} /> Dimenzije ploče (mm)</div>
                            <div className="fcl-quick-row">
                                <input className="fcl-field" type="number" inputMode="numeric" value={board.width}
                                    onChange={e => setBoard({ ...board, width: Math.round(num(e.target.value)) })} />
                                <span className="fcl-x">×</span>
                                <input className="fcl-field" type="number" inputMode="numeric" value={board.height}
                                    onChange={e => setBoard({ ...board, height: Math.round(num(e.target.value)) })} />
                            </div>
                            <div className="fcl-presets">
                                {BOARD_PRESETS.map(p => (
                                    <button key={p.label} type="button"
                                        className={`fcl-preset${board.width === p.w && board.height === p.h ? ' on' : ''}`}
                                        onClick={() => setBoard({ width: p.w, height: p.h })}>{p.label}</button>
                                ))}
                            </div>
                            <div className="fcl-lbl"><Settings2 size={14} /> Rez i obrez</div>
                            <div className="fcl-set-grid">
                                <label className="fcl-set-field">
                                    <span>Rez / pila (mm)</span>
                                    <input className="fcl-field" type="number" inputMode="numeric" value={kerf}
                                        onChange={e => setKerf(Math.max(0, num(e.target.value)))} />
                                </label>
                                <label className="fcl-set-field">
                                    <span>Obrez ruba (mm)</span>
                                    <input className="fcl-field" type="number" inputMode="numeric" value={trim}
                                        onChange={e => setTrim(Math.max(0, num(e.target.value)))} />
                                </label>
                            </div>
                            <div className="fcl-set-spacer" />
                            <div className="fcl-switch" role="switch" aria-checked={allowRotation} onClick={() => setAllowRotation(v => !v)}>
                                <span className="fcl-switch-txt">
                                    <b>Rotacija komada</b>
                                    <small>Okreni komad 90° ako bolje stane</small>
                                </span>
                                <span className={`fcl-track${allowRotation ? ' on' : ''}`}><span className="fcl-knob" /></span>
                            </div>
                        </div>
                    )}

                    {/* Lista komada */}
                    {parts.length === 0 ? (
                        <MEmpty title="Nema komada" sub="Unesi širinu × visinu × količinu pa pritisni +." />
                    ) : (
                        <>
                        <div className="fcl-lbl">Komadi<span className="fcl-lbl-r">{totalPieces} kom</span></div>
                        <div className="fcl-list">
                            {parts.map((p, i) => (
                                <div key={p.id} className="fcl-part">
                                    <span className="fcl-part-idx">{i + 1}</span>
                                    <div className="fcl-part-main">
                                        <span className="fcl-part-dim">{p.width} × {p.height}</span>
                                        {p.name && !/^Komad \d+$/.test(p.name) && <span className="fcl-part-name">{p.name}</span>}
                                    </div>
                                    <div className="fcl-qty">
                                        <button type="button" onClick={() => editQty(p.id, p.qty - 1)} aria-label="Manje">−</button>
                                        <input type="number" inputMode="numeric" value={p.qty}
                                            onChange={e => editQty(p.id, num(e.target.value))} />
                                        <button type="button" onClick={() => editQty(p.id, p.qty + 1)} aria-label="Više">+</button>
                                    </div>
                                    <button type="button" className="fcl-part-btn" onClick={() => duplicate(p.id)} aria-label="Dupliraj"><Copy size={16} /></button>
                                    <button type="button" className="fcl-part-btn danger" onClick={() => remove(p.id)} aria-label="Obriši"><Trash2 size={16} /></button>
                                </div>
                            ))}
                        </div>
                        </>
                    )}

                    {parts.length > 0 && (
                        <div className="fcl-cta">
                            <button type="button" className="fcl-btn fcl-btn-filled" onClick={compute} disabled={computing}>
                                {computing ? 'Računam…' : <><Play size={18} /> Izračunaj raspored</>}
                            </button>
                        </div>
                    )}
                </>
            )}

            {view === 'result' && (
                result && colors ? (
                    <ResultView result={result} board={board} colors={colors} onExpand={setExpanded} />
                ) : (
                    <MEmpty title="Nema rezultata" sub="Dodaj komade i pritisni Izračunaj." />
                )
            )}

            {expanded !== null && result?.sheets[expanded] && colors && (
                <div className="fcl-zoom" onClick={() => setExpanded(null)}>
                    <button type="button" className="fcl-zoom-close" aria-label="Zatvori"><X size={22} /></button>
                    <div className="fcl-zoom-inner" onClick={e => e.stopPropagation()}>
                        <SheetSVG sheet={result.sheets[expanded]} usable={result.usable} colorByKey={colors.colorByKey} big />
                    </div>
                </div>
            )}

            {toast && <div className="fcl-toast">{toast}</div>}
        </div>
    );
}

// ─── Rezultat ─────────────────────────────────────────────────────────

// Mekša, „komercijalna" paleta — ista boja = ista veličina komada.
const PALETTE = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#65a30d', '#f97316'];

/** Ključ veličine neovisan o rotaciji (600×400 = 400×600). */
const sizeKey = (w: number, h: number) => `${Math.round(Math.min(w, h))}×${Math.round(Math.max(w, h))}`;

interface SizeColors {
    colorByKey: Map<string, string>;
    legend: { key: string; color: string; count: number }[];
}
function buildSizeColors(result: GroupPackResult): SizeColors {
    const counts = new Map<string, number>();
    for (const sh of result.sheets) for (const p of sh.placements) counts.set(sizeKey(p.w, p.h), (counts.get(sizeKey(p.w, p.h)) || 0) + 1);
    const keys = [...counts.keys()];
    const colorByKey = new Map(keys.map((k, i) => [k, PALETTE[i % PALETTE.length]]));
    const legend = keys.map(k => ({ key: k, color: colorByKey.get(k)!, count: counts.get(k)! }));
    return { colorByKey, legend };
}

function ResultView({ result, board, colors, onExpand }: {
    result: GroupPackResult; board: { width: number; height: number }; colors: SizeColors; onExpand: (i: number) => void;
}) {
    const placed = result.sheets.reduce((s, sh) => s + sh.placements.length, 0);
    const totalCutLen = result.sheets.reduce((s, sh) => s + sh.cutLength, 0);
    const { colorByKey, legend } = colors;

    return (
        <>
            <div className="fcl-stats">
                <div className="fcl-stat"><div className="fcl-stat-n">{result.sheets.length}</div><div className="fcl-stat-l">ploča</div></div>
                <div className="fcl-stat"><div className="fcl-stat-n">{placed}</div><div className="fcl-stat-l">komada</div></div>
                <div className="fcl-stat"><div className="fcl-stat-n">{Math.round(totalCutLen / 1000)}<small>m</small></div><div className="fcl-stat-l">rez</div></div>
            </div>

            {result.unplaced.length > 0 && (
                <div className="fcl-warn">
                    <b>{result.unplaced.length}</b> {result.unplaced.length === 1 ? 'komad ne stane' : 'komada ne stane'} ni na praznu ploču:
                    {' '}{result.unplaced.map(p => `${p.width}×${p.height}`).join(', ')}. Provjeri dimenzije.
                </div>
            )}

            <div className="fcl-sheets">
                {result.sheets.map((sheet, i) => (
                    <div key={i} className="fcl-sheet">
                        <div className="fcl-sheet-head">
                            <div>
                                <div className="fcl-sheet-title">Ploča {i + 1}</div>
                                <div className="fcl-sheet-sub">{board.width}×{board.height} · {sheet.placements.length} kom</div>
                            </div>
                            <span className={`fcl-eff${sheet.efficiency >= 80 ? ' good' : sheet.efficiency >= 60 ? ' ok' : ' low'}`}>
                                {Math.round(sheet.efficiency)}%
                            </span>
                            <button type="button" className="fcl-sheet-zoom" onClick={() => onExpand(i)} aria-label="Uvećaj"><Maximize2 size={16} /></button>
                        </div>
                        <SheetSVG sheet={sheet} usable={result.usable} colorByKey={colorByKey} />
                    </div>
                ))}
            </div>

            {legend.length > 0 && (
                <div className="fcl-legend">
                    {legend.map(l => (
                        <span key={l.key}><i style={{ background: l.color }} />{l.key} · {l.count}×</span>
                    ))}
                </div>
            )}
        </>
    );
}

// ─── SVG jedne ploče ──────────────────────────────────────────────────

function SheetSVG({ sheet, usable, colorByKey, big }: {
    sheet: SheetLayout; usable: { width: number; height: number }; colorByKey: Map<string, string>; big?: boolean;
}) {
    // Koordinate komada su u KORISNOJ površini (nakon obreza).
    const extentW = Math.max(1, ...sheet.placements.map(p => p.x + p.w));
    const extentH = Math.max(1, ...sheet.placements.map(p => p.y + p.h));
    const W = Math.max(usable.width || 0, extentW);
    const H = Math.max(usable.height || 0, extentH);
    const stroke = Math.max(1.5, W / 500);
    const fs = Math.max(W, H) / (big ? 46 : 34);

    return (
        <svg className="fcl-svg" viewBox={`-16 -16 ${W + 32} ${H + 32}`} preserveAspectRatio="xMidYMid meet">
            <rect x={0} y={0} width={W} height={H} className="fcl-svg-board" strokeWidth={stroke} rx={W / 200} />
            {sheet.cuts.map((c, i) => (
                <line key={`c${i}`} x1={c.x1} y1={c.y1} x2={c.x2} y2={c.y2} className="fcl-svg-cut" strokeWidth={stroke * 0.6} strokeOpacity={0.35} />
            ))}
            {sheet.placements.map((p, i) => {
                const c = colorByKey.get(sizeKey(p.w, p.h)) || '#3b82f6';
                const short = Math.min(p.w, p.h);
                return (
                    <g key={i}>
                        <rect x={p.x} y={p.y} width={p.w} height={p.h} fill={c} fillOpacity={0.9} stroke="#fff" strokeWidth={stroke} rx={Math.min(6, short * 0.04)} />
                        {short > fs * 2.6 && (
                            <text x={p.x + p.w / 2} y={p.y + p.h / 2} fontSize={fs} fill="#fff" fontWeight={600}
                                textAnchor="middle" dominantBaseline="central">
                                {Math.round(p.rotated ? p.h : p.w)}×{Math.round(p.rotated ? p.w : p.h)}
                            </text>
                        )}
                    </g>
                );
            })}
        </svg>
    );
}
