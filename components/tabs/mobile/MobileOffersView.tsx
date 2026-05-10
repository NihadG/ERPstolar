'use client';

import React, { useState, useMemo } from 'react';
import type { Offer, Project } from '@/lib/types';
import { OFFER_STATUSES } from '@/lib/types';
import { formatCurrency, formatDate } from '@/lib/utils';
import { DropdownMenu } from '@/components/ui/DropdownMenu';

interface MobileOffersViewProps {
    offers: Offer[];
    projects: Project[];
    onRefresh: (...collections: string[]) => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
    onOpenCreate: () => void;
    onViewOffer: (offerId: string) => void;
    onEditOffer: (offer: Offer) => void;
    onDeleteOffer: (offerId: string) => void;
    onUpdateStatus: (offerId: string, status: string) => void;
    onDownloadPDF: (offer: Offer) => void;
    onPrintOffer: (offer: Offer) => void;
}

/* ─── Shared Styles ─── */
const S = {
    page: {
        padding: '16px 16px 100px 16px',
        backgroundColor: '#f8fafc',
        minHeight: '100vh',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    } as React.CSSProperties,
    headerSection: { display: 'flex', gap: 12, marginBottom: 16 } as React.CSSProperties,
    searchBar: {
        flex: 1, height: 48, background: 'white', borderRadius: 14,
        display: 'flex', alignItems: 'center', padding: '0 16px',
        boxShadow: '0 2px 10px rgba(0,0,0,0.03)', border: '1px solid #f1f5f9',
    } as React.CSSProperties,
    searchIcon: { color: '#94a3b8', fontSize: 20 } as React.CSSProperties,
    searchInput: {
        border: 'none', background: 'transparent', width: '100%', height: '100%',
        marginLeft: 10, fontSize: 15, outline: 'none', color: '#1e293b',
    } as React.CSSProperties,
    topAddBtn: {
        width: 48, height: 48, background: '#2563eb', color: 'white', border: 'none',
        borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 4px 12px rgba(37,99,235,0.2)', cursor: 'pointer',
    } as React.CSSProperties,
    filtersScroll: {
        display: 'flex', gap: 8, overflowX: 'auto' as const, paddingBottom: 8,
        marginBottom: 16, WebkitOverflowScrolling: 'touch' as const,
        scrollbarWidth: 'none' as const,
    } as React.CSSProperties,
    filterPill: {
        whiteSpace: 'nowrap' as const, padding: '8px 16px', borderRadius: 20,
        border: '1px solid #e2e8f0', background: 'white', color: '#64748b',
        fontSize: 14, fontWeight: 500, transition: 'all 0.2s ease', cursor: 'pointer',
    } as React.CSSProperties,
    filterPillActive: {
        whiteSpace: 'nowrap' as const, padding: '8px 16px', borderRadius: 20,
        border: '1px solid #1e293b', background: '#1e293b', color: 'white',
        fontSize: 14, fontWeight: 500, transition: 'all 0.2s ease', cursor: 'pointer',
    } as React.CSSProperties,
    list: { display: 'flex', flexDirection: 'column' as const, gap: 16 },
    card: {
        background: 'white', borderRadius: 16, padding: 16,
        boxShadow: '0 4px 15px rgba(0,0,0,0.03)', border: '1px solid #f1f5f9',
        transition: 'all 0.3s cubic-bezier(0.4,0,0.2,1)', position: 'relative' as const,
    } as React.CSSProperties,
    titleRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 } as React.CSSProperties,
    offerTitle: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' as const } as React.CSSProperties,
    offerName: { fontSize: 16, fontWeight: 700, color: '#0f172a' } as React.CSSProperties,
    offerNum: { fontSize: 12, color: '#94a3b8', fontWeight: 500 } as React.CSSProperties,
    date: { fontSize: 12, color: '#64748b', background: '#f8fafc', padding: '4px 8px', borderRadius: 8, whiteSpace: 'nowrap' as const } as React.CSSProperties,
    metaRow: { display: 'flex', flexDirection: 'column' as const, gap: 4, margin: '8px 0 16px 0' } as React.CSSProperties,
    metaLine: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#475569' } as React.CSSProperties,
    tinyIcon: { fontSize: 14, color: '#94a3b8' } as React.CSSProperties,
    cardBody: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderTop: '1px solid #f1f5f9', paddingTop: 16 } as React.CSSProperties,
    totalAmount: { fontSize: 18, fontWeight: 700, color: '#0f172a' } as React.CSSProperties,
    statusActions: { display: 'flex', alignItems: 'center', gap: 12 } as React.CSSProperties,
    statusWrapper: { position: 'relative' as const } as React.CSSProperties,
    statusDropdown: {
        position: 'absolute' as const, bottom: '100%', right: 0, marginBottom: 8,
        background: 'white', borderRadius: 12, boxShadow: '0 10px 25px rgba(0,0,0,0.1)',
        border: '1px solid #e2e8f0', overflow: 'hidden', zIndex: 50, minWidth: 140,
        display: 'flex', flexDirection: 'column' as const,
    } as React.CSSProperties,
    statusDDBtn: {
        padding: '12px 16px', textAlign: 'left' as const, background: 'transparent',
        border: 'none', borderBottom: '1px solid #f1f5f9', fontSize: 13, fontWeight: 500, color: '#334155', cursor: 'pointer',
    } as React.CSSProperties,
    quickActions: { display: 'flex', gap: 8 } as React.CSSProperties,
    iconBtnDefault: {
        width: 34, height: 34, borderRadius: 10, display: 'flex', alignItems: 'center',
        justifyContent: 'center', border: 'none', background: '#f1f5f9', color: '#64748b', cursor: 'pointer',
    } as React.CSSProperties,
    empty: { display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', padding: '60px 20px', textAlign: 'center' as const, color: '#94a3b8' } as React.CSSProperties,
    emptyIcon: { fontSize: 48, marginBottom: 16, color: '#cbd5e1' } as React.CSSProperties,
    emptyH3: { fontSize: 18, fontWeight: 600, color: '#475569', marginBottom: 8, margin: 0 } as React.CSSProperties,
    emptyP: { fontSize: 14, margin: 0 } as React.CSSProperties,
    fab: {
        position: 'fixed' as const, bottom: 80, right: 20, width: 56, height: 56,
        borderRadius: 28, background: '#0f172a', color: 'white', border: 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 10px 25px rgba(15,23,42,0.3)', zIndex: 100, cursor: 'pointer',
    } as React.CSSProperties,
    fabIcon: { fontSize: 28 } as React.CSSProperties,
};

