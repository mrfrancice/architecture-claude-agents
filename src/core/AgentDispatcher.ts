/**
 * AgentDispatcher - Dispatch séquentiel des agents avec peer outputs
 *
 * Deux modes :
 * - manual : retourne les prompts structurés (Claude joue chaque agent)
 * - cli : exécute "claude --print" en subprocess via stdin
 *
 * Contient ContextPipeline pour construire le prompt complet d'un agent.
 */

import { spawn } from 'node:child_process';
import type {
    AgentId, AgentContext, DispatchMode, DispatchResult,
    ManualDispatchPrompt, PhaseDispatchResult, PreviousPhaseInfo,
    Workflow, WorkflowPhase,
} from '../types/core.js';
import type { AgentRegistry } from './AgentRegistry.js';
import type { MemoryManager } from './MemoryManager.js';
import type { EventBus } from './EventBus.js';
import type { HookExecutor } from './HookExecutor.js';
import { logInfo, logDebug, logError, logWarn } from '../utils/safe-logger.js';
import { truncate } from '../utils/string-helpers.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const CLI_TIMEOUT = 5 * 60 * 1000; // 5 minutes
const CLI_MAX_BUFFER = 10 * 1024 * 1024; // 10MB
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000]; // Exponential backoff

const PEER_OUTPUT_MAX_LENGTH = 3000;
const PREVIOUS_PHASE_MAX_LENGTH = 3000;
const AGENT_SUMMARY_MAX_LENGTH = 2000;

// ============================================================================
// CONTEXT PIPELINE
// ============================================================================

export class ContextPipeline {
    private hookExecutor?: HookExecutor;

    constructor(
        private registry: AgentRegistry,
        private memoryManager: MemoryManager,
        hookExecutor?: HookExecutor,
    ) {
        this.hookExecutor = hookExecutor;
    }

    /**
     * Construit le contexte complet pour un agent.
     */
    async buildContext(
        agentId: AgentId,
        workflow: Workflow,
        phase: WorkflowPhase,
        feedback: string[] | undefined,
        peerOutputs: Record<AgentId, string>,
    ): Promise<AgentContext> {
        const agent = this.registry.getRequired(agentId);
        const memories = this.memoryManager.getAll();
        const previousPhases = this.buildPreviousPhases(workflow, phase);

        return {
            agent,
            task: workflow.task,
            phase: {
                id: phase.id,
                name: phase.name,
                description: phase.description,
                iteration: phase.iteration,
                maxIterations: phase.maxIterations,
                feedback: feedback || phase.lastFeedback || [],
                mode: phase.mode,
            },
            previousPhases,
            peerOutputs: { ...peerOutputs },
            memories,
            projectInfo: workflow.context.projectInfo,
        };
    }

