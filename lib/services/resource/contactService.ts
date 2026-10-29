/**
 * contactService.ts — Kontakti (ljudi iza dobavljača, klijenata i gradilišta)
 *
 * Isti obrazac kao supplierService: klijentski Firestore, svaki upit je
 * ograničen na organizaciju. Čista logika (uvoz, izbor primaoca) je u
 * lib/contacts.ts.
 */

import { COLLECTIONS } from '../shared/collections';
import { queryByOrg, findRef, createDoc, updateDocByRef, deleteDocByRef } from '../shared/firestoreClient';
import { deleteField } from 'firebase/firestore';
import { v4 as uuidv4 } from 'uuid';
import type { Contact, Project } from '../../types';
import { normalizeEmail, type ProjectContactSource } from '../../contacts';

export async function getContacts(organizationId: string): Promise<Contact[]> {
    return queryByOrg<Contact>(COLLECTIONS.CONTACTS, organizationId);
}

/** Polja koja forma može isprazniti — pri izmjeni se tada brišu iz dokumenta (undefined se inače samo preskoči). */
const CLEARABLE = ['Supplier_ID', 'Company', 'Role', 'Phone', 'Notes', 'Is_Default', 'Address_Form', 'Copy_On', 'Receive_Only', 'Project_Roles'] as const;

/** Čisti polja prije upisa: adresa malim slovima, trim; pri izmjeni isprazni polja brišu. */
function cleaned(data: Partial<Contact>, forUpdate = false): Record<string, unknown> {
    const out: Record<string, unknown> = { ...data };
    if (forUpdate) for (const key of CLEARABLE) if (key in data && data[key] === undefined) out[key] = deleteField();
    if (typeof data.Email === 'string') out.Email = normalizeEmail(data.Email);
    for (const key of ['First_Name', 'Last_Name', 'Company', 'Role', 'Phone', 'Notes'] as const) {
        if (typeof data[key] === 'string') out[key] = (data[key] as string).trim();
    }
    return out;
}

export async function saveContact(
    data: Partial<Contact>,
    organizationId: string,
): Promise<{ success: boolean; data?: { Contact_ID: string }; message: string }> {
    if (!organizationId) return { success: false, message: 'Organization ID is required' };
    const email = normalizeEmail(data.Email || '');
    if (!email) return { success: false, message: 'Unesite email adresu' };

    try {
        const isNew = !data.Contact_ID;
        if (isNew) {
            const record = {
                ...cleaned(data),
                Contact_ID: uuidv4(),
                Organization_ID: organizationId,
                Kind: data.Kind || 'other',
                First_Name: (data.First_Name || '').trim(),
                Last_Name: (data.Last_Name || '').trim(),
                Created_At: new Date().toISOString(),
            };
            await createDoc(COLLECTIONS.CONTACTS, record);
            return { success: true, data: { Contact_ID: record.Contact_ID }, message: 'Kontakt dodan' };
        }
        const ref = await findRef(COLLECTIONS.CONTACTS, 'Contact_ID', data.Contact_ID!, organizationId);
        if (ref) {
            const { Organization_ID, ...updateData } = cleaned(data, true);
            await updateDocByRef(ref, updateData);
        }
        return { success: true, data: { Contact_ID: data.Contact_ID! }, message: 'Kontakt ažuriran' };
    } catch (error) {
        console.error('saveContact error:', error);
        return { success: false, message: 'Greška pri spremanju kontakta' };
    }
}

/** Uvoz više kontakata odjednom (npr. iz dobavljača i projekata). */
export async function saveContacts(
    list: Partial<Contact>[],
    organizationId: string,
): Promise<{ success: boolean; saved: number; message: string }> {
    if (!organizationId) return { success: false, saved: 0, message: 'Organization ID is required' };
    let saved = 0;
    for (const item of list) {
        const result = await saveContact({ ...item, Contact_ID: undefined }, organizationId);
        if (result.success) saved++;
    }
    return { success: saved === list.length, saved, message: `Uvezeno kontakata: ${saved}` };
}

export async function deleteContact(
    contactId: string,
    organizationId: string,
): Promise<{ success: boolean; message: string }> {
    if (!organizationId) return { success: false, message: 'Organization ID is required' };
    try {
        const ref = await findRef(COLLECTIONS.CONTACTS, 'Contact_ID', contactId, organizationId);
        if (ref) await deleteDocByRef(ref);
        return { success: true, message: 'Kontakt obrisan' };
    } catch (error) {
        console.error('deleteContact error:', error);
        return { success: false, message: 'Greška pri brisanju kontakta' };
    }
}

/** Samo polja projekta potrebna za uvoz kontakata — `getProjects` povlači i proizvode, materijale i ponude. */
export async function getProjectContactSources(organizationId: string): Promise<ProjectContactSource[]> {
    const projects = await queryByOrg<Project>(COLLECTIONS.PROJECTS, organizationId);
    return projects.map(p => ({
        Project_ID: p.Project_ID, Name: p.Name, Client_Name: p.Client_Name,
        Client_Email: p.Client_Email, Client_Phone: p.Client_Phone, Hidden: p.Hidden,
    }));
}
