'use client';

import { useState, useEffect, ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: ReactNode;
    children: ReactNode;
    footer?: ReactNode;
    size?: 'default' | 'large' | 'xl' | 'fullscreen';
    zIndex?: number; // For nested modals
}

export default function Modal({ isOpen, onClose, title, children, footer, size = 'default', zIndex }: ModalProps) {
    const [shouldRender, setShouldRender] = useState(isOpen);
    const [animationClass, setAnimationClass] = useState('');
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
        return () => setMounted(false);
    }, []);

    useEffect(() => {
        if (isOpen) {
            setShouldRender(true);
            // Small delay to trigger animation
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    setAnimationClass('active');
                });
            });
        } else {
            setAnimationClass('');
            // Wait for animation to complete before unmounting
            const timer = setTimeout(() => setShouldRender(false), 200);
            return () => clearTimeout(timer);
        }
    }, [isOpen]);

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

    if (!mounted || !shouldRender) return null;

    const sizeClass = size === 'large' ? 'modal-large' :
        size === 'xl' ? 'modal-xl' :
            size === 'fullscreen' ? 'modal-fullscreen' : '';

    const overlayStyle = zIndex ? { zIndex: zIndex } : {};
    const modalStyle = zIndex ? { zIndex: zIndex + 1 } : {};

    return createPortal(
        <>
            <div
                className={`modal-overlay ${animationClass}`}
                onClick={onClose}
                style={overlayStyle}
            />
            <div
                className={`modal ${sizeClass} ${animationClass}`}
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
        </>,
        document.body
    );
}

