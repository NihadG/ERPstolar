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

import { useState, useEffect, useMemo, useRef, useCallback, useDeferredValue, Fragment } from 'react';
import { createPortal } from 'react-dom';
import {
    Plus, Copy, Undo2, Redo2, ChevronLeft, ChevronRight, ChevronDown, Loader2,
    Lock, AlertTriangle, Users, Trash2, Save, Link2, Package, Bookmark, Printer,
    GitCompareArrows, ClipboardList, Sparkles, Rows3, Pencil, MoreHorizontal, LayoutGrid, Activity,
    Pause, Check, X,
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
import RealityModal from './RealityModal';
import { getWorkLogsSince } from '@/lib/services';
import CanvasMenu from './CanvasMenu';
import { planHealth, proposeScheduleAsync, type Proposal } from '@/lib/canvas/opt/propose';
import { FREEZE_WORK_DAYS } from '@/lib/canvas/opt/freeze';
import { captureChainTemplate, applyChainTemplate } from '@/lib/canvas/templates';
import { buildPlanDocument } from '@/lib/print/planDocument';
import { detectConflicts } from '@/lib/canvas/conflicts';
import { useIsMobile } from '@/hooks/useIsMobile';
import MobileCanvasView from '@/components/tabs/mobile/MobileCanvasView';
import { buildSupplierLeadTimes } from '@/lib/canvas/leadTime';
import { buildSaturdayChecker, type AttendanceLite } from '@/lib/planning';
import {
    buildRows, groupRowsBySection, SECTION_LABEL, blockLayer, scenarioProjectColors, colorsFor, projectKeyOf,
    type CanvasRow,
} from '@/lib/canvas/rows';
import { blockStatusMap, type BlockStatus } from '@/lib/canvas/status';
import {
    TIMELINE_HEADER_HEIGHT, MIN_LABEL_WIDTH, RESIZE_HANDLE_PX,
    blockRect, packLanes, rowHeight, laneTop, headerTicks, monthBands, headerWidthFor,
    dateAtX, xForDate, anchorCentering, anchorLeading, dayWidth, nonWorkingBands, visibleDates,
    type Viewport, type BlockRect,
} from '@/lib/canvas/geometry';
import {
    newBlock, addDays, BLOCK_LABEL, ZOOM_LABEL, GROUP_BY_LABEL, blockDurationDays, scenarioBounds,
    countWorkingDays, isWorkDay,
} from '@/lib/canvas/model';
import { mergeBlocks, splitBlock } from '@/lib/canvas/quickActions';
import { v4 as uuidv4 } from 'uuid';
import { workRuns } from '@/lib/canvas/weekend';
import {
    parsePlanTitle, fitBlockLabel, fitWords, fitVariants, isFullLabel, LABEL, type BlockLabelFit,
} from '@/lib/canvas/label';
import { shortNameMap, shortNameOf } from '@/lib/canvas/crews';
import { todayISO } from '@/lib/planning';
import { useHolidays } from '@/components/settings/useHolidays';
import { measureText, resetTextMeasure } from './measure';
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
    /**
     * SAMO za /canvas-preview: plan iz memorije umjesto iz baze. Ne učitava se
     * ništa, a autosave ne piše (nema organizacije). U aplikaciji se ne prosljeđuje.
     */
    preview?: { scenario: PlanScenario; attendance?: WorkerAttendance[]; todayISO?: string };
}

