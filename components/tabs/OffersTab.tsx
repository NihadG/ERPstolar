'use client';

import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import type { Offer, Project, OfferProduct, Product } from '@/lib/types';
import { createOfferWithProducts, deleteOffer, updateOfferStatus, saveOffer, updateOfferWithProducts, getOffer, reviseOffer, getInvoicesForProject } from '@/lib/services';
import { useData } from '@/context/DataContext';
import { generateOfferPDF, generateOfferPDFBlob, type OfferPDFData } from '@/lib/pdfGenerator';
import Modal from '@/components/ui/Modal';
import { OFFER_STATUSES } from '@/lib/types';
import { sortProductsByName } from '@/lib/sortProducts';
import { offerPriceChanges, isOfferStale, flattenProjectProducts } from '@/lib/offerPricing';
import { isRowLocked } from '@/lib/offerLocking';
import InvoiceModal from '@/components/ui/InvoiceModal';
import { useIsMobile } from '@/hooks/useIsMobile';
import MobileOffersView from './mobile/MobileOffersView';
import { useGoogleIntegration } from '@/lib/google/useGoogleIntegration';
import { fileToSubfolder } from '@/lib/google/projectDrive';

interface Extra {
    name: string;
    qty: number;
    unit: string;
    price: number;
    total: number;
    note?: string;
}

interface OfferProductState {
    Product_ID: string;
    Product_Name: string;
    Quantity: number;
    Height?: number;
    Width?: number;
    Depth?: number;
    Material_Cost: number;
    included: boolean;
    margin: number;
    extras: Extra[];
    // Labor cost fields
    laborWorkers: number;
    laborDays: number;
    laborDailyRate: number;
    /** Red već ima cijenu u poslanoj/prihvaćenoj ponudi — izmjena samo kroz Revidiraj. */
    locked: boolean;
}

interface OffersTabProps {
    offers: Offer[];
    projects: Project[];
    onRefresh: (...collections: string[]) => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
    onNavigateToProject?: (projectId: string, productId: string, offerId?: string) => void;
    autoEditOfferId?: string | null;
    autoScrollProductId?: string | null;
    onClearAutoEdit?: () => void;
    /** Prelaz u Proizvodnju s predodabranim proizvodima (isti mehanizam kao iz Projekata). */
    onCreateWorkOrder?: (projectId: string, projectName: string, products: { productId: string; productName: string; quantity: number }[]) => void;
}

