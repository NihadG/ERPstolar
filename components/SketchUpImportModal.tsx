'use client';

import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import Modal from './ui/Modal';
import type { Material, ProductMaterial } from '@/lib/types';
import { MATERIAL_CATEGORIES } from '@/lib/types';
import { addMaterialToProduct, saveMaterial } from '@/lib/services';
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
  type MaterialType,
} from '@/lib/sketchupCalculator';
import './SketchUpImportModal.css';

// ---- DEFAULT PANEL FORMATS PER TYPE ----
const DEFAULT_FORMATS: Record<string, PanelFormat> = {
  iveral: { width: 2800, height: 2070 },
  mdf:    { width: 2800, height: 2070 },
  furnir: { width: 2800, height: 2070 },
  hpl:    { width: 2800, height: 1310 },
  unknown:{ width: 2800, height: 2070 },
};

// ---- AI MATCHING ----
// Extract key codes from material name, e.g. "Iveral / U732" → ["u732"], "HPL / U999" → ["u999"]
// Also catches codes like "H3309", "ST9", "W1000", "F501"
function extractMaterialCodes(name: string): string[] {
  const lower = name.toLowerCase();
  // Match alphanumeric codes: letter(s) + digits, or just digits 3+
  const codePattern = /\b([a-z]{1,3}\d{2,5})\b/g;
  const codes: string[] = [];
  let m;
  while ((m = codePattern.exec(lower)) !== null) {
    const code = m[1];
    // Skip generic words that look like codes
    const skip = new Set(['mdf', 'hpl', 'dtd', 'pal', 'abs', 'kk']);
    if (!skip.has(code)) codes.push(code);
  }
  // Also extract standalone number codes (e.g. "18", "732")
  const numPattern = /\b(\d{3,5})\b/g;
  while ((m = numPattern.exec(lower)) !== null) {
    if (!codes.includes(m[1])) codes.push(m[1]);
  }
  return codes;
}

// Extract thickness from label, e.g. "MDF 18" → 18, "Iveral 18mm" → 18
function extractThickness(label: string): number | null {
  const m = label.match(/\b(\d{1,2})\s*mm\b/i) || label.match(/\b(\d{1,2})\b/);
  if (m) {
    const t = parseInt(m[1]);
    if (t >= 1 && t <= 50) return t; // Reasonable panel thickness range
  }
  return null;
}

