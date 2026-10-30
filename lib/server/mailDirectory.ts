// ════════════════════════════════════════════════════════════════════
// IMENIK POŠTE NA SERVERU — mail_people/{uid} (lib/email/directory.ts)
//
// Pravi se iz poslane pošte (zadnjih 6 mjeseci, isto skeniranje kao uvoz
// kontakata), obnavlja se jednom sedmično u satu, a ulazna pošta usput
// osvježava ime i datum. Jedan dokument po korisniku — bot ga čita jednim
// pozivom. Pravila: samo Admin SDK.
// ════════════════════════════════════════════════════════════════════

import { adminDb } from './firebaseAdmin';
import { COLLECTIONS } from '@/lib/services/shared/collections';
import { tallyPeople, type MailHeaders, type MailPerson } from '@/lib/email/directory';
import { getMessageMeta, listMessageIds, mapLimit, updateEmailAccount, type EmailAccount } from './gmail';

export const REFRESH_DAYS = 7;
const SENT_SCAN = 250;

const ref = (uid: string) => adminDb().collection(COLLECTIONS.MAIL_PEOPLE).doc(uid);

export async function loadMailPeople(uid: string): Promise<MailPerson[]> {
    const snap = await ref(uid).get();
    return snap.exists ? ((snap.data() as { People?: MailPerson[] }).People || []) : [];
}

async function savePeople(uid: string, people: MailPerson[], now: Date) {
    await ref(uid).set({ UID: uid, People: people, Updated_At: now.toISOString() });
}

export function peopleStale(account: EmailAccount, now: Date): boolean {
    return !account.People_At || now.getTime() - Date.parse(account.People_At) > REFRESH_DAYS * 86_400_000;
}

/** Ponovo iz poslane pošte (zadržava ljude koje je ulazna pošta već dodala). */
export async function refreshMailPeople(account: EmailAccount, now = new Date()): Promise<number> {
    const uid = account.UID;
    const ids = await listMessageIds(uid, 'in:sent newer_than:180d', SENT_SCAN);
    const metas = await mapLimit(ids, 8, id => getMessageMeta(uid, id, ['To', 'Cc']));
    const sent: MailHeaders[] = metas.map(m => ({
        to: m.headers.to || '', cc: m.headers.cc || '', sent: true,
        date: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : '',
    }));
    const prev = await loadMailPeople(uid);
    // Iz poslanih se broji iznova; ranije primljeni (od ljudi kojima nisi pisao u 6 mjeseci) ostaju.
    const fresh = tallyPeople(sent, { own: [account.Email, account.Send_As || ''].filter(Boolean) });
    const known = new Set(fresh.map(p => p.Email));
    const people = [...fresh, ...prev.filter(p => !known.has(p.Email))];
    await savePeople(uid, people, now);
    await updateEmailAccount(uid, { People_At: now.toISOString() });
    return people.length;
}

/** Ulazna pošta: osvježi ime i datum poznatih, dodaj pošiljaoce koje je ERP prepoznao (dobavljač, kontakt, nit). */
export async function notePeople(account: EmailAccount, mails: MailHeaders[], allowSender: (email: string) => boolean, now = new Date()) {
    if (!mails.length) return;
    const prev = await loadMailPeople(account.UID);
    const people = tallyPeople(mails, { own: [account.Email, account.Send_As || ''].filter(Boolean), prev, allowSender });
    await savePeople(account.UID, people, now);
}
