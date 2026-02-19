'use client';

import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import type { Task, TaskProfile, Project, Worker, Product, Material, WorkOrder, Order, TaskLink, TaskPriority, TaskCategory, ChecklistItem } from '@/lib/types';
import {
    TASK_PRIORITY_LABELS,
    TASK_STATUS_LABELS,
    TASK_CATEGORY_LABELS,
    TASK_PRIORITIES,
    TASK_CATEGORIES
} from '@/lib/types';
import { saveTask, deleteTask, updateTaskStatus, toggleTaskChecklistItem, generateUUID, saveTaskProfile, deleteTaskProfile } from '@/lib/database';
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
    ChevronRight,
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
    MessageSquare,
    CheckCheck,
    Flag,
    Mic,
    Home,
    Settings,
    LayoutGrid,
    Users,
    UserPlus
} from 'lucide-react';
import { useData } from '@/context/DataContext';
import VoiceInput, { ExtractedTaskData } from '@/components/VoiceInput';

// ============================================
// TYPES
// ============================================

interface MobileTasksTabProps {
    tasks: Task[];
    projects: Project[];
    workers: Worker[];
    materials: Material[];
    workOrders?: WorkOrder[];
    orders?: Order[];
    taskProfiles?: TaskProfile[];
    onRefresh: (...collections: string[]) => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
    projectFilter?: string | null;
    onClearFilter?: () => void;
}

type FilterStatus = 'all' | 'pending' | 'in_progress' | 'completed';
type GroupBy = 'none' | 'priority' | 'date' | 'connection' | 'worker';

// ============================================
// PRIORITY COLORS
// ============================================

const priorityColors: Record<TaskPriority, { bg: string; border: string; text: string; icon: string }> = {
    low: { bg: 'rgba(52, 199, 89, 0.15)', border: 'rgba(52, 199, 89, 0.4)', text: '#34C759', icon: '#34C759' },
    medium: { bg: 'rgba(0, 122, 255, 0.15)', border: 'rgba(0, 122, 255, 0.4)', text: '#007AFF', icon: '#007AFF' },
    high: { bg: 'rgba(255, 149, 0, 0.15)', border: 'rgba(255, 149, 0, 0.4)', text: '#FF9500', icon: '#FF9500' },
    urgent: { bg: 'rgba(255, 59, 48, 0.15)', border: 'rgba(255, 59, 48, 0.4)', text: '#FF3B30', icon: '#FF3B30' }
};

const categoryIcons: Record<TaskCategory, React.ReactNode> = {
    general: <Circle size={16} />,
    manufacturing: <HardHat size={16} />,
    ordering: <ShoppingCart size={16} />,
    installation: <Layers size={16} />,
    design: <Package size={16} />,
    meeting: <User size={16} />,
    reminder: <Clock size={16} />
};

const GROUP_BY_LABELS: Record<GroupBy, string> = {
    none: 'Bez grupiranja',
    priority: 'Po hitnosti',
    date: 'Po datumu',
    connection: 'Po poveznici',
    worker: 'Po radniku'
};

// ============================================
// MAIN COMPONENT
// ============================================

