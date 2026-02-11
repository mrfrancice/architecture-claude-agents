/**
 * skills.tool - Outil MCP pour lister et consulter les skills disponibles
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const skillsTool: Tool = {
    name: 'orchestrator_skills',
    description: `Gère les skills disponibles dans le projet.

Actions disponibles :
- list : Liste tous les skills chargés depuis .claude/skills/*.md
- get : Détails d'un skill spécifique (name requis), incluant ses arguments et instructions`,
    inputSchema: {
        type: 'object',
        properties: {
            action: {
                type: 'string',
                enum: ['list', 'get'],
                description: 'Action à effectuer',
            },
            name: {
                type: 'string',
                description: 'Nom du skill (requis pour get)',
            },
        },
        required: ['action'],
    },
};
