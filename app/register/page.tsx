'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { signUp, signInWithGoogle } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default function RegisterPage() {
    const router = useRouter();
    const [formData, setFormData] = useState({
        organizationName: '',
        userName: '',
        email: '',
        password: '',
        confirmPassword: '',
        acceptTerms: false,
    });
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value,
        }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        // Validation
        if (formData.password !== formData.confirmPassword) {
            setError('Lozinke se ne podudaraju.');
            return;
        }

        if (formData.password.length < 6) {
            setError('Lozinka mora imati najmanje 6 karaktera.');
            return;
        }

        if (!formData.acceptTerms) {
            setError('Morate prihvatiti uvjete korištenja.');
            return;
        }

        setLoading(true);

        const result = await signUp(
            formData.email,
            formData.password,
            formData.organizationName,
            formData.userName
        );

        if (result.success) {
            router.push('/');
        } else {
            setError(result.error || 'Greška pri registraciji');
        }

        setLoading(false);
    };

    const handleGoogleSignIn = async () => {
        setError('');
        setLoading(true);

        const result = await signInWithGoogle();

        if (result.success) {
            if (result.isNewUser) {
                router.push('/onboarding');
            } else {
                router.push('/');
            }
        } else {
            setError(result.error || 'Greška pri Google prijavi');
        }

        setLoading(false);
    };

    return (
        <div className="auth-page">
            <div className="auth-card register-card">
                <div className="auth-header">
                    <span className="material-icons-round auth-logo">factory</span>
                    <h1>Kreirajte račun</h1>
                    <p>Započnite besplatno probno razdoblje</p>
                </div>

                {error && (
                    <div className="auth-error">
                        <span className="material-icons-round">error</span>
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit} className="auth-form">
                    <div className="form-group">
                        <label htmlFor="organizationName">Naziv firme</label>
                        <input
                            type="text"
                            id="organizationName"
                            name="organizationName"
                            value={formData.organizationName}
                            onChange={handleChange}
                            placeholder="Moja Firma d.o.o."
                            required
                            disabled={loading}
                        />
                    </div>

                    <div className="form-group">
                        <label htmlFor="userName">Vaše ime</label>
                        <input
                            type="text"
                            id="userName"
                            name="userName"
                            value={formData.userName}
                            onChange={handleChange}
                            placeholder="Ime i prezime"
                            required
                            disabled={loading}
                        />
                    </div>

                    <div className="form-group">
                        <label htmlFor="email">Email adresa</label>
                        <input
                            type="email"
                            id="email"
                            name="email"
                            value={formData.email}
                            onChange={handleChange}
                            placeholder="vasa@email.com"
                            required
                            disabled={loading}
                        />
                    </div>

                    <div className="form-row">
                        <div className="form-group">
                            <label htmlFor="password">Lozinka</label>
                            <input
                                type="password"
                                id="password"
                                name="password"
                                value={formData.password}
                                onChange={handleChange}
                                placeholder="••••••••"
                                required
                                disabled={loading}
                            />
                        </div>

                        <div className="form-group">
                            <label htmlFor="confirmPassword">Potvrdite lozinku</label>
                            <input
                                type="password"
                                id="confirmPassword"
                                name="confirmPassword"
                                value={formData.confirmPassword}
                                onChange={handleChange}
                                placeholder="••••••••"
                                required
                                disabled={loading}
                            />
                        </div>
                    </div>

                    <div className="form-checkbox">
                        <input
                            type="checkbox"
                            id="acceptTerms"
                            name="acceptTerms"
                            checked={formData.acceptTerms}
                            onChange={handleChange}
                            disabled={loading}
                        />
                        <label htmlFor="acceptTerms">
                            Prihvaćam <Link href="/terms">uvjete korištenja</Link> i{' '}
                            <Link href="/privacy">politiku privatnosti</Link>
                        </label>
                    </div>

                    <button
                        type="submit"
                        className="auth-button primary"
                        disabled={loading}
                    >
                        {loading ? (
                            <>
                                <span className="button-spinner"></span>
                                Kreiranje računa...
                            </>
                        ) : (
                            'Registriraj se'
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
                    Već imate račun?{' '}
                    <Link href="/login">Prijavite se</Link>
                </p>
            </div>
        </div>
    );
}
