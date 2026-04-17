'use client';

import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import type { Offer, Project, OfferProduct, Product } from '@/lib/types';
import { createOfferWithProducts, deleteOffer, updateOfferStatus, saveOffer, updateOfferWithProducts, getOffer } from '@/lib/services';
import { useData } from '@/context/DataContext';
import { generateOfferPDF, type OfferPDFData } from '@/lib/pdfGenerator';
import Modal from '@/components/ui/Modal';
import { OFFER_STATUSES } from '@/lib/types';
import { sortProductsByName } from '@/lib/sortProducts';

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
}

export default function OffersTab({ offers, projects, onRefresh, showToast, onNavigateToProject, autoEditOfferId, autoScrollProductId, onClearAutoEdit }: OffersTabProps) {
    const { organizationId } = useData();
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

    // Extras Modal State
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

    // PDV State
    const [includePDV, setIncludePDV] = useState(true);
    const [pdvRate, setPdvRate] = useState(17);

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
            laborDailyRate: 0
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

    // Refresh material cost from latest project product data
    function refreshMaterialCost(index: number) {
        const product = offerProducts[index];
        if (!product || !selectedProjectId) return;

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
    // EXTRAS MODAL
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

                    const products: OfferProductState[] = (fullOffer.products || []).map((p: OfferProduct) => {
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
                            laborDailyRate: (p as any).Labor_Daily_Rate || (p as any).laborDailyRate || 0
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

    // Open edit modal for existing offer
    async function openEditModal(offer: Offer) {
        // Open modal immediately with loading state
        setCurrentOffer(offer);
        setIsEditMode(true);
        setCreateModal(true);
        setModalLoading(true);

        // Load full offer with products
        const fullOffer = await getOffer(offer.Offer_ID, organizationId!);
        setModalLoading(false);

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
                laborDailyRate: laborDailyRate
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
                laborDailyRate: 0
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

        // === Manual pagination: split products into pages ===
        const ROWS_FIRST_PAGE = 12;  // fewer rows on first page (has "PROIZVODI" title)
        const ROWS_PER_PAGE = 14;    // more rows on subsequent pages

        // Split products into page chunks
        const pages: (typeof products[number])[][] = [];
        let remaining = [...products];
        // First page
        pages.push(remaining.splice(0, ROWS_FIRST_PAGE));
        // Subsequent pages
        while (remaining.length > 0) {
            pages.push(remaining.splice(0, ROWS_PER_PAGE));
        }

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

        // Bottom section (notes + totals + signatures) — only on last page
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

        // Build all pages
        let globalIdx = 0;
        const pagesHTML = pages.map((pageProducts, pageIndex) => {
            const isLastPage = pageIndex === pages.length - 1;
            const isFirstPage = pageIndex === 0;
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
                        <thead>
                            <tr>
                                <th class="col-num">#</th>
                                <th class="col-name">${t.name} <span style="font-weight:400;color:#bbb;font-size:9px;">${t.dims}</span></th>
                                <th class="col-qty">${t.qty}</th>
                                <th class="col-price">${t.price}</th>
                                <th class="col-total">${t.total}</th>
                            </tr>
                        </thead>
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
                <style>
                    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
                    
                    * { margin: 0; padding: 0; box-sizing: border-box; }
                    
                    body { 
                        font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
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
                </style>
            </head>
            <body>
                ${pagesHTML}
            </body>
            </html>
        `;

        const printWindow = window.open('', '_blank');
        if (printWindow) {
            printWindow.document.write(printContent);
            printWindow.document.close();
            printWindow.onload = () => {
                printWindow.print();
            };
        }
    }

    // ============================================
    // DOWNLOAD PDF
    // ============================================

    async function handleDownloadPDF(offer: Offer) {
        try {
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

            const pdfData: OfferPDFData = {
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

            await generateOfferPDF(pdfData);
            showToast('PDF ponude preuzet', 'success');
        } catch (error) {
            console.error('Error generating PDF:', error);
            showToast('Greška pri generiranju PDF-a', 'error');
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
                                            <button
                                                className="action-icon-btn"
                                                onClick={(e) => { e.stopPropagation(); handlePrintOffer(offer); }}
                                                title="Printaj"
                                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px', transition: 'all 0.2s' }}
                                            >
                                                <span className="material-icons-round" style={{ fontSize: '20px' }}>print</span>
                                            </button>
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

            {/* Create/Edit Offer Modal */}
            <Modal
                isOpen={createModal}
                onClose={handleCloseOfferModal}
                title={isEditMode ? (
                    <span style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                        <span>Uredi Ponudu: {currentOffer?.Offer_Number || ''}</span>
                        {offerProducts.length > 0 && (() => {
                            const totals = calculateOfferTotals();
                            const profit = offerProducts
                                .filter(p => p.included)
                                .reduce((sum, p) => sum + (p.margin || 0) * (p.Quantity || 1), 0);
                            return (
                                <>
                                    <span style={{
                                        display: 'inline-flex', alignItems: 'center', gap: '4px',
                                        background: 'var(--bg-secondary, #f0f4f8)', borderRadius: '8px',
                                        padding: '4px 10px', fontSize: '13px', fontWeight: 500,
                                        color: 'var(--text-secondary, #555)'
                                    }}>
                                        <span className="material-icons-round" style={{ fontSize: '16px', color: 'var(--accent, #0066cc)' }}>receipt_long</span>
                                        {totals.subtotal.toLocaleString('bs-BA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} KM
                                    </span>
                                    <span style={{
                                        display: 'inline-flex', alignItems: 'center', gap: '4px',
                                        background: profit >= 0 ? 'rgba(52,199,89,0.1)' : 'rgba(255,59,48,0.1)',
                                        borderRadius: '8px', padding: '4px 10px', fontSize: '13px', fontWeight: 500,
                                        color: profit >= 0 ? '#34c759' : '#ff3b30'
                                    }}>
                                        <span className="material-icons-round" style={{ fontSize: '16px' }}>trending_up</span>
                                        {profit.toLocaleString('bs-BA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} KM
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
                            disabled={isSaving || !selectedProjectId || offerProducts.filter(p => p.included).length === 0}
                        >
                            {isSaving ? 'Spremanje...' : (isEditMode ? 'Ažuriraj Ponudu' : 'Sačuvaj Ponudu')}
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
                                                {project.Client_Name} ({project.products?.length || 0} proizvoda)
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            {/* Client Info */}
                            {selectedProject && (
                                <div className="offer-client-info">
                                    <div className="client-avatar">
                                        {selectedProject.Client_Name?.charAt(0).toUpperCase() || '?'}
                                    </div>
                                    <div className="client-details">
                                        <div className="client-name">{selectedProject.Client_Name}</div>
                                        <div className="client-address">{selectedProject.Address || 'Adresa nije unesena'}</div>
                                    </div>
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
                                                    <th style={{ width: '110px' }}>Materijal</th>
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
                                                    const laborTotal = (product.laborWorkers || 0) * (product.laborDays || 0) * (product.laborDailyRate || 0);
                                                    const extrasTotal = (product.extras || []).reduce((sum, e) => sum + (e.total || 0), 0);
                                                    const unitPrice = (product.Material_Cost || 0) + (product.margin || 0) + extrasTotal + laborTotal;
                                                    
                                                    return (
                                                        <tr key={product.Product_ID} className={product.included ? 'included' : 'excluded'}>
                                                            <td className="text-center" style={{ textAlign: 'center' }}>
                                                                <input
                                                                    type="checkbox"
                                                                    checked={product.included}
                                                                    onChange={(e) => toggleProductIncluded(index, e.target.checked)}
                                                                    className="modern-checkbox"
                                                                />
                                                            </td>
                                                            <td>
                                                                <div className="product-name-cell">
                                                                    <div className="p-title-row">
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
                                                                    {isEditMode && (
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
                                                                    disabled={!product.included}
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
                                                                    disabled={!product.included}
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
                                                                    disabled={!product.included}
                                                                    placeholder="0"
                                                                />
                                                            </td>
                                                            <td className="btn-cell">
                                                                <button 
                                                                    type="button" 
                                                                    className="sheet-btn"
                                                                    onClick={() => openExtrasModal(index)}
                                                                    disabled={!product.included}
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
                                                                        disabled={!product.included}
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
                            display: 'flex',
                            alignItems: 'center',
                            gap: '24px',
                            marginBottom: '24px',
                            background: 'var(--surface)',
                            padding: '12px 20px',
                            borderRadius: '10px',
                            border: '1px solid var(--border-light)',
                            flexWrap: 'wrap'
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span className="material-icons-round" style={{ fontSize: '18px', color: 'var(--accent)' }}>tag</span>
                                <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>{currentOffer.Offer_Number}</span>
                            </div>
                            <div style={{ width: '1px', height: '16px', background: 'var(--border)' }}></div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span className="material-icons-round" style={{ fontSize: '18px', color: 'var(--text-secondary)' }}>person</span>
                                <span style={{ fontSize: '14px', color: 'var(--text-primary)' }}>{currentOffer.Client_Name || '-'}</span>
                            </div>
                            <div style={{ width: '1px', height: '16px', background: 'var(--border)' }}></div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span className="material-icons-round" style={{ fontSize: '18px', color: 'var(--text-secondary)' }}>calendar_today</span>
                                <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                                    <span style={{ marginRight: '4px' }}>Kreirano:</span>
                                    <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{formatDate(currentOffer.Created_Date)}</span>
                                </span>
                            </div>
                            <div style={{ width: '1px', height: '16px', background: 'var(--border)' }}></div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span className="material-icons-round" style={{ fontSize: '18px', color: 'var(--text-secondary)' }}>event_available</span>
                                <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                                    <span style={{ marginRight: '4px' }}>Vrijedi do:</span>
                                    <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{formatDate(currentOffer.Valid_Until)}</span>
                                </span>
                            </div>
                        </div>

                        {/* Products */}
                        <h4 style={{ marginBottom: '12px' }}>Proizvodi</h4>
                        <div style={{ overflowX: 'auto', marginBottom: '24px' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr style={{ background: 'var(--surface)', borderBottom: '2px solid var(--border)' }}>
                                        <th style={{ padding: '12px', textAlign: 'left' }}>Proizvod</th>
                                        <th style={{ padding: '12px', textAlign: 'right' }}>Količina</th>
                                        <th style={{ padding: '12px', textAlign: 'right' }}>Materijal</th>
                                        <th style={{ padding: '12px', textAlign: 'right' }}>Marža</th>
                                        <th style={{ padding: '12px', textAlign: 'right' }}>Rad</th>
                                        <th style={{ padding: '12px', textAlign: 'right' }}>Usluge</th>
                                        <th style={{ padding: '12px', textAlign: 'right' }}>Cijena/kom</th>
                                        <th style={{ padding: '12px', textAlign: 'right' }}>Ukupno</th>
                                    </tr>
                                </thead>
                                <tbody>
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
                                                <tr key={product.ID} style={{ borderBottom: '1px solid var(--border-light)' }}>
                                                    <td style={{ padding: '12px' }}>
                                                        {product.Product_Name}
                                                        {dims && <span style={{ color: 'var(--text-secondary)' }}>, {dims}</span>}
                                                    </td>
                                                    <td style={{ padding: '12px', textAlign: 'right' }}>{product.Quantity}</td>
                                                    <td style={{ padding: '12px', textAlign: 'right' }}>{formatPrice(product.Material_Cost, viewCurrency)}</td>
                                                    <td style={{ padding: '12px', textAlign: 'right' }}>{formatPrice(product.Margin, viewCurrency)}</td>
                                                    <td style={{ padding: '12px', textAlign: 'right' }}>{laborTotal > 0 ? formatPrice(laborTotal, viewCurrency) : '-'}</td>
                                                    <td style={{ padding: '12px', textAlign: 'right' }}>{extrasTotal > 0 ? formatPrice(extrasTotal, viewCurrency) : '-'}</td>
                                                    <td style={{ padding: '12px', textAlign: 'right', fontWeight: 500 }}>{formatPrice(unitPrice, viewCurrency)}</td>
                                                    <td style={{ padding: '12px', textAlign: 'right', fontWeight: 600 }}>{formatPrice(product.Total_Price, viewCurrency)}</td>
                                                </tr>
                                            );
                                        });
                                    })()}
                                </tbody>
                            </table>
                        </div>

                        {/* Totals */}
                        {(() => {
                            const viewCurrency = ((currentOffer as any).Currency || 'KM') as 'KM' | 'EUR';
                            return (
                        <div style={{ background: 'var(--accent-light)', padding: '20px', borderRadius: '12px' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '400px', marginLeft: 'auto' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <span>Suma:</span>
                                    <span>{formatPrice(currentOffer.Subtotal, viewCurrency)}</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <span>Transport:</span>
                                    <span>{formatPrice(currentOffer.Transport_Cost, viewCurrency)}</span>
                                </div>
                                {currentOffer.Onsite_Assembly && (currentOffer.Onsite_Discount || 0) > 0 && (
                                    <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--success)' }}>
                                        <span>Popust:</span>
                                        <span>-{formatPrice(currentOffer.Onsite_Discount, viewCurrency)}</span>
                                    </div>
                                )}
                                {(currentOffer as any).Include_PDV && (() => {
                                    const baseTotal = (currentOffer.Subtotal || 0) + (currentOffer.Transport_Cost || 0) - (currentOffer.Onsite_Assembly ? (currentOffer.Onsite_Discount || 0) : 0);
                                    const rate = (currentOffer as any).PDV_Rate || 17;
                                    return (
                                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <span>PDV ({rate}%):</span>
                                            <span>{formatPrice(baseTotal * rate / 100, viewCurrency)}</span>
                                        </div>
                                    );
                                })()}
                                <hr style={{ border: 'none', borderTop: '1px solid var(--border)' }} />
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '20px', fontWeight: 700 }}>
                                    <span>UKUPNO{(currentOffer as any).Include_PDV ? ' (sa PDV)' : ''}:</span>
                                    <span style={{ color: 'var(--accent)' }}>{formatPrice(
                                        (() => {
                                            const baseTotal = (currentOffer.Subtotal || 0) + (currentOffer.Transport_Cost || 0) - (currentOffer.Onsite_Assembly ? (currentOffer.Onsite_Discount || 0) : 0);
                                            return (currentOffer as any).Include_PDV ? baseTotal * (1 + ((currentOffer as any).PDV_Rate || 17) / 100) : baseTotal;
                                        })(), viewCurrency
                                    )}</span>
                                </div>
                            </div>
                        </div>
                            );
                        })()}

                        {/* Notes */}
                        {currentOffer.Notes && (
                            <div style={{ marginTop: '24px', background: 'var(--surface)', padding: '16px', borderRadius: '12px' }}>
                                <h4 style={{ marginBottom: '8px' }}>Napomene</h4>
                                <p>{currentOffer.Notes}</p>
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
        </div >
    );
}
