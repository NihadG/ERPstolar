# Dnevnik unapređenja bota

Živi spisak onoga što bot (Telegram asistent) treba bolje raditi, s dokazima iz razgovora i stanjem popravke. Dopunjava ga revizija (`/bot-revizija` u Claude Codeu) kad kažeš „analiziraj“. ERP ga prikazuje u Postavke → Telegram asistent → Dnevnik unapređenja.

Odakle dolaze dokazi:

- **Signali** uz svaku poruku u dnevniku poruka: ERP je morao tjerati čitanje ili poštu, „nemam“, nije upisano, Poništi, ispravka u sljedećoj poruci.
- **Tvoje napomene**: odgovor (reply) na poruku bota sa „loše: …“, „dobro: …“, „napomena …“, ili `/lose …`.
- **Ponavljanje stvarnih poruka** kroz novog bota: prije i poslije popravke.

U ovom fajlu su samo izmišljena imena i opisi. Stvarne poruke ostaju u lokalnom izvozu (`.bot-review/`), nikad u repou.

## Moje upute

Stalna pravila revizije. Skill ih primjenjuje prije svojih; dopiši ili izmijeni kad hoćeš.

- AI unosi i prikazuje, ERP obrađuje: prepoznavanje, raspodjela i provjere su deterministička logika u `lib/`, ne model.
- Potvrde upisa piše ERP, nikad model.
- Pitanja botu nazad samo dugmadima, kad god je izbor konačan.
- Prijem materijala bilježi bot sam; procesi se vode bez Knjige rada kad radnik nije rečen.
- Pošta: samo čitanje. Bot ništa ne šalje bez tvog dugmeta.
- Bot treba biti kao čovjek kojem ne treba sve objašnjavati: prvo pogleda ERP i poštu, pa tek onda kaže „nemam“.
- Što manje tokena: popravka koja dodaje krug modela mora to opravdati.

## Metrike po reviziji

| Revizija | Poruka | Upisano | Odgovor | Pitanje | Nije upisano | AI nije radio | Sa signalom | Napomena | Tokena/poruka |
|---|---|---|---|---|---|---|---|---|---|
| 30.10.2026 (osnova, prije signala) | 45 | 23 | 15 | 1 | 0 | 6 | — | — | nema mjerenja |

## Otvorene potrebe

| ID | Potreba | Dokaz | Uzrok | Status | PR |
|---|---|---|---|---|---|
| P-001 | Stanje kod dobavljača iz pošte („jesu li spremna ogledala“) | PDF 30.10.: bot rekao „ne mogu potvrditi“, a dobavljač je javio „Gotova su ogledala“ novim mailom | integracija | spojeno, čeka potvrdu u Telegramu | #43 |
| P-002 | Pošta i kad Kontakti nisu uvezeni; stara pošta u ERP-u; pošta u kartici projekta | Kontakti prazni, ulazna pošta čita tek od povezivanja | integracija | spojeno, čeka potvrdu (Gmail povezan) | #44 |
| P-003 | Greške bez PDF-a sa slikama ekrana | PDF-ovi 28.10., 29.10., 30.10. | mogućnost | spojeno, čeka prvu napomenu „loše: …“ | #45 |
| P-004 | Revizija na komandu i ovaj dnevnik | PDF 30.10., str. 1 | mogućnost | u PR-u | ovaj |
| P-005 | Gmail povezan, Kontakti uvezeni | bez toga pošta radi samo preko domena dobavljača i imenika | podatak | **čeka tebe**: Postavke → Kontakti | — |
| P-006 | Ponavljanje 45 stvarnih poruka (korak 6) | izvoz postoji lokalno | — | **čeka tebe**: `ANTHROPIC_API_KEY` u `.env.local` | — |
| P-007 | Izmjena toka procesa porukom, „Zapamti“, procenat urađenog | PDF 29.10. | mogućnost | otvoreno | — |

## Urađeno

| Datum | Šta | PR |
|---|---|---|
| 30.10.2026 | Mjerenje potrošnje po poruci (krugovi, tokeni, keš) | #38 |
| 30.10.2026 | Nema odgovora bez čitanja ERP-a (readGuard) | #39 |
| 30.10.2026 | Kartica projekta (`project_brief`): sve o projektu u jednom pozivu | #40 |
| 30.10.2026 | Pretraga pošte na zahtjev (`search_mail`) | #41 |
| 30.10.2026 | Manji skup alata po vrsti poruke; ERP prepoznaje projekat i nalog | #42 |

## Odbijeno

| Datum | Prijedlog | Zašto ne |
|---|---|---|
| 30.10.2026 | Vektorski RAG (embeddings) | Podaci su mali i strukturirani, a Anthropic nema embedding model. Kartica projekta i Gmail pretraga rješavaju stvarne promašaje jeftinije. |
