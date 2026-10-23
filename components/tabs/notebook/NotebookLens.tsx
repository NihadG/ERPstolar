'use client';

// Bilježnica s podacima: živa pretplata na memory_items prijavljenog
// korisnika (pravila dozvoljavaju samo vlastite stavke) + ručne izmjene.
// Nove stavke pravi samo Telegram asistent (server), ne aplikacija.

import { useEffect, useState } from 'react';
import { collection, deleteDoc, deleteField, doc, onSnapshot, query, updateDoc, where } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { COLLECTIONS } from '@/lib/services/shared/collections';
import type { MemoryItem } from '@/lib/types';
import NotebookPanel from './NotebookPanel';

export default function NotebookLens({ organizationId }: { organizationId: string | null | undefined }) {
    const [items, setItems] = useState<MemoryItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        const uid = auth?.currentUser?.uid;
        if (!uid || !organizationId) {
            setLoading(false);
            return;
        }
        const q = query(collection(db, COLLECTIONS.MEMORY_ITEMS), where('Owner_UID', '==', uid));
        return onSnapshot(
            q,
            snap => {
                setItems(snap.docs.map(d => d.data() as MemoryItem).filter(m => m.Organization_ID === organizationId));
                setLoading(false);
            },
            err => {
                console.error('Bilježnica:', err);
                setError('Bilježnica se ne može učitati.');
                setLoading(false);
            },
        );
    }, [organizationId]);

    const toggleResolved = async (m: MemoryItem, resolved: boolean) => {
        const now = new Date().toISOString();
        try {
            await updateDoc(doc(db, COLLECTIONS.MEMORY_ITEMS, m.Item_ID), {
                State: resolved ? 'resolved' : 'open',
                Updated_At: now,
                Resolved_At: resolved ? now : deleteField(),
                History: [...(m.History || []), {
                    At: now,
                    Text: resolved ? 'Označeno kao riješeno u aplikaciji' : 'Vraćeno u otvoreno u aplikaciji',
                    By: 'ja',
                }],
            });
        } catch (e) {
            console.error('Bilježnica — izmjena:', e);
            setError('Izmjena nije sačuvana.');
        }
    };

    const remove = async (m: MemoryItem) => {
        if (!window.confirm(`Obrisati „${m.Title}" iz bilježnice?`)) return;
        try {
            await deleteDoc(doc(db, COLLECTIONS.MEMORY_ITEMS, m.Item_ID));
        } catch (e) {
            console.error('Bilježnica — brisanje:', e);
            setError('Brisanje nije uspjelo.');
        }
    };

    return (
        <>
            {error && <div className="nb-empty" role="alert">{error}</div>}
            <NotebookPanel items={items} loading={loading} onToggleResolved={toggleResolved} onDelete={remove} />
        </>
    );
}
