'use client';

import { useState } from 'react';
import Link from 'next/link';
import { resetPassword } from '@/lib/auth';

export default function ForgotPasswordPage() {
    const [email, setEmail] = useState('');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setSuccess(false);
        setLoading(true);

        const result = await resetPassword(email);

        if (result.success) {
            setSuccess(true);
        } else {
            setError(result.error || 'Greška pri slanju emaila');
        }

        setLoading(false);
    };

    return (
        <div className="auth-page">
            <div className="auth-card">
                <div className="auth-header">
                    <span className="material-icons-round auth-logo">lock_reset</span>
                    <h1>Zaboravljena lozinka</h1>
                    <p>Unesite email adresu za reset lozinke</p>
                </div>

                {error && (
                    <div className="auth-error">
                        <span className="material-icons-round">error</span>
                        {error}
                    </div>
                )}

                {success ? (
                    <div className="auth-success">
                        <span className="material-icons-round">check_circle</span>
                        <h3>Email poslan!</h3>
                        <p>
                            Provjerite svoju email inbox za link za reset lozinke.
                            Ako ne vidite email, provjerite spam folder.
                        </p>
                        <Link href="/login" className="auth-button primary">
                            Nazad na prijavu
                        </Link>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="auth-form">
                        <div className="form-group">
                            <label htmlFor="email">Email adresa</label>
                            <input
                                type="email"
                                id="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="vasa@email.com"
                                required
                                disabled={loading}
                            />
                        </div>

                        <button
                            type="submit"
                            className="auth-button primary"
                            disabled={loading}
                        >
                            {loading ? (
                                <>
                                    <span className="button-spinner"></span>
                                    Slanje...
                                </>
                            ) : (
                                'Pošalji reset link'
                            )}
                        </button>
                    </form>
                )}

                <p className="auth-footer">
                    <Link href="/login">← Nazad na prijavu</Link>
                </p>
            </div>
        </div>
    );
}
