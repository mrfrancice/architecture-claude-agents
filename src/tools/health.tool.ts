/**
 * health.tool - Outil MCP pour le health check du serveur
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const healthTool: Tool = {
    name: 'orchestrator_health',
    description: `Retourne l'état de santé du serveur d'orchestration.

Informations retournées:
- status: "ok" si le serveur fonctionne
- uptime: temps depuis le démarrage du serveur (en secondes)
- version: version du package depuis package.json
- activeWorkflows: nombre de workflows en cours d'exécution`,
    inputSchema: {
        type: 'object',
        properties: {},
    },
};
