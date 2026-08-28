'use client';

// ════════════════════════════════════════════════════════════════════
// KROJNA LISTA — mobilni kalkulator (radnik / kontrolor / opći profil)
//
// Brz alat za telefon u proizvodnji: unesi komade (Š × V × kom), podesi ploču
// i rez, izračunaj raspored, vidi rezultat. Bez spremanja — brzo i lako; dijeli
// se kopiranjem (lista komada ili plan rezanja). Računica je ISTA kao na desktopu
// (lib/cutlist/optimizer); UI je „svijetli premium" — punjena polja, velike
// tabular brojke, jedan plavi akcenat, lista dominira, postavke su bottom-sheet.
// ════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useRef, useState } from 'react';
import {
    ArrowLeft, Plus, Copy, Trash2, Settings2, Play, ClipboardPaste, Tag, ChevronRight, X, Maximize2, Package, Printer,
} from 'lucide-react';
import { packGroup } from '@/lib/cutlist/optimizer';
import { parseCutlistText } from '@/lib/cutlist/parse';
import { buildProductCutList } from '@/lib/cutlist/persist';
import { buildCutlistPrintDocument } from '@/lib/print/cutlistDocument';
import type { CutPart, GroupPackResult, SheetLayout } from '@/lib/cutlist/types';
import { useOverlayGuard } from '@/components/tabs/mobile/overlayGuard';
import { useSwipeBack } from '@/components/tabs/mobile/useSwipe';
import './FieldCutlist.css';

const uid = () => Math.random().toString(36).slice(2, 9);
const num = (s: string) => { const n = parseFloat(String(s).replace(',', '.')); return isFinite(n) ? n : 0; };

