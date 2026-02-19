'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useData } from '@/context/DataContext';
import { saveOrgSettings, getOrgSettings } from '@/lib/database';
import Link from 'next/link';

const PLAN_NAMES: Record<string, { name: string; color: string; icon: string }> = {
    free: { name: 'Besplatni', color: '#86868b', icon: 'star_outline' },
    professional: { name: 'Professional', color: '#667eea', icon: 'workspace_premium' },
    enterprise: { name: 'Enterprise', color: '#34c759', icon: 'verified' },
};

export const dynamic = 'force-dynamic';

interface BankAccount {
    bankName: string;
    accountNumber: string;
}

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
    bankAccounts: BankAccount[];
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
    hideNameWhenLogo: false,
    bankAccounts: []
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
    const { user, loading: authLoading, firebaseUser, organization, signOut } = useAuth();
    const { refreshOrgSettings } = useData();
    const fileInputRef = useRef<HTMLInputElement>(null);

    const currentPlan = organization?.Subscription_Plan || 'free';
    const planInfo = PLAN_NAMES[currentPlan] || PLAN_NAMES.free;

    const [companyInfo, setCompanyInfo] = useState<CompanyInfo>(DEFAULT_COMPANY);
    const [appSettings, setAppSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
    const [activeSection, setActiveSection] = useState('company');

    // Load settings from Firestore (with localStorage fallback)
    useEffect(() => {
        async function loadSettings() {
            if (!organization?.Organization_ID) return;
            const orgKey = organization.Organization_ID;

            // Try Firestore first
            try {
                const firestoreSettings = await getOrgSettings(orgKey);
                if (firestoreSettings) {
                    if (firestoreSettings.companyInfo) {
                        const merged = { ...DEFAULT_COMPANY, ...firestoreSettings.companyInfo };
                        setCompanyInfo(merged);
                        localStorage.setItem(`companyInfo_${orgKey}`, JSON.stringify(merged));
                    }
                    if (firestoreSettings.appSettings) {
                        const merged = { ...DEFAULT_SETTINGS, ...firestoreSettings.appSettings };
                        setAppSettings(merged);
                        localStorage.setItem(`appSettings_${orgKey}`, JSON.stringify(merged));
                    }
                    return;
                }
            } catch (e) {
                console.warn('Failed to load from Firestore, falling back to localStorage', e);
            }

            // Fallback to localStorage
            const savedCompany = localStorage.getItem(`companyInfo_${orgKey}`);
            const savedSettings = localStorage.getItem(`appSettings_${orgKey}`);

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
        loadSettings();
    }, [organization?.Organization_ID]);

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

    async function handleSave() {
        if (!organization?.Organization_ID) {
            showMessage('Greška: Organizacija nije učitana', 'error');
            return;
        }

        setSaving(true);
        try {
            const orgKey = organization.Organization_ID;

            // Save to Firestore
            const result = await saveOrgSettings(orgKey, { companyInfo, appSettings });
            if (!result.success) {
                showMessage('Greška pri čuvanju u bazu: ' + result.message, 'error');
                setSaving(false);
                return;
            }

            // Cache in localStorage
            localStorage.setItem(`companyInfo_${orgKey}`, JSON.stringify(companyInfo));
            localStorage.setItem(`appSettings_${orgKey}`, JSON.stringify(appSettings));

            // Sync DataContext so all tabs get updated immediately
            await refreshOrgSettings();

            showMessage('Postavke sačuvane uspješno', 'success');
        } catch (error) {
            showMessage('Greška pri čuvanju postavki', 'error');
        }
        setSaving(false);
    }

    function addBankAccount() {
        setCompanyInfo({
            ...companyInfo,
            bankAccounts: [...(companyInfo.bankAccounts || []), { bankName: '', accountNumber: '' }]
        });
    }

    function removeBankAccount(index: number) {
        const updated = [...(companyInfo.bankAccounts || [])];
        updated.splice(index, 1);
        setCompanyInfo({ ...companyInfo, bankAccounts: updated });
    }

    function updateBankAccount(index: number, field: 'bankName' | 'accountNumber', value: string) {
        const updated = [...(companyInfo.bankAccounts || [])];
        updated[index] = { ...updated[index], [field]: value };
        setCompanyInfo({ ...companyInfo, bankAccounts: updated });
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
                <Link
                    href="/"
                    className="back-button"
                    style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '10px',
                        color: 'var(--text-primary)',
                        textDecoration: 'none',
                        fontSize: '14px',
                        fontWeight: '600',
                        padding: '10px 18px',
                        borderRadius: '50px',
                        background: 'rgba(0, 0, 0, 0.05)',
                        border: '1px solid transparent',
                        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)'
                    }}
                >
                    <span className="material-icons-round" style={{ fontSize: '20px' }}>arrow_back</span>
                    <span>Nazad na aplikaciju</span>
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
                    {/* Plan Card */}
                    <div className="plan-card">
                        <div className="plan-header">
                            <div className="plan-icon">
                                <span className="material-icons-round">{planInfo.icon}</span>
                            </div>
                            <div className="plan-meta">
                                <span className="plan-label">AKTIVNI PLAN</span>
                                <span className="plan-name">{planInfo.name}</span>
                            </div>
                        </div>
                        <Link
                            href="/pricing"
                            className="plan-button"
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: '12px 18px',
                                background: 'white',
                                borderRadius: '14px',
                                color: '#4a4a4e',
                                textDecoration: 'none',
                                fontSize: '13px',
                                fontWeight: '600',
                                transition: 'all 0.2s ease',
                                border: '1px solid rgba(0, 0, 0, 0.05)',
                                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04)'
                            }}
                        >
                            <span>Upravljanje pretplatom</span>
                            <span className="material-icons-round" style={{ fontSize: '16px' }}>arrow_forward</span>
                        </Link>
                    </div>

                    <div className="sidebar-divider"></div>

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

                    <div className="sidebar-divider"></div>

                    <button
                        className="sidebar-item danger"
                        onClick={() => signOut()}
                    >
                        <span className="material-icons-round">logout</span>
                        Odjavi se
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

                            {/* Bank Accounts */}
                            <div className="bank-accounts-section">
                                <div className="bank-accounts-header">
                                    <div>
                                        <h3>Bankovni računi</h3>
                                        <p>Podaci o bankovnim računima koji se prikazuju na ponudama.</p>
                                    </div>
                                    <button className="btn btn-secondary btn-small" onClick={addBankAccount}>
                                        <span className="material-icons-round" style={{ fontSize: '16px' }}>add</span>
                                        Dodaj račun
                                    </button>
                                </div>
                                {(companyInfo.bankAccounts || []).length === 0 && (
                                    <div className="bank-empty">
                                        <span className="material-icons-round">account_balance</span>
                                        <p>Nema dodanih bankovnih računa</p>
                                    </div>
                                )}
                                {(companyInfo.bankAccounts || []).map((account, index) => (
                                    <div key={index} className="bank-row">
                                        <div className="bank-fields">
                                            <div className="form-group">
                                                <label>Banka</label>
                                                <input
                                                    type="text"
                                                    value={account.bankName}
                                                    onChange={(e) => updateBankAccount(index, 'bankName', e.target.value)}
                                                    placeholder="Naziv banke"
                                                />
                                            </div>
                                            <div className="form-group">
                                                <label>Broj računa / IBAN</label>
                                                <input
                                                    type="text"
                                                    value={account.accountNumber}
                                                    onChange={(e) => updateBankAccount(index, 'accountNumber', e.target.value)}
                                                    placeholder="XX00 0000 0000 0000 0000"
                                                />
                                            </div>
                                        </div>
                                        <button className="btn btn-ghost btn-icon" onClick={() => removeBankAccount(index)} title="Ukloni">
                                            <span className="material-icons-round" style={{ fontSize: '18px', color: '#ef4444' }}>delete</span>
                                        </button>
                                    </div>
                                ))}
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
                    gap: 32px;
                    padding: 24px 32px;
                    background: var(--background);
                    border-bottom: 1px solid var(--border-light);
                }

                .back-button {
                    display: inline-flex;
                    align-items: center;
                    gap: 10px;
                    color: var(--text-primary);
                    text-decoration: none !important;
                    font-size: 14px;
                    font-weight: 600;
                    padding: 10px 18px;
                    border-radius: 50px;
                    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                    background: rgba(0, 0, 0, 0.05);
                    border: 1px solid transparent;
                }

                .back-button:hover,
                a.back-button:hover {
                    background: rgba(0, 0, 0, 0.08);
                    transform: translateX(-2px);
                }

                .back-button .material-icons-round {
                    font-size: 20px;
                }

                .settings-nav h1 {
                    font-size: 24px;
                    font-weight: 700;
                    letter-spacing: -0.5px;
                }

                .settings-layout {
                    display: flex;
                    max-width: 1300px;
                    margin: 0 auto;
                    padding: 32px;
                    gap: 48px;
                }

                .settings-sidebar {
                    width: 280px;
                    flex-shrink: 0;
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }

                .plan-card {
                    background: linear-gradient(135deg, #f8f9ff 0%, #f0f2ff 100%);
                    border-radius: 20px;
                    padding: 24px;
                    border: 1px solid rgba(102, 126, 234, 0.15);
                    margin-bottom: 16px;
                    box-shadow: 0 4px 15px rgba(0, 0, 0, 0.02);
                }

                .plan-header {
                    display: flex;
                    align-items: center;
                    gap: 16px;
                    margin-bottom: 20px;
                }

                .plan-icon {
                    width: 48px;
                    height: 48px;
                    background: white;
                    border-radius: 14px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    box-shadow: 0 8px 20px rgba(102, 126, 234, 0.12);
                }

                .plan-icon .material-icons-round {
                    font-size: 28px;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                }

                .plan-meta {
                    display: flex;
                    flex-direction: column;
                    gap: 2px;
                }

                .plan-label {
                    font-size: 10px;
                    font-weight: 800;
                    color: #7c7c8c;
                    letter-spacing: 1px;
                }

                .plan-name {
                    font-size: 18px;
                    font-weight: 700;
                    color: #1d1d1f;
                }

                .plan-button {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 12px 18px;
                    background: white;
                    border-radius: 14px;
                    color: #4a4a4e;
                    text-decoration: none !important;
                    font-size: 13px;
                    font-weight: 600;
                    transition: all 0.2s ease;
                    border: 1px solid rgba(0, 0, 0, 0.05);
                    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
                }

                .plan-button:hover,
                a.plan-button:hover {
                    background: #fdfdff;
                    border-color: rgba(102, 126, 234, 0.2);
                    color: var(--accent);
                    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.1);
                }

                .sidebar-divider {
                    height: 1px;
                    background: var(--border-light);
                    margin: 8px 12px 16px;
                    opacity: 0.6;
                }

                .sidebar-item {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    width: 100%;
                    padding: 12px 16px;
                    border: none;
                    background: transparent;
                    border-radius: 12px;
                    font-size: 15px;
                    font-weight: 500;
                    color: var(--text-secondary);
                    cursor: pointer;
                    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                    text-align: left;
                }

                .sidebar-item:hover {
                    background: rgba(0, 0, 0, 0.03);
                    color: var(--text-primary);
                }

                .sidebar-item.active {
                    background: var(--accent-light);
                    color: var(--accent);
                    font-weight: 600;
                }

                .sidebar-item.danger {
                    color: var(--error);
                    margin-top: auto;
                }

                .sidebar-item.danger:hover {
                    background: var(--error-bg);
                    color: var(--error);
                }

                .sidebar-item .material-icons-round {
                    font-size: 22px;
                    opacity: 0.8;
                }

                .sidebar-item.active .material-icons-round {
                    opacity: 1;
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

                .bank-accounts-section {
                    margin-top: 32px;
                    padding-top: 32px;
                    border-top: 1px solid var(--border-light);
                }

                .bank-accounts-header {
                    display: flex;
                    align-items: flex-start;
                    justify-content: space-between;
                    margin-bottom: 20px;
                }

                .bank-accounts-header h3 {
                    font-size: 16px;
                    font-weight: 600;
                    margin-bottom: 4px;
                }

                .bank-accounts-header p {
                    font-size: 13px;
                    color: var(--text-tertiary);
                }

                .btn-small {
                    padding: 8px 14px;
                    font-size: 13px;
                }

                .bank-empty {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 8px;
                    padding: 32px;
                    border-radius: 12px;
                    background: var(--surface);
                    border: 1px dashed var(--border);
                    color: var(--text-tertiary);
                }

                .bank-empty .material-icons-round {
                    font-size: 32px;
                    opacity: 0.5;
                }

                .bank-row {
                    display: flex;
                    align-items: flex-end;
                    gap: 12px;
                    margin-bottom: 12px;
                    padding: 16px;
                    border-radius: 12px;
                    background: var(--surface);
                    border: 1px solid var(--border-light);
                }

                .bank-fields {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 16px;
                    flex: 1;
                }

                .btn-icon {
                    padding: 8px;
                    border-radius: 8px;
                    flex-shrink: 0;
                    margin-bottom: 4px;
                }

                @media (max-width: 900px) {
                    .settings-layout {
                        flex-direction: column;
                        padding: 16px;
                    }

                    .settings-sidebar {
                        width: 100%;
                        display: flex;
                        flex-wrap: wrap;
                        gap: 8px;
                        padding-bottom: 8px;
                    }

                    .plan-card {
                        width: 100%;
                        flex-shrink: 0;
                        margin-bottom: 4px;
                    }

                    .sidebar-divider {
                        display: none;
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
