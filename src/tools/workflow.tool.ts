/**
 * workflow.tool - Outil MCP pour gerer les workflows
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const workflowTool: Tool = {
    name: 'orchestrator_workflow',
    description: `Gerer les workflows d'orchestration multi-agents.

Actions disponibles:
- **start** : Demarre un nouveau workflow (type + task requis)
- **pause** : Met en pause le workflow courant
- **resume** : Reprend un workflow en pause
- **cancel** : Annule le workflow courant
- **status** : Recupere le statut du workflow
- **phases** : Affiche la phase courante et ses agents
- **list_custom** : Liste les workflows custom disponibles

Types de workflow:
- BUILD: Creation de features (design → code → tests → security → review)
- REVIEW: Revue de code (analysis → security → report)
- OPTIMIZE: Optimisation (profiling → optimization → verification)
- DESIGN: Conception (requirements → architecture → documentation)
- DEBUG: Debugging (investigation → fix → verification)
- SECURITY_AUDIT: Audit securite (scan → analysis → remediation → report)
- CUSTOM: Workflow personnalise (custom_name requis, charge depuis .claude/orchestrator/workflows/)`,
    inputSchema: {
        type: 'object',
        properties: {
            action: {
                type: 'string',
                enum: ['start', 'pause', 'resume', 'cancel', 'status', 'phases', 'list_custom'],
                description: 'Action a effectuer',
            },
            type: {
                type: 'string',
                enum: ['BUILD', 'REVIEW', 'OPTIMIZE', 'DESIGN', 'DEBUG', 'SECURITY_AUDIT', 'CUSTOM'],
                description: 'Type de workflow (requis pour start)',
            },
            task: {
                type: 'string',
                description: 'Description de la tache (requis pour start)',
            },
            custom_name: {
                type: 'string',
                description: 'Nom du workflow custom (requis quand type=CUSTOM)',
            },
        },
        required: ['action'],
    },
};