/** Padež uz broj ploča: 1 ploča · 2–4 ploče · 5+ ploča. */
const plo = (n: number) => {
    const d = n % 10, dd = n % 100;
    if (d === 1 && dd !== 11) return 'ploča';
    if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return 'ploče';
    return 'ploča';
};

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
    const goBack = () => { if (view === 'result') setView('input'); else window.history.back(); };
    useOverlayGuard(true);
    const swipeRef = useSwipeBack(goBack, { enabled: expanded === null && !settingsOpen });

    // Desktop (sidebar launcher): Escape se ponaša kao „Nazad" — rezultat →
    // unos, unos → zatvori. Na telefonu je Escape irelevantan (nema tipkovnice).
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            if (settingsOpen) { setSettingsOpen(false); return; }
            if (expanded !== null) { setExpanded(null); return; }
            e.preventDefault();
            if (view === 'result') setView('input'); else window.history.back();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [view, settingsOpen, expanded]);

    const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(''), 2200); };

    const totalPieces = useMemo(() => parts.reduce((s, p) => s + p.qty, 0), [parts]);
    const totalArea = useMemo(() => parts.reduce((s, p) => s + p.width * p.height * p.qty, 0) / 1e6, [parts]);

    // Boje komada po veličini — iste u listi i u planu (vizuelni kontinuitet).
    const partColors = useMemo(() => {
        const keys: string[] = [];
        parts.forEach(p => { const k = sizeKey(p.width, p.height); if (!keys.includes(k)) keys.push(k); });
        const m = new Map<string, string>();
        keys.forEach((k, i) => m.set(k, PALETTE[i % PALETTE.length]));
        return m;
    }, [parts]);

    // Brza procjena broja ploča (po površini) — za natpis na dugmetu, bez optimizatora.
    const estSheets = useMemo(() => {
        if (!parts.length) return 0;
        const uw = Math.max(1, board.width - 2 * trim), uh = Math.max(1, board.height - 2 * trim);
        const area = parts.reduce((s, p) => s + p.width * p.height * p.qty, 0);
        return Math.max(1, Math.ceil(area / (uw * uh)));
    }, [parts, board, trim]);

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
                window.scrollTo({ top: 0 });
            } finally {
                setComputing(false);
            }
        }, 30);
    }

    function openResult() {
        if (parts.length === 0) { flash('Dodaj bar jedan komad.'); return; }
        if (!result) compute(); else setView('result');
    }

    function copyInput() {
        const text = parts.map(p => `${p.width}×${p.height}×${p.qty}${p.name && !/^Komad \d+$/.test(p.name) ? ` ${p.name}` : ''}`).join('\n');
        navigator.clipboard?.writeText(text).then(() => flash('Lista kopirana.'), () => flash('Kopiranje nije uspjelo.'));
    }

    function copyResult() {
        if (!result) return;
        const lines: string[] = [];
        lines.push(`Krojna lista — ${result.sheets.length} ${plo(result.sheets.length)}, ploča ${board.width}×${board.height}, rez ${kerf}mm`);
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

    // Štampa plana rezanja — isti A4 dokument kao krojenje na kartici proizvoda
    // (lib/print/cutlistDocument), ali bez projekta/materijala: jedna „Ploča" grupa.
    function handlePrint() {
        if (!result) return;
        // Prozor se otvara SINHRONO unutar klika — inače ga pop-up blokator odbije.
        const printWindow = window.open('', '_blank');
        if (!printWindow) { flash('Dozvoli pop-up prozore za štampu.'); return; }
        const cutList = buildProductCutList({
            name: `Krojna lista ${new Date().toLocaleDateString('hr-HR')}`,
            parts,
            settings: { kerf, trim, allowRotation },
            results: [result],
            groups: [{ key: result.materialKey || 'ploca', label: 'Ploča' }],
        });
        const doc = buildCutlistPrintDocument({ cutList });
        printWindow.document.open();
        printWindow.document.write(doc.html);
        printWindow.document.close();
        // Sačekaj fontove pa pokreni print (isti obrazac kao ponuda/narudžba).
        setTimeout(() => {
            if (printWindow.document.fonts?.ready) {
                printWindow.document.fonts.ready.then(() => setTimeout(() => printWindow.print(), 100));
            } else {
                setTimeout(() => printWindow.print(), 500);
            }
        }, 200);
    }

    const avgEff = result && result.sheets.length
        ? Math.round(result.sheets.reduce((s, sh) => s + sh.efficiency, 0) / result.sheets.length) : 0;
    const colors = useMemo(() => result ? buildSizeColors(result) : null, [result]);
    const showCopy = view === 'result' || parts.length > 0;

    return (
        <div className="mui fcl" ref={swipeRef}>
            <header className="fcl-nav">
                <button type="button" className="fcl-back" onClick={goBack}>
                    <ArrowLeft size={21} strokeWidth={2.3} /> <span>{view === 'result' ? 'Nazad' : 'Zatvori'}</span>
                </button>
                <span className="fcl-nav-title">Krojna lista</span>
                <div className="fcl-navactions">
                    {view === 'result' && result && (
                        <button type="button" className="fcl-navbtn" onClick={handlePrint} aria-label="Štampaj plan">
                            <Printer size={18} />
                        </button>
                    )}
                    {showCopy ? (
                        <button type="button" className="fcl-navbtn" onClick={view === 'result' ? copyResult : copyInput}
                            aria-label={view === 'result' ? 'Kopiraj plan' : 'Kopiraj listu'}>
                            <Copy size={18} />
                        </button>
                    ) : <span className="fcl-navbtn-ghost" />}
                </div>
            </header>

            <div className="fcl-body">
                <div className="fcl-hd">
                    <h1>Krojna lista</h1>
                    <p>{view === 'input'
                        ? <><b>{parts.length}</b> {parts.length === 1 ? 'stavka' : 'stavki'} · <b>{totalPieces}</b> kom · <b>{totalArea.toFixed(2)}</b> m²</>
                        : <><b>{result?.sheets.length}</b> {plo(result?.sheets.length || 0)} · <b>{avgEff}%</b> iskoristivost</>}</p>
                </div>

                <div className="fcl-seg" role="tablist">
                    <button type="button" role="tab" aria-selected={view === 'input'} className={view === 'input' ? 'on' : ''} onClick={() => setView('input')}>Komadi</button>
                    <button type="button" role="tab" aria-selected={view === 'result'} className={view === 'result' ? 'on' : ''} onClick={openResult}>Rezultat</button>
                </div>

                {view === 'input' && (
                    <>
                        {/* Novi komad */}
                        <div className="fcl-sec">Novi komad</div>
                        <div className="fcl-add">
                            {showName && (
                                <input className="fcl-name" placeholder="Naziv (opcionalno)" value={qa.name}
                                    onChange={e => setQa({ ...qa, name: e.target.value })} />
                            )}
                            <div className="fcl-fields">
                                <label className="fcl-fld">
                                    <span>Širina</span>
                                    <input ref={wRef} type="number" inputMode="numeric" placeholder="0" value={qa.w}
                                        onChange={e => setQa({ ...qa, w: e.target.value })} />
                                </label>
                                <span className="fcl-x">×</span>
                                <label className="fcl-fld">
                                    <span>Visina</span>
                                    <input type="number" inputMode="numeric" placeholder="0" value={qa.h}
                                        onChange={e => setQa({ ...qa, h: e.target.value })} />
                                </label>
                                <label className="fcl-fld k">
                                    <span>Kom</span>
                                    <input type="number" inputMode="numeric" placeholder="1" value={qa.qty}
                                        onChange={e => setQa({ ...qa, qty: e.target.value })}
                                        onKeyDown={e => { if (e.key === 'Enter') addQuick(); }} />
                                </label>
                            </div>
                            <button type="button" className="fcl-add-btn" onClick={addQuick}>
                                <Plus size={20} strokeWidth={2.6} /> Dodaj komad
                            </button>
                            <div className="fcl-tools">
                                <button type="button" className={`fcl-tool${showName ? ' on' : ''}`} onClick={() => setShowName(v => !v)}>
                                    <Tag size={15} /> Naziv
                                </button>
                                <button type="button" className={`fcl-tool${pasteOpen ? ' on' : ''}`} onClick={() => setPasteOpen(v => !v)}>
                                    <ClipboardPaste size={15} /> Zalijepi listu
                                </button>
                            </div>
                            {pasteOpen && (
                                <div className="fcl-paste">
                                    <textarea className="fcl-ta" placeholder="Zalijepi iz Excela — širina, visina, količina, naziv…"
                                        value={pasteText} onChange={e => setPasteText(e.target.value)} rows={4} />
                                    <button type="button" className="fcl-paste-btn" onClick={doPaste}>Dodaj iz teksta</button>
                                </div>
                            )}
                        </div>

                        {/* Postavke ploče → bottom sheet */}
                        <button type="button" className="fcl-setbtn" onClick={() => setSettingsOpen(true)}>
                            <span className="fcl-setbtn-ic"><Settings2 size={19} /></span>
                            <span className="fcl-setbtn-tx">
                                <b>Postavke ploče</b>
                                <small>Ploča {board.width}×{board.height} · rez {kerf} · obrez {trim} · {allowRotation ? 'rotacija' : 'bez rotacije'}</small>
                            </span>
                            <ChevronRight className="fcl-setbtn-chev" size={20} />
                        </button>

                        {/* Lista komada */}
                        {parts.length === 0 ? (
                            <div className="fcl-empty">
                                <div className="fcl-empty-ic"><Package size={26} strokeWidth={1.8} /></div>
                                <b>Još nema komada</b>
                                <small>Unesi širinu, visinu i količinu pa dodaj komad.</small>
                            </div>
                        ) : (
                            <>
                                <div className="fcl-sec">Komadi<span className="fcl-sec-r"><b>{totalPieces}</b> kom · <b>{totalArea.toFixed(2)}</b> m²</span></div>
                                <div className="fcl-list">
                                    {parts.map(p => {
                                        const named = p.name && !/^Komad \d+$/.test(p.name);
                                        return (
                                            <div key={p.id} className="fcl-part">
                                                <span className="fcl-sw" style={{ background: partColors.get(sizeKey(p.width, p.height)) }} />
                                                <div className="fcl-part-main">
                                                    <div className="fcl-part-dim">{p.width}<i>×</i>{p.height}</div>
                                                    <div className="fcl-part-sub">{named ? `${p.name} · ` : ''}{(p.width * p.height / 1e6).toFixed(3)} m²</div>
                                                </div>
                                                <div className="fcl-qty">
                                                    <button type="button" onClick={() => editQty(p.id, p.qty - 1)} aria-label="Manje">−</button>
                                                    <input type="number" inputMode="numeric" value={p.qty}
                                                        onChange={e => editQty(p.id, num(e.target.value))} />
                                                    <button type="button" onClick={() => editQty(p.id, p.qty + 1)} aria-label="Više">+</button>
                                                </div>
                                                <button type="button" className="fcl-part-del" onClick={() => remove(p.id)} aria-label="Obriši"><Trash2 size={17} /></button>
                                            </div>
                                        );
                                    })}
                                </div>
                            </>
                        )}
                    </>
                )}

                {view === 'result' && (
                    result && colors ? (
                        <ResultView result={result} board={board} colors={colors} avgEff={avgEff} onExpand={setExpanded} />
                    ) : (
                        <div className="fcl-empty">
                            <div className="fcl-empty-ic"><Package size={26} strokeWidth={1.8} /></div>
                            <b>Nema rezultata</b>
                            <small>Dodaj komade i pritisni Izračunaj.</small>
                        </div>
                    )
                )}
            </div>

            {view === 'input' && parts.length > 0 && (
                <div className="fcl-cta">
                    <button type="button" className="fcl-go" onClick={compute} disabled={computing}>
                        {computing
                            ? <><span className="fcl-spin" /> <span className="fcl-go-lbl">Računam…</span></>
                            : <><Play size={17} fill="currentColor" /> <span className="fcl-go-lbl">Izračunaj raspored</span>
                                <span className="fcl-go-est">≈ {estSheets} {plo(estSheets)}</span></>}
                    </button>
                </div>
            )}

            {/* Postavke — bottom sheet */}
            <div className={`fcl-scrim${settingsOpen ? ' on' : ''}`} onClick={() => setSettingsOpen(false)} />
            <div className={`fcl-sheetm${settingsOpen ? ' on' : ''}`} role="dialog" aria-modal={settingsOpen} aria-label="Postavke ploče">
                <div className="fcl-grab" />
                <h3>Postavke ploče</h3>
                <div className="fcl-fsec first">Dimenzije ploče (mm)</div>
                <div className="fcl-fields">
                    <label className="fcl-fld">
                        <span>Širina</span>
                        <input type="number" inputMode="numeric" value={board.width}
                            onChange={e => setBoard({ ...board, width: Math.round(num(e.target.value)) })} />
                    </label>
                    <span className="fcl-x">×</span>
                    <label className="fcl-fld">
                        <span>Visina</span>
                        <input type="number" inputMode="numeric" value={board.height}
                            onChange={e => setBoard({ ...board, height: Math.round(num(e.target.value)) })} />
                    </label>
                </div>
                <div className="fcl-presets">
                    {BOARD_PRESETS.map(p => (
                        <button key={p.label} type="button"
                            className={`fcl-preset${board.width === p.w && board.height === p.h ? ' on' : ''}`}
                            onClick={() => setBoard({ width: p.w, height: p.h })}>{p.label}</button>
                    ))}
                </div>
                <div className="fcl-fsec">Rez i obrez (mm)</div>
                <div className="fcl-fields">
                    <label className="fcl-fld">
                        <span>Rez / pila</span>
                        <input type="number" inputMode="numeric" value={kerf}
                            onChange={e => setKerf(Math.max(0, num(e.target.value)))} />
                    </label>
                    <label className="fcl-fld">
                        <span>Obrez ruba</span>
                        <input type="number" inputMode="numeric" value={trim}
                            onChange={e => setTrim(Math.max(0, num(e.target.value)))} />
                    </label>
                </div>
                <div className="fcl-switch" role="switch" aria-checked={allowRotation} onClick={() => setAllowRotation(v => !v)}>
                    <span className="fcl-switch-tx">
                        <b>Rotacija komada</b>
                        <small>Okreni komad 90° ako bolje stane</small>
                    </span>
                    <span className={`fcl-track${allowRotation ? ' on' : ''}`}><span className="fcl-knob" /></span>
                </div>
                <button type="button" className="fcl-done" onClick={() => setSettingsOpen(false)}>Gotovo</button>
            </div>

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
const PALETTE = ['#3B82F6', '#12B886', '#F59E0B', '#8B5CF6', '#EC4899', '#06B6D4', '#65A30D', '#F97316'];

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

function ResultView({ result, board, colors, avgEff, onExpand }: {
    result: GroupPackResult; board: { width: number; height: number }; colors: SizeColors; avgEff: number; onExpand: (i: number) => void;
}) {
    const placed = result.sheets.reduce((s, sh) => s + sh.placements.length, 0);
    const { colorByKey, legend } = colors;
    const ringCol = avgEff >= 80 ? 'var(--fcl-green)' : avgEff >= 60 ? '#FF9F0A' : 'var(--fcl-red)';

    return (
        <>
            <div className="fcl-summary">
                <div className="fcl-ring" style={{ background: `conic-gradient(${ringCol} ${avgEff * 3.6}deg, var(--fcl-fill) 0)` }}>
                    <span className="fcl-ring-v">{avgEff}%</span>
                </div>
                <div className="fcl-summary-tx">
                    <div className="rl">Iskoristivost</div>
                    <div className="big">{result.sheets.length} <small>{plo(result.sheets.length)}</small></div>
                    <div className="sub">{placed} komada složeno · otpad {100 - avgEff}%</div>
                </div>
            </div>

            {result.unplaced.length > 0 && (
                <div className="fcl-warn">
                    <b>{result.unplaced.length}</b> {result.unplaced.length === 1 ? 'komad ne stane' : 'komada ne stane'} ni na praznu ploču:
                    {' '}{[...new Set(result.unplaced.map(p => `${p.width}×${p.height}`))].join(', ')}. Provjeri dimenzije ili obrez.
                </div>
            )}

            <div className="fcl-sheets">
                {result.sheets.map((sheet, i) => {
                    const cls = sheet.efficiency >= 80 ? 'good' : sheet.efficiency >= 60 ? 'ok' : 'low';
                    return (
                        <div key={i} className="fcl-sheet">
                            <div className="fcl-sheet-h">
                                <div>
                                    <div className="fcl-sheet-t">Ploča {i + 1}</div>
                                    <div className="fcl-sheet-s">{board.width}×{board.height} · {sheet.placements.length} kom</div>
                                </div>
                                <span className={`fcl-eff ${cls}`}>{Math.round(sheet.efficiency)}%</span>
                                <button type="button" className="fcl-sheet-zoom" onClick={() => onExpand(i)} aria-label="Uvećaj"><Maximize2 size={16} /></button>
                            </div>
                            <SheetSVG sheet={sheet} usable={result.usable} colorByKey={colorByKey} />
                        </div>
                    );
                })}
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
    const fs = Math.max(W, H) / (big ? 46 : 32);

    return (
        <svg className="fcl-svg" viewBox={`-18 -18 ${W + 36} ${H + 36}`} preserveAspectRatio="xMidYMid meet">
            <rect x={0} y={0} width={W} height={H} className="fcl-svg-board" strokeWidth={stroke} rx={W / 220} />
            {sheet.cuts.map((c, i) => (
                <line key={`c${i}`} x1={c.x1} y1={c.y1} x2={c.x2} y2={c.y2} className="fcl-svg-cut" strokeWidth={stroke * 0.6} strokeOpacity={0.32} />
            ))}
            {sheet.placements.map((p, i) => {
                const c = colorByKey.get(sizeKey(p.w, p.h)) || '#3B82F6';
                const short = Math.min(p.w, p.h);
                // Isti raspored kao u printu: širina uz gornji rub, visina uz
                // lijevi rub (okrenuto), a naziv u sredini prati DUŽU stranu
                // komada (uspravno na portretnim, vodoravno na pejzažnim).
                const edgeSize = Math.min(fs * 1.05, short / 3.2, p.w / 3.2, p.h / 3.2);
                const inset = edgeSize * 0.82;
                const band = inset * 1.8;
                const portrait = p.h > p.w;
                const availShort = (portrait ? p.w : p.h) - band;
                const availLong = (portrait ? p.h : p.w) - band;
                const label = `${i + 1}. ${p.name}${p.rotated ? ' ⟳' : ''}`;
                const nameSize = Math.min(fs * 0.92, availShort / 1.6, availLong / Math.max(4, label.length * 0.6));
                const ncx = p.x + (p.w + band) / 2;
                const ncy = p.y + (p.h + band) / 2;
                return (
                    <g key={i}>
                        <rect x={p.x} y={p.y} width={p.w} height={p.h} fill={c} fillOpacity={0.9} stroke="#fff" strokeWidth={stroke} rx={Math.min(7, short * 0.05)} />
                        {edgeSize >= fs * 0.5 && (
                            <>
                                <text x={p.x + p.w / 2} y={p.y + inset} fontSize={edgeSize} fill="#fff" fontWeight={700}
                                    textAnchor="middle" dominantBaseline="central" opacity={0.92}>{Math.round(p.w)}</text>
                                <text x={p.x + inset} y={p.y + p.h / 2} fontSize={edgeSize} fill="#fff" fontWeight={700}
                                    textAnchor="middle" dominantBaseline="central" opacity={0.92}
                                    transform={`rotate(-90 ${p.x + inset} ${p.y + p.h / 2})`}>{Math.round(p.h)}</text>
                                {nameSize >= fs * 0.42 && availShort > 0 && (
                                    <text x={ncx} y={ncy} fontSize={nameSize} fill="#fff" fontWeight={600}
                                        textAnchor="middle" dominantBaseline="central"
                                        transform={portrait ? `rotate(-90 ${ncx} ${ncy})` : undefined}>{label}</text>
                                )}
                            </>
                        )}
                    </g>
                );
            })}
        </svg>
    );
}
