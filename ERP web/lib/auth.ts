import { auth, db } from './firebase';
import {
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signOut as firebaseSignOut,
    sendPasswordResetEmail,
    GoogleAuthProvider,
    signInWithPopup,
    onAuthStateChanged,
    User as FirebaseUser,
} from 'firebase/auth';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import type { User, Organization, ModuleAccess } from './types';

// ============================================
// AUTH FUNCTIONS
// ============================================

export async function signIn(email: string, password: string): Promise<{ success: boolean; error?: string }> {
    try {
        await signInWithEmailAndPassword(auth, email, password);
        return { success: true };
    } catch (error: any) {
        return { success: false, error: getAuthErrorMessage(error.code) };
    }
}

export async function signUp(
    email: string,
    password: string,
    organizationName: string,
    userName: string
): Promise<{ success: boolean; error?: string }> {
    try {
        // Create Firebase Auth user
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const firebaseUser = userCredential.user;

        // Create organization
        const orgId = firebaseUser.uid + '_org';
        const organization: Organization = {
            Organization_ID: orgId,
            Name: organizationName,
            Email: email,
            Phone: '',
            Address: '',
            Created_Date: new Date().toISOString(),
            Subscription_Plan: 'free',
            Modules: {
                offers: false,
                orders: false,
                reports: false,
                api_access: false,
            },
            Billing_Email: email,
            Is_Active: true,
        };

        // Create user profile
        const user: User = {
            User_ID: firebaseUser.uid,
            Email: email,
            Name: userName,
            Role: 'owner',
            Organization_ID: orgId,
            Created_Date: new Date().toISOString(),
            Last_Login: new Date().toISOString(),
            Is_Active: true,
        };

        // Save to Firestore
        await setDoc(doc(db, 'organizations', orgId), organization);
        await setDoc(doc(db, 'users', firebaseUser.uid), user);

        return { success: true };
    } catch (error: any) {
        return { success: false, error: getAuthErrorMessage(error.code) };
    }
}

export async function signOut(): Promise<void> {
    await firebaseSignOut(auth);
}

export async function resetPassword(email: string): Promise<{ success: boolean; error?: string }> {
    try {
        await sendPasswordResetEmail(auth, email);
        return { success: true };
    } catch (error: any) {
        return { success: false, error: getAuthErrorMessage(error.code) };
    }
}

export async function signInWithGoogle(): Promise<{ success: boolean; error?: string; isNewUser?: boolean }> {
    try {
        const provider = new GoogleAuthProvider();
        const result = await signInWithPopup(auth, provider);
        const firebaseUser = result.user;

        // Check if user profile exists
        const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));

        if (!userDoc.exists()) {
            // New user - create organization and profile
            const orgId = firebaseUser.uid + '_org';
            const organization: Organization = {
                Organization_ID: orgId,
                Name: firebaseUser.displayName || 'Moja Firma',
                Email: firebaseUser.email || '',
                Phone: '',
                Address: '',
                Created_Date: new Date().toISOString(),
                Subscription_Plan: 'free',
                Modules: {
                    offers: false,
                    orders: false,
                    reports: false,
                    api_access: false,
                },
                Billing_Email: firebaseUser.email || '',
                Is_Active: true,
            };

            const user: User = {
                User_ID: firebaseUser.uid,
                Email: firebaseUser.email || '',
                Name: firebaseUser.displayName || 'Korisnik',
                Role: 'owner',
                Organization_ID: orgId,
                Created_Date: new Date().toISOString(),
                Last_Login: new Date().toISOString(),
                Is_Active: true,
            };

            await setDoc(doc(db, 'organizations', orgId), organization);
            await setDoc(doc(db, 'users', firebaseUser.uid), user);

            return { success: true, isNewUser: true };
        }

        return { success: true, isNewUser: false };
    } catch (error: any) {
        return { success: false, error: getAuthErrorMessage(error.code) };
    }
}

// ============================================
// USER DATA FUNCTIONS
// ============================================

export async function getUserProfile(userId: string): Promise<User | null> {
    try {
        const userDoc = await getDoc(doc(db, 'users', userId));
        if (userDoc.exists()) {
            return userDoc.data() as User;
        }
        return null;
    } catch (error) {
        console.error('Error fetching user profile:', error);
        return null;
    }
}

export async function getOrganization(orgId: string): Promise<Organization | null> {
    try {
        const orgDoc = await getDoc(doc(db, 'organizations', orgId));
        if (orgDoc.exists()) {
            return orgDoc.data() as Organization;
        }
        return null;
    } catch (error) {
        console.error('Error fetching organization:', error);
        return null;
    }
}

export async function updateLastLogin(userId: string): Promise<void> {
    try {
        await setDoc(doc(db, 'users', userId), {
            Last_Login: new Date().toISOString(),
        }, { merge: true });
    } catch (error) {
        console.error('Error updating last login:', error);
    }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function getAuthErrorMessage(code: string): string {
    switch (code) {
        case 'auth/email-already-in-use':
            return 'Email adresa je već u upotrebi.';
        case 'auth/invalid-email':
            return 'Neispravan format email adrese.';
        case 'auth/operation-not-allowed':
            return 'Operacija nije dozvoljena.';
        case 'auth/weak-password':
            return 'Lozinka je preslaba. Koristite najmanje 6 karaktera.';
        case 'auth/user-disabled':
            return 'Korisnički račun je onemogućen.';
        case 'auth/user-not-found':
            return 'Korisnik sa ovom email adresom ne postoji.';
        case 'auth/wrong-password':
            return 'Pogrešna lozinka.';
        case 'auth/invalid-credential':
            return 'Neispravan email ili lozinka.';
        case 'auth/too-many-requests':
            return 'Previše pokušaja. Pokušajte ponovo kasnije.';
        case 'auth/popup-closed-by-user':
            return 'Prijava je otkazana.';
        default:
            return 'Došlo je do greške. Pokušajte ponovo.';
    }
}

export { onAuthStateChanged, type FirebaseUser };
