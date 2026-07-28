import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import {
    getFirestore,
    initializeFirestore,
    persistentLocalCache,
    persistentMultipleTabManager,
    Firestore,
} from 'firebase/firestore';
import { getAuth, Auth } from 'firebase/auth';

const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Only initialize Firebase in the browser
let app: FirebaseApp | undefined;
let _db: Firestore | undefined;
let _auth: Auth | undefined;

if (typeof window !== 'undefined') {
    app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

    // OFFLINE KEŠ SE PODEŠAVA PRI INICIJALIZACIJI, ne naknadno.
    //
    // Ranije je ovdje stajao `enableIndexedDbPersistence(_db)`, koji je zastario i
    // usput dozvoljava keš u SAMO JEDNOM tabu: drugi otvoreni tab je padao na
    // memorijski keš uz grešku „Failed to obtain exclusive access to the
    // persistence layer". `persistentMultipleTabManager` dijeli isti IndexedDB
    // među tabovima, pa oba upozorenja nestaju, a keš radi u svakom tabu.
    try {
        _db = initializeFirestore(app, {
            localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
        });
    } catch {
        // initializeFirestore odbija drugi poziv na istoj instanci aplikacije
        // (hot reload, dvostruko učitavanje modula). Tada preuzmi već postojeću —
        // keš je tada onakav kakav je prvi poziv postavio, ali ništa ne puca.
        _db = getFirestore(app);
    }

    _auth = getAuth(app);
}

// Export with type assertions - these will only be used in browser context
// where they are guaranteed to be initialized
export const db = _db as Firestore;
export const auth = _auth as Auth;
export default app;