    /**
     * Construit le user prompt pour un agent à partir du contexte.
     */
    buildUserPrompt(context: AgentContext): string {
        const sections: string[] = [];

        // Task
        sections.push(`## Task\n${context.task}`);

        // Current Phase
        sections.push(`## Current Phase: ${context.phase.name}\n${context.phase.description}`);

        // Execution mode
        if (context.phase.mode === 'interactive') {
            sections.push('## Execution Mode: Interactive\nYou may ask clarifying questions and interact with the user.');
        }

        // Feedback from previous iteration
        if (context.phase.iteration > 1 && context.phase.feedback.length > 0) {
            sections.push(
                '## Feedback from Previous Iteration\n' +
                context.phase.feedback.map(f => `- ${f}`).join('\n'),
            );
        }

        // Previous phases output
        if (context.previousPhases.length > 0) {
            const prevSections: string[] = [];
            for (const prev of context.previousPhases) {
                const header = `### ${prev.phaseName} (${prev.status}, score: ${prev.score ?? 'N/A'})`;
                if (prev.consolidatedOutput) {
                    prevSections.push(
                        `${header}\n**Phase Synthesis:**\n${truncate(prev.consolidatedOutput, PREVIOUS_PHASE_MAX_LENGTH)}`,
                    );
                } else {
                    const agentLines = Object.entries(prev.agentOutputs)
                        .map(([id, output]) => `**Agent ${id}:** ${truncate(output, AGENT_SUMMARY_MAX_LENGTH)}`)
                        .join('\n\n');
                    prevSections.push(`${header}\n${agentLines}`);
                }
            }
            sections.push('## Previous Phases Output\n' + prevSections.join('\n\n'));
        }

        // Peer outputs (same phase, accumulated)
        const peerEntries = Object.entries(context.peerOutputs);
        if (peerEntries.length > 0) {
            const peerLines = peerEntries
                .map(([id, output]) => `**Agent ${id}:** ${truncate(output, PEER_OUTPUT_MAX_LENGTH)}`)
                .join('\n\n');
            sections.push('## Other Agents Output (same phase)\n' + peerLines);
        }

        // Project memories
        const memoryEntries = Object.entries(context.memories);
        if (memoryEntries.length > 0) {
            const memLines = memoryEntries
                .map(([name, content]) => `### ${name}\n${truncate(content, 1000)}`)
                .join('\n\n');
            sections.push('## Project Memories\n' + memLines);
        }

        // Collaboration context
        const agent = context.agent;
        if (agent.collaboratesWith?.length || agent.escalatesTo) {
            const collabLines: string[] = [];
            if (agent.collaboratesWith?.length) {
                collabLines.push(`- Collaborates with: ${agent.collaboratesWith.join(', ')}`);
            }
            if (agent.escalatesTo) {
                collabLines.push(`- Escalates to: ${agent.escalatesTo}`);
            }
            // Inject collaboration protocol summary if available
            const protocol = this.registry.getProtocol('collaboration-protocols');
            if (protocol && agent.collaboratesWith?.length) {
                collabLines.push(`\n### Collaboration Protocol\n${truncate(protocol, 2000)}`);
            }
            sections.push('## Collaboration Context\n' + collabLines.join('\n'));
        }

        // Active hook guidance
        if (this.hookExecutor) {
            const guidance = this.hookExecutor.formatGuidanceForPrompt();
            if (guidance) {
                sections.push('## Active Hook Guidance\n' + guidance);
            }
        }

        // Project info
        const pi = context.projectInfo;
        sections.push(
            '## Project Info\n' +
            `- Name: ${pi.name}\n` +
            `- Language: ${pi.language}\n` +
            `- Framework: ${pi.framework || 'none'}\n` +
            `- Root: ${pi.rootPath}`,
        );

        return sections.join('\n\n');
    }

    // ========================================================================
    // HELPERS
    // ========================================================================

    private buildPreviousPhases(workflow: Workflow, currentPhase: WorkflowPhase): PreviousPhaseInfo[] {
        const result: PreviousPhaseInfo[] = [];

        for (const phase of workflow.phases) {
            if (phase.id === currentPhase.id) break;
            if (phase.status !== 'PASS' && phase.status !== 'ITERATE') continue;

            const agentOutputs: Record<AgentId, string> = {};
            if (phase.output) {
                for (const [agentId, ao] of Object.entries(phase.output.agentOutputs)) {
                    agentOutputs[agentId] = ao.summary || ao.output;
                }
            }

            result.push({
                phaseId: phase.id,
                phaseName: phase.name,
                status: phase.status,
                score: phase.score,
                agentOutputs,
                filesModified: phase.output?.filesModified || [],
                consolidatedOutput: phase.output?.consolidatedOutput,
            });
        }

        return result;
    }
}

// ============================================================================
// SUMMARY EXTRACTION
// ============================================================================

const SUMMARY_SECTIONS = [
    /^##\s+Summary\b/im,
    /^##\s+Key\s+Findings?\b/im,
    /^##\s+Results?\b/im,
    /^##\s+Conclusion\b/im,
    /^##\s+Résumé\b/im,
    /^##\s+Synthèse\b/im,
];

