/**
 * firestoreClient.ts — Wrapped Firestore operations with retry, logging, and org-scoping
 * 
 * Provides a thin abstraction over raw Firestore calls that:
 * 1. Automatically retries transient failures (network issues)
 * 2. Enforces Organization_ID scoping on every query
 * 3. Provides type-safe document helpers
 * 4. Centralizes the getDb() null check
 */

import { db } from '../../firebase';
import {
    collection,
    doc,
    getDocs,
    getDoc,
    addDoc,
    updateDoc,
    deleteDoc,
    setDoc,
    query,
    where,
    writeBatch,
    DocumentReference,
    DocumentData,
    QueryConstraint,
    QuerySnapshot,
    WriteBatch,
    Firestore,
} from 'firebase/firestore';

// ============================================
// RETRY CONFIGURATION
// ============================================

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 500;

function isRetryable(error: unknown): boolean {
    if (error instanceof Error) {
        const msg = error.message.toLowerCase();
        return msg.includes('unavailable') ||
            msg.includes('deadline-exceeded') ||
            msg.includes('internal') ||
            msg.includes('network');
    }
    return false;
}

async function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function withRetry<T>(operation: () => Promise<T>, context: string): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;
            if (attempt < MAX_RETRIES && isRetryable(error)) {
                console.warn(`[FirestoreClient] Retry ${attempt + 1}/${MAX_RETRIES} for ${context}`);
                await sleep(RETRY_DELAY_MS * (attempt + 1));
            } else {
                break;
            }
        }
    }
    throw lastError;
}

// ============================================
// CORE: GET DB WITH NULL CHECK
// ============================================

export function getDb(): Firestore {
    if (!db) {
        throw new Error('Firebase is not initialized. This can only be called in the browser.');
    }
    return db;
}

// ============================================
// QUERY HELPERS
// ============================================

/**
 * Query documents with automatic Organization_ID filtering.
 * Every query in the system needs org scoping — this ensures it.
 */
export async function queryByOrg<T>(
    collectionName: string,
    organizationId: string,
    ...extraConstraints: QueryConstraint[]
): Promise<T[]> {
    if (!organizationId) return [];

    const firestore = getDb();
    const constraints: QueryConstraint[] = [
        where('Organization_ID', '==', organizationId),
        ...extraConstraints,
    ];

    const q = query(collection(firestore, collectionName), ...constraints);
    const snapshot = await withRetry(
        () => getDocs(q),
        `queryByOrg(${collectionName})`
    );

    return snapshot.docs.map(d => ({ ...d.data() } as T));
}

/**
 * Query a single document by its custom ID field + org.
 * Most entities use a custom ID field (e.g., Project_ID, Worker_ID) 
 * rather than the Firestore document ID.
 */
export async function findByIdAndOrg<T>(
    collectionName: string,
    idField: string,
    idValue: string,
    organizationId: string
): Promise<{ data: T | null; ref: DocumentReference | null }> {
    if (!organizationId || !idValue) return { data: null, ref: null };

    const firestore = getDb();
    const q = query(
        collection(firestore, collectionName),
        where(idField, '==', idValue),
        where('Organization_ID', '==', organizationId)
    );

    const snapshot = await withRetry(
        () => getDocs(q),
        `findByIdAndOrg(${collectionName}, ${idField}=${idValue})`
    );

    if (snapshot.empty) return { data: null, ref: null };

    return {
        data: { ...snapshot.docs[0].data() } as T,
        ref: snapshot.docs[0].ref,
    };
}

/**
 * Find the Firestore document ref for a custom ID + org.
 * Returns null if not found.
 */
export async function findRef(
    collectionName: string,
    idField: string,
    idValue: string,
    organizationId: string
): Promise<DocumentReference | null> {
    const result = await findByIdAndOrg(collectionName, idField, idValue, organizationId);
    return result.ref;
}

// ============================================
// WRITE HELPERS
// ============================================

/**
 * Create a new document in a collection.
 * Automatically strips undefined fields (Firestore doesn't like them).
 */
export async function createDoc(
    collectionName: string,
    data: Record<string, unknown>
): Promise<DocumentReference> {
    const firestore = getDb();
    const cleaned = stripUndefined(data);

    return withRetry(
        () => addDoc(collection(firestore, collectionName), cleaned),
        `createDoc(${collectionName})`
    );
}

