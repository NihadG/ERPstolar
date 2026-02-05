'use client';

interface ToastProps {
    message: string;
    type: 'success' | 'error' | 'info';
}

export default function Toast({ message, type }: ToastProps) {
    return (
        <div id="toast-container">
            <div className={`toast ${type}`}>
                <span className="material-icons-round">
                    {type === 'success' ? 'check_circle' : type === 'error' ? 'error' : 'info'}
                </span>
                {message}
            </div>
        </div>
    );
}
