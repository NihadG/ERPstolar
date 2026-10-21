// ════════════════════════════════════════════════════════════════════
// Primjena diktata na formu zadatka (desktop modal i mobilni editor).
//
// Diktat se može ponoviti ili ispraviti, pa primjena mora biti ZAMJENA
// onoga što je prethodni diktat upisao — ne dopisivanje. Prije se svakim
// ponovnim diktatom checklista udvostručavala, a stari projekat ostajao
// povezan. Ono što je korisnik sam upisao/promijenio se ne dira.
// ════════════════════════════════════════════════════════════════════

import type { ChecklistItem, TaskLink, TaskPriority, TaskCategory } from '@/lib/types';
import type { ExtractedTaskData } from './extract';

export interface VoiceForm {
    title: string;
    description: string;
    priority: TaskPriority;
    category: TaskCategory;
    dueDate: string;
    workerId: string;
    checklist: ChecklistItem[];
    links: TaskLink[];
}

/** Šta je posljednji diktat upisao — da sljedeći zna šta smije zamijeniti. */
export interface VoiceApplied {
    description: string;
    dueDate: string;
    workerId: string;
    checklistIds: string[];
    projectId: string;
}

export const EMPTY_VOICE_APPLIED: VoiceApplied = { description: '', dueDate: '', workerId: '', checklistIds: [], projectId: '' };

export function applyVoiceResult(
    form: VoiceForm,
    prev: VoiceApplied,
    data: ExtractedTaskData,
    project: { id: string; name: string } | null,
    newId: () => string,
): { form: VoiceForm; applied: VoiceApplied } {
    // Polje se mijenja ako je prazno ili ga je upisao prethodni diktat.
    const ours = (current: string, prevVoice: string) => !current || current === prevVoice;

    const description = data.description
        ? data.description
        : (ours(form.description, prev.description) ? '' : form.description);
    const dueDate = data.suggestedDueDate
        ? data.suggestedDueDate
        : (ours(form.dueDate, prev.dueDate) ? '' : form.dueDate);
    const workerId = data.suggestedWorkerId
        ? data.suggestedWorkerId
        : (ours(form.workerId, prev.workerId) ? '' : form.workerId);

    const dropIds = new Set(prev.checklistIds);
    const added = data.checklist.map(text => ({ id: newId(), text, completed: false }));
    const checklist = [...form.checklist.filter(i => !dropIds.has(i.id) || i.completed), ...added];

    let links = form.links;
    if (prev.projectId && prev.projectId !== project?.id) {
        links = links.filter(l => !(l.Entity_Type === 'project' && l.Entity_ID === prev.projectId));
    }
    let projectId = '';
    if (project) {
        if (!links.some(l => l.Entity_Type === 'project' && l.Entity_ID === project.id)) {
            links = [...links, { Entity_Type: 'project', Entity_ID: project.id, Entity_Name: project.name }];
            projectId = project.id;
        } else if (prev.projectId === project.id) {
            projectId = project.id;
        }
    }

    return {
        form: {
            title: data.title || form.title,
            description,
            priority: data.priority,
            category: data.category,
            dueDate,
            workerId,
            checklist,
            links,
        },
        applied: {
            description: data.description ? description : '',
            dueDate: data.suggestedDueDate ? dueDate : '',
            workerId: data.suggestedWorkerId ? workerId : '',
            checklistIds: added.map(i => i.id),
            projectId,
        },
    };
}
