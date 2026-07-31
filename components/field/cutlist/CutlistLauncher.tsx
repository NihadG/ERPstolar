'use client';

// ════════════════════════════════════════════════════════════════════
// POKRETAČ KROJNE LISTE — dijeljena kartica/red
//
// Isti ulaz za sve površine: radnikova „Danas" i „Ja", kontrolorov profil.
// Sam drži overlay, pa host samo ubaci <CutlistLauncher/>.
// ════════════════════════════════════════════════════════════════════

import { useState } from 'react';
import { Scissors, ChevronRight } from 'lucide-react';
import FieldCutlist from './FieldCutlist';
import './FieldCutlist.css';

export default function CutlistLauncher() {
    const [open, setOpen] = useState(false);
    return (
        <>
            <button type="button" className="fcl-launch" onClick={() => setOpen(true)}>
                <span className="fcl-launch-ic"><Scissors size={20} /></span>
                <span className="fcl-launch-txt">
                    <b>Krojna lista</b>
                    <small>Unesi komade i izračunaj raspored rezanja</small>
                </span>
                <ChevronRight size={20} className="fcl-launch-chev" />
            </button>
            {open && <FieldCutlist onClose={() => setOpen(false)} />}
        </>
    );
}
