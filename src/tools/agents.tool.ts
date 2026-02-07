/**
 * agents.tool - Outil MCP pour gerer et dispatcher les agents
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const agentsTool: Tool = {
    name: 'orchestrator_agents',
    description: `Gere le catalogue d'agents et leur dispatch sur les phases du workflow.

Actions disponibles :
- **list** : Liste tous les agents disponibles (built-in + custom)
- **get** : Details d'un agent specifique (id requis)
- **dispatch** : Dispatch les agents de la phase courante. En mode "manual", retourne les prompts structures. En mode "cli", execute claude en subprocess.
- **set_mode** : Change le mode de dispatch ("manual" ou "cli")
- **get_mode** : Retourne le mode de dispatch actuel
- **get_prompt** : Genere le prompt complet pour un agent sur la phase courante (agent_id requis)

Modes de dispatch :
- **manual** (defaut) : Retourne les system prompts et user prompts. Claude s'auto-execute comme chaque agent.
- **cli** : Execute "claude --print" en subprocess pour chaque agent. Automatise completement le dispatch.`,
    inputSchema: {
        type: 'object',
        properties: {
            action: {
                type: 'string',
                enum: ['list', 'get', 'dispatch', 'set_mode', 'get_mode', 'get_prompt'],
                description: 'Action a effectuer',
            },
            agent_id: {
                type: 'string',
                description: 'ID de l\'agent (requis pour "get" et "get_prompt")',
            },
            mode: {
                type: 'string',
                enum: ['manual', 'cli'],
                description: 'Mode de dispatch (requis pour "set_mode")',
            },
        },
        required: ['action'],
    },
};
