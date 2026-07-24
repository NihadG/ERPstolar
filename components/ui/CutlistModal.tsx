'use client';

// ════════════════════════════════════════════════════════════════════
// KROJENJE PLOČA — modal na kartici proizvoda
//
// Tok: 1) UNOS krojne liste (paste iz Excela → parsiranje)
//      2) MATERIJALI — prepoznavanje ploče iz kataloga (fuzzy + AI na
//         zahtjev) i izbor dimenzije ploče PO GRUPI materijala
//      3) REZULTAT — ploče grupisane po materijalu (redoslijed iz
//         dokumenta), print/kopiranje, snimanje u JEDAN ILI VIŠE proizvoda
//         i dodavanje ploča + kant trake u materijale (samo za 1 proizvod).
//
// Optimizator: lib/cutlist (guillotine, multi-start — vidi optimizer.ts).
// Prikaz ploče koristi ISTI SVG kod kao print (renderSheetSvg).
// ════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Material, Product, ProductCutList } from '@/lib/types';
import type { CutPart, CutlistSettings } from '@/lib/cutlist/types';
import { parseCutlistText, normalizeMaterialKey, groupKeysInOrder } from '@/lib/cutlist/parse';
import { suggestMaterials, materialSimilarity } from '@/lib/cutlist/match';
import { packGroup, packGroups } from '@/lib/cutlist/optimizer';
import { buildProductCutList, type CutlistGroupMeta } from '@/lib/cutlist/persist';
import { aiMatchMaterials } from '@/lib/cutlist/ai';
import { buildCutlistPrintDocument, renderSheetSvg } from '@/lib/print/cutlistDocument';
import { updateProductCutLists, addMaterialToProduct, saveMaterial } from '@/lib/services';
import { SearchableSelect } from './SearchableSelect';
import './CutlistModal.css';

// ── Imenovanje materijala ────────────────────────────────────────────
// Ploče uvijek "Iveral / <dekor>" (osim ako naziv već sadrži tip ili je
// druga vrsta ploče: lesonit/MDF), kant traka uvijek "KT / <dekor>". Tako
// katalog ostaje uredan i kant se lako veže za svoj dekor.

/** Ogoli dekor: skini vodeći tip ("Iveral / ", "KT / "…) i sufiks "VR". */
function dekorName(label: string): string {
    return (label || '')
        .replace(/^\s*(iveral|iverica|kt|kant|mdf|medijapan|lesonit|lesomal|hdf|šper|sper)\s*\/\s*/i, '')
        .replace(/\s+VR\s*$/i, '')
        .trim();
}

/** Prijedlog naziva za novu PLOČU iz sirovog labela grupe. */
function boardMaterialName(label: string): string {
    const raw = (label || '').trim();
    if (raw.includes('/')) return raw;                       // već "Tip / dekor"
    const k = normalizeMaterialKey(raw);
    if (/(lesonit|lesomal|hdf|mdf|medijapan|sper)/.test(k)) return raw;  // nije iveral
    return `Iveral / ${raw}`;
}

/** Prijedlog naziva za novu KANT TRAKU iz sirovog labela grupe. */
function edgeMaterialName(label: string): string {
    return `KT / ${dekorName(label)}`;
}

/** Najbolja postojeća kant traka za dekor (ili null ako nema pouzdane). */
function findKantMaterial(label: string, candidates: Material[]): Material | null {
    const dekor = dekorName(label);
    let best: Material | null = null;
    let bestScore = 0;
    for (const m of candidates) {
        const score = materialSimilarity(dekor, m.Name);
        if (score > bestScore) { bestScore = score; best = m; }
    }
    return bestScore >= 0.5 ? best : null;
}

// ── Pomoćne strukture ────────────────────────────────────────────────

interface GroupConfig {
    key: string;
    /** Sirovi naziv iz dokumenta. */
    label: string;
    /** Spareni materijal iz kataloga ('' = nesparen). */
    materialId: string;
    boardW: number;
    boardH: number;
    /** false = usmjereni dekor, bez rotacije komada. */
    allowRotation: boolean;
    partCount: number;
    areaM2: number;
}

const BOARD_PRESETS: { label: string; w: number; h: number }[] = [
    { label: '2800 × 2070 (iverica standard)', w: 2800, h: 2070 },
    { label: '2790 × 2060 (obrezana)', w: 2790, h: 2060 },
    { label: '2750 × 1830 (MDF)', w: 2750, h: 1830 },
    { label: '2440 × 1220', w: 2440, h: 1220 },
    { label: '2500 × 1250', w: 2500, h: 1250 },
    { label: '3050 × 1220', w: 3050, h: 1220 },
];

const BOARD_DIMS_STORAGE = 'cutlist-board-dims';

/** Zapamćene dimenzije ploče po materijalu (localStorage). */
function loadSavedBoardDims(): Record<string, { w: number; h: number }> {
    try {
        return JSON.parse(localStorage.getItem(BOARD_DIMS_STORAGE) || '{}');
    } catch {
        return {};
    }
}

function saveBoardDims(materialId: string, w: number, h: number): void {
    if (!materialId) return;
    try {
        const all = loadSavedBoardDims();
        all[materialId] = { w, h };
        localStorage.setItem(BOARD_DIMS_STORAGE, JSON.stringify(all));
    } catch { /* localStorage nedostupan — nije kritično */ }
}

interface CutlistModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** Proizvod s čije je kartice otvoreno krojenje (podrazumijevana meta). */
    product: Product | null;
    /** Svi proizvodi projekta — za primjenu liste na više proizvoda. */
    projectProducts?: Product[];
    projectName?: string;
    materials: Material[];
    organizationId: string;
    onRefresh: (...collections: string[]) => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

type Step = 'input' | 'mapping' | 'results';

