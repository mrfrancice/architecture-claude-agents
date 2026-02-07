/**
 * SnapshotManager - Points de restauration basés sur git
 *
 * Utilise git pour créer des snapshots avant chaque phase :
 * - Enregistre le commit HEAD courant
 * - Sauvegarde les modifications non commitées (stash)
 * - Permet de restaurer un état précédent
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import type { SnapshotId, WorkflowId, PhaseId } from '../types/core.js';

const execFileAsync = promisify(execFile);

// ============================================================================
// TYPES
// ============================================================================

export interface Snapshot {
    id: SnapshotId;
    workflowId: WorkflowId;
    phaseId: PhaseId;
    commitHash: string;
    hasStagedChanges: boolean;
    hasUnstagedChanges: boolean;
    stashRef: string | null;
    createdAt: string;
    description: string;
}

// ============================================================================
// SNAPSHOT MANAGER
// ============================================================================

export class SnapshotManager {
    private projectRoot: string;
    private snapshotsDir: string;
    private snapshotsFile: string;
    private snapshots: Snapshot[] = [];

    constructor(projectRoot: string) {
        this.projectRoot = projectRoot;
        this.snapshotsDir = join(projectRoot, '.claude', 'orchestrator', 'snapshots');
        this.snapshotsFile = join(this.snapshotsDir, 'snapshots.json');
    }

    /**
     * Initialise le SnapshotManager
     */
    async initialize(): Promise<void> {
        if (!existsSync(this.snapshotsDir)) {
            await mkdir(this.snapshotsDir, { recursive: true });
        }
        await this.loadSnapshots();
    }

    /**
     * Crée un snapshot avant une phase
     */
    async createSnapshot(workflowId: WorkflowId, phaseId: PhaseId, description: string): Promise<Snapshot | null> {
        try {
            const isGitRepo = await this.isGitRepository();
            if (!isGitRepo) {
                console.error('SnapshotManager: Not a git repository, skipping snapshot');
                return null;
            }

            const commitHash = await this.getCurrentCommitHash();
            const hasStagedChanges = await this.hasStagedChanges();
            const hasUnstagedChanges = await this.hasUnstagedChanges();

            let stashRef: string | null = null;

            // Stash les modifications non commitées
            if (hasStagedChanges || hasUnstagedChanges) {
                stashRef = await this.createStash(`orchestrator_${phaseId}`);
            }

            const snapshot: Snapshot = {
                id: `snap_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                workflowId,
                phaseId,
                commitHash,
                hasStagedChanges,
                hasUnstagedChanges,
                stashRef,
                createdAt: new Date().toISOString(),
                description,
            };

            this.snapshots.push(snapshot);
            await this.saveSnapshots();

            // Ré-appliquer le stash immédiatement (on veut juste l'avoir en backup)
            if (stashRef) {
                await this.applyStash(stashRef);
            }

            return snapshot;
        } catch (err) {
            console.error('SnapshotManager: Failed to create snapshot:', err);
            return null;
        }
    }

    /**
     * Restaure un snapshot
     */
    async restore(snapshotId?: SnapshotId): Promise<{ success: boolean; error?: string }> {
        const snapshot = snapshotId
            ? this.snapshots.find(s => s.id === snapshotId)
            : this.getLatestSnapshot();

        if (!snapshot) {
            return { success: false, error: snapshotId ? `Snapshot ${snapshotId} not found` : 'No snapshots available' };
        }

        try {
            const isGitRepo = await this.isGitRepository();
            if (!isGitRepo) {
                return { success: false, error: 'Not a git repository' };
            }

            // Reset au commit du snapshot
            await this.git('reset', '--hard', snapshot.commitHash);

            // Ré-appliquer le stash si disponible
            if (snapshot.stashRef) {
                try {
                    await this.applyStash(snapshot.stashRef);
                } catch {
                    // Le stash peut avoir été supprimé, on continue
                    console.error('SnapshotManager: Could not apply stash, continuing with commit state');
                }
            }

            return { success: true };
        } catch (err) {
            return {
                success: false,
                error: `Rollback failed: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    }

    /**
     * Récupère le dernier snapshot
     */
    getLatestSnapshot(): Snapshot | null {
        return this.snapshots.length > 0 ? this.snapshots[this.snapshots.length - 1] : null;
    }

    /**
     * Récupère un snapshot par ID
     */
    getSnapshot(id: SnapshotId): Snapshot | null {
        return this.snapshots.find(s => s.id === id) || null;
    }

    /**
     * Liste tous les snapshots
     */
    listSnapshots(): Snapshot[] {
        return [...this.snapshots];
    }

    /**
     * Supprime les snapshots d'un workflow
     */
    async cleanupWorkflow(workflowId: WorkflowId): Promise<void> {
        this.snapshots = this.snapshots.filter(s => s.workflowId !== workflowId);
        await this.saveSnapshots();
    }

    // ========================================================================
    // GIT OPERATIONS
    // ========================================================================

    private async git(...args: string[]): Promise<string> {
        try {
            const { stdout } = await execFileAsync('git', args, {
                cwd: this.projectRoot,
                timeout: 30000,
            });
            return stdout.trim();
        } catch (err) {
            const error = err as { stderr?: string; message?: string };
            throw new Error(error.stderr || error.message || 'Git command failed');
        }
    }

    private async isGitRepository(): Promise<boolean> {
        try {
            await this.git('rev-parse', '--is-inside-work-tree');
            return true;
        } catch {
            return false;
        }
    }

    private async getCurrentCommitHash(): Promise<string> {
        return this.git('rev-parse', 'HEAD');
    }

    private async hasStagedChanges(): Promise<boolean> {
        try {
            const result = await this.git('diff', '--cached', '--quiet');
            return false; // Exit 0 = no changes
        } catch {
            return true; // Exit 1 = has changes
        }
    }

    private async hasUnstagedChanges(): Promise<boolean> {
        try {
            await this.git('diff', '--quiet');
            return false;
        } catch {
            return true;
        }
    }

    private async createStash(message: string): Promise<string | null> {
        try {
            const result = await this.git('stash', 'push', '-m', message, '--include-untracked');
            if (result.includes('No local changes')) return null;
            // Récupérer la ref du stash
            const stashList = await this.git('stash', 'list', '--format=%H', '-1');
            return stashList || null;
        } catch {
            return null;
        }
    }

    private async applyStash(stashRef: string): Promise<void> {
        // Chercher le stash par ref dans la liste
        try {
            const stashList = await this.git('stash', 'list', '--format=%H');
            const stashes = stashList.split('\n').filter(Boolean);
            const index = stashes.indexOf(stashRef);
            if (index >= 0) {
                await this.git('stash', 'apply', `stash@{${index}}`);
            }
        } catch {
            // Fallback: essayer d'appliquer directement
            try {
                await this.git('stash', 'apply', stashRef);
            } catch {
                // Silently fail
            }
        }
    }

    // ========================================================================
    // PERSISTENCE
    // ========================================================================

    private async loadSnapshots(): Promise<void> {
        if (!existsSync(this.snapshotsFile)) {
            this.snapshots = [];
            return;
        }
        try {
            const content = await readFile(this.snapshotsFile, 'utf-8');
            this.snapshots = JSON.parse(content);
        } catch {
            this.snapshots = [];
        }
    }

    private async saveSnapshots(): Promise<void> {
        await writeFile(this.snapshotsFile, JSON.stringify(this.snapshots, null, 2), 'utf-8');
    }
}
