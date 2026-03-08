const fs = require('fs');
const path = require('path');

const dir = 'c:\\Users\\Nihad\\OneDrive\\Desktop\\Aplikacije\\ERP V4\\components\\ui';

try {
    // ═══════════════════════════════════════
    // GLASS MODAL STYLES
    // ═══════════════════════════════════════
    const glassPath = path.join(dir, 'GlassModal.tsx');
    let glassCode = fs.readFileSync(glassPath, 'utf8');

    const newGlassCSS = `
            <style jsx global>{\`
                .gm {
                    display: flex;
                    flex-direction: column;
                    gap: 16px;
                    max-width: 680px;
                    margin: 0 auto;
                    width: 100%;
                }

                /* Header */
                .gm-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 16px;
                    padding: 16px 20px;
                    background: linear-gradient(135deg, #f8fafc 0%, #f0f4f8 100%);
                    border: 1px solid #e2e8f0;
                    border-radius: 14px;
                    flex-wrap: wrap;
                }
                .gm-header-left {
                    display: flex;
                    align-items: center;
                    gap: 14px;
                    min-width: 0;
                    flex: 1;
                }
                .gm-mat-icon {
                    width: 42px; height: 42px;
                    border-radius: 12px;
                    background: linear-gradient(135deg, #3b82f6, #2563eb);
                    display: flex; align-items: center; justify-content: center;
                    flex-shrink: 0;
                }
                .gm-mat-icon .material-icons-round { font-size: 20px; color: white; }
                .gm-header-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
                .gm-name {
                    font-size: 16px; font-weight: 700; color: #0f172a;
                    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                }
                .gm-supplier { font-size: 13px; color: #64748b; font-weight: 500; }
                .gm-price-input {
                    display: flex; flex-direction: column;
                    align-items: flex-end; gap: 4px; flex-shrink: 0;
                }
                .gm-price-label {
                    font-size: 11px; font-weight: 600; color: #94a3b8;
                    text-transform: uppercase; letter-spacing: 0.04em;
                }
                .gm-price-field {
                    display: flex; align-items: center;
                    background: white; border: 1px solid #d1d5db;
                    border-radius: 10px; overflow: hidden; transition: all 0.2s;
                }
                .gm-price-field:focus-within {
                    border-color: #3b82f6;
                    box-shadow: 0 0 0 3px rgba(59,130,246,0.12);
                }
                .gm-price-field input {
                    width: 72px; padding: 8px 10px; border: none;
                    font-size: 15px; font-weight: 700; text-align: right;
                    background: transparent; color: #0f172a; outline: none;
                }
                .gm-price-unit {
                    padding: 8px 10px 8px 2px; font-size: 12px;
                    font-weight: 600; color: #94a3b8; white-space: nowrap;
                }

                /* Item Cards */
                .gm-items { display: flex; flex-direction: column; gap: 10px; }
                .gm-card {
                    background: white; border: 1px solid #e5e7eb;
                    border-radius: 14px; overflow: hidden;
                    transition: all 0.2s; box-shadow: 0 1px 3px rgba(0,0,0,0.03);
                }
                .gm-card:hover { border-color: #cbd5e1; box-shadow: 0 2px 8px rgba(0,0,0,0.05); }
                .gm-card.gm-card-active {
                    border-color: #93c5fd;
                    box-shadow: 0 0 0 2px rgba(59,130,246,0.08);
                }
                .gm-card-header {
                    display: flex; align-items: center;
                    justify-content: space-between; padding: 10px 14px 0;
                }
                .gm-card-num {
                    width: 24px; height: 24px; border-radius: 8px;
                    background: #f1f5f9; color: #475569;
                    font-size: 12px; font-weight: 700;
                    display: flex; align-items: center; justify-content: center;
                }
                .gm-card-actions { display: flex; gap: 4px; }
                .gm-act-btn {
                    display: flex; align-items: center; justify-content: center;
                    width: 30px; height: 30px; border: none; border-radius: 8px;
                    background: transparent; color: #94a3b8; cursor: pointer;
                    transition: all 0.15s; padding: 0;
                }
                .gm-act-btn .material-icons-round { font-size: 18px; }
                .gm-act-btn:hover:not(:disabled) { background: #f1f5f9; color: #475569; }
                .gm-act-btn.has-note { color: #3b82f6; }
                .gm-act-del:hover:not(:disabled) { background: #fef2f2; color: #ef4444; }
                .gm-act-btn:disabled { opacity: 0.25; cursor: not-allowed; }

                /* Card body fields */
                .gm-card-body {
                    display: grid;
                    grid-template-columns: 60px 1fr 1fr 1fr auto;
                    gap: 8px; padding: 10px 14px; align-items: end;
                }
                .gm-field { display: flex; flex-direction: column; gap: 4px; }
                .gm-field > label {
                    font-size: 10px; font-weight: 700; color: #94a3b8;
                    text-transform: uppercase; letter-spacing: 0.05em; padding-left: 2px;
                }
                .gm-field input[type="number"] {
                    width: 100%; padding: 8px 10px;
                    border: 1px solid #d1d5db; border-radius: 8px;
                    font-size: 14px; font-weight: 600; color: #0f172a;
                    background: #f9fafb; outline: none; transition: all 0.15s;
                    box-sizing: border-box;
                }
                .gm-field input:hover { background: #f1f5f9; }
                .gm-field input:focus {
                    background: white; border-color: #3b82f6;
                    box-shadow: 0 0 0 3px rgba(59,130,246,0.1);
                }
                .gm-field-qty input { text-align: center; }
                .gm-input-unit {
                    display: flex; align-items: center;
                    border: 1px solid #d1d5db; border-radius: 8px;
                    background: #f9fafb; overflow: hidden; transition: all 0.15s;
                }
                .gm-input-unit:hover { background: #f1f5f9; }
                .gm-input-unit:focus-within {
                    background: white; border-color: #3b82f6;
                    box-shadow: 0 0 0 3px rgba(59,130,246,0.1);
                }
                .gm-input-unit input {
                    flex: 1; padding: 8px 10px; border: none;
                    background: transparent; font-size: 14px; font-weight: 600;
                    color: #0f172a; outline: none; min-width: 0;
                }
                .gm-input-unit span {
                    padding: 8px 8px 8px 0; font-size: 11px;
                    font-weight: 600; color: #94a3b8; flex-shrink: 0;
                }

                /* Edge toggle */
                .gm-field-edge { min-width: 72px; }
                .gm-edge-toggle {
                    display: inline-flex; align-items: center; gap: 6px;
                    padding: 7px 12px; border: 1px solid transparent;
                    border-radius: 20px; cursor: pointer;
                    transition: all 0.2s; white-space: nowrap;
                    font-size: 12px; font-weight: 700;
                }
                .gm-edge-toggle.on { background: #dbeafe; color: #1d4ed8; border-color: #bfdbfe; }
                .gm-edge-toggle.off { background: #f3f4f6; color: #94a3b8; border-color: #e5e7eb; }
                .gm-edge-dot {
                    width: 8px; height: 8px; border-radius: 50%; transition: background 0.2s;
                }
                .gm-edge-toggle.on .gm-edge-dot { background: #3b82f6; }
                .gm-edge-toggle.off .gm-edge-dot { background: #cbd5e1; }
                .gm-edge-toggle:hover { filter: brightness(0.95); transform: translateY(-1px); }
                .gm-edge-toggle:active { transform: translateY(0); }

                /* Card footer */
                .gm-card-footer {
                    display: flex; align-items: center;
                    justify-content: flex-end; gap: 16px;
                    padding: 8px 14px 10px; border-top: 1px solid #f1f5f9;
                }
                .gm-card-stat { display: flex; align-items: center; gap: 6px; }
                .gm-card-stat-label { font-size: 11px; font-weight: 500; color: #94a3b8; }
                .gm-card-stat-value {
                    font-size: 13px; font-weight: 700; color: #475569;
                    font-variant-numeric: tabular-nums;
                }
                .gm-card-stat-price .gm-card-stat-value { color: #0f172a; font-size: 14px; }

                /* Note */
                .gm-note-row { padding: 0 14px 12px; }
                .gm-note-input {
                    width: 100%; padding: 10px 14px;
                    border: 1px solid #93c5fd; border-radius: 10px;
                    font-size: 13px; font-weight: 500; color: #0f172a;
                    background: #eff6ff; outline: none; transition: all 0.15s;
                    box-sizing: border-box;
                }
                .gm-note-input:focus {
                    background: white; border-color: #3b82f6;
                    box-shadow: 0 0 0 3px rgba(59,130,246,0.1);
                }

                /* Add button */
                .gm-add {
                    display: flex; align-items: center; justify-content: center;
                    gap: 8px; padding: 12px; background: transparent;
                    border: 2px dashed #d1d5db; border-radius: 12px;
                    font-size: 14px; font-weight: 600; color: #6b7280;
                    cursor: pointer; transition: all 0.2s;
                }
                .gm-add .material-icons-round { font-size: 20px; }
                .gm-add:hover { border-color: #3b82f6; color: #3b82f6; background: #eff6ff; }
                .gm-add:active { transform: scale(0.99); }

                /* Summary */
                .gm-summary {
                    display: flex; align-items: center;
                    justify-content: space-between; padding: 14px 18px;
                    background: #f8fafc; border: 1px solid #e2e8f0;
                    border-radius: 14px; gap: 16px; flex-wrap: wrap;
                }
                .gm-summary-stats { display: flex; gap: 20px; }
                .gm-summary-chip { display: flex; align-items: baseline; gap: 4px; }
                .gm-summary-chip-val { font-size: 18px; font-weight: 800; color: #0f172a; }
                .gm-summary-chip-label { font-size: 13px; font-weight: 500; color: #64748b; }
                .gm-summary-total {
                    display: flex; align-items: center; gap: 10px;
                    padding: 8px 16px; background: #2563eb;
                    border-radius: 10px;
                    box-shadow: 0 4px 6px -1px rgba(37,99,235,0.2);
                }
                .gm-summary-total-label { font-size: 12px; font-weight: 500; color: rgba(255,255,255,0.7); }
                .gm-summary-total-val { font-size: 17px; font-weight: 800; color: white; }

                /* Mobile */
                @media (max-width: 640px) {
                    .gm { gap: 12px; }
                    .gm-header { flex-direction: column; align-items: stretch; gap: 12px; }
                    .gm-price-input { flex-direction: row; align-items: center; justify-content: space-between; }
                    .gm-card-body { grid-template-columns: 1fr 1fr; gap: 10px; }
                    .gm-field-qty, .gm-field-thick, .gm-field-edge { grid-column: 1 / -1; }
                    .gm-field-edge { flex-direction: row; align-items: center; justify-content: space-between; gap: 8px; }
                    .gm-card-footer { justify-content: space-between; }
                    .gm-summary { flex-direction: column; align-items: stretch; gap: 12px; }
                    .gm-summary-stats { justify-content: space-around; }
                    .gm-summary-total { justify-content: center; }
                }
            \`}</style>
`;
    glassCode = glassCode.replace(/<style jsx(?: global)?>\{`[\s\S]*?`\}<\/style>/, newGlassCSS.trim());
    fs.writeFileSync(glassPath, glassCode);

    // ═══════════════════════════════════════
    // ALU DOOR MODAL STYLES
    // ═══════════════════════════════════════
    const aluPath = path.join(dir, 'AluDoorModal.tsx');
    let aluCode = fs.readFileSync(aluPath, 'utf8');

    const newAluCSS = `
            <style jsx global>{\`
                .am {
                    display: flex; flex-direction: column; gap: 16px;
                    max-width: 680px; margin: 0 auto; width: 100%;
                }

                /* Header */
                .am-header {
                    display: flex; align-items: center;
                    justify-content: space-between; gap: 16px;
                    padding: 16px 20px;
                    background: linear-gradient(135deg, #f8fafc 0%, #f0f4f8 100%);
                    border: 1px solid #e2e8f0; border-radius: 14px; flex-wrap: wrap;
                }
                .am-header-left { display: flex; align-items: center; gap: 14px; min-width: 0; flex: 1; }
                .am-mat-icon {
                    width: 42px; height: 42px; border-radius: 12px;
                    background: linear-gradient(135deg, #6366f1, #4f46e5);
                    display: flex; align-items: center; justify-content: center; flex-shrink: 0;
                }
                .am-mat-icon .material-icons-round { font-size: 20px; color: white; }
                .am-header-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
                .am-name {
                    font-size: 16px; font-weight: 700; color: #0f172a;
                    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                }
                .am-supplier { font-size: 13px; font-weight: 500; color: #64748b; }
                .am-price-input { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex-shrink: 0; }
                .am-price-label { font-size: 11px; font-weight: 600; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.04em; }
                .am-price-field {
                    display: flex; align-items: center; background: white;
                    border: 1px solid #d1d5db; border-radius: 10px; overflow: hidden; transition: all 0.2s;
                }
                .am-price-field:focus-within { border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99,102,241,0.12); }
                .am-price-field input {
                    width: 72px; padding: 8px 10px; border: none;
                    font-size: 15px; font-weight: 700; text-align: right;
                    background: transparent; color: #0f172a; outline: none;
                }
                .am-price-unit { padding: 8px 10px 8px 2px; font-size: 12px; font-weight: 600; color: #94a3b8; white-space: nowrap; }

                /* Tabs */
                .am-tabs {
                    display: flex; gap: 6px; overflow-x: auto; padding: 6px;
                    background: #f1f5f9; border-radius: 12px; border: 1px solid #e2e8f0;
                    -ms-overflow-style: none; scrollbar-width: none;
                }
                .am-tabs::-webkit-scrollbar { display: none; }
                .am-tab {
                    display: flex; align-items: center; gap: 8px;
                    padding: 8px 14px; background: transparent; border: none;
                    border-radius: 8px; font-size: 13px; font-weight: 600;
                    color: #64748b; cursor: pointer; transition: all 0.2s; white-space: nowrap;
                }
                .am-tab:hover:not(.active):not(.am-tab-add) { background: #e2e8f0; color: #334155; }
                .am-tab.active { background: white; color: #0f172a; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
                .am-tab-num {
                    width: 20px; height: 20px; display: flex; align-items: center; justify-content: center;
                    background: #cbd5e1; color: #475569; border-radius: 50%;
                    font-size: 11px; font-weight: 700; transition: all 0.2s;
                }
                .am-tab.active .am-tab-num { background: #4f46e5; color: white; }
                .am-tab-dims { font-size: 12px; opacity: 0.9; }
                .am-tab-del {
                    display: flex; align-items: center; justify-content: center;
                    width: 20px; height: 20px; border: none; border-radius: 50%;
                    background: #f1f5f9; color: #94a3b8; cursor: pointer; padding: 0;
                    margin-left: 4px; transition: all 0.2s;
                }
                .am-tab-del:hover { background: #fee2e2; color: #ef4444; }
                .am-tab-del .material-icons-round { font-size: 14px; }
                .am-tab-add { border: 2px dashed #cbd5e1 !important; color: #64748b !important; padding: 6px 14px; }
                .am-tab-add:hover { color: #4f46e5 !important; border-color: #a5b4fc !important; background: #eef2ff !important; }
                .am-tab-add .material-icons-round { font-size: 20px; }

                /* Form */
                .am-form {
                    background: white; border: 1px solid #e5e7eb; border-radius: 14px;
                    padding: 20px; display: flex; flex-direction: column; gap: 4px;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.02);
                }
                .am-section { display: flex; flex-direction: column; gap: 12px; padding: 14px 0; border-bottom: 1px solid #f1f5f9; }
                .am-section:first-child { padding-top: 0; }
                .am-section:last-of-type { border-bottom: none; }
                .am-section-title {
                    display: flex; align-items: center; gap: 8px;
                    font-size: 12px; font-weight: 700; color: #94a3b8;
                    text-transform: uppercase; letter-spacing: 0.06em;
                }
                .am-section-title .material-icons-round { font-size: 16px; color: #c0c9d4; }
                .am-row { display: grid; gap: 12px; }
                .am-row-2 { grid-template-columns: 1fr 1fr; }
                .am-row-3 { grid-template-columns: 1fr 1fr 1fr; }
                .am-field { display: flex; flex-direction: column; gap: 6px; }
                .am-field-full { grid-column: 1 / -1; }
                .am-field > label {
                    font-size: 11px; font-weight: 700; color: #94a3b8;
                    text-transform: uppercase; letter-spacing: 0.04em; padding-left: 2px;
                }
                .am-field input[type="text"],
                .am-field input[type="number"],
                .am-field select {
                    appearance: none; padding: 10px 12px;
                    border: 1px solid #d1d5db; border-radius: 10px;
                    font-size: 14px; font-weight: 600; background: #f9fafb;
                    color: #0f172a; outline: none; transition: all 0.15s;
                    box-sizing: border-box; width: 100%;
                }
                .am-field select {
                    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
                    background-repeat: no-repeat; background-position: right 12px center; padding-right: 34px;
                }
                .am-field input:hover, .am-field select:hover { background: #f1f5f9; }
                .am-field input:focus, .am-field select:focus {
                    background: white; border-color: #6366f1;
                    box-shadow: 0 0 0 3px rgba(99,102,241,0.1);
                }

                /* Segmented controls */
                .seg-group { display: flex; background: #f1f5f9; border-radius: 10px; padding: 3px; gap: 2px; }
                .seg-btn {
                    flex: 1; padding: 9px 10px; border: none; background: transparent;
                    border-radius: 8px; font-size: 13px; font-weight: 600;
                    color: #64748b; cursor: pointer; transition: all 0.2s;
                    white-space: nowrap; text-align: center; user-select: none;
                }
                .seg-btn.active {
                    background: white; color: #0f172a;
                    box-shadow: 0 1px 4px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04);
                }
                .seg-btn:hover:not(.active) { color: #334155; background: rgba(255,255,255,0.5); }

                /* Toggle switch */
                .am-field-toggle { justify-content: flex-start; }
                .am-toggle {
                    display: flex; align-items: center; gap: 10px;
                    padding: 8px 14px; border: 1px solid #e5e7eb; border-radius: 10px;
                    background: #f8fafc; cursor: pointer; transition: all 0.2s; user-select: none;
                }
                .am-toggle:hover { border-color: #cbd5e1; background: white; }
                .am-toggle-track {
                    position: relative; width: 36px; height: 20px;
                    border-radius: 999px; background: #cbd5e1; transition: background 0.25s; flex-shrink: 0;
                }
                .am-toggle.on .am-toggle-track { background: #6366f1; }
                .am-toggle-thumb {
                    position: absolute; top: 2px; left: 2px; width: 16px; height: 16px;
                    border-radius: 50%; background: white;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.15);
                    transition: transform 0.25s cubic-bezier(0.4,0,0.2,1);
                }
                .am-toggle.on .am-toggle-thumb { transform: translateX(16px); }
                .am-toggle-label { font-size: 14px; font-weight: 600; color: #64748b; transition: color 0.2s; }
                .am-toggle.on .am-toggle-label { color: #4f46e5; }

                /* Hinge positions */
                .am-hinges {
                    display: flex; flex-direction: column; gap: 10px;
                    padding: 14px 16px; background: #fafbfc;
                    border-radius: 12px; border: 1px dashed #cbd5e1;
                }
                .am-hinges-label { font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em; }
                .am-hinges-list { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
                .am-hinge-chip {
                    display: flex; align-items: center; background: white;
                    border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; transition: all 0.15s;
                }
                .am-hinge-chip:focus-within { border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99,102,241,0.1); }
                .am-hinge-chip input {
                    width: 56px; padding: 8px 10px; border: none; background: transparent;
                    font-size: 14px; font-weight: 600; text-align: center; outline: none; color: #0f172a;
                }
                .am-hinge-chip button {
                    display: flex; align-items: center; justify-content: center;
                    width: 30px; height: 100%; border: none;
                    border-left: 1px solid #f1f5f9; background: transparent;
                    color: #94a3b8; cursor: pointer; padding: 0; transition: all 0.15s;
                }
                .am-hinge-chip button:hover { background: #fef2f2; color: #ef4444; }
                .am-hinge-chip button .material-icons-round { font-size: 14px; }
                .am-hinge-add {
                    display: flex; align-items: center; justify-content: center;
                    height: 36px; padding: 0 14px; border: 2px dashed #cbd5e1;
                    border-radius: 8px; background: transparent; color: #94a3b8;
                    font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.15s;
                }
                .am-hinge-add:hover { background: white; border-color: #6366f1; color: #6366f1; }
                .am-hinge-add .material-icons-round { font-size: 18px; }

                /* Item stats */
                .am-item-stats {
                    display: flex; gap: 20px; justify-content: flex-end;
                    padding: 14px 20px; margin: 4px -20px -20px;
                    border-top: 1px solid #f1f5f9; background: #fafbfc;
                    border-bottom-left-radius: 14px; border-bottom-right-radius: 14px; align-items: center;
                }
                .am-item-stat { display: flex; align-items: center; gap: 6px; }
                .am-item-stat-label { font-size: 12px; font-weight: 500; color: #94a3b8; }
                .am-item-stat-value { font-size: 14px; font-weight: 600; color: #475569; }
                .am-item-stat-price .am-item-stat-value { font-size: 16px; font-weight: 800; color: #0f172a; }

                /* Summary */
                .am-summary {
                    display: flex; align-items: center; justify-content: space-between;
                    padding: 14px 18px; background: #f8fafc;
                    border: 1px solid #e2e8f0; border-radius: 14px; gap: 16px; flex-wrap: wrap;
                }
                .am-summary-stats { display: flex; gap: 20px; }
                .am-summary-chip { display: flex; align-items: baseline; gap: 4px; }
                .am-summary-chip-val { font-size: 18px; font-weight: 800; color: #0f172a; }
                .am-summary-chip-label { font-size: 13px; font-weight: 500; color: #64748b; }
                .am-summary-total {
                    display: flex; align-items: center; gap: 10px;
                    padding: 8px 16px; background: #4f46e5; border-radius: 10px;
                    box-shadow: 0 4px 6px -1px rgba(79,70,229,0.2);
                }
                .am-summary-total-label { font-size: 12px; font-weight: 500; color: rgba(255,255,255,0.7); }
                .am-summary-total-val { font-size: 17px; font-weight: 800; color: white; }

                /* Mobile */
                @media (max-width: 640px) {
                    .am { gap: 12px; }
                    .am-header { flex-direction: column; align-items: stretch; gap: 12px; }
                    .am-price-input { flex-direction: row; align-items: center; justify-content: space-between; }
                    .am-row-2, .am-row-3 { grid-template-columns: 1fr; gap: 10px; }
                    .am-form { padding: 16px; border-radius: 14px; }
                    .am-item-stats { margin: 4px -16px -16px; padding: 14px 16px; justify-content: space-between; border-bottom-left-radius: 14px; border-bottom-right-radius: 14px; }
                    .am-summary { flex-direction: column; align-items: stretch; gap: 12px; }
                    .am-summary-stats { justify-content: space-around; }
                    .am-summary-total { justify-content: center; }
                }
            \`}</style>
`;
    aluCode = aluCode.replace(/<style jsx(?: global)?>\{`[\s\S]*?`\}<\/style>/, newAluCSS.trim());
    fs.writeFileSync(aluPath, aluCode);
    console.log("Success");
} catch (e) {
    console.error(e);
}
