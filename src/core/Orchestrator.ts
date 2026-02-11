/**
 * Orchestrator - Moteur principal d'orchestration
 *
 * Responsabilités :
 * - Coordonner les workflows multi-agents
 * - Gérer les phases, itérations et transitions
 * - Interfacer avec StateManager, ConfigLoader, EventBus,
 *   MemoryManager, SnapshotManager, ScoringEngine
 */

import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const execFileAsync = promisify(execFile);
import type {
    Workflow,
    WorkflowType,
    WorkflowPhase,
    PhaseOutput,
    PhaseMode,
    Result,
    ScoreResult,
    DispatchMode,
    PhaseDispatchResult,
    ManualDispatchPrompt,
    CustomWorkflowTemplate,
    AgentDefinition,
    AgentId,
    AgentOutput,
    TerminalSessionStatus,
} from '../types/core.js';
import { EventBus, getEventBus } from './EventBus.js';
import { StateManager, type OrchestratorStats } from './StateManager.js';
import { ConfigLoader, type ProjectConfig } from './ConfigLoader.js';
import { MemoryManager } from './MemoryManager.js';
import { SnapshotManager, type FileBaseline } from './SnapshotManager.js';
import { ScoringEngine } from './ScoringEngine.js';
import { HookEngine } from './HookEngine.js';
import { AgentRegistry, getAgentRegistry } from './AgentRegistry.js';
import { AgentDispatcher } from './AgentDispatcher.js';

// ============================================================================
// TYPES
// ============================================================================

export interface SystemStatus {
    initialized: boolean;
    sessionId: string | null;
    currentWorkflow: {
        id: string;
        type: string;
        status: string;
        currentPhase: string | null;
        progress: number;
        phases: Array<{
            id: string;
            name: string;
            status: string;
            iteration: number;
            score: number | null;
        }>;
    } | null;
    projectInfo: {
        name: string;
        language: string;
        framework: string | null;
        tools: Record<string, unknown>;
    } | null;
    hooksLoaded: number;
    memoriesLoaded: number;
    agents: {
        total: number;
        builtIn: number;
        custom: number;
        dispatchMode: DispatchMode;
    };
    stats: {
        workflowsCompleted: number;
        workflowsFailed: number;
        averageScore: number;
        totalHooksTriggered: number;
    };
}

// ============================================================================
// ORCHESTRATOR
// ============================================================================

export class Orchestrator {
    private initialized = false;
    private currentWorkflow: Workflow | null = null;
    private projectRoot: string;
    private sessionId: string;

    // Composants
    private eventBus: EventBus;
    private stateManager: StateManager;
    private configLoader: ConfigLoader;
    private memoryManager: MemoryManager;
    private snapshotManager: SnapshotManager;
    private scoringEngine: ScoringEngine | null = null;
    private hookEngine: HookEngine;
    private projectConfig: ProjectConfig | null = null;
    private agentRegistry: AgentRegistry;
    private agentDispatcher: AgentDispatcher | null = null;
    private dispatchMode: DispatchMode = 'manual';
    private terminalInteractive = false;
    private lastDispatchResult: PhaseDispatchResult | null = null;
    private customWorkflows = new Map<string, CustomWorkflowTemplate>();
    private prePhaseBaseline: FileBaseline | null = null;

    constructor(projectRoot?: string) {
        this.projectRoot = projectRoot || process.cwd();
        this.sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

        this.eventBus = getEventBus();
        this.stateManager = new StateManager(this.projectRoot);
        this.configLoader = new ConfigLoader(this.projectRoot);
        this.memoryManager = new MemoryManager(this.projectRoot);
        this.snapshotManager = new SnapshotManager(this.projectRoot);
        this.hookEngine = new HookEngine(this.projectRoot, this.eventBus);
        this.agentRegistry = getAgentRegistry(this.projectRoot);
    }

    /**
     * Initialise l'orchestrateur et tous ses composants
     */
    async initialize(): Promise<void> {
        if (this.initialized) return;

        // Initialiser les composants en parallèle
        await Promise.all([
            this.stateManager.initialize(),
            this.memoryManager.initialize(),
            this.snapshotManager.initialize(),
            this.hookEngine.initialize(),
            this.agentRegistry.initialize(),
        ]);

        // Creer le dispatcher
        this.agentDispatcher = new AgentDispatcher(
            this.agentRegistry,
            this.memoryManager,
            this.eventBus,
            this.dispatchMode,
        );

        // Charger les workflows custom
        await this.loadCustomWorkflows();

        // Charger la config projet
        this.projectConfig = await this.configLoader.load();

        // Créer le ScoringEngine avec les outils détectés
        this.scoringEngine = new ScoringEngine(this.projectRoot, this.projectConfig.tools);

        // Restaurer l'état précédent s'il existe
        const savedState = await this.stateManager.loadState();
        if (savedState?.currentWorkflow) {
            // Ne restaurer que les workflows non terminés
            const status = savedState.currentWorkflow.status;
            if (status === 'RUNNING' || status === 'PAUSED' || status === 'PENDING') {
                this.currentWorkflow = savedState.currentWorkflow;
                console.error(`Restored workflow ${this.currentWorkflow.id} (status: ${status})`);
            }
        }

        // Enregistrer les hooks EventBus pour la persistence
        this.setupEventHandlers();

        this.initialized = true;
        console.error('Orchestrator initialized');
    }

    // ========================================================================
    // WORKFLOW LIFECYCLE
    // ========================================================================

