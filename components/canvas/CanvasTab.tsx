'use client';

// ════════════════════════════════════════════════════════════════════
// PLATNO — glavni ekran.
//
// IZOLACIJA: ova komponenta ČITA projekte, radnike, naloge i šihtaricu, a AUTOSAVE
// piše isključivo u `planning_scenarios` kroz useScenario. Stvarni posao se crta
// kao zaključana sjena.
//
// JEDINI IZUZETAK — svjesna, KORISNIČKA akcija „Kreiraj stvarni nalog / Naruči
// stvarno" (PromoteBlockModal → promotionService) koja kreira pravi WorkOrder/Order.
// Autosave scenarija i dalje ne dira ništa van `planning_scenarios`.
// ════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
    Plus, Copy, Undo2, Redo2, ChevronLeft, ChevronRight, ChevronDown, Loader2,
    Lock, AlertTriangle, Users, Trash2, Save, Link2, Package, Bookmark, Printer,
    GitCompareArrows, ClipboardList, Sparkles, Rows3, Pencil, MoreHorizontal, Check, LayoutGrid,
    Pause, X,
} from 'lucide-react';
import type {
    Project, Worker, WorkOrder, Order, Supplier, WorkerAttendance, Task,
    PlanBlock, PlanBlockKind, PlanGroupBy, PlanLayout, PlanZoom, PlanScenario, PlanChainTemplate, PlanRef,
} from '@/lib/types';
import {
    getScenarios, createScenario, duplicateScenario, getScenario,
    deleteScenario, getAllAttendanceByMonth, getOrgSettings, saveOrgSettings,
} from '@/lib/services';
import { useAuth } from '@/context/AuthContext';
import { useScenario } from './useScenario';
import { useCanvasDrag } from './useCanvasDrag';
import CanvasDrawer from './CanvasDrawer';
import CanvasDock from './CanvasDock';
import CanvasTimeSlider from './CanvasTimeSlider';
import ChainModal from './ChainModal';
import ProductPickerModal from './ProductPickerModal';
import MaterialOrderModal, { type CreatedPurchase } from './MaterialOrderModal';
import PromoteBlockModal, { type PromoteOrderType } from './PromoteBlockModal';
import WorkOrderWizard, { type WizardMode, type WizardInitialProducts } from '@/components/production/WorkOrderWizard';
import CustomTasksModal from '@/components/ui/CustomTasksModal';
import ChainTemplatesModal from './ChainTemplatesModal';
import CompareModal from './CompareModal';
import WorkerCalendar from './WorkerCalendar';
import BatchTableModal from './BatchTableModal';
import ScheduleReviewModal from './ScheduleReviewModal';
import CanvasMenu from './CanvasMenu';
import { autoSchedule, type AutoScheduleResult } from '@/lib/canvas/autoSchedule';
import { captureChainTemplate, applyChainTemplate } from '@/lib/canvas/templates';
import { buildPlanDocument } from '@/lib/print/planDocument';
import { detectConflicts } from '@/lib/canvas/conflicts';
import { useIsMobile } from '@/hooks/useIsMobile';
import MobileCanvasView from '@/components/tabs/mobile/MobileCanvasView';
import { buildSupplierLeadTimes } from '@/lib/canvas/leadTime';
import { buildSaturdayChecker, type AttendanceLite } from '@/lib/planning';
import { buildRows, groupRowsBySection, SECTION_LABEL, blockLayer, type CanvasRow } from '@/lib/canvas/rows';
import { blockStatusMap, type BlockStatus } from '@/lib/canvas/status';
import { projectColors } from '@/lib/canvas/palette';
import {
    HEADER_WIDTH, TIMELINE_HEADER_HEIGHT, MIN_LABEL_WIDTH, RESIZE_HANDLE_PX,
    blockRect, packLanes, rowHeight, laneTop, headerTicks, monthBands,
    dateAtX, xForDate, anchorCentering, anchorLeading, dayWidth, nonWorkingBands,
    type Viewport, type BlockRect,
} from '@/lib/canvas/geometry';
import {
    newBlock, addDays, BLOCK_LABEL, ZOOM_LABEL, GROUP_BY_LABEL, blockDurationDays, scenarioBounds,
    countWorkingDays,
} from '@/lib/canvas/model';
import { weekendMarksInSpan } from '@/lib/canvas/weekend';
import { todayISO } from '@/lib/planning';
import './CanvasTab.css';

