import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    label: string;
    icon?: React.ReactNode;
    error?: string;
    rightElement?: React.ReactNode;
}

export const Input: React.FC<InputProps> = ({
    label,
    icon,
    error,
    rightElement,
    id,
    className = '',
    ...props
}) => {
    return (
        <div className={`input-group ${className}`}>
            <label
                htmlFor={id}
                className="block text-sm font-medium text-slate-700 tracking-wide mb-2"
                style={{ color: '#334155', fontSize: '0.875rem', fontWeight: 500 }}
            >
                {label}
            </label>
            <div className="input-wrapper">
                {icon && (
                    <div className="input-icon">
                        {icon}
                    </div>
                )}
                <input
                    id={id}
                    className={`form-input ${icon ? 'with-icon' : ''} ${rightElement ? 'has-right-element' : ''} ${error ? 'error' : ''}`}
                    {...props}
                />
                {rightElement && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        {rightElement}
                    </div>
                )}
            </div>
            {error && (
                <p className="text-xs text-red-500 mt-1 animate-pulse" style={{ color: '#ef4444', fontSize: '0.75rem', marginTop: '0.25rem' }}>{error}</p>
            )}
        </div>
    );
};
