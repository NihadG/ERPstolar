# Plan: ritam dana — narudžbe, računi i procesi bez unosa

Stanje: prijedlog, čeka odobrenje (10.11.2026). Gradi se po skillu `bot-gradnja`.

## Cilj

Narudžbe, računi, procesi i upis dana ulaze u ERP kroz **dvije poruke dnevno** (10:30 i 14:30), dugmadima. Poslije 15:00 bot sam ne šalje ništa. Niko osim vlasnika ne mora mijenjati navike.

## Odluke vlasnika (10.11.2026)

- Termini: **10:30** i **14:30**. Ništa poslije 15:00.
- Upis dana ide u 14:30 (do sada 16:30–20:00). Obilazak procesa dvaput dnevno.
- Jedna narudžba i jedan račun često nose **više projekata**. Dogovor s prodavcem o referenci ne dolazi u obzir.
- Računi znaju stići 4–5 odjednom: prvo sabrati i složiti, pa tek onda pitati.
- **Zaliha** = roba na palete koje uvijek ili često ima (MDF 18, furnir hrast i slično).
- Dio proizvodnje ide **mimo sistema** (direktor da 4 vrata ili 5 stolova bez naloga). ERP to mora moći primiti, ne ispravljati.
- Računi mailom: Rama-Glas, Schachermayer. Poštom (papir): Frischeis, Top color, Elgrad.

## Pravila poruka

1. Najviše dvije poruke koje bot šalje sam (10:30, 14:30), uz jutarnji pregled. Podsjetnici koje vlasnik sam zada nisu ograničeni.
2. Poruka je spisak od najviše tri stvari. Dodir otvara jednu, ona se riješi na mjestu i vrati se kao jedan red s kvačicom.
3. Jedno pitanje odjednom, odgovor je dugme, najvjerovatniji je prvi. Kucanja nema; glas je dodatak koji se može preskočiti.
4. Što ERP zna, ne pita: zaliha i naučeno se rasporedi samo i samo se javi, uz Poništi.
5. Neodgovoreno se ponovi jednom u sljedećem terminu, pa čeka u ERP-u. Ništa se ne gomila.
6. Riječi vlasnika: narudžba, račun, stiglo, dokle su stigli, bez projekta.
7. Obavijesti koje danas stižu pojedinačno (nova pošta, materijal, podsjetnici pošte) prelaze u termine.

## Dan

| Vrijeme | U poruci | Najčešće dodira |
|---|---|---|
| 07:00 | jutarnji pregled (postoji) | 0 |
| 10:30 | Računi · Narudžbe · Obilazak | 3–8 |
| 14:30 | Upis dana · Obilazak · Narudžbe | 3–8 |

## Računi: sabrati, složiti, pa pitati

