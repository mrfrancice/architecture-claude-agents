/**
 * StateManager - Persistance de l'état dans .claude/orchestrator/
 *
 * Gère trois fichiers :
 * - state.json  : session courante + workflow actif
 * - history.json : historique des workflows (cap 100)
 * - stats.json  : statistiques agrégées
 *
 * Les Date sont sérialisées en ISO string et restaurées au chargement.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Workflow } from '../types/core.js';
import { logInfo, logDebug, logError, logWarn } from '../utils/safe-logger.js';

// ============================================================================
// TYPES
// ============================================================================

export interface OrchestratorState {
    sessionId: string;
    startedAt: string;
    currentWorkflow: Workflow | null;
}

export interface WorkflowHistoryEntry {
    id: string;
    type: string;
    task: string;
    status: string;
    totalScore: number | null;
    startedAt: string | null;
    completedAt: string | null;
    phaseCount: number;
}

export interface OrchestratorStats {
    workflowsCompleted: number;
    workflowsFailed: number;
    workflowsCancelled: number;
    totalPhases: number;
    averageScore: number;
    scoreSum: number;
    scoreCount: number;
    totalHooksTriggered: number;
    lastUpdated: string;
}

// ============================================================================
// STATE MANAGER
// ============================================================================

const HISTORY_CAP = 100;

export class StateManager {
    private stateDir: string;
    private statePath: string;
    private historyPath: string;
    private statsPath: string;

    private state: OrchestratorState;
    private history: WorkflowHistoryEntry[] = [];
    private stats: OrchestratorStats;
    private initialized = false;

    /** Write queues to prevent concurrent file writes from clobbering each other. */
    private writeQueues = new Map<string, Promise<void>>();

    constructor(projectRoot: string) {
        this.stateDir = join(projectRoot, '.claude', 'orchestrator');
        this.statePath = join(this.stateDir, 'state.json');
        this.historyPath = join(this.stateDir, 'history.json');
        this.statsPath = join(this.stateDir, 'stats.json');

        const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        this.state = {
            sessionId,
            startedAt: new Date().toISOString(),
            currentWorkflow: null,
        };
        this.stats = this.defaultStats();
    }

    async initialize(): Promise<void> {
        if (this.initialized) return;

        try {
            await mkdir(this.stateDir, { recursive: true });
        } catch {
            // May exist
        }

        // Restore persisted state
        await Promise.all([
            this.loadState(),
            this.loadHistory(),
            this.loadStats(),
        ]);

        this.initialized = true;
        logInfo('StateManager initialized');
    }

    // ========================================================================
    // STATE
    // ========================================================================

    get sessionId(): string {
        return this.state.sessionId;
    }

    getWorkflow(): Workflow | null {
        return this.state.currentWorkflow;
    }

    async setWorkflow(workflow: Workflow | null): Promise<void> {
        this.state.currentWorkflow = workflow;
        await this.saveState();
    }

    async updateWorkflow(updater: (w: Workflow) => void): Promise<void> {
        if (!this.state.currentWorkflow) {
            logWarn('updateWorkflow called but no current workflow exists');
            return;
        }
        updater(this.state.currentWorkflow);
        await this.saveState();
    }

    // ========================================================================
    // HISTORY
    // ========================================================================

    async addToHistory(workflow: Workflow): Promise<void> {
        const entry: WorkflowHistoryEntry = {
            id: workflow.id,
            type: workflow.type,
            task: workflow.task,
            status: workflow.status,
            totalScore: workflow.totalScore,
            startedAt: workflow.startedAt?.toISOString() ?? null,
            completedAt: workflow.completedAt?.toISOString() ?? null,
            phaseCount: workflow.phases.length,
        };

        this.history.unshift(entry);
        if (this.history.length > HISTORY_CAP) {
            this.history = this.history.slice(0, HISTORY_CAP);
        }

        await this.saveHistory();
    }

    getHistory(): WorkflowHistoryEntry[] {
        return [...this.history];
    }

    // ========================================================================
    // STATS
    // ========================================================================

    getStats(): OrchestratorStats {
        return { ...this.stats };
    }

    async recordWorkflowComplete(score: number | null): Promise<void> {
        this.stats.workflowsCompleted++;
        if (score !== null) {
            this.stats.scoreSum += score;
            this.stats.scoreCount++;
            this.stats.averageScore = Math.round(this.stats.scoreSum / this.stats.scoreCount);
        }
        this.stats.lastUpdated = new Date().toISOString();
        await this.saveStats();
    }

    async recordWorkflowFailed(): Promise<void> {
        this.stats.workflowsFailed++;
        this.stats.lastUpdated = new Date().toISOString();
        await this.saveStats();
    }

    async recordWorkflowCancelled(): Promise<void> {
        this.stats.workflowsCancelled++;
        this.stats.lastUpdated = new Date().toISOString();
        await this.saveStats();
    }

    async recordHookTriggered(): Promise<void> {
        this.stats.totalHooksTriggered++;
        await this.saveStats();
    }

    async recordPhaseComplete(): Promise<void> {
        this.stats.totalPhases++;
        await this.saveStats();
    }

    // ========================================================================
    // PERSISTENCE
    // ========================================================================

    private async loadState(): Promise<void> {
        try {
            const raw = await readFile(this.statePath, 'utf-8');
            const parsed = JSON.parse(raw) as OrchestratorState;
            // Restore dates in workflow
            if (parsed.currentWorkflow) {
                this.restoreWorkflowDates(parsed.currentWorkflow);
            }
            // Keep new session ID but restore workflow if it was running
            if (parsed.currentWorkflow && parsed.currentWorkflow.status === 'PAUSED') {
                this.state.currentWorkflow = parsed.currentWorkflow;
                logInfo('Restored paused workflow from previous session');
            }
        } catch {
            logDebug('No previous state found');
        }
    }

    private async saveState(): Promise<void> {
        await this.enqueueWrite(this.statePath, () =>
            writeFile(this.statePath, JSON.stringify(this.state, null, 2), 'utf-8'),
        );
    }

    private async loadHistory(): Promise<void> {
        try {
            const raw = await readFile(this.historyPath, 'utf-8');
            this.history = JSON.parse(raw) as WorkflowHistoryEntry[];
        } catch {
            this.history = [];
        }
    }

    private async saveHistory(): Promise<void> {
        await this.enqueueWrite(this.historyPath, () =>
            writeFile(this.historyPath, JSON.stringify(this.history, null, 2), 'utf-8'),
        );
    }

    private async loadStats(): Promise<void> {
        try {
            const raw = await readFile(this.statsPath, 'utf-8');
            this.stats = { ...this.defaultStats(), ...JSON.parse(raw) };
        } catch {
            this.stats = this.defaultStats();
        }
    }

    private async saveStats(): Promise<void> {
        await this.enqueueWrite(this.statsPath, () =>
            writeFile(this.statsPath, JSON.stringify(this.stats, null, 2), 'utf-8'),
        );
    }

    /**
     * Serialise les ecritures vers un meme fichier.
     * Chaque ecriture attend la fin de la precedente pour eviter les race conditions.
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

    private restoreWorkflowDates(workflow: Workflow): void {
        if (workflow.createdAt) workflow.createdAt = new Date(workflow.createdAt);
        if (workflow.startedAt) workflow.startedAt = new Date(workflow.startedAt);
        if (workflow.completedAt) workflow.completedAt = new Date(workflow.completedAt);
        for (const phase of workflow.phases) {
            if (phase.startedAt) phase.startedAt = new Date(phase.startedAt);
            if (phase.completedAt) phase.completedAt = new Date(phase.completedAt);
        }
    }

    private defaultStats(): OrchestratorStats {
        return {
            workflowsCompleted: 0,
            workflowsFailed: 0,
            workflowsCancelled: 0,
            totalPhases: 0,
            averageScore: 0,
            scoreSum: 0,
            scoreCount: 0,
            totalHooksTriggered: 0,
            lastUpdated: new Date().toISOString(),
        };
    }
}
