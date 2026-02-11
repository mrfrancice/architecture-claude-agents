/**
 * @claude-orchestrator/mcp-server
 *
 * Serveur MCP pour l'orchestration multi-agents Claude Code
 */

export { Orchestrator, getOrchestrator, type SystemStatus } from './core/Orchestrator.js';
export { EventBus, getEventBus, type OrchestratorEvents, type EventName } from './core/EventBus.js';
export { StateManager, type OrchestratorStats, type SessionState } from './core/StateManager.js';
export { ConfigLoader, type ProjectConfig, type DetectedTools } from './core/ConfigLoader.js';
export { MemoryManager, type MemoryEntry, type MemoryMetadata } from './core/MemoryManager.js';
export { SnapshotManager, type Snapshot, type FileBaseline } from './core/SnapshotManager.js';
export { ScoringEngine } from './core/ScoringEngine.js';
export { HookEngine, type HookDefinition, type HooksConfig, type HookResult } from './core/HookEngine.js';
export { AgentRegistry, getAgentRegistry } from './core/AgentRegistry.js';
export { AgentDispatcher, ContextPipeline } from './core/AgentDispatcher.js';
export { TerminalDispatcher } from './core/TerminalDispatcher.js';
export * from './tools/index.js';

export const VERSION = '1.0.0';
