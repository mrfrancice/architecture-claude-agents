# MCP Orchestrator

Serveur MCP d'orchestration multi-agents pour Claude Code. Coordonne des agents IA specialises a travers des workflows structures avec scoring, iteration et rollback.

## Installation

```bash
npm install
npm run build
```

## Configuration MCP

Ajouter dans `~/.mcp.json` :

```json
{
  "mcpServers": {
    "orchestrator": {
      "command": "node",
      "args": ["/chemin/vers/mcp-orchestrator/dist/server.js"]
    }
  }
}
```

## 7 Outils MCP

| Outil | Description |
|-------|-------------|
| `orchestrator_workflow` | Cycle de vie workflow (start, pause, resume, cancel, status, phases) |
| `orchestrator_agents` | Catalogue agents + dispatch (list, get, dispatch, auto_dispatch, register) |
| `orchestrator_validate` | Valider une phase (scoring 6 axes) |
| `orchestrator_score` | Calcul de score standalone |
| `orchestrator_rollback` | Snapshots Git (restore, list, create) |
| `orchestrator_memory` | Memoires persistantes (list, read, write, delete) |
| `orchestrator_status` | Statut systeme complet |

## 8 Agents Built-in

| Agent | Specialite |
|-------|-----------|
| `fullstack-ui-architect` | Architecture frontend/backend, UI |
| `test-automation-strategist` | Strategies de test, QA |
| `security-expert` | Securite applicative, OWASP |
| `senior-code-reviewer` | Revue de code, qualite |
| `database-optimization-expert` | BDD, requetes, indexing |
| `distributed-systems-architect` | Microservices, scalabilite |
| `technical-writer` | Documentation technique |
| `ux-design-strategist` | Design UX, accessibilite |

## 7 Types de Workflow

| Type | Phases |
|------|--------|
| `BUILD` | Design → Code → Tests → Security → Review |
| `REVIEW` | Analysis → Security Check → Report |
| `OPTIMIZE` | Profiling → Optimization → Verification |
| `DESIGN` | Requirements → Architecture → Documentation |
| `DEBUG` | Investigation → Fix → Verification |
| `SECURITY_AUDIT` | Scan → Analysis → Remediation → Report |
| `CUSTOM` | Charge depuis `.claude/orchestrator/workflows/*.json` |

## Modes de Dispatch

### Mode Manual (defaut)

L'orchestrateur retourne les prompts structures. Claude s'auto-execute comme chaque agent :

```
orchestrator_workflow { action: "start", type: "BUILD", task: "..." }
orchestrator_agents { action: "dispatch" }
  → Recoit system_prompt + user_prompt pour chaque agent
  → Claude adopte le role et execute
orchestrator_validate { output: "..." }
  → Score + decision (PASS/ITERATE/FAIL)
```

### Mode CLI (automatise)

L'orchestrateur execute `claude --print` en subprocess pour chaque agent :

```
orchestrator_agents { action: "set_mode", mode: "cli" }
orchestrator_agents { action: "auto_dispatch" }
  → Execute chaque agent en subprocess
  → Auto-validate avec scoring
  → Avance automatiquement
```

## Scoring (6 axes, 100 points)

| Axe | Poids | Source |
|-----|-------|--------|
| Correctness | 25% | `tsc --noEmit` |
| Completeness | 20% | Requirements coverage |
| Security | 20% | OWASP patterns |
| Best Practices | 15% | ESLint |
| Tests | 15% | Jest/Vitest |
| Documentation | 5% | README, JSDoc |

**Decisions** : >= 90 → PASS, 60-89 → ITERATE (max 3), < 60 → FAIL

## Configuration Custom

### Agents custom (`.claude/orchestrator/agents/*.json`)

```json
{
  "id": "my-agent",
  "name": "My Custom Agent",
  "description": "Description",
  "systemPrompt": "You are...",
  "capabilities": ["cap1", "cap2"],
  "model": null
}
```

### Workflows custom (`.claude/orchestrator/workflows/*.json`)

```json
{
  "name": "my-workflow",
  "description": "Description",
  "phases": [
    {
      "name": "Phase 1",
      "description": "Description",
      "agents": ["agent-id"],
      "maxIterations": 3
    }
  ]
}
```

### Hooks (`.claude/orchestrator/hooks.json`)

```json
{
  "hooks": [
    {
      "name": "hook-name",
      "event": "workflow:completed",
      "command": "echo done",
      "enabled": true
    }
  ]
}
```

**Events disponibles** : `workflow:started`, `workflow:completed`, `workflow:failed`, `phase:started`, `phase:completed`, `phase:failed`, `score:calculated`, `agent:dispatched`

## Architecture

```
Claude Code ←→ MCP Server (stdio)
                    │
              Orchestrator (singleton)
              ┌─────┼─────────────┐
              │     │             │
        AgentRegistry    AgentDispatcher
        (8 built-in)    (cli / manual)
              │          │
              │    ContextPipeline
              │     (prompts)
              │
        ┌─────┼─────┬──────────┐
    EventBus  │  ScoringEngine  SnapshotManager
    (pub/sub) │   (6 axes)      (git rollback)
              │
        ┌─────┼─────┐
    StateMgr  MemMgr  HookEngine
    (persist) (ctx)   (shell cmds)
```
