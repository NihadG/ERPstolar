import type { ChecklistItem, Task } from './types';

export interface TaskChecklistSection {
    id: string | null;
    name: string | null;
    items: ChecklistItem[];
}

/** Display checklist items in their task-defined sections without changing item order. */
export function getTaskChecklistSections(
    task: Pick<Task, 'Checklist' | 'ChecklistGroups'>,
): TaskChecklistSection[] {
    const groups = task.ChecklistGroups || [];
    const validIds = new Set(groups.map(group => group.id));
    const ungrouped: ChecklistItem[] = [];
    const grouped = new Map<string, ChecklistItem[]>();

    for (const item of task.Checklist || []) {
        if (!item.groupId || !validIds.has(item.groupId)) {
            ungrouped.push(item);
            continue;
        }
        const items = grouped.get(item.groupId) || [];
        items.push(item);
        grouped.set(item.groupId, items);
    }

    const sections: TaskChecklistSection[] = [];
    if (ungrouped.length > 0) sections.push({ id: null, name: null, items: ungrouped });
    const seen = new Set<string>();
    for (const group of groups) {
        if (seen.has(group.id)) continue;
        seen.add(group.id);
        const items = grouped.get(group.id);
        if (items?.length) sections.push({ id: group.id, name: group.name, items });
    }
    return sections;
}
