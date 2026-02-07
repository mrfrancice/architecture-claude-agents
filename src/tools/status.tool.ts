/**
 * status.tool - Outil MCP pour récupérer le statut système
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const statusTool: Tool = {
    name: 'orchestrator_status',
    description: `Récupère le statut complet du système d'orchestration.

Informations retournées:
- État d'initialisation
- Session courante
- Workflow en cours (si présent)
  - ID, type, statut
  - Phase courante
  - Progression (%)
- Nombre de hooks chargés
- Nombre de mémoires chargées
- Statistiques:
  - Workflows complétés/échoués
  - Score moyen
  - Hooks déclenchés`,
    inputSchema: {
        type: 'object',
        properties: {},
    },
};
