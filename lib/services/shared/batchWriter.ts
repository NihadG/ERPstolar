/**
 * batchWriter.ts — Auto-committing batch writer for Firestore
 * 
 * Firestore has a 500-operation limit per WriteBatch. This utility
 * automatically commits and creates a new batch when the limit is 
 * approaching, so callers don't need to manage batch size.
 * 
 * Usage:
 *   const writer = new AutoBatchWriter();
 *   writer.set(ref, data);
 *   writer.update(ref, data);
 *   writer.delete(ref);
 *   await writer.commit(); // Commits remaining operations
 */

import { getDb } from './firestoreClient';
import {
    writeBatch,
    DocumentReference,
    WriteBatch,
} from 'firebase/firestore';

const MAX_BATCH_SIZE = 450; // Leave headroom below Firestore's 500 limit

export class AutoBatchWriter {
    private batch: WriteBatch;
    private operationCount: number = 0;
    private totalOperations: number = 0;
    private commitCount: number = 0;

    constructor() {
        this.batch = writeBatch(getDb());
    }

    /**
     * Set a document (create or overwrite).
     */
    set(ref: DocumentReference, data: Record<string, unknown>): void {
        this.batch.set(ref, data);
        this.operationCount++;
        this.totalOperations++;
        this.autoFlush();
    }

    /**
     * Update a document (partial update).
     */
    update(ref: DocumentReference, data: Record<string, unknown>): void {
        this.batch.update(ref, data);
        this.operationCount++;
        this.totalOperations++;
        this.autoFlush();
    }

    /**
     * Delete a document.
     */
    delete(ref: DocumentReference): void {
        this.batch.delete(ref);
        this.operationCount++;
        this.totalOperations++;
        this.autoFlush();
    }

    /**
     * Check if the batch is approaching the limit and auto-commit if so.
     */
    private autoFlush(): void {
        if (this.operationCount >= MAX_BATCH_SIZE) {
            // We need to commit synchronously in the call chain,
            // so store the promise to be awaited in commit()
            this.pendingCommits.push(this.flushCurrentBatch());
        }
    }

    private pendingCommits: Promise<void>[] = [];

    private async flushCurrentBatch(): Promise<void> {
        const batchToCommit = this.batch;
        this.batch = writeBatch(getDb());
        this.operationCount = 0;
        this.commitCount++;
        await batchToCommit.commit();
    }

    /**
     * Commit all remaining operations.
     * Must be called at the end to ensure all writes are persisted.
     * 
     * @returns Total operation count
     */
    async commit(): Promise<number> {
        // Wait for any auto-flushes
        if (this.pendingCommits.length > 0) {
            await Promise.all(this.pendingCommits);
            this.pendingCommits = [];
        }

        // Commit remaining operations
        if (this.operationCount > 0) {
            await this.batch.commit();
            this.commitCount++;
            this.operationCount = 0;
        }

        return this.totalOperations;
    }

    /**
     * Get counts for diagnostics.
     */
    get stats() {
        return {
            totalOperations: this.totalOperations,
            pendingOperations: this.operationCount,
            commits: this.commitCount,
        };
    }
}
