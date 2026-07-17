// ════════════════════════════════════════════════════════════════════
// PRINT PITANJA/NAPOMENA PROJEKTA — čist, jednostavan A4 dokument.
//
// Layout: naziv projekta na vrhu, pa grupe po proizvodu; svako pitanje ima
// primaoca (Klijent/Dobavljač/…), tekst i prostor za odgovor — bilo upisan,
// bilo prazna linija za ručno popunjavanje na terenu. Namjerno bez boja pozadine
// da ostane čitljivo i na crno-bijelom štampaču.
// ════════════════════════════════════════════════════════════════════

import { noteStatus, type ProductNotesGroup } from '@/lib/productNotes';
import { PRODUCT_NOTE_AUDIENCE_LABELS } from '@/lib/types';

const esc = (s: string) => (s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export function buildProjectNotesPrintHTML(projectName: string, groups: ProductNotesGroup[]): string {
    const today = new Date().toLocaleDateString('hr-HR');
    const totalNotes = groups.reduce((n, g) => n + g.notes.length, 0);

    const groupsHTML = groups.map(g => {
        const rows = g.notes.map((note, i) => {
            const st = noteStatus(note);
            const stLabel = st === 'resolved' ? 'Riješeno' : st === 'answered' ? 'Odgovoreno' : 'Otvoreno';
            const answerHTML = note.Answer
                ? `<div class="ans"><span class="ans-label">Odgovor:</span> ${esc(note.Answer)}</div>`
                : `<div class="ans blank"><span class="ans-label">Odgovor:</span> <span class="ans-line"></span></div>`;
            return `
                <div class="note ${st === 'resolved' ? 'is-done' : ''}">
                    <div class="note-top">
                        <span class="note-num">${i + 1}.</span>
                        <span class="aud aud-${note.Audience}">${PRODUCT_NOTE_AUDIENCE_LABELS[note.Audience]}</span>
                        <span class="note-q">${esc(note.Text)}</span>
                        <span class="note-st st-${st}">${stLabel}</span>
                    </div>
                    ${answerHTML}
                </div>`;
        }).join('');
        return `
            <section class="group avoid-break">
                <div class="group-head">
                    <span class="group-name">${esc(g.productName)}</span>
                    <span class="group-count">${g.notes.length} ${g.notes.length === 1 ? 'pitanje' : 'pitanja'}</span>
                </div>
                ${rows}
            </section>`;
    }).join('');

    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Pitanja — ${esc(projectName)}</title>
<style>
    @page { size: A4 portrait; margin: 16mm 15mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; font-size: 10.5pt; color: #1d1d1f; line-height: 1.5; }
    .doc-head { border-bottom: 2pt solid #1a1a1a; padding-bottom: 8px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: flex-end; }
    .doc-title { font-size: 17pt; font-weight: 800; letter-spacing: -0.02em; }
    .doc-sub { font-size: 9pt; color: #666; text-transform: uppercase; letter-spacing: 1.5px; margin-top: 3px; }
    .doc-meta { text-align: right; font-size: 9pt; color: #555; }
    .doc-meta strong { color: #1d1d1f; }

    .group { margin-bottom: 16px; }
    .group-head { display: flex; align-items: baseline; gap: 10px; border-bottom: 1pt solid #333; padding-bottom: 4px; margin-bottom: 8px; }
    .group-name { font-size: 12pt; font-weight: 700; }
    .group-count { font-size: 8.5pt; color: #888; }

    .note { padding: 7px 0; border-bottom: 1px solid #eee; }
    .note:last-child { border-bottom: none; }
    .note.is-done { color: #86868b; }
    .note-top { display: flex; align-items: baseline; gap: 8px; }
    .note-num { color: #aaa; font-size: 9pt; font-variant-numeric: tabular-nums; min-width: 16px; }
    .note-q { flex: 1; font-weight: 600; font-size: 10.5pt; }
    .note.is-done .note-q { text-decoration: line-through; }

    .aud { font-size: 7.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; padding: 1px 7px; border-radius: 10px; border: 1pt solid; white-space: nowrap; }
    .aud-client { color: #0d47a1; border-color: #90caf9; }
    .aud-supplier { color: #e65100; border-color: #ffcc80; }
    .aud-colleague { color: #6a1b9a; border-color: #ce93d8; }
    .aud-other { color: #555; border-color: #ccc; }

    .note-st { font-size: 7.5pt; font-weight: 700; white-space: nowrap; }
    .note-st.st-open { color: #b71c1c; }
    .note-st.st-answered { color: #e65100; }
    .note-st.st-resolved { color: #1b5e20; }

    .ans { margin: 4px 0 0 24px; font-size: 9.5pt; color: #333; }
    .ans-label { font-size: 8pt; font-weight: 700; color: #888; text-transform: uppercase; letter-spacing: 0.03em; margin-right: 6px; }
    .ans.blank { color: #aaa; }
    .ans-line { display: inline-block; width: 60%; border-bottom: 1px dotted #bbb; height: 12px; vertical-align: bottom; }

    .avoid-break { page-break-inside: avoid; }
    .empty { text-align: center; color: #999; padding: 40px; font-size: 11pt; }
    @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head>
<body>
    <div class="doc-head">
        <div>
            <div class="doc-title">${esc(projectName)}</div>
            <div class="doc-sub">Pitanja i napomene</div>
        </div>
        <div class="doc-meta">
            <div>Datum: <strong>${today}</strong></div>
            <div>${groups.length} ${groups.length === 1 ? 'proizvod' : 'proizvoda'} · ${totalNotes} ${totalNotes === 1 ? 'pitanje' : 'pitanja'}</div>
        </div>
    </div>
    ${groupsHTML || '<div class="empty">Nema pitanja za prikaz.</div>'}
</body></html>`;
}