1. **Sabrati.** Sve što je od prošlog termina stiglo od istog dobavljača je jedan paket („Schachermayer · 4 računa · 9.870 KM").
2. **Složiti u grupe.** ERP spoji pozicije koje idu zajedno. Na računu 9960755928 su 22 pozicije tri grupe: Tandem vodilice (20 pari, 685 KM), Merivobox ladice 450 (27 kompleta, 2.069 KM), Merivobox ladice 550 (10 kompleta, 947 KM). Zbir je 3.701,25 KM, koliko i na računu.
3. **Zaliha ide sama.** MDF, furnir hrast i ostalo s liste zalihe se ne pita.
4. **Jedno pitanje za paket:** „Za šta je?" → projekat, ili „Različito".
   - Jedan projekat → „Za sve ili za jedan nalog?" → gotovo (2 dodira).
   - Različito → grupa po grupa, jedan dodir po grupi: projekat, Zaliha ili Bez projekta.
5. **Jedna grupa na dva projekta** (27 ladica: 20 jednom, 7 drugom) rješava se glasom, kao izuzetak.
6. **Učenje.** Ista vrsta robe sljedeći put dolazi s prijedlogom („Merivobox → Švicarska, kao prošli put") i jednim dodirom se potvrdi.

## Bez projekta: posao mimo sistema

Dugme „Bez projekta" postoji svuda gdje se bira projekat (račun, narudžba, upis dana). Poslije njega bot pita „Za šta?", a odgovor je jedna izgovorena rečenica („4 vrata za komšiju") ili Preskoči. Od rečenice nastaje kratak nalog bez projekta, kakav bot već pravi („Drago stolovi"). Sljedeći put je taj posao ponuđen kao dugme.

Korist: materijal i dnevnice koji odu mimo sistema više ne nestaju, nego se vide kao zaseban red. Jednom mjesečno jutarnji pregled dobije red „Bez projekta ovaj mjesec: N poslova, X KM materijala, Y dnevnica".

## Narudžbe

- Pitanje u oba termina: „Jesi li šta naručio?" → Kod koga? → Za šta? (projekat, Više projekata, Zaliha, Bez projekta). Detalji se slažu kad stigne račun.
- Bez pitanja: rečenica („naručio kod Zaima ladice"), Urađeno na podsjetniku „Naručiti…", Poslano na Viber poruci dobavljaču.
- Narudžba bez računa poslije 7 dana pojavi se u terminu: „Je li stiglo?" → Stiglo / Još ne / Pitaj dobavljača.

## Obilazak procesa

U oba termina, samo nalozi na kojima se radilo od prošlog obilaska. Po nalogu jedno pitanje „dokle su stigli?", dugmad su sljedeći koraci iz toka tog naloga i „Isto". Prethodne korake ERP zaključi sam (postoji).

Kad je pogon dalje nego što ERP zna (P-072): „Dalje od ovoga…" otvori kasnije korake toka — izabrani je u toku, svi prije njega gotovi. „Sve gotovo" (uz potvrdu „Da, sve gotovo") završi sve proizvode danom zadnjeg rada i zatvori nalog. „Nazad" iz ta dva koraka vraća na isti nalog.

## Upis dana (14:30)

„Je li danas sve kao juče?" → Sve isto (1 dodir) ili Ima izmjena → jedna izgovorena rečenica s razlikama. Radnik bez posla u sistemu dobija dugme „Bez projekta".

Termin vidi jutarnji diktat (P-073): kad je dio dana već upisan, pitanje je „Upisano danas: N. Ostali kao prethodni radni dan?" s imenima ostalih, a „Ostali isto" upiše samo njih. Sav dan upisan prije 14:30 → red „✅ Dan već upisan", bez pitanja. Stavka se pri otvaranju čita iz ERP-a ponovo, pa se vidi i diktat poslije slanja termina.

## Faze

| Faza | Sadržaj | Šta se vidi |
|---|---|---|
| 1 | Dvije poruke-spiska; upis dana u 14:30; pitanje o narudžbama; obilazak; pojedinačne obavijesti prelaze u termine; „Bez projekta" u narudžbi i upisu dana. Sve na dugmad, bez AI-ja. | Manje poruka nego danas; narudžbe i procesi u ERP-u. |
| 2 | Računi iz pošte (Schachermayer, Rama-Glas): čitanje, grupe, raspored po projektima, zaliha sama, učenje. | Iznosi po projektu bez unosa. |
| 3 | Papirni računi slikom (Frischeis, Top color, Elgrad); pregled „planirano / stvarno kupljeno" po projektu; mjesečni red „Bez projekta". | Stvarni trošak materijala. |

Formula profita se ne mijenja dok faza 3 ne pokaže da su podaci potpuni.

## Šta je provjereno, a šta nije

Provjereno na stvarnim dokumentima i snimku ERP-a od 6.11.:
- Račun Schachermayera se može složiti u grupe (22 pozicije → 3) i zbir se slaže s računom.
- Povezivanje stavki sa sastavnicom ne radi: 0 od 17 šifri postoji u ERP-u. Zato se raspoređuje po projektu, dodirom.
- Dugmad koja bot danas šalje uz poštu se ne koriste: 12 dokumenata, nijedan potvrđen.

Nije provjereno:
- Hoće li vlasnik odgovarati na termine. Mjeri se od prvog dana.
- Čitanje PDF-a u produkciji (alat postoji, nije proban na pravom računu kroz bota).
- Kako izgledaju računi Frischeisa, Top colora i Elgrada.

## Mjerila poslije dvije sedmice

Udio termina s odgovorom, broj dodira po danu, broj upisanih narudžbi, udio računa raspoređenih bez pitanja, broj naloga s ažurnim procesom, iznos pod „Bez projekta". Poslije tri preskočena termina zaredom bot jednom pita da li promijeniti vrijeme ili oblik.
