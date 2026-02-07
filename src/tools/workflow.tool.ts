/**
 * workflow.tool - Outil MCP pour gérer les workflows
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const workflowTool: Tool = {
    name: 'orchestrator_workflow',
    description: `Gérer les workflows d'orchestration multi-agents.

Actions disponibles:
- start: Démarre un nouveau workflow
- pause: Met en pause le workflow courant
- resume: Reprend un workflow en pause
- cancel: Annule le workflow courant
- status: Récupère le statut du workflow

Types de workflow:
- BUILD: Création de features (design → code → tests → security → review)
- REVIEW: Revue de code (analysis → security → report)
- OPTIMIZE: Optimisation (profiling → optimization → verification)
- DESIGN: Conception (requirements → architecture → documentation)
- DEBUG: Debugging (investigation → fix → verification)
- SECURITY_AUDIT: Audit sécurité (scan → analysis → remediation → report)`,
    inputSchema: {
        type: 'object',
        properties: {
            action: {
                type: 'string',
                enum: ['start', 'pause', 'resume', 'cancel', 'status'],
                description: 'Action à effectuer',
            },
            type: {
                type: 'string',
                enum: ['BUILD', 'REVIEW', 'OPTIMIZE', 'DESIGN', 'DEBUG', 'SECURITY_AUDIT'],
                description: 'Type de workflow (requis pour start)',
            },
            task: {
                type: 'string',
                description: 'Description de la tâche (requis pour start)',
            },
        },
        required: ['action'],
    },
};
