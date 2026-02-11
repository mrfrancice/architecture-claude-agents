/**
 * agents.tool - Outil MCP pour gérer les agents et leur dispatch
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const agentsTool: Tool = {
    name: 'orchestrator_agents',
    description: `Gère le catalogue d'agents et leur dispatch sur les phases du workflow.

Actions disponibles :
- list : Liste tous les agents disponibles (built-in + custom)
- get : Détails d'un agent spécifique (agent_id requis)
- dispatch : Dispatch les agents de la phase courante. En mode "manual", retourne les prompts structurés. En mode "cli", exécute claude en subprocess.
- auto_dispatch : Dispatch + auto-validate. En mode CLI, exécute et valide. En mode manual, retourne les prompts sans valider.
- set_mode : Change le mode de dispatch ("manual" ou "cli")
- get_mode : Retourne le mode de dispatch actuel
- get_prompt : Génère le prompt complet pour un agent sur la phase courante (agent_id requis)
- current_phase : Affiche les infos de la phase courante et ses agents assignés
- register : Enregistre un agent custom dynamiquement (agent_id, name, system_prompt, description, capabilities requis)

Modes de dispatch :
- manual (défaut) : Retourne les system prompts et user prompts. Claude s'auto-exécute comme chaque agent.
- cli : Exécute "claude --print" en subprocess pour chaque agent avec retry automatique (3 tentatives, backoff exponentiel).`,
    inputSchema: {
        type: 'object',
        properties: {
            action: {
                type: 'string',
                enum: ['list', 'get', 'dispatch', 'auto_dispatch', 'set_mode', 'get_mode', 'get_prompt', 'current_phase', 'register'],
                description: 'Action à effectuer',
            },
            agent_id: {
                type: 'string',
                description: "ID de l'agent (requis pour get, get_prompt, register)",
            },
            mode: {
                type: 'string',
                enum: ['manual', 'cli'],
                description: 'Mode de dispatch (requis pour set_mode)',
            },
            name: {
                type: 'string',
                description: "Nom de l'agent (pour register)",
            },
            system_prompt: {
                type: 'string',
                description: "System prompt de l'agent (pour register)",
            },
            description: {
                type: 'string',
                description: "Description de l'agent (pour register)",
            },
            capabilities: {
                type: 'array',
                items: { type: 'string' },
                description: "Capacités de l'agent (pour register)",
            },
        },
        required: ['action'],
    },
};
