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
| 01.11.2026 ponavljanje istih 45, sve na Haiku (trošak: $0,55 → $0,07) | 45 | 27 | 15 | 1 | 2 | 0 | — | — | 12.409 |
| 01.11.2026 (17 poruka od 31.10. 18:08; prvi test tabela 11:49–11:52) | 17 | 9 | 8 | 0 | 0 | 0 | 1 | 0 | 26.774 |
| 02.11.2026 (24 poruke od 01.11. 10:52; kontekst razgovora) | 24 | 12 | 11 | 1 | 0 | 0 | 9 | 0 | 28.957 |

## Otvorene potrebe

| ID | Potreba | Dokaz | Uzrok | Status | PR |
|---|---|---|---|---|---|
| P-001 | Stanje kod dobavljača iz pošte („jesu li spremna ogledala“) | PDF 30.10.: bot rekao „ne mogu potvrditi“, a dobavljač je javio „Gotova su ogledala“ novim mailom | integracija | spojeno, čeka potvrdu u Telegramu | #43 |
| P-002 | Pošta i kad Kontakti nisu uvezeni; stara pošta u ERP-u; pošta u kartici projekta | Kontakti prazni, ulazna pošta čita tek od povezivanja | integracija | spojeno, čeka potvrdu (Gmail povezan) | #44 |
| P-003 | Greške bez PDF-a sa slikama ekrana | PDF-ovi 28.10., 29.10., 30.10. | mogućnost | spojeno, čeka prvu napomenu „loše: …“ | #45 |
| P-004 | Revizija na komandu i ovaj dnevnik | PDF 30.10., str. 1 | mogućnost | u PR-u | ovaj |
| P-005 | Gmail povezan, Kontakti uvezeni | bez toga pošta radi samo preko domena dobavljača i imenika; 31.10. nacrt za osobu iz Stakloreza pao jer nije bila u Kontaktima | podatak | Gmail povezan; 31.10. dodane sve adrese šest dobavljača (ne samo info@) | — |
| P-006 | Ponavljanje 45 stvarnih poruka (korak 6) | izvoz postoji lokalno | — | urađeno 30.10. i 01.11. (ključ u `.env.local`) | #47 |
| P-007 | Izmjena toka procesa porukom, „Zapamti“, procenat urađenog | PDF 29.10. | mogućnost | otvoreno | — |
| P-008 | „AI se trenutno ne javlja“ kad ERP traži obavezan alat | ponavljanje 30.10.: 6 od 45 poruka pada s 400 „tool_choice … not supported“ na jačem modelu (Sonnet 5.5); isto u produkciji 30.10. ujutro | model | popravljeno: bez prisile kad je model odbije, pamti se po modelu; ponovljeno 6/6 bez greške | ovaj PR |
| P-009 | „Sumiraj zadnja 3 maila od [dobavljača]“ se tumači kao slanje maila (nacrt), ne kao čitanje pošte | ponavljanje 30.10. | alat | otvoreno — `intent.ts` (mail = slanje) i pravilo za `search_mail` | — |
| P-010 | „Da“ bez konteksta: bot pita na šta se odnosi, umjesto da ponudi dugmad zadnjeg prijedloga | 2 poruke 26.10. | pravilo | otvoreno | — |
| P-011 | Poruka koja nije pitanje („ne kontam ovu računicu“, „pa uradi to“, „ok“) → odgovor iz glave i obećanje „pozvat ću…“ bez poziva | 31.10. `dd007ce5`, `c326dd94`, `ee81bbe3`: tačan broj „ispravljen“ na pogrešan bez čitanja; dvaput „pozvat ću pregled materijala“, a ništa pozvano | pravilo → ERP | u PR-u (#48): čuvar čitanja važi i za poruke bez upisa i za obećanja | #48 |
| P-012 | Materijal po vrsti („koliko furnira za Hotel na brdu“) bez objašnjenja „za naručiti“ | 31.10. `4ea27fd3`: „treba 256 m², ništa nije naručeno, za naručiti 181“ — razlika 75 m² je na stanju za završena uzglavlja, ali to nije pisalo | alat | u PR-u (#48): ukupno, za naručiti, pokriveno i količina po proizvodu (✓ pokriveni) | #48 |
| P-013 | Pošta ne nalazi mail zbog padeža i zbog 8 najnovijih | 31.10. `680ecd58`, `1e5a7304`, `460e221e`, `af972cc2`: „staklo za Edu“ → traženo „Eda“/„staklo“, a mail je „Narudžba stakala – Edo kuća“; poslije proširenja na osobu mail nije bio među 8 najnovijih | argumenti | u PR-u (#48): ERP proširi riječ na padeže (stakla, stakala…), pa iste riječi u svoj pošti prije „sva pošta osobe“ | #48 |
| P-014 | „Naručio sam preko emaila, poslao Amri“ tumačeno kao nalog za upis → „Ništa nije upisano“ | 31.10. `eff9242e` | alat (namjera) | u PR-u (#48): prošlo vrijeme bez naredbe = pitanje, čita se pošta | #48 |
| P-015 | Kartica projekta s filterom koji ne pogađa nijedan proizvod je prazna | 31.10. `a8e2a8e2`: product „furnir“ → „kartica ne pokazuje materijale ni narudžbe“ | argumenti | u PR-u (#48): cijela kartica + napomena | #48 |
| P-016 | „Naruči sada jedan komad“ (ponovi narudžbu iz maila) → ERP narudžba s krivim materijalom, kom → m², i dopisano u sastavnicu | 31.10. `de1c35f7`: 1 kom stakla 2257×110×8 → „1 m² Staklo / Flutes“ na drugom proizvodu, +0,52 m² u sastavnicu | argumenti | otvoreno — stavka iz maila nije materijal iz sastavnice; treba pitati dugmadima ili napraviti stavku bez sastavnice | — |
| P-017 | Nacrt maila: osoba je u imeniku pošte, ali ne u Kontaktima → `email_contact` pada; „ne treba PDF“ ignorisano | 31.10. `528aacc3`, `79f35c10` | integracija | otvoreno — Kontakti dobavljača dopunjeni 31.10.; ostaje imenik kao rezerva za nacrt i „bez PDF-a“ = `email_contact` | — |
| P-018 | Ime iz diktata („Sijerku“ umjesto „Jerku“) i zadatak vezan za nasumičnu narudžbu | 31.10. `0f359344` | argumenti | otvoreno | — |
| P-019 | Tabela: ERP pogrešno pročita kolone iz poruke i pregazi modelove tačne | 01.11. `128fb37c`: „razvrstaj u kolone, stan ogledalo/umivaonik, fali/nije montirano/ima u stanu, dimenzije, komada“ → „stan ogledalo/umivaonik“ (bez zareza) postala jedna kolona predmeta, a „fali/nije montirano/ima u stanu“ odbačena kao preduga (31 znak) → tabela bez Stana i bez stanja. Model je poslao tačnih 5 kolona. Usput: „sva ogledala“ bez količine piše „1 kom“, „š 800“ ostaje u predmetu | argumenti (ERP parser) | urađeno na grani `feature/tabele-temelj`: kolone po nazivu i vrijednostima iz podataka, razlaganje bez zareza, ništa ne nestaje tiho; prazna količina; „š 800" | — |
| P-020 | Tabela: stvar na hodniku za stan druge lamele ide pod lamelu hodnika | 01.11. `c75cac29` „u C lameli ima i od E lamele“: umivaonik za E501 stoji na Hodniku C5 → svrstan u C; kolona Stan pokazuje hodnik, ne stan za koji je | pravilo (ERP) | urađeno na grani: stan = stan za koji je stvar, uz „(Hodnik C5)"; važi i za spisak | — |
| P-021 | Tabela zadataka (lista za provjeru) ne postoji; model napravi tabelu iz bilježnice s predmetom koji nije rečen | 01.11. `db94e5f7` „tabelu šta sve trebam kod Selima provjeriti“ → bilježnica, predmet „umivaonik“, 1 red s hodnika; `0b87700e` „napravi ispravnu tabelu“ → „alat čita samo bilježnicu i materijale“ | mogućnost + argumenti | dijelom: nerečen filter se odbija (model dobije razlog); izvor „zadaci" je sljedeći korak | — |
| P-022 | Pritužba bez „ne/nije“ na početku ne daje signal, pa je revizija ne vidi | 01.11. „Tabela loša, u C lameli…“, „Kakve veze ima hodnik sa Selimom“ — trijaža: 0 signala za tabele. 02.11. `29bf4a3f` „…ova poruka je toliko beskorisna…" bez signala | mogućnost (signali) | urađeno (#55); 02.11. dodano „beskorisn…", „ne kontam", „nisi razumio" | `feature/bot-kontekst` |
| P-023 | Bot ne zna na koju poruku odgovaraš, ni šta je sam poslao (podsjetnik, jutarnji pregled, provjera materijala, prijedlog rada) | 02.11. `29bf4a3f`: odgovor na poruku bota „ova poruka je beskorisna, nema potrebe slati" → bot se izvinio za nešto drugo i prepričao zadatak za sutra. Tekst poruke na koju je odgovoreno nije išao modelu, a poruke koje bot šalje sam nisu bile u istoriji | integracija (kontekst) | urađeno na grani: tekst poruke na koju odgovaraš ide modelu („[Korisnik odgovara na tvoju poruku: …]"); sve što bot pošalje sam ulazi u istoriju razgovora | `feature/bot-kontekst` |
| P-024 | Projekat i rečeno iz prethodne poruke prelaze na nepovezanu poruku | 02.11. `7d2d4969` „Pitati Edina za kant traku u 11" dobio projekat iz poruke prije (drugi projekat); `51ea759f` „Potvrdi Leli predračun" vezan za projekat iz poruke o stanu od prije 30 min | argumenti (ERP) | urađeno na grani: prethodna poruka važi samo kad se nova na nju naslanja (reply, „a…", „to je također…", „ma…", dopuna do 3 riječi, do 15 min); inače je projekat iz razgovora samo mogućnost, a upis ga ne veže | `feature/bot-kontekst` |
| P-025 | Nedovršen zahtjev se gubi u dopuni; „sutra u 8" bez poznatog glagola nije podsjetnik | 02.11. `d367c0c5` → `98995994` → `608fee60`: „Provjerit s Senadom sutra u 8 kako dovući staklo za Hamzu" → bot pričao o staklu; „Ma, treba mi za vrata…" → „neću upisati dok ne potvrdiš"; tek treća poruka „napiši mi napomenu i podsjeti me" je upisala. Isto `1b457916` → `aa7b9bca` (uzglavlja, faza) | alat (namjera) + kontekst | urađeno na grani: budući dan ili sat bez drugog upisa = podsjetnik; neupisan zahtjev ostaje u sesiji 15 min i dopuna/odgovor ga preuzima (s vremenom iz prve poruke), pa ERP tjera upis | `feature/bot-kontekst` |
| P-026 | ERP podatak pregazi rečeno: bot odbija upis jer ERP nema trag ili ima drugačiji status | 02.11. `aa7b9bca`: „uzglavlja su na srezivanju" → „proizvod je Spremno, ne slaže se, neću upisati"; `98995994`: „nisam našao narudžbu u Staklorezu, neću upisati" | pravilo → ERP | dijelom na grani: pravilo „rečeno je istina o terenu — upiši, razliku navedi jednom rečenicom" + preuzimanje zahtjeva (P-025) tjera upis. Otvoreno: faza na nalogu koji je u ERP-u Završen (set_progress ga ne vidi) | `feature/bot-kontekst` |
| P-027 | Ispravka tipfelera jednom riječju pravi drugi isti zadatak | 02.11. `b348d921` „brdo" poslije „naruciti sutra inox za brdbrdoo" → drugi „Naručiti inox…", poništen | alat | urađeno na grani: isti naslov (isti radnik) u zadnjih 60 min ili za isto vrijeme = „☑️ Već upisano", bez novog | `feature/bot-kontekst` |
| P-028 | Potvrda bilješke ne pokazuje projekat → izgleda nevezano | 02.11. `21eb7c54` „A vrata su široka 629" upisano za projekat, ali potvrda bez 📁 → poništeno i ponovljeno „to je također za Brdo" | prikaz | urađeno na grani: 📁 projekat u potvrdi bilješke, kao kod zadatka | `feature/bot-kontekst` |
| P-029 | „Listu napomena za [projekat]" filtrira po predmetu i miješa tuđe stavke | 02.11. `cc63db6b`: list_notebook „vrata" vratio i „Prolaz kliznih vrata B104" s drugog projekta; `a4bf1971` „kakve veze ima…" → bot izmislio da ga je „ostavio" | alat | urađeno na grani: list_notebook ima `project` | `feature/bot-kontekst` |
| P-030 | „što" se čita kao „sto" (stol) → potegne nalog „Sto za …" | 02.11. `38c168d9` „predračun što je Lejla poslala" → order_status za „Sto za Tarika"; korisnik: „kakve veze ima Tarik" | argumenti (ERP) | urađeno na grani: veznik „što" ne ulazi u prepoznavanje naloga | `feature/bot-kontekst` |
| P-031 | Model pobrka nazive polja alata, a greška ne kaže koja | 02.11. `972f392f`: email_contact s `who`/`body` (iz search_mail) dvaput → „Treba kome, naslov i tekst." → „ispravi adresu u Kontaktima" | alat | urađeno na grani: uz grešku alata ERP navede nepoznata polja i prava imena | `feature/bot-kontekst` |
| P-032 | Potvrda predračuna odgovorom na mail dobavljača (u istoj niti) | 02.11. `51ea759f`, `38c168d9`, `972f392f`: „potvrdi predračun koji je Lejla poslala i reci da može u proizvodnju" — tri poruke bez nacrta | mogućnost + namjera | urađeno na grani: alat reply_mail — ERP nađe zadnji primljen mail od osobe (ili id iz search_mail) i napravi nacrt „Re: …" u istoj niti, bez Kontakta; confirm upiše predračun kao potvrđen na narudžbi kad ga ulazna pošta veže (kao dugme „Potvrdi", s Poništi). „Potvrdi … predračun" i „odgovori joj…" su mail i bez riječi „mail" | `feature/bot-kontekst` |
| P-033 | Ponavljajući podsjetnik („svaki dan pola sata prije namaza") | 01.11. `beeb6919`: upisan jedan podsjetnik (podne, sutra) bez riječi da ostali i ponavljanje nisu; `6e5f65ec` „kad je ikindija" → okvirno vrijeme | mogućnost | otvoreno — ponavljanje u zadacima; vremena namaza iz tabele za grad | — |

## Urađeno

| Datum | Šta | PR |
|---|---|---|
| 30.10.2026 | Mjerenje potrošnje po poruci (krugovi, tokeni, keš) | #38 |
| 30.10.2026 | Nema odgovora bez čitanja ERP-a (readGuard) | #39 |
| 30.10.2026 | Kartica projekta (`project_brief`): sve o projektu u jednom pozivu | #40 |
| 30.10.2026 | Pretraga pošte na zahtjev (`search_mail`) | #41 |
| 30.10.2026 | Manji skup alata po vrsti poruke; ERP prepoznaje projekat i nalog | #42 |
| 01.11.2026 | Jeftiniji bot: „jači" krug je zadano isti Haiku, ne Sonnet. Ponavljanje 45 poruka: $0,55 → $0,07 (~87% manje); 13 težih poruka u dva prolaza jednako ili bolje (npr. „kad smo počeli Čorluku" tačno, „provjeriti kod Anesa…" tačno). Sonnet se vraća s `ASSISTANT_MODEL_STRONG` bez izmjene koda | ovaj PR |

## Odbijeno

| Datum | Prijedlog | Zašto ne |
|---|---|---|
| 30.10.2026 | Vektorski RAG (embeddings) | Podaci su mali i strukturirani, a Anthropic nema embedding model. Kartica projekta i Gmail pretraga rješavaju stvarne promašaje jeftinije. |
