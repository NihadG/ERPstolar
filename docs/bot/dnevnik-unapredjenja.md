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
| 30.10.2026 ponavljanje istih 45 kroz novog bota (#38–#46) | 45 | 24 | 12 | 3 | 0 | 6 | — | — | 12.292 |
| 30.10.2026 ponavljanje 12 palih i susjednih poslije P-008 | 12 | 6 | 3 | 2 | 1 | 0 | — | — | — |
| 31.10.2026 (101 poruka od 17.10.; problemi iz jednog razgovora 08:21–08:43) | 101 | 31 | 32 | 1 | 1 | 6 | 9 | 0 | 25.207 |
| 31.10.2026 ponavljanje istih 19 kroz #48 (prvi krug; pošta u ponavljanju nije dostupna) | 19 | 2 | 14 | 2 | 1 | 0 | — | — | 24.577 |
| 31.10.2026 ponavljanje 6 poruka o furniru poslije P-019 | 6 | 0 | 5 | 1 | 0 | 0 | — | — | — |

## Otvorene potrebe

| ID | Potreba | Dokaz | Uzrok | Status | PR |
|---|---|---|---|---|---|
| P-001 | Stanje kod dobavljača iz pošte („jesu li spremna ogledala“) | PDF 30.10.: bot rekao „ne mogu potvrditi“, a dobavljač je javio „Gotova su ogledala“ novim mailom | integracija | spojeno, čeka potvrdu u Telegramu | #43 |
| P-002 | Pošta i kad Kontakti nisu uvezeni; stara pošta u ERP-u; pošta u kartici projekta | Kontakti prazni, ulazna pošta čita tek od povezivanja | integracija | spojeno, čeka potvrdu (Gmail povezan) | #44 |
| P-003 | Greške bez PDF-a sa slikama ekrana | PDF-ovi 28.10., 29.10., 30.10. | mogućnost | spojeno, čeka prvu napomenu „loše: …“ | #45 |
| P-004 | Revizija na komandu i ovaj dnevnik | PDF 30.10., str. 1 | mogućnost | u PR-u | ovaj |
| P-005 | Gmail povezan, Kontakti uvezeni | bez toga pošta radi samo preko domena dobavljača i imenika; 31.10. nacrt za osobu iz Stakloreza pao jer nije bila u Kontaktima | podatak | Gmail povezan; 31.10. dodane sve adrese šest dobavljača (ne samo info@) | — |
| P-006 | Ponavljanje 45 stvarnih poruka (korak 6) | izvoz postoji lokalno | — | **čeka tebe**: `ANTHROPIC_API_KEY` u `.env.local` | — |
| P-007 | Izmjena toka procesa porukom, „Zapamti“, procenat urađenog | PDF 29.10. | mogućnost | otvoreno | — |
| P-008 | „AI se trenutno ne javlja“ kad ERP traži obavezan alat | ponavljanje 30.10.: 6 od 45 poruka pada s 400 „tool_choice … not supported“ na jačem modelu (Sonnet 5.5); isto u produkciji 30.10. ujutro | model | popravljeno: bez prisile kad je model odbije, pamti se po modelu; ponovljeno 6/6 bez greške | ovaj PR |
| P-009 | „Sumiraj zadnja 3 maila od [dobavljača]“ se tumači kao slanje maila (nacrt), ne kao čitanje pošte | ponavljanje 30.10. | alat | otvoreno — `intent.ts` (mail = slanje) i pravilo za `search_mail` | — |
| P-010 | „Da“ bez konteksta: bot pita na šta se odnosi, umjesto da ponudi dugmad zadnjeg prijedloga | 2 poruke 26.10. | pravilo | otvoreno | — |
| P-011 | Poruka koja nije pitanje („ne kontam ovu računicu“, „pa uradi to“, „ok“) → odgovor iz glave i obećanje „pozvat ću…“ bez poziva | 31.10. `dd007ce5`, `c326dd94`, `ee81bbe3`: tačan broj „ispravljen“ na pogrešan bez čitanja; dvaput „pozvat ću pregled materijala“, a ništa pozvano | pravilo → ERP | u PR-u (#48): čuvar čitanja važi i za poruke bez upisa i za obećanja | #48 |
| P-012 | Materijal po vrsti („koliko furnira za Hotel na brdu“) bez objašnjenja „za naručiti“ | 31.10. `4ea27fd3`: „treba 256 m², ništa nije naručeno, za naručiti 181“ — razlika 75 m² je na stanju za završena uzglavlja, ali to nije pisalo | alat | u PR-u (#48): ukupno, za naručiti, pokriveno i količina po proizvodu (✓ pokriveni) | #48 |
| P-013 | Pošta ne nalazi mail zbog padeža i zbog 8 najnovijih | 31.10. `680ecd58`, `1e5a7304`, `460e221e`, `af972cc2`: „staklo za Edu“ → traženo „Eda“/„staklo“, a mail je „Narudžba stakala – Edo kuća“; poslije proširenja na osobu mail nije bio među 8 najnovijih | argumenti | u PR-u (#48): ERP proširi riječ na padeže (stakla, stakala…), pa iste riječi u svoj pošti prije „sva pošta osobe“; ponavljanje ovo ne provjerava (Gmail je u ponavljanju blokiran) — čeka potvrdu u Telegramu | #48 |
| P-014 | „Naručio sam preko emaila, poslao Amri“ tumačeno kao nalog za upis → „Ništa nije upisano“ | 31.10. `eff9242e` | alat (namjera) | u PR-u (#48): prošlo vrijeme bez naredbe = pitanje, čita se pošta | #48 |
| P-015 | Kartica projekta s filterom koji ne pogađa nijedan proizvod je prazna | 31.10. `a8e2a8e2`: product „furnir“ → „kartica ne pokazuje materijale ni narudžbe“ | argumenti | u PR-u (#48): cijela kartica + napomena | #48 |
| P-016 | „Naruči sada jedan komad“ (ponovi narudžbu iz maila) → ERP narudžba s krivim materijalom, kom → m², i dopisano u sastavnicu | 31.10. `de1c35f7`: 1 kom stakla 2257×110×8 → „1 m² Staklo / Flutes“ na drugom proizvodu, +0,52 m² u sastavnicu; ponavljanje 31.10.: poslije ponude „mogu napraviti narudžbu furnira“ i „pa uradi to“ nastao nacrt sa SVIM materijalima projekta, ne samo furnirom | argumenti | otvoreno — stavka iz maila nije materijal iz sastavnice; treba pitati dugmadima ili napraviti stavku bez sastavnice; narudžba „ovoga“ mora ostati na rečenom materijalu | — |
| P-019 | Kartica projekta i pregled materijala govore različito za stari status „Na stanju“ (bez količine) | ponavljanje 31.10.: na „ne kontam“ model pročitao karticu („nije naručeno 256“) i opet se „ispravio“ na pogrešno | alat | u PR-u (#48): kartica računa pokriveno kao `materialCoverage`; ponovljeno 6/6 dosljedno 181 / 295 | #48 |
| P-017 | Nacrt maila: osoba je u imeniku pošte, ali ne u Kontaktima → `email_contact` pada; „ne treba PDF“ ignorisano | 31.10. `528aacc3`, `79f35c10` | integracija | otvoreno — Kontakti dobavljača dopunjeni 31.10.; ostaje imenik kao rezerva za nacrt i „bez PDF-a“ = `email_contact` | — |
| P-018 | Ime iz diktata („Sijerku“ umjesto „Jerku“) i zadatak vezan za nasumičnu narudžbu | 31.10. `0f359344` | argumenti | otvoreno | — |

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
