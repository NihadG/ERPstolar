'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import type { Offer, Project, OfferProduct, Product } from '@/lib/types';
import { getOffer, createOfferWithProducts, deleteOffer, updateOfferStatus, saveOffer, updateOfferWithProducts } from '@/lib/database';
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
}

export default function OffersTab({ offers, projects, onRefresh, showToast }: OffersTabProps) {
    const { organizationId } = useData();
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
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

    // Company Info & App Settings (centralized in DataContext)
    const { companyInfo, appSettings } = useData();


    const filteredOffers = offers.filter(offer => {
        const term = searchTerm.toLowerCase();
        const matchesSearch = offer.Offer_Number?.toLowerCase().includes(term) ||
            offer.Client_Name?.toLowerCase().includes(term) ||
            offer.Name?.toLowerCase().includes(term);
        const matchesStatus = !statusFilter || offer.Status === statusFilter;
        return matchesSearch && matchesStatus;
    });

    const EUR_RATE = 1.95583;
    const toEUR = (km: number) => km / EUR_RATE;
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

        // Initialize products with offer-specific fields
        const products: OfferProductState[] = availableProducts.map(p => ({
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
        if (!selectedProjectId) {
            showToast('Odaberite projekat', 'error');
            return;
        }

        const includedProducts = offerProducts.filter(p => p.included);
        if (includedProducts.length === 0) {
            showToast('Označite barem jedan proizvod', 'error');
            return;
        }

        const offerData = {
            Project_ID: selectedProjectId,
            Name: offerName || '',
            Transport_Cost: offerCurrency === 'EUR' ? toEUR(transportCost) : transportCost,
            Onsite_Assembly: onsiteAssembly,
            Onsite_Discount: offerCurrency === 'EUR' ? toEUR(onsiteDiscount) : onsiteDiscount,
            Valid_Until: validUntil,
            Notes: notes,
            Include_PDV: includePDV,
            PDV_Rate: pdvRate,
            Currency: offerCurrency,
            Language: offerLanguage,
            products: offerProducts.map(p => {
                const convMargin = offerCurrency === 'EUR' ? toEUR(p.margin) : p.margin;
                return {
                    Product_ID: p.Product_ID,
                    Product_Name: p.Product_Name,
                    Quantity: p.Quantity,
                    Included: p.included,
                    Material_Cost: offerCurrency === 'EUR' ? toEUR(p.Material_Cost) : p.Material_Cost,
                    Margin: convMargin,
                    Extras: p.extras.map(e => {
                        const convPrice = offerCurrency === 'EUR' ? toEUR(e.price) : e.price;
                        return {
                            ...e,
                            price: convPrice,
                            total: e.qty * convPrice
                        };
                    }),
                    Labor_Workers: p.laborWorkers,
                    Labor_Days: p.laborDays,
                    Labor_Daily_Rate: offerCurrency === 'EUR' ? toEUR(p.laborDailyRate) : p.laborDailyRate
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

                    const products: OfferProductState[] = (fullOffer.products || []).map(p => ({
                        Product_ID: p.Product_ID,
                        Product_Name: p.Product_Name,
                        Quantity: p.Quantity || 1,
                        Height: 0, Width: 0, Depth: 0,
                        Material_Cost: p.Material_Cost || 0,
                        // De-select conflicting products
                        included: p.Included !== false && !conflictIds.has(p.Product_ID),
                        margin: p.Margin || 0,
                        extras: ((p as any).Extras || (p as any).extras || []).map((e: any) => ({
                            name: e.name || e.Name || '',
                            qty: e.qty || e.Qty || 1,
                            unit: e.unit || e.Unit || 'kom',
                            price: e.price || e.Price || 0,
                            total: e.total || e.Total || 0,
                            note: e.note || e.Note || ''
                        })),
                        laborWorkers: (p as any).Labor_Workers || (p as any).laborWorkers || 0,
                        laborDays: (p as any).Labor_Days || (p as any).laborDays || 0,
                        laborDailyRate: (p as any).Labor_Daily_Rate || (p as any).laborDailyRate || 0
                    }));

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

        // Load products from the offer
        const products: OfferProductState[] = (fullOffer.products || []).map(p => ({
            Product_ID: p.Product_ID,
            Product_Name: p.Product_Name,
            Quantity: p.Quantity || 1,
            Height: 0,
            Width: 0,
            Depth: 0,
            Material_Cost: p.Material_Cost || 0,
            included: p.Included !== false,
            margin: p.Margin || 0,
            extras: ((p as any).Extras || (p as any).extras || []).map((e: any) => ({
                name: e.name || e.Name || '',
                qty: e.qty || e.Qty || 1,
                unit: e.unit || e.Unit || 'kom',
                price: e.price || e.Price || 0,
                total: e.total || e.Total || 0,
                note: e.note || e.Note || ''
            })),
            laborWorkers: (p as any).Labor_Workers || (p as any).laborWorkers || 0,
            laborDays: (p as any).Labor_Days || (p as any).laborDays || 0,
            laborDailyRate: (p as any).Labor_Daily_Rate || (p as any).laborDailyRate || 0
        }));

        setOfferProducts(sortProductsByName(products, p => p.Product_Name));
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

        // Currency formatter
        const fmtCurr = (val: number) => {
            if (isEUR) return val.toFixed(2) + ' \u20ac';
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
                    }
                    
                    .page {
                        max-width: 780px;
                        margin: 20px auto;
                        background: white;
                        padding: 48px 44px;
                        box-shadow: 0 1px 8px rgba(0,0,0,0.08);
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
                    
                    /* Footer (hidden) */
                    .footer {
                        display: none;
                    }
                    
                    .footer p {
                        font-size: 11px;
                        color: #999;
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
                        }
                        
                        .print-layout {
                            box-shadow: none;
                        }
                        
                        .print-layout > thead {
                            display: table-header-group;
                        }
                        
                        .print-layout > thead td,
                        .print-layout > tbody > tr > td {
                            padding: 0;
                        }
                        
                        @page {
                            margin: 14mm 12mm;
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
                        
                        .footer {
                            page-break-inside: avoid;
                        }
                    }
                    
                    /* Print table layout for repeating header */
                    .print-layout {
                        width: 100%;
                        border-collapse: collapse;
                        max-width: 780px;
                        margin: 0 auto;
                    }
                    
                    .print-layout > thead td {
                        padding: 0;
                        vertical-align: top;
                    }
                    
                    .print-layout > tbody > tr > td {
                        padding: 0;
                        vertical-align: top;
                    }
                    
                    .header-spacer {
                        height: 8px;
                    }
                </style>
            </head>
            <body>
                <table class="print-layout">
                    <thead>
                        <tr>
                            <td>
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
                                <div class="header-spacer"></div>
                            </td>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td>
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

                                <div class="products-title">${t.products}</div>
                                <table class="products-table">
                                    <thead>
                                        <tr>
                                            <th class="col-num">#</th>
                                            <th class="col-name">${t.name}</th>
                                            <th class="col-qty">${t.qty}</th>
                                            <th class="col-price">${t.price}</th>
                                            <th class="col-total">${t.total}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${products.map((p, i) => `
                                            <tr>
                                                <td class="col-num">${i + 1}</td>
                                                <td>
                                                    <div class="product-name">${p.Product_Name}${(() => { const d = dimLookup[p.Product_ID]; return d && d.Width && d.Height && d.Depth ? `, <span class="product-dims">${d.Width} × ${d.Height} × ${d.Depth} mm</span>` : ''; })()}</div>
                                                </td>
                                                <td class="col-qty">${p.Quantity}</td>
                                                <td class="col-price">${fmtCurr(p.Selling_Price)}</td>
                                                <td class="col-total">${fmtCurr(p.Total_Price)}</td>
                                            </tr>
                                        `).join('')}
                                    </tbody>
                                </table>

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

                                <div class="footer"></div>
                            </td>
                        </tr>
                    </tbody>
                </table>
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
                <div style={{ marginLeft: 'auto' }}>
                    <button className="glass-btn glass-btn-primary" onClick={openCreateModal}>
                        <span className="material-icons-round">add</span>
                        Nova Ponuda
                    </button>
                </div>
            </div>

            <div className="offers-list">
                {filteredOffers.length === 0 ? (
                    <div className="empty-state">
                        <span className="material-icons-round">request_quote</span>
                        <h3>Nema ponuda</h3>
                        <p>Kreirajte prvu ponudu klikom na "Nova Ponuda"</p>
                    </div>
                ) : (
                    filteredOffers.map(offer => (
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
                                <span className="offer-row-amount">{formatCurrency(offer.Total || 0)}</span>

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
                    ))
                )}
            </div>

            {/* Create/Edit Offer Modal */}
            <Modal
                isOpen={createModal}
                onClose={() => {
                    setCreateModal(false);
                    setIsEditMode(false);
                    setCurrentOffer(null);
                }}
                title={isEditMode ? `Uredi Ponudu: ${currentOffer?.Offer_Number || ''}` : 'Nova Ponuda'}
                size="xl"
                footer={
                    <>
                        <button className="btn btn-secondary" onClick={() => {
                            setCreateModal(false);
                            setIsEditMode(false);
                            setCurrentOffer(null);
                        }}>Otkaži</button>
                        <button
                            className="glass-btn glass-btn-primary"
                            onClick={handleSaveOffer}
                            disabled={!selectedProjectId || offerProducts.filter(p => p.included).length === 0}
                        >
                            {isEditMode ? 'Ažuriraj Ponudu' : 'Sačuvaj Ponudu'}
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

                                    {offerProducts.map((product, index) => (
                                        <div
                                            key={product.Product_ID}
                                            className={`offer-product-card ${product.included ? 'included' : ''}`}
                                        >
                                            <div className="offer-product-card-header">
                                                <input
                                                    type="checkbox"
                                                    checked={product.included}
                                                    onChange={(e) => toggleProductIncluded(index, e.target.checked)}
                                                />
                                                <div className="offer-product-info">
                                                    <div className="offer-product-name">{product.Product_Name}</div>
                                                    <div className="offer-product-meta">Količina: {product.Quantity}</div>
                                                </div>
                                                <div className="offer-product-cost">
                                                    <div className="label">Materijal</div>
                                                    <div className="value">{formatCurrency(product.Material_Cost)}</div>
                                                </div>
                                            </div>

                                            {product.included && (
                                                <div className="product-details-card">
                                                    <div className="card-body">
                                                        {/* ROW 1: MARŽA + TROŠKOVI RADA */}
                                                        <div className="top-grid">
                                                            {/* COLUMN 1: MARGIN */}
                                                            <div className="margin-box data-container">
                                                                <span className="section-label">Marža</span>
                                                                <div className="margin-input-wrapper">
                                                                    <input
                                                                        type="number"
                                                                        className="clean-input"
                                                                        value={product.margin || ''}
                                                                        onChange={(e) => updateProductMargin(index, parseFloat(e.target.value) || 0)}
                                                                        min="0"
                                                                        step="10"
                                                                        placeholder="0"
                                                                    />
                                                                    <span className="margin-suffix">KM</span>
                                                                </div>
                                                            </div>

                                                            {/* COLUMN 2: LABOR */}
                                                            <div className="labor-box data-container">
                                                                <span className="section-label">Troškovi Rada</span>
                                                                <div className="labor-grid">
                                                                    <div className="labor-col">
                                                                        <input
                                                                            type="number"
                                                                            className="clean-input"
                                                                            value={product.laborWorkers || ''}
                                                                            onChange={(e) => {
                                                                                const updated = [...offerProducts];
                                                                                updated[index].laborWorkers = e.target.value === '' ? 0 : parseInt(e.target.value);
                                                                                setOfferProducts(updated);
                                                                            }}
                                                                            min="0"
                                                                            placeholder="0"
                                                                        />
                                                                        <span>Radnika</span>
                                                                    </div>
                                                                    <div className="labor-col">
                                                                        <input
                                                                            type="number"
                                                                            className="clean-input"
                                                                            value={product.laborDays || ''}
                                                                            onChange={(e) => {
                                                                                const updated = [...offerProducts];
                                                                                updated[index].laborDays = e.target.value === '' ? 0 : parseInt(e.target.value);
                                                                                setOfferProducts(updated);
                                                                            }}
                                                                            min="0"
                                                                            placeholder="0"
                                                                        />
                                                                        <span>Dana</span>
                                                                    </div>
                                                                    <div className="labor-col">
                                                                        <input
                                                                            type="number"
                                                                            className="clean-input"
                                                                            value={product.laborDailyRate || ''}
                                                                            onChange={(e) => {
                                                                                const updated = [...offerProducts];
                                                                                updated[index].laborDailyRate = e.target.value === '' ? 0 : parseFloat(e.target.value);
                                                                                setOfferProducts(updated);
                                                                            }}
                                                                            min="0"
                                                                            step="10"
                                                                            placeholder="0"
                                                                        />
                                                                        <span>Dnevnica</span>
                                                                    </div>
                                                                    <div className="labor-result">
                                                                        <span className="labor-result-val">
                                                                            {formatCurrency((product.laborWorkers || 0) * (product.laborDays || 0) * (product.laborDailyRate || 0))}
                                                                        </span>
                                                                        <span className="labor-result-label">Ukupno rad</span>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {/* ROW 2: EXTRAS */}
                                                        <div className="extras-section-v2">
                                                            <span className="section-label">Dodatne Usluge</span>
                                                            <div className="extras-wrapper">
                                                                {product.extras.map((extra, ei) => (
                                                                    <div key={ei} className="chip" style={{ cursor: 'pointer' }} onClick={() => openExtrasModal(index, ei)} title="Klikni za uređivanje">
                                                                        <span>{extra.name}</span>
                                                                        <span className="chip-price">{formatCurrency(extra.total)}</span>
                                                                        <button className="chip-remove" type="button" onClick={(e) => { e.stopPropagation(); removeExtra(index, ei); }}>
                                                                            <span className="material-icons-round">close</span>
                                                                        </button>
                                                                    </div>
                                                                ))}
                                                                <button
                                                                    type="button"
                                                                    className="btn-add-extra"
                                                                    onClick={() => openExtrasModal(index)}
                                                                >
                                                                    <span className="material-icons-round">add</span>
                                                                    Dodaj uslugu
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {/* FOOTER: TOTAL */}
                                                    <div className="card-footer">
                                                        <span className="total-label">Ukupna cijena</span>
                                                        <span className="total-amount">{formatCurrency(calculateProductTotal(product))}</span>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Right Column - Settings & Summary */}
                        {offerProducts.length > 0 && (
                            <div className="offer-form-right" style={{ display: 'flex', flexDirection: 'row', gap: '24px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                                {/* Settings - Compact */}
                                <div className="offer-settings-compact" style={{ flex: 1, minWidth: '300px' }}>
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
                                        <th style={{ padding: '12px', textAlign: 'right' }}>Cijena materijala</th>
                                        <th style={{ padding: '12px', textAlign: 'right' }}>Marža</th>
                                        <th style={{ padding: '12px', textAlign: 'right' }}>Ukupno</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(currentOffer.products || []).filter(p => p.Included).map((product) => {
                                        const proj = projects.find(p => p.Project_ID === currentOffer.Project_ID);
                                        const pp = proj?.products?.find(pp => pp.Product_ID === product.Product_ID);
                                        const dims = pp && pp.Width && pp.Height && pp.Depth
                                            ? `${pp.Width} × ${pp.Height} × ${pp.Depth} mm` : null;
                                        return (
                                            <tr key={product.ID} style={{ borderBottom: '1px solid var(--border-light)' }}>
                                                <td style={{ padding: '12px' }}>
                                                    {product.Product_Name}
                                                    {dims && <span style={{ color: 'var(--text-secondary)' }}>, {dims}</span>}
                                                </td>
                                                <td style={{ padding: '12px', textAlign: 'right' }}>{product.Quantity}</td>
                                                <td style={{ padding: '12px', textAlign: 'right' }}>{formatCurrency(product.Material_Cost)}</td>
                                                <td style={{ padding: '12px', textAlign: 'right' }}>{formatCurrency(product.Margin)}</td>
                                                <td style={{ padding: '12px', textAlign: 'right', fontWeight: 600 }}>{formatCurrency(product.Total_Price)}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        {/* Totals */}
                        <div style={{ background: 'var(--accent-light)', padding: '20px', borderRadius: '12px' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '400px', marginLeft: 'auto' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <span>Suma:</span>
                                    <span>{formatCurrency(currentOffer.Subtotal)}</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <span>Transport:</span>
                                    <span>{formatCurrency(currentOffer.Transport_Cost)}</span>
                                </div>
                                {currentOffer.Onsite_Assembly && (currentOffer.Onsite_Discount || 0) > 0 && (
                                    <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--success)' }}>
                                        <span>Popust:</span>
                                        <span>-{formatCurrency(currentOffer.Onsite_Discount)}</span>
                                    </div>
                                )}
                                {(currentOffer as any).Include_PDV && (() => {
                                    const baseTotal = (currentOffer.Subtotal || 0) + (currentOffer.Transport_Cost || 0) - (currentOffer.Onsite_Assembly ? (currentOffer.Onsite_Discount || 0) : 0);
                                    const rate = (currentOffer as any).PDV_Rate || 17;
                                    return (
                                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <span>PDV ({rate}%):</span>
                                            <span>{formatCurrency(baseTotal * rate / 100)}</span>
                                        </div>
                                    );
                                })()}
                                <hr style={{ border: 'none', borderTop: '1px solid var(--border)' }} />
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '20px', fontWeight: 700 }}>
                                    <span>UKUPNO{(currentOffer as any).Include_PDV ? ' (sa PDV)' : ''}:</span>
                                    <span style={{ color: 'var(--accent)' }}>{formatCurrency(
                                        (() => {
                                            const baseTotal = (currentOffer.Subtotal || 0) + (currentOffer.Transport_Cost || 0) - (currentOffer.Onsite_Assembly ? (currentOffer.Onsite_Discount || 0) : 0);
                                            return (currentOffer as any).Include_PDV ? baseTotal * (1 + ((currentOffer as any).PDV_Rate || 17) / 100) : baseTotal;
                                        })()
                                    )}</span>
                                </div>
                            </div>
                        </div>

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
        </div >
    );
}
