'use client';

import { useState, useMemo } from 'react';
import type { Offer, Project, OfferProduct, Product } from '@/lib/types';
import { getOffer, createOfferWithProducts, deleteOffer, updateOfferStatus, saveOffer, updateOfferWithProducts } from '@/lib/database';
import Modal from '@/components/ui/Modal';
import { OFFER_STATUSES } from '@/lib/types';

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
    onRefresh: () => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

export default function OffersTab({ offers, projects, onRefresh, showToast }: OffersTabProps) {
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('');

    // Create Offer Modal State
    const [createModal, setCreateModal] = useState(false);
    const [selectedProjectId, setSelectedProjectId] = useState('');
    const [offerProducts, setOfferProducts] = useState<OfferProductState[]>([]);
    const [transportCost, setTransportCost] = useState(0);
    const [onsiteAssembly, setOnsiteAssembly] = useState(false);
    const [onsiteDiscount, setOnsiteDiscount] = useState(0);
    const [validUntil, setValidUntil] = useState('');
    const [notes, setNotes] = useState('');

    // Extras Modal State
    const [extrasModal, setExtrasModal] = useState(false);
    const [currentProductIndex, setCurrentProductIndex] = useState<number | null>(null);
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

    // Company Info (read from Settings page, stored in localStorage)
    const [companyInfo, setCompanyInfo] = useState({
        name: 'Vaša Firma',
        address: 'Ulica i broj, Grad',
        phone: '+387 XX XXX XXX',
        email: 'info@firma.ba',
        idNumber: '',
        pdvNumber: '',
        website: '',
        logoBase64: '',
        hideNameWhenLogo: false
    });

    // Load company info from localStorage on mount (read-only, managed in Settings)
    useMemo(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('companyInfo');
            if (saved) {
                try {
                    const parsed = JSON.parse(saved);
                    setCompanyInfo(prev => ({ ...prev, ...parsed }));
                } catch (e) { /* ignore */ }
            }
        }
    }, []);

    // App Settings (read from Settings page, stored in localStorage)
    const [appSettings, setAppSettings] = useState({
        currency: 'KM',
        pdvRate: 17,
        offerValidityDays: 14,
        defaultOfferNote: 'Hvala na povjerenju!',
        offerTerms: 'Plaćanje: Avansno ili po dogovoru\nRok isporuke: Po dogovoru nakon potvrde'
    });

    // Load app settings from localStorage on mount
    useMemo(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('appSettings');
            if (saved) {
                try {
                    const parsed = JSON.parse(saved);
                    setAppSettings(prev => ({ ...prev, ...parsed }));
                } catch (e) { /* ignore */ }
            }
        }
    }, []);

    const filteredOffers = offers.filter(offer => {
        const matchesSearch = offer.Offer_Number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            offer.Client_Name?.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesStatus = !statusFilter || offer.Status === statusFilter;
        return matchesSearch && matchesStatus;
    });

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
        setOfferProducts([]);
        setTransportCost(0);
        setOnsiteAssembly(false);
        setOnsiteDiscount(0);
        setValidUntil(getDefaultValidDate());
        setNotes('');
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

        // Initialize products with offer-specific fields
        const products: OfferProductState[] = (project.products || []).map(p => ({
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

        setOfferProducts(products);
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

    function openExtrasModal(productIndex: number) {
        setCurrentProductIndex(productIndex);
        setExtraName('');
        setExtraCustomName('');
        setExtraQty(1);
        setExtraUnit('kom');
        setExtraPrice(0);
        setExtraNote('');
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
        updated[currentProductIndex].extras.push(extra);
        setOfferProducts(updated);

        setExtrasModal(false);
        showToast('Dodatak dodan', 'success');
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
            Transport_Cost: transportCost,
            Onsite_Assembly: onsiteAssembly,
            Onsite_Discount: onsiteDiscount,
            Valid_Until: validUntil,
            Notes: notes,
            products: offerProducts.map(p => ({
                Product_ID: p.Product_ID,
                Product_Name: p.Product_Name,
                Quantity: p.Quantity,
                Included: p.included,
                Material_Cost: p.Material_Cost,
                Margin: p.margin,
                Extras: p.extras,
                Labor_Workers: p.laborWorkers,
                Labor_Days: p.laborDays,
                Labor_Daily_Rate: p.laborDailyRate
            }))
        };

        let result;

        if (isEditMode && currentOffer) {
            // Update existing offer with all products
            result = await updateOfferWithProducts({
                ...offerData,
                Offer_ID: currentOffer.Offer_ID,
                Offer_Number: currentOffer.Offer_Number,
            });

            if (result.success) {
                showToast('Ponuda ažurirana', 'success');
                setCreateModal(false);
                setIsEditMode(false);
                setCurrentOffer(null);
                onRefresh();
            } else {
                showToast(result.message, 'error');
            }
        } else {
            // Create new offer
            result = await createOfferWithProducts(offerData as any);

            if (result.success) {
                showToast('Ponuda kreirana: ' + result.data?.Offer_Number, 'success');
                setCreateModal(false);
                onRefresh();
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

        const offer = await getOffer(offerId);
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

        const result = await deleteOffer(offerId);
        if (result.success) {
            showToast(result.message, 'success');
            onRefresh();
        } else {
            showToast(result.message, 'error');
        }
    }

    async function handleUpdateStatus(offerId: string, status: string) {
        const result = await updateOfferStatus(offerId, status);
        if (result.success) {
            showToast('Status ažuriran', 'success');
            onRefresh();
            // Refresh view modal if open
            if (currentOffer && currentOffer.Offer_ID === offerId) {
                const updated = await getOffer(offerId);
                setCurrentOffer(updated);
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
        const fullOffer = await getOffer(offer.Offer_ID);
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

        setOfferProducts(products);
        setTransportCost(fullOffer.Transport_Cost || 0);
        setOnsiteAssembly(fullOffer.Onsite_Assembly || false);
        setOnsiteDiscount(fullOffer.Onsite_Discount || 0);
        setValidUntil(fullOffer.Valid_Until ? fullOffer.Valid_Until.split('T')[0] : getDefaultValidDate());
        setNotes(fullOffer.Notes || '');
        setCurrentOffer(fullOffer);
    }

    // ============================================
    // PRINT OFFER
    // ============================================

    function handlePrintOffer(offer: Offer) {
        // Calculate prices dynamically (in case stored values are 0)
        // Note: Include all products, filter only if Included is explicitly false
        const productsWithPrices = (offer.products || []).filter(p => p.Included !== false).map(p => {
            const materialCost = p.Material_Cost || 0;
            const margin = p.Margin || 0;
            const extrasTotal = (p.extras || []).reduce((sum: number, e: any) => sum + (e.Total || e.total || 0), 0);
            // Check for labor fields (may be stored with different key names)
            const laborWorkers = (p as any).Labor_Workers || (p as any).laborWorkers || 0;
            const laborDays = (p as any).Labor_Days || (p as any).laborDays || 0;
            const laborRate = (p as any).Labor_Daily_Rate || (p as any).laborDailyRate || 0;
            const laborTotal = laborWorkers * laborDays * laborRate;

            const sellingPrice = materialCost + margin + extrasTotal + laborTotal;
            const totalPrice = sellingPrice * (p.Quantity || 1);

            return {
                ...p,
                Selling_Price: sellingPrice || p.Selling_Price || 0,
                Total_Price: totalPrice || p.Total_Price || 0
            };
        });

        // Recalculate subtotal
        const calculatedSubtotal = productsWithPrices.reduce((sum, p) => sum + p.Total_Price, 0);
        const subtotal = calculatedSubtotal || offer.Subtotal || 0;
        const transport = offer.Transport_Cost || 0;
        const discount = offer.Onsite_Assembly ? (offer.Onsite_Discount || 0) : 0;
        const baseTotal = subtotal + transport - discount;
        const total = baseTotal || offer.Total || 0;

        const products = productsWithPrices;

        const printContent = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>Ponuda ${offer.Offer_Number}</title>
                <style>
                    @import url('https://fonts.googleapis.com/css2?family=SF+Pro+Display:wght@300;400;500;600;700&display=swap');
                    
                    * { margin: 0; padding: 0; box-sizing: border-box; }
                    
                    body { 
                        font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, sans-serif;
                        font-size: 13px;
                        line-height: 1.6;
                        color: #1d1d1f;
                        background: linear-gradient(135deg, #f5f5f7 0%, #ffffff 50%, #f5f5f7 100%);
                        min-height: 100vh;
                        padding: 40px;
                    }
                    
                    .document {
                        max-width: 800px;
                        margin: 0 auto;
                        background: rgba(255, 255, 255, 0.85);
                        backdrop-filter: blur(20px);
                        -webkit-backdrop-filter: blur(20px);
                        border-radius: 24px;
                        border: 1px solid rgba(255, 255, 255, 0.5);
                        box-shadow: 
                            0 4px 24px rgba(0, 0, 0, 0.06),
                            0 1px 2px rgba(0, 0, 0, 0.04),
                            inset 0 1px 0 rgba(255, 255, 255, 0.6);
                        padding: 48px;
                    }
                    
                    /* Header */
                    .header {
                        display: flex;
                        justify-content: space-between;
                        align-items: flex-start;
                        margin-bottom: 40px;
                        padding-bottom: 32px;
                        border-bottom: 1px solid rgba(0, 0, 0, 0.06);
                    }
                    
                    .company-info {
                        display: flex;
                        flex-direction: column;
                        gap: 8px;
                    }
                    
                    .company-logo {
                        max-width: 180px;
                        max-height: 60px;
                        width: auto;
                        height: auto;
                        object-fit: contain;
                    }
                    
                    .company-name {
                        font-size: 22px;
                        font-weight: 700;
                        letter-spacing: -0.3px;
                        color: #1d1d1f;
                        margin: 0;
                    }
                    
                    .company-details {
                        display: flex;
                        flex-direction: column;
                        gap: 2px;
                    }
                    
                    .company-details p {
                        font-size: 11px;
                        color: #86868b;
                        margin: 0;
                    }
                    
                    .document-badge {
                        text-align: right;
                    }
                    
                    .document-badge .badge {
                        display: inline-block;
                        background: linear-gradient(135deg, rgba(0, 113, 227, 0.12) 0%, rgba(0, 113, 227, 0.06) 100%);
                        color: #0071e3;
                        font-size: 11px;
                        font-weight: 600;
                        letter-spacing: 0.5px;
                        text-transform: uppercase;
                        padding: 6px 14px;
                        border-radius: 20px;
                        margin-bottom: 12px;
                    }
                    
                    .document-badge .number {
                        font-size: 24px;
                        font-weight: 600;
                        color: #1d1d1f;
                        letter-spacing: -0.5px;
                    }
                    
                    .document-badge .date {
                        font-size: 12px;
                        color: #86868b;
                        margin-top: 4px;
                    }
                    
                    /* Client Card */
                    .client-card {
                        background: linear-gradient(135deg, rgba(245, 245, 247, 0.8) 0%, rgba(255, 255, 255, 0.6) 100%);
                        border: 1px solid rgba(0, 0, 0, 0.04);
                        border-radius: 16px;
                        padding: 24px;
                        margin-bottom: 32px;
                        text-align: left;
                    }
                    
                    .client-card .label {
                        font-size: 11px;
                        font-weight: 500;
                        color: #86868b;
                        text-transform: uppercase;
                        letter-spacing: 0.5px;
                        margin-bottom: 8px;
                    }
                    
                    .client-card .name {
                        font-size: 18px;
                        font-weight: 600;
                        color: #1d1d1f;
                        margin-bottom: 4px;
                    }
                    
                    .client-card .contact {
                        font-size: 13px;
                        color: #86868b;
                    }
                    
                    /* Products Table */
                    .products-section {
                        margin-bottom: 48px;
                        text-align: left;
                    }
                    
                    .products-section h3 {
                        font-size: 13px;
                        font-weight: 600;
                        color: #1d1d1f;
                        text-transform: uppercase;
                        letter-spacing: 1.5px;
                        margin-bottom: 24px;
                    }
                    
                    .products-section table {
                        width: 100%;
                        border-collapse: collapse;
                        table-layout: fixed;
                    }
                    
                    .products-section th {
                        font-size: 12px;
                        font-weight: 600;
                        color: #6e6e73;
                        text-transform: uppercase;
                        letter-spacing: 0.8px;
                        padding: 16px 14px;
                        border-bottom: 2px solid #e5e5e7;
                        text-align: left;
                    }
                    
                    .products-section th:first-child { width: 50px; text-align: center; }
                    .products-section th:nth-child(2) { width: auto; }
                    .products-section th:nth-child(3) { width: 100px; text-align: center; }
                    .products-section th:nth-child(4) { width: 130px; text-align: right; }
                    .products-section th:nth-child(5) { width: 140px; text-align: right; }
                    
                    .products-section td {
                        padding: 60px 14px;
                        border-bottom: 1px solid #e8e8e8;
                        vertical-align: middle;
                        text-align: left;
                        font-size: 15px;
                        color: #3d3d3d;
                        font-weight: 400;
                        letter-spacing: -0.1px;
                    }
                    
                    .products-section td:first-child { text-align: center; color: #6e6e73; font-size: 14px; }
                    .products-section td:nth-child(3) { text-align: center; color: #5a5a5a; }
                    .products-section td:nth-child(4) { text-align: right; color: #3d3d3d; }
                    .products-section td:nth-child(5) { text-align: right; color: #1d1d1f; font-size: 16px; }
                    
                    .products-section tr:last-child td { border-bottom: none; }
                    
                    .products-section .product-name {
                        font-weight: 500;
                        font-size: 16px;
                        color: #2d2d2d;
                        letter-spacing: -0.2px;
                    }
                    
                    .totals-card {
                        background: linear-gradient(135deg, rgba(0, 113, 227, 0.08) 0%, rgba(0, 113, 227, 0.03) 100%);
                        backdrop-filter: blur(10px);
                        border: 1px solid rgba(0, 113, 227, 0.1);
                        border-radius: 14px;
                        padding: 18px 20px;
                        width: 280px;
                        flex-shrink: 0;
                    }
                    
                    .totals-row {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        padding: 6px 0;
                        font-size: 12px;
                    }
                    
                    .totals-row .label {
                        color: #86868b;
                    }
                    
                    .totals-row .value {
                        font-weight: 500;
                        color: #1d1d1f;
                    }
                    
                    .totals-row.discount {
                        background: linear-gradient(135deg, rgba(52, 199, 89, 0.15) 0%, rgba(52, 199, 89, 0.05) 100%);
                        margin: 6px -12px;
                        padding: 8px 12px;
                        border-radius: 8px;
                        font-size: 11px;
                    }
                    
                    .totals-row.discount .label,
                    .totals-row.discount .value {
                        color: #34c759;
                        font-weight: 500;
                    }
                    
                    .totals-row.total {
                        margin-top: 10px;
                        padding-top: 12px;
                        border-top: 1px solid rgba(0, 113, 227, 0.15);
                    }
                    
                    .totals-row.total .label {
                        font-size: 12px;
                        font-weight: 500;
                        color: #1d1d1f;
                    }
                    
                    .totals-row.total .value {
                        font-size: 18px;
                        font-weight: 700;
                        color: #0071e3;
                        letter-spacing: -0.3px;
                    }
                    
                    /* Summary Row - Notes + Totals side by side */
                    .summary-row {
                        display: flex;
                        gap: 32px;
                        margin-bottom: 32px;
                        align-items: flex-start;
                    }
                    
                    /* Notes */
                    .notes-card {
                        flex: 1;
                        background: linear-gradient(135deg, rgba(255, 149, 0, 0.08) 0%, rgba(255, 149, 0, 0.03) 100%);
                        border: 1px solid rgba(255, 149, 0, 0.12);
                        border-radius: 16px;
                        padding: 20px 24px;
                    }
                    
                    .notes-card h4 {
                        font-size: 11px;
                        font-weight: 600;
                        color: #bf6c00;
                        text-transform: uppercase;
                        letter-spacing: 0.5px;
                        margin-bottom: 8px;
                    }
                    
                    .notes-card p {
                        color: #1d1d1f;
                        font-size: 13px;
                    }
                    
                    /* Terms */
                    .terms-section {
                        margin-bottom: 40px;
                        text-align: left;
                    }
                    
                    .terms-section h4 {
                        font-size: 11px;
                        font-weight: 500;
                        color: #86868b;
                        text-transform: uppercase;
                        letter-spacing: 0.5px;
                        margin-bottom: 12px;
                    }
                    
                    .terms-section ul {
                        list-style: none;
                        padding: 0;
                    }
                    
                    .terms-section li {
                        position: relative;
                        padding-left: 20px;
                        margin-bottom: 8px;
                        font-size: 12px;
                        color: #1d1d1f;
                    }
                    
                    .terms-section li::before {
                        content: '';
                        position: absolute;
                        left: 0;
                        top: 7px;
                        width: 5px;
                        height: 5px;
                        background: #0071e3;
                        border-radius: 50%;
                    }
                    
                    /* Signatures */
                    .signatures {
                        display: flex;
                        justify-content: space-between;
                        gap: 48px;
                        margin-top: 60px;
                    }
                    
                    .signature-block {
                        flex: 1;
                        text-align: center;
                    }
                    
                    .signature-line {
                        height: 1px;
                        background: linear-gradient(90deg, transparent, rgba(0, 0, 0, 0.15), transparent);
                        margin-bottom: 12px;
                    }
                    
                    .signature-label {
                        font-size: 11px;
                        color: #86868b;
                        text-transform: uppercase;
                        letter-spacing: 0.5px;
                    }
                    
                    /* Footer */
                    .footer {
                        text-align: center;
                        margin-top: 48px;
                        padding-top: 24px;
                        border-top: 1px solid rgba(0, 0, 0, 0.04);
                    }
                    
                    .footer p {
                        font-size: 13px;
                        color: #86868b;
                        font-weight: 500;
                    }
                    
                    /* Print Styles */
                    @media print {
                        body {
                            background: white;
                            padding: 0;
                        }
                        
                        .document {
                            box-shadow: none;
                            border: none;
                            background: white;
                            padding: 0;
                            border-radius: 0;
                        }
                        
                        /* Repeating header on each page */
                        .print-table {
                            width: 100%;
                        }
                        
                        .print-table thead {
                            display: table-header-group;
                        }
                        
                        .print-table tfoot {
                            display: table-footer-group;
                        }
                        
                        .print-header-row td {
                            padding-bottom: 20px;
                        }
                        
                        @page {
                            margin: 15mm;
                        }
                    }
                    
                    /* Print Table Structure */
                    .print-table {
                        width: 100%;
                        border-collapse: collapse;
                    }
                    
                    .print-table > thead td,
                    .print-table > tfoot td,
                    .print-table > tbody td {
                        padding: 0;
                        text-align: left;
                    }
                    
                    .print-table > tbody > tr > td {
                        vertical-align: top;
                        text-align: left;
                    }
                    
                    .print-header-content {
                        display: flex;
                        justify-content: space-between;
                        align-items: flex-start;
                        padding-bottom: 24px;
                        border-bottom: 1px solid rgba(0, 0, 0, 0.06);
                        margin-bottom: 16px;
                    }
            </style>
            </head>
            <body>
                <table class="print-table">
                    <thead>
                        <tr class="print-header-row">
                            <td>
                                <div class="print-header-content">
                                    <div class="company-info">
                                        ${companyInfo.logoBase64 ? `<img class="company-logo" src="${companyInfo.logoBase64}" alt="${companyInfo.name}" />` : ''}
                                        ${(!companyInfo.logoBase64 || !companyInfo.hideNameWhenLogo) ? `<h1 class="company-name">${companyInfo.name}</h1>` : ''}
                                        <div class="company-details">
                                            <p>${companyInfo.address}</p>
                                            <p>${[companyInfo.phone, companyInfo.email].filter(Boolean).join(' · ')}</p>
                                            ${companyInfo.idNumber || companyInfo.pdvNumber ? `<p style="margin-top: 4px; font-size: 10px; color: #a1a1a6;">${[companyInfo.idNumber ? 'ID: ' + companyInfo.idNumber : '', companyInfo.pdvNumber ? 'PDV: ' + companyInfo.pdvNumber : ''].filter(Boolean).join(' | ')}</p>` : ''}
                                        </div>
                                    </div>
                                    <div class="document-badge">
                                        <div class="badge">Ponuda</div>
                                        <div class="number">${offer.Offer_Number}</div>
                                        <div class="date">${formatDate(offer.Created_Date)}</div>
                                    </div>
                                </div>
                            </td>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td>
                                <div class="document">
                                    <div class="client-card">
                                        <div class="label">Kupac</div>
                                        <div class="name">${offer.Client_Name || '-'}</div>
                                        ${(offer as any).Client_Address ? `<div class="contact" style="margin-bottom: 2px;">${(offer as any).Client_Address}</div>` : ''}
                                        <div class="contact">${[offer.Client_Phone, offer.Client_Email].filter(Boolean).join(' · ') || '-'}</div>
                                    </div>

                                    <div class="products-section">
                                        <h3>Proizvodi</h3>
                                        <table>
                                            <thead>
                                                <tr>
                                                    <th>#</th>
                                                    <th>Naziv</th>
                                                    <th>Količina</th>
                                                    <th>Cijena</th>
                                                    <th>Ukupno</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                ${products.map((p, i) => `
                                                    <tr>
                                                        <td>${i + 1}</td>
                                                        <td class="product-name">${p.Product_Name}</td>
                                                        <td class="product-qty">${p.Quantity}</td>
                                                        <td class="product-price">${formatCurrency(p.Selling_Price)}</td>
                                                        <td class="product-total">${formatCurrency(p.Total_Price)}</td>
                                                    </tr>
                                                `).join('')}
                                            </tbody>
                                        </table>
                                    </div>

                                    <div class="summary-row">
                                        <div class="notes-card">
                                            <h4>Napomena</h4>
                                            <p>Ponuda vrijedi do: <strong>${formatDate(offer.Valid_Until)}</strong></p>
                                            <p>Plaćanje: Avansno ili po dogovoru</p>
                                            <p>Rok isporuke: Po dogovoru nakon potvrde</p>
                                            ${offer.Notes ? `<p style="margin-top: 12px;">${offer.Notes}</p>` : ''}
                                        </div>
                                        <div class="totals-card">
                                            <div class="totals-row">
                                                <span class="label">Međuzbroj</span>
                                                <span class="value">${formatCurrency(subtotal)}</span>
                                            </div>
                                            ${transport > 0 ? `
                                                <div class="totals-row">
                                                    <span class="label">Transport</span>
                                                    <span class="value">${formatCurrency(transport)}</span>
                                                </div>
                                            ` : ''}
                                            ${offer.Onsite_Assembly ? `
                                                <div class="totals-row discount">
                                                    <span class="label">Popust (sklapanje na licu mjesta)</span>
                                                    <span class="value">-${formatCurrency(discount)}</span>
                                                </div>
                                            ` : ''}
                                            ${includePDV ? `
                                                <div class="totals-row">
                                                    <span class="label">PDV (${pdvRate}%)</span>
                                                    <span class="value">${formatCurrency(total * pdvRate / 100)}</span>
                                                </div>
                                            ` : ''}
                                            <div class="totals-row total">
                                                <span class="label">Ukupno${includePDV ? ' (sa PDV)' : ''}</span>
                                                <span class="value">${formatCurrency(includePDV ? total * (1 + pdvRate / 100) : total)}</span>
                                            </div>
                                        </div>
                                    </div>



                                    <div class="signatures">
                                        <div class="signature-block">
                                            <div class="signature-line"></div>
                                            <div class="signature-label">Ponuđač</div>
                                        </div>
                                        <div class="signature-block">
                                            <div class="signature-line"></div>
                                            <div class="signature-label">Naručilac</div>
                                        </div>
                                    </div>

                                    <div class="footer">
                                        <p>Hvala na povjerenju</p>
                                    </div>
                                </div>
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
            <div className="content-header">
                <div className="search-box">
                    <span className="material-icons-round">search</span>
                    <input
                        type="text"
                        placeholder="Pretraži ponude..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                <select
                    className="filter-select"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                >
                    <option value="">Svi statusi</option>
                    {OFFER_STATUSES.map(status => (
                        <option key={status} value={status}>{status}</option>
                    ))}
                </select>
                <button className="btn btn-primary" onClick={openCreateModal}>
                    <span className="material-icons-round">add</span>
                    Nova Ponuda
                </button>
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
                        <div key={offer.Offer_ID} className="offer-card">
                            <div className="offer-card-header">
                                <div className="offer-card-info">
                                    <div className="offer-number">{offer.Offer_Number}</div>
                                    <div className="offer-client">{offer.Client_Name || 'Nepoznat klijent'}</div>
                                    <div className="offer-date">Kreirano: {formatDate(offer.Created_Date)}</div>
                                </div>
                                <div className="offer-card-price">
                                    <div className="price-label">Ukupno</div>
                                    <div className="price-value">{formatCurrency(offer.Total || 0)}</div>
                                </div>
                            </div>

                            <div className="offer-card-footer">
                                {/* Quick Status Dropdown */}
                                <div className="status-dropdown">
                                    <select
                                        value={offer.Status || 'Nacrt'}
                                        onChange={(e) => handleUpdateStatus(offer.Offer_ID, e.target.value)}
                                        className={`status-select ${getStatusClass(offer.Status)}`}
                                    >
                                        {OFFER_STATUSES.map(status => (
                                            <option key={status} value={status}>{status}</option>
                                        ))}
                                    </select>
                                </div>

                                {/* Action Buttons */}
                                <div className="offer-actions">
                                    <button
                                        className="btn btn-sm btn-secondary"
                                        onClick={() => openViewModal(offer.Offer_ID)}
                                        title="Pregledaj ponudu"
                                    >
                                        <span className="material-icons-round">visibility</span>
                                    </button>
                                    <button
                                        className="btn btn-sm btn-secondary"
                                        onClick={() => openEditModal(offer)}
                                        title="Uredi ponudu"
                                    >
                                        <span className="material-icons-round">edit</span>
                                    </button>
                                    <button
                                        className="btn btn-sm btn-secondary"
                                        onClick={() => handlePrintOffer(offer)}
                                        title="Štampaj ponudu"
                                    >
                                        <span className="material-icons-round">print</span>
                                    </button>
                                    <button
                                        className="btn btn-sm btn-danger"
                                        onClick={() => handleDeleteOffer(offer.Offer_ID)}
                                        title="Obriši ponudu"
                                    >
                                        <span className="material-icons-round">delete</span>
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
                size="large"
                footer={
                    <>
                        <button className="btn btn-secondary" onClick={() => {
                            setCreateModal(false);
                            setIsEditMode(false);
                            setCurrentOffer(null);
                        }}>Otkaži</button>
                        <button
                            className="btn btn-primary"
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
                            {/* Project Selector */}
                            <div className="offer-project-select">
                                <label>Odaberi Projekat</label>
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
                                                                        value={product.margin}
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
                                                                            value={product.laborWorkers}
                                                                            onChange={(e) => {
                                                                                const updated = [...offerProducts];
                                                                                updated[index].laborWorkers = parseInt(e.target.value) || 0;
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
                                                                            value={product.laborDays}
                                                                            onChange={(e) => {
                                                                                const updated = [...offerProducts];
                                                                                updated[index].laborDays = parseInt(e.target.value) || 0;
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
                                                                            value={product.laborDailyRate}
                                                                            onChange={(e) => {
                                                                                const updated = [...offerProducts];
                                                                                updated[index].laborDailyRate = parseFloat(e.target.value) || 0;
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
                                                                    <div key={ei} className="chip">
                                                                        <span>{extra.name}</span>
                                                                        <span className="chip-price">{formatCurrency(extra.total)}</span>
                                                                        <button className="chip-remove" type="button" onClick={() => removeExtra(index, ei)}>
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
                                            rows={2}
                                            placeholder="Dodatne napomene za ponudu..."
                                        />
                                    </div>
                                </div>

                                {/* Summary */}
                                <div className="offer-summary">
                                    <div className="offer-summary-rows">
                                        <div className="offer-summary-row">
                                            <span className="label">Proizvodi</span>
                                            <span className="value">{formatCurrency(totals.subtotal)}</span>
                                        </div>
                                        {totals.transport > 0 && (
                                            <div className="offer-summary-row">
                                                <span className="label">Transport</span>
                                                <span className="value">{formatCurrency(totals.transport)}</span>
                                            </div>
                                        )}
                                        {totals.discount > 0 && (
                                            <div className="offer-summary-row discount">
                                                <span className="label">Popust</span>
                                                <span className="value">-{formatCurrency(totals.discount)}</span>
                                            </div>
                                        )}
                                        {includePDV && totals.pdvAmount > 0 && (
                                            <div className="offer-summary-row pdv">
                                                <span className="label">PDV ({pdvRate}%)</span>
                                                <span className="value">{formatCurrency(totals.pdvAmount)}</span>
                                            </div>
                                        )}
                                        <div className="offer-summary-divider" />
                                        <div className="offer-summary-row total">
                                            <span className="label">UKUPNO</span>
                                            <span className="value">{formatCurrency(totals.total)}</span>
                                        </div>
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
                title="Dodaj Uslugu/Dodatak"
                zIndex={2000}
                footer={
                    <>
                        <button className="btn btn-secondary" onClick={() => setExtrasModal(false)}>Otkaži</button>
                        <button className="btn btn-primary" onClick={addExtraToProduct}>Dodaj</button>
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
                        {/* Offer Info */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '24px' }}>
                            <div style={{ background: 'var(--surface)', padding: '16px', borderRadius: '8px' }}>
                                <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Broj ponude</div>
                                <div style={{ fontSize: '18px', fontWeight: 600 }}>{currentOffer.Offer_Number}</div>
                            </div>
                            <div style={{ background: 'var(--surface)', padding: '16px', borderRadius: '8px' }}>
                                <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Datum kreiranja</div>
                                <div style={{ fontSize: '18px', fontWeight: 600 }}>{formatDate(currentOffer.Created_Date)}</div>
                            </div>
                            <div style={{ background: 'var(--surface)', padding: '16px', borderRadius: '8px' }}>
                                <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Vrijedi do</div>
                                <div style={{ fontSize: '18px', fontWeight: 600 }}>{formatDate(currentOffer.Valid_Until)}</div>
                            </div>
                        </div>

                        {/* Client Info */}
                        <div style={{ background: 'var(--surface)', padding: '16px', borderRadius: '12px', marginBottom: '24px' }}>
                            <h4 style={{ marginBottom: '12px' }}>Podaci o klijentu</h4>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
                                <div><span className="material-icons-round" style={{ fontSize: '16px', marginRight: '8px', verticalAlign: 'middle' }}>person</span>{currentOffer.Client_Name || '-'}</div>
                                <div><span className="material-icons-round" style={{ fontSize: '16px', marginRight: '8px', verticalAlign: 'middle' }}>phone</span>{currentOffer.Client_Phone || '-'}</div>
                                <div><span className="material-icons-round" style={{ fontSize: '16px', marginRight: '8px', verticalAlign: 'middle' }}>email</span>{currentOffer.Client_Email || '-'}</div>
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
                                    {(currentOffer.products || []).filter(p => p.Included).map((product) => (
                                        <tr key={product.ID} style={{ borderBottom: '1px solid var(--border-light)' }}>
                                            <td style={{ padding: '12px' }}>{product.Product_Name}</td>
                                            <td style={{ padding: '12px', textAlign: 'right' }}>{product.Quantity}</td>
                                            <td style={{ padding: '12px', textAlign: 'right' }}>{formatCurrency(product.Material_Cost)}</td>
                                            <td style={{ padding: '12px', textAlign: 'right' }}>{formatCurrency(product.Margin)}</td>
                                            <td style={{ padding: '12px', textAlign: 'right', fontWeight: 600 }}>{formatCurrency(product.Total_Price)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Totals */}
                        <div style={{ background: 'var(--accent-light)', padding: '20px', borderRadius: '12px' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '400px', marginLeft: 'auto' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <span>Međuzbroj:</span>
                                    <span>{formatCurrency(currentOffer.Subtotal)}</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <span>Transport:</span>
                                    <span>{formatCurrency(currentOffer.Transport_Cost)}</span>
                                </div>
                                {currentOffer.Onsite_Assembly && (
                                    <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--success)' }}>
                                        <span>Popust:</span>
                                        <span>-{formatCurrency(currentOffer.Onsite_Discount)}</span>
                                    </div>
                                )}
                                <hr style={{ border: 'none', borderTop: '1px solid var(--border)' }} />
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '20px', fontWeight: 700 }}>
                                    <span>UKUPNO:</span>
                                    <span style={{ color: 'var(--accent)' }}>{formatCurrency(currentOffer.Total)}</span>
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
