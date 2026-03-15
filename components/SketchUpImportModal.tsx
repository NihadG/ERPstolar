'use client';

import { useState, useRef, useCallback } from 'react';
import Modal from './ui/Modal';
import type { Material, ProductMaterial } from '@/lib/types';
import { addMaterialToProduct } from '@/lib/services';
import { getGeminiClient } from '@/lib/gemini';
import {
  parseSketchUpCSV,
  calculateAll,
  recognizeMaterialType,
  getDefaultLayers,
  panelFormatAreaM2,
  DEFAULT_PANEL_FORMAT,
  type SketchUpComponent,
  type PanelFormat,
  type LayerDefinition,
  type CalculationResult,
  type OutputItem,
} from '@/lib/sketchupCalculator';
import './SketchUpImportModal.css';

// ---- AI MATCHING HELPERS ----

// Fallback: simple string matching if AI unavailable
function findBestMaterialMatchLocal(label: string, category: string, dbMaterials: Material[]): Material | null {
  if (!dbMaterials.length) return null;
  const lower = label.toLowerCase();

  const exact = dbMaterials.find(m => m.Name.toLowerCase() === lower);
  if (exact) return exact;

  const contains = dbMaterials.find(m => {
    const mLower = m.Name.toLowerCase();
    return mLower.includes(lower) || lower.includes(mLower);
  });
  if (contains) return contains;

  const words = lower.split(/[\s\/\-_]+/).filter(w => w.length > 2);
  let bestMatch: Material | null = null;
  let bestScore = 0;

  for (const mat of dbMaterials) {
    const matLower = mat.Name.toLowerCase();
    let score = 0;
    for (const word of words) {
      if (matLower.includes(word)) score++;
    }
    if (category === 'kant' || category === 'kant_siroka') {
      if (matLower.includes('kant') || matLower.includes('traka')) score += 2;
    }
    if (category === 'furnir' && matLower.includes('furnir')) score++;
    if (category === 'hpl' && matLower.includes('hpl')) score++;
    if (category === 'farbanje' && (matLower.includes('farb') || matLower.includes('lak'))) score++;
    if (category === 'ploca' && (matLower.includes('mdf') || matLower.includes('iveral') || matLower.includes('pal'))) score++;

    if (score > bestScore) {
      bestScore = score;
      bestMatch = mat;
    }
  }

  return bestScore >= 1 ? bestMatch : null;
}

// Gemini AI matching: send output labels + DB material names → get best matches
async function matchWithGeminiAI(
  outputItems: { label: string; category: string; unit: string }[],
  dbMaterials: Material[]
): Promise<Record<string, string>> {
  try {
    const client = getGeminiClient();
    const model = client.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const materialList = dbMaterials.map(m => `- ID:"${m.Material_ID}" Naziv:"${m.Name}" Kategorija:"${m.Category}" Jedinica:"${m.Unit}"`).join('\n');
    const itemList = outputItems.map((oi, i) => `${i}. "${oi.label}" (${oi.category}, ${oi.unit})`).join('\n');

    const prompt = `Ti si AI za stolarsku ERP aplikaciju. Moraš povezati kalkulirane stavke sa materijalima iz baze.

KALKULIRANE STAVKE (iz SketchUp importa):
${itemList}

MATERIJALI U BAZI:
${materialList}

PRAVILA:
1. Za svaku stavku pronađi NAJBOLJI match iz baze na osnovu naziva
2. "MDF 18" treba matchati na MDF ploču debljine 18mm
3. "Furnir / Hrast" treba matchati na furnir hrast materijal
4. "Kant traka" treba matchati na kant traku
5. "Lakiranje" ili "Farbanje" treba matchati na uslugu farbanja/lakiranja
6. "HPL / H3395" treba matchati na HPL materijal
7. Ako nema dobrog matcha, koristi prazan string

Vrati SAMO JSON objekat gdje je ključ INDEKS stavke (string), a vrijednost Material_ID iz baze:
{"0": "material-id-123", "1": "", "2": "material-id-456"}`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return {};

    return JSON.parse(jsonMatch[0]) as Record<string, string>;
  } catch (err) {
    console.warn('Gemini AI matching failed, using fallback:', err);
    return {};
  }
}

