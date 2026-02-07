/**
 * rollback.tool - Outil MCP pour gérer les rollbacks
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const rollbackTool: Tool = {
    name: 'orchestrator_rollback',
    description: `Effectue un rollback vers un snapshot précédent.

Le système de snapshots permet de:
- Créer des points de restauration avant chaque phase
- Revenir à un état précédent en cas d'échec
- Préserver l'historique des modifications

Si aucun snapshotId n'est fourni, utilise le dernier snapshot valide.`,
    inputSchema: {
        type: 'object',
        properties: {
            snapshotId: {
                type: 'string',
                description: 'ID du snapshot vers lequel rollback (optionnel)',
            },
        },
    },
};
