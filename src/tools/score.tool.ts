/**
 * score.tool - Outil MCP pour calculer les scores
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const scoreTool: Tool = {
    name: 'orchestrator_score',
    description: `Calcule le score objectif pour une phase ou un ensemble de fichiers.

Breakdown du score (total 100%):
- Correctness (25%): Code compile et fonctionne
- Completeness (20%): Requirements couverts
- Security (20%): Scan OWASP, pas de vulnérabilités
- Best Practices (15%): Score lint, conventions
- Tests (15%): Coverage et pass rate
- Documentation (5%): Présence de docs

Bonuses:
- High coverage (>90%): +5
- No lint errors: +3
- Documentation complete: +2

Penalties:
- Lint errors: -2 par erreur
- No tests: -10
- Low coverage (<50%): -5`,
    inputSchema: {
        type: 'object',
        properties: {
            phaseId: {
                type: 'string',
                description: 'ID de la phase (optionnel)',
            },
            files: {
                type: 'array',
                items: { type: 'string' },
                description: 'Liste des fichiers à scorer (optionnel)',
            },
        },
    },
};