function findBestMaterialMatchLocal(
  label: string,
  category: string,
  materialGroup: string,
  dbMaterials: Material[]
): Material | null {
  if (!dbMaterials.length) return null;

  const lower = label.toLowerCase();
  const groupCodes = extractMaterialCodes(materialGroup);
  const labelCodes = extractMaterialCodes(label);
  const allCodes = Array.from(new Set([...groupCodes, ...labelCodes]));
  const thickness = extractThickness(label);

  // --- KANT TRAKA: must be kant + match parent material code ---
  if (category === 'kant' || category === 'kant_siroka') {
    const isWide = category === 'kant_siroka' || lower.includes('široka') || lower.includes('siroka');
    const kantCandidates = dbMaterials.filter(m => {
      const n = m.Name.toLowerCase();
      return n.includes('kant') || n.includes('traka') || n.includes('abs') || n.startsWith('kt ') || n.startsWith('kt/');
    });

    // Score each kant candidate
    let bestMatch: Material | null = null;
    let bestScore = 0;
    for (const candidate of kantCandidates) {
      const n = candidate.Name.toLowerCase();
      let score = 0;
      // Code match is most important
      for (const code of allCodes) {
        if (n.includes(code)) { score += 10; break; }
      }
      // Width match
      if (isWide && (n.includes('široka') || n.includes('siroka') || n.includes('43') || n.includes('45'))) score += 3;
      if (!isWide && !n.includes('široka') && !n.includes('siroka')) score += 1;
      if (score > bestScore) { bestScore = score; bestMatch = candidate; }
    }
    return bestScore >= 10 ? bestMatch : null; // Require code match
  }

  // --- PLOČA (MDF, Iveral, DTD): match by type keyword + thickness + code ---
  if (category === 'ploca') {
    let typeKw = '';
    if (lower.includes('mdf')) typeKw = 'mdf';
    else if (lower.includes('iveral') || lower.includes('pal') || lower.includes('dtd')) typeKw = 'iveral';

    // Score-based matching
    let bestMatch: Material | null = null;
    let bestScore = 0;
    for (const mat of dbMaterials) {
      const n = mat.Name.toLowerCase();
      // Skip edge banding materials — they must not match panels
      if (n.includes('kant') || n.startsWith('kt ') || n.startsWith('kt/') || n.includes('traka')) continue;
      let score = 0;

      // Type keyword match — REQUIRED
      if (typeKw === 'mdf' && n.includes('mdf')) score += 3;
      else if (typeKw === 'iveral' && (n.includes('pal') || n.includes('dtd') || n.includes('iveral'))) score += 3;
      else if (typeKw) continue; // type keyword required but not found — skip

      // Thickness match
      if (thickness) {
        const matThickness = extractThickness(mat.Name);
        if (matThickness === thickness) score += 4;
      }

      // Material code match (strongest signal)
      for (const code of allCodes) {
        if (n.includes(code)) { score += 10; break; }
      }

      // Prefer shorter/exact name — "MDF 18" over "MDF 18 Negorivi"
      // Bonus for name that closely matches the label
      const labelNorm = lower.replace(/[^a-z0-9]/g, '');
      const matNorm = n.replace(/[^a-z0-9]/g, '');
      if (matNorm === labelNorm) score += 5; // exact match
      else if (n.includes(lower) || lower.includes(n.replace(/\s*\(.*\)/, '').trim())) score += 3; // substring match

      if (score > bestScore) { bestScore = score; bestMatch = mat; }
    }
    // Require at least type + something else
    return bestScore >= 7 ? bestMatch : null;
  }

  // --- FURNIR / HPL: match by type keyword + material code ---
  // IMPORTANT: exclude KT (kant traka / edge banding) from candidates
  // IMPORTANT: REQUIRE the type keyword in the material name
  if (category === 'furnir' || category === 'hpl') {
    const typeKw = category;
    let bestMatch: Material | null = null;
    let bestScore = 0;
    for (const mat of dbMaterials) {
      const n = mat.Name.toLowerCase();
      // Skip edge banding materials — they must not match panels
      if (n.includes('kant') || n.startsWith('kt ') || n.startsWith('kt/') || n.includes('traka')) continue;
      // REQUIRE type keyword — material MUST contain 'hpl' or 'furnir' in its name
      if (!n.includes(typeKw)) continue;
      let score = 3; // base score for having the type keyword
      for (const code of allCodes) {
        if (n.includes(code)) { score += 10; break; }
      }
      // Word overlap from group name — but penalize extra words
      const groupWords = materialGroup.toLowerCase().split(/[\s\/\-_]+/).filter(w => w.length > 2);
      const matWords = n.split(/[\s\/\-_()]+/).filter(w => w.length > 2);
      const skipWords = new Set(['furnir', 'hpl', 'mdf', 'iveral', 'kom', 'kk']);
      const meaningfulGroupWords = groupWords.filter(w => !skipWords.has(w));
      const meaningfulMatWords = matWords.filter(w => !skipWords.has(w));
      
      let wordMatches = 0;
      for (const w of meaningfulGroupWords) {
        if (n.includes(w)) wordMatches++;
      }
      score += wordMatches * 2;

      // Penalize extra words in material name that aren't in the label
      // "Furnir / Hrast" should beat "Furnir / Dimljeni Hrast" for label "Furnir / Hrast"
      const extraWords = meaningfulMatWords.filter(w => !meaningfulGroupWords.some(gw => w.includes(gw) || gw.includes(w)));
      if (extraWords.length > 0) score -= extraWords.length;

      if (score > bestScore) { bestScore = score; bestMatch = mat; }
    }
    return bestScore >= 5 ? bestMatch : null;
  }

  // --- FARBANJE / LAKIRANJE ---
  if (category === 'farbanje') {
    // First: try exact name match "Lakiranje"
    const exactMatch = dbMaterials.find(m => m.Name.toLowerCase().trim() === 'lakiranje');
    if (exactMatch) return exactMatch;

    // Then: search for painting/lacquering materials, excluding unrelated items
    const match = dbMaterials.find(m => {
      const n = m.Name.toLowerCase();
      // Exclude hardware, glass, and other unrelated items
      if (n.includes('vodili') || n.includes('blum') || n.includes('okov') || 
          n.includes('šarka') || n.includes('izvlak') || n.includes('ručic') ||
          n.includes('staklo') || n.includes('lakobel')) return false;
      return n.includes('farb') || n.includes('lakir') || n.includes('bojenje');
    });
    return match || null;
  }

  // --- FALLBACK: word scoring ---
  const words = lower.split(/[\s\/\-_]+/).filter(w => w.length > 2);
  let bestMatch: Material | null = null;
  let bestScore = 0;
  for (const mat of dbMaterials) {
    const matLower = mat.Name.toLowerCase();
    // Don't let fallback match hardware for non-hardware categories
    if ((category === 'farbanje' || category === 'furnir' || category === 'hpl') &&
        (matLower.includes('vodili') || matLower.includes('blum') || matLower.includes('okov') ||
         matLower.includes('šarka') || matLower.includes('izvlak'))) continue;
    let score = 0;
    for (const word of words) {
      if (matLower.includes(word)) score++;
    }
    for (const code of allCodes) {
      if (matLower.includes(code)) score += 5;
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = mat;
    }
  }
  return bestScore >= 2 ? bestMatch : null;
}

async function matchWithGeminiAI(
  outputItems: { label: string; category: string; unit: string }[],
  dbMaterials: Material[]
): Promise<Record<string, string>> {
  try {
    const res = await fetch('/api/sketchup-match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        outputItems,
        dbMaterials: dbMaterials.map(m => ({
          Material_ID: m.Material_ID,
          Name: m.Name,
          Category: m.Category,
          Unit: m.Unit,
        })),
      }),
    });
    const data = await res.json();
    if (data.success && data.matches) return data.matches;
    console.warn('AI matching returned no matches:', data.error);
    return {};
  } catch (err) {
    console.warn('AI matching failed:', err);
    return {};
  }
}

// ---- PROPS & TYPES ----
interface SketchUpImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  productId: string;
  organizationId: string;
  materials: Material[];
  onImportComplete: () => void;
  showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

interface MaterialMatchState {
  outputItem: OutputItem;
  materialGroup: string;
  matchedMaterialId: string;
  matchedMaterial: Material | null;
}

// Per-material-group format config
interface MaterialFormatConfig {
  materialName: string;
  materialType: MaterialType;
  format: PanelFormat;
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
  // Step state
  const [step, setStep] = useState(1);

