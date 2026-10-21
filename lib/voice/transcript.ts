// ════════════════════════════════════════════════════════════════════
// Transkripcija: format snimka, prompt s rječnikom, filter „halucinacija".
// ════════════════════════════════════════════════════════════════════

import { foldText } from './text';

// Redoslijed: Chrome/Firefox/Android → webm/opus; Safari (iOS/macOS) → mp4.
// Prije je webm/opus bio tvrdo zadan, pa je na starijem iOS-u MediaRecorder
// pucao s „nije moguće pristupiti mikrofonu" (a mikrofon je ostajao upaljen).
export const RECORDER_MIME_TYPES = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4;codecs=mp4a.40.2',
    'audio/mp4',
    'audio/ogg;codecs=opus',
];

export function pickRecorderMimeType(isSupported: (t: string) => boolean): string | undefined {
    return RECORDER_MIME_TYPES.find(t => {
        try { return isSupported(t); } catch { return false; }
    });
}

/** Ekstenzija koju OpenAI prepoznaje (format se gleda po imenu fajla). */
export function audioExtension(mime: string | undefined | null): string {
    const m = (mime || '').toLowerCase();
    if (m.includes('mp4') || m.includes('m4a') || m.includes('aac')) return 'mp4';
    if (m.includes('ogg')) return 'ogg';
    if (m.includes('wav')) return 'wav';
    if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
    return 'webm';
}

// Rečenice koje Whisper „čuje" u tišini/šumu (naučio iz titlova na YouTubeu).
const HALLUCINATIONS = [
    'hvala na gledanju', 'hvala sto ste gledali', 'hvala vam na gledanju', 'hvala na paznji',
    'pretplatite se', 'pretplati se', 'lajkajte', 'titlovi', 'titlove', 'prijevod', 'prevod',
    'podnapisi', 'subtitles', 'thank you for watching', 'amara.org', 'www.', 'vidimo se u sljedecem',
];

/**
 * true ako transkript nije stvarni govor: prazan, poznata fraza iz tišine,
 * ili model ponovio sam prompt (lista riječi iz rječnika).
 */
export function isLikelyHallucination(text: string, prompt = ''): boolean {
    const t = foldText(text).replace(/[.\-]/g, ' ').replace(/\s+/g, ' ').trim();
    if (t.length < 2) return true;
    if (HALLUCINATIONS.some(h => t.includes(h)) && t.split(' ').length <= 8) return true;
    if (prompt) {
        const p = foldText(prompt);
        if (t.length >= 12 && p.includes(t)) return true;
    }
    return false;
}

/**
 * Prompt za transkripciju: kratka rečenica + imena + stručni pojmovi.
 * Imena idu prva (najvrjednija), lista se reže na cijelim stavkama.
 */
export function buildTranscriptionPrompt(names: string[], vocabulary: string[], maxChars = 800): string {
    const head = 'Diktat zadatka u stolarskoj radionici, na bosanskom.';
    const seen = new Set<string>();
    const items: string[] = [];
    for (const raw of [...names, ...vocabulary]) {
        const n = (raw || '').trim();
        const k = foldText(n);
        if (!n || seen.has(k)) continue;
        seen.add(k);
        items.push(n);
    }
    let out = head;
    for (const it of items) {
        const next = `${out}${out === head ? ' ' : ', '}${it}`;
        if (next.length > maxChars) break;
        out = next;
    }
    return out.endsWith('.') ? out : `${out}.`;
}
