'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { signIn, signInWithGoogle } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default function LoginPage() {
    const router = useRouter();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        const result = await signIn(email, password);

        if (result.success) {
            router.push('/');
        } else {
            setError(result.error || 'Greška pri prijavi');
        }

        setLoading(false);
    };

    const handleGoogleSignIn = async () => {
        setError('');
        setLoading(true);

        const result = await signInWithGoogle();

        if (result.success) {
            router.push('/');
        } else {
            setError(result.error || 'Greška pri Google prijavi');
        }

        setLoading(false);
    };

    return (
        <div className="auth-page">
            {/* Animated gradient blobs */}
            <div className="ambient-light">
                <div className="blob blob-1"></div>
                <div className="blob blob-2"></div>
                <div className="blob blob-3"></div>
            </div>

            {/* Main container */}
            <div className="auth-container">
                {/* Floating glass shards */}
                <div className="glass-shard glass-shard-1"></div>
                <div className="glass-shard glass-shard-2"></div>
                <div className="glass-shard glass-shard-3"></div>

                {/* Main glass card */}
                <div className="auth-card">
                    {/* Top highlight line */}
                    <div className="card-highlight"></div>

                    <div className="auth-header">
                        <div className="auth-logo-container">
                            <span className="material-icons-round auth-logo">factory</span>
                        </div>
                        <h1>Dobrodošli natrag</h1>
                        <p>Prijavite se na svoj račun</p>
                    </div>

                    {error && (
                        <div className="auth-error">
                            <span className="material-icons-round">error</span>
                            {error}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="auth-form">
                        <div className="form-group">
                            <label htmlFor="email">Email adresa</label>
                            <div className="input-wrapper">
                                <input
                                    type="email"
                                    id="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="vasa@email.com"
                                    required
                                    disabled={loading}
                                />
                                <span className="input-icon material-icons-round">mail</span>
                            </div>
                        </div>

                        <div className="form-group">
                            <div className="label-row">
                                <label htmlFor="password">Lozinka</label>
                                <Link href="/forgot-password" className="forgot-password-link">
                                    Zaboravljena?
                                </Link>
                            </div>
                            <div className="input-wrapper">
                                <input
                                    type="password"
                                    id="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="••••••••"
                                    required
                                    disabled={loading}
                                />
                                <span className="input-icon material-icons-round">lock</span>
                            </div>
                        </div>

                        <button
                            type="submit"
                            className="auth-button primary"
                            disabled={loading}
                        >
                            {loading ? (
                                <>
                                    <span className="button-spinner"></span>
                                    Prijava u tijeku...
                                </>
                            ) : (
                                <>
                                    <span>Prijavi se</span>
                                    <span className="material-icons-round">arrow_forward</span>
                                </>
                            )}
                        </button>
                    </form>

                    <div className="auth-divider">
                        <span>ili</span>
                    </div>

                    <button
                        onClick={handleGoogleSignIn}
                        className="auth-button google"
                        disabled={loading}
                    >
                        <svg viewBox="0 0 24 24" width="20" height="20">
                            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                        </svg>
                        Nastavi sa Google
                    </button>

                    <p className="auth-footer">
                        Nemate račun?{' '}
                        <Link href="/register">Registrirajte se</Link>
                    </p>
                </div>
            </div>
        </div>
    );
}
