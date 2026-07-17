'use client';

// ════════════════════════════════════════════════════════════════════
// PRIORITET — segmentirani izbor umjesto <select>. Boja aktivne opcije je
// ISTA paleta koja boji pilove i lijevu traku na kartici zadatka
// (WorkOrderTasksPanel/TaskAttachEditor/TaskPickerModal), pa se prioritet
// prepoznaje po boji prije nego što se pročita tekst.
// ════════════════════════════════════════════════════════════════════

import { TASK_PRIORITIES, TASK_PRIORITY_LABELS, type TaskPriority } from '@/lib/types';
import './PrioritySelect.css';

interface PrioritySelectProps {
    value: TaskPriority;
    onChange: (value: TaskPriority) => void;
    disabled?: boolean;
}

export default function PrioritySelect({ value, onChange, disabled }: PrioritySelectProps) {
    return (
        <div className="prio-select" role="radiogroup" aria-label="Prioritet">
            {TASK_PRIORITIES.map(p => (
                <button
                    key={p}
                    type="button"
                    role="radio"
                    aria-checked={value === p}
                    className={`prio-opt p-${p}${value === p ? ' active' : ''}`}
                    disabled={disabled}
                    onClick={() => onChange(p)}
                >
                    {TASK_PRIORITY_LABELS[p]}
                </button>
            ))}
        </div>
    );
}
