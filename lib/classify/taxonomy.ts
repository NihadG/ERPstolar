// ════════════════════════════════════════════════════════════════════
// TAKSONOMIJA TIPOVA PROIZVODA — za klasifikaciju naziva proizvoda I NAZIVA NALOGA.
//
// Isti oblik kao MATERIAL_TYPES (lib/productProcesses.ts): { key, label, patterns }.
// Taj obrazac je u ovoj aplikaciji već dokazan — zna korisnikov rječnik i lako se širi.
//
// OVO JE SJEME, NE KONAČNA LISTA. Nazivi u pogonu su živi jezik; neprepoznati
// tokeni se skupljaju (classify.ts → collectUnmatched) i korisnik ih mapira kroz
// Postavke, pa taksonomija raste NJEGOVIM rječnikom, a ne pretpostavkama.
// ════════════════════════════════════════════════════════════════════

export interface ProductType {
    key: string;        // stabilan ključ — piše se u snapshot, NE mijenjati zatečene
    label: string;      // prikazni naziv
    /**
     * Tri oblika patterna, svi se pišu VEĆ NORMALIZOVANI (bez dijakritike, mala slova):
     *
     *  1. "stol"      → PREFIKS TOKENA. Najduži pogodak pobjeđuje, pa "stolica" nikad
     *                   ne padne u "stol" (prefiksi "stol"=4 i "stolic"=6 → duži vodi).
     *                   Isto rješava i "stolarija" (IGNORE_PREFIXES ima "stolarij"=8).
     *  2. "=sto"      → TAČAN TOKEN. Za kratke riječi koje su prefiks nečeg drugog:
     *                   "sto" (stol) ne smije hvatati "stotinu"/"stolarija".
     *  3. "tv element"→ PODNIZ cijelog naziva (sadrži razmak) — za višerječne pojmove.
     */
    patterns: string[];
}

/**
 * Verzija taksonomije. Diže se pri SVAKOJ izmjeni patterna ili dodavanju tipa.
 * Upisuje se u snapshot (Taxonomy_Version) → uvijek se zna čime je nešto klasifikovano
 * i koji su snapshoti stariji od zadnje izmjene pravila (kandidati za rebuild).
 */
export const TAXONOMY_VERSION = 1;

export const PRODUCT_TYPES: ProductType[] = [
    { key: 'kuhinja', label: 'Kuhinja', patterns: ['kuhinj'] },
    // plakar / garderober / šifonjer = isti pojam u praksi
    { key: 'ormar', label: 'Ormar / plakar', patterns: ['ormar', 'plakar', 'garderob', 'sifonjer', 'sifoner'] },
    { key: 'komoda', label: 'Komoda', patterns: ['komod'] },
    { key: 'stol', label: 'Stol', patterns: ['stol', '=sto', '=stola', '=stolovi', 'trpezarijsk'] },
    { key: 'stolica', label: 'Stolica', patterns: ['stolic', 'tabure'] },
    { key: 'polica', label: 'Polica / regal', patterns: ['polic', 'regal', 'etazer'] },
    { key: 'vrata', label: 'Vrata', patterns: ['vrat'] },
    { key: 'kupatilo', label: 'Kupatilo', patterns: ['kupatil', 'kupaonic', 'lavabo'] },
    { key: 'krevet', label: 'Krevet', patterns: ['krevet', 'lezaj'] },
    { key: 'tv_element', label: 'TV element', patterns: ['tv element', 'tv komoda', 'tv polic', 'tvelement'] },
    { key: 'pult', label: 'Pult / šank', patterns: ['pult', 'sank', '=bar'] },
    { key: 'recepcija', label: 'Recepcija', patterns: ['recepcij'] },
    { key: 'radna_ploca', label: 'Radna ploča', patterns: ['radna ploc', 'radne ploc', 'radnu ploc'] },
    { key: 'predsoblje', label: 'Predsoblje', patterns: ['predsobl', 'cipelar'] },
    { key: 'ogledalo', label: 'Ogledalo', patterns: ['ogledal'] },
    { key: 'obloga', label: 'Zidna obloga / lamperija', patterns: ['lamperij', 'oblog', 'panel'] },
    { key: 'stepenice', label: 'Stepenice', patterns: ['stepenic', 'gazist', 'rukohvat'] },
    { key: 'pregrada', label: 'Pregrada', patterns: ['pregrad', 'paravan'] },
    { key: 'klupa', label: 'Klupa', patterns: ['klup'] },
];

/**
 * Riječi koje UČESTVUJU u istom natjecanju najdužeg prefiksa, ali NE daju tip i NE
 * broje se kao neprepoznate. Dvije svrhe:
 *  - da duži prefiks pobijedi kraći pattern tipa ("stolarija" → ignore, ne Stol),
 *  - da lista „šta treba mapirati" ne bude zatrpana radnjama i šumom.
 * Ovdje idu RADNJE i STRUKA (ne proizvodi): montaža je Work_Order_Type, ne tip proizvoda.
 */
export const IGNORE_PREFIXES: string[] = [
    'stolarij', 'stolar',
    'montaz', 'demontaz', 'ugradnj', 'izrad', 'popravk', 'servis', 'mjeren', 'zamjen',
    'dostav', 'transport', 'isporuk', 'pakovanj', 'ciscenj', 'primopredaj',
    'dorad', 'sanacij', 'reklamacij',
];

/**
 * Tokeni koji se preskaču prije bilo kakvog poređenja — brojevi, veznici, opisi.
 * Imena klijenata NAMJERNO ostaju u listi neprepoznatih: korisnik ih vidi i prepozna
 * da nisu tip; mi ih ne pogađamo (pogađanje imena bi bilo tiho krivo).
 */
export const NOISE_TOKENS = new Set([
    'i', 'sa', 'za', 'od', 'do', 'na', 'u', 'po', 'iz', 'bez', 'te', 'ili',
    'kom', 'komad', 'komada', 'kos', 'set', 'x', 'kpl',
    'novi', 'nova', 'novo', 'stari', 'stara', 'staro', 'dio', 'dijelovi',
    'lijevi', 'desni', 'gornji', 'donji', 'veliki', 'mali', 'srednji', 'ukupno',
    'projekat', 'projekt', 'nalog', 'stan', 'kuca', 'objekat', 'lokal', 'soba',
]);

/** Kraći tokeni od ovoga se ne porede kao prefiks (previše lažnih pogodaka). */
export const MIN_PREFIX_LEN = 3;
