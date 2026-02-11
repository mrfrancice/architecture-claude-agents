/**
 * Orchestrator - Moteur principal d'orchestration multi-agents
 *
 * Intègre tous les modules :
 * - EventBus : communication inter-modules
 * - StateManager : persistance de l'état
 * - ConfigLoader : détection du projet
 * - MemoryManager : mémoires persistantes
 * - AgentRegistry : catalogue d'agents depuis .claude/agents/
 * - HookEngine : hooks depuis .claude/hooks/
 * - ScoringEngine : scoring objectif 6 axes
 * - AgentDispatcher : dispatch séquentiel avec peer outputs
 */

import type {
    Workflow, WorkflowType, WorkflowPhase, PhaseOutput, AgentOutput,
    Result, ScoreResult, AgentId, DispatchMode, PhaseDispatchResult,
    ManualDispatchPrompt, AgentDefinition, SkillDefinition, PhaseMode,
    CustomWorkflowTemplate,
} from '../types/core.js';
import { EventBus, getEventBus } from './EventBus.js';
import { StateManager } from './StateManager.js';
import { ConfigLoader, type ProjectConfig } from './ConfigLoader.js';
import { MemoryManager } from './MemoryManager.js';
import { AgentRegistry } from './AgentRegistry.js';
import { HookEngine } from './HookEngine.js';
import { ScoringEngine } from './ScoringEngine.js';
import { AgentDispatcher, extractSummary } from './AgentDispatcher.js';
import { SkillLoader } from './SkillLoader.js';
import { logInfo } from '../utils/safe-logger.js';

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
    } | null;
    agentsLoaded: number;
    protocolsLoaded: number;
    hooksLoaded: number;
    skillsLoaded: number;
    memoriesLoaded: number;
    stats: {
        workflowsCompleted: number;
        workflowsFailed: number;
        averageScore: number;
        totalHooksTriggered: number;
    };
}

export interface PhaseInfo {
    phaseId: string;
    phaseName: string;
    description: string;
    agents: Array<{ id: string; name: string; domain?: string; model?: string }>;
    status: string;
    iteration: number;
    maxIterations: number;
    mode: PhaseMode;
}

// ============================================================================
// ORCHESTRATOR
// ============================================================================

export class Orchestrator {
    private initialized = false;
    private projectRoot: string;

    // Modules
    private eventBus: EventBus;
    private stateManager: StateManager;
    private configLoader: ConfigLoader;
    private memoryManager: MemoryManager;
    private agentRegistry: AgentRegistry;
    private hookEngine: HookEngine;
    private skillLoader: SkillLoader;
    private scoringEngine: ScoringEngine | null = null;
    private dispatcher: AgentDispatcher | null = null;

    private projectConfig: ProjectConfig | null = null;

    constructor(projectRoot?: string) {
        this.projectRoot = projectRoot || process.cwd();

        this.eventBus = getEventBus();
        this.stateManager = new StateManager(this.projectRoot);
        this.configLoader = new ConfigLoader(this.projectRoot);
        this.memoryManager = new MemoryManager(this.projectRoot);
        this.agentRegistry = new AgentRegistry(this.projectRoot);
        this.hookEngine = new HookEngine(this.projectRoot, this.eventBus);
        this.skillLoader = new SkillLoader(this.projectRoot);
    }

    // ========================================================================
    // INITIALIZATION
    // ========================================================================

    async initialize(): Promise<void> {
        if (this.initialized) return;

        logInfo('Initializing Orchestrator...');

        // Parallel initialization of independent modules
        await Promise.all([
            this.stateManager.initialize(),
            this.memoryManager.initialize(),
            this.agentRegistry.initialize(),
            this.hookEngine.initialize(),
            this.skillLoader.initialize(),
        ]);

        // Load project config (needs filesystem)
        this.projectConfig = await this.configLoader.load();

        // Create ScoringEngine with detected tools
        this.scoringEngine = new ScoringEngine(this.projectRoot, this.projectConfig.tools);

        // Create AgentDispatcher
        this.dispatcher = new AgentDispatcher(
            this.agentRegistry,
            this.memoryManager,
            this.eventBus,
        );

        this.initialized = true;
        logInfo(
            `Orchestrator initialized: ${this.agentRegistry.count} agents, ` +
            `${this.hookEngine.count} hooks, ${this.skillLoader.count} skills, ` +
            `${this.memoryManager.count} memories`,
        );
    }