export default function OffersTab({ offers, projects, onRefresh, showToast, onNavigateToProject, autoEditOfferId, autoScrollProductId, onClearAutoEdit, onCreateWorkOrder }: OffersTabProps) {
    const { organizationId } = useData();
    const gi = useGoogleIntegration();
    const isMobile = useIsMobile();
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [sortBy, setSortBy] = useState<'date-desc' | 'date-asc' | 'amount-desc' | 'amount-asc' | 'client-asc' | 'client-desc'>('date-desc');
    const [groupBy, setGroupBy] = useState<'none' | 'status' | 'project'>('none');
    // Create Offer Modal State
    const [createModal, setCreateModal] = useState(false);
    const [selectedProjectId, setSelectedProjectId] = useState('');
    const [offerName, setOfferName] = useState('');
    const [offerProducts, setOfferProducts] = useState<OfferProductState[]>([]);
    const [transportCost, setTransportCost] = useState(0);
    const [onsiteAssembly, setOnsiteAssembly] = useState(false);
    const [onsiteDiscount, setOnsiteDiscount] = useState(0);
    const [validUntil, setValidUntil] = useState('');
    const [notes, setNotes] = useState('');
    const [offerCurrency, setOfferCurrency] = useState<'KM' | 'EUR'>('KM');
    const [offerLanguage, setOfferLanguage] = useState<'bs' | 'en'>('bs');
    const [isSaving, setIsSaving] = useState(false); // Double-save guard

    // Extras List Modal State (intermediate view of existing extras)
    const [extrasListModal, setExtrasListModal] = useState(false);
    const [extrasListProductIndex, setExtrasListProductIndex] = useState<number | null>(null);

    // Extras Modal State (add/edit single extra)
    const [extrasModal, setExtrasModal] = useState(false);
    const [currentProductIndex, setCurrentProductIndex] = useState<number | null>(null);
    const [editingExtraIndex, setEditingExtraIndex] = useState<number | null>(null);
    const [extraName, setExtraName] = useState('');
    const [extraCustomName, setExtraCustomName] = useState('');
    const [extraQty, setExtraQty] = useState(1);
    const [extraUnit, setExtraUnit] = useState('kom');
    const [extraPrice, setExtraPrice] = useState(0);
    const [extraNote, setExtraNote] = useState('');

    // View Offer Modal State
    const [viewModal, setViewModal] = useState(false);
    const [currentOffer, setCurrentOffer] = useState<Offer | null>(null);
    const [isEditMode, setIsEditMode] = useState(false);
    const [modalLoading, setModalLoading] = useState(false);
    // Zaključavanje je PO REDU (OfferProductState.locked, računa se jednom pri učitavanju —
    // vidi lib/offerLocking.ts). `editLocked` ovdje znači samo "ponuda je Poslano/Prihvaćeno"
    // (informativni baner) — više NE blokira Save niti se otključava u cjelini.
    const [editLocked, setEditLocked] = useState(false);
    // Eksplicitni izuzetak od zaključavanja (rješavanje konflikta duplo prihvaćenog proizvoda) —
    // ti Product_ID-evi ostaju editabilni ovu sesiju i šalju se serveru uz snimanje.
    const [forceUnlockedIds, setForceUnlockedIds] = useState<Set<string>>(new Set());
    // Završni račun — otvara se za prihvaćenu ponudu (vidi InvoiceModal).
    const [invoiceModalOffer, setInvoiceModalOffer] = useState<Offer | null>(null);
    // Projekat već ima IZDAT završni račun → cijela ponuda se otvara zaključana (svi redovi),
    // izmjena samo kroz Revidiraj + storniranje računa.
    const [invoiceIssuedLock, setInvoiceIssuedLock] = useState(false);

    // Svi proizvodi iz svih projekata (za detekciju zastarjelih cijena u ponudama).
    const allProducts = useMemo(() => flattenProjectProducts(projects), [projects]);

    // PDV State
    const [includePDV, setIncludePDV] = useState(true);
    const [pdvRate, setPdvRate] = useState(17);

    // Client Override State (for swapping client on an offer)
    const [clientOverride, setClientOverride] = useState(false);
    const [overrideClientName, setOverrideClientName] = useState('');
    const [overrideClientPhone, setOverrideClientPhone] = useState('');
    const [overrideClientEmail, setOverrideClientEmail] = useState('');
    const [overrideClientAddress, setOverrideClientAddress] = useState('');
    const [overrideClientType, setOverrideClientType] = useState<'fizicko' | 'pravno'>('fizicko');
    const [overrideClientIdNumber, setOverrideClientIdNumber] = useState('');
    const [overrideClientPdvNumber, setOverrideClientPdvNumber] = useState('');

    // Unsaved changes confirmation dialog
    const [confirmCloseModal, setConfirmCloseModal] = useState(false);
    const [pendingNavigate, setPendingNavigate] = useState<{ projectId: string; productId: string; offerId?: string } | null>(null);

    // Dropdown per-card (actions + status)
    const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
    const [activeStatusDropdown, setActiveStatusDropdown] = useState<string | null>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const statusDropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function handleClickOutside(e: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setActiveDropdown(null);
            }
            if (statusDropdownRef.current && !statusDropdownRef.current.contains(e.target as Node)) {
                setActiveStatusDropdown(null);
            }
        }
        if (activeDropdown || activeStatusDropdown) document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [activeDropdown, activeStatusDropdown]);

    // Auto-open offer edit modal when returning from project materials
    useEffect(() => {
        if (autoEditOfferId && offers.length > 0) {
            const offer = offers.find(o => o.Offer_ID === autoEditOfferId);
            if (offer) {
                // Open the edit modal for this offer
                openEditModal(offer).then(() => {
                    // After modal loads, scroll to the product if provided
                    if (autoScrollProductId) {
                        setTimeout(() => {
                            const el = document.getElementById(`offer-product-${autoScrollProductId}`);
                            if (el) {
                                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                // Brief highlight animation
                                el.style.transition = 'box-shadow 0.3s ease';
                                el.style.boxShadow = '0 0 0 3px rgba(59, 130, 246, 0.5)';
                                setTimeout(() => {
                                    el.style.boxShadow = '';
                                }, 2000);
                            }
                        }, 500); // Wait for modal and products to render
                    }
                });
            }
            // Clear the auto-edit state so it doesn't re-trigger
            if (onClearAutoEdit) onClearAutoEdit();
        }
    }, [autoEditOfferId, offers.length]);

    // Company Info & App Settings (centralized in DataContext)
    const { companyInfo, appSettings } = useData();

    // ============================================
    // UNSAVED CHANGES CONFIRMATION
    // ============================================

    /** Close modal with unsaved-changes prompt */
    function handleCloseOfferModal() {
        // If there are products loaded (user has been editing), ask to save
        if (offerProducts.length > 0 && selectedProjectId) {
            setPendingNavigate(null);
            setConfirmCloseModal(true);
        } else {
            // Nothing to save, just close
            doCloseOfferModal();
        }
    }

    /** Actually close the modal without saving */
    function doCloseOfferModal() {
        setCreateModal(false);
        setIsEditMode(false);
        setCurrentOffer(null);
        setConfirmCloseModal(false);
        setPendingNavigate(null);
        setForceUnlockedIds(new Set());
    }

    /** Save and then close (or navigate) */
    async function handleSaveAndClose() {
        setConfirmCloseModal(false);
        await handleSaveOffer();
        // If there's a pending navigation, do it after save
        if (pendingNavigate && onNavigateToProject) {
            onNavigateToProject(pendingNavigate.projectId, pendingNavigate.productId, pendingNavigate.offerId);
        }
        setPendingNavigate(null);
    }

    /** Don't save, just close (or navigate) */
    function handleDiscardAndClose() {
        const nav = pendingNavigate;
        doCloseOfferModal();
        // If there's a pending navigation, do it
        if (nav && onNavigateToProject) {
            onNavigateToProject(nav.projectId, nav.productId, nav.offerId);
        }
    }

    /** "Otvori u projektu" button handler — prompt to save first */
    function handleNavigateToProjectFromOffer(projectId: string, productId: string, offerId?: string) {
        if (offerProducts.length > 0 && selectedProjectId) {
            setPendingNavigate({ projectId, productId, offerId });
            setConfirmCloseModal(true);
        } else {
            // Nothing to save, navigate directly
            if (onNavigateToProject) {
                onNavigateToProject(projectId, productId, offerId);
            }
        }
    }


    const filteredOffers = offers.filter(offer => {
        const term = searchTerm.toLowerCase();
        const matchesSearch = offer.Offer_Number?.toLowerCase().includes(term) ||
            offer.Client_Name?.toLowerCase().includes(term) ||
            offer.Name?.toLowerCase().includes(term);
        const matchesStatus = !statusFilter || offer.Status === statusFilter;
        return matchesSearch && matchesStatus;
    });

    // Sort filtered offers
    const sortedOffers = [...filteredOffers].sort((a, b) => {
        switch (sortBy) {
            case 'date-desc': return new Date(b.Created_Date || 0).getTime() - new Date(a.Created_Date || 0).getTime();
            case 'date-asc': return new Date(a.Created_Date || 0).getTime() - new Date(b.Created_Date || 0).getTime();
            case 'amount-desc': return (b.Total || 0) - (a.Total || 0);
            case 'amount-asc': return (a.Total || 0) - (b.Total || 0);
            case 'client-asc': return (a.Client_Name || '').localeCompare(b.Client_Name || '', 'hr');
            case 'client-desc': return (b.Client_Name || '').localeCompare(a.Client_Name || '', 'hr');
            default: return 0;
        }
    });

    // Group sorted offers
    const groupedOffers: { label: string; offers: Offer[] }[] = (() => {
        if (groupBy === 'none') return [{ label: '', offers: sortedOffers }];

        const groups = new Map<string, Offer[]>();
        const ORDER = groupBy === 'status'
            ? ['Nacrt', 'Poslano', 'Prihva\u0107eno', 'Odbijeno', 'Isteklo']
            : [];

        sortedOffers.forEach(offer => {
            const key = groupBy === 'status'
                ? (offer.Status || 'Nacrt')
                : (offer.Client_Name || 'Nepoznat klijent');
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)!.push(offer);
        });

        // Sort group keys
        const keys = Array.from(groups.keys()).sort((a, b) => {
            if (groupBy === 'status') {
                const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
                return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
            }
            return a.localeCompare(b, 'hr');
        });

        return keys.map(k => ({ label: k, offers: groups.get(k)! }));
    })();

    const EUR_RATE = 1.95583;
    const toEUR = (km: number) => km / EUR_RATE;
    const toKM = (eur: number) => eur * EUR_RATE;
    /** Format an amount (always stored in KM) for display in the given currency */
    const formatPrice = (amount: number, currency: 'KM' | 'EUR' = 'KM') => {
        if (currency === 'EUR') return toEUR(amount).toFixed(2) + ' €';
        return formatCurrency(amount);
    };

    // Get selected project
    const selectedProject = useMemo(() => {
        return projects.find(p => p.Project_ID === selectedProjectId);
    }, [selectedProjectId, projects]);

    function getDefaultValidDate(): string {
        const date = new Date();
        date.setDate(date.getDate() + 14);
        return date.toISOString().split('T')[0];
    }

    function getStatusClass(status: string): string {
        return 'status-' + status.toLowerCase()
            .replace(/\s+/g, '-')
            .replace(/č/g, 'c')
            .replace(/ć/g, 'c')
            .replace(/š/g, 's')
            .replace(/ž/g, 'z')
            .replace(/đ/g, 'd');
    }

    function formatCurrency(amount: number): string {
        return (amount || 0).toFixed(2) + ' KM';
    }

    function formatDate(dateString: string): string {
        if (!dateString) return '-';
        const date = new Date(dateString);
        return date.toLocaleDateString('hr-HR');
    }

    // ============================================
    // CREATE OFFER MODAL
    // ============================================

    function openCreateModal() {
        setEditLocked(false); // nova ponuda — uvijek otključana
        setForceUnlockedIds(new Set());
        setSelectedProjectId('');
        setOfferName('');
        setOfferProducts([]);
        setTransportCost(0);
        setOnsiteAssembly(false);
        setOnsiteDiscount(0);
        setValidUntil(getDefaultValidDate());
        setNotes('Plaćanje: Avansno ili po dogovoru\nRok isporuke: Po dogovoru nakon potvrde');
        setOfferCurrency('KM');
        setOfferLanguage('bs');
        // Reset client override
        setClientOverride(false);
        setOverrideClientName('');
        setOverrideClientPhone('');
        setOverrideClientEmail('');
        setOverrideClientAddress('');
        setOverrideClientType('fizicko');
        setOverrideClientIdNumber('');
        setOverrideClientPdvNumber('');
        setCreateModal(true);
    }

    function loadProjectForOffer(projectId: string) {
        setSelectedProjectId(projectId);

        if (!projectId) {
            setOfferProducts([]);
            return;
        }

        const project = projects.find(p => p.Project_ID === projectId);
        if (!project) return;

        // Get products that are already in ACCEPTED offers for this project
        const productIdsInAcceptedOffers = new Set<string>();
        offers
            .filter(o => o.Project_ID === projectId && o.Status === 'Prihvaćeno')
            .forEach(o => {
                (o.products || []).forEach(op => {
                    if (op.Included !== false) {
                        productIdsInAcceptedOffers.add(op.Product_ID);
                    }
                });
            });

        // Filter out products that are already in accepted offers
        const availableProducts = (project.products || []).filter(
            p => !productIdsInAcceptedOffers.has(p.Product_ID)
        );

        // DEDUP FIX: Remove duplicate products by Product_ID
        const seenIds = new Set<string>();
        const uniqueProducts = availableProducts.filter(p => {
            if (seenIds.has(p.Product_ID)) return false;
            seenIds.add(p.Product_ID);
            return true;
        });

        // Initialize products with offer-specific fields
        const products: OfferProductState[] = uniqueProducts.map(p => ({
            Product_ID: p.Product_ID,
            Product_Name: p.Name,
            Quantity: p.Quantity || 1,
            Height: p.Height,
            Width: p.Width,
            Depth: p.Depth,
            Material_Cost: p.Material_Cost || 0,
            included: true,
            margin: 0,
            extras: [],
            laborWorkers: 0,
            laborDays: 0,
            laborDailyRate: 0,
            locked: false, // nova (Nacrt) ponuda — nijedan red još nema cijenu poslanu klijentu
        }));

        setOfferProducts(sortProductsByName(products, p => p.Product_Name));
    }

    function toggleProductIncluded(index: number, included: boolean) {
        const updated = [...offerProducts];
        updated[index].included = included;
        setOfferProducts(updated);
    }

    function updateProductMargin(index: number, margin: number) {
        const updated = [...offerProducts];
        updated[index].margin = margin;
        setOfferProducts(updated);
    }

    // Refresh material cost from latest project product data (jedan proizvod)
    function refreshMaterialCost(index: number) {
        const product = offerProducts[index];
        if (!product || !selectedProjectId || product.locked) return;

        const project = projects.find(p => p.Project_ID === selectedProjectId);
        if (!project) return;

        const projectProduct = (project.products || []).find(p => p.Product_ID === product.Product_ID);
        if (!projectProduct) {
            showToast('Proizvod nije pronađen u projektu', 'error');
            return;
        }

        // Calculate fresh material cost from product materials
        const freshCost = (projectProduct.materials || []).reduce((sum, m) => sum + (m.Total_Price || 0), 0);
        const updated = [...offerProducts];
        updated[index].Material_Cost = freshCost;
        setOfferProducts(updated);
        showToast(`Cijena materijala ažurirana: ${freshCost.toFixed(2)} KM`, 'success');
    }

    // Osvježi cijene materijala SVIH proizvoda u ponudi na trenutne (iz projekta).
    // Globalno dugme iznad kolone Materijal + akcija "Ažuriraj cijene" u banneru zaključane ponude.
    function refreshAllMaterialCosts() {
        if (!selectedProjectId) return;
        const project = projects.find(p => p.Project_ID === selectedProjectId);
        if (!project) return;
        let changed = 0;
        const updated = offerProducts.map(op => {
            if (op.locked) return op; // zaključan red — cijena se ne dira (samo kroz Revidiraj)
            const pp = (project.products || []).find(p => p.Product_ID === op.Product_ID);
            if (!pp) return op;
            const freshCost = (pp.materials || []).reduce((sum, m) => sum + (m.Total_Price || 0), 0);
            if (Math.round(freshCost * 100) !== Math.round((op.Material_Cost || 0) * 100)) changed++;
            return { ...op, Material_Cost: freshCost };
        });
        setOfferProducts(updated);
        showToast(changed > 0 ? `Ažurirano ${changed} cijena — provjeri i sačuvaj ponudu.` : 'Cijene su već ažurne.', changed > 0 ? 'success' : 'info');
    }

    function calculateProductTotal(product: OfferProductState): number {
        const materialCost = product.Material_Cost || 0;
        const margin = product.margin || 0;
        const extrasTotal = (product.extras || []).reduce((sum, e) => sum + (e.total || 0), 0);
        const laborTotal = (product.laborWorkers || 0) * (product.laborDays || 0) * (product.laborDailyRate || 0);
        const quantity = product.Quantity || 1;
        return (materialCost + margin + extrasTotal + laborTotal) * quantity;
    }

    function calculateOfferTotals() {
        let subtotal = 0;
        offerProducts.forEach(p => {
            if (p.included) {
                subtotal += calculateProductTotal(p);
            }
        });

        const transport = transportCost || 0;
        const discount = onsiteAssembly ? (onsiteDiscount || 0) : 0;
        const baseTotal = subtotal + transport - discount;
        const pdvAmount = includePDV ? (baseTotal * pdvRate / 100) : 0;
        const total = baseTotal + pdvAmount;

        return { subtotal, transport, discount, pdvAmount, total };
    }

    // ============================================
    // EXTRAS LIST MODAL (view/manage existing extras)
    // ============================================

    function openExtrasListOrAdd(productIndex: number) {
        const product = offerProducts[productIndex];
        if (product.extras && product.extras.length > 0) {
            // Has existing extras — show the list view
            setExtrasListProductIndex(productIndex);
            setExtrasListModal(true);
        } else {
            // No extras yet — go straight to add form
            openExtrasModal(productIndex);
        }
    }

    // ============================================
    // EXTRAS MODAL (add/edit single extra)
    // ============================================

    function openExtrasModal(productIndex: number, extraIndex?: number) {
        setCurrentProductIndex(productIndex);
        setEditingExtraIndex(extraIndex !== undefined ? extraIndex : null);

        if (extraIndex !== undefined) {
            // Edit mode — pre-fill with existing extra data
            const extra = offerProducts[productIndex].extras[extraIndex];
            const predefined = ['LED instalacija', 'Ugradnja česme', 'Fugiranje', 'Montaža lajsni', 'Ugradnja spotova', 'Silikoniranje'];
            if (predefined.includes(extra.name)) {
                setExtraName(extra.name);
                setExtraCustomName('');
            } else {
                setExtraName('custom');
                setExtraCustomName(extra.name);
            }
            setExtraQty(extra.qty);
            setExtraUnit(extra.unit);
            setExtraPrice(extra.price);
            setExtraNote(extra.note || '');
        } else {
            // Add mode — reset fields
            setExtraName('');
            setExtraCustomName('');
            setExtraQty(1);
            setExtraUnit('kom');
            setExtraPrice(0);
            setExtraNote('');
        }

        setExtrasModal(true);
    }

    function addExtraToProduct() {
        if (currentProductIndex === null) return;

        const name = extraName === 'custom' ? extraCustomName : extraName;
        if (!name) {
            showToast('Unesite naziv usluge/dodatka', 'error');
            return;
        }

        const extra: Extra = {
            name,
            qty: extraQty,
            unit: extraUnit,
            price: extraPrice,
            total: extraQty * extraPrice,
            note: extraNote
        };

        const updated = [...offerProducts];
        if (editingExtraIndex !== null) {
            // Edit mode — replace existing extra
            updated[currentProductIndex].extras[editingExtraIndex] = extra;
            setOfferProducts(updated);
            setExtrasModal(false);
            showToast('Dodatak ažuriran', 'success');
        } else {
            // Add mode — push new extra
            updated[currentProductIndex].extras.push(extra);
            setOfferProducts(updated);
            setExtrasModal(false);
            showToast('Dodatak dodan', 'success');
        }
    }

    function removeExtra(productIndex: number, extraIndex: number) {
        const updated = [...offerProducts];
        updated[productIndex].extras.splice(extraIndex, 1);
        setOfferProducts(updated);
    }

    // ============================================
    // SAVE OFFER
    // ============================================

    async function handleSaveOffer() {
        // DOUBLE-SAVE GUARD: Prevent duplicate offer creation from rapid clicks
        if (isSaving) return;

        if (!selectedProjectId) {
            showToast('Odaberite projekat', 'error');
            return;
        }

        const includedProducts = offerProducts.filter(p => p.included);
        if (includedProducts.length === 0) {
            showToast('Označite barem jedan proizvod', 'error');
            return;
        }

        setIsSaving(true);

        // ALWAYS save all monetary values in KM — Currency is only a display flag
        // Build client override fields — only save if override is active
        const clientFields = clientOverride ? {
            Client_Name: overrideClientName,
            Client_Phone: overrideClientPhone,
            Client_Email: overrideClientEmail,
            Client_Address: overrideClientAddress,
            Client_Type: overrideClientType,
            Client_ID_Number: overrideClientIdNumber,
            Client_PDV_Number: overrideClientPdvNumber,
        } : {
            // Clear any previous override — let service enrich from project
            Client_Name: '',
            Client_Phone: '',
            Client_Email: '',
            Client_Address: '',
            Client_Type: '',
            Client_ID_Number: '',
            Client_PDV_Number: '',
        };

        const offerData = {
            Project_ID: selectedProjectId,
            Name: offerName || '',
            Transport_Cost: transportCost,
            Onsite_Assembly: onsiteAssembly,
            Onsite_Discount: onsiteDiscount,
            Valid_Until: validUntil,
            Notes: notes,
            Include_PDV: includePDV,
            PDV_Rate: pdvRate,
            Currency: offerCurrency,
            Language: offerLanguage,
            // Eksplicitni izuzetak od zaključavanja po redu (rješavanje konflikta) — server ga
            // koristi u mergeOfferProducts da tretira ove Product_ID-eve kao otključane.
            unlockProductIds: Array.from(forceUnlockedIds),
            ...clientFields,
            products: offerProducts.map(p => {
                return {
                    Product_ID: p.Product_ID,
                    Product_Name: p.Product_Name,
                    Quantity: p.Quantity,
                    Included: p.included,
                    Material_Cost: p.Material_Cost,
                    Margin: p.margin,
                    Extras: p.extras.map(e => ({
                        ...e,
                        price: e.price,
                        total: e.qty * e.price
                    })),
                    Labor_Workers: p.laborWorkers,
                    Labor_Days: p.laborDays,
                    Labor_Daily_Rate: p.laborDailyRate
                };
            })
        };

        let result;

        if (isEditMode && currentOffer) {
            // Update existing offer with all products
            result = await updateOfferWithProducts({
                ...offerData,
                Offer_ID: currentOffer.Offer_ID,
                Offer_Number: currentOffer.Offer_Number,
            }, organizationId!);

            if (result.success) {
                showToast('Ponuda ažurirana', 'success');
                setCreateModal(false);
                setIsEditMode(false);
                setCurrentOffer(null);
                onRefresh('offers');
            } else {
                showToast(result.message, 'error');
            }
        } else {
            // Create new offer
            result = await createOfferWithProducts(offerData as any, organizationId!);

            if (result.success) {
                showToast('Ponuda kreirana: ' + result.data?.Offer_Number, 'success');
                setCreateModal(false);
                onRefresh('offers');
            } else {
                showToast(result.message, 'error');
            }
        }

        setIsSaving(false);
    }

    // ============================================
    // VIEW OFFER
    // ============================================

    async function openViewModal(offerId: string) {
        // Open modal immediately with loading state
        setCurrentOffer(null);
        setIsEditMode(false);
        setViewModal(true);
        setModalLoading(true);

        const offer = await getOffer(offerId, organizationId!);
        setModalLoading(false);

        if (offer) {
            setCurrentOffer(offer);
        } else {
            setViewModal(false);
            showToast('Greška pri učitavanju ponude', 'error');
        }
    }

    async function handleDeleteOffer(offerId: string) {
        if (!confirm('Jeste li sigurni da želite obrisati ovu ponudu?')) return;

        const result = await deleteOffer(offerId, organizationId!);
        if (result.success) {
            showToast(result.message, 'success');
            onRefresh('offers');
        } else {
            showToast(result.message, 'error');
        }
    }

    async function handleUpdateStatus(offerId: string, status: string) {
        const result = await updateOfferStatus(offerId, status, organizationId!);
        if (result.success) {
            showToast('Status ažuriran', 'success');
            onRefresh('offers', 'projects');
            // Refresh view modal if open
            if (currentOffer && currentOffer.Offer_ID === offerId) {
                const updated = await getOffer(offerId, organizationId!);
                setCurrentOffer(updated);
            }
            // Prihvaćena ponuda ≠ radni nalog (odvojen ručni korak u Proizvodnji) —
            // ponudi konverziju odmah da korak ne bude zaboravljen.
            if (status === 'Prihvaćeno' && onCreateWorkOrder) {
                const accepted = await getOffer(offerId, organizationId!);
                if (accepted) setCreateWOPrompt(accepted);
            }
        } else if (result.conflicts && result.conflicts.length > 0) {
            // Show conflict notification
            showToast(result.message, 'error');

            // Open edit modal with conflicting products de-selected
            const offer = offers.find(o => o.Offer_ID === offerId);
            if (offer) {
                const conflictIds = new Set(result.conflicts.map(c => c.Product_ID));
                // Open edit modal, then after loading, de-select conflicting products
                const fullOffer = await getOffer(offerId, organizationId!);
                if (fullOffer) {
                    // All monetary values are ALWAYS stored in KM — Currency is only a display flag
                    setEditLocked(false); // rješavanje konflikata je aktivna izmjena — ne zaključavaj
                    setForceUnlockedIds(conflictIds); // konfliktni redovi ostaju editabilni i pored cijene/statusa
                    setCurrentOffer(fullOffer);
                    setIsEditMode(true);
                    setSelectedProjectId(fullOffer.Project_ID);
                    setOfferName(fullOffer.Name || '');
                    setTransportCost(fullOffer.Transport_Cost || 0);
                    setOnsiteAssembly(fullOffer.Onsite_Assembly || false);
                    setOnsiteDiscount(fullOffer.Onsite_Discount || 0);
                    setValidUntil(fullOffer.Valid_Until ? fullOffer.Valid_Until.split('T')[0] : getDefaultValidDate());
                    setNotes(fullOffer.Notes || '');
                    setIncludePDV((fullOffer as any).Include_PDV ?? true);
                    setPdvRate((fullOffer as any).PDV_Rate ?? 17);
                    setOfferCurrency((fullOffer as any).Currency || 'KM');
                    setOfferLanguage((fullOffer as any).Language || 'bs');

                    // Isti "smeće red" filter kao u openEditModal: obrisan iz projekta + nikad
                    // nije bio uključen → tiho izbaci. Uključeni redovi se ne diraju.
                    const conflictProjectProducts = projects.find(pr => pr.Project_ID === fullOffer.Project_ID)?.products || [];
                    const products: OfferProductState[] = (fullOffer.products || []).filter((p: OfferProduct) => {
                        const stillExistsInProject = conflictProjectProducts.some(pp => pp.Product_ID === p.Product_ID);
                        return stillExistsInProject || p.Included !== false;
                    }).map((p: OfferProduct) => {
                        return {
                            Product_ID: p.Product_ID,
                            Product_Name: p.Product_Name,
                            Quantity: p.Quantity || 1,
                            Height: 0, Width: 0, Depth: 0,
                            Material_Cost: p.Material_Cost || 0,
                            // De-select conflicting products
                            included: p.Included !== false && !conflictIds.has(p.Product_ID),
                            margin: p.Margin || 0,
                            extras: ((p as any).Extras || (p as any).extras || []).map((e: any) => {
                                const price = e.price || e.Price || e.Unit_Price || 0;
                                const qty = e.qty || e.Qty || e.Quantity || 1;
                                return {
                                    name: e.name || e.Name || '',
                                    qty: qty,
                                    unit: e.unit || e.Unit || 'kom',
                                    price: price,
                                    total: qty * price,
                                    note: e.note || e.Note || ''
                                };
                            }),
                            laborWorkers: (p as any).Labor_Workers || (p as any).laborWorkers || 0,
                            laborDays: (p as any).Labor_Days || (p as any).laborDays || 0,
                            laborDailyRate: (p as any).Labor_Daily_Rate || (p as any).laborDailyRate || 0,
                            // Konfliktni proizvod ostaje editabilan (deselektovan gore) — ostali redovi
                            // se ponašaju standardno (zaključani ako već imaju cijenu).
                            locked: isRowLocked(fullOffer.Status, p) && !conflictIds.has(p.Product_ID),
                        };
                    });

                    setOfferProducts(sortProductsByName(products, p => p.Product_Name));
                    setCreateModal(true);
                }
            }
        } else {
            showToast(result.message, 'error');
        }
    }

    // Upit "Kreiraj radni nalog?" nakon prihvatanja ponude.
    const [createWOPrompt, setCreateWOPrompt] = useState<Offer | null>(null);

    // REVIZIJA: kopira ponudu u novu 'Nacrt' (broj -R2/-R3…), original ide u 'Revidirano'.
    // Izmjene se rade na reviziji — original ostaje kao trag šta je poslano klijentu.
    async function handleReviseOffer(offer: Offer) {
        const res = await reviseOffer(offer.Offer_ID, organizationId!);
        if (!res.success || !res.data) {
            showToast(res.message, 'error');
            return;
        }
        showToast(res.message, 'success');
        onRefresh('offers');
        const revision = await getOffer(res.data.Offer_ID, organizationId!);
        if (revision) openEditModal(revision);
    }

    // Open edit modal for existing offer
    async function openEditModal(offer: Offer) {
        // Poslane/prihvaćene ponude: redovi koji već imaju cijenu se otvaraju ZAKLJUČANO (po redu,
        // vidi lib/offerLocking.ts) — cijena ka klijentu se ne mijenja slučajno, izmjena samo kroz
        // „Revidiraj". Prazni (nedefinisani) redovi ostaju editabilni — inkrementalni tok.
        const locked = offer.Status === 'Poslano' || offer.Status === 'Prihvaćeno';
        setEditLocked(locked);
        setForceUnlockedIds(new Set());
        setInvoiceIssuedLock(false);
        // Open modal immediately with loading state
        setCurrentOffer(offer);
        setIsEditMode(true);
        setCreateModal(true);
        setModalLoading(true);

        // Load full offer with products
        const [fullOffer, projectInvoices] = await Promise.all([
            getOffer(offer.Offer_ID, organizationId!),
            getInvoicesForProject(offer.Project_ID, organizationId!),
        ]);
        setModalLoading(false);
        // Izdat završni račun → cijela ponuda zaključana (izmjena samo kroz Revidiraj + storno računa).
        const invoiceIssued = projectInvoices.some(i => i.Status === 'Izdat');
        setInvoiceIssuedLock(invoiceIssued);

        if (!fullOffer) {
            showToast('Greška pri učitavanju ponude', 'error');
            setCreateModal(false);
            return;
        }

        // Set the project
        setSelectedProjectId(fullOffer.Project_ID);

        // All monetary values are ALWAYS stored in KM — Currency is only a display flag.
        // No conversion needed when loading into editor.

        // Get fresh product data from project for material cost fallback
        const project = projects.find(pr => pr.Project_ID === fullOffer.Project_ID);
        const projectProducts = project?.products || [];

        // Load products from the offer — DEDUP by Product_ID
        const seenProductIds = new Set<string>();
        const products: OfferProductState[] = (fullOffer.products || []).filter((p: OfferProduct) => {
            if (seenProductIds.has(p.Product_ID)) return false;
            // Proizvod obrisan iz projekta A NIJE bio uključen u ponudu — čist "smeće" red
            // (ne utiče na cijenu/ukupno), tiho ga izbacujemo iz editora. Obrisan proizvod
            // koji JESTE uključen se NE dira — ne mijenjamo stavke već poslane/prihvaćene ponude.
            const stillExistsInProject = projectProducts.some(pp => pp.Product_ID === p.Product_ID);
            if (!stillExistsInProject && p.Included === false) return false;
            seenProductIds.add(p.Product_ID);
            return true;
        }).map((p: OfferProduct) => {
            // Fall back to fresh product Material_Cost when offer value is 0
            const freshProduct = projectProducts.find(pp => pp.Product_ID === p.Product_ID);
            const materialCost = p.Material_Cost || freshProduct?.Material_Cost || 0;
            const margin = p.Margin || 0;
            const laborDailyRate = (p as any).Labor_Daily_Rate || (p as any).laborDailyRate || 0;

            return {
                Product_ID: p.Product_ID,
                Product_Name: p.Product_Name,
                Quantity: p.Quantity || 1,
                Height: freshProduct?.Height || 0,
                Width: freshProduct?.Width || 0,
                Depth: freshProduct?.Depth || 0,
                Material_Cost: materialCost,
                included: p.Included !== false,
                margin: margin,
                extras: ((p as any).Extras || (p as any).extras || []).map((e: any) => {
                    const price = e.price || e.Price || e.Unit_Price || 0;
                    const qty = e.qty || e.Qty || e.Quantity || 1;
                    return {
                        name: e.name || e.Name || '',
                        qty: qty,
                        unit: e.unit || e.Unit || 'kom',
                        price: price,
                        total: qty * price,
                        note: e.note || e.Note || ''
                    };
                }),
                laborWorkers: (p as any).Labor_Workers || (p as any).laborWorkers || 0,
                laborDays: (p as any).Labor_Days || (p as any).laborDays || 0,
                laborDailyRate: laborDailyRate,
                locked: invoiceIssued || isRowLocked(fullOffer.Status, p),
            };
        });

        // --- AUTO-MERGE: Append new project products not yet in this offer ---
        // Collect IDs of products already in ACCEPTED offers for this project
        const productIdsInAcceptedOffers = new Set<string>();
        offers
            .filter(o => o.Project_ID === fullOffer.Project_ID && o.Status === 'Prihvaćeno')
            .forEach(o => {
                (o.products || []).forEach(op => {
                    if (op.Included !== false) {
                        productIdsInAcceptedOffers.add(op.Product_ID);
                    }
                });
            });

        // Find project products that are NOT in the offer yet and NOT in accepted offers
        const newProjectProducts = projectProducts.filter(pp =>
            !seenProductIds.has(pp.Product_ID) &&
            !productIdsInAcceptedOffers.has(pp.Product_ID)
        );

        // Add them as unselected (included: false) entries
        for (const pp of newProjectProducts) {
            if (seenProductIds.has(pp.Product_ID)) continue; // extra safety dedup
            seenProductIds.add(pp.Product_ID);
            products.push({
                Product_ID: pp.Product_ID,
                Product_Name: pp.Name,
                Quantity: pp.Quantity || 1,
                Height: pp.Height || 0,
                Width: pp.Width || 0,
                Depth: pp.Depth || 0,
                Material_Cost: pp.Material_Cost || 0,
                included: false,
                margin: 0,
                extras: [],
                laborWorkers: 0,
                laborDays: 0,
                laborDailyRate: 0,
                locked: invoiceIssued, // novi red — editabilan OSIM ako je projekat već fakturisan
            });
        }

        setOfferProducts(sortProductsByName(products, p => p.Product_Name));
        setOfferName(fullOffer.Name || '');
        // All monetary values already in KM — no conversion needed
        setTransportCost(fullOffer.Transport_Cost || 0);
        setOnsiteAssembly(fullOffer.Onsite_Assembly || false);
        setOnsiteDiscount(fullOffer.Onsite_Discount || 0);
        setValidUntil(fullOffer.Valid_Until ? fullOffer.Valid_Until.split('T')[0] : getDefaultValidDate());
        setNotes(fullOffer.Notes || '');
        setIncludePDV((fullOffer as any).Include_PDV ?? true);
        setPdvRate((fullOffer as any).PDV_Rate ?? 17);
        setOfferCurrency((fullOffer as any).Currency || 'KM');
        setOfferLanguage((fullOffer as any).Language || 'bs');

        // Load client override — check if offer has its own client data different from project
        const proj = projects.find(pr => pr.Project_ID === fullOffer.Project_ID);
        const hasOverride = fullOffer.Client_Name && proj && fullOffer.Client_Name !== proj.Client_Name;
        if (hasOverride) {
            setClientOverride(true);
            setOverrideClientName(fullOffer.Client_Name || '');
            setOverrideClientPhone(fullOffer.Client_Phone || '');
            setOverrideClientEmail(fullOffer.Client_Email || '');
            setOverrideClientAddress(fullOffer.Client_Address || '');
            setOverrideClientType(fullOffer.Client_Type || 'fizicko');
            setOverrideClientIdNumber(fullOffer.Client_ID_Number || '');
            setOverrideClientPdvNumber(fullOffer.Client_PDV_Number || '');
        } else {
            setClientOverride(false);
            setOverrideClientName('');
            setOverrideClientPhone('');
            setOverrideClientEmail('');
            setOverrideClientAddress('');
            setOverrideClientType(proj?.Client_Type || 'fizicko');
            setOverrideClientIdNumber('');
            setOverrideClientPdvNumber('');
        }

        setCurrentOffer(fullOffer);
    }

    // ============================================
    // PRINT OFFER
    // ============================================

    function handlePrintOffer(offer: Offer) {
        // Build a dimension lookup from project products
        const dimLookup: Record<string, { Width: number; Height: number; Depth: number }> = {};
        const project = projects.find(p => p.Project_ID === offer.Project_ID);
        if (project?.products) {
            for (const prod of project.products) {
                dimLookup[prod.Product_ID] = { Width: prod.Width, Height: prod.Height, Depth: prod.Depth };
            }
        }

        // Language & Currency from stored offer
        const lang = (offer as any).Language || 'bs';
        const curr = (offer as any).Currency || 'KM';
        const isEN = lang === 'en';
        const isEUR = curr === 'EUR';

        // Translation map
        const t = {
            offer: isEN ? 'Quotation' : 'Ponuda',
            client: isEN ? 'Client' : 'Kupac',
            products: isEN ? 'Products' : 'Proizvodi',
            name: isEN ? 'Description' : 'Naziv',
            dims: isEN ? '(HxWxD)' : '(VxŠxD)',
            qty: isEN ? 'Qty' : 'Količina',
            price: isEN ? 'Unit Price' : 'Cijena',
            total: isEN ? 'Total' : 'Ukupno',
            subtotal: isEN ? 'Subtotal' : 'Suma',
            transport: isEN ? 'Transport' : 'Transport',
            discount: isEN ? 'Discount' : 'Popust',
            grandTotal: isEN ? 'Total' : 'Ukupno',
            grandTotalVat: isEN ? 'Total (incl. VAT)' : 'Ukupno (sa PDV)',
            vat: isEN ? 'VAT' : 'PDV',
            notes: isEN ? 'Notes' : 'Napomena',
            validUntil: isEN ? 'Valid until' : 'Ponuda vrijedi do',
            supplier: isEN ? 'Supplier' : 'Ponuđač',
            buyer: isEN ? 'Client' : 'Naručilac',
            bankAccounts: isEN ? 'Bank accounts' : 'Bankovni računi',
        };

        // Currency formatter — values are always stored in KM, convert for display
        const fmtCurr = (val: number) => {
            if (isEUR) return toEUR(val).toFixed(2) + ' \u20ac';
            return val.toLocaleString('bs-BA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' KM';
        };

        // Use stored prices from the database — they already include labor, extras, etc.
        const products = sortProductsByName(
            (offer.products || []).filter(p => p.Included !== false).map(p => ({
                ...p,
                Selling_Price: p.Selling_Price || 0,
                Total_Price: p.Total_Price || 0
            })),
            p => p.Product_Name
        );

        // Use stored subtotal and total from the offer
        const subtotal = offer.Subtotal || products.reduce((sum, p) => sum + p.Total_Price, 0);
        const transport = offer.Transport_Cost || 0;
        const discount = offer.Onsite_Assembly ? (offer.Onsite_Discount || 0) : 0;
        const baseTotal = subtotal + transport - discount;
        const total = baseTotal;

        // Use stored PDV settings from the offer
        const offerIncludePDV = (offer as any).Include_PDV ?? false;
        const offerPdvRate = (offer as any).PDV_Rate ?? 17;

        // Reusable header HTML
        const headerHTML = `
            <div class="header">
                <div class="company-info">
                    ${companyInfo.logoBase64 ? `<img class="company-logo" src="${companyInfo.logoBase64}" alt="${companyInfo.name}" />` : ''}
                    ${(!companyInfo.logoBase64 || !companyInfo.hideNameWhenLogo) ? `<h1 class="company-name">${companyInfo.name}</h1>` : ''}
                    <div class="company-details">
                        <p>${companyInfo.address}</p>
                        <p>${[companyInfo.phone, companyInfo.email].filter(Boolean).join(' · ')}</p>
                        ${companyInfo.idNumber || companyInfo.pdvNumber ? `<p style="margin-top: 2px; font-size: 9px; color: #aaa;">${[companyInfo.idNumber ? 'ID: ' + companyInfo.idNumber : '', companyInfo.pdvNumber ? (isEN ? 'VAT: ' : 'PDV: ') + companyInfo.pdvNumber : ''].filter(Boolean).join(' | ')}</p>` : ''}
                    </div>
                </div>
                <div class="bank-accounts">
                    ${(companyInfo.bankAccounts || []).length > 0 ? `
                        <div class="bank-title">${t.bankAccounts}</div>
                        ${(companyInfo.bankAccounts || []).map(acc => `
                            <div class="bank-item"><strong>${acc.bankName}:</strong> ${acc.accountNumber}</div>
                        `).join('')}
                    ` : ''}
                </div>
            </div>
            <div class="client-section">
                <div class="client-details">
                    <div class="client-label">${t.client}</div>
                    <div class="client-name">${offer.Client_Name || '-'}</div>
                    ${(offer as any).Client_Address ? `<div class="client-contact">${(offer as any).Client_Address}</div>` : ''}
                    ${(offer as any).Client_Phone ? `<div class="client-contact">${isEN ? 'Phone' : 'Tel'}: ${(offer as any).Client_Phone}</div>` : ''}
                    ${(offer as any).Client_Email ? `<div class="client-contact">Email: ${(offer as any).Client_Email}</div>` : ''}
                    ${(offer as any).Client_ID_Number ? `<div class="client-contact" style="margin-top: 4px; font-size: 9px; color: #888;">ID: ${(offer as any).Client_ID_Number}</div>` : ''}
                    ${(offer as any).Client_PDV_Number ? `<div class="client-contact" style="font-size: 9px; color: #888;">${isEN ? 'VAT' : 'PDV'}: ${(offer as any).Client_PDV_Number}</div>` : ''}
                </div>
                <div class="doc-info">
                    <div class="doc-type">${t.offer}</div>
                    <div class="doc-number">${offer.Offer_Number}</div>
                    <div class="doc-date">${formatDate(offer.Created_Date)}</div>
                </div>
            </div>
        `;

        // Build product row HTML helper
        const productRowHTML = (p: typeof products[0], globalIndex: number) => `
            <tr>
                <td class="col-num">${globalIndex + 1}</td>
                <td>
                    <div class="product-name">${p.Product_Name}${(() => { const d = dimLookup[p.Product_ID]; return d && d.Width && d.Height && d.Depth ? `, <span class="product-dims">${d.Height} × ${d.Width} × ${d.Depth} mm</span>` : ''; })()}</div>
                </td>
                <td class="col-qty">${p.Quantity}</td>
                <td class="col-price">${fmtCurr(p.Selling_Price)}</td>
                <td class="col-total">${fmtCurr(p.Total_Price)}</td>
            </tr>
        `;

        // Bottom section (notes + totals + signatures) — placed after the table
        const bottomHTML = `
            <div class="bottom-section">
                <div class="notes-box">
                    <div class="notes-title">${t.notes}</div>
                    <p>${t.validUntil}: <strong>${formatDate(offer.Valid_Until)}</strong></p>
                    ${offer.Notes ? offer.Notes.split('\n').map((line: string) => `<p>${line}</p>`).join('') : ''}
                </div>
                <div class="totals-box">
                    <div class="totals-line">
                        <span class="t-label">${t.subtotal}</span>
                        <span class="t-value">${fmtCurr(subtotal)}</span>
                    </div>
                    ${transport > 0 ? `
                        <div class="totals-line">
                            <span class="t-label">${t.transport}</span>
                            <span class="t-value">${fmtCurr(transport)}</span>
                        </div>
                    ` : ''}
                    ${discount > 0 ? `
                        <div class="totals-line discount">
                            <span class="t-label">${t.discount}</span>
                            <span class="t-value">-${fmtCurr(discount)}</span>
                        </div>
                    ` : ''}
                    ${offerIncludePDV ? `
                        <div class="totals-line">
                            <span class="t-label">${t.vat} (${offerPdvRate}%)</span>
                            <span class="t-value">${fmtCurr(total * offerPdvRate / 100)}</span>
                        </div>
                    ` : ''}
                    <div class="totals-line grand-total">
                        <span class="t-label">${offerIncludePDV ? t.grandTotalVat : t.grandTotal}</span>
                        <span class="t-value">${fmtCurr(offerIncludePDV ? total * (1 + offerPdvRate / 100) : total)}</span>
                    </div>
                </div>
            </div>

            <div class="signatures">
                <div class="sig-block">
                    <div class="sig-line"></div>
                    <div class="sig-label">${t.supplier}</div>
                </div>
                <div class="sig-block">
                    <div class="sig-line"></div>
                    <div class="sig-label">${t.buyer}</div>
                </div>
            </div>
        `;

        const colheadHTML = `
            <tr>
                <th class="col-num">#</th>
                <th class="col-name">${t.name} <span style="font-weight:400;color:#bbb;font-size:9px;">${t.dims}</span></th>
                <th class="col-qty">${t.qty}</th>
                <th class="col-price">${t.price}</th>
                <th class="col-total">${t.total}</th>
            </tr>
        `;

        // Shared print CSS — used both for the hidden measurement pass below
        // and the final print document, so the two can never drift apart.
        const styleCSS = `
                    * { margin: 0; padding: 0; box-sizing: border-box; }

                    body {
                        font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif;
                        font-size: 12px;
                        line-height: 1.5;
                        color: #1a1a1a;
                        background: #f8f8f8;
                        -webkit-print-color-adjust: exact;
                        print-color-adjust: exact;
                        zoom: 1;
                        -webkit-text-size-adjust: 100%;
                        text-rendering: optimizeLegibility;
                    }

                    .page {
                        max-width: 780px;
                        margin: 20px auto;
                        background: white;
                        padding: 48px 44px;
                        box-shadow: 0 1px 8px rgba(0,0,0,0.08);
                    }

                    .page-break {
                        page-break-after: always;
                    }

                    /* Header */
                    .header {
                        display: flex;
                        justify-content: space-between;
                        align-items: flex-start;
                        padding-bottom: 24px;
                        border-bottom: 2px solid #e8e8e8;
                        margin-bottom: 28px;
                    }

                    .company-info {
                        display: flex;
                        flex-direction: column;
                        gap: 6px;
                    }

                    .company-logo {
                        max-width: 160px;
                        max-height: 50px;
                        width: auto;
                        height: auto;
                        object-fit: contain;
                    }

                    .company-name {
                        font-size: 20px;
                        font-weight: 700;
                        color: #111;
                        margin: 0;
                    }

                    .company-details p {
                        font-size: 10px;
                        color: #777;
                        margin: 1px 0;
                    }

                    .doc-info {
                        text-align: right;
                    }

                    .doc-type {
                        display: inline-block;
                        background: #0066cc;
                        color: white;
                        font-size: 9px;
                        font-weight: 600;
                        letter-spacing: 1px;
                        text-transform: uppercase;
                        padding: 4px 12px;
                        border-radius: 3px;
                        margin-bottom: 8px;
                    }

                    .doc-number {
                        font-size: 22px;
                        font-weight: 700;
                        color: #111;
                        letter-spacing: -0.5px;
                        margin-bottom: 4px;
                    }

                    .doc-date {
                        font-size: 12px;
                        color: #888;
                    }

                    /* Client Section */
                    .client-section {
                        display: flex;
                        justify-content: space-between;
                        align-items: flex-start;
                        margin-bottom: 28px;
                        padding: 20px;
                        background: #fafafa;
                        border-radius: 6px;
                        border: 1px solid #eee;
                    }

                    .client-details { flex: 1; }

                    .client-label {
                        font-size: 9px;
                        font-weight: 600;
                        color: #aaa;
                        text-transform: uppercase;
                        letter-spacing: 0.8px;
                        margin-bottom: 6px;
                    }

                    .client-name {
                        font-size: 16px;
                        font-weight: 600;
                        color: #111;
                        margin-bottom: 4px;
                    }

                    .client-contact {
                        font-size: 11px;
                        color: #666;
                        margin-bottom: 2px;
                    }

                    /* Products Table */
                    .products-title {
                        font-size: 11px;
                        font-weight: 600;
                        color: #999;
                        text-transform: uppercase;
                        letter-spacing: 0.5px;
                        margin-bottom: 10px;
                    }

                    .products-table {
                        width: 100%;
                        border-collapse: collapse;
                        margin-bottom: 24px;
                    }

                    .products-table thead th {
                        background: #f5f6f7;
                        padding: 8px 12px;
                        font-size: 10px;
                        font-weight: 600;
                        color: #888;
                        text-transform: uppercase;
                        letter-spacing: 0.5px;
                        border-bottom: 2px solid #e8e8e8;
                        text-align: left;
                    }

                    .products-table tbody td {
                        padding: 10px 12px;
                        font-size: 12px;
                        border-bottom: 1px solid #f0f0f0;
                        vertical-align: middle;
                        min-height: 56px;
                        height: 56px;
                    }

                    .products-table tbody tr:last-child td {
                        border-bottom: 2px solid #e8e8e8;
                    }

                    .col-num { width: 40px; text-align: center; color: #aaa; }
                    .col-name { }
                    .col-qty { width: 70px; text-align: center; }
                    .col-price { width: 110px; text-align: right; }
                    .col-total { width: 120px; text-align: right; font-weight: 500; }

                    thead th.col-price,
                    thead th.col-total { text-align: right; }
                    thead th.col-qty { text-align: center; }

                    .product-name { font-weight: 500; color: #333; }
                    .product-dims { color: #999; font-size: 11px; }

                    /* Bottom Section */
                    .bottom-section {
                        display: flex;
                        gap: 32px;
                        margin-bottom: 40px;
                    }

                    .notes-box {
                        flex: 1;
                        padding: 16px 18px;
                        background: #f8f9fa;
                        border-radius: 6px;
                        border-left: 3px solid #0066cc;
                    }

                    .notes-title {
                        font-size: 10px;
                        font-weight: 600;
                        color: #999;
                        text-transform: uppercase;
                        letter-spacing: 0.5px;
                        margin-bottom: 8px;
                    }

                    .notes-box p {
                        font-size: 11px;
                        color: #555;
                        margin-bottom: 3px;
                        line-height: 1.5;
                    }

                    .totals-box {
                        width: 280px;
                        flex-shrink: 0;
                    }

                    .totals-line {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        padding: 6px 0;
                        border-bottom: 1px solid #f0f0f0;
                    }

                    .totals-line:last-child { border-bottom: none; }

                    .t-label {
                        font-size: 12px;
                        color: #666;
                    }

                    .t-value {
                        font-size: 12px;
                        font-weight: 500;
                        color: #333;
                    }

                    .totals-line.discount .t-value { color: #34c759; }

                    .totals-line.grand-total {
                        padding-top: 12px;
                        margin-top: 4px;
                        border-top: 2px solid #111;
                        border-bottom: none;
                    }

                    .totals-line.grand-total .t-label {
                        font-size: 14px;
                        font-weight: 600;
                        color: #111;
                    }

                    .totals-line.grand-total .t-value {
                        font-size: 18px;
                        font-weight: 700;
                        color: #0066cc;
                    }

                    /* Signatures */
                    .signatures {
                        display: flex;
                        justify-content: space-between;
                        gap: 60px;
                        margin-top: 48px;
                    }

                    .sig-block {
                        flex: 1;
                        text-align: center;
                    }

                    .sig-line {
                        border-top: 1px solid #ccc;
                        margin-bottom: 6px;
                    }

                    .sig-label {
                        font-size: 9px;
                        color: #aaa;
                        text-transform: uppercase;
                        letter-spacing: 0.8px;
                    }

                    .bank-accounts {
                        text-align: right;
                    }

                    .bank-accounts .bank-title {
                        font-size: 9px;
                        font-weight: 600;
                        color: #999;
                        text-transform: uppercase;
                        letter-spacing: 0.5px;
                        margin-bottom: 6px;
                    }

                    .bank-accounts .bank-item {
                        font-size: 10px;
                        color: #555;
                        margin-bottom: 3px;
                    }

                    /* ===== PRINT ===== */
                    @media print {
                        body {
                            background: white !important;
                            -webkit-print-color-adjust: exact !important;
                            print-color-adjust: exact !important;
                        }

                        .page {
                            box-shadow: none;
                            padding: 0;
                            margin: 0;
                            max-width: none;
                        }

                        .page-break {
                            page-break-after: always !important;
                        }

                        @page {
                            margin: 10mm 12mm 14mm 12mm;
                            size: A4;
                        }

                        .products-table tr {
                            page-break-inside: avoid;
                        }

                        .bottom-section {
                            page-break-inside: avoid;
                        }

                        .signatures {
                            page-break-inside: avoid;
                        }

                        /* Fix PDF resolution */
                        * {
                            -webkit-font-smoothing: antialiased;
                            -moz-osx-font-smoothing: grayscale;
                        }

                        img {
                            image-rendering: -webkit-optimize-contrast;
                            image-rendering: crisp-edges;
                        }
                    }
        `;

        // ============================================
        // PAGINATION — measure this offer's actual rendered header/client/
        // notes heights (they vary with logo, bank account count, address
        // length, notes length…) instead of guessing a fixed row count per
        // page. A fixed guess is what caused headerless/near-empty pages:
        // once every row is spaced out to the fixed 56px in the fix above,
        // a "full" page's real height no longer matched the old guess.
        // ============================================
        const MM_TO_PX = 96 / 25.4;
        const CONTENT_WIDTH_PX = (210 - 12 - 12) * MM_TO_PX;   // A4 width minus left/right @page margins
        const PAGE_BUDGET_PX = (297 - 10 - 14) * MM_TO_PX;      // A4 height minus top/bottom @page margins
        const SAFETY_MARGIN_PX = 24;                             // guards against measurement/print rounding drift
        const EFFECTIVE_BUDGET_PX = PAGE_BUDGET_PX - SAFETY_MARGIN_PX;
        const ROW_HEIGHT_PX = 56;                                // matches the fixed .products-table tbody td height
        const TABLE_MARGIN_PX = 24;                              // matches .products-table { margin-bottom: 24px }
        const MIN_LAST_PAGE_ROWS = 4;                            // avoid a near-empty trailing page

        async function measureBlockHeights(): Promise<{ header: number; title: number; colhead: number; bottom: number }> {
            const fallback = { header: 360, title: 26, colhead: 34, bottom: 300 };
            const iframe = document.createElement('iframe');
            iframe.style.cssText = `position:absolute;left:-9999px;top:0;width:${CONTENT_WIDTH_PX}px;height:1600px;border:0;visibility:hidden;`;
            try {
                document.body.appendChild(iframe);
                const idoc = iframe.contentDocument;
                if (!idoc) return fallback;
                idoc.open();
                idoc.write(`
                    <!DOCTYPE html>
                    <html>
                    <head><style>${styleCSS}</style></head>
                    <body>
                        <div id="m-header" style="overflow:hidden;">${headerHTML}</div>
                        <div id="m-title" style="overflow:hidden;"><div class="products-title">${t.products}</div></div>
                        <table class="products-table"><thead>${colheadHTML.replace('<tr>', '<tr id="m-colhead">')}</thead></table>
                        <div id="m-bottom" style="overflow:hidden;">${bottomHTML}</div>
                    </body>
                    </html>
                `);
                idoc.close();

                // Wait for the logo (if any) to decode so its box height isn't measured as 0
                const images = Array.from(idoc.images);
                if (images.length > 0) {
                    await Promise.race([
                        Promise.all(images.map(img => img.decode ? img.decode().catch(() => undefined) : Promise.resolve())),
                        new Promise(resolve => setTimeout(resolve, 500)),
                    ]);
                }

                return {
                    header: idoc.getElementById('m-header')?.offsetHeight || fallback.header,
                    title: idoc.getElementById('m-title')?.offsetHeight || fallback.title,
                    colhead: idoc.getElementById('m-colhead')?.offsetHeight || fallback.colhead,
                    bottom: idoc.getElementById('m-bottom')?.offsetHeight || fallback.bottom,
                };
            } catch {
                return fallback;
            } finally {
                iframe.remove();
            }
        }

        // Open the tab synchronously inside the click handler so popup blockers
        // don't treat the later async write (after measurement) as an untrusted
        // popup — only opening the window needs the user-gesture association.
        const printWindow = window.open('', '_blank');
        if (!printWindow) return;

        measureBlockHeights().then(({ header: HEADER_H, title: TITLE_H, colhead: COLHEAD_H, bottom: BOTTOM_H }) => {
            const capFirstOnly = Math.max(1, Math.floor((EFFECTIVE_BUDGET_PX - (HEADER_H + TITLE_H + COLHEAD_H)) / ROW_HEIGHT_PX));
            const capFirstAndLast = Math.max(1, Math.floor((EFFECTIVE_BUDGET_PX - (HEADER_H + TITLE_H + COLHEAD_H + TABLE_MARGIN_PX + BOTTOM_H)) / ROW_HEIGHT_PX));
            const capContOnly = Math.max(1, Math.floor((EFFECTIVE_BUDGET_PX - (HEADER_H + COLHEAD_H)) / ROW_HEIGHT_PX));
            const capContAndLast = Math.max(1, Math.floor((EFFECTIVE_BUDGET_PX - (HEADER_H + COLHEAD_H + TABLE_MARGIN_PX + BOTTOM_H)) / ROW_HEIGHT_PX));

            // Decide how many products go on each page. Page 1 is capped at
            // capFirstOnly; the rest ("tail") is filled BACKWARD starting from
            // the last page (whose cap is the smallest, since it must also fit
            // the notes/totals/signatures block). Filling backward guarantees
            // the last page gets a fair, capped share instead of whatever thin
            // remainder is left over after earlier pages greedily max out.
            const pageCounts: number[] = [];
            if (products.length === 0) {
                pageCounts.push(0);
            } else if (products.length <= capFirstAndLast) {
                pageCounts.push(products.length);
            } else {
                const firstPageRows = Math.min(capFirstOnly, products.length);
                const tailRows = products.length - firstPageRows;

                // Minimum number of tail pages k such that (k-1)*capContOnly + capContAndLast >= tailRows
                let k = 1;
                while ((k - 1) * capContOnly + capContAndLast < tailRows) k++;

                const tailCounts = new Array(k).fill(0);
                let remaining = tailRows;
                for (let i = k - 1; i >= 0; i--) {
                    const pagesLeftIncludingThis = i + 1;
                    const cap = i === k - 1 ? capContAndLast : capContOnly;
                    const take = Math.min(Math.ceil(remaining / pagesLeftIncludingThis), cap, remaining);
                    tailCounts[i] = take;
                    remaining -= take;
                }

                pageCounts.push(firstPageRows, ...tailCounts);

                // Safety net: if the last page is still short (e.g. tailRows was 0),
                // borrow from the page before it without fully draining the donor.
                const target = Math.min(MIN_LAST_PAGE_ROWS, capContAndLast);
                for (let i = pageCounts.length - 1; i >= 1 && pageCounts[i] < target; i--) {
                    const need = target - pageCounts[i];
                    const move = Math.min(need, Math.max(0, pageCounts[i - 1] - 1));
                    pageCounts[i] += move;
                    pageCounts[i - 1] -= move;
                }
            }

            const pages: (typeof products[number])[][] = [];
            const remainingProducts = [...products];
            for (const count of pageCounts) {
                pages.push(remainingProducts.splice(0, count));
            }

            let globalIdx = 0;
            const pagesHTML = pages.map((pageProducts, pageIndex) => {
                const isFirstPage = pageIndex === 0;
                const isLastPage = pageIndex === pages.length - 1;
                const rowsHTML = pageProducts.map(p => {
                    const html = productRowHTML(p, globalIdx);
                    globalIdx++;
                    return html;
                }).join('');

                return `
                    <div class="page${!isLastPage ? ' page-break' : ''}">
                        ${headerHTML}
                        ${isFirstPage ? `<div class="products-title">${t.products}</div>` : ''}
                        <table class="products-table">
                            <thead>${colheadHTML}</thead>
                            <tbody>
                                ${rowsHTML}
                            </tbody>
                        </table>
                        ${isLastPage ? bottomHTML : ''}
                    </div>
                `;
            }).join('');

            const printContent = `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <title>${t.offer} ${offer.Offer_Number}</title>
                    <style>${styleCSS}</style>
                </head>
                <body>
                    ${pagesHTML}
                </body>
                </html>
            `;

            printWindow.document.open();
            printWindow.document.write(printContent);
            printWindow.document.close();
            // onload doesn't fire reliably after document.write() — the document
            // is already "loaded" by the time the handler is attached.
            // Instead, wait for fonts to load then print.
            const triggerPrint = () => {
                if (printWindow.document.fonts && printWindow.document.fonts.ready) {
                    printWindow.document.fonts.ready.then(() => {
                        setTimeout(() => printWindow.print(), 100);
                    });
                } else {
                    // Fallback for browsers without document.fonts
                    setTimeout(() => printWindow.print(), 500);
                }
            };
            // Small delay to let the document render
            setTimeout(triggerPrint, 200);
        });
    }

    // ============================================
    // DOWNLOAD PDF
    // ============================================

    // Sastavi podatke za PDF ponude (dijeli download i „spremi na Drive").
    function buildOfferPdfData(offer: Offer): OfferPDFData {
        // Find the project for dimension lookup
        const pdfProject = projects.find(p => p.Project_ID === offer.Project_ID);

        // Use stored prices from database
        const productsWithPrices = sortProductsByName(
            (offer.products || []).filter(p => p.Included !== false).map(p => {
                const laborWorkers = (p as any).Labor_Workers || 0;
                const laborDays = (p as any).Labor_Days || 0;
                const laborRate = (p as any).Labor_Daily_Rate || 0;
                const laborTotal = laborWorkers * laborDays * laborRate;

                // Get dimensions from project product
                const projProduct = pdfProject?.products?.find((pp: any) => pp.Product_ID === p.Product_ID);
                const dimensions = projProduct && projProduct.Width && projProduct.Height && projProduct.Depth
                    ? `${projProduct.Width} × ${projProduct.Height} × ${projProduct.Depth} mm`
                    : undefined;

                return {
                    name: p.Product_Name,
                    quantity: p.Quantity || 1,
                    dimensions: dimensions,
                    materialCost: p.Material_Cost || 0,
                    laborCost: laborTotal,
                    extras: (p.extras || []).map((e: any) => ({
                        name: e.name || e.Name,
                        total: e.total || e.Total || 0
                    })),
                    sellingPrice: p.Selling_Price || 0,
                    totalPrice: p.Total_Price || 0
                };
            }),
            p => p.name
        );

        const subtotal = offer.Subtotal || productsWithPrices.reduce((sum, p) => sum + p.totalPrice, 0);
        const transport = offer.Transport_Cost || 0;
        const discount = offer.Onsite_Assembly ? (offer.Onsite_Discount || 0) : 0;
        const total = subtotal + transport - discount;

        return {
            offerNumber: offer.Offer_Number,
            clientName: offer.Client_Name || 'Nepoznat klijent',
            clientAddress: (offer as any).Client_Address,
            clientPhone: offer.Client_Phone,
            clientEmail: offer.Client_Email,
            createdDate: offer.Created_Date,
            validUntil: offer.Valid_Until,
            products: productsWithPrices,
            subtotal: subtotal,
            transportCost: transport,
            discount: discount,
            total: total,
            notes: offer.Notes,
            companyName: companyInfo.name,
            companyAddress: companyInfo.address,
            companyPhone: companyInfo.phone,
            companyEmail: companyInfo.email,
            bankAccounts: companyInfo.bankAccounts || []
        };
    }

    async function handleDownloadPDF(offer: Offer) {
        try {
            const pdfData = buildOfferPdfData(offer);
            await generateOfferPDF(pdfData);
            showToast('PDF ponude preuzet', 'success');
        } catch (error) {
            console.error('Error generating PDF:', error);
            showToast('Greška pri generiranju PDF-a', 'error');
        }
    }

    // GOOGLE DRIVE — spremi PDF ponude u podfolder „Ponude" projekta.
    async function handleFileOfferToDrive(offer: Offer) {
        if (!organizationId) return;
        const project = projects.find(p => p.Project_ID === offer.Project_ID);
        const subId = project?.Drive_Subfolders?.['Ponude'];
        if (!subId) {
            showToast('Projekat nema Drive folder. Kreiraj folder projekta prvo (kartica projekta → Drive).', 'error');
            return;
        }
        try {
            showToast('Šaljem ponudu na Drive...', 'info');
            const pdfData = buildOfferPdfData(offer);
            const blob = await generateOfferPDFBlob(pdfData);
            const filed = await fileToSubfolder(subId, blob, `Ponuda_${offer.Offer_Number}.pdf`);
            await saveOffer({ Offer_ID: offer.Offer_ID, Drive_File_ID: filed.id, Drive_File_URL: filed.webViewLink }, organizationId);
            showToast('Ponuda spremljena na Drive', 'success');
            onRefresh('offers');
        } catch (e: any) {
            showToast('Greška pri slanju na Drive: ' + (e?.message || ''), 'error');
        }
    }

    const totals = calculateOfferTotals();

    const EXTRA_OPTIONS = [
        'LED instalacija',
        'Ugradnja česme',
        'Fugiranje',
        'Montaža lajsni',
        'Ugradnja spotova',
        'Silikoniranje',
        'custom'
    ];

    return (
        <>
            {isMobile ? (
                <MobileOffersView
                    offers={offers}
                    projects={projects}
                    onRefresh={onRefresh}
                    showToast={showToast}
                    onOpenCreate={openCreateModal}
                    onViewOffer={openViewModal}
                    onEditOffer={openEditModal}
                    onDeleteOffer={handleDeleteOffer}
                    onUpdateStatus={handleUpdateStatus}
                    onDownloadPDF={handleDownloadPDF}
                    onPrintOffer={handlePrintOffer}
                />
            ) : (
                <div className="tab-content active" id="offers-content">
                    <div className="content-header" style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', padding: '16px 24px' }}>
                <div className="glass-search">
                    <span className="material-icons-round">search</span>
                    <input
                        type="text"
                        placeholder="Pretraži ponude..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                <select
                    className="glass-select-standalone"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                >
                    <option value="">Svi statusi</option>
                    {OFFER_STATUSES.map(status => (
                        <option key={status} value={status}>{status}</option>
                    ))}
                </select>
                <select
                    className="glass-select-standalone"
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as any)}
                    title="Sortiranje"
                >
                    <option value="date-desc">Najnovije prvo</option>
                    <option value="date-asc">Najstarije prvo</option>
                    <option value="amount-desc">Najveći iznos</option>
                    <option value="amount-asc">Najmanji iznos</option>
                    <option value="client-asc">Klijent A-Ž</option>
                    <option value="client-desc">Klijent Ž-A</option>
                </select>
                <select
                    className="glass-select-standalone"
                    value={groupBy}
                    onChange={(e) => setGroupBy(e.target.value as any)}
                    title="Grupisanje"
                >
                    <option value="none">Bez grupisanja</option>
                    <option value="status">Po statusu</option>
                    <option value="project">Po klijentu/projektu</option>
                </select>
                <div style={{ marginLeft: 'auto' }}>
                    <button className="glass-btn glass-btn-primary" onClick={openCreateModal}>
                        <span className="material-icons-round">add</span>
                        Nova Ponuda
                    </button>
                </div>
            </div>

            <div className="offers-list">
                {sortedOffers.length === 0 ? (
                    <div className="empty-state">
                        <span className="material-icons-round">request_quote</span>
                        <h3>Nema ponuda</h3>
                        <p>Kreirajte prvu ponudu klikom na "Nova Ponuda"</p>
                    </div>
                ) : (
                    groupedOffers.map(group => (
                        <div key={group.label || '__all__'}>
                            {group.label && (
                                <div style={{
                                    padding: '12px 16px',
                                    fontWeight: 600,
                                    fontSize: '13px',
                                    color: 'var(--text-secondary)',
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.05em',
                                    borderBottom: '1px solid var(--border-color)',
                                    background: 'var(--bg-secondary)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                }}>
                                    <span className="material-icons-round" style={{ fontSize: '16px' }}>
                                        {groupBy === 'status' ? 'label' : 'person'}
                                    </span>
                                    {group.label}
                                    <span style={{
                                        background: 'var(--accent)',
                                        color: '#fff',
                                        borderRadius: '10px',
                                        padding: '1px 8px',
                                        fontSize: '11px',
                                        fontWeight: 700,
                                        marginLeft: '4px'
                                    }}>{group.offers.length}</span>
                                </div>
                            )}
                            {group.offers.map(offer => (
                                <div key={offer.Offer_ID} className="offer-row" onClick={() => openViewModal(offer.Offer_ID)} style={{ cursor: 'pointer' }}>
                                    {/* Left: main info */}
                                    <div className="offer-row-info">
                                        <div className="offer-row-title">{offer.Name || offer.Offer_Number}</div>
                                        <div className="offer-row-meta">
                                            <span>{offer.Client_Name || 'Nepoznat klijent'}</span>
                                            <span className="offer-row-dot">·</span>
                                            <span>{formatDate(offer.Created_Date)}</span>
                                            {offer.Name && (
                                                <>
                                                    <span className="offer-row-dot">·</span>
                                                    <span className="offer-row-num">#{offer.Offer_Number}</span>
                                                </>
                                            )}
                                        </div>
                                    </div>

                                    {/* Right: amount + status pill + actions */}
                                    <div className="offer-row-right">
                                        <span className="offer-row-amount">{formatPrice(offer.Total || 0, ((offer as any).Currency || 'KM') as 'KM' | 'EUR')}</span>

                                        {/* Oznaka zastarjelih cijena: samo za poslane/prihvaćene ponude čiji se
                                            snapshot materijala razlikuje od trenutne cijene proizvoda. */}
                                        {(offer.Status === 'Poslano' || offer.Status === 'Prihvaćeno') && isOfferStale(offer, allProducts) && (
                                            <span
                                                className="offer-stale-badge"
                                                title="Cijene materijala su se promijenile od kad je ponuda napravljena. Otvori ponudu za pregled/ažuriranje."
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                <span className="material-icons-round" style={{ fontSize: 13 }}>price_change</span>
                                                Cijene zastarjele
                                            </span>
                                        )}

                                        {/* Custom status badge with dropdown */}
                                        <div className="offer-status-wrapper" ref={activeStatusDropdown === offer.Offer_ID ? statusDropdownRef : undefined}>
                                            <button
                                                className={`offer-status-badge ${getStatusClass(offer.Status)}`}
                                                onClick={(e) => { e.stopPropagation(); setActiveStatusDropdown(activeStatusDropdown === offer.Offer_ID ? null : offer.Offer_ID); setActiveDropdown(null); }}
                                            >
                                                <span className="status-dot" />
                                                {offer.Status || 'Nacrt'}
                                            </button>
                                            {activeStatusDropdown === offer.Offer_ID && (
                                                <div className="status-dropdown-menu">
                                                    {OFFER_STATUSES.map(status => (
                                                        <button
                                                            key={status}
                                                            className={`status-option ${status === (offer.Status || 'Nacrt') ? 'active' : ''} ${getStatusClass(status)}`}
                                                            onClick={(e) => { e.stopPropagation(); setActiveStatusDropdown(null); handleUpdateStatus(offer.Offer_ID, status); }}
                                                        >
                                                            <span className={`status-dot ${getStatusClass(status)}`} />
                                                            {status}
                                                            {status === (offer.Status || 'Nacrt') && <span className="material-icons-round" style={{ fontSize: 14, marginLeft: 'auto' }}>check</span>}
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                        <div className="offer-actions-inline" style={{ display: 'flex', gap: '8px', marginLeft: '12px' }}>
                                            <button
                                                className="action-icon-btn"
                                                onClick={(e) => { e.stopPropagation(); openEditModal(offer); }}
                                                title="Uredi"
                                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px', transition: 'all 0.2s' }}
                                            >
                                                <span className="material-icons-round" style={{ fontSize: '20px' }}>edit</span>
                                            </button>
                                            {(offer.Status === 'Poslano' || offer.Status === 'Prihvaćeno') && (
                                                <button
                                                    className="action-icon-btn"
                                                    onClick={(e) => { e.stopPropagation(); handleReviseOffer(offer); }}
                                                    title="Revidiraj (nova verzija, original ostaje)"
                                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px', transition: 'all 0.2s' }}
                                                >
                                                    <span className="material-icons-round" style={{ fontSize: '20px' }}>difference</span>
                                                </button>
                                            )}
                                            {offer.Status === 'Prihvaćeno' && (
                                                <button
                                                    className="action-icon-btn"
                                                    onClick={(e) => { e.stopPropagation(); setInvoiceModalOffer(offer); }}
                                                    title="Završni račun"
                                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px', transition: 'all 0.2s' }}
                                                >
                                                    <span className="material-icons-round" style={{ fontSize: '20px' }}>receipt_long</span>
                                                </button>
                                            )}
                                            <button
                                                className="action-icon-btn"
                                                onClick={(e) => { e.stopPropagation(); handlePrintOffer(offer); }}
                                                title="Printaj"
                                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px', transition: 'all 0.2s' }}
                                            >
                                                <span className="material-icons-round" style={{ fontSize: '20px' }}>print</span>
                                            </button>
                                            {gi.moduleActive && (
                                                <button
                                                    className="action-icon-btn"
                                                    onClick={(e) => { e.stopPropagation(); handleFileOfferToDrive(offer); }}
                                                    title={offer.Drive_File_ID ? 'Ponovo spremi ponudu na Drive' : 'Spremi ponudu na Drive'}
                                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: offer.Drive_File_ID ? '#1a7f37' : 'var(--text-secondary)', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px', transition: 'all 0.2s' }}
                                                >
                                                    <span className="material-icons-round" style={{ fontSize: '20px' }}>{offer.Drive_File_ID ? 'cloud_done' : 'cloud_upload'}</span>
                                                </button>
                                            )}
                                            <button
                                                className="action-icon-btn danger"
                                                onClick={(e) => { e.stopPropagation(); handleDeleteOffer(offer.Offer_ID); }}
                                                title="Obriši"
                                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px', transition: 'all 0.2s' }}
                                            >
                                                <span className="material-icons-round" style={{ fontSize: '20px' }}>delete</span>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ))
                )}
            </div>
                </div>
            )}

            {/* Upit "Kreiraj radni nalog?" nakon prihvatanja ponude */}
            {createWOPrompt && (
                <Modal
                    isOpen={!!createWOPrompt}
                    onClose={() => setCreateWOPrompt(null)}
                    title={`Ponuda prihvaćena: ${createWOPrompt.Name || createWOPrompt.Offer_Number}`}
                    footer={
                        <>
                            <button className="btn btn-secondary" onClick={() => setCreateWOPrompt(null)}>Ne sada</button>
                            <button
                                className="btn btn-primary"
                                onClick={() => {
                                    const included = (createWOPrompt.products || []).filter(p => p.Included !== false);
                                    const project = projects.find(pr => pr.Project_ID === createWOPrompt.Project_ID);
                                    onCreateWorkOrder?.(
                                        createWOPrompt.Project_ID,
                                        project?.Client_Name || createWOPrompt.Client_Name || '',
                                        included.map(p => ({ productId: p.Product_ID, productName: p.Product_Name, quantity: p.Quantity || 1 }))
                                    );
                                    setCreateWOPrompt(null);
                                }}
                            >
                                Kreiraj radni nalog
                            </button>
                        </>
                    }
                >
                    <p style={{ margin: '0 0 12px 0', color: 'var(--text-secondary)', fontSize: 14 }}>
                        Da li želiš odmah kreirati radni nalog za prihvaćene proizvode? Otvoriće se čarobnjak u Proizvodnji s predodabranim proizvodima.
                    </p>
                    <ul style={{ margin: 0, paddingLeft: 20, color: 'var(--text-primary)', fontSize: 14, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {(createWOPrompt.products || []).filter(p => p.Included !== false).map(p => (
                            <li key={p.ID}>{p.Product_Name} × {p.Quantity || 1}</li>
                        ))}
                    </ul>
                </Modal>
            )}

            {/* Završni račun */}
            {invoiceModalOffer && organizationId && (() => {
                const project = projects.find(pr => pr.Project_ID === invoiceModalOffer.Project_ID);
                if (!project) return null;
                return (
                    <InvoiceModal
                        project={project}
                        offer={invoiceModalOffer}
                        organizationId={organizationId}
                        onClose={() => setInvoiceModalOffer(null)}
                        showToast={showToast}
                        onRefresh={onRefresh}
                    />
                );
            })()}

            {/* Create/Edit Offer Modal */}
            <Modal
                isOpen={createModal}
                onClose={handleCloseOfferModal}
                title={isEditMode ? (
                    <span style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                        <span>Uredi Ponudu: {currentOffer?.Offer_Number || ''}</span>
                        {offerProducts.length > 0 && (() => {
                            const totals = calculateOfferTotals();
                            const inc = offerProducts.filter(p => p.included);
                            const profit = inc.reduce((sum, p) => sum + (p.margin || 0) * (p.Quantity || 1), 0);
                            // Planirani TROŠKOVI iz ponude (svaki × količina) + broj radnih dana.
                            const materialTotal = inc.reduce((s, p) => s + (p.Material_Cost || 0) * (p.Quantity || 1), 0);
                            const uslugeTotal = inc.reduce((s, p) => s + (p.extras || []).reduce((a, e) => a + (e.total || 0), 0) * (p.Quantity || 1), 0);
                            // Trošak rada = radnici × dani × dnevnica (× količina); broj radnih dana = Σ dana.
                            const plannedLabor = inc.reduce((s, p) => s + (p.laborWorkers || 0) * (p.laborDays || 0) * (p.laborDailyRate || 0) * (p.Quantity || 1), 0);
                            const workDays = inc.reduce((s, p) => s + (p.laborDays || 0), 0);
                            const km = (n: number) => n.toLocaleString('bs-BA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                            const costChip: import('react').CSSProperties = {
                                display: 'inline-flex', alignItems: 'center', gap: '4px',
                                background: 'var(--bg-secondary, #f0f4f8)', borderRadius: '8px',
                                padding: '4px 10px', fontSize: '13px', fontWeight: 500, color: 'var(--text-secondary, #555)',
                            };
                            return (
                                <>
                                    <span style={costChip} title="Prodajna vrijednost (subtotal)">
                                        <span className="material-icons-round" style={{ fontSize: '16px', color: 'var(--accent, #0066cc)' }}>receipt_long</span>
                                        {km(totals.subtotal)} KM
                                    </span>
                                    <span style={costChip} title="Planirani trošak materijala">
                                        <span className="material-icons-round" style={{ fontSize: '16px', color: '#64748b' }}>inventory_2</span>
                                        Materijal {km(materialTotal)} KM
                                    </span>
                                    <span style={costChip} title="Planirani trošak usluga (kolona Usluge iz ponude)">
                                        <span className="material-icons-round" style={{ fontSize: '16px', color: '#0891b2' }}>build</span>
                                        Usluge {km(uslugeTotal)} KM
                                    </span>
                                    <span style={costChip} title="Planirani trošak rada = radnici × dani × dnevnica; broj radnih dana = Σ dana">
                                        <span className="material-icons-round" style={{ fontSize: '16px', color: '#d97706' }}>engineering</span>
                                        Rad {km(plannedLabor)} KM · {workDays} {workDays === 1 ? 'dan' : 'dana'}
                                    </span>
                                    <span style={{
                                        display: 'inline-flex', alignItems: 'center', gap: '4px',
                                        background: profit >= 0 ? 'rgba(52,199,89,0.1)' : 'rgba(255,59,48,0.1)',
                                        borderRadius: '8px', padding: '4px 10px', fontSize: '13px', fontWeight: 500,
                                        color: profit >= 0 ? '#34c759' : '#ff3b30'
                                    }} title="Marža (profit) = prodajna − materijal − usluge − rad">
                                        <span className="material-icons-round" style={{ fontSize: '16px' }}>trending_up</span>
                                        {km(profit)} KM
                                    </span>
                                </>
                            );
                        })()}
                    </span>
                ) : 'Nova Ponuda'}
                size="xl"
                footer={
                    <>
                        <button className="btn btn-secondary" onClick={handleCloseOfferModal}>Otkaži</button>
                        <button
                            className="glass-btn glass-btn-primary"
                            onClick={handleSaveOffer}
                            disabled={isSaving || !selectedProjectId || offerProducts.filter(p => p.included).length === 0 || invoiceIssuedLock}
                            title={invoiceIssuedLock ? 'Izdat je završni račun — izmjena samo kroz storniranje ili Revidiraj' : undefined}
                        >
                            {isSaving ? 'Spremanje...' : invoiceIssuedLock ? '🔒 Fakturisano' : (isEditMode ? (offerProducts.some(p => p.locked) ? 'Sačuvaj (otključane stavke)' : 'Ažuriraj Ponudu') : 'Sačuvaj Ponudu')}
                        </button>
                    </>
                }
            >
                {modalLoading && isEditMode ? (
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '60px' }}>
                        <div style={{ textAlign: 'center' }}>
                            <span className="material-icons-round" style={{ fontSize: '48px', color: 'var(--accent)', animation: 'spin 1s linear infinite' }}>sync</span>
                            <p style={{ marginTop: '16px', color: 'var(--text-secondary)' }}>Učitavanje ponude...</p>
                        </div>
                    </div>
                ) : (
                    <div className="offer-form">
                        {/* Zaključana ponuda (poslana/prihvaćena): informativni baner o zaključanim
                            redovima (zaštita cijene ka klijentu). Zaključavanje je PO REDU — prazni
                            (nedefinisani) redovi se i dalje mogu dopuniti i sačuvati bez otključavanja. */}
                        {editLocked && currentOffer && offerProducts.some(p => p.locked) && (() => {
                            const changes = offerPriceChanges(currentOffer, allProducts);
                            const isAccepted = currentOffer.Status === 'Prihvaćeno';
                            const lockedCount = offerProducts.filter(p => p.locked).length;
                            const unlockedCount = offerProducts.length - lockedCount;
                            return (
                                <div className="offer-lock-banner">
                                    <div className="offer-lock-banner-text">
                                        <span className="material-icons-round">lock</span>
                                        <div>
                                            {invoiceIssuedLock ? (
                                                <strong>Izdat je završni račun — cijela ponuda je zaključana.</strong>
                                            ) : (
                                                <strong>Ponuda je {isAccepted ? 'prihvaćena' : 'poslana'} — {lockedCount} {lockedCount === 1 ? 'stavka' : 'stavke/i'} zaključano.</strong>
                                            )}
                                            <span> {invoiceIssuedLock
                                                ? 'Izmjene samo kroz storniranje računa ili „Revidiraj".'
                                                : `Cijene poslane klijentu se ne mijenjaju slučajno — izmjena samo kroz „Revidiraj".${unlockedCount > 0 ? ` Preostalih ${unlockedCount} ${unlockedCount === 1 ? 'stavka se' : 'stavke/i se'} može slobodno dopuniti i sačuvati.` : ''}`}
                                            </span>
                                            {changes.length > 0 && (
                                                <span className="offer-lock-stale">
                                                    {' '}Cijene materijala su se u međuvremenu promijenile za {changes.length} {changes.length === 1 ? 'proizvod' : 'proizvoda'}
                                                    {' '}(npr. {changes[0].name}: {changes[0].snapshot.toFixed(2)} → {changes[0].current.toFixed(2)} KM).
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="offer-lock-banner-actions">
                                        {currentOffer && (
                                            <button type="button" className="btn btn-secondary" onClick={() => { const off = currentOffer; handleCloseOfferModal(); handleReviseOffer(off); }} title="Napravi novu verziju (original ostaje netaknut) — jedini način da se zaključane cijene promijene">
                                                <span className="material-icons-round" style={{ fontSize: 16 }}>content_copy</span> Revidiraj
                                            </button>
                                        )}
                                        {changes.length > 0 && (
                                            <button type="button" className="btn btn-primary" onClick={refreshAllMaterialCosts} title="Ažuriraj cijene materijala na trenutne (samo za otključane stavke)">
                                                <span className="material-icons-round" style={{ fontSize: 16 }}>price_change</span> Ažuriraj cijene
                                            </button>
                                        )}
                                    </div>
                                </div>
                            );
                        })()}
                        {/* Left Column */}
                        <div className="offer-form-left">
                            {/* Offer Name + Project Selector Row */}
                            <div className="offer-top-row">
                                <div className="offer-name-field">
                                    <label>Naziv ponude</label>
                                    <input
                                        type="text"
                                        value={offerName}
                                        onChange={(e) => setOfferName(e.target.value)}
                                        placeholder="npr. Kuhinja Perić, Dnevni boravak..."
                                    />
                                </div>
                                <div className="offer-project-select">
                                    <label>Projekat</label>
                                    <select
                                        value={selectedProjectId}
                                        onChange={(e) => loadProjectForOffer(e.target.value)}
                                    >
                                        <option value="">-- Odaberi projekat --</option>
                                        {projects.map(project => (
                                            <option key={project.Project_ID} value={project.Project_ID}>
                                                {project.Name ? `${project.Name} — ${project.Client_Name}` : project.Client_Name} ({project.products?.length || 0} proizvoda)
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            {/* Client Info */}
                            {selectedProject && (
                                <div className="offer-client-info" style={{ flexDirection: 'column', gap: '12px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '100%' }}>
                                        <div className="client-avatar" style={{ background: clientOverride ? 'linear-gradient(135deg, #7c3aed, #a78bfa)' : undefined }}>
                                            {(clientOverride ? overrideClientName : selectedProject.Client_Name)?.charAt(0).toUpperCase() || '?'}
                                        </div>
                                        <div className="client-details" style={{ flex: 1 }}>
                                            <div className="client-name">
                                                {clientOverride ? overrideClientName || 'Novi klijent' : selectedProject.Client_Name}
                                                {clientOverride && (
                                                    <span style={{ fontSize: '11px', marginLeft: '8px', padding: '2px 8px', borderRadius: '6px', background: 'rgba(124, 58, 237, 0.1)', color: '#7c3aed', fontWeight: 600 }}>Override</span>
                                                )}
                                            </div>
                                            <div className="client-address">{clientOverride ? (overrideClientAddress || 'Adresa nije unesena') : (selectedProject.Address || 'Adresa nije unesena')}</div>
                                        </div>
                                        <button
                                            type="button"
                                            className={`glass-btn ${clientOverride ? 'glass-btn-primary' : ''}`}
                                            onClick={() => {
                                                if (!clientOverride) {
                                                    // Pre-fill with project data
                                                    setOverrideClientName(selectedProject.Client_Name || '');
                                                    setOverrideClientPhone(selectedProject.Client_Phone || '');
                                                    setOverrideClientEmail(selectedProject.Client_Email || '');
                                                    setOverrideClientAddress(selectedProject.Address || '');
                                                    setOverrideClientType(selectedProject.Client_Type || 'fizicko');
                                                    setOverrideClientIdNumber(selectedProject.Client_ID_Number || '');
                                                    setOverrideClientPdvNumber(selectedProject.Client_PDV_Number || '');
                                                }
                                                setClientOverride(!clientOverride);
                                            }}
                                            style={{ fontSize: '12px', padding: '6px 12px', whiteSpace: 'nowrap' }}
                                        >
                                            <span className="material-icons-round" style={{ fontSize: '16px' }}>{clientOverride ? 'person_off' : 'swap_horiz'}</span>
                                            {clientOverride ? 'Vrati' : 'Zamijeni'}
                                        </button>
                                    </div>

                                    {/* Override Fields */}
                                    {clientOverride && (
                                        <div style={{
                                            width: '100%',
                                            padding: '16px',
                                            background: 'var(--bg-secondary)',
                                            borderRadius: '10px',
                                            border: '1px solid var(--border-light)',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: '10px',
                                            animation: 'fadeIn 0.2s ease'
                                        }}>
                                            {/* Pick existing client from projects */}
                                            <div>
                                                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px', display: 'block' }}>Izaberi postojećeg klijenta</label>
                                                <select
                                                    style={{ width: '100%', padding: '8px 10px', fontSize: '13px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer' }}
                                                    value=""
                                                    onChange={(e) => {
                                                        const proj = projects.find(p => p.Project_ID === e.target.value);
                                                        if (proj) {
                                                            setOverrideClientName(proj.Client_Name || '');
                                                            setOverrideClientPhone(proj.Client_Phone || '');
                                                            setOverrideClientEmail(proj.Client_Email || '');
                                                            setOverrideClientAddress(proj.Address || '');
                                                            setOverrideClientType(proj.Client_Type || 'fizicko');
                                                            setOverrideClientIdNumber(proj.Client_ID_Number || '');
                                                            setOverrideClientPdvNumber(proj.Client_PDV_Number || '');
                                                        }
                                                    }}
                                                >
                                                    <option value="">— Izaberi klijenta iz baze —</option>
                                                    {(() => {
                                                        // Deduplicate clients by name
                                                        const seen = new Set<string>();
                                                        return projects
                                                            .filter(p => {
                                                                if (!p.Client_Name || seen.has(p.Client_Name)) return false;
                                                                seen.add(p.Client_Name);
                                                                return true;
                                                            })
                                                            .sort((a, b) => (a.Client_Name || '').localeCompare(b.Client_Name || '', 'hr'))
                                                            .map(p => (
                                                                <option key={p.Project_ID} value={p.Project_ID}>
                                                                    {p.Client_Name}{p.Client_Type === 'pravno' ? ' (Pravno)' : ''}
                                                                </option>
                                                            ));
                                                    })()}
                                                </select>
                                            </div>
                                            <div style={{ borderBottom: '1px solid var(--border-light)', margin: '2px 0' }} />
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                                <div>
                                                    <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px', display: 'block' }}>Ime klijenta *</label>
                                                    <input type="text" value={overrideClientName} onChange={(e) => setOverrideClientName(e.target.value)} placeholder="Ime i prezime / Naziv firme" style={{ width: '100%', padding: '8px 10px', fontSize: '13px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--surface)' }} />
                                                </div>
                                                <div>
                                                    <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px', display: 'block' }}>Adresa</label>
                                                    <input type="text" value={overrideClientAddress} onChange={(e) => setOverrideClientAddress(e.target.value)} placeholder="Adresa" style={{ width: '100%', padding: '8px 10px', fontSize: '13px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--surface)' }} />
                                                </div>
                                            </div>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                                <div>
                                                    <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px', display: 'block' }}>Telefon</label>
                                                    <input type="tel" value={overrideClientPhone} onChange={(e) => setOverrideClientPhone(e.target.value)} placeholder="+387..." style={{ width: '100%', padding: '8px 10px', fontSize: '13px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--surface)' }} />
                                                </div>
                                                <div>
                                                    <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px', display: 'block' }}>Email</label>
                                                    <input type="email" value={overrideClientEmail} onChange={(e) => setOverrideClientEmail(e.target.value)} placeholder="email@..." style={{ width: '100%', padding: '8px 10px', fontSize: '13px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--surface)' }} />
                                                </div>
                                            </div>
                                            <div>
                                                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px', display: 'block' }}>Tip klijenta</label>
                                                <div style={{ display: 'flex', gap: '8px' }}>
                                                    <button type="button" onClick={() => setOverrideClientType('fizicko')} style={{
                                                        flex: 1, padding: '7px 10px', fontSize: '12px', fontWeight: 600, borderRadius: '8px', border: '1.5px solid', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', transition: 'all 0.2s',
                                                        borderColor: overrideClientType === 'fizicko' ? '#2563eb' : 'var(--border)',
                                                        background: overrideClientType === 'fizicko' ? '#dbeafe' : 'var(--surface)',
                                                        color: overrideClientType === 'fizicko' ? '#2563eb' : 'var(--text-secondary)'
                                                    }}>
                                                        <span className="material-icons-round" style={{ fontSize: '15px' }}>person</span>Fizičko
                                                    </button>
                                                    <button type="button" onClick={() => setOverrideClientType('pravno')} style={{
                                                        flex: 1, padding: '7px 10px', fontSize: '12px', fontWeight: 600, borderRadius: '8px', border: '1.5px solid', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', transition: 'all 0.2s',
                                                        borderColor: overrideClientType === 'pravno' ? '#7c3aed' : 'var(--border)',
                                                        background: overrideClientType === 'pravno' ? '#ede9fe' : 'var(--surface)',
                                                        color: overrideClientType === 'pravno' ? '#7c3aed' : 'var(--text-secondary)'
                                                    }}>
                                                        <span className="material-icons-round" style={{ fontSize: '15px' }}>business</span>Pravno
                                                    </button>
                                                </div>
                                            </div>
                                            {overrideClientType === 'pravno' && (
                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                                    <div>
                                                        <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px', display: 'block' }}>ID broj (JIB)</label>
                                                        <input type="text" value={overrideClientIdNumber} onChange={(e) => setOverrideClientIdNumber(e.target.value)} placeholder="4200000000000" style={{ width: '100%', padding: '8px 10px', fontSize: '13px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--surface)' }} />
                                                    </div>
                                                    <div>
                                                        <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px', display: 'block' }}>PDV broj</label>
                                                        <input type="text" value={overrideClientPdvNumber} onChange={(e) => setOverrideClientPdvNumber(e.target.value)} placeholder="200000000000" style={{ width: '100%', padding: '8px 10px', fontSize: '13px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--surface)' }} />
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Products */}
                            {offerProducts.length > 0 && (
                                <div className="offer-products-list">
                                    <div className="offer-products-header">
                                        <h3>Proizvodi</h3>
                                        <span className="count">{offerProducts.filter(p => p.included).length} od {offerProducts.length}</span>
                                    </div>

                                    <div className="table-responsive" style={{ overflowX: 'auto', border: '1px solid var(--border-light)', borderRadius: '8px' }}>
                                        <table className="offer-spreadsheet">
                                            <thead>
                                                <tr>
                                                    <th style={{ width: '50px', textAlign: 'center' }}>Uklj.</th>
                                                    <th>Naziv proizvoda</th>
                                                    <th style={{ width: '110px' }}>
                                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                                            Materijal
                                                            {isEditMode && (
                                                                <button
                                                                    type="button"
                                                                    onClick={refreshAllMaterialCosts}
                                                                    title="Osvježi cijene materijala otključanih proizvoda iz projekta"
                                                                    className="refresh-btn"
                                                                    style={{ textTransform: 'none' }}
                                                                >
                                                                    <span className="material-icons-round">refresh</span>
                                                                </button>
                                                            )}
                                                        </span>
                                                    </th>
                                                    <th style={{ width: '100px', textAlign: 'center' }}>Radnici</th>
                                                    <th style={{ width: '100px', textAlign: 'center' }}>Dani</th>
                                                    <th style={{ width: '120px', textAlign: 'right' }}>Dnevnica</th>
                                                    <th style={{ width: '120px', textAlign: 'right' }}>Usluge</th>
                                                    <th style={{ width: '130px', textAlign: 'right' }}>Marža</th>
                                                    <th style={{ width: '130px', textAlign: 'right' }}>Cijena/kom</th>
                                                    <th style={{ width: '140px', textAlign: 'right' }}>Ukupno</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {offerProducts.map((product, index) => {
                                                    const materialCost = product.Material_Cost || 0;
                                                    const laborTotal = (product.laborWorkers || 0) * (product.laborDays || 0) * (product.laborDailyRate || 0);
                                                    const extrasTotal = (product.extras || []).reduce((sum, e) => sum + (e.total || 0), 0);
                                                    const unitPrice = materialCost + (product.margin || 0) + extrasTotal + laborTotal;
                                                    
                                                    return (
                                                        <tr key={product.Product_ID} className={`${product.included ? 'included' : 'excluded'}${product.locked ? ' offer-row-locked' : ''}`}>
                                                            <td className="text-center" style={{ textAlign: 'center' }}>
                                                                <input
                                                                    type="checkbox"
                                                                    checked={product.included}
                                                                    onChange={(e) => toggleProductIncluded(index, e.target.checked)}
                                                                    disabled={product.locked}
                                                                    className="modern-checkbox"
                                                                />
                                                            </td>
                                                            <td>
                                                                <div className="product-name-cell">
                                                                    <div className="p-title-row">
                                                                        {product.locked && (
                                                                            <span className="material-icons-round" style={{ fontSize: 15, color: 'var(--text-secondary, #64748b)' }} title="Stavka ima cijenu u poslanoj/prihvaćenoj ponudi — izmjena samo kroz Revidiraj">lock</span>
                                                                        )}
                                                                        <span className="p-name">{product.Product_Name}</span>
                                                                        {onNavigateToProject && selectedProjectId && (
                                                                            <button
                                                                                type="button"
                                                                                className="p-link-btn"
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation();
                                                                                    handleNavigateToProjectFromOffer(selectedProjectId, product.Product_ID, currentOffer?.Offer_ID);
                                                                                }}
                                                                                title="Otvori u projektu"
                                                                            >
                                                                                <span className="material-icons-round">open_in_new</span>
                                                                            </button>
                                                                        )}
                                                                    </div>
                                                                    <div className="p-meta">
                                                                        {product.Width && product.Height && product.Depth ? `${product.Width}×${product.Height}×${product.Depth}mm • ` : ''}
                                                                        Kol: <strong>{product.Quantity}</strong>
                                                                    </div>
                                                                </div>
                                                            </td>
                                                            <td className="readonly-cell">
                                                                <div className="val-flex">
                                                                    <span>{formatCurrency(product.Material_Cost)}</span>
                                                                    {isEditMode && !product.locked && (
                                                                        <button type="button" onClick={(e) => { e.stopPropagation(); refreshMaterialCost(index); }} title="Osviježi cijenu iz projekta" className="refresh-btn">
                                                                            <span className="material-icons-round">refresh</span>
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            </td>
                                                            <td className="input-cell" style={{ background: 'rgba(0, 113, 227, 0.02)' }}>
                                                                <input
                                                                    type="number"
                                                                    className="sheet-input text-center"
                                                                    style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary)' }}
                                                                    value={product.laborWorkers === 0 ? '' : (product.laborWorkers || '')}
                                                                    onChange={(e) => {
                                                                        const updated = [...offerProducts];
                                                                        updated[index].laborWorkers = e.target.value === '' ? 0 : parseInt(e.target.value);
                                                                        setOfferProducts(updated);
                                                                    }}
                                                                    min="0"
                                                                    disabled={!product.included || product.locked}
                                                                    placeholder="0"
                                                                />
                                                            </td>
                                                            <td className="input-cell" style={{ background: 'rgba(0, 113, 227, 0.02)' }}>
                                                                <input
                                                                    type="number"
                                                                    className="sheet-input text-center"
                                                                    style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary)' }}
                                                                    value={product.laborDays === 0 ? '' : (product.laborDays || '')}
                                                                    onChange={(e) => {
                                                                        const updated = [...offerProducts];
                                                                        updated[index].laborDays = e.target.value === '' ? 0 : parseInt(e.target.value);
                                                                        setOfferProducts(updated);
                                                                    }}
                                                                    min="0"
                                                                    disabled={!product.included || product.locked}
                                                                    placeholder="0"
                                                                />
                                                            </td>
                                                            <td className="input-cell" style={{ background: 'rgba(0, 113, 227, 0.02)' }}>
                                                                <input
                                                                    type="number"
                                                                    className="sheet-input text-right"
                                                                    style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary)' }}
                                                                    value={product.laborDailyRate === 0 ? '' : (product.laborDailyRate || '')}
                                                                    onChange={(e) => {
                                                                        const updated = [...offerProducts];
                                                                        updated[index].laborDailyRate = e.target.value === '' ? 0 : parseFloat(e.target.value);
                                                                        setOfferProducts(updated);
                                                                    }}
                                                                    min="0" step="10"
                                                                    disabled={!product.included || product.locked}
                                                                    placeholder="0"
                                                                />
                                                            </td>
                                                            <td className="btn-cell">
                                                                <button
                                                                    type="button"
                                                                    className="sheet-btn"
                                                                    onClick={() => openExtrasListOrAdd(index)}
                                                                    disabled={!product.included || product.locked}
                                                                >
                                                                    {product.extras && product.extras.length > 0 ? (
                                                                        <>
                                                                            <span className="count-badge">{product.extras.length}</span>
                                                                            <span className="val">{formatPrice(extrasTotal, offerCurrency)}</span>
                                                                        </>
                                                                    ) : (
                                                                        <span className="empty-text">Dodaj</span>
                                                                    )}
                                                                </button>
                                                            </td>
                                                            <td className="input-cell with-suffix" style={{ background: 'rgba(0, 113, 227, 0.02)' }}>
                                                                <div className="input-wrapper">
                                                                    <input
                                                                        type="number"
                                                                        className="sheet-input text-right"
                                                                        style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary)' }}
                                                                        value={product.margin || ''}
                                                                        onChange={(e) => updateProductMargin(index, parseFloat(e.target.value) || 0)}
                                                                        min="0" step="10"
                                                                        disabled={!product.included || product.locked}
                                                                        placeholder="0"
                                                                    />
                                                                    <span className="suffix">KM</span>
                                                                </div>
                                                            </td>
                                                            <td className="readonly-cell unit-price">
                                                                {formatPrice(unitPrice, offerCurrency)}
                                                            </td>
                                                            <td className="readonly-cell unit-price">
                                                                {formatPrice(calculateProductTotal(product), offerCurrency)}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Right Column - Settings & Summary */}
                        {offerProducts.length > 0 && (
                            <div className="offer-form-right">
                                {/* Settings - Compact */}
                                <div className="offer-settings-compact">
                                    <h4>Postavke</h4>

                                    {/* Row 1: Transport + Vrijedi do */}
                                    <div className="settings-row-2col">
                                        <div className="setting-field">
                                            <label>Transport (KM)</label>
                                            <input
                                                type="number"
                                                value={transportCost}
                                                onChange={(e) => setTransportCost(parseFloat(e.target.value) || 0)}
                                                min="0"
                                            />
                                        </div>
                                        <div className="setting-field">
                                            <label>Vrijedi do</label>
                                            <input
                                                type="date"
                                                value={validUntil}
                                                onChange={(e) => setValidUntil(e.target.value)}
                                            />
                                        </div>
                                    </div>

                                    {/* Row 2: Checkboxes inline */}
                                    <div className="settings-checkboxes">
                                        <label className="setting-checkbox">
                                            <input
                                                type="checkbox"
                                                checked={onsiteAssembly}
                                                onChange={(e) => {
                                                    setOnsiteAssembly(e.target.checked);
                                                    if (!e.target.checked) setOnsiteDiscount(0);
                                                }}
                                            />
                                            <span>Sklapanje kod klijenta</span>
                                            {onsiteAssembly && (
                                                <input
                                                    type="number"
                                                    value={onsiteDiscount}
                                                    onChange={(e) => setOnsiteDiscount(parseFloat(e.target.value) || 0)}
                                                    min="0"
                                                    placeholder="Popust"
                                                    className="inline-discount"
                                                />
                                            )}
                                        </label>

                                        <label className="setting-checkbox">
                                            <input
                                                type="checkbox"
                                                checked={includePDV}
                                                onChange={(e) => setIncludePDV(e.target.checked)}
                                            />
                                            <span>PDV</span>
                                            {includePDV && (
                                                <div className="inline-pdv">
                                                    <input
                                                        type="number"
                                                        value={pdvRate}
                                                        onChange={(e) => setPdvRate(parseFloat(e.target.value) || 0)}
                                                        min="0"
                                                        max="100"
                                                    />
                                                    <span>%</span>
                                                </div>
                                            )}
                                        </label>
                                    </div>

                                    {/* Row 3: Notes */}
                                    <div className="setting-notes">
                                        <label>Napomene</label>
                                        <textarea
                                            value={notes}
                                            onChange={(e) => setNotes(e.target.value)}
                                            rows={4}
                                            placeholder="Dodatne napomene za ponudu..."
                                        />
                                    </div>
                                </div>

                                {/* Summary */}
                                <div className="offer-summary" style={{ width: '280px', flexShrink: 0 }}>
                                    <div className="offer-summary-rows">
                                        <div className="offer-summary-row">
                                            <span className="label">Proizvodi</span>
                                            <span className="value">{formatPrice(totals.subtotal, offerCurrency)}</span>
                                        </div>
                                        {totals.transport > 0 && (
                                            <div className="offer-summary-row">
                                                <span className="label">Transport</span>
                                                <span className="value">{formatPrice(totals.transport, offerCurrency)}</span>
                                            </div>
                                        )}
                                        {totals.discount > 0 && (
                                            <div className="offer-summary-row discount">
                                                <span className="label">Popust</span>
                                                <span className="value">-{formatPrice(totals.discount, offerCurrency)}</span>
                                            </div>
                                        )}
                                        {includePDV && totals.pdvAmount > 0 && (
                                            <div className="offer-summary-row pdv">
                                                <span className="label">PDV ({pdvRate}%)</span>
                                                <span className="value">{formatPrice(totals.pdvAmount, offerCurrency)}</span>
                                            </div>
                                        )}
                                        <div className="offer-summary-divider" />
                                        <div className="offer-summary-row total">
                                            <span className="label">UKUPNO</span>
                                            <span className="value">{formatPrice(totals.total, offerCurrency)}</span>
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '6px', marginTop: '10px' }}>
                                        <button
                                            type="button"
                                            className={`eur-toggle-btn ${offerCurrency === 'EUR' ? 'active' : ''}`}
                                            onClick={() => setOfferCurrency(offerCurrency === 'EUR' ? 'KM' : 'EUR')}
                                            style={{ flex: 1 }}
                                        >
                                            <span className="material-icons-round" style={{ fontSize: '14px' }}>euro</span>
                                            {offerCurrency === 'EUR' ? 'EUR' : 'KM'}
                                        </button>
                                        <button
                                            type="button"
                                            className={`eur-toggle-btn ${offerLanguage === 'en' ? 'active' : ''}`}
                                            onClick={() => setOfferLanguage(offerLanguage === 'en' ? 'bs' : 'en')}
                                            style={{ flex: 1 }}
                                        >
                                            <span className="material-icons-round" style={{ fontSize: '14px' }}>translate</span>
                                            {offerLanguage === 'en' ? 'EN' : 'BS'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </Modal>

            {/* Extras List Modal — shows existing extras for a product */}
            <Modal
                isOpen={extrasListModal}
                onClose={() => setExtrasListModal(false)}
                title={extrasListProductIndex !== null ? `Usluge — ${offerProducts[extrasListProductIndex]?.Product_Name || ''}` : 'Usluge'}
                zIndex={1900}
                footer={
                    <>
                        <button className="btn btn-secondary" onClick={() => setExtrasListModal(false)}>Zatvori</button>
                        <button className="btn btn-primary" onClick={() => {
                            if (extrasListProductIndex !== null) {
                                openExtrasModal(extrasListProductIndex);
                            }
                        }}>
                            <span className="material-icons-round" style={{ fontSize: '16px', marginRight: '4px' }}>add</span>
                            Dodaj uslugu
                        </button>
                    </>
                }
            >
                {extrasListProductIndex !== null && offerProducts[extrasListProductIndex] && (
                    <div style={{ minWidth: '400px' }}>
                        {offerProducts[extrasListProductIndex].extras.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--text-secondary)' }}>
                                <span className="material-icons-round" style={{ fontSize: '40px', opacity: 0.4, display: 'block', marginBottom: '8px' }}>handyman</span>
                                Nema dodanih usluga
                            </div>
                        ) : (
                            <>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                                    <thead>
                                        <tr style={{ borderBottom: '2px solid var(--border-light)', textAlign: 'left' }}>
                                            <th style={{ padding: '8px 10px', fontWeight: 600, color: 'var(--text-secondary)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Naziv</th>
                                            <th style={{ padding: '8px 10px', fontWeight: 600, color: 'var(--text-secondary)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'center' }}>Količina</th>
                                            <th style={{ padding: '8px 10px', fontWeight: 600, color: 'var(--text-secondary)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'right' }}>Cijena</th>
                                            <th style={{ padding: '8px 10px', fontWeight: 600, color: 'var(--text-secondary)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'right' }}>Ukupno</th>
                                            <th style={{ padding: '8px 10px', width: '80px' }}></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {offerProducts[extrasListProductIndex].extras.map((extra, ei) => (
                                            <tr key={ei} style={{ borderBottom: '1px solid var(--border-light)', transition: 'background 0.15s' }}
                                                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover, rgba(0,0,0,0.02))')}
                                                onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                                            >
                                                <td style={{ padding: '10px' }}>
                                                    <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{extra.name}</div>
                                                    {extra.note && <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>{extra.note}</div>}
                                                </td>
                                                <td style={{ padding: '10px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                                                    {extra.qty} {extra.unit}
                                                </td>
                                                <td style={{ padding: '10px', textAlign: 'right', color: 'var(--text-secondary)' }}>
                                                    {formatCurrency(extra.price)}
                                                </td>
                                                <td style={{ padding: '10px', textAlign: 'right', fontWeight: 600, color: 'var(--accent)' }}>
                                                    {formatCurrency(extra.total || extra.qty * extra.price)}
                                                </td>
                                                <td style={{ padding: '10px', textAlign: 'right' }}>
                                                    <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
                                                        <button
                                                            type="button"
                                                            className="btn btn-sm"
                                                            style={{ padding: '4px 8px', fontSize: '12px', border: '1px solid var(--border-light)', borderRadius: '6px', background: 'transparent', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '2px' }}
                                                            onClick={() => {
                                                                if (extrasListProductIndex !== null) {
                                                                    openExtrasModal(extrasListProductIndex, ei);
                                                                }
                                                            }}
                                                            title="Uredi"
                                                        >
                                                            <span className="material-icons-round" style={{ fontSize: '14px' }}>edit</span>
                                                        </button>
                                                        <button
                                                            type="button"
                                                            className="btn btn-sm"
                                                            style={{ padding: '4px 8px', fontSize: '12px', border: '1px solid var(--border-light)', borderRadius: '6px', background: 'transparent', cursor: 'pointer', color: '#ef4444', display: 'flex', alignItems: 'center', gap: '2px' }}
                                                            onClick={() => {
                                                                if (extrasListProductIndex !== null) {
                                                                    const remaining = offerProducts[extrasListProductIndex].extras.length - 1;
                                                                    removeExtra(extrasListProductIndex, ei);
                                                                    // If no extras left after removal, close the list modal
                                                                    if (remaining <= 0) {
                                                                        setExtrasListModal(false);
                                                                    }
                                                                }
                                                            }}
                                                            title="Obriši"
                                                        >
                                                            <span className="material-icons-round" style={{ fontSize: '14px' }}>delete</span>
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '12px 10px 4px', borderTop: '2px solid var(--border-light)', marginTop: '4px' }}>
                                    <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                                        Ukupno usluge: <span style={{ color: 'var(--accent)' }}>
                                            {formatCurrency(offerProducts[extrasListProductIndex].extras.reduce((sum, e) => sum + (e.total || e.qty * e.price), 0))}
                                        </span>
                                    </span>
                                </div>
                            </>
                        )}
                    </div>
                )}
            </Modal>

            {/* Extras Modal */}
            <Modal
                isOpen={extrasModal}
                onClose={() => setExtrasModal(false)}
                title={editingExtraIndex !== null ? 'Uredi Uslugu/Dodatak' : 'Dodaj Uslugu/Dodatak'}
                zIndex={2000}
                footer={
                    <>
                        <button className="btn btn-secondary" onClick={() => setExtrasModal(false)}>Otkaži</button>
                        <button className="btn btn-primary" onClick={addExtraToProduct}>{editingExtraIndex !== null ? 'Spremi' : 'Dodaj'}</button>
                    </>
                }
            >
                <div className="form-group">
                    <label>Naziv usluge/dodatka *</label>
                    <select
                        value={extraName}
                        onChange={(e) => setExtraName(e.target.value)}
                    >
                        <option value="">-- Odaberi ili upiši --</option>
                        <option value="LED instalacija">LED instalacija</option>
                        <option value="Ugradnja česme">Ugradnja česme</option>
                        <option value="Fugiranje">Fugiranje</option>
                        <option value="Montaža lajsni">Montaža lajsni</option>
                        <option value="Ugradnja spotova">Ugradnja spotova</option>
                        <option value="Silikoniranje">Silikoniranje</option>
                        <option value="custom">Drugo (upiši)</option>
                    </select>
                    {extraName === 'custom' && (
                        <input
                            type="text"
                            value={extraCustomName}
                            onChange={(e) => setExtraCustomName(e.target.value)}
                            placeholder="Naziv usluge..."
                            style={{ marginTop: '8px' }}
                        />
                    )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                    <div className="form-group">
                        <label>Količina</label>
                        <input
                            type="number"
                            value={extraQty}
                            onChange={(e) => setExtraQty(parseFloat(e.target.value) || 1)}
                            min="0.01"
                            step="0.01"
                        />
                    </div>
                    <div className="form-group">
                        <label>Jedinica</label>
                        <select value={extraUnit} onChange={(e) => setExtraUnit(e.target.value)}>
                            <option value="kom">kom</option>
                            <option value="m">m</option>
                            <option value="m²">m²</option>
                            <option value="sat">sat</option>
                            <option value="paušal">paušal</option>
                        </select>
                    </div>
                    <div className="form-group">
                        <label>Cijena/jed (KM)</label>
                        <input
                            type="number"
                            value={extraPrice}
                            onChange={(e) => setExtraPrice(parseFloat(e.target.value) || 0)}
                            min="0"
                            step="0.01"
                        />
                    </div>
                </div>

                <div className="form-group">
                    <label>Ukupno: <strong style={{ color: 'var(--accent)' }}>{formatCurrency(extraQty * extraPrice)}</strong></label>
                </div>

                <div className="form-group">
                    <label>Napomena</label>
                    <input
                        type="text"
                        value={extraNote}
                        onChange={(e) => setExtraNote(e.target.value)}
                        placeholder="Dodatna napomena..."
                    />
                </div>
            </Modal>

            {/* View Offer Modal */}
            <Modal
                isOpen={viewModal}
                onClose={() => setViewModal(false)}
                title={`Ponuda ${currentOffer?.Offer_Number || ''}`}
                size="fullscreen"
                footer={
                    <>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <select
                                className="filter-select"
                                value={currentOffer?.Status || 'Nacrt'}
                                onChange={(e) => currentOffer && handleUpdateStatus(currentOffer.Offer_ID, e.target.value)}
                                style={{ width: 'auto' }}
                            >
                                {OFFER_STATUSES.map(s => (
                                    <option key={s} value={s}>{s}</option>
                                ))}
                            </select>
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <button className="btn btn-secondary" onClick={() => currentOffer && handlePrintOffer(currentOffer)}>
                                <span className="material-icons-round">print</span>
                                Printaj
                            </button>
                            <button className="btn btn-secondary" onClick={() => setViewModal(false)}>Zatvori</button>
                        </div>
                    </>
                }
            >
                {modalLoading ? (
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '60px' }}>
                        <div style={{ textAlign: 'center' }}>
                            <span className="material-icons-round" style={{ fontSize: '48px', color: 'var(--accent)', animation: 'spin 1s linear infinite' }}>sync</span>
                            <p style={{ marginTop: '16px', color: 'var(--text-secondary)' }}>Učitavanje...</p>
                        </div>
                    </div>
                ) : currentOffer && (
                    <div>
                        {/* Compact Offer Header */}
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                            gap: '16px',
                            marginBottom: '24px',
                            background: 'var(--surface)',
                            padding: '16px',
                            borderRadius: '12px',
                            border: '1px solid var(--border-light)',
                        }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <span style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-secondary)', fontWeight: 600, letterSpacing: '0.5px' }}>Broj Ponude</span>
                                <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <span className="material-icons-round" style={{ fontSize: '16px', color: 'var(--accent)' }}>tag</span>
                                    {currentOffer.Offer_Number}
                                </span>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <span style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-secondary)', fontWeight: 600, letterSpacing: '0.5px' }}>Klijent</span>
                                <span style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <span className="material-icons-round" style={{ fontSize: '16px', color: 'var(--text-secondary)' }}>{(currentOffer as any).Client_Type === 'pravno' ? 'business' : 'person'}</span>
                                    {currentOffer.Client_Name || '-'}
                                </span>
                                {(currentOffer as any).Client_Address && (
                                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>{(currentOffer as any).Client_Address}</span>
                                )}
                                {((currentOffer as any).Client_Phone || (currentOffer as any).Client_Email) && (
                                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                        {[(currentOffer as any).Client_Phone, (currentOffer as any).Client_Email].filter(Boolean).join(' · ')}
                                    </span>
                                )}
                                {((currentOffer as any).Client_ID_Number || (currentOffer as any).Client_PDV_Number) && (
                                    <span style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'flex', gap: '8px', marginTop: '2px' }}>
                                        {(currentOffer as any).Client_ID_Number && <span>ID: {(currentOffer as any).Client_ID_Number}</span>}
                                        {(currentOffer as any).Client_PDV_Number && <span>PDV: {(currentOffer as any).Client_PDV_Number}</span>}
                                    </span>
                                )}
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <span style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-secondary)', fontWeight: 600, letterSpacing: '0.5px' }}>Kreirano</span>
                                <span style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <span className="material-icons-round" style={{ fontSize: '16px', color: 'var(--text-secondary)' }}>calendar_today</span>
                                    {formatDate(currentOffer.Created_Date)}
                                </span>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <span style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-secondary)', fontWeight: 600, letterSpacing: '0.5px' }}>Vrijedi do</span>
                                <span style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <span className="material-icons-round" style={{ fontSize: '16px', color: 'var(--text-secondary)' }}>event_available</span>
                                    {formatDate(currentOffer.Valid_Until)}
                                </span>
                            </div>
                        </div>

                        {/* Products Grid */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                            <span className="material-icons-round" style={{ color: 'var(--accent)' }}>inventory_2</span>
                            <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>Stavke ponude</h4>
                        </div>
                        
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px', marginBottom: '32px' }}>
                            {(() => {
                                const viewCurrency = ((currentOffer as any).Currency || 'KM') as 'KM' | 'EUR';
                                return (currentOffer.products || []).filter(p => p.Included).map((product) => {
                                    const proj = projects.find(p => p.Project_ID === currentOffer.Project_ID);
                                    const pp = proj?.products?.find(pp => pp.Product_ID === product.Product_ID);
                                    const dims = pp && pp.Width && pp.Height && pp.Depth
                                        ? `${pp.Width} × ${pp.Height} × ${pp.Depth} mm` : null;
                                    const laborTotal = ((product as any).Labor_Workers || 0) * ((product as any).Labor_Days || 0) * ((product as any).Labor_Daily_Rate || 0);
                                    const extrasTotal = ((product as any).Extras || (product as any).extras || []).reduce((sum: number, e: any) => sum + (e.total || e.Total || 0), 0);
                                    const unitPrice = (product.Material_Cost || 0) + (product.Margin || 0) + laborTotal + extrasTotal;
                                    
                                    return (
                                        <div key={product.ID} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', borderRadius: '12px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.02)' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                                <div>
                                                    <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '15px', lineHeight: 1.3 }}>{product.Product_Name}</div>
                                                    {dims && <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>{dims}</div>}
                                                </div>
                                                <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '4px 8px', fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>
                                                    {product.Quantity} <span style={{ fontSize: '11px', fontWeight: 500, color: 'var(--text-secondary)' }}>kom</span>
                                                </div>
                                            </div>
                                            
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                                <div style={{ fontSize: '12px', background: 'rgba(59,130,246,0.1)', color: '#2563eb', padding: '4px 8px', borderRadius: '6px', fontWeight: 600 }}>
                                                    Mat: {formatPrice(product.Material_Cost, viewCurrency)}
                                                </div>
                                                <div style={{ fontSize: '12px', background: 'rgba(34,197,94,0.1)', color: '#16a34a', padding: '4px 8px', borderRadius: '6px', fontWeight: 600 }}>
                                                    Marža: {formatPrice(product.Margin, viewCurrency)}
                                                </div>
                                                {laborTotal > 0 && (
                                                    <div style={{ fontSize: '12px', background: 'rgba(168,85,247,0.1)', color: '#9333ea', padding: '4px 8px', borderRadius: '6px', fontWeight: 600 }}>
                                                        Rad: {formatPrice(laborTotal, viewCurrency)}
                                                    </div>
                                                )}
                                                {extrasTotal > 0 && (
                                                    <div style={{ fontSize: '12px', background: 'rgba(245,158,11,0.1)', color: '#d97706', padding: '4px 8px', borderRadius: '6px', fontWeight: 600 }}>
                                                        Usluge: {formatPrice(extrasTotal, viewCurrency)}
                                                    </div>
                                                )}
                                            </div>

                                            <div style={{ borderTop: '1px dashed var(--border)', paddingTop: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto' }}>
                                                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 500 }}>1 kom: {formatPrice(unitPrice, viewCurrency)}</div>
                                                <div style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)' }}>{formatPrice(product.Total_Price, viewCurrency)}</div>
                                            </div>
                                        </div>
                                    );
                                });
                            })()}
                        </div>

                        {/* Totals */}
                        {(() => {
                            const viewCurrency = ((currentOffer as any).Currency || 'KM') as 'KM' | 'EUR';
                            return (
                                <div style={{ background: 'var(--surface)', padding: '24px', borderRadius: '16px', border: '1px solid var(--border)', boxShadow: '0 4px 15px rgba(0,0,0,0.03)' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '400px', marginLeft: 'auto' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', color: 'var(--text-secondary)', fontWeight: 500 }}>
                                            <span>Ukupno materijal/rad:</span>
                                            <span style={{ color: 'var(--text-primary)' }}>{formatPrice(currentOffer.Subtotal, viewCurrency)}</span>
                                        </div>
                                        
                                        {(currentOffer.Transport_Cost || 0) > 0 && (
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', color: 'var(--text-secondary)', fontWeight: 500 }}>
                                                <span>Troškovi transporta:</span>
                                                <span style={{ color: 'var(--text-primary)' }}>{formatPrice(currentOffer.Transport_Cost, viewCurrency)}</span>
                                            </div>
                                        )}
                                        
                                        {currentOffer.Onsite_Assembly && (currentOffer.Onsite_Discount || 0) > 0 && (
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', color: 'var(--success)', fontWeight: 600 }}>
                                                <span>Odobreni popust:</span>
                                                <span>-{formatPrice(currentOffer.Onsite_Discount, viewCurrency)}</span>
                                            </div>
                                        )}
                                        
                                        {(currentOffer as any).Include_PDV && (() => {
                                            const baseTotal = (currentOffer.Subtotal || 0) + (currentOffer.Transport_Cost || 0) - (currentOffer.Onsite_Assembly ? (currentOffer.Onsite_Discount || 0) : 0);
                                            const rate = (currentOffer as any).PDV_Rate || 17;
                                            return (
                                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', color: 'var(--text-secondary)', fontWeight: 500 }}>
                                                    <span>PDV ({rate}%):</span>
                                                    <span style={{ color: 'var(--text-primary)' }}>{formatPrice(baseTotal * rate / 100, viewCurrency)}</span>
                                                </div>
                                            );
                                        })()}
                                        
                                        <div style={{ height: '1px', background: 'var(--border)', margin: '4px 0' }}></div>
                                        
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <span style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)' }}>
                                                ZA UPLATU {(currentOffer as any).Include_PDV ? '(sa PDV)' : ''}:
                                            </span>
                                            <span style={{ fontSize: '24px', fontWeight: 800, color: 'var(--accent)', letterSpacing: '-0.5px' }}>
                                                {formatPrice(
                                                    (() => {
                                                        const baseTotal = (currentOffer.Subtotal || 0) + (currentOffer.Transport_Cost || 0) - (currentOffer.Onsite_Assembly ? (currentOffer.Onsite_Discount || 0) : 0);
                                                        return (currentOffer as any).Include_PDV ? baseTotal * (1 + ((currentOffer as any).PDV_Rate || 17) / 100) : baseTotal;
                                                    })(), viewCurrency
                                                )}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            );
                        })()}

                        {/* Notes */}
                        {currentOffer.Notes && (
                            <div style={{ marginTop: '24px', background: '#fffbeb', border: '1px solid #fde68a', padding: '16px', borderRadius: '12px', display: 'flex', gap: '12px' }}>
                                <span className="material-icons-round" style={{ color: '#d97706', fontSize: '20px' }}>info</span>
                                <div>
                                    <h4 style={{ margin: '0 0 4px 0', fontSize: '13px', textTransform: 'uppercase', color: '#b45309', letterSpacing: '0.5px' }}>Napomena za klijenta</h4>
                                    <p style={{ margin: 0, fontSize: '14px', color: '#92400e', lineHeight: 1.5, whiteSpace: 'pre-line' }}>{currentOffer.Notes}</p>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </Modal>
            {/* Unsaved Changes Confirmation Dialog */}
            {confirmCloseModal && (
                <div
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        background: 'rgba(0,0,0,0.5)',
                        backdropFilter: 'blur(4px)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 10000,
                        animation: 'fadeIn 0.2s ease'
                    }}
                    onClick={() => setConfirmCloseModal(false)}
                >
                    <div
                        style={{
                            background: 'var(--surface, #fff)',
                            borderRadius: '16px',
                            padding: '28px 32px',
                            maxWidth: '420px',
                            width: '90%',
                            boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
                            animation: 'slideUp 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)',
                            textAlign: 'center',
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div style={{
                            width: '48px',
                            height: '48px',
                            borderRadius: '50%',
                            background: 'rgba(255, 149, 0, 0.12)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            margin: '0 auto 16px',
                        }}>
                            <span className="material-icons-round" style={{ fontSize: '28px', color: '#ff9500' }}>save</span>
                        </div>
                        <h3 style={{
                            margin: '0 0 8px',
                            fontSize: '18px',
                            fontWeight: 700,
                            color: 'var(--text-primary, #1d1d1f)',
                        }}>
                            {pendingNavigate ? 'Sačuvaj ponudu prije otvaranja?' : 'Želite li sačuvati ponudu?'}
                        </h3>
                        <p style={{
                            margin: '0 0 24px',
                            fontSize: '14px',
                            color: 'var(--text-secondary, #666)',
                            lineHeight: 1.5,
                        }}>
                            {pendingNavigate
                                ? 'Imate nesačuvane izmjene u ponudi. Želite li ih sačuvati prije nego što otvorite proizvod u projektu?'
                                : 'Imate nesačuvane izmjene u ponudi. Želite li ih sačuvati prije zatvaranja?'
                            }
                        </p>
                        <div style={{
                            display: 'flex',
                            gap: '10px',
                            justifyContent: 'center',
                            flexWrap: 'wrap',
                        }}>
                            <button
                                onClick={() => setConfirmCloseModal(false)}
                                style={{
                                    padding: '10px 20px',
                                    borderRadius: '10px',
                                    border: '1px solid var(--border-color, #e0e0e0)',
                                    background: 'var(--bg-secondary, #f5f5f7)',
                                    color: 'var(--text-secondary, #666)',
                                    fontSize: '14px',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    transition: 'all 0.2s',
                                    minWidth: '100px',
                                }}
                            >
                                Otkaži
                            </button>
                            <button
                                onClick={handleDiscardAndClose}
                                style={{
                                    padding: '10px 20px',
                                    borderRadius: '10px',
                                    border: '1px solid var(--border-color, #e0e0e0)',
                                    background: 'var(--bg-secondary, #f5f5f7)',
                                    color: '#ff3b30',
                                    fontSize: '14px',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    transition: 'all 0.2s',
                                    minWidth: '100px',
                                }}
                            >
                                Ne sačuvaj
                            </button>
                            <button
                                onClick={handleSaveAndClose}
                                style={{
                                    padding: '10px 20px',
                                    borderRadius: '10px',
                                    border: 'none',
                                    background: 'var(--accent, #0071e3)',
                                    color: '#fff',
                                    fontSize: '14px',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    transition: 'all 0.2s',
                                    minWidth: '100px',
                                    boxShadow: '0 2px 8px rgba(0, 113, 227, 0.3)',
                                }}
                            >
                                Sačuvaj
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
