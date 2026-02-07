/**
 * MCP Orchestrator Server
 *
 * Serveur MCP principal exposant les outils d'orchestration multi-agents
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import { getOrchestrator, type Orchestrator } from './core/Orchestrator.js';
import { workflowTool } from './tools/workflow.tool.js';
import { validateTool } from './tools/validate.tool.js';
import { scoreTool } from './tools/score.tool.js';
import { rollbackTool } from './tools/rollback.tool.js';
import { memoryTool } from './tools/memory.tool.js';
import { statusTool } from './tools/status.tool.js';
import { agentsTool } from './tools/agents.tool.js';
import type { DispatchMode } from './types/core.js';

// ============================================================================
// TOOLS REGISTRY
// ============================================================================

const TOOLS: Tool[] = [
    workflowTool,
    validateTool,
    scoreTool,
    rollbackTool,
    memoryTool,
    statusTool,
    agentsTool,
];

const VALID_WORKFLOW_TYPES = new Set(['BUILD', 'REVIEW', 'OPTIMIZE', 'DESIGN', 'DEBUG', 'SECURITY_AUDIT']);

type ToolHandler = (args: Record<string, unknown>, orch: Orchestrator) => Promise<unknown>;

const TOOL_HANDLERS: Record<string, ToolHandler> = {
    'orchestrator_workflow': async (args, orch) => {
        const { action, type, task } = args as { action: string; type?: string; task?: string };
        switch (action) {
            case 'start': {
                const workflowType = type || 'BUILD';
                if (!VALID_WORKFLOW_TYPES.has(workflowType)) {
                    throw new Error(`Invalid workflow type: "${workflowType}". Valid types: ${[...VALID_WORKFLOW_TYPES].join(', ')}`);
                }
                if (!task) {
                    throw new Error('Parameter "task" is required for action "start"');
                }
                return orch.startWorkflow(workflowType as Parameters<Orchestrator['startWorkflow']>[0], task);
            }
            case 'pause':
                return orch.pauseWorkflow();
            case 'resume':
                return orch.resumeWorkflow();
            case 'cancel':
                return orch.cancelWorkflow();
            case 'status':
                return orch.getWorkflowStatus();
            default:
                throw new Error(`Unknown action: "${action}". Valid actions: start, pause, resume, cancel, status`);
        }
    },

    'orchestrator_validate': async (args, orch) => {
        const { phaseId, output } = args as { phaseId?: string; output?: string };
        return orch.validatePhase(phaseId, output);
    },

    'orchestrator_score': async (args, orch) => {
        const { phaseId, files } = args as { phaseId?: string; files?: string[] };
        return orch.calculateScore(phaseId, files);
    },

    'orchestrator_rollback': async (args, orch) => {
        const { snapshotId } = args as { snapshotId?: string };
        return orch.rollback(snapshotId);
    },

    'orchestrator_memory': async (args, orch) => {
        const { action, name, content } = args as { action: string; name?: string; content?: string };
        switch (action) {
            case 'list':
                return orch.listMemories();
            case 'read':
                if (!name) throw new Error('Parameter "name" is required for action "read"');
                return orch.readMemory(name);
            case 'write':
                if (!name) throw new Error('Parameter "name" is required for action "write"');
                if (!content) throw new Error('Parameter "content" is required for action "write"');
                return orch.writeMemory(name, content);
            case 'delete':
                if (!name) throw new Error('Parameter "name" is required for action "delete"');
                return orch.deleteMemory(name);
            default:
                throw new Error(`Unknown action: "${action}". Valid actions: list, read, write, delete`);
        }
    },

    'orchestrator_status': async (_args, orch) => {
        return orch.getSystemStatus();
    },

    'orchestrator_agents': async (args, orch) => {
        const { action, agent_id, mode } = args as { action: string; agent_id?: string; mode?: string };
        const registry = orch.getAgentRegistry();

        switch (action) {
            case 'list':
                return registry.list().map(a => ({
                    id: a.id,
                    name: a.name,
                    description: a.description,
                    capabilities: a.capabilities,
                    builtIn: a.builtIn,
                    model: a.model || null,
                }));

            case 'get':
                if (!agent_id) throw new Error('Parameter "agent_id" is required for action "get"');
                return registry.getRequired(agent_id);

            case 'dispatch':
                return orch.dispatchPhase();

            case 'set_mode':
                if (!mode) throw new Error('Parameter "mode" is required for action "set_mode"');
                if (mode !== 'manual' && mode !== 'cli') {
                    throw new Error(`Invalid mode: "${mode}". Valid modes: manual, cli`);
                }
                orch.setDispatchMode(mode as DispatchMode);
                return { mode: orch.getDispatchMode() };

            case 'get_mode':
                return { mode: orch.getDispatchMode() };

            case 'get_prompt':
                if (!agent_id) throw new Error('Parameter "agent_id" is required for action "get_prompt"');
                const prompts = await orch.getManualPrompts();
                if (!prompts.success || !prompts.data) {
                    throw new Error(prompts.error?.message || 'Failed to generate prompts');
                }
                const agentPrompt = prompts.data.find(p => p.agentId === agent_id);
                if (!agentPrompt) {
                    throw new Error(`Agent "${agent_id}" is not assigned to the current phase`);
                }
                return agentPrompt;

            default:
                throw new Error(`Unknown action: "${action}". Valid actions: list, get, dispatch, set_mode, get_mode, get_prompt`);
        }
    },
};

// ============================================================================
// SERVER SETUP
// ============================================================================

async function main(): Promise<void> {
    // Initialiser l'orchestrateur
    const orchestrator = getOrchestrator();
    await orchestrator.initialize();

    // Créer le serveur MCP
    const server = new Server(
        {
            name: 'claude-orchestrator',
            version: '1.0.0',
        },
        {
            capabilities: {
                tools: {},
            },
        },
    );

    // Handler: Liste des outils
    server.setRequestHandler(ListToolsRequestSchema, async () => {
        return { tools: TOOLS };
    });

    // Handler: Appel d'outil
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;
        const handler = TOOL_HANDLERS[name];

        if (!handler) {
            return {
                content: [
                    {
                        type: 'text' as const,
                        text: `Unknown tool: ${name}`,
                    },
                ],
                isError: true,
            };
        }

        try {
            const result = await handler(args || {}, orchestrator);
            return {
                content: [
                    {
                        type: 'text' as const,
                        text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
                    },
                ],
            };
        } catch (error) {
            return {
                content: [
                    {
                        type: 'text' as const,
                        text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
                isError: true,
            };
        }
    });

    // Démarrer le serveur
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Claude Orchestrator MCP Server running');
}

// ============================================================================
// ENTRY POINT
// ============================================================================

main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
