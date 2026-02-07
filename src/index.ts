/**
 * @claude-orchestrator/mcp-server
 *
 * Serveur MCP pour l'orchestration multi-agents Claude Code
 */

export { Orchestrator, getOrchestrator, type SystemStatus } from './core/Orchestrator.js';
export * from './tools/index.js';

export const VERSION = '1.0.0';