export default function MobileOffersView({
    offers,
    projects,
    onRefresh,
    showToast,
    onOpenCreate,
    onViewOffer,
    onEditOffer,
    onDeleteOffer,
    onUpdateStatus,
    onDownloadPDF,
    onPrintOffer
}: MobileOffersViewProps) {
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [statusDropdownOfferId, setStatusDropdownOfferId] = useState<string | null>(null);

    const EUR_RATE = 1.95583;
    const formatPrice = (amount: number, currency: 'KM' | 'EUR' = 'KM') => {
        if (currency === 'EUR') return (amount / EUR_RATE).toFixed(2) + ' €';
        return formatCurrency(amount);
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'Nacrt': return { bg: '#f3f4f6', color: '#6b7280', border: '#d1d5db' };
            case 'Poslano': return { bg: '#dbeafe', color: '#2563eb', border: '#bfdbfe' };
            case 'Prihvaćeno': return { bg: '#dcfce7', color: '#15803d', border: '#bbf7d0' };
            case 'Odbijeno': return { bg: '#fee2e2', color: '#dc2626', border: '#fecaca' };
            case 'Isteklo': return { bg: '#ffedd5', color: '#ea580c', border: '#fed7aa' };
            default: return { bg: '#f3f4f6', color: '#6b7280', border: '#d1d5db' };
        }
    };

    const filteredOffers = useMemo(() => {
        return offers.filter(offer => {
            const matchesSearch = !searchTerm.trim() ||
                offer.Offer_Number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                offer.Client_Name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                offer.Name?.toLowerCase().includes(searchTerm.toLowerCase());
            const matchesStatus = !statusFilter || offer.Status === statusFilter;
            return matchesSearch && matchesStatus;
        }).sort((a, b) => new Date(b.Created_Date || 0).getTime() - new Date(a.Created_Date || 0).getTime());
    }, [offers, searchTerm, statusFilter]);

    return (
        <div style={S.page}>
            {/* Header / Search */}
            <div style={S.headerSection}>
                <div style={S.searchBar}>
                    <span className="material-icons-round" style={S.searchIcon}>search</span>
                    <input
                        style={S.searchInput}
                        type="text"
                        placeholder="Traži ponude, klijente..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                <button style={S.topAddBtn} onClick={onOpenCreate}>
                    <span className="material-icons-round">add</span>
                </button>
            </div>

            {/* Filter Pills */}
            <div style={S.filtersScroll}>
                <button
                    style={statusFilter === '' ? S.filterPillActive : S.filterPill}
                    onClick={() => setStatusFilter('')}
                >Sve</button>
                {OFFER_STATUSES.map(status => (
                    <button
                        key={status}
                        style={statusFilter === status ? S.filterPillActive : S.filterPill}
                        onClick={() => setStatusFilter(status)}
                    >{status}</button>
                ))}
            </div>

            {/* Offers List */}
            <div style={S.list}>
                {filteredOffers.length === 0 ? (
                    <div style={S.empty}>
                        <span className="material-icons-round" style={S.emptyIcon}>request_quote</span>
                        <h3 style={S.emptyH3}>Nema ponuda</h3>
                        <p style={S.emptyP}>Promijenite filtere ili dodajte novu.</p>
                    </div>
                ) : (
                    filteredOffers.map(offer => {
                        const sc = getStatusColor(offer.Status || 'Nacrt');
                        const projectName = projects.find(p => p.Project_ID === offer.Project_ID)?.Client_Name || null;

                        return (
                            <div key={offer.Offer_ID} style={S.card}>
                                {/* Card Header - Trigger View Modal */}
                                <div onClick={() => onViewOffer(offer.Offer_ID)} style={{ cursor: 'pointer' }}>
                                    <div style={S.titleRow}>
                                        <div style={S.offerTitle}>
                                            <span style={S.offerName}>{offer.Name || ('#' + offer.Offer_Number)}</span>
                                            {offer.Name && <span style={S.offerNum}>#{offer.Offer_Number}</span>}
                                        </div>
                                        <div style={S.date}>{formatDate(offer.Created_Date)}</div>
                                    </div>
                                    <div style={S.metaRow}>
                                        <span style={S.metaLine}>
                                            <span className="material-icons-round" style={S.tinyIcon}>person</span>
                                            {offer.Client_Name || 'Nepoznat klijent'}
                                        </span>
                                        {projectName && (
                                            <span style={S.metaLine}>
                                                <span className="material-icons-round" style={S.tinyIcon}>folder</span>
                                                {projectName}
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {/* Card Body */}
                                <div style={S.cardBody}>
                                    <div style={S.totalAmount}>
                                        {formatPrice(offer.Total || 0, ((offer as any).Currency || 'KM') as 'KM' | 'EUR')}
                                    </div>
                                    <div style={S.statusActions}>
                                        <div style={S.statusWrapper}>
                                            <button
                                                style={{
                                                    display: 'flex', alignItems: 'center', gap: 4,
                                                    fontSize: 12, fontWeight: 600, padding: '6px 10px',
                                                    borderRadius: 10, transition: 'all 0.2s', cursor: 'pointer',
                                                    backgroundColor: sc.bg, color: sc.color,
                                                    border: '1px solid ' + sc.border,
                                                }}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setStatusDropdownOfferId(statusDropdownOfferId === offer.Offer_ID ? null : offer.Offer_ID);
                                                }}
                                            >
                                                {offer.Status || 'Nacrt'}
                                                <span className="material-icons-round" style={{ fontSize: 16 }}>expand_more</span>
                                            </button>

                                            {statusDropdownOfferId === offer.Offer_ID && (
                                                <div style={S.statusDropdown}>
                                                    {OFFER_STATUSES.map(ts => (
                                                        <button
                                                            key={ts}
                                                            style={{ ...S.statusDDBtn, color: ts === 'Odbijeno' ? '#ef4444' : ts === 'Prihvaćeno' ? '#15803d' : '#334155' }}
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setStatusDropdownOfferId(null);
                                                                onUpdateStatus(offer.Offer_ID, ts);
                                                            }}
                                                        >{ts}</button>
                                                    ))}
                                                </div>
                                            )}
                                        </div>

                                        <div style={S.quickActions}>
                                            <DropdownMenu trigger={
                                                <button style={S.iconBtnDefault}>
                                                    <span className="material-icons-round">more_vert</span>
                                                </button>
                                            }>
                                                <div className="dropdown-item" onClick={() => onEditOffer(offer)}>
                                                    <span className="material-icons-round" style={{ fontSize: 18 }}>edit</span>
                                                    Uredi
                                                </div>
                                                <div className="dropdown-item" onClick={() => onDownloadPDF(offer)}>
                                                    <span className="material-icons-round" style={{ fontSize: 18 }}>picture_as_pdf</span>
                                                    Preuzmi PDF
                                                </div>
                                                <div className="dropdown-item" onClick={() => onPrintOffer(offer)}>
                                                    <span className="material-icons-round" style={{ fontSize: 18 }}>print</span>
                                                    Printaj
                                                </div>
                                                <div className="dropdown-item danger" onClick={() => onDeleteOffer(offer.Offer_ID)}>
                                                    <span className="material-icons-round" style={{ fontSize: 18 }}>delete</span>
                                                    Obriši
                                                </div>
                                            </DropdownMenu>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            {/* Floating Action Button */}
            <button style={S.fab} onClick={onOpenCreate}>
                <span className="material-icons-round" style={S.fabIcon}>add</span>
            </button>
        </div>
    );
}
