'use client';

interface LoadingOverlayProps {
    visible: boolean;
}

export default function LoadingOverlay({ visible }: LoadingOverlayProps) {
    if (!visible) return null;

    return (
        <div className={`loading-overlay ${visible ? 'active' : ''}`}>
            <div className="spinner"></div>
        </div>
    );
}
