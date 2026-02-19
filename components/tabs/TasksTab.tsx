'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import type { Task, TaskProfile, Project, Worker, Product, Material, WorkOrder, Order, TaskLink, TaskPriority, TaskCategory, ChecklistItem } from '@/lib/types';
import {
    TASK_PRIORITY_LABELS,
    TASK_STATUS_LABELS,
    TASK_CATEGORY_LABELS,
    TASK_PRIORITIES,
    TASK_CATEGORIES
} from '@/lib/types';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { saveTask, deleteTask, updateTaskStatus, toggleTaskChecklistItem, generateUUID, saveTaskProfile, deleteTaskProfile } from '@/lib/database';
import './TasksTab.css';
import {
    Plus,
    Search,
    Filter,
    Calendar,
    CheckSquare,
    Circle,
    Check,
    CheckCircle2,
    Clock,
    AlertTriangle,
    ChevronDown,
    ChevronUp,
    SlidersHorizontal,
    X,
    Save,
    Link2,
    ListChecks,
    Trash2,
    FolderOpen,
    Package,
    Layers,
    User,
    ShoppingCart,
    HardHat,
    Edit3,
    Tag,
    GripVertical,
    ExternalLink,
    MessageSquare,
    CheckCheck,
    Grid3X3,
    Flag,
    CalendarDays,
    Printer,
    MoreHorizontal,
    Users,
    UserPlus
} from 'lucide-react';
import { useData } from '@/context/DataContext';
import VoiceInput, { ExtractedTaskData } from '@/components/VoiceInput';

// ============================================
// TYPES
// ============================================

interface TasksTabProps {
    tasks: Task[];
    projects: Project[];
    workers: Worker[];
    materials: Material[];
    workOrders?: WorkOrder[];
    orders?: Order[];
    taskProfiles?: TaskProfile[];
    onRefresh: (...collections: string[]) => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
    projectFilter?: string | null;  // Filter tasks by project ID
    onClearFilter?: () => void;     // Clear the project filter
}

type ViewMode = 'calendar' | 'board' | 'grid';
type FilterStatus = 'all' | 'pending' | 'in_progress' | 'completed';
type GroupBy = 'none' | 'priority' | 'date' | 'connection' | 'worker';

// Group labels for UI
const GROUP_BY_LABELS: Record<GroupBy, string> = {
    none: 'Bez grupiranja',
    priority: 'Po hitnosti',
    date: 'Po datumu',
    connection: 'Po poveznici',
    worker: 'Po radniku'
};


// ============================================
// PRIORITY COLORS
// ============================================

const priorityColors: Record<TaskPriority, { bg: string; border: string; text: string; icon: string }> = {
    low: { bg: 'rgba(52, 199, 89, 0.08)', border: 'rgba(52, 199, 89, 0.3)', text: '#34C759', icon: '#34C759' },
    medium: { bg: 'rgba(0, 122, 255, 0.08)', border: 'rgba(0, 122, 255, 0.3)', text: '#007AFF', icon: '#007AFF' },
    high: { bg: 'rgba(255, 149, 0, 0.08)', border: 'rgba(255, 149, 0, 0.3)', text: '#FF9500', icon: '#FF9500' },
    urgent: { bg: 'rgba(255, 59, 48, 0.08)', border: 'rgba(255, 59, 48, 0.3)', text: '#FF3B30', icon: '#FF3B30' }
};

const categoryIcons: Record<TaskCategory, React.ReactNode> = {
    general: <Circle size={14} />,
    manufacturing: <HardHat size={14} />,
    ordering: <ShoppingCart size={14} />,
    installation: <Layers size={14} />,
    design: <Package size={14} />,
    meeting: <User size={14} />,
    reminder: <Clock size={14} />
};

// ============================================
// MAIN COMPONENT
// ============================================

