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
} from '../types/core.js';
import { AgentRegistry } from './AgentRegistry.js';
import { MemoryManager } from './MemoryManager.js';
import { EventBus } from './EventBus.js';

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
            },
            previousPhases,
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
                for (const [aid, output] of Object.entries(prev.agentOutputs)) {
                    const truncated = output.length > 2000 ? output.slice(0, 2000) + '\n... [truncated]' : output;
                    parts.push(`\n**Agent ${aid}:**\n${truncated}`);
                }
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
    }

    getMode(): DispatchMode {
        return this.mode;
    }

    setMode(mode: DispatchMode): void {
        this.mode = mode;
    }

    /**
     * Dispatch tous les agents d'une phase sequentiellement
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

        for (const agentId of agentIds) {
            const context = await this.pipeline.buildContext(agentId, workflow, phase, feedback);

            if (this.mode === 'cli') {
                const result = await this.dispatchCli(context);
                results.push(result);

                await this.eventBus.emit('agent:dispatched', {
                    workflowId: workflow.id,
                    phaseId: phase.id,
                    agentId,
                    result,
                });
            } else {
                const prompt = this.buildManualPrompt(context);
                prompts.push(prompt);

                // En mode manual, on cree un DispatchResult "en attente"
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
    ): Promise<ManualDispatchPrompt> {
        const context = await this.pipeline.buildContext(agentId, workflow, phase, feedback);
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
    // PRIVATE
    // ========================================================================

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
