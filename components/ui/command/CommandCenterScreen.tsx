'use client';

// ════════════════════════════════════════════════════════════════════
// KOMANDNI CENTAR — pregled gore, radni prostor dolje
//
// Svakodnevno pitanje je „šta mi gori preko SVIH poslova koje vodim".
// Strana zato ide od opšteg ka konkretnom, uvijek istim redom:
//   1. traka projekata  — sve ili samo jedan projekat (fokus)
//   2. puls             — šest brojki koje su ujedno i filteri
//   3. kalendar         — šta se kad dešava
//   4. radni prostor    — DVIJE kartice s tabovima:
//        Proizvodnja: Proizvodi · Radni nalozi
//        Praćenje:    Narudžbe · Zadaci · Napomene
//
// Ranije je svih pet ploča stajalo jedno ispod drugog, svaka sa svojim
// zaglavljem, nadnaslovom, pretragom i dugmadima — strana je bila duga
// skoro tri ekrana i „nabacana". Tabovi to rješavaju bez gubitka: broj na
// tabu kaže gdje ima posla, a klik na puls sam otvori pravi tab.
//
// Širina i dalje ide za radom (lib/command/layout): otvorena narudžba
// raširi desnu karticu, a Proizvodi se preslože sami (container queries).
//
// Kreiranje je dostupno odasvud: „Nalog" / „Narudžba" / „Zadatak" u
// zaglavlju ekrana i u trakama alata, traka odabira na dnu čim nešto označiš.
// ════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Eye, EyeOff, LayoutDashboard, Plus, RefreshCw } from 'lucide-react';
import type { Order, PlanBlock, PlanScenario, Product, ProductNote, Project, Task, WorkOrder, Worker } from '@/lib/types';
import { todayISO } from '@/lib/planning';
import { shiftDate } from '@/lib/projectCommand';
import type { CommandBoardState } from '@/lib/command/board';
import { addToBoard, boardProjects, EMPTY_BOARD, removeFromBoard, withCollapsedPanels } from '@/lib/command/board';
import { buildScope, type BoardScope } from '@/lib/command/scope';
import { commandMaterialRows, orderableIds, planFromSelection, suggestOrderName } from '@/lib/command/materialOrder';
import { buildSignals, type LensId, type LensSelection } from '@/lib/command/signals';
import { buildTimeline, filterTimeline, planBlockProjects } from '@/lib/command/timeline';
import {
    boardSplit, columnSizing, dropFocus, MAIN_PANELS, panelColumn, pushFocus, toggleCollapsed,
    type FocusEntry, type PanelId,
} from '@/lib/command/layout';
import { getScenarios } from '@/lib/services/planning/scenarioService';
import Modal from '../Modal';
import MaterialOrderSelectModal from '../MaterialOrderSelectModal';
import ProjectNotesModal from '../ProjectNotesModal';
import TaskEditorModal from '../TaskEditorModal';
import WorkOrderPrintTemplate from '../WorkOrderPrintTemplate';
import WorkOrderWizard, { type WizardInitialProducts } from '@/components/production/WorkOrderWizard';
import BoardBar, { boardChipCounts } from './BoardBar';
import PulseStrip from './PulseStrip';
import CommandTimeline from './CommandTimeline';
import ProductsPanel from './ProductsPanel';
import WorkOrdersPanel from './WorkOrdersPanel';
import PurchaseOrdersPanel from './PurchaseOrdersPanel';
import TaskWall from './TaskWall';
import NotesPanel from './NotesPanel';
import SelectionDock from './SelectionDock';
import { CreateMenu, KcTabCard, plural, shortDate, type CreateMenuItem, type KcTab } from './parts';
import './CommandCenter.css';

/** Stavka menija narudžbe koja nije projekat, nego cijela tabla. */
const WHOLE_BOARD = '__tabla__';

const MAIN_TABS: KcTab[] = [
    { id: 'products', label: 'Proizvodi' },
    { id: 'workorders', label: 'Radni nalozi' },
];
const RAIL_TABS: KcTab[] = [
    { id: 'purchases', label: 'Narudžbe' },
    { id: 'tasks', label: 'Zadaci' },
    { id: 'notes', label: 'Napomene' },
];

/**
 * Koji tab odgovara na pitanje leće. Tab se mijenja samo ako na njemu
 * STVARNO ima nešto — „Kasni" bez zakašnjelih naloga ne smije sakriti
 * proizvode i pokazati praznu listu.
 */
function tabsForLens(lens: LensId, sel: LensSelection): { main?: PanelId; rail?: PanelId } {
    switch (lens) {
        case 'late':
            return {
                main: sel.workOrderIds.size > 0 ? 'workorders' : undefined,
                rail: sel.orderIds.size > 0 ? 'purchases' : sel.taskIds.size > 0 ? 'tasks' : undefined,
            };
        case 'blocked':
        case 'toOrder':
            return { main: 'products' };
        case 'running':
            return { main: 'workorders' };
        case 'tasks':
            return { rail: 'tasks' };
        case 'awaiting':
            return { rail: 'notes' };
        default:
            return {};
    }
}