const ZOOMS: PlanZoom[] = ['dan', 'sedmica', 'mjesec'];
const GROUPS: PlanGroupBy[] = ['project', 'worker', 'supplier', 'kind'];
/** Tri pogleda u traci. Stari rasporedi (detaljno, jedan red) su u meniju ⋯. */
const LENSES: { key: PlanLayout; label: string; title: string }[] = [
    { key: 'unified-project', label: 'Projekti', title: 'Projekat → jedan red po ekipi koja na njemu radi' },
    { key: 'crews', label: 'Ekipe', title: 'Parovi po subotnjoj smjeni, preko svih projekata — ko je kad zauzet' },
    { key: 'rows', label: 'Nalozi', title: 'Jedan red po nalogu, puni naziv lijevo' },
];
const OLD_LAYOUTS: { key: PlanLayout; label: string }[] = [
    { key: 'detailed', label: 'Stari prikaz: detaljno po vrsti' },
    { key: 'unified-global', label: 'Stari prikaz: sve u jednom redu' },
];
const MONTHS_FULL = ['Januar', 'Februar', 'Mart', 'April', 'Maj', 'Juni', 'Juli', 'August', 'Septembar', 'Oktobar', 'Novembar', 'Decembar'];
const MONTHS_SHORT = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const DOW_LETTER = ['N', 'P', 'U', 'S', 'Č', 'P', 'S'];
const DOW_SHORT = ['ned', 'pon', 'uto', 'sri', 'čet', 'pet', 'sub'];
/** Mjesto za tačku statusa / katanac ispred šifre u natpisu trake. */
const STATUS_DOT_W = 13;
const LOCK_W = 14;
/** Bosanska množina: 1 nalog, 2 naloga, 5 naloga. */
function bsPlural(n: number, one: string, few: string, many: string): string {
    const m10 = n % 10, m100 = n % 100;
    return `${n} ${m10 === 1 && m100 !== 11 ? one : (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) ? few : many}`;
}
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
    projects, workers, workOrders, orders, suppliers, tasks = [], onRefresh, showToast, preview,
}: CanvasTabProps) {
    const { organization } = useAuth();
    // Preview nema organizaciju → ništa se ne učitava i autosave ne piše (useScenario).
    const orgId = preview ? '' : (organization?.Organization_ID || '');
    // Praznici radionice (Postavke → Praznici) — neradni dani na traci i u rasporedu.
    const { dates: holidayDates } = useHolidays(orgId || null);
    const isMobile = useIsMobile();
    const today = preview?.todayISO || todayISO();

    const [scenarios, setScenarios] = useState<PlanScenario[]>(preview ? [preview.scenario] : []);
    const [loaded, setLoaded] = useState<PlanScenario | null>(preview?.scenario || null);
    const [loading, setLoading] = useState(!preview);
    const [attendance, setAttendance] = useState<WorkerAttendance[]>(preview?.attendance || []);
    /** Projekat istaknut iz legende (prikaz Ekipe) — ostali blokovi se priguše. */
    const [focusProject, setFocusProject] = useState<string | null>(null);
    /** Kartica na hover: puni naziv, datumi, ekipa. */
    const [hover, setHover] = useState<{ id: string; left: number; top: number; bottom: number } | null>(null);
    // Natpisi se mjere u fontu aplikacije — kad se font učita, izmjeri ponovo.
    const [, setFontTick] = useState(0);
    useEffect(() => {
        let alive = true;
        document.fonts?.ready.then(() => { if (alive) { resetTextMeasure(); setFontTick(t => t + 1); } });
        return () => { alive = false; };
    }, []);
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
    const [realityOpen, setRealityOpen] = useState(false);
    const [batchOpen, setBatchOpen] = useState(false);
    const [reviewResult, setReviewResult] = useState<Proposal | null>(null);
    const [scheduling, setScheduling] = useState(false);
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
    // Lijeva kolona je uža na laptopu (headerWidthFor), da osa zadrži ~4 sedmice.
    const gridRef = useRef<HTMLDivElement>(null);
    const [gridW, setGridW] = useState(1220);
    useEffect(() => {
        const el = gridRef.current;
        if (!el) return;
        const ro = new ResizeObserver(entries => {
            const w = entries[0]?.contentRect.width || 0;
            if (w > 0) setGridW(w);
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, [loading]);
    const headerW = headerWidthFor(gridW);
    const widthPx = Math.max(320, gridW - headerW);

    const zoom = scenario.View?.zoom || 'sedmica';
    const groupBy = scenario.View?.groupBy || 'project';
    const layout = scenario.View?.layout || 'unified-project';
    const anchorISO = scenario.View?.anchorISO || today;
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
        () => buildRows(scenario, groupBy, { workers, workOrders, attendance, showIdleWorkers: showIdle, todayISO: today, holidays: holidayDates }, layout),
        [scenario, groupBy, workers, workOrders, attendance, showIdle, layout, today, holidayDates]
    );
    const sections = useMemo(() => groupRowsBySection(rows), [rows]);
    /** Boje projekata plana — dva projekta nikad iste boje (legenda, trake, naslovi). */
    const projectColorsMap = useMemo(() => scenarioProjectColors(scenario), [scenario]);
    /** Kratka imena za ekipe („Nedim + Aldin"). */
    const shortNames = useMemo(() => shortNameMap(workers), [workers]);
    /** Legenda prikaza Ekipe: projekti plana, redom kojim počinju. */
    const legend = useMemo(() => {
        const seen = new Map<string, { key: string; name: string; ink: string; start: string }>();
        for (const b of scenario.Blocks) {
            if (!b.projectRef || (b.kind !== 'order' && b.kind !== 'montaza')) continue;
            const key = projectKeyOf(b.projectRef);
            const cur = seen.get(key);
            if (!cur) seen.set(key, { key, name: b.projectRef.name.trim(), ink: colorsFor(projectColorsMap, b.projectRef).ink, start: b.startISO });
            else if (b.startISO < cur.start) cur.start = b.startISO;
        }
        return Array.from(seen.values()).sort((a, b) => a.start.localeCompare(b.start) || a.name.localeCompare(b.name, 'hr'));
    }, [scenario.Blocks, projectColorsMap]);

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
        return buildSaturdayChecker(ids, attendance as unknown as AttendanceLite[], workers, holidayDates);
    }, [workers, attendance, holidayDates]);

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
            if (!checker) { checker = buildSaturdayChecker(ids, satAtt, workers, holidayDates); cache.set(key, checker); }
            return checker;
        };
    }, [attendance, isSaturdayWorking, workers, holidayDates]);

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
        // blok trebalo ručno vezati za projekt/radnika. Red ekipe daje i projekat i par.
        if (row.context) return row.context;
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
    // Radni dan ekipe otvorenog naloga (smjene, praznici) — brze akcije u polovinama dana.
    const drawerBlock = drawerId ? scenario.Blocks.find(b => b.id === drawerId) : undefined;
    const drawerRefs = drawerBlock?.workerRefs;
    const drawerIsWork = useCallback((iso: string) => isWorkDay(iso, satCheckerFor(drawerRefs)), [satCheckerFor, drawerRefs]);
    /** „Ubaci hitno": prioritet se upiše, pa preračun krene nad novim stanjem (efekat ispod). */
    const [urgentPending, setUrgentPending] = useState(false);

    /** Radni dan ekipe bilo kog bloka (plan vs stvarnost: prognoza kraja). */
    const isWorkForBlock = useCallback(
        (b: PlanBlock) => (iso: string) => isWorkDay(iso, satCheckerFor(b.workerRefs)),
        [satCheckerFor]
    );
    const loadRealityLogs = useCallback(
        (sinceISO: string) => (orgId ? getWorkLogsSince(orgId, sinceISO) : Promise.resolve([])),
        [orgId]
    );

    /** Kontekst modela rasporeda: isti za zdravlje, prijedlog i poređenje planova. */
    const modelCtx = useMemo(
        () => ({ workers, workOrders, attendance, projects, holidays: holidayDates }),
        [workers, workOrders, attendance, projects, holidayDates]
    );

    // Zdravlje plana poslije svake izmjene (faza 4): ista pravila kao prijedlog, bez pretrage.
    // Odgođena vrijednost — vučenje bloka ostaje glatko, ocjena stigne odmah poslije.
    const deferredScenario = useDeferredValue(scenario);
    const health = useMemo(() => {
        try {
            return planHealth(deferredScenario, { workers, workOrders, attendance, projects, holidays: holidayDates }, todayISO());
        } catch (err) {
            console.error('Ocjena plana nije uspjela', err);
            return null;
        }
    }, [deferredScenario, workers, workOrders, attendance, projects, holidayDates]);

    const runSchedule = useCallback(() => {
        if (scheduling) return;
        setScheduling(true);
        // Optimizator v2 (lib/canvas/opt): 1–2 s računanja u komadima — ekran ostaje živ.
        window.setTimeout(async () => {
            try {
                const result = await proposeScheduleAsync(
                    scenario,
                    { workers, workOrders, attendance, projects, holidays: holidayDates },
                    // Preračun: prva FREEZE_WORK_DAYS (3) radna dana se ne diraju (odluka vlasnika 21.11.2026).
                    { startISO: todayISO(), todayISO: todayISO(), freezeDays: FREEZE_WORK_DAYS }
                );
                if (!result.scheduled.length && !result.unscheduled.length) {
                    showToast('Nijedan nalog nema kandidat-ekipe za raspored — dodaj ih u batch unosu ili detaljima', 'info');
                    return;
                }
                setReviewResult(result);
            } catch (err) {
                console.error('Raspored nije izračunat', err);
                showToast('Raspored nije izračunat — pokušaj ponovo', 'error');
            } finally {
                setScheduling(false);
            }
        }, 30);
    }, [scheduling, scenario, workers, workOrders, attendance, projects, holidayDates, showToast]);

    useEffect(() => {
        if (!urgentPending) return;
        setUrgentPending(false);
        runSchedule();
    }, [urgentPending, runSchedule]);

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
    const ticks = useMemo(() => headerTicks(vp, today), [vp, today]);
    const bands = useMemo(() => monthBands(vp), [vp]);
    const nonwork = useMemo(() => nonWorkingBands(vp), [vp]);
    const visDates = useMemo(() => visibleDates(vp), [vp]);
    const todayX = xForDate(today, vp);
    const dw = dayWidth(zoom);
    /** Pomak prve sedmične linije mreže (ponedjeljak) od lijeve ivice ose. */
    const weekOffset = Math.max(0, visDates.findIndex(d => new Date(`${d}T12:00:00`).getDay() === 1)) * dw;

    // Raspon klizača: cijeli plan (+ danas), s malim rubom sa svake strane.
    const timeRange = useMemo(() => {
        const b = scenarioBounds(scenario);
        const lo = b ? (b.fromISO < today ? b.fromISO : today) : today;
        const hi = b ? (b.toISO > today ? b.toISO : today) : today;
        return { fromISO: addDays(lo, -14), toISO: addDays(hi, 14) };
    }, [scenario, today]);
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
     * Subote kad ekipa reda NE radi — siva ćelija u pozadini reda, ista siva kao
     * nedjelja. Red ekipe zna smjenu para, pa se vidi „ovaj par 5.12. ne radi".
     */
    const offSaturdays = (isSat?: (d: Date) => boolean) => {
        if (!isSat || zoom === 'mjesec') return null;
        return visDates.map((iso, i) => {
            const d = new Date(`${iso}T12:00:00`);
            if (d.getDay() !== 6 || isSat(d)) return null;
            return <span key={iso} className="cv-off" style={{ left: i * dw, width: dw }} />;
        });
    };

    /**
     * Jedan blok. Traka = RADNI KOMADI spojeni tankom isprekidanom linijom preko
     * dana kad se ne radi (nedjelja, subota kad ekipa ne radi) — ranije je to bilo
     * crveno zatamnjenje preko trake i djelovalo kao greška.
     *
     * Natpis: šifra pozicije + naziv, skraćen NA GRANICI RIJEČI, unutar JEDNOG
     * radnog komada (nikad preko linije); ostali komadi nose samo šifru, pa se za
     * svaki komad zna čiji je. Puni naziv je u kartici na hover.
     */
    const renderBlock = (
        item: PlanBlock, lane: number, rect: BlockRect, rowId: string,
        opts?: { compact?: boolean; trimStart?: boolean; trimEnd?: boolean; noLabel?: boolean; withSuffix?: boolean }
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
        // Boja = PROJEKT (meka tinta, tamni tekst), iz mape plana — dva projekta nikad
        // iste boje. Rok/narudžba/transport zadržavaju semantičku boju vrste.
        const isWorkKind = item.kind === 'order' || item.kind === 'montaza';
        const colors = isWorkKind ? colorsFor(projectColorsMap, item.projectRef) : null;

        // Dan predaje u redu ekipe: taj dan se dijeli napola sa susjednim nalogom.
        const half = dw / 2;
        const tL = opts?.trimStart && !eff.clippedStart && !isDragged ? half : 0;
        const tR = opts?.trimEnd && !eff.clippedEnd && !isDragged ? half : 0;
        // 1 px razmaka sa svake strane — susjedni nalozi iste boje se ne stapaju.
        const left = eff.left + 1 + tL;
        const width = Math.max(4, eff.width - 2 - tL - tR);

        // Radni / neradni komadi. Isti per-nalog checker koji nosi i dužinu trake,
        // pa se komadi i dužina slažu. Na mjesečnom zumu (dan = 11 px) traka je puna.
        const runs = isWorkKind && !opts?.compact && zoom !== 'mjesec'
            ? workRuns(effStart, effEnd, satCheckerFor(item.workerRefs))
            : [{ fromISO: effStart, toISO: effEnd, working: true }];
        const onRuns: { l: number; w: number }[] = [];
        const runEls = runs.map((run, i) => {
            const rr = blockRect(run.fromISO, run.toISO, vp);
            if (!rr.visible) return null;
            let l = rr.left - left;
            let r = rr.left + rr.width - left;
            if (!run.working) {
                return <span key={i} className="cv-run off" style={{ left: l, width: Math.max(2, r - l) }} />;
            }
            l = Math.max(0, l);
            r = Math.min(width, r);
            const first = onRuns.length === 0;
            onRuns.push({ l, w: r - l });
            const sqL = run.fromISO === effStart && eff.clippedStart;
            const sqR = run.toISO === effEnd && eff.clippedEnd;
            return (
                <span key={i}
                    className={`cv-run on${first ? ' first' : ''}${sqL ? ' sq-l' : ''}${sqR ? ' sq-r' : ''}`}
                    style={{ left: l, width: Math.max(2, r - l) }} />
            );
        });

        // Natpis — u prvom komadu u koji cijeli stane, inače u najdužem.
        const parsed = parsePlanTitle(item.title, item.projectRef?.name);
        const reserve = (st ? STATUS_DOT_W : 0) + (item.locked ? LOCK_W : 0);
        let host = onRuns.find(x => isFullLabel(fitBlockLabel(parsed, x.w, measureText, { reserve })));
        if (!host) host = onRuns.reduce<{ l: number; w: number } | undefined>((a, x) => (!a || x.w > a.w ? x : a), undefined);
        const fit: BlockLabelFit | null = host && !opts?.noLabel
            ? fitBlockLabel(parsed, host.w, measureText, { reserve, withSuffix: opts?.withSuffix })
            : null;
        const marks = (item.locked || st) ? (
            <>
                {item.locked && <Lock size={10} className="cv-lock" />}
                {st && <StatusMark status={st.status} />}
            </>
        ) : null;
        const labels: React.ReactNode[] = [];
        if (parsed.code && !opts?.noLabel) {
            for (const x of onRuns) {
                if (x === host) continue;
                const f = fitBlockLabel({ code: parsed.code, name: '', suffix: '' }, x.w, measureText);
                if (f) labels.push(
                    <span key={`c${x.l}`} className="cv-lbl center" style={{ left: x.l, width: x.w }}>
                        <span className={`cv-code${f.bare ? ' bare' : ''}`}>{parsed.code}</span>
                    </span>
                );
            }
        }
        if (host && (fit || marks)) {
            labels.push(
                <span key="host" className={`cv-lbl${fit?.centered ? ' center' : ''}`} style={{ left: host.l, width: host.w }}>
                    {marks}
                    {fit?.code && <span className={`cv-code${fit.bare ? ' bare' : ''}`}>{fit.code}</span>}
                    {fit?.name && (
                        <span className="cv-nm">
                            {fit.name}
                            {fit.suffix && <span className="cv-sfx"> · {fit.suffix}</span>}
                        </span>
                    )}
                </span>
            );
        }

        const dim = !!focusProject && projectKeyOf(item.projectRef) !== focusProject;
        return (
            <div key={item.id}
                className={`cv-block k-${item.kind}${isWorkKind ? ' work' : ''}${opts?.compact ? ' compact' : ''}${st ? ` real s-${st.status}` : ''}${selected.has(item.id) ? ' selected' : ''}${linkedToSelection.has(item.id) ? ' linked' : ''}${item.locked ? ' locked' : ''}${item.isSent ? ' sent' : ''}${isDragged ? ' dragging' : ''}${dim ? ' dim' : ''}`}
                style={{
                    left,
                    width,
                    top: laneTop(lane),
                    ...(colors ? {
                        ['--cv-bar' as string]: colors.bar,
                        ['--cv-ink' as string]: colors.ink,
                        ['--cv-txt' as string]: colors.txt,
                    } : {}),
                }}
                onPointerDown={e => { setHover(null); drag.onPointerDown(e, item.id, rowId, 'move'); }}
                onPointerMove={drag.onPointerMove}
                onPointerUp={drag.onPointerUp}
                onPointerCancel={drag.onPointerCancel}
                onPointerEnter={e => {
                    if (drag.isDragging) return;
                    const r = e.currentTarget.getBoundingClientRect();
                    setHover({ id: item.id, left: r.left, top: r.top, bottom: r.bottom });
                }}
                onPointerLeave={() => setHover(h => (h?.id === item.id ? null : h))}
                aria-label={`${item.title} · ${item.startISO} → ${item.endISO}`}
            >
                {runEls}
                {labels}
                {item.kind !== 'milestone' && !item.locked && (
                    <span className="cv-handle left"
                        style={{ width: RESIZE_HANDLE_PX }}
                        onPointerDown={e => drag.onPointerDown(e, item.id, rowId, 'resize-start')}
                        onPointerMove={drag.onPointerMove}
                        onPointerUp={drag.onPointerUp} />
                )}
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
     * Naslovni red grupe — projekat (tačka u boji, broj naloga, raspon, „hitno")
     * ili subotnja smjena (slovo, radne subote). Skuplja/širi redove ispod.
     * Projekat crta tanku traku svog raspona; smjena sivi svoje neradne subote.
     */
    const renderGroupHeader = (row: CanvasRow) => {
        const gh = row.groupHeader!;
        const collapsed = collapsedGroups.has(gh.key);
        const kind = gh.kind || 'project';
        const env = kind === 'project' && gh.fromISO && gh.toISO ? blockRect(gh.fromISO, gh.toISO, vp) : null;
        const ink = row.colors?.ink;
        const markW = kind === 'project' ? 18 : 30;
        const textAvail = headerW - 12 - 14 - 8 - markW - 14;
        const name = fitWords(row.label, textAvail, measureText, 600, 14);
        const urgentW = gh.urgent ? measureText(' · hitno', 600, 12) : 0;
        const meta = gh.metaVariants?.length
            ? fitVariants(gh.metaVariants, textAvail - urgentW, measureText, 400, 12) : '';
        const tag = kind === 'shift'
            ? (gh.shift === 'A' || gh.shift === 'B' ? gh.shift : gh.shift === 'mix' ? '±' : '–')
            : null;
        return (
            <div key={row.id} className={`cv-grouprow k-${kind}${collapsed ? ' collapsed' : ''}`}>
                <button className="cv-group-head" onClick={() => toggleGroup(gh.key)}
                    title={collapsed ? `Proširi — ${row.label}` : `Skupi — ${row.label}`}>
                    <ChevronDown size={14} className="cv-group-caret" />
                    {kind === 'project' && <span className="cv-group-dot" style={{ background: ink }} />}
                    {tag && <span className="cv-shift-tag">{tag}</span>}
                    {kind === 'free' && <span className="cv-shift-tag soft"><Users size={12} /></span>}
                    {kind === 'other' && <span className="cv-shift-tag soft"><Package size={12} /></span>}
                    <span className="cv-group-text">
                        <span className="cv-group-name" title={row.label}>{name}</span>
                        {(meta || gh.urgent) && (
                            <span className="cv-group-meta">
                                {meta}{gh.urgent && <span className="cv-urgent">{meta ? ' · ' : ''}hitno</span>}
                            </span>
                        )}
                    </span>
                </button>
                <div className="cv-row-lane cv-group-lane">
                    {offSaturdays(gh.isSaturdayWorking)}
                    {env && env.visible && (
                        <div className="cv-envelope"
                            style={{ left: env.left, width: Math.max(6, env.width), background: ink }} />
                    )}
                </div>
            </div>
        );
    };

    /**
     * Lijeva kolona reda. Red EKIPE: imena kao dugmad (otvaraju kalendar radnika)
     * i jedan red teksta ispod — smjena i broj naloga, ili „slobodni od", ili
     * crveno upozorenje kad ekipa ima dva naloga u isto vrijeme. Red NALOGA:
     * šifra pozicije + naziv skraćen na granici riječi, ekipa ispod.
     */
    const renderRowHead = (row: CanvasRow, overlapLanes: number) => {
        const indent = row.groupKey ? 34 : 14;
        const avail = headerW - indent - 14;
        const subOf = () => row.subVariants?.length
            ? fitVariants(row.subVariants, avail, measureText, 400, 12)
            : row.sublabel ? fitWords(row.sublabel, avail, measureText, 400, 12) : '';

        if (row.crew) {
            const warn = overlapLanes > 1 && row.crew.refs.length > 0;
            const sub = warn
                ? <span className="cv-warn">{overlapLanes === 2 ? 'dva naloga' : `${overlapLanes} naloga`} u isto vrijeme</span>
                : subOf();
            return (
                <div className={`cv-row-head${row.groupKey ? ' indent' : ''}`}>
                    <span className="cv-row-label cv-crew-names" title={row.crew.refs.map(r => r.name).join(' + ')}>
                        {row.crew.refs.length ? row.crew.refs.map((r, i) => (
                            <Fragment key={r.id || r.name}>
                                {i > 0 && <span className="cv-plus">+</span>}
                                <button className="cv-name-btn" disabled={!r.id}
                                    onClick={() => r.id && setCalendarWorkerId(r.id)}
                                    title={`Kalendar — ${r.name}`}>
                                    {shortNameOf(r, shortNames)}
                                </button>
                            </Fragment>
                        )) : 'Bez ekipe'}
                    </span>
                    {sub && <span className="cv-row-sub">{sub}</span>}
                </div>
            );
        }

        // Red radnika (stari prikazi) je dugme: otvara njegov mjesečni kalendar.
        if (row.section === 'radnici') {
            return (
                <button
                    className="cv-row-head clickable"
                    onClick={() => setCalendarWorkerId(row.id.replace(/^radnik-/, ''))}
                    title={`Otvori kalendar — ${row.label}`}
                >
                    <span className="cv-row-label">{fitWords(row.label, headerW - 28, measureText, 500, 13)}</span>
                    {row.sublabel && <span className="cv-row-sub">{row.sublabel}</span>}
                </button>
            );
        }

        // Red naloga (Nalozi): šifra + naziv; klik otvara detalje bloka.
        if (row.id.startsWith('ord-')) {
            const b = row.blocks[0];
            const p = parsePlanTitle(row.label, b?.projectRef?.name);
            const pillW = p.code ? measureText(p.code, LABEL.codeWeight, LABEL.codePx) + LABEL.pillPad + LABEL.gap : 0;
            const crew = (b?.workerRefs || []).map(r => shortNameOf(r, shortNames)).join(' + ');
            return (
                <div className={`cv-row-head cv-order-head${row.groupKey ? ' indent' : ''}`}
                    onClick={() => { if (b) { dispatch({ type: 'SELECT', ids: [b.id] }); setDrawerId(b.id); } }}
                    style={row.colors ? { ['--cv-ink' as string]: row.colors.ink, ['--cv-txt' as string]: row.colors.txt } : undefined}
                    title={row.label}>
                    <span className="cv-row-label cv-order-label">
                        {p.code && <span className="cv-code">{p.code}</span>}
                        {fitWords(p.name || row.label, avail - pillW, measureText, 500, 13)}
                    </span>
                    {crew && <span className="cv-row-sub">{fitWords(crew, avail, measureText, 400, 12)}</span>}
                </div>
            );
        }

        const sub = subOf();
        return (
            <div className={`cv-row-head${row.groupKey ? ' indent' : ''}`}>
                <span className="cv-row-label" title={row.label}>{fitWords(row.label, avail, measureText, 500, 13)}</span>
                {sub && <span className="cv-row-sub">{sub}</span>}
            </div>
        );
    };

    /** Naslov u uglu zaglavlja: koji je prikaz i šta je u njemu. */
    const corner = (() => {
        const work = scenario.Blocks.filter(b => b.kind === 'order' || b.kind === 'montaza').length;
        if (layout === 'unified-project') {
            const n = rows.filter(r => r.groupHeader?.kind === 'project').length;
            return { title: 'Projekti', sub: `${bsPlural(n, 'projekat', 'projekta', 'projekata')} · ${bsPlural(work, 'nalog', 'naloga', 'naloga')}` };
        }
        if (layout === 'crews') {
            const crews = rows.filter(r => r.crew && r.blocks.length).length;
            const free = rows.filter(r => r.id.startsWith('slobodan-')).length;
            return { title: 'Ekipe', sub: `${bsPlural(crews, 'ekipa', 'ekipe', 'ekipa')}${free ? ` · ${free} slobodno` : ''}` };
        }
        if (layout === 'rows') return { title: 'Nalozi', sub: bsPlural(work, 'nalog', 'naloga', 'naloga') };
        return { title: 'Plan', sub: bsPlural(scenario.Blocks.length, 'blok', 'bloka', 'blokova') };
    })();

    /** Kartica na hover — puni naziv, projekat, datumi, radni dani, ekipa, stvarni nalog. */
    const hoverCard = (() => {
        if (!hover || drag.isDragging || typeof document === 'undefined') return null;
        const b = scenario.Blocks.find(x => x.id === hover.id);
        if (!b) return null;
        const p = parsePlanTitle(b.title, b.projectRef?.name);
        const st = statusById.get(b.id);
        const isWork = b.kind === 'order' || b.kind === 'montaza';
        const workDays = isWork ? countWorkingDays(b.startISO, b.endISO, satCheckerFor(b.workerRefs)) : 0;
        const crew = (b.workerRefs || []).map(r => r.name).join(' + ');
        const above = hover.top > 150;
        const left = Math.min(Math.max(8, hover.left), (typeof window !== 'undefined' ? window.innerWidth : 1200) - 336);
        const dmLong = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.`;
        return createPortal(
            <div className={`cv-tip${above ? ' above' : ''}`} style={{ left, top: above ? hover.top - 8 : hover.bottom + 8 }} role="tooltip">
                <b>{p.code ? `Poz ${p.code} · ` : ''}{p.name || b.title}</b>
                {b.projectRef && (
                    <span><i style={{ background: colorsFor(projectColorsMap, b.projectRef).ink }} />{b.projectRef.name.trim()}</span>
                )}
                <span>
                    {dmLong(b.startISO)} – {dmLong(b.endISO)}
                    {isWork ? ` · ${bsPlural(workDays, 'radni dan', 'radna dana', 'radnih dana')}` : ` · ${BLOCK_LABEL[b.kind]}`}
                    {isWork && b.workerDays !== undefined ? ` · ${b.workerDays} radnik-dana` : ''}
                </span>
                {crew && <span>{crew}</span>}
                {st && <span>Stvarni {b.kind === 'purchase' ? 'narudžba' : 'nalog'}{st.ref ? ` ${st.ref}` : ''} · {st.label}</span>}
            </div>,
            document.body
        );
    })();

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

                <span className="cv-divider cv-view-div" />

                {/* ── Pogled: tri prikaza, zum, datum ─────────────
                    Na laptopu (container query u CSS-u) ova grupa prelazi u drugi
                    red, a plan i radnje ostaju gore — namjerno, ne nasumičan prelom. */}
                <div className="cv-seg cv-view" role="group" aria-label="Prikaz">
                    {LENSES.map(l => (
                        <button key={l.key} className={layout === l.key ? 'on' : ''} title={l.title}
                            onClick={() => { setFocusProject(null); dispatch({ type: 'SET_VIEW', view: { layout: l.key } }); }}>
                            {l.label}
                        </button>
                    ))}
                </div>

                <div className="cv-seg cv-view" role="group" aria-label="Zum">
                    {ZOOMS.map(z => (
                        <button key={z} className={zoom === z ? 'on' : ''}
                            onClick={() => dispatch({ type: 'SET_VIEW', view: { zoom: z } })}>
                            {ZOOM_LABEL[z]}
                        </button>
                    ))}
                </div>

                <div className="cv-nav cv-view" role="group" aria-label="Pomjeri prikaz">
                    <button className="cv-nav-arrow" aria-label="Ranije"
                        onClick={() => dispatch({ type: 'SET_VIEW', view: { anchorISO: addDays(anchorISO, zoom === 'mjesec' ? -30 : -7) } })}>
                        <ChevronLeft size={16} />
                    </button>
                    <button className="cv-nav-today"
                        onClick={() => dispatch({ type: 'SET_VIEW', view: { anchorISO: anchorLeading(today, vp) } })}>
                        Danas
                    </button>
                    <button className="cv-nav-arrow" aria-label="Kasnije"
                        onClick={() => dispatch({ type: 'SET_VIEW', view: { anchorISO: addDays(anchorISO, zoom === 'mjesec' ? 30 : 7) } })}>
                        <ChevronRight size={16} />
                    </button>
                </div>

                {/* Grupisanje ima smisla samo u starom detaljnom prikazu. */}
                {layout === 'detailed' && (
                    <CanvasMenu
                        align="left"
                        trigger={open => (
                            <button className={`cv-btn ghost cv-view${open ? ' on' : ''}`} title="Grupiši redove">
                                <Rows3 size={14} /> {GROUP_BY_LABEL[groupBy]} <ChevronDown size={13} className="cv-caret" />
                            </button>
                        )}
                        items={GROUPS.map(g => ({
                            key: g, label: GROUP_BY_LABEL[g], active: groupBy === g,
                            onClick: () => dispatch({ type: 'SET_VIEW', view: { groupBy: g } }),
                        }))}
                    />
                )}

                <span className="cv-break" aria-hidden="true" />
                <span className="cv-spacer" />

                <CanvasMenu
                    align="right"
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

                {/* ── Kreiranje / raspored ───────────────────── */}
                <button className="cv-btn primary" onClick={() => setPickerOpen(true)}>
                    <Package size={15} /> <span className="lbl">Novi nalog</span>
                </button>
                <button className="cv-btn squeeze" onClick={() => setBatchOpen(true)}
                    title="Batch — unesi više naloga odjednom (proizvodni, montaža, razni)">
                    <ClipboardList size={15} /> <span className="lbl">Batch</span>
                </button>
                <button className="cv-btn accent squeeze" onClick={runSchedule} disabled={scheduling} aria-busy={scheduling}
                    title="Rasporedi — predloži najbrži izvodljiv raspored naloga s kandidat-ekipama (ništa se ne mijenja dok ne primijeniš)">
                    <Sparkles size={15} /> <span className="lbl">{scheduling ? 'Računam…' : 'Rasporedi'}</span>
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
                        { key: 'compare', label: 'Uporedi planove (šta ako)', icon: <GitCompareArrows size={14} />, onClick: () => setCompareOpen(true) },
                        { key: 'reality', label: 'Plan vs stvarnost', icon: <Activity size={14} />, onClick: () => setRealityOpen(true) },
                        { key: 'templates', label: 'Šabloni lanaca', icon: <Bookmark size={14} />, badge: templates.length, onClick: () => setTemplatesOpen(true) },
                        { key: 'print', label: 'Štampaj plan', icon: <Printer size={14} />, onClick: printPlan },
                        ...OLD_LAYOUTS.map((l, i) => ({
                            key: l.key, label: l.label, icon: <LayoutGrid size={14} />, active: layout === l.key, divider: i === 0,
                            onClick: () => dispatch({ type: 'SET_VIEW', view: { layout: l.key } }),
                        })),
                        ...(layout === 'detailed' || layout === 'unified-global' ? [{
                            key: 'idle', label: showIdle ? 'Sakrij prazne radnike' : 'Prikaži sve radnike',
                            icon: <Users size={14} />, active: showIdle, onClick: () => setShowIdle(v => !v),
                        }] : []),
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

            {health && !health.feasible && (
                <div className="cv-health warn" role="status">
                    <AlertTriangle size={14} />
                    <span className="cv-health-txt">
                        <strong>Plan ima {health.violationCount} {health.violationCount === 1 ? 'prekršenu provjeru' : health.violationCount < 5 ? 'prekršene provjere' : 'prekršenih provjera'}</strong>
                        {health.examples[0] && <> — {health.examples[0]}{health.violationCount > 1 ? ' …' : ''}</>}
                    </span>
                    <button className="cv-btn accent sm" onClick={runSchedule} disabled={scheduling}>
                        <Sparkles size={13} /> {scheduling ? 'Računam…' : 'Preračunaj'}
                    </button>
                </div>
            )}
            {health && health.feasible && (health.gapDays || 0) > 0 && health.boundISO && (
                <div className="cv-health" role="status">
                    <Sparkles size={14} />
                    <span className="cv-health-txt">
                        Plan je izvodljiv, a može se završiti do <strong>{health.gapDays} {health.gapDays === 1 ? 'dan' : 'dana'}</strong> ranije (najranije moguće {Number(health.boundISO.slice(8, 10))}.{Number(health.boundISO.slice(5, 7))}.).
                    </span>
                    <button className="cv-btn sm" onClick={runSchedule} disabled={scheduling}>
                        {scheduling ? 'Računam…' : 'Predloži'}
                    </button>
                </div>
            )}

            <CanvasTimeSlider
                fromISO={timeRange.fromISO}
                toISO={timeRange.toISO}
                anchorISO={anchorISO}
                onScrub={iso => dispatch({ type: 'SET_VIEW', view: { anchorISO: iso } })}
            />

            {/* Legenda prikaza Ekipe: red je par, pa boja jedina kaže projekat.
                Klik istakne projekat (ostali se priguše), drugi klik vraća sve. */}
            {layout === 'crews' && legend.length > 0 && (
                <div className="cv-legend" role="group" aria-label="Projekti">
                    <span className="cv-legend-lbl">Boja = projekat</span>
                    {legend.map(p => (
                        <button key={p.key} className={focusProject === p.key ? 'on' : ''}
                            aria-pressed={focusProject === p.key}
                            onClick={() => setFocusProject(f => (f === p.key ? null : p.key))}>
                            <i style={{ background: p.ink }} />{p.name}
                        </button>
                    ))}
                </div>
            )}

            {/* Platno */}
            <div className={`cv-grid${focusProject ? ' focusing' : ''}`} ref={gridRef}
                style={{
                    ['--cv-header-w' as string]: `${headerW}px`,
                    ['--cv-day-w' as string]: `${dw}px`,
                    ['--cv-week-off' as string]: `${weekOffset}px`,
                }}>
                {/* Zaglavlje: mjesec (puno ime) + dan (slovo i broj). Ponedjeljak jači,
                    nedjelja siva kolona, danas plavi krug. */}
                <div className="cv-head" style={{ height: TIMELINE_HEADER_HEIGHT }}>
                    <div className="cv-head-corner">
                        <b>{corner.title}</b>
                        <span>{corner.sub}</span>
                    </div>
                    <div className="cv-head-dates">
                        {bands.map(b => (
                            <div key={`${b.year}-${b.month}`} className="cv-band" style={{ left: b.left, width: b.width }}>
                                {b.width > 120
                                    ? <>{MONTHS_FULL[b.month]} <em>{b.year}</em></>
                                    : b.width > 40 ? MONTHS_SHORT[b.month] : ''}
                            </div>
                        ))}
                        {zoom === 'mjesec'
                            ? ticks.map(t => (
                                <div key={t.iso}
                                    className={`cv-week${today >= t.iso && today < addDays(t.iso, 7) ? ' today' : ''}`}
                                    style={{ left: t.left, width: t.width }}>
                                    {t.label}
                                </div>
                            ))
                            : ticks.map(t => (
                                <div key={t.iso}
                                    className={`cv-day${t.dow === 1 ? ' mon' : ''}${t.dow === 0 ? ' sun' : ''}${t.isToday ? ' today' : ''}`}
                                    style={{ left: t.left, width: t.width }}>
                                    <i>{zoom === 'dan' ? DOW_SHORT[t.dow] : DOW_LETTER[t.dow]}</i>
                                    <b>{t.day}</b>
                                </div>
                            ))}
                    </div>
                </div>

                {/* Redovi */}
                <div className={`cv-body z-${zoom}`}>
                    {/* Nedjelje — siva kolona kroz cijelo platno, ispod traka. Neradne
                        subote sivi svaki red ekipe za sebe (njena smjena). */}
                    {zoom !== 'mjesec' && (
                        <div className="cv-nonwork-layer" style={{ left: headerW }}>
                            {nonwork.map(b => (
                                <div key={b.iso} className="cv-nonwork" style={{ left: b.left, width: b.width }} />
                            ))}
                        </div>
                    )}
                    {sections.length === 0 && (
                        <div className="cv-empty">
                            Prazno platno. <strong>Dupli klik</strong> pravi blok; povuci mišem da nacrtaš
                            raspon; ili pritisni <kbd>N</kbd> za nalog, <kbd>V</kbd> za prekretnicu.
                        </div>
                    )}
                    {sections.map(sec => (
                        <div key={sec.section} className="cv-section">
                            {/* Naslov sekcije samo u starim prikazima — novi imaju naslove grupa. */}
                            {(layout === 'detailed' || layout === 'unified-global') && (
                                <div className="cv-section-head">{SECTION_LABEL[sec.section]}</div>
                            )}
                            {sec.rows
                                .filter(row => !(row.groupKey && collapsedGroups.has(row.groupKey)))
                                .map(row => {
                                if (row.groupHeader) return renderGroupHeader(row);

                                // Objedinjeni red: nalog (primarni) je okosnica, ostalo (narudžba/
                                // transport/rok) ide u sekundarni sloj ispod. Detaljni red: sve primarno.
                                const isUnified = layout !== 'detailed';
                                const primaryBlocks = isUnified
                                    ? row.blocks.filter(b => blockLayer(b.kind) === 'primary')
                                    : row.blocks;
                                const secondaryBlocks = isUnified
                                    ? row.blocks.filter(b => blockLayer(b.kind) !== 'primary')
                                    : [];

                                // Red ekipe: dan predaje nije preklapanje (ista traka, dan napola).
                                const packedPrimary = packLanes(primaryBlocks, b => b, vp, { handoff: !!row.crew });
                                const packedSecondary = packLanes(secondaryBlocks, b => b, vp);
                                const packedShadows = packLanes(row.shadows, s => s, vp);

                                const primaryLanes = primaryBlocks.length ? packedPrimary.laneCount : 0;
                                const secondaryLanes = secondaryBlocks.length ? packedSecondary.laneCount : 0;
                                const shadowLanes = row.shadows.length ? packedShadows.laneCount : 0;
                                const secBase = primaryLanes;
                                const shadowBase = primaryLanes + secondaryLanes;
                                const h = rowHeight(Math.max(1, primaryLanes + secondaryLanes + shadowLanes));
                                // U prikazu Nalozi naziv je u lijevoj koloni — traka nosi samo vrijeme.
                                const orderRow = row.id.startsWith('ord-');

                                return (
                                    <div key={row.id} className={`cv-row${row.synthetic ? ' synthetic' : ''}${row.crew ? ' crew' : ''}`}
                                        data-row-id={row.id} style={{ height: h }}>
                                        {renderRowHead(row, primaryLanes)}

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
                                            {row.crew && offSaturdays(row.crew.isSaturdayWorking)}

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
                                            {packedPrimary.placed.map(({ item, lane, rect, trimStart, trimEnd }) =>
                                                renderBlock(item, lane, rect, row.id, {
                                                    trimStart, trimEnd,
                                                    noLabel: orderRow,
                                                    withSuffix: layout === 'crews',
                                                })
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
                        <div className="cv-today" style={{ left: headerW + todayX }} />
                    )}
                </div>
            </div>
            {hoverCard}

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

            <RealityModal
                isOpen={realityOpen}
                scenario={scenario}
                workOrders={workOrders}
                todayISO={todayISO()}
                isWorkFor={isWorkForBlock}
                loadLogs={loadRealityLogs}
                onSelectBlock={jumpToBlock}
                onClose={() => setRealityOpen(false)}
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
                modelCtx={modelCtx}
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
                    isWork={drawerIsWork}
                    onSplit={() => {
                        const b = scenario.Blocks.find(x => x.id === drawerId);
                        const parts = b && splitBlock(b, drawerIsWork, uuidv4());
                        if (parts) dispatch({ type: 'SPLIT_BLOCK', id: drawerId, parts });
                        else showToast('Nalog je kraći od dana ekipe — nema šta dijeliti', 'info');
                    }}
                    onMerge={otherId => {
                        const b = scenario.Blocks.find(x => x.id === drawerId);
                        const other = scenario.Blocks.find(x => x.id === otherId);
                        if (!b || !other) return;
                        const merged = mergeBlocks(b, other, drawerIsWork);
                        if (typeof merged === 'string') { showToast(merged, 'info'); return; }
                        dispatch({ type: 'MERGE_BLOCKS', keepId: b.id, removeId: other.id, merged });
                    }}
                    onUrgent={() => {
                        dispatch({ type: 'UPDATE_BLOCK', id: drawerId, patch: { priority: 'urgent' } });
                        setUrgentPending(true);
                    }}
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
