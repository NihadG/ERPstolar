// ============================================
// SKETCHUP MATERIAL CALCULATOR ENGINE
// ============================================
// Pure business logic — no UI, no Firebase.
// Handles: material type recognition, layer composition,
// panel/veneer/HPL/edge banding calculations.

// ---- TYPES ----

export type MaterialType = 'iveral' | 'mdf' | 'furnir' | 'hpl' | 'unknown';

export interface PanelFormat {
  width: number;   // mm, e.g. 2800
  height: number;  // mm, e.g. 2070
}

export function panelFormatAreaM2(f: PanelFormat): number {
  return (f.width * f.height) / 1_000_000;
}

// Rounding helpers:
// Ploče: ceil to nearest 0.5 (e.g. 0.3 → 0.5, 1.1 → 1.5, 2.0 → 2.0)
export function roundPanelQty(n: number): number {
  return Math.ceil(n * 2) / 2;
}
// Kant traka: ceil to nearest 5m (e.g. 12 → 15, 20 → 20, 23 → 25)
export function roundKantMeters(n: number): number {
  return Math.ceil(n / 5) * 5;
}

export const DEFAULT_PANEL_FORMAT: PanelFormat = { width: 2800, height: 2070 };

export interface LayerDefinition {
  type: 'ploca' | 'furnir' | 'hpl' | 'farbanje';
  materialLabel: string;  // e.g. "MDF 18", "Furnir / Hrast", "HPL / H3395"
  thicknessMm: number;
  isKK?: boolean;         // cheaper back-side variant
}

export interface SketchUpComponent {
  name: string;
  height: number;      // mm
  width: number;       // mm
  thickness: number;   // mm (always smallest dimension)
  quantity: number;
  material: string;    // raw string from SketchUp, e.g. "Iveral / U999"
  hasDoubleVeneer?: boolean;      // furnir: obje strane skupi furnir (default: false → lice + KK)
  hasBothSidesVisible?: boolean;  // MDF: obje strane vidljive (default: true → x2 farbanje)
  layers?: LayerDefinition[];     // user-defined composition (overrides default)
  panelFormat?: PanelFormat;      // per-component format override
}

// Single output line item
export interface OutputItem {
  label: string;       // e.g. "Iveral / U999", "MDF 18", "Furnir / Hrast", "Kant traka"
  unit: string;        // "kom", "m2", "m"
  quantity: number;    // can be decimal (e.g. 0.3 kom)
  category: 'ploca' | 'furnir' | 'hpl' | 'farbanje' | 'kant' | 'kant_siroka';
  isKK?: boolean;
}

// Grouped result per material type
export interface CalculationResult {
  materialName: string;       // raw material from SketchUp
  materialType: MaterialType;
  components: SketchUpComponent[];  // all components with this material
  outputItems: OutputItem[];
}

// ---- MATERIAL TYPE RECOGNITION ----

export function recognizeMaterialType(materialName: string): MaterialType {
  const lower = materialName.toLowerCase();

  // Order matters: check more specific patterns first
  if (lower.includes('hpl')) return 'hpl';
  if (lower.includes('furnir')) return 'furnir';
  if (lower.includes('mdf') && (lower.includes('farban') || lower.includes('farbani') || lower.includes('lakirani'))) return 'mdf';
  // "MDF / Farbani" format
  if (lower.includes('mdf')) return 'mdf';
  if (lower.includes('iveral') || lower.includes('pal') || lower.includes('dtd')) return 'iveral';

  return 'unknown';
}

// ---- DEFAULT LAYER COMPOSITION ----

