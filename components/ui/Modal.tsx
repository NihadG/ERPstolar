'use client';

import { useState, useEffect, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useSwipeDismiss } from '@/components/tabs/mobile/useSwipe';
import { useIsMobile } from '@/hooks/useIsMobile';

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

    // Na telefonu je modal full-screen list — povlačenje nadolje ga zatvara,
    // isto kao sheetove. Na desktopu gest ne postoji.
    const isMobile = useIsMobile();
    const { sheetRef, backdropRef } = useSwipeDismiss(onClose, isMobile && isOpen);

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
                ref={backdropRef}
                className={`modal-overlay ${animationClass}`}
                onClick={onClose}
                style={overlayStyle}
            />
            <div
                ref={sheetRef}
                className={`modal ${sizeClass} ${animationClass}`}
                style={modalStyle}
            >
                {title && (
                    <div className="modal-header">
                        {/* Ručka: vidljiv nagovještaj da se modal može povući nadolje. */}
                        {isMobile && <span className="modal-grab" aria-hidden="true" />}
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