export default function TasksTab({ tasks, projects, workers, materials, workOrders = [], orders = [], taskProfiles = [], onRefresh, showToast, projectFilter, onClearFilter }: TasksTabProps) {
    const { organizationId } = useData();

    // Profile state
    const [selectedProfileId, setSelectedProfileId] = useState<string>('__all__');
    const [showProfileMenu, setShowProfileMenu] = useState(false);
    const [newProfileName, setNewProfileName] = useState('');
    const [isCreatingProfile, setIsCreatingProfile] = useState(false);
    const profileDropdownRef = useRef<HTMLDivElement>(null);

    // Close profile dropdown on outside click
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (profileDropdownRef.current && !profileDropdownRef.current.contains(event.target as Node)) {
                setShowProfileMenu(false);
            }
        }
        if (showProfileMenu) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
    }, [showProfileMenu]);
    // State
    const [searchQuery, setSearchQuery] = useState('');
    const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
    const [filterPriority, setFilterPriority] = useState<TaskPriority | 'all'>('all');
    const [filterCategory, setFilterCategory] = useState<TaskCategory | 'all'>('all');
    const [viewMode, setViewMode] = useState<ViewMode>('grid');
    const [groupBy, setGroupBy] = useState<GroupBy>('priority');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingTask, setEditingTask] = useState<Task | null>(null);
    const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
    const [showFilters, setShowFilters] = useState(false);
    const [showControls, setShowControls] = useState(true);
    const [showCompleted, setShowCompleted] = useState(false);
    const [calendarDate, setCalendarDate] = useState(new Date());
    // Task preview modal (read-only view)
    const [previewTask, setPreviewTask] = useState<Task | null>(null);
    // Day tasks popup (shows all tasks for a specific day)
    const [dayTasksPopup, setDayTasksPopup] = useState<{ day: number; tasks: Task[] } | null>(null);
    // Print modal
    const [printingTask, setPrintingTask] = useState<Task | null>(null);
    // Card menu dropdown
    const [activeCardMenu, setActiveCardMenu] = useState<string | null>(null);
    const cardMenuRef = useRef<HTMLDivElement>(null);

    // Initial check for mobile
    useEffect(() => {
        if (window.innerWidth < 768) {
            setShowControls(false);
        }
    }, []);

    // Close card menu on outside click
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (activeCardMenu && cardMenuRef.current && !cardMenuRef.current.contains(e.target as Node)) {
                setActiveCardMenu(null);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [activeCardMenu]);

    const toggleControls = () => setShowControls(!showControls);

    const toggleTaskExpansion = (taskId: string) => {
        const newExpanded = new Set(expandedTasks);
        if (newExpanded.has(taskId)) {
            newExpanded.delete(taskId);
        } else {
            newExpanded.add(taskId);
        }
        setExpandedTasks(newExpanded);
    };

    // Drag and drop state
    const [isDragging, setIsDragging] = useState(false);

    const onDragEnd = async (result: DropResult) => {
        setIsDragging(false);
        const { destination, source, draggableId } = result;

        if (!destination) return;

        if (
            destination.droppableId === source.droppableId &&
            destination.index === source.index
        ) {
            return;
        }

        // Status change (Moved to another column)
        if (destination.droppableId !== source.droppableId) {
            await handleStatusChange(draggableId, destination.droppableId as Task['Status']);
        }
    };

    // Expanded cards state
    const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());

    const toggleCardExpand = (taskId: string) => {
        setExpandedCards(prev => {
            const next = new Set(prev);
            if (next.has(taskId)) {
                next.delete(taskId);
            } else {
                next.add(taskId);
            }
            return next;
        });
    };

    // Local state for optimistic updates
    const [localTasks, setLocalTasks] = useState<Task[]>(tasks);

    // Sync local state when props change
    useEffect(() => {
        setLocalTasks(tasks);
    }, [tasks]);

    // Get all products from projects
    const allProducts = useMemo(() => {
        return projects.flatMap(p => p.products || []);
    }, [projects]);

    // Filter tasks
    const filteredTasks = useMemo(() => {
        return localTasks.filter(task => { // Use localTasks instead of tasks from props
            // Profile filter
            if (selectedProfileId !== '__all__') {
                if (task.Profile_ID !== selectedProfileId) return false;
            }
            // selectedProfileId === '__all__' shows all tasks

            // Project filter (from cross-tab navigation)
            if (projectFilter) {
                const project = projects.find(p => p.Project_ID === projectFilter);
                if (project) {
                    const projectProductIds = (project.products || []).map(p => p.Product_ID);
                    const hasProjectLink = task.Links?.some(link =>
                        (link.Entity_Type === 'project' && link.Entity_ID === projectFilter) ||
                        (link.Entity_Type === 'product' && projectProductIds.includes(link.Entity_ID))
                    );
                    if (!hasProjectLink) return false;
                } else {
                    return false;
                }
            }

            // Search filter
            if (searchQuery) {
                const query = searchQuery.toLowerCase();
                if (!task.Title.toLowerCase().includes(query) &&
                    !task.Description?.toLowerCase().includes(query)) {
                    return false;
                }
            }

            // Hide completed tasks by default (unless showCompleted is true or explicitly filtering for them)
            if (!showCompleted && task.Status === 'completed' && filterStatus !== 'completed') {
                return false;
            }

            // Status filter
            if (filterStatus !== 'all' && task.Status !== filterStatus) {
                return false;
            }

            // Priority filter
            if (filterPriority !== 'all' && task.Priority !== filterPriority) {
                return false;
            }

            // Category filter
            if (filterCategory !== 'all' && task.Category !== filterCategory) {
                return false;
            }

            return true;
        }).sort((a, b) => {
            // First, sort by completion status (completed at the bottom)
            if (a.Status === 'completed' && b.Status !== 'completed') return 1;
            if (a.Status !== 'completed' && b.Status === 'completed') return -1;

            // Then by priority (urgent first)
            const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
            const priorityDiff = priorityOrder[a.Priority] - priorityOrder[b.Priority];
            if (priorityDiff !== 0) return priorityDiff;

            // Then by due date (earliest first)
            if (a.Due_Date && b.Due_Date) {
                return new Date(a.Due_Date).getTime() - new Date(b.Due_Date).getTime();
            }
            if (a.Due_Date) return -1;
            if (b.Due_Date) return 1;

            return 0;
        });
    }, [localTasks, searchQuery, filterStatus, filterPriority, filterCategory, projectFilter, projects, showCompleted, selectedProfileId]);

    // Group tasks by status for board view (exclude reminders - they're not workflow items)
    const boardTasks = useMemo(() =>
        filteredTasks.filter(t => t.Category !== 'reminder'),
        [filteredTasks]);

    const tasksByStatus = useMemo(() => ({
        pending: boardTasks.filter(t => t.Status === 'pending'),
        in_progress: boardTasks.filter(t => t.Status === 'in_progress'),
        completed: boardTasks.filter(t => t.Status === 'completed')
    }), [boardTasks]);

    // Group tasks by date for calendar view
    const tasksByDate = useMemo(() => {
        const map = new Map<string, Task[]>();
        filteredTasks.forEach(task => {
            if (task.Due_Date) {
                const dateKey = new Date(task.Due_Date).toISOString().split('T')[0];
                const existing = map.get(dateKey) || [];
                existing.push(task);
                map.set(dateKey, existing);
            }
        });
        return map;
    }, [filteredTasks]);

    // Group tasks for grid view
    interface TaskGroup {
        key: string;
        label: string;
        iconClass: string;
        tasks: Task[];
    }

    const groupedTasks = useMemo((): TaskGroup[] => {
        if (groupBy === 'none') {
            return [{ key: 'all', label: 'Svi zadaci', iconClass: 'category', tasks: filteredTasks }];
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const weekFromNow = new Date(today);
        weekFromNow.setDate(weekFromNow.getDate() + 7);

        switch (groupBy) {
            case 'priority': {
                const priorities: { key: TaskPriority; label: string; iconClass: string }[] = [
                    { key: 'urgent', label: 'Hitno', iconClass: 'urgent' },
                    { key: 'high', label: 'Visok prioritet', iconClass: 'high' },
                    { key: 'medium', label: 'Srednji prioritet', iconClass: 'medium' },
                    { key: 'low', label: 'Nizak prioritet', iconClass: 'low' }
                ];
                return priorities
                    .map(p => ({
                        key: p.key,
                        label: p.label,
                        iconClass: p.iconClass,
                        tasks: filteredTasks.filter(t => t.Priority === p.key)
                    }))
                    .filter(g => g.tasks.length > 0);
            }

            case 'date': {
                const overdue = filteredTasks.filter(t =>
                    t.Due_Date && new Date(t.Due_Date) < today && t.Status !== 'completed'
                );
                const dueToday = filteredTasks.filter(t =>
                    t.Due_Date && new Date(t.Due_Date).toDateString() === today.toDateString()
                );
                const thisWeek = filteredTasks.filter(t => {
                    if (!t.Due_Date) return false;
                    const due = new Date(t.Due_Date);
                    return due > today && due <= weekFromNow;
                });
                const later = filteredTasks.filter(t => {
                    if (!t.Due_Date) return false;
                    return new Date(t.Due_Date) > weekFromNow;
                });
                const noDate = filteredTasks.filter(t => !t.Due_Date);

                return [
                    { key: 'overdue', label: 'Prekoračeno', iconClass: 'overdue', tasks: overdue },
                    { key: 'today', label: 'Danas', iconClass: 'today', tasks: dueToday },
                    { key: 'week', label: 'Ovaj tjedan', iconClass: 'week', tasks: thisWeek },
                    { key: 'later', label: 'Kasnije', iconClass: 'later', tasks: later },
                    { key: 'no-date', label: 'Bez roka', iconClass: 'no-date', tasks: noDate }
                ].filter(g => g.tasks.length > 0);
            }

            case 'worker': {
                const workerMap = new Map<string, Task[]>();
                const unassigned: Task[] = [];

                filteredTasks.forEach(t => {
                    if (t.Assigned_Worker_Name) {
                        const existing = workerMap.get(t.Assigned_Worker_Name) || [];
                        existing.push(t);
                        workerMap.set(t.Assigned_Worker_Name, existing);
                    } else {
                        unassigned.push(t);
                    }
                });

                const groups: TaskGroup[] = Array.from(workerMap.entries())
                    .sort((a, b) => a[0].localeCompare(b[0]))
                    .map(([name, tasks]) => ({
                        key: name,
                        label: name,
                        iconClass: 'worker',
                        tasks
                    }));

                if (unassigned.length > 0) {
                    groups.push({ key: 'unassigned', label: 'Nedodijeljeno', iconClass: 'no-date', tasks: unassigned });
                }

                return groups;
            }

            case 'connection': {
                const connectionMap = new Map<string, { type: string; name: string; tasks: Task[] }>();
                const noConnection: Task[] = [];

                filteredTasks.forEach(t => {
                    if (t.Links && t.Links.length > 0) {
                        t.Links.forEach(link => {
                            // Unique key composed of Type and ID to distinguish entities
                            const key = `${link.Entity_Type}:${link.Entity_ID}`;
                            const existing = connectionMap.get(key);
                            if (existing) {
                                // Add task if not already in list (though logic here prevents it, good to be safe)
                                if (!existing.tasks.find(x => x.Task_ID === t.Task_ID)) {
                                    existing.tasks.push(t);
                                }
                            } else {
                                connectionMap.set(key, {
                                    type: link.Entity_Type,
                                    name: link.Entity_Name,
                                    tasks: [t]
                                });
                            }
                        });
                    } else {
                        noConnection.push(t);
                    }
                });

                const groups: TaskGroup[] = Array.from(connectionMap.values())
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map(({ type, name, tasks }) => ({
                        key: name, // Using name as key for simple display, or should we use ID? key is used for React list key.
                        label: name,
                        iconClass: type, // Map entity type to icon class
                        tasks
                    }));

                if (noConnection.length > 0) {
                    groups.push({ key: 'no-connection', label: 'Bez poveznica', iconClass: 'no-date', tasks: noConnection });
                }

                return groups;
            }

            default:
                return [{ key: 'all', label: 'Svi zadaci', iconClass: 'category', tasks: filteredTasks }];
        }
    }, [filteredTasks, groupBy]);



    // Stats
    const stats = useMemo(() => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const overdue = localTasks.filter(t => // Use localTasks
            t.Status !== 'completed' &&
            t.Due_Date &&
            new Date(t.Due_Date) < today
        ).length;
        const dueToday = localTasks.filter(t => // Use localTasks
            t.Status !== 'completed' &&
            t.Due_Date &&
            new Date(t.Due_Date).toDateString() === today.toDateString()
        ).length;
        const highPriority = localTasks.filter(t => // Use localTasks
            t.Status !== 'completed' &&
            (t.Priority === 'high' || t.Priority === 'urgent')
        ).length;

        return { overdue, dueToday, highPriority, total: localTasks.length };
    }, [localTasks]);

    // Handlers
    const handleCreateTask = () => {
        setEditingTask(null);
        setIsModalOpen(true);
    };

    const handleEditTask = (task: Task) => {
        setEditingTask(task);
        setIsModalOpen(true);
    };

    const handleSaveTask = async (taskData: Partial<Task>) => {
        // Assign profile to new tasks if a specific profile is selected
        if (!taskData.Task_ID && selectedProfileId !== '__all__') {
            taskData.Profile_ID = selectedProfileId;
        }
        // If creating on "all" view, ensure Profile_ID is empty (shared)
        if (!taskData.Task_ID && selectedProfileId === '__all__') {
            taskData.Profile_ID = '';
        }
        const result = await saveTask(taskData, organizationId!);
        if (result.success) {
            showToast(result.message, 'success');
            onRefresh('tasks');
            setIsModalOpen(false);
        } else {
            showToast(result.message, 'error');
        }
    };

    // Profile management handlers
    const handleCreateProfile = async () => {
        if (!newProfileName.trim()) return;
        const result = await saveTaskProfile({ Name: newProfileName.trim() }, organizationId!);
        if (result.success) {
            showToast(result.message, 'success');
            onRefresh('taskProfiles');
            setNewProfileName('');
            setIsCreatingProfile(false);
            if (result.data) {
                setSelectedProfileId(result.data.Profile_ID);
            }
        } else {
            showToast(result.message, 'error');
        }
    };

    const handleDeleteProfile = async (profileId: string) => {
        if (!confirm('Obrisati ovaj profil? Svi zadaci neće biti obrisani, već prebačeni u zajedničke.')) return;
        const result = await deleteTaskProfile(profileId, organizationId!);
        if (result.success) {
            showToast(result.message, 'success');
            setSelectedProfileId('__shared__');
            onRefresh('tasks', 'taskProfiles');
        } else {
            showToast(result.message, 'error');
        }
    };

    const handleDeleteTask = async (taskId: string) => {
        if (!confirm('Da li ste sigurni da želite obrisati ovaj zadatak?')) return;
        const result = await deleteTask(taskId, organizationId!);
        if (result.success) {
            showToast(result.message, 'success');
            onRefresh('tasks');
        } else {
            showToast(result.message, 'error');
        }
    };

    const handleStatusChange = async (taskId: string, status: Task['Status']) => {
        // Optimistic update
        const previousTasks = [...localTasks];
        setLocalTasks(prev => prev.map(t =>
            t.Task_ID === taskId ? { ...t, Status: status } : t
        ));

        // Attempt update
        const result = await updateTaskStatus(taskId, status, organizationId!);
        if (result.success) {
            // Success - refresh data in background (silent sync)
            onRefresh('tasks');
        } else {
            // Revert on failure
            setLocalTasks(previousTasks);
            showToast(result.message, 'error');
        }
    };

    const handleToggleChecklist = async (taskId: string, itemId: string) => {
        // Optimistic update
        const previousTasks = [...localTasks];
        setLocalTasks(prev => prev.map(t => {
            if (t.Task_ID === taskId && t.Checklist) {
                return {
                    ...t,
                    Checklist: t.Checklist.map(c =>
                        c.id === itemId ? { ...c, completed: !c.completed } : c
                    )
                };
            }
            return t;
        }));

        // Attempt update
        const result = await toggleTaskChecklistItem(taskId, itemId, organizationId!);
        if (result.success) {
            // Silent refresh
            onRefresh('tasks');
        } else {
            // Revert on failure
            setLocalTasks(previousTasks);
        }
    };

    // Render: Quick Stats
    const renderQuickStats = () => (
        <div className="tasks-quick-stats">
            <button
                className={`stat-chip ${filterStatus === 'all' && stats.overdue > 0 ? 'highlight-red' : ''}`}
                onClick={() => setFilterStatus('all')}
            >
                <AlertTriangle size={16} />
                <span>{stats.overdue} prekoračeno</span>
            </button>
            <button className="stat-chip">
                <Clock size={16} />
                <span>{stats.dueToday} danas</span>
            </button>
            <button
                className="stat-chip"
                onClick={() => setFilterPriority(filterPriority === 'high' ? 'all' : 'high')}
            >
                <span className="priority-dot high"></span>
                <span>{stats.highPriority} hitno</span>
            </button>
        </div>
    );

    // Render: Task Card with Expandable Details
    const renderTaskCard = (task: Task) => {
        const pColor = priorityColors[task.Priority];
        const isOverdue = task.Due_Date && task.Status !== 'completed' && new Date(task.Due_Date) < new Date();
        const checklistProgress = task.Checklist?.length
            ? task.Checklist.filter(c => c.completed).length / task.Checklist.length
            : null;
        const isExpanded = expandedCards.has(task.Task_ID);
        const hasExpandableContent = task.Notes || (task.Checklist && task.Checklist.length > 0) || (task.Links && task.Links.length > 0);

        return (
            <div
                key={task.Task_ID}
                className={`task-card ${task.Status === 'completed' ? 'completed' : ''} ${isExpanded ? 'expanded' : ''}`}
                style={{
                    borderLeft: `4px solid ${pColor.border}`,
                    background: task.Status === 'completed' ? 'rgba(0,0,0,0.02)' : undefined
                }}
            >
                {/* Main header - always visible */}
                <div className="task-card-header">
                    <button
                        className="task-status-btn"
                        onClick={() => handleStatusChange(
                            task.Task_ID,
                            task.Status === 'completed' ? 'pending' : 'completed'
                        )}
                        title={task.Status === 'completed' ? 'Označi kao nezavršeno' : 'Označi kao završeno'}
                    >
                        {task.Status === 'completed'
                            ? <CheckCircle2 size={22} className="check-complete" />
                            : <Circle size={22} className="check-pending" />
                        }
                    </button>
                    <div className="task-card-content" onClick={() => hasExpandableContent && toggleCardExpand(task.Task_ID)}>
                        <h4 className="task-title">{task.Title}</h4>
                        {task.Description && (
                            <p className="task-description">{task.Description}</p>
                        )}
                    </div>
                    <div className="task-card-actions">
                        {hasExpandableContent && (
                            <button
                                className={`icon-btn expand-btn ${isExpanded ? 'expanded' : ''}`}
                                onClick={() => toggleCardExpand(task.Task_ID)}
                                title={isExpanded ? 'Skupi' : 'Proširi'}
                            >
                                {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                            </button>
                        )}
                        <button className="icon-btn" onClick={() => setPrintingTask(task)} title="Printaj">
                            <Printer size={14} />
                        </button>
                        <button className="icon-btn" onClick={() => handleEditTask(task)} title="Uredi">
                            <Edit3 size={16} />
                        </button>
                        <button className="icon-btn danger" onClick={() => handleDeleteTask(task.Task_ID)} title="Obriši">
                            <Trash2 size={16} />
                        </button>
                    </div>
                </div>

                {/* Meta row - always visible */}
                <div className="task-card-meta">
                    {/* Priority chip */}
                    <span
                        className="meta-chip priority"
                        style={{
                            background: pColor.bg,
                            color: pColor.text,
                            border: `1px solid ${pColor.border}`
                        }}
                    >
                        {TASK_PRIORITY_LABELS[task.Priority]}
                    </span>

                    {/* Category */}
                    <span className="meta-chip category">
                        {categoryIcons[task.Category]}
                        {TASK_CATEGORY_LABELS[task.Category]}
                    </span>

                    {/* Due date */}
                    {task.Due_Date && (
                        <span className={`meta-chip due-date ${isOverdue ? 'overdue' : ''}`}>
                            <Calendar size={14} />
                            {new Date(task.Due_Date).toLocaleDateString('hr-HR', {
                                day: 'numeric',
                                month: 'short'
                            })}
                        </span>
                    )}

                    {/* Assigned worker */}
                    {task.Assigned_Worker_Name && (
                        <span className="meta-chip worker">
                            <User size={14} />
                            {task.Assigned_Worker_Name}
                        </span>
                    )}

                    {/* Preview indicators for collapsed state */}
                    {!isExpanded && (
                        <>
                            {task.Notes && (
                                <span className="meta-chip notes-indicator">
                                    <MessageSquare size={12} />
                                </span>
                            )}
                            {task.Links && task.Links.length > 0 && (
                                <span className="meta-chip links-indicator">
                                    <Link2 size={12} />
                                    {task.Links.length}
                                </span>
                            )}
                        </>
                    )}
                </div>

                {/* Checklist progress - always visible if exists */}
                {checklistProgress !== null && !isExpanded && (
                    <div className="task-checklist-progress">
                        <div className="progress-bar">
                            <div
                                className="progress-fill"
                                style={{ width: `${checklistProgress * 100}%` }}
                            />
                        </div>
                        <span className="progress-text">
                            <CheckCheck size={12} />
                            {task.Checklist?.filter(c => c.completed).length}/{task.Checklist?.length}
                        </span>
                    </div>
                )}

                {/* Expandable Details Section */}
                {isExpanded && hasExpandableContent && (
                    <div className="task-card-expanded">
                        {/* Notes */}
                        {task.Notes && (
                            <div className="expanded-section notes-section">
                                <div className="section-header">
                                    <MessageSquare size={14} />
                                    <span>Napomene</span>
                                </div>
                                <p className="notes-content">{task.Notes}</p>
                            </div>
                        )}

                        {/* Entity Links */}
                        {task.Links && task.Links.length > 0 && (
                            <div className="expanded-section links-section">
                                <div className="section-header">
                                    <Link2 size={14} />
                                    <span>Povezano ({task.Links.length})</span>
                                </div>
                                <div className="entity-links-list">
                                    {task.Links.map((link, idx) => (
                                        <span key={idx} className={`entity-chip ${link.Entity_Type}`}>
                                            {link.Entity_Type === 'project' && <FolderOpen size={12} />}
                                            {link.Entity_Type === 'product' && <Package size={12} />}
                                            {link.Entity_Type === 'material' && <Layers size={12} />}
                                            {link.Entity_Type === 'work_order' && <HardHat size={12} />}
                                            {link.Entity_Type === 'worker' && <User size={12} />}
                                            {link.Entity_Type === 'order' && <ShoppingCart size={12} />}
                                            {link.Entity_Name}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Checklist with Interactive Items */}
                        {task.Checklist && task.Checklist.length > 0 && (
                            <div className="expanded-section checklist-section">
                                <div className="section-header">
                                    <CheckCheck size={14} />
                                    <span>Kontrolna lista ({task.Checklist.filter(c => c.completed).length}/{task.Checklist.length})</span>
                                </div>
                                <div className="checklist-items">
                                    {[...task.Checklist].sort((a, b) => (a.completed === b.completed ? 0 : a.completed ? 1 : -1)).map((item) => (
                                        <button
                                            key={item.id}
                                            className={`checklist-item ${item.completed ? 'completed' : ''}`}
                                            onClick={() => handleToggleChecklist(task.Task_ID, item.id)}
                                        >
                                            {item.completed
                                                ? <CheckCircle2 size={16} className="check-complete" />
                                                : <Circle size={16} className="check-pending" />
                                            }
                                            <span>{item.text}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    };

    // Render: Board View Column with Drag and Drop
    const renderBoardColumn = (status: 'pending' | 'in_progress' | 'completed', columnTasks: Task[]) => {
        const statusLabels: Record<string, { label: string; color: string }> = {
            pending: { label: 'Na čekanju', color: '#8E8E93' },
            in_progress: { label: 'U toku', color: '#007AFF' },
            completed: { label: 'Završeno', color: '#34C759' }
        };
        const { label, color } = statusLabels[status];

        return (
            <div className="board-column">
                <div className="column-header" style={{ borderBottom: `3px solid ${color}` }}>
                    <span className="column-title">{label}</span>
                    <span className="column-count">{columnTasks.length}</span>
                </div>

                <Droppable droppableId={status}>
                    {(provided, snapshot) => (
                        <div
                            className={`column-tasks ${snapshot.isDraggingOver ? 'drag-over' : ''}`}
                            ref={provided.innerRef}
                            {...provided.droppableProps}
                            style={{
                                minHeight: '100px',
                                background: snapshot.isDraggingOver ? 'rgba(0,0,0,0.02)' : 'transparent',
                                transition: 'background 0.2s ease'
                            }}
                        >
                            {columnTasks.map((task, index) => renderBoardTaskCard(task, index))}
                            {provided.placeholder}

                            {columnTasks.length === 0 && !snapshot.isDraggingOver && (
                                <div className="column-empty">
                                    <span>Prevuci zadatak ovdje</span>
                                </div>
                            )}
                        </div>
                    )}
                </Droppable>
            </div>
        );
    };

    // Render: Draggable Task Card for Board
    const renderBoardTaskCard = (task: Task, index: number) => {
        const pColor = priorityColors[task.Priority];

        return (
            <Draggable key={task.Task_ID} draggableId={task.Task_ID} index={index}>
                {(provided, snapshot) => (
                    <div
                        ref={provided.innerRef}
                        {...provided.draggableProps}
                        {...provided.dragHandleProps}
                        className={`task-card board-card ${snapshot.isDragging ? 'dragging' : ''}`}
                        style={{
                            borderLeft: `4px solid ${pColor.border}`,
                            ...provided.draggableProps.style,
                            opacity: snapshot.isDragging ? 0.8 : 1,
                            transform: snapshot.isDragging ? `${provided.draggableProps.style?.transform} scale(1.02)` : provided.draggableProps.style?.transform
                        }}
                    >
                        <div className="task-card-header">
                            <div className="drag-handle">
                                <GripVertical size={16} />
                            </div>
                            <div className="task-card-content">
                                <h4 className="task-title">{task.Title}</h4>
                            </div>
                            <div className="task-card-actions">
                                <button className="icon-btn" onClick={() => handleEditTask(task)} title="Uredi">
                                    <Edit3 size={14} />
                                </button>
                            </div>
                        </div>
                        {/* Compact meta for board */}
                        <div className="task-card-meta compact">
                            <span
                                className="meta-chip priority"
                                style={{
                                    background: pColor.bg,
                                    color: pColor.text,
                                    border: `1px solid ${pColor.border}`
                                }}
                            >
                                {TASK_PRIORITY_LABELS[task.Priority]}
                            </span>
                            {task.Due_Date && (
                                <span className={`meta-chip due-date ${new Date(task.Due_Date) < new Date() ? 'overdue' : ''}`}>
                                    <Calendar size={12} />
                                    {new Date(task.Due_Date).toLocaleDateString('hr-HR', { day: 'numeric', month: 'short' })}
                                </span>
                            )}
                        </div>
                        {/* Entity links preview */}
                        {task.Links && task.Links.length > 0 && (
                            <div className="task-card-links compact">
                                {task.Links.slice(0, 2).map((link, idx) => (
                                    <span key={idx} className={`entity-chip ${link.Entity_Type}`}>
                                        {link.Entity_Type === 'project' && <FolderOpen size={10} />}
                                        {link.Entity_Type === 'product' && <Package size={10} />}
                                        {link.Entity_Type === 'worker' && <User size={10} />}
                                        {link.Entity_Name.length > 12 ? link.Entity_Name.slice(0, 12) + '...' : link.Entity_Name}
                                    </span>
                                ))}
                                {task.Links.length > 2 && (
                                    <span className="entity-chip more">+{task.Links.length - 2}</span>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </Draggable>
        );
    };

    // Render: Grid Card - Apple-style minimalist design
    const renderGridCard = (task: Task) => {
        const pColor = priorityColors[task.Priority];
        const isOverdue = task.Due_Date && task.Status !== 'completed' && new Date(task.Due_Date) < new Date();
        const isExpanded = expandedTasks.has(task.Task_ID);
        const isMenuOpen = activeCardMenu === task.Task_ID;
        const completedCount = task.Checklist?.filter(c => c.completed).length || 0;
        const totalCount = task.Checklist?.length || 0;

        return (
            <div
                key={task.Task_ID}
                className={`task-card grid-card ${task.Status === 'completed' ? 'completed' : ''} ${isExpanded ? 'expanded' : ''}`}
            >
                {/* Top row: status + title + menu */}
                <div className="grid-card-header" onClick={() => toggleTaskExpansion(task.Task_ID)}>
                    <button
                        className="grid-status-toggle"
                        onClick={(e) => {
                            e.stopPropagation();
                            handleStatusChange(
                                task.Task_ID,
                                task.Status === 'completed' ? 'pending' : 'completed'
                            );
                        }}
                        title={task.Status === 'completed' ? 'Označi kao nezavršeno' : 'Označi kao završeno'}
                    >
                        {task.Status === 'completed'
                            ? <CheckCircle2 size={18} className="check-complete" />
                            : <Circle size={18} className="check-pending" />
                        }
                    </button>
                    <span className="grid-priority-dot" style={{ background: pColor.border }} />
                    <h4 className="grid-card-title">{task.Title}</h4>

                    {/* ⋯ Menu */}
                    <div className="grid-card-menu-wrapper" ref={isMenuOpen ? cardMenuRef : undefined}>
                        <button
                            className="grid-menu-btn"
                            onClick={(e) => {
                                e.stopPropagation();
                                setActiveCardMenu(isMenuOpen ? null : task.Task_ID);
                            }}
                        >
                            <MoreHorizontal size={16} />
                        </button>
                        {isMenuOpen && (
                            <div className="grid-card-dropdown">
                                <button onClick={(e) => { e.stopPropagation(); handleEditTask(task); setActiveCardMenu(null); }}>
                                    <Edit3 size={14} />
                                    Uredi
                                </button>
                                <button onClick={(e) => { e.stopPropagation(); setPrintingTask(task); setActiveCardMenu(null); }}>
                                    <Printer size={14} />
                                    Printaj
                                </button>
                                <button className="danger" onClick={(e) => { e.stopPropagation(); handleDeleteTask(task.Task_ID); setActiveCardMenu(null); }}>
                                    <Trash2 size={14} />
                                    Obriši
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Description (collapsed: 2 lines, expanded: full) */}
                {task.Description && (
                    <p
                        className="grid-card-desc"
                        style={isExpanded ? { WebkitLineClamp: 'unset', display: 'block' } : {}}
                        onClick={() => toggleTaskExpansion(task.Task_ID)}
                    >
                        {task.Description}
                    </p>
                )}

                {/* Subtle meta line */}
                {!isExpanded && (
                    <div className="grid-card-meta">
                        {task.Due_Date && (
                            <span className={`grid-meta-item ${isOverdue ? 'overdue' : ''}`}>
                                {new Date(task.Due_Date).toLocaleDateString('hr-HR', {
                                    day: 'numeric',
                                    month: 'short'
                                })}
                            </span>
                        )}
                        {totalCount > 0 && (
                            <span className="grid-meta-item">
                                {completedCount}/{totalCount} ✓
                            </span>
                        )}
                        {task.Assigned_Worker_Name && (
                            <span className="grid-meta-item worker">
                                {task.Assigned_Worker_Name}
                            </span>
                        )}
                    </div>
                )}

                {/* EXPANDED CONTENT */}
                {isExpanded && (
                    <div className="grid-expanded-content" onClick={(e) => e.stopPropagation()}>
                        {/* Checklist */}
                        {task.Checklist && task.Checklist.length > 0 && (
                            <div className="grid-exp-section">
                                <div className="grid-exp-section-header">
                                    <span className="grid-exp-label">Checklist</span>
                                    <span className="grid-exp-count">{completedCount}/{totalCount}</span>
                                </div>
                                <div className="grid-exp-checklist">
                                    {task.Checklist.map(item => (
                                        <button
                                            key={item.id}
                                            className={`grid-check-item ${item.completed ? 'done' : ''}`}
                                            onClick={() => handleToggleChecklist(task.Task_ID, item.id)}
                                        >
                                            {item.completed
                                                ? <CheckCircle2 size={16} className="check-complete" />
                                                : <Circle size={16} className="check-pending" />
                                            }
                                            <span>{item.text}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Links */}
                        {task.Links && task.Links.length > 0 && (
                            <div className="grid-exp-section">
                                <span className="grid-exp-label">Poveznice</span>
                                <div className="grid-exp-links">
                                    {task.Links.map((link, idx) => (
                                        <span key={idx} className={`entity-chip ${link.Entity_Type}`}>
                                            {renderGroupIcon(link.Entity_Type)}
                                            {link.Entity_Name}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Notes */}
                        {task.Notes && (
                            <div className="grid-exp-section">
                                <span className="grid-exp-label">Bilješke</span>
                                <p className="grid-exp-notes">{task.Notes}</p>
                            </div>
                        )}

                        {/* Meta when expanded */}
                        <div className="grid-exp-meta">
                            <span className="grid-exp-meta-chip" style={{ background: pColor.bg, color: pColor.text }}>
                                {TASK_PRIORITY_LABELS[task.Priority]}
                            </span>
                            <span className="grid-exp-meta-chip">
                                {categoryIcons[task.Category]}
                                {TASK_CATEGORY_LABELS[task.Category]}
                            </span>
                            {task.Due_Date && (
                                <span className={`grid-exp-meta-chip ${isOverdue ? 'overdue' : ''}`}>
                                    <Calendar size={12} />
                                    {new Date(task.Due_Date).toLocaleDateString('hr-HR', { day: 'numeric', month: 'short' })}
                                </span>
                            )}
                            {task.Assigned_Worker_Name && (
                                <span className="grid-exp-meta-chip">
                                    <User size={12} />
                                    {task.Assigned_Worker_Name}
                                </span>
                            )}
                        </div>
                    </div>
                )}
            </div>
        );
    };

    // Render: Group Icon based on group type
    const renderGroupIcon = (iconClass: string) => {
        switch (iconClass) {
            case 'urgent': return <AlertTriangle size={16} />;
            case 'high': return <Flag size={16} />;
            case 'medium': return <Flag size={16} />;
            case 'low': return <Flag size={16} />;
            case 'overdue': return <AlertTriangle size={16} />;
            case 'today': return <CalendarDays size={16} />;
            case 'week': return <Calendar size={16} />;
            case 'later': return <Clock size={16} />;
            case 'no-date': return <Clock size={16} />;
            case 'worker': return <User size={16} />;
            case 'project': return <FolderOpen size={16} />;
            case 'product': return <Package size={16} />;
            case 'material': return <Layers size={16} />;
            case 'work_order': return <HardHat size={16} />;
            case 'order': return <ShoppingCart size={16} />;
            case 'category': return <Tag size={16} />;
            default: return <Tag size={16} />;
        }
    };

    return (
        <div className="tasks-container">
            {/* Header */}
            <div className="tasks-header">
                <div className="tasks-title-section">
                    <h2 className="tasks-title">
                        <CheckSquare size={28} color="#1D3557" />
                        Zadaci
                    </h2>
                    <div className="tasks-count-wrapper">
                        <span className="tasks-count">{filteredTasks.length} ukupno</span>
                        <button className="mobile-toggle-btn" onClick={toggleControls}>
                            {showControls ? <ChevronUp size={20} /> : <SlidersHorizontal size={20} />}
                        </button>
                    </div>
                </div>

                {/* Profile Selector */}
                <div className="profile-selector-wrapper" ref={profileDropdownRef}>
                    <button
                        className={`profile-selector-btn ${showProfileMenu ? 'active' : ''}`}
                        onClick={() => setShowProfileMenu(!showProfileMenu)}
                    >
                        <Users size={16} />
                        <span>
                            {selectedProfileId === '__all__' ? 'Svi zadaci' :
                                taskProfiles.find(p => p.Profile_ID === selectedProfileId)?.Name || 'Svi zadaci'}
                        </span>
                        <ChevronDown size={14} className={`chevron ${showProfileMenu ? 'rotated' : ''}`} />
                    </button>

                    {showProfileMenu && (
                        <div className="profile-dropdown">
                            <button
                                className={`profile-option ${selectedProfileId === '__all__' ? 'active' : ''}`}
                                onClick={() => { setSelectedProfileId('__all__'); setShowProfileMenu(false); }}
                            >
                                <CheckSquare size={14} />
                                <span>Svi zadaci</span>
                            </button>
                            {taskProfiles.length > 0 && <div className="profile-divider" />}
                            {taskProfiles.map(profile => (
                                <div key={profile.Profile_ID} className={`profile-option ${selectedProfileId === profile.Profile_ID ? 'active' : ''}`}>
                                    <button
                                        className="profile-option-main"
                                        onClick={() => { setSelectedProfileId(profile.Profile_ID); setShowProfileMenu(false); }}
                                    >
                                        <User size={14} />
                                        <span>{profile.Name}</span>
                                    </button>
                                    <button
                                        className="profile-delete-btn"
                                        onClick={(e) => { e.stopPropagation(); handleDeleteProfile(profile.Profile_ID); }}
                                        title="Obriši profil"
                                    >
                                        <Trash2 size={12} />
                                    </button>
                                </div>
                            ))}
                            <div className="profile-divider" />
                            {isCreatingProfile ? (
                                <div className="profile-create-form">
                                    <input
                                        type="text"
                                        placeholder="Ime profila..."
                                        value={newProfileName}
                                        onChange={(e) => setNewProfileName(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === 'Enter') handleCreateProfile(); if (e.key === 'Escape') setIsCreatingProfile(false); }}
                                        autoFocus
                                    />
                                    <button className="profile-create-confirm" onClick={handleCreateProfile}>
                                        <Check size={14} />
                                    </button>
                                    <button className="profile-create-cancel" onClick={() => { setIsCreatingProfile(false); setNewProfileName(''); }}>
                                        <X size={14} />
                                    </button>
                                </div>
                            ) : (
                                <button className="profile-add-btn" onClick={() => setIsCreatingProfile(true)}>
                                    <UserPlus size={14} />
                                    <span>Novi profil</span>
                                </button>
                            )}
                        </div>
                    )}
                </div>

                <button className="btn-primary-tasks" onClick={handleCreateTask}>
                    <Plus size={18} />
                    Novi zadatak
                </button>
            </div>

            {/* Project Filter Banner */}
            {projectFilter && (
                <div className="project-filter-banner">
                    <FolderOpen size={16} />
                    <span>
                        Prikazani zadaci za projekat: <strong>{projects.find(p => p.Project_ID === projectFilter)?.Client_Name || 'Nepoznat'}</strong>
                    </span>
                    {onClearFilter && (
                        <button onClick={onClearFilter} className="clear-filter-btn">
                            <X size={14} />
                            Prikaži sve
                        </button>
                    )}
                </div>
            )}

            {/* Simplified Toolbar - Search + Options Toggle */}
            <div className={`tasks-controls-wrapper ${showControls ? 'open' : 'closed'}`}>

                {/* Compact Search */}
                <div className="tasks-search-compact">
                    <Search size={14} />
                    <input
                        type="text"
                        placeholder="Pretraži..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                    {searchQuery && (
                        <button className="clear-search" onClick={() => setSearchQuery('')}>
                            <X size={12} />
                        </button>
                    )}
                </div>

                {/* Options Toggle Button */}
                <button
                    className={`options-toggle ${showFilters ? 'active' : ''}`}
                    onClick={() => setShowFilters(!showFilters)}
                >
                    <SlidersHorizontal size={16} />
                    <span>Opcije</span>
                    {(filterStatus !== 'all' || filterPriority !== 'all' || filterCategory !== 'all' || showCompleted) && (
                        <span className="options-badge">
                            {[filterStatus, filterPriority, filterCategory].filter(f => f !== 'all').length + (showCompleted ? 1 : 0)}
                        </span>
                    )}
                    <ChevronDown size={14} className={`chevron ${showFilters ? 'rotated' : ''}`} />
                </button>
            </div>

            {/* Unified Options Panel */}
            {showFilters && (
                <div className="tasks-options-panel">
                    {/* Row 1: View Mode + Group By + Show Completed */}
                    <div className="options-row">
                        {/* View Mode */}
                        <div className="option-group">
                            <label>Prikaz</label>
                            <div className="view-toggle">
                                <button
                                    className={viewMode === 'grid' ? 'active' : ''}
                                    onClick={() => setViewMode('grid')}
                                    title="Grid"
                                >
                                    <Grid3X3 size={18} />
                                </button>
                                <button
                                    className={viewMode === 'calendar' ? 'active' : ''}
                                    onClick={() => setViewMode('calendar')}
                                    title="Kalendar"
                                >
                                    <CalendarDays size={18} />
                                </button>
                                <button
                                    className={viewMode === 'board' ? 'active' : ''}
                                    onClick={() => setViewMode('board')}
                                    title="Kanban"
                                >
                                    <Layers size={18} />
                                </button>
                            </div>
                        </div>

                        {/* Group By (Grid only) */}
                        {viewMode === 'grid' && (
                            <div className="option-group">
                                <label>Grupiraj</label>
                                <select
                                    value={groupBy}
                                    onChange={(e) => setGroupBy(e.target.value as GroupBy)}
                                >
                                    {Object.entries(GROUP_BY_LABELS).map(([key, label]) => (
                                        <option key={key} value={key}>{label}</option>
                                    ))}
                                </select>
                            </div>
                        )}

                        {/* Show Completed */}
                        <button
                            className={`completed-toggle ${showCompleted ? 'active' : ''}`}
                            onClick={() => setShowCompleted(!showCompleted)}
                        >
                            <CheckCircle2 size={16} />
                            <span>{showCompleted ? 'Sakrij završene' : 'Prikaži završene'}</span>
                        </button>
                    </div>

                    {/* Row 2: Filters - Structured & Clear */}
                    <div className="options-row filters-row">
                        <div className="filters-grid">
                            {/* Status Filter */}
                            <div className="filter-column">
                                <h4 className="filter-label">Status</h4>
                                <div className="filter-chips">
                                    {(['all', 'pending', 'in_progress', 'completed'] as const).map(status => (
                                        <button
                                            key={status}
                                            className={`filter-chip ${filterStatus === status ? 'active' : ''}`}
                                            onClick={() => setFilterStatus(status)}
                                        >
                                            {status === 'all' ? 'Svi' : TASK_STATUS_LABELS[status]}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Priority Filter */}
                            <div className="filter-column">
                                <h4 className="filter-label">Prioritet</h4>
                                <div className="filter-chips">
                                    <button
                                        className={`filter-chip ${filterPriority === 'all' ? 'active' : ''}`}
                                        onClick={() => setFilterPriority('all')}
                                    >
                                        Svi
                                    </button>
                                    {TASK_PRIORITIES.map(priority => (
                                        <button
                                            key={priority}
                                            className={`filter-chip priority-${priority} ${filterPriority === priority ? 'active' : ''}`}
                                            onClick={() => setFilterPriority(priority)}
                                        >
                                            {TASK_PRIORITY_LABELS[priority]}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Category Filter */}
                            <div className="filter-column">
                                <h4 className="filter-label">Kategorija</h4>
                                <div className="filter-chips">
                                    <button
                                        className={`filter-chip ${filterCategory === 'all' ? 'active' : ''}`}
                                        onClick={() => setFilterCategory('all')}
                                    >
                                        Sve
                                    </button>
                                    {TASK_CATEGORIES.map(category => (
                                        <button
                                            key={category}
                                            className={`filter-chip ${filterCategory === category ? 'active' : ''}`}
                                            onClick={() => setFilterCategory(category)}
                                        >
                                            {categoryIcons[category]}
                                            {TASK_CATEGORY_LABELS[category]}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Clear Filters - Bottom Action */}
                        {(filterStatus !== 'all' || filterPriority !== 'all' || filterCategory !== 'all') && (
                            <div className="filter-actions">
                                <button
                                    className="clear-filters-btn"
                                    onClick={() => {
                                        setFilterStatus('all');
                                        setFilterPriority('all');
                                        setFilterCategory('all');
                                    }}
                                >
                                    <X size={14} />
                                    Očisti filtere
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Content */}
            <div className="tasks-content">
                {viewMode === 'grid' ? (
                    // Grid View with Grouping
                    <div className="tasks-grouped">
                        {filteredTasks.length === 0 ? (
                            <div className="tasks-empty">
                                <CheckSquare size={48} strokeWidth={1.5} />
                                <h3>Nema zadataka</h3>
                                <p>Kreirajte novi zadatak klikom na dugme iznad</p>
                            </div>
                        ) : (
                            groupedTasks.map(group => (
                                <div key={group.key} className="task-group">
                                    <div className={`task-group-header ${group.iconClass}`}>
                                        <div className={`task-group-icon ${group.iconClass}`}>
                                            {renderGroupIcon(group.iconClass)}
                                        </div>
                                        <h3 className="task-group-title">{group.label}</h3>
                                    </div>
                                    <div className="task-group-content">
                                        {group.tasks.map(renderGridCard)}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                ) : viewMode === 'calendar' ? (() => {
                    // Calendar View - uses calendarDate from component state
                    const today = new Date();
                    const year = calendarDate.getFullYear();
                    const month = calendarDate.getMonth();

                    // Get first day of month and number of days
                    const firstDayOfMonth = new Date(year, month, 1);
                    const lastDayOfMonth = new Date(year, month + 1, 0);
                    const daysInMonth = lastDayOfMonth.getDate();
                    const startingDayOfWeek = firstDayOfMonth.getDay(); // 0 = Sunday

                    // Adjust for Monday start (European style)
                    const adjustedStartDay = startingDayOfWeek === 0 ? 6 : startingDayOfWeek - 1;

                    // Generate calendar days array
                    const calendarDays: (number | null)[] = [];
                    for (let i = 0; i < adjustedStartDay; i++) {
                        calendarDays.push(null); // Empty cells before first day
                    }
                    for (let day = 1; day <= daysInMonth; day++) {
                        calendarDays.push(day);
                    }

                    const getTasksForDay = (day: number) => {
                        const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                        return tasksByDate.get(dateKey) || [];
                    };

                    const isToday = (day: number) => {
                        return today.getDate() === day &&
                            today.getMonth() === month &&
                            today.getFullYear() === year;
                    };

                    const monthNames = ['Januar', 'Februar', 'Mart', 'April', 'Maj', 'Juni',
                        'Juli', 'August', 'Septembar', 'Oktobar', 'Novembar', 'Decembar'];
                    const dayNames = ['Pon', 'Uto', 'Sri', 'Čet', 'Pet', 'Sub', 'Ned'];

                    return (
                        <div className="tasks-calendar">
                            {/* Calendar Header */}
                            <div className="calendar-header">
                                <button
                                    className="calendar-nav-btn"
                                    onClick={() => setCalendarDate(new Date(year, month - 1, 1))}
                                >
                                    <ChevronUp size={20} style={{ transform: 'rotate(-90deg)' }} />
                                </button>
                                <h3 className="calendar-title">
                                    {monthNames[month]} {year}
                                </h3>
                                <button
                                    className="calendar-nav-btn"
                                    onClick={() => setCalendarDate(new Date(year, month + 1, 1))}
                                >
                                    <ChevronUp size={20} style={{ transform: 'rotate(90deg)' }} />
                                </button>
                                <button
                                    className="calendar-today-btn"
                                    onClick={() => setCalendarDate(new Date())}
                                >
                                    Danas
                                </button>
                            </div>

                            {/* Day Headers */}
                            <div className="calendar-day-headers">
                                {dayNames.map(day => (
                                    <div key={day} className="calendar-day-header">{day}</div>
                                ))}
                            </div>

                            {/* Calendar Grid */}
                            <div className="calendar-grid">
                                {calendarDays.map((day, index) => {
                                    if (day === null) {
                                        return <div key={`empty-${index}`} className="calendar-day empty" />;
                                    }

                                    const dayTasks = getTasksForDay(day);
                                    const isPast = new Date(year, month, day) < new Date(today.getFullYear(), today.getMonth(), today.getDate());
                                    const hasOverdue = dayTasks.some(t => t.Status !== 'completed' && isPast);

                                    return (
                                        <div
                                            key={day}
                                            className={`calendar-day ${isToday(day) ? 'today' : ''} ${hasOverdue ? 'has-overdue' : ''} ${dayTasks.length > 0 ? 'has-tasks' : ''}`}
                                        >
                                            <span className="day-number">{day}</span>
                                            <div className="day-tasks">
                                                {dayTasks.slice(0, 3).map(task => (
                                                    <button
                                                        key={task.Task_ID}
                                                        className={`calendar-task priority-${task.Priority} ${task.Status === 'completed' ? 'completed' : ''}`}
                                                        onClick={() => setPreviewTask(task)}
                                                        title={task.Title}
                                                    >
                                                        <span className="task-dot" style={{ background: priorityColors[task.Priority].icon }} />
                                                        <span className="task-text">{task.Title}</span>
                                                    </button>
                                                ))}
                                                {dayTasks.length > 3 && (
                                                    <button
                                                        className="more-tasks"
                                                        onClick={() => setDayTasksPopup({ day, tasks: dayTasks })}
                                                    >
                                                        +{dayTasks.length - 3} više
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Tasks without due date */}
                            {filteredTasks.filter(t => !t.Due_Date).length > 0 && (
                                <div className="calendar-no-date">
                                    <h4>
                                        <Clock size={16} />
                                        Bez roka ({filteredTasks.filter(t => !t.Due_Date).length})
                                    </h4>
                                    <div className="no-date-tasks">
                                        {filteredTasks.filter(t => !t.Due_Date).slice(0, 5).map(task => (
                                            <button
                                                key={task.Task_ID}
                                                className={`calendar-task priority-${task.Priority}`}
                                                onClick={() => handleEditTask(task)}
                                            >
                                                <span className="task-dot" style={{ background: priorityColors[task.Priority].icon }} />
                                                <span className="task-text">{task.Title}</span>
                                            </button>
                                        ))}
                                        {filteredTasks.filter(t => !t.Due_Date).length > 5 && (
                                            <span className="more-tasks">+{filteredTasks.filter(t => !t.Due_Date).length - 5} više</span>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })() : (
                    // Board View
                    <DragDropContext onDragEnd={onDragEnd}>
                        <div className="tasks-board">
                            {renderBoardColumn('pending', tasksByStatus.pending)}
                            {renderBoardColumn('in_progress', tasksByStatus.in_progress)}
                            {renderBoardColumn('completed', tasksByStatus.completed)}
                        </div>
                    </DragDropContext>
                )}
            </div>

            {/* Task Modal */}
            {isModalOpen && (
                <TaskModal
                    task={editingTask}
                    projects={projects}
                    products={allProducts}
                    workers={workers}
                    materials={materials}
                    workOrders={workOrders}
                    orders={orders}
                    onSave={handleSaveTask}
                    onClose={() => setIsModalOpen(false)}
                />
            )}

            {/* Task Preview Modal - Premium */}
            {previewTask && (
                <div className="task-preview-overlay" onClick={() => setPreviewTask(null)}>
                    <div className="task-preview-modal premium" onClick={e => e.stopPropagation()}>
                        {/* Header with gradient */}
                        <div className={`preview-header-premium priority-${previewTask.Priority}`}>
                            <div className="preview-header-content">
                                <div className="preview-badge-row">
                                    <span className={`priority-badge priority-${previewTask.Priority}`}>
                                        <Flag size={12} />
                                        {previewTask.Priority === 'high' ? 'Hitno' : previewTask.Priority === 'medium' ? 'Srednje' : 'Nisko'}
                                    </span>
                                    <span className={`status-badge-pill ${previewTask.Status}`}>
                                        {previewTask.Status === 'pending' ? 'Na čekanju' :
                                            previewTask.Status === 'in_progress' ? 'U tijeku' : 'Završeno'}
                                    </span>
                                </div>
                                <button className="preview-close-btn" onClick={() => setPreviewTask(null)}>
                                    <X size={20} />
                                </button>
                            </div>
                            <h2 className="preview-title-premium">{previewTask.Title}</h2>
                            {previewTask.Due_Date && (
                                <div className="preview-date">
                                    <Calendar size={14} />
                                    <span>{new Date(previewTask.Due_Date).toLocaleDateString('hr-HR', {
                                        weekday: 'long', day: 'numeric', month: 'long'
                                    })}</span>
                                </div>
                            )}
                        </div>

                        {/* Content */}
                        <div className="preview-content-premium">
                            {previewTask.Description && (
                                <div className="preview-description">
                                    <p>{previewTask.Description}</p>
                                </div>
                            )}

                            {/* Interactive Checklist */}
                            {previewTask.Checklist && previewTask.Checklist.length > 0 && (
                                <div className="preview-checklist-section">
                                    <div className="checklist-header">
                                        <span className="checklist-title">
                                            <ListChecks size={16} />
                                            Checklist
                                        </span>
                                        <span className="checklist-progress">
                                            {previewTask.Checklist.filter(i => i.completed).length}/{previewTask.Checklist.length}
                                        </span>
                                    </div>
                                    <div className="checklist-progress-bar">
                                        <div
                                            className="progress-fill"
                                            style={{
                                                width: `${(previewTask.Checklist.filter(i => i.completed).length / previewTask.Checklist.length) * 100}%`
                                            }}
                                        />
                                    </div>
                                    <div className="checklist-items-preview">
                                        {previewTask.Checklist.map(item => (
                                            <button
                                                key={item.id}
                                                className={`checklist-item-btn ${item.completed ? 'done' : ''}`}
                                                onClick={async () => {
                                                    // Toggle checklist item
                                                    await handleToggleChecklist(previewTask.Task_ID, item.id);
                                                    // Update local preview state
                                                    const updatedChecklist = previewTask.Checklist?.map(i =>
                                                        i.id === item.id ? { ...i, completed: !i.completed } : i
                                                    ) || [];
                                                    const updatedTask = { ...previewTask, Checklist: updatedChecklist };
                                                    setPreviewTask(updatedTask);

                                                    // Auto-complete if all items done
                                                    if (updatedChecklist.every(i => i.completed) && previewTask.Status !== 'completed') {
                                                        await handleStatusChange(previewTask.Task_ID, 'completed');
                                                        setPreviewTask({ ...updatedTask, Status: 'completed' });
                                                        showToast('Zadatak automatski označen kao završen', 'success');
                                                    }
                                                }}
                                            >
                                                <span className="check-icon">
                                                    {item.completed ? <CheckCircle2 size={18} /> : <Circle size={18} />}
                                                </span>
                                                <span className="check-text">{item.text}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Footer Actions */}
                        <div className="preview-footer-premium">
                            {previewTask.Status !== 'completed' ? (
                                <button
                                    className="preview-action-btn complete"
                                    onClick={async () => {
                                        await handleStatusChange(previewTask.Task_ID, 'completed');
                                        setPreviewTask({ ...previewTask, Status: 'completed' });
                                        showToast('Zadatak označen kao završen', 'success');
                                    }}
                                >
                                    <CheckCircle2 size={18} />
                                    Završi zadatak
                                </button>
                            ) : (
                                <button
                                    className="preview-action-btn reopen"
                                    onClick={async () => {
                                        await handleStatusChange(previewTask.Task_ID, 'pending');
                                        setPreviewTask({ ...previewTask, Status: 'pending' });
                                    }}
                                >
                                    <Circle size={18} />
                                    Ponovno otvori
                                </button>
                            )}
                            <button
                                className="preview-action-btn edit"
                                onClick={() => {
                                    setPreviewTask(null);
                                    handleEditTask(previewTask);
                                }}
                            >
                                <Edit3 size={18} />
                                Uredi
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Day Tasks Popup */}
            {dayTasksPopup && (
                <div className="day-popup-overlay" onClick={() => setDayTasksPopup(null)}>
                    <div className="day-popup-modal" onClick={e => e.stopPropagation()}>
                        <div className="day-popup-header">
                            <h3>{dayTasksPopup.day}. {new Intl.DateTimeFormat('hr-HR', { month: 'long' }).format(calendarDate)}</h3>
                            <button className="day-popup-close" onClick={() => setDayTasksPopup(null)}>
                                <X size={20} />
                            </button>
                        </div>
                        <div className="day-popup-list">
                            {dayTasksPopup.tasks.map(task => (
                                <button
                                    key={task.Task_ID}
                                    className={`day-popup-task ${task.Status === 'completed' ? 'completed' : ''}`}
                                    onClick={() => {
                                        setDayTasksPopup(null);
                                        setPreviewTask(task);
                                    }}
                                >
                                    <span className="task-dot" style={{ background: priorityColors[task.Priority].icon }} />
                                    <span className="task-title">{task.Title}</span>
                                    <span className={`task-status ${task.Status}`}>
                                        {task.Status === 'completed' ? <CheckCircle2 size={14} /> :
                                            task.Status === 'in_progress' ? <Clock size={14} /> : null}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Print Modal */}
            {printingTask && (
                <>
                    <div className="task-print-overlay" onClick={() => setPrintingTask(null)}>
                        <div className="task-print-modal" onClick={e => e.stopPropagation()}>
                            <div className="print-modal-header">
                                <h3>Pregled prije printanja</h3>
                                <div className="print-header-actions">
                                    <button className="btn-print" onClick={() => window.print()}>
                                        <Printer size={16} />
                                        Printaj
                                    </button>
                                    <button className="btn-close-print" onClick={() => setPrintingTask(null)}>
                                        <X size={20} />
                                    </button>
                                </div>
                            </div>
                            <div className="print-preview-area">
                                <TaskPrintView task={printingTask} />
                            </div>
                        </div>
                    </div>
                    {/* Hidden print document — only visible during @media print */}
                    <div className="print-document task-print-document">
                        <TaskPrintView task={printingTask} />
                    </div>
                </>
            )}
        </div>
    );
}

// ============================================
// TASK MODAL COMPONENT
// ============================================

interface TaskModalProps {
    task: Task | null;
    projects: Project[];
    products: Product[];
    workers: Worker[];
    materials: Material[];
    workOrders: WorkOrder[];
    orders: Order[];
    onSave: (task: Partial<Task>) => void;
    onClose: () => void;
}

function TaskModal({ task, projects, products, workers, materials, workOrders, orders, onSave, onClose }: TaskModalProps) {
    const isEdit = !!task;
    const [activeTab, setActiveTab] = useState<'details' | 'links' | 'checklist'>('details');

    // Form state
    const [title, setTitle] = useState(task?.Title || '');
    const [description, setDescription] = useState(task?.Description || '');
    const [priority, setPriority] = useState<TaskPriority>(task?.Priority || 'medium');
    const [category, setCategory] = useState<TaskCategory>(task?.Category || 'general');
    const [dueDate, setDueDate] = useState(task?.Due_Date ? task.Due_Date.split('T')[0] : '');
    const [assignedWorker, setAssignedWorker] = useState(task?.Assigned_Worker_ID || '');
    const [links, setLinks] = useState<TaskLink[]>(task?.Links || []);
    const [checklist, setChecklist] = useState<ChecklistItem[]>(task?.Checklist || []);
    const [notes, setNotes] = useState(task?.Notes || '');
    const [voiceTranscript, setVoiceTranscript] = useState('');

    // Handle voice input result
    const handleVoiceResult = (data: ExtractedTaskData) => {
        // Apply extracted data to form fields
        if (data.title) setTitle(data.title);
        if (data.description) setDescription(data.description);
        if (data.priority) setPriority(data.priority);
        if (data.category) setCategory(data.category);
        if (data.suggestedDueDate) setDueDate(data.suggestedDueDate);

        // Add checklist items
        if (data.checklist && data.checklist.length > 0) {
            const newChecklist = data.checklist.map(text => ({
                id: generateUUID(),
                text,
                completed: false
            }));
            setChecklist(prev => [...prev, ...newChecklist]);
        }

        // Try to match suggested worker
        if (data.suggestedWorker) {
            const matchedWorker = workers.find(w =>
                w.Name.toLowerCase().includes(data.suggestedWorker!.toLowerCase())
            );
            if (matchedWorker) setAssignedWorker(matchedWorker.Worker_ID);
        }

        // Try to match suggested project and add as link
        if (data.suggestedProject) {
            const matchedProject = projects.find(p =>
                p.Client_Name.toLowerCase().includes(data.suggestedProject!.toLowerCase())
            );
            if (matchedProject && !links.some(l => l.Entity_ID === matchedProject.Project_ID)) {
                setLinks(prev => [...prev, {
                    Entity_Type: 'project',
                    Entity_ID: matchedProject.Project_ID,
                    Entity_Name: matchedProject.Client_Name
                }]);
            }
        }
    };

    const handleVoiceError = (error: string) => {
        console.warn('Voice input error:', error);
    };

    // Entity link state
    const [linkType, setLinkType] = useState<TaskLink['Entity_Type']>('project');
    const [linkSearch, setLinkSearch] = useState('');

    // New checklist item
    const [newChecklistItem, setNewChecklistItem] = useState('');

    // Available entities based on selected type
    const getAvailableEntities = () => {
        switch (linkType) {
            case 'project': return projects.map(p => ({ id: p.Project_ID, name: p.Client_Name, info: p.Status }));
            case 'product': return products.map(p => ({ id: p.Product_ID, name: p.Name, info: p.Status }));
            case 'material': return materials.map(m => ({ id: m.Material_ID, name: m.Name, info: m.Unit }));
            case 'worker': return workers.map(w => ({ id: w.Worker_ID, name: w.Name, info: w.Role }));
            case 'work_order': return workOrders.map(wo => ({ id: wo.Work_Order_ID, name: wo.Work_Order_Number, info: wo.Status }));
            case 'order': return orders.map(o => ({ id: o.Order_ID, name: o.Order_Number, info: o.Status }));
            default: return [];
        }
    };

    const filteredEntities = getAvailableEntities().filter(e =>
        e.name.toLowerCase().includes(linkSearch.toLowerCase()) &&
        !links.some(l => l.Entity_ID === e.id && l.Entity_Type === linkType)
    );

    const addLink = (entityId: string, entityName: string) => {
        setLinks([...links, { Entity_Type: linkType, Entity_ID: entityId, Entity_Name: entityName }]);
        setLinkSearch('');
    };

    const removeLink = (index: number) => {
        setLinks(links.filter((_, i) => i !== index));
    };

    const addChecklistItem = () => {
        if (!newChecklistItem.trim()) return;
        setChecklist([...checklist, {
            id: generateUUID(),
            text: newChecklistItem.trim(),
            completed: false
        }]);
        setNewChecklistItem('');
    };

    const removeChecklistItem = (id: string) => {
        setChecklist(checklist.filter(c => c.id !== id));
    };

    const toggleChecklistItemInModal = (id: string) => {
        setChecklist(checklist.map(c =>
            c.id === id ? { ...c, completed: !c.completed } : c
        ));
    };

    const handleSubmit = () => {
        if (!title.trim()) {
            alert('Unesite naslov zadatka');
            return;
        }

        const worker = workers.find(w => w.Worker_ID === assignedWorker);

        onSave({
            Task_ID: task?.Task_ID,
            Title: title.trim(),
            Description: description.trim(),
            Priority: priority,
            Category: category,
            Status: task?.Status || 'pending',
            Due_Date: dueDate ? new Date(dueDate).toISOString() : undefined,
            Assigned_Worker_ID: assignedWorker || undefined,
            Assigned_Worker_Name: worker?.Name,
            Links: links,
            Checklist: checklist.map(item => ({ ...item })), // Ensure clean copy
            Notes: notes.trim() || undefined,
            Created_Date: task?.Created_Date
        });
    };

    return (
        <div className="task-modal-overlay" onClick={onClose}>
            <div className="task-modal redesigned" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="task-modal-header">
                    <div className="header-title">
                        <CheckSquare size={20} className="text-primary" />
                        <h3>{isEdit ? 'Uredi zadatak' : 'Novi zadatak'}</h3>
                    </div>
                    <div className="header-actions">

                        <button className="close-btn" onClick={onClose}>
                            <X size={20} />
                        </button>
                    </div>
                </div>

                {/* Main Content */}
                <div className="task-modal-content">

                    {/* Title Input - Always Visible */}
                    <div className="title-section">
                        <input
                            type="text"
                            value={title}
                            onChange={e => setTitle(e.target.value)}
                            placeholder="Šta treba uraditi?"
                            autoFocus
                            className="task-title-input"
                        />
                    </div>

                    {/* Meta Bar - Always Visible */}
                    <div className="meta-bar">
                        <div className="meta-item">
                            <span className="meta-label">Prioritet</span>
                            <div className="priority-dots">
                                {TASK_PRIORITIES.map(p => (
                                    <button
                                        key={p}
                                        type="button"
                                        className={`priority-dot ${priority === p ? 'active' : ''}`}
                                        onClick={() => setPriority(p)}
                                        title={TASK_PRIORITY_LABELS[p]}
                                        style={{ backgroundColor: priority === p ? priorityColors[p].icon : '#e2e8f0' }}
                                    />
                                ))}
                                <span className="selected-priority">{TASK_PRIORITY_LABELS[priority]}</span>
                            </div>
                        </div>

                        <div className="meta-item">
                            <span className="meta-label">Kategorija</span>
                            <div className="meta-input-wrapper">
                                <select
                                    value={category}
                                    onChange={e => setCategory(e.target.value as TaskCategory)}
                                    className="meta-select"
                                >
                                    {TASK_CATEGORIES.map(c => (
                                        <option key={c} value={c}>{TASK_CATEGORY_LABELS[c]}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="meta-item">
                            <span className="meta-label">Rok</span>
                            <div className="meta-input-wrapper">
                                <input
                                    type="date"
                                    value={dueDate}
                                    onChange={e => setDueDate(e.target.value)}
                                    className="meta-date-input"
                                />
                            </div>
                        </div>

                        {/* Worker field removed as per user request */}
                    </div>

                    {/* Tabs Navigation */}
                    <div className="modal-tabs">
                        <button
                            className={`tab-btn ${activeTab === 'details' ? 'active' : ''}`}
                            onClick={() => setActiveTab('details')}
                        >
                            Detalji
                        </button>
                        <button
                            className={`tab-btn ${activeTab === 'links' ? 'active' : ''}`}
                            onClick={() => setActiveTab('links')}
                        >
                            Poveznice ({links.length})
                        </button>
                        <button
                            className={`tab-btn ${activeTab === 'checklist' ? 'active' : ''}`}
                            onClick={() => setActiveTab('checklist')}
                        >
                            Checklist ({checklist.length})
                        </button>
                    </div>

                    {/* Tab Content */}
                    <div className="modal-tab-content">

                        {/* DETAILS TAB */}
                        {activeTab === 'details' && (
                            <div className="modal-details-tab">
                                <div className="form-group">
                                    <label>Opis zadatka</label>
                                    <textarea
                                        value={description}
                                        onChange={e => setDescription(e.target.value)}
                                        placeholder="Unesite detaljan opis..."
                                        rows={6}
                                        className="description-input"
                                    />
                                </div>
                                <div className="form-group">
                                    <label>Interne napomene</label>
                                    <textarea
                                        value={notes}
                                        onChange={e => setNotes(e.target.value)}
                                        placeholder="Dodatne napomene za tim..."
                                        rows={3}
                                        className="notes-input"
                                    />
                                </div>
                            </div>
                        )}

                        {/* LINKS TAB */}
                        {activeTab === 'links' && (
                            <div className="modal-links-tab">
                                {/* Link Type Tabs */}
                                <div className="link-type-tabs">
                                    <button className={linkType === 'project' ? 'active' : ''} onClick={() => setLinkType('project')}>Projekti</button>
                                    <button className={linkType === 'product' ? 'active' : ''} onClick={() => setLinkType('product')}>Proizvodi</button>
                                    <button className={linkType === 'material' ? 'active' : ''} onClick={() => setLinkType('material')}>Materijali</button>
                                    <button className={linkType === 'worker' ? 'active' : ''} onClick={() => setLinkType('worker')}>Radnici</button>
                                    <button className={linkType === 'order' ? 'active' : ''} onClick={() => setLinkType('order')}>Narudžbe</button>
                                </div>

                                {/* Search & Results */}
                                <div className="link-search-area">
                                    <div className="search-input-wrapper">
                                        <Search size={16} />
                                        <input
                                            type="text"
                                            value={linkSearch}
                                            onChange={e => setLinkSearch(e.target.value)}
                                            placeholder={`Pretraži ${linkType === 'project' ? 'projekte' : linkType === 'product' ? 'proizvode' : '...'}`}
                                            className="link-search-input"
                                            autoFocus
                                        />
                                    </div>

                                    <div className="link-results-list">
                                        {filteredEntities.length === 0 ? (
                                            <div className="empty-results">Nema rezultata</div>
                                        ) : (
                                            filteredEntities.map(entity => (
                                                <button
                                                    key={entity.id}
                                                    className="link-result-item"
                                                    onClick={() => addLink(entity.id, entity.name)}
                                                >
                                                    <span className="result-name">{entity.name}</span>
                                                    {entity.info && <span className="result-info">{entity.info}</span>}
                                                    <Plus size={14} />
                                                </button>
                                            ))
                                        )}
                                    </div>
                                </div>

                                {/* Active Links */}
                                {links.length > 0 && (
                                    <div className="active-links-area">
                                        <h4>Povezani entiteti:</h4>
                                        <div className="active-links-list">
                                            {links.map((link, idx) => (
                                                <div key={idx} className={`active-link-item ${link.Entity_Type}`}>
                                                    {link.Entity_Type === 'project' && <FolderOpen size={14} />}
                                                    {link.Entity_Type === 'product' && <Package size={14} />}
                                                    {link.Entity_Type === 'material' && <Layers size={14} />}
                                                    {link.Entity_Type === 'worker' && <User size={14} />}
                                                    <span>{link.Entity_Name}</span>
                                                    <button onClick={() => removeLink(idx)}><X size={14} /></button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* CHECKLIST TAB */}
                        {activeTab === 'checklist' && (
                            <div className="modal-checklist-tab">
                                <div className="add-checklist-box">
                                    <input
                                        type="text"
                                        value={newChecklistItem}
                                        onChange={e => setNewChecklistItem(e.target.value)}
                                        placeholder="Dodaj novu stavku..."
                                        onKeyDown={e => e.key === 'Enter' && addChecklistItem()}
                                    />
                                    <button onClick={addChecklistItem} disabled={!newChecklistItem.trim()}>
                                        <Plus size={18} />
                                    </button>
                                </div>

                                <div className="checklist-full-list">
                                    {checklist.length === 0 ? (
                                        <div className="empty-checklist">Nema stavki u checklisti</div>
                                    ) : (
                                        [...checklist].sort((a, b) => (a.completed === b.completed ? 0 : a.completed ? 1 : -1)).map(item => (
                                            <div key={item.id} className={`checklist-list-item ${item.completed ? 'completed' : ''}`}>
                                                <button
                                                    className="modal-item-toggle"
                                                    onClick={() => toggleChecklistItemInModal(item.id)}
                                                    style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', color: item.completed ? '#34C759' : '#ccc' }}
                                                >
                                                    {item.completed ? <CheckCircle2 size={18} /> : <Circle size={18} />}
                                                </button>
                                                <span style={{ textDecoration: item.completed ? 'line-through' : 'none', color: item.completed ? '#888' : 'inherit' }}>
                                                    {item.text}
                                                </span>
                                                <button onClick={() => removeChecklistItem(item.id)} className="delete-item">
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Floating Voice Input */}


                {/* Footer */}
                <div className="task-modal-footer redesigned-footer">
                    <button className="btn-modal-action cancel" onClick={onClose} title="Odustani">
                        <X size={24} />
                    </button>

                    {!isEdit && (
                        <div className="footer-voice-wrapper">
                            <VoiceInput
                                onResult={handleVoiceResult}
                                onError={handleVoiceError}
                                onTranscript={setVoiceTranscript}
                                context={{
                                    projects: projects.map(p => p.Address ? `${p.Client_Name} (${p.Address})` : p.Client_Name),
                                    workers: workers.map(w => w.Name),
                                    suppliers: Array.from(new Set(orders.map(o => o.Supplier_Name).filter(Boolean)))
                                }}
                            />
                        </div>
                    )}

                    <button className="btn-modal-action save" onClick={handleSubmit} title={isEdit ? 'Spremi' : 'Kreiraj'}>
                        {isEdit ? <Save size={24} /> : <Check size={24} />}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ============================================
// TASK PRINT VIEW COMPONENT — Clean A4 Layout
// ============================================

interface TaskPrintViewProps {
    task: Task;
}

function TaskPrintView({ task }: TaskPrintViewProps) {
    const pColor = priorityColors[task.Priority];
    const isOverdue = task.Due_Date && task.Status !== 'completed' && new Date(task.Due_Date) < new Date();
    const completedCount = task.Checklist?.filter(c => c.completed).length ?? 0;
    const totalCount = task.Checklist?.length ?? 0;

    return (
        <div className="task-print-view">
            {/* Header */}
            <div className="tpv-header" style={{ borderLeftColor: pColor.border }}>
                <div className="tpv-badges">
                    <span className="tpv-priority" style={{
                        background: pColor.bg,
                        color: pColor.text,
                        borderColor: pColor.border
                    }}>
                        {TASK_PRIORITY_LABELS[task.Priority]}
                    </span>
                    <span className={`tpv-status tpv-status--${task.Status}`}>
                        {TASK_STATUS_LABELS[task.Status]}
                    </span>
                </div>
                <h1 className="tpv-title">{task.Title}</h1>
                <div className="tpv-meta">
                    {task.Due_Date && (
                        <span className={`tpv-meta-item ${isOverdue ? 'tpv-overdue' : ''}`}>
                            <Calendar size={13} />
                            {new Date(task.Due_Date).toLocaleDateString('hr-HR', {
                                day: 'numeric', month: 'long', year: 'numeric'
                            })}
                        </span>
                    )}
                    {task.Assigned_Worker_Name && (
                        <span className="tpv-meta-item">
                            <User size={13} />
                            {task.Assigned_Worker_Name}
                        </span>
                    )}
                    <span className="tpv-meta-item">
                        {categoryIcons[task.Category]}
                        {TASK_CATEGORY_LABELS[task.Category]}
                    </span>
                </div>
            </div>

            {/* Divider */}
            <div className="tpv-divider" />

            {/* Description */}
            {task.Description && (
                <div className="tpv-section">
                    <h3 className="tpv-section-label">Opis</h3>
                    <p className="tpv-text">{task.Description}</p>
                </div>
            )}

            {/* Checklist */}
            {task.Checklist && task.Checklist.length > 0 && (
                <div className="tpv-section">
                    <div className="tpv-section-header">
                        <h3 className="tpv-section-label">Kontrolna lista</h3>
                        <span className="tpv-progress-label">{completedCount} / {totalCount}</span>
                    </div>
                    <div className="tpv-progress-track">
                        <div className="tpv-progress-bar" style={{
                            width: `${totalCount ? (completedCount / totalCount) * 100 : 0}%`,
                            background: pColor.icon
                        }} />
                    </div>
                    <ul className="tpv-checklist">
                        {task.Checklist.map((item) => (
                            <li key={item.id} className={`tpv-check-item ${item.completed ? 'done' : ''}`}>
                                <span className="tpv-check-box">{item.completed ? '✓' : ''}</span>
                                <span className="tpv-check-text">{item.text}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Links */}
            {task.Links && task.Links.length > 0 && (
                <div className="tpv-section">
                    <h3 className="tpv-section-label">Povezano</h3>
                    <div className="tpv-links">
                        {task.Links.map((link, idx) => (
                            <span key={idx} className="tpv-link-chip">
                                {link.Entity_Name}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {/* Notes */}
            {task.Notes && (
                <div className="tpv-section">
                    <h3 className="tpv-section-label">Napomene</h3>
                    <p className="tpv-text tpv-notes">{task.Notes}</p>
                </div>
            )}

            {/* Footer */}
            <div className="tpv-footer">
                <span>Printano: {new Date().toLocaleDateString('hr-HR', {
                    day: 'numeric', month: 'long', year: 'numeric'
                })} u {new Date().toLocaleTimeString('hr-HR', {
                    hour: '2-digit', minute: '2-digit'
                })}</span>
            </div>
        </div>
    );
}

