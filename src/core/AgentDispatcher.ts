/**
 * AgentDispatcher - Dispatch des agents avec 2 strategies
 *
 * - cli : execute claude en subprocess
 * - manual : retourne les prompts structures sans executer
 *
 * Inclut un ContextPipeline pour construire le contexte complet d'un agent.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
    AgentId,
    PhaseId,
    DispatchMode,
    DispatchResult,
    ManualDispatchPrompt,
    PhaseDispatchResult,
    AgentContext,
    PreviousPhaseInfo,
    PhaseOutput,
    AgentOutput,
    Workflow,
    WorkflowPhase,
    AgentDefinition,
    TerminalSession,
    TerminalSessionStatus,
} from '../types/core.js';
import { AgentRegistry } from './AgentRegistry.js';
import { MemoryManager } from './MemoryManager.js';
import { EventBus } from './EventBus.js';
import { TerminalDispatcher } from './TerminalDispatcher.js';

const execFileAsync = promisify(execFile);

// ============================================================================
// CONTEXT PIPELINE
// ============================================================================

export class ContextPipeline {
    private registry: AgentRegistry;
    private memoryManager: MemoryManager;

    constructor(registry: AgentRegistry, memoryManager: MemoryManager) {
        this.registry = registry;
        this.memoryManager = memoryManager;
    }

    /**
     * Construit le contexte complet pour un agent dans une phase donnee
     */
    async buildContext(
        agentId: AgentId,
        workflow: Workflow,
        phase: WorkflowPhase,
        feedback: string[],
        peerOutputs: Record<AgentId, string> = {},
    ): Promise<AgentContext> {
        const agent = this.registry.getRequired(agentId);

        // Construire les infos des phases precedentes
        const previousPhases = this.buildPreviousPhases(workflow, phase);

        // Charger les memoires pertinentes
        const memories = await this.loadMemories();

        return {
            agent,
            task: workflow.task,
            phase: {
                id: phase.id,
                name: phase.name,
                description: phase.description,
                iteration: phase.iteration,
                maxIterations: phase.maxIterations,
                feedback,
                mode: phase.mode || 'non-interactive',
            },
            previousPhases,
            peerOutputs,
            memories,
            projectInfo: workflow.context.projectInfo,
        };
    }

    /**
     * Genere le prompt utilisateur a partir du contexte
     */
    buildUserPrompt(context: AgentContext): string {
        const parts: string[] = [];

        // Task principale
        parts.push(`## Task\n${context.task}`);

        // Phase courante
        parts.push(`\n## Current Phase: ${context.phase.name}\n${context.phase.description}`);

        // Interactive mode instructions for code-producing phases
        if (context.phase.mode === 'interactive') {
            parts.push(`\n## Execution Mode: Interactive`);
            parts.push(`You have full access to tools (Read, Write, Edit, Bash). Create and modify files directly on disk.`);
            parts.push(`Follow the project's existing conventions and coding style.`);
            parts.push(`Run tests after making changes to verify correctness.`);
            parts.push(`Do NOT just output text — actually write the code and create the files.`);
        }

        if (context.phase.iteration > 1) {
            parts.push(`\n**Iteration ${context.phase.iteration}/${context.phase.maxIterations}**`);
        }

        // Feedback d'iteration precedente
        if (context.phase.feedback.length > 0) {
            parts.push(`\n## Feedback from Previous Iteration\n${context.phase.feedback.map(f => `- ${f}`).join('\n')}`);
        }

        // Outputs des phases precedentes
        if (context.previousPhases.length > 0) {
            parts.push('\n## Previous Phases Output');
            for (const prev of context.previousPhases) {
                parts.push(`\n### ${prev.phaseName} (${prev.status}, score: ${prev.score ?? 'N/A'})`);
                if (prev.filesModified.length > 0) {
                    parts.push(`\n**Files modified:** ${prev.filesModified.join(', ')}`);
                }
                for (const [aid, output] of Object.entries(prev.agentOutputs)) {
                    const truncated = output.length > 2000 ? output.slice(0, 2000) + '\n... [truncated]' : output;
                    parts.push(`\n**Agent ${aid}:**\n${truncated}`);
                }
            }
        }

        // Outputs des agents precedents dans cette phase
        const peerEntries = Object.entries(context.peerOutputs);
        if (peerEntries.length > 0) {
            parts.push('\n## Other Agents Output (same phase)');
            for (const [aid, output] of peerEntries) {
                const truncated = output.length > 3000 ? output.slice(0, 3000) + '\n... [truncated]' : output;
                parts.push(`\n### Agent ${aid}:\n${truncated}`);
            }
        }

        // Memoires
        const memoryEntries = Object.entries(context.memories);
        if (memoryEntries.length > 0) {
            parts.push('\n## Project Memories');
            for (const [name, content] of memoryEntries) {
                parts.push(`\n### ${name}\n${content}`);
            }
        }

        // Project info
        parts.push(`\n## Project Info\n- Name: ${context.projectInfo.name}\n- Language: ${context.projectInfo.language}\n- Framework: ${context.projectInfo.framework || 'N/A'}\n- Root: ${context.projectInfo.rootPath}`);

        return parts.join('\n');
    }

    private buildPreviousPhases(workflow: Workflow, currentPhase: WorkflowPhase): PreviousPhaseInfo[] {
        const result: PreviousPhaseInfo[] = [];

        for (const phase of workflow.phases) {
            if (phase.id === currentPhase.id) break;
            if (!phase.output) continue;

            const agentOutputs: Record<AgentId, string> = {};
            for (const [aid, agentOutput] of Object.entries(phase.output.agentOutputs)) {
                agentOutputs[aid] = agentOutput.output;
            }

            result.push({
                phaseId: phase.id,
                phaseName: phase.name,
                status: phase.status,
                score: phase.score,
                agentOutputs,
                filesModified: phase.output.filesModified || [],
            });
        }

        return result;
    }

    private async loadMemories(): Promise<Record<string, string>> {
        const memories: Record<string, string> = {};
        const names = await this.memoryManager.listNames();

        for (const name of names) {
            const content = await this.memoryManager.read(name);
            if (content) {
                memories[name] = content;
            }
        }

        return memories;
    }
}

