import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { getFirestore, Firestore, enableIndexedDbPersistence } from 'firebase/firestore';
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
    _db = getFirestore(app);
    _auth = getAuth(app);

    // Enable offline persistence — data is cached in IndexedDB so
    // reads and writes work while the device is offline.
    enableIndexedDbPersistence(_db).catch((err) => {
        if (err.code === 'failed-precondition') {
            // Multiple tabs open — persistence can only be enabled in one tab at a time
            console.warn('Firestore persistence failed: Multiple tabs open');
        } else if (err.code === 'unimplemented') {
            // The current browser does not support all features required for persistence
            console.warn('Firestore persistence failed: Browser not supported');
        }
    });
}

// Export with type assertions - these will only be used in browser context
// where they are guaranteed to be initialized
export const db = _db as Firestore;
export const auth = _auth as Auth;
export default app;