export default function MobileTasksTab({
    tasks,
    projects,
    workers,
    materials,
    workOrders = [],
    orders = [],
    taskProfiles = [],
    onRefresh,
    showToast,
    projectFilter,
    onClearFilter
}: MobileTasksTabProps) {
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
    const [groupBy, setGroupBy] = useState<GroupBy>('priority');
    const [showFilters, setShowFilters] = useState(false);
    const [showSearch, setShowSearch] = useState(false);
    const [showCompleted, setShowCompleted] = useState(false);
    const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

    // Modal states
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingTask, setEditingTask] = useState<Task | null>(null);

    // Local tasks for optimistic updates
    const [localTasks, setLocalTasks] = useState<Task[]>(tasks);

    useEffect(() => {
        setLocalTasks(tasks);
    }, [tasks]);

    // Get all products from projects
    const allProducts = useMemo(() => {
        return projects.flatMap(p => p.products || []);
    }, [projects]);

    // Filter tasks
    const filteredTasks = useMemo(() => {
        return localTasks.filter(task => {
            // Profile filter
            if (selectedProfileId !== '__all__') {
                if (task.Profile_ID !== selectedProfileId) return false;
            }

            // Project filter
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

            // Completed filter (Hide by default unless showCompleted is true)
            if (!showCompleted && task.Status === 'completed') {
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
            // Completed at bottom
            if (a.Status === 'completed' && b.Status !== 'completed') return 1;
            if (a.Status !== 'completed' && b.Status === 'completed') return -1;

            // Priority ordering
            const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
            const priorityDiff = priorityOrder[a.Priority] - priorityOrder[b.Priority];
            if (priorityDiff !== 0) return priorityDiff;

            // Due date
            if (a.Due_Date && b.Due_Date) {
                return new Date(a.Due_Date).getTime() - new Date(b.Due_Date).getTime();
            }
            if (a.Due_Date) return -1;
            if (b.Due_Date) return 1;

            return 0;
        });
    }, [localTasks, searchQuery, filterStatus, filterPriority, filterCategory, projectFilter, projects, selectedProfileId]);

    // Group tasks
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
                            const key = `${link.Entity_Type}:${link.Entity_ID}`;
                            const existing = connectionMap.get(key);
                            if (existing) {
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
                        key: name,
                        label: name,
                        iconClass: type,
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
        const overdue = localTasks.filter(t =>
            t.Status !== 'completed' && t.Due_Date && new Date(t.Due_Date) < today
        ).length;
        const pending = localTasks.filter(t => t.Status === 'pending').length;
        const inProgress = localTasks.filter(t => t.Status === 'in_progress').length;
        const completed = localTasks.filter(t => t.Status === 'completed').length;

        return { overdue, pending, inProgress, completed, total: localTasks.length };
    }, [localTasks]);

    // Active filters count
    const activeFiltersCount = useMemo(() => {
        let count = 0;
        if (filterStatus !== 'all') count++;
        if (filterPriority !== 'all') count++;
        if (filterCategory !== 'all') count++;
        return count;
    }, [filterStatus, filterPriority, filterCategory]);

    // Handlers
    const handleCreateTask = useCallback(() => {
        setEditingTask(null);
        setIsModalOpen(true);
    }, []);

    const handleEditTask = useCallback((task: Task) => {
        setEditingTask(task);
        setIsModalOpen(true);
    }, []);

    const handleSaveTask = useCallback(async (taskData: Partial<Task>) => {
        // Assign profile to new tasks if a specific profile is selected
        if (!taskData.Task_ID && selectedProfileId !== '__all__') {
            taskData.Profile_ID = selectedProfileId;
        }
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
    }, [organizationId, showToast, onRefresh, selectedProfileId]);

    // Profile management handlers
    const handleCreateProfile = useCallback(async () => {
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
    }, [newProfileName, organizationId, showToast, onRefresh]);

    const handleDeleteProfile = useCallback(async (profileId: string) => {
        if (!confirm('Obrisati ovaj profil? Zadaci će biti prebačeni u zajedničke.')) return;
        const result = await deleteTaskProfile(profileId, organizationId!);
        if (result.success) {
            showToast(result.message, 'success');
            setSelectedProfileId('__shared__');
            onRefresh('tasks', 'taskProfiles');
        } else {
            showToast(result.message, 'error');
        }
    }, [organizationId, showToast, onRefresh]);

    const handleDeleteTask = useCallback(async (taskId: string) => {
        const result = await deleteTask(taskId, organizationId!);
        if (result.success) {
            showToast(result.message, 'success');
            onRefresh('tasks');
        } else {
            showToast(result.message, 'error');
        }
    }, [organizationId, showToast, onRefresh]);

    const handleStatusChange = useCallback(async (taskId: string, status: Task['Status']) => {
        // Optimistic update
        const previousTasks = [...localTasks];
        setLocalTasks(prev => prev.map(t =>
            t.Task_ID === taskId ? { ...t, Status: status } : t
        ));

        const result = await updateTaskStatus(taskId, status, organizationId!);
        if (result.success) {
            onRefresh('tasks');
        } else {
            setLocalTasks(previousTasks);
            showToast(result.message, 'error');
        }
    }, [localTasks, organizationId, onRefresh, showToast]);

    const handleToggleChecklist = useCallback(async (taskId: string, itemId: string) => {
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

        const result = await toggleTaskChecklistItem(taskId, itemId, organizationId!);
        if (result.success) {
            onRefresh('tasks');
        } else {
            setLocalTasks(previousTasks);
        }
    }, [localTasks, organizationId, onRefresh]);

    const clearAllFilters = useCallback(() => {
        setFilterStatus('all');
        setFilterPriority('all');
        setFilterCategory('all');
        setSearchQuery('');
    }, []);

    // Render task card
    const renderTaskCard = (task: Task) => {
        const pColor = priorityColors[task.Priority];
        const isOverdue = task.Due_Date && task.Status !== 'completed' && new Date(task.Due_Date) < new Date();
        const isExpanded = expandedTaskId === task.Task_ID;
        const hasExpandableContent = task.Notes || (task.Checklist && task.Checklist.length > 0) || (task.Links && task.Links.length > 0);
        const checklistProgress = task.Checklist?.length
            ? task.Checklist.filter(c => c.completed).length / task.Checklist.length
            : null;

        return (
            <div
                key={task.Task_ID}
                className={`mobile-task-card ${task.Status === 'completed' ? 'completed' : ''} ${isExpanded ? 'expanded' : ''}`}
                style={{ borderLeftColor: pColor.border }}
            >
                {/* Main Row */}
                <div className="mobile-task-main">
                    <button
                        className="mobile-task-checkbox"
                        onClick={(e) => {
                            e.stopPropagation();
                            handleStatusChange(
                                task.Task_ID,
                                task.Status === 'completed' ? 'pending' : 'completed'
                            );
                        }}
                    >
                        {task.Status === 'completed'
                            ? <CheckCircle2 size={26} className="check-complete" />
                            : <Circle size={26} className="check-pending" />
                        }
                    </button>

                    <div
                        className="mobile-task-content"
                        onClick={() => setExpandedTaskId(isExpanded ? null : task.Task_ID)}
                    >
                        <h3 className="mobile-task-title">{task.Title}</h3>
                        {task.Description && (
                            <p className="mobile-task-description">{task.Description}</p>
                        )}

                        {/* Meta chips */}
                        <div className="mobile-task-meta">
                            <span
                                className="mobile-meta-chip priority"
                                style={{ background: pColor.bg, color: pColor.text }}
                            >
                                {TASK_PRIORITY_LABELS[task.Priority]}
                            </span>

                            {task.Due_Date && (
                                <span className={`mobile-meta-chip date ${isOverdue ? 'overdue' : ''}`}>
                                    <Calendar size={12} />
                                    {new Date(task.Due_Date).toLocaleDateString('hr-HR', {
                                        day: 'numeric',
                                        month: 'short'
                                    })}
                                </span>
                            )}

                            {task.Assigned_Worker_Name && (
                                <span className="mobile-meta-chip worker">
                                    <User size={12} />
                                    {task.Assigned_Worker_Name.split(' ')[0]}
                                </span>
                            )}

                            {checklistProgress !== null && !isExpanded && (
                                <span className="mobile-meta-chip checklist">
                                    <CheckCheck size={12} />
                                    {task.Checklist?.filter(c => c.completed).length}/{task.Checklist?.length}
                                </span>
                            )}
                        </div>
                    </div>

                    <div className="mobile-task-actions">
                        <button
                            className="mobile-expand-btn"
                            onClick={() => setExpandedTaskId(isExpanded ? null : task.Task_ID)}
                        >
                            {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                        </button>
                    </div>
                </div>

                {/* Expanded content */}
                {isExpanded && (
                    <div className="mobile-task-expanded">
                        {/* Notes */}
                        {task.Notes && (
                            <div className="mobile-expanded-section">
                                <div className="mobile-section-header">
                                    <MessageSquare size={14} />
                                    <span>Napomene</span>
                                </div>
                                <p className="mobile-notes-content">{task.Notes}</p>
                            </div>
                        )}

                        {/* Links */}
                        {task.Links && task.Links.length > 0 && (
                            <div className="mobile-expanded-section">
                                <div className="mobile-section-header">
                                    <Link2 size={14} />
                                    <span>Povezano ({task.Links.length})</span>
                                </div>
                                <div className="mobile-links-list">
                                    {task.Links.map((link, idx) => (
                                        <span key={idx} className={`mobile-link-chip ${link.Entity_Type}`}>
                                            {link.Entity_Type === 'project' && <FolderOpen size={12} />}
                                            {link.Entity_Type === 'product' && <Package size={12} />}
                                            {link.Entity_Type === 'material' && <Layers size={12} />}
                                            {link.Entity_Type === 'worker' && <User size={12} />}
                                            {link.Entity_Type === 'work_order' && <HardHat size={12} />}
                                            {link.Entity_Type === 'order' && <ShoppingCart size={12} />}
                                            {link.Entity_Name}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Checklist */}
                        {task.Checklist && task.Checklist.length > 0 && (
                            <div className="mobile-expanded-section">
                                <div className="mobile-section-header">
                                    <CheckCheck size={14} />
                                    <span>Checklist ({task.Checklist.filter(c => c.completed).length}/{task.Checklist.length})</span>
                                </div>
                                <div className="mobile-checklist">
                                    {[...task.Checklist].sort((a, b) => (a.completed === b.completed ? 0 : a.completed ? 1 : -1)).map(item => (
                                        <button
                                            key={item.id}
                                            className={`mobile-checklist-item ${item.completed ? 'completed' : ''}`}
                                            onClick={() => handleToggleChecklist(task.Task_ID, item.id)}
                                        >
                                            {item.completed
                                                ? <CheckCircle2 size={18} className="check-complete" />
                                                : <Circle size={18} className="check-pending" />
                                            }
                                            <span>{item.text}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Action buttons */}
                        <div className="mobile-task-action-buttons">
                            <button className="mobile-action-btn edit" onClick={() => handleEditTask(task)}>
                                <Edit3 size={16} />
                                Uredi
                            </button>
                            <button className="mobile-action-btn delete" onClick={() => {
                                if (confirm('Obrisati ovaj zadatak?')) {
                                    handleDeleteTask(task.Task_ID);
                                }
                            }}>
                                <Trash2 size={16} />
                                Obriši
                            </button>
                        </div>
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="mobile-tasks-container">
            {/* Header */}
            <div className="mobile-tasks-header">
                <div className="mobile-header-top">
                    <h1 className="mobile-header-title">
                        <CheckSquare size={24} />
                        Zadaci
                    </h1>
                    <div className="mobile-header-stats">
                        <span className="mobile-stat">{filteredTasks.length}</span>
                    </div>
                </div>

                {/* Profile Selector */}
                <div className="mobile-profile-selector" ref={profileDropdownRef}>
                    <button
                        className={`mobile-profile-btn ${showProfileMenu ? 'active' : ''}`}
                        onClick={() => setShowProfileMenu(!showProfileMenu)}
                    >
                        <Users size={16} />
                        <span>
                            {selectedProfileId === '__all__' ? 'Svi zadaci' :
                                taskProfiles.find(p => p.Profile_ID === selectedProfileId)?.Name || 'Svi zadaci'}
                        </span>
                        <ChevronDown size={14} className={showProfileMenu ? 'rotated' : ''} />
                    </button>

                    {showProfileMenu && (
                        <div className="mobile-profile-dropdown">
                            <button
                                className={`mobile-profile-option ${selectedProfileId === '__all__' ? 'active' : ''}`}
                                onClick={() => { setSelectedProfileId('__all__'); setShowProfileMenu(false); }}
                            >
                                <CheckSquare size={14} />
                                <span>Svi zadaci</span>
                            </button>
                            {taskProfiles.map(profile => (
                                <div key={profile.Profile_ID} className={`mobile-profile-option ${selectedProfileId === profile.Profile_ID ? 'active' : ''}`}>
                                    <button
                                        className="mobile-profile-option-main"
                                        onClick={() => { setSelectedProfileId(profile.Profile_ID); setShowProfileMenu(false); }}
                                    >
                                        <User size={14} />
                                        <span>{profile.Name}</span>
                                    </button>
                                    <button
                                        className="mobile-profile-delete"
                                        onClick={(e) => { e.stopPropagation(); handleDeleteProfile(profile.Profile_ID); }}
                                    >
                                        <Trash2 size={12} />
                                    </button>
                                </div>
                            ))}
                            <div className="mobile-profile-divider" />
                            {isCreatingProfile ? (
                                <div className="mobile-profile-create">
                                    <input
                                        type="text"
                                        placeholder="Ime profila..."
                                        value={newProfileName}
                                        onChange={(e) => setNewProfileName(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === 'Enter') handleCreateProfile(); if (e.key === 'Escape') setIsCreatingProfile(false); }}
                                        autoFocus
                                    />
                                    <button onClick={handleCreateProfile}><Check size={14} /></button>
                                    <button onClick={() => { setIsCreatingProfile(false); setNewProfileName(''); }}><X size={14} /></button>
                                </div>
                            ) : (
                                <button className="mobile-profile-add" onClick={() => setIsCreatingProfile(true)}>
                                    <UserPlus size={14} />
                                    <span>Novi profil</span>
                                </button>
                            )}
                        </div>
                    )}
                </div>

                {/* Quick stats bar */}
                <div className="mobile-quick-stats">
                    {stats.overdue > 0 && (
                        <button
                            className="mobile-stat-chip overdue"
                            onClick={() => setFilterStatus('all')}
                        >
                            <AlertTriangle size={14} />
                            {stats.overdue} prekoračeno
                        </button>
                    )}
                    <button
                        className={`mobile-stat-chip ${showCompleted ? 'active' : ''}`}
                        onClick={() => setShowCompleted(!showCompleted)}
                    >
                        <CheckCircle2 size={14} />
                        {showCompleted ? 'Sakrij završene' : 'Prikaži završene'}
                    </button>
                    <button
                        className={`mobile-stat-chip ${filterStatus === 'pending' ? 'active' : ''}`}
                        onClick={() => setFilterStatus(filterStatus === 'pending' ? 'all' : 'pending')}
                    >
                        {stats.pending} na čekanju
                    </button>
                    <button
                        className={`mobile-stat-chip ${filterStatus === 'in_progress' ? 'active' : ''}`}
                        onClick={() => setFilterStatus(filterStatus === 'in_progress' ? 'all' : 'in_progress')}
                    >
                        {stats.inProgress} u toku
                    </button>
                </div>

                {/* Project filter banner */}
                {projectFilter && (
                    <div className="mobile-project-filter">
                        <FolderOpen size={14} />
                        <span>{projects.find(p => p.Project_ID === projectFilter)?.Client_Name || 'Projekat'}</span>
                        {onClearFilter && (
                            <button onClick={onClearFilter}>
                                <X size={14} />
                            </button>
                        )}
                    </div>
                )}

                {/* Search bar */}
                {showSearch && (
                    <div className="mobile-search-bar">
                        <Search size={18} />
                        <input
                            type="text"
                            placeholder="Pretraži zadatke..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            autoFocus
                        />
                        {searchQuery && (
                            <button onClick={() => setSearchQuery('')}>
                                <X size={16} />
                            </button>
                        )}
                    </div>
                )}

                {/* Toolbar */}
                <div className="mobile-toolbar">
                    <button
                        className={`mobile-toolbar-btn ${showSearch ? 'active' : ''}`}
                        onClick={() => setShowSearch(!showSearch)}
                    >
                        <Search size={18} />
                    </button>

                    <button
                        className={`mobile-toolbar-btn ${showFilters ? 'active' : ''} ${activeFiltersCount > 0 ? 'has-filters' : ''}`}
                        onClick={() => setShowFilters(!showFilters)}
                    >
                        <Filter size={18} />
                        {activeFiltersCount > 0 && (
                            <span className="mobile-filter-badge">{activeFiltersCount}</span>
                        )}
                    </button>

                    <select
                        className="mobile-group-select"
                        value={groupBy}
                        onChange={(e) => setGroupBy(e.target.value as GroupBy)}
                    >
                        {Object.entries(GROUP_BY_LABELS).map(([key, label]) => (
                            <option key={key} value={key}>{label}</option>
                        ))}
                    </select>
                </div>
            </div>

            {/* Filters Panel */}
            {showFilters && (
                <div className="mobile-filters-panel">
                    {/* Status */}
                    <div className="mobile-filter-group">
                        <label>Status</label>
                        <div className="mobile-filter-chips">
                            {(['all', 'pending', 'in_progress', 'completed'] as const).map(status => (
                                <button
                                    key={status}
                                    className={`mobile-filter-chip ${filterStatus === status ? 'active' : ''}`}
                                    onClick={() => setFilterStatus(status)}
                                >
                                    {status === 'all' ? 'Svi' : TASK_STATUS_LABELS[status]}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Priority */}
                    <div className="mobile-filter-group">
                        <label>Prioritet</label>
                        <div className="mobile-filter-chips">
                            <button
                                className={`mobile-filter-chip ${filterPriority === 'all' ? 'active' : ''}`}
                                onClick={() => setFilterPriority('all')}
                            >
                                Svi
                            </button>
                            {TASK_PRIORITIES.map(priority => (
                                <button
                                    key={priority}
                                    className={`mobile-filter-chip priority-${priority} ${filterPriority === priority ? 'active' : ''}`}
                                    onClick={() => setFilterPriority(priority)}
                                >
                                    {TASK_PRIORITY_LABELS[priority]}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Category */}
                    <div className="mobile-filter-group">
                        <label>Kategorija</label>
                        <div className="mobile-filter-chips">
                            <button
                                className={`mobile-filter-chip ${filterCategory === 'all' ? 'active' : ''}`}
                                onClick={() => setFilterCategory('all')}
                            >
                                Sve
                            </button>
                            {TASK_CATEGORIES.map(category => (
                                <button
                                    key={category}
                                    className={`mobile-filter-chip ${filterCategory === category ? 'active' : ''}`}
                                    onClick={() => setFilterCategory(category)}
                                >
                                    {categoryIcons[category]}
                                    {TASK_CATEGORY_LABELS[category]}
                                </button>
                            ))}
                        </div>
                    </div>

                    {activeFiltersCount > 0 && (
                        <button className="mobile-clear-filters" onClick={clearAllFilters}>
                            <X size={14} />
                            Očisti sve filtere
                        </button>
                    )}
                </div>
            )}

            {/* Content */}
            <div className="mobile-tasks-content">
                {filteredTasks.length === 0 ? (
                    <div className="mobile-empty-state">
                        <CheckSquare size={48} strokeWidth={1.5} />
                        <h3>Nema zadataka</h3>
                        <p>Dodajte novi zadatak koristeći + dugme</p>
                    </div>
                ) : (
                    groupedTasks.map(group => (
                        <div key={group.key} className="mobile-task-group">
                            <div className={`mobile-group-header ${group.iconClass}`}>
                                <span className="mobile-group-title">{group.label}</span>
                                <span className="mobile-group-count">{group.tasks.length}</span>
                            </div>
                            <div className="mobile-group-tasks">
                                {group.tasks.map(renderTaskCard)}
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Floating Action Button */}
            <button className="mobile-fab" onClick={handleCreateTask}>
                <Plus size={28} />
            </button>

            {/* Task Modal */}
            {isModalOpen && (
                <MobileTaskModal
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
        </div>
    );
}

// ============================================
// MOBILE TASK MODAL
// ============================================

interface MobileTaskModalProps {
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

function MobileTaskModal({
    task,
    projects,
    products,
    workers,
    materials,
    workOrders,
    orders,
    onSave,
    onClose
}: MobileTaskModalProps) {
    const isEdit = !!task;
    const [activeTab, setActiveTab] = useState<'details' | 'links' | 'checklist'>('details');

    // Form state
    const [title, setTitle] = useState(task?.Title || '');
    const [description, setDescription] = useState(task?.Description || '');
    const [priority, setPriority] = useState<TaskPriority>(task?.Priority || 'medium');
    const [category, setCategory] = useState<TaskCategory>(task?.Category || 'general');
    const [showControls, setShowControls] = useState(false);
    const [dueDate, setDueDate] = useState(task?.Due_Date || '');
    const [notes, setNotes] = useState(task?.Notes || '');
    const [links, setLinks] = useState<TaskLink[]>(task?.Links || []);
    const [checklist, setChecklist] = useState<ChecklistItem[]>(task?.Checklist || []);

    // Link state
    const [linkType, setLinkType] = useState<TaskLink['Entity_Type']>('project');
    const [linkSearch, setLinkSearch] = useState('');

    // Checklist state
    const [newChecklistItem, setNewChecklistItem] = useState('');

    // Voice input
    const [voiceTranscript, setVoiceTranscript] = useState('');

    const handleVoiceResult = (data: ExtractedTaskData) => {
        if (data.title) setTitle(data.title);
        if (data.description) setDescription(data.description);
        if (data.priority) setPriority(data.priority as TaskPriority);
        if (data.category) setCategory(data.category as TaskCategory);
        if (data.suggestedDueDate) setDueDate(data.suggestedDueDate);

        // Add checklist items
        if (data.checklist && data.checklist.length > 0) {
            const newChecklist = data.checklist.map(text => ({
                id: generateUUID(),
                text,
                completed: false
            }));
            setChecklist(prev => [...prev, ...newChecklist]);
            // Switch to checklist tab if items were added
            setActiveTab('checklist');
        }

        // Try to match suggested worker
        if (data.suggestedWorker) {
            const matchedWorker = workers.find(w =>
                w.Name.toLowerCase().includes(data.suggestedWorker!.toLowerCase())
            );
            // Note: MobileTaskModal doesn't have worker assignment UI, but we could add it
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
        console.error('Voice error:', error);
    };

    // Get available entities for linking
    const getAvailableEntities = () => {
        switch (linkType) {
            case 'project': return projects.map(p => ({ id: p.Project_ID, name: p.Client_Name, info: p.Address }));
            case 'product': return products.map(p => ({ id: p.Product_ID, name: p.Name, info: '' }));
            case 'material': return materials.map(m => ({ id: m.Material_ID, name: m.Name, info: m.Category }));
            case 'worker': return workers.map(w => ({ id: w.Worker_ID, name: w.Name, info: w.Role }));
            case 'work_order': return workOrders.map(wo => ({ id: wo.Work_Order_ID, name: wo.Work_Order_Number, info: wo.Status }));
            case 'order': return orders.map(o => ({ id: o.Order_ID, name: o.Order_Number, info: o.Supplier_Name }));
            default: return [];
        }
    };

    const filteredEntities = useMemo(() => {
        const entities = getAvailableEntities();
        const alreadyLinked = new Set(links.filter(l => l.Entity_Type === linkType).map(l => l.Entity_ID));
        return entities
            .filter(e => !alreadyLinked.has(e.id))
            .filter(e =>
                linkSearch === '' ||
                e.name.toLowerCase().includes(linkSearch.toLowerCase()) ||
                e.info?.toLowerCase().includes(linkSearch.toLowerCase())
            );
    }, [linkType, linkSearch, links, projects, products, materials, workers, workOrders, orders]);

    const addLink = (entityId: string, entityName: string) => {
        setLinks([...links, { Entity_Type: linkType, Entity_ID: entityId, Entity_Name: entityName }]);
    };

    const removeLink = (index: number) => {
        setLinks(links.filter((_, i) => i !== index));
    };

    const addChecklistItem = () => {
        if (!newChecklistItem.trim()) return;
        setChecklist([...checklist, { id: generateUUID(), text: newChecklistItem.trim(), completed: false }]);
        setNewChecklistItem('');
    };

    const removeChecklistItem = (id: string) => {
        setChecklist(checklist.filter(c => c.id !== id));
    };

    const toggleChecklistItemInModal = (id: string) => {
        setChecklist(checklist.map(c => c.id === id ? { ...c, completed: !c.completed } : c));
    };

    const handleSubmit = () => {
        if (!title.trim()) return;

        onSave({
            Task_ID: task?.Task_ID,
            Title: title.trim(),
            Description: description.trim(),
            Priority: priority,
            Category: category,
            Due_Date: dueDate || undefined,
            Notes: notes.trim() || undefined,
            Links: links,
            Checklist: checklist,
            Status: task?.Status || 'pending'
        });
    };

    return (
        <div className="mobile-modal-overlay" onClick={onClose}>
            <div className="mobile-modal-container" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="mobile-modal-header centered">
                    <h2>{isEdit ? 'Uredi zadatak' : 'Novi zadatak'}</h2>
                </div>

                {/* Content */}
                <div className="mobile-modal-content">
                    {/* TOP SECTION: Title + Description */}
                    <input
                        type="text"
                        className="mobile-input title-input"
                        placeholder="Šta treba uraditi?"
                        value={title}
                        onChange={e => setTitle(e.target.value)}
                    />

                    {/* Tabs */}
                    <div className="mobile-modal-tabs">
                        <button
                            className={`mobile-tab ${activeTab === 'details' ? 'active' : ''}`}
                            onClick={() => setActiveTab('details')}
                        >
                            Detalji
                        </button>
                        <button
                            className={`mobile-tab ${activeTab === 'links' ? 'active' : ''}`}
                            onClick={() => setActiveTab('links')}
                        >
                            Poveznice ({links.length})
                        </button>
                        <button
                            className={`mobile-tab ${activeTab === 'checklist' ? 'active' : ''}`}
                            onClick={() => setActiveTab('checklist')}
                        >
                            Checklist ({checklist.length})
                        </button>
                    </div>

                    {/* Tab Content */}
                    <div className="mobile-tab-content">
                        {activeTab === 'details' && (
                            <div className="mobile-form-group">
                                <label>Opis</label>
                                <textarea
                                    className="mobile-textarea"
                                    placeholder="Unesite opis..."
                                    value={description}
                                    onChange={e => setDescription(e.target.value)}
                                    rows={6}
                                />
                            </div>
                        )}

                        {activeTab === 'links' && (
                            <div className="mobile-links-tab">
                                {/* Link type selector */}
                                <div className="mobile-link-types">
                                    {(['project', 'product', 'material', 'worker', 'order'] as const).map(type => (
                                        <button
                                            key={type}
                                            className={`mobile-link-type ${linkType === type ? 'active' : ''}`}
                                            onClick={() => setLinkType(type)}
                                        >
                                            {type === 'project' && <FolderOpen size={14} />}
                                            {type === 'product' && <Package size={14} />}
                                            {type === 'material' && <Layers size={14} />}
                                            {type === 'worker' && <User size={14} />}
                                            {type === 'order' && <ShoppingCart size={14} />}
                                        </button>
                                    ))}
                                </div>

                                {/* Search */}
                                <div className="mobile-link-search">
                                    <Search size={16} />
                                    <input
                                        type="text"
                                        placeholder="Pretraži..."
                                        value={linkSearch}
                                        onChange={e => setLinkSearch(e.target.value)}
                                    />
                                </div>

                                {/* Results */}
                                <div className="mobile-link-results">
                                    {filteredEntities.slice(0, 10).map(entity => (
                                        <button
                                            key={entity.id}
                                            className="mobile-link-result"
                                            onClick={() => addLink(entity.id, entity.name)}
                                        >
                                            <span>{entity.name}</span>
                                            {entity.info && <small>{entity.info}</small>}
                                            <Plus size={16} />
                                        </button>
                                    ))}
                                </div>

                                {/* Active links */}
                                {links.length > 0 && (
                                    <div className="mobile-active-links">
                                        <h4>Povezano:</h4>
                                        {links.map((link, idx) => (
                                            <div key={idx} className={`mobile-active-link ${link.Entity_Type}`}>
                                                <span>{link.Entity_Name}</span>
                                                <button onClick={() => removeLink(idx)}>
                                                    <X size={14} />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {activeTab === 'checklist' && (
                            <div className="mobile-checklist-tab">
                                {/* Add item */}
                                <div className="mobile-add-checklist">
                                    <input
                                        type="text"
                                        placeholder="Dodaj stavku..."
                                        value={newChecklistItem}
                                        onChange={e => setNewChecklistItem(e.target.value)}
                                        onKeyDown={e => e.key === 'Enter' && addChecklistItem()}
                                    />
                                    <button onClick={addChecklistItem} disabled={!newChecklistItem.trim()}>
                                        <Plus size={20} />
                                    </button>
                                </div>

                                {/* Items */}
                                <div className="mobile-checklist-items">
                                    {checklist.map(item => (
                                        <div key={item.id} className={`mobile-checklist-item ${item.completed ? 'completed' : ''}`}>
                                            <button onClick={() => toggleChecklistItemInModal(item.id)}>
                                                {item.completed
                                                    ? <CheckCircle2 size={20} className="check-complete" />
                                                    : <Circle size={20} className="check-pending" />
                                                }
                                            </button>
                                            <span>{item.text}</span>
                                            <button className="delete" onClick={() => removeChecklistItem(item.id)}>
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* BOTTOM SECTION: Priority, Category, Date - closer to thumbs */}
                <div className="mobile-modal-controls">
                    <button
                        className="mobile-controls-toggle"
                        onClick={() => setShowControls(!showControls)}
                    >
                        <span>Postavke zadatka (Prioritet, Kategorija, Rok)</span>
                        {showControls ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                    </button>

                    {showControls && (
                        <div className="mobile-controls-content">
                            {/* Priority selector */}
                            <div className="mobile-form-group">
                                <label>Prioritet</label>
                                <div className="mobile-priority-selector">
                                    {TASK_PRIORITIES.map(p => (
                                        <button
                                            key={p}
                                            type="button"
                                            className={`mobile-priority-btn ${priority === p ? 'active' : ''}`}
                                            onClick={() => setPriority(p)}
                                            style={{
                                                borderColor: priority === p ? priorityColors[p].icon : 'transparent',
                                                background: priority === p ? priorityColors[p].bg : 'rgba(255,255,255,0.05)'
                                            }}
                                        >
                                            <span
                                                className="priority-indicator"
                                                style={{ background: priorityColors[p].icon }}
                                            />
                                            {TASK_PRIORITY_LABELS[p]}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Category & Due Date row */}
                            <div className="mobile-form-row">
                                <div className="mobile-form-group flex-1">
                                    <label>Kategorija</label>
                                    <select
                                        value={category}
                                        onChange={e => setCategory(e.target.value as TaskCategory)}
                                        className="mobile-select"
                                    >
                                        {TASK_CATEGORIES.map(c => (
                                            <option key={c} value={c}>{TASK_CATEGORY_LABELS[c]}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="mobile-form-group flex-1">
                                    <label>Rok</label>
                                    <input
                                        type="date"
                                        value={dueDate}
                                        onChange={e => setDueDate(e.target.value)}
                                        className="mobile-input"
                                    />
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer with actions */}
                <div className="mobile-modal-footer">
                    <button className="mobile-modal-close-footer" onClick={onClose}>
                        <X size={28} />
                    </button>

                    {!isEdit ? (
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
                    ) : <div style={{ width: 60 }} />}

                    <button className="mobile-modal-save-footer" onClick={handleSubmit} disabled={!title.trim()}>
                        <Check size={28} />
                    </button>
                </div>
            </div>
        </div>
    );
}
