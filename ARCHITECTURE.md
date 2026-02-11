# Architecture - MCP Orchestrator

Documentation technique complete du systeme d'orchestration multi-agents.

---

## Table des matieres

1. [Vue d'ensemble](#1-vue-densemble)
2. [Structure du projet](#2-structure-du-projet)
3. [Architecture des modules](#3-architecture-des-modules)
4. [Systeme de types](#4-systeme-de-types)
5. [Cycle de vie d'un workflow](#5-cycle-de-vie-dun-workflow)
6. [Workflows built-in](#6-workflows-built-in)
7. [Systeme d'agents](#7-systeme-dagents)
8. [Communication inter-agents](#8-communication-inter-agents)
9. [Modes de dispatch](#9-modes-de-dispatch)
10. [ContextPipeline](#10-contextpipeline)
11. [EventBus - Communication interne](#11-eventbus---communication-interne)
12. [Scoring Engine](#12-scoring-engine)
13. [Persistance et etat](#13-persistance-et-etat)
14. [Snapshots et rollback](#14-snapshots-et-rollback)
15. [Memoires partagees](#15-memoires-partagees)
16. [Hooks evenementiels](#16-hooks-evenementiels)
17. [Detection de projet](#17-detection-de-projet)
18. [Protocole MCP](#18-protocole-mcp)
19. [Diagrammes de flux](#19-diagrammes-de-flux)
20. [Tests](#20-tests)

---

## 1. Vue d'ensemble

MCP Orchestrator est un serveur MCP (Model Context Protocol) qui coordonne des agents IA specialises a travers des workflows structures. Il fonctionne comme un chef d'orchestre : chaque agent est un musicien expert dans son domaine, et l'orchestrateur les fait jouer dans le bon ordre avec les bonnes partitions.

```
┌─────────────────────────────────────────────────────────────────┐
│                        Claude Code (IDE)                        │
└───────────────────────────┬─────────────────────────────────────┘
                            │ MCP (stdio)
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                     MCP Server (server.ts)                      │
│                      7 outils exposes                           │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Orchestrator (singleton)                       │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐ │
│  │ AgentRegistry│  │AgentDispatcher│  │    ScoringEngine     │ │
│  │ (8 built-in) │  │ (3 modes)    │  │    (6 axes, 100pts)  │ │
│  └──────┬───────┘  └──────┬───────┘  └───────────┬───────────┘ │
│         │                 │                       │             │
│  ┌──────┴───────┐  ┌──────┴───────┐  ┌───────────┴───────────┐ │
│  │ ConfigLoader │  │ContextPipel. │  │  SnapshotManager      │ │
│  │ (detection)  │  │ (prompts)    │  │  (git rollback)       │ │
│  └──────────────┘  └──────┬───────┘  └───────────────────────┘ │
│                           │                                     │
│  ┌──────────────┐  ┌──────┴───────┐  ┌───────────────────────┐ │
│  │  EventBus    │  │  Terminal    │  │    StateManager       │ │
│  │ (23 events)  │  │  Dispatcher  │  │    (persistence)      │ │
│  └──────────────┘  └──────────────┘  └───────────────────────┘ │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐                             │
│  │ MemoryManager│  │  HookEngine  │                             │
│  │ (contexte)   │  │ (shell cmds) │                             │
│  └──────────────┘  └──────────────┘                             │
└─────────────────────────────────────────────────────────────────┘
```

**Chiffres cles** :
- 5 285 lignes de code source (22 fichiers)
- 222 tests automatises (11 fichiers de test)
- 7 outils MCP
- 8 agents built-in
- 7 types de workflow (6 built-in + CUSTOM)
- 23 evenements EventBus
- 6 axes de scoring

---

## 2. Structure du projet

```
mcp-orchestrator/
├── src/
│   ├── types/
│   │   └── core.ts              (225 lignes)  Tous les types partages
│   ├── core/
│   │   ├── Orchestrator.ts      (1208 lignes) Coordinateur principal
│   │   ├── ScoringEngine.ts     (598 lignes)  Moteur de scoring 6 axes
│   │   ├── AgentDispatcher.ts   (527 lignes)  Dispatch des agents
│   │   ├── TerminalDispatcher.ts(442 lignes)  Mode terminal visuel
│   │   ├── AgentRegistry.ts     (372 lignes)  Catalogue des agents
│   │   ├── SnapshotManager.ts   (278 lignes)  Snapshots Git
│   │   ├── StateManager.ts      (253 lignes)  Persistance etat
│   │   ├── ConfigLoader.ts      (228 lignes)  Detection projet
│   │   ├── HookEngine.ts        (209 lignes)  Hooks evenementiels
│   │   ├── MemoryManager.ts     (170 lignes)  Memoires persistantes
│   │   └── EventBus.ts          (161 lignes)  Bus d'evenements type
│   ├── tools/
│   │   ├── workflow.tool.ts     (52 lignes)   Schema outil workflow
│   │   ├── score.tool.ts        (44 lignes)   Schema outil score
│   │   ├── memory.tool.ts       (41 lignes)   Schema outil memoire
│   │   ├── rollback.tool.ts     (35 lignes)   Schema outil rollback
│   │   ├── validate.tool.ts     (31 lignes)   Schema outil validation
│   │   ├── status.tool.ts       (28 lignes)   Schema outil statut
│   │   ├── agents.tool.ts       (65 lignes)   Schema outil agents
│   │   └── index.ts             (11 lignes)   Re-export schemas
│   ├── server.ts                (287 lignes)  Point d'entree MCP
│   └── index.ts                 (20 lignes)   API publique
├── tests/
│   ├── Orchestrator.test.ts     (25 tests)
│   ├── ScoringEngine.test.ts    (102 tests)
│   ├── AgentDispatcher.test.ts  (12 tests)
│   ├── AgentRegistry.test.ts    (10 tests)
│   ├── TerminalDispatcher.test.ts(10 tests)
│   ├── StateManager.test.ts     (18 tests)
│   ├── ConfigLoader.test.ts     (15 tests)
│   ├── MemoryManager.test.ts    (10 tests)
│   ├── EventBus.test.ts         (8 tests)
│   ├── HookEngine.test.ts       (6 tests)
│   └── SnapshotManager.test.ts  (6 tests)
├── .claude/
│   └── orchestrator/
│       ├── agents/              Agents custom (JSON)
│       ├── workflows/           Workflows custom (JSON)
│       └── hooks.json           Hooks evenementiels
├── CLAUDE.md                    Instructions projet
├── README.md                    Documentation utilisateur
├── MANUAL.md                    Manuel d'utilisation
└── ARCHITECTURE.md              Ce document
```

---

## 3. Architecture des modules

### 3.1 Patterns utilises

| Pattern | Ou | Pourquoi |
|---------|-----|----------|
| **Singleton** | Orchestrator, EventBus, AgentRegistry | Un seul etat global par session MCP |
| **Event-driven** | EventBus → tous les modules | Decouplage total entre modules |
| **Strategy** | DispatchMode (manual/cli/terminal) | Comportement interchangeable a chaud |
| **Pipeline** | ContextPipeline | Construction incrementale du contexte agent |
| **Observer** | HookEngine ecoute EventBus | Reactions automatiques aux evenements |
| **Repository** | AgentRegistry, StateManager | Acces uniforme aux donnees |
| **Template Method** | Workflow templates dans Orchestrator | Schemas de phases predefinies |
| **Facade** | Orchestrator | Interface simplifiee vers tous les sous-systemes |

### 3.2 Dependances entre modules

```
                        Orchestrator
                       /  |  |  |  \  \
                      /   |  |  |   \   \
                     ▼    ▼  ▼  ▼    ▼    ▼
            AgentReg. Dispatcher State Scoring Snapshot Memory
              │         │  │      │               │
              │         ▼  │      │               │
              │    Terminal │      │               │
              │    Dispatch │      │               │
              │         │  │      │               │
              ├────────►│  │      │               │
              │    Context  │      │               │
              │    Pipeline │      │               │
              │         │  │      │               │
              │         ▼  ▼      ▼               ▼
              └────────►EventBus◄──────────────────┘
                           │
                           ▼
                       HookEngine
                           │
                           ▼
                     ConfigLoader
```

**Regle fondamentale** : Aucune dependance circulaire. Tous les modules communiquent via l'EventBus ou par injection de dependances dans le constructeur.

### 3.3 Initialisation

```typescript
// Ordre d'initialisation (dans Orchestrator.initialize())
1. ConfigLoader.detect()         // Detecte le projet
2. EventBus (deja instancie)     // Pret a recevoir
3. AgentRegistry.initialize()    // Charge 8 built-in + custom
4. StateManager.initialize()     // Charge l'etat precedent
5. MemoryManager (pret)          // Charge les memoires
6. SnapshotManager.initialize()  // Verifie Git
7. HookEngine.initialize()       // Charge hooks.json
8. ScoringEngine (pret)          // Stateless
9. AgentDispatcher (pret)        // Connecte au registry
10. Chargement workflows custom  // .claude/orchestrator/workflows/
```

---

## 4. Systeme de types

Tous les types sont centralises dans `src/types/core.ts` (225 lignes).

### 4.1 Identifiants

```typescript
type SessionId   = string;  // Session MCP unique
type WorkflowId  = string;  // wf_<uuid>
type PhaseId     = string;  // phase_<index>
type TaskId      = string;  // Tache utilisateur
type AgentId     = string;  // ex: "security-expert"
type SnapshotId  = string;  // snap_<timestamp>
```

### 4.2 Enumerations

```typescript
// Types de workflow
type WorkflowType = 'BUILD' | 'REVIEW' | 'OPTIMIZE' | 'DESIGN'
                  | 'DEBUG' | 'SECURITY_AUDIT' | 'CUSTOM';

// Etats de workflow
type WorkflowStatus = 'PENDING' | 'RUNNING' | 'PAUSED'
                    | 'COMPLETE' | 'FAILED' | 'CANCELLED';

// Etats de phase
type PhaseStatus = 'PENDING' | 'RUNNING' | 'PASS'
                 | 'ITERATE' | 'FAIL' | 'SKIPPED';

// Modes de dispatch
type DispatchMode = 'manual' | 'cli' | 'terminal';
```

### 4.3 Structures principales

```
Workflow
├── id: WorkflowId
├── type: WorkflowType
├── task: string                    ← Description de la tache
├── status: WorkflowStatus
├── phases: WorkflowPhase[]
│   ├── id: PhaseId
│   ├── name: string
│   ├── description: string
│   ├── agents: AgentId[]           ← Agents assignes
│   ├── status: PhaseStatus
│   ├── iteration: number           ← Iteration courante
│   ├── maxIterations: number       ← Max avant FAIL (defaut: 3)
│   ├── score: number | null
│   └── output: PhaseOutput | null
│       ├── agentOutputs: Record<AgentId, AgentOutput>
│       │   ├── agentId: AgentId
│       │   ├── status: 'SUCCESS' | 'PARTIAL' | 'FAILED'
│       │   ├── output: string
│       │   ├── filesCreated: string[]
│       │   ├── filesModified: string[]
│       │   ├── duration: number
│       │   └── score: number | null
│       ├── filesModified: string[]
│       ├── errors: string[]
│       └── warnings: string[]
├── currentPhaseIndex: number
├── totalScore: number | null
├── snapshotId: SnapshotId | null
└── context: WorkflowContext
    ├── projectInfo: ProjectInfo
    │   ├── name: string
    │   ├── language: string
    │   ├── framework: string | null
    │   ├── rootPath: string
    │   ├── packageManager: string | null
    │   ├── linter: string | null
    │   ├── testRunner: string | null
    │   └── hasTypeScript: boolean
    └── previousWorkflows: WorkflowSummary[]
```

### 4.4 Definition d'un agent

```typescript
interface AgentDefinition {
    id: AgentId;
    name: string;
    description: string;
    systemPrompt: string;       // Personnalite et expertise
    capabilities: string[];     // Competences declarees
    model: string | null;       // Modele LLM specifique (optionnel)
}
```

### 4.5 Scoring

```typescript
interface ScoreBreakdown {
    correctness: number;     // 0-100 (poids: 25%)
    completeness: number;    // 0-100 (poids: 20%)
    security: number;        // 0-100 (poids: 20%)
    bestPractices: number;   // 0-100 (poids: 15%)
    tests: number;           // 0-100 (poids: 15%)
    documentation: number;   // 0-100 (poids: 5%)
}

interface ScoreResult {
    total: number;           // 0-100 + bonuses - penalties
    breakdown: ScoreBreakdown;
    decision: 'PASS' | 'ITERATE' | 'FAIL';
    blockers: Blocker[];     // Blockers = score 0
    feedback: string[];      // Suggestions d'amelioration
    bonuses: ScoreModifier[];
    penalties: ScoreModifier[];
}
```

---

## 5. Cycle de vie d'un workflow

### 5.1 Etats et transitions

```
                    start()
    ┌─────────────────────────────────────┐
    │                                     ▼
    │                              ┌──────────┐
    │                              │ RUNNING   │◄──────────┐
    │                              └─────┬─────┘           │
    │                                    │                 │
    │              ┌─────────────────────┼─────────────┐   │
    │              │                     │             │   │
    │              ▼                     ▼             ▼   │
    │        ┌──────────┐         ┌──────────┐  ┌──────────┐
    │        │ PAUSED   │         │ COMPLETE │  │ FAILED   │
    │        └─────┬────┘         └──────────┘  └──────────┘
    │              │ resume()
    │              └──────────────────────────────────┘
    │
    │  cancel() (depuis n'importe quel etat actif)
    │              ┌──────────┐
    └─────────────►│CANCELLED │
                   └──────────┘
```

### 5.2 Progression d'une phase

```
Phase PENDING
    │
    ▼ (workflow avance a cette phase)
Phase RUNNING (iteration 1)
    │
    ├─ dispatch() → agents executent
    ├─ validate(output) → ScoringEngine
    │
    ├─ score >= 90 ──────────► Phase PASS → phase suivante
    │
    ├─ 60 <= score < 90
    │   └─ iteration < maxIterations
    │       └─► Phase ITERATE → retour a RUNNING (iteration++)
    │           (feedback injecte dans le contexte)
    │
    ├─ 60 <= score < 90
    │   └─ iteration >= maxIterations
    │       └─► Phase FAIL → workflow FAILED
    │
    └─ score < 60 ──────────► Phase FAIL → workflow FAILED
                              (+ rollback Git automatique)
```

### 5.3 Sequence complete d'un workflow BUILD

```
Temps ──────────────────────────────────────────────────────►

1. startWorkflow('BUILD', 'Create login page')
   ├─ ConfigLoader.detect()
   ├─ SnapshotManager.create() → snap_pre_workflow
   ├─ Cree 6 phases : Design → Code → Tests → Regression → Security → Review
   └─ Phase 1 (Design) → RUNNING

2. dispatchPhase()
   ├─ ContextPipeline.buildContext(fullstack-ui-architect)
   ├─ Agent execute (manual/cli/terminal)
   └─ Retourne output

3. validatePhase(output)
   ├─ ScoringEngine.score(output)
   ├─ Score = 92 → PASS
   └─ Phase 2 (Code) → RUNNING

4. dispatchPhase() → Code
   ├─ Contexte inclut output de Design (phase precedente)
   └─ Agent execute

5. validatePhase(output)
   ├─ Score = 75 → ITERATE (iteration 1/3)
   ├─ Feedback : ["Missing error handling", "No input validation"]
   └─ Phase 2 reste RUNNING (iteration 2)

6. dispatchPhase() → Code (iteration 2)
   ├─ Contexte inclut feedback d'iteration
   └─ Agent corrige

7. validatePhase(output)
   ├─ Score = 91 → PASS
   └─ Phase 3 (Tests) → RUNNING

8. ... (Tests, Regression, Security, Review)

9. Derniere phase PASS
   ├─ Workflow → COMPLETE
   ├─ totalScore = moyenne des phases
   └─ StateManager.saveHistory()
```

---

## 6. Workflows built-in

### 6.1 BUILD (6 phases)

Construction complete d'une fonctionnalite.

```
┌──────────┐   ┌──────────┐   ┌──────────┐   ┌────────────┐   ┌──────────┐   ┌──────────┐
│  Design  │──►│   Code   │──►│  Tests   │──►│ Regression │──►│ Security │──►│  Review  │
│          │   │          │   │          │   │            │   │          │   │          │
│ fullstack│   │ fullstack│   │  test-   │   │   test-    │   │ security │   │  senior  │
│   -ui-   │   │   -ui-   │   │automation│   │ automation │   │  expert  │   │  code-   │
│ architect│   │ architect│   │strategist│   │ strategist │   │          │   │ reviewer │
└──────────┘   └──────────┘   └──────────┘   └────────────┘   └──────────┘   └──────────┘
```

### 6.2 REVIEW (3 phases)

Revue de code existant.

```
┌──────────┐   ┌───────────────┐   ┌──────────┐
│ Analysis │──►│ Security Check│──►│  Report  │
│          │   │               │   │          │
│  senior  │   │   security    │   │technical │
│  code-   │   │    expert     │   │  writer  │
│ reviewer │   │               │   │          │
└──────────┘   └───────────────┘   └──────────┘
```

### 6.3 OPTIMIZE (3 phases)

Optimisation de performances.

```
┌──────────┐   ┌──────────────┐   ┌────────────┐
│Profiling │──►│ Optimization │──►│ Regression │
│          │   │              │   │            │
│ database │   │ distributed  │   │   test-    │
│  optim.  │   │  systems     │   │ automation │
│  expert  │   │  architect   │   │ strategist │
└──────────┘   └──────────────┘   └────────────┘
```

### 6.4 DESIGN (3 phases)

Conception architecturale.

```
┌─────────────┐   ┌──────────────┐   ┌───────────────┐
│Requirements │──►│ Architecture │──►│ Documentation │
│             │   │              │   │               │
│     ux-     │   │ distributed  │   │  technical    │
│   design    │   │   systems    │   │    writer     │
│ strategist  │   │  architect   │   │               │
└─────────────┘   └──────────────┘   └───────────────┘
```

### 6.5 DEBUG (3 phases)

Investigation et correction de bug.

```
┌───────────────┐   ┌──────────┐   ┌────────────┐
│ Investigation │──►│   Fix    │──►│ Regression │
│               │   │          │   │            │
│    senior     │   │ fullstack│   │   test-    │
│    code-      │   │   -ui-   │   │ automation │
│   reviewer    │   │ architect│   │ strategist │
└───────────────┘   └──────────┘   └────────────┘
```

### 6.6 SECURITY_AUDIT (5 phases)

Audit de securite complet.

```
┌────────┐   ┌──────────┐   ┌─────────────┐   ┌────────────┐   ┌────────┐
│  Scan  │──►│ Analysis │──►│ Remediation │──►│ Regression │──►│ Report │
│        │   │          │   │             │   │            │   │        │
│security│   │ security │   │security +   │   │   test-    │   │technic.│
│ expert │   │  expert  │   │fullstack-ui │   │ automation │   │ writer │
└────────┘   └──────────┘   └─────────────┘   └────────────┘   └────────┘
```

### 6.7 CUSTOM

Charge depuis `.claude/orchestrator/workflows/*.json`. Permet de definir des phases et agents arbitraires.

### 6.8 Phase de non-regression

Les workflows qui modifient du code (BUILD, OPTIMIZE, DEBUG, SECURITY_AUDIT) incluent automatiquement une phase **Regression**. L'agent `test-automation-strategist` :

1. Lance la suite de tests complete du projet
2. Identifie les tests casses par les modifications
3. Rapporte le nom, fichier et message d'erreur de chaque echec
4. Propose des corrections

Si le score est < 90, le systeme re-itere (max 3 fois) pour corriger les regressions.

---

## 7. Systeme d'agents

### 7.1 Les 8 agents built-in

```
┌─────────────────────────────────────────────────────────────────────┐
│                         AgentRegistry                               │
│                                                                     │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  │
│  │fullstack-ui-     │  │test-automation-  │  │security-expert   │  │
│  │architect         │  │strategist        │  │                  │  │
│  │                  │  │                  │  │Securite OWASP,   │  │
│  │Architecture      │  │Strategies test,  │  │audit, remedia-   │  │
│  │frontend/backend, │  │QA, non-regression│  │tion, compliance  │  │
│  │composants UI     │  │                  │  │                  │  │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘  │
│                                                                     │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  │
│  │senior-code-      │  │database-optimi-  │  │distributed-      │  │
│  │reviewer          │  │zation-expert     │  │systems-architect │  │
│  │                  │  │                  │  │                  │  │
│  │Revue qualite,    │  │Schema, requetes, │  │Microservices,    │  │
│  │maintenabilite,   │  │indexing, perf BDD│  │scalabilite,      │  │
│  │bonnes pratiques  │  │                  │  │haute dispo       │  │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘  │
│                                                                     │
│  ┌──────────────────┐  ┌──────────────────┐                        │
│  │technical-writer  │  │ux-design-        │  + Agents custom       │
│  │                  │  │strategist        │  (.claude/orchestrator/ │
│  │Docs API, ADRs,   │  │                  │   agents/*.json)       │
│  │guides, README    │  │UX, accessibilite,│                        │
│  │                  │  │design systems    │                        │
│  └──────────────────┘  └──────────────────┘                        │
└─────────────────────────────────────────────────────────────────────┘
```

### 7.2 Anatomie d'un agent

Chaque agent est defini par :

```typescript
{
    id: "security-expert",
    name: "Security Expert",
    description: "Specialiste en securite applicative...",
    systemPrompt: "You are a senior application security expert...",
    capabilities: ["security-audit", "owasp", "vulnerability-assessment", ...],
    model: null  // Utilise le modele par defaut
}
```

Le `systemPrompt` est le coeur de l'agent : il definit sa personnalite, son expertise, son style de reponse et ses contraintes.

### 7.3 Agents custom

Les agents custom sont charges depuis `.claude/orchestrator/agents/*.json` a l'initialisation. Validation JSON :
- `id` : string non vide, requis
- `name` : string non vide, requis
- `systemPrompt` : string non vide, requis
- `description`, `capabilities`, `model` : optionnels

Les fichiers invalides sont ignores avec un warning en console.

---

## 8. Communication inter-agents

### 8.1 Schema de communication

Les agents ne communiquent **jamais directement** entre eux. Toute communication passe par l'orchestrateur via deux mecanismes :

```
┌─────────┐                                          ┌─────────┐
│ Agent A │                                          │ Agent B │
│(phase 1)│                                          │(phase 2)│
└────┬────┘                                          └────▲────┘
     │ output                                             │ context
     ▼                                                    │
┌─────────────────────────────────────────────────────────────────┐
│                        Orchestrator                             │
│                                                                 │
│  1. Agent A produit un output                                   │
│  2. L'output est stocke dans phase.output.agentOutputs          │
│  3. ContextPipeline construit le contexte de Agent B            │
│  4. Le contexte inclut les outputs de la phase precedente       │
│  5. Agent B recoit tout le contexte necessaire                  │
└─────────────────────────────────────────────────────────────────┘
```

### 8.2 Communication entre phases (sequentielle)

Quand une phase se termine, ses outputs sont transmis aux agents de la phase suivante via `previousPhases` dans le contexte :

```
Phase 1 (Design)                    Phase 2 (Code)
┌─────────────────┐                ┌──────────────────────────────┐
│ fullstack-ui    │                │ fullstack-ui                 │
│                 │    output      │                              │
│ "Architecture:  │───────────────►│ Contexte recoit:             │
│  - Composants   │   stocke dans  │   previousPhases: [{         │
│  - API routes   │   PhaseOutput  │     phaseName: "Design",     │
│  - DB schema"   │                │     score: 92,               │
│                 │                │     agentOutputs: {           │
└─────────────────┘                │       "fullstack-ui": "..."  │
                                   │     }                        │
                                   │   }]                         │
                                   └──────────────────────────────┘
```

### 8.3 Communication intra-phase (peer outputs)

Quand plusieurs agents travaillent dans la meme phase (ex: Remediation dans SECURITY_AUDIT), les agents recoivent les outputs de leurs pairs via `peerOutputs` :

```
Phase: Remediation
┌─────────────────┐                ┌──────────────────────────────┐
│ security-expert │                │ fullstack-ui-architect       │
│ (execute en 1er)│    output      │ (execute en 2eme)            │
│                 │───────────────►│                              │
│ "Vulns trouvees:│   peerOutputs  │ Contexte recoit:             │
│  - XSS input    │                │   peerOutputs: {             │
│  - SQL injection│                │     "security-expert": "..." │
│  ..."           │                │   }                          │
└─────────────────┘                └──────────────────────────────┘
```

### 8.4 Communication par iteration (feedback)

Quand une phase ITERATE, le feedback du scoring est reinjecte dans le contexte de l'iteration suivante :

```
Iteration 1                        Iteration 2
┌─────────────────┐                ┌──────────────────────────────┐
│ Agent produit   │   scoring      │ Agent recoit :               │
│ un output       │──────────────► │                              │
│                 │   score: 75    │ phase.feedback: [             │
│                 │   feedback:    │   "Missing error handling",   │
│                 │   [...]        │   "No input validation"       │
│                 │   → ITERATE    │ ]                             │
│                 │                │ phase.iteration: 2            │
│                 │                │ phase.maxIterations: 3        │
└─────────────────┘                └──────────────────────────────┘
```

### 8.5 Communication par memoire (persistante)

Les memoires sont des fichiers partages, accessibles a tous les agents via le contexte :

```
Agent A ecrit                      Agent B lit
┌─────────────────┐                ┌──────────────────────────────┐
│ orchestrator_   │                │ Contexte recoit :             │
│ memory {        │   fichier      │                              │
│   action:"write"│──────────────► │ memories: {                  │
│   name:"arch",  │ .claude/       │   "architecture": "...",     │
│   content:"..." │ memories/      │   "conventions": "..."       │
│ }               │ arch.md        │ }                            │
└─────────────────┘                └──────────────────────────────┘
```

---

## 9. Modes de dispatch

### 9.1 Mode Manual (defaut)

L'orchestrateur prepare les prompts mais **ne les execute pas**. Claude Code recoit les prompts et s'auto-execute comme chaque agent.

```
Claude Code                     Orchestrator                    Claude Code
(utilisateur)                   (MCP)                           (comme agent)
     │                               │                               │
     │  dispatch()                   │                               │
     ├──────────────────────────────►│                               │
     │                               │  buildContext()               │
     │                               │  buildUserPrompt()            │
     │                               │                               │
     │  {prompts: [{                 │                               │
     │    systemPrompt: "...",       │                               │
     │    userPrompt: "..."          │                               │
     │  }]}                          │                               │
     │◄──────────────────────────────┤                               │
     │                               │                               │
     │  Claude adopte le role ───────┼──────────────────────────────►│
     │  et execute comme l'agent     │                               │
     │                               │                               │
     │  validate(output)             │                               │
     ├──────────────────────────────►│                               │
     │                               │  score()                     │
     │  {score: 92, decision: PASS}  │                               │
     │◄──────────────────────────────┤                               │
```

### 9.2 Mode CLI (automatise)

L'orchestrateur execute `claude --print` en subprocess pour chaque agent. Execution sequentielle avec retry (3 tentatives, backoff exponentiel).

```
Orchestrator                     Subprocess 1              Subprocess 2
     │                               │                          │
     │  execFile("claude",           │                          │
     │    ["--print",                │                          │
     │     "--system-prompt", sp,    │                          │
     │     userPrompt])              │                          │
     ├──────────────────────────────►│                          │
     │                               │ (agent travaille)        │
     │        stdout (output)        │                          │
     │◄──────────────────────────────┤                          │
     │                               │                          │
     │  (agent suivant)              │                          │
     ├─────────────────────────────────────────────────────────►│
     │                               │                          │
     │        stdout (output)        │                          │
     │◄─────────────────────────────────────────────────────────┤
     │                               │                          │
     │  score() et validate()        │                          │
```

**Retry** : En cas d'echec, 3 tentatives avec delais de 1s, 2s, 4s. Les erreurs non-transitoires (`not found`, `invalid`) ne sont pas reessayees.

### 9.3 Mode Terminal (visuel)

Ouvre N panes Windows Terminal (ou N fenetres PowerShell en fallback) pour voir les agents travailler en temps reel. Execution parallele.

```
Orchestrator                     Windows Terminal
     │                          ┌────────────────────────────┐
     │  spawnSession()          │ ┌─────────┐ ┌───────────┐ │
     ├─────────────────────────►│ │ Agent A  │ │  Agent B  │ │
     │                          │ │(claude   │ │ (claude   │ │
     │  {session: ...}          │ │ --print) │ │  --print) │ │
     │◄─────────────────────────│ │          │ │           │ │
     │                          │ │[output   │ │ [output   │ │
     │  terminal_status()       │ │ en temps │ │  en temps │ │
     ├─────────────────────────►│ │ reel]    │ │  reel]    │ │
     │                          │ │          │ │           │ │
     │  {completed: ["A"],      │ │ TERMINE  │ │  ...      │ │
     │   running: ["B"]}        │ └─────────┘ └───────────┘ │
     │◄─────────────────────────│                            │
     │                          └────────────────────────────┘
     │  terminal_collect()
     │  (quand tous done)
     │  → outputs injectes dans PhaseOutput
```

**Layout des panes** :

```
1 agent:  [ A ]

2 agents: [ A | B ]

3 agents: [ A | B ]
          [   | C ]

4 agents: [ A | B ]
          [ C | D ]

5+ agents: grille adaptative (rangees de 2-3)
```

**Fichiers generes par session** :
```
terminal_session_<timestamp>/
├── system_<agentId>.txt     # System prompt
├── user_<agentId>.txt       # User prompt
├── agent_<agentId>.ps1      # Script PowerShell wrapper
├── output_<agentId>.txt     # Output (ecrit par le script)
└── done_<agentId>.txt       # Marker de fin (SUCCESS/FAILED:duration)
```

---

## 10. ContextPipeline

Le `ContextPipeline` est le module central qui construit le contexte complet transmis a chaque agent. Il assemble toutes les informations necessaires.

### 10.1 Structure du contexte

```typescript
interface AgentContext {
    agent: AgentDefinition;           // Qui suis-je ?
    task: string;                     // Quelle est la tache ?
    phase: {
        id: PhaseId;
        name: string;
        description: string;
        iteration: number;            // Iteration courante
        maxIterations: number;        // Max iterations
        feedback: string[];           // Feedback des iterations precedentes
    };
    previousPhases: PreviousPhaseInfo[];  // Outputs des phases terminees
    peerOutputs: Record<AgentId, string>; // Outputs des pairs (meme phase)
    memories: Record<string, string>;     // Memoires persistantes
    projectInfo: ProjectInfo;             // Info du projet detecte
}
```

### 10.2 Construction du prompt utilisateur

Le pipeline assemble un prompt structure en sections :

```markdown
## Task
[Description de la tache]

## Current Phase: [nom]
[Description de la phase]

**Iteration 2/3**

## Feedback from Previous Iteration
- Missing error handling
- No input validation

## Previous Phases Output

### Design (PASS, score: 92)

**Agent fullstack-ui-architect:**
[Output tronque a 2000 caracteres]

## Other Agents Output (same phase)

### Agent security-expert:
[Output tronque a 3000 caracteres]

## Project Memories

### architecture
[Contenu de la memoire]

## Project Info
- Name: my-project
- Language: TypeScript
- Framework: React
- Root: /path/to/project
```

### 10.3 Pipeline de construction

```
buildContext(agentId, workflow, phase, feedback, peerOutputs)
    │
    ├─ registry.getRequired(agentId)      → AgentDefinition
    ├─ buildPreviousPhases(workflow)       → PreviousPhaseInfo[]
    │   └─ Parcourt les phases avant la phase courante
    │      et extrait les outputs de chaque agent
    ├─ loadMemories()                     → Record<string, string>
    │   └─ MemoryManager.listNames()
    │      puis MemoryManager.read() pour chaque memoire
    └─ Assemble le AgentContext
         │
         ▼
buildUserPrompt(context)
    │
    ├─ Section Task
    ├─ Section Phase (+ iteration si > 1)
    ├─ Section Feedback (si iteration precedente)
    ├─ Section Previous Phases (outputs tronques a 2000 chars)
    ├─ Section Peer Outputs (outputs tronques a 3000 chars)
    ├─ Section Memories
    └─ Section Project Info
```

---

## 11. EventBus - Communication interne

### 11.1 Architecture

L'EventBus est un systeme pub/sub type qui decouple les modules. Chaque module emet et/ou ecoute des evenements sans connaitre les autres modules.

```
                    ┌──────────────┐
         emit()     │              │    on()
    ─────────────► │   EventBus    │ ◄──────────────
                    │              │
                    │  23 events   │
                    │  typed       │
                    │              │
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
         HookEngine   StateManager   Orchestrator
         (reactions)  (persistence)  (progression)
```

### 11.2 Catalogue des evenements (23)

#### Evenements Workflow (7)

| Evenement | Payload | Emetteur |
|-----------|---------|----------|
| `workflow:started` | `{ workflowId, type, task }` | Orchestrator |
| `workflow:paused` | `{ workflowId }` | Orchestrator |
| `workflow:resumed` | `{ workflowId }` | Orchestrator |
| `workflow:cancelled` | `{ workflowId }` | Orchestrator |
| `workflow:completed` | `{ workflowId, totalScore }` | Orchestrator |
| `workflow:failed` | `{ workflowId, reason }` | Orchestrator |
| `workflow:statusChanged` | `{ workflowId, from, to }` | Orchestrator |

#### Evenements Phase (5)

| Evenement | Payload | Emetteur |
|-----------|---------|----------|
| `phase:started` | `{ workflowId, phaseId, name, iteration }` | Orchestrator |
| `phase:completed` | `{ workflowId, phaseId, status, score }` | Orchestrator |
| `phase:iterating` | `{ workflowId, phaseId, iteration, maxIterations, feedback }` | Orchestrator |
| `phase:failed` | `{ workflowId, phaseId, reason }` | Orchestrator |
| `phase:skipped` | `{ workflowId, phaseId, reason }` | Orchestrator |

#### Evenements Score (1)

| Evenement | Payload | Emetteur |
|-----------|---------|----------|
| `score:calculated` | `{ workflowId, phaseId, result: ScoreResult }` | Orchestrator |

#### Evenements Snapshot (2)

| Evenement | Payload | Emetteur |
|-----------|---------|----------|
| `snapshot:created` | `{ snapshotId, workflowId, phaseId }` | SnapshotManager |
| `snapshot:restored` | `{ snapshotId }` | SnapshotManager |

#### Evenements Memory (2)

| Evenement | Payload | Emetteur |
|-----------|---------|----------|
| `memory:written` | `{ name }` | MemoryManager |
| `memory:deleted` | `{ name }` | MemoryManager |

#### Evenements Hook (2)

| Evenement | Payload | Emetteur |
|-----------|---------|----------|
| `hook:triggered` | `{ hookName, event }` | HookEngine |
| `hook:error` | `{ hookName, error }` | HookEngine |

#### Evenements Agent (6)

| Evenement | Payload | Emetteur |
|-----------|---------|----------|
| `agent:phaseDispatchStarted` | `{ workflowId, phaseId, agents, mode }` | AgentDispatcher |
| `agent:dispatched` | `{ workflowId, phaseId, agentId, result }` | AgentDispatcher |
| `agent:phaseDispatchCompleted` | `{ workflowId, phaseId, agentCount, mode }` | AgentDispatcher |
| `agent:terminalSpawned` | `{ workflowId, phaseId, agents, sessionDir }` | AgentDispatcher |
| `agent:terminalAgentDone` | `{ workflowId, phaseId, agentId, duration, status }` | Orchestrator |
| `agent:terminalAllDone` | `{ workflowId, phaseId, agentCount }` | Orchestrator |

### 11.3 Listeners

```
EventBus
    │
    ├─► HookEngine
    │   Ecoute : TOUS les evenements
    │   Action : Execute les hooks shell dont l'event correspond
    │
    ├─► StateManager
    │   Ecoute : workflow:*, phase:*
    │   Action : Persiste l'etat, l'historique et les stats
    │
    └─► Orchestrator (interne)
        Ecoute : phase:completed, phase:failed
        Action : Avance le workflow a la phase suivante
```

---

## 12. Scoring Engine

### 12.1 Les 6 axes

```
                    Score Total (0-100)
                         │
         ┌───────────────┼───────────────┐
         │               │               │
    ┌────┴────┐    ┌─────┴─────┐   ┌─────┴─────┐
    │Correct. │    │Complete.  │   │ Security  │
    │  25%    │    │   20%     │   │   20%     │
    └─────────┘    └───────────┘   └───────────┘
         │               │               │
    ┌────┴────┐    ┌─────┴─────┐   ┌─────┴─────┐
    │Best     │    │  Tests    │   │  Docs     │
    │Pract.15%│    │   15%     │   │    5%     │
    └─────────┘    └───────────┘   └───────────┘
```

| Axe | Poids | Source d'evaluation |
|-----|-------|---------------------|
| **Correctness** | 25% | Compilation (`tsc --noEmit`), syntaxe valide |
| **Completeness** | 20% | Couverture des requirements de la tache |
| **Security** | 20% | Patterns OWASP, vulnerabilites connues |
| **Best Practices** | 15% | ESLint, conventions, patterns standard |
| **Tests** | 15% | Couverture, taux de passage, qualite |
| **Documentation** | 5% | README, JSDoc, commentaires pertinents |

### 12.2 Decisions

```
Score >= 90  →  PASS      Phase terminee, passage a la suivante
60 <= Score < 90  →  ITERATE   Re-essai avec feedback (max 3 iterations)
Score < 60   →  FAIL      Phase echouee, workflow failed + rollback
```

### 12.3 Blockers

Les blockers forcent un score de 0 sur l'axe concerne :

| Blocker | Description | Axe affecte |
|---------|-------------|-------------|
| `NO_OUTPUT` | Agent n'a rien produit | Tous |
| `SYNTAX_ERROR` | Erreur de syntaxe dans le code | Correctness |
| `CRITICAL_SECURITY` | Faille critique (injection, XSS) | Security |
| `BUILD_FAILED` | La compilation echoue | Correctness |
| `TESTS_CRASHED` | Les tests ne s'executent pas | Tests |
| `MISSING_REQUIRED` | Elements requis manquants | Completeness |

### 12.4 Bonuses et penalties

**Bonuses** (ajoutees au score total) :

| Condition | Bonus |
|-----------|-------|
| Tests >= 90 | +5 |
| Best Practices >= 95 | +3 |
| Documentation >= 90 | +2 |
| Security = 100 | +2 |

**Penalties** (retirees du score total) :

| Condition | Penalty |
|-----------|---------|
| Tests < 30 | -10 |
| Tests < 50 | -5 |
| Best Practices < 50 | -5 |
| Security < 60 | -10 |

Score final = `clamp(0, 100, weighted_sum + bonuses - penalties)`

---

## 13. Persistance et etat

### 13.1 StateManager

Le `StateManager` gere 3 fichiers de persistance dans `.claude/orchestrator/` :

```
.claude/orchestrator/
├── state.json        # Etat courant
├── history.json      # Historique des workflows
└── stats.json        # Statistiques agregees
```

### 13.2 state.json

```json
{
    "sessionId": "session_abc123",
    "currentWorkflow": { ... },
    "lastUpdated": "2025-01-15T10:30:00.000Z"
}
```

Sauvegarde automatique a chaque changement d'etat via EventBus.

### 13.3 history.json

```json
{
    "workflows": [
        {
            "id": "wf_xxx",
            "type": "BUILD",
            "task": "Create login page",
            "status": "COMPLETE",
            "totalScore": 92,
            "phases": 6,
            "duration": 180000,
            "completedAt": "2025-01-15T10:33:00.000Z"
        }
    ]
}
```

Plafonne a 50 entrees (FIFO).

### 13.4 stats.json

```json
{
    "totalWorkflows": 15,
    "completedWorkflows": 12,
    "failedWorkflows": 2,
    "cancelledWorkflows": 1,
    "averageScore": 87.5,
    "totalPhases": 72,
    "totalIterations": 89,
    "byType": {
        "BUILD": { "count": 8, "avgScore": 89 },
        "REVIEW": { "count": 4, "avgScore": 85 }
    }
}
```

---

## 14. Snapshots et rollback

### 14.1 Fonctionnement

Le `SnapshotManager` cree des snapshots Git avant chaque phase qui modifie du code. Cela permet de revenir en arriere si une phase echoue.

```
                     Workflow BUILD
                          │
    ┌─────────────────────┼─────────────────────────┐
    │                     │                         │
    ▼                     ▼                         ▼
snap_pre_design     snap_pre_code            snap_pre_tests
(git stash +        (git stash +             (git stash +
 commit hash)        commit hash)             commit hash)
```

### 14.2 Mecanisme

1. **Avant chaque phase** : `SnapshotManager.create(workflowId, phaseId)`
   - Sauvegarde le hash du commit courant
   - Cree un git stash si des modifications non commitees existent
   - Stocke les metadonnees dans `snapshots.json`

2. **En cas de FAIL** : `SnapshotManager.restore(snapshotId)`
   - Revient au commit sauvegarde
   - Restaure le stash si existant

3. **Actions disponibles via MCP** :
   - `create` : Cree un snapshot manuellement
   - `restore` : Restaure un snapshot
   - `list` : Liste tous les snapshots

### 14.3 Stockage

```
.claude/orchestrator/snapshots/
└── snapshots.json
    {
        "snapshots": [
            {
                "id": "snap_1705312200000",
                "workflowId": "wf_xxx",
                "phaseId": "phase_2",
                "commitHash": "abc1234",
                "stashRef": "stash@{0}",
                "createdAt": "2025-01-15T10:30:00.000Z"
            }
        ]
    }
```

---

## 15. Memoires partagees

### 15.1 Concept

Les memoires sont des fichiers texte persistants partages entre tous les agents et sessions. Elles servent de contexte long-terme.

```
.claude/memories/
├── architecture.md      # Decisions architecturales
├── conventions.md       # Conventions de code
├── api-spec.md          # Specification API
└── lessons-learned.md   # Retours d'experience
```

### 15.2 Cycle de vie

```
Agent/Utilisateur                    MemoryManager
       │                                  │
       │  write("architecture", content)  │
       ├─────────────────────────────────►│
       │                                  │  Ecrit .claude/memories/architecture.md
       │                                  │  Emit memory:written
       │                                  │
       │  (plus tard, autre agent)        │
       │  buildContext()                  │
       │  ──► loadMemories()             │
       │      ├─ listNames()             │
       │      └─ read("architecture")────►│  Lit le fichier
       │         ◄────────────────────────┤  Retourne le contenu
       │                                  │
       │  Le contenu est injecte dans     │
       │  le prompt de l'agent sous       │
       │  ## Project Memories             │
```

### 15.3 Securite

Le `MemoryManager` sanitize les noms de fichiers pour eviter les path traversal :
- Supprime `..`, `/`, `\`
- Limite aux caracteres alphanumeriques, `-`, `_`, `.`

---

## 16. Hooks evenementiels

### 16.1 Concept

Les hooks permettent d'executer des commandes shell automatiquement en reaction aux evenements du systeme.

### 16.2 Configuration

```json
// .claude/orchestrator/hooks.json
{
    "hooks": [
        {
            "name": "notify-completion",
            "event": "workflow:completed",
            "command": "echo 'Workflow done!' >> build.log",
            "enabled": true,
            "timeout": 30000
        },
        {
            "name": "run-lint-after-code",
            "event": "phase:completed",
            "command": "npm run lint",
            "condition": { "phaseName": "Code" },
            "timeout": 60000
        }
    ]
}
```

### 16.3 Flux

```
Evenement emis sur EventBus
         │
         ▼
    HookEngine.onEvent()
         │
         ├─ Filtre les hooks dont l'event correspond
         ├─ Verifie les conditions (si presentes)
         ├─ Execute chaque hook matching via child_process
         │
         ├─► Succes : emit hook:triggered
         └─► Erreur : emit hook:error
```

### 16.4 Evenements disponibles

Tous les 23 evenements de l'EventBus peuvent declencher un hook. Les plus utiles :

- `workflow:completed` : Notification, deploy, rapport
- `workflow:failed` : Alerte, rollback custom
- `phase:completed` : Tests intermediaires, lint
- `score:calculated` : Logging des scores
- `agent:terminalAllDone` : Notification que tous les agents ont fini

---

## 17. Detection de projet

### 17.1 ConfigLoader

Le `ConfigLoader` analyse automatiquement le repertoire du projet pour detecter :

```
ConfigLoader.detect(rootPath)
    │
    ├─ Langage
    │   ├─ package.json → TypeScript/JavaScript
    │   ├─ Cargo.toml → Rust
    │   ├─ go.mod → Go
    │   ├─ requirements.txt / pyproject.toml → Python
    │   └─ pom.xml / build.gradle → Java
    │
    ├─ Framework
    │   ├─ next.config.* → Next.js
    │   ├─ angular.json → Angular
    │   ├─ vue.config.* → Vue
    │   ├─ svelte.config.* → Svelte
    │   └─ package.json dependencies → React, Express, etc.
    │
    ├─ Package Manager
    │   ├─ bun.lockb → Bun
    │   ├─ pnpm-lock.yaml → pnpm
    │   ├─ yarn.lock → Yarn
    │   └─ package-lock.json → npm
    │
    ├─ Test Runner
    │   ├─ vitest.config.* → Vitest
    │   ├─ jest.config.* → Jest
    │   └─ package.json scripts → detection
    │
    ├─ Linter
    │   ├─ .eslintrc.* / eslint.config.* → ESLint
    │   └─ biome.json → Biome
    │
    └─ TypeScript
        └─ tsconfig.json → true/false
```

### 17.2 ProjectInfo resultant

```typescript
{
    name: "my-project",
    language: "TypeScript",
    framework: "React",
    rootPath: "/path/to/project",
    packageManager: "pnpm",
    linter: "eslint",
    testRunner: "vitest",
    hasTypeScript: true
}
```

Cette information est injectee dans le contexte de chaque agent (section `## Project Info`).

---

## 18. Protocole MCP

### 18.1 Transport

Le serveur utilise le transport **stdio** (stdin/stdout) du SDK MCP. Claude Code se connecte au serveur en lisant/ecrivant sur les flux standard.

```
Claude Code ←──── stdin ────► MCP Server (node dist/server.js)
            ←──── stdout ───►
```

### 18.2 Les 7 outils MCP

| Outil | Actions | Description |
|-------|---------|-------------|
| `orchestrator_workflow` | start, pause, resume, cancel, status, phases | Cycle de vie complet du workflow |
| `orchestrator_agents` | list, get, dispatch, auto_dispatch, register, set_mode, terminal_status, terminal_collect | Catalogue agents + dispatch |
| `orchestrator_validate` | (unique) | Valider une phase avec scoring |
| `orchestrator_score` | (unique) | Calculer un score standalone |
| `orchestrator_rollback` | restore, list, create | Gestion des snapshots Git |
| `orchestrator_memory` | list, read, write, delete | Memoires persistantes |
| `orchestrator_status` | (unique) | Statut systeme complet |

### 18.3 Architecture du serveur

```typescript
// server.ts
const server = new Server(
    { name: 'mcp-orchestrator', version: '1.0.0' },
    { capabilities: { tools: {} } }
);

// Enregistrement des 7 schemas d'outils
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        workflowTool,    // orchestrator_workflow
        agentsTool,      // orchestrator_agents
        validateTool,    // orchestrator_validate
        scoreTool,       // orchestrator_score
        rollbackTool,    // orchestrator_rollback
        memoryTool,      // orchestrator_memory
        statusTool,      // orchestrator_status
    ]
}));

// Handler unifie pour les 7 outils
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    switch (name) {
        case 'orchestrator_workflow': return handleWorkflow(args);
        case 'orchestrator_agents':   return handleAgents(args);
        // ...
    }
});

// Transport stdio
const transport = new StdioServerTransport();
await server.connect(transport);
```

---

## 19. Diagrammes de flux

### 19.1 Flux complet : workflow BUILD en mode manual

```
Utilisateur                Claude Code               MCP Server (Orchestrator)
    │                          │                              │
    │  "Build login page"      │                              │
    ├─────────────────────────►│                              │
    │                          │  workflow.start(BUILD, task)  │
    │                          ├─────────────────────────────►│
    │                          │                              │ ConfigLoader.detect()
    │                          │                              │ Snapshot.create()
    │                          │                              │ Cree 6 phases
    │                          │  {workflow, phases}          │ EventBus: workflow:started
    │                          │◄─────────────────────────────┤
    │                          │                              │
    │                          │  agents.dispatch()           │
    │                          ├─────────────────────────────►│
    │                          │                              │ ContextPipeline.build()
    │                          │  {prompts: [{                │
    │                          │    system: "You are...",     │
    │                          │    user: "## Task\n..."      │
    │                          │  }]}                         │
    │                          │◄─────────────────────────────┤
    │                          │                              │
    │                          │  (Claude s'auto-execute      │
    │                          │   comme l'agent)             │
    │                          │                              │
    │                          │  validate({output: "..."})   │
    │                          ├─────────────────────────────►│
    │                          │                              │ ScoringEngine.score()
    │                          │                              │ EventBus: score:calculated
    │                          │  {score: 92, PASS}           │ EventBus: phase:completed
    │                          │◄─────────────────────────────┤
    │                          │                              │ → Phase suivante RUNNING
    │                          │                              │
    │                          │  agents.dispatch() (phase 2) │
    │                          ├─────────────────────────────►│
    │                          │  ...                         │
    │                          │                              │
    │                          │  (repete pour chaque phase)  │
    │                          │                              │
    │                          │  workflow.status()           │
    │                          ├─────────────────────────────►│
    │                          │  {status: COMPLETE,          │
    │                          │   totalScore: 89}            │
    │                          │◄─────────────────────────────┤
    │  "Login page built!      │                              │
    │   Score: 89/100"         │                              │
    │◄─────────────────────────┤                              │
```

### 19.2 Flux d'iteration (score < 90)

```
Phase N (iteration 1)
    │
    ├─ dispatch() → Agent produit output
    ├─ validate(output) → ScoringEngine
    │
    │  Score = 75, Decision = ITERATE
    │  Feedback: ["Missing error handling", "No validation"]
    │
    ├─ EventBus: phase:iterating
    ├─ phase.iteration = 2
    │
Phase N (iteration 2)
    │
    ├─ dispatch() → Agent recoit feedback dans le contexte
    │   ContextPipeline inclut :
    │     phase.feedback = ["Missing error handling", ...]
    │     phase.iteration = 2
    │     phase.maxIterations = 3
    │
    ├─ validate(output) → ScoringEngine
    │
    │  Score = 91, Decision = PASS
    │
    └─ EventBus: phase:completed → Phase suivante
```

### 19.3 Flux de rollback (score < 60)

```
Phase N
    │
    ├─ dispatch() → Agent produit output
    ├─ validate(output) → ScoringEngine
    │
    │  Score = 45, Decision = FAIL
    │
    ├─ EventBus: phase:failed
    ├─ SnapshotManager.restore(snap_pre_phase_N)
    │   ├─ git checkout <commitHash>
    │   └─ git stash pop (si stash)
    ├─ EventBus: snapshot:restored
    ├─ Workflow → FAILED
    └─ EventBus: workflow:failed
```

### 19.4 Flux mode terminal

```
Utilisateur          Claude Code              Orchestrator           Windows Terminal
    │                    │                        │                       │
    │                    │  set_mode("terminal")  │                       │
    │                    ├───────────────────────►│                       │
    │                    │  OK                    │                       │
    │                    │◄──────────────────────┤                       │
    │                    │                        │                       │
    │                    │  agents.dispatch()     │                       │
    │                    ├───────────────────────►│                       │
    │                    │                        │  TerminalDispatcher   │
    │                    │                        │  .spawnSession()      │
    │                    │                        │──────────────────────►│
    │                    │                        │                       │ Ouvre N panes
    │  Voit les panes   │                        │                       │ Execute claude
    │  s'ouvrir ◄───────┼────────────────────────┼───────────────────────┤ dans chaque pane
    │                    │                        │                       │
    │                    │  {status: "spawned"}   │                       │
    │                    │◄──────────────────────┤                       │
    │                    │                        │                       │
    │  (attend que les   │                        │                       │
    │   agents finissent)│                        │                       │
    │                    │                        │                       │
    │                    │  terminal_status()     │                       │
    │                    ├───────────────────────►│                       │
    │                    │                        │  Verifie .done files  │
    │                    │  {completed: [A,B],    │◄──────────────────────┤
    │                    │   running: [C]}        │                       │
    │                    │◄──────────────────────┤                       │
    │                    │                        │                       │
    │                    │  (quand allDone)       │                       │
    │                    │  terminal_collect()    │                       │
    │                    ├───────────────────────►│                       │
    │                    │                        │  Lit output files     │
    │                    │  {outputs: {...}}      │◄──────────────────────┤
    │                    │◄──────────────────────┤                       │
    │                    │                        │                       │
    │                    │  validate(outputs)     │                       │
    │                    ├───────────────────────►│                       │
    │                    │  {score, decision}     │                       │
    │                    │◄──────────────────────┤                       │
```

---

## 20. Tests

### 20.1 Stack de test

- **Framework** : Vitest
- **Strategie** : Tests unitaires par module
- **Total** : 222 tests, 11 fichiers

### 20.2 Couverture par module

| Module | Fichier de test | Tests | Couverture |
|--------|----------------|-------|------------|
| Orchestrator | Orchestrator.test.ts | 25 | Lifecycle, phases, dispatch, memory, custom workflows, status |
| ScoringEngine | ScoringEngine.test.ts | 102 | 6 axes, blockers, bonuses, penalties, decisions, edge cases |
| AgentDispatcher | AgentDispatcher.test.ts | 12 | Manual/CLI modes, context pipeline, retry |
| AgentRegistry | AgentRegistry.test.ts | 10 | Built-in, custom, validation, search |
| TerminalDispatcher | TerminalDispatcher.test.ts | 10 | Layout, status, outputs, cleanup |
| StateManager | StateManager.test.ts | 18 | Persistence, serialization, history, stats |
| ConfigLoader | ConfigLoader.test.ts | 15 | Language, framework, tools detection |
| MemoryManager | MemoryManager.test.ts | 10 | CRUD, sanitization, edge cases |
| EventBus | EventBus.test.ts | 8 | Pub/sub, multiple listeners, once |
| HookEngine | HookEngine.test.ts | 6 | Loading, filtering, execution, destroy |
| SnapshotManager | SnapshotManager.test.ts | 6 | Init, cleanup, listing |

### 20.3 Execution

```bash
npx vitest run          # Tous les tests
npx vitest run --watch  # Mode watch
npx tsc --noEmit        # Type-check seul
```

---

## Annexe : Fichiers de configuration

### A.1 Agent custom

```json
// .claude/orchestrator/agents/my-agent.json
{
    "id": "my-agent",
    "name": "My Custom Agent",
    "description": "Description de l'agent",
    "systemPrompt": "You are a specialized agent for...",
    "capabilities": ["cap1", "cap2"],
    "model": null
}
```

### A.2 Workflow custom

```json
// .claude/orchestrator/workflows/my-workflow.json
{
    "name": "my-workflow",
    "description": "Description du workflow",
    "phases": [
        {
            "name": "Phase 1",
            "description": "Description de la phase",
            "agents": ["agent-id-1", "agent-id-2"],
            "maxIterations": 3
        },
        {
            "name": "Phase 2",
            "agents": ["agent-id-3"]
        }
    ]
}
```

### A.3 Hooks

```json
// .claude/orchestrator/hooks.json
{
    "hooks": [
        {
            "name": "hook-name",
            "event": "workflow:completed",
            "command": "echo done",
            "enabled": true,
            "timeout": 30000
        }
    ]
}
```

### A.4 Configuration MCP

```json
// ~/.mcp.json
{
    "mcpServers": {
        "orchestrator": {
            "command": "node",
            "args": ["/chemin/vers/mcp-orchestrator/dist/server.js"]
        }
    }
}
```
