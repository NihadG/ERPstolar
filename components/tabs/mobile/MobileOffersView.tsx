'use client';

// ════════════════════════════════════════════════════════════════════
// PONUDE — mobilni prikaz (lista)
//
// Isti kartični jezik kao Narudžbe i Nalozi. Za razliku od njih, iznos je
// ovdje istaknut: ponuda i jeste dokument o cijeni.
// ════════════════════════════════════════════════════════════════════

import React, { useMemo, useState } from 'react';
import { Plus, FileText, ArrowUpDown, Send } from 'lucide-react';
import type { Offer, Project } from '@/lib/types';
import { OFFER_STATUSES } from '@/lib/types';
import { formatCurrency, formatDate } from '@/lib/utils';
import { daysUntil } from '@/lib/planning';
import MobileOfferDetail, { offerTone } from './MobileOfferDetail';
import {
    MLarge, MSearch, MChips, MSection, MCard, MCardHead, MCardBody, MIcon,
    MPill, MEmpty, MButton, MSheet, MList, MOption,
} from './MobileUI';
import { useMobileSort, sortLabel, type SortKey, type GroupKey } from './useMobileSort';
import './MobileUI.css';

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
    onReviseOffer?: (offer: Offer) => void;
    onCreateWorkOrder?: (offer: Offer) => void;
}

