/**
 * Dokument za štampu — jedan izvor za prozor štampe I za PDF izvoz.
 *
 * Prije je svaki dokument postojao u dvije verzije: bogat layout u prozoru
 * za štampu i osiromašen u PDF-u (drugi font, bez loga, bez preloma). Ovaj
 * oblik postoji da se to više ne može desiti — oba puta uzimaju isti objekat.
 */
export interface PrintDocument {
    /** Kompletan HTML dokument — za window.open() + print(). */
    html: string;
    /** Samo sadržaj <body> — za PDF izvoz, koji CSS ubacuje sam. */
    body: string;
    /** CSS dokumenta (bez @media print pravila iz `printOverrides`). */
    css: string;
    /**
     * Pravila iz `@media print` koja PDF izvoz mora primijeniti ručno —
     * rasterizacija se dešava na ekranu, gdje `@media print` ne važi.
     */
    printOverrides: string;
    /** Naslov prozora / naziv fajla. */
    title: string;
}
