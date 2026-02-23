/**
 * @claude-orchestrator/mcp-server
 *
 * Serveur MCP pour l'orchestration multi-agents Claude Code
 */

export { Orchestrator, getOrchestrator, type SystemStatus, type PhaseInfo } from './core/Orchestrator.js';
export { EventBus, getEventBus, type OrchestratorEvents, type EventName } from './core/EventBus.js';
export { ConfigLoader, type ProjectConfig, type DetectedTools } from './core/ConfigLoader.js';
export { MemoryManager } from './core/MemoryManager.js';
export { StateManager } from './core/StateManager.js';
export { AgentRegistry, getAgentRegistry } from './core/AgentRegistry.js';
export { ScoringEngine } from './core/ScoringEngine.js';
export { AgentDispatcher, ContextPipeline, extractSummary } from './core/AgentDispatcher.js';
export { HookEngine } from './core/HookEngine.js';
export { SnapshotManager, type Snapshot } from './core/SnapshotManager.js';
export { HookExecutor, type HookResult } from './core/HookExecutor.js';
export { SkillLoader } from './core/SkillLoader.js';
export * from './tools/index.js';

export const VERSION = '1.0.0';
