// ════════════════════════════════════════════════════════════════════
// PLATNO — EMPIRIJSKI ROKOVI DOBAVLJAČA
//
// Ni `Supplier` ni `Material` nemaju polje za rok isporuke. ALI istorija postoji:
// `Order.Order_Date` → `OrderItem.Received_Date`, koji se stvarno upisuje pri
// prijemu (markMaterialsReceived u lib/database.ts).
//
// Odatle se dobija „Frischeis: 6 dana (5–9, n=12)" — bez ijednog novog unosa.
// Prikaz je UVIJEK uz uzorak; ispod praga se ne nudi podrazumijevana vrijednost
// nego se traži ručni unos. Isti princip kao cijeli sloj profila: nikad broj bez `n`.
// ════════════════════════════════════════════════════════════════════

import type { Order } from '../types';
import { distribution, type Dist } from '../insights/stats';
import { diffDays } from './model';

/** Ispod ovoliko isporuka se ne nudi automatski rok — uzorak ne nosi zaključak. */
export const MIN_LEAD_SAMPLES = 3;
/** Isporuka duža od ovoga je gotovo sigurno greška u podacima, ne stvarni rok. */
const MAX_PLAUSIBLE_LEAD_DAYS = 180;

export interface SupplierLeadTime {
    key: string;          // normalizovan naziv dobavljača
    name: string;         // prikazni naziv (zadnji viđeni)
    dist: Dist;           // rok isporuke u KALENDARSKIM danima
}

const norm = (s: string | undefined) => (s || '').trim().toLowerCase();

/**
 * Rok isporuke po dobavljaču iz istorije narudžbi.
 *
 * Po narudžbi: `max(Received_Date stavki) − Order_Date`, u kalendarskim danima —
 * dobavljač ne poznaje naše radne dane ni subotnju rotaciju.
 * Narudžbe bez ijednog prijema se PRESKAČU (još su na putu, nisu podatak).
 */
export function buildSupplierLeadTimes(orders: Order[]): Map<string, SupplierLeadTime> {
    const samples = new Map<string, { name: string; days: number[] }>();

    for (const order of orders || []) {
        const orderDate = (order.Order_Date || '').split('T')[0];
        if (!orderDate) continue;

        const received = (order.items || [])
            .map(i => (i.Received_Date || '').split('T')[0])
            .filter(Boolean)
            .sort();
        if (received.length === 0) continue;   // još nije stiglo — nije podatak

        // Narudžba je „stigla" kad je stigla ZADNJA stavka
        const lastReceived = received[received.length - 1];
        const days = diffDays(orderDate, lastReceived);
        if (days < 0 || days > MAX_PLAUSIBLE_LEAD_DAYS) continue;   // greška u podacima

        const key = norm(order.Supplier_Name) || norm(order.Supplier_ID) || 'nepoznat';
        const entry = samples.get(key) || { name: order.Supplier_Name || 'Nepoznat dobavljač', days: [] };
        entry.days.push(days);
        if (order.Supplier_Name) entry.name = order.Supplier_Name;
        samples.set(key, entry);
    }

    const out = new Map<string, SupplierLeadTime>();
    for (const [key, entry] of samples) {
        const dist = distribution(entry.days);
        if (dist) out.set(key, { key, name: entry.name, dist });
    }
    return out;
}

export interface LeadSuggestion {
    days: number;
    dist: Dist;
    /** Rečenica za prikaz — nikad broj bez uzorka. */
    label: string;
}

/**
 * Prijedlog roka za dobavljača. `null` ispod praga uzorka — radije ručni unos
 * nego brojka koja se čita kao pouzdana.
 */
export function suggestLeadDays(
    supplierName: string | undefined,
    table: Map<string, SupplierLeadTime>
): LeadSuggestion | null {
    const entry = table.get(norm(supplierName));
    if (!entry || entry.dist.n < MIN_LEAD_SAMPLES) return null;

    const d = entry.dist;
    // Medijan, ne prosjek: jedna zaboravljena narudžba od 60 dana ne smije
    // pomjeriti planiranje svih ostalih.
    const days = Math.max(0, Math.round(d.p50));
    return {
        days,
        dist: d,
        label: `${days} dana (${Math.round(d.p25)}–${Math.round(d.p75)}, n=${d.n})`,
    };
}

/** Svi dobavljači s dovoljno istorije, po pouzdanosti uzorka. */
export function usableLeadTimes(table: Map<string, SupplierLeadTime>): SupplierLeadTime[] {
    return Array.from(table.values())
        .filter(x => x.dist.n >= MIN_LEAD_SAMPLES)
        .sort((a, b) => b.dist.n - a.dist.n || a.name.localeCompare(b.name, 'hr'));
}