export function extractSummary(output: string): string {
    for (const pattern of SUMMARY_SECTIONS) {
        const match = output.match(pattern);
        if (match && match.index !== undefined) {
            const start = match.index;
            // Find next ## heading or end of string
            const rest = output.slice(start + match[0].length);
            const nextHeading = rest.search(/^##\s/m);
            const section = nextHeading >= 0
                ? rest.slice(0, nextHeading).trim()
                : rest.trim();
            if (section.length > 0) {
                return truncate(section, 500);
            }
        }
    }

    // Fallback: first 500 chars
    return truncate(output, 500);
}

// ============================================================================
// AGENT DISPATCHER
// ============================================================================

export class AgentDispatcher {
    private mode: DispatchMode = 'manual';
    private pipeline: ContextPipeline;
    private eventBus: EventBus;

    constructor(
        registry: AgentRegistry,
        memoryManager: MemoryManager,
        eventBus: EventBus,
        hookExecutor?: HookExecutor,
    ) {
        this.pipeline = new ContextPipeline(registry, memoryManager, hookExecutor);
        this.eventBus = eventBus;
    }

    getMode(): DispatchMode {
        return this.mode;
    }

    setMode(mode: DispatchMode): void {
        this.mode = mode;
        logInfo(`Dispatch mode set to: ${mode}`);
    }

    /**
     * Dispatch tous les agents d'une phase séquentiellement.
     */
    async dispatchPhase(
        workflow: Workflow,
        phase: WorkflowPhase,
        feedback?: string[],
    ): Promise<PhaseDispatchResult> {
        logInfo(`Dispatching phase ${phase.name} in ${this.mode} mode`);

        this.eventBus.emit('agent:phaseDispatchStarted', {
            workflowId: workflow.id,
            phaseId: phase.id,
            agentIds: phase.agents,
            mode: this.mode,
        });

        const peerOutputs: Record<AgentId, string> = {};
        const results: DispatchResult[] = [];
        const prompts: ManualDispatchPrompt[] = [];

        for (const agentId of phase.agents) {
            let context;
            try {
                context = await this.pipeline.buildContext(
                    agentId, workflow, phase, feedback, peerOutputs,
                );
            } catch (err: unknown) {
                const errorMsg = err instanceof Error ? err.message : String(err);
                logWarn(`Skipping agent ${agentId}: ${errorMsg}`);
                results.push({
                    agentId,
                    mode: this.mode,
                    status: 'FAILED',
                    output: '',
                    duration: 0,
                    error: errorMsg,
                });
                continue;
            }

            if (this.mode === 'cli') {
                const result = await this.dispatchCli(context);
                results.push(result);

                if (result.output) {
                    peerOutputs[agentId] = result.output;
                }

                this.eventBus.emit('agent:dispatched', {
                    workflowId: workflow.id,
                    phaseId: phase.id,
                    agentId,
                    mode: 'cli',
                    duration: result.duration,
                    status: result.status,
                });
            } else {
                // Manual mode: build prompts and emit event
                const prompt = this.buildManualPrompt(context);
                prompts.push(prompt);

                this.eventBus.emit('agent:dispatched', {
                    workflowId: workflow.id,
                    phaseId: phase.id,
                    agentId,
                    mode: 'manual',
                    duration: 0,
                    status: 'SUCCESS',
                });
            }
        }

        this.eventBus.emit('agent:phaseDispatchCompleted', {
            workflowId: workflow.id,
            phaseId: phase.id,
            results: results.length,
            mode: this.mode,
        });

        return {
            phaseId: phase.id,
            phaseName: phase.name,
            mode: this.mode,
            results,
            prompts: prompts.length > 0 ? prompts : undefined,
        };
    }

    /**
     * Génère le prompt pour un agent spécifique.
     */
    async getAgentPrompt(
        agentId: AgentId,
        workflow: Workflow,
        phase: WorkflowPhase,
    ): Promise<ManualDispatchPrompt> {
        const context = await this.pipeline.buildContext(agentId, workflow, phase, undefined, {});
        return this.buildManualPrompt(context);
    }

    // ========================================================================
    // CLI DISPATCH
    // ========================================================================

    private async dispatchCli(context: AgentContext): Promise<DispatchResult> {
        const systemPrompt = context.agent.systemPrompt;
        const userPrompt = this.pipeline.buildUserPrompt(context);
        const startTime = Date.now();

        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            try {
                logDebug(`CLI dispatch agent ${context.agent.id}, attempt ${attempt + 1}`);

                const stdout = await this.spawnClaude(
                    systemPrompt, userPrompt, context.agent.model, context.projectInfo.rootPath,
                );

                const duration = Date.now() - startTime;
                return {
                    agentId: context.agent.id,
                    mode: 'cli',
                    status: 'SUCCESS',
                    output: stdout,
                    duration,
                    retryCount: attempt,
                };
            } catch (err: unknown) {
                const errorMsg = err instanceof Error ? err.message : String(err);
                logWarn(`CLI dispatch failed for ${context.agent.id}, attempt ${attempt + 1}: ${errorMsg}`);

                if (attempt < MAX_RETRIES - 1) {
                    await this.sleep(RETRY_DELAYS[attempt]);
                } else {
                    const duration = Date.now() - startTime;
                    return {
                        agentId: context.agent.id,
                        mode: 'cli',
                        status: 'FAILED',
                        output: '',
                        duration,
                        retryCount: attempt,
                        error: errorMsg,
                    };
                }
            }
        }

        // Should not reach here, but TypeScript needs it
        return {
            agentId: context.agent.id,
            mode: 'cli',
            status: 'FAILED',
            output: '',
            duration: Date.now() - startTime,
            error: 'Unexpected error',
        };
    }

    /**
     * Spawns claude CLI without shell to prevent command injection.
     * Uses spawn() with argv array — no shell metacharacter interpretation.
     * User prompt is sent via stdin to avoid OS argument length limits.
     */
    private spawnClaude(
        systemPrompt: string, userPrompt: string, model: string | undefined, cwd: string,
    ): Promise<string> {
        return new Promise((resolve, reject) => {
            const args = ['--print', '--system-prompt', systemPrompt];
            if (model) {
                args.push('--model', model);
            }

            const proc = spawn('claude', args, {
                cwd,
                stdio: ['pipe', 'pipe', 'pipe'],
                shell: false,
                timeout: CLI_TIMEOUT,
            });

            const stdoutChunks: Buffer[] = [];
            const stderrChunks: Buffer[] = [];
            let totalBytes = 0;

            proc.stdout.on('data', (chunk: Buffer) => {
                totalBytes += chunk.length;
                if (totalBytes <= CLI_MAX_BUFFER) {
                    stdoutChunks.push(chunk);
                }
            });

            proc.stderr.on('data', (chunk: Buffer) => {
                stderrChunks.push(chunk);
            });

            proc.on('close', (code) => {
                const stdout = Buffer.concat(stdoutChunks).toString('utf-8');
                if (code === 0) {
                    resolve(stdout);
                } else {
                    const stderr = Buffer.concat(stderrChunks).toString('utf-8');
                    reject(new Error(`claude exited with code ${code}: ${stderr.slice(0, 500)}`));
                }
            });

            proc.on('error', (err) => {
                reject(new Error(`Failed to spawn claude: ${err.message}`));
            });

            // Send user prompt via stdin
            proc.stdin.write(userPrompt, 'utf-8');
            proc.stdin.end();
        });
    }

    // ========================================================================
    // MANUAL DISPATCH
    // ========================================================================

    private buildManualPrompt(context: AgentContext): ManualDispatchPrompt {
        return {
            agentId: context.agent.id,
            agentName: context.agent.name,
            systemPrompt: context.agent.systemPrompt,
            userPrompt: this.pipeline.buildUserPrompt(context),
            model: context.agent.model,
        };
    }

    // ========================================================================
    // HELPERS
    // ========================================================================

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
