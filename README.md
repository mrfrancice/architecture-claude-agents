# MCP Orchestrator

Serveur MCP d'orchestration multi-agents pour Claude Code. Coordonne des agents IA specialises a travers des workflows structures avec scoring, iteration, non-regression et rollback.

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
| `orchestrator_agents` | Catalogue agents + dispatch (list, get, dispatch, auto_dispatch, register, terminal_status, terminal_collect) |
| `orchestrator_validate` | Valider une phase (scoring 6 axes) |
| `orchestrator_score` | Calcul de score standalone |
| `orchestrator_rollback` | Snapshots Git (restore, list, create) |
| `orchestrator_memory` | Memoires persistantes (list, read, write, delete) |
| `orchestrator_status` | Statut systeme complet |

## 8 Agents Built-in

| Agent | Specialite |
|-------|-----------|
| `fullstack-ui-architect` | Architecture frontend/backend, UI |
| `test-automation-strategist` | Strategies de test, QA, non-regression |
| `security-expert` | Securite applicative, OWASP |
| `senior-code-reviewer` | Revue de code, qualite |
| `database-optimization-expert` | BDD, requetes, indexing |
| `distributed-systems-architect` | Microservices, scalabilite |
| `technical-writer` | Documentation technique |
| `ux-design-strategist` | Design UX, accessibilite |

## 7 Types de Workflow

| Type | Phases |
|------|--------|
| `BUILD` | Design → Code → Tests → **Regression** → Security → Review |
| `REVIEW` | Analysis → Security Check → Report |
| `OPTIMIZE` | Profiling → Optimization → **Regression** |
| `DESIGN` | Requirements → Architecture → Documentation |
| `DEBUG` | Investigation → Fix → **Regression** |
| `SECURITY_AUDIT` | Scan → Analysis → Remediation → **Regression** → Report |
| `CUSTOM` | Charge depuis `.claude/orchestrator/workflows/*.json` |

### Phase de non-regression

Les workflows qui modifient du code (BUILD, OPTIMIZE, DEBUG, SECURITY_AUDIT) incluent une phase **Regression** automatique. L'agent `test-automation-strategist` :

1. Lance la suite de tests complete du projet
2. Identifie les tests casses par les modifications
3. Rapporte le nom, fichier et message d'erreur de chaque echec
4. Propose des corrections

Si le score est < 90, le systeme re-itere (max 3 fois) pour corriger les regressions.

## 3 Modes de Dispatch

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

### Mode Terminal (visuel, Windows)

Ouvre N fenetres/panes pour voir les agents travailler en temps reel :

```
orchestrator_agents { action: "set_mode", mode: "terminal" }
orchestrator_agents { action: "dispatch" }
  → Ouvre N panes Windows Terminal (ou N fenetres PowerShell en fallback)
  → Chaque pane execute claude --print avec affichage en temps reel
orchestrator_agents { action: "terminal_status" }
  → Verifie quels agents ont termine (fichiers .done)
orchestrator_agents { action: "terminal_collect" }
  → Collecte les outputs et les injecte dans le PhaseOutput
orchestrator_validate
  → Score et avancement
```

**Layout automatique des panes** (Windows Terminal) :

```
1 agent:  [  A  ]
2 agents: [ A | B ]
3 agents: [ A | B ]
          [   | C ]
4 agents: [ A | B ]
          [ C | D ]
5+ :      grille adaptative
```

**Fallback** : Si Windows Terminal (`wt`) n'est pas disponible, chaque agent s'ouvre dans une fenetre PowerShell separee via `Start-Process pwsh`.

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

**Bonuses** : tests >= 90 (+5), best practices >= 95 (+3), documentation >= 90 (+2), security 100 (+2)

**Penalties** : tests < 30 (-10), tests < 50 (-5), best practices < 50 (-5), security < 60 (-10)

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

Champs requis : `id`, `name`, `systemPrompt`. Les fichiers invalides sont ignores avec un warning.

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

Champs requis : `name`, `phases` (non-vide), chaque phase doit avoir `name` et `agents` (non-vide). Les fichiers invalides sont ignores avec un warning.

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

**Events disponibles** : `workflow:started`, `workflow:completed`, `workflow:failed`, `phase:started`, `phase:completed`, `phase:failed`, `score:calculated`, `agent:dispatched`, `agent:terminalSpawned`, `agent:terminalAgentDone`, `agent:terminalAllDone`

## Architecture

```
Claude Code ←→ MCP Server (stdio)
                    │
              Orchestrator (singleton)
              ┌─────┼─────────────┐
              │     │             │
        AgentRegistry    AgentDispatcher
        (8 built-in)    (manual/cli/terminal)
              │          │
              │    ContextPipeline    TerminalDispatcher
              │     (prompts)         (wt / pwsh)
              │
        ┌─────┼─────┬──────────┐
    EventBus  │  ScoringEngine  SnapshotManager
    (pub/sub) │   (6 axes)      (git rollback)
              │
        ┌─────┼─────┐
    StateMgr  MemMgr  HookEngine
    (persist) (ctx)   (shell cmds)
```
