'use client';

// ════════════════════════════════════════════════════════════════════
// KALKULATOR PLOČA — "koliko mi ploča treba?"
//
// Mali optimizator koji se otvara iz izbora materijala (kategorija
// "Ploče i trake"): unesu se dimenzije i količine komada, dobije se
// BROJ PLOČA i skica rasporeda, pa se taj broj jednim klikom prenese
// kao količina odabranog materijala.
//
// Isti motor kao krojenje na kartici proizvoda (lib/cutlist) i isti
// crtež kao print (renderSheetSvg) — bez druge računice paralelno.
// ════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CutPart, CutlistSettings, GroupPackResult } from '@/lib/cutlist/types';
import { packGroups } from '@/lib/cutlist/optimizer';
import { buildProductCutList } from '@/lib/cutlist/persist';
import { parseCutlistText } from '@/lib/cutlist/parse';
import { BOARD_PRESETS, boardDimsFor, saveBoardDims } from '@/lib/cutlist/boardPrefs';
import { renderSheetSvg } from '@/lib/print/cutlistDocument';
import './BoardCalculatorModal.css';

interface Row {
    id: string;
    name: string;
    w: string;
    h: string;
    qty: string;
}

const MATERIAL_KEY = 'kalkulator';

function emptyRow(): Row {
    return { id: `r${Math.random().toString(36).slice(2, 9)}`, name: '', w: '', h: '', qty: '1' };
}

/** Je li jedinica materijala kvadratura (tada se primjenjuje m², ne komad). */
function isAreaUnit(unit: string): boolean {
    return /m2|m²/i.test((unit || '').replace(/\s/g, ''));
}

export interface BoardCalculatorModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** Materijal za koji se računa (zbog zapamćenih dimenzija ploče). */
    materialId: string;
    materialName: string;
    unit: string;
    /** Trenutna količina — prikazuje se da se vidi šta se mijenja. */
    currentQuantity: number;
    /** Primjena: `quantity` je već preračunat u jedinicu materijala. */
    onApply: (quantity: number, sheets: number, board: { w: number; h: number }) => void;
}

