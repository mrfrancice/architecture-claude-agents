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
import { healthTool } from './tools/health.tool.js';
import type { DispatchMode } from './types/core.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { version: PACKAGE_VERSION } = require('../package.json') as { version: string };
const SERVER_START_TIME = Date.now();

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
    healthTool,
];

const VALID_WORKFLOW_TYPES = new Set(['BUILD', 'REVIEW', 'OPTIMIZE', 'DESIGN', 'DEBUG', 'SECURITY_AUDIT', 'CUSTOM']);

type ToolHandler = (args: Record<string, unknown>, orch: Orchestrator) => Promise<unknown>;

const TOOL_HANDLERS: Record<string, ToolHandler> = {
    'orchestrator_workflow': async (args, orch) => {
        const { action, type, task, custom_name } = args as { action: string; type?: string; task?: string; custom_name?: string };
        switch (action) {
            case 'start': {
                const workflowType = type || 'BUILD';
                if (!VALID_WORKFLOW_TYPES.has(workflowType)) {
                    throw new Error(`Invalid workflow type: "${workflowType}". Valid types: ${[...VALID_WORKFLOW_TYPES].join(', ')}`);
                }
                if (!task) {
                    throw new Error('Parameter "task" is required for action "start"');
                }
                if (workflowType === 'CUSTOM' && !custom_name) {
                    throw new Error('Parameter "custom_name" is required when type is "CUSTOM"');
                }
                return orch.startWorkflow(workflowType as Parameters<Orchestrator['startWorkflow']>[0], task, custom_name);
            }
            case 'pause':
                return orch.pauseWorkflow();
            case 'resume':
                return orch.resumeWorkflow();
            case 'cancel':
                return orch.cancelWorkflow();
            case 'status':
                return orch.getWorkflowStatus();
            case 'phases':
                return orch.getCurrentPhaseInfo();
            case 'list_custom':
                return orch.listCustomWorkflows();
            default:
                throw new Error(`Unknown action: "${action}". Valid actions: start, pause, resume, cancel, status, phases, list_custom`);
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
        const { action, snapshotId, description } = args as { action?: string; snapshotId?: string; description?: string };
        switch (action || 'restore') {
            case 'restore':
                return orch.rollback(snapshotId);
            case 'list':
                return orch.listSnapshots();
            case 'create':
                return orch.createSnapshot(description || 'Manual snapshot');
            default:
                throw new Error(`Unknown action: "${action}". Valid actions: restore, list, create`);
        }
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

    'orchestrator_health': async (_args, orch) => {
        const workflow = await orch.getWorkflowStatus();
        const activeWorkflows = workflow && workflow.status === 'RUNNING' ? 1 : 0;
        return {
            status: 'ok',
            uptime: Math.floor((Date.now() - SERVER_START_TIME) / 1000),
            version: PACKAGE_VERSION,
            activeWorkflows,
        };
    },

    'orchestrator_agents': async (args, orch) => {
        const { action, agent_id, mode, name, system_prompt, description, capabilities, interactive } = args as {
            action: string; agent_id?: string; mode?: string;
            name?: string; system_prompt?: string; description?: string; capabilities?: string[];
            interactive?: boolean;
        };
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

            case 'auto_dispatch':
                return orch.autoDispatchPhase();

            case 'set_mode':
                if (!mode) throw new Error('Parameter "mode" is required for action "set_mode"');
                if (mode !== 'manual' && mode !== 'cli' && mode !== 'terminal') {
                    throw new Error(`Invalid mode: "${mode}". Valid modes: manual, cli, terminal`);
                }
                orch.setDispatchMode(mode as DispatchMode);
                return { mode: orch.getDispatchMode() };

            case 'get_mode':
                return { mode: orch.getDispatchMode() };

            case 'set_interactive':
                orch.setTerminalInteractive(interactive === true);
                return { interactive: orch.getTerminalInteractive() };

            case 'get_interactive':
                return { interactive: orch.getTerminalInteractive() };

            case 'get_prompt': {
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
            }

            case 'current_phase':
                return orch.getCurrentPhaseInfo();

            case 'register': {
                if (!agent_id) throw new Error('Parameter "agent_id" is required for action "register"');
                if (!name) throw new Error('Parameter "name" is required for action "register"');
                if (!system_prompt) throw new Error('Parameter "system_prompt" is required for action "register"');
                registry.register({
                    id: agent_id,
                    name,
                    description: description || '',
                    systemPrompt: system_prompt,
                    capabilities: capabilities || [],
                    builtIn: false,
                });
                return { registered: agent_id, total: registry.list().length };
            }

            case 'terminal_status':
                return orch.getTerminalStatus();

            case 'terminal_collect':
                return orch.collectTerminalResults();

            default:
                throw new Error(`Unknown action: "${action}". Valid actions: list, get, dispatch, auto_dispatch, set_mode, get_mode, set_interactive, get_interactive, get_prompt, current_phase, register, terminal_status, terminal_collect`);
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