/**
 * Update an existing document by its ref.
 */
export async function updateDocByRef(
    ref: DocumentReference,
    data: Record<string, unknown>
): Promise<void> {
    const cleaned = stripUndefined(data);
    return withRetry(
        () => updateDoc(ref, cleaned),
        `updateDoc`
    );
}

/**
 * Update a document found by custom ID field + org.
 * Returns false if document not found.
 */
export async function updateByIdAndOrg(
    collectionName: string,
    idField: string,
    idValue: string,
    organizationId: string,
    data: Record<string, unknown>
): Promise<boolean> {
    const ref = await findRef(collectionName, idField, idValue, organizationId);
    if (!ref) return false;

    await updateDocByRef(ref, data);
    return true;
}

/**
 * Delete a document by its ref.
 */
export async function deleteDocByRef(ref: DocumentReference): Promise<void> {
    return withRetry(
        () => deleteDoc(ref),
        'deleteDoc'
    );
}

/**
 * Delete all matching documents (by custom ID + org).
 * Returns the count of deleted documents.
 */
export async function deleteByIdAndOrg(
    collectionName: string,
    idField: string,
    idValue: string,
    organizationId: string
): Promise<number> {
    if (!organizationId || !idValue) return 0;

    const firestore = getDb();
    const q = query(
        collection(firestore, collectionName),
        where(idField, '==', idValue),
        where('Organization_ID', '==', organizationId)
    );

    const snapshot = await withRetry(
        () => getDocs(q),
        `deleteByIdAndOrg(${collectionName}, ${idField}=${idValue})`
    );

    if (snapshot.empty) return 0;

    const batch = writeBatch(firestore);
    snapshot.docs.forEach(d => batch.delete(d.ref));
    await withRetry(() => batch.commit(), 'deleteByIdAndOrg.batch');

    return snapshot.size;
}

// ============================================
// BATCH HELPERS
// ============================================

/**
 * Create a Firestore WriteBatch.
 */
export function createBatch(): WriteBatch {
    return writeBatch(getDb());
}

/**
 * Get a collection reference by name.
 */
export function getCollection(collectionName: string) {
    return collection(getDb(), collectionName);
}

/**
 * Get a document reference by collection name and document ID.
 */
export function getDocRef(collectionName: string, docId: string) {
    return doc(getDb(), collectionName, docId);
}

// ============================================
// UTILITY
// ============================================

/**
 * Remove undefined values from an object (Firestore throws on undefined).
 */
function stripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
        if (value !== undefined) {
            result[key] = value;
        }
    }
    return result;
}

/** Običan objekat (literal), a ne instanca klase (Timestamp, DocumentReference, Date…). */
function isPlainObject(v: unknown): v is Record<string, unknown> {
    if (v === null || typeof v !== 'object') return false;
    const proto = Object.getPrototypeOf(v);
    return proto === Object.prototype || proto === null;
}

/**
 * Duboko uklanja `undefined` iz cijelog stabla. Firestore odbija `undefined` BILO GDJE
 * u dokumentu (ne samo na vrhu), a `stripUndefined` je plitak — pa `undefined` ugniježđen
 * u nizu ili pod-objektu (npr. `Blocks[i].supplierRef.id`) prođe i sruši upis.
 *
 * Rekurzira SAMO kroz obične objekte i nizove; instance klasa (Timestamp, DocumentReference,
 * FieldValue, Date, GeoPoint) ostaju netaknute da se Firestore sentinel-vrijednosti ne pokvare.
 */
export function deepStripUndefined<T>(value: T): T {
    if (Array.isArray(value)) {
        return value
            .filter(v => v !== undefined)
            .map(v => deepStripUndefined(v)) as unknown as T;
    }
    if (isPlainObject(value)) {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value)) {
            if (v === undefined) continue;
            out[k] = deepStripUndefined(v);
        }
        return out as unknown as T;
    }
    return value;
}

// Re-export commonly used Firestore functions so services don't need to import from firebase/firestore
export {
    collection,
    doc,
    getDocs,
    getDoc,
    addDoc,
    updateDoc,
    deleteDoc,
    setDoc,
    query,
    where,
    writeBatch,
    onSnapshot,
    Timestamp,
} from 'firebase/firestore';
export type { DocumentReference, QueryConstraint, WriteBatch };
