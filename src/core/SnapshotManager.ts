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

export interface SnapshotResult {
    snapshot: Snapshot | null;
    warning?: string;
}

export interface FileBaseline {
    untracked: Set<string>;
    modified: Set<string>;
    staged: Set<string>;
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
    async createSnapshot(workflowId: WorkflowId, phaseId: PhaseId, description: string): Promise<SnapshotResult> {
        try {
            const isGitRepo = await this.isGitRepository();
            if (!isGitRepo) {
                const warning = 'SnapshotManager: Not a git repository. Snapshots are disabled. Initialize a git repo to enable rollback capabilities.';
                console.error(warning);
                return { snapshot: null, warning };
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

            return { snapshot };
        } catch (err) {
            const warning = `SnapshotManager: Failed to create snapshot: ${err instanceof Error ? err.message : String(err)}`;
            console.error(warning);
            return { snapshot: null, warning };
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
     * Returns the current HEAD commit hash (public accessor for git diff tracking)
     */
    async getHeadCommitHash(): Promise<string | null> {
        try {
            const isGitRepo = await this.isGitRepository();
            if (!isGitRepo) return null;
            return await this.getCurrentCommitHash();
        } catch {
            return null;
        }
    }

    /**
     * Captures a baseline of all currently known files (untracked, modified, staged).
     * Call this BEFORE dispatching an interactive phase, then pass the result
     * to getChangedFiles() AFTER the phase to get only the delta.
     */
    async captureFileBaseline(): Promise<FileBaseline> {
        const baseline: FileBaseline = { untracked: new Set(), modified: new Set(), staged: new Set() };
        try {
            const isGitRepo = await this.isGitRepository();
            if (!isGitRepo) return baseline;

            // Untracked files
            const untrackedOutput = await this.git('ls-files', '--others', '--exclude-standard');
            for (const f of untrackedOutput.split('\n').filter(Boolean)) {
                baseline.untracked.add(f);
            }

            // Unstaged modifications
            const modifiedOutput = await this.git('diff', '--name-only');
            for (const f of modifiedOutput.split('\n').filter(Boolean)) {
                baseline.modified.add(f);
            }

            // Staged changes
            const stagedOutput = await this.git('diff', '--cached', '--name-only');
            for (const f of stagedOutput.split('\n').filter(Boolean)) {
                baseline.staged.add(f);
            }
        } catch {
            // Ignore errors
        }
        return baseline;
    }

    /**
     * Returns files changed since a given commit hash.
     * Uses git diff --name-status for tracked changes and git ls-files for new untracked files.
     * When a baseline is provided, only returns files NOT present in the baseline (delta).
     */
    async getChangedFiles(sinceCommit?: string, baseline?: FileBaseline): Promise<{ created: string[]; modified: string[]; deleted: string[] }> {
        const result = { created: [] as string[], modified: [] as string[], deleted: [] as string[] };

        try {
            const isGitRepo = await this.isGitRepository();
            if (!isGitRepo) return result;

            if (sinceCommit) {
                // Tracked changes since the given commit
                const diffOutput = await this.git('diff', '--name-status', sinceCommit);
                for (const line of diffOutput.split('\n').filter(Boolean)) {
                    const [status, ...fileParts] = line.split('\t');
                    const file = fileParts.join('\t');
                    if (!file) continue;
                    switch (status) {
                        case 'A': result.created.push(file); break;
                        case 'M': result.modified.push(file); break;
                        case 'D': result.deleted.push(file); break;
                        default:
                            if (status?.startsWith('R')) {
                                result.modified.push(fileParts[fileParts.length - 1] || file);
                            } else {
                                result.modified.push(file);
                            }
                    }
                }
            }

            // Untracked files (newly created, not yet added to git)
            const untrackedOutput = await this.git('ls-files', '--others', '--exclude-standard');
            for (const file of untrackedOutput.split('\n').filter(Boolean)) {
                if (!result.created.includes(file)) {
                    result.created.push(file);
                }
            }

            // Also check staged but uncommitted changes
            try {
                const stagedOutput = await this.git('diff', '--cached', '--name-status');
                for (const line of stagedOutput.split('\n').filter(Boolean)) {
                    const [status, ...fileParts] = line.split('\t');
                    const file = fileParts.join('\t');
                    if (!file) continue;
                    switch (status) {
                        case 'A':
                            if (!result.created.includes(file)) result.created.push(file);
                            break;
                        case 'M':
                            if (!result.modified.includes(file)) result.modified.push(file);
                            break;
                        case 'D':
                            if (!result.deleted.includes(file)) result.deleted.push(file);
                            break;
                    }
                }
            } catch {
                // Ignore errors from staged diff
            }

            // If a baseline was provided, subtract files that already existed before the phase
            if (baseline) {
                const allBaseline = new Set([...baseline.untracked, ...baseline.modified, ...baseline.staged]);
                result.created = result.created.filter(f => !allBaseline.has(f));
                result.modified = result.modified.filter(f => !allBaseline.has(f));
                // deleted: keep all — if a file was deleted during the phase, that's new
            }

            return result;
        } catch {
            return result;
        }
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
