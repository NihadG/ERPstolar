'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useData } from '@/context/DataContext';
import { saveOrgSettings, getOrgSettings } from '@/lib/services';
import type { GoogleIntegrationSettings } from '@/lib/types';
import { connect as googleConnect, disconnect as googleDisconnect, fetchConnectedEmail } from '@/lib/google/googleAuth';
import { isGoogleConfigured } from '@/lib/google/config';
import { pickExistingFolder, createRealDriveClient, folderLink } from '@/lib/google/driveClient';
import Toast from '@/components/ui/Toast';
import Link from 'next/link';
import SystemReadiness from '@/components/settings/SystemReadiness';
import NameClassificationReview from '@/components/settings/NameClassificationReview';
import TeamSection from '@/components/settings/TeamSection';

const PLAN_NAMES: Record<string, { name: string; color: string; icon: string }> = {
    free: { name: 'Besplatni', color: '#86868b', icon: 'star_outline' },
    basic: { name: 'Basic', color: '#34c759', icon: 'star' },
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
    profitNotificationsEnabled: boolean;
    profitNotificationTime: string;
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
    offerTerms: 'Plaćanje: Avansno ili po dogovoru\nRok isporuke: Po dogovoru nakon potvrde',
    profitNotificationsEnabled: true,
    profitNotificationTime: '17:00',
};