export interface CommandCenterScreenProps {
    projects: Project[];
    workOrders: WorkOrder[];
    orders: Order[];
    tasks: Task[];
    workers: Worker[];
    organizationId: string | null;
    board: CommandBoardState;
    onBoardChange: (next: CommandBoardState) => void;
    canCreate: boolean;
    onClose: () => void;
    onRefresh: (...collections: string[]) => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
    /**
     * Maketa: gotovi planovi umjesto čitanja iz baze. Namjerno SCENARIJI, a ne
     * goli blokovi — samo tako maketa pokaže i izbor plana, koji se inače vidi
     * tek kad korisnik ima više od jednog plana.
     */
    planScenarios?: { id: string; name: string; blocks: PlanBlock[] }[];
    /** Maketa: renderuj u toku strane, bez portala i bez history stacka. */
    embedded?: boolean;
    /** Maketa: ne diraj bazu — akcije samo jave šta bi uradile. */
    dryRun?: boolean;
}

export default function CommandCenterScreen(props: CommandCenterScreenProps) {
    const {
        projects, workOrders, orders, tasks, workers, organizationId, board,
        onBoardChange, canCreate, onClose, onRefresh, showToast, planScenarios, embedded, dryRun,
    } = props;

    const today = todayISO();
    const [lens, setLens] = useState<LensId | null>(null);
    const [openWorkOrderId, setOpenWorkOrderIdState] = useState<string | null>(null);
    const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
    const [selectedMaterials, setSelectedMaterials] = useState<Set<string>>(new Set());
    // Wizard dobija i spisak projekata: „Nalog → projekat" nudi samo pozicije
    // tog projekta, a nalog iz odabira vidi sve (kao i ranije).
    const [wizardFor, setWizardFor] = useState<{ seed: WizardInitialProducts; projects: Project[] } | null>(null);
    // Narudžba: tačno koji materijali se nude i kako se zove izvor u naslovu.
    const [orderDraft, setOrderDraft] = useState<{ ids: string[]; label: string } | null>(null);
    const [notesModal, setNotesModal] = useState<{ project: Project; productId?: string } | null>(null);
    const [taskEditor, setTaskEditor] = useState<{ mode: 'create' | 'edit'; task?: Task; projectId: string } | null>(null);
    const [printOrder, setPrintOrder] = useState<WorkOrder | null>(null);
    const [deleteFor, setDeleteFor] = useState<WorkOrder | null>(null);
    // Portal postoji tek na klijentu; bez ovoga se server i klijent razilaze
    // i React prijavi gresku hidratacije.
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);

    // ── Optimistični sloj ────────────────────────────────────────────
    // Kvačica na zadatku ili odgovor na napomenu su sitne izmjene, ali je
    // `onRefresh('projects')` puni reload cijelog grafa projekata (projekti →
    // proizvodi → materijali → ponude). Na stvarnim podacima to traje sekunde
    // i klik izgleda kao da se zaglavio.
    //
    // Zato ekran odmah prikaže ISHOD, a upis ide u pozadini; baza samo sustiže.
    // Ako upis padne, override se skida i stanje se vrati — bez tihog gubitka.
    // Isti obraz kao pogonski upisi (useFieldResource).
    const [noteOverrides, setNoteOverrides] = useState<Map<string, ProductNote[]>>(new Map());
    const [taskOverrides, setTaskOverrides] = useState<Map<string, Task | null>>(new Map());

    // Samo ID-evi projekata — sklapanje ploče ili „Završeno" mijenja tablu, ali
    // ne smije ponovo računati cijeli graf projekata.
    const boardIds = board.Project_IDs;
    const boardRaw = useMemo(() => boardProjects({ ...EMPTY_BOARD, Project_IDs: boardIds }, projects), [boardIds, projects]);
    const onBoard = useMemo(() => (noteOverrides.size === 0 ? boardRaw : boardRaw.map(project => ({
        ...project,
        products: (project.products || []).map(product => (noteOverrides.has(product.Product_ID)
            ? { ...product, Questions: noteOverrides.get(product.Product_ID) }
            : product)),
    }))), [boardRaw, noteOverrides]);

    const liveTasks = useMemo(() => {
        if (taskOverrides.size === 0) return tasks;
        const kept = tasks
            .map(task => (taskOverrides.has(task.Task_ID) ? taskOverrides.get(task.Task_ID) : task))
            .filter((task): task is Task => !!task);
        // Novi zadatak još nije u `tasks` — dodaj ga da se odmah vidi na zidu.
        const known = new Set(tasks.map(t => t.Task_ID));
        for (const [id, task] of taskOverrides) if (task && !known.has(id)) kept.push(task);
        return kept;
    }, [tasks, taskOverrides]);

    // ── Fokus na jedan projekat ──────────────────────────────────────
    // Traka projekata suzi CIJELU stranu na jedan projekat. Tabla se pri
    // tome ne mijenja (ranije je „Prikaži samo ovaj projekat" iz kalendara
    // izbacivao ostale projekte s table, pa ih je trebalo ponovo dodavati).
    const [focusId, setFocusId] = useState<string | null>(null);
    const focusLive = focusId !== null && onBoard.some(p => p.Project_ID === focusId) ? focusId : null;
    const focused = useMemo(
        () => (focusLive ? onBoard.filter(p => p.Project_ID === focusLive) : onBoard),
        [onBoard, focusLive],
    );

    // Brojke na traci projekata uvijek gledaju CIJELU tablu — i dok je
    // strana sužena, mora se vidjeti da u drugom projektu nešto kasni.
    const boardScope = useMemo(() => buildScope(onBoard, workOrders, orders, liveTasks), [onBoard, workOrders, orders, liveTasks]);
    const scope = useMemo(
        () => (focusLive ? buildScope(focused, workOrders, orders, liveTasks) : boardScope),
        [focusLive, focused, workOrders, orders, liveTasks, boardScope],
    );
    const materials = useMemo(() => commandMaterialRows(focused), [focused]);
    const { signals, selection } = useMemo(() => buildSignals(scope, materials, today), [scope, materials, today]);
    const chipCounts = useMemo(() => boardChipCounts(boardScope, today), [boardScope, today]);

    // Planovi s Platna — samo čitanje. Scenarija zna biti više, pa se ne miješaju:
    // nudi se izbor, a crta se jedan, inače bi ista aktivnost bila na ekranu dvaput.
    const plans = usePlanScenarios(organizationId, scope, planScenarios);
    const planned = plans.blocks;
    const timeline = useMemo(
        () => buildTimeline({ scope, today, planBlocks: planned, showDone: board.Show_Done }),
        [scope, today, planned, board.Show_Done],
    );
    const lensSelection = lens ? selection[lens] : null;
    // Leća vrijedi i za kalendar — inače puls tvrdi jedno, a trake pokazuju drugo.
    const visibleTimeline = useMemo(() => filterTimeline(timeline, lensSelection), [timeline, lensSelection]);

    const hasSelection = selectedProducts.size > 0 || selectedMaterials.size > 0;
    const clearSelection = useCallback(() => { setSelectedProducts(new Set()); setSelectedMaterials(new Set()); }, []);

    // Overlay se zatvara nazad-dugmetom kao i ostali puni ekrani u aplikaciji.
    // Prvi Esc čisti odabir — zatvaranje cijelog ekrana zbog toga bi bilo skupo.
    useEffect(() => {
        if (embedded) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape' || document.querySelector('.modal-overlay')) return;
            if (hasSelection) clearSelection(); else onClose();
        };
        document.addEventListener('keydown', onKey);
        const previous = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = previous; };
    }, [embedded, onClose, hasSelection, clearSelection]);

    // ── Tabla ────────────────────────────────────────────────────────
    const addProjects = (ids: string[]) => onBoardChange(addToBoard(board, ...ids));
    const removeProject = (id: string) => onBoardChange(removeFromBoard(board, id));
    const toggleShowDone = () => onBoardChange({ ...board, Show_Done: !board.Show_Done });

    // ── Raspored ─────────────────────────────────────────────────────
    // Sklapa se samo kalendar (pamti se s tablom); ploče radnog prostora su
    // tabovi, pa im sklapanje više ne treba. Stare table mogu imati i druge
    // sklopljene ploče — one se ovdje jednostavno ne gledaju.
    const collapsedList = useMemo(() => board.Collapsed_Panels || [], [board.Collapsed_Panels]);
    const calendarCollapsed = collapsedList.includes('calendar');
    const [focus, setFocus] = useState<FocusEntry[]>([]);
    // Kolona u kojoj je korisnik zadnji put radio — ona mora ostati mirna
    // dok se druga preslaguje (vidi overflow-anchor u CSS-u).
    const [anchorColumn, setAnchorColumn] = useState<'main' | 'rail' | null>(null);
    const split = boardSplit(new Set<PanelId>(), focus);
    const sizing = columnSizing(split);

    const [mainTab, setMainTab] = useState<PanelId>('products');
    const [railTab, setRailTab] = useState<PanelId>('purchases');

    const reportOpen = useCallback((panel: PanelId, open: boolean) => {
        setFocus(prev => (open ? pushFocus(prev, { panel, source: 'auto' }) : dropFocus(prev, panel, 'auto')));
        const column = panelColumn(panel);
        if (column !== 'top') setAnchorColumn(column);
    }, []);

    /** Novi tab — širina koju je tražio sakriveni tab (npr. otvorena narudžba) se vraća. */
    const selectTab = useCallback((panel: PanelId) => {
        const column = panelColumn(panel);
        if (column === 'main') setMainTab(panel); else setRailTab(panel);
        setFocus(prev => prev.filter(f => panelColumn(f.panel) !== column || f.panel === panel));
    }, []);

    const toggleCalendar = () => {
        onBoardChange(withCollapsedPanels(board, toggleCollapsed(collapsedList, 'calendar')));
    };

    /** Leća sužava stranu i otvara tab na kojem je odgovor. */
    const applyLens = (next: LensId | null) => {
        setLens(next);
        if (!next) return;
        const target = tabsForLens(next, selection[next]);
        if (target.main) selectTab(target.main);
        if (target.rail) selectTab(target.rail);
    };

    const setOpenWorkOrderId = useCallback((id: string | null) => {
        setOpenWorkOrderIdState(id);
        reportOpen('workorders', id !== null);
    }, [reportOpen]);

    // ── Odabir ───────────────────────────────────────────────────────
    const toggleIn = (setter: typeof setSelectedProducts) => (id: string) => setter(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });
    const toggleMany = (setter: typeof setSelectedProducts) => (ids: string[], on: boolean) => setter(prev => {
        const next = new Set(prev);
        for (const id of ids) { if (on) next.add(id); else next.delete(id); }
        return next;
    });

    // ── Radni nalozi ─────────────────────────────────────────────────
    const guard = useCallback((): boolean => {
        if (dryRun) { showToast('Maketa — akcija nije izvršena.', 'info'); return false; }
        if (!organizationId) { showToast('Organizacija nije učitana.', 'error'); return false; }
        return true;
    }, [dryRun, organizationId, showToast]);

    const workOrderActions = {
        onUpdate: async (workOrderId: string, updates: Record<string, unknown>) => {
            if (!guard()) return;
            // Ista zaštita kao u Nalozi tabu: nalog se ne zatvara dok stavke nisu gotove.
            if (updates.Status === 'Završeno') {
                const wo = workOrders.find(w => w.Work_Order_ID === workOrderId);
                const unfinished = (wo?.items || []).filter(i => i.Status !== 'Završeno');
                if (unfinished.length > 0) {
                    showToast(`Stavke nisu završene: ${unfinished.map(i => i.Product_Name).join(', ')}.`, 'error');
                    return;
                }
            }
            const { updateWorkOrder } = await import('@/lib/services');
            const res = await updateWorkOrder(workOrderId, updates, organizationId || '');
            showToast(res.message, res.success ? 'success' : 'error');
            if (res.success) onRefresh('workOrders', 'projects');
        },
        onStart: async (workOrderId: string) => {
            if (!guard()) return;
            const wo = workOrders.find(w => w.Work_Order_ID === workOrderId);
            if (!wo) { showToast('Nalog nije pronađen', 'error'); return; }
            const [{ checkWorkOrderStart }, { startWorkOrder }] = await Promise.all([import('@/lib/workOrderStart'), import('@/lib/services')]);
            const check = await checkWorkOrderStart(wo, projects);
            if (!check.ok) { showToast(check.message, 'error'); return; }
            const res = await startWorkOrder(workOrderId, organizationId || '');
            showToast(res.success ? 'Nalog pokrenut' : res.message, res.success ? 'success' : 'error');
            if (res.success) onRefresh('workOrders', 'projects');
        },
        onPrint: (wo: WorkOrder) => setPrintOrder(enrichForPrint(wo, projects)),
        onDelete: async (workOrderId: string) => {
            const wo = workOrders.find(w => w.Work_Order_ID === workOrderId);
            if (wo) setDeleteFor(wo);
        },
        onRefresh,
        showToast,
    };

    const confirmDelete = async (productAction: 'completed' | 'waiting') => {
        const wo = deleteFor;
        setDeleteFor(null);
        if (!wo || !guard()) return;
        if (openWorkOrderId === wo.Work_Order_ID) setOpenWorkOrderId(null);
        const { deleteWorkOrder } = await import('@/lib/services');
        const res = await deleteWorkOrder(wo.Work_Order_ID, organizationId || '', productAction);
        showToast(res.message, res.success ? 'success' : 'error');
        onRefresh('workOrders', 'projects');
    };

    // ── Nalog ────────────────────────────────────────────────────────
    const projectLabel = (project?: Project) => project?.Name || project?.Client_Name || 'Projekat';

    /** Nalog za tačno ove pozicije — wizard preskače izbor i ide na ekipu i rok. */
    const createWorkOrderFor = (projectId: string, productIds: string[]) => {
        const project = onBoard.find(p => p.Project_ID === projectId);
        if (!project) return;
        const wanted = new Set(productIds);
        const chosen = (project.products || []).filter(p => wanted.has(p.Product_ID));
        if (chosen.length === 0) { showToast('Nijedan proizvod ovog projekta nije označen.', 'info'); return; }
        if (!guard()) return;
        setWizardFor({
            projects,
            seed: {
                projectId,
                projectName: projectLabel(project),
                products: chosen.map(p => ({ productId: p.Product_ID, productName: p.Name || 'Proizvod', quantity: p.Quantity || 1 })),
            },
        });
    };

    /** „Nalog → projekat": wizard počinje izborom pozicija, samo iz tog projekta. */
    const startWorkOrder = (projectId: string) => {
        const project = onBoard.find(p => p.Project_ID === projectId);
        if (!project || !guard()) return;
        setWizardFor({ projects: [project], seed: { projectId, projectName: projectLabel(project), products: [] } });
    };

    // ── Narudžba ─────────────────────────────────────────────────────
    const expectedDelivery = shiftDate(today, 7);
    const orderPlan = useMemo(() => (orderDraft ? planFromSelection(materials, orderDraft.ids) : []), [materials, orderDraft]);
    const suggestName = useCallback(
        (ids: string[]) => suggestOrderName(materials, ids, scope.order),
        [materials, scope.order],
    );

    const openOrder = (ids: string[], label: string) => {
        if (ids.length === 0) { showToast('Nema šta naručiti — sve je već naručeno ili na stanju.', 'info'); return; }
        setOrderDraft({ ids, label });
    };

    /** „Narudžba → projekat" ili cijela tabla: sve što se sada može naručiti. */
    const startOrder = (target: string) => {
        if (target === WHOLE_BOARD) { openOrder(orderableIds(materials), 'Sve što fali na tabli'); return; }
        const project = onBoard.find(p => p.Project_ID === target);
        openOrder(orderableIds(materials, { projectId: target }), `${projectLabel(project)} — sve što fali`);
    };

    const createOrders = async (ids: string[], name?: string) => {
        if (!guard()) return { ordersCreated: 0, orderNumbers: [] };
        const plan = planFromSelection(materials, ids);
        const { createOrdersFromMaterialSelection } = await import('@/lib/services');
        const result = await createOrdersFromMaterialSelection(plan, expectedDelivery, organizationId || '', name);
        if (result.ordersCreated > 0) {
            // Naručeni materijali više nisu „za naručiti" — skidaju se s odabira.
            const ordered = new Set(ids);
            setSelectedMaterials(prev => new Set(Array.from(prev).filter(id => !ordered.has(id))));
            onRefresh('orders', 'projects');
        }
        return result;
    };

    // ── Meniji za kreiranje (zaglavlje ekrana i zaglavlja ploča) ─────
    const productsInOrder = useMemo(() => {
        const inOrder = new Set<string>();
        for (const wo of scope.workOrders) {
            if (wo.Status === 'Otkazano') continue;
            for (const item of wo.items || []) if (item.Product_ID) inOrder.add(item.Product_ID);
        }
        return inOrder;
    }, [scope.workOrders]);

    // Meniji nude projekte u FOKUSU — kad je strana sužena na jedan
    // projekat, „+ Nalog" radi odmah, bez pitanja za koji projekat.
    const workOrderItems: CreateMenuItem[] = focused.map(project => {
        const free = (project.products || []).filter(p => !productsInOrder.has(p.Product_ID)).length;
        return {
            id: project.Project_ID,
            label: projectLabel(project),
            projectId: project.Project_ID,
            hint: free > 0 ? `${free} bez naloga` : 'sve u nalozima',
        };
    });

    const orderItems: CreateMenuItem[] = useMemo(() => {
        const items: CreateMenuItem[] = focused.map(project => {
            const missing = orderableIds(materials, { projectId: project.Project_ID }).length;
            return {
                id: project.Project_ID,
                label: projectLabel(project),
                projectId: project.Project_ID,
                hint: missing > 0 ? `${missing} fali` : 'sve naručeno',
                disabled: missing === 0,
            };
        });
        const all = orderableIds(materials).length;
        if (focused.length > 1) {
            items.push({ id: WHOLE_BOARD, label: 'Sve što fali na tabli', hint: `${all}`, disabled: all === 0, footer: true });
        }
        return items;
    }, [focused, materials]);

    const taskItems: CreateMenuItem[] = focused.map(project => ({
        id: project.Project_ID, label: projectLabel(project), projectId: project.Project_ID,
    }));

    const workOrderMenu = (variant: 'primary' | 'default' = 'default') => (
        <CreateMenu
            variant={variant}
            icon={<Plus size={14} strokeWidth={2.4} />}
            label="Nalog"
            ariaLabel="Novi radni nalog"
            title="Novi radni nalog"
            heading="Nalog za projekat"
            items={workOrderItems}
            onPick={startWorkOrder}
        />
    );
    const orderMenu = (variant: 'primary' | 'default' = 'default') => (
        <CreateMenu
            variant={variant}
            icon={<Plus size={14} strokeWidth={2.4} />}
            label="Narudžba"
            ariaLabel="Nova narudžba materijala"
            title="Naruči sve što fali — za projekat ili cijelu tablu"
            heading="Naruči što fali za"
            items={orderItems}
            onPick={startOrder}
        />
    );

    // ── Zadaci ───────────────────────────────────────────────────────
    const saveTaskFor = async (projectId: string, data: Partial<Task>) => {
        if (!guard()) { setTaskEditor(null); return; }
        const project = onBoard.find(p => p.Project_ID === projectId);
        // Veza na projekat se uvijek forsira — inače zadatak ispadne s table.
        const links = (data.Links || []).filter(l => !(l.Entity_Type === 'project' && l.Entity_ID === projectId));
        links.unshift({ Entity_Type: 'project', Entity_ID: projectId, Entity_Name: project?.Name || project?.Client_Name || 'Projekat' });
        setTaskEditor(null);
        const { saveTask } = await import('@/lib/services');
        const res = await saveTask({ ...data, Links: links }, organizationId || '');
        if (!res.success) { showToast(res.message, 'error'); return; }
        const id = data.Task_ID || res.data?.Task_ID;
        if (id) {
            const base = tasks.find(t => t.Task_ID === id);
            setTaskOverrides(prev => new Map(prev).set(id, {
                ...(base || {}), ...data, Task_ID: id, Links: links,
                Status: data.Status || base?.Status || 'pending',
            } as Task));
        }
    };

    /** Primijeni izmjenu zadatka odmah, pa je potvrdi u bazi. */
    const patchTask = useCallback((task: Task, next: Task | null, write: () => Promise<{ success: boolean; message: string }>) => {
        const had = taskOverrides.has(task.Task_ID);
        const previous = taskOverrides.get(task.Task_ID);
        setTaskOverrides(prev => new Map(prev).set(task.Task_ID, next));
        write()
            .then(res => {
                if (res.success) return;
                showToast(res.message, 'error');
                setTaskOverrides(prev => {
                    const map = new Map(prev);
                    if (had) map.set(task.Task_ID, previous ?? null); else map.delete(task.Task_ID);
                    return map;
                });
            })
            .catch(() => showToast('Izmjena zadatka nije snimljena', 'error'));
    }, [taskOverrides, showToast]);

    const toggleTaskDone = useCallback((task: Task) => {
        if (!guard()) return;
        const status = task.Status === 'completed' ? 'pending' : 'completed';
        patchTask(task, { ...task, Status: status }, async () => {
            const { updateTaskStatus } = await import('@/lib/services');
            return updateTaskStatus(task.Task_ID, status, organizationId || '');
        });
    }, [guard, patchTask, organizationId]);

    const toggleChecklist = useCallback((task: Task, itemId: string) => {
        if (!guard()) return;
        const checklist = (task.Checklist || []).map(i => (i.id === itemId ? { ...i, completed: !i.completed } : i));
        patchTask(task, { ...task, Checklist: checklist }, async () => {
            const { toggleTaskChecklistItem } = await import('@/lib/services');
            return toggleTaskChecklistItem(task.Task_ID, itemId, organizationId || '');
        });
    }, [guard, patchTask, organizationId]);

    const removeTask = useCallback((task: Task) => {
        if (!guard()) { setTaskEditor(null); return; }
        setTaskEditor(null);
        patchTask(task, null, async () => {
            const { deleteTask } = await import('@/lib/services');
            return deleteTask(task.Task_ID, organizationId || '');
        });
    }, [guard, patchTask, organizationId]);

    // ── Napomene ─────────────────────────────────────────────────────
    const saveNotes = useCallback((productId: string, notes: ProductNote[]) => {
        if (!guard()) return;
        const previous = noteOverrides.get(productId);
        setNoteOverrides(prev => new Map(prev).set(productId, notes));   // odmah na ekran
        import('@/lib/services')
            .then(({ updateProductNotes }) => updateProductNotes(productId, notes, organizationId || ''))
            .then(res => {
                if (res.success) return;
                showToast(res.message || 'Napomena nije snimljena', 'error');
                setNoteOverrides(prev => {
                    const next = new Map(prev);
                    if (previous) next.set(productId, previous); else next.delete(productId);
                    return next;
                });
            })
            .catch(() => showToast('Napomena nije snimljena', 'error'));
    }, [guard, noteOverrides, organizationId, showToast]);

    // ── Kalendar → paneli ────────────────────────────────────────────
    /** Tab na koji vodi klik iz kalendara mora biti otvoren i na ekranu. */
    const reveal = (panel: PanelId) => {
        selectTab(panel);
        // block:'nearest' — 'start' je znao povuci i horizontalno, pa bi
        // zaglavlje strane iskliznulo ulijevo ispod sidebara.
        setTimeout(() => document.querySelector(`[data-card~="${panel}"]`)
            ?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' }), 0);
    };
    const timelineActions = {
        onOpenWorkOrder: (id: string) => {
            setOpenWorkOrderId(id);
            reveal('workorders');
        },
        onOpenTask: () => reveal('tasks'),
        onOpenProject: (id: string) => setFocusId(id),
    };

    const boardStyle = {
        '--kc-main-grow': sizing.mainGrow,
        '--kc-rail-grow': sizing.railGrow,
        '--kc-main-basis': `${sizing.mainBasis}px`,
        '--kc-rail-basis': `${sizing.railBasis}px`,
    } as CSSProperties;

    const focusedProject = focusLive ? focused[0] : undefined;
    const subtitle = onBoard.length === 0
        ? 'Tabla je prazna'
        : [
            focusedProject ? projectLabel(focusedProject) : `${onBoard.length} ${plural(onBoard.length, 'projekat', 'projekta', 'projekata')}`,
            `${scope.workOrders.length} ${plural(scope.workOrders.length, 'nalog', 'naloga', 'naloga')}`,
            `${scope.tasks.length} ${plural(scope.tasks.length, 'zadatak', 'zadatka', 'zadataka')}`,
        ].join(' · ');

    const body = (
        <div className="kc-root">
            <header className="kc-top">
                <button type="button" className="kc-icon-btn ghost" aria-label="Nazad na projekte" title="Nazad na projekte" onClick={onClose}>
                    <ArrowLeft size={18} />
                </button>
                <div className="kc-top-title">
                    <strong>Komandni centar</strong>
                    <span>{subtitle}</span>
                </div>
                <div className="kc-top-spacer" />
                <div className="kc-top-actions">
                    <button
                        type="button"
                        className="kc-toggle"
                        aria-pressed={board.Show_Done}
                        title={board.Show_Done ? 'Sakrij završene naloge, primljene narudžbe i riješene napomene' : 'Prikaži i ono što je završeno'}
                        onClick={toggleShowDone}
                    >
                        {board.Show_Done ? <Eye size={15} /> : <EyeOff size={15} />} <span>Završeno</span>
                    </button>
                    <button type="button" className="kc-icon-btn" aria-label="Osvježi podatke" title="Osvježi" onClick={() => onRefresh()}>
                        <RefreshCw size={15} />
                    </button>
                </div>
                {/* Kreiranje stoji u zaglavlju koje je UVIJEK na ekranu. Jedno
                    dugme je glavno (nalog), druga dva su tiša — tri jednako
                    plava dugmeta su se borila za pažnju. */}
                {canCreate && onBoard.length > 0 && (
                    <div className="kc-top-create" role="group" aria-label="Novo">
                        {workOrderMenu('primary')}
                        {orderMenu()}
                        <CreateMenu
                            icon={<Plus size={14} strokeWidth={2.4} />}
                            label="Zadatak"
                            ariaLabel="Novi zadatak"
                            title="Novi zadatak"
                            heading="Zadatak za projekat"
                            items={taskItems}
                            onPick={projectId => setTaskEditor({ mode: 'create', projectId })}
                        />
                    </div>
                )}
            </header>

            <div className={`kc-scroll${hasSelection ? ' has-dock' : ''}`}>
                <div className="kc-inner">
                <BoardBar
                    projects={projects}
                    boardIds={board.Project_IDs}
                    counts={chipCounts}
                    focusId={focusLive}
                    onFocus={setFocusId}
                    onAdd={addProjects}
                    onRemove={removeProject}
                />

                {onBoard.length === 0 ? (
                    <div className="kc-blank">
                        <LayoutDashboard size={38} style={{ opacity: 0.3 }} />
                        <h2>Tabla je prazna</h2>
                        <p>
                            Dodaj projekte koje trenutno voziš. Njihovi proizvodi, materijali, nalozi,
                            zadaci i napomene se skupe ovdje, na jednom mjestu.
                        </p>
                    </div>
                ) : (
                    <>
                        <PulseStrip signals={signals} lens={lens} onLens={applyLens} />

                        <CommandTimeline
                            data={visibleTimeline}
                            scope={scope}
                            today={today}
                            actions={timelineActions}
                            plans={plans}
                            collapsed={calendarCollapsed}
                            onCollapse={toggleCalendar}
                        />

                        <div className="kc-board" data-split={split} data-anchor={anchorColumn || undefined} style={boardStyle}>
                            <div className="kc-col kc-col-main">
                                <KcTabCard label="Proizvodnja" tabs={MAIN_TABS} active={mainTab} onSelect={selectTab}>
                                    <ProductsPanel
                                        scope={scope}
                                        materials={materials}
                                        lens={lensSelection}
                                        canCreate={canCreate}
                                        selectedProducts={selectedProducts}
                                        selectedMaterials={selectedMaterials}
                                        onToggleProduct={toggleIn(setSelectedProducts)}
                                        onToggleProductMany={toggleMany(setSelectedProducts)}
                                        onToggleMaterial={toggleIn(setSelectedMaterials)}
                                        onToggleMaterialMany={toggleMany(setSelectedMaterials)}
                                        onCreateWorkOrderFor={createWorkOrderFor}
                                        onOrder={openOrder}
                                        onOpenChange={open => reportOpen('products', open)}
                                    />
                                    <WorkOrdersPanel
                                        scope={scope}
                                        workers={workers}
                                        tasks={tasks}
                                        today={today}
                                        lens={lensSelection}
                                        showDone={board.Show_Done}
                                        actions={workOrderActions}
                                        openId={openWorkOrderId}
                                        onOpenChange={setOpenWorkOrderId}
                                        create={canCreate ? workOrderMenu() : undefined}
                                    />
                                </KcTabCard>
                            </div>

                            <aside className="kc-col kc-col-rail">
                                <KcTabCard label="Praćenje" tabs={RAIL_TABS} active={railTab} onSelect={selectTab}>
                                    <PurchaseOrdersPanel
                                        scope={scope}
                                        today={today}
                                        lens={lensSelection}
                                        showDone={board.Show_Done}
                                        create={canCreate ? orderMenu() : undefined}
                                        onOpenChange={open => reportOpen('purchases', open)}
                                    />
                                    <TaskWall
                                        scope={scope}
                                        lens={lensSelection}
                                        showDone={board.Show_Done}
                                        today={today}
                                        canCreate={canCreate}
                                        onToggleDone={toggleTaskDone}
                                        onEdit={task => setTaskEditor({ mode: 'edit', task, projectId: projectOfTask(task, onBoard) })}
                                        onToggleChecklist={toggleChecklist}
                                        onNew={projectId => setTaskEditor({ mode: 'create', projectId })}
                                        onOpenWorkOrder={timelineActions.onOpenWorkOrder}
                                        create={canCreate ? (
                                            <CreateMenu
                                                icon={<Plus size={14} strokeWidth={2.4} />}
                                                label="Zadatak"
                                                ariaLabel="Novi zadatak"
                                                heading="Zadatak za projekat"
                                                items={taskItems}
                                                onPick={projectId => setTaskEditor({ mode: 'create', projectId })}
                                            />
                                        ) : undefined}
                                    />
                                    <NotesPanel
                                        scope={scope}
                                        lens={lensSelection}
                                        showDone={board.Show_Done}
                                        canCreate={canCreate}
                                        today={today}
                                        onSave={saveNotes}
                                        onOpenModal={(project, productId) => setNotesModal({ project, productId })}
                                    />
                                </KcTabCard>
                            </aside>
                        </div>
                    </>
                )}
                </div>
            </div>

            <SelectionDock
                projects={onBoard}
                materials={materials}
                selectedProducts={selectedProducts}
                selectedMaterials={selectedMaterials}
                canCreate={canCreate}
                onClear={clearSelection}
                onOrder={(ids, explicit) => openOrder(ids, explicit ? 'Označeni materijali' : 'Sve što fali na označenim proizvodima')}
                onCreateWorkOrder={projectId => createWorkOrderFor(projectId, Array.from(selectedProducts))}
            />

            {/* ── Modali ── */}
            {wizardFor !== null && organizationId && (
                <WorkOrderWizard
                    isOpen
                    mode="production"
                    workOrders={workOrders}
                    projects={wizardFor.projects}
                    workers={workers}
                    tasks={tasks}
                    organizationId={organizationId}
                    initialProducts={wizardFor.seed}
                    onClose={() => setWizardFor(null)}
                    onRefresh={onRefresh}
                    onCreated={() => clearSelection()}
                    showToast={showToast}
                />
            )}

            {orderDraft && (
                <MaterialOrderSelectModal
                    isOpen
                    onClose={() => setOrderDraft(null)}
                    workOrderLabel={`${orderDraft.label} · isporuka oko ${shortDate(expectedDelivery, today)}`}
                    plannedStartDate={expectedDelivery}
                    organizationId={organizationId || ''}
                    onRefresh={onRefresh}
                    showToast={showToast}
                    plan={orderPlan}
                    onCreate={createOrders}
                    suggestName={suggestName}
                />
            )}

            {notesModal && (
                <ProjectNotesModal
                    isOpen
                    onClose={() => setNotesModal(null)}
                    projectName={notesModal.project.Name || notesModal.project.Client_Name || 'Projekat'}
                    products={notesModal.project.products || []}
                    organizationId={organizationId || ''}
                    initialProductId={notesModal.productId}
                    onRefresh={onRefresh}
                    showToast={showToast}
                />
            )}

            {taskEditor && (
                <TaskEditorModal
                    mode={taskEditor.mode}
                    task={taskEditor.task}
                    projectName={onBoard.find(p => p.Project_ID === taskEditor.projectId)?.Name
                        || onBoard.find(p => p.Project_ID === taskEditor.projectId)?.Client_Name
                        || 'Projekat'}
                    workers={workers}
                    onClose={() => setTaskEditor(null)}
                    onSave={data => saveTaskFor(taskEditor.projectId, data)}
                    onDelete={taskEditor.task ? async () => removeTask(taskEditor.task!) : undefined}
                />
            )}

            {printOrder && (
                <Modal isOpen onClose={() => setPrintOrder(null)} size="fullscreen" title="Štampa radnog naloga">
                    <WorkOrderPrintTemplate workOrder={printOrder} tasks={tasks} />
                </Modal>
            )}

            {deleteFor && (
                <Modal
                    isOpen
                    onClose={() => setDeleteFor(null)}
                    size="default"
                    title={`Obrisati nalog #${deleteFor.Work_Order_Number}?`}
                    footer={
                        <>
                            <button className="btn btn-secondary" onClick={() => setDeleteFor(null)}>Odustani</button>
                            <button className="btn btn-secondary" onClick={() => confirmDelete('waiting')}>Obriši · proizvodi na čekanje</button>
                            <button className="btn btn-danger" onClick={() => confirmDelete('completed')}>Obriši · proizvodi ostaju završeni</button>
                        </>
                    }
                >
                    <p style={{ fontSize: 13, lineHeight: 1.5 }}>
                        Nalog se briše trajno. Odaberi šta se dešava s proizvodima iz naloga:
                        vraćaju li se na čekanje ili ostaju označeni kao završeni.
                    </p>
                </Modal>
            )}
        </div>
    );

    if (embedded) return body;
    return mounted ? createPortal(<div className="kc-overlay">{body}</div>, document.body) : null;
}

