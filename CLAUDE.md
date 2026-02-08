# CLAUDE.md - MCP Orchestrator

## Project Overview

MCP Orchestrator is a multi-agent orchestration server for Claude Code. It coordinates specialized AI agents through structured workflows with scoring, iteration, and rollback capabilities.

## Tech Stack

- **Language**: TypeScript (strict mode)
- **Runtime**: Node.js ES2022 modules
- **Protocol**: MCP (Model Context Protocol) via stdio transport
- **Dependencies**: `@modelcontextprotocol/sdk`

## Project Structure

```
src/
  types/core.ts          # All shared types
  core/                  # Core engine modules (singletons)
    Orchestrator.ts      # Main coordinator
    EventBus.ts          # Typed pub/sub events
    AgentRegistry.ts     # Agent catalog (8 built-in + custom)
    AgentDispatcher.ts   # CLI/manual dispatch with retry
    StateManager.ts      # Persistence (state, history, stats)
    ConfigLoader.ts      # Auto-detect project (lang, framework, tools)
    MemoryManager.ts     # Persistent memories
    SnapshotManager.ts   # Git-based rollback
    ScoringEngine.ts     # 6-axis scoring (100 pts)
    HookEngine.ts        # Shell commands on events
  tools/                 # MCP tool schemas
  server.ts              # MCP server entry point
  index.ts               # Public API exports
```

## Build & Run

```bash
npx tsc          # Build
npx tsc --noEmit # Type-check only
node dist/server.js  # Start MCP server
```

## Key Patterns

- **Singletons**: `getOrchestrator()`, `getEventBus()`, `getAgentRegistry()`
- **Event-driven**: All modules communicate via EventBus (20 event types)
- **Strategy pattern**: DispatchMode (`manual` | `cli`)
- **Pipeline**: ContextPipeline builds agent prompts from workflow state

## Conventions

- All imports use `.js` extension (ES modules)
- French comments in tool descriptions, English in code
- No circular dependencies
- All core types in `src/types/core.ts`
- Tool schemas in `src/tools/*.tool.ts`, handlers in `src/server.ts`

## Configuration Files

```
.claude/
  orchestrator/
    hooks.json           # Event hooks (shell commands)
    agents/*.json        # Custom agent definitions
    workflows/*.json     # Custom workflow templates
  memories/              # Persistent context files
```