export default function SettingsPage() {
    const router = useRouter();
    const { user, loading: authLoading, firebaseUser, organization, signOut, hasModule, isField, isAdmin } = useAuth();
    const { refreshOrgSettings } = useData();
    const fileInputRef = useRef<HTMLInputElement>(null);

    const currentPlan = organization?.Subscription_Plan || 'free';
    const planInfo = PLAN_NAMES[currentPlan] || PLAN_NAMES.free;

    const [companyInfo, setCompanyInfo] = useState<CompanyInfo>(DEFAULT_COMPANY);
    const [appSettings, setAppSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
    const [activeSection, setActiveSection] = useState('company');
    const [googleSettings, setGoogleSettings] = useState<GoogleIntegrationSettings>({});
    const [googleBusy, setGoogleBusy] = useState(false);

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

    // Load Google integration settings
    useEffect(() => {
        async function loadGoogle() {
            if (!organization?.Organization_ID) return;
            try {
                const s = await getOrgSettings(organization.Organization_ID);
                if (s?.googleIntegration) setGoogleSettings(s.googleIntegration);
            } catch { /* ignore */ }
        }
        loadGoogle();
    }, [organization?.Organization_ID]);

    // Redirect to login if not authenticated
    useEffect(() => {
        if (!authLoading && !firebaseUser) {
            router.push('/login');
        }
    }, [authLoading, firebaseUser, router]);

    // Postavke su vlasnikov ekran — pogonske uloge nazad na svoj.
    useEffect(() => {
        if (!authLoading && isField) {
            router.replace('/pogon');
        }
    }, [authLoading, isField, router]);

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

    // ── Google integracija ────────────────────────────────────────────
    async function persistGoogle(next: GoogleIntegrationSettings) {
        if (!organization?.Organization_ID) return;
        setGoogleSettings(next);
        await saveOrgSettings(organization.Organization_ID, { googleIntegration: next });
        await refreshOrgSettings();
    }

    async function handleGoogleConnect() {
        setGoogleBusy(true);
        try {
            await googleConnect();
            const email = await fetchConnectedEmail();
            await persistGoogle({ ...googleSettings, connectedEmail: email || 'povezano' });
            showMessage('Google račun povezan', 'success');
        } catch (e: any) {
            showMessage('Greška pri povezivanju: ' + (e?.message || ''), 'error');
        }
        setGoogleBusy(false);
    }

    async function handlePickRoot() {
        setGoogleBusy(true);
        try {
            const folder = await pickExistingFolder();
            if (folder) {
                await persistGoogle({ ...googleSettings, rootFolderID: folder.id, rootFolderName: folder.name, rootFolderURL: folder.url });
                showMessage('Root folder postavljen: ' + folder.name, 'success');
            }
        } catch (e: any) {
            showMessage('Greška pri odabiru foldera: ' + (e?.message || ''), 'error');
        }
        setGoogleBusy(false);
    }

    async function handleCreateRoot() {
        const name = (window.prompt('Naziv root foldera za projekte:', 'ERP Projekti') || '').trim();
        if (!name) return;
        setGoogleBusy(true);
        try {
            const created = await createRealDriveClient().createFolder(name, 'root');
            await persistGoogle({ ...googleSettings, rootFolderID: created.id, rootFolderName: created.name, rootFolderURL: created.webViewLink || folderLink(created.id) });
            showMessage('Root folder kreiran: ' + created.name, 'success');
        } catch (e: any) {
            showMessage('Greška pri kreiranju foldera: ' + (e?.message || ''), 'error');
        }
        setGoogleBusy(false);
    }

    async function handleGoogleDisconnect() {
        googleDisconnect();
        await persistGoogle({});
        showMessage('Google račun odspojen', 'success');
    }

    async function toggleGoogleFlag(key: 'autoCreateProjectFolders' | 'autoCalendarTasks', value: boolean) {
        await persistGoogle({ ...googleSettings, [key]: value });
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

    // Sekcije koje koriste glavno dugme "Sačuvaj postavke". Integracije i Korisnici
    // se čuvaju odmah po akciji (Poveži/Kreiraj nalog/Deaktiviraj), pa tu prikazujemo
    // napomenu umjesto dugmeta — glavno dugme bi tamo bilo prazno obećanje.
    const usesGlobalSave = activeSection !== 'integracije' && activeSection !== 'korisnici';

    return (
        <div className="settings-page">
            <header className="settings-topbar">
                <Link href="/" className="settings-back">
                    <span className="material-icons-round">arrow_back</span>
                    <span>Nazad na aplikaciju</span>
                </Link>
                <h1>Postavke</h1>
            </header>

            {message && <Toast message={message.text} type={message.type} />}

            <div className="settings-shell">
                {/* Sidebar */}
                <aside className="settings-sidebar">
                    <div className="plan-card">
                        <div className="plan-card-top">
                            <div className="plan-card-icon">
                                <span className="material-icons-round">{planInfo.icon}</span>
                            </div>
                            <div className="plan-card-body">
                                <span className="plan-card-eyebrow">Aktivni plan</span>
                                <span className="plan-card-name">{planInfo.name}</span>
                            </div>
                        </div>
                        <Link href="/pricing" className="plan-card-link">
                            <span>Upravljaj pretplatom</span>
                            <span className="material-icons-round">arrow_forward</span>
                        </Link>
                    </div>

                    <nav className="settings-nav-list">
                        <span className="nav-eyebrow">Opšte</span>
                        <button
                            className={`sidebar-item ${activeSection === 'company' ? 'active' : ''}`}
                            onClick={() => setActiveSection('company')}
                        >
                            <span className="material-icons-round">business</span>
                            <span className="sidebar-item-label">Podaci firme</span>
                        </button>
                        <button
                            className={`sidebar-item ${activeSection === 'documents' ? 'active' : ''}`}
                            onClick={() => setActiveSection('documents')}
                        >
                            <span className="material-icons-round">description</span>
                            <span className="sidebar-item-label">Dokumenti</span>
                        </button>
                        <button
                            className={`sidebar-item ${activeSection === 'profit' ? 'active' : ''}`}
                            onClick={() => setActiveSection('profit')}
                        >
                            <span className="material-icons-round">trending_up</span>
                            <span className="sidebar-item-label">Profit</span>
                        </button>

                        <button
                            className={`sidebar-item ${activeSection === 'podaci' ? 'active' : ''}`}
                            onClick={() => setActiveSection('podaci')}
                        >
                            <span className="material-icons-round">insights</span>
                            <span className="sidebar-item-label">Podaci i spremnost</span>
                        </button>

                        <span className="nav-eyebrow">Organizacija</span>
                        <button
                            className={`sidebar-item ${activeSection === 'korisnici' ? 'active' : ''}`}
                            onClick={() => setActiveSection('korisnici')}
                        >
                            <span className="material-icons-round">manage_accounts</span>
                            <span className="sidebar-item-label">Korisnici</span>
                            {!hasModule('team') && <span className="nav-pro-badge">PRO</span>}
                        </button>

                        <span className="nav-eyebrow">Integracije</span>
                        <button
                            className={`sidebar-item ${activeSection === 'integracije' ? 'active' : ''}`}
                            onClick={() => setActiveSection('integracije')}
                        >
                            <span className="material-icons-round">cloud</span>
                            <span className="sidebar-item-label">Google integracija</span>
                            {!hasModule('google_integration') && <span className="nav-pro-badge">PRO</span>}
                        </button>
                    </nav>

                    <button className="settings-signout" onClick={() => signOut()}>
                        <span className="material-icons-round">logout</span>
                        Odjavi se
                    </button>
                </aside>

                {/* Content */}
                <main className="settings-content">
                    {activeSection === 'podaci' && (
                        <>
                            <SystemReadiness />
                            <NameClassificationReview />
                        </>
                    )}

                    {activeSection === 'korisnici' && (
                        <TeamSection showMessage={showMessage} />
                    )}

                    {activeSection === 'company' && (
                        <section className="settings-section">
                            <div className="settings-section-header">
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
                                        <button className="btn btn-ghost btn-ghost--danger" onClick={removeLogo}>
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

                            <div className="settings-form-grid">
                                <div className="settings-form-group full-width">
                                    <label>Naziv firme</label>
                                    <input
                                        type="text"
                                        value={companyInfo.name}
                                        onChange={(e) => setCompanyInfo({ ...companyInfo, name: e.target.value })}
                                        placeholder="Naziv vaše firme"
                                    />
                                </div>

                                <div className="settings-form-group full-width">
                                    <label>Adresa</label>
                                    <input
                                        type="text"
                                        value={companyInfo.address}
                                        onChange={(e) => setCompanyInfo({ ...companyInfo, address: e.target.value })}
                                        placeholder="Ulica i broj, Poštanski broj, Grad"
                                    />
                                </div>

                                <div className="settings-form-group">
                                    <label>Telefon</label>
                                    <input
                                        type="text"
                                        value={companyInfo.phone}
                                        onChange={(e) => setCompanyInfo({ ...companyInfo, phone: e.target.value })}
                                        placeholder="+387 XX XXX XXX"
                                    />
                                </div>

                                <div className="settings-form-group">
                                    <label>Email</label>
                                    <input
                                        type="email"
                                        value={companyInfo.email}
                                        onChange={(e) => setCompanyInfo({ ...companyInfo, email: e.target.value })}
                                        placeholder="info@firma.ba"
                                    />
                                </div>

                                <div className="settings-form-group">
                                    <label>ID broj</label>
                                    <input
                                        type="text"
                                        value={companyInfo.idNumber}
                                        onChange={(e) => setCompanyInfo({ ...companyInfo, idNumber: e.target.value })}
                                        placeholder="4xxxxxxxxxx"
                                    />
                                </div>

                                <div className="settings-form-group">
                                    <label>PDV broj</label>
                                    <input
                                        type="text"
                                        value={companyInfo.pdvNumber}
                                        onChange={(e) => setCompanyInfo({ ...companyInfo, pdvNumber: e.target.value })}
                                        placeholder="xxxxxxxxxx"
                                    />
                                </div>

                                <div className="settings-form-group full-width">
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
                                    <button className="btn btn-secondary btn-sm" onClick={addBankAccount}>
                                        <span className="material-icons-round">add</span>
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
                                            <div className="settings-form-group">
                                                <label>Banka</label>
                                                <input
                                                    type="text"
                                                    value={account.bankName}
                                                    onChange={(e) => updateBankAccount(index, 'bankName', e.target.value)}
                                                    placeholder="Naziv banke"
                                                />
                                            </div>
                                            <div className="settings-form-group">
                                                <label>Broj računa / IBAN</label>
                                                <input
                                                    type="text"
                                                    value={account.accountNumber}
                                                    onChange={(e) => updateBankAccount(index, 'accountNumber', e.target.value)}
                                                    placeholder="XX00 0000 0000 0000 0000"
                                                />
                                            </div>
                                        </div>
                                        <button className="btn btn-ghost btn-ghost--danger btn-icon" onClick={() => removeBankAccount(index)} title="Ukloni">
                                            <span className="material-icons-round">delete</span>
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </section>
                    )}

                    {activeSection === 'documents' && (
                        <section className="settings-section">
                            <div className="settings-section-header">
                                <h2>Postavke dokumenata</h2>
                                <p>Podrazumijevane vrijednosti za ponude i ostale dokumente.</p>
                            </div>

                            <div className="settings-form-grid">
                                <div className="settings-form-group">
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

                                <div className="settings-form-group">
                                    <label>PDV stopa (%)</label>
                                    <input
                                        type="number"
                                        value={appSettings.pdvRate}
                                        onChange={(e) => setAppSettings({ ...appSettings, pdvRate: Number(e.target.value) })}
                                        min="0"
                                        max="100"
                                    />
                                </div>

                                <div className="settings-form-group">
                                    <label>Rok važenja ponude (dana)</label>
                                    <input
                                        type="number"
                                        value={appSettings.offerValidityDays}
                                        onChange={(e) => setAppSettings({ ...appSettings, offerValidityDays: Number(e.target.value) })}
                                        min="1"
                                        max="365"
                                    />
                                </div>

                                <div className="settings-form-group full-width">
                                    <label>Podrazumijevana napomena za ponude</label>
                                    <textarea
                                        value={appSettings.defaultOfferNote}
                                        onChange={(e) => setAppSettings({ ...appSettings, defaultOfferNote: e.target.value })}
                                        placeholder="Hvala na povjerenju!"
                                        rows={2}
                                    />
                                </div>

                                <div className="settings-form-group full-width">
                                    <label>Uslovi ponude (svaki uslov u novom redu)</label>
                                    <textarea
                                        value={appSettings.offerTerms}
                                        onChange={(e) => setAppSettings({ ...appSettings, offerTerms: e.target.value })}
                                        placeholder="Plaćanje: Avansno ili po dogovoru&#10;Rok isporuke: Po dogovoru nakon potvrde"
                                        rows={4}
                                    />
                                    <span className="settings-form-hint">Ovi uslovi će se prikazati na svakoj ponudi ispod tabele cijena.</span>
                                </div>
                            </div>
                        </section>
                    )}

                    {activeSection === 'profit' && (
                        <section className="settings-section">
                            <div className="settings-section-header">
                                <h2>Postavke profita</h2>
                                <p>Konfiguriši notifikacije za dnevno praćenje profita po nalozima.</p>
                            </div>

                            <div className="settings-card">
                                <div className="settings-row">
                                    <div className="settings-row-label">
                                        <strong>Dnevne profit notifikacije</strong>
                                        <span>Primaš obavijest u notifikacijski centar u definirano vrijeme da uneseš profit za otvorene naloge.</span>
                                    </div>
                                    <div className="settings-row-control">
                                        <label className="switch">
                                            <input
                                                type="checkbox"
                                                checked={appSettings.profitNotificationsEnabled}
                                                onChange={(e) => setAppSettings({ ...appSettings, profitNotificationsEnabled: e.target.checked })}
                                            />
                                            <span className="switch-track"></span>
                                            <span className="switch-thumb"></span>
                                        </label>
                                    </div>
                                </div>

                                <div className="settings-row">
                                    <div className="settings-row-label">
                                        <strong>Vrijeme notifikacije</strong>
                                        <span>Svaki dan u ovo vrijeme dobijaš podsjetnik.</span>
                                    </div>
                                    <div className="settings-row-control">
                                        <input
                                            type="time"
                                            className="settings-time-input"
                                            value={appSettings.profitNotificationTime}
                                            onChange={(e) => setAppSettings({ ...appSettings, profitNotificationTime: e.target.value })}
                                            disabled={!appSettings.profitNotificationsEnabled}
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="settings-banner settings-banner--info settings-banner--compact">
                                <span className="material-icons-round">info</span>
                                <div>
                                    <strong>Kako funkcioniše</strong>
                                    <p>
                                        Profit se sada unosi ručno za svaki nalog. Otvori profit modal iz Projekata ili Naloga,
                                        unesi dnevne troškove i prihode, i sistem će pratiti kumulativni profit.
                                        Notifikacija te podsjeća da to uradiš svaki dan.
                                    </p>
                                </div>
                            </div>
                        </section>
                    )}

                    {activeSection === 'integracije' && (
                        <section className="settings-section">
                            <div className="settings-section-header">
                                <h2>Google integracija</h2>
                                <p>Poveži Google Drive i Kalendar — folderi projekata, ponude/narudžbe na klik, zadaci u kalendaru.</p>
                            </div>

                            {!isGoogleConfigured() ? (
                                <div className="settings-banner settings-banner--warning">
                                    <span className="material-icons-round">warning_amber</span>
                                    <div>
                                        <strong>Integracija nije konfigurisana</strong>
                                        <p>
                                            Postavi <code>NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID</code> i <code>NEXT_PUBLIC_GOOGLE_API_KEY</code> u
                                            okruženju (Google Cloud OAuth klijent + Picker API ključ).
                                        </p>
                                    </div>
                                </div>
                            ) : !hasModule('google_integration') ? (
                                <div className="settings-banner settings-banner--locked">
                                    <span className="material-icons-round">lock</span>
                                    <div>
                                        <strong>Google integracija je dodatni paket</strong>
                                        <p>Automatski folderi projekata, arhiviranje ponuda/narudžbi na Drive i zadaci u Google kalendaru.</p>
                                        <Link href="/pricing" className="btn btn-primary btn-sm">Nadogradi paket</Link>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <div className="settings-card">
                                        <div className="settings-row">
                                            <div className="settings-row-label">
                                                <strong>Google račun</strong>
                                                <span>Račun koji se koristi za pristup Drive-u i Kalendaru.</span>
                                            </div>
                                            <div className="settings-row-control">
                                                {googleSettings.connectedEmail ? (
                                                    <>
                                                        <span className="status-pill status-pill--success">
                                                            <span className="material-icons-round">check_circle</span>
                                                            {googleSettings.connectedEmail}
                                                        </span>
                                                        <button className="btn btn-ghost btn-sm" onClick={handleGoogleDisconnect} disabled={googleBusy}>Odspoji</button>
                                                    </>
                                                ) : (
                                                    <button className="btn btn-primary btn-sm" onClick={handleGoogleConnect} disabled={googleBusy}>
                                                        <span className="material-icons-round">link</span>
                                                        {googleBusy ? 'Povezivanje...' : 'Poveži Google'}
                                                    </button>
                                                )}
                                            </div>
                                        </div>

                                        {googleSettings.connectedEmail && (
                                            <>
                                                <div className="settings-row">
                                                    <div className="settings-row-label">
                                                        <strong>Root folder za projekte</strong>
                                                        <span>Folderi novih projekata se prave unutar ovog foldera.</span>
                                                    </div>
                                                    <div className="settings-row-control">
                                                        {googleSettings.rootFolderID ? (
                                                            <>
                                                                <a
                                                                    className="folder-chip"
                                                                    href={googleSettings.rootFolderURL || folderLink(googleSettings.rootFolderID)}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                >
                                                                    <span className="material-icons-round">folder</span>
                                                                    <span className="folder-chip-name">{googleSettings.rootFolderName || 'Otvori folder'}</span>
                                                                </a>
                                                                <button className="btn btn-secondary btn-sm" onClick={handlePickRoot} disabled={googleBusy}>Promijeni</button>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <button className="btn btn-secondary btn-sm" onClick={handleCreateRoot} disabled={googleBusy}>
                                                                    <span className="material-icons-round">create_new_folder</span>
                                                                    Napravi novi
                                                                </button>
                                                                <button className="btn btn-secondary btn-sm" onClick={handlePickRoot} disabled={googleBusy}>
                                                                    <span className="material-icons-round">folder_open</span>
                                                                    Odaberi postojeći
                                                                </button>
                                                            </>
                                                        )}
                                                    </div>
                                                </div>

                                                <div className="settings-row">
                                                    <div className="settings-row-label">
                                                        <strong>Auto-folder za nove projekte</strong>
                                                        <span>Automatski napravi Drive folder pri kreiranju novog projekta.</span>
                                                    </div>
                                                    <div className="settings-row-control">
                                                        <label className="switch">
                                                            <input
                                                                type="checkbox"
                                                                checked={googleSettings.autoCreateProjectFolders !== false}
                                                                onChange={(e) => toggleGoogleFlag('autoCreateProjectFolders', e.target.checked)}
                                                            />
                                                            <span className="switch-track"></span>
                                                            <span className="switch-thumb"></span>
                                                        </label>
                                                    </div>
                                                </div>

                                                <div className="settings-row">
                                                    <div className="settings-row-label">
                                                        <strong>Zadaci u Google kalendaru</strong>
                                                        <span>Dodaj zadatke s rokom u Google Kalendar.</span>
                                                    </div>
                                                    <div className="settings-row-control">
                                                        <label className="switch">
                                                            <input
                                                                type="checkbox"
                                                                checked={googleSettings.autoCalendarTasks !== false}
                                                                onChange={(e) => toggleGoogleFlag('autoCalendarTasks', e.target.checked)}
                                                            />
                                                            <span className="switch-track"></span>
                                                            <span className="switch-thumb"></span>
                                                        </label>
                                                    </div>
                                                </div>
                                            </>
                                        )}
                                    </div>

                                    <div className="settings-banner settings-banner--info settings-banner--compact">
                                        <span className="material-icons-round">verified_user</span>
                                        <div>
                                            <strong>Privatnost</strong>
                                            <p>
                                                Aplikacija koristi samo <code>drive.file</code> pristup — vidi isključivo foldere i fajlove koje sama
                                                kreira ili koje odabereš kroz Picker. Ne pristupa ostatku tvog Drive-a.
                                            </p>
                                        </div>
                                    </div>
                                </>
                            )}
                        </section>
                    )}

                    {/* Save Button / instant-save note */}
                    {usesGlobalSave ? (
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
                    ) : (
                        <div className="settings-actions settings-actions--note">
                            <span className="material-icons-round">bolt</span>
                            Promjene na ovoj stranici se čuvaju odmah, bez posebnog dugmeta.
                        </div>
                    )}
                </main>
            </div>

            <style jsx>{`
                .settings-page {
                    min-height: 100vh;
                    background: var(--surface);
                }

                /* ── Topbar ────────────────────────────────────────── */
                .settings-topbar {
                    display: flex;
                    align-items: center;
                    gap: 24px;
                    padding: 20px 32px;
                    background: var(--background);
                    border-bottom: 1px solid var(--border-light);
                }

                .settings-topbar h1 {
                    font-size: 20px;
                    font-weight: 700;
                    letter-spacing: -0.2px;
                    color: var(--text-primary);
                }

                /* ── Shell / layout ────────────────────────────────── */
                .settings-shell {
                    display: flex;
                    align-items: flex-start;
                    max-width: 1200px;
                    margin: 0 auto;
                    padding: 32px;
                    gap: 40px;
                }

                .settings-sidebar {
                    width: 260px;
                    flex-shrink: 0;
                    display: flex;
                    flex-direction: column;
                    gap: 20px;
                }

                .settings-content {
                    flex: 1;
                    min-width: 0;
                    display: flex;
                    flex-direction: column;
                    gap: 24px;
                }

                /* ── Plan card ─────────────────────────────────────── */
                .plan-card {
                    display: flex;
                    flex-direction: column;
                    gap: 14px;
                    padding: 18px;
                    background: var(--background);
                    border: 1px solid var(--border-light);
                    border-radius: var(--radius-lg);
                }

                .plan-card-top {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }

                .plan-card-icon {
                    width: 40px;
                    height: 40px;
                    flex-shrink: 0;
                    border-radius: var(--radius-md);
                    background: var(--accent-light);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }

                .plan-card-icon .material-icons-round {
                    font-size: 22px;
                    color: var(--accent);
                }

                .plan-card-body {
                    display: flex;
                    flex-direction: column;
                    gap: 2px;
                    min-width: 0;
                }

                .plan-card-eyebrow {
                    font-size: 10px;
                    font-weight: 700;
                    letter-spacing: 0.06em;
                    text-transform: uppercase;
                    color: var(--text-tertiary);
                }

                .plan-card-name {
                    font-size: 16px;
                    font-weight: 700;
                    color: var(--text-primary);
                }

                /* ── Sidebar nav ───────────────────────────────────── */
                .settings-nav-list {
                    display: flex;
                    flex-direction: column;
                    gap: 2px;
                }

                .nav-eyebrow {
                    font-size: 11px;
                    font-weight: 700;
                    letter-spacing: 0.06em;
                    text-transform: uppercase;
                    color: var(--text-tertiary);
                    padding: 16px 12px 6px;
                }

                .nav-eyebrow:first-child {
                    padding-top: 4px;
                }

                .sidebar-item {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    width: 100%;
                    height: 40px;
                    padding: 0 12px;
                    border: none;
                    background: transparent;
                    border-radius: var(--radius-md);
                    font-size: 14px;
                    font-weight: 500;
                    color: var(--text-secondary);
                    cursor: pointer;
                    transition: var(--transition);
                    text-align: left;
                }

                .sidebar-item:hover {
                    background: var(--surface);
                    color: var(--text-primary);
                }

                .sidebar-item.active {
                    background: var(--accent-light);
                    color: var(--accent);
                    font-weight: 600;
                }

                .sidebar-item .material-icons-round {
                    font-size: 20px;
                    width: 20px;
                    flex-shrink: 0;
                    text-align: center;
                    opacity: 0.85;
                }

                .sidebar-item.active .material-icons-round {
                    opacity: 1;
                }

                .sidebar-item-label {
                    flex: 1;
                    min-width: 0;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }

                .nav-pro-badge {
                    font-size: 10px;
                    font-weight: 700;
                    letter-spacing: 0.03em;
                    color: var(--accent);
                    background: var(--accent-light);
                    padding: 2px 6px;
                    border-radius: 999px;
                    flex-shrink: 0;
                }

                .settings-signout {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    height: 40px;
                    padding: 0 12px;
                    margin-top: auto;
                    border: none;
                    background: transparent;
                    border-radius: var(--radius-md);
                    font-size: 14px;
                    font-weight: 500;
                    color: var(--error);
                    cursor: pointer;
                    transition: var(--transition);
                }

                .settings-signout:hover {
                    background: var(--error-bg);
                }

                .settings-signout .material-icons-round {
                    font-size: 20px;
                }

                /* ── Section card ──────────────────────────────────── */
                .settings-section {
                    background: var(--background);
                    border: 1px solid var(--border-light);
                    border-radius: var(--radius-lg);
                    padding: 28px 32px;
                }

                .settings-section-header {
                    margin-bottom: 24px;
                }

                .settings-section-header h2 {
                    font-size: 17px;
                    font-weight: 600;
                    color: var(--text-primary);
                    margin-bottom: 4px;
                }

                .settings-section-header p {
                    font-size: 14px;
                    color: var(--text-secondary);
                    line-height: 1.5;
                }

                /* ── Form grid ─────────────────────────────────────── */
                .settings-form-grid {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 20px;
                }

                .settings-form-group {
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                }

                .settings-form-group.full-width {
                    grid-column: 1 / -1;
                }

                .settings-form-group label {
                    font-size: 13px;
                    font-weight: 600;
                    color: var(--text-primary);
                }

                .settings-form-group input,
                .settings-form-group select,
                .settings-form-group textarea {
                    padding: 10px 14px;
                    border: 1px solid var(--border);
                    border-radius: var(--radius-md);
                    font-size: 14px;
                    font-family: inherit;
                    color: var(--text-primary);
                    background: var(--surface);
                    transition: border-color 0.15s ease, box-shadow 0.15s ease;
                }

                .settings-form-group input:focus,
                .settings-form-group select:focus,
                .settings-form-group textarea:focus {
                    outline: none;
                    border-color: var(--accent);
                    box-shadow: 0 0 0 3px var(--accent-light);
                }

                .settings-form-group textarea {
                    resize: vertical;
                    min-height: 80px;
                    line-height: 1.5;
                }

                .settings-form-hint {
                    font-size: 12px;
                    color: var(--text-tertiary);
                    line-height: 1.4;
                }

                /* ── Settings card / row (Profit, Integracije) ─────── */
                .settings-card {
                    background: var(--surface);
                    border: 1px solid var(--border-light);
                    border-radius: var(--radius-md);
                    padding: 4px 20px;
                }

                .settings-row {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 20px;
                    padding: 16px 0;
                }

                .settings-row + .settings-row {
                    border-top: 1px solid var(--border-light);
                }

                .settings-row-label {
                    display: flex;
                    flex-direction: column;
                    gap: 3px;
                    min-width: 0;
                }

                .settings-row-label strong {
                    font-size: 14px;
                    font-weight: 600;
                    color: var(--text-primary);
                }

                .settings-row-label span {
                    font-size: 13px;
                    color: var(--text-secondary);
                    line-height: 1.4;
                }

                .settings-row-control {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    flex-shrink: 0;
                    flex-wrap: wrap;
                    justify-content: flex-end;
                }

                .settings-time-input {
                    padding: 8px 12px;
                    border: 1px solid var(--border);
                    border-radius: var(--radius-md);
                    font-size: 14px;
                    font-family: inherit;
                    background: var(--background);
                    color: var(--text-primary);
                    width: 130px;
                }

                .settings-time-input:disabled {
                    opacity: 0.5;
                }

                /* ── Switch ────────────────────────────────────────── */
                .switch {
                    position: relative;
                    display: inline-flex;
                    align-items: center;
                    width: 42px;
                    height: 24px;
                    flex-shrink: 0;
                    cursor: pointer;
                }

                .switch input {
                    position: absolute;
                    inset: 0;
                    opacity: 0;
                    margin: 0;
                    cursor: pointer;
                    z-index: 1;
                }

                .switch-track {
                    position: absolute;
                    inset: 0;
                    background: var(--border);
                    border-radius: 999px;
                    transition: background 0.2s ease;
                }

                .switch-thumb {
                    position: absolute;
                    top: 2px;
                    left: 2px;
                    width: 20px;
                    height: 20px;
                    background: #ffffff;
                    border-radius: 50%;
                    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
                    transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                }

                .switch input:checked ~ .switch-track {
                    background: var(--accent);
                }

                .switch input:checked ~ .switch-thumb {
                    transform: translateX(18px);
                }

                .switch input:disabled ~ .switch-track {
                    opacity: 0.5;
                }

                .switch input:disabled {
                    cursor: not-allowed;
                }

                /* ── Status pill / folder chip (Integracije) ───────── */
                .status-pill {
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    padding: 6px 12px;
                    border-radius: 999px;
                    font-size: 13px;
                    font-weight: 600;
                }

                .status-pill--success {
                    background: var(--success-bg);
                    color: #1a7f37;
                }

                .status-pill .material-icons-round {
                    font-size: 16px;
                }

                .folder-chip {
                    display: inline-flex;
                    align-items: center;
                    gap: 8px;
                    padding: 8px 14px;
                    background: var(--background);
                    border: 1px solid var(--border);
                    border-radius: var(--radius-md);
                    color: var(--text-primary);
                    text-decoration: none;
                    font-size: 13px;
                    font-weight: 600;
                    transition: var(--transition);
                    max-width: 260px;
                }

                .folder-chip:hover {
                    border-color: var(--accent);
                    color: var(--accent);
                }

                .folder-chip .material-icons-round {
                    font-size: 16px;
                    color: var(--warning);
                    flex-shrink: 0;
                }

                .folder-chip-name {
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }

                /* ── Banners (info / warning / locked) ─────────────── */
                .settings-banner {
                    display: flex;
                    gap: 12px;
                    padding: 16px 18px;
                    border-radius: var(--radius-md);
                    border: 1px solid transparent;
                }

                .settings-banner .material-icons-round {
                    font-size: 20px;
                    flex-shrink: 0;
                    margin-top: 1px;
                }

                .settings-banner strong {
                    display: block;
                    font-size: 14px;
                    font-weight: 600;
                    margin-bottom: 4px;
                    color: var(--text-primary);
                }

                .settings-banner p {
                    font-size: 13px;
                    line-height: 1.5;
                    color: var(--text-secondary);
                }

                .settings-banner code {
                    background: rgba(0, 0, 0, 0.06);
                    padding: 1px 5px;
                    border-radius: 4px;
                    font-size: 12px;
                    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
                }

                .settings-banner :global(.btn) {
                    margin-top: 10px;
                }

                .settings-banner--warning {
                    background: var(--warning-bg);
                    border-color: rgba(255, 149, 0, 0.25);
                }

                .settings-banner--warning .material-icons-round {
                    color: var(--warning);
                }

                .settings-banner--locked {
                    background: var(--accent-light);
                    border-color: rgba(0, 113, 227, 0.2);
                }

                .settings-banner--locked .material-icons-round {
                    color: var(--accent);
                }

                .settings-banner--info {
                    background: var(--surface);
                    border-color: var(--border-light);
                }

                .settings-banner--info .material-icons-round {
                    color: var(--text-secondary);
                }

                .settings-banner--compact {
                    padding: 14px 16px;
                }

                .settings-banner--compact strong {
                    font-size: 13px;
                }

                .settings-banner--compact p {
                    font-size: 13px;
                }

                /* ── Logo section ──────────────────────────────────── */
                .logo-section {
                    display: flex;
                    align-items: center;
                    gap: 24px;
                    padding: 20px;
                    background: var(--surface);
                    border-radius: var(--radius-md);
                    margin-bottom: 28px;
                    flex-wrap: wrap;
                }

                .logo-preview {
                    width: 120px;
                    height: 80px;
                    flex-shrink: 0;
                    border-radius: var(--radius-sm);
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
                    font-size: 26px;
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
                    margin-top: 4px;
                    padding-top: 14px;
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

                .toggle-label input[type='checkbox'] {
                    width: 17px;
                    height: 17px;
                    accent-color: var(--accent);
                    cursor: pointer;
                }

                /* ── Buttons (local additions/overrides) ───────────── */
                .settings-actions {
                    display: flex;
                    justify-content: flex-end;
                    padding-top: 4px;
                }

                .settings-actions--note {
                    justify-content: flex-start;
                    align-items: center;
                    gap: 8px;
                    padding: 12px 16px;
                    background: var(--background);
                    border: 1px solid var(--border-light);
                    border-radius: var(--radius-md);
                    color: var(--text-secondary);
                    font-size: 13px;
                }

                .settings-actions--note .material-icons-round {
                    font-size: 16px;
                    color: var(--accent);
                }

                .btn-large {
                    padding: 13px 26px;
                    font-size: 15px;
                }

                .btn-ghost {
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    padding: 8px 14px;
                    background: none;
                    border: none;
                    border-radius: var(--radius-md);
                    color: var(--text-secondary);
                    font-size: 13px;
                    font-weight: 500;
                    cursor: pointer;
                    transition: var(--transition);
                }

                .btn-ghost:hover {
                    background: var(--surface-hover);
                    color: var(--text-primary);
                }

                .btn-ghost:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }

                .btn-ghost--danger {
                    color: var(--error);
                }

                .btn-ghost--danger:hover {
                    background: var(--error-bg);
                    color: var(--error);
                }

                .btn-icon {
                    padding: 8px;
                    border-radius: var(--radius-sm);
                    flex-shrink: 0;
                }

                .loading-spinner.small {
                    width: 16px;
                    height: 16px;
                    border-width: 2px;
                }

                /* ── Bank accounts ─────────────────────────────────── */
                .bank-accounts-section {
                    margin-top: 28px;
                    padding-top: 28px;
                    border-top: 1px solid var(--border-light);
                }

                .bank-accounts-header {
                    display: flex;
                    align-items: flex-start;
                    justify-content: space-between;
                    gap: 12px;
                    margin-bottom: 18px;
                    flex-wrap: wrap;
                }

                .bank-accounts-header h3 {
                    font-size: 15px;
                    font-weight: 600;
                    color: var(--text-primary);
                    margin-bottom: 3px;
                }

                .bank-accounts-header p {
                    font-size: 13px;
                    color: var(--text-tertiary);
                }

                .bank-empty {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 8px;
                    padding: 28px;
                    border-radius: var(--radius-md);
                    background: var(--surface);
                    border: 1px dashed var(--border);
                    color: var(--text-tertiary);
                }

                .bank-empty .material-icons-round {
                    font-size: 30px;
                    opacity: 0.5;
                }

                .bank-empty p {
                    font-size: 13px;
                }

                .bank-row {
                    display: flex;
                    align-items: flex-end;
                    gap: 12px;
                    margin-bottom: 10px;
                    padding: 14px;
                    border-radius: var(--radius-md);
                    background: var(--surface);
                    border: 1px solid var(--border-light);
                }

                .bank-row:last-child {
                    margin-bottom: 0;
                }

                .bank-fields {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 14px;
                    flex: 1;
                }

                /* ── Responsive ────────────────────────────────────── */
                @media (max-width: 900px) {
                    .settings-shell {
                        flex-direction: column;
                        padding: 20px 16px;
                        gap: 20px;
                    }

                    .settings-sidebar {
                        width: 100%;
                        flex-direction: row;
                        flex-wrap: wrap;
                        align-items: stretch;
                        gap: 12px;
                    }

                    .plan-card {
                        width: 100%;
                    }

                    .settings-nav-list {
                        flex-direction: row;
                        flex-wrap: wrap;
                        flex: 1;
                        gap: 6px;
                    }

                    .nav-eyebrow {
                        display: none;
                    }

                    .sidebar-item {
                        width: auto;
                        white-space: nowrap;
                        padding: 0 14px;
                    }

                    .settings-signout {
                        margin-top: 0;
                    }

                    .settings-section {
                        padding: 22px 20px;
                    }

                    .settings-form-grid {
                        grid-template-columns: 1fr;
                    }

                    .logo-section {
                        flex-direction: column;
                        text-align: center;
                    }

                    .settings-card {
                        padding: 4px 16px;
                    }

                    .settings-row {
                        flex-direction: column;
                        align-items: flex-start;
                        gap: 10px;
                    }

                    .settings-row-control {
                        width: 100%;
                        justify-content: flex-start;
                    }

                    .bank-fields {
                        grid-template-columns: 1fr;
                    }
                }

                @media (max-width: 640px) {
                    .settings-topbar {
                        padding: 16px 20px;
                        gap: 16px;
                    }

                    .settings-topbar h1 {
                        font-size: 18px;
                    }

                    .settings-back span:last-child {
                        display: none;
                    }
                }
            `}</style>
        </div>
    );
}
