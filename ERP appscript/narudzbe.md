naprijeđenje Sistema Narudžbi Materijala
Implementacija kompletnog workflow-a za naručivanje materijala sa multi-select funkcionalnostima, filteriranim materijalima, i profesionalnim PDF printom.

Proposed Changes
1. HTML - Orders Tab & Modals
[MODIFY] 
index.html
Orders Tab (Linije 133-144):

Dodati filter za status narudžbe
Dodati pretraživanje narudžbi
Definisati strukturu za listu narudžbi
Novi Order Wizard Modal:

┌─────────────────────────────────────────────────────┐
│ Nova Narudžba                                    X  │
├─────────────────────────────────────────────────────┤
│ Step 1: Odaberi projekte i proizvode               │
│                                                     │
│ ┌─ Projekti (multi-select) ─────────────────────┐  │
│ │ ☑ Projekat A - Marko Petrović                 │  │
│ │ ☐ Projekat B - Ana Josić                      │  │
│ └───────────────────────────────────────────────┘  │
│                                                     │
│ ┌─ Proizvodi (filtrirani po projektu) ──────────┐  │
│ │ ☑ Gornji ormar 60cm (Projekat A)              │  │
│ │ ☑ Donji ormar 80cm (Projekat A)               │  │
│ │ ☐ Komoda (Projekat A)                         │  │
│ └───────────────────────────────────────────────┘  │
│                                                     │
│ Step 2: Odaberi dobavljača                         │
│ ┌───────────────────────────────────────────────┐  │
│ │ [Dropdown: Lista dobavljača]                  │  │
│ └───────────────────────────────────────────────┘  │
│                                                     │
│ Step 3: Materijali za narudžbu                     │
│ ┌───────────────────────────────────────────────┐  │
│ │ ☑ Iverica Bijela 18mm - 2.5 m²                │  │
│ │ ☑ Kanttraka Bijela 2mm - 8 m                  │  │
│ │ ☑ Šarke 110° - 4 kom                          │  │
│ └───────────────────────────────────────────────┘  │
│                                                     │
│ [Očekivana cijena: 450.00 KM]                      │
├─────────────────────────────────────────────────────┤
│                              [Otkaži] [Kreiraj]    │
└─────────────────────────────────────────────────────┘
Order View/Edit Modal:

Prikaz detalja narudžbe
Mogućnost uređivanja (količine, napomene)
Akcije: Pošalji, Označi primljeno, Brisanje
Print PDF dugme
Order Print Template:

Zaglavlje sa logom firme
Podaci o dobavljaču
Tabela materijala
Ukupna cijena
Datum i broj narudžbe
2. JavaScript - Frontend Logic
[MODIFY] 
JavaScript.html
Nove funkcije:

// Global State za narudžbe
let orderWizardState = {
    selectedProjects: [],
    selectedProducts: [],
    supplierId: null,
    filteredMaterials: [],
    selectedMaterials: []
};
// Rendering
function renderOrders()
function renderOrdersList(orders)
// Order Wizard
function openOrderModal()
function closeOrderModal()
function onProjectSelectionChange()
function onProductSelectionChange()
function onSupplierChange()
function loadFilteredMaterials()
function toggleMaterial(materialId)
function calculateOrderTotal()
function createNewOrder()
// Order View/Edit
function viewOrder(orderId)
function openOrderViewModal(order)
function toggleOrderEditMode()
function saveOrderChanges()
function markOrderAsSent()
function markItemsReceived()
function deleteOrderConfirm(orderId)
// Print
function printOrderDocument()
function renderOrderPrintTemplate(order)
3. Backend - Ordering.gs
[MODIFY] 
Ordering.gs
Poboljšanja:

getOrderableMaterials(filters)
 - već postoji, koristiti za multi-project/product filtriranje
Dodati updateOrder(orderId, data) - za uređivanje narudžbe
Dodati updateOrderItem(itemId, data) - za uređivanje pojedinačnih stavki
4. CSS Styles
[MODIFY] 
Styles.html
Novi stilovi:

.order-wizard-modal - multi-step wizard
.order-filter-section - filtere za multiselekciju
.checkbox-list - lista sa checkboxima
.order-card - kartica narudžbe u listi
.order-view-modal - modal za pregled
.order-print-template - print template
User Review Required
IMPORTANT

Multi-select implementacija: Planiram korištenje checkbokseva za odabir više projekata/proizvoda. Da li želite neki drugi UI (npr. dual-listbox, tag-based)?

IMPORTANT

Wizard vs Single Form: Predlažem step-by-step wizard (Projekti → Proizvodi → Dobavljač → Materijali → Kreiranje). Da li preferite sve na jednoj formi?

IMPORTANT

PDF Template: Print template će biti sličan ponudi. Da li trebate prilagođene podatke firme (logo, adresa, kontakt)?

Verification Plan
Manual Testing
Kreiranje narudžbe:

Otvoriti tab "Narudžbe"
Kliknuti "Nova Narudžba"
Odabrati više projekata
Odabrati proizvode iz tih projekata
Odabrati dobavljača
Vidjeti filtrirane materijale
Selektovati materijale
Kliknuti "Kreiraj"
Provjeriti da narudžba postoji u listi
Pregled i uređivanje narudžbe:

Kliknuti na postojeću narudžbu
Provjeriti da se otvara modal sa detaljima
Kliknuti "Uredi" i promijeniti nešto
Sačuvati i provjeriti da su izmjene vidljive
Print PDF:

Otvoriti narudžbu
Kliknuti "Printaj"
Provjeriti da se otvara print preview sa formatiranim dokumentom
