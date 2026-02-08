/**
 * Orchestrator - Moteur principal d'orchestration
 *
 * Responsabilités :
 * - Coordonner les workflows multi-agents
 * - Gérer les phases, itérations et transitions
 * - Interfacer avec StateManager, ConfigLoader, EventBus,
 *   MemoryManager, SnapshotManager, ScoringEngine
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
    Workflow,
    WorkflowType,
    WorkflowPhase,
    PhaseOutput,
    Result,
    ScoreResult,
    DispatchMode,
    PhaseDispatchResult,
    ManualDispatchPrompt,
    CustomWorkflowTemplate,
    AgentDefinition,
} from '../types/core.js';
import { EventBus, getEventBus } from './EventBus.js';
import { StateManager, type OrchestratorStats } from './StateManager.js';
import { ConfigLoader, type ProjectConfig } from './ConfigLoader.js';
import { MemoryManager } from './MemoryManager.js';
import { SnapshotManager } from './SnapshotManager.js';
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
    private lastDispatchResult: PhaseDispatchResult | null = null;
    private customWorkflows = new Map<string, CustomWorkflowTemplate>();

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
        const snapshot = await this.snapshotManager.createSnapshot(
            workflowId,
            'initial',
            `Initial state before workflow ${type}: ${task}`,
        );
        if (snapshot) {
            this.currentWorkflow.snapshotId = snapshot.id;
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
        await this.snapshotManager.createSnapshot(
            this.currentWorkflow.id,
            phase.id,
            `Before phase: ${phase.name} (iteration ${phase.iteration + 1})`,
        );

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
                if (phase.iteration >= phase.maxIterations) {
                    // Max itérations atteintes, on passe quand même
                    phase.status = 'PASS';
                    phase.completedAt = new Date();
                    await this.eventBus.emit('phase:completed', {
                        workflowId: this.currentWorkflow.id,
                        phaseId: phase.id,
                        status: 'PASS',
                        score: scoreResult.total,
                    });
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
    }

    /**
     * Marque le workflow comme échoué
     */
    private async failWorkflow(reason: string): Promise<void> {
        if (!this.currentWorkflow) return;

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
     * Calcule le score pour une phase ou des fichiers
     */
    async calculateScore(phaseId?: string, files?: string[]): Promise<Result<ScoreResult>> {
        this.ensureInitialized();

        if (files && files.length > 0) {
            const result = await this.getScoringEngine().scoreFiles(files);
            return { success: true, data: result };
        }

        return this.validatePhase(phaseId);
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

        const dispatcher = this.getDispatcher();
        const result = await dispatcher.dispatchPhase(this.currentWorkflow, phase, feedback);

        // En mode CLI, appliquer les outputs automatiquement
        if (this.dispatchMode === 'cli') {
            phase.output = AgentDispatcher.toPhaseOutput(result);
        }

        this.lastDispatchResult = result;
        await this.persistState();

        return { success: true, data: result };
    }

    /**
     * Auto-dispatch : dispatch les agents puis auto-validate en mode CLI.
     * En mode manual, retourne les prompts sans valider.
     */
    async autoDispatchPhase(feedback: string[] = []): Promise<Result<PhaseDispatchResult & { autoValidated?: boolean; score?: ScoreResult }>> {
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

        const dispatcher = this.getDispatcher();
        const prompts: ManualDispatchPrompt[] = [];

        for (const agentId of phase.agents) {
            const prompt = await dispatcher.getPromptForAgent(
                agentId,
                this.currentWorkflow,
                phase,
                feedback,
            );
            prompts.push(prompt);
        }

        return { success: true, data: prompts };
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
        return this.snapshotManager.createSnapshot(workflowId, phaseId, description);
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
    // PHASE TEMPLATES
    // ========================================================================

    private createPhasesForType(type: WorkflowType, workflowId: string): WorkflowPhase[] {
        const phaseTemplates: Partial<Record<WorkflowType, Array<{ name: string; agents: string[] }>>> = {
            BUILD: [
                { name: 'Design', agents: ['fullstack-ui-architect'] },
                { name: 'Code', agents: ['fullstack-ui-architect'] },
                { name: 'Tests', agents: ['test-automation-strategist'] },
                { name: 'Security', agents: ['security-expert'] },
                { name: 'Review', agents: ['senior-code-reviewer'] },
            ],
            REVIEW: [
                { name: 'Analysis', agents: ['senior-code-reviewer'] },
                { name: 'Security Check', agents: ['security-expert'] },
                { name: 'Report', agents: ['technical-writer'] },
            ],
            OPTIMIZE: [
                { name: 'Profiling', agents: ['database-optimization-expert'] },
                { name: 'Optimization', agents: ['distributed-systems-architect'] },
                { name: 'Verification', agents: ['test-automation-strategist'] },
            ],
            DESIGN: [
                { name: 'Requirements', agents: ['ux-design-strategist'] },
                { name: 'Architecture', agents: ['distributed-systems-architect'] },
                { name: 'Documentation', agents: ['technical-writer'] },
            ],
            DEBUG: [
                { name: 'Investigation', agents: ['senior-code-reviewer'] },
                { name: 'Fix', agents: ['fullstack-ui-architect'] },
                { name: 'Verification', agents: ['test-automation-strategist'] },
            ],
            SECURITY_AUDIT: [
                { name: 'Scan', agents: ['security-expert'] },
                { name: 'Analysis', agents: ['security-expert'] },
                { name: 'Remediation', agents: ['security-expert', 'fullstack-ui-architect'] },
                { name: 'Report', agents: ['technical-writer'] },
            ],
        };

        const templates = phaseTemplates[type] || phaseTemplates.BUILD!;

        return templates!.map((template, index) => ({
            id: `${workflowId}_phase_${index}`,
            name: template.name,
            description: `Phase ${index + 1}: ${template.name}`,
            agents: template.agents,
            dependencies: index > 0 ? [`${workflowId}_phase_${index - 1}`] : [],
            status: 'PENDING' as const,
            iteration: 0,
            maxIterations: 3,
            score: null,
            startedAt: null,
            completedAt: null,
            output: null,
        }));
    }

    // ========================================================================
    // HELPERS
    // ========================================================================

    private async loadCustomWorkflows(): Promise<void> {
        const workflowsDir = join(this.projectRoot, '.claude', 'orchestrator', 'workflows');
        try {
            const files = await readdir(workflowsDir);
            for (const file of files.filter(f => f.endsWith('.json'))) {
                try {
                    const content = await readFile(join(workflowsDir, file), 'utf-8');
                    const tpl = JSON.parse(content) as CustomWorkflowTemplate;
                    if (tpl.name && tpl.phases?.length > 0) {
                        this.customWorkflows.set(tpl.name, tpl);
                    }
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
        }));
    }

    private calculateProgress(): number {
        if (!this.currentWorkflow) return 0;
        const completed = this.currentWorkflow.phases.filter(
            p => p.status === 'PASS' || p.status === 'SKIPPED',
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
