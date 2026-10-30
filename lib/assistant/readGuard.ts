// ════════════════════════════════════════════════════════════════════
// NEMA ODGOVORA BEZ ČITANJA ERP-a (čisto)
//
// Iz dnevnika (30.10.): „Koji iveral smo koristili (koji dekor)" → „Nemam
// zapisan dekor", a dekor je u sastavnici. Model je odgovorio iz glave.
//
// Pravilo: pitanje o podacima (materijal, narudžba, nalog, rad, rokovi…) ili
// odgovor tipa „nemam / ne vidim / nisam siguran" — a model nije pozvao nijedan
// alat za čitanje → još jedan krug, samo s alatima za čitanje i obavezan poziv.
// Jednom po poruci. Zadaci, podsjetnici i bilježnica su već u promptu, pa
// pitanja o njima ne traže čitanje.
// ════════════════════════════════════════════════════════════════════

import { foldText } from '@/lib/voice/text';

/** Odgovor „nemam podatak": bez čitanja je to pogađanje. */
export const NO_DATA = /\b(nemam|ne znam|nije zapisan\w*|nisam nasao|nisam pronasao|ne vidim|nema podatak\w*|nema evidencij\w*|nemam evidencij\w*|nisam siguran|ne mogu (sigurno )?(odrediti|reci|znati)|ne pokazuje)\b/;

/** Pitanje traži podatke iz ERP-a (sastavnica, narudžbe, nalozi, Knjiga rada, isporuke). */
const DATA_TERMS = /\b(iveral\w*|dekor\w*|materijal\w*|kant\w*|mdf|hdf|furnir\w*|lak\w*|okov\w*|sark\w*|vodilic\w*|ladic\w*|ogledal\w*|stakl\w*|ploc\w*|narudzb\w*|narucen\w*|naruci\w*|nalog\w*|proizvod\w*|projek\w*|radio|radili|radila|radjen\w*|krojio|krojil\w*|poce\w*|pocel\w*|zavrs\w*|gotov\w*|stig\w*|spremn\w*|dobavljac\w*|isporuc\w*|koliko|kad smo|kada smo|ko je)\b/;

/** O tome je sve u promptu (zadaci, podsjetnici, bilježnica) — čitanje ne treba. */
const PROMPT_ONLY = /\b(zadat\w*|podsjet\w*|napomen\w*|biljeznic\w*|sta imam|sta trebam|danas imam|sutra imam)\b/;

export function asksForData(question: string): boolean {
    const t = foldText(question);
    return DATA_TERMS.test(t) && !PROMPT_ONLY.test(t);
}

/**
 * Treba li natjerati model da prvo čita: pitanje, nije čitao, nije upisivao,
 * nije već tjeran — i ili pita podatke ili odgovara „nemam / ne vidim".
 */
export function shouldReadFirst(s: {
    isQuestion: boolean; readUsed: boolean; readAsked: boolean; changed: boolean; question: string;
    /** Odgovor modela kakav jeste (s oznakama T#/M# prije čišćenja). */
    answer: string;
}): boolean {
    if (!s.isQuestion || s.readUsed || s.readAsked || s.changed) return false;
    if (NO_DATA.test(foldText(s.answer))) return true;
    // Odgovor iz zadataka/bilježnice koji su već u promptu („Ploču za Dinu (T7) radi Amer") — čitanje ne treba.
    if (/\b[TM]\d+\b/.test(s.answer)) return false;
    return asksForData(s.question);
}

// ── Pošta prije „ne" (PDF 30.10.) ────────────────────────────────────
// „Jesu li spremna ogledala iz Ramaglasa?" → „ne mogu potvrditi, u ERP-u nema",
// a u pošti je „Gotova su ogledala za Crni vrh". Narudžbe idu i mailom mimo
// ERP-a, pa je „nema u ERP-u" za stanje kod dobavljača tek pola odgovora.

/** Pitanje o stanju kod dobavljača/firme: spremno, gotovo, stiglo, potvrda, predračun, račun, rok. */
const SUPPLIER_STATE = /\b(sprem\w*|gotov\w*|zavrs\w*|stig\w*|stiza\w*|dosl\w*|potvrd\w*|predracun\w*|racun\w*|ponud\w*|rok\w*|isporu\w*|preuzet\w*|preuzim\w*|odgovor\w*|javil\w*|poslal\w*|mail\w*|email\w*|mejl\w*)\b/;

/** Odgovor „ne / nema / ne mogu potvrditi / bez odgovora". */
const SAYS_NO = /\b(ne mogu (da )?potvrdi\w*|nema (nijedn\w*|odgovor\w*|potvrd\w*|zapis\w*|stavk\w*|traga|narudzb\w*)|nije (stigl\w*|potvrd\w*|odgovor\w*|zapis\w*)|bez (ijednog )?odgovora|nisam nasao|nemam)\b/;

export function shouldCheckMail(s: {
    isQuestion: boolean;
    /** Već jednom vraćeno na poštu u ovoj poruci. */
    asked: boolean;
    /** search_mail je zvan s osobom, firmom ili projektom. */
    mailSearched: boolean;
    /** Poruka spominje dobavljača (searchFirms). */
    firmMentioned: boolean;
    question: string;
    answer: string;
}): boolean {
    if (!s.isQuestion || s.asked || s.mailSearched) return false;
    if (!SAYS_NO.test(foldText(s.answer)) && !NO_DATA.test(foldText(s.answer))) return false;
    return s.firmMentioned || SUPPLIER_STATE.test(foldText(s.question));
}

export function mailFirstNote(firm?: string): string {
    return `ERP: u ERP-u nema traga, ali odgovor je možda u pošti — narudžbe idu i mailom mimo ERP-a, a firme odgovaraju NOVIM mailom („gotovo", „spremno", predračun). `
        + `Pozovi search_mail s who=${firm ? `„${firm}"` : 'osoba ili firma o kojoj pita'} (bez riječi ili s jednom), pa odgovori iz pošte: ko je pisao, kad i šta.`;
}

export const READ_FIRST_NOTE ='ERP: ovo je pitanje o podacima u ERP-u, a nisi ništa pročitao. Pozovi alat za čitanje pa odgovori iz rezultata: '
    + 'materijal i dekor proizvoda → product_materials (project ili orders, material = vrsta); šta fali / šta čeka → material_status; '
    + 'tok i faze naloga → order_status; ko je radio i kad (i „kad smo počeli") → project_history ili work_report; '
    + 'narudžbe → list_orders. Projekat iz razgovora važi i kad ga ova poruka ne spominje. „Nemam" reci tek ako alat vrati prazno.';
