'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

interface CompanyInfo {
    name: string;
    address: string;
    phone: string;
    email: string;
    idNumber: string;
    pdvNumber: string;
    website: string;
    logoBase64: string;
    hideNameWhenLogo: boolean;
}

interface AppSettings {
    currency: string;
    pdvRate: number;
    offerValidityDays: number;
    defaultOfferNote: string;
    offerTerms: string;
}

const DEFAULT_COMPANY: CompanyInfo = {
    name: 'Vaša Firma',
    address: 'Ulica i broj, Grad',
    phone: '+387 XX XXX XXX',
    email: 'info@firma.ba',
    idNumber: '',
    pdvNumber: '',
    website: '',
    logoBase64: '',
    hideNameWhenLogo: false
};

const DEFAULT_SETTINGS: AppSettings = {
    currency: 'KM',
    pdvRate: 17,
    offerValidityDays: 14,
    defaultOfferNote: 'Hvala na povjerenju!',
    offerTerms: 'Plaćanje: Avansno ili po dogovoru\nRok isporuke: Po dogovoru nakon potvrde'
};

export default function SettingsPage() {
    const router = useRouter();
    const { user, loading: authLoading, firebaseUser } = useAuth();
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [companyInfo, setCompanyInfo] = useState<CompanyInfo>(DEFAULT_COMPANY);
    const [appSettings, setAppSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
    const [activeSection, setActiveSection] = useState('company');

    // Load settings from localStorage
    useEffect(() => {
        if (typeof window !== 'undefined') {
            const savedCompany = localStorage.getItem('companyInfo');
            const savedSettings = localStorage.getItem('appSettings');

            if (savedCompany) {
                try {
                    setCompanyInfo({ ...DEFAULT_COMPANY, ...JSON.parse(savedCompany) });
                } catch (e) { /* ignore */ }
            }

            if (savedSettings) {
                try {
                    setAppSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(savedSettings) });
                } catch (e) { /* ignore */ }
            }
        }
    }, []);

    // Redirect to login if not authenticated
    useEffect(() => {
        if (!authLoading && !firebaseUser) {
            router.push('/login');
        }
    }, [authLoading, firebaseUser, router]);

    function showMessage(text: string, type: 'success' | 'error') {
        setMessage({ text, type });
        setTimeout(() => setMessage(null), 3000);
    }

    function handleSave() {
        setSaving(true);
        try {
            localStorage.setItem('companyInfo', JSON.stringify(companyInfo));
            localStorage.setItem('appSettings', JSON.stringify(appSettings));
            showMessage('Postavke sačuvane uspješno', 'success');
        } catch (error) {
            showMessage('Greška pri čuvanju postavki', 'error');
        }
        setSaving(false);
    }

    function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;

        // Check file size (max 500KB)
        if (file.size > 500 * 1024) {
            showMessage('Logo je prevelik. Maksimalno 500KB.', 'error');
            return;
        }

        // Check file type
        if (!file.type.startsWith('image/')) {
            showMessage('Dozvoljeni su samo formati slika.', 'error');
            return;
        }

        const reader = new FileReader();
        reader.onloadend = () => {
            const base64 = reader.result as string;
            setCompanyInfo({ ...companyInfo, logoBase64: base64 });
        };
        reader.readAsDataURL(file);
    }

    function removeLogo() {
        setCompanyInfo({ ...companyInfo, logoBase64: '' });
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    }

    if (authLoading) {
        return (
            <div className="auth-loading">
                <div className="loading-spinner"></div>
                <p>Učitavanje...</p>
            </div>
        );
    }

    if (!firebaseUser) {
        return null;
    }

    return (
        <div className="settings-page">
            <nav className="settings-nav">
                <Link href="/" className="back-link">
                    <span className="material-icons-round">arrow_back</span>
                    Nazad na aplikaciju
                </Link>
                <h1>Postavke</h1>
            </nav>

            {message && (
                <div className={`settings-message ${message.type}`}>
                    <span className="material-icons-round">
                        {message.type === 'success' ? 'check_circle' : 'error'}
                    </span>
                    {message.text}
                </div>
            )}

            <div className="settings-layout">
                {/* Sidebar */}
                <aside className="settings-sidebar">
                    <button
                        className={`sidebar-item ${activeSection === 'company' ? 'active' : ''}`}
                        onClick={() => setActiveSection('company')}
                    >
                        <span className="material-icons-round">business</span>
                        Podaci firme
                    </button>
                    <button
                        className={`sidebar-item ${activeSection === 'documents' ? 'active' : ''}`}
                        onClick={() => setActiveSection('documents')}
                    >
                        <span className="material-icons-round">description</span>
                        Dokumenti
                    </button>
                </aside>

                {/* Content */}
                <main className="settings-content">
                    {activeSection === 'company' && (
                        <section className="settings-section">
                            <div className="section-header">
                                <h2>Podaci firme</h2>
                                <p>Ovi podaci će se prikazati na ponudama, narudžbama i ostalim dokumentima.</p>
                            </div>

                            {/* Logo Upload */}
                            <div className="logo-section">
                                <div className="logo-preview">
                                    {companyInfo.logoBase64 ? (
                                        <img src={companyInfo.logoBase64} alt="Logo firme" />
                                    ) : (
                                        <div className="logo-placeholder">
                                            <span className="material-icons-round">add_photo_alternate</span>
                                            <span>Upload logo</span>
                                        </div>
                                    )}
                                </div>
                                <div className="logo-actions">
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept="image/*"
                                        onChange={handleLogoUpload}
                                        style={{ display: 'none' }}
                                        id="logo-upload"
                                    />
                                    <button
                                        className="btn btn-secondary"
                                        onClick={() => fileInputRef.current?.click()}
                                    >
                                        <span className="material-icons-round">upload</span>
                                        {companyInfo.logoBase64 ? 'Promijeni logo' : 'Upload logo'}
                                    </button>
                                    {companyInfo.logoBase64 && (
                                        <button className="btn btn-ghost" onClick={removeLogo}>
                                            <span className="material-icons-round">delete</span>
                                            Ukloni
                                        </button>
                                    )}
                                    <span className="logo-hint">PNG, JPG ili SVG. Maks. 500KB.</span>
                                </div>
                                {companyInfo.logoBase64 && (
                                    <div className="logo-option">
                                        <label className="toggle-label">
                                            <input
                                                type="checkbox"
                                                checked={companyInfo.hideNameWhenLogo}
                                                onChange={(e) => setCompanyInfo({ ...companyInfo, hideNameWhenLogo: e.target.checked })}
                                            />
                                            <span>Sakrij naziv firme kada ima logo</span>
                                        </label>
                                    </div>
                                )}
                            </div>

                            <div className="form-grid">
                                <div className="form-group full-width">
                                    <label>Naziv firme</label>
                                    <input
                                        type="text"
                                        value={companyInfo.name}
                                        onChange={(e) => setCompanyInfo({ ...companyInfo, name: e.target.value })}
                                        placeholder="Naziv vaše firme"
                                    />
                                </div>

                                <div className="form-group full-width">
                                    <label>Adresa</label>
                                    <input
                                        type="text"
                                        value={companyInfo.address}
                                        onChange={(e) => setCompanyInfo({ ...companyInfo, address: e.target.value })}
                                        placeholder="Ulica i broj, Poštanski broj, Grad"
                                    />
                                </div>

                                <div className="form-group">
                                    <label>Telefon</label>
                                    <input
                                        type="text"
                                        value={companyInfo.phone}
                                        onChange={(e) => setCompanyInfo({ ...companyInfo, phone: e.target.value })}
                                        placeholder="+387 XX XXX XXX"
                                    />
                                </div>

                                <div className="form-group">
                                    <label>Email</label>
                                    <input
                                        type="email"
                                        value={companyInfo.email}
                                        onChange={(e) => setCompanyInfo({ ...companyInfo, email: e.target.value })}
                                        placeholder="info@firma.ba"
                                    />
                                </div>

                                <div className="form-group">
                                    <label>ID broj</label>
                                    <input
                                        type="text"
                                        value={companyInfo.idNumber}
                                        onChange={(e) => setCompanyInfo({ ...companyInfo, idNumber: e.target.value })}
                                        placeholder="4xxxxxxxxxx"
                                    />
                                </div>

                                <div className="form-group">
                                    <label>PDV broj</label>
                                    <input
                                        type="text"
                                        value={companyInfo.pdvNumber}
                                        onChange={(e) => setCompanyInfo({ ...companyInfo, pdvNumber: e.target.value })}
                                        placeholder="xxxxxxxxxx"
                                    />
                                </div>

                                <div className="form-group full-width">
                                    <label>Web stranica</label>
                                    <input
                                        type="text"
                                        value={companyInfo.website}
                                        onChange={(e) => setCompanyInfo({ ...companyInfo, website: e.target.value })}
                                        placeholder="www.firma.ba"
                                    />
                                </div>
                            </div>
                        </section>
                    )}

                    {activeSection === 'documents' && (
                        <section className="settings-section">
                            <div className="section-header">
                                <h2>Postavke dokumenata</h2>
                                <p>Podrazumijevane vrijednosti za ponude i ostale dokumente.</p>
                            </div>

                            <div className="form-grid">
                                <div className="form-group">
                                    <label>Valuta</label>
                                    <select
                                        value={appSettings.currency}
                                        onChange={(e) => setAppSettings({ ...appSettings, currency: e.target.value })}
                                    >
                                        <option value="KM">KM (Konvertibilna marka)</option>
                                        <option value="EUR">EUR (Euro)</option>
                                        <option value="USD">USD (Američki dolar)</option>
                                    </select>
                                </div>

                                <div className="form-group">
                                    <label>PDV stopa (%)</label>
                                    <input
                                        type="number"
                                        value={appSettings.pdvRate}
                                        onChange={(e) => setAppSettings({ ...appSettings, pdvRate: Number(e.target.value) })}
                                        min="0"
                                        max="100"
                                    />
                                </div>

                                <div className="form-group">
                                    <label>Rok važenja ponude (dana)</label>
                                    <input
                                        type="number"
                                        value={appSettings.offerValidityDays}
                                        onChange={(e) => setAppSettings({ ...appSettings, offerValidityDays: Number(e.target.value) })}
                                        min="1"
                                        max="365"
                                    />
                                </div>

                                <div className="form-group full-width">
                                    <label>Podrazumijevana napomena za ponude</label>
                                    <textarea
                                        value={appSettings.defaultOfferNote}
                                        onChange={(e) => setAppSettings({ ...appSettings, defaultOfferNote: e.target.value })}
                                        placeholder="Hvala na povjerenju!"
                                        rows={2}
                                    />
                                </div>

                                <div className="form-group full-width">
                                    <label>Uslovi ponude (svaki uslov u novom redu)</label>
                                    <textarea
                                        value={appSettings.offerTerms}
                                        onChange={(e) => setAppSettings({ ...appSettings, offerTerms: e.target.value })}
                                        placeholder="Plaćanje: Avansno ili po dogovoru&#10;Rok isporuke: Po dogovoru nakon potvrde"
                                        rows={4}
                                    />
                                    <span className="form-hint">Ovi uslovi će se prikazati na svakoj ponudi ispod tabele cijena.</span>
                                </div>
                            </div>
                        </section>
                    )}

                    {/* Save Button */}
                    <div className="settings-actions">
                        <button
                            className="btn btn-primary btn-large"
                            onClick={handleSave}
                            disabled={saving}
                        >
                            {saving ? (
                                <>
                                    <div className="loading-spinner small"></div>
                                    Čuvanje...
                                </>
                            ) : (
                                <>
                                    <span className="material-icons-round">save</span>
                                    Sačuvaj postavke
                                </>
                            )}
                        </button>
                    </div>
                </main>
            </div>

            <style jsx>{`
                .settings-page {
                    min-height: 100vh;
                    background: var(--surface);
                }

                .settings-nav {
                    display: flex;
                    align-items: center;
                    gap: 24px;
                    padding: 16px 24px;
                    background: var(--background);
                    border-bottom: 1px solid var(--border-light);
                }

                .back-link {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    color: var(--text-secondary);
                    text-decoration: none;
                    font-size: 14px;
                    transition: color 0.2s;
                }

                .back-link:hover {
                    color: var(--accent);
                }

                .settings-nav h1 {
                    font-size: 20px;
                    font-weight: 600;
                }

                .settings-message {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 14px 24px;
                    margin: 16px 24px;
                    border-radius: 12px;
                    font-size: 14px;
                }

                .settings-message.success {
                    background: var(--success-bg);
                    color: var(--success);
                }

                .settings-message.error {
                    background: var(--error-bg);
                    color: var(--error);
                }

                .settings-layout {
                    display: flex;
                    max-width: 1200px;
                    margin: 0 auto;
                    padding: 24px;
                    gap: 32px;
                }

                .settings-sidebar {
                    width: 240px;
                    flex-shrink: 0;
                }

                .sidebar-item {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    width: 100%;
                    padding: 14px 16px;
                    border: none;
                    background: none;
                    border-radius: 12px;
                    font-size: 14px;
                    font-weight: 500;
                    color: var(--text-secondary);
                    cursor: pointer;
                    transition: all 0.2s;
                    text-align: left;
                }

                .sidebar-item:hover {
                    background: var(--background);
                    color: var(--text-primary);
                }

                .sidebar-item.active {
                    background: var(--accent);
                    color: white;
                }

                .sidebar-item .material-icons-round {
                    font-size: 20px;
                }

                .settings-content {
                    flex: 1;
                    min-width: 0;
                }

                .settings-section {
                    background: var(--background);
                    border-radius: 16px;
                    padding: 32px;
                    margin-bottom: 24px;
                }

                .section-header {
                    margin-bottom: 32px;
                }

                .section-header h2 {
                    font-size: 18px;
                    font-weight: 600;
                    margin-bottom: 8px;
                }

                .section-header p {
                    font-size: 14px;
                    color: var(--text-secondary);
                }

                .logo-section {
                    display: flex;
                    align-items: center;
                    gap: 24px;
                    padding: 24px;
                    background: var(--surface);
                    border-radius: 12px;
                    margin-bottom: 32px;
                }

                .logo-preview {
                    width: 120px;
                    height: 80px;
                    border-radius: 10px;
                    overflow: hidden;
                    background: var(--background);
                    border: 2px dashed var(--border);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }

                .logo-preview img {
                    width: 100%;
                    height: 100%;
                    object-fit: contain;
                }

                .logo-placeholder {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 4px;
                    color: var(--text-tertiary);
                    font-size: 11px;
                }

                .logo-placeholder .material-icons-round {
                    font-size: 28px;
                }

                .logo-actions {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    flex-wrap: wrap;
                }

                .logo-hint {
                    font-size: 12px;
                    color: var(--text-tertiary);
                }

                .logo-option {
                    width: 100%;
                    margin-top: 12px;
                    padding-top: 12px;
                    border-top: 1px solid var(--border-light);
                }

                .toggle-label {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    cursor: pointer;
                    font-size: 13px;
                    color: var(--text-secondary);
                }

                .toggle-label input[type="checkbox"] {
                    width: 18px;
                    height: 18px;
                    accent-color: var(--accent);
                    cursor: pointer;
                }

                .form-grid {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 20px;
                }

                .form-group {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }

                .form-group.full-width {
                    grid-column: 1 / -1;
                }

                .form-group label {
                    font-size: 13px;
                    font-weight: 500;
                    color: var(--text-secondary);
                }

                .form-group input,
                .form-group select,
                .form-group textarea {
                    padding: 12px 14px;
                    border: 1px solid var(--border);
                    border-radius: 10px;
                    font-size: 14px;
                    background: var(--surface);
                    transition: border-color 0.2s, box-shadow 0.2s;
                }

                .form-group input:focus,
                .form-group select:focus,
                .form-group textarea:focus {
                    outline: none;
                    border-color: var(--accent);
                    box-shadow: 0 0 0 3px var(--accent-light);
                }

                .form-group textarea {
                    resize: vertical;
                    min-height: 80px;
                }

                .form-hint {
                    font-size: 12px;
                    color: var(--text-tertiary);
                    margin-top: 4px;
                }

                .settings-actions {
                    display: flex;
                    justify-content: flex-end;
                    padding-top: 8px;
                }

                .btn-large {
                    padding: 14px 28px;
                    font-size: 15px;
                }

                .btn-ghost {
                    background: none;
                    border: none;
                    color: var(--error);
                    padding: 8px 12px;
                    border-radius: 8px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    font-size: 13px;
                    transition: background 0.2s;
                }

                .btn-ghost:hover {
                    background: var(--error-bg);
                }

                .loading-spinner.small {
                    width: 16px;
                    height: 16px;
                    border-width: 2px;
                }

                @media (max-width: 900px) {
                    .settings-layout {
                        flex-direction: column;
                        padding: 16px;
                    }

                    .settings-sidebar {
                        width: 100%;
                        display: flex;
                        gap: 8px;
                        overflow-x: auto;
                        padding-bottom: 8px;
                    }

                    .sidebar-item {
                        white-space: nowrap;
                        padding: 10px 14px;
                    }

                    .form-grid {
                        grid-template-columns: 1fr;
                    }

                    .logo-section {
                        flex-direction: column;
                        text-align: center;
                    }
                }
            `}</style>
        </div>
    );
}
