# Manuel d'utilisation - MCP Orchestrator

## Table des matieres

1. [Qu'est-ce que l'orchestrateur ?](#1-quest-ce-que-lorchestateur)
2. [Installation et configuration](#2-installation-et-configuration)
3. [Concepts cles](#3-concepts-cles)
4. [Guide de demarrage rapide](#4-guide-de-demarrage-rapide)
5. [Quand utiliser chaque type de workflow](#5-quand-utiliser-chaque-type-de-workflow)
6. [Quand utiliser chaque mode de dispatch](#6-quand-utiliser-chaque-mode-de-dispatch)
7. [Utilisation detaillee des 7 outils](#7-utilisation-detaillee-des-7-outils)
8. [Les 8 agents specialises](#8-les-8-agents-specialises)
9. [Le systeme de scoring](#9-le-systeme-de-scoring)
10. [Phase de non-regression](#10-phase-de-non-regression)
11. [Memoires persistantes](#11-memoires-persistantes)
12. [Snapshots et rollback](#12-snapshots-et-rollback)
13. [Configuration avancee](#13-configuration-avancee)
14. [Scenarios d'utilisation concrets](#14-scenarios-dutilisation-concrets)
15. [Depannage](#15-depannage)

---

## 1. Qu'est-ce que l'orchestrateur ?

L'orchestrateur est un **serveur MCP** (Model Context Protocol) qui transforme Claude Code en chef d'equipe. Au lieu qu'un seul Claude fasse tout le travail, l'orchestrateur :

1. **Decompose** votre tache en phases structurees
2. **Assigne** chaque phase a des agents IA specialises
3. **Execute** les agents (manuellement, en CLI, ou visuellement en terminal)
4. **Note** le travail de chaque agent sur 6 axes de qualite
5. **Itere** automatiquement si la qualite est insuffisante (< 90/100)
6. **Protege** votre code avec des snapshots git et des tests de non-regression

**En resume** : vous dites ce que vous voulez, l'orchestrateur gere le comment.

---

## 2. Installation et configuration

### 2.1 Installation

```bash
cd /chemin/vers/mcp-orchestrator
npm install
npm run build
```

### 2.2 Configuration MCP

Ajouter le serveur dans la configuration MCP de Claude Code.

**Option A** - Configuration globale (`~/.mcp.json`) :
```json
{
  "mcpServers": {
    "orchestrator": {
      "command": "node",
      "args": ["E:/PROJETS/mcp-orchestrator/dist/server.js"]
    }
  }
}
```

**Option B** - Configuration projet (`.mcp.json` a la racine du projet) :
```json
{
  "mcpServers": {
    "orchestrator": {
      "command": "node",
      "args": ["E:/PROJETS/mcp-orchestrator/dist/server.js"]
    }
  }
}
```

### 2.3 Verification

Demarrer Claude Code dans votre projet. Les 7 outils `orchestrator_*` doivent apparaitre dans les outils disponibles.

---

## 3. Concepts cles

### Workflow

Un **workflow** est une sequence ordonnee de phases pour accomplir une tache. Chaque type de workflow a des phases predefinies avec les agents les plus adaptes.

```
Workflow BUILD:
  Phase 1: Design    → fullstack-ui-architect
  Phase 2: Code      → fullstack-ui-architect
  Phase 3: Tests     → test-automation-strategist
  Phase 4: Regression→ test-automation-strategist
  Phase 5: Security  → security-expert
  Phase 6: Review    → senior-code-reviewer
```

### Phase

Une **phase** est une etape du workflow. Chaque phase :
- Est assignee a un ou plusieurs agents
- Recoit le contexte des phases precedentes
- Est scoree apres execution (0-100)
- Peut etre re-iteree jusqu'a 3 fois si le score est insuffisant

### Agent

Un **agent** est un Claude Code specialise avec un system prompt dedie. Il ne connait que son domaine d'expertise. L'orchestrateur fournit 8 agents built-in et permet d'en creer des customs.

### Score et decision

Apres chaque phase, le ScoringEngine evalue le resultat :
- **>= 90** → **PASS** : phase validee, on passe a la suivante
- **60-89** → **ITERATE** : qualite insuffisante, on re-execute avec feedback
- **< 60** → **FAIL** : echec, rollback git, on continue quand meme

### Mode de dispatch

Le **mode de dispatch** determine comment les agents sont executes :
- **manual** : Claude joue le role de chaque agent dans la conversation
- **cli** : lance `claude --print` en subprocess (invisible)
- **terminal** : ouvre N fenetres/panes visibles en temps reel

---

## 4. Guide de demarrage rapide

### Votre premier workflow en 5 etapes

**Etape 1** - Dites a Claude ce que vous voulez :

```
Utilise l'orchestrateur pour creer un systeme d'authentification JWT
avec login, register, et middleware de verification.
```

Claude appellera automatiquement les outils MCP. Si vous voulez etre plus explicite :

**Etape 2** - Demarrer le workflow :

```
orchestrator_workflow { action: "start", type: "BUILD", task: "Systeme auth JWT avec login, register et middleware" }
```

**Etape 3** - Dispatcher les agents :

```
orchestrator_agents { action: "dispatch" }
```

En mode manual (defaut), Claude recoit les prompts et s'execute comme chaque agent.

**Etape 4** - Valider la phase :

```
orchestrator_validate {}
```

Le scoring est calcule. Si >= 90, la phase suivante demarre automatiquement.

**Etape 5** - Repeter les etapes 3-4 pour chaque phase jusqu'a la fin du workflow.

### Version automatisee

Pour laisser l'orchestrateur tout gerer :

```
orchestrator_agents { action: "set_mode", mode: "cli" }
orchestrator_agents { action: "auto_dispatch" }
```

L'orchestrateur execute chaque agent en subprocess, score, itere si necessaire, et avance automatiquement.

---

## 5. Quand utiliser chaque type de workflow

### BUILD - Creer quelque chose de nouveau

**Quand** : vous devez implementer une feature, un composant, un module, une API.

**Phases** : Design → Code → Tests → Regression → Security → Review

**Exemples** :
- "Cree un composant React de panier d'achat avec gestion du state"
- "Implemente une API REST CRUD pour les utilisateurs"
- "Ajoute un systeme de notifications push"

```
orchestrator_workflow { action: "start", type: "BUILD", task: "Composant React panier d'achat" }
```

### REVIEW - Auditer du code existant

**Quand** : vous voulez un audit de qualite sans modifier le code.

**Phases** : Analysis → Security Check → Report

**Exemples** :
- "Fais une review complete de src/auth/"
- "Analyse la qualite du code de l'API"

```
orchestrator_workflow { action: "start", type: "REVIEW", task: "Review complete du module auth" }
```

### OPTIMIZE - Ameliorer les performances

**Quand** : votre code fonctionne mais est trop lent, consomme trop de memoire, ou a des requetes DB inefficaces.

**Phases** : Profiling → Optimization → Regression

**Exemples** :
- "Optimise les requetes SQL du dashboard"
- "Reduis le bundle size de l'app React"
- "Ameliore le temps de reponse de l'API /search"

```
orchestrator_workflow { action: "start", type: "OPTIMIZE", task: "Optimiser les requetes du dashboard" }
```

### DESIGN - Concevoir une architecture

**Quand** : vous devez planifier avant de coder. Pas de code produit, juste de la conception.

**Phases** : Requirements → Architecture → Documentation

**Exemples** :
- "Concois l'architecture d'un systeme de chat temps reel"
- "Planifie la migration de monolithe vers microservices"

```
orchestrator_workflow { action: "start", type: "DESIGN", task: "Architecture systeme de chat temps reel" }
```

### DEBUG - Trouver et corriger un bug

**Quand** : quelque chose ne marche pas et vous ne savez pas pourquoi.

**Phases** : Investigation → Fix → Regression

**Exemples** :
- "Les utilisateurs perdent leur session apres 5 minutes"
- "L'upload de fichiers > 10MB crash le serveur"
- "Les notifications ne s'affichent pas sur mobile"

```
orchestrator_workflow { action: "start", type: "DEBUG", task: "Session perdue apres 5 minutes" }
```

### SECURITY_AUDIT - Audit de securite

**Quand** : vous devez verifier et corriger les failles de securite.

**Phases** : Scan → Analysis → Remediation → Regression → Report

**Exemples** :
- "Audit de securite complet de l'API"
- "Verifie les failles OWASP Top 10"
- "Securise le systeme d'authentification"

```
orchestrator_workflow { action: "start", type: "SECURITY_AUDIT", task: "Audit securite API" }
```

### CUSTOM - Workflow sur mesure

**Quand** : aucun workflow standard ne correspond a votre besoin.

Creez un fichier JSON dans `.claude/orchestrator/workflows/` :

```json
{
  "name": "api-feature",
  "description": "Workflow pour creer une feature API complete",
  "phases": [
    { "name": "API Design", "agents": ["distributed-systems-architect"], "maxIterations": 2 },
    { "name": "Database Schema", "agents": ["database-optimization-expert"], "maxIterations": 2 },
    { "name": "Implementation", "agents": ["fullstack-ui-architect"], "maxIterations": 3 },
    { "name": "Tests", "agents": ["test-automation-strategist"], "maxIterations": 2 },
    { "name": "Regression", "description": "Lancer tous les tests existants", "agents": ["test-automation-strategist"], "maxIterations": 2 },
    { "name": "Security Review", "agents": ["security-expert"], "maxIterations": 1 },
    { "name": "Documentation", "agents": ["technical-writer"], "maxIterations": 1 }
  ]
}
```

```
orchestrator_workflow { action: "start", type: "CUSTOM", task: "...", custom_name: "api-feature" }
```

---

## 6. Quand utiliser chaque mode de dispatch

### Mode Manual (defaut) - Quand vous voulez controler

**Quand l'utiliser** :
- Vous voulez voir et modifier ce que chaque agent produit
- Vous travaillez sur un projet sensible et voulez valider chaque etape
- Vous voulez guider les agents avec des instructions supplementaires
- Votre projet est petit et un seul Claude suffit

**Comment ca marche** :
- Claude recoit le system prompt et user prompt de chaque agent
- Claude adopte le role de l'agent et execute la tache
- Vous voyez tout dans la conversation et pouvez intervenir

```
orchestrator_agents { action: "set_mode", mode: "manual" }
```

**Avantages** : controle total, pas de cout API supplementaire, interaction possible
**Inconvenients** : sequentiel, plus lent, un seul "cerveau" pour tous les roles

### Mode CLI - Quand vous voulez automatiser

**Quand l'utiliser** :
- Vous faites confiance au processus et voulez juste le resultat
- La tache est bien definie et ne necessite pas d'intervention
- Vous voulez du parallelisme (chaque agent est un subprocess separe)

**Comment ca marche** :
- L'orchestrateur lance `claude --print` en subprocess pour chaque agent
- Chaque agent a son propre contexte et system prompt
- Les resultats sont collectes automatiquement
- 3 tentatives avec backoff exponentiel en cas d'echec

```
orchestrator_agents { action: "set_mode", mode: "cli" }
orchestrator_agents { action: "auto_dispatch" }
```

**Avantages** : automatique, vrais agents separes, retry automatique
**Inconvenients** : cout API supplementaire (1 appel par agent), invisible

### Mode Terminal - Quand vous voulez voir les agents travailler

**Quand l'utiliser** :
- Vous voulez voir les agents travailler en temps reel
- Vous voulez superviser visuellement le travail parallele
- Vous faites une demo ou une presentation
- Vous debuggez le comportement des agents

**Comment ca marche** :
- L'orchestrateur ouvre N fenetres/panes (une par agent)
- Chaque pane execute `claude --print` avec affichage en temps reel
- Vous voyez l'output de chaque agent en direct
- Vous verifiez le statut et collectez les resultats quand c'est fini

```
orchestrator_agents { action: "set_mode", mode: "terminal" }
orchestrator_agents { action: "dispatch" }
  → Les panes s'ouvrent
  → Attendez que les agents travaillent...
orchestrator_agents { action: "terminal_status" }
  → Verifie quels agents ont termine
orchestrator_agents { action: "terminal_collect" }
  → Collecte les resultats
orchestrator_validate {}
  → Score et passage a la phase suivante
```

**Layout automatique** (Windows Terminal) :

```
1 agent :  [     A     ]

2 agents : [  A  |  B  ]

3 agents : [  A  |  B  ]
           [     |  C  ]

4 agents : [  A  |  B  ]
           [  C  |  D  ]
```

**Fallback** : si Windows Terminal (`wt`) n'est pas installe, chaque agent s'ouvre dans une fenetre PowerShell separee.

**Avantages** : visibilite en temps reel, parallelisme, impressionnant en demo
**Inconvenients** : Windows only, cout API, necessite Windows Terminal pour les panes

---

## 7. Utilisation detaillee des 7 outils

### 7.1 orchestrator_workflow

Gere le cycle de vie du workflow.

| Action | Parametres | Description |
|--------|-----------|-------------|
| `start` | `type`, `task`, `custom_name?` | Demarre un nouveau workflow |
| `status` | - | Retourne l'etat du workflow (phase courante, progression) |
| `phases` | - | Detail de toutes les phases avec scores |
| `pause` | - | Met le workflow en pause |
| `resume` | - | Reprend un workflow en pause |
| `cancel` | - | Annule le workflow (cleanup automatique) |
| `list_custom` | - | Liste les workflows custom disponibles |

**Exemples** :

```
// Demarrer un workflow BUILD
orchestrator_workflow { action: "start", type: "BUILD", task: "Creer une API REST" }

// Verifier la progression
orchestrator_workflow { action: "status" }
→ { type: "BUILD", status: "RUNNING", currentPhase: "Code", progress: 33 }

// Voir toutes les phases
orchestrator_workflow { action: "phases" }
→ [
    { name: "Design", status: "PASS", score: 92 },
    { name: "Code", status: "RUNNING", iteration: 1 },
    { name: "Tests", status: "PENDING" },
    ...
  ]

// Mettre en pause et reprendre
orchestrator_workflow { action: "pause" }
orchestrator_workflow { action: "resume" }

// Annuler
orchestrator_workflow { action: "cancel" }
```

### 7.2 orchestrator_agents

Gere les agents et leur dispatch.

| Action | Parametres | Description |
|--------|-----------|-------------|
| `list` | - | Liste tous les agents (built-in + custom) |
| `get` | `agent_id` | Details d'un agent |
| `dispatch` | - | Dispatche les agents de la phase courante |
| `auto_dispatch` | - | Dispatch + auto-validation (mode cli) |
| `set_mode` | `mode` | Change le mode (manual, cli, terminal) |
| `get_mode` | - | Retourne le mode actuel |
| `get_prompt` | `agent_id` | Voir le prompt genere pour un agent |
| `current_phase` | - | Infos de la phase courante |
| `register` | `agent_id`, `name`, `system_prompt`, ... | Enregistre un agent custom |
| `terminal_status` | - | Statut des agents en mode terminal |
| `terminal_collect` | - | Collecte les outputs terminal |

**Exemples** :

```
// Lister les agents
orchestrator_agents { action: "list" }
→ [{ id: "security-expert", name: "Security Expert", capabilities: [...] }, ...]

// Voir le prompt qui sera envoye a un agent
orchestrator_agents { action: "get_prompt", agent_id: "security-expert" }
→ { systemPrompt: "You are a Security Expert...", userPrompt: "## Task\n..." }

// Enregistrer un agent custom a la volee
orchestrator_agents {
  action: "register",
  agent_id: "perf-expert",
  name: "Performance Expert",
  system_prompt: "You are a performance optimization expert...",
  description: "Expert en optimisation de performance",
  capabilities: ["profiling", "caching", "optimization"]
}

// Flux terminal complet
orchestrator_agents { action: "set_mode", mode: "terminal" }
orchestrator_agents { action: "dispatch" }
// ... attendre ...
orchestrator_agents { action: "terminal_status" }
→ { completed: ["agent-1"], running: ["agent-2"], allDone: false }
// ... attendre ...
orchestrator_agents { action: "terminal_status" }
→ { completed: ["agent-1", "agent-2"], running: [], allDone: true }
orchestrator_agents { action: "terminal_collect" }
→ { "agent-1": "output...", "agent-2": "output..." }
```

### 7.3 orchestrator_validate

Valide la phase courante et calcule le score.

```
// Validation simple
orchestrator_validate {}

// Validation avec output specifique
orchestrator_validate { output: "Le code a ete implemente dans src/auth/..." }

// Validation d'une phase specifique
orchestrator_validate { phaseId: "wf_123_phase_2" }
```

Le resultat inclut :
- Le score total (0-100)
- La decision (PASS / ITERATE / FAIL)
- Le breakdown par axe
- Les feedbacks pour amelioration
- Les bonuses et penalties

### 7.4 orchestrator_score

Calcul de score standalone (sans avancer le workflow).

```
// Scorer des fichiers specifiques
orchestrator_score { files: ["src/auth/login.ts", "src/auth/middleware.ts"] }
→ { total: 85, decision: "ITERATE", breakdown: { correctness: 90, security: 75, ... } }
```

Utile pour verifier la qualite d'un fichier avant de le soumettre.

### 7.5 orchestrator_rollback

Gere les snapshots git pour revenir en arriere.

```
// Lister les snapshots disponibles
orchestrator_rollback { action: "list" }
→ [{ id: "snap_123", phaseId: "phase_2", commitHash: "abc123", createdAt: "..." }]

// Creer un snapshot manuel
orchestrator_rollback { action: "create", description: "Avant refactoring" }

// Restaurer le dernier snapshot
orchestrator_rollback { action: "restore" }

// Restaurer un snapshot specifique
orchestrator_rollback { action: "restore", snapshotId: "snap_123" }
```

**Comment ca marche** :
- Avant chaque phase, l'orchestrateur cree un snapshot automatique
- Le snapshot enregistre le commit HEAD + les modifications non commitees (via git stash)
- La restauration fait un `git reset --hard` + reapplique le stash

### 7.6 orchestrator_memory

Gere les memoires persistantes entre sessions.

```
// Ecrire une memoire
orchestrator_memory {
  action: "write",
  name: "conventions-api",
  content: "# Conventions API\n- Tous les endpoints en /api/v1/\n- Auth via JWT Bearer\n- Pagination via cursor\n..."
}

// Lister les memoires
orchestrator_memory { action: "list" }
→ [{ name: "conventions-api", size: 256, updatedAt: "2024-01-15T..." }]

// Lire une memoire
orchestrator_memory { action: "read", name: "conventions-api" }
→ "# Conventions API\n- Tous les endpoints en /api/v1/\n..."

// Supprimer
orchestrator_memory { action: "delete", name: "conventions-api" }
```

**Quand utiliser les memoires** :
- Conventions de code du projet
- Decisions d'architecture
- Notes de context pour les futures sessions
- Regles metier importantes

Les memoires sont stockees dans `.claude/memories/` sous forme de fichiers `.md`. Elles sont automatiquement injectees dans le contexte de chaque agent.

### 7.7 orchestrator_status

Vue globale du systeme.

```
orchestrator_status {}
→ {
    version: "1.0.0",
    session: { id: "sess_123", startedAt: "..." },
    workflow: { type: "BUILD", status: "RUNNING", progress: 50 },
    agents: { total: 9, builtIn: 8, custom: 1 },
    memories: { count: 3 },
    hooks: { loaded: 4 },
    stats: { workflowsCompleted: 12, averageScore: 87 }
  }
```

---

## 8. Les 8 agents specialises

Chaque agent a un system prompt optimise pour son domaine. L'orchestrateur choisit automatiquement les agents les plus adaptes pour chaque phase.

### fullstack-ui-architect

**Specialite** : architecture front/back, implementation UI

**Utilise dans** : phases Design et Code

**Ce qu'il fait** :
- Concoit l'architecture des composants (React, Vue, Angular)
- Structure les couches API et les flux de donnees
- Implemente du code production-ready en TypeScript
- Applique SOLID, responsive design, accessibilite WCAG 2.1

### test-automation-strategist

**Specialite** : strategies de test, QA, non-regression

**Utilise dans** : phases Tests et Regression

**Ce qu'il fait** :
- Concoit des strategies de test (unit, integration, e2e)
- Ecrit des tests avec Jest, Vitest, Playwright, Cypress
- Identifie les edge cases et scenarios de regression
- Lance la suite de tests complete pour detecter les regressions

### security-expert

**Specialite** : securite applicative, OWASP

**Utilise dans** : phases Security et Security Audit

**Ce qu'il fait** :
- Scanne les patterns de vulnerabilite (XSS, injection SQL, CSRF)
- Verifie l'authentification et les autorisations
- Audite les dependances pour les CVE connues
- Propose des remediations

### senior-code-reviewer

**Specialite** : qualite de code, bonnes pratiques

**Utilise dans** : phases Review et Investigation (debug)

**Ce qu'il fait** :
- Analyse la lisibilite, maintenabilite, complexite
- Verifie le respect des conventions
- Detecte les code smells et anti-patterns
- Propose des refactorings

### database-optimization-expert

**Specialite** : base de donnees, performance des requetes

**Utilise dans** : phases Database Schema et Profiling

**Ce qu'il fait** :
- Concoit des schemas normalises/denormalises
- Optimise les requetes SQL (index, explain, jointures)
- Concoit les strategies de migration
- Planifie le partitionnement et le sharding

### distributed-systems-architect

**Specialite** : systemes distribues, scalabilite

**Utilise dans** : phases Architecture et Optimization

**Ce qu'il fait** :
- Concoit les architectures microservices
- Planifie la mise a l'echelle (load balancing, caching)
- Choisit les patterns de communication (REST, gRPC, events)
- Gere la resilience (circuit breaker, retry, fallback)

### technical-writer

**Specialite** : documentation technique

**Utilise dans** : phases Documentation et Report

**Ce qu'il fait** :
- Redige la documentation API (OpenAPI/Swagger)
- Ecrit les guides d'utilisation et README
- Documente l'architecture avec des diagrammes
- Cree les changelogs et release notes

### ux-design-strategist

**Specialite** : design UX, accessibilite

**Utilise dans** : phases Requirements et Design

**Ce qu'il fait** :
- Analyse les besoins utilisateur
- Concoit les parcours et wireframes
- Planifie l'accessibilite (WCAG, ARIA)
- Optimise l'ergonomie et la navigation

---

## 9. Le systeme de scoring

### Comment ca marche

Apres chaque phase, le ScoringEngine analyse le code produit sur 6 axes :

| Axe | Poids | Ce qu'il mesure | Comment |
|-----|-------|-----------------|---------|
| **Correctness** | 25% | Le code compile et fonctionne | Lance `tsc --noEmit`, verifie les fichiers |
| **Completeness** | 20% | Les requirements sont couverts | Verifie les outputs, fichiers modifies, erreurs |
| **Security** | 20% | Pas de failles de securite | Scanne 11 patterns OWASP dans le code |
| **Best Practices** | 15% | Code propre et maintenable | Verifie lint, conventions, code smells |
| **Tests** | 15% | Tests presents et passants | Lance le test runner, verifie le pass rate |
| **Documentation** | 5% | Documentation presente | Verifie README, JSDoc, commentaires |

### Bonuses et penalties

**Bonuses** (ajoutees au score) :
- Tests >= 90% : **+5 points**
- Best Practices >= 95% : **+3 points**
- Documentation >= 90% : **+2 points**
- Security = 100% : **+2 points**

**Penalties** (retirees du score) :
- Tests < 30% : **-10 points**
- Tests < 50% : **-5 points**
- Best Practices < 50% : **-5 points**
- Security < 60% : **-10 points**

### Bloqueurs

Certaines situations provoquent un **FAIL immediat** (score = 0) :
- **NO_OUTPUT** : aucun output produit et aucun fichier specifie
- **SYNTAX_ERROR** : erreur de syntaxe dans l'output
- **BUILD_FAILED** : echec de compilation
- **TESTS_CRASHED** : crash fatal des tests
- **CRITICAL_SECURITY** : mot de passe ou cle API en dur, cle privee dans le code, `eval()` ou `exec()` sur l'input utilisateur

### Cycle d'iteration

```
Phase executee → Score = 85 (ITERATE)
  → Feedback : "Areas to improve: security (75%), tests (60%)"
  → Re-dispatch avec le feedback injecte dans le prompt
  → Score = 92 (PASS)
  → Phase suivante
```

Maximum 3 iterations par phase. Apres 3 echecs, le workflow continue avec la phase suivante.

---

## 10. Phase de non-regression

### Pourquoi c'est important

Quand les agents modifient du code, ils peuvent casser des fonctionnalites existantes sans le savoir. La phase de non-regression detecte ces regressions **avant** la review finale.

### Comment ca marche

La phase Regression est presente dans les workflows qui modifient du code :
- **BUILD** : apres Tests, avant Security
- **OPTIMIZE** : apres Optimization
- **DEBUG** : apres Fix
- **SECURITY_AUDIT** : apres Remediation, avant Report

L'agent `test-automation-strategist` recoit ces instructions :

1. Lancer la **suite de tests complete** du projet (`npm test`, `vitest run`, etc.)
2. Identifier chaque test qui **echoue**
3. Rapporter le **nom du test**, le **fichier**, et le **message d'erreur**
4. Identifier quels **fichiers modifies** sont la cause probable
5. Proposer des **corrections**

### Si des regressions sont detectees

Le ScoringEngine note la phase Regression. Si le score est < 90 :
1. Le feedback est injecte dans le prompt de l'iteration suivante
2. L'agent re-execute avec les infos des tests casses
3. Il corrige les regressions et relance les tests
4. Maximum 3 iterations

---

## 11. Memoires persistantes

### A quoi ca sert

Les memoires sont des fichiers de contexte partages entre agents et entre sessions. Elles permettent de :
- Conserver les conventions du projet
- Partager des decisions d'architecture
- Stocker des informations recurrentes

### Quand les utiliser

**Bonne utilisation** :
```
orchestrator_memory {
  action: "write",
  name: "conventions",
  content: "- REST API en /api/v1/\n- Auth JWT Bearer\n- Pagination cursor\n- Errors en RFC 7807"
}
```

```
orchestrator_memory {
  action: "write",
  name: "architecture-decisions",
  content: "- Base: PostgreSQL\n- Cache: Redis\n- Queue: BullMQ\n- Auth: Passport.js"
}
```

**Mauvaise utilisation** (trop gros, trop specifique) :
```
// Ne pas stocker du code complet
orchestrator_memory { action: "write", name: "code-backup", content: "function login() { ... 500 lignes ... }" }
```

### Comment les agents les utilisent

Les memoires sont automatiquement injectees dans le prompt de chaque agent sous la section `## Project Memories`. Tous les agents voient toutes les memoires.

### Stockage

Les memoires sont stockees dans `.claude/memories/` sous forme de fichiers `.md`. Vous pouvez aussi les editer directement avec votre editeur.

---

## 12. Snapshots et rollback

### Fonctionnement automatique

Avant chaque phase, l'orchestrateur :
1. Enregistre le commit HEAD courant
2. Sauvegarde les modifications non commitees (git stash)
3. Stocke ces infos dans un snapshot

Si une phase echoue (score < 60, FAIL) :
1. Le code est restaure a l'etat du snapshot (git reset --hard)
2. Le stash est reapplique
3. Le workflow continue avec la phase suivante

### Utilisation manuelle

```
// Creer un point de sauvegarde
orchestrator_rollback { action: "create", description: "Avant refactoring" }

// Voir les points de sauvegarde
orchestrator_rollback { action: "list" }

// Revenir en arriere
orchestrator_rollback { action: "restore" }
```

### Attention

Le rollback fait un `git reset --hard`. Cela **supprime toutes les modifications non commitees**. Commitez votre travail important avant de lancer un workflow long.

---

## 13. Configuration avancee

### Agents custom sur disque

Fichier : `.claude/orchestrator/agents/mon-agent.json`

```json
{
  "id": "devops-engineer",
  "name": "DevOps Engineer",
  "description": "Expert CI/CD, Docker, Terraform",
  "systemPrompt": "You are a DevOps Engineer. Your role is to design and implement CI/CD pipelines, containerization, and infrastructure as code.\n\nKey responsibilities:\n- Docker and docker-compose configuration\n- CI/CD pipelines (GitHub Actions, GitLab CI)\n- Infrastructure as code (Terraform, Pulumi)\n- Monitoring and logging setup\n\nGuidelines:\n- Always use multi-stage Docker builds\n- Follow 12-factor app principles\n- Use environment variables for configuration\n- Include health checks and readiness probes",
  "capabilities": ["docker", "ci-cd", "terraform", "monitoring"]
}
```

**Champs requis** : `id`, `name`, `systemPrompt`. Les fichiers invalides sont ignores avec un warning.

### Workflows custom sur disque

Fichier : `.claude/orchestrator/workflows/mon-workflow.json`

```json
{
  "name": "fullstack-feature",
  "description": "Feature fullstack complete avec BDD",
  "phases": [
    {
      "name": "Database Design",
      "description": "Concevoir le schema de base de donnees",
      "agents": ["database-optimization-expert"],
      "maxIterations": 2
    },
    {
      "name": "API Implementation",
      "description": "Implementer les endpoints REST",
      "agents": ["fullstack-ui-architect", "distributed-systems-architect"],
      "maxIterations": 3
    },
    {
      "name": "Frontend",
      "description": "Implementer les composants UI",
      "agents": ["fullstack-ui-architect", "ux-design-strategist"],
      "maxIterations": 3
    },
    {
      "name": "Tests & Regression",
      "description": "Ecrire les tests et verifier les regressions",
      "agents": ["test-automation-strategist"],
      "maxIterations": 2
    },
    {
      "name": "Security & Review",
      "description": "Audit securite et review finale",
      "agents": ["security-expert", "senior-code-reviewer"],
      "maxIterations": 1
    }
  ]
}
```

**Champs requis** : `name`, `phases` (non-vide). Chaque phase doit avoir `name` et `agents` (non-vide).

**Phases multi-agents** : si une phase a plusieurs agents, ils sont executes sequentiellement en mode manual/cli, et en parallele en mode terminal. Chaque agent voit l'output des agents precedents de la meme phase.

### Hooks (evenements shell)

Fichier : `.claude/orchestrator/hooks.json`

```json
{
  "hooks": [
    {
      "name": "notify-start",
      "event": "workflow:started",
      "command": "powershell -Command \"[System.Media.SystemSounds]::Beep.Play()\"",
      "enabled": true
    },
    {
      "name": "run-lint-after-code",
      "event": "phase:completed",
      "command": "npx eslint src/ --fix",
      "condition": { "phaseName": "Code" },
      "timeout": 30000
    },
    {
      "name": "notify-complete",
      "event": "workflow:completed",
      "command": "echo Workflow termine avec succes",
      "enabled": true
    },
    {
      "name": "alert-failure",
      "event": "workflow:failed",
      "command": "echo ECHEC du workflow",
      "enabled": true
    }
  ]
}
```

**Variables d'environnement** injectees dans chaque hook :
- `ORCHESTRATOR_EVENT` : nom de l'evenement
- `ORCHESTRATOR_PAYLOAD` : JSON du payload
- `ORCHESTRATOR_HOOK_NAME` : nom du hook

**Events disponibles** :
- `workflow:started`, `workflow:completed`, `workflow:failed`, `workflow:paused`, `workflow:resumed`, `workflow:cancelled`
- `phase:started`, `phase:completed`, `phase:iterating`, `phase:failed`
- `score:calculated`
- `agent:dispatched`
- `agent:terminalSpawned`, `agent:terminalAgentDone`, `agent:terminalAllDone`
- `hook:triggered`, `hook:error`
- `snapshot:created`, `snapshot:restored`
- `memory:written`, `memory:deleted`

---

## 14. Scenarios d'utilisation concrets

### Scenario 1 : Creer une API REST complete

```
Vous : "Utilise l'orchestrateur pour creer une API REST d'authentification
        avec register, login, refresh token, et middleware JWT."

Claude :
1. orchestrator_workflow { action: "start", type: "BUILD", task: "API REST auth..." }
2. orchestrator_agents { action: "dispatch" }
   → Phase Design : fullstack-ui-architect concoit les endpoints
3. orchestrator_validate
   → Score 94 (PASS)
4. orchestrator_agents { action: "dispatch" }
   → Phase Code : fullstack-ui-architect implemente
5. orchestrator_validate
   → Score 78 (ITERATE) - "Security: hardcoded secret in config"
6. orchestrator_agents { action: "dispatch" }
   → Re-dispatch avec feedback, corrige le secret
7. orchestrator_validate
   → Score 91 (PASS)
8. ... Tests, Regression, Security, Review ...
9. orchestrator_workflow { action: "status" }
   → { status: "COMPLETE", totalScore: 90 }
```

### Scenario 2 : Debug avec surveillance visuelle

```
Vous : "Il y a un memory leak dans le serveur WebSocket. Utilise le mode
        terminal pour que je puisse voir les agents travailler."

Claude :
1. orchestrator_workflow { action: "start", type: "DEBUG", task: "Memory leak serveur WebSocket" }
2. orchestrator_agents { action: "set_mode", mode: "terminal" }
3. orchestrator_agents { action: "dispatch" }
   → Une pane s'ouvre : senior-code-reviewer investigue
   → Vous voyez l'analyse en temps reel
4. orchestrator_agents { action: "terminal_status" }
   → { allDone: true }
5. orchestrator_agents { action: "terminal_collect" }
6. orchestrator_validate
   → Score 88 (ITERATE) - "Fix needs more testing"
7. ... Iteration avec feedback ...
```

### Scenario 3 : Audit de securite automatise

```
Vous : "Lance un audit securite complet en mode CLI automatique."

Claude :
1. orchestrator_workflow { action: "start", type: "SECURITY_AUDIT", task: "Audit securite complet" }
2. orchestrator_agents { action: "set_mode", mode: "cli" }
3. orchestrator_agents { action: "auto_dispatch" }
   → Phase Scan : security-expert scanne (subprocess)
   → Score 95 (PASS)
   → Phase Analysis : security-expert analyse
   → Score 90 (PASS)
   → Phase Remediation : security-expert + fullstack-ui-architect corrigent
   → Score 85 (ITERATE) → re-dispatch → Score 92 (PASS)
   → Phase Regression : test-automation-strategist verifie les tests
   → Score 94 (PASS)
   → Phase Report : technical-writer documente
   → Score 91 (PASS)
4. orchestrator_workflow { action: "status" }
   → { status: "COMPLETE", totalScore: 91 }
```

### Scenario 4 : Workflow custom multi-agents

```
Vous : "J'ai cree un workflow custom 'api-feature'. Lance-le pour creer
        un endpoint de recherche full-text."

Claude :
1. orchestrator_workflow { action: "list_custom" }
   → ["api-feature"]
2. orchestrator_workflow {
     action: "start",
     type: "CUSTOM",
     task: "Endpoint recherche full-text avec ElasticSearch",
     custom_name: "api-feature"
   }
3. ... Les phases custom s'executent dans l'ordre defini ...
```

### Scenario 5 : Utilisation des memoires pour la coherence

```
// Session 1 : etablir les conventions
Vous : "Sauvegarde nos conventions de code en memoire."
orchestrator_memory {
  action: "write",
  name: "conventions",
  content: "- TypeScript strict\n- Zod pour la validation\n- Drizzle ORM\n- Hono framework"
}

// Session 2 : les agents connaissent les conventions
Vous : "Cree un nouvel endpoint avec l'orchestrateur."
→ Chaque agent recoit automatiquement la memoire "conventions"
→ Ils utilisent Zod, Drizzle, Hono comme specifie
```

---

## 15. Depannage

### "Unknown tool: orchestrator_*"

Le serveur MCP n'est pas connecte. Verifiez :
1. Le fichier `.mcp.json` pointe vers le bon chemin
2. Le projet est build (`npm run build`)
3. Le fichier `dist/server.js` existe

### "Orchestrator not initialized"

L'orchestrateur n'a pas ete initialise. Cela arrive si le serveur vient de demarrer. Relancez la commande.

### "No workflow running"

Vous essayez de dispatcher/valider sans workflow actif. Demarrez d'abord un workflow :
```
orchestrator_workflow { action: "start", type: "BUILD", task: "..." }
```

### "Agent X is not assigned to the current phase"

L'agent demande n'est pas assigne a la phase courante. Verifiez quelle phase est active :
```
orchestrator_agents { action: "current_phase" }
```

### Le mode terminal ne s'ouvre pas

1. **Windows Terminal installe ?** Verifiez avec `where wt` dans PowerShell
2. **PowerShell 7 installe ?** Le fallback utilise `pwsh`. Verifiez avec `where pwsh`
3. **Antivirus ?** Certains antivirus bloquent le lancement de processus

### Le scoring est trop severe / trop laxiste

Le scoring est deterministe et base sur des heuristiques. Si vos fichiers ne sont pas dans le projet root, le scoring ne les trouvera pas. Assurez-vous que :
- Les chemins de fichiers sont relatifs au root du projet
- `tsconfig.json` est present pour la verification TypeScript
- Le test runner est bien detecte (`vitest`, `jest` dans package.json)

### Les memoires ne sont pas visibles par les agents

Les memoires sont dans `.claude/memories/`. Verifiez :
```
orchestrator_memory { action: "list" }
```
Si la liste est vide, ecrivez une memoire :
```
orchestrator_memory { action: "write", name: "test", content: "Hello" }
```

### Le rollback ne fonctionne pas

Le rollback necessite un repo git. Verifiez :
1. Le projet est un repo git (`git status`)
2. Il y a au moins un commit (`git log`)
3. Les snapshots existent : `orchestrator_rollback { action: "list" }`

### Les hooks ne se declenchent pas

1. Le fichier est bien dans `.claude/orchestrator/hooks.json`
2. Le JSON est valide
3. Le champ `enabled` n'est pas `false`
4. Le champ `event` correspond exactement a un event existant
5. Si `condition` est defini, le payload doit matcher exactement
