# Furniture Production ERP - Next.js + Firebase

ERP aplikacija za praćenje proizvodnje namještaja sa Firebase bazom podataka, spremna za deployment na Vercel.

## 🚀 Brzi početak

### 1. Instaliraj dependencies

```bash
cd "erp web"
npm install
```

### 2. Kreiraj Firebase projekat

1. Idi na [Firebase Console](https://console.firebase.google.com/)
2. Klikni "Add project" i kreiraj novi projekat
3. U projektu, idi na **Project Settings** > **General** > **Your apps**
4. Klikni **Web app** (</>)  i registriraj novu web aplikaciju
5. Kopiraj Firebase configuration

### 3. Podesi environment varijable

Kreiraj `.env.local` datoteku (kopiraj iz `.env.local.example`):

```bash
cp .env.local.example .env.local
```

Popuni vrijednosti u `.env.local`:

```
NEXT_PUBLIC_FIREBASE_API_KEY=tvoj_api_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=tvoj_project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=tvoj_project_id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=tvoj_project.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=tvoj_sender_id
NEXT_PUBLIC_FIREBASE_APP_ID=tvoj_app_id
```

### 4. Omogući Firestore

1. U Firebase Console, idi na **Build** > **Firestore Database**
2. Klikni **Create database**
3. Odaberi **Start in test mode** (za development)
4. Odaberi lokaciju (npr. europe-west1)

### 5. Pokreni lokalno

```bash
npm run dev
```

Otvori [http://localhost:3000](http://localhost:3000)

---

## 📤 Deploy na Vercel

### Opcija 1: GitHub + Vercel (Preporučeno)

1. **Inicijaliziraj Git repo:**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   ```

2. **Kreiraj GitHub repo:**
   - Idi na [GitHub](https://github.com/new)
   - Kreiraj novi repository
   - Push-aj kod:
   ```bash
   git remote add origin https://github.com/TVOJ_USERNAME/erp-firebase.git
   git branch -M main
   git push -u origin main
   ```

3. **Poveži sa Vercel:**
   - Idi na [Vercel](https://vercel.com)
   - Klikni "Add New" > "Project"
   - Importiraj GitHub repo
   - U **Environment Variables** dodaj sve iz `.env.local`
   - Deploy!

### Opcija 2: Vercel CLI

```bash
npm i -g vercel
vercel login
vercel --prod
```

---

## 📁 Struktura projekta

```
erp web/
├── app/
│   ├── layout.tsx      # Root layout
│   ├── page.tsx        # Main page
│   └── globals.css     # Global styles
├── components/
│   ├── ui/
│   │   ├── Modal.tsx
│   │   ├── Toast.tsx
│   │   └── LoadingOverlay.tsx
│   └── tabs/
│       ├── ProjectsTab.tsx
│       ├── OffersTab.tsx
│       ├── OrdersTab.tsx
│       ├── MaterialsTab.tsx
│       ├── WorkersTab.tsx
│       └── SuppliersTab.tsx
├── lib/
│   ├── firebase.ts     # Firebase config
│   ├── database.ts     # Firestore CRUD operations
│   └── types.ts        # TypeScript interfaces
├── .env.local.example  # Environment template
└── package.json
```

---

## 🔒 Firebase Security Rules

Za produkciju, ažuriraj Firestore Rules u Firebase Console:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Dozvoli sve za development (PROMIJENI ZA PRODUKCIJU!)
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

Za produkciju sa autentifikacijom:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

---

## 🛠️ Tehnologije

- **Framework:** Next.js 14 (App Router)
- **Baza podataka:** Firebase Firestore
- **Stilovi:** Vanilla CSS (Apple design system)
- **Jezik:** TypeScript
- **Deployment:** Vercel

---

## 📝 Napomene

- Aplikacija koristi client-side rendering za interaktivnost
- Svi podaci se čuvaju u Firestore collections
- Firebase konfiguracija se učitava iz environment varijabli
- Vercel automatski prebuilds aplikaciju na svaki push

---

## 🆘 Troubleshooting

### "Firebase: Error (app/invalid-api-key)"
- Provjeri da su environment varijable ispravno postavljene
- Provjeri da `.env.local` nije committan u git

### "PERMISSION_DENIED" u Firestore
- Idi u Firebase Console > Firestore > Rules
- Postavi rules u test mode

### Build fails na Vercel
- Provjeri da su sve environment varijable dodane u Vercel dashboard
- Provjeri console logs u Vercel deploymentu
