'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { signIn, signInWithGoogle } from '@/lib/auth';
import { ArtisticSide } from './components/ArtisticSide';
import { Input } from './components/ui/Input';
import { Button } from './components/ui/Button';
import { MailIcon, LockIcon, EyeIcon, EyeOffIcon, ArrowRightIcon, LogoIcon, AlertCircleIcon } from './icons';
import './login.css';

export const dynamic = 'force-dynamic';

export default function LoginPage() {
    const router = useRouter();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
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
            setLoading(false);
        }
    };

    const handleGoogleSignIn = async () => {
        setError('');
        setLoading(true);

        const result = await signInWithGoogle();

        if (result.success) {
            router.push('/');
        } else {
            setError(result.error || 'Greška pri Google prijavi');
            setLoading(false);
        }
    };

    return (
        <div className="login-page">
            {/* The Artistic Side (Mobile: Top Banner / Desktop: Right Side) */}
            <ArtisticSide />

            {/* The Form Side (Mobile: Bottom Sheet / Desktop: Left Side) */}
            <div className="form-side">
                <div className="login-card">
                    <div className="form-container">

                        {/* Header Section */}
                        <div style={{ marginBottom: '2rem' }}>
                            <div className="logo-container">
                                <LogoIcon className="w-6 h-6 text-white" style={{ width: '1.5rem', height: '1.5rem' }} />
                            </div>

                            <h1 style={{ fontSize: '1.875rem', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.025em', marginBottom: '0.5rem' }}>
                                <span className="lg:hidden" style={{ display: 'none' }}>Dobrodošli</span> {/* handled by CSS media query ideally, but for now fixed text */}
                                <span className="hidden lg:inline">Dobrodošli natrag</span>
                            </h1>
                            <p style={{ color: '#64748b', fontSize: '0.875rem' }}>
                                Unesite svoje podatke za pristup.
                            </p>
                        </div>

                        {/* Error Alert */}
                        {error && (
                            <div className="alert-error" role="alert">
                                <AlertCircleIcon className="w-5 h-5 flex-shrink-0" />
                                <span>{error}</span>
                            </div>
                        )}

                        {/* Form */}
                        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                            <Input
                                id="email"
                                type="email"
                                label="Email adresa"
                                placeholder="ime.prezime@tvrtka.hr"
                                icon={<MailIcon style={{ width: '1.25rem', height: '1.25rem' }} />}
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                disabled={loading}
                            />

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                <Input
                                    id="password"
                                    type={showPassword ? "text" : "password"}
                                    label="Lozinka"
                                    placeholder="••••••••"
                                    icon={<LockIcon style={{ width: '1.25rem', height: '1.25rem' }} />}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                    disabled={loading}
                                    rightElement={
                                        <button
                                            type="button"
                                            onClick={() => setShowPassword(!showPassword)}
                                            className="password-toggle"
                                        >
                                            {showPassword ? <EyeOffIcon style={{ width: '1.25rem', height: '1.25rem' }} /> : <EyeIcon style={{ width: '1.25rem', height: '1.25rem' }} />}
                                        </button>
                                    }
                                />
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem' }}>
                                    <div style={{ display: 'flex', alignItems: 'center' }}>
                                        <input
                                            id="remember-me"
                                            name="remember-me"
                                            type="checkbox"
                                            style={{ height: '1rem', width: '1rem', borderRadius: '0.25rem', color: '#0f172a', borderColor: '#cbd5e1' }}
                                        />
                                        <label htmlFor="remember-me" style={{ marginLeft: '0.5rem', display: 'block', fontSize: '0.875rem', color: '#475569', userSelect: 'none' }}>
                                            Zapamti me
                                        </label>
                                    </div>
                                    <Link href="/forgot-password" style={{ fontSize: '0.875rem', fontWeight: 500, color: '#0f172a', textDecoration: 'none' }}>
                                        Zaboravljena lozinka?
                                    </Link>
                                </div>
                            </div>

                            <Button type="submit" isLoading={loading} style={{ marginTop: '1rem' }}>
                                <span style={{ marginRight: '0.5rem' }}>Prijavi se</span>
                                <ArrowRightIcon style={{ width: '1rem', height: '1rem' }} />
                            </Button>
                        </form>

                        {/* Divider */}
                        <div className="divider">
                            <span>Opcije prijave</span>
                        </div>

                        {/* Social / Alternate Login */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                            <Button variant="secondary" type="button" onClick={handleGoogleSignIn} disabled={loading} style={{ fontSize: '0.875rem' }}>
                                <svg style={{ width: '1.25rem', height: '1.25rem', marginRight: '0.5rem' }} viewBox="0 0 24 24">
                                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                                </svg>
                                Google
                            </Button>
                            <Button variant="secondary" type="button" disabled={loading} style={{ fontSize: '0.875rem' }}>
                                <svg style={{ width: '1.25rem', height: '1.25rem', marginRight: '0.5rem', color: '#00a1f1' }} fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M0 0h11.377v11.372H0zM12.623 0H24v11.372H12.623zM0 12.623h11.377V24H0zM12.623 12.623H24V24H12.623z" />
                                </svg>
                                Microsoft
                            </Button>
                        </div>

                        <p style={{ textAlign: 'center', fontSize: '0.75rem', color: '#94a3b8', marginTop: '2rem', marginBottom: '1rem' }}>
                            &copy; 2025 Lumina ERP Systems
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
