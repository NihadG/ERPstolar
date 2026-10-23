'use client';

// ════════════════════════════════════════════════════════════════════
// /notebook-preview — maketa Bilježnice (samo dev)
//
// Zadaci su iza prijave; ova ruta renderuje PRAVI NotebookPanel nad
// izmišljenim stavkama (stanovi, kombi, radionica; otvoreno i riješeno),
// da se izgled i interakcije provjere bez baze. Klik na krug mijenja stanje
// lokalno, kao što bi NotebookLens upisao u Firestore.
//
// U produkciji ruta ne postoji.
// ════════════════════════════════════════════════════════════════════

import { useState } from 'react';
import { notFound } from 'next/navigation';
import NotebookPanel from '@/components/tabs/notebook/NotebookPanel';
import type { MemoryItem } from '@/lib/types';

export const dynamic = 'force-dynamic';

const day = (offset: number, hour = 9) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    d.setHours(hour, 15, 0, 0);
    return d.toISOString();
};

function item(p: Partial<MemoryItem> & Pick<MemoryItem, 'Item_ID' | 'Title' | 'Subject' | 'State_Label'>): MemoryItem {
    return {
        Organization_ID: 'demo', Owner_UID: 'demo', Links: [], State: 'open', Tags: [], Source_Entry_IDs: [],
        History: [{ At: day(-3), Text: p.Title, By: 'ja' }],
        Created_At: day(-3), Updated_At: day(-3),
        ...p,
    };
}

const DEMO: MemoryItem[] = [
    item({
        Item_ID: '1', Title: 'Ogledala za kupatila', Subject: 'ogledalo', Quantity: 3, Unit: 'kom', Spec: '1 m dužine',
        Location: 'Stan 304', State_Label: 'nije montirano',
        Links: [{ Entity_Type: 'project', Entity_ID: 'p1', Entity_Name: 'Begović · Zgrada Grbavica' }],
        History: [{ At: day(-30, 14), Text: 'U stanu 304 imam 3 ogledala od 1 m, nisu montirana', By: 'ja' }],
        Created_At: day(-30, 14), Updated_At: day(-30, 14),
    }),
    item({
        Item_ID: '2', Title: 'Ogledalo hodnik', Subject: 'ogledalo', Quantity: 1, Unit: 'kom', Spec: '60×120',
        Location: 'Stan 112', State_Label: 'montirano', State: 'resolved',
        History: [
            { At: day(-12, 10), Text: 'U 112 ostavljeno ogledalo za hodnik', By: 'ja' },
            { At: day(-2, 16), Text: 'Montirali ogledalo u hodniku, sve ok', By: 'Amer Hodžić' },
        ],
        Created_At: day(-12, 10), Updated_At: day(-2, 16), Resolved_At: day(-2, 16),
    }),
    item({
        Item_ID: '3', Title: 'Ogledala za ormar', Subject: 'ogledalo', Quantity: 2, Unit: 'kom', Spec: '40×180',
        Location: 'Radionica', State_Label: 'čeka montažu u Ilidži',
        History: [{ At: day(-6, 8), Text: 'Dva ogledala za Hodžića stoje u radionici', By: 'Edin Begić' }],
        Created_At: day(-6, 8), Updated_At: day(-6, 8),
    }),
    item({
        Item_ID: '4', Title: 'Vodilice Blum 500', Subject: 'vodilica', Quantity: 5, Unit: 'kom',
        Location: 'Kombi', State_Label: 'u kombiju', Updated_At: day(-1, 7), Created_At: day(-1, 7),
    }),
    item({
        Item_ID: '5', Title: 'Ključ od stana', Subject: 'ključ', Location: 'Stan 304', State_Label: 'kod domara',
        Tags: ['pristup'], Created_At: day(-4), Updated_At: day(-4),
    }),
    item({
        Item_ID: '6', Title: 'Radna ploča hrast', Subject: 'radna ploča', Quantity: 1, Unit: 'kom', Spec: '3 m, ogrebana ivica',
        Location: 'Radionica', State_Label: 'reklamacija dobavljaču', Created_At: day(-9), Updated_At: day(-5),
        History: [
            { At: day(-9), Text: 'Ploča stigla ogrebana', By: 'Edin Begić' },
            { At: day(-5), Text: 'Poslao slike dobavljaču, čekam odgovor', By: 'ja' },
        ],
    }),
];

export default function NotebookPreviewPage() {
    const [items, setItems] = useState(DEMO);
    const [empty, setEmpty] = useState(false);

    if (process.env.NODE_ENV === 'production') notFound();

    const toggle = (m: MemoryItem, resolved: boolean) => {
        const now = new Date().toISOString();
        setItems(list => list.map(x => x.Item_ID !== m.Item_ID ? x : {
            ...x, State: resolved ? 'resolved' : 'open', Updated_At: now,
            History: [...x.History, { At: now, Text: resolved ? 'Označeno kao riješeno u aplikaciji' : 'Vraćeno u otvoreno', By: 'ja' }],
        }));
    };

    return (
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 16px', background: 'var(--background)', minHeight: '100vh' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <h2 style={{ margin: 0, fontSize: 24 }}>Bilježnica — maketa</h2>
                <label style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                    <input type="checkbox" checked={empty} onChange={e => setEmpty(e.target.checked)} /> prazno stanje
                </label>
            </div>
            <NotebookPanel
                items={empty ? [] : items}
                onToggleResolved={toggle}
                onDelete={m => setItems(list => list.filter(x => x.Item_ID !== m.Item_ID))}
            />
        </div>
    );
}
