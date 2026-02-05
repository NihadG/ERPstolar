Sistem za Naručivanje Stakla
Problem
Trenutno naručivanje materijala ne podržava specifičnosti stakla:

Mnogo pojedinačnih komada (20-30 po narudžbi)
Svaki komad ima svoje dimenzije (širina × visina)
Različite vrste stakla i debljine
Različiti načini obrade (brušenje sa svih strana = +10%)
Cijena se računa po m²
Predloženo Rješenje
Pristup: Proširenje Postojećeg Sistema
Najbolji pristup je proširiti postojeći sistem materijala umjesto kreiranja paralelnog sistema. To znači:

Staklo je kategorija materijala kao i ostale
Kada se staklo dodaje na proizvod, otvara se specijalni modal za unos dimenzija
Svaki komad stakla ima svoje dimenzije i obradu
Struktura Podataka
Nova Sheet: Glass_Items
Kolona	Tip	Opis
ID	string	Jedinstveni ID
Product_Material_ID	string	Veza na product_materials zapis
Order_ID	string	Veza na narudžbu (kada se naruči)
Width	number	Širina u mm
Height	number	Visina u mm
Area_M2	number	Površina u m² (auto-izračun)
Edge_Processing	boolean	Da li ima brušenje sa svih strana
Note	string	Napomena za taj komad
Status	string	Nije naručeno, Naručeno, Primljeno
Proširenje Materials_DB
Dodati polje Is_Glass (boolean) za označavanje staklenih materijala.

UI Dizajn
1. Dodavanje Stakla na Proizvod
Kada korisnik odabere stakleni materijal, prikazuje se modal za unos komada:

┌─────────────────────────────────────────────────────────────┐
│ 🪟 Staklo: Kaljeno staklo 6mm                           [X] │
├─────────────────────────────────────────────────────────────┤
│ Cijena po m²: 45 KM     │  Brušenje: +10%                   │
├─────────────────────────────────────────────────────────────┤
│ # │ Širina (mm) │ Visina (mm) │ Brušenje │ m² │ Cijena │ 🗑 │
├───┼─────────────┼─────────────┼──────────┼────┼────────┼───┤
│ 1 │ [600]       │ [400]       │ [✓]      │0.24│ 11.88  │ 🗑 │
│ 2 │ [800]       │ [500]       │ [✓]      │0.40│ 19.80  │ 🗑 │
│ 3 │ [450]       │ [350]       │ [ ]      │0.16│  7.09  │ 🗑 │
│ + │ Dodaj komad                                              │
├─────────────────────────────────────────────────────────────┤
│ Ukupno: 3 komada │ 0.80 m² │ 38.77 KM                       │
├─────────────────────────────────────────────────────────────┤
│                                [Otkaži]  [Sačuvaj]          │
└─────────────────────────────────────────────────────────────┘
2. Prikaz u Listi Materijala Proizvoda
📦 Kaljeno staklo 6mm
   └─ 3 komada | 0.80 m² | 38.77 KM
      ├─ 600×400mm (brušeno)
      ├─ 800×500mm (brušeno)
      └─ 450×350mm
3. Print Narudžbenice za Staklo
Grupirana lista po vrsti stakla sa svim dimenzijama:

NARUDŽBENICA STAKLA
Kaljeno staklo 6mm (Panel Plus d.o.o.)
─────────────────────────────────────────
R.br │ Dimenzije    │ Brušenje │ m²
─────┼──────────────┼──────────┼─────
  1  │ 600 × 400 mm │ Da       │ 0.24
  2  │ 800 × 500 mm │ Da       │ 0.40
  3  │ 450 × 350 mm │ Ne       │ 0.16
─────┴──────────────┴──────────┴─────
                     UKUPNO: 0.80 m²
Implementacijski Koraci
Faza 1: Backend
 Kreirati Glass_Items sheet sa headerima
 Dodati Is_Glass polje u Materials_DB
 Kreirati CRUD funkcije za glass items
Faza 2: Frontend - Materijali
 Provjera da li je materijal staklo pri dodavanju
 Modal za unos komada stakla (tabela sa dimenzijama)
 Prikaz stakla sa dimenzijama u listi materijala
Faza 3: Integracija sa Narudžbama
 Učitavanje glass items prilikom kreiranja narudžbe
 Grupiranje staklenih stavki u pregledu narudžbe
 Ažuriranje print šablona za staklo
Kalkulacija Cijene
Površina (m²) = (Širina mm × Visina mm) / 1,000,000
Cijena = Površina × Cijena_po_m²
Ako brušenje: Cijena = Cijena × 1.10 (+10%)
Prednosti Ovog Pristupa
✅ Integriran - Staklo je dio postojećeg sistema, ne zaseban modul ✅ Pregledan - Tabelarni unos omogućava brz unos mnogo komada ✅ Fleksibilan - Svaki komad može imati različitu obradu ✅ Automatski izračun - Površina i cijena se računaju automatski ✅ Grupisanje - Na printu se stakla grupišu po vrsti za dobavljača