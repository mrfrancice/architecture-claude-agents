/**
 * memory.tool - Outil MCP pour gérer les mémoires
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const memoryTool: Tool = {
    name: 'orchestrator_memory',
    description: `Gère les mémoires persistantes du projet.

Actions disponibles:
- list: Liste toutes les mémoires disponibles
- read: Lit le contenu d'une mémoire
- write: Écrit ou met à jour une mémoire
- delete: Supprime une mémoire

Les mémoires sont stockées dans .claude/memories/ et persistent entre les sessions.
Elles permettent de:
- Conserver le contexte projet
- Partager des informations entre agents
- Mémoriser les décisions architecturales`,
    inputSchema: {
        type: 'object',
        properties: {
            action: {
                type: 'string',
                enum: ['list', 'read', 'write', 'delete'],
                description: 'Action à effectuer',
            },
            name: {
                type: 'string',
                description: 'Nom de la mémoire (requis pour read/write/delete)',
            },
            content: {
                type: 'string',
                description: 'Contenu de la mémoire (requis pour write)',
            },
        },
        required: ['action'],
    },
};
