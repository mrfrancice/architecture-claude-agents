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
];

type ToolHandler = (args: Record<string, unknown>, orch: Orchestrator) => Promise<unknown>;

const TOOL_HANDLERS: Record<string, ToolHandler> = {
    'orchestrator_workflow': async (args, orch) => {
        const { action, type, task } = args as { action: string; type?: string; task?: string };
        switch (action) {
            case 'start':
                return orch.startWorkflow((type || 'BUILD') as Parameters<Orchestrator['startWorkflow']>[0], task || '');
            case 'pause':
                return orch.pauseWorkflow();
            case 'resume':
                return orch.resumeWorkflow();
            case 'cancel':
                return orch.cancelWorkflow();
            case 'status':
                return orch.getWorkflowStatus();
            default:
                throw new Error(`Unknown action: ${action}`);
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
                return orch.readMemory(name || '');
            case 'write':
                return orch.writeMemory(name || '', content || '');
            case 'delete':
                return orch.deleteMemory(name || '');
            default:
                throw new Error(`Unknown action: ${action}`);
        }
    },

    'orchestrator_status': async (_args, orch) => {
        return orch.getSystemStatus();
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