// ---- PROPS & STATE ----

interface SketchUpImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  productId: string;
  organizationId: string;
  materials: Material[];  // database materials catalog for matching
  onImportComplete: () => void;
  showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

interface MaterialMatchState {
  outputItem: OutputItem;
  materialGroup: string;   // parent material name
  matchedMaterialId: string;  // Material_ID from DB or empty
  matchedMaterial: Material | null;
}

export default function SketchUpImportModal({
  isOpen,
  onClose,
  productId,
  organizationId,
  materials: dbMaterials,
  onImportComplete,
  showToast,
}: SketchUpImportModalProps) {
  // Wizard state
  const [step, setStep] = useState(1);

  // Step 1: Upload
  const [file, setFile] = useState<File | null>(null);
  const [parseWarnings, setParseWarnings] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Step 2: Components review
  const [components, setComponents] = useState<SketchUpComponent[]>([]);
  const [panelFormat, setPanelFormat] = useState<PanelFormat>({ ...DEFAULT_PANEL_FORMAT });
  const [editingLayersIdx, setEditingLayersIdx] = useState<number | null>(null);

  // Step 3: Results & matching
  const [calcResults, setCalcResults] = useState<CalculationResult[]>([]);
  const [matchStates, setMatchStates] = useState<MaterialMatchState[]>([]);
  const [isAiMatching, setIsAiMatching] = useState(false);

  // Step 4: Import
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });
  const [importResults, setImportResults] = useState<{ success: number; failed: number; errors: string[] } | null>(null);

  // ---- RESET ----
  const resetWizard = useCallback(() => {
    setStep(1);
    setFile(null);
    setParseWarnings([]);
    setComponents([]);
    setPanelFormat({ ...DEFAULT_PANEL_FORMAT });
    setEditingLayersIdx(null);
    setCalcResults([]);
    setMatchStates([]);
    setImportResults(null);
    setImportProgress({ current: 0, total: 0 });
  }, []);

  const handleClose = () => {
    resetWizard();
    onClose();
  };

  // ---- STEP 1: FILE UPLOAD ----
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    setParseWarnings([]);

    try {
      const content = await selectedFile.text();
      const { components: parsed, warnings } = parseSketchUpCSV(content);
      setParseWarnings(warnings);

      if (parsed.length === 0) {
        return;
      }

      // Auto-detect layers for each component
      const enriched = parsed.map(comp => {
        const materialType = recognizeMaterialType(comp.material);
        return {
          ...comp,
          layers: getDefaultLayers(materialType, comp.thickness, comp.material, false),
        };
      });

      setComponents(enriched);
      setStep(2);
    } catch (err) {
      setParseWarnings(['Greška pri čitanju CSV datoteke']);
    }
  };

  // ---- STEP 2: COMPONENT EDITING ----
  const updateComponent = (idx: number, field: keyof SketchUpComponent, value: unknown) => {
    setComponents(prev => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], [field]: value };

      // Re-detect layers when material changes
      if (field === 'material') {
        const type = recognizeMaterialType(value as string);
        updated[idx].layers = getDefaultLayers(type, updated[idx].thickness, value as string, updated[idx].hasDoubleVeneer);
      }
      if (field === 'thickness') {
        const type = recognizeMaterialType(updated[idx].material);
        updated[idx].layers = getDefaultLayers(type, value as number, updated[idx].material, updated[idx].hasDoubleVeneer);
      }
      if (field === 'hasDoubleVeneer') {
        const type = recognizeMaterialType(updated[idx].material);
        updated[idx].layers = getDefaultLayers(type, updated[idx].thickness, updated[idx].material, value as boolean);
      }

      return updated;
    });
  };

  const updateLayer = (compIdx: number, layerIdx: number, field: keyof LayerDefinition, value: unknown) => {
    setComponents(prev => {
      const updated = [...prev];
      const layers = [...(updated[compIdx].layers || [])];
      layers[layerIdx] = { ...layers[layerIdx], [field]: value };
      updated[compIdx] = { ...updated[compIdx], layers };
      return updated;
    });
  };

  const addLayer = (compIdx: number) => {
    setComponents(prev => {
      const updated = [...prev];
      const layers = [...(updated[compIdx].layers || [])];
      layers.push({ type: 'ploca', materialLabel: 'MDF 18', thicknessMm: 18 });
      updated[compIdx] = { ...updated[compIdx], layers };
      return updated;
    });
  };

  const removeLayer = (compIdx: number, layerIdx: number) => {
    setComponents(prev => {
      const updated = [...prev];
      const layers = [...(updated[compIdx].layers || [])].filter((_, i) => i !== layerIdx);
      updated[compIdx] = { ...updated[compIdx], layers };
      return updated;
    });
  };

  const removeComponent = (idx: number) => {
    setComponents(prev => prev.filter((_, i) => i !== idx));
  };

  // ---- STEP 2 → 3: CALCULATE + AI MATCH ----
  const handleCalculate = async () => {
    const results = calculateAll(components, panelFormat);
    setCalcResults(results);
    setStep(3);
    setIsAiMatching(true);

    // Collect all output items for AI matching
    const allItems: { label: string; category: string; unit: string; rIdx: number; oIdx: number }[] = [];
    results.forEach((result, rIdx) => {
      result.outputItems.forEach((item, oIdx) => {
        allItems.push({ label: item.label, category: item.category, unit: item.unit, rIdx, oIdx });
      });
    });

    // Try Gemini AI matching first
    let aiMatches: Record<string, string> = {};
    try {
      aiMatches = await matchWithGeminiAI(
        allItems.map(ai => ({ label: ai.label, category: ai.category, unit: ai.unit })),
        dbMaterials
      );
    } catch (err) {
      console.warn('AI matching failed:', err);
    }

    // Build match states: use AI result, fallback to local matching
    const matches: MaterialMatchState[] = [];
    let itemIdx = 0;
    for (const result of results) {
      for (const item of result.outputItems) {
        const aiMatchId = aiMatches[String(itemIdx)];
        let matchedMaterial: Material | null = null;

        if (aiMatchId) {
          matchedMaterial = dbMaterials.find(m => m.Material_ID === aiMatchId) || null;
        }

        // Fallback to local string matching if AI didn't match
        if (!matchedMaterial) {
          matchedMaterial = findBestMaterialMatchLocal(item.label, item.category, dbMaterials);
        }

        matches.push({
          outputItem: item,
          materialGroup: result.materialName,
          matchedMaterialId: matchedMaterial?.Material_ID || '',
          matchedMaterial,
        });
        itemIdx++;
      }
    }
    setMatchStates(matches);
    setIsAiMatching(false);
  };

  // ---- STEP 3: MATCH EDITING ----
  const updateMatch = (idx: number, materialId: string) => {
    setMatchStates(prev => {
      const updated = [...prev];
      const mat = dbMaterials.find(m => m.Material_ID === materialId) || null;
      updated[idx] = {
        ...updated[idx],
        matchedMaterialId: materialId,
        matchedMaterial: mat,
      };
      return updated;
    });
  };

  // ---- STEP 3 → 4: IMPORT ----
  const handleImport = async () => {
    // Only import items that have a matched material
    const toImport = matchStates.filter(ms => ms.matchedMaterial);
    if (toImport.length === 0) {
      showToast('Nema materijala za import — povežite barem jedan materijal iz baze', 'error');
      return;
    }

    setIsImporting(true);
    setImportProgress({ current: 0, total: toImport.length });
    setStep(4);

    const results = { success: 0, failed: 0, errors: [] as string[] };

    for (let i = 0; i < toImport.length; i++) {
      const ms = toImport[i];
      const mat = ms.matchedMaterial!;
      const oi = ms.outputItem;

      const productMaterial: Partial<ProductMaterial> = {
        Product_ID: productId,
        Material_ID: mat.Material_ID,
        Material_Name: mat.Name,
        Quantity: oi.quantity,
        Unit: oi.unit === 'kom' ? mat.Unit || 'kom' : oi.unit,
        Unit_Price: mat.Default_Unit_Price || 0,
        Supplier: mat.Default_Supplier || '',
        Status: 'Nije naručeno',
      };

      try {
        const result = await addMaterialToProduct(productMaterial, organizationId);
        if (result.success) {
          results.success++;
        } else {
          results.failed++;
          results.errors.push(`${oi.label}: ${result.message}`);
        }
      } catch (err) {
        results.failed++;
        results.errors.push(`${oi.label}: ${err instanceof Error ? err.message : 'Greška'}`);
      }

      setImportProgress({ current: i + 1, total: toImport.length });
    }

    setImportResults(results);
    setIsImporting(false);
    onImportComplete();
  };

  // ---- RENDER ----
  const getStepState = (s: number) => {
    if (step > s) return 'completed';
    if (step === s) return 'active';
    return '';
  };

  const formatArea = panelFormatAreaM2(panelFormat);

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="material-icons-round">upload_file</span>
          <span>SketchUp Import</span>
        </div>
      }
      size="xl"
    >
      <div className="sketchup-import-wizard">
        {/* Step Indicator */}
        <div className="sketchup-steps">
          {['Upload', 'Komponente', 'Rezultati', 'Import'].map((label, idx) => (
            <div key={idx}>
              <div className={`sketchup-step ${getStepState(idx + 1)}`}>
                <div className="step-num">
                  {getStepState(idx + 1) === 'completed' ? (
                    <span className="material-icons-round" style={{ fontSize: '16px' }}>check</span>
                  ) : idx + 1}
                </div>
                <span className="step-label">{label}</span>
              </div>
              {idx < 3 && <div className={`sketchup-step-line ${step > idx + 1 ? 'completed' : ''}`} />}
            </div>
          ))}
        </div>

        {/* Step 1: Upload CSV */}
        {step === 1 && (
          <>
            <div
              className={`sketchup-dropzone ${file ? 'has-file' : ''}`}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleFileSelect}
                hidden
              />
              {file ? (
                <>
                  <div className="icon-container">
                    <span className="material-icons-round">check_circle</span>
                  </div>
                  <h3>{file.name}</h3>
                  <p>{(file.size / 1024).toFixed(1)} KB</p>
                </>
              ) : (
                <>
                  <div className="icon-container">
                    <span className="material-icons-round">cloud_upload</span>
                  </div>
                  <h3>Kliknite za upload CSV iz SketchUp-a</h3>
                  <p>Format: Naziv;Visina;Sirina;Debljina;Kolicina;Materijal</p>
                </>
              )}
            </div>

            {parseWarnings.length > 0 && (
              <div className="sketchup-warnings">
                <h5>
                  <span className="material-icons-round" style={{ fontSize: '18px' }}>warning</span>
                  Upozorenja
                </h5>
                <ul>
                  {parseWarnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </div>
            )}
          </>
        )}

        {/* Step 2: Component Review */}
        {step === 2 && (
          <>
            {/* Panel Format Config */}
            <div className="sketchup-format-config">
              <label>Format ploče:</label>
              <input
                type="number"
                value={panelFormat.width}
                onChange={e => setPanelFormat(p => ({ ...p, width: parseFloat(e.target.value) || 0 }))}
              />
              <span className="format-x">×</span>
              <input
                type="number"
                value={panelFormat.height}
                onChange={e => setPanelFormat(p => ({ ...p, height: parseFloat(e.target.value) || 0 }))}
              />
              <span className="format-area">mm ({formatArea.toFixed(3)} m²)</span>
            </div>

            {/* Components Table */}
            <div className="sketchup-table-wrapper">
              <table className="sketchup-table">
                <thead>
                  <tr>
                    <th>Naziv</th>
                    <th style={{ width: 80 }}>Visina</th>
                    <th style={{ width: 80 }}>Širina</th>
                    <th style={{ width: 70 }}>Debljina</th>
                    <th style={{ width: 60 }}>Kol.</th>
                    <th>Materijal</th>
                    <th style={{ width: 90 }}>Tip</th>
                    <th style={{ width: 100 }}>Opcije</th>
                    <th style={{ width: 40 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {components.map((comp, idx) => {
                    const mType = recognizeMaterialType(comp.material);
                    const isFurnir = mType === 'furnir';
                    const isMdf = mType === 'mdf';

                    return (
                      <>
                        <tr key={idx}>
                          <td>
                            <input
                              type="text"
                              value={comp.name}
                              onChange={e => updateComponent(idx, 'name', e.target.value)}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              value={comp.height}
                              onChange={e => updateComponent(idx, 'height', parseFloat(e.target.value) || 0)}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              value={comp.width}
                              onChange={e => updateComponent(idx, 'width', parseFloat(e.target.value) || 0)}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              value={comp.thickness}
                              onChange={e => updateComponent(idx, 'thickness', parseFloat(e.target.value) || 0)}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              value={comp.quantity}
                              min={1}
                              onChange={e => updateComponent(idx, 'quantity', parseInt(e.target.value) || 1)}
                            />
                          </td>
                          <td>
                            <input
                              type="text"
                              value={comp.material}
                              onChange={e => updateComponent(idx, 'material', e.target.value)}
                            />
                          </td>
                          <td>
                            <span className={`material-type-badge badge-${mType}`}
                              style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase' }}
                            >
                              {mType}
                            </span>
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
                              {isFurnir && (
                                <label className="sketchup-checkbox" title="Obje strane skupi furnir (obostrani)">
                                  <input
                                    type="checkbox"
                                    checked={comp.hasDoubleVeneer || false}
                                    onChange={e => updateComponent(idx, 'hasDoubleVeneer', e.target.checked)}
                                  />
                                  <span style={{ fontSize: '11px' }}>Obostrani</span>
                                </label>
                              )}
                              {isMdf && (
                                <label className="sketchup-checkbox" title="Obje strane vidljive (default: Da)">
                                  <input
                                    type="checkbox"
                                    checked={comp.hasBothSidesVisible !== false}
                                    onChange={e => updateComponent(idx, 'hasBothSidesVisible', e.target.checked)}
                                  />
                                  <span style={{ fontSize: '11px' }}>2 strane</span>
                                </label>
                              )}
                              <button
                                className="icon-btn"
                                onClick={() => setEditingLayersIdx(editingLayersIdx === idx ? null : idx)}
                                title="Uredi slojeve"
                                style={{ padding: '2px 4px' }}
                              >
                                <span className="material-icons-round" style={{ fontSize: '16px' }}>layers</span>
                              </button>
                            </div>
                          </td>
                          <td>
                            <button className="icon-btn danger" onClick={() => removeComponent(idx)}>
                              <span className="material-icons-round" style={{ fontSize: '16px' }}>close</span>
                            </button>
                          </td>
                        </tr>

                        {/* Layer Editor (inline) */}
                        {editingLayersIdx === idx && (
                          <tr key={`layer-${idx}`}>
                            <td colSpan={9}>
                              <div className="sketchup-layer-editor">
                                <h5>
                                  Slojevi za: {comp.name}
                                  <span style={{ fontWeight: 400, color: 'var(--text-secondary)', marginLeft: '8px' }}>
                                    ({comp.layers?.length || 0} slojeva)
                                  </span>
                                </h5>
                                {(comp.layers || []).map((layer, lIdx) => (
                                  <div className="sketchup-layer-row" key={lIdx}>
                                    <select
                                      value={layer.type}
                                      onChange={e => updateLayer(idx, lIdx, 'type', e.target.value)}
                                      style={{ width: '90px', fontSize: '12px' }}
                                    >
                                      <option value="ploca">Ploča</option>
                                      <option value="furnir">Furnir</option>
                                      <option value="hpl">HPL</option>
                                      <option value="farbanje">Farbanje</option>
                                    </select>

                                    <input
                                      type="text"
                                      value={layer.materialLabel}
                                      onChange={e => updateLayer(idx, lIdx, 'materialLabel', e.target.value)}
                                      className="sketchup-layer-input"
                                      placeholder="Naziv materijala"
                                      style={{ fontSize: '12px' }}
                                    />

                                    <input
                                      type="number"
                                      value={layer.thicknessMm}
                                      onChange={e => updateLayer(idx, lIdx, 'thicknessMm', parseFloat(e.target.value) || 0)}
                                      className="sketchup-layer-thickness"
                                      style={{ fontSize: '12px' }}
                                      title="Debljina (mm)"
                                    />
                                    <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>mm</span>

                                    {(layer.type === 'furnir' || layer.type === 'hpl') && (
                                      <label className="sketchup-checkbox">
                                        <input
                                          type="checkbox"
                                          checked={layer.isKK || false}
                                          onChange={e => updateLayer(idx, lIdx, 'isKK', e.target.checked)}
                                        />
                                        <span>KK</span>
                                      </label>
                                    )}

                                    <button
                                      className="icon-btn danger"
                                      onClick={() => removeLayer(idx, lIdx)}
                                      style={{ padding: '2px' }}
                                    >
                                      <span className="material-icons-round" style={{ fontSize: '14px' }}>remove</span>
                                    </button>
                                  </div>
                                ))}
                                <button
                                  className="btn btn-sm btn-outline"
                                  onClick={() => addLayer(idx)}
                                  style={{ marginTop: '8px', fontSize: '12px' }}
                                >
                                  <span className="material-icons-round" style={{ fontSize: '14px' }}>add</span>
                                  Dodaj sloj
                                </button>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="sketchup-actions">
              <div className="left">
                <button className="btn btn-secondary" onClick={() => { setStep(1); setFile(null); setComponents([]); }}>
                  <span className="material-icons-round">arrow_back</span>
                  Nazad
                </button>
              </div>
              <div className="right">
                <button
                  className="btn btn-primary"
                  onClick={handleCalculate}
                  disabled={components.length === 0}
                >
                  <span className="material-icons-round">calculate</span>
                  Izračunaj materijale
                </button>
              </div>
            </div>
          </>
        )}

        {/* Step 3: Results & Matching */}
        {step === 3 && (
          <>
            {calcResults.map((result, rIdx) => (
              <div className="sketchup-results-group" key={rIdx}>
                <div className="sketchup-results-header">
                  <h4>{result.materialName || 'Nepoznat'}</h4>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {isAiMatching && <span className="sketchup-ai-badge">🤖 AI analizira...</span>}
                    <span className={`material-type-badge badge-${result.materialType}`}>
                      {result.materialType}
                    </span>
                  </div>
                </div>

                {matchStates
                  .filter(ms => ms.materialGroup === result.materialName)
                  .map((ms, msIdx) => {
                    // Find the actual index in matchStates
                    const globalIdx = matchStates.findIndex(
                      m => m === ms
                    );
                    const oi = ms.outputItem;

                    return (
                      <div className="sketchup-result-item" key={msIdx}>
                        <span className={`sketchup-result-label ${oi.isKK ? 'is-kk' : ''}`}>
                          {oi.label}
                          {oi.isKK && <span style={{ marginLeft: '4px', fontSize: '10px' }}>(KK)</span>}
                        </span>

                        <span className="sketchup-result-qty">
                          {oi.quantity.toFixed(oi.unit === 'kom' ? 2 : 2)} {oi.unit}
                        </span>

                        <div className="sketchup-result-match">
                          <select
                            value={ms.matchedMaterialId}
                            onChange={e => updateMatch(globalIdx, e.target.value)}
                            className={ms.matchedMaterial ? 'matched' : 'unmatched'}
                          >
                            <option value="">— Izaberi materijal —</option>
                            {dbMaterials.map(m => (
                              <option key={m.Material_ID} value={m.Material_ID}>
                                {m.Name} ({m.Unit})
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    );
                  })}
              </div>
            ))}

            {matchStates.length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-secondary)' }}>
                <span className="material-icons-round" style={{ fontSize: '48px', marginBottom: '12px', display: 'block' }}>
                  inventory_2
                </span>
                Nema rezultata kalkulacije
              </div>
            )}

            <div className="sketchup-actions">
              <div className="left">
                <button className="btn btn-secondary" onClick={() => setStep(2)}>
                  <span className="material-icons-round">arrow_back</span>
                  Nazad
                </button>
              </div>
              <div className="right">
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)', alignSelf: 'center' }}>
                  {matchStates.filter(m => m.matchedMaterial).length} / {matchStates.length} povezano
                </span>
                <button
                  className="btn btn-success"
                  onClick={handleImport}
                  disabled={matchStates.filter(m => m.matchedMaterial).length === 0}
                >
                  <span className="material-icons-round">save</span>
                  Dodaj {matchStates.filter(m => m.matchedMaterial).length} materijala
                </button>
              </div>
            </div>
          </>
        )}

        {/* Step 4: Import Progress / Results */}
        {step === 4 && (
          <div className="sketchup-progress">
            {isImporting ? (
              <>
                <span className="material-icons-round" style={{ fontSize: '48px', color: '#3b82f6', animation: 'spin 1s linear infinite' }}>
                  sync
                </span>
                <div className="sketchup-progress-bar">
                  <div
                    className="sketchup-progress-fill"
                    style={{ width: `${importProgress.total > 0 ? (importProgress.current / importProgress.total) * 100 : 0}%` }}
                  />
                </div>
                <p>
                  Dodajem materijale... {importProgress.current} / {importProgress.total}
                </p>
              </>
            ) : importResults && (
              <>
                <span className="material-icons-round" style={{ fontSize: '48px', color: importResults.failed > 0 ? '#f59e0b' : '#10b981', marginBottom: '12px', display: 'block' }}>
                  {importResults.failed > 0 ? 'warning' : 'check_circle'}
                </span>

                <h3 style={{ margin: '0 0 8px', fontSize: '18px' }}>Import završen</h3>
                <p style={{ margin: '0 0 16px' }}>
                  <strong style={{ color: '#10b981' }}>{importResults.success}</strong> uspješno
                  {importResults.failed > 0 && (
                    <>, <strong style={{ color: '#ef4444' }}>{importResults.failed}</strong> neuspješno</>
                  )}
                </p>

                {importResults.errors.length > 0 && (
                  <div className="sketchup-warnings" style={{ textAlign: 'left', marginBottom: '16px' }}>
                    <h5>
                      <span className="material-icons-round" style={{ fontSize: '16px' }}>error</span>
                      Greške
                    </h5>
                    <ul>
                      {importResults.errors.map((err, i) => <li key={i}>{err}</li>)}
                    </ul>
                  </div>
                )}

                <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                  <button className="btn btn-secondary" onClick={resetWizard}>
                    <span className="material-icons-round">refresh</span>
                    Novi import
                  </button>
                  <button className="btn btn-primary" onClick={handleClose}>
                    <span className="material-icons-round">check</span>
                    Zatvori
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
