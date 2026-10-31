'use client';

import { useEffect, useState, type CSSProperties } from 'react';

// ════════════════════════════════════════════════════════════════════
// BROJ S DECIMALAMA U TABELI (npr. 0,3 dana)
//
// Kontrolisani <input type="number"> s `parseInt`/`parseFloat` na svaki
// znak gubi međustanja: „0," ili „0." se odmah pretvori u 0 i polje se
// isprazni, pa se 0,5 ne može ni otkucati. Ovdje polje drži ono što je
// otkucano, a roditelju šalje broj čim je valjan. Zarez i tačka su isti.
// ════════════════════════════════════════════════════════════════════

/** „0,5" / „0.5" / „1" → broj; prazno ili nevaljano → null. */
export function parseDecimal(text: string): number | null {
    const t = text.trim().replace(',', '.');
    if (!t || t === '.' || t === '-') return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
}

interface DecimalInputProps {
    value: number;
    onChange: (value: number) => void;
    /** Najviše decimala koje se zadrže (default 2). */
    decimals?: number;
    min?: number;
    disabled?: boolean;
    placeholder?: string;
    className?: string;
    style?: CSSProperties;
    title?: string;
}

const show = (n: number) => (n ? String(n).replace('.', ',') : '');

export default function DecimalInput({ value, onChange, decimals = 2, min = 0, disabled, placeholder = '0', className, style, title }: DecimalInputProps) {
    const [text, setText] = useState(show(value));

    // Vrijednost spolja (npr. „Primijeni na sve") — samo kad se ne slaže s otkucanim.
    useEffect(() => {
        if (parseDecimal(text) !== value && !(value === 0 && parseDecimal(text) === null)) setText(show(value));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    return (
        <input
            type="text"
            inputMode="decimal"
            className={className}
            style={style}
            title={title}
            value={text}
            disabled={disabled}
            placeholder={placeholder}
            onChange={e => {
                const raw = e.target.value;
                if (!/^[0-9]*[.,]?[0-9]*$/.test(raw)) return;
                setText(raw);
                const n = parseDecimal(raw);
                const f = 10 ** decimals;
                onChange(n === null ? 0 : Math.max(min, Math.round(n * f) / f));
            }}
            onBlur={() => setText(show(value))}
        />
    );
}