export function getDefaultLayers(materialType: MaterialType, thickness: number, materialName: string, hasDoubleVeneer: boolean = false): LayerDefinition[] {
  switch (materialType) {
    case 'iveral': {
      if (thickness >= 36) {
        // Glued double: 2 × 18mm
        const halfThickness = Math.round(thickness / 2);
        return [
          { type: 'ploca', materialLabel: materialName, thicknessMm: halfThickness },
          { type: 'ploca', materialLabel: materialName, thicknessMm: halfThickness },
        ];
      }
      return [
        { type: 'ploca', materialLabel: materialName, thicknessMm: thickness },
      ];
    }

    case 'mdf': {
      if (thickness >= 36) {
        const halfThickness = Math.round(thickness / 2);
        return [
          { type: 'ploca', materialLabel: `MDF ${halfThickness}`, thicknessMm: halfThickness },
          { type: 'ploca', materialLabel: `MDF ${halfThickness}`, thicknessMm: halfThickness },
          { type: 'farbanje', materialLabel: 'Farbanje MDF', thicknessMm: 0 },
        ];
      }
      return [
        { type: 'ploca', materialLabel: `MDF ${thickness}`, thicknessMm: thickness },
        { type: 'farbanje', materialLabel: 'Farbanje MDF', thicknessMm: 0 },
      ];
    }

    case 'furnir': {
      // Extract veneer name: "Furnir / Hrast" → "Hrast"
      const veneerName = materialName.replace(/furnir\s*\/?\s*/i, '').trim() || 'Furnir';
      const furnirLabel = `Furnir / ${veneerName}`;
      const furnirKKLabel = `Furnir KK / ${veneerName}`;

      if (thickness >= 38) {
        // 38mm = 1mm furnir + 18mm MDF + 18mm MDF + 1mm furnir
        return [
          { type: 'furnir', materialLabel: furnirLabel, thicknessMm: 1 },
          { type: 'ploca', materialLabel: 'MDF 18', thicknessMm: 18 },
          { type: 'ploca', materialLabel: 'MDF 18', thicknessMm: 18 },
          { type: 'furnir', materialLabel: hasDoubleVeneer ? furnirLabel : furnirKKLabel, thicknessMm: 1, isKK: !hasDoubleVeneer },
        ];
      }
      // Standard: 1mm furnir + (thickness-2)mm MDF + 1mm furnir
      const coreThickness = thickness - 2;
      return [
        { type: 'furnir', materialLabel: furnirLabel, thicknessMm: 1 },
        { type: 'ploca', materialLabel: `MDF ${coreThickness}`, thicknessMm: coreThickness },
        { type: 'furnir', materialLabel: hasDoubleVeneer ? furnirLabel : furnirKKLabel, thicknessMm: 1, isKK: !hasDoubleVeneer },
      ];
    }

    case 'hpl': {
      // 20mm = 1mm HPL + 18mm MDF + 1mm HPL
      const hplName = materialName.replace(/hpl\s*\/?\s*/i, '').trim() || 'HPL';
      const hplLabel = `HPL / ${hplName}`;
      const hplKKLabel = `HPL KK / ${hplName}`;
      const coreThickness = thickness - 2;

      return [
        { type: 'hpl', materialLabel: hplLabel, thicknessMm: 1 },
        { type: 'ploca', materialLabel: `MDF ${coreThickness}`, thicknessMm: coreThickness },
        { type: 'hpl', materialLabel: hplKKLabel, thicknessMm: 1, isKK: true },
      ];
    }

    default:
      return [
        { type: 'ploca', materialLabel: materialName, thicknessMm: thickness },
      ];
  }
}

// ---- CALCULATION ENGINE ----