export default function CutlistModal({
    isOpen,
    onClose,
    product,
    projectProducts = [],
    projectName,
    materials,
    organizationId,
    onRefresh,
    showToast,
}: CutlistModalProps) {
    const [step, setStep] = useState<Step>('input');
    const [parts, setParts] = useState<CutPart[]>([]);
    const [pasteText, setPasteText] = useState('');
    const [aiBusy, setAiBusy] = useState(false);
    const [groups, setGroups] = useState<GroupConfig[]>([]);
    const [settings, setSettings] = useState<CutlistSettings>({ kerf: 4, trim: 10, allowRotation: true });
    const [optimizing, setOptimizing] = useState<string | null>(null);
    const [cutList, setCutList] = useState<ProductCutList | null>(null);
    const [unplacedNames, setUnplacedNames] = useState<string[]>([]);
    // Savjeti tipa "s rotacijom bi ova grupa stala na manje ploča".
    const [rotationHints, setRotationHints] = useState<string[]>([]);
    const [listName, setListName] = useState('');
    const [saving, setSaving] = useState(false);
    const [showAddPanel, setShowAddPanel] = useState(false);
    const [edgeBandSelection, setEdgeBandSelection] = useState<Record<string, string>>({});
    const [addingMaterials, setAddingMaterials] = useState(false);
    const [creatingEdgeFor, setCreatingEdgeFor] = useState<string | null>(null);
    // Kreiranje novog materijala iz koraka mapiranja (grupa bez para u katalogu).
    const [creatingForGroup, setCreatingForGroup] = useState<string | null>(null);
    const [newMat, setNewMat] = useState({ name: '', category: 'Ploče i trake', unit: 'm²', price: 0, supplier: '' });
    const [creatingMaterial, setCreatingMaterial] = useState(false);
    // Na koje se proizvode lista snima/primjenjuje (podrazumijevano onaj s kartice).
    const [targetProductIds, setTargetProductIds] = useState<string[]>([]);
    const [showProductPicker, setShowProductPicker] = useState(false);
    const [productSearch, setProductSearch] = useState('');

    const savedLists = product?.Cut_Lists || [];
    const singleTarget = targetProductIds.length === 1;

    // Reset na otvaranje.
    useEffect(() => {
        if (isOpen) {
            setStep('input');
            setParts([]);
            setPasteText('');
            setGroups([]);
            setCutList(null);
            setUnplacedNames([]);
            setShowAddPanel(false);
            setEdgeBandSelection({});
            setCreatingForGroup(null);
            setCreatingEdgeFor(null);
            setShowProductPicker(false);
            setProductSearch('');
            setTargetProductIds(product ? [product.Product_ID] : []);
            setListName(`Krojenje ${new Date().toLocaleDateString('hr-HR')}`);
        }
    }, [isOpen, product]);

    // Escape + scroll lock (isti obrazac kao MaterialSelectModal).
    useEffect(() => {
        if (!isOpen) return;
        const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', handleEsc);
        document.body.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', handleEsc);
            document.body.style.overflow = '';
        };
    }, [isOpen, onClose]);

    const boardMaterials = useMemo(
        () => materials.filter(m => !m.Is_Glass && m.Category !== 'Staklo' && !m.Is_Alu_Door && m.Category !== 'Alu vrata'),
        [materials],
    );

    /** Kandidati za kant traku (naziv sadrži kant/abs/traka ili jedinica m). */
    const edgeBandMaterials = useMemo(() => boardMaterials.filter(m => {
        const key = normalizeMaterialKey(m.Name);
        return key.includes('kant') || key.includes('abs') || key.includes('traka') || m.Unit === 'm';
    }), [boardMaterials]);

    // ── KORAK 1: unos ────────────────────────────────────────────────

    function acceptParsedParts(newParts: CutPart[], source: string) {
        if (newParts.length === 0) {
            showToast(`${source}: nije prepoznat nijedan komad`, 'error');
            return;
        }
        setParts(newParts);
        showToast(`Učitano ${newParts.length} tipova komada`, 'success');
    }

    function handlePasteParse() {
        const res = parseCutlistText(pasteText);
        for (const w of res.warnings) showToast(w, 'info');
        acceptParsedParts(res.parts, 'Parsiranje');
    }

    function updatePart(id: string, patch: Partial<CutPart>) {
        setParts(prev => prev.map(p => {
            if (p.id !== id) return p;
            const next = { ...p, ...patch };
            if (patch.materialRaw !== undefined) {
                next.materialKey = normalizeMaterialKey(patch.materialRaw);
            }
            return next;
        }));
    }

    function addEmptyPart() {
        const defaultMat = parts[parts.length - 1]?.materialRaw || 'Ploča';
        setParts(prev => [...prev, {
            id: `cut-m-${Date.now().toString(36)}`,
            name: `Dio ${prev.length + 1}`,
            width: 0,
            height: 0,
            qty: 1,
            materialRaw: defaultMat,
            materialKey: normalizeMaterialKey(defaultMat),
        }]);
    }

    // ── KORAK 2: mapiranje materijala ────────────────────────────────

    function goToMapping() {
        const valid = parts.filter(p => p.width > 0 && p.height > 0 && p.qty > 0);
        if (valid.length === 0) {
            showToast('Nema validnih komada (provjeri dimenzije)', 'error');
            return;
        }
        const savedDims = loadSavedBoardDims();
        const keys = groupKeysInOrder(valid);
        setGroups(prev => keys.map(k => {
            const existing = prev.find(g => g.key === k.key);
            if (existing) return { ...existing, partCount: k.count, areaM2: k.area / 1e6 };

            const suggestions = suggestMaterials(k.label, boardMaterials);
            const auto = suggestions[0] && suggestions[0].score >= 0.62 ? suggestions[0].material : null;
            const saved = auto ? savedDims[auto.Material_ID] : undefined;
            return {
                key: k.key,
                label: k.label,
                materialId: auto?.Material_ID || '',
                boardW: saved?.w || 2800,
                boardH: saved?.h || 2070,
                allowRotation: true,
                partCount: k.count,
                areaM2: k.area / 1e6,
            };
        }));
        setStep('mapping');
    }

    /** Kopiraj kant (K-D/K-Š) ovog reda na SLJEDEĆI red (za brzo redanje). */
    function copyEdgesDown(fromId: string) {
        setParts(prev => {
            const idx = prev.findIndex(p => p.id === fromId);
            if (idx < 0 || idx >= prev.length - 1) return prev;
            const { edgeL, edgeW } = prev[idx];
            return prev.map((p, i) => (i === idx + 1 ? { ...p, edgeL, edgeW } : p));
        });
    }

    /** Kreiraj novi materijal u katalogu i odmah ga spari s grupom. */
    async function handleCreateMaterial(groupKey: string) {
        if (!newMat.name.trim()) {
            showToast('Unesite naziv materijala', 'error');
            return;
        }
        setCreatingMaterial(true);
        try {
            const result = await saveMaterial({
                Name: newMat.name.trim(),
                Category: newMat.category,
                Unit: newMat.unit,
                Default_Unit_Price: newMat.price,
                Default_Supplier: newMat.supplier,
                Description: '',
            }, organizationId);

            if (result.success && result.data) {
                showToast('Materijal kreiran i sparen', 'success');
                updateGroup(groupKey, { materialId: result.data.Material_ID });
                setCreatingForGroup(null);
                onRefresh('materials');
            } else {
                showToast(result.message, 'error');
            }
        } catch {
            showToast('Greška pri kreiranju materijala', 'error');
        } finally {
            setCreatingMaterial(false);
        }
    }

    function updateGroup(key: string, patch: Partial<GroupConfig>) {
        setGroups(prev => prev.map(g => {
            if (g.key !== key) return g;
            const next = { ...g, ...patch };
            // Promjena materijala povlači zapamćene dimenzije ploče za taj materijal.
            if (patch.materialId !== undefined && patch.materialId) {
                const saved = loadSavedBoardDims()[patch.materialId];
                if (saved) { next.boardW = saved.w; next.boardH = saved.h; }
            }
            return next;
        }));
    }

    async function handleAiMatch() {
        const unresolved = groups.filter(g => !g.materialId);
        if (unresolved.length === 0) return;
        setAiBusy(true);
        try {
            const res = await aiMatchMaterials(
                unresolved.map(g => g.label),
                boardMaterials.map(m => ({ id: m.Material_ID, name: m.Name, category: m.Category })),
            );
            if (res.error) {
                showToast(`AI: ${res.error}`, 'error');
                return;
            }
            let matched = 0;
            setGroups(prev => prev.map(g => {
                const id = res.matches[g.label];
                if (!g.materialId && id) { matched++; return { ...g, materialId: id }; }
                return g;
            }));
            showToast(matched > 0
                ? `AI spario ${matched} materijal${matched === 1 ? '' : 'a'}`
                : 'AI nije našao odgovarajuće materijale u katalogu — možeš ih kreirati u katalogu ili ostaviti nesparene',
                matched > 0 ? 'success' : 'info');
        } finally {
            setAiBusy(false);
        }
    }

    // ── KORAK 3: optimizacija i rezultat ─────────────────────────────

    async function runOptimization() {
        const valid = parts.filter(p => p.width > 0 && p.height > 0 && p.qty > 0);
        const groupInputs = groups.map(g => ({
            parts: valid.filter(p => p.materialKey === g.key),
            board: { width: g.boardW, height: g.boardH },
            allowRotation: g.allowRotation,
        })).filter(g => g.parts.length > 0);

        if (groupInputs.length === 0) return;

        setOptimizing('Pripremam…');
        try {
            const results = await packGroups(
                groupInputs,
                settings,
                {},
                (done, total) => setOptimizing(`Optimizujem… ${Math.min(done + 1, total)}/${total}`),
            );

            const meta: CutlistGroupMeta[] = groups.map(g => {
                const mat = materials.find(m => m.Material_ID === g.materialId);
                const m: CutlistGroupMeta = { key: g.key, label: mat?.Name || g.label };
                if (g.materialId) m.materialId = g.materialId;
                if (!g.allowRotation) m.allowRotation = false;
                return m;
            });

            const record = buildProductCutList({
                id: cutList?.ID,
                createdAt: cutList?.Created_At,
                name: listName || `Krojenje ${new Date().toLocaleDateString('hr-HR')}`,
                parts: valid,
                settings,
                results,
                groups: meta,
            });

            setUnplacedNames(results.flatMap(r => r.unplaced.map(p => `${p.name} (${p.width}×${p.height})`)));
            setCutList(record);

            // Grupe bez rotacije: provjeri da li bi rotacija uštedjela ploče,
            // pa korisniku ostavi izbor (dekor je možda usmjeren namjerno).
            const hints: string[] = [];
            for (let i = 0; i < groupInputs.length; i++) {
                if (groupInputs[i].allowRotation) continue;
                const alt = packGroup(
                    groupInputs[i].parts,
                    groupInputs[i].board,
                    { ...settings, allowRotation: true },
                    { timeBudgetMs: 800, maxRestarts: 80 },
                );
                if (alt.sheets.length < results[i].sheets.length) {
                    const label = meta.find(m => m.key === results[i].materialKey)?.label || results[i].materialKey;
                    hints.push(`„${label}": bez rotacije ${results[i].sheets.length} ploča — s rotacijom bi bilo ${alt.sheets.length}. Ako smjer dekora nije bitan, uključi rotaciju za tu grupu.`);
                }
            }
            setRotationHints(hints);

            // Zapamti dimenzije ploče po sparenom materijalu.
            for (const g of groups) {
                if (g.materialId) saveBoardDims(g.materialId, g.boardW, g.boardH);
            }
            setStep('results');
        } finally {
            setOptimizing(null);
        }
    }

    // Auto-poveži kant traku iz kataloga po dekoru čim postoje rezultati
    // (korisnik može promijeniti; ako nema pouzdane veze, ostaje prazno).
    useEffect(() => {
        if (!cutList) return;
        const auto: Record<string, string> = {};
        for (const g of cutList.Groups) {
            if (!g.Edge_Banding_M) continue;
            const kant = findKantMaterial(g.Material_Label, edgeBandMaterials);
            if (kant) auto[g.Material_Label] = kant.Material_ID;
        }
        setEdgeBandSelection(prev => ({ ...auto, ...prev }));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cutList]);

    // ── Akcije na rezultatu ──────────────────────────────────────────

    const targetProducts = useMemo(
        () => targetProductIds
            .map(id => projectProducts.find(p => p.Product_ID === id))
            .filter((p): p is Product => !!p),
        [targetProductIds, projectProducts],
    );

    function toggleTargetProduct(id: string) {
        setTargetProductIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    }

    async function handleSave() {
        if (!cutList || targetProductIds.length === 0 || !organizationId) return;
        setSaving(true);
        const listToSave = { ...cutList, Name: listName || cutList.Name };
        let ok = 0, fail = 0;
        try {
            for (const pid of targetProductIds) {
                const prod = projectProducts.find(p => p.Product_ID === pid);
                const existing = (prod?.Cut_Lists || []).filter(l => l.ID !== listToSave.ID);
                const res = await updateProductCutLists(pid, [...existing, listToSave], organizationId);
                if (res.success) ok++; else fail++;
            }
        } finally {
            setSaving(false);
        }
        if (ok > 0) {
            showToast(ok === 1 ? 'Krojna lista sačuvana' : `Krojna lista sačuvana na ${ok} proizvoda`, 'success');
            onRefresh('projects');
        }
        if (fail > 0) showToast(`Greška pri snimanju na ${fail} proizvoda`, 'error');
    }

    async function handleDeleteSaved(listId: string) {
        if (!product || !organizationId) return;
        if (!confirm('Obrisati ovu krojnu listu?')) return;
        const res = await updateProductCutLists(product.Product_ID, savedLists.filter(l => l.ID !== listId), organizationId);
        showToast(res.success ? 'Krojna lista obrisana' : res.message, res.success ? 'success' : 'error');
        if (res.success) onRefresh('projects');
    }

    function openSaved(list: ProductCutList) {
        setCutList(list);
        setListName(list.Name);
        setUnplacedNames([]);
        setRotationHints([]);
        setStep('results');
    }

    function buildDocument(list: ProductCutList) {
        return buildCutlistPrintDocument({
            cutList: { ...list, Name: listName || list.Name },
            productName: product?.Name,
            projectName,
        });
    }

    function handlePrint() {
        if (!cutList) return;
        // Prozor sinhrono unutar klika — popup blokator (isto kao OffersTab).
        const printWindow = window.open('', '_blank');
        if (!printWindow) return;
        const doc = buildDocument(cutList);
        printWindow.document.open();
        printWindow.document.write(doc.html);
        printWindow.document.close();
        setTimeout(() => {
            if (printWindow.document.fonts?.ready) {
                printWindow.document.fonts.ready.then(() => setTimeout(() => printWindow.print(), 100));
            } else {
                setTimeout(() => printWindow.print(), 500);
            }
        }, 200);
    }

    async function handleCopyTable() {
        if (!cutList) return;
        const rows: string[] = ['Ploča\tMaterijal\tDio\tŠirina\tVisina\tX\tY\tRotiran'];
        let sheetNo = 0;
        for (const g of cutList.Groups) {
            for (const sheet of g.Sheets) {
                sheetNo += 1;
                for (const p of sheet.Placements) {
                    rows.push(`${sheetNo}\t${g.Material_Label}\t${p.Name}\t${p.W}\t${p.H}\t${p.X}\t${p.Y}\t${p.Rotated ? 'Da' : 'Ne'}`);
                }
            }
        }
        try {
            await navigator.clipboard.writeText(rows.join('\n'));
            showToast('Tabela kopirana u međuspremnik', 'success');
        } catch {
            showToast('Kopiranje nije uspjelo', 'error');
        }
    }

    /** Prijedlog dodavanja u materijale proizvoda: ploče + kant trake. */
    const addProposal = useMemo(() => {
        if (!cutList) return [];
        const items: {
            groupLabel: string;
            material: Material | null;
            qty: number;
            unit: string;
            kind: 'board' | 'edge';
            edgeKey?: string;
        }[] = [];
        for (const g of cutList.Groups) {
            const mat = g.Material_ID ? materials.find(m => m.Material_ID === g.Material_ID) || null : null;
            const sheets = g.Sheets.length;
            if (sheets > 0) {
                const isM2 = mat?.Unit === 'm²';
                items.push({
                    groupLabel: g.Material_Label,
                    material: mat,
                    qty: isM2 ? Math.round(sheets * g.Board_Width * g.Board_Height / 1e6 * 100) / 100 : sheets,
                    unit: mat?.Unit || 'kom',
                    kind: 'board',
                });
            }
            if (g.Edge_Banding_M && g.Edge_Banding_M > 0) {
                const selId = edgeBandSelection[g.Material_Label] ?? '';
                const edgeMat = selId ? materials.find(m => m.Material_ID === selId) || null : null;
                items.push({
                    groupLabel: g.Material_Label,
                    material: edgeMat,
                    qty: g.Edge_Banding_M,
                    unit: edgeMat?.Unit || 'm',
                    kind: 'edge',
                    edgeKey: g.Material_Label,
                });
            }
        }
        return items;
    }, [cutList, materials, edgeBandSelection]);

    /** Kreiraj kant traku "KT / dekor" i odmah je izaberi za tu grupu. */
    async function handleCreateEdgeMaterial(groupLabel: string) {
        if (!organizationId) return;
        setCreatingEdgeFor(groupLabel);
        try {
            const result = await saveMaterial({
                Name: edgeMaterialName(groupLabel),
                Category: 'Ploče i trake',
                Unit: 'm',
                Default_Unit_Price: 0,
                Default_Supplier: '',
                Description: '',
            }, organizationId);
            if (result.success && result.data) {
                showToast(`Kreirana kant traka „${edgeMaterialName(groupLabel)}"`, 'success');
                setEdgeBandSelection(prev => ({ ...prev, [groupLabel]: result.data!.Material_ID }));
                onRefresh('materials');
            } else {
                showToast(result.message, 'error');
            }
        } catch {
            showToast('Greška pri kreiranju kant trake', 'error');
        } finally {
            setCreatingEdgeFor(null);
        }
    }

    async function handleAddMaterials() {
        // Dodaje se u JEDAN proizvod — kad lista pokriva više proizvoda ne
        // zna se koliko kojih ploča ide u koji, pa je opcija tada skrivena.
        const targetId = singleTarget ? targetProductIds[0] : null;
        if (!targetId || !organizationId) return;
        const ready = addProposal.filter(i => i.material && i.qty > 0);
        if (ready.length === 0) {
            showToast('Nijedna stavka nema izabran materijal', 'error');
            return;
        }
        setAddingMaterials(true);
        let ok = 0, fail = 0;
        try {
            for (const item of ready) {
                const res = await addMaterialToProduct({
                    Product_ID: targetId,
                    Material_ID: item.material!.Material_ID,
                    Material_Name: item.material!.Name,
                    Quantity: item.qty,
                    Unit: item.material!.Unit,
                    Unit_Price: item.material!.Default_Unit_Price,
                    Supplier: item.material!.Default_Supplier || '',
                }, organizationId);
                if (res.success) ok++; else fail++;
            }
        } finally {
            setAddingMaterials(false);
        }
        if (ok > 0) {
            showToast(`Dodano ${ok} stavki u materijale proizvoda`, 'success');
            onRefresh('projects');
            setShowAddPanel(false);
        }
        if (fail > 0) showToast(`Greška pri dodavanju ${fail} stavki`, 'error');
    }

    // ── Render ───────────────────────────────────────────────────────

    if (!isOpen || typeof window === 'undefined') return null;

    const partsGrouped = groupKeysInOrder(parts.filter(p => p.width > 0 && p.height > 0));
    const totalStats = cutList ? {
        sheets: cutList.Total_Sheets,
        avgEff: (() => {
            const all = cutList.Groups.flatMap(g => g.Sheets);
            return all.length ? all.reduce((s, sh) => s + sh.Efficiency, 0) / all.length : 0;
        })(),
        cutLength: cutList.Groups.reduce((s, g) => s + g.Sheets.reduce((x, sh) => x + sh.Cut_Length, 0), 0),
        partsArea: cutList.Groups.reduce((s, g) => s + g.Sheets.reduce((x, sh) => x + sh.Used_Area, 0), 0),
    } : null;

    return createPortal(
        <>
            <div className="clm-overlay" onClick={onClose} />
            <div className="clm-modal">
                {/* Zaglavlje */}
                <div className="clm-header">
                    <div className="clm-header-left">
                        <div className="clm-header-icon">
                            <span className="material-icons-round">content_cut</span>
                        </div>
                        <div>
                            <div className="clm-title">Krojenje ploča</div>
                            <div className="clm-subtitle">{product?.Name || ''}</div>
                        </div>
                    </div>
                    <div className="clm-steps">
                        <span className={`clm-step ${step === 'input' ? 'active' : ''}`}>1. Lista</span>
                        <span className={`clm-step ${step === 'mapping' ? 'active' : ''}`}>2. Materijali</span>
                        <span className={`clm-step ${step === 'results' ? 'active' : ''}`}>3. Ploče</span>
                    </div>
                    <button className="clm-close-btn" onClick={onClose}>
                        <span className="material-icons-round">close</span>
                    </button>
                </div>

                <div className="clm-body">
                    {/* ── KORAK 1: UNOS ── */}
                    {step === 'input' && (
                        <div className="clm-input-step">
                            <div className="clm-paste-box">
                                <label className="clm-paste-label">
                                    Zalijepi krojnu listu iz Excela (kolone: Naziv, Dužina, Širina, Kom, Materijal — opciono K-D, K-Š)
                                </label>
                                <textarea
                                    placeholder={'Bok\t720\t560\t2\tIveral bijeli 18mm\nPolica\t764\t500\t4\tIveral bijeli 18mm\nLeđa\t1180\t700\t1\tLesonit crni'}
                                    value={pasteText}
                                    onChange={e => setPasteText(e.target.value)}
                                    autoFocus
                                />
                                <button className="clm-btn primary" disabled={!pasteText.trim()} onClick={handlePasteParse}>
                                    <span className="material-icons-round">content_paste</span>
                                    Parsiraj
                                </button>
                            </div>

                            {parts.length > 0 && (
                                <div className="clm-parts-editor">
                                    <div className="clm-parts-header">
                                        <h4>Komadi ({parts.reduce((s, p) => s + p.qty, 0)})
                                            <span className="clm-parts-mats">
                                                {partsGrouped.map(g => `${g.label} (${g.count})`).join(' • ')}
                                            </span>
                                        </h4>
                                        <button className="clm-btn ghost" onClick={addEmptyPart}>
                                            <span className="material-icons-round">add</span> Dodaj red
                                        </button>
                                    </div>
                                    <div className="clm-parts-table">
                                        <div className="clm-pt-row clm-pt-head">
                                            <div>Naziv</div><div>Dužina</div><div>Širina</div><div>Kom</div>
                                            <div>Materijal</div><div title="Kant po dužini">K-D</div><div title="Kant po širini">K-Š</div><div />
                                        </div>
                                        {parts.map(p => (
                                            <div className="clm-pt-row" key={p.id}>
                                                <input value={p.name} onChange={e => updatePart(p.id, { name: e.target.value })} />
                                                <input type="number" value={p.width || ''} onChange={e => updatePart(p.id, { width: parseFloat(e.target.value) || 0 })} />
                                                <input type="number" value={p.height || ''} onChange={e => updatePart(p.id, { height: parseFloat(e.target.value) || 0 })} />
                                                <input type="number" value={p.qty} min={1} onChange={e => updatePart(p.id, { qty: Math.max(1, Math.round(parseFloat(e.target.value) || 1)) })} />
                                                <input value={p.materialRaw} onChange={e => updatePart(p.id, { materialRaw: e.target.value })} />
                                                <select value={p.edgeL || 0} onChange={e => updatePart(p.id, { edgeL: parseInt(e.target.value) || undefined })}>
                                                    <option value={0}>0</option><option value={1}>1</option><option value={2}>2</option>
                                                </select>
                                                <select value={p.edgeW || 0} onChange={e => updatePart(p.id, { edgeW: parseInt(e.target.value) || undefined })}>
                                                    <option value={0}>0</option><option value={1}>1</option><option value={2}>2</option>
                                                </select>
                                                <div className="clm-pt-actions">
                                                    <button
                                                        className="clm-icon-btn"
                                                        title="Kopiraj kant (K-D/K-Š) na sljedeći red"
                                                        onClick={() => copyEdgesDown(p.id)}
                                                    >
                                                        <span className="material-icons-round">south</span>
                                                    </button>
                                                    <button className="clm-icon-btn danger" onClick={() => setParts(prev => prev.filter(x => x.id !== p.id))}>
                                                        <span className="material-icons-round">delete</span>
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Snimljene liste */}
                            {parts.length === 0 && savedLists.length > 0 && (
                                <div className="clm-saved">
                                    <h4>Sačuvane krojne liste</h4>
                                    {savedLists.map(list => (
                                        <div className="clm-saved-row" key={list.ID}>
                                            <div className="clm-saved-info">
                                                <span className="clm-saved-name">{list.Name}</span>
                                                <span className="clm-saved-meta">
                                                    {new Date(list.Created_At).toLocaleDateString('hr-HR')} • {list.Total_Sheets} ploča •{' '}
                                                    {list.Groups.map(g => g.Material_Label).join(', ')}
                                                </span>
                                            </div>
                                            <div className="clm-saved-actions">
                                                <button className="clm-btn ghost" onClick={() => openSaved(list)}>
                                                    <span className="material-icons-round">visibility</span> Otvori
                                                </button>
                                                <button className="clm-icon-btn danger" onClick={() => handleDeleteSaved(list.ID)}>
                                                    <span className="material-icons-round">delete</span>
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* ── KORAK 2: MATERIJALI I PLOČE ── */}
                    {step === 'mapping' && (
                        <div className="clm-mapping-step">
                            <div className="clm-mapping-intro">
                                Za svaku vrstu materijala iz dokumenta izaberi ploču iz kataloga i njenu dimenziju.
                                <button className="clm-btn ghost" onClick={handleAiMatch} disabled={aiBusy || groups.every(g => g.materialId)}>
                                    <span className={`material-icons-round ${aiBusy ? 'clm-spin' : ''}`}>{aiBusy ? 'autorenew' : 'auto_awesome'}</span>
                                    AI prepoznaj nesparene
                                </button>
                            </div>

                            {groups.map(g => {
                                const preset = BOARD_PRESETS.find(p => p.w === g.boardW && p.h === g.boardH);
                                return (
                                    <div className="clm-group-card" key={g.key}>
                                        <div className="clm-group-head">
                                            <span className="clm-group-label">{g.label}</span>
                                            <span className="clm-group-meta">{g.partCount} kom • {g.areaM2.toFixed(2)} m²</span>
                                        </div>
                                        <div className="clm-group-controls">
                                            <div className="clm-field grow">
                                                <label>Materijal iz kataloga</label>
                                                <SearchableSelect
                                                    value={g.materialId}
                                                    onChange={v => updateGroup(g.key, { materialId: v })}
                                                    options={[
                                                        { value: '', label: '— bez sparivanja —', subLabel: 'ploče se neće moći dodati u materijale' },
                                                        ...boardMaterials.map(m => ({
                                                            value: m.Material_ID,
                                                            label: m.Name,
                                                            subLabel: `${m.Category} • ${m.Unit} • ${(m.Default_Unit_Price || 0).toFixed(2)} KM`,
                                                        })),
                                                    ]}
                                                    placeholder="Pretraži katalog…"
                                                />
                                            </div>
                                            <div className="clm-field">
                                                <label>Dimenzija ploče</label>
                                                <select
                                                    value={preset ? `${preset.w}x${preset.h}` : 'custom'}
                                                    onChange={e => {
                                                        if (e.target.value === 'custom') return;
                                                        const [w, h] = e.target.value.split('x').map(Number);
                                                        updateGroup(g.key, { boardW: w, boardH: h });
                                                    }}
                                                >
                                                    {BOARD_PRESETS.map(p => (
                                                        <option key={p.label} value={`${p.w}x${p.h}`}>{p.label}</option>
                                                    ))}
                                                    <option value="custom">Prilagođeno…</option>
                                                </select>
                                            </div>
                                            <div className="clm-field small">
                                                <label>Š (mm)</label>
                                                <input type="number" value={g.boardW} onChange={e => updateGroup(g.key, { boardW: parseFloat(e.target.value) || 0 })} />
                                            </div>
                                            <div className="clm-field small">
                                                <label>V (mm)</label>
                                                <input type="number" value={g.boardH} onChange={e => updateGroup(g.key, { boardH: parseFloat(e.target.value) || 0 })} />
                                            </div>
                                        </div>
                                        <div className="clm-group-footer">
                                            <label className="clm-check" title="Isključi za usmjerene dekore (letvice, fladra) — komadi se neće okretati">
                                                <input
                                                    type="checkbox"
                                                    checked={g.allowRotation}
                                                    onChange={e => updateGroup(g.key, { allowRotation: e.target.checked })}
                                                />
                                                Dozvoli rotaciju 90°
                                            </label>
                                            {!g.materialId && creatingForGroup !== g.key && (
                                                <button
                                                    className="clm-btn ghost"
                                                    onClick={() => {
                                                        setCreatingForGroup(g.key);
                                                        setNewMat({ name: boardMaterialName(g.label), category: 'Ploče i trake', unit: 'm²', price: 0, supplier: '' });
                                                    }}
                                                >
                                                    <span className="material-icons-round">add_circle</span>
                                                    Kreiraj novi materijal
                                                </button>
                                            )}
                                        </div>
                                        {creatingForGroup === g.key && (
                                            <div className="clm-newmat-form">
                                                <div className="clm-field grow">
                                                    <label>Naziv *</label>
                                                    <input value={newMat.name} autoFocus
                                                        onChange={e => setNewMat(m => ({ ...m, name: e.target.value }))} />
                                                </div>
                                                <div className="clm-field">
                                                    <label>Jedinica</label>
                                                    <select value={newMat.unit} onChange={e => setNewMat(m => ({ ...m, unit: e.target.value }))}>
                                                        <option value="m²">m²</option>
                                                        <option value="kom">kom</option>
                                                        <option value="m">m</option>
                                                    </select>
                                                </div>
                                                <div className="clm-field small">
                                                    <label>Cijena (KM)</label>
                                                    <input type="number" step="0.01" min="0" value={newMat.price || ''}
                                                        onChange={e => setNewMat(m => ({ ...m, price: parseFloat(e.target.value) || 0 }))} />
                                                </div>
                                                <div className="clm-field">
                                                    <label>Dobavljač</label>
                                                    <input value={newMat.supplier} placeholder="Opciono"
                                                        onChange={e => setNewMat(m => ({ ...m, supplier: e.target.value }))} />
                                                </div>
                                                <div className="clm-newmat-actions">
                                                    <button className="clm-btn secondary" onClick={() => setCreatingForGroup(null)}>Otkaži</button>
                                                    <button className="clm-btn primary" disabled={creatingMaterial || !newMat.name.trim()}
                                                        onClick={() => handleCreateMaterial(g.key)}>
                                                        {creatingMaterial ? 'Kreiram…' : 'Sačuvaj i spari'}
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}

                            <div className="clm-settings-row">
                                <div className="clm-field small">
                                    <label>Rez pile (mm)</label>
                                    <input type="number" step="0.5" min="0" value={settings.kerf}
                                        onChange={e => setSettings(s => ({ ...s, kerf: parseFloat(e.target.value) || 0 }))} />
                                </div>
                                <div className="clm-field small">
                                    <label>Obrez ruba (mm)</label>
                                    <input type="number" min="0" value={settings.trim}
                                        onChange={e => setSettings(s => ({ ...s, trim: parseFloat(e.target.value) || 0 }))} />
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ── KORAK 3: REZULTAT ── */}
                    {step === 'results' && cutList && totalStats && (
                        <div className="clm-results-step">
                            <div className="clm-stats-row">
                                <div className="clm-stat">
                                    <div className="clm-stat-value">{totalStats.sheets}</div>
                                    <div className="clm-stat-label">ploča ukupno</div>
                                </div>
                                <div className="clm-stat">
                                    <div className="clm-stat-value green">{totalStats.avgEff.toFixed(1)}%</div>
                                    <div className="clm-stat-label">prosječna iskorištenost</div>
                                </div>
                                <div className="clm-stat">
                                    <div className="clm-stat-value">{(totalStats.partsArea / 1e6).toFixed(2)} m²</div>
                                    <div className="clm-stat-label">površina komada</div>
                                </div>
                                <div className="clm-stat">
                                    <div className="clm-stat-value">{(totalStats.cutLength / 1000).toFixed(1)} m</div>
                                    <div className="clm-stat-label">dužina reza</div>
                                </div>
                                <div className="clm-name-field">
                                    <label>Naziv liste</label>
                                    <input value={listName} onChange={e => setListName(e.target.value)} />
                                </div>
                            </div>

                            {unplacedNames.length > 0 && (
                                <div className="clm-warning">
                                    <span className="material-icons-round">warning</span>
                                    Ne staju na ploču: {unplacedNames.join(', ')}
                                </div>
                            )}

                            {rotationHints.map((hint, i) => (
                                <div className="clm-info" key={i}>
                                    <span className="material-icons-round">lightbulb</span>
                                    {hint}
                                </div>
                            ))}

                            {/* Na koje proizvode se lista primjenjuje (1 ili više) */}
                            {projectProducts.length > 0 && (
                                <div className="clm-apply">
                                    <div className="clm-apply-head">
                                        <span className="clm-apply-title">
                                            <span className="material-icons-round">inventory_2</span>
                                            Krojna lista se odnosi na:
                                        </span>
                                        <button className="clm-btn ghost" onClick={() => { setShowProductPicker(v => !v); setProductSearch(''); }}>
                                            <span className="material-icons-round">{showProductPicker ? 'expand_less' : 'add'}</span>
                                            {showProductPicker ? 'Zatvori' : 'Izaberi proizvode'}
                                        </button>
                                    </div>
                                    <div className="clm-apply-chips">
                                        {targetProducts.length === 0 && <span className="clm-apply-empty">nijedan proizvod izabran</span>}
                                        {targetProducts.map(p => (
                                            <span className="clm-chip" key={p.Product_ID}>
                                                {p.Name}
                                                <button onClick={() => toggleTargetProduct(p.Product_ID)} title="Ukloni">
                                                    <span className="material-icons-round">close</span>
                                                </button>
                                            </span>
                                        ))}
                                    </div>
                                    {showProductPicker && (
                                        <div className="clm-apply-picker">
                                            <input
                                                className="clm-apply-search"
                                                placeholder="Pretraži proizvode projekta…"
                                                value={productSearch}
                                                autoFocus
                                                onChange={e => setProductSearch(e.target.value)}
                                            />
                                            <div className="clm-apply-list">
                                                {projectProducts
                                                    .filter(p => !productSearch.trim() || p.Name.toLowerCase().includes(productSearch.toLowerCase()))
                                                    .map(p => {
                                                        const on = targetProductIds.includes(p.Product_ID);
                                                        return (
                                                            <label className={`clm-apply-item ${on ? 'on' : ''}`} key={p.Product_ID}>
                                                                <input type="checkbox" checked={on} onChange={() => toggleTargetProduct(p.Product_ID)} />
                                                                <span className="clm-apply-item-name">{p.Name}</span>
                                                                {(p.Cut_Lists?.length || 0) > 0 && (
                                                                    <span className="clm-apply-item-badge">{p.Cut_Lists!.length} krojenja</span>
                                                                )}
                                                            </label>
                                                        );
                                                    })}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {cutList.Groups.map((g, gi) => (
                                <div className="clm-result-group" key={gi}>
                                    <div className="clm-result-group-head">
                                        <span className="clm-result-group-title">{g.Material_Label}</span>
                                        <span className="clm-result-group-meta">
                                            {g.Sheets.length} ploča {g.Board_Width}×{g.Board_Height}
                                            {g.Edge_Banding_M ? ` • kant ${g.Edge_Banding_M.toFixed(1)} m` : ''}
                                        </span>
                                    </div>
                                    {g.Sheets.map((sheet, si) => (
                                        <div className="clm-sheet" key={si}>
                                            <div className="clm-sheet-head">
                                                <span>Ploča {si + 1}/{g.Sheets.length}</span>
                                                <span className="clm-sheet-meta">
                                                    {sheet.Offcuts?.[0] ? `najveći ostatak ${sheet.Offcuts[0].W}×${sheet.Offcuts[0].H} mm` : ''}
                                                </span>
                                                <span className={`clm-eff ${sheet.Efficiency > 88 ? 'good' : sheet.Efficiency > 75 ? 'ok' : 'low'}`}>
                                                    {sheet.Efficiency.toFixed(1)}%
                                                </span>
                                            </div>
                                            <div
                                                className="clm-sheet-svg"
                                                // SVG iz istog koda kao print — bez duplog crtanja.
                                                dangerouslySetInnerHTML={{
                                                    __html: renderSheetSvg(sheet, g.Board_Width, g.Board_Height, cutList.Settings.Trim),
                                                }}
                                            />
                                        </div>
                                    ))}
                                </div>
                            ))}

                            {/* Dodavanje u materijale proizvoda (samo za jedan proizvod) */}
                            {showAddPanel && singleTarget && (
                                <div className="clm-add-panel">
                                    <h4>Dodaj u materijale — {targetProducts[0]?.Name}</h4>
                                    {addProposal.map((item, i) => (
                                        <div className="clm-add-row" key={i}>
                                            <span className="clm-add-kind material-icons-round">
                                                {item.kind === 'board' ? 'dashboard' : 'straighten'}
                                            </span>
                                            <div className="clm-add-info">
                                                <span>{item.kind === 'board' ? item.groupLabel : `Kant traka — ${item.groupLabel}`}</span>
                                                <strong>{item.qty} {item.unit}</strong>
                                            </div>
                                            {item.kind === 'board' ? (
                                                <span className={`clm-add-target ${item.material ? '' : 'missing'}`}>
                                                    {item.material ? item.material.Name : 'nesparen materijal — vrati se na korak 2'}
                                                </span>
                                            ) : (
                                                <div className="clm-add-edge">
                                                    <select
                                                        value={edgeBandSelection[item.edgeKey!] ?? ''}
                                                        onChange={e => setEdgeBandSelection(prev => ({ ...prev, [item.edgeKey!]: e.target.value }))}
                                                    >
                                                        <option value="">— izaberi kant traku —</option>
                                                        {edgeBandMaterials.map(m => (
                                                            <option key={m.Material_ID} value={m.Material_ID}>{m.Name}</option>
                                                        ))}
                                                    </select>
                                                    {!(edgeBandSelection[item.edgeKey!]) && (
                                                        <button
                                                            className="clm-btn ghost clm-add-create"
                                                            disabled={creatingEdgeFor === item.edgeKey}
                                                            title={`Kreiraj „${edgeMaterialName(item.groupLabel)}" u katalogu`}
                                                            onClick={() => handleCreateEdgeMaterial(item.edgeKey!)}
                                                        >
                                                            <span className="material-icons-round">add_circle</span>
                                                            {creatingEdgeFor === item.edgeKey ? 'Kreiram…' : edgeMaterialName(item.groupLabel)}
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                    <div className="clm-add-actions">
                                        <button className="clm-btn secondary" onClick={() => setShowAddPanel(false)}>Otkaži</button>
                                        <button className="clm-btn primary" disabled={addingMaterials} onClick={handleAddMaterials}>
                                            {addingMaterials ? 'Dodajem…' : 'Dodaj stavke'}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Podnožje */}
                <div className="clm-footer">
                    <div className="clm-footer-left">
                        {step === 'mapping' && (
                            <button className="clm-btn secondary" onClick={() => setStep('input')}>
                                <span className="material-icons-round">arrow_back</span> Lista
                            </button>
                        )}
                        {step === 'results' && (
                            <button className="clm-btn secondary" onClick={() => setStep(groups.length ? 'mapping' : 'input')}>
                                <span className="material-icons-round">arrow_back</span> Izmijeni
                            </button>
                        )}
                    </div>
                    <div className="clm-footer-actions">
                        {step === 'input' && (
                            <button className="clm-btn primary" disabled={parts.length === 0} onClick={goToMapping}>
                                Nastavi <span className="material-icons-round">arrow_forward</span>
                            </button>
                        )}
                        {step === 'mapping' && (
                            <button className="clm-btn primary" disabled={!!optimizing} onClick={runOptimization}>
                                <span className={`material-icons-round ${optimizing ? 'clm-spin' : ''}`}>{optimizing ? 'autorenew' : 'bolt'}</span>
                                {optimizing || 'Optimizuj krojenje'}
                            </button>
                        )}
                        {step === 'results' && cutList && (
                            <>
                                <button className="clm-btn secondary" onClick={handleCopyTable}>
                                    <span className="material-icons-round">table_view</span> Kopiraj tabelu
                                </button>
                                <button className="clm-btn secondary" onClick={handlePrint}>
                                    <span className="material-icons-round">print</span> Print
                                </button>
                                {singleTarget && (
                                    <button className="clm-btn secondary" onClick={() => setShowAddPanel(v => !v)}>
                                        <span className="material-icons-round">playlist_add</span> U materijale
                                    </button>
                                )}
                                <button className="clm-btn primary" disabled={saving || targetProductIds.length === 0} onClick={handleSave}>
                                    <span className="material-icons-round">save</span>
                                    {saving ? 'Spremam…'
                                        : targetProductIds.length <= 1 ? 'Sačuvaj u proizvod'
                                            : `Sačuvaj na ${targetProductIds.length} proizvoda`}
                                </button>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </>,
        document.body
    );
}