interface CanvasTabProps {
    projects: Project[];
    workers: Worker[];
    workOrders: WorkOrder[];
    /** Samo za empirijske rokove dobavljača — čita se, ne mijenja. */
    orders: Order[];
    suppliers: Supplier[];
    /** Svi zadaci org — za wizard „Poveži postojeći" pri kreiranju iz Platna. */
    tasks?: Task[];
    /** Osvježi podatke app-a nakon pretvorbe (nalog/narudžba postanu vidljivi u svojim tabovima). */
    onRefresh?: (...collections: string[]) => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

const ZOOMS: PlanZoom[] = ['dan', 'sedmica', 'mjesec'];
const GROUPS: PlanGroupBy[] = ['project', 'worker', 'supplier', 'kind'];
const LAYOUTS: { key: PlanLayout; label: string }[] = [
    { key: 'rows', label: 'Nalozi — red po nalogu' },
    { key: 'unified-project', label: 'Objedinjeno — po projektu' },
    { key: 'unified-global', label: 'Objedinjeno — jedan red' },
    { key: 'detailed', label: 'Detaljno — po vrsti' },
];
const LAYOUT_SHORT: Record<PlanLayout, string> = {
    rows: 'Nalozi',
    'unified-project': 'Projekt',
    'unified-global': 'Jedan red',
    detailed: 'Detaljno',
};
/** Ispod ovoliko piksela povlačenje je zapravo klik — klik NE pravi blok (dupli klik pravi). */
const MIN_DRAW_PX = 6;
/** „2026-08-17" → „17.8." */
const dm = (iso: string) => { const [, m, d] = iso.split('-'); return `${Number(d)}.${Number(m)}.`; };
/** Vrste koje se prave brzim tasterom. Nabavka i veze dolaze u Fazi 2. */
const QUICK_KINDS: { kind: PlanBlockKind; key: string }[] = [
    { kind: 'order', key: 'n' },
    { kind: 'purchase', key: 'm' },
    { kind: 'milestone', key: 'v' },
    { kind: 'montaza', key: 'g' },
    { kind: 'transport', key: 't' },
];

export default function CanvasTab({
    projects, workers, workOrders, orders, suppliers, tasks = [], onRefresh, showToast,
}: CanvasTabProps) {
    const { organization } = useAuth();
    const orgId = organization?.Organization_ID || '';
    const isMobile = useIsMobile();

    const [scenarios, setScenarios] = useState<PlanScenario[]>([]);
    const [loaded, setLoaded] = useState<PlanScenario | null>(null);
    const [loading, setLoading] = useState(true);
    const [attendance, setAttendance] = useState<WorkerAttendance[]>([]);
    const [showIdle, setShowIdle] = useState(false);
    const [drawerId, setDrawerId] = useState<string | null>(null);
    const [chainOpen, setChainOpen] = useState(false);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [orderModalFor, setOrderModalFor] = useState<string | null>(null);
    const [promoteId, setPromoteId] = useState<string | null>(null);
    // Pretvorba nalog-bloka u stvarni nalog ide kroz PRAVI flow iz taba Nalozi
    // (wizard za proizvodni/montažni, CustomTasksModal za razni), hranjen iz bloka.
    const [promotingId, setPromotingId] = useState<string | null>(null);
    const [wizardOpen, setWizardOpen] = useState(false);
    const [wizardMode, setWizardMode] = useState<WizardMode>('production');
    const [wizardSeed, setWizardSeed] = useState<WizardInitialProducts | undefined>(undefined);
    const [raniOpen, setRaniOpen] = useState(false);
    const [raniSeed, setRaniSeed] = useState<{ text?: string; workerIds?: string[]; projectId?: string; dueDate?: string } | undefined>(undefined);
    const [templatesOpen, setTemplatesOpen] = useState(false);
    const [templates, setTemplates] = useState<PlanChainTemplate[]>([]);
    const [compareOpen, setCompareOpen] = useState(false);
    const [batchOpen, setBatchOpen] = useState(false);
    const [reviewResult, setReviewResult] = useState<AutoScheduleResult | null>(null);
    /** Radnik čiji je mjesečni kalendar otvoren (klik na ime u sekciji Radnici). */
    const [calendarWorkerId, setCalendarWorkerId] = useState<string | null>(null);
    /** Skupljeni projekti (grupe naloga) — po ključu grupe. */
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
    const toggleGroup = useCallback((key: string) => {
        setCollapsedGroups(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key); else next.add(key);
            return next;
        });
    }, []);

    const { state, dispatch, saveState, canUndo, canRedo, saveNow, reloadRemote, forceOverwrite } =
        useScenario(orgId, loaded);
    const scenario = state.scenario;

    // ── Vidljivi prozor ─────────────────────────────────────────
    const gridRef = useRef<HTMLDivElement>(null);
    const [widthPx, setWidthPx] = useState(1000);
    useEffect(() => {
        const el = gridRef.current;
        if (!el) return;
        const ro = new ResizeObserver(entries => {
            const w = entries[0]?.contentRect.width || 0;
            if (w > 0) setWidthPx(Math.max(320, w - HEADER_WIDTH));
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const zoom = scenario.View?.zoom || 'sedmica';
    const groupBy = scenario.View?.groupBy || 'project';
    const layout = scenario.View?.layout || 'rows';
    const anchorISO = scenario.View?.anchorISO || todayISO();
    const vp: Viewport = useMemo(() => ({ anchorISO, zoom, widthPx }), [anchorISO, zoom, widthPx]);

    // ── Učitavanje ──────────────────────────────────────────────
    useEffect(() => {
        if (!orgId) return;
        let alive = true;
        (async () => {
            setLoading(true);
            try {
                const list = await getScenarios(orgId);
                if (!alive) return;
                setScenarios(list);
                if (list.length > 0) setLoaded(list[0]);
                else {
                    const res = await createScenario('Moj plan', orgId);
                    if (res.success && res.data && alive) {
                        const fresh = await getScenario(res.data.Scenario_ID, orgId);
                        if (fresh && alive) { setScenarios([fresh]); setLoaded(fresh); }
                    }
                }
            } finally {
                if (alive) setLoading(false);
            }
        })();
        return () => { alive = false; };
    }, [orgId]);

    // Šabloni lanaca — korisnikovo znanje radionice, živi u org_settings
    useEffect(() => {
        if (!orgId) return;
        let alive = true;
        getOrgSettings(orgId)
            .then(s => { if (alive) setTemplates(s?.planTemplates || []); })
            .catch(() => { /* šabloni su dodatak, ne blokiraju platno */ });
        return () => { alive = false; };
    }, [orgId]);

    // Šihtarica za sjene odsustava — isti raspon kao stari planer (prošli/tekući/naredni)
    useEffect(() => {
        if (!orgId) return;
        const now = new Date();
        const months = [-1, 0, 1, 2].map(off => {
            const d = new Date(now.getFullYear(), now.getMonth() + off, 1);
            return { y: d.getFullYear(), m: d.getMonth() + 1 };
        });
        Promise.all(months.map(mm => getAllAttendanceByMonth(String(mm.y), String(mm.m), orgId)))
            .then(res => setAttendance(res.flat() as WorkerAttendance[]))
            .catch(() => { /* sjene odsustava su dodatak, ne blokiraju platno */ });
    }, [orgId]);

    // ── Redovi ──────────────────────────────────────────────────
    const rows = useMemo(
        () => buildRows(scenario, groupBy, { workers, workOrders, attendance, showIdleWorkers: showIdle }, layout),
        [scenario, groupBy, workers, workOrders, attendance, showIdle, layout]
    );
    const sections = useMemo(() => groupRowsBySection(rows), [rows]);

    // Živi status blokova pretvorenih u stvarne naloge/narudžbe — ČITA se iz entiteta,
    // preslikava na blok (bez pisanja). Nacrti nisu u mapi (podrazumijevani izgled).
    const statusById = useMemo(
        () => blockStatusMap(scenario.Blocks, { workOrders, orders }),
        [scenario.Blocks, workOrders, orders]
    );

    // ── Kontekst za pravila i kapacitet ─────────────────────────
    // Subotnja rotacija po SVIM aktivnim radnicima — ista pravila kao auto-rok naloga.
    const isSaturdayWorking = useMemo(() => {
        const ids = workers.filter(w => w.Status === 'Aktivan' || w.Status === 'Dostupan')
            .map(w => w.Worker_ID);
        return buildSaturdayChecker(ids, attendance as unknown as AttendanceLite[]);
    }, [workers, attendance]);

    // Per-NALOG subotnja rotacija: boja subote na traci (i njena dužina pri
    // razvlačenju) prati DODIJELJENU ekipu naloga, ne cijeli pogon — inače radnik
    // koji ne radi subotu nikad ne bi bio crven, jer neki drugi aktivan radnik tu
    // subotu radi. Nalog bez radnika pada na shop-level checker. Keširano po sastavu
    // ekipe; šihtarica se prethodno suzi na subote (skenira se po svakoj suboti).
    const satCheckerFor = useMemo(() => {
        const satAtt = (attendance as unknown as AttendanceLite[]).filter(a => {
            const d = new Date(`${(a.Date || '').split('T')[0]}T12:00:00`);
            return !isNaN(d.getTime()) && d.getDay() === 6;
        });
        const cache = new Map<string, (d: Date) => boolean>();
        return (refs: PlanRef[] | undefined): ((d: Date) => boolean) => {
            const ids = (refs || []).map(r => r.id).filter((x): x is string => !!x);
            if (!ids.length) return isSaturdayWorking;
            const key = ids.slice().sort().join('|');
            let checker = cache.get(key);
            if (!checker) { checker = buildSaturdayChecker(ids, satAtt); cache.set(key, checker); }
            return checker;
        };
    }, [attendance, isSaturdayWorking]);

    const leadTimes = useMemo(() => buildSupplierLeadTimes(orders), [orders]);

    const conflictCtx = useMemo(
        () => ({ workers, workOrders, attendance, projects, todayISO: todayISO(), isSaturdayWorking }),
        [workers, workOrders, attendance, projects, isSaturdayWorking]
    );
    const capacityCtx = useMemo(
        () => ({ workers, workOrders, attendance, isSaturdayWorking }),
        [workers, workOrders, attendance, isSaturdayWorking]
    );
    const calendarCtx = useMemo(
        () => ({ blocks: scenario.Blocks, attendance, workOrders, isSaturdayWorking }),
        [scenario.Blocks, attendance, workOrders, isSaturdayWorking]
    );

    /** Skoči na blok: centriraj prikaz i otvori detalje. */
    const jumpToBlock = useCallback((blockId: string) => {
        const b = scenario.Blocks.find(x => x.id === blockId);
        if (!b) return;
        dispatch({ type: 'SET_VIEW', view: { anchorISO: anchorCentering(b.startISO, vp) } });
        dispatch({ type: 'SELECT', ids: [blockId] });
        setDrawerId(blockId);
    }, [scenario.Blocks, dispatch, vp]);

    // ── Povlačenje postojećih blokova ───────────────────────────
    const drag = useCanvasDrag({
        zoom,
        disabled: loading,
        onClick: id => { dispatch({ type: 'SELECT', ids: [id] }); setDrawerId(id); },
        onCommit: ({ blockId, mode, deltaDays }) => {
            const b = scenario.Blocks.find(x => x.id === blockId);
            if (!b) return;
            if (b.locked) { showToast('Blok je zaključan — otključaj ga u detaljima', 'info'); return; }

            // Ručno razvlačenje naloga/montaže MIJENJA radnik-dane (traka i brojevi u
            // detaljima moraju se slagati). Dvosmjerno je: upišeš radnik-dane → traka;
            // razvučeš traku → radnik-dani. Ostale vrste samo mijenjaju datume.
            // Povlačenje mijenja SAMO vrijeme — nikad projekt/radnika/dobavljača (to se
            // radi u detaljima, da se blok ne presvrsta greškom kad ga vučeš vodoravno).
            const isWorkBlock = b.kind === 'order' || b.kind === 'montaza';

            if (mode === 'move') {
                dispatch({ type: 'MOVE_BLOCKS', ids: [blockId], days: deltaDays });
            } else if (mode === 'resize-start') {
                const startISO = addDays(b.startISO, deltaDays);
                if (isWorkBlock && b.workerDays !== undefined) {
                    const workerDays = countWorkingDays(startISO, b.endISO, satCheckerFor(b.workerRefs)) * (b.crew || 1);
                    dispatch({ type: 'UPDATE_BLOCK', id: blockId, patch: { startISO, workerDays } });
                } else {
                    dispatch({ type: 'SET_DATES', id: blockId, startISO });
                }
            } else {
                const endISO = addDays(b.endISO, deltaDays);
                if (isWorkBlock && b.workerDays !== undefined) {
                    const workerDays = countWorkingDays(b.startISO, endISO, satCheckerFor(b.workerRefs)) * (b.crew || 1);
                    dispatch({ type: 'UPDATE_BLOCK', id: blockId, patch: { endISO, workerDays } });
                } else {
                    dispatch({ type: 'SET_DATES', id: blockId, endISO });
                }
            }
        },
    });

    // ── Crtanje novog bloka po praznom redu ─────────────────────
    const [draw, setDraw] = useState<{ rowId: string; fromX: number; toX: number } | null>(null);
    const [quickKind, setQuickKind] = useState<PlanBlockKind>('order');

    const rowContext = useCallback((row: CanvasRow) => {
        // Novi blok naslijedi kontekst reda u kojem je nacrtan — bez toga bi svaki
        // blok trebalo ručno vezati za projekt/radnika.
        if (row.section === 'radnici') {
            const w = workers.find(x => `radnik-${x.Worker_ID}` === row.id);
            return w ? { workerRefs: [{ id: w.Worker_ID, name: w.Name }] } : {};
        }
        if (row.section === 'nalozi' && groupBy === 'project' && !row.synthetic) {
            const p = projects.find(x => `nalozi-${x.Project_ID}` === row.id);
            return p ? { projectRef: { id: p.Project_ID, name: p.Name?.trim() || p.Client_Name } } : {};
        }
        return {};
    }, [workers, projects, groupBy]);

    const commitDraw = useCallback(() => {
        if (!draw) return;
        const row = rows.find(r => r.id === draw.rowId);
        const dragged = Math.abs(draw.toX - draw.fromX);
        setDraw(null);
        if (!row) return;
        // Običan KLIK (bez povlačenja) NE pravi blok — samo je poništio izbor. Blok se
        // pravi povlačenjem raspona ili duplim klikom (namjerna radnja, ne slučajan klik).
        if (dragged < MIN_DRAW_PX) return;
        const a = dateAtX(Math.min(draw.fromX, draw.toX), vp);
        const b = dateAtX(Math.max(draw.fromX, draw.toX), vp);
        const kind = row.section === 'obaveze' ? 'milestone' : quickKind;
        dispatch({
            type: 'ADD_BLOCK',
            block: newBlock(kind, a, kind === 'milestone' ? a : b, rowContext(row)),
        });
    }, [draw, rows, vp, quickKind, rowContext, dispatch]);

    /** Dupli klik na prazan dio reda pravi blok podrazumijevanog trajanja na tom danu. */
    const createOnDoubleClick = useCallback((row: CanvasRow, clientX: number, laneEl: HTMLElement) => {
        const rect = laneEl.getBoundingClientRect();
        const start = dateAtX(clientX - rect.left, vp);
        const kind = row.section === 'obaveze' ? 'milestone' : quickKind;
        const block = newBlock(kind, start, undefined, rowContext(row));
        dispatch({ type: 'ADD_BLOCK', block });
        setDrawerId(block.id);
    }, [vp, quickKind, rowContext, dispatch]);

    // ── Tastatura ───────────────────────────────────────────────
    useEffect(() => {
        const isTyping = () => {
            const el = document.activeElement;
            return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
                || el instanceof HTMLSelectElement || (el as HTMLElement)?.isContentEditable;
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && drag.isDragging) { drag.cancel(); return; }
            if (isTyping()) return;

            const mod = e.ctrlKey || e.metaKey;
            if (mod && e.key.toLowerCase() === 'z') {
                e.preventDefault();
                dispatch({ type: e.shiftKey ? 'REDO' : 'UNDO' });
                return;
            }
            if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); void saveNow(); return; }
            if (mod && e.key.toLowerCase() === 'd' && state.selectedIds.length) {
                e.preventDefault();
                dispatch({ type: 'DUPLICATE_BLOCKS', ids: state.selectedIds });
                return;
            }
            if (mod) return;

            if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedIds.length) {
                e.preventDefault();
                dispatch({ type: 'DELETE_BLOCKS', ids: state.selectedIds });
                setDrawerId(null);
                return;
            }
            if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && state.selectedIds.length) {
                e.preventDefault();
                const step = (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 7 : 1);
                dispatch({ type: 'MOVE_BLOCKS', ids: state.selectedIds, days: step });
                return;
            }
            const quick = QUICK_KINDS.find(q => q.key === e.key.toLowerCase());
            if (quick) {
                e.preventDefault();
                setQuickKind(quick.kind);
                dispatch({ type: 'ADD_BLOCK', block: newBlock(quick.kind, todayISO()) });
                return;
            }
            const zi = ZOOMS.indexOf(zoom);
            if (e.key === '1' || e.key === '2' || e.key === '3') {
                dispatch({ type: 'SET_VIEW', view: { zoom: ZOOMS[Number(e.key) - 1] } });
            } else if (e.key === 'Home') {
                // Danas blizu lijevog ruba, uz par dana konteksta (skore narudžbe su prije naloga).
                dispatch({ type: 'SET_VIEW', view: { anchorISO: anchorLeading(todayISO(), vp) } });
            }
            void zi;
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [dispatch, state.selectedIds, drag, saveNow, zoom, vp]);

    // ── Akcije scenarija ────────────────────────────────────────
    const onNewScenario = async () => {
        const res = await createScenario(`Plan ${scenarios.length + 1}`, orgId);
        if (!res.success || !res.data) { showToast(res.message, 'error'); return; }
        const fresh = await getScenario(res.data.Scenario_ID, orgId);
        if (fresh) { setScenarios(s => [fresh, ...s]); setLoaded(fresh); }
    };

    const onDuplicate = async () => {
        await saveNow();
        const res = await duplicateScenario(scenario.Scenario_ID, orgId);
        if (!res.success || !res.data) { showToast(res.message, 'error'); return; }
        const fresh = await getScenario(res.data.Scenario_ID, orgId);
        if (fresh) { setScenarios(s => [fresh, ...s]); setLoaded(fresh); showToast('Scenarij dupliciran', 'success'); }
    };

    const onSwitch = async (id: string) => {
        if (id === scenario.Scenario_ID) return;
        await saveNow();
        const fresh = await getScenario(id, orgId);
        if (fresh) { setLoaded(fresh); setDrawerId(null); }
    };

    const onDeleteScenario = async () => {
        const count = scenario.Blocks.length;
        const ok = window.confirm(
            `Obrisati plan „${scenario.Name}"${count ? ` sa ${count} blokova` : ''}?\n\n` +
            'Briše se samo plan — nalozi, narudžbe i statusi ostaju netaknuti.'
        );
        if (!ok) return;

        const res = await deleteScenario(scenario.Scenario_ID, orgId);
        if (!res.success) { showToast(res.message, 'error'); return; }

        const rest = scenarios.filter(s => s.Scenario_ID !== scenario.Scenario_ID);
        setScenarios(rest);
        setDrawerId(null);
        showToast('Plan obrisan', 'success');

        if (rest.length > 0) {
            const fresh = await getScenario(rest[0].Scenario_ID, orgId);
            if (fresh) setLoaded(fresh);
        } else {
            // Zadnji plan obrisan → napravi prazan da platno ne ostane bez dokumenta
            const created = await createScenario('Moj plan', orgId);
            if (created.success && created.data) {
                const fresh = await getScenario(created.data.Scenario_ID, orgId);
                if (fresh) { setScenarios([fresh]); setLoaded(fresh); }
            }
        }
    };

    /** Sačuvaj oblik lanca (bez referenci) u org_settings — znanje radionice. */
    const saveTemplate = useCallback(async (anchorId: string, name: string) => {
        const tpl = captureChainTemplate(scenario, anchorId, name);
        if (!tpl) {
            showToast('Taj blok nema ništa vezano ispred sebe — nema lanca za sačuvati', 'info');
            return;
        }
        const next = [...templates, tpl];
        const res = await saveOrgSettings(orgId, { planTemplates: next });
        if (!res.success) { showToast(res.message, 'error'); return; }
        setTemplates(next);
        showToast(`Šablon „${tpl.name}" sačuvan (${tpl.steps.length} koraka)`, 'success');
    }, [scenario, templates, orgId, showToast]);

    const deleteTemplate = useCallback(async (templateId: string) => {
        const next = templates.filter(t => t.id !== templateId);
        const res = await saveOrgSettings(orgId, { planTemplates: next });
        if (!res.success) { showToast(res.message, 'error'); return; }
        setTemplates(next);
        showToast('Šablon obrisan', 'success');
    }, [templates, orgId, showToast]);

    /** Baci šablon na platno — novi blokovi i veze, jedan po jedan (undo radi normalno). */
    const useTemplate = useCallback((tpl: PlanChainTemplate, firstStepStartISO: string) => {
        const { blocks, links } = applyChainTemplate(tpl, firstStepStartISO, { isSaturdayWorking });
        for (const b of blocks) dispatch({ type: 'ADD_BLOCK', block: b });
        for (const l of links) {
            dispatch({ type: 'ADD_LINK', from: l.from, to: l.to, kind: l.kind, lagDays: l.lagDays });
        }
        showToast(`Šablon „${tpl.name}" bačen na platno`, 'success');
    }, [dispatch, isSaturdayWorking, showToast]);

    /** Ispis plana za zid radionice — isti obrazac kao ponuda/narudžba/krojna lista. */
    const printPlan = useCallback(() => {
        if (typeof window === 'undefined') return;
        const doc = buildPlanDocument({
            scenario,
            conflicts: detectConflicts(scenario, conflictCtx),
            companyName: organization?.Name,
        });
        const w = window.open('', '_blank');
        if (!w) { showToast('Preglednik je blokirao prozor za štampu', 'error'); return; }
        w.document.write(doc.html);
        w.document.close();
        w.focus();
        // Bez odgode Chrome ponekad štampa prije nego se stilovi primijene
        setTimeout(() => w.print(), 250);
    }, [scenario, conflictCtx, organization?.Name, showToast]);

    /** Narudžbe iz sastavnice naloga; esencijalne se vežu na njegov početak. */
    const createPurchases = useCallback((purchases: CreatedPurchase[], orderId: string) => {
        for (const p of purchases) {
            const block = newBlock('purchase', p.data.startISO || todayISO(), p.data.endISO, p.data);
            dispatch({ type: 'ADD_BLOCK', block });
            if (p.linkToOrder) {
                dispatch({ type: 'ADD_LINK', from: block.id, to: orderId, kind: 'delivery-to-start' });
            }
        }
        showToast(`Kreirano ${purchases.length} narudžbi u planu`, 'success');
    }, [dispatch, showToast]);

    /** Batch unos: dodaj sve naloge odjednom (jedan undo). */
    const createBatch = useCallback((blocks: typeof scenario.Blocks) => {
        if (!blocks.length) return;
        dispatch({ type: 'ADD_BLOCKS', blocks });
        showToast(`Dodano ${blocks.length} naloga u plan`, 'success');
    }, [dispatch, showToast]);

    /**
     * Auto-raspored → prijedlog za pregled. NIŠTA se ne mijenja dok korisnik ne
     * primijeni; izlaz je čist diff (isti obrazac kao lanac).
     */
    const runSchedule = useCallback(() => {
        const result = autoSchedule(
            scenario,
            { workers, workOrders, attendance, projects, isSaturdayWorking },
            { startISO: todayISO() }
        );
        if (!result.scheduled.length && !result.unscheduled.length) {
            showToast('Nijedan nalog nema kandidat-ekipe za raspored — dodaj ih u batch unosu ili detaljima', 'info');
            return;
        }
        setReviewResult(result);
    }, [scenario, workers, workOrders, attendance, projects, isSaturdayWorking, showToast]);

    // ── Pretvorba nalog-bloka → stvarni nalog (pravi flow iz taba Nalozi) ──
    /** Seed za wizard iz plan-bloka: projekt, proizvodi, ekipa, rokovi. */
    const buildOrderSeed = useCallback((block: PlanBlock): WizardInitialProducts => ({
        projectId: block.projectRef?.id || '',
        projectName: block.projectRef?.name || '',
        products: (block.productRefs || []).map(p => ({
            productId: p.id || '', productName: p.name, quantity: p.qty || 1,
        })),
        startDate: block.startISO,
        dueDate: block.endISO,
        workerIds: (block.workerRefs || []).map(w => w.id).filter(Boolean) as string[],
    }), []);

    /** Izabran tip u PromoteBlockModal → otvori odgovarajući pravi flow, hranjen iz bloka. */
    const onChooseOrderType = useCallback((type: PromoteOrderType) => {
        const block = scenario.Blocks.find(b => b.id === promoteId);
        if (!block) return;
        setPromotingId(block.id);
        if (type === 'zadaci') {
            setRaniSeed({
                text: block.title,
                workerIds: (block.workerRefs || []).map(w => w.id).filter(Boolean) as string[],
                projectId: block.projectRef?.id || '',
                dueDate: block.endISO,
            });
            setRaniOpen(true);
        } else {
            setWizardMode(type === 'montaza' ? 'montaza' : 'production');
            setWizardSeed(buildOrderSeed(block));
            setWizardOpen(true);
        }
    }, [scenario.Blocks, promoteId, buildOrderSeed]);

    /** Nalog je stvarno kreiran → veži plan-blok i osvježi app (vidljiv u tabu Nalozi). */
    const onOrderCreated = useCallback((workOrderId: string) => {
        if (promotingId) {
            dispatch({
                type: 'UPDATE_BLOCK', id: promotingId,
                patch: { linkedWorkOrderId: workOrderId, promotedAt: new Date().toISOString() },
            });
        }
        setPromotingId(null);
        onRefresh?.('workOrders', 'projects', 'orders');
    }, [promotingId, dispatch, onRefresh]);

    // ── Render ──────────────────────────────────────────────────
    const ticks = useMemo(() => headerTicks(vp, todayISO()), [vp]);
    const bands = useMemo(() => monthBands(vp), [vp]);
    const nonwork = useMemo(() => nonWorkingBands(vp), [vp]);
    const todayX = xForDate(todayISO(), vp);

    // Raspon klizača: cijeli plan (+ danas), s malim rubom sa svake strane.
    const timeRange = useMemo(() => {
        const b = scenarioBounds(scenario);
        const today = todayISO();
        const lo = b ? (b.fromISO < today ? b.fromISO : today) : today;
        const hi = b ? (b.toISO > today ? b.toISO : today) : today;
        return { fromISO: addDays(lo, -14), toISO: addDays(hi, 14) };
    }, [scenario]);
    const selected = new Set(state.selectedIds);

    // Umjesto spageta strelica preko cijelog platna: kad je blok izabran, njegovi
    // vezani partneri dobiju prsten. Čitljivije, i ne lomi se pri skrolu i grupisanju.
    const linkedToSelection = useMemo(() => {
        const out = new Set<string>();
        for (const id of state.selectedIds) {
            for (const l of scenario.Links) {
                if (l.from === id) out.add(l.to);
                if (l.to === id) out.add(l.from);
            }
        }
        return out;
    }, [state.selectedIds, scenario.Links]);

    /**
     * Jedan blok — dijeli ga primarni (nalog/montaža) i sekundarni (narudžba/transport)
     * sloj objedinjenog reda. `compact` daje užu, prigušenu traku; `hasSupply` lijepi
     * oznaku „u ovom intervalu stiže narudžba" na nalog.
     */
    const renderBlock = (
        item: PlanBlock, lane: number, rect: BlockRect, rowId: string,
        opts?: { compact?: boolean; hasSupply?: boolean }
    ) => {
        const isDragged = drag.preview?.blockId === item.id;
        const mode = isDragged ? drag.preview!.mode : null;
        const delta = isDragged ? drag.preview!.deltaDays : 0;

        // KLJUČNO: preview se crta iz POMJERENIH datuma istim `blockRect`-om koji određuje
        // i konačni položaj nakon puštanja — pa blok padne TAČNO gdje ga pustiš. Ranije se
        // koristio `rect.left + piksel-pomak`, a `rect.left` je ODSJEČEN na 0 za blokove koji
        // počinju prije vidljivog ruba (narudžbe uz lijevi rub!), pa bi blok pri puštanju
        // „skočio" na drugi dan. Za potpuno vidljive blokove ovo daje isti rezultat kao prije.
        let eff = rect;
        let effStart = item.startISO;
        let effEnd = item.endISO;
        if (isDragged && delta !== 0) {
            if (mode === 'move') { effStart = addDays(effStart, delta); effEnd = addDays(effEnd, delta); }
            else if (mode === 'resize-start') { effStart = addDays(effStart, delta); if (effStart > effEnd) effStart = effEnd; }
            else if (mode === 'resize-end') { effEnd = addDays(effEnd, delta); if (effEnd < effStart) effEnd = effStart; }
            eff = blockRect(effStart, effEnd, vp);
        }

        // Živi status stvarnog naloga/narudžbe iza bloka (nacrt nije u mapi).
        const st = statusById.get(item.id);
        // Boja = PROJEKT, ali kao MEKA TINTA s tamnim tekstom i tankom kapicom
        // (ink) lijevo — smireno i čitljivo i kad ih je dvadeset. Vrijedi samo za
        // radne blokove; rok/narudžba zadržavaju semantičku boju (crveno/žuto).
        const isWorkKind = item.kind === 'order' || item.kind === 'montaza';
        const colors = isWorkKind ? projectColors(item.projectRef?.id || item.projectRef?.name) : null;
        // Vikend NA traci naloga: subota zelena kad dodijeljena ekipa radi, crvena
        // kad ne; nedjelja uvijek crvena. Skriveno na mjesečnom zumu (dan je 11px,
        // oznaka bi bila šum) i na kompaktnim/logističkim trakama. Isti per-nalog
        // checker koji nosi i dužinu trake, pa se boja i dužina slažu.
        const weekend = (isWorkKind && !opts?.compact && zoom !== 'mjesec')
            ? weekendMarksInSpan(effStart, effEnd, satCheckerFor(item.workerRefs))
            : [];
        // Naziv koji ne stane U traku ostaje prazan — ime je u lijevoj koloni.
        const fits = eff.width > MIN_LABEL_WIDTH;
        // Projekt uz dobavljača — korisno u prikazu po dobavljaču / jednom redu; u prikazu
        // „po projektu" je red već projekt, pa je suvišno (i znalo bi se ne slagati s
        // grupisanjem po vezanom nalogu).
        const projectSuffix = (item.kind === 'purchase' && layout !== 'unified-project')
            ? (item.projectRef?.name || '') : '';

        return (
            <div key={item.id}
                className={`cv-block k-${item.kind}${opts?.compact ? ' compact' : ''}${st ? ` s-${st.status}` : ''}${isWorkKind && !st ? ' is-draft' : ''}${selected.has(item.id) ? ' selected' : ''}${linkedToSelection.has(item.id) ? ' linked' : ''}${item.locked ? ' locked' : ''}${item.isSent ? ' sent' : ''}${isDragged ? ' dragging' : ''}${eff.clippedStart ? ' clip-start' : ''}${eff.clippedEnd ? ' clip-end' : ''}`}
                style={{
                    left: eff.left,
                    width: Math.max(6, eff.width),
                    top: laneTop(lane),
                    ...(colors ? {
                        ['--cv-bar' as string]: colors.bar,
                        ['--cv-ink' as string]: colors.ink,
                        ['--cv-txt' as string]: colors.txt,
                    } : {}),
                }}
                onPointerDown={e => drag.onPointerDown(e, item.id, rowId, 'move')}
                onPointerMove={drag.onPointerMove}
                onPointerUp={drag.onPointerUp}
                onPointerCancel={drag.onPointerCancel}
                title={`${item.title}${projectSuffix ? ` · ${projectSuffix}` : ''} · ${item.startISO} → ${item.endISO} (${blockDurationDays(item)} d)${st ? ` · stvarni: ${st.label}${st.ref ? ` (${st.ref})` : ''}` : ''}`}
            >
                {/* Vikend na traci — ispod naziva (z-index), prati ivice bloka. */}
                {weekend.map(m => {
                    const segL = xForDate(m.iso, vp);
                    const l = Math.max(segL, eff.left);
                    const r = Math.min(segL + dayWidth(zoom), eff.left + eff.width);
                    if (r <= l) return null;
                    return (
                        <span key={m.iso}
                            className={`cv-wk ${m.kind} ${m.working ? 'on' : 'off'}`}
                            style={{ left: l - eff.left, width: r - l }} />
                    );
                })}
                {item.kind !== 'milestone' && !item.locked && (
                    <span className="cv-handle left"
                        style={{ width: RESIZE_HANDLE_PX }}
                        onPointerDown={e => drag.onPointerDown(e, item.id, rowId, 'resize-start')}
                        onPointerMove={drag.onPointerMove}
                        onPointerUp={drag.onPointerUp} />
                )}
                <span className="cv-block-label">
                    {item.locked && <Lock size={10} />}
                    {st && <StatusMark status={st.status} />}
                    {fits ? item.title : ''}
                    {projectSuffix && eff.width > MIN_LABEL_WIDTH * 2 && (
                        <span className="cv-block-project">· {projectSuffix}</span>
                    )}
                    {opts?.hasSupply && (
                        <span className="cv-supply-dot" title="U ovom intervalu stiže narudžba materijala">
                            <Package size={10} />
                        </span>
                    )}
                </span>
                {item.kind !== 'milestone' && !item.locked && (
                    <span className="cv-handle right"
                        style={{ width: RESIZE_HANDLE_PX }}
                        onPointerDown={e => drag.onPointerDown(e, item.id, rowId, 'resize-end')}
                        onPointerMove={drag.onPointerMove}
                        onPointerUp={drag.onPointerUp} />
                )}
            </div>
        );
    };

    /**
     * Naslovni red grupe (projekt). Skuplja/širi naloge, i pokazuje raspon grupe
     * kao tanku „ovojnicu" u boji projekta — vidi se KADA je projekt aktivan i
     * kad je skupljen. Sažetak (broj naloga, nacrti, rok) stoji u lijevoj koloni.
     */
    const renderGroupHeader = (row: CanvasRow, vpp: Viewport) => {
        const gh = row.groupHeader!;
        const collapsed = collapsedGroups.has(gh.key);
        const env = gh.fromISO && gh.toISO ? blockRect(gh.fromISO, gh.toISO, vpp) : null;
        const ink = row.colors?.ink;
        const rangeTxt = gh.fromISO && gh.toISO ? `${dm(gh.fromISO)} – ${dm(gh.toISO)}` : '';
        return (
            <div key={row.id} className={`cv-grouprow${collapsed ? ' collapsed' : ''}`}>
                <button className="cv-group-head" onClick={() => toggleGroup(gh.key)}
                    title={collapsed ? 'Proširi projekt' : 'Skupi projekt'}>
                    <ChevronDown size={13} className="cv-group-caret" />
                    <span className="cv-group-dot" style={{ background: ink }} />
                    <span className="cv-group-name" title={row.label}>{row.label}</span>
                    <span className="cv-group-ct">{gh.count}</span>
                    {gh.draftCount > 0 && <span className="cv-group-draft">{gh.draftCount} nacrt</span>}
                    {rangeTxt && <span className="cv-group-rng">{rangeTxt}</span>}
                </button>
                <div className="cv-row-lane cv-group-lane">
                    {collapsed && env && env.visible && (
                        <div className="cv-envelope"
                            style={{ left: env.left, width: Math.max(6, env.width), background: ink }} />
                    )}
                </div>
            </div>
        );
    };

    if (loading) {
        return <div className="cv-center"><Loader2 size={20} className="cv-spin" /> Učitavanje platna…</div>;
    }

    // Telefon dobija agendu, ne platno: dan je ~20px, blok se ne pogodi prstom,
    // a promašen potez bi pomjerio plan. Uređivanje ostaje na računaru.
    if (isMobile) {
        return (
            <MobileCanvasView
                scenario={scenario}
                scenarios={scenarios}
                conflictCtx={conflictCtx}
                onSwitchScenario={id => void onSwitch(id)}
            />
        );
    }

    return (
        <div className="cv-root">
            {/* Jedna traka: SCENARIJ · POGLED ——— KREIRANJE/RASPORED · JOŠ · ISTORIJA */}
            <div className="cv-bar">
                {/* ── Scenarij (naziv + meni planova) ─────────── */}
                <input
                    className="cv-name"
                    value={scenario.Name}
                    onChange={e => dispatch({ type: 'RENAME', name: e.target.value })}
                    aria-label="Naziv plana"
                />
                <CanvasMenu
                    align="left"
                    title="Planovi"
                    trigger={open => (
                        <button className={`cv-icon-btn lg${open ? ' on' : ''}`} title="Prebaci / upravljaj planovima">
                            <ChevronDown size={16} />
                        </button>
                    )}
                    items={[
                        ...scenarios.map(s => ({
                            key: s.Scenario_ID,
                            label: s.Name,
                            active: s.Scenario_ID === scenario.Scenario_ID,
                            onClick: () => void onSwitch(s.Scenario_ID),
                        })),
                        { key: 'new', label: 'Novi plan', icon: <Plus size={14} />, divider: true, onClick: () => void onNewScenario() },
                        { key: 'dup', label: 'Dupliraj plan', icon: <Copy size={14} />, onClick: () => void onDuplicate() },
                        { key: 'del', label: 'Obriši plan', icon: <Trash2 size={14} />, danger: true, onClick: () => void onDeleteScenario() },
                    ]}
                />

                <span className="cv-divider" />

                {/* ── Pogled ─────────────────────────────────── */}
                <div className="cv-seg" role="group" aria-label="Zum">
                    {ZOOMS.map(z => (
                        <button key={z} className={zoom === z ? 'on' : ''}
                            onClick={() => dispatch({ type: 'SET_VIEW', view: { zoom: z } })}>
                            {ZOOM_LABEL[z]}
                        </button>
                    ))}
                </div>

                <div className="cv-nav" role="group" aria-label="Pomjeri prikaz">
                    <button className="cv-nav-arrow" aria-label="Ranije"
                        onClick={() => dispatch({ type: 'SET_VIEW', view: { anchorISO: addDays(anchorISO, zoom === 'mjesec' ? -30 : -7) } })}>
                        <ChevronLeft size={16} />
                    </button>
                    <button className="cv-nav-today"
                        onClick={() => dispatch({ type: 'SET_VIEW', view: { anchorISO: anchorLeading(todayISO(), vp) } })}>
                        Danas
                    </button>
                    <button className="cv-nav-arrow" aria-label="Kasnije"
                        onClick={() => dispatch({ type: 'SET_VIEW', view: { anchorISO: addDays(anchorISO, zoom === 'mjesec' ? 30 : 7) } })}>
                        <ChevronRight size={16} />
                    </button>
                </div>

                <CanvasMenu
                    align="left"
                    title="Raspored redova"
                    trigger={open => (
                        <button className={`cv-btn ghost${open ? ' on' : ''}`} title="Objedinjeni ili detaljni prikaz">
                            <LayoutGrid size={14} /> {LAYOUT_SHORT[layout]} <ChevronDown size={13} className="cv-caret" />
                        </button>
                    )}
                    items={LAYOUTS.map(l => ({
                        key: l.key, label: l.label, active: layout === l.key,
                        onClick: () => dispatch({ type: 'SET_VIEW', view: { layout: l.key } }),
                    }))}
                />

                {/* Grupisanje ima smisla samo u detaljnom prikazu — objedinjeni sam bira osu. */}
                {layout === 'detailed' && (
                    <CanvasMenu
                        align="left"
                        trigger={open => (
                            <button className={`cv-btn ghost${open ? ' on' : ''}`} title="Grupiši redove">
                                <Rows3 size={14} /> {GROUP_BY_LABEL[groupBy]} <ChevronDown size={13} className="cv-caret" />
                            </button>
                        )}
                        items={GROUPS.map(g => ({
                            key: g, label: GROUP_BY_LABEL[g], active: groupBy === g,
                            onClick: () => dispatch({ type: 'SET_VIEW', view: { groupBy: g } }),
                        }))}
                    />
                )}

                <CanvasMenu
                    align="left"
                    title="Crtaj povlačenjem"
                    trigger={open => (
                        <button className={`cv-icon-btn lg${open ? ' on' : ''}`} title={`Šta se crta: ${BLOCK_LABEL[quickKind]}`}>
                            <Pencil size={15} />
                        </button>
                    )}
                    items={QUICK_KINDS.map(q => ({
                        key: q.kind, label: BLOCK_LABEL[q.kind], active: quickKind === q.kind,
                        onClick: () => setQuickKind(q.kind),
                    }))}
                />

                <span className="cv-spacer" />

                {/* ── Kreiranje / raspored ───────────────────── */}
                <button className="cv-btn primary" onClick={() => setPickerOpen(true)}>
                    <Package size={15} /> Novi nalog
                </button>
                <button className="cv-btn" onClick={() => setBatchOpen(true)}
                    title="Unesi više naloga odjednom (proizvodni, montaža, razni)">
                    <ClipboardList size={15} /> Batch
                </button>
                <button className="cv-btn accent" onClick={runSchedule}
                    title="Automatski rasporedi naloge s kandidat-ekipama kroz vrijeme i radnike">
                    <Sparkles size={15} /> Rasporedi
                </button>

                {/* ── Još (overflow) ─────────────────────────── */}
                <CanvasMenu
                    align="right"
                    trigger={open => (
                        <button className={`cv-icon-btn lg${open ? ' on' : ''}`} title="Još radnji">
                            <MoreHorizontal size={18} />
                        </button>
                    )}
                    items={[
                        { key: 'chain', label: 'Lanac: poredaj od roka unazad', icon: <Link2 size={14} />, onClick: () => setChainOpen(true) },
                        { key: 'compare', label: 'Uporedi planove', icon: <GitCompareArrows size={14} />, onClick: () => setCompareOpen(true) },
                        { key: 'templates', label: 'Šabloni lanaca', icon: <Bookmark size={14} />, badge: templates.length, onClick: () => setTemplatesOpen(true) },
                        { key: 'idle', label: showIdle ? 'Sakrij prazne radnike' : 'Prikaži sve radnike', icon: <Users size={14} />, active: showIdle, divider: true, onClick: () => setShowIdle(v => !v) },
                        { key: 'print', label: 'Štampaj plan', icon: <Printer size={14} />, onClick: printPlan },
                    ]}
                />

                <span className="cv-divider" />

                <button className="cv-icon-btn lg" disabled={!canUndo} onClick={() => dispatch({ type: 'UNDO' })} title="Poništi (Ctrl+Z)"><Undo2 size={16} /></button>
                <button className="cv-icon-btn lg" disabled={!canRedo} onClick={() => dispatch({ type: 'REDO' })} title="Ponovi (Ctrl+Shift+Z)"><Redo2 size={16} /></button>

                <span className="cv-divider" />

                <span className="cv-isolation icon-only" title="Platno ne mijenja naloge, narudžbe ni statuse — samo planiranje">
                    <Lock size={14} />
                </span>
                <SaveIndicator
                    saveState={saveState}
                    dirty={state.dirty}
                    onSave={() => void saveNow()}
                    onReload={() => void reloadRemote()}
                    onForce={() => void forceOverwrite()}
                />
            </div>

            {state.notice && <div className="cv-notice">{state.notice}</div>}

            <CanvasTimeSlider
                fromISO={timeRange.fromISO}
                toISO={timeRange.toISO}
                anchorISO={anchorISO}
                onScrub={iso => dispatch({ type: 'SET_VIEW', view: { anchorISO: iso } })}
            />

            {/* Platno */}
            <div className="cv-grid" ref={gridRef}
                style={{
                    ['--cv-header-w' as string]: `${HEADER_WIDTH}px`,
                    ['--cv-day-w' as string]: `${dayWidth(zoom)}px`,
                }}>
                {/* Zaglavlje s datumima */}
                <div className="cv-head" style={{ height: TIMELINE_HEADER_HEIGHT }}>
                    <div className="cv-head-corner">{scenario.Blocks.length} blokova</div>
                    <div className="cv-head-dates">
                        {bands.map(b => (
                            <div key={b.label} className="cv-band" style={{ left: b.left, width: b.width }}>{b.label}</div>
                        ))}
                        {ticks.map(t => (
                            <div key={t.iso}
                                className={`cv-tick${t.major ? ' major' : ''}${t.isToday ? ' today' : ''}${t.isNonWorking ? ' nonwork' : ''}`}
                                style={{ left: t.left, width: t.width }}>
                                {t.label}
                            </div>
                        ))}
                    </div>
                </div>

                {/* Redovi */}
                <div className="cv-body">
                    {/* Nedjelje — tonirane kolone kroz cijelo platno, ispod traka.
                        Bez ovoga se u mreži nije vidjelo gdje sedmica prestaje. */}
                    <div className="cv-nonwork-layer" style={{ left: HEADER_WIDTH }}>
                        {nonwork.map(b => (
                            <div key={b.iso} className="cv-nonwork" style={{ left: b.left, width: b.width }} />
                        ))}
                    </div>
                    {sections.length === 0 && (
                        <div className="cv-empty">
                            Prazno platno. <strong>Dupli klik</strong> pravi blok; povuci mišem da nacrtaš
                            raspon; ili pritisni <kbd>N</kbd> za nalog, <kbd>V</kbd> za prekretnicu.
                        </div>
                    )}
                    {sections.map(sec => (
                        <div key={sec.section} className="cv-section">
                            <div className="cv-section-head">{SECTION_LABEL[sec.section]}</div>
                            {sec.rows
                                .filter(row => !(row.groupKey && collapsedGroups.has(row.groupKey)))
                                .map(row => {
                                // Naslovni red grupe (projekt): skuplja/širi naloge ispod. Nema traka,
                                // samo sažetak raspona i broja naloga na desnoj strani.
                                if (row.groupHeader) {
                                    return renderGroupHeader(row, vp);
                                }
                                // Objedinjeni red: nalog (primarni) je okosnica, ostalo (narudžba/
                                // transport/rok) ide u sekundarni sloj ispod. Detaljni red: sve primarno.
                                const isUnified = layout !== 'detailed';
                                const primaryBlocks = isUnified
                                    ? row.blocks.filter(b => blockLayer(b.kind) === 'primary')
                                    : row.blocks;
                                const secondaryBlocks = isUnified
                                    ? row.blocks.filter(b => blockLayer(b.kind) !== 'primary')
                                    : [];

                                const packedPrimary = packLanes(primaryBlocks, b => b, vp);
                                const packedSecondary = packLanes(secondaryBlocks, b => b, vp);
                                const packedShadows = packLanes(row.shadows, s => s, vp);

                                const primaryLanes = primaryBlocks.length ? packedPrimary.laneCount : 0;
                                const secondaryLanes = secondaryBlocks.length ? packedSecondary.laneCount : 0;
                                const shadowLanes = row.shadows.length ? packedShadows.laneCount : 0;
                                const secBase = primaryLanes;
                                const shadowBase = primaryLanes + secondaryLanes;
                                const h = rowHeight(Math.max(1, primaryLanes + secondaryLanes + shadowLanes));

                                // Nalog kojem narudžba pada u interval → oznaka „materijal stiže tu".
                                const supplyPurchases = secondaryBlocks.filter(b => b.kind === 'purchase');
                                const hasSupply = (b: PlanBlock) =>
                                    supplyPurchases.some(p => p.startISO <= b.endISO && p.endISO >= b.startISO);

                                return (
                                    <div key={row.id} className={`cv-row${row.synthetic ? ' synthetic' : ''}`}
                                        data-row-id={row.id} style={{ height: h }}>
                                        {/* Red radnika je dugme: otvara njegov mjesečni kalendar.
                                            Ostale sekcije nemaju šta otvoriti, pa ostaju običan div
                                            (dugme koje ništa ne radi laže tastaturi i čitaču ekrana). */}
                                        {row.section === 'radnici' ? (
                                            <button
                                                className="cv-row-head clickable"
                                                onClick={() => setCalendarWorkerId(row.id.replace(/^radnik-/, ''))}
                                                title={`Otvori kalendar — ${row.label}`}
                                            >
                                                <span className="cv-row-label">{row.label}</span>
                                                {row.sublabel && <span className="cv-row-sub">{row.sublabel}</span>}
                                            </button>
                                        ) : (
                                            <div className={`cv-row-head${row.groupKey ? ' cv-order-head' : ''}`}
                                                onClick={row.groupKey ? () => { const b = row.blocks[0]; if (b) { dispatch({ type: 'SELECT', ids: [b.id] }); setDrawerId(b.id); } } : undefined}
                                                style={row.colors && row.groupKey ? { ['--cv-row-hue' as string]: row.colors.ink } : undefined}>
                                                {row.groupKey && <span className="cv-order-cap" />}
                                                <span className="cv-order-meta">
                                                    <span className="cv-row-label" title={row.label}>{row.label}</span>
                                                    {row.sublabel && <span className="cv-row-sub" title={row.sublabel}>{row.sublabel}</span>}
                                                </span>
                                            </div>
                                        )}

                                        <div className="cv-row-lane"
                                            onPointerDown={e => {
                                                if (e.button !== 0 || (e.target as HTMLElement).closest('.cv-block')) return;
                                                const rect = e.currentTarget.getBoundingClientRect();
                                                const x = e.clientX - rect.left;
                                                setDraw({ rowId: row.id, fromX: x, toX: x });
                                                dispatch({ type: 'SELECT', ids: [] });
                                            }}
                                            onPointerMove={e => {
                                                if (!draw || draw.rowId !== row.id) return;
                                                const rect = e.currentTarget.getBoundingClientRect();
                                                setDraw(d => d && { ...d, toX: e.clientX - rect.left });
                                            }}
                                            onPointerUp={commitDraw}
                                            onPointerLeave={() => draw?.rowId === row.id && commitDraw()}
                                            onDoubleClick={e => {
                                                if ((e.target as HTMLElement).closest('.cv-block')) return;
                                                setDraw(null);
                                                createOnDoubleClick(row, e.clientX, e.currentTarget);
                                            }}
                                        >
                                            {/* Sjene stvarnog posla — ispod svega, bez ručica */}
                                            {packedShadows.placed.map(({ item, lane, rect }) => (
                                                <div key={item.id}
                                                    className={`cv-shadow ${item.kind}`}
                                                    title={item.hint}
                                                    style={{
                                                        left: rect.left, width: rect.width,
                                                        top: laneTop(shadowBase + lane),
                                                    }}>
                                                    <Lock size={10} />
                                                    {rect.width > MIN_LABEL_WIDTH && <span>{item.label}</span>}
                                                </div>
                                            ))}

                                            {/* Sekundarni sloj — narudžba/transport/rok, prigušeno ispod naloga */}
                                            {packedSecondary.placed.map(({ item, lane, rect }) =>
                                                renderBlock(item, secBase + lane, rect, row.id, { compact: true })
                                            )}

                                            {/* Primarni sloj — nalog/montaža, okosnica reda */}
                                            {packedPrimary.placed.map(({ item, lane, rect }) =>
                                                renderBlock(item, lane, rect, row.id, { hasSupply: isUnified && hasSupply(item) })
                                            )}

                                            {/* Nacrt novog bloka */}
                                            {draw?.rowId === row.id && (
                                                <div className="cv-draw"
                                                    style={{
                                                        left: Math.min(draw.fromX, draw.toX),
                                                        width: Math.max(4, Math.abs(draw.toX - draw.fromX)),
                                                        top: laneTop(0),
                                                    }} />
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ))}

                    {/* Linija današnjeg dana — preko svega */}
                    {todayX >= 0 && todayX <= widthPx && (
                        <div className="cv-today" style={{ left: HEADER_WIDTH + todayX }} />
                    )}
                </div>
            </div>

            <CanvasDock
                scenario={scenario}
                conflictCtx={conflictCtx}
                capacityCtx={capacityCtx}
                fromISO={anchorISO}
                days={Math.min(90, Math.max(14, Math.ceil(widthPx / dayWidth(zoom))))}
                onJumpToBlock={jumpToBlock}
                onMarkSent={id => dispatch({ type: 'UPDATE_BLOCK', id, patch: { isSent: true } })}
                onFix={fix => {
                    if (fix.type === 'shift-block') {
                        dispatch({ type: 'MOVE_BLOCKS', ids: [fix.blockId], days: fix.days });
                    } else if (fix.type === 'create-orders') {
                        setDrawerId(fix.blockId);
                        setOrderModalFor(fix.blockId);
                    }
                }}
            />

            <ChainModal
                isOpen={chainOpen}
                scenario={scenario}
                todayISO={todayISO()}
                isSaturdayWorking={isSaturdayWorking}
                onClose={() => setChainOpen(false)}
                onApply={changes => dispatch({ type: 'APPLY_DATE_DIFF', changes })}
                onSaveTemplate={(anchorId, name) => void saveTemplate(anchorId, name)}
            />

            <ChainTemplatesModal
                isOpen={templatesOpen}
                templates={templates}
                isSaturdayWorking={isSaturdayWorking}
                onClose={() => setTemplatesOpen(false)}
                onApply={useTemplate}
                onDelete={id => void deleteTemplate(id)}
            />

            <CompareModal
                isOpen={compareOpen}
                current={scenario}
                scenarios={scenarios}
                organizationId={orgId}
                conflictCtx={conflictCtx}
                capacityCtx={capacityCtx}
                fromISO={anchorISO}
                days={Math.min(90, Math.max(14, Math.ceil(widthPx / dayWidth(zoom))))}
                onClose={() => setCompareOpen(false)}
            />

            <ProductPickerModal
                isOpen={pickerOpen}
                projects={projects}
                workers={workers}
                workOrders={workOrders}
                startISO={todayISO()}
                isSaturdayWorking={isSaturdayWorking}
                onClose={() => setPickerOpen(false)}
                onCreate={data => {
                    const block = newBlock('order', data.startISO || todayISO(), data.endISO, data);
                    dispatch({ type: 'ADD_BLOCK', block });
                    setDrawerId(block.id);
                }}
            />

            <BatchTableModal
                isOpen={batchOpen}
                projects={projects}
                workOrders={workOrders}
                workers={workers}
                existingBlocks={scenario.Blocks}
                startISO={todayISO()}
                isSaturdayWorking={isSaturdayWorking}
                onClose={() => setBatchOpen(false)}
                onCreate={createBatch}
            />

            <ScheduleReviewModal
                isOpen={reviewResult !== null}
                scenario={scenario}
                result={reviewResult}
                onClose={() => setReviewResult(null)}
                onApply={assignments => dispatch({ type: 'APPLY_SCHEDULE', assignments })}
            />

            <MaterialOrderModal
                isOpen={!!orderModalFor}
                orderBlock={scenario.Blocks.find(b => b.id === orderModalFor) || null}
                projects={projects}
                suppliers={suppliers}
                leadTimes={leadTimes}
                onClose={() => setOrderModalFor(null)}
                onCreate={purchases => {
                    if (orderModalFor) createPurchases(purchases, orderModalFor);
                }}
            />

            <PromoteBlockModal
                block={scenario.Blocks.find(b => b.id === promoteId) || null}
                projects={projects}
                workOrders={workOrders}
                organizationId={orgId}
                onClose={() => setPromoteId(null)}
                onChooseType={onChooseOrderType}
                onPromoted={result => {
                    if (!promoteId) return;
                    // Samo narudžba stiže ovim putem (nalog ide kroz pravi flow → onOrderCreated).
                    dispatch({
                        type: 'UPDATE_BLOCK', id: promoteId, patch: {
                            ...(result.orderId ? { linkedOrderId: result.orderId } : {}),
                            promotedAt: new Date().toISOString(),
                        },
                    });
                    onRefresh?.('orders', 'projects');
                }}
                showToast={showToast}
            />

            {/* Pravi flowovi iz taba Nalozi, hranjeni iz bloka (uvijek montirani, toggle isOpen). */}
            <WorkOrderWizard
                isOpen={wizardOpen}
                mode={wizardMode}
                workOrders={workOrders}
                projects={projects}
                workers={workers}
                tasks={tasks}
                organizationId={orgId}
                initialProducts={wizardSeed}
                onClose={() => { setWizardOpen(false); setPromotingId(null); }}
                onRefresh={(...c) => onRefresh?.(...c)}
                onCreated={id => onOrderCreated(id)}
                showToast={showToast}
            />

            <CustomTasksModal
                isOpen={raniOpen}
                workOrders={workOrders}
                workers={workers}
                projects={projects}
                tasks={tasks}
                organizationId={orgId}
                initialSeed={raniSeed}
                onClose={() => { setRaniOpen(false); setPromotingId(null); }}
                onCreated={(...c) => onRefresh?.(...c)}
                onOrderCreated={id => onOrderCreated(id)}
                showToast={showToast}
            />

            {/* Kalendar radnika — drugi oblik za pitanje „šta radi ovaj čovjek".
                Čita isti scenarij, šihtaricu i stvarne naloge koje platno već ima. */}
            {calendarWorkerId && (() => {
                const w = workers.find(x => x.Worker_ID === calendarWorkerId);
                if (!w) return null;
                return (
                    <WorkerCalendar
                        worker={w}
                        ctx={calendarCtx}
                        todayISO={todayISO()}
                        onClose={() => setCalendarWorkerId(null)}
                        onSelectBlock={id => { setCalendarWorkerId(null); jumpToBlock(id); }}
                    />
                );
            })()}

            {drawerId && (
                <CanvasDrawer
                    block={scenario.Blocks.find(b => b.id === drawerId) || null}
                    status={statusById.get(drawerId) || null}
                    allBlocks={scenario.Blocks}
                    links={scenario.Links}
                    projects={projects}
                    workers={workers}
                    suppliers={suppliers}
                    leadTimes={leadTimes}
                    onClose={() => setDrawerId(null)}
                    onChange={patch => dispatch({ type: 'UPDATE_BLOCK', id: drawerId, patch })}
                    onDelete={() => { dispatch({ type: 'DELETE_BLOCKS', ids: [drawerId] }); setDrawerId(null); }}
                    onAddLink={(from, to, kind) => dispatch({ type: 'ADD_LINK', from, to, kind })}
                    onDeleteLink={id => dispatch({ type: 'DELETE_LINK', id })}
                    onSelectBlock={jumpToBlock}
                    onCreateOrders={() => setOrderModalFor(drawerId)}
                    onPromote={() => setPromoteId(drawerId)}
                />
            )}
        </div>
    );
}

// ── Oznaka živog statusa na bloku ───────────────────────────────────
// Boju nosi lijeva kapica (CSS, po klasi s-*); ovdje je samo mala ikona/tačka:
// U toku pulsira (živ), Pauza/Završeno/Otkazano imaju jasan glif.
function StatusMark({ status }: { status: BlockStatus }) {
    if (status === 'paused') return <Pause size={10} className="cv-status-ico" />;
    if (status === 'done') return <Check size={10} className="cv-status-ico" />;
    if (status === 'cancelled') return <X size={10} className="cv-status-ico" />;
    return <span className={`cv-status-dot${status === 'active' ? ' live' : ''}`} />;
}

// ── Indikator spremanja ─────────────────────────────────────────────

function SaveIndicator({ saveState, dirty, onSave, onReload, onForce }: {
    saveState: ReturnType<typeof useScenario>['saveState'];
    dirty: boolean;
    onSave: () => void;
    onReload: () => void;
    onForce: () => void;
}) {
    if (saveState.kind === 'conflict') {
        return (
            <div className="cv-conflict">
                <AlertTriangle size={14} />
                <span>Scenarij je promijenjen drugdje.</span>
                <button className="cv-btn sm" onClick={onReload}>Učitaj ponovo</button>
                <button className="cv-btn sm danger" onClick={onForce}>Prepiši</button>
            </div>
        );
    }
    if (saveState.kind === 'error') {
        return <span className="cv-save err"><AlertTriangle size={13} /> {saveState.message}</span>;
    }
    if (saveState.kind === 'saving') {
        return <span className="cv-save"><Loader2 size={13} className="cv-spin" /> spremam…</span>;
    }
    if (dirty) {
        return <button className="cv-btn sm" onClick={onSave}><Save size={13} /> Spremi</button>;
    }
    if (saveState.kind === 'saved') {
        return <span className="cv-save ok">snimljeno {saveState.at.toLocaleTimeString('hr-HR', { hour: '2-digit', minute: '2-digit' })}</span>;
    }
    return <span className="cv-save" />;
}

export { Trash2 };
