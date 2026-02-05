'use client';

import React, { Component, ReactNode } from 'react';

// ============================================
// ERROR BOUNDARY TYPES
// ============================================

interface ErrorBoundaryProps {
    children: ReactNode;
    fallback?: ReactNode;
    onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface ErrorBoundaryState {
    hasError: boolean;
    error: Error | null;
    errorInfo: React.ErrorInfo | null;
}

// ============================================
// ERROR BOUNDARY COMPONENT
// ============================================

/**
 * Error Boundary komponenta za hvatanje JavaScript grešaka
 * u child komponentama i prikaz fallback UI-a
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps) {
        super(props);
        this.state = {
            hasError: false,
            error: null,
            errorInfo: null,
        };
    }

    static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
        this.setState({ errorInfo });

        // Log error to console (and potentially to external service)
        console.error('ErrorBoundary caught an error:', error, errorInfo);

        // Call custom error handler if provided
        if (this.props.onError) {
            this.props.onError(error, errorInfo);
        }

        // TODO: Send to error monitoring service (Sentry, etc.)
        // if (typeof window !== 'undefined' && window.Sentry) {
        //     window.Sentry.captureException(error, { extra: errorInfo });
        // }
    }

    handleRetry = (): void => {
        this.setState({
            hasError: false,
            error: null,
            errorInfo: null,
        });
    };

    render(): ReactNode {
        if (this.state.hasError) {
            // Custom fallback if provided
            if (this.props.fallback) {
                return this.props.fallback;
            }

            // Default fallback UI
            return (
                <div className="error-boundary">
                    <div className="error-boundary-content">
                        <div className="error-icon">⚠️</div>
                        <h2>Ups! Nešto je pošlo po krivu</h2>
                        <p>Došlo je do neočekivane greške. Molimo pokušajte ponovo.</p>

                        {process.env.NODE_ENV === 'development' && this.state.error && (
                            <details className="error-details">
                                <summary>Detalji greške (dev mode)</summary>
                                <pre>{this.state.error.toString()}</pre>
                                {this.state.errorInfo && (
                                    <pre>{this.state.errorInfo.componentStack}</pre>
                                )}
                            </details>
                        )}

                        <div className="error-actions">
                            <button
                                onClick={this.handleRetry}
                                className="error-retry-btn"
                            >
                                Pokušaj ponovo
                            </button>
                            <button
                                onClick={() => window.location.reload()}
                                className="error-reload-btn"
                            >
                                Osvježi stranicu
                            </button>
                        </div>
                    </div>

                    <style jsx>{`
                        .error-boundary {
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            min-height: 400px;
                            padding: 40px;
                            background: #f8fafc;
                            border-radius: 16px;
                            margin: 20px;
                        }

                        .error-boundary-content {
                            text-align: center;
                            max-width: 500px;
                        }

                        .error-icon {
                            font-size: 64px;
                            margin-bottom: 20px;
                        }

                        .error-boundary h2 {
                            font-size: 24px;
                            font-weight: 600;
                            color: #1d1d1f;
                            margin: 0 0 12px 0;
                        }

                        .error-boundary p {
                            font-size: 16px;
                            color: #86868b;
                            margin: 0 0 24px 0;
                        }

                        .error-details {
                            text-align: left;
                            background: #fff;
                            border: 1px solid #e5e5e5;
                            border-radius: 8px;
                            padding: 16px;
                            margin-bottom: 24px;
                            max-height: 200px;
                            overflow: auto;
                        }

                        .error-details summary {
                            font-weight: 500;
                            cursor: pointer;
                            color: #ff3b30;
                        }

                        .error-details pre {
                            font-size: 12px;
                            color: #86868b;
                            white-space: pre-wrap;
                            word-break: break-all;
                            margin: 8px 0 0 0;
                        }

                        .error-actions {
                            display: flex;
                            gap: 12px;
                            justify-content: center;
                        }

                        .error-retry-btn,
                        .error-reload-btn {
                            padding: 12px 24px;
                            border-radius: 8px;
                            font-size: 14px;
                            font-weight: 500;
                            cursor: pointer;
                            transition: all 0.2s;
                        }

                        .error-retry-btn {
                            background: #0071e3;
                            color: white;
                            border: none;
                        }

                        .error-retry-btn:hover {
                            background: #0077ed;
                        }

                        .error-reload-btn {
                            background: white;
                            color: #1d1d1f;
                            border: 1px solid #d2d2d7;
                        }

                        .error-reload-btn:hover {
                            background: #f5f5f7;
                        }
                    `}</style>
                </div>
            );
        }

        return this.props.children;
    }
}

// ============================================
// LIGHTWEIGHT ERROR FALLBACK
// ============================================

interface ErrorFallbackProps {
    error?: Error;
    resetError?: () => void;
    title?: string;
    message?: string;
}

/**
 * Lightweight error fallback komponenta
 * za korištenje sa ErrorBoundary
 */
export function ErrorFallback({
    error,
    resetError,
    title = 'Greška',
    message = 'Došlo je do greške pri učitavanju.',
}: ErrorFallbackProps): JSX.Element {
    return (
        <div style={{
            padding: '24px',
            textAlign: 'center',
            background: '#fff3f3',
            borderRadius: '12px',
            border: '1px solid #ffcccc',
        }}>
            <h3 style={{ color: '#c62828', marginBottom: '8px' }}>{title}</h3>
            <p style={{ color: '#86868b', marginBottom: '16px' }}>{message}</p>

            {error && process.env.NODE_ENV === 'development' && (
                <pre style={{
                    fontSize: '12px',
                    background: '#f5f5f5',
                    padding: '8px',
                    borderRadius: '4px',
                    marginBottom: '16px',
                    textAlign: 'left',
                    overflow: 'auto',
                }}>
                    {error.message}
                </pre>
            )}

            {resetError && (
                <button
                    onClick={resetError}
                    style={{
                        padding: '8px 16px',
                        background: '#0071e3',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                    }}
                >
                    Pokušaj ponovo
                </button>
            )}
        </div>
    );
}

// ============================================
// TAB ERROR BOUNDARY
// ============================================

interface TabErrorBoundaryProps {
    children: ReactNode;
    tabName: string;
}

/**
 * Specijalizirana Error Boundary za pojedinačne tabove
 * sa custom porukama za svaki tab
 */
export function TabErrorBoundary({ children, tabName }: TabErrorBoundaryProps): JSX.Element {
    return (
        <ErrorBoundary
            fallback={
                <ErrorFallback
                    title={`Greška u ${tabName}`}
                    message={`Nije moguće učitati ${tabName}. Osvježite stranicu ili kontaktirajte podršku.`}
                />
            }
        >
            {children}
        </ErrorBoundary>
    );
}

export default ErrorBoundary;