export default function MobileOffersView({
    offers, projects, showToast, onOpenCreate, onEditOffer, onDeleteOffer,
    onUpdateStatus, onDownloadPDF, onPrintOffer, onReviseOffer, onCreateWorkOrder,
}: MobileOffersViewProps) {
    const [search, setSearch] = useState('');
    const [status, setStatus] = useState('');
    const [openId, setOpenId] = useState<string | null>(null);
    const sort = useMobileSort('ponude', 'datum');

    const counts = useMemo(() => {
        const c: Record<string, number> = {};
        for (const o of offers) c[o.Status] = (c[o.Status] || 0) + 1;
        return c;
    }, [offers]);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        const list = offers.filter(o => {
            const client = o.Client_Name || projects.find(p => p.Project_ID === o.Project_ID)?.Client_Name || '';
            const matchQ = !q
                || o.Offer_Number?.toLowerCase().includes(q)
                || o.Name?.toLowerCase().includes(q)
                || client.toLowerCase().includes(q);
            return matchQ && (!status || o.Status === status);
        });
        return sort.apply(list, {
            naziv: o => (o.Name || o.Offer_Number || '').toLowerCase(),
            datum: o => -new Date(o.Created_Date).getTime(),
            vrijednost: o => -(o.Total || 0),
            rok: o => (o.Valid_Until ? new Date(o.Valid_Until).getTime() : Number.MAX_SAFE_INTEGER),
            status: o => o.Status,
        });
    }, [offers, projects, search, status, sort]);

    const groups = useMemo(() => sort.group(filtered, {
        status: o => o.Status,
        klijent: o => o.Client_Name || projects.find(p => p.Project_ID === o.Project_ID)?.Client_Name || 'Bez klijenta',
    }), [filtered, projects, sort]);

    const openOffer = openId ? offers.find(o => o.Offer_ID === openId) : null;

    const renderCard = (offer: Offer) => {
        const client = offer.Client_Name || projects.find(p => p.Project_ID === offer.Project_ID)?.Client_Name;
        const items = (offer.products || []).filter(p => p.Included !== false).length;
        // Istek važenja je jedina vremenska hitnost kod ponude.
        const dd = offer.Status === 'Poslano' && offer.Valid_Until ? daysUntil(offer.Valid_Until) : null;
        const validText = dd === null ? null
            : dd < 0 ? `isteklo prije ${-dd} ${-dd === 1 ? 'dan' : 'dana'}`
                : dd === 0 ? 'ističe danas' : `važi još ${dd} ${dd === 1 ? 'dan' : 'dana'}`;
        const validCls = dd === null ? '' : dd < 0 ? ' late' : dd <= 3 ? ' soon' : '';

        return (
            <MCard key={offer.Offer_ID} onClick={() => setOpenId(offer.Offer_ID)}>
                <MCardHead>
                    <MIcon tone={offerTone(offer.Status)}><FileText size={20} /></MIcon>
                    <MCardBody
                        name={offer.Name || `Ponuda ${offer.Offer_Number}`}
                        meta={<>
                            <MPill tone={offerTone(offer.Status)}>{offer.Status}</MPill>
                            <span>#{offer.Offer_Number}{client ? ` · ${client}` : ''}</span>
                        </>}
                    />
                    <span className="mui-ec-val mui-num">{formatCurrency(offer.Total || 0)}</span>
                </MCardHead>

                <div className="mui-ec-foot">
                    <span className={`mui-barl${validCls}`}>
                        {validText || `${items} ${items === 1 ? 'stavka' : 'stavki'} · ${formatDate(offer.Created_Date)}`}
                    </span>
                    <div className="mui-spacer" />
                    {offer.Status === 'Nacrt' && (
                        <button type="button" className="mui-actbtn"
                            onClick={(e) => { e.stopPropagation(); onUpdateStatus(offer.Offer_ID, 'Poslano'); }}>
                            <Send size={13} style={{ verticalAlign: -2, marginRight: 4 }} />Pošalji
                        </button>
                    )}
                    {offer.Status === 'Poslano' && (
                        <button type="button" className="mui-actbtn green"
                            onClick={(e) => { e.stopPropagation(); onUpdateStatus(offer.Offer_ID, 'Prihvaćeno'); }}>
                            Prihvaćeno
                        </button>
                    )}
                </div>
            </MCard>
        );
    };

    return (
        <div className="mui">
            <MLarge title="Ponude">
                {offers.length} {offers.length === 1 ? 'ponuda' : 'ponuda'}
                {counts['Poslano'] ? ` · ${counts['Poslano']} kod klijenta` : ''}
            </MLarge>

            <div className="mui-stack mui-gap10" style={{ paddingBottom: 4 }}>
                <MSearch value={search} onChange={setSearch} placeholder="Traži ponudu ili klijenta…" />
                <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" className="mui-chip" onClick={sort.open}>
                        <ArrowUpDown size={13} style={{ verticalAlign: -2, marginRight: 5 }} />
                        {sortLabel(sort.sortKey, sort.groupKey)}
                    </button>
                    <div className="mui-spacer" />
                    <button type="button" className="mui-chip on" onClick={onOpenCreate}>
                        <Plus size={14} style={{ verticalAlign: -2, marginRight: 4 }} />Nova
                    </button>
                </div>
            </div>

            <MChips
                value={status}
                onChange={setStatus}
                options={[
                    { id: '', label: 'Sve', count: offers.length },
                    ...OFFER_STATUSES.map(s => ({ id: s, label: s, count: counts[s] || 0 })),
                ]}
            />

            {filtered.length === 0 ? (
                <MEmpty
                    title="Nema ponuda"
                    sub={search || status ? 'Promijeni pretragu ili filter.' : 'Kreiraj prvu ponudu.'}
                >
                    {!search && !status && (
                        <div style={{ width: '100%', paddingTop: 14 }}>
                            <MButton variant="filled" onClick={onOpenCreate}><Plus size={19} /> Nova ponuda</MButton>
                        </div>
                    )}
                </MEmpty>
            ) : groups ? (
                groups.map(g => (
                    <div key={g.key}>
                        <MSection title={g.key} right={<span className="mui-dim">{g.rows.length}</span>} />
                        <div className="mui-elist">{g.rows.map(renderCard)}</div>
                    </div>
                ))
            ) : (
                <div className="mui-elist">{filtered.map(renderCard)}</div>
            )}

            <MSheet open={sort.isOpen} title="Sortiraj i grupiši" onClose={sort.close}>
                <div className="mui-shd"><span>Sortiraj po</span></div>
                <MList>
                    {(['naziv', 'datum', 'vrijednost', 'rok', 'status'] as SortKey[]).map(k => (
                        <MOption key={k} label={sortLabel(k)} selected={sort.sortKey === k} onClick={() => sort.setSortKey(k)} />
                    ))}
                </MList>
                <div className="mui-shd"><span>Grupiši po</span></div>
                <MList>
                    {([null, 'status', 'klijent'] as (GroupKey | null)[]).map(k => (
                        <MOption key={k || 'none'} label={k ? sortLabel(undefined, k) : 'Bez grupisanja'}
                            selected={sort.groupKey === k} onClick={() => sort.setGroupKey(k)} />
                    ))}
                </MList>
            </MSheet>

            {openOffer && (
                <MobileOfferDetail
                    offer={openOffer}
                    projects={projects}
                    onClose={() => setOpenId(null)}
                    showToast={showToast}
                    onEdit={onEditOffer}
                    onDelete={onDeleteOffer}
                    onUpdateStatus={onUpdateStatus}
                    onDownloadPDF={onDownloadPDF}
                    onPrint={onPrintOffer}
                    onRevise={onReviseOffer}
                    onCreateWorkOrder={onCreateWorkOrder}
                />
            )}
        </div>
    );
}
