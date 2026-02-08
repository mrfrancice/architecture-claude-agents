/**
 * rollback.tool - Outil MCP pour gerer les snapshots et rollbacks
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const rollbackTool: Tool = {
    name: 'orchestrator_rollback',
    description: `Gere les snapshots Git et les rollbacks.

Actions disponibles :
- **restore** (defaut) : Restaure un snapshot. Si aucun snapshotId, utilise le dernier.
- **list** : Liste tous les snapshots disponibles.
- **create** : Cree un snapshot manuel (description optionnelle).

Le systeme cree automatiquement des snapshots avant chaque phase.`,
    inputSchema: {
        type: 'object',
        properties: {
            action: {
                type: 'string',
                enum: ['restore', 'list', 'create'],
                description: 'Action a effectuer (defaut: restore)',
            },
            snapshotId: {
                type: 'string',
                description: 'ID du snapshot vers lequel rollback (pour "restore")',
            },
            description: {
                type: 'string',
                description: 'Description du snapshot (pour "create")',
            },
        },
    },
};