export default function BoardCalculatorModal({
    isOpen,
    onClose,
    materialId,
    materialName,
    unit,
    currentQuantity,
    onApply,
}: BoardCalculatorModalProps) {
    const [boardW, setBoardW] = useState(2800);
    const [boardH, setBoardH] = useState(2070);
    const [kerf, setKerf] = useState(4);
    const [trim, setTrim] = useState(10);
    const [allowRotation, setAllowRotation] = useState(true);
    const [rows, setRows] = useState<Row[]>([emptyRow(), emptyRow(), emptyRow()]);
    const [result, setResult] = useState<GroupPackResult | null>(null);
    const [busy, setBusy] = useState(false);
    const [showPaste, setShowPaste] = useState(false);
    const [pasteText, setPasteText] = useState('');
    const [error, setError] = useState('');

    // Reset na otvaranje + zapamćena ploča za ovaj materijal.
    useEffect(() => {
        if (!isOpen) return;
        const dims = boardDimsFor(materialId);
        setBoardW(dims.w);
        setBoardH(dims.h);
        setRows([emptyRow(), emptyRow(), emptyRow()]);
        setResult(null);
        setError('');
        setShowPaste(false);
        setPasteText('');
    }, [isOpen, materialId]);

    useEffect(() => {
        if (!isOpen) return;
        const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', onEsc);
        return () => document.removeEventListener('keydown', onEsc);
    }, [isOpen, onClose]);

    const parts = useMemo<CutPart[]>(() => {
        const out: CutPart[] = [];
        rows.forEach((r, i) => {
            const w = parseFloat(r.w.replace(',', '.'));
            const h = parseFloat(r.h.replace(',', '.'));
            const qty = Math.round(parseFloat(r.qty.replace(',', '.')) || 0);
            if (!(w > 0) || !(h > 0) || qty <= 0) return;
            out.push({
                id: r.id,
                name: r.name.trim() || `Komad ${i + 1}`,
                width: w,
                height: h,
                qty,
                materialRaw: materialName,
                materialKey: MATERIAL_KEY,
            });
        });
        return out;
    }, [rows, materialName]);

    const totalPieces = parts.reduce((s, p) => s + p.qty, 0);
    const totalAreaM2 = parts.reduce((s, p) => s + (p.width * p.height * p.qty), 0) / 1e6;

    function updateRow(id: string, field: keyof Omit<Row, 'id'>, value: string) {
        setRows(prev => {
            const next = prev.map(r => (r.id === id ? { ...r, [field]: value } : r));
            // Zadnji red se popunjava → odmah ponudi novi (unos bez klikanja).
            if (next[next.length - 1].id === id && value.trim()) next.push(emptyRow());
            return next;
        });
        setResult(null);
    }

    function removeRow(id: string) {
        setRows(prev => (prev.length > 1 ? prev.filter(r => r.id !== id) : [emptyRow()]));
        setResult(null);
    }

    function applyPaste() {
        const parsed = parseCutlistText(pasteText, materialName);
        if (parsed.parts.length === 0) {
            setError('Iz zalijepljenog teksta nije prepoznat nijedan komad.');
            return;
        }
        setRows([
            ...parsed.parts.map(p => ({
                id: `r${Math.random().toString(36).slice(2, 9)}`,
                name: p.name,
                w: String(p.width),
                h: String(p.height),
                qty: String(p.qty),
            })),
            emptyRow(),
        ]);
        setError('');
        setShowPaste(false);
        setPasteText('');
        setResult(null);
    }

    async function calculate() {
        if (parts.length === 0) {
            setError('Unesite bar jedan komad (širina, visina, količina).');
            return;
        }
        if (!(boardW > 0) || !(boardH > 0)) {
            setError('Dimenzije ploče moraju biti veće od nule.');
            return;
        }
        setError('');
        setBusy(true);
        setResult(null);
        try {
            const settings: CutlistSettings = { kerf, trim, allowRotation };
            const [res] = await packGroups(
                [{ parts, board: { width: boardW, height: boardH }, allowRotation }],
                settings,
                { timeBudgetMs: 2500 },
            );
            setResult(res);
            saveBoardDims(materialId, boardW, boardH);
        } catch {
            setError('Greška pri računanju rasporeda.');
        } finally {
            setBusy(false);
        }
    }

    // Skice ploča — isti crtež kao print (preko snimljenog oblika liste).
    const preview = useMemo(() => {
        if (!result || result.sheets.length === 0) return null;
        const cutList = buildProductCutList({
            name: 'Kalkulator',
            parts,
            settings: { kerf, trim, allowRotation },
            results: [result],
            groups: [{ key: MATERIAL_KEY, label: materialName }],
        });
        return cutList.Groups[0];
    }, [result, parts, kerf, trim, allowRotation, materialName]);

    const sheetsNeeded = result?.sheets.length ?? 0;
    const areaUnit = isAreaUnit(unit);
    const boardAreaM2 = (boardW * boardH) / 1e6;
    const applyQty = areaUnit
        ? Math.round(sheetsNeeded * boardAreaM2 * 100) / 100
        : sheetsNeeded;

    const avgEff = result && result.sheets.length
        ? result.sheets.reduce((s, sh) => s + sh.efficiency, 0) / result.sheets.length
        : 0;
    const reuseM2 = result
        ? result.sheets.reduce((s, sh) => s + sh.offcuts.reduce((a, o) => a + o.w * o.h, 0), 0) / 1e6
        : 0;

    if (!isOpen || typeof window === 'undefined') return null;

    return createPortal(
        <>
            <div className="bcm-overlay" onClick={onClose} />
            <div className="bcm-modal" role="dialog" aria-label="Kalkulator ploča">
                <div className="bcm-header">
                    <div className="bcm-header-left">
                        <div className="bcm-header-icon">
                            <span className="material-icons-round">grid_on</span>
                        </div>
                        <div>
                            <div className="bcm-title">Kalkulator ploča</div>
                            <div className="bcm-subtitle">{materialName}</div>
                        </div>
                    </div>
                    <button className="bcm-close" onClick={onClose} title="Zatvori">
                        <span className="material-icons-round">close</span>
                    </button>
                </div>

                <div className="bcm-body">
                    {/* ── Lijevo: unos ── */}
                    <div className="bcm-input-pane">
                        <div className="bcm-section">
                            <div className="bcm-section-title">Ploča</div>
                            <div className="bcm-board-row">
                                <select
                                    className="bcm-select"
                                    value={BOARD_PRESETS.some(p => p.w === boardW && p.h === boardH)
                                        ? `${boardW}x${boardH}` : 'custom'}
                                    onChange={e => {
                                        const preset = BOARD_PRESETS.find(p => `${p.w}x${p.h}` === e.target.value);
                                        if (preset) { setBoardW(preset.w); setBoardH(preset.h); setResult(null); }
                                    }}
                                >
                                    {BOARD_PRESETS.map(p => (
                                        <option key={p.label} value={`${p.w}x${p.h}`}>{p.label}</option>
                                    ))}
                                    <option value="custom">Vlastita dimenzija</option>
                                </select>
                                <div className="bcm-dims">
                                    <input
                                        type="number" value={boardW} min={1}
                                        onChange={e => { setBoardW(parseFloat(e.target.value) || 0); setResult(null); }}
                                        onFocus={e => e.target.select()}
                                    />
                                    <span>×</span>
                                    <input
                                        type="number" value={boardH} min={1}
                                        onChange={e => { setBoardH(parseFloat(e.target.value) || 0); setResult(null); }}
                                        onFocus={e => e.target.select()}
                                    />
                                    <span className="bcm-unit">mm</span>
                                </div>
                            </div>
                            <div className="bcm-settings-row">
                                <label>
                                    Rez (mm)
                                    <input type="number" value={kerf} min={0} step={0.5}
                                        onChange={e => { setKerf(parseFloat(e.target.value) || 0); setResult(null); }} />
                                </label>
                                <label>
                                    Obrez ruba (mm)
                                    <input type="number" value={trim} min={0}
                                        onChange={e => { setTrim(parseFloat(e.target.value) || 0); setResult(null); }} />
                                </label>
                                <label className="bcm-check">
                                    <input type="checkbox" checked={allowRotation}
                                        onChange={e => { setAllowRotation(e.target.checked); setResult(null); }} />
                                    Rotacija komada
                                </label>
                            </div>
                        </div>

                        <div className="bcm-section bcm-parts-section">
                            <div className="bcm-section-title">
                                Komadi
                                <button className="bcm-link" onClick={() => setShowPaste(v => !v)}>
                                    <span className="material-icons-round">content_paste</span>
                                    {showPaste ? 'Zatvori' : 'Zalijepi iz Excela'}
                                </button>
                            </div>

                            {showPaste && (
                                <div className="bcm-paste">
                                    <textarea
                                        value={pasteText}
                                        onChange={e => setPasteText(e.target.value)}
                                        placeholder={'naziv\tdužina\tvisina\tkom\nBok\t720\t500\t4'}
                                        rows={5}
                                    />
                                    <button className="bcm-btn primary small" onClick={applyPaste}>Učitaj</button>
                                </div>
                            )}

                            <div className="bcm-table-head">
                                <span>Naziv</span>
                                <span>Širina</span>
                                <span>Visina</span>
                                <span>Kom</span>
                                <span />
                            </div>
                            <div className="bcm-table">
                                {rows.map(r => (
                                    <div className="bcm-table-row" key={r.id}>
                                        <input
                                            value={r.name} placeholder="npr. Bok"
                                            onChange={e => updateRow(r.id, 'name', e.target.value)}
                                        />
                                        <input
                                            type="number" value={r.w} placeholder="mm" min={0}
                                            onChange={e => updateRow(r.id, 'w', e.target.value)}
                                            onFocus={e => e.target.select()}
                                        />
                                        <input
                                            type="number" value={r.h} placeholder="mm" min={0}
                                            onChange={e => updateRow(r.id, 'h', e.target.value)}
                                            onFocus={e => e.target.select()}
                                        />
                                        <input
                                            type="number" value={r.qty} min={0}
                                            onChange={e => updateRow(r.id, 'qty', e.target.value)}
                                            onFocus={e => e.target.select()}
                                        />
                                        <button className="bcm-row-remove" onClick={() => removeRow(r.id)} title="Ukloni red">
                                            <span className="material-icons-round">close</span>
                                        </button>
                                    </div>
                                ))}
                            </div>
                            <button className="bcm-add-row" onClick={() => setRows(prev => [...prev, emptyRow()])}>
                                <span className="material-icons-round">add</span> Dodaj red
                            </button>
                        </div>
                    </div>

                    {/* ── Desno: rezultat ── */}
                    <div className="bcm-result-pane">
                        {error && <div className="bcm-error">{error}</div>}

                        {!result && !busy && (
                            <div className="bcm-empty">
                                <span className="material-icons-round">calculate</span>
                                <p>Unesite komade pa pokrenite račun</p>
                                <p className="hint">
                                    {totalPieces > 0
                                        ? `${totalPieces} kom • ${totalAreaM2.toFixed(2)} m² komada`
                                        : 'Širina, visina i količina su obavezni'}
                                </p>
                            </div>
                        )}

                        {busy && (
                            <div className="bcm-empty">
                                <span className="material-icons-round spin">autorenew</span>
                                <p>Računam raspored…</p>
                            </div>
                        )}

                        {result && !busy && (
                            <>
                                <div className="bcm-headline">
                                    <div className="bcm-big">{sheetsNeeded}</div>
                                    <div className="bcm-big-label">
                                        {sheetsNeeded === 1 ? 'ploča' : 'ploča'} {boardW}×{boardH}
                                    </div>
                                </div>
                                <div className="bcm-stats">
                                    <div><span>Iskorišteno</span><strong>{avgEff.toFixed(1)}%</strong></div>
                                    <div><span>Komadi</span><strong>{totalPieces} kom / {totalAreaM2.toFixed(2)} m²</strong></div>
                                    <div><span>Ostatak za dalje</span><strong>{reuseM2.toFixed(2)} m²</strong></div>
                                </div>

                                {result.unplaced.length > 0 && (
                                    <div className="bcm-warn">
                                        Ne staju na ploču: {result.unplaced.map(p => p.name).join(', ')}
                                    </div>
                                )}

                                {preview && (
                                    <div className="bcm-sheets">
                                        {preview.Sheets.map((sheet, i) => (
                                            <div className="bcm-sheet" key={i}>
                                                <div className="bcm-sheet-head">
                                                    <span>Ploča {i + 1}</span>
                                                    <span>{sheet.Efficiency.toFixed(1)}%</span>
                                                </div>
                                                <div
                                                    className="bcm-sheet-svg"
                                                    dangerouslySetInnerHTML={{
                                                        __html: renderSheetSvg(sheet, preview.Board_Width, preview.Board_Height, trim),
                                                    }}
                                                />
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>

                <div className="bcm-footer">
                    <div className="bcm-footer-info">
                        {result
                            ? <>Trenutna količina: <strong>{currentQuantity}</strong> {unit} → nova: <strong>{applyQty}</strong> {unit}</>
                            : <>{totalPieces} kom • {totalAreaM2.toFixed(2)} m²</>}
                    </div>
                    <div className="bcm-footer-actions">
                        <button className="bcm-btn secondary" onClick={onClose}>Otkaži</button>
                        <button className="bcm-btn" onClick={calculate} disabled={busy || parts.length === 0}>
                            {busy ? 'Računam…' : 'Izračunaj'}
                        </button>
                        <button
                            className="bcm-btn primary"
                            onClick={() => onApply(applyQty, sheetsNeeded, { w: boardW, h: boardH })}
                            disabled={!result || sheetsNeeded === 0}
                        >
                            {result ? `Primijeni ${applyQty} ${unit}` : 'Primijeni'}
                        </button>
                    </div>
                </div>
            </div>
        </>,
        document.body,
    );
}
