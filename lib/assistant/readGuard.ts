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

export const READ_FIRST_NOTE = 'ERP: ovo je pitanje o podacima u ERP-u, a nisi ništa pročitao. Pozovi alat za čitanje pa odgovori iz rezultata: '
    + 'materijal i dekor proizvoda → product_materials (project ili orders, material = vrsta); šta fali / šta čeka → material_status; '
    + 'tok i faze naloga → order_status; ko je radio i kad (i „kad smo počeli") → project_history ili work_report; '
    + 'narudžbe → list_orders. Projekat iz razgovora važi i kad ga ova poruka ne spominje. „Nemam" reci tek ako alat vrati prazno.';