// ============================================================================
// AGENT DISPATCHER
// ============================================================================

export class AgentDispatcher {
    private mode: DispatchMode;
    private registry: AgentRegistry;
    private pipeline: ContextPipeline;
    private eventBus: EventBus;
    private terminalDispatcher: TerminalDispatcher;
    private currentTerminalSession: TerminalSession | null = null;
    private interactive = false;

    constructor(
        registry: AgentRegistry,
        memoryManager: MemoryManager,
        eventBus: EventBus,
        mode: DispatchMode = 'manual',
    ) {
        this.mode = mode;
        this.registry = registry;
        this.pipeline = new ContextPipeline(registry, memoryManager);
        this.eventBus = eventBus;
        this.terminalDispatcher = new TerminalDispatcher();
    }

    getMode(): DispatchMode {
        return this.mode;
    }

    setMode(mode: DispatchMode): void {
        this.mode = mode;
    }

    getInteractive(): boolean {
        return this.interactive;
    }

    setInteractive(val: boolean): void {
        this.interactive = val;
    }

    /**
     * Dispatch tous les agents d'une phase sequentiellement.
     * Chaque agent recoit les outputs des agents precedents dans la meme phase.
     */
    async dispatchPhase(
        workflow: Workflow,
        phase: WorkflowPhase,
        feedback: string[] = [],
    ): Promise<PhaseDispatchResult> {
        const agentIds = phase.agents;

        await this.eventBus.emit('agent:phaseDispatchStarted', {
            workflowId: workflow.id,
            phaseId: phase.id,
            agents: agentIds,
            mode: this.mode,
        });

        const results: DispatchResult[] = [];
        const prompts: ManualDispatchPrompt[] = [];
        const peerOutputs: Record<AgentId, string> = {};

        // Mode terminal : spawn les panes et retour immediat
        if (this.mode === 'terminal') {
            for (const agentId of agentIds) {
                const context = await this.pipeline.buildContext(agentId, workflow, phase, feedback, peerOutputs);
                prompts.push(this.buildManualPrompt(context));

                results.push({
                    agentId,
                    mode: 'terminal',
                    status: 'SUCCESS',
                    output: '',
                    duration: 0,
                });
            }

            const session = await this.terminalDispatcher.spawnSession(
                prompts,
                workflow.context.projectInfo.rootPath,
                {
                    phaseName: phase.name,
                    iteration: phase.iteration,
                    task: workflow.task,
                },
                this.interactive,
            );
            this.currentTerminalSession = session;

            await this.eventBus.emit('agent:terminalSpawned', {
                workflowId: workflow.id,
                phaseId: phase.id,
                agents: agentIds,
                sessionDir: session.sessionDir,
            });

            await this.eventBus.emit('agent:phaseDispatchCompleted', {
                workflowId: workflow.id,
                phaseId: phase.id,
                agentCount: agentIds.length,
                mode: this.mode,
            });

            return {
                phaseId: phase.id,
                phaseName: phase.name,
                mode: this.mode,
                results,
                prompts,
                terminalSession: session,
            };
        }

        for (const agentId of agentIds) {
            const context = await this.pipeline.buildContext(agentId, workflow, phase, feedback, peerOutputs);

            if (this.mode === 'cli') {
                const result = await this.dispatchCliWithRetry(context);
                results.push(result);

                // Accumuler l'output pour les agents suivants
                if (result.status !== 'FAILED' && result.output) {
                    peerOutputs[agentId] = result.output;
                }

                await this.eventBus.emit('agent:dispatched', {
                    workflowId: workflow.id,
                    phaseId: phase.id,
                    agentId,
                    result,
                });
            } else {
                const prompt = this.buildManualPrompt(context);
                prompts.push(prompt);

                const result: DispatchResult = {
                    agentId,
                    mode: 'manual',
                    status: 'SUCCESS',
                    output: '',
                    duration: 0,
                };
                results.push(result);

                await this.eventBus.emit('agent:dispatched', {
                    workflowId: workflow.id,
                    phaseId: phase.id,
                    agentId,
                    result,
                });
            }
        }

        await this.eventBus.emit('agent:phaseDispatchCompleted', {
            workflowId: workflow.id,
            phaseId: phase.id,
            agentCount: agentIds.length,
            mode: this.mode,
        });

        return {
            phaseId: phase.id,
            phaseName: phase.name,
            mode: this.mode,
            results,
            prompts: this.mode === 'manual' ? prompts : undefined,
        };
    }