export function calculateComponent(comp: SketchUpComponent, defaultFormat: PanelFormat = DEFAULT_PANEL_FORMAT): OutputItem[] {
  const format = comp.panelFormat || defaultFormat;
  const formatM2 = panelFormatAreaM2(format);
  const materialType = recognizeMaterialType(comp.material);
  const layers = comp.layers || getDefaultLayers(materialType, comp.thickness, comp.material, comp.hasDoubleVeneer);

  const items: OutputItem[] = [];

  // 1. Calculate panel quantity (area-based)
  const componentAreaM2 = (comp.height * comp.width) / 1_000_000;
  const panelQty = (componentAreaM2 * comp.quantity) / formatM2; // in "kom ploče"

  // 2. Process each layer → aggregate panels by label
  const panelAggregator: Record<string, number> = {};

  for (const layer of layers) {
    if (layer.type === 'ploca') {
      const key = layer.materialLabel;
      panelAggregator[key] = (panelAggregator[key] || 0) + panelQty;
    }
  }

  // Output panel items
  for (const [label, qty] of Object.entries(panelAggregator)) {
    items.push({
      label,
      unit: 'kom',
      quantity: parseFloat(qty.toFixed(4)),
      category: 'ploca',
    });
  }

  // 3. Furnir calculation (always 2 sides of element, not per plate)
  const furnirLayers = layers.filter(l => l.type === 'furnir');
  const hasFurnir = furnirLayers.length > 0;

  if (hasFurnir) {
    const hasDoubleExpensive = comp.hasDoubleVeneer || furnirLayers.every(l => !l.isKK);

    // Group by label
    const furnirMap: Record<string, { qty: number; isKK: boolean }> = {};
    for (const fl of furnirLayers) {
      const key = fl.materialLabel;
      if (!furnirMap[key]) furnirMap[key] = { qty: 0, isKK: !!fl.isKK };
      furnirMap[key].qty += panelQty * formatM2 * 1.4;
    }

    for (const [label, info] of Object.entries(furnirMap)) {
      items.push({
        label,
        unit: 'm2',
        quantity: parseFloat(info.qty.toFixed(2)),
        category: 'furnir',
        isKK: info.isKK,
      });
    }

    // Lakiranje furnira:
    // - Obje strane skupi furnir (hasDoubleExpensive) → m² × 2
    // - Lice + naličje KK (default) → m² × 1.3 (KK strana treba malo laka)
    const lacquerCoeff = hasDoubleExpensive ? 2 : 1.3;
    items.push({
      label: 'Lakiranje',
      unit: 'm2',
      quantity: parseFloat((panelQty * formatM2 * lacquerCoeff).toFixed(2)),
      category: 'farbanje',
    });
  }

  // 4. HPL calculation (always 2 sides, ×1.2, no lacquering)
  const hplLayers = layers.filter(l => l.type === 'hpl');
  if (hplLayers.length > 0) {
    for (const hl of hplLayers) {
      items.push({
        label: hl.materialLabel,
        unit: 'm2',
        quantity: parseFloat((panelQty * formatM2 * 1.2).toFixed(2)),
        category: 'hpl',
        isKK: hl.isKK,
      });
    }
  }

  // 5. Farbanje MDF (painting area)
  // - Obje strane vidljive (default za MDF) → m² × 2
  // - Jedna strana vidljiva → m² × 1.3 (naličje treba malo farbe)
  const paintLayers = layers.filter(l => l.type === 'farbanje');
  if (paintLayers.length > 0 && !hasFurnir) {
    const bothSides = comp.hasBothSidesVisible !== false; // default true for MDF
    const paintCoeff = bothSides ? 2 : 1.3;
    for (const pl of paintLayers) {
      items.push({
        label: pl.materialLabel,
        unit: 'm2',
        quantity: parseFloat((panelQty * formatM2 * paintCoeff).toFixed(2)),
        category: 'farbanje',
      });
    }
  }

  // 6. Edge banding (kant traka)
  const edgePerimeter = ((comp.height + comp.width) * 2 * comp.quantity) / 1000; // mm → m
  const isThick = comp.thickness >= 36;

  items.push({
    label: isThick ? 'Široka kant traka' : 'Kant traka',
    unit: 'm',
    quantity: parseFloat(edgePerimeter.toFixed(2)),
    category: isThick ? 'kant_siroka' : 'kant',
  });

  return items;
}

// ---- BATCH CALCULATION ----