  // Step 1: Upload
  const [file, setFile] = useState<File | null>(null);
  const [parseWarnings, setParseWarnings] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Step 2: Components review
  const [components, setComponents] = useState<SketchUpComponent[]>([]);
  const [materialFormats, setMaterialFormats] = useState<MaterialFormatConfig[]>([]);
  const [editingLayersIdx, setEditingLayersIdx] = useState<number | null>(null);

  // Step 3: Results & matching
  const [calcResults, setCalcResults] = useState<CalculationResult[]>([]);
  const [matchStates, setMatchStates] = useState<MaterialMatchState[]>([]);
  const [isAiMatching, setIsAiMatching] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // Searchable dropdown state
  const [openDropdownIdx, setOpenDropdownIdx] = useState<number | null>(null);
  const [dropdownSearch, setDropdownSearch] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  // "Add new material" sub-modal
  const [newMaterialModal, setNewMaterialModal] = useState(false);
  const [newMaterial, setNewMaterial] = useState<Partial<Material>>({ Category: 'Ploča', Unit: 'kom' });
  const [addingForMatchIdx, setAddingForMatchIdx] = useState<number | null>(null);
  const [currentDbMaterials, setCurrentDbMaterials] = useState<Material[]>([]);

  // Step 4: Import
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });
  const [importResults, setImportResults] = useState<{ success: number; failed: number; errors: string[] } | null>(null);

  // Track live DB materials (initial + newly added)
  const liveMaterials = useMemo(() => {
    const combined = [...dbMaterials, ...currentDbMaterials.filter(m => !dbMaterials.find(d => d.Material_ID === m.Material_ID))];
    return combined;
  }, [dbMaterials, currentDbMaterials]);

  // Group materials by category, "Ploče i trake" first, then alphabetical categories, materials sorted A-Z within each
  const groupedMaterials = useMemo(() => {
    const categoryOrder = ['Ploče i trake', ...MATERIAL_CATEGORIES.filter(c => c !== 'Ploče i trake')];
    const groups: { category: string; materials: Material[] }[] = [];

    for (const cat of categoryOrder) {
      const mats = liveMaterials
        .filter(m => m.Category === cat)
        .sort((a, b) => a.Name.localeCompare(b.Name, 'bs'));
      if (mats.length > 0) groups.push({ category: cat, materials: mats });
    }

    // Also add materials with categories not in MATERIAL_CATEGORIES
    const knownCats = new Set(categoryOrder);
    const uncategorized = liveMaterials
      .filter(m => !knownCats.has(m.Category))
      .sort((a, b) => a.Name.localeCompare(b.Name, 'bs'));
    if (uncategorized.length > 0) groups.push({ category: 'Ostalo', materials: uncategorized });

    return groups;
  }, [liveMaterials]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpenDropdownIdx(null);
        setDropdownSearch('');
      }
    };
    if (openDropdownIdx !== null) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [openDropdownIdx]);

  // ---- RESET ----
  const resetWizard = useCallback(() => {
    setStep(1);
    setFile(null);
    setParseWarnings([]);
    setComponents([]);
    setMaterialFormats([]);
    setEditingLayersIdx(null);
    setCalcResults([]);
    setMatchStates([]);
    setExpandedGroups(new Set());
    setOpenDropdownIdx(null);
    setDropdownSearch('');
    setImportResults(null);
    setImportProgress({ current: 0, total: 0 });
    setCurrentDbMaterials([]);
  }, []);

  const handleClose = () => { resetWizard(); onClose(); };

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
      if (parsed.length === 0) return;

      // Enrich with default layers
      const enriched = parsed.map(comp => {
        const materialType = recognizeMaterialType(comp.material);
        return {
          ...comp,
          layers: getDefaultLayers(materialType, comp.thickness, comp.material, false),
        };
      });

      setComponents(enriched);

      // Build per-material format configs
      const matMap = new Map<string, MaterialType>();
      for (const comp of enriched) {
        const mType = recognizeMaterialType(comp.material);
        if (!matMap.has(comp.material)) {
          matMap.set(comp.material, mType);
        }
      }
      const formats: MaterialFormatConfig[] = [];
      matMap.forEach((mType, matName) => {
        formats.push({
          materialName: matName,
          materialType: mType,
          format: { ...(DEFAULT_FORMATS[mType] || DEFAULT_FORMATS.unknown) },
        });
      });
      setMaterialFormats(formats);
      setStep(2);
    } catch {
      setParseWarnings(['Greška pri čitanju CSV datoteke']);
    }
  };

  // ---- STEP 2: COMPONENT EDITING ----
  const updateComponent = (idx: number, field: keyof SketchUpComponent, value: unknown) => {
    setComponents(prev => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], [field]: value };

      if (field === 'material' || field === 'thickness' || field === 'hasDoubleVeneer') {
        const mat = field === 'material' ? value as string : updated[idx].material;
        const thk = field === 'thickness' ? value as number : updated[idx].thickness;
        const dv = field === 'hasDoubleVeneer' ? value as boolean : updated[idx].hasDoubleVeneer;
        const type = recognizeMaterialType(mat);
        updated[idx].layers = getDefaultLayers(type, thk, mat, dv);
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

  const updateMaterialFormat = (matName: string, axis: 'width' | 'height', val: number) => {
    setMaterialFormats(prev => prev.map(mf =>
      mf.materialName === matName ? { ...mf, format: { ...mf.format, [axis]: val } } : mf
    ));
  };

  // ---- STEP 2 → 3: CALCULATE + LOCAL MATCH ----
  const handleCalculate = () => {
    // Apply per-material format to components
    const withFormats = components.map(comp => {
      const mf = materialFormats.find(f => f.materialName === comp.material);
      return { ...comp, panelFormat: mf?.format || DEFAULT_PANEL_FORMAT };
    });

    const results = calculateAll(withFormats, DEFAULT_PANEL_FORMAT);
    setCalcResults(results);
    setStep(3);
    // Expand all by default
    setExpandedGroups(new Set(results.map(r => r.materialName)));

    // Build match states — LOCAL matching only (instant)
    const matches: MaterialMatchState[] = [];
    for (const result of results) {
      for (const item of result.outputItems) {
        const matched = findBestMaterialMatchLocal(item.label, item.category, result.materialName, liveMaterials);
        matches.push({
          outputItem: item,
          materialGroup: result.materialName,
          matchedMaterialId: matched?.Material_ID || '',
          matchedMaterial: matched,
        });
      }
    }

    // Pass 2: for unmatched kant traka, use the matched panel's code from same group
    for (let i = 0; i < matches.length; i++) {
      const ms = matches[i];
      if (ms.matchedMaterial) continue;
      const cat = ms.outputItem.category;
      if (cat !== 'kant' && cat !== 'kant_siroka') continue;

      // Find a matched panel in the same material group
      const groupPanel = matches.find(m =>
        m.materialGroup === ms.materialGroup &&
        m.outputItem.category === 'ploca' &&
        m.matchedMaterial
      );

      if (groupPanel?.matchedMaterial) {
        // Extract codes from the MATCHED panel material name (from DB)
        const panelCodes = extractMaterialCodes(groupPanel.matchedMaterial.Name);

        // Search kant candidates using matched panel's codes
        const kantCandidates = liveMaterials.filter(m => {
          const n = m.Name.toLowerCase();
          return n.includes('kant') || n.includes('traka') || n.includes('abs') || n.startsWith('kt ') || n.startsWith('kt/');
        });

        for (const code of panelCodes) {
          const kantMatch = kantCandidates.find(m => m.Name.toLowerCase().includes(code));
          if (kantMatch) {
            matches[i] = {
              ...ms,
              matchedMaterialId: kantMatch.Material_ID,
              matchedMaterial: kantMatch,
            };
            break;
          }
        }
      }
    }

    setMatchStates(matches);
  };

  // ---- OPTIONAL AI IMPROVE (user-triggered) ----
  const handleAiImprove = async () => {
    setIsAiMatching(true);

    // Collect all output items
    const allItems: { label: string; category: string; unit: string }[] = [];
    calcResults.forEach(result => {
      result.outputItems.forEach(item => {
        allItems.push({ label: item.label, category: item.category, unit: item.unit });
      });
    });

    // Call AI matching
    const ploceMaterials = liveMaterials.filter(m => m.Category === 'Ploče i trake');
    let aiMatches: Record<string, string> = {};
    try {
      aiMatches = await matchWithGeminiAI(allItems, ploceMaterials);
    } catch { /* fallback */ }

    // Only overwrite UNMATCHED items with AI results
    setMatchStates(prev => {
      const updated = [...prev];
      let idx = 0;
      for (const result of calcResults) {
        for (const item of result.outputItems) {
          const aiMatchId = aiMatches[String(idx)];
          // Only apply AI match if current item is unmatched
          if (!updated[idx]?.matchedMaterial && aiMatchId) {
            const aiMat = liveMaterials.find(m => m.Material_ID === aiMatchId) || null;
            if (aiMat) {
              updated[idx] = {
                ...updated[idx],
                matchedMaterialId: aiMat.Material_ID,
                matchedMaterial: aiMat,
              };
            }
          }
          idx++;
        }
      }
      return updated;
    });

    setIsAiMatching(false);
  };

  // ---- STEP 3: MATCH EDITING ----
  const updateMatch = (idx: number, materialId: string) => {
    setMatchStates(prev => {
      const updated = [...prev];
      const mat = liveMaterials.find(m => m.Material_ID === materialId) || null;
      updated[idx] = { ...updated[idx], matchedMaterialId: materialId, matchedMaterial: mat };
      return updated;
    });
  };

  // Remove a material row from results
  const removeMatchItem = (idx: number) => {
    setMatchStates(prev => prev.filter((_, i) => i !== idx));
  };

  const toggleGroup = (name: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  };

  // ---- ADD NEW MATERIAL ----
  const openNewMaterialModal = (matchIdx: number, suggestedName: string) => {
    setAddingForMatchIdx(matchIdx);
    setNewMaterial({
      Name: suggestedName,
      Category: 'Ploča',
      Unit: matchStates[matchIdx]?.outputItem.unit === 'm' ? 'm' : matchStates[matchIdx]?.outputItem.unit === 'm2' ? 'm²' : 'kom',
    });
    setNewMaterialModal(true);
  };

  const handleSaveNewMaterial = async () => {
    if (!newMaterial.Name) { showToast('Unesite naziv materijala', 'error'); return; }
    if (!organizationId) return;

    const result = await saveMaterial(newMaterial, organizationId);
    if (result.success && result.data) {
      const created: Material = {
        Material_ID: result.data.Material_ID,
        Name: newMaterial.Name || '',
        Category: newMaterial.Category || 'Ploča',
        Unit: newMaterial.Unit || 'kom',
        Default_Unit_Price: newMaterial.Default_Unit_Price || 0,
        Default_Supplier: newMaterial.Default_Supplier || '',
        Description: newMaterial.Description || '',
        Organization_ID: organizationId,
      };
      setCurrentDbMaterials(prev => [...prev, created]);

      // Auto-assign to the match that triggered this
      if (addingForMatchIdx !== null) {
        setMatchStates(prev => {
          const updated = [...prev];
          updated[addingForMatchIdx] = {
            ...updated[addingForMatchIdx],
            matchedMaterialId: created.Material_ID,
            matchedMaterial: created,
          };
          return updated;
        });
      }

      showToast(`Materijal "${created.Name}" kreiran`, 'success');
      setNewMaterialModal(false);
    } else {
      showToast(result.message, 'error');
    }
  };

  // ---- STEP 3 → 4: IMPORT ----
  const handleImport = async () => {
    const toImport = matchStates.filter(ms => ms.matchedMaterial);
    if (toImport.length === 0) {
      showToast('Povežite barem jedan materijal iz baze', 'error');
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
        if (result.success) { results.success++; }
        else { results.failed++; results.errors.push(`${oi.label}: ${result.message}`); }
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

  // ---- HELPERS ----
  const getStepClass = (s: number) => step > s ? 'completed' : step === s ? 'active' : '';
  const matchedCount = matchStates.filter(m => m.matchedMaterial).length;
  const unmatchedCount = matchStates.filter(m => !m.matchedMaterial).length;

  // ---- RENDER ----
  return (
    <Modal isOpen={isOpen} onClose={handleClose}
      title={<div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><span className="material-icons-round">upload_file</span><span>SketchUp Import</span></div>}
      size="xl"
    >
      <div className="sketchup-import-wizard">
        {/* Step Indicator */}
        <div className="sketchup-steps">
          {['Upload', 'Komponente', 'Rezultati', 'Import'].map((label, i) => (
            <div key={i} className="sketchup-step-wrapper">
              <div className={`sketchup-step ${getStepClass(i + 1)}`}>
                <div className="step-num">{getStepClass(i + 1) === 'completed' ? <span className="material-icons-round" style={{ fontSize: 14 }}>check</span> : i + 1}</div>
                <span className="step-label">{label}</span>
              </div>
              {i < 3 && <div className={`sketchup-step-line ${step > i + 1 ? 'completed' : ''}`} />}
            </div>
          ))}
        </div>

        {/* ==================== STEP 1: UPLOAD ==================== */}
        {step === 1 && (
          <div className="sketchup-step-content">
            <div className={`sketchup-dropzone ${file ? 'has-file' : ''}`} onClick={() => fileInputRef.current?.click()}>
              <input ref={fileInputRef} type="file" accept=".csv" onChange={handleFileSelect} hidden />
              <span className="material-icons-round" style={{ fontSize: 48, color: file ? '#10b981' : 'var(--text-secondary)', marginBottom: 8 }}>
                {file ? 'check_circle' : 'cloud_upload'}
              </span>
              {file ? (
                <><h3 className="dropzone-title">{file.name}</h3><p className="dropzone-hint">{(file.size / 1024).toFixed(1)} KB</p></>
              ) : (
                <><h3 className="dropzone-title">Kliknite za upload CSV iz SketchUp-a</h3><p className="dropzone-hint">Naziv;Visina;Sirina;Debljina;Kolicina;Materijal</p></>
              )}
            </div>
            {parseWarnings.length > 0 && (
              <div className="sketchup-warnings">
                <div className="warning-header"><span className="material-icons-round" style={{ fontSize: 16 }}>warning</span> Upozorenja</div>
                <ul>{parseWarnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
              </div>
            )}
          </div>
        )}

        {/* ==================== STEP 2: COMPONENTS ==================== */}
        {step === 2 && (
          <div className="sketchup-step-content">
            {/* Per-material panel formats */}
            <div className="sketchup-section">
              <div className="sketchup-section-header">
                <span className="material-icons-round" style={{ fontSize: 18 }}>straighten</span>
                <span>Format ploče po materijalu</span>
              </div>
              <div className="sketchup-format-grid">
                {materialFormats.map(mf => (
                  <div key={mf.materialName} className="sketchup-format-card">
                    <div className="format-card-label">
                      <span className={`badge badge-${mf.materialType}`}>{mf.materialType}</span>
                      <span className="format-card-name">{mf.materialName}</span>
                    </div>
                    <div className="format-card-inputs">
                      <input type="number" value={mf.format.width}
                        onChange={e => updateMaterialFormat(mf.materialName, 'width', parseFloat(e.target.value) || 0)} />
                      <span className="format-x">×</span>
                      <input type="number" value={mf.format.height}
                        onChange={e => updateMaterialFormat(mf.materialName, 'height', parseFloat(e.target.value) || 0)} />
                      <span className="format-unit">mm</span>
                      <span className="format-area">({panelFormatAreaM2(mf.format).toFixed(3)} m²)</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Components table */}
            <div className="sketchup-section">
              <div className="sketchup-section-header">
                <span className="material-icons-round" style={{ fontSize: 18 }}>view_list</span>
                <span>Komponente ({components.length})</span>
              </div>
              <div className="sketchup-table-wrapper">
                <table className="sketchup-table">
                  <thead>
                    <tr>
                      <th>Naziv</th>
                      <th className="col-num">Visina</th>
                      <th className="col-num">Širina</th>
                      <th className="col-num">Deblj.</th>
                      <th className="col-num">Kol.</th>
                      <th>Materijal</th>
                      <th className="col-sm">Tip</th>
                      <th className="col-opts">Opcije</th>
                      <th className="col-xs"></th>
                    </tr>
                  </thead>
                  {components.map((comp, idx) => {
                    const mType = recognizeMaterialType(comp.material);
                    const isFurnir = mType === 'furnir';
                    const isMdf = mType === 'mdf';

                    return (
                      <tbody key={idx}>
                        <tr>
                          <td><input type="text" value={comp.name} onChange={e => updateComponent(idx, 'name', e.target.value)} /></td>
                          <td className="col-num"><input type="number" value={comp.height} onChange={e => updateComponent(idx, 'height', parseFloat(e.target.value) || 0)} /></td>
                          <td className="col-num"><input type="number" value={comp.width} onChange={e => updateComponent(idx, 'width', parseFloat(e.target.value) || 0)} /></td>
                          <td className="col-num"><input type="number" value={comp.thickness} onChange={e => updateComponent(idx, 'thickness', parseFloat(e.target.value) || 0)} /></td>
                          <td className="col-num"><input type="number" value={comp.quantity} min={1} onChange={e => updateComponent(idx, 'quantity', parseInt(e.target.value) || 1)} /></td>
                          <td><input type="text" value={comp.material} onChange={e => updateComponent(idx, 'material', e.target.value)} /></td>
                          <td className="col-sm"><span className={`badge badge-${mType}`}>{mType}</span></td>
                          <td className="col-opts">
                            <div className="opts-row">
                              {isFurnir && (
                                <label className="mini-check" title="Obje strane skupi furnir">
                                  <input type="checkbox" checked={comp.hasDoubleVeneer || false} onChange={e => updateComponent(idx, 'hasDoubleVeneer', e.target.checked)} />
                                  <span>Obostrani</span>
                                </label>
                              )}
                              {isMdf && (
                                <label className="mini-check" title="Obje strane vidljive">
                                  <input type="checkbox" checked={comp.hasBothSidesVisible !== false} onChange={e => updateComponent(idx, 'hasBothSidesVisible', e.target.checked)} />
                                  <span>2 strane</span>
                                </label>
                              )}
                              <button className="icon-btn-sm" onClick={() => setEditingLayersIdx(editingLayersIdx === idx ? null : idx)} title="Slojevi">
                                <span className="material-icons-round" style={{ fontSize: 16 }}>layers</span>
                              </button>
                            </div>
                          </td>
                          <td className="col-xs">
                            <button className="icon-btn-sm danger" onClick={() => removeComponent(idx)}>
                              <span className="material-icons-round" style={{ fontSize: 16 }}>close</span>
                            </button>
                          </td>
                        </tr>

                        {editingLayersIdx === idx && (
                          <tr className="layer-editor-row">
                            <td colSpan={9}>
                              <div className="sketchup-layer-editor">
                                <div className="layer-editor-title">Slojevi: {comp.name} <span className="muted">({comp.layers?.length || 0})</span></div>
                                {(comp.layers || []).map((layer, lIdx) => (
                                  <div className="layer-row" key={lIdx}>
                                    <select value={layer.type} onChange={e => updateLayer(idx, lIdx, 'type', e.target.value)} className="layer-type-select">
                                      <option value="ploca">Ploča</option>
                                      <option value="furnir">Furnir</option>
                                      <option value="hpl">HPL</option>
                                      <option value="farbanje">Farbanje</option>
                                    </select>
                                    <input type="text" value={layer.materialLabel} onChange={e => updateLayer(idx, lIdx, 'materialLabel', e.target.value)} className="layer-name-input" placeholder="Naziv" />
                                    <div className="layer-thickness-group">
                                      <input type="number" value={layer.thicknessMm} onChange={e => updateLayer(idx, lIdx, 'thicknessMm', parseFloat(e.target.value) || 0)} className="layer-thickness-input" />
                                      <span className="muted">mm</span>
                                    </div>
                                    {(layer.type === 'furnir' || layer.type === 'hpl') && (
                                      <label className="mini-check">
                                        <input type="checkbox" checked={layer.isKK || false} onChange={e => updateLayer(idx, lIdx, 'isKK', e.target.checked)} />
                                        <span>KK</span>
                                      </label>
                                    )}
                                    <button className="icon-btn-sm danger" onClick={() => removeLayer(idx, lIdx)}><span className="material-icons-round" style={{ fontSize: 14 }}>remove</span></button>
                                  </div>
                                ))}
                                <button className="btn-add-layer" onClick={() => addLayer(idx)}>
                                  <span className="material-icons-round" style={{ fontSize: 14 }}>add</span> Dodaj sloj
                                </button>
                              </div>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    );
                  })}
                </table>
              </div>
            </div>

            <div className="sketchup-actions">
              <button className="btn btn-secondary" onClick={() => { setStep(1); setFile(null); setComponents([]); }}>
                <span className="material-icons-round">arrow_back</span> Nazad
              </button>
              <button className="btn btn-primary" onClick={handleCalculate} disabled={components.length === 0}>
                <span className="material-icons-round">calculate</span> Izračunaj
              </button>
            </div>
          </div>
        )}

        {/* ==================== STEP 3: RESULTS ==================== */}
        {step === 3 && (
          <div className="sketchup-step-content">
            {isAiMatching && (
              <div className="sketchup-ai-bar">
                <span className="material-icons-round spin">sync</span>
                <span>AI analizira i pokušava popuniti prazne materijale...</span>
              </div>
            )}

            {unmatchedCount > 0 && !isAiMatching && (
              <div className="sketchup-warnings" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div className="warning-header" style={{ flex: 1 }}><span className="material-icons-round" style={{ fontSize: 16 }}>info</span> {unmatchedCount} stavki nema match — koristite <strong>+ Kreiraj</strong> ili probajte AI</div>
                <button
                  className="btn btn-secondary"
                  onClick={handleAiImprove}
                  style={{ whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', fontSize: '12px' }}
                >
                  <span className="material-icons-round" style={{ fontSize: 16 }}>auto_fix_high</span>
                  AI Unaprijedi
                </button>
              </div>
            )}

            <div className="sketchup-results-list">
              {calcResults.map((result, rIdx) => {
                const groupItems = matchStates.filter(ms => ms.materialGroup === result.materialName);
                const expanded = expandedGroups.has(result.materialName);
                const groupMatched = groupItems.filter(m => m.matchedMaterial).length;

                return (
                  <div className="result-group" key={rIdx}>
                    <div className="result-group-header" onClick={() => toggleGroup(result.materialName)}>
                      <div className="result-group-left">
                        <span className="material-icons-round" style={{ fontSize: 18, transition: 'transform 0.2s', transform: expanded ? 'rotate(90deg)' : 'rotate(0)' }}>
                          chevron_right
                        </span>
                        <span className="result-group-name">{result.materialName || 'Nepoznat'}</span>
                        <span className={`badge badge-${result.materialType}`}>{result.materialType}</span>
                      </div>
                      <div className="result-group-right">
                        <span className="result-group-count">{groupMatched}/{groupItems.length}</span>
                        <span className="result-group-components">{result.components.length} komp.</span>
                      </div>
                    </div>

                    {expanded && (
                      <div className="result-group-body">
                        {groupItems.map((ms, msIdx) => {
                          const globalIdx = matchStates.indexOf(ms);
                          const oi = ms.outputItem;
                          const catIcon = oi.category === 'ploca' ? 'inventory_2' :
                            oi.category === 'furnir' ? 'texture' :
                            oi.category === 'hpl' ? 'layers' :
                            oi.category === 'farbanje' ? 'format_paint' :
                            oi.category === 'kant' || oi.category === 'kant_siroka' ? 'border_style' : 'category';

                          return (
                            <div className={`result-row ${!ms.matchedMaterial ? 'unmatched' : ''}`} key={msIdx}>
                              <div className="result-row-info">
                                <span className="material-icons-round result-row-icon" style={{ fontSize: 16 }}>{catIcon}</span>
                                <span className={`result-row-label ${oi.isKK ? 'is-kk' : ''}`}>
                                  {oi.label}{oi.isKK ? ' (KK)' : ''}
                                </span>
                              </div>
                              <div className="result-row-qty">
                                <strong>{oi.quantity % 1 === 0 ? oi.quantity : oi.quantity.toFixed(2)}</strong>
                                <span className="muted">{oi.unit}</span>
                              </div>
                              <div className="result-row-match">
                                <div className="searchable-dropdown" ref={openDropdownIdx === globalIdx ? dropdownRef : undefined}>
                                  <button
                                    type="button"
                                    className={`searchable-dropdown-trigger ${ms.matchedMaterial ? 'matched' : 'unmatched'}`}
                                    onClick={() => {
                                      setOpenDropdownIdx(openDropdownIdx === globalIdx ? null : globalIdx);
                                      setDropdownSearch('');
                                    }}
                                  >
                                    <span className="dropdown-trigger-text">
                                      {ms.matchedMaterial ? `${ms.matchedMaterial.Name} (${ms.matchedMaterial.Unit})` : '— Odaberi —'}
                                    </span>
                                    <span className="material-icons-round" style={{ fontSize: 14 }}>expand_more</span>
                                  </button>
                                  {openDropdownIdx === globalIdx && (
                                    <div className="searchable-dropdown-menu">
                                      <div className="dropdown-search-wrap">
                                        <span className="material-icons-round" style={{ fontSize: 15, color: 'var(--text-secondary)' }}>search</span>
                                        <input
                                          type="text"
                                          className="dropdown-search-input"
                                          placeholder="Traži materijal..."
                                          value={dropdownSearch}
                                          onChange={e => setDropdownSearch(e.target.value)}
                                          autoFocus
                                          onClick={e => e.stopPropagation()}
                                        />
                                      </div>
                                      <div className="dropdown-options-list">
                                        <div
                                          className={`dropdown-option ${!ms.matchedMaterialId ? 'selected' : ''}`}
                                          onClick={() => { updateMatch(globalIdx, ''); setOpenDropdownIdx(null); setDropdownSearch(''); }}
                                        >
                                          — Odaberi —
                                        </div>
                                        {groupedMaterials.map((group, gIdx) => {
                                          const searchLower = dropdownSearch.toLowerCase();
                                          const filteredMats = group.materials.filter(m =>
                                            m.Name.toLowerCase().includes(searchLower)
                                          );
                                          if (filteredMats.length === 0) return null;
                                          return (
                                            <div key={`cat-${gIdx}`} className="dropdown-category-group">
                                              <div className="dropdown-category-label">{group.category}</div>
                                              {filteredMats.map(m => (
                                                <div
                                                  key={m.Material_ID}
                                                  className={`dropdown-option ${ms.matchedMaterialId === m.Material_ID ? 'selected' : ''}`}
                                                  onClick={() => { updateMatch(globalIdx, m.Material_ID); setOpenDropdownIdx(null); setDropdownSearch(''); }}
                                                >
                                                  {m.Name} <span className="muted">({m.Unit})</span>
                                                </div>
                                              ))}
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  )}
                                </div>
                                {!ms.matchedMaterial && (
                                  <button className="btn-create-mat" onClick={() => openNewMaterialModal(globalIdx, oi.label)} title="Kreiraj novi materijal">
                                    <span className="material-icons-round" style={{ fontSize: 14 }}>add</span> Kreiraj
                                  </button>
                                )}
                              </div>
                              <button
                                className="icon-btn-sm danger result-row-delete"
                                onClick={() => removeMatchItem(globalIdx)}
                                title="Ukloni stavku"
                              >
                                <span className="material-icons-round" style={{ fontSize: 14 }}>close</span>
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="sketchup-actions">
              <button className="btn btn-secondary" onClick={() => setStep(2)}>
                <span className="material-icons-round">arrow_back</span> Nazad
              </button>
              <div className="actions-right">
                <span className="match-counter">{matchedCount}/{matchStates.length} povezano</span>
                <button className="btn btn-success" onClick={handleImport} disabled={matchedCount === 0 || isAiMatching}>
                  <span className="material-icons-round">save</span> Dodaj {matchedCount} materijala
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ==================== STEP 4: IMPORT ==================== */}
        {step === 4 && (
          <div className="sketchup-step-content sketchup-center">
            {isImporting ? (
              <>
                <span className="material-icons-round spin" style={{ fontSize: 48, color: '#3b82f6' }}>sync</span>
                <div className="sketchup-progress-bar"><div className="sketchup-progress-fill" style={{ width: `${importProgress.total > 0 ? (importProgress.current / importProgress.total) * 100 : 0}%` }} /></div>
                <p className="muted">Dodajem materijale... {importProgress.current}/{importProgress.total}</p>
              </>
            ) : importResults && (
              <>
                <span className="material-icons-round" style={{ fontSize: 48, color: importResults.failed > 0 ? '#f59e0b' : '#10b981' }}>
                  {importResults.failed > 0 ? 'warning' : 'check_circle'}
                </span>
                <h3 style={{ margin: '12px 0 4px', fontSize: 18 }}>Import završen</h3>
                <p className="muted" style={{ marginBottom: 16 }}>
                  <strong style={{ color: '#10b981' }}>{importResults.success}</strong> uspješno
                  {importResults.failed > 0 && <>, <strong style={{ color: '#ef4444' }}>{importResults.failed}</strong> neuspješno</>}
                </p>

                {importResults.errors.length > 0 && (
                  <div className="sketchup-warnings" style={{ textAlign: 'left', marginBottom: 16, width: '100%' }}>
                    <div className="warning-header"><span className="material-icons-round" style={{ fontSize: 16 }}>error</span> Greške</div>
                    <ul>{importResults.errors.map((err, i) => <li key={i}>{err}</li>)}</ul>
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                  <button className="btn btn-secondary" onClick={resetWizard}><span className="material-icons-round">refresh</span> Novi import</button>
                  <button className="btn btn-primary" onClick={handleClose}><span className="material-icons-round">check</span> Zatvori</button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ==================== NEW MATERIAL SUB-MODAL ==================== */}
      {newMaterialModal && (
        <div className="sketchup-sub-modal-overlay" onClick={() => setNewMaterialModal(false)}>
          <div className="sketchup-sub-modal" onClick={e => e.stopPropagation()}>
            <div className="sub-modal-header">
              <h3>Novi Materijal</h3>
              <button className="icon-btn-sm" onClick={() => setNewMaterialModal(false)}>
                <span className="material-icons-round" style={{ fontSize: 18 }}>close</span>
              </button>
            </div>
            <div className="sub-modal-body">
              <div className="form-group">
                <label>Naziv *</label>
                <input type="text" value={newMaterial.Name || ''} onChange={e => setNewMaterial(prev => ({ ...prev, Name: e.target.value }))} />
              </div>
              <div className="form-row-2">
                <div className="form-group">
                  <label>Kategorija</label>
                  <select value={newMaterial.Category || 'Ploča'} onChange={e => setNewMaterial(prev => ({ ...prev, Category: e.target.value }))}>
                    {MATERIAL_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Jedinica</label>
                  <select value={newMaterial.Unit || 'kom'} onChange={e => setNewMaterial(prev => ({ ...prev, Unit: e.target.value }))}>
                    <option value="kom">kom</option><option value="m">m</option><option value="m²">m²</option><option value="set">set</option><option value="kg">kg</option>
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label>Cijena (KM)</label>
                <input type="number" step="0.01" min="0" value={newMaterial.Default_Unit_Price || ''} onChange={e => setNewMaterial(prev => ({ ...prev, Default_Unit_Price: parseFloat(e.target.value) || 0 }))} />
              </div>
              <div className="form-group">
                <label>Dobavljač</label>
                <input type="text" value={newMaterial.Default_Supplier || ''} onChange={e => setNewMaterial(prev => ({ ...prev, Default_Supplier: e.target.value }))} placeholder="Opcionalno" />
              </div>
            </div>
            <div className="sub-modal-footer">
              <button className="btn btn-secondary" onClick={() => setNewMaterialModal(false)}>Otkaži</button>
              <button className="btn btn-primary" onClick={handleSaveNewMaterial}>Sačuvaj</button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