function projectOfTask(task: Task, projects: Project[]): string {
    const link = (task.Links || []).find(l => l.Entity_Type === 'project');
    if (link && projects.some(p => p.Project_ID === link.Entity_ID)) return link.Entity_ID;
    const productLink = (task.Links || []).find(l => l.Entity_Type === 'product');
    const owner = productLink && projects.find(p => (p.products || []).some(pr => pr.Product_ID === productLink.Entity_ID));
    return owner?.Project_ID || projects[0]?.Project_ID || '';
}

/** Print traži materijale iz projekta — isti postupak kao u Nalozi tabu. */
function enrichForPrint(wo: WorkOrder, projects: Project[]): WorkOrder {
    return {
        ...wo,
        items: wo.items?.map(item => {
            const project = projects.find(p => p.Project_ID === item.Project_ID);
            const product: Product | undefined = project?.products?.find(pr => pr.Product_ID === item.Product_ID);
            return { ...item, materials: product?.materials || item.materials || [] };
        }),
    };
}



/**
 * Scenariji s Platna koji dodiruju tablu. Čita se jednom pri otvaranju ekrana;
 * planovi se ovdje NE mijenjaju (termini se uređuju u Platnu), pa nema ni
 * osvježavanja ni pretplate.
 */
function usePlanScenarios(
    organizationId: string | null,
    scope: BoardScope,
    override?: { id: string; name: string; blocks: PlanBlock[] }[],
) {
    const [loaded, setLoaded] = useState<PlanScenario[]>([]);
    const [selectedId, setSelectedId] = useState('');

    useEffect(() => {
        if (override || !organizationId) return;
        let alive = true;
        getScenarios(organizationId)
            .then(result => { if (alive) setLoaded(result); })
            .catch(() => { /* plan je dodatak, ne ruši ekran */ });
        return () => { alive = false; };
    }, [organizationId, override]);

    const scenarios = useMemo<PlanScenario[]>(
        () => (override
            ? override.map(s => ({ Scenario_ID: s.id, Name: s.name, Blocks: s.blocks } as PlanScenario))
            : loaded),
        [override, loaded],
    );

    const relevant = useMemo(
        () => scenarios.filter(s => (s.Blocks || []).some(b => planBlockProjects(b, scope).length > 0)),
        [scenarios, scope],
    );
    const selected = relevant.find(s => s.Scenario_ID === selectedId) || relevant[0];

    return {
        list: relevant.map(s => ({ id: s.Scenario_ID, name: s.Name })),
        selectedId: selected?.Scenario_ID || '',
        onSelect: setSelectedId,
        blocks: selected?.Blocks || [],
    };
}
