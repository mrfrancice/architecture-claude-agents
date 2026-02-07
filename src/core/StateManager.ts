/**
 * StateManager - Persistance de l'état des workflows
 *
 * Stocke l'état dans .claude/orchestrator/ :
 * - state.json : workflow courant + session
 * - history.json : historique des workflows terminés
 * - stats.json : statistiques agrégées
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import type { Workflow, WorkflowId } from '../types/core.js';

// ============================================================================
// TYPES
// ============================================================================

export interface SessionState {
    sessionId: string;
    startedAt: string;
    currentWorkflowId: WorkflowId | null;
}

export interface PersistedState {
    session: SessionState;
    currentWorkflow: Workflow | null;
}

export interface WorkflowHistoryEntry {
    id: WorkflowId;
    type: string;
    task: string;
    status: string;
    totalScore: number | null;
    startedAt: string | null;
    completedAt: string | null;
    phasesCount: number;
    phasesCompleted: number;
}

export interface OrchestratorStats {
    workflowsCompleted: number;
    workflowsFailed: number;
    workflowsCancelled: number;
    totalWorkflows: number;
    averageScore: number;
    scoreSum: number;
    scoreCount: number;
    totalHooksTriggered: number;
}

// ============================================================================
// STATE MANAGER
// ============================================================================

export class StateManager {
    private stateDir: string;
    private statePath: string;
    private historyPath: string;
    private statsPath: string;
    private initialized = false;

    constructor(projectRoot: string) {
        this.stateDir = join(projectRoot, '.claude', 'orchestrator');
        this.statePath = join(this.stateDir, 'state.json');
        this.historyPath = join(this.stateDir, 'history.json');
        this.statsPath = join(this.stateDir, 'stats.json');
    }

    /**
     * Initialise le StateManager (crée les dossiers si nécessaire)
     */
    async initialize(): Promise<void> {
        if (this.initialized) return;

        if (!existsSync(this.stateDir)) {
            await mkdir(this.stateDir, { recursive: true });
        }

        // Créer les fichiers par défaut s'ils n'existent pas
        if (!existsSync(this.statsPath)) {
            await this.writeJson(this.statsPath, this.defaultStats());
        }
        if (!existsSync(this.historyPath)) {
            await this.writeJson(this.historyPath, []);
        }

        this.initialized = true;
    }

    /**
     * Sauvegarde l'état courant
     */
    async saveState(session: SessionState, workflow: Workflow | null): Promise<void> {
        const state: PersistedState = {
            session,
            currentWorkflow: workflow ? this.serializeWorkflow(workflow) : null,
        };
        await this.writeJson(this.statePath, state);
    }

    /**
     * Charge l'état courant
     */
    async loadState(): Promise<PersistedState | null> {
        if (!existsSync(this.statePath)) return null;
        try {
            const data = await this.readJson<PersistedState>(this.statePath);
            if (data?.currentWorkflow) {
                data.currentWorkflow = this.deserializeWorkflow(data.currentWorkflow);
            }
            return data;
        } catch {
            return null;
        }
    }

    /**
     * Ajoute un workflow à l'historique
     */
    async addToHistory(workflow: Workflow): Promise<void> {
        const history = await this.getHistory();
        const entry: WorkflowHistoryEntry = {
            id: workflow.id,
            type: workflow.type,
            task: workflow.task,
            status: workflow.status,
            totalScore: workflow.totalScore,
            startedAt: workflow.startedAt?.toISOString() || null,
            completedAt: workflow.completedAt?.toISOString() || null,
            phasesCount: workflow.phases.length,
            phasesCompleted: workflow.phases.filter(p => p.status === 'PASS').length,
        };
        history.push(entry);
        // Garder les 100 derniers
        if (history.length > 100) history.splice(0, history.length - 100);
        await this.writeJson(this.historyPath, history);
    }

    /**
     * Récupère l'historique
     */
    async getHistory(): Promise<WorkflowHistoryEntry[]> {
        if (!existsSync(this.historyPath)) return [];
        try {
            return await this.readJson<WorkflowHistoryEntry[]>(this.historyPath) || [];
        } catch {
            return [];
        }
    }

    /**
     * Récupère les statistiques
     */
    async getStats(): Promise<OrchestratorStats> {
        if (!existsSync(this.statsPath)) return this.defaultStats();
        try {
            return await this.readJson<OrchestratorStats>(this.statsPath) || this.defaultStats();
        } catch {
            return this.defaultStats();
        }
    }

    /**
     * Met à jour les statistiques après un workflow terminé
     */
    async updateStats(workflow: Workflow): Promise<void> {
        const stats = await this.getStats();
        stats.totalWorkflows++;

        if (workflow.status === 'COMPLETE') {
            stats.workflowsCompleted++;
            if (workflow.totalScore !== null) {
                stats.scoreSum += workflow.totalScore;
                stats.scoreCount++;
                stats.averageScore = Math.round(stats.scoreSum / stats.scoreCount);
            }
        } else if (workflow.status === 'FAILED') {
            stats.workflowsFailed++;
        } else if (workflow.status === 'CANCELLED') {
            stats.workflowsCancelled++;
        }

        await this.writeJson(this.statsPath, stats);
    }

    /**
     * Incrémente le compteur de hooks
     */
    async incrementHooksTriggered(count = 1): Promise<void> {
        const stats = await this.getStats();
        stats.totalHooksTriggered += count;
        await this.writeJson(this.statsPath, stats);
    }

    /**
     * Supprime l'état courant
     */
    async clearState(): Promise<void> {
        if (existsSync(this.statePath)) {
            await writeFile(this.statePath, '{}', 'utf-8');
        }
    }

    // ========================================================================
    // PRIVATE
    // ========================================================================

    private defaultStats(): OrchestratorStats {
        return {
            workflowsCompleted: 0,
            workflowsFailed: 0,
            workflowsCancelled: 0,
            totalWorkflows: 0,
            averageScore: 0,
            scoreSum: 0,
            scoreCount: 0,
            totalHooksTriggered: 0,
        };
    }

    private serializeWorkflow(workflow: Workflow): Workflow {
        return JSON.parse(JSON.stringify(workflow));
    }

    private deserializeWorkflow(raw: Workflow): Workflow {
        return {
            ...raw,
            createdAt: new Date(raw.createdAt),
            startedAt: raw.startedAt ? new Date(raw.startedAt) : null,
            completedAt: raw.completedAt ? new Date(raw.completedAt) : null,
            phases: raw.phases.map(p => ({
                ...p,
                startedAt: p.startedAt ? new Date(p.startedAt) : null,
                completedAt: p.completedAt ? new Date(p.completedAt) : null,
            })),
        };
    }

    private async readJson<T>(path: string): Promise<T | null> {
        try {
            const content = await readFile(path, 'utf-8');
            return JSON.parse(content) as T;
        } catch {
            return null;
        }
    }

    private async writeJson(path: string, data: unknown): Promise<void> {
        await writeFile(path, JSON.stringify(data, null, 2), 'utf-8');
    }
}
