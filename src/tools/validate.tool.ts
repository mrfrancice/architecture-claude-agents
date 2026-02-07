/**
 * validate.tool - Outil MCP pour valider les outputs
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const validateTool: Tool = {
    name: 'orchestrator_validate',
    description: `Valide l'output d'une phase de workflow.

Effectue:
- Vérification des blockers (NO_OUTPUT, SYNTAX_ERROR, CRITICAL_SECURITY)
- Calcul du score objectif (correctness, completeness, security, etc.)
- Génération du feedback structuré
- Décision: PASS (≥90%) | ITERATE (60-89%) | FAIL (<60%)

Si aucun phaseId n'est fourni, valide la phase courante.`,
    inputSchema: {
        type: 'object',
        properties: {
            phaseId: {
                type: 'string',
                description: 'ID de la phase à valider (optionnel, défaut: phase courante)',
            },
            output: {
                type: 'string',
                description: 'Output à valider (optionnel, récupéré automatiquement)',
            },
        },
    },
};
