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
import { skillsTool } from './tools/skills.tool.js';
import type { DispatchMode, AgentDefinition } from './types/core.js';
import {
    validateId, validateOptionalId, validateOptionalString,
    validateStringLength, validateStringArray, validateEnum, validateName,
    MAX_LENGTHS, MAX_ARRAY_LENGTHS,
} from './utils/input-validation.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const SERVER_START_TIME = Date.now();
const VERSION = '1.0.0';

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
    skillsTool,
];

type ToolHandler = (args: Record<string, unknown>, orch: Orchestrator) => Promise<unknown>;

const TOOL_HANDLERS: Record<string, ToolHandler> = {
    'orchestrator_workflow': async (args, orch) => {
        const action = validateEnum(args.action, 'action', ['start', 'pause', 'resume', 'cancel', 'status', 'phases'] as const);
        switch (action) {
            case 'start': {
                const type = validateEnum(
                    args.type || 'BUILD', 'type',
                    ['BUILD', 'REVIEW', 'OPTIMIZE', 'DESIGN', 'DEBUG', 'SECURITY_AUDIT', 'CUSTOM'] as const,
                );
                const task = validateStringLength(args.task || '', 'task', MAX_LENGTHS.task);
                const customTemplate = args.custom_template as Parameters<Orchestrator['startWorkflow']>[2];
                return orch.startWorkflow(type as Parameters<Orchestrator['startWorkflow']>[0], task, customTemplate);
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
            default:
                throw new Error(`Unknown action: ${action}`);
        }
    },

    'orchestrator_validate': async (args, orch) => {
        const phaseId = validateOptionalId(args.phaseId, 'phaseId');
        const output = validateOptionalString(args.output, 'output', MAX_LENGTHS.output);
        return orch.validatePhase(phaseId, output);
    },

    'orchestrator_score': async (args, orch) => {
        const phaseId = validateOptionalId(args.phaseId, 'phaseId');
        const files = args.files != null
            ? validateStringArray(args.files, 'files', MAX_ARRAY_LENGTHS.files, MAX_LENGTHS.filePath)
            : undefined;
        return orch.calculateScore(phaseId, files);
    },

    'orchestrator_rollback': async (args, orch) => {
        const action = args.action != null
            ? validateEnum(args.action, 'action', ['list', 'create', 'restore'] as const)
            : undefined;
        const snapshotId = validateOptionalId(args.snapshotId, 'snapshotId');
        const description = validateOptionalString(args.description, 'description', MAX_LENGTHS.description);
        return orch.rollback(action, snapshotId, description);
    },

    'orchestrator_memory': async (args, orch) => {
        const action = validateEnum(args.action, 'action', ['list', 'read', 'write', 'delete'] as const);
        switch (action) {
            case 'list':
                return orch.listMemories();
            case 'read': {
                const name = validateName(args.name, 'name');
                return orch.readMemory(name);
            }
            case 'write': {
                const name = validateName(args.name, 'name');
                const content = validateStringLength(args.content || '', 'content', MAX_LENGTHS.memoryContent);
                return orch.writeMemory(name, content);
            }
            case 'delete': {
                const name = validateName(args.name, 'name');
                return orch.deleteMemory(name);
            }
            default:
                throw new Error(`Unknown action: ${action}`);
        }
    },

    'orchestrator_status': async (_args, orch) => {
        return orch.getSystemStatus();
    },

    'orchestrator_agents': async (args, orch) => {
        const { action } = args as { action: string };

        switch (action) {
            case 'list': {
                const agents = orch.listAgents();
                return agents.map(a => ({
                    id: a.id,
                    name: a.name,
                    description: a.description,
                    domain: a.domain,
                    level: a.level,
                    model: a.model,
                    builtIn: a.builtIn,
                    capabilities: a.capabilities.slice(0, 5),
                }));
            }

            case 'get': {
                const agentId = validateId(args.agent_id, 'agent_id');
                const agent = orch.getAgent(agentId);
                if (!agent) throw new Error(`Agent not found: ${agentId}`);
                return agent;
            }

            case 'dispatch': {
                return orch.dispatchPhase();
            }

            case 'auto_dispatch': {
                return orch.autoDispatchPhase();
            }

            case 'set_mode': {
                const mode = validateEnum(args.mode, 'mode', ['manual', 'cli'] as const);
                orch.setDispatchMode(mode as DispatchMode);
                return { mode, message: `Dispatch mode set to ${mode}` };
            }

            case 'get_mode': {
                return { mode: orch.getDispatchMode() };
            }

            case 'get_prompt': {
                const agentId = validateId(args.agent_id, 'agent_id');
                return orch.getAgentPrompt(agentId);
            }

            case 'current_phase': {
                return orch.getCurrentPhaseInfo();
            }

            case 'register': {
                const agentId = validateId(args.agent_id, 'agent_id');
                const name = validateStringLength(args.name, 'name', MAX_LENGTHS.name);
                const systemPrompt = validateStringLength(args.system_prompt, 'system_prompt', MAX_LENGTHS.systemPrompt);
                const description = validateStringLength(args.description, 'description', MAX_LENGTHS.description);
                const capabilities = validateStringArray(
                    args.capabilities, 'capabilities',
                    MAX_ARRAY_LENGTHS.capabilities, MAX_LENGTHS.capability,
                );

                const agent: AgentDefinition = {
                    id: agentId,
                    name,
                    description,
                    systemPrompt,
                    capabilities,
                    builtIn: false,
                };

                orch.registerAgent(agent);
                return { registered: true, agentId, name };
            }

            default:
                throw new Error(`Unknown agents action: ${action}`);
        }
    },

    'orchestrator_skills': async (args, orch) => {
        const action = validateEnum(args.action, 'action', ['list', 'get'] as const);
        switch (action) {
            case 'list': {
                const skills = orch.listSkills();
                return skills.map(s => ({
                    name: s.name,
                    description: s.description,
                    arguments: s.arguments,
                }));
            }
            case 'get': {
                const name = validateName(args.name, 'name');
                const skill = orch.getSkill(name);
                if (!skill) throw new Error(`Skill not found: ${name}`);
                return skill;
            }
            default:
                throw new Error(`Unknown skills action: ${action}`);
        }
    },

    'orchestrator_health': async (_args, orch) => {
        const status = await orch.getSystemStatus();
        return {
            status: 'ok',
            uptime: Math.round((Date.now() - SERVER_START_TIME) / 1000),
            version: VERSION,
            activeWorkflows: status.currentWorkflow ? 1 : 0,
        };
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
            version: VERSION,
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
            const message = error instanceof Error ? error.message : String(error);
            // Sanitize: strip file paths and stack traces from error messages
            const sanitized = message
                .replace(/(?:[A-Z]:\\|\/)[^\s:]+/g, '<path>')
                .replace(/\n\s+at\s+.*/g, '')
                .slice(0, 500);
            return {
                content: [
                    {
                        type: 'text' as const,
                        text: `Error: ${sanitized}`,
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