export function calculateAll(components: SketchUpComponent[], defaultFormat: PanelFormat = DEFAULT_PANEL_FORMAT): CalculationResult[] {
  // Group components by material name
  const byMaterial: Record<string, SketchUpComponent[]> = {};

  for (const comp of components) {
    const key = comp.material || 'Nepoznat materijal';
    if (!byMaterial[key]) byMaterial[key] = [];
    byMaterial[key].push(comp);
  }

  const results: CalculationResult[] = [];

  for (const [materialName, comps] of Object.entries(byMaterial)) {
    const materialType = recognizeMaterialType(materialName);

    // Calculate each component and merge output items
    const mergedItems: Record<string, OutputItem> = {};

    for (const comp of comps) {
      const compItems = calculateComponent(comp, defaultFormat);
      for (const item of compItems) {
        const key = `${item.label}|${item.unit}|${item.category}|${item.isKK || false}`;
        if (mergedItems[key]) {
          mergedItems[key].quantity = parseFloat((mergedItems[key].quantity + item.quantity).toFixed(4));
        } else {
          mergedItems[key] = { ...item };
        }
      }
    }

    results.push({
      materialName,
      materialType,
      components: comps,
      outputItems: Object.values(mergedItems).map(item => {
        // Apply rounding rules to final merged quantities
        if (item.category === 'ploca') {
          item.quantity = roundPanelQty(item.quantity);
        } else if (item.category === 'kant' || item.category === 'kant_siroka') {
          item.quantity = roundKantMeters(item.quantity);
        } else {
          // furnir, hpl, farbanje: round to 2 decimal places
          item.quantity = parseFloat(item.quantity.toFixed(2));
        }
        return item;
      }),
    });
  }

  return results;
}

// ---- CSV PARSING ----

export interface ParsedCSVResult {
  components: SketchUpComponent[];
  warnings: string[];
}

export function parseSketchUpCSV(csvContent: string): ParsedCSVResult {
  const warnings: string[] = [];
  const lines = csvContent.split(/\r?\n/).filter(l => l.trim());

  if (lines.length < 2) {
    return { components: [], warnings: ['CSV mora imati zaglavlje i barem jedan red'] };
  }

  // Detect separator
  const headerLine = lines[0];
  const separator = headerLine.includes(';') ? ';' : ',';
  const headers = headerLine.split(separator).map(h => h.trim().toLowerCase());

  // Map column indices
  const colMap: Record<string, number> = {};
  const mappings: Record<string, string[]> = {
    'naziv': ['naziv', 'name', 'ime', 'component', 'komponenta'],
    'visina': ['visina', 'height', 'v', 'h', 'duzina', 'length'],
    'sirina': ['sirina', 'širina', 'width', 'w', 's'],
    'debljina': ['debljina', 'thickness', 'depth', 'd', 't', 'dubina'],
    'kolicina': ['kolicina', 'količina', 'qty', 'quantity', 'kom', 'komada'],
    'materijal': ['materijal', 'material', 'mat'],
  };

  for (const [field, aliases] of Object.entries(mappings)) {
    const idx = headers.findIndex(h => aliases.includes(h));
    if (idx !== -1) colMap[field] = idx;
  }

  // Check required columns
  if (colMap['naziv'] === undefined) {
    warnings.push('Nije pronađena kolona "Naziv"');
    return { components: [], warnings };
  }

  const components: SketchUpComponent[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(separator).map(c => c.trim().replace(/^["']|["']$/g, ''));

    const name = colMap['naziv'] !== undefined ? cells[colMap['naziv']] : '';
    if (!name) continue;

    const parseNum = (field: string): number => {
      if (colMap[field] === undefined) return 0;
      const val = cells[colMap[field]]?.replace(',', '.');
      return parseFloat(val) || 0;
    };

    const height = parseNum('visina');
    const width = parseNum('sirina');
    const thickness = parseNum('debljina');
    const quantity = parseNum('kolicina') || 1;
    const material = colMap['materijal'] !== undefined ? cells[colMap['materijal']] || '' : '';

    if (height <= 0 && width <= 0 && thickness <= 0) {
      warnings.push(`Red ${i + 1}: "${name}" — nema dimenzija, preskočeno`);
      continue;
    }

    components.push({
      name,
      height,
      width,
      thickness,
      quantity,
      material,
    });
  }

  if (components.length === 0) {
    warnings.push('Nema validnih komponenti u CSV-u');
  }

  return { components, warnings };
}
