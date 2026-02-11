/**
 * agents.tool - Outil MCP pour gerer et dispatcher les agents
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const agentsTool: Tool = {
    name: 'orchestrator_agents',
    description: `Gere le catalogue d'agents et leur dispatch sur les phases du workflow.

Actions disponibles :
- **list** : Liste tous les agents disponibles (built-in + custom)
- **get** : Details d'un agent specifique (agent_id requis)
- **dispatch** : Dispatch les agents de la phase courante. En mode "manual", retourne les prompts structures. En mode "cli", execute claude en subprocess. En mode "terminal", ouvre N panes Windows Terminal.
- **auto_dispatch** : Dispatch + auto-validate. En mode CLI, execute et valide. En mode terminal, poll les agents (toutes les 3s, timeout 30min) puis auto-valide quand tous sont termines. En mode manual, retourne les prompts sans valider.
- **set_mode** : Change le mode de dispatch ("manual", "cli" ou "terminal")
- **get_mode** : Retourne le mode de dispatch actuel
- **set_interactive** : Active/desactive le mode interactif pour les panes terminal (interactive=true/false). En mode interactif, claude est lance sans --print, l'utilisateur peut interagir dans le pane. Start-Transcript capture la session.
- **get_interactive** : Retourne si le mode interactif est actif
- **get_prompt** : Genere le prompt complet pour un agent sur la phase courante (agent_id requis)
- **current_phase** : Affiche les infos de la phase courante et ses agents assignes
- **register** : Enregistre un agent custom dynamiquement (agent_id, name, system_prompt, description, capabilities requis)
- **terminal_status** : Verifie le statut des agents en mode terminal (quels agents ont termine)
- **terminal_collect** : Collecte les outputs des agents terminaux et les injecte dans le PhaseOutput

Modes de dispatch :
- **manual** (defaut) : Retourne les system prompts et user prompts. Claude s'auto-execute comme chaque agent.
- **cli** : Execute "claude --print" en subprocess pour chaque agent avec retry automatique (3 tentatives, backoff exponentiel).
- **terminal** : Ouvre N panes Windows Terminal (1 par agent). Chaque pane execute "claude --print" en temps reel. Utilisez terminal_status pour verifier l'avancement et terminal_collect pour recuperer les resultats.`,
    inputSchema: {
        type: 'object',
        properties: {
            action: {
                type: 'string',
                enum: ['list', 'get', 'dispatch', 'auto_dispatch', 'set_mode', 'get_mode', 'set_interactive', 'get_interactive', 'get_prompt', 'current_phase', 'register', 'terminal_status', 'terminal_collect'],
                description: 'Action a effectuer',
            },
            agent_id: {
                type: 'string',
                description: 'ID de l\'agent (requis pour "get", "get_prompt" et "register")',
            },
            mode: {
                type: 'string',
                enum: ['manual', 'cli', 'terminal'],
                description: 'Mode de dispatch (requis pour "set_mode")',
            },
            name: {
                type: 'string',
                description: 'Nom de l\'agent (requis pour "register")',
            },
            system_prompt: {
                type: 'string',
                description: 'System prompt de l\'agent (requis pour "register")',
            },
            description: {
                type: 'string',
                description: 'Description de l\'agent (pour "register")',
            },
            capabilities: {
                type: 'array',
                items: { type: 'string' },
                description: 'Capacites de l\'agent (pour "register")',
            },
            interactive: {
                type: 'boolean',
                description: 'Active/desactive le mode interactif terminal (pour "set_interactive")',
            },
        },
        required: ['action'],
    },
};
