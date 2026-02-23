/**
 * SnapshotManager - Gestion des snapshots git pour le rollback
 *
 * Capture l'état git (commit hash + stash) avant chaque phase,
 * permettant de revenir à un état précédent en cas d'échec.
 *
 * Persistance dans .claude/orchestrator/snapshots/snapshots.json
 * Cap: 50 snapshots (FIFO).
 */

import { exec } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { EventBus } from './EventBus.js';
import { logInfo, logDebug, logError, logWarn } from '../utils/safe-logger.js';

const execAsync = promisify(exec);

// ============================================================================
// TYPES
// ============================================================================

export interface Snapshot {
    id: string;
    workflowId: string;
    phaseId: string;
    commitHash: string;
    hasStagedChanges: boolean;
    hasUnstagedChanges: boolean;
    stashRef: string | null;
    createdAt: string; // ISO 8601
    description: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const SNAPSHOTS_CAP = 50;
const GIT_TIMEOUT = 15_000; // 15s

// ============================================================================
// SNAPSHOT MANAGER
// ============================================================================

export class SnapshotManager {
    private snapshotsDir: string;
    private snapshotsPath: string;
    private snapshots: Snapshot[] = [];
    private projectRoot: string;
    private eventBus: EventBus;
    private initialized = false;

    /** Write queue to prevent concurrent file writes. */
    private writeQueues = new Map<string, Promise<void>>();

    constructor(projectRoot: string, eventBus: EventBus) {
        this.projectRoot = projectRoot;
        this.eventBus = eventBus;
        this.snapshotsDir = join(projectRoot, '.claude', 'orchestrator', 'snapshots');
        this.snapshotsPath = join(this.snapshotsDir, 'snapshots.json');
    }

    async initialize(): Promise<void> {
        if (this.initialized) return;

        try {
            await mkdir(this.snapshotsDir, { recursive: true });
        } catch {
            // May exist
        }

        await this.loadSnapshots();

        this.initialized = true;
        logInfo(`SnapshotManager initialized: ${this.snapshots.length} snapshots loaded`);
    }

    // ========================================================================
    // PUBLIC API
    // ========================================================================

    /**
     * Crée un snapshot de l'état git courant.
     */
    async create(workflowId: string, phaseId: string, description: string): Promise<Snapshot> {
        const id = `snap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        const [commitHash, hasStagedChanges, hasUnstagedChanges, stashRef] = await Promise.all([
            this.getCommitHash(),
            this.checkStagedChanges(),
            this.checkUnstagedChanges(),
            this.createStash(),
        ]);

        const snapshot: Snapshot = {
            id,
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

        // Enforce cap (FIFO)
        while (this.snapshots.length > SNAPSHOTS_CAP) {
            this.snapshots.shift();
        }

        await this.saveSnapshots();

        this.eventBus.emit('snapshot:created', {
            snapshotId: id,
            description,
        });

        logInfo(`Snapshot created: ${id} (${description})`);
        return snapshot;
    }

    /**
     * Liste les snapshots, optionnellement filtrés par workflow.
     */
    list(workflowId?: string): Snapshot[] {
        if (workflowId) {
            return this.snapshots.filter(s => s.workflowId === workflowId);
        }
        return [...this.snapshots];
    }

    /**
     * Récupère un snapshot par ID.
     */
    get(snapshotId: string): Snapshot | undefined {
        return this.snapshots.find(s => s.id === snapshotId);
    }

    /**
     * Restaure un snapshot en appliquant le stash ref.
     */
    async restore(snapshotId: string): Promise<Snapshot> {
        const snapshot = this.snapshots.find(s => s.id === snapshotId);
        if (!snapshot) {
            throw new Error(`Snapshot not found: ${snapshotId}`);
        }

        if (snapshot.stashRef) {
            await this.applyStash(snapshot.stashRef);
        }

        this.eventBus.emit('snapshot:restored', {
            snapshotId: snapshot.id,
        });

        logInfo(`Snapshot restored: ${snapshot.id}`);
        return snapshot;
    }

    /**
     * Supprime un snapshot par ID.
     */
    async delete(snapshotId: string): Promise<void> {
        const index = this.snapshots.findIndex(s => s.id === snapshotId);
        if (index === -1) {
            throw new Error(`Snapshot not found: ${snapshotId}`);
        }

        this.snapshots.splice(index, 1);
        await this.saveSnapshots();

        logDebug(`Snapshot deleted: ${snapshotId}`);
    }

    /**
     * Nombre de snapshots stockés.
     */
    get count(): number {
        return this.snapshots.length;
    }

    // ========================================================================
    // GIT OPERATIONS (private)
    // ========================================================================

    private async execGit(cmd: string): Promise<string> {
        try {
            const { stdout } = await execAsync(`git ${cmd}`, {
                cwd: this.projectRoot,
                timeout: GIT_TIMEOUT,
            });
            return stdout.trim();
        } catch (err: unknown) {
            // Some git commands use exit code 1 for valid results (e.g., diff --quiet)
            // Re-throw to let callers handle
            throw err;
        }
    }

    private async getCommitHash(): Promise<string> {
        try {
            return await this.execGit('rev-parse HEAD');
        } catch {
            return 'unknown';
        }
    }

    private async checkStagedChanges(): Promise<boolean> {
        try {
            await this.execGit('diff --cached --quiet');
            return false; // exit 0 = no changes
        } catch {
            return true; // exit 1 = has changes
        }
    }

    private async checkUnstagedChanges(): Promise<boolean> {
        try {
            await this.execGit('diff --quiet');
            return false; // exit 0 = no changes
        } catch {
            return true; // exit 1 = has changes
        }
    }

    private async createStash(): Promise<string | null> {
        try {
            const ref = await this.execGit('stash create');
            return ref || null; // empty string if nothing to stash
        } catch {
            return null;
        }
    }

    private async applyStash(ref: string): Promise<void> {
        try {
            await this.execGit(`stash apply ${ref}`);
        } catch (err) {
            logWarn(`Failed to apply stash ${ref}`, err);
            throw new Error(`Failed to apply stash: ${ref}`);
        }
    }

    // ========================================================================
    // PERSISTENCE
    // ========================================================================

    private async loadSnapshots(): Promise<void> {
        try {
            const raw = await readFile(this.snapshotsPath, 'utf-8');
            const parsed = JSON.parse(raw);
            this.snapshots = Array.isArray(parsed) ? parsed : [];
        } catch {
            this.snapshots = [];
            logDebug('No previous snapshots found');
        }
    }

    private async saveSnapshots(): Promise<void> {
        await this.enqueueWrite(this.snapshotsPath, () =>
            writeFile(this.snapshotsPath, JSON.stringify(this.snapshots, null, 2), 'utf-8'),
        );
    }

    /**
     * Serialise les écritures vers un même fichier.
     */
    private async enqueueWrite(filePath: string, writeFn: () => Promise<void>): Promise<void> {
        const previous = this.writeQueues.get(filePath) ?? Promise.resolve();
        const current = previous.then(async () => {
            try {
                await writeFn();
            } catch (err) {
                logError(`Failed to write ${filePath}`, err);
            }
        });
        this.writeQueues.set(filePath, current);
        await current;
    }
}
