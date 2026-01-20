'use client';

import { useState, useEffect, ReactNode } from 'react';

interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: ReactNode;
    footer?: ReactNode;
    size?: 'default' | 'large' | 'xl' | 'fullscreen';
    zIndex?: number; // For nested modals
}

export default function Modal({ isOpen, onClose, title, children, footer, size = 'default', zIndex }: ModalProps) {
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };

        if (isOpen) {
            document.addEventListener('keydown', handleEscape);
            document.body.style.overflow = 'hidden';
        }

        return () => {
            document.removeEventListener('keydown', handleEscape);
            document.body.style.overflow = '';
        };
    }, [isOpen, onClose]);

    const sizeClass = size === 'large' ? 'modal-large' :
        size === 'xl' ? 'modal-xl' :
            size === 'fullscreen' ? 'modal-fullscreen' : '';

    const overlayStyle = zIndex ? { zIndex: zIndex } : {};
    const modalStyle = zIndex ? { zIndex: zIndex + 1 } : {};

    return (
        <>
            <div
                className={`modal-overlay ${isOpen ? 'active' : ''}`}
                onClick={onClose}
                style={overlayStyle}
            />
            <div
                className={`modal ${sizeClass} ${isOpen ? 'active' : ''}`}
                style={modalStyle}
            >
                {title && (
                    <div className="modal-header">
                        <h2>{title}</h2>
                        <button className="modal-close" onClick={onClose}>
                            <span className="material-icons-round">close</span>
                        </button>
                    </div>
                )}
                <div className="modal-body">
                    {children}
                </div>
                {footer && (
                    <div className="modal-footer">
                        {footer}
                    </div>
                )}
            </div>
        </>
    );
}