    /**
     * Démarre un nouveau workflow
     */
    async startWorkflow(type: WorkflowType, task: string, customName?: string): Promise<Result<Workflow>> {
        this.ensureInitialized();

        if (this.currentWorkflow && this.currentWorkflow.status === 'RUNNING') {
            return {
                success: false,
                error: new Error('A workflow is already running. Cancel or complete it first.'),
            };
        }

        const workflowId = `wf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        let phases: WorkflowPhase[];
        if (type === 'CUSTOM' && customName) {
            const template = this.customWorkflows.get(customName);
            if (!template) {
                return {
                    success: false,
                    error: new Error(`Custom workflow "${customName}" not found. Available: ${[...this.customWorkflows.keys()].join(', ')}`),
                };
            }
            phases = this.createPhasesFromTemplate(template, workflowId);
        } else {
            phases = this.createPhasesForType(type, workflowId);
        }

        // Charger les mémoires disponibles
        const memoryNames = await this.memoryManager.listNames();

        const workflow: Workflow = {
            id: workflowId,
            type,
            task,
            status: 'RUNNING',
            phases,
            currentPhaseIndex: 0,
            totalScore: null,
            createdAt: new Date(),
            startedAt: new Date(),
            completedAt: null,
            snapshotId: null,
            context: {
                memories: memoryNames,
                userPreferences: this.projectConfig?.preferences || {},
                projectInfo: this.projectConfig?.projectInfo || {
                    name: 'project',
                    type: 'unknown',
                    language: 'unknown',
                    framework: null,
                    rootPath: this.projectRoot,
                },
            },
        };

        this.currentWorkflow = workflow;

        // Créer un snapshot initial
        const snapshotResult = await this.snapshotManager.createSnapshot(
            workflowId,
            'initial',
            `Initial state before workflow ${type}: ${task}`,
        );
        if (snapshotResult.snapshot) {
            this.currentWorkflow.snapshotId = snapshotResult.snapshot.id;
        }
        if (snapshotResult.warning) {
            console.error(snapshotResult.warning);
        }

        // Démarrer la première phase
        await this.startCurrentPhase();

        // Événements
        await this.eventBus.emit('workflow:started', { workflowId, type, task });

        // Sauvegarder l'état
        await this.persistState();

        return { success: true, data: workflow };
    }

    /**
     * Met en pause le workflow
     */
    async pauseWorkflow(): Promise<Result<void>> {
        if (!this.currentWorkflow) {
            return { success: false, error: new Error('No workflow running') };
        }
        if (this.currentWorkflow.status !== 'RUNNING') {
            return { success: false, error: new Error('Workflow is not running') };
        }

        const oldStatus = this.currentWorkflow.status;
        this.currentWorkflow.status = 'PAUSED';

        await this.eventBus.emit('workflow:paused', { workflowId: this.currentWorkflow.id });
        await this.eventBus.emit('workflow:statusChanged', {
            workflowId: this.currentWorkflow.id,
            from: oldStatus,
            to: 'PAUSED',
        });
        await this.persistState();

        return { success: true };
    }

    /**
     * Reprend le workflow
     */
    async resumeWorkflow(): Promise<Result<void>> {
        if (!this.currentWorkflow) {
            return { success: false, error: new Error('No workflow to resume') };
        }
        if (this.currentWorkflow.status !== 'PAUSED') {
            return { success: false, error: new Error('Workflow is not paused') };
        }

        const oldStatus = this.currentWorkflow.status;
        this.currentWorkflow.status = 'RUNNING';

        await this.eventBus.emit('workflow:resumed', { workflowId: this.currentWorkflow.id });
        await this.eventBus.emit('workflow:statusChanged', {
            workflowId: this.currentWorkflow.id,
            from: oldStatus,
            to: 'RUNNING',
        });
        await this.persistState();

        return { success: true };
    }

    /**
     * Annule le workflow
     */
    async cancelWorkflow(): Promise<Result<void>> {
        if (!this.currentWorkflow) {
            return { success: false, error: new Error('No workflow to cancel') };
        }

        const oldStatus = this.currentWorkflow.status;
        this.currentWorkflow.status = 'CANCELLED';
        this.currentWorkflow.completedAt = new Date();

        await this.eventBus.emit('workflow:cancelled', { workflowId: this.currentWorkflow.id });
        await this.eventBus.emit('workflow:statusChanged', {
            workflowId: this.currentWorkflow.id,
            from: oldStatus,
            to: 'CANCELLED',
        });

        // Statistiques et historique
        await this.stateManager.updateStats(this.currentWorkflow);
        await this.stateManager.addToHistory(this.currentWorkflow);

        // Nettoyer les snapshots
        await this.snapshotManager.cleanupWorkflow(this.currentWorkflow.id);

        // Nettoyer la session terminal
        await this.cleanupTerminalSession();

        await this.persistState();

        return { success: true };
    }

    /**
     * Récupère le statut du workflow
     */
    async getWorkflowStatus(): Promise<Workflow | null> {
        return this.currentWorkflow;
    }

    // ========================================================================
    // PHASE MANAGEMENT
    // ========================================================================

    /**
     * Démarre la phase courante
     */
    private async startCurrentPhase(): Promise<void> {
        if (!this.currentWorkflow) return;

        const phase = this.currentWorkflow.phases[this.currentWorkflow.currentPhaseIndex];
        if (!phase) return;

        // Vérifier les dépendances
        const depsOk = this.checkDependencies(phase);
        if (!depsOk) {
            phase.status = 'SKIPPED';
            await this.eventBus.emit('phase:skipped', {
                workflowId: this.currentWorkflow.id,
                phaseId: phase.id,
                reason: 'Dependencies not met',
            });
            await this.advanceToNextPhase();
            return;
        }

        // Créer un snapshot avant la phase
        const phaseSnapshot = await this.snapshotManager.createSnapshot(
            this.currentWorkflow.id,
            phase.id,
            `Before phase: ${phase.name} (iteration ${phase.iteration + 1})`,
        );
        if (phaseSnapshot.warning) {
            console.error(phaseSnapshot.warning);
        }

        phase.status = 'RUNNING';
        phase.startedAt = new Date();
        phase.iteration++;

        await this.eventBus.emit('phase:started', {
            workflowId: this.currentWorkflow.id,
            phaseId: phase.id,
            name: phase.name,
            iteration: phase.iteration,
        });
    }

    /**
     * Valide une phase et décide de la suite
     */
    async validatePhase(phaseId?: string, output?: string): Promise<Result<ScoreResult>> {
        this.ensureInitialized();

        if (!this.currentWorkflow) {
            return { success: false, error: new Error('No workflow running') };
        }

        const phase = phaseId
            ? this.currentWorkflow.phases.find(p => p.id === phaseId)
            : this.currentWorkflow.phases[this.currentWorkflow.currentPhaseIndex];

        if (!phase) {
            return { success: false, error: new Error('Phase not found') };
        }

        // Construire le PhaseOutput à partir de l'output textuel si fourni
        const phaseOutput = phase.output || this.buildPhaseOutput(output);

        // Récupérer les fichiers modifiés
        const files = phaseOutput?.filesModified || [];

        // Calculer le score réel
        const scoreResult = await this.getScoringEngine().score(phaseOutput, files);

        // Mettre à jour la phase
        phase.score = scoreResult.total;
        phase.output = phaseOutput;

        await this.eventBus.emit('score:calculated', {
            workflowId: this.currentWorkflow.id,
            phaseId: phase.id,
            result: scoreResult,
        });

        // Appliquer la décision
        switch (scoreResult.decision) {
            case 'PASS':
                phase.status = 'PASS';
                phase.completedAt = new Date();
                await this.eventBus.emit('phase:completed', {
                    workflowId: this.currentWorkflow.id,
                    phaseId: phase.id,
                    status: 'PASS',
                    score: scoreResult.total,
                });
                await this.advanceToNextPhase();
                break;

            case 'ITERATE':
                // Stocker le feedback pour l'injection dans le prochain dispatch
                phase.lastFeedback = scoreResult.feedback;

                if (phase.iteration >= phase.maxIterations) {
                    // Max itérations atteintes, force-promote en PASS
                    phase.status = 'PASS';
                    phase.forcePromoted = true;
                    phase.completedAt = new Date();
                    await this.eventBus.emit('phase:completed', {
                        workflowId: this.currentWorkflow.id,
                        phaseId: phase.id,
                        status: 'PASS',
                        score: scoreResult.total,
                    });
                    console.error(
                        `Phase "${phase.name}" force-promoted to PASS after ${phase.maxIterations} iterations (score: ${scoreResult.total}/100)`,
                    );
                    await this.advanceToNextPhase();
                } else {
                    phase.status = 'ITERATE';
                    await this.eventBus.emit('phase:iterating', {
                        workflowId: this.currentWorkflow.id,
                        phaseId: phase.id,
                        iteration: phase.iteration,
                        maxIterations: phase.maxIterations,
                        feedback: scoreResult.feedback,
                    });
                    // Redémarrer la phase
                    await this.startCurrentPhase();
                }
                break;

            case 'FAIL':
                phase.status = 'FAIL';
                phase.completedAt = new Date();
                await this.eventBus.emit('phase:failed', {
                    workflowId: this.currentWorkflow.id,
                    phaseId: phase.id,
                    reason: scoreResult.blockers.map(b => b.message).join('; ') || 'Score below threshold',
                });
                await this.failWorkflow(
                    `Phase "${phase.name}" failed: ${scoreResult.blockers.map(b => b.message).join('; ') || 'Score below 60%'}`,
                );
                break;
        }

        await this.persistState();

        return { success: true, data: scoreResult };
    }

    /**
     * Avance vers la phase suivante
     */
    private async advanceToNextPhase(): Promise<void> {
        if (!this.currentWorkflow) return;

        const nextIndex = this.currentWorkflow.currentPhaseIndex + 1;

        if (nextIndex >= this.currentWorkflow.phases.length) {
            // Toutes les phases sont terminées
            await this.completeWorkflow();
        } else {
            this.currentWorkflow.currentPhaseIndex = nextIndex;
            await this.startCurrentPhase();
        }
    }

    /**
     * Marque le workflow comme terminé
     */
    private async completeWorkflow(): Promise<void> {
        if (!this.currentWorkflow) return;

        // Marquer les phases orphelines (RUNNING/PENDING) comme SKIPPED
        for (const phase of this.currentWorkflow.phases) {
            if (phase.status === 'RUNNING' || phase.status === 'PENDING') {
                phase.status = 'SKIPPED';
                phase.completedAt = new Date();
            }
        }

        // Calculer le score total
        const phasesWithScores = this.currentWorkflow.phases.filter(p => p.score !== null);
        if (phasesWithScores.length > 0) {
            this.currentWorkflow.totalScore = Math.round(
                phasesWithScores.reduce((sum, p) => sum + (p.score || 0), 0) / phasesWithScores.length,
            );
        }

        const oldStatus = this.currentWorkflow.status;
        this.currentWorkflow.status = 'COMPLETE';
        this.currentWorkflow.completedAt = new Date();

        await this.eventBus.emit('workflow:completed', {
            workflowId: this.currentWorkflow.id,
            totalScore: this.currentWorkflow.totalScore,
        });
        await this.eventBus.emit('workflow:statusChanged', {
            workflowId: this.currentWorkflow.id,
            from: oldStatus,
            to: 'COMPLETE',
        });

        // Statistiques et historique
        await this.stateManager.updateStats(this.currentWorkflow);
        await this.stateManager.addToHistory(this.currentWorkflow);

        // Nettoyer les snapshots
        await this.snapshotManager.cleanupWorkflow(this.currentWorkflow.id);

        // Nettoyer la session terminal
        await this.cleanupTerminalSession();
    }

    /**
     * Marque le workflow comme échoué
     */
    private async failWorkflow(reason: string): Promise<void> {
        if (!this.currentWorkflow) return;

        // Marquer les phases orphelines (RUNNING/PENDING) comme SKIPPED
        for (const phase of this.currentWorkflow.phases) {
            if (phase.status === 'RUNNING' || phase.status === 'PENDING') {
                phase.status = 'SKIPPED';
                phase.completedAt = new Date();
            }
        }

        const oldStatus = this.currentWorkflow.status;
        this.currentWorkflow.status = 'FAILED';
        this.currentWorkflow.completedAt = new Date();

        await this.eventBus.emit('workflow:failed', {
            workflowId: this.currentWorkflow.id,
            reason,
        });
        await this.eventBus.emit('workflow:statusChanged', {
            workflowId: this.currentWorkflow.id,
            from: oldStatus,
            to: 'FAILED',
        });

        // Statistiques et historique
        await this.stateManager.updateStats(this.currentWorkflow);
        await this.stateManager.addToHistory(this.currentWorkflow);

        // Nettoyer la session terminal
        await this.cleanupTerminalSession();
    }

    /**
     * Vérifie que les dépendances d'une phase sont satisfaites
     */
    private checkDependencies(phase: WorkflowPhase): boolean {
        const workflow = this.currentWorkflow;
        if (!workflow || phase.dependencies.length === 0) return true;

        return phase.dependencies.every(depId => {
            const dep = workflow.phases.find(p => p.id === depId);
            return dep && (dep.status === 'PASS' || dep.status === 'SKIPPED');
        });
    }

    // ========================================================================
    // SCORING
    // ========================================================================

    /**
     * Calcule le score pour une phase ou des fichiers (sans effets de bord)
     */
    async calculateScore(phaseId?: string, files?: string[]): Promise<Result<ScoreResult>> {
        this.ensureInitialized();

        // Cas 1 : scoring de fichiers spécifiques (pur, sans side effects)
        if (files && files.length > 0) {
            const result = await this.getScoringEngine().scoreFiles(files);
            return { success: true, data: result };
        }

        // Cas 2 : scoring de la phase courante SANS appliquer la décision
        if (!this.currentWorkflow) {
            return { success: false, error: new Error('No workflow running') };
        }

        const phase = phaseId
            ? this.currentWorkflow.phases.find(p => p.id === phaseId)
            : this.currentWorkflow.phases[this.currentWorkflow.currentPhaseIndex];

        if (!phase) {
            return { success: false, error: new Error('Phase not found') };
        }

        const phaseOutput = phase.output || null;
        const phaseFiles = phaseOutput?.filesModified || [];
        const result = await this.getScoringEngine().score(phaseOutput, phaseFiles);

        // Retourner le score SANS appliquer la décision
        return { success: true, data: result };
    }

    // ========================================================================
    // ROLLBACK
    // ========================================================================

    /**
     * Effectue un rollback vers un snapshot
     */
    async rollback(snapshotId?: string): Promise<Result<void>> {
        this.ensureInitialized();

        const result = await this.snapshotManager.restore(snapshotId);

        if (result.success) {
            await this.eventBus.emit('snapshot:restored', {
                snapshotId: snapshotId || this.snapshotManager.getLatestSnapshot()?.id || 'unknown',
            });
        }

        return {
            success: result.success,
            error: result.error ? new Error(result.error) : undefined,
        };
    }

    // ========================================================================
    // MEMORY
    // ========================================================================

    async listMemories(): Promise<string[]> {
        return this.memoryManager.listNames();
    }

    async readMemory(name: string): Promise<string | null> {
        return this.memoryManager.read(name);
    }

    async writeMemory(name: string, content: string): Promise<Result<void>> {
        try {
            await this.memoryManager.write(name, content);
            await this.eventBus.emit('memory:written', { name });
            return { success: true };
        } catch (err) {
            return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
        }
    }

    async deleteMemory(name: string): Promise<Result<void>> {
        const deleted = await this.memoryManager.delete(name);
        if (deleted) {
            await this.eventBus.emit('memory:deleted', { name });
            return { success: true };
        }
        return { success: false, error: new Error(`Memory "${name}" not found`) };
    }

    // ========================================================================
    // AGENT DISPATCH
    // ========================================================================

    /**
     * Dispatch les agents de la phase courante
     */
    async dispatchPhase(feedback: string[] = []): Promise<Result<PhaseDispatchResult>> {
        this.ensureInitialized();

        if (!this.currentWorkflow) {
            return { success: false, error: new Error('No workflow running') };
        }

        const phase = this.currentWorkflow.phases[this.currentWorkflow.currentPhaseIndex];
        if (!phase) {
            return { success: false, error: new Error('No current phase') };
        }

        if (phase.status !== 'RUNNING') {
            return { success: false, error: new Error(`Phase "${phase.name}" is not running (status: ${phase.status})`) };
        }

        // Injecter automatiquement le feedback de l'itération précédente si non fourni
        const effectiveFeedback = feedback.length > 0 ? feedback : phase.lastFeedback;

        const dispatcher = this.getDispatcher();

        // Auto-switch interactive mode based on phase mode (only for terminal dispatch)
        if (this.dispatchMode === 'terminal') {
            const isInteractive = phase.mode === 'interactive';
            dispatcher.setInteractive(isInteractive);
        }

        // Capture file baseline BEFORE dispatch (for interactive phases)
        if (phase.mode === 'interactive') {
            this.prePhaseBaseline = await this.snapshotManager.captureFileBaseline();
        } else {
            this.prePhaseBaseline = null;
        }

        const result = await dispatcher.dispatchPhase(this.currentWorkflow, phase, effectiveFeedback);

        // En mode CLI, appliquer les outputs automatiquement
        if (this.dispatchMode === 'cli') {
            const phaseOutput = AgentDispatcher.toPhaseOutput(result);

            // Detect files changed via git diff (for interactive phases, delta only)
            if (phase.mode === 'interactive') {
                const changedFiles = await this.snapshotManager.getChangedFiles(undefined, this.prePhaseBaseline ?? undefined);
                phaseOutput.filesModified = [...changedFiles.created, ...changedFiles.modified];
                for (const agentOut of Object.values(phaseOutput.agentOutputs)) {
                    agentOut.filesCreated = changedFiles.created;
                    agentOut.filesModified = changedFiles.modified;
                }
            }

            // Consolidate multi-agent outputs if 2+ agents
            if (Object.keys(phaseOutput.agentOutputs).length >= 2) {
                const consolidated = await this.consolidatePhaseOutput(phaseOutput);
                if (consolidated) {
                    phaseOutput.consolidatedOutput = consolidated;
                }
            }

            phase.output = phaseOutput;
        }

        this.lastDispatchResult = result;
        await this.persistState();

        return { success: true, data: result };
    }

    /**
     * Auto-dispatch : dispatch les agents puis auto-validate en mode CLI.
     * En mode manual, retourne les prompts sans valider.
     */
    async autoDispatchPhase(feedback: string[] = []): Promise<Result<PhaseDispatchResult & { autoValidated?: boolean; score?: ScoreResult; timedOut?: boolean; terminalStatus?: TerminalSessionStatus }>> {
        const dispatchResult = await this.dispatchPhase(feedback);
        if (!dispatchResult.success || !dispatchResult.data) {
            return dispatchResult;
        }

        // En mode CLI, auto-valider avec les outputs
        if (this.dispatchMode === 'cli') {
            const validateResult = await this.validatePhase();
            return {
                success: true,
                data: {
                    ...dispatchResult.data,
                    autoValidated: true,
                    score: validateResult.data,
                },
            };
        }

        // En mode terminal, poll les .done files puis auto-valider
        if (this.dispatchMode === 'terminal') {
            const terminalStatus = await this.pollTerminalCompletion();

            if (terminalStatus?.allDone) {
                const collectResult = await this.collectTerminalResults();
                if (collectResult.success) {
                    const validateResult = await this.validatePhase();
                    return {
                        success: true,
                        data: {
                            ...dispatchResult.data,
                            autoValidated: true,
                            score: validateResult.data,
                        },
                    };
                }
            }

            // Timeout or partial completion
            return {
                success: true,
                data: {
                    ...dispatchResult.data,
                    autoValidated: false,
                    timedOut: !terminalStatus?.allDone,
                    terminalStatus: terminalStatus ?? undefined,
                },
            };
        }

        return {
            success: true,
            data: {
                ...dispatchResult.data,
                autoValidated: false,
            },
        };
    }

    /**
     * Genere les prompts manuels pour la phase courante
     */
    async getManualPrompts(feedback: string[] = []): Promise<Result<ManualDispatchPrompt[]>> {
        this.ensureInitialized();

        if (!this.currentWorkflow) {
            return { success: false, error: new Error('No workflow running') };
        }

        const phase = this.currentWorkflow.phases[this.currentWorkflow.currentPhaseIndex];
        if (!phase) {
            return { success: false, error: new Error('No current phase') };
        }

        // Injecter automatiquement le feedback de l'itération précédente si non fourni
        const effectiveFeedback = feedback.length > 0 ? feedback : phase.lastFeedback;

        const dispatcher = this.getDispatcher();
        const prompts: ManualDispatchPrompt[] = [];

        for (const agentId of phase.agents) {
            const prompt = await dispatcher.getPromptForAgent(
                agentId,
                this.currentWorkflow,
                phase,
                effectiveFeedback,
            );
            prompts.push(prompt);
        }

        return { success: true, data: prompts };
    }

    /**
     * Retourne le statut de la session terminal en cours
     */
    async getTerminalStatus(): Promise<Result<TerminalSessionStatus>> {
        this.ensureInitialized();
        const dispatcher = this.getDispatcher();
        const status = await dispatcher.getTerminalStatus();
        if (!status) {
            return { success: false, error: new Error('No terminal session active') };
        }
        return { success: true, data: status };
    }

    /**
     * Collecte les outputs de la session terminal et les injecte dans le PhaseOutput
     */
    async collectTerminalResults(): Promise<Result<PhaseOutput>> {
        this.ensureInitialized();

        if (!this.currentWorkflow) {
            return { success: false, error: new Error('No workflow running') };
        }

        const dispatcher = this.getDispatcher();
        const status = await dispatcher.getTerminalStatus();
        if (!status) {
            return { success: false, error: new Error('No terminal session active') };
        }

        if (!status.allDone) {
            return {
                success: false,
                error: new Error(`Not all agents are done. Running: ${status.running.join(', ')}`),
            };
        }

        const outputs = await dispatcher.collectTerminalOutputs();
        if (!outputs) {
            return { success: false, error: new Error('Failed to collect terminal outputs') };
        }

        // Construire le PhaseOutput a partir des outputs terminaux
        const agentOutputs: Record<AgentId, AgentOutput> = {};
        const errors: string[] = [];

        for (const [agentId, output] of Object.entries(outputs)) {
            const detail = status.agentDetails[agentId];
            const isSuccess = detail?.status === 'success';

            agentOutputs[agentId] = {
                agentId,
                status: isSuccess ? 'SUCCESS' : 'FAILED',
                output,
                filesCreated: [],
                filesModified: [],
                duration: detail?.duration || 0,
                score: null,
            };

            if (!isSuccess) {
                errors.push(`Agent ${agentId}: terminal execution failed`);
            }
        }

        const warnings: string[] = [];
        for (const [agentId, agentOut] of Object.entries(agentOutputs)) {
            if (agentOut.status === 'SUCCESS' && !agentOut.output.trim()) {
                warnings.push(`Agent ${agentId}: completed successfully but produced empty output`);
            }
        }

        // Detect files changed via git diff (for interactive phases that wrote code)
        // Use the pre-phase baseline to only get the delta (files created/modified during this phase)
        const phase = this.currentWorkflow.phases[this.currentWorkflow.currentPhaseIndex];
        let allFilesModified: string[] = [];
        let allFilesCreated: string[] = [];

        if (phase?.mode === 'interactive') {
            const changedFiles = await this.snapshotManager.getChangedFiles(undefined, this.prePhaseBaseline ?? undefined);
            allFilesModified = [...changedFiles.modified];
            allFilesCreated = [...changedFiles.created];

            // Populate agent outputs with detected files
            const agentIds = Object.keys(agentOutputs);
            if (agentIds.length === 1) {
                const onlyAgent = agentOutputs[agentIds[0]];
                onlyAgent.filesCreated = allFilesCreated;
                onlyAgent.filesModified = allFilesModified;
            } else {
                for (const agentOut of Object.values(agentOutputs)) {
                    agentOut.filesCreated = allFilesCreated;
                    agentOut.filesModified = allFilesModified;
                }
            }
        }

        const phaseOutput: PhaseOutput = {
            agentOutputs,
            filesModified: [...allFilesCreated, ...allFilesModified],
            errors,
            warnings,
        };

        // Consolidate multi-agent outputs if 2+ agents
        if (Object.keys(agentOutputs).length >= 2) {
            const consolidated = await this.consolidatePhaseOutput(phaseOutput);
            if (consolidated) {
                phaseOutput.consolidatedOutput = consolidated;
            }
        }

        // Injecter dans la phase courante
        if (phase) {
            phase.output = phaseOutput;
        }

        await this.persistState();

        return { success: true, data: phaseOutput };
    }

    /**
     * Poll la session terminal jusqu'a ce que tous les agents soient termines
     * ou que le timeout soit atteint (30 minutes).
     * Emet agent:terminalAgentDone pour chaque nouvelle completion
     * et agent:terminalAllDone quand tous sont finis.
     */
    private async pollTerminalCompletion(): Promise<TerminalSessionStatus | null> {
        const POLL_INTERVAL = 3000; // 3 seconds
        const TIMEOUT = 30 * 60 * 1000; // 30 minutes
        const startTime = Date.now();
        const completedAgents = new Set<string>();

        const workflow = this.currentWorkflow;
        if (!workflow) return null;

        const phase = workflow.phases[workflow.currentPhaseIndex];
        if (!phase) return null;

        while (Date.now() - startTime < TIMEOUT) {
            // Abort if workflow is no longer running
            if (workflow.status !== 'RUNNING') {
                const finalStatus = await this.getTerminalStatus();
                return finalStatus.data ?? null;
            }

            const statusResult = await this.getTerminalStatus();
            if (!statusResult.success || !statusResult.data) {
                return null;
            }

            const status = statusResult.data;

            // Emit events for newly completed agents
            for (const agentId of status.completed) {
                if (!completedAgents.has(agentId)) {
                    completedAgents.add(agentId);
                    const detail = status.agentDetails[agentId];
                    await this.eventBus.emit('agent:terminalAgentDone', {
                        workflowId: workflow.id,
                        phaseId: phase.id,
                        agentId,
                        duration: detail?.duration ?? 0,
                        status: detail?.status === 'failed' ? 'failed' : 'success',
                    });
                }
            }

            if (status.allDone) {
                await this.eventBus.emit('agent:terminalAllDone', {
                    workflowId: workflow.id,
                    phaseId: phase.id,
                    agentCount: status.total,
                });
                return status;
            }

            await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
        }

        // Timeout: return partial status
        const finalStatus = await this.getTerminalStatus();
        return finalStatus.data ?? null;
    }

    /**
     * Retourne le mode de dispatch actuel
     */
    getDispatchMode(): DispatchMode {
        return this.dispatchMode;
    }

    /**
     * Change le mode de dispatch
     */
    setDispatchMode(mode: DispatchMode): void {
        this.dispatchMode = mode;
        if (this.agentDispatcher) {
            this.agentDispatcher.setMode(mode);
        }
    }

    /**
     * Active/desactive le mode interactif pour les panes terminal
     */
    setTerminalInteractive(val: boolean): void {
        this.terminalInteractive = val;
        if (this.agentDispatcher) {
            this.agentDispatcher.setInteractive(val);
        }
    }

    /**
     * Retourne si le mode interactif est actif
     */
    getTerminalInteractive(): boolean {
        return this.terminalInteractive;
    }

    /**
     * Retourne le registre d'agents
     */
    getAgentRegistry(): AgentRegistry {
        return this.agentRegistry;
    }

    /**
     * Liste les snapshots disponibles
     */
    listSnapshots() {
        return this.snapshotManager.listSnapshots();
    }

    /**
     * Cree un snapshot manuel
     */
    async createSnapshot(description: string) {
        this.ensureInitialized();
        const workflowId = this.currentWorkflow?.id || 'manual';
        const phaseId = 'manual';
        const result = await this.snapshotManager.createSnapshot(workflowId, phaseId, description);
        return result;
    }

    /**
     * Liste les workflows custom disponibles
     */
    listCustomWorkflows(): Array<{ name: string; description: string; phaseCount: number }> {
        return [...this.customWorkflows.entries()].map(([name, tpl]) => ({
            name,
            description: tpl.description,
            phaseCount: tpl.phases.length,
        }));
    }

    /**
     * Retourne les infos de la phase courante
     */
    getCurrentPhaseInfo(): { phase: WorkflowPhase; agents: AgentDefinition[] } | null {
        if (!this.currentWorkflow) return null;
        const phase = this.currentWorkflow.phases[this.currentWorkflow.currentPhaseIndex];
        if (!phase) return null;

        const agents = phase.agents
            .map(id => this.agentRegistry.get(id))
            .filter((a): a is AgentDefinition => a !== undefined);

        return { phase, agents };
    }

    // ========================================================================
    // STATUS
    // ========================================================================

    async getSystemStatus(): Promise<SystemStatus> {
        const stats = await this.stateManager.getStats();
        const memoriesCount = await this.memoryManager.count();

        return {
            initialized: this.initialized,
            sessionId: this.sessionId,
            currentWorkflow: this.currentWorkflow
                ? {
                    id: this.currentWorkflow.id,
                    type: this.currentWorkflow.type,
                    status: this.currentWorkflow.status,
                    currentPhase: this.currentWorkflow.phases[this.currentWorkflow.currentPhaseIndex]?.name || null,
                    progress: this.calculateProgress(),
                    phases: this.currentWorkflow.phases.map(p => ({
                        id: p.id,
                        name: p.name,
                        status: p.status,
                        iteration: p.iteration,
                        score: p.score,
                        forcePromoted: p.forcePromoted || false,
                    })),
                }
                : null,
            projectInfo: this.projectConfig
                ? {
                    name: this.projectConfig.projectInfo.name,
                    language: this.projectConfig.projectInfo.language,
                    framework: this.projectConfig.projectInfo.framework,
                    tools: this.projectConfig.tools as unknown as Record<string, unknown>,
                }
                : null,
            hooksLoaded: this.hookEngine.getLoadedCount(),
            memoriesLoaded: memoriesCount,
            agents: {
                total: this.agentRegistry.list().length,
                builtIn: this.agentRegistry.list().filter(a => a.builtIn).length,
                custom: this.agentRegistry.list().filter(a => !a.builtIn).length,
                dispatchMode: this.dispatchMode,
            },
            stats: {
                workflowsCompleted: stats.workflowsCompleted,
                workflowsFailed: stats.workflowsFailed,
                averageScore: stats.averageScore,
                totalHooksTriggered: stats.totalHooksTriggered,
            },
        };
    }

    // ========================================================================
    // OUTPUT CONSOLIDATION
    // ========================================================================

    /**
     * Consolide les outputs multi-agents en un rapport structure via l'agent output-consolidator.
     * Appele uniquement quand 2+ agents ont produit des outputs.
     * Utilise execFileAsync('claude') directement — meme pattern que AgentDispatcher.dispatchCli.
     */
    async consolidatePhaseOutput(phaseOutput: PhaseOutput): Promise<string> {
        const entries = Object.entries(phaseOutput.agentOutputs);
        if (entries.length < 2) return '';

        const consolidator = this.agentRegistry.get('output-consolidator');
        if (!consolidator) return '';

        // Build a prompt with all agent outputs
        const parts: string[] = ['Consolidate the following agent outputs from a single phase:\n'];
        for (const [agentId, agentOutput] of entries) {
            parts.push(`### Agent: ${agentId}`);
            parts.push(`Status: ${agentOutput.status}`);
            const truncated = agentOutput.output.length > 5000
                ? agentOutput.output.slice(0, 5000) + '\n... [truncated]'
                : agentOutput.output;
            parts.push(`Output:\n${truncated}\n`);
        }