    // ========================================================================
    // WORKFLOW MANAGEMENT
    // ========================================================================

    async startWorkflow(type: WorkflowType, task: string, customTemplate?: CustomWorkflowTemplate): Promise<Result<Workflow>> {
        this.ensureInitialized();

        const existing = this.stateManager.getWorkflow();
        if (existing && existing.status === 'RUNNING') {
            return {
                success: false,
                error: new Error('A workflow is already running. Cancel or complete it first.'),
            };
        }

        const workflowId = `wf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const phases = type === 'CUSTOM' && customTemplate
            ? this.createCustomPhases(customTemplate, workflowId)
            : this.createPhasesForType(type, workflowId);

        if (phases.length === 0) {
            return {
                success: false,
                error: new Error('Workflow must have at least one phase'),
            };
        }

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
                memories: await this.memoryManager.list(),
                userPreferences: {},
                projectInfo: this.projectConfig?.projectInfo || {
                    name: 'project',
                    type: 'unknown',
                    language: 'unknown',
                    framework: null,
                    rootPath: this.projectRoot,
                },
            },
        };

        // Mark first phase as running
        if (workflow.phases.length > 0) {
            workflow.phases[0].status = 'RUNNING';
            workflow.phases[0].startedAt = new Date();
            workflow.phases[0].iteration = 1;
        }

        await this.stateManager.setWorkflow(workflow);

        this.eventBus.emit('workflow:started', {
            workflowId: workflow.id,
            type: workflow.type,
            task: workflow.task,
        });

        return { success: true, data: workflow };
    }

    async pauseWorkflow(): Promise<Result<void>> {
        const workflow = this.stateManager.getWorkflow();
        if (!workflow) {
            return { success: false, error: new Error('No workflow running') };
        }
        if (workflow.status !== 'RUNNING') {
            return { success: false, error: new Error('Workflow is not running') };
        }

        await this.stateManager.updateWorkflow(w => { w.status = 'PAUSED'; });
        this.eventBus.emit('workflow:paused', { workflowId: workflow.id });

        return { success: true };
    }

    async resumeWorkflow(): Promise<Result<void>> {
        const workflow = this.stateManager.getWorkflow();
        if (!workflow) {
            return { success: false, error: new Error('No workflow to resume') };
        }
        if (workflow.status !== 'PAUSED') {
            return { success: false, error: new Error('Workflow is not paused') };
        }

        // Refresh memories in case they changed while paused
        await this.memoryManager.refresh();
        const currentMemories = Object.keys(this.memoryManager.getAll());

        await this.stateManager.updateWorkflow(w => {
            w.status = 'RUNNING';
            w.context.memories = currentMemories;
        });
        this.eventBus.emit('workflow:resumed', { workflowId: workflow.id });

        return { success: true };
    }

    async cancelWorkflow(): Promise<Result<void>> {
        const workflow = this.stateManager.getWorkflow();
        if (!workflow) {
            return { success: false, error: new Error('No workflow to cancel') };
        }

        await this.stateManager.updateWorkflow(w => {
            w.status = 'CANCELLED';
            w.completedAt = new Date();
        });

        await this.stateManager.addToHistory(workflow);
        await this.stateManager.recordWorkflowCancelled();

        this.eventBus.emit('workflow:cancelled', { workflowId: workflow.id });

        return { success: true };
    }

    async getWorkflowStatus(): Promise<Workflow | null> {
        return this.stateManager.getWorkflow();
    }

    // ========================================================================
    // PHASE DISPATCH
    // ========================================================================

    async dispatchPhase(): Promise<Result<PhaseDispatchResult>> {
        this.ensureInitialized();
        const workflow = this.stateManager.getWorkflow();
        if (!workflow || workflow.status !== 'RUNNING') {
            return { success: false, error: new Error('No running workflow') };
        }

        const phase = workflow.phases[workflow.currentPhaseIndex];
        if (!phase) {
            return { success: false, error: new Error('No current phase') };
        }

        // Verify dependencies are satisfied
        if (phase.dependencies.length > 0) {
            const unsatisfied = phase.dependencies.filter(depId => {
                const dep = workflow.phases.find(p => p.id === depId);
                return !dep || (dep.status !== 'PASS' && dep.status !== 'SKIPPED');
            });
            if (unsatisfied.length > 0) {
                return {
                    success: false,
                    error: new Error(`Phase dependencies not satisfied: ${unsatisfied.join(', ')}`),
                };
            }
        }

        this.eventBus.emit('phase:started', {
            workflowId: workflow.id,
            phaseId: phase.id,
            phaseName: phase.name,
            iteration: phase.iteration,
        });

        const result = await this.getDispatcher().dispatchPhase(workflow, phase, phase.lastFeedback);

        // Store results in phase output
        const agentOutputs: Record<AgentId, AgentOutput> = {};
        const filesModified: string[] = [];

        for (const dr of result.results) {
            agentOutputs[dr.agentId] = {
                agentId: dr.agentId,
                status: dr.status,
                output: dr.output,
                filesCreated: [],
                filesModified: [],
                duration: dr.duration,
                score: null,
                summary: extractSummary(dr.output),
            };
        }

        // Always initialize phase.output (even in manual mode with 0 results)
        await this.stateManager.updateWorkflow(w => {
            const p = w.phases[w.currentPhaseIndex];
            p.output = {
                agentOutputs,
                filesModified,
                errors: result.results.filter(r => r.status === 'FAILED').map(r => r.error || 'Unknown error'),
                warnings: [],
            };
        });

        return { success: true, data: result };
    }

    // ========================================================================
    // VALIDATION
    // ========================================================================

    async validatePhase(phaseId?: string, output?: string): Promise<Result<ScoreResult>> {
        this.ensureInitialized();
        const workflow = this.stateManager.getWorkflow();
        if (!workflow) {
            return { success: false, error: new Error('No workflow running') };
        }

        const phase = phaseId
            ? workflow.phases.find(p => p.id === phaseId)
            : workflow.phases[workflow.currentPhaseIndex];

        if (!phase) {
            return { success: false, error: new Error('Phase not found') };
        }

        // If output is provided, inject it into phase output
        if (output) {
            if (!phase.output) {
                // Initialize phase.output if it doesn't exist yet (e.g., manual mode)
                phase.output = {
                    agentOutputs: {},
                    filesModified: [],
                    errors: [],
                    warnings: [],
                };
            }
            phase.output.consolidatedOutput = output;
        }

        const scoreResult = await this.getScoringEngine().score(phase.output);

        this.eventBus.emit('score:calculated', {
            workflowId: workflow.id,
            phaseId: phase.id,
            total: scoreResult.total,
            decision: scoreResult.decision,
        });

        // Collect deferred events to emit AFTER persistence
        type DeferredEvent = { event: string; payload: Record<string, unknown> };
        const deferredEvents: DeferredEvent[] = [];

        // Update phase based on decision
        await this.stateManager.updateWorkflow(w => {
            const p = phaseId
                ? w.phases.find(ph => ph.id === phaseId)
                : w.phases[w.currentPhaseIndex];

            if (!p) return; // Phase not found, skip update

            p.score = scoreResult.total;

            switch (scoreResult.decision) {
                case 'PASS':
                    p.status = 'PASS';
                    p.completedAt = new Date();
                    this.advanceToNextPhase(w, deferredEvents);
                    break;

                case 'ITERATE':
                    if (p.iteration >= p.maxIterations) {
                        // Force promote after max iterations
                        p.status = 'PASS';
                        p.forcePromoted = true;
                        p.completedAt = new Date();
                        this.advanceToNextPhase(w, deferredEvents);
                    } else {
                        p.status = 'ITERATE';
                        p.iteration++;
                        p.lastFeedback = scoreResult.feedback;
                        deferredEvents.push({
                            event: 'phase:iterating',
                            payload: {
                                workflowId: w.id,
                                phaseId: p.id,
                                phaseName: p.name,
                                iteration: p.iteration,
                                feedback: scoreResult.feedback,
                            },
                        });
                    }
                    break;

                case 'FAIL':
                    p.status = 'FAIL';
                    p.completedAt = new Date();
                    w.status = 'FAILED';
                    w.completedAt = new Date();
                    deferredEvents.push({
                        event: 'phase:failed',
                        payload: {
                            workflowId: w.id,
                            phaseId: p.id,
                            phaseName: p.name,
                            error: scoreResult.feedback.join('; ') || 'Phase failed with no specific feedback',
                        },
                    });
                    deferredEvents.push({
                        event: 'workflow:failed',
                        payload: {
                            workflowId: w.id,
                            error: `Phase ${p.name} failed`,
                        },
                    });
                    break;
            }
        });

        // Emit events AFTER state is persisted
        for (const { event, payload } of deferredEvents) {
            this.eventBus.emit(event as any, payload as any);
        }

        // Persist stats
        const wf = this.stateManager.getWorkflow();
        if (wf && (wf.status === 'COMPLETE' || wf.status === 'FAILED')) {
            await this.stateManager.addToHistory(wf);
            if (wf.status === 'COMPLETE') {
                await this.stateManager.recordWorkflowComplete(wf.totalScore);
            } else {
                await this.stateManager.recordWorkflowFailed();
            }
        }
        await this.stateManager.recordPhaseComplete();

        return { success: true, data: scoreResult };
    }

    async autoDispatchPhase(): Promise<Result<{ dispatch: PhaseDispatchResult; score: ScoreResult }>> {
        const dispatchResult = await this.dispatchPhase();
        if (!dispatchResult.success) {
            return { success: false, error: dispatchResult.error };
        }

        // In manual mode, return prompts without auto-validating.
        // User must call validatePhase() separately after providing output.
        if (dispatchResult.data!.mode === 'manual') {
            return {
                success: true,
                data: {
                    dispatch: dispatchResult.data!,
                    score: {
                        total: 0,
                        breakdown: { correctness: 0, completeness: 0, security: 0, bestPractices: 0, tests: 0, documentation: 0 },
                        decision: 'ITERATE',
                        blockers: [],
                        feedback: [
                            'Manual mode: prompts have been generated for each agent.',
                            'Execute each agent prompt and call validatePhase(output) with the consolidated output.',
                        ],
                        bonuses: [],
                        penalties: [],
                    },
                },
            };
        }

        const scoreResult = await this.validatePhase();
        if (!scoreResult.success) {
            return { success: false, error: scoreResult.error };
        }

        return {
            success: true,
            data: {
                dispatch: dispatchResult.data!,
                score: scoreResult.data!,
            },
        };
    }

    // ========================================================================
    // SCORING
    // ========================================================================

    async calculateScore(phaseId?: string, files?: string[]): Promise<Result<ScoreResult>> {
        this.ensureInitialized();
        const workflow = this.stateManager.getWorkflow();

        let phaseOutput: PhaseOutput | null = null;
        if (workflow) {
            const phase = phaseId
                ? workflow.phases.find(p => p.id === phaseId)
                : workflow.phases[workflow.currentPhaseIndex];
            phaseOutput = phase?.output || null;
        }

        const result = await this.getScoringEngine().score(phaseOutput, files);
        return { success: true, data: result };
    }

    // ========================================================================
    // DISPATCH MODE
    // ========================================================================

    setDispatchMode(mode: DispatchMode): void {
        this.ensureInitialized();
        this.getDispatcher().setMode(mode);
    }

    getDispatchMode(): DispatchMode {
        this.ensureInitialized();
        return this.getDispatcher().getMode();
    }

    // ========================================================================
    // AGENT PROMPT
    // ========================================================================

    async getAgentPrompt(agentId: AgentId): Promise<Result<ManualDispatchPrompt>> {
        this.ensureInitialized();
        const workflow = this.stateManager.getWorkflow();
        if (!workflow || workflow.status !== 'RUNNING') {
            return { success: false, error: new Error('No running workflow') };
        }

        const phase = workflow.phases[workflow.currentPhaseIndex];
        if (!phase) {
            return { success: false, error: new Error('No current phase') };
        }

        const prompt = await this.getDispatcher().getAgentPrompt(agentId, workflow, phase);
        return { success: true, data: prompt };
    }

    // ========================================================================
    // CURRENT PHASE INFO
    // ========================================================================

    getCurrentPhaseInfo(): PhaseInfo | null {
        const workflow = this.stateManager.getWorkflow();
        if (!workflow || workflow.status !== 'RUNNING') return null;

        const phase = workflow.phases[workflow.currentPhaseIndex];
        if (!phase) return null;

        const agents = phase.agents.map(agentId => {
            const agent = this.agentRegistry.get(agentId);
            return {
                id: agentId,
                name: agent?.name || agentId,
                domain: agent?.domain,
                model: agent?.model,
            };
        });

        return {
            phaseId: phase.id,
            phaseName: phase.name,
            description: phase.description,
            agents,
            status: phase.status,
            iteration: phase.iteration,
            maxIterations: phase.maxIterations,
            mode: phase.mode,
        };
    }

    // ========================================================================
    // AGENT REGISTRY ACCESS
    // ========================================================================

    listAgents(): AgentDefinition[] {
        this.ensureInitialized();
        return this.agentRegistry.list();
    }

    getAgent(id: AgentId): AgentDefinition | undefined {
        this.ensureInitialized();
        return this.agentRegistry.get(id);
    }

    registerAgent(agent: AgentDefinition): void {
        this.ensureInitialized();
        this.agentRegistry.register(agent);
    }

    // ========================================================================
    // SKILLS
    // ========================================================================

    listSkills(): SkillDefinition[] {
        this.ensureInitialized();
        return this.skillLoader.list();
    }

    getSkill(name: string): SkillDefinition | undefined {
        this.ensureInitialized();
        return this.skillLoader.get(name);
    }

    // ========================================================================
    // MEMORY
    // ========================================================================

    async listMemories(): Promise<string[]> {
        return this.memoryManager.list();
    }

    async readMemory(name: string): Promise<string | null> {
        return this.memoryManager.read(name);
    }

    async writeMemory(name: string, content: string): Promise<Result<void>> {
        try {
            await this.memoryManager.write(name, content);
            this.eventBus.emit('memory:written', { name });
            return { success: true };
        } catch (error) {
            return { success: false, error: error instanceof Error ? error : new Error(String(error)) };
        }
    }

    async deleteMemory(name: string): Promise<Result<void>> {
        try {
            await this.memoryManager.delete(name);
            this.eventBus.emit('memory:deleted', { name });
            return { success: true };
        } catch (error) {
            return { success: false, error: error instanceof Error ? error : new Error(String(error)) };
        }
    }

    // ========================================================================
    // ROLLBACK (stub - SnapshotManager hors scope)
    // ========================================================================

    async rollback(action?: string, snapshotId?: string, description?: string): Promise<Result<unknown>> {
        switch (action) {
            case 'list':
                return { success: true, data: [] };
            case 'create':
                return { success: true, data: { message: 'Snapshot creation not yet implemented' } };
            case 'restore':
            default:
                return { success: true, data: { message: 'Rollback not yet implemented' } };
        }
    }

    // ========================================================================
    // SYSTEM STATUS
    // ========================================================================

    async getSystemStatus(): Promise<SystemStatus> {
        const workflow = this.stateManager.getWorkflow();
        const stats = this.stateManager.getStats();

        return {
            initialized: this.initialized,
            sessionId: this.initialized ? this.stateManager.sessionId : null,
            currentWorkflow: workflow
                ? {
                    id: workflow.id,
                    type: workflow.type,
                    status: workflow.status,
                    currentPhase: workflow.phases[workflow.currentPhaseIndex]?.name || null,
                    progress: this.calculateProgress(workflow),
                }
                : null,
            agentsLoaded: this.initialized ? this.agentRegistry.count : 0,
            protocolsLoaded: this.initialized ? this.agentRegistry.listProtocols().length : 0,
            hooksLoaded: this.initialized ? this.hookEngine.count : 0,
            skillsLoaded: this.initialized ? this.skillLoader.count : 0,
            memoriesLoaded: this.initialized ? this.memoryManager.count : 0,
            stats: {
                workflowsCompleted: stats.workflowsCompleted,
                workflowsFailed: stats.workflowsFailed,
                averageScore: stats.averageScore,
                totalHooksTriggered: stats.totalHooksTriggered,
            },
        };
    }

    // ========================================================================
    // PHASE CREATION
    // ========================================================================

    private createPhasesForType(type: WorkflowType, workflowId: string): WorkflowPhase[] {
        const phaseTemplates: Record<string, Array<{ name: string; agents: string[]; mode?: PhaseMode }>> = {
            BUILD: [
                { name: 'Planning', agents: ['meta-agent-orchestrator'] },
                { name: 'Design', agents: ['fullstack-ui-architect', 'ui-engineer'] },
                { name: 'Code', agents: ['fullstack-ui-architect'] },
                { name: 'Tests', agents: ['test-automation-strategist', 'web-tester'] },
                { name: 'Security', agents: ['security-expert'] },
                { name: 'Review', agents: ['senior-code-reviewer'] },
                { name: 'Deploy', agents: ['devops-sre'] },
            ],
            REVIEW: [
                { name: 'Analysis', agents: ['senior-code-reviewer'] },
                { name: 'Security Check', agents: ['security-expert'] },
                { name: 'Synthesis', agents: ['meta-agent-orchestrator', 'technical-writer'] },
            ],
            OPTIMIZE: [
                { name: 'Profiling', agents: ['database-optimization-expert'] },
                { name: 'Optimization', agents: ['distributed-systems-architect'] },
                { name: 'Verification', agents: ['test-automation-strategist'] },
                { name: 'Infra Review', agents: ['devops-sre'] },
            ],
            DESIGN: [
                { name: 'Requirements', agents: ['ux-design-strategist', 'prompt-engineering-expert'] },
                { name: 'Architecture', agents: ['distributed-systems-architect'] },
                { name: 'Documentation', agents: ['technical-writer'] },
            ],
            DEBUG: [
                { name: 'Investigation', agents: ['senior-code-reviewer'] },
                { name: 'Fix', agents: ['fullstack-ui-architect'] },
                { name: 'Verification', agents: ['test-automation-strategist', 'web-tester'] },
            ],
            SECURITY_AUDIT: [
                { name: 'Scan', agents: ['security-expert'] },
                { name: 'Analysis', agents: ['security-expert'] },
                { name: 'Remediation', agents: ['security-expert', 'fullstack-ui-architect'] },
                { name: 'Infra Hardening', agents: ['devops-sre'] },
                { name: 'Report', agents: ['technical-writer'] },
            ],
        };

        const templates = phaseTemplates[type] || phaseTemplates.BUILD;

        return templates.map((template, index) => ({
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
            lastFeedback: [],
            forcePromoted: false,
            mode: (template.mode || 'non-interactive') as PhaseMode,
        }));
    }

    private createCustomPhases(template: CustomWorkflowTemplate, workflowId: string): WorkflowPhase[] {
        return template.phases.map((phase, index) => ({
            id: `${workflowId}_phase_${index}`,
            name: phase.name,
            description: phase.description || `Custom phase ${index + 1}: ${phase.name}`,
            agents: phase.agents,
            dependencies: index > 0 ? [`${workflowId}_phase_${index - 1}`] : [],
            status: 'PENDING' as const,
            iteration: 0,
            maxIterations: phase.maxIterations || 3,
            score: null,
            startedAt: null,
            completedAt: null,
            output: null,
            lastFeedback: [],
            forcePromoted: false,
            mode: (phase.mode || 'non-interactive') as PhaseMode,
        }));
    }

    // ========================================================================
    // HELPERS
    // ========================================================================

    private advanceToNextPhase(
        workflow: Workflow,
        deferredEvents: Array<{ event: string; payload: Record<string, unknown> }>,
    ): void {
        const nextIndex = workflow.currentPhaseIndex + 1;
        if (nextIndex >= workflow.phases.length) {
            // Workflow complete
            workflow.status = 'COMPLETE';
            workflow.completedAt = new Date();

            // Calculate total score (average ALL phases, treating unscored as 0)
            const scores = workflow.phases.map(p => p.score ?? 0);
            workflow.totalScore = scores.length > 0
                ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
                : null;

            deferredEvents.push({
                event: 'workflow:completed',
                payload: {
                    workflowId: workflow.id,
                    totalScore: workflow.totalScore,
                },
            });
        } else {
            workflow.currentPhaseIndex = nextIndex;
            const next = workflow.phases[nextIndex];
            next.status = 'RUNNING';
            next.startedAt = new Date();
            next.iteration = 1;

            deferredEvents.push({
                event: 'phase:started',
                payload: {
                    workflowId: workflow.id,
                    phaseId: next.id,
                    phaseName: next.name,
                    iteration: 1,
                },
            });
        }
    }

    private calculateProgress(workflow: Workflow): number {
        if (workflow.phases.length === 0) return 0;
        const completed = workflow.phases.filter(p => p.status === 'PASS' || p.status === 'SKIPPED').length;
        return Math.round((completed / workflow.phases.length) * 100);
    }

    private ensureInitialized(): void {
        if (!this.initialized) {
            throw new Error('Orchestrator not initialized. Call initialize() first.');
        }
    }

    private getDispatcher(): AgentDispatcher {
        if (!this.dispatcher) {
            throw new Error('AgentDispatcher not initialized. Call initialize() first.');
        }
        return this.dispatcher;
    }

    private getScoringEngine(): ScoringEngine {
        if (!this.scoringEngine) {
            throw new Error('ScoringEngine not initialized. Call initialize() first.');
        }
        return this.scoringEngine;
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