    /**
     * Genere les prompts pour un agent sans executer (utile meme en mode cli)
     */
    async getPromptForAgent(
        agentId: AgentId,
        workflow: Workflow,
        phase: WorkflowPhase,
        feedback: string[] = [],
        peerOutputs: Record<AgentId, string> = {},
    ): Promise<ManualDispatchPrompt> {
        const context = await this.pipeline.buildContext(agentId, workflow, phase, feedback, peerOutputs);
        return this.buildManualPrompt(context);
    }

    /**
     * Convertit les resultats de dispatch en PhaseOutput
     */
    static toPhaseOutput(dispatchResult: PhaseDispatchResult): PhaseOutput {
        const agentOutputs: Record<AgentId, AgentOutput> = {};
        const allFilesModified: string[] = [];
        const errors: string[] = [];

        for (const result of dispatchResult.results) {
            agentOutputs[result.agentId] = {
                agentId: result.agentId,
                status: result.status,
                output: result.output,
                filesCreated: [],
                filesModified: [],
                duration: result.duration,
                score: null,
            };

            if (result.status === 'FAILED' && result.error) {
                errors.push(`Agent ${result.agentId}: ${result.error}`);
            }
        }

        return {
            agentOutputs,
            filesModified: allFilesModified,
            errors,
            warnings: [],
        };
    }