        const userPrompt = parts.join('\n');

        try {
            // Use spawn + stdin to avoid Windows command-line length limit (8191 chars).
            // The system prompt (~800 chars) fits on the command line; the user prompt
            // (potentially thousands of chars with full agent outputs) is piped via stdin.
            const args = ['--print', '--system-prompt', consolidator.systemPrompt];
            const isWindows = process.platform === 'win32';

            const result = await new Promise<string>((resolve, reject) => {
                const child = spawn('claude', args, {
                    shell: isWindows,
                    stdio: ['pipe', 'pipe', 'pipe'],
                    windowsHide: true,
                    timeout: 5 * 60 * 1000,
                });

                let stdout = '';
                let stderr = '';
                child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
                child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

                child.on('close', (code: number | null) => {
                    if (code === 0) resolve(stdout.trim());
                    else reject(new Error(`claude exited with code ${code}: ${stderr.slice(0, 500)}`));
                });
                child.on('error', reject);

                // Write user prompt to stdin — claude --print reads from stdin when no positional arg
                child.stdin.write(userPrompt);
                child.stdin.end();
            });

            return result;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error('Consolidation failed:', msg);
            return '';
        }
    }

    // ========================================================================
    // PHASE TEMPLATES
    // ========================================================================

    private createPhasesForType(type: WorkflowType, workflowId: string): WorkflowPhase[] {
        const REGRESSION_DESCRIPTION = 'Run the entire existing test suite to verify no regressions were introduced. Execute all tests (unit, integration, e2e), report any failures with the failing test name, file, and error message, identify which modified files likely caused each failure, and propose fixes for any broken tests.';

        type PhaseTemplate = { name: string; description?: string; agents: string[]; mode?: PhaseMode };

        const phaseTemplates: Partial<Record<WorkflowType, PhaseTemplate[]>> = {
            BUILD: [
                { name: 'Design', agents: ['fullstack-ui-architect'], mode: 'non-interactive' },
                { name: 'Code', agents: ['fullstack-ui-architect'], mode: 'interactive' },
                { name: 'Tests', agents: ['test-automation-strategist'], mode: 'interactive' },
                { name: 'Regression', description: REGRESSION_DESCRIPTION, agents: ['test-automation-strategist'], mode: 'interactive' },
                { name: 'Security', agents: ['security-expert'], mode: 'non-interactive' },
                { name: 'Review', agents: ['senior-code-reviewer'], mode: 'non-interactive' },
            ],
            REVIEW: [
                { name: 'Analysis', agents: ['senior-code-reviewer'], mode: 'non-interactive' },
                { name: 'Security Check', agents: ['security-expert'], mode: 'non-interactive' },
                { name: 'Report', agents: ['technical-writer'], mode: 'non-interactive' },
            ],
            OPTIMIZE: [
                { name: 'Profiling', agents: ['database-optimization-expert'], mode: 'non-interactive' },
                { name: 'Optimization', agents: ['distributed-systems-architect'], mode: 'interactive' },
                { name: 'Regression', description: REGRESSION_DESCRIPTION, agents: ['test-automation-strategist'], mode: 'interactive' },
            ],
            DESIGN: [
                { name: 'Requirements', agents: ['ux-design-strategist'], mode: 'non-interactive' },
                { name: 'Architecture', agents: ['distributed-systems-architect'], mode: 'non-interactive' },
                { name: 'Documentation', agents: ['technical-writer'], mode: 'non-interactive' },
            ],
            DEBUG: [
                { name: 'Investigation', agents: ['senior-code-reviewer'], mode: 'non-interactive' },
                { name: 'Fix', agents: ['fullstack-ui-architect'], mode: 'interactive' },
                { name: 'Regression', description: REGRESSION_DESCRIPTION, agents: ['test-automation-strategist'], mode: 'interactive' },
            ],
            SECURITY_AUDIT: [
                { name: 'Scan', agents: ['security-expert'], mode: 'non-interactive' },
                { name: 'Analysis', agents: ['security-expert'], mode: 'non-interactive' },
                { name: 'Remediation', agents: ['security-expert', 'fullstack-ui-architect'], mode: 'interactive' },
                { name: 'Regression', description: REGRESSION_DESCRIPTION, agents: ['test-automation-strategist'], mode: 'interactive' },
                { name: 'Report', agents: ['technical-writer'], mode: 'non-interactive' },
            ],
        };

        const templates = phaseTemplates[type] || phaseTemplates.BUILD!;

        return templates!.map((template, index) => ({
            id: `${workflowId}_phase_${index}`,
            name: template.name,
            description: template.description || `Phase ${index + 1}: ${template.name}`,
            agents: template.agents,
            dependencies: index > 0 ? [`${workflowId}_phase_${index - 1}`] : [],
            status: 'PENDING' as const,
            iteration: 0,
            maxIterations: 3,
            score: null,
            startedAt: null,
            completedAt: null,
            output: null,
            lastFeedback: [],
            forcePromoted: false,
            mode: template.mode || 'non-interactive',
        }));
    }

    // ========================================================================
    // HELPERS
    // ========================================================================

    /**
     * Valide qu'un objet JSON contient les champs requis pour un workflow template
     */
    private validateWorkflowTemplate(data: unknown, filename: string): CustomWorkflowTemplate | null {
        if (typeof data !== 'object' || data === null) {
            console.error(`Invalid workflow template in ${filename}: expected a JSON object`);
            return null;
        }

        const obj = data as Record<string, unknown>;
        const errors: string[] = [];

        if (typeof obj.name !== 'string' || obj.name.trim() === '') {
            errors.push('name (string, non-empty)');
        }

        if (!Array.isArray(obj.phases) || obj.phases.length === 0) {
            errors.push('phases (non-empty array)');
        } else {
            for (let i = 0; i < obj.phases.length; i++) {
                const phase = obj.phases[i] as Record<string, unknown> | null;
                if (typeof phase !== 'object' || phase === null) {
                    errors.push(`phases[${i}] (must be an object)`);
                    continue;
                }
                if (typeof phase.name !== 'string' || (phase.name as string).trim() === '') {
                    errors.push(`phases[${i}].name (string, non-empty)`);
                }
                if (!Array.isArray(phase.agents) || phase.agents.length === 0) {
                    errors.push(`phases[${i}].agents (non-empty array of strings)`);
                } else if (!phase.agents.every((a: unknown) => typeof a === 'string')) {
                    errors.push(`phases[${i}].agents (all elements must be strings)`);
                }
            }
        }

        if (errors.length > 0) {
            console.error(`Invalid workflow template in ${filename}: missing or invalid required fields: ${errors.join(', ')}`);
            return null;
        }

        return data as CustomWorkflowTemplate;
    }

    private async loadCustomWorkflows(): Promise<void> {
        const workflowsDir = join(this.projectRoot, '.claude', 'orchestrator', 'workflows');
        try {
            const files = await readdir(workflowsDir);
            for (const file of files.filter(f => f.endsWith('.json'))) {
                try {
                    const content = await readFile(join(workflowsDir, file), 'utf-8');
                    const data: unknown = JSON.parse(content);

                    const tpl = this.validateWorkflowTemplate(data, file);
                    if (!tpl) {
                        continue;
                    }

                    this.customWorkflows.set(tpl.name, tpl);
                } catch (err) {
                    console.error(`Failed to load custom workflow from ${file}:`, err);
                }
            }
        } catch {
            // Directory doesn't exist
        }
    }

    private createPhasesFromTemplate(template: CustomWorkflowTemplate, workflowId: string): WorkflowPhase[] {
        return template.phases.map((phase, index) => ({
            id: `${workflowId}_phase_${index}`,
            name: phase.name,
            description: phase.description || `Phase ${index + 1}: ${phase.name}`,
            agents: phase.agents,
            dependencies: index > 0 ? [`${workflowId}_phase_${index - 1}`] : [],
            status: 'PENDING' as const,
            iteration: 0,
            maxIterations: phase.maxIterations ?? 3,
            score: null,
            startedAt: null,
            completedAt: null,
            output: null,
            lastFeedback: [],
            forcePromoted: false,
            mode: phase.mode || 'non-interactive',
        }));
    }

    private calculateProgress(): number {
        if (!this.currentWorkflow) return 0;

        // Workflow terminé = 100%
        if (this.currentWorkflow.status === 'COMPLETE' || this.currentWorkflow.status === 'FAILED') {
            return 100;
        }

        const completed = this.currentWorkflow.phases.filter(
            p => p.status === 'PASS' || p.status === 'SKIPPED' || p.status === 'FAIL',
        ).length;
        return Math.round((completed / this.currentWorkflow.phases.length) * 100);
    }

    private buildPhaseOutput(output?: string): PhaseOutput | null {
        if (!output) return null;

        return {
            agentOutputs: {
                'default': {
                    agentId: 'default',
                    status: 'SUCCESS',
                    output,
                    filesCreated: [],
                    filesModified: [],
                    duration: 0,
                    score: null,
                },
            },
            filesModified: [],
            errors: [],
            warnings: [],
        };
    }

    private async persistState(): Promise<void> {
        await this.stateManager.saveState(
            {
                sessionId: this.sessionId,
                startedAt: new Date().toISOString(),
                currentWorkflowId: this.currentWorkflow?.id || null,
            },
            this.currentWorkflow,
        );
    }

    private setupEventHandlers(): void {
        // Comptage des hooks pour les stats
        this.eventBus.on('hook:triggered', async () => {
            await this.stateManager.incrementHooksTriggered();
        });
    }

    private getScoringEngine(): ScoringEngine {
        if (!this.scoringEngine) {
            throw new Error('ScoringEngine not available. Ensure initialize() completed successfully.');
        }
        return this.scoringEngine;
    }

    private getDispatcher(): AgentDispatcher {
        if (!this.agentDispatcher) {
            throw new Error('AgentDispatcher not available. Ensure initialize() completed successfully.');
        }
        return this.agentDispatcher;
    }

    /**
     * Nettoie la session terminal si elle existe
     */
    private async cleanupTerminalSession(): Promise<void> {
        const dispatcher = this.agentDispatcher;
        if (!dispatcher) return;

        const session = dispatcher.getCurrentTerminalSession();
        if (!session) return;

        // Only delete the session directory if all agents have finished.
        // If panes are still running, deleting the dir would break their output writes.
        try {
            const status = await dispatcher.getTerminalDispatcher().getStatus(session);
            if (status.allDone) {
                await dispatcher.getTerminalDispatcher().cleanupSession(session);
            }
        } catch (err) {
            console.error('Failed to cleanup terminal session:', err);
        }

        dispatcher.resetTerminalSession();
    }

    private ensureInitialized(): void {
        if (!this.initialized) {
            throw new Error('Orchestrator not initialized. Call initialize() first.');
        }
    }
}

// ============================================================================
// SINGLETON
// ============================================================================

let instance: Orchestrator | null = null;

export function getOrchestrator(projectRoot?: string): Orchestrator {
    if (!instance) {
        instance = new Orchestrator(projectRoot);
    }
    return instance;
}
