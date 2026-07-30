// ════════════════════════════════════════════════════════════════════
// ORGANIZACIJA TEKUĆE SESIJE — obavezan uslov svakog upita
//
// firestore.rules štite gotovo svaku kolekciju preko `isOrgMember()`, koji traži
// `resource.data.Organization_ID == <org iz tokena>`.
//
// PRAVILA NISU FILTER. Firestore odbija `getDocs` koji ne može UNAPRIJED dokazati
// da svi rezultati zadovoljavaju pravilo — dakle upit bez `where('Organization_ID',
// '==', ...)` puca s `permission-denied`, iako korisnik ima svako pravo na te
// dokumente. Greška pritom nosi ime vanjske funkcije, a ne upita koji je kriv, pa
// se lako pomisli da su pravila ili claimovi pokvareni.
//
// Mnoge funkcije u lib/ organizaciju ne primaju (helperi koji traže dokument po
// ID-u), a provlačenje kroz desetine potpisa bilo bi veliko i rizično. Zato
// AuthContext ovdje ostavi organizaciju prijavljenog korisnika, a upiti je odatle
// uzmu kad je nemaju bliže pri ruci.
// ════════════════════════════════════════════════════════════════════

import { where, type QueryConstraint } from 'firebase/firestore';

let currentOrgId: string | null = null;

/** Postavlja AuthContext kad se učita organizacija; `null` pri odjavi. */
export function setCurrentOrgId(orgId: string | null | undefined): void {
    currentOrgId = orgId || null;
}

export function getCurrentOrgId(): string | null {
    return currentOrgId;
}

/**
 * Uslov organizacije za upit; `explicit` ima prednost kad ga pozivalac zna.
 *
 * Baca ako organizacija nije poznata — bez nje bi Firestore ionako odbio upit,
 * samo porukom koja ne kaže zašto. Bolje puknuti na uzroku nego na posljedici.
 */
export function orgConstraint(explicit?: string | null): QueryConstraint {
    const id = explicit || currentOrgId;
    if (!id) {
        throw new Error(
            'Organizacija nije poznata — upit bi bio odbijen (firestore.rules traže Organization_ID).'
        );
    }
    return where('Organization_ID', '==', id);
}