    // ========================================================================
    // TERMINAL SESSION
    // ========================================================================

    /**
     * Retourne le statut de la session terminal en cours
     */
    async getTerminalStatus(): Promise<TerminalSessionStatus | null> {
        if (!this.currentTerminalSession) return null;
        return this.terminalDispatcher.getStatus(this.currentTerminalSession);
    }

    /**
     * Collecte les outputs de la session terminal en cours
     */
    async collectTerminalOutputs(): Promise<Record<AgentId, string> | null> {
        if (!this.currentTerminalSession) return null;
        return this.terminalDispatcher.collectOutputs(this.currentTerminalSession);
    }

    /**
     * Retourne la session terminal en cours
     */
    getCurrentTerminalSession(): TerminalSession | null {
        return this.currentTerminalSession;
    }

    /**
     * Retourne le TerminalDispatcher sous-jacent
     */
    getTerminalDispatcher(): TerminalDispatcher {
        return this.terminalDispatcher;
    }

    /**
     * Remet a zero la session terminal courante
     */
    resetTerminalSession(): void {
        this.currentTerminalSession = null;
    }

    // ========================================================================
    // PRIVATE
    // ========================================================================

    private static readonly MAX_RETRIES = 3;
    private static readonly RETRY_DELAYS = [1000, 2000, 4000]; // exponential backoff

    private async dispatchCliWithRetry(context: AgentContext): Promise<DispatchResult> {
        let lastError = '';
        const startTime = Date.now();

        for (let attempt = 0; attempt <= AgentDispatcher.MAX_RETRIES; attempt++) {
            const result = await this.dispatchCli(context);

            if (result.status !== 'FAILED') {
                result.retryCount = attempt;
                result.duration = Date.now() - startTime;
                return result;
            }

            lastError = result.error || 'Unknown error';

            // Ne pas retry si c'est une erreur de contenu (pas transitoire)
            if (lastError.includes('not found') || lastError.includes('invalid')) {
                result.retryCount = attempt;
                return result;
            }

            if (attempt < AgentDispatcher.MAX_RETRIES) {
                const delay = AgentDispatcher.RETRY_DELAYS[attempt] || 4000;
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        return {
            agentId: context.agent.id,
            mode: 'cli',
            status: 'FAILED',
            output: '',
            duration: Date.now() - startTime,
            retryCount: AgentDispatcher.MAX_RETRIES,
            error: `Failed after ${AgentDispatcher.MAX_RETRIES + 1} attempts. Last error: ${lastError}`,
        };
    }

    private async dispatchCli(context: AgentContext): Promise<DispatchResult> {
        const startTime = Date.now();
        const userPrompt = this.pipeline.buildUserPrompt(context);

        try {
            const args = [
                '--print',
                '--system-prompt', context.agent.systemPrompt,
            ];

            if (context.agent.model) {
                args.push('--model', context.agent.model);
            }

            args.push(userPrompt);

            const isWindows = process.platform === 'win32';
            const { stdout } = await execFileAsync('claude', args, {
                shell: isWindows,
                maxBuffer: 10 * 1024 * 1024, // 10MB
                timeout: 5 * 60 * 1000, // 5 minutes
            });

            return {
                agentId: context.agent.id,
                mode: 'cli',
                status: 'SUCCESS',
                output: stdout,
                duration: Date.now() - startTime,
            };
        } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            return {
                agentId: context.agent.id,
                mode: 'cli',
                status: 'FAILED',
                output: '',
                duration: Date.now() - startTime,
                error,
            };
        }
    }

    private buildManualPrompt(context: AgentContext): ManualDispatchPrompt {
        return {
            agentId: context.agent.id,
            agentName: context.agent.name,
            systemPrompt: context.agent.systemPrompt,
            userPrompt: this.pipeline.buildUserPrompt(context),
            model: context.agent.model,
        };
    }
}
